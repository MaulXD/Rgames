#!/usr/bin/env node
/**
 * Gera o pool de grades aprovadas do Letreiro.
 *
 *   npm run boards            → 4×4 e 5×5, 1200 de cada
 *   npm run boards -- 800 5   → só 5×5, 800 grades
 *
 * Duas coisas que uma grade sorteada às cegas não garante, e que o solver
 * confere aqui:
 *
 *   1. que ela PRODUZ palavra (docs/02-PRD-LETREIRO.md §4.5);
 *   2. que produz palavra que GENTE CONHECE. Este é o critério novo: uma grade
 *      com 300 palavras das quais 290 são "aalênio" e "ababaia" é uma grade
 *      ruim, e era exatamente o que estava saindo na tela de revelação.
 *
 * O gabarito guarda tudo (aceitar é generoso) e marca à parte quais palavras
 * são comuns (mostrar é seletivo).
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(root, ".env.local"), quiet: true });

const QUANTAS = Number(process.argv[2] ?? 1200);
const SO_TAMANHO = process.argv[3] ? Number(process.argv[3]) : null;

/* QUEM DECIDE O QUE É COMUM É `build-dict.mjs`, e este arquivo só LÊ.
   Antes o corte morava aqui — e consumidor que decide é regra que se repete no
   próximo consumidor. Quem tem o corpus, o tamanho da palavra e a lista curada
   na mão é o build-dict; a coluna `dict_pt.comum` é o resultado. */

/** Base 36: um dígito por célula, até 36 células (cabe 4×4, 5×5 e 6×6). */
const B36 = "0123456789abcdefghijklmnopqrstuvwxyz";

/**
 * Os 16 dados do 4×4, conferidos face a face — docs/02-PRD-LETREIRO.md §4.2.
 * Onze têm 3 vogais + 3 consoantes; cinco têm 2 + 4. As letras difíceis estão
 * em dados diferentes, então nunca aparecem todas juntas.
 */
const DADOS_4 = [
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

/** Frequência do português brasileiro, em faces por 96. §4.1 */
const FREQ = {
  A: 13, E: 11, O: 9, S: 7, R: 6, I: 6, N: 5, D: 5, U: 4, T: 4, M: 4, C: 4,
  L: 3, P: 3, V: 2, G: 2, B: 2, H: 1, F: 1, QU: 1, Z: 1, J: 1, X: 1,
};
const VOGAIS = new Set(["A", "E", "I", "O", "U"]);

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function embaralha(arr, rnd) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Monta n dados de 6 faces mantendo a proporção do português e garantindo
 * 2 ou 3 vogais por dado — sem isso saem dados só de consoante, e um dado só
 * de consoante trava a grade inteira.
 */
function montaDados(n, rnd) {
  const faces = n * 6;
  const pool = [];
  for (const [letra, por96] of Object.entries(FREQ)) {
    const quantas = Math.max(letra === "QU" ? 1 : 1, Math.round((por96 / 96) * faces));
    for (let i = 0; i < quantas; i++) pool.push(letra);
  }
  while (pool.length < faces) pool.push("A");
  while (pool.length > faces) {
    // corta pela letra mais abundante, para não sumir com as raras
    const conta = {};
    for (const l of pool) conta[l] = (conta[l] ?? 0) + 1;
    const maior = Object.entries(conta).sort((a, b) => b[1] - a[1])[0][0];
    pool.splice(pool.indexOf(maior), 1);
  }

  const vogais = embaralha(pool.filter((l) => VOGAIS.has(l)), rnd);
  const consoantes = embaralha(pool.filter((l) => !VOGAIS.has(l)), rnd);

  // quantos dados levam 3 vogais para a conta fechar
  const comTres = vogais.length - 2 * n;
  const dados = [];
  for (let i = 0; i < n; i++) {
    const nv = i < comTres ? 3 : 2;
    const d = [];
    for (let k = 0; k < nv; k++) d.push(vogais.pop() ?? "A");
    for (let k = 0; k < 6 - nv; k++) d.push(consoantes.pop() ?? "S");
    dados.push(d);
  }
  return dados;
}

function pontosDe(palavra) {
  const VALOR = {
    A: 1, E: 1, I: 1, O: 1, U: 1, S: 1, M: 1, R: 1, T: 1,
    D: 2, L: 2, C: 2, P: 2, N: 3, B: 3,
    F: 4, G: 4, H: 4, V: 4, J: 5, Q: 5, X: 6, Z: 6,
  };
  let soma = 0;
  for (const ch of palavra) soma += VALOR[ch] ?? 1;
  const n = palavra.length;
  return soma + (n <= 3 ? 0 : n === 4 ? 1 : n === 5 ? 3 : n === 6 ? 5 : n === 7 ? 8 : 14);
}

function vizinhosDe(size) {
  const v = [];
  for (let i = 0; i < size * size; i++) {
    const r = Math.floor(i / size);
    const c = i % size;
    const lista = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
        lista.push(nr * size + nc);
      }
    }
    v.push(lista);
  }
  return v;
}

