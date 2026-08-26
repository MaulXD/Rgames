-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0001 · identidade e salas
-- Ver docs/00-PRD-PLATAFORMA.md §8.3 e §8.4
--
-- Princípio: NENHUMA tabela tem policy de escrita para o cliente.
-- Toda mutação passa por função SECURITY DEFINER.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── perfis ─────────────────────────────────────────────────────────────────
-- Convidado e conta são o mesmo tipo de linha. O convidado nasce de
-- signInAnonymously(), então é um auth.users de verdade e o RLS vale igual.

create table if not exists public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  display_name text not null default 'Convidado',
  avatar       jsonb not null default '{}'::jsonb,
  is_guest     boolean not null default true,
  stats        jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint display_name_len check (char_length(display_name) between 2 and 16)
);

alter table public.profiles enable row level security;

-- (a policy de leitura de perfis vive depois de room_members — ela depende dela)

-- cria o perfil junto com o usuário
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, is_guest)
  values (new.id, coalesce(new.is_anonymous, true))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── salas ──────────────────────────────────────────────────────────────────

create table if not exists public.rooms (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  host_id    uuid not null references public.profiles on delete cascade,
  game_key   text not null,
  status     text not null default 'lobby',
  settings   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  constraint code_shape check (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$'),
  constraint game_known check (game_key in ('letreiro','dossie','dominio','metropole')),
  constraint status_known check (status in ('lobby','playing','scoring','archived'))
);

create index if not exists rooms_code_idx on public.rooms (code);
create index if not exists rooms_expires_idx on public.rooms (expires_at);

alter table public.rooms enable row level security;

-- ── membros ────────────────────────────────────────────────────────────────

create table if not exists public.room_members (
  room_id      uuid not null references public.rooms on delete cascade,
  user_id      uuid not null references public.profiles on delete cascade,
  seat         smallint,
  color        text,
  role         text not null default 'player',
  is_ready     boolean not null default false,
  joined_at    timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (room_id, user_id),
  constraint role_known check (role in ('host','player','spectator')),
  constraint seat_range check (seat is null or seat between 0 and 7)
);

create unique index if not exists room_seat_unique
  on public.room_members (room_id, seat) where seat is not null;

alter table public.room_members enable row level security;

drop policy if exists "membros veem os outros membros" on public.room_members;
create policy "membros veem os outros membros"
  on public.room_members for select
  using (
    exists (
      select 1 from public.room_members mine
      where mine.room_id = room_members.room_id and mine.user_id = auth.uid()
    )
  );

-- ── policies que dependem de mais de uma tabela ────────────────────────────
-- Sem policy de INSERT/UPDATE/DELETE em nenhuma delas: só SECURITY DEFINER escreve.

drop policy if exists "membros leem a sala" on public.rooms;
create policy "membros leem a sala"
  on public.rooms for select
  using (
    exists (
      select 1 from public.room_members m
      where m.room_id = rooms.id and m.user_id = auth.uid()
    )
  );

drop policy if exists "perfil visivel para quem divide sala" on public.profiles;
create policy "perfil visivel para quem divide sala"
  on public.profiles for select
  using (
    id = auth.uid()
    or exists (
      select 1
      from public.room_members mine
      join public.room_members theirs on theirs.room_id = mine.room_id
      where mine.user_id = auth.uid() and theirs.user_id = public.profiles.id
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- Funções — o único caminho de escrita
-- ═══════════════════════════════════════════════════════════════════════════

-- perfil: apelido e avatar
create or replace function public.set_profile(p_name text, p_avatar jsonb)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.profiles;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  update public.profiles
     set display_name = coalesce(nullif(btrim(p_name), ''), display_name),
         avatar       = coalesce(p_avatar, avatar),
         updated_at   = now()
   where id = auth.uid()
  returning * into result;

  if not found then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  return result;
end;
$$;

-- gera um código de sala com o alfabeto sem ambiguidade
create or replace function public.gen_room_code()
returns text
language plpgsql
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  out_code text;
  i int;
begin
  loop
    out_code := '';
    for i in 1..6 loop
      out_code := out_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.rooms r where r.code = out_code);
  end loop;
  return out_code;
end;
$$;

-- criar sala: quem cria vira host e ocupa o assento 0
create or replace function public.create_room(p_game text)
returns public.rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  new_room public.rooms;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  insert into public.rooms (code, host_id, game_key)
  values (public.gen_room_code(), auth.uid(), p_game)
  returning * into new_room;

  insert into public.room_members (room_id, user_id, seat, role)
  values (new_room.id, auth.uid(), 0, 'host');

  return new_room;
end;
$$;

-- entrar na sala pelo código: pega o menor assento livre
create or replace function public.join_room(p_code text)
returns public.rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.rooms;
  free_seat smallint;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into target from public.rooms
   where code = upper(btrim(p_code)) and expires_at > now();

  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  if exists (select 1 from public.room_members m
              where m.room_id = target.id and m.user_id = auth.uid()) then
    update public.room_members set last_seen_at = now()
     where room_id = target.id and user_id = auth.uid();
    return target;
  end if;

  select min(s) into free_seat
    from generate_series(0, 7) as s
   where s not in (
     select seat from public.room_members
      where room_id = target.id and seat is not null
   );

  insert into public.room_members (room_id, user_id, seat, role)
  values (target.id, auth.uid(), free_seat,
          case when free_seat is null then 'spectator' else 'player' end);

  return target;
end;
$$;

-- ── faxina: salas vencidas e convidados abandonados ────────────────────────
create or replace function public.sweep_expired()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.rooms where expires_at < now();
$$;

revoke all on function public.sweep_expired() from anon, authenticated;
