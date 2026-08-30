-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0103 · as Cartas de Pista, primeira metade (PRD 03 §6.8)
--
-- Baralho de 24 cartas, seis tipos com quatro cópias cada. A ação INVESTIGAR
-- custa uma das duas ações do turno e só existe num lugar onde não há mais
-- ninguém — que é o que faz dela uma escolha e não um imposto: você troca meia
-- rodada de perguntas por uma carta, e paga com a solidão.
--
--   Interrogatório     escolha um jogador; ele mostra uma carta do tipo que
--                      você pedir                              → 0105
--   Álibi              na próxima refutação obrigatória, você pode não refutar
--   Impressão digital  o servidor diz se o suspeito do envelope está entre dois
--                      que você nomear                         → 0104
--   Chave-mestra       mova-se para qualquer lugar, de graça
--   Recado anônimo     escolha um jogador; ele vê uma carta que NÃO está no
--                      envelope                                → 0104
--   Tempo é curto      o próximo jogador tem 1 ação em vez de 2
--
-- Esta migração traz o baralho, a ação e as TRÊS que são bandeira de estado —
-- Álibi, Chave-mestra e Tempo é curto. As outras três precisam de leitura do
-- envelope ou de uma resposta de outro jogador, e vêm em 0104 e 0105.
--
-- CADA MIGRAÇÃO ENTREGA CARTA QUE FUNCIONA. Publicar as seis com três sem
-- efeito seria a mesma configuração decorativa que o `twist` quase foi: a mesa
-- lê "Recado anônimo" na mão, joga a carta, e nada acontece.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O BARALHO NÃO É GUARDADO EM LUGAR NENHUM
--
-- Ele é DERIVADO da semente da partida, que já existe e que o cliente não pode
-- ler — `matches.seed` não tem grant de SELECT para papel de cliente nenhum, do
-- mesmo jeito que `solution`.
--
--     baralho = shuffle_text(as 24 cartas, seed)
--     a próxima é baralho[tirou + 1]
--
-- O estado público guarda só `tirou`, que é quantas já saíram — e isso é
-- informação pública de mesa: todo mundo vê alguém investigar.
--
-- A alternativa era guardar o baralho embaralhado numa coluna secreta, e ela
-- traria uma segunda fonte da verdade para uma coisa que a semente já
-- determina. Duas fontes divergem; uma não.
--
-- ────────────────────────────────────────────────────────────────────────────
-- SÓ EM "MODO AVANÇADO"
--
-- É o que o PRD pede, e a razão é de produto: o Dossiê já tem seis suspeitos,
-- nove lugares, um caderno de dedução e uma reviravolta por caso. Uma sétima
-- coisa para aprender na primeira partida é uma partida que ninguém termina.
--
-- Como a reviravolta, a regra é CONGELADA no início: quem começou sem cartas
-- termina sem cartas.
-- ════════════════════════════════════════════════════════════════════════════

/**
 * As 24 cartas na ordem desta partida.
 *
 * Seis tipos, quatro cópias. Quatro e não uma: com uma cópia cada, a primeira
 * pessoa a investigar sabe que aquele efeito saiu do baralho, e a contagem de
 * cartas vira um segundo jogo em cima do primeiro. Com quatro, saber que uma
 * saiu quase não diz nada.
 */
create or replace function public.dossie_pistas_baralho(p_seed bigint)
returns text[]
language sql
immutable
as $$
  select public.shuffle_text(
    array[
      'interrogatorio', 'interrogatorio', 'interrogatorio', 'interrogatorio',
      'alibi',          'alibi',          'alibi',          'alibi',
      'impressao',      'impressao',      'impressao',      'impressao',
      'chave-mestra',   'chave-mestra',   'chave-mestra',   'chave-mestra',
      'recado',         'recado',         'recado',         'recado',
      'tempo-curto',    'tempo-curto',    'tempo-curto',    'tempo-curto'
    ],
    p_seed + 977
  );
$$;

revoke all on function public.dossie_pistas_baralho(bigint) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

/**
 * Investigar: gasta uma ação e compra a próxima carta do baralho.
 *
 * SÓ ONDE NÃO HÁ MAIS NINGUÉM. É a regra que dá preço à carta — o lugar vazio é
 * longe de onde a mesa está, e ir até lá é abrir mão de palpitar perto de quem
 * ainda não te mostrou nada.
 */
