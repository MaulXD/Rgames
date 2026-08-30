-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0111 · a "dificuldade" da grade sai, e o número que ela resumia fica
--
-- `letreiro_boards.difficulty` é gravada desde 0006, tem índice próprio, e
-- NINGUÉM a lê. Nem uma RPC, nem o cliente, nem o lobby — o projeto inteiro,
-- fora o gerador que a escreve.
--
-- Ela existia para o modo Duelo (PRD 02 §6.5, v1.1): "melhor de 3 grades de
-- dificuldade crescente". Guardar por antecipação parece prudência e aqui foi o
-- contrário, por três motivos que só ficaram visíveis quando o dicionário mudou.
--
-- ────────────────────────────────────────────────────────────────────────────
-- 1. ELA É UM BALDE DE UM NÚMERO QUE A LINHA JÁ CARREGA
--
-- O cálculo era `array_length(comuns, 1)` comparado com múltiplos do piso:
--
--   < 1,5×  → 1     < 2,5× → 2     < 4× → 3     senão → 4
--
-- O Duelo precisa de ORDEM, e `array_length(comuns, 1)` já é a ordem exata. Um
-- balde de quatro degraus não acrescenta nada à ordem — ele só a perde.
--
-- ────────────────────────────────────────────────────────────────────────────
-- 2. AS BORDAS ERAM MÚLTIPLOS DE UM PISO QUE MUDOU
--
-- Ao expandir o dicionário, as grades passaram de 38 para 50 palavras comuns em
-- média no 4×4 e de 60 para 114 no 5×5. Os baldes não acompanharam, porque eles
-- foram assados no momento da geração:
--
--   4×4  dif 1: 125   dif 2: 652   dif 3: 413   dif 4: 5
--   5×5  dif 1: 312   dif 2: 704   dif 3: 182   dif 4: 2
--
-- Sete grades no degrau mais alto, entre 2.409. Um Duelo que pedisse "a mais
-- difícil" sortearia entre sete tabuleiros para sempre.
--
-- ────────────────────────────────────────────────────────────────────────────
-- 3. E O NOME DIZ O CONTRÁRIO DO QUE O NÚMERO SIGNIFICA
--
-- Mais palavras comuns é uma grade mais FÁCIL: há mais o que achar. `difficulty
-- = 4` marcava as grades mais generosas do pool. Quem fosse construir o Duelo
-- lendo o nome da coluna montaria a série ao contrário, e o defeito só
-- apareceria com gente jogando.
--
-- Um número derivado, congelado, com nome invertido e sem leitor é pior que
-- nenhum: ele parece uma resposta pronta. O Duelo ordena por
-- `array_length(comuns, 1)` na hora de escolher, que é sempre verdade.
-- ════════════════════════════════════════════════════════════════════════════

drop index if exists public.letreiro_boards_diff_idx;
alter table public.letreiro_boards drop column if exists difficulty;

/* O que o Duelo vai querer ordenar. Sem isto ele varre a tabela inteira para
   montar uma série de três — e é a única leitura que a coluna que saiu tinha
   como razão de existir. */
create index if not exists letreiro_boards_comuns_idx
  on public.letreiro_boards (size, array_length(comuns, 1))
  where usavel;
