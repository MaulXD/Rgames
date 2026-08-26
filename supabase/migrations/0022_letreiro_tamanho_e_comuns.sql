-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0022 · grade de tamanhos e revelação só com palavra comum
--
-- Duas mudanças pedidas, e uma delas conserta o pior defeito do jogo hoje.
--
-- 1. TAMANHO. A validação de caminho tinha 4 cravado (`idx / 4`, `idx % 4`) e o
--    caminho vinha em hexadecimal, que só endereça 16 células. Agora a função
--    recebe o tamanho e o caminho vem em base 36 — cabe 4×4, 5×5 e 6×6.
--
-- 2. PALAVRA COMUM. A revelação mostrava "serioba", "bariome", "aalênio":
--    formas que existem no dicionário e que ninguém usa. Aceitar continua
--    generoso (o gabarito inteiro), mas MOSTRAR e o aproveitamento passam a
--    olhar só a lista `comuns` da grade.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── caminho, com tamanho ───────────────────────────────────────────────────

create or replace function public.letreiro_path_ok(
  p_grid text[], p_path text, p_word text, p_size int
)
returns boolean
language plpgsql
immutable
as $$
declare
  n       int := char_length(p_path);
  celulas int := p_size * p_size;
  idx     int;
  prev    int := -1;
  vistos  int[] := '{}';
  montada text := '';
begin
  if n < 2 or n > celulas then
    return false;
  end if;

  for i in 1..n loop
    -- base 36: um dígito por célula, até 36 células
    idx := position(substr(p_path, i, 1) in '0123456789abcdefghijklmnopqrstuvwxyz') - 1;
    if idx < 0 or idx >= celulas then
      return false;
    end if;
    if idx = any(vistos) then
      return false;                                        -- célula repetida
    end if;
    if prev >= 0 then
      if abs((idx / p_size) - (prev / p_size)) > 1
         or abs((idx % p_size) - (prev % p_size)) > 1 then
        return false;                                      -- não são vizinhas
      end if;
    end if;
    vistos := vistos || idx;
    montada := montada || p_grid[idx + 1];
    prev := idx;
  end loop;

  return montada = p_word;
end;
$$;

revoke all on function public.letreiro_path_ok(text[], text, text, int) from public;

-- ── começar, com tamanho escolhido ─────────────────────────────────────────

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
  tamanho   int;
  quantas   int;
  nova      public.matches;
  membro    record;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into sala from public.rooms r where r.id = p_room;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if sala.host_id <> auth.uid() then raise exception 'NOT_HOST'; end if;
  if sala.game_key <> 'letreiro' then raise exception 'WRONG_GAME'; end if;
  if exists (select 1 from public.matches m
              where m.room_id = p_room and m.status = 'running') then
    raise exception 'ALREADY_RUNNING';
  end if;

  tamanho := coalesce((sala.settings ->> 'tamanho')::int, 4);
  if tamanho not in (4, 5) then
    tamanho := 4;
  end if;

  -- grade maior pede mais tempo: 4×4 tem 16 letras, 5×5 tem 25
  segundos := case coalesce(sala.settings ->> 'modo', 'classico')
                when 'relampago' then (case tamanho when 5 then 90 else 60 end)
                else (case tamanho when 5 then 300 else 180 end)
              end;

  semente := (random() * 9223372036854775806)::bigint;

  select count(*) into quantas from public.letreiro_boards b where b.size = tamanho;
  if quantas = 0 then
    raise exception 'NO_BOARDS';
  end if;

  select * into tabuleiro
    from public.letreiro_boards b
   where b.size = tamanho
   order by b.id
  offset (semente % quantas)
   limit 1;

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
    select rm.user_id, rm.seat from public.room_members rm
     where rm.room_id = p_room and rm.seat is not null
  loop
    insert into public.match_players (match_id, user_id, seat)
    values (nova.id, membro.user_id, membro.seat) on conflict do nothing;
    insert into public.match_private_state (match_id, user_id, data)
    values (nova.id, membro.user_id, jsonb_build_object('words', '[]'::jsonb))
    on conflict do nothing;
  end loop;

  update public.rooms set status = 'playing' where id = p_room;

  return jsonb_build_object(
    'id', nova.id, 'status', nova.status, 'ends_at', nova.ends_at,
    'started_at', nova.started_at, 'public_state', nova.public_state
  );
end;
$$;

revoke all on function public.letreiro_start(uuid) from public;
grant execute on function public.letreiro_start(uuid) to authenticated;

