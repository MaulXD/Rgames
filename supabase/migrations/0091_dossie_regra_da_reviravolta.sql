-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0091 · "Reviravolta do caso" nas Regras da Casa
--
-- `dossie_start` já lê `settings ->> 'reviravolta'` desde 0088. E
-- `set_room_settings` recusava a chave com UNKNOWN_SETTING_reviravolta, porque
-- a lista de chaves aceitas do Dossiê tinha só `tema`.
--
-- Ou seja: a regra existia no motor e não havia como ligá-la ou desligá-la. O
-- padrão (ligada) valia sempre, e o PRD 03 §3.5 promete o contrário — "quem quer
-- o jogo limpo joga o jogo limpo, em qualquer caso".
--
-- LIGADA POR PADRÃO é a decisão de produto. A reviravolta é a mecânica que o
-- sistema de temas entrega: um caso sem a regra dele é o Solar das Acácias com
-- outra roupa. Quem quer limpo desliga em um toque.
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
  chave  text;
  aceita text[];
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into sala from public.rooms r where r.id = p_room;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if sala.host_id <> auth.uid() then raise exception 'NOT_HOST'; end if;
  if sala.status <> 'lobby' then raise exception 'MATCH_IN_PROGRESS'; end if;

  aceita := case sala.game_key
    when 'letreiro'  then array['modo', 'anulacao', 'tamanho']
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

    limpo := jsonb_build_object('modo', modo, 'anulacao', anul, 'tamanho', tam);

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
