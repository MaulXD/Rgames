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

/**
 * Valor de cada letra, na distribuicao oficial do Scrabble brasileiro - ela ja
 * e calibrada pela frequencia do portugues. Ver a migracao 0014 para o porque.
 */
const VALOR: Record<string, number> = {
  A: 1, E: 1, I: 1, O: 1, U: 1, S: 1, M: 1, R: 1, T: 1,
  D: 2, L: 2, C: 2, P: 2,
  N: 3, B: 3,
  F: 4, G: 4, H: 4, V: 4,
  J: 5, Q: 5,
  X: 6, Z: 6,
};

/** Bonus por comprimento, somado ao valor das letras. */
function bonus(n: number): number {
  if (n <= 3) return 0;
  if (n === 4) return 1;
  if (n === 5) return 3;
  if (n === 6) return 5;
  if (n === 7) return 8;
  return 14;
}

/**
 * Pontos de uma palavra: soma do valor das letras + bonus de comprimento.
 * A mesma conta roda no servidor (`letreiro_pontos_palavra`) - se as duas
 * divergirem, o placar do fim nao bate com o que apareceu durante a rodada.
 */
export function wordScore(word: string): number {
  const w = normalize(word);
  if (!w) return 0;
  let soma = 0;
  for (const ch of w) soma += VALOR[ch] ?? 1;
  return soma + bonus(w.length);
}

/** Quanto vale cada letra, para mostrar no dado. */
export function letterValue(face: string): number {
  let soma = 0;
  for (const ch of normalize(face)) soma += VALOR[ch] ?? 1;
  return soma;
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
