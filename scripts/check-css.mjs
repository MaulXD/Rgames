#!/usr/bin/env node
/**
 * A auditoria da tela, feita sem olhos.
 *
 *   npm run css
 *
 * São cinco perguntas, e todas têm resposta calculável a partir do código:
 *
 *   1. toda classe usada num componente existe no CSS?
 *   2. todo campo de digitação tem nome acessível?
 *   3. toda regra que pinta texto e fundo passa no piso de contraste da WCAG?
 *   4. todo alvo de toque cabe no dedo?
 *   5. toda facção do Domínio e todo grupo da Metrópole têm textura própria, para
 *      quem não separa cores?
 *
 * POR QUE ISTO EXISTE. Ninguém abriu o site ainda: todo o layout deste projeto
 * foi raciocinado a partir do código, e a maior lacuna declarada no roadmap é
 * exatamente essa. Isto aqui não fecha a lacuna — layout, ritmo e se a coisa é
 * agradável de usar continuam precisando de olhos. Fecha as bordas dela que são
 * ARITMÉTICA: contraste é uma fórmula em cima de dois hexadecimais, e alvo de
 * toque é um número em pixels.
 *
 * O primeiro dos quatro é o mais invisível de todos — escrever
 * `className="met-pensando"` e esquecer de escrever `.met-pensando { … }`.
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
import {
  paraRgb,
  partesDoSeletor,
  razao,
  resolveVar,
  tokensDeCss,
} from "./cores.mjs";

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

console.log("\nMesa — a auditoria da tela\n");
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


/* ── e o contraste? ──────────────────────────────────────────────────────────

   ESTA É A MAIOR LACUNA DO PROJETO, atacada pelo único lado que dá para atacar
   sem olhos: nenhuma tela foi vista, e "contraste" é a parte de "ninguém viu"
   que É calculável. A fórmula da WCAG é aritmética em cima de dois hexadecimais.

   O que a varredura faz: para toda regra de CSS que declara AO MESMO TEMPO uma
   cor de texto e um fundo, resolve os dois até o hexadecimal — seguindo cadeias
   de `var()` — e calcula a razão de contraste.

   O piso é 4.5:1, o da WCAG AA para texto normal. Texto grande (≥ 24px, ou
   ≥ 18.66px em negrito) tem piso 3:1, e a varredura usa esse quando a mesma
   regra declara `font-size` grande o bastante.

   O QUE ELA NÃO VÊ, e é importante dizer: cor herdada de um pai, fundo que vem
   de uma imagem ou gradiente, `rgb(… / α)` sobre fundo desconhecido, e o efeito
   de sombra de texto. Ela cobre o caso mais comum e mais fácil de errar — uma
   regra que pinta as duas coisas e erra o par —, não a tela inteira. A contagem
   de puladas sai no relatório, senão "0 problemas" mentiria sobre a cobertura. */

/* A CONTA MORA EM `scripts/cores.mjs`, e mora lá porque esta varredura deixou
   de ser a única a fazê-la: `npm run smoke:render` faz a mesma pergunta em cima
   da ÁRVORE renderizada, onde a cor herdada existe. Duas cópias de uma fórmula
   é o defeito que este projeto mais persegue nos jogos; não faria sentido
   deixá-lo em pé na ferramenta que persegue. */

/* Os tokens, de todos os arquivos: `--x: valor` no nível que for. */
const tokens = tokensDeCss(cssDir, arquivosCss);

const fracos = [];
let paresLidos = 0;
let pulados = 0;

