#!/usr/bin/env node
/**
 * Valida os mapas do Domínio e os publica em game_themes.
 *
 *   npm run mapa
 *
 * A validação vem ANTES da carga, e é dura de propósito: um grafo com uma
 * aresta só num sentido produz o pior tipo de bug — o que aparece meses depois,
 * quando alguém tenta atacar naquela direção específica.
 *
 * SÃO DOIS MAPAS. Vantara, com 42 territórios, e o Relâmpago, com 24 — um
 * recorte dela, gerado por `scripts/gera-mapa-relampago.mjs`. O validador é o
 * MESMO para os dois, e é o que faz o Relâmpago ser um arquivo de dados em vez
 * de um segundo jogo: se o recorte deixasse a Nauria desligada ou a Sarnath
 * partida em duas, ele reprova aqui e nada é publicado.
 *
 * As checagens que dependem do tamanho — quantos territórios, quantos
 * continentes — vêm do próprio pacote, e não de um número escrito no validador.
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(root, ".env.local"), quiet: true });

const le = (arq) => JSON.parse(readFileSync(join(root, "lib", "dominio", arq), "utf8"));

const MAPAS = [
  {
    id: "vantara",
    nome: "Vantara",
    era: "1936",
    tagline: "Quarenta e dois territórios e um objetivo no seu bolso.",
    territorios: 42,
    continentes: 6,
    dados: le("vantara.json"),
  },
  {
    id: "relampago",
    nome: "Vantara — Relâmpago",
    era: "1936",
    tagline: "O sul de Vantara, vinte e quatro territórios, uma hora de mesa.",
    territorios: 24,
    continentes: 4,
    dados: le("relampago.json"),
  },
];

let falhas = 0;
const ok = (c, m) => {
  if (!c) falhas++;
  console.log(`${c ? "  ok    " : "  FALHA "} ${m}`);
};

function valida(mapa) {
  const { continentes: CONTINENTES, territorios: TERRITORIOS, objetivos: OBJETIVOS, portos: PORTOS } =
    mapa.dados;
  const porId = new Map(TERRITORIOS.map((t) => [t.id, t]));

  console.log(`\n── ${mapa.nome} ──\n`);

  // ── estrutura ────────────────────────────────────────────────────────────
  ok(
    TERRITORIOS.length === mapa.territorios,
    `${mapa.territorios} territórios (${TERRITORIOS.length})`,
  );
  ok(porId.size === TERRITORIOS.length, "nenhum id repetido");
  ok(
    CONTINENTES.length === mapa.continentes,
    `${mapa.continentes} continentes (${CONTINENTES.length})`,
  );

  for (const c of CONTINENTES) {
    const n = TERRITORIOS.filter((t) => t.continente === c.id).length;
    ok(n > 0, `${c.nome}: ${n} territórios, bônus +${c.bonus}`);
  }
  const semContinente = TERRITORIOS.filter(
    (t) => !CONTINENTES.some((c) => c.id === t.continente),
  );
  ok(semContinente.length === 0, "todo território tem continente válido");

  // ── simetria e alvos ─────────────────────────────────────────────────────
  const assimetricos = [];
  const orfaos = [];
  for (const t of TERRITORIOS) {
    for (const v of t.vizinhos) {
      if (!porId.has(v)) orfaos.push(`${t.id} → ${v}`);
      else if (!porId.get(v).vizinhos.includes(t.id)) assimetricos.push(`${t.id} ↔ ${v}`);
    }
  }
  ok(
    orfaos.length === 0,
    `nenhuma fronteira aponta para território inexistente${orfaos.length ? ` (${orfaos.join(", ")})` : ""}`,
  );
  ok(
    assimetricos.length === 0,
    `o grafo é simétrico${assimetricos.length ? ` (${assimetricos.join(", ")})` : ""}`,
  );

  // ── conectividade ────────────────────────────────────────────────────────
  const raiz = TERRITORIOS[0].id;
  const visto = new Set([raiz]);
  const fila = [raiz];
  while (fila.length) {
    const atual = fila.pop();
    for (const v of porId.get(atual).vizinhos) {
      if (!visto.has(v)) {
        visto.add(v);
        fila.push(v);
      }
    }
  }
  ok(
    visto.size === TERRITORIOS.length,
    `o mapa é conexo (alcançou ${visto.size} de ${TERRITORIOS.length})`,
  );

  const semVizinho = TERRITORIOS.filter((t) => t.vizinhos.length === 0);
  ok(semVizinho.length === 0, "nenhum território isolado");

  const grau = TERRITORIOS.reduce((s, t) => s + t.vizinhos.length, 0) / TERRITORIOS.length;
  ok(grau >= 3 && grau <= 5, `grau médio ${grau.toFixed(2)} (entre 3 e 5)`);

  // ── cada continente precisa ser contíguo por dentro ──────────────────────
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

  // ── fronteiras externas: quantas portas cada continente tem ──────────────
  for (const c of CONTINENTES) {
    const portas = new Set();
    for (const t of TERRITORIOS.filter((x) => x.continente === c.id)) {
      for (const v of t.vizinhos) {
        if (porId.get(v).continente !== c.id) portas.add(t.id);
      }
    }
    console.log(`         ${c.nome}: ${portas.size} território(s) de fronteira`);
  }

  // ── objetivos ────────────────────────────────────────────────────────────
  ok(OBJETIVOS.length >= 6, `${OBJETIVOS.length} objetivos secretos`);
  ok(
    OBJETIVOS.every((o) => !/amarelo|vermelho|azul|verde|cor /i.test(o.texto)),
    "nenhum objetivo depende de um jogador por cor",
  );
  /* E NENHUM OBJETIVO FALA DE CONTINENTE QUE NÃO EXISTE NESTE MAPA.

     O recorte tirou Aurélia e Khadar, e os oito objetivos de Vantara falam das
     duas. Um objetivo impossível é a pior carta do baralho: a pessoa joga a
     partida inteira atrás de uma coisa que não pode acontecer, e nada na tela
     diz isso. */
  const ids = new Set(CONTINENTES.map((c) => c.id));
  const fantasmas = OBJETIVOS.flatMap((o) => (o.continentes ?? []).filter((c) => !ids.has(c)));
  ok(
    fantasmas.length === 0,
    fantasmas.length === 0
      ? "todo objetivo fala de continente que existe neste mapa"
      : `objetivo impossível: fala de ${[...new Set(fantasmas)].join(", ")}`,
  );
  /* E nenhum alvo de contagem passa do tamanho do mapa, pelo mesmo motivo. */
  const grandes = OBJETIVOS.filter((o) => (o.alvo ?? 0) > TERRITORIOS.length);
  ok(grandes.length === 0, "nenhum objetivo pede mais territórios do que o mapa tem");

  ok(
    PORTOS.every((p) => porId.has(p)),
    `os ${PORTOS.length} portos existem no mapa`,
  );
  ok(PORTOS.length >= 4, `e são ${PORTOS.length} — menos de quatro faz do objetivo um presente`);
}

