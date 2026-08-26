-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0019 · Domínio: motor e combate
-- Ver docs/04-PRD-DOMINIO.md
--
-- Nenhum dado é rolado no cliente. A sequência inteira sai de `seed` mais um
-- contador guardado no estado, então toda batalha é reproduzível e auditável
-- no replay — e ninguém consegue influenciar um resultado.
--
-- A grande diferença em relação ao WAR de mesa está no ataque: o jogador
-- declara a INTENÇÃO ("até conquistar, parando se eu ficar com 4") e o servidor
-- resolve a sequência toda de uma vez, gravando cada assalto. É o que devolve
-- uma hora da noite (§6.1 do PRD).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── dado ───────────────────────────────────────────────────────────────────
-- Dois bytes de md5 dão 65536 valores; 65536 mod 6 = 4, ou seja um viés de
-- 0,006% — irrelevante. Um byte só daria 0,4%, que já apareceria numa suíte
-- de dez mil batalhas.

create or replace function public.dominio_dado(p_seed bigint, p_n bigint)
returns int
language sql
immutable
as $$
  select 1 + ((get_byte(h, 0) * 256 + get_byte(h, 1)) % 6)
    from (select decode(md5(p_seed::text || ':' || p_n::text), 'hex') as h) s;
$$;

-- ── um assalto ─────────────────────────────────────────────────────────────
-- Atacante rola até 3 (nunca mais que exércitos − 1). Defensor rola até 3 —
-- é a regra do WAR brasileiro, não a do Risk. Empate favorece o defensor.

create or replace function public.dominio_assalto(
  p_seed bigint, p_n bigint, p_atac int, p_defe int,
  out d_atac int[], out d_defe int[], out perde_atac int, out perde_defe int, out usou int
)
language plpgsql
immutable
as $$
declare
  na int := least(3, greatest(p_atac - 1, 0));
  nd int := least(3, p_defe);
  i  int;
  a  int[] := '{}';
  d  int[] := '{}';
begin
  perde_atac := 0;
  perde_defe := 0;
  usou := 0;

  for i in 1..na loop
    a := a || public.dominio_dado(p_seed, p_n + usou);
    usou := usou + 1;
  end loop;
  for i in 1..nd loop
    d := d || public.dominio_dado(p_seed, p_n + usou);
    usou := usou + 1;
  end loop;

  -- ordena os dois conjuntos do maior para o menor
  select array_agg(x order by x desc) into a from unnest(a) x;
  select array_agg(y order by y desc) into d from unnest(d) y;

  for i in 1..least(na, nd) loop
    if a[i] > d[i] then
      perde_defe := perde_defe + 1;
    else
      perde_atac := perde_atac + 1;   -- empate: defensor ganha
    end if;
  end loop;

  d_atac := a;
  d_defe := d;
end;
$$;

-- ── auxiliares de mapa ─────────────────────────────────────────────────────

create or replace function public.dominio_vizinhos(p_mapa jsonb, p_ter text)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(v), '{}')
    from jsonb_array_elements_text(p_mapa -> 'adjacencia' -> p_ter) v;
$$;

/** Reforço: territórios ÷ 2 (mínimo 3) + bônus de cada continente controlado. */
create or replace function public.dominio_reforco(p_mapa jsonb, p_estado jsonb, p_seat smallint)
returns int
language plpgsql
immutable
as $$
declare
  meus int;
  extra int := 0;
  c jsonb;
  todos int;
  tenho int;
begin
  select count(*) into meus
    from jsonb_each_text(p_estado -> 'donos') d
   where d.value::smallint = p_seat;

  if meus = 0 then
    return 0;
  end if;

  for c in select value from jsonb_array_elements(p_mapa -> 'continentes') loop
    select count(*) into todos
      from jsonb_array_elements(p_mapa -> 'territorios') t
     where t ->> 'continente' = c ->> 'id';

    select count(*) into tenho
      from jsonb_array_elements(p_mapa -> 'territorios') t
     where t ->> 'continente' = c ->> 'id'
       and (p_estado -> 'donos' ->> (t ->> 'id'))::smallint = p_seat;

    if todos > 0 and todos = tenho then
      extra := extra + (c ->> 'bonus')::int;
    end if;
  end loop;

  return greatest(3, meus / 2) + extra;
end;
$$;

/** Existe caminho de `de` até `para` passando só por território do assento? */
create or replace function public.dominio_conectado(
  p_mapa jsonb, p_estado jsonb, p_seat smallint, p_de text, p_para text
)
returns boolean
language plpgsql
immutable
as $$
declare
  visto text[] := array[p_de];
  fila  text[] := array[p_de];
  atual text;
  v     text;
begin
  while array_length(fila, 1) > 0 loop
    atual := fila[1];
    fila := fila[2:];
    if atual = p_para then
      return true;
    end if;
    foreach v in array public.dominio_vizinhos(p_mapa, atual) loop
      if not (v = any(visto))
         and (p_estado -> 'donos' ->> v)::smallint = p_seat then
        visto := visto || v;
        fila := fila || v;
      end if;
    end loop;
  end loop;
  return false;
end;
$$;