// ── dicionário → trie, com a marca de comum ────────────────────────────────
const conn = new URL(process.env.POSTGRES_URL_NON_POOLING);
conn.searchParams.set("uselibpqcompat", "true");
const client = new pg.Client({ connectionString: conn.toString() });
await client.connect();

process.stdout.write("  lendo dict_pt… ");
const { rows: palavras } = await client.query(
  "select norm, comum from public.dict_pt",
);
const comum = new Set();
const raiz = {};
for (const { norm, comum: ehComum } of palavras) {
  let no = raiz;
  for (const ch of norm) no = no[ch] ??= {};
  no.$ = 1;
  if (ehComum) comum.add(norm);
}
console.log(
  `${palavras.length.toLocaleString("pt-BR")} palavras, ${comum.size.toLocaleString("pt-BR")} comuns`,
);

function resolver(grid, size, vizinhos) {
  const achadas = new Map();
  const usada = new Array(size * size).fill(false);

  function desce(celula, no, palavra, caminho) {
    let atual = no;
    for (const ch of grid[celula]) {
      atual = atual[ch];
      if (!atual) return;
    }
    const nova = palavra + grid[celula];
    const novoCaminho = caminho + B36[celula];

    if (atual.$ && nova.length >= 3 && !achadas.has(nova)) {
      achadas.set(nova, novoCaminho);
    }

    usada[celula] = true;
    for (const v of vizinhos[celula]) if (!usada[v]) desce(v, atual, nova, novoCaminho);
    usada[celula] = false;
  }

  for (let i = 0; i < size * size; i++) desce(i, raiz, "", "");
  return achadas;
}

/** Critérios por tamanho. Os de "comum" são o conserto desta rodada. */
const REGRAS = {
  4: { total: [60, 400], comuns: 22, comunsLongas: 3, vogais: [5, 9] },
  5: { total: [180, 1400], comuns: 60, comunsLongas: 8, vogais: [8, 14] },
};

function avaliar(grid, size, achadas) {
  const r = REGRAS[size];
  const total = achadas.size;
  if (total < r.total[0] || total > r.total[1]) return null;

  const vogais = grid.filter((f) => f.length === 1 && VOGAIS.has(f)).length;
  if (vogais < r.vogais[0] || vogais > r.vogais[1]) return null;

  let maxScore = 0;
  let maxComum = 0;
  let nComuns = 0;
  let comunsLongas = 0;
  const comuns = [];
  const participam = new Set();

  for (const [palavra, caminho] of achadas) {
    const p = pontosDe(palavra);
    maxScore += p;
    if (comum.has(palavra)) {
      nComuns++;
      maxComum += p;
      comuns.push(palavra);
      if (palavra.length >= 6) comunsLongas++;
      for (const d of caminho) participam.add(d);
    }
  }

  if (nComuns < r.comuns) return null;
  if (comunsLongas < r.comunsLongas) return null;
  // pelo menos 40% das células precisam entrar numa palavra comum longa
  if (participam.size < Math.ceil(size * size * 0.4)) return null;

  const dif = nComuns < r.comuns * 1.5 ? 1 : nComuns < r.comuns * 2.5 ? 2 : nComuns < r.comuns * 4 ? 3 : 4;
  return { total, maxScore, maxComum, comuns, difficulty: dif };
}

// ── geração ────────────────────────────────────────────────────────────────
await client.query(`
  delete from public.letreiro_boards b
   where not exists (select 1 from public.matches m where m.board_id = b.id)
`);

