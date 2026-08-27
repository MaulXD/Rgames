import dados from "@/lib/dominio/vantara.json";

/**
 * Vantara — o mapa do Domínio.
 *
 * Nomes, continentes e arte são autorais. A TOPOLOGIA não é inventada: ela
 * segue a do Risk clássico, que está balanceada há setenta anos — gargalos nos
 * lugares certos, um continente-fortaleza (Meridiana, uma porta só), um
 * continente-corredor (Velária, quatro portas) e pontes intercontinentais que
 * decidem partida. Inventar um grafo de 42 territórios do zero e esperar que
 * jogue bem é apostar contra a casa.
 *
 * Grafo de jogo não é protegido por direito autoral; nome, arte e tabuleiro
 * são — e esses são nossos. Ver docs/README.md.
 *
 * Os DADOS vivem em `vantara.json`, e é de propósito: o mesmo arquivo é lido
 * pelo cliente (com tipo) e pelo validador em Node (`npm run mapa`). Duplicar
 * 42 territórios em dois formatos é garantir que um dos dois fique velho.
 */

export type ContinenteId = "aurelia" | "meridiana" | "velaria" | "sarnath" | "khadar" | "nauria";

export type Continente = {
  id: ContinenteId;
  nome: string;
  /** exércitos por rodada para quem controla o continente inteiro */
  bonus: number;
  cor: string;
  carater: string;
};

export type Territorio = {
  id: string;
  nome: string;
  continente: ContinenteId;
  /** posição esquemática numa grade de 12 × 7 */
  col: number;
  row: number;
  vizinhos: string[];
};

export type Objetivo = {
  id: string;
  texto: string;
  tipo: "continentes" | "territorios" | "territorios-com-dois" | "portos" | "eliminar";
  continentes?: ContinenteId[];
  extras?: number;
  alvo?: number;
};

export const CONTINENTES = dados.continentes as Continente[];
export const TERRITORIOS = dados.territorios as Territorio[];
export const OBJETIVOS = dados.objetivos as Objetivo[];
/** Territórios com porto — usados pelo objetivo transversal. */
export const PORTOS = dados.portos as string[];

export const POR_ID: Record<string, Territorio> = Object.fromEntries(
  TERRITORIOS.map((t) => [t.id, t]),
);

export const POR_CONTINENTE = CONTINENTES.reduce(
  (acc, c) => {
    acc[c.id] = TERRITORIOS.filter((t) => t.continente === c.id);
    return acc;
  },
  {} as Record<ContinenteId, Territorio[]>,
);

export const CONTINENTE_POR_ID: Record<string, Continente> = Object.fromEntries(
  CONTINENTES.map((c) => [c.id, c]),
);

export function saoVizinhos(a: string, b: string): boolean {
  return POR_ID[a]?.vizinhos.includes(b) ?? false;
}

/** Largura e altura da grade esquemática, derivadas dos próprios dados. */
export const GRADE = {
  cols: Math.max(...TERRITORIOS.map((t) => t.col)) + 1,
  rows: Math.max(...TERRITORIOS.map((t) => t.row)) + 1,
};

/** Quem controla um continente inteiro, pelo mapa de donos. */
export function bonusDe(donos: Record<string, number>, assento: number): number {
  let total = 0;
  for (const c of CONTINENTES) {
    const meus = POR_CONTINENTE[c.id].every((t) => donos[t.id] === assento);
    if (meus) total += c.bonus;
  }
  return total;
}

/** Reforço da rodada: territórios ÷ 2 (mínimo 3) + bônus de continente. */
export function reforcoDe(donos: Record<string, number>, assento: number): number {
  const meus = TERRITORIOS.filter((t) => donos[t.id] === assento).length;
  if (meus === 0) return 0;
  return Math.max(3, Math.floor(meus / 2)) + bonusDe(donos, assento);
}

/**
 * Todos os territórios de `assento` alcançáveis a partir de `de` passando SÓ
 * por território dele. É a regra do remanejo, e existe aqui em cima também
 * para a tela poder acender os destinos válidos antes de você tocar.
 *
 * A verdade continua sendo do servidor (`dominio_conectado`): esta função
 * pinta a intenção, não autoriza a jogada. Se as duas discordarem, o servidor
 * recusa — e é assim que tem de ser.
 */
export function conectados(
  donos: Record<string, number>,
  assento: number,
  de: string,
): Set<string> {
  const visto = new Set<string>([de]);
  const fila = [de];
  while (fila.length) {
    const atual = fila.shift()!;
    for (const v of POR_ID[atual]?.vizinhos ?? []) {
      if (!visto.has(v) && donos[v] === assento) {
        visto.add(v);
        fila.push(v);
      }
    }
  }
  visto.delete(de);
  return visto;
}

/** Quantos territórios e quantos exércitos cada assento tem, de uma passada. */
export function placar(
  donos: Record<string, number>,
  exercitos: Record<string, number>,
): Map<number, { ters: number; forca: number }> {
  const out = new Map<number, { ters: number; forca: number }>();
  for (const t of TERRITORIOS) {
    const d = donos[t.id];
    if (d === undefined) continue;
    const atual = out.get(d) ?? { ters: 0, forca: 0 };
    atual.ters += 1;
    atual.forca += exercitos[t.id] ?? 0;
    out.set(d, atual);
  }
  return out;
}
