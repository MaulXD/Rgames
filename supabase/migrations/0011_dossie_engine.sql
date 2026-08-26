-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0011 · Dossiê: motor e primeiro caso
-- Ver docs/03-PRD-DOSSIE.md e docs/07-SISTEMA-DE-TEMAS.md
--
-- O motor é agnóstico de conteúdo: ele conhece "6 suspeitos, 6 objetos, 9
-- lugares e um grafo". Nenhuma função abaixo tem um `id` de cômodo escrito à
-- mão. Adicionar um caso é inserir uma linha em game_themes.
--
-- A solução do crime vive numa coluna SEM policy de leitura. As mãos vivem em
-- match_private_state, legível só pelo dono. O payload de refutação NUNCA
-- carrega a carta mostrada — só quem mostrou.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.matches add column if not exists solution jsonb;
alter table public.matches add column if not exists turn_deadline timestamptz;

create index if not exists matches_turn_idx
  on public.matches (turn_deadline) where status = 'running';

-- ── pacotes de tema ────────────────────────────────────────────────────────
-- Conteúdo é dado, não código. O cliente lê (não há segredo aqui: elenco,
-- objetos e mapa são públicos); a solução é sorteada por partida.

create table if not exists public.game_themes (
  id         text primary key,
  game_key   text not null,
  name       text not null,
  era        text not null,
  tagline    text not null,
  data       jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.game_themes enable row level security;

drop policy if exists "temas sao publicos" on public.game_themes;
create policy "temas sao publicos" on public.game_themes for select using (true);

grant select on public.game_themes to anon, authenticated;
revoke insert, update, delete on public.game_themes from anon, authenticated;

-- ── Solar das Acácias · 1953 ───────────────────────────────────────────────
-- Grafo conferido: grau médio 3,11 · diâmetro ≤ 4 · nenhum beco sem saída.

insert into public.game_themes (id, game_key, name, era, tagline, data) values (
  'solar-das-acacias', 'dossie', 'Solar das Acácias', '1953',
  'Chovia desde a tarde e o Solar estava cheio de gente que não queria estar ali.',
  $json$
  {
    "victim": { "name": "Leonel de Sousa Aguiar", "role": "Barão do café" },
    "suspects": [
      { "id": "bastos",  "name": "Coronel Ubirajara Bastos", "role": "Sogro da vítima, reformado do Exército", "color": "oliva",   "crest": "espora" },
      { "id": "candida", "name": "Dona Cândida Meireles",    "role": "Viúva do irmão de Leonel",             "color": "vinho",   "crest": "camafeu" },
      { "id": "vidal",   "name": "Dr. Anselmo Vidal",        "role": "Médico da família há 30 anos",         "color": "prussia", "crest": "caduceu" },
      { "id": "zilda",   "name": "Zilda Rocha",              "role": "Governanta do solar",                  "color": "ocre",    "crest": "chaves" },
      { "id": "otavio",  "name": "Otávio Prado",             "role": "Sócio na fazenda, endividado",         "color": "grafite", "crest": "tinteiro" },
      { "id": "marisa",  "name": "Marisa Duarte",            "role": "Cantora de rádio, hóspede",            "color": "carmim",  "crest": "microfone" }
    ],
    "weapons": [
      { "id": "abridor",  "name": "Abridor de cartas" },
      { "id": "corda",    "name": "Corda de piano" },
      { "id": "castical", "name": "Castiçal de bronze" },
      { "id": "veneno",   "name": "Vidro de veneno" },
      { "id": "revolver", "name": "Revólver" },
      { "id": "bengala",  "name": "Bengala de castão" }
    ],
    "rooms": [
      { "id": "biblioteca", "name": "Biblioteca",        "col": 0, "row": 0 },
      { "id": "salao",      "name": "Salão de Baile",    "col": 1, "row": 0 },
      { "id": "musica",     "name": "Sala de Música",    "col": 2, "row": 0 },
      { "id": "escritorio", "name": "Escritório",        "col": 0, "row": 1 },
      { "id": "jardim",     "name": "Jardim de Inverno", "col": 1, "row": 1 },
      { "id": "varanda",    "name": "Varanda",           "col": 2, "row": 1 },
      { "id": "copa",       "name": "Copa",              "col": 0, "row": 2 },
      { "id": "adega",      "name": "Adega",             "col": 1, "row": 2 },
      { "id": "quarto",     "name": "Quarto de Hóspedes","col": 2, "row": 2 }
    ],
    "adjacency": {
      "biblioteca": ["salao", "escritorio"],
      "salao":      ["biblioteca", "musica", "jardim"],
      "musica":     ["salao", "varanda"],
      "escritorio": ["biblioteca", "jardim", "copa"],
      "jardim":     ["salao", "escritorio", "varanda", "adega"],
      "varanda":    ["musica", "jardim", "quarto"],
      "copa":       ["escritorio", "adega"],
      "adega":      ["copa", "jardim", "quarto"],
      "quarto":     ["varanda", "adega"]
    },
    "secretPassages": [["biblioteca", "quarto"], ["adega", "musica"]],
    "copy": {
      "suggest": "acusou",
      "refuted": "mostrou uma carta",
      "noRefute": "Ninguém pôde refutar.",
      "accuse": "Fechar o caso",
      "ghost": "Fantasma",
      "prep": "no"
    }
  }
  $json$::jsonb
) on conflict (id) do update set data = excluded.data, name = excluded.name,
  era = excluded.era, tagline = excluded.tagline;

-- ═══════════════════════════════════════════════════════════════════════════
-- Auxiliares
-- ═══════════════════════════════════════════════════════════════════════════

/** Embaralha um array de texto com PRNG determinístico (Fisher-Yates). */
create or replace function public.shuffle_text(p_arr text[], p_seed bigint)
returns text[]
language plpgsql
immutable
as $$
declare
  a text[] := p_arr;
  n int := array_length(p_arr, 1);
  s bigint := abs(p_seed) % 2147483647;
  j int;
  tmp text;
begin
  if n is null or n < 2 then
    return a;
  end if;
  for i in reverse n..2 loop
    s := (s * 1103515245 + 12345) % 2147483648;
    j := (s % i) + 1;
    tmp := a[i]; a[i] := a[j]; a[j] := tmp;
  end loop;
  return a;
end;
$$;

/** Dois lugares são alcançáveis num movimento? Corredor ou passagem. */
create or replace function public.dossie_can_move(p_theme jsonb, p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select
    exists (
      select 1 from jsonb_array_elements_text(p_theme -> 'adjacency' -> p_from) v
       where v = p_to
    )
    or exists (
      select 1 from jsonb_array_elements(p_theme -> 'secretPassages') pas
       where (pas ->> 0 = p_from and pas ->> 1 = p_to)
          or (pas ->> 1 = p_from and pas ->> 0 = p_to)
    );
$$;

/** Tipo de uma carta dentro do tema: suspect | weapon | room. */
create or replace function public.dossie_card_kind(p_theme jsonb, p_card text)
returns text
language sql
immutable
as $$
  select case
    when exists (select 1 from jsonb_array_elements(p_theme -> 'suspects') s where s ->> 'id' = p_card) then 'suspect'
    when exists (select 1 from jsonb_array_elements(p_theme -> 'weapons')  w where w ->> 'id' = p_card) then 'weapon'
    when exists (select 1 from jsonb_array_elements(p_theme -> 'rooms')    r where r ->> 'id' = p_card) then 'room'
    else null
  end;
$$;

/** Próximo assento com direito a turno (fantasma não joga, mas refuta). */
create or replace function public.dossie_next_seat(p_state jsonb, p_from smallint)
returns smallint
language plpgsql
immutable
as $$
declare
  assentos smallint[];
  fantasmas smallint[];
  n int;
  idx int;
  cand smallint;
begin
  select array_agg((value ->> 'seat')::smallint order by (value ->> 'seat')::int)
    into assentos
    from jsonb_array_elements(p_state -> 'players');

  select coalesce(array_agg(value::smallint), '{}')
    into fantasmas
    from jsonb_array_elements_text(p_state -> 'ghosts');

  n := array_length(assentos, 1);
  idx := array_position(assentos, p_from);
  if idx is null then
    idx := 0;
  end if;

  for k in 1..n loop
    cand := assentos[((idx - 1 + k) % n) + 1];
    if not (cand = any(fantasmas)) then
      return cand;
    end if;
  end loop;

  return null; -- todos fantasmas
end;
$$;
