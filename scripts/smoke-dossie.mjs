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

/**
 * Chama a faxina até três vezes, e devolve quantas partidas ela atendeu.
 *
 * As faxinas percorrem as partidas com `for update skip locked` — e têm de ser
 * assim, porque uma mesa travada não pode parar a varredura das outras. Mas isso
 * significa que, se o `pg_cron` estiver segurando a linha neste instante (ele
 * roda as mesmas funções sozinho, a cada minuto ou a cada dez segundos), a
 * chamada do teste PULA a partida e volta sem ter feito nada.
 *
 * Não é defeito da faxina: é o teste dependendo de ganhar uma corrida. Insistir
 * resolve, e diz a verdade sobre o que está sendo medido — "o turno foi
 * atendido", não "foi atendido por esta chamada específica".
 */
async function varre(fn) {
  let atendidas = 0;
  for (let i = 0; i < 3; i++) {
    const r = await db.query(`select public.${fn}() n`);
    atendidas += Number(r.rows[0].n ?? 0);
  }
  return atendidas;
}


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
await varre("dossie_sweep");
ok(true, "a varredura rodou sem erro");

est = (await get(eu.token, `matches?select=public_state&id=eq.${partida.id}`)).body[0].public_state;
// uma varredura resolve UM jogador da fila: ou fecha a refutação, ou avança a vez
ok(est.pending === null || (est.pending.at ?? 0) > (atAntes ?? -1),
   "a varredura destravou: refutação fechada ou fila avançada");

