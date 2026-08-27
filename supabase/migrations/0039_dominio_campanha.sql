-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0039 · o modo Campanha do Domínio
--
-- O `modo` do Domínio era gravado no estado e não era lido por nada. Isso é
-- configuração decorativa, e configuração decorativa é pior que configuração
-- nenhuma: promete o que não cumpre.
--
-- E o modo que faltava não era um detalhe — a CAMPANHA é o padrão recomendado
-- pelo PRD (§6.5), e é o que conserta os dois piores problemas do WAR:
--
--   · a partida que não acaba → doze rodadas, sempre
--   · quem é eliminado cedo assiste uma hora → ninguém é eliminado
--
-- COMO A CAMPANHA PONTUA, a cada virada de rodada:
--
--   território controlado                          +1 cada
--   continente controlado                          +bônus × 2
--   território tomado de outro nesta rodada         +1 cada
--   rodada inteira sem atacar ninguém              −2
--   objetivo secreto cumprido                      +20, e acaba na hora
--
-- O `−2` é o dente do anti-passividade. Sem ele, a estratégia ótima numa
-- partida por pontos é sentar em cima de um continente e esperar — e "esperar"
-- é a coisa menos divertida que um jogo de tabuleiro pode pedir. Com ele,
-- passividade tem preço, e o preço aparece no placar que todos veem.
--
-- E QUEM É ZERADO VOLTA. Na rodada seguinte, com três exércitos. Ele não vai
-- ganhar, mas continua pontuando, atrapalhando e sendo cortejado — que é o
-- papel mais divertido do fim de um WAR, e o oposto de assistir.
--
-- UMA ADAPTAÇÃO DECLARADA: o PRD diz que quem volta aparece "num território
-- neutro sorteado na borda do mapa". Vantara não tem território neutro — os 42
-- são repartidos na largada. Então quem volta toma o território MAIS FRACO de
-- quem tem MAIS territórios. Preserva as duas intenções do texto (o retorno é
-- fraco, e o líder paga por ele) e não exige inventar uma categoria de
-- território que o mapa não tem.
--
-- O RELÂMPAGO NÃO ESTÁ AQUI, de propósito. O PRD o define com um mapa de 24
-- territórios, e esse mapa não existe. Oferecer um "Relâmpago" que joga igual à
-- Campanha seria mentir no rótulo — e é exatamente o tipo de coisa que o
-- vocabulário fechado de `set_room_settings` existe para impedir.
-- ═══════════════════════════════════════════════════════════════════════════

/**
 * O placar da Campanha, somado a cada virada de rodada.
 *
 * Zera `tomou` e `atacou` depois de contar: os dois valem por RODADA, e
 * carregá-los adiante transformaria "tomou um território na rodada 3" em pontos
 * pelo resto da partida.
 */
create or replace function public.dominio_pontua(p_mapa jsonb, p_est jsonb)
returns jsonb
language plpgsql
as $$
declare
  est    jsonb := p_est;
  j      jsonb;
  assento smallint;
  ganhou int;
  meus   int;
  c      jsonb;
  todos  int;
  tenho  int;
begin
  for j in select value from jsonb_array_elements(est -> 'players') loop
    assento := (j ->> 'seat')::smallint;
    ganhou := 0;

    select count(*) into meus
      from jsonb_each_text(est -> 'donos') d
     where d.value::smallint = assento;
    ganhou := ganhou + meus;

    -- continente inteiro vale o dobro do bônus de reforço: segurar um
    -- continente na Campanha vale mais que na partida clássica, e é o que faz
    -- alguém defender em vez de só avançar
    for c in select value from jsonb_array_elements(p_mapa -> 'continentes') loop
      select count(*) into todos
        from jsonb_array_elements(p_mapa -> 'territorios') t
       where t ->> 'continente' = c ->> 'id';
      select count(*) into tenho
        from jsonb_array_elements(p_mapa -> 'territorios') t
       where t ->> 'continente' = c ->> 'id'
         and coalesce((est -> 'donos' ->> (t ->> 'id'))::smallint, -1) = assento;
      if todos > 0 and tenho = todos then
        ganhou := ganhou + (c ->> 'bonus')::int * 2;
      end if;
    end loop;

    ganhou := ganhou + coalesce((est -> 'tomou' ->> assento::text)::int, 0);

    -- o dente do anti-passividade
    if not coalesce((est -> 'atacou' ->> assento::text)::boolean, false) then
      ganhou := ganhou - 2;
    end if;

    est := jsonb_set(est, array['pontos', assento::text],
      to_jsonb(coalesce((est -> 'pontos' ->> assento::text)::int, 0) + ganhou), true);
  end loop;

  est := jsonb_set(est, '{tomou}', '{}'::jsonb);
  est := jsonb_set(est, '{atacou}', '{}'::jsonb);
  est := public.dominio_log(est, jsonb_build_object('k', 'placar'));
  return est;
