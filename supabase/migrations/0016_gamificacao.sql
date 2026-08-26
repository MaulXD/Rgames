-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0016 · XP, nível e conquistas
--
-- Quem dá XP é o SERVIDOR, no fim da partida, junto com a apuração. Se o
-- cliente pudesse creditar, o placar da vida inteira viraria enfeite.
--
-- Tudo mora em `profiles.stats` (jsonb, já existia). Uma conquista nunca é
-- retirada, e o mesmo id nunca entra duas vezes.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.dar_xp(
  p_user uuid,
  p_xp integer,
  p_somas jsonb default '{}'::jsonb,
  p_conquistas text[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  atual jsonb;
  chave text;
  novo  jsonb;
begin
  select coalesce(stats, '{}'::jsonb) into atual from public.profiles where id = p_user;
  if atual is null then
    return;
  end if;

  novo := atual
    || jsonb_build_object('xp', coalesce((atual ->> 'xp')::int, 0) + greatest(p_xp, 0));

  -- contadores acumulativos
  for chave in select jsonb_object_keys(p_somas) loop
    novo := novo || jsonb_build_object(
      chave,
      coalesce((atual ->> chave)::numeric, 0) + (p_somas ->> chave)::numeric
    );
  end loop;

  -- conquistas: união, sem repetir
  if array_length(p_conquistas, 1) is not null then
    novo := novo || jsonb_build_object(
      'conquistas',
      (
        select coalesce(jsonb_agg(distinct c), '[]'::jsonb)
          from (
            select jsonb_array_elements_text(coalesce(atual -> 'conquistas', '[]'::jsonb)) c
            union
            select unnest(p_conquistas)
          ) t
      )
    );
  end if;

  update public.profiles set stats = novo, updated_at = now() where id = p_user;
end;
$$;

revoke all on function public.dar_xp(uuid, integer, jsonb, text[]) from public;

/** Melhor palavra da vida: só troca se a nova valer mais. */
create or replace function public.melhor_palavra(p_user uuid, p_word text, p_pts integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set stats = stats || jsonb_build_object(
           'melhor', jsonb_build_object('w', p_word, 'pts', p_pts)
         ),
         updated_at = now()
   where id = p_user
     and coalesce((stats -> 'melhor' ->> 'pts')::int, -1) < p_pts;
end;
$$;

revoke all on function public.melhor_palavra(uuid, text, integer) from public;

-- ── Letreiro: crédito no fim da rodada ─────────────────────────────────────

create or replace function public.letreiro_premia(p_match uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  j            record;
  tabuleiro    public.letreiro_boards;
  conquistas   text[];
  palavras     int;
  maior        int;
  tem_qu       boolean;
  melhor_w     text;
  melhor_p     int;
  total_vida   int;
begin
  select b.* into tabuleiro
    from public.letreiro_boards b
    join public.matches m on m.board_id = b.id
   where m.id = p_match;

  for j in
    select mp.user_id, mp.score, mps.data -> 'words' as words
      from public.match_players mp
      left join public.match_private_state mps
        on mps.match_id = mp.match_id and mps.user_id = mp.user_id
     where mp.match_id = p_match
  loop
    conquistas := '{}';
    palavras := coalesce(jsonb_array_length(j.words), 0);

    select coalesce(max(char_length(w ->> 'w')), 0),
           bool_or((w ->> 'w') like '%QU%')
      into maior, tem_qu
      from jsonb_array_elements(coalesce(j.words, '[]'::jsonb)) w;

    select (w ->> 'w'), (w ->> 'pts')::int
      into melhor_w, melhor_p
      from jsonb_array_elements(coalesce(j.words, '[]'::jsonb)) w
     order by (w ->> 'pts')::int desc
     limit 1;

    if palavras >= 1 then conquistas := conquistas || 'primeira-palavra'; end if;
    if maior >= 8 then conquistas := conquistas || 'oito-letras'; end if;
    if coalesce(tem_qu, false) then conquistas := conquistas || 'palavra-qu'; end if;
    if tabuleiro.max_score > 0 and j.score * 2 >= tabuleiro.max_score then
      conquistas := conquistas || 'meia-grade';
    end if;

    perform public.dar_xp(
      j.user_id,
      j.score,
      jsonb_build_object('partidas', 1, 'palavras', palavras),
      conquistas
    );

    if melhor_w is not null then
      perform public.melhor_palavra(j.user_id, melhor_w, melhor_p);
    end if;

    select coalesce((stats ->> 'palavras')::int, 0) into total_vida
      from public.profiles where id = j.user_id;
    if total_vida >= 100 then
      perform public.dar_xp(j.user_id, 0, '{}'::jsonb, array['cem-palavras']);
    end if;
    if total_vida >= 500 then
      perform public.dar_xp(j.user_id, 0, '{}'::jsonb, array['quinhentas-palavras']);
    end if;
  end loop;
end;
$$;

revoke all on function public.letreiro_premia(uuid) from public;

-- ── a apuração vira duas: a conta da partida, e o crédito na conta da vida ──
-- `letreiro_score` passa a ser o embrulho: ele apura e credita. Assim o XP
-- nunca fica de fora quando alguém mexer na apuração.

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
  select * into partida from public.matches where id = p_match for update;
  if not found or partida.status <> 'running' then return; end if;

  select * into tabuleiro from public.letreiro_boards where id = partida.board_id;

  regra := coalesce(
    partida.public_state ->> 'scoring',
    (select r.settings ->> 'anulacao' from public.rooms r where r.id = partida.room_id),
    'classica'
  );

  create temp table _sub on commit drop as
  select mps.user_id, (w ->> 'w') as palavra, (w ->> 'p') as caminho
    from public.match_private_state mps
    cross join lateral jsonb_array_elements(mps.data -> 'words') w
   where mps.match_id = p_match;

  delete from _sub s
   where not (tabuleiro.solution ? s.palavra)
      or not public.letreiro_path_ok(tabuleiro.grid, s.caminho, s.palavra);

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
               'dup', q.quantos > 1
             ) order by public.letreiro_pontos_palavra(s.palavra) desc, s.palavra) itens
        from _sub s
        join _quantos q on q.palavra = s.palavra
        left join public.dict_pt d on d.norm = s.palavra
       group by s.user_id
    ) x;

  select jsonb_agg(jsonb_build_object(
           'w',   coalesce(d.word, k.palavra),
           'p',   k.caminho,
           'pts', public.letreiro_pontos_palavra(k.palavra)
         ) order by public.letreiro_pontos_palavra(k.palavra))
    into perdidas
    from (
      select key as palavra, value #>> '{}' as caminho
        from jsonb_each(tabuleiro.solution)
       where key not in (select palavra from _sub)
       order by public.letreiro_pontos_palavra(key) desc, key
       limit 5
    ) k
    left join public.dict_pt d on d.norm = k.palavra;

  update public.matches
     set status = 'finished', ended_at = now(), version = version + 1,
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

revoke all on function public.letreiro_score_bruto(uuid) from public;

create or replace function public.letreiro_score(p_match uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.letreiro_score_bruto(p_match);
  perform public.letreiro_premia(p_match);
end;
$$;

revoke all on function public.letreiro_score(uuid) from public;

-- ── Dossiê: fechar o caso vale XP e conquista ──────────────────────────────

create or replace function public.dossie_premia(p_match uuid, p_seat smallint, p_certo boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  quem uuid;
begin
  select user_id into quem from public.match_players
   where match_id = p_match and seat = p_seat;
  if quem is null then return; end if;

  if p_certo then
    perform public.dar_xp(quem, 80,
      jsonb_build_object('partidas', 1, 'vitorias', 1),
      array['caso-fechado']);
  else
    perform public.dar_xp(quem, 10, '{}'::jsonb, array['virou-fantasma']);
  end if;
end;
$$;

revoke all on function public.dossie_premia(uuid, smallint, boolean) from public;

-- ── acusação: credita no mesmo lugar em que decide ─────────────────────────
-- Refeita aqui para chamar `dossie_premia`. O corpo é o de 0012 mais duas
-- linhas — de propósito: crédito longe da decisão é crédito que se esquece.

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
    perform public.dossie_premia(p_match, meu, true);
    return jsonb_build_object('ok', true, 'right', true);
  end if;

  estado := jsonb_set(estado, '{ghosts}', (estado -> 'ghosts') || to_jsonb(meu));
  update public.matches set public_state = estado, version = version + 1 where id = p_match;
  perform public.dossie_premia(p_match, meu, false);
  perform public.dossie_advance(p_match);

  return jsonb_build_object('ok', true, 'right', false);
end;
$$;

revoke all on function public.dossie_accuse(uuid, text, text, text) from public;
grant execute on function public.dossie_accuse(uuid, text, text, text) to authenticated;
