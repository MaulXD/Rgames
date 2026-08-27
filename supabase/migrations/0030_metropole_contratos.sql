-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0030 · Metrópole: a mesa de negociação e os contratos executáveis
--
-- ISTO É O QUE A VERSÃO DIGITAL PODE FAZER E A DE PAPEL NÃO PODE.
--
-- Num Banco Imobiliário de mesa, "te pago R$ 500 por rodada durante seis
-- rodadas" é um acordo que depende de todo mundo lembrar, toda rodada, por
-- meia hora. Ninguém lembra. Então a negociação de papel se reduz a troca à
-- vista — dinheiro e escritura, agora — e some toda a economia interessante:
-- crédito, seguro, opção de compra.
--
-- Aqui o servidor é o cartório. Ele debita a parcela no início do turno do
-- devedor, aplica a isenção de aluguel sem ninguém pedir, e deixa a opção de
-- compra valendo até a rodada combinada. O acordo VALE.
--
-- Ver docs/05-PRD-METROPOLE.md §5.2.
--
-- OS TRÊS TIPOS DE CONTRATO, e o que cada um constrange:
--
--   parcela  — `de` paga `valor` a `para`, toda rodada, por `rodadas` rodadas
--   isencao  — `de` não cobra aluguel de `para` em `props` (nulo = em nada),
--              por `rodadas` rodadas
--   opcao    — `para` pode comprar `props[1]` de `de` por `valor` até a
--              rodada `ate`
--
-- Cada contrato conta o tempo no turno de QUEM ELE CONSTRANGE: a parcela
-- decrementa no turno do devedor (é ele quem paga), a isenção no turno de quem
-- é isentado (é ele quem consome o benefício). Assim "seis rodadas" significa
-- seis turnos seus, o que é o que a pessoa entende ao combinar.
--
-- E UMA REGRA DE FALÊNCIA que o critério de aceite pede explicitamente:
-- contrato SOBREVIVE à falência do credor. Quem quebrou vira Investidor e
-- continua recebendo — porque a dívida é de quem deve, e o fato de o credor
-- ter quebrado não perdoa ninguém. Já a parcela DEVIDA por quem quebrou
-- morre: não se cobra de quem não tem nada.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── normalização: as chaves novas entram no primeiro toque ─────────────────

/**
 * As três chaves que esta migração acrescenta ao estado.
 *
 * Fica numa função só porque DOIS funis levam ao estado da Metrópole:
 * `met_na_vez` (ações do turno) e `met_sou` (leilão e negociação, que
 * acontecem fora da vez). Se a normalização morasse num só, uma proposta
 * feita antes da primeira rolagem quebraria.
 */
create or replace function public.met_normaliza(p_est jsonb)
returns jsonb
language sql
immutable
as $$
  select case
    when p_est @> jsonb_build_object(
           'ofertas',   coalesce(p_est -> 'ofertas', '[]'::jsonb),
           'contratos', coalesce(p_est -> 'contratos', '[]'::jsonb),
           'cSeq',      coalesce(p_est -> 'cSeq', '0'::jsonb))
    then p_est
    else jsonb_build_object(
           'ofertas',   coalesce(p_est -> 'ofertas', '[]'::jsonb),
           'contratos', coalesce(p_est -> 'contratos', '[]'::jsonb),
           'cSeq',      coalesce(p_est -> 'cSeq', '0'::jsonb)) || p_est
  end;
$$;

revoke all on function public.met_normaliza(jsonb) from public, anon, authenticated;

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
  cru  jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select m.public_state, m.seed, m.status into cru, r_seed, vivo
    from public.matches m where m.id = p_match for update;
  if not found then raise exception 'MATCH_NOT_FOUND'; end if;
  if vivo <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;

  select mp.seat into r_seat from public.match_players mp
   where mp.match_id = p_match and mp.user_id = auth.uid();
  if r_seat is null then raise exception 'NOT_A_PLAYER'; end if;

  if (cru ->> 'turnSeat')::smallint <> r_seat then
    raise exception 'NOT_YOUR_TURN';
  end if;

  r_estado := public.met_normaliza(cru);
  if r_estado <> cru then
    update public.matches set public_state = r_estado where id = p_match;
  end if;

  select data into r_mapa from public.game_themes gt where gt.id = (r_estado ->> 'map');
end;
$$;

