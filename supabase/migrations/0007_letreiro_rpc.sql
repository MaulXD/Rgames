-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0007 · Letreiro: o jogo
-- Ver docs/02-PRD-LETREIRO.md §9
--
-- O gabarito da grade já traz todas as palavras válidas, então validar uma
-- submissão não precisa tocar o dicionário: basta a palavra estar no gabarito
-- e o caminho fechar na geometria. Rápido e exato.
--
-- Quem encerra a rodada é o banco, por pg_cron. Ninguém adianta nem atrasa o
-- fim do tempo fechando o navegador.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── pontuação por tamanho ──────────────────────────────────────────────────
create or replace function public.letreiro_pontos(p_len integer)
returns integer
language sql
immutable
as $$
  select case
    when p_len <= 4 then 1
    when p_len = 5  then 2
    when p_len = 6  then 3
    when p_len = 7  then 5
    else 11
  end;
$$;

-- ── validação de caminho ───────────────────────────────────────────────────
-- Células distintas, vizinhas nas 8 direções, e a concatenação das faces
-- tem de dar exatamente a palavra. Uma face pode valer duas letras ("QU").

create or replace function public.letreiro_path_ok(
  p_grid text[], p_path text, p_word text
)
returns boolean
language plpgsql
immutable
as $$
declare
  n int := char_length(p_path);
  idx int;
  prev int := -1;
  vistos int[] := '{}';
  montada text := '';
begin
  if n < 2 or n > 16 then
    return false;
  end if;

  for i in 1..n loop
    -- dígito hexadecimal -> índice de célula 0..15
    idx := position(substr(p_path, i, 1) in '0123456789abcdef') - 1;
    if idx < 0 or idx > 15 then
      return false;
    end if;
    if idx = any(vistos) then
      return false;                                   -- célula repetida
    end if;
    if prev >= 0 then
      if abs((idx / 4) - (prev / 4)) > 1
         or abs((idx % 4) - (prev % 4)) > 1 then
        return false;                                 -- não são vizinhas
      end if;
    end if;
    vistos := vistos || idx;
    montada := montada || p_grid[idx + 1];
    prev := idx;
  end loop;

  return montada = p_word;
end;
$$;

-- ── começar ────────────────────────────────────────────────────────────────

create or replace function public.letreiro_start(p_room uuid)
returns public.matches
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
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into sala from public.rooms where id = p_room;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if sala.host_id <> auth.uid() then
    raise exception 'NOT_HOST';
  end if;
  if sala.game_key <> 'letreiro' then
    raise exception 'WRONG_GAME';
  end if;
  if exists (select 1 from public.matches m
              where m.room_id = p_room and m.status = 'running') then
    raise exception 'ALREADY_RUNNING';
  end if;

  segundos := case coalesce(sala.settings ->> 'modo', 'classico')
                when 'relampago' then 60
                else 180
              end;

  semente := (random() * 9223372036854775806)::bigint;

  -- a semente escolhe a grade; nada de solver em tempo de partida
  select * into tabuleiro
    from public.letreiro_boards
   order by id
  offset (semente % greatest((select count(*) from public.letreiro_boards), 1))
   limit 1;

  if not found then
    raise exception 'NO_BOARDS';
  end if;

  insert into public.matches (room_id, game_key, seed, board_id, ends_at, public_state)
  values (
    p_room, 'letreiro', semente, tabuleiro.id,
    now() + make_interval(secs => segundos),
    jsonb_build_object(
      'phase', 'round',
      'grid', to_jsonb(tabuleiro.grid),
      'size', tabuleiro.size,
      'mode', coalesce(sala.settings ->> 'modo', 'classico'),
      'seconds', segundos,
      'counts', '{}'::jsonb
    )
  )
  returning * into nova;

  -- todo mundo da sala entra na partida, com estado privado vazio
  for membro in
    select user_id, seat from public.room_members
     where room_id = p_room and seat is not null
  loop
    insert into public.match_players (match_id, user_id, seat)
    values (nova.id, membro.user_id, membro.seat)
    on conflict do nothing;

    insert into public.match_private_state (match_id, user_id, data)
    values (nova.id, membro.user_id, jsonb_build_object('words', '[]'::jsonb))
    on conflict do nothing;
  end loop;

  update public.rooms set status = 'playing' where id = p_room;

  return nova;