console.log("\nDomínio — os mapas\n");
for (const m of MAPAS) valida(m);

if (falhas > 0) {
  console.log(`\n${falhas} falha(s) — nada foi publicado.`);
  process.exit(1);
}

// ── carga ──────────────────────────────────────────────────────────────────
const conn = new URL(process.env.POSTGRES_URL_NON_POOLING);
conn.searchParams.set("uselibpqcompat", "true");
const client = new pg.Client({ connectionString: conn.toString() });
await client.connect();

for (const m of MAPAS) {
  const paraOBanco = {
    ...m.dados,
    adjacencia: Object.fromEntries(m.dados.territorios.map((t) => [t.id, t.vizinhos])),
  };
  await client.query(
    `insert into public.game_themes (id, game_key, name, era, tagline, data)
     values ($1, 'dominio', $2, $3, $4, $5::jsonb)
     on conflict (id) do update set data = excluded.data, name = excluded.name,
       era = excluded.era, tagline = excluded.tagline`,
    [m.id, m.nome, m.era, m.tagline, JSON.stringify(paraOBanco)],
  );
}

const { rows } = await client.query(
  `select id, jsonb_array_length(data -> 'territorios') n
     from public.game_themes where game_key = 'dominio' order by id`,
);
console.log(`\n${rows.map((r) => `${r.id}: ${r.n} territórios`).join(" · ")}`);
await client.end();
