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
  const andou = (st.players[e1.turnSeat].pos - posAntes + 40) % 40;
  ok(
    andou === st.dados[0] + st.dados[1] || st.players[e1.turnSeat].jail > 0,
    `andou exatamente a soma dos dados (${andou} = ${st.dados[0]}+${st.dados[1]})`,
  );

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
  const assentoOutro = Object.entries(st.players).find(
    ([, v]) => v.userId === outro.id,
  )?.[0];
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
    ([id, v]) => v.owner === seatVez && !v.hotel && v.casas === 0,
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

    const juros = Math.ceil(CASA[outraMinha].hipoteca * 1.1);
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

for (const p of P) await admin(`/admin/users/${p.id}`, { method: "DELETE" });
await db.end();

console.log(falhas === 0 ? "\nTudo passou." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
