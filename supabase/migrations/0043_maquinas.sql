-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0043 · jogar contra a máquina
--
-- A DECISÃO DE ARQUITETURA, e é ela que faz o resto ser pequeno:
--
--   UM BOT É UM JOGADOR DE VERDADE. Tem conta, perfil, avatar, assento, cor e
--   linha em `match_players` — exatamente como uma pessoa. O servidor age no
--   lugar dele dentro de funções `security definer`, e ele nunca faz login.
--
-- A alternativa era um conceito paralelo de "assento de máquina", com
-- `user_id` nulo. Isso pareceria mais limpo e seria muito pior: `room_members`,
-- `match_players`, `match_private_state`, toda a RLS, a migração de anfitrião,
-- a contagem de assentos e a apuração assumem que existe um usuário por
-- assento. Um segundo tipo de participante obrigaria a rever cada um desses
-- lugares — e a esquecer um.
--
-- Com bot-como-jogador, o Letreiro não precisa de UMA LINHA de código novo na
-- apuração: as palavras da máquina são gravadas no estado privado dela, e
-- `letreiro_score_bruto` já sabe somar o estado privado de todos os jogadores.
-- Até a anulação de palavra repetida passa a valer contra a máquina, o que é
-- correto e interessante.
--
-- O QUE MUDA NO ESQUEMA: duas colunas. `profiles.is_bot` marca quem é máquina,
-- e `room_members.bot_nivel` diz em que nível ELA JOGA NESTA SALA — porque o
-- nível é do convite, não da conta. A mesma máquina pode ser fácil numa sala e
-- difícil em outra, ao mesmo tempo.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.profiles
  add column if not exists is_bot boolean not null default false;

alter table public.room_members
  add column if not exists bot_nivel text;

alter table public.room_members
  drop constraint if exists bot_nivel_conhecido;
alter table public.room_members
  add constraint bot_nivel_conhecido
  check (bot_nivel is null or bot_nivel in ('facil', 'medio', 'dificil'));

create index if not exists profiles_bot_idx on public.profiles (is_bot) where is_bot;

-- ── convidar e dispensar ───────────────────────────────────────────────────

/**
 * Põe uma máquina na mesa.
 *
 * Escolhe uma que ainda não esteja nesta sala, o primeiro assento livre e uma
 * cor livre. A mesma máquina pode estar em várias salas ao mesmo tempo — a
 * chave de `room_members` é (sala, jogador), então não há conflito, e um pool
 * de oito atende o site inteiro.
 *
 * A máquina entra PRONTA. Ela não tem por que não estar, e obrigar o anfitrião
 * a marcar "pronto" no lugar dela seria um clique que não decide nada.
 */
create or replace function public.adicionar_bot(p_room uuid, p_nivel text default 'medio')
returns public.room_members
language plpgsql
security definer
set search_path = public
as $$
declare
  sala    public.rooms;
  livre   smallint;
  cor     text;
  quem    uuid;
  saida   public.room_members;
  quantos int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_nivel not in ('facil', 'medio', 'dificil') then raise exception 'BAD_LEVEL'; end if;

  select * into sala from public.rooms r where r.id = p_room;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if sala.host_id <> auth.uid() then raise exception 'NOT_HOST'; end if;
  if sala.status <> 'lobby' then raise exception 'MATCH_IN_PROGRESS'; end if;

  -- o primeiro assento livre, do mesmo jeito que `join_room` faz
  select min(s) into livre
    from generate_series(0, 7) s
   where s not in (
     select seat from public.room_members
      where room_id = p_room and seat is not null
   );
  if livre is null then raise exception 'ROOM_FULL'; end if;

  select p.id into quem
    from public.profiles p
   where p.is_bot
     and p.id not in (select user_id from public.room_members where room_id = p_room)
   order by md5(p_room::text || p.id::text)
   limit 1;
  if quem is null then raise exception 'NO_BOT_AVAILABLE'; end if;

  -- uma cor que ninguém na sala esteja usando
  select c into cor
    from unnest(array['carmim','terracota','ocre','oliva','jade','grafite','prussia','vinho']) c
   where c not in (
     select color from public.room_members
      where room_id = p_room and color is not null
   )
   limit 1;

  insert into public.room_members (room_id, user_id, seat, color, role, is_ready, bot_nivel)
  values (p_room, quem, livre, cor, 'player', true, p_nivel)
  returning * into saida;

  select count(*) into quantos from public.room_members where room_id = p_room;
  return saida;
