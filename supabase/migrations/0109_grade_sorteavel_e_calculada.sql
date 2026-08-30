-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0109 · "esta grade é sorteável" passa a ser conta do banco
--
-- 0102 escreveu a regra completa e a aplicou com um `update`. O comentário
-- dela dizia, com todas as letras: "com `usavel`, a conta muda uma vez e para".
--
-- Muda uma vez para as grades que existiam naquele dia. Toda grade gerada
-- DEPOIS entra pelo `insert` de `build-boards.mjs`, que não conhece a regra e
-- não preenche a coluna — ela nasce com o padrão, e o padrão é verdadeiro.
--
-- Foi o que aconteceu ao regerar o pool com o dicionário expandido: 2.409
-- grades novas, todas marcadas como sorteáveis, e duas delas sem UMA palavra de
-- sete letras. A regra continuava escrita, continuava certa, e não valia para
-- nada que tivesse chegado depois.
--
-- ────────────────────────────────────────────────────────────────────────────
-- REGRA QUE MORA NUM `UPDATE` É REGRA COM DATA DE VALIDADE
--
-- É o mesmo defeito da carta decorativa e da regra da casa sem botão, num
-- terceiro disfarce: a coisa está escrita, ninguém a executa, e nada quebra
-- para avisar. Aqui o disfarce é o pior dos três, porque a regra JÁ RODOU uma
-- vez — o `update` de 0102 está no histórico, funcionou, e o teste passou.
--
-- Uma coluna gerada não tem esse problema. Ela é calculada pelo banco em todo
-- `insert` e em todo `update`, para sempre, e não há caminho que a contorne:
-- nem um script novo, nem uma carga manual, nem um `copy`. A regra deixa de ser
-- uma coisa que alguém precisa lembrar de rodar.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O QUE A REGRA DIZ, sem mudança
--
--   poucas palavras comuns    a revelação ficaria vazia
--   menos de três com 7+      a rodada fica plana: não há palavra grande para
--                             ninguém achar, e quem achar a única ganha sozinho
--
-- Grade não sorteável continua guardada: partida antiga referencia ela, e o
-- desafio diário escolhe por índice sobre o conjunto inteiro.
-- ════════════════════════════════════════════════════════════════════════════

/* Não dá para converter uma coluna comum em gerada — o jeito é derrubar e
   recriar. Não há índice nem visão pendurada nela; o que existe são consultas
   com `where usavel`, e essas seguem funcionando. */
alter table public.letreiro_boards drop column usavel;

alter table public.letreiro_boards
  add column usavel boolean
  generated always as (
    coalesce(array_length(comuns, 1), 0) >= case when size = 4 then 22 else 60 end
    and public.letreiro_longas(solution, 7) >= 3
  ) stored;

comment on column public.letreiro_boards.usavel is
  'Grade sorteável — COLUNA GERADA, calculada pelo banco. Falso quando tem '
  'poucas palavras comuns (a revelação ficaria vazia) ou menos de três palavras '
  'de sete letras ou mais (a rodada fica plana). Foi coluna comum até 0109, e '
  'quem a preenchia era um `update` de migração: toda grade gerada depois '
  'daquele dia nascia sorteável sem passar pela regra.';
