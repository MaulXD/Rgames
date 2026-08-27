#!/usr/bin/env node
/**
 * Teste de fumaça do Dossiê: partida completa, com três jogadores.
 *
 *   npm run smoke:dossie
 *
 * O foco é o que não pode vazar: a solução do envelope e as mãos. Se algum
 * desses aparecer num payload público, o jogo acabou — então essas asserções
 * vêm primeiro e são as mais duras.
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(root, ".env.local"), quiet: true });

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;

let falhas = 0;
const ok = (c, m) => {
  if (!c) falhas++;
  console.log(`${c ? "  ok    " : "  FALHA "} ${m}`);
};

const conn = new URL(process.env.POSTGRES_URL_NON_POOLING);
conn.searchParams.set("uselibpqcompat", "true");
const db = new pg.Client({ connectionString: conn.toString() });
await db.connect();

async function admin(path, opts = {}) {
  const r = await fetch(`${URL_}/auth/v1${path}`, {
    ...opts,
    headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, "Content-Type": "application/json" },
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function player(email) {
  const { body } = await admin("/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password: "SenhaDeTeste!2026", email_confirm: true }),
  });
  const t = await (
    await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "SenhaDeTeste!2026" }),
    })
  ).json();
  return { id: body?.id, token: t.access_token };
}

async function rpc(token, fn, args) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args ?? {}),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function get(token, path) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

const stamp = Date.now();
const P = [
  await player(`dos-a-${stamp}@mesa.invalid`),
  await player(`dos-b-${stamp}@mesa.invalid`),
  await player(`dos-c-${stamp}@mesa.invalid`),
];
ok(P.every((p) => p.token), "três jogadores autenticados");

const sala = (await rpc(P[0].token, "create_room", { p_game: "dossie" })).body;
await rpc(P[1].token, "join_room", { p_code: sala.code });
ok(!!sala?.id, `sala ${sala?.code} criada`);

// com dois jogadores não começa
const poucos = await rpc(P[0].token, "dossie_start", { p_room: sala.id });
ok(poucos.status >= 400 && /NEED_THREE/.test(JSON.stringify(poucos.body)), "com dois jogadores não começa");

await rpc(P[2].token, "join_room", { p_code: sala.code });

const naoHost = await rpc(P[1].token, "dossie_start", { p_room: sala.id });
ok(naoHost.status >= 400 && /NOT_HOST/.test(JSON.stringify(naoHost.body)), "quem não é anfitrião não começa");

const inicio = await rpc(P[0].token, "dossie_start", { p_room: sala.id });
const partida = inicio.body;
ok(inicio.status === 200 && partida?.id, "dossie_start criou a partida");

// ── o que não pode vazar ──────────────────────────────────────────────────
const estrela = await get(P[1].token, `matches?select=*&id=eq.${partida.id}`);
ok(estrela.status >= 400 || !(estrela.body?.[0] ?? {}).solution,
   `select=* na partida nao entrega a solucao (status ${estrela.status})`);

const colunaSol = await get(P[1].token, `matches?select=solution&id=eq.${partida.id}`);
ok(colunaSol.status >= 400, `pedir a coluna solution e negado (status ${colunaSol.status})`);

const colunaSeed = await get(P[1].token, `matches?select=seed&id=eq.${partida.id}`);
ok(colunaSeed.status >= 400, `pedir a coluna seed e negado (status ${colunaSeed.status})`);

ok(!JSON.stringify(inicio.body ?? {}).includes("solution"),
   "a resposta de dossie_start nao carrega a solucao");

const publico = (await get(
  P[1].token,
  `matches?select=id,status,public_state,turn_deadline&id=eq.${partida.id}`,
)).body?.[0];
ok(!!publico?.public_state?.theme, "leitura explicita das colunas seguras funciona");

const { rows: srows } = await db.query("select solution from matches where id = $1", [partida.id]);
const sol = srows[0].solution;
console.log(`  envelope: ${sol.suspect} · ${sol.weapon} · ${sol.room}`);

const { rows: hands } = await db.query(
  "select mp.seat, mps.user_id, mps.data -> 'hand' hand from match_private_state mps join match_players mp on mp.match_id = mps.match_id and mp.user_id = mps.user_id where mps.match_id = $1 order by mp.seat",
  [partida.id],
);
ok(hands.length === 3, "três mãos distribuídas");
const totalCartas = hands.reduce((s, h) => s + h.hand.length, 0);
ok(totalCartas === 18, `18 cartas distribuídas (contadas ${totalCartas})`);
const todas = hands.flatMap((h) => h.hand);
ok(new Set(todas).size === 18, "nenhuma carta repetida entre as mãos");
ok(![sol.suspect, sol.weapon, sol.room].some((c) => todas.includes(c)),
   "nenhuma carta do envelope está em mão de jogador");

const espiar = await get(P[1].token, `match_private_state?select=data&match_id=eq.${partida.id}`);
ok(espiar.body?.length === 1, "cada um lê apenas a própria mão (RLS)");

// ── mover ────────────────────────────────────────────────────────────────
const { rows: trows } = await db.query(
  "select data from game_themes where id = $1",
  [partida.public_state.theme],
);
const tema = trows[0].data;
const est0 = publico.public_state;
const meuSeat = est0.turnSeat;
const eu = P.find((_, i) => hands[i].seat === meuSeat) ?? P[0];
const aqui = est0.positions[String(meuSeat)];
const vizinhos = tema.adjacency[aqui];
console.log(`  vez do assento ${meuSeat}, em ${aqui}`);

const foraDaVez = await rpc(
  P.find((p) => p.id !== eu.id).token, "dossie_move",
  { p_match: partida.id, p_room: vizinhos[0] },
);
ok(foraDaVez.status >= 400 && /NOT_YOUR_TURN/.test(JSON.stringify(foraDaVez.body)), "não move fora da sua vez");

const longe = tema.rooms.map((r) => r.id).find(
  (r) => r !== aqui && !vizinhos.includes(r) &&
    !tema.secretPassages.some((p) => p.includes(aqui) && p.includes(r)),
);
const inalcancavel = await rpc(eu.token, "dossie_move", { p_match: partida.id, p_room: longe });
ok(inalcancavel.status >= 400 && /UNREACHABLE/.test(JSON.stringify(inalcancavel.body)),
   `lugar não adjacente (${longe}) é recusado`);

const mov = await rpc(eu.token, "dossie_move", { p_match: partida.id, p_room: vizinhos[0] });
ok(mov.body?.ok === true, `move para ${vizinhos[0]} (vizinho)`);

let est = (await get(eu.token, `matches?select=public_state&id=eq.${partida.id}`)).body[0].public_state;
ok(est.positions[String(meuSeat)] === vizinhos[0], "posição atualizada");
ok(est.actionsLeft === 1, "consumiu uma das duas ações");

// ── palpitar ─────────────────────────────────────────────────────────────
// escolhe um palpite que ALGUÉM tem, para exercitar a cadeia de refutação
const minhaMao = hands.find((h) => h.seat === meuSeat).hand;
const outrasMaos = hands.filter((h) => h.seat !== meuSeat);
const suspAlheio = outrasMaos
  .flatMap((h) => h.hand)
  .find((c) => tema.suspects.some((s) => s.id === c) && !minhaMao.includes(c));
const armaQualquer = tema.weapons.map((w) => w.id).find((w) => w !== sol.weapon);

const pal = await rpc(eu.token, "dossie_suggest", {
  p_match: partida.id,
  p_suspect: suspAlheio ?? tema.suspects[0].id,
  p_weapon: armaQualquer,
});
ok(pal.body?.ok === true, `palpite: ${suspAlheio ?? tema.suspects[0].id} + ${armaQualquer}`);

est = (await get(eu.token, `matches?select=public_state&id=eq.${partida.id}`)).body[0].public_state;
ok(est.phase === "refute", "fase virou refutação");
ok(est.pending?.queue?.length === 2, "fila de refutação tem os outros dois");
ok(est.weapons[armaQualquer] === est.positions[String(meuSeat)], "a arma nomeada foi movida para o lugar");

// quem não é o da vez na fila não refuta
const primeiroSeat = est.pending.queue[0];
const idxPrimeiro = hands.findIndex((h) => h.seat === primeiroSeat);
const primeiro = P[idxPrimeiro];
const segundo = P[hands.findIndex((h) => h.seat === est.pending.queue[1])];

const foraDaFila = await rpc(segundo.token, "dossie_pass_refute", { p_match: partida.id });
ok(foraDaFila.status >= 400 && /NOT_YOUR_REFUTE/.test(JSON.stringify(foraDaFila.body)),
   "quem não é o próximo da fila não refuta");

const maoPrimeiro = hands[idxPrimeiro].hand;
const podeRefutar = est.pending.guess.filter((g) => maoPrimeiro.includes(g));

if (podeRefutar.length > 0) {
  // não pode "esquecer" de refutar
  const fingiu = await rpc(primeiro.token, "dossie_pass_refute", { p_match: partida.id });
  ok(fingiu.status >= 400 && /YOU_MUST_REFUTE/.test(JSON.stringify(fingiu.body)),
     "quem TEM a carta não consegue passar");

  // não pode mostrar carta que não tem
  const naoTenho = todas.find((c) => !maoPrimeiro.includes(c) && est.pending.guess.includes(c))
    ?? todas.find((c) => !maoPrimeiro.includes(c));
  const mentiu = await rpc(primeiro.token, "dossie_refute", { p_match: partida.id, p_card: naoTenho });
  ok(mentiu.status >= 400, "não mostra carta que não está na mão");

  // não pode mostrar carta fora do palpite
  const foraPalpite = maoPrimeiro.find((c) => !est.pending.guess.includes(c));
  if (foraPalpite) {
    const errada = await rpc(primeiro.token, "dossie_refute", { p_match: partida.id, p_card: foraPalpite });
    ok(errada.status >= 400 && /NOT_IN_GUESS/.test(JSON.stringify(errada.body)),
       "não mostra carta que não é do palpite");
  }

  const refutou = await rpc(primeiro.token, "dossie_refute", { p_match: partida.id, p_card: podeRefutar[0] });
  ok(refutou.body?.ok === true, `assento ${primeiroSeat} refuta com ${podeRefutar[0]}`);

  est = (await get(eu.token, `matches?select=public_state&id=eq.${partida.id}`)).body[0].public_state;
  const linha = est.log.find((l) => l.type === "refute");
  ok(!!linha && linha.seat === primeiroSeat, "o log diz QUEM refutou");
  ok(linha?.card === undefined && Object.keys(linha ?? {}).every((k) => k !== "card"),
     "a linha de refutação não tem campo de carta (o palpite em si é público)");

  const meuPriv = (await get(eu.token, `match_private_state?select=data&match_id=eq.${partida.id}`)).body[0].data;
  ok(meuPriv.seen.some((s) => s.card === podeRefutar[0] && s.from === primeiroSeat),
     "a carta entrou no estado privado de quem palpitou");

  const priv3 = (await get(segundo.token, `match_private_state?select=data&match_id=eq.${partida.id}`)).body[0].data;
  ok((priv3.seen ?? []).length === 0, "o terceiro jogador não vê a carta mostrada");
} else {
  ok(true, "assento da fila não tinha carta do palpite (caminho de passe)");
  const passou = await rpc(primeiro.token, "dossie_pass_refute", { p_match: partida.id });
  ok(passou.body?.ok === true, "passa quando não tem nenhuma");
}

// ── acusação ─────────────────────────────────────────────────────────────
est = (await get(eu.token, `matches?select=public_state&id=eq.${partida.id}`)).body[0].public_state;
const vezAgora = est.turnSeat;
const jogadorVez = P[hands.findIndex((h) => h.seat === vezAgora)];
ok(vezAgora !== meuSeat, "a vez passou depois da refutação");

// erra de propósito
const suspErrado = tema.suspects.map((s) => s.id).find((s) => s !== sol.suspect);
const acusaErrado = await rpc(jogadorVez.token, "dossie_accuse", {
  p_match: partida.id, p_suspect: suspErrado, p_weapon: sol.weapon, p_room: sol.room,
});
ok(acusaErrado.body?.right === false, "acusação errada é rejeitada como errada");

est = (await get(eu.token, `matches?select=public_state&id=eq.${partida.id}`)).body[0].public_state;
ok(est.ghosts.includes(vezAgora), "quem errou virou fantasma");
ok(est.turnSeat !== vezAgora, "o fantasma não recebe mais turno");

const denovo = await rpc(jogadorVez.token, "dossie_accuse", {
  p_match: partida.id, p_suspect: sol.suspect, p_weapon: sol.weapon, p_room: sol.room,
});
ok(denovo.status >= 400, "fantasma não acusa de novo");

// o fantasma continua na fila de refutação
est = (await get(eu.token, `matches?select=public_state&id=eq.${partida.id}`)).body[0].public_state;
const vez2 = est.turnSeat;
const jog2 = P[hands.findIndex((h) => h.seat === vez2)];
const pal2 = await rpc(jog2.token, "dossie_suggest", {
  p_match: partida.id,
  p_suspect: tema.suspects[0].id,
  p_weapon: tema.weapons[0].id,
});
if (pal2.body?.ok) {
  est = (await get(eu.token, `matches?select=public_state&id=eq.${partida.id}`)).body[0].public_state;
  ok(est.pending.queue.includes(vezAgora), "o fantasma continua sendo consultado na refutação");
} else {
  ok(false, `segundo palpite falhou: ${JSON.stringify(pal2.body)}`);
}

// ── prazo: ninguém segura a partida ──────────────────────────────────────
const antes = (await get(eu.token, `matches?select=public_state&id=eq.${partida.id}`)).body[0].public_state;
const atAntes = antes.pending?.at ?? null;

await db.query("update matches set turn_deadline = now() - interval '1 second' where id = $1", [partida.id]);
// idem: o pg_cron pode ter varrido antes. Mede o efeito, nao o contador.
await db.query("select public.dossie_sweep()");
ok(true, "a varredura rodou sem erro");

est = (await get(eu.token, `matches?select=public_state&id=eq.${partida.id}`)).body[0].public_state;
// uma varredura resolve UM jogador da fila: ou fecha a refutação, ou avança a vez
ok(est.pending === null || (est.pending.at ?? 0) > (atAntes ?? -1),
   "a varredura destravou: refutação fechada ou fila avançada");

// esvazia o resto da fila, se sobrou
let guarda = 0;
while (est.pending && guarda < 6) {
  await db.query("update matches set turn_deadline = now() - interval '1 second' where id = $1", [partida.id]);
  await db.query("select public.dossie_sweep()");
  est = (await get(eu.token, `matches?select=public_state&id=eq.${partida.id}`)).body[0].public_state;
  guarda++;
}
ok(est.pending === null, "a fila de refutação sempre se esvazia sozinha");

// ── acerto: fecha o caso ─────────────────────────────────────────────────
est = (await get(eu.token, `matches?select=public_state,status&id=eq.${partida.id}`)).body[0].public_state;
const vez3 = est.turnSeat;
const jog3 = P[hands.findIndex((h) => h.seat === vez3)];
const acertou = await rpc(jog3.token, "dossie_accuse", {
  p_match: partida.id, p_suspect: sol.suspect, p_weapon: sol.weapon, p_room: sol.room,
});
ok(acertou.body?.right === true, "acusação certa fecha o caso");

const fim = (await get(eu.token, `matches?select=status,public_state&id=eq.${partida.id}`)).body[0];
ok(fim.status === "finished", "partida encerrada");
ok(fim.public_state.phase === "over", "fase virou desfecho");
ok(fim.public_state.winner === vez3, "o vencedor é quem acusou certo");
ok(fim.public_state.solution?.suspect === sol.suspect, "a solução só aparece DEPOIS do fim");

const salaFim = (await get(eu.token, `rooms?select=status&id=eq.${sala.id}`)).body?.[0];
ok(salaFim?.status === "lobby", "sala voltou para o lobby");

// ── caderno ──────────────────────────────────────────────────────────────
const pad = await rpc(eu.token, "dossie_pad", {
  p_match: partida.id,
  p_pad: { marks: { revolver: { 0: "x" } }, assist: "assistido" },
});
ok(pad.body?.ok === true, "o caderno aceita anotação do dono");

/* ══════════════════════════════════════════════════════════════════════════
   ESCOLHER O CASO NO LOBBY

   O vocabulário deste ajuste é DINÂMICO: em vez de listar os ids no SQL, a
   validação pergunta ao banco se aquele tema existe. Então o teste tem de
   provar as duas pontas — que um id que existe é aceito, e que um que não
   existe é recusado — porque é essa pergunta ao banco que sustenta a promessa
   de "tema novo é escolhível sem migração".
   ══════════════════════════════════════════════════════════════════════════ */

