-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0017 · conserta o append de conquista
--
-- `conquistas := conquistas || 'primeira-palavra'` parece óbvio e não é:
-- o literal chega como `unknown`, o Postgres prefere o operador
-- `anyarray || anyarray`, tenta ler 'primeira-palavra' COMO array e estoura em
-- array_in. O erro apareceu na varredura, dentro de letreiro_score, e derrubou
-- a apuração inteira da rodada.
--
-- Conserto: `array_append`, que não deixa dúvida de tipo.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.letreiro_premia(p_match uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  j          record;
  tabuleiro  public.letreiro_boards;
  conquistas text[];
  palavras   int;
  maior      int;
  tem_qu     boolean;
  melhor_w   text;
  melhor_p   int;
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

    select coalesce((stats ->> 'palavras')::int, 0) into total_vida
      from public.profiles where id = j.user_id;

    if total_vida >= 500 then
      perform public.dar_xp(j.user_id, 0, '{}'::jsonb, array['cem-palavras', 'quinhentas-palavras']);
    elsif total_vida >= 100 then
      perform public.dar_xp(j.user_id, 0, '{}'::jsonb, array['cem-palavras']);
    end if;
  end loop;
end;
$$;

revoke all on function public.letreiro_premia(uuid) from public;
