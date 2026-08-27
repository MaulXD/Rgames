-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0026 · Metrópole, o motor
--
-- O maior estado dos quatro jogos, e o único onde quase tudo é público: em
-- Banco Imobiliário a informação oculta é ruim para o jogo. Você precisa ver o
-- caixa dos outros para saber se vale apertar.
--
-- AS DUAS DECISÕES QUE ORGANIZAM ESTE ARQUIVO
--
-- 1. Dinheiro nunca fica no ar. Toda transferência é uma única instrução, e o
--    estado ou tem o dinheiro num lugar ou no outro — nunca em nenhum. Não há
--    "debitou e vai creditar": a transação do Postgres é o cofre.
--
-- 2. A CASA ONDE VOCÊ PARA é resolvida por uma função só, `met_pousa`, e não
--    por um trecho dentro de `met_roll`. O motivo é que carta manda andar: uma
--    carta de Sorte pode te jogar no Leblon, e aí o aluguel do Leblon tem de
--    ser cobrado com as mesmas regras de sempre. Se a resolução morasse dentro
--    da rolagem, existiriam duas resoluções ligeiramente diferentes — e a
--    segunda seria a errada.
--
--    `met_pousa` recebe PROFUNDIDADE porque a cadeia é real: Sorte na casa 36,
--    "volte três casas", cai na 33, que é Revés, que pode mandar voltar três
--    de novo e cair na 30, que é "Vá para a Cadeia". Três níveis. O limite
--    existe para que um baralho mal escrito no futuro não vire laço infinito
--    dentro de uma transação.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── leitura do mapa ────────────────────────────────────────────────────────

/** A casa na posição p (0 a 39). */
create or replace function public.met_casa(p_mapa jsonb, p_pos int)
returns jsonb
language sql
immutable
as $$
  select p_mapa -> 'casas' -> p_pos;
$$;

revoke all on function public.met_casa(jsonb, int) from public, anon, authenticated;

/** Quantas propriedades de um tipo o assento tem (para transporte e companhia). */
create or replace function public.met_conta_tipo(
  p_mapa jsonb, p_est jsonb, p_seat smallint, p_tipo text
)
returns int
language sql
immutable
as $$
  select count(*)::int
    from jsonb_array_elements(p_mapa -> 'casas') c
   where c ->> 't' = p_tipo
     and (p_est -> 'props' -> (c ->> 'id') ->> 'owner')::smallint = p_seat;
$$;

revoke all on function public.met_conta_tipo(jsonb, jsonb, smallint, text) from public, anon, authenticated;

/** O assento tem o grupo de cor inteiro? É o que libera construir e dobra o aluguel. */
create or replace function public.met_grupo_completo(
  p_mapa jsonb, p_est jsonb, p_seat smallint, p_grupo text
)
returns boolean
language sql
immutable
as $$
  select not exists (
    select 1
      from jsonb_array_elements(p_mapa -> 'casas') c
     where c ->> 'g' = p_grupo
       and coalesce((p_est -> 'props' -> (c ->> 'id') ->> 'owner')::smallint, -1) <> p_seat
  );
$$;

revoke all on function public.met_grupo_completo(jsonb, jsonb, smallint, text) from public, anon, authenticated;

/**
 * O aluguel devido AGORA por parar numa propriedade.
 *
 * Zero quando não tem dono, quando está hipotecada, ou quando o dono é quem
 * parou. As três regras de cálculo, uma por tipo:
 *
 *   bairro      — hotel, ou casas, ou base (dobrada se o dono tem o grupo todo)
 *   transporte  — tabela por quantos transportes o dono tem
 *   companhia   — múltiplo sobre a SOMA DOS DADOS, e é por isso que a rolagem
 *                 fica no estado: sem ela, a companhia não tem aluguel.
 */
create or replace function public.met_aluguel(
  p_mapa jsonb, p_est jsonb, p_prop text, p_soma int
)
returns int
language plpgsql
immutable
as $$
declare
  casa    jsonb;
  estado  jsonb;
  dono    smallint;
  quantas int;
