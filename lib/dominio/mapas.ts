import vantaraJson from "@/lib/dominio/vantara.json";
import relampagoJson from "@/lib/dominio/relampago.json";

/**
 * Os mapas do Domínio.
 *
 * Nomes, continentes e arte são autorais. A TOPOLOGIA de Vantara não é
 * inventada: ela segue a do Risk clássico, que está balanceada há setenta anos
 * — gargalos nos lugares certos, um continente-fortaleza (Meridiana, uma porta
 * só), um continente-corredor (Velária, quatro portas) e pontes
 * intercontinentais que decidem partida. Inventar um grafo de 42 territórios do
 * zero e esperar que jogue bem é apostar contra a casa.
 *
 * Grafo de jogo não é protegido por direito autoral; nome, arte e tabuleiro
 * são — e esses são nossos. Ver docs/README.md.
 *
 * O Relâmpago é um RECORTE de Vantara, gerado por
 * `scripts/gera-mapa-relampago.mjs`: os mesmos lugares, os mesmos nomes, as
 * mesmas fronteiras, sem a metade norte. É um segundo arquivo de dados, não um
 * segundo jogo (PRD 04 §3).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUE NÃO EXISTE MAIS UM `TERRITORIOS` SOLTO NESTE MÓDULO
 *
 * Havia, e era o certo enquanto o jogo tinha um mapa. Com dois, uma constante
 * de módulo é uma armadilha silenciosa: um componente que a use numa partida
 * Relâmpago desenha Vantara em cima de um estado de 24 territórios, e o que
 * aparece na tela é um mapa com metade dos lugares vazios — sem erro, sem aviso.
 *
 * Tirar as constantes obriga cada uso a dizer DE QUAL MAPA está falando, e quem
 * encontra os que esqueceram é o compilador, hoje, e não alguém jogando.
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
  /** posição esquemática numa grade */
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

type Bruto = {
  continentes: unknown;
  territorios: unknown;
  objetivos: unknown;
  portos: unknown;
};

export type Mapa = {
  id: string;
  continentes: Continente[];
  territorios: Territorio[];
  objetivos: Objetivo[];
  /** Territórios com porto — usados pelo objetivo transversal. */
  portos: string[];
  porId: Record<string, Territorio>;
  porContinente: Record<string, Territorio[]>;
  continentePorId: Record<string, Continente>;
  /** Largura e altura da grade esquemática, derivadas dos próprios dados. */
  grade: { cols: number; rows: number };
};

function monta(id: string, bruto: Bruto): Mapa {
  const continentes = bruto.continentes as Continente[];
  const territorios = bruto.territorios as Territorio[];
  return {
    id,
    continentes,
    territorios,
    objetivos: bruto.objetivos as Objetivo[],
    portos: bruto.portos as string[],
    porId: Object.fromEntries(territorios.map((t) => [t.id, t])),
    porContinente: Object.fromEntries(
      continentes.map((c) => [c.id, territorios.filter((t) => t.continente === c.id)]),
    ),
    continentePorId: Object.fromEntries(continentes.map((c) => [c.id, c])),
    grade: {
      cols: Math.max(...territorios.map((t) => t.col)) + 1,
      rows: Math.max(...territorios.map((t) => t.row)) + 1,
    },
  };
}

export const VANTARA = monta("vantara", vantaraJson as Bruto);
export const RELAMPAGO = monta("relampago", relampagoJson as Bruto);

/**
 * O mapa de uma partida, pelo id que veio no estado.
 *
 * Vantara é o padrão, e o `??` é o que faz partida antiga continuar
 * funcionando: as que começaram antes do Relâmpago existir não têm a chave.
 * Um id desconhecido também cai em Vantara em vez de quebrar a tela — o
 * servidor já recusou o que não conhece, e aqui a resposta certa a um dado
 * estranho é desenhar alguma coisa.
 */
export function mapaDe(id?: string | null): Mapa {
  return id === "relampago" ? RELAMPAGO : VANTARA;
}

export function saoVizinhos(mapa: Mapa, a: string, b: string): boolean {
  return mapa.porId[a]?.vizinhos.includes(b) ?? false;
}

/** Quem controla um continente inteiro, pelo mapa de donos. */
export function bonusDe(mapa: Mapa, donos: Record<string, number>, assento: number): number {
  let total = 0;
  for (const c of mapa.continentes) {
    const meus = mapa.porContinente[c.id].every((t) => donos[t.id] === assento);
    if (meus) total += c.bonus;
  }
  return total;
}

/** Reforço da rodada: territórios ÷ 2 (mínimo 3) + bônus de continente. */
export function reforcoDe(mapa: Mapa, donos: Record<string, number>, assento: number): number {
  const meus = mapa.territorios.filter((t) => donos[t.id] === assento).length;
  if (meus === 0) return 0;
  return Math.max(3, Math.floor(meus / 2)) + bonusDe(mapa, donos, assento);
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
  mapa: Mapa,
  donos: Record<string, number>,
  assento: number,
  de: string,
): Set<string> {
  const visto = new Set<string>([de]);
  const fila = [de];
  while (fila.length) {
    const atual = fila.shift()!;
    for (const v of mapa.porId[atual]?.vizinhos ?? []) {
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
  mapa: Mapa,
  donos: Record<string, number>,
  exercitos: Record<string, number>,
): Map<number, { ters: number; forca: number }> {
  const out = new Map<number, { ters: number; forca: number }>();
  for (const t of mapa.territorios) {
    const d = donos[t.id];
    if (d === undefined) continue;
    const atual = out.get(d) ?? { ters: 0, forca: 0 };
    atual.ters += 1;
    atual.forca += exercitos[t.id] ?? 0;
    out.set(d, atual);
  }
  return out;
}
