-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0057 · o cérebro da máquina no Dossiê
--
-- Este é o mais difícil dos quatro, e por um motivo só: A MÁQUINA NÃO PODE VER
-- O ENVELOPE.
--
-- No Letreiro ela sorteia palavras de uma lista. No Domínio e na Metrópole ela
-- vê o mesmo tabuleiro que todo mundo. Aqui a informação é o jogo inteiro — e
-- uma máquina que espiasse `matches.solution` ganharia na segunda rodada sem
-- que ninguém entendesse por quê. Seria indistinguível de um bug, e pior: seria
-- indistinguível de um adversário bom.
--
-- Então ela deduz. O que ela sabe é exatamente o que uma pessoa na cadeira dela
-- saberia:
--
--   · as cartas da própria mão;
--   · as cartas que MOSTRARAM a ela (o estado privado guarda `seen`, com quem
--     mostrou);
--   · quem refutou e quem passou em cada palpite da mesa — isso é público,
--     e é do que se faz um Dossiê.
--
-- Nunca QUAL carta foi mostrada a outra pessoa. Essa é a linha, e ela não é
-- cruzada em lugar nenhum deste arquivo.
--
-- ─────────────────────────────────────────────────────────────────────────
-- A DEDUÇÃO, e as três regras que a fazem
--
--   1. PASSOU  Quem passa não tem nenhuma das três cartas do palpite. É a
--              informação mais barata da mesa e a mais subestimada.
--
--   2. REFUTOU Quem refuta tem PELO MENOS UMA das três. Vira uma restrição
--              aberta: {assento, [a,b,c]}. Quando duas das três já são
--              sabidamente de outra pessoa (ou minhas), a terceira é dele — e
--              some do envelope.
--
--   3. NINGUÉM REFUTOU  Nenhum dos outros tem nenhuma das três. Ou as cartas
--              estão no envelope, ou na mão de quem palpitou. É a jogada mais
--              forte do jogo e a que decide partidas.
--
-- A propagação roda até parar de mudar. É o mesmo laço que uma pessoa faz no
-- bloco de anotações, e é por isso que o Dossiê tem bloco de anotações.
--
-- ─────────────────────────────────────────────────────────────────────────
-- OS NÍVEIS DIFEREM NO QUANTO ELA INFERE, nunca no que ela vê
--
--   tranquila  usa só o que está na cara: a própria mão e o que mostraram a
--              ela. Não cruza informação. É exatamente como se joga na primeira
--              vez — e demora muito para fechar o caso.
--   firme      cruza os "passou", que é o primeiro salto de quem entendeu o
--              jogo.
--   impiedosa  cruza tudo, inclusive as restrições abertas e o "ninguém
--              refutou". Ela fecha o caso quando dá para fechar, e não depois.
--
-- Nenhuma delas acusa sem certeza: errar a acusação vira fantasma, e uma
-- máquina que se suicida por chute não é um adversário mais fácil, é um
-- adversário quebrado.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── caminho entre salas ────────────────────────────────────────────────────

/**
 * O primeiro passo de um caminho mais curto de `p_de` até `p_para`.
 *
 * Busca em largura sobre adjacência e passagem secreta. Sem isto a máquina
 * andaria em círculos, que é o comportamento que mais denuncia um adversário
 * mal feito.
 */
create or replace function public.dossie_passo_para(
  p_tema jsonb, p_de text, p_para text
)
returns text
language plpgsql
immutable
as $$
declare
  fila    text[] := array[p_de];
  visto   text[] := array[p_de];
  origem  jsonb  := '{}'::jsonb;   -- sala -> de onde se chegou nela
  atual   text;
  v       text;
  passo   text;
begin
  if p_de is null or p_para is null or p_de = p_para then return null; end if;

  while array_length(fila, 1) > 0 loop
    atual := fila[1];
    fila := fila[2:];

    for v in
      select value #>> '{}' from jsonb_array_elements(p_tema -> 'adjacency' -> atual)
      union
      select case when pas ->> 0 = atual then pas ->> 1 else pas ->> 0 end
        from jsonb_array_elements(p_tema -> 'secretPassages') pas
       where pas ->> 0 = atual or pas ->> 1 = atual
    loop
      continue when v = any(visto);
      visto := visto || v;
      origem := jsonb_set(origem, array[v], to_jsonb(atual), true);
      if v = p_para then
        -- volta pela trilha até o vizinho de `p_de`
        passo := v;
        while (origem ->> passo) is distinct from p_de loop
          passo := origem ->> passo;
          exit when passo is null;
        end loop;
        return passo;
      end if;
      fila := fila || v;
    end loop;
  end loop;

  return null;   -- sala inalcançável: o validador de temas garante que não há
