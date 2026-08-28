-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0097 · o portão do troféu mora na função, não em quem chama
--
-- 0096 pôs o filtro dentro da consulta de `letreiro_premia`. O teste chamou
-- `palavra_rara` direto com CARALHO e posto 999.998, e ela gravou.
--
-- É EXATAMENTE O DEFEITO QUE ESTE PROJETO JÁ CATALOGOU. Quando as máquinas
-- começaram a ganhar XP, o conserto tentado foi nas quatro funções de prêmio, e
-- a frase que ficou no documento é:
--
--     "corrigir nos quatro chamadores é escolher esquecer no quinto"
--
-- O portão foi para dentro de `dar_xp` e `melhor_palavra`, e ficou certo. Aqui
-- eu escrevi um comentário em 0095 explicando por que separar era melhor —
-- "a decisão 'isto é apresentável' é diferente da decisão 'isto é mais raro'" —
-- e o comentário estava certo sobre as decisões serem diferentes e errado sobre
-- onde a guarda mora. Separar as decisões é o motivo de `palavra_apresentavel`
-- existir como função própria. Não é motivo para ela ser opcional.
--
-- `palavra_rara` tem UM chamador hoje. O segundo vai existir, e não vai lembrar.
--
-- ────────────────────────────────────────────────────────────────────────────
-- E O FILTRO CONTINUA NA CONSULTA TAMBÉM, fazendo outra coisa
--
-- Não é redundância. Os dois fazem trabalhos diferentes, e os dois são precisos:
--
--   na consulta   ESCOLHE o melhor candidato permitido. Sem ele, a consulta
--                 devolve a palavra mais rara em absoluto; se ela for barrada,
--                 a pessoa fica sem troféu naquela partida — mesmo tendo achado
--                 uma segunda palavra rara perfeitamente apresentável.
--
--   na função     GARANTE que nada barrado seja gravado, venha de onde vier.
--
-- Um escolhe, o outro garante. Tirar o primeiro faz a pessoa perder o troféu
-- que merecia; tirar o segundo faz o próximo chamador gravar o que não devia.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.palavra_rara(p_user uuid, p_word text, p_posto int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- máquina não coleciona: "a palavra mais rara que você já achou" é uma frase
  -- sobre uma pessoa
  if exists (select 1 from public.profiles p where p.id = p_user and p.is_bot) then
    return;
  end if;

  /* E o troféu tem de ser apresentável, DAQUI, e não da fé de quem chamou. */
  if not public.palavra_apresentavel(p_word) then
    return;
  end if;

  update public.profiles
     set stats = stats || jsonb_build_object(
           'rara', jsonb_build_object('w', p_word, 'posto', p_posto)
         ),
         updated_at = now()
   where id = p_user
     -- posto MAIOR é mais raro. O `-1` faz a primeira vez sempre gravar.
     and coalesce((stats -> 'rara' ->> 'posto')::int, -1) < p_posto;
end;
$$;

revoke all on function public.palavra_rara(uuid, text, int) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

/* E o estrago já gravado sai. Uma linha, e ela importa: o troféu é permanente
   por desenho — só um posto maior o substitui —, então uma palavra barrada que
   entrou antes deste conserto ficaria no perfil de alguém para sempre. */
update public.profiles p
   set stats = stats - 'rara',
       updated_at = now()
 where stats -> 'rara' ->> 'w' is not null
   and not public.palavra_apresentavel(stats -> 'rara' ->> 'w');
