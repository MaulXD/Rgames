-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0115 · o campo do Domínio que nunca teve leitor
--
-- Desde a migração 0019, `dominio_start` escrevia uma lista vazia chamada
-- `planos` no estado privado de TODO jogador de TODA partida. Nenhuma função do
-- banco a leu; nenhuma tela a leu; nenhuma função a escreveu depois. Cinco anos
-- de projeto em dias, e a lista continuou vazia.
--
-- Ela não quebrava nada — é essa a característica da doença. Um campo assim
-- ocupa espaço, atravessa a rede em toda leitura de estado privado, e faz quem
-- abre o JSON perguntar o que ele significa. A resposta é: nada.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O TERCEIRO DISFARCE DA MESMA COISA
--
-- Já apareceu duas vezes esta semana, com roupas diferentes:
--
--   a carta de pista que o baralho distribuía e o `case` não conhecia
--   a regra da casa que o servidor aceitava e o lobby não oferecia
--
-- E agora o campo que se escreve e ninguém lê. Os três se parecem em uma coisa:
-- NADA QUEBRA. Não há erro, não há teste vermelho, não há linha no log. Só
-- existe uma promessa que ninguém está cumprindo, e ela envelhece bem.
--
-- Por isso o remédio dos três é o mesmo, e é uma auditoria: `scripts/smoke.mjs`
-- agora lê as chaves que as funções GRAVAM no estado e cobra que alguém as
-- leia — o cliente, outra função, ou uma suíte. Retorno de chamada fica de
-- fora, porque resposta se recalcula a cada chamada e não envelhece.
--
-- ────────────────────────────────────────────────────────────────────────────
-- AS PARTIDAS EM CURSO PERDEM O CAMPO TAMBÉM
--
-- Deixá-lo nas antigas e tirá-lo das novas faria duas formas de estado privado
-- conviverem sem motivo — e a próxima pessoa a ler uma partida velha
-- encontraria exatamente a pergunta que esta migração existe para apagar.
-- ════════════════════════════════════════════════════════════════════════════

update public.match_private_state mps
   set data = mps.data - 'planos'
  from public.matches m
 where m.id = mps.match_id and m.game_key = 'dominio' and mps.data ? 'planos';

