-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0089 · a tempestade fecha lugar de verdade
--
-- 0087 sorteia o par que mantém o mapa conexo, 0088 grava no estado. E até
-- aqui a Tempestade de Areia é duas palavras num jsonb: nada impede nada.
--
-- Esta migração é o que dá dentes a ela, e são quatro costuras:
--
--   dossie_move_como     ninguém entra, ninguém sai
--   dossie_suggest_como  e o palpite não arrasta ninguém para dentro
--   dossie_passo_para    a busca desvia do que está fechado
--   dossie_bot_passo     a máquina presa palpita ou passa, e nunca se debate
--
-- ────────────────────────────────────────────────────────────────────────────
-- OS DOIS LADOS DA PORTA
--
-- "Ninguém entra e ninguém sai" são duas checagens, não uma. Conferir só o
-- destino deixaria quem está preso escapar no primeiro turno, e a regra inteira
-- viraria um pedágio de um turno.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O PALPITE NÃO É PORTA
--
-- No Dossiê, palpitar convoca o peão do suspeito nomeado para a sala de quem
-- palpitou. Durante a tempestade, feito de DENTRO de um lugar fechado, isso
-- seria uma porta dos fundos: quem está preso arrasta a mesa inteira para
-- dentro, um palpite por vez, e a rodada vira armadilha coletiva.
--
-- O que é o oposto exato do que a regra quer. O PRD 03 §3 diz por que a
-- tempestade é jogável: "quem está dentro fica preso, mas continua podendo
-- palpitar, o que faz de um lugar fechado uma POSIÇÃO estratégica, não uma
-- punição". Posição, não isca.
--
-- O objeto continua vindo. "Ninguém" é sobre gente; um taco de sinuca dentro de
-- uma sala fechada não prende nem liberta.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE A MÁQUINA PRECISA SABER, E NÃO SÓ APANHAR
--
-- Uma máquina que tenta andar para um lugar fechado levanta ROOM_CLOSED de
-- dentro de `dossie_move_como`, e a exceção sobe pela varredura inteira. Foi
-- exatamente assim que o Dossiê passou uma temporada sem tirar o turno de
-- ninguém no relógio (0033): um ramo que abortava a faxina toda em silêncio.
--
-- A máquina presa passa a vez DE PROPÓSITO. É uma linha a mais e uma classe de
-- defeito a menos.
-- ════════════════════════════════════════════════════════════════════════════

/**
 * Os lugares que a tempestade fechou nesta rodada. Vazio quando não há
 * tempestade — que é o caso de três dos quatro casos e de toda mesa que
 * desligou a reviravolta.
 */
