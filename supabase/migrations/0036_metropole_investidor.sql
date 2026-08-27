-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0036 · o Investidor, e o fim de partida num lugar só
--
-- O INVESTIDOR (§5.5) existia pela metade: quem quebrava virava Investidor,
-- recebia 10% do patrimônio e... assistia. `met_bid` recusava quem estava
-- quebrado, então ele não dava lance em leilão nenhum, e `met_offer` também o
-- recusava. O texto do PRD dizia "é o oposto de assistir"; o código dizia o
-- contrário.
--
-- Agora ele faz as quatro coisas:
--
--   1. DÁ LANCE em todo leilão. Não anda pelo tabuleiro, não tem escritura no
--      nome, e está em toda disputa.
--   2. O QUE ARREMATA É ADMINISTRADO por um jogador ativo, à escolha dele: a
--      escritura fica no nome do administrador — para grupo de cor, construção
--      e tudo mais — e o aluguel é partido no meio entre os dois. Por isso o
--      lance dele exige nomear quem administra.
--   3. NEGOCIA. Não tem escritura para dar, mas tem dinheiro e pode receber
--      parcelas, que é exatamente o que um empréstimo é. Sai de graça porque o
--      cartório dos contratos já existe (0030).
--   4. APOSTA EM SEGREDO em quem vai vencer, e acertar vale o segundo lugar.
--
-- E O FIM DE PARTIDA VIRA UMA FUNÇÃO SÓ. Havia CINCO blocos de encerramento
-- espalhados por quatro funções, e eles não eram iguais:
--
--   · `met_end_turn`, no caminho "sobrou um", não creditava XP a ninguém
--   · `met_sweep`, no caminho "sobrou um", também não
--   · `met_sweep`, no caminho "acabaram as rodadas", encerrava a partida SEM
--     apurar vencedor e sem creditar nada — a temporada acabava e ninguém
--     ganhava
--
-- Três comportamentos diferentes para a mesma coisa é o que acontece quando o
-- mesmo bloco é copiado. `met_termina` passa a ser o único caminho: apura o
-- patrimônio de todos, revela as apostas dos Investidores, credita o XP, e
-- devolve a sala ao lobby.
-- ═══════════════════════════════════════════════════════════════════════════

/**
 * Encerra a partida. Único caminho de fim, para os quatro que existiam.
 *
 * `p_vencedor` nulo significa "apure pelo patrimônio" — é o fim por rodadas.
 * Com valor, é o fim por sobrar um.
 *
 * O patrimônio de TODOS é gravado no estado, e não só o do vencedor: é o que a
 * tela final mostra, e recalcular no cliente daria outro número na hora em que
 * o número precisa ser o mesmo para todo mundo.
 */
