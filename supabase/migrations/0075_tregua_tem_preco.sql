-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0075 · o preço de romper a trégua
--
-- 0074 criou a trégua. Este arquivo é o que a torna uma decisão em vez de uma
-- regra: o servidor DEIXA romper, e cobra.
--
--   · dois exércitos a menos no próximo reforço
--   · a marca de TRAIDOR pelo resto da partida, visível a todos
--   · uma linha no registro com nome e território
--
-- A multa mora em `multaReforco` e é descontada no momento em que o reforço da
-- pessoa é CALCULADO — que é quando o turno passa para ela, e não quando ela
-- rompeu. Isso importa: entre romper e pagar existe um turno inteiro em que a
-- mesa sabe o que vem, e é nesse intervalo que a traição vira assunto.
--
-- O desconto vive numa função só (`dominio_aplica_reforco`) porque o reforço é
-- calculado em DOIS lugares — no fim do turno normal e na faxina. Deixar a conta
-- repetida nos dois seria escolher que um dia eles divergissem, e o dia em que
-- divergissem a multa sumiria só para quem perdeu o turno no relógio.
-- ════════════════════════════════════════════════════════════════════════════

/**
 * Calcula e grava o reforço de quem entra na vez, descontando a multa da trégua.
 *
 * A multa é consumida aqui: paga-se uma vez, não a partida inteira. A marca de
 * traidor é que fica.
 */
create or replace function public.dominio_aplica_reforco(
  p_est jsonb, p_mapa jsonb, p_seat smallint
)
returns jsonb
language plpgsql
immutable
as $$
declare
  est   jsonb := p_est;
  base  int;
  multa int;
begin
  base := public.dominio_reforco(p_mapa, est, p_seat);
  multa := coalesce((est -> 'multaReforco' ->> p_seat::text)::int, 0);

  if multa > 0 then
    est := jsonb_set(est, '{multaReforco}', (est -> 'multaReforco') - p_seat::text);
    est := public.dominio_log(est, jsonb_build_object(
      'k', 'tregua-multa', 'seat', p_seat, 'n', least(multa, base)));
  end if;

  -- nunca abaixo de zero: a multa tira exército, não deixa devendo
  return jsonb_set(est, '{reforcoLeft}', to_jsonb(greatest(base - multa, 0)));
end;
$$;