-- ── submeter, ciente do tamanho ────────────────────────────────────────────

create or replace function public.letreiro_submit(
  p_match uuid, p_word text, p_path text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  partida   public.matches;
  tabuleiro public.letreiro_boards;
  palavra   text;
  atuais    jsonb;
  ja        boolean;
  ok        boolean;
  pts       int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into partida from public.matches m where m.id = p_match;
  if not found or partida.status <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;
  if now() > partida.ends_at then raise exception 'TIME_OVER'; end if;
  if not exists (select 1 from public.match_players mp
                  where mp.match_id = p_match and mp.user_id = auth.uid()) then
    raise exception 'NOT_A_PLAYER';
  end if;

  palavra := upper(translate(
    p_word,
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'
  ));

  if char_length(palavra) < 3 then
    return jsonb_build_object('ok', false, 'reason', 'SHORT');
  end if;

  select * into tabuleiro from public.letreiro_boards b where b.id = partida.board_id;

  select data into atuais from public.match_private_state mps
   where mps.match_id = p_match and mps.user_id = auth.uid();
  atuais := coalesce(atuais, jsonb_build_object('words', '[]'::jsonb));

  select exists (
    select 1 from jsonb_array_elements(atuais -> 'words') w
     where w ->> 'w' = palavra
  ) into ja;
  if ja then
    return jsonb_build_object('ok', false, 'reason', 'REPEATED');
  end if;

  ok := (tabuleiro.solution ? palavra)
        and public.letreiro_path_ok(tabuleiro.grid, p_path, palavra, tabuleiro.size);

  if not ok then
    return jsonb_build_object(
      'ok', false,
      'reason', case when tabuleiro.solution ? palavra then 'BAD_PATH' else 'NOT_A_WORD' end
    );
  end if;

  pts := public.letreiro_pontos_palavra(palavra);

  update public.match_private_state
     set data = jsonb_set(
           data, '{words}',
           (data -> 'words') || jsonb_build_object(
             'w', palavra, 'p', p_path, 'pts', pts,
             'comum', coalesce(tabuleiro.comuns, '{}') @> array[palavra],
             'at', extract(epoch from now())
           )
         )
   where match_id = p_match and user_id = auth.uid();

  update public.matches
     set public_state = jsonb_set(
           public_state,
           array['counts', auth.uid()::text],
           to_jsonb(jsonb_array_length(
             (select data -> 'words' from public.match_private_state
               where match_id = p_match and user_id = auth.uid())
           ))
         ),
         version = version + 1
   where id = p_match;

  return jsonb_build_object('ok', true, 'pts', pts);
end;
$$;

revoke all on function public.letreiro_submit(uuid, text, text) from public;
grant execute on function public.letreiro_submit(uuid, text, text) to authenticated;

-- ── apurar: revelação só com palavra comum ─────────────────────────────────

create or replace function public.letreiro_score_bruto(p_match uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  partida   public.matches;
  tabuleiro public.letreiro_boards;
  regra     text;
  achadas   jsonb;
  perdidas  jsonb;
begin
  select * into partida from public.matches m where m.id = p_match for update;
  if not found or partida.status <> 'running' then return; end if;

  select * into tabuleiro from public.letreiro_boards b where b.id = partida.board_id;

  regra := coalesce(
    partida.public_state ->> 'scoring',
    (select r.settings ->> 'anulacao' from public.rooms r where r.id = partida.room_id),
    'classica'
  );

  drop table if exists _sub;
  drop table if exists _quantos;

  create temp table _sub on commit drop as
  select mps.user_id, (w ->> 'w') as palavra, (w ->> 'p') as caminho
    from public.match_private_state mps
    cross join lateral jsonb_array_elements(mps.data -> 'words') w
   where mps.match_id = p_match;

  delete from _sub s
   where not (tabuleiro.solution ? s.palavra)
      or not public.letreiro_path_ok(tabuleiro.grid, s.caminho, s.palavra, tabuleiro.size);

  create temp table _quantos on commit drop as
  select palavra, count(distinct user_id)::int quantos from _sub group by palavra;

  update public.match_players mp
     set score = coalesce(t.total, 0)
    from (
      select s.user_id,
             sum(
               case regra
                 when 'classica' then
                   case when q.quantos > 1 then 0
                        else public.letreiro_pontos_palavra(s.palavra) end
                 when 'gananciosa' then
                   public.letreiro_pontos_palavra(s.palavra)
                 else
                   public.letreiro_pontos_palavra(s.palavra)
                   + case when q.quantos = 1 then 1 else 0 end
               end
             )::int total
        from _sub s
        join _quantos q on q.palavra = s.palavra
       group by s.user_id
    ) t
   where mp.match_id = p_match and mp.user_id = t.user_id;

  select jsonb_object_agg(user_id::text, itens) into achadas
    from (
      select s.user_id,
             jsonb_agg(jsonb_build_object(
               'w',   coalesce(d.word, s.palavra),
               'p',   s.caminho,
               'pts', public.letreiro_pontos_palavra(s.palavra),
               'dup', q.quantos > 1,
               'comum', coalesce(tabuleiro.comuns, '{}') @> array[s.palavra]
             ) order by public.letreiro_pontos_palavra(s.palavra) desc, s.palavra) itens
        from _sub s
        join _quantos q on q.palavra = s.palavra
        left join public.dict_pt d on d.norm = s.palavra
       group by s.user_id
    ) x;

  -- AS CINCO MELHORES QUE NINGUÉM ACHOU, entre as COMUNS. Antes vinham do
  -- gabarito inteiro, e o jogo terminava exibindo palavra que ninguém conhece.
  select jsonb_agg(jsonb_build_object(
           'w',   coalesce(d.word, k.palavra),
           'p',   k.caminho,
           'pts', public.letreiro_pontos_palavra(k.palavra)
         ) order by public.letreiro_pontos_palavra(k.palavra))
    into perdidas
    from (
      select c as palavra, tabuleiro.solution ->> c as caminho
        from unnest(coalesce(tabuleiro.comuns, '{}')) c
       where c not in (select palavra from _sub)
       order by public.letreiro_pontos_palavra(c) desc, c
       limit 5
    ) k
    left join public.dict_pt d on d.norm = k.palavra;

  update public.matches
     set status = 'finished', ended_at = now(), version = version + 1,
         public_state = public_state || jsonb_build_object(
           'phase',     'reveal',
           'found',     coalesce(achadas, '{}'::jsonb),
           'missed',    coalesce(perdidas, '[]'::jsonb),
           -- o aproveitamento passa a ser sobre o que dá para achar de verdade
           'maxScore',  coalesce(tabuleiro.max_score_comum, tabuleiro.max_score),
           'wordCount', coalesce(array_length(tabuleiro.comuns, 1), tabuleiro.word_count),
           'scores', (
             select coalesce(jsonb_object_agg(user_id::text, score), '{}'::jsonb)
               from public.match_players where match_id = p_match
           )
         )
   where id = p_match;

  update public.rooms set status = 'lobby' where id = partida.room_id;
end;
$$;

revoke all on function public.letreiro_score_bruto(uuid) from public;

-- ── regras da casa: aceita o tamanho ───────────────────────────────────────

create or replace function public.set_room_settings(p_room uuid, p_settings jsonb)
returns public.rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  sala  public.rooms;
  limpo jsonb;
  modo  text;
  anul  text;
  tam   int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into sala from public.rooms r where r.id = p_room;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if sala.host_id <> auth.uid() then raise exception 'NOT_HOST'; end if;
  if sala.status <> 'lobby' then raise exception 'MATCH_IN_PROGRESS'; end if;

  modo := coalesce(p_settings ->> 'modo', sala.settings ->> 'modo', 'classico');
  anul := coalesce(p_settings ->> 'anulacao', sala.settings ->> 'anulacao', 'classica');
  tam  := coalesce((p_settings ->> 'tamanho')::int, (sala.settings ->> 'tamanho')::int, 4);

  if modo not in ('classico', 'relampago') then raise exception 'BAD_MODE'; end if;
  if anul not in ('classica', 'gananciosa', 'bonus') then raise exception 'BAD_SCORING'; end if;
  if tam not in (4, 5) then raise exception 'BAD_SIZE'; end if;

  limpo := jsonb_build_object('modo', modo, 'anulacao', anul, 'tamanho', tam);

  update public.rooms set settings = limpo where id = p_room returning * into sala;
  return sala;
end;
$$;

revoke all on function public.set_room_settings(uuid, jsonb) from public;
grant execute on function public.set_room_settings(uuid, jsonb) to authenticated;

-- a versão de 3 argumentos não é mais usada por ninguém
drop function if exists public.letreiro_path_ok(text[], text, text);