revoke all on function public.met_na_vez(uuid) from public, anon, authenticated;

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
  cru  jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select m.public_state, m.seed, m.status into cru, r_seed, vivo
    from public.matches m where m.id = p_match for update;
  if not found then raise exception 'MATCH_NOT_FOUND'; end if;
  if vivo <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;

  select mp.seat into r_seat from public.match_players mp
   where mp.match_id = p_match and mp.user_id = auth.uid();
  if r_seat is null then raise exception 'NOT_A_PLAYER'; end if;

  r_estado := public.met_normaliza(cru);
  if r_estado <> cru then
    update public.matches set public_state = r_estado where id = p_match;
  end if;

  select data into r_mapa from public.game_themes gt where gt.id = (r_estado ->> 'map');
end;
$$;

revoke all on function public.met_sou(uuid) from public, anon, authenticated;

-- ── isenção de aluguel ─────────────────────────────────────────────────────

/**
 * `p_pagador` está isento de pagar aluguel a `p_dono` nesta propriedade?
 *
 * Fica FORA de `met_aluguel` de propósito. `met_aluguel` responde "quanto esta
 * casa cobra", que é uma propriedade da casa e é o que o cliente espelha para
 * mostrar na tela. Quem paga é outra pergunta, e é do contrato — misturar as
 * duas obrigaria o espelho do cliente a conhecer contrato para calcular
 * aluguel, e o número na casa passaria a depender de quem está olhando.
 */
create or replace function public.met_isento(
  p_est jsonb, p_pagador smallint, p_dono smallint, p_prop text
)
returns boolean
language sql
immutable
as $$
  select exists (
    select 1
      from jsonb_array_elements(coalesce(p_est -> 'contratos', '[]'::jsonb)) c
     where c ->> 'tipo' = 'isencao'
       and (c ->> 'de')::smallint = p_dono
       and (c ->> 'para')::smallint = p_pagador
       and coalesce((c ->> 'rodadas')::int, 0) > 0
       and (c -> 'props' = 'null'::jsonb
            or c -> 'props' is null
            or c -> 'props' @> to_jsonb(p_prop))
  );
$$;

revoke all on function public.met_isento(jsonb, smallint, smallint, text) from public, anon, authenticated;

-- ── o cartório cobra ───────────────────────────────────────────────────────

/**
 * Roda no começo do turno de `p_seat`: cobra as parcelas que ele deve, gasta
 * uma rodada dos contratos que o constrangem, e joga fora o que venceu.
 *
 * A cobrança usa `met_paga`, então a inadimplência cai na mesma máquina de
 * dívida do resto do jogo: caixa negativo, pendência que tranca o turno, e a
 * pessoa tem de hipotecar, vender ou quebrar. O critério de aceite pede
 * exatamente isso — "devedor sem caixa entra em inadimplência e é forçado a
 * hipotecar/vender" — e sai de graça por reusar a máquina em vez de inventar
 * um caminho paralelo.
 */
create or replace function public.met_cobra_contratos(p_est jsonb, p_seat smallint)
returns jsonb
language plpgsql
as $$
declare
  est    jsonb := p_est;
  c      jsonb;
  novos  jsonb := '[]'::jsonb;
  rodada int := coalesce((p_est ->> 'round')::int, 1);
  restam int;