create or replace function public.dossie_investigar_como(p_seat smallint, p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m       public.matches;
  estado  jsonb;
  meu     smallint;
  aqui    text;
  tirou   int;
  baralho text[];
  carta   text;
  quem    uuid;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;
  estado := m.public_state;

  if estado -> 'pistas' is null or estado -> 'pistas' = 'null'::jsonb then
    raise exception 'SEM_PISTAS';
  end if;

  select seat into meu from public.match_players
   where match_id = p_match and user_id = public.dossie_dono(p_match, p_seat);
  if meu is null then raise exception 'NOT_A_PLAYER'; end if;
  if (estado ->> 'turnSeat')::smallint <> meu then raise exception 'NOT_YOUR_TURN'; end if;
  if estado ->> 'phase' <> 'turn' then raise exception 'WRONG_PHASE'; end if;
  if (estado ->> 'actionsLeft')::int < 1 then raise exception 'NO_ACTIONS'; end if;

  aqui := estado -> 'positions' ->> meu::text;
  if aqui is null then raise exception 'NOT_IN_A_ROOM'; end if;

  /* O lugar tem de estar vazio de gente. Fantasma conta: ele continua no
     tabuleiro e continua vendo. */
  if exists (
    select 1 from jsonb_each_text(estado -> 'positions') p
     where p.key <> meu::text and p.value = aqui
  ) then
    raise exception 'LUGAR_COM_GENTE';
  end if;

  tirou := coalesce((estado -> 'pistas' ->> 'tirou')::int, 0);
  baralho := public.dossie_pistas_baralho(m.seed);
  if tirou >= array_length(baralho, 1) then raise exception 'BARALHO_VAZIO'; end if;

  carta := baralho[tirou + 1];
  quem := public.dossie_dono(p_match, meu);

  update public.match_private_state
     set data = public.jsonb_poe(coalesce(data, '{}'::jsonb), 'pistas', 'mao',
           coalesce(data -> 'pistas' -> 'mao', '[]'::jsonb) || to_jsonb(carta))
   where match_id = p_match and user_id = quem;

  estado := public.jsonb_poe(estado, 'pistas', 'tirou', to_jsonb(tirou + 1));
  estado := jsonb_set(estado, '{actionsLeft}', to_jsonb((estado ->> 'actionsLeft')::int - 1));

  /* O LOG DIZ QUE ALGUÉM INVESTIGOU, e nunca O QUÊ. Qual carta saiu é da pessoa
     — é a mesma linha que separa "mostrou uma carta" de "mostrou a corda". */
  estado := public.dossie_log(estado, jsonb_build_object(
    'type', 'investiga', 'seat', meu, 'room', aqui
  ));

  update public.matches set public_state = estado, version = version + 1 where id = p_match;

  if (estado ->> 'actionsLeft')::int = 0 then
    perform public.dossie_advance(p_match);
  end if;

  -- a carta volta para quem investigou, e só para ela
  return jsonb_build_object('ok', true, 'carta', carta);
end;
$$;

revoke all on function public.dossie_investigar_como(smallint, uuid)
  from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.dossie_investigar(p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  meu smallint;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select seat into meu from public.match_players
   where match_id = p_match and user_id = auth.uid();
  if meu is null then raise exception 'NOT_A_PLAYER'; end if;
  return public.dossie_investigar_como(meu, p_match);
end;
$$;

revoke all on function public.dossie_investigar(uuid) from public, anon;
grant execute on function public.dossie_investigar(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

/**
 * Usar uma carta de pista.
 *
 * Um lugar só, um ramo por carta — a mesma forma de `dossie_vira_rodada`. Se um
 * dia forem doze cartas, continuam sendo doze ramos de uma função, e não doze
 * remendos espalhados pelo motor.
 *
 * As três desta migração são as que só mexem em BANDEIRA DE ESTADO: nenhuma
 * delas lê o envelope nem espera resposta de outro jogador.
 */
create or replace function public.dossie_usar_pista_como(
  p_seat smallint, p_match uuid, p_carta text, p_arg jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m       public.matches;
  estado  jsonb;
  meu     smallint;
  quem    uuid;
  mao     jsonb;
  tem     boolean;
  destino text;
  prox    smallint;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;
  estado := m.public_state;

  select seat into meu from public.match_players
   where match_id = p_match and user_id = public.dossie_dono(p_match, p_seat);
  if meu is null then raise exception 'NOT_A_PLAYER'; end if;
  quem := public.dossie_dono(p_match, meu);

  select coalesce(data -> 'pistas' -> 'mao', '[]'::jsonb) into mao
    from public.match_private_state
   where match_id = p_match and user_id = quem;

  select exists (
    select 1 from jsonb_array_elements_text(mao) c where c = p_carta
  ) into tem;
  if not tem then raise exception 'PISTA_NAO_ESTA_NA_MAO'; end if;

  case p_carta

    /* CHAVE-MESTRA — mova-se para qualquer lugar, de graça.
       "De graça" é o ponto: ela não gasta ação, então é a única forma de estar
       em dois lugares numa rodada. Vale a vez inteira de quem a joga na hora
       certa. */
    when 'chave-mestra' then
      if (estado ->> 'turnSeat')::smallint <> meu then raise exception 'NOT_YOUR_TURN'; end if;
      if estado ->> 'phase' <> 'turn' then raise exception 'WRONG_PHASE'; end if;
      destino := p_arg ->> 'para';
      if destino is null then raise exception 'FALTA_O_DESTINO'; end if;
      if not exists (
        select 1 from public.game_themes gt,
                    lateral jsonb_array_elements(gt.data -> 'rooms') r
         where gt.id = estado ->> 'theme' and r ->> 'id' = destino
      ) then
        raise exception 'LUGAR_NAO_EXISTE';
      end if;
      /* A tempestade fecha para a chave-mestra também. Uma carta que passa por
         cima da regra do caso transformaria a reviravolta em sugestão. */
      if destino = any(public.dossie_fechados(estado)) then raise exception 'ROOM_CLOSED'; end if;
      estado := jsonb_set(estado, array['positions', meu::text], to_jsonb(destino));
      estado := public.dossie_log(estado, jsonb_build_object(
        'type', 'pista', 'seat', meu, 'carta', 'chave-mestra', 'room', destino
      ));

    /* TEMPO É CURTO — o próximo jogador tem uma ação em vez de duas.
       Guardada como ASSENTO e não como bandeira: entre jogá-la e a vez do
       próximo chegar, alguém pode virar fantasma, e a ordem muda. */
    when 'tempo-curto' then
      if (estado ->> 'turnSeat')::smallint <> meu then raise exception 'NOT_YOUR_TURN'; end if;
      prox := public.dossie_next_seat(estado, meu);
      if prox is null then raise exception 'NAO_HA_PROXIMO'; end if;
      estado := estado || jsonb_build_object('tempoCurto', prox);
      estado := public.dossie_log(estado, jsonb_build_object(
        'type', 'pista', 'seat', meu, 'carta', 'tempo-curto', 'alvo', prox
      ));

    /* ÁLIBI — a carta que se joga FORA DA SUA VEZ, e a única assim.
       Ela vale na refutação, que é justamente quando não é a sua vez. Por isso
       não há checagem de turno aqui: haver uma tornaria a carta inútil. */
    when 'alibi' then
      if estado ->> 'phase' <> 'refute' or estado -> 'pending' is null then
        raise exception 'NADA_PARA_REFUTAR';
      end if;
      if (estado -> 'pending' -> 'queue' ->> (estado -> 'pending' ->> 'at')::int)::smallint
         is distinct from meu then
        raise exception 'NOT_YOUR_REFUTE';
      end if;
      estado := public.jsonb_poe(estado, 'alibi', meu::text, 'true'::jsonb);
      estado := public.dossie_log(estado, jsonb_build_object(
        'type', 'pista', 'seat', meu, 'carta', 'alibi'
      ));

    else
      raise exception 'PISTA_DESCONHECIDA_%', p_carta;
  end case;

  /* A carta sai da mão. Uma só, mesmo com quatro cópias no baralho: quem tem
     duas chave-mestras gasta uma. */
  update public.match_private_state
     set data = public.jsonb_poe(coalesce(data, '{}'::jsonb), 'pistas', 'mao',
           (select coalesce(jsonb_agg(c), '[]'::jsonb)
              from (
                select c, row_number() over () n
                  from jsonb_array_elements_text(mao) c
              ) t
             where not (t.c = p_carta and t.n = (
               select min(n) from (
                 select c c2, row_number() over () n from jsonb_array_elements_text(mao) c
               ) u where u.c2 = p_carta
             ))))
   where match_id = p_match and user_id = quem;

  update public.matches set public_state = estado, version = version + 1 where id = p_match;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.dossie_usar_pista_como(smallint, uuid, text, jsonb)
  from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.dossie_usar_pista(
  p_match uuid, p_carta text, p_arg jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  meu smallint;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select seat into meu from public.match_players
   where match_id = p_match and user_id = auth.uid();
  if meu is null then raise exception 'NOT_A_PLAYER'; end if;
  return public.dossie_usar_pista_como(meu, p_match, p_carta, p_arg);
end;
$$;

revoke all on function public.dossie_usar_pista(uuid, text, jsonb) from public, anon;
grant execute on function public.dossie_usar_pista(uuid, text, jsonb) to authenticated;
