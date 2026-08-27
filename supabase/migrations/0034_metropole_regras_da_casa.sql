-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0034 · as regras da casa da Metrópole, com o preço na etiqueta
--
-- Quatro regras da casa entram no motor, TODAS DESLIGADAS por padrão:
--
--   bolao           — multa e taxa vão para um pote; quem para na Praça leva
--   largadaDobrada  — parar exatamente na Largada paga o salário de novo
--   construirSolto  — construir sem ter o grupo de cor completo
--   semLeilao       — quem não compra devolve a propriedade ao banco
--
-- A DECISÃO DE PRODUTO, e ela é sobre não brigar com ninguém: as regras estão
-- todas aqui, funcionando, e cada uma mostra no lobby O QUE FAZ COM A PARTIDA
-- em minutos. "Bolão da Praça Central · +35 a +50 min" resolve a discussão
-- sozinho, sem que o jogo precise proibir nada. Ver §5.7 do PRD.
--
-- E elas são CONGELADAS no início da partida, não lidas da sala a cada jogada.
-- O motivo é de mesa e não de código: mudar a regra no meio da partida é a
-- forma mais rápida de acabar uma amizade. `met_decline` lia da sala; passa a
-- ler do estado.
--
-- Os corpos abaixo foram gerados a partir dos que já estão em 0026, 0027, 0028
-- e 0031, com só as emendas desta etapa — pelo mesmo motivo da 0031.
-- ═══════════════════════════════════════════════════════════════════════════

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

  /* O BOLÃO DA PRAÇA CENTRAL, quando ligado: multa e taxa não desaparecem no
     banco — vão para um pote, e quem parar na Praça leva tudo.

     Esta é a regra da casa mais popular do mundo e a que mais alonga a
     partida, porque injeta de volta um dinheiro que já tinha saído do jogo e
     adia a quebra de todos. Ela está aqui, funcionando, e DESLIGADA por
     padrão — com o custo em minutos escrito na etiqueta, no lobby. Ninguém
     está proibido de nada; está informado.

     Só multa e taxa entram no pote. Compra de escritura, construção, resgate
     de hipoteca e lance de leilão são pagamento por algo, não penalidade. */
  elsif coalesce((est -> 'regras' ->> 'bolao')::boolean, false)
        and split_part(p_motivo, ':', 1) in
            ('imposto', 'taxa', 'fianca', 'fianca-forcada', 'carta', 'obra') then
    est := jsonb_set(est, '{bolao}',
      to_jsonb(coalesce((est ->> 'bolao')::int, 0) + p_valor), true);
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
$$;

revoke all on function public.met_start(uuid) from public, anon, authenticated;
grant execute on function public.met_start(uuid) to authenticated;
revoke all on function public.met_paga(jsonb, smallint, smallint, int, text) from public, anon, authenticated;
revoke all on function public.met_pousa(jsonb, jsonb, bigint, smallint, int, int) from public, anon, authenticated;
revoke all on function public.met_build(uuid, text, int) from public, anon, authenticated;
grant execute on function public.met_build(uuid, text, int) to authenticated;
revoke all on function public.met_decline(uuid) from public, anon, authenticated;
grant execute on function public.met_decline(uuid) to authenticated;
