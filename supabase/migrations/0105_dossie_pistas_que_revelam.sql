-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0105 · as duas cartas que revelam
--
--   Impressão digital  o servidor diz se o suspeito do envelope está entre dois
--                      que você nomear
--   Recado anônimo     escolha um jogador; ele vê uma carta que NÃO está no
--                      envelope
--
-- As duas leem o ENVELOPE, que é a coisa que ninguém pode ler. Por isso elas são
-- `security definer` e devolvem sempre a MESMA FORMA de resposta: um fato sobre
-- o que NÃO está lá. Nenhuma delas devolve o envelope, nem parte dele, nem uma
-- pista de onde ele está — só recortes do que sobrou.
--
-- ────────────────────────────────────────────────────────────────────────────
-- A IMPRESSÃO DIGITAL É FORTE NOS DOIS RESULTADOS, E ISSO É DE PROPÓSITO
--
-- "Está entre estes dois?" parece uma pergunta de sim ou não, e é — mas as duas
-- respostas valem quase o mesmo:
--
--   NÃO   os dois nomeados saem do envelope. Duas cartas riscadas.
--   SIM   TODOS OS OUTROS saem. Quatro cartas riscadas, e o caso vira uma moeda.
--
-- Uma carta que só serve quando dá sorte é uma carta que ninguém joga. Esta vale
-- a pena nas duas, e o que muda é o QUANTO — o que faz a decisão ser "quais dois
-- eu nomeio", e não "será que dá certo".
--
-- ────────────────────────────────────────────────────────────────────────────
-- O QUE "ANÔNIMO" QUER DIZER NO RECADO
--
-- O registro da mesa diz que alguém jogou um recado, e NÃO diz para quem. Todo
-- mundo vê a carta sair — é uma ação pública, como palpitar — e ninguém sabe
-- quem recebeu.
--
-- E dá para mandar para si mesmo, o que parece brecha e é o desenho: sem isso, a
-- carta seria puro presente e ninguém a jogaria por vontade própria. Com isso,
-- ela é informação para você OU um favor comprado — e a mesa não sabe qual.
--
-- ────────────────────────────────────────────────────────────────────────────
-- UMA FONTE, DERIVADA UMA VEZ
--
-- As duas gravam no estado privado a MESMA estrutura: `pistas.avisos`, uma lista
-- do que a pessoa ficou sabendo. Nada grava "carta fora do envelope" direto.
--
-- Quem transforma aviso em conhecimento é `dossie_deduz`, no bloco do que está
-- na cara — junto com a própria mão e com o Registro da Estação, que são as
-- outras duas coisas que se sabe sem deduzir. Gravar o fato derivado junto com o
-- aviso daria duas fontes para a mesma verdade, e duas fontes divergem.
-- ════════════════════════════════════════════════════════════════════════════

/**
 * A carta que o Recado revela para um assento: uma que NÃO está no envelope e
 * que aquela pessoa ainda não riscou.
 *
 * Irmã de `dossie_fato_do_registro`, com a diferença que importa: aquela escolhe
 * o que serve para a MAIORIA da mesa, porque é anúncio público; esta escolhe o
 * que serve para UMA pessoa, porque é recado.
 *
 * Empate desempata pelo id, para a escolha ser determinística — teste que mede
 * política não pode depender de sorteio.
 */
create or replace function public.dossie_recado_para(p_match uuid, p_seat smallint)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  m       public.matches;
  tema    jsonb;
  quem    uuid;
  escolha text;