begin
  for c in select value from jsonb_array_elements(coalesce(est -> 'contratos', '[]'::jsonb)) loop
    -- parcela: quem deve é `de`, e paga no próprio turno
    if c ->> 'tipo' = 'parcela' and (c ->> 'de')::smallint = p_seat then
      restam := coalesce((c ->> 'rodadas')::int, 0);
      if restam > 0 then
        est := public.met_paga(est, p_seat, (c ->> 'para')::smallint,
                               (c ->> 'valor')::int, 'parcela:' || (c ->> 'id'));
        restam := restam - 1;
        est := public.met_log(est, jsonb_build_object(
          'k', 'parcela', 'de', p_seat, 'para', (c ->> 'para')::smallint,
          'valor', (c ->> 'valor')::int, 'n', restam));
      end if;
      if restam > 0 then
        novos := novos || jsonb_build_array(jsonb_set(c, '{rodadas}', to_jsonb(restam)));
      else
        est := public.met_log(est, jsonb_build_object(
          'k', 'contrato-fim', 'tipo', 'parcela', 'de', (c ->> 'de')::smallint,
          'para', (c ->> 'para')::smallint));
      end if;

    -- isenção: quem consome é `para`, e consome no próprio turno
    elsif c ->> 'tipo' = 'isencao' and (c ->> 'para')::smallint = p_seat then
      restam := coalesce((c ->> 'rodadas')::int, 0) - 1;
      if restam > 0 then
        novos := novos || jsonb_build_array(jsonb_set(c, '{rodadas}', to_jsonb(restam)));
      else
        est := public.met_log(est, jsonb_build_object(
          'k', 'contrato-fim', 'tipo', 'isencao', 'de', (c ->> 'de')::smallint,
          'para', (c ->> 'para')::smallint));
      end if;

    -- opção: vence por rodada absoluta, não por contagem
    elsif c ->> 'tipo' = 'opcao' then
      if coalesce((c ->> 'ate')::int, 0) >= rodada then
        novos := novos || jsonb_build_array(c);
      else
        est := public.met_log(est, jsonb_build_object(
          'k', 'contrato-fim', 'tipo', 'opcao', 'de', (c ->> 'de')::smallint,
          'para', (c ->> 'para')::smallint));
      end if;

    else
      novos := novos || jsonb_build_array(c);
    end if;
  end loop;

  return jsonb_set(est, '{contratos}', novos);
end;
$$;

revoke all on function public.met_cobra_contratos(jsonb, smallint) from public, anon, authenticated;

-- ── validação de um lado da proposta ───────────────────────────────────────

/**
 * O lado que `p_seat` está oferecendo é possível? Devolve nulo se sim, ou um
 * código se não.
 *
 * Roda DUAS vezes: quando a proposta é feita e quando ela é aceita. A segunda
 * não é redundância — entre propor e aceitar, o mundo anda. A pessoa pode ter
 * gastado o dinheiro, hipotecado a escritura, construído em cima dela, ou
 * quebrado. Aceitar uma proposta que virou impossível criaria dinheiro ou
 * propriedade do nada, e é o tipo de furo que só aparece em partida real.
 */
create or replace function public.met_valida_lado(
  p_mapa jsonb, p_est jsonb, p_seat smallint, p_lado jsonb
)
returns text
language plpgsql
immutable
as $$
declare
  dinheiro int := coalesce((p_lado ->> 'dinheiro')::int, 0);
  livras   int := coalesce((p_lado ->> 'livras')::int, 0);
  prop     text;
  casa     jsonb;
  pe       jsonb;
  rodada   int := coalesce((p_est ->> 'round')::int, 1);
begin
  if dinheiro < 0 or livras < 0 then return 'BAD_OFFER'; end if;
  if dinheiro > (p_est -> 'players' -> p_seat::text ->> 'cash')::int then
    return 'NOT_ENOUGH_CASH';
  end if;
  if livras > coalesce((p_est -> 'players' -> p_seat::text ->> 'livras')::int, 0) then
    return 'NOT_ENOUGH_CARDS';
  end if;

  -- escrituras
  for prop in select value #>> '{}' from jsonb_array_elements(coalesce(p_lado -> 'props', '[]'::jsonb)) loop
    select c into casa from jsonb_array_elements(p_mapa -> 'casas') c where c ->> 'id' = prop limit 1;
    if casa is null then return 'NO_SUCH_PROPERTY'; end if;
    pe := p_est -> 'props' -> prop;
    if coalesce((pe ->> 'owner')::smallint, -1) <> p_seat then return 'NOT_YOURS'; end if;
    -- escritura com construção não passa de mão: venda as casas primeiro. É
    -- mais simples de entender que "as casas são vendidas ao banco sozinhas",
    -- e evita uma transferência que muda o caixa de quem nem clicou.
    if coalesce((pe ->> 'casas')::int, 0) > 0
       or coalesce((pe ->> 'hotel')::boolean, false) then
      return 'BUILDINGS_ON_PROP';
    end if;
  end loop;

  -- parcelamento
  if p_lado -> 'parcela' is not null and p_lado -> 'parcela' <> 'null'::jsonb then
    if coalesce((p_lado -> 'parcela' ->> 'valor')::int, 0) <= 0 then return 'BAD_OFFER'; end if;
    if coalesce((p_lado -> 'parcela' ->> 'rodadas')::int, 0) not between 1 and 20 then
      return 'BAD_OFFER';
    end if;
  end if;

  -- isenção
  if p_lado -> 'isencao' is not null and p_lado -> 'isencao' <> 'null'::jsonb then
    if coalesce((p_lado -> 'isencao' ->> 'rodadas')::int, 0) not between 1 and 20 then
      return 'BAD_OFFER';
    end if;
    -- quem isenta tem de ser o dono do que está isentando
    for prop in
      select value #>> '{}' from jsonb_array_elements(
        case when p_lado -> 'isencao' -> 'props' = 'null'::jsonb
                  or p_lado -> 'isencao' -> 'props' is null
             then '[]'::jsonb else p_lado -> 'isencao' -> 'props' end)
    loop
      if coalesce((p_est -> 'props' -> prop ->> 'owner')::smallint, -1) <> p_seat then
        return 'NOT_YOURS';
      end if;
    end loop;
  end if;

  -- opção de compra
  if p_lado -> 'opcao' is not null and p_lado -> 'opcao' <> 'null'::jsonb then
    prop := p_lado -> 'opcao' ->> 'prop';
    if prop is null then return 'BAD_OFFER'; end if;
    if coalesce((p_est -> 'props' -> prop ->> 'owner')::smallint, -1) <> p_seat then
      return 'NOT_YOURS';
    end if;
    if coalesce((p_lado -> 'opcao' ->> 'preco')::int, -1) < 0 then return 'BAD_OFFER'; end if;
    if coalesce((p_lado -> 'opcao' ->> 'ate')::int, 0) <= rodada then return 'BAD_OFFER'; end if;
  end if;

  return null;
