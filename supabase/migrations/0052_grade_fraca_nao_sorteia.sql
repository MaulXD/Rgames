-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0052 · grade fraca deixa de ser sorteada, mas não é apagada
--
-- Depois do corte de 0051, 127 das 1801 grades ficaram com poucas palavras
-- comuns — uma grade 4×4 com 12 comuns rende uma revelação vazia e uma máquina
-- sem nada para achar.
--
-- APAGAR NÃO DÁ, e o banco disse isso na cara: `matches.board_id` referencia
-- `letreiro_boards`, então partida encerrada segura a grade dela. E está certo:
-- a conferência de uma partida antiga precisa do gabarito que valeu naquela
-- noite. Uma tabela que apaga o passado para arrumar o presente é pior que uma
-- tabela com lixo.
--
-- Então a grade fraca não sai: ela deixa de ser SORTEÁVEL. `usavel` é a coluna,
-- e as duas escolhas de grade — a partida e o desafio diário — passam a
-- filtrar por ela.
--
-- E ISSO CONSERTA UM SEGUNDO PROBLEMA que eu ia ter. `letreiro_grade_do_dia`
-- escolhe por `offset (md5 do dia % quantas)`, então o conjunto de grades faz
-- parte da conta: apagar grade trocaria a grade de TODO dia passado, e o placar
-- do dia passaria a ser de um jogo que ninguém jogou. Com `usavel`, a conta
-- muda uma vez agora e para de mudar.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.letreiro_boards
  add column if not exists usavel boolean not null default true;

comment on column public.letreiro_boards.usavel is
  'Grade sorteável. Falso quando tem poucas palavras comuns — a revelação ficaria vazia. Grade não usável continua guardada porque partida antiga referencia ela.';

update public.letreiro_boards b
   set usavel = coalesce(array_length(b.comuns, 1), 0)
                >= case when b.size = 4 then 22 else 60 end;

create index if not exists letreiro_boards_usavel_idx
  on public.letreiro_boards (size, id) where usavel;

-- ═══════════════════════════════════════════════════════════════════════════
-- As duas funções abaixo foram GERADAS de `pg_get_functiondef` das definições
-- vivas (scripts/gera-letreiro-usavel.mjs), com UMA edição: o sorteio filtra
-- `usavel`, nos dois lugares — a contagem e a escolha. Se só um filtrasse, o
-- `offset` cairia fora da lista e a grade sairia nula.
--
-- Escrevi as duas à mão primeiro, e as duas estavam erradas: `letreiro_start`
-- devolve jsonb e não `public.matches`, e o corpo dela tem ALREADY_RUNNING e
-- chaves de estado que a minha não tinha. É a terceira vez neste projeto que
-- copiar do arquivo em vez do banco daria uma função errada — a regra agora tem
-- um gerador, e gerador não esquece.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── a partida sorteia só entre as usáveis ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.letreiro_start(p_room uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  sala      public.rooms;
  semente   bigint;
  tabuleiro public.letreiro_boards;
  segundos  int;
  tamanho   int;
  quantas   int;
  nova      public.matches;
  membro    record;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into sala from public.rooms r where r.id = p_room;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if sala.host_id <> auth.uid() then raise exception 'NOT_HOST'; end if;
  if sala.game_key <> 'letreiro' then raise exception 'WRONG_GAME'; end if;
  if exists (select 1 from public.matches m
              where m.room_id = p_room and m.status = 'running') then
    raise exception 'ALREADY_RUNNING';
  end if;

  tamanho := coalesce((sala.settings ->> 'tamanho')::int, 4);
  if tamanho not in (4, 5) then
    tamanho := 4;
  end if;

  -- grade maior pede mais tempo: 4×4 tem 16 letras, 5×5 tem 25
  segundos := case coalesce(sala.settings ->> 'modo', 'classico')
                when 'relampago' then (case tamanho when 5 then 90 else 60 end)
                else (case tamanho when 5 then 300 else 180 end)
              end;

  semente := (random() * 9223372036854775806)::bigint;

  select count(*) into quantas
    from public.letreiro_boards b where b.size = tamanho and b.usavel;
  if quantas = 0 then
    raise exception 'NO_BOARDS';
  end if;

  select * into tabuleiro
    from public.letreiro_boards b
   where b.size = tamanho and b.usavel
   order by b.id
  offset (semente % quantas)
   limit 1;

  insert into public.matches (room_id, game_key, seed, board_id, ends_at, public_state)
  values (
    p_room, 'letreiro', semente, tabuleiro.id,
    now() + make_interval(secs => segundos),
    jsonb_build_object(
      'phase', 'round',
      'grid', to_jsonb(tabuleiro.grid),
      'size', tabuleiro.size,
      'mode', coalesce(sala.settings ->> 'modo', 'classico'),
      'scoring', coalesce(sala.settings ->> 'anulacao', 'classica'),
      'seconds', segundos,
      'counts', '{}'::jsonb
    )
  )
  returning * into nova;

  for membro in
    select rm.user_id, rm.seat from public.room_members rm
     where rm.room_id = p_room and rm.seat is not null
  loop
    insert into public.match_players (match_id, user_id, seat)
    values (nova.id, membro.user_id, membro.seat) on conflict do nothing;
    insert into public.match_private_state (match_id, user_id, data)
    values (nova.id, membro.user_id, jsonb_build_object('words', '[]'::jsonb))
    on conflict do nothing;
  end loop;

  update public.rooms set status = 'playing' where id = p_room;

  -- as máquinas recebem a lista de palavras delas agora. Depois disto a
  -- apuração não sabe quem é gente e quem é máquina, e não precisa saber.
  perform public.letreiro_prepara_bots(nova.id);

  select * into nova from public.matches m where m.id = nova.id;

  return jsonb_build_object(
    'id', nova.id, 'status', nova.status, 'ends_at', nova.ends_at,
    'started_at', nova.started_at, 'public_state', nova.public_state
  );
end;
$function$;

-- ── e o desafio diário também ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.letreiro_grade_do_dia(p_dia date)
 RETURNS letreiro_boards
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  quantas int;
  qual    public.letreiro_boards;
begin
  select count(*) into quantas
    from public.letreiro_boards b where b.size = 4 and b.usavel;
  if quantas = 0 then raise exception 'NO_BOARDS'; end if;

  select * into qual
    from public.letreiro_boards b
   where b.size = 4 and b.usavel
   order by b.id
  offset (('x' || substr(md5('mesa:diario:' || p_dia::text), 1, 8))::bit(32)::bigint
          % quantas)
   limit 1;

  return qual;
end;
$function$;

revoke all on function public.letreiro_start(uuid) from public, anon, authenticated;
grant execute on function public.letreiro_start(uuid) to authenticated;
revoke all on function public.letreiro_grade_do_dia(date) from public, anon, authenticated;
