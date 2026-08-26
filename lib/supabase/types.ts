import type { AvatarSpec } from "@/lib/avatar";
import type { GameKey } from "@/lib/games";

/**
 * Tipos do banco, escritos à mão por enquanto.
 * Quando o schema estabilizar, trocar por:
 *   npx supabase gen types typescript --project-id <ref> > lib/supabase/types.ts
 */

export type Profile = {
  id: string;
  display_name: string;
  avatar: AvatarSpec | Record<string, never>;
  is_guest: boolean;
  stats: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type Room = {
  id: string;
  code: string;
  host_id: string;
  game_key: GameKey;
  status: "lobby" | "playing" | "scoring" | "archived";
  settings: Record<string, unknown>;
  created_at: string;
  expires_at: string;
};

export type RoomMember = {
  room_id: string;
  user_id: string;
  seat: number | null;
  color: string | null;
  role: "host" | "player" | "spectator";
  is_ready: boolean;
  joined_at: string;
  last_seen_at: string;
};

/**
 * Sem `Database` genérico por enquanto: o formato que o supabase-js espera
 * muda entre versões e escrever à mão apodrece. Os tipos de linha acima são
 * usados por cast. Quando o schema firmar:
 *   npx supabase gen types typescript --project-id <ref> > lib/supabase/generated.ts
 */
