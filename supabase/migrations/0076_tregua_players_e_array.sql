-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0076 · no Domínio, `players` é um ARRAY
--
--     if est -> 'players' -> p_com::text is null then
--       raise exception 'NOT_A_PLAYER';
--     end if;
--
-- Isso é o formato da METRÓPOLE, onde `players` é um objeto indexado por
-- assento: `{"0": {...}, "1": {...}}`. No Domínio é uma LISTA:
-- `[{"seat": 0, ...}, {"seat": 1, ...}]`.
--
-- Então `est -> 'players' -> '1'` no Domínio devolve o SEGUNDO elemento da lista
-- por índice — que existe, mas não é o assento 1 — e `-> '2'` num jogo de três
-- devolve NULL, fazendo `dominio_propor_tregua` recusar todo mundo com
-- NOT_A_PLAYER.
--
-- Escrevi as duas funções de trégua com o formato do jogo errado na cabeça, num
-- dia em que tinha acabado de mexer na Metrópole. Os dois estados se parecem o
-- suficiente para o erro passar por revisão e pouco o suficiente para quebrar
-- na primeira execução — que é exatamente o formato de defeito que só um teste
-- pega.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.dominio_propor_tregua_como(
  p_seat smallint, p_match uuid, p_com smallint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  est     jsonb;
  semente bigint;
  mapa    jsonb;
  quem    uuid;
  chave   text;
  alvo    jsonb;
begin
  select * into est, semente, mapa, quem from public.dominio_ator(p_match, p_seat);

  if p_com = p_seat then raise exception 'SELF_TRUCE'; end if;

  -- `players` é uma LISTA aqui, e não um objeto por assento
  select j into alvo
    from jsonb_array_elements(est -> 'players') j
   where (j ->> 'seat')::smallint = p_com;
  if alvo is null then raise exception 'NOT_A_PLAYER'; end if;
  if not coalesce((alvo ->> 'ativo')::boolean, true) then raise exception 'OUT_OF_GAME'; end if;

  if public.dominio_tregua_vale(est, p_seat, p_com) then raise exception 'ALREADY_TRUCED'; end if;

  chave := least(p_seat, p_com)::text || ':' || greatest(p_seat, p_com)::text;

  /* PROPOSTA ABERTA, e não trégua fechada. Trégua que vale sem o outro aceitar
     não é acordo — é uma regra imposta com cara de acordo. */
  est := jsonb_set(est, array['tregProp', chave],
    jsonb_build_object('de', p_seat, 'rodada', coalesce((est ->> 'round')::int, 1)), true);
  est := public.dominio_log(est, jsonb_build_object(
    'k', 'tregua-propoe', 'seat', p_seat, 'com', p_com));

  update public.matches set public_state = est, version = version + 1 where id = p_match;
  return public.dominio_publico(p_match);
end;
$$;

revoke all on function public.dominio_propor_tregua_como(smallint, uuid, smallint)
  from public, anon, authenticated;
