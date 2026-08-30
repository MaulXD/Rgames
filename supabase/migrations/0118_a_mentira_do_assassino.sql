-- 0118 — A MENTIRA DO ASSASSINO
--
-- O Modo Assassino subiu inteiro em 0116 menos a metade que dá nome a ele. Sem
-- a mentira, o assassino é um detetive que sabe a resposta e não pode usá-la:
-- joga igual a todo mundo, refuta igual a todo mundo, e a mesa não tem uma
-- única coisa concreta em que reparar. Dedução social sem nada para deduzir.
--
-- UMA POR PARTIDA, E DECLARADA.
--
-- Ela é armada antes e gasta depois, e as duas coisas têm motivo.
--
-- DECLARADA porque uma mentira automática — o servidor simplesmente aceitando o
-- que recusaria — se gasta por engano. A pessoa esquece que tem a carta, aperta
-- "não posso refutar", e a única jogada especial da partida evaporou num
-- clique que ela nem sabe que deu. `dossie_arma_mentira` é um interruptor, e
-- desarma do mesmo jeito que arma.
--
-- E ARMAR NÃO GASTA. A cobrança acontece no momento em que a mentira de fato
-- permite o impossível: refutar sem a carta, ou passar tendo. Quem arma e
-- depois refuta de verdade sai da rodada com a mentira intacta — exatamente
-- como o Álibi, que também é gasto na hora da passada e não na hora da jogada.
--
-- A ORDEM COM O ÁLIBI: primeiro o álibi. Ele é PÚBLICO, custa uma carta que já
-- foi comprada, e a mesa vê que foi usado. Gastar a mentira secreta quando o
-- álibi resolveria a mesma passada seria queimar a peça cara para fazer o
-- trabalho da barata.
--
-- ────────────────────────────────────────────────────────────────────────────
-- INDISTINGUÍVEL, E É ISSO QUE A TORNA UMA MENTIRA
--
-- O estado público depois de uma refutação mentirosa é IGUAL ao de uma
-- verdadeira: a mesma linha `refute` com o mesmo assento, a mesma carta
-- chegando ao privado de quem palpitou, o mesmo `pending` fechado. Uma passada
-- mentirosa é uma linha `pass` e nada mais.
--
-- Se sobrasse qualquer marca — um campo a mais, uma ordem diferente, um `seq`
-- que pula —, quem lesse o estado pelo DevTools jogaria com a resposta. A
-- suíte confere isso comparando os dois estados campo a campo.
--
-- ────────────────────────────────────────────────────────────────────────────
-- E O QUE A TORNA PEGÁVEL
--
-- Três caminhos, e nenhum deles é "prestar atenção no jeito da pessoa":
--
--   1. A CARTA MOSTRADA PODE ESTAR NA MÃO DE QUEM VIU. Aí quem palpitou sabe
--      na hora, com certeza absoluta, que aquilo foi mentira.
--
--      O servidor NÃO impede. Impedir seria contar ao assassino o que tem na
--      mão do outro — "essa não, escolhe outra" é informação que ele não pode
--      ter. O risco é dele, e é o preço da jogada.
--
--   2. A CARTA MOSTRADA PODE ESTAR NA MÃO DE UM TERCEIRO, que vê aquela carta
--      ser mostrada por quem não a tem e passa o resto da partida sabendo.
--
--   3. O DESFECHO ABRE TUDO. `dossie_desfecho` só responde com a partida
--      encerrada, e aí diz quem era o assassino e em que linha do registro ele
--      mentiu. É o pagamento do modo: a mesa reconstitui a partida sabendo
--      onde estava o buraco.
--
-- ────────────────────────────────────────────────────────────────────────────
-- ZERO CANDIDATOS NÃO É CONHECIMENTO, É CONTRADIÇÃO
--
-- Esta é a parte que a mentira obriga a consertar, e ela vale por si.
--
-- `dossie_candidatos` devolve o que sobrou de uma categoria depois de riscar o
-- que está em `fora`. Numa partida honesta, a carta do envelope NUNCA entra em
-- `fora` — não há como prová-la fora, porque ela não está com ninguém. Então
-- "sobrou zero" era inalcançável, e ninguém tinha motivo para pensar nisso.
--
-- A mentira alcança. O assassino conhece o envelope: a jogada mais forte do
-- modo é mostrar a carta que está dentro dele. Quem acreditar risca a resposta,
-- e a categoria inteira cai.
--
-- E aí a máquina chamava `dossie_suggest_como` com o elemento 1 de um vetor
-- vazio, ou seja, com NULL — a exceção subiria pela faxina e pararia a mesa
-- para todo mundo. É o defeito de 0033 com outra roupa, e ele estava esperando
-- o dia em que alguém mentisse.
--
-- O conserto é a leitura honesta do que aconteceu: se não sobrou nenhum, o
-- caderno está errado, não o mundo. A categoria volta inteira ao jogo. A
-- máquina para de ter certeza e volta a investigar — que é precisamente o que
-- uma pessoa faria ao chegar num absurdo.
--
-- Isto NÃO é a máquina detectando a mentira: ela não sabe que houve uma, e
-- continua sem saber. É ela não travando por causa de uma.
--
-- ────────────────────────────────────────────────────────────────────────────
-- A MÁQUINA NÃO MENTE
--
-- E não é esquecimento. 0116 escreveu que o assassino é gente sempre que
-- houver gente, e a razão continua valendo: a suíte confere, partida a partida,
-- que NENHUMA máquina risca carta do envelope, e essa frase só vale porque é
-- absoluta. Ensinar a máquina a mentir abriria a exceção que apaga a checagem.
--
-- Uma mesa só de máquinas sorteia um assassino no primeiro assento, e ele
-- simplesmente nunca arma a mentira. É partida que não existe fora de teste.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. PODE MENTIR? — uma pergunta, um lugar
--
-- Assassino, com a mentira armada e ainda não gasta. As três condições vivem
-- aqui e em nenhum outro lugar, senão a próxima função a precisar delas
-- copiaria duas das três.