begin
  select * into m from public.matches where id = p_match;
  if not found then return null; end if;
  select data into tema from public.game_themes where id = m.public_state ->> 'theme';
  quem := public.dossie_dono(p_match, p_seat);
  if quem is null then return null; end if;

  select c.carta into escolha
    from (
      select value ->> 'id' carta from jsonb_array_elements(tema -> 'suspects')
      union all
      select value ->> 'id' from jsonb_array_elements(tema -> 'weapons')
      union all
      select value ->> 'id' from jsonb_array_elements(tema -> 'rooms')
    ) c
   where c.carta not in (
           m.solution ->> 'suspect', m.solution ->> 'weapon', m.solution ->> 'room'
         )
     /* Nada que ela já saiba: nem o que está na mão dela, nem o que ela já
        riscou, nem o que outro recado já contou. Um recado que repete uma coisa
        sabida é uma carta gasta à toa. */
     and not exists (
       select 1 from public.match_private_state mps,
                   lateral jsonb_array_elements_text(coalesce(mps.data -> 'hand', '[]'::jsonb)) h
        where mps.match_id = p_match and mps.user_id = quem and h = c.carta
     )
     and not exists (
       select 1 from public.match_private_state mps,
                   lateral jsonb_array_elements_text(
                     coalesce(mps.data -> 'dedu' -> 'fora', '[]'::jsonb)) f
        where mps.match_id = p_match and mps.user_id = quem and f = c.carta
     )
     and not exists (
       select 1 from public.match_private_state mps,
                   lateral jsonb_array_elements(
                     coalesce(mps.data -> 'pistas' -> 'avisos', '[]'::jsonb)) a
        where mps.match_id = p_match and mps.user_id = quem
          and a ->> 'k' = 'recado' and a ->> 'card' = c.carta
     )
   order by c.carta
   limit 1;

  return escolha;
end;
$$;

revoke all on function public.dossie_recado_para(uuid, smallint) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

/**
 * Grava um aviso no estado privado de um assento.
 *
 * Uma função só porque as duas cartas gravam a mesma coisa no mesmo lugar, e
 * porque a terceira (o Interrogatório) vai gravar também.
 */
