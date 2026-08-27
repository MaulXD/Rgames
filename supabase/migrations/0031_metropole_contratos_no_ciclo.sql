-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0031 · os contratos entram no ciclo do turno
--
-- A 0030 criou a mesa de negociação e o cartório. Aqui as quatro funções que
-- já existiam passam a conhecê-los:
--
--   met_pousa      — a isenção de aluguel é aplicada sem ninguém pedir
--   met_end_turn   — o cartório cobra no início do turno de quem entra
--   met_bankrupt   — contrato sobrevive ao credor e morre com o devedor
--   met_sweep      — o relógio passa a vez e o cartório cobra igual
--
-- Os corpos abaixo foram GERADOS a partir dos que estão em 0027 e 0028, com
-- só as emendas desta etapa aplicadas. Somam umas 400 linhas, e retipá-las
-- para mudar cinco é o jeito mais confiável de introduzir uma diferença que
-- ninguém percebe na revisão.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.met_pousa(
  p_mapa jsonb, p_est jsonb, p_seed bigint, p_seat smallint, p_soma int, p_prof int
)
returns jsonb
language plpgsql
as $$
declare
  est    jsonb := p_est;
  pos    int;
  casa   jsonb;
  tipo   text;
  prop   text;
  dono   smallint;
  quanto int;
  carta  jsonb;
  qual   text;
  k      int;
  destino int;
  passou boolean;
  outro  text;
  salario int := (p_mapa -> 'regras' ->> 'salario')::int;