end;
$$;

-- ── submeter palavra ───────────────────────────────────────────────────────

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
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into partida from public.matches where id = p_match;
  if not found or partida.status <> 'running' then
    raise exception 'MATCH_NOT_RUNNING';
  end if;
  if now() > partida.ends_at then
    raise exception 'TIME_OVER';
  end if;
  if not exists (select 1 from public.match_players
                  where match_id = p_match and user_id = auth.uid()) then
    raise exception 'NOT_A_PLAYER';
  end if;

  -- normaliza: maiúscula, sem acento, sem cedilha. "AÇÃO" e "ACAO" são a mesma.
  palavra := upper(translate(
    p_word,
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'
  ));

  if char_length(palavra) < 3 then
    return jsonb_build_object('ok', false, 'reason', 'SHORT');
  end if;

  select * into tabuleiro from public.letreiro_boards where id = partida.board_id;

  select data into atuais from public.match_private_state
   where match_id = p_match and user_id = auth.uid();
  atuais := coalesce(atuais, jsonb_build_object('words', '[]'::jsonb));

  select exists (
    select 1 from jsonb_array_elements(atuais -> 'words') w
     where w ->> 'w' = palavra
  ) into ja;

  if ja then
    return jsonb_build_object('ok', false, 'reason', 'REPEATED');
  end if;

  ok := (tabuleiro.solution ? palavra)
        and public.letreiro_path_ok(tabuleiro.grid, p_path, palavra);

  if not ok then
    return jsonb_build_object(
      'ok', false,
      'reason', case when tabuleiro.solution ? palavra then 'BAD_PATH' else 'NOT_A_WORD' end
    );
  end if;

  pts := public.letreiro_pontos(char_length(palavra));

  update public.match_private_state
     set data = jsonb_set(
           data, '{words}',
           (data -> 'words') || jsonb_build_object(
             'w', palavra, 'p', p_path, 'pts', pts,
             'at', extract(epoch from now())
           )
         )
   where match_id = p_match and user_id = auth.uid();

  -- contagem pública: tensão sem vazar nada. Só quantidade, nunca as palavras.
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

-- ── encerrar e apurar ──────────────────────────────────────────────────────

