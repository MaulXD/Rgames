-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0106 · Interrogatório
--
--   Escolha um jogador e um tipo. Ele mostra para você uma carta daquele tipo,
--   se tiver.
--
-- É a sexta e última Carta de Pista, e a única que precisa de uma FASE: as
-- outras cinco resolvem sozinhas no servidor, esta espera outra pessoa
-- responder. Por isso ela chega por último — o baralho já a distribuía desde
-- 0103, e uma carta que sai da mão e devolve `PISTA_DESCONHECIDA` é o jeito
-- mais caro que existe de descobrir que o jogo mentiu.
--
-- ────────────────────────────────────────────────────────────────────────────
-- É A REFUTAÇÃO AO CONTRÁRIO, E O QUE MUDA É O QUE ACONTECE DEPOIS
--
-- A refutação interrompe o turno de quem palpitou e o ENCERRA: quando a fila
-- acaba, `dossie_advance` passa a vez. O interrogatório interrompe o turno e o
-- DEVOLVE — quem perguntou volta com as ações que ainda tinha.
--
-- Sem isso a carta seria um "passar a vez com informação", e ninguém a jogaria
-- no começo do turno, que é justamente quando ela é útil: descobrir que o
-- assento 2 tem uma arma antes de escolher para onde andar.
--
-- Como `phase` sai de `turn` durante a espera, e mover, palpitar e jogar as
-- outras cartas exigem `turn`, quem perguntou fica travado até a resposta
-- chegar — sem nenhuma guarda nova. Uma fase só, e as regras antigas seguram.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O APAGÃO NÃO SE APLICA AQUI, e é a única exceção do jogo
--
-- O apagão esconde QUEM mostrou a carta. Num interrogatório, quem mostrou está
-- escrito no registro público desde a pergunta: foi a pessoa a quem se
-- perguntou. Esconder a origem seria esconder um dado que a mesa inteira acabou
-- de ver — não é discrição, é incoerência.
--
-- ────────────────────────────────────────────────────────────────────────────
-- "NÃO TENHO NENHUM" É A COISA MAIS FORTE QUE ALGUÉM DIZ NESTE JOGO
--
-- Um `pass` de refutação diz que a pessoa não tem TRÊS cartas nomeadas. Um
-- interrogatório sem resposta diz que ela não tem NENHUMA das seis de um tipo —
-- e num baralho de 18 cartas para 3 mãos, isso costuma fechar um terço do
-- caderno de uma vez.
--
-- Por isso a pergunta é pública. Quem interroga anuncia exatamente onde está
-- procurando, e a mesa inteira ganha a resposta junto — a carta compra
-- velocidade com exposição, que é o preço que o Dossiê cobra por tudo.
-- ════════════════════════════════════════════════════════════════════════════

/**
 * As cartas de um tipo, no tema da partida.
 *
 * `p_tipo` é a chave do próprio tema — 'suspects', 'weapons', 'rooms' — e não
 * um nome traduzido. Um nome só para uma coisa só: no dia em que um tema ganhar
 * um quarto tipo, esta função não precisa saber disso.
 */
create or replace function public.dossie_cartas_do_tipo(p_tema jsonb, p_tipo text)
returns text[]
language sql
immutable
as $$
  select case when p_tipo in ('suspects', 'weapons', 'rooms')
    then (select coalesce(array_agg(value ->> 'id' order by value ->> 'id'), '{}')
            from jsonb_array_elements(p_tema -> p_tipo))
    else '{}'::text[]
  end;
$$;

revoke all on function public.dossie_cartas_do_tipo(jsonb, text) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

/**
 * Mostra uma carta a quem interrogou, e devolve o turno para ele.
 *
 * Devolver o turno é o parágrafo que importa: `phase` volta a 'turn' e
 * `turnSeat` NÃO muda. Quem perguntou continua com as ações que tinha, porque a
 * pergunta foi feita no meio da jogada dele e não no lugar dela.
 */
