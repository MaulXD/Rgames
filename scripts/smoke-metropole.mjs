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
const db = new pg.Pool({
  connectionString: `${PG}&uselibpqcompat=true`,
  max: 4,
  keepAlive: true,
});
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
/* E os erros de ABRIR conexao, que sao outros: o Pool cria uma nova quando a
   anterior morreu, e essa criacao tambem falha de vez em quando. O `ETIMEDOUT`
   chega como AggregateError de MENSAGEM VAZIA -- so o `code` identifica --, e
   por isso a checagem olha os dois lugares. */
const CODIGO_DE_REDE = new Set([
  "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EPIPE",
]);
const ehDaRede = (e) =>
  CODIGO_DE_REDE.has(e?.code ?? "") || CONEXAO_CAIU.test(e?.message ?? "");
const consultaCrua = db.query.bind(db);
db.query = async (...args) => {
  try {
    return await consultaCrua(...args);
  } catch (e) {
    if (!ehDaRede(e)) throw e;
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

/* ══════════════════════════════════════════════════════════════════════════
   9. OS EVENTOS DA CIDADE

   Seis eventos, um a cada cinco rodadas, valendo por três. O que mais importa
   testar não é se o efeito acontece — é se o efeito é EXATO e se o cliente
   calcula o mesmo número que o servidor. Um evento que muda o aluguel e uma
   tela que mostra o valor de tabela é pior que evento nenhum.
   ══════════════════════════════════════════════════════════════════════════ */

const EV = Object.fromEntries(CIDADE.eventos.map((e) => [e.id, e]));
ok(Object.keys(EV).length === 6, `os 6 eventos chegaram no tabuleiro publicado`);

/** Um estado com um evento em vigor. */
function comEvento(id, extra = {}) {
  const ev = { ...EV[id], desde: 5, ate: 7, ...extra };
  return { ...estadoBase(), round: 5, evento: ev };
}

/* ── alta temporada: bairro de praia cobra metade a mais ────────────────── */

const praiaBase = { ...estadoBase({ ipanema: 1 }) };
const semTemporada = await aluguel(praiaBase, "ipanema");
const temporada = { ...comEvento("alta-temporada"), props: praiaBase.props };
const comTemporada = await aluguel(temporada, "ipanema");
ok(
  comTemporada === Math.trunc((semTemporada * 3) / 2),
  `alta temporada: Ipanema de R$ ${semTemporada} para R$ ${comTemporada} (×3/2 exato)`,
);
ok(
  comTemporada * 2 === semTemporada * 3,
  "e a conta fecha sem sobra — fração de inteiros, não multiplicador decimal",
);

// bairro que não é de praia não muda
const naoPraia = { ...comEvento("alta-temporada"), props: estadoBase({ caruaru: 1 }).props };
ok(
  (await aluguel(naoPraia, "caruaru")) === CASA.caruaru.aluguel[0],
  "a alta temporada não mexe em quem não é de praia",
);

/* ── obra na avenida: o grupo sorteado paga metade ──────────────────────── */

const obra = {
  ...comEvento("obra", { grupo: "verde" }),
  props: estadoBase({ ipanema: 1 }).props,
};
ok(
  (await aluguel(obra, "ipanema")) === Math.trunc(CASA.ipanema.aluguel[0] / 2),
  `obra no verde: Ipanema cai para R$ ${Math.trunc(CASA.ipanema.aluguel[0] / 2)}`,
);
const obraOutro = {
  ...comEvento("obra", { grupo: "marrom" }),
  props: estadoBase({ ipanema: 1 }).props,
};
ok(
  (await aluguel(obraOutro, "ipanema")) === CASA.ipanema.aluguel[0],
  "e não mexe nos outros grupos",
);

/* ── greve: transporte não cobra nada ──────────────────────────────────── */

const greve = { ...comEvento("greve"), props: estadoBase({ congonhas: 1 }).props };
ok((await aluguel(greve, "congonhas")) === 0, "greve: transporte não cobra aluguel nenhum");
const greveBairro = { ...comEvento("greve"), props: estadoBase({ ipanema: 1 }).props };
ok(
  (await aluguel(greveBairro, "ipanema")) === CASA.ipanema.aluguel[0],
  "e a greve não mexe em bairro",
);

/* ── feriadão: o salário dobra ─────────────────────────────────────────── */

const salarioNormal = (
  await db.query(
    `select public.met_salario(gt.data, $1::jsonb) v from public.game_themes gt where gt.id = 'capibara'`,
    [JSON.stringify(estadoBase())],
  )
).rows[0].v;
ok(Number(salarioNormal) === CIDADE.regras.salario, "sem evento, o salário é o da regra");
const salarioFeriado = (
  await db.query(
    `select public.met_salario(gt.data, $1::jsonb) v from public.game_themes gt where gt.id = 'capibara'`,
    [JSON.stringify(comEvento("feriadao"))],
  )
).rows[0].v;
ok(
  Number(salarioFeriado) === CIDADE.regras.salario * 2,
  `feriadão: o salário vai a R$ ${salarioFeriado}`,
);

/* ── o sorteio: a cada cinco rodadas, valendo por três ─────────────────── */

async function sorteia(estado, rodada, seed = 4242) {
  const r = await db.query(
    `select public.met_evento(gt.data, $1::jsonb, $2::bigint, $3) v
       from public.game_themes gt where gt.id = 'capibara'`,
    [JSON.stringify(estado), seed, rodada],
  );
  return r.rows[0].v;
}

const semEvento = { ...estadoBase(), round: 3, evento: null };
ok(
  (await sorteia(semEvento, 3)).evento === null,
  "na rodada 3 não há sorteio — é a cada cinco",
);
const na5 = await sorteia({ ...estadoBase(), round: 5, evento: null }, 5);
ok(!!na5.evento, `na rodada 5 sai um evento (${na5.evento?.id})`);
ok(na5.evento.desde === 5 && na5.evento.ate === 7, "e ele vale por três rodadas: 5, 6 e 7");
ok(
  na5.log.some((l) => l.k === "evento"),
  "a manchete entra no registro",
);

// enquanto vale, não sorteia outro
const na6 = await sorteia({ ...na5, round: 6 }, 6);
ok(na6.evento?.id === na5.evento.id, "na rodada 6 o mesmo evento continua");

// e expira na 8
const na8 = await sorteia({ ...na5, round: 8 }, 8);
ok(na8.evento === null, "na rodada 8 ele expirou");
ok(
  na8.log.some((l) => l.k === "evento-fim"),
  "e o fim também entra no registro",
);

// o sorteio é da semente: a mesma semente e rodada dão o mesmo evento
const outraVez = await sorteia({ ...estadoBase(), round: 5, evento: null }, 5);
ok(
  outraVez.evento?.id === na5.evento.id,
  "o sorteio é reprodutível pela semente — e a semente o cliente não lê, então ninguém sabe o que vem",
);
const outraSemente = await sorteia({ ...estadoBase(), round: 5, evento: null }, 5, 99999);
ok(
  typeof outraSemente.evento?.id === "string",
  `outra semente dá outro sorteio (${outraSemente.evento?.id})`,
);

/* ── O SORTEIO É JUSTO? ────────────────────────────────────────────────────
   Este teste substituiu um fraco — "em quarenta sementes a obra sai pelo menos
   uma vez" — e a substituição não foi cosmética: o teste fraco FALHOU, e a
   causa era um viés grave no embaralhamento que decidia três jogos.

   `shuffle_text` era um Fisher-Yates com gerador congruente linear de módulo
   2^31, lendo os BITS BAIXOS (`s % i`). Nesses geradores os bits baixos têm
   período curtíssimo, e para semente múltipla de mil o primeiro passo dava
   sempre 1 módulo 8. Medido: dois dos seis eventos NUNCA saíam, e um saía em
   52% das partidas. A mesma função sorteia o caso do Dossiê, a repartição de
   territórios do Domínio e os dois baralhos da Metrópole.

   A lição para o teste: verificar que "acontece pelo menos uma vez" não mede
   sorteio. O que mede é a DISTRIBUIÇÃO, e é isso que está aqui. Se o viés
   voltar, este teste reprova na hora. Ver a migração 0038. */
const SORTEIOS = 300;
const contagem = new Map();
for (let seed = 1; seed <= SORTEIOS; seed++) {
  const r = await sorteia({ ...estadoBase(), round: 5, evento: null }, 5, seed * 1000);
  const id = r.evento?.id;
  contagem.set(id, (contagem.get(id) ?? 0) + 1);
}
const justo = SORTEIOS / 6;
const faltando = CIDADE.eventos.filter((e) => !contagem.has(e.id)).map((e) => e.id);
ok(
  faltando.length === 0,
  faltando.length === 0
    ? `os seis eventos aparecem em ${SORTEIOS} sementes espaçadas`
    : `evento que NUNCA sai: ${faltando.join(", ")} — o embaralhamento está enviesado`,
);
const piorDesvio = Math.max(...[...contagem.values()].map((n) => Math.abs(n - justo)));
ok(
  piorDesvio <= justo * 0.45,
  `a distribuição é plausível: esperado ${justo} de cada, pior desvio ${piorDesvio} ` +
    `(${[...contagem.entries()].map(([k, v]) => `${k}=${v}`).join(" ")})`,
);

// a obra sorteia um grupo, e ele existe
let achouObra = null;
for (let seed = 1; seed <= 60 && !achouObra; seed++) {
  const r = await sorteia({ ...estadoBase(), round: 5, evento: null }, 5, seed * 1000);
  if (r.evento?.id === "obra") achouObra = r.evento;
}
ok(!!achouObra, "a obra na avenida sai, e ela é a que sorteia um grupo");
if (achouObra) {
  ok(
    CIDADE.grupos.some((g) => g.id === achouObra.grupo),
    `e o grupo sorteado existe no tabuleiro (${achouObra.grupo})`,
  );
}

/* ── boom imobiliário e aperto de crédito, via RPC ─────────────────────── */

const sala5 = (await rpc(P[0].token, "create_room", { p_game: "metropole" })).body;
await rpc(P[1].token, "join_room", { p_code: sala5.code });
const jogo5 = (await rpc(P[0].token, "met_start", { p_room: sala5.id })).body;
const seat0de5 = (
  await db.query("select user_id from match_players where match_id = $1 and seat = 0", [jogo5.id])
).rows[0].user_id;
const D = P.find((x) => x.id === seat0de5);

/** o azul-escuro inteiro no assento 0, com caixa e a fase de agir */
async function armaAzul(evento) {
  const props = {};
  for (const c of CIDADE.casas) {
    if (!c.id) continue;
    props[c.id] = { owner: null, casas: 0, hotel: false, hipotecada: false };
  }
  props["leblon"] = { owner: 0, casas: 0, hotel: false, hipotecada: false };
  props["jardins"] = { owner: 0, casas: 0, hotel: false, hipotecada: false };
  props["congonhas"] = { owner: 0, casas: 0, hotel: false, hipotecada: false };
  const e5 = await leia(jogo5.id);
  await poe(jogo5.id, {
    props,
    round: 5,
    evento,
    turnSeat: 0,
    phase: "acao",
    pendente: null,
    leilao: null,
    players: { ...e5.players, 0: { ...e5.players[0], cash: 60000 } },
  });
}

await armaAzul(null);
const custoNormal = await rpc(D.token, "met_build", {
  p_match: jogo5.id,
  p_prop: "leblon",
  p_n: 1,
});
const caixaDepoisNormal = custoNormal.body.public_state.players[0].cash;
ok(
  caixaDepoisNormal === 60000 - CASA.leblon.casa,
  `sem evento, a casa do azul-escuro custa R$ ${CASA.leblon.casa}`,
);

await armaAzul({ ...EV["boom"], desde: 5, ate: 7 });
const comBoom = await rpc(D.token, "met_build", {
  p_match: jogo5.id,
  p_prop: "leblon",
  p_n: 1,
});
const esperadoBoom = Math.trunc((CASA.leblon.casa * 7) / 10);
ok(
  comBoom.body.public_state.players[0].cash === 60000 - esperadoBoom,
  `no boom imobiliário a mesma casa custa R$ ${esperadoBoom} (×7/10 exato)`,
);

await armaAzul({ ...EV["aperto"], desde: 5, ate: 7 });
const hipAperto = await rpc(D.token, "met_mortgage", {
  p_match: jogo5.id,
  p_prop: "congonhas",
});
const rendeAperto = Math.trunc((CASA.congonhas.hipoteca * 4) / 5);
ok(
  hipAperto.body.public_state.players[0].cash === 60000 + rendeAperto,
  `no aperto de crédito, hipotecar rende R$ ${rendeAperto} em vez de R$ ${CASA.congonhas.hipoteca} (×4/5)`,
);
const resgAperto = await rpc(D.token, "met_unmortgage", {
  p_match: jogo5.id,
  p_prop: "congonhas",
});
const custoAperto = Math.trunc((CASA.congonhas.hipoteca * 6) / 5);
ok(
  resgAperto.body.public_state.players[0].cash === 60000 + rendeAperto - custoAperto,
  `e resgatar custa R$ ${custoAperto} — 20% de juros em vez de 10% (×6/5)`,
);

// sem o aperto, os 10% de sempre — e em conta INTEIRA
await armaAzul(null);
await rpc(D.token, "met_mortgage", { p_match: jogo5.id, p_prop: "congonhas" });
const resgNormal = await rpc(D.token, "met_unmortgage", {
  p_match: jogo5.id,
  p_prop: "congonhas",
});
const custoNormal10 = Math.trunc((CASA.congonhas.hipoteca * 110) / 100);
ok(
  resgNormal.body.public_state.players[0].cash ===
    60000 + CASA.congonhas.hipoteca - custoNormal10,
  `fora do aperto, resgatar custa os 10% de sempre: R$ ${custoNormal10}`,
);

/* ══════════════════════════════════════════════════════════════════════════
   O CÉREBRO DA MÁQUINA NA METRÓPOLE

   UM PASSO POR CHAMADA, e é aqui que isso se prova. `met_bot_passo` faz
   exatamente uma coisa e diz o que fez: "rola(1)", "compra(1) caruaru por 600",
   "constroi(1) em caruaru por 500", "passa(1)". O cliente chama, respira, chama
   de novo — e a pessoa VÊ a máquina decidir, que num jogo de tabuleiro é metade
   do jogo.

   O que este bloco prova, em ordem de importância:

   1. UMA PARTIDA SOLO INTEIRA, do começo ao fim, com a economia conferida a
      cada passo: dinheiro nunca negativo fora de dívida, casa nunca em
      propriedade hipotecada, construção nunca desigual dentro do grupo, banco
      nunca com casa negativa. Um cérebro que quebra a economia na rodada
      dezoito é pior que nenhum: quebra depois de a pessoa ter investido a
      partida toda.

   2. A MÁQUINA AGE FORA DA PRÓPRIA VEZ. Leilão e proposta de troca. Se ela só
      agisse na vez dela, um leilão com duas máquinas travaria para sempre.

   3. O NÍVEL SIGNIFICA ALGO — e aqui a medida é patrimônio, não território.

   4. A MÁQUINA NÃO TRAPACEIA: ela joga pelas funções de 0053, as mesmas de uma
      pessoa. Conferido no estado, não no código.
   ══════════════════════════════════════════════════════════════════════════ */

console.log("\n  ── o cérebro da máquina ──");

/** Confere a economia inteira. Lista vazia é bom. */
function conferirEconomia(st, mapa) {
  const p = [];
  const porId = Object.fromEntries((mapa.casas ?? []).map((c) => [c.id, c]));

  for (const [seat, j] of Object.entries(st.players ?? {})) {
    if (typeof j.cash !== "number") p.push(`assento ${seat} sem caixa`);
    // negativo só se vale enquanto há dívida pendente para ELE
    const devendo =
      st.pendente?.k === "divida" && String(st.turnSeat) === String(seat);
    if (j.cash < 0 && !devendo && !j.quebrado) {
      p.push(`assento ${seat} com ${j.cash} sem dívida pendente`);
    }
    if (j.pos < 0 || j.pos > 39) p.push(`assento ${seat} na casa ${j.pos}`);
  }

  const porGrupo = {};
  for (const [id, e] of Object.entries(st.props ?? {})) {
    const casa = porId[id];
    if (!casa) {
      p.push(`${id} não existe no mapa`);
      continue;
    }
    const n = e.casas ?? 0;
    if (n < 0 || n > 4) p.push(`${id} com ${n} casas`);
    if (n > 0 && e.hipotecada) p.push(`${id} tem ${n} casas E está hipotecada`);
    if (n > 0 && e.owner === null) p.push(`${id} tem casa e nenhum dono`);
    if (e.hotel && n !== 0) p.push(`${id} tem hotel e ${n} casas`);
    if (e.owner !== null && e.owner !== undefined && !st.players[String(e.owner)]) {
      p.push(`${id} é do assento ${e.owner}, que não existe`);
    }
    if (casa.g && e.owner !== null && e.owner !== undefined) {
      const k = `${e.owner}:${casa.g}`;
      porGrupo[k] = porGrupo[k] ?? [];
      porGrupo[k].push(n + (e.hotel ? 5 : 0));
    }
  }
  /* CONSTRUÇÃO PAR: dentro de um grupo, duas propriedades nunca diferem de mais
     de uma casa. É a regra que impede concentrar tudo numa só, e é exatamente o
     tipo de coisa que uma máquina mal escrita viola sem dar erro. */
  for (const [k, ns] of Object.entries(porGrupo)) {
    if (Math.max(...ns) - Math.min(...ns) > 1) {
      p.push(`grupo ${k} construído desigual: ${ns.join(",")}`);
    }
  }

  if ((st.bank?.casas ?? 0) < 0) p.push(`banco com ${st.bank.casas} casas`);
  if ((st.bank?.hoteis ?? 0) < 0) p.push(`banco com ${st.bank.hoteis} hotéis`);
  if (!["rolar", "acao", "resolve", "leilao", "fim"].includes(st.phase)) {
    p.push(`fase impossível: ${st.phase}`);
  }
  return p;
}

/**
 * Joga uma partida solo até o fim, ou até o teto de passos.
 *
 * O humano é PASSIVO MAS NÃO SUICIDA: compra o que cai e cabe no caixa, nunca
 * constrói, nunca negocia. Passivo porque o que se mede é a máquina; não
 * suicida porque um humano que quebra na rodada três encerra a partida antes de
 * a máquina mostrar o que sabe.
 */
async function metSolo({ token, niveis, tetoPassos }) {
  const salaS = (await rpc(token, "create_room", { p_game: "metropole" })).body;
  for (const n of niveis) {
    const r = await rpc(token, "adicionar_bot", { p_room: salaS.id, p_nivel: n });
    if (r.status !== 200) return { erro: `adicionar_bot(${n}): ${JSON.stringify(r.body)}` };
  }
  const ini = await rpc(token, "met_start", { p_room: salaS.id });
  if (ini.status !== 200) return { erro: `met_start: ${JSON.stringify(ini.body)}` };
  const idP = ini.body.id;

  const elenco = (
    await db.query(
      `select mp.seat, p.is_bot from match_players mp
        join profiles p on p.id = mp.user_id where mp.match_id = $1 order by mp.seat`,
      [idP],
    )
  ).rows;
  const meu = Number(elenco.find((e) => !e.is_bot).seat);
  const bots = elenco.filter((e) => e.is_bot).map((e) => Number(e.seat));

  const mapa = (
    await db.query(
      `select gt.data d from game_themes gt join matches m on gt.id = (m.public_state ->> 'map')
        where m.id = $1`,
      [idP],
    )
  ).rows[0].d;

  const problemas = [];
  const passos = [];
  let n = 0;
  let acabou = false;
  let semNada = 0;

  while (n < tetoPassos) {
    const linha = (
      await db.query("select status, public_state from matches where id = $1", [idP])
    ).rows[0];
    const st = linha.public_state;
    if (linha.status !== "running") {
      acabou = true;
      break;
    }

    const ruim = conferirEconomia(st, mapa);
    if (ruim.length) {
      problemas.push(`passo ${n} (fase ${st.phase}): ${ruim.slice(0, 3).join("; ")}`);
      break;
    }

    /* A máquina primeiro: ela pode ter passo pendente FORA da vez (leilão,
       troca). E o passo vai pela conexão DIRETA, não pelo HTTP.

       Cada passo por `met_tocar` custava um round-trip até o Supabase — ~150ms
       — e uma partida solo tem 240 passos. Pela conexão pg o mesmo passo custa
       ~5ms, e a suíte inteira deixou de levar dez minutos.

       O caminho do RPC não fica sem teste: ele tem asserções próprias logo
       acima (recusa quem não está na mesa, devolve o rótulo do passo). O que a
       partida longa mede é o CÉREBRO, e `met_tocar` não faz nada além de
       conferir quem chamou e chamar `met_bot_passo`. */
    const passo = (
      await db.query("select public.met_bot_passo($1::uuid) p", [idP])
    ).rows[0].p;
    if (passo) {
      passos.push(passo);
      semNada = 0;
      n++;
      continue;
    }

    /* Nada de máquina: é a vez do humano passivo.

       `semNada` conta chamadas SEGUIDAS em que ninguém agiu — e a ação do
       humano abaixo zera o contador, porque ela é alguém agindo. A primeira
       versão deste laço não zerava, e quatro turnos normais do humano
       abortavam a partida com "ninguém tem o que fazer". */
    semNada++;
    if (semNada > 3) {
      problemas.push(
        `ninguém tem o que fazer na fase ${st.phase} (vez do assento ${st.turnSeat})`,
      );
      break;
    }

    /* NO LEILÃO QUEM AGE É QUEM NÃO ESTÁ NA FRENTE, e não quem tem a vez.
       A primeira versão deste laço só deixava o humano agir quando
       `turnSeat === meu`, e a partida travava com o leilão aberto: a máquina
       era a maior oferta (não pode subir o próprio lance), o humano era o
       único que podia responder, e a vez era da máquina. Não era defeito do
       cérebro — era o laço não sabendo jogar Metrópole. */
    if (st.phase === "leilao" && st.leilao) {
      if (Number(st.leilao.altoSeat) !== meu) {
        await rpc(token, "met_pass", { p_match: idP });
        semNada = 0;
        n++;
        continue;
      }
      // ele está na frente e nenhuma máquina tem o que fazer: o leilão fecha
      // no relógio, e a faxina é quem cuida disso
      await db.query(
        "update matches set turn_deadline = now() - interval '1 second' where id = $1",
        [idP],
      );
      await varre("met_sweep");
      semNada = 0;
      n++;
      continue;
    }

    if (Number(st.turnSeat) !== meu) {
      problemas.push(
        `a vez é do assento ${st.turnSeat}, que é máquina, e met_tocar não fez nada` +
          ` · fase ${st.phase} · pendente ${JSON.stringify(st.pendente)}` +
          ` · leilao ${JSON.stringify(st.leilao)}` +
          ` · caixa ${st.players[String(st.turnSeat)]?.cash}` +
          ` · quebrado ${st.players[String(st.turnSeat)]?.quebrado}`,
      );
      break;
    }
    if (st.phase === "resolve" && st.pendente?.k === "divida") {
      // o humano passivo hipoteca até dar, e quebra se não der
      const minha = Object.entries(st.props).find(
        ([, e]) => Number(e.owner) === meu && !e.hipotecada && (e.casas ?? 0) === 0,
      );
      if (minha) await rpc(token, "met_mortgage", { p_match: idP, p_prop: minha[0] });
      else await rpc(token, "met_bankrupt", { p_match: idP });
      semNada = 0;
      n++;
      continue;
    }
    /* O HUMANO PASSIVO RESPONDE PROPOSTA — recusando.

       Deixar proposta pendurada não é só grosseria: cada uma ocupa uma das três
       vagas da máquina, e com as três cheias ela para de propor. O teste ficaria
       exercitando a proposta uma vez e nunca mais, e a impressão seria de que a
       funcionalidade funciona pouco quando na verdade é o teste que a estrangula.

       Recusar é o comportamento passivo certo: não dá vantagem à máquina e
       devolve a vaga. */
    const paraMim = (st.ofertas ?? []).find((o) => Number(o.para) === meu);
    if (paraMim) {
      await rpc(token, "met_offer_reply", {
        p_match: idP,
        p_id: paraMim.id,
        p_aceita: false,
      });
      semNada = 0;
      n++;
      continue;
    }

    if (st.phase === "rolar" && (st.players[String(meu)]?.jail ?? 0) > 0) {
      await rpc(token, "met_jail", { p_match: idP, p_escolha: "dado" });
      semNada = 0;
      n++;
      continue;
    }
    if (st.phase === "rolar") {
      await rpc(token, "met_roll", { p_match: idP });
      semNada = 0;
      n++;
      continue;
    }
    if (st.pendente?.k === "comprar") {
      const cash = st.players[String(meu)]?.cash ?? 0;
      const preco = st.pendente.preco ?? 0;
      /* Ele recusa o que passa de 1500 — e recusar é JOGADA, não concessão ao
         teste: propriedade recusada vai a leilão e pode sair mais barata. É
         também o que faz o leilão acontecer, que é o caso em que a máquina tem
         de agir FORA da própria vez. */
      const querComprar = cash - preco > 500 && preco <= 1500;
      await rpc(token, querComprar ? "met_buy" : "met_decline", { p_match: idP });
      semNada = 0;
      n++;
      continue;
    }
    if (st.phase === "acao") {
      const fim = await rpc(token, "met_end_turn", { p_match: idP });
      if (fim.status !== 200) {
        problemas.push(`humano não passou a vez: ${JSON.stringify(fim.body).slice(0, 130)}`);
        break;
      }
      semNada = 0;
      n++;
      continue;
    }
    problemas.push(`fase sem saída: ${st.phase}`);
    break;
  }

  const fim = (
    await db.query("select status, public_state from matches where id = $1", [idP])
  ).rows[0];
  const patr = {};
  for (const seat of Object.keys(fim.public_state.players ?? {})) {
    patr[seat] = Number(
      (
        await db.query(
          "select public.met_patrimonio($1::jsonb, $2::jsonb, $3::smallint) v",
          [JSON.stringify(mapa), JSON.stringify(fim.public_state), Number(seat)],
        )
      ).rows[0].v,
    );
  }
  return {
    id: idP,
    meu,
    bots,
    passos,
    n,
    acabou,
    problemas,
    st: fim.public_state,
    status: fim.status,
    patr,
    forcaBot: bots.reduce((a, s) => a + (patr[s] ?? 0), 0),
  };
}

/* ── 1. a recusa ─────────────────────────────────────────────────────────── */

const salaB = (await rpc(P[0].token, "create_room", { p_game: "metropole" })).body;
await rpc(P[0].token, "adicionar_bot", { p_room: salaB.id, p_nivel: "dificil" });
const iniB = await rpc(P[0].token, "met_start", { p_room: salaB.id });
ok(
  iniB.status === 200,
  `partida solo de Metrópole começa${iniB.status !== 200 ? " " + JSON.stringify(iniB.body).slice(0, 130) : ""}`,
);
const foraB = await rpc(P[2].token, "met_tocar", { p_match: iniB.body?.id });
ok(
  /NOT_A_PLAYER/.test(JSON.stringify(foraB.body)),
  "quem não está na mesa não toca a máquina de ninguém",
);

/* ── 2. UMA PARTIDA SOLO INTEIRA ─────────────────────────────────────────── */

/* O TETO DE PASSOS É FOLGA, NÃO LIMITE. Uma partida de vinte rodadas com três na
   mesa gasta uns setenta passos por rodada quando há leilão — e 1200 caía
   exatamente em cima disso, então o teste reprovava por chegar ao teto, não por
   a partida ter travado. Teto que é o resultado esperado não mede nada. */
const solo = await metSolo({ token: P[0].token, niveis: ["medio", "dificil"], tetoPassos: 2400 });
ok(!solo.erro, `a partida solo montou${solo.erro ? ": " + solo.erro : ""}`);
if (!solo.erro) {
  ok(
    solo.problemas.length === 0,
    solo.problemas.length === 0
      ? `${solo.n} passos e a economia nunca ficou inválida`
      : `ECONOMIA QUEBRADA: ${solo.problemas[0]}`,
  );
  /* O LAÇO DA PROPOSTA, que só uma partida inteira pegaria.

     Sem o teto de uma proposta por rodada (0070), duas máquinas ficam em
     propor-recusar-propor para sempre: recusar tira a oferta da lista, a vaga
     volta, e a proposta recomeça na mesma vez. Medido antes do conserto:
     propoe:535, troca:recusa:534 em 1200 passos.

     A checagem é de PROPORÇÃO e não de número absoluto: numa partida saudável a
     negociação é tempero, nunca o prato. */
  const propostas = solo.passos.filter((p) => p.startsWith("propoe")).length;
  ok(
    propostas <= solo.n / 8,
    `a negociação é tempero e não o prato: ${propostas} propostas em ${solo.n} passos` +
      " — sem teto por rodada, duas máquinas ficam em propor-recusar para sempre",
  );

  ok(
    solo.acabou,
    solo.acabou
      ? `e a partida ACABOU sozinha — a Metrópole é jogável sozinho`
      : `não acabou em ${solo.n} passos (rodada ${solo.st.round}) — ` +
        Object.entries(
          solo.passos.reduce((c, p) => {
            const k = p.split(/[ (]/)[0];
            c[k] = (c[k] ?? 0) + 1;
            return c;
          }, {}),
        )
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `${k}:${v}`)
          .join(" "),
  );
  console.log(`         primeiros passos: ${solo.passos.slice(0, 6).join(" · ")}`);
  console.log(
    `         patrimônio no fim: ${Object.entries(solo.patr)
      .map(([s, v]) => `assento ${s}=${v}`)
      .join(", ")}`,
  );

  const tipos = new Set(solo.passos.map((p) => p.split(/[:(]/)[0]));
  ok(
    tipos.has("rola") && tipos.has("passa"),
    `a máquina rolou e passou a vez (tipos de passo: ${[...tipos].join(", ")})`,
  );
  ok(
    solo.passos.some((p) => p.startsWith("compra")),
    `e comprou propriedade: ${solo.passos.find((p) => p.startsWith("compra")) ?? "nenhuma"}`,
  );

  /* AGIU FORA DA PRÓPRIA VEZ. Leilão é o caso que trava a mesa se a máquina não
     souber agir: o relógio dele é de vinte segundos e ninguém joga enquanto ele
     está aberto. */
  const noLeilao = solo.passos.filter((p) => p.startsWith("leilao")).length;
  ok(
    noLeilao > 0,
    noLeilao > 0
      ? `deu ${noLeilao} lance/passe em leilão — ela age FORA da própria vez`
      : "nenhum leilão aconteceu na partida: o teste não provou o caso fora-da-vez",
  );

  const mapaS = (
    await db.query(
      `select gt.data d from game_themes gt join matches m on gt.id = (m.public_state ->> 'map')
        where m.id = $1`,
      [solo.id],
    )
  ).rows[0].d;
  ok(
    conferirEconomia(solo.st, mapaS).length === 0,
    "e o estado final também fecha",
  );
}

/* ── 2b. o leilão, provocado de propósito ─────────────────────────────────── */

/* Esperar que um leilão aconteça sozinho não serve de teste: na primeira versão
   deste bloco a mesa inteira comprou tudo e nenhum leilão abriu. Então o leilão
   é PROVOCADO — o humano recusa a propriedade em que caiu, e o que se mede é a
   máquina dando lance na vez de OUTRA pessoa. */

const salaL = (await rpc(P[0].token, "create_room", { p_game: "metropole" })).body;
await rpc(P[0].token, "adicionar_bot", { p_room: salaL.id, p_nivel: "dificil" });
const iniL = await rpc(P[0].token, "met_start", { p_room: salaL.id });
const elencoL = (
  await db.query(
    `select mp.seat, p.is_bot from match_players mp join profiles p on p.id = mp.user_id
      where mp.match_id = $1 order by mp.seat`,
    [iniL.body.id],
  )
).rows;
const meuL = Number(elencoL.find((e) => !e.is_bot).seat);

// põe a vez no humano, na fase de compra de uma propriedade barata
const propL = (
  await db.query(
    `select c ->> 'id' id, (c ->> 'preco')::int preco
       from game_themes gt
       join matches m on gt.id = (m.public_state ->> 'map')
       cross join jsonb_array_elements(gt.data -> 'casas') c
      where m.id = $1 and c ->> 't' = 'bairro'
      order by (c ->> 'preco')::int limit 1`,
    [iniL.body.id],
  )
).rows[0];
await db.query(
  `update matches set public_state =
      jsonb_set(jsonb_set(jsonb_set(public_state, '{turnSeat}', to_jsonb($2::int)),
        '{phase}', '"acao"'),
        '{pendente}', jsonb_build_object('k', 'comprar', 'prop', $3::text, 'preco', $4::int))
    where id = $1`,
  [iniL.body.id, meuL, propL.id, propL.preco],
);

const recusou = await rpc(P[0].token, "met_decline", { p_match: iniL.body.id });
ok(
  recusou.status === 200,
  `o humano recusa ${propL.id} por ${propL.preco} e vai a leilão${recusou.status !== 200 ? " " + JSON.stringify(recusou.body).slice(0, 120) : ""}`,
);
const abriu = (
  await db.query("select public_state ps from matches where id = $1", [iniL.body.id])
).rows[0].ps;
ok(abriu.phase === "leilao" && !!abriu.leilao, `o leilão abriu (fase ${abriu.phase})`);

if (abriu.phase === "leilao") {
  const passoL = await rpc(P[0].token, "met_tocar", { p_match: iniL.body.id });
  ok(
    /^leilao:/.test(passoL.body?.passo ?? ""),
    `e a máquina age FORA da própria vez: ${passoL.body?.passo ?? "não fez nada"}`,
  );
  const depoisL = (
    await db.query("select public_state ps from matches where id = $1", [iniL.body.id])
  ).rows[0].ps;
  const botL = Number(elencoL.find((e) => e.is_bot).seat);
  ok(
    Number(depoisL.leilao?.altoSeat) === botL ||
      (depoisL.leilao?.passou ?? []).map(Number).includes(botL) ||
      depoisL.phase !== "leilao",
    "o lance dela entrou no leilão, ou ela passou — nunca ficou parada travando a mesa",
  );
  if (Number(depoisL.leilao?.altoSeat) === botL) {
    ok(
      Number(depoisL.leilao.alto) >= 100,
      `o lance respeita o mínimo da casa: R$ ${depoisL.leilao.alto}`,
    );
  }
}

/* ── 2c. ninguém fica esperando: a faxina JOGA a máquina ───────────────

   No celular, sair do aplicativo JÁ é fechar a aba — e o modo solo é justamente
   onde isso mais acontece. Se a faxina PULASSE o turno da máquina, ela viraria um
   jogador morto segurando escritura, e a pessoa voltaria para um jogo pior sem
   explicação. */

const salaF = (await rpc(P[0].token, "create_room", { p_game: "metropole" })).body;
await rpc(P[0].token, "adicionar_bot", { p_room: salaF.id, p_nivel: "medio" });
const iniF = await rpc(P[0].token, "met_start", { p_room: salaF.id });
const botF = Number(
  (
    await db.query(
      `select mp.seat from match_players mp join profiles p on p.id = mp.user_id
        where mp.match_id = $1 and p.is_bot limit 1`,
      [iniF.body.id],
    )
  ).rows[0].seat,
);
/* A FOTO VEM ANTES DE ESTOURAR O RELÓGIO — ver o comentário igual na suíte do
   Domínio. O `pg_cron` roda `met_sweep()` a cada minuto, e na ordem inversa a
   corrida decidia o resultado do teste. */
const antesF = (
  await db.query(
    "select jsonb_array_length(coalesce(public_state -> 'log', '[]'::jsonb)) n from matches where id = $1",
    [iniF.body.id],
  )
).rows[0].n;

await db.query(
  `update matches set
     public_state = jsonb_set(jsonb_set(public_state, '{turnSeat}', to_jsonb($2::int)),
       '{phase}', '\"rolar\"'),
     turn_deadline = now() - interval '1 second'
   where id = $1`,
  [iniF.body.id, botF],
);
/* A faxina só age em mesa com gente por perto (0071), então o teste diz que há
   gente — que é a verdade que ele está simulando. `last_seen_at` nasce em `now()`,
   mas uma suíte longa pode passar dos quinze minutos, e teste que reprova por
   ter demorado é teste que ensina a ignorar a saída vermelha. */
await rpc(P[0].token, "touch_presence", { p_room: salaF.id });

await varre("met_sweep");
const depoisF = (
  await db.query(
    `select jsonb_array_length(coalesce(public_state -> 'log', '[]'::jsonb)) n,
            (public_state ->> 'turnSeat')::int t, status
       from matches where id = $1`,
    [iniF.body.id],
  )
).rows[0];
ok(
  Number(depoisF.n) > Number(antesF),
  `a faxina JOGOU o turno da máquina em vez de pulá-lo (registro foi de ${antesF} para ${depoisF.n} linhas)`,
);
ok(
  Number(depoisF.t) !== botF || depoisF.status !== "running",
  `e a vez saiu dela (${botF} → ${depoisF.t}): máquina pulada é jogador morto segurando escritura`,
);

/* ── 3. a máquina responde proposta ───────────────────────────────────────── */

/* Proposta sem resposta é pior que proposta recusada: quem propôs fica
   esperando e não sabe se pode contar com aquilo. */
const salaT = (await rpc(P[0].token, "create_room", { p_game: "metropole" })).body;
await rpc(P[0].token, "adicionar_bot", { p_room: salaT.id, p_nivel: "dificil" });
const iniT = await rpc(P[0].token, "met_start", { p_room: salaT.id });
const elencoT = (
  await db.query(
    `select mp.seat, p.is_bot from match_players mp join profiles p on p.id = mp.user_id
      where mp.match_id = $1 order by mp.seat`,
    [iniT.body.id],
  )
).rows;
const meuT = Number(elencoT.find((e) => !e.is_bot).seat);
const botT = Number(elencoT.find((e) => e.is_bot).seat);

// dá uma propriedade a cada um, à mão, e propõe uma troca absurdamente boa
const stT = iniT.body.public_state;
const idsT = Object.keys(stT.props).slice(0, 2);
await db.query(
  `update matches set public_state = jsonb_set(
       jsonb_set(public_state, array['props', $2::text, 'owner'], to_jsonb($4::int)),
       array['props', $3::text, 'owner'], to_jsonb($5::int))
    where id = $1`,
  [iniT.body.id, idsT[0], idsT[1], meuT, botT],
);
const prop = await rpc(P[0].token, "met_offer", {
  p_match: iniT.body.id,
  p_para: botT,
  p_da: { props: [idsT[0]], cash: 5000 },
  p_quer: {},
});
ok(
  prop.status === 200,
  `proposta generosa enviada à máquina${prop.status !== 200 ? " " + JSON.stringify(prop.body).slice(0, 120) : ""}`,
);
if (prop.status === 200) {
  const resp = await rpc(P[0].token, "met_tocar", { p_match: iniT.body.id });
  ok(
    /^troca:aceita/.test(resp.body?.passo ?? ""),
    `e a máquina ACEITA o que é bom para ela: ${resp.body?.passo ?? "não respondeu"}`,
  );
  const semOferta = (
    await db.query(
      "select jsonb_array_length(coalesce(public_state -> 'ofertas', '[]'::jsonb)) n from matches where id = $1",
      [iniT.body.id],
    )
  ).rows[0].n;
  ok(
    Number(semOferta) === 0,
    "e a proposta sai da mesa respondida — proposta pendurada é pior que recusada",
  );
}

/* ── 3b. a máquina PROPÕE troca ────────────────────────────────

   Numa mesa solo, uma máquina que só RESPONDE proposta tira metade da Metrópole
   do jogo. Mas esperar que a situação aconteça numa partida não serve de teste:
   ela só propõe quando falta UMA escritura para fechar um grupo dela, e isso pode
   não ocorrer em vinte rodadas — na primeira execução depois de 0064, não
   ocorreu. Então a situação é montada de propósito. */

const salaP = (await rpc(P[0].token, "create_room", { p_game: "metropole" })).body;
await rpc(P[0].token, "adicionar_bot", { p_room: salaP.id, p_nivel: "dificil" });
const iniP = await rpc(P[0].token, "met_start", { p_room: salaP.id });
const elencoP = (
  await db.query(
    `select mp.seat, p.is_bot from match_players mp join profiles p on p.id = mp.user_id
      where mp.match_id = $1 order by mp.seat`,
    [iniP.body.id],
  )
).rows;
const meuP = Number(elencoP.find((e) => !e.is_bot).seat);
const botP = Number(elencoP.find((e) => e.is_bot).seat);

// um grupo de cor: a máquina fica com todas menos uma, e a pessoa com a que falta
const grupoP = (
  await db.query(
    `select c ->> 'id' id, c ->> 'g' g
       from game_themes gt
       join matches m on gt.id = (m.public_state ->> 'map')
       cross join jsonb_array_elements(gt.data -> 'casas') c
      where m.id = $1 and c ->> 'g' = 'marrom'
      order by (c ->> 'pos')::int`,
    [iniP.body.id],
  )
).rows;

let estadoP = (
  await db.query("select public_state ps from matches where id = $1", [iniP.body.id])
).rows[0].ps;
/* O TABULEIRO COMEÇA LIMPO. Sem isso, as três escrituras do sorteio inicial
   podiam já fechar um grupo para a máquina — e aí ela CONSTRÓI em vez de propor,
   que é a decisão certa e faz o teste reprovar pelo motivo errado. Medido:
   "constroi(1) em jardins por 2000". */
for (const k of Object.keys(estadoP.props)) {
  estadoP.props[k] = { owner: null, casas: 0, hotel: false, hipotecada: false };
}
grupoP.forEach((c, i) => {
  estadoP.props[c.id] = {
    owner: i === 0 ? meuP : botP,
    casas: 0,
    hotel: false,
    hipotecada: false,
  };
});
estadoP.turnSeat = botP;
estadoP.phase = "acao";
estadoP.pendente = null;
estadoP.players[String(botP)].cash = 12000;
await db.query("update matches set public_state = $2::jsonb where id = $1", [
  iniP.body.id,
  JSON.stringify(estadoP),
]);

const passoP = (
  await db.query("select public.met_bot_passo($1::uuid) p", [iniP.body.id])
).rows[0].p;
ok(
  /^propoe/.test(passoP ?? ""),
  `faltando uma escritura para fechar o grupo, ela PROPÕE: ${passoP ?? "não propos"}`,
);

const ofertaP = (
  await db.query(
    "select public_state -> 'ofertas' o from matches where id = $1",
    [iniP.body.id],
  )
).rows[0].o;
if (Array.isArray(ofertaP) && ofertaP.length) {
  const o = ofertaP[0];
  const preco = (
    await db.query(
      `select (c ->> 'preco')::int p from game_themes gt
        join matches m on gt.id = (m.public_state ->> 'map')
        cross join jsonb_array_elements(gt.data -> 'casas') c
       where m.id = $1 and c ->> 'id' = $2`,
      [iniP.body.id, grupoP[0].id],
    )
  ).rows[0].p;
  ok(
    Number(o.de) === botP && Number(o.para) === meuP,
    `a proposta é dela para mim (de ${o.de} para ${o.para})`,
  );
  ok(
    (o.quer?.props ?? []).includes(grupoP[0].id),
    `e ela pede exatamente a escritura que FECHA o grupo dela (${(o.quer?.props ?? []).join(", ")})`,
  );
  ok(
    Number(o.da?.cash ?? 0) >= preco,
    `e paga acima da tabela: R$ ${o.da?.cash} por uma de R$ ${preco} — proposta ofensiva gasta uma vaga por nada`,
  );
}

/* E a tranquila NÃO propõe, pela mesma razão que não aceita. */
const salaQ = (await rpc(P[0].token, "create_room", { p_game: "metropole" })).body;
await rpc(P[0].token, "adicionar_bot", { p_room: salaQ.id, p_nivel: "facil" });
const iniQ = await rpc(P[0].token, "met_start", { p_room: salaQ.id });
const botQ = Number(
  (
    await db.query(
      `select mp.seat from match_players mp join profiles p on p.id = mp.user_id
        where mp.match_id = $1 and p.is_bot limit 1`,
      [iniQ.body.id],
    )
  ).rows[0].seat,
);
const meuQ = botQ === 0 ? 1 : 0;
let estadoQ = (
  await db.query("select public_state ps from matches where id = $1", [iniQ.body.id])
).rows[0].ps;
for (const k of Object.keys(estadoQ.props)) {
  estadoQ.props[k] = { owner: null, casas: 0, hotel: false, hipotecada: false };
}
grupoP.forEach((c, i) => {
  estadoQ.props[c.id] = {
    owner: i === 0 ? meuQ : botQ,
    casas: 0,
    hotel: false,
    hipotecada: false,
  };
});
estadoQ.turnSeat = botQ;
estadoQ.phase = "acao";
estadoQ.pendente = null;
estadoQ.players[String(botQ)].cash = 12000;
await db.query("update matches set public_state = $2::jsonb where id = $1", [
  iniQ.body.id,
  JSON.stringify(estadoQ),
]);
const passoQ = (
  await db.query("select public.met_bot_passo($1::uuid) p", [iniQ.body.id])
).rows[0].p;
ok(
  !/^propoe/.test(passoQ ?? ""),
  `na MESMA situação, a tranquila não propõe (${passoQ}) — não negociar é o comportamento de quem ainda não entendeu o jogo`,
);

/* ── 4. o nível significa algo? ──────────────────────────────────────────── */

const contraFacil = await metSolo({ token: P[0].token, niveis: ["facil"], tetoPassos: 700 });
const contraDif = await metSolo({ token: P[0].token, niveis: ["dificil"], tetoPassos: 700 });
ok(
  !contraFacil.erro && !contraDif.erro,
  `as duas partidas de comparação montaram${contraFacil.erro || contraDif.erro ? ": " + (contraFacil.erro ?? contraDif.erro) : ""}`,
);
if (!contraFacil.erro && !contraDif.erro) {
  ok(
    contraFacil.problemas.length === 0 && contraDif.problemas.length === 0,
    contraFacil.problemas.length === 0 && contraDif.problemas.length === 0
      ? "as duas rodaram sem quebrar a economia"
      : `ECONOMIA QUEBRADA: ${contraFacil.problemas[0] ?? contraDif.problemas[0]}`,
  );
  /* O QUE O NÍVEL SIGNIFICA NA METRÓPOLE NÃO É PATRIMÔNIO, e a primeira versão
     deste teste mediu errado: comparou patrimônio final e a TRANQUILA saiu na
     frente (49.260 contra 44.320). E fazia sentido — ela compra tudo, e
     patrimônio conta escritura pelo preço de tabela. Comprar tudo não é ruim
     para o patrimônio; é ruim para a SOLVÊNCIA e para o aluguel.

     Então o teste mede os três comportamentos que os níveis DEFINEM, um a um.
     Três afirmações que se leem valem mais que um número que esconde o que
     está sendo comparado. */

  /* O QUE O NÍVEL SIGNIFICA NA METRÓPOLE, e as duas versões erradas antes desta.

     A primeira comparou PATRIMÔNIO final, e a tranquila saiu na frente (49.260
     contra 44.320). Fazia sentido: ela compra tudo, e patrimônio conta
     escritura pelo preço de tabela. Comprar tudo não é ruim para o patrimônio.

     A segunda comparou CAIXA final, e virou de uma rodada para outra (2.840
     contra 7.740). Também fazia sentido, e por um motivo melhor: a impiedosa
     converte caixa em CASA. A regra da reserva governa a DECISÃO de gastar, e
     medir o estado final é medir o outro lado dela.

     Então o nível é conferido onde ele mora — nas duas funções que o definem, com
     número exato e sem dado nenhum no meio. E o comportamento observado vira
     relatório, porque uma partida é uma amostra de um e amostra de um não prova
     tendência. */

  const regua = (
    await db.query(
      `select public.met_bot_reserva('facil', 5) f,
              public.met_bot_reserva('medio', 5) m,
              public.met_bot_reserva('dificil', 5) d`,
    )
  ).rows[0];
  ok(
    Number(regua.f) === 0 && Number(regua.f) < Number(regua.m) && Number(regua.m) < Number(regua.d),
    `a reserva de caixa cresce com o nível: tranquila R$ ${regua.f}, firme R$ ${regua.m}, impiedosa R$ ${regua.d}`,
  );

  /* E O VALOR DE UMA PROPRIEDADE QUE FECHA GRUPO. Para a tranquila, valor é
     preço e nada mais — ela não vê o mapa, só a etiqueta. Para as outras duas, a
     que fecha grupo vale o dobro, porque é ela que libera construir. */
  const mapaN = (
    await db.query(
      `select gt.data d from game_themes gt join matches m on gt.id = (m.public_state ->> 'map')
        where m.id = $1`,
      [solo.id],
    )
  ).rows[0].d;
  const grupoN = mapaN.casas.filter((c) => c.g === "marrom");
  const estN = {
    players: { 0: { cash: 20000 }, 1: { cash: 20000 } },
    props: Object.fromEntries(
      mapaN.casas
        .filter((c) => c.id)
        .map((c) => [
          c.id,
          { owner: c.g === "marrom" && c.id !== grupoN[0].id ? 1 : null, casas: 0, hotel: false, hipotecada: false },
        ]),
    ),
  };
  const valores = (
    await db.query(
      `select public.met_bot_valor($1::jsonb, $2::jsonb, 1::smallint, $3::text, 'facil') f,
              public.met_bot_valor($1::jsonb, $2::jsonb, 1::smallint, $3::text, 'medio') m,
              public.met_bot_valor($1::jsonb, $2::jsonb, 1::smallint, $3::text, 'dificil') d`,
      [JSON.stringify(mapaN), JSON.stringify(estN), grupoN[0].id],
    )
  ).rows[0];
  ok(
    Number(valores.f) < Number(valores.m) && Number(valores.m) <= Number(valores.d),
    `a que FECHA o grupo vale mais para quem entende o jogo: tranquila vê R$ ${valores.f} (o preço), firme R$ ${valores.m}, impiedosa R$ ${valores.d}`,
  );

  /* A TERCEIRA ASSERÇÃO COMPORTAMENTAL TAMBÉM CAIU, e pelo mesmo motivo das duas
     anteriores: "a tranquila compra mais" é verdade em média e falso em partidas
     individuais — mediu 8 contra 7, depois 9 contra 6, depois 6 contra 7, e
     nessa última reprovou. Onde a máquina cai importa mais que a política dela
     numa amostra de uma partida.

     A regra fica conferida onde mora (as duas funções acima), e o comportamento
     vira relatório. Um número que balança não vira asserção: teste que reprova
     por sorte do dado ensina a ignorar a saída vermelha. */
  const compras = (r) => r.passos.filter((p) => p.startsWith("compra")).length;

  const constroi = (r) => r.passos.filter((p) => p.startsWith("constroi")).length;
  const apertos = (r) => r.passos.filter((p) => p.startsWith("divida:")).length;
  const caixa = (r) => r.bots.reduce((a, x) => a + (r.st.players[String(x)]?.cash ?? 0), 0);
  console.log(
    `         observado — compras: ${compras(contraFacil)} / ${compras(contraDif)}` +
      ` · construções: ${constroi(contraFacil)} / ${constroi(contraDif)}` +
      ` · apertos: ${apertos(contraFacil)} / ${apertos(contraDif)}` +
      ` · caixa final: ${caixa(contraFacil)} / ${caixa(contraDif)} (tranquila / impiedosa)`,
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   O LEILÃO DE FALÊNCIA

   O PRD pede desde sempre (§5.1): quando alguém quebra, as propriedades dele vão
   a LEILÃO em vez de voltar ao banco. Até 0072 voltavam.

   E voltar ao banco é pior do que parece. Num tabuleiro de quarenta casas, uma
   escritura que volta ao banco só reaparece se alguém CAIR nela — e numa partida
   de vinte rodadas isso pode não acontecer mais. Uma falência tirava doze
   propriedades do jogo de uma vez, e a partida ficava mais POBRE justamente no
   momento em que devia ficar mais tensa.
   ══════════════════════════════════════════════════════════════════════════ */

console.log("\n  ── o leilão de falência ──");

const salaFal = (await rpc(P[0].token, "create_room", { p_game: "metropole" })).body;
await rpc(P[1].token, "join_room", { p_code: salaFal.code });
await rpc(P[2].token, "join_room", { p_code: salaFal.code });
const iniFal = await rpc(P[0].token, "met_start", { p_room: salaFal.id });
ok(iniFal.status === 200, "partida de três para a falência");

if (iniFal.status === 200) {
  const idFal = iniFal.body.id;
  const mapaFal = (
    await db.query(
      `select gt.data d from game_themes gt join matches m on gt.id = (m.public_state ->> 'map')
        where m.id = $1`,
      [idFal],
    )
  ).rows[0].d;
  const bairrosFal = mapaFal.casas.filter((c) => c.t === "bairro").slice(0, 3);

  const estFal = (
    await db.query("select public_state ps from matches where id = $1", [idFal])
  ).rows[0].ps;
  const quebrado = 0;
  /* O TABULEIRO COMEÇA LIMPO, pelo mesmo motivo do teste da proposta: o sorteio
     inicial dá três escrituras a cada um, e o falido entrava na conta com elas.
     A fila saiu com quatro quando o teste esperava duas — e o número errado
     escondia se o defeito era do código ou da montagem. */
  for (const k of Object.keys(estFal.props)) {
    estFal.props[k] = { owner: null, casas: 0, hotel: false, hipotecada: false };
  }
  // três escrituras, uma delas com duas casas, e o caixa no vermelho
  bairrosFal.forEach((c, i) => {
    estFal.props[c.id] = {
      owner: quebrado,
      casas: i === 0 ? 2 : 0,
      hotel: false,
      hipotecada: false,
    };
  });
  estFal.players[String(quebrado)].cash = -500;
  estFal.turnSeat = quebrado;
  estFal.phase = "resolve";
  estFal.pendente = { k: "divida", quanto: 500, para: 1, motivo: "teste" };
  const casasNoBanco = estFal.bank.casas;
  await db.query("update matches set public_state = $2::jsonb where id = $1", [
    idFal,
    JSON.stringify(estFal),
  ]);

  const declarou = await rpc(P[0].token, "met_bankrupt", { p_match: idFal });
  ok(
    declarou.status === 200,
    `a falência foi declarada${declarou.status !== 200 ? " " + JSON.stringify(declarou.body).slice(0, 130) : ""}`,
  );

  const depoisFal = (
    await db.query("select public_state ps from matches where id = $1", [idFal])
  ).rows[0].ps;

  ok(
    depoisFal.phase === "leilao" && !!depoisFal.leilao,
    `as escrituras vão a LEILÃO e não ao banco (fase ${depoisFal.phase})`,
  );
  ok(
    bairrosFal.some((c) => c.id === depoisFal.leilao?.prop),
    `o primeiro leilão é de uma delas: ${depoisFal.leilao?.prop}`,
  );
  ok(
    (depoisFal.leilaoFila ?? []).length === bairrosFal.length - 1,
    `e as outras ${bairrosFal.length - 1} ficam na fila (${(depoisFal.leilaoFila ?? []).join(", ")})`,
  );
  ok(
    Number(depoisFal.bank.casas) === Number(casasNoBanco) + 2,
    `as duas CASAS voltaram ao banco (${casasNoBanco} → ${depoisFal.bank.casas}) — o que vai a leilão é a escritura limpa`,
  );
  ok(
    bairrosFal.every((c) => depoisFal.props[c.id].owner === null),
    "e nenhuma escritura ficou no nome de quem declarou",
  );

  /* A FILA ANDA. Todo mundo passa, o leilão fecha, e o próximo abre sozinho —
     até o último, quando a mesa volta ao turno normal. */
  let voltas = 0;
  while (voltas < 12) {
    const st = (
      await db.query("select public_state ps from matches where id = $1", [idFal])
    ).rows[0].ps;
    if (st.phase !== "leilao") break;
    for (const jog of [1, 2]) {
      const quem = jog === 1 ? P[1] : P[2];
      await rpc(quem.token, "met_pass", { p_match: idFal });
    }
    voltas++;
  }
  const fimFal = (
    await db.query("select public_state ps from matches where id = $1", [idFal])
  ).rows[0].ps;
  ok(
    fimFal.phase !== "leilao" && (fimFal.leilaoFila ?? []).length === 0,
    `a fila andou sozinha até o fim em ${voltas} leilão(ões) — fase agora é ${fimFal.phase}`,
  );
  ok(
    bairrosFal.every((c) => fimFal.props[c.id].casas === 0 && !fimFal.props[c.id].hotel),
    "e nenhuma escritura voltou ao mercado com construção em cima",
  );
}

for (const p of P) await admin(`/admin/users/${p.id}`, { method: "DELETE" });
await db.end();

console.log(falhas === 0 ? "\nTudo passou." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
