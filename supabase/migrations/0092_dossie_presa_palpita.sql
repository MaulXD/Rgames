-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0092 · a máquina presa pela tempestade palpita em vez de passar
--
-- 0089 ensinou a máquina a não se debater contra uma porta fechada: presa, ela
-- não tenta andar. Mas a regra que decide se ela PALPITA continuou a mesma —
-- "só palpite se este lugar ainda é candidato" —, e presa num lugar já riscado
-- ela passava a vez.
--
-- A regra estava certa e virou errada quando o contexto mudou, que é o jeito
-- mais silencioso de uma regra ficar errada.
--
--   Solta:  palpitar num lugar riscado  ×  ANDAR até um que importa  → andar
--   Presa:  palpitar num lugar riscado  ×  NÃO FAZER NADA            → palpitar
--
-- Palpitar nunca é nada. Mesmo com o lugar já descartado, as respostas da mesa
-- ensinam sobre o suspeito e sobre o objeto — duas das três colunas do caderno.
--
-- E é exatamente o que o PRD 03 §3 diz que a Tempestade de Areia deve ser:
-- "quem está dentro fica preso, mas continua podendo palpitar, o que faz de um
-- lugar fechado uma POSIÇÃO estratégica, não uma punição".
--
-- A máquina precisa JOGAR isso, não só sofrer. Uma reviravolta que só as pessoas
-- sabem aproveitar é uma reviravolta que torna a máquina mais fácil — e o modo
-- solo é onde a maioria das partidas deste projeto vai acontecer.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.dossie_bot_passo(p_match uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  est     jsonb;
  tema    jsonb;
  semente bigint;
  assento smallint;
  quem    uuid;
  nivel   text;
  dedu    jsonb;
  priv    jsonb;

  pend    jsonb;
  fila    jsonb;
  naVez   smallint;
  mostrar text;
  tenho   text[];

  aqui    text;
  alvo    text;
  passo   text;
  susp    text[];
  arma    text[];
  sala    text[];
  fechados text[];
begin
  select m.public_state, m.seed into est, semente
    from public.matches m
   where m.id = p_match and m.game_key = 'dossie' and m.status = 'running'
   for update;
  if not found then return null; end if;

  select gt.data into tema from public.game_themes gt where gt.id = (est ->> 'theme');

  /* ── 1. REFUTAR ────────────────────────────────────────────────────────
     Primeiro de todos: enquanto a fila de refutação não anda, a mesa inteira
     espera, e o relógio dela é de trinta segundos. */
  if est ->> 'phase' = 'refute' and est -> 'pending' <> 'null'::jsonb
     and est -> 'pending' is not null then
    pend := est -> 'pending';
    fila := pend -> 'queue';
    naVez := (fila ->> coalesce((pend ->> 'at')::int, 0))::smallint;

    if naVez is not null then
      quem := public.dossie_dono(p_match, naVez);
      if exists (select 1 from public.profiles p where p.id = quem and p.is_bot) then
        select mps.data into priv from public.match_private_state mps
         where mps.match_id = p_match and mps.user_id = quem;

        /* QUAL CARTA MOSTRAR, quando há mais de uma.
           A regra de mesa: mostre de novo a que já mostrou àquela pessoa. Cada
           carta nova revelada é informação de graça para quem perguntou, e a
           máquina que dá informação de graça é a máquina que perde. */
        select array_agg(c order by c) into tenho
          from jsonb_array_elements_text(coalesce(priv -> 'hand', '[]'::jsonb)) c
         where pend -> 'guess' @> to_jsonb(array[c]);

        if tenho is null or array_length(tenho, 1) = 0 then
          perform public.dossie_pass_refute_como(naVez, p_match);
          return format('refuta:passa(%s)', naVez);
        end if;

        select c into mostrar
          from unnest(tenho) c
         where exists (
           select 1 from jsonb_array_elements(coalesce(priv -> 'mostrei', '[]'::jsonb)) m
            where m ->> 'card' = c and (m ->> 'para')::smallint = (pend ->> 'bySeat')::smallint
         )
         limit 1;

        if mostrar is null then
          -- nenhuma repetida: escolhe estável, sem `random()`
          select c into mostrar from unnest(tenho) c
           order by ('x' || substr(md5(semente::text || naVez::text || c), 1, 6))::bit(24)::int
           limit 1;
        end if;

        perform public.dossie_refute_como(naVez, p_match, mostrar);

        -- e ela ANOTA a quem mostrou, para poder repetir na próxima
        update public.match_private_state
           set data = jsonb_set(coalesce(data, '{}'::jsonb), '{mostrei}',
                 coalesce(data -> 'mostrei', '[]'::jsonb) || jsonb_build_array(
                   jsonb_build_object(
                     'card', mostrar,
                     'para', (pend ->> 'bySeat')::int,
                     -- o palpite vai junto: sem ele nao da para saber, depois,
                     -- se ela TINHA escolha na hora
                     'guess', pend -> 'guess',
                     'tinha', (select coalesce(jsonb_agg(c), '[]'::jsonb)
                                 from unnest(tenho) c))), true)
         where match_id = p_match and user_id = quem;

        return format('refuta:mostra(%s)', naVez);
      end if;
    end if;
    return null;   -- é vez de gente refutar
  end if;

  /* ── 2. A VEZ DELA ────────────────────────────────────────────────────── */
  if est ->> 'phase' <> 'turn' then return null; end if;

  assento := (est ->> 'turnSeat')::smallint;
  quem := public.dossie_dono(p_match, assento);
  if not exists (select 1 from public.profiles p where p.id = quem and p.is_bot) then
    return null;
  end if;

  select coalesce(rm.bot_nivel, 'medio') into nivel
    from public.matches m
    join public.room_members rm on rm.room_id = m.room_id and rm.user_id = quem
   where m.id = p_match;
  nivel := coalesce(nivel, 'medio');

  dedu := public.dossie_deduz(p_match, assento);
  susp := public.dossie_candidatos(tema, dedu, 'suspect');
  arma := public.dossie_candidatos(tema, dedu, 'weapon');
  sala := public.dossie_candidatos(tema, dedu, 'room');

  /* 2a. FECHOU O CASO? Um candidato em cada categoria e ela ainda não acusou.
     Nunca acusa sem certeza: errar vira fantasma, e máquina que se suicida por
     chute não é adversário mais fácil, é adversário quebrado. */
  if coalesce(array_length(susp, 1), 0) = 1
     and coalesce(array_length(arma, 1), 0) = 1
     and coalesce(array_length(sala, 1), 0) = 1
     and not coalesce(est -> 'accused' @> to_jsonb(array[assento]), false) then
    perform public.dossie_accuse_como(assento, p_match, susp[1], arma[1], sala[1]);
    return format('acusa(%s) %s, %s, %s', assento, susp[1], arma[1], sala[1]);
  end if;

  -- fantasma não joga, só refuta
  if coalesce(est -> 'ghosts' @> to_jsonb(array[assento]), false) then
    perform public.dossie_end_turn_como(assento, p_match);
    return format('passa(%s) fantasma', assento);
  end if;

  aqui := est -> 'positions' ->> assento::text;
  fechados := public.dossie_fechados(est);

  /* 2b. PALPITAR, se a sala em que ela está ainda é candidata.
     Palpitar numa sala já riscada gasta o turno para confirmar o que ela já
     sabe — e é o erro que mais denuncia uma máquina sem cabeça. */
  if (est ->> 'actionsLeft')::int >= 1
     and aqui is not null
     and (nivel = 'facil' or aqui = any(sala) or coalesce(array_length(sala, 1), 0) <= 1
          /* PRESA PELA TEMPESTADE, ela palpita de qualquer jeito.

             Aqui a regra normal ("não gaste turno palpitando num lugar que
             você já riscou") se inverte, porque a alternativa mudou. Solta, a
             escolha é entre palpitar num lugar riscado e ANDAR até um que
             importa — e andar ganha. Presa, a escolha é entre palpitar num
             lugar riscado e NÃO FAZER NADA.

             E palpitar nunca é nada: mesmo com o lugar já descartado, as
             respostas ensinam sobre o suspeito e o objeto. É exatamente a
             razão pela qual o PRD 03 §3 diz que lugar fechado é posição e não
             punição — a máquina precisa jogar isso, não só sofrer. */
          or aqui = any(fechados)) then
    perform public.dossie_suggest_como(
      assento, p_match,
      susp[1 + (('x' || substr(md5(semente::text || coalesce(est ->> 'seq', '0') || 's'), 1, 6))::bit(24)::int
                % greatest(coalesce(array_length(susp, 1), 1), 1))],
      arma[1 + (('x' || substr(md5(semente::text || coalesce(est ->> 'seq', '0') || 'a'), 1, 6))::bit(24)::int
                % greatest(coalesce(array_length(arma, 1), 1), 1))]
    );
    return format('palpita(%s) em %s', assento, aqui);
  end if;

  /* 2c. ANDAR na direção da sala candidata mais próxima.

     Presa pela tempestade, ela não anda: cai direto no "passa". Tentar andar
     levantaria ROOM_CLOSED de dentro de `dossie_move_como`, e a exceção subiria
     pela faxina inteira — foi assim que o Dossiê parou de tirar o turno de
     ninguém no relógio uma vez (0033). A máquina que não pode andar passa a vez
     de propósito, não por acidente.

     E o alvo exclui o que está fechado: andar rumo a um lugar onde não se pode
     entrar é gastar o turno para bater na porta. */
  if (est ->> 'actionsLeft')::int >= 1 and aqui is not null
     and not (aqui = any(fechados)) then
    select s into alvo
      from unnest(sala) s
     where s <> aqui and not (s = any(fechados))
     order by ('x' || substr(md5(semente::text || assento::text || s), 1, 6))::bit(24)::int
     limit 1;

    if alvo is not null then
      passo := public.dossie_passo_para(tema, aqui, alvo, fechados);
      if passo is not null then
        perform public.dossie_move_como(assento, p_match, passo);
        return format('anda(%s) para %s', assento, passo);
      end if;
    end if;
  end if;

  -- 2d. nada a fazer: passa
  perform public.dossie_end_turn_como(assento, p_match);
  return format('passa(%s)', assento);
end;
$function$;

revoke all on function public.dossie_bot_passo(uuid) from public, anon, authenticated;
