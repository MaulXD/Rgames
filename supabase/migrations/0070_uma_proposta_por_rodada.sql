-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0070 · uma proposta por rodada, ou a mesa entra em laço
--
-- 0064 deu à máquina da Metrópole a capacidade de PROPOR troca, e a guarda
-- contra insistência era: não propor pela mesma escritura se já houver proposta
-- ABERTA por ela.
--
-- Numa mesa com duas máquinas isso não segura nada, e o teste mediu o resultado:
--
--     propoe: 535     troca:recusa: 534
--
-- A máquina A propõe. A B recusa — e recusar TIRA a oferta da lista. A vaga
-- volta a existir, a guarda deixa de valer, e A propõe de novo. Na mesma vez.
-- Para sempre.
--
-- O que torna esse defeito bom de estudar: NENHUMA DAS DUAS ESTÁ ERRADA. A
-- proposta é boa (ela pede o que fecha o grupo dela). A recusa é boa (a carta é
-- justamente a que interessa a quem tem). O laço nasce das duas coisas certas
-- se encontrando — e é por isso que ele não apareceu em nenhum teste de unidade
-- e só a partida inteira pegou.
--
-- Uma proposta por rodada por máquina resolve, e ainda é o ritmo certo de mesa:
-- quem propõe duas vezes seguidas a mesma coisa não está negociando, está
-- insistindo.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.met_bot_passo(p_match uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  est     jsonb;
  mapa    jsonb;
  semente bigint;
  rodada  int;
  fase    text;
  assento smallint;
  nivel   text;
  jog     jsonb;
  caixa   int;

  -- leilão
  lei     jsonb;
  minimo  int;
  teto    int;
  lance   int;
  admin   smallint;

  -- compra
  prop    text;
  preco   int;
  valor   int;

  -- proposta
  dono    smallint;
  oferta  int;

  -- dívida / construção
  alvo    text;
  falta   int;
  linha   record;
begin
  select m.public_state, m.seed into est, semente
    from public.matches m
   where m.id = p_match and m.game_key = 'metropole' and m.status = 'running'
   for update;
  if not found then return null; end if;

  select data into mapa from public.game_themes gt where gt.id = (est ->> 'map');
  fase := est ->> 'phase';
  rodada := coalesce((est ->> 'round')::int, 1);

  /* ── 1. LEILÃO ─────────────────────────────────────────────────────────
     Primeiro de todos porque o relógio do leilão é de vinte segundos e ele
     tranca a mesa inteira: enquanto ele não fecha, ninguém joga. */
  if fase = 'leilao' and est -> 'leilao' is not null and est -> 'leilao' <> 'null'::jsonb then
    lei := est -> 'leilao';

    select mp.seat into assento
      from public.match_players mp
      join public.profiles p on p.id = mp.user_id and p.is_bot
     where mp.match_id = p_match
       and coalesce((lei ->> 'altoSeat')::smallint, -1) <> mp.seat
       and not coalesce(lei -> 'passou' @> to_jsonb(mp.seat), false)
       and (
         not coalesce((est -> 'players' -> mp.seat::text ->> 'quebrado')::boolean, false)
         or coalesce((est -> 'players' -> mp.seat::text ->> 'investidor')::boolean, false)
       )
     order by mp.seat
     limit 1;

    if assento is not null then
      nivel := public.met_bot_nivel(p_match, assento);
      caixa := coalesce((est -> 'players' -> assento::text ->> 'cash')::int, 0);
      minimo := greatest(
        coalesce((lei ->> 'alto')::int, 0) + 1,
        coalesce((mapa -> 'regras' ->> 'lanceMinimo')::int, 100));
      valor := public.met_bot_valor(mapa, est, assento, lei ->> 'prop', nivel);

      /* O TETO é o valor menos a reserva: ela não dá lance que a deixe sem
         dinheiro para o próximo aluguel. A tranquila não tem reserva, e é por
         isso que ela quebra sozinha. */
      teto := least(valor, caixa - public.met_bot_reserva(nivel, rodada));

      if minimo <= teto then
        /* O LANCE FECHA UMA FRAÇÃO DO QUE FALTA, e não sobe de degrau fixo.

           Antes era `minimo` (medio) ou `minimo + 200` (dificil), e o efeito
           numa mesa com duas máquinas era um leilão de vinte e quatro lances
           subindo de duzentos em duzentos até o teto. Contado em passos, isso é
           mais de vinte segundos de máquina lançando contra máquina — e o
           tempo todo a pessoa só assiste. Leilão que não se assiste é leilão
           que se pula.

           Fechando um terço (ou metade) da distância a cada lance, o mesmo
           leilão termina em cinco ou seis: cada lance diz alguma coisa, e o
           último ainda é uma decisão.

           E a fração TAMBÉM É O NÍVEL: a tranquila cobre o mínimo e espera
           (timidez), a firme fecha um terço, a impiedosa fecha metade e assusta
           quem estava pensando em subir. */
        lance := least(
          teto,
          minimo + case nivel
            when 'facil'   then 0
            when 'medio'   then greatest(100, (teto - minimo) / 3)
            else                greatest(200, (teto - minimo) / 2)
          end);
        admin := null;
        if coalesce((est -> 'players' -> assento::text ->> 'quebrado')::boolean, false) then
          -- Investidor precisa dizer quem administra: o ativo com mais caixa
          select mp.seat into admin
            from public.match_players mp
           where mp.match_id = p_match
             and not coalesce((est -> 'players' -> mp.seat::text ->> 'quebrado')::boolean, false)
           order by (est -> 'players' -> mp.seat::text ->> 'cash')::int desc, mp.seat
           limit 1;
          if admin is null then
            perform public.met_pass_como(assento, p_match);
            return format('leilao:passa(%s) sem administrador', assento);
          end if;
        end if;
        perform public.met_bid_como(assento, p_match, lance, admin);
        return format('leilao:lance(%s) %s por %s', assento, lei ->> 'prop', lance);
      end if;

      perform public.met_pass_como(assento, p_match);
      return format('leilao:passa(%s) %s vale %s e o minimo e %s',
                    assento, lei ->> 'prop', valor, minimo);
    end if;
  end if;

  /* ── 2. PROPOSTA DE TROCA ──────────────────────────────────────────────
     Proposta sem resposta é pior que proposta recusada: quem propôs fica
     esperando e não sabe se pode contar com aquilo. Máquina responde sempre.

     A CONTA É SIMPLES E HONESTA: vale a pena se o que ela recebe vale mais que
     o que ela dá, pela mesma função de valor que ela usa para comprar. A
     tranquila recusa tudo — não por burrice, mas porque não negociar é
     exatamente o comportamento de quem não entendeu o jogo ainda. */
  for linha in
    select (o ->> 'id') id, (o ->> 'para')::smallint para, o -> 'da' da, o -> 'quer' quer
      from jsonb_array_elements(coalesce(est -> 'ofertas', '[]'::jsonb)) o
     where coalesce(o ->> 'estado', 'aberta') = 'aberta'
     order by o ->> 'id'
  loop
    nivel := public.met_bot_nivel(p_match, linha.para);
    continue when nivel is null;

    if nivel = 'facil' then
      perform public.met_offer_reply_como(linha.para, p_match, linha.id, false);
      return format('troca:recusa(%s) a tranquila nao negocia', linha.para);
    end if;

    -- o que entra menos o que sai, pela mesma régua da compra
    select coalesce(sum(public.met_bot_valor(mapa, est, linha.para, p, nivel)), 0)
      into valor
      from jsonb_array_elements_text(coalesce(linha.da -> 'props', '[]'::jsonb)) p;
    valor := valor + coalesce((linha.da ->> 'cash')::int, 0);

    select coalesce(sum(public.met_bot_valor(mapa, est, linha.para, p, nivel)), 0)
      into preco
      from jsonb_array_elements_text(coalesce(linha.quer -> 'props', '[]'::jsonb)) p;
    preco := preco + coalesce((linha.quer ->> 'cash')::int, 0);

    perform public.met_offer_reply_como(linha.para, p_match, linha.id, valor > preco);
    return format('troca:%s(%s) recebe %s e da %s',
                  case when valor > preco then 'aceita' else 'recusa' end,
                  linha.para, valor, preco);
  end loop;

  /* ── 3. A VEZ DELA ─────────────────────────────────────────────────────── */
  assento := (est ->> 'turnSeat')::smallint;
  nivel := public.met_bot_nivel(p_match, assento);
  if nivel is null then return null; end if;   -- é a vez de gente

  jog := est -> 'players' -> assento::text;
  caixa := coalesce((jog ->> 'cash')::int, 0);

  /* 3a. DÍVIDA. Vender casa, depois hipotecar, e só então quebrar.
     A ordem é a que perde menos: casa devolve metade e não tira a escritura;
     hipoteca tira a propriedade de circulação mas dá mais dinheiro. Quebrar é
     último — e é uma decisão, não um acidente. */
  if fase = 'resolve'
     and coalesce(est -> 'pendente' ->> 'k', '') = 'divida' then
    falta := coalesce((est -> 'pendente' ->> 'quanto')::int, 0);

    -- uma casa da propriedade mais construída
    select p.key into alvo
      from jsonb_each(est -> 'props') p
     where coalesce((p.value ->> 'owner')::smallint, -1) = assento
       and coalesce((p.value ->> 'casas')::int, 0) > 0
     order by (p.value ->> 'casas')::int desc, p.key
     limit 1;
    if alvo is not null then
      perform public.met_sell_como(assento, p_match, alvo, 1);
      return format('divida:vende(%s) uma casa de %s, faltam %s', assento, alvo, falta);
    end if;

    -- a hipoteca mais barata primeiro: guarda as caras para depois
    select p.key into alvo
      from jsonb_each(est -> 'props') p
      join jsonb_array_elements(mapa -> 'casas') c on c ->> 'id' = p.key
     where coalesce((p.value ->> 'owner')::smallint, -1) = assento
       and not coalesce((p.value ->> 'hipotecada')::boolean, false)
     order by (c ->> 'hipoteca')::int, p.key
     limit 1;
    if alvo is not null then
      perform public.met_mortgage_como(assento, p_match, alvo);
      return format('divida:hipoteca(%s) %s, faltam %s', assento, alvo, falta);
    end if;

    perform public.met_bankrupt_como(assento, p_match);
    return format('divida:quebra(%s) nao havia mais o que vender', assento);
  end if;

  -- 3b. CADEIA
  if fase = 'rolar' and coalesce((jog ->> 'jail')::int, 0) > 0 then
    if coalesce((jog ->> 'livras')::int, 0) > 0 then
      perform public.met_jail_como(assento, p_match, 'carta');
      return format('cadeia:carta(%s)', assento);
    end if;
    /* Pagar a fiança no COMEÇO é bom (mais casas para comprar); no fim é ruim
       (o aluguel está caro e a cadeia é abrigo). A tranquila não sabe disso e
       paga sempre que tem. */
    if caixa - coalesce((mapa -> 'regras' ->> 'fiancaCadeia')::int, 500)
       > public.met_bot_reserva(nivel, rodada)
       and (nivel = 'facil' or rodada <= 12) then
      perform public.met_jail_como(assento, p_match, 'pagar');
      return format('cadeia:paga(%s)', assento);
    end if;
    perform public.met_jail_como(assento, p_match, 'dado');
    return format('cadeia:dado(%s)', assento);
  end if;

  -- 3c. ROLAR
  if fase = 'rolar' then
    perform public.met_roll_como(assento, p_match);
    return format('rola(%s)', assento);
  end if;

  -- 3d. COMPRAR OU DEIXAR IR PARA LEILÃO
  if coalesce(est -> 'pendente' ->> 'k', '') = 'comprar' then
    prop := est -> 'pendente' ->> 'prop';
    preco := coalesce((est -> 'pendente' ->> 'preco')::int, 0);
    valor := public.met_bot_valor(mapa, est, assento, prop, nivel);

    if preco <= valor and caixa - preco >= public.met_bot_reserva(nivel, rodada) then
      perform public.met_buy_como(assento, p_match);
      return format('compra(%s) %s por %s (vale %s)', assento, prop, preco, valor);
    end if;
    /* RECUSAR MANDA PARA LEILÃO, e é jogada de verdade: propriedade que ela não
       quer pelo preço de tabela pode sair por menos, e ela ainda dá lance. */
    perform public.met_decline_como(assento, p_match);
    return format('recusa(%s) %s por %s (vale %s)', assento, prop, preco, valor);
  end if;

  -- 3e. CONSTRUIR
  /* A REGRA DE CONSTRUIR NÃO É REESCRITA AQUI. A máquina escolhe a propriedade
     e OFERECE; `met_build_como` diz se pode (grupo completo, construção par,
     casa no banco, dinheiro). Reescrever a validação aqui seria a divergência
     silenciosa que este trabalho todo existe para evitar. */
  if fase = 'acao' and nivel <> 'facil' then
    for linha in
      select p.key prop, coalesce((p.value ->> 'casas')::int, 0) casas,
             (c ->> 'casa')::int custo
        from jsonb_each(est -> 'props') p
        join jsonb_array_elements(mapa -> 'casas') c on c ->> 'id' = p.key
       where coalesce((p.value ->> 'owner')::smallint, -1) = assento
         and not coalesce((p.value ->> 'hipotecada')::boolean, false)
         and not coalesce((p.value ->> 'hotel')::boolean, false)
         and coalesce((p.value ->> 'casas')::int, 0) < case nivel when 'medio' then 3 else 4 end
         and c ->> 'g' is not null
       order by coalesce((p.value ->> 'casas')::int, 0), (c ->> 'casa')::int, p.key
    loop
      exit when caixa - linha.custo < public.met_bot_reserva(nivel, rodada);
      begin
        perform public.met_build_como(assento, p_match, linha.prop, 1);
        return format('constroi(%s) em %s por %s', assento, linha.prop, linha.custo);
      exception when others then
        -- grupo incompleto, construção ímpar, banco sem casa: o "não" das
        -- regras é resposta esperada aqui
        if sqlerrm in ('NOT_ENOUGH_CASH', 'MATCH_NOT_RUNNING') then raise; end if;
      end;
    end loop;
  end if;

  /* 3f. PROPOR TROCA.

     Numa mesa solo, uma máquina que só RESPONDE proposta tira metade da
     Metrópole do jogo: ninguém nunca te oferece nada, e a negociação — que é
     onde a partida vira — deixa de existir. Então ela propõe.

     O QUE ELA PEDE é sempre a mesma coisa: a propriedade que FECHA um grupo
     dela. É a única compra que muda o jogo, e é por isso que vale pagar acima da
     tabela por ela.

     O QUE ELA DÁ é dinheiro, e o preço é a avaliação dela menos a reserva. Ela
     não oferece escritura: dar uma propriedade para completar outra é uma conta
     que depende do que a outra pessoa está montando, e uma máquina que troca
     escritura sem enxergar isso entrega grupo de graça.

     A tranquila não propõe, pela mesma razão que não aceita: não negociar é o
     comportamento de quem ainda não entendeu o jogo. */
  if fase = 'acao' and nivel <> 'facil'
     and coalesce(jsonb_array_length(est -> 'ofertas'), 0) < 3
     /* UMA PROPOSTA POR RODADA, e sem ela isto vira laço infinito.

        A primeira versão só olhava se já havia proposta ABERTA pela mesma
        escritura. Numa mesa com duas máquinas o efeito foi este, medido:

            propoe: 535    troca:recusa: 534

        A máquina A propõe, a B recusa, a recusa TIRA a oferta da lista, a vaga
        volta a existir — e A propõe de novo, na mesma vez, para sempre. Nem A
        nem B fazem nada errado sozinhas: o laço nasce das duas certas juntas.

        Uma proposta por rodada por máquina resolve e ainda é o ritmo certo de
        mesa: quem propõe duas vezes seguidas a mesma coisa não está negociando,
        está insistindo. */
     and coalesce((est -> 'botProp' ->> assento::text)::int, -1) < rodada then

    select p.key, (est -> 'props' -> p.key ->> 'owner')::smallint
      into prop, dono
      from jsonb_each(est -> 'props') p
      join jsonb_array_elements(mapa -> 'casas') c on c ->> 'id' = p.key
     where c ->> 'g' is not null
       and (p.value ->> 'owner') is not null
       and (p.value ->> 'owner')::smallint <> assento
       and not coalesce((p.value ->> 'hipotecada')::boolean, false)
       and coalesce((p.value ->> 'casas')::int, 0) = 0
       -- ela só pede o que FECHA um grupo: o resto não muda o jogo
       and (
         select count(*) from jsonb_array_elements(mapa -> 'casas') c2
          where c2 ->> 'g' = c ->> 'g'
            and coalesce((est -> 'props' -> (c2 ->> 'id') ->> 'owner')::smallint, -1) = assento
       ) = (
         select count(*) - 1 from jsonb_array_elements(mapa -> 'casas') c3
          where c3 ->> 'g' = c ->> 'g'
       )
       -- e não repete proposta pela mesma escritura
       and not exists (
         select 1 from jsonb_array_elements(coalesce(est -> 'ofertas', '[]'::jsonb)) o
          where (o ->> 'de')::smallint = assento
            and o -> 'quer' -> 'props' @> to_jsonb(array[p.key])
       )
     order by public.dominio_ruido(semente, assento, rodada, p.key) desc
     limit 1;

    if prop is not null then
      valor := public.met_bot_valor(mapa, est, assento, prop, nivel);
      oferta := least(valor, caixa - public.met_bot_reserva(nivel, rodada));
      /* Abaixo do preço de tabela não é proposta, é ofensa — e proposta ofensiva
         gasta uma das três vagas por nada. */
      if oferta >= coalesce((
           select (c ->> 'preco')::int from jsonb_array_elements(mapa -> 'casas') c
            where c ->> 'id' = prop), 0) then
        begin
          perform public.met_offer_como(
            assento, p_match, dono,
            jsonb_build_object('cash', oferta),
            jsonb_build_object('props', jsonb_build_array(prop)));
          -- e a rodada fica marcada, para não propor de novo antes da próxima
          update public.matches
             set public_state = jsonb_set(
                   public_state, array['botProp', assento::text], to_jsonb(rodada), true)
           where id = p_match;
          return format('propoe(%s) R$ %s por %s a %s', assento, oferta, prop, dono);
        exception when others then
          -- o "não" das regras (proposta vazia, teto de propostas, escritura com
          -- casa) é resposta esperada: ela segue e passa a vez
          if sqlerrm = 'MATCH_NOT_RUNNING' then raise; end if;
        end;
      end if;
    end if;
  end if;

  -- 3g. PASSAR A VEZ
  if fase = 'acao' then
    perform public.met_end_turn_como(assento, p_match);
    return format('passa(%s)', assento);
  end if;

  return null;
end;
$function$;

revoke all on function public.met_bot_passo(uuid) from public, anon, authenticated;
