-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0047 · o ator do Domínio deixa de ser ambiente
--
-- Uma máquina precisa jogar as MESMAS regras que uma pessoa. E as seis ações do
-- turno do Domínio começam todas assim:
--
--     select * into est, semente, meu, mapa from public.dominio_na_vez(p_match);
--
-- — e `dominio_na_vez` resolve o assento por `auth.uid()`. Uma máquina não faz
-- login, então não há `auth.uid()` nenhum: ela não consegue chamar nada disso.
--
-- HAVIA DOIS CAMINHOS, e o segundo era uma armadilha:
--
--   1. Escrever um turno de máquina que mexe no estado por conta própria. Isso
--      duplica a matemática do combate, o bônus da carta de território, a
--      herança da mão de quem foi eliminado e a virada de rodada da Campanha —
--      e no dia em que uma regra mudar, muda em um lugar só e a máquina passa a
--      jogar outro jogo. Divergiria em silêncio, que é o pior jeito de divergir.
--
--   2. Deixar `auth.uid()` ser sobrescrito por `set_config` dentro da
--      transação. Elegante, curto — e um buraco de privilégio da mesma família
--      dos dois que este projeto já abriu: identidade que vem do ambiente é
--      identidade que alguém pode trocar.
--
-- O caminho escolhido é o chato: O ATOR VIRA PARÂMETRO. Cada ação ganha um
-- irmão `_como(p_seat, ...)` que contém as regras, e a função pública de mesmo
-- nome fica sendo uma casca de três linhas: resolve quem é por `auth.uid()`, e
-- delega. Uma implementação das regras, dois chamadores. É a mesma disciplina
-- de "o servidor é a fonte da verdade" aplicada à identidade: explícita, nunca
-- implicada.
--
-- ESTE ARQUIVO FOI GERADO a partir de `pg_get_functiondef` das definições VIVAS
-- — não dos arquivos de migração. As seis funções foram redefinidas ao longo de
-- 0023, 0024, 0039 e 0040, e a viva de cada uma está num arquivo diferente;
-- copiar do arquivo errado já custou um "cannot change return type" antes.
-- O gerador está em scripts/gera-dominio-ator.mjs, e a transformação é mecânica:
-- o nome ganha `_como`, a assinatura ganha `p_seat`, a linha do `dominio_na_vez`
-- vira `dominio_ator`, e `auth.uid()` vira `quem`. Nada mais muda.
-- ════════════════════════════════════════════════════════════════════════════

-- ── o ator, sem ambiente nenhum ──────────────────────────────────

/**
 * O que `dominio_na_vez` fazia, mas com o assento DITO em vez de descoberto.
 * Devolve também o dono daquele assento, porque as regras precisam dele para
 * mexer na mão de cartas — e essa é a única coisa que `auth.uid()` dava e que
 * um parâmetro tem de dar também.
 */
