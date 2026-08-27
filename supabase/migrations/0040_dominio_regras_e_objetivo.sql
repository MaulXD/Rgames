-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0040 · o vocabulário do Domínio, e os vinte pontos do objetivo
--
-- Duas coisas pequenas que fecham a Campanha:
--
-- 1. `set_room_settings` passa a aceitar `modo` para o Domínio. Até agora o
--    Domínio estava fora da função de propósito — eu não quis oferecer
--    configuração decorativa. Agora o modo faz efeito, então ele entra.
--
-- 2. O objetivo secreto cumprido vale VINTE PONTOS na Campanha, além de
--    encerrar a partida na hora. Sem isso, quem cumpre objetivo na rodada 4
--    aparece no placar final com os poucos pontos que juntou até ali, e a
--    tabela de pontos do PRD (§6.5) fica contando uma história que não é a da
--    partida.
--
--    A distinção "acabou por objetivo" × "acabou por rodadas" é feita por uma
--    marca no estado que `dominio_termina_pontos` deixa antes de chamar o fim
--    comum. É indireto, e a alternativa era um parâmetro novo em `dominio_termina`
--    — que obrigaria a regerar as duas funções que a chamam. Entre um marcador
--    documentado e duas funções de 200 linhas regeradas, o marcador ganha.
-- ═══════════════════════════════════════════════════════════════════════════

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
  /* OS VINTE PONTOS DO OBJETIVO. Valem só quando a partida acabou POR
     objetivo: `dominio_termina_pontos` marca `fimPor = 'pontos'` antes de
     chamar esta função, e é essa marca que distingue os dois caminhos. */
  if (est ->> 'mode') = 'campanha' and coalesce(est ->> 'fimPor', '') <> 'pontos' then
    est := jsonb_set(est, array['pontos', p_seat::text],
      to_jsonb(coalesce((est -> 'pontos' ->> p_seat::text)::int, 0) + 20), true);
    est := jsonb_set(est, '{fimPor}', '"objetivo"');
    est := public.dominio_log(est, jsonb_build_object(
      'k', 'objetivo-cumprido', 'seat', p_seat, 'n', 20));
  end if;

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

revoke all on function public.dominio_termina(uuid, jsonb, smallint) from public, anon, authenticated;

-- e `dominio_termina_pontos` deixa a marca antes de chamar o fim comum
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

  est := jsonb_set(est, '{fimPor}', '"pontos"', true);
  est := public.dominio_log(est, jsonb_build_object(
    'k', 'fim-rodadas', 'seat', melhor,
    'n', coalesce((est -> 'pontos' ->> melhor::text)::int, 0)));

  return public.dominio_termina(p_match, est, melhor);
end;
$$;

revoke all on function public.dominio_termina_pontos(uuid, jsonb) from public, anon, authenticated;

-- ── o vocabulário ──────────────────────────────────────────────────────────

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

  aceita := case sala.game_key
    when 'letreiro'  then array['modo', 'anulacao', 'tamanho']
    when 'metropole' then array['modo', 'bolao', 'largadaDobrada',
                                'construirSolto', 'semLeilao']
    when 'dominio'   then array['modo']
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
    /* Dois modos, e só dois. O Relâmpago do PRD pede um mapa de 24
       territórios que não existe — e um vocabulário fechado é exatamente o
       lugar de recusar um rótulo que o jogo não cumpre. Quando o mapa
       existir, ele entra aqui. */
    modo := coalesce(p_settings ->> 'modo', sala.settings ->> 'modo', 'campanha');
    if modo not in ('campanha', 'classico') then raise exception 'BAD_MODE'; end if;
    limpo := jsonb_build_object('modo', modo);

  else
    limpo := '{}'::jsonb;
  end if;

  update public.rooms set settings = limpo where id = p_room returning * into sala;
  return sala;
end;
$$;

revoke all on function public.set_room_settings(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.set_room_settings(uuid, jsonb) to authenticated;
