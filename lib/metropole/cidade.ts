import dados from "@/lib/metropole/cidade.json";

/**
 * Capibara — o tabuleiro da Metrópole.
 *
 * Os DADOS moram em `cidade.json`, gerados e validados por `npm run cidade`, e
 * é o mesmo arquivo que o servidor publica em `game_themes`. Aqui em cima
 * ficam só o tipo e as contas que a TELA precisa fazer — nenhuma delas
 * autoriza jogada: o servidor recalcula tudo. Estas existem para a interface
 * poder mostrar o número ANTES do toque, que é o que separa uma decisão de uma
 * aposta.
 */

export type GrupoId =
  | "marrom"
  | "azul-claro"
  | "rosa"
  | "laranja"
  | "vermelho"
  | "amarelo"
  | "verde"
  | "azul-escuro";

export type Grupo = { id: GrupoId; nome: string; cor: string; casa: number };

export type Tipo =
  | "largada"
  | "bairro"
  | "transporte"
  | "companhia"
  | "sorte"
  | "reves"
  | "imposto"
  | "taxa"
  | "cadeia"
  | "va-cadeia"
  | "praca";

export type Casa = {
  pos: number;
  t: Tipo;
  nome: string;
  nota?: string;
  id?: string;
  g?: GrupoId;
  preco?: number;
  /** bairro: [base, 1 casa, 2, 3, 4, hotel] · transporte: por quantos o dono tem */
  aluguel?: number[];
  /** companhia: multiplicador sobre a soma dos dados, por companhias possuídas */
  multiplo?: number[];
  casa?: number;
  hipoteca?: number;
  valor?: number;
};

export type Carta = { k: string; texto: string; casa?: number; n?: number; tipo?: string };

export const REGRAS = dados.regras as {
  salario: number;
  bancoInicial: number;
  fiancaCadeia: number;
  casasNoBanco: number;
  hoteisNoBanco: number;
  jurosResgate: number;
  rodadasMetropole: number;
  rodadasRelampago: number;
  sorteioMetropole: number;
  sorteioRelampago: number;
  lanceMinimo: number;
};

export const GRUPOS = dados.grupos as Grupo[];
export const CASAS = dados.casas as Casa[];

export const POR_ID: Record<string, Casa> = Object.fromEntries(
  CASAS.filter((c) => c.id).map((c) => [c.id!, c]),
);

export const GRUPO_POR_ID: Record<string, Grupo> = Object.fromEntries(
  GRUPOS.map((g) => [g.id, g]),
);

export const DO_GRUPO: Record<GrupoId, Casa[]> = GRUPOS.reduce(
  (acc, g) => {
    acc[g.id] = CASAS.filter((c) => c.g === g.id);
    return acc;
  },
  {} as Record<GrupoId, Casa[]>,
);

/** Dinheiro em português, sem centavos — o jogo não tem centavo. */
export function reais(n: number): string {
  const sinal = n < 0 ? "−" : "";
  return `${sinal}R$ ${Math.abs(Math.round(n)).toLocaleString("pt-BR")}`;
}

/* ── a volta do tabuleiro, em onze por onze ─────────────────────────────────
   A casa 0 é o canto de baixo à direita, e a contagem sobe pela borda de baixo
   para a esquerda — como no tabuleiro de mesa, onde o peão anda no sentido
   anti-horário visto de cima. */

export const LADO = 11;

export function naGrade(pos: number): { col: number; row: number } {
  const p = ((pos % 40) + 40) % 40;
  if (p <= 10) return { col: 10 - p, row: 10 };
  if (p <= 20) return { col: 0, row: 10 - (p - 10) };
  if (p <= 30) return { col: p - 20, row: 0 };
  return { col: 10, row: p - 30 };
}

/** Em que borda a casa fica — decide se o rótulo deita ou fica de pé. */
export function borda(pos: number): "baixo" | "esquerda" | "topo" | "direita" | "canto" {
  const p = ((pos % 40) + 40) % 40;
  if (p % 10 === 0) return "canto";
  if (p < 10) return "baixo";
  if (p < 20) return "esquerda";
  if (p < 30) return "topo";
  return "direita";
}

/* ── estado, do lado da tela ────────────────────────────────────────────── */

export type PropEstado = {
  owner: number | null;
  casas: number;
  hotel: boolean;
  hipotecada: boolean;
};

export type Props = Record<string, PropEstado>;

export function grupoCompleto(props: Props, seat: number, grupo: GrupoId): boolean {
  return DO_GRUPO[grupo].every((c) => props[c.id!]?.owner === seat);
}

export function quantosDoTipo(props: Props, seat: number, tipo: Tipo): number {
  return CASAS.filter((c) => c.t === tipo && props[c.id!]?.owner === seat).length;
}

