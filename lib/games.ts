export type GameKey = "letreiro" | "dossie" | "dominio" | "metropole";

export type Game = {
  key: GameKey;
  ord: string;
  name: string;
  ref: string;
  pitch: string;
  players: string;
  duration: string;
  /** Selo do canto: em que fase do roadmap o jogo em si fica jogável. */
  seal: string;
  phase: string;
  /** paleta do mundo do jogo — ver docs/01-DIRECAO-DE-ARTE.md §3.3 */
  skin: {
    bg: string;
    lit: string;
    ink: string;
    dim: string;
    glow: string;
    sheen: string;
  };
};

export const GAMES: Game[] = [
  {
    key: "letreiro",
    ord: "01",
    name: "Letreiro",
    ref: "a partir de Boggle",
    pitch:
      "Dezesseis dados de letra caem na bandeja. Três minutos, todo mundo na mesma grade. No fim, o jogo mostra as palavras que ninguém viu.",
    players: "1–8",
    duration: "3–12 min",
    seal: "MVP",
    phase: "Fase 1",
    skin: {
      bg: "#2E2015",
      lit: "#5C4126",
      ink: "#F6EEDA",
      dim: "#C3B091",
      glow: "#B4DC4C",
      sheen: "#FFF8DE",
    },
  },
  {
    key: "dossie",
    ord: "02",
    name: "Dossiê",
    ref: "a partir de Detetive",
    pitch:
      "Quatro mundos no mesmo motor: uma mansão em 1953, uma boate em 1987, uma escavação no deserto e uma estação orbital. Cada um com sua regra.",
    players: "3–6",
    duration: "25–40 min",
    seal: "Fase 2",
    phase: "Fase 2",
    skin: {
      bg: "#0E2A22",
      lit: "#1E4A38",
      ink: "#ECE0C8",
      dim: "#A5B7A4",
      glow: "#D4AC63",
      sheen: "#FFF4D4",
    },
  },
  {
    key: "dominio",
    ord: "03",
    name: "Domínio",
    ref: "a partir de WAR",
    pitch:
      "Um mapa de 1936, 42 territórios e um objetivo secreto. Batalha em lote resolve vinte assaltos em quatro segundos — e a partida acaba na mesma noite.",
    players: "3–6",
    duration: "35–90 min",
    seal: "Fase 3",
    phase: "Fase 3",
    skin: {
      bg: "#D8C9A6",
      lit: "#EFE4C6",
      ink: "#33271A",
      dim: "#6E5A40",
      glow: "#B03C3F",
      sheen: "#FFFDF2",
    },
  },
  {
    key: "metropole",
    ord: "04",
    name: "Metrópole",
    ref: "a partir de Banco Imobiliário",
    pitch:
      "Bairros brasileiros em art déco tropical, prédios que crescem na sua frente, e acordos que o jogo cobra sozinho — parcela a parcela.",
    players: "2–6",
    duration: "30–120 min",
    seal: "Fase 4",
    phase: "Fase 4",
    skin: {
      bg: "#7E351F",
      lit: "#B0522F",
      ink: "#FBF1E4",
      dim: "#E2BCA6",
      glow: "#5FC0A0",
      sheen: "#FFEBD2",
    },
  },
];

/** Alfabeto sem ambiguidade visual — ver docs/00-PRD-PLATAFORMA.md §7.1 */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;

export function sanitizeCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/[ILO]/g, (c) => ({ I: "1", L: "1", O: "0" })[c] ?? c)
    .replace(/[10]/g, "")
    .slice(0, CODE_LENGTH);
}

export function isCompleteCode(code: string): boolean {
  return (
    code.length === CODE_LENGTH &&
    [...code].every((c) => CODE_ALPHABET.includes(c))
  );
}