create or replace function public.dossie_pode_mentir(p_match uuid, p_seat smallint)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(bool_or(
           coalesce((mps.data ->> 'assassino')::boolean, false)
           and coalesce((mps.data ->> 'mentiraArmada')::boolean, false)
           and mps.data -> 'mentiu' is null
         ), false)
    from public.match_private_state mps
   where mps.match_id = p_match
     and mps.user_id = public.dossie_dono(p_match, p_seat);
$$;

revoke all on function public.dossie_pode_mentir(uuid, smallint)
  from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. GASTAR — e guardar ONDE, para o desfecho poder contar
--
-- `mentiu` guarda o `seq` da linha do registro em que a mentira aconteceu. Não
-- é enfeite: é o que permite ao desfecho apontar a linha exata em vez de dizer
-- "mentiu em algum momento", que não deixa a mesa reconstituir nada.
--
-- E desarmar junto é o que impede a mentira de virar duas: `dossie_pode_mentir`
-- exige as três condições, e a partir daqui `mentiu` mata a terceira para
-- sempre.

create or replace function public.dossie_gasta_mentira(
  p_match uuid, p_seat smallint, p_seq int)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.match_private_state
     set data = (data - 'mentiraArmada')
             || jsonb_build_object('mentiu', jsonb_build_object('seq', p_seq))
   where match_id = p_match and user_id = public.dossie_dono(p_match, p_seat);
end;
$$;

revoke all on function public.dossie_gasta_mentira(uuid, smallint, int)
  from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. ARMAR E DESARMAR — o interruptor, e ele é privado
--
-- Nada no estado público muda quando alguém arma. Se mudasse, a mesa saberia
-- quem é o assassino no instante em que ele pensasse em mentir, e o modo
-- acabaria antes da mentira.

