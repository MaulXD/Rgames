#!/usr/bin/env node
/**
 * Metrópole — teste de fumaça.
 *
 * A parte que importa está no meio: as REGRAS DE ALUGUEL e a resolução da casa
 * onde você para. É onde mora a economia do jogo, é onde um erro não dá erro
 * (dá partida desequilibrada em silêncio), e é o que dá para testar com estado
 * montado à mão em vez de esperar a sorte do dado.
 *
 * A ordem é deliberada: primeiro as funções puras contra números conhecidos,
 * depois a partida de verdade pelo RPC, depois o leilão, depois as travas.
 *
 * Uso: npm run smoke:metropole
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { config } from "dotenv";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(root, ".env.local"), quiet: true });

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PG = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;

if (!URL_ || !ANON || !SVC || !PG) {
  console.error("faltam variáveis em .env.local");
  process.exit(1);
}

const db = new pg.Client({ connectionString: `${PG}&uselibpqcompat=true` });
await db.connect();

let falhas = 0;
function ok(cond, msg) {
  if (cond) console.log(`  ok     ${msg}`);
  else {
    falhas++;
    console.error(`  FALHA  ${msg}`);
  }
}

const CIDADE = JSON.parse(await readFile(join(root, "lib", "metropole", "cidade.json"), "utf8"));
const CASA = Object.fromEntries(CIDADE.casas.filter((c) => c.id).map((c) => [c.id, c]));

console.log("\nMetrópole — fumaça\n");
/** Reais, só para as mensagens deste teste. */
function reaisJs(n) {
  return `R$ ${Math.round(n).toLocaleString("pt-BR")}`;
}


/* ══════════════════════════════════════════════════════════════════════════
   1. ALUGUEL — as três regras de cálculo, contra números conhecidos
   ══════════════════════════════════════════════════════════════════════════ */

/** Um estado mínimo: ninguém tem nada, todos com o mesmo caixa. */
function estadoBase(donos = {}, extra = {}) {
  const props = {};
  for (const c of CIDADE.casas) {
    if (!c.id) continue;
    props[c.id] = {
      owner: donos[c.id] ?? null,
      casas: 0,
      hotel: false,
      hipotecada: false,
      ...(extra[c.id] ?? {}),
    };
  }
  return {
    map: "capibara",
    mode: "metropole",
    turnSeat: 0,
    phase: "acao",
    duplos: 0,
    players: {
      0: { cash: 10000, pos: 0, jail: 0, livras: 0, quebrado: false },
      1: { cash: 10000, pos: 0, jail: 0, livras: 0, quebrado: false },
      2: { cash: 10000, pos: 0, jail: 0, livras: 0, quebrado: false },
    },
    props,
    bank: { casas: 32, hoteis: 12 },
    cartas: { sorte: 0, reves: 0 },
    rolls: 0,
    seq: 0,
    log: [],
  };
}

async function aluguel(est, prop, soma = 7) {
  const r = await db.query(
    `select public.met_aluguel(gt.data, $1::jsonb, $2, $3) v
       from public.game_themes gt where gt.id = 'capibara'`,
    [JSON.stringify(est), prop, soma],
  );
  return Number(r.rows[0].v);
}

ok((await aluguel(estadoBase(), "ipanema")) === 0, "propriedade sem dono não cobra aluguel");

// Ipanema sozinha: aluguel base (verde tem três bairros)
let est = estadoBase({ ipanema: 1 });
ok(
  (await aluguel(est, "ipanema")) === CASA.ipanema.aluguel[0],
  `aluguel base de Ipanema é R$ ${CASA.ipanema.aluguel[0]}`,
);

// grupo verde inteiro: o base DOBRA
est = estadoBase({ ipanema: 1, "lago-sul": 1, "vila-nova": 1 });
ok(
  (await aluguel(est, "ipanema")) === CASA.ipanema.aluguel[0] * 2,
  `com o grupo verde inteiro, o base de Ipanema dobra para R$ ${CASA.ipanema.aluguel[0] * 2}`,
);

// hipotecada não cobra, mesmo com o grupo fechado
est = estadoBase({ ipanema: 1, "lago-sul": 1, "vila-nova": 1 }, { ipanema: { hipotecada: true } });
ok((await aluguel(est, "ipanema")) === 0, "propriedade hipotecada não cobra aluguel");

// a escada de casas, uma por uma
for (const n of [1, 2, 3, 4]) {
  est = estadoBase({ ipanema: 1, "lago-sul": 1, "vila-nova": 1 }, { ipanema: { casas: n } });
  const esperado = CASA.ipanema.aluguel[n];
  ok(
    (await aluguel(est, "ipanema")) === esperado,
    `Ipanema com ${n} casa(s) cobra R$ ${esperado}`,
  );
}
est = estadoBase({ ipanema: 1, "lago-sul": 1, "vila-nova": 1 }, { ipanema: { hotel: true } });
ok(
  (await aluguel(est, "ipanema")) === CASA.ipanema.aluguel[5],
  `Ipanema com hotel cobra R$ ${CASA.ipanema.aluguel[5]}`,
);

// transporte: a tabela depende de QUANTOS o dono tem
const TRANSP = ["congonhas", "santos", "luz", "rio-niteroi"];
for (const q of [1, 2, 3, 4]) {
  const donos = Object.fromEntries(TRANSP.slice(0, q).map((t) => [t, 1]));
  est = estadoBase(donos);
  const esperado = CASA.congonhas.aluguel[q - 1];
  ok(
    (await aluguel(est, "congonhas")) === esperado,
    `com ${q} transporte(s), cada um cobra R$ ${esperado}`,
  );
}

// companhia: múltiplo sobre a SOMA DOS DADOS
est = estadoBase({ energia: 1 });
ok((await aluguel(est, "energia", 7)) === 40 * 7, "uma companhia cobra 40× o dado (7 → R$ 280)");
est = estadoBase({ energia: 1, saneamento: 1 });
ok(
  (await aluguel(est, "energia", 7)) === 100 * 7,
  "as duas companhias cobram 100× o dado (7 → R$ 700)",
);
ok(
  (await aluguel(est, "energia", 12)) === 100 * 12,
  "e o valor acompanha o dado: 12 → R$ 1.200",
);

/* ══════════════════════════════════════════════════════════════════════════
   2. PATRIMÔNIO — a conta que decide a vitória
   ══════════════════════════════════════════════════════════════════════════ */

async function patrimonio(est, seat) {
  const r = await db.query(
    `select public.met_patrimonio(gt.data, $1::jsonb, $2::smallint) v
       from public.game_themes gt where gt.id = 'capibara'`,
    [JSON.stringify(est), seat],
  );
  return Number(r.rows[0].v);
}

ok((await patrimonio(estadoBase(), 0)) === 10000, "sem propriedades, patrimônio é só o caixa");

est = estadoBase({ ipanema: 0 });
ok(
  (await patrimonio(est, 0)) === 10000 + CASA.ipanema.preco,
  `com Ipanema, soma o preço (R$ ${10000 + CASA.ipanema.preco})`,
);

est = estadoBase({ ipanema: 0 }, { ipanema: { casas: 3 } });
ok(
  (await patrimonio(est, 0)) === 10000 + CASA.ipanema.preco + CASA.ipanema.casa * 3,
  "as construções entram pelo custo",
);

est = estadoBase({ ipanema: 0 }, { ipanema: { hotel: true } });
ok(
  (await patrimonio(est, 0)) === 10000 + CASA.ipanema.preco + CASA.ipanema.casa * 5,
  "hotel conta como cinco casas",
);

est = estadoBase({ ipanema: 0 }, { ipanema: { hipotecada: true } });
ok(
  (await patrimonio(est, 0)) === 10000 + CASA.ipanema.preco / 2,
  "hipotecada conta pela METADE — senão alavancar de graça premiaria hipotecar tudo no fim",
);

/* ══════════════════════════════════════════════════════════════════════════
   3. O BARALHO
   ══════════════════════════════════════════════════════════════════════════ */

for (const qual of ["sorte", "reves"]) {
  const r = await db.query(
    `select jsonb_agg(public.met_carta(gt.data, 777::bigint, $1, k) ->> 'texto') t
       from public.game_themes gt, generate_series(0, 15) k where gt.id = 'capibara'`,
    [qual],
  );
  const textos = r.rows[0].t;
  ok(textos.length === 16, `${qual}: 16 cartas na primeira volta`);
  ok(new Set(textos).size === 16, `${qual}: nenhuma carta repetida na primeira volta`);
}

/* ══════════════════════════════════════════════════════════════════════════
   4. A CASA ONDE VOCÊ PARA
   ══════════════════════════════════════════════════════════════════════════ */

async function pousa(est, seat = 0, soma = 7, seed = 777) {
  const r = await db.query(
    `select public.met_pousa(gt.data, $1::jsonb, $2::bigint, $3::smallint, $4, 0) v
       from public.game_themes gt where gt.id = 'capibara'`,
    [JSON.stringify(est), seed, seat, soma],
  );
  return r.rows[0].v;
}

