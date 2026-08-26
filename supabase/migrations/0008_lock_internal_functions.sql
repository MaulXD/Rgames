-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0008 · trancar funções internas (correção de segurança)
--
-- O Postgres concede EXECUTE em toda função nova ao papel PUBLIC. Revogar de
-- `anon, authenticated` NÃO tira esse grant — e `authenticated` herda de
-- PUBLIC. Resultado: as migrações anteriores achavam que tinham trancado as
-- funções internas e não tinham trancado nada.
--
-- O teste de fumaça pegou: o cliente conseguia chamar `letreiro_score` e
-- encerrar a rodada quando quisesse. Pelo mesmo caminho, conseguia chamar
-- `sweep_guests`, que APAGA usuários, e `sweep_expired`, que apaga salas.
--
-- Regra a partir daqui: interna revoga de PUBLIC; o que o cliente usa é
-- concedido nominalmente a `authenticated`.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── internas: ninguém de fora chama ────────────────────────────────────────

revoke all on function public.letreiro_score(uuid)                 from public;
revoke all on function public.letreiro_sweep()                     from public;
revoke all on function public.letreiro_path_ok(text[], text, text) from public;
revoke all on function public.sweep_expired()                      from public;
revoke all on function public.sweep_guests()                       from public;
revoke all on function public.bump_guest_quota(text, integer)      from public;
revoke all on function public.gen_room_code()                      from public;
revoke all on function public.handle_new_user()                    from public;

-- ── do cliente: revoga de PUBLIC e concede nominalmente ────────────────────
-- Sem isso, `anon` (visitante sem sessão) também chamaria.

revoke all on function public.set_profile(text, jsonb)             from public;
revoke all on function public.create_room(text)                    from public;
revoke all on function public.join_room(text)                      from public;
revoke all on function public.set_ready(uuid, boolean)             from public;
revoke all on function public.set_color(uuid, text)                from public;
revoke all on function public.touch_presence(uuid)                 from public;
revoke all on function public.leave_room(uuid)                     from public;
revoke all on function public.letreiro_start(uuid)                 from public;
revoke all on function public.letreiro_submit(uuid, text, text)    from public;

grant execute on function public.set_profile(text, jsonb)          to authenticated;
grant execute on function public.create_room(text)                 to authenticated;
grant execute on function public.join_room(text)                   to authenticated;
grant execute on function public.set_ready(uuid, boolean)          to authenticated;
grant execute on function public.set_color(uuid, text)             to authenticated;
grant execute on function public.touch_presence(uuid)              to authenticated;
grant execute on function public.leave_room(uuid)                  to authenticated;
grant execute on function public.letreiro_start(uuid)              to authenticated;
grant execute on function public.letreiro_submit(uuid, text, text) to authenticated;

-- ── usadas dentro de policy: rodam como o papel que consulta ───────────────
-- Estas precisam continuar executáveis por `authenticated`, senão o RLS falha.

revoke all on function public.is_room_member(uuid)     from public;
revoke all on function public.shares_room_with(uuid)   from public;
revoke all on function public.is_match_member(uuid)    from public;
revoke all on function public.letreiro_pontos(integer) from public;

grant execute on function public.is_room_member(uuid)     to authenticated;
grant execute on function public.shares_room_with(uuid)   to authenticated;
grant execute on function public.is_match_member(uuid)    to authenticated;
grant execute on function public.letreiro_pontos(integer) to authenticated;

-- Função nova nasce sem EXECUTE para PUBLIC.
alter default privileges in schema public revoke execute on functions from public;
