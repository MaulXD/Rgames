-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0116 · Modo Assassino
--
-- Um jogador é sorteado assassino e RECEBE a solução. Joga normalmente, e vence
-- se ninguém fechar o caso corretamente em doze rodadas.
--
-- Os detetives não sabem quem é. É o que transforma o Dossiê de dedução sobre
-- CARTAS em dedução sobre GENTE — e é a variante que o PRD 03 §6.9 diz que a
-- mesa mais vai pedir depois de conhecer.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O ASSASSINO NÃO FECHA O CASO, E ESSA É A PRIMEIRA REGRA
--
-- Ele sabe a resposta. Sem esta proibição, o modo inteiro dura um turno: o
-- assassino acusa, acerta, e ganha como detetive. Não é um caso extremo — é a
-- jogada ÓBVIA, e a primeira que qualquer pessoa tentaria.
--
-- `ASSASSINO_NAO_ACUSA`, no servidor. Esconder o botão na tela não bastaria:
-- quem descobre a chamada ganha a partida.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O ASSASSINO É GENTE, SEMPRE QUE HOUVER GENTE
--
-- Duas razões, e a segunda é a que decide.
--
-- A primeira é de jogo: a máquina não usaria a informação. Ela deduz porque não
-- tem outro jeito — dar o envelope a ela e não ensiná-la a mentir produziria um
-- assassino que joga exatamente como um detetive, e um modo social sem ninguém
-- do lado de lá.
--
-- A segunda é de confiança: a suíte confere, partida a partida, que NENHUMA
-- máquina risca carta do envelope, e essa frase vale porque é absoluta. Uma
-- exceção — "menos quando ela é o assassino" — é o tipo de furo que se abre uma
-- vez e some dentro de um `if` para sempre.
--
-- Mesa só de máquinas cai no primeiro assento, e é uma partida que não existe
-- fora de teste.
--
-- ────────────────────────────────────────────────────────────────────────────
-- DOZE RODADAS, E O RELÓGIO É PÚBLICO
--
-- `rodadaFinal` fica no estado público desde o começo, com a rodada corrente ao
-- lado. Quem joga precisa sentir o tempo acabando — um limite que só aparece
-- quando estoura é uma armadilha, não uma regra.
--
-- Quem é o assassino continua privado. O MODO é público (todo mundo sabe que
-- há um), a PESSOA não.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_room_settings(p_room uuid, p_settings jsonb)
 RETURNS rooms
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  sala   public.rooms;
  limpo  jsonb;
  modo   text;
  anul   text;
  tam    int;
  tema   text;
  band   text;
  chave  text;
  aceita text[];
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into sala from public.rooms r where r.id = p_room;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if sala.host_id <> auth.uid() then raise exception 'NOT_HOST'; end if;
  if sala.status <> 'lobby' then raise exception 'MATCH_IN_PROGRESS'; end if;

  aceita := case sala.game_key
    when 'letreiro'  then array['modo', 'anulacao', 'tamanho', 'bandeja']
    when 'metropole' then array['modo', 'bolao', 'largadaDobrada',
                                'construirSolto', 'semLeilao']
    when 'dominio'   then array['modo']
    when 'dossie'    then array['tema', 'reviravolta', 'avancado', 'assassino']
    else '{}'::text[]
  end;

  for chave in select jsonb_object_keys(p_settings) loop
    if not (chave = any(aceita)) then
      raise exception 'UNKNOWN_SETTING_%', chave;
    end if;
  end loop;

  if sala.game_key = 'letreiro' then
    modo := coalesce(p_settings ->> 'modo', sala.settings ->> 'modo', 'classico');
    anul := coalesce(p_settings ->> 'anulacao', sala.settings ->> 'anulacao', 'classica');
    tam  := coalesce((p_settings ->> 'tamanho')::int, (sala.settings ->> 'tamanho')::int, 4);

    if modo not in ('classico', 'relampago') then raise exception 'BAD_MODE'; end if;
    if anul not in ('classica', 'gananciosa', 'bonus') then raise exception 'BAD_SCORING'; end if;
    if tam not in (4, 5) then raise exception 'BAD_SIZE'; end if;

    /* A BANDEJA NÃO MUDA REGRA NENHUMA, e é validada com o mesmo rigor.

       A lista fechada aqui é o que impede a chave de virar campo de texto livre
       — um `bandeja: "roxo"` que o CSS não conhece deixaria a mesa sem material
       nenhum, e o defeito apareceria só na tela de quem escolheu. */
    band := coalesce(p_settings ->> 'bandeja', sala.settings ->> 'bandeja', 'nogueira');
    if band not in ('nogueira', 'osso', 'fliperama', 'meridiano') then
      raise exception 'BAD_TRAY';
    end if;

    limpo := jsonb_build_object(
      'modo', modo, 'anulacao', anul, 'tamanho', tam, 'bandeja', band);

  elsif sala.game_key = 'metropole' then
    modo := coalesce(p_settings ->> 'modo', sala.settings ->> 'modo', 'metropole');
    if modo not in ('metropole', 'classico', 'relampago') then raise exception 'BAD_MODE'; end if;

    limpo := jsonb_build_object(
      'modo', modo,
      'bolao', coalesce(
        (p_settings ->> 'bolao')::boolean, (sala.settings ->> 'bolao')::boolean, false),
      'largadaDobrada', coalesce(
        (p_settings ->> 'largadaDobrada')::boolean,
        (sala.settings ->> 'largadaDobrada')::boolean, false),
      'construirSolto', coalesce(
        (p_settings ->> 'construirSolto')::boolean,
        (sala.settings ->> 'construirSolto')::boolean, false),
      'semLeilao', coalesce(
        (p_settings ->> 'semLeilao')::boolean,
        (sala.settings ->> 'semLeilao')::boolean, false)
    );

  elsif sala.game_key = 'dominio' then
    modo := coalesce(p_settings ->> 'modo', sala.settings ->> 'modo', 'campanha');
    if modo not in ('campanha', 'classico', 'relampago') then raise exception 'BAD_MODE'; end if;
    limpo := jsonb_build_object('modo', modo);

  elsif sala.game_key = 'dossie' then
    tema := coalesce(p_settings ->> 'tema', sala.settings ->> 'tema', 'surpresa');
    -- vocabulário DINÂMICO: pergunta ao banco em vez de listar ids aqui
    if tema <> 'surpresa'
       and not exists (
         select 1 from public.game_themes gt
          where gt.id = tema and gt.game_key = 'dossie'
       ) then
      raise exception 'BAD_THEME';
    end if;
    /* A reviravolta é LIGADA por padrão, e o `coalesce` de três degraus é o
       que faz isso valer para as salas que existiam antes desta migração: o
       pedido, depois o que a sala já tinha, depois o padrão.

       Ligada por padrão porque é a mecânica que o sistema de temas entrega — um
       caso sem a regra dele é o Solar das Acácias com outra roupa. Quem quer o
       jogo limpo desliga em um toque, e o PRD 03 §3.5 promete exatamente isso. */
    limpo := jsonb_build_object(
      'tema', tema,
      'reviravolta', coalesce(
        (p_settings ->> 'reviravolta')::boolean,
        (sala.settings ->> 'reviravolta')::boolean,
        true),
      /* O Modo Avançado é DESLIGADO por padrão, ao contrário da reviravolta.

         A reviravolta é a mecânica que o caso entrega e sem ela o caso é o
         Solar com outra roupa — por isso ela vem ligada. As Cartas de Pista são
         uma sétima coisa para aprender numa mesa que já tem seis suspeitos,
         nove lugares, um caderno de dedução e uma regra própria. Ligada por
         padrão, ela transforma a primeira partida de alguém numa aula. */
      'avancado', coalesce(
        (p_settings ->> 'avancado')::boolean,
        (sala.settings ->> 'avancado')::boolean,
        false),
      /* O MODO ASSASSINO também nasce desligado, pelo mesmo motivo do Avançado:
         ele muda o que o jogo É. O Dossiê normal é dedução sobre cartas; com
         assassino, é dedução sobre gente — e a mesa precisa escolher isso de
         propósito, não descobrir no meio. */
      'assassino', coalesce(
        (p_settings ->> 'assassino')::boolean,
        (sala.settings ->> 'assassino')::boolean,
        false)
    );

  else
    limpo := '{}'::jsonb;
  end if;

  update public.rooms set settings = limpo where id = p_room returning * into sala;
  return sala;
