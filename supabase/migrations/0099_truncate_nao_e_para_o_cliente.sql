-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0099 · o cliente tinha TRUNCATE em quatro tabelas de jogo
--
-- Auditando os privilégios de tabela para fechar um critério de aceite da
-- plataforma ("nenhum caminho do cliente escreve direto em `matches`"), o
-- resultado foi melhor e pior do que eu esperava:
--
--   INSERT, UPDATE, DELETE   nenhum papel de cliente tem, em nenhuma tabela
--   TRUNCATE                 `anon` e `authenticated` TÊM, em quatro
--
--     matches · match_players · match_private_state · game_themes
--
-- E **RLS NÃO SE APLICA A TRUNCATE**. Toda a arquitetura deste projeto — o
-- servidor é a fonte da verdade, o cliente só chama RPC, e as políticas de RLS
-- guardam o resto — passa ao largo desse comando. Uma política que diz "você só
-- lê a partida da sua sala" não diz nada sobre esvaziar a tabela inteira.
--
-- ────────────────────────────────────────────────────────────────────────────
-- QUÃO GRAVE ISTO É, HONESTAMENTE
--
-- Não há caminho conhecido para explorar hoje: a chave `anon` é um JWT para o
-- PostgREST, e o PostgREST não expõe TRUNCATE. O buraco é de PROFUNDIDADE, não
-- de superfície.
--
-- E é exatamente por isso que ele precisa fechar. A defesa em camadas existe
-- para o dia em que a camada de cima falha, e o custo de fechar é uma linha. Um
-- privilégio que não deveria existir, guardado por "o outro sistema não sabe
-- pedir", é um acidente esperando pelo primeiro `security invoker` distraído.
--
-- Repare também no absurdo em si: em `matches`, `anon` tem TRUNCATE e **não tem
-- SELECT**. Não dá para ler a tabela e dá para apagá-la.
--
-- ────────────────────────────────────────────────────────────────────────────
-- DE ONDE ISSO VEIO, E POR QUE VAI VOLTAR
--
-- É a MESMA causa de 0022, que este projeto já documentou:
--
--     "Revogar de PUBLIC não basta. O projeto Supabase concede EXECUTE a `anon`
--      e `authenticated` por ALTER DEFAULT PRIVILEGES."
--
-- O default é `GRANT ALL ON TABLES`, e ALL inclui TRUNCATE, TRIGGER e
-- REFERENCES. Cada migração que criou tabela revogou o que lembrou de revogar —
-- INSERT, UPDATE, DELETE — e deixou o resto.
--
-- Então TODA TABELA NOVA nasce assim de novo. Consertar as quatro é o remendo;
-- o conserto é a auditoria em `scripts/smoke.mjs`, que a partir de agora
-- percorre todas as tabelas de `public` e reprova qualquer privilégio de
-- escrita para papel de cliente. Comentário não é mecanismo — nesta sessão essa
-- frase já se pagou cinco vezes.
--
-- O QUE ESTA MIGRAÇÃO **NÃO** FAZ: mexer no `ALTER DEFAULT PRIVILEGES` do
-- projeto. Estreitar o default deixaria toda tabela futura segura de nascença,
-- e é tentador — mas é configuração da plataforma, não do jogo, e mudá-la de
-- lado dentro de uma migração de funcionalidade é o tipo de coisa que ninguém
-- encontra depois. Fica anotado como decisão para tomar de propósito.
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  t record;
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
  loop
    /* SELECT fica de fora de propósito: é o único privilégio de tabela que este
       projeto concede ao cliente, e ele é guardado por RLS (e, em `matches`,
       por grant de COLUNA — `seed`, `solution` e `board_id` nem constam). Tirar
       SELECT aqui derrubaria toda leitura do lobby e da mesa.

       Os outros quatro não têm uso nenhum para um cliente:

         TRUNCATE    esvazia a tabela, e RLS não olha
         TRIGGER     cria gatilho em tabela que não é sua
         REFERENCES  cria chave estrangeira apontando para ela
         MAINTAIN    VACUUM, ANALYZE, REINDEX (Postgres 17+) */
    execute format(
      'revoke truncate, trigger, references on table public.%I from anon, authenticated',
      t.relname
    );
  end loop;
end
$$;

/* MAINTAIN só existe do Postgres 17 em diante, e revogar um privilégio que a
   versão não conhece é erro de sintaxe. Separado num bloco próprio para que a
   migração continue valendo nas duas versões. */
do $$
declare
  t record;
begin
  if current_setting('server_version_num')::int < 170000 then return; end if;
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format(
      'revoke maintain on table public.%I from anon, authenticated', t.relname
    );
  end loop;
end
$$;