/**
 * O aluguel que esta propriedade cobra AGORA.
 *
 * Espelha `met_aluguel` no servidor. Se as duas divergirem, a tela promete um
 * número e o jogo cobra outro — então as duas mudam juntas, sempre.
 */
export function aluguelAtual(props: Props, prop: string, soma = 7): number {
  const casa = POR_ID[prop];
  const est = props[prop];
  if (!casa || !est || est.owner === null || est.hipotecada) return 0;

  if (casa.t === "bairro") {
    if (est.hotel) return casa.aluguel![5];
    if (est.casas > 0) return casa.aluguel![est.casas];
    return grupoCompleto(props, est.owner, casa.g!)
      ? casa.aluguel![0] * 2
      : casa.aluguel![0];
  }
  if (casa.t === "transporte") {
    const q = quantosDoTipo(props, est.owner, "transporte");
    return casa.aluguel![Math.max(q - 1, 0)];
  }
  if (casa.t === "companhia") {
    const q = quantosDoTipo(props, est.owner, "companhia");
    return casa.multiplo![Math.min(Math.max(q - 1, 0), 1)] * soma;
  }
  return 0;
}

export function patrimonio(props: Props, seat: number, cash: number): number {
  let total = cash;
  for (const c of CASAS) {
    if (!c.id) continue;
    const e = props[c.id];
    if (!e || e.owner !== seat) continue;
    total += e.hipotecada ? c.preco! / 2 : c.preco!;
    if (c.t === "bairro") {
      total += (c.casa ?? 0) * (e.hotel ? 5 : e.casas);
    }
  }
  return total;
}

/* ══════════════════════════════════════════════════════════════════════════
   ONDE O PEÃO PARA, EM MÉDIA

   O painel de fluxo de caixa promete aluguel ESPERADO, e um número esperado
   feito com 1/40 por casa seria mentira: o tabuleiro não é uniforme. A Cadeia
   é a casa mais visitada de todas — porque três coisas mandam para lá — e as
   casas logo depois dela recebem muito mais visita que a média.

   Então a distribuição é calculada de verdade, uma vez, no carregamento do
   módulo. É uma cadeia de Markov de 40 estados:

     · de cada casa, a soma de dois dados (2 a 12, com pesos 1..6..1 sobre 36)
     · a casa 30 ("Vá para a Cadeia") manda para a 10
     · as casas de carta mandam para onde as cartas mandam, cada uma com 1/16

   e a distribuição estacionária sai por iteração de potência — multiplicar o
   vetor pela matriz até parar de mudar. Cem iterações resolvem com folga; é
   uma matriz 40 × 40, custa menos que um layout de página.

   O que fica de fora: duplos, e a regra dos três duplos. O efeito nos números
   é de fração de ponto percentual, e incluir isso exigiria dobrar o número de
   estados (posição × quantos duplos), o que não paga.
   ══════════════════════════════════════════════════════════════════════════ */

const PESO_DADOS: [number, number][] = (() => {
  const conta = new Map<number, number>();
  for (let a = 1; a <= 6; a++) {
    for (let b = 1; b <= 6; b++) {
      conta.set(a + b, (conta.get(a + b) ?? 0) + 1);
    }
  }
  return [...conta.entries()].map(([soma, n]) => [soma, n / 36] as [number, number]);
})();

/** Para onde uma carta desta casa manda o peão, sem reencaminhar ainda. */
function destinosDeCarta(pos: number, qual: "sorte" | "reves"): Map<number, number> {
  const baralho = (qual === "sorte" ? dados.sorte : dados.reves) as Carta[];
  const out = new Map<number, number>();
  const peso = 1 / baralho.length;

  const soma = (onde: number, p: number) => out.set(onde, (out.get(onde) ?? 0) + p);

  for (const c of baralho) {
    if (c.k === "anda") soma(c.casa!, peso);
    else if (c.k === "anda-tras") soma((((pos - c.n!) % 40) + 40) % 40, peso);
    else if (c.k === "cadeia") soma(10, peso);
    else if (c.k === "proximo") {
      const alvo =
        CASAS.filter((x) => x.t === c.tipo).find((x) => x.pos > pos) ??
        CASAS.filter((x) => x.t === c.tipo)[0];
      soma(alvo.pos, peso);
    } else {
      // a carta não move ninguém: fica onde está
      soma(pos, peso);
    }
  }
  return out;
}

