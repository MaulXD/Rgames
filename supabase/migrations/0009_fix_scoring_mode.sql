-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0009 · separa duração de regra de anulação
--
-- Bug: `public_state.mode` guarda o modo de DURAÇÃO (classico = 3 min,
-- relampago = 1 min), mas `letreiro_score` comparava esse valor contra os
-- nomes da regra de ANULAÇÃO (classica, gananciosa, bonus). Nunca casava,
-- então toda partida caía no ELSE — a regra de bônus de exclusividade.
--
-- O teste de fumaça pegou: na anulação clássica a palavra achada por dois tem
-- de valer zero para os dois, e estava valendo para os dois, com +1 de brinde.
--
-- Agora são duas chaves com nomes diferentes: `mode` (duração) e `scoring`
-- (anulação). Nomear direito é o conserto.
-- ═══════════════════════════════════════════════════════════════════════════

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
      'phase',   'round',
      'grid',    to_jsonb(tabuleiro.grid),
      'size',    tabuleiro.size,
      'mode',    coalesce(sala.settings ->> 'modo', 'classico'),
      -- congelado no início: mudar a regra no meio da partida não vale
      'scoring', coalesce(sala.settings ->> 'anulacao', 'classica'),
      'seconds', segundos,
      'counts',  '{}'::jsonb
    )
  )
  returning * into nova;

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

create or replace function public.letreiro_score(p_match uuid)
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
  select * into partida from public.matches where id = p_match for update;
  if not found or partida.status <> 'running' then
    return;
  end if;

  select * into tabuleiro from public.letreiro_boards where id = partida.board_id;

  -- `scoring`, não `mode`. Fallback para partida antiga e para a sala.
  regra := coalesce(
    partida.public_state ->> 'scoring',
    (select r.settings ->> 'anulacao' from public.rooms r where r.id = partida.room_id),
    'classica'
  );

  create temp table _sub on commit drop as
  select mps.user_id,
         (w ->> 'w') as palavra,
         (w ->> 'p') as caminho
    from public.match_private_state mps
    cross join lateral jsonb_array_elements(mps.data -> 'words') w
   where mps.match_id = p_match;

  delete from _sub s
   where not (tabuleiro.solution ? s.palavra)
      or not public.letreiro_path_ok(tabuleiro.grid, s.caminho, s.palavra);

  create temp table _quantos on commit drop as
  select palavra, count(distinct user_id)::int quantos
    from _sub group by palavra;

  update public.match_players mp
     set score = coalesce(t.total, 0)
    from (
      select s.user_id,
             sum(
               case regra
                 -- clássica: palavra achada por dois vale zero para os dois
                 when 'classica' then
                   case when q.quantos > 1 then 0
                        else public.letreiro_pontos(char_length(s.palavra)) end
                 -- gananciosa: ninguém anula ninguém
                 when 'gananciosa' then
                   public.letreiro_pontos(char_length(s.palavra))
                 -- bônus de exclusividade: todos pontuam, +1 para quem achou só
                 else
                   public.letreiro_pontos(char_length(s.palavra))
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
               'pts', public.letreiro_pontos(char_length(s.palavra)),
               'dup', q.quantos > 1
             ) order by char_length(s.palavra) desc, s.palavra) itens
        from _sub s
        join _quantos q on q.palavra = s.palavra
        left join public.dict_pt d on d.norm = s.palavra
       group by s.user_id
    ) x;

  select jsonb_agg(jsonb_build_object(
           'w',   coalesce(d.word, k.palavra),
           'p',   k.caminho,
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
           'phase',     'reveal',
           'found',     coalesce(achadas, '{}'::jsonb),
           'missed',    coalesce(perdidas, '[]'::jsonb),
           'maxScore',  tabuleiro.max_score,
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

revoke all on function public.letreiro_start(uuid)  from public;
revoke all on function public.letreiro_score(uuid)  from public;
grant execute on function public.letreiro_start(uuid) to authenticated;
