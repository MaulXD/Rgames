-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0098 · o modo Relâmpago do Domínio (PRD 04 §3 e §5.2)
--
-- O último modo que faltava nos quatro jogos. As Regras da Casa diziam isto,
-- em texto, para quem abrisse o painel:
--
--     "O Relâmpago do PRD não está aqui: ele pede um mapa de 24 territórios
--      que ainda não existe, e um rótulo que o jogo não cumpre é pior que
--      rótulo nenhum. Quando o mapa existir, ele aparece."
--
-- O mapa existe. Ele aparece.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O RELÂMPAGO É UM ARQUIVO DE DADOS, NÃO UM SEGUNDO JOGO
--
-- É a frase do PRD, e ela é literal aqui: o modo troca DUAS coisas.
--
--   o mapa      `relampago` no lugar de `vantara` — 24 territórios em vez de
--               42, recortados do sul de Vantara pelo
--               `scripts/gera-mapa-relampago.mjs`
--   as rodadas  10 em vez de 12
--
-- Nada mais. Combate, reforço, cartas, objetivos, pontuação, o não-eliminar da
-- Campanha: tudo igual. Se este bloco precisasse de um terceiro item, o
-- Relâmpago teria virado um jogo separado disfarçado de opção.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O RECORTE, E POR QUE ELE NÃO É "O OESTE"
--
-- O PRD pede "Meridiana, Velária, Sarnath, Nauria + oeste de Khadar". Os quatro
-- continentes dão 21 e faltam três de Khadar — e os três mais a oeste pela
-- coluna deixariam o mapa PARTIDO: a Nauria tem uma porta de terra só,
-- `corais → amur`, e `amur` fica na coluna 9.
--
-- A fatia é `guran`, `ryn`, `amur`: a mesma quantidade, e a que forma a ponte.
-- Eles viram Sarnath, que é com quem fazem fronteira. O validador confere a
-- contiguidade, a conexidade e o grau médio dos DOIS mapas com o mesmo código —
-- é isso que faz o recorte ser dado em vez de engenharia.
--
-- ────────────────────────────────────────────────────────────────────────────
-- E O CLIENTE PAROU DE IMPORTAR VANTARA
--
-- `lib/dominio/vantara.ts` exportava `TERRITORIOS`, `POR_ID` e `GRADE` como
-- constantes de módulo, e três componentes as usavam direto. Com dois mapas
-- isso é uma armadilha silenciosa: numa partida Relâmpago a tela desenharia
-- Vantara sobre um estado de 24 territórios, e o resultado é um mapa com metade
-- dos lugares vazios — sem erro, sem aviso, sem nada.
--
-- As constantes foram embora e viraram `mapaDe(st.map)`. Quem encontrou os usos
-- esquecidos foi o compilador, hoje.
-- ════════════════════════════════════════════════════════════════════════════

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
    when 'dossie'    then array['tema', 'reviravolta']
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
        true)
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

CREATE OR REPLACE FUNCTION public.dominio_start(p_room uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  qual_mapa text;
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

  /* O MAPA SAI DO MODO, e é a única coisa que o Relâmpago muda de verdade.

     A leitura do mapa se mudou de lugar: ela ficava aqui em cima, antes de
     'modo' existir. Agora depende dele. */
  modo := coalesce(sala.settings ->> 'modo', 'campanha');
  if modo not in ('campanha', 'classico', 'relampago') then modo := 'campanha'; end if;

  qual_mapa := case modo when 'relampago' then 'relampago' else 'vantara' end;
  select data into mapa from public.game_themes gt where gt.id = qual_mapa;
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
    'map', qual_mapa,
    'mode', modo,
    -- doze rodadas na Campanha; no Clássico só o objetivo encerra
    /* Doze rodadas na Campanha, DEZ no Relâmpago, nenhuma no Clássico.
       O Relâmpago é a Campanha num mapa menor e com duas rodadas a menos: as
       regras são as mesmas, e é isso que o faz caber numa hora sem virar outro
       jogo (PRD 04 §5.2). */
    'rodadaFinal', case modo
                     when 'campanha'  then 12
                     when 'relampago' then 10
                     else null
                   end,
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
$function$;

revoke all on function public.dominio_start(uuid) from public, anon;
grant execute on function public.dominio_start(uuid) to authenticated;
