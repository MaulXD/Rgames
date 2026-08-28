-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0096 · a apuração consulta a lista antes de gravar o troféu
--
-- 0095 criou `palavra_apresentavel` e a tabela de radicais, e ninguém as
-- chamava. Uma linha. É a metade do trabalho que não aparece em lugar nenhum e
-- sem a qual as outras duzentas não valem nada — mesma forma da 0088, em que as
-- três reviravoltas existiam e nada as disparava.
--
-- A palavra continua valendo na partida: pontua, aparece na revelação, conta
-- para as conquistas. O que ela não faz é virar o troféu permanente do perfil.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.letreiro_premia(p_match uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  j          record;
  tabuleiro  public.letreiro_boards;
  conquistas text[];
  palavras   int;
  maior      int;
  tem_qu     boolean;
  melhor_w   text;
  melhor_p   int;
  rara_w     text;
  rara_f     int;
  total_vida int;
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
    conquistas := array[]::text[];
    palavras := coalesce(jsonb_array_length(j.words), 0);

    select coalesce(max(char_length(w ->> 'w')), 0),
           coalesce(bool_or((w ->> 'w') like '%QU%'), false)
      into maior, tem_qu
      from jsonb_array_elements(coalesce(j.words, '[]'::jsonb)) w;

    melhor_w := null;
    melhor_p := null;
    select (w ->> 'w'), (w ->> 'pts')::int
      into melhor_w, melhor_p
      from jsonb_array_elements(coalesce(j.words, '[]'::jsonb)) w
     order by (w ->> 'pts')::int desc
     limit 1;

    if palavras >= 1 then
      conquistas := array_append(conquistas, 'primeira-palavra');
    end if;
    if maior >= 8 then
      conquistas := array_append(conquistas, 'oito-letras');
    end if;
    if tem_qu then
      conquistas := array_append(conquistas, 'palavra-qu');
    end if;
    if coalesce(tabuleiro.max_score, 0) > 0 and j.score * 2 >= tabuleiro.max_score then
      conquistas := array_append(conquistas, 'meia-grade');
    end if;

    perform public.dar_xp(
      j.user_id,
      coalesce(j.score, 0),
      jsonb_build_object('partidas', 1, 'palavras', palavras),
      conquistas
    );

    if melhor_w is not null then
      perform public.melhor_palavra(j.user_id, melhor_w, melhor_p);
    end if;

    /* A PALAVRA MAIS RARA, entre as que o corpus CONHECE.

       `dict_pt.freq` é um POSTO, não uma contagem — e é nulo para a maior parte
       do dicionário, porque a lista de frequência de fala cobre uma fração das
       248 mil palavras. Tratar nulo como "raríssima" faria a estatística
       premiar exatamente o lixo: flexão obscura que ninguém diz, que é o mesmo
       defeito que fez a revelação mostrar ONO, ADE e ADELE.

       Sem posto, o corpus nunca ouviu a palavra. E palavra que ninguém diz não
       é troféu — é ruído com cara de troféu. */
    rara_w := null;
    rara_f := null;
    select d.word, d.freq into rara_w, rara_f
      from jsonb_array_elements(coalesce(j.words, '[]'::jsonb)) w
      join public.dict_pt d on d.norm = (w ->> 'w')
     where d.freq is not null
       -- e o troféu tem de ser apresentável: ver 0095
       and public.palavra_apresentavel(d.norm)
     order by d.freq desc
     limit 1;

    if rara_w is not null then
      perform public.palavra_rara(j.user_id, rara_w, rara_f);
    end if;

    /* O APROVEITAMENTO: seus pontos sobre o teto da grade. */
    if coalesce(tabuleiro.max_score, 0) > 0 then
      perform public.aproveitamento(j.user_id, coalesce(j.score, 0), tabuleiro.max_score);
    end if;

    select coalesce((stats ->> 'palavras')::int, 0) into total_vida
      from public.profiles where id = j.user_id;

    if total_vida >= 500 then
      perform public.dar_xp(j.user_id, 0, '{}'::jsonb, array['cem-palavras', 'quinhentas-palavras']);
    elsif total_vida >= 100 then
      perform public.dar_xp(j.user_id, 0, '{}'::jsonb, array['cem-palavras']);
    end if;
  end loop;
end;
$function$;

revoke all on function public.letreiro_premia(uuid) from public, anon, authenticated;
