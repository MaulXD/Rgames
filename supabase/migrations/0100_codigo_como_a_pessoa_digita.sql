-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0100 · o código da sala, do jeito que a pessoa digita
--
-- Critério de aceite da plataforma (PRD 00 §12): "código de sala funciona
-- digitado em minúsculas e com espaços". Metade valia.
--
--     join_room('hqqgj8')     ✅  `upper()` resolvia
--     join_room('HQQ GJ8')    ❌  ROOM_NOT_FOUND
--
-- `btrim` tira espaço das PONTAS. O espaço que aparece de verdade está no MEIO:
-- o código circula por mensagem, e o teclado do celular capitaliza, corrige e
-- separa. Quem digita "hq qg j8" com o polegar não está errando — está usando
-- um celular, que é o alvo declarado deste projeto.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O CLIENTE JÁ FAZIA CERTO, E ERA ESSE O PROBLEMA
--
-- `lib/games.ts` tem `sanitizeCode`, e ela é generosa: tira tudo que não é letra
-- ou dígito, e ainda dobra os glifos que se confundem à mão —
--
--     I e L → 1        O → 0        e então 1 e 0 somem
--
-- porque o alfabeto do código não tem nenhum dos cinco. Alguém que leu "0" onde
-- estava "Q" entra assim mesmo.
--
-- O formulário passa por ela, e a rota `/j/[code]` também. O servidor, não. Duas
-- normalizações que discordam é a forma mais silenciosa de defeito que este
-- projeto conhece: funciona por onde a maioria entra, e falha exatamente para
-- quem chega por um caminho diferente — link colado, código ditado por telefone,
-- alguém chamando a RPC.
--
-- Agora a regra mora numa função só, e o teste confere que servidor e cliente
-- concordam sobre as mesmas entradas embaralhadas.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE NORMALIZAR E NÃO SÓ ACEITAR ESPAÇO
--
-- Aceitar espaço resolveria o critério e deixaria o hífen, o ponto, o traço que
-- o corretor põe, e o espaço não-quebrável que vem de copiar de uma página. A
-- lista do que atrapalha não tem fim; a lista do que VALE tem seis letras.
-- ════════════════════════════════════════════════════════════════════════════

/**
 * O código como o servidor o entende, seja lá como veio digitado.
 *
 * Espelho de `sanitizeCode` em `lib/games.ts`. Se um lado mudar, muda o outro —
 * e `scripts/smoke.mjs` confere que os dois aceitam as mesmas entradas.
 */
create or replace function public.normaliza_codigo(p_bruto text)
returns text
language sql
immutable
as $$
  select regexp_replace(
    translate(upper(coalesce(p_bruto, '')), 'ILO', '110'),
    '[^A-HJ-KM-NP-Z2-9]', '', 'g'
  );
$$;

/* Sem `revoke`: esta é pura, não toca em nada e não sabe de nada. Fechá-la
   seria cerimônia — e cerimônia onde não há risco ensina a ignorar o `revoke`
   onde há. */

comment on function public.normaliza_codigo(text) is
  'Espelho de sanitizeCode em lib/games.ts. Tira o que não é do alfabeto do '
  'código e dobra os glifos que se confundem à mão (I, L → 1; O → 0), que '
  'depois somem junto com os dígitos ambíguos.';

-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.join_room(p_code text)
returns public.rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.rooms;
  free_seat smallint;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into target from public.rooms
   where code = public.normaliza_codigo(p_code) and expires_at > now();

  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  if exists (select 1 from public.room_members m
              where m.room_id = target.id and m.user_id = auth.uid()) then
    update public.room_members set last_seen_at = now()
     where room_id = target.id and user_id = auth.uid();
    return target;
  end if;

  select min(s) into free_seat
    from generate_series(0, 7) as s
   where s not in (
     select seat from public.room_members
      where room_id = target.id and seat is not null
   );

  insert into public.room_members (room_id, user_id, seat, role)
  values (target.id, auth.uid(), free_seat,
          case when free_seat is null then 'spectator' else 'player' end);

  return target;
end;
$$;

revoke all on function public.join_room(text) from public, anon;
grant execute on function public.join_room(text) to authenticated;