begin
  select c into casa
    from jsonb_array_elements(p_mapa -> 'casas') c
   where c ->> 'id' = p_prop
   limit 1;
  if casa is null then return 0; end if;

  estado := p_est -> 'props' -> p_prop;
  dono := (estado ->> 'owner')::smallint;
  if dono is null then return 0; end if;
  if coalesce((estado ->> 'hipotecada')::boolean, false) then return 0; end if;

  if casa ->> 't' = 'bairro' then
    if coalesce((estado ->> 'hotel')::boolean, false) then
      return ((casa -> 'aluguel') ->> 5)::int;
    end if;
    quantas := coalesce((estado ->> 'casas')::int, 0);
    if quantas > 0 then
      return ((casa -> 'aluguel') ->> quantas)::int;
    end if;
    -- grupo completo sem construção: aluguel dobrado. É o que faz o
    -- quase-monopólio já valer algo antes da primeira casa.
    if public.met_grupo_completo(p_mapa, p_est, dono, casa ->> 'g') then
      return ((casa -> 'aluguel') ->> 0)::int * 2;
    end if;
    return ((casa -> 'aluguel') ->> 0)::int;

  elsif casa ->> 't' = 'transporte' then
    quantas := public.met_conta_tipo(p_mapa, p_est, dono, 'transporte');
    return ((casa -> 'aluguel') ->> greatest(quantas - 1, 0))::int;

  elsif casa ->> 't' = 'companhia' then
    quantas := public.met_conta_tipo(p_mapa, p_est, dono, 'companhia');
    return ((casa -> 'multiplo') ->> least(greatest(quantas - 1, 0), 1))::int * p_soma;
  end if;

  return 0;
end;
$$;

revoke all on function public.met_aluguel(jsonb, jsonb, text, int) from public, anon, authenticated;

/**
 * Patrimônio: dinheiro + preço das propriedades + custo das construções.
 *
 * Hipotecada conta pela METADE, que é o que ela vale se você a resgatasse e
 * vendesse. É a conta que decide a vitória no modo Metrópole, então ela não
 * pode ser generosa: contar hipotecada pelo valor cheio premiaria alavancagem
 * sem risco, e todo mundo hipotecaria tudo na última rodada.
 */
create or replace function public.met_patrimonio(
  p_mapa jsonb, p_est jsonb, p_seat smallint
)
returns int
language plpgsql
immutable
as $$
declare
  total int := 0;
  c     jsonb;
  pe    jsonb;
begin
  total := coalesce((p_est -> 'players' -> p_seat::text ->> 'cash')::int, 0);

  for c in select value from jsonb_array_elements(p_mapa -> 'casas') loop
    if c ->> 'id' is null then continue; end if;
    pe := p_est -> 'props' -> (c ->> 'id');
    if pe is null or (pe ->> 'owner')::smallint <> p_seat then continue; end if;

    if coalesce((pe ->> 'hipotecada')::boolean, false) then
      total := total + (c ->> 'preco')::int / 2;
    else
      total := total + (c ->> 'preco')::int;
    end if;

    if c ->> 't' = 'bairro' then
      if coalesce((pe ->> 'hotel')::boolean, false) then
        -- hotel são cinco casas de custo
        total := total + (c ->> 'casa')::int * 5;
      else
        total := total + (c ->> 'casa')::int * coalesce((pe ->> 'casas')::int, 0);
      end if;
    end if;
  end loop;

  return total;
end;
$$;

revoke all on function public.met_patrimonio(jsonb, jsonb, smallint) from public, anon, authenticated;

/**
 * Anexa uma linha ao registro, a mais nova em cima, guardando as últimas 60.
 *
 * Mesmo desenho de `dominio_log`: a linha carrega um `seq` crescente, e a
 * ordenação é por ele e não pela posição no array. Sem o `seq`, o registro
 * ficaria à mercê da ordem em que o jsonb devolve os elementos — que não é
 * garantida — e a partida apareceria contada fora de ordem de vez em quando.
 */
