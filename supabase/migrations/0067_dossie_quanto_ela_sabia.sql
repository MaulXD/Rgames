-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0067 · no fim, quanto cada máquina já sabia
--
-- O Dossiê termina com "Era Marisa, com o veneno, no Salão". A frase fecha o
-- caso, mas não responde à única pergunta que sobra na cabeça de quem perdeu:
-- eu estava perto?
--
-- Jogando com gente, essa resposta vem sozinha — a mesa comenta, alguém diz "eu
-- já sabia da corda desde a rodada quatro", e a conversa é metade da graça.
-- Jogando sozinho não vem ninguém, e o caso fecha em silêncio.
--
-- Então a máquina conta. Depois que a partida acabou, o que ela tinha riscado
-- deixa de ser segredo, e o número é um espelho: "Creuza tinha riscado 16 das
-- 18; você riscou 11" diz, em uma linha, se faltou pouco ou muito.
--
-- O QUE É EXPOSTO E O QUE NÃO É. Só a CONTAGEM, e só de máquina, e só com a
-- partida encerrada. A lista de cartas dela não sai daqui — não porque faça
-- diferença agora, mas porque a regra "o estado privado de um jogador é dele"
-- não pode ter exceções por conveniência: a primeira exceção é a que ensina a
-- fazer a segunda.
--
-- E gente não entra nesta conta nem depois do fim. O bloco de anotações de uma
-- pessoa é dela, e mostrar quanto o vizinho tinha deduzido seria mostrar como
-- ele joga — que é uma coisa que se conta, não que se publica.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.dossie_deducoes(p_match uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  vivo  text;
  saida jsonb := '[]'::jsonb;
  linha record;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select m.status into vivo from public.matches m where m.id = p_match;
  if not found then raise exception 'MATCH_NOT_FOUND'; end if;

  -- SÓ COM A PARTIDA ENCERRADA. Antes disso, quanto uma máquina já deduziu é
  -- informação de jogo, e informação de jogo não vaza por um endpoint de
  -- estatística.
  if vivo <> 'finished' then raise exception 'MATCH_NOT_FINISHED'; end if;

  if not exists (
    select 1 from public.match_players mp
     where mp.match_id = p_match and mp.user_id = auth.uid()
  ) then
    raise exception 'NOT_A_PLAYER';
  end if;

  for linha in
    select mp.seat,
           p.display_name,
           coalesce(jsonb_array_length(mps.data -> 'dedu' -> 'fora'), 0) riscadas
      from public.match_players mp
      join public.profiles p on p.id = mp.user_id and p.is_bot
      left join public.match_private_state mps
        on mps.match_id = p_match and mps.user_id = mp.user_id
     where mp.match_id = p_match
     order by mp.seat
  loop
    saida := saida || jsonb_build_array(jsonb_build_object(
      'seat', linha.seat, 'nome', linha.display_name, 'riscadas', linha.riscadas));
  end loop;

  return jsonb_build_object(
    'maquinas', saida,
    -- quantas cartas existem fora do envelope, para o número ter escala
    'total', (
      select count(*)::int
        from public.match_players mp2
        join public.match_private_state mps2
          on mps2.match_id = p_match and mps2.user_id = mp2.user_id,
             lateral jsonb_array_elements_text(coalesce(mps2.data -> 'hand', '[]'::jsonb))
       where mp2.match_id = p_match
    )
  );
end;
$$;

revoke all on function public.dossie_deducoes(uuid) from public, anon, authenticated;
grant execute on function public.dossie_deducoes(uuid) to authenticated;
