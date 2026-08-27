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
import { readFileSync } from "node:fs";
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
/**
 * Corpus de frequencia: lista de legendas em portugues brasileiro, ordenada da
 * palavra mais falada para a menos. E "falado", nao "escrito", e isso importa:
 * o registro de legenda e o registro de mesa de amigos.
 *
 * Serve para separar o que o jogo ACEITA (generoso) do que o jogo MOSTRA
 * (comum). "serioba" existe no VOLP e nunca vai aparecer na revelacao.
 */
const CORPUS =
  "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/pt_br/pt_br_full.txt";

/**
 * O CORTE DE "PALAVRA COMUM", escalado por tamanho.
 *
 * `freq` é POSTO no corpus, não contagem: 1 é a mais falada. Medido — NADA=68,
 * FUNDO=864, DONO=1683, ONDA=3047 — e o lixo vive entre 11 mil e 49 mil.
 *
 * O corpus degrada em RITMOS DIFERENTES por tamanho, e é essa a descoberta que
 * resolve o problema. Amostrado por faixa de posto:
 *
 *   3 letras, 15k–50k:  non lux joo ami odo lao ape eba pum net tau chu ori
 *   6 letras, 30k–50k:  cafofo reboco escuna fibula torrao crasso micose
 *                       bolero servil alaude adorno genese rufiao obtuso
 *
 * Palavra longa que aparece no corpus é quase sempre palavra de verdade;
 * palavra de três letras é uma sopa de fragmento, sigla e nome de personagem.
 * E palavra curta vale 1 ponto, então perder algumas custa pouco.
 *
 * O corte único de 50 mil que existia antes deixava passar ONO, ADE, NON, NOR,
 * GUA, DEA, ENA, OUT, NET, GATE, UFO, ADELE, GAEL, NUNO e DUDA — tudo na
 * revelação, que é o momento em que o jogo ENSINA.
 */
const CORTE_POR_TAMANHO = { 3: 4_000, 4: 18_000, 5: 32_000 };
const CORTE_PADRAO = 50_000;
const corteDe = (len) => CORTE_POR_TAMANHO[len] ?? CORTE_PADRAO;

/**
 * A lista curada do que o corte NÃO pega: nome de personagem e inglês não
 * traduzido, que numa legenda de filme têm frequência ALTA.
 *
 * O cabeçalho do arquivo conta por que não deu para automatizar: maiúscula não
 * ajuda (o corpus é todo minúsculo) e o sinal do Hunspell foi MEDIDO e errou 37
 * dos 56 nomes testados, além de recusar "casa" e "mesa".
 */
function naoComum() {
  const bruto = readFileSync(join(root, "data", "letreiro-nao-comum.txt"), "utf8");
  const fora = new Set();
  for (const linha of bruto.split(/\r?\n/)) {
    if (linha.trim().startsWith("#")) continue;
    for (const w of linha.trim().split(/\s+/)) {
      if (!w) continue;
      const n = norm(w);
      if (n) fora.add(n);
    }
  }
  return fora;
}

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