end;
$$;

revoke all on function public.met_valida_lado(jsonb, jsonb, smallint, jsonb) from public, anon, authenticated;

-- ── executar um lado ───────────────────────────────────────────────────────

/** Move o que `p_de` prometeu para `p_para`, e cria os contratos do lado. */
create or replace function public.met_executa_lado(
  p_est jsonb, p_de smallint, p_para smallint, p_lado jsonb
)
returns jsonb
language plpgsql
as $$
declare
  est      jsonb := p_est;
  dinheiro int := coalesce((p_lado ->> 'dinheiro')::int, 0);
  livras   int := coalesce((p_lado ->> 'livras')::int, 0);
  prop     text;
  cseq     int;
begin
  if dinheiro > 0 then
    est := public.met_paga(est, p_de, p_para, dinheiro, 'acordo');
  end if;

  if livras > 0 then
    est := jsonb_set(est, array['players', p_de::text, 'livras'],
      to_jsonb(coalesce((est -> 'players' -> p_de::text ->> 'livras')::int, 0) - livras));
    est := jsonb_set(est, array['players', p_para::text, 'livras'],
      to_jsonb(coalesce((est -> 'players' -> p_para::text ->> 'livras')::int, 0) + livras));
  end if;

  for prop in select value #>> '{}' from jsonb_array_elements(coalesce(p_lado -> 'props', '[]'::jsonb)) loop
    -- a hipoteca acompanha a escritura: quem recebe herda a dívida com o
    -- banco, e resgata quando quiser. É como funciona na mesa.
    est := jsonb_set(est, array['props', prop, 'owner'], to_jsonb(p_para));
  end loop;

  if p_lado -> 'parcela' is not null and p_lado -> 'parcela' <> 'null'::jsonb then
    cseq := coalesce((est ->> 'cSeq')::int, 0) + 1;
    est := jsonb_set(est, '{cSeq}', to_jsonb(cseq));
    est := jsonb_set(est, '{contratos}',
      coalesce(est -> 'contratos', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'id', 'c' || cseq, 'tipo', 'parcela', 'de', p_de, 'para', p_para,
        'valor', (p_lado -> 'parcela' ->> 'valor')::int,
        'rodadas', (p_lado -> 'parcela' ->> 'rodadas')::int,
        'props', null, 'ate', null)));
  end if;

  if p_lado -> 'isencao' is not null and p_lado -> 'isencao' <> 'null'::jsonb then
    cseq := coalesce((est ->> 'cSeq')::int, 0) + 1;
    est := jsonb_set(est, '{cSeq}', to_jsonb(cseq));
    est := jsonb_set(est, '{contratos}',
      coalesce(est -> 'contratos', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'id', 'c' || cseq, 'tipo', 'isencao', 'de', p_de, 'para', p_para,
        'valor', 0,
        'rodadas', (p_lado -> 'isencao' ->> 'rodadas')::int,
        'props', case when p_lado -> 'isencao' -> 'props' = 'null'::jsonb
                      then null else p_lado -> 'isencao' -> 'props' end,
        'ate', null)));
  end if;

  if p_lado -> 'opcao' is not null and p_lado -> 'opcao' <> 'null'::jsonb then
    cseq := coalesce((est ->> 'cSeq')::int, 0) + 1;
    est := jsonb_set(est, '{cSeq}', to_jsonb(cseq));
    est := jsonb_set(est, '{contratos}',
      coalesce(est -> 'contratos', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'id', 'c' || cseq, 'tipo', 'opcao', 'de', p_de, 'para', p_para,
        'valor', (p_lado -> 'opcao' ->> 'preco')::int,
        'rodadas', 0,
        'props', jsonb_build_array(p_lado -> 'opcao' ->> 'prop'),
        'ate', (p_lado -> 'opcao' ->> 'ate')::int)));
  end if;

  return est;