revoke all on function public.dominio_aplica_reforco(jsonb, jsonb, smallint)
  from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.dominio_atacar_como(p_seat smallint, p_match uuid, p_de text, p_para text, p_vezes integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  quem uuid;
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
  select * into est, semente, mapa, quem from public.dominio_ator(p_match, p_seat);
  meu := p_seat;

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

  /* ── ROMPER A TRÉGUA ──────────────────────────────────────────────────
     O servidor DEIXA, e é o ponto todo: uma trégua que ele impusesse não seria
     diplomacia, seria uma regra de movimento — e ninguém se lembra de uma regra
     de movimento no dia seguinte. O que se lembra é de quem prometeu e atacou
     mesmo assim.

     O preço é o que transforma ruído em história: dois exércitos a menos no
     próximo reforço, a marca de Traidor pelo resto da partida, e uma linha no
     registro com nome e território. */
  if public.dominio_tregua_vale(est, meu, vitima) then
    est := jsonb_set(est, '{treguas}', (est -> 'treguas') -
      (least(meu, vitima)::text || ':' || greatest(meu, vitima)::text));
    if not coalesce(est -> 'traidores' @> to_jsonb(array[meu]), false) then
      est := jsonb_set(est, '{traidores}',
        coalesce(est -> 'traidores', '[]'::jsonb) || to_jsonb(array[meu]), true);
    end if;
    est := jsonb_set(est, array['multaReforco', meu::text], to_jsonb(2), true);
    est := public.dominio_log(est, jsonb_build_object(
      'k', 'tregua-rompe', 'seat', meu, 'vitima', vitima, 'ter', p_para));
  end if;
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
       where mps.match_id = p_match and mps.user_id = quem;

      update public.match_private_state mps
         set data = jsonb_set(mps.data, '{cartas}', '[]'::jsonb)
       where mps.match_id = p_match and mps.user_id = vitima_id;

      est := public.dominio_conta_cartas(est, vitima, 0);
      est := public.dominio_conta_cartas(est, meu, (
        select jsonb_array_length(coalesce(mps.data -> 'cartas', '[]'::jsonb))
          from public.match_private_state mps
         where mps.match_id = p_match and mps.user_id = quem));

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
    perform public.dar_xp(quem, 5, '{}'::jsonb, array['assalto-perfeito']);
  end if;

  return jsonb_build_object(
    'assaltos', assaltos,
    'conquistou', conquista,
    'eliminou', eliminou,
    'venceu', venceu,
    'match', public.dominio_publico(p_match)
  );
end;
$function$;

revoke all on function public.dominio_atacar_como(smallint, uuid, text, text, integer) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.dominio_encerrar_turno_como(p_seat smallint, p_match uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  quem uuid;
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
  select * into est, semente, mapa, quem from public.dominio_ator(p_match, p_seat);
  meu := p_seat;

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
     where mps.match_id = p_match and mps.user_id = quem;

    select jsonb_array_length(coalesce(mps.data -> 'cartas', '[]'::jsonb)) into quantas
      from public.match_private_state mps
     where mps.match_id = p_match and mps.user_id = quem;

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
  est := public.dominio_aplica_reforco(est, mapa, proximo);
  est := public.dominio_log(est, jsonb_build_object('k', 'vez', 'seat', proximo));

  update public.matches
     set public_state = est, version = version + 1,
         turn_deadline = now() + interval '120 seconds'
   where id = p_match;

  return public.dominio_publico(p_match);
end;
$function$;

revoke all on function public.dominio_encerrar_turno_como(smallint, uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.dominio_sweep()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  dono     uuid;
  tocou    int;
  quantos  int := 0;
begin
  for linha in
    select m.id, m.public_state, m.room_id, m.seed
      from public.matches m
     where m.game_key = 'dominio' and m.status = 'running'
       and m.turn_deadline is not null and m.turn_deadline < now()
     for update skip locked
  loop
    /* MESA ABANDONADA NÃO SE JOGA SOZINHA.

       A máquina existe para o jogo andar PARA ALGUÉM. Numa mesa em que ninguém
       apareceu nos últimos quinze minutos não há a quem servir — e o que a
       faxina faz ali é jogar turno atrás de turno para uma plateia vazia, a cada
       passada do cron, até a sala expirar em vinte e quatro horas.

       Medido: 27 partidas rodando sem gente há mais de meia hora, e a faxina do
       Dossiê passa a cada DEZ SEGUNDOS. Isso é trabalho que cresce com o uso do
       site e não serve a ninguém.

       Pular preserva a mesa exatamente como ela estava: quem voltar encontra o
       próprio jogo, e o `touch_presence` do cliente religa a faxina na hora. */
    if (public.mesa_abandonada(linha.id)) then
      continue;
    end if;

    est := linha.public_state;
    atual := (est ->> 'turnSeat')::smallint;

    /* MÁQUINA NO RELÓGIO JOGA, não é pulada. Um bloco de exceção por partida:
       máquina travada numa mesa não pode parar a faxina de todas as outras —
       foi essa a lição do `dossie_sweep` em 0033. */
    select mp.user_id into dono
      from public.match_players mp
     where mp.match_id = linha.id and mp.seat = atual;

    if exists (select 1 from public.profiles p where p.id = dono and p.is_bot) then
      /* TODAS as máquinas seguidas, não uma: esperar uma passada do cron por
         máquina seria esperar minutos numa mesa que ninguém está vendo. */
      tocou := 0;
      begin
        tocou := public.dominio_toca_pendentes(linha.id, 8);
      exception when others then
        /* SE O CÉREBRO FALHAR, A MESA NÃO PARA. Antes daqui havia um `continue`
           depois do `raise warning`, e o efeito era o pior possível: a máquina
           não jogava, a vez não passava, e na próxima varredura tudo se repetia
           — a mesa travava para sempre num erro que ninguém via, porque
           `raise warning` não aparece em lugar nenhum em produção.

           Agora o erro cai no caminho de sempre, logo abaixo: a vez passa como
           passa a de quem fechou a aba. Perder o turno é ruim; travar a partida
           de todo mundo é pior. */
        raise warning 'dominio_sweep: maquina travada em % (%)', linha.id, sqlerrm;
        tocou := 0;
      end;
      if tocou > 0 then
        quantos := quantos + tocou;
        continue;
      end if;
    end if;

    /* SEM RELÓGIO QUANDO NÃO HÁ MAIS NINGUÉM.

       O relógio do turno existe para proteger AS OUTRAS PESSOAS de quem sumiu.
       Numa mesa em que todo o resto é máquina, não há quem proteger — e a
       pessoa perde o turno por ter atendido o telefone. No celular isso é o caso
       comum, não o raro: sair do aplicativo já é sair da aba.

       Então: se quem está na vez é gente e não sobrou mais nenhuma pessoa na
       mesa, o relógio é DESLIGADO em vez de correr. O cliente vê
       `turn_deadline` nulo e mostra "sem pressa" no lugar da contagem. */
    if (public.mesa_so_com_maquinas(linha.id, atual)) then
      update public.matches set turn_deadline = null where id = linha.id;
      continue;
    end if;

    select data into mapa from public.game_themes gt where gt.id = (est ->> 'map');

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
    est := public.dominio_aplica_reforco(est, mapa, proximo);
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
$function$;

revoke all on function public.dominio_sweep() from public, anon, authenticated;
