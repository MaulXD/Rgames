-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0104 · as Cartas de Pista entram em cena
--
-- 0103 escreveu o baralho, a ação de investigar e três cartas, e ninguém as
-- alcançava: não havia regra da casa para ligar, o estado inicial não trazia o
-- baralho, e as duas bandeiras que as cartas levantam não eram lidas por
-- ninguém.
--
-- Cinco costuras:
--
--   set_room_settings          aceita e valida `avancado`
--   dossie_start               cria `pistas` — ou não cria
--   dossie_advance             "tempo é curto" vira uma ação em vez de duas
--   dossie_pass_refute_como    o álibi deixa passar tendo a carta
--   dossie_usar_pista_como     tirar a carta da mão passa a ser legível
--
-- ────────────────────────────────────────────────────────────────────────────
-- O MODO AVANÇADO É DESLIGADO POR PADRÃO, e a reviravolta é ligada
--
-- Parece incoerente e não é. A reviravolta é a mecânica que o CASO entrega —
-- sem ela, a Boate Aurora é o Solar das Acácias com outra roupa, e a mesa não
-- ganhou nada por escolher o caso. As Cartas de Pista são uma sétima coisa para
-- aprender numa mesa que já tem seis suspeitos, nove lugares, um caderno de
-- dedução e uma regra própria.
--
-- Ligada por padrão, ela transforma a primeira partida de alguém numa aula.
--
-- E `pistas` fica NULO quando o modo está desligado, em vez de `{"tirou": 0}`.
-- A diferença é o guarda: `dossie_investigar` recusa com SEM_PISTAS quando a
-- chave é nula, então uma chamada solta não injeta carta numa mesa que escolheu
-- jogar sem elas.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O ÁLIBI É GASTO NA PASSADA, E NÃO QUANDO É JOGADO
--
-- Entre declarar o álibi e efetivamente passar, a pessoa pode mudar de ideia e
-- refutar mesmo assim — e aí a carta tem de continuar na mão dela. A bandeira
-- diz "declarei álibi nesta refutação"; quem a consome é o `pass_refute`.
--
-- É a mesma forma da multa de traição do Domínio: cobra-se ao pagar, não ao
-- marcar. E pelo mesmo motivo — penalidade que se cobra toda rodada não é
-- penalidade, é regra nova.
-- ════════════════════════════════════════════════════════════════════════════

/**
 * Uma lista jsonb sem a PRIMEIRA ocorrência de um valor.
 *
 * Existe porque "tirar uma carta da mão" é uma frase simples que vira SQL
 * ilegível quando escrita inline: `row_number()` dentro de um `not exists` com
 * subconsulta correlacionada. Ninguém confere aquilo de olho, e o que não se
 * confere de olho é onde o defeito mora.
 */
create or replace function public.jsonb_tira_um(p_lista jsonb, p_valor text)
returns jsonb
language sql
immutable
as $$
  with numerada as (
    select c, row_number() over () n
      from jsonb_array_elements_text(coalesce(p_lista, '[]'::jsonb)) c
  ),
  primeira as (select min(n) n from numerada where c = p_valor)
  select coalesce(jsonb_agg(numerada.c order by numerada.n), '[]'::jsonb)
    from numerada left join primeira on true
   where primeira.n is null or numerada.n <> primeira.n;
$$;

revoke all on function public.jsonb_tira_um(jsonb, text) from public, anon, authenticated;

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
    when 'dossie'    then array['tema', 'reviravolta', 'avancado']
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

    insert into public.match_private_state (match_id, user_id, data)
    values (nova.id, membros.user_id,
      jsonb_build_object('hand', to_jsonb(mao), 'seen', '[]'::jsonb, 'pad', '{}'::jsonb));

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

  /* A reviravolta acontece DEPOIS do estado da rodada nova estar gravado, e
     nunca antes: `dossie_vira_rodada` lê `round` do banco para saber em que
     rodada está. Chamar antes seria fazê-la decidir sobre a rodada anterior. */
  if virou then
    perform public.dossie_vira_rodada(p_match);
  end if;
