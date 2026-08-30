/**
 * A aritmética da cor, num lugar só.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUE ISTO EXISTE
 *
 * `npm run css` lê o CÓDIGO-FONTE e pergunta: "esta regra pinta texto e fundo
 * ao mesmo tempo, e o par passa no piso da WCAG?". É a pergunta certa e ela
 * cobre o erro mais fácil de cometer — mas ela deixa de fora, e diz que deixa,
 * o caso mais comum de todos: **a cor vem de um pai**.
 *
 * Numa folha de estilo de verdade quase nenhum elemento pinta as duas coisas.
 * O painel pinta o fundo, a etiqueta lá dentro pinta o texto, e o par que a
 * pessoa enxerga não existe em regra nenhuma — ele nasce da ÁRVORE.
 *
 * Desde que `npm run smoke:render` passou a montar as telas de verdade, a
 * árvore existe. Este módulo é a metade da conta que as duas auditorias
 * dividem: resolver `var()`, virar hexadecimal, e a fórmula da WCAG.
 *
 * Ele NÃO é um navegador, e a diferença importa:
 *
 *   • estados (`:hover`, `:focus`, `::before`) são descartados — a auditoria
 *     olha a tela parada, e um seletor de estado pintaria um par que ninguém
 *     está vendo naquele instante
 *   • `@media` entra como se fosse regra normal, e aqui isso é seguro: este
 *     projeto não tem `prefers-color-scheme`, e as suas media queries mexem em
 *     movimento e largura, não em cor
 *   • cor com alfa, gradiente e imagem de fundo viram "não sei", e não um chute
 *
 * O que ele não souber vira contagem de puladas no relatório. "Zero problemas"
 * sem a cobertura ao lado é uma frase que mente.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Resolve `var(--x)` até chegar a um valor concreto, ou nulo se der volta. */
export function resolveVar(valor, tokens, profundidade = 0) {
  if (valor == null || profundidade > 8) return null;
  const m = /^var\(\s*(--[\w-]+)\s*(?:,([^)]*))?\)$/.exec(String(valor).trim());
  if (!m) return String(valor).trim();
  const achado = tokens.get(m[1]);
  if (achado !== undefined) return resolveVar(achado, tokens, profundidade + 1);
  return m[2] ? resolveVar(m[2], tokens, profundidade + 1) : null;
}

/** #rgb ou #rrggbb → [r,g,b]. Qualquer outra coisa vira nulo, de propósito. */
export function paraRgb(valor) {
  if (!valor) return null;
  const v = String(valor).trim().toLowerCase();
  if (v === "white") return [255, 255, 255];
  if (v === "black") return [0, 0, 0];
  let m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16));
  m = /^#([0-9a-f]{6})$/.exec(v);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  /* rgb(r g b) e rgb(r,g,b) SEM alfa. Com alfa a cor final depende do que está
     atrás, e chutar o fundo daria um número com cara de medida. */
  m = /^rgb\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*\)$/.exec(v);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

/**
 * Cor com alfa: `rgb(r g b / a)`, `rgba(...)` e `#rrggbbaa`.
 *
 * Devolve `{ rgb, alfa }`, e nunca a mistura — quem mistura é quem sabe o que
 * está atrás. Uma cor com alfa NÃO é uma cor: é uma instrução.
 */
export function paraRgba(valor) {
  if (!valor) return null;
  const v = String(valor).trim().toLowerCase();

  let m = /^#([0-9a-f]{8})$/.exec(v);
  if (m) {
    const n = [0, 2, 4, 6].map((i) => parseInt(m[1].slice(i, i + 2), 16));
    return { rgb: n.slice(0, 3), alfa: n[3] / 255 };
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)[\s,/]+([\d.]+)(%?)\s*\)$/.exec(v);
  if (m) {
    const a = Number(m[4]) / (m[5] === "%" ? 100 : 1);
    return { rgb: [1, 2, 3].map((i) => Math.round(Number(m[i]))), alfa: a };
  }
  const cheia = paraRgb(v);
  return cheia ? { rgb: cheia, alfa: 1 } : null;
}