end;
$$;

revoke all on function public.adicionar_bot(uuid, text) from public, anon, authenticated;
grant execute on function public.adicionar_bot(uuid, text) to authenticated;

create or replace function public.remover_bot(p_room uuid, p_seat smallint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sala public.rooms;
  alvo uuid;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into sala from public.rooms r where r.id = p_room;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if sala.host_id <> auth.uid() then raise exception 'NOT_HOST'; end if;
  if sala.status <> 'lobby' then raise exception 'MATCH_IN_PROGRESS'; end if;

  select rm.user_id into alvo
    from public.room_members rm
    join public.profiles p on p.id = rm.user_id
   where rm.room_id = p_room and rm.seat = p_seat and p.is_bot;
  -- só máquina sai por aqui: dispensar gente é `leave_room`, e é decisão dela
  if alvo is null then raise exception 'NOT_A_BOT'; end if;

  delete from public.room_members where room_id = p_room and user_id = alvo;
end;
$$;

revoke all on function public.remover_bot(uuid, smallint) from public, anon, authenticated;
grant execute on function public.remover_bot(uuid, smallint) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- O CÉREBRO DO LETREIRO
--
-- A máquina do Letreiro não "procura" palavra: ela recebe uma lista no começo
-- da rodada e a revela ao longo do tempo. Isso não é atalho — é a única forma
-- honesta de fazer um adversário simultâneo sem um processo rodando ao lado.
--
-- TRÊS COISAS QUE FAZEM ELA PARECER GENTE, e cada uma foi escolhida contra o
-- reflexo de "fazer a máquina boa":
--
-- 1. SÓ PALAVRA COMUM. A máquina jamais acha "aalênio". Não é só justiça: um
--    adversário que enche o placar com palavra que ninguém conhece não é
--    difícil, é irritante — e ensina a pessoa que o jogo é injusto.
--
-- 2. AS FÁCEIS PRIMEIRO. A ordem de descoberta é por pontos crescente, com
--    ruído. Gente acha CASA antes de CAPACETES, e uma máquina que despeja a
--    palavra de oito letras aos dez segundos denuncia que não está jogando.
--
-- 3. O ALVO É UMA FRAÇÃO DO POSSÍVEL, não um número de palavras. Fácil mira
--    um quarto do que a grade dá em palavra comum; difícil, três quartos.
--    Assim o nível significa a mesma coisa numa grade pobre e numa rica.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.letreiro_bot_palavras(
  p_board bigint, p_seed bigint, p_nivel text, p_segundos int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  grade    public.letreiro_boards;
  alvo     int;
  fracao   numeric;
  ordem    text[];
  soma     int := 0;
  saida    jsonb := '[]'::jsonb;
  quantas  int := 0;
  palavra  text;
  pts      int;
  quando   numeric;
begin
  select * into grade from public.letreiro_boards b where b.id = p_board;
  if not found or coalesce(array_length(grade.comuns, 1), 0) = 0 then
    return '[]'::jsonb;
  end if;

  fracao := case p_nivel
              when 'facil'   then 0.25
              when 'dificil' then 0.72
              else 0.45
            end;
  alvo := greatest(1, (coalesce(grade.max_score_comum, grade.max_score) * fracao)::int);

  /* A ordem de descoberta: pontos crescente, com ruído da semente.
     `pontos * 100 + ruído` faz palavras de pontuação próxima trocarem de lugar
     entre si sem nunca deixar uma de dezoito pontos vir antes de uma de três.
     É o que dá a sensação de alguém procurando em vez de uma lista sendo
     lida. */
  select array_agg(c order by public.letreiro_pontos_palavra(c) * 100
                            + (('x' || substr(md5(p_seed::text || c), 1, 4))::bit(16)::int % 90))
    into ordem
    from unnest(grade.comuns) c;

  for i in 1..array_length(ordem, 1) loop
    exit when soma >= alvo;
    palavra := ordem[i];
    pts := public.letreiro_pontos_palavra(palavra);

    /* QUANDO ela acha. A raiz quadrada da fração percorrida espalha as
       descobertas na frente da rodada e rarefaz no fim — que é a curva de
       gente de verdade: as óbvias saem rápido, as últimas custam. E os últimos
       12% da rodada ficam livres, para a pessoa ter um fim de rodada em que
       ela não está sendo ultrapassada a cada segundo. */
    quantas := quantas + 1;
    quando := sqrt(soma::numeric / alvo) * p_segundos * 0.88;

    saida := saida || jsonb_build_array(jsonb_build_object(
      'w', palavra,
      'p', grade.solution ->> palavra,
      'pts', pts,
      'comum', true,
      'em', round(quando)
    ));
    soma := soma + pts;
  end loop;

  return saida;
end;
$$;

revoke all on function public.letreiro_bot_palavras(bigint, bigint, text, int)
  from public, anon, authenticated;

/**
 * Prepara as máquinas de uma partida de Letreiro.
 *
 * Escreve a lista de cada uma no estado privado dela — o MESMO lugar onde
 * ficam as palavras de uma pessoa. Por isso a apuração não muda: quando
 * `letreiro_score_bruto` varre o estado privado de todos, a máquina já está
 * lá, com caminhos válidos vindos do gabarito. Inclusive a anulação de palavra
 * repetida passa a valer contra ela.
 */
create or replace function public.letreiro_prepara_bots(p_match uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  partida public.matches;
  linha   record;
  lista   jsonb;
  quantos int := 0;
  segundos int;
begin
  select * into partida from public.matches m where m.id = p_match;
  if not found then return 0; end if;
  segundos := coalesce((partida.public_state ->> 'seconds')::int, 180);

  for linha in
    select mp.user_id, coalesce(rm.bot_nivel, 'medio') as nivel
      from public.match_players mp
      join public.profiles p on p.id = mp.user_id
      left join public.room_members rm
        on rm.room_id = partida.room_id and rm.user_id = mp.user_id
     where mp.match_id = p_match and p.is_bot
  loop
    -- a semente de cada máquina é a da partida mais o id dela: duas máquinas
    -- na mesma mesa acham palavras diferentes, e a mesma máquina na mesma
    -- partida acha sempre as mesmas
    lista := public.letreiro_bot_palavras(
      partida.board_id,
      partida.seed + ('x' || substr(md5(linha.user_id::text), 1, 6))::bit(24)::bigint,
      linha.nivel,
      segundos
    );

    update public.match_private_state
       set data = jsonb_build_object('words', lista, 'bot', true)
     where match_id = p_match and user_id = linha.user_id;

    /* E SÓ OS TEMPOS VÃO PARA O ESTADO PÚBLICO.
       A barra de tensão precisa mostrar QUANTAS a máquina já achou, e o
       cliente não pode ler o estado privado dela — nem deve. Então o público
       recebe apenas a lista de instantes de descoberta, sem uma palavra.

       É exatamente a mesma informação que a contagem de uma pessoa dá: quantas,
       nunca quais. E resolve sem processo rodando ao lado — o cliente conta
       quantos instantes já passaram. */
    update public.matches
       set public_state = jsonb_set(
             public_state,
             array['botTempos', linha.user_id::text],
             (select coalesce(jsonb_agg(w -> 'em' order by (w ->> 'em')::int), '[]'::jsonb)
                from jsonb_array_elements(lista) w),
             true
           )
     where id = p_match;

    quantos := quantos + 1;
  end loop;

  return quantos;
end;
$$;

revoke all on function public.letreiro_prepara_bots(uuid) from public, anon, authenticated;


-- ── letreiro_start prepara as maquinas ─────────────────────────────────────
-- Corpo gerado a partir da 0022 (a versao viva), com so a preparacao das
-- maquinas acrescentada no fim.

create or replace function public.letreiro_start(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

  select count(*) into quantas from public.letreiro_boards b where b.size = tamanho;
  if quantas = 0 then
    raise exception 'NO_BOARDS';
  end if;

  select * into tabuleiro
    from public.letreiro_boards b
   where b.size = tamanho
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
$$;

revoke all on function public.letreiro_start(uuid) from public, anon, authenticated;
grant execute on function public.letreiro_start(uuid) to authenticated;
