/**
 * Avatares da Mesa — fichas de esmalte e metal.
 *
 * Não há upload de foto e não há gerador aleatório de rosto. O avatar é uma
 * peça de jogo: silhueta, esmalte colorido, hachura e um brasão gravado.
 *
 * A hachura não é decoração — é o identificador redundante que o daltonismo
 * exige (ver docs/01-DIRECAO-DE-ARTE.md §3.4). Duas pessoas podem escolher a
 * mesma cor em salas diferentes, mas cor + hachura + brasão sempre distinguem.
 */

export const SHAPES = ["circulo", "escudo", "hexagono", "losango", "octogono", "selo"] as const;
export const PATTERNS = ["liso", "diagonal", "pontos", "grade", "vertical", "raios"] as const;
export const METALS = ["latao", "prata", "cobre"] as const;
export const MARKS = [
  "coroa",
  "chave",
  "raio",
  "lua",
  "estrela",
  "bussola",
  "folha",
  "chama",
  "torre",
  "olho",
  "ampulheta",
  "losangos",
] as const;

export type Shape = (typeof SHAPES)[number];
export type Pattern = (typeof PATTERNS)[number];
export type Metal = (typeof METALS)[number];
export type Mark = (typeof MARKS)[number];

export type ColorKey =
  | "carmim"
  | "prussia"
  | "ocre"
  | "oliva"
  | "vinho"
  | "grafite"
  | "jade"
  | "terracota";

export const COLORS: Record<ColorKey, { name: string; enamel: string; deep: string; ink: string }> = {
  carmim: { name: "Carmim", enamel: "#A63D40", deep: "#7A2A2D", ink: "#FBEFE6" },
  prussia: { name: "Prússia", enamel: "#3B6E8F", deep: "#274C64", ink: "#F0F6FA" },
  ocre: { name: "Ocre", enamel: "#D9A02F", deep: "#A2731C", ink: "#2A1F0C" },
  oliva: { name: "Oliva", enamel: "#5B8C5A", deep: "#3E6640", ink: "#F2F7EF" },
  vinho: { name: "Vinho", enamel: "#6B4E71", deep: "#4B3550", ink: "#F6EFF7" },
  grafite: { name: "Grafite", enamel: "#3A464C", deep: "#242D31", ink: "#EDF1F2" },
  jade: { name: "Jade", enamel: "#2E7D5B", deep: "#1E5A40", ink: "#EFF8F2" },
  terracota: { name: "Terracota", enamel: "#C06A45", deep: "#8E4A2E", ink: "#FDF1E8" },
};

export const METAL_TONES: Record<Metal, { name: string; lo: string; mid: string; hi: string }> = {
  latao: { name: "Latão", lo: "#7C5C22", mid: "#B08A3E", hi: "#EBD293" },
  prata: { name: "Prata", lo: "#6E757A", mid: "#A7AFB4", hi: "#E6EAEC" },
  cobre: { name: "Cobre", lo: "#7A3C22", mid: "#B4653C", hi: "#E7A97F" },
};

export const SHAPE_NAMES: Record<Shape, string> = {
  circulo: "Círculo",
  escudo: "Escudo",
  hexagono: "Hexágono",
  losango: "Losango",
  octogono: "Octógono",
  selo: "Selo",
};

export const PATTERN_NAMES: Record<Pattern, string> = {
  liso: "Liso",
  diagonal: "Diagonal",
  pontos: "Pontos",
  grade: "Grade",
  vertical: "Vertical",
  raios: "Raios",
};

export const MARK_NAMES: Record<Mark, string> = {
  coroa: "Coroa",
  chave: "Chave",
  raio: "Raio",
  lua: "Lua",
  estrela: "Estrela",
  bussola: "Bússola",
  folha: "Folha",
  chama: "Chama",
  torre: "Torre",
  olho: "Olho",
  ampulheta: "Ampulheta",
  losangos: "Losangos",
};

export type AvatarSpec = {
  shape: Shape;
  color: ColorKey;
  pattern: Pattern;
  metal: Metal;
  mark: Mark;
};

export const DEFAULT_AVATAR: AvatarSpec = {
  shape: "selo",
  color: "carmim",
  pattern: "diagonal",
  metal: "latao",
  mark: "coroa",
};

const COLOR_KEYS = Object.keys(COLORS) as ColorKey[];

function pick<T>(list: readonly T[], rnd: () => number): T {
  return list[Math.floor(rnd() * list.length)];
}

export function randomAvatar(rnd: () => number = Math.random): AvatarSpec {
  return {
    shape: pick(SHAPES, rnd),
    color: pick(COLOR_KEYS, rnd),
    pattern: pick(PATTERNS, rnd),
    metal: pick(METALS, rnd),
    mark: pick(MARKS, rnd),
  };
}

