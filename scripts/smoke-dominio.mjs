#!/usr/bin/env node
/**
 * Teste de fumaça do Domínio.
 *
 *   npm run smoke:dominio
 *
 * A parte que importa é a primeira: a matemática do combate. A distribuição
 * exata é ENUMERADA por força bruta aqui (6^6 = 46.656 combinações para 3v3) e
 * comparada com dez mil assaltos rodados no servidor. Se o dado tiver viés de
 * 1%, ninguém percebe jogando — e o jogo fica injusto para sempre.
 */
import { join, dirname } from "node:path";
import { readFile } from "node:fs/promises";
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


/* ── 1. o dado é uniforme? ───────────────────────────────────────────────── */

const N_DADOS = 60000;
const { rows: faces } = await db.query(
  `select public.dominio_dado(g::bigint, 0) d, count(*)::int n
     from generate_series(1, $1) g group by 1 order by 1`,
  [N_DADOS],
);
ok(faces.length === 6, `o dado dá seis faces (${faces.length})`);
const piorFace = Math.max(...faces.map((f) => Math.abs(f.n / N_DADOS - 1 / 6)));
ok(piorFace < 0.01, `faces uniformes em ${N_DADOS} rolagens (pior desvio ${(piorFace * 100).toFixed(2)}pp)`);
console.log(
  "         " + faces.map((f) => `${f.d}:${((f.n / N_DADOS) * 100).toFixed(1)}%`).join("  "),
);

/* ── 2. distribuição exata do assalto, enumerada ─────────────────────────── */

/** Enumera todas as combinações e devolve p(perdeAtac, perdeDefe). */
function exata(na, nd) {
  const dist = new Map();
  const total = 6 ** (na + nd);
  const a = new Array(na).fill(1);
  const d = new Array(nd).fill(1);

  const anda = (arr, i) => {
    while (i >= 0) {
      arr[i]++;
      if (arr[i] <= 6) return true;
      arr[i] = 1;
      i--;
    }
    return false;
  };

  let contados = 0;
  do {
    d.fill(1);
    do {
      const A = [...a].sort((x, y) => y - x);
      const D = [...d].sort((x, y) => y - x);
      let pa = 0;
      let pd = 0;
      for (let i = 0; i < Math.min(na, nd); i++) {
        if (A[i] > D[i]) pd++;
        else pa++;
      }
      const k = `${pa}-${pd}`;
      dist.set(k, (dist.get(k) ?? 0) + 1);
      contados++;
    } while (anda(d, nd - 1));
  } while (anda(a, na - 1));

  if (contados !== total) throw new Error(`enumeração incompleta: ${contados} de ${total}`);
  return new Map([...dist].map(([k, v]) => [k, v / total]));
}

const N_ASSALTOS = 10000;

for (const [atac, defe, na, nd] of [
  [10, 10, 3, 3],
  [3, 10, 2, 3],
  [2, 10, 1, 3],
  [10, 2, 3, 2],
  [10, 1, 3, 1],
]) {
  const teoria = exata(na, nd);
  const { rows } = await db.query(
    `select perde_atac pa, perde_defe pd, count(*)::int n
       from generate_series(1, $1) g,
            lateral public.dominio_assalto(g::bigint, 0, $2, $3)
      group by 1, 2`,
    [N_ASSALTOS, atac, defe],
  );

  const soma = rows.reduce((s, r) => s + r.n, 0);
  ok(soma === N_ASSALTOS, `${na}v${nd}: ${soma} assaltos resolvidos`);

  let pior = 0;
  let piorK = "";
  for (const [k, p] of teoria) {
    const achado = rows.find((r) => `${r.pa}-${r.pd}` === k);
    const emp = (achado?.n ?? 0) / N_ASSALTOS;
    if (Math.abs(emp - p) > pior) {
      pior = Math.abs(emp - p);
      piorK = k;
    }
  }
  ok(
    pior < 0.02,
    `${na}v${nd}: bate com a distribuição exata (pior desvio ${(pior * 100).toFixed(2)}pp em ${piorK})`,
  );

  const linha = [...teoria]
    .sort()
    .map(([k, p]) => {
      const [pa, pd] = k.split("-");
      const emp = (rows.find((r) => r.pa === +pa && r.pd === +pd)?.n ?? 0) / N_ASSALTOS;
      return `${k} teoria ${(p * 100).toFixed(1)}% real ${(emp * 100).toFixed(1)}%`;
    })
    .join(" · ");
  console.log(`         ${linha}`);
}

/* ── 3. empate favorece o defensor ───────────────────────────────────────── */
// 1v1: das 36 combinações, o atacante só ganha em 15 (5/12).
const t11 = exata(1, 1);
ok(
  Math.abs(t11.get("0-1") - 15 / 36) < 1e-9,
  `1v1: atacante vence em ${((15 / 36) * 100).toFixed(1)}% — empate é do defensor`,
);

/* ── 4. o mesmo par (semente, contador) sempre dá o mesmo dado ───────────── */
const { rows: det } = await db.query(
  `select count(distinct d)::int n from (
     select public.dominio_dado(42::bigint, 7) d from generate_series(1, 50)
   ) s`,
);
ok(det[0].n === 1, "o dado é determinístico: mesma semente e contador, mesmo valor");

/* ── 5. reforço ──────────────────────────────────────────────────────────── */
const { rows: ref } = await db.query(`
  with mapa as (select data from public.game_themes where id = 'vantara'),
  donos as (
    select jsonb_object_agg(t ->> 'id', 0) d
      from (select value t from jsonb_array_elements((select data from mapa) -> 'territorios')) x
  )
  select public.dominio_reforco(
    (select data from mapa),
    jsonb_build_object('donos', (select d from donos)),
    0::smallint
  ) n
`);
// 42 territórios + todos os 6 continentes = 42/2 + 24
ok(ref[0].n === 21 + 24, `mapa inteiro rende ${ref[0].n} exércitos (esperado 45)`);

const { rows: ref2 } = await db.query(`
  select public.dominio_reforco(
    (select data from public.game_themes where id = 'vantara'),
    jsonb_build_object('donos', jsonb_build_object('boreal', 0, 'tarn', 0)),
    0::smallint
  ) n
`);
ok(ref2[0].n === 3, `dois territórios rendem o mínimo de 3 (deu ${ref2[0].n})`);

/* ── 6. conectividade para remanejamento ─────────────────────────────────── */
const { rows: con } = await db.query(`
  select
    public.dominio_conectado(
      (select data from public.game_themes where id = 'vantara'),
      jsonb_build_object('donos', jsonb_build_object('boreal', 0, 'tarn', 0, 'ilm', 0)),
      0::smallint, 'boreal', 'ilm') as caminho,
    public.dominio_conectado(
      (select data from public.game_themes where id = 'vantara'),
      jsonb_build_object('donos', jsonb_build_object('boreal', 0, 'ilm', 0)),
      0::smallint, 'boreal', 'ilm') as sem_ponte
`);
ok(con[0].caminho === true, "remanejar por território próprio é permitido");
ok(con[0].sem_ponte === false, "remanejar sem ponte própria é recusado");

/* ── 7. começar a partida ────────────────────────────────────────────────── */

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
  await player(`dom-a-${stamp}@mesa.invalid`),
  await player(`dom-b-${stamp}@mesa.invalid`),
  await player(`dom-c-${stamp}@mesa.invalid`),
];
ok(P.every((p) => p.token), "três jogadores autenticados");

const sala = (await rpc(P[0].token, "create_room", { p_game: "dominio" })).body;
await rpc(P[1].token, "join_room", { p_code: sala.code });

const poucos = await rpc(P[0].token, "dominio_start", { p_room: sala.id });
ok(
  poucos.status >= 400 && /NEED_THREE/.test(JSON.stringify(poucos.body)),
  `com dois jogadores não começa (${JSON.stringify(poucos.body).slice(0, 90)})`,
);

await rpc(P[2].token, "join_room", { p_code: sala.code });

const naoHost = await rpc(P[1].token, "dominio_start", { p_room: sala.id });
ok(naoHost.status >= 400 && /NOT_HOST/.test(JSON.stringify(naoHost.body)), "quem não é anfitrião não começa");

const inicio = await rpc(P[0].token, "dominio_start", { p_room: sala.id });
const partida = inicio.body;
ok(
  inicio.status === 200 && !!partida?.public_state,
  `dominio_start criou a partida${inicio.status !== 200 ? ` (${JSON.stringify(inicio.body).slice(0, 140)})` : ""}`,
);

if (partida?.public_state) {
  const st = partida.public_state;
  ok(Object.keys(st.donos).length === 42, `42 territórios repartidos (${Object.keys(st.donos).length})`);
  ok(Object.keys(st.exercitos).length === 42, "todo território tem exército");
  ok(Object.values(st.exercitos).every((n) => n >= 1), "nenhum território ficou com zero exército");

  for (const assento of [0, 1, 2]) {
    const meus = Object.entries(st.donos).filter(([, s]) => s === assento).map(([t]) => t);
    const total = meus.reduce((s, t) => s + st.exercitos[t], 0);
    ok(total === 35, `assento ${assento}: ${meus.length} territórios, ${total} exércitos (esperado 35)`);
  }
  ok(Object.keys(st.donos).length === 42, "nenhum território ficou sem dono");
  ok(st.phase === "reforco", "começa na fase de reforço");
  ok(st.reforcoLeft >= 3, `o primeiro jogador recebe ${st.reforcoLeft} de reforço`);
  ok(!JSON.stringify(st).includes("objetivo"), "o estado público NÃO contém objetivo de ninguém");

  const objetivos = [];
  for (const p of P) {
    const r = await get(p.token, `match_private_state?select=data&match_id=eq.${partida.id}`);
    objetivos.push(r.body?.[0]?.data?.objetivo?.id);
  }
  ok(objetivos.every(Boolean), `cada um recebeu um objetivo (${objetivos.join(", ")})`);
  ok(new Set(objetivos).size === objetivos.length, "os objetivos secretos NÃO se repetem entre jogadores");

  const espiar = await get(P[1].token, `match_private_state?select=data&user_id=eq.${P[0].id}`);
  ok(Array.isArray(espiar.body) && espiar.body.length === 0, "RLS: ninguém lê o objetivo do outro");

  const colSeed = await get(P[1].token, `matches?select=seed&id=eq.${partida.id}`);
  ok(colSeed.status >= 400, `a coluna seed é negada ao cliente (status ${colSeed.status})`);

  const dupla = await rpc(P[0].token, "dominio_start", { p_room: sala.id });
  ok(
    dupla.status >= 400 && /ALREADY_RUNNING/.test(JSON.stringify(dupla.body)),
    "não começa duas partidas na mesma sala",
  );
}

/* ── 8. o ciclo de turno ──────────────────────────────────────────────────
   Reforçar, atacar em série, avançar, remanejar, encerrar. É a primeira vez
   que o Domínio é JOGADO num teste, e não só montado. O mapa é lido do mesmo
   JSON que o servidor publicou, então vizinhança aqui e vizinhança lá são a
   mesma coisa por construção. */

const MAPA = JSON.parse(
  await readFile(join(root, "lib", "dominio", "vantara.json"), "utf8"),
);
const VIZ = Object.fromEntries(MAPA.territorios.map((t) => [t.id, t.vizinhos]));

