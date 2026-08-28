-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0077 · `jsonb_set` com pai ausente, pela segunda vez
--
--     est := jsonb_set(est, array['tregProp', chave], valor, true);
--
-- O quarto argumento (`create_missing`) cria só o ÚLTIMO degrau do caminho. Se
-- `tregProp` não existe no estado, o caminho tem um degrau faltando no meio — e
-- `jsonb_set` devolve o estado INTACTO, sem erro nenhum.
--
-- Provado em uma linha:
--
--     select jsonb_set('{"a":1}', array['novo','chave'], '[]', true)
--     → {"a": 1}
--
-- Este projeto já caiu nisso em 0044, com `botTempos` — e o comentário lá
-- explica exatamente esta armadilha. A trégua caiu nela em TRÊS lugares de uma
-- vez: `tregProp`, `treguas` e `multaReforco`, os três nascendo agora e nenhum
-- existindo no estado inicial de `dominio_start`.
--
-- O sintoma foi perfeito para enganar: propor funcionava (a chamada não dava
-- erro), o registro escrevia "propôs trégua", e aceitar respondia NO_PROPOSAL.
-- Uma proposta que o jogo diz ter recebido e não encontra depois.
--
-- ─────────────────────────────────────────────────────────────────────────
-- O CONSERTO É UMA FUNÇÃO, e não três coalesces espalhados
--
-- Escrever `jsonb_set(coalesce(est -> 'x', '{}'), …)` em cada lugar funciona e
-- é exatamente o que se esquece no quarto lugar. `jsonb_poe` faz a coisa certa
-- num sítio só, e o nome dela é curto o bastante para ser mais fácil de usar do
-- que de evitar — que é a única forma de uma regra pegar.
-- ═══════════════════════════════════════════════════════════════════════════

/**
 * Grava `p_val` em `p_obj[p_a][p_b]`, criando `p_a` se ele não existir.
 *
 * É o que `jsonb_set(..., create_missing => true)` PARECE fazer e não faz: ele
 * cria só o último degrau, então um caminho de dois níveis sobre uma chave
 * inexistente devolve o objeto intacto e em silêncio.
 */
create or replace function public.jsonb_poe(
  p_obj jsonb, p_a text, p_b text, p_val jsonb
)
returns jsonb
language sql
immutable
as $$
  select jsonb_set(
    case when jsonb_typeof(p_obj -> p_a) = 'object'
         then p_obj
         else p_obj || jsonb_build_object(p_a, '{}'::jsonb) end,
    array[p_a, p_b], p_val, true);
$$;

revoke all on function public.jsonb_poe(jsonb, text, text, jsonb)
  from public, anon, authenticated;

-- ── as três da trégua ──────────────────────────────────────────────────────

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

  -- `players` é uma LISTA aqui, e não um objeto por assento (ver 0076)
  select j into alvo
    from jsonb_array_elements(est -> 'players') j
   where (j ->> 'seat')::smallint = p_com;
  if alvo is null then raise exception 'NOT_A_PLAYER'; end if;
  if not coalesce((alvo ->> 'ativo')::boolean, true) then raise exception 'OUT_OF_GAME'; end if;

  if public.dominio_tregua_vale(est, p_seat, p_com) then raise exception 'ALREADY_TRUCED'; end if;

  chave := least(p_seat, p_com)::text || ':' || greatest(p_seat, p_com)::text;

  /* PROPOSTA ABERTA, e não trégua fechada. Trégua que vale sem o outro aceitar
     não é acordo — é uma regra imposta com cara de acordo. */
  est := public.jsonb_poe(est, 'tregProp', chave,
    jsonb_build_object('de', p_seat, 'rodada', coalesce((est ->> 'round')::int, 1)));
  est := public.dominio_log(est, jsonb_build_object(
    'k', 'tregua-propoe', 'seat', p_seat, 'com', p_com));

  update public.matches set public_state = est, version = version + 1 where id = p_match;
  return public.dominio_publico(p_match);
end;
$$;

revoke all on function public.dominio_propor_tregua_como(smallint, uuid, smallint)
  from public, anon, authenticated;

create or replace function public.dominio_responder_tregua_como(
  p_seat smallint, p_match uuid, p_de smallint, p_aceita boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  est   jsonb;
  vivo  text;
  chave text;
  ate   int;
begin
  select m.public_state, m.status into est, vivo
    from public.matches m where m.id = p_match for update;
  if not found then raise exception 'MATCH_NOT_FOUND'; end if;
  if vivo <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;
  if not exists (
    select 1 from public.match_players mp
     where mp.match_id = p_match and mp.seat = p_seat
  ) then raise exception 'NOT_A_PLAYER'; end if;

  chave := least(p_seat, p_de)::text || ':' || greatest(p_seat, p_de)::text;
  if est -> 'tregProp' -> chave is null then raise exception 'NO_PROPOSAL'; end if;
  if (est -> 'tregProp' -> chave ->> 'de')::smallint <> p_de then
    raise exception 'NO_PROPOSAL';   -- não se aceita a própria proposta
  end if;

  est := jsonb_set(est, '{tregProp}', (est -> 'tregProp') - chave);

  if p_aceita then
    /* ATÉ O FIM DA PRÓXIMA RODADA. Guardado como NÚMERO de rodada e não como
       contador: assim a trégua vence sozinha quando o relógio da partida passa
       por cima dela, e nenhuma faxina precisa saber que tréguas existem. */
    ate := coalesce((est ->> 'round')::int, 1) + 1;
    est := public.jsonb_poe(est, 'treguas', chave, to_jsonb(ate));
    est := public.dominio_log(est, jsonb_build_object(
      'k', 'tregua-aceita', 'seat', p_seat, 'com', p_de, 'ate', ate));
  else
    est := public.dominio_log(est, jsonb_build_object(
      'k', 'tregua-recusa', 'seat', p_seat, 'com', p_de));
  end if;

  update public.matches set public_state = est, version = version + 1 where id = p_match;
  return public.dominio_publico(p_match);
end;
$$;

revoke all on function public.dominio_responder_tregua_como(smallint, uuid, smallint, boolean)
  from public, anon, authenticated;
