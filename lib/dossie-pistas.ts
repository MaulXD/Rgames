/**
 * As seis Cartas de Pista do Modo Avançado, do lado do cliente.
 *
 * Aqui mora só o que a tela precisa: como a carta se chama, o que ela faz em
 * uma frase, e QUE PERGUNTA fazer antes de jogá-la. As regras estão todas no
 * servidor — este arquivo não decide nada, ele só sabe desenhar.
 *
 * O `pede` é o que dirige a interface inteira: uma carta que não pede nada é um
 * botão, uma que pede um lugar abre a lista de lugares, e assim por diante. Sem
 * ele, cada carta precisaria do seu próprio pedaço de tela — e a sexta carta
 * chegaria com a tela já grande demais para receber a sétima.
 */

import type { Caso } from "@/lib/dossie";

export type IdPista =
  | "chave-mestra"
  | "tempo-curto"
  | "alibi"
  | "impressao"
  | "recado"
  | "interrogatorio";

/** O que a carta precisa saber antes de ser jogada. */
export type Pedido =
  | "nada"
  | "lugar"
  | "dois-suspeitos"
  | "jogador"
  | "jogador-e-tipo";

export type Pista = {
  id: IdPista;
  nome: string;
  frase: string;
  /**
   * Quando ela pode ser jogada. O servidor recusa fora disso de qualquer jeito
   * — isto é para a tela não oferecer o que vai dar erro.
   */
  quando: "minha-vez" | "refutando";
  pede: Pedido;
  /** O verbo do botão que confirma. */
  acao: string;
};

export const PISTAS: Record<IdPista, Pista> = {
  "chave-mestra": {
    id: "chave-mestra",
    nome: "Chave-mestra",
    frase: "Vá para qualquer lugar do mapa, sem gastar ação.",
    quando: "minha-vez",
    pede: "lugar",
    acao: "Ir",
  },
  "tempo-curto": {
    id: "tempo-curto",
    nome: "Tempo é curto",
    frase: "O próximo jogador terá uma ação em vez de duas.",
    quando: "minha-vez",
    pede: "nada",
    acao: "Apertar o relógio",
  },
  alibi: {
    id: "alibi",
    nome: "Álibi",
    frase: "Deixe de refutar uma vez, mesmo tendo a carta.",
    quando: "refutando",
    pede: "nada",
    acao: "Apresentar álibi",
  },
  impressao: {
    id: "impressao",
    nome: "Impressão digital",
    frase: "Nomeie dois suspeitos. Só você fica sabendo se o culpado está entre eles.",
    quando: "minha-vez",
    pede: "dois-suspeitos",
    acao: "Comparar",
  },
  recado: {
    id: "recado",
    nome: "Recado anônimo",
    frase: "Alguém — inclusive você — vê uma carta que não está no envelope.",
    quando: "minha-vez",
    pede: "jogador",
    acao: "Enviar",
  },
  interrogatorio: {
    id: "interrogatorio",
    nome: "Interrogatório",
    frase: "Peça a alguém uma carta de um tipo. Ele mostra, se tiver.",
    quando: "minha-vez",
    pede: "jogador-e-tipo",
    acao: "Interrogar",
  },
};

export function pistaDe(id: string): Pista | null {
  return (PISTAS as Record<string, Pista>)[id] ?? null;
}

/**
 * Os tipos, com o nome que aparece na tela.
 *
 * A chave é a do próprio tema, e não uma tradução: um nome só para uma coisa
 * só, do banco até o botão.
 */
export const TIPOS = [
  { id: "suspects", nome: "um suspeito" },
  { id: "weapons", nome: "um objeto" },
  { id: "rooms", nome: "um lugar" },
] as const;

export type IdTipo = (typeof TIPOS)[number]["id"];

/** O que a mesa ficou sabendo por uma carta — do estado privado. */
export type Aviso =
  | { k: "impressao"; a: string; b: string; sim: boolean }
  | { k: "recado"; card: string };

/**
 * De que tipo é uma carta do caso — na chave do próprio tema.
 *
 * Existe para a tela do interrogatório saber quais cartas da mão respondem ao
 * que foi pedido. O servidor faz a mesma conta em `dossie_cartas_do_tipo`, e as
 * duas leem a MESMA lista: a do pacote do tema. Não há terceira lista.
 */
export function tipoDaCarta(caso: Caso, id: string): IdTipo | null {
  if (caso.suspects.some((x) => x.id === id)) return "suspects";
  if (caso.weapons.some((x) => x.id === id)) return "weapons";
  if (caso.rooms.some((x) => x.id === id)) return "rooms";
  return null;
}

/** As cartas de um tipo, no caso. Irmã de `dossie_cartas_do_tipo` no servidor. */
export function cartasDoTipo(caso: Caso, tipo?: string): string[] {
  if (tipo === "suspects") return caso.suspects.map((x) => x.id);
  if (tipo === "weapons") return caso.weapons.map((x) => x.id);
  if (tipo === "rooms") return caso.rooms.map((x) => x.id);
  return [];
}

/**
 * O que um aviso PROVA não estar no envelope.
 *
 * Irmã de `dossie_aviso_ensina` no servidor, e é aqui que mora a assimetria da
 * impressão digital: o NÃO risca os dois nomeados, o SIM risca os outros
 * quatro. Uma carta que só serve quando dá sorte é uma carta que ninguém joga.
 */
export function avisoEnsina(caso: Caso, a: Aviso): string[] {
  if (a.k === "recado") return [a.card];
  return a.sim
    ? caso.suspects.map((s) => s.id).filter((id) => id !== a.a && id !== a.b)
    : [a.a, a.b];
}

/**
 * O nome desta carta NESTE caso.
 *
 * O efeito é do motor e o nome é do pacote: na Aurora o interrogatório é uma
 * "conversinha no banheiro"; no Meridiano-9 a chave-mestra é um "acesso de
 * manutenção". É a mesma divisão que já vale para `accuse` e `ghost` — por isso
 * o nome mora em `copy`, e não num campo novo. Uma casa só para as palavras que
 * o caso troca.
 *
 * A chave é `pista.<id>`, e o padrão é o nome genérico: um caso que não
 * reescreve nada continua jogável, e um que reescreve três das seis fica com
 * três reescritas — não com três buracos.
 */
export function nomeDaPista(caso: Caso, id: string): string {
  return caso.copy?.[`pista.${id}`] ?? pistaDe(id)?.nome ?? id;
}