/** norm -> posto de frequencia (1 = mais falada). Ausente = raro. */
async function frequencias() {
  process.stdout.write(`  baixando ${CORPUS}\n`);
  const posto = new Map();
  try {
    const r = await fetch(CORPUS);
    if (!r.ok) throw new Error(String(r.status));
    const texto = await r.text();
    let n = 0;
    for (const linha of texto.split(/\r?\n/)) {
      const palavra = linha.split(" ")[0];
      if (!palavra) continue;
      const k = norm(palavra);
      if (!k) continue;
      n++;
      // a primeira ocorrencia e a mais frequente (a lista vem ordenada);
      // formas com e sem acento colapsam no mesmo norm, e fica a melhor
      if (!posto.has(k)) posto.set(k, n);
    }
    console.log(`  ${posto.size.toLocaleString("pt-BR")} formas com frequencia`);
  } catch (e) {
    console.error(`  corpus indisponivel (${e.message}) — seguindo sem frequencia`);
  }
  return posto;
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

const posto = await frequencias();

// ── carrega ────────────────────────────────────────────────────────────────
const conn = new URL(process.env.POSTGRES_URL_NON_POOLING);
conn.searchParams.set("uselibpqcompat", "true");
const client = new pg.Client({ connectionString: conn.toString() });
await client.connect();

await client.query("truncate public.dict_pt");

const fora = naoComum();
console.log(`  ${fora.size} palavra(s) na lista curada do "aceita mas não mostra"`);

/* A DECISÃO DE "COMUM" MORA AQUI, e só aqui.
   Antes ela vivia em `build-boards.mjs`, que é o CONSUMIDOR — e consumidor que
   decide é regra que se repete no próximo consumidor. Quem tem o corpus, o
   tamanho e a lista curada na mão é este script. */
const ehComum = (n, p) => p !== null && p <= corteDe(n.length) && !fora.has(n);

const entradas = [...dic.entries()].map(([n, w]) => {
  const p = posto.get(n) ?? null;
  return [n, w, p, ehComum(n, p)];
});
const quantasComuns = entradas.filter((e) => e[3]).length;
console.log(
  `  ${quantasComuns.toLocaleString("pt-BR")} comuns de ${entradas.length.toLocaleString("pt-BR")}` +
    ` (o corte único de 50 mil dava ${entradas.filter((e) => e[2] !== null && e[2] <= 50_000).length.toLocaleString("pt-BR")})`,
);

// quantas palavras jogaveis sao realmente conhecidas?
const faixas = [5000, 10000, 20000, 30000, 50000, 100000];
const dentro = (lim) => entradas.filter((e) => e[2] !== null && e[2] <= lim).length;
console.log(
  "  comuns por corte: " +
    faixas.map((f) => `${f / 1000}k:${dentro(f).toLocaleString("pt-BR")}`).join("  ") +
    `  |  sem frequencia: ${entradas.filter((e) => e[2] === null).length.toLocaleString("pt-BR")}`,
);
const LOTE = 20_000;
for (let i = 0; i < entradas.length; i += LOTE) {
  const fatia = entradas.slice(i, i + LOTE);
  await client.query(
    `insert into public.dict_pt (norm, word, freq, comum)
     select * from unnest($1::text[], $2::text[], $3::int[], $4::boolean[])
     on conflict (norm) do update
        set freq = excluded.freq, comum = excluded.comum`,
    [
      fatia.map((e) => e[0]),
      fatia.map((e) => e[1]),
      fatia.map((e) => e[2]),
      fatia.map((e) => e[3]),
    ],
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
/* ── as duas pontas do "comum" ─────────────────────────────────

   Um filtro de qualidade erra nas duas direções, e a segunda é PIOR. Mostrar
   "ADELE" na revelação faz o jogo parecer desleixado; esconder "CASA" faz a
   revelação mentir sobre o que a pessoa deixou passar. A primeira versão da
   lista curada tinha "dentro", "fora", "lula", "temer", "porto", "catar" e
   "clara" — nomes que também são palavras do dia a dia. Este bloco existe por
   causa disso. */

const LIXO_FORA = [
  // fragmento e sigla
  "ONO", "ADE", "NON", "NOR", "GUA", "DEA", "ENA", "ENDO", "APE", "ODO",
  // inglês não traduzido
  "OUT", "NET", "GATE", "SURF", "GOLF", "ZOOM", "BLOG", "JEEP", "CLEAR",
  "ROBOT", "SLIDE", "PUZZLE", "TROJAN", "COMBO", "DEALER", "TEFLON",
  // nome de pessoa e de lugar
  "ADELE", "GAEL", "NUNO", "DUDA", "NAGA", "CRIS", "AMIR", "DINA", "NERO",
  "OLGA", "TITO", "SACHA", "EDIPO", "CONAN", "TORINO", "MADRAS", "NILO",
  "BACO", "ARGO", "CRETA", "NEPAL", "MACAU", "XOGUM", "AZAZEL", "MADONA",
];

const DIA_A_DIA = [
  /* As que quase morreram na primeira versão da lista curada: nome ou
     sobrenome que TAMBÉM é palavra do dia a dia. FARO, PAMPA e SENA estavam
     nesta lista e saíram: o teste falhou apontando para elas, e ele estava
     certo — nenhuma das três é palavra do dia a dia, e PAMPA nem está no
     dicionário. Expectativa de teste também se conserta. */
  "DENTRO", "FORA", "LULA", "TEMER", "PORTO", "CATAR", "CLARA", "SERTAO",
  "TURCA",
  /* E as que quase morreram na SEGUNDA passada, quando entrei prefixos na
     lista: "para" é a preposição mais comum do português e eu a tinha marcado
     como prefixo de "para‑". "meta", "extra", "ante" e "retro" foram junto. */
  "PARA", "META", "EXTRA", "ANTE", "RETRO",
  // e o dia a dia mesmo, que é o que a revelação precisa ter
  "CASA", "MESA", "NADA", "FUNDO", "DONO", "SONO", "ONDA", "AGUDO", "DENSO",
  "TEMPO", "NOITE", "AMIGO", "CIDADE", "ESTRADA", "PALAVRA", "TRABALHO",
  "MULHER", "HOMEM", "VERDADE", "CORACAO", "ESCOLA", "COMIDA", "JANELA",
  "CADEIRA", "PANELA", "CANETA", "CAMISA", "DINHEIRO", "SEMANA", "MINUTO",
  // estrangeirismo que virou português e TEM de continuar comum
  "MENU", "JIPE", "IATE", "BLITZ", "RIMEL", "TOTEM", "ITEM", "CZAR",
];

const comumDe = async (w) =>
  (await client.query("select comum from public.dict_pt where norm = $1", [w])).rows[0]?.comum;

let sujos = 0;
for (const w of LIXO_FORA) {
  if ((await comumDe(w)) === true) {
    console.log(`  FALHA mostra: ${w} está marcada como comum`);
    sujos++;
  }
}
let sumidos = 0;
for (const w of DIA_A_DIA) {
  const c = await comumDe(w);
  if (c === undefined) {
    console.log(`  FALHA dicionário: ${w} não está no dicionário`);
    sumidos++;
  } else if (c !== true) {
    console.log(`  FALHA esconde: ${w} deixou de ser comum — o filtro apertou demais`);
    sumidos++;
  }
}
erros += sujos + sumidos;
console.log(
  sujos === 0 && sumidos === 0
    ? `  comum: ${LIXO_FORA.length} lixos fora e ${DIA_A_DIA.length} do dia a dia dentro`
    : `  comum: ${sujos} lixo(s) mostrado(s), ${sumidos} do dia a dia escondida(s)`,
);

console.log(erros === 0 ? "  sanidade: tudo certo" : `  sanidade: ${erros} problema(s)`);

// amostra: as palavras de 7 letras mais comuns e as sem frequencia nenhuma
const amostraComum = await client.query(
  "select word from public.dict_pt where len = 7 and comum order by freq limit 12",
);
const amostraRara = await client.query(
  "select word from public.dict_pt where len = 7 and freq is null order by norm limit 12",
);
console.log("  comuns de 7 letras: " + amostraComum.rows.map((r) => r.word).join(", "));
console.log("  raras  de 7 letras: " + amostraRara.rows.map((r) => r.word).join(", "));

await client.end();
process.exit(erros === 0 ? 0 : 1);
