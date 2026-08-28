-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0086 · a rodada do Dossiê passa a existir
--
-- As três reviravoltas do PRD 03 §6.7 são todas contadas em RODADAS:
--
--   Apagão      uma rodada sorteada entre a 4 e a 8
--   Tempestade  o vento vira a cada 3, com aviso uma antes
--   Registro    um fato público a cada 4
--
-- E o estado do Dossiê não tinha rodada nenhuma. Tinha `turnSeat`, que é de
-- quem é a vez — outra coisa. Escrever as três reviravoltas em cima de um
-- contador que não existe seria escrever três vezes o mesmo contador, cada uma
-- com uma definição ligeiramente diferente de "rodada".
--
-- COMO SE CONTA UMA RODADA quando gente vira fantasma no meio: a rodada vira
-- quando o turno DÁ A VOLTA — quando o próximo assento não é maior que o atual.
-- Continua certo quando o assento 2 vira fantasma e a ordem passa a ser
-- 0 → 1 → 3 → 0, e continua certo quando sobra um jogador só, caso em que
-- `prox = atual` e o `<=` pega.
--
-- A alternativa óbvia — "contei N turnos, logo passou uma rodada" — quebra
-- exatamente aí: o número de turnos por rodada muda quando alguém é eliminado.
--
-- PARTIDAS EM ANDAMENTO não têm a chave. Quem lê usa `coalesce(…, 1)`, e a
-- partida velha se comporta como se estivesse na primeira rodada para sempre —
-- o que é inofensivo, porque nenhuma delas tem reviravolta ligada.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.dossie_start(p_room uuid, p_theme text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  /* A escolha do caso mora numa função só: pedido explícito, depois o que a
     sala combinou no lobby, depois sorteio. Antes desta migração ela estava
     aqui dentro, e escolher o caso no lobby exigiria mexer nesta função de
     duzentas linhas a cada mudança de política. */
  tema := public.dossie_escolhe_tema(p_room, p_theme);
  if tema.id is null then raise exception 'NO_THEME'; end if;

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
    'round', 1,
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
$function$;

revoke all on function public.dossie_start(uuid, text) from public, anon;
grant execute on function public.dossie_start(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

/**
 * Passa a vez, e vira a rodada quando o turno dá a volta.
 */
create or replace function public.dossie_advance(p_match uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m       public.matches;
  prox    smallint;
  atual   smallint;
  rodada  int;
  estado  jsonb;
begin
  select * into m from public.matches where id = p_match;
  estado := m.public_state;

  atual := (estado ->> 'turnSeat')::smallint;
  prox  := public.dossie_next_seat(estado, atual);

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

  /* A volta ao começo. `<=` e não `<` porque com um jogador só o próximo é
     ele mesmo, e a rodada tem de virar do mesmo jeito. */
  rodada := coalesce((estado ->> 'round')::int, 1);
  if prox <= atual then
    rodada := rodada + 1;
  end if;

  update public.matches
     set version = version + 1,
         turn_deadline = now() + interval '90 seconds',
         public_state = estado || jsonb_build_object(
           'phase', 'turn',
           'turnSeat', prox,
           'round', rodada,
           'actionsLeft', 2,
           'pending', null
         )
   where id = p_match;
end;
$$;

revoke all on function public.dossie_advance(uuid) from public, anon, authenticated;
