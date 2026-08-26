-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0002 · lobby ao vivo
-- Assentos, cores, pronto, saída com migração de host.
-- Ver docs/00-PRD-PLATAFORMA.md §7.3 e §7.4
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Realtime ───────────────────────────────────────────────────────────────
-- Postgres Changes só chega ao cliente se a tabela estiver na publicação.
-- O RLS continua valendo: cada assinante recebe apenas o que pode ler.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'room_members'
  ) then
    alter publication supabase_realtime add table public.room_members;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rooms'
  ) then
    alter publication supabase_realtime add table public.rooms;
  end if;
end $$;

-- REPLICA IDENTITY FULL: sem isso o payload de UPDATE/DELETE vem só com a
-- chave primária, e o cliente não consegue reagir à mudança de cor ou pronto.
alter table public.room_members replica identity full;
alter table public.rooms replica identity full;

-- ── cores de assento ───────────────────────────────────────────────────────
-- O mesmo vocabulário dos avatares (lib/avatar.ts). Cor + hachura + brasão é
-- o identificador redundante que o daltonismo exige.

alter table public.room_members
  drop constraint if exists color_known;
alter table public.room_members
  add constraint color_known check (
    color is null or color in
      ('carmim','prussia','ocre','oliva','vinho','grafite','jade','terracota')
  );

-- ── pronto ─────────────────────────────────────────────────────────────────

create or replace function public.set_ready(p_room uuid, p_ready boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  update public.room_members
     set is_ready = p_ready, last_seen_at = now()
   where room_id = p_room and user_id = auth.uid();

  if not found then
    raise exception 'NOT_A_MEMBER';
  end if;
end;
$$;

-- ── cor ────────────────────────────────────────────────────────────────────
-- Exclusiva por sala: se alguém já pegou, recusa em vez de sobrescrever.

create or replace function public.set_color(p_room uuid, p_color text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if exists (
    select 1 from public.room_members
     where room_id = p_room and color = p_color and user_id <> auth.uid()
  ) then
    raise exception 'COLOR_TAKEN';
  end if;

  update public.room_members
     set color = p_color, last_seen_at = now()
   where room_id = p_room and user_id = auth.uid();

  if not found then
    raise exception 'NOT_A_MEMBER';
  end if;
end;
$$;

-- ── batida de presença ─────────────────────────────────────────────────────

create or replace function public.touch_presence(p_room uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.room_members
     set last_seen_at = now()
   where room_id = p_room and user_id = auth.uid();
end;
$$;

-- ── sair ───────────────────────────────────────────────────────────────────
-- Se quem sai era o host, o assento ativo de menor índice assume.
-- Ninguém precisa saber que isso aconteceu. §7.4 do PRD 00.

create or replace function public.leave_room(p_room uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  was_host boolean;
  next_host uuid;
  remaining int;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select (r.host_id = auth.uid()) into was_host
    from public.rooms r where r.id = p_room;

  if was_host is null then
    return; -- sala já não existe
  end if;

  delete from public.room_members
   where room_id = p_room and user_id = auth.uid();

  select count(*)::int into remaining
    from public.room_members where room_id = p_room;

  if remaining = 0 then
    delete from public.rooms where id = p_room;
    return;
  end if;

  if was_host then
    select user_id into next_host
      from public.room_members
     where room_id = p_room and seat is not null
     order by seat
     limit 1;

    if next_host is null then
      select user_id into next_host
        from public.room_members
       where room_id = p_room
       order by joined_at
       limit 1;
    end if;

    update public.rooms set host_id = next_host where id = p_room;
    update public.room_members set role = 'host'
     where room_id = p_room and user_id = next_host;
  end if;
end;
$$;

-- ── faxina: salas vencidas ─────────────────────────────────────────────────
-- pg_cron a cada 5 min. O PRD prevê varredura de turno a cada 10s, mas isso
-- só faz sentido quando existir partida; aqui basta limpar sala abandonada.

create extension if not exists pg_cron;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'mesa-sweep-expired') then
    perform cron.schedule('mesa-sweep-expired', '*/5 * * * *', 'select public.sweep_expired()');
  end if;
exception when others then
  raise notice 'pg_cron indisponivel: %', sqlerrm;
end $$;