end;
$function$;

revoke all on function public.dossie_advance(uuid) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.dossie_pass_refute_como(p_seat smallint, p_match uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m      public.matches;
  estado jsonb;
  pend   jsonb;
  meu    smallint;
  atual  smallint;
  tenho  boolean;
  prox   int;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;
  estado := m.public_state;
  pend := estado -> 'pending';
  if pend is null or estado ->> 'phase' <> 'refute' then raise exception 'NOTHING_TO_REFUTE'; end if;

  select seat into meu from public.match_players
   where match_id = p_match and user_id = public.dossie_dono(p_match, p_seat);
  atual := (pend -> 'queue' ->> (pend ->> 'at')::int)::smallint;
  if atual is distinct from meu then raise exception 'NOT_YOUR_REFUTE'; end if;

  -- É AQUI que se impede a trapaça mais óbvia do jogo: "esquecer" de refutar.
  select exists (
    select 1
      from public.match_private_state mps,
           jsonb_array_elements_text(mps.data -> 'hand') c,
           jsonb_array_elements_text(pend -> 'guess') g
     where mps.match_id = p_match and mps.user_id = public.dossie_dono(p_match, p_seat) and c = g
  ) into tenho;
  /* O ÁLIBI é a única coisa no jogo que deixa alguém não refutar tendo a
     carta, e por isso ele é gasto AQUI e não quando foi jogado: entre jogar e
     passar, a pessoa pode mudar de ideia e refutar mesmo assim — e aí a carta
     tem de continuar na mão dela.

     A bandeira em `alibi` diz "esta pessoa declarou álibi nesta refutação". Ela
     morre junto com a passada. */
  if tenho and coalesce((estado -> 'alibi' ->> meu::text)::boolean, false) then
    tenho := false;
    estado := public.jsonb_poe(estado, 'alibi', meu::text, 'null'::jsonb);
    estado := public.dossie_log(estado, jsonb_build_object(
      'type', 'alibi', 'seat', meu
    ));
  end if;
  if tenho then raise exception 'YOU_MUST_REFUTE'; end if;

  estado := public.dossie_log(estado, jsonb_build_object('type', 'pass', 'seat', meu));
  prox := (pend ->> 'at')::int + 1;

  if prox >= jsonb_array_length(pend -> 'queue') then
    -- ninguém pôde refutar: a linha mais importante do jogo
    estado := public.dossie_log(estado, jsonb_build_object(
      'type', 'no_refute', 'guess', pend -> 'guess'
    ));
    estado := estado || jsonb_build_object('pending', null);
    update public.matches set public_state = estado, version = version + 1 where id = p_match;
    perform public.dossie_advance(p_match);
  else
    estado := jsonb_set(estado, '{pending,at}', to_jsonb(prox));
    update public.matches
       set public_state = estado, version = version + 1,
           turn_deadline = now() + interval '30 seconds'
     where id = p_match;
  end if;

  return jsonb_build_object('ok', true);
end;
$function$;

revoke all on function public.dossie_pass_refute_como(smallint, uuid)
  from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.dossie_usar_pista_como(p_seat smallint, p_match uuid, p_carta text, p_arg jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m       public.matches;
  estado  jsonb;
  meu     smallint;
  quem    uuid;
  mao     jsonb;
  tem     boolean;
  destino text;
  prox    smallint;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;
  estado := m.public_state;

  select seat into meu from public.match_players
   where match_id = p_match and user_id = public.dossie_dono(p_match, p_seat);
  if meu is null then raise exception 'NOT_A_PLAYER'; end if;
  quem := public.dossie_dono(p_match, meu);

  select coalesce(data -> 'pistas' -> 'mao', '[]'::jsonb) into mao
    from public.match_private_state
   where match_id = p_match and user_id = quem;

  select exists (
    select 1 from jsonb_array_elements_text(mao) c where c = p_carta
  ) into tem;
  if not tem then raise exception 'PISTA_NAO_ESTA_NA_MAO'; end if;

  case p_carta

    /* CHAVE-MESTRA — mova-se para qualquer lugar, de graça.
       "De graça" é o ponto: ela não gasta ação, então é a única forma de estar
       em dois lugares numa rodada. Vale a vez inteira de quem a joga na hora
       certa. */
    when 'chave-mestra' then
      if (estado ->> 'turnSeat')::smallint <> meu then raise exception 'NOT_YOUR_TURN'; end if;
      if estado ->> 'phase' <> 'turn' then raise exception 'WRONG_PHASE'; end if;
      destino := p_arg ->> 'para';
      if destino is null then raise exception 'FALTA_O_DESTINO'; end if;
      if not exists (
        select 1 from public.game_themes gt,
                    lateral jsonb_array_elements(gt.data -> 'rooms') r
         where gt.id = estado ->> 'theme' and r ->> 'id' = destino
      ) then
        raise exception 'LUGAR_NAO_EXISTE';
      end if;
      /* A tempestade fecha para a chave-mestra também. Uma carta que passa por
         cima da regra do caso transformaria a reviravolta em sugestão. */
      if destino = any(public.dossie_fechados(estado)) then raise exception 'ROOM_CLOSED'; end if;
      estado := jsonb_set(estado, array['positions', meu::text], to_jsonb(destino));
      estado := public.dossie_log(estado, jsonb_build_object(
        'type', 'pista', 'seat', meu, 'carta', 'chave-mestra', 'room', destino
      ));

    /* TEMPO É CURTO — o próximo jogador tem uma ação em vez de duas.
       Guardada como ASSENTO e não como bandeira: entre jogá-la e a vez do
       próximo chegar, alguém pode virar fantasma, e a ordem muda. */
    when 'tempo-curto' then
      if (estado ->> 'turnSeat')::smallint <> meu then raise exception 'NOT_YOUR_TURN'; end if;
      prox := public.dossie_next_seat(estado, meu);
      if prox is null then raise exception 'NAO_HA_PROXIMO'; end if;
      estado := estado || jsonb_build_object('tempoCurto', prox);
      estado := public.dossie_log(estado, jsonb_build_object(
        'type', 'pista', 'seat', meu, 'carta', 'tempo-curto', 'alvo', prox
      ));

    /* ÁLIBI — a carta que se joga FORA DA SUA VEZ, e a única assim.
       Ela vale na refutação, que é justamente quando não é a sua vez. Por isso
       não há checagem de turno aqui: haver uma tornaria a carta inútil. */
    when 'alibi' then
      if estado ->> 'phase' <> 'refute' or estado -> 'pending' is null then
        raise exception 'NADA_PARA_REFUTAR';
      end if;
      if (estado -> 'pending' -> 'queue' ->> (estado -> 'pending' ->> 'at')::int)::smallint
         is distinct from meu then
        raise exception 'NOT_YOUR_REFUTE';
      end if;
      estado := public.jsonb_poe(estado, 'alibi', meu::text, 'true'::jsonb);
      estado := public.dossie_log(estado, jsonb_build_object(
        'type', 'pista', 'seat', meu, 'carta', 'alibi'
      ));

    else
      raise exception 'PISTA_DESCONHECIDA_%', p_carta;
  end case;

  /* A carta sai da mão. Uma só, mesmo com quatro cópias no baralho: quem tem
     duas chave-mestras gasta uma. */
  /* A carta sai da mão — UMA, mesmo com quatro cópias no baralho.

     A primeira versão disto era um `row_number()` dentro de um `not exists`
     com uma subconsulta correlacionada, e ninguém consegue ler aquilo para
     conferir se está certo. `jsonb_tira_um` faz a mesma coisa com um nome. */
  update public.match_private_state
     set data = public.jsonb_poe(coalesce(data, '{}'::jsonb), 'pistas', 'mao',
           public.jsonb_tira_um(mao, p_carta))
   where match_id = p_match and user_id = quem;

  update public.matches set public_state = estado, version = version + 1 where id = p_match;
  return jsonb_build_object('ok', true);
end;
$function$;

revoke all on function public.dossie_usar_pista_como(smallint, uuid, text, jsonb)
  from public, anon, authenticated;