end;
$$;

revoke all on function public.dominio_pontua(jsonb, jsonb) from public, anon, authenticated;

/**
 * Devolve ao mapa quem foi zerado, com três exércitos.
 *
 * Toma o território mais fraco de quem tem mais territórios — ver a adaptação
 * declarada no cabeçalho. O sorteio entre empatados sai da semente, para que a
 * escolha não dependa da ordem em que o jsonb devolve as chaves.
 */
create or replace function public.dominio_restaura(
  p_mapa jsonb, p_est jsonb, p_seed bigint, p_rodada int
)
returns jsonb
language plpgsql
as $$
declare
  est    jsonb := p_est;
  chave  text;
  quando int;
  lider  smallint;
  alvo   text;
begin
  for chave in select key from jsonb_each(coalesce(est -> 'aguardando', '{}'::jsonb)) loop
    quando := (est -> 'aguardando' ->> chave)::int;
    if quando > p_rodada then continue; end if;

    -- quem tem mais territórios paga o retorno
    select d.value::smallint into lider
      from jsonb_each_text(est -> 'donos') d
     group by d.value
     order by count(*) desc, d.value
     limit 1;
    if lider is null then continue; end if;

    -- e paga com o mais fraco que tem
    select d.key into alvo
      from jsonb_each_text(est -> 'donos') d
     where d.value::smallint = lider
     order by (est -> 'exercitos' ->> d.key)::int,
              md5(p_seed::text || ':' || p_rodada::text || ':' || d.key)
     limit 1;
    if alvo is null then continue; end if;

    est := jsonb_set(est, array['donos', alvo], to_jsonb(chave::smallint));
    est := jsonb_set(est, array['exercitos', alvo], '3'::jsonb);
    est := jsonb_set(est, '{aguardando}',
      (est -> 'aguardando') - chave);
    est := public.dominio_log(est, jsonb_build_object(
      'k', 'volta', 'seat', chave::smallint, 'ter', alvo, 'de', lider));
  end loop;

  return est;
end;
$$;

revoke all on function public.dominio_restaura(jsonb, jsonb, bigint, int) from public, anon, authenticated;

/**
 * Encerra a Campanha por rodadas: ganha quem tem mais pontos.
 *
 * Empate é resolvido por territórios e depois por exércitos — duas
 * desempatadoras que medem a mesma coisa que os pontos mediam, em vez de
 * sortear.
 */
