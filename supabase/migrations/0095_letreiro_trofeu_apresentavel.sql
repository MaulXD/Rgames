-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0095 · o troféu do perfil precisa ser apresentável
--
-- 0094 acabou de criar a estatística "palavra mais rara já encontrada", e a
-- primeira rodada de teste guardou `sodomia`.
--
-- Não foi azar. É o que o SELETOR faz: ele procura, entre as palavras que você
-- achou, a de maior posto na lista de frequência de fala — quer dizer, ele
-- procura o incomum. Num dicionário completo de português, procurar o incomum
-- encontra palavrão, termo sexual e xingamento, e encontra com frequência,
-- porque é exatamente ali que mora o vocabulário que ninguém usa no dia a dia.
--
-- Amostra real da faixa que o troféu escolhe (posto 20.000 a 120.000, 5 a 9
-- letras): flogisto, ictiólogo, farândola, cambriano, chiadeira — e orgásmico.
-- Os cinco primeiros são troféus ótimos. O sexto não é.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O QUE ESTA MIGRAÇÃO **NÃO** FAZ
--
-- Ela NÃO tira a palavra do jogo. Ela pontua, aparece na revelação, entra na
-- contagem de palavras achadas, conta para as conquistas. O dicionário é o
-- português inteiro e continua sendo — censurar a partida seria mudar o jogo
-- para resolver um problema que não é da partida.
--
-- O que ela faz é uma coisa só: aquela palavra não vira o TROFÉU PERMANENTE que
-- fica escrito no perfil. São decisões diferentes. O perfil existe para ser
-- mostrado — o próprio PRD 02 §6.9 define a seção como "coisas que a pessoa quer
-- contar para os amigos" —, e um jogo de mesa não escolhe sozinho a palavra que
-- vai ficar ali.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE RADICAL, E POR QUE NUMA TABELA
--
-- Radical casa por prefixo e rende muito mais que palavra solta: `caralh` pega
-- todas as flexões sem enumerar nenhuma. O preço é que prefixo é fácil de errar
-- — `cag` pegaria `cágado` —, então o mínimo é cinco letras e `npm run trofeu`
-- IMPRIME tudo o que cada radical captura, para ser lido.
--
-- Tabela e não lista dentro da função porque isto é dado curado que vai crescer,
-- e crescer sem migração. Mesma decisão de `data/letreiro-nao-comum.txt`, que já
-- guarda 327 nomes próprios e estrangeirismos pelo mesmo tipo de motivo.
--
-- ISTO É UM PISO, NÃO UMA GARANTIA. Nenhuma lista curta cobre o português. Ela
-- tira o óbvio; o resto é conserto quando aparecer, e é para isso que ela é um
-- arquivo de dados.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.letreiro_fora_do_trofeu (
  radical text primary key check (char_length(radical) >= 5)
);

alter table public.letreiro_fora_do_trofeu enable row level security;

/* Ninguém lê esta tabela pelo cliente, e é de propósito: é uma lista de
   palavrões, e servir uma lista de palavrões numa resposta de API é uma
   funcionalidade que ninguém pediu. As funções que a usam são SECURITY DEFINER
   e passam por cima da RLS. */
revoke all on table public.letreiro_fora_do_trofeu from public, anon, authenticated;

comment on table public.letreiro_fora_do_trofeu is
  'Radicais que não podem virar a "palavra mais rara" do perfil. Semeada por '
  '`npm run trofeu` a partir de data/letreiro-fora-do-trofeu.txt. Não afeta a '
  'partida: a palavra continua valendo, pontuando e aparecendo na revelação.';

-- ─────────────────────────────────────────────────────────────────────────────

/**
 * A palavra pode ficar escrita no perfil de alguém?
 *
 * Separada de `palavra_rara` de propósito: a decisão "isto é apresentável" é
 * diferente da decisão "isto é mais raro que o recorde", e as duas vão mudar por
 * motivos diferentes. Junto, a próxima mudança de uma teria de reler a outra.
 */
create or replace function public.palavra_apresentavel(p_norm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.letreiro_fora_do_trofeu f
     where upper(p_norm) like f.radical || '%'
  );
$$;

revoke all on function public.palavra_apresentavel(text) from public, anon, authenticated;