const salaE = (await rpc(P[0].token, "create_room", { p_game: "dossie" })).body;

const chaveErradaD = await rpc(P[0].token, "set_room_settings", {
  p_room: salaE.id,
  p_settings: { modo: "classico" },
});
ok(
  /UNKNOWN_SETTING_modo/.test(JSON.stringify(chaveErradaD.body)),
  "o Dossiê não tem `modo`: a chave de outro jogo é recusada",
);

const temaInventado = await rpc(P[0].token, "set_room_settings", {
  p_room: salaE.id,
  p_settings: { tema: "vila-que-nao-existe" },
});
ok(
  /BAD_THEME/.test(JSON.stringify(temaInventado.body)),
  "caso que não existe no banco é recusado",
);

const surpresa = await rpc(P[0].token, "set_room_settings", {
  p_room: salaE.id,
  p_settings: { tema: "surpresa" },
});
ok(surpresa.body?.settings?.tema === "surpresa", "surpresa é o padrão e é aceito");

const escolhido = await rpc(P[0].token, "set_room_settings", {
  p_room: salaE.id,
  p_settings: { tema: "ras-zamir" },
});
ok(
  escolhido.body?.settings?.tema === "ras-zamir",
  "e um caso que existe no banco é aceito — sem o id estar escrito no SQL",
);

