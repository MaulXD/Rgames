-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0107 · a máquina investiga, e joga as cartas que compra
--
-- Até aqui, no Modo Avançado, a máquina só sabia RESPONDER a interrogatório.
-- Ela nunca investigava e nunca jogava carta nenhuma — numa mesa mista, isso
-- era uma vantagem para quem é gente, e numa partida solo era o modo inteiro
-- funcionando de um lado só da mesa.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CADA REGRA É UMA FRASE QUE DÁ PARA CONFERIR DE OLHO
--
-- Nenhuma heurística com peso, nenhuma pontuação somada. Uma máquina que joga
-- cartas por uma fórmula que ninguém entende é uma máquina que ninguém consegue
-- dizer se está trapaceando — e no Dossiê a suspeita de trapaça é fatal, porque
-- a máquina TEM acesso ao envelope pela tabela e escolhe não olhar.
--
--   Chave-mestra    estou num lugar que já risquei e existe um candidato longe
--   Interrogatório  peço o tipo em que sei menos, a quem pode saber mais
--   Impressão       nomeio dois dos suspeitos que ainda estão de pé
--   Recado          para mim mesma; ela não faz favor
--   Tempo é curto   por último, porque é a que menos muda a jogada de agora
--   Álibi           quando mostrar entregaria uma carta que ela nunca mostrou
--
-- A ordem é a ordem do valor: a chave-mestra muda ONDE ela está, e isso muda
-- tudo o que vem depois.
--
-- ────────────────────────────────────────────────────────────────────────────
-- INVESTIGAR COM A PRIMEIRA AÇÃO, ANDAR COM A SEGUNDA
--
-- Ela só investiga com as DUAS ações na mão, num lugar que já riscou e onde não
-- há mais ninguém. Assim a carta não custa um passo: ela vasculha com a
-- primeira ação e anda com a segunda.
--
-- A exceção é estar presa pela tempestade, onde andar não é uma opção — e aí
-- investigar com a única ação que sobrou é melhor que não fazer nada. É a mesma
-- lógica do palpite de dentro do lugar fechado (0092): lugar fechado é posição,
-- não punição, e a máquina precisa JOGAR isso, não só sofrer.
--
-- ────────────────────────────────────────────────────────────────────────────
-- A IMPRESSÃO SÓ COM TRÊS CANDIDATOS OU MAIS
--
-- Com dois de pé, nomear os dois devolve "sim" com certeza e não ensina nada: a
-- carta iria embora para confirmar o que ela já sabia. Com três, as duas
-- respostas rendem — que é a promessa da carta.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O ÁLIBI É GASTO NA HORA CERTA, E ISSO É O DIFÍCIL DELE
--
-- Guardá-lo para sempre é o mesmo que não tê-lo. Gastá-lo na primeira refutação
-- é jogá-lo fora. A regra: ela só usa quando tem UMA carta para mostrar e nunca
-- mostrou aquela carta àquela pessoa — que é exatamente quando refutar entrega
-- informação nova. Tendo duas, ela escolhe a repetida e não precisa do álibi;
-- tendo uma já mostrada, refutar não custa nada.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.dossie_bot_passo(p_match uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  est     jsonb;
  tema    jsonb;
  semente bigint;
  assento smallint;
  quem    uuid;
  nivel   text;
  dedu    jsonb;
  priv    jsonb;

  pend    jsonb;
  fila    jsonb;
  naVez   smallint;
  mostrar text;
  tenho   text[];

  aqui    text;
  alvo    text;
  passo   text;
  pistasmao text[];
  alvoseat  smallint;
  tipopede  text;
  susp    text[];
  arma    text[];
  sala    text[];
  fechados text[];
begin
  select m.public_state, m.seed into est, semente
    from public.matches m
   where m.id = p_match and m.game_key = 'dossie' and m.status = 'running'
   for update;
  if not found then return null; end if;

  select gt.data into tema from public.game_themes gt where gt.id = (est ->> 'theme');

  /* ── 0. RESPONDER AO INTERROGATÓRIO ────────────────────────────────────
     Antes até da refutação: aqui não há fila, é uma pessoa só, e enquanto ela
     não responde a mesa inteira para com trinta segundos no relógio.

     A faxina também destrava isto, mas noventa segundos depois. Numa partida
     solo, esperar a faxina para cada pergunta transformaria a carta em castigo
     de quem a jogou. */
  if est ->> 'phase' = 'interroga' and est -> 'pending' <> 'null'::jsonb
     and est -> 'pending' is not null then
    pend := est -> 'pending';
    naVez := (pend ->> 'alvo')::smallint;

    if naVez is not null then
      quem := public.dossie_dono(p_match, naVez);
      if exists (select 1 from public.profiles p where p.id = quem and p.is_bot) then
        select mps.data into priv from public.match_private_state mps
         where mps.match_id = p_match and mps.user_id = quem;

        select array_agg(c order by c) into tenho
          from jsonb_array_elements_text(coalesce(priv -> 'hand', '[]'::jsonb)) c
         where c = any(public.dossie_cartas_do_tipo(tema, pend ->> 'tipo'));

        if tenho is null or array_length(tenho, 1) = 0 then
          perform public.dossie_passa_interroga_como(naVez, p_match);
          return format('interroga:nada(%s)', naVez);
        end if;

        /* MESMA REGRA DA REFUTAÇÃO: mostre de novo o que já mostrou àquela
           pessoa. Carta nova revelada é informação de graça, e a máquina que dá
           informação de graça é a máquina que perde. */
        select c into mostrar
          from unnest(tenho) c
         where exists (
           select 1 from jsonb_array_elements(coalesce(priv -> 'mostrei', '[]'::jsonb)) m
            where m ->> 'card' = c and (m ->> 'para')::smallint = (pend ->> 'bySeat')::smallint
         )
         limit 1;

        if mostrar is null then
          select c into mostrar from unnest(tenho) c
           order by ('x' || substr(md5(semente::text || naVez::text || c), 1, 6))::bit(24)::int
           limit 1;
        end if;

        perform public.dossie_responde_interroga_como(naVez, p_match, mostrar);

        update public.match_private_state
           set data = jsonb_set(coalesce(data, '{}'::jsonb), '{mostrei}',
                 coalesce(data -> 'mostrei', '[]'::jsonb) || jsonb_build_array(
                   jsonb_build_object(
                     'card', mostrar,
                     'para', (pend ->> 'bySeat')::int,
                     'tipo', pend ->> 'tipo',
                     'tinha', (select coalesce(jsonb_agg(c), '[]'::jsonb)
                                 from unnest(tenho) c))), true)
         where match_id = p_match and user_id = quem;

        return format('interroga:mostra(%s)', naVez);
      end if;
    end if;
    return null;   -- é vez de gente responder
  end if;

  /* ── 1. REFUTAR ────────────────────────────────────────────────────────
     Primeiro de todos: enquanto a fila de refutação não anda, a mesa inteira
     espera, e o relógio dela é de trinta segundos. */
  if est ->> 'phase' = 'refute' and est -> 'pending' <> 'null'::jsonb
     and est -> 'pending' is not null then
    pend := est -> 'pending';
    fila := pend -> 'queue';
    naVez := (fila ->> coalesce((pend ->> 'at')::int, 0))::smallint;

    if naVez is not null then
      quem := public.dossie_dono(p_match, naVez);
      if exists (select 1 from public.profiles p where p.id = quem and p.is_bot) then
        select mps.data into priv from public.match_private_state mps
         where mps.match_id = p_match and mps.user_id = quem;

        /* QUAL CARTA MOSTRAR, quando há mais de uma.
           A regra de mesa: mostre de novo a que já mostrou àquela pessoa. Cada
           carta nova revelada é informação de graça para quem perguntou, e a
           máquina que dá informação de graça é a máquina que perde. */
        select array_agg(c order by c) into tenho
          from jsonb_array_elements_text(coalesce(priv -> 'hand', '[]'::jsonb)) c
         where pend -> 'guess' @> to_jsonb(array[c]);

        if tenho is null or array_length(tenho, 1) = 0 then
          perform public.dossie_pass_refute_como(naVez, p_match);
          return format('refuta:passa(%s)', naVez);
        end if;

        /* O ÁLIBI, e a hora certa dele.

           Guardá-lo para sempre é o mesmo que não tê-lo; gastá-lo na primeira
           refutação é jogá-lo fora. Ela usa quando tem UMA carta para mostrar e
           nunca mostrou aquela carta àquela pessoa — que é exatamente quando
           refutar entrega informação nova.

           Com duas na mão ela escolhe a repetida e não precisa do álibi. Com
           uma já mostrada, refutar não custa nada. O caso caro é este, e é o
           único em que ela paga a carta.

           Joga e passa no mesmo passo: entre uma coisa e outra o estado teria
           uma bandeira levantada sem ninguém para baixá-la, e a faxina acharia
           uma refutação pendente com álibi declarado. */
        if array_length(tenho, 1) = 1
           and exists (
             select 1 from public.match_private_state mps,
                         jsonb_array_elements_text(
                           coalesce(mps.data -> 'pistas' -> 'mao', '[]'::jsonb)) c
              where mps.match_id = p_match and mps.user_id = quem and c = 'alibi'
           )
           and not exists (
             select 1 from jsonb_array_elements(coalesce(priv -> 'mostrei', '[]'::jsonb)) m
              where m ->> 'card' = tenho[1]
                and (m ->> 'para')::smallint = (pend ->> 'bySeat')::smallint
           ) then
          perform public.dossie_usar_pista_como(naVez, p_match, 'alibi', '{}'::jsonb);
          perform public.dossie_pass_refute_como(naVez, p_match);
          return format('refuta:alibi(%s)', naVez);
        end if;

        select c into mostrar
          from unnest(tenho) c
         where exists (
           select 1 from jsonb_array_elements(coalesce(priv -> 'mostrei', '[]'::jsonb)) m
            where m ->> 'card' = c and (m ->> 'para')::smallint = (pend ->> 'bySeat')::smallint
         )
         limit 1;

        if mostrar is null then
          -- nenhuma repetida: escolhe estável, sem `random()`
          select c into mostrar from unnest(tenho) c
           order by ('x' || substr(md5(semente::text || naVez::text || c), 1, 6))::bit(24)::int
           limit 1;
        end if;

        perform public.dossie_refute_como(naVez, p_match, mostrar);

        -- e ela ANOTA a quem mostrou, para poder repetir na próxima
        update public.match_private_state
           set data = jsonb_set(coalesce(data, '{}'::jsonb), '{mostrei}',
                 coalesce(data -> 'mostrei', '[]'::jsonb) || jsonb_build_array(
                   jsonb_build_object(
                     'card', mostrar,
                     'para', (pend ->> 'bySeat')::int,
                     -- o palpite vai junto: sem ele nao da para saber, depois,
                     -- se ela TINHA escolha na hora
                     'guess', pend -> 'guess',
                     'tinha', (select coalesce(jsonb_agg(c), '[]'::jsonb)
                                 from unnest(tenho) c))), true)
         where match_id = p_match and user_id = quem;

        return format('refuta:mostra(%s)', naVez);
      end if;
    end if;
    return null;   -- é vez de gente refutar
  end if;

  /* ── 2. A VEZ DELA ────────────────────────────────────────────────────── */
  if est ->> 'phase' <> 'turn' then return null; end if;

  assento := (est ->> 'turnSeat')::smallint;
  quem := public.dossie_dono(p_match, assento);
  if not exists (select 1 from public.profiles p where p.id = quem and p.is_bot) then
    return null;
  end if;

  select coalesce(rm.bot_nivel, 'medio') into nivel
    from public.matches m
    join public.room_members rm on rm.room_id = m.room_id and rm.user_id = quem
   where m.id = p_match;
  nivel := coalesce(nivel, 'medio');

  dedu := public.dossie_deduz(p_match, assento);
  susp := public.dossie_candidatos(tema, dedu, 'suspect');
  arma := public.dossie_candidatos(tema, dedu, 'weapon');
  sala := public.dossie_candidatos(tema, dedu, 'room');

  /* 2a. FECHOU O CASO? Um candidato em cada categoria e ela ainda não acusou.
     Nunca acusa sem certeza: errar vira fantasma, e máquina que se suicida por
     chute não é adversário mais fácil, é adversário quebrado. */
  if coalesce(array_length(susp, 1), 0) = 1
     and coalesce(array_length(arma, 1), 0) = 1
     and coalesce(array_length(sala, 1), 0) = 1
     and not coalesce(est -> 'accused' @> to_jsonb(array[assento]), false) then
    perform public.dossie_accuse_como(assento, p_match, susp[1], arma[1], sala[1]);
    return format('acusa(%s) %s, %s, %s', assento, susp[1], arma[1], sala[1]);
  end if;

  -- fantasma não joga, só refuta
  if coalesce(est -> 'ghosts' @> to_jsonb(array[assento]), false) then
    perform public.dossie_end_turn_como(assento, p_match);
    return format('passa(%s) fantasma', assento);
  end if;

  aqui := est -> 'positions' ->> assento::text;
  fechados := public.dossie_fechados(est);

  /* ── 2a-bis. AS CARTAS DE PISTA ─────────────────────────────────────────
     Uma por passo, e sempre a que muda mais a jogada de AGORA. A ordem abaixo é
     a ordem do valor: a chave-mestra muda ONDE ela está, e isso muda tudo o que
     vem depois.

     Cada regra é uma frase que dá para conferir de olho — nenhuma pontuação
     somada, nenhum peso. Uma máquina que joga cartas por uma fórmula que
     ninguém entende é uma máquina que ninguém consegue dizer se está
     trapaceando, e no Dossiê a suspeita de trapaça é fatal: ela TEM acesso ao
     envelope pela tabela e escolhe não olhar. */
  if est -> 'pistas' is not null and est -> 'pistas' <> 'null'::jsonb then
    select array_agg(c) into pistasmao
      from public.match_private_state mps,
           jsonb_array_elements_text(coalesce(mps.data -> 'pistas' -> 'mao', '[]'::jsonb)) c
     where mps.match_id = p_match and mps.user_id = quem;
  end if;

  if pistasmao is not null then
    /* CHAVE-MESTRA: estou num lugar que já risquei, e existe um candidato que
       não dá para alcançar andando. É a única forma de estar em dois lugares
       numa rodada, e gastá-la para andar até o vizinho seria jogá-la fora. */
    if 'chave-mestra' = any(pistasmao) and aqui is not null and not (aqui = any(sala)) then
      select s into alvo
        from unnest(sala) s
       where s <> aqui and not (s = any(fechados))
       order by ('x' || substr(md5(semente::text || assento::text || s), 1, 6))::bit(24)::int
       limit 1;
      if alvo is not null then
        perform public.dossie_usar_pista_como(
          assento, p_match, 'chave-mestra', jsonb_build_object('para', alvo));
        return format('pista(%s) chave-mestra para %s', assento, alvo);
      end if;
    end if;

    /* INTERROGATÓRIO: o tipo em que ela sabe MENOS, com quem pode saber MAIS.

       "Sabe menos" é ter mais candidatos de pé. "Pode saber mais" é o assento
       cujas cartas daquele tipo ela ainda não descartou — perguntar a quem ela
       já provou não ter nada do tipo é queimar a carta para ouvir o que já
       sabe. */
    if 'interrogatorio' = any(pistasmao) then
      tipopede := case
        when coalesce(array_length(susp, 1), 0) >= coalesce(array_length(arma, 1), 0)
         and coalesce(array_length(susp, 1), 0) >= coalesce(array_length(sala, 1), 0)
        then 'suspects'
        when coalesce(array_length(arma, 1), 0) >= coalesce(array_length(sala, 1), 0)
        then 'weapons'
        else 'rooms'
      end;

      select mp.seat into alvoseat
        from public.match_players mp
       where mp.match_id = p_match and mp.seat <> assento
       order by (
         select count(*)
           from unnest(public.dossie_cartas_do_tipo(tema, tipopede)) c
          where not coalesce(dedu -> 'naoTem' -> mp.seat::text, '[]'::jsonb)
                  @> to_jsonb(array[c])
       ) desc, mp.seat
       limit 1;

      if alvoseat is not null then
        perform public.dossie_usar_pista_como(
          assento, p_match, 'interrogatorio',
          jsonb_build_object('alvo', alvoseat, 'tipo', tipopede));
        return format('pista(%s) interroga %s sobre %s', assento, alvoseat, tipopede);
      end if;
    end if;

    /* IMPRESSÃO DIGITAL: só com TRÊS suspeitos de pé ou mais.

       Com dois, nomear os dois devolve "sim" com certeza e não ensina nada — a
       carta iria embora para confirmar o que ela já sabia. Com três, as duas
       respostas rendem, que é a promessa da carta. */
    if 'impressao' = any(pistasmao) and coalesce(array_length(susp, 1), 0) >= 3 then
      perform public.dossie_usar_pista_como(
        assento, p_match, 'impressao', jsonb_build_object('a', susp[1], 'b', susp[2]));
      return format('pista(%s) impressao %s/%s', assento, susp[1], susp[2]);
    end if;

    /* RECADO ANÔNIMO: para si mesma. Ela não faz favor.

       E só quando há novidade — o servidor recusa com RECADO_SEM_NOVIDADE, e
       uma exceção levantada aqui dentro sobe pela faxina inteira e para a mesa
       (foi assim em 0033). Perguntar antes é mais barato que tratar depois. */
    if 'recado' = any(pistasmao)
       and public.dossie_recado_para(p_match, assento) is not null then
      perform public.dossie_usar_pista_como(
        assento, p_match, 'recado', jsonb_build_object('alvo', assento));
      return format('pista(%s) recado para si', assento);
    end if;

    /* TEMPO É CURTO: por último, porque é a que menos muda a jogada de agora.
       Não custa ação e sempre rende alguma coisa, então não há o que decidir —
       o que havia era a ordem, e ela é esta. */
    if 'tempo-curto' = any(pistasmao)
       and public.dossie_next_seat(est, assento) is not null then
      perform public.dossie_usar_pista_como(assento, p_match, 'tempo-curto', '{}'::jsonb);
      return format('pista(%s) tempo-curto', assento);
    end if;
  end if;

  /* 2b. PALPITAR, se a sala em que ela está ainda é candidata.
     Palpitar numa sala já riscada gasta o turno para confirmar o que ela já
     sabe — e é o erro que mais denuncia uma máquina sem cabeça. */
  if (est ->> 'actionsLeft')::int >= 1
     and aqui is not null
     and (nivel = 'facil' or aqui = any(sala) or coalesce(array_length(sala, 1), 0) <= 1
          /* PRESA PELA TEMPESTADE, ela palpita de qualquer jeito.

             Aqui a regra normal ("não gaste turno palpitando num lugar que
             você já riscou") se inverte, porque a alternativa mudou. Solta, a
             escolha é entre palpitar num lugar riscado e ANDAR até um que
             importa — e andar ganha. Presa, a escolha é entre palpitar num
             lugar riscado e NÃO FAZER NADA.

             E palpitar nunca é nada: mesmo com o lugar já descartado, as
             respostas ensinam sobre o suspeito e o objeto. É exatamente a
             razão pela qual o PRD 03 §3 diz que lugar fechado é posição e não
             punição — a máquina precisa jogar isso, não só sofrer. */
          or aqui = any(fechados)) then
    perform public.dossie_suggest_como(
      assento, p_match,
      susp[1 + (('x' || substr(md5(semente::text || coalesce(est ->> 'seq', '0') || 's'), 1, 6))::bit(24)::int
                % greatest(coalesce(array_length(susp, 1), 1), 1))],
      arma[1 + (('x' || substr(md5(semente::text || coalesce(est ->> 'seq', '0') || 'a'), 1, 6))::bit(24)::int
                % greatest(coalesce(array_length(arma, 1), 1), 1))]
    );
    return format('palpita(%s) em %s', assento, aqui);
  end if;

  /* ── 2b-bis. INVESTIGAR ─────────────────────────────────────────────────
     Com as DUAS ações na mão: ela vasculha com a primeira e anda com a segunda,
     e assim a carta não custa um passo.

     A exceção é estar presa pela tempestade, onde andar não é uma opção — e
     investigar com a única ação que sobrou é melhor que não fazer nada. Mesma
     lógica do palpite de dentro do lugar fechado: lugar fechado é posição, não
     punição, e a máquina precisa JOGAR isso, e não só sofrer.

     O lugar tem de estar vazio de gente, que é a regra do servidor; conferir
     aqui evita que LUGAR_COM_GENTE suba pela faxina e pare a mesa. */
  if est -> 'pistas' is not null and est -> 'pistas' <> 'null'::jsonb
     and aqui is not null
     and not (aqui = any(sala))
     and ((est ->> 'actionsLeft')::int >= 2
          or ((est ->> 'actionsLeft')::int >= 1 and aqui = any(fechados)))
     and coalesce((est -> 'pistas' ->> 'tirou')::int, 0)
         < coalesce(array_length(public.dossie_pistas_baralho(semente), 1), 0)
     and not exists (
       select 1 from jsonb_each_text(est -> 'positions') pos
        where pos.key <> assento::text and pos.value = aqui
     ) then
    perform public.dossie_investigar_como(assento, p_match);
    return format('investiga(%s) em %s', assento, aqui);
  end if;

  /* 2c. ANDAR na direção da sala candidata mais próxima.

     Presa pela tempestade, ela não anda: cai direto no "passa". Tentar andar
     levantaria ROOM_CLOSED de dentro de `dossie_move_como`, e a exceção subiria
     pela faxina inteira — foi assim que o Dossiê parou de tirar o turno de
     ninguém no relógio uma vez (0033). A máquina que não pode andar passa a vez
     de propósito, não por acidente.

     E o alvo exclui o que está fechado: andar rumo a um lugar onde não se pode
     entrar é gastar o turno para bater na porta. */
  if (est ->> 'actionsLeft')::int >= 1 and aqui is not null
     and not (aqui = any(fechados)) then
    select s into alvo
      from unnest(sala) s
     where s <> aqui and not (s = any(fechados))
     order by ('x' || substr(md5(semente::text || assento::text || s), 1, 6))::bit(24)::int
     limit 1;

    if alvo is not null then
      passo := public.dossie_passo_para(tema, aqui, alvo, fechados);
      if passo is not null then
        perform public.dossie_move_como(assento, p_match, passo);
        return format('anda(%s) para %s', assento, passo);
      end if;
    end if;
  end if;

  -- 2d. nada a fazer: passa
  perform public.dossie_end_turn_como(assento, p_match);
  return format('passa(%s)', assento);
end;
$function$;

revoke all on function public.dossie_bot_passo(uuid) from public, anon, authenticated;
