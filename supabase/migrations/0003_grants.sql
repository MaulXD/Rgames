-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0003 · permissões de leitura
--
-- RLS é um filtro, não uma permissão. Sem GRANT SELECT o papel `authenticated`
-- não lê nada — nem via PostgREST, nem via Realtime (Postgres Changes só
-- entrega linhas que o assinante pode ler).
--
-- As migrações 0001/0002 ligaram RLS e escreveram as policies, mas ficaram sem
-- grant nenhum. O teste de fumaça pegou: toda leitura voltava erro.
--
-- SELECT sim. INSERT/UPDATE/DELETE nunca — o cliente só escreve por
-- SECURITY DEFINER. Ver docs/00-PRD-PLATAFORMA.md §8.4.
-- ═══════════════════════════════════════════════════════════════════════════

grant usage on schema public to anon, authenticated;

grant select on public.profiles      to anon, authenticated;
grant select on public.rooms         to anon, authenticated;
grant select on public.room_members  to anon, authenticated;

-- Cinturão e suspensório: se algum privilégio padrão tiver concedido escrita
-- em algum momento, ele morre aqui.
revoke insert, update, delete, truncate on public.profiles     from anon, authenticated;
revoke insert, update, delete, truncate on public.rooms        from anon, authenticated;
revoke insert, update, delete, truncate on public.room_members from anon, authenticated;

-- A tabela de controle de migração continua invisível para a API.
revoke all on public._migrations from anon, authenticated;

-- Funções de escrita: só quem está autenticado chama.
revoke execute on function public.set_profile(text, jsonb)   from anon;
revoke execute on function public.create_room(text)          from anon;
revoke execute on function public.join_room(text)            from anon;
revoke execute on function public.set_ready(uuid, boolean)   from anon;
revoke execute on function public.set_color(uuid, text)      from anon;
revoke execute on function public.touch_presence(uuid)       from anon;
revoke execute on function public.leave_room(uuid)           from anon;

grant execute on function public.set_profile(text, jsonb)  to authenticated;
grant execute on function public.create_room(text)         to authenticated;
grant execute on function public.join_room(text)           to authenticated;
grant execute on function public.set_ready(uuid, boolean)  to authenticated;
grant execute on function public.set_color(uuid, text)     to authenticated;
grant execute on function public.touch_presence(uuid)      to authenticated;
grant execute on function public.leave_room(uuid)          to authenticated;

-- Faxina e geração de código são internas.
revoke all on function public.sweep_expired()   from anon, authenticated;
revoke all on function public.gen_room_code()   from anon, authenticated;

-- Daqui para frente, tabela nova já nasce com leitura para os dois papéis.
alter default privileges in schema public grant select on tables to anon, authenticated;
