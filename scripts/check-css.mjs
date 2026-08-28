#!/usr/bin/env node
/**
 * Toda classe do projeto usada num componente existe no CSS?
 *
 *   npm run css
 *
 * POR QUE ISTO EXISTE. Ninguém abriu o site ainda: todo o layout deste projeto
 * foi raciocinado a partir do código. E o erro mais fácil de cometer nesse
 * regime é o mais invisível de todos — escrever `className="met-pensando"` e
 * esquecer de escrever `.met-pensando { … }`.
 *
 * O elemento aparece. Não quebra nada. Não dá erro em lugar nenhum. Só fica sem
 * o espaçamento, sem o alinhamento, sem a cor — e a pessoa que abrir a página vê
 * um pedaço torto sem saber por quê. TypeScript não pega, lint não pega, build
 * não pega, e nenhum teste de servidor chega perto.
 *
 * COMO ELE SEPARA classe do projeto de utilitário do Tailwind: o vocabulário do
 * projeto é o conjunto de classes DEFINIDAS em app/*.css. Uma classe usada que
 * não está lá e não casa com a cara de um utilitário do Tailwind é a suspeita.
 *
 * O contrário também é reportado, como aviso e não como falha: classe definida
 * e nunca usada é CSS morto — incômodo, mas não é um pedaço torto na tela.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ── o vocabulário do projeto ────────────────────────────────────────────── */

