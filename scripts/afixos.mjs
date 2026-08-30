/**
 * Expansão de afixos do Hunspell.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O DEFEITO QUE ISTO CONSERTA
 *
 * O `.dic` do Hunspell não é uma lista de palavras: é uma lista de LEMAS com
 * marcas. `sopa` não está lá — está `sopar/ajkLMY`, e as regras do `.aff`
 * dizem que a marca `a` gera `sopa`. Quem lê só o lema perde tudo o que as
 * marcas geram.
 *
 * Medido antes de escrever esta linha: das cinco mil formas mais faladas do
 * português brasileiro, com três a sete letras, **41,6% não estavam no
 * dicionário do jogo**. Nos quinhentos primeiros postos — as palavras que
 * qualquer pessoa usa em qualquer frase — faltavam 27%.
 *
 *   ESTA COMO FOI SUA VOU ELES TENHO ESTAVA CERTO SOU POSSO ACHO ESTÃO VOCÊS
 *   ESSA TEMOS ESTAMOS TINHA ANTES PRECISO APENAS FAZENDO ACHA FEZ SOPA
 *   ESQUINA TROCO AMIGA AMANHÃ VAZIO ERRADO CALMO
 *
 * Duas em cada cinco palavras que alguém digita numa partida seriam recusadas
 * com "não é palavra". Depois da expansão, sobram 8% — e o que sobra é quase
 * todo nome próprio inglês de legenda: THE, SAM, CHARLIE, BEN, STEVE, SARAH.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O FORMATO, em uma passada
 *
 *   PFX Â Y 1                 cabeçalho: marca Â, cruza com sufixo, 1 regra
 *   PFX Â   0     des     .   tira nada, põe "des", em qualquer base
 *
 *   SFX a Y 42                cabeçalho: marca a, 42 regras
 *   SFX a   ar    a       ar  tira "ar", põe "a", se a base termina em "ar"
 *
 * A condição é um pedaço de expressão regular — `.`, `[^aeiou]`, `ar` — presa
 * ao FIM da base para sufixo e ao COMEÇO para prefixo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O QUE ESTA IMPLEMENTAÇÃO NÃO FAZ, de propósito
 *
 * Não cruza prefixo com sufixo, mesmo quando o cabeçalho diz `Y`. O cruzamento
 * multiplica: cada prefixo vezes cada sufixo, e o ganho medido é de formas como
 * "desamigarmos", que ninguém traça numa grade de dezesseis letras. Prefixo e
 * sufixo entram cada um sobre o lema, e para.
 *
 * Também não trata marcas de continuação (o `/FLAGS` que pode vir colado no que
 * a regra ACRESCENTA). Elas geram um segundo nível de derivação, com o mesmo
 * problema de multiplicação e o mesmo ganho pequeno.
 *
 * O Hunspell é um corretor ortográfico: ele prefere aceitar demais a recusar de
 * menos, e por isso gera formas que ninguém escreve — CASAMENTE, ROUPAMENTO,
 * ANDIR. Numa mesa de Letreiro, aceitar demais é o erro barato: recusar CERTO,
 * ANTES e SOPA é o caro.
 */

/**
 * Lê o `.aff` e devolve `marca → [regra]`.
 *
 * Aceita `SFX` e `PFX` no mesmo mapa porque cada regra carrega o próprio tipo —
 * uma marca nunca é os dois, e separar os mapas só faria o chamador escolher
 * entre eles antes de saber qual é.
 */
export function regrasDeAfixo(aff) {
  const regras = new Map();
  let marca = null;
  let faltam = 0;

  for (const linha of aff.split(/\r?\n/)) {
    const p = linha.split(/\s+/).filter(Boolean);
    if (p.length < 4 || (p[0] !== "SFX" && p[0] !== "PFX")) continue;

    /* O cabeçalho se distingue da regra pelo terceiro campo: `Y` ou `N` no
       cabeçalho, o que TIRAR na regra. Um `.aff` com uma regra que tira
       literalmente "Y" quebraria isto — não existe, porque o campo é uma
       terminação de palavra e nenhuma palavra do português termina em Y. */
    if (/^[YN]$/.test(p[2])) {
      marca = p[1];
      faltam = Number(p[3]);
      if (!regras.has(marca)) regras.set(marca, []);
      continue;
    }
    if (!marca || faltam <= 0) continue;

    regras.get(marca).push({
      tipo: p[0],
      tira: p[2] === "0" ? "" : p[2],
      /* O que se acrescenta pode vir com marcas de continuação coladas
         (`ão/BQ`). Elas ficam de fora — ver o cabeçalho. */
      poe: (p[3] === "0" ? "" : p[3]).split("/")[0],
      cond: p[4] === undefined || p[4] === "." ? null : p[4],
    });
    faltam--;
  }
  return regras;
}

/**
 * Todas as formas de um lema: ele mesmo, mais o que cada marca gera.
 *
 * Devolve com repetição possível — duas marcas podem gerar a mesma forma, e
 * quem chama já está montando um `Set`. Filtrar aqui seria trabalho pago duas
 * vezes.
 */
export function expande(base, flags, regras) {
  const saida = [base];
  if (!flags) return saida;

  for (const marca of flags) {
    for (const r of regras.get(marca) ?? []) {
      if (r.tipo === "SFX") {
        if (r.cond && !new RegExp(r.cond + "$").test(base)) continue;
        if (r.tira && !base.endsWith(r.tira)) continue;
        saida.push(base.slice(0, base.length - r.tira.length) + r.poe);
      } else {
        if (r.cond && !new RegExp("^" + r.cond).test(base)) continue;
        if (r.tira && !base.startsWith(r.tira)) continue;
        saida.push(r.poe + base.slice(r.tira.length));
      }
    }
  }
  return saida;
}
