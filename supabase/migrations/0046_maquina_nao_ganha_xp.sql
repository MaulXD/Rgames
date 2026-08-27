-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0046 · máquina não ganha XP, nível, conquista nem recorde
--
-- `letreiro_premia` percorre `match_players` e dá XP a todos. Depois de 0043
-- isso passou a incluir as máquinas — e elas já acumularam:
--
--     Nestor     xp=1228  partidas=3  conquistas=[cem-palavras, primeira-palavra]
--     Guiomar    xp=836   partidas=3  melhor=NEGRA (13)
--
-- Três coisas erradas de uma vez. A máquina aparece em qualquer contagem de
-- gente; ela desbloqueia conquistas, que são recompensa por esforço que ela não
-- fez; e ela tem "melhor palavra da vida", que é uma frase sobre uma pessoa.
--
-- ONDE O CONSERTO VAI. Não em `letreiro_premia`, nem nas quatro funções de
-- prêmio: em `dar_xp` e `melhor_palavra`, que são o portão único por onde tudo
-- isso passa. Assim vale para os quatro jogos, para os prêmios que ainda vão
-- existir, e para qualquer coisa que eu esqueça. Corrigir nos quatro chamadores
-- é escolher esquecer no quinto.
--
-- E as funções continuam a NÃO estourar erro quando recebem uma máquina: quem
-- chama está premiando a mesa inteira, e a mesa tem máquina. Sair calado é o
-- comportamento certo aqui.
--
-- Os corpos abaixo são os de 0016, palavra por palavra. A única coisa nova é o
-- portão — um conserto que muda uma coisa muda uma coisa.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.dar_xp(
  p_user uuid,
  p_xp integer,
  p_somas jsonb default '{}'::jsonb,
  p_conquistas text[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  atual jsonb;
  chave text;
  novo  jsonb;
begin
  -- O PORTÃO
  if exists (select 1 from public.profiles p where p.id = p_user and p.is_bot) then
    return;
  end if;

  select coalesce(stats, '{}'::jsonb) into atual from public.profiles where id = p_user;
  if atual is null then
    return;
  end if;

  novo := atual
    || jsonb_build_object('xp', coalesce((atual ->> 'xp')::int, 0) + greatest(p_xp, 0));

  -- contadores acumulativos
  for chave in select jsonb_object_keys(p_somas) loop
    novo := novo || jsonb_build_object(
      chave,
      coalesce((atual ->> chave)::numeric, 0) + (p_somas ->> chave)::numeric
    );
  end loop;

  -- conquistas: união, sem repetir
  if array_length(p_conquistas, 1) is not null then
    novo := novo || jsonb_build_object(
      'conquistas',
      (
        select coalesce(jsonb_agg(distinct c), '[]'::jsonb)
          from (
            select jsonb_array_elements_text(coalesce(atual -> 'conquistas', '[]'::jsonb)) c
            union
            select unnest(p_conquistas)
          ) t
      )
    );
  end if;

  update public.profiles set stats = novo, updated_at = now() where id = p_user;
end;
$$;

revoke all on function public.dar_xp(uuid, integer, jsonb, text[]) from public, anon, authenticated;

create or replace function public.melhor_palavra(p_user uuid, p_word text, p_pts integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- "melhor palavra da vida" é uma frase sobre uma pessoa
  if exists (select 1 from public.profiles p where p.id = p_user and p.is_bot) then
    return;
  end if;

  update public.profiles
     set stats = stats || jsonb_build_object(
           'melhor', jsonb_build_object('w', p_word, 'pts', p_pts)
         ),
         updated_at = now()
   where id = p_user
     and coalesce((stats -> 'melhor' ->> 'pts')::int, -1) < p_pts;
end;
$$;

revoke all on function public.melhor_palavra(uuid, text, integer) from public, anon, authenticated;

-- ── e o que elas já acumularam volta ao zero ───────────────────────────────
-- Não é cosmético: `stats.partidas` alimenta contagem, e conquista de máquina
-- num placar futuro seria uma linha que ninguém consegue explicar.

update public.profiles
   set stats = '{}'::jsonb, updated_at = now()
 where is_bot and coalesce(stats, '{}'::jsonb) <> '{}'::jsonb;