begin
  pos := (est -> 'players' -> p_seat::text ->> 'pos')::int;
  casa := public.met_casa(p_mapa, pos);
  tipo := casa ->> 't';

  ---------------------------------------------------------------- propriedade
  if tipo in ('bairro', 'transporte', 'companhia') then
    prop := casa ->> 'id';
    dono := (est -> 'props' -> prop ->> 'owner')::smallint;

    if dono is null then
      -- a decisão fica pendente: comprar ou recusar (e recusar abre leilão)
      est := jsonb_set(est, '{pendente}', jsonb_build_object(
        'k', 'comprar', 'prop', prop, 'preco', (casa ->> 'preco')::int));
      est := jsonb_set(est, '{phase}', '"resolve"');
      return est;
    end if;

    if dono = p_seat then
      return est;
    end if;

    quanto := public.met_aluguel(p_mapa, est, prop, p_soma);

    /* A ISENÇÃO DE ALUGUEL, aplicada sem ninguém pedir.
       É por isso que o contrato vale: na mesa, "não te cobro aluguel em
       Ipanema por quatro rodadas" depende de o dono lembrar, de boa vontade,
       quatro vezes. Aqui o servidor esquece de cobrar por você. */
    if quanto > 0 and public.met_isento(est, p_seat, dono, prop) then
      est := public.met_log(est, jsonb_build_object(
        'k', 'isento', 'seat', p_seat, 'de', dono, 'prop', prop, 'valor', quanto));
      quanto := 0;
    end if;

    if quanto > 0 then
      est := public.met_paga(est, p_seat, dono, quanto, 'aluguel:' || prop);
    end if;
    return est;

  ---------------------------------------------------------------------- taxas
  elsif tipo in ('imposto', 'taxa') then
    return public.met_paga(est, p_seat, null, (casa ->> 'valor')::int, tipo);

  ------------------------------------------------------------------- a cadeia
  elsif tipo = 'va-cadeia' then
    return public.met_prende(est, p_seat);

  --------------------------------------------------------------------- cartas
  elsif tipo in ('sorte', 'reves') then
    qual := tipo;
    k := coalesce((est -> 'cartas' ->> qual)::int, 0);
    carta := public.met_carta(p_mapa, p_seed, qual, k);
    est := jsonb_set(est, array['cartas', qual], to_jsonb(k + 1));
    if carta is null then return est; end if;

    est := public.met_log(est, jsonb_build_object(
      'k', 'carta', 'seat', p_seat, 'qual', qual, 'texto', carta ->> 'texto'));

    -- ganho ou perda direta
    if carta ->> 'k' = 'dinheiro' then
      if (carta ->> 'valor')::int >= 0 then
        est := jsonb_set(est, array['players', p_seat::text, 'cash'],
          to_jsonb((est -> 'players' -> p_seat::text ->> 'cash')::int + (carta ->> 'valor')::int));
      else
        est := public.met_paga(est, p_seat, null, -(carta ->> 'valor')::int, 'carta');
      end if;
      return est;

    -- de cada jogador, ou para cada jogador
    elsif carta ->> 'k' = 'cada' then
      for outro in select key from jsonb_each(est -> 'players') loop
        if outro::smallint = p_seat then continue; end if;
        if coalesce((est -> 'players' -> outro ->> 'quebrado')::boolean, false) then continue; end if;
        if (carta ->> 'valor')::int > 0 then
          est := public.met_paga(est, outro::smallint, p_seat, (carta ->> 'valor')::int, 'carta');
        else
          est := public.met_paga(est, p_seat, outro::smallint, -(carta ->> 'valor')::int, 'carta');
        end if;
      end loop;
      return est;

    -- guarda a carta que tira da cadeia
    elsif carta ->> 'k' = 'livra' then
      return jsonb_set(est, array['players', p_seat::text, 'livras'],
        to_jsonb(coalesce((est -> 'players' -> p_seat::text ->> 'livras')::int, 0) + 1));

    elsif carta ->> 'k' = 'cadeia' then
      return public.met_prende(est, p_seat);

    -- paga por construção: casa e hotel a preços diferentes
    elsif carta ->> 'k' = 'obra' then
      select coalesce(sum(
               case when coalesce((est -> 'props' -> (c ->> 'id') ->> 'hotel')::boolean, false)
                    then (carta ->> 'hotel')::int
                    else (carta ->> 'casa')::int
                         * coalesce((est -> 'props' -> (c ->> 'id') ->> 'casas')::int, 0)
               end), 0)
        into quanto
        from jsonb_array_elements(p_mapa -> 'casas') c
       where c ->> 't' = 'bairro'
         and (est -> 'props' -> (c ->> 'id') ->> 'owner')::smallint = p_seat;
      if quanto > 0 then
        est := public.met_paga(est, p_seat, null, quanto, 'obra');
      end if;
      return est;

    -- anda para uma casa, cobrando a Largada se passar
    elsif carta ->> 'k' = 'anda' then
      destino := (carta ->> 'casa')::int;
      passou := destino < pos and not coalesce((carta ->> 'semSalario')::boolean, false);
      est := jsonb_set(est, array['players', p_seat::text, 'pos'], to_jsonb(destino));
      if passou then
        est := jsonb_set(est, array['players', p_seat::text, 'cash'],
          to_jsonb((est -> 'players' -> p_seat::text ->> 'cash')::int + salario));
        est := public.met_log(est, jsonb_build_object('k', 'largada', 'seat', p_seat));
      end if;
      if p_prof < 3 then
        return public.met_pousa(p_mapa, est, p_seed, p_seat, p_soma, p_prof + 1);
      end if;
      return est;

    -- anda para trás, sem cobrar Largada
    elsif carta ->> 'k' = 'anda-tras' then
      destino := ((pos - (carta ->> 'n')::int) % 40 + 40) % 40;
      est := jsonb_set(est, array['players', p_seat::text, 'pos'], to_jsonb(destino));
      if p_prof < 3 then
        return public.met_pousa(p_mapa, est, p_seed, p_seat, p_soma, p_prof + 1);
      end if;
      return est;

    -- o próximo transporte ou companhia, com aluguel agravado
    elsif carta ->> 'k' = 'proximo' then
      select (c ->> 'pos')::int into destino
        from jsonb_array_elements(p_mapa -> 'casas') c
       where c ->> 't' = (carta ->> 'tipo')
         and (c ->> 'pos')::int > pos
       order by (c ->> 'pos')::int
       limit 1;
      if destino is null then
        -- não há mais nenhum à frente: dá a volta, e a volta paga o salário
        select (c ->> 'pos')::int into destino
          from jsonb_array_elements(p_mapa -> 'casas') c
         where c ->> 't' = (carta ->> 'tipo')
         order by (c ->> 'pos')::int
         limit 1;
        est := jsonb_set(est, array['players', p_seat::text, 'cash'],
          to_jsonb((est -> 'players' -> p_seat::text ->> 'cash')::int + salario));
      end if;
      est := jsonb_set(est, array['players', p_seat::text, 'pos'], to_jsonb(destino));

      prop := public.met_casa(p_mapa, destino) ->> 'id';
      dono := (est -> 'props' -> prop ->> 'owner')::smallint;
      if dono is null then
        est := jsonb_set(est, '{pendente}', jsonb_build_object(
          'k', 'comprar', 'prop', prop,
          'preco', (public.met_casa(p_mapa, destino) ->> 'preco')::int));
        return jsonb_set(est, '{phase}', '"resolve"');
      end if;
      if dono = p_seat then return est; end if;
      -- o agravo: transporte paga o dobro, companhia paga dez vezes o dado
      quanto := public.met_aluguel(p_mapa, est, prop, p_soma);
      -- o agravo da carta: transporte cobra o dobro da tabela, companhia
      -- cobra dez vezes o dado independente de quantas o dono tenha
      if carta ->> 'tipo' = 'transporte' then
        quanto := quanto * 2;
      else
        quanto := p_soma * 100;
      end if;
      -- a isenção vale contra o agravo da carta também: quem combinou não
      -- pagar não passa a pagar por causa de uma carta
      if quanto > 0 and public.met_isento(est, p_seat, dono, prop) then
        est := public.met_log(est, jsonb_build_object(
          'k', 'isento', 'seat', p_seat, 'de', dono, 'prop', prop, 'valor', quanto));
        quanto := 0;
      end if;
      if quanto > 0 then
        est := public.met_paga(est, p_seat, dono, quanto, 'aluguel-agravado:' || prop);
      end if;
      return est;
    end if;
    return est;
  end if;

  -- largada, praça central, cadeia de passagem: nada acontece
  return est;
