"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { User } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Profile } from "@/lib/supabase/types";
import { DEFAULT_AVATAR, parseAvatar, type AvatarSpec } from "@/lib/avatar";

type Status = "loading" | "ready" | "error";

type Ctx = {
  status: Status;
  user: User | null;
  profile: Profile | null;
  error: string | null;
  /** Grava apelido e avatar via RPC. O cliente nunca escreve na tabela. */
  save: (name: string, avatar: AvatarSpec) => Promise<void>;
};

const SessionContext = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function boot() {
      try {
        // Dentro do try: se faltar variável de ambiente, isso lança aqui e a
        // mensagem chega na tela em vez de virar erro solto no console.
        const sb = supabaseBrowser();

        const { data } = await sb.auth.getSession();
        let current = data.session?.user ?? null;

        // Convidado é um auth.users de verdade — é isso que faz o RLS valer
        // igual para conta e convidado. Ver docs/00-PRD-PLATAFORMA.md §6.2.
        if (!current) {
          const { data: anon, error: authErr } = await sb.auth.signInAnonymously();
          if (authErr) throw authErr;
          current = anon.user;
        }
        if (!alive) return;
        setUser(current);

        const { data: row, error: profErr } = await sb
          .from("profiles")
          .select("*")
          .eq("id", current!.id)
          .single();
        if (profErr) throw profErr;
        if (!alive) return;

        setProfile(row as unknown as Profile);
        setStatus("ready");
      } catch (e) {
        if (!alive) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(
          /anonymous/i.test(msg)
            ? "Entrada de convidado está desligada no Supabase. Ligue em Authentication → Sign In / Providers → Anonymous sign-ins."
            : msg,
        );
        setStatus("error");
      }
    }

    boot();
    return () => {
      alive = false;
    };
  }, []);

  const save = useCallback(async (name: string, avatar: AvatarSpec) => {
    const sb = supabaseBrowser();
    const { data, error: rpcErr } = await sb.rpc("set_profile", {
      p_name: name,
      p_avatar: avatar,
    });
    if (rpcErr) throw rpcErr;
    setProfile(data as unknown as Profile);
  }, []);

  const value = useMemo<Ctx>(
    () => ({ status, user, profile, error, save }),
    [status, user, profile, error, save],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Ctx {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession fora do SessionProvider");
  return ctx;
}

/** Avatar do perfil, já validado, com o padrão como rede de segurança. */
export function useAvatar(): AvatarSpec {
  const { profile } = useSession();
  return profile ? parseAvatar(profile.avatar) : DEFAULT_AVATAR;
}