create or replace function public.dossie_responde_interroga_como(
  p_seat smallint, p_match uuid, p_card text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m       public.matches;
  estado  jsonb;
  pend    jsonb;
  meu     smallint;
  pedinte uuid;
  tema    jsonb;
  tenho   boolean;
  do_tipo boolean;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;
  estado := m.public_state;
  pend := estado -> 'pending';
  if estado ->> 'phase' <> 'interroga' or pend is null or pend = 'null'::jsonb then
    raise exception 'NADA_PARA_RESPONDER';
  end if;

  select seat into meu from public.match_players
   where match_id = p_match and user_id = public.dossie_dono(p_match, p_seat);
  if meu is null then raise exception 'NOT_A_PLAYER'; end if;
  if (pend ->> 'alvo')::smallint is distinct from meu then
    raise exception 'NAO_PERGUNTARAM_A_VOCE';
  end if;

  select exists (
    select 1 from public.match_private_state mps,
                jsonb_array_elements_text(mps.data -> 'hand') c
     where mps.match_id = p_match
       and mps.user_id = public.dossie_dono(p_match, meu) and c = p_card
  ) into tenho;
  if not tenho then raise exception 'NOT_IN_HAND'; end if;

  select gt.data into tema from public.game_themes gt where gt.id = estado ->> 'theme';
  do_tipo := p_card = any(public.dossie_cartas_do_tipo(tema, pend ->> 'tipo'));
  if not do_tipo then raise exception 'CARTA_DE_OUTRO_TIPO'; end if;

  select user_id into pedinte from public.match_players
   where match_id = p_match and seat = (pend ->> 'bySeat')::smallint;

  /* Sem a exceção do apagão: quem mostrou está no registro desde a pergunta.
     Ver o cabeçalho. */
  update public.match_private_state
     set data = jsonb_set(data, '{seen}', (data -> 'seen') || jsonb_build_object(
           'card', p_card, 'from', to_jsonb(meu),
           'seq', coalesce((estado ->> 'seq')::int, 0) + 1
         ))
   where match_id = p_match and user_id = pedinte;

  estado := public.dossie_log(estado, jsonb_build_object(
    'type', 'interroga_ok', 'seat', meu, 'tipo', pend ->> 'tipo'));

  /* O TURNO VOLTA PARA QUEM PERGUNTOU, com as ações que ele ainda tinha. */
  estado := estado || jsonb_build_object('phase', 'turn', 'pending', null);

  update public.matches
     set public_state = estado, version = version + 1,
         turn_deadline = now() + interval '90 seconds'
   where id = p_match;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.dossie_responde_interroga_como(smallint, uuid, text)
  from public, anon, authenticated;

create or replace function public.dossie_responde_interroga(p_match uuid, p_card text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare meu smallint;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select seat into meu from public.match_players
   where match_id = p_match and user_id = auth.uid();
  if meu is null then raise exception 'NOT_A_PLAYER'; end if;
  return public.dossie_responde_interroga_como(meu, p_match, p_card);
end;
$$;

revoke all on function public.dossie_responde_interroga(uuid, text) from public, anon;
grant execute on function public.dossie_responde_interroga(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

/**
 * "Não tenho nenhum" — e o servidor confere se é verdade.
 *
 * A mesma forma do `pass_refute`: mentir não é uma opção que a interface esconde,
 * é uma chamada que o servidor recusa. Só que aqui a declaração vale por seis
 * cartas em vez de três, e por isso ela vai para o registro público.
 */
create or replace function public.dossie_passa_interroga_como(p_seat smallint, p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m      public.matches;
  estado jsonb;
  pend   jsonb;
  meu    smallint;
  tema   jsonb;
  tenho  boolean;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;
  estado := m.public_state;
  pend := estado -> 'pending';
  if estado ->> 'phase' <> 'interroga' or pend is null or pend = 'null'::jsonb then
    raise exception 'NADA_PARA_RESPONDER';
  end if;

  select seat into meu from public.match_players
   where match_id = p_match and user_id = public.dossie_dono(p_match, p_seat);
  if meu is null then raise exception 'NOT_A_PLAYER'; end if;
  if (pend ->> 'alvo')::smallint is distinct from meu then
    raise exception 'NAO_PERGUNTARAM_A_VOCE';
  end if;

  select gt.data into tema from public.game_themes gt where gt.id = estado ->> 'theme';
  select exists (
    select 1 from public.match_private_state mps,
                jsonb_array_elements_text(mps.data -> 'hand') c
     where mps.match_id = p_match
       and mps.user_id = public.dossie_dono(p_match, meu)
       and c = any(public.dossie_cartas_do_tipo(tema, pend ->> 'tipo'))
  ) into tenho;
  if tenho then raise exception 'YOU_MUST_SHOW'; end if;

  estado := public.dossie_log(estado, jsonb_build_object(
    'type', 'interroga_nada', 'seat', meu, 'tipo', pend ->> 'tipo'));
  estado := estado || jsonb_build_object('phase', 'turn', 'pending', null);

  update public.matches
     set public_state = estado, version = version + 1,
         turn_deadline = now() + interval '90 seconds'
   where id = p_match;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.dossie_passa_interroga_como(smallint, uuid)
  from public, anon, authenticated;

create or replace function public.dossie_passa_interroga(p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare meu smallint;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select seat into meu from public.match_players
   where match_id = p_match and user_id = auth.uid();
  if meu is null then raise exception 'NOT_A_PLAYER'; end if;
  return public.dossie_passa_interroga_como(meu, p_match);
end;
$$;

revoke all on function public.dossie_passa_interroga(uuid) from public, anon;
grant execute on function public.dossie_passa_interroga(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

/**
 * A resposta forçada, quando o relógio vence.
 *
 * Mesma forma de `dossie_force_refute`: a faxina decide fora do lock e age
 * dentro dele, então entre uma coisa e outra a pessoa real pode ter respondido.
 * A guarda é reler `pending` depois do `for update`.
 *
 * Escolhe a primeira carta do tipo em ordem alfabética, e não a "melhor": a
 * faxina não joga, ela destrava. Quem quer escolher bem responde a tempo.
 */
create or replace function public.dossie_force_interroga(p_match uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m      public.matches;
  estado jsonb;
  pend   jsonb;
  tema   jsonb;
  alvo   smallint;
  carta  text;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'running' then return; end if;
  estado := m.public_state;
  pend := estado -> 'pending';
  if estado ->> 'phase' <> 'interroga' or pend is null or pend = 'null'::jsonb then return; end if;

  alvo := (pend ->> 'alvo')::smallint;
  if alvo is null then
    -- pendência sem alvo não tem a quem consultar: some, e o turno segue
    update public.matches
       set public_state = estado || jsonb_build_object('phase', 'turn', 'pending', null),
           version = version + 1
     where id = p_match;
    return;
  end if;

  select gt.data into tema from public.game_themes gt where gt.id = estado ->> 'theme';
  select c into carta
    from public.match_private_state mps,
         jsonb_array_elements_text(mps.data -> 'hand') c
   where mps.match_id = p_match
     and mps.user_id = public.dossie_dono(p_match, alvo)
     and c = any(public.dossie_cartas_do_tipo(tema, pend ->> 'tipo'))
   order by c
   limit 1;

  if carta is null then
    perform public.dossie_passa_interroga_como(alvo, p_match);
  else
    perform public.dossie_responde_interroga_como(alvo, p_match, carta);
  end if;
end;
$$;

revoke all on function public.dossie_force_interroga(uuid) from public, anon, authenticated;

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
  prazo   interval;
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

    /* INTERROGATÓRIO — a única carta que precisa de outra pessoa.

       As outras cinco resolvem dentro desta função. Esta abre uma FASE e
       espera, do mesmo jeito que a refutação — e a diferença que importa está
       no fim dela: a refutação encerra o turno de quem palpitou, o
       interrogatório o DEVOLVE. Quem perguntou volta com as ações que tinha.

       Sem isso a carta seria "passar a vez com informação", e ninguém a jogaria
       no começo do turno, que é justamente quando ela serve: descobrir que o
       assento 2 tem uma arma ANTES de escolher para onde andar.

       Enquanto a fase dura, `phase` não é 'turn' — e mover, palpitar e jogar
       as outras cartas exigem 'turn'. Quem perguntou fica travado até a
       resposta chegar, sem nenhuma guarda nova. */
    when 'interrogatorio' then
      if (estado ->> 'turnSeat')::smallint <> meu then raise exception 'NOT_YOUR_TURN'; end if;
      if estado ->> 'phase' <> 'turn' then raise exception 'WRONG_PHASE'; end if;
      if p_arg -> 'alvo' is null then raise exception 'FALTA_O_ALVO'; end if;
      alvo := (p_arg ->> 'alvo')::smallint;
      /* Interrogar a si mesmo devolveria uma carta da própria mão: a carta
         gasta para não descobrir nada. */
      if alvo = meu then raise exception 'NAO_SE_INTERROGA_SOZINHO'; end if;
      if not exists (
        select 1 from public.match_players mp
         where mp.match_id = p_match and mp.seat = alvo
      ) then
        raise exception 'ALVO_NAO_ESTA_NA_MESA';
      end if;
      /* O tipo é a chave do próprio tema, e não um nome traduzido: um nome só
         para uma coisa só. */
      if coalesce(p_arg ->> 'tipo', '') not in ('suspects', 'weapons', 'rooms') then
        raise exception 'TIPO_DESCONHECIDO';
      end if;
      estado := estado || jsonb_build_object(
        'phase', 'interroga',
        'pending', jsonb_build_object(
          'kind', 'interroga', 'bySeat', meu, 'alvo', alvo, 'tipo', p_arg ->> 'tipo'));
      /* A PERGUNTA É PÚBLICA, e é o preço da carta: quem interroga anuncia
         exatamente onde está procurando, e a mesa inteira ganha a resposta
         junto. */
      estado := public.dossie_log(estado, jsonb_build_object(
        'type', 'pista', 'seat', meu, 'carta', 'interrogatorio',
        'alvo', alvo, 'tipo', p_arg ->> 'tipo'));
      /* O relógio passa a ser de quem responde, e é curto: enquanto ele não
         responde, a mesa inteira espera. Mesmos trinta segundos da refutação. */
      prazo := interval '30 seconds';

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

  update public.matches
     set public_state = estado,
         version = version + 1,
         turn_deadline = case when prazo is null then turn_deadline else now() + prazo end
   where id = p_match;
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

-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.dossie_sweep()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m      record;
  pend   jsonb;
  atual  smallint;
  quem   uuid;
  carta  text;
  tocou  int;
  n      int := 0;
begin
  for m in
    select id, public_state from public.matches
     where game_key = 'dossie' and status = 'running' and turn_deadline < now()
     for update skip locked
  loop
    /* Uma transação de exceção POR PARTIDA. Sem isso, uma linha com estado
       inesperado derruba a varredura inteira e nenhuma outra partida é
       atendida — foi o que aconteceu por causa da comparação de nulo abaixo. */
    begin
    /* A MÁQUINA JOGA, NÃO É PULADA — ver o comentário em `met_sweep`. */
    /* MESA ABANDONADA NÃO SE JOGA SOZINHA.

       A máquina existe para o jogo andar PARA ALGUÉM. Numa mesa em que ninguém
       apareceu nos últimos quinze minutos não há a quem servir — e o que a
       faxina faz ali é jogar turno atrás de turno para uma plateia vazia, a cada
       passada do cron, até a sala expirar em vinte e quatro horas.

       Medido: 27 partidas rodando sem gente há mais de meia hora, e a faxina do
       Dossiê passa a cada DEZ SEGUNDOS. Isso é trabalho que cresce com o uso do
       site e não serve a ninguém.

       Pular preserva a mesa exatamente como ela estava: quem voltar encontra o
       próprio jogo, e o `touch_presence` do cliente religa a faxina na hora. */
    if (public.mesa_abandonada(m.id)) then
      continue;
    end if;

    tocou := 0;
    begin
      tocou := public.dossie_toca_pendentes(m.id, 30);
    exception when others then
      -- se o cérebro falhar, a mesa NÃO para
      raise warning 'dossie_sweep: maquina travada em % (%)', m.id, sqlerrm;
      tocou := 0;
    end;
    if tocou > 0 then
      n := n + 1;
      continue;
    end if;

      /* SEM RELÓGIO QUANDO NÃO HÁ MAIS NINGUÉM — ver o comentário em
         `dominio_sweep`. No Dossiê a guarda é depois da fase de refutação: se
         alguém precisa refutar, a fila TEM de andar, mesmo numa mesa solo. */
      if (m.public_state ->> 'phase') = 'turn'
         and public.mesa_so_com_maquinas(
               m.id, (m.public_state ->> 'turnSeat')::smallint) then
        update public.matches set turn_deadline = null where id = m.id;
        continue;
      end if;

      pend := m.public_state -> 'pending';

      -- `pending` é JSON null, não SQL NULL: depois de uma refutação o campo
      -- existe e vale `null`. Comparar só com `is null` mandava toda partida
      -- fora de refutação para o ramo errado.
      if pend is null or pend = 'null'::jsonb then
        perform public.dossie_advance(m.id);
      elsif pend ->> 'kind' = 'interroga' then
        /* A pendência do interrogatório não tem FILA: pergunta-se a uma pessoa
           só. Sem este ramo, o cálculo de `atual` logo abaixo daria nulo, a
           faxina chamaria `dossie_advance` e o turno passaria por cima da
           pergunta — perdendo a carta de quem a jogou. */
        perform public.dossie_force_interroga(m.id);
      else
        atual := (pend -> 'queue' ->> coalesce((pend ->> 'at')::int, 0))::smallint;

        if atual is null then
          -- fila vazia ou índice fora dela: a pendência não tem a quem
          -- consultar, então ela não deveria existir. Segue o turno.
          perform public.dossie_advance(m.id);
        else
          select user_id into quem from public.match_players
           where match_id = m.id and seat = atual;

          -- a jogada conservadora: mostra a primeira carta que tem
          select c into carta
            from public.match_private_state mps,
                 jsonb_array_elements_text(mps.data -> 'hand') c,
                 jsonb_array_elements_text(pend -> 'guess') g
           where mps.match_id = m.id and mps.user_id = quem and c = g
           limit 1;

          if carta is null then
            perform public.dossie_force_pass(m.id, atual);
          else
            perform public.dossie_force_refute(m.id, atual, carta);
          end if;
        end if;
      end if;
      n := n + 1;
    exception when others then
      raise warning 'dossie_sweep: partida % pulada (%)', m.id, sqlerrm;
    end;
  end loop;
  return n;
end;
$function$;

revoke all on function public.dossie_sweep() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

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
  fechados text[];
begin
  select m.public_state, m.seed into est, semente
    from public.matches m
   where m.id = p_match and m.game_key = 'dossie' and m.status = 'running'
   for update;
  if not found then return null; end if;

  select gt.data into tema from public.game_themes gt where gt.id = (est ->> 'theme');

  /* ── 0. RESPONDER AO INTERROGATÓRIO ────────────────────────────────────
     Antes até da refutação: aqui não há fila, é uma pessoa só, e enquanto ela
     não responde a mesa inteira para com trinta segundos no relógio.

     A faxina também destrava isto, mas noventa segundos depois. Numa partida
     solo, esperar a faxina para cada pergunta transformaria a carta em castigo
     de quem a jogou. */
  if est ->> 'phase' = 'interroga' and est -> 'pending' <> 'null'::jsonb
     and est -> 'pending' is not null then
    pend := est -> 'pending';
    naVez := (pend ->> 'alvo')::smallint;

    if naVez is not null then
      quem := public.dossie_dono(p_match, naVez);
      if exists (select 1 from public.profiles p where p.id = quem and p.is_bot) then
        select mps.data into priv from public.match_private_state mps
         where mps.match_id = p_match and mps.user_id = quem;

        select array_agg(c order by c) into tenho
          from jsonb_array_elements_text(coalesce(priv -> 'hand', '[]'::jsonb)) c
         where c = any(public.dossie_cartas_do_tipo(tema, pend ->> 'tipo'));

        if tenho is null or array_length(tenho, 1) = 0 then
          perform public.dossie_passa_interroga_como(naVez, p_match);
          return format('interroga:nada(%s)', naVez);
        end if;

        /* MESMA REGRA DA REFUTAÇÃO: mostre de novo o que já mostrou àquela
           pessoa. Carta nova revelada é informação de graça, e a máquina que dá
           informação de graça é a máquina que perde. */
        select c into mostrar
          from unnest(tenho) c
         where exists (
           select 1 from jsonb_array_elements(coalesce(priv -> 'mostrei', '[]'::jsonb)) m
            where m ->> 'card' = c and (m ->> 'para')::smallint = (pend ->> 'bySeat')::smallint
         )
         limit 1;

        if mostrar is null then
          select c into mostrar from unnest(tenho) c
           order by ('x' || substr(md5(semente::text || naVez::text || c), 1, 6))::bit(24)::int
           limit 1;
        end if;

        perform public.dossie_responde_interroga_como(naVez, p_match, mostrar);

        update public.match_private_state
           set data = jsonb_set(coalesce(data, '{}'::jsonb), '{mostrei}',
                 coalesce(data -> 'mostrei', '[]'::jsonb) || jsonb_build_array(
                   jsonb_build_object(
                     'card', mostrar,
                     'para', (pend ->> 'bySeat')::int,
                     'tipo', pend ->> 'tipo',
                     'tinha', (select coalesce(jsonb_agg(c), '[]'::jsonb)
                                 from unnest(tenho) c))), true)
         where match_id = p_match and user_id = quem;

        return format('interroga:mostra(%s)', naVez);
      end if;
    end if;
    return null;   -- é vez de gente responder
  end if;

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
                   jsonb_build_object(
                     'card', mostrar,
                     'para', (pend ->> 'bySeat')::int,
                     -- o palpite vai junto: sem ele nao da para saber, depois,
                     -- se ela TINHA escolha na hora
                     'guess', pend -> 'guess',
                     'tinha', (select coalesce(jsonb_agg(c), '[]'::jsonb)
                                 from unnest(tenho) c))), true)
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
  fechados := public.dossie_fechados(est);

  /* 2b. PALPITAR, se a sala em que ela está ainda é candidata.
     Palpitar numa sala já riscada gasta o turno para confirmar o que ela já
     sabe — e é o erro que mais denuncia uma máquina sem cabeça. */
  if (est ->> 'actionsLeft')::int >= 1
     and aqui is not null
     and (nivel = 'facil' or aqui = any(sala) or coalesce(array_length(sala, 1), 0) <= 1
          /* PRESA PELA TEMPESTADE, ela palpita de qualquer jeito.

             Aqui a regra normal ("não gaste turno palpitando num lugar que
             você já riscou") se inverte, porque a alternativa mudou. Solta, a
             escolha é entre palpitar num lugar riscado e ANDAR até um que
             importa — e andar ganha. Presa, a escolha é entre palpitar num
             lugar riscado e NÃO FAZER NADA.

             E palpitar nunca é nada: mesmo com o lugar já descartado, as
             respostas ensinam sobre o suspeito e o objeto. É exatamente a
             razão pela qual o PRD 03 §3 diz que lugar fechado é posição e não
             punição — a máquina precisa jogar isso, não só sofrer. */
          or aqui = any(fechados)) then
    perform public.dossie_suggest_como(
      assento, p_match,
      susp[1 + (('x' || substr(md5(semente::text || coalesce(est ->> 'seq', '0') || 's'), 1, 6))::bit(24)::int
                % greatest(coalesce(array_length(susp, 1), 1), 1))],
      arma[1 + (('x' || substr(md5(semente::text || coalesce(est ->> 'seq', '0') || 'a'), 1, 6))::bit(24)::int
                % greatest(coalesce(array_length(arma, 1), 1), 1))]
    );
    return format('palpita(%s) em %s', assento, aqui);
  end if;

  /* 2c. ANDAR na direção da sala candidata mais próxima.

     Presa pela tempestade, ela não anda: cai direto no "passa". Tentar andar
     levantaria ROOM_CLOSED de dentro de `dossie_move_como`, e a exceção subiria
     pela faxina inteira — foi assim que o Dossiê parou de tirar o turno de
     ninguém no relógio uma vez (0033). A máquina que não pode andar passa a vez
     de propósito, não por acidente.

     E o alvo exclui o que está fechado: andar rumo a um lugar onde não se pode
     entrar é gastar o turno para bater na porta. */
  if (est ->> 'actionsLeft')::int >= 1 and aqui is not null
     and not (aqui = any(fechados)) then
    select s into alvo
      from unnest(sala) s
     where s <> aqui and not (s = any(fechados))
     order by ('x' || substr(md5(semente::text || assento::text || s), 1, 6))::bit(24)::int
     limit 1;

    if alvo is not null then
      passo := public.dossie_passo_para(tema, aqui, alvo, fechados);
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
$function$;

revoke all on function public.dossie_bot_passo(uuid) from public, anon, authenticated;
