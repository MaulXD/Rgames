-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0032 · conserto de alias em met_bankrupt
--
-- O QUE ACONTECEU
--
-- A 0031 introduziu, dentro de `met_bankrupt`, uma subconsulta que filtra os
-- contratos:
--
--     select coalesce(jsonb_agg(c), '[]'::jsonb)
--       from jsonb_array_elements(est -> 'contratos') c
--      where c ->> 'tipo' = 'parcela' ...
--
-- e `met_bankrupt` já declara uma variável `c jsonb` no seu próprio escopo.
-- O Postgres então não sabe se `c ->> 'tipo'` fala do alias da subconsulta ou
-- da variável do PL/pgSQL, e recusa a chamada inteira com 42702 — "it could
-- refer to either a PL/pgSQL variable or a table column".
--
-- É a mesma regra que matou `dominio_start` uma vez, ao contrário: lá era uma
-- VARIÁVEL com nome de coluna; aqui é um ALIAS com nome de variável. A regra
-- completa, que passa a valer para o projeto: dentro de PL/pgSQL, nome de
-- variável e nome de alias vivem no mesmo espaço, e nenhum dos dois pode
-- repetir o outro.
--
-- Por que uma migração nova em vez de corrigir a 0031: a 0031 já rodou neste
-- banco, e o registrador de migrações marca por nome. O arquivo da 0031 foi
-- corrigido para que um banco novo já nasça certo; esta 0032 existe para que o
-- banco que rodou a versão quebrada também fique certo. As duas aplicam a
-- mesma definição, e `create or replace` é idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.met_bankrupt(p_match uuid)
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
  liquido int;
  modo    text;
  sobra   int;
  c       jsonb;
  ativos  smallint[];
  qual    uuid;
begin
  select * into est, semente, meu, mapa from public.met_na_vez(p_match);

  if (est -> 'players' -> meu::text ->> 'cash')::int >= 0 then
    raise exception 'NOT_BROKE';   -- não se declara falência por vontade
  end if;

  modo := est ->> 'mode';
  liquido := greatest(public.met_patrimonio(mapa, est, meu), 0);

  -- devolve tudo ao banco, com as construções
  for c in select value from jsonb_array_elements(mapa -> 'casas') loop
    if c ->> 'id' is null then continue; end if;
    if (est -> 'props' -> (c ->> 'id') ->> 'owner')::smallint <> meu then continue; end if;

    if coalesce((est -> 'props' -> (c ->> 'id') ->> 'hotel')::boolean, false) then
      est := jsonb_set(est, array['bank', 'hoteis'],
        to_jsonb((est -> 'bank' ->> 'hoteis')::int + 1));
    else
      est := jsonb_set(est, array['bank', 'casas'],
        to_jsonb((est -> 'bank' ->> 'casas')::int
                 + coalesce((est -> 'props' -> (c ->> 'id') ->> 'casas')::int, 0)));
    end if;

    est := jsonb_set(est, array['props', c ->> 'id'], jsonb_build_object(
      'owner', null, 'casas', 0, 'hotel', false, 'hipotecada', false));
  end loop;

  sobra := case when modo = 'classico' then 0 else (liquido / 10) end;
  est := jsonb_set(est, array['players', meu::text, 'cash'], to_jsonb(greatest(sobra, 0)));
  est := jsonb_set(est, array['players', meu::text, 'quebrado'], 'true'::jsonb);
  est := jsonb_set(est, array['players', meu::text, 'investidor'],
    case when modo = 'classico' then 'false'::jsonb else 'true'::jsonb end);
  est := jsonb_set(est, '{pendente}', 'null'::jsonb);

  /* OS CONTRATOS NA FALÊNCIA — o critério de aceite pede isto explicitamente.
     Contrato sobrevive à falência do CREDOR: quem quebrou vira Investidor e
     continua recebendo, porque a dívida é de quem deve e o azar do credor não
     perdoa ninguém. Já o que quem quebrou DEVIA morre: não se cobra parcela
     de quem não tem nada, e insistir só criaria um devedor eterno travando o
     turno dele para sempre.
     As isenções que ele concedia também caem — ele não tem mais propriedade
     nenhuma para deixar de cobrar — e as opções sobre as propriedades dele
     também, porque as propriedades voltaram ao banco. */
  -- o alias é `ct` e não `c` de propósito: `met_bankrupt` declara uma
  -- variável `c jsonb`, e um alias de mesmo nome deixa o Postgres sem saber a
  -- qual dos dois `c ->> 'tipo'` se refere — erro 42702. É a mesma regra que
  -- matou `dominio_start` uma vez, agora ao contrário: lá era a variável com
  -- nome de coluna, aqui é o alias com nome de variável.
  est := jsonb_set(est, '{contratos}', (
    select coalesce(jsonb_agg(ct), '[]'::jsonb)
      from jsonb_array_elements(coalesce(est -> 'contratos', '[]'::jsonb)) ct
     where not (
       (ct ->> 'tipo' = 'parcela' and (ct ->> 'de')::smallint = meu)
       or (ct ->> 'tipo' = 'isencao' and (ct ->> 'de')::smallint = meu)
       or (ct ->> 'tipo' = 'opcao' and (ct ->> 'de')::smallint = meu)
     )
  ));
  -- e as propostas abertas de ou para ele saem da mesa
  est := jsonb_set(est, '{ofertas}', (
    select coalesce(jsonb_agg(oft), '[]'::jsonb)
      from jsonb_array_elements(coalesce(est -> 'ofertas', '[]'::jsonb)) oft
     where (oft ->> 'de')::smallint <> meu and (oft ->> 'para')::smallint <> meu
  ));

  est := public.met_confere_divida(est, meu);
  est := public.met_log(est, jsonb_build_object(
    'k', case when modo = 'classico' then 'eliminado' else 'investidor' end,
    'seat', meu, 'valor', sobra));

  select array_agg(k::smallint order by k::smallint) into ativos
    from jsonb_each(est -> 'players') e(k, v)
   where not coalesce((v ->> 'quebrado')::boolean, false);

  if coalesce(array_length(ativos, 1), 0) <= 1 then
    est := jsonb_set(est, '{phase}', '"fim"');
    est := jsonb_set(est, '{vencedor}', to_jsonb(ativos[1]));
    update public.matches set status = 'finished', ended_at = now(),
           public_state = est, version = version + 1, turn_deadline = null
     where id = p_match returning room_id into qual;
    update public.rooms set status = 'lobby' where id = qual;
    perform public.met_premia(p_match, ativos[1]);
    return public.met_publico(p_match);
  end if;

  -- o turno de quem quebrou acaba na hora
  est := jsonb_set(est, '{phase}', '"acao"');
  update public.matches set public_state = est, version = version + 1,
         turn_deadline = now() + interval '20 seconds'
   where id = p_match;
  return public.met_publico(p_match);
end;
$$;

revoke all on function public.met_bankrupt(uuid) from public, anon, authenticated;
grant execute on function public.met_bankrupt(uuid) to authenticated;