create or replace function public.letreiro_score(p_match uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  partida   public.matches;
  tabuleiro public.letreiro_boards;
  modo      text;
  achadas   jsonb;
  perdidas  jsonb;
begin
  select * into partida from public.matches where id = p_match for update;
  if not found or partida.status <> 'running' then
    return;
  end if;

  select * into tabuleiro from public.letreiro_boards where id = partida.board_id;
  modo := coalesce(partida.public_state ->> 'mode', 'classico');

  -- revalida tudo: palavra no gabarito e caminho legal. O cliente pode ter
  -- aceitado otimisticamente; a verdade é apurada aqui.
  create temp table _sub on commit drop as
  select mps.user_id,
         (w ->> 'w')  as palavra,
         (w ->> 'p')  as caminho
    from public.match_private_state mps
    cross join lateral jsonb_array_elements(mps.data -> 'words') w
   where mps.match_id = p_match;

  delete from _sub s
   where not (tabuleiro.solution ? s.palavra)
      or not public.letreiro_path_ok(tabuleiro.grid, s.caminho, s.palavra);

  -- quantos jogadores acharam cada palavra
  create temp table _quantos on commit drop as
  select palavra, count(distinct user_id)::int quantos
    from _sub group by palavra;

  -- placar, conforme a regra de anulação da sala
  update public.match_players mp
     set score = coalesce(t.total, 0)
    from (
      select s.user_id,
             sum(
               case modo
                 when 'classica' then case when q.quantos > 1 then 0
                                           else public.letreiro_pontos(char_length(s.palavra)) end
                 when 'gananciosa' then public.letreiro_pontos(char_length(s.palavra))
                 else public.letreiro_pontos(char_length(s.palavra))
                      + case when q.quantos = 1 then 1 else 0 end
               end
             )::int total
        from _sub s
        join _quantos q on q.palavra = s.palavra
       group by s.user_id
    ) t
   where mp.match_id = p_match and mp.user_id = t.user_id;

  -- lista por jogador, para a conferência da revelação
  select jsonb_object_agg(user_id::text, itens) into achadas
    from (
      select s.user_id,
             jsonb_agg(jsonb_build_object(
               'w', d.word,
               'p', s.caminho,
               'pts', public.letreiro_pontos(char_length(s.palavra)),
               'dup', q.quantos > 1
             ) order by char_length(s.palavra) desc, s.palavra) itens
        from _sub s
        join _quantos q on q.palavra = s.palavra
        left join public.dict_pt d on d.norm = s.palavra
       group by s.user_id
    ) x;

  -- as cinco melhores que ninguém achou: o momento do jogo
  select jsonb_agg(jsonb_build_object(
           'w', coalesce(d.word, k.palavra),
           'p', k.caminho,
           'pts', public.letreiro_pontos(char_length(k.palavra))
         ) order by public.letreiro_pontos(char_length(k.palavra)), k.palavra)
    into perdidas
    from (
      select key as palavra, value #>> '{}' as caminho
        from jsonb_each(tabuleiro.solution)
       where key not in (select palavra from _sub)
       order by public.letreiro_pontos(char_length(key)) desc, key
       limit 5
    ) k
    left join public.dict_pt d on d.norm = k.palavra;

  update public.matches
     set status = 'finished',
         ended_at = now(),
         version = version + 1,
         public_state = public_state || jsonb_build_object(
           'phase', 'reveal',
           'found', coalesce(achadas, '{}'::jsonb),
           'missed', coalesce(perdidas, '[]'::jsonb),
           'maxScore', tabuleiro.max_score,
           'wordCount', tabuleiro.word_count,
           'scores', (
             select coalesce(jsonb_object_agg(user_id::text, score), '{}'::jsonb)
               from public.match_players where match_id = p_match
           )
         )
   where id = p_match;

  update public.rooms set status = 'lobby' where id = partida.room_id;
end;
$$;

-- ── varredura: o banco é quem encerra a rodada ─────────────────────────────

create or replace function public.letreiro_sweep()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  n int := 0;
begin
  for m in
    select id from public.matches
     where game_key = 'letreiro' and status = 'running' and ends_at < now()
  loop
    perform public.letreiro_score(m.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'mesa-letreiro-sweep') then
    perform cron.schedule('mesa-letreiro-sweep', '10 seconds', 'select public.letreiro_sweep()');
  end if;
exception when others then
  raise notice 'pg_cron indisponivel: %', sqlerrm;
end $$;

-- ── permissões ─────────────────────────────────────────────────────────────

revoke all on function public.letreiro_score(uuid)  from anon, authenticated;
revoke all on function public.letreiro_sweep()      from anon, authenticated;
revoke all on function public.letreiro_path_ok(text[], text, text) from anon, authenticated;

revoke all on function public.letreiro_start(uuid)                from anon;
revoke all on function public.letreiro_submit(uuid, text, text)   from anon;
grant execute on function public.letreiro_start(uuid)              to authenticated;
grant execute on function public.letreiro_submit(uuid, text, text) to authenticated;
grant execute on function public.letreiro_pontos(integer)          to authenticated;