create or replace function public.dominio_ator(
  p_match uuid, p_seat smallint,
  out r_estado jsonb, out r_seed bigint, out r_mapa jsonb, out r_user uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  faltou jsonb;
  vivo   text;
begin
  select m.public_state, m.seed, m.status
    into r_estado, r_seed, vivo
    from public.matches m where m.id = p_match for update;
  if not found then raise exception 'MATCH_NOT_FOUND'; end if;
  if vivo <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;

  select mp.user_id into r_user
    from public.match_players mp
   where mp.match_id = p_match and mp.seat = p_seat;
  if r_user is null then raise exception 'NOT_A_PLAYER'; end if;

  if (r_estado ->> 'turnSeat')::smallint <> p_seat then
    raise exception 'NOT_YOUR_TURN';
  end if;

  faltou := jsonb_build_object(
    'abates',      coalesce(r_estado -> 'abates', '{}'::jsonb),
    'cartasDadas', coalesce(r_estado -> 'cartasDadas', '0'::jsonb),
    'avanco',      coalesce(r_estado -> 'avanco', 'null'::jsonb)
  );
  if not (r_estado @> faltou) then
    r_estado := faltou || r_estado;
    update public.matches m set public_state = r_estado where m.id = p_match;
  end if;

  select data into r_mapa from public.game_themes gt
   where gt.id = (r_estado ->> 'map');
end;
$$;

revoke all on function public.dominio_ator(uuid, smallint) from public, anon, authenticated;

/**
 * E `dominio_na_vez` passa a ser a casca de autenticação do `dominio_ator`.
 *
 * A ORDEM DAS CONFERÊNCIAS É A MESMA DE ANTES, de propósito: partida existe,
 * partida rodando, sou jogador, é minha vez. Trocar a ordem trocaria a mensagem
 * de erro que o cliente recebe, e há teste em cima de cada uma delas.
 */
create or replace function public.dominio_na_vez(
  p_match uuid,
  out r_estado jsonb, out r_seed bigint, out r_seat smallint, out r_mapa jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  vivo text;
  lixo uuid;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select m.status into vivo from public.matches m where m.id = p_match;
  if not found then raise exception 'MATCH_NOT_FOUND'; end if;
  if vivo <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;

  select mp.seat into r_seat
    from public.match_players mp
   where mp.match_id = p_match and mp.user_id = auth.uid();
  if r_seat is null then raise exception 'NOT_A_PLAYER'; end if;

  select * into r_estado, r_seed, r_mapa, lixo
    from public.dominio_ator(p_match, r_seat);
end;
$$;

revoke all on function public.dominio_na_vez(uuid) from public, anon, authenticated;

-- ── as seis ações, com o ator dito ────────────────────────────────

-- dominio_reforcar_como — 1 uso(s) de auth.uid() viraram `quem`
CREATE OR REPLACE FUNCTION public.dominio_reforcar_como(p_seat smallint, p_match uuid, p_ter text, p_qtd integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  quem uuid;
  semente bigint;
  meu     smallint;
  mapa    jsonb;
  est     jsonb;
  resta   int;
  quantas int;
begin
  select * into est, semente, mapa, quem from public.dominio_ator(p_match, p_seat);
  meu := p_seat;

  if est ->> 'phase' <> 'reforco' then raise exception 'WRONG_PHASE'; end if;
  if p_qtd < 1 then raise exception 'BAD_AMOUNT'; end if;
  if coalesce((est -> 'donos' ->> p_ter)::smallint, -1) <> meu then
    raise exception 'NOT_YOURS';
  end if;

  -- quem tem cinco cartas ou mais é obrigado a trocar antes de qualquer coisa.
  -- Sem essa regra, dá para acumular carta a partida inteira e nunca pagar o
  -- preço de guardar.
  select jsonb_array_length(coalesce(mps.data -> 'cartas', '[]'::jsonb)) into quantas
    from public.match_private_state mps
   where mps.match_id = p_match and mps.user_id = quem;
  if coalesce(quantas, 0) >= 5 then raise exception 'MUST_TRADE'; end if;

  resta := (est ->> 'reforcoLeft')::int;
  if p_qtd > resta then raise exception 'NOT_ENOUGH_REINFORCEMENTS'; end if;

  est := jsonb_set(est, array['exercitos', p_ter],
    to_jsonb((est -> 'exercitos' ->> p_ter)::int + p_qtd));
  est := jsonb_set(est, '{reforcoLeft}', to_jsonb(resta - p_qtd));
  est := public.dominio_log(est, jsonb_build_object(
    'k', 'reforco', 'seat', meu, 'ter', p_ter, 'n', p_qtd));

  -- acabou o reforço: a fase vira ataque sozinha, sem mais um clique
  if resta - p_qtd = 0 then
    est := jsonb_set(est, '{phase}', '"ataque"');
  end if;

  update public.matches
     set public_state = est, version = version + 1,
         turn_deadline = now() + interval '120 seconds'
   where id = p_match;

  return public.dominio_publico(p_match);
end;
$function$
;

-- dominio_trocar_como — 2 uso(s) de auth.uid() viraram `quem`
CREATE OR REPLACE FUNCTION public.dominio_trocar_como(p_seat smallint, p_match uuid, p_cartas integer[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  quem uuid;
  semente bigint;
  meu     smallint;
  mapa    jsonb;
  est     jsonb;
  minhas  jsonb;
  tres    jsonb := '[]'::jsonb;
  restam  jsonb := '[]'::jsonb;
  i       int;
  simb    text[] := '{}';
  coringa int := 0;
  vale    int;
  n_troca int;
  bonus   int := 0;
  c       jsonb;
begin
  select * into est, semente, mapa, quem from public.dominio_ator(p_match, p_seat);
  meu := p_seat;

  if est ->> 'phase' <> 'reforco' then raise exception 'WRONG_PHASE'; end if;
  if array_length(p_cartas, 1) <> 3 then raise exception 'NEED_THREE_CARDS'; end if;
  if p_cartas[1] = p_cartas[2] or p_cartas[2] = p_cartas[3] or p_cartas[1] = p_cartas[3] then
    raise exception 'REPEATED_INDEX';
  end if;

  select coalesce(mps.data -> 'cartas', '[]'::jsonb) into minhas
    from public.match_private_state mps
   where mps.match_id = p_match and mps.user_id = quem;

  for i in 0..(jsonb_array_length(minhas) - 1) loop
    if i = any(p_cartas) then
      tres := tres || jsonb_build_array(minhas -> i);
    else
      restam := restam || jsonb_build_array(minhas -> i);
    end if;
  end loop;
  if jsonb_array_length(tres) <> 3 then raise exception 'CARD_NOT_HELD'; end if;

  for c in select value from jsonb_array_elements(tres) loop
    if c ->> 'simbolo' = 'coringa' then
      coringa := coringa + 1;
    else
      simb := simb || (c ->> 'simbolo');
    end if;
  end loop;

  -- três iguais, três diferentes, ou dois quaisquer com um coringa
  if coringa = 0 then
    if not (
      (simb[1] = simb[2] and simb[2] = simb[3])
      or (simb[1] <> simb[2] and simb[2] <> simb[3] and simb[1] <> simb[3])
    ) then
      raise exception 'BAD_COMBO';
    end if;
  elsif coringa = 1 then
    if simb[1] <> simb[2] then raise exception 'BAD_COMBO'; end if;
  end if;
  -- dois coringas fecham com qualquer carta

  n_troca := coalesce((est ->> 'trocas')::int, 0) + 1;
  vale := public.dominio_valor_troca(n_troca);

  -- o bônus clássico: carta de território SEU põe dois exércitos ali na hora.
  -- É o que faz guardar a carta do próprio território valer a pena.
  for c in select value from jsonb_array_elements(tres) loop
    if c ->> 'ter' is not null
       and coalesce((est -> 'donos' ->> (c ->> 'ter'))::smallint, -1) = meu then
      est := jsonb_set(est, array['exercitos', c ->> 'ter'],
        to_jsonb((est -> 'exercitos' ->> (c ->> 'ter'))::int + 2));
      bonus := bonus + 2;
    end if;
  end loop;

  est := jsonb_set(est, '{trocas}', to_jsonb(n_troca));
  est := jsonb_set(est, '{reforcoLeft}',
    to_jsonb((est ->> 'reforcoLeft')::int + vale));
  est := public.dominio_log(est, jsonb_build_object(
    'k', 'troca', 'seat', meu, 'n', n_troca, 'vale', vale, 'bonus', bonus));

  update public.match_private_state
     set data = jsonb_set(data, '{cartas}', restam)
   where match_id = p_match and user_id = quem;

  est := public.dominio_conta_cartas(est, meu, jsonb_array_length(restam));

  update public.matches
     set public_state = est, version = version + 1,
         turn_deadline = now() + interval '120 seconds'
   where id = p_match;

  return public.dominio_publico(p_match);
end;
$function$
;

-- dominio_atacar_como — 3 uso(s) de auth.uid() viraram `quem`
CREATE OR REPLACE FUNCTION public.dominio_atacar_como(p_seat smallint, p_match uuid, p_de text, p_para text, p_vezes integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  quem uuid;
  semente   bigint;
  meu       smallint;
  mapa      jsonb;
  est       jsonb;
  vitima    smallint;
  atac      int;
  defe      int;
  i         int;
  rolagens  bigint;
  v_datac   int[];
  v_ddefe   int[];
  v_patac   int;
  v_pdefe   int;
  v_usou    int;
  assaltos  jsonb := '[]'::jsonb;
  conquista boolean := false;
  eliminou  smallint := null;
  cartas_v  jsonb;
  abates    int;
  perfeito  boolean := false;
  venceu    boolean := false;
  vitima_id uuid;
begin
  select * into est, semente, mapa, quem from public.dominio_ator(p_match, p_seat);
  meu := p_seat;

  if est ->> 'phase' <> 'ataque' then raise exception 'WRONG_PHASE'; end if;
  if est -> 'avanco' is not null and est -> 'avanco' <> 'null'::jsonb then
    raise exception 'ADVANCE_PENDING';
  end if;
  if p_de = p_para then raise exception 'SAME_TERRITORY'; end if;
  if est -> 'donos' ->> p_de is null or est -> 'donos' ->> p_para is null then
    raise exception 'NO_SUCH_TERRITORY';
  end if;
  if (est -> 'donos' ->> p_de)::smallint <> meu then raise exception 'NOT_YOURS'; end if;
  if (est -> 'donos' ->> p_para)::smallint = meu then raise exception 'TARGET_IS_YOURS'; end if;
  if not (p_para = any(public.dominio_vizinhos(mapa, p_de))) then
    raise exception 'NOT_ADJACENT';
  end if;
  if (est -> 'exercitos' ->> p_de)::int < 2 then raise exception 'NEED_TWO_ARMIES'; end if;
  if p_vezes < 1 or p_vezes > 12 then raise exception 'BAD_ROUNDS'; end if;

  vitima := (est -> 'donos' ->> p_para)::smallint;
  rolagens := coalesce((est ->> 'rolls')::bigint, 0);

  -- atacar já conta, mesmo perdendo: o que a Campanha pune é a PASSIVIDADE,
  -- não a derrota
  est := jsonb_set(est, array['atacou', meu::text], 'true'::jsonb, true);

  for i in 1..p_vezes loop
    atac := (est -> 'exercitos' ->> p_de)::int;
    defe := (est -> 'exercitos' ->> p_para)::int;
    exit when atac < 2 or defe < 1;

    select d_atac, d_defe, perde_atac, perde_defe, usou
      into v_datac, v_ddefe, v_patac, v_pdefe, v_usou
      from public.dominio_assalto(semente, rolagens, atac, defe);
    rolagens := rolagens + v_usou;

    est := jsonb_set(est, array['exercitos', p_de], to_jsonb(atac - v_patac));
    est := jsonb_set(est, array['exercitos', p_para], to_jsonb(defe - v_pdefe));

    if v_pdefe = 3 then perfeito := true; end if;

    assaltos := assaltos || jsonb_build_array(jsonb_build_object(
      'dAtac', v_datac, 'dDefe', v_ddefe,
      'perdeAtac', v_patac, 'perdeDefe', v_pdefe,
      'atac', atac - v_patac, 'defe', defe - v_pdefe));

    if defe - v_pdefe <= 0 then
      conquista := true;
      exit;
    end if;
  end loop;

  if jsonb_array_length(assaltos) = 0 then
    raise exception 'NO_ASSAULT_POSSIBLE';
  end if;

  if conquista then
    -- Um exército muda de território AGORA: território com zero exército é
    -- estado inválido, e o cliente não pode ser o dono dessa correção.
    est := jsonb_set(est, array['exercitos', p_de],
      to_jsonb((est -> 'exercitos' ->> p_de)::int - 1));
    est := jsonb_set(est, array['exercitos', p_para], to_jsonb(1));
    est := jsonb_set(est, array['donos', p_para], to_jsonb(meu));
    est := jsonb_set(est, '{conquistou}', 'true'::jsonb);

    -- o avanço opcional: até três no total, como na mesa, e a origem nunca
    -- fica vazia
    if least(2, (est -> 'exercitos' ->> p_de)::int - 1) > 0 then
      est := jsonb_set(est, '{avanco}', jsonb_build_object(
        'de', p_de, 'para', p_para,
        'max', least(2, (est -> 'exercitos' ->> p_de)::int - 1)));
    end if;

    est := public.dominio_log(est, jsonb_build_object(
      'k', 'conquista', 'seat', meu, 'de', p_de, 'para', p_para, 'vitima', vitima));

    /* O PLACAR DA CAMPANHA conta território tomado de OUTRO JOGADOR nesta
       rodada, e conta atacar. As duas coisas juntas são o dente do
       anti-passividade: quem não ataca perde dois pontos no fim da rodada, e
       quem ataca e toma ganha um por território. Ver §6.5 do PRD. */
    est := jsonb_set(est, array['tomou', meu::text],
      to_jsonb(coalesce((est -> 'tomou' ->> meu::text)::int, 0) + 1), true);

    -- A vítima ficou sem nada? Saiu da partida, e a mão dela passa a ser sua.
    -- Herdar a mão é o que torna eliminar alguém uma decisão e não só um
    -- acidente: quem estava com quatro cartas vale um ataque a mais.
    if not exists (
      select 1 from jsonb_each_text(est -> 'donos') d where d.value::smallint = vitima
    ) then
      eliminou := vitima;

      /* NA CAMPANHA NINGUÉM É ELIMINADO. Quem é zerado volta na rodada
         seguinte com três exércitos, e continua pontuando, atrapalhando e
         sendo cortejado — que é o papel mais divertido do fim de um WAR. No
         Clássico, sai mesmo. */
      if (est ->> 'mode') = 'campanha' then
        est := jsonb_set(est, array['aguardando', vitima::text],
          to_jsonb(coalesce((est ->> 'round')::int, 1) + 1), true);
        est := public.dominio_log(est, jsonb_build_object(
          'k', 'zerado', 'seat', vitima, 'por', meu));
      else
        est := public.dominio_marca_fora(est, vitima);
        est := jsonb_set(est, '{eliminados}', (est -> 'eliminados') || to_jsonb(vitima));
      end if;

      abates := coalesce((est -> 'abates' ->> meu::text)::int, 0) + 1;
      est := jsonb_set(est, array['abates', meu::text], to_jsonb(abates), true);

      select mp.user_id into vitima_id
        from public.match_players mp
       where mp.match_id = p_match and mp.seat = vitima;

      select coalesce(mps.data -> 'cartas', '[]'::jsonb) into cartas_v
        from public.match_private_state mps
       where mps.match_id = p_match and mps.user_id = vitima_id;

      update public.match_private_state mps
         set data = jsonb_set(mps.data, '{cartas}',
               coalesce(mps.data -> 'cartas', '[]'::jsonb) || coalesce(cartas_v, '[]'::jsonb))
       where mps.match_id = p_match and mps.user_id = quem;

      update public.match_private_state mps
         set data = jsonb_set(mps.data, '{cartas}', '[]'::jsonb)
       where mps.match_id = p_match and mps.user_id = vitima_id;

      est := public.dominio_conta_cartas(est, vitima, 0);
      est := public.dominio_conta_cartas(est, meu, (
        select jsonb_array_length(coalesce(mps.data -> 'cartas', '[]'::jsonb))
          from public.match_private_state mps
         where mps.match_id = p_match and mps.user_id = quem));

      if (est ->> 'mode') <> 'campanha' then
        est := public.dominio_log(est, jsonb_build_object(
          'k', 'eliminado', 'seat', vitima, 'por', meu));
      end if;
    end if;
  end if;

  est := jsonb_set(est, '{rolls}', to_jsonb(rolagens));
  est := jsonb_set(est, '{seq}', to_jsonb(coalesce((est ->> 'seq')::int, 0) + 1));

  venceu := public.dominio_venceu(p_match, mapa, est, meu);

  if venceu then
    est := public.dominio_termina(p_match, est, meu);
  else
    update public.matches
       set public_state = est, version = version + 1,
           turn_deadline = now() + interval '120 seconds'
     where id = p_match;
  end if;

  if perfeito then
    perform public.dar_xp(quem, 5, '{}'::jsonb, array['assalto-perfeito']);
  end if;

  return jsonb_build_object(
    'assaltos', assaltos,
    'conquistou', conquista,
    'eliminou', eliminou,
    'venceu', venceu,
    'match', public.dominio_publico(p_match)
  );
end;
$function$
;

-- dominio_avancar_como — 0 uso(s) de auth.uid() viraram `quem`
CREATE OR REPLACE FUNCTION public.dominio_avancar_como(p_seat smallint, p_match uuid, p_qtd integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  quem uuid;
  semente bigint;
  meu     smallint;
  mapa    jsonb;
  est     jsonb;
  av      jsonb;
begin
  select * into est, semente, mapa, quem from public.dominio_ator(p_match, p_seat);
  meu := p_seat;

  av := est -> 'avanco';
  if av is null or av = 'null'::jsonb then raise exception 'NOTHING_TO_ADVANCE'; end if;
  if p_qtd < 0 then raise exception 'BAD_AMOUNT'; end if;
  if p_qtd > (av ->> 'max')::int then raise exception 'TOO_MANY'; end if;
  if p_qtd >= (est -> 'exercitos' ->> (av ->> 'de'))::int then
    raise exception 'WOULD_EMPTY';
  end if;

  if p_qtd > 0 then
    est := jsonb_set(est, array['exercitos', av ->> 'de'],
      to_jsonb((est -> 'exercitos' ->> (av ->> 'de'))::int - p_qtd));
    est := jsonb_set(est, array['exercitos', av ->> 'para'],
      to_jsonb((est -> 'exercitos' ->> (av ->> 'para'))::int + p_qtd));
    est := public.dominio_log(est, jsonb_build_object(
      'k', 'avanco', 'seat', meu, 'de', av ->> 'de', 'para', av ->> 'para', 'n', p_qtd));
  end if;

  est := jsonb_set(est, '{avanco}', 'null'::jsonb);

  update public.matches
     set public_state = est, version = version + 1,
         turn_deadline = now() + interval '120 seconds'
   where id = p_match;

  return public.dominio_publico(p_match);
end;
$function$
;

-- dominio_remanejar_como — 0 uso(s) de auth.uid() viraram `quem`
CREATE OR REPLACE FUNCTION public.dominio_remanejar_como(p_seat smallint, p_match uuid, p_de text, p_para text, p_qtd integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  quem uuid;
  semente bigint;
  meu     smallint;
  mapa    jsonb;
  est     jsonb;
begin
  select * into est, semente, mapa, quem from public.dominio_ator(p_match, p_seat);
  meu := p_seat;

  if est ->> 'phase' not in ('ataque', 'remanejo') then raise exception 'WRONG_PHASE'; end if;
  if est -> 'avanco' is not null and est -> 'avanco' <> 'null'::jsonb then
    raise exception 'ADVANCE_PENDING';
  end if;
  if coalesce((est ->> 'remanejou')::boolean, false) then raise exception 'ALREADY_MOVED'; end if;
  if p_de = p_para then raise exception 'SAME_TERRITORY'; end if;
  if p_qtd < 1 then raise exception 'BAD_AMOUNT'; end if;
  if est -> 'donos' ->> p_de is null or est -> 'donos' ->> p_para is null then
    raise exception 'NO_SUCH_TERRITORY';
  end if;
  if (est -> 'donos' ->> p_de)::smallint <> meu
     or (est -> 'donos' ->> p_para)::smallint <> meu then
    raise exception 'NOT_YOURS';
  end if;
  if p_qtd >= (est -> 'exercitos' ->> p_de)::int then raise exception 'WOULD_EMPTY'; end if;
  if not public.dominio_conectado(mapa, est, meu, p_de, p_para) then
    raise exception 'NOT_CONNECTED';
  end if;

  est := jsonb_set(est, array['exercitos', p_de],
    to_jsonb((est -> 'exercitos' ->> p_de)::int - p_qtd));
  est := jsonb_set(est, array['exercitos', p_para],
    to_jsonb((est -> 'exercitos' ->> p_para)::int + p_qtd));
  est := jsonb_set(est, '{remanejou}', 'true'::jsonb);
  est := jsonb_set(est, '{phase}', '"remanejo"');
  est := public.dominio_log(est, jsonb_build_object(
    'k', 'remanejo', 'seat', meu, 'de', p_de, 'para', p_para, 'n', p_qtd));

  update public.matches
     set public_state = est, version = version + 1,
         turn_deadline = now() + interval '120 seconds'
   where id = p_match;

  return public.dominio_publico(p_match);
end;
$function$
;

-- dominio_encerrar_turno_como — 2 uso(s) de auth.uid() viraram `quem`
CREATE OR REPLACE FUNCTION public.dominio_encerrar_turno_como(p_seat smallint, p_match uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  quem uuid;
  semente  bigint;
  meu      smallint;
  mapa     jsonb;
  est      jsonb;
  carta    jsonb;
  dadas    int;
  quantas  int;
  ativos   smallint[];
  onde     int;
  proximo  smallint;
  tentativa int;
  rodada   int;
  final    int;
  ganhou   boolean;
begin
  select * into est, semente, mapa, quem from public.dominio_ator(p_match, p_seat);
  meu := p_seat;

  if est -> 'avanco' is not null and est -> 'avanco' <> 'null'::jsonb then
    raise exception 'ADVANCE_PENDING';
  end if;
  if (est ->> 'reforcoLeft')::int > 0 then
    raise exception 'PLACE_REINFORCEMENTS';   -- exército parado não passa a vez
  end if;

  -- 1. a carta da conquista
  if coalesce((est ->> 'conquistou')::boolean, false) then
    dadas := coalesce((est ->> 'cartasDadas')::int, 0);
    carta := public.dominio_carta(mapa, semente, dadas);
    est := jsonb_set(est, '{cartasDadas}', to_jsonb(dadas + 1), true);

    update public.match_private_state mps
       set data = jsonb_set(mps.data, '{cartas}',
             coalesce(mps.data -> 'cartas', '[]'::jsonb) || jsonb_build_array(carta))
     where mps.match_id = p_match and mps.user_id = quem;

    select jsonb_array_length(coalesce(mps.data -> 'cartas', '[]'::jsonb)) into quantas
      from public.match_private_state mps
     where mps.match_id = p_match and mps.user_id = quem;

    est := public.dominio_conta_cartas(est, meu, quantas);
    est := public.dominio_log(est, jsonb_build_object('k', 'carta', 'seat', meu));
  end if;

  -- 2. o objetivo pode ter sido cumprido no turno
  ganhou := public.dominio_venceu(p_match, mapa, est, meu);
  if ganhou then
    est := public.dominio_termina(p_match, est, meu);
    return public.dominio_publico(p_match);
  end if;

  -- 3. o próximo assento ativo
  select array_agg((j ->> 'seat')::smallint order by (j ->> 'seat')::smallint)
    into ativos
    from jsonb_array_elements(est -> 'players') j
   where coalesce((j ->> 'ativo')::boolean, true);

  if coalesce(array_length(ativos, 1), 0) <= 1 then
    est := public.dominio_termina(p_match, est, meu);
    return public.dominio_publico(p_match);
  end if;

  /* O PRÓXIMO A JOGAR pula quem está aguardando volta. Na Campanha, quem foi
     zerado fica de fora até a rodada seguinte — dar-lhe um turno sem nenhum
     território seria um turno em que não há nada a fazer. */
  select i into onde from generate_subscripts(ativos, 1) i where ativos[i] = meu;
  proximo := ativos[(coalesce(onde, 0) % array_length(ativos, 1)) + 1];

  for tentativa in 1..array_length(ativos, 1) loop
    exit when est -> 'aguardando' ->> proximo::text is null
              or (est -> 'aguardando' ->> proximo::text)::int
                 <= coalesce((est ->> 'round')::int, 1);
    select i into onde from generate_subscripts(ativos, 1) i where ativos[i] = proximo;
    proximo := ativos[(coalesce(onde, 0) % array_length(ativos, 1)) + 1];
  end loop;

  est := jsonb_set(est, '{turnSeat}', to_jsonb(proximo));
  est := jsonb_set(est, '{phase}', '"reforco"');
  est := jsonb_set(est, '{conquistou}', 'false'::jsonb);
  est := jsonb_set(est, '{remanejou}', 'false'::jsonb);
  est := jsonb_set(est, '{avanco}', 'null'::jsonb);
  /* A VIRADA DA RODADA é onde a Campanha acontece: pontua, devolve quem foi
     zerado, e confere se a décima segunda rodada passou. */
  if proximo = ativos[1] then
    rodada := coalesce((est ->> 'round')::int, 1) + 1;
    est := jsonb_set(est, '{round}', to_jsonb(rodada));

    if (est ->> 'mode') = 'campanha' then
      est := public.dominio_pontua(mapa, est);
      est := public.dominio_restaura(mapa, est, semente, rodada);

      final := (est ->> 'rodadaFinal')::int;
      if final is not null and rodada > final then
        return public.dominio_termina_pontos(p_match, est);
      end if;
    end if;
  end if;

  -- 4. o reforço de quem entra
  est := jsonb_set(est, '{reforcoLeft}',
    to_jsonb(public.dominio_reforco(mapa, est, proximo)));
  est := public.dominio_log(est, jsonb_build_object('k', 'vez', 'seat', proximo));

  update public.matches
     set public_state = est, version = version + 1,
         turn_deadline = now() + interval '120 seconds'
   where id = p_match;

  return public.dominio_publico(p_match);
end;
$function$
;

-- ── e as seis públicas viram casca ─────────────────────────────────
-- Três linhas cada uma: resolve quem é, e delega. `dominio_na_vez` continua
-- sendo quem estoura NOT_AUTHENTICATED, NOT_A_PLAYER e NOT_YOUR_TURN, e por isso
-- nenhuma mensagem de erro do cliente muda.

create or replace function public.dominio_reforcar(p_match uuid, p_ter text, p_qtd int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare est jsonb; s bigint; meu smallint; mp jsonb;
begin
  select * into est, s, meu, mp from public.dominio_na_vez(p_match);
  return public.dominio_reforcar_como(meu, p_match, p_ter, p_qtd);
end;
$$;

create or replace function public.dominio_trocar(p_match uuid, p_cartas int[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare est jsonb; s bigint; meu smallint; mp jsonb;
begin
  select * into est, s, meu, mp from public.dominio_na_vez(p_match);
  return public.dominio_trocar_como(meu, p_match, p_cartas);
end;
$$;

create or replace function public.dominio_atacar(
  p_match uuid, p_de text, p_para text, p_vezes int default 1
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare est jsonb; s bigint; meu smallint; mp jsonb;
begin
  select * into est, s, meu, mp from public.dominio_na_vez(p_match);
  return public.dominio_atacar_como(meu, p_match, p_de, p_para, p_vezes);
end;
$$;

create or replace function public.dominio_avancar(p_match uuid, p_qtd int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare est jsonb; s bigint; meu smallint; mp jsonb;
begin
  select * into est, s, meu, mp from public.dominio_na_vez(p_match);
  return public.dominio_avancar_como(meu, p_match, p_qtd);
end;
$$;

create or replace function public.dominio_remanejar(
  p_match uuid, p_de text, p_para text, p_qtd int
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare est jsonb; s bigint; meu smallint; mp jsonb;
begin
  select * into est, s, meu, mp from public.dominio_na_vez(p_match);
  return public.dominio_remanejar_como(meu, p_match, p_de, p_para, p_qtd);
end;
$$;

create or replace function public.dominio_encerrar_turno(p_match uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare est jsonb; s bigint; meu smallint; mp jsonb;
begin
  select * into est, s, meu, mp from public.dominio_na_vez(p_match);
  return public.dominio_encerrar_turno_como(meu, p_match);
end;
$$;

-- ── privilégio ───────────────────────────────────────────────
-- OS NÚCLEOS NÃO SÃO CHAMÁVEIS PELO CLIENTE, e este é o ponto mais delicado do
-- arquivo: `dominio_atacar_como(3, ..., 'x', 'y', 1)` age no lugar do assento 3.
-- É exatamente o buraco que `dominio_termina` abriu em 0025 — função que recebe
-- de quem é a ação como argumento e obedece. As três palavras, nas seis.

revoke all on function public.dominio_reforcar_como(p_seat smallint, p_match uuid, p_ter text, p_qtd integer) from public, anon, authenticated;
revoke all on function public.dominio_trocar_como(p_seat smallint, p_match uuid, p_cartas integer[]) from public, anon, authenticated;
revoke all on function public.dominio_atacar_como(p_seat smallint, p_match uuid, p_de text, p_para text, p_vezes integer) from public, anon, authenticated;
revoke all on function public.dominio_avancar_como(p_seat smallint, p_match uuid, p_qtd integer) from public, anon, authenticated;
revoke all on function public.dominio_remanejar_como(p_seat smallint, p_match uuid, p_de text, p_para text, p_qtd integer) from public, anon, authenticated;
revoke all on function public.dominio_encerrar_turno_como(p_seat smallint, p_match uuid) from public, anon, authenticated;

grant execute on function public.dominio_reforcar(uuid, text, int) to authenticated;
grant execute on function public.dominio_trocar(uuid, int[]) to authenticated;
grant execute on function public.dominio_atacar(uuid, text, text, int) to authenticated;
grant execute on function public.dominio_avancar(uuid, int) to authenticated;
grant execute on function public.dominio_remanejar(uuid, text, text, int) to authenticated;
grant execute on function public.dominio_encerrar_turno(uuid) to authenticated;
