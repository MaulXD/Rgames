-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0037 · os eventos da cidade
--
-- Um evento global a cada cinco rodadas, valendo por três, anunciado como
-- manchete de jornal. Ver docs/05-PRD-METROPOLE.md §5.6.
--
-- O PROBLEMA QUE ELES RESOLVEM é o meio de jogo monótono: quarenta minutos de
-- "anda e paga" antes do desfecho. O evento muda a temperatura da mesa por três
-- rodadas e cria janela de oportunidade que vale a pena esperar — hipotecar
-- agora ou depois do aperto de crédito passa a ser uma decisão, e não uma
-- formalidade.
--
-- Os seis, e onde cada um pega:
--
--   obra na avenida    → met_aluguel, num grupo de cor sorteado: metade
--   alta temporada     → met_aluguel, nos bairros de praia: metade a mais
--   greve              → met_aluguel, nos transportes: nada
--   boom imobiliário   → met_build: construir custa 30% menos
--   aperto de crédito  → met_mortgage rende 20% menos; met_unmortgage cobra 20%
--   feriadão           → met_salario: a Largada paga o dobro
--
-- TODA CONTA É FRAÇÃO DE INTEIROS. "-50%" é /2, "+50%" é ×3/2, "-30%" é ×7/10.
-- Nunca ×1,5 — dinheiro não passa por ponto flutuante neste projeto, e o
-- validador da cidade confere a cada geração que os números do tabuleiro
-- fecham exatos nessas frações. Se um dia um número novo não fechar, a cidade
-- não é publicada.
--
-- O SORTEIO É DA SEMENTE, e a semente o cliente não lê. Então ninguém sabe qual
-- evento vem na rodada 10 — o que importa, porque saber permitiria segurar uma
-- hipoteca esperando o aperto.
-- ═══════════════════════════════════════════════════════════════════════════

/**
 * O salário efetivo da Largada. Dobra no feriadão.
 *
 * Existe como função para que os DOIS lugares que pagam salário — a passagem
 * pela Largada em `met_roll` e a carta que manda andar em `met_pousa` — usem o
 * mesmo número. Duas leituras separadas de `regras.salario` viveriam
 * divergindo no dia em que uma delas esquecesse o evento.
 */
create or replace function public.met_salario(p_mapa jsonb, p_est jsonb)
returns int
language sql
immutable
as $$
  select case
    when p_est -> 'evento' ->> 'efeito' = 'salario'
    then (p_mapa -> 'regras' ->> 'salario')::int
         * (p_est -> 'evento' ->> 'num')::int
         / (p_est -> 'evento' ->> 'den')::int
    else (p_mapa -> 'regras' ->> 'salario')::int
  end;
$$;

revoke all on function public.met_salario(jsonb, jsonb) from public, anon, authenticated;

/**
 * Expira o evento vencido e sorteia um novo a cada quinta rodada.
 *
 * O sorteio sai da semente e da rodada, então é reprodutível e imprevisível ao
 * mesmo tempo: quem lê o estado público não tem como saber o que vem. Se um
 * evento ainda está valendo, não sorteia outro — dois eventos ao mesmo tempo
 * viraria ruído em vez de janela.
 */
create or replace function public.met_evento(
  p_mapa jsonb, p_est jsonb, p_seed bigint, p_rodada int
)
returns jsonb
language plpgsql
as $$
declare
  est    jsonb := p_est;
  ev     jsonb := p_est -> 'evento';
  lista  jsonb := p_mapa -> 'eventos';
  ordem  text[];
  novo   jsonb;
  grupos text[];
