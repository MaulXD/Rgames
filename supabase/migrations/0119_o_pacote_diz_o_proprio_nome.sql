-- 0119 — O PACOTE DIZ O PRÓPRIO NOME
--
-- `game_themes` guarda nome, era e chamada em COLUNAS, e o pacote inteiro em
-- `data`. O cliente monta o caso assim:
--
--     { ...colunas, ...data }
--
-- com o jsonb POR CIMA. Quer dizer que um pacote sem `name` funciona por
-- acidente: a coluna sobrevive porque nada a sobrescreve.
--
-- O Solar das Acácias nasceu numa migração e ficou só com as colunas; os três
-- casos publicados depois trazem os campos nos dois lugares. A diferença nunca
-- apareceu porque o acidente é silencioso — e o dia em que alguém publicar um
-- `name` velho dentro do jsonb, ele ganha da coluna calada.
--
-- ISSO JÁ ACONTECEU UMA VEZ, com `tagline`, e o conserto naquela vez foi um
-- backfill dentro do `npm run dossie`. Estava no lugar errado: quem sobe um
-- banco novo roda as migrações, e a suíte reprovaria até alguém lembrar de
-- rodar o seed. A forma do dado é responsabilidade da migração.
--
-- E o crivo do PRD 07 §5 passou a cobrar os dois campos — foi ele que achou
-- isto, ao ser lido pela primeira vez em cima do que está PUBLICADO e não do
-- que está prestes a ser publicado. O cabeçalho do relatório saiu
-- "undefined · undefined".
--
-- SÓ O DOSSIÊ, e isto foi aprendido em cima do erro.
--
-- A primeira versão desta migração varreu `game_themes` inteira, e três suítes
-- reprovaram na hora. O Domínio e a Metrópole NÃO leem o pacote assim: o mapa
-- de Vantara e o tabuleiro de Capibara são empacotados no cliente como JSON e
-- comparados campo a campo com o que está publicado — é o guarda que existe
-- para o dia em que alguém editar `vantara.json` e esquecer de republicar.
--
-- Encher o jsonb deles com colunas que o JSON não tem é fabricar exatamente a
-- divergência que aquele guarda procura. A mistura `{...colunas, ...data}` é do
-- carregador do Dossiê, e a correção pertence a quem tem o defeito.
--
-- Idempotente: só escreve onde falta.

update public.game_themes
   set data = data || jsonb_build_object('name', name)
 where game_key = 'dossie' and name is not null and data ->> 'name' is null;

update public.game_themes
   set data = data || jsonb_build_object('era', era)
 where game_key = 'dossie' and era is not null and data ->> 'era' is null;

update public.game_themes
   set data = data || jsonb_build_object('tagline', tagline)
 where game_key = 'dossie' and tagline is not null and data ->> 'tagline' is null;