create or replace function public.dossie_arma_mentira_como(p_seat smallint, p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  m    public.matches;
  quem uuid;
  priv jsonb;
  nova boolean;
begin
  select * into m from public.matches where id = p_match;
  if not found or m.status <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;

  quem := public.dossie_dono(p_match, p_seat);
  if quem is null then raise exception 'NOT_A_PLAYER'; end if;

  select mps.data into priv from public.match_private_state mps
   where mps.match_id = p_match and mps.user_id = quem;

  /* Um detetive perguntando isto não descobre nada que já não saiba: ele sabe
     que não é o assassino. */
  if not coalesce((priv ->> 'assassino')::boolean, false) then
    raise exception 'NAO_E_ASSASSINO';
  end if;
  if priv -> 'mentiu' is not null then raise exception 'MENTIRA_GASTA'; end if;

  nova := not coalesce((priv ->> 'mentiraArmada')::boolean, false);

  update public.match_private_state
     set data = case when nova
                     then data || jsonb_build_object('mentiraArmada', true)
                     else data - 'mentiraArmada' end
   where match_id = p_match and user_id = quem;

  return jsonb_build_object('armada', nova);
end;
$$;

revoke all on function public.dossie_arma_mentira_como(smallint, uuid)
  from public, anon, authenticated;

create or replace function public.dossie_arma_mentira(p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare meu smallint;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select mp.seat into meu from public.match_players mp
   where mp.match_id = p_match and mp.user_id = auth.uid();
  if meu is null then raise exception 'NOT_A_PLAYER'; end if;
  return public.dossie_arma_mentira_como(meu, p_match);
end;
$$;

revoke all on function public.dossie_arma_mentira(uuid) from public, anon, authenticated;
grant execute on function public.dossie_arma_mentira(uuid) to authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. O DESFECHO — a partida acabou, então a mesa pode saber
--
-- Enquanto a partida corre, quem é o assassino mora só no privado dele. Não
-- existe caminho — nem pelo estado público, nem por RPC — que revele o assento.
--
-- Terminada, a pergunta muda de natureza: não há mais o que proteger, e há o
-- que pagar. Esta função responde a jogador da mesa, com a partida encerrada, e
-- em nenhuma outra circunstância. É por isso que ela é o único lugar do Dossiê
-- que lê o privado de outra pessoa.

create or replace function public.dossie_desfecho(p_match uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  m      public.matches;
  achado record;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into m from public.matches where id = p_match;
  if not found then raise exception 'NO_MATCH'; end if;
  if m.status <> 'finished' then raise exception 'MATCH_NOT_FINISHED'; end if;

  if not exists (
    select 1 from public.match_players mp
     where mp.match_id = p_match and mp.user_id = auth.uid()
  ) then raise exception 'NOT_A_PLAYER'; end if;

  select mp.seat as assento, mps.data -> 'mentiu' as mentira
    into achado
    from public.match_private_state mps
    join public.match_players mp
      on mp.match_id = mps.match_id and mp.user_id = mps.user_id
   where mps.match_id = p_match
     and coalesce((mps.data ->> 'assassino')::boolean, false)
   limit 1;

  if not found then return jsonb_build_object('assassino', null); end if;
  return jsonb_build_object('assassino', achado.assento, 'mentira', achado.mentira);
end;
$$;

revoke all on function public.dossie_desfecho(uuid) from public, anon, authenticated;
grant execute on function public.dossie_desfecho(uuid) to authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. REFUTAR SEM A CARTA

CREATE OR REPLACE FUNCTION public.dossie_refute_como(p_seat smallint, p_match uuid, p_card text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m        public.matches;
  estado   jsonb;
  pend     jsonb;
  meu      smallint;
  atual    smallint;
  pedinte  uuid;
  tenho    boolean;
  no_palpite boolean;
  escuro   boolean;
  mentiu   boolean := false;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;
  estado := m.public_state;
  pend := estado -> 'pending';
  if pend is null or estado ->> 'phase' <> 'refute' then raise exception 'NOTHING_TO_REFUTE'; end if;

  select seat into meu from public.match_players
   where match_id = p_match and user_id = public.dossie_dono(p_match, p_seat);
  if meu is null then raise exception 'NOT_A_PLAYER'; end if;

  atual := (pend -> 'queue' ->> (pend ->> 'at')::int)::smallint;
  if atual is distinct from meu then raise exception 'NOT_YOUR_REFUTE'; end if;

  -- a carta tem de estar de fato na mão, e ser uma das três do palpite
  select exists (
    select 1 from public.match_private_state mps,
      jsonb_array_elements_text(mps.data -> 'hand') c
     where mps.match_id = p_match and mps.user_id = public.dossie_dono(p_match, p_seat) and c = p_card
  ) into tenho;
  /* ── A MENTIRA DO ASSASSINO (0118) ────────────────────────────────────
     Uma por partida, armada de propósito antes. Sem ela armada, a regra é a de
     sempre: mostrar carta que não se tem é a trapaça mais óbvia do jogo.

     A carta continua tendo de ser UMA DAS TRÊS do palpite, e isso não é
     detalhe: mostrar algo de fora do palpite não seria mentira, seria uma
     jogada que não existe, e a tela de quem palpitou não saberia desenhá-la.

     E o servidor não confere se a carta está na mão de quem palpitou. Conferir
     seria contar ao assassino o que o outro tem — "essa não, escolhe outra" é
     informação que ele não pode ter. Mentir com a carta errada é o risco da
     jogada, e é o primeiro dos três jeitos de pegá-lo. */
  if not tenho then
    if not public.dossie_pode_mentir(p_match, p_seat) then
      raise exception 'NOT_IN_HAND';
    end if;
    mentiu := true;
  end if;

  select exists (
    select 1 from jsonb_array_elements_text(pend -> 'guess') g where g = p_card
  ) into no_palpite;
  if not no_palpite then raise exception 'NOT_IN_GUESS'; end if;

  /* O APAGÃO apaga QUEM mostrou. Nunca O QUE mostrou.

     Essa é a linha inteira da regra, e é o que a torna choque sem prejuízo:
     "aquela carta não está no envelope" continua sendo sua, porque é a
     informação que decide a partida. O que some é a atribuição — saber de QUEM
     ela é —, que é a metade lenta da dedução.

     Se o apagão escondesse a carta, seria uma rodada jogada fora. */
  select coalesce((estado -> 'twist' ->> 'active')::boolean, false)
     and estado -> 'twist' ->> 'id' = 'apagao'
    into escuro;

  -- a carta vai para o estado PRIVADO de quem palpitou. Nunca para o público.
  select user_id into pedinte from public.match_players
   where match_id = p_match and seat = (pend ->> 'bySeat')::smallint;

  update public.match_private_state
     set data = jsonb_set(
           data, '{seen}',
           (data -> 'seen') || jsonb_build_object(
             'card', p_card,
             'from', case when escuro then null else to_jsonb(meu) end,
             'seq', coalesce((estado ->> 'seq')::int, 0) + 1
           )
         )
   where match_id = p_match and user_id = pedinte;

  -- no log, só QUEM mostrou — e no apagão, nem isso
  estado := public.dossie_log(estado, case when escuro
    then jsonb_build_object('type', 'refute', 'seat', null, 'anon', true)
    else jsonb_build_object('type', 'refute', 'seat', meu)
  end);
  estado := estado || jsonb_build_object('pending', null);

  /* Gasta DEPOIS do log, e com o seq da linha que acabou de nascer: é ela que o
     desfecho vai apontar quando a partida acabar e a mesa quiser reconstituir
     onde estava o buraco. */
  if mentiu then
    perform public.dossie_gasta_mentira(p_match, p_seat, (estado ->> 'seq')::int);
  end if;

  update public.matches set public_state = estado, version = version + 1 where id = p_match;
  perform public.dossie_advance(p_match);

  return jsonb_build_object('ok', true);
end;
$function$;

revoke all on function public.dossie_refute_como(smallint, uuid, text)
  from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. PASSAR TENDO A CARTA

CREATE OR REPLACE FUNCTION public.dossie_pass_refute_como(p_seat smallint, p_match uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m      public.matches;
  estado jsonb;
  pend   jsonb;
  meu    smallint;
  atual  smallint;
  tenho  boolean;
  prox   int;
  mentiu boolean := false;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;
  estado := m.public_state;
  pend := estado -> 'pending';
  if pend is null or estado ->> 'phase' <> 'refute' then raise exception 'NOTHING_TO_REFUTE'; end if;

  select seat into meu from public.match_players
   where match_id = p_match and user_id = public.dossie_dono(p_match, p_seat);
  atual := (pend -> 'queue' ->> (pend ->> 'at')::int)::smallint;
  if atual is distinct from meu then raise exception 'NOT_YOUR_REFUTE'; end if;

  -- É AQUI que se impede a trapaça mais óbvia do jogo: "esquecer" de refutar.
  select exists (
    select 1
      from public.match_private_state mps,
           jsonb_array_elements_text(mps.data -> 'hand') c,
           jsonb_array_elements_text(pend -> 'guess') g
     where mps.match_id = p_match and mps.user_id = public.dossie_dono(p_match, p_seat) and c = g
  ) into tenho;
  /* O ÁLIBI é a única coisa no jogo que deixa alguém não refutar tendo a
     carta, e por isso ele é gasto AQUI e não quando foi jogado: entre jogar e
     passar, a pessoa pode mudar de ideia e refutar mesmo assim — e aí a carta
     tem de continuar na mão dela.

     A bandeira em `alibi` diz "esta pessoa declarou álibi nesta refutação". Ela
     morre junto com a passada. */
  if tenho and coalesce((estado -> 'alibi' ->> meu::text)::boolean, false) then
    tenho := false;
    estado := public.jsonb_poe(estado, 'alibi', meu::text, 'null'::jsonb);
    estado := public.dossie_log(estado, jsonb_build_object(
      'type', 'alibi', 'seat', meu
    ));
  end if;
  /* ── A MENTIRA DO ASSASSINO (0118) ────────────────────────────────────
     DEPOIS DO ÁLIBI, e a ordem é a regra. O álibi é público, custa uma carta
     que já foi comprada, e a mesa vê que foi usado; a mentira é secreta e há
     uma só. Gastar a cara para fazer o trabalho da barata seria desperdício —
     e o bloco do álibi acima já derrubou a bandeira quando ele valia. */
  if tenho then
    if not public.dossie_pode_mentir(p_match, p_seat) then
      raise exception 'YOU_MUST_REFUTE';
    end if;
    mentiu := true;
  end if;

  estado := public.dossie_log(estado, jsonb_build_object('type', 'pass', 'seat', meu));
  if mentiu then
    perform public.dossie_gasta_mentira(p_match, p_seat, (estado ->> 'seq')::int);
  end if;
  prox := (pend ->> 'at')::int + 1;

  if prox >= jsonb_array_length(pend -> 'queue') then
    -- ninguém pôde refutar: a linha mais importante do jogo
    estado := public.dossie_log(estado, jsonb_build_object(
      'type', 'no_refute', 'guess', pend -> 'guess'
    ));
    estado := estado || jsonb_build_object('pending', null);
    update public.matches set public_state = estado, version = version + 1 where id = p_match;
    perform public.dossie_advance(p_match);
  else
    estado := jsonb_set(estado, '{pending,at}', to_jsonb(prox));
    update public.matches
       set public_state = estado, version = version + 1,
           turn_deadline = now() + interval '30 seconds'
     where id = p_match;
  end if;

  return jsonb_build_object('ok', true);
end;
$function$;

revoke all on function public.dossie_pass_refute_como(smallint, uuid)
  from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. E A MÁQUINA NÃO TRAVA NO ABSURDO

CREATE OR REPLACE FUNCTION public.dossie_candidatos(p_tema jsonb, p_dedu jsonb, p_tipo text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
  /* ZERO CANDIDATOS NÃO É CONHECIMENTO, É CONTRADIÇÃO.

     Numa partida honesta a carta do envelope nunca entra em `fora` — não há
     como prová-la fora, porque ela não está com ninguém. Então "sobrou zero"
     era inalcançável, e a máquina lia `susp[1]` de um vetor vazio sem que
     ninguém tivesse motivo para desconfiar.

     A mentira do assassino alcança: a jogada mais forte do modo é mostrar
     justamente a carta do envelope, e quem acreditar risca a resposta e derruba
     a categoria inteira. O NULL descia até `dossie_suggest_como` e a exceção
     subia pela faxina, parando a mesa para todo mundo — o defeito de 0033 com
     outra roupa.

     Se não sobrou nenhum, quem está errado é o caderno, não o mundo: a
     categoria volta inteira. A máquina perde a certeza e volta a investigar,
     que é o que uma pessoa faria ao chegar num absurdo. Ela não descobre que
     houve mentira — ela só não trava por causa de uma. */
  with todas as (
    select c ->> 'id' id
      from jsonb_array_elements(
        case p_tipo
          when 'suspect' then p_tema -> 'suspects'
          when 'weapon'  then p_tema -> 'weapons'
          else p_tema -> 'rooms'
        end) c
  )
  select coalesce(
    (select array_agg(id order by id) from todas
      where not coalesce(p_dedu -> 'fora', '[]'::jsonb) @> to_jsonb(array[id])),
    (select array_agg(id order by id) from todas),
    '{}');
$function$;
