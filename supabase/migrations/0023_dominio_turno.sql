-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0023 · o ciclo de turno do Domínio
--
-- A 0019 provou a matemática do combate por enumeração de força bruta. Faltava
-- o jogo: reforçar, atacar em série, avançar para o território conquistado,
-- remanejar, trocar cartas, encerrar o turno, eliminar quem ficou sem nada e
-- reconhecer a vitória.
--
-- Regras de ouro que valem para TODA função aqui:
--
--   1. O servidor é a fonte da verdade. O cliente nunca decide um resultado —
--      ele pede, e o servidor responde o que aconteceu.
--
--   2. Os dados saem da SEMENTE, que o cliente não lê (grant por coluna, ver
--      migração 0013). O contador `rolls` avança a cada dado usado, então a
--      mesma jogada nunca sai duas vezes e nada é adivinhável de fora.
--
--   3. O BARALHO também é derivado da semente. Se a ordem das cartas ficasse
--      no estado público, qualquer jogador leria as próximas cartas de todos.
--      Aqui só o contador `cartasDadas` é público — a ordem nasce da semente
--      na hora de dar a carta.
--
--   4. Variável de PL/pgSQL nunca tem nome de coluna. Foi assim que
--      `dominio_start` morreu com "column reference seat is ambiguous".
-- ═══════════════════════════════════════════════════════════════════════════

-- ── o baralho, derivado da semente ─────────────────────────────────────────

/**
 * A k-ésima carta dada nesta partida (k começa em 0).
 *
 * O baralho tem 42 cartas de território mais 2 coringas. A ordem é uma
 * permutação da semente; passadas as 44, embaralha de novo com outra chave —
 * é o equivalente a juntar o descarte e tornar a dar.
 */
create or replace function public.dominio_carta(p_mapa jsonb, p_seed bigint, p_k int)
returns jsonb
language plpgsql
immutable
as $$
declare
  cartas  text[];
  ordem   text[];
  ciclo   int := p_k / 44;
  onde    int := p_k % 44;
  qual    text;
  simb    text;
  idx     int;
begin
  select array_agg(t ->> 'id' order by ord) into cartas
    from jsonb_array_elements(p_mapa -> 'territorios') with ordinality x(t, ord);

  cartas := cartas || array['coringa-1', 'coringa-2'];
  ordem := public.shuffle_text(cartas, p_seed + 7919 * (ciclo + 1));
  qual := ordem[onde + 1];

  if qual like 'coringa-%' then
    return jsonb_build_object('ter', null, 'simbolo', 'coringa', 'id', qual);
  end if;

  -- o símbolo sai da posição do território no mapa: estável, e reparte as 42
  -- cartas em 14 de cada naipe
  select ord - 1 into idx
    from jsonb_array_elements(p_mapa -> 'territorios') with ordinality x(t, ord)
   where t ->> 'id' = qual;

  simb := case idx % 3 when 0 then 'infante' when 1 then 'cavalo' else 'canhao' end;
  return jsonb_build_object('ter', qual, 'simbolo', simb, 'id', qual);
end;
$$;

revoke all on function public.dominio_carta(jsonb, bigint, int) from public;

/**
 * Quantos exércitos vale a n-ésima troca da partida (n começa em 1).
 *
 * A escada sobe para forçar o jogo a andar: guardar carta fica cada vez mais
 * caro em tempo, e a partida não empaca em ninguém-ataca-ninguém.
 */
create or replace function public.dominio_valor_troca(p_n int)
returns int
language sql
immutable
as $$
  select case p_n
    when 1 then 4 when 2 then 6 when 3 then 8
    when 4 then 10 when 5 then 12 when 6 then 15
    else 15 + 5 * (p_n - 6)
  end;
$$;

revoke all on function public.dominio_valor_troca(int) from public;

-- ── objetivo cumprido? ─────────────────────────────────────────────────────

/**
 * O objetivo secreto de um assento está cumprido?
 *
 * Roda no servidor e só no servidor: se o cliente pudesse avaliar objetivo,
 * teria de conhecer o objetivo, e o objetivo é secreto.
 */
create or replace function public.dominio_objetivo_ok(
  p_mapa jsonb, p_estado jsonb, p_seat smallint, p_obj jsonb
)
returns boolean
language plpgsql
immutable
as $$
declare
  tipo    text := p_obj ->> 'tipo';
  meus    int;
  quantos int;
  c       jsonb;
  todos   int;
  tenho   int;
  extras  int;
  outros  int := 0;
  precisa int;
