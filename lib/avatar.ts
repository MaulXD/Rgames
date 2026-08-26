/**
 * Avatares da Mesa — bichinhos.
 *
 * A primeira versão eram fichas de esmalte e latão, heráldicas. Bonito de
 * catálogo e sem graça na mesa: ninguém se reconhece num brasão. Agora são
 * personagens — corpo, olhos, boca e chapéu — em cor viva e contorno grosso.
 *
 * A redundância que o daltonismo exige continua existindo, só mudou de forma:
 * antes era hachura, agora é **silhueta + chapéu + cara**. Dois jogadores na
 * mesma cor continuam distinguíveis de relance, e é mais divertido.
 */

/** Corpo. A silhueta é o identificador mais forte depois da cor. */
export const BODIES = ["bolha", "gota", "ovo", "estrela", "nuvem", "bicho"] as const;
export const EYES = ["normal", "feliz", "sono", "uau", "esperto", "brilho"] as const;
export const MOUTHS = ["sorriso", "riso", "bico", "lingua", "serio", "assobio"] as const;
export const HATS = ["nenhum", "coroa", "boina", "laco", "antena", "pena", "oculos"] as const;

export type Body = (typeof BODIES)[number];
export type Eyes = (typeof EYES)[number];
export type Mouth = (typeof MOUTHS)[number];
export type Hat = (typeof HATS)[number];

/**
 * As CHAVES de cor não podem mudar: existe um CHECK no banco
 * (migração 0002) que valida a cor do assento contra esta lista. Os nomes
 * visíveis e os valores mudaram para o registro vivo; as chaves ficam.
 */
export type ColorKey =
  | "carmim"
  | "prussia"
  | "ocre"
  | "oliva"
  | "vinho"
  | "grafite"
  | "jade"
  | "terracota";

export const COLORS: Record<
  ColorKey,
  { name: string; enamel: string; light: string; deep: string; ink: string }
> = {
  carmim:    { name: "Vermelho", enamel: "#FF4D5E", light: "#FF8A95", deep: "#C22436", ink: "#2A0B10" },
  terracota: { name: "Laranja",  enamel: "#FF8A2B", light: "#FFB772", deep: "#C55A00", ink: "#2E1400" },
  ocre:      { name: "Amarelo",  enamel: "#FFC42E", light: "#FFDC7C", deep: "#C58F00", ink: "#2E2000" },
  oliva:     { name: "Verde",    enamel: "#5FD13A", light: "#9BE87F", deep: "#3A9420", ink: "#0E2606" },
  jade:      { name: "Menta",    enamel: "#25C08B", light: "#74E0BB", deep: "#12855D", ink: "#052319" },
  grafite:   { name: "Turquesa", enamel: "#2FD8C4", light: "#84EDE1", deep: "#159384", ink: "#04251F" },
  prussia:   { name: "Azul",     enamel: "#2E8CFF", light: "#7FBAFF", deep: "#1157BC", ink: "#04142E" },
  vinho:     { name: "Roxo",     enamel: "#B25CFF", light: "#D29FFF", deep: "#7A24C4", ink: "#1B0630" },
};

export const BODY_NAMES: Record<Body, string> = {
  bolha: "Bolha",
  gota: "Gota",
  ovo: "Ovo",
  estrela: "Estrela",
  nuvem: "Nuvem",
  bicho: "Bichinho",
};

export const EYES_NAMES: Record<Eyes, string> = {
  normal: "Normal",
  feliz: "Feliz",
  sono: "Sonolento",
  uau: "Espantado",
  esperto: "Esperto",
  brilho: "Brilhando",
};

export const MOUTH_NAMES: Record<Mouth, string> = {
  sorriso: "Sorriso",
  riso: "Risada",
  bico: "Bico",
  lingua: "Língua",
  serio: "Sério",
  assobio: "Assobio",
};

export const HAT_NAMES: Record<Hat, string> = {
  nenhum: "Nada",
  coroa: "Coroa",
  boina: "Boina",
  laco: "Laço",
  antena: "Antena",
  pena: "Pena",
  oculos: "Óculos",
};

export type AvatarSpec = {
  color: ColorKey;
  body: Body;
  eyes: Eyes;
  mouth: Mouth;
  hat: Hat;
};

export const DEFAULT_AVATAR: AvatarSpec = {
  color: "ocre",
  body: "bolha",
  eyes: "feliz",
  mouth: "sorriso",
  hat: "nenhum",
};

export const COLOR_KEYS = Object.keys(COLORS) as ColorKey[];

function pick<T>(list: readonly T[], rnd: () => number): T {
  return list[Math.floor(rnd() * list.length)];
}

