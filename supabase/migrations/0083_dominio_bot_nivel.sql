-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0083 · `dominio_bot_nivel`, que eu chamei antes de escrever
--
--     function public.dominio_bot_nivel(uuid, smallint) does not exist
--
-- 0081 usa essa função para descobrir o nível da máquina a quem a trégua foi
-- proposta. Ela existe na Metrópole (`met_bot_nivel`, desde 0055) e não no
-- Domínio, onde o nível era lido inline dentro do próprio `dominio_bot_passo`.
--
-- Escrevi a chamada pelo nome que a outra tinha, sem conferir. É o mesmo erro de
-- categoria da trégua com `players` como objeto (0076): dois jogos com formas
-- parecidas o bastante para o dedo ir sozinho.
--
-- A função existir é melhor que o inline de qualquer forma: o nível de uma
-- máquina passa a ser pergunta com nome, e a resposta é a mesma nos dois jogos.
-- ═══════════════════════════════════════════════════════════════════════════

/**
 * O nível de uma máquina naquela sala, ou nulo se o assento não é máquina.
 *
 * Devolver NULO para gente é o contrato, e quem chama depende disso: é assim que
 * `dominio_bot_passo` sabe que aquela proposta de trégua é para uma pessoa
 * responder, e não para ela.
 */
create or replace function public.dominio_bot_nivel(p_match uuid, p_seat smallint)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(rm.bot_nivel, 'medio')
    from public.matches m
    join public.match_players mp on mp.match_id = m.id and mp.seat = p_seat
    join public.profiles p on p.id = mp.user_id and p.is_bot
    left join public.room_members rm on rm.room_id = m.room_id and rm.user_id = mp.user_id
   where m.id = p_match;
$$;

revoke all on function public.dominio_bot_nivel(uuid, smallint)
  from public, anon, authenticated;
