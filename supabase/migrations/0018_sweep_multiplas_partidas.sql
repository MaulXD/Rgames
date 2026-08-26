-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0018 · a varredura precisa aguentar mais de uma partida
--
-- `letreiro_score_bruto` cria as tabelas temporárias `_sub` e `_quantos` com
-- ON COMMIT DROP. Mas `letreiro_sweep` percorre TODAS as partidas vencidas na
-- MESMA transação: a primeira cria as temporárias, o commit ainda não veio, e
-- a segunda estoura com
--
--     relation "_sub" already exists
--
-- Na prática: bastava haver duas rodadas vencendo juntas para a segunda nunca
-- ser apurada. O teste de fumaça só pegou depois que sobraram partidas
-- antigas de execuções anteriores — e aí a fila tinha duas.
--
-- Conserto: derrubar as temporárias na entrada da função, não confiar no
-- commit. Vale para qualquer função que use temporária dentro de laço.
-- ═══════════════════════════════════════════════════════════════════════════

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

  -- a varredura chama isto em laço, na mesma transação
  drop table if exists _sub;
  drop table if exists _quantos;

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

-- faxina das partidas que ficaram penduradas em execuções de teste
update public.matches
   set status = 'abandoned', ended_at = now()
 where status = 'running' and ends_at < now() - interval '1 hour';