export function randomAvatar(rnd: () => number = Math.random): AvatarSpec {
  return {
    color: pick(COLOR_KEYS, rnd),
    body: pick(BODIES, rnd),
    eyes: pick(EYES, rnd),
    mouth: pick(MOUTHS, rnd),
    hat: pick(HATS, rnd),
  };
}

/**
 * Nunca confie no jsonb. Aceita também o formato antigo (fichas de esmalte),
 * caindo no padrão em vez de quebrar a tela de quem já tinha avatar salvo.
 */
export function parseAvatar(raw: unknown): AvatarSpec {
  const o = (raw ?? {}) as Partial<AvatarSpec>;
  const ok = <T extends string>(v: unknown, list: readonly T[], fb: T): T =>
    list.includes(v as T) ? (v as T) : fb;
  return {
    color: ok(o.color, COLOR_KEYS, DEFAULT_AVATAR.color),
    body: ok(o.body, BODIES, DEFAULT_AVATAR.body),
    eyes: ok(o.eyes, EYES, DEFAULT_AVATAR.eyes),
    mouth: ok(o.mouth, MOUTHS, DEFAULT_AVATAR.mouth),
    hat: ok(o.hat, HATS, DEFAULT_AVATAR.hat),
  };
}

/** Chave estável — sufixo para os ids de <defs> do SVG. */
export function avatarKey(a: AvatarSpec): string {
  return `${a.color[0]}${a.body[0]}${a.eyes[0]}${a.mouth[0]}${a.hat[0]}`;
}

/* ── silhuetas ──────────────────────────────────────────────────────────── */

function star(pontas: number, re: number, ri: number, cy: number): string {
  const pts: string[] = [];
  for (let i = 0; i < pontas * 2; i++) {
    const r = i % 2 === 0 ? re : ri;
    const a = -Math.PI / 2 + (i / (pontas * 2)) * Math.PI * 2;
    pts.push(`${(50 + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return `M${pts.join("L")}Z`;
}

export function bodyPath(body: Body): string {
  switch (body) {
    case "bolha":
      return "M50 19C73 19 85 34 85 55C85 75 70 88 50 88C30 88 15 75 15 55C15 34 27 19 50 19Z";
    case "gota":
      return "M50 14C62 33 85 44 85 61C85 78 69 89 50 89C31 89 15 78 15 61C15 44 38 33 50 14Z";
    case "ovo":
      return "M50 14C67 14 81 38 81 59C81 78 67 89 50 89C33 89 19 78 19 59C19 38 33 14 50 14Z";
    case "estrela":
      return star(5, 38, 19, 54);
    case "nuvem":
      return (
        "M27 88C14 88 8 76 13 66C6 56 15 43 27 46C31 32 49 27 57 38" +
        "C71 31 85 42 82 55C92 60 91 79 77 88Z"
      );
    case "bicho":
      return (
        "M24 32L16 11L39 23ZM76 32L84 11L61 23Z" +
        "M50 21C73 21 85 36 85 57C85 76 70 88 50 88C30 88 15 76 15 57C15 36 27 21 50 21Z"
      );
  }
}

/**
 * Onde a cara cabe, por silhueta.
 *
 * A cara era desenhada em coordenadas fixas (olhos em y=52, bochecha em x=26)
 * e isso quebrava a estrela e a nuvem: os tracos caiam FORA do corpo, virando
 * riscos soltos na tela. Agora cada silhueta declara o deslocamento e a
 * escala da cara, e o grupo inteiro entra transformado.
 */
export function faceBox(body: Body): { dx: number; dy: number; s: number } {
  switch (body) {
    case "bolha":
      return { dx: 0, dy: 0, s: 1 };
    case "gota":
      return { dx: 0, dy: 5, s: 0.94 };
    case "ovo":
      return { dx: 0, dy: 1, s: 0.94 };
    case "estrela":
      // o miolo solido da estrela e pequeno: a cara encolhe e sobe
      return { dx: 0, dy: -3, s: 0.6 };
    case "nuvem":
      return { dx: 2, dy: 6, s: 0.78 };
    case "bicho":
      return { dx: 0, dy: 3, s: 0.96 };
  }
}

/** Ponto onde o chapéu assenta, por silhueta. */
export function hatAnchor(body: Body): { x: number; y: number } {
  switch (body) {
    // os chapeus sobem ate 24 unidades acima da ancora; abaixo de y=24 eles
    // escapavam da moldura de 100x100 e ficavam cortados dentro dos chips.
    case "gota":
      return { x: 50, y: 26 };
    case "estrela":
      return { x: 50, y: 27 };
    case "nuvem":
      return { x: 52, y: 38 };
    case "bicho":
      return { x: 50, y: 30 };
    default:
      return { x: 50, y: 26 };
  }
}
