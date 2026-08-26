#!/usr/bin/env node
/**
 * Gera o pool de grades aprovadas do Letreiro.
 *
 *   npm run boards -- [quantidade]
 *
 * Grade sorteada às cegas pode ser terrível. Cada candidata passa por um
 * solver e só entra no pool se for jogável (docs/02-PRD-LETREIRO.md §4.5).
 * Assim o início da partida não roda solver nenhum: sorteia uma linha e vai.
 *
 * O gabarito guardado é compacto de propósito — `{ "CASA": "0123" }`, o
 * caminho em dígitos hexadecimais de índice de célula. A pontuação sai do
 * tamanho da chave e a grafia com acento sai de dict_pt na hora da revelação.
 * Um gabarito verboso custaria ~40 KB por grade; este custa ~5 KB.
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(root, ".env.local"), quiet: true });

const QUANTAS = Number(process.argv[2] ?? 1500);

/** Os 16 dados, conferidos face a face — docs/02-PRD-LETREIRO.md §4.2 */
const DADOS = [
  ["A", "E", "O", "S", "R", "QU"],
  ["A", "E", "I", "N", "T", "D"],
  ["A", "E", "O", "M", "C", "R"],
  ["A", "O", "U", "S", "L", "P"],
  ["A", "E", "I", "R", "D", "V"],
  ["A", "E", "O", "N", "S", "T"],
  ["A", "E", "U", "C", "M", "B"],
  ["A", "I", "O", "S", "R", "N"],
  ["A", "E", "O", "D", "T", "L"],
  ["A", "E", "I", "P", "G", "Z"],
  ["A", "E", "O", "M", "N", "S"],
  ["E", "U", "R", "C", "D", "H"],
  ["O", "I", "S", "T", "P", "F"],
  ["A", "O", "L", "V", "G", "J"],
  ["E", "I", "N", "D", "M", "X"],
  ["A", "U", "S", "R", "C", "B"],
];

const VOGAIS = new Set(["A", "E", "I", "O", "U"]);
const HEX = "0123456789abcdef";

/** PRNG determinístico — mesma semente, mesma grade. */
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Valor por letra (Scrabble brasileiro) + bonus de comprimento.
 *  Tem de bater com public.letreiro_pontos_palavra e com lib/letreiro.ts. */
const VALOR = {
  A: 1, E: 1, I: 1, O: 1, U: 1, S: 1, M: 1, R: 1, T: 1,
  D: 2, L: 2, C: 2, P: 2,
  N: 3, B: 3,
  F: 4, G: 4, H: 4, V: 4,
  J: 5, Q: 5,
  X: 6, Z: 6,
};

function pontos(palavra) {
  let soma = 0;
  for (const ch of palavra) soma += VALOR[ch] ?? 1;
  const n = palavra.length;
  const b = n <= 3 ? 0 : n === 4 ? 1 : n === 5 ? 3 : n === 6 ? 5 : n === 7 ? 8 : 14;
  return soma + b;
}

/** Vizinhos nas 8 direções, numa grade 4×4. */
const VIZINHOS = (() => {
  const v = [];
  for (let i = 0; i < 16; i++) {
    const r = Math.floor(i / 4);
    const c = i % 4;
    const lista = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr > 3 || nc < 0 || nc > 3) continue;
        lista.push(nr * 4 + nc);
      }
    }
    v.push(lista);
  }
  return v;
})();

// ── dicionário → trie ──────────────────────────────────────────────────────
const conn = new URL(process.env.POSTGRES_URL_NON_POOLING);
conn.searchParams.set("uselibpqcompat", "true");
const client = new pg.Client({ connectionString: conn.toString() });
await client.connect();

process.stdout.write("  lendo dict_pt… ");
const { rows: palavras } = await client.query("select norm from public.dict_pt");
console.log(`${palavras.length.toLocaleString("pt-BR")} palavras`);

process.stdout.write("  montando o trie… ");
const raiz = {};
for (const { norm } of palavras) {
  let no = raiz;
  for (const ch of norm) no = no[ch] ??= {};
  no.$ = 1;
}
console.log("pronto");

// ── solver ─────────────────────────────────────────────────────────────────

function resolver(grid) {
  /** @type {Map<string,string>} palavra -> caminho */
  const achadas = new Map();
  const usada = new Array(16).fill(false);

  function desce(celula, no, palavra, caminho) {
    // consome as letras desta célula (uma face pode ser "QU")
    let atual = no;
    for (const ch of grid[celula]) {
      atual = atual[ch];
      if (!atual) return;
    }
    const nova = palavra + grid[celula];
    const novoCaminho = caminho + HEX[celula];

    if (atual.$ && nova.length >= 3 && !achadas.has(nova)) {
      achadas.set(nova, novoCaminho);
    }

    usada[celula] = true;
    for (const v of VIZINHOS[celula]) {
      if (!usada[v]) desce(v, atual, nova, novoCaminho);
    }
    usada[celula] = false;
  }

  for (let i = 0; i < 16; i++) desce(i, raiz, "", "");
  return achadas;
}