begin
  -- expira
  if ev is not null and ev <> 'null'::jsonb then
    if coalesce((ev ->> 'ate')::int, 0) < p_rodada then
      est := public.met_log(est, jsonb_build_object(
        'k', 'evento-fim', 'texto', ev ->> 'manchete'));
      est := jsonb_set(est, '{evento}', 'null'::jsonb);
      ev := null;
    else
      return est;   -- ainda valendo: não sorteia outro
    end if;
  end if;

  if lista is null or jsonb_array_length(lista) = 0 then return est; end if;
  if p_rodada % 5 <> 0 then return est; end if;

  select public.shuffle_text(array_agg(g::text), p_seed + 4409 * p_rodada) into ordem
    from generate_series(0, jsonb_array_length(lista) - 1) g;
  novo := lista -> (ordem[1])::int;

  -- a obra pega um grupo de cor sorteado, e o sorteio é da mesma semente
  if coalesce((novo ->> 'sorteiaGrupo')::boolean, false) then
    select public.shuffle_text(array_agg(g ->> 'id'), p_seed + 7717 * p_rodada) into grupos
      from jsonb_array_elements(p_mapa -> 'grupos') g;
    novo := novo || jsonb_build_object('grupo', grupos[1]);
  end if;

  novo := novo || jsonb_build_object('desde', p_rodada, 'ate', p_rodada + 2);
  est := jsonb_set(est, '{evento}', novo, true);
  est := public.met_log(est, jsonb_build_object(
    'k', 'evento', 'texto', novo ->> 'manchete', 'motivo', novo ->> 'id'));

  return est;
end;
$$;

revoke all on function public.met_evento(jsonb, jsonb, bigint, int) from public, anon, authenticated;

create or replace function public.met_aluguel(
  p_mapa jsonb, p_est jsonb, p_prop text, p_soma int
)
returns int
language plpgsql
immutable
as $$
declare
  casa    jsonb;
  estado  jsonb;
  dono    smallint;
  quantas int;
  bruto   int;
  ev      jsonb;
begin
  select c into casa
    from jsonb_array_elements(p_mapa -> 'casas') c
   where c ->> 'id' = p_prop
   limit 1;
  if casa is null then return 0; end if;

  estado := p_est -> 'props' -> p_prop;
  dono := (estado ->> 'owner')::smallint;
  if dono is null then return 0; end if;
  if coalesce((estado ->> 'hipotecada')::boolean, false) then return 0; end if;

  if casa ->> 't' = 'bairro' then
    if coalesce((estado ->> 'hotel')::boolean, false) then
      bruto := ((casa -> 'aluguel') ->> 5)::int;
    else
      quantas := coalesce((estado ->> 'casas')::int, 0);
      if quantas > 0 then
        bruto := ((casa -> 'aluguel') ->> quantas)::int;
      elsif public.met_grupo_completo(p_mapa, p_est, dono, casa ->> 'g') then
        -- grupo completo sem construção: aluguel dobrado. É o que faz o
        -- quase-monopólio já valer algo antes da primeira casa.
        bruto := ((casa -> 'aluguel') ->> 0)::int * 2;
      else
        bruto := ((casa -> 'aluguel') ->> 0)::int;
      end if;
    end if;

  elsif casa ->> 't' = 'transporte' then
    quantas := public.met_conta_tipo(p_mapa, p_est, dono, 'transporte');
    bruto := ((casa -> 'aluguel') ->> greatest(quantas - 1, 0))::int;

  elsif casa ->> 't' = 'companhia' then
    quantas := public.met_conta_tipo(p_mapa, p_est, dono, 'companhia');
    bruto := ((casa -> 'multiplo') ->> least(greatest(quantas - 1, 0), 1))::int * p_soma;

  else
    return 0;
  end if;

  /* O EVENTO DA CIDADE, aplicado por último e sempre como FRAÇÃO DE INTEIROS.
     Três dos seis eventos mexem no aluguel:

       obra na avenida   — um grupo sorteado paga metade
       alta temporada    — bairro de praia cobra metade a mais
       greve             — transporte não cobra nada

     A conta é `bruto * num / den` com inteiros, nunca `bruto * 1.5`. Com os
     preços na escala ×10 todas as contas fecham exatas, e o validador da
     cidade (`npm run cidade`) confere isso a cada geração — se um dia um
     número novo não fechar, o tabuleiro não é publicado. */
  ev := p_est -> 'evento';
  if ev is null or ev = 'null'::jsonb then
    return bruto;
  end if;

  if (ev ->> 'efeito' = 'aluguel-grupo' and casa ->> 'g' = ev ->> 'grupo')
     or (ev ->> 'efeito' = 'aluguel-praia' and coalesce((casa ->> 'praia')::boolean, false))
     or (ev ->> 'efeito' = 'aluguel-transporte' and casa ->> 't' = 'transporte') then
    return bruto * (ev ->> 'num')::int / (ev ->> 'den')::int;
  end if;

  return bruto;
