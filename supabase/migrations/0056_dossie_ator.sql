-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0056 · o ator do Dossiê deixa de ser ambiente
--
-- O terceiro e último. O Dossiê não tem resolvedor comum como `dominio_na_vez`
-- ou `met_na_vez`: cada ação resolve o assento na hora, e sempre com o mesmo par
-- de linhas. Isso deixa a troca ainda mais simples — `auth.uid()` vira
-- `dossie_dono(p_match, p_seat)`, e as consultas continuam idênticas:
--
--   select mp.seat into meu from match_players mp
--    where mp.match_id = p_match and mp.user_id = <o dono do assento>;
--   if meu is null then raise exception 'NOT_A_PLAYER'; end if;
--
-- devolve `meu = p_seat` quando o assento existe e NULL quando não — que é
-- exatamente o NOT_A_PLAYER de antes. Nenhuma conferência mudou de ordem, e
-- portanto nenhuma mensagem de erro do cliente mudou.
--
-- GERADO de `pg_get_functiondef` (scripts/gera-dossie-ator.mjs). É a terceira
-- vez que este projeto gera em vez de copiar, e a razão é sempre a mesma: as
-- funções do Dossiê foram redefinidas em 0012, 0013, 0033 e 0041, e copiar do
-- arquivo errado já custou um "cannot change return type".
-- ════════════════════════════════════════════════════════════════════════════

/**
 * O dono de um assento nesta partida.
 *
 * É o único lugar em que a identidade entra nas funções `_como` do Dossiê, e ela
 * entra pelo ASSENTO — nunca pela sessão de quem chamou.
 */
create or replace function public.dossie_dono(p_match uuid, p_seat smallint)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select mp.user_id from public.match_players mp
   where mp.match_id = p_match and mp.seat = p_seat;
$$;

revoke all on function public.dossie_dono(uuid, smallint) from public, anon, authenticated;

-- ── as ações, com o ator dito ─────────────────────────────────