/** Quem está na vez, com token. */
async function daVez(matchId) {
  const est = (await db.query("select public_state from matches where id = $1", [matchId]))
    .rows[0].public_state;
  const dono = (
    await db.query("select user_id from match_players where match_id = $1 and seat = $2", [
      matchId,
      est.turnSeat,
    ])
  ).rows[0].user_id;
  return { est, jogador: P.find((x) => x.id === dono) };
}

if (partida?.public_state) {
  let { est, jogador } = await daVez(partida.id);
  ok(!!jogador, `o assento ${est.turnSeat} é de um dos três jogadores do teste`);

  const meus = () =>
    Object.entries(est.donos)
      .filter(([, s]) => s === est.turnSeat)
      .map(([t]) => t);

  /* reforço */
  const alheio = Object.entries(est.donos).find(([, s]) => s !== est.turnSeat)[0];
  const naoMeu = await rpc(jogador.token, "dominio_reforcar", {
    p_match: partida.id,
    p_ter: alheio,
    p_qtd: 1,
  });
  ok(/NOT_YOURS/.test(JSON.stringify(naoMeu.body)), "não se reforça território alheio");

  const demais = await rpc(jogador.token, "dominio_reforcar", {
    p_match: partida.id,
    p_ter: meus()[0],
    p_qtd: est.reforcoLeft + 1,
  });
  ok(
    /NOT_ENOUGH_REINFORCEMENTS/.test(JSON.stringify(demais.body)),
    "não se coloca mais exército do que se recebeu",
  );

  const cedo = await rpc(jogador.token, "dominio_atacar", {
    p_match: partida.id,
    p_de: meus()[0],
    p_para: alheio,
    p_vezes: 1,
  });
  ok(/WRONG_PHASE/.test(JSON.stringify(cedo.body)), "não se ataca antes de colocar o reforço");

  const antesDoReforco = est.exercitos[meus()[0]];
  const quantos = est.reforcoLeft;
  const posto = await rpc(jogador.token, "dominio_reforcar", {
    p_match: partida.id,
    p_ter: meus()[0],
    p_qtd: quantos,
  });
  ok(posto.status === 200, `reforço de ${quantos} colocado`);
  est = posto.body.public_state;
  ok(
    est.exercitos[meus()[0]] === antesDoReforco + quantos,
    `o exército chegou onde foi mandado (${antesDoReforco} → ${est.exercitos[meus()[0]]})`,
  );
  ok(est.reforcoLeft === 0 && est.phase === "ataque", "acabou o reforço, a fase virou ataque sozinha");

  /* ataque */
  const frente = meus()
    .filter((t) => est.exercitos[t] >= 2)
    .map((t) => [t, VIZ[t].find((v) => est.donos[v] !== est.turnSeat)])
    .find(([, alvo]) => !!alvo);
  ok(!!frente, "existe um território meu com dois exércitos e um vizinho inimigo");

  const [de, para] = frente;
  const longe = MAPA.territorios.find(
    (t) => t.id !== de && t.id !== para && !VIZ[de].includes(t.id) && est.donos[t.id] !== est.turnSeat,
  ).id;
  const naoVizinho = await rpc(jogador.token, "dominio_atacar", {
    p_match: partida.id,
    p_de: de,
    p_para: longe,
    p_vezes: 1,
  });
  ok(/NOT_ADJACENT/.test(JSON.stringify(naoVizinho.body)), "não se ataca quem não é vizinho");

  const proprio = await rpc(jogador.token, "dominio_atacar", {
    p_match: partida.id,
    p_de: de,
    p_para: VIZ[de].find((v) => est.donos[v] === est.turnSeat) ?? de,
    p_vezes: 1,
  });
  ok(
    /TARGET_IS_YOURS|SAME_TERRITORY/.test(JSON.stringify(proprio.body)),
    "não se ataca território próprio",
  );

  const antesA = est.exercitos[de];
  const antesD = est.exercitos[para];
  const briga = await rpc(jogador.token, "dominio_atacar", {
    p_match: partida.id,
    p_de: de,
    p_para: para,
    p_vezes: 12,
  });
  ok(briga.status === 200, `ataque em série resolvido (${JSON.stringify(briga.body).slice(0, 90)})`);

  const rodadas = briga.body?.assaltos ?? [];
  ok(rodadas.length >= 1, `o servidor devolveu ${rodadas.length} assalto(s) para animar`);
  ok(
    rodadas.every(
      (a) =>
        a.dAtac.every((d) => d >= 1 && d <= 6) &&
        a.dDefe.every((d) => d >= 1 && d <= 6) &&
        a.perdeAtac + a.perdeDefe === Math.min(a.dAtac.length, a.dDefe.length),
    ),
    "todo dado é de 1 a 6, e cada par comparado tira exatamente uma baixa",
  );
  est = briga.body.match.public_state;
  const perdidoA = rodadas.reduce((n, a) => n + a.perdeAtac, 0);
  const perdidoD = rodadas.reduce((n, a) => n + a.perdeDefe, 0);
  console.log(
    `  ${de}(${antesA}) → ${para}(${antesD}): ${rodadas.length} assaltos, ` +
      `${perdidoA} baixas minhas, ${perdidoD} dele${briga.body.conquistou ? " · CONQUISTOU" : ""}`,
  );
  ok(
    Object.values(est.exercitos).every((n) => n >= 1),
    "nenhum território ficou com zero exército depois da briga",
  );
  ok(
    Object.keys(est.donos).length === 42 && Object.keys(est.exercitos).length === 42,
    "o mapa continua com 42 territórios e 42 guarnições",
  );

  /* avanço */
  if (briga.body.conquistou) {
    ok(est.donos[para] === est.turnSeat, `${para} mudou de dono`);
    ok(est.conquistou === true, "o turno ficou marcado como conquistador — vale carta no fim");
    if (est.avanco) {
      const demasiado = await rpc(jogador.token, "dominio_avancar", {
        p_match: partida.id,
        p_qtd: est.avanco.max + 1,
      });
      ok(/TOO_MANY/.test(JSON.stringify(demasiado.body)), "o avanço tem teto de três no total");

      const trava = await rpc(jogador.token, "dominio_remanejar", {
        p_match: partida.id,
        p_de: de,
        p_para: para,
        p_qtd: 1,
      });
      ok(
        /ADVANCE_PENDING/.test(JSON.stringify(trava.body)),
        "com avanço pendente, nada mais acontece antes de resolvê-lo",
      );

      const av = await rpc(jogador.token, "dominio_avancar", {
        p_match: partida.id,
        p_qtd: est.avanco.max,
      });
      ok(av.status === 200, `avançou ${est.avanco.max} para o território tomado`);
      est = av.body.public_state;
      ok(est.avanco === null, "o avanço foi resolvido e saiu do estado");
    }
  }

  /* remanejo */
  const par = meus()
    .filter((t) => est.exercitos[t] >= 2)
    .map((t) => [t, VIZ[t].find((v) => est.donos[v] === est.turnSeat)])
    .find(([, v]) => !!v);
  if (par) {
    const [rd, rp] = par;
    const tudo = await rpc(jogador.token, "dominio_remanejar", {
      p_match: partida.id,
      p_de: rd,
      p_para: rp,
      p_qtd: est.exercitos[rd],
    });
    ok(/WOULD_EMPTY/.test(JSON.stringify(tudo.body)), "remanejo nunca deixa o território vazio");

    const rem = await rpc(jogador.token, "dominio_remanejar", {
      p_match: partida.id,
      p_de: rd,
      p_para: rp,
      p_qtd: 1,
    });
    ok(rem.status === 200, `remanejou 1 de ${rd} para ${rp}`);
    est = rem.body.public_state;

    const denovo = await rpc(jogador.token, "dominio_remanejar", {
      p_match: partida.id,
      p_de: rd,
      p_para: rp,
      p_qtd: 1,
    });
    ok(/ALREADY_MOVED/.test(JSON.stringify(denovo.body)), "um remanejo por turno, e só um");
  }

  /* encerrar */
  const conquistou = est.conquistou === true;
  const antesSeat = est.turnSeat;
  const fim = await rpc(jogador.token, "dominio_encerrar_turno", { p_match: partida.id });
  ok(fim.status === 200, `turno encerrado (${JSON.stringify(fim.body).slice(0, 80)})`);
  est = fim.body.public_state;
  ok(est.turnSeat !== antesSeat, `a vez passou do assento ${antesSeat} para o ${est.turnSeat}`);
  ok(est.phase === "reforco", "o próximo entra na fase de reforço");
  ok(est.reforcoLeft >= 3, `e já com ${est.reforcoLeft} de reforço calculado`);
  ok(est.conquistou === false && est.remanejou === false, "as marcas do turno anterior foram limpas");

  const mao = (
    await db.query(
      `select jsonb_array_length(coalesce(data -> 'cartas', '[]'::jsonb)) n
         from match_private_state where match_id = $1 and user_id = $2`,
      [partida.id, jogador.id],
    )
  ).rows[0].n;
  ok(
    conquistou ? mao === 1 : mao === 0,
    `quem ${conquistou ? "conquistou levou" : "não conquistou não levou"} carta (mão: ${mao})`,
  );

  const forado = await rpc(jogador.token, "dominio_atacar", {
    p_match: partida.id,
    p_de: de,
    p_para: para,
    p_vezes: 1,
  });
  ok(/NOT_YOUR_TURN/.test(JSON.stringify(forado.body)), "quem já jogou não age fora da vez");

  /* ── 9. troca de cartas ────────────────────────────────────────────────
     Chegar a três cartas jogando levaria três turnos de conquista. A mão é
     posta na mesa pelo caminho de serviço, e a TROCA é exercitada de verdade:
     é a regra com mais jeito de dar errado em silêncio. */

  const { jogador: agora } = await daVez(partida.id);
  const meusAgora = Object.entries(est.donos)
    .filter(([, s]) => s === est.turnSeat)
    .map(([t]) => t);

  const mao3 = [
    { ter: meusAgora[0], simbolo: "infante", id: meusAgora[0] },
    { ter: null, simbolo: "coringa", id: "coringa-1" },
    { ter: meusAgora[1], simbolo: "cavalo", id: meusAgora[1] },
  ];
  await db.query(
    `update match_private_state set data = jsonb_set(data, '{cartas}', $3::jsonb)
      where match_id = $1 and user_id = $2`,
    [partida.id, agora.id, JSON.stringify(mao3)],
  );

  const ruim = await rpc(agora.token, "dominio_trocar", {
    p_match: partida.id,
    p_cartas: [0, 1, 2],
  });
  ok(
    /BAD_COMBO/.test(JSON.stringify(ruim.body)),
    "infante + cavalo + coringa não fecha trinca (o coringa completa PAR igual)",
  );

  mao3[2] = { ter: meusAgora[1], simbolo: "infante", id: meusAgora[1] };
  await db.query(
    `update match_private_state set data = jsonb_set(data, '{cartas}', $3::jsonb)
      where match_id = $1 and user_id = $2`,
    [partida.id, agora.id, JSON.stringify(mao3)],
  );

  const antesRef = (await daVez(partida.id)).est.reforcoLeft;
  const antesT0 = (await daVez(partida.id)).est.exercitos[meusAgora[0]];
  const troca = await rpc(agora.token, "dominio_trocar", {
    p_match: partida.id,
    p_cartas: [0, 1, 2],
  });
  ok(troca.status === 200, `troca aceita (${JSON.stringify(troca.body).slice(0, 80)})`);
  const depois = troca.body.public_state;
  ok(depois.trocas === 1, "é a primeira troca da partida");
  ok(
    depois.reforcoLeft === antesRef + 4,
    `a primeira troca vale 4 exércitos (${antesRef} → ${depois.reforcoLeft})`,
  );
  ok(
    depois.exercitos[meusAgora[0]] === antesT0 + 2,
    "carta de território seu põe dois exércitos ali na hora",
  );
  const maoDepois = (
    await db.query(
      `select jsonb_array_length(data -> 'cartas') n from match_private_state
        where match_id = $1 and user_id = $2`,
      [partida.id, agora.id],
    )
  ).rows[0].n;
  ok(maoDepois === 0, "as três cartas saíram da mão");

  const semCarta = await rpc(agora.token, "dominio_trocar", {
    p_match: partida.id,
    p_cartas: [0, 1, 2],
  });
  ok(
    /CARD_NOT_HELD|NEED_THREE/.test(JSON.stringify(semCarta.body)),
    "não se troca carta que não está na mão",
  );

  /* obrigado a trocar com cinco na mão */
  const cinco = Array.from({ length: 5 }, (_, i) => ({
    ter: null,
    simbolo: ["infante", "cavalo", "canhao", "infante", "cavalo"][i],
    id: `x${i}`,
  }));
  await db.query(
    `update match_private_state set data = jsonb_set(data, '{cartas}', $3::jsonb)
      where match_id = $1 and user_id = $2`,
    [partida.id, agora.id, JSON.stringify(cinco)],
  );
  const obrigado = await rpc(agora.token, "dominio_reforcar", {
    p_match: partida.id,
    p_ter: meusAgora[0],
    p_qtd: 1,
  });
  ok(
    /MUST_TRADE/.test(JSON.stringify(obrigado.body)),
    "com cinco cartas na mão, trocar deixa de ser opcional",
  );
}

