-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0014 · pontuação por valor de letra
--
-- A tabela clássica do Boggle (3–4=1, 5=2, 6=3, 7=5, 8+=11) só olha o
-- TAMANHO. Resultado: achar QUEIJO vale igual a achar SEREIA, e as letras
-- difíceis (Q, X, Z, J) não recompensam nada — ninguém as procura.
--
-- Passa a valer o modelo do Boggle With Friends: cada letra tem um valor, e o
-- comprimento entra como bônus. Os valores seguem a distribuição oficial do
-- Scrabble brasileiro, que já é calibrada pela frequência do português.
--
--   1 → A E I O U S M R T      2 → D L C P      3 → N B
--   4 → F G H V                5 → J Q          6 → X Z
--
--   bônus por tamanho: 3→0  4→+1  5→+3  6→+5  7→+8  8+→+14
--
-- Efeito colateral bom: a face QU passa a valer 6 pontos (Q5 + U1) e conta
-- como duas letras. De lixo a prêmio.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.letreiro_pontos_palavra(p_word text)
returns integer
language plpgsql
immutable
as $$
declare
  n int := char_length(p_word);
  soma int := 0;
  ch text;
begin
  if n = 0 then
    return 0;
  end if;

  for i in 1..n loop
    ch := substr(p_word, i, 1);
    soma := soma + case
      when ch in ('A','E','I','O','U','S','M','R','T') then 1
      when ch in ('D','L','C','P')                     then 2
      when ch in ('N','B')                             then 3
      when ch in ('F','G','H','V')                     then 4
      when ch in ('J','Q')                             then 5
      when ch in ('X','Z')                             then 6
      else 1
    end;
  end loop;

  return soma + case
    when n <= 3 then 0
    when n = 4  then 1
    when n = 5  then 3
    when n = 6  then 5
    when n = 7  then 8
    else 14
  end;
end;
$$;

revoke all on function public.letreiro_pontos_palavra(text) from public;
grant execute on function public.letreiro_pontos_palavra(text) to authenticated;

-- ── submeter: devolve os pontos novos ──────────────────────────────────────

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

  select * into partida from public.matches where id = p_match;
  if not found or partida.status <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;
  if now() > partida.ends_at then raise exception 'TIME_OVER'; end if;
  if not exists (select 1 from public.match_players
                  where match_id = p_match and user_id = auth.uid()) then
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

  pts := public.letreiro_pontos_palavra(palavra);

  update public.match_private_state
     set data = jsonb_set(
           data, '{words}',
           (data -> 'words') || jsonb_build_object(
             'w', palavra, 'p', p_path, 'pts', pts,
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

-- ── apurar com os valores novos ────────────────────────────────────────────

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

revoke all on function public.letreiro_score(uuid) from public;

-- ── recalcula a pontuação máxima das grades já geradas ─────────────────────
-- Mais barato que gerar o pool de novo: o gabarito não muda, só o valor.

update public.letreiro_boards b
   set max_score = coalesce((
     select sum(public.letreiro_pontos_palavra(k))
       from jsonb_object_keys(b.solution) k
   ), 0);
