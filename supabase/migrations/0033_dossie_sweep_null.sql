-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0033 · a faxina do Dossiê quebrava, e eu culpei a rede
--
-- O SINTOMA
--
-- O teste de fumaça do Dossiê falhava uma vez a cada tantas execuções, com um
-- erro de banco em vez de uma checagem reprovada. Eu vi isso duas vezes nesta
-- sessão, achei que era rede — as suítes não têm repetição — e segui. Não era
-- rede. Era isto:
--
--     23502  null value in column "public_state" violates not-null constraint
--     PL/pgSQL function dossie_force_pass(uuid,smallint) line 21
--
-- A CAUSA
--
-- `dossie_sweep` decidia o que fazer assim:
--
--     pend := m.public_state -> 'pending';
--     if pend is null then ... advance ... else ... force_pass/refute ... end if;
--
-- e `pending` no estado do Dossiê não é SQL NULL: é JSON null. Depois de uma
-- refutação, `dossie_force_pass` grava `estado || jsonb_build_object('pending',
-- null)`, que produz `{"pending": null}`. Então `m.public_state -> 'pending'`
-- devolve o valor jsonb `null`, e `jsonb_null is null` é FALSO.
--
-- Resultado: toda partida FORA de refutação — que é a maioria absoluta do
-- tempo — caía no ramo do `else`. Lá, `(pend -> 'queue' ->> ...)` dá NULL, o
-- assento forçado vira NULL, e `dossie_force_pass` monta um estado nulo e
-- tenta gravá-lo.
--
-- O QUE ISSO ESTRAGAVA DE VERDADE, e é pior que o teste piscando: a exceção
-- aborta `dossie_sweep()` INTEIRA. Uma partida ruim derruba a varredura de
-- todas as outras. Em jogo real, isso significa que ninguém nunca perde o
-- turno no relógio no Dossiê — e uma pessoa que fecha a aba no meio de uma
-- refutação congela a mesa para sempre, que é exatamente o problema que a
-- faxina existe para resolver.
--
-- OS TRÊS CONSERTOS
--
--   1. A comparação certa: `pend is null or pend = 'null'::jsonb`. É a mesma
--      distinção que as faxinas do Domínio e da Metrópole já fazem — elas
--      nasceram depois desta lição, e esta ficou para trás.
--
--   2. GUARDA nas duas funções forçadas. Elas relêem o estado com `for
--      update`, e entre a leitura da faxina e o lock a pessoa real pode ter
--      refutado. Sem pendência, elas voltam sem fazer nada em vez de montar
--      estado inválido. É defesa em profundidade: mesmo que uma faxina futura
--      erre a conta, as funções não estragam a partida.
--
--   3. Cada partida numa TRANSAÇÃO DE EXCEÇÃO PRÓPRIA. Um bloco `begin ...
--      exception` por partida faz com que uma que dê erro seja registrada e
--      pulada, e a varredura continue nas outras. Uma faxina que morre inteira
--      por causa de uma linha ruim é uma faxina que não se pode confiar.
--
--   E as linhas passam a ser travadas com `for update skip locked`, como nas
--   outras faxinas: sem isso, duas execuções do cron podem varrer a mesma
--   partida ao mesmo tempo.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.dossie_force_refute(
  p_match uuid, p_seat smallint, p_card text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m       public.matches;
  estado  jsonb;
  pedinte uuid;
  pend    jsonb;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'running' then return; end if;
  estado := m.public_state;

  -- a guarda: entre a faxina decidir e este lock, a pessoa real pode ter
  -- refutado, e aí não há mais nada a forçar
  pend := estado -> 'pending';
  if pend is null or pend = 'null'::jsonb then return; end if;
  if p_seat is null or p_card is null then return; end if;

  select user_id into pedinte from public.match_players
   where match_id = p_match and seat = (pend ->> 'bySeat')::smallint;

  update public.match_private_state
     set data = jsonb_set(data, '{seen}', (data -> 'seen') || jsonb_build_object(
           'card', p_card, 'from', p_seat, 'seq', coalesce((estado ->> 'seq')::int, 0) + 1,
           'auto', true
         ))
   where match_id = p_match and user_id = pedinte;

  estado := public.dossie_log(estado, jsonb_build_object(
    'type', 'refute', 'seat', p_seat, 'auto', true));
  estado := estado || jsonb_build_object('pending', null);

  update public.matches
     set public_state = estado, version = version + 1
   where id = p_match;

  perform public.dossie_advance(p_match);
end;
$$;

revoke all on function public.dossie_force_refute(uuid, smallint, text)
  from public, anon, authenticated;

create or replace function public.dossie_force_pass(p_match uuid, p_seat smallint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m      public.matches;
  estado jsonb;
  pend   jsonb;
  prox   int;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'running' then return; end if;
  estado := m.public_state;

  pend := estado -> 'pending';
  if pend is null or pend = 'null'::jsonb then return; end if;
  if p_seat is null then return; end if;

  -- e a fila tem de existir: sem ela não há "próximo a ser consultado"
  if pend -> 'queue' is null or jsonb_array_length(pend -> 'queue') is null then
    return;
  end if;

  estado := public.dossie_log(estado, jsonb_build_object(
    'type', 'pass', 'seat', p_seat, 'auto', true));
  prox := coalesce((pend ->> 'at')::int, 0) + 1;

  if prox >= jsonb_array_length(pend -> 'queue') then
    estado := public.dossie_log(estado, jsonb_build_object(
      'type', 'no_refute', 'guess', pend -> 'guess'));
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
end;
$$;

revoke all on function public.dossie_force_pass(uuid, smallint)
  from public, anon, authenticated;

create or replace function public.dossie_sweep()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  m      record;
  pend   jsonb;
  atual  smallint;
  quem   uuid;
  carta  text;
  n      int := 0;
begin
  for m in
    select id, public_state from public.matches
     where game_key = 'dossie' and status = 'running' and turn_deadline < now()
     for update skip locked
  loop
    /* Uma transação de exceção POR PARTIDA. Sem isso, uma linha com estado
       inesperado derruba a varredura inteira e nenhuma outra partida é
       atendida — foi o que aconteceu por causa da comparação de nulo abaixo. */
    begin
      pend := m.public_state -> 'pending';

      -- `pending` é JSON null, não SQL NULL: depois de uma refutação o campo
      -- existe e vale `null`. Comparar só com `is null` mandava toda partida
      -- fora de refutação para o ramo errado.
      if pend is null or pend = 'null'::jsonb then
        perform public.dossie_advance(m.id);
      else
        atual := (pend -> 'queue' ->> coalesce((pend ->> 'at')::int, 0))::smallint;

        if atual is null then
          -- fila vazia ou índice fora dela: a pendência não tem a quem
          -- consultar, então ela não deveria existir. Segue o turno.
          perform public.dossie_advance(m.id);
        else
          select user_id into quem from public.match_players
           where match_id = m.id and seat = atual;

          -- a jogada conservadora: mostra a primeira carta que tem
          select c into carta
            from public.match_private_state mps,
                 jsonb_array_elements_text(mps.data -> 'hand') c,
                 jsonb_array_elements_text(pend -> 'guess') g
           where mps.match_id = m.id and mps.user_id = quem and c = g
           limit 1;

          if carta is null then
            perform public.dossie_force_pass(m.id, atual);
          else
            perform public.dossie_force_refute(m.id, atual, carta);
          end if;
        end if;
      end if;
      n := n + 1;
    exception when others then
      raise warning 'dossie_sweep: partida % pulada (%)', m.id, sqlerrm;
    end;
  end loop;
  return n;
end;
$$;

revoke all on function public.dossie_sweep() from public, anon, authenticated;
