-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0025 · trancar as funções internas de novo, e desta vez de verdade
--
-- O QUE ACONTECEU
--
-- A migração 0008 já tinha corrigido este erro uma vez, e a correção estava
-- incompleta. Ela revoga de PUBLIC:
--
--     revoke all on function public.letreiro_sweep() from public;
--
-- e isso resolve o grant implícito que o Postgres dá a PUBLIC em toda função
-- nova. Só que o projeto Supabase também tem ALTER DEFAULT PRIVILEGES
-- concedendo EXECUTE a `anon` e `authenticated` — grants NOMINAIS, em nome do
-- papel, que `revoke from public` não encosta. Toda função criada depois da
-- 0008 nasceu com esses dois grants e ficou aberta.
--
-- O teste de fumaça pegou `dominio_sweep` respondendo 200 a um cliente comum.
-- A auditoria que veio atrás achou mais quinze, e três delas são graves:
--
--   dominio_termina(uuid, jsonb, smallint)
--     Recebe o ESTADO como argumento e grava. Qualquer pessoa logada
--     encerrava qualquer partida, escrevendo o mapa que quisesse, coroando
--     quem quisesse. É a pior falha que este projeto teve.
--
--   dossie_force_refute / dossie_force_pass
--     Agem POR OUTRO JOGADOR. Existem para a faxina de quem sumiu. Na mão do
--     cliente, é jogar no lugar do adversário.
--
--   melhor_palavra(uuid, text, int) e as três `*_premia`
--     Escrevem no perfil de QUALQUER usuário e creditam XP à vontade.
--
-- A REGRA, agora escrita onde não dá para esquecer:
--
--   Função interna revoga de `public, anon, authenticated`. As três palavras,
--   sempre. Função do cliente revoga das três e concede nominalmente a
--   `authenticated`.
--
-- E, para não depender de eu lembrar: o teste de fumaça da plataforma agora
-- compara a lista de funções chamáveis com a lista permitida, e falha em
-- qualquer diferença — nos dois sentidos. Uma função nova exposta quebra o
-- teste antes de chegar na Vercel.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── as internas ────────────────────────────────────────────────────────────
-- Ordem alfabética por jogo, para dar para conferir de olho contra a auditoria.

do $$
declare
  fn text;
  internas text[] := array[
    -- plataforma
    'public.gen_room_code()',
    'public.handle_new_user()',
    'public.shuffle_text(text[], bigint)',
    'public.sweep_expired()',
    'public.sweep_guests()',
    'public.bump_guest_quota(text, integer)',
    'public.dar_xp(uuid, integer, jsonb, text[])',
    'public.melhor_palavra(uuid, text, integer)',
    -- Letreiro
    'public.letreiro_path_ok(text[], text, text, integer)',
    'public.letreiro_pontos(integer)',
    'public.letreiro_pontos_palavra(text)',
    'public.letreiro_premia(uuid)',
    'public.letreiro_score(uuid)',
    'public.letreiro_score_bruto(uuid)',
    'public.letreiro_sweep()',
    -- Dossiê
    'public.dossie_advance(uuid)',
    'public.dossie_can_move(jsonb, text, text)',
    'public.dossie_card_kind(jsonb, text)',
    'public.dossie_force_pass(uuid, smallint)',
    'public.dossie_force_refute(uuid, smallint, text)',
    'public.dossie_log(jsonb, jsonb)',
    'public.dossie_next_seat(jsonb, smallint)',
    'public.dossie_premia(uuid, smallint, boolean)',
    'public.dossie_sweep()',
    -- Domínio
    'public.dominio_assalto(bigint, bigint, integer, integer)',
    'public.dominio_carta(jsonb, bigint, integer)',
    'public.dominio_conectado(jsonb, jsonb, smallint, text, text)',
    'public.dominio_conta_cartas(jsonb, smallint, integer)',
    'public.dominio_dado(bigint, bigint)',
    'public.dominio_log(jsonb, jsonb)',
    'public.dominio_marca_fora(jsonb, smallint)',
    'public.dominio_na_vez(uuid)',
    'public.dominio_objetivo_ok(jsonb, jsonb, smallint, jsonb)',
    'public.dominio_premia(uuid, smallint)',
    'public.dominio_publico(uuid)',
    'public.dominio_reforco(jsonb, jsonb, smallint)',
    'public.dominio_sweep()',
    'public.dominio_termina(uuid, jsonb, smallint)',
    'public.dominio_valor_troca(integer)',
    'public.dominio_venceu(uuid, jsonb, jsonb, smallint)',
    'public.dominio_vizinhos(jsonb, text)'
  ];
begin
  foreach fn in array internas loop
    -- as três palavras. `public` mata o grant implícito, os outros dois matam
    -- os grants nominais do ALTER DEFAULT PRIVILEGES do projeto.
    execute format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
end;
$$;

-- ── as do cliente ──────────────────────────────────────────────────────────
-- Revoga das três e concede nominalmente a `authenticated`. `anon` fica de
-- fora de propósito: visitante sem sessão não age em partida nenhuma — a conta
-- de convidado é uma sessão de verdade, criada pelo servidor em /api/guest.

do $$
declare
  fn text;
  do_cliente text[] := array[
    -- plataforma
    'public.set_profile(text, jsonb)',
    'public.create_room(text)',
    'public.join_room(text)',
    'public.set_ready(uuid, boolean)',
    'public.set_color(uuid, text)',
    'public.touch_presence(uuid)',
    'public.leave_room(uuid)',
    'public.set_room_settings(uuid, jsonb)',
    -- Letreiro
    'public.letreiro_start(uuid)',
    'public.letreiro_submit(uuid, text, text)',
    -- Dossiê
    'public.dossie_start(uuid, text)',
    'public.dossie_move(uuid, text)',
    'public.dossie_suggest(uuid, text, text)',
    'public.dossie_refute(uuid, text)',
    'public.dossie_pass_refute(uuid)',
    'public.dossie_accuse(uuid, text, text, text)',
    'public.dossie_end_turn(uuid)',
    'public.dossie_pad(uuid, jsonb)',
    -- Domínio
    'public.dominio_start(uuid)',
    'public.dominio_reforcar(uuid, text, integer)',
    'public.dominio_trocar(uuid, integer[])',
    'public.dominio_atacar(uuid, text, text, integer)',
    'public.dominio_avancar(uuid, integer)',
    'public.dominio_remanejar(uuid, text, text, integer)',
    'public.dominio_encerrar_turno(uuid)'
  ];
begin
  foreach fn in array do_cliente loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;

-- ── as três que a RLS precisa ──────────────────────────────────────────────
--
-- Estas NÃO podem ser revogadas, e o motivo é sutil: a expressão de uma
-- policy é avaliada com os privilégios de quem faz a consulta. Se
-- `authenticated` não puder executar `is_room_member`, toda leitura da tabela
-- que usa essa policy morre com "permission denied for function" — e o lobby
-- inteiro para. Elas são seguras: leem só a associação de quem chamou.
--
-- Ficam declaradas aqui, explicitamente, para que a próxima auditoria as
-- encontre como decisão e não como esquecimento.

grant execute on function public.is_room_member(uuid)   to anon, authenticated;
grant execute on function public.is_match_member(uuid)  to anon, authenticated;
grant execute on function public.shares_room_with(uuid) to anon, authenticated;