create or replace function public.dominio_termina_pontos(p_match uuid, p_est jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  est     jsonb := p_est;
  melhor  smallint;
  melhorP int := -999999;
  j       jsonb;
  assento smallint;
  p       int;
  ters    int;
begin
  for j in select value from jsonb_array_elements(est -> 'players') loop
    assento := (j ->> 'seat')::smallint;
    p := coalesce((est -> 'pontos' ->> assento::text)::int, 0);
    select count(*) into ters
      from jsonb_each_text(est -> 'donos') d
     where d.value::smallint = assento;
    -- o desempate entra no próprio número comparado, com peso pequeno o
    -- bastante para nunca virar a ordem de quem tem mais ponto
    if p * 1000 + ters > melhorP then
      melhorP := p * 1000 + ters;
      melhor := assento;
    end if;
  end loop;

  est := public.dominio_log(est, jsonb_build_object(
    'k', 'fim-rodadas', 'seat', melhor,
    'n', coalesce((est -> 'pontos' ->> melhor::text)::int, 0)));

  return public.dominio_termina(p_match, est, melhor);
end;
$$;

revoke all on function public.dominio_termina_pontos(uuid, jsonb) from public, anon, authenticated;

create or replace function public.dominio_start(p_room uuid)
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
  ters      text[];
  objs      jsonb;
  ordem_obj text[];
  nova      public.matches;
  estado    jsonb;
  donos     jsonb := '{}'::jsonb;
  exercitos jsonb := '{}'::jsonb;
  jogadores jsonb := '[]'::jsonb;
  iniciais  int;
  modo      text;
  i         int;
  assento   smallint;
  dono_id   uuid;
  cor_dele  text;
  sobra     int;
  alvo      text;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into sala from public.rooms r where r.id = p_room;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if sala.host_id <> auth.uid() then raise exception 'NOT_HOST'; end if;
  if sala.game_key <> 'dominio' then raise exception 'WRONG_GAME'; end if;
  if exists (select 1 from public.matches m
              where m.room_id = p_room and m.status = 'running') then
    raise exception 'ALREADY_RUNNING';
  end if;

  select data into mapa from public.game_themes gt where gt.id = 'vantara';
  if mapa is null then raise exception 'NO_MAP'; end if;

  select array_agg(rm.seat order by rm.seat) into assentos
    from public.room_members rm
   where rm.room_id = p_room and rm.seat is not null;
  n := coalesce(array_length(assentos, 1), 0);
  if n < 3 then raise exception 'NEED_THREE'; end if;
  if n > 6 then raise exception 'TOO_MANY'; end if;

  semente := (random() * 9223372036854775806)::bigint;
  iniciais := case n when 3 then 35 when 4 then 30 when 5 then 25 else 20 end;

  /* O MODO PASSA A VALER. Ele era gravado no estado e não era lido por nada —
     configuração decorativa, que é pior que configuração nenhuma porque promete
     o que não cumpre.

     Campanha é o padrão recomendado pelo PRD (§6.5) e o que conserta os dois
     piores problemas do WAR: a partida que não acaba e quem é eliminado cedo
     assistindo uma hora. Doze rodadas, vitória por pontos, e ninguém sai.

     Relâmpago NÃO está aqui de propósito: o PRD o define com um mapa de 24
     territórios, e esse mapa não existe. Oferecer um "Relâmpago" que joga igual
     à Campanha seria mentir no rótulo. */
  modo := coalesce(sala.settings ->> 'modo', 'campanha');
  if modo not in ('campanha', 'classico') then modo := 'campanha'; end if;

  -- territórios embaralhados e repartidos em rodízio, 1 exército em cada
  select public.shuffle_text(array_agg(t ->> 'id'), semente) into ters
    from jsonb_array_elements(mapa -> 'territorios') t;

  for i in 1..array_length(ters, 1) loop
    assento := assentos[((i - 1) % n) + 1];
    donos := donos || jsonb_build_object(ters[i], assento);
    exercitos := exercitos || jsonb_build_object(ters[i], 1);
  end loop;

  -- O resto do exército inicial cai sozinho nos próprios territórios. O WAR de
  -- mesa faz isso um a um, e são dez minutos em que ninguém decide nada.
  for i in 1..n loop
    assento := assentos[i];
    sobra := iniciais - (
      select count(*) from jsonb_each_text(donos) d where d.value::smallint = assento
    );
    while sobra > 0 loop
      select d.key into alvo
        from jsonb_each_text(donos) d
       where d.value::smallint = assento
       order by md5(semente::text || ':' || sobra::text || d.key)
       limit 1;
      exercitos := jsonb_set(exercitos, array[alvo],
        to_jsonb((exercitos ->> alvo)::int + 1));
      sobra := sobra - 1;
    end loop;
  end loop;

  -- objetivos: embaralhados e distribuídos SEM repetir
  select jsonb_agg(value) into objs from jsonb_array_elements(mapa -> 'objetivos');
  select public.shuffle_text(array_agg(g::text), semente + 991) into ordem_obj
    from generate_series(0, jsonb_array_length(objs) - 1) g;

  insert into public.matches (room_id, game_key, seed, public_state, turn_deadline)
  values (p_room, 'dominio', semente, '{}'::jsonb, now() + interval '120 seconds')
  returning * into nova;

  for i in 1..n loop
    assento := assentos[i];

    select rm.user_id, coalesce(rm.color, 'grafite')
      into dono_id, cor_dele
      from public.room_members rm
     where rm.room_id = p_room and rm.seat = assento;

    insert into public.match_players (match_id, user_id, seat)
    values (nova.id, dono_id, assento);

    insert into public.match_private_state (match_id, user_id, data)
    values (
      nova.id, dono_id,
      jsonb_build_object(
        'objetivo', objs -> (ordem_obj[i])::int,
        'cartas', '[]'::jsonb,
        'planos', '[]'::jsonb
      )
    );

    jogadores := jogadores || jsonb_build_array(jsonb_build_object(
      'seat', assento,
      'userId', dono_id,
      'cor', cor_dele,
      'cartas', 0,
      'ativo', true
    ));
  end loop;

  estado := jsonb_build_object(
    'map', 'vantara',
    'mode', modo,
    -- doze rodadas na Campanha; no Clássico só o objetivo encerra
    'rodadaFinal', case modo when 'campanha' then 12 else null end,
    'pontos', '{}'::jsonb,
    'tomou', '{}'::jsonb,
    'atacou', '{}'::jsonb,
    'aguardando', '{}'::jsonb,
    'round', 1,
    'phase', 'reforco',
    'turnSeat', assentos[1],
    'donos', donos,
    'exercitos', exercitos,
    'players', jogadores,
    'eliminados', '[]'::jsonb,
    'conquistou', false,
    'remanejou', false,
    'trocas', 0,
    'rolls', 0,
    'seq', 0,
    'log', '[]'::jsonb,
    'vencedor', null
  );
  estado := jsonb_set(estado, '{reforcoLeft}',
    to_jsonb(public.dominio_reforco(mapa, estado, assentos[1])));

  update public.matches set public_state = estado where id = nova.id;
  update public.rooms set status = 'playing' where id = p_room;

  return jsonb_build_object(
    'id', nova.id, 'status', nova.status,
    'turn_deadline', nova.turn_deadline, 'started_at', nova.started_at,
    'public_state', estado
  );
end;
$$;

create or replace function public.dominio_atacar(
  p_match uuid, p_de text, p_para text, p_vezes int default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  semente   bigint;
  meu       smallint;
  mapa      jsonb;
  est       jsonb;
  vitima    smallint;
  atac      int;
  defe      int;
  i         int;
  rolagens  bigint;
  v_datac   int[];
  v_ddefe   int[];
  v_patac   int;
  v_pdefe   int;
  v_usou    int;
  assaltos  jsonb := '[]'::jsonb;
  conquista boolean := false;
  eliminou  smallint := null;
  cartas_v  jsonb;
  abates    int;
  perfeito  boolean := false;
  venceu    boolean := false;
  vitima_id uuid;
begin
  select * into est, semente, meu, mapa from public.dominio_na_vez(p_match);

  if est ->> 'phase' <> 'ataque' then raise exception 'WRONG_PHASE'; end if;
  if est -> 'avanco' is not null and est -> 'avanco' <> 'null'::jsonb then
    raise exception 'ADVANCE_PENDING';
  end if;
  if p_de = p_para then raise exception 'SAME_TERRITORY'; end if;
  if est -> 'donos' ->> p_de is null or est -> 'donos' ->> p_para is null then
    raise exception 'NO_SUCH_TERRITORY';
  end if;
  if (est -> 'donos' ->> p_de)::smallint <> meu then raise exception 'NOT_YOURS'; end if;
  if (est -> 'donos' ->> p_para)::smallint = meu then raise exception 'TARGET_IS_YOURS'; end if;
  if not (p_para = any(public.dominio_vizinhos(mapa, p_de))) then
    raise exception 'NOT_ADJACENT';
  end if;
  if (est -> 'exercitos' ->> p_de)::int < 2 then raise exception 'NEED_TWO_ARMIES'; end if;
  if p_vezes < 1 or p_vezes > 12 then raise exception 'BAD_ROUNDS'; end if;

  vitima := (est -> 'donos' ->> p_para)::smallint;
  rolagens := coalesce((est ->> 'rolls')::bigint, 0);

  -- atacar já conta, mesmo perdendo: o que a Campanha pune é a PASSIVIDADE,
  -- não a derrota
  est := jsonb_set(est, array['atacou', meu::text], 'true'::jsonb, true);

  for i in 1..p_vezes loop
    atac := (est -> 'exercitos' ->> p_de)::int;
    defe := (est -> 'exercitos' ->> p_para)::int;
    exit when atac < 2 or defe < 1;

    select d_atac, d_defe, perde_atac, perde_defe, usou
      into v_datac, v_ddefe, v_patac, v_pdefe, v_usou
      from public.dominio_assalto(semente, rolagens, atac, defe);
    rolagens := rolagens + v_usou;

    est := jsonb_set(est, array['exercitos', p_de], to_jsonb(atac - v_patac));
    est := jsonb_set(est, array['exercitos', p_para], to_jsonb(defe - v_pdefe));

    if v_pdefe = 3 then perfeito := true; end if;

    assaltos := assaltos || jsonb_build_array(jsonb_build_object(
      'dAtac', v_datac, 'dDefe', v_ddefe,
      'perdeAtac', v_patac, 'perdeDefe', v_pdefe,
      'atac', atac - v_patac, 'defe', defe - v_pdefe));

    if defe - v_pdefe <= 0 then
      conquista := true;
      exit;
    end if;
  end loop;

  if jsonb_array_length(assaltos) = 0 then
    raise exception 'NO_ASSAULT_POSSIBLE';
  end if;

  if conquista then
    -- Um exército muda de território AGORA: território com zero exército é
    -- estado inválido, e o cliente não pode ser o dono dessa correção.
    est := jsonb_set(est, array['exercitos', p_de],
      to_jsonb((est -> 'exercitos' ->> p_de)::int - 1));
    est := jsonb_set(est, array['exercitos', p_para], to_jsonb(1));
    est := jsonb_set(est, array['donos', p_para], to_jsonb(meu));
    est := jsonb_set(est, '{conquistou}', 'true'::jsonb);

    -- o avanço opcional: até três no total, como na mesa, e a origem nunca
    -- fica vazia
    if least(2, (est -> 'exercitos' ->> p_de)::int - 1) > 0 then
      est := jsonb_set(est, '{avanco}', jsonb_build_object(
        'de', p_de, 'para', p_para,
        'max', least(2, (est -> 'exercitos' ->> p_de)::int - 1)));
    end if;

    est := public.dominio_log(est, jsonb_build_object(
      'k', 'conquista', 'seat', meu, 'de', p_de, 'para', p_para, 'vitima', vitima));

    /* O PLACAR DA CAMPANHA conta território tomado de OUTRO JOGADOR nesta
       rodada, e conta atacar. As duas coisas juntas são o dente do
       anti-passividade: quem não ataca perde dois pontos no fim da rodada, e
       quem ataca e toma ganha um por território. Ver §6.5 do PRD. */
    est := jsonb_set(est, array['tomou', meu::text],
      to_jsonb(coalesce((est -> 'tomou' ->> meu::text)::int, 0) + 1), true);

    -- A vítima ficou sem nada? Saiu da partida, e a mão dela passa a ser sua.
    -- Herdar a mão é o que torna eliminar alguém uma decisão e não só um
    -- acidente: quem estava com quatro cartas vale um ataque a mais.
    if not exists (
      select 1 from jsonb_each_text(est -> 'donos') d where d.value::smallint = vitima
    ) then
      eliminou := vitima;

      /* NA CAMPANHA NINGUÉM É ELIMINADO. Quem é zerado volta na rodada
         seguinte com três exércitos, e continua pontuando, atrapalhando e
         sendo cortejado — que é o papel mais divertido do fim de um WAR. No
         Clássico, sai mesmo. */
      if (est ->> 'mode') = 'campanha' then
        est := jsonb_set(est, array['aguardando', vitima::text],
          to_jsonb(coalesce((est ->> 'round')::int, 1) + 1), true);
        est := public.dominio_log(est, jsonb_build_object(
          'k', 'zerado', 'seat', vitima, 'por', meu));
      else
        est := public.dominio_marca_fora(est, vitima);
        est := jsonb_set(est, '{eliminados}', (est -> 'eliminados') || to_jsonb(vitima));
      end if;

      abates := coalesce((est -> 'abates' ->> meu::text)::int, 0) + 1;
      est := jsonb_set(est, array['abates', meu::text], to_jsonb(abates), true);

      select mp.user_id into vitima_id
        from public.match_players mp
       where mp.match_id = p_match and mp.seat = vitima;

      select coalesce(mps.data -> 'cartas', '[]'::jsonb) into cartas_v
        from public.match_private_state mps
       where mps.match_id = p_match and mps.user_id = vitima_id;

      update public.match_private_state mps
         set data = jsonb_set(mps.data, '{cartas}',
               coalesce(mps.data -> 'cartas', '[]'::jsonb) || coalesce(cartas_v, '[]'::jsonb))
       where mps.match_id = p_match and mps.user_id = auth.uid();

      update public.match_private_state mps
         set data = jsonb_set(mps.data, '{cartas}', '[]'::jsonb)
       where mps.match_id = p_match and mps.user_id = vitima_id;

      est := public.dominio_conta_cartas(est, vitima, 0);
      est := public.dominio_conta_cartas(est, meu, (
        select jsonb_array_length(coalesce(mps.data -> 'cartas', '[]'::jsonb))
          from public.match_private_state mps
         where mps.match_id = p_match and mps.user_id = auth.uid()));

      if (est ->> 'mode') <> 'campanha' then
        est := public.dominio_log(est, jsonb_build_object(
          'k', 'eliminado', 'seat', vitima, 'por', meu));
      end if;
    end if;
  end if;

  est := jsonb_set(est, '{rolls}', to_jsonb(rolagens));
  est := jsonb_set(est, '{seq}', to_jsonb(coalesce((est ->> 'seq')::int, 0) + 1));

  venceu := public.dominio_venceu(p_match, mapa, est, meu);

  if venceu then
    est := public.dominio_termina(p_match, est, meu);
  else
    update public.matches
       set public_state = est, version = version + 1,
           turn_deadline = now() + interval '120 seconds'
     where id = p_match;
  end if;

  if perfeito then
    perform public.dar_xp(auth.uid(), 5, '{}'::jsonb, array['assalto-perfeito']);
  end if;

  return jsonb_build_object(
    'assaltos', assaltos,
    'conquistou', conquista,
    'eliminou', eliminou,
    'venceu', venceu,
    'match', public.dominio_publico(p_match)
  );
end;
$$;

create or replace function public.dominio_encerrar_turno(p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  semente  bigint;
  meu      smallint;
  mapa     jsonb;
  est      jsonb;
  carta    jsonb;
  dadas    int;
  quantas  int;
  ativos   smallint[];
  onde     int;
  proximo  smallint;
  tentativa int;
  rodada   int;
  final    int;
  ganhou   boolean;
begin
  select * into est, semente, meu, mapa from public.dominio_na_vez(p_match);

  if est -> 'avanco' is not null and est -> 'avanco' <> 'null'::jsonb then
    raise exception 'ADVANCE_PENDING';
  end if;
  if (est ->> 'reforcoLeft')::int > 0 then
    raise exception 'PLACE_REINFORCEMENTS';   -- exército parado não passa a vez
  end if;

  -- 1. a carta da conquista
  if coalesce((est ->> 'conquistou')::boolean, false) then
    dadas := coalesce((est ->> 'cartasDadas')::int, 0);
    carta := public.dominio_carta(mapa, semente, dadas);
    est := jsonb_set(est, '{cartasDadas}', to_jsonb(dadas + 1), true);

    update public.match_private_state mps
       set data = jsonb_set(mps.data, '{cartas}',
             coalesce(mps.data -> 'cartas', '[]'::jsonb) || jsonb_build_array(carta))
     where mps.match_id = p_match and mps.user_id = auth.uid();

    select jsonb_array_length(coalesce(mps.data -> 'cartas', '[]'::jsonb)) into quantas
      from public.match_private_state mps
     where mps.match_id = p_match and mps.user_id = auth.uid();

    est := public.dominio_conta_cartas(est, meu, quantas);
    est := public.dominio_log(est, jsonb_build_object('k', 'carta', 'seat', meu));
  end if;

  -- 2. o objetivo pode ter sido cumprido no turno
  ganhou := public.dominio_venceu(p_match, mapa, est, meu);
  if ganhou then
    est := public.dominio_termina(p_match, est, meu);
    return public.dominio_publico(p_match);
  end if;

  -- 3. o próximo assento ativo
  select array_agg((j ->> 'seat')::smallint order by (j ->> 'seat')::smallint)
    into ativos
    from jsonb_array_elements(est -> 'players') j
   where coalesce((j ->> 'ativo')::boolean, true);

  if coalesce(array_length(ativos, 1), 0) <= 1 then
    est := public.dominio_termina(p_match, est, meu);
    return public.dominio_publico(p_match);
  end if;

  /* O PRÓXIMO A JOGAR pula quem está aguardando volta. Na Campanha, quem foi
     zerado fica de fora até a rodada seguinte — dar-lhe um turno sem nenhum
     território seria um turno em que não há nada a fazer. */
  select i into onde from generate_subscripts(ativos, 1) i where ativos[i] = meu;
  proximo := ativos[(coalesce(onde, 0) % array_length(ativos, 1)) + 1];

  for tentativa in 1..array_length(ativos, 1) loop
    exit when est -> 'aguardando' ->> proximo::text is null
              or (est -> 'aguardando' ->> proximo::text)::int
                 <= coalesce((est ->> 'round')::int, 1);
    select i into onde from generate_subscripts(ativos, 1) i where ativos[i] = proximo;
    proximo := ativos[(coalesce(onde, 0) % array_length(ativos, 1)) + 1];
  end loop;

  est := jsonb_set(est, '{turnSeat}', to_jsonb(proximo));
  est := jsonb_set(est, '{phase}', '"reforco"');
  est := jsonb_set(est, '{conquistou}', 'false'::jsonb);
  est := jsonb_set(est, '{remanejou}', 'false'::jsonb);
  est := jsonb_set(est, '{avanco}', 'null'::jsonb);
  /* A VIRADA DA RODADA é onde a Campanha acontece: pontua, devolve quem foi
     zerado, e confere se a décima segunda rodada passou. */
  if proximo = ativos[1] then
    rodada := coalesce((est ->> 'round')::int, 1) + 1;
    est := jsonb_set(est, '{round}', to_jsonb(rodada));

    if (est ->> 'mode') = 'campanha' then
      est := public.dominio_pontua(mapa, est);
      est := public.dominio_restaura(mapa, est, semente, rodada);

      final := (est ->> 'rodadaFinal')::int;
      if final is not null and rodada > final then
        return public.dominio_termina_pontos(p_match, est);
      end if;
    end if;
  end if;

  -- 4. o reforço de quem entra
  est := jsonb_set(est, '{reforcoLeft}',
    to_jsonb(public.dominio_reforco(mapa, est, proximo)));
  est := public.dominio_log(est, jsonb_build_object('k', 'vez', 'seat', proximo));

  update public.matches
     set public_state = est, version = version + 1,
         turn_deadline = now() + interval '120 seconds'
   where id = p_match;

  return public.dominio_publico(p_match);
end;
$$;

create or replace function public.dominio_sweep()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  linha    record;
  est      jsonb;
  mapa     jsonb;
  resta    int;
  maior    text;
  ativos   smallint[];
  onde     int;
  proximo  smallint;
  rodada   int;
  atual    smallint;
  quantos  int := 0;
begin
  for linha in
    select m.id, m.public_state, m.room_id, m.seed
      from public.matches m
     where m.game_key = 'dominio' and m.status = 'running'
       and m.turn_deadline is not null and m.turn_deadline < now()
     for update skip locked
  loop
    est := linha.public_state;
    select data into mapa from public.game_themes gt where gt.id = (est ->> 'map');
    atual := (est ->> 'turnSeat')::smallint;

    -- exército que ficou na mão vai para o maior território
    resta := coalesce((est ->> 'reforcoLeft')::int, 0);
    if resta > 0 then
      select d.key into maior
        from jsonb_each_text(est -> 'donos') d
       where d.value::smallint = atual
       order by (est -> 'exercitos' ->> d.key)::int desc, d.key
       limit 1;
      if maior is not null then
        est := jsonb_set(est, array['exercitos', maior],
          to_jsonb((est -> 'exercitos' ->> maior)::int + resta));
        est := public.dominio_log(est, jsonb_build_object(
          'k', 'reforco-automatico', 'seat', atual, 'ter', maior, 'n', resta));
      end if;
      est := jsonb_set(est, '{reforcoLeft}', to_jsonb(0));
    end if;

    select array_agg((j ->> 'seat')::smallint order by (j ->> 'seat')::smallint)
      into ativos
      from jsonb_array_elements(est -> 'players') j
     where coalesce((j ->> 'ativo')::boolean, true);

    if coalesce(array_length(ativos, 1), 0) <= 1 then
      continue;
    end if;

    select i into onde from generate_subscripts(ativos, 1) i where ativos[i] = atual;
    proximo := ativos[(coalesce(onde, 0) % array_length(ativos, 1)) + 1];

    -- a faxina passa a vez e faz a mesma virada de rodada que o turno normal:
    -- contrato, placar e volta de quem foi zerado não param porque alguém
    -- fechou a aba
    if proximo = ativos[1] then
      rodada := coalesce((est ->> 'round')::int, 1) + 1;
      est := jsonb_set(est, '{round}', to_jsonb(rodada));
      if (est ->> 'mode') = 'campanha' then
        est := public.dominio_pontua(mapa, est);
        est := public.dominio_restaura(mapa, est, linha.seed, rodada);
      end if;
    end if;

    est := jsonb_set(est, '{turnSeat}', to_jsonb(proximo));
    est := jsonb_set(est, '{phase}', '"reforco"');
    est := jsonb_set(est, '{conquistou}', 'false'::jsonb);
    est := jsonb_set(est, '{remanejou}', 'false'::jsonb);
    est := jsonb_set(est, '{avanco}', 'null'::jsonb);
    est := jsonb_set(est, '{reforcoLeft}',
      to_jsonb(public.dominio_reforco(mapa, est, proximo)));
    est := public.dominio_log(est, jsonb_build_object(
      'k', 'tempo-esgotado', 'seat', atual));
    est := public.dominio_log(est, jsonb_build_object('k', 'vez', 'seat', proximo));

    update public.matches
       set public_state = est, version = version + 1,
           turn_deadline = now() + interval '120 seconds'
     where id = linha.id;

    quantos := quantos + 1;
  end loop;

  return quantos;
end;
$$;

revoke all on function public.dominio_start(uuid) from public, anon, authenticated;
grant execute on function public.dominio_start(uuid) to authenticated;
revoke all on function public.dominio_atacar(uuid, text, text, int) from public, anon, authenticated;
grant execute on function public.dominio_atacar(uuid, text, text, int) to authenticated;
revoke all on function public.dominio_encerrar_turno(uuid) from public, anon, authenticated;
grant execute on function public.dominio_encerrar_turno(uuid) to authenticated;
revoke all on function public.dominio_sweep() from public, anon, authenticated;
