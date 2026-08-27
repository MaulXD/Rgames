-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0035 · `set_room_settings` passa a conhecer cada jogo
--
-- A função nasceu para o Letreiro e ficou com o vocabulário dele cravado:
-- `modo`, `anulacao`, `tamanho`, e nada mais. Qualquer chave de outro jogo era
-- silenciosamente descartada — o anfitrião da Metrópole marcava "sem leilão" no
-- lobby, a tela mostrava marcado, e a partida começava com leilão.
--
-- Descartar em silêncio é o pior comportamento possível para uma função de
-- configuração: não dá erro, e a pessoa descobre que a regra não valeu no meio
-- da partida.
--
-- Agora ela ramifica por `game_key`, e cada jogo tem um VOCABULÁRIO FECHADO:
-- chave que não está na lista do jogo é recusada com erro, não ignorada.
--
--   letreiro   — modo (duração), anulacao (palavra repetida), tamanho (4 ou 5)
--   metropole  — modo, e as quatro regras da casa da §5.7
--   dossie     — nada: o tema é escolhido na hora de começar, em `dossie_start`
--   dominio    — nada ainda; entra quando as regras dele tiverem efeito de
--                verdade. Configuração decorativa é pior que configuração
--                nenhuma, porque promete o que não cumpre.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.set_room_settings(p_room uuid, p_settings jsonb)
returns public.rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  sala   public.rooms;
  limpo  jsonb;
  modo   text;
  anul   text;
  tam    int;
  chave  text;
  aceita text[];
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into sala from public.rooms r where r.id = p_room;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if sala.host_id <> auth.uid() then raise exception 'NOT_HOST'; end if;
  if sala.status <> 'lobby' then raise exception 'MATCH_IN_PROGRESS'; end if;

  -- o vocabulário de cada jogo, e a recusa explícita do que está fora dele
  aceita := case sala.game_key
    when 'letreiro'  then array['modo', 'anulacao', 'tamanho']
    when 'metropole' then array['modo', 'bolao', 'largadaDobrada',
                                'construirSolto', 'semLeilao']
    else '{}'::text[]
  end;

  for chave in select jsonb_object_keys(p_settings) loop
    if not (chave = any(aceita)) then
      raise exception 'UNKNOWN_SETTING_%', chave;
    end if;
  end loop;

  ---------------------------------------------------------------- Letreiro
  if sala.game_key = 'letreiro' then
    modo := coalesce(p_settings ->> 'modo', sala.settings ->> 'modo', 'classico');
    anul := coalesce(p_settings ->> 'anulacao', sala.settings ->> 'anulacao', 'classica');
    tam  := coalesce((p_settings ->> 'tamanho')::int, (sala.settings ->> 'tamanho')::int, 4);

    if modo not in ('classico', 'relampago') then raise exception 'BAD_MODE'; end if;
    if anul not in ('classica', 'gananciosa', 'bonus') then raise exception 'BAD_SCORING'; end if;
    if tam not in (4, 5) then raise exception 'BAD_SIZE'; end if;

    limpo := jsonb_build_object('modo', modo, 'anulacao', anul, 'tamanho', tam);

  --------------------------------------------------------------- Metrópole
  elsif sala.game_key = 'metropole' then
    modo := coalesce(p_settings ->> 'modo', sala.settings ->> 'modo', 'metropole');
    if modo not in ('metropole', 'classico', 'relampago') then raise exception 'BAD_MODE'; end if;

    /* As quatro regras da casa, todas booleanas e todas desligadas por
       omissão. O padrão importa: o jogo tem de sair da caixa no estado que
       termina em uma hora, e as regras que alongam ficam disponíveis com o
       custo declarado — não escondidas nem proibidas. Ver §5.7 do PRD. */
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

  else
    -- Dossiê e Domínio não têm o que configurar no lobby, ainda
    limpo := '{}'::jsonb;
  end if;

  update public.rooms set settings = limpo where id = p_room returning * into sala;
  return sala;
end;
$$;

revoke all on function public.set_room_settings(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.set_room_settings(uuid, jsonb) to authenticated;
