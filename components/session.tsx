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

/**
 * EXPORTADO PARA UM CONSUMIDOR SÓ: `npm run smoke:render`.
 *
 * As telas de jogo têm um ramo inteiro que só existe QUANDO É A SUA VEZ — os
 * botões de reforçar, atacar, comprar, construir, palpitar. É a metade da tela
 * que as pessoas de fato apertam, e ela era invisível para a auditoria do HTML:
 * a montagem não tem sessão, `minhaVez` é sempre falso, e o ramo nunca é
 * desenhado.
 *
 * A suíte serve uma sessão fingida para o assento da vez e passa a ver essa
 * metade. `SessionProvider` continua sendo o único caminho de produção — o que
 * está exposto aqui é o contexto, não uma porta nova para dentro dele.
 */
export const SessionContext = createContext<Ctx | null>(null);

export type SessionCtx = Ctx;

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
        //
        // Dois caminhos, nessa ordem:
        //   1. signInAnonymously — nativo, mais leve, mas depende de um toggle
        //      no dashboard do Supabase que pode estar desligado;
        //   2. /api/guest — o servidor cria o usuário com service role.
        //      Não depende de painel nenhum, então sempre funciona.
        if (!current) {
          const { data: anon, error: authErr } = await sb.auth.signInAnonymously();
          if (!authErr && anon.user) {
            current = anon.user;
          } else {
            const res = await fetch("/api/guest", { method: "POST" });
            const body = (await res.json()) as {
              access_token?: string;
              refresh_token?: string;
              message?: string;
            };
            if (!res.ok || !body.access_token || !body.refresh_token) {
              throw new Error(body.message ?? "Não foi possível abrir a sessão de convidado.");
            }
            const { data: sess, error: setErr } = await sb.auth.setSession({
              access_token: body.access_token,
              refresh_token: body.refresh_token,
            });
            if (setErr) throw setErr;
            current = sess.user;
          }
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
        setError(msg);
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