/** Nunca confie no jsonb. Qualquer coisa fora do vocabulário cai no padrão. */
export function parseAvatar(raw: unknown): AvatarSpec {
  const o = (raw ?? {}) as Partial<AvatarSpec>;
  const ok = <T extends string>(v: unknown, list: readonly T[], fb: T): T =>
    list.includes(v as T) ? (v as T) : fb;
  return {
    shape: ok(o.shape, SHAPES, DEFAULT_AVATAR.shape),
    color: ok(o.color, COLOR_KEYS, DEFAULT_AVATAR.color),
    pattern: ok(o.pattern, PATTERNS, DEFAULT_AVATAR.pattern),
    metal: ok(o.metal, METALS, DEFAULT_AVATAR.metal),
    mark: ok(o.mark, MARKS, DEFAULT_AVATAR.mark),
  };
}

/** Chave estável — serve de sufixo para os ids de <defs> do SVG. */
export function avatarKey(a: AvatarSpec): string {
  return `${a.shape[0]}${a.color[0]}${a.pattern[0]}${a.metal[0]}${a.mark.slice(0, 3)}`;
}

/* ── geometria ──────────────────────────────────────────────────────────── */

function poly(sides: number, r: number, rot = 0): string {
  const pts: string[] = [];
  for (let i = 0; i < sides; i++) {
    const a = rot + (i / sides) * Math.PI * 2;
    pts.push(`${(50 + r * Math.cos(a)).toFixed(2)},${(50 + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join("L")}Z`;
}

/** Selo de cera: círculo com borda ondulada. */
function seal(r: number, lobes = 14): string {
  const steps = lobes * 8;
  const pts: string[] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const rr = r + Math.cos(t * lobes) * 2.4;
    pts.push(`${(50 + rr * Math.cos(t)).toFixed(2)},${(50 + rr * Math.sin(t)).toFixed(2)}`);
  }
  return `M${pts.join("L")}Z`;
}

export function shapePath(shape: Shape, r = 46): string {
  switch (shape) {
    case "circulo":
      return `M50,${50 - r}A${r},${r} 0 1,1 ${50 - 0.01},${50 - r}Z`;
    case "hexagono":
      return poly(6, r, -Math.PI / 2);
    case "octogono":
      return poly(8, r, Math.PI / 8);
    case "losango":
      return poly(4, r, -Math.PI / 2);
    case "escudo":
      return `M${50 - r * 0.82},${50 - r * 0.92}H${50 + r * 0.82}V${50 + r * 0.1}
              Q${50 + r * 0.82},${50 + r * 0.78} 50,${50 + r * 0.98}
              Q${50 - r * 0.82},${50 + r * 0.78} ${50 - r * 0.82},${50 + r * 0.1}Z`.replace(/\s+/g, " ");
    case "selo":
      return seal(r - 2);
  }
}

/** Brasões — geométricos e heráldicos, legíveis a 24px. */
export function markPath(mark: Mark): string {
  switch (mark) {
    case "coroa":
      return "M30 62h40v-6H30zM30 52l7-14 6 9 7-15 7 15 6-9 7 14z";
    case "chave":
      return "M50 26a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 6a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM47 44h6v26h-6zM53 54h9v5h-9zM53 63h7v5h-7z";
    case "raio":
      return "M56 24 34 54h12l-6 22 24-32H52z";
    case "lua":
      return "M58 26a24 24 0 1 0 0 48 20 20 0 1 1 0-48z";
    case "estrela": {
      const pts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 25 : 10.5;
        const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
        pts.push(`${(50 + r * Math.cos(a)).toFixed(2)},${(50 + r * Math.sin(a)).toFixed(2)}`);
      }
      return `M${pts.join("L")}Z`;
    }
    case "bussola": {
      const pts: string[] = [];
      for (let i = 0; i < 8; i++) {
        const r = i % 2 === 0 ? 26 : 8;
        const a = -Math.PI / 2 + (i / 8) * Math.PI * 2;
        pts.push(`${(50 + r * Math.cos(a)).toFixed(2)},${(50 + r * Math.sin(a)).toFixed(2)}`);
      }
      return `M${pts.join("L")}Z`;
    }
    case "folha":
      return "M50 24c14 10 18 22 12 32-5 8-12 10-12 10s-7-2-12-10c-6-10-2-22 12-32zM48 44h4v30h-4z";
    case "chama":
      return "M50 22c10 12 16 20 16 30a16 16 0 0 1-32 0c0-10 6-18 16-30zm0 18c-4 6-6 10-6 14a6 6 0 0 0 12 0c0-4-2-8-6-14z";
    case "torre":
      return "M32 40h6v-8h6v8h4v-8h6v8h6v-8h6v8h2v34H30V40zM44 54h12v20H44z";
    case "olho":
      return "M50 34c14 0 24 10 26 16-2 6-12 16-26 16s-24-10-26-16c2-6 12-16 26-16zm0 8a8 8 0 1 0 0 16 8 8 0 0 0 0-16z";
    case "ampulheta":
      return "M32 24h36v6H32zM32 70h36v6H32zM36 30h28L52 50l12 20H36l12-20z";
    case "losangos":
      return "M50 22l11 13-11 13-11-13zM50 52l11 13-11 13-11-13z";
    default:
      return "";
  }
}