const tamanhos = SO_TAMANHO ? [SO_TAMANHO] : [4, 5];

for (const size of tamanhos) {
  const vizinhos = vizinhosDe(size);
  const rnd = mulberry32(20260826 + size);
  const dados = size === 4 ? DADOS_4 : montaDados(size * size, rnd);

  if (size !== 4) {
    console.log(`\n  dados do ${size}×${size} (${dados.length}):`);
    for (let i = 0; i < dados.length; i += 5) {
      console.log("    " + dados.slice(i, i + 5).map((d) => d.join("")).join("  "));
    }
  }

  const aceitas = [];
  let tentativas = 0;
  const t0 = Date.now();
  const teto = QUANTAS * 400;

  while (aceitas.length < QUANTAS && tentativas < teto) {
    tentativas++;
    const ordem = embaralha([...dados.keys()], rnd);
    const grid = ordem.map((d) => dados[d][Math.floor(rnd() * 6)]);
    const achadas = resolver(grid, size, vizinhos);
    const nota = avaliar(grid, size, achadas);
    if (!nota) continue;

    aceitas.push({
      size,
      grid,
      difficulty: nota.difficulty,
      word_count: nota.total,
      max_score: nota.maxScore,
      max_score_comum: nota.maxComum,
      comuns: nota.comuns,
      solution: Object.fromEntries(achadas),
    });

    if (aceitas.length % 100 === 0) {
      const s = ((Date.now() - t0) / 1000).toFixed(0);
      process.stdout.write(
        `\r  ${size}×${size}: ${aceitas.length}/${QUANTAS} · ${tentativas} tentativas · ${s}s`,
      );
    }
  }
  process.stdout.write("\n");
  console.log(
    `  ${size}×${size}: ${aceitas.length} de ${tentativas} tentativas (${((aceitas.length / tentativas) * 100).toFixed(1)}%)`,
  );

  const LOTE = 60;
  for (let i = 0; i < aceitas.length; i += LOTE) {
    const fatia = aceitas.slice(i, i + LOTE);
    await client.query(
      `insert into public.letreiro_boards
         (size, grid, difficulty, word_count, max_score, max_score_comum, comuns, solution)
       select t.size,
              array(select jsonb_array_elements_text(t.grid)),
              t.difficulty, t.word_count, t.max_score, t.max_score_comum,
              array(select jsonb_array_elements_text(t.comuns)),
              t.solution
         from jsonb_to_recordset($1::jsonb)
           as t(size int, grid jsonb, difficulty int, word_count int,
                max_score int, max_score_comum int, comuns jsonb, solution jsonb)`,
      [JSON.stringify(fatia)],
    );
    process.stdout.write(`\r  gravadas ${Math.min(i + LOTE, aceitas.length)}/${aceitas.length}`);
  }
  process.stdout.write("\n");
}

const { rows: stat } = await client.query(`
  select size, count(*)::int n,
         min(word_count) w0, max(word_count) w1,
         round(avg(array_length(comuns, 1))) comuns,
         min(max_score_comum) s0, max(max_score_comum) s1,
         pg_size_pretty(pg_total_relation_size('public.letreiro_boards')) tam
    from public.letreiro_boards group by size order by size
`);
for (const s of stat) {
  console.log(
    `  pool ${s.size}×${s.size}: ${s.n} grades · ${s.w0}–${s.w1} palavras · ` +
      `${s.comuns} comuns em média · máx comum ${s.s0}–${s.s1} · tabela ${s.tam}`,
  );
}

// amostra: uma grade de cada tamanho, com as comuns mais valiosas
for (const size of tamanhos) {
  const { rows } = await client.query(
    `select grid, comuns from public.letreiro_boards where size = $1 order by random() limit 1`,
    [size],
  );
  if (!rows.length) continue;
  const g = rows[0].grid;
  console.log(`\n  exemplo ${size}×${size}:`);
  for (let r = 0; r < size; r++) {
    console.log("    " + g.slice(r * size, (r + 1) * size).map((f) => f.padEnd(2)).join(" "));
  }
  const melhores = rows[0].comuns
    .slice()
    .sort((a, b) => pontosDe(b) - pontosDe(a))
    .slice(0, 8);
  console.log("    comuns mais valiosas: " + melhores.join(", "));
}

await client.end();
