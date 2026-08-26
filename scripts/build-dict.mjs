#!/usr/bin/env node
/**
 * Monta o dicionário do Letreiro e carrega no Postgres.
 *
 *   npm run dict
 *
 * Fonte: lista de palavras do português brasileiro já expandida (320 mil
 * formas flexionadas), derivada dos dicionários BR.ispell/VERO — os mesmos
 * que o LibreOffice usa. Se a fonte sair do ar, o `.dic` do Hunspell fica
 * como reserva, mas aí precisa de expansão de afixos.
 *
 * Filtro (docs/02-PRD-LETREIRO.md §4.4):
 *   - 3 a 16 letras
 *   - só A–Z depois de normalizar (NFD, sem diacrítico, maiúscula)
 *   - fora K, W e Y: não existem nos dados do jogo, então nunca sairiam
 *   - fora nome próprio (maiúscula na origem) e abreviatura (com ponto)
 *
 * Colisão de normalização (sede / sedê): fica a grafia com MENOS acento —
 * ela é a que provavelmente existe por si só.
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(root, ".env.local"), quiet: true });

/**
 * Duas fontes, unidas.
 *
 * A lista do pythonprobr ja vem flexionada (320 mil formas) e e a base. O
 * `.dic` do Hunspell pt_BR (o que o LibreOffice usa) entra por cima: ele traz
 * lemas que a primeira nao tem. Cada linha do `.dic` vem como
 * `palavra/FLAGS` — as flags de afixo sao descartadas, entao dele aproveitamos
 * so a forma base. Ainda assim fecha buracos reais.
 */
const FONTES = [
  { url: "https://raw.githubusercontent.com/pythonprobr/palavras/master/palavras.txt", dic: false },
  { url: "https://raw.githubusercontent.com/LibreOffice/dictionaries/master/pt_BR/pt_BR.dic", dic: true },
];

/**
 * Lista curada: emprestimos e uso moderno que a fonte (derivada do VOLP) nao
 * tem. Medido, nao chutado — um teste com 117 palavras do dia a dia achou 115;
 * as que faltavam eram todas desta familia. Sem marca registrada.
 */
const EXTRAS = `
suco internet pizza lanche sorvete chiclete biscoito salgado refrigerante
mouse teclado email site notebook tablet online offline video foto selfie
bicicleta skate tenis shorts blusa jeans spray xampu sabonete escova toalha
sofa cadeira panela garfo faca colher caneca balde vassoura tesoura caderno
caneta lapis borracha regua mochila lousa recreio colega chefe salario boleto
cartao senha onibus metro taxi farol multa posto pneu radio televisao geladeira
fogao micro liquidificador tomada carregador fone teia nuvem arquivo pasta
janela botao clique rolagem aplicativo jogo partida placar rodada empate
treino torcedor camisa chuteira apito juiz falta penalti golaco
`.trim().split(/\s+/);

const norm = (s) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();

const diacriticos = (s) => s.normalize("NFD").replace(/[^̀-ͯ]/g, "").length;

async function baixar() {
  const linhas = [];
  let vivas = 0;
  for (const f of FONTES) {
    process.stdout.write(`  baixando ${f.url}\n`);
    let texto;
    try {
      const r = await fetch(f.url);
      if (!r.ok) {
        console.error(`  falhou (${r.status}), seguindo sem esta`);
        continue;
      }
      texto = await r.text();
    } catch (e) {
      console.error(`  falhou (${e.message}), seguindo sem esta`);
      continue;
    }
    vivas++;
    const cru = texto.split(/\r?\n/);
    // a primeira linha do .dic e a contagem de entradas
    const corpo = f.dic ? cru.slice(1) : cru;
    const limpas = f.dic ? corpo.map((l) => l.split("/")[0]) : corpo;
    console.log(`  ${limpas.length.toLocaleString("pt-BR")} linhas`);
    // push(...arr) com 320 mil itens estoura a pilha de chamadas
    for (const l of limpas) linhas.push(l);
  }
  if (!vivas) throw new Error("nenhuma fonte de dicionário respondeu");
  return linhas;
}

const linhas = await baixar();
console.log(`  ${linhas.length.toLocaleString("pt-BR")} linhas somadas`);

/** @type {Map<string, string>} norm -> grafia escolhida */
const dic = new Map();
let descartadas = 0;

