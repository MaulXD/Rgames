-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0078 · a terceira das três: a multa da trégua
--
-- `multaReforco` também nasce agora e também não existe no estado inicial, então
-- `jsonb_set(est, array['multaReforco', assento], …, true)` devolvia o estado
-- intacto. Ver 0077 para a explicação inteira.
--
-- O sintoma seria o pior de todos para um jogo de diplomacia: a marca de traidor
-- apareceria, o registro contaria a traição — e o preço não seria cobrado. A
-- traição continuaria de graça, com aparência de custar.
-- ════════════════════════════════════════════════════════════════════════════

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

  /* ── ROMPER A TRÉGUA ──────────────────────────────────────────────────
     O servidor DEIXA, e é o ponto todo: uma trégua que ele impusesse não seria
     diplomacia, seria uma regra de movimento — e ninguém se lembra de uma regra
     de movimento no dia seguinte. O que se lembra é de quem prometeu e atacou
     mesmo assim.

     O preço é o que transforma ruído em história: dois exércitos a menos no
     próximo reforço, a marca de Traidor pelo resto da partida, e uma linha no
     registro com nome e território. */
  if public.dominio_tregua_vale(est, meu, vitima) then
    est := jsonb_set(est, '{treguas}', (est -> 'treguas') -
      (least(meu, vitima)::text || ':' || greatest(meu, vitima)::text));
    if not coalesce(est -> 'traidores' @> to_jsonb(array[meu]), false) then
      est := jsonb_set(est, '{traidores}',
        coalesce(est -> 'traidores', '[]'::jsonb) || to_jsonb(array[meu]), true);
    end if;
    /* `jsonb_poe` e não `jsonb_set`: `multaReforco` não existe no estado
       inicial, e `create_missing` cria só o último degrau do caminho — o
       estado voltaria intacto e a multa nunca seria cobrada. Ver 0077. */
    est := public.jsonb_poe(est, 'multaReforco', meu::text, to_jsonb(2));
    est := public.dominio_log(est, jsonb_build_object(
      'k', 'tregua-rompe', 'seat', meu, 'vitima', vitima, 'ter', p_para));
  end if;
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
$function$;

revoke all on function public.dominio_atacar_como(smallint, uuid, text, text, integer)
  from public, anon, authenticated;