/* ── 10. o baralho e a escada da troca ────────────────────────────────────
   Estas duas rodam direto no banco porque são função pura — e é assim que se
   testa uma permutação sem depender de sorte. */

const baralho = (
  await db.query(
    `select jsonb_agg(public.dominio_carta(gt.data, 12345::bigint, k) -> 'id') ids
       from public.game_themes gt, generate_series(0, 43) k where gt.id = 'vantara'`,
  )
).rows[0].ids;
ok(baralho.length === 44, "o baralho tem 44 cartas");
ok(new Set(baralho).size === 44, "as 44 primeiras cartas dadas NÃO se repetem");
ok(baralho.filter((c) => String(c).startsWith("coringa")).length === 2, "e há exatamente 2 coringas");

const naipes = (
  await db.query(
    `select public.dominio_carta(gt.data, 1::bigint, k) ->> 'simbolo' s, count(*) n
       from public.game_themes gt, generate_series(0, 43) k
      where gt.id = 'vantara' group by 1 order by 1`,
  )
).rows;
ok(
  naipes.filter((r) => r.s !== "coringa").every((r) => Number(r.n) === 14),
  `os três naipes têm 14 cartas cada (${naipes.map((r) => `${r.s}:${r.n}`).join(" ")})`,
);

const escada = (
  await db.query(
    "select array_agg(public.dominio_valor_troca(n) order by n) v from generate_series(1,8) n",
  )
).rows[0].v.map(Number);
ok(
  JSON.stringify(escada) === JSON.stringify([4, 6, 8, 10, 12, 15, 20, 25]),
  `a escada da troca sobe 4-6-8-10-12-15-20-25 (${escada.join("-")})`,
);

/* ── 11. objetivo: a conta que decide a partida ───────────────────────────
   Estado montado à mão, para cada tipo de objetivo. Vale mais que testar num
   jogo de verdade, porque aqui a resposta certa é conhecida. */

async function objOk(estado, seat, obj) {
  const r = await db.query(
    `select public.dominio_objetivo_ok(gt.data, $1::jsonb, $2::smallint, $3::jsonb) ok
       from public.game_themes gt where gt.id = 'vantara'`,
    [JSON.stringify(estado), seat, JSON.stringify(obj)],
  );
  return r.rows[0].ok;
}

const todosMeus = {
  donos: Object.fromEntries(MAPA.territorios.map((t) => [t.id, 0])),
  exercitos: Object.fromEntries(MAPA.territorios.map((t) => [t.id, 1])),
  abates: {},
};
const nenhum = {
  donos: Object.fromEntries(MAPA.territorios.map((t) => [t.id, 1])),
  exercitos: Object.fromEntries(MAPA.territorios.map((t) => [t.id, 1])),
  abates: {},
};

ok(await objOk(todosMeus, 0, { tipo: "territorios", alvo: 24 }), "24 territórios: cumprido com 42");
ok(!(await objOk(nenhum, 0, { tipo: "territorios", alvo: 24 })), "24 territórios: não cumprido com 0");
ok(
  !(await objOk(todosMeus, 0, { tipo: "territorios-com-dois", alvo: 18 })),
  "18 com dois exércitos: 42 territórios de 1 exército NÃO cumprem",
);
ok(
  await objOk(
    { ...todosMeus, exercitos: Object.fromEntries(MAPA.territorios.map((t) => [t.id, 2])) },
    0,
    { tipo: "territorios-com-dois", alvo: 18 },
  ),
  "18 com dois exércitos: cumprido quando todos têm 2",
);
ok(await objOk(todosMeus, 0, { tipo: "portos" }), "todos os portos: cumprido com o mapa inteiro");
ok(!(await objOk(nenhum, 0, { tipo: "portos" })), "todos os portos: não cumprido sem nada");
ok(
  await objOk({ ...nenhum, abates: { 0: 2 } }, 0, { tipo: "eliminar", alvo: 2 }),
  "eliminar 2: cumprido com dois abates",
);
ok(
  !(await objOk({ ...nenhum, abates: { 0: 1 } }, 0, { tipo: "eliminar", alvo: 2 })),
  "eliminar 2: um abate não basta",
);

const soAurelia = {
  donos: Object.fromEntries(
    MAPA.territorios.map((t) => [t.id, t.continente === "aurelia" ? 0 : 1]),
  ),
  exercitos: Object.fromEntries(MAPA.territorios.map((t) => [t.id, 1])),
  abates: {},
};
ok(
  !(await objOk(soAurelia, 0, {
    tipo: "continentes",
    continentes: ["aurelia", "sarnath"],
  })),
  "Aurélia + Sarnath: metade não conta",
);
ok(
  await objOk(soAurelia, 0, { tipo: "continentes", continentes: ["aurelia"] }),
  "Aurélia inteira: cumprido",
);
ok(
  !(await objOk(soAurelia, 0, { tipo: "continentes", continentes: ["aurelia"], extras: 3 })),
  "Aurélia + 3 fora dela: não cumprido sem os três de fora",
);

/* ── 12. as funções internas continuam trancadas ──────────────────────── */

for (const fn of ["dominio_venceu", "dominio_sweep", "dominio_carta", "dominio_termina", "dominio_na_vez"]) {
  const r = await rpc(P[0].token, fn, {});
  ok(r.status >= 400, `o cliente NÃO chama ${fn} (status ${r.status})`);
}

/* ── 13. propriedade: os auxiliares de mapa, contra outra implementação ────
   `dominio_conectado` é uma busca em largura escrita em PL/pgSQL, com fatia de
   array (`fila := fila[2:]`) fazendo o papel de fila. É exatamente o tipo de
   código onde um erro de um passa despercebido por meses: funciona no caso
   fácil e mente no caso raro.

   Então aqui ele é comparado com uma implementação DIFERENTE — fechamento
   transitivo por relaxamento repetido, sem fila nenhuma — sobre repartições
   aleatórias do mapa. Duas rotas para a mesma resposta; se divergirem, uma das
   duas está errada, e o teste diz em qual estado.

   O mesmo vale para `dominio_reforco`, comparado com a conta feita direto do
   JSON do mapa. */

/** Alcançáveis por relaxamento: sem fila, sem recursão, sem BFS. */
function alcancaveis(donos, assento, de) {
  const meus = MAPA.territorios.filter((t) => donos[t.id] === assento).map((t) => t.id);
  if (donos[de] !== assento) return new Set();
  let dentro = new Set([de]);
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const t of meus) {
      if (dentro.has(t)) continue;
      if (VIZ[t].some((v) => dentro.has(v))) {
        dentro.add(t);
        mudou = true;
      }
    }
  }
  dentro.delete(de);
  return dentro;
}

/** Reforço pela regra escrita, lida do JSON: territórios ÷ 2 (mín. 3) + bônus. */
function reforcoEsperado(donos, assento) {
  const meus = MAPA.territorios.filter((t) => donos[t.id] === assento).length;
  if (meus === 0) return 0;
  let extra = 0;
  for (const c of MAPA.continentes) {
    const dele = MAPA.territorios.filter((t) => t.continente === c.id);
    if (dele.length > 0 && dele.every((t) => donos[t.id] === assento)) extra += c.bonus;
  }
  return Math.max(3, Math.floor(meus / 2)) + extra;
}

/** Gerador determinístico: o mesmo teste falha do mesmo jeito toda vez. */
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry32(20260827);
let divCon = 0;
let divRef = 0;
let paresTestados = 0;
let piorCaso = null;

for (let rodada = 0; rodada < 14; rodada++) {
  // reparte o mapa entre três assentos, com pesos diferentes a cada rodada
  // para que apareçam desde mapas fragmentados até quase-monopólio
  const viés = rodada / 13;
  const donos = {};
  for (const t of MAPA.territorios) {
    const r = rnd();
    donos[t.id] = r < 0.34 + viés * 0.5 ? 0 : r < 0.67 + viés * 0.25 ? 1 : 2;
  }
  const exercitos = Object.fromEntries(MAPA.territorios.map((t) => [t.id, 1]));
  const estado = { donos, exercitos, abates: {} };

  // reforço, os três assentos
  for (const assento of [0, 1, 2]) {
    const r = await db.query(
      `select public.dominio_reforco(gt.data, $1::jsonb, $2::smallint) n
         from public.game_themes gt where gt.id = 'vantara'`,
      [JSON.stringify(estado), assento],
    );
    const esperado = reforcoEsperado(donos, assento);
    if (Number(r.rows[0].n) !== esperado) {
      divRef++;
      piorCaso = `reforço assento ${assento}: servidor ${r.rows[0].n}, esperado ${esperado}`;
    }
  }

  // conectividade: seis origens sorteadas por rodada, contra o conjunto todo
  const origens = MAPA.territorios
    .filter((t) => donos[t.id] === 0)
    .sort(() => rnd() - 0.5)
    .slice(0, 6);

  for (const de of origens) {
    const meu = alcancaveis(donos, 0, de.id);
    // uma consulta só por origem: todos os destinos de uma vez
    const r = await db.query(
      `select t.id, public.dominio_conectado(gt.data, $1::jsonb, 0::smallint, $2, t.id) ok
         from public.game_themes gt,
              jsonb_to_recordset(gt.data -> 'territorios') as t(id text)
        where gt.id = 'vantara'`,
      [JSON.stringify(estado), de.id],
    );
    for (const linha of r.rows) {
      if (linha.id === de.id) continue;
      paresTestados++;
      const servidor = linha.ok === true;
      const nosso = meu.has(linha.id);
      // o servidor não exige que o DESTINO seja seu; a nossa conta sim. Só
      // comparamos onde as duas perguntas são a mesma pergunta.
      if (donos[linha.id] !== 0) continue;
      if (servidor !== nosso) {
        divCon++;
        piorCaso = `conectado ${de.id} → ${linha.id}: servidor ${servidor}, esperado ${nosso}`;
      }
    }
  }
}

