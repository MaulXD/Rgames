-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0021 · frequência de uso no dicionário
--
-- O dicionário aceita 248 mil palavras, e está certo aceitar: recusar palavra
-- válida é a pior sensação do jogo. O problema é OUTRO — é o que o jogo
-- MOSTRA. A tela de revelação vinha exibindo "serioba", "bariome", "eleoma":
-- formas que existem no VOLP e que ninguém no Brasil usou este século. Isso
-- estraga o momento mais importante da partida.
--
-- Conserto: cada palavra ganha um posto de frequência, medido num corpus de
-- legendas (português falado, não escrito). Daí em diante:
--
--   aceitar  → generoso, o dicionário inteiro
--   mostrar  → só palavra comum
--   pontuar  → o aproveitamento passa a ser sobre as comuns
--
-- `freq` é o posto: 1 é a palavra mais falada, e NULL quer dizer "não apareceu
-- no corpus" — isto é, palavra rara.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.dict_pt add column if not exists freq integer;

create index if not exists dict_pt_freq_idx on public.dict_pt (freq)
  where freq is not null;

-- ── o gabarito passa a separar o comum do raro ─────────────────────────────

alter table public.letreiro_boards add column if not exists comuns text[];
alter table public.letreiro_boards add column if not exists max_score_comum integer;
