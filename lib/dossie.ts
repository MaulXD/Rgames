import { supabaseBrowser } from "@/lib/supabase/client";
import type { Clima } from "@/lib/sfx";

/**
 * O pacote de um caso do Dossiê, do lado do cliente.
 *
 * Nada aqui é escrito à mão: tudo vem de `game_themes.data`, que é público
 * (elenco, objetos e mapa não são segredo — a solução do crime é, e ela vive
 * numa coluna que o cliente não consegue ler).
 * Ver docs/07-SISTEMA-DE-TEMAS.md §2.
 */

export type Piso = "tapete" | "madeira" | "ladrilho";

export type Suspeito = {
  id: string;
  name: string;
  role: string;
  color: string;
  crest: string;
};

export type Objeto = { id: string; name: string };

export type Lugar = {
  id: string;
  name: string;
  col: number;
  row: number;
  piso?: Piso;
};

export type Caso = {
  id: string;
  name: string;
  era: string;
  tagline: string;
  victim: { name: string; role: string };
  suspects: Suspeito[];
  weapons: Objeto[];
  rooms: Lugar[];
  adjacency: Record<string, string[]>;
  secretPassages: [string, string][];
  narracao?: string[];
  encerramento?: string;
  clima?: Clima;
  copy?: Record<string, string>;
  /**
   * A regra própria deste caso, ou ausente quando ele joga limpo.
   *
   * Vem do pacote e não do estado da partida: aqui é o que o caso É, e não o que
   * a reviravolta está fazendo agora — uma mesa pode ter desligado a regra, e o
   * caso continua sendo o caso do Apagão. Quem quer saber se ela está valendo
   * nesta partida olha `public_state.twist`.
   */
  twist?: { id: string; name: string; rule: string };
};

export async function carregaCaso(id: string): Promise<Caso | null> {
  const sb = supabaseBrowser();
  const { data, error } = await sb
    .from("game_themes")
    .select("id, name, era, tagline, data")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;

  const row = data as unknown as {
    id: string;
    name: string;
    era: string;
    tagline: string;
    data: Omit<Caso, "id" | "name" | "era" | "tagline">;
  };

  return { id: row.id, name: row.name, era: row.era, tagline: row.tagline, ...row.data };
}

/** Todas as 21 cartas do caso, na ordem em que aparecem no bloco de dedução. */
export function baralho(caso: Caso): { id: string; nome: string; tipo: "suspeito" | "objeto" | "lugar" }[] {
  return [
    ...caso.suspects.map((s) => ({ id: s.id, nome: s.name, tipo: "suspeito" as const })),
    ...caso.weapons.map((w) => ({ id: w.id, nome: w.name, tipo: "objeto" as const })),
    ...caso.rooms.map((r) => ({ id: r.id, nome: r.name, tipo: "lugar" as const })),
  ];
}

export function nomeDaCarta(caso: Caso, id: string): string {
  return baralho(caso).find((c) => c.id === id)?.nome ?? id;
}

/** Dá para ir daqui até lá num movimento? Corredor ou passagem secreta. */
export function alcancavel(caso: Caso, de: string, para: string): boolean {
  if (caso.adjacency[de]?.includes(para)) return true;
  return caso.secretPassages.some(
    ([a, b]) => (a === de && b === para) || (b === de && a === para),
  );
}

export function ehPassagem(caso: Caso, de: string, para: string): boolean {
  return caso.secretPassages.some(
    ([a, b]) => (a === de && b === para) || (b === de && a === para),
  );
}