create or replace function public.met_termina(
  p_match uuid, p_est jsonb, p_vencedor smallint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  est     jsonb := p_est;
  mapa    jsonb;
  s       text;
  p       int;
  melhor  smallint := p_vencedor;
  melhorP int := -1;
  apostas jsonb := '[]'::jsonb;
  linha   record;
  qual    uuid;
begin
  select data into mapa from public.game_themes gt where gt.id = (est ->> 'map');

  -- patrimônio de todos, gravado no estado
  for s in select key from jsonb_each(est -> 'players') loop
    p := public.met_patrimonio(mapa, est, s::smallint);
    est := jsonb_set(est, array['players', s, 'patrimonio'], to_jsonb(p));
    if p_vencedor is null
       and not coalesce((est -> 'players' -> s ->> 'quebrado')::boolean, false)
       and p > melhorP then
      melhorP := p;
      melhor := s::smallint;
    end if;
  end loop;

  /* AS APOSTAS DOS INVESTIDORES, reveladas agora e não antes.
     Elas moram no estado privado justamente para não influenciar o jogo: um
     Investidor que aposta no Otávio e todo mundo sabe passa a ser tratado como
     aliado do Otávio. Reveladas no fim, elas são a única coisa que o
     Investidor ganha — e o que dá a ele razão para ler a mesa em vez de só
     emprestar dinheiro a quem paga mais. */
  for linha in
    select mp.seat, mps.data -> 'aposta' as aposta
      from public.match_players mp
      join public.match_private_state mps
        on mps.match_id = mp.match_id and mps.user_id = mp.user_id
     where mp.match_id = p_match
  loop
    if linha.aposta is not null and linha.aposta <> 'null'::jsonb
       and coalesce((est -> 'players' -> linha.seat::text ->> 'investidor')::boolean, false) then
      apostas := apostas || jsonb_build_array(jsonb_build_object(
        'seat', linha.seat,
        'em', (linha.aposta #>> '{}')::smallint,
        'acertou', (linha.aposta #>> '{}')::smallint = melhor));
    end if;
  end loop;

  est := jsonb_set(est, '{apostas}', apostas, true);
  est := jsonb_set(est, '{phase}', '"fim"');
  est := jsonb_set(est, '{vencedor}',
    case when melhor is null then 'null'::jsonb else to_jsonb(melhor) end);
  est := public.met_log(est, jsonb_build_object(
    'k', case when p_vencedor is null then 'fim-rodadas' else 'fim-sobrou-um' end,
    'seat', melhor,
    'valor', case when p_vencedor is null then melhorP else null end));

  update public.matches
     set status = 'finished', ended_at = now(), version = version + 1,
         public_state = est, turn_deadline = null
   where id = p_match
  returning room_id into qual;

  update public.rooms set status = 'lobby' where id = qual;
  if melhor is not null then
    perform public.met_premia(p_match, melhor);
  end if;

  return est;
end;
$$;

revoke all on function public.met_termina(uuid, jsonb, smallint) from public, anon, authenticated;

/**
 * A aposta secreta do Investidor: em quem ele acha que vai vencer.
 *
 * Fica no estado privado, e é o único segredo desta partida — a Metrópole é um
 * jogo de informação aberta por desenho, e esta é a exceção que se justifica:
 * aposta revelada vira aliança pública, e o Investidor deixa de ser neutro.
 *
 * Pode trocar quantas vezes quiser enquanto a partida roda. Não há como
 * verificar quando ele decidiu, então travar a troca seria teatro.
 */
create or replace function public.met_aposta(p_match uuid, p_em smallint)
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
begin
  select * into est, semente, meu, mapa from public.met_sou(p_match);

  if not coalesce((est -> 'players' -> meu::text ->> 'investidor')::boolean, false) then
    raise exception 'NOT_AN_INVESTOR';
  end if;
  if est -> 'players' -> p_em::text is null then raise exception 'NOT_A_PLAYER'; end if;
  if p_em = meu then raise exception 'SELF_BET'; end if;
  if coalesce((est -> 'players' -> p_em::text ->> 'quebrado')::boolean, false) then
    raise exception 'BANKRUPT';   -- não se aposta em quem já está fora
  end if;

  update public.match_private_state
     set data = jsonb_set(data, '{aposta}', to_jsonb(p_em))
   where match_id = p_match and user_id = auth.uid();

  return public.met_publico(p_match);
end;
$$;

revoke all on function public.met_aposta(uuid, smallint) from public, anon, authenticated;
grant execute on function public.met_aposta(uuid, smallint) to authenticated;

create or replace function public.met_bid(
  p_match uuid, p_valor int, p_admin smallint default null
)
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
  lei     jsonb;
  minimo  int;
begin
  select * into est, semente, meu, mapa from public.met_sou(p_match);

  if est ->> 'phase' <> 'leilao' then raise exception 'NO_AUCTION'; end if;

  /* O INVESTIDOR DÁ LANCE. É o coração do §5.5 e o que separa "quem quebrou
     vira Investidor" de "quem quebrou assiste": ele não anda pelo tabuleiro,
     não tem escritura no nome, e ainda assim está em toda disputa. Não pode
     vencer a partida, mas todo mundo precisa falar com ele.

     E o que ele arremata é ADMINISTRADO por um jogador ativo, à escolha dele:
     a escritura fica no nome do administrador — para grupo de cor, construção
     e tudo mais — e o aluguel é partido no meio entre os dois. Por isso o
     lance do Investidor exige dizer quem administra: sem administrador, a
     propriedade não teria como participar do jogo. */
  if coalesce((est -> 'players' -> meu::text ->> 'quebrado')::boolean, false) then
    if not coalesce((est -> 'players' -> meu::text ->> 'investidor')::boolean, false) then
      raise exception 'BANKRUPT';
    end if;
    if p_admin is null then raise exception 'NEED_ADMIN'; end if;
    if est -> 'players' -> p_admin::text is null
       or coalesce((est -> 'players' -> p_admin::text ->> 'quebrado')::boolean, false) then
      raise exception 'BAD_ADMIN';
    end if;
  end if;

  lei := est -> 'leilao';
  minimo := greatest(
    coalesce((lei ->> 'alto')::int, 0) + 1,
    (mapa -> 'regras' ->> 'lanceMinimo')::int);

  if p_valor < minimo then raise exception 'BID_TOO_LOW'; end if;
  if (est -> 'players' -> meu::text ->> 'cash')::int < p_valor then
    raise exception 'NOT_ENOUGH_CASH';
  end if;

  est := jsonb_set(est, array['leilao', 'alto'], to_jsonb(p_valor));
  est := jsonb_set(est, array['leilao', 'altoSeat'], to_jsonb(meu));
  est := jsonb_set(est, array['leilao', 'passou'], '[]'::jsonb);
  -- quem administra vai junto com o lance: se este for o lance vencedor, é
  -- este administrador que assume a escritura
  est := jsonb_set(est, array['leilao', 'admin'],
    case when p_admin is null then 'null'::jsonb else to_jsonb(p_admin) end, true);
  est := public.met_log(est, jsonb_build_object(
    'k', 'lance', 'seat', meu, 'prop', lei ->> 'prop', 'valor', p_valor));

  -- o relógio reinicia a cada lance: leilão termina quando para de subir
  update public.matches set public_state = est, version = version + 1,
         turn_deadline = now() + interval '20 seconds'
   where id = p_match;
  return public.met_publico(p_match);
end;
$$;

create or replace function public.met_fecha_leilao(p_est jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  est  jsonb := p_est;
  lei  jsonb := p_est -> 'leilao';
  quem smallint;
  vale int;
begin
  if lei is null or lei = 'null'::jsonb then return est; end if;

  quem := (lei ->> 'altoSeat')::smallint;
  vale := coalesce((lei ->> 'alto')::int, 0);

  if quem is null then
    -- ninguém deu lance: a propriedade continua do banco. Não é fracasso do
    -- leilão — é informação, e ela aparece no registro.
    est := public.met_log(est, jsonb_build_object(
      'k', 'leilao-vazio', 'prop', lei ->> 'prop'));
  else
    est := public.met_paga(est, quem, null, vale, 'leilao:' || (lei ->> 'prop'));

    /* Se quem arrematou foi um Investidor, a escritura vai para o NOME DO
       ADMINISTRADOR e o Investidor fica com uma meia-parte do aluguel. O
       dinheiro saiu do bolso do Investidor; a propriedade entra no jogo pela
       mão de quem joga. */
    if coalesce((est -> 'players' -> quem::text ->> 'investidor')::boolean, false)
       and lei -> 'admin' is not null and lei -> 'admin' <> 'null'::jsonb then
      est := jsonb_set(est, array['props', lei ->> 'prop', 'owner'], lei -> 'admin');
      est := jsonb_set(est, array['props', lei ->> 'prop', 'investidor'], to_jsonb(quem), true);
      est := public.met_log(est, jsonb_build_object(
        'k', 'leilao-investidor', 'seat', quem, 'prop', lei ->> 'prop',
        'valor', vale, 'para', (lei ->> 'admin')::smallint));
    else
      est := jsonb_set(est, array['props', lei ->> 'prop', 'owner'], to_jsonb(quem));
      est := public.met_log(est, jsonb_build_object(
        'k', 'leilao-fecha', 'seat', quem, 'prop', lei ->> 'prop', 'valor', vale));
    end if;
  end if;

  return public.met_volta_fase(est);
end;
$$;

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
  socio  smallint;
  meia   int;
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

    /* MEIA-PARTE DO INVESTIDOR. Quando a propriedade foi arrematada por um
       Investidor, o aluguel se parte: o administrador fica com a metade maior
       (a divisão inteira sobra para ele) e o Investidor com a outra. São duas
       transferências e não uma, para que cada lado apareça no registro —
       ninguém precisa deduzir para onde foi o dinheiro. */
    if quanto > 0 then
      socio := coalesce((est -> 'props' -> prop ->> 'investidor')::smallint, -1);
      if socio >= 0 and socio <> dono then
        meia := quanto / 2;
        est := public.met_paga(est, p_seat, dono, quanto - meia, 'aluguel:' || prop);
        est := public.met_paga(est, p_seat, socio, meia, 'aluguel-investidor:' || prop);
      else
        est := public.met_paga(est, p_seat, dono, quanto, 'aluguel:' || prop);
      end if;
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

  --------------------------------------------------------------- praça central
  elsif tipo = 'praca' then
    -- sem a regra da casa, a Praça é descanso: nada acontece, e é assim que o
    -- jogo oficial funciona
    if coalesce((est -> 'regras' ->> 'bolao')::boolean, false)
       and coalesce((est ->> 'bolao')::int, 0) > 0 then
      quanto := (est ->> 'bolao')::int;
      est := jsonb_set(est, array['players', p_seat::text, 'cash'],
        to_jsonb((est -> 'players' -> p_seat::text ->> 'cash')::int + quanto));
      est := jsonb_set(est, '{bolao}', '0'::jsonb);
      est := public.met_log(est, jsonb_build_object(
        'k', 'bolao', 'seat', p_seat, 'valor', quanto));
    end if;
    return est;

  -------------------------------------------------------------------- largada
  elsif tipo = 'largada' then
    -- parar EXATAMENTE na Largada, com a regra da casa ligada, paga de novo.
    -- O salário da passagem já foi creditado por quem chamou; este é o extra.
    if coalesce((est -> 'regras' ->> 'largadaDobrada')::boolean, false) then
      est := jsonb_set(est, array['players', p_seat::text, 'cash'],
        to_jsonb((est -> 'players' -> p_seat::text ->> 'cash')::int + salario));
      est := public.met_log(est, jsonb_build_object(
        'k', 'largada-dobrada', 'seat', p_seat, 'valor', salario));
    end if;
    return est;
  end if;

  -- cadeia de passagem: nada acontece
  return est;
end;
$$;

create or replace function public.met_offer(
  p_match uuid, p_para smallint, p_da jsonb, p_quer jsonb
)
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
  erro    text;
  quantas int;
  cseq    int;
begin
  select * into est, semente, meu, mapa from public.met_sou(p_match);

  if est ->> 'phase' = 'fim' then raise exception 'MATCH_NOT_RUNNING'; end if;
  if p_para = meu then raise exception 'SELF_OFFER'; end if;
  if est -> 'players' -> p_para::text is null then raise exception 'NOT_A_PLAYER'; end if;
  /* O INVESTIDOR NEGOCIA. Não tem escritura para oferecer, mas tem dinheiro e
     pode receber parcelas — que é exatamente o que um empréstimo é: "te dou
     R$ 3.000 agora, você me paga R$ 500 por rodada durante oito rodadas". É a
     quarta coisa que o §5.5 pede dele, e sai de graça porque o cartório dos
     contratos já existe. Quem quebrou e NÃO é Investidor (modo Clássico) está
     fora e não negocia. */
  if (coalesce((est -> 'players' -> meu::text ->> 'quebrado')::boolean, false)
      and not coalesce((est -> 'players' -> meu::text ->> 'investidor')::boolean, false))
     or (coalesce((est -> 'players' -> p_para::text ->> 'quebrado')::boolean, false)
         and not coalesce((est -> 'players' -> p_para::text ->> 'investidor')::boolean, false))
  then
    raise exception 'BANKRUPT';
  end if;

  -- teto de propostas abertas por pessoa: sem isso dá para afogar a mesa
  select count(*) into quantas
    from jsonb_array_elements(coalesce(est -> 'ofertas', '[]'::jsonb)) o
   where (o ->> 'de')::smallint = meu;
  if quantas >= 3 then raise exception 'TOO_MANY_OFFERS'; end if;

  erro := public.met_valida_lado(mapa, est, meu, p_da);
  if erro is not null then raise exception '%', erro; end if;
  erro := public.met_valida_lado(mapa, est, p_para, p_quer);
  if erro is not null then raise exception 'THEY_%', erro; end if;

  -- proposta vazia dos dois lados é ruído
  if p_da = '{}'::jsonb and p_quer = '{}'::jsonb then raise exception 'EMPTY_OFFER'; end if;

  cseq := coalesce((est ->> 'cSeq')::int, 0) + 1;
  est := jsonb_set(est, '{cSeq}', to_jsonb(cseq));
  est := jsonb_set(est, '{ofertas}',
    coalesce(est -> 'ofertas', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'id', 'o' || cseq, 'de', meu, 'para', p_para,
      'da', p_da, 'quer', p_quer,
      'rodada', coalesce((est ->> 'round')::int, 1))));
  est := public.met_log(est, jsonb_build_object(
    'k', 'proposta', 'de', meu, 'para', p_para));

  update public.matches set public_state = est, version = version + 1 where id = p_match;
  return public.met_publico(p_match);
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
    est := public.met_termina(p_match, est, ativos[1]);
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
    -- vencedor nulo: `met_termina` apura pelo patrimônio
    est := public.met_termina(p_match, est, null);
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
    est := public.met_termina(p_match, est, ativos[1]);
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

-- a assinatura de met_bid mudou: a de dois argumentos sai de cena
drop function if exists public.met_bid(uuid, int);

revoke all on function public.met_bid(uuid, int, smallint) from public, anon, authenticated;
grant execute on function public.met_bid(uuid, int, smallint) to authenticated;
revoke all on function public.met_fecha_leilao(jsonb) from public, anon, authenticated;
revoke all on function public.met_pousa(jsonb, jsonb, bigint, smallint, int, int) from public, anon, authenticated;
revoke all on function public.met_offer(uuid, smallint, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.met_offer(uuid, smallint, jsonb, jsonb) to authenticated;
revoke all on function public.met_end_turn(uuid) from public, anon, authenticated;
grant execute on function public.met_end_turn(uuid) to authenticated;
revoke all on function public.met_bankrupt(uuid) from public, anon, authenticated;
grant execute on function public.met_bankrupt(uuid) to authenticated;
revoke all on function public.met_sweep() from public, anon, authenticated;
