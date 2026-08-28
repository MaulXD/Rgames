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
/* POR QUE POOL E NÃO CLIENT.

   Um `pg.Client` é UMA conexão, aberta no começo e mantida até o fim. Quando
   ela cai — e ela cai, porque estas suítes passam minutos entre consultas —, o
   `pg` emite `error` num objeto sem ouvinte e o Node derruba o processo:

       Error: Connection terminated unexpectedly
       Emitted 'error' event on Client instance

   A suíte fica vermelha por causa da rede, que é o pior vermelho que existe: o
   que ensina a olhar para a saída e pensar "ah, deve ser aquilo".

   O Pool abre conexão sob demanda e devolve ao fim de cada consulta — uma que
   morreu enquanto ninguém a usava simplesmente não volta, e a próxima consulta
   abre outra. `keepAlive` é o cinto: impede que um NAT ou proxy no caminho
   desligue por ociosidade, que é a causa mais provável.

   Nada aqui depende de sessão: sem `set local`, sem tabela temporária, sem
   trava consultiva. A API de `query` e `end` é a mesma. */
const db = new pg.Pool({ connectionString: conn.toString(), max: 4, keepAlive: true });
/* Sem `connect()`: no Pool ele reserva uma conexão que precisa ser devolvida,
   e descartar o retorno segura uma das quatro pela partida inteira. O Pool
   abre sozinho na primeira consulta. */

/* UMA REPETIÇÃO QUANDO A CONEXÃO CAI, e só quando ela cai.

   O Pool já resolveu a conexão que morre OCIOSA — a próxima consulta abre
   outra. O que ele não resolve é a que morre NO MEIO de uma consulta, e essas
   suítes provocam isso: a do Dossiê joga duas partidas solo inteiras, centenas
   de ida e volta ao Supabase, e uma delas leva "Connection terminated
   unexpectedly" a cada poucas centenas.

   O estrago não era o passo perdido. Era a MENSAGEM: o laço solo reporta
   qualquer erro como "TRAPAÇA OU DEDUÇÃO ERRADA", e uma queda de TCP saía
   escrita como acusação de trapaça da máquina. Saída que mente sobre a causa é
   pior que saída nenhuma — ela manda consertar o que não está quebrado.

   UMA repetição, e não um laço: se a segunda também cair, o problema não é
   blip de rede e o teste tem de ficar vermelho mesmo. Retentativa sem teto
   transforma banco fora do ar em suíte que trava. */