/** Anexa uma linha ao log, mantendo as últimas 80. */
create or replace function public.dominio_log(p_estado jsonb, p_entry jsonb)
returns jsonb
language sql
immutable
as $$
  select p_estado
    || jsonb_build_object('seq', coalesce((p_estado ->> 'seq')::int, 0) + 1)
    || jsonb_build_object('log', (
         select jsonb_agg(x order by (x ->> 'seq')::int desc)
           from (
             select x from jsonb_array_elements(
               coalesce(p_estado -> 'log', '[]'::jsonb)
               || jsonb_build_array(p_entry || jsonb_build_object(
                    'seq', coalesce((p_estado ->> 'seq')::int, 0) + 1))
             ) x
             order by (x ->> 'seq')::int desc
             limit 80
           ) t
       ));
$$;

-- ── começar ────────────────────────────────────────────────────────────────

create or replace function public.dominio_start(p_room uuid)
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
  ters      text[];
  objs      jsonb;
  nova      public.matches;
  estado    jsonb;
  donos     jsonb := '{}'::jsonb;
  exercitos jsonb := '{}'::jsonb;
  jogadores jsonb := '[]'::jsonb;
  iniciais  int;
  i         int;
  seat      smallint;
  sobra     int;
  alvo      text;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into sala from public.rooms where id = p_room;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if sala.host_id <> auth.uid() then raise exception 'NOT_HOST'; end if;
  if sala.game_key <> 'dominio' then raise exception 'WRONG_GAME'; end if;
  if exists (select 1 from public.matches where room_id = p_room and status = 'running') then
    raise exception 'ALREADY_RUNNING';
  end if;

  select data into mapa from public.game_themes where id = 'vantara';
  if mapa is null then raise exception 'NO_MAP'; end if;

  select array_agg(seat order by seat) into assentos
    from public.room_members where room_id = p_room and seat is not null;
  n := coalesce(array_length(assentos, 1), 0);
  if n < 3 then raise exception 'NEED_THREE'; end if;
  if n > 6 then raise exception 'TOO_MANY'; end if;

  semente := (random() * 9223372036854775806)::bigint;
  iniciais := case n when 3 then 35 when 4 then 30 when 5 then 25 else 20 end;

  -- territórios embaralhados e repartidos em rodízio, 1 exército em cada
  select public.shuffle_text(array_agg(t ->> 'id'), semente) into ters
    from jsonb_array_elements(mapa -> 'territorios') t;

  for i in 1..array_length(ters, 1) loop
    seat := assentos[((i - 1) % n) + 1];
    donos := donos || jsonb_build_object(ters[i], seat);
    exercitos := exercitos || jsonb_build_object(ters[i], 1);
  end loop;

  -- o resto do exército inicial cai sozinho nos próprios territórios.
  -- O WAR de mesa faz isso um a um, e são dez minutos de nada acontecendo.
  for i in 1..n loop
    seat := assentos[i];
    sobra := iniciais - (
      select count(*) from jsonb_each_text(donos) d where d.value::smallint = seat
    );
    while sobra > 0 loop
      select key into alvo
        from jsonb_each_text(donos)
       where value::smallint = seat
       order by md5(semente::text || ':' || sobra::text || key)
       limit 1;
      exercitos := jsonb_set(exercitos, array[alvo],
        to_jsonb((exercitos ->> alvo)::int + 1));
      sobra := sobra - 1;
    end loop;
  end loop;

  select jsonb_agg(value) into objs
    from jsonb_array_elements(mapa -> 'objetivos');

  insert into public.matches (room_id, game_key, seed, public_state, turn_deadline)
  values (p_room, 'dominio', semente, '{}'::jsonb, now() + interval '120 seconds')
  returning * into nova;

  for i in 1..n loop
    seat := assentos[i];

    insert into public.match_players (match_id, user_id, seat)
    select nova.id, rm.user_id, rm.seat
      from public.room_members rm
     where rm.room_id = p_room and rm.seat = seat;

    -- objetivo secreto: entra no estado privado, e o privado não é legível
    -- por mais ninguém (RLS em match_private_state)
    insert into public.match_private_state (match_id, user_id, data)
    select nova.id, rm.user_id,
           jsonb_build_object(
             'objetivo', objs -> ((abs(hashtext(semente::text || seat::text)) % jsonb_array_length(objs))),
             'cartas', '[]'::jsonb,
             'planos', '[]'::jsonb
           )
      from public.room_members rm
     where rm.room_id = p_room and rm.seat = seat;

    jogadores := jogadores || jsonb_build_array(jsonb_build_object(
      'seat', seat,
      'userId', (select user_id from public.room_members
                  where room_id = p_room and seat = seat),
      'cor', (select coalesce(color, 'grafite') from public.room_members
               where room_id = p_room and seat = seat),
      'cartas', 0,
      'ativo', true
    ));
  end loop;

  estado := jsonb_build_object(
    'map', 'vantara',
    'mode', coalesce(sala.settings ->> 'modo', 'campanha'),
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
$$;

revoke all on function public.dominio_start(uuid) from public;
grant execute on function public.dominio_start(uuid) to authenticated;
