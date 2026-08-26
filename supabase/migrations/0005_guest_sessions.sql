-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0005 · sessão de convidado sem depender do painel
--
-- `signInAnonymously()` exige "Anonymous sign-ins" ligado no dashboard do
-- Supabase. É um toggle fora do código, e enquanto ele estiver desligado
-- ninguém consegue nem criar sala.
--
-- Solução: /api/guest cria o usuário no servidor com service role e devolve a
-- sessão. Continua sendo um auth.users de verdade — então o RLS vale igual e
-- a conta pode ser promovida depois sem perder histórico (§6.2 do PRD 00).
-- Se o toggle estiver ligado, o cliente usa o caminho nativo e nem chama isso.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── is_guest também vem do metadata ────────────────────────────────────────
-- Usuário criado pela Admin API não é `is_anonymous`, então marcamos pelo
-- metadata que a rota grava.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, is_guest)
  values (
    new.id,
    coalesce(new.is_anonymous, false)
      or coalesce((new.raw_user_meta_data ->> 'guest')::boolean, false)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ── cota de criação de convidado ───────────────────────────────────────────
-- Sem RLS policy e sem grant: invisível para a API. Só o service role escreve.

create table if not exists public.guest_quota (
  ip_hash    text not null,
  day        date not null default current_date,
  n          integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (ip_hash, day)
);

alter table public.guest_quota enable row level security;
revoke all on public.guest_quota from anon, authenticated;

create or replace function public.bump_guest_quota(p_ip_hash text, p_limit integer default 40)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  atual integer;
begin
  insert into public.guest_quota (ip_hash, day, n)
  values (p_ip_hash, current_date, 1)
  on conflict (ip_hash, day)
    do update set n = public.guest_quota.n + 1, updated_at = now()
  returning n into atual;

  return atual <= p_limit;
end;
$$;

revoke all on function public.bump_guest_quota(text, integer) from anon, authenticated;

-- ── faxina de convidado abandonado ─────────────────────────────────────────
-- Convidado sem sala e sem perfil nomeado há mais de 30 dias vira lixo.

create or replace function public.sweep_guests()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removidos integer;
begin
  with lixo as (
    delete from auth.users u
     where u.id in (
       select p.id from public.profiles p
        where p.is_guest
          and p.display_name = 'Convidado'
          and p.created_at < now() - interval '30 days'
          and not exists (select 1 from public.room_members m where m.user_id = p.id)
     )
    returning 1
  )
  select count(*)::int into removidos from lixo;

  delete from public.guest_quota where day < current_date - 7;
  return removidos;
end;
$$;

revoke all on function public.sweep_guests() from anon, authenticated;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'mesa-sweep-guests') then
    perform cron.schedule('mesa-sweep-guests', '17 4 * * *', 'select public.sweep_guests()');
  end if;
exception when others then
  raise notice 'pg_cron indisponivel: %', sqlerrm;
end $$;
