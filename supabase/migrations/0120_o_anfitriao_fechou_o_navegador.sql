-- 0120 — O ANFITRIÃO FECHOU O NAVEGADOR
--
-- Critério de aceite do PRD 00 §12: "Host fecha o navegador → outro jogador
-- vira host em < 5s, sem interação".
--
-- ELE NÃO ESTAVA CONSTRUÍDO, e o buraco fica no lugar mais caro possível: na
-- PRIMEIRA coisa que um grupo faz. Desde 0002 a passagem de anfitrião acontece
-- dentro de `leave_room` — quer dizer, quando a pessoa APERTA sair. Fechar a
-- aba não avisa ninguém, e a sala fica com um anfitrião que não existe: só ele
-- pode começar a partida, mudar as regras da casa e chamar máquina. Cinco
-- pessoas esperando, nenhuma delas podendo fazer nada, até a sala expirar.
--
-- ────────────────────────────────────────────────────────────────────────────
-- DUAS TRANCAS, E CADA UMA TAPA O BURACO DA OUTRA
--
-- O servidor não enxerga a presença do Realtime. Ele tem `last_seen_at`, que é
-- pulso — e pulso, sozinho, é uma medida grosseira: quem bate a cada trinta
-- segundos pode estar vivíssimo e com o registro trinta segundos velho. Uma
-- regra só de `last_seen_at` roubaria a sala de quem está sentado nela.
--
-- O cliente enxerga a presença do Realtime e sabe em segundos que o anfitrião
-- caiu — mas cliente não é autoridade neste projeto, e "eu vi que ele sumiu"
-- não pode ser prova suficiente para tomar a sala de alguém.
--
-- Então são as duas: o CLIENTE só pede quando a presença do Realtime diz que o
-- anfitrião saiu, e o SERVIDOR só concede se o pulso dele também estiver
-- vencido. Uma tranca é rápida e não é confiável; a outra é confiável e não é
-- rápida. Juntas dão as duas coisas.
--
-- ────────────────────────────────────────────────────────────────────────────
-- E O PULSO PASSA A SER DE DEZ SEGUNDOS
--
-- Com pulso de trinta, o menor limiar honesto seria uns setenta segundos — dois
-- pulsos perdidos e uma folga —, e "em menos de cinco" viraria "em menos de um
-- minuto e dez". Com pulso de dez, VINTE E CINCO segundos já são dois pulsos
-- perdidos com folga, e a espera real fica na casa dos segundos: o cliente pede
-- assim que o Realtime avisa, e o servidor concede assim que o pulso vence.
--
-- O custo é uma chamada trivial a cada dez segundos por pessoa no lobby, e só
-- no lobby. É barato pelo que compra.
--
-- ────────────────────────────────────────────────────────────────────────────
-- QUEM ASSUME É O MENOR ASSENTO QUE ESTÁ LÁ
--
-- Regra tola de propósito: não há nada a otimizar aqui, e uma regra que todo
-- mundo consegue prever é uma sala que ninguém acha que foi roubada. Máquina
-- nunca assume — ela não aperta botão nenhum, e uma sala com anfitrião de
-- silício é uma sala que não começa nunca.
--
-- E é IDEMPOTENTE de propósito: quatro pessoas podem pedir ao mesmo tempo, e as
-- quatro chegam ao mesmo assento. A que chegar primeiro muda a sala; as outras
-- três descobrem que já está feito e não desfazem nada.

create or replace function public.assumir_anfitriao(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  sala   public.rooms;
  antigo timestamptz;
  novo   uuid;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into sala from public.rooms where id = p_room for update;
  if not found then raise exception 'NO_ROOM'; end if;

  if not exists (
    select 1 from public.room_members
     where room_id = p_room and user_id = auth.uid()
  ) then raise exception 'NOT_A_MEMBER'; end if;

  -- já sou eu: nada a fazer, e não é erro
  if sala.host_id = auth.uid() then
    return jsonb_build_object('ok', false, 'motivo', 'JA_SOU', 'host', sala.host_id);
  end if;

  /* A TRANCA DO SERVIDOR. O anfitrião pode ter saído da sala (linha nenhuma) ou
     estar com o pulso vencido. Presente e batendo, ninguém toma nada. */
  select rm.last_seen_at into antigo
    from public.room_members rm
   where rm.room_id = p_room and rm.user_id = sala.host_id;

  if antigo is not null and antigo > now() - interval '25 seconds' then
    raise exception 'ANFITRIAO_PRESENTE';
  end if;

  /* O MENOR ASSENTO QUE ESTÁ LÁ, e gente. */
  select rm.user_id into novo
    from public.room_members rm
    join public.profiles p on p.id = rm.user_id
   where rm.room_id = p_room
     and rm.user_id is distinct from sala.host_id
     and rm.seat is not null
     and not p.is_bot
     and rm.last_seen_at > now() - interval '25 seconds'
   order by rm.seat
   limit 1;

  /* NINGUÉM VIVO NA SALA não é caso de erro: é sala vazia, e ela expira
     sozinha. Devolver "não deu" deixa a tela quieta em vez de piscar vermelho
     para quem está de saída. */
  if novo is null then
    return jsonb_build_object('ok', false, 'motivo', 'NINGUEM_PRESENTE', 'host', sala.host_id);
  end if;

  update public.rooms set host_id = novo where id = p_room;
  update public.room_members set role = 'player'
   where room_id = p_room and user_id = sala.host_id;
  update public.room_members set role = 'host'
   where room_id = p_room and user_id = novo;

  return jsonb_build_object('ok', true, 'host', novo);
end;
$$;

revoke all on function public.assumir_anfitriao(uuid) from public, anon, authenticated;
grant execute on function public.assumir_anfitriao(uuid) to authenticated, anon;
