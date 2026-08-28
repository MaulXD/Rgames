-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0063 · se o cérebro falhar, a mesa não para
--
-- As três faxinas tentavam jogar o turno da máquina dentro de um bloco de
-- exceção, e o handler terminava assim:
--
--     exception when others then
--       raise warning '...';
--       continue;      -- <── aqui
--
-- O `continue` é o problema. Ele pula para a próxima partida SEM passar a vez —
-- então a máquina não jogou, a vez não andou, e na varredura seguinte tudo se
-- repete. A mesa trava para sempre num erro que ninguém vê, porque `raise
-- warning` não chega a lugar nenhum em produção.
--
-- É a mesma família do defeito do `dossie_sweep` em 0033: um caminho de erro que
-- não dá erro e só deixa o jogo pior.
--
-- Agora o erro cai no caminho de SEMPRE, que já existe logo abaixo: a vez passa
-- como passa a de quem fechou a aba. Perder o turno é ruim; travar a partida de
-- todo mundo é pior — e um turno perdido aparece no registro ("perdeu o turno no
-- relógio"), então é um sintoma que dá para ver.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.dominio_sweep()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  linha    record;
  est      jsonb;
  mapa     jsonb;
  resta    int;
  maior    text;
  ativos   smallint[];
  onde     int;
  proximo  smallint;
  rodada   int;
  atual    smallint;
  dono     uuid;
  tocou    int;
  quantos  int := 0;
begin
  for linha in
    select m.id, m.public_state, m.room_id, m.seed
      from public.matches m
     where m.game_key = 'dominio' and m.status = 'running'
       and m.turn_deadline is not null and m.turn_deadline < now()
     for update skip locked
  loop
    est := linha.public_state;
    atual := (est ->> 'turnSeat')::smallint;

    /* MÁQUINA NO RELÓGIO JOGA, não é pulada. Um bloco de exceção por partida:
       máquina travada numa mesa não pode parar a faxina de todas as outras —
       foi essa a lição do `dossie_sweep` em 0033. */
    select mp.user_id into dono
      from public.match_players mp
     where mp.match_id = linha.id and mp.seat = atual;

    if exists (select 1 from public.profiles p where p.id = dono and p.is_bot) then
      /* TODAS as máquinas seguidas, não uma: esperar uma passada do cron por
         máquina seria esperar minutos numa mesa que ninguém está vendo. */
      tocou := 0;
      begin
        tocou := public.dominio_toca_pendentes(linha.id, 8);
      exception when others then
        /* SE O CÉREBRO FALHAR, A MESA NÃO PARA. Antes daqui havia um `continue`
           depois do `raise warning`, e o efeito era o pior possível: a máquina
           não jogava, a vez não passava, e na próxima varredura tudo se repetia
           — a mesa travava para sempre num erro que ninguém via, porque
           `raise warning` não aparece em lugar nenhum em produção.

           Agora o erro cai no caminho de sempre, logo abaixo: a vez passa como
           passa a de quem fechou a aba. Perder o turno é ruim; travar a partida
           de todo mundo é pior. */
        raise warning 'dominio_sweep: maquina travada em % (%)', linha.id, sqlerrm;
        tocou := 0;
      end;
      if tocou > 0 then
        quantos := quantos + tocou;
        continue;
      end if;
    end if;

    select data into mapa from public.game_themes gt where gt.id = (est ->> 'map');

    -- exército que ficou na mão vai para o maior território
    resta := coalesce((est ->> 'reforcoLeft')::int, 0);
    if resta > 0 then
      select d.key into maior
        from jsonb_each_text(est -> 'donos') d
       where d.value::smallint = atual
       order by (est -> 'exercitos' ->> d.key)::int desc, d.key
       limit 1;
      if maior is not null then
        est := jsonb_set(est, array['exercitos', maior],
          to_jsonb((est -> 'exercitos' ->> maior)::int + resta));
        est := public.dominio_log(est, jsonb_build_object(
          'k', 'reforco-automatico', 'seat', atual, 'ter', maior, 'n', resta));
      end if;
      est := jsonb_set(est, '{reforcoLeft}', to_jsonb(0));
    end if;

    select array_agg((j ->> 'seat')::smallint order by (j ->> 'seat')::smallint)
      into ativos
      from jsonb_array_elements(est -> 'players') j
     where coalesce((j ->> 'ativo')::boolean, true);

    if coalesce(array_length(ativos, 1), 0) <= 1 then
      continue;
    end if;

    select i into onde from generate_subscripts(ativos, 1) i where ativos[i] = atual;
    proximo := ativos[(coalesce(onde, 0) % array_length(ativos, 1)) + 1];

    if proximo = ativos[1] then
      rodada := coalesce((est ->> 'round')::int, 1) + 1;
      est := jsonb_set(est, '{round}', to_jsonb(rodada));
      if (est ->> 'mode') = 'campanha' then
        est := public.dominio_pontua(mapa, est);
        est := public.dominio_restaura(mapa, est, linha.seed, rodada);
      end if;
    end if;

    est := jsonb_set(est, '{turnSeat}', to_jsonb(proximo));
    est := jsonb_set(est, '{phase}', '"reforco"');
    est := jsonb_set(est, '{conquistou}', 'false'::jsonb);
    est := jsonb_set(est, '{remanejou}', 'false'::jsonb);
    est := jsonb_set(est, '{avanco}', 'null'::jsonb);
    est := jsonb_set(est, '{reforcoLeft}',
      to_jsonb(public.dominio_reforco(mapa, est, proximo)));
    est := public.dominio_log(est, jsonb_build_object(
      'k', 'tempo-esgotado', 'seat', atual));
    est := public.dominio_log(est, jsonb_build_object('k', 'vez', 'seat', proximo));

    update public.matches
       set public_state = est, version = version + 1,
           turn_deadline = now() + interval '120 seconds'
     where id = linha.id;

    quantos := quantos + 1;
  end loop;

  return quantos;
end;
$function$;

revoke all on function public.dominio_sweep() from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.met_sweep()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  linha   record;
  est     jsonb;
  mapa    jsonb;
  atual   smallint;
  pend    jsonb;
  c       jsonb;
  ativos  smallint[];
  onde    int;
  proximo smallint;
  rodada  int;
  final   int;
  tocou   int;
  quantos int := 0;
begin
  for linha in
    select m.id, m.public_state, m.room_id, m.seed
      from public.matches m
     where m.game_key = 'metropole' and m.status = 'running'
       and m.turn_deadline is not null and m.turn_deadline < now()
     for update skip locked
  loop
    /* A MÁQUINA JOGA, NÃO É PULADA.

       Sem este bloco a faxina passaria a vez de uma máquina como passa a de
       quem fechou a aba — e uma máquina pulada é um jogador morto segurando
       escritura, que é exatamente o que 0045 impediu de acontecer no lobby.

       Até quarenta passos de uma vez: numa mesa que ninguém está vendo, esperar
       uma passada do cron por passo seria esperar meia hora. E um bloco de
       exceção por partida, porque máquina travada numa mesa não pode parar a
       faxina de todas as outras — foi a lição do `dossie_sweep` em 0033. */
    tocou := 0;
    begin
      tocou := public.met_toca_pendentes(linha.id, 40);
    exception when others then
      -- se o cérebro falhar, a mesa NÃO para: o erro cai no caminho de sempre,
      -- logo abaixo, e a vez passa como passa a de quem fechou a aba
      raise warning 'met_sweep: maquina travada em % (%)', linha.id, sqlerrm;
      tocou := 0;
    end;
    if tocou > 0 then
      quantos := quantos + 1;
      continue;
    end if;

    est := public.met_normaliza(linha.public_state);
    select data into mapa from public.game_themes gt where gt.id = (est ->> 'map');
    atual := (est ->> 'turnSeat')::smallint;
    pend := est -> 'pendente';

    if est ->> 'phase' = 'leilao' then
      est := public.met_fecha_leilao(est);

    elsif pend is not null and pend <> 'null'::jsonb and pend ->> 'k' = 'comprar' then
      est := jsonb_set(est, '{pendente}', 'null'::jsonb);
      est := jsonb_set(est, '{leilao}', jsonb_build_object(
        'prop', pend ->> 'prop', 'alto', 0, 'altoSeat', null,
        'passou', jsonb_build_array(atual), 'abriuSeat', atual));
      est := jsonb_set(est, '{phase}', '"leilao"');
      est := public.met_log(est, jsonb_build_object(
        'k', 'leilao-abre', 'seat', atual, 'prop', pend ->> 'prop', 'auto', true));

    elsif pend is not null and pend <> 'null'::jsonb and pend ->> 'k' = 'divida' then
      -- hipoteca da mais barata para a mais cara, até o caixa virar
      for c in
        select value from jsonb_array_elements(mapa -> 'casas')
         order by (value ->> 'preco')::int nulls last
      loop
        exit when (est -> 'players' -> atual::text ->> 'cash')::int >= 0;
        if c ->> 'id' is null then continue; end if;
        if (est -> 'props' -> (c ->> 'id') ->> 'owner')::smallint <> atual then continue; end if;
        if coalesce((est -> 'props' -> (c ->> 'id') ->> 'hipotecada')::boolean, false) then continue; end if;
        if coalesce((est -> 'props' -> (c ->> 'id') ->> 'casas')::int, 0) > 0
           or coalesce((est -> 'props' -> (c ->> 'id') ->> 'hotel')::boolean, false) then continue; end if;

        est := jsonb_set(est, array['props', c ->> 'id', 'hipotecada'], 'true'::jsonb);
        est := jsonb_set(est, array['players', atual::text, 'cash'],
          to_jsonb((est -> 'players' -> atual::text ->> 'cash')::int + (c ->> 'hipoteca')::int));
        est := public.met_log(est, jsonb_build_object(
          'k', 'hipoteca', 'seat', atual, 'prop', c ->> 'id',
          'valor', (c ->> 'hipoteca')::int, 'auto', true));
      end loop;

      est := public.met_confere_divida(est, atual);

      if (est -> 'players' -> atual::text ->> 'cash')::int < 0 then
        -- nem hipotecando tudo cobre: devolve ao banco e vira investidor
        for c in select value from jsonb_array_elements(mapa -> 'casas') loop
          if c ->> 'id' is null then continue; end if;
          if (est -> 'props' -> (c ->> 'id') ->> 'owner')::smallint <> atual then continue; end if;
          est := jsonb_set(est, array['props', c ->> 'id'], jsonb_build_object(
            'owner', null, 'casas', 0, 'hotel', false, 'hipotecada', false));
        end loop;
        est := jsonb_set(est, array['players', atual::text, 'cash'], '0'::jsonb);
        est := jsonb_set(est, array['players', atual::text, 'quebrado'], 'true'::jsonb);
        est := jsonb_set(est, array['players', atual::text, 'investidor'],
          case when est ->> 'mode' = 'classico' then 'false'::jsonb else 'true'::jsonb end);
        est := jsonb_set(est, '{pendente}', 'null'::jsonb);
        est := public.met_log(est, jsonb_build_object(
          'k', 'quebrou-no-relogio', 'seat', atual));
      end if;
      est := jsonb_set(est, '{phase}', '"acao"');
    end if;

    -- fora do leilão, o relógio vencido passa a vez
    if est ->> 'phase' <> 'leilao' then
      select array_agg(k::smallint order by k::smallint) into ativos
        from jsonb_each(est -> 'players') e(k, v)
       where not coalesce((v ->> 'quebrado')::boolean, false);

      if coalesce(array_length(ativos, 1), 0) <= 1 then
        est := public.met_termina(linha.id, est, ativos[1]);
        quantos := quantos + 1;
        continue;
      end if;

      select i into onde from generate_subscripts(ativos, 1) i where ativos[i] = atual;
      proximo := ativos[(coalesce(onde, 0) % array_length(ativos, 1)) + 1];
      rodada := coalesce((est ->> 'round')::int, 1);
      if proximo = ativos[1] then rodada := rodada + 1; end if;
      final := (est ->> 'rodadaFinal')::int;

      if final is not null and rodada > final then
        /* Antes este bloco encerrava a partida SEM apurar vencedor e sem
           creditar XP: o relógio acabava a temporada e ninguém ganhava nada.
           Agora é a mesma função de fim que todos os outros caminhos usam. */
        est := public.met_termina(linha.id, est, null);
        quantos := quantos + 1;
        continue;
      end if;

      est := jsonb_set(est, '{round}', to_jsonb(rodada));
      est := jsonb_set(est, '{turnSeat}', to_jsonb(proximo));
      est := jsonb_set(est, '{duplos}', '0'::jsonb);
      est := jsonb_set(est, '{dados}', 'null'::jsonb);
      -- o relógio passa a vez, e o cartório cobra igual: contrato não para
      -- porque alguém fechou a aba
      est := public.met_cobra_contratos(est, proximo);
      est := public.met_evento(mapa, est, linha.seed, rodada);
      est := jsonb_set(est, '{phase}',
        case when (est -> 'players' -> proximo::text ->> 'cash')::int < 0
             then '"resolve"'::jsonb else '"rolar"'::jsonb end);
      est := public.met_log(est, jsonb_build_object('k', 'tempo-esgotado', 'seat', atual));
      est := public.met_log(est, jsonb_build_object('k', 'vez', 'seat', proximo));
    end if;

    update public.matches
       set public_state = est, version = version + 1,
           turn_deadline = now() + interval '90 seconds'
     where id = linha.id;
    quantos := quantos + 1;
  end loop;

  return quantos;
end;
$function$;

revoke all on function public.met_sweep() from public, anon, authenticated;

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

      pend := m.public_state -> 'pending';

      -- `pending` é JSON null, não SQL NULL: depois de uma refutação o campo
      -- existe e vale `null`. Comparar só com `is null` mandava toda partida
      -- fora de refutação para o ramo errado.
      if pend is null or pend = 'null'::jsonb then
        perform public.dossie_advance(m.id);
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
