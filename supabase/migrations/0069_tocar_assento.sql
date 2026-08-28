-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0069 · `seat` de novo, e no mesmo lugar
--
--     column reference "seat" is ambiguous
--     It could refer to either a PL/pgSQL variable or a table column.
--
-- Em 0049 e 0050 este projeto aprendeu que variável de assento não pode se
-- chamar `seat`, porque `match_players.seat` existe e o Postgres recusa em vez
-- de escolher. A regra ficou escrita: `assento`.
--
-- E em 0068, ao reescrever `dominio_tocar` do zero para ela tocar um PASSO em
-- vez do turno inteiro, escrevi `seat` outra vez. Não por esquecer a regra —
-- por escrever uma função nova sem lembrar que ela existia.
--
-- É o mesmo padrão da terceira vez que copiei uma função do arquivo em vez do
-- banco: a disciplina que depende de eu lembrar não é disciplina, é sorte. Por
-- isso o conserto vem com uma AUDITORIA em scripts/smoke.mjs, que procura o
-- padrão `<tabela>.seat = seat` em todas as funções do schema e quebra o teste.
-- Regra que a máquina confere é regra que se segue.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.dominio_tocar(p_match uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  est   jsonb;
  vivo  text;
  assento  smallint;
  dono  uuid;
  passo text;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select m.public_state, m.status into est, vivo
    from public.matches m where m.id = p_match;
  if not found then raise exception 'MATCH_NOT_FOUND'; end if;
  if vivo <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;

  if not exists (
    select 1 from public.match_players mp
     where mp.match_id = p_match and mp.user_id = auth.uid()
  ) then
    raise exception 'NOT_A_PLAYER';
  end if;

  assento := (est ->> 'turnSeat')::smallint;
  select mp.user_id into dono
    from public.match_players mp
   where mp.match_id = p_match and mp.seat = assento;

  if not exists (select 1 from public.profiles p where p.id = dono and p.is_bot) then
    raise exception 'NOT_BOT_TURN';
  end if;

  passo := public.dominio_bot_passo(p_match);
  if passo is null then raise exception 'BOT_STUCK'; end if;

  /* Devolve o rótulo do passo junto com o estado, igual à Metrópole: é com ele
     que a tela conta "Creuza reforçou a Aurélia" em vez de deixar o mapa mudar
     de cor sozinho. */
  return jsonb_build_object('passo', passo, 'match', public.dominio_publico(p_match));
end;
$function$;

revoke all on function public.dominio_tocar(uuid) from public, anon, authenticated;
grant execute on function public.dominio_tocar(uuid) to authenticated;