create or replace function public.met_log(p_est jsonb, p_linha jsonb)
returns jsonb
language sql
immutable
as $$
  select p_est
    || jsonb_build_object('seq', coalesce((p_est ->> 'seq')::int, 0) + 1)
    || jsonb_build_object('log', (
         select jsonb_agg(x order by (x ->> 'seq')::int desc)
           from (
             select x from jsonb_array_elements(
               coalesce(p_est -> 'log', '[]'::jsonb)
               || jsonb_build_array(p_linha || jsonb_build_object(
                    'seq', coalesce((p_est ->> 'seq')::int, 0) + 1))
             ) x
             order by (x ->> 'seq')::int desc
             limit 60
           ) t
       ));
$$;

revoke all on function public.met_log(jsonb, jsonb) from public, anon, authenticated;

/**
 * A k-ésima carta de um baralho, derivada da semente.
 *
 * Mesmo princípio do baralho do Domínio: a ORDEM não pode estar no estado
 * público, senão todo mundo lê as próximas cartas. Aqui só o contador é
 * público; a ordem nasce da semente na hora de virar.
 */
create or replace function public.met_carta(
  p_mapa jsonb, p_seed bigint, p_qual text, p_k int
)
returns jsonb
language plpgsql
immutable
as $$
declare
  baralho jsonb := p_mapa -> p_qual;
  n       int := jsonb_array_length(baralho);
  ordem   text[];
  ciclo   int;
begin
  if n is null or n = 0 then return null; end if;
  ciclo := p_k / n;
  select public.shuffle_text(array_agg(g::text), p_seed + 613 * (ciclo + 1) + case p_qual when 'sorte' then 0 else 7 end)
    into ordem
    from generate_series(0, n - 1) g;
  return baralho -> (ordem[(p_k % n) + 1])::int;
end;
$$;

