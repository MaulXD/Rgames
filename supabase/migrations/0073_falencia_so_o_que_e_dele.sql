-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0073 · a falência leva só o que é de quem quebrou
--
--     if (est -> 'props' -> (c ->> 'id') ->> 'owner')::smallint <> meu
--       then continue; end if;
--
-- Propriedade sem dono tem `owner` nulo. `null::smallint <> 0` não é FALSO: é
-- NULO — e `if NULL then continue` não desvia. O laço tratava toda propriedade
-- SEM DONO como se fosse de quem quebrou.
--
-- Antes de 0072 isso era inofensivo, e por isso ninguém viu: ele reescrevia
-- `owner = null` por cima de `owner = null` e somava zero casa ao banco. Um
-- defeito que não fazia nada.
--
-- Depois de 0072, o MESMO laço monta a fila do leilão. E a fila saiu assim:
--
--     ok    as escrituras vão a LEILÃO e não ao banco
--     FALHA e as outras 2 ficam na fila (ver-o-peso, congonhas, pelourinho,
--           olinda, iracema, ponta-negra, energia, boa-viagem, santos,
--           liberdade, moinhos, beira-mar, luz, barra, asa-sul, saneamento,
--           meireles, ipanema, vila-nova, rio-niteroi, leblon, jardins)
--
-- Vinte e duas escrituras a leilão por causa de uma falência de três. O
-- tabuleiro inteiro indo a leilão de uma vez — o que, ironicamente, teria
-- parecido "uma falência dramática" para quem estivesse jogando.
--
-- É a TERCEIRA vez que a mesma regra aparece aqui: em jsonb a ausência é NULL, e
-- comparação com NULL é NULL. `met_patrimonio` caiu nela em 0029 (contava toda
-- propriedade sem dono no patrimônio de todo mundo), `dossie_sweep` caiu em 0033
-- (mandava toda partida fora de refutação para o ramo errado).
--
-- E as três vezes o defeito ficou INVISÍVEL até uma mudança adjacente acordá-lo.
-- É o que essa família de bug faz: espera.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.met_bankrupt_como(p_seat smallint, p_match uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  fila    jsonb := '[]'::jsonb;
begin
  select * into est, semente, meu, mapa from public.met_ator(p_match, p_seat);

  if (est -> 'players' -> meu::text ->> 'cash')::int >= 0 then
    raise exception 'NOT_BROKE';   -- não se declara falência por vontade
  end if;

  modo := est ->> 'mode';
  liquido := greatest(public.met_patrimonio(mapa, est, meu), 0);

  -- devolve tudo ao banco, com as construções
  for c in select value from jsonb_array_elements(mapa -> 'casas') loop
    if c ->> 'id' is null then continue; end if;
    /* COALESCE, E NÃO `<> meu` SOZINHO.

       Propriedade sem dono tem `owner` nulo. `null::smallint <> 0` não é FALSO:
       é NULO — e `if NULL then continue` não desvia. Ou seja, o laço tratava
       TODA propriedade sem dono como se fosse de quem quebrou.

       Antes de 0072 isso era inofensivo: ele reescrevia `owner = null` por cima
       de `owner = null` e somava zero casa ao banco. Um defeito que não fazia
       nada. Depois de 0072, o mesmo laço monta a fila do leilão — e a fila saiu
       com 22 escrituras em vez de 3, leiloando o tabuleiro inteiro por causa de
       uma falência de três propriedades.

       É a terceira vez que a mesma regra aparece neste projeto: em jsonb a
       ausência é NULL, e comparação com NULL é NULL. `met_patrimonio` caiu nela
       em 0029, `dossie_sweep` caiu em 0033. */
    if coalesce((est -> 'props' -> (c ->> 'id') ->> 'owner')::smallint, -1) <> meu then
      continue;
    end if;

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
    /* A ESCRITURA NÃO SOME NO BANCO: entra na fila do leilão.

       Antes daqui ela voltava ao banco e ficava lá até alguém CAIR nela de novo
       — o que, num tabuleiro de quarenta casas e vinte rodadas, pode não
       acontecer mais. Uma falência tirava doze propriedades do jogo de uma vez,
       e a partida ficava mais pobre exatamente no momento em que devia ficar
       mais tensa.

       A CONSTRUÇÃO continua voltando ao banco (logo acima): o que vai a leilão é
       a escritura limpa, como manda a regra oficial. */
    fila := fila || to_jsonb(array[c ->> 'id']);
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
    est := public.met_termina(p_match, est, ativos[1]);
    return public.met_publico(p_match);
  end if;

  /* E O LEILÃO COMEÇA, se sobrou escritura e sobrou com quem leiloar.

     A ordem importa: isto vem DEPOIS da checagem de "sobrou um jogador só",
     porque leiloar para uma pessoa sozinha não é leilão, é doação — e a partida
     já acabou de qualquer forma. */
  if jsonb_array_length(fila) > 0 then
    est := jsonb_set(est, '{leilaoFila}', fila - 0);
    est := jsonb_set(est, '{leilao}', jsonb_build_object(
      'prop', fila ->> 0, 'alto', 0, 'altoSeat', null,
      'passou', '[]'::jsonb, 'abriuSeat', meu, 'admin', null));
    est := jsonb_set(est, '{phase}', '"leilao"');
    est := public.met_log(est, jsonb_build_object(
      'k', 'leilao-falencia', 'prop', fila ->> 0,
      'restam', jsonb_array_length(fila) - 1));
  else
    -- o turno de quem quebrou acaba na hora
    est := jsonb_set(est, '{phase}', '"acao"');
  end if;
  update public.matches set public_state = est, version = version + 1,
         turn_deadline = now() + interval '20 seconds'
   where id = p_match;
  return public.met_publico(p_match);
end;
$function$;

revoke all on function public.met_bankrupt_como(smallint, uuid) from public, anon, authenticated;
