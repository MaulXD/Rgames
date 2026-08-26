-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0010 · regras da casa
--
-- O servidor já lia `rooms.settings` para decidir duração e regra de anulação,
-- mas não havia caminho para o anfitrião escrever lá. Sem isso, todo mundo
-- joga Clássico com anulação clássica para sempre.
--
-- Vocabulário fechado no banco: chave desconhecida ou valor fora da lista é
-- recusado. Assim a interface não consegue inventar configuração.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.set_room_settings(p_room uuid, p_settings jsonb)
returns public.rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  sala   public.rooms;
  limpo  jsonb := '{}'::jsonb;
  modo   text;
  anul   text;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into sala from public.rooms where id = p_room;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if sala.host_id <> auth.uid() then
    raise exception 'NOT_HOST';
  end if;
  if sala.status <> 'lobby' then
    raise exception 'MATCH_IN_PROGRESS';
  end if;

  modo := coalesce(p_settings ->> 'modo', sala.settings ->> 'modo', 'classico');
  anul := coalesce(p_settings ->> 'anulacao', sala.settings ->> 'anulacao', 'classica');

  if modo not in ('classico', 'relampago') then
    raise exception 'BAD_MODE';
  end if;
  if anul not in ('classica', 'gananciosa', 'bonus') then
    raise exception 'BAD_SCORING';
  end if;

  limpo := jsonb_build_object('modo', modo, 'anulacao', anul);

  update public.rooms set settings = limpo where id = p_room
  returning * into sala;

  return sala;
end;
$$;

revoke all on function public.set_room_settings(uuid, jsonb) from public;
grant execute on function public.set_room_settings(uuid, jsonb) to authenticated;
