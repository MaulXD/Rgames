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

for (const p of P) await admin(`/admin/users/${p.id}`, { method: "DELETE" });
await db.end();

console.log(falhas === 0 ? "\nTudo passou." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