const CONEXAO_CAIU = /Connection terminated|ECONNRESET|socket hang up|Client has encountered/i;
const consultaCrua = db.query.bind(db);
db.query = async (...args) => {
  try {
    return await consultaCrua(...args);
  } catch (e) {
    if (!CONEXAO_CAIU.test(e?.message ?? "")) throw e;
    return await consultaCrua(...args);
  }
};

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

  /* A FILA TEM DOIS, e este ramo passava só o primeiro.

     A checagem logo abaixo — "a vez passou depois da refutação" — só vale
     quando a fase sai de `refute`, e com um dos dois ainda por responder ela
     não sai. O teste passava ou reprovava conforme a MÃO SORTEADA: quando o
     primeiro da fila tinha carta, a refutação encerrava o pendente e tudo
     seguia; quando não tinha, sobrava um na fila e a vez continuava a mesma.

     Reprovar por sorte do baralho é a mesma doença de reprovar por sorte do
     dado, e o remédio é o mesmo: esvaziar a fila antes de conferir o que só vale
     com ela vazia. */
  for (let i = 0; i < P.length + 1; i++) {
    const agora = (
      await get(eu.token, `matches?select=public_state&id=eq.${partida.id}`)
    ).body[0].public_state;
    if (agora.phase !== "refute" || !agora.pending) break;
    const naVez = agora.pending.queue[agora.pending.at];
    const dono = P[hands.findIndex((h) => h.seat === naVez)];
    if (!dono) break;
    const mao = hands.find((h) => h.seat === naVez)?.hand ?? [];
    const tem = agora.pending.guess.find((c) => mao.includes(c));
    if (tem) await rpc(dono.token, "dossie_refute", { p_match: partida.id, p_card: tem });
    else await rpc(dono.token, "dossie_pass_refute", { p_match: partida.id });
  }
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
  const cartasDoCaso = [
    ...solo.tema.suspects.map((x) => x.id),
    ...solo.tema.weapons.map((x) => x.id),
    ...solo.tema.rooms.map((x) => x.id),
  ];

  /* A primeira versão desta checagem procurava id de carta no JSON INTEIRO, e
     reprovava quando o caso sorteado era o Meridiano-9: a Casa de máquinas tem
     id `maquinas`, e a resposta tem a chave `maquinas`. Um teste que reprova
     por causa do próprio envelope ensina a ignorar a saída vermelha.

     A versão certa é mais dura, e não menos: confere a FORMA (nenhuma chave
     além das três previstas, em nenhum nível) e só depois procura carta nos
     VALORES. Chave nova reprova, carta vazada reprova, e o nome de uma sala
     coincidir com o de um campo não reprova nada. */
  /* `total` é quantas cartas existem fora do envelope — a escala que dá sentido ao
     número de riscadas ("14 de 18" quer dizer algo, "14" não). É uma contagem, e
     contagem é exatamente o que esta resposta pode devolver.

     A lista precisou crescer, e crescer é o comportamento certo: a checagem de
     FORMA existe para obrigar uma decisão consciente quando um campo novo
     aparece, e não para congelar a função. Se `total` fosse uma lista de cartas
     em vez de um número, ela teria pegado. */
  const formaOk =
    Object.keys(dedu ?? {}).every((k) => k === "maquinas" || k === "total") &&
    (dedu?.maquinas ?? []).every((m) =>
      Object.keys(m).every((k) => ["seat", "nome", "riscadas"].includes(k)),
    );
  const valores = (dedu?.maquinas ?? [])
    .flatMap((m) => Object.values(m).map(String))
    .join(" | ");
  const vazadas = cartasDoCaso.filter((c) => valores.includes(c));
  ok(
    formaOk && vazadas.length === 0,
    !formaOk
      ? `a resposta ganhou campo que ninguém previu: ${JSON.stringify(Object.keys(dedu ?? {}))}`
      : vazadas.length === 0
        ? "e nenhuma CARTA aparece nos valores da resposta: sai o número, nunca a lista"
        : `VAZOU CARTA: ${vazadas.join(", ")}`,
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

/* ── O MOTOR NÃO SABE O QUE É UMA BIBLIOTECA ────────────────────────

   É a promessa central do sistema de temas (PRD 07 §1), e a que sustenta todas
   as outras: "adicionar um tema é conteúdo, não engenharia". Ela vale enquanto
   nenhuma função do motor souber o nome de um lugar, de um suspeito ou de um
   objeto — e é o tipo de promessa que apodrece em silêncio: um \`if sala =
   'biblioteca'\` escrito às pressas para consertar um caso funciona, passa em
   todo teste, e quebra o próximo tema.

   A varredura pega todos os ids dos QUATRO casos publicados e procura cada um,
   como literal entre aspas, no corpo de toda função \`dossie_*\`. Ela não depende
   de eu lembrar de conferir: um caso novo traz ids novos, e eles entram na busca
   sozinhos. */

console.log("DOSSIÊ: o motor não sabe o que é uma biblioteca");

const idsDosCasos = new Set(
  (
    await db.query(
      `select value ->> 'id' id
         from game_themes gt,
              lateral jsonb_array_elements(
                (gt.data -> 'suspects') || (gt.data -> 'weapons') || (gt.data -> 'rooms')
              )
        where gt.game_key = 'dossie'`,
    )
  ).rows.map((r) => r.id),
);

const corpos = (
  await db.query(
    `select p.proname nome, pg_get_functiondef(p.oid) corpo
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'dossie\_%'`,
  )
).rows;

/* O QUE CONTA COMO "SABER O NOME": o id aparecer onde o motor DECIDE alguma
   coisa com ele — comparado, indexado, ou dentro de uma lista.

   Procurar o literal solto acusou `dossie_deducoes` de conhecer a Casa de
   máquinas do Meridiano-9, porque a sala tem id `maquinas` e a resposta tem a
   chave `'maquinas'`. É a segunda vez que esse id colide nesta suíte (a
   primeira derrubou a checagem de vazamento), e a lição é a mesma: um id de
   conteúdo pode ser igual a uma palavra do vocabulário do motor, e a busca tem
   de olhar o CONTEXTO em vez do texto.

   Uma chave de `jsonb_build_object` é `'maquinas', <valor>`. Um id cravado é
   `= 'biblioteca'`, `-> 'biblioteca'` ou `array['biblioteca'`. São formas
   diferentes, e só a segunda é o defeito. */
const CONTEXTOS = ["= '", "<> '", "-> '", "->> '", "array['", "in ('", ", '"];
const cravados = [];
for (const f of corpos) {
  for (const id of idsDosCasos) {
    for (const ctx of CONTEXTOS.slice(0, 6)) {
      if (f.corpo.includes(`${ctx}${id}'`)) {
        cravados.push(`${id} em ${f.nome} (como \`${ctx}${id}'\`)`);
        break;
      }
    }
  }
}
ok(
  cravados.length === 0,
  cravados.length === 0
    ? `nenhuma das ${corpos.length} funções do Dossiê cita um dos ${idsDosCasos.size} ids dos quatro casos`
    : `O MOTOR APRENDEU UM NOME: ${cravados.join(", ")}`,
);

/* E QUEM NÃO JOGA NÃO RECEBE MÃO NENHUMA.

   A primeira versão deste teste usou `P[2]` como espectador, e `P[2]` é o
   terceiro JOGADOR desta partida — ele leu uma mão, a dele, corretamente. Uma
   asserção sobre "de fora" precisa de alguém que esteja de fora. */
const forasteiro = await player(`dos-fora-${stamp}@mesa.invalid`);
const maosDoForasteiro = await get(
  forasteiro.token,
  `match_private_state?select=data&match_id=eq.${partida.id}`,
);
ok(
  Array.isArray(maosDoForasteiro.body) && maosDoForasteiro.body.length === 0,
  Array.isArray(maosDoForasteiro.body) && maosDoForasteiro.body.length === 0
    ? "quem não joga esta partida não lê mão nenhuma — e ler a mão dos outros por outra aba" +
      " seria a trapaça mais barata que existe"
    : `alguém de fora leu ${maosDoForasteiro.body?.length} mão(s)`,
);
await admin(`/admin/users/${forasteiro.id}`, { method: "DELETE" });

/* ── 6. AS REVIRAVOLTAS ────────────────────────────────────────

   Cada caso carrega exatamente uma regra própria (PRD 03 §6.7). Elas são a
   mecânica que o sistema de temas entrega, e a razão pela qual jogar a Boate
   Aurora não é jogar o Solar das Acácias com outra roupa.

   Cada uma é conferida ONDE ELA MORA — na função que decide —, e não na média
   de uma partida. É a lição que este projeto pagou quatro vezes: teste que
   reprova por sorte do dado ensina a ignorar a saída vermelha. */

console.log("\nDOSSIÊ: as reviravoltas\n");

/* 6a. O par da tempestade NUNCA desconecta o mapa.

   Não é "sorteei dez vezes e deu certo": é a enumeração completa. Para cada um
   dos quatro casos, TODO par que a função pode devolver mantém o mapa conexo, e
   existe pelo menos um par que ela recusa — senão a checagem seria decorativa. */

const casos4 = (
  await db.query("select id, data from game_themes where game_key = 'dossie' order by id")
).rows;

let paresRuins = 0;
let recusados = 0;
for (const t of casos4) {
  const lugares = t.data.rooms.map((r) => r.id);
  for (let i = 0; i < lugares.length; i++) {
    for (let j = i + 1; j < lugares.length; j++) {
      const conexo = (
        await db.query("select public.dossie_conexo_sem($1::jsonb, $2, $3) c", [
          JSON.stringify(t.data),
          lugares[i],
          lugares[j],
        ])
      ).rows[0].c;
      if (!conexo) recusados++;
    }
  }
  /* E o que a função REALMENTE devolve, em vinte sementes diferentes. */
  for (let s = 0; s < 20; s++) {
    const par = (
      await db.query("select public.dossie_par_da_tempestade($1::jsonb, $2::bigint) p", [
        JSON.stringify(t.data),
        s * 7919 + 13,
      ])
    ).rows[0].p;
    if (!par || par.length !== 2) {
      paresRuins++;
      continue;
    }
    const conexo = (
      await db.query("select public.dossie_conexo_sem($1::jsonb, $2, $3) c", [
        JSON.stringify(t.data),
        par[0],
        par[1],
      ])
    ).rows[0].c;
    if (!conexo) paresRuins++;
  }
}

ok(
  paresRuins === 0,
  paresRuins === 0
    ? `a tempestade sorteou 80 pares nos quatro mapas e nenhum desconectou o mapa`
    : `${paresRuins} par(es) sorteado(s) deixariam um lugar inalcançável`,
);
ok(
  recusados > 0,
  recusados > 0
    ? `e a checagem tem dentes: dos 144 pares possíveis, ${recusados} são recusados por desconectar` +
      " — fechar o Poço e o Mirante isola a Câmara Selada"
    : "NENHUM par foi recusado em nenhum mapa: a checagem de conexidade não está checando nada",
);

/* 6b. O APAGÃO APAGA QUEM, NUNCA O QUÊ.

   As três consequências, medidas numa partida de verdade:
     · o log diz que alguém desmentiu, sem dizer quem
     · o estado privado de quem palpitou grava a carta com `from: null`
     · e o caderno de dedução NÃO atribui a carta a ninguém

   A terceira é a que importa. A comparação `mp.seat is distinct from null` é
   VERDADE para todo assento — sem a guarda, uma carta mostrada no escuro
   marcaria a mesa inteira como não tendo a carta, INCLUSIVE quem mostrou. Não é
   perder informação: é inventar informação falsa, que se propaga, e termina em
   máquina acusando com certeza uma carta que está na mão de alguém. */

const salaA = (await rpc(P[0].token, "create_room", { p_game: "dossie" })).body;
await rpc(P[0].token, "set_room_settings", {
  p_room: salaA.id,
  p_settings: { tema: "boate-aurora" },
});
await rpc(P[0].token, "adicionar_bot", { p_room: salaA.id, p_nivel: "dificil" });
await rpc(P[0].token, "adicionar_bot", { p_room: salaA.id, p_nivel: "dificil" });
const iniA = await rpc(P[0].token, "dossie_start", { p_room: salaA.id });
ok(iniA.status === 200, `a Boate Aurora começou${iniA.status === 200 ? "" : ": " + JSON.stringify(iniA.body)}`);

if (iniA.status === 200) {
  const mA = (
    await db.query(
      "select id, public_state st from matches where room_id = $1 order by started_at desc limit 1",
      [salaA.id],
    )
  ).rows[0];

  ok(
    mA.st.twist?.id === "apagao",
    `o caso trouxe a reviravolta dele: ${mA.st.twist?.id ?? "nenhuma"}`,
  );
  ok(
    mA.st.twist?.round >= 4 && mA.st.twist?.round <= 8,
    `e a rodada do apagão foi sorteada entre a 4 e a 8 (saiu ${mA.st.twist?.round}) — sorteada`
      + " AGORA e guardada, senão 'uma vez por partida' viraria 'toda rodada, com 20% de chance'",
  );

  /* Acende o apagão à força e faz uma refutação acontecer dentro dele. Forçar é
     o certo aqui: esperar a rodada sorteada chegar mediria o sorteio, que já foi
     medido na linha de cima — o que se quer medir agora é o EFEITO. */
  await db.query(
    `update matches set public_state =
        public.jsonb_poe(public_state, 'twist', 'active', 'true'::jsonb)
      where id = $1`,
    [mA.id],
  );

  const elencoA = (
    await db.query(
      `select mp.seat, mp.user_id, p.is_bot from match_players mp
         join profiles p on p.id = mp.user_id
        where mp.match_id = $1 order by mp.seat`,
      [mA.id],
    )
  ).rows;
  const humanoA = elencoA.find((e) => !e.is_bot);

  /* Palpita com uma carta que outro assento comprovadamente tem, para que a
     refutação aconteça de verdade em vez de virar "ninguém refutou". */
  const maos = {};
  for (const e of elencoA) {
    maos[e.seat] = (
      await db.query(
        "select data -> 'hand' h from match_private_state where match_id = $1 and user_id = $2",
        [mA.id, e.user_id],
      )
    ).rows[0].h;
  }
  const temaA = (
    await db.query("select data from game_themes where id = 'boate-aurora'")
  ).rows[0].data;
  const suspIds = temaA.suspects.map((s) => s.id);
  const armaIds = temaA.weapons.map((w) => w.id);

  const outro = elencoA.find((e) => e.is_bot);
  const cartaDele = maos[outro.seat].find(
    (c) => suspIds.includes(c) || armaIds.includes(c),
  );

  const antesLog = (mA.st.log ?? []).length;
  await db.query(
    `update matches set public_state = public_state
       || jsonb_build_object('turnSeat', $2::int, 'phase', 'turn', 'actionsLeft', 2)
      where id = $1`,
    [mA.id, humanoA.seat],
  );
  const palp = await rpc(P[0].token, "dossie_suggest", {
    p_match: mA.id,
    p_suspect: suspIds.includes(cartaDele) ? cartaDele : suspIds[0],
    p_weapon: armaIds.includes(cartaDele) ? cartaDele : armaIds[0],
  });
  ok(palp.status === 200, `palpite feito no escuro${palp.status === 200 ? "" : ": " + JSON.stringify(palp.body)}`);

  /* A máquina refuta. `dossie_bot_passo` e não `dossie_tocar`: o segundo é a
     porta do cliente e exige sessão — daqui, pela conexão de serviço,
     `auth.uid()` é nulo e ele levanta NOT_AUTHENTICATED, com razão. O que se
     quer medir é o passo da máquina, e ele mora no de dentro. */
  for (let i = 0; i < 4; i++) {
    const st = (await db.query("select public_state st from matches where id = $1", [mA.id]))
      .rows[0].st;
    if (st.phase !== "refute") break;
    await db.query("select public.dossie_bot_passo($1::uuid)", [mA.id]);
  }

  const depois = (await db.query("select public_state st from matches where id = $1", [mA.id]))
    .rows[0].st;
  const refutacoes = (depois.log ?? []).slice(antesLog).filter((l) => l.type === "refute");

  ok(
    refutacoes.length > 0 && refutacoes.every((l) => l.seat === null && l.anon === true),
    refutacoes.length === 0
      ? "ninguém refutou — o teste não chegou a medir o apagão"
      : refutacoes.every((l) => l.seat === null)
        ? `no escuro o log diz que alguém desmentiu, e não diz quem (${refutacoes.length} refutação)`
        : `O LOG ENTREGOU QUEM MOSTROU: ${JSON.stringify(refutacoes[0])}`,
  );

  const seenA = (
    await db.query(
      "select data -> 'seen' s from match_private_state where match_id = $1 and user_id = $2",
      [mA.id, humanoA.user_id],
    )
  ).rows[0].s;
  const ultima = seenA[seenA.length - 1];
  ok(
    seenA.length > 0 && ultima.from === null && !!ultima.card,
    ultima
      ? ultima.from === null
        ? `e quem palpitou recebeu a CARTA (${ultima.card}) sem o dono — que é a metade que decide`
        : `o dono vazou para o estado privado: from=${ultima.from}`
      : "nada chegou ao estado privado de quem palpitou",
  );

  /* E o caderno: a carta sai do envelope, e NINGUÉM é marcado como não tendo. */
  await db.query("update match_private_state set data = data - 'dedu' where match_id = $1", [
    mA.id,
  ]);
  const deduA = (
    await db.query("select public.dossie_deduz($1::uuid, $2::smallint) d", [
      mA.id,
      Number(humanoA.seat),
    ])
  ).rows[0].d;

  const cartaEscura = ultima?.card;
  const minhaMao = maos[humanoA.seat] ?? [];
  const atribuida = Object.entries(deduA.naoTem ?? {}).filter(
    ([, cs]) => cs.includes(cartaEscura),
  );
  ok(
    (deduA.fora ?? []).includes(cartaEscura),
    `a carta mostrada no escuro saiu do envelope (${cartaEscura}) — o apagão nunca tira isso de você`,
  );
  ok(
    minhaMao.includes(cartaEscura) || atribuida.length === 0,
    atribuida.length === 0
      ? "e o caderno não atribuiu a carta a ninguém: sem dono, não há conjunto atribuído"
      : `O CADERNO INVENTOU DONO no escuro: ${atribuida.length} assento(s) marcados como não tendo ${cartaEscura}`,
  );
}

/* 6c. A TEMPESTADE FECHA OS DOIS LADOS DA PORTA.

   "Ninguém entra e ninguém sai" são duas checagens, não uma: conferir só o
   destino deixaria quem está preso escapar no primeiro turno.

   E quem está preso continua PALPITANDO — é o que faz de um lugar fechado uma
   posição, não uma punição (PRD 03 §3). */

const salaT = (await rpc(P[0].token, "create_room", { p_game: "dossie" })).body;
await rpc(P[0].token, "set_room_settings", { p_room: salaT.id, p_settings: { tema: "ras-zamir" } });
await rpc(P[0].token, "adicionar_bot", { p_room: salaT.id, p_nivel: "medio" });
await rpc(P[0].token, "adicionar_bot", { p_room: salaT.id, p_nivel: "medio" });
const iniT = await rpc(P[0].token, "dossie_start", { p_room: salaT.id });

if (iniT.status === 200) {
  const mT = (
    await db.query(
      "select id, public_state st from matches where room_id = $1 order by started_at desc limit 1",
      [salaT.id],
    )
  ).rows[0];
  ok(mT.st.twist?.id === "tempestade", `Ras Zamir trouxe a Tempestade de Areia`);

  const meuT = Number(
    (
      await db.query(
        `select mp.seat from match_players mp join profiles p on p.id = mp.user_id
          where mp.match_id = $1 and not p.is_bot`,
        [mT.id],
      )
    ).rows[0].seat,
  );

  const temaT = (await db.query("select data from game_themes where id = 'ras-zamir'")).rows[0]
    .data;

  /* Põe o humano num lugar, fecha ESSE lugar e um vizinho alcançável. */
  const aqui = "conservacao";
  const vizinho = temaT.adjacency[aqui][0];
  const outroVizinho = temaT.adjacency[aqui].find((v) => v !== vizinho);

  await db.query(
    `update matches set public_state =
        jsonb_set(public_state, array['positions', $2], to_jsonb($3::text))
          || jsonb_build_object('turnSeat', $4::int, 'phase', 'turn', 'actionsLeft', 2)
      where id = $1`,
    [mT.id, String(meuT), aqui, meuT],
  );
  await db.query(
    `update matches set public_state =
        public.jsonb_poe(public_state, 'twist', 'fechados', $2::jsonb) where id = $1`,
    [mT.id, JSON.stringify([aqui, vizinho])],
  );

  const saida = await rpc(P[0].token, "dossie_move", { p_match: mT.id, p_room: outroVizinho });
  ok(
    saida.status >= 400 && /ROOM_CLOSED/.test(JSON.stringify(saida.body)),
    saida.status >= 400
      ? "quem está num lugar fechado NÃO SAI — a porta fecha dos dois lados"
      : "o preso saiu andando: a checagem só olhava o destino",
  );

  /* E de fora ninguém entra: põe o humano fora e manda entrar. */
  await db.query(
    `update matches set public_state =
        jsonb_set(public_state, array['positions', $2], to_jsonb($3::text))
          || jsonb_build_object('turnSeat', $4::int, 'phase', 'turn', 'actionsLeft', 2)
      where id = $1`,
    [mT.id, String(meuT), outroVizinho, meuT],
  );
  const entrada = await rpc(P[0].token, "dossie_move", { p_match: mT.id, p_room: aqui });
  ok(
    entrada.status >= 400 && /ROOM_CLOSED/.test(JSON.stringify(entrada.body)),
    entrada.status >= 400 ? "e de fora ninguém entra" : "entrou num lugar fechado",
  );

  /* Preso, mas palpitando. */
  await db.query(
    `update matches set public_state =
        jsonb_set(public_state, array['positions', $2], to_jsonb($3::text))
          || jsonb_build_object('turnSeat', $4::int, 'phase', 'turn', 'actionsLeft', 2)
      where id = $1`,
    [mT.id, String(meuT), aqui, meuT],
  );
  /* Quem JÁ estava no lugar fechado não conta: o sorteio inicial de posições
     põe gente em qualquer lugar, e a primeira versão deste teste reprovou por
     isso — acusou de "arrastado" um peão que estava lá desde o começo. O que se
     mede é MOVIMENTO para dentro, então o antes tem de ser guardado. */
  const antesDoPalpite = (
    await db.query("select public_state -> 'positions' p from matches where id = $1", [mT.id])
  ).rows[0].p;

  const palpT = await rpc(P[0].token, "dossie_suggest", {
    p_match: mT.id,
    p_suspect: temaT.suspects[0].id,
    p_weapon: temaT.weapons[0].id,
  });
  ok(
    palpT.status === 200,
    palpT.status === 200
      ? "mas continua palpitando de dentro — lugar fechado é posição, não punição"
      : `o preso não pôde palpitar: ${JSON.stringify(palpT.body)}`,
  );

  /* E o palpite NÃO arrastou ninguém para dentro. Sem isso, quem fica preso
     puxa a mesa inteira, um palpite por vez, e a rodada vira armadilha
     coletiva — o oposto do que a regra quer. */
  if (palpT.status === 200) {
    const stT = (await db.query("select public_state st from matches where id = $1", [mT.id]))
      .rows[0].st;
    const arrastados = Object.entries(stT.positions).filter(
      ([s, r]) => Number(s) !== meuT && r === aqui && antesDoPalpite[s] !== aqui,
    );
    ok(
      arrastados.length === 0,
      arrastados.length === 0
        ? "e o palpite não arrastou ninguém para dentro do lugar fechado"
        : `O PALPITE VIROU PORTA DOS FUNDOS: ${arrastados.length} peão(ões) puxados para dentro`,
    );
  }
}

/* 6c-bis. E A MÁQUINA PRESA JOGA A POSIÇÃO, em vez de só sofrer.

   A regra normal do cérebro é "não gaste turno palpitando num lugar que você já
   riscou". Presa, ela se inverte, porque a alternativa mudou: solta, a escolha
   é entre palpitar num lugar riscado e ANDAR até um que importa; presa, é entre
   palpitar num lugar riscado e NÃO FAZER NADA.

   O teste força exatamente esse caso: risca o lugar no caderno dela, tranca ela
   dentro dele, e confere que o passo é um palpite. Sem 0092 ele era "passa". */

if (iniT.status === 200) {
  const mT2 = (
    await db.query(
      "select id from matches where room_id = $1 order by started_at desc limit 1",
      [salaT.id],
    )
  ).rows[0];
  const botT = (
    await db.query(
      `select mp.seat, mp.user_id from match_players mp join profiles p on p.id = mp.user_id
        where mp.match_id = $1 and p.is_bot order by mp.seat limit 1`,
      [mT2.id],
    )
  ).rows[0];

  const cela = "cozinha";
  await db.query(
    `update matches set public_state =
        jsonb_set(public_state, array['positions', $2], to_jsonb($3::text))
          || jsonb_build_object('turnSeat', $4::int, 'phase', 'turn', 'actionsLeft', 2, 'pending', null)
      where id = $1`,
    [mT2.id, String(botT.seat), cela, Number(botT.seat)],
  );
  await db.query(
    `update matches set public_state =
        public.jsonb_poe(public_state, 'twist', 'fechados', $2::jsonb) where id = $1`,
    [mT2.id, JSON.stringify([cela])],
  );
  // e o lugar já está riscado no caderno dela: sem isso, ela palpitaria de qualquer jeito
  await db.query(
    `update match_private_state
        set data = public.jsonb_poe(coalesce(data, '{}'::jsonb), 'dedu', 'fora',
              coalesce(data -> 'dedu' -> 'fora', '[]'::jsonb) || to_jsonb($3::text))
      where match_id = $1 and user_id = $2`,
    [mT2.id, botT.user_id, cela],
  );

  const passo = (
    await db.query("select public.dossie_bot_passo($1::uuid) p", [mT2.id])
  ).rows[0].p;
  ok(
    (passo ?? "").startsWith("palpita"),
    (passo ?? "").startsWith("palpita")
      ? `presa num lugar que ela já riscou, a máquina PALPITA (${passo}) — palpitar nunca é nada,`
        + " e passar a vez era deixar a reviravolta ser só castigo"
      : `a máquina presa não jogou a posição: ${passo}`,
  );
}

/* 6d. O REGISTRO PUBLICA UM FATO VERDADEIRO, e o mais útil que houver.

   Duas propriedades, e as duas são da POLÍTICA, não do sorteio:
     · a carta publicada nunca está no envelope (senão a estação mente)
     · entre as de fora, sai a que mais gente ainda não riscou */

const salaReg = (await rpc(P[0].token, "create_room", { p_game: "dossie" })).body;
await rpc(P[0].token, "set_room_settings", {
  p_room: salaReg.id,
  p_settings: { tema: "meridiano-9" },
});
await rpc(P[0].token, "adicionar_bot", { p_room: salaReg.id, p_nivel: "medio" });
await rpc(P[0].token, "adicionar_bot", { p_room: salaReg.id, p_nivel: "medio" });
const iniR2 = await rpc(P[0].token, "dossie_start", { p_room: salaReg.id });

if (iniR2.status === 200) {
  const mR = (
    await db.query(
      "select id, solution, public_state st from matches where room_id = $1 order by started_at desc limit 1",
      [salaReg.id],
    )
  ).rows[0];
  ok(mR.st.twist?.id === "registro", "Meridiano-9 trouxe o Registro da Estação");

  const envR = [mR.solution.suspect, mR.solution.weapon, mR.solution.room];

  /* Publica dez fatos seguidos, cada um sabendo dos anteriores. Nenhum pode
     estar no envelope, e nenhum pode repetir. */
  const publicados = [];
  let mentiu = null;
  let repetiu = null;
  for (let i = 0; i < 10; i++) {
    const f = (
      await db.query("select public.dossie_fato_do_registro($1::uuid, $2::text[]) f", [
        mR.id,
        publicados,
      ])
    ).rows[0].f;
    if (f === null) break;
    if (envR.includes(f)) mentiu = f;
    if (publicados.includes(f)) repetiu = f;
    publicados.push(f);
  }

  ok(
    mentiu === null && publicados.length > 0,
    mentiu === null
      ? `NÚBIA publicou ${publicados.length} fatos e nenhum estava no envelope — o registro não mente`
      : `A ESTAÇÃO MENTIU: publicou ${mentiu}, que está no envelope`,
  );
  ok(repetiu === null, repetiu === null ? "e nunca repetiu um fato já publicado" : `repetiu ${repetiu}`);

  /* A POLÍTICA: entre as de fora, sai a que mais gente ainda não riscou. Risca
     uma carta no caderno de TODO mundo e ela deixa de ser a escolhida. */
  const primeira = publicados[0];
  if (primeira) {
    /* `jsonb_poe` e não `jsonb_set` de dois níveis. Pela QUINTA vez nesta base:
       `create_missing` cria só o ÚLTIMO elemento do caminho, e sobre um pai
       ausente `jsonb_set(data, '{dedu,fora}', …)` devolve `data` INTACTO, em
       silêncio.

       Aqui o `dedu` de todo mundo está ausente — a partida acabou de começar e
       ninguém deduziu nada ainda. O update não riscava carta nenhuma, e o teste
       reprovava a função por republicar uma carta que ninguém tinha riscado.

       Repare na direção do erro: a armadilha fez o teste REPROVAR código certo.
       Foi sorte — quatro das cinco vezes ela aprovou código errado. */
    await db.query(
      `update match_private_state
          set data = public.jsonb_poe(coalesce(data, '{}'::jsonb), 'dedu', 'fora',
                coalesce(data -> 'dedu' -> 'fora', '[]'::jsonb) || to_jsonb($2::text))
        where match_id = $1`,
      [mR.id, primeira],
    );
    const depoisDeRiscar = (
      await db.query("select public.dossie_fato_do_registro($1::uuid, '{}'::text[]) f", [mR.id])
    ).rows[0].f;
    ok(
      depoisDeRiscar !== primeira,
      depoisDeRiscar !== primeira
        ? `e quando a mesa inteira já riscou uma carta, ela para de ser publicada` +
          ` (era ${primeira}, virou ${depoisDeRiscar}) — o fato sempre vale alguma coisa`
        : `publicou de novo ${primeira} depois de todo mundo já ter riscado: o fato não vale nada`,
    );
  }
}

/* 6e. DESLIGADA NAS REGRAS DA CASA, o caso roda como jogo limpo.

   PRD 03 §3.5: "quem quer o jogo limpo joga o jogo limpo, em qualquer caso". */

const salaL = (await rpc(P[0].token, "create_room", { p_game: "dossie" })).body;
const cfg = await rpc(P[0].token, "set_room_settings", {
  p_room: salaL.id,
  p_settings: { tema: "boate-aurora", reviravolta: false },
});
ok(
  cfg.status === 200,
  cfg.status === 200
    ? "a chave 'reviravolta' é aceita nas Regras da Casa"
    : `set_room_settings recusou a chave: ${JSON.stringify(cfg.body)}`,
);
await rpc(P[0].token, "adicionar_bot", { p_room: salaL.id, p_nivel: "medio" });
await rpc(P[0].token, "adicionar_bot", { p_room: salaL.id, p_nivel: "medio" });
const iniL = await rpc(P[0].token, "dossie_start", { p_room: salaL.id });

if (iniL.status === 200) {
  const stL = (
    await db.query(
      "select public_state st from matches where room_id = $1 order by started_at desc limit 1",
      [salaL.id],
    )
  ).rows[0].st;
  ok(
    stL.twist === null || stL.twist === undefined,
    stL.twist == null
      ? "desligada, a Boate Aurora começa sem reviravolta nenhuma — o jogo limpo, no mesmo mundo"
      : `a reviravolta entrou mesmo desligada: ${JSON.stringify(stL.twist)}`,
  );
}

/* 6f. A RODADA CONTA A VOLTA, e não os turnos.

   Com gente virando fantasma, "N turnos = uma rodada" está errado: o número de
   turnos por rodada muda quando alguém é eliminado. A rodada vira quando o turno
   DÁ A VOLTA, e é isso que se confere aqui. */

if (iniL.status === 200) {
  const mL = (
    await db.query(
      "select id, public_state st from matches where room_id = $1 order by started_at desc limit 1",
      [salaL.id],
    )
  ).rows[0];
  ok(mL.st.round === 1, `a partida começa na rodada ${mL.st.round}`);

  const assentos = (
    await db.query("select seat from match_players where match_id = $1 order by seat", [mL.id])
  ).rows.map((r) => Number(r.seat));

  // uma volta completa: passa a vez tantas vezes quantos assentos
  for (let i = 0; i < assentos.length; i++) {
    await db.query("select public.dossie_advance($1::uuid)", [mL.id]);
  }
  const rodadaDepois = (
    await db.query("select (public_state ->> 'round')::int r from matches where id = $1", [mL.id])
  ).rows[0].r;
  ok(
    rodadaDepois === 2,
    rodadaDepois === 2
      ? `depois de uma volta completa (${assentos.length} turnos), a rodada é a 2`
      : `a rodada virou ${rodadaDepois} depois de uma volta: o contador não conta a volta`,
  );
}

for (const p of P) await admin(`/admin/users/${p.id}`, { method: "DELETE" });
await db.end();

console.log(falhas === 0 ? "\nTudo passou." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