/** Critérios de grade jogável — §4.5 */
function avaliar(grid, achadas) {
  const total = achadas.size;
  if (total < 60 || total > 400) return null;

  const vogais = grid.filter((f) => f.length === 1 && VOGAIS.has(f)).length;
  if (vogais < 5 || vogais > 9) return null;

  let sete = 0;
  let oito = 0;
  const participam = new Set();
  let maxScore = 0;

  for (const [palavra, caminho] of achadas) {
    const n = palavra.length;
    maxScore += pontos(palavra);
    if (n >= 7) sete++;
    if (n >= 8) oito++;
    if (n >= 6) for (const d of caminho) participam.add(d);
  }

  if (sete < 3 || oito < 1) return null;
  if (participam.size < 7) return null; // ≥ 40% das 16 células

  const difficulty = total < 100 ? 1 : total < 160 ? 2 : total < 240 ? 3 : total < 320 ? 4 : 5;
  return { total, maxScore, difficulty };
}

function sortear(rnd) {
  const ordem = [...Array(16).keys()];
  for (let i = 15; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [ordem[i], ordem[j]] = [ordem[j], ordem[i]];
  }
  return ordem.map((d) => DADOS[d][Math.floor(rnd() * 6)]);
}

// ── geração ────────────────────────────────────────────────────────────────
// Nao usar TRUNCATE: matches referencia letreiro_boards, e uma grade em uso
// por partida em andamento nao pode desaparecer debaixo dela.
await client.query(`
  delete from public.letreiro_boards b
   where not exists (select 1 from public.matches m where m.board_id = b.id)
`);

const rnd = mulberry32(20260826);
const aceitas = [];
let tentativas = 0;
const t0 = Date.now();

while (aceitas.length < QUANTAS && tentativas < QUANTAS * 60) {
  tentativas++;
  const grid = sortear(rnd);
  const achadas = resolver(grid);
  const nota = avaliar(grid, achadas);
  if (!nota) continue;

  aceitas.push({
    grid,
    difficulty: nota.difficulty,
    word_count: nota.total,
    max_score: nota.maxScore,
    solution: Object.fromEntries(achadas),
  });

  if (aceitas.length % 100 === 0) {
    const s = ((Date.now() - t0) / 1000).toFixed(0);
    process.stdout.write(`\r  ${aceitas.length}/${QUANTAS} grades · ${tentativas} tentativas · ${s}s`);
  }
}
process.stdout.write("\n");

console.log(
  `  aproveitamento: ${aceitas.length} de ${tentativas} tentativas (${((aceitas.length / tentativas) * 100).toFixed(1)}%)`,
);

// ── carga ──────────────────────────────────────────────────────────────────
const LOTE = 100;
for (let i = 0; i < aceitas.length; i += LOTE) {
  const fatia = aceitas.slice(i, i + LOTE);
  // jsonb_to_recordset, não unnest: unnest de array 2D achata tudo em
  // escalares, e cada grade precisa chegar inteira, como array de 16 faces.
  await client.query(
    `insert into public.letreiro_boards (size, grid, difficulty, word_count, max_score, solution)
     select 4,
            array(select jsonb_array_elements_text(t.grid)),
            t.difficulty, t.word_count, t.max_score, t.solution
       from jsonb_to_recordset($1::jsonb)
         as t(grid jsonb, difficulty int, word_count int, max_score int, solution jsonb)`,
    [JSON.stringify(fatia)],
  );
  process.stdout.write(`\r  gravadas ${Math.min(i + LOTE, aceitas.length)}/${aceitas.length}`);
}
process.stdout.write("\n");

const { rows: stat } = await client.query(`
  select count(*)::int n,
         min(word_count) min_w, max(word_count) max_w,
         round(avg(word_count)) avg_w,
         min(max_score) min_s, max(max_score) max_s,
         pg_size_pretty(pg_total_relation_size('public.letreiro_boards')) tam
    from public.letreiro_boards
`);
const s = stat[0];
console.log(
  `  pool: ${s.n} grades · palavras ${s.min_w}–${s.max_w} (média ${s.avg_w}) · pontuação máxima ${s.min_s}–${s.max_s} · ${s.tam}`,
);

// amostra, para conferir no olho
const { rows: amostra } = await client.query(
  "select grid, word_count, max_score from public.letreiro_boards order by random() limit 3",
);
for (const b of amostra) {
  const g = b.grid;
  console.log(
    `\n  ${g.slice(0, 4).join(" ")}   ${b.word_count} palavras, máx ${b.max_score} pts` +
      `\n  ${g.slice(4, 8).join(" ")}` +
      `\n  ${g.slice(8, 12).join(" ")}` +
      `\n  ${g.slice(12, 16).join(" ")}`,
  );
}

await client.end();