// propriedade sem dono: a decisão fica pendente
est = estadoBase();
est.players[0].pos = 39; // Jardins
let depois = await pousa(est);
ok(
  depois.pendente?.k === "comprar" && depois.pendente.prop === "jardins",
  "parar em propriedade sem dono deixa a compra pendente",
);
ok(depois.phase === "resolve", "e tranca a fase em resolve");
ok(depois.pendente.preco === CASA.jardins.preco, `com o preço certo (R$ ${CASA.jardins.preco})`);

// propriedade sua: nada acontece
est = estadoBase({ jardins: 0 });
est.players[0].pos = 39;
depois = await pousa(est);
ok(
  (depois.pendente ?? null) === null && depois.players[0].cash === 10000,
  "parar em propriedade sua não cobra nada e não pede nada",
);

// propriedade de outro: aluguel debitado, e o dinheiro APARECE no outro
est = estadoBase({ jardins: 1 });
est.players[0].pos = 39;
depois = await pousa(est);
const alug = CASA.jardins.aluguel[0];
ok(
  depois.players[0].cash === 10000 - alug && depois.players[1].cash === 10000 + alug,
  `aluguel de R$ ${alug} sai de um e entra no outro`,
);
ok(
  depois.players[0].cash + depois.players[1].cash + depois.players[2].cash === 30000,
  "o dinheiro total da mesa não muda numa transferência entre jogadores",
);

// imposto: o dinheiro SAI do jogo
est = estadoBase();
est.players[0].pos = 4; // Imposto de Renda
depois = await pousa(est);
ok(depois.players[0].cash === 10000 - 2000, "Imposto de Renda debita R$ 2.000");
ok(
  depois.players[0].cash + depois.players[1].cash + depois.players[2].cash === 28000,
  "imposto tira dinheiro do jogo — e é isso que faz a partida ter fim",
);

// vá para a cadeia
est = estadoBase();
est.players[0].pos = 30;
depois = await pousa(est);
ok(depois.players[0].pos === 10 && depois.players[0].jail === 1, "a casa 30 prende de verdade");

// dívida: caixa negativo, pendência de dívida, fase travada
est = estadoBase({ jardins: 1 }, { jardins: { hotel: true } });
est.players[0].cash = 100;
est.players[0].pos = 39;
depois = await pousa(est);
ok(depois.players[0].cash < 0, `aluguel de hotel deixou o caixa em ${depois.players[0].cash}`);
ok(depois.pendente?.k === "divida", "e virou pendência de dívida");
ok(
  depois.players[1].cash === 10000 + CASA.jardins.aluguel[5],
  "o credor recebeu o valor CHEIO — a dívida é do devedor, não do credor",
);
ok(
  Array.isArray(depois.devedores) && depois.devedores.includes(0),
  "e o devedor entrou na lista pública de devedores",
);

// a mesma dívida, mas de quem NÃO está na vez: não tranca a fase alheia
est = estadoBase({ jardins: 2 }, { jardins: { hotel: true } });
est.turnSeat = 1;
est.players[1].cash = 100;
est.players[1].pos = 39;
depois = await pousa(est, 1);
ok(depois.players[1].cash < 0, "quem parou ficou negativo");
ok(depois.phase === "resolve", "a fase trancou porque quem devia ERA o da vez");

est = estadoBase();
est.turnSeat = 0;
est.players[1].cash = 100;
// carta "pague a cada jogador" cobrada de quem não está na vez: monta na mão
// o efeito equivalente chamando met_paga direto
const r0 = await db.query(
  `select public.met_paga($1::jsonb, 1::smallint, 0::smallint, 5000, 'teste') v`,
  [JSON.stringify(est)],
);
ok(
  r0.rows[0].v.phase === "acao",
  "dívida de quem NÃO está na vez não sequestra a fase do turno alheio",
);
ok(r0.rows[0].v.devedores.includes(1), "mas ele entra na lista de devedores");

/* ══════════════════════════════════════════════════════════════════════════
   5. UMA PARTIDA DE VERDADE
   ══════════════════════════════════════════════════════════════════════════ */

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

const stamp = Date.now();
const P = [
  await player(`met-a-${stamp}@mesa.invalid`),
  await player(`met-b-${stamp}@mesa.invalid`),
  await player(`met-c-${stamp}@mesa.invalid`),
];
ok(P.every((p) => p.token), "três jogadores autenticados");

const sala = (await rpc(P[0].token, "create_room", { p_game: "metropole" })).body;
ok(!!sala?.id, `sala ${sala?.code} criada`);

const sozinho = await rpc(P[0].token, "met_start", { p_room: sala.id });
ok(
  /NEED_TWO/.test(JSON.stringify(sozinho.body)),
  "com um jogador só, a Metrópole não começa",
);

await rpc(P[1].token, "join_room", { p_code: sala.code });
await rpc(P[2].token, "join_room", { p_code: sala.code });

const naoHost = await rpc(P[1].token, "met_start", { p_room: sala.id });
ok(/NOT_HOST/.test(JSON.stringify(naoHost.body)), "quem não é anfitrião não começa");

const inicio = await rpc(P[0].token, "met_start", { p_room: sala.id });
const partida = inicio.body;
ok(
  inicio.status === 200 && !!partida?.public_state,
  `met_start criou a partida${inicio.status !== 200 ? ` (${JSON.stringify(inicio.body).slice(0, 160)})` : ""}`,
);

