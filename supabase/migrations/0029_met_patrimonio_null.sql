-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0029 · o patrimônio contava o que não era de ninguém
--
-- O BUG
--
-- `met_patrimonio` pulava as propriedades alheias assim:
--
--     if pe is null or (pe ->> 'owner')::smallint <> p_seat then continue;
--
-- Propriedade sem dono tem `owner` nulo. E `NULL <> 0` não é falso: é NULL. Um
-- IF com condição NULL não entra no ramo, então o `continue` não acontecia — e
-- a propriedade sem dono entrava no patrimônio. De TODOS os jogadores, ao
-- mesmo tempo.
--
-- O QUE ISSO ESTRAGAVA
--
-- Patrimônio é a conta que decide a vitória no modo Metrópole (maior
-- patrimônio depois de vinte rodadas) e o que define quanto o falido leva como
-- Investidor. Com o bug, no começo da partida — quando 19 das 28 propriedades
-- não têm dono — todo mundo tinha uns R$ 60.000 fantasma no bolso, iguais para
-- todos. O placar ficava quase empatado, comprimido, e comprar propriedade
-- praticamente não mexia na porcentagem.
--
-- Não daria erro nenhum. Daria um jogo em que jogar bem não aparece no placar,
-- que é o pior tipo de defeito: invisível e desmotivante.
--
-- A LIÇÃO, que vale para todo o projeto: em jsonb, ausência é NULL, e
-- comparação com NULL é NULL. Toda comparação de dono passa por `coalesce`.
-- `met_grupo_completo` já fazia; `met_aluguel` já testava o nulo antes; esta
-- era a única que confiava no operador.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.met_patrimonio(
  p_mapa jsonb, p_est jsonb, p_seat smallint
)
returns int
language plpgsql
immutable
as $$
declare
  total int := 0;
  c     jsonb;
  pe    jsonb;
begin
  total := coalesce((p_est -> 'players' -> p_seat::text ->> 'cash')::int, 0);

  for c in select value from jsonb_array_elements(p_mapa -> 'casas') loop
    if c ->> 'id' is null then continue; end if;
    pe := p_est -> 'props' -> (c ->> 'id');
    -- o coalesce é o conserto: sem ele, `owner` nulo dava NULL na comparação,
    -- o `continue` não rodava, e a propriedade de ninguém entrava na conta
    if pe is null or coalesce((pe ->> 'owner')::smallint, -1) <> p_seat then
      continue;
    end if;

    if coalesce((pe ->> 'hipotecada')::boolean, false) then
      total := total + (c ->> 'preco')::int / 2;
    else
      total := total + (c ->> 'preco')::int;
    end if;

    if c ->> 't' = 'bairro' then
      if coalesce((pe ->> 'hotel')::boolean, false) then
        total := total + (c ->> 'casa')::int * 5;
      else
        total := total + (c ->> 'casa')::int * coalesce((pe ->> 'casas')::int, 0);
      end if;
    end if;
  end loop;

  return total;
end;
$$;

revoke all on function public.met_patrimonio(jsonb, jsonb, smallint) from public, anon, authenticated;
