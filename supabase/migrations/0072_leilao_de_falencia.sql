-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0072 · quem quebra vai a leilão, e não ao banco
--
-- O PRD pede isto desde sempre (§5.1): "leilão também acontece quando alguém
-- quebra: as propriedades dele vão a leilão em vez de voltar ao banco". Até
-- agora voltavam ao banco.
--
-- E voltar ao banco é pior do que parece. Num tabuleiro de quarenta casas, uma
-- escritura que volta ao banco só reaparece se alguém CAIR nela — e numa partida
-- de vinte rodadas isso pode não acontecer mais. Uma falência tirava doze
-- propriedades do jogo de uma vez, e a partida ficava mais POBRE justamente no
-- momento em que devia ficar mais tensa.
--
-- Com o leilão, a falência vira o momento que ela deveria ser: doze escrituras
-- entrando no mercado de uma vez é a chance de alguém fechar um grupo de cor, e
-- é também o que drena o caixa de quem sobrou. Quem estava ganhando com folga
-- pode sair da falência do vizinho sem dinheiro nenhum.
--
-- A CONSTRUÇÃO continua voltando ao banco: o que vai a leilão é a escritura
-- limpa, como na regra oficial. E a fila só começa depois da checagem de "sobrou
-- um jogador só" — leiloar para uma pessoa sozinha não é leilão, é doação.
--
-- O mecanismo de leilão sabe cuidar de UMA propriedade. A fila (`leilaoFila`) é
-- o que transforma isso numa sequência: fechou uma, abre a próxima, e a mesa só
-- volta ao turno normal quando a última fechar.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.met_fecha_leilao(p_est jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  est  jsonb := p_est;
  lei  jsonb := p_est -> 'leilao';
  quem smallint;
  vale int;
  fila jsonb;
  proxima text;
begin
  if lei is null or lei = 'null'::jsonb then return est; end if;

  quem := (lei ->> 'altoSeat')::smallint;
  vale := coalesce((lei ->> 'alto')::int, 0);

  if quem is null then
    -- ninguém deu lance: a propriedade continua do banco. Não é fracasso do
    -- leilão — é informação, e ela aparece no registro.
    est := public.met_log(est, jsonb_build_object(
      'k', 'leilao-vazio', 'prop', lei ->> 'prop'));
  else
    est := public.met_paga(est, quem, null, vale, 'leilao:' || (lei ->> 'prop'));

    /* Se quem arrematou foi um Investidor, a escritura vai para o NOME DO
       ADMINISTRADOR e o Investidor fica com uma meia-parte do aluguel. O
       dinheiro saiu do bolso do Investidor; a propriedade entra no jogo pela
       mão de quem joga. */
    if coalesce((est -> 'players' -> quem::text ->> 'investidor')::boolean, false)
       and lei -> 'admin' is not null and lei -> 'admin' <> 'null'::jsonb then
      est := jsonb_set(est, array['props', lei ->> 'prop', 'owner'], lei -> 'admin');
      est := jsonb_set(est, array['props', lei ->> 'prop', 'investidor'], to_jsonb(quem), true);
      est := public.met_log(est, jsonb_build_object(
        'k', 'leilao-investidor', 'seat', quem, 'prop', lei ->> 'prop',
        'valor', vale, 'para', (lei ->> 'admin')::smallint));
    else
      est := jsonb_set(est, array['props', lei ->> 'prop', 'owner'], to_jsonb(quem));
      est := public.met_log(est, jsonb_build_object(
        'k', 'leilao-fecha', 'seat', quem, 'prop', lei ->> 'prop', 'valor', vale));
    end if;
  end if;

  /* A FILA DA FALÊNCIA.

     Quando alguém quebra, as escrituras dele vão a leilão UMA POR VEZ — o
     mecanismo de leilão sabe cuidar de uma só. A fila é o que transforma isso
     numa sequência: fechou uma, abre a próxima, e a mesa só volta ao turno
     normal quando a última fechar.

     É o momento mais tenso da partida e tem de ser: doze escrituras entrando no
     mercado de uma vez é a chance de alguém fechar um grupo de cor, e é também o
     que drena o caixa de quem sobrou. */
  fila := coalesce(est -> 'leilaoFila', '[]'::jsonb);
  if jsonb_array_length(fila) > 0 then
    proxima := fila ->> 0;
    est := jsonb_set(est, '{leilaoFila}', fila - 0);
    est := jsonb_set(est, '{leilao}', jsonb_build_object(
      'prop', proxima, 'alto', 0, 'altoSeat', null,
      'passou', '[]'::jsonb, 'abriuSeat', coalesce((lei ->> 'abriuSeat')::int, 0),
      'admin', null));
    est := jsonb_set(est, '{phase}', '"leilao"');
    est := public.met_log(est, jsonb_build_object(
      'k', 'leilao-falencia', 'prop', proxima,
      'restam', jsonb_array_length(fila) - 1));
    return est;
  end if;

  return public.met_volta_fase(est);
end;
$function$;

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

CREATE OR REPLACE FUNCTION public.met_pass_como(p_seat smallint, p_match uuid)
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
  faltam  int;
begin
  select * into est, semente, meu, mapa from public.met_ator_livre(p_match, p_seat);
  if est ->> 'phase' <> 'leilao' then raise exception 'NO_AUCTION'; end if;

  est := jsonb_set(est, array['leilao', 'passou'], (
    select coalesce(jsonb_agg(distinct d), '[]'::jsonb)
      from jsonb_array_elements(
             coalesce(est -> 'leilao' -> 'passou', '[]'::jsonb) || to_jsonb(meu)) d
  ));

  -- quantos ainda podem dar lance, tirando quem já lidera
  select count(*) into faltam
    from jsonb_each(est -> 'players') e(k, v)
   where not coalesce((v ->> 'quebrado')::boolean, false)
     and not (est -> 'leilao' -> 'passou' @> to_jsonb(k::smallint))
     and coalesce((est -> 'leilao' ->> 'altoSeat')::smallint, -1) <> k::smallint;

  if faltam = 0 then
    est := public.met_fecha_leilao(est);
    /* Se a fila da falência abriu OUTRO leilão, o relógio é o do leilão (20s) e
       não o do turno (90s) — senão a mesa esperaria um minuto e meio entre uma
       escritura e a seguinte. */
    update public.matches set public_state = est, version = version + 1,
           turn_deadline = now() + case when est ->> 'phase' = 'leilao'
             then interval '20 seconds' else interval '90 seconds' end
     where id = p_match;
  else
    update public.matches set public_state = est, version = version + 1
     where id = p_match;
  end if;

  return public.met_publico(p_match);
end;
$function$;

revoke all on function public.met_pass_como(smallint, uuid) from public, anon, authenticated;