create or replace function public.dossie_avisa(p_match uuid, p_seat smallint, p_aviso jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.match_private_state
     set data = public.jsonb_poe(coalesce(data, '{}'::jsonb), 'pistas', 'avisos',
           coalesce(data -> 'pistas' -> 'avisos', '[]'::jsonb) || jsonb_build_array(p_aviso))
   where match_id = p_match and user_id = public.dossie_dono(p_match, p_seat);
end;
$$;

revoke all on function public.dossie_avisa(uuid, smallint, jsonb) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

/**
 * O que um aviso ensina: as cartas que ele prova NÃO estarem no envelope.
 *
 * É aqui que "está entre estes dois?" vira conhecimento, e a assimetria fica
 * visível: o NÃO risca dois, o SIM risca todos os outros.
 */
create or replace function public.dossie_aviso_ensina(p_tema jsonb, p_aviso jsonb)
returns text[]
language sql
immutable
as $$
  select case p_aviso ->> 'k'
    when 'recado' then array[p_aviso ->> 'card']
    when 'impressao' then
      case when (p_aviso ->> 'sim')::boolean
        then (
          -- é um dos dois: todos os OUTROS suspeitos saem
          select coalesce(array_agg(value ->> 'id'), '{}')
            from jsonb_array_elements(p_tema -> 'suspects')
           where value ->> 'id' not in (p_aviso ->> 'a', p_aviso ->> 'b')
        )
        else array[p_aviso ->> 'a', p_aviso ->> 'b']
      end
    else '{}'::text[]
  end;
$$;

revoke all on function public.dossie_aviso_ensina(jsonb, jsonb) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.dossie_usar_pista_como(p_seat smallint, p_match uuid, p_carta text, p_arg jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m       public.matches;
  estado  jsonb;
  meu     smallint;
  quem    uuid;
  mao     jsonb;
  tem     boolean;
  destino text;
  prox    smallint;
  alvo    smallint;
  um      text;
  dois    text;
  resposta boolean;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;
  estado := m.public_state;

  select seat into meu from public.match_players
   where match_id = p_match and user_id = public.dossie_dono(p_match, p_seat);
  if meu is null then raise exception 'NOT_A_PLAYER'; end if;
  quem := public.dossie_dono(p_match, meu);

  select coalesce(data -> 'pistas' -> 'mao', '[]'::jsonb) into mao
    from public.match_private_state
   where match_id = p_match and user_id = quem;

  select exists (
    select 1 from jsonb_array_elements_text(mao) c where c = p_carta
  ) into tem;
  if not tem then raise exception 'PISTA_NAO_ESTA_NA_MAO'; end if;

  case p_carta

    /* CHAVE-MESTRA — mova-se para qualquer lugar, de graça.
       "De graça" é o ponto: ela não gasta ação, então é a única forma de estar
       em dois lugares numa rodada. Vale a vez inteira de quem a joga na hora
       certa. */
    when 'chave-mestra' then
      if (estado ->> 'turnSeat')::smallint <> meu then raise exception 'NOT_YOUR_TURN'; end if;
      if estado ->> 'phase' <> 'turn' then raise exception 'WRONG_PHASE'; end if;
      destino := p_arg ->> 'para';
      if destino is null then raise exception 'FALTA_O_DESTINO'; end if;
      if not exists (
        select 1 from public.game_themes gt,
                    lateral jsonb_array_elements(gt.data -> 'rooms') r
         where gt.id = estado ->> 'theme' and r ->> 'id' = destino
      ) then
        raise exception 'LUGAR_NAO_EXISTE';
      end if;
      /* A tempestade fecha para a chave-mestra também. Uma carta que passa por
         cima da regra do caso transformaria a reviravolta em sugestão. */
      if destino = any(public.dossie_fechados(estado)) then raise exception 'ROOM_CLOSED'; end if;
      estado := jsonb_set(estado, array['positions', meu::text], to_jsonb(destino));
      estado := public.dossie_log(estado, jsonb_build_object(
        'type', 'pista', 'seat', meu, 'carta', 'chave-mestra', 'room', destino
      ));

    /* TEMPO É CURTO — o próximo jogador tem uma ação em vez de duas.
       Guardada como ASSENTO e não como bandeira: entre jogá-la e a vez do
       próximo chegar, alguém pode virar fantasma, e a ordem muda. */
    when 'tempo-curto' then
      if (estado ->> 'turnSeat')::smallint <> meu then raise exception 'NOT_YOUR_TURN'; end if;
      prox := public.dossie_next_seat(estado, meu);
      if prox is null then raise exception 'NAO_HA_PROXIMO'; end if;
      estado := estado || jsonb_build_object('tempoCurto', prox);
      estado := public.dossie_log(estado, jsonb_build_object(
        'type', 'pista', 'seat', meu, 'carta', 'tempo-curto', 'alvo', prox
      ));

    /* ÁLIBI — a carta que se joga FORA DA SUA VEZ, e a única assim.
       Ela vale na refutação, que é justamente quando não é a sua vez. Por isso
       não há checagem de turno aqui: haver uma tornaria a carta inútil. */
    when 'alibi' then
      if estado ->> 'phase' <> 'refute' or estado -> 'pending' is null then
        raise exception 'NADA_PARA_REFUTAR';
      end if;
      if (estado -> 'pending' -> 'queue' ->> (estado -> 'pending' ->> 'at')::int)::smallint
         is distinct from meu then
        raise exception 'NOT_YOUR_REFUTE';
      end if;
      estado := public.jsonb_poe(estado, 'alibi', meu::text, 'true'::jsonb);
      estado := public.dossie_log(estado, jsonb_build_object(
        'type', 'pista', 'seat', meu, 'carta', 'alibi'
      ));

    /* IMPRESSÃO DIGITAL — "o suspeito do envelope está entre estes dois?"

       Os DOIS NOMES são públicos e a RESPOSTA é privada, e essa divisão é a
       carta inteira. Quem joga paga anunciando onde está procurando; a mesa
       lê a resposta no que essa pessoa faz nas rodadas seguintes, e não no
       registro. É informação comprada com exposição, que é o preço que o
       Dossiê cobra por tudo.

       Vale a pena nos dois resultados — o NÃO risca dois suspeitos, o SIM
       risca os outros quatro — e por isso a decisão é QUAIS dois nomear, e
       não se a carta vai dar certo. */
    when 'impressao' then
      if (estado ->> 'turnSeat')::smallint <> meu then raise exception 'NOT_YOUR_TURN'; end if;
      if estado ->> 'phase' <> 'turn' then raise exception 'WRONG_PHASE'; end if;
      um  := p_arg ->> 'a';
      dois := p_arg ->> 'b';
      if um is null or dois is null then raise exception 'FALTAM_OS_DOIS_NOMES'; end if;
      if um = dois then raise exception 'DOIS_NOMES_IGUAIS'; end if;
      if (select count(*) from public.game_themes gt,
                 lateral jsonb_array_elements(gt.data -> 'suspects') s
           where gt.id = estado ->> 'theme' and s ->> 'id' in (um, dois)) <> 2 then
        raise exception 'SUSPEITO_NAO_EXISTE';
      end if;
      /* O envelope é lido AQUI e não sai daqui: o que atravessa é um booleano.
         `security definer` existe para este parágrafo. */
      resposta := (m.solution ->> 'suspect') in (um, dois);
      perform public.dossie_avisa(p_match, meu, jsonb_build_object(
        'k', 'impressao', 'a', um, 'b', dois, 'sim', resposta
      ));
      estado := public.dossie_log(estado, jsonb_build_object(
        'type', 'pista', 'seat', meu, 'carta', 'impressao', 'a', um, 'b', dois
      ));

    /* RECADO ANÔNIMO — alguém vê uma carta que não está no envelope.

       O registro diz que um recado saiu e NÃO diz para quem. É essa a
       anonimidade: a mesa vê a carta ser jogada, como vê qualquer outra, e
       não sabe quem ganhou o quê.

       E dá para mandar para si mesmo, o que parece brecha e é o desenho. Sem
       isso a carta seria puro presente e ninguém a jogaria por vontade
       própria; com isso, ela é informação para você OU um favor comprado, e
       de fora não dá para saber qual. */
    when 'recado' then
      if (estado ->> 'turnSeat')::smallint <> meu then raise exception 'NOT_YOUR_TURN'; end if;
      if estado ->> 'phase' <> 'turn' then raise exception 'WRONG_PHASE'; end if;
      if p_arg -> 'alvo' is null then raise exception 'FALTA_O_ALVO'; end if;
      alvo := (p_arg ->> 'alvo')::smallint;
      if not exists (
        select 1 from public.match_players mp
         where mp.match_id = p_match and mp.seat = alvo
      ) then
        raise exception 'ALVO_NAO_ESTA_NA_MESA';
      end if;
      destino := public.dossie_recado_para(p_match, alvo);
      /* Sem novidade, a carta NÃO É GASTA. O erro custa a jogada e devolve a
         carta, o que é melhor que queimá-la à toa — e é raro o bastante para
         não virar tentativa e erro: descobrir que alguém já sabe tudo o que
         está fora do envelope já é, em si, a informação. */
      if destino is null then raise exception 'RECADO_SEM_NOVIDADE'; end if;
      perform public.dossie_avisa(p_match, alvo, jsonb_build_object(
        'k', 'recado', 'card', destino
      ));
      estado := public.dossie_log(estado, jsonb_build_object(
        'type', 'pista', 'seat', meu, 'carta', 'recado'
      ));

    else
      raise exception 'PISTA_DESCONHECIDA_%', p_carta;
  end case;

  /* A carta sai da mão — UMA, mesmo com quatro cópias no baralho.

     A primeira versão disto era um `row_number()` dentro de um `not exists`
     com uma subconsulta correlacionada, e ninguém consegue ler aquilo para
     conferir se está certo. `jsonb_tira_um` faz a mesma coisa com um nome. */
  update public.match_private_state
     set data = public.jsonb_poe(coalesce(data, '{}'::jsonb), 'pistas', 'mao',
           public.jsonb_tira_um(mao, p_carta))
   where match_id = p_match and user_id = quem;

  update public.matches set public_state = estado, version = version + 1 where id = p_match;
  return jsonb_build_object('ok', true);
end;
$function$;

revoke all on function public.dossie_usar_pista_como(smallint, uuid, text, jsonb)
  from public, anon, authenticated;

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
