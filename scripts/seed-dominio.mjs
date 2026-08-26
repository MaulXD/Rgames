#!/usr/bin/env node
/**
 * Valida o mapa de Vantara e o publica em game_themes.
 *
 *   npm run mapa
 *
 * A validação vem ANTES da carga, e é dura de propósito: um grafo com uma
 * aresta só num sentido produz o pior tipo de bug — o que aparece meses depois,
 * quando alguém tenta atacar naquela direção específica.
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(root, ".env.local"), quiet: true });

/* Os dados vivem em vantara.json — lidos aqui e importados com tipo pelo
   cliente. Uma fonte, dois consumidores, zero parsing de TypeScript. */
const dados = JSON.parse(
  readFileSync(join(root, "lib", "dominio", "vantara.json"), "utf8"),
);
const {
  continentes: CONTINENTES,
  territorios: TERRITORIOS,
  objetivos: OBJETIVOS,
  portos: PORTOS,
} = dados;

let falhas = 0;
const ok = (c, m) => {
  if (!c) falhas++;
  console.log(`${c ? "  ok    " : "  FALHA "} ${m}`);
};

const porId = new Map(TERRITORIOS.map((t) => [t.id, t]));

// ── estrutura ──────────────────────────────────────────────────────────────
ok(TERRITORIOS.length === 42, `42 territórios (${TERRITORIOS.length})`);
ok(porId.size === TERRITORIOS.length, "nenhum id repetido");
ok(CONTINENTES.length === 6, `6 continentes (${CONTINENTES.length})`);

for (const c of CONTINENTES) {
  const n = TERRITORIOS.filter((t) => t.continente === c.id).length;
  ok(n > 0, `${c.nome}: ${n} territórios, bônus +${c.bonus}`);
}
const semContinente = TERRITORIOS.filter((t) => !CONTINENTES.some((c) => c.id === t.continente));
ok(semContinente.length === 0, "todo território tem continente válido");

// ── simetria e alvos ───────────────────────────────────────────────────────
const assimetricos = [];
const orfaos = [];
for (const t of TERRITORIOS) {
  for (const v of t.vizinhos) {
    if (!porId.has(v)) orfaos.push(`${t.id} → ${v}`);
    else if (!porId.get(v).vizinhos.includes(t.id)) assimetricos.push(`${t.id} ↔ ${v}`);
  }
}
ok(orfaos.length === 0, `nenhuma fronteira aponta para território inexistente${orfaos.length ? ` (${orfaos.join(", ")})` : ""}`);
ok(assimetricos.length === 0, `o grafo é simétrico${assimetricos.length ? ` (${assimetricos.join(", ")})` : ""}`);

// ── conectividade ──────────────────────────────────────────────────────────
const visto = new Set(["boreal"]);
const fila = ["boreal"];
while (fila.length) {
  const atual = fila.pop();
  for (const v of porId.get(atual).vizinhos) {
    if (!visto.has(v)) {
      visto.add(v);
      fila.push(v);
    }
  }
}
ok(visto.size === 42, `o mapa é conexo (alcançou ${visto.size} de 42)`);

const semVizinho = TERRITORIOS.filter((t) => t.vizinhos.length === 0);
ok(semVizinho.length === 0, "nenhum território isolado");

const grau = TERRITORIOS.reduce((s, t) => s + t.vizinhos.length, 0) / 42;
ok(grau >= 3 && grau <= 5, `grau médio ${grau.toFixed(2)} (entre 3 e 5)`);

// ── cada continente precisa ser contíguo por dentro ────────────────────────
for (const c of CONTINENTES) {
  const dentro = TERRITORIOS.filter((t) => t.continente === c.id).map((t) => t.id);
  const set = new Set(dentro);
  const vistos = new Set([dentro[0]]);
  const f = [dentro[0]];
  while (f.length) {
    const a = f.pop();
    for (const v of porId.get(a).vizinhos) {
      if (set.has(v) && !vistos.has(v)) {
        vistos.add(v);
        f.push(v);
      }
    }
  }
  ok(vistos.size === dentro.length, `${c.nome} é contíguo por dentro`);
}

// ── fronteiras externas: quantas portas cada continente tem ────────────────
for (const c of CONTINENTES) {
  const portas = new Set();
  for (const t of TERRITORIOS.filter((x) => x.continente === c.id)) {
    for (const v of t.vizinhos) {
      if (porId.get(v).continente !== c.id) portas.add(t.id);
    }
  }
  console.log(`         ${c.nome}: ${portas.size} território(s) de fronteira`);
}

// ── objetivos ──────────────────────────────────────────────────────────────
ok(OBJETIVOS.length >= 8, `${OBJETIVOS.length} objetivos secretos`);
ok(
  OBJETIVOS.every((o) => !/amarelo|vermelho|azul|verde|cor /i.test(o.texto)),
  "nenhum objetivo depende de um jogador por cor",
);
ok(
  PORTOS.every((p) => porId.has(p)),
  `os ${PORTOS.length} portos existem no mapa`,
);

if (falhas > 0) {
  console.log(`\n${falhas} falha(s) — nada foi publicado.`);
  process.exit(1);
}

// ── carga ──────────────────────────────────────────────────────────────────
const conn = new URL(process.env.POSTGRES_URL_NON_POOLING);
conn.searchParams.set("uselibpqcompat", "true");
const client = new pg.Client({ connectionString: conn.toString() });
await client.connect();

const paraOBanco = {
  ...dados,
  adjacencia: Object.fromEntries(TERRITORIOS.map((t) => [t.id, t.vizinhos])),
};

await client.query(
  `insert into public.game_themes (id, game_key, name, era, tagline, data)
   values ('vantara', 'dominio', 'Vantara', '1936',
           'Quarenta e dois territórios e um objetivo no seu bolso.', $1::jsonb)
   on conflict (id) do update set data = excluded.data, name = excluded.name,
     era = excluded.era, tagline = excluded.tagline`,
  [JSON.stringify(paraOBanco)],
);

const { rows } = await client.query(
  "select jsonb_array_length(data -> 'territorios') n from public.game_themes where id = 'vantara'",
);
console.log(`\nVantara publicado: ${rows[0].n} territórios em game_themes.`);
await client.end();
