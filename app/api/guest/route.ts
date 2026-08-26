import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * Sessão de convidado, criada no servidor.
 *
 * O caminho nativo (`signInAnonymously`) depende de um toggle no dashboard do
 * Supabase. Enquanto ele estiver desligado, ninguém entra — nem para criar
 * sala. Esta rota resolve com service role e não depende de painel nenhum.
 *
 * O convidado continua sendo um `auth.users` de verdade: o RLS vale igual ao
 * de uma conta, e depois dá para promover para conta permanente mantendo o
 * mesmo `user_id` e todo o histórico. Ver docs/00-PRD-PLATAFORMA.md §6.2.
 *
 * A `service_role` NUNCA sai daqui. Só os tokens da sessão nova voltam.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GUEST_DOMAIN = "convidado.mesa.local";

function ipHash(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "desconhecido";
  const salt = process.env.SUPABASE_JWT_SECRET ?? "mesa";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anon || !service) {
    return NextResponse.json(
      {
        error: "CONFIG",
        message:
          "Faltam variáveis no servidor: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY ou SUPABASE_SERVICE_ROLE_KEY. Defina em Vercel → Settings → Environment Variables.",
      },
      { status: 500 },
    );
  }

  const admin = createClient(url, service, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // cota por IP e por dia — evita que a rota vire fábrica de usuários
  const { data: dentro, error: quotaErr } = await admin.rpc("bump_guest_quota", {
    p_ip_hash: ipHash(req),
  });
  if (quotaErr) {
    return NextResponse.json({ error: "QUOTA", message: quotaErr.message }, { status: 500 });
  }
  if (dentro === false) {
    return NextResponse.json(
      { error: "RATE_LIMITED", message: "Muitas entradas de convidado hoje deste endereço." },
      { status: 429 },
    );
  }

  const id = randomUUID();
  const email = `convidado-${id}@${GUEST_DOMAIN}`;
  const password = `${randomUUID()}${randomUUID()}`;

  const { error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { guest: true },
  });
  if (createErr) {
    return NextResponse.json({ error: "CREATE", message: createErr.message }, { status: 500 });
  }

  // entra como o próprio convidado para obter a sessão que vai para o cliente
  const asGuest = createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error: signInErr } = await asGuest.auth.signInWithPassword({ email, password });

  if (signInErr || !data.session) {
    return NextResponse.json(
      { error: "SIGNIN", message: signInErr?.message ?? "Sessão não veio." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
}
