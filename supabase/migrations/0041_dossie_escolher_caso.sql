-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0041 · escolher o caso do Dossiê no lobby
--
-- Com um tema só, sortear era a única opção possível. Com quatro, sortear
-- sempre é uma decisão tomada pelo jogo em nome da mesa — e a mesa às vezes
-- quer o Solar porque já conhece, ou a Aurora porque nunca jogou.
--
-- Duas opções, e só duas:
--
--   ESCOLHER   — o anfitrião marca o caso, e todos veem qual no lobby
--   SURPRESA   — o servidor sorteia na hora de começar
--
-- O PRD §3.5 lista quatro modos (Escolher, Aleatório, Surpresa, Rodízio). Aqui
-- entram dois, porque "Aleatório" e "Surpresa" só são coisas diferentes se o
-- lobby SORTEAR ANTES e mostrar o resultado — e nada no jogo faz isso hoje.
-- Oferecer os dois rótulos para o mesmo comportamento é o tipo de escolha que
-- parece generosidade e é confusão. O Rodízio precisa de memória entre partidas
-- da sala, que também não existe.
--
-- E O VOCABULÁRIO É DINÂMICO. Em vez de listar os quatro ids no SQL — que
-- envelheceria no dia em que o quinto tema entrasse — a validação pergunta ao
-- banco se aquele tema existe. Um tema novo passa a ser escolhível no instante
-- em que `npm run dossie` o publica, sem migração nenhuma. É o que "tema é
-- conteúdo, não engenharia" tem de significar até no vocabulário.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.set_room_settings(p_room uuid, p_settings jsonb)
returns public.rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  sala   public.rooms;
  limpo  jsonb;
  modo   text;
  anul   text;
  tam    int;
  tema   text;
  chave  text;
  aceita text[];
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into sala from public.rooms r where r.id = p_room;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if sala.host_id <> auth.uid() then raise exception 'NOT_HOST'; end if;
  if sala.status <> 'lobby' then raise exception 'MATCH_IN_PROGRESS'; end if;

  aceita := case sala.game_key
    when 'letreiro'  then array['modo', 'anulacao', 'tamanho']
    when 'metropole' then array['modo', 'bolao', 'largadaDobrada',
                                'construirSolto', 'semLeilao']
    when 'dominio'   then array['modo']
    when 'dossie'    then array['tema']
    else '{}'::text[]
  end;

  for chave in select jsonb_object_keys(p_settings) loop
    if not (chave = any(aceita)) then
      raise exception 'UNKNOWN_SETTING_%', chave;
    end if;
  end loop;

  if sala.game_key = 'letreiro' then
    modo := coalesce(p_settings ->> 'modo', sala.settings ->> 'modo', 'classico');
    anul := coalesce(p_settings ->> 'anulacao', sala.settings ->> 'anulacao', 'classica');
    tam  := coalesce((p_settings ->> 'tamanho')::int, (sala.settings ->> 'tamanho')::int, 4);

    if modo not in ('classico', 'relampago') then raise exception 'BAD_MODE'; end if;
    if anul not in ('classica', 'gananciosa', 'bonus') then raise exception 'BAD_SCORING'; end if;
    if tam not in (4, 5) then raise exception 'BAD_SIZE'; end if;

    limpo := jsonb_build_object('modo', modo, 'anulacao', anul, 'tamanho', tam);

  elsif sala.game_key = 'metropole' then
    modo := coalesce(p_settings ->> 'modo', sala.settings ->> 'modo', 'metropole');
    if modo not in ('metropole', 'classico', 'relampago') then raise exception 'BAD_MODE'; end if;

    limpo := jsonb_build_object(
      'modo', modo,
      'bolao', coalesce(
        (p_settings ->> 'bolao')::boolean, (sala.settings ->> 'bolao')::boolean, false),
      'largadaDobrada', coalesce(
        (p_settings ->> 'largadaDobrada')::boolean,
        (sala.settings ->> 'largadaDobrada')::boolean, false),
      'construirSolto', coalesce(
        (p_settings ->> 'construirSolto')::boolean,
        (sala.settings ->> 'construirSolto')::boolean, false),
      'semLeilao', coalesce(
        (p_settings ->> 'semLeilao')::boolean,
        (sala.settings ->> 'semLeilao')::boolean, false)
    );

  elsif sala.game_key = 'dominio' then
    modo := coalesce(p_settings ->> 'modo', sala.settings ->> 'modo', 'campanha');
    if modo not in ('campanha', 'classico') then raise exception 'BAD_MODE'; end if;
    limpo := jsonb_build_object('modo', modo);

  elsif sala.game_key = 'dossie' then
    tema := coalesce(p_settings ->> 'tema', sala.settings ->> 'tema', 'surpresa');
    -- vocabulário DINÂMICO: pergunta ao banco em vez de listar ids aqui
    if tema <> 'surpresa'
       and not exists (
         select 1 from public.game_themes gt
          where gt.id = tema and gt.game_key = 'dossie'
       ) then
      raise exception 'BAD_THEME';
    end if;
    limpo := jsonb_build_object('tema', tema);

  else
    limpo := '{}'::jsonb;
  end if;

  update public.rooms set settings = limpo where id = p_room returning * into sala;
  return sala;
end;
$$;

revoke all on function public.set_room_settings(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.set_room_settings(uuid, jsonb) to authenticated;

-- ── e `dossie_start` passa a respeitar a escolha da sala ───────────────────

create or replace function public.dossie_escolhe_tema(p_room uuid, p_pedido text)
returns public.game_themes
language plpgsql
security definer
set search_path = public
as $$
declare
  escolhido text;
  saida     public.game_themes;
begin
  /* A ordem de precedência, e ela importa:
       1. o que a chamada pediu explicitamente (`p_theme`)
       2. o que a sala combinou no lobby
       3. sorteio
     A chamada vence a sala porque é o que o teste de fumaça usa para exercitar
     um tema específico — e porque uma revanche pode querer trocar o caso sem
     mexer na configuração da sala. */
  escolhido := p_pedido;

  if escolhido is null then
    select r.settings ->> 'tema' into escolhido from public.rooms r where r.id = p_room;
  end if;

  if escolhido is null or escolhido = 'surpresa' then
    select * into saida from public.game_themes
     where game_key = 'dossie' order by random() limit 1;
  else
    select * into saida from public.game_themes
     where id = escolhido and game_key = 'dossie';
    -- tema que sumiu do banco não trava a partida: cai no sorteio
    if not found then
      select * into saida from public.game_themes
       where game_key = 'dossie' order by random() limit 1;
    end if;
  end if;

  return saida;
end;
$$;

revoke all on function public.dossie_escolhe_tema(uuid, text) from public, anon, authenticated;

-- ── dossie_start passa a respeitar a escolha do lobby ──────────────────────
-- O corpo abaixo e o de 0013 — que e a versao viva, a que devolve a linha
-- REDIGIDA em jsonb — com so a escolha de tema trocada. Regerar da 0012 foi o
-- primeiro erro desta migracao: aquela versao devolve `public.matches`, e o
-- Postgres recusa trocar o tipo de retorno de uma funcao existente.

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

revoke all on function public.dossie_start(uuid, text) from public, anon, authenticated;
grant execute on function public.dossie_start(uuid, text) to authenticated;
