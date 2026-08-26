-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0013 · a linha da partida não pode ser lida inteira
--
-- FALHA DE SEGURANÇA encontrada pelo teste de fumaça do Dossiê.
--
-- `grant select on public.matches to authenticated` concede TODAS as colunas.
-- Ao acrescentar `solution` nessa tabela (0011), o envelope do crime passou a
-- ser legível por qualquer jogador da sala com um simples
--
--     GET /rest/v1/matches?select=*
--
-- E pior: `dossie_start` devolve `public.matches`, então o anfitrião recebia a
-- solução na própria resposta de quem começou a partida.
--
-- Dois consertos, os dois necessários:
--   1. grant por COLUNA — `solution` e `seed` saem da lista;
--   2. as funções de começar passam a devolver jsonb redigido, nunca a linha.
--
-- Lição para os próximos jogos: RLS filtra LINHA, não COLUNA. Segredo em
-- coluna de tabela legível é segredo publicado.
-- ═══════════════════════════════════════════════════════════════════════════

revoke select on public.matches from anon, authenticated;

grant select (
  id, room_id, game_key, status, public_state, version,
  ends_at, turn_deadline, started_at, ended_at
) on public.matches to authenticated;

-- `solution`, `seed` e `board_id` ficam de fora. Só as funções SECURITY
-- DEFINER e o service_role alcançam.

-- ── começar: devolve jsonb redigido ────────────────────────────────────────

drop function if exists public.letreiro_start(uuid);

