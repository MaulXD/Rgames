-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0088 · a reviravolta entra em cena
--
-- 0087 escreveu as três reviravoltas e ninguém as chamava. Esta migração é a
-- fiação, e são três costuras:
--
--   dossie_start        cria `twist` no estado — ou não cria, se a mesa
--                       desligou a regra nas Regras da Casa
--   dossie_advance      chama `dossie_vira_rodada` no instante em que a rodada
--                       vira, e só aí
--   dossie_refute_como  durante o Apagão, o log diz que alguém desmentiu e o
--                       estado privado de quem palpitou grava `from: null`
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE A REVIRAVOLTA É CONGELADA NO INÍCIO
--
-- A regra da casa é lida uma vez, em `dossie_start`, e o resultado vive no
-- estado da partida. Ler a cada rodada deixaria o anfitrião desligar o Apagão na
-- rodada 5 depois de ver que ele ia cair na 6 — e uma regra que dá para desligar
-- quando incomoda não é regra, é sugestão.
--
-- Pelo mesmo motivo a rodada do Apagão é sorteada AGORA e guardada. Sorteada na
-- hora, "uma vez por partida, entre a 4 e a 8" viraria "uma vez por rodada, com
-- vinte por cento de chance" — que é outro jogo, e um pior.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O APAGÃO APAGA QUEM, NUNCA O QUÊ
--
-- É a linha inteira da regra. "Aquela carta não está no envelope" continua sendo
-- sua, porque é a informação que decide a partida; o que some é saber de QUEM
-- ela é, que é a metade lenta da dedução.
--
-- Um apagão que escondesse a carta seria uma rodada jogada fora, e a mesa
-- aprenderia a esperar ela passar em vez de jogar dentro dela.
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
  giro      jsonb := null;
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

  /* A REVIRAVOLTA DO CASO, congelada agora.

     Congelar no início é a decisão de produto: quem escolheu jogar limpo joga
     limpo até o fim, e ninguém muda a regra no meio da partida. A alternativa —
     ler a regra da casa a cada rodada — deixaria o anfitrião desligar o Apagão
     na rodada 5 depois de ver que ele ia cair na 6.

     A rodada do Apagão sai do mesmo `semente` de tudo o mais, entre a 4 e a 8
     como manda o PRD 03 §3. Sorteada AQUI e guardada: se fosse sorteada na hora,
     "uma vez por partida" viraria "uma vez por rodada, com 20% de chance". */
  if coalesce((sala.settings ->> 'reviravolta')::boolean, true) then
    giro := tema.data -> 'twist';
    if giro is not null and giro <> 'null'::jsonb then
      giro := jsonb_build_object('id', giro ->> 'id');
      case giro ->> 'id'
        when 'apagao' then
          giro := giro || jsonb_build_object(
            'round', 4 + (abs(semente) % 5), 'fired', false, 'active', false
          );
        when 'tempestade' then
          giro := giro || jsonb_build_object('fechados', '[]'::jsonb, 'aviso', '[]'::jsonb);
        when 'registro' then
          giro := giro || jsonb_build_object('publicados', '[]'::jsonb);
        else
          giro := null;
      end case;
    end if;
  end if;

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
    'twist', giro,
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

CREATE OR REPLACE FUNCTION public.dossie_advance(p_match uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m       public.matches;
  prox    smallint;
  atual   smallint;
  rodada  int;
  estado  jsonb;
  virou   boolean;
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

  virou := prox <= atual;

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

  /* A reviravolta acontece DEPOIS do estado da rodada nova estar gravado, e
     nunca antes: `dossie_vira_rodada` lê `round` do banco para saber em que
     rodada está. Chamar antes seria fazê-la decidir sobre a rodada anterior. */
  if virou then
    perform public.dossie_vira_rodada(p_match);
  end if;
end;
$function$;

revoke all on function public.dossie_advance(uuid) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.dossie_refute_como(p_seat smallint, p_match uuid, p_card text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m        public.matches;
  estado   jsonb;
  pend     jsonb;
  meu      smallint;
  atual    smallint;
  pedinte  uuid;
  tenho    boolean;
  no_palpite boolean;
  escuro   boolean;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;
  estado := m.public_state;
  pend := estado -> 'pending';
  if pend is null or estado ->> 'phase' <> 'refute' then raise exception 'NOTHING_TO_REFUTE'; end if;

  select seat into meu from public.match_players
   where match_id = p_match and user_id = public.dossie_dono(p_match, p_seat);
  if meu is null then raise exception 'NOT_A_PLAYER'; end if;

  atual := (pend -> 'queue' ->> (pend ->> 'at')::int)::smallint;
  if atual is distinct from meu then raise exception 'NOT_YOUR_REFUTE'; end if;

  -- a carta tem de estar de fato na mão, e ser uma das três do palpite
  select exists (
    select 1 from public.match_private_state mps,
      jsonb_array_elements_text(mps.data -> 'hand') c
     where mps.match_id = p_match and mps.user_id = public.dossie_dono(p_match, p_seat) and c = p_card
  ) into tenho;
  if not tenho then raise exception 'NOT_IN_HAND'; end if;

  select exists (
    select 1 from jsonb_array_elements_text(pend -> 'guess') g where g = p_card
  ) into no_palpite;
  if not no_palpite then raise exception 'NOT_IN_GUESS'; end if;

  /* O APAGÃO apaga QUEM mostrou. Nunca O QUE mostrou.

     Essa é a linha inteira da regra, e é o que a torna choque sem prejuízo:
     "aquela carta não está no envelope" continua sendo sua, porque é a
     informação que decide a partida. O que some é a atribuição — saber de QUEM
     ela é —, que é a metade lenta da dedução.

     Se o apagão escondesse a carta, seria uma rodada jogada fora. */
  select coalesce((estado -> 'twist' ->> 'active')::boolean, false)
     and estado -> 'twist' ->> 'id' = 'apagao'
    into escuro;

  -- a carta vai para o estado PRIVADO de quem palpitou. Nunca para o público.
  select user_id into pedinte from public.match_players
   where match_id = p_match and seat = (pend ->> 'bySeat')::smallint;

  update public.match_private_state
     set data = jsonb_set(
           data, '{seen}',
           (data -> 'seen') || jsonb_build_object(
             'card', p_card,
             'from', case when escuro then null else to_jsonb(meu) end,
             'seq', coalesce((estado ->> 'seq')::int, 0) + 1
           )
         )
   where match_id = p_match and user_id = pedinte;

  -- no log, só QUEM mostrou — e no apagão, nem isso
  estado := public.dossie_log(estado, case when escuro
    then jsonb_build_object('type', 'refute', 'seat', null, 'anon', true)
    else jsonb_build_object('type', 'refute', 'seat', meu)
  end);
  estado := estado || jsonb_build_object('pending', null);

  update public.matches set public_state = estado, version = version + 1 where id = p_match;
  perform public.dossie_advance(p_match);

  return jsonb_build_object('ok', true);
end;
$function$;

revoke all on function public.dossie_refute_como(smallint, uuid, text)
  from public, anon, authenticated;
