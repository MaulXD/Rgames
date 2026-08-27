-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0051 · a decisão de "palavra comum" passa a viver num lugar só
--
-- O QUE ESTAVA ERRADO. A lista `comuns` de cada grade — que é a lista da
-- revelação e de onde a máquina tira as palavras dela — vinha de um corte único:
-- "está entre as 50 mil primeiras do corpus de legendas". O resultado, numa
-- grade de verdade:
--
--     SONO SONDA ONO ONDA ONDE DOS DONO DONDE DONA DUNA DUDA UNOS UNA ADE
--     ADELE AGUDO AGUDOS FONE FOR FOLE FUNDO NOS NON NOR NUNO NULO NEURO
--     NELE NET NETA NONO GUA GUDE GAEL GATE OUT ORE UFO ENDO ENA EURO
--
-- ONO, ADE, NON, NOR, GUA, DEA, ENA, OUT, NET, GATE, UFO, ADELE, GAEL, NUNO,
-- DUDA. A revelação é onde o jogo ENSINA — é o momento em que a pessoa vê o que
-- deixou passar. Mostrar "ADE" ali não é um detalhe: é o jogo dizendo que ADE
-- era uma palavra que ela devia ter achado.
--
-- POR QUE ACONTECEU. `freq` é POSTO no corpus (1 = mais falada), e o corpus é
-- de legenda de filme. Medido: NADA=68, FUNDO=864, DONO=1683, ONDA=3047 — e o
-- lixo vive entre 11 mil e 49 mil. Um corte único em 50 mil deixa tudo passar.
--
-- E o corpus degrada em RITMOS DIFERENTES por tamanho, que é a descoberta que
-- resolve o problema. Amostrado por faixa de posto:
--
--   3 letras, posto 15k–50k:  non lux joó âmi odo lao apé ebá pum net tau
--                             chu ori gia · ban pax jia bag lai gio iró
--   6 letras, posto 30k–50k:  cafofo reboço escuna fíbula torrão crasso
--                             micose bolero servil alaúde adorno gênese
--
-- Palavra longa que aparece no corpus é quase sempre palavra de verdade;
-- palavra de três letras é uma sopa de fragmento, sigla e nome. Então o corte
-- ESCALA COM O TAMANHO: 4 mil para 3 letras, 18 mil para 4, 32 mil para 5,
-- 50 mil de 6 em diante. Foi medido, não chutado: tira 993 palavras do
-- dicionário e 40% dos comuns de uma grade — porque grade é feita de palavra
-- curta, que é exatamente onde vive o lixo.
--
-- O QUE O CORTE NÃO PEGA: nome de personagem e inglês não traduzido, que têm
-- frequência ALTA numa legenda. Para esses existe `data/letreiro-nao-comum.txt`,
-- uma lista curada — e o cabeçalho dela conta por que não deu para automatizar
-- (o sinal do Hunspell foi medido e errou 37 dos 56 nomes testados).
--
-- ONDE A DECISÃO PASSA A MORAR. Numa coluna: `dict_pt.comum`. Hoje o corte
-- estava em `scripts/build-boards.mjs`, que é o consumidor — então quem quisesse
-- outra grade teria de repetir a regra. `build-dict` é quem tem o corpus, o
-- tamanho e a lista curada na mão; a decisão é dele, e todo mundo lê o
-- resultado. A regra de "aceitar" não muda em nada: o dicionário continua
-- generoso, e ADE segue valendo ponto para quem achar.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.dict_pt
  add column if not exists comum boolean not null default false;

-- O índice é por `comum` parcial: a consulta que importa é "me dê o conjunto
-- das comuns", e ela roda uma vez por reconstrução de grade.
create index if not exists dict_pt_comum_idx on public.dict_pt (norm) where comum;

comment on column public.dict_pt.comum is
  'Entra na revelação e no vocabulário da máquina. Decidido em scripts/build-dict.mjs: corte de posto escalado por tamanho, menos data/letreiro-nao-comum.txt. Palavra NÃO comum continua valendo ponto.';

-- ── recomputar as grades que já existem, sem regerar grade nenhuma ─────────

/**
 * Reescreve `comuns` e `max_score_comum` de toda grade a partir de
 * `dict_pt.comum`, e devolve quantas grades ficaram fracas demais para valer a
 * pena.
 *
 * REGERAR AS 2400 GRADES SERIA ERRADO, não só lento: a grade do desafio diário
 * é escolhida por md5 do dia sobre o conjunto de grades, então trocar o conjunto
 * troca a grade de todo dia passado — e o placar do dia deixaria de fazer
 * sentido. O gabarito de cada grade não mudou; só mudou quais palavras dele o
 * jogo MOSTRA. É um recálculo, não uma regeração.
 */
create or replace function public.letreiro_recomputa_comuns()
returns table (grades bigint, fracas bigint)
language plpgsql
as $$
begin
  update public.letreiro_boards b
     set comuns = coalesce(c.lista, '{}'),
         max_score_comum = coalesce(c.pontos, 0)
    from (
      select b2.id,
             array_agg(s.key order by s.key) lista,
             sum(public.letreiro_pontos_palavra(s.key))::int pontos
        from public.letreiro_boards b2
        cross join jsonb_each(b2.solution) s
        join public.dict_pt d on d.norm = s.key and d.comum
       group by b2.id
    ) c
   where b.id = c.id;

  -- grade sem palavra comum nenhuma some do recálculo acima (o group by não
  -- gera linha), então ela fica com o valor velho. Esta é a correção:
  update public.letreiro_boards b
     set comuns = '{}', max_score_comum = 0
   where not exists (
     select 1 from jsonb_each(b.solution) s
      join public.dict_pt d on d.norm = s.key and d.comum
   );

  return query
    select count(*),
           count(*) filter (
             where coalesce(array_length(b.comuns, 1), 0)
                   < case when b.size = 4 then 22 else 60 end
           )
      from public.letreiro_boards b;
end;
$$;

revoke all on function public.letreiro_recomputa_comuns() from public, anon, authenticated;