/**
 * O que aparece quando uma cor com alfa cai em cima de outra opaca.
 *
 * Isto NÃO é chute: `a·frente + (1−a)·fundo` por canal é a conta que o
 * compositor faz, e ela é exata. É a mesma disciplina do dinheiro deste
 * projeto — o que dá para calcular, calcula-se; o que não dá vira nulo e sai na
 * contagem de puladas em vez de virar um número com cara de medida.
 *
 * O que continua sendo nulo: alfa sobre fundo desconhecido, gradiente e imagem.
 */
export function compoe(frente, fundo) {
  if (!frente) return null;
  if (frente.alfa >= 1) return frente.rgb;
  if (!fundo) return null;
  return frente.rgb.map((c, i) => Math.round(frente.alfa * c + (1 - frente.alfa) * fundo[i]));
}

export function luminancia([r, g, b]) {
  const f = (c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function razao(a, b) {
  const la = luminancia(a);
  const lb = luminancia(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Todos os `.css` de uma pasta, em ordem alfabética. */
export function arquivosDeCss(dir) {
  return readdirSync(dir).filter((f) => f.endsWith(".css")).sort();
}

/** `--x: valor` de todos os arquivos. O primeiro a declarar manda. */
export function tokensDeCss(dir, arquivos = arquivosDeCss(dir)) {
  const tokens = new Map();
  for (const f of arquivos) {
    const texto = semComentarios(readFileSync(join(dir, f), "utf8"));
    for (const m of texto.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) {
      if (!tokens.has(m[1])) tokens.set(m[1], m[2].trim());
    }
  }
  return tokens;
}

export function semComentarios(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, " ");
}

/* ── o seletor, na parte dele que dá para casar sem navegador ───────────────
   Um seletor vira uma lista de COMPOSTOS separados por combinador. Cada
   composto é uma tag opcional mais classes, ids e atributos.

   Pseudo-classe e pseudo-elemento derrubam o seletor inteiro: `:hover` pinta um
   par que ninguém está vendo na tela parada, e cobrar contraste dele seria
   cobrar de uma tela que não existe. */
function compostoDe(texto) {
  if (/::|:(?!root\b)/.test(texto)) return null;
  const parte = { tag: null, classes: [], ids: [], attrs: [] };
  const resto = texto.replace(/:root\b/g, "html");
  const re = /^([a-zA-Z][\w-]*)|\.([\w-]+)|#([\w-]+)|\[([\w-]+)(?:([~^|$*]?=)"?([^\]"]*)"?)?\]/g;
  let consumido = 0;
  let m;
  while ((m = re.exec(resto))) {
    if (m.index !== consumido) return null;
    consumido = re.lastIndex;
    if (m[1]) parte.tag = m[1].toLowerCase();
    else if (m[2]) parte.classes.push(m[2]);
    else if (m[3]) parte.ids.push(m[3]);
    else parte.attrs.push({ nome: m[4], op: m[5] ?? null, valor: m[6] ?? null });
    re.lastIndex = consumido;
  }
  if (consumido !== resto.length) return null;
  if (!parte.tag && !parte.classes.length && !parte.ids.length && !parte.attrs.length) return null;
  return parte;
}

/** `.a .b > c` → [{parte, combinador}], ou nulo quando não dá para casar. */
export function partesDoSeletor(seletor) {
  const pedacos = seletor.trim().split(/\s*(>)\s*|\s+/).filter(Boolean);
  const saida = [];
  let combinador = " ";
  for (const p of pedacos) {
    if (p === ">") {
      combinador = ">";
      continue;
    }
    const parte = compostoDe(p);
    if (!parte) return null;
    saida.push({ parte, combinador });
    combinador = " ";
  }
  return saida.length ? saida : null;
}

/**
 * `font-size` em pixels, quando dá para saber.
 *
 * `clamp(min, ideal, max)` vira o MÍNIMO, e a escolha não é arbitrária: é o
 * menor tamanho em que aquele texto chega a aparecer, e o piso da WCAG é sobre
 * o pior caso. Chutar o ideal daria à auditoria uma tela de desktop que o
 * celular não tem.
 *
 * `em` e `%` dependem do pai e viram nulo — herdar do pai é conta de quem tem a
 * árvore, e chutar 16px aqui seria inventar.
 */
export function tamanhoEmPx(valor) {
  if (!valor) return null;
  const v = String(valor).trim().toLowerCase();
  const clamp = /^clamp\(([^,]+),/.exec(v);
  const alvo = clamp ? clamp[1].trim() : v;
  const m = /^([\d.]+)(px|rem)$/.exec(alvo);
  if (!m) return null;
  return Number(m[1]) * (m[2] === "rem" ? 16 : 1);
}

function especificidade(partes) {
  let a = 0;
  let b = 0;
  let c = 0;
  for (const { parte } of partes) {
    a += parte.ids.length;
    b += parte.classes.length + parte.attrs.length;
    c += parte.tag ? 1 : 0;
  }
  return a * 10000 + b * 100 + c;
}

/**
 * As regras que pintam cor ou fundo, prontas para casar contra uma árvore.
 * Cada uma guarda a especificidade e a ordem de origem — é o desempate do
 * navegador, e sem ele a última regra do arquivo ganharia de uma mais forte.
 */
export function regrasDeCor(dir, arquivos = arquivosDeCss(dir)) {
  const regras = [];
  let ordem = 0;
  for (const f of arquivos) {
    const texto = semComentarios(readFileSync(join(dir, f), "utf8"));
    for (const m of texto.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const cabeca = m[1].trim().replace(/\s+/g, " ");
      const corpo = m[2];
      if (cabeca.startsWith("@") || !cabeca) continue;

      const cor = /(?:^|[;\s])color\s*:\s*([^;]+)/.exec(corpo)?.[1]?.trim() ?? null;
      const fundo =
        /(?:^|[;\s])background-color\s*:\s*([^;]+)/.exec(corpo)?.[1]?.trim() ??
        /(?:^|[;\s])background\s*:\s*([^;]+)/.exec(corpo)?.[1]?.trim() ??
        null;
      const px = tamanhoEmPx(/(?:^|[;\s])font-size\s*:\s*([^;]+)/.exec(corpo)?.[1]);
      const negrito = /font-weight\s*:\s*(?:bold|[6-9]00)/.test(corpo)
        ? true
        : /font-weight\s*:\s*(?:normal|[1-5]00)/.test(corpo)
          ? false
          : null;

      /* TAMANHO CONTA COMO DECLARAÇÃO. O piso da WCAG cai de 4,5 para 3 em
         texto grande, e quem declara o tamanho quase nunca é quem declara a
         cor: no relógio do Letreiro, `.clock-num` diz o tamanho e
         `.clock[data-urgent] .clock-num` diz a cor. Ler o tamanho só da regra
         que pintou faz a auditoria cobrar 4,5 de um número de 27px em negrito,
         e reprovar o que está certo. */
      if (!cor && !fundo && px === null && negrito === null) continue;

      for (const um of cabeca.split(",")) {
        const partes = partesDoSeletor(um);
        if (!partes) continue;
        regras.push({
          arquivo: f,
          seletor: um.trim(),
          partes,
          espec: especificidade(partes),
          ordem: ordem++,
          cor,
          fundo,
          px,
          negrito,
        });
      }
    }
  }
  return regras;
}

/* ── casar ──────────────────────────────────────────────────────────────── */

function bateComposto(parte, el) {
  if (parte.tag && parte.tag !== el.tag) return false;
  for (const c of parte.classes) if (!el.classes.has(c)) return false;
  for (const i of parte.ids) if (el.id !== i) return false;
  for (const a of parte.attrs) {
    const v = el.attrs[a.nome];
    if (v === undefined) return false;
    if (a.op === "=" && v !== a.valor) return false;
    if (a.op && a.op !== "=" && !String(v).includes(a.valor ?? "")) return false;
  }
  return true;
}

/**
 * O seletor casa com o último elemento de `pilha` (a folha), lendo da direita
 * para a esquerda como o navegador faz.
 */
export function bate(partes, pilha) {
  let i = partes.length - 1;
  let j = pilha.length - 1;
  if (!bateComposto(partes[i].parte, pilha[j])) return false;
  i--;
  j--;
  while (i >= 0) {
    const { parte, combinador } = partes[i + 1];
    void parte;
    if (combinador === ">") {
      if (j < 0 || !bateComposto(partes[i].parte, pilha[j])) return false;
      i--;
      j--;
      continue;
    }
    let achou = false;
    while (j >= 0) {
      if (bateComposto(partes[i].parte, pilha[j])) {
        achou = true;
        j--;
        break;
      }
      j--;
    }
    if (!achou) return false;
    i--;
  }
  return true;
}

/**
 * A cor e o fundo que este elemento DECLARA — o que ele herda é conta de quem
 * chama, porque só quem tem a árvore sabe de quem herdar.
 */
export function declaradas(regras, pilha, tokens) {
  let cor = null;
  let fundo = null;
  let px = null;
  let negrito = null;
  let melhorCor = -1;
  let melhorFundo = -1;
  let melhorPx = -1;
  let melhorNegrito = -1;
  for (const r of regras) {
    if (!bate(r.partes, pilha)) continue;
    const peso = r.espec * 1e6 + r.ordem;
    if (r.cor && peso > melhorCor) {
      melhorCor = peso;
      cor = { valor: r.cor, regra: r };
    }
    if (r.fundo && peso > melhorFundo) {
      melhorFundo = peso;
      fundo = { valor: r.fundo, regra: r };
    }
    /* CADA PROPRIEDADE CASCATEIA SOZINHA, e é isso que o navegador faz: o
       tamanho pode vir de uma regra e a cor de outra, no mesmo elemento. */
    if (r.px !== null && peso > melhorPx) {
      melhorPx = peso;
      px = r.px;
    }
    if (r.negrito !== null && peso > melhorNegrito) {
      melhorNegrito = peso;
      negrito = r.negrito;
    }
  }

  /* O `style=` do elemento ganha de tudo, e neste projeto ele existe: a cor de
     uma facção e a de um grupo de propriedades vêm do dado, não da folha. */
  const inline = pilha[pilha.length - 1].attrs.style;
  if (inline) {
    const c = /(?:^|[;\s])color\s*:\s*([^;]+)/.exec(inline)?.[1]?.trim();
    const f =
      /(?:^|[;\s])background-color\s*:\s*([^;]+)/.exec(inline)?.[1]?.trim() ??
      /(?:^|[;\s])background\s*:\s*([^;]+)/.exec(inline)?.[1]?.trim();
    if (c) cor = { valor: c, regra: { seletor: "style=", arquivo: "—" } };
    if (f) fundo = { valor: f, regra: { seletor: "style=", arquivo: "—" } };
  }

  /* Sai com alfa e tudo. Compor é decisão de quem tem a árvore: só ele sabe o
     que está atrás. */
  const inlineTam = inline
    ? tamanhoEmPx(/(?:^|[;\s])font-size\s*:\s*([^;]+)/.exec(inline)?.[1])
    : null;

  return {
    cor: cor ? { ...cor, rgba: paraRgba(resolveVar(cor.valor, tokens)) } : null,
    fundo: fundo ? { ...fundo, rgba: paraRgba(resolveVar(fundo.valor, tokens)) } : null,
    px: inlineTam ?? px,
    negrito,
  };
}