end;
$$;

create or replace function public.met_end_turn(p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  est      jsonb;
  semente  bigint;
  meu      smallint;
  mapa     jsonb;
  ativos   smallint[];
  onde     int;
  proximo  smallint;
  rodada   int;
  final    int;
  melhor   smallint;
  melhorP  int := -1;
  s        text;
  p        int;
  qual     uuid;
begin
  select * into est, semente, meu, mapa from public.met_na_vez(p_match);

  if est ->> 'phase' = 'leilao' then raise exception 'AUCTION_OPEN'; end if;
  if est -> 'pendente' is not null and est -> 'pendente' <> 'null'::jsonb then
    raise exception 'RESOLVE_FIRST';
  end if;
  if est ->> 'phase' = 'rolar'
     and coalesce((est -> 'players' -> meu::text ->> 'jail')::int, 0) = 0 then
    raise exception 'ROLL_FIRST';   -- ninguém passa a vez sem jogar o dado
  end if;
  if (est -> 'players' -> meu::text ->> 'cash')::int < 0 then
    raise exception 'PAY_YOUR_DEBT';
  end if;

  select array_agg(k::smallint order by k::smallint) into ativos
    from jsonb_each(est -> 'players') e(k, v)
   where not coalesce((v ->> 'quebrado')::boolean, false);

  if coalesce(array_length(ativos, 1), 0) <= 1 then
    est := jsonb_set(est, '{phase}', '"fim"');
    est := jsonb_set(est, '{vencedor}', to_jsonb(ativos[1]));
    update public.matches set status = 'finished', ended_at = now(),
           public_state = est, version = version + 1, turn_deadline = null
     where id = p_match returning room_id into qual;
    update public.rooms set status = 'lobby' where id = qual;
    return public.met_publico(p_match);
  end if;

  select i into onde from generate_subscripts(ativos, 1) i where ativos[i] = meu;
  proximo := ativos[(coalesce(onde, 0) % array_length(ativos, 1)) + 1];

  rodada := coalesce((est ->> 'round')::int, 1);
  if proximo = ativos[1] then
    rodada := rodada + 1;
  end if;
  final := (est ->> 'rodadaFinal')::int;

  /* FIM POR RODADAS — o conserto do problema definidor deste jogo.
     Banco Imobiliário dura três horas porque só acaba quando sobra um, e
     "sobrar um" depende de todos os outros quebrarem. Vinte rodadas com
     vitória por patrimônio acaba em 45 a 60 minutos e premia jogar bem, não
     jogar por mais tempo. O modo Clássico não tem rodada final e continua
     ali, inteiro, para quem quer as três horas. */
  if final is not null and rodada > final then
    for s in select key from jsonb_each(est -> 'players') loop
      p := public.met_patrimonio(mapa, est, s::smallint);
      est := jsonb_set(est, array['players', s, 'patrimonio'], to_jsonb(p));
      if p > melhorP then
        melhorP := p;
        melhor := s::smallint;
      end if;
    end loop;
    est := jsonb_set(est, '{phase}', '"fim"');
    est := jsonb_set(est, '{vencedor}', to_jsonb(melhor));
    est := public.met_log(est, jsonb_build_object(
      'k', 'fim-rodadas', 'seat', melhor, 'valor', melhorP));

    update public.matches set status = 'finished', ended_at = now(),
           public_state = est, version = version + 1, turn_deadline = null
     where id = p_match returning room_id into qual;
    update public.rooms set status = 'lobby' where id = qual;
    perform public.met_premia(p_match, melhor);
    return public.met_publico(p_match);
  end if;

  est := jsonb_set(est, '{round}', to_jsonb(rodada));
  est := jsonb_set(est, '{turnSeat}', to_jsonb(proximo));

  /* O CARTÓRIO COBRA ANTES DE QUALQUER COISA no turno de quem entra: as
     parcelas que ele deve saem agora, os contratos que o constrangem gastam
     uma rodada, e o que venceu é jogado fora. Vem antes da checagem de dívida
     de propósito — a parcela pode ser justamente o que deixa a pessoa no
     negativo, e nesse caso ela já entra na vez tendo de resolver isso. */
  est := public.met_cobra_contratos(est, proximo);

  /* Quem entra na vez DEVENDO (por uma carta que o pegou fora do turno, ou
     pela parcela que acabou de ser debitada) entra na fase de resolver, não
     de rolar. Sem isso a dívida atravessaria a partida sem trancar nada. */
  if (est -> 'players' -> proximo::text ->> 'cash')::int < 0 then
    est := jsonb_set(est, '{pendente}', jsonb_build_object(
      'k', 'divida',
      'quanto', -((est -> 'players' -> proximo::text ->> 'cash')::int),
      'para', null, 'motivo', 'atraso'));
    est := jsonb_set(est, '{phase}', '"resolve"');
  else
    est := jsonb_set(est, '{phase}', '"rolar"');
  end if;
  est := jsonb_set(est, '{duplos}', '0'::jsonb);
  est := jsonb_set(est, '{dados}', 'null'::jsonb);
  est := public.met_log(est, jsonb_build_object('k', 'vez', 'seat', proximo));

  update public.matches set public_state = est, version = version + 1,
         turn_deadline = now() + interval '90 seconds'
   where id = p_match;
  return public.met_publico(p_match);
end;
$$;

create or replace function public.met_bankrupt(p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  est     jsonb;
  semente bigint;
  meu     smallint;
  mapa    jsonb;
  liquido int;
  modo    text;
  sobra   int;
  c       jsonb;
  ativos  smallint[];
  qual    uuid;
begin
  select * into est, semente, meu, mapa from public.met_na_vez(p_match);

  if (est -> 'players' -> meu::text ->> 'cash')::int >= 0 then
    raise exception 'NOT_BROKE';   -- não se declara falência por vontade
  end if;

  modo := est ->> 'mode';
  liquido := greatest(public.met_patrimonio(mapa, est, meu), 0);

  -- devolve tudo ao banco, com as construções
  for c in select value from jsonb_array_elements(mapa -> 'casas') loop
    if c ->> 'id' is null then continue; end if;
    if (est -> 'props' -> (c ->> 'id') ->> 'owner')::smallint <> meu then continue; end if;

    if coalesce((est -> 'props' -> (c ->> 'id') ->> 'hotel')::boolean, false) then
      est := jsonb_set(est, array['bank', 'hoteis'],
        to_jsonb((est -> 'bank' ->> 'hoteis')::int + 1));
    else
      est := jsonb_set(est, array['bank', 'casas'],
        to_jsonb((est -> 'bank' ->> 'casas')::int
                 + coalesce((est -> 'props' -> (c ->> 'id') ->> 'casas')::int, 0)));
    end if;

    est := jsonb_set(est, array['props', c ->> 'id'], jsonb_build_object(
      'owner', null, 'casas', 0, 'hotel', false, 'hipotecada', false));
  end loop;

  sobra := case when modo = 'classico' then 0 else (liquido / 10) end;
  est := jsonb_set(est, array['players', meu::text, 'cash'], to_jsonb(greatest(sobra, 0)));
  est := jsonb_set(est, array['players', meu::text, 'quebrado'], 'true'::jsonb);
  est := jsonb_set(est, array['players', meu::text, 'investidor'],
    case when modo = 'classico' then 'false'::jsonb else 'true'::jsonb end);
  est := jsonb_set(est, '{pendente}', 'null'::jsonb);

  /* OS CONTRATOS NA FALÊNCIA — o critério de aceite pede isto explicitamente.
     Contrato sobrevive à falência do CREDOR: quem quebrou vira Investidor e
     continua recebendo, porque a dívida é de quem deve e o azar do credor não
     perdoa ninguém. Já o que quem quebrou DEVIA morre: não se cobra parcela
     de quem não tem nada, e insistir só criaria um devedor eterno travando o
     turno dele para sempre.
     As isenções que ele concedia também caem — ele não tem mais propriedade
     nenhuma para deixar de cobrar — e as opções sobre as propriedades dele
     também, porque as propriedades voltaram ao banco. */
  -- o alias é `ct` e não `c` de propósito: `met_bankrupt` declara uma
  -- variável `c jsonb`, e um alias de mesmo nome deixa o Postgres sem saber a
  -- qual dos dois `c ->> 'tipo'` se refere — erro 42702. É a mesma regra que
  -- matou `dominio_start` uma vez, agora ao contrário: lá era a variável com
  -- nome de coluna, aqui é o alias com nome de variável.
  est := jsonb_set(est, '{contratos}', (
    select coalesce(jsonb_agg(ct), '[]'::jsonb)
      from jsonb_array_elements(coalesce(est -> 'contratos', '[]'::jsonb)) ct
     where not (
       (ct ->> 'tipo' = 'parcela' and (ct ->> 'de')::smallint = meu)
       or (ct ->> 'tipo' = 'isencao' and (ct ->> 'de')::smallint = meu)
       or (ct ->> 'tipo' = 'opcao' and (ct ->> 'de')::smallint = meu)
     )
  ));
  -- e as propostas abertas de ou para ele saem da mesa
  est := jsonb_set(est, '{ofertas}', (
    select coalesce(jsonb_agg(oft), '[]'::jsonb)
      from jsonb_array_elements(coalesce(est -> 'ofertas', '[]'::jsonb)) oft
     where (oft ->> 'de')::smallint <> meu and (oft ->> 'para')::smallint <> meu
  ));

  est := public.met_confere_divida(est, meu);
  est := public.met_log(est, jsonb_build_object(
    'k', case when modo = 'classico' then 'eliminado' else 'investidor' end,
    'seat', meu, 'valor', sobra));

  select array_agg(k::smallint order by k::smallint) into ativos
    from jsonb_each(est -> 'players') e(k, v)
   where not coalesce((v ->> 'quebrado')::boolean, false);

  if coalesce(array_length(ativos, 1), 0) <= 1 then
    est := jsonb_set(est, '{phase}', '"fim"');
    est := jsonb_set(est, '{vencedor}', to_jsonb(ativos[1]));
    update public.matches set status = 'finished', ended_at = now(),
           public_state = est, version = version + 1, turn_deadline = null
     where id = p_match returning room_id into qual;
    update public.rooms set status = 'lobby' where id = qual;
    perform public.met_premia(p_match, ativos[1]);
    return public.met_publico(p_match);
  end if;

  -- o turno de quem quebrou acaba na hora
  est := jsonb_set(est, '{phase}', '"acao"');
  update public.matches set public_state = est, version = version + 1,
         turn_deadline = now() + interval '20 seconds'
   where id = p_match;
  return public.met_publico(p_match);
end;
$$;

create or replace function public.met_sweep()
returns int
language plpgsql
security definer
set search_path = public
as $$
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
        est := jsonb_set(est, '{phase}', '"fim"');
        est := jsonb_set(est, '{vencedor}', to_jsonb(ativos[1]));
        update public.matches set status = 'finished', ended_at = now(),
               public_state = est, version = version + 1, turn_deadline = null
         where id = linha.id;
        update public.rooms set status = 'lobby' where id = linha.room_id;
        quantos := quantos + 1;
        continue;
      end if;

      select i into onde from generate_subscripts(ativos, 1) i where ativos[i] = atual;
      proximo := ativos[(coalesce(onde, 0) % array_length(ativos, 1)) + 1];
      rodada := coalesce((est ->> 'round')::int, 1);
      if proximo = ativos[1] then rodada := rodada + 1; end if;
      final := (est ->> 'rodadaFinal')::int;

      if final is not null and rodada > final then
        est := jsonb_set(est, '{phase}', '"fim"');
        update public.matches set status = 'finished', ended_at = now(),
               public_state = est, version = version + 1, turn_deadline = null
         where id = linha.id;
        update public.rooms set status = 'lobby' where id = linha.room_id;
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
$$;

revoke all on function public.met_pousa(jsonb, jsonb, bigint, smallint, int, int) from public, anon, authenticated;
revoke all on function public.met_end_turn(uuid) from public, anon, authenticated;
grant execute on function public.met_end_turn(uuid) to authenticated;
revoke all on function public.met_bankrupt(uuid) from public, anon, authenticated;
grant execute on function public.met_bankrupt(uuid) to authenticated;
revoke all on function public.met_sweep() from public, anon, authenticated;
