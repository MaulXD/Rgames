-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0074 · a trégua, e o preço de rompê-la
--
-- §6.6 do PRD, e a frase que decide o desenho inteiro:
--
--   "O ponto não é impedir a traição — é DAR PESO a ela. Traição sem custo é
--    ruído; traição com custo é história."
--
-- Por isso o servidor DEIXA romper. Uma trégua que o servidor impusesse não
-- seria diplomacia, seria uma regra de movimento — e ninguém se lembra de uma
-- regra de movimento no dia seguinte. O que se lembra é de quem prometeu e
-- atacou mesmo assim.
--
-- O PREÇO, exatamente como o PRD pede:
--   · dois exércitos a menos no próximo reforço;
--   · a marca de TRAIDOR ao lado do nome pelo resto da partida, visível a todos;
--   · uma linha no registro dizendo o que aconteceu, com nome e território.
--
-- ─────────────────────────────────────────────────────────────────────────
-- QUANTO DURA
--
-- "Até o fim da PRÓXIMA rodada dele", diz o PRD. Guardar isso como um número de
-- rodada — e não como um contador que alguém precisa decrementar — é o que faz a
-- trégua não precisar de faxina nenhuma: ela vence sozinha quando o relógio da
-- partida passa por cima.
--
-- ─────────────────────────────────────────────────────────────────────────
-- A MÁQUINA E A TRÉGUA
--
-- Ela ACEITA trégua quando está perdendo daquele lado e RECUSA quando está
-- ganhando — a conta é a mesma que ela já usa para decidir ataque. E ela NUNCA
-- rompe: uma máquina que trai não é mais difícil, é só imprevisível, e
-- imprevisível sem intenção é ruído. A traição é uma jogada de gente.
-- ═══════════════════════════════════════════════════════════════════════════

/**
 * Existe trégua VÁLIDA agora entre estes dois?
 *
 * A trégua vive em `est.treguas` como `{"a:b": rodadaFinal}`, com a chave sempre
 * na ordem crescente dos assentos — assim `2:5` e `5:2` são a mesma coisa e não
 * há como criar duas tréguas para o mesmo par.
 */
create or replace function public.dominio_tregua_vale(
  p_est jsonb, p_a smallint, p_b smallint
)
returns boolean
language sql
immutable
as $$
  select coalesce(
    (p_est -> 'treguas' ->> (least(p_a, p_b)::text || ':' || greatest(p_a, p_b)::text))::int,
    -1
  ) >= coalesce((p_est ->> 'round')::int, 1);
$$;

revoke all on function public.dominio_tregua_vale(jsonb, smallint, smallint)
  from public, anon, authenticated;

-- ── propor ─────────────────────────────────────────────────────────────────

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
begin
  select * into est, semente, mapa, quem from public.dominio_ator(p_match, p_seat);

  if p_com = p_seat then raise exception 'SELF_TRUCE'; end if;
  if est -> 'players' -> p_com::text is null then raise exception 'NOT_A_PLAYER'; end if;
  if not coalesce((est -> 'players' -> p_com::text ->> 'ativo')::boolean, true) then
    raise exception 'OUT_OF_GAME';
  end if;
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

-- ── responder ──────────────────────────────────────────────────────────────

/**
 * Aceitar ou recusar.
 *
 * Note que quem responde NÃO precisa estar na vez — usa `dominio_ator_livre`,
 * porque uma proposta chega no turno de quem propôs e ficaria pendurada até o
 * turno de quem recebe. Proposta pendurada é proposta que ninguém lembra de
 * responder.
 */
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
    est := jsonb_set(est, array['treguas', chave], to_jsonb(ate), true);
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

-- ── as cascas de autenticação ──────────────────────────────────────────────

create or replace function public.dominio_propor_tregua(p_match uuid, p_com smallint)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare est jsonb; s bigint; meu smallint; mp jsonb;
begin
  select * into est, s, meu, mp from public.dominio_na_vez(p_match);
  return public.dominio_propor_tregua_como(meu, p_match, p_com);
end;
$$;

create or replace function public.dominio_responder_tregua(
  p_match uuid, p_de smallint, p_aceita boolean
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare meu smallint;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select mp.seat into meu from public.match_players mp
   where mp.match_id = p_match and mp.user_id = auth.uid();
  if meu is null then raise exception 'NOT_A_PLAYER'; end if;
  return public.dominio_responder_tregua_como(meu, p_match, p_de, p_aceita);
end;
$$;

revoke all on function public.dominio_propor_tregua(uuid, smallint) from public, anon, authenticated;
grant execute on function public.dominio_propor_tregua(uuid, smallint) to authenticated;
revoke all on function public.dominio_responder_tregua(uuid, smallint, boolean)
  from public, anon, authenticated;
grant execute on function public.dominio_responder_tregua(uuid, smallint, boolean) to authenticated;
