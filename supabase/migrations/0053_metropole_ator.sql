-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0053 · o ator da Metrópole deixa de ser ambiente
--
-- O mesmo movimento de 0047 no Domínio, e mais limpo aqui: na Metrópole
-- `auth.uid()` aparece em DOIS lugares só, e nenhum deles no corpo das ações.
--
--   `met_na_vez`  resolve quem é E exige que seja a vez dele
--   `met_sou`     resolve quem é e só exige que ele esteja na partida
--
-- A segunda existe porque na Metrópole se age FORA da própria vez: leilão (todo
-- mundo dá lance), resposta a proposta de troca, aposta do Investidor. E é isso
-- que faz o cérebro da máquina aqui ser diferente do Domínio: no Domínio ela
-- joga um turno e passa; aqui ela pode precisar dar lance no meio do turno de
-- outra pessoa.
--
-- Cada ação ganha um irmão `_como(p_seat, ...)` com as regras, e a função
-- pública de mesmo nome fica sendo uma casca que resolve quem é e delega. Uma
-- implementação das regras, dois chamadores — e nenhuma regra de dinheiro,
-- aluguel, hipoteca ou leilão escrita duas vezes.
--
-- GERADO de `pg_get_functiondef` das definições VIVAS
-- (scripts/gera-metropole-ator.mjs). As funções da Metrópole foram redefinidas
-- ao longo de 0026–0038, e a viva de cada uma está num arquivo diferente.
-- ════════════════════════════════════════════════════════════════════════════

-- ── os dois resolvedores, com o assento dito ──────────────────────

create or replace function public.met_ator(
  p_match uuid, p_seat smallint,
  out r_estado jsonb, out r_seed bigint, out r_seat smallint, out r_mapa jsonb
)
returns record
language plpgsql
security definer
set search_path = public
as $$
declare
  vivo text;
  cru  jsonb;
begin
  select m.public_state, m.seed, m.status into cru, r_seed, vivo
    from public.matches m where m.id = p_match for update;
  if not found then raise exception 'MATCH_NOT_FOUND'; end if;
  if vivo <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;

  if not exists (
    select 1 from public.match_players mp
     where mp.match_id = p_match and mp.seat = p_seat
  ) then
    raise exception 'NOT_A_PLAYER';
  end if;
  r_seat := p_seat;

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

create or replace function public.met_ator_livre(
  p_match uuid, p_seat smallint,
  out r_estado jsonb, out r_seed bigint, out r_seat smallint, out r_mapa jsonb
)
returns record
language plpgsql
security definer
set search_path = public
as $$
declare
  vivo text;
  cru  jsonb;
begin
  select m.public_state, m.seed, m.status into cru, r_seed, vivo
    from public.matches m where m.id = p_match for update;
  if not found then raise exception 'MATCH_NOT_FOUND'; end if;
  if vivo <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;

  if not exists (
    select 1 from public.match_players mp
     where mp.match_id = p_match and mp.seat = p_seat
  ) then
    raise exception 'NOT_A_PLAYER';
  end if;
  r_seat := p_seat;

  r_estado := public.met_normaliza(cru);
  if r_estado <> cru then
    update public.matches set public_state = r_estado where id = p_match;
  end if;

  select data into r_mapa from public.game_themes gt where gt.id = (r_estado ->> 'map');
end;
$$;

revoke all on function public.met_ator(uuid, smallint) from public, anon, authenticated;
revoke all on function public.met_ator_livre(uuid, smallint) from public, anon, authenticated;

-- ── as ações, com o ator dito ─────────────────────────────────

