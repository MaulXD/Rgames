/**
 * Nível, XP e conquistas — a parte do cliente.
 *
 * Quem CREDITA é o servidor, no fim da partida (migração 0016). Aqui só se lê
 * e se desenha: se o cliente pudesse dar XP, o placar da vida inteira viraria
 * enfeite.
 */

export type Stats = {
  xp?: number;
  partidas?: number;
  vitorias?: number;
  palavras?: number;
  melhor?: { w: string; pts: number };
  /**
   * A palavra mais rara já achada, e o posto dela na lista de frequência de
   * fala. Posto MAIOR é mais raro — e só entram palavras que TÊM posto: sem
   * posto, o corpus nunca ouviu a palavra, e aí ela não é troféu, é ruído
   * (ver 0094).
   */
  rara?: { w: string; posto: number };
  /**
   * O aproveitamento, guardado como FRAÇÃO e não como porcentagem.
   *
   * `melhorNum/melhorDen` é a melhor rodada; `pontos/teto` são os totais de
   * vida. Média de porcentagens não é a porcentagem da soma, e é por isso que
   * o servidor guarda as duas frações inteiras e quem divide é a tela, uma vez.
   */
  aproveita?: { melhorNum: number; melhorDen: number; pontos: number; teto: number };
  conquistas?: string[];
};

/** Uma fração em porcentagem inteira, ou nulo quando ainda não há o que dividir. */
export function pct(num?: number, den?: number): number | null {
  if (!den || den <= 0) return null;
  return Math.round(((num ?? 0) * 100) / den);
}

/** Cada nível custa um pouco mais que o anterior — curva de raiz, não linear. */
const CUSTO = 60;

export function nivel(xp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, xp) / CUSTO)) + 1;
}

export function xpDoNivel(n: number): number {
  return Math.pow(Math.max(1, n) - 1, 2) * CUSTO;
}

/** Onde a pessoa está dentro do nível atual: 0 a 1. */
export function progresso(xp: number): { nivel: number; faltam: number; fracao: number } {
  const n = nivel(xp);
  const base = xpDoNivel(n);
  const topo = xpDoNivel(n + 1);
  return {
    nivel: n,
    faltam: Math.max(0, topo - xp),
    fracao: topo === base ? 1 : Math.min(1, Math.max(0, (xp - base) / (topo - base))),
  };
}

/** Nome do nível. Sobe de patente em vez de só mostrar um número. */
export function patente(n: number): string {
  if (n >= 20) return "Lenda da mesa";
  if (n >= 15) return "Cabeça de chave";
  if (n >= 11) return "Veterano";
  if (n >= 8) return "Figurinha carimbada";
  if (n >= 5) return "Habitué";
  if (n >= 3) return "Já sabe as regras";
  return "Chegou agora";
}

export type Conquista = {
  id: string;
  nome: string;
  como: string;
  glifo: Glifo;
  cor: string;
};

export type Glifo = "estrela" | "raio" | "coroa" | "chave" | "lua" | "olho" | "bussola" | "fogo";

export const CONQUISTAS: Conquista[] = [
  {
    id: "primeira-palavra",
    nome: "Primeira palavra",
    como: "Achou a primeira palavra da vida no Letreiro.",
    glifo: "estrela",
    cor: "#FFC42E",
  },
  {
    id: "oito-letras",
    nome: "Oito letras",
    como: "Achou uma palavra de oito letras ou mais.",
    glifo: "raio",
    cor: "#A8E827",
  },
  {
    id: "palavra-qu",
    nome: "Caçador de QU",
    como: "Usou a face QU numa palavra. Ela vale seis pontos.",
    glifo: "chave",
    cor: "#2FD8C4",
  },
  {
    id: "meia-grade",
    nome: "Metade da grade",
    como: "Fez metade da pontuação possível de uma grade.",
    glifo: "bussola",
    cor: "#2E8CFF",
  },
  {
    id: "cem-palavras",
    nome: "Cem palavras",
    como: "Achou cem palavras somando todas as partidas.",
    glifo: "fogo",
    cor: "#FF8A2B",
  },
  {
    id: "quinhentas-palavras",
    nome: "Quinhentas palavras",
    como: "Achou quinhentas palavras somando todas as partidas.",
    glifo: "coroa",
    cor: "#FF4D5E",
  },
  {
    id: "caso-fechado",
    nome: "Caso encerrado",
    como: "Fechou um caso no Dossiê acertando os três.",
    glifo: "olho",
    cor: "#B25CFF",
  },
  {
    id: "virou-fantasma",
    nome: "Fantasma",
    como: "Errou a acusação e continuou refutando. Faz parte.",
    glifo: "lua",
    cor: "#7BA392",
  },
  {
    id: "general",
    nome: "General",
    como: "Cumpriu o objetivo secreto e venceu uma partida de Domínio.",
    glifo: "coroa",
    cor: "#FFC42E",
  },
  {
    id: "assalto-perfeito",
    nome: "Assalto perfeito",
    como: "Tirou três baixas do defensor numa única rolagem. Um em vinte e sete.",
    glifo: "raio",
    cor: "#FF4D5E",
  },
  {
    id: "dia-cheio",
    nome: "Dia cheio",
    como: "Achou quinze palavras ou mais num desafio diário.",
    glifo: "estrela",
    cor: "#2FD8C4",
  },
  {
    id: "prefeito",
    nome: "Prefeito",
    como: "Terminou a Metrópole com o maior patrimônio da cidade.",
    glifo: "coroa",
    cor: "#F2C14E",
  },
];

export function parseStats(raw: unknown): Stats {
  const s = (raw ?? {}) as Stats;
  return {
    xp: Number(s.xp ?? 0),
    partidas: Number(s.partidas ?? 0),
    vitorias: Number(s.vitorias ?? 0),
    palavras: Number(s.palavras ?? 0),
    melhor: s.melhor,
    rara: s.rara,
    aproveita: s.aproveita,
    conquistas: Array.isArray(s.conquistas) ? s.conquistas : [],
  };
}