end;
$$;

create or replace function public.met_start(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sala      public.rooms;
  mapa      jsonb;
  semente   bigint;
  assentos  smallint[];
  n         int;
  modo      text;
  regras_casa jsonb;
  regras    jsonb;
  jogadores jsonb := '{}'::jsonb;
  props     jsonb := '{}'::jsonb;
  nova      public.matches;
  est       jsonb;
  i         int;
  assento   smallint;
  dono_id   uuid;
  cor_dele  text;
  ids       text[];
  sorteadas text[];
  quantas   int;
  caixa     int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into sala from public.rooms r where r.id = p_room;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if sala.host_id <> auth.uid() then raise exception 'NOT_HOST'; end if;
  if sala.game_key <> 'metropole' then raise exception 'WRONG_GAME'; end if;
  if exists (select 1 from public.matches m
              where m.room_id = p_room and m.status = 'running') then
    raise exception 'ALREADY_RUNNING';
  end if;

  select data into mapa from public.game_themes gt where gt.id = 'capibara';
  if mapa is null then raise exception 'NO_MAP'; end if;
  regras := mapa -> 'regras';

  select array_agg(rm.seat order by rm.seat) into assentos
    from public.room_members rm
   where rm.room_id = p_room and rm.seat is not null;
  n := coalesce(array_length(assentos, 1), 0);
  if n < 2 then raise exception 'NEED_TWO'; end if;
  if n > 6 then raise exception 'TOO_MANY'; end if;

  modo := coalesce(sala.settings ->> 'modo', 'metropole');
  if modo not in ('metropole', 'classico', 'relampago') then modo := 'metropole'; end if;

  /* AS REGRAS DA CASA SÃO CONGELADAS AQUI, e não lidas da sala a cada jogada.
     O motivo é de mesa, não de código: mudar a regra no meio da partida é a
     forma mais rápida de acabar uma amizade. O anfitrião escolhe no lobby, e a
     partida inteira roda com o que estava combinado quando o dado rolou. */
  regras_casa := jsonb_build_object(
    'bolao',           coalesce((sala.settings ->> 'bolao')::boolean, false),
    'largadaDobrada',  coalesce((sala.settings ->> 'largadaDobrada')::boolean, false),
    'construirSolto',  coalesce((sala.settings ->> 'construirSolto')::boolean, false),
    'semLeilao',       coalesce((sala.settings ->> 'semLeilao')::boolean, false)
  );

  semente := (random() * 9223372036854775806)::bigint;
  caixa := case modo when 'relampago' then 20000 else (regras ->> 'bancoInicial')::int end;

  -- toda propriedade começa sem dono, sem casa, sem hipoteca
  select array_agg(c ->> 'id') into ids
    from jsonb_array_elements(mapa -> 'casas') c
   where c ->> 'id' is not null;

  for i in 1..array_length(ids, 1) loop
    props := props || jsonb_build_object(ids[i], jsonb_build_object(
      'owner', null, 'casas', 0, 'hotel', false, 'hipotecada', false));
  end loop;

  for i in 1..n loop
    assento := assentos[i];
    select rm.user_id, coalesce(rm.color, 'grafite')
      into dono_id, cor_dele
      from public.room_members rm
     where rm.room_id = p_room and rm.seat = assento;

    jogadores := jogadores || jsonb_build_object(assento::text, jsonb_build_object(
      'userId', dono_id, 'cor', cor_dele,
      'cash', caixa, 'pos', 0, 'jail', 0, 'livras', 0,
      'quebrado', false, 'investidor', false));
  end loop;

  /* O SORTEIO INICIAL — a mudança mais eficaz do jogo.
     Distribuir três propriedades por pessoa na largada cria quase-monopólios
     na rodada 1, e a negociação começa antes do primeiro dado. Toda a
     lentidão da fase de aquisição do Banco Imobiliário — quinze rodadas de
     "rola e não compra nada" — desaparece. O modo Clássico não sorteia nada,
     e continua ali inteiro para quem quer a experiência original.
     Ver docs/05-PRD-METROPOLE.md §5.4. */
  quantas := case modo
               when 'metropole' then (regras ->> 'sorteioMetropole')::int
               when 'relampago' then (regras ->> 'sorteioRelampago')::int
               else 0
             end;

  if quantas > 0 then
    sorteadas := public.shuffle_text(ids, semente + 31);
    for i in 1..(quantas * n) loop
      -- rodízio: a i-ésima propriedade sorteada vai para o assento da vez,
      -- então ninguém leva três do mesmo grupo por acidente de ordem
      props := jsonb_set(props, array[sorteadas[i], 'owner'],
        to_jsonb(assentos[((i - 1) % n) + 1]));
    end loop;
  end if;

  insert into public.matches (room_id, game_key, seed, public_state, turn_deadline)
  values (p_room, 'metropole', semente, '{}'::jsonb, now() + interval '90 seconds')
  returning * into nova;

  for i in 1..n loop
    insert into public.match_players (match_id, user_id, seat)
    values (nova.id, (jogadores -> assentos[i]::text ->> 'userId')::uuid, assentos[i]);
    insert into public.match_private_state (match_id, user_id, data)
    values (nova.id, (jogadores -> assentos[i]::text ->> 'userId')::uuid,
            jsonb_build_object('aposta', null, 'notas', '{}'::jsonb));
  end loop;

  est := jsonb_build_object(
    'map', 'capibara',
    'mode', modo,
    'round', 1,
    'turnSeat', assentos[1],
    'phase', 'rolar',
    'players', jogadores,
    'props', props,
    'bank', jsonb_build_object(
      'casas', (regras ->> 'casasNoBanco')::int,
      'hoteis', (regras ->> 'hoteisNoBanco')::int),
    'dados', null,
    'duplos', 0,
    'pendente', null,
    'leilao', null,
    'cartas', jsonb_build_object('sorte', 0, 'reves', 0),
    'regras', regras_casa,
    'evento', null,
    'bolao', 0,
    'ofertas', '[]'::jsonb,
    'contratos', '[]'::jsonb,
    'cSeq', 0,
    'rolls', 0,
    'rodadaFinal', case modo
                     when 'metropole' then (regras ->> 'rodadasMetropole')::int
                     when 'relampago' then (regras ->> 'rodadasRelampago')::int
                     else null
                   end,
    'seq', 1,
    'log', jsonb_build_array(jsonb_build_object('k', 'abre', 'modo', modo, 'seq', 1)),
    'vencedor', null
  );

  update public.matches set public_state = est where id = nova.id;
  update public.rooms set status = 'playing' where id = p_room;

  return jsonb_build_object(
    'id', nova.id, 'status', nova.status,
    'turn_deadline', nova.turn_deadline, 'started_at', nova.started_at,
    'public_state', est
  );
end;
$$;

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
$$;

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
  rende   int;
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
$$;

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
$$;

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
  salario int := public.met_salario(p_mapa, p_est);
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
$$;

revoke all on function public.met_aluguel(jsonb, jsonb, text, int) from public, anon, authenticated;
revoke all on function public.met_start(uuid) from public, anon, authenticated;
grant execute on function public.met_start(uuid) to authenticated;
revoke all on function public.met_roll(uuid) from public, anon, authenticated;
grant execute on function public.met_roll(uuid) to authenticated;
revoke all on function public.met_mortgage(uuid, text) from public, anon, authenticated;
grant execute on function public.met_mortgage(uuid, text) to authenticated;
revoke all on function public.met_unmortgage(uuid, text) from public, anon, authenticated;
grant execute on function public.met_unmortgage(uuid, text) to authenticated;
revoke all on function public.met_build(uuid, text, int) from public, anon, authenticated;
grant execute on function public.met_build(uuid, text, int) to authenticated;
revoke all on function public.met_pousa(jsonb, jsonb, bigint, smallint, int, int) from public, anon, authenticated;
revoke all on function public.met_end_turn(uuid) from public, anon, authenticated;
grant execute on function public.met_end_turn(uuid) to authenticated;
revoke all on function public.met_sweep() from public, anon, authenticated;
