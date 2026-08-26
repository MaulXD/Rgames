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
const db = new pg.Client({ connectionString: conn.toString() });
await db.connect();

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

for (const p of P) await admin(`/admin/users/${p.id}`, { method: "DELETE" });
await db.end();

console.log(falhas === 0 ? "\nTudo passou." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