create or replace function public.dossie_fechados(p_estado jsonb)
returns text[]
language sql
immutable
as $$
  select coalesce(
    (select array_agg(value #>> '{}')
       from jsonb_array_elements(p_estado -> 'twist' -> 'fechados')),
    '{}'
  );
$$;

revoke all on function public.dossie_fechados(jsonb) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

/**
 * O primeiro passo do caminho mais curto de `p_de` até `p_para`, desviando dos
 * lugares em `p_evitar`.
 *
 * A versão de três argumentos é DERRUBADA e refeita com o quarto com valor
 * padrão, em vez de conviverem as duas: uma sobrecarga com padrão deixaria toda
 * chamada de três argumentos ambígua, e o erro sairia em tempo de execução,
 * dentro do turno de alguém.
 */
drop function if exists public.dossie_passo_para(jsonb, text, text);

create or replace function public.dossie_passo_para(
  p_tema jsonb, p_de text, p_para text, p_evitar text[] default '{}'
)
returns text
language plpgsql
immutable
as $$
declare
  fila    text[] := array[p_de];
  visto   text[] := array[p_de];
  origem  jsonb  := '{}'::jsonb;   -- sala -> de onde se chegou nela
  atual   text;
  v       text;
  passo   text;
begin
  if p_de is null or p_para is null or p_de = p_para then return null; end if;
  if p_para = any(coalesce(p_evitar, '{}')) then return null; end if;

  while array_length(fila, 1) > 0 loop
    atual := fila[1];
    fila := fila[2:];

    for v in
      select value #>> '{}' from jsonb_array_elements(p_tema -> 'adjacency' -> atual)
      union
      select case when pas ->> 0 = atual then pas ->> 1 else pas ->> 0 end
        from jsonb_array_elements(p_tema -> 'secretPassages') pas
       where pas ->> 0 = atual or pas ->> 1 = atual
    loop
      continue when v = any(visto);
      continue when v = any(coalesce(p_evitar, '{}'));
      visto := visto || v;
      origem := jsonb_set(origem, array[v], to_jsonb(atual), true);
      if v = p_para then
        -- volta pela trilha até o vizinho de `p_de`
        passo := v;
        while (origem ->> passo) is distinct from p_de loop
          passo := origem ->> passo;
          exit when passo is null;
        end loop;
        return passo;
      end if;
      fila := fila || v;
    end loop;
  end loop;

  return null;   -- inalcançável: sem tempestade o validador de temas garante que não há
end;
$$;

revoke all on function public.dossie_passo_para(jsonb, text, text, text[])
  from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.dossie_move_como(p_seat smallint, p_match uuid, p_room text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m      public.matches;
  tema   jsonb;
  estado jsonb;
  meu    smallint;
  aqui   text;
  fechados text[];
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;
  estado := m.public_state;

  select seat into meu from public.match_players
   where match_id = p_match and user_id = public.dossie_dono(p_match, p_seat);
  if meu is null then raise exception 'NOT_A_PLAYER'; end if;
  if (estado ->> 'turnSeat')::smallint <> meu then raise exception 'NOT_YOUR_TURN'; end if;
  if estado ->> 'phase' <> 'turn' then raise exception 'WRONG_PHASE'; end if;
  if (estado ->> 'actionsLeft')::int < 1 then raise exception 'NO_ACTIONS'; end if;

  select data into tema from public.game_themes where id = estado ->> 'theme';
  aqui := estado -> 'positions' ->> meu::text;

  if not public.dossie_can_move(tema, aqui, p_room) then
    raise exception 'UNREACHABLE';
  end if;

  /* A TEMPESTADE fecha os dois lados. Sair de um lugar fechado é tão proibido
     quanto entrar nele — a regra é "ninguém entra e ninguém sai", e conferir só
     o destino deixaria quem está preso escapar no primeiro turno. */
  fechados := public.dossie_fechados(estado);
  if p_room = any(fechados) or aqui = any(fechados) then
    raise exception 'ROOM_CLOSED';
  end if;

  estado := jsonb_set(estado, array['positions', meu::text], to_jsonb(p_room));
  estado := jsonb_set(estado, '{actionsLeft}', to_jsonb((estado ->> 'actionsLeft')::int - 1));
  estado := public.dossie_log(estado, jsonb_build_object('type', 'move', 'seat', meu, 'room', p_room));

  update public.matches set public_state = estado, version = version + 1 where id = p_match;

  if (estado ->> 'actionsLeft')::int = 0 then
    perform public.dossie_advance(p_match);
  end if;

  return jsonb_build_object('ok', true);
end;
$function$;

revoke all on function public.dossie_move_como(smallint, uuid, text)
  from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.dossie_suggest_como(p_seat smallint, p_match uuid, p_suspect text, p_weapon text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m       public.matches;
  tema    jsonb;
  estado  jsonb;
  meu     smallint;
  aqui    text;
  fila    smallint[];
  outros  smallint[];
  n       int;
  idx     int;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;
  estado := m.public_state;

  select seat into meu from public.match_players
   where match_id = p_match and user_id = public.dossie_dono(p_match, p_seat);
  if meu is null then raise exception 'NOT_A_PLAYER'; end if;
  if (estado ->> 'turnSeat')::smallint <> meu then raise exception 'NOT_YOUR_TURN'; end if;
  if estado ->> 'phase' <> 'turn' then raise exception 'WRONG_PHASE'; end if;
  if (estado ->> 'actionsLeft')::int < 1 then raise exception 'NO_ACTIONS'; end if;

  select data into tema from public.game_themes where id = estado ->> 'theme';

  if public.dossie_card_kind(tema, p_suspect) <> 'suspect'
     or public.dossie_card_kind(tema, p_weapon) <> 'weapon' then
    raise exception 'BAD_GUESS';
  end if;

  aqui := estado -> 'positions' ->> meu::text;
  if aqui is null then raise exception 'NOT_IN_A_ROOM'; end if;

  -- o suspeito e o objeto nomeados são movidos para cá
  estado := jsonb_set(estado, array['weapons', p_weapon], to_jsonb(aqui));

  /* Se o suspeito nomeado é o peão de alguém, ele vem também — MENOS durante
     a tempestade, se o palpite foi feito dentro de um lugar fechado.

     Sem esta linha, quem fica preso arrasta a mesa inteira para dentro com ele,
     um palpite por vez, e a rodada de tempestade vira uma armadilha coletiva —
     o oposto exato do que a regra quer, que é dar POSIÇÃO a quem está preso.

     O objeto continua vindo: "ninguém entra" é sobre gente. Um taco de sinuca
     dentro de uma sala fechada não prende nem liberta ninguém. */
  select array_agg((value ->> 'seat')::smallint)
    into outros
    from jsonb_array_elements(estado -> 'players')
   where value ->> 'suspect' = p_suspect;
  if aqui = any(public.dossie_fechados(estado)) then
    outros := null;
  end if;
  if outros is not null then
    foreach idx in array outros loop
      estado := jsonb_set(estado, array['positions', idx::text], to_jsonb(aqui));
    end loop;
  end if;

  -- fila de refutação: a partir do próximo assento, dando a volta, sem mim.
  -- Fantasma continua na fila: se ele sair, o jogo perde informação.
  select array_agg(seat order by seat) into fila
    from public.match_players where match_id = p_match;
  n := array_length(fila, 1);
  idx := array_position(fila, meu);
  outros := '{}';
  for i in 1..(n - 1) loop
    outros := outros || fila[((idx - 1 + i) % n) + 1];
  end loop;

  estado := jsonb_set(estado, '{actionsLeft}', to_jsonb(0));
  estado := estado || jsonb_build_object(
    'phase', 'refute',
    'pending', jsonb_build_object(
      'bySeat', meu,
      'guess', jsonb_build_array(p_suspect, p_weapon, aqui),
      'queue', to_jsonb(outros),
      'at', 0
    )
  );
  estado := public.dossie_log(estado, jsonb_build_object(
    'type', 'suggest', 'seat', meu,
    'guess', jsonb_build_array(p_suspect, p_weapon, aqui)
  ));

  update public.matches
     set public_state = estado, version = version + 1,
         turn_deadline = now() + interval '30 seconds'
   where id = p_match;

  return jsonb_build_object('ok', true);
end;
$function$;

revoke all on function public.dossie_suggest_como(smallint, uuid, text, text)
  from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.dossie_bot_passo(p_match uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  est     jsonb;
  tema    jsonb;
  semente bigint;
  assento smallint;
  quem    uuid;
  nivel   text;
  dedu    jsonb;
  priv    jsonb;

  pend    jsonb;
  fila    jsonb;
  naVez   smallint;
  mostrar text;
  tenho   text[];

  aqui    text;
  alvo    text;
  passo   text;
  susp    text[];
  arma    text[];
  sala    text[];
  fechados text[];
begin
  select m.public_state, m.seed into est, semente
    from public.matches m
   where m.id = p_match and m.game_key = 'dossie' and m.status = 'running'
   for update;
  if not found then return null; end if;

  select gt.data into tema from public.game_themes gt where gt.id = (est ->> 'theme');

  /* ── 1. REFUTAR ────────────────────────────────────────────────────────
     Primeiro de todos: enquanto a fila de refutação não anda, a mesa inteira
     espera, e o relógio dela é de trinta segundos. */
  if est ->> 'phase' = 'refute' and est -> 'pending' <> 'null'::jsonb
     and est -> 'pending' is not null then
    pend := est -> 'pending';
    fila := pend -> 'queue';
    naVez := (fila ->> coalesce((pend ->> 'at')::int, 0))::smallint;

    if naVez is not null then
      quem := public.dossie_dono(p_match, naVez);
      if exists (select 1 from public.profiles p where p.id = quem and p.is_bot) then
        select mps.data into priv from public.match_private_state mps
         where mps.match_id = p_match and mps.user_id = quem;

        /* QUAL CARTA MOSTRAR, quando há mais de uma.
           A regra de mesa: mostre de novo a que já mostrou àquela pessoa. Cada
           carta nova revelada é informação de graça para quem perguntou, e a
           máquina que dá informação de graça é a máquina que perde. */
        select array_agg(c order by c) into tenho
          from jsonb_array_elements_text(coalesce(priv -> 'hand', '[]'::jsonb)) c
         where pend -> 'guess' @> to_jsonb(array[c]);

        if tenho is null or array_length(tenho, 1) = 0 then
          perform public.dossie_pass_refute_como(naVez, p_match);
          return format('refuta:passa(%s)', naVez);
        end if;

        select c into mostrar
          from unnest(tenho) c
         where exists (
           select 1 from jsonb_array_elements(coalesce(priv -> 'mostrei', '[]'::jsonb)) m
            where m ->> 'card' = c and (m ->> 'para')::smallint = (pend ->> 'bySeat')::smallint
         )
         limit 1;

        if mostrar is null then
          -- nenhuma repetida: escolhe estável, sem `random()`
          select c into mostrar from unnest(tenho) c
           order by ('x' || substr(md5(semente::text || naVez::text || c), 1, 6))::bit(24)::int
           limit 1;
        end if;

        perform public.dossie_refute_como(naVez, p_match, mostrar);

        -- e ela ANOTA a quem mostrou, para poder repetir na próxima
        update public.match_private_state
           set data = jsonb_set(coalesce(data, '{}'::jsonb), '{mostrei}',
                 coalesce(data -> 'mostrei', '[]'::jsonb) || jsonb_build_array(
                   jsonb_build_object(
                     'card', mostrar,
                     'para', (pend ->> 'bySeat')::int,
                     -- o palpite vai junto: sem ele nao da para saber, depois,
                     -- se ela TINHA escolha na hora
                     'guess', pend -> 'guess',
                     'tinha', (select coalesce(jsonb_agg(c), '[]'::jsonb)
                                 from unnest(tenho) c))), true)
         where match_id = p_match and user_id = quem;

        return format('refuta:mostra(%s)', naVez);
      end if;
    end if;
    return null;   -- é vez de gente refutar
  end if;

  /* ── 2. A VEZ DELA ────────────────────────────────────────────────────── */
  if est ->> 'phase' <> 'turn' then return null; end if;

  assento := (est ->> 'turnSeat')::smallint;
  quem := public.dossie_dono(p_match, assento);
  if not exists (select 1 from public.profiles p where p.id = quem and p.is_bot) then
    return null;
  end if;

  select coalesce(rm.bot_nivel, 'medio') into nivel
    from public.matches m
    join public.room_members rm on rm.room_id = m.room_id and rm.user_id = quem
   where m.id = p_match;
  nivel := coalesce(nivel, 'medio');

  dedu := public.dossie_deduz(p_match, assento);
  susp := public.dossie_candidatos(tema, dedu, 'suspect');
  arma := public.dossie_candidatos(tema, dedu, 'weapon');
  sala := public.dossie_candidatos(tema, dedu, 'room');

  /* 2a. FECHOU O CASO? Um candidato em cada categoria e ela ainda não acusou.
     Nunca acusa sem certeza: errar vira fantasma, e máquina que se suicida por
     chute não é adversário mais fácil, é adversário quebrado. */
  if coalesce(array_length(susp, 1), 0) = 1
     and coalesce(array_length(arma, 1), 0) = 1
     and coalesce(array_length(sala, 1), 0) = 1
     and not coalesce(est -> 'accused' @> to_jsonb(array[assento]), false) then
    perform public.dossie_accuse_como(assento, p_match, susp[1], arma[1], sala[1]);
    return format('acusa(%s) %s, %s, %s', assento, susp[1], arma[1], sala[1]);
  end if;

  -- fantasma não joga, só refuta
  if coalesce(est -> 'ghosts' @> to_jsonb(array[assento]), false) then
    perform public.dossie_end_turn_como(assento, p_match);
    return format('passa(%s) fantasma', assento);
  end if;

  aqui := est -> 'positions' ->> assento::text;

  /* 2b. PALPITAR, se a sala em que ela está ainda é candidata.
     Palpitar numa sala já riscada gasta o turno para confirmar o que ela já
     sabe — e é o erro que mais denuncia uma máquina sem cabeça. */
  if (est ->> 'actionsLeft')::int >= 1
     and aqui is not null
     and (nivel = 'facil' or aqui = any(sala) or coalesce(array_length(sala, 1), 0) <= 1) then
    perform public.dossie_suggest_como(
      assento, p_match,
      susp[1 + (('x' || substr(md5(semente::text || coalesce(est ->> 'seq', '0') || 's'), 1, 6))::bit(24)::int
                % greatest(coalesce(array_length(susp, 1), 1), 1))],
      arma[1 + (('x' || substr(md5(semente::text || coalesce(est ->> 'seq', '0') || 'a'), 1, 6))::bit(24)::int
                % greatest(coalesce(array_length(arma, 1), 1), 1))]
    );
    return format('palpita(%s) em %s', assento, aqui);
  end if;

  /* 2c. ANDAR na direção da sala candidata mais próxima.

     Presa pela tempestade, ela não anda: cai direto no "passa". Tentar andar
     levantaria ROOM_CLOSED de dentro de `dossie_move_como`, e a exceção subiria
     pela faxina inteira — foi assim que o Dossiê parou de tirar o turno de
     ninguém no relógio uma vez (0033). A máquina que não pode andar passa a vez
     de propósito, não por acidente.

     E o alvo exclui o que está fechado: andar rumo a um lugar onde não se pode
     entrar é gastar o turno para bater na porta. */
  fechados := public.dossie_fechados(est);
  if (est ->> 'actionsLeft')::int >= 1 and aqui is not null
     and not (aqui = any(fechados)) then
    select s into alvo
      from unnest(sala) s
     where s <> aqui and not (s = any(fechados))
     order by ('x' || substr(md5(semente::text || assento::text || s), 1, 6))::bit(24)::int
     limit 1;

    if alvo is not null then
      passo := public.dossie_passo_para(tema, aqui, alvo, fechados);
      if passo is not null then
        perform public.dossie_move_como(assento, p_match, passo);
        return format('anda(%s) para %s', assento, passo);
      end if;
    end if;
  end if;

  -- 2d. nada a fazer: passa
  perform public.dossie_end_turn_como(assento, p_match);
  return format('passa(%s)', assento);
end;
$function$;

revoke all on function public.dossie_bot_passo(uuid) from public, anon, authenticated;
