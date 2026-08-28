-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0085 · o nível FIRME não deduzia nada a mais que o tranquilo
--
-- Medido com a MESMA mão, a MESMA mesa e o MESMO registro, deduzidos nos três
-- níveis:
--
--     tranquila 11 · firme 11 · impiedosa 11
--
-- Os três chegam ao mesmo lugar, e o teste que devia provar a escada provou que
-- ela não existia.
--
-- O DEFEITO É DE DESENHO, e é bonito de olhar. `dossie_deduz` fazia assim:
--
--   facil     mão + o que mostraram a ela
--   medio     + anota quem PASSOU (regra 1)
--   dificil   + restrições abertas, "ninguém refutou", e a PROPAGAÇÃO
--
-- Anotar quem passou não risca carta nenhuma sozinho. `naoTem` só vira
-- conhecimento quando alguém CRUZA: "fulano refutou este palpite, e eu já sei
-- que ele não tem duas das três, logo tem a terceira". Essa segunda metade
-- estava inteira no impiedoso.
--
-- Ou seja: o firme fazia o trabalho e jogava fora o resultado. Ele pagava o
-- custo de anotar sem receber o benefício de concluir — que é o pior lugar
-- possível para um nível intermediário estar.
--
-- Agora a escada é de verdade:
--
--   tranquila  o que está na cara: a própria mão e o que mostraram a ela
--   firme      cruza os "passou" com as refutações e conclui (a dedução
--              clássica de mesa, a que uma pessoa faz no bloco de anotações)
--   impiedosa  o mesmo, mais o "ninguém refutou" — a jogada mais forte do jogo,
--              e a que separa quem joga bem de quem joga muito bem
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.dossie_deduz(p_match uuid, p_seat smallint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  est     jsonb;
  tema    jsonb;
  quem    uuid;
  priv    jsonb;
  nivel   text;
  dedu    jsonb;
  visto   int;
  fora    jsonb;
  naotem  jsonb;
  abertos jsonb;
  linha   jsonb;
  palpite jsonb;
  autor   smallint;
  c       text;
  s       text;
  mudou   boolean;
  restam  jsonb;
  i       int;
  outro   record;
begin
  select m.public_state into est from public.matches m where m.id = p_match;
  select gt.data into tema from public.game_themes gt where gt.id = (est ->> 'theme');
  quem := public.dossie_dono(p_match, p_seat);
  if quem is null then return null; end if;

  select mps.data into priv from public.match_private_state mps
   where mps.match_id = p_match and mps.user_id = quem;

  select coalesce(rm.bot_nivel, 'medio') into nivel
    from public.matches m
    join public.room_members rm on rm.room_id = m.room_id and rm.user_id = quem
   where m.id = p_match;
  nivel := coalesce(nivel, 'medio');

  dedu := coalesce(priv -> 'dedu', '{}'::jsonb);
  visto := coalesce((dedu ->> 'visto')::int, -1);
  fora := coalesce(dedu -> 'fora', '[]'::jsonb);
  naotem := coalesce(dedu -> 'naoTem', '{}'::jsonb);
  abertos := coalesce(dedu -> 'abertos', '[]'::jsonb);

  /* ── o que está na cara ───────────────────────────────────────────────
     A própria mão sai do envelope, e ninguém mais tem essas cartas. O que
     mostraram a ela idem, e o dono é conhecido. Isto todo nível usa. */
  for c in select value #>> '{}' from jsonb_array_elements(coalesce(priv -> 'hand', '[]'::jsonb)) loop
    if not (fora @> to_jsonb(array[c])) then fora := fora || to_jsonb(array[c]); end if;
    for outro in select mp.seat from public.match_players mp
                  where mp.match_id = p_match and mp.seat <> p_seat loop
      if not coalesce(naotem -> outro.seat::text, '[]'::jsonb) @> to_jsonb(array[c]) then
        naotem := jsonb_set(naotem, array[outro.seat::text],
          coalesce(naotem -> outro.seat::text, '[]'::jsonb) || to_jsonb(array[c]), true);
      end if;
    end loop;
  end loop;

  for linha in select value from jsonb_array_elements(coalesce(priv -> 'seen', '[]'::jsonb)) loop
    c := linha ->> 'card';
    if not (fora @> to_jsonb(array[c])) then fora := fora || to_jsonb(array[c]); end if;
    -- quem mostrou tem a carta; logo mais ninguém tem
    for outro in select mp.seat from public.match_players mp
                  where mp.match_id = p_match
                    and mp.seat is distinct from (linha ->> 'from')::smallint loop
      if not coalesce(naotem -> outro.seat::text, '[]'::jsonb) @> to_jsonb(array[c]) then
        naotem := jsonb_set(naotem, array[outro.seat::text],
          coalesce(naotem -> outro.seat::text, '[]'::jsonb) || to_jsonb(array[c]), true);
      end if;
    end loop;
  end loop;

  /* ── o registro, do mais antigo para o mais novo ──────────────────────
     A tranquila para aqui: ela não cruza informação da mesa, e é assim que se
     joga na primeira vez. */
  if nivel <> 'facil' then
    palpite := null;
    autor := null;
    for linha in
      select value from jsonb_array_elements(coalesce(est -> 'log', '[]'::jsonb)) l
       where coalesce((l.value ->> 'seq')::int, 0) > visto
       order by (value ->> 'seq')::int
    loop
      visto := greatest(visto, coalesce((linha ->> 'seq')::int, visto));

      if linha ->> 'type' = 'suggest' then
        palpite := linha -> 'guess';
        autor := (linha ->> 'seat')::smallint;

      elsif linha ->> 'type' = 'pass' and palpite is not null then
        -- REGRA 1: quem passou não tem nenhuma das três
        s := linha ->> 'seat';
        for c in select value #>> '{}' from jsonb_array_elements(palpite) loop
          if not coalesce(naotem -> s, '[]'::jsonb) @> to_jsonb(array[c]) then
            naotem := jsonb_set(naotem, array[s],
              coalesce(naotem -> s, '[]'::jsonb) || to_jsonb(array[c]), true);
          end if;
        end loop;

      elsif linha ->> 'type' = 'refute' and palpite is not null then
        -- REGRA 2: restrição aberta. Só a impiedosa cruza isto.
        -- Quando fui EU quem palpitou, `seen` já me disse a carta e a restrição
        -- nasce resolvida — por isso ela não é guardada nesse caso.
        if autor is distinct from p_seat then
          abertos := abertos || jsonb_build_array(jsonb_build_object(
            'seat', (linha ->> 'seat')::smallint, 'cartas', palpite));
        end if;

      elsif linha ->> 'type' = 'no_refute' and palpite is not null and nivel = 'dificil' then
        /* REGRA 3: ninguém refutou. Nenhum dos outros tem nenhuma das três —
           ou estão no envelope, ou na mão de quem palpitou. É a jogada mais
           forte do jogo. */
        for outro in select mp.seat from public.match_players mp
                      where mp.match_id = p_match and mp.seat is distinct from autor loop
          for c in select value #>> '{}' from jsonb_array_elements(palpite) loop
            if not coalesce(naotem -> outro.seat::text, '[]'::jsonb) @> to_jsonb(array[c]) then
              naotem := jsonb_set(naotem, array[outro.seat::text],
                coalesce(naotem -> outro.seat::text, '[]'::jsonb) || to_jsonb(array[c]), true);
            end if;
          end loop;
        end loop;
      end if;
    end loop;
  end if;

  /* ── propagação, até parar de mudar ───────────────────────────────────
     É o mesmo laço que uma pessoa faz no bloco de anotações: risca o que já
     sabe, olha o que sobrou, risca de novo. */
  if nivel <> 'facil' then
    loop
      mudou := false;
      for i in 0 .. coalesce(jsonb_array_length(abertos), 0) - 1 loop
        continue when abertos -> i = 'null'::jsonb;
        s := (abertos -> i ->> 'seat');
        select coalesce(jsonb_agg(x), '[]'::jsonb) into restam
          from jsonb_array_elements_text(abertos -> i -> 'cartas') x
         where not coalesce(naotem -> s, '[]'::jsonb) @> to_jsonb(array[x]);

        if jsonb_array_length(restam) = 1 then
          c := restam ->> 0;
          if not (fora @> to_jsonb(array[c])) then
            fora := fora || to_jsonb(array[c]);
            mudou := true;
          end if;
          -- ele tem a carta, então mais ninguém tem
          for outro in select mp.seat from public.match_players mp
                        where mp.match_id = p_match and mp.seat::text <> s loop
            if not coalesce(naotem -> outro.seat::text, '[]'::jsonb) @> to_jsonb(array[c]) then
              naotem := jsonb_set(naotem, array[outro.seat::text],
                coalesce(naotem -> outro.seat::text, '[]'::jsonb) || to_jsonb(array[c]), true);
              mudou := true;
            end if;
          end loop;
          abertos := jsonb_set(abertos, array[i::text], 'null'::jsonb);
        elsif jsonb_array_length(restam) = 0 then
          -- restrição impossível: o registro perdeu a linha do palpite. Some.
          abertos := jsonb_set(abertos, array[i::text], 'null'::jsonb);
        end if;
      end loop;
      exit when not mudou;
    end loop;

    -- as resolvidas saem da lista, senão ela cresce a partida inteira
    select coalesce(jsonb_agg(x), '[]'::jsonb) into abertos
      from jsonb_array_elements(abertos) x where x <> 'null'::jsonb;
  end if;

  dedu := jsonb_build_object(
    'visto', visto, 'fora', fora, 'naoTem', naotem, 'abertos', abertos);

  update public.match_private_state
     set data = jsonb_set(coalesce(data, '{}'::jsonb), '{dedu}', dedu, true)
   where match_id = p_match and user_id = quem;

  return dedu;
end;
$function$;

revoke all on function public.dossie_deduz(uuid, smallint) from public, anon, authenticated;