/**
 * Onde o peão REALMENTE fica depois de cair em `pos`, com pesos.
 *
 * A recursão não é elegância: é necessária, e a conferência do modelo é que
 * mostrou isso. Uma carta de Revés manda "volte três casas"; da casa 33 isso
 * cai na 30, que é "Vá para a Cadeia". Sem reencaminhar, o modelo dizia que o
 * peão passa 0,16% do tempo parado numa casa onde é impossível ficar — e a
 * Cadeia, que é a casa mais visitada do tabuleiro, aparecia subestimada.
 *
 * O servidor (`met_pousa`) já fazia isso, com o mesmo limite de profundidade
 * 3. Aqui era o cliente que estava um passo atrás — e a tela ia prometer um
 * aluguel esperado calculado sobre uma distribuição errada.
 */
function depoisDeParar(pos: number, prof = 0): Map<number, number> {
  if (pos === 30) return prof < 3 ? depoisDeParar(10, prof + 1) : new Map([[10, 1]]);

  const casa = CASAS[pos];
  const ehCarta = casa.t === "sorte" || casa.t === "reves";
  if (!ehCarta || prof >= 3) return new Map([[pos, 1]]);

  const bruto = destinosDeCarta(pos, casa.t as "sorte" | "reves");
  const out = new Map<number, number>();
  for (const [destino, peso] of bruto) {
    // o destino da carta é resolvido de novo: pode ser outra casa de carta,
    // ou o próprio "Vá para a Cadeia"
    const alvo = destino === pos ? new Map([[pos, 1]]) : depoisDeParar(destino, prof + 1);
    for (const [fim, q] of alvo) {
      out.set(fim, (out.get(fim) ?? 0) + peso * q);
    }
  }
  return out;
}

/** Distribuição estacionária: quanto do tempo o peão passa em cada casa. */
export const PARADA: number[] = (() => {
  // matriz de transição
  const M: number[][] = Array.from({ length: 40 }, () => new Array(40).fill(0));
  for (let i = 0; i < 40; i++) {
    for (const [soma, p] of PESO_DADOS) {
      const cai = (i + soma) % 40;
      for (const [fim, q] of depoisDeParar(cai)) {
        M[i][fim] += p * q;
      }
    }
  }

  let v = new Array(40).fill(1 / 40);
  for (let passo = 0; passo < 200; passo++) {
    const prox = new Array(40).fill(0);
    for (let i = 0; i < 40; i++) {
      if (v[i] === 0) continue;
      for (let j = 0; j < 40; j++) {
        if (M[i][j] !== 0) prox[j] += v[i] * M[i][j];
      }
    }
    v = prox;
  }
  const soma = v.reduce((a, b) => a + b, 0);
  return v.map((x) => x / soma);
})();

/** Chance de o peão parar nesta propriedade numa parada qualquer. */
export function chanceDeParar(prop: string): number {
  const casa = POR_ID[prop];
  return casa ? PARADA[casa.pos] : 0;
}

/**
 * O fluxo de caixa por volta, para o painel.
 *
 * Uma volta são ~40/7 ≈ 5,7 paradas (o passo médio de dois dados é 7). O
 * aluguel esperado é a soma, sobre todas as propriedades, de
 * (chance de parar) × (aluguel de lá) × (paradas por volta).
 *
 * A receber conta as SUAS propriedades e a chance de QUALQUER UM dos outros
 * parar nelas; a pagar conta as dos outros e a chance de VOCÊ parar lá.
 */
export const PARADAS_POR_VOLTA = 40 / 7;

export function fluxo(
  props: Props,
  seat: number,
  cash: number,
  quantosJogam: number,
): {
  patrimonio: number;
  emPropriedades: number;
  emConstrucoes: number;
  receber: number;
  pagar: number;
  saldo: number;
  /** rodadas até o caixa acabar no ritmo atual, ou null se o saldo é positivo */
  rodadasDeSobrevida: number | null;
} {
  let emPropriedades = 0;
  let emConstrucoes = 0;
  let receber = 0;
  let pagar = 0;

  for (const c of CASAS) {
    if (!c.id) continue;
    const e = props[c.id];
    if (!e || e.owner === null) continue;

    const esperado = chanceDeParar(c.id) * aluguelAtual(props, c.id) * PARADAS_POR_VOLTA;

    if (e.owner === seat) {
      emPropriedades += e.hipotecada ? c.preco! / 2 : c.preco!;
      if (c.t === "bairro") emConstrucoes += (c.casa ?? 0) * (e.hotel ? 5 : e.casas);
      // cada um dos outros dá uma volta por rodada
      receber += esperado * Math.max(quantosJogam - 1, 0);
    } else {
      pagar += esperado;
    }
  }

  const saldo = REGRAS.salario + receber - pagar;
  return {
    patrimonio: cash + emPropriedades + emConstrucoes,
    emPropriedades,
    emConstrucoes,
    receber,
    pagar,
    saldo,
    rodadasDeSobrevida: saldo >= 0 ? null : Math.max(0, Math.floor(cash / -saldo)),
  };
}
