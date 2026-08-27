-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0027 · Metrópole, a volta no tabuleiro
--
-- Rolar, andar, resolver a casa, comprar ou recusar, passar a vez.
--
-- A REGRA DO DINHEIRO, escrita uma vez e obedecida em todo lugar:
--
--   Quem recebe é creditado IMEDIATAMENTE e pelo valor cheio. Quem paga vai
--   para o negativo se não tiver. Nunca existe um instante em que o dinheiro
--   saiu de um lado e não chegou no outro, e a soma de todo o dinheiro da mesa
--   é sempre a mesma depois de uma transferência entre jogadores.
--
--   Caixa negativo não é um bug: é uma DÍVIDA, e ela tranca o turno. Enquanto
--   estiver negativo, a pessoa só pode hipotecar, vender construção ou
--   declarar falência. É exatamente o que acontece na mesa quando alguém não
--   tem como pagar o aluguel — a diferença é que aqui o jogo não deixa
--   ninguém "esquecer" de resolver.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── o funil ────────────────────────────────────────────────────────────────

create or replace function public.met_na_vez(
  p_match uuid,
  out r_estado jsonb, out r_seed bigint, out r_seat smallint, out r_mapa jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  vivo text;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select m.public_state, m.seed, m.status into r_estado, r_seed, vivo
    from public.matches m where m.id = p_match for update;
  if not found then raise exception 'MATCH_NOT_FOUND'; end if;
  if vivo <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;

  select mp.seat into r_seat from public.match_players mp
   where mp.match_id = p_match and mp.user_id = auth.uid();
  if r_seat is null then raise exception 'NOT_A_PLAYER'; end if;

  if (r_estado ->> 'turnSeat')::smallint <> r_seat then
    raise exception 'NOT_YOUR_TURN';
  end if;

  select data into r_mapa from public.game_themes gt
   where gt.id = (r_estado ->> 'map');
end;
$$;

revoke all on function public.met_na_vez(uuid) from public, anon, authenticated;

/** O estado, para devolver ao cliente. Nada aqui é secreto por design. */
create or replace function public.met_publico(p_match uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', m.id, 'status', m.status,
    'turn_deadline', m.turn_deadline, 'version', m.version,
    'public_state', m.public_state
  ) from public.matches m where m.id = p_match;
$$;

revoke all on function public.met_publico(uuid) from public, anon, authenticated;

-- ── transferência ──────────────────────────────────────────────────────────

/**
 * Move dinheiro. `p_para` nulo é o banco (o dinheiro sai do jogo).
 *
 * Credita cheio e deixa o pagador negativo se preciso — ver o cabeçalho. A
 * dívida entra como pendência para trancar o turno de quem deve.
 */
create or replace function public.met_paga(
  p_est jsonb, p_de smallint, p_para smallint, p_valor int, p_motivo text
)
returns jsonb
language plpgsql
immutable
as $$
declare
  est   jsonb := p_est;
  tinha int;
begin
  if p_valor <= 0 then return est; end if;

  tinha := (est -> 'players' -> p_de::text ->> 'cash')::int;
  est := jsonb_set(est, array['players', p_de::text, 'cash'], to_jsonb(tinha - p_valor));

  if p_para is not null then
    est := jsonb_set(est, array['players', p_para::text, 'cash'],
      to_jsonb((est -> 'players' -> p_para::text ->> 'cash')::int + p_valor));
  end if;

  est := public.met_log(est, jsonb_build_object(
    'k', 'paga', 'de', p_de, 'para', p_para, 'valor', p_valor, 'motivo', p_motivo));

  if tinha - p_valor < 0 then
    /* QUEM DEVE, E QUANDO A FASE TRAVA.
       Uma carta de "pague a cada jogador" pode deixar NEGATIVO alguém que não
       está na vez. Se a dívida dele virasse `pendente`, ela sequestraria a
       fase do turno de outra pessoa — e o jogo pararia esperando uma ação que
       o dono da vez não pode tomar.

       Então: a lista `devedores` é pública e vale para todos; a `pendente`
       que TRANCA a fase é só a de quem está na vez. Quem ficou devendo fora
       da vez resolve no próprio turno, e até lá o negativo fica visível na
       mesa — que é a informação que importa para quem vai negociar. */
    est := jsonb_set(est, '{devedores}', (
      select coalesce(jsonb_agg(distinct d), '[]'::jsonb)
        from jsonb_array_elements(
               coalesce(est -> 'devedores', '[]'::jsonb) || to_jsonb(p_de)) d
    ));

    if (est ->> 'turnSeat')::smallint = p_de then
      est := jsonb_set(est, '{pendente}', jsonb_build_object(
        'k', 'divida', 'quanto', -(tinha - p_valor), 'para', p_para, 'motivo', p_motivo));
      est := jsonb_set(est, '{phase}', '"resolve"');
    end if;
  end if;

  return est;
end;
$$;

revoke all on function public.met_paga(jsonb, smallint, smallint, int, text) from public, anon, authenticated;

/** Vai preso: posição 10, contador em 1, e os duplos zeram. */
create or replace function public.met_prende(p_est jsonb, p_seat smallint)
returns jsonb
language sql
immutable
as $$
  select public.met_log(
    jsonb_set(
      jsonb_set(
        jsonb_set(p_est, array['players', p_seat::text, 'pos'], '10'::jsonb),
        array['players', p_seat::text, 'jail'], '1'::jsonb),
      '{duplos}', '0'::jsonb),
    jsonb_build_object('k', 'cadeia', 'seat', p_seat));
$$;

revoke all on function public.met_prende(jsonb, smallint) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- A CASA ONDE VOCÊ PARA
--
-- Uma função só, usada pela rolagem E pelas cartas que mandam andar. Duas
-- resoluções separadas viveriam divergindo, e a segunda seria a errada.
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

revoke all on function public.met_pousa(jsonb, jsonb, bigint, smallint, int, int) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLAR
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.met_roll(p_match uuid)
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
  rolls   bigint;
  d1      int;
  d2      int;
  duplos  int;
  pos     int;
  nova    int;
  salario int;
begin
  select * into est, semente, meu, mapa from public.met_na_vez(p_match);

  if est ->> 'phase' <> 'rolar' then raise exception 'WRONG_PHASE'; end if;
  if est -> 'pendente' is not null and est -> 'pendente' <> 'null'::jsonb then
    raise exception 'RESOLVE_FIRST';
  end if;
  if coalesce((est -> 'players' -> meu::text ->> 'jail')::int, 0) > 0 then
    raise exception 'IN_JAIL';
  end if;

  salario := (mapa -> 'regras' ->> 'salario')::int;
  rolls := coalesce((est ->> 'rolls')::bigint, 0);
  d1 := public.dominio_dado(semente, rolls);
  d2 := public.dominio_dado(semente, rolls + 1);
  est := jsonb_set(est, '{rolls}', to_jsonb(rolls + 2));
  est := jsonb_set(est, '{dados}', jsonb_build_array(d1, d2));

  duplos := coalesce((est ->> 'duplos')::int, 0);
  if d1 = d2 then
    duplos := duplos + 1;
  else
    duplos := 0;
  end if;
  est := jsonb_set(est, '{duplos}', to_jsonb(duplos));

  /* TRÊS DUPLOS SEGUIDOS VÃO PARA A CADEIA. A regra existe no jogo de mesa
     para que a sorte de tirar duplo não vire volta infinita — e ela é o único
     lugar do Banco Imobiliário onde tirar um bom dado é ruim. */
  if duplos >= 3 then
    est := public.met_prende(est, meu);
    est := jsonb_set(est, '{phase}', '"acao"');
    est := public.met_log(est, jsonb_build_object('k', 'tres-duplos', 'seat', meu));
    update public.matches set public_state = est, version = version + 1,
           turn_deadline = now() + interval '90 seconds'
     where id = p_match;
    return public.met_publico(p_match);
  end if;

  pos := (est -> 'players' -> meu::text ->> 'pos')::int;
  nova := (pos + d1 + d2) % 40;
  est := jsonb_set(est, array['players', meu::text, 'pos'], to_jsonb(nova));

  -- passou pela Largada
  if nova < pos then
    est := jsonb_set(est, array['players', meu::text, 'cash'],
      to_jsonb((est -> 'players' -> meu::text ->> 'cash')::int + salario));
    est := public.met_log(est, jsonb_build_object('k', 'largada', 'seat', meu));
  end if;

  est := public.met_log(est, jsonb_build_object(
    'k', 'anda', 'seat', meu, 'd', jsonb_build_array(d1, d2), 'para', nova));

  est := public.met_pousa(mapa, est, semente, meu, d1 + d2, 0);

  -- sem pendência: duplo rola de novo, o resto vai para a fase de ação
  if est -> 'pendente' is null or est -> 'pendente' = 'null'::jsonb then
    if duplos > 0 and coalesce((est -> 'players' -> meu::text ->> 'jail')::int, 0) = 0 then
      est := jsonb_set(est, '{phase}', '"rolar"');
    else
      est := jsonb_set(est, '{phase}', '"acao"');
    end if;
  end if;

  update public.matches set public_state = est, version = version + 1,
         turn_deadline = now() + interval '90 seconds'
   where id = p_match;

  return public.met_publico(p_match);
end;
$$;

revoke all on function public.met_roll(uuid) from public, anon, authenticated;
grant execute on function public.met_roll(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- COMPRAR, OU DEIXAR IR A LEILÃO
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.met_buy(p_match uuid)
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
  pend    jsonb;
  preco   int;
begin
  select * into est, semente, meu, mapa from public.met_na_vez(p_match);

  pend := est -> 'pendente';
  if pend is null or pend = 'null'::jsonb or pend ->> 'k' <> 'comprar' then
    raise exception 'NOTHING_TO_BUY';
  end if;
  preco := (pend ->> 'preco')::int;
  if (est -> 'players' -> meu::text ->> 'cash')::int < preco then
    raise exception 'NOT_ENOUGH_CASH';
  end if;

  est := public.met_paga(est, meu, null, preco, 'compra:' || (pend ->> 'prop'));
  est := jsonb_set(est, array['props', pend ->> 'prop', 'owner'], to_jsonb(meu));
  est := public.met_log(est, jsonb_build_object(
    'k', 'compra', 'seat', meu, 'prop', pend ->> 'prop', 'valor', preco));
  est := jsonb_set(est, '{pendente}', 'null'::jsonb);
  est := jsonb_set(est, '{phase}',
    case when coalesce((est ->> 'duplos')::int, 0) > 0 then '"rolar"'::jsonb else '"acao"'::jsonb end);

  update public.matches set public_state = est, version = version + 1,
         turn_deadline = now() + interval '90 seconds'
   where id = p_match;
  return public.met_publico(p_match);
end;
$$;

revoke all on function public.met_buy(uuid) from public, anon, authenticated;
grant execute on function public.met_buy(uuid) to authenticated;

/**
 * Recusou? Vai a LEILÃO, e o leilão é aberto a todos — inclusive a quem
 * recusou.
 *
 * É a regra oficial que praticamente nenhuma mesa aplica, porque no papel o
 * leilão é lento e confuso. Digitalmente leva vinte segundos, e é o que
 * conserta a fase de aquisição: o tabuleiro se distribui em ~6 rodadas em vez
 * de 15, você participa do turno dos outros, e o preço de cada grupo aparece
 * na cara de quem dá lance. Ver docs/05-PRD-METROPOLE.md §5.1.
 */
create or replace function public.met_decline(p_match uuid)
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
  pend    jsonb;
  semLeilao boolean;
begin
  select * into est, semente, meu, mapa from public.met_na_vez(p_match);

  pend := est -> 'pendente';
  if pend is null or pend = 'null'::jsonb or pend ->> 'k' <> 'comprar' then
    raise exception 'NOTHING_TO_DECLINE';
  end if;

  select coalesce((r.settings ->> 'semLeilao')::boolean, false) into semLeilao
    from public.rooms r
    join public.matches m on m.room_id = r.id
   where m.id = p_match;

  est := jsonb_set(est, '{pendente}', 'null'::jsonb);

  if semLeilao then
    -- regra da casa: sem leilão, a propriedade volta ao banco
    est := public.met_log(est, jsonb_build_object(
      'k', 'recusa', 'seat', meu, 'prop', pend ->> 'prop'));
    est := jsonb_set(est, '{phase}',
      case when coalesce((est ->> 'duplos')::int, 0) > 0 then '"rolar"'::jsonb else '"acao"'::jsonb end);
  else
    est := jsonb_set(est, '{leilao}', jsonb_build_object(
      'prop', pend ->> 'prop',
      'alto', 0,
      'altoSeat', null,
      'passou', '[]'::jsonb,
      'abriuSeat', meu));
    est := jsonb_set(est, '{phase}', '"leilao"');
    est := public.met_log(est, jsonb_build_object(
      'k', 'leilao-abre', 'seat', meu, 'prop', pend ->> 'prop'));
  end if;

  update public.matches set public_state = est, version = version + 1,
         turn_deadline = now() + interval '40 seconds'
   where id = p_match;
  return public.met_publico(p_match);
end;
$$;

revoke all on function public.met_decline(uuid) from public, anon, authenticated;
grant execute on function public.met_decline(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- PASSAR A VEZ
-- ═══════════════════════════════════════════════════════════════════════════

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

  /* Quem entra na vez DEVENDO (porque uma carta o pegou fora do turno) entra
     na fase de resolver, não de rolar. Sem isso a dívida atravessaria a
     partida inteira sem nunca trancar nada. */
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

revoke all on function public.met_end_turn(uuid) from public, anon, authenticated;
grant execute on function public.met_end_turn(uuid) to authenticated;

/** XP e medalha da Metrópole. */
create or replace function public.met_premia(p_match uuid, p_vencedor smallint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  linha record;
begin
  for linha in
    select mp.user_id, mp.seat from public.match_players mp where mp.match_id = p_match
  loop
    if linha.seat = p_vencedor then
      perform public.dar_xp(linha.user_id, 100,
        jsonb_build_object('partidas', 1, 'vitorias', 1), array['prefeito']);
    else
      perform public.dar_xp(linha.user_id, 25, jsonb_build_object('partidas', 1), '{}'::text[]);
    end if;
  end loop;
end;
$$;

revoke all on function public.met_premia(uuid, smallint) from public, anon, authenticated;