-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.dominio_start(p_room uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  sala      public.rooms;
  mapa      jsonb;
  semente   bigint;
  assentos  smallint[];
  n         int;
  ters      text[];
  objs      jsonb;
  ordem_obj text[];
  nova      public.matches;
  estado    jsonb;
  donos     jsonb := '{}'::jsonb;
  exercitos jsonb := '{}'::jsonb;
  jogadores jsonb := '[]'::jsonb;
  iniciais  int;
  modo      text;
  qual_mapa text;
  i         int;
  assento   smallint;
  dono_id   uuid;
  cor_dele  text;
  sobra     int;
  alvo      text;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into sala from public.rooms r where r.id = p_room;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if sala.host_id <> auth.uid() then raise exception 'NOT_HOST'; end if;
  if sala.game_key <> 'dominio' then raise exception 'WRONG_GAME'; end if;
  if exists (select 1 from public.matches m
              where m.room_id = p_room and m.status = 'running') then
    raise exception 'ALREADY_RUNNING';
  end if;

  /* O MAPA SAI DO MODO, e é a única coisa que o Relâmpago muda de verdade.

     A leitura do mapa se mudou de lugar: ela ficava aqui em cima, antes de
     'modo' existir. Agora depende dele. */
  modo := coalesce(sala.settings ->> 'modo', 'campanha');
  if modo not in ('campanha', 'classico', 'relampago') then modo := 'campanha'; end if;

  qual_mapa := case modo when 'relampago' then 'relampago' else 'vantara' end;
  select data into mapa from public.game_themes gt where gt.id = qual_mapa;
  if mapa is null then raise exception 'NO_MAP'; end if;

  select array_agg(rm.seat order by rm.seat) into assentos
    from public.room_members rm
   where rm.room_id = p_room and rm.seat is not null;
  n := coalesce(array_length(assentos, 1), 0);
  if n < 3 then raise exception 'NEED_THREE'; end if;
  if n > 6 then raise exception 'TOO_MANY'; end if;

  semente := (random() * 9223372036854775806)::bigint;
  iniciais := case n when 3 then 35 when 4 then 30 when 5 then 25 else 20 end;

  /* O MODO PASSA A VALER. Ele era gravado no estado e não era lido por nada —
     configuração decorativa, que é pior que configuração nenhuma porque promete
     o que não cumpre.

     Campanha é o padrão recomendado pelo PRD (§6.5) e o que conserta os dois
     piores problemas do WAR: a partida que não acaba e quem é eliminado cedo
     assistindo uma hora. Doze rodadas, vitória por pontos, e ninguém sai.

     Relâmpago NÃO está aqui de propósito: o PRD o define com um mapa de 24
     territórios, e esse mapa não existe. Oferecer um "Relâmpago" que joga igual
     à Campanha seria mentir no rótulo. */

  -- territórios embaralhados e repartidos em rodízio, 1 exército em cada
  select public.shuffle_text(array_agg(t ->> 'id'), semente) into ters
    from jsonb_array_elements(mapa -> 'territorios') t;

  for i in 1..array_length(ters, 1) loop
    assento := assentos[((i - 1) % n) + 1];
    donos := donos || jsonb_build_object(ters[i], assento);
    exercitos := exercitos || jsonb_build_object(ters[i], 1);
  end loop;

  -- O resto do exército inicial cai sozinho nos próprios territórios. O WAR de
  -- mesa faz isso um a um, e são dez minutos em que ninguém decide nada.
  for i in 1..n loop
    assento := assentos[i];
    sobra := iniciais - (
      select count(*) from jsonb_each_text(donos) d where d.value::smallint = assento
    );
    while sobra > 0 loop
      select d.key into alvo
        from jsonb_each_text(donos) d
       where d.value::smallint = assento
       order by md5(semente::text || ':' || sobra::text || d.key)
       limit 1;
      exercitos := jsonb_set(exercitos, array[alvo],
        to_jsonb((exercitos ->> alvo)::int + 1));
      sobra := sobra - 1;
    end loop;
  end loop;

  -- objetivos: embaralhados e distribuídos SEM repetir
  select jsonb_agg(value) into objs from jsonb_array_elements(mapa -> 'objetivos');
  select public.shuffle_text(array_agg(g::text), semente + 991) into ordem_obj
    from generate_series(0, jsonb_array_length(objs) - 1) g;

  insert into public.matches (room_id, game_key, seed, public_state, turn_deadline)
  values (p_room, 'dominio', semente, '{}'::jsonb, now() + interval '120 seconds')
  returning * into nova;

  for i in 1..n loop
    assento := assentos[i];

    select rm.user_id, coalesce(rm.color, 'grafite')
      into dono_id, cor_dele
      from public.room_members rm
     where rm.room_id = p_room and rm.seat = assento;

    insert into public.match_players (match_id, user_id, seat)
    values (nova.id, dono_id, assento);

    insert into public.match_private_state (match_id, user_id, data)
    values (
      nova.id, dono_id,
      jsonb_build_object(
        'objetivo', objs -> (ordem_obj[i])::int,
        'cartas', '[]'::jsonb
      )
    );

    jogadores := jogadores || jsonb_build_array(jsonb_build_object(
      'seat', assento,
      'userId', dono_id,
      'cor', cor_dele,
      'cartas', 0,
      'ativo', true
    ));
  end loop;

  estado := jsonb_build_object(
    'map', qual_mapa,
    'mode', modo,
    -- doze rodadas na Campanha; no Clássico só o objetivo encerra
    /* Doze rodadas na Campanha, DEZ no Relâmpago, nenhuma no Clássico.
       O Relâmpago é a Campanha num mapa menor e com duas rodadas a menos: as
       regras são as mesmas, e é isso que o faz caber numa hora sem virar outro
       jogo (PRD 04 §5.2). */
    'rodadaFinal', case modo
                     when 'campanha'  then 12
                     when 'relampago' then 10
                     else null
                   end,
    'pontos', '{}'::jsonb,
    'tomou', '{}'::jsonb,
    'atacou', '{}'::jsonb,
    'aguardando', '{}'::jsonb,
    'round', 1,
    'phase', 'reforco',
    'turnSeat', assentos[1],
    'donos', donos,
    'exercitos', exercitos,
    'players', jogadores,
    'eliminados', '[]'::jsonb,
    'conquistou', false,
    'remanejou', false,
    'trocas', 0,
    'rolls', 0,
    'seq', 0,
    'log', '[]'::jsonb,
    'vencedor', null
  );
  estado := jsonb_set(estado, '{reforcoLeft}',
    to_jsonb(public.dominio_reforco(mapa, estado, assentos[1])));

  update public.matches set public_state = estado where id = nova.id;
  update public.rooms set status = 'playing' where id = p_room;

  return jsonb_build_object(
    'id', nova.id, 'status', nova.status,
    'turn_deadline', nova.turn_deadline, 'started_at', nova.started_at,
    'public_state', estado
  );
end;
$function$;

revoke all on function public.dominio_start(uuid) from public, anon;
grant execute on function public.dominio_start(uuid) to authenticated;
