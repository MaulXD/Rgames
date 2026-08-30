#!/usr/bin/env node
/**
 * Quanto pesa abrir o Mesa.
 *
 *   npm run peso      (roda depois do build; ele lê o que o build produziu)
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUE ISTO EXISTE
 *
 * Este projeto é MOBILE-FIRST por decisão, e num celular brasileiro no 4G a
 * primeira coisa que decide se a pessoa espera ou fecha a aba é o peso do que
 * ela precisa baixar antes de ver alguma coisa. Nenhuma das doze etapas de
 * `npm run verifica` media isso: dava para dobrar o payload sem nada acusar.
 *
 * O PRD 06 pedia `size-limit` no CI e ele nunca entrou, e há um bom motivo para
 * não entrar: seria a primeira dependência nova em muitas etapas, para fazer
 * uma conta que o Node já sabe fazer. `zlib.brotliCompressSync` vem na caixa.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O QUE ELE MEDE, E O QUE ELE NÃO VÊ
 *
 * O Next pré-renderiza algumas rotas em HTML, e nesse HTML estão, por nome, os
 * arquivos que o navegador vai buscar. Então a conta não é estimativa: é a
 * soma do que aquela página REALMENTE pede.
 *
 * Cada tipo é medido como o navegador o recebe:
 *
 *   • js e css   comprimidos em brotli, que é o que a Vercel serve
 *   • woff2      crus. O woff2 JÁ é comprimido; passar brotli por cima daria um
 *                número menor do que o que trafega, e um número otimista é pior
 *                que nenhum
 *
 * O QUE ELE NÃO VÊ: as telas de jogo não são pré-renderizadas — elas dependem
 * de sessão —, então o que uma partida carrega POR CIMA disto não aparece aqui.
 * A segunda medida existe por causa disso: o total de todo o código de cliente
 * publicado, que é o teto de tudo o que qualquer rota pode vir a pedir.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * OS TETOS SÃO FOLGADOS DE PROPÓSITO
 *
 * Um teto colado no número de hoje reprova em toda mudança e vira ruído que se
 * aumenta sem pensar. Estes têm cerca de 20% de folga: eles não perseguem
 * gordura, eles acusam DEGRAU — uma quinta fonte, uma biblioteca de gráficos,
 * um subconjunto de idioma a mais.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync } from "node:zlib";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const NEXT = join(raiz, ".next");

let falhas = 0;
const ok = (c, m) => {
  if (!c) falhas++;
  console.log(`${c ? "  ok    " : "  FALHA "} ${m}`);
};
const kb = (n) => (n / 1024).toFixed(1);

/* ── os tetos, com o motivo escrito ───────────────────────────────────────── */

const TETOS = {
  /* A abertura: o que chega antes de a pessoa ver qualquer coisa. */
  js: 260,
  css: 32,
  /* QUATRO FAMÍLIAS VARIÁVEIS, e elas são metade do peso de abertura. Isso é
     escolha do PRD 01 e não desperdício: a tipografia é o que faz o Mesa não
     parecer planilha. O teto existe para que uma QUINTA precise ser decidida,
     e não acontecer. */
  fontes: 300,
  /* Todo o código de cliente publicado — o teto do que qualquer partida pode
     vir a pedir depois da abertura. */
  totalJs: 380,
};

/* ── o que cada rota pré-renderizada pede ─────────────────────────────────── */

function pesoDe(caminho) {
  const bruto = readFileSync(caminho);
  /* woff2 já vem comprimido; brotli por cima mentiria para menos. */
  return extname(caminho) === ".woff2" ? bruto.length : brotliCompressSync(bruto).length;
}

const paginas = readdirSync(join(NEXT, "server", "app"))
  .filter((f) => f.endsWith(".html") && !f.startsWith("_"))
  .sort();

if (paginas.length === 0) {
  console.error("  FALHA  não achei página pré-renderizada em .next — rode `npm run build` antes");
  process.exit(1);
}

console.log("\nMesa — quanto pesa abrir\n");

let piorJs = 0;
let piorCss = 0;
let piorFontes = 0;
let piorNome = "";

for (const arquivo of paginas) {
  const html = readFileSync(join(NEXT, "server", "app", arquivo), "utf8");
  /* O `\\` fica de fora da classe de propósito: o HTML do Next escapa as
     barras dentro do payload de RSC, e sem isso o mesmo arquivo entrava duas
     vezes na conta — uma com a barra invertida colada no nome. */
  const pedidos = new Set([...html.matchAll(/\/_next\/static\/[^"'\\\s)]+/g)].map((m) => m[0]));

  let js = 0;
  let css = 0;
  let fontes = 0;
  let perdidos = 0;
  for (const p of pedidos) {
    const disco = join(NEXT, p.replace("/_next/", ""));
    let n = 0;
    try {
      if (!statSync(disco).isFile()) continue;
      n = pesoDe(disco);
    } catch {
      perdidos++;
      continue;
    }
    if (p.endsWith(".js")) js += n;
    else if (p.endsWith(".css")) css += n;
    else if (p.endsWith(".woff2") || p.endsWith(".woff") || p.endsWith(".ttf")) fontes += n;
  }

  console.log(
    `  ${arquivo.replace(".html", "").padEnd(10)} ${kb(js).padStart(7)} KB js · ` +
      `${kb(css).padStart(6)} KB css · ${kb(fontes).padStart(7)} KB fontes` +
      (perdidos ? `  (${perdidos} não achados)` : ""),
  );

  if (js > piorJs) {
    piorJs = js;
    piorNome = arquivo.replace(".html", "");
  }
  piorCss = Math.max(piorCss, css);
  piorFontes = Math.max(piorFontes, fontes);
}

console.log("");
ok(
  piorJs / 1024 <= TETOS.js,
  `a rota mais pesada abre com ${kb(piorJs)} KB de js em brotli (${piorNome}, teto ${TETOS.js})`,
);
ok(piorCss / 1024 <= TETOS.css, `e ${kb(piorCss)} KB de css (teto ${TETOS.css})`);
ok(
  piorFontes / 1024 <= TETOS.fontes,
  `e ${kb(piorFontes)} KB das quatro famílias variáveis (teto ${TETOS.fontes})`,
);

/* ── e o teto de tudo ─────────────────────────────────────────────────────── */

const chunks = join(NEXT, "static", "chunks");
let totalJs = 0;
let arquivosJs = 0;
for (const f of readdirSync(chunks)) {
  const p = join(chunks, f);
  if (!f.endsWith(".js") || !statSync(p).isFile()) continue;
  totalJs += pesoDe(p);
  arquivosJs++;
}

ok(
  totalJs / 1024 <= TETOS.totalJs,
  `e todo o código de cliente publicado soma ${kb(totalJs)} KB em ${arquivosJs} pedaços` +
    ` (teto ${TETOS.totalJs}) — é o máximo que uma partida pode vir a pedir`,
);

console.log(falhas === 0 ? "\nTudo passou." : `\n${falhas} teto(s) estourado(s).`);
process.exit(falhas === 0 ? 0 : 1);