end;
$function$;

revoke all on function public.set_room_settings(uuid, jsonb) from public, anon;
grant execute on function public.set_room_settings(uuid, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.dossie_start(p_room uuid, p_theme text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  sala      public.rooms;
  tema      public.game_themes;
  semente   bigint;
  baralho   text[];
  sol_s     text;
  sol_w     text;
  sol_r     text;
  mao       text[];
  lugares   text[];
  armas     text[];
  susp      text[];
  membros   record;
  jogadores jsonb := '[]'::jsonb;
  posicoes  jsonb := '{}'::jsonb;
  pos_arma  jsonb := '{}'::jsonb;
  nova      public.matches;
  estado    jsonb;
  i         int := 0;
  culpado   smallint;
  total     int;
  idx       int;
  giro      jsonb := null;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into sala from public.rooms where id = p_room;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if sala.host_id <> auth.uid() then raise exception 'NOT_HOST'; end if;
  if sala.game_key <> 'dossie' then raise exception 'WRONG_GAME'; end if;
  if exists (select 1 from public.matches where room_id = p_room and status = 'running') then
    raise exception 'ALREADY_RUNNING';
  end if;

  select count(*)::int into total from public.room_members
   where room_id = p_room and seat is not null;
  if total < 3 then raise exception 'NEED_THREE'; end if;

  /* A escolha do caso mora numa função só: pedido explícito, depois o que a
     sala combinou no lobby, depois sorteio. Antes desta migração ela estava
     aqui dentro, e escolher o caso no lobby exigiria mexer nesta função de
     duzentas linhas a cada mudança de política. */
  tema := public.dossie_escolhe_tema(p_room, p_theme);
  if tema.id is null then raise exception 'NO_THEME'; end if;

  semente := (random() * 9223372036854775806)::bigint;

  select array_agg(value ->> 'id') into susp    from jsonb_array_elements(tema.data -> 'suspects');
  select array_agg(value ->> 'id') into armas   from jsonb_array_elements(tema.data -> 'weapons');
  select array_agg(value ->> 'id') into lugares from jsonb_array_elements(tema.data -> 'rooms');

  sol_s := (public.shuffle_text(susp,    semente))[1];
  sol_w := (public.shuffle_text(armas,   semente + 7))[1];
  sol_r := (public.shuffle_text(lugares, semente + 13))[1];

  select public.shuffle_text(array_agg(c), semente + 29) into baralho
    from (select unnest(susp || armas || lugares) c) t
   where c not in (sol_s, sol_w, sol_r);

  for i in 1..array_length(armas, 1) loop
    pos_arma := pos_arma || jsonb_build_object(
      armas[i], (public.shuffle_text(lugares, semente + 100 + i))[1]
    );
  end loop;

  insert into public.matches (room_id, game_key, seed, solution, public_state, turn_deadline)
  values (
    p_room, 'dossie', semente,
    jsonb_build_object('suspect', sol_s, 'weapon', sol_w, 'room', sol_r),
    '{}'::jsonb, now() + interval '90 seconds'
  )
  returning * into nova;

  /* ── QUEM É O ASSASSINO ──────────────────────────────────────────────────
     Sorteado da semente, e portanto reproduzível: a mesma partida sorteia o
     mesmo, o que importa para poder investigar uma reclamação depois.

     E É GENTE, sempre que houver gente. Duas razões, e a segunda é a que
     decide:

     De jogo: a máquina não usaria a informação. Ela deduz porque não tem outro
     jeito, e dar-lhe o envelope sem ensiná-la a mentir produziria um assassino
     que joga exatamente como um detetive.

     De confiança: a suíte confere, partida a partida, que NENHUMA máquina risca
     carta do envelope, e essa frase vale porque é absoluta. Uma exceção —
     "menos quando ela é o assassino" — é o tipo de furo que se abre uma vez e
     some dentro de um `if` para sempre. */
  if coalesce((sala.settings ->> 'assassino')::boolean, false) then
    select rm.seat into culpado
      from public.room_members rm
      join public.profiles p on p.id = rm.user_id
     where rm.room_id = p_room and rm.seat is not null and not p.is_bot
     order by ('x' || substr(md5(semente::text || ':assassino:' || rm.seat::text), 1, 6))
              ::bit(24)::int
     limit 1;

    -- mesa só de máquinas: cai no primeiro assento, e é partida que não existe
    -- fora de teste
    if culpado is null then
      select min(rm.seat) into culpado
        from public.room_members rm
       where rm.room_id = p_room and rm.seat is not null;
    end if;
  end if;

  i := 0;
  for membros in
    select user_id, seat from public.room_members
     where room_id = p_room and seat is not null order by seat
  loop
    mao := '{}';
    idx := i + 1;
    while idx <= array_length(baralho, 1) loop
      mao := mao || baralho[idx];
      idx := idx + total;
    end loop;

    insert into public.match_players (match_id, user_id, seat)
    values (nova.id, membros.user_id, membros.seat);

    /* O ENVELOPE VAI PARA O ASSASSINO, e para mais ninguém.

       Ele mora no estado PRIVADO, que a RLS já protege — e com o nome
       `envelope`, e não `solution`: a suíte confere que nenhuma máquina tem
       `solution` no privado, e essa checagem tem de continuar significando o
       que significa. */
    insert into public.match_private_state (match_id, user_id, data)
    values (nova.id, membros.user_id,
      jsonb_build_object('hand', to_jsonb(mao), 'seen', '[]'::jsonb, 'pad', '{}'::jsonb)
      || case when membros.seat = culpado then jsonb_build_object(
              'assassino', true,
              'envelope', jsonb_build_object(
                'suspect', sol_s, 'weapon', sol_w, 'room', sol_r))
         else '{}'::jsonb end);

    jogadores := jogadores || jsonb_build_array(jsonb_build_object(
      'seat', membros.seat,
      'userId', membros.user_id,
      'suspect', susp[(i % array_length(susp, 1)) + 1],
      'hand', array_length(mao, 1)
    ));

    posicoes := posicoes || jsonb_build_object(
      membros.seat::text, (public.shuffle_text(lugares, semente + 200 + i))[1]
    );

    i := i + 1;
  end loop;

  /* A REVIRAVOLTA DO CASO, congelada agora.

     Congelar no início é a decisão de produto: quem escolheu jogar limpo joga
     limpo até o fim, e ninguém muda a regra no meio da partida. A alternativa —
     ler a regra da casa a cada rodada — deixaria o anfitrião desligar o Apagão
     na rodada 5 depois de ver que ele ia cair na 6.

     A rodada do Apagão sai do mesmo `semente` de tudo o mais, entre a 4 e a 8
     como manda o PRD 03 §3. Sorteada AQUI e guardada: se fosse sorteada na hora,
     "uma vez por partida" viraria "uma vez por rodada, com 20% de chance". */
  if coalesce((sala.settings ->> 'reviravolta')::boolean, true) then
    giro := tema.data -> 'twist';
    if giro is not null and giro <> 'null'::jsonb then
      giro := jsonb_build_object('id', giro ->> 'id');
      case giro ->> 'id'
        when 'apagao' then
          giro := giro || jsonb_build_object(
            'round', 4 + (abs(semente) % 5), 'fired', false, 'active', false
          );
        when 'tempestade' then
          giro := giro || jsonb_build_object('fechados', '[]'::jsonb, 'aviso', '[]'::jsonb);
        when 'registro' then
          giro := giro || jsonb_build_object('publicados', '[]'::jsonb);
        else
          giro := null;
      end case;
    end if;
  end if;

  estado := jsonb_build_object(
    'theme', tema.id,
    'phase', 'turn',
    'turnSeat', (select min(seat) from public.room_members
                  where room_id = p_room and seat is not null),
    'actionsLeft', 2,
    'positions', posicoes,
    'weapons', pos_arma,
    'players', jogadores,
    'ghosts', '[]'::jsonb,
    'accused', '[]'::jsonb,
    'pending', null,
    'round', 1,
    /* O MODO é público; a PESSOA não. Todo mundo sabe que há um assassino na
       mesa — é isso que faz a mesa olhar de lado para todo mundo — e ninguém
       sabe quem.

       `rodadaFinal` entra junto e desde o começo: um limite que só aparece
       quando estoura é armadilha, não regra. Quem joga precisa sentir o tempo
       acabando. */
    'assassino', coalesce((sala.settings ->> 'assassino')::boolean, false),
    'rodadaFinal', case
                     when coalesce((sala.settings ->> 'assassino')::boolean, false)
                     then 12 else null
                   end,
    'twist', giro,
    /* `{"tirou": 0}` quando o Modo Avançado está ligado, e NULO quando não —
       e a diferença importa: `dossie_investigar` recusa com SEM_PISTAS quando
       a chave é nula, então a mesa que jogou sem cartas não tem como uma
       chamada solta injetar uma. A regra da casa é lida uma vez, aqui. */
    'pistas', case
                when coalesce((sala.settings ->> 'avancado')::boolean, false)
                then jsonb_build_object('tirou', 0)
                else null
              end,
    'seq', 0,
    'log', '[]'::jsonb
  );

  update public.matches set public_state = estado where id = nova.id;
  update public.rooms set status = 'playing' where id = p_room;

  -- redigido: a solução fica no banco, nunca na resposta
  return jsonb_build_object(
    'id', nova.id,
    'status', nova.status,
    'turn_deadline', nova.turn_deadline,
    'started_at', nova.started_at,
    'public_state', estado
  );
end;
$function$;

revoke all on function public.dossie_start(uuid, text) from public, anon;
grant execute on function public.dossie_start(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.dossie_accuse_como(p_seat smallint, p_match uuid, p_suspect text, p_weapon text, p_room text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m       public.matches;
  estado  jsonb;
  meu     smallint;
  acertou boolean;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;
  estado := m.public_state;

  select seat into meu from public.match_players
   where match_id = p_match and user_id = public.dossie_dono(p_match, p_seat);
  if meu is null then raise exception 'NOT_A_PLAYER'; end if;
  if (estado ->> 'turnSeat')::smallint <> meu then raise exception 'NOT_YOUR_TURN'; end if;
  if exists (select 1 from jsonb_array_elements_text(estado -> 'accused') a
              where a::smallint = meu) then
    raise exception 'ALREADY_ACCUSED';
  end if;

  /* O ASSASSINO NÃO FECHA O CASO.

     Ele sabe a resposta. Sem esta linha o modo inteiro dura um turno: ele
     acusa, acerta, e ganha como detetive. Não é caso extremo — é a jogada
     ÓBVIA, e a primeira que qualquer pessoa tentaria.

     No servidor, e não escondendo o botão: quem descobrisse a chamada ganharia
     a partida. */
  if coalesce((estado ->> 'assassino')::boolean, false) and exists (
    select 1 from public.match_private_state mps
     where mps.match_id = p_match
       and mps.user_id = public.dossie_dono(p_match, meu)
       and coalesce((mps.data ->> 'assassino')::boolean, false)
  ) then
    raise exception 'ASSASSINO_NAO_ACUSA';
  end if;

  acertou := (m.solution ->> 'suspect' = p_suspect)
         and (m.solution ->> 'weapon'  = p_weapon)
         and (m.solution ->> 'room'    = p_room);

  estado := jsonb_set(estado, '{accused}', (estado -> 'accused') || to_jsonb(meu));
  estado := public.dossie_log(estado, jsonb_build_object(
    'type', 'accuse', 'seat', meu, 'right', acertou,
    'guess', jsonb_build_array(p_suspect, p_weapon, p_room)
  ));

  if acertou then
    update public.matches
       set status = 'finished', ended_at = now(), version = version + 1, turn_deadline = null,
           public_state = estado || jsonb_build_object(
             'phase', 'over', 'winner', meu, 'solution', m.solution, 'pending', null
           )
     where id = p_match;
    update public.rooms set status = 'lobby' where id = m.room_id;
    perform public.dossie_premia(p_match, meu, true);
    return jsonb_build_object('ok', true, 'right', true);
  end if;

  estado := jsonb_set(estado, '{ghosts}', (estado -> 'ghosts') || to_jsonb(meu));
  update public.matches set public_state = estado, version = version + 1 where id = p_match;
  perform public.dossie_premia(p_match, meu, false);
  perform public.dossie_advance(p_match);

  return jsonb_build_object('ok', true, 'right', false);
end;
$function$;

revoke all on function public.dossie_accuse_como(smallint, uuid, text, text, text)
  from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.dossie_advance(p_match uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m       public.matches;
  prox    smallint;
  atual   smallint;
  rodada  int;
  estado  jsonb;
  virou   boolean;
  acoes   int;
begin
  select * into m from public.matches where id = p_match;
  estado := m.public_state;

  atual := (estado ->> 'turnSeat')::smallint;
  prox  := public.dossie_next_seat(estado, atual);

  if prox is null then
    -- todos viraram fantasma: o envelope é aberto e ninguém venceu
    update public.matches
       set status = 'finished',
           ended_at = now(),
           version = version + 1,
           turn_deadline = null,
           public_state = estado || jsonb_build_object(
             'phase', 'over',
             'winner', null,
             'solution', m.solution,
             'pending', null
           )
     where id = p_match;
    update public.rooms set status = 'lobby' where id = m.room_id;
    return;
  end if;

  /* A volta ao começo. `<=` e não `<` porque com um jogador só o próximo é
     ele mesmo, e a rodada tem de virar do mesmo jeito. */
  rodada := coalesce((estado ->> 'round')::int, 1);
  if prox <= atual then
    rodada := rodada + 1;
  end if;

  virou := prox <= atual;

  /* TEMPO É CURTO: uma ação em vez de duas, para quem foi marcado.

     A marca é consumida ao ser paga, e não fica. É o mesmo desenho da multa de
     traição do Domínio, e pelo mesmo motivo: uma penalidade que se cobra toda
     rodada não é penalidade, é regra nova. */
  acoes := 2;
  if (estado ->> 'tempoCurto')::smallint is not distinct from prox
     and estado ->> 'tempoCurto' is not null then
    acoes := 1;
    estado := estado || jsonb_build_object('tempoCurto', null);
  end if;

  update public.matches
     set version = version + 1,
         turn_deadline = now() + interval '90 seconds',
         public_state = estado || jsonb_build_object(
           'phase', 'turn',
           'turnSeat', prox,
           'round', rodada,
           'actionsLeft', acoes,
           'pending', null
         )
   where id = p_match;

  /* ── O RELÓGIO DO ASSASSINO ──────────────────────────────────────────────
     Doze rodadas. Se ninguém fechou o caso até ali, ele venceu — e o envelope
     é aberto para a mesa ver o que passou debaixo do nariz de todo mundo.

     Vem ANTES da reviravolta porque a partida acabou: uma tempestade que fecha
     dois lugares numa mesa encerrada é ruído no registro, e a reviravolta lê o
     estado do banco, que agora diz que a fase e o fim. */
  if virou
     and coalesce((estado ->> 'assassino')::boolean, false)
     and rodada > coalesce((estado ->> 'rodadaFinal')::int, 12) then
    update public.matches
       set status = 'finished', ended_at = now(), version = version + 1,
           turn_deadline = null,
           public_state = estado || jsonb_build_object(
             'phase', 'over',
             'round', rodada,
             'winner', null,
             'assassinoVenceu', true,
             'solution', m.solution,
             'pending', null
           )
     where id = p_match;
    update public.rooms set status = 'lobby' where id = m.room_id;
    return;
  end if;

  /* A reviravolta acontece DEPOIS do estado da rodada nova estar gravado, e
     nunca antes: `dossie_vira_rodada` lê `round` do banco para saber em que
     rodada está. Chamar antes seria fazê-la decidir sobre a rodada anterior. */
  if virou then
    perform public.dossie_vira_rodada(p_match);
  end if;
end;
$function$;

revoke all on function public.dossie_advance(uuid) from public, anon, authenticated;
