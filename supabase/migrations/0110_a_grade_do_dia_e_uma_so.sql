-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0110 · a grade do dia é UMA, e fica escrita
--
-- O desafio diário promete uma coisa só: **a mesma grade para todo mundo no
-- dia**. Sem isso o placar do dia compara pontuações feitas em tabuleiros
-- diferentes, que é o mesmo que não ter placar.
--
-- `letreiro_grade_do_dia` cumpria a promessa por um caminho frágil: sorteava
-- por índice sobre o conjunto de grades sorteáveis, com o dia como semente.
-- Determinístico, sim — mas determinístico SOBRE UM CONJUNTO QUE MUDA.
--
--   offset (hash(dia) % quantas) order by id
--
-- `quantas` é a contagem de grades sorteáveis, e ela muda toda vez que
-- `build-boards.mjs` roda: ele apaga as grades que ninguém referencia e grava
-- outras. Regerar o pool no meio do dia dava, para o mesmo dia, uma grade
-- diferente — e quem abrisse antes e quem abrisse depois jogariam tabuleiros
-- diferentes com o mesmo placar.
--
-- Isso aconteceria de verdade na primeira vez que o dicionário fosse
-- recalibrado, que é justamente o que 0109 acabou de provocar: 2.409 grades
-- novas no lugar de 1.801.
--
-- ────────────────────────────────────────────────────────────────────────────
-- ESCREVER É MAIS BARATO QUE RECALCULAR
--
-- A grade do dia passa a ser uma linha: o primeiro a abrir o desafio decide, e
-- todo mundo depois lê a decisão. Uma linha por dia, oito bytes de chave, e a
-- promessa deixa de depender de nada continuar igual.
--
-- O sorteio continua igual e continua determinístico — ele só deixou de ser a
-- FONTE da resposta para virar o jeito de produzi-la na primeira vez.
--
-- ────────────────────────────────────────────────────────────────────────────
-- E A GRADE DO DIA NÃO PODE SER APAGADA POR BAIXO
--
-- `build-boards.mjs` apaga toda grade que nenhuma PARTIDA referencia. O desafio
-- diário não é uma partida: ele vive em `letreiro_diario`, e o script não olhava
-- para lá. A chave estrangeira com `on delete restrict` faz o banco recusar —
-- melhor um erro barulhento no script do que um dia de desafio que abre com a
-- grade nula.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.letreiro_dia (
  dia      date primary key,
  board_id bigint not null references public.letreiro_boards(id) on delete restrict,
  criada_em timestamptz not null default now()
);

/* Ninguém lê esta tabela pela rede: quem a usa é `letreiro_grade_do_dia`, que é
   `security definer`. RLS ligada sem política nenhuma nega tudo, que é
   exatamente o que se quer — e ler a grade de amanhã antes da hora seria a
   trapaça mais barata do desafio. */
alter table public.letreiro_dia enable row level security;
revoke all on table public.letreiro_dia from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

/**
 * A grade daquele dia — decidida na primeira chamada, lida em todas as outras.
 *
 * Deixou de ser `stable` porque agora ela ESCREVE na primeira vez. É o preço de
 * a resposta parar de depender do estado do pool, e é barato: uma linha por dia.
 *
 * A corrida de duas primeiras aberturas simultâneas resolve no `on conflict do
 * nothing` seguido de releitura — o mesmo desenho que `letreiro_diario_abrir`
 * já usa para dois cliques.
 */
create or replace function public.letreiro_grade_do_dia(p_dia date)
returns public.letreiro_boards
language plpgsql
security definer
set search_path = public
as $$
declare
  quantas int;
  escolhida bigint;
  qual    public.letreiro_boards;
begin
  select d.board_id into escolhida from public.letreiro_dia d where d.dia = p_dia;

  if escolhida is null then
    select count(*) into quantas
      from public.letreiro_boards b where b.size = 4 and b.usavel;
    if quantas = 0 then raise exception 'NO_BOARDS'; end if;

    /* O MESMO SORTEIO DE ANTES, e ele continua determinístico. O que mudou é
       que o resultado dele passa a ser guardado em vez de recalculado: um
       sorteio determinístico sobre um conjunto que muda não é determinístico
       coisa nenhuma. */
    select b.id into escolhida
      from public.letreiro_boards b
     where b.size = 4 and b.usavel
     order by b.id
    offset (('x' || substr(md5('mesa:diario:' || p_dia::text), 1, 8))::bit(32)::bigint
            % quantas)
     limit 1;

    insert into public.letreiro_dia (dia, board_id)
    values (p_dia, escolhida)
    on conflict (dia) do nothing;

    -- se outro chegou primeiro, vale o dele: a grade do dia é UMA
    select d.board_id into escolhida from public.letreiro_dia d where d.dia = p_dia;
  end if;

  select * into qual from public.letreiro_boards b where b.id = escolhida;
  return qual;
end;
$$;

revoke all on function public.letreiro_grade_do_dia(date) from public, anon, authenticated;
