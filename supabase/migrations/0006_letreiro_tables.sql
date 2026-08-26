-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0006 · Letreiro: dicionário e pool de grades
-- Ver docs/02-PRD-LETREIRO.md §4.4 e §4.5
--
-- Decisão de arquitetura que muda em relação ao PRD:
-- o dicionário fica SÓ no Postgres. Não vai DAWG para o cliente.
--
-- Motivo: o caminho aceso enquanto você digita é geometria pura (a grade tem
-- 16 células — o cliente resolve sozinho, instantâneo). A única coisa que
-- precisa do dicionário é a validação da palavra submetida, e 200 ms de
-- ida-e-volta ali é aceitável com UI otimista. Isso economiza ~700 KB de
-- download e ~40 MB de memória no celular, e nada é perdido.
-- O DAWG no cliente volta a fazer sentido em v1.1, para recusar na hora.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── dicionário ─────────────────────────────────────────────────────────────
-- `norm` é a forma comparável: maiúscula, sem acento, sem cedilha.
-- `word` é a grafia de verdade, que aparece na tela de revelação.

create table if not exists public.dict_pt (
  norm text primary key,
  word text not null,
  len  smallint generated always as (char_length(norm)) stored
);

create index if not exists dict_pt_len_idx on public.dict_pt (len);

alter table public.dict_pt enable row level security;
-- Sem policy: o cliente nunca lê o dicionário direto. Só as funções.
revoke all on public.dict_pt from anon, authenticated;

-- ── pool de grades ─────────────────────────────────────────────────────────
-- Gabarito pré-computado: todas as palavras, todos os caminhos, pontuação
-- máxima. Assim o início da partida não roda solver nenhum.

create table if not exists public.letreiro_boards (
  id          bigserial primary key,
  size        smallint not null default 4,
  grid        text[] not null,
  difficulty  smallint not null,
  word_count  integer not null,
  max_score   integer not null,
  solution    jsonb not null,
  created_at  timestamptz not null default now()
);

create index if not exists letreiro_boards_diff_idx on public.letreiro_boards (difficulty);

alter table public.letreiro_boards enable row level security;
-- Sem policy e sem grant: o gabarito NUNCA pode chegar ao cliente.
revoke all on public.letreiro_boards from anon, authenticated;

-- ── partidas ───────────────────────────────────────────────────────────────
-- As tabelas de partida do PRD 00 §8.3, na medida do que o Letreiro usa.

create table if not exists public.matches (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references public.rooms on delete cascade,
  game_key      text not null,
  status        text not null default 'running',
  seed          bigint not null,
  board_id      bigint references public.letreiro_boards,
  public_state  jsonb not null default '{}'::jsonb,
  version       integer not null default 0,
  ends_at       timestamptz,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  constraint match_status_known check (status in ('running','scoring','finished','abandoned'))
);

create index if not exists matches_room_idx on public.matches (room_id);
create index if not exists matches_ends_idx on public.matches (ends_at) where status = 'running';

alter table public.matches enable row level security;

create table if not exists public.match_private_state (
  match_id uuid not null references public.matches on delete cascade,
  user_id  uuid not null references public.profiles on delete cascade,
  data     jsonb not null default '{}'::jsonb,
  primary key (match_id, user_id)
);

alter table public.match_private_state enable row level security;

create table if not exists public.match_players (
  match_id uuid not null references public.matches on delete cascade,
  user_id  uuid not null references public.profiles on delete cascade,
  seat     smallint not null,
  score    integer not null default 0,
  primary key (match_id, user_id)
);

alter table public.match_players enable row level security;

-- ── policies ───────────────────────────────────────────────────────────────
-- A checagem de pertencimento passa por função SECURITY DEFINER, como em
-- 0004 — policy que consulta a própria tabela recorre infinitamente.

create or replace function public.is_match_member(p_match uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
      from public.matches m
      join public.room_members rm on rm.room_id = m.room_id
     where m.id = p_match and rm.user_id = auth.uid()
  );
$$;

revoke all on function public.is_match_member(uuid) from anon;
grant execute on function public.is_match_member(uuid) to authenticated;

drop policy if exists "membros leem a partida" on public.matches;
create policy "membros leem a partida"
  on public.matches for select
  using (public.is_room_member(room_id));

drop policy if exists "dono le seu estado privado" on public.match_private_state;
create policy "dono le seu estado privado"
  on public.match_private_state for select
  using (user_id = auth.uid());

drop policy if exists "membros leem o placar" on public.match_players;
create policy "membros leem o placar"
  on public.match_players for select
  using (public.is_match_member(match_id));

grant select on public.matches             to authenticated;
grant select on public.match_private_state to authenticated;
grant select on public.match_players       to authenticated;

revoke insert, update, delete on public.matches             from anon, authenticated;
revoke insert, update, delete on public.match_private_state from anon, authenticated;
revoke insert, update, delete on public.match_players       from anon, authenticated;

-- Realtime: o cliente precisa ver a partida começar e o placar sair.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'matches'
  ) then
    alter publication supabase_realtime add table public.matches;
  end if;
end $$;

alter table public.matches replica identity full;

-- A sala precisa saber que existe partida em andamento.
alter table public.rooms drop constraint if exists status_known;
alter table public.rooms add constraint status_known
  check (status in ('lobby','playing','scoring','archived'));