// esvazia o resto da fila, se sobrou
let guarda = 0;
while (est.pending && guarda < 6) {
  await db.query("update matches set turn_deadline = now() - interval '1 second' where id = $1", [partida.id]);
  await varre("dossie_sweep");
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

/* ══════════════════════════════════════════════════════════════════════════
   O CÉREBRO DA MÁQUINA NO DOSSIÊ

   O mais difícil dos quatro, por um motivo só: A MÁQUINA NÃO PODE VER O
   ENVELOPE. No Letreiro ela sorteia de uma lista; no Domínio e na Metrópole ela
   vê o mesmo tabuleiro que todo mundo. Aqui a informação É o jogo, e uma máquina
   que espiasse `matches.solution` ganharia na segunda rodada sem que ninguém
   entendesse por quê — indistinguível de um bug, e pior, indistinguível de um
   adversário bom.

   ENTÃO O TESTE CENTRAL DESTE BLOCO É DE HONESTIDADE, e ele é forte:

     nenhuma carta que a máquina RISCOU pode estar no envelope.

   `dedu.fora` é a lista do que ela concluiu não estar no envelope. Se uma carta
   do envelope aparecer ali, ou ela espiou, ou a dedução dela está errada — e as
   duas coisas precisam quebrar o teste. É a mesma checagem que pega trapaça e
   pega bug de inferência, o que é exatamente o que se quer de uma invariante.

   E a segunda ponta: QUANDO ELA ACUSA, ELA ACERTA. Ela só acusa quando sobrou um
   candidato em cada categoria; se a inferência tiver furo, ela acusa errado e
   vira fantasma. Uma acusação errada da máquina é a prova de que a dedução
   mentiu.
   ══════════════════════════════════════════════════════════════════════════ */

console.log("\n  ── o cérebro da máquina ──");

/**
 * Joga uma partida solo do Dossiê até o fim, ou até o teto de passos.
 *
 * O humano é PASSIVO: anda quando pode, palpita quando está numa sala, e nunca
 * acusa. Passivo porque o que se mede é a máquina — e nunca acusar significa que
 * quem fecha o caso, se alguém fechar, é ela.
 *
 * A cada passo, o `dedu` de cada máquina é conferido contra o envelope de
 * verdade (que o teste conhece pela conexão direta, e a máquina não).
 */
async function dossieSolo({ token, niveis, tetoPassos }) {
  const salaS = (await rpc(token, "create_room", { p_game: "dossie" })).body;
  for (const n of niveis) {
    const r = await rpc(token, "adicionar_bot", { p_room: salaS.id, p_nivel: n });
    if (r.status !== 200) return { erro: `adicionar_bot(${n}): ${JSON.stringify(r.body)}` };
  }
  const ini = await rpc(token, "dossie_start", { p_room: salaS.id });
  if (ini.status !== 200) return { erro: `dossie_start: ${JSON.stringify(ini.body)}` };

  const idP = (
    await db.query(
      "select id, solution from matches where room_id = $1 order by started_at desc limit 1",
      [salaS.id],
    )
  ).rows[0];
  const envelope = [idP.solution.suspect, idP.solution.weapon, idP.solution.room];

  const elenco = (
    await db.query(
      `select mp.seat, mp.user_id, p.is_bot, p.display_name
         from match_players mp join profiles p on p.id = mp.user_id
        where mp.match_id = $1 order by mp.seat`,
      [idP.id],
    )
  ).rows;
  const meu = Number(elenco.find((e) => !e.is_bot).seat);
  const bots = elenco.filter((e) => e.is_bot);

  const tema = (
    await db.query(
      `select gt.data d from game_themes gt join matches m on gt.id = (m.public_state ->> 'theme')
        where m.id = $1`,
      [idP.id],
    )
  ).rows[0].d;

  const problemas = [];
  const passos = [];
  let n = 0;
  let acabou = false;
  let semNada = 0;

  /** A checagem de honestidade, rodada a cada passo. */
  async function conferirDeducao() {
    for (const b of bots) {
      const priv = (
        await db.query(
          "select data from match_private_state where match_id = $1 and user_id = $2",
          [idP.id, b.user_id],
        )
      ).rows[0]?.data;
      const fora = priv?.dedu?.fora ?? [];
      const vazou = fora.filter((c) => envelope.includes(c));
      if (vazou.length) {
        problemas.push(
          `${b.display_name} riscou ${vazou.join(", ")}, que está NO ENVELOPE` +
            ` — ela espiou ou a dedução está errada`,
        );
        return false;
      }
      // e o estado privado dela não pode conter o envelope de nenhuma forma
      if (priv && JSON.stringify(priv).includes(idP.solution.room) && !fora.length) {
        // a sala pode aparecer legitimamente em `mostrei`/`hand`? não: se está no
        // envelope, ninguém tem a carta. Mas pode aparecer em posições do mapa,
        // que é outra coisa — por isso a checagem forte é a de `fora` acima.
      }
      if (priv?.solution !== undefined) {
        problemas.push(`${b.display_name} tem 'solution' no estado privado`);
        return false;
      }
    }
    return true;
  }

  while (n < tetoPassos) {
    const linha = (
      await db.query("select status, public_state from matches where id = $1", [idP.id])
    ).rows[0];
    const st = linha.public_state;
    if (linha.status !== "running") {
      acabou = true;
      break;
    }
    /* A CONFERÊNCIA DE HONESTIDADE roda a cada oito passos, e não a cada um.
       Ela custa duas consultas por máquina, o que TRIPLICAVA o tráfego da
       partida inteira e fazia a suíte passar de quinze minutos — e suíte que
       demora quinze minutos é suíte que se deixa de rodar antes de commitar.

       Oito passos é menos de um turno completo: se a máquina riscar carta do
       envelope, a janela pega. E o estado final é conferido sempre. */
    if (n % 8 === 0 && !(await conferirDeducao())) break;

    /* Pela conexão DIRETA, e não pelo HTTP — ver o comentário igual na suíte da
       Metrópole. Aqui a diferença é maior: a partida do Dossiê tem 400 passos. */
    let passo = null;
    try {
      passo = (await db.query("select public.dossie_bot_passo($1::uuid) p", [idP.id])).rows[0].p;
    } catch (e) {
      problemas.push(`dossie_bot_passo: ${String(e).slice(0, 200)}`);
      break;
    }
    if (passo) {
      passos.push(passo);
      semNada = 0;
      n++;
      continue;
    }

    semNada++;
    if (semNada > 3) {
      problemas.push(
        `ninguém tem o que fazer na fase ${st.phase} (vez do assento ${st.turnSeat})`,
      );
      break;
    }

    // é a vez do humano passivo, ou ele tem de refutar
    if (st.phase === "refute" && st.pending) {
      const naVez = st.pending.queue[st.pending.at];
      if (Number(naVez) !== meu) {
        problemas.push(`fase de refutação parada no assento ${naVez}, que não é meu`);
        break;
      }
      const priv = (
        await db.query(
          "select data from match_private_state where match_id = $1 and user_id = $2",
          [idP.id, elenco.find((e) => !e.is_bot).user_id],
        )
      ).rows[0].data;
      const tem = (priv.hand ?? []).find((c) => st.pending.guess.includes(c));
      if (tem) await rpc(token, "dossie_refute", { p_match: idP.id, p_card: tem });
      else await rpc(token, "dossie_pass_refute", { p_match: idP.id });
      semNada = 0;
      n++;
      continue;
    }

    if (Number(st.turnSeat) !== meu) {
      problemas.push(
        `a vez é do assento ${st.turnSeat}, que é máquina, e dossie_tocar não fez nada` +
          ` · fase ${st.phase} · pending ${JSON.stringify(st.pending)}`,
      );
      break;
    }

    // o humano passivo: palpita onde está, ou anda
    const aqui = st.positions[String(meu)];
    if (st.actionsLeft >= 1 && aqui) {
      const sus = tema.suspects[n % tema.suspects.length].id;
      const arm = tema.weapons[n % tema.weapons.length].id;
      const r = await rpc(token, "dossie_suggest", {
        p_match: idP.id,
        p_suspect: sus,
        p_weapon: arm,
      });
      if (r.status !== 200) {
        const viz = (tema.adjacency[aqui] ?? [])[0];
        if (viz) await rpc(token, "dossie_move", { p_match: idP.id, p_room: viz });
        else await rpc(token, "dossie_end_turn", { p_match: idP.id });
      }
      semNada = 0;
      n++;
      continue;
    }
    const fim = await rpc(token, "dossie_end_turn", { p_match: idP.id });
    if (fim.status !== 200) {
      problemas.push(`humano não passou a vez: ${JSON.stringify(fim.body).slice(0, 130)}`);
      break;
    }
    semNada = 0;
    n++;
  }

  // e no fim, sempre
  await conferirDeducao();

  const fim = (
    await db.query("select status, public_state from matches where id = $1", [idP.id])
  ).rows[0];
  const dedus = {};
  for (const b of bots) {
    const priv = (
      await db.query(
        "select data from match_private_state where match_id = $1 and user_id = $2",
        [idP.id, b.user_id],
      )
    ).rows[0]?.data;
    dedus[b.display_name] = (priv?.dedu?.fora ?? []).length;
  }
  return {
    id: idP.id,
    envelope,
    meu,
    bots,
    tema,
    passos,
    n,
    acabou,
    problemas,
    st: fim.public_state,
    status: fim.status,
    dedus,
  };
}

/* ── 1. a recusa ─────────────────────────────────────────────────────────── */

const salaR = (await rpc(P[0].token, "create_room", { p_game: "dossie" })).body;
await rpc(P[0].token, "adicionar_bot", { p_room: salaR.id, p_nivel: "dificil" });
await rpc(P[0].token, "adicionar_bot", { p_room: salaR.id, p_nivel: "facil" });
const iniR = await rpc(P[0].token, "dossie_start", { p_room: salaR.id });
ok(
  iniR.status === 200,
  `partida solo de Dossiê começa com duas máquinas${iniR.status !== 200 ? " " + JSON.stringify(iniR.body).slice(0, 130) : ""}`,
);
const idR = (
  await db.query(
    "select id from matches where room_id = $1 order by started_at desc limit 1",
    [salaR.id],
  )
).rows[0]?.id;
const foraR = await rpc(P[2].token, "dossie_tocar", { p_match: idR });
ok(
  /NOT_A_PLAYER/.test(JSON.stringify(foraR.body)),
  "quem não está na mesa não toca a máquina de ninguém",
);

/* ── 2. UMA PARTIDA SOLO INTEIRA, com a honestidade conferida a cada passo ── */

const solo = await dossieSolo({
  token: P[0].token,
  niveis: ["dificil", "medio"],
  /* 400 e não 600: a partida termina em ~135 passos nas medições, e o teto é
     folga contra travamento — não orçamento. Cada passo do humano é um
     round-trip HTTP, e suíte que demora é suíte que se deixa de rodar. */
  tetoPassos: 400,
});
ok(!solo.erro, `a partida solo montou${solo.erro ? ": " + solo.erro : ""}`);
if (!solo.erro) {
  ok(
    solo.problemas.length === 0,
    solo.problemas.length === 0
      ? `${solo.n} passos, e nenhuma máquina riscou carta do envelope — ela deduz, não espia`
      : `TRAPAÇA OU DEDUÇÃO ERRADA: ${solo.problemas[0]}`,
  );
  console.log(`         envelope: ${solo.envelope.join(", ")}`);
  console.log(`         primeiros passos: ${solo.passos.slice(0, 8).join(" · ")}`);
  console.log(
    `         cartas riscadas no fim: ${Object.entries(solo.dedus)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")}`,
  );

  const tipos = new Set(solo.passos.map((p) => p.split(/[:(]/)[0]));
  ok(
    tipos.has("palpita"),
    `a máquina palpitou (tipos de passo: ${[...tipos].join(", ")})`,
  );
  ok(tipos.has("refuta"), "e refutou quando tinha a carta");
  ok(tipos.has("anda"), "e andou pelo mapa em vez de ficar parada");

  /* QUANDO ELA ACUSA, ELA ACERTA. Se a inferência tiver furo, ela acusa errado
     e vira fantasma — e uma acusação errada da máquina é a prova de que a
     dedução mentiu. */
  const acusacoes = solo.passos.filter((p) => p.startsWith("acusa"));
  const erradas = (solo.st.log ?? []).filter(
    (l) => l.type === "accuse" && l.right === false && solo.bots.some((b) => Number(b.seat) === Number(l.seat)),
  );
  ok(
    erradas.length === 0,
    erradas.length === 0
      ? acusacoes.length
        ? `e acusou ${acusacoes.length} vez(es), sempre certo: ${acusacoes[0]}`
        : "e não acusou nenhuma vez — ela não chuta"
      : `ACUSOU ERRADO ${erradas.length} vez(es): a dedução mentiu`,
  );
  ok(
    solo.acabou || solo.n >= 300,
    solo.acabou
      ? `a partida acabou (vencedor ${solo.st.winner ?? "nenhum"})`
      : `a partida rodou ${solo.n} passos sem travar`,
  );
}

/* ── 2b. a faxina JOGA a máquina ──────────────────────────────

   No Dossiê o prejuízo de pular a máquina é pior que nos outros: quem não refuta
   quando tem a carta MENTE para a mesa inteira, e todo mundo deduz errado a
   partir dali. */

const salaG = (await rpc(P[0].token, "create_room", { p_game: "dossie" })).body;
await rpc(P[0].token, "adicionar_bot", { p_room: salaG.id, p_nivel: "medio" });
await rpc(P[0].token, "adicionar_bot", { p_room: salaG.id, p_nivel: "dificil" });
await rpc(P[0].token, "dossie_start", { p_room: salaG.id });
const idG = (
  await db.query(
    "select id from matches where room_id = $1 order by started_at desc limit 1",
    [salaG.id],
  )
).rows[0].id;
const botG = Number(
  (
    await db.query(
      `select mp.seat from match_players mp join profiles p on p.id = mp.user_id
        where mp.match_id = $1 and p.is_bot order by mp.seat limit 1`,
      [idG],
    )
  ).rows[0].seat,
);
/* A FOTO VEM ANTES DE ESTOURAR O RELÓGIO — ver o comentário igual na suíte do
   Domínio. Aqui é mais urgente: `dossie_sweep()` roda a cada DEZ SEGUNDOS. */
const antesG = Number(
  (
    await db.query(
      "select jsonb_array_length(coalesce(public_state -> 'log', '[]'::jsonb)) n from matches where id = $1",
      [idG],
    )
  ).rows[0].n,
);

await db.query(
  `update matches set
     public_state = jsonb_set(jsonb_set(public_state, '{turnSeat}', to_jsonb($2::int)),
       '{phase}', '\"turn\"'),
     turn_deadline = now() - interval '1 second'
   where id = $1`,
  [idG, botG],
);
/* A faxina só age em mesa com gente por perto (0071), então o teste diz que há
   gente — que é a verdade que ele está simulando. `last_seen_at` nasce em `now()`,
   mas uma suíte longa pode passar dos quinze minutos, e teste que reprova por
   ter demorado é teste que ensina a ignorar a saída vermelha. */
await rpc(P[0].token, "touch_presence", { p_room: salaG.id });

await varre("dossie_sweep");
const depoisG = (
  await db.query(
    `select jsonb_array_length(coalesce(public_state -> 'log', '[]'::jsonb)) n,
            (public_state ->> 'turnSeat')::int t, public_state ->> 'phase' fase, status
       from matches where id = $1`,
    [idG],
  )
).rows[0];
ok(
  Number(depoisG.n) > antesG,
  `a faxina JOGOU o turno da máquina (registro foi de ${antesG} para ${depoisG.n} linhas)`,
);
/* A VEZ NÃO PRECISA SAIR DELA, e a primeira versão desta asserção não sabia
   disso. No Dossiê, quem palpita CONTINUA sendo o `turnSeat` enquanto a fila de
   refutação anda — a vez só passa depois que todo mundo respondeu. Então a
   máquina jogar e a fase virar `refute` é exatamente o resultado certo.

   O que se cobra é que ela NÃO tenha ficado parada esperando: ou a vez andou, ou
   ela palpitou e a mesa está respondendo. */
ok(
  Number(depoisG.t) !== botG || depoisG.fase === "refute" || depoisG.status !== "running",
  `e ela não ficou parada: vez ${botG} → ${depoisG.t}, fase ${depoisG.fase}`,
);

/* ── 2c. no fim, quanto cada máquina já sabia ─────────────────────

   Jogando com gente, "eu estava perto?" se responde sozinha — a mesa comenta.
   Sozinho, o caso fecha em silêncio. Então a máquina conta, DEPOIS que a partida
   acabou, e conta só o número.

   O teste guarda as duas coisas: que ela conta, e que ela não conta antes nem
   conta demais. */

// `iniR` é a RESPOSTA de `dossie_start`, e `idR` é o id da partida. Passar a
// resposta como id fazia o RPC recusar por outro motivo e o teste dizer a coisa
// certa pelo motivo errado — que é pior que reprovar.
const rodandoAinda = (
  await rpc(P[0].token, "dossie_deducoes", { p_match: idR })
).body;
ok(
  /MATCH_NOT_FINISHED/.test(JSON.stringify(rodandoAinda)),
  "com a partida rolando, quanto a máquina já sabe NÃO sai — isso é informação de jogo",
);

if (solo.acabou) {
  const deFora2 = (await rpc(P[2].token, "dossie_deducoes", { p_match: solo.id })).body;
  ok(
    /NOT_A_PLAYER/.test(JSON.stringify(deFora2)),
    "e quem não estava na mesa não lê o caderno de ninguém",
  );

  const dedu = (await rpc(P[0].token, "dossie_deducoes", { p_match: solo.id })).body;
  ok(
    Array.isArray(dedu?.maquinas) && dedu.maquinas.length === solo.bots.length,
    `com a partida encerrada, as ${solo.bots.length} máquinas contam quanto sabiam: ${(dedu?.maquinas ?? [])
      .map((m) => `${m.nome}=${m.riscadas}`)
      .join(", ")}`,
  );
  ok(
    (dedu?.maquinas ?? []).every((m) => Number(m.riscadas) > 0),
    "e cada uma tinha riscado alguma coisa — zero seria uma máquina que não deduziu nada",
  );

  /* A LINHA QUE NÃO PODE SER CRUZADA: sai a CONTAGEM, nunca a lista. A regra
     "o estado privado de um jogador é dele" não pode ter exceção por
     conveniência — a primeira exceção é a que ensina a fazer a segunda. */
  const texto = JSON.stringify(dedu);
  const cartasDoCaso = [
    ...solo.tema.suspects.map((x) => x.id),
    ...solo.tema.weapons.map((x) => x.id),
    ...solo.tema.rooms.map((x) => x.id),
  ];
  ok(
    !cartasDoCaso.some((c) => texto.includes(c)),
    "e nenhuma CARTA aparece na resposta: sai o número, nunca a lista",
  );

  const soMaquinas = (dedu?.maquinas ?? []).map((m) => Number(m.seat));
  ok(
    !soMaquinas.includes(solo.meu),
    "e gente não entra na conta nem depois do fim — o bloco de anotações de uma pessoa é dela",
  );
}

/* ── 3. o nível é o quanto ela infere ───────────────────────────

   A tranquila usa só o que está na cara: a própria mão e o que mostraram a ela.
   A firme cruza os "passou". A impiedosa cruza tudo — restrições abertas e o
   "ninguém refutou".

   ESTE TESTE JÁ COMPAROU DUAS PARTIDAS e reprovou por sorte: mediu 17 contra 13
   numa rodada e 9 contra 10 noutra. Em 260 passos, uma máquina que recebe uma
   mão grande e vê muita carta mostrada pode ter riscado mais que a impiedosa
   sem inferir nada — e aí o número mede a sorte da distribuição, não o nível.

   É a mesma lição do Domínio (0062) e da Metrópole (0055), pela quarta vez:
   confere-se a decisão ONDE ELA MORA. Aqui dá para fazer melhor que nos outros
   dois, porque a dedução é uma função PURA da informação disponível: a MESMA
   mão, a MESMA mesa, o MESMO registro, deduzidos nos três níveis. A única coisa
   que muda é o quanto ela cruza — e é exatamente isso que se quer medir. */

/* A MEDIDA É NUMA PARTIDA CURTA, e a razão é o registro.

   `dossie_log` guarda 80 linhas. Numa partida de 135 passos, refazer a dedução
   do zero lê um registro JÁ TRUNCADO — e aí os três níveis chegam ao mesmo
   lugar por falta de material, não por serem iguais. Foi o que a primeira
   versão deste teste mediu: 11, 11, 11.

   No jogo de verdade isso não acontece, porque a máquina deduz a cada turno e
   guarda o que aprendeu — ela nunca relê o registro inteiro. O teste é que
   precisa de uma partida onde a janela ainda cabe. */
const curta = await dossieSolo({
  token: P[0].token,
  niveis: ["medio", "dificil"],
  tetoPassos: 55,
});

if (!curta.erro && curta.bots.length > 0) {
  const cobaia = curta.bots[0];
  const solo = curta;
  const nivelOriginal = (
    await db.query(
      `select rm.bot_nivel n from room_members rm
        join matches m on m.room_id = rm.room_id
       where m.id = $1 and rm.user_id = $2`,
      [solo.id, cobaia.user_id],
    )
  ).rows[0]?.n;

  const riscadasCom = {};
  const abertasCom = {};
  for (const nivel of ["facil", "medio", "dificil"]) {
    await db.query(
      `update room_members rm set bot_nivel = $3
         from matches m
        where m.id = $1 and rm.room_id = m.room_id and rm.user_id = $2`,
      [solo.id, cobaia.user_id, nivel],
    );
    // o caderno começa em branco: senão o nível seguinte herda o anterior
    await db.query(
      "update match_private_state set data = data - 'dedu' where match_id = $1 and user_id = $2",
      [solo.id, cobaia.user_id],
    );
    await db.query("select public.dossie_deduz($1::uuid, $2::smallint)", [
      solo.id,
      Number(cobaia.seat),
    ]);
    abertasCom[nivel] = (
      (
        await db.query(
          "select data -> 'dedu' -> 'abertos' a from match_private_state where match_id = $1 and user_id = $2",
          [solo.id, cobaia.user_id],
        )
      ).rows[0]?.a ?? []
    ).length;
    riscadasCom[nivel] = (
      (
        await db.query(
          "select data -> 'dedu' -> 'fora' f from match_private_state where match_id = $1 and user_id = $2",
          [solo.id, cobaia.user_id],
        )
      ).rows[0]?.f ?? []
    ).length;
  }

  if (nivelOriginal) {
    await db.query(
      `update room_members rm set bot_nivel = $3
         from matches m
        where m.id = $1 and rm.room_id = m.room_id and rm.user_id = $2`,
      [solo.id, cobaia.user_id, nivelOriginal],
    );
  }

  /* O QUE SE MEDE É O MECANISMO, e não o resultado numa amostra.

     `fora` é o que ela JÁ CONCLUIU; `abertos` é o que ela está CRUZANDO. Uma
     restrição ("fulano tem uma destas três") só vira carta riscada quando duas
     das três caem por outro caminho — e numa partida curta isso pode
     simplesmente ainda não ter acontecido. Medido: 10, 10, 10 riscadas e 0, 3, 4
     restrições abertas.

     Então `fora` responde "ela chegou lá?", que depende da partida, e `abertos`
     responde "ela está cruzando?", que é exatamente o que o nível define. A
     segunda pergunta é a do teste; a primeira vira relatório.

     E a prova de que o cruzamento CHEGA a algum lugar já está na partida solo lá
     em cima: a máquina acusa, e acusar exige um candidato único em cada
     categoria. */
  ok(
    abertasCom.facil === 0,
    `a tranquila não cruza nada: ${abertasCom.facil} restrições abertas — ela usa só o que está na cara`,
  );
  ok(
    abertasCom.medio > 0 && abertasCom.dificil >= abertasCom.medio,
    `e a escada é de verdade: firme cruza ${abertasCom.medio} restrições, impiedosa ${abertasCom.dificil}` +
      " — a diferença das duas é o «ninguém refutou», a jogada mais forte do jogo",
  );
  ok(
    riscadasCom.facil <= riscadasCom.medio && riscadasCom.medio <= riscadasCom.dificil,
    `e cruzar nunca risca MENOS: ${riscadasCom.facil}, ${riscadasCom.medio}, ${riscadasCom.dificil} cartas`,
  );
  console.log(
    `         (0085 consertou o firme, que anotava os «passou» e jogava fora o resultado:` +
      " cruzar era exclusivo do impiedoso, e o intermediário pagava o custo sem o benefício)",
  );
}

/* ── 4. ela não dá informação de graça ─────────────────────────────

   Regra de mesa do Dossiê: quando você tem duas cartas do palpite, mostre de
   novo a que já mostrou àquela pessoa. Cada carta nova revelada é informação de
   graça para quem perguntou.

   A PRIMEIRA VERSÃO DESTE TESTE PERGUNTOU ERRADO: contou quantas cartas
   diferentes cada máquina mostrou para a mesma pessoa e reclamou quando passavam
   de duas. Não é a regra — quem tem seis cartas e recebe seis palpites
   diferentes mostra seis cartas diferentes, e está certa, porque só se pode
   mostrar carta que está no palpite.

   A pergunta certa é: HAVIA ESCOLHA, e uma das opções já tinha sido mostrada a
   essa pessoa? Então tinha de ser aquela. É para responder isso que 0060 fez o
   caderno da máquina anotar o palpite e o que ela tinha na mão na hora. */

const cadernos = (
  await db.query(
    `select p.display_name, mps.data -> 'mostrei' m
       from match_private_state mps join profiles p on p.id = mps.user_id
      where mps.match_id = $1 and p.is_bot and mps.data ? 'mostrei'`,
    [solo.id],
  )
).rows;

const comOpcao = [];
const deuDeGraca = [];
for (const c of cadernos) {
  const jaMostrei = {};   // pessoa -> Set de cartas
  for (const x of c.m ?? []) {
    const tinha = x.tinha ?? [];
    const vistas = jaMostrei[x.para] ?? new Set();
    if (tinha.length >= 2) {
      comOpcao.push(`${c.display_name} tinha ${tinha.length} opções`);
      const repetivel = tinha.filter((t) => vistas.has(t));
      if (repetivel.length > 0 && !repetivel.includes(x.card)) {
        deuDeGraca.push(
          `${c.display_name} mostrou ${x.card} a ${x.para} podendo repetir ${repetivel.join("/")}`,
        );
      }
    }
    vistas.add(x.card);
    jaMostrei[x.para] = vistas;
  }
}

if (comOpcao.length === 0) {
  console.log(
    "         (nenhuma refutação com duas opções na mão: o caso de repetir não foi exercitado)",
  );
} else {
  ok(
    deuDeGraca.length === 0,
    deuDeGraca.length === 0
      ? `em ${comOpcao.length} refutação(ões) com escolha, ela repetiu o que já tinha mostrado — informação de graça é o que faz perder`
      : `deu informação de graça: ${deuDeGraca[0]}`,
  );
}

/* ── 5. ela nunca viu o envelope ───────────────────────────────

   A checagem por dentro: nenhuma função do cérebro pode ler `matches.solution`.
   É uma linha de teste, e ela vale mais que qualquer comentário prometendo que
   não lê — porque ela continua valendo quando alguém mexer no cérebro depois. */

const espiando = (
  await db.query(`
    select p.proname nome
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like 'dossie\\_bot%' or p.proname in ('dossie_deduz', 'dossie_candidatos'))
       and pg_get_functiondef(p.oid) ~ '\\msolution'
     order by 1`)
).rows.map((r) => r.nome);
ok(
  espiando.length === 0,
  espiando.length === 0
    ? "nenhuma função do cérebro toca em `solution` — ela deduz porque não tem outro jeito"
    : `O CÉREBRO LÊ O ENVELOPE: ${espiando.join(", ")}`,
);

for (const p of P) await admin(`/admin/users/${p.id}`, { method: "DELETE" });
await db.end();

console.log(falhas === 0 ? "\nTudo passou." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
