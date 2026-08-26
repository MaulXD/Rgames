-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0012 · Dossiê: as ações
--
-- Regra de ouro deste arquivo: a carta mostrada numa refutação entra no
-- estado PRIVADO de quem pediu o palpite e no log público entra apenas QUEM
-- mostrou. Se a carta aparecer em `public_state` uma vez, o jogo acabou.
-- ═══════════════════════════════════════════════════════════════════════════

/** Passa a vez: próximo assento não-fantasma, 2 ações, prazo novo. */
create or replace function public.dossie_advance(p_match uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m       public.matches;
  prox    smallint;
  estado  jsonb;
begin
  select * into m from public.matches where id = p_match;
  estado := m.public_state;

  prox := public.dossie_next_seat(estado, (estado ->> 'turnSeat')::smallint);

  if prox is null then
    -- todos viraram fantasma: o envelope é aberto e ninguém venceu
    update public.matches
       set status = 'finished',
           ended_at = now(),
           version = version + 1,
           turn_deadline = null,
           public_state = estado || jsonb_build_object(
             'phase', 'over',
             'winner', null,
             'solution', m.solution,
             'pending', null
           )
     where id = p_match;
    update public.rooms set status = 'lobby' where id = m.room_id;
    return;
  end if;

  update public.matches
     set version = version + 1,
         turn_deadline = now() + interval '90 seconds',
         public_state = estado || jsonb_build_object(
           'phase', 'turn',
           'turnSeat', prox,
           'actionsLeft', 2,
           'pending', null
         )
   where id = p_match;
end;
$$;

/** Anexa uma linha ao log público, com número de sequência. */
create or replace function public.dossie_log(p_state jsonb, p_entry jsonb)
returns jsonb
language sql
immutable
as $$
  select p_state
    || jsonb_build_object('seq', coalesce((p_state ->> 'seq')::int, 0) + 1)
    || jsonb_build_object(
         'log',
         (
           select jsonb_agg(x) from (
             select x from jsonb_array_elements(
               coalesce(p_state -> 'log', '[]'::jsonb)
               || jsonb_build_array(
                    p_entry || jsonb_build_object('seq', coalesce((p_state ->> 'seq')::int, 0) + 1)
                  )
             ) x
             order by (x ->> 'seq')::int desc
             limit 60
           ) t
         )
       );
$$;

-- ── começar ────────────────────────────────────────────────────────────────

create or replace function public.dossie_start(p_room uuid, p_theme text default null)
returns public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
  sala     public.rooms;
  tema     public.game_themes;
  semente  bigint;
  baralho  text[];
  sol_s    text;
  sol_w    text;
  sol_r    text;
  mao      text[];
  lugares  text[];
  armas    text[];
  susp     text[];
  membros  record;
  jogadores jsonb := '[]'::jsonb;
  posicoes jsonb := '{}'::jsonb;
  pos_arma jsonb := '{}'::jsonb;
  nova     public.matches;
  i        int := 0;
  total    int;
  idx      int;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

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

  -- tema: escolhido, sorteado, ou o único disponível
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

  -- envelope: um de cada tipo
  sol_s := (public.shuffle_text(susp,    semente))[1];
  sol_w := (public.shuffle_text(armas,   semente + 7))[1];
  sol_r := (public.shuffle_text(lugares, semente + 13))[1];

  -- as 18 restantes, embaralhadas
  select public.shuffle_text(array_agg(c), semente + 29) into baralho
    from (
      select unnest(susp || armas || lugares) c
    ) t
   where c not in (sol_s, sol_w, sol_r);

  -- armas espalhadas pelos lugares
  for i in 1..array_length(armas, 1) loop
    pos_arma := pos_arma || jsonb_build_object(
      armas[i], (public.shuffle_text(lugares, semente + 100 + i))[1]
    );
  end loop;

  insert into public.matches (room_id, game_key, seed, solution, public_state, turn_deadline)
  values (
    p_room, 'dossie', semente,
    jsonb_build_object('suspect', sol_s, 'weapon', sol_w, 'room', sol_r),
    '{}'::jsonb,
    now() + interval '90 seconds'
  )
  returning * into nova;

  -- distribui: assento i recebe as cartas i, i+total, i+2*total…
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
    values (
      nova.id, membros.user_id,
      jsonb_build_object('hand', to_jsonb(mao), 'seen', '[]'::jsonb, 'pad', '{}'::jsonb)
    );

    jogadores := jogadores || jsonb_build_array(jsonb_build_object(
      'seat', membros.seat,
      'userId', membros.user_id,
      'suspect', susp[(i % array_length(susp, 1)) + 1],
      'hand', array_length(mao, 1)
    ));

    posicoes := posicoes || jsonb_build_object(
      membros.seat::text,
      (public.shuffle_text(lugares, semente + 200 + i))[1]
    );

    i := i + 1;
  end loop;

  update public.matches
     set public_state = jsonb_build_object(
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
     )
   where id = nova.id
  returning * into nova;

  update public.rooms set status = 'playing' where id = p_room;
  return nova;
end;
$$;

-- ── mover ──────────────────────────────────────────────────────────────────

create or replace function public.dossie_move(p_match uuid, p_room text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m      public.matches;
  tema   jsonb;
  estado jsonb;
  meu    smallint;
  aqui   text;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;
  estado := m.public_state;

  select seat into meu from public.match_players
   where match_id = p_match and user_id = auth.uid();
  if meu is null then raise exception 'NOT_A_PLAYER'; end if;
  if (estado ->> 'turnSeat')::smallint <> meu then raise exception 'NOT_YOUR_TURN'; end if;
  if estado ->> 'phase' <> 'turn' then raise exception 'WRONG_PHASE'; end if;
  if (estado ->> 'actionsLeft')::int < 1 then raise exception 'NO_ACTIONS'; end if;

  select data into tema from public.game_themes where id = estado ->> 'theme';
  aqui := estado -> 'positions' ->> meu::text;

  if not public.dossie_can_move(tema, aqui, p_room) then
    raise exception 'UNREACHABLE';
  end if;

  estado := jsonb_set(estado, array['positions', meu::text], to_jsonb(p_room));
  estado := jsonb_set(estado, '{actionsLeft}', to_jsonb((estado ->> 'actionsLeft')::int - 1));
  estado := public.dossie_log(estado, jsonb_build_object('type', 'move', 'seat', meu, 'room', p_room));

  update public.matches set public_state = estado, version = version + 1 where id = p_match;

  if (estado ->> 'actionsLeft')::int = 0 then
    perform public.dossie_advance(p_match);
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- ── palpitar ───────────────────────────────────────────────────────────────

create or replace function public.dossie_suggest(p_match uuid, p_suspect text, p_weapon text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m       public.matches;
  tema    jsonb;
  estado  jsonb;
  meu     smallint;
  aqui    text;
  fila    smallint[];
  outros  smallint[];
  n       int;
  idx     int;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;
  estado := m.public_state;

  select seat into meu from public.match_players
   where match_id = p_match and user_id = auth.uid();
  if meu is null then raise exception 'NOT_A_PLAYER'; end if;
  if (estado ->> 'turnSeat')::smallint <> meu then raise exception 'NOT_YOUR_TURN'; end if;
  if estado ->> 'phase' <> 'turn' then raise exception 'WRONG_PHASE'; end if;
  if (estado ->> 'actionsLeft')::int < 1 then raise exception 'NO_ACTIONS'; end if;

  select data into tema from public.game_themes where id = estado ->> 'theme';

  if public.dossie_card_kind(tema, p_suspect) <> 'suspect'
     or public.dossie_card_kind(tema, p_weapon) <> 'weapon' then
    raise exception 'BAD_GUESS';
  end if;

  aqui := estado -> 'positions' ->> meu::text;
  if aqui is null then raise exception 'NOT_IN_A_ROOM'; end if;

  -- o suspeito e o objeto nomeados são movidos para cá
  estado := jsonb_set(estado, array['weapons', p_weapon], to_jsonb(aqui));

  -- se o suspeito nomeado é o peão de alguém, ele vem também
  select array_agg((value ->> 'seat')::smallint)
    into outros
    from jsonb_array_elements(estado -> 'players')
   where value ->> 'suspect' = p_suspect;
  if outros is not null then
    foreach idx in array outros loop
      estado := jsonb_set(estado, array['positions', idx::text], to_jsonb(aqui));
    end loop;
  end if;

  -- fila de refutação: a partir do próximo assento, dando a volta, sem mim.
  -- Fantasma continua na fila: se ele sair, o jogo perde informação.
  select array_agg(seat order by seat) into fila
    from public.match_players where match_id = p_match;
  n := array_length(fila, 1);
  idx := array_position(fila, meu);
  outros := '{}';
  for i in 1..(n - 1) loop
    outros := outros || fila[((idx - 1 + i) % n) + 1];
  end loop;

  estado := jsonb_set(estado, '{actionsLeft}', to_jsonb(0));
  estado := estado || jsonb_build_object(
    'phase', 'refute',
    'pending', jsonb_build_object(
      'bySeat', meu,
      'guess', jsonb_build_array(p_suspect, p_weapon, aqui),
      'queue', to_jsonb(outros),
      'at', 0
    )
  );
  estado := public.dossie_log(estado, jsonb_build_object(
    'type', 'suggest', 'seat', meu,
    'guess', jsonb_build_array(p_suspect, p_weapon, aqui)
  ));

  update public.matches
     set public_state = estado, version = version + 1,
         turn_deadline = now() + interval '30 seconds'
   where id = p_match;

  return jsonb_build_object('ok', true);
end;
$$;

-- ── refutar ────────────────────────────────────────────────────────────────

create or replace function public.dossie_refute(p_match uuid, p_card text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m        public.matches;
  estado   jsonb;
  pend     jsonb;
  meu      smallint;
  atual    smallint;
  pedinte  uuid;
  tenho    boolean;
  no_palpite boolean;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;
  estado := m.public_state;
  pend := estado -> 'pending';
  if pend is null or estado ->> 'phase' <> 'refute' then raise exception 'NOTHING_TO_REFUTE'; end if;

  select seat into meu from public.match_players
   where match_id = p_match and user_id = auth.uid();
  if meu is null then raise exception 'NOT_A_PLAYER'; end if;

  atual := (pend -> 'queue' ->> (pend ->> 'at')::int)::smallint;
  if atual is distinct from meu then raise exception 'NOT_YOUR_REFUTE'; end if;

  -- a carta tem de estar de fato na mão, e ser uma das três do palpite
  select exists (
    select 1 from public.match_private_state mps,
      jsonb_array_elements_text(mps.data -> 'hand') c
     where mps.match_id = p_match and mps.user_id = auth.uid() and c = p_card
  ) into tenho;
  if not tenho then raise exception 'NOT_IN_HAND'; end if;

  select exists (
    select 1 from jsonb_array_elements_text(pend -> 'guess') g where g = p_card
  ) into no_palpite;
  if not no_palpite then raise exception 'NOT_IN_GUESS'; end if;

  -- a carta vai para o estado PRIVADO de quem palpitou. Nunca para o público.
  select user_id into pedinte from public.match_players
   where match_id = p_match and seat = (pend ->> 'bySeat')::smallint;

  update public.match_private_state
     set data = jsonb_set(
           data, '{seen}',
           (data -> 'seen') || jsonb_build_object(
             'card', p_card, 'from', meu, 'seq', coalesce((estado ->> 'seq')::int, 0) + 1
           )
         )
   where match_id = p_match and user_id = pedinte;

  -- no log, só QUEM mostrou
  estado := public.dossie_log(estado, jsonb_build_object('type', 'refute', 'seat', meu));
  estado := estado || jsonb_build_object('pending', null);

  update public.matches set public_state = estado, version = version + 1 where id = p_match;
  perform public.dossie_advance(p_match);

  return jsonb_build_object('ok', true);
end;
$$;

/** Passar a refutação: o servidor confere que você realmente não tem nenhuma. */
create or replace function public.dossie_pass_refute(p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m      public.matches;
  estado jsonb;
  pend   jsonb;
  meu    smallint;
  atual  smallint;
  tenho  boolean;
  prox   int;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;
  estado := m.public_state;
  pend := estado -> 'pending';
  if pend is null or estado ->> 'phase' <> 'refute' then raise exception 'NOTHING_TO_REFUTE'; end if;

  select seat into meu from public.match_players
   where match_id = p_match and user_id = auth.uid();
  atual := (pend -> 'queue' ->> (pend ->> 'at')::int)::smallint;
  if atual is distinct from meu then raise exception 'NOT_YOUR_REFUTE'; end if;

  -- É AQUI que se impede a trapaça mais óbvia do jogo: "esquecer" de refutar.
  select exists (
    select 1
      from public.match_private_state mps,
           jsonb_array_elements_text(mps.data -> 'hand') c,
           jsonb_array_elements_text(pend -> 'guess') g
     where mps.match_id = p_match and mps.user_id = auth.uid() and c = g
  ) into tenho;
  if tenho then raise exception 'YOU_MUST_REFUTE'; end if;

  estado := public.dossie_log(estado, jsonb_build_object('type', 'pass', 'seat', meu));
  prox := (pend ->> 'at')::int + 1;

  if prox >= jsonb_array_length(pend -> 'queue') then
    -- ninguém pôde refutar: a linha mais importante do jogo
    estado := public.dossie_log(estado, jsonb_build_object(
      'type', 'no_refute', 'guess', pend -> 'guess'
    ));
    estado := estado || jsonb_build_object('pending', null);
    update public.matches set public_state = estado, version = version + 1 where id = p_match;
    perform public.dossie_advance(p_match);
  else
    estado := jsonb_set(estado, '{pending,at}', to_jsonb(prox));
    update public.matches
       set public_state = estado, version = version + 1,
           turn_deadline = now() + interval '30 seconds'
     where id = p_match;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- ── fechar o caso ──────────────────────────────────────────────────────────

create or replace function public.dossie_accuse(
  p_match uuid, p_suspect text, p_weapon text, p_room text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m       public.matches;
  estado  jsonb;
  meu     smallint;
  acertou boolean;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;
  estado := m.public_state;

  select seat into meu from public.match_players
   where match_id = p_match and user_id = auth.uid();
  if meu is null then raise exception 'NOT_A_PLAYER'; end if;
  if (estado ->> 'turnSeat')::smallint <> meu then raise exception 'NOT_YOUR_TURN'; end if;
  if exists (select 1 from jsonb_array_elements_text(estado -> 'accused') a
              where a::smallint = meu) then
    raise exception 'ALREADY_ACCUSED';
  end if;

  acertou := (m.solution ->> 'suspect' = p_suspect)
         and (m.solution ->> 'weapon'  = p_weapon)
         and (m.solution ->> 'room'    = p_room);

  estado := jsonb_set(estado, '{accused}', (estado -> 'accused') || to_jsonb(meu));
  estado := public.dossie_log(estado, jsonb_build_object(
    'type', 'accuse', 'seat', meu, 'right', acertou,
    'guess', jsonb_build_array(p_suspect, p_weapon, p_room)
  ));

  if acertou then
    update public.matches
       set status = 'finished', ended_at = now(), version = version + 1, turn_deadline = null,
           public_state = estado || jsonb_build_object(
             'phase', 'over', 'winner', meu, 'solution', m.solution, 'pending', null
           )
     where id = p_match;
    update public.rooms set status = 'lobby' where id = m.room_id;
    return jsonb_build_object('ok', true, 'right', true);
  end if;

  -- errou: vira fantasma. Continua refutando, não pode mais vencer.
  estado := jsonb_set(estado, '{ghosts}', (estado -> 'ghosts') || to_jsonb(meu));
  update public.matches set public_state = estado, version = version + 1 where id = p_match;
  perform public.dossie_advance(p_match);

  return jsonb_build_object('ok', true, 'right', false);
end;
$$;

-- ── passar a vez e o caderno ───────────────────────────────────────────────

create or replace function public.dossie_end_turn(p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m      public.matches;
  meu    smallint;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;
  select seat into meu from public.match_players
   where match_id = p_match and user_id = auth.uid();
  if (m.public_state ->> 'turnSeat')::smallint is distinct from meu then
    raise exception 'NOT_YOUR_TURN';
  end if;
  if m.public_state ->> 'phase' <> 'turn' then raise exception 'WRONG_PHASE'; end if;

  perform public.dossie_advance(p_match);
  return jsonb_build_object('ok', true);
end;
$$;

/** O caderno é seu: nenhuma validação de regra, só o dono escreve. */
create or replace function public.dossie_pad(p_match uuid, p_pad jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  update public.match_private_state
     set data = jsonb_set(data, '{pad}', coalesce(p_pad, '{}'::jsonb))
   where match_id = p_match and user_id = auth.uid();
  if not found then raise exception 'NOT_A_PLAYER'; end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ── varredura de prazo ─────────────────────────────────────────────────────
-- Ninguém segura a partida. Prazo estourado: passa a vez, ou refuta sozinho.

create or replace function public.dossie_sweep()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  m      record;
  pend   jsonb;
  atual  smallint;
  quem   uuid;
  carta  text;
  n      int := 0;
begin
  for m in
    select id, public_state from public.matches
     where game_key = 'dossie' and status = 'running' and turn_deadline < now()
  loop
    pend := m.public_state -> 'pending';

    if pend is null then
      perform public.dossie_advance(m.id);
    else
      atual := (pend -> 'queue' ->> (pend ->> 'at')::int)::smallint;
      select user_id into quem from public.match_players
       where match_id = m.id and seat = atual;

      -- a jogada conservadora: mostra a primeira que tem
      select c into carta
        from public.match_private_state mps,
             jsonb_array_elements_text(mps.data -> 'hand') c,
             jsonb_array_elements_text(pend -> 'guess') g
       where mps.match_id = m.id and mps.user_id = quem and c = g
       limit 1;

      if carta is null then
        perform public.dossie_force_pass(m.id, atual);
      else
        perform public.dossie_force_refute(m.id, atual, carta);
      end if;
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;

/** Versões internas de refutar/passar, sem checar auth.uid(). */
create or replace function public.dossie_force_refute(p_match uuid, p_seat smallint, p_card text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m       public.matches;
  estado  jsonb;
  pedinte uuid;
begin
  select * into m from public.matches where id = p_match for update;
  estado := m.public_state;
  select user_id into pedinte from public.match_players
   where match_id = p_match and seat = (estado -> 'pending' ->> 'bySeat')::smallint;

  update public.match_private_state
     set data = jsonb_set(data, '{seen}', (data -> 'seen') || jsonb_build_object(
           'card', p_card, 'from', p_seat, 'seq', coalesce((estado ->> 'seq')::int, 0) + 1, 'auto', true
         ))
   where match_id = p_match and user_id = pedinte;

  estado := public.dossie_log(estado, jsonb_build_object('type', 'refute', 'seat', p_seat, 'auto', true));
  estado := estado || jsonb_build_object('pending', null);
  update public.matches set public_state = estado, version = version + 1 where id = p_match;
  perform public.dossie_advance(p_match);
end;
$$;

create or replace function public.dossie_force_pass(p_match uuid, p_seat smallint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m      public.matches;
  estado jsonb;
  pend   jsonb;
  prox   int;
begin
  select * into m from public.matches where id = p_match for update;
  estado := m.public_state;
  pend := estado -> 'pending';
  estado := public.dossie_log(estado, jsonb_build_object('type', 'pass', 'seat', p_seat, 'auto', true));
  prox := (pend ->> 'at')::int + 1;

  if prox >= jsonb_array_length(pend -> 'queue') then
    estado := public.dossie_log(estado, jsonb_build_object('type', 'no_refute', 'guess', pend -> 'guess'));
    estado := estado || jsonb_build_object('pending', null);
    update public.matches set public_state = estado, version = version + 1 where id = p_match;
    perform public.dossie_advance(p_match);
  else
    estado := jsonb_set(estado, '{pending,at}', to_jsonb(prox));
    update public.matches
       set public_state = estado, version = version + 1,
           turn_deadline = now() + interval '30 seconds'
     where id = p_match;
  end if;
end;
$$;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'mesa-dossie-sweep') then
    perform cron.schedule('mesa-dossie-sweep', '10 seconds', 'select public.dossie_sweep()');
  end if;
exception when others then
  raise notice 'pg_cron indisponivel: %', sqlerrm;
end $$;

-- ── permissões ─────────────────────────────────────────────────────────────

revoke all on function public.dossie_advance(uuid)                     from public;
revoke all on function public.dossie_log(jsonb, jsonb)                 from public;
revoke all on function public.dossie_sweep()                           from public;
revoke all on function public.dossie_force_refute(uuid, smallint, text) from public;
revoke all on function public.dossie_force_pass(uuid, smallint)        from public;
revoke all on function public.shuffle_text(text[], bigint)             from public;
revoke all on function public.dossie_can_move(jsonb, text, text)       from public;
revoke all on function public.dossie_card_kind(jsonb, text)            from public;
revoke all on function public.dossie_next_seat(jsonb, smallint)        from public;

revoke all on function public.dossie_start(uuid, text)                     from public;
revoke all on function public.dossie_move(uuid, text)                      from public;
revoke all on function public.dossie_suggest(uuid, text, text)             from public;
revoke all on function public.dossie_refute(uuid, text)                    from public;
revoke all on function public.dossie_pass_refute(uuid)                     from public;
revoke all on function public.dossie_accuse(uuid, text, text, text)        from public;
revoke all on function public.dossie_end_turn(uuid)                        from public;
revoke all on function public.dossie_pad(uuid, jsonb)                      from public;

grant execute on function public.dossie_start(uuid, text)                  to authenticated;
grant execute on function public.dossie_move(uuid, text)                   to authenticated;
grant execute on function public.dossie_suggest(uuid, text, text)          to authenticated;
grant execute on function public.dossie_refute(uuid, text)                 to authenticated;
grant execute on function public.dossie_pass_refute(uuid)                  to authenticated;
grant execute on function public.dossie_accuse(uuid, text, text, text)     to authenticated;
grant execute on function public.dossie_end_turn(uuid)                     to authenticated;
grant execute on function public.dossie_pad(uuid, jsonb)                   to authenticated;
