-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0061 · a rede de segurança dos outros dois jogos
--
-- `dominio_sweep` aprendeu em 0048 a JOGAR o turno da máquina em vez de pulá-lo.
-- `met_sweep` e `dossie_sweep` não aprenderam, e eu criei
-- `met_toca_pendentes` e `dossie_toca_pendentes` sem ligar nenhuma das duas —
-- função escrita e não chamada é a forma mais discreta de bug.
--
-- O QUE ACONTECERIA. A pessoa fecha a aba numa mesa com duas máquinas. O relógio
-- estoura, a faxina passa a vez da máquina como passaria a de quem sumiu, e a
-- máquina vira um jogador morto segurando escritura ou carta — exatamente o que
-- 0045 impediu de acontecer no lobby. Quando a pessoa voltasse, o jogo estaria
-- pior e sem explicação.
--
-- E não é caso raro: no celular, sair do aplicativo JÁ é fechar a aba. O modo
-- solo é justamente onde isso mais acontece.
--
-- Geradas de `pg_get_functiondef` com uma inserção no topo do laço.
-- ════════════════════════════════════════════════════════════════════════════

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
    begin
      if public.met_toca_pendentes(linha.id, 40) > 0 then
        quantos := quantos + 1;
        continue;
      end if;
    exception when others then
      raise warning 'met_sweep: maquina travada em % (%)', linha.id, sqlerrm;
      continue;
    end;

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
    begin
      if public.dossie_toca_pendentes(m.id, 30) > 0 then
        n := n + 1;
        continue;
      end if;
    exception when others then
      raise warning 'dossie_sweep: maquina travada em % (%)', m.id, sqlerrm;
      continue;
    end;

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
