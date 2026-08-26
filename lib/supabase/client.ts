"use client";

import { createBrowserClient } from "@supabase/ssr";

let cached: ReturnType<typeof createBrowserClient> | null = null;

/**
 * As NEXT_PUBLIC_* são embutidas no bundle em tempo de build. Se faltarem no
 * ambiente da Vercel, o site sobe e quebra em silêncio no cliente — então
 * falhamos com uma mensagem que diz o que fazer, e não com "undefined".
 */
export class MissingSupabaseEnv extends Error {
  constructor(missing: string[]) {
    super(
      `Faltam variáveis de ambiente: ${missing.join(", ")}. ` +
        "Defina em Vercel → Project → Settings → Environment Variables (e em .env.local para rodar local), depois refaça o deploy.",
    );
    this.name = "MissingSupabaseEnv";
  }
}

/** Cliente do browser. Só enxerga o que as policies de RLS permitirem. */
export function supabaseBrowser() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const missing = [
    !url && "NEXT_PUBLIC_SUPABASE_URL",
    !key && "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ].filter(Boolean) as string[];

  if (missing.length) throw new MissingSupabaseEnv(missing);

  cached ??= createBrowserClient(url!, key!);
  return cached;
}