begin
  if p_obj is null then
    return false;
  end if;

  select count(*) into meus
    from jsonb_each_text(p_estado -> 'donos') d
   where d.value::smallint = p_seat;

  if tipo = 'territorios' then
    return meus >= (p_obj ->> 'alvo')::int;

  elsif tipo = 'territorios-com-dois' then
    select count(*) into quantos
      from jsonb_each_text(p_estado -> 'donos') d
     where d.value::smallint = p_seat
       and (p_estado -> 'exercitos' ->> d.key)::int >= 2;
    return quantos >= (p_obj ->> 'alvo')::int;

  elsif tipo = 'portos' then
    -- todo território com porto tem de ser meu
    return not exists (
      select 1
        from jsonb_array_elements_text(p_mapa -> 'portos') pt
       where coalesce((p_estado -> 'donos' ->> pt.value)::smallint, -1) <> p_seat
    );

  elsif tipo = 'eliminar' then
    return coalesce((p_estado -> 'abates' ->> p_seat::text)::int, 0)
             >= (p_obj ->> 'alvo')::int;

  elsif tipo = 'continentes' then
    -- os continentes exigidos, todos inteiros
    for c in select value from jsonb_array_elements(p_obj -> 'continentes') loop
      select count(*) into todos
        from jsonb_array_elements(p_mapa -> 'territorios') t
       where t ->> 'continente' = c #>> '{}';
      select count(*) into tenho
        from jsonb_array_elements(p_mapa -> 'territorios') t
       where t ->> 'continente' = c #>> '{}'
         and coalesce((p_estado -> 'donos' ->> (t ->> 'id'))::smallint, -1) = p_seat;
      if todos = 0 or tenho < todos then
        return false;
      end if;
    end loop;

    -- "e mais N territórios em qualquer lugar"
    extras := coalesce((p_obj ->> 'extras')::int, 0);
    if extras > 0 then
      select count(*) into quantos
        from jsonb_array_elements(p_mapa -> 'territorios') t
       where coalesce((p_estado -> 'donos' ->> (t ->> 'id'))::smallint, -1) = p_seat
         and not exists (
           select 1 from jsonb_array_elements(p_obj -> 'continentes') cc
            where cc #>> '{}' = t ->> 'continente'
         );
      if quantos < extras then
        return false;
      end if;
    end if;

    -- "e mais um continente à sua escolha"
    precisa := coalesce((p_obj ->> 'alvo')::int, 0);
    if precisa > 0 then
      for c in select value from jsonb_array_elements(p_mapa -> 'continentes') loop
        if not exists (
          select 1 from jsonb_array_elements(p_obj -> 'continentes') cc
           where cc #>> '{}' = c ->> 'id'
        ) then
          select count(*) into todos
            from jsonb_array_elements(p_mapa -> 'territorios') t
           where t ->> 'continente' = c ->> 'id';
          select count(*) into tenho
            from jsonb_array_elements(p_mapa -> 'territorios') t
           where t ->> 'continente' = c ->> 'id'
             and coalesce((p_estado -> 'donos' ->> (t ->> 'id'))::smallint, -1) = p_seat;
          if todos > 0 and tenho = todos then
            outros := outros + 1;
          end if;
        end if;
      end loop;
      if outros < precisa then
        return false;
      end if;
    end if;

    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.dominio_objetivo_ok(jsonb, jsonb, smallint, jsonb) from public;

-- ── quem está na vez, e outras perguntas repetidas ─────────────────────────

/**
 * Carrega a partida, confere que quem chamou está na vez, e normaliza o estado.
 *
 * Todas as ações do turno começam por aqui — é o funil. A checagem mora numa
 * função só em vez de sete versões ligeiramente diferentes, e é justamente por
 * ser o funil que a NORMALIZAÇÃO cabe aqui: `dominio_start` (migração 0020) foi
 * escrita antes de existirem cartas, avanço e contagem de abates, então uma
 * partida começada antes desta migração não tem essas chaves. Em vez de
 * espalhar `coalesce` por sete funções, o estado é completado uma vez, no
 * primeiro toque, e todo mundo depois lê um estado com a forma inteira.
 */
