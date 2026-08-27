-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0028 · Metrópole: leilão, construção, hipoteca, cadeia, falência
--
-- É o que destrava o jogo. Sem estas funções a partida para na primeira
-- propriedade recusada e na primeira dívida.
--
-- O LEILÃO é a única ação do projeto que NÃO passa por "é a sua vez". Ele
-- acontece no turno de outra pessoa, e é de propósito: é o que faz o turno
-- alheio ter decisão. Toda a validação dele é por isso um pouco diferente das
-- outras — quem chama não precisa estar na vez, precisa estar VIVO na partida.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── quem sou eu nesta partida (sem exigir a vez) ───────────────────────────

create or replace function public.met_sou(
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

  select data into r_mapa from public.game_themes gt where gt.id = (r_estado ->> 'map');
end;
$$;

revoke all on function public.met_sou(uuid) from public, anon, authenticated;

-- ── o leilão ───────────────────────────────────────────────────────────────

/** Devolve a fase para o dono da vez depois de um leilão ou de uma pendência. */
create or replace function public.met_volta_fase(p_est jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_set(
    jsonb_set(p_est, '{leilao}', 'null'::jsonb),
    '{phase}',
    case when coalesce((p_est ->> 'duplos')::int, 0) > 0
         then '"rolar"'::jsonb else '"acao"'::jsonb end);
$$;

revoke all on function public.met_volta_fase(jsonb) from public, anon, authenticated;

/** Fecha o leilão: quem tiver o lance mais alto paga e leva. */
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
    est := jsonb_set(est, array['props', lei ->> 'prop', 'owner'], to_jsonb(quem));
    est := public.met_log(est, jsonb_build_object(
      'k', 'leilao-fecha', 'seat', quem, 'prop', lei ->> 'prop', 'valor', vale));
  end if;

  return public.met_volta_fase(est);
end;
$$;

revoke all on function public.met_fecha_leilao(jsonb) from public, anon, authenticated;

/**
 * Dar lance. Qualquer jogador vivo, inclusive quem recusou a compra.
 *
 * Um lance novo REABRE o leilão para todos: a lista de quem passou é zerada.
 * Sem isso, quem passou cedo ficaria fora de um leilão que subiu de patamar
 * depois — e passar viraria uma armadilha em vez de uma escolha.
 */
create or replace function public.met_bid(p_match uuid, p_valor int)
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
  if coalesce((est -> 'players' -> meu::text ->> 'quebrado')::boolean, false) then
    raise exception 'BANKRUPT';
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
  est := public.met_log(est, jsonb_build_object(
    'k', 'lance', 'seat', meu, 'prop', lei ->> 'prop', 'valor', p_valor));

  -- o relógio reinicia a cada lance: leilão termina quando para de subir
  update public.matches set public_state = est, version = version + 1,
         turn_deadline = now() + interval '20 seconds'
   where id = p_match;
  return public.met_publico(p_match);
end;
$$;

revoke all on function public.met_bid(uuid, int) from public, anon, authenticated;
grant execute on function public.met_bid(uuid, int) to authenticated;

/** Passar no leilão. Quando todos passam, fecha na hora — sem esperar relógio. */
create or replace function public.met_pass(p_match uuid)
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
  faltam  int;
begin
  select * into est, semente, meu, mapa from public.met_sou(p_match);
  if est ->> 'phase' <> 'leilao' then raise exception 'NO_AUCTION'; end if;

  est := jsonb_set(est, array['leilao', 'passou'], (
    select coalesce(jsonb_agg(distinct d), '[]'::jsonb)
      from jsonb_array_elements(
             coalesce(est -> 'leilao' -> 'passou', '[]'::jsonb) || to_jsonb(meu)) d
  ));

  -- quantos ainda podem dar lance, tirando quem já lidera
  select count(*) into faltam
    from jsonb_each(est -> 'players') e(k, v)
   where not coalesce((v ->> 'quebrado')::boolean, false)
     and not (est -> 'leilao' -> 'passou' @> to_jsonb(k::smallint))
     and coalesce((est -> 'leilao' ->> 'altoSeat')::smallint, -1) <> k::smallint;

  if faltam = 0 then
    est := public.met_fecha_leilao(est);
    update public.matches set public_state = est, version = version + 1,
           turn_deadline = now() + interval '90 seconds'
     where id = p_match;
  else
    update public.matches set public_state = est, version = version + 1
     where id = p_match;
  end if;

  return public.met_publico(p_match);
end;
$$;

revoke all on function public.met_pass(uuid) from public, anon, authenticated;
grant execute on function public.met_pass(uuid) to authenticated;

-- ── construir ──────────────────────────────────────────────────────────────

/**
 * Construir casas, virando hotel na quinta.
 *
 * As quatro travas, e cada uma existe por um motivo de jogo:
 *
 *   grupo completo   — construir sem monopólio tiraria a razão de negociar
 *   nada hipotecado  — propriedade hipotecada não rende, logo não constrói
 *   construção par   — diferença máxima de uma casa dentro do grupo. É o que
 *                      impede empilhar cinco casas na propriedade mais visitada
 *                      e ignorar as outras duas
 *   casas no banco   — 32 casas para 22 bairros, e acabou. Segurar casa para
 *                      sufocar a construção alheia é jogada legítima, e quase
 *                      toda versão digital joga essa camada fora
 */
create or replace function public.met_build(p_match uuid, p_prop text, p_n int)
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
  casa    jsonb;
  grupo   text;
  custo   int;
  i       int;
  tem     int;
  menor   int;
  hoteis  int;
  casasB  int;
begin
  select * into est, semente, meu, mapa from public.met_na_vez(p_match);

  if est ->> 'phase' not in ('rolar', 'acao') then raise exception 'WRONG_PHASE'; end if;
  if est -> 'pendente' is not null and est -> 'pendente' <> 'null'::jsonb then
    raise exception 'RESOLVE_FIRST';
  end if;
  if p_n < 1 or p_n > 5 then raise exception 'BAD_AMOUNT'; end if;

  select c into casa from jsonb_array_elements(mapa -> 'casas') c
   where c ->> 'id' = p_prop limit 1;
  if casa is null or casa ->> 't' <> 'bairro' then raise exception 'NOT_A_NEIGHBOURHOOD'; end if;
  if (est -> 'props' -> p_prop ->> 'owner')::smallint <> meu then raise exception 'NOT_YOURS'; end if;

  grupo := casa ->> 'g';
  if not public.met_grupo_completo(mapa, est, meu, grupo) then
    raise exception 'GROUP_INCOMPLETE';
  end if;
  if exists (
    select 1 from jsonb_array_elements(mapa -> 'casas') c
     where c ->> 'g' = grupo
       and coalesce((est -> 'props' -> (c ->> 'id') ->> 'hipotecada')::boolean, false)
  ) then
    raise exception 'GROUP_MORTGAGED';
  end if;

  custo := (casa ->> 'casa')::int * p_n;
  if (est -> 'players' -> meu::text ->> 'cash')::int < custo then
    raise exception 'NOT_ENOUGH_CASH';
  end if;

  for i in 1..p_n loop
    if coalesce((est -> 'props' -> p_prop ->> 'hotel')::boolean, false) then
      raise exception 'ALREADY_HOTEL';
    end if;
    tem := coalesce((est -> 'props' -> p_prop ->> 'casas')::int, 0);

    -- construção par: ninguém sai na frente por mais de uma casa
    select min(
             case when coalesce((est -> 'props' -> (c ->> 'id') ->> 'hotel')::boolean, false)
                  then 5
                  else coalesce((est -> 'props' -> (c ->> 'id') ->> 'casas')::int, 0) end)
      into menor
      from jsonb_array_elements(mapa -> 'casas') c
     where c ->> 'g' = grupo;
    if tem > menor then raise exception 'BUILD_UNEVEN'; end if;

    if tem = 4 then
      -- a quinta casa é um hotel: as quatro voltam para o banco
      hoteis := (est -> 'bank' ->> 'hoteis')::int;
      if hoteis < 1 then raise exception 'NO_HOTELS_LEFT'; end if;
      est := jsonb_set(est, array['bank', 'hoteis'], to_jsonb(hoteis - 1));
      est := jsonb_set(est, array['bank', 'casas'],
        to_jsonb((est -> 'bank' ->> 'casas')::int + 4));
      est := jsonb_set(est, array['props', p_prop, 'casas'], '0'::jsonb);
      est := jsonb_set(est, array['props', p_prop, 'hotel'], 'true'::jsonb);
    else
      casasB := (est -> 'bank' ->> 'casas')::int;
      if casasB < 1 then raise exception 'NO_HOUSES_LEFT'; end if;
      est := jsonb_set(est, array['bank', 'casas'], to_jsonb(casasB - 1));
      est := jsonb_set(est, array['props', p_prop, 'casas'], to_jsonb(tem + 1));
    end if;
  end loop;

  est := public.met_paga(est, meu, null, custo, 'constroi:' || p_prop);
  est := public.met_log(est, jsonb_build_object(
    'k', 'constroi', 'seat', meu, 'prop', p_prop, 'n', p_n, 'valor', custo));

  update public.matches set public_state = est, version = version + 1 where id = p_match;
  return public.met_publico(p_match);
end;
$$;

revoke all on function public.met_build(uuid, text, int) from public, anon, authenticated;
grant execute on function public.met_build(uuid, text, int) to authenticated;

/** Vender construção ao banco, pela metade. É o primeiro socorro de quem deve. */
create or replace function public.met_sell(p_match uuid, p_prop text, p_n int)
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
  casa    jsonb;
  grupo   text;
  volta   int := 0;
  i       int;
  tem     int;
  maior   int;
begin
  select * into est, semente, meu, mapa from public.met_na_vez(p_match);
  if p_n < 1 or p_n > 5 then raise exception 'BAD_AMOUNT'; end if;

  select c into casa from jsonb_array_elements(mapa -> 'casas') c
   where c ->> 'id' = p_prop limit 1;
  if casa is null or casa ->> 't' <> 'bairro' then raise exception 'NOT_A_NEIGHBOURHOOD'; end if;
  if (est -> 'props' -> p_prop ->> 'owner')::smallint <> meu then raise exception 'NOT_YOURS'; end if;
  grupo := casa ->> 'g';

  for i in 1..p_n loop
    if coalesce((est -> 'props' -> p_prop ->> 'hotel')::boolean, false) then
      -- desfaz o hotel: precisa haver quatro casas no banco para repor
      if (est -> 'bank' ->> 'casas')::int < 4 then raise exception 'NO_HOUSES_LEFT'; end if;
      est := jsonb_set(est, array['bank', 'casas'],
        to_jsonb((est -> 'bank' ->> 'casas')::int - 4));
      est := jsonb_set(est, array['bank', 'hoteis'],
        to_jsonb((est -> 'bank' ->> 'hoteis')::int + 1));
      est := jsonb_set(est, array['props', p_prop, 'hotel'], 'false'::jsonb);
      est := jsonb_set(est, array['props', p_prop, 'casas'], '4'::jsonb);
      volta := volta + (casa ->> 'casa')::int / 2;
      continue;
    end if;

    tem := coalesce((est -> 'props' -> p_prop ->> 'casas')::int, 0);
    if tem = 0 then raise exception 'NOTHING_TO_SELL'; end if;

    -- a desconstrução também é par
    select max(
             case when coalesce((est -> 'props' -> (c ->> 'id') ->> 'hotel')::boolean, false)
                  then 5
                  else coalesce((est -> 'props' -> (c ->> 'id') ->> 'casas')::int, 0) end)
      into maior
      from jsonb_array_elements(mapa -> 'casas') c
     where c ->> 'g' = grupo;
    if tem < maior then raise exception 'SELL_UNEVEN'; end if;

    est := jsonb_set(est, array['props', p_prop, 'casas'], to_jsonb(tem - 1));
    est := jsonb_set(est, array['bank', 'casas'],
      to_jsonb((est -> 'bank' ->> 'casas')::int + 1));
    volta := volta + (casa ->> 'casa')::int / 2;
  end loop;

  est := jsonb_set(est, array['players', meu::text, 'cash'],
    to_jsonb((est -> 'players' -> meu::text ->> 'cash')::int + volta));
  est := public.met_log(est, jsonb_build_object(
    'k', 'vende-casa', 'seat', meu, 'prop', p_prop, 'n', p_n, 'valor', volta));
  est := public.met_confere_divida(est, meu);

  update public.matches set public_state = est, version = version + 1 where id = p_match;
  return public.met_publico(p_match);
end;
$$;

revoke all on function public.met_sell(uuid, text, int) from public, anon, authenticated;
grant execute on function public.met_sell(uuid, text, int) to authenticated;

-- ── hipoteca ───────────────────────────────────────────────────────────────

/** A dívida ainda existe? Se o caixa voltou ao positivo, a pendência sai. */
create or replace function public.met_confere_divida(p_est jsonb, p_seat smallint)
returns jsonb
language plpgsql
immutable
as $$
declare
  est jsonb := p_est;
begin
  if (est -> 'players' -> p_seat::text ->> 'cash')::int >= 0 then
    est := jsonb_set(est, '{devedores}', (
      select coalesce(jsonb_agg(d), '[]'::jsonb)
        from jsonb_array_elements(coalesce(est -> 'devedores', '[]'::jsonb)) d
       where d <> to_jsonb(p_seat)
    ));
    if est -> 'pendente' ->> 'k' = 'divida'
       and (est ->> 'turnSeat')::smallint = p_seat then
      est := jsonb_set(est, '{pendente}', 'null'::jsonb);
      est := jsonb_set(est, '{phase}',
        case when coalesce((est ->> 'duplos')::int, 0) > 0
             then '"rolar"'::jsonb else '"acao"'::jsonb end);
    end if;
  end if;
  return est;
end;
$$;

revoke all on function public.met_confere_divida(jsonb, smallint) from public, anon, authenticated;

create or replace function public.met_mortgage(p_match uuid, p_prop text)
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
  casa    jsonb;
begin
  select * into est, semente, meu, mapa from public.met_na_vez(p_match);

  select c into casa from jsonb_array_elements(mapa -> 'casas') c
   where c ->> 'id' = p_prop limit 1;
  if casa is null then raise exception 'NO_SUCH_PROPERTY'; end if;
  if (est -> 'props' -> p_prop ->> 'owner')::smallint <> meu then raise exception 'NOT_YOURS'; end if;
  if coalesce((est -> 'props' -> p_prop ->> 'hipotecada')::boolean, false) then
    raise exception 'ALREADY_MORTGAGED';
  end if;
  if coalesce((est -> 'props' -> p_prop ->> 'casas')::int, 0) > 0
     or coalesce((est -> 'props' -> p_prop ->> 'hotel')::boolean, false) then
    raise exception 'SELL_BUILDINGS_FIRST';
  end if;

  est := jsonb_set(est, array['props', p_prop, 'hipotecada'], 'true'::jsonb);
  est := jsonb_set(est, array['players', meu::text, 'cash'],
    to_jsonb((est -> 'players' -> meu::text ->> 'cash')::int + (casa ->> 'hipoteca')::int));
  est := public.met_log(est, jsonb_build_object(
    'k', 'hipoteca', 'seat', meu, 'prop', p_prop, 'valor', (casa ->> 'hipoteca')::int));
  est := public.met_confere_divida(est, meu);

  update public.matches set public_state = est, version = version + 1 where id = p_match;
  return public.met_publico(p_match);
end;
$$;

revoke all on function public.met_mortgage(uuid, text) from public, anon, authenticated;
grant execute on function public.met_mortgage(uuid, text) to authenticated;

/** Resgatar: paga a hipoteca mais dez por cento. Os juros são o custo do ar. */
create or replace function public.met_unmortgage(p_match uuid, p_prop text)
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
  casa    jsonb;
  quanto  int;
begin
  select * into est, semente, meu, mapa from public.met_na_vez(p_match);

  select c into casa from jsonb_array_elements(mapa -> 'casas') c
   where c ->> 'id' = p_prop limit 1;
  if casa is null then raise exception 'NO_SUCH_PROPERTY'; end if;
  if (est -> 'props' -> p_prop ->> 'owner')::smallint <> meu then raise exception 'NOT_YOURS'; end if;
  if not coalesce((est -> 'props' -> p_prop ->> 'hipotecada')::boolean, false) then
    raise exception 'NOT_MORTGAGED';
  end if;

  quanto := ceil((casa ->> 'hipoteca')::numeric
                 * (1 + (mapa -> 'regras' ->> 'jurosResgate')::numeric))::int;
  if (est -> 'players' -> meu::text ->> 'cash')::int < quanto then
    raise exception 'NOT_ENOUGH_CASH';
  end if;

  est := public.met_paga(est, meu, null, quanto, 'resgate:' || p_prop);
  est := jsonb_set(est, array['props', p_prop, 'hipotecada'], 'false'::jsonb);
  est := public.met_log(est, jsonb_build_object(
    'k', 'resgate', 'seat', meu, 'prop', p_prop, 'valor', quanto));

  update public.matches set public_state = est, version = version + 1 where id = p_match;
  return public.met_publico(p_match);
end;
$$;

revoke all on function public.met_unmortgage(uuid, text) from public, anon, authenticated;
grant execute on function public.met_unmortgage(uuid, text) to authenticated;

-- ── a cadeia ───────────────────────────────────────────────────────────────

/**
 * Sair da cadeia: pagar, usar a carta, ou tentar o duplo.
 *
 * A terceira tentativa falhada NÃO deixa ninguém preso para sempre: paga a
 * fiança e anda. É a regra do tabuleiro, e é o que impede que a cadeia vire um
 * buraco onde a partida some.
 *
 * No fim do jogo, ficar preso é BOM: você não anda, logo não paga aluguel de
 * hotel de ninguém. Por isso "tentar o duplo" é uma escolha de verdade, e não
 * um imposto — e por isso o painel de patrimônio mostra a conta.
 */
create or replace function public.met_jail(p_match uuid, p_escolha text)
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
  preso   int;
  fianca  int;
  rolls   bigint;
  d1      int;
  d2      int;
  pos     int;
  nova    int;
begin
  select * into est, semente, meu, mapa from public.met_na_vez(p_match);

  preso := coalesce((est -> 'players' -> meu::text ->> 'jail')::int, 0);
  if preso = 0 then raise exception 'NOT_IN_JAIL'; end if;
  if est ->> 'phase' <> 'rolar' then raise exception 'WRONG_PHASE'; end if;
  if p_escolha not in ('pagar', 'carta', 'dado') then raise exception 'BAD_CHOICE'; end if;

  fianca := (mapa -> 'regras' ->> 'fiancaCadeia')::int;

  if p_escolha = 'pagar' then
    if (est -> 'players' -> meu::text ->> 'cash')::int < fianca then
      raise exception 'NOT_ENOUGH_CASH';
    end if;
    est := public.met_paga(est, meu, null, fianca, 'fianca');
    est := jsonb_set(est, array['players', meu::text, 'jail'], '0'::jsonb);
    est := public.met_log(est, jsonb_build_object('k', 'fianca', 'seat', meu));

  elsif p_escolha = 'carta' then
    if coalesce((est -> 'players' -> meu::text ->> 'livras')::int, 0) < 1 then
      raise exception 'NO_CARD';
    end if;
    est := jsonb_set(est, array['players', meu::text, 'livras'],
      to_jsonb((est -> 'players' -> meu::text ->> 'livras')::int - 1));
    est := jsonb_set(est, array['players', meu::text, 'jail'], '0'::jsonb);
    est := public.met_log(est, jsonb_build_object('k', 'livra', 'seat', meu));

  else
    rolls := coalesce((est ->> 'rolls')::bigint, 0);
    d1 := public.dominio_dado(semente, rolls);
    d2 := public.dominio_dado(semente, rolls + 1);
    est := jsonb_set(est, '{rolls}', to_jsonb(rolls + 2));
    est := jsonb_set(est, '{dados}', jsonb_build_array(d1, d2));

    if d1 = d2 then
      est := jsonb_set(est, array['players', meu::text, 'jail'], '0'::jsonb);
      est := public.met_log(est, jsonb_build_object(
        'k', 'duplo-livra', 'seat', meu, 'd', jsonb_build_array(d1, d2)));
      pos := (est -> 'players' -> meu::text ->> 'pos')::int;
      nova := (pos + d1 + d2) % 40;
      est := jsonb_set(est, array['players', meu::text, 'pos'], to_jsonb(nova));
      est := public.met_pousa(mapa, est, semente, meu, d1 + d2, 0);
      -- duplo tirado na cadeia NÃO dá direito a rolar de novo
      if est -> 'pendente' is null or est -> 'pendente' = 'null'::jsonb then
        est := jsonb_set(est, '{phase}', '"acao"');
      end if;
      update public.matches set public_state = est, version = version + 1,
             turn_deadline = now() + interval '90 seconds'
       where id = p_match;
      return public.met_publico(p_match);
    end if;

    if preso >= 3 then
      -- terceira falha: paga e anda. Ninguém fica preso para sempre.
      est := public.met_paga(est, meu, null, fianca, 'fianca-forcada');
      est := jsonb_set(est, array['players', meu::text, 'jail'], '0'::jsonb);
      pos := (est -> 'players' -> meu::text ->> 'pos')::int;
      nova := (pos + d1 + d2) % 40;
      est := jsonb_set(est, array['players', meu::text, 'pos'], to_jsonb(nova));
      est := public.met_pousa(mapa, est, semente, meu, d1 + d2, 0);
      if est -> 'pendente' is null or est -> 'pendente' = 'null'::jsonb then
        est := jsonb_set(est, '{phase}', '"acao"');
      end if;
      est := public.met_log(est, jsonb_build_object('k', 'fianca-forcada', 'seat', meu));
      update public.matches set public_state = est, version = version + 1,
             turn_deadline = now() + interval '90 seconds'
       where id = p_match;
      return public.met_publico(p_match);
    end if;

    -- falhou e ainda tem tentativa: o turno acaba aqui, preso
    est := jsonb_set(est, array['players', meu::text, 'jail'], to_jsonb(preso + 1));
    est := jsonb_set(est, '{phase}', '"acao"');
    est := public.met_log(est, jsonb_build_object(
      'k', 'tenta-duplo', 'seat', meu, 'd', jsonb_build_array(d1, d2), 'n', preso));
  end if;

  update public.matches set public_state = est, version = version + 1,
         turn_deadline = now() + interval '90 seconds'
   where id = p_match;
  return public.met_publico(p_match);
end;
$$;

revoke all on function public.met_jail(uuid, text) from public, anon, authenticated;
grant execute on function public.met_jail(uuid, text) to authenticated;

-- ── falência ───────────────────────────────────────────────────────────────

/**
 * Quebrar.
 *
 * No modo Clássico, elimina — e quem quebra assiste. É o pior problema do
 * Banco Imobiliário, e o modo existe só para quem quer a experiência original.
 *
 * Nos modos Metrópole e Relâmpago, quem quebra vira INVESTIDOR: recebe 10% do
 * patrimônio líquido que tinha, não possui nada, não anda pelo tabuleiro, e
 * continua dando lance em todo leilão. Não pode vencer, mas todo mundo precisa
 * falar com ele. É o oposto de assistir.
 * Ver docs/05-PRD-METROPOLE.md §5.5.
 *
 * As propriedades voltam para o banco e podem ser compradas de novo — em vez
 * de saírem do jogo, que é o que congela o tabuleiro no fim da partida.
 */
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

revoke all on function public.met_bankrupt(uuid) from public, anon, authenticated;
grant execute on function public.met_bankrupt(uuid) to authenticated;

-- ── faxina ─────────────────────────────────────────────────────────────────

/**
 * O relógio resolve o que a pessoa não resolveu.
 *
 * Quatro casos, e cada um faz a coisa MENOS destrutiva possível:
 *
 *   leilão aberto   → fecha no lance mais alto. Já é o resultado correto.
 *   comprar         → conta como recusa, e vai a leilão. Quem sumiu não dá
 *                     lance, então a propriedade fica com quem está jogando.
 *   dívida          → hipoteca sozinho, da propriedade mais barata para a mais
 *                     cara, até cobrir. É o que um amigo faria por você. Se
 *                     nem hipotecando tudo cobre, quebra.
 *   rolar / ação    → passa a vez.
 *
 * Sem isso, uma aba fechada no meio de um leilão congela a partida para todo
 * mundo — e "esperar alguém que não vai voltar" é o pior jeito de terminar uma
 * noite de jogo.
 */
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
    est := linha.public_state;
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

revoke all on function public.met_sweep() from public, anon, authenticated;

select cron.schedule('met-sweep', '* * * * *', $cron$select public.met_sweep();$cron$)
where not exists (select 1 from cron.job where jobname = 'met-sweep');
