-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0045 · máquina só entra onde ela sabe jogar
--
-- `adicionar_bot` aceitava qualquer sala. Mas só o Letreiro tem cérebro de
-- máquina hoje. Uma máquina numa mesa de Domínio seria PIOR que uma cadeira
-- vazia: ela ocupa assento, recebe territórios e um objetivo secreto, e depois
-- perde a vez no relógio a cada turno para sempre. Os outros três jogam contra
-- um cadáver que segura seis territórios e um continente.
--
-- A trava fica no servidor, e não na interface, pela razão de sempre: o cliente
-- não é a autoridade. Esconder o botão impede o toque; só o servidor impede a
-- chamada.
--
-- A lista é o registro honesto de onde o trabalho chegou. Quando o cérebro do
-- Domínio existir, esta lista cresce em uma linha — e é a única coisa que
-- precisa mudar.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.bot_sabe_jogar(p_game text)
returns boolean
language sql
immutable
as $$
  select p_game = any (array['letreiro']);
$$;

comment on function public.bot_sabe_jogar(text) is
  'Onde existe cérebro de máquina. Cresce quando o cérebro do jogo existir.';

revoke all on function public.bot_sabe_jogar(text) from public, anon, authenticated;

create or replace function public.adicionar_bot(p_room uuid, p_nivel text default 'medio')
returns public.room_members
language plpgsql
security definer
set search_path = public
as $$
declare
  sala  public.rooms;
  livre smallint;
  cor   text;
  quem  uuid;
  saida public.room_members;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_nivel not in ('facil', 'medio', 'dificil') then raise exception 'BAD_LEVEL'; end if;

  select * into sala from public.rooms r where r.id = p_room;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if sala.host_id <> auth.uid() then raise exception 'NOT_HOST'; end if;
  if sala.status <> 'lobby' then raise exception 'MATCH_IN_PROGRESS'; end if;

  -- a trava nova: assento ocupado por quem não joga é pior que assento vazio
  if not public.bot_sabe_jogar(sala.game_key) then
    raise exception 'BOT_NOT_READY';
  end if;

  -- o primeiro assento livre, do mesmo jeito que `join_room` faz
  select min(s) into livre
    from generate_series(0, 7) s
   where s not in (
     select seat from public.room_members
      where room_id = p_room and seat is not null
   );
  if livre is null then raise exception 'ROOM_FULL'; end if;

  select p.id into quem
    from public.profiles p
   where p.is_bot
     and p.id not in (select user_id from public.room_members where room_id = p_room)
   order by md5(p_room::text || p.id::text)
   limit 1;
  if quem is null then raise exception 'NO_BOT_AVAILABLE'; end if;

  -- uma cor que ninguém na sala esteja usando
  select c into cor
    from unnest(array['carmim','terracota','ocre','oliva','jade','grafite','prussia','vinho']) c
   where c not in (
     select color from public.room_members
      where room_id = p_room and color is not null
   )
   limit 1;

  insert into public.room_members (room_id, user_id, seat, color, role, is_ready, bot_nivel)
  values (p_room, quem, livre, cor, 'player', true, p_nivel)
  returning * into saida;

  return saida;
end;
$$;

revoke all on function public.adicionar_bot(uuid, text) from public, anon, authenticated;
grant execute on function public.adicionar_bot(uuid, text) to authenticated;
