-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0038 · o embaralhamento tinha viés, e ele decidia três jogos
--
-- COMO APARECEU
--
-- Um teste dos eventos da cidade tentou quarenta sementes espaçadas de mil em
-- mil e a "obra na avenida" não saiu nenhuma vez. Medindo a distribuição em
-- 600 sementes:
--
--   consecutivas:  alta-temporada 161 · obra 160 · greve 110 · aperto 98 ·
--                  boom 38 · feriadao 33          (deveria ser ~100 cada)
--   espaçadas:     alta-temporada 313 · greve 109 · feriadao 90 · aperto 88 ·
--                  obra 0 · boom 0
--
-- Dois dos seis eventos NUNCA saíam, e um saía em mais da metade das partidas.
--
-- A CAUSA, e é a falha mais clássica que existe em geração de aleatório
--
-- `shuffle_text` era um Fisher-Yates alimentado por um gerador congruente
-- linear de módulo 2^31:
--
--     s := (s * 1103515245 + 12345) % 2147483648;
--     j := (s % i) + 1;
--
-- Num LCG de módulo potência de dois, os BITS BAIXOS têm período curtíssimo —
-- o bit 0 alterna a cada passo, o bit 1 a cada quatro, e assim por diante. E
-- `s % i` para i pequeno lê exatamente esses bits. É o `rand() % n` que todo
-- livro manda não fazer.
--
-- Pior no caso das sementes espaçadas, e dá para provar em três linhas: mil é
-- múltiplo de oito, 1103515245 é ímpar, então `s0 * 1103515245` é múltiplo de
-- oito para todo s0 múltiplo de mil. Somando 12345 (que é 1 módulo 8), o
-- resultado é SEMPRE 1 módulo 8. A primeira troca do embaralhamento era
-- praticamente fixa.
--
-- O QUE ISSO DECIDIA
--
-- `shuffle_text` não é um detalhe de um jogo. Ela sorteia:
--
--   Dossiê      — o caso: quem foi, com o quê, onde. E a distribuição das
--                 cartas na mão de cada um.
--   Domínio     — a repartição dos 42 territórios e os objetivos secretos
--   Metrópole   — os dois baralhos (Sorte e Revés), o sorteio inicial de
--                 propriedades, e agora os eventos
--
-- Ou seja: em três jogos, o que deveria ser sorte era enviesado. Nada disso dá
-- erro. Dá partidas que se parecem mais do que deveriam, e ninguém consegue
-- apontar o porquê.
--
-- O CONSERTO
--
-- Sai o Fisher-Yates com LCG; entra ordenação por hash. Cada elemento recebe
-- uma chave `md5(semente : posição : valor)` e o array é ordenado por ela.
-- Chaves independentes e uniformes sobre 128 bits dão uma permutação uniforme,
-- e o md5 do Postgres é bem misturado — é o mesmo princípio que `dominio_dado`
-- já usava (e por isso o dado do Domínio nunca teve este problema; a
-- verificação por força bruta dele mediu 0,17pp de desvio em 60 mil rolagens).
--
-- A posição entra na chave para desempatar valores repetidos: dois elementos
-- iguais em posições diferentes precisam de chaves diferentes, senão a ordem
-- entre eles fica a critério do `sort`.
--
-- CUSTO: um md5 por elemento em vez de uma multiplicação. Para 44 cartas é
-- irrelevante, e nenhuma dessas chamadas está em caminho quente.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.shuffle_text(p_arr text[], p_seed bigint)
returns text[]
language sql
immutable
as $$
  select case
    when p_arr is null or coalesce(array_length(p_arr, 1), 0) < 2 then p_arr
    else (
      select array_agg(x order by chave)
        from (
          select x,
                 md5(p_seed::text || ':' || ord::text || ':' || x) as chave
            from unnest(p_arr) with ordinality t(x, ord)
        ) k
    )
  end;
$$;

revoke all on function public.shuffle_text(text[], bigint) from public, anon, authenticated;
