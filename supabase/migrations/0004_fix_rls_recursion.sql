-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0004 · conserta recursão infinita no RLS
--
-- Sintoma: toda leitura de profiles, rooms e room_members voltava
--   42P17  infinite recursion detected in policy for relation "room_members"
--
-- Causa: a policy de SELECT de room_members perguntava "sou membro desta
-- sala?" consultando room_members — e essa consulta dispara a mesma policy,
-- que consulta de novo. As policies de rooms e profiles também passavam por
-- room_members, então caíam na mesma armadilha.
--
-- Conserto: a pergunta de pertencimento sai da policy e vai para uma função
-- SECURITY DEFINER, que roda como dona da tabela e não reentra no RLS.
-- É o padrão para qualquer policy que precise olhar a própria tabela.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── auxiliares ─────────────────────────────────────────────────────────────
-- STABLE para o planejador poder cachear dentro da mesma consulta.

create or replace function public.is_room_member(p_room uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.room_members
     where room_id = p_room and user_id = auth.uid()
  );
$$;

create or replace function public.shares_room_with(p_user uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
      from public.room_members mine
      join public.room_members theirs on theirs.room_id = mine.room_id
     where mine.user_id = auth.uid()
       and theirs.user_id = p_user
  );
$$;

revoke all on function public.is_room_member(uuid)   from anon;
revoke all on function public.shares_room_with(uuid) from anon;
grant execute on function public.is_room_member(uuid)   to authenticated;
grant execute on function public.shares_room_with(uuid) to authenticated;

-- ── policies reescritas ────────────────────────────────────────────────────

drop policy if exists "membros veem os outros membros" on public.room_members;
create policy "membros veem os outros membros"
  on public.room_members for select
  using (
    user_id = auth.uid()
    or public.is_room_member(room_id)
  );

drop policy if exists "membros leem a sala" on public.rooms;
create policy "membros leem a sala"
  on public.rooms for select
  using (public.is_room_member(id));

drop policy if exists "perfil visivel para quem divide sala" on public.profiles;
create policy "perfil visivel para quem divide sala"
  on public.profiles for select
  using (
    id = auth.uid()
    or public.shares_room_with(id)
  );
