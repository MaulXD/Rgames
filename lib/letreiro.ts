/**
 * Geometria e pontuação do Letreiro — tudo que o cliente resolve sozinho.
 *
 * O caminho aceso enquanto você digita não precisa de dicionário: são 16
 * células, e achar o caminho é busca em profundidade. É por isso que o
 * dicionário pode ficar só no servidor sem perder o polimento.
 */

export const SIZE = 4;
export const CELLS = SIZE * SIZE;
const HEX = "0123456789abcdef";

/** Vizinhos nas 8 direções. */
export const NEIGHBORS: number[][] = (() => {
  const out: number[][] = [];
  for (let i = 0; i < CELLS; i++) {
    const r = Math.floor(i / SIZE);
    const c = i % SIZE;
    const list: number[] = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) continue;
        list.push(nr * SIZE + nc);
      }
    }
    out.push(list);
  }
  return out;
})();

export function areNeighbors(a: number, b: number): boolean {
  return NEIGHBORS[a]?.includes(b) ?? false;
}

/** Maiúscula, sem acento, sem cedilha — a mesma regra do servidor. */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}

export function score(letters: number): number {
  if (letters <= 4) return 1;
  if (letters === 5) return 2;
  if (letters === 6) return 3;
  if (letters === 7) return 5;
  return 11;
}

export function pathToString(path: number[]): string {
  return path.map((i) => HEX[i]).join("");
}

export function pathFromString(s: string): number[] {
  return [...s].map((c) => HEX.indexOf(c)).filter((i) => i >= 0);
}

/**
 * Acha um caminho na grade que soletra exatamente `target`.
 * Uma célula pode valer duas letras ("QU"), então o consumo é por string.
 * Devolve o primeiro caminho encontrado, ou null.
 */
export function findPath(grid: string[], target: string): number[] | null {
  const alvo = normalize(target);
  if (!alvo) return null;

  const usada = new Array(CELLS).fill(false);
  const caminho: number[] = [];

  function desce(pos: number, celula: number): boolean {
    const face = grid[celula];
    if (!alvo.startsWith(face, pos)) return false;

    usada[celula] = true;
    caminho.push(celula);
    const prox = pos + face.length;

    if (prox === alvo.length) return true;

    for (const v of NEIGHBORS[celula]) {
      if (!usada[v] && desce(prox, v)) return true;
    }

    usada[celula] = false;
    caminho.pop();
    return false;
  }

  for (let i = 0; i < CELLS; i++) {
    if (desce(0, i)) return [...caminho];
  }
  return null;
}

/** As letras que um caminho soletra. */
export function pathWord(grid: string[], path: number[]): string {
  return path.map((i) => grid[i]).join("");
}

/** Rótulo da face: "QU" aparece como "Qu", que é como se lê. */
export function faceLabel(face: string): string {
  return face.length > 1 ? face[0] + face.slice(1).toLowerCase() : face;
}

export type PlayerWord = {
  w: string;
  p: string;
  pts: number;
  /** false enquanto o servidor não confirmou */
  confirmed?: boolean;
  /** motivo da recusa, quando houver */
  rejected?: string;
};

export const REJECTION: Record<string, string> = {
  NOT_A_WORD: "não está no dicionário",
  BAD_PATH: "esse caminho não fecha",
  REPEATED: "você já achou essa",
  SHORT: "mínimo de três letras",
  TIME_OVER: "o tempo acabou",
};
