export type GameKey = "letreiro" | "dossie" | "dominio" | "metropole";

export type Game = {
  key: GameKey;
  ord: string;
  name: string;
  ref: string;
  pitch: string;
  players: string;
  duration: string;
  status: "MVP" | "Em breve";
  /** paleta do mundo do jogo — ver docs/01-DIRECAO-DE-ARTE.md §3.3 */
  skin: {
    bg: string;
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
    status: "MVP",
    skin: {
      bg: "#3A2A1C",
      ink: "#F2E9D5",
      dim: "#BCA98C",
      glow: "#A8D046",
      sheen: "#FFF6DC",
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
    status: "Em breve",
    skin: {
      bg: "#123027",
      ink: "#E8DCC4",
      dim: "#9DAF9C",
      glow: "#C09A56",
      sheen: "#FFF3D2",
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
    status: "Em breve",
    skin: {
      bg: "#DDD0B2",
      ink: "#3A2D1C",
      dim: "#786349",
      glow: "#A63D40",
      sheen: "#FFFBEE",
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
    status: "Em breve",
    skin: {
      bg: "#8E3D28",
      ink: "#F7EDE0",
      dim: "#DCB6A2",
      glow: "#4FA88B",
      sheen: "#FFE9CF",
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