const cssDir = join(raiz, "app");
const arquivosCss = readdirSync(cssDir).filter((f) => f.endsWith(".css"));
const definidas = new Set();
for (const f of arquivosCss) {
  /* Os comentários saem antes: um `.tsx` ou um `w3.org` dentro de comentário
     entrava na lista como se fosse classe, e o aviso de "CSS morto" saía cheio
     de lixo. Aviso com lixo dentro é aviso que se aprende a ignorar. */
  const texto = readFileSync(join(cssDir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ")
    // e as `url(...)` também: um SVG embutido traz "www.w3.org" dentro
    .replace(/url\((?:"[^"]*"|'[^']*'|[^)]*)\)/g, " ");
  for (const m of texto.matchAll(/\.([a-z][a-z0-9]*(?:-[a-z0-9]+)*)/g)) {
    definidas.add(m[1]);
  }
}

/* ── o que os componentes usam ───────────────────────────────────────────── */

function tsx(dir) {
  const saida = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) saida.push(...tsx(caminho));
    else if (nome.endsWith(".tsx")) saida.push(caminho);
  }
  return saida;
}

/** Prefixos de variante do Tailwind, que o split deixa soltos. */
const PREFIXO = new Set([
  "sm", "md", "lg", "xl", "2xl", "hover", "focus", "active", "dark", "first",
  "last", "odd", "even", "disabled", "group-hover", "motion-safe",
  "motion-reduce", "print", "peer-checked", "focus-visible", "focus-within",
]);

const usadas = new Map(); // classe -> primeiro arquivo onde apareceu
for (const arq of [...tsx(join(raiz, "components")), ...tsx(join(raiz, "app"))]) {
  const texto = readFileSync(arq, "utf8");
  // className="a b c" e className={`a ${x} b`} e className={cond ? "a" : "b"}
  for (const m of texto.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{[^}]*?"([^"]*)"[^}]*\})/g)) {
    const bruto = `${m[1] ?? ""} ${m[2] ?? ""} ${m[3] ?? ""}`;
    for (const c of bruto.split(/[\s${}?:'"]+/)) {
      if (!c || c.includes("<") || c.includes("(")) continue;
      /* `${fraunces.variable}` dentro de um template literal chega aqui como
         "fraunces.variable". Nome com ponto é expressão de JavaScript, nunca
         classe de CSS. */
      if (c.includes(".")) continue;
      /* O split quebra no `:`, então "hover:bg-x" vira "hover" e "bg-x". O
         prefixo sozinho não é classe de nada. */
      if (PREFIXO.has(c)) continue;
      if (!usadas.has(c)) usadas.set(c, arq.replace(raiz, "").replace(/\\/g, "/"));
    }
  }
}

/**
 * Cara de utilitário do Tailwind.
 *
 * A lista é generosa de propósito: um falso NEGATIVO aqui (deixar passar uma
 * classe do projeto sem CSS) é o que este script existe para evitar, mas um
 * falso POSITIVO seria pior — ele ensinaria a ignorar a saída.
 */
const TAILWIND =
  /^(?:-?(?:sm|md|lg|xl|2xl|hover|focus|active|group-hover|dark|first|last|odd|even|disabled|motion-safe|motion-reduce|print|aria-\w+|data-\[[^\]]*\]):)*-?(?:m|p|w|h|min|max|gap|space|text|font|leading|tracking|bg|border|rounded|shadow|opacity|z|flex|grid|col|row|items|justify|self|place|order|inset|top|right|bottom|left|translate|rotate|scale|transition|duration|delay|ease|cursor|select|overflow|whitespace|break|truncate|list|align|object|aspect|basis|grow|shrink|table|sr|not|pointer|resize|fill|stroke|backdrop|blur|ring|divide|from|via|to|animate|origin|snap|scroll|antialiased|relative|absolute|fixed|sticky|static|block|inline|hidden|contents|isolate|visible|invisible|uppercase|lowercase|capitalize|italic|underline|line|decoration|indent|caret|accent|appearance|outline|container|mx|my|mt|mb|ml|mr|px|py|pt|pb|pl|pr|inline-flex|inline-block|inline-grid|flex-col|flex-row|flex-wrap|flex-none|flex-1|min-w-0|w-full|h-full|text-\w+)(?:-|$|\[)/;

/* ── o veredicto ─────────────────────────────────────────────────────────── */

console.log("\nMesa — as classes do projeto têm CSS?\n");
console.log(`  ${definidas.size} classes definidas em ${arquivosCss.length} arquivos de CSS`);
console.log(`  ${usadas.size} classes distintas usadas nos componentes\n`);

const orfas = [];
for (const [classe, arquivo] of usadas) {
  if (definidas.has(classe)) continue;
  if (TAILWIND.test(classe)) continue;
  if (/^[a-z]+$/.test(classe) && classe.length <= 3) continue; // `sr`, `dim` etc já cobertos
  orfas.push({ classe, arquivo });
}

if (orfas.length === 0) {
  console.log("  ok      toda classe do projeto usada num componente tem CSS\n");
} else {
  for (const o of orfas) {
    console.error(`  FALHA   .${o.classe} é usada em ${o.arquivo} e não existe em nenhum CSS`);
  }
  console.error(
    `\n  ${orfas.length} classe(s) sem estilo. Isso não quebra o build nem o teste de servidor —` +
      " só deixa um pedaço torto na tela para quem abrir a página.\n",
  );
}

/* Classe definida e nunca usada é CSS morto: incomoda, mas não deixa nada torto.
   Vira aviso, e aviso não reprova. */
const mortas = [...definidas].filter((c) => !usadas.has(c));
if (mortas.length) {
  console.log(`  aviso   ${mortas.length} classe(s) no CSS que nenhum componente usa`);
  console.log(`          ${mortas.slice(0, 14).join(" ")}${mortas.length > 14 ? " …" : ""}\n`);
}

/* ── e todo campo tem nome? ──────────────────────────────────────

   Mesma família de defeito que a classe sem CSS, e mesma invisibilidade: um
   `<input>` sem nome aparece na tela, funciona no dedo, não dá erro em lugar
   nenhum — e quem usa leitor de tela ouve "campo de número" e mais nada.

   Cinco campos de cláusula da Metrópole estavam assim: o de valor da parcela, o
   de quantas rodadas, o de isenção, o de preço da opção e o de até quando ela
   vale. Cada um cercado de `<span>` que explicam tudo para quem enxerga e nada
   para quem não enxerga.

   VALE COMO NOME: `aria-label`, `aria-labelledby`, um `id` que algum `<label>`
   aponte, ou estar DENTRO de um `<label>` — a associação implícita, que é a mais
   comum aqui e a mais fácil de ler no código.

   A varredura conta chaves para achar o fim da tag: `onChange={(e) => …}` tem
   um `>` dentro, e um regex ingênuo corta a tag no meio e acusa campo nomeado
   de anônimo. A primeira versão desta auditoria fez exatamente isso e reportou
   onze — seis eram falso positivo. */

/** O índice do `>` que fecha a tag aberta em `i`, ignorando os de dentro de `{}`. */
function fimDaTag(texto, i) {
  let profundidade = 0;
  for (let k = i; k < texto.length; k++) {
    const c = texto[k];
    if (c === "{") profundidade++;
    else if (c === "}") profundidade--;
    else if (c === ">" && profundidade === 0) return k;
  }
  return -1;
}

const anonimos = [];
for (const arq of [...tsx(join(raiz, "components")), ...tsx(join(raiz, "app"))]) {
  const texto = readFileSync(arq, "utf8");
  let i = 0;
  while ((i = texto.indexOf("<input", i)) >= 0) {
    const fim = fimDaTag(texto, i);
    if (fim < 0) break;
    const tag = texto.slice(i, fim + 1);
    /* O `<label>` em volta conta. Olhar para trás 400 caracteres alcança o
       `<label className="…">` e o `<span>` do rótulo sem alcançar o campo
       anterior — e um `</label>` no meio do caminho significa que aquele label
       já fechou e não é este campo que ele nomeia. */
    const antes = texto.slice(Math.max(0, i - 400), i);
    const dentroDeLabel = antes.lastIndexOf("<label") > antes.lastIndexOf("</label>");
    if (/aria-label|aria-labelledby|[\s"]id=/.test(tag) || dentroDeLabel) {
      i = fim + 1;
      continue;
    }
    anonimos.push({
      arquivo: arq.replace(raiz, "").replace(/\\/g, "/"),
      trecho: tag.replace(/\s+/g, " ").slice(0, 72),
    });
    i = fim + 1;
  }
}

if (anonimos.length === 0) {
  console.log("  ok      todo campo de digitação tem nome acessível\n");
} else {
  for (const a of anonimos) {
    console.error(`  FALHA   campo sem nome em ${a.arquivo}: ${a.trecho}`);
  }
  console.error(
    `
  ${anonimos.length} campo(s) que um leitor de tela anuncia sem dizer o que são.
`,
  );
}

process.exit(orfas.length === 0 && anonimos.length === 0 ? 0 : 1);
