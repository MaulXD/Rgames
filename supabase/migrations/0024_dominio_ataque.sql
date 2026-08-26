-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0024 · ataque, avanço, remanejo, fim de turno e fim de partida
--
-- Segunda metade do ciclo de turno. A 0023 trouxe reforço e troca de cartas;
-- aqui está o que decide a partida.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── fim de partida ─────────────────────────────────────────────────────────

/**
 * Este assento venceu?
 *
 * Duas maneiras: cumprir o objetivo secreto, ou tomar o mapa inteiro. A
 * segunda existe porque objetivo é sorteado e alguns são mais fáceis que
 * outros — ninguém deve ficar preso numa partida já decidida.
 */
create or replace function public.dominio_venceu(
  p_match uuid, p_mapa jsonb, p_est jsonb, p_seat smallint
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  obj   jsonb;
  meus  int;
  total int;
begin
  select count(*) into meus
    from jsonb_each_text(p_est -> 'donos') d
   where d.value::smallint = p_seat;
  total := jsonb_array_length(p_mapa -> 'territorios');
  if meus >= total then
    return true;
  end if;

  select mps.data -> 'objetivo' into obj
    from public.match_private_state mps
    join public.match_players mp
      on mp.match_id = mps.match_id and mp.user_id = mps.user_id
   where mps.match_id = p_match and mp.seat = p_seat;

  return public.dominio_objetivo_ok(p_mapa, p_est, p_seat, obj);
end;
$$;

revoke all on function public.dominio_venceu(uuid, jsonb, jsonb, smallint) from public;

/** XP e medalha do Domínio, creditados no mesmo lugar onde a partida acaba. */
create or replace function public.dominio_premia(p_match uuid, p_vencedor smallint)
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
      perform public.dar_xp(linha.user_id, 120,
        jsonb_build_object('partidas', 1, 'vitorias', 1),
        array['general']);
    else
      perform public.dar_xp(linha.user_id, 25,
        jsonb_build_object('partidas', 1), '{}'::text[]);
    end if;
  end loop;
end;
$$;

revoke all on function public.dominio_premia(uuid, smallint) from public;

/** Encerra a partida com um vencedor e devolve o estado final. */
create or replace function public.dominio_termina(
  p_match uuid, p_est jsonb, p_seat smallint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  est  jsonb := p_est;
  qual uuid;
begin
  est := jsonb_set(est, '{phase}', '"fim"');
  est := jsonb_set(est, '{vencedor}', to_jsonb(p_seat));
  est := public.dominio_log(est, jsonb_build_object('k', 'vitoria', 'seat', p_seat));

  update public.matches
     set status = 'finished', ended_at = now(), version = version + 1,
         public_state = est, turn_deadline = null
   where id = p_match
  returning room_id into qual;

  update public.rooms set status = 'lobby' where id = qual;
  perform public.dominio_premia(p_match, p_seat);
  return est;
end;
$$;

revoke all on function public.dominio_termina(uuid, jsonb, smallint) from public;

-- ── atacar ─────────────────────────────────────────────────────────────────

/**
 * Assalta `p_para` a partir de `p_de`, até `p_vezes` vezes seguidas.
 *
 * O ATAQUE EM SÉRIE existe por uma razão de mesa: tomar um território de dez
 * exércitos contra dois são seis, sete rolagens, e no digital cada rolagem
 * viraria um clique e uma espera de rede. Aqui você diz "vai até acabar" e o
 * servidor resolve — devolvendo TODAS as rolagens, para o cliente animar dado
 * por dado sem inventar nenhum resultado.
 *
 * O laço para em três situações: conquistou, sobrou um exército só (não pode
 * mais atacar), ou esgotou as vezes pedidas.
 */
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

    -- A vítima ficou sem nada? Saiu da partida, e a mão dela passa a ser sua.
    -- Herdar a mão é o que torna eliminar alguém uma decisão e não só um
    -- acidente: quem estava com quatro cartas vale um ataque a mais.
    if not exists (
      select 1 from jsonb_each_text(est -> 'donos') d where d.value::smallint = vitima
    ) then
      eliminou := vitima;
      est := public.dominio_marca_fora(est, vitima);
      est := jsonb_set(est, '{eliminados}', (est -> 'eliminados') || to_jsonb(vitima));

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

      est := public.dominio_log(est, jsonb_build_object(
        'k', 'eliminado', 'seat', vitima, 'por', meu));
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

revoke all on function public.dominio_atacar(uuid, text, text, int) from public;
grant execute on function public.dominio_atacar(uuid, text, text, int) to authenticated;

-- ── avançar para o território conquistado ──────────────────────────────────

create or replace function public.dominio_avancar(p_match uuid, p_qtd int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  semente bigint;
  meu     smallint;
  mapa    jsonb;
  est     jsonb;
  av      jsonb;
begin
  select * into est, semente, meu, mapa from public.dominio_na_vez(p_match);

  av := est -> 'avanco';
  if av is null or av = 'null'::jsonb then raise exception 'NOTHING_TO_ADVANCE'; end if;
  if p_qtd < 0 then raise exception 'BAD_AMOUNT'; end if;
  if p_qtd > (av ->> 'max')::int then raise exception 'TOO_MANY'; end if;
  if p_qtd >= (est -> 'exercitos' ->> (av ->> 'de'))::int then
    raise exception 'WOULD_EMPTY';
  end if;

  if p_qtd > 0 then
    est := jsonb_set(est, array['exercitos', av ->> 'de'],
      to_jsonb((est -> 'exercitos' ->> (av ->> 'de'))::int - p_qtd));
    est := jsonb_set(est, array['exercitos', av ->> 'para'],
      to_jsonb((est -> 'exercitos' ->> (av ->> 'para'))::int + p_qtd));
    est := public.dominio_log(est, jsonb_build_object(
      'k', 'avanco', 'seat', meu, 'de', av ->> 'de', 'para', av ->> 'para', 'n', p_qtd));
  end if;

  est := jsonb_set(est, '{avanco}', 'null'::jsonb);

  update public.matches
     set public_state = est, version = version + 1,
         turn_deadline = now() + interval '120 seconds'
   where id = p_match;

  return public.dominio_publico(p_match);
end;
$$;

revoke all on function public.dominio_avancar(uuid, int) from public;
grant execute on function public.dominio_avancar(uuid, int) to authenticated;

-- ── remanejar ──────────────────────────────────────────────────────────────

/**
 * Um movimento por turno, entre territórios seus LIGADOS por territórios seus.
 *
 * Ligação e não vizinhança, de propósito: é o que faz o mapa valer alguma
 * coisa depois de conquistado, e o que transforma um corredor de territórios
 * numa decisão em vez de enfeite.
 */
create or replace function public.dominio_remanejar(
  p_match uuid, p_de text, p_para text, p_qtd int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  semente bigint;
  meu     smallint;
  mapa    jsonb;
  est     jsonb;
begin
  select * into est, semente, meu, mapa from public.dominio_na_vez(p_match);

  if est ->> 'phase' not in ('ataque', 'remanejo') then raise exception 'WRONG_PHASE'; end if;
  if est -> 'avanco' is not null and est -> 'avanco' <> 'null'::jsonb then
    raise exception 'ADVANCE_PENDING';
  end if;
  if coalesce((est ->> 'remanejou')::boolean, false) then raise exception 'ALREADY_MOVED'; end if;
  if p_de = p_para then raise exception 'SAME_TERRITORY'; end if;
  if p_qtd < 1 then raise exception 'BAD_AMOUNT'; end if;
  if est -> 'donos' ->> p_de is null or est -> 'donos' ->> p_para is null then
    raise exception 'NO_SUCH_TERRITORY';
  end if;
  if (est -> 'donos' ->> p_de)::smallint <> meu
     or (est -> 'donos' ->> p_para)::smallint <> meu then
    raise exception 'NOT_YOURS';
  end if;
  if p_qtd >= (est -> 'exercitos' ->> p_de)::int then raise exception 'WOULD_EMPTY'; end if;
  if not public.dominio_conectado(mapa, est, meu, p_de, p_para) then
    raise exception 'NOT_CONNECTED';
  end if;

  est := jsonb_set(est, array['exercitos', p_de],
    to_jsonb((est -> 'exercitos' ->> p_de)::int - p_qtd));
  est := jsonb_set(est, array['exercitos', p_para],
    to_jsonb((est -> 'exercitos' ->> p_para)::int + p_qtd));
  est := jsonb_set(est, '{remanejou}', 'true'::jsonb);
  est := jsonb_set(est, '{phase}', '"remanejo"');
  est := public.dominio_log(est, jsonb_build_object(
    'k', 'remanejo', 'seat', meu, 'de', p_de, 'para', p_para, 'n', p_qtd));

  update public.matches
     set public_state = est, version = version + 1,
         turn_deadline = now() + interval '120 seconds'
   where id = p_match;

  return public.dominio_publico(p_match);
end;
$$;

revoke all on function public.dominio_remanejar(uuid, text, text, int) from public;
grant execute on function public.dominio_remanejar(uuid, text, text, int) to authenticated;

-- ── encerrar o turno ───────────────────────────────────────────────────────

/**
 * Passa a vez.
 *
 * Faz quatro coisas, nesta ordem, e a ordem importa:
 *   1. dá a carta, se conquistou algo neste turno;
 *   2. confere se o objetivo foi cumprido — pode ter sido pela carta;
 *   3. acha o próximo assento ATIVO (quem foi eliminado é pulado);
 *   4. calcula o reforço dele, que depende do mapa que ele tem AGORA.
 *
 * O passo 4 no fim, e não no começo do turno seguinte, é o que faz o número
 * aparecer na tela junto com a virada — sem um segundo de "carregando".
 */
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

  select i into onde from generate_subscripts(ativos, 1) i where ativos[i] = meu;
  proximo := ativos[(coalesce(onde, 0) % array_length(ativos, 1)) + 1];

  est := jsonb_set(est, '{turnSeat}', to_jsonb(proximo));
  est := jsonb_set(est, '{phase}', '"reforco"');
  est := jsonb_set(est, '{conquistou}', 'false'::jsonb);
  est := jsonb_set(est, '{remanejou}', 'false'::jsonb);
  est := jsonb_set(est, '{avanco}', 'null'::jsonb);
  if proximo = ativos[1] then
    est := jsonb_set(est, '{round}', to_jsonb(coalesce((est ->> 'round')::int, 1) + 1));
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

revoke all on function public.dominio_encerrar_turno(uuid) from public;
grant execute on function public.dominio_encerrar_turno(uuid) to authenticated;

-- ── faxina: quem sumiu não trava a mesa ────────────────────────────────────

/**
 * Turno vencido passa sozinho.
 *
 * Sem isso, uma pessoa que fecha a aba no meio do turno congela a partida para
 * todos os outros — e "esperar alguém que não vai voltar" é o pior jeito de
 * terminar uma noite de jogo.
 *
 * O reforço não colocado é distribuído no maior território do jogador: é o que
 * um amigo faria por você, e mantém o estado válido.
 */
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
  atual    smallint;
  quantos  int := 0;
begin
  for linha in
    select m.id, m.public_state, m.room_id
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

revoke all on function public.dominio_sweep() from public;

-- a cada minuto, junto com as outras faxinas
select cron.schedule('dominio-sweep', '* * * * *', $cron$select public.dominio_sweep();$cron$)
where not exists (select 1 from cron.job where jobname = 'dominio-sweep');