ok(
  divRef === 0,
  divRef === 0
    ? "dominio_reforco bate com a regra escrita em 42 estados (14 repartições × 3 assentos)"
    : `dominio_reforco divergiu ${divRef}x — ${piorCaso}`,
);
ok(
  divCon === 0,
  divCon === 0
    ? `dominio_conectado bate com fechamento transitivo em ${paresTestados.toLocaleString("pt-BR")} pares`
    : `dominio_conectado divergiu ${divCon}x — ${piorCaso}`,
);

/* vizinhança: o servidor lê o mesmo JSON, e ainda assim vale conferir que a
   leitura não perde nem inventa aresta */
const vizServidor = (
  await db.query(
    `select t.id, public.dominio_vizinhos(gt.data, t.id) v
       from public.game_themes gt,
            jsonb_to_recordset(gt.data -> 'territorios') as t(id text)
      where gt.id = 'vantara'`,
  )
).rows;
const vizIguais = vizServidor.every((r) => {
  const a = [...r.v].sort();
  const b = [...VIZ[r.id]].sort();
  return a.length === b.length && a.every((x, i) => x === b[i]);
});
ok(vizIguais, `dominio_vizinhos devolve exatamente a vizinhança do mapa nos 42 territórios`);

/* e a propriedade que o mapa TEM de ter, senão o jogo trava: a vizinhança é
   simétrica. Se "a" é vizinho de "b" mas "b" não é de "a", existe um ataque
   possível numa direção e impossível na outra. */
const assimetrias = [];
for (const t of MAPA.territorios) {
  for (const v of t.vizinhos) {
    if (!VIZ[v]?.includes(t.id)) assimetrias.push(`${t.id}→${v}`);
  }
}
ok(
  assimetrias.length === 0,
  assimetrias.length === 0
    ? "a vizinhança é simétrica nas 83 fronteiras"
    : `fronteira de mão única: ${assimetrias.join(", ")}`,
);

/* ══════════════════════════════════════════════════════════════════════════
   14. O MODO CAMPANHA

   O modo era gravado no estado e não era lido por nada. Agora vale, e é o
   padrão. Três coisas para verificar, e nenhuma delas é o combate:

     · o PLACAR soma o que o PRD manda somar, incluindo o −2 da passividade
     · quem é ZERADO volta na rodada seguinte, e o líder paga por isso
     · a partida ACABA na rodada 12, sempre
   ══════════════════════════════════════════════════════════════════════════ */

const MAPA_C = MAPA; // já carregado acima

/** Um estado de Campanha montado à mão, com os donos que eu quiser. */
function campanha(donos, extra = {}) {
  const exercitos = {};
  for (const t of MAPA_C.territorios) exercitos[t.id] = 1;
  return {
    map: "vantara",
    mode: "campanha",
    round: 3,
    rodadaFinal: 12,
    phase: "ataque",
    turnSeat: 0,
    donos,
    exercitos,
    players: [
      { seat: 0, userId: "x", cor: "carmim", cartas: 0, ativo: true },
      { seat: 1, userId: "y", cor: "prussia", cartas: 0, ativo: true },
      { seat: 2, userId: "z", cor: "oliva", cartas: 0, ativo: true },
    ],
    eliminados: [],
    conquistou: false,
    remanejou: false,
    trocas: 0,
    rolls: 0,
    seq: 0,
    pontos: {},
    tomou: {},
    atacou: {},
    aguardando: {},
    abates: {},
    cartasDadas: 0,
    avanco: null,
    log: [],
    vencedor: null,
    ...extra,
  };
}

async function pontua(estado) {
  const r = await db.query(
    `select public.dominio_pontua(gt.data, $1::jsonb) v
       from public.game_themes gt where gt.id = 'vantara'`,
    [JSON.stringify(estado)],
  );
  return r.rows[0].v;
}

/* ── o placar ───────────────────────────────────────────────────────────── */

// reparte: 0 fica com Aurélia inteira (6 territórios, bônus 5), o resto para 1
const aureliaC = {};
for (const t of MAPA_C.territorios) {
  aureliaC[t.id] = t.continente === "aurelia" ? 0 : 1;
}
const nAurelia = MAPA_C.territorios.filter((t) => t.continente === "aurelia").length;
const bonusAurelia = MAPA_C.continentes.find((c) => c.id === "aurelia").bonus;

let pc = await pontua(campanha(aureliaC, { atacou: { 0: true, 1: true, 2: true } }));
ok(
  Number(pc.pontos["0"]) === nAurelia + bonusAurelia * 2,
  `território (${nAurelia}) + continente inteiro (${bonusAurelia}×2) = ${nAurelia + bonusAurelia * 2} pontos`,
);
/* Cuidado que a primeira versão deste teste não teve: dar a um jogador TUDO
   menos Aurélia dá a ele CINCO continentes inteiros, e cada um vale o dobro do
   bônus. O motor estava certo; a expectativa estava errada. */
const outrosBonus = MAPA_C.continentes
  .filter((c) => c.id !== "aurelia")
  .reduce((soma, c) => soma + c.bonus * 2, 0);
ok(
  Number(pc.pontos["1"]) === 42 - nAurelia + outrosBonus,
  `quem fica com o resto do mapa soma ${42 - nAurelia} territórios mais ${outrosBonus} dos cinco continentes que fechou`,
);
ok(Number(pc.pontos["2"]) === 0, "quem não tem nada e atacou fica em zero");

// o −2 da passividade
pc = await pontua(campanha(aureliaC, { atacou: { 0: true, 1: true } }));
ok(
  Number(pc.pontos["2"]) === -2,
  "rodada inteira sem atacar ninguém custa −2 — é o dente do anti-passividade",
);

// território tomado nesta rodada vale +1 cada
pc = await pontua(
  campanha(aureliaC, { atacou: { 0: true, 1: true, 2: true }, tomou: { 0: 3 } }),
);
ok(
  Number(pc.pontos["0"]) === nAurelia + bonusAurelia * 2 + 3,
  "cada território tomado de outro nesta rodada vale +1",
);

// e os contadores da rodada zeram
ok(
  JSON.stringify(pc.tomou) === "{}" && JSON.stringify(pc.atacou) === "{}",
  "`tomou` e `atacou` zeram depois de contar: valem por rodada, não pela partida",
);

// o placar ACUMULA entre rodadas
const acumula = await pontua({
  ...campanha(aureliaC, { atacou: { 0: true, 1: true, 2: true } }),
  pontos: { 0: 100 },
});
ok(
  Number(acumula.pontos["0"]) === 100 + nAurelia + bonusAurelia * 2,
  "e soma sobre o que já havia: o placar é acumulado, não recalculado",
);

/* ── a volta de quem foi zerado ─────────────────────────────────────────── */

async function restaura(estado, rodada, seed = 555) {
  const r = await db.query(
    `select public.dominio_restaura(gt.data, $1::jsonb, $2::bigint, $3) v
       from public.game_themes gt where gt.id = 'vantara'`,
    [JSON.stringify(estado), seed, rodada],
  );
  return r.rows[0].v;
}

// 1 tem tudo menos Aurélia; 2 foi zerado e volta na rodada 4
const zerado = campanha(aureliaC, { aguardando: { 2: 4 } });
// dá ao líder um território fraquinho, para conferir que é ele que sai
const doLider = MAPA_C.territorios.find((t) => t.continente !== "aurelia").id;
zerado.exercitos[doLider] = 1;
for (const t of MAPA_C.territorios) {
  if (t.continente !== "aurelia" && t.id !== doLider) zerado.exercitos[t.id] = 9;
}

const cedo = await restaura(zerado, 3);
ok(
  Number(cedo.aguardando["2"]) === 4,
  "na rodada 3 ele ainda não volta — a volta é na rodada seguinte à queda",
);

const voltou = await restaura(zerado, 4);
ok(
  JSON.stringify(voltou.aguardando) === "{}",
  "na rodada 4 ele volta e sai da lista de espera",
);
const meusAgora = Object.entries(voltou.donos).filter(([, s]) => s === 2);
ok(meusAgora.length === 1, `e volta com exatamente um território (${meusAgora[0]?.[0]})`);
ok(
  Number(voltou.exercitos[meusAgora[0][0]]) === 3,
  "com três exércitos — fraco, como o PRD manda",
);
ok(
  meusAgora[0][0] === doLider,
  `e o território saiu do MAIS FRACO de quem tinha MAIS: ${doLider}`,
);
ok(
  voltou.log.some((l) => l.k === "volta"),
  "e o registro conta de quem ele saiu",
);

// ninguém aguardando: a função não mexe em nada
/* A comparação é por CONTEÚDO e não por string: o jsonb devolve as chaves na
   ordem dele (por comprimento, depois por bytes), então `JSON.stringify` dos
   dois lados nunca bate mesmo quando o conteúdo é idêntico. */
const semNinguem = await restaura(campanha(aureliaC), 5);
const iguais = Object.keys(aureliaC).every(
  (k) => Number(semNinguem.donos[k]) === aureliaC[k],
);
ok(
  iguais && Object.keys(semNinguem.donos).length === Object.keys(aureliaC).length,
  "sem ninguém aguardando, a restauração não toca no mapa",
);

/* ── o vocabulário do modo ──────────────────────────────────────────────── */

const salaC = (await rpc(P[0].token, "create_room", { p_game: "dominio" })).body;
const modoRuimD = await rpc(P[0].token, "set_room_settings", {
  p_room: salaC.id,
  p_settings: { modo: "relampago" },
});
ok(
  /BAD_MODE/.test(JSON.stringify(modoRuimD.body)),
  "o Relâmpago é RECUSADO: o PRD o define com um mapa de 24 territórios que não existe, e rótulo que o jogo não cumpre não entra",
);

const chaveRuimD = await rpc(P[0].token, "set_room_settings", {
  p_room: salaC.id,
  p_settings: { bolao: true },
});
ok(
  /UNKNOWN_SETTING_bolao/.test(JSON.stringify(chaveRuimD.body)),
  "e chave de outro jogo também",
);

const classico = await rpc(P[0].token, "set_room_settings", {
  p_room: salaC.id,
  p_settings: { modo: "classico" },
});
ok(classico.body?.settings?.modo === "classico", "o anfitrião escolhe o Clássico");

const campanhaOk = await rpc(P[0].token, "set_room_settings", {
  p_room: salaC.id,
  p_settings: { modo: "campanha" },
});
ok(campanhaOk.body?.settings?.modo === "campanha", "e a Campanha");

/* ── uma partida em Campanha: o estado nasce certo ─────────────────────── */

await rpc(P[1].token, "join_room", { p_code: salaC.code });
await rpc(P[2].token, "join_room", { p_code: salaC.code });
const jogoC = (await rpc(P[0].token, "dominio_start", { p_room: salaC.id })).body;
ok(!!jogoC?.id, "partida em Campanha criada");
if (jogoC?.public_state) {
  const c = jogoC.public_state;
  ok(c.mode === "campanha", "o modo ficou gravado como campanha");
  ok(c.rodadaFinal === 12, "com doze rodadas de prazo");
  ok(
    JSON.stringify(c.pontos) === "{}" &&
      JSON.stringify(c.tomou) === "{}" &&
      JSON.stringify(c.aguardando) === "{}",
    "e os contadores da Campanha nascem vazios",
  );
}

