-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0054 · `met_aposta_como` gravava a aposta no estado de quem chamou
--
-- O gerador de 0053 troca a chamada do resolvedor e nada mais — e isso era
-- suficiente para dezesseis das dezessete funções. `met_aposta` era a exceção:
-- ela mexe no ESTADO PRIVADO do apostador, e o corpo dela dizia
--
--     update public.match_private_state
--        set data = jsonb_set(data, '{aposta}', to_jsonb(p_em))
--      where match_id = p_match and user_id = auth.uid();
--
-- Depois de virar `_como(p_seat, ...)` a função passou a receber o assento por
-- parâmetro e a continuar gravando em `auth.uid()`. O efeito: a aposta secreta
-- da máquina cairia no estado privado da PESSOA que tocou o passo dela. A pessoa
-- passaria a ter uma aposta que não fez, e a máquina, nenhuma.
--
-- A LIÇÃO É SOBRE O GERADOR, não sobre esta função. Um gerador que faz uma
-- troca mecânica está certo enquanto a premissa dele vale — aqui a premissa era
-- "nenhuma dessas funções olha `auth.uid()` no corpo", e eu a verifiquei com
-- uma consulta cuja saída veio truncada. Confiar em saída truncada é o mesmo
-- erro de confiar em `revoke from public`: parece que cobre e não cobre.
--
-- Então a conferência virou INVARIANTE, em scripts/smoke.mjs: nenhuma função
-- `_como` pode conter `auth.uid()`. É o contrato inteiro dessas funções numa
-- linha — o ator é parâmetro, nunca ambiente — e agora quebra o teste em vez de
-- quebrar o jogo.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.met_aposta_como(p_seat smallint, p_match uuid, p_em smallint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  est     jsonb;
  semente bigint;
  meu     smallint;
  mapa    jsonb;
  quem    uuid;
begin
  select * into est, semente, meu, mapa from public.met_ator_livre(p_match, p_seat);

  if not coalesce((est -> 'players' -> meu::text ->> 'investidor')::boolean, false) then
    raise exception 'NOT_AN_INVESTOR';
  end if;
  if est -> 'players' -> p_em::text is null then raise exception 'NOT_A_PLAYER'; end if;
  if p_em = meu then raise exception 'SELF_BET'; end if;
  if coalesce((est -> 'players' -> p_em::text ->> 'quebrado')::boolean, false) then
    raise exception 'BANKRUPT';   -- não se aposta em quem já está fora
  end if;

  -- o dono do ASSENTO, e não quem chamou: é a única diferença desta função
  -- para a de 0053, e era a que fazia a aposta cair na pessoa errada
  select mp.user_id into quem
    from public.match_players mp
   where mp.match_id = p_match and mp.seat = meu;
  if quem is null then raise exception 'NOT_A_PLAYER'; end if;

  update public.match_private_state
     set data = jsonb_set(data, '{aposta}', to_jsonb(p_em))
   where match_id = p_match and user_id = quem;

  return public.met_publico(p_match);
end;
$$;

revoke all on function public.met_aposta_como(smallint, uuid, smallint)
  from public, anon, authenticated;