// e a partida respeita a escolha da sala, sem passar p_theme
await rpc(P[1].token, "join_room", { p_code: salaE.code });
await rpc(P[2].token, "join_room", { p_code: salaE.code });
const comEscolha = await rpc(P[0].token, "dossie_start", { p_room: salaE.id });
ok(comEscolha.status === 200, "a partida começa com o caso combinado no lobby");
if (comEscolha.status === 200) {
  const qual = (
    await db.query("select public_state -> 'theme' t from matches where id = $1", [
      comEscolha.body.id,
    ])
  ).rows[0].t;
  ok(
    qual === "ras-zamir",
    `e é o caso escolhido, não um sorteado (${qual}) — a sala foi respeitada sem p_theme`,
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   OS QUATRO TEMAS

   O motor do Dossiê não sabe o que é uma "biblioteca" nem um "Coronel". A
   prova disso não é o comentário no código — é este teste: os quatro temas
   começam uma partida de verdade, e o envelope de cada uma sai do elenco do
   tema certo.

   Se um dia alguém escrever "biblioteca" dentro do motor, este teste continua
   passando para o Solar e reprova para os outros três. É o tipo de verificação
   que só vale a pena depois que existe mais de um tema — e agora existem
   quatro.
   ══════════════════════════════════════════════════════════════════════════ */

const temas = (
  await db.query(
    "select id, name, data from game_themes where game_key = 'dossie' order by id",
  )
).rows;
ok(temas.length === 4, `quatro temas publicados (${temas.map((t) => t.id).join(", ")})`);

for (const tema of temas) {
  const salaT = (await rpc(P[0].token, "create_room", { p_game: "dossie" })).body;
  await rpc(P[1].token, "join_room", { p_code: salaT.code });
  await rpc(P[2].token, "join_room", { p_code: salaT.code });

  const inicioT = await rpc(P[0].token, "dossie_start", {
    p_room: salaT.id,
    p_theme: tema.id,
  });
  ok(
    inicioT.status === 200,
    `${tema.name}: a partida começa (${JSON.stringify(inicioT.body).slice(0, 60)})`,
  );
  if (inicioT.status !== 200) continue;

  const est = (
    await db.query("select public_state, solution from matches where id = $1", [
      inicioT.body.id,
    ])
  ).rows[0];

  ok(est.public_state.theme === tema.id, `${tema.name}: o estado aponta para o tema certo`);

  // o envelope sai do elenco DESTE tema
  const sol = est.solution;
  const suspeitos = tema.data.suspects.map((x) => x.id);
  const objetos = tema.data.weapons.map((x) => x.id);
  const lugares = tema.data.rooms.map((x) => x.id);
  ok(
    suspeitos.includes(sol.suspect) &&
      objetos.includes(sol.weapon) &&
      lugares.includes(sol.room),
    `${tema.name}: o envelope (${sol.suspect}, ${sol.weapon}, ${sol.room}) sai do elenco deste tema`,
  );

  // os peões começam num lugar que existe neste tema
  ok(
    Object.values(est.public_state.positions).every((l) => lugares.includes(l)),
    `${tema.name}: todo peão começa num lugar deste mapa`,
  );

  // e os suspeitos distribuídos são os deste tema
  ok(
    est.public_state.players.every((j) => suspeitos.includes(j.suspect)),
    `${tema.name}: cada jogador recebeu um suspeito deste elenco`,
  );

  // as cartas na mão saem do baralho do tema, e o envelope não vaza para ninguém
  const maos = (
    await db.query(
      "select data -> 'hand' h from match_private_state where match_id = $1",
      [inicioT.body.id],
    )
  ).rows.map((r) => r.h);
  const todasCartas = [...suspeitos, ...objetos, ...lugares];
  ok(
    maos.every((m) => m.every((c) => todasCartas.includes(c))),
    `${tema.name}: toda carta distribuída pertence ao baralho do tema`,
  );
  ok(
    maos.every((m) => !m.includes(sol.suspect) && !m.includes(sol.weapon) && !m.includes(sol.room)),
    `${tema.name}: nenhuma carta do envelope foi distribuída`,
  );

  const total = maos.reduce((n, m) => n + m.length, 0);
  ok(
    total === 21 - 3,
    `${tema.name}: as 18 cartas fora do envelope foram todas distribuídas (${total})`,
  );
}

for (const p of P) await admin(`/admin/users/${p.id}`, { method: "DELETE" });
await db.end();

console.log(falhas === 0 ? "\nTudo passou." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