-- met_aposta_como → met_ator_livre
CREATE OR REPLACE FUNCTION public.met_aposta_como(p_seat smallint, p_match uuid, p_em smallint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  est     jsonb;
  semente bigint;
  meu     smallint;
  mapa    jsonb;
begin
  select * into est, semente, meu, mapa from public.met_ator_livre(p_match, p_seat);

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
$function$
;

-- met_bankrupt_como → met_ator
CREATE OR REPLACE FUNCTION public.met_bankrupt_como(p_seat smallint, p_match uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  select * into est, semente, meu, mapa from public.met_ator(p_match, p_seat);

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
$function$
;

-- met_bid_como → met_ator_livre
CREATE OR REPLACE FUNCTION public.met_bid_como(p_seat smallint, p_match uuid, p_valor integer, p_admin smallint DEFAULT NULL::smallint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  est     jsonb;
  semente bigint;
  meu     smallint;
  mapa    jsonb;
  lei     jsonb;
  minimo  int;
begin
  select * into est, semente, meu, mapa from public.met_ator_livre(p_match, p_seat);

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
$function$
;

-- met_build_como → met_ator
CREATE OR REPLACE FUNCTION public.met_build_como(p_seat smallint, p_match uuid, p_prop text, p_n integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  select * into est, semente, meu, mapa from public.met_ator(p_match, p_seat);

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
  /* Regra da casa "construir solto": dispensa o monopólio para construir.
     Encurta a partida (a construção começa antes) e tira peso da negociação —
     por isso está desligada por padrão, com o efeito declarado na etiqueta. */
  if not coalesce((est -> 'regras' ->> 'construirSolto')::boolean, false)
     and not public.met_grupo_completo(mapa, est, meu, grupo) then
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
  -- boom imobiliário: construir custa 30% menos (×7/10, exato para os quatro
  -- preços de casa do tabuleiro)
  if est -> 'evento' ->> 'efeito' = 'construcao' then
    custo := custo * (est -> 'evento' ->> 'num')::int / (est -> 'evento' ->> 'den')::int;
  end if;
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
$function$
;

-- met_buy_como → met_ator
CREATE OR REPLACE FUNCTION public.met_buy_como(p_seat smallint, p_match uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  est     jsonb;
  semente bigint;
  meu     smallint;
  mapa    jsonb;
  pend    jsonb;
  preco   int;
begin
  select * into est, semente, meu, mapa from public.met_ator(p_match, p_seat);

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
$function$
;

-- met_decline_como → met_ator
CREATE OR REPLACE FUNCTION public.met_decline_como(p_seat smallint, p_match uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  est     jsonb;
  semente bigint;
  meu     smallint;
  mapa    jsonb;
  pend    jsonb;
  semLeilao boolean;
begin
  select * into est, semente, meu, mapa from public.met_ator(p_match, p_seat);

  pend := est -> 'pendente';
  if pend is null or pend = 'null'::jsonb or pend ->> 'k' <> 'comprar' then
    raise exception 'NOTHING_TO_DECLINE';
  end if;

  -- a regra vem do ESTADO, congelado no início da partida, e não da sala:
  -- mudar a regra da casa com a partida rolando não pode mudar a partida
  semLeilao := coalesce((est -> 'regras' ->> 'semLeilao')::boolean, false);

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
$function$
;

-- met_end_turn_como → met_ator
CREATE OR REPLACE FUNCTION public.met_end_turn_como(p_seat smallint, p_match uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  select * into est, semente, meu, mapa from public.met_ator(p_match, p_seat);

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

  -- o evento da cidade: expira o que venceu e sorteia na virada de cada
  -- quinta rodada
  est := public.met_evento(mapa, est, semente, rodada);

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
$function$
;

-- met_exercer_como → met_ator_livre
CREATE OR REPLACE FUNCTION public.met_exercer_como(p_seat smallint, p_match uuid, p_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  est     jsonb;
  semente bigint;
  meu     smallint;
  mapa    jsonb;
  c       jsonb;
  prop    text;
  dono    smallint;
begin
  select * into est, semente, meu, mapa from public.met_ator_livre(p_match, p_seat);

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
$function$
;

-- met_jail_como → met_ator
CREATE OR REPLACE FUNCTION public.met_jail_como(p_seat smallint, p_match uuid, p_escolha text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  select * into est, semente, meu, mapa from public.met_ator(p_match, p_seat);

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
$function$
;

-- met_mortgage_como → met_ator
CREATE OR REPLACE FUNCTION public.met_mortgage_como(p_seat smallint, p_match uuid, p_prop text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  est     jsonb;
  semente bigint;
  meu     smallint;
  mapa    jsonb;
  casa    jsonb;
  rende   int;
begin
  select * into est, semente, meu, mapa from public.met_ator(p_match, p_seat);

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

  -- aperto de crédito: hipotecar rende 20% menos (×4/5)
  rende := (casa ->> 'hipoteca')::int;
  if est -> 'evento' ->> 'efeito' = 'credito' then
    rende := rende * (est -> 'evento' ->> 'num')::int / (est -> 'evento' ->> 'den')::int;
  end if;

  est := jsonb_set(est, array['props', p_prop, 'hipotecada'], 'true'::jsonb);
  est := jsonb_set(est, array['players', meu::text, 'cash'],
    to_jsonb((est -> 'players' -> meu::text ->> 'cash')::int + rende));
  est := public.met_log(est, jsonb_build_object(
    'k', 'hipoteca', 'seat', meu, 'prop', p_prop, 'valor', rende));
  est := public.met_confere_divida(est, meu);

  update public.matches set public_state = est, version = version + 1 where id = p_match;
  return public.met_publico(p_match);
end;
$function$
;

-- met_offer_como → met_ator_livre
CREATE OR REPLACE FUNCTION public.met_offer_como(p_seat smallint, p_match uuid, p_para smallint, p_da jsonb, p_quer jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  est     jsonb;
  semente bigint;
  meu     smallint;
  mapa    jsonb;
  erro    text;
  quantas int;
  cseq    int;
begin
  select * into est, semente, meu, mapa from public.met_ator_livre(p_match, p_seat);

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
$function$
;

-- met_offer_cancel_como → met_ator_livre
CREATE OR REPLACE FUNCTION public.met_offer_cancel_como(p_seat smallint, p_match uuid, p_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  est     jsonb;
  semente bigint;
  meu     smallint;
  mapa    jsonb;
  oferta  jsonb;
begin
  select * into est, semente, meu, mapa from public.met_ator_livre(p_match, p_seat);

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
$function$
;

-- met_offer_reply_como → met_ator_livre
CREATE OR REPLACE FUNCTION public.met_offer_reply_como(p_seat smallint, p_match uuid, p_id text, p_aceita boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  est     jsonb;
  semente bigint;
  meu     smallint;
  mapa    jsonb;
  oferta  jsonb;
  quem    smallint;
  erro    text;
begin
  select * into est, semente, meu, mapa from public.met_ator_livre(p_match, p_seat);

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
$function$
;

-- met_pass_como → met_ator_livre
CREATE OR REPLACE FUNCTION public.met_pass_como(p_seat smallint, p_match uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  est     jsonb;
  semente bigint;
  meu     smallint;
  mapa    jsonb;
  faltam  int;
begin
  select * into est, semente, meu, mapa from public.met_ator_livre(p_match, p_seat);
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
$function$
;

-- met_roll_como → met_ator
CREATE OR REPLACE FUNCTION public.met_roll_como(p_seat smallint, p_match uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  select * into est, semente, meu, mapa from public.met_ator(p_match, p_seat);

  if est ->> 'phase' <> 'rolar' then raise exception 'WRONG_PHASE'; end if;
  if est -> 'pendente' is not null and est -> 'pendente' <> 'null'::jsonb then
    raise exception 'RESOLVE_FIRST';
  end if;
  if coalesce((est -> 'players' -> meu::text ->> 'jail')::int, 0) > 0 then
    raise exception 'IN_JAIL';
  end if;

  salario := public.met_salario(mapa, est);
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
$function$
;

-- met_sell_como → met_ator
CREATE OR REPLACE FUNCTION public.met_sell_como(p_seat smallint, p_match uuid, p_prop text, p_n integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  select * into est, semente, meu, mapa from public.met_ator(p_match, p_seat);
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
$function$
;

-- met_unmortgage_como → met_ator
CREATE OR REPLACE FUNCTION public.met_unmortgage_como(p_seat smallint, p_match uuid, p_prop text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  est     jsonb;
  semente bigint;
  meu     smallint;
  mapa    jsonb;
  casa    jsonb;
  quanto  int;
begin
  select * into est, semente, meu, mapa from public.met_ator(p_match, p_seat);

  select c into casa from jsonb_array_elements(mapa -> 'casas') c
   where c ->> 'id' = p_prop limit 1;
  if casa is null then raise exception 'NO_SUCH_PROPERTY'; end if;
  if (est -> 'props' -> p_prop ->> 'owner')::smallint <> meu then raise exception 'NOT_YOURS'; end if;
  if not coalesce((est -> 'props' -> p_prop ->> 'hipotecada')::boolean, false) then
    raise exception 'NOT_MORTGAGED';
  end if;

  /* Os juros normais são 10%; no aperto de crédito, 20%. A conta é sempre
     fração de inteiros — `hipoteca * (100+pct) / 100` — e nunca
     `hipoteca * 1.1`, que em ponto flutuante dá um real a mais em quase metade
     das faixas do tabuleiro. Esse erro já existiu aqui; ver 0030 e o comentário
     de `custoResgate` em lib/metropole/cidade.ts. */
  if est -> 'evento' ->> 'efeito' = 'credito' then
    quanto := (casa ->> 'hipoteca')::int * (est -> 'evento' ->> 'jurosNum')::int
              / (est -> 'evento' ->> 'jurosDen')::int;
  else
    quanto := (casa ->> 'hipoteca')::int
              * (100 + (100 * (mapa -> 'regras' ->> 'jurosResgate')::numeric)::int)
              / 100;
  end if;
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
$function$
;

-- ── e as públicas viram casca ─────────────────────────────────
-- `met_na_vez` e `met_sou` continuam sendo quem estoura NOT_AUTHENTICATED,
-- NOT_A_PLAYER e NOT_YOUR_TURN, e por isso nenhuma mensagem de erro do cliente
-- muda.

create or replace function public.met_aposta(p_match uuid, p_em smallint)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare est jsonb; s bigint; meu smallint; mp jsonb;
begin
  select * into est, s, meu, mp from public.met_sou(p_match);
  return public.met_aposta_como(meu, p_match, p_em);
end;
$$;

create or replace function public.met_bankrupt(p_match uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare est jsonb; s bigint; meu smallint; mp jsonb;
begin
  select * into est, s, meu, mp from public.met_na_vez(p_match);
  return public.met_bankrupt_como(meu, p_match);
end;
$$;

-- o DEFAULT de `p_admin` volta: sem ele o PostgREST nao resolve a chamada de
-- duas chaves, e o cliente do leilao passa `p_admin` só quando existe
-- Investidor na mesa
create or replace function public.met_bid(
  p_match uuid, p_valor integer, p_admin smallint default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare est jsonb; s bigint; meu smallint; mp jsonb;
begin
  select * into est, s, meu, mp from public.met_sou(p_match);
  return public.met_bid_como(meu, p_match, p_valor, p_admin);
end;
$$;

create or replace function public.met_build(p_match uuid, p_prop text, p_n integer)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare est jsonb; s bigint; meu smallint; mp jsonb;
begin
  select * into est, s, meu, mp from public.met_na_vez(p_match);
  return public.met_build_como(meu, p_match, p_prop, p_n);
end;
$$;

create or replace function public.met_buy(p_match uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare est jsonb; s bigint; meu smallint; mp jsonb;
begin
  select * into est, s, meu, mp from public.met_na_vez(p_match);
  return public.met_buy_como(meu, p_match);
end;
$$;

create or replace function public.met_decline(p_match uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare est jsonb; s bigint; meu smallint; mp jsonb;
begin
  select * into est, s, meu, mp from public.met_na_vez(p_match);
  return public.met_decline_como(meu, p_match);
end;
$$;

create or replace function public.met_end_turn(p_match uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare est jsonb; s bigint; meu smallint; mp jsonb;
begin
  select * into est, s, meu, mp from public.met_na_vez(p_match);
  return public.met_end_turn_como(meu, p_match);
end;
$$;

create or replace function public.met_exercer(p_match uuid, p_id text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare est jsonb; s bigint; meu smallint; mp jsonb;
begin
  select * into est, s, meu, mp from public.met_sou(p_match);
  return public.met_exercer_como(meu, p_match, p_id);
end;
$$;

create or replace function public.met_jail(p_match uuid, p_escolha text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare est jsonb; s bigint; meu smallint; mp jsonb;
begin
  select * into est, s, meu, mp from public.met_na_vez(p_match);
  return public.met_jail_como(meu, p_match, p_escolha);
end;
$$;

create or replace function public.met_mortgage(p_match uuid, p_prop text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare est jsonb; s bigint; meu smallint; mp jsonb;
begin
  select * into est, s, meu, mp from public.met_na_vez(p_match);
  return public.met_mortgage_como(meu, p_match, p_prop);
end;
$$;

create or replace function public.met_offer(p_match uuid, p_para smallint, p_da jsonb, p_quer jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare est jsonb; s bigint; meu smallint; mp jsonb;
begin
  select * into est, s, meu, mp from public.met_sou(p_match);
  return public.met_offer_como(meu, p_match, p_para, p_da, p_quer);
end;
$$;

create or replace function public.met_offer_cancel(p_match uuid, p_id text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare est jsonb; s bigint; meu smallint; mp jsonb;
begin
  select * into est, s, meu, mp from public.met_sou(p_match);
  return public.met_offer_cancel_como(meu, p_match, p_id);
end;
$$;

create or replace function public.met_offer_reply(p_match uuid, p_id text, p_aceita boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare est jsonb; s bigint; meu smallint; mp jsonb;
begin
  select * into est, s, meu, mp from public.met_sou(p_match);
  return public.met_offer_reply_como(meu, p_match, p_id, p_aceita);
end;
$$;

create or replace function public.met_pass(p_match uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare est jsonb; s bigint; meu smallint; mp jsonb;
begin
  select * into est, s, meu, mp from public.met_sou(p_match);
  return public.met_pass_como(meu, p_match);
end;
$$;

create or replace function public.met_roll(p_match uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare est jsonb; s bigint; meu smallint; mp jsonb;
begin
  select * into est, s, meu, mp from public.met_na_vez(p_match);
  return public.met_roll_como(meu, p_match);
end;
$$;

create or replace function public.met_sell(p_match uuid, p_prop text, p_n integer)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare est jsonb; s bigint; meu smallint; mp jsonb;
begin
  select * into est, s, meu, mp from public.met_na_vez(p_match);
  return public.met_sell_como(meu, p_match, p_prop, p_n);
end;
$$;

create or replace function public.met_unmortgage(p_match uuid, p_prop text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare est jsonb; s bigint; meu smallint; mp jsonb;
begin
  select * into est, s, meu, mp from public.met_na_vez(p_match);
  return public.met_unmortgage_como(meu, p_match, p_prop);
end;
$$;

-- ── privilégio ───────────────────────────────────────────────
-- OS NÚCLEOS NÃO SÃO CHAMÁVEIS PELO CLIENTE. `met_buy_como(3, ...)` compra no
-- lugar do assento 3 — é o buraco de `dominio_termina` de 0025 outra vez. As
-- três palavras, em todas.

revoke all on function public.met_aposta_como(p_seat smallint, p_match uuid, p_em smallint) from public, anon, authenticated;
revoke all on function public.met_bankrupt_como(p_seat smallint, p_match uuid) from public, anon, authenticated;
revoke all on function public.met_bid_como(p_seat smallint, p_match uuid, p_valor integer, p_admin smallint) from public, anon, authenticated;
revoke all on function public.met_build_como(p_seat smallint, p_match uuid, p_prop text, p_n integer) from public, anon, authenticated;
revoke all on function public.met_buy_como(p_seat smallint, p_match uuid) from public, anon, authenticated;
revoke all on function public.met_decline_como(p_seat smallint, p_match uuid) from public, anon, authenticated;
revoke all on function public.met_end_turn_como(p_seat smallint, p_match uuid) from public, anon, authenticated;
revoke all on function public.met_exercer_como(p_seat smallint, p_match uuid, p_id text) from public, anon, authenticated;
revoke all on function public.met_jail_como(p_seat smallint, p_match uuid, p_escolha text) from public, anon, authenticated;
revoke all on function public.met_mortgage_como(p_seat smallint, p_match uuid, p_prop text) from public, anon, authenticated;
revoke all on function public.met_offer_como(p_seat smallint, p_match uuid, p_para smallint, p_da jsonb, p_quer jsonb) from public, anon, authenticated;
revoke all on function public.met_offer_cancel_como(p_seat smallint, p_match uuid, p_id text) from public, anon, authenticated;
revoke all on function public.met_offer_reply_como(p_seat smallint, p_match uuid, p_id text, p_aceita boolean) from public, anon, authenticated;
revoke all on function public.met_pass_como(p_seat smallint, p_match uuid) from public, anon, authenticated;
revoke all on function public.met_roll_como(p_seat smallint, p_match uuid) from public, anon, authenticated;
revoke all on function public.met_sell_como(p_seat smallint, p_match uuid, p_prop text, p_n integer) from public, anon, authenticated;
revoke all on function public.met_unmortgage_como(p_seat smallint, p_match uuid, p_prop text) from public, anon, authenticated;

grant execute on function public.met_aposta(uuid, smallint) to authenticated;
grant execute on function public.met_bankrupt(uuid) to authenticated;
grant execute on function public.met_bid(uuid, integer, smallint) to authenticated;
grant execute on function public.met_build(uuid, text, integer) to authenticated;
grant execute on function public.met_buy(uuid) to authenticated;
grant execute on function public.met_decline(uuid) to authenticated;
grant execute on function public.met_end_turn(uuid) to authenticated;
grant execute on function public.met_exercer(uuid, text) to authenticated;
grant execute on function public.met_jail(uuid, text) to authenticated;
grant execute on function public.met_mortgage(uuid, text) to authenticated;
grant execute on function public.met_offer(uuid, smallint, jsonb, jsonb) to authenticated;
grant execute on function public.met_offer_cancel(uuid, text) to authenticated;
grant execute on function public.met_offer_reply(uuid, text, boolean) to authenticated;
grant execute on function public.met_pass(uuid) to authenticated;
grant execute on function public.met_roll(uuid) to authenticated;
grant execute on function public.met_sell(uuid, text, integer) to authenticated;
grant execute on function public.met_unmortgage(uuid, text) to authenticated;