for (const f of arquivosCss) {
  const texto = readFileSync(join(cssDir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
  for (const m of texto.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const seletor = m[1].trim().replace(/\s+/g, " ");
    const corpo = m[2];
    if (seletor.startsWith("@")) continue;

    const cor = /(?:^|[;\s])color\s*:\s*([^;]+)/.exec(corpo)?.[1];
    const fundo =
      /(?:^|[;\s])background-color\s*:\s*([^;]+)/.exec(corpo)?.[1] ??
      /(?:^|[;\s])background\s*:\s*([^;]+)/.exec(corpo)?.[1];
    if (!cor || !fundo) continue;

    const rgbCor = paraRgb(resolveVar(cor, tokens));
    const rgbFundo = paraRgb(resolveVar(fundo, tokens));
    if (!rgbCor || !rgbFundo) {
      pulados++;
      continue;
    }
    paresLidos++;

    /* Texto grande tem piso mais baixo, e a regra da WCAG é 24px, ou 18.66px se
       for negrito. Só conta quando a MESMA regra declara o tamanho: herdado, a
       varredura não sabe, e nesse caso o piso alto é a hipótese conservadora. */
    const tam = /font-size\s*:\s*([\d.]+)(px|rem)/.exec(corpo);
    const px = tam ? Number(tam[1]) * (tam[2] === "rem" ? 16 : 1) : null;
    const negrito = /font-weight\s*:\s*(?:bold|[6-9]00)/.test(corpo);
    const grande = px !== null && (px >= 24 || (px >= 18.66 && negrito));
    const piso = grande ? 3 : 4.5;

    const r = razao(rgbCor, rgbFundo);
    if (r < piso) {
      fracos.push({ arquivo: f, seletor: seletor.slice(0, 46), r: r.toFixed(2), piso });
    }
  }
}

console.log(`  ${paresLidos} regra(s) pintam texto e fundo com cor resolvível (${pulados} com gradiente, alfa ou herança)`);

if (fracos.length === 0) {
  console.log("  ok      toda regra que pinta texto e fundo passa no piso da WCAG AA\n");
} else {
  for (const x of fracos) {
    console.error(
      `  FALHA   ${x.seletor} em app/${x.arquivo}: contraste ${x.r}:1, o piso é ${x.piso}:1`,
    );
  }
  console.error(
    `\n  ${fracos.length} par(es) de cor abaixo do piso. Num celular ao sol isso é texto que some.\n`,
  );
}

/* ── e duas folhas pintam a mesma classe? ────────────────────────────────────

   AS SEIS FOLHAS DE ESTILO SÃO GLOBAIS. `app/layout.tsx` importa todas as seis
   na raiz, então `.carta` do Domínio pinta a carta do Dossiê, e quem carrega
   depois ganha — sem erro, sem aviso, sem nada na tela dizendo por quê. A ordem
   do `import` decide o desenho de um jogo que nem foi aberto.

   ISSO NÃO É TEORIA. Quatro classes colidiam quando esta varredura foi escrita,
   e o estrago era visível em todas:

     .mapa   o `min-width: 680px` do mapa do Domínio caía na planta baixa do
             Dossiê — rolagem lateral em TODO celular, num projeto que é
             mobile-first por decisão
     .carta  a carta do Domínio tem 7,2rem de largura fixa; a do Dossiê é um
             leque de cartas inclinadas. O leque virava uma fila de cartões
     .peao   o peão da Metrópole é um disco de 13px; o do Dossiê é um avatar de
             28px. O avatar era espremido no disco
     .mao    a mão do Domínio tem recheio de painel; a do Dossiê não devia ter

   Nenhuma delas apareceria numa auditoria de contraste, de nome acessível ou de
   alvo de toque, e nenhuma apareceria no `typecheck`. Elas só aparecem olhando,
   ou perguntando isto.

   O que a pergunta cobra: uma classe pode ser pintada SOLTA — sem exigir um
   ancestral — em um arquivo só. Refinar em contexto (`.acao-botoes .btn`) é
   como o projeto compartilha `.btn`, `.dim` e `.eyebrow` de propósito, e
   continua liberado: quem escreve `.leilao .eyebrow` está dizendo em que
   pedaço da tela aquilo vale. */

const soltaEm = new Map();
for (const f of arquivosCss) {
  const texto = readFileSync(join(cssDir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
  for (const m of texto.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    const cabeca = m[1].trim().replace(/\s+/g, " ");
    if (cabeca.startsWith("@") || !cabeca) continue;
    for (const um of cabeca.split(",")) {
      const partes = partesDoSeletor(um);
      if (!partes || partes.length !== 1) continue;
      for (const c of partes[0].parte.classes) {
        if (!soltaEm.has(c)) soltaEm.set(c, new Set());
        soltaEm.get(c).add(f);
      }
    }
  }
}

const disputadas = [...soltaEm].filter(([, arquivos]) => arquivos.size > 1);
console.log(`  ${soltaEm.size} classe(s) pintadas sem exigir contexto, nas ${arquivosCss.length} folhas`);
if (disputadas.length === 0) {
  console.log("  ok      e cada uma é pintada solta por uma folha só — nenhum jogo desenha o outro\n");
} else {
  for (const [c, arquivos] of disputadas) {
    console.error(`  FALHA   .${c} é pintada solta em ${[...arquivos].join(" e ")}`);
  }
  console.error(
    `\n  ${disputadas.length} classe(s) disputadas. As seis folhas são globais: quem carrega` +
      " depois ganha, e o jogo que perde nem sabe.\n",
  );
}

/* ── e quem pediu menos movimento é ouvido? ──────────────────────────────────

   O PRD 01 promete `prefers-reduced-motion` em toda tela, e este projeto anima
   muito: dado que rola, peão que anda, casa que sobe, confete, o pulinho do
   relógio, o lustro da bandeja. Quarenta e oito regras declaram `animation`.

   A promessa NÃO é cumprida regra a regra, e é aqui que uma auditoria ingênua
   erra: o `globals.css` tem um desligamento UNIVERSAL — `*`, `*::before` e
   `*::after` com `animation-duration` de 0,01ms, uma iteração só e transição
   instantânea, tudo `!important`. Uma varredura que cobrasse um bloco de
   `reduce` por regra animada acusaria doze falsos positivos e ensinaria a
   ignorar a saída vermelha.

   A pergunta certa é sobre O DESLIGAMENTO, porque ele é a coisa que carrega a
   promessa inteira e cabe num bloco só. Apagar esse bloco, ou estreitá-lo para
   um punhado de classes, devolve as quarenta e oito animações a quem pediu que
   não houvesse nenhuma — e nada acusaria, porque a tela continua funcionando
   perfeitamente para quem não ligou a preferência.

   O QUE ELE NÃO ALCANÇA, e por isso não é a história toda: TEMPO não é CSS. A
   rolagem do Domínio é encenada por `setTimeout`, e a folha de estilo não
   encurta um único milissegundo dela — tirava o giro do dado e deixava a pessoa
   olhando vinte e um segundos de dados parados. Isso se conserta em código, com
   `useMenosMovimento`, e é conferido em `npm run smoke:render`, que monta as
   duas formas da rolagem. */

const UNIVERSAL = [
  ["animation-duration", /animation-duration\s*:\s*0?\.?\d+m?s\s*!important/],
  ["animation-iteration-count", /animation-iteration-count\s*:\s*1\s*!important/],
  ["transition-duration", /transition-duration\s*:\s*0?\.?\d+m?s\s*!important/],
];

const blocosCalmos = [];
for (const f of arquivosCss) {
  const texto = readFileSync(join(cssDir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
  for (const m of texto.matchAll(/@media[^{]*prefers-reduced-motion[^{]*\{([\s\S]*?)\n\}/g)) {
    blocosCalmos.push({ arquivo: f, corpo: m[1] });
  }
}

/* O bloco que vale é o que casa TUDO — `*` mais os dois pseudo-elementos. */
const oCuringa = blocosCalmos.find(
  (b) =>
    /(^|[,{\s])\*\s*,/.test(b.corpo) &&
    /\*::before/.test(b.corpo) &&
    /\*::after/.test(b.corpo),
);

const faltando = oCuringa
  ? UNIVERSAL.filter(([, re]) => !re.test(oCuringa.corpo)).map(([nome]) => nome)
  : UNIVERSAL.map(([nome]) => nome);

console.log(
  `  ${blocosCalmos.length} bloco(s) de prefers-reduced-motion, em ${
    new Set(blocosCalmos.map((b) => b.arquivo)).size
  } folha(s)`,
);

const semCalma = [];
if (!oCuringa) {
  semCalma.push("não existe bloco que case `*`, `*::before` e `*::after`");
} else if (faltando.length) {
  semCalma.push(`o bloco universal não declara ${faltando.join(", ")} com !important`);
}

if (semCalma.length === 0) {
  console.log(
    "  ok      e o desligamento universal está de pé — nenhuma animação sobrevive a quem pediu que não houvesse\n",
  );
} else {
  for (const x of semCalma) console.error(`  FALHA   ${x}`);
  console.error(
    "\n  Sem esse bloco, as animações do projeto inteiro voltam para quem pediu que não houvesse" +
      " — e a tela continua perfeita para quem não ligou a preferência, então nada mais acusa.\n",
  );
}

/* ── e o dedo alcança? ───────────────────────────────────────────────────────

   Este projeto é MOBILE-FIRST por decisão, e alvo pequeno é o defeito de
   celular que menos aparece num monitor: no mouse ele acerta sempre.

   O piso é 44px, que é o do guia da Apple e o mais exigente dos dois grandes.
   A varredura pega as classes que aparecem em `<button>` nos componentes e
   confere `height`/`min-height` declarados nelas. Um botão sem altura fixa é
   dimensionado por padding e linha, e isso a varredura não calcula — ela mede o
   que está escrito, e diz quantos não deu para medir. */

const CHAO_PX = 44;

/* GRADE DENSA TEM PISO PRÓPRIO, e são 24px — o mínimo da WCAG 2.5.8 (AA).

   Um piso único de 44px é cego para a diferença entre um botão de ação e uma
   célula de tabela. O bloco de dedução do Dossiê tem 21 cartas × uma coluna por
   assento; a 44px de altura ele passaria de novecentos pixels só de células, e
   a pessoa rolaria o caderno inteiro para marcar um "x".

   As duas normas concordam com isso: 44px é o guia da Apple para ALVO SOLTO, e a
   própria WCAG separa 2.5.5 (AAA, 44px) de 2.5.8 (AA, 24px), com exceção
   explícita para controles em linha e agrupamentos densos.

   A lista é curta e cada entrada diz por quê. Ela existe para ser difícil de
   crescer: a tentação é jogar aqui todo botão que não coube, e aí o piso vira
   decoração. */
const DENSOS = new Map([
  ["cel", "célula do bloco de dedução: 21 cartas × um assento por coluna"],
]);
const CHAO_DENSO = 24;

const classesDeBotao = new Set();
for (const arq of [...tsx(join(raiz, "components")), ...tsx(join(raiz, "app"))]) {
  const texto = readFileSync(arq, "utf8");
  let i = 0;
  while ((i = texto.indexOf("<button", i)) >= 0) {
    const fim = fimDaTag(texto, i);
    if (fim < 0) break;
    for (const m of texto.slice(i, fim + 1).matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      for (const c of `${m[1] ?? ""} ${m[2] ?? ""}`.split(/[\s${}?:'"]+/)) {
        if (c && !c.includes(".") && !c.includes("(")) classesDeBotao.add(c);
      }
    }
    i = fim + 1;
  }
}

const baixinhos = [];
let medidos = 0;
for (const f of arquivosCss) {
  const texto = readFileSync(join(cssDir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
  for (const m of texto.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const seletor = m[1].trim().replace(/\s+/g, " ");
    if (seletor.startsWith("@")) continue;
    /* Só a classe sozinha, ou com estado: `.btn-mini` e `.btn-mini:hover` sim,
       `.painel .btn-mini` não — ali a altura pode ser um ajuste local em cima de
       uma base que já passa. */
    /* PSEUDO-ELEMENTO NUNCA É ALVO DE TOQUE, e a primeira versão desta
       varredura não sabia disso: ela acusou `.chip-prop` de ter 7px de altura,
       que é a bolinha colorida do `::before` — a decoração que diz o grupo da
       propriedade sem precisar ler o nome. O botão em volta tem o tamanho dele.

       Um `::` no seletor significa "isto é uma coisa desenhada dentro", e nada
       desenhado dentro recebe o dedo. */
    if (seletor.includes("::")) continue;
    const classe = /^\.([a-z][\w-]*)(?::[a-z-]+(?:\([^)]*\))?|\[[^\]]*\])*$/.exec(
      seletor,
    )?.[1];
    if (!classe || !classesDeBotao.has(classe)) continue;

    const alt = /(?:^|[;\s])(?:min-height|height)\s*:\s*([\d.]+)(px|rem)/.exec(m[2]);
    if (!alt) continue;
    medidos++;
    const px = Number(alt[1]) * (alt[2] === "rem" ? 16 : 1);
    const chao = DENSOS.has(classe) ? CHAO_DENSO : CHAO_PX;
    if (px < chao) baixinhos.push({ classe, arquivo: f, px, chao });
  }
}

console.log(
  `  ${classesDeBotao.size} classe(s) aparecem em <button>, ${medidos} com altura declarada`,
);

if (baixinhos.length === 0) {
  console.log(
    `  ok      nenhum alvo de toque abaixo de ${CHAO_PX}px` +
      ` (${DENSOS.size} de grade densa, no piso de ${CHAO_DENSO}px da WCAG 2.5.8)\n`,
  );
} else {
  for (const b of baixinhos) {
    console.error(
      `  FALHA   .${b.classe} tem ${b.px}px de altura em app/${b.arquivo} (piso ${b.chao}px)`,
    );
  }
  console.error(
    `\n  ${baixinhos.length} alvo(s) menores que ${CHAO_PX}px. No mouse acerta sempre; no polegar, não.\n`,
  );
}

/* ── e toda facção tem uma trama própria? ─────────────────────────────────────

   O Domínio pinta cada facção com a cor do avatar dela, e cor sozinha exclui
   quem não separa cores. O PRD 00 §110 promete "padrão de hachura associado
   para daltonismo", e o mapa cumpre: sete tramas em SVG, ligadas por
   [data-cor="x"] .ter-textura { fill: url(#tex-…) }.

   O que não existia era o GUARDA. A ligação mora no CSS e a paleta mora no
   TypeScript, e nada obriga as duas a andarem juntas: uma cor nova entra na
   paleta, ninguém lembra da trama, e duas facções voltam a ser distinguíveis só
   pela cor. Não quebra nada, não avisa nada, e some no meio de um mapa de 42
   territórios.

   TRÊS COISAS SE CONFEREM, e a segunda é a que eu quase esqueci:

     1. toda cor tem trama — menos UMA, a de referência, que fica lisa de
        propósito, porque "liso" também é um padrão;
     2. nenhuma trama se repete. Duas facções com a mesma hachura são, entre si,
        exatamente o caso que a hachura existe para evitar;
     3. e a trama que o CSS pede EXISTE no SVG. Um url(#tex-x) que não resolve
        não pinta nada — e o que aparece é uma facção lisa, calada, igual à de
        referência. */

const { COLORS } = await import("@/lib/avatar");

const cssDominio = readFileSync(join(cssDir, "dominio.css"), "utf8");
const tramaDe = new Map();
for (const m of cssDominio.matchAll(
  /\[data-cor="([a-z]+)"\]\s*\.ter-textura\s*\{[^}]*url\(#(tex-[a-z-]+)\)/g,
)) {
  tramaDe.set(m[1], m[2]);
}

/** A facção lisa. É UMA, e o nome está aqui porque comentário não é mecanismo. */
const LISA = "carmim";

const semTrama = Object.keys(COLORS).filter((c) => c !== LISA && !tramaDe.has(c));
if (semTrama.length === 0) {
  console.log(
    `  ok      as ${tramaDe.size} facções não-lisas têm trama própria, e a ${LISA} é lisa de propósito`,
  );
} else {
  console.error(
    `  FALHA   facção só com cor: ${semTrama.join(", ")} — sem hachura, quem não separa cores não separa elas`,
  );
}

const porTrama = new Map();
for (const [cor, tex] of tramaDe) porTrama.set(tex, [...(porTrama.get(tex) ?? []), cor]);
const colididas = [...porTrama.entries()].filter(([, cores]) => cores.length > 1);
if (colididas.length === 0) {
  console.log("  ok      e nenhuma trama se repete entre duas facções");
} else {
  for (const [tex, cores] of colididas) {
    console.error(
      `  FALHA   a trama ${tex} serve ${cores.join(" e ")} — as duas ficam iguais sem cor`,
    );
  }
}

const mapaSvg = readFileSync(join(raiz, "components", "dominio", "mapa.tsx"), "utf8");
const noSvg = new Set([...mapaSvg.matchAll(/<pattern\s+id="(tex-[a-z-]+)"/g)].map((m) => m[1]));
const orfasDeTrama = [...new Set(tramaDe.values())].filter((t) => !noSvg.has(t));
if (orfasDeTrama.length === 0) {
  console.log(`  ok      e as ${noSvg.size} tramas que o CSS pede existem no SVG do mapa\n`);
} else {
  console.error(
    `  FALHA   trama que não existe no SVG: ${orfasDeTrama.join(", ")} — a facção sai lisa\n`,
  );
}

/* ── e todo grupo da Metrópole também? ────────────────────────────────────────

   Mesma promessa, outro jogo, e o mesmo guarda faltando. Os oito grupos de
   propriedade da Capibara são identificados por cor na faixa do quadro, e a cor
   sozinha exclui a mesma gente.

   Aqui a textura vem de background-image e não de url(#…), então a checagem
   olha outra coisa — mas a pergunta é idêntica: existe um segundo canal, e ele
   é único por grupo?

   A FACÇÃO LISA TAMBÉM EXISTE AQUI, e é o marrom: o grupo mais barato do
   tabuleiro, o que menos precisa ser identificado de longe. Deixar UM liso é
   deliberado nos dois jogos — sem um liso de referência, o olho não tem contra
   o que comparar as tramas. */

const cssMet = readFileSync(join(cssDir, "metropole.css"), "utf8");
const texturaDoGrupo = new Map();
for (const m of cssMet.matchAll(
  /\.quadro-faixa\[data-g="([a-z-]+)"\]\s*\{([^}]*)\}/g,
)) {
  /* A chave é o VALOR INTEIRO da declaração, sem espaço em branco — e não o
     nome da função de gradiente. A primeira versão usava só o nome e acusou
     seis grupos de terem a mesma textura: todos usam
     `repeating-linear-gradient`, e o que os separa é o ÂNGULO — 45°, -45°, 90°,
     0°, e dois deles cruzados. Comparar pelo nome da função é responder "são os
     dois listrados?", que não é a pergunta. */
  const decl = /background-image\s*:\s*([\s\S]*?);/.exec(m[2])?.[1];
  const tamanho = /background-size\s*:\s*([^;]+)/.exec(m[2])?.[1] ?? "";
  if (decl) texturaDoGrupo.set(m[1], `${decl}|${tamanho}`.replace(/\s+/g, ""));
}

const grupos = JSON.parse(
  readFileSync(join(raiz, "lib", "metropole", "cidade.json"), "utf8"),
).grupos.map((g) => g.id);

const GRUPO_LISO = "marrom";

const gruposSemTextura = grupos.filter((g) => g !== GRUPO_LISO && !texturaDoGrupo.has(g));
if (gruposSemTextura.length === 0) {
  console.log(
    `  ok      os ${texturaDoGrupo.size} grupos não-lisos da Metrópole têm textura própria, e o ${GRUPO_LISO} é liso`,
  );
} else {
  console.error(
    `  FALHA   grupo só com cor: ${gruposSemTextura.join(", ")} — a faixa do quadro fica sem segundo canal`,
  );
}

const porTextura = new Map();
for (const [g, t] of texturaDoGrupo) porTextura.set(t, [...(porTextura.get(t) ?? []), g]);
const gruposColididos = [...porTextura.entries()].filter(([, gs]) => gs.length > 1);
if (gruposColididos.length === 0) {
  console.log("  ok      e nenhuma textura de grupo se repete\n");
} else {
  for (const [t, gs] of gruposColididos) {
    console.error(
      `  FALHA   ${gs.join(" e ")} usam a MESMA textura — ficam iguais sem cor\n` +
        `          ${t.slice(0, 88)}\n`,
    );
  }
}

process.exit(
  semCalma.length === 0 &&
  disputadas.length === 0 &&
  orfas.length === 0 &&
  anonimos.length === 0 &&
  fracos.length === 0 &&
  baixinhos.length === 0 &&
  semTrama.length === 0 &&
  colididas.length === 0 &&
  orfasDeTrama.length === 0 &&
  gruposSemTextura.length === 0 &&
  gruposColididos.length === 0
    ? 0
    : 1,
);
