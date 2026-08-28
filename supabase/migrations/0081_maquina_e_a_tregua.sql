-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0081 · a máquina e a trégua
--
-- 0074 criou a trégua e o cabeçalho dele dizia, com todas as letras, que a
-- máquina aceita quando está perdendo daquele lado, recusa quando está ganhando,
-- e nunca rompe.
--
-- Nada disso existia. Escrevi o comportamento no comentário e não no código —
-- e o efeito prático era pior que não ter escrito: uma pessoa propondo trégua a
-- uma máquina ficaria esperando um sim ou um não que nunca viria, e a proposta
-- ficaria pendurada no estado até o fim da partida.
--
-- Comentário que descreve o que o código NÃO faz é pior que comentário nenhum:
-- o comentário nenhum manda ler o código.
--
-- ─────────────────────────────────────────────────────────────────────────
-- COMO ELA DECIDE
--
-- A conta é local, e é a única honesta: quanto exército a pessoa tem colado na
-- MINHA fronteira contra quanto eu tenho colada na dela. Se ela é mais forte
-- ali, a trégua me serve. Se eu sou, prefiro guardar a opção de atacar.
--
-- A tranquila aceita sempre — e não é burrice sorteada: é o comportamento de
-- quem ainda não percebeu que trégua é uma jogada, e não uma gentileza.
--
-- E ela NUNCA rompe. Não porque romper seja proibido (o servidor deixa, e é o
-- ponto do §6.6), mas porque uma máquina que trai não é mais difícil — é só
-- imprevisível, e imprevisível sem intenção é ruído. A traição vale justamente
-- por alguém ter ESCOLHIDO, e escolher é o que uma pessoa faz na mesa.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.dominio_bot_passo(p_match uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  est      jsonb;
  mapa     jsonb;
  semente  bigint;
  assento  smallint;
  quem     uuid;
  nivel    text;
  seq      int;
  rodada   int;
  marca    text;
  tentou   int;

  -- carta
  n_cartas int;
  i int; j int; k int;
  trocou   boolean;

  -- reforço
  resta    int;
  alvo     text;
  rascunho jsonb;
  plano    jsonb;
  n        int;
  quanto   int;

  -- ataque
  de       text;
  para     text;
  forca    int;
  defesa   int;
  margem   int;
  vezes    int;
  teto     int;
  saida    jsonb;

  -- remanejo
  fonte    text;
  destino  text;

  -- trégua
  prop     record;
  minhaF   int;
  delaF    int;
begin
  select m.public_state, m.seed into est, semente
    from public.matches m
   where m.id = p_match and m.game_key = 'dominio' and m.status = 'running'
   for update;
  if not found then return null; end if;

  assento := (est ->> 'turnSeat')::smallint;
  rodada := coalesce((est ->> 'round')::int, 1);
  select data into mapa from public.game_themes gt where gt.id = (est ->> 'map');

  select mp.user_id into quem
    from public.match_players mp
   where mp.match_id = p_match and mp.seat = assento;
  if quem is null then return null; end if;
  if not exists (select 1 from public.profiles p where p.id = quem and p.is_bot) then
    return null;   -- é a vez de gente
  end if;

  select coalesce(rm.bot_nivel, 'medio') into nivel
    from public.matches m
    join public.room_members rm on rm.room_id = m.room_id and rm.user_id = quem
   where m.id = p_match;
  nivel := coalesce(nivel, 'medio');
  seq := coalesce((est ->> 'seq')::int, 0);

  select t_margem, t_teto, t_vezes into margem, teto, vezes
    from public.dominio_bot_agressao(nivel);

  /* O CONTADOR DE ATAQUES, e a marca de a qual turno ele pertence.
     Quando a marca não bate, ele zera sozinho — nenhuma outra função precisa
     saber que ele existe. */
  marca := assento::text || ':' || rodada::text;
  if coalesce(est -> 'botCtl' ->> 'turno', '') = marca then
    tentou := coalesce((est -> 'botCtl' ->> 'ataques')::int, 0);
  else
    tentou := 0;
    est := jsonb_set(est, '{botCtl}',
      jsonb_build_object('turno', marca, 'ataques', 0), true);
    update public.matches set public_state = est where id = p_match;
  end if;

  /* ── 0. TRÉGUA PROPOSTA A UMA MÁQUINA ────────────────────────────────

     Vem antes de tudo e vale FORA da vez dela: uma proposta chega no turno de
     quem propôs, e se a máquina só respondesse na vez dela a pessoa esperaria
     uma volta inteira do tabuleiro por um sim ou um não. Proposta pendurada é
     proposta que ninguém lembra de responder — a mesma razão pela qual a
     máquina da Metrópole responde troca na hora.

     A CONTA É LOCAL, e é a única honesta: quanto exército a pessoa tem colado
     na minha fronteira, contra quanto eu tenho colado na dela. Se ela é mais
     forte ali, a trégua me serve; se eu sou, prefiro guardar a opção de atacar.

     A tranquila aceita sempre. Não é burrice sorteada: é o comportamento de
     quem ainda não percebeu que trégua é uma jogada, e não uma gentileza. */
  for prop in
    select (o.value ->> 'de')::smallint as de,
           (split_part(o.key, ':', 1))::smallint as a,
           (split_part(o.key, ':', 2))::smallint as b
      from jsonb_each(coalesce(est -> 'tregProp', '{}'::jsonb)) o
     order by o.key
  loop
    -- a quem a proposta se dirige é o OUTRO lado da chave
    declare
      alvo smallint := case when prop.a = prop.de then prop.b else prop.a end;
      nv   text;
    begin
      nv := public.dominio_bot_nivel(p_match, alvo);
      continue when nv is null;   -- é gente que tem de responder

      select coalesce(sum((est -> 'exercitos' ->> v.viz)::int), 0)
        into delaF
        from public.dominio_bot_visao(mapa, est, alvo) t
        cross join lateral unnest(public.dominio_vizinhos(mapa, t.ter)) v(viz)
       where coalesce((est -> 'donos' ->> v.viz)::smallint, -1) = prop.de;

      select coalesce(sum(t.meus), 0) into minhaF
        from public.dominio_bot_visao(mapa, est, alvo) t
       where exists (
         select 1 from unnest(public.dominio_vizinhos(mapa, t.ter)) v(viz)
          where coalesce((est -> 'donos' ->> v.viz)::smallint, -1) = prop.de
       );

      perform public.dominio_responder_tregua_como(
        alvo, p_match, prop.de,
        nv = 'facil' or delaF > minhaF);
      return format('tregua:%s(%s) com %s',
        case when nv = 'facil' or delaF > minhaF then 'aceita' else 'recusa' end,
        alvo, prop.de);
    end;
  end loop;

  /* ── 1. CARTA ────────────────────────────────────────────────────────── */
  if est ->> 'phase' = 'reforco' then
    select coalesce(jsonb_array_length(coalesce(mps.data -> 'cartas', '[]'::jsonb)), 0)
      into n_cartas
      from public.match_private_state mps
     where mps.match_id = p_match and mps.user_id = quem;

    if n_cartas >= 3 and (
         n_cartas >= 5 or nivel = 'dificil' or (nivel = 'medio' and n_cartas >= 4)
       ) then
      trocou := false;
      for i in 0 .. n_cartas - 3 loop
        exit when trocou;
        for j in i + 1 .. n_cartas - 2 loop
          exit when trocou;
          for k in j + 1 .. n_cartas - 1 loop
            begin
              perform public.dominio_trocar_como(assento, p_match, array[i, j, k]);
              trocou := true;
              exit;
            exception when others then
              if sqlerrm not in
                 ('BAD_COMBO', 'NEED_THREE_CARDS', 'CARD_NOT_HELD', 'REPEATED_INDEX') then
                raise;
              end if;
            end;
          end loop;
        end loop;
      end loop;
      if trocou then
        return format('troca(%s) %s cartas', assento, n_cartas);
      end if;
    end if;
  end if;

  /* ── 2. REFORÇO, um território por passo ─────────────────────────────
     O rascunho decide exército por exército, como antes; a diferença é que
     agora ele executa SÓ o primeiro território e volta. A pessoa vê o reforço
     se juntando na fronteira antes do ataque vir — que é exatamente a parte que
     dá para ler, e a que faz a diferença entre levar um susto e entender o que
     aconteceu. */
  resta := coalesce((est ->> 'reforcoLeft')::int, 0);
  if est ->> 'phase' = 'reforco' and resta > 0 then
    rascunho := est;
    plano := '{}'::jsonb;

    for n in 1 .. resta loop
      if nivel = 'facil' then
        select v.ter into alvo
          from public.dominio_bot_visao(mapa, rascunho, assento) v
         order by public.dominio_ruido(semente, assento, seq + n, v.ter) desc
         limit 1;
      else
        select v.ter into alvo
          from public.dominio_bot_visao(mapa, rascunho, assento) v
         where v.frentes > 0
         order by
           v.ameaca * 2 - v.meus
           + case when nivel = 'dificil' and v.quase between 1 and 2 then 40 else 0 end
           + public.dominio_ruido(semente, assento, seq + n, v.ter) / 400.0 desc
         limit 1;
        if alvo is null then
          select v.ter into alvo
            from public.dominio_bot_visao(mapa, rascunho, assento) v
           order by public.dominio_ruido(semente, assento, seq + n, v.ter) desc
           limit 1;
        end if;
      end if;
      exit when alvo is null;

      rascunho := jsonb_set(rascunho, array['exercitos', alvo],
        to_jsonb((rascunho -> 'exercitos' ->> alvo)::int + 1));
      plano := jsonb_set(plano, array[alvo],
        to_jsonb(coalesce((plano ->> alvo)::int, 0) + 1), true);
    end loop;

    select key, value::int into alvo, quanto
      from jsonb_each_text(plano)
     order by value::int desc, key
     limit 1;

    if alvo is not null then
      perform public.dominio_reforcar_como(assento, p_match, alvo, quanto);
      return format('reforca(%s) %s com %s', assento, alvo, quanto);
    end if;
  end if;

  select m.public_state into est from public.matches m where m.id = p_match;

  /* ── 3. AVANÇO, logo depois da conquista ─────────────────────────────── */
  if est -> 'avanco' is not null and est -> 'avanco' <> 'null'::jsonb then
    perform public.dominio_avancar_como(
      assento, p_match,
      case when nivel = 'facil' then 0 else (est -> 'avanco' ->> 'max')::int end);
    return format('avanca(%s)', assento);
  end if;

  /* ── 4. UM ATAQUE ────────────────────────────────────────────────────── */
  if est ->> 'phase' = 'ataque' and tentou < teto then
    de := null;
    select v.ter, x.viz, v.meus - 1, x.nviz
      into de, para, forca, defesa
      from public.dominio_bot_visao(mapa, est, assento) v
      cross join lateral (
        select w as viz, (est -> 'exercitos' ->> w)::int as nviz
          from unnest(public.dominio_vizinhos(mapa, v.ter)) w
         where coalesce((est -> 'donos' ->> w)::smallint, -1) <> assento
      ) x
     where v.meus >= 2
       and v.meus - 1 >= x.nviz + margem
       /* A MÁQUINA NUNCA ROMPE TRÉGUA.

          Não porque romper seja proibido — o servidor deixa, e é o ponto do
          §6.6. É porque uma máquina que trai não é mais difícil, é só
          imprevisível; e imprevisível sem intenção é ruído. A traição é uma
          jogada de gente, e vale justamente por alguém ter escolhido. */
       and not public.dominio_tregua_vale(
             est, assento, coalesce((est -> 'donos' ->> x.viz)::smallint, -1))
     order by
       (v.meus - 1 - x.nviz) desc,
       x.nviz,
       public.dominio_ruido(semente, assento, seq + tentou, v.ter || x.viz) desc
     limit 1;

    if de is not null then
      saida := public.dominio_atacar_como(assento, p_match, de, para, least(vezes, forca));
      update public.matches
         set public_state = jsonb_set(public_state, '{botCtl,ataques}', to_jsonb(tentou + 1))
       where id = p_match;
      return format('ataca(%s) %s de %s%s', assento, para, de,
        case when coalesce((saida ->> 'conquistou')::boolean, false) then ' e toma' else '' end);
    end if;
  end if;

  /* ── 5. REMANEJO ─────────────────────────────────────────────────────── */
  if nivel <> 'facil'
     and not coalesce((est ->> 'remanejou')::boolean, false)
     and est ->> 'phase' in ('ataque', 'remanejo') then

    select v.ter into fonte
      from public.dominio_bot_visao(mapa, est, assento) v
     where v.frentes = 0 and v.meus >= 2
     order by v.meus desc, public.dominio_ruido(semente, assento, seq, v.ter) desc
     limit 1;

    if fonte is not null then
      select v.ter into destino
        from public.dominio_bot_visao(mapa, est, assento) v
       where v.frentes > 0
         and v.ter <> fonte
         and public.dominio_conectado(mapa, est, assento, fonte, v.ter)
       order by v.ameaca - v.meus desc, public.dominio_ruido(semente, assento, seq, v.ter) desc
       limit 1;

      if destino is not null then
        quanto := (est -> 'exercitos' ->> fonte)::int - 1;
        if quanto >= 1 then
          perform public.dominio_remanejar_como(assento, p_match, fonte, destino, quanto);
          return format('remaneja(%s) %s de %s para %s', assento, quanto, fonte, destino);
        end if;
      end if;
    end if;
  end if;

  /* ── 6. PASSA A VEZ ──────────────────────────────────────────────────── */
  perform public.dominio_encerrar_turno_como(assento, p_match);
  return format('passa(%s)', assento);
end;
$function$;

revoke all on function public.dominio_bot_passo(uuid) from public, anon, authenticated;
