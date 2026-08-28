-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0068 · o turno da máquina do Domínio, um passo por vez
--
-- `dominio_bot_turno` joga o TURNO INTEIRO numa chamada: troca carta, reforça,
-- ataca cinco vezes, remaneja e passa a vez. O cliente espera 1200ms e recebe
-- tudo de uma vez — e o mapa dá um salto em que seis territórios mudaram de cor,
-- dois exércitos seus sumiram e a Aurélia trocou de dono.
--
-- É exatamente o problema que a Metrópole não tem, porque lá `met_bot_passo` faz
-- UM passo e diz o que fez. Aqui a pessoa não vê a máquina decidir: vê o
-- resultado de ela ter decidido. Num jogo de tabuleiro isso é perder metade.
--
-- E no Domínio dói mais que na Metrópole, porque o que a máquina faz no turno
-- dela é literalmente atacar VOCÊ. Ver o ataque chegando — o reforço se juntando
-- na fronteira, o primeiro assalto, o segundo — é a tensão do jogo. Receber o
-- resultado pronto é ler um relatório.
--
-- ─────────────────────────────────────────────────────────────────────────
-- ONDE FICA O CONTADOR DE ATAQUES
--
-- O turno inteiro numa chamada podia usar uma variável local para contar quantos
-- ataques já fez. Passo a passo, esse número precisa sobreviver entre chamadas —
-- e o único lugar honesto é o estado da partida.
--
-- Ele vai em `botCtl`, junto com a marca de a QUAL turno ele pertence
-- (assento e rodada). Quando a marca não bate, o contador zera sozinho: assim
-- nenhuma outra função precisa saber que ele existe para limpá-lo, e não há como
-- esquecer de zerar. Estado que se limpa sozinho é estado que não vaza.
--
-- `dominio_bot_turno` continua existindo e continua sendo o que a faxina usa:
-- quando ninguém está olhando, jogar o turno inteiro de uma vez é o certo. Ela
-- agora é um laço em cima de `dominio_bot_passo`, então as regras vivem num
-- lugar só — a mesma disciplina do resto do projeto.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.dominio_bot_passo(p_match uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
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
$$;

revoke all on function public.dominio_bot_passo(uuid) from public, anon, authenticated;

-- ── e o turno inteiro vira um laço em cima do passo ───────────────────────

/**
 * O turno inteiro de uma vez.
 *
 * Quem usa é a faxina: quando ninguém está com a aba aberta, jogar tudo de uma
 * vez é o certo. O cliente NÃO usa — lá o ritmo é metade do jogo.
 *
 * O teto de 40 passos é folgado de sobra (um turno cabe em ~20) e existe pelo
 * mesmo motivo de sempre: laço sem teto é laço infinito esperando um bug.
 */
create or replace function public.dominio_bot_turno(p_match uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  passo   text;
  quantos int := 0;
begin
  for i in 1 .. 40 loop
    passo := public.dominio_bot_passo(p_match);
    exit when passo is null;
    quantos := quantos + 1;
    -- o turno acaba quando ela passa a vez, ou quando a partida acaba
    exit when passo like 'passa(%';
    exit when not exists (
      select 1 from public.matches m where m.id = p_match and m.status = 'running');
  end loop;
  return quantos;
end;
$$;

revoke all on function public.dominio_bot_turno(uuid) from public, anon, authenticated;

-- ── e o RPC do ritmo passa a tocar UM PASSO ───────────────────────────────

create or replace function public.dominio_tocar(p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  est   jsonb;
  vivo  text;
  seat  smallint;
  dono  uuid;
  passo text;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select m.public_state, m.status into est, vivo
    from public.matches m where m.id = p_match;
  if not found then raise exception 'MATCH_NOT_FOUND'; end if;
  if vivo <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;

  if not exists (
    select 1 from public.match_players mp
     where mp.match_id = p_match and mp.user_id = auth.uid()
  ) then
    raise exception 'NOT_A_PLAYER';
  end if;

  seat := (est ->> 'turnSeat')::smallint;
  select mp.user_id into dono
    from public.match_players mp
   where mp.match_id = p_match and mp.seat = seat;

  if not exists (select 1 from public.profiles p where p.id = dono and p.is_bot) then
    raise exception 'NOT_BOT_TURN';
  end if;

  passo := public.dominio_bot_passo(p_match);
  if passo is null then raise exception 'BOT_STUCK'; end if;

  /* Devolve o rótulo do passo junto com o estado, igual à Metrópole: é com ele
     que a tela conta "Creuza reforçou a Aurélia" em vez de deixar o mapa mudar
     de cor sozinho. */
  return jsonb_build_object('passo', passo, 'match', public.dominio_publico(p_match));
end;
$$;

revoke all on function public.dominio_tocar(uuid) from public, anon, authenticated;
grant execute on function public.dominio_tocar(uuid) to authenticated;
