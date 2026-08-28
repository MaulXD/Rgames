-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0058 · `text #>> unknown` — duas linhas do cérebro do Dossiê
--
--     operator does not exist: text #>> unknown
--
-- `jsonb_array_elements_text` devolve TEXT, e `jsonb_array_elements` devolve
-- JSONB. Escrevi `x #>> '{}'` — que é como se tira o texto de um jsonb — em cima
-- de duas variáveis que JÁ eram texto, porque no mesmo arquivo há quatro laços
-- que usam a função jsonb e onde `#>> '{}'` é exatamente o certo.
--
-- Um erro de digitação com cara de erro de tipo, e o Postgres pegou. O que ele
-- NÃO teria pegado é se as duas funções fossem silênciosamente diferentes — e é
-- por isso que o conserto é GERADO das definições vivas, com as duas trocas
-- exatas, em vez de eu recopiar duzentas linhas de corpo à mão.
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

      elsif linha ->> 'type' = 'refute' and palpite is not null and nivel = 'dificil' then
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
  if nivel = 'dificil' then
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
$function$
;

CREATE OR REPLACE FUNCTION public.dossie_bot_passo(p_match uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  est     jsonb;
  tema    jsonb;
  semente bigint;
  assento smallint;
  quem    uuid;
  nivel   text;
  dedu    jsonb;
  priv    jsonb;

  pend    jsonb;
  fila    jsonb;
  naVez   smallint;
  mostrar text;
  tenho   text[];

  aqui    text;
  alvo    text;
  passo   text;
  susp    text[];
  arma    text[];
  sala    text[];
begin
  select m.public_state, m.seed into est, semente
    from public.matches m
   where m.id = p_match and m.game_key = 'dossie' and m.status = 'running'
   for update;
  if not found then return null; end if;

  select gt.data into tema from public.game_themes gt where gt.id = (est ->> 'theme');

  /* ── 1. REFUTAR ────────────────────────────────────────────────────────
     Primeiro de todos: enquanto a fila de refutação não anda, a mesa inteira
     espera, e o relógio dela é de trinta segundos. */
  if est ->> 'phase' = 'refute' and est -> 'pending' <> 'null'::jsonb
     and est -> 'pending' is not null then
    pend := est -> 'pending';
    fila := pend -> 'queue';
    naVez := (fila ->> coalesce((pend ->> 'at')::int, 0))::smallint;

    if naVez is not null then
      quem := public.dossie_dono(p_match, naVez);
      if exists (select 1 from public.profiles p where p.id = quem and p.is_bot) then
        select mps.data into priv from public.match_private_state mps
         where mps.match_id = p_match and mps.user_id = quem;

        /* QUAL CARTA MOSTRAR, quando há mais de uma.
           A regra de mesa: mostre de novo a que já mostrou àquela pessoa. Cada
           carta nova revelada é informação de graça para quem perguntou, e a
           máquina que dá informação de graça é a máquina que perde. */
        select array_agg(c order by c) into tenho
          from jsonb_array_elements_text(coalesce(priv -> 'hand', '[]'::jsonb)) c
         where pend -> 'guess' @> to_jsonb(array[c]);

        if tenho is null or array_length(tenho, 1) = 0 then
          perform public.dossie_pass_refute_como(naVez, p_match);
          return format('refuta:passa(%s)', naVez);
        end if;

        select c into mostrar
          from unnest(tenho) c
         where exists (
           select 1 from jsonb_array_elements(coalesce(priv -> 'mostrei', '[]'::jsonb)) m
            where m ->> 'card' = c and (m ->> 'para')::smallint = (pend ->> 'bySeat')::smallint
         )
         limit 1;

        if mostrar is null then
          -- nenhuma repetida: escolhe estável, sem `random()`
          select c into mostrar from unnest(tenho) c
           order by ('x' || substr(md5(semente::text || naVez::text || c), 1, 6))::bit(24)::int
           limit 1;
        end if;

        perform public.dossie_refute_como(naVez, p_match, mostrar);

        -- e ela ANOTA a quem mostrou, para poder repetir na próxima
        update public.match_private_state
           set data = jsonb_set(coalesce(data, '{}'::jsonb), '{mostrei}',
                 coalesce(data -> 'mostrei', '[]'::jsonb) || jsonb_build_array(
                   jsonb_build_object('card', mostrar, 'para', (pend ->> 'bySeat')::int)), true)
         where match_id = p_match and user_id = quem;

        return format('refuta:mostra(%s)', naVez);
      end if;
    end if;
    return null;   -- é vez de gente refutar
  end if;

  /* ── 2. A VEZ DELA ────────────────────────────────────────────────────── */
  if est ->> 'phase' <> 'turn' then return null; end if;

  assento := (est ->> 'turnSeat')::smallint;
  quem := public.dossie_dono(p_match, assento);
  if not exists (select 1 from public.profiles p where p.id = quem and p.is_bot) then
    return null;
  end if;

  select coalesce(rm.bot_nivel, 'medio') into nivel
    from public.matches m
    join public.room_members rm on rm.room_id = m.room_id and rm.user_id = quem
   where m.id = p_match;
  nivel := coalesce(nivel, 'medio');

  dedu := public.dossie_deduz(p_match, assento);
  susp := public.dossie_candidatos(tema, dedu, 'suspect');
  arma := public.dossie_candidatos(tema, dedu, 'weapon');
  sala := public.dossie_candidatos(tema, dedu, 'room');

  /* 2a. FECHOU O CASO? Um candidato em cada categoria e ela ainda não acusou.
     Nunca acusa sem certeza: errar vira fantasma, e máquina que se suicida por
     chute não é adversário mais fácil, é adversário quebrado. */
  if coalesce(array_length(susp, 1), 0) = 1
     and coalesce(array_length(arma, 1), 0) = 1
     and coalesce(array_length(sala, 1), 0) = 1
     and not coalesce(est -> 'accused' @> to_jsonb(array[assento]), false) then
    perform public.dossie_accuse_como(assento, p_match, susp[1], arma[1], sala[1]);
    return format('acusa(%s) %s, %s, %s', assento, susp[1], arma[1], sala[1]);
  end if;

  -- fantasma não joga, só refuta
  if coalesce(est -> 'ghosts' @> to_jsonb(array[assento]), false) then
    perform public.dossie_end_turn_como(assento, p_match);
    return format('passa(%s) fantasma', assento);
  end if;

  aqui := est -> 'positions' ->> assento::text;

  /* 2b. PALPITAR, se a sala em que ela está ainda é candidata.
     Palpitar numa sala já riscada gasta o turno para confirmar o que ela já
     sabe — e é o erro que mais denuncia uma máquina sem cabeça. */
  if (est ->> 'actionsLeft')::int >= 1
     and aqui is not null
     and (nivel = 'facil' or aqui = any(sala) or coalesce(array_length(sala, 1), 0) <= 1) then
    perform public.dossie_suggest_como(
      assento, p_match,
      susp[1 + (('x' || substr(md5(semente::text || est ->> 'seq' || 's'), 1, 6))::bit(24)::int
                % greatest(coalesce(array_length(susp, 1), 1), 1))],
      arma[1 + (('x' || substr(md5(semente::text || est ->> 'seq' || 'a'), 1, 6))::bit(24)::int
                % greatest(coalesce(array_length(arma, 1), 1), 1))]
    );
    return format('palpita(%s) em %s', assento, aqui);
  end if;

  /* 2c. ANDAR na direção da sala candidata mais próxima. */
  if (est ->> 'actionsLeft')::int >= 1 and aqui is not null then
    select s into alvo
      from unnest(sala) s
     where s <> aqui
     order by ('x' || substr(md5(semente::text || assento::text || s), 1, 6))::bit(24)::int
     limit 1;

    if alvo is not null then
      passo := public.dossie_passo_para(tema, aqui, alvo);
      if passo is not null then
        perform public.dossie_move_como(assento, p_match, passo);
        return format('anda(%s) para %s', assento, passo);
      end if;
    end if;
  end if;

  -- 2d. nada a fazer: passa
  perform public.dossie_end_turn_como(assento, p_match);
  return format('passa(%s)', assento);
end;
$function$
;

revoke all on function public.dossie_deduz(uuid, smallint) from public, anon, authenticated;
revoke all on function public.dossie_bot_passo(uuid) from public, anon, authenticated;