/* ── o fim por pontos, e os vinte do objetivo ──────────────────────────── */

const porPontos = await db.query(
  `select public.dominio_termina_pontos($1::uuid, $2::jsonb) v`,
  [
    jogoC.id,
    JSON.stringify({
      ...campanha(aureliaC),
      round: 13,
      pontos: { 0: 40, 1: 55, 2: 12 },
    }),
  ],
);
ok(
  porPontos.rows[0].v.vencedor === 1,
  `venceu quem tinha mais pontos: assento ${porPontos.rows[0].v.vencedor} com 55`,
);
ok(
  porPontos.rows[0].v.fimPor === "pontos",
  "e a marca diz que acabou por rodadas, não por objetivo",
);
ok(
  Number(porPontos.rows[0].v.pontos["1"]) === 55,
  "sem os vinte do objetivo — ele não cumpriu objetivo nenhum",
);

// e o mesmo fim, mas por objetivo: vinte pontos entram
const porObjetivo = await db.query(
  `select public.dominio_termina($1::uuid, $2::jsonb, 0::smallint) v`,
  [
    jogoC.id,
    JSON.stringify({ ...campanha(aureliaC), round: 5, pontos: { 0: 18 } }),
  ],
);
ok(
  Number(porObjetivo.rows[0].v.pontos["0"]) === 38,
  "objetivo cumprido vale +20 no placar da Campanha (18 → 38)",
);
ok(
  porObjetivo.rows[0].v.fimPor === "objetivo",
  "e a marca distingue os dois caminhos de fim",
);

// no Clássico, os vinte não entram
const noClassico = await db.query(
  `select public.dominio_termina($1::uuid, $2::jsonb, 0::smallint) v`,
  [
    jogoC.id,
    JSON.stringify({ ...campanha(aureliaC), mode: "classico", pontos: { 0: 18 } }),
  ],
);
ok(
  Number(noClassico.rows[0].v.pontos["0"]) === 18,
  "no Clássico não há placar: os vinte pontos não existem lá",
);

/* ══════════════════════════════════════════════════════════════════════════
   O CÉREBRO DA MÁQUINA

   O Domínio pede três pessoas. Sem máquina não existe partida solo, e juntar
   três pessoas ao mesmo tempo é a coisa mais difícil de um site de jogo de
   tabuleiro. Então este bloco é o que decide se o Domínio é jogável sozinho.

   Prova cinco coisas, em ordem de importância:

   1. UMA PARTIDA SOLO INTEIRA RODA DO COMEÇO AO FIM. Não um turno: a partida.
      A cada turno, o mapa é conferido inteiro — território com zero exército,
      dono que não existe, fase impossível. Um cérebro que quebra o mapa na
      trigésima rodada é PIOR que nenhum, porque quebra depois de a pessoa ter
      investido meia hora.

   2. O NÍVEL SIGNIFICA ALGO. Na mesma quantidade de turnos, as impiedosas têm
      de terminar com mais mapa que as tranquilas. Nível que é rótulo é pior que
      não ter nível.

   3. A MÁQUINA NÃO TRAPACEIA. Ela joga pelas funções de 0047, as mesmas de uma
      pessoa — então trapaça de regra é impossível por construção. O teste
      confere no MAPA de todo modo, porque "impossível por construção" é
      exatamente o que se diz antes de descobrir que era possível.

   4. NINGUÉM FICA ESPERANDO. A faxina joga o turno da máquina em vez de pulá-lo.

   5. O CÉREBRO É DETERMINÍSTICO. Bug de máquina que não reproduz não se
      conserta.
   ══════════════════════════════════════════════════════════════════════════ */

console.log("\n  ── o cérebro da máquina ──");

/** Confere o mapa inteiro. Devolve a lista de problemas — vazia é bom. */
function conferirMapa(st, quantosJogadores) {
  const p = [];
  const ters = Object.keys(st.donos ?? {});
  if (ters.length !== 42) p.push(`${ters.length} territórios em vez de 42`);
  for (const t of ters) {
    const n = st.exercitos?.[t];
    if (typeof n !== "number") p.push(`${t} sem exército`);
    else if (n < 1) p.push(`${t} com ${n} exército(s)`);
    const dono = Number(st.donos[t]);
    if (!Number.isInteger(dono) || dono < 0 || dono >= quantosJogadores) {
      p.push(`${t} é do assento ${st.donos[t]}, que não existe`);
    }
  }
  if (!["reforco", "ataque", "remanejo", "fim"].includes(st.phase)) {
    p.push(`fase impossível: ${st.phase}`);
  }
  if ((st.reforcoLeft ?? 0) < 0) p.push(`reforcoLeft negativo: ${st.reforcoLeft}`);
  return p;
}

/**
 * Joga uma partida solo até acabar, ou até o teto de turnos.
 *
 * O HUMANO É PASSIVO, MAS NÃO SUICIDA: ele espalha o reforço nos territórios
 * dele mais fracos e nunca ataca. Passivo de propósito, porque o que se mede
 * aqui é a máquina; não suicida de propósito, porque um humano que se mata
 * sozinho zera as duas comparações e o teste vira cara ou coroa.
 */
async function partidaSolo({ token, niveis, tetoTurnos }) {
  const salaS = (await rpc(token, "create_room", { p_game: "dominio" })).body;
  for (const n of niveis) {
    const r = await rpc(token, "adicionar_bot", { p_room: salaS.id, p_nivel: n });
    if (r.status !== 200) return { erro: `adicionar_bot(${n}): ${JSON.stringify(r.body)}` };
  }
  const ini = await rpc(token, "dominio_start", { p_room: salaS.id });
  if (ini.status !== 200) return { erro: `dominio_start: ${JSON.stringify(ini.body)}` };

  const idPartida = ini.body.id;
  const elenco = (
    await db.query(
      `select mp.seat, p.is_bot from match_players mp
        join profiles p on p.id = mp.user_id
       where mp.match_id = $1 order by mp.seat`,
      [idPartida],
    )
  ).rows;
  const meuAssento = Number(elenco.find((e) => !e.is_bot).seat);
  const assentosBot = elenco.filter((e) => e.is_bot).map((e) => Number(e.seat));

  const problemas = [];
  let turnos = 0;
  let turnosBot = 0;
  let conquistasBot = 0;
  let maxPorTurno = 0;
  let maxPassosTurno = 0;
  let acabou = false;

  while (turnos < tetoTurnos) {
    const linha = (
      await db.query("select status, public_state from matches where id = $1", [idPartida])
    ).rows[0];
    const st = linha.public_state;
    if (linha.status !== "running") {
      acabou = true;
      break;
    }

    const ruim = conferirMapa(st, elenco.length);
    if (ruim.length) {
      problemas.push(`turno ${turnos}, assento ${st.turnSeat}: ${ruim.slice(0, 3).join("; ")}`);
      break;
    }

    if (Number(st.turnSeat) === meuAssento) {
      const meus = Object.keys(st.donos)
        .filter((t) => Number(st.donos[t]) === meuAssento)
        .sort((a, b) => st.exercitos[a] - st.exercitos[b]);
      if (meus.length === 0) break;

      let resta = st.reforcoLeft ?? 0;
      if (resta > 0) {
        const tenta = await rpc(token, "dominio_reforcar", {
          p_match: idPartida,
          p_ter: meus[0],
          p_qtd: 1,
        });
        if (tenta.status !== 200 && /MUST_TRADE/.test(JSON.stringify(tenta.body))) {
          await rpc(token, "dominio_trocar", { p_match: idPartida, p_cartas: [0, 1, 2] });
          resta = Number(
            (
              await db.query("select public_state ->> 'reforcoLeft' r from matches where id = $1", [
                idPartida,
              ])
            ).rows[0].r,
          );
        } else if (tenta.status === 200) {
          resta -= 1;
        } else {
          problemas.push(`humano não reforçou: ${JSON.stringify(tenta.body).slice(0, 110)}`);
          break;
        }
        // espalha o resto nos mais fracos, um por um
        let i = 1;
        while (resta > 0) {
          const alvo = meus[i % meus.length];
          const r = await rpc(token, "dominio_reforcar", {
            p_match: idPartida,
            p_ter: alvo,
            p_qtd: 1,
          });
          if (r.status !== 200) break;
          resta -= 1;
          i++;
        }
      }
      const fim = await rpc(token, "dominio_encerrar_turno", { p_match: idPartida });
      if (fim.status !== 200) {
        problemas.push(`humano não passou a vez: ${JSON.stringify(fim.body).slice(0, 120)}`);
        break;
      }
    } else {
      const antes = { ...st.donos };
      /* Pela conexão DIRETA, e não pelo HTTP: cada turno por `dominio_tocar`
         custava um round-trip até o Supabase, e esta suíte roda TRÊS partidas
         inteiras. O RPC tem asserções próprias logo acima; o que a partida longa
         mede é o cérebro, e ele é o mesmo dos dois lados. */
      let feito = 0;
      const antesConquistas = conquistasBot;
      try {
        feito = Number(
          (await db.query("select public.dominio_bot_turno($1::uuid) n", [idPartida])).rows[0].n,
        );
      } catch (e) {
        problemas.push(`dominio_bot_turno no assento ${st.turnSeat}: ${String(e).slice(0, 200)}`);
        break;
      }
      if (feito === 0) {
        problemas.push(`a máquina do assento ${st.turnSeat} não fez nada`);
        break;
      }
      /* E NÃO FEZ DEMAIS. Desde 0068 o turno é um laço em cima de
         `dominio_bot_passo`, e um passo que não avança o estado faria o laço rodar
         até o teto de 40 sem dar erro nenhum — a máquina "jogaria" quarenta vezes
         e o mapa ficaria igual. Um turno de verdade cabe em vinte. */
      if (feito > 30) {
        problemas.push(
          `a máquina do assento ${st.turnSeat} deu ${feito} passos num turno só` +
            " — algum passo não está avançando o estado",
        );
        break;
      }
      maxPassosTurno = Math.max(maxPassosTurno, feito);
      turnosBot++;
      /* QUANTOS TERRITÓRIOS ELA TOMOU NESTE TURNO, contados no mapa e não no
         registro: `dominio_log` guarda 80 linhas, e uma partida de 36 turnos
         passa disso. Medir pelo registro seria medir a janela do registro. */
      const depois =
        (
          await db.query("select public_state from matches where id = $1", [idPartida])
        ).rows[0].public_state.donos ?? {};
      const dela = Number(st.turnSeat);
      for (const ter of Object.keys(antes)) {
        if (Number(antes[ter]) !== dela && Number(depois[ter]) === dela) conquistasBot++;
      }
      // o MÁXIMO num único turno: é o que a política garante, e o que dá um teste
      // que não balança com o dado
      maxPorTurno = Math.max(maxPorTurno, conquistasBot - antesConquistas);
    }
    turnos++;
  }

  const fim = (
    await db.query("select status, public_state from matches where id = $1", [idPartida])
  ).rows[0];
  const contagem = {};
  for (const t of Object.keys(fim.public_state.donos ?? {})) {
    const d = Number(fim.public_state.donos[t]);
    contagem[d] = (contagem[d] ?? 0) + 1;
  }
  const vencedor = fim.public_state.vencedor;
  /* A FORÇA DAS MÁQUINAS numa partida: quanto mapa elas seguram. Se uma delas
     GANHOU, seguram tudo — 42 — porque a partida acabou justamente por isso.
     Sem essa regra, a partida que a máquina ganha rápido mediria força MENOR
     que a que ela quase ganha devagar. */
  const forcaBot =
    vencedor !== undefined && vencedor !== null && assentosBot.includes(Number(vencedor))
      ? 42
      : assentosBot.reduce((soma, s) => soma + (contagem[s] ?? 0), 0);

  return {
    id: idPartida,
    meuAssento,
    assentosBot,
    turnos,
    turnosBot,
    conquistasBot,
    maxPorTurno,
    maxPassosTurno,
    /* A FORÇA DE UM NÍVEL: territórios tomados POR TURNO de máquina.
       É a medida certa por dois motivos. Primeiro, ela não satura: contar
       territórios no fim dá 42 para qualquer dupla que vença, e contra um humano
       passivo toda dupla acaba vencendo — foi assim que a primeira versão deste
       teste comparou 42 com 42 e não disse nada. Segundo, ela mede exatamente o
       que o nível DEFINE: a tranquila ataca com dois de vantagem e no máximo
       duas vezes; a impiedosa ataca em paridade e até doze. */
    porTurno: turnosBot > 0 ? conquistasBot / turnosBot : 0,
    acabou,
    problemas,
    st: fim.public_state,
    status: fim.status,
    contagem,
    forcaBot,
    vencedor,
  };
}