if (partida?.public_state) {
  let st = partida.public_state;
  ok(Object.keys(st.props).length === 28, `28 propriedades no estado (${Object.keys(st.props).length})`);
  ok(
    Object.values(st.players).every((p) => p.cash === 15000),
    "todos começam com R$ 15.000",
  );
  ok(st.bank.casas === 32 && st.bank.hoteis === 12, "o banco começa com 32 casas e 12 hotéis");

  const comDono = Object.entries(st.props).filter(([, v]) => v.owner !== null);
  ok(
    comDono.length === 9,
    `o sorteio inicial distribuiu 3 por jogador (${comDono.length} de 28) — a negociação começa antes do primeiro dado`,
  );
  const porJogador = [0, 1, 2].map((s) => comDono.filter(([, v]) => v.owner === s).length);
  ok(
    porJogador.every((n) => n === 3),
    `e distribuiu igual: ${porJogador.join(", ")}`,
  );
  ok(st.phase === "rolar", "a partida começa na fase de rolar");

  // quem não é da vez não rola
  const daVez = async () => {
    const e = (await db.query("select public_state from matches where id = $1", [partida.id]))
      .rows[0].public_state;
    const dono = (
      await db.query("select user_id from match_players where match_id = $1 and seat = $2", [
        partida.id,
        e.turnSeat,
      ])
    ).rows[0].user_id;
    return { est: e, jogador: P.find((x) => x.id === dono) };
  };

  let { est: e1, jogador } = await daVez();
  const outro = P.find((p) => p.id !== jogador.id);
  const fora = await rpc(outro.token, "met_roll", { p_match: partida.id });
  ok(/NOT_YOUR_TURN/.test(JSON.stringify(fora.body)), "quem não é da vez não rola o dado");

  const semRolar = await rpc(jogador.token, "met_end_turn", { p_match: partida.id });
  ok(
    /ROLL_FIRST/.test(JSON.stringify(semRolar.body)),
    "ninguém passa a vez sem jogar o dado",
  );

  const posAntes = e1.players[e1.turnSeat].pos;
  const rolou = await rpc(jogador.token, "met_roll", { p_match: partida.id });
  ok(rolou.status === 200, `rolou (${JSON.stringify(rolou.body).slice(0, 90)})`);
  st = rolou.body.public_state;
  ok(
    Array.isArray(st.dados) && st.dados.length === 2 && st.dados.every((d) => d >= 1 && d <= 6),
    `os dois dados saíram de 1 a 6 (${st.dados})`,
  );
  /* A POSIÇÃO FINAL PODE NÃO SER pos + dados, e isso é CERTO: o dado te leva a
     uma casa, e a casa pode te levar a outra. Uma carta de Sorte manda para o
     Leblon, "Vá para a Cadeia" manda para a 10, "volte três casas" anda de
     novo. A primeira versão deste teste comparava a posição final com a soma
     dos dados e falhava em duas de cada cinco execuções — não porque o motor
     erra, mas porque a asserção estava incompleta.

     O que se compara é a casa registrada pelo DADO, que `met_roll` grava no
     log antes de resolver a casa. Essa sim é sempre pos + dados. */
  const linhaAnda = (st.log ?? []).find((l) => l.k === "anda");
  ok(!!linhaAnda, "a rolagem foi registrada");
  if (linhaAnda) {
    ok(
      linhaAnda.para === (posAntes + linhaAnda.d[0] + linhaAnda.d[1]) % 40,
      `o dado levou exatamente a soma: ${posAntes} + ${linhaAnda.d[0]}+${linhaAnda.d[1]} = casa ${linhaAnda.para}`,
    );
    const fim = st.players[e1.turnSeat].pos;
    if (fim !== linhaAnda.para) {
      ok(
        true,
        `e a casa ${linhaAnda.para} mandou o peão para a ${fim} — carta ou cadeia, e é assim que tem de ser`,
      );
    }
  }

  /* ── leilão ─────────────────────────────────────────────────────────── */

  // arma o cenário: o da vez para numa propriedade sem dono, e recusa
  const semDono = Object.entries(st.props).find(([, v]) => v.owner === null)[0];
  const posSemDono = CASA[semDono].pos;
  await db.query(
    `update matches set public_state =
       jsonb_set(jsonb_set(public_state, array['players', $2, 'pos'], $3::jsonb),
                 '{phase}', '"resolve"')
       || jsonb_build_object('pendente', jsonb_build_object(
            'k', 'comprar', 'prop', $4::text, 'preco', $5::int))
      where id = $1`,
    [partida.id, String(st.turnSeat), String(posSemDono), semDono, CASA[semDono].preco],
  );

  const recusou = await rpc(jogador.token, "met_decline", { p_match: partida.id });
  ok(recusou.status === 200, "recusar a compra abre o leilão");
  st = recusou.body.public_state;
  ok(st.phase === "leilao" && st.leilao?.prop === semDono, `${semDono} está em leilão`);
  ok(st.leilao.alto === 0 && st.leilao.altoSeat === null, "o leilão abre sem lance");

  const baixo = await rpc(outro.token, "met_bid", { p_match: partida.id, p_valor: 50 });
  ok(
    /BID_TOO_LOW/.test(JSON.stringify(baixo.body)),
    `lance abaixo do mínimo de R$ ${CIDADE.regras.lanceMinimo} é recusado`,
  );

  const lance1 = await rpc(outro.token, "met_bid", { p_match: partida.id, p_valor: 300 });
  ok(lance1.status === 200, "quem NÃO está na vez dá lance — é o turno alheio com decisão");
  st = lance1.body.public_state;
  ok(st.leilao.alto === 300, "o lance foi registrado");

  const igual = await rpc(jogador.token, "met_bid", { p_match: partida.id, p_valor: 300 });
  ok(/BID_TOO_LOW/.test(JSON.stringify(igual.body)), "lance igual ao atual não vale");

  const lance2 = await rpc(jogador.token, "met_bid", { p_match: partida.id, p_valor: 400 });
  ok(lance2.status === 200, "quem recusou a compra TAMBÉM pode dar lance");
  ok(lance2.body.public_state.leilao.passou.length === 0, "um lance novo reabre para todos");

  const terceiro = P.find((p) => p.id !== jogador.id && p.id !== outro.id);
  await rpc(terceiro.token, "met_pass", { p_match: partida.id });
  const fechou = await rpc(outro.token, "met_pass", { p_match: partida.id });
  st = fechou.body.public_state;
  ok(
    st.phase !== "leilao" && st.props[semDono].owner !== null,
    `quando todos passam, o leilão fecha e ${semDono} tem dono`,
  );
  ok(
    st.leilao === null,
    "e o leilão sai do estado",
  );

  /* ── construir ──────────────────────────────────────────────────────── */

  // dá o grupo azul-escuro inteiro ao da vez, com caixa
  const seatVez = st.turnSeat;
  await db.query(
    `update matches set public_state =
       jsonb_set(
         jsonb_set(
           jsonb_set(public_state, array['props','leblon','owner'], $2::jsonb),
           array['props','jardins','owner'], $2::jsonb),
         array['players', $3, 'cash'], '60000'::jsonb)
       || jsonb_build_object('phase', 'acao'::text)
       || jsonb_build_object('pendente', null)
      where id = $1`,
    [partida.id, String(seatVez), String(seatVez)],
  );
  const donoAzul = (await daVez()).jogador;

  const incompleto = await rpc(donoAzul.token, "met_build", {
    p_match: partida.id,
    p_prop: "ipanema",
    p_n: 1,
  });
  ok(
    /NOT_YOURS|GROUP_INCOMPLETE/.test(JSON.stringify(incompleto.body)),
    "não se constrói em grupo que não é seu inteiro",
  );

  const c1 = await rpc(donoAzul.token, "met_build", {
    p_match: partida.id,
    p_prop: "leblon",
    p_n: 1,
  });
  ok(c1.status === 200, `construiu 1 casa no Leblon (${JSON.stringify(c1.body).slice(0, 80)})`);
  st = c1.body.public_state;
  ok(st.props.leblon.casas === 1, "a casa apareceu na propriedade");
  ok(st.bank.casas === 31, `e saiu do banco (${st.bank.casas} restantes)`);

  const torto = await rpc(donoAzul.token, "met_build", {
    p_match: partida.id,
    p_prop: "leblon",
    p_n: 1,
  });
  ok(
    /BUILD_UNEVEN/.test(JSON.stringify(torto.body)),
    "construção par: não dá para empilhar no Leblon deixando Jardins vazio",
  );

  await rpc(donoAzul.token, "met_build", { p_match: partida.id, p_prop: "jardins", p_n: 1 });
  const ate5 = await rpc(donoAzul.token, "met_build", {
    p_match: partida.id,
    p_prop: "leblon",
    p_n: 4,
  });
  ok(
    /BUILD_UNEVEN/.test(JSON.stringify(ate5.body)),
    "e nem quatro de uma vez fura a regra da construção par",
  );

  // sobe os dois juntos até o hotel
  for (let i = 0; i < 4; i++) {
    await rpc(donoAzul.token, "met_build", { p_match: partida.id, p_prop: "leblon", p_n: 1 });
    await rpc(donoAzul.token, "met_build", { p_match: partida.id, p_prop: "jardins", p_n: 1 });
  }
  const hoteis = (await daVez()).est;
  ok(
    hoteis.props.leblon.hotel === true && hoteis.props.leblon.casas === 0,
    "a quinta construção virou hotel, e as casas voltaram para o banco",
  );
  ok(hoteis.bank.hoteis === 10, `dois hotéis saíram do banco (${hoteis.bank.hoteis} restantes)`);
  ok(hoteis.bank.casas === 32, `e as oito casas voltaram (${hoteis.bank.casas})`);

  const aluguelHotel = await aluguel(hoteis, "leblon");
  ok(
    aluguelHotel === CASA.leblon.aluguel[5],
    `agora o Leblon cobra R$ ${CASA.leblon.aluguel[5]} — 42× o aluguel base de R$ ${CASA.leblon.aluguel[0]}`,
  );

  /* ── hipoteca ───────────────────────────────────────────────────────── */

  const comCasa = await rpc(donoAzul.token, "met_mortgage", {
    p_match: partida.id,
    p_prop: "leblon",
  });
  ok(
    /SELL_BUILDINGS_FIRST/.test(JSON.stringify(comCasa.body)),
    "não se hipoteca propriedade com construção — primeiro vende",
  );

  const outraMinha = Object.entries(hoteis.props).find(
    ([, v]) => v.owner === seatVez && !v.hotel && v.casas === 0,
  )?.[0];
  if (outraMinha) {
    const caixaAntes = hoteis.players[seatVez].cash;
    const hip = await rpc(donoAzul.token, "met_mortgage", {
      p_match: partida.id,
      p_prop: outraMinha,
    });
    ok(hip.status === 200, `hipotecou ${outraMinha}`);
    st = hip.body.public_state;
    ok(
      st.players[seatVez].cash === caixaAntes + CASA[outraMinha].hipoteca,
      `e recebeu a metade do preço: R$ ${CASA[outraMinha].hipoteca}`,
    );
    ok(st.props[outraMinha].hipotecada === true, "a propriedade está marcada como hipotecada");
    ok((await aluguel(st, outraMinha)) === 0, "e enquanto hipotecada não cobra aluguel");

    /* A CONTA EM INTEIRO, e é ela que pegou o furo: `ceil(1300 * 1.1)` em
       ponto flutuante dá 1431, porque o produto binário é 1430,0000000000002.
       O servidor usa `numeric` e dá 1430. Seis das treze faixas de hipoteca do
       tabuleiro divergiam, e a tela prometeria um real a mais que o cobrado. */
    const juros = Math.ceil((CASA[outraMinha].hipoteca * 110) / 100);
    const resg = await rpc(donoAzul.token, "met_unmortgage", {
      p_match: partida.id,
      p_prop: outraMinha,
    });
    ok(resg.status === 200, "resgatou a hipoteca");
    ok(
      resg.body.public_state.players[seatVez].cash ===
        st.players[seatVez].cash - juros,
      `pagando 10% de juros: R$ ${juros} por R$ ${CASA[outraMinha].hipoteca} emprestados`,
    );
  }

  /* ── cadeia ─────────────────────────────────────────────────────────── */

  await db.query(
    `update matches set public_state =
       jsonb_set(jsonb_set(public_state, array['players', $2, 'jail'], '1'::jsonb),
                 '{phase}', '"rolar"')
      where id = $1`,
    [partida.id, String(seatVez)],
  );
  const preso = (await daVez()).est;
  const caixaPreso = preso.players[seatVez].cash;
  const pagou = await rpc(donoAzul.token, "met_jail", { p_match: partida.id, p_escolha: "pagar" });
  ok(pagou.status === 200, "pagou a fiança e saiu da cadeia");
  st = pagou.body.public_state;
  ok(st.players[seatVez].jail === 0, "não está mais preso");
  ok(
    st.players[seatVez].cash === caixaPreso - CIDADE.regras.fiancaCadeia,
    `a fiança de R$ ${CIDADE.regras.fiancaCadeia} foi debitada`,
  );
  ok(st.phase === "rolar", "e o turno continua: agora ele rola");

  /* ── passar a vez ───────────────────────────────────────────────────── */

  await rpc(donoAzul.token, "met_roll", { p_match: partida.id });
  const depoisRolar = (await daVez()).est;
  if (depoisRolar.phase === "resolve" && depoisRolar.pendente?.k === "comprar") {
    await rpc(donoAzul.token, "met_buy", { p_match: partida.id }).catch(() => null);
  }
  const passou = await rpc(donoAzul.token, "met_end_turn", { p_match: partida.id });
  if (passou.status === 200) {
    ok(
      passou.body.public_state.turnSeat !== seatVez,
      `a vez passou do assento ${seatVez} para o ${passou.body.public_state.turnSeat}`,
    );
    ok(passou.body.public_state.phase === "rolar", "e o próximo entra na fase de rolar");
  } else {
    /* ROLL_FIRST aqui é CERTO, não falha: se a rolagem anterior deu duplo, a
       fase voltou para "rolar" e a pessoa tem outro dado antes de passar. O
       teste aceita os quatro motivos legítimos e recusa qualquer outro. */
    ok(
      /RESOLVE_FIRST|PAY_YOUR_DEBT|AUCTION_OPEN|ROLL_FIRST/.test(JSON.stringify(passou.body)),
      `não passou a vez, e o motivo é legítimo: ${(passou.body?.message ?? "").slice(0, 40)}`,
    );
  }

  /* ── as internas continuam trancadas ────────────────────────────────── */
  for (const fn of ["met_sweep", "met_pousa", "met_paga", "met_premia", "met_publico"]) {
    const r = await rpc(P[0].token, fn, {});
    ok(r.status >= 400, `o cliente NÃO chama ${fn} (status ${r.status})`);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   6. A MESA DE NEGOCIAÇÃO E OS CONTRATOS

   É a parte com mais jeito de criar dinheiro do nada, e por isso a mais
   testada. Três furos possíveis, e cada um tem seu teste:

     · aceitar uma proposta que ficou impossível (o mundo andou entre propor
       e aceitar) — transferiria o que ninguém tem
     · isenção que não expira — o aluguel simplesmente para de existir
     · parcela cobrada na rodada errada, ou duas vezes
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Grava um estado inteiro na partida, para montar cenário.
 *
 * E EMPURRA O RELÓGIO. `met_sweep` roda por cron a cada minuto e passa a vez
 * de quem estourou o prazo — o que é certo em partida e é uma corrida em
 * teste: entre montar o cenário e agir, a faxina podia avançar o turno e o
 * teste falhava sem nada estar errado. Uma execução falhou exatamente assim
 * antes desta linha existir.
 */
async function poe(matchId, mudanca) {
  const atual = (await db.query("select public_state from matches where id = $1", [matchId]))
    .rows[0].public_state;
  const novo = { ...atual, ...mudanca };
  await db.query(
    `update matches
        set public_state = $2::jsonb,
            turn_deadline = now() + interval '30 minutes'
      where id = $1`,
    [matchId, JSON.stringify(novo)],
  );
  return novo;
}

async function leia(matchId) {
  return (await db.query("select public_state from matches where id = $1", [matchId])).rows[0]
    .public_state;
}

/* ── uma partida limpa, com os três de novo ─────────────────────────────── */

const sala2 = (await rpc(P[0].token, "create_room", { p_game: "metropole" })).body;
await rpc(P[1].token, "join_room", { p_code: sala2.code });
await rpc(P[2].token, "join_room", { p_code: sala2.code });
const jogo2 = (await rpc(P[0].token, "met_start", { p_room: sala2.id })).body;
ok(!!jogo2?.id, "segunda partida criada para testar negociação");

// assento de cada jogador
const assentoDe = {};
for (const linha of (
  await db.query("select user_id, seat from match_players where match_id = $1", [jogo2.id])
).rows) {
  assentoDe[linha.user_id] = linha.seat;
}
const A = P.find((x) => assentoDe[x.id] === 0);
const B = P.find((x) => assentoDe[x.id] === 1);
const C = P.find((x) => assentoDe[x.id] === 2);
ok(!!A && !!B && !!C, "os três assentos identificados");

// dá a A e a B uma propriedade conhecida cada, e caixa redondo
let e2 = await leia(jogo2.id);
const props2 = { ...e2.props };
for (const id of Object.keys(props2)) {
  props2[id] = { owner: null, casas: 0, hotel: false, hipotecada: false };
}
props2["ipanema"] = { owner: 0, casas: 0, hotel: false, hipotecada: false };
props2["leblon"] = { owner: 1, casas: 0, hotel: false, hipotecada: false };
props2["jardins"] = { owner: 1, casas: 0, hotel: false, hipotecada: false };
e2 = await poe(jogo2.id, {
  props: props2,
  players: {
    0: { ...e2.players[0], cash: 10000 },
    1: { ...e2.players[1], cash: 10000 },
    2: { ...e2.players[2], cash: 10000 },
  },
  ofertas: [],
  contratos: [],
  cSeq: 0,
});

/* ── validação da proposta ──────────────────────────────────────────────── */

const propriaOferta = await rpc(A.token, "met_offer", {
  p_match: jogo2.id,
  p_para: 0,
  p_da: {},
  p_quer: {},
});
ok(/SELF_OFFER/.test(JSON.stringify(propriaOferta.body)), "ninguém negocia consigo mesmo");

const vazia = await rpc(A.token, "met_offer", {
  p_match: jogo2.id,
  p_para: 1,
  p_da: {},
  p_quer: {},
});
ok(/EMPTY_OFFER/.test(JSON.stringify(vazia.body)), "proposta vazia dos dois lados é recusada");

const semGrana = await rpc(A.token, "met_offer", {
  p_match: jogo2.id,
  p_para: 1,
  p_da: { dinheiro: 99999 },
  p_quer: { props: ["leblon"] },
});
ok(
  /NOT_ENOUGH_CASH/.test(JSON.stringify(semGrana.body)),
  "não se oferece dinheiro que não se tem",
);

const naoMinha = await rpc(A.token, "met_offer", {
  p_match: jogo2.id,
  p_para: 1,
  p_da: { props: ["leblon"] },
  p_quer: { dinheiro: 100 },
});
ok(/NOT_YOURS/.test(JSON.stringify(naoMinha.body)), "não se oferece escritura alheia");

const naoDele = await rpc(A.token, "met_offer", {
  p_match: jogo2.id,
  p_para: 1,
  p_da: { dinheiro: 100 },
  p_quer: { props: ["ipanema"] },
});
ok(
  /THEY_NOT_YOURS/.test(JSON.stringify(naoDele.body)),
  "nem se pede o que o outro não tem — e o erro diz de que lado está o problema",
);

// com construção, a escritura não passa de mão
await poe(jogo2.id, {
  props: { ...props2, ipanema: { owner: 0, casas: 2, hotel: false, hipotecada: false } },
});
const comObra = await rpc(A.token, "met_offer", {
  p_match: jogo2.id,
  p_para: 1,
  p_da: { props: ["ipanema"] },
  p_quer: { dinheiro: 100 },
});
ok(
  /BUILDINGS_ON_PROP/.test(JSON.stringify(comObra.body)),
  "escritura com construção não passa de mão — venda as casas primeiro",
);
await poe(jogo2.id, { props: props2 });

/* ── proposta aceita: dinheiro e escritura, numa transação ─────────────── */

const antes0 = (await leia(jogo2.id)).players[0].cash;
const antes1 = (await leia(jogo2.id)).players[1].cash;

const oferta1 = await rpc(A.token, "met_offer", {
  p_match: jogo2.id,
  p_para: 1,
  p_da: { dinheiro: 3000 },
  p_quer: { props: ["leblon"] },
});
ok(oferta1.status === 200, "A propõe R$ 3.000 pelo Leblon");
e2 = oferta1.body.public_state;
ok(e2.ofertas.length === 1, "a proposta entrou na mesa");
const idOferta = e2.ofertas[0].id;

const naoParaMim = await rpc(C.token, "met_offer_reply", {
  p_match: jogo2.id,
  p_id: idOferta,
  p_aceita: true,
});
ok(
  /NOT_FOR_YOU/.test(JSON.stringify(naoParaMim.body)),
  "quem não é o destinatário não responde pela proposta",
);

const aceita = await rpc(B.token, "met_offer_reply", {
  p_match: jogo2.id,
  p_id: idOferta,
  p_aceita: true,
});
ok(aceita.status === 200, "B aceita");
e2 = aceita.body.public_state;
ok(e2.props.leblon.owner === 0, "o Leblon mudou de dono");
ok(e2.players[0].cash === antes0 - 3000, "A pagou");
ok(e2.players[1].cash === antes1 + 3000, "B recebeu");
ok(
  e2.players[0].cash + e2.players[1].cash + e2.players[2].cash === antes0 + antes1 + 10000,
  "o dinheiro total da mesa não mudou no acordo",
);
ok(e2.ofertas.length === 0, "e a proposta saiu da mesa");

/* ── recusar, retirar, e o teto de propostas ────────────────────────────── */

await poe(jogo2.id, { props: props2, ofertas: [] });
const of2 = await rpc(A.token, "met_offer", {
  p_match: jogo2.id,
  p_para: 1,
  p_da: { dinheiro: 500 },
  p_quer: { props: ["jardins"] },
});
const id2 = of2.body.public_state.ofertas[0].id;
const recusa = await rpc(B.token, "met_offer_reply", {
  p_match: jogo2.id,
  p_id: id2,
  p_aceita: false,
});
ok(recusa.status === 200, "B recusa");
e2 = recusa.body.public_state;
ok(e2.ofertas.length === 0 && e2.props.jardins.owner === 1, "recusar não move nada");

const of3 = await rpc(A.token, "met_offer", {
  p_match: jogo2.id,
  p_para: 1,
  p_da: { dinheiro: 100 },
  p_quer: { props: ["jardins"] },
});
const id3 = of3.body.public_state.ofertas[0].id;
const alheia = await rpc(B.token, "met_offer_cancel", { p_match: jogo2.id, p_id: id3 });
ok(/NOT_YOURS/.test(JSON.stringify(alheia.body)), "só quem propôs retira a proposta");
const retira = await rpc(A.token, "met_offer_cancel", { p_match: jogo2.id, p_id: id3 });
ok(retira.body.public_state.ofertas.length === 0, "quem propôs retira");

for (let i = 0; i < 3; i++) {
  await rpc(A.token, "met_offer", {
    p_match: jogo2.id,
    p_para: 1,
    p_da: { dinheiro: 100 + i },
    p_quer: { props: ["jardins"] },
  });
}
const quarta = await rpc(A.token, "met_offer", {
  p_match: jogo2.id,
  p_para: 1,
  p_da: { dinheiro: 999 },
  p_quer: { props: ["jardins"] },
});
ok(
  /TOO_MANY_OFFERS/.test(JSON.stringify(quarta.body)),
  "três propostas abertas por pessoa é o teto — sem isso dá para afogar a mesa",
);

/* ── A PROPOSTA QUE FICOU IMPOSSÍVEL ────────────────────────────────────
   O furo mais perigoso: entre propor e aceitar, o mundo anda. */

// o caixa precisa ser reposto: A gastou R$ 3.000 no acordo de antes
e2 = await leia(jogo2.id);
await poe(jogo2.id, {
  props: props2,
  ofertas: [],
  players: {
    0: { ...e2.players[0], cash: 10000 },
    1: { ...e2.players[1], cash: 10000 },
    2: { ...e2.players[2], cash: 10000 },
  },
});
const ofStale = await rpc(A.token, "met_offer", {
  p_match: jogo2.id,
  p_para: 1,
  p_da: { dinheiro: 9000 },
  p_quer: { props: ["leblon"] },
});
const idStale = ofStale.body.public_state.ofertas[0].id;

// A gasta o dinheiro depois de propor
e2 = await leia(jogo2.id);
await poe(jogo2.id, { players: { ...e2.players, 0: { ...e2.players[0], cash: 100 } } });

const stale = await rpc(B.token, "met_offer_reply", {
  p_match: jogo2.id,
  p_id: idStale,
  p_aceita: true,
});
ok(
  /OFFER_STALE_NOT_ENOUGH_CASH/.test(JSON.stringify(stale.body)),
  "aceitar proposta que ficou impossível é recusado, e o erro diz que ela venceu",
);
e2 = await leia(jogo2.id);
ok(e2.props.leblon.owner === 1, "e nada mudou de mão");

/* ── PARCELAMENTO: o servidor cobra sozinho ────────────────────────────── */

await poe(jogo2.id, {
  props: props2,
  ofertas: [],
  contratos: [],
  players: {
    0: { ...e2.players[0], cash: 10000 },
    1: { ...e2.players[1], cash: 10000 },
    2: { ...e2.players[2], cash: 10000 },
  },
});

const ofParcela = await rpc(A.token, "met_offer", {
  p_match: jogo2.id,
  p_para: 1,
  p_da: { parcela: { valor: 500, rodadas: 3 } },
  p_quer: { props: ["leblon"] },
});
ok(ofParcela.status === 200, "A oferece R$ 500 por rodada durante 3 rodadas pelo Leblon");
const idParc = ofParcela.body.public_state.ofertas[0].id;
const fechou = await rpc(B.token, "met_offer_reply", {
  p_match: jogo2.id,
  p_id: idParc,
  p_aceita: true,
});
e2 = fechou.body.public_state;
ok(e2.props.leblon.owner === 0, "o Leblon foi para A na hora — só o pagamento é parcelado");
ok(e2.contratos.length === 1 && e2.contratos[0].tipo === "parcela", "o contrato existe");
ok(
  e2.contratos[0].de === 0 && e2.contratos[0].para === 1 && e2.contratos[0].rodadas === 3,
  "com devedor, credor e prazo certos",
);
ok(
  e2.players[0].cash === 10000,
  "e NADA foi debitado ainda: a primeira parcela sai no próximo turno de A",
);

// cobra três vezes, direto na função, e confere que expira
let estado = e2;
for (let n = 3; n >= 1; n--) {
  const r = await db.query("select public.met_cobra_contratos($1::jsonb, 0::smallint) v", [
    JSON.stringify(estado),
  ]);
  estado = r.rows[0].v;
  const esperado = 10000 - 500 * (4 - n);
  ok(
    estado.players[0].cash === esperado,
    `parcela ${4 - n} debitada: A com ${estado.players[0].cash} (esperado ${esperado})`,
  );
  ok(
    n === 1 ? estado.contratos.length === 0 : estado.contratos[0].rodadas === n - 1,
    n === 1 ? "na terceira, o contrato acabou e saiu do estado" : `faltam ${n - 1} parcelas`,
  );
}
const r4 = await db.query("select public.met_cobra_contratos($1::jsonb, 0::smallint) v", [
  JSON.stringify(estado),
]);
ok(
  r4.rows[0].v.players[0].cash === estado.players[0].cash,
  "e uma quarta cobrança não tira mais nada — três rodadas são três",
);

// a parcela cobrada no turno do CREDOR não debita ninguém
const noCredor = await db.query("select public.met_cobra_contratos($1::jsonb, 1::smallint) v", [
  JSON.stringify(e2),
]);
ok(
  noCredor.rows[0].v.players[0].cash === 10000,
  "a parcela é cobrada no turno do DEVEDOR, não no do credor",
);

// e ela entra na máquina de dívida se o caixa não cobre
const pobre = { ...e2, players: { ...e2.players, 0: { ...e2.players[0], cash: 100 } } };
const inadim = await db.query("select public.met_cobra_contratos($1::jsonb, 0::smallint) v", [
  JSON.stringify(pobre),
]);
ok(
  inadim.rows[0].v.players[0].cash === -400,
  "devedor sem caixa fica negativo (a inadimplência usa a mesma máquina de dívida)",
);
ok(
  inadim.rows[0].v.players[1].cash === 10500,
  "e o credor recebe o valor cheio de qualquer jeito",
);

/* ── ISENÇÃO DE ALUGUEL: aplicada sem pedir, e expira ──────────────────── */

const comIsencao = {
  ...e2,
  turnSeat: 0,
  props: { ...props2, jardins: { owner: 1, casas: 0, hotel: false, hipotecada: false } },
  players: {
    0: { ...e2.players[0], cash: 10000, pos: 39 },
    1: { ...e2.players[1], cash: 10000 },
    2: { ...e2.players[2], cash: 10000 },
  },
  contratos: [
    {
      id: "cx",
      tipo: "isencao",
      de: 1,
      para: 0,
      valor: 0,
      rodadas: 2,
      props: ["jardins"],
      ate: null,
    },
  ],
};
const pousaIsento = await pousa(comIsencao, 0);
ok(
  pousaIsento.players[0].cash === 10000,
  "com isenção, parar no Jardins do outro não cobra nada",
);
ok(
  pousaIsento.log.some((l) => l.k === "isento"),
  "e o registro diz que foi isenção, não que o aluguel é zero",
);

/* Sem a isenção, o mesmo estado cobra — e cobra o DOBRO, porque neste cenário
   B tem Leblon e Jardins, que são o grupo azul-escuro inteiro. É de propósito:
   a isenção tem de vencer o aluguel dobrado do monopólio, que é justamente o
   aluguel por que valeria a pena negociar isenção. */
const dobrado = CASA.jardins.aluguel[0] * 2;
const semIsencao = { ...comIsencao, contratos: [] };
const pousaCobra = await pousa(semIsencao, 0);
ok(
  pousaCobra.players[0].cash === 10000 - dobrado,
  `sem isenção o Jardins cobra R$ ${dobrado} — o dobro, porque B tem o azul-escuro inteiro`,
);

// isenção de OUTRA propriedade não vale para esta
const isencaoOutra = {
  ...comIsencao,
  contratos: [{ ...comIsencao.contratos[0], props: ["ipanema"] }],
};
ok(
  (await pousa(isencaoOutra, 0)).players[0].cash === 10000 - dobrado,
  "isenção é por propriedade: a de Ipanema não cobre o Jardins",
);

// isenção sem lista (props nulo) cobre tudo do credor
const isencaoTotal = {
  ...comIsencao,
  contratos: [{ ...comIsencao.contratos[0], props: null }],
};
ok(
  (await pousa(isencaoTotal, 0)).players[0].cash === 10000,
  "isenção sem lista cobre TUDO daquele dono — é a isenção total",
);

// e ela expira: duas cobranças no turno do isentado
let comoVai = comIsencao;
for (let i = 0; i < 2; i++) {
  comoVai = (
    await db.query("select public.met_cobra_contratos($1::jsonb, 0::smallint) v", [
      JSON.stringify(comoVai),
    ])
  ).rows[0].v;
}
ok(comoVai.contratos.length === 0, "duas rodadas depois, a isenção venceu e saiu do estado");
ok(
  (await pousa({ ...comoVai, players: { ...comIsencao.players } }, 0)).players[0].cash ===
    10000 - dobrado,
  "e o aluguel volta a ser cobrado",
);

/* ── OPÇÃO DE COMPRA ──────────────────────────────────────────────────── */

await poe(jogo2.id, {
  props: props2,
  ofertas: [],
  contratos: [],
  round: 3,
  players: {
    0: { ...e2.players[0], cash: 10000 },
    1: { ...e2.players[1], cash: 10000 },
    2: { ...e2.players[2], cash: 10000 },
  },
});

const ofOpcao = await rpc(B.token, "met_offer", {
  p_match: jogo2.id,
  p_para: 0,
  p_da: { opcao: { prop: "leblon", preco: 5000, ate: 14 } },
  p_quer: { dinheiro: 800 },
});
ok(ofOpcao.status === 200, "B vende a A o direito de comprar o Leblon por R$ 5.000 até a rodada 14");
const idOp = ofOpcao.body.public_state.ofertas[0].id;
const fechaOp = await rpc(A.token, "met_offer_reply", {
  p_match: jogo2.id,
  p_id: idOp,
  p_aceita: true,
});
e2 = fechaOp.body.public_state;
const contratoOp = e2.contratos.find((c) => c.tipo === "opcao");
ok(!!contratoOp, "o contrato de opção existe");
ok(e2.props.leblon.owner === 1, "e o Leblon CONTINUA de B — a opção não é a venda");
ok(e2.players[1].cash === 10800, "B recebeu o prêmio de R$ 800 pela opção");

const alheio = await rpc(C.token, "met_exercer", { p_match: jogo2.id, p_id: contratoOp.id });
ok(/NOT_YOURS/.test(JSON.stringify(alheio.body)), "só o titular exerce a opção");

const exerce = await rpc(A.token, "met_exercer", { p_match: jogo2.id, p_id: contratoOp.id });
ok(exerce.status === 200, "A exerce a opção");
e2 = exerce.body.public_state;
ok(e2.props.leblon.owner === 0, "o Leblon passou para A");
ok(e2.players[0].cash === 10000 - 800 - 5000, "A pagou o preço combinado, não o de tabela");
ok(e2.contratos.filter((c) => c.tipo === "opcao").length === 0, "e a opção foi consumida");

// opção vencida não vale
const vencida = {
  ...e2,
  round: 20,
  props: { ...props2 },
  contratos: [
    {
      id: "cv",
      tipo: "opcao",
      de: 1,
      para: 0,
      valor: 5000,
      rodadas: 0,
      props: ["leblon"],
      ate: 14,
    },
  ],
};
await poe(jogo2.id, vencida);
const expirou = await rpc(A.token, "met_exercer", { p_match: jogo2.id, p_id: "cv" });
ok(/OPTION_EXPIRED/.test(JSON.stringify(expirou.body)), "opção vencida não vale mais");

// e se a propriedade trocou de dono, a opção não vale contra terceiro
await poe(jogo2.id, {
  ...vencida,
  round: 5,
  props: { ...props2, leblon: { owner: 2, casas: 0, hotel: false, hipotecada: false } },
});
const terceiro = await rpc(A.token, "met_exercer", { p_match: jogo2.id, p_id: "cv" });
ok(
  /OWNER_CHANGED/.test(JSON.stringify(terceiro.body)),
  "a opção não vale contra terceiro: se o vendedor passou a escritura, ela cai",
);

/* ── FALÊNCIA: o contrato sobrevive ao credor, morre com o devedor ─────── */

const paraQuebrar = {
  ...e2,
  round: 5,
  turnSeat: 0,
  phase: "resolve",
  pendente: { k: "divida", quanto: 5000, para: 1, motivo: "teste" },
  props: { ...props2, ipanema: { owner: 0, casas: 0, hotel: false, hipotecada: false } },
  players: {
    0: { ...e2.players[0], cash: -5000, quebrado: false, investidor: false },
    1: { ...e2.players[1], cash: 10000 },
    2: { ...e2.players[2], cash: 10000 },
  },
  contratos: [
    { id: "cdeve", tipo: "parcela", de: 0, para: 1, valor: 300, rodadas: 5, props: null, ate: null },
    { id: "crecebe", tipo: "parcela", de: 2, para: 0, valor: 400, rodadas: 5, props: null, ate: null },
    { id: "cisenta", tipo: "isencao", de: 0, para: 2, valor: 0, rodadas: 4, props: null, ate: null },
  ],
  ofertas: [],
};
await poe(jogo2.id, paraQuebrar);

const quebrou = await rpc(A.token, "met_bankrupt", { p_match: jogo2.id });
ok(quebrou.status === 200, `A quebra (${JSON.stringify(quebrou.body).slice(0, 70)})`);
e2 = quebrou.body.public_state;
ok(e2.players[0].quebrado === true, "A está fora");
ok(e2.players[0].investidor === true, "e virou Investidor, não foi eliminado (modo Metrópole)");
ok(
  !e2.contratos.some((c) => c.id === "cdeve"),
  "a parcela que A DEVIA morreu — não se cobra de quem não tem nada",
);
ok(
  e2.contratos.some((c) => c.id === "crecebe"),
  "a parcela que A RECEBIA sobreviveu: o azar do credor não perdoa o devedor",
);
ok(
  !e2.contratos.some((c) => c.id === "cisenta"),
  "e a isenção que A concedia caiu, porque ele não tem mais propriedade nenhuma",
);
ok(e2.props.ipanema.owner === null, "as propriedades dele voltaram ao banco");

/* ══════════════════════════════════════════════════════════════════════════
   7. AS REGRAS DA CASA

   Quatro regras, todas desligadas por padrão, e cada uma com efeito de verdade
   no motor. O que mais importa testar aqui não é se elas funcionam — é se elas
   ficam CONGELADAS: mudar a regra com a partida rolando não pode mudar a
   partida em curso.
   ══════════════════════════════════════════════════════════════════════════ */

const sala3 = (await rpc(P[0].token, "create_room", { p_game: "metropole" })).body;
await rpc(P[1].token, "join_room", { p_code: sala3.code });

const chaveErrada = await rpc(P[0].token, "set_room_settings", {
  p_room: sala3.id,
  p_settings: { tamanho: 5 },
});
ok(
  /UNKNOWN_SETTING_tamanho/.test(JSON.stringify(chaveErrada.body)),
  "chave de outro jogo é RECUSADA, não descartada em silêncio",
);

const modoRuim = await rpc(P[0].token, "set_room_settings", {
  p_room: sala3.id,
  p_settings: { modo: "eterno" },
});
ok(/BAD_MODE/.test(JSON.stringify(modoRuim.body)), "modo fora do vocabulário é recusado");

const padrao = await rpc(P[0].token, "set_room_settings", {
  p_room: sala3.id,
  p_settings: { modo: "metropole" },
});
ok(
  padrao.body?.settings?.bolao === false &&
    padrao.body?.settings?.semLeilao === false &&
    padrao.body?.settings?.largadaDobrada === false &&
    padrao.body?.settings?.construirSolto === false,
  "as quatro regras da casa nascem desligadas",
);

const liga = await rpc(P[0].token, "set_room_settings", {
  p_room: sala3.id,
  p_settings: { bolao: true, semLeilao: true },
});
ok(
  liga.body?.settings?.bolao === true && liga.body?.settings?.semLeilao === true,
  "o anfitrião liga duas regras",
);
ok(
  liga.body?.settings?.modo === "metropole",
  "e o patch parcial não apaga o que já estava gravado",
);

const jogo3 = (await rpc(P[0].token, "met_start", { p_room: sala3.id })).body;
ok(
  jogo3?.public_state?.regras?.bolao === true,
  "as regras entram CONGELADAS no estado da partida",
);
ok(jogo3?.public_state?.bolao === 0, "e o pote começa vazio");

/* congelamento: mudar a sala com a partida rolando não muda a partida. A
   função recusa com a partida em curso, o que já é a garantia — mas se um dia
   ela deixar, o estado continua sendo o que valia no início. */
const durante = await rpc(P[0].token, "set_room_settings", {
  p_room: sala3.id,
  p_settings: { bolao: false },
});
ok(
  /MATCH_IN_PROGRESS/.test(JSON.stringify(durante.body)),
  "não se muda a regra da casa com a partida rolando",
);

/* ── o bolão, na função ─────────────────────────────────────────────────── */

const comBolao = {
  ...estadoBase(),
  regras: { bolao: true, largadaDobrada: false, construirSolto: false, semLeilao: false },
  bolao: 0,
};
comBolao.players[0].pos = 4; // Imposto de Renda
let pote = await pousa(comBolao, 0);
ok(pote.players[0].cash === 10000 - 2000, "o imposto sai do caixa igual");
ok(pote.bolao === 2000, "e com o bolão ligado ele vai para o POTE, não para o banco");

// e a Praça paga o pote
const naPraca = { ...pote };
naPraca.players[1] = { ...naPraca.players[1], pos: 20 };
const levou = await pousa(naPraca, 1);
ok(levou.players[1].cash === 10000 + 2000, "quem para na Praça Central leva o pote inteiro");
ok(levou.bolao === 0, "e o pote zera");
ok(
  levou.log.some((l) => l.k === "bolao"),
  "o registro conta que foi o bolão",
);

// sem a regra, a Praça é descanso e o imposto some no banco
const semBolao = { ...estadoBase(), regras: { bolao: false }, bolao: 0 };
semBolao.players[0].pos = 4;
const semPote = await pousa(semBolao, 0);
ok(
  (semPote.bolao ?? 0) === 0,
  "sem a regra, o imposto não vira pote — o dinheiro sai do jogo, e é isso que faz a partida ter fim",
);

// compra de escritura NÃO alimenta o pote: é pagamento, não penalidade
const compraNoPote = await db.query(
  `select public.met_paga($1::jsonb, 0::smallint, null::smallint, 3000, 'compra:leblon') v`,
  [JSON.stringify(comBolao)],
);
ok(
  (compraNoPote.rows[0].v.bolao ?? 0) === 0,
  "comprar escritura não alimenta o pote: só multa e taxa são penalidade",
);
const taxaNoPote = await db.query(
  `select public.met_paga($1::jsonb, 0::smallint, null::smallint, 500, 'fianca') v`,
  [JSON.stringify(comBolao)],
);
ok(taxaNoPote.rows[0].v.bolao === 500, "a fiança da cadeia, sim");

/* ── salário dobrado na Largada ─────────────────────────────────────────── */

const dobra = {
  ...estadoBase(),
  regras: { bolao: false, largadaDobrada: true },
};
dobra.players[0].pos = 0;
const naLargada = await pousa(dobra, 0);
ok(
  naLargada.players[0].cash === 10000 + 2000,
  "parar exatamente na Largada paga o salário de novo, com a regra ligada",
);
const semDobra = { ...estadoBase(), regras: { largadaDobrada: false } };
semDobra.players[0].pos = 0;
ok(
  (await pousa(semDobra, 0)).players[0].cash === 10000,
  "sem a regra, parar na Largada não paga extra",
);

/* ── construir sem o grupo completo ─────────────────────────────────────── */

const soltoProps = { ...estadoBase().props };
soltoProps["leblon"] = { owner: 0, casas: 0, hotel: false, hipotecada: false };
// Jardins fica sem dono: o grupo azul-escuro NÃO está completo

await poe(jogo3.id, {
  props: soltoProps,
  regras: { bolao: true, largadaDobrada: false, construirSolto: false, semLeilao: true },
  phase: "acao",
  pendente: null,
  turnSeat: 0,
  players: {
    ...jogo3.public_state.players,
    0: { ...jogo3.public_state.players[0], cash: 30000 },
  },
});
const idSeat0 = (
  await db.query("select user_id from match_players where match_id = $1 and seat = 0", [jogo3.id])
).rows[0].user_id;
const donoSolto = P.find((x) => x.id === idSeat0);
ok(!!donoSolto, "o assento 0 da terceira partida foi identificado");
const semGrupo = await rpc(donoSolto.token, "met_build", {
  p_match: jogo3.id,
  p_prop: "leblon",
  p_n: 1,
});
ok(
  /GROUP_INCOMPLETE/.test(JSON.stringify(semGrupo.body)),
  "sem a regra, construir exige o grupo de cor inteiro",
);

await poe(jogo3.id, {
  regras: { bolao: true, largadaDobrada: false, construirSolto: true, semLeilao: true },
});
const comSolto = await rpc(donoSolto.token, "met_build", {
  p_match: jogo3.id,
  p_prop: "leblon",
  p_n: 1,
});
ok(
  comSolto.status === 200 && comSolto.body.public_state.props.leblon.casas === 1,
  `com "construir solto", constrói sem o monopólio (${JSON.stringify(comSolto.body).slice(0, 70)})`,
);

/* ── sem leilão ─────────────────────────────────────────────────────────── */

await poe(jogo3.id, {
  props: { ...estadoBase().props },
  regras: { bolao: false, largadaDobrada: false, construirSolto: false, semLeilao: true },
  phase: "resolve",
  turnSeat: 0,
  pendente: { k: "comprar", prop: "ipanema", preco: CASA.ipanema.preco },
  leilao: null,
});
const recusaSem = await rpc(donoSolto.token, "met_decline", { p_match: jogo3.id });
ok(recusaSem.status === 200, "recusa aceita com a regra sem leilão");
ok(
  recusaSem.body.public_state.leilao === null &&
    recusaSem.body.public_state.phase !== "leilao",
  "com a regra ligada, recusar devolve ao banco e NÃO abre leilão",
);
ok(
  recusaSem.body.public_state.props.ipanema.owner === null,
  "e a propriedade continua sem dono",
);

// e a regra do estado é que manda, não a da sala
await poe(jogo3.id, {
  regras: { bolao: false, largadaDobrada: false, construirSolto: false, semLeilao: false },
  phase: "resolve",
  turnSeat: 0,
  pendente: { k: "comprar", prop: "ipanema", preco: CASA.ipanema.preco },
  leilao: null,
});
const recusaCom = await rpc(donoSolto.token, "met_decline", { p_match: jogo3.id });
ok(
  recusaCom.body.public_state.phase === "leilao",
  "com a regra desligada no ESTADO, recusar abre o leilão — a sala não tem voz aqui",
);

/* ══════════════════════════════════════════════════════════════════════════
   8. O INVESTIDOR

   Quem quebra não sai: vira Investidor. O PRD diz que ele "é o oposto de
   assistir" — e até esta etapa o código dizia o contrário, porque `met_bid`
   recusava quem estava quebrado. Aqui se testa cada uma das quatro coisas que
   ele passa a fazer, e a que mais importa é a MEIA-PARTE: a escritura fica no
   nome do administrador para tudo (grupo de cor, construção), e o aluguel se
   parte.
   ══════════════════════════════════════════════════════════════════════════ */

const sala4 = (await rpc(P[0].token, "create_room", { p_game: "metropole" })).body;
await rpc(P[1].token, "join_room", { p_code: sala4.code });
await rpc(P[2].token, "join_room", { p_code: sala4.code });
const jogo4 = (await rpc(P[0].token, "met_start", { p_room: sala4.id })).body;
ok(!!jogo4?.id, "quarta partida criada para testar o Investidor");

const porSeat4 = {};
for (const linha of (
  await db.query("select user_id, seat from match_players where match_id = $1", [jogo4.id])
).rows) {
  porSeat4[linha.seat] = P.find((x) => x.id === linha.user_id);
}
const INV = porSeat4[0]; // vai quebrar e virar Investidor
const ADM = porSeat4[1]; // vai administrar
const OUT = porSeat4[2];

/** Um estado limpo da quarta partida, com o assento 0 já Investidor. */
function comInvestidor(extra = {}) {
  const props = {};
  for (const c of CIDADE.casas) {
    if (!c.id) continue;
    props[c.id] = { owner: null, casas: 0, hotel: false, hipotecada: false };
  }
  return {
    ...jogo4.public_state,
    props,
    round: 4,
    turnSeat: 1,
    phase: "acao",
    pendente: null,
    leilao: null,
    ofertas: [],
    contratos: [],
    devedores: [],
    players: {
      0: { ...jogo4.public_state.players[0], cash: 8000, quebrado: true, investidor: true },
      1: { ...jogo4.public_state.players[1], cash: 10000, quebrado: false, investidor: false },
      2: { ...jogo4.public_state.players[2], cash: 10000, quebrado: false, investidor: false },
    },
    ...extra,
  };
}

/* ── 1. o Investidor dá lance ───────────────────────────────────────────── */

await poe(jogo4.id, comInvestidor({
  phase: "leilao",
  leilao: { prop: "leblon", alto: 0, altoSeat: null, passou: [], abriuSeat: 1, admin: null },
}));

const semAdmin = await rpc(INV.token, "met_bid", { p_match: jogo4.id, p_valor: 3000 });
ok(
  /NEED_ADMIN/.test(JSON.stringify(semAdmin.body)),
  "o lance do Investidor exige dizer quem administra — sem isso a propriedade não entra no jogo",
);

const adminQuebrado = await rpc(INV.token, "met_bid", {
  p_match: jogo4.id,
  p_valor: 3000,
  p_admin: 0,
});
ok(
  /BAD_ADMIN/.test(JSON.stringify(adminQuebrado.body)),
  "o administrador tem de ser um jogador ATIVO — nem ele mesmo",
);

const lanceInv = await rpc(INV.token, "met_bid", {
  p_match: jogo4.id,
  p_valor: 3000,
  p_admin: 1,
});
ok(
  lanceInv.status === 200,
  `o Investidor dá lance em leilão (${JSON.stringify(lanceInv.body).slice(0, 70)})`,
);
ok(lanceInv.body.public_state.leilao.altoSeat === 0, "e ele está na frente");
ok(lanceInv.body.public_state.leilao.admin === 1, "com o administrador registrado no lance");

/* ── 2. o leilão fecha: escritura no administrador ──────────────────────── */

await rpc(ADM.token, "met_pass", { p_match: jogo4.id });
const fechaInv = await rpc(OUT.token, "met_pass", { p_match: jogo4.id });
let e4 = fechaInv.body.public_state;
ok(
  e4.props.leblon.owner === 1,
  "a escritura vai para o NOME DO ADMINISTRADOR, não do Investidor",
);
ok(
  e4.props.leblon.investidor === 0,
  "e a meia-parte do Investidor fica registrada na propriedade",
);
ok(e4.players[0].cash === 8000 - 3000, "o dinheiro saiu do bolso do Investidor");
ok(e4.players[1].cash === 10000, "e o administrador não pagou nada");
ok(
  e4.log.some((l) => l.k === "leilao-investidor"),
  "o registro distingue o arremate do Investidor do arremate comum",
);

/* ── 3. o aluguel se parte ──────────────────────────────────────────────── */

const comMeia = comInvestidor({
  props: (() => {
    const base = {};
    for (const c of CIDADE.casas) {
      if (!c.id) continue;
      base[c.id] = { owner: null, casas: 0, hotel: false, hipotecada: false };
    }
    base["leblon"] = { owner: 1, casas: 0, hotel: false, hipotecada: false, investidor: 0 };
    return base;
  })(),
});
comMeia.players[2].pos = 37; // Leblon
const partido = await pousa(comMeia, 2);
const bruto = CASA.leblon.aluguel[0];
const meia = Math.floor(bruto / 2);
ok(
  partido.players[2].cash === 10000 - bruto,
  `quem parou pagou o aluguel cheio de R$ ${bruto} — a partilha é entre os outros dois`,
);
ok(
  partido.players[1].cash === 10000 + (bruto - meia),
  `o administrador ficou com R$ ${bruto - meia}`,
);
ok(
  partido.players[0].cash === 8000 + meia,
  `e o Investidor com R$ ${meia}`,
);
ok(
  partido.players[0].cash + partido.players[1].cash + partido.players[2].cash === 28000,
  "e o dinheiro total não mudou: a partilha não cria nem destrói nada",
);
ok(
  partido.log.filter((l) => String(l.motivo ?? "").startsWith("aluguel")).length === 2,
  "são duas transferências no registro, e não uma — ninguém precisa deduzir para onde foi",
);

// sem a meia-parte, o aluguel vai inteiro para o dono
const semMeia = comInvestidor({
  props: (() => {
    const base = {};
    for (const c of CIDADE.casas) {
      if (!c.id) continue;
      base[c.id] = { owner: null, casas: 0, hotel: false, hipotecada: false };
    }
    base["leblon"] = { owner: 1, casas: 0, hotel: false, hipotecada: false };
    return base;
  })(),
});
semMeia.players[2].pos = 37;
const inteiro = await pousa(semMeia, 2);
ok(
  inteiro.players[1].cash === 10000 + bruto && inteiro.players[0].cash === 8000,
  "propriedade sem Investidor por trás paga o aluguel inteiro ao dono",
);

/* ── 4. o Investidor empresta ───────────────────────────────────────────── */

await poe(jogo4.id, comInvestidor());
const emprestimo = await rpc(INV.token, "met_offer", {
  p_match: jogo4.id,
  p_para: 1,
  p_da: { dinheiro: 3000 },
  p_quer: { parcela: { valor: 500, rodadas: 8 } },
});
ok(
  emprestimo.status === 200,
  `o Investidor empresta: R$ 3.000 agora contra R$ 500 por rodada durante 8 (${JSON.stringify(emprestimo.body).slice(0, 60)})`,
);
const idEmp = emprestimo.body.public_state.ofertas[0].id;
const aceitaEmp = await rpc(ADM.token, "met_offer_reply", {
  p_match: jogo4.id,
  p_id: idEmp,
  p_aceita: true,
});
e4 = aceitaEmp.body.public_state;
ok(e4.players[1].cash === 13000, "o dinheiro chegou na hora");
ok(
  e4.contratos.some((c) => c.tipo === "parcela" && c.de === 1 && c.para === 0 && c.rodadas === 8),
  "e o contrato de oito parcelas ficou de pé, com o Investidor como credor",
);

/* ── 5. a aposta secreta ────────────────────────────────────────────────── */

const naoInvestidor = await rpc(ADM.token, "met_aposta", { p_match: jogo4.id, p_em: 2 });
ok(
  /NOT_AN_INVESTOR/.test(JSON.stringify(naoInvestidor.body)),
  "quem está jogando não aposta: só o Investidor",
);

const nelePropio = await rpc(INV.token, "met_aposta", { p_match: jogo4.id, p_em: 0 });
ok(/SELF_BET/.test(JSON.stringify(nelePropio.body)), "e não aposta em si mesmo");

const aposta = await rpc(INV.token, "met_aposta", { p_match: jogo4.id, p_em: 2 });
ok(aposta.status === 200, "o Investidor aposta no assento 2");
const guardada = (
  await db.query(
    `select data -> 'aposta' a from match_private_state where match_id = $1 and user_id = $2`,
    [jogo4.id, INV.id],
  )
).rows[0].a;
ok(Number(guardada) === 2, "a aposta ficou no estado PRIVADO");
const noPublico = await leia(jogo4.id);
ok(
  !JSON.stringify(noPublico).includes('"aposta"'),
  "e o estado público NÃO a contém: aposta revelada viraria aliança pública",
);

/* ── 6. o fim: apostas reveladas, patrimônio de todos, XP creditado ────── */

const xpAntes = (
  await db.query("select stats -> 'partidas' n from profiles where id = $1", [OUT.id])
).rows[0].n;

/* A vez tem de estar no ÚLTIMO assento ativo: a rodada só incrementa quando
   a vez dá a volta, e é o incremento que cruza a rodada final. Com o turno no
   assento do meio, `met_end_turn` só passa a vez — que é o certo. */
await poe(jogo4.id, comInvestidor({
  round: 20,
  rodadaFinal: 20,
  turnSeat: 2,
  phase: "acao",
  props: (() => {
    const base = {};
    for (const c of CIDADE.casas) {
      if (!c.id) continue;
      base[c.id] = { owner: null, casas: 0, hotel: false, hipotecada: false };
    }
    // o assento 2 fica com o azul-escuro: vence por patrimônio
    base["leblon"] = { owner: 2, casas: 0, hotel: false, hipotecada: false };
    base["jardins"] = { owner: 2, casas: 0, hotel: false, hipotecada: false };
    return base;
  })(),
}));

const acaba = await rpc(OUT.token, "met_end_turn", { p_match: jogo4.id });
ok(acaba.status === 200, `a temporada acabou (${JSON.stringify(acaba.body).slice(0, 60)})`);
e4 = acaba.body.public_state;
ok(e4.phase === "fim", "a fase virou fim");
ok(
  e4.vencedor === 2,
  `venceu quem tinha mais patrimônio: assento ${e4.vencedor} (${reaisJs(e4.players[2]?.patrimonio ?? 0)})`,
);
ok(
  [0, 1, 2].every((k) => typeof e4.players[k].patrimonio === "number"),
  "o patrimônio de TODOS foi gravado no estado — a tela final não recalcula",
);
ok(
  Array.isArray(e4.apostas) && e4.apostas.length === 1,
  "a aposta do Investidor foi revelada no fim",
);
ok(
  e4.apostas[0].seat === 0 && e4.apostas[0].em === 2 && e4.apostas[0].acertou === true,
  "e ela estava certa: o Investidor leva o segundo lugar",
);

const xpDepois = (
  await db.query("select stats -> 'partidas' n from profiles where id = $1", [OUT.id])
).rows[0].n;
ok(
  Number(xpDepois) === Number(xpAntes) + 1,
  `o XP foi creditado no fim por rodadas (${xpAntes} -> ${xpDepois}) — antes desta etapa este caminho não creditava nada`,
);

for (const p of P) await admin(`/admin/users/${p.id}`, { method: "DELETE" });
await db.end();

console.log(falhas === 0 ? "\nTudo passou." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