end;
$$;

revoke all on function public.dossie_passo_para(jsonb, text, text)
  from public, anon, authenticated;

-- ── a dedução ──────────────────────────────────────────────────────────────

/**
 * Relê o registro desde a última vez e atualiza o que a máquina SABE.
 *
 * Guarda o resultado no estado privado dela, em `dedu`, e devolve. Guardar é
 * necessário e não é preguiça: `dossie_log` mantém 80 linhas, então uma partida
 * longa perde o começo do registro. Uma máquina que recalculasse do zero a cada
 * turno esqueceria o que aprendeu na rodada dois — que é exatamente o oposto de
 * jogar Dossiê.
 *
 * O que ela grava é só o que ela pôde observar. Não há nenhuma leitura de
 * `matches.solution` neste arquivo.
 */
create or replace function public.dossie_deduz(p_match uuid, p_seat smallint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
         where not coalesce(naotem -> s, '[]'::jsonb) @> to_jsonb(array[x #>> '{}']);

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
$$;

revoke all on function public.dossie_deduz(uuid, smallint) from public, anon, authenticated;

/** Os candidatos de uma categoria: o que ainda não foi riscado. */
create or replace function public.dossie_candidatos(
  p_tema jsonb, p_dedu jsonb, p_tipo text
)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(id order by id), '{}')
    from (
      select c ->> 'id' id
        from jsonb_array_elements(
          case p_tipo
            when 'suspect' then p_tema -> 'suspects'
            when 'weapon'  then p_tema -> 'weapons'
            else p_tema -> 'rooms'
          end) c
    ) t
   where not coalesce(p_dedu -> 'fora', '[]'::jsonb) @> to_jsonb(array[id]);
$$;

revoke all on function public.dossie_candidatos(jsonb, jsonb, text)
  from public, anon, authenticated;

-- ── um passo ───────────────────────────────────────────────────────────────

/**
 * Faz UM passo de máquina no Dossiê e devolve o que fez, ou nulo.
 *
 * A granularidade é a mesma da Metrópole e pelo mesmo motivo: andar, palpitar e
 * refutar são três momentos, e a mesa precisa VER cada um. Um palpite que
 * aparece junto com a refutação é um palpite que ninguém leu.
 */
create or replace function public.dossie_bot_passo(p_match uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
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
         where pend -> 'guess' @> to_jsonb(array[c #>> '{}']);

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
$$;

revoke all on function public.dossie_bot_passo(uuid) from public, anon, authenticated;

-- ── o RPC do ritmo ─────────────────────────────────────────────────────────

create or replace function public.dossie_tocar(p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  vivo  text;
  passo text;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select m.status into vivo from public.matches m where m.id = p_match;
  if not found then raise exception 'MATCH_NOT_FOUND'; end if;
  if vivo <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;

  if not exists (
    select 1 from public.match_players mp
     where mp.match_id = p_match and mp.user_id = auth.uid()
  ) then
    raise exception 'NOT_A_PLAYER';
  end if;

  passo := public.dossie_bot_passo(p_match);

  return jsonb_build_object('passo', passo);
end;
$$;

revoke all on function public.dossie_tocar(uuid) from public, anon, authenticated;
grant execute on function public.dossie_tocar(uuid) to authenticated;

create or replace function public.dossie_toca_pendentes(p_match uuid, p_max int default 30)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare quantos int := 0;
begin
  for i in 1 .. greatest(p_max, 1) loop
    exit when public.dossie_bot_passo(p_match) is null;
    quantos := quantos + 1;
  end loop;
  return quantos;
end;
$$;

revoke all on function public.dossie_toca_pendentes(uuid, int)
  from public, anon, authenticated;

-- ── e a máquina passa a saber jogar os quatro ──────────────────────────────

create or replace function public.bot_sabe_jogar(p_game text)
returns boolean
language sql
immutable
as $$
  select p_game = any (array['letreiro', 'dominio', 'metropole', 'dossie']);
$$;

revoke all on function public.bot_sabe_jogar(text) from public, anon, authenticated;
