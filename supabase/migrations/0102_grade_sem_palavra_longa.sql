-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0102 · grade sem palavra longa também é grade fraca
--
-- Critério de aceite do PRD 02 §12: "100 grades sorteadas do pool: todas com
-- ≥60 palavras e ≥3 palavras de 7+". Medido no pool inteiro:
--
--     ≥ 60 palavras          866 de 866 ✅
--     ≥ 3 palavras de 7+     794 de 866 ❌   (72 reprovam, e 9 têm ZERO)
--
-- Oito por cento das rodadas de 4×4 começam numa grade onde a palavra mais
-- longa que existe tem seis letras. E o Letreiro é um jogo de achar palavra
-- longa: a pontuação cresce com o tamanho, a revelação premia o que ninguém
-- viu, e a conversa depois da rodada é sempre sobre a palavra grande. Numa
-- grade dessas não há palavra grande para ninguém achar, e a rodada fica plana
-- sem que ninguém entenda por quê — todo mundo acha que jogou mal.
--
-- É o mesmo defeito de 0052, com outra métrica. Lá era "poucas palavras comuns,
-- a revelação fica vazia". Aqui é "nenhuma palavra longa, o teto fica baixo". A
-- coluna `usavel` já existe justamente para isto, e o remédio é o mesmo: a
-- grade fraca não é apagada — ela deixa de ser sorteável.
--
-- Não apagar continua sendo essencial pelo motivo de 0052: `letreiro_grade_do_dia`
-- escolhe por `offset (md5 do dia % quantas)`, e mudar o CONJUNTO trocaria a
-- grade de todo dia passado. Com `usavel`, a conta muda uma vez e para.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE 3, E POR QUE SÓ NO 4×4
--
-- Três é o número do PRD, e ele tem lógica: com uma só, quem a achar ganha a
-- rodada sozinho e o resto assiste; com três, há disputa. O 5×5 já passa em
-- 798 de 798 — vinte e cinco letras produzem palavra longa sem esforço —, e a
-- exigência entra escalada por tamanho pelo mesmo motivo que o corte de
-- frequência do dicionário escala: o mesmo número em bandejas diferentes quer
-- dizer coisas diferentes.
--
-- SOBRAM 794 GRADES DE 4×4. O pool não precisa ser grande, precisa ser bom: o
-- desafio diário usa uma por dia, e uma partida sorteia uma. Setecentas e
-- noventa e quatro são dois anos de desafio diário sem repetir.
-- ════════════════════════════════════════════════════════════════════════════

/**
 * Quantas palavras de N letras ou mais o gabarito da grade tem.
 *
 * Sai do `solution`, que é o gabarito pré-computado pelo solver — a mesma fonte
 * que a apuração usa. Contar de outro jeito seria contar outra coisa.
 */
create or replace function public.letreiro_longas(p_solution jsonb, p_min int)
returns int
language sql
immutable
as $$
  select count(*)::int
    from jsonb_object_keys(coalesce(p_solution, '{}'::jsonb)) k
   where char_length(k) >= p_min;
$$;

revoke all on function public.letreiro_longas(jsonb, int) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

/* A regra completa de "esta grade é sorteável", num lugar só.

   As duas condições ficam juntas de propósito: separadas, a próxima métrica de
   qualidade viraria um terceiro `update` isolado, e daí a três já não dá para
   ler qual é a regra sem juntar as peças na cabeça. */
update public.letreiro_boards b
   set usavel =
     coalesce(array_length(b.comuns, 1), 0) >= case when b.size = 4 then 22 else 60 end
     and public.letreiro_longas(b.solution, 7) >= 3;

comment on column public.letreiro_boards.usavel is
  'Grade sorteável. Falso quando tem poucas palavras comuns (a revelação ficaria '
  'vazia) ou menos de três palavras de sete letras ou mais (a rodada fica plana: '
  'não há palavra grande para ninguém achar). Grade não usável continua guardada '
  'porque partida antiga referencia ela, e porque o desafio diário escolhe por '
  'índice sobre o conjunto.';