create or replace function public.letreiro_start(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sala      public.rooms;
  semente   bigint;
  tabuleiro public.letreiro_boards;
  segundos  int;
  nova      public.matches;
  membro    record;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into sala from public.rooms where id = p_room;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if sala.host_id <> auth.uid() then raise exception 'NOT_HOST'; end if;
  if sala.game_key <> 'letreiro' then raise exception 'WRONG_GAME'; end if;
  if exists (select 1 from public.matches m
              where m.room_id = p_room and m.status = 'running') then
    raise exception 'ALREADY_RUNNING';
  end if;

  segundos := case coalesce(sala.settings ->> 'modo', 'classico')
                when 'relampago' then 60 else 180 end;

  semente := (random() * 9223372036854775806)::bigint;

  select * into tabuleiro from public.letreiro_boards
   order by id
  offset (semente % greatest((select count(*) from public.letreiro_boards), 1))
   limit 1;
  if not found then raise exception 'NO_BOARDS'; end if;

  insert into public.matches (room_id, game_key, seed, board_id, ends_at, public_state)
  values (
    p_room, 'letreiro', semente, tabuleiro.id,
    now() + make_interval(secs => segundos),
    jsonb_build_object(
      'phase', 'round',
      'grid', to_jsonb(tabuleiro.grid),
      'size', tabuleiro.size,
      'mode', coalesce(sala.settings ->> 'modo', 'classico'),
      'scoring', coalesce(sala.settings ->> 'anulacao', 'classica'),
      'seconds', segundos,
      'counts', '{}'::jsonb
    )
  )
  returning * into nova;

  for membro in
    select user_id, seat from public.room_members
     where room_id = p_room and seat is not null
  loop
    insert into public.match_players (match_id, user_id, seat)
    values (nova.id, membro.user_id, membro.seat) on conflict do nothing;
    insert into public.match_private_state (match_id, user_id, data)
    values (nova.id, membro.user_id, jsonb_build_object('words', '[]'::jsonb))
    on conflict do nothing;
  end loop;

  update public.rooms set status = 'playing' where id = p_room;

  -- redigido: nem `seed`, nem `board_id`, nem `solution`
  return jsonb_build_object(
    'id', nova.id,
    'status', nova.status,
    'ends_at', nova.ends_at,
    'started_at', nova.started_at,
    'public_state', nova.public_state
  );
end;
$$;

drop function if exists public.dossie_start(uuid, text);

create or replace function public.dossie_start(p_room uuid, p_theme text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sala      public.rooms;
  tema      public.game_themes;
  semente   bigint;
  baralho   text[];
  sol_s     text;
  sol_w     text;
  sol_r     text;
  mao       text[];
  lugares   text[];
  armas     text[];
  susp      text[];
  membros   record;
  jogadores jsonb := '[]'::jsonb;
  posicoes  jsonb := '{}'::jsonb;
  pos_arma  jsonb := '{}'::jsonb;
  nova      public.matches;
  estado    jsonb;
  i         int := 0;
  total     int;
  idx       int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into sala from public.rooms where id = p_room;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if sala.host_id <> auth.uid() then raise exception 'NOT_HOST'; end if;
  if sala.game_key <> 'dossie' then raise exception 'WRONG_GAME'; end if;
  if exists (select 1 from public.matches where room_id = p_room and status = 'running') then
    raise exception 'ALREADY_RUNNING';
  end if;

  select count(*)::int into total from public.room_members
   where room_id = p_room and seat is not null;
  if total < 3 then raise exception 'NEED_THREE'; end if;

  if p_theme is not null then
    select * into tema from public.game_themes where id = p_theme and game_key = 'dossie';
  else
    select * into tema from public.game_themes
     where game_key = 'dossie' order by random() limit 1;
  end if;
  if not found then raise exception 'NO_THEME'; end if;

  semente := (random() * 9223372036854775806)::bigint;

  select array_agg(value ->> 'id') into susp    from jsonb_array_elements(tema.data -> 'suspects');
  select array_agg(value ->> 'id') into armas   from jsonb_array_elements(tema.data -> 'weapons');
  select array_agg(value ->> 'id') into lugares from jsonb_array_elements(tema.data -> 'rooms');

  sol_s := (public.shuffle_text(susp,    semente))[1];
  sol_w := (public.shuffle_text(armas,   semente + 7))[1];
  sol_r := (public.shuffle_text(lugares, semente + 13))[1];

  select public.shuffle_text(array_agg(c), semente + 29) into baralho
    from (select unnest(susp || armas || lugares) c) t
   where c not in (sol_s, sol_w, sol_r);

  for i in 1..array_length(armas, 1) loop
    pos_arma := pos_arma || jsonb_build_object(
      armas[i], (public.shuffle_text(lugares, semente + 100 + i))[1]
    );
  end loop;

  insert into public.matches (room_id, game_key, seed, solution, public_state, turn_deadline)
  values (
    p_room, 'dossie', semente,
    jsonb_build_object('suspect', sol_s, 'weapon', sol_w, 'room', sol_r),
    '{}'::jsonb, now() + interval '90 seconds'
  )
  returning * into nova;

  i := 0;
  for membros in
    select user_id, seat from public.room_members
     where room_id = p_room and seat is not null order by seat
  loop
    mao := '{}';
    idx := i + 1;
    while idx <= array_length(baralho, 1) loop
      mao := mao || baralho[idx];
      idx := idx + total;
    end loop;

    insert into public.match_players (match_id, user_id, seat)
    values (nova.id, membros.user_id, membros.seat);

    insert into public.match_private_state (match_id, user_id, data)
    values (nova.id, membros.user_id,
      jsonb_build_object('hand', to_jsonb(mao), 'seen', '[]'::jsonb, 'pad', '{}'::jsonb));

    jogadores := jogadores || jsonb_build_array(jsonb_build_object(
      'seat', membros.seat,
      'userId', membros.user_id,
      'suspect', susp[(i % array_length(susp, 1)) + 1],
      'hand', array_length(mao, 1)
    ));

    posicoes := posicoes || jsonb_build_object(
      membros.seat::text, (public.shuffle_text(lugares, semente + 200 + i))[1]
    );

    i := i + 1;
  end loop;

  estado := jsonb_build_object(
    'theme', tema.id,
    'phase', 'turn',
    'turnSeat', (select min(seat) from public.room_members
                  where room_id = p_room and seat is not null),
    'actionsLeft', 2,
    'positions', posicoes,
    'weapons', pos_arma,
    'players', jogadores,
    'ghosts', '[]'::jsonb,
    'accused', '[]'::jsonb,
    'pending', null,
    'seq', 0,
    'log', '[]'::jsonb
  );

  update public.matches set public_state = estado where id = nova.id;
  update public.rooms set status = 'playing' where id = p_room;

  -- redigido: a solução fica no banco, nunca na resposta
  return jsonb_build_object(
    'id', nova.id,
    'status', nova.status,
    'turn_deadline', nova.turn_deadline,
    'started_at', nova.started_at,
    'public_state', estado
  );
end;
$$;

revoke all on function public.letreiro_start(uuid)     from public;
revoke all on function public.dossie_start(uuid, text) from public;
grant execute on function public.letreiro_start(uuid)     to authenticated;
grant execute on function public.dossie_start(uuid, text) to authenticated;