-- dossie_accuse_como — 1 uso(s) de auth.uid() viraram o dono do assento
CREATE OR REPLACE FUNCTION public.dossie_accuse_como(p_seat smallint, p_match uuid, p_suspect text, p_weapon text, p_room text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
   where match_id = p_match and user_id = public.dossie_dono(p_match, p_seat);
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
    perform public.dossie_premia(p_match, meu, true);
    return jsonb_build_object('ok', true, 'right', true);
  end if;

  estado := jsonb_set(estado, '{ghosts}', (estado -> 'ghosts') || to_jsonb(meu));
  update public.matches set public_state = estado, version = version + 1 where id = p_match;
  perform public.dossie_premia(p_match, meu, false);
  perform public.dossie_advance(p_match);

  return jsonb_build_object('ok', true, 'right', false);
end;
$function$
;

-- dossie_end_turn_como — 1 uso(s) de auth.uid() viraram o dono do assento
CREATE OR REPLACE FUNCTION public.dossie_end_turn_como(p_seat smallint, p_match uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m      public.matches;
  meu    smallint;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;
  select seat into meu from public.match_players
   where match_id = p_match and user_id = public.dossie_dono(p_match, p_seat);
  if (m.public_state ->> 'turnSeat')::smallint is distinct from meu then
    raise exception 'NOT_YOUR_TURN';
  end if;
  if m.public_state ->> 'phase' <> 'turn' then raise exception 'WRONG_PHASE'; end if;

  perform public.dossie_advance(p_match);
  return jsonb_build_object('ok', true);
end;
$function$
;

-- dossie_move_como — 1 uso(s) de auth.uid() viraram o dono do assento
CREATE OR REPLACE FUNCTION public.dossie_move_como(p_seat smallint, p_match uuid, p_room text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
   where match_id = p_match and user_id = public.dossie_dono(p_match, p_seat);
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
$function$
;

-- dossie_pad_como — 2 uso(s) de auth.uid() viraram o dono do assento
CREATE OR REPLACE FUNCTION public.dossie_pad_como(p_seat smallint, p_match uuid, p_pad jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.dossie_dono(p_match, p_seat) is null then raise exception 'NOT_AUTHENTICATED'; end if;
  update public.match_private_state
     set data = jsonb_set(data, '{pad}', coalesce(p_pad, '{}'::jsonb))
   where match_id = p_match and user_id = public.dossie_dono(p_match, p_seat);
  if not found then raise exception 'NOT_A_PLAYER'; end if;
  return jsonb_build_object('ok', true);
end;
$function$
;

-- dossie_pass_refute_como — 2 uso(s) de auth.uid() viraram o dono do assento
CREATE OR REPLACE FUNCTION public.dossie_pass_refute_como(p_seat smallint, p_match uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
   where match_id = p_match and user_id = public.dossie_dono(p_match, p_seat);
  atual := (pend -> 'queue' ->> (pend ->> 'at')::int)::smallint;
  if atual is distinct from meu then raise exception 'NOT_YOUR_REFUTE'; end if;

  -- É AQUI que se impede a trapaça mais óbvia do jogo: "esquecer" de refutar.
  select exists (
    select 1
      from public.match_private_state mps,
           jsonb_array_elements_text(mps.data -> 'hand') c,
           jsonb_array_elements_text(pend -> 'guess') g
     where mps.match_id = p_match and mps.user_id = public.dossie_dono(p_match, p_seat) and c = g
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
$function$
;

-- dossie_refute_como — 2 uso(s) de auth.uid() viraram o dono do assento
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
$function$
;

-- dossie_suggest_como — 1 uso(s) de auth.uid() viraram o dono do assento
CREATE OR REPLACE FUNCTION public.dossie_suggest_como(p_seat smallint, p_match uuid, p_suspect text, p_weapon text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
   where match_id = p_match and user_id = public.dossie_dono(p_match, p_seat);
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
$function$
;

-- ── e as públicas viram casca ─────────────────────────────────

create or replace function public.dossie_accuse(p_match uuid, p_suspect text, p_weapon text, p_room text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare meu smallint;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select mp.seat into meu from public.match_players mp
   where mp.match_id = p_match and mp.user_id = auth.uid();
  if meu is null then raise exception 'NOT_A_PLAYER'; end if;
  return public.dossie_accuse_como(meu, p_match, p_suspect, p_weapon, p_room);
end;
$$;

create or replace function public.dossie_end_turn(p_match uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare meu smallint;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select mp.seat into meu from public.match_players mp
   where mp.match_id = p_match and mp.user_id = auth.uid();
  if meu is null then raise exception 'NOT_A_PLAYER'; end if;
  return public.dossie_end_turn_como(meu, p_match);
end;
$$;

create or replace function public.dossie_move(p_match uuid, p_room text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare meu smallint;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select mp.seat into meu from public.match_players mp
   where mp.match_id = p_match and mp.user_id = auth.uid();
  if meu is null then raise exception 'NOT_A_PLAYER'; end if;
  return public.dossie_move_como(meu, p_match, p_room);
end;
$$;

create or replace function public.dossie_pad(p_match uuid, p_pad jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare meu smallint;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select mp.seat into meu from public.match_players mp
   where mp.match_id = p_match and mp.user_id = auth.uid();
  if meu is null then raise exception 'NOT_A_PLAYER'; end if;
  return public.dossie_pad_como(meu, p_match, p_pad);
end;
$$;

create or replace function public.dossie_pass_refute(p_match uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare meu smallint;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select mp.seat into meu from public.match_players mp
   where mp.match_id = p_match and mp.user_id = auth.uid();
  if meu is null then raise exception 'NOT_A_PLAYER'; end if;
  return public.dossie_pass_refute_como(meu, p_match);
end;
$$;

create or replace function public.dossie_refute(p_match uuid, p_card text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare meu smallint;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select mp.seat into meu from public.match_players mp
   where mp.match_id = p_match and mp.user_id = auth.uid();
  if meu is null then raise exception 'NOT_A_PLAYER'; end if;
  return public.dossie_refute_como(meu, p_match, p_card);
end;
$$;

create or replace function public.dossie_suggest(p_match uuid, p_suspect text, p_weapon text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare meu smallint;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select mp.seat into meu from public.match_players mp
   where mp.match_id = p_match and mp.user_id = auth.uid();
  if meu is null then raise exception 'NOT_A_PLAYER'; end if;
  return public.dossie_suggest_como(meu, p_match, p_suspect, p_weapon);
end;
$$;

-- ── privilégio ───────────────────────────────────────────────
-- `dossie_accuse_como(3, ...)` acusa no lugar do assento 3, e `dossie_pad_como`
-- escreve no bloco de anotações dele. As três palavras, em todas.

revoke all on function public.dossie_accuse_como(p_seat smallint, p_match uuid, p_suspect text, p_weapon text, p_room text) from public, anon, authenticated;
revoke all on function public.dossie_end_turn_como(p_seat smallint, p_match uuid) from public, anon, authenticated;
revoke all on function public.dossie_move_como(p_seat smallint, p_match uuid, p_room text) from public, anon, authenticated;
revoke all on function public.dossie_pad_como(p_seat smallint, p_match uuid, p_pad jsonb) from public, anon, authenticated;
revoke all on function public.dossie_pass_refute_como(p_seat smallint, p_match uuid) from public, anon, authenticated;
revoke all on function public.dossie_refute_como(p_seat smallint, p_match uuid, p_card text) from public, anon, authenticated;
revoke all on function public.dossie_suggest_como(p_seat smallint, p_match uuid, p_suspect text, p_weapon text) from public, anon, authenticated;

revoke all on function public.dossie_accuse(p_match uuid, p_suspect text, p_weapon text, p_room text) from public, anon, authenticated;
grant execute on function public.dossie_accuse(p_match uuid, p_suspect text, p_weapon text, p_room text) to authenticated;
revoke all on function public.dossie_end_turn(p_match uuid) from public, anon, authenticated;
grant execute on function public.dossie_end_turn(p_match uuid) to authenticated;
revoke all on function public.dossie_move(p_match uuid, p_room text) from public, anon, authenticated;
grant execute on function public.dossie_move(p_match uuid, p_room text) to authenticated;
revoke all on function public.dossie_pad(p_match uuid, p_pad jsonb) from public, anon, authenticated;
grant execute on function public.dossie_pad(p_match uuid, p_pad jsonb) to authenticated;
revoke all on function public.dossie_pass_refute(p_match uuid) from public, anon, authenticated;
grant execute on function public.dossie_pass_refute(p_match uuid) to authenticated;
revoke all on function public.dossie_refute(p_match uuid, p_card text) from public, anon, authenticated;
grant execute on function public.dossie_refute(p_match uuid, p_card text) to authenticated;
revoke all on function public.dossie_suggest(p_match uuid, p_suspect text, p_weapon text) from public, anon, authenticated;
grant execute on function public.dossie_suggest(p_match uuid, p_suspect text, p_weapon text) to authenticated;