for (const linha of linhas) {
  const palavra = linha.trim();
  if (!palavra) continue;

  // nome próprio e abreviatura fora
  if (palavra !== palavra.toLowerCase()) {
    descartadas++;
    continue;
  }
  if (palavra.includes(".") || palavra.includes("-") || palavra.includes("'")) {
    descartadas++;
    continue;
  }

  const n = norm(palavra);
  if (n.length < 3 || n.length > 16) {
    descartadas++;
    continue;
  }
  if (!/^[A-Z]+$/.test(n) || /[KWY]/.test(n)) {
    descartadas++;
    continue;
  }

  const anterior = dic.get(n);
  if (!anterior || diacriticos(palavra) < diacriticos(anterior)) {
    dic.set(n, palavra);
  }
}

// os extras entram por ultimo e nao sobrescrevem grafia ja escolhida
let novos = 0;
for (const extra of EXTRAS) {
  const n = norm(extra);
  if (!/^[A-Z]+$/.test(n) || /[KWY]/.test(n) || n.length < 3 || n.length > 16) continue;
  if (!dic.has(n)) {
    dic.set(n, extra);
    novos++;
  }
}
console.log(`  ${novos} palavra(s) da lista curada acrescentada(s)`);

console.log(`  ${dic.size.toLocaleString("pt-BR")} palavras aproveitadas`);
console.log(`  ${descartadas.toLocaleString("pt-BR")} descartadas pelo filtro`);

const porTamanho = {};
for (const n of dic.keys()) porTamanho[n.length] = (porTamanho[n.length] ?? 0) + 1;
console.log(
  "  por tamanho:",
  Object.entries(porTamanho)
    .sort((a, b) => a[0] - b[0])
    .map(([k, v]) => `${k}:${v}`)
    .join(" "),
);

// ── carrega ────────────────────────────────────────────────────────────────
const conn = new URL(process.env.POSTGRES_URL_NON_POOLING);
conn.searchParams.set("uselibpqcompat", "true");
const client = new pg.Client({ connectionString: conn.toString() });
await client.connect();

await client.query("truncate public.dict_pt");

const entradas = [...dic.entries()];
const LOTE = 20_000;
for (let i = 0; i < entradas.length; i += LOTE) {
  const fatia = entradas.slice(i, i + LOTE);
  await client.query(
    `insert into public.dict_pt (norm, word)
     select * from unnest($1::text[], $2::text[])
     on conflict (norm) do nothing`,
    [fatia.map((e) => e[0]), fatia.map((e) => e[1])],
  );
  process.stdout.write(`\r  carregadas ${Math.min(i + LOTE, entradas.length)} / ${entradas.length}`);
}
process.stdout.write("\n");

const { rows } = await client.query("select count(*)::int n from public.dict_pt");
console.log(`  dict_pt: ${rows[0].n.toLocaleString("pt-BR")} linhas`);

// ── sanidade ───────────────────────────────────────────────────────────────
const deveExistir = [
  "CASA", "ACAO", "CORACAO", "ESTRADA", "PESSEGO", "MULHER", "TRABALHO",
  "AMIGO", "NOITE", "PALAVRA", "MESA", "JOGO", "VERDADE", "CIDADE",
];
// Limitacao conhecida da fonte: ela e toda minuscula, entao nome proprio que
// virou substantivo comum ("brasil", "maria") nao da para separar por caixa.
// Aceitar isso num Boggle nao machuca ninguem — recusar, sim. Quando incomodar,
// o botao "contestar palavra" da tela de revelacao alimenta uma lista curada.
const naoDeveExistir = ["CASARO", "MENTOO", "XPTOZ", "ZZZZ", "QWRTP", "AAAAA"];

const q = async (w) =>
  (await client.query("select word from public.dict_pt where norm = $1", [w])).rows[0]?.word;

let erros = 0;
for (const w of deveExistir) {
  const r = await q(w);
  if (!r) {
    console.log(`  FALHA aceita: ${w} não está no dicionário`);
    erros++;
  } else if (w === "ACAO" || w === "CORACAO" || w === "PESSEGO") {
    console.log(`  ok  ${w} -> ${r}`);
  }
}
for (const w of naoDeveExistir) {
  if (await q(w)) {
    console.log(`  FALHA recusa: ${w} está no dicionário`);
    erros++;
  }
}
console.log(erros === 0 ? "  sanidade: tudo certo" : `  sanidade: ${erros} problema(s)`);

await client.end();
process.exit(erros === 0 ? 0 : 1);
