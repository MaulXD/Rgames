-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0093 · as quatro bandejas do Letreiro
--
-- PRD 07 §7: o Letreiro é o tema mais barato dos quatro jogos, porque o tema
-- troca SÓ O MATERIAL — bandeja, dados, luz e som. Zero conteúdo, zero regra.
--
--   Nogueira    madeira, feltro cinza-azulado, dados de baquelite creme
--   Osso e Areia couro cru sobre areia, dados de osso talhado, sol vertical
--   Fliperama   fórmica Memphis, acrílico translúcido iluminado por baixo
--   Meridiano   alumínio escovado, cerâmica gravada a laser, âmbar de CRT
--
-- É a prova do sistema de temas no contexto mais barato que existe, e resolve
-- de graça o "enjoa em quatro rodadas" — o jogo em si não muda em nada.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE A BANDEJA MORA NO ESTADO DA PARTIDA
--
-- Ela é cosmética, e ainda assim não fica na sala. O motivo é o slogan do jogo:
-- TODO MUNDO OLHA A MESMA GRADE.
--
-- Lida de `rooms.settings`, o anfitrião troca de bandeja entre duas partidas e
-- quem ainda tem a tela da anterior aberta passa a ver outro material sobre a
-- mesma grade. Congelada em `public_state`, a bandeja é tão estável quanto os
-- dados — e é o mesmo tratamento que `mode`, `size` e `scoring` já recebem.
--
-- ────────────────────────────────────────────────────────────────────────────
-- E A LISTA É FECHADA
--
-- `bandeja` podia ser texto livre: nada no servidor depende do valor. Mas um
-- `bandeja: "roxo"` que o CSS não conhece deixaria a mesa sem material nenhum, e
-- o defeito apareceria só na tela de quem escolheu — que é o pior lugar para um
-- defeito aparecer. Vocabulário fechado, e BAD_TRAY quando não é um dos quatro.
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
    if modo not in ('campanha', 'classico') then raise exception 'BAD_MODE'; end if;
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

CREATE OR REPLACE FUNCTION public.letreiro_start(p_room uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  sala      public.rooms;
  semente   bigint;
  tabuleiro public.letreiro_boards;
  segundos  int;
  tamanho   int;
  quantas   int;
  nova      public.matches;
  membro    record;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into sala from public.rooms r where r.id = p_room;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if sala.host_id <> auth.uid() then raise exception 'NOT_HOST'; end if;
  if sala.game_key <> 'letreiro' then raise exception 'WRONG_GAME'; end if;
  if exists (select 1 from public.matches m
              where m.room_id = p_room and m.status = 'running') then
    raise exception 'ALREADY_RUNNING';
  end if;

  tamanho := coalesce((sala.settings ->> 'tamanho')::int, 4);
  if tamanho not in (4, 5) then
    tamanho := 4;
  end if;

  -- grade maior pede mais tempo: 4×4 tem 16 letras, 5×5 tem 25
  segundos := case coalesce(sala.settings ->> 'modo', 'classico')
                when 'relampago' then (case tamanho when 5 then 90 else 60 end)
                else (case tamanho when 5 then 300 else 180 end)
              end;

  semente := (random() * 9223372036854775806)::bigint;

  select count(*) into quantas
    from public.letreiro_boards b where b.size = tamanho and b.usavel;
  if quantas = 0 then
    raise exception 'NO_BOARDS';
  end if;

  select * into tabuleiro
    from public.letreiro_boards b
   where b.size = tamanho and b.usavel
   order by b.id
  offset (semente % quantas)
   limit 1;

  insert into public.matches (room_id, game_key, seed, board_id, ends_at, public_state)
  values (
    p_room, 'letreiro', semente, tabuleiro.id,
    now() + make_interval(secs => segundos),
    jsonb_build_object(
      'phase', 'round',
      'grid', to_jsonb(tabuleiro.grid),
      'size', tabuleiro.size,
      'mode', coalesce(sala.settings ->> 'modo', 'classico'),
      'scoring', coalesce(sala.settings ->> 'anulacao', 'classica'),
      'seconds', segundos,
      /* A BANDEJA MORA NO ESTADO DA PARTIDA, e não na sala.

         Ela é cosmética — nenhuma regra depende dela — e mesmo assim o lugar
         certo é aqui, pelo motivo que é o slogan do jogo: TODO MUNDO OLHA A
         MESMA GRADE. Lida da sala, o anfitrião troca de bandeja entre duas
         partidas e quem ainda tem a tela da anterior aberta passa a ver outro
         material na mesma grade. Congelada aqui, a bandeja é tão estável quanto
         os dados. */
      'tray', coalesce(sala.settings ->> 'bandeja', 'nogueira'),
      'counts', '{}'::jsonb
    )
  )
  returning * into nova;

  for membro in
    select rm.user_id, rm.seat from public.room_members rm
     where rm.room_id = p_room and rm.seat is not null
  loop
    insert into public.match_players (match_id, user_id, seat)
    values (nova.id, membro.user_id, membro.seat) on conflict do nothing;
    insert into public.match_private_state (match_id, user_id, data)
    values (nova.id, membro.user_id, jsonb_build_object('words', '[]'::jsonb))
    on conflict do nothing;
  end loop;

  update public.rooms set status = 'playing' where id = p_room;

  -- as máquinas recebem a lista de palavras delas agora. Depois disto a
  -- apuração não sabe quem é gente e quem é máquina, e não precisa saber.
  perform public.letreiro_prepara_bots(nova.id);

  select * into nova from public.matches m where m.id = nova.id;

  return jsonb_build_object(
    'id', nova.id, 'status', nova.status, 'ends_at', nova.ends_at,
    'started_at', nova.started_at, 'public_state', nova.public_state
  );
end;
$function$;

revoke all on function public.letreiro_start(uuid) from public, anon;
grant execute on function public.letreiro_start(uuid) to authenticated;