create or replace function public.dominio_na_vez(
  p_match uuid,
  out r_estado jsonb, out r_seed bigint, out r_seat smallint, out r_mapa jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  faltou  jsonb;
  vivo    text;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  -- Os OUT sao escalares de proposito: `matches` e um tipo de registro, e
  -- PL/pgSQL recusa variavel de registro num INTO de varios itens. Quem chama
  -- precisa do estado, da semente e do assento — nada mais.
  select m.public_state, m.seed, m.status
    into r_estado, r_seed, vivo
    from public.matches m where m.id = p_match for update;
  if not found then raise exception 'MATCH_NOT_FOUND'; end if;
  if vivo <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;

  select mp.seat into r_seat
    from public.match_players mp
   where mp.match_id = p_match and mp.user_id = auth.uid();
  if r_seat is null then raise exception 'NOT_A_PLAYER'; end if;

  if (r_estado ->> 'turnSeat')::smallint <> r_seat then
    raise exception 'NOT_YOUR_TURN';
  end if;

  faltou := jsonb_build_object(
    'abates',      coalesce(r_estado -> 'abates', '{}'::jsonb),
    'cartasDadas', coalesce(r_estado -> 'cartasDadas', '0'::jsonb),
    'avanco',      coalesce(r_estado -> 'avanco', 'null'::jsonb)
  );
  if not (r_estado @> faltou) then
    r_estado := faltou || r_estado;
    update public.matches m set public_state = r_estado where m.id = p_match;
  end if;

  select data into r_mapa from public.game_themes gt
   where gt.id = (r_estado ->> 'map');
end;
$$;

revoke all on function public.dominio_na_vez(uuid) from public;

/** O estado público sem nada que devesse ser secreto, para devolver ao cliente. */
create or replace function public.dominio_publico(p_match uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', m.id, 'status', m.status,
    'turn_deadline', m.turn_deadline, 'version', m.version,
    'public_state', m.public_state
  )
  from public.matches m where m.id = p_match;
$$;

revoke all on function public.dominio_publico(uuid) from public;

-- ── reforçar ───────────────────────────────────────────────────────────────

create or replace function public.dominio_reforcar(p_match uuid, p_ter text, p_qtd int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  semente bigint;
  meu     smallint;
  mapa    jsonb;
  est     jsonb;
  resta   int;
  quantas int;
begin
  select * into est, semente, meu, mapa from public.dominio_na_vez(p_match);

  if est ->> 'phase' <> 'reforco' then raise exception 'WRONG_PHASE'; end if;
  if p_qtd < 1 then raise exception 'BAD_AMOUNT'; end if;
  if coalesce((est -> 'donos' ->> p_ter)::smallint, -1) <> meu then
    raise exception 'NOT_YOURS';
  end if;

  -- quem tem cinco cartas ou mais é obrigado a trocar antes de qualquer coisa.
  -- Sem essa regra, dá para acumular carta a partida inteira e nunca pagar o
  -- preço de guardar.
  select jsonb_array_length(coalesce(mps.data -> 'cartas', '[]'::jsonb)) into quantas
    from public.match_private_state mps
   where mps.match_id = p_match and mps.user_id = auth.uid();
  if coalesce(quantas, 0) >= 5 then raise exception 'MUST_TRADE'; end if;

  resta := (est ->> 'reforcoLeft')::int;
  if p_qtd > resta then raise exception 'NOT_ENOUGH_REINFORCEMENTS'; end if;

  est := jsonb_set(est, array['exercitos', p_ter],
    to_jsonb((est -> 'exercitos' ->> p_ter)::int + p_qtd));
  est := jsonb_set(est, '{reforcoLeft}', to_jsonb(resta - p_qtd));
  est := public.dominio_log(est, jsonb_build_object(
    'k', 'reforco', 'seat', meu, 'ter', p_ter, 'n', p_qtd));

  -- acabou o reforço: a fase vira ataque sozinha, sem mais um clique
  if resta - p_qtd = 0 then
    est := jsonb_set(est, '{phase}', '"ataque"');
  end if;

  update public.matches
     set public_state = est, version = version + 1,
         turn_deadline = now() + interval '120 seconds'
   where id = p_match;

  return public.dominio_publico(p_match);
end;
$$;

revoke all on function public.dominio_reforcar(uuid, text, int) from public;
grant execute on function public.dominio_reforcar(uuid, text, int) to authenticated;

-- ── trocar cartas ──────────────────────────────────────────────────────────

create or replace function public.dominio_trocar(p_match uuid, p_cartas int[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  semente bigint;
  meu     smallint;
  mapa    jsonb;
  est     jsonb;
  minhas  jsonb;
  tres    jsonb := '[]'::jsonb;
  restam  jsonb := '[]'::jsonb;
  i       int;
  simb    text[] := '{}';
  coringa int := 0;
  vale    int;
  n_troca int;
  bonus   int := 0;
  c       jsonb;
begin
  select * into est, semente, meu, mapa from public.dominio_na_vez(p_match);

  if est ->> 'phase' <> 'reforco' then raise exception 'WRONG_PHASE'; end if;
  if array_length(p_cartas, 1) <> 3 then raise exception 'NEED_THREE_CARDS'; end if;
  if p_cartas[1] = p_cartas[2] or p_cartas[2] = p_cartas[3] or p_cartas[1] = p_cartas[3] then
    raise exception 'REPEATED_INDEX';
  end if;

  select coalesce(mps.data -> 'cartas', '[]'::jsonb) into minhas
    from public.match_private_state mps
   where mps.match_id = p_match and mps.user_id = auth.uid();

  for i in 0..(jsonb_array_length(minhas) - 1) loop
    if i = any(p_cartas) then
      tres := tres || jsonb_build_array(minhas -> i);
    else
      restam := restam || jsonb_build_array(minhas -> i);
    end if;
  end loop;
  if jsonb_array_length(tres) <> 3 then raise exception 'CARD_NOT_HELD'; end if;

  for c in select value from jsonb_array_elements(tres) loop
    if c ->> 'simbolo' = 'coringa' then
      coringa := coringa + 1;
    else
      simb := simb || (c ->> 'simbolo');
    end if;
  end loop;

  -- três iguais, três diferentes, ou dois quaisquer com um coringa
  if coringa = 0 then
    if not (
      (simb[1] = simb[2] and simb[2] = simb[3])
      or (simb[1] <> simb[2] and simb[2] <> simb[3] and simb[1] <> simb[3])
    ) then
      raise exception 'BAD_COMBO';
    end if;
  elsif coringa = 1 then
    if simb[1] <> simb[2] then raise exception 'BAD_COMBO'; end if;
  end if;
  -- dois coringas fecham com qualquer carta

  n_troca := coalesce((est ->> 'trocas')::int, 0) + 1;
  vale := public.dominio_valor_troca(n_troca);

  -- o bônus clássico: carta de território SEU põe dois exércitos ali na hora.
  -- É o que faz guardar a carta do próprio território valer a pena.
  for c in select value from jsonb_array_elements(tres) loop
    if c ->> 'ter' is not null
       and coalesce((est -> 'donos' ->> (c ->> 'ter'))::smallint, -1) = meu then
      est := jsonb_set(est, array['exercitos', c ->> 'ter'],
        to_jsonb((est -> 'exercitos' ->> (c ->> 'ter'))::int + 2));
      bonus := bonus + 2;
    end if;
  end loop;

  est := jsonb_set(est, '{trocas}', to_jsonb(n_troca));
  est := jsonb_set(est, '{reforcoLeft}',
    to_jsonb((est ->> 'reforcoLeft')::int + vale));
  est := public.dominio_log(est, jsonb_build_object(
    'k', 'troca', 'seat', meu, 'n', n_troca, 'vale', vale, 'bonus', bonus));

  update public.match_private_state
     set data = jsonb_set(data, '{cartas}', restam)
   where match_id = p_match and user_id = auth.uid();

  est := public.dominio_conta_cartas(est, meu, jsonb_array_length(restam));

  update public.matches
     set public_state = est, version = version + 1,
         turn_deadline = now() + interval '120 seconds'
   where id = p_match;

  return public.dominio_publico(p_match);
end;
$$;

revoke all on function public.dominio_trocar(uuid, int[]) from public;
grant execute on function public.dominio_trocar(uuid, int[]) to authenticated;

-- ── contador público de cartas ─────────────────────────────────────────────

/**
 * Quantas cartas cada um tem é informação PÚBLICA (todo mundo na mesa vê a
 * mão crescer), mas QUAIS cartas é secreto. Esta função mexe só no número.
 */
create or replace function public.dominio_conta_cartas(p_est jsonb, p_seat smallint, p_n int)
returns jsonb
language sql
immutable
as $$
  select jsonb_set(p_est, '{players}', (
    select jsonb_agg(
             case when (j ->> 'seat')::smallint = p_seat
                  then jsonb_set(j, '{cartas}', to_jsonb(p_n))
                  else j end
             order by ord)
      from jsonb_array_elements(p_est -> 'players') with ordinality x(j, ord)
  ));
$$;

revoke all on function public.dominio_conta_cartas(jsonb, smallint, int) from public;

/** Marca um assento como fora da partida. */
create or replace function public.dominio_marca_fora(p_est jsonb, p_seat smallint)
returns jsonb
language sql
immutable
as $$
  select jsonb_set(p_est, '{players}', (
    select jsonb_agg(
             case when (j ->> 'seat')::smallint = p_seat
                  then jsonb_set(j, '{ativo}', 'false'::jsonb)
                  else j end
             order by ord)
      from jsonb_array_elements(p_est -> 'players') with ordinality x(j, ord)
  ));
$$;

revoke all on function public.dominio_marca_fora(jsonb, smallint) from public;