end;
$$;

revoke all on function public.met_executa_lado(jsonb, smallint, smallint, jsonb) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- PROPOR
-- ═══════════════════════════════════════════════════════════════════════════

/**
 * Fazer uma proposta. A QUALQUER MOMENTO, não só na sua vez.
 *
 * É a segunda ação do projeto que não exige o turno, e pelo mesmo motivo do
 * leilão: negociação que só acontece na sua vez é negociação que não acontece.
 * Metade das trocas boas do Banco Imobiliário nascem de alguém ver o outro
 * parar num lugar ruim e oferecer socorro na hora.
 */
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
  if coalesce((est -> 'players' -> meu::text ->> 'quebrado')::boolean, false)
     or coalesce((est -> 'players' -> p_para::text ->> 'quebrado')::boolean, false) then
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

revoke all on function public.met_offer(uuid, smallint, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.met_offer(uuid, smallint, jsonb, jsonb) to authenticated;

/** Responder: aceitar executa os dois lados numa transação, ou recusar. */
create or replace function public.met_offer_reply(
  p_match uuid, p_id text, p_aceita boolean
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
  oferta  jsonb;
  quem    smallint;
  erro    text;
begin
  select * into est, semente, meu, mapa from public.met_sou(p_match);

  select o into oferta
    from jsonb_array_elements(coalesce(est -> 'ofertas', '[]'::jsonb)) o
   where o ->> 'id' = p_id limit 1;
  if oferta is null then raise exception 'NO_SUCH_OFFER'; end if;
  if (oferta ->> 'para')::smallint <> meu then raise exception 'NOT_FOR_YOU'; end if;

  quem := (oferta ->> 'de')::smallint;

  -- sai da lista de qualquer jeito
  est := jsonb_set(est, '{ofertas}', (
    select coalesce(jsonb_agg(o), '[]'::jsonb)
      from jsonb_array_elements(est -> 'ofertas') o
     where o ->> 'id' <> p_id
  ));

  if not p_aceita then
    est := public.met_log(est, jsonb_build_object(
      'k', 'proposta-recusada', 'de', quem, 'para', meu));
    update public.matches set public_state = est, version = version + 1 where id = p_match;
    return public.met_publico(p_match);
  end if;

  /* A SEGUNDA VALIDAÇÃO. Entre propor e aceitar, o mundo andou: quem propôs
     pode ter gasto o dinheiro, hipotecado a escritura ou construído em cima
     dela. Aceitar sem conferir criaria dinheiro do nada. */
  erro := public.met_valida_lado(mapa, est, quem, oferta -> 'da');
  if erro is not null then raise exception 'OFFER_STALE_%', erro; end if;
  erro := public.met_valida_lado(mapa, est, meu, oferta -> 'quer');
  if erro is not null then raise exception '%', erro; end if;

  est := public.met_executa_lado(est, quem, meu, oferta -> 'da');
  est := public.met_executa_lado(est, meu, quem, oferta -> 'quer');
  est := public.met_log(est, jsonb_build_object(
    'k', 'acordo', 'de', quem, 'para', meu));

  update public.matches set public_state = est, version = version + 1 where id = p_match;
  return public.met_publico(p_match);
end;
$$;

revoke all on function public.met_offer_reply(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.met_offer_reply(uuid, text, boolean) to authenticated;

/** Retirar a própria proposta. */
create or replace function public.met_offer_cancel(p_match uuid, p_id text)
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
  oferta  jsonb;
begin
  select * into est, semente, meu, mapa from public.met_sou(p_match);

  select o into oferta
    from jsonb_array_elements(coalesce(est -> 'ofertas', '[]'::jsonb)) o
   where o ->> 'id' = p_id limit 1;
  if oferta is null then raise exception 'NO_SUCH_OFFER'; end if;
  if (oferta ->> 'de')::smallint <> meu then raise exception 'NOT_YOURS'; end if;

  est := jsonb_set(est, '{ofertas}', (
    select coalesce(jsonb_agg(o), '[]'::jsonb)
      from jsonb_array_elements(est -> 'ofertas') o
     where o ->> 'id' <> p_id
  ));
  est := public.met_log(est, jsonb_build_object('k', 'proposta-retirada', 'de', meu));

  update public.matches set public_state = est, version = version + 1 where id = p_match;
  return public.met_publico(p_match);
end;
$$;

revoke all on function public.met_offer_cancel(uuid, text) from public, anon, authenticated;
grant execute on function public.met_offer_cancel(uuid, text) to authenticated;

-- ── exercer a opção de compra ──────────────────────────────────────────────

/**
 * Exercer a opção: comprar pelo preço combinado, dentro do prazo.
 *
 * É o instrumento mais interessante que a mesa de papel não tem. "Posso
 * comprar o Leblon de você por R$ 5.000 até a rodada 14" transforma uma
 * propriedade em duas coisas ao mesmo tempo: o dono continua recebendo
 * aluguel, e o outro tem um seguro contra o preço subir. Vale a pena vender e
 * vale a pena comprar, o que é a definição de bom negócio.
 */
create or replace function public.met_exercer(p_match uuid, p_id text)
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
  c       jsonb;
  prop    text;
  dono    smallint;
begin
  select * into est, semente, meu, mapa from public.met_sou(p_match);

  select x into c
    from jsonb_array_elements(coalesce(est -> 'contratos', '[]'::jsonb)) x
   where x ->> 'id' = p_id and x ->> 'tipo' = 'opcao' limit 1;
  if c is null then raise exception 'NO_SUCH_OPTION'; end if;
  if (c ->> 'para')::smallint <> meu then raise exception 'NOT_YOURS'; end if;
  if coalesce((c ->> 'ate')::int, 0) < coalesce((est ->> 'round')::int, 1) then
    raise exception 'OPTION_EXPIRED';
  end if;

  prop := c -> 'props' ->> 0;
  dono := coalesce((est -> 'props' -> prop ->> 'owner')::smallint, -1);
  -- o vendedor pode não ser mais o dono: a opção não vale contra terceiro
  if dono <> (c ->> 'de')::smallint then raise exception 'OWNER_CHANGED'; end if;
  if coalesce((est -> 'props' -> prop ->> 'casas')::int, 0) > 0
     or coalesce((est -> 'props' -> prop ->> 'hotel')::boolean, false) then
    raise exception 'BUILDINGS_ON_PROP';
  end if;
  if (est -> 'players' -> meu::text ->> 'cash')::int < (c ->> 'valor')::int then
    raise exception 'NOT_ENOUGH_CASH';
  end if;

  est := public.met_paga(est, meu, dono, (c ->> 'valor')::int, 'opcao:' || prop);
  est := jsonb_set(est, array['props', prop, 'owner'], to_jsonb(meu));
  est := jsonb_set(est, '{contratos}', (
    select coalesce(jsonb_agg(x), '[]'::jsonb)
      from jsonb_array_elements(est -> 'contratos') x
     where x ->> 'id' <> p_id
  ));
  est := public.met_log(est, jsonb_build_object(
    'k', 'opcao-exercida', 'seat', meu, 'prop', prop, 'valor', (c ->> 'valor')::int));

  update public.matches set public_state = est, version = version + 1 where id = p_match;
  return public.met_publico(p_match);
end;
$$;

revoke all on function public.met_exercer(uuid, text) from public, anon, authenticated;
grant execute on function public.met_exercer(uuid, text) to authenticated;
