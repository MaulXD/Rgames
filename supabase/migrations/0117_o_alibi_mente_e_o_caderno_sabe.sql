-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0117 · o álibi mente, e o caderno não pode acreditar
--
-- A carta Álibi existe para uma coisa só: deixar alguém NÃO REFUTAR TENDO A
-- CARTA. É a única mentira legítima do Dossiê.
--
-- E `dossie_pass_refute_como` registra o álibi e, logo em seguida, um `pass`
-- normal. O caderno lê o `pass` e aplica a regra de sempre — "quem passou não
-- tem nenhuma das três" —, que naquele caso é FALSA.
--
-- Isso não é perder informação: é FABRICAR informação falsa, e ela se propaga.
-- O laço de propagação resolve restrições em cima do `naoTem`, e uma premissa
-- errada leva a "o assento N tem a carta C" quando ninguém tem — ou seja, a
-- carta C sai do envelope no caderno de alguém, e o envelope é justamente onde
-- ela está.
--
-- ────────────────────────────────────────────────────────────────────────────
-- COMO ISTO APARECEU
--
-- Pela suíte, uma vez em vinte verificações completas: "uma máquina riscou
-- carta do envelope". A mensagem não trazia o estado, e o defeito não
-- reproduziu em seis tentativas — foi preciso reler QUAL bloco tinha falhado
-- para ver que era o do Modo Avançado, o único em que a máquina joga o álibi.
--
-- A raridade tem explicação: a máquina só gasta o álibi quando tem UMA carta
-- para mostrar e nunca a mostrou àquela pessoa (0107). É pouco frequente, e
-- depois dele ainda é preciso que uma restrição resolva sobre a premissa
-- envenenada.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O ÁLIBI É PÚBLICO, E POR ISSO O CONSERTO É JUSTO
--
-- A linha `alibi` vai para o registro com o assento, e a tela narra: "fulano
-- apresentou um álibi e não precisou mostrar nada". Todo mundo VÊ. Então o
-- caderno pode e deve saber que aquele `pass` não prova nada — não é
-- informação privilegiada, é o que está escrito na mesa.
--
-- O que a carta protege é O QUE ele tem, e isso continua protegido: ninguém
-- descobre a carta, só descobre que não descobriu nada.
--
-- ────────────────────────────────────────────────────────────────────────────
-- E O `no_refute` TAMBÉM
--
-- "Ninguém refutou" prova que nenhum dos outros tem nenhuma das três. Com um
-- álibi na roda, prova isso de todo mundo MENOS de quem alibiou — para essa
-- pessoa, a rodada não disse nada.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────

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
  /* Quem apresentou álibi desde o último palpite. Zera a cada palpite novo,
     porque a carta vale para UMA refutação. */
  comalibi jsonb := '[]'::jsonb;
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

  /* ── o que as Cartas de Pista contaram ────────────────────────────────
     Aviso não é dedução: é um fato que o servidor entregou pronto, lendo o
     envelope por trás de `security definer`. Por isso vive aqui em cima, com a
     própria mão e o Registro da Estação, e não lá embaixo com as regras que só
     a firme e a impiedosa cruzam — a tranquila também lê o que recebeu.

     Uma fonte só: o aviso. Quem transforma aviso em carta riscada é
     `dossie_aviso_ensina`, e é lá que mora a assimetria da impressão digital
     (o NÃO risca dois; o SIM risca os outros quatro). Gravar o fato derivado
     junto com o aviso daria duas fontes para a mesma verdade, e duas fontes
     divergem. */
  for linha in
    select value from jsonb_array_elements(coalesce(priv -> 'pistas' -> 'avisos', '[]'::jsonb))
  loop
    foreach c in array public.dossie_aviso_ensina(tema, linha) loop
      if c is not null and not (fora @> to_jsonb(array[c])) then
        fora := fora || to_jsonb(array[c]);
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
        comalibi := '[]'::jsonb;

      /* ── O ÁLIBI ────────────────────────────────────────────────────────
         A única mentira legítima do jogo: não refutar TENDO a carta.

         `dossie_pass_refute_como` registra o álibi e, logo depois, um `pass`
         normal — e o `pass` diz "não tenho nenhuma das três", que naquele caso
         é falso. Acreditar nele não é perder informação: é FABRICAR informação
         falsa, e ela se propaga pelo laço que resolve restrições em cima do
         `naoTem` até riscar uma carta que está no envelope.

         A linha é PÚBLICA e a tela a narra, então saber disto não é privilégio
         de ninguém — é o que está escrito na mesa. O que a carta protege é O
         QUE ele tem, e isso continua protegido: descobre-se que não se
         descobriu nada. */
      elsif linha ->> 'type' = 'alibi' and linha -> 'seat' is not null then
        comalibi := comalibi || jsonb_build_array((linha ->> 'seat')::smallint);

      elsif linha ->> 'type' = 'pass' and palpite is not null
            and not (comalibi @> jsonb_build_array((linha ->> 'seat')::smallint)) then
        -- REGRA 1: quem passou não tem nenhuma das três — a não ser que tenha
        -- apresentado álibi, e aí a passada não diz nada
        s := linha ->> 'seat';
        for c in select value #>> '{}' from jsonb_array_elements(palpite) loop
          if not coalesce(naotem -> s, '[]'::jsonb) @> to_jsonb(array[c]) then
            naotem := jsonb_set(naotem, array[s],
              coalesce(naotem -> s, '[]'::jsonb) || to_jsonb(array[c]), true);
          end if;
        end loop;

      elsif linha ->> 'type' = 'interroga_nada' then
        /* A DECLARAÇÃO MAIS FORTE DO JOGO: seis cartas de uma vez.

           Um `pass` de refutação diz que a pessoa não tem TRÊS cartas
           nomeadas. Isto diz que ela não tem NENHUMA das seis de um tipo — e
           num baralho de 18 para três mãos, costuma fechar um terço do caderno
           de uma vez.

           Não precisa de `palpite`: a frase é inteira sozinha, ao contrário do
           `pass`, que só significa alguma coisa colado ao palpite anterior. */
        s := linha ->> 'seat';
        foreach c in array public.dossie_cartas_do_tipo(tema, linha ->> 'tipo') loop
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
        /* E QUEM ALIBIOU FICA DE FORA. "Ninguém refutou" prova que nenhum dos
           outros tem nenhuma das três — de todo mundo menos de quem usou a
           carta para não refutar tendo. Para essa pessoa, a rodada não disse
           nada. */
        for outro in select mp.seat from public.match_players mp
                      where mp.match_id = p_match and mp.seat is distinct from autor
                        and not (comalibi @> jsonb_build_array(mp.seat)) loop
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
