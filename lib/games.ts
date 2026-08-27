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
  /**
   * Cada jogo é uma caixa de brinquedo de cor diferente.
   * `deep` é a sombra sólida embaixo da caixa — não é gradiente, é a lateral
   * pintada. Ver docs/01-DIRECAO-DE-ARTE.md.
   */
  skin: {
    bg: string;
    deep: string;
    ink: string;
    dim: string;
    glow: string;
  };
};

export const GAMES: Game[] = [
  {
    key: "letreiro",
    ord: "01",
    name: "Letreiro",
    ref: "a partir de Boggle",
    pitch:
      "Dados de letra caem na bandeja — dezesseis ou vinte e cinco, você escolhe. Todo mundo na mesma grade. No fim, o jogo mostra as palavras que ninguém viu.",
    players: "1–8",
    duration: "3–12 min",
    seal: "Jogável",
    phase: "Fase 1",
    skin: {
      bg: "#2FA36A",
      deep: "#1B6B44",
      ink: "#FFFBEC",
      dim: "#CFEEDD",
      glow: "#FFC42E",
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
    seal: "Jogável",
    phase: "Fase 2",
    skin: {
      bg: "#8A48D6",
      deep: "#5A2894",
      ink: "#FFF7FF",
      dim: "#E7D2FB",
      glow: "#FFC42E",
    },
  },
  {
    key: "dominio",
    ord: "03",
    name: "Domínio",
    ref: "a partir de WAR",
    pitch:
      "Vantara: 42 territórios, seis continentes, um objetivo secreto por pessoa. Ataque em série resolve a briga inteira numa jogada — e a partida acaba na mesma noite.",
    players: "3–6",
    duration: "35–90 min",
    seal: "Jogável",
    phase: "Fase 3",
    skin: {
      bg: "#EA6A2A",
      deep: "#A8420F",
      ink: "#FFF6EC",
      dim: "#FCDCC3",
      glow: "#2FD8C4",
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
    seal: "Jogável",
    phase: "Fase 4",
    skin: {
      bg: "#2B84E0",
      deep: "#14559B",
      ink: "#F2F9FF",
      dim: "#CBE4FC",
      glow: "#FF6FA5",
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