/* ── 1. a recusa: tocar não é jogar no lugar de gente ─────────────────────── */

const salaT = (await rpc(P[0].token, "create_room", { p_game: "dominio" })).body;
await rpc(P[0].token, "adicionar_bot", { p_room: salaT.id, p_nivel: "medio" });
await rpc(P[0].token, "adicionar_bot", { p_room: salaT.id, p_nivel: "dificil" });
const iniT = await rpc(P[0].token, "dominio_start", { p_room: salaT.id });
ok(
  iniT.status === 200,
  `partida solo com duas máquinas começa${iniT.status !== 200 ? " " + JSON.stringify(iniT.body).slice(0, 130) : ""}`,
);

const trioT = (
  await db.query(
    `select mp.seat, p.is_bot, p.display_name, rm.bot_nivel
       from match_players mp
       join profiles p on p.id = mp.user_id
       left join room_members rm on rm.room_id = $2 and rm.user_id = mp.user_id
      where mp.match_id = $1 order by mp.seat`,
    [iniT.body.id, salaT.id],
  )
).rows;
ok(
  trioT.filter((t) => t.is_bot).length === 2,
  `três na mesa, duas máquinas: ${trioT
    .map((t) => t.display_name + (t.is_bot ? ` (${t.bot_nivel})` : ""))
    .join(", ")}`,
);

const meuT = Number(trioT.find((t) => !t.is_bot).seat);
const botSeat = Number(trioT.find((t) => t.is_bot).seat);

// na vez de gente, tocar recusa
await db.query(
  `update matches set public_state = jsonb_set(public_state, '{turnSeat}', to_jsonb($2::int))
    where id = $1`,
  [iniT.body.id, meuT],
);
const recusa = await rpc(P[0].token, "dominio_tocar", { p_match: iniT.body.id });
ok(
  /NOT_BOT_TURN/.test(JSON.stringify(recusa.body)),
  "na vez de GENTE, `dominio_tocar` recusa — o cliente manda no ritmo, nunca no resultado",
);

const deFora = await rpc(P[2].token, "dominio_tocar", { p_match: iniT.body.id });
ok(
  /NOT_A_PLAYER/.test(JSON.stringify(deFora.body)),
  "e quem não está na mesa não toca a máquina de ninguém",
);

/* ── 2. a faxina joga o turno da máquina, e não pula ──────────────────────── */

/* A FOTO VEM ANTES DE ESTOURAR O RELÓGIO, e a ordem é o teste inteiro.

   O `pg_cron` roda `dominio_sweep()` sozinho a cada minuto. Se o teste
   estourasse o relógio primeiro e tirasse a foto depois, o cron poderia passar
   no meio: jogaria o turno da máquina, resetaria o relógio para +120s, e a
   faxina do teste não encontraria nada expirado. O registro não cresceria, e o
   teste reprovaria por uma coisa que ACONTECEU.

   Foi exatamente isso que fez esta suíte falhar dentro do lote e passar sozinha:
   o lote demora mais, e quanto mais tempo, mais chance de o cron cair no meio.

   Com a foto antes, qualquer trabalho que o cron faça conta a favor da
   asserção — e é o que se quer, porque a pergunta é "o turno da máquina foi
   jogado?" e não "foi jogado por esta chamada específica". */
const antesFaxina = Number(
  (
    await db.query(
      "select jsonb_array_length(coalesce(public_state -> 'log', '[]'::jsonb)) n from matches where id = $1",
      [iniT.body.id],
    )
  ).rows[0].n,
);

/* E a faxina só age em mesa com gente por perto (0071), então o teste diz que há
   gente — que é a verdade que ele está simulando. */
await rpc(P[0].token, "touch_presence", { p_room: salaT.id });
await db.query(
  `update matches
      set public_state = jsonb_set(jsonb_set(public_state, '{turnSeat}', to_jsonb($2::int)),
            '{phase}', '"reforco"'),
          turn_deadline = now() - interval '1 second'
    where id = $1`,
  [iniT.body.id, botSeat],
);
const varrida = { rows: [{ n: await varre("dominio_sweep") }] };
const depoisFaxina = (
  await db.query(
    `select coalesce(public_state -> 'log', '[]'::jsonb) l,
            (public_state ->> 'turnSeat')::int t, status
       from matches where id = $1`,
    [iniT.body.id],
  )
).rows[0];
ok(Number(varrida.rows[0].n) >= 1, `a faxina agiu na mesa com máquina (${varrida.rows[0].n})`);
ok(
  Number(depoisFaxina.t) !== botSeat || depoisFaxina.status !== "running",
  `e a vez saiu da máquina (${botSeat} → ${depoisFaxina.t}): ninguém fica esperando uma máquina`,
);
ok(
  (depoisFaxina.l ?? []).filter((l) => l.k === "tempo-esgotado" && Number(l.seat) === botSeat)
    .length === 0,
  "o registro NÃO diz que a máquina perdeu o turno no relógio — ela jogou",
);
ok(
  (depoisFaxina.l ?? []).length > antesFaxina,
  `o registro cresceu de ${antesFaxina} para ${(depoisFaxina.l ?? []).length} linhas: a máquina fez coisas`,
);

/* ── 2b. o relógio não corre contra quem está sozinho ────────────────

   O relógio do turno existe para proteger AS OUTRAS PESSOAS de quem sumiu. Numa
   mesa em que todo o resto é máquina, não há quem proteger — e o que ele faz ali
   é tirar o turno de quem atendeu o telefone. No celular esse é o caso COMUM, não
   o raro: sair do aplicativo já é sair da aba, e o modo solo é onde isso mais
   acontece.

   As duas pontas são testadas, e a segunda é a que impede o conserto de virar
   buraco: com OUTRA PESSOA na mesa, o relógio volta a correr normalmente. */

// a vez volta para a pessoa, e o relógio estoura
await db.query(
  `update matches set
     public_state = jsonb_set(jsonb_set(public_state, '{turnSeat}', to_jsonb($2::int)),
       '{phase}', '"reforco"'),
     turn_deadline = now() - interval '1 second'
   where id = $1`,
  [iniT.body.id, meuT],
);
await rpc(P[0].token, "touch_presence", { p_room: salaT.id });
await varre("dominio_sweep");
const soloRelogio = (
  await db.query(
    `select turn_deadline, (public_state ->> 'turnSeat')::int t from matches where id = $1`,
    [iniT.body.id],
  )
).rows[0];
ok(
  soloRelogio.turn_deadline === null,
  "numa mesa só com máquinas, a faxina DESLIGA o relógio em vez de tirar o turno",
);
ok(
  Number(soloRelogio.t) === meuT,
  `e a vez continua sendo minha (assento ${soloRelogio.t}) — atender o telefone não custa um turno`,
);

/* A CONTRAPROVA. Com outra pessoa na mesa o relógio volta a correr, senão o
   conserto vira um jeito de travar a partida dos outros. */
const salaDupla = (await rpc(P[0].token, "create_room", { p_game: "dominio" })).body;
await rpc(P[1].token, "join_room", { p_code: salaDupla.code });
await rpc(P[0].token, "adicionar_bot", { p_room: salaDupla.id, p_nivel: "medio" });
const iniD = await rpc(P[0].token, "dominio_start", { p_room: salaDupla.id });
if (iniD.status === 200) {
  const humanoD = Number(
    (
      await db.query(
        `select mp.seat from match_players mp join profiles p on p.id = mp.user_id
          where mp.match_id = $1 and not p.is_bot order by mp.seat limit 1`,
        [iniD.body.id],
      )
    ).rows[0].seat,
  );
  await db.query(
    `update matches set
       public_state = jsonb_set(jsonb_set(public_state, '{turnSeat}', to_jsonb($2::int)),
         '{phase}', '"reforco"'),
       turn_deadline = now() - interval '1 second'
     where id = $1`,
    [iniD.body.id, humanoD],
  );
  await rpc(P[0].token, "touch_presence", { p_room: salaDupla.id });
  await varre("dominio_sweep");
  const duplaRelogio = (
    await db.query(
      `select turn_deadline, (public_state ->> 'turnSeat')::int t from matches where id = $1`,
      [iniD.body.id],
    )
  ).rows[0];
  ok(
    Number(duplaRelogio.t) !== humanoD,
    `com OUTRA PESSOA na mesa o relógio corre normalmente e a vez passa (${humanoD} → ${duplaRelogio.t}) — o conserto não pode virar um jeito de travar a partida dos outros`,
  );
  ok(
    duplaRelogio.turn_deadline !== null,
    "e o relógio do próximo continua de pé",
  );
}

/* ── 2c. mesa abandonada não se joga sozinha ─────────────────────

   A máquina existe para o jogo andar PARA ALGUÉM. Sem ninguém por perto, o que a
   faxina faz é jogar turno atrás de turno para uma plateia vazia, a cada passada
   do cron, até a sala expirar em vinte e quatro horas.

   E o pior nem é o custo: é que quem abandonou uma partida e volta no dia
   seguinte encontraria um jogo TERMINADO, decidido por máquinas jogando entre si
   a noite inteira. */

await db.query(
  `update matches set
     public_state = jsonb_set(jsonb_set(public_state, '{turnSeat}', to_jsonb($2::int)),
       '{phase}', '"reforco"'),
     turn_deadline = now() - interval '1 second'
   where id = $1`,
  [iniT.body.id, botSeat],
);
// ninguém aparece há uma hora
await db.query(
  "update room_members set last_seen_at = now() - interval '1 hour' where room_id = $1",
  [salaT.id],
);
ok(
  (await db.query("select public.mesa_abandonada($1::uuid) a", [iniT.body.id])).rows[0].a === true,
  "sem gente há uma hora, a mesa é considerada abandonada",
);
const antesAbandono = (
  await db.query("select public_state ps from matches where id = $1", [iniT.body.id])
).rows[0].ps;
await varre("dominio_sweep");
const depoisAbandono = (
  await db.query("select public_state ps from matches where id = $1", [iniT.body.id])
).rows[0].ps;
ok(
  JSON.stringify(antesAbandono) === JSON.stringify(depoisAbandono),
  "e a faxina não toca em nada — quem voltar encontra o próprio jogo, não um jogo terminado sem ela",
);

