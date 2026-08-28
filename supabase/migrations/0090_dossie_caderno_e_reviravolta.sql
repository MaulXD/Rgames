-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0090 · o caderno de dedução aprende as reviravoltas
--
-- `dossie_deduz` foi escrita quando refutação tinha sempre um dono e o log
-- nunca falava sozinho. As reviravoltas quebram as duas premissas, e as duas
-- quebras são silenciosas.
--
-- ────────────────────────────────────────────────────────────────────────────
-- 1. O APAGÃO FABRICAVA CONHECIMENTO FALSO
--
-- O laço do que foi mostrado dizia:
--
--     where mp.seat is distinct from (linha ->> 'from')::smallint
--
-- No apagão, `from` é nulo. E `x is distinct from null` é VERDADE para todo
-- assento — então uma carta mostrada no escuro marcava a MESA INTEIRA como não
-- tendo aquela carta, inclusive quem acabara de mostrá-la.
--
-- Isso não é perder informação. É inventar informação, e ela se PROPAGA: o laço
-- de baixo resolve restrições em cima do `naoTem`, e o fim da linha é uma
-- máquina acusando com certeza uma carta que está na mão de alguém.
--
-- É a mesma família dos defeitos de NULL que este projeto já pagou três vezes
-- (0029, 0033, 0073): a comparação com nulo não deu erro, não deu aviso, e deu
-- a resposta errada com toda a confiança do mundo.
--
-- Agora a carta continua saindo do envelope — que é o que o Apagão promete não
-- tirar de você — e a atribuição some, que é exatamente o que deve sumir.
--
-- ────────────────────────────────────────────────────────────────────────────
-- 2. A RESTRIÇÃO ABERTA SEM DONO NUNCA RESOLVIA
--
-- Uma restrição aberta é a frase "o assento N tem uma destas três". Sem o N não
-- há frase. Guardada com `seat: null`, ela nunca descarta nada — o laço procura
-- o `naoTem` de um assento que não existe — e fica na lista até o fim da
-- partida. Lixo silencioso que cresce.
--
-- ────────────────────────────────────────────────────────────────────────────
-- 3. E O REGISTRO DA ESTAÇÃO ENTRA NO BLOCO DO QUE ESTÁ NA CARA
--
-- O fato que NÚBIA publica é PÚBLICO e verdadeiro. Não é dedução, é anúncio —
-- então vale para os três níveis, inclusive a tranquila, que não cruza nada.
-- Pôr isso atrás de `nivel <> 'facil'` seria fazer a máquina fácil não ouvir o
-- alto-falante que toca para a mesa toda.
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

    /* NO APAGÃO, `from` é nulo — e é aqui que ele tinha de ser tratado.

       `mp.seat is distinct from null` é VERDADE para todo assento. Sem esta
       guarda, uma carta mostrada no escuro marcaria TODA a mesa como não tendo
       a carta, inclusive quem acabou de mostrá-la. Isso não é perder
       informação: é FABRICAR informação falsa, e ela se propaga — o laço lá
       embaixo resolve restrições em cima do `naoTem`, e a máquina acaba
       acusando com certeza uma carta que está na mão de alguém.

       A carta continua saindo do envelope, que é o que o apagão promete não
       tirar de você. O que some é a atribuição, e é exatamente o que deve
       sumir. */
    if (linha -> 'from') is not null and linha -> 'from' <> 'null'::jsonb then
      -- quem mostrou tem a carta; logo mais ninguém tem
      for outro in select mp.seat from public.match_players mp
                    where mp.match_id = p_match
                      and mp.seat is distinct from (linha ->> 'from')::smallint loop
        if not coalesce(naotem -> outro.seat::text, '[]'::jsonb) @> to_jsonb(array[c]) then
          naotem := jsonb_set(naotem, array[outro.seat::text],
            coalesce(naotem -> outro.seat::text, '[]'::jsonb) || to_jsonb(array[c]), true);
        end if;
      end loop;
    end if;
  end loop;

  /* ── o que NÚBIA publicou ─────────────────────────────────────────────
     O Registro da Estação é um fato PÚBLICO e verdadeiro: aquela carta não está
     no envelope. Não é dedução, é anúncio — por isso vive aqui, no bloco do que
     está na cara, e não lá embaixo com as regras que só a firme e a impiedosa
     cruzam. A tranquila também ouviu o alto-falante.

     Não diz de QUEM é a carta, e é de propósito: dizer isso entregaria a mão de
     alguém, e a reviravolta promete um fato sobre o ENVELOPE. */
  for linha in
    select value from jsonb_array_elements(coalesce(est -> 'log', '[]'::jsonb)) l
     where l.value ->> 'type' = 'registro'
  loop
    c := linha ->> 'card';
    if c is not null and not (fora @> to_jsonb(array[c])) then
      fora := fora || to_jsonb(array[c]);
    end if;
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
        /* E não quando foi no escuro: uma restrição aberta é a frase "o
           assento N tem uma destas três". Sem o N, não há frase — e guardá-la
           com `seat: null` encheria a lista de restrições que nunca resolvem,
           porque o laço de propagação procura o `naoTem` de um assento que não
           existe e nunca descarta nada. Lixo silencioso que cresce a partida
           inteira. */
        if autor is distinct from p_seat
           and linha -> 'seat' is not null and linha -> 'seat' <> 'null'::jsonb then
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