revoke all on function public.met_carta(jsonb, bigint, text, int) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- COMEÇAR
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.met_start(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sala      public.rooms;
  mapa      jsonb;
  semente   bigint;
  assentos  smallint[];
  n         int;
  modo      text;
  regras    jsonb;
  jogadores jsonb := '{}'::jsonb;
  props     jsonb := '{}'::jsonb;
  nova      public.matches;
  est       jsonb;
  i         int;
  assento   smallint;
  dono_id   uuid;
  cor_dele  text;
  ids       text[];
  sorteadas text[];
  quantas   int;
  caixa     int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into sala from public.rooms r where r.id = p_room;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if sala.host_id <> auth.uid() then raise exception 'NOT_HOST'; end if;
  if sala.game_key <> 'metropole' then raise exception 'WRONG_GAME'; end if;
  if exists (select 1 from public.matches m
              where m.room_id = p_room and m.status = 'running') then
    raise exception 'ALREADY_RUNNING';
  end if;

  select data into mapa from public.game_themes gt where gt.id = 'capibara';
  if mapa is null then raise exception 'NO_MAP'; end if;
  regras := mapa -> 'regras';

  select array_agg(rm.seat order by rm.seat) into assentos
    from public.room_members rm
   where rm.room_id = p_room and rm.seat is not null;
  n := coalesce(array_length(assentos, 1), 0);
  if n < 2 then raise exception 'NEED_TWO'; end if;
  if n > 6 then raise exception 'TOO_MANY'; end if;

  modo := coalesce(sala.settings ->> 'modo', 'metropole');
  if modo not in ('metropole', 'classico', 'relampago') then modo := 'metropole'; end if;

  semente := (random() * 9223372036854775806)::bigint;
  caixa := case modo when 'relampago' then 20000 else (regras ->> 'bancoInicial')::int end;

  -- toda propriedade começa sem dono, sem casa, sem hipoteca
  select array_agg(c ->> 'id') into ids
    from jsonb_array_elements(mapa -> 'casas') c
   where c ->> 'id' is not null;

  for i in 1..array_length(ids, 1) loop
    props := props || jsonb_build_object(ids[i], jsonb_build_object(
      'owner', null, 'casas', 0, 'hotel', false, 'hipotecada', false));
  end loop;

  for i in 1..n loop
    assento := assentos[i];
    select rm.user_id, coalesce(rm.color, 'grafite')
      into dono_id, cor_dele
      from public.room_members rm
     where rm.room_id = p_room and rm.seat = assento;

    jogadores := jogadores || jsonb_build_object(assento::text, jsonb_build_object(
      'userId', dono_id, 'cor', cor_dele,
      'cash', caixa, 'pos', 0, 'jail', 0, 'livras', 0,
      'quebrado', false, 'investidor', false));
  end loop;

  /* O SORTEIO INICIAL — a mudança mais eficaz do jogo.
     Distribuir três propriedades por pessoa na largada cria quase-monopólios
     na rodada 1, e a negociação começa antes do primeiro dado. Toda a
     lentidão da fase de aquisição do Banco Imobiliário — quinze rodadas de
     "rola e não compra nada" — desaparece. O modo Clássico não sorteia nada,
     e continua ali inteiro para quem quer a experiência original.
     Ver docs/05-PRD-METROPOLE.md §5.4. */
  quantas := case modo
               when 'metropole' then (regras ->> 'sorteioMetropole')::int
               when 'relampago' then (regras ->> 'sorteioRelampago')::int
               else 0
             end;

  if quantas > 0 then
    sorteadas := public.shuffle_text(ids, semente + 31);
    for i in 1..(quantas * n) loop
      -- rodízio: a i-ésima propriedade sorteada vai para o assento da vez,
      -- então ninguém leva três do mesmo grupo por acidente de ordem
      props := jsonb_set(props, array[sorteadas[i], 'owner'],
        to_jsonb(assentos[((i - 1) % n) + 1]));
    end loop;
  end if;

  insert into public.matches (room_id, game_key, seed, public_state, turn_deadline)
  values (p_room, 'metropole', semente, '{}'::jsonb, now() + interval '90 seconds')
  returning * into nova;

  for i in 1..n loop
    insert into public.match_players (match_id, user_id, seat)
    values (nova.id, (jogadores -> assentos[i]::text ->> 'userId')::uuid, assentos[i]);
    insert into public.match_private_state (match_id, user_id, data)
    values (nova.id, (jogadores -> assentos[i]::text ->> 'userId')::uuid,
            jsonb_build_object('aposta', null, 'notas', '{}'::jsonb));
  end loop;

  est := jsonb_build_object(
    'map', 'capibara',
    'mode', modo,
    'round', 1,
    'turnSeat', assentos[1],
    'phase', 'rolar',
    'players', jogadores,
    'props', props,
    'bank', jsonb_build_object(
      'casas', (regras ->> 'casasNoBanco')::int,
      'hoteis', (regras ->> 'hoteisNoBanco')::int),
    'dados', null,
    'duplos', 0,
    'pendente', null,
    'leilao', null,
    'cartas', jsonb_build_object('sorte', 0, 'reves', 0),
    'rolls', 0,
    'rodadaFinal', case modo
                     when 'metropole' then (regras ->> 'rodadasMetropole')::int
                     when 'relampago' then (regras ->> 'rodadasRelampago')::int
                     else null
                   end,
    'seq', 1,
    'log', jsonb_build_array(jsonb_build_object('k', 'abre', 'modo', modo, 'seq', 1)),
    'vencedor', null
  );

  update public.matches set public_state = est where id = nova.id;
  update public.rooms set status = 'playing' where id = p_room;

  return jsonb_build_object(
    'id', nova.id, 'status', nova.status,
    'turn_deadline', nova.turn_deadline, 'started_at', nova.started_at,
    'public_state', est
  );
end;
$$;

revoke all on function public.met_start(uuid) from public, anon, authenticated;
grant execute on function public.met_start(uuid) to authenticated;