// e volta a agir assim que alguém aparece
await rpc(P[0].token, "touch_presence", { p_room: salaT.id });
await varre("dominio_sweep");
const depoisVoltar = (
  await db.query("select public_state ps from matches where id = $1", [iniT.body.id])
).rows[0].ps;
ok(
  JSON.stringify(depoisVoltar) !== JSON.stringify(antesAbandono),
  "e volta a agir assim que alguém aparece — `touch_presence` religa a faxina na hora",
);

/* ── 3. UMA PARTIDA SOLO INTEIRA ─────────────────────────────────────────── */

const solo = await partidaSolo({ token: P[0].token, niveis: ["medio", "dificil"], tetoTurnos: 400 });
ok(!solo.erro, `a partida solo montou${solo.erro ? ": " + solo.erro : ""}`);
if (!solo.erro) {
  ok(
    solo.problemas.length === 0,
    solo.problemas.length === 0
      ? `${solo.turnos} turnos jogados e o mapa nunca ficou inválido`
      : `MAPA QUEBRADO: ${solo.problemas[0]}`,
  );
  ok(
    solo.acabou,
    solo.acabou
      ? `e a partida ACABOU sozinha em ${solo.turnos} turnos — o Domínio é jogável sozinho`
      : `a partida não acabou em ${solo.turnos} turnos: ${JSON.stringify(solo.contagem)}`,
  );
  ok(
    solo.turnosBot >= 2,
    `as máquinas jogaram ${solo.turnosBot} turnos, o mais longo em ${solo.maxPassosTurno} passos`,
  );
  const somaEx = Object.values(solo.st.exercitos ?? {}).reduce((a, b) => a + b, 0);
  ok(somaEx >= 42, `${somaEx} exércitos em 42 territórios — nunca menos de um por território`);
  console.log(
    `         no fim: ${Object.entries(solo.contagem)
      .map(([s, n]) => `assento ${s}=${n}`)
      .join(", ")}${solo.vencedor !== undefined && solo.vencedor !== null ? ` · venceu ${solo.vencedor}` : ""}`,
  );
  const kinds = new Set((solo.st.log ?? []).map((l) => l.k));
  ok(
    kinds.has("conquista"),
    `o registro mostra conquista de verdade (tipos: ${[...kinds].join(", ")})`,
  );
}

/* ── 4. a máquina não trapaceia ──────────────────────────────────────────── */

if (!solo.erro) {
  const mapaS = (
    await db.query(
      `select gt.data d from game_themes gt
        join matches m on gt.id = (m.public_state ->> 'map') where m.id = $1`,
      [solo.id],
    )
  ).rows[0].d;
  const adj = mapaS.adjacencia;
  const conquistas = (solo.st.log ?? []).filter((l) => l.k === "conquista");
  ok(
    conquistas.length > 0 && conquistas.every((l) => (adj[l.de] ?? []).includes(l.para)),
    `todas as ${conquistas.length} conquistas do registro foram entre territórios VIZINHOS`,
  );
  const remanejos = (solo.st.log ?? []).filter((l) => l.k === "remanejo");
  ok(
    remanejos.every((l) => l.n >= 1),
    `nenhum remanejo de zero exército (${remanejos.length} no registro)`,
  );
  const avancos = (solo.st.log ?? []).filter((l) => l.k === "avanco");
  ok(
    avancos.every((l) => l.n >= 1 && l.n <= 2),
    `todo avanço ficou entre 1 e 2 exércitos (${avancos.length} no registro)`,
  );
  const reforcos = (solo.st.log ?? []).filter((l) => l.k === "reforco");
  ok(
    reforcos.every((l) => l.n >= 1),
    `e todo reforço do registro põe pelo menos um exército (${reforcos.length} linhas)`,
  );
}

/* ── 5. o nível significa algo? ──────────────────────────────────────────── */

/* Duas partidas com o MESMO humano passivo e o mesmo teto de turnos: uma contra
   duas tranquilas, outra contra duas impiedosas. Se o nível for rótulo, as duas
   duplas seguram o mesmo tanto de mapa. */

const contraFacil = await partidaSolo({ token: P[0].token, niveis: ["facil", "facil"], tetoTurnos: 60 });
const contraDif = await partidaSolo({ token: P[0].token, niveis: ["dificil", "dificil"], tetoTurnos: 60 });

ok(
  !contraFacil.erro && !contraDif.erro,
  `as duas partidas de comparação montaram${contraFacil.erro || contraDif.erro ? ": " + (contraFacil.erro ?? contraDif.erro) : ""}`,
);
if (!contraFacil.erro && !contraDif.erro) {
  ok(
    contraFacil.problemas.length === 0 && contraDif.problemas.length === 0,
    contraFacil.problemas.length === 0 && contraDif.problemas.length === 0
      ? "as duas rodaram sem quebrar o mapa"
      : `MAPA QUEBRADO: ${contraFacil.problemas[0] ?? contraDif.problemas[0]}`,
  );
  /* O NÍVEL É CONFERIDO ONDE ELE MORA, e não na média de uma partida.

     Este teste comparava territórios tomados por turno entre as duas duplas. Em
     três execuções seguidas ele mediu 0,50 contra 3,17; depois 1,63 contra 4,32;
     depois 1,79 contra 2,26 — e nessa última reprovou, porque o dado foi bom
     para a tranquila. Uma partida é uma amostra de UM, e teste que reprova por
     sorte do dado é pior que teste nenhum: ensina a ignorar a saída vermelha.

     Foi a mesma lição que a Metrópole deu duas vezes em 0055 (patrimônio final e
     caixa final mediram a coisa errada). Então 0062 tirou os três números do meio
     do turno e pôs numa tabela com nome, e o teste lê a tabela. */
  const agressao = (
    await db.query(
      `select nivel, t_margem, t_teto, t_vezes
         from unnest(array['facil', 'medio', 'dificil']) nivel,
              lateral public.dominio_bot_agressao(nivel)`,
    )
  ).rows;
  const porNivel = Object.fromEntries(agressao.map((r) => [r.nivel, r]));
  ok(
    Number(porNivel.facil.t_margem) > Number(porNivel.medio.t_margem) &&
      Number(porNivel.medio.t_margem) > Number(porNivel.dificil.t_margem),
    `a exigência de vantagem cai com o nível: tranquila pede +${porNivel.facil.t_margem}, firme +${porNivel.medio.t_margem}, impiedosa +${porNivel.dificil.t_margem}` +
      " (em paridade o atacante leva vantagem, e só a impiedosa sabe disso)",
  );
  ok(
    Number(porNivel.facil.t_teto) < Number(porNivel.medio.t_teto) &&
      Number(porNivel.medio.t_teto) < Number(porNivel.dificil.t_teto),
    `e o número de ataques por turno sobe: ${porNivel.facil.t_teto}, ${porNivel.medio.t_teto}, ${porNivel.dificil.t_teto}`,
  );

  /* E NA MESA, o que a política GARANTE — não o que ela costuma dar.
     A tranquila ataca no máximo duas vezes por turno, então ela nunca toma mais
     de dois territórios num turno. Isso é um TETO, e teto não depende de dado. */
  ok(
    contraFacil.maxPorTurno <= Number(porNivel.facil.t_teto),
    `e a tranquila nunca tomou mais de ${contraFacil.maxPorTurno} território(s) num turno — o teto dela é ${porNivel.facil.t_teto}, e teto não depende de sorte`,
  );

  console.log(
    `         observado — territórios por turno: tranquila ${contraFacil.porTurno.toFixed(2)},` +
      ` impiedosa ${contraDif.porTurno.toFixed(2)}` +
      ` (${contraFacil.conquistasBot}/${contraFacil.turnosBot} contra ${contraDif.conquistasBot}/${contraDif.turnosBot})`,
  );
}

/* ── 6. o cérebro é determinístico ───────────────────────────────────────── */

/* A MESMA partida, o mesmo estado, o mesmo assento: rodar o turno duas vezes
   tem de dar o mesmo mapa. É a única forma de um bug de máquina ser
   reproduzível — e bug de máquina é o mais difícil de reproduzir que existe. */

const salaR = (await rpc(P[0].token, "create_room", { p_game: "dominio" })).body;
await rpc(P[0].token, "adicionar_bot", { p_room: salaR.id, p_nivel: "dificil" });
await rpc(P[0].token, "adicionar_bot", { p_room: salaR.id, p_nivel: "medio" });
const iniR = await rpc(P[0].token, "dominio_start", { p_room: salaR.id });
const seatR = Number(
  (
    await db.query(
      `select mp.seat from match_players mp join profiles p on p.id = mp.user_id
        where mp.match_id = $1 and p.is_bot order by mp.seat limit 1`,
      [iniR.body.id],
    )
  ).rows[0].seat,
);
const partidaBase = (
  await db.query(
    `select jsonb_set(public_state, '{turnSeat}', to_jsonb($2::int)) e, status, turn_deadline d
       from matches where id = $1`,
    [iniR.body.id, seatR],
  )
).rows[0];

const duas = [];
for (let volta = 0; volta < 2; volta++) {
  await db.query(
    `update matches set public_state = $2::jsonb, status = 'running', ended_at = null
      where id = $1`,
    [iniR.body.id, JSON.stringify(partidaBase.e)],
  );
  await db.query("select public.dominio_bot_turno($1::uuid)", [iniR.body.id]);
  const dep = (
    await db.query("select public_state s from matches where id = $1", [iniR.body.id])
  ).rows[0].s;
  duas.push({ exercitos: dep.exercitos, donos: dep.donos, seq: dep.seq });
}
ok(
  JSON.stringify(duas[0].exercitos) === JSON.stringify(duas[1].exercitos) &&
    JSON.stringify(duas[0].donos) === JSON.stringify(duas[1].donos),
  "mesmo estado, mesmo turno: o cérebro é determinístico — sem isso, bug de máquina não se conserta",
);

/* ══════════════════════════════════════════════════════════════════════════
   A TRÉGUA, E O PREÇO DE ROMPÊ-LA

   §6.6 do PRD, e a frase que decide o desenho inteiro:

     "O ponto não é impedir a traição — é DAR PESO a ela. Traição sem custo é
      ruído; traição com custo é história."

   Por isso o teste central deste bloco não é "a trégua impede o ataque". É o
   contrário: O ATAQUE PASSA, e a conta chega. Um teste que exigisse o bloqueio
   estaria provando que o jogo é outro.
   ══════════════════════════════════════════════════════════════════════════ */

console.log("\n  ── a trégua ──");

const salaTr = (await rpc(P[0].token, "create_room", { p_game: "dominio" })).body;
await rpc(P[1].token, "join_room", { p_code: salaTr.code });
await rpc(P[2].token, "join_room", { p_code: salaTr.code });
const iniTr = await rpc(P[0].token, "dominio_start", { p_room: salaTr.id });
ok(iniTr.status === 200, "partida de três para a trégua");

