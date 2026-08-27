-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0044 · dois consertos nas máquinas, achados pelo teste
--
-- 1. `jsonb_set` COM PAI AUSENTE NÃO CRIA NADA.
--
--    `letreiro_prepara_bots` escrevia os tempos assim:
--
--        jsonb_set(public_state, array['botTempos', <uuid>], tempos, true)
--
--    e o quarto argumento (`create_missing`) cria só o ÚLTIMO elemento do
--    caminho. Como `botTempos` não existia no estado, o caminho tinha um degrau
--    faltando no meio — e `jsonb_set` devolveu o estado INTACTO, sem erro
--    nenhum. Provado em uma linha:
--
--        select jsonb_set('{"a":1}', array['novo','chave'], '[]', true)
--        → {"a": 1}
--
--    Consequência em jogo: a barra de tensão da máquina ficaria em zero a
--    partida inteira, e ninguém saberia por quê. O conserto é criar o objeto
--    vazio antes do laço.
--
-- 2. `remover_bot` NÃO ACHAVA A MÁQUINA PELO ASSENTO.
--
--    O parâmetro é `smallint` e a chamada vem do PostgREST como número JSON,
--    que chega como `integer`. Sem uma sobrecarga de `integer`, o PostgREST não
--    resolve a função — e a resposta é 404, que o cliente lê como "não existe".
--
--    Em vez de criar uma sobrecarga (duas funções para a mesma coisa é como se
--    ganha uma divergência), o parâmetro passa a ser `int`. É o mesmo domínio
--    de valor — o assento vai de 0 a 7 — e resolve de primeira.
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists public.remover_bot(uuid, smallint);

create or replace function public.remover_bot(p_room uuid, p_seat int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sala public.rooms;
  alvo uuid;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into sala from public.rooms r where r.id = p_room;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if sala.host_id <> auth.uid() then raise exception 'NOT_HOST'; end if;
  if sala.status <> 'lobby' then raise exception 'MATCH_IN_PROGRESS'; end if;

  select rm.user_id into alvo
    from public.room_members rm
    join public.profiles p on p.id = rm.user_id
   where rm.room_id = p_room and rm.seat = p_seat::smallint and p.is_bot;
  -- só máquina sai por aqui: dispensar gente é `leave_room`, e é decisão dela
  if alvo is null then raise exception 'NOT_A_BOT'; end if;

  delete from public.room_members where room_id = p_room and user_id = alvo;
end;
$$;

revoke all on function public.remover_bot(uuid, int) from public, anon, authenticated;
grant execute on function public.remover_bot(uuid, int) to authenticated;

-- ── e os tempos passam a ser gravados de verdade ───────────────────────────

create or replace function public.letreiro_prepara_bots(p_match uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  partida public.matches;
  linha   record;
  lista   jsonb;
  quantos int := 0;
  segundos int;
begin
  select * into partida from public.matches m where m.id = p_match;
  if not found then return 0; end if;
  segundos := coalesce((partida.public_state ->> 'seconds')::int, 180);

  /* O OBJETO VAZIO PRIMEIRO. Sem esta linha, `jsonb_set` no caminho
     {botTempos, <uuid>} devolve o estado intacto e em silêncio, porque
     `create_missing` cria só o último degrau do caminho. */
  update public.matches
     set public_state = public_state || jsonb_build_object('botTempos', '{}'::jsonb)
   where id = p_match
     and jsonb_typeof(public_state -> 'botTempos') is distinct from 'object';
     -- `is distinct from` e não `is null`: se a chave existir como JSON null,
     -- `->` devolve 'null'::jsonb, que NÃO é NULL de SQL — e o objeto nunca
     -- seria criado. É a mesma pegadinha que quebrou o `dossie_sweep`.

  for linha in
    select mp.user_id, coalesce(rm.bot_nivel, 'medio') as nivel
      from public.match_players mp
      join public.profiles p on p.id = mp.user_id
      left join public.room_members rm
        on rm.room_id = partida.room_id and rm.user_id = mp.user_id
     where mp.match_id = p_match and p.is_bot
  loop
    -- a semente de cada máquina é a da partida mais o id dela: duas máquinas
    -- na mesma mesa acham palavras diferentes, e a mesma máquina na mesma
    -- partida acha sempre as mesmas
    lista := public.letreiro_bot_palavras(
      partida.board_id,
      partida.seed + ('x' || substr(md5(linha.user_id::text), 1, 6))::bit(24)::bigint,
      linha.nivel,
      segundos
    );

    update public.match_private_state
       set data = jsonb_build_object('words', lista, 'bot', true)
     where match_id = p_match and user_id = linha.user_id;

    /* E SÓ OS TEMPOS VÃO PARA O ESTADO PÚBLICO.
       A barra de tensão precisa mostrar QUANTAS a máquina já achou, e o
       cliente não pode ler o estado privado dela — nem deve. Então o público
       recebe apenas a lista de instantes de descoberta, sem uma palavra.

       É exatamente a mesma informação que a contagem de uma pessoa dá: quantas,
       nunca quais. E resolve sem processo rodando ao lado — o cliente conta
       quantos instantes já passaram. */
    update public.matches
       set public_state = jsonb_set(
             public_state,
             array['botTempos', linha.user_id::text],
             (select coalesce(jsonb_agg((w ->> 'em')::int order by (w ->> 'em')::int), '[]'::jsonb)
                from jsonb_array_elements(lista) w),
             true
           )
     where id = p_match;

    quantos := quantos + 1;
  end loop;

  return quantos;
end;
$$;

revoke all on function public.letreiro_prepara_bots(uuid) from public, anon, authenticated;