if (iniTr.status === 200) {
  const idTr = iniTr.body.id;
  const assentos = Object.fromEntries(
    (
      await db.query(
        "select mp.user_id, mp.seat from match_players mp where mp.match_id = $1",
        [idTr],
      )
    ).rows.map((r) => [r.user_id, Number(r.seat)]),
  );
  const seatDe = (jog) => assentos[jog.id];

  // a vez é de P[0], para ele poder propor
  await db.query(
    "update matches set public_state = jsonb_set(public_state, '{turnSeat}', to_jsonb($2::int)) where id = $1",
    [idTr, seatDe(P[0])],
  );

  const semAlvo = await rpc(P[0].token, "dominio_propor_tregua", {
    p_match: idTr,
    p_com: seatDe(P[0]),
  });
  ok(
    /SELF_TRUCE/.test(JSON.stringify(semAlvo.body)),
    "ninguém faz trégua consigo mesmo",
  );

  const proposta = await rpc(P[0].token, "dominio_propor_tregua", {
    p_match: idTr,
    p_com: seatDe(P[1]),
  });
  ok(
    proposta.status === 200,
    `a trégua é PROPOSTA${proposta.status !== 200 ? " " + JSON.stringify(proposta.body).slice(0, 120) : ""}`,
  );

  const soProposta = (
    await db.query(
      `select public.dominio_tregua_vale(public_state, $2::smallint, $3::smallint) v
         from matches where id = $1`,
      [idTr, seatDe(P[0]), seatDe(P[1])],
    )
  ).rows[0].v;
  ok(
    soProposta === false,
    "e proposta ainda NÃO é trégua — acordo que vale sem o outro aceitar é regra imposta com cara de acordo",
  );

  const euMesmo = await rpc(P[0].token, "dominio_responder_tregua", {
    p_match: idTr,
    p_de: seatDe(P[0]),
    p_aceita: true,
  });
  ok(
    /NO_PROPOSAL/.test(JSON.stringify(euMesmo.body)),
    "e ninguém aceita a própria proposta",
  );

  const aceita = await rpc(P[1].token, "dominio_responder_tregua", {
    p_match: idTr,
    p_de: seatDe(P[0]),
    p_aceita: true,
  });
  ok(
    aceita.status === 200,
    `o outro ACEITA, e aceita fora da vez dele${aceita.status !== 200 ? " " + JSON.stringify(aceita.body).slice(0, 120) : ""}`,
  );
  ok(
    (
      await db.query(
        `select public.dominio_tregua_vale(public_state, $2::smallint, $3::smallint) v
           from matches where id = $1`,
        [idTr, seatDe(P[0]), seatDe(P[1])],
      )
    ).rows[0].v === true,
    "agora a trégua vale",
  );
  ok(
    (
      await db.query(
        `select public.dominio_tregua_vale(public_state, $2::smallint, $3::smallint) v
           from matches where id = $1`,
        [idTr, seatDe(P[0]), seatDe(P[2])],
      )
    ).rows[0].v === false,
    "e vale só entre os dois — o terceiro segue de fora",
  );

  /* ── A MÁQUINA RESPONDE, E RESPONDE FORA DA VEZ DELA ──────────────────

     Uma proposta de trégua chega no turno de QUEM PROPÔS — quase sempre a
     pessoa. Se a máquina só respondesse na vez dela, a proposta ficaria
     pendurada uma volta inteira do tabuleiro, e proposta pendurada é proposta
     que ninguém lembra de responder.

     0081 escreveu essa resposta DEPOIS da linha "se não é vez de máquina, volta"
     — onde ela nunca rodava. Este teste é o que teria pegado. */
  const salaMq = (await rpc(P[0].token, "create_room", { p_game: "dominio" })).body;
  await rpc(P[0].token, "adicionar_bot", { p_room: salaMq.id, p_nivel: "dificil" });
  await rpc(P[0].token, "adicionar_bot", { p_room: salaMq.id, p_nivel: "medio" });
  const iniMq = await rpc(P[0].token, "dominio_start", { p_room: salaMq.id });
  if (iniMq.status === 200) {
    const meuMq = Number(
      (
        await db.query(
          `select mp.seat from match_players mp join profiles p on p.id = mp.user_id
            where mp.match_id = $1 and not p.is_bot`,
          [iniMq.body.id],
        )
      ).rows[0].seat,
    );
    const botMq = Number(
      (
        await db.query(
          `select mp.seat from match_players mp join profiles p on p.id = mp.user_id
            where mp.match_id = $1 and p.is_bot order by mp.seat limit 1`,
          [iniMq.body.id],
        )
      ).rows[0].seat,
    );
    // a vez é de GENTE, que é quando a proposta existe
    await db.query(
      "update matches set public_state = jsonb_set(public_state, '{turnSeat}', to_jsonb($2::int)) where id = $1",
      [iniMq.body.id, meuMq],
    );
    await rpc(P[0].token, "dominio_propor_tregua", { p_match: iniMq.body.id, p_com: botMq });
    const passoMq = (
      await db.query("select public.dominio_bot_passo($1::uuid) p", [iniMq.body.id])
    ).rows[0].p;
    ok(
      /^tregua:(aceita|recusa)/.test(passoMq ?? ""),
      `a máquina responde a trégua FORA da vez dela: ${passoMq ?? "não respondeu"}`,
    );
    const stMq = (
      await db.query("select public_state ps from matches where id = $1", [iniMq.body.id])
    ).rows[0].ps;
    ok(
      Object.keys(stMq.tregProp ?? {}).length === 0,
      "e a proposta sai da mesa respondida — pendurada é pior que recusada",
    );

    /* E ELA NUNCA ROMPE. Não porque seja proibido: porque máquina que trai não é
       mais difícil, é só imprevisível — e imprevisível sem intenção é ruído. */
    if (/aceita/.test(passoMq ?? "")) {
      /* `reforcoLeft` vai a zero junto com a fase. Forçar "ataque" deixando
         reforço pendente faz `dominio_encerrar_turno_como` estourar
         PLACE_REINFORCEMENTS — e com razão: exército parado não passa a vez. O
         estado montado à mão tem de ser um estado que o jogo produziria. */
      await db.query(
        `update matches set public_state = jsonb_set(jsonb_set(jsonb_set(public_state,
           '{turnSeat}', to_jsonb($2::int)), '{phase}', '"ataque"'),
           '{reforcoLeft}', to_jsonb(0)) where id = $1`,
        [iniMq.body.id, botMq],
      );
      const antesDonos = (
        await db.query("select public_state -> 'donos' d from matches where id = $1", [
          iniMq.body.id,
        ])
      ).rows[0].d;
      for (let i = 0; i < 12; i++) {
        const p = (
          await db.query("select public.dominio_bot_passo($1::uuid) p", [iniMq.body.id])
        ).rows[0].p;
        if (!p || p.startsWith("passa")) break;
      }
      const depoisDonos = (
        await db.query("select public_state -> 'donos' d from matches where id = $1", [
          iniMq.body.id,
        ])
      ).rows[0].d;
      const tomouDeMim = Object.keys(antesDonos).filter(
        (t) => Number(antesDonos[t]) === meuMq && Number(depoisDonos[t]) === botMq,
      );
      ok(
        tomouDeMim.length === 0,
        tomouDeMim.length === 0
          ? "e com trégua em vigor ela NÃO atacou — a traição é uma jogada de gente"
          : `ela rompeu a trégua e tomou ${tomouDeMim.join(", ")}`,
      );
      ok(
        !((
          await db.query("select public_state -> 'traidores' t from matches where id = $1", [
            iniMq.body.id,
          ])
        ).rows[0].t ?? []).includes(botMq),
        "e não carrega a marca de traidor",
      );
    }
  }

  /* ── E AGORA A PARTE QUE IMPORTA: romper. ──────────────────────────────
     Um território de P[0] com exército de sobra, colado num de P[1]. */
  const mapaTr = (
    await db.query(
      `select gt.data d from game_themes gt join matches m on gt.id = (m.public_state ->> 'map')
        where m.id = $1`,
      [idTr],
    )
  ).rows[0].d;
  const parTr = (
    await db.query(
      `select d.key de, v viz
         from matches m
         cross join jsonb_each_text(m.public_state -> 'donos') d
         cross join lateral unnest(public.dominio_vizinhos($2::jsonb, d.key)) v
        where m.id = $1 limit 1`,
      [idTr, JSON.stringify(mapaTr)],
    )
  ).rows[0];

  await db.query(
    `update matches set public_state =
       jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(public_state,
         array['donos', $2::text], to_jsonb($4::int)),
         array['donos', $3::text], to_jsonb($5::int)),
         array['exercitos', $2::text], to_jsonb(9)),
         array['exercitos', $3::text], to_jsonb(1)),
         '{phase}', '"ataque"')
     where id = $1`,
    [idTr, parTr.de, parTr.viz, seatDe(P[0]), seatDe(P[1])],
  );

  const rompeu = await rpc(P[0].token, "dominio_atacar", {
    p_match: idTr,
    p_de: parTr.de,
    p_para: parTr.viz,
    p_vezes: 1,
  });
  ok(
    rompeu.status === 200,
    `O SERVIDOR DEIXA ROMPER: o ataque passou${rompeu.status !== 200 ? " " + JSON.stringify(rompeu.body).slice(0, 130) : ""}` +
      " — trégua que o servidor impusesse não seria diplomacia, seria regra de movimento",
  );

  if (rompeu.status === 200) {
    const depoisTr = (
      await db.query("select public_state ps from matches where id = $1", [idTr])
    ).rows[0].ps;
    ok(
      (depoisTr.traidores ?? []).includes(seatDe(P[0])),
      `e a marca de TRAIDOR fica (${JSON.stringify(depoisTr.traidores)}) — visível a todos, pelo resto da partida`,
    );
    ok(
      Number(depoisTr.multaReforco?.[String(seatDe(P[0]))] ?? 0) === 2,
      `a multa de 2 exércitos está marcada para o próximo reforço dele (${JSON.stringify(depoisTr.multaReforco)})`,
    );
    ok(
      !(depoisTr.treguas ?? {})[
        `${Math.min(seatDe(P[0]), seatDe(P[1]))}:${Math.max(seatDe(P[0]), seatDe(P[1]))}`
      ],
      "e a trégua morreu no ato",
    );
    const linha = (depoisTr.log ?? []).find((l) => l.k === "tregua-rompe");
    ok(
      !!linha && linha.ter === parTr.viz,
      `o registro conta o que aconteceu, com nome e território (${linha?.ter})`,
    );

    /* A MULTA É COBRADA quando o reforço dele é calculado — um turno depois. */
    const semMulta = Number(
      (
        await db.query(
          `select public.dominio_reforco(gt.data, m.public_state, $2::smallint) n
             from matches m join game_themes gt on gt.id = (m.public_state ->> 'map')
            where m.id = $1`,
          [idTr, seatDe(P[0])],
        )
      ).rows[0].n,
    );
    const comMulta = (
      await db.query(
        `select public.dominio_aplica_reforco(m.public_state, gt.data, $2::smallint) e
           from matches m join game_themes gt on gt.id = (m.public_state ->> 'map')
          where m.id = $1`,
        [idTr, seatDe(P[0])],
      )
    ).rows[0].e;
    ok(
      Number(comMulta.reforcoLeft) === Math.max(semMulta - 2, 0),
      `e o reforço dele cai de ${semMulta} para ${comMulta.reforcoLeft} — dois exércitos é o preço`,
    );
    ok(
      comMulta.multaReforco?.[String(seatDe(P[0]))] === undefined,
      "a multa é consumida ao ser paga: cobra-se uma vez, não a partida inteira",
    );
    ok(
      (comMulta.traidores ?? []).includes(seatDe(P[0])),
      "mas a marca de traidor FICA — o preço se paga, a reputação não",
    );
  }
}

for (const p of P) await admin(`/admin/users/${p.id}`, { method: "DELETE" });
await db.end();

console.log(falhas === 0 ? "\nTudo passou." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
