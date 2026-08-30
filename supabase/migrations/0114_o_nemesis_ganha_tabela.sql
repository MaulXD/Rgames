-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0114 · o Nêmesis, a quarta estatística
--
-- "Contra quem você mais anula palavra." Era a única das quatro do PRD 02 §6.9
-- que não tinha sido construída, e a nota de lá dizia exatamente por quê:
--
--   "precisa de contagem POR PAR de jogadores. Isso não cabe em
--    `profiles.stats`: seria um objeto que cresce sem teto com o id de todo
--    mundo com quem você já jogou, dentro de um jsonb lido inteiro a cada
--    carregamento de perfil — e guardar id de terceiro no registro de alguém é
--    uma decisão de privacidade que merece uma tabela e uma política de RLS,
--    não um campo que apareceu de lado."
--
-- Esta é a tabela, e esta é a política.
--
-- ────────────────────────────────────────────────────────────────────────────
-- DUAS LINHAS POR CHOQUE, UMA PARA CADA LADO
--
-- Guardar `(menor, maior)` uma vez só economizaria metade das linhas e
-- estragaria a política: para eu ler o meu nêmesis eu teria de poder ler linhas
-- em que apareço como `maior` — e aí a mesma política me deixa ler o de quem
-- estiver do outro lado. Duas linhas, cada uma legível por uma pessoa só, é o
-- que faz "só o seu" ser verdade no banco e não na consulta.
--
-- ────────────────────────────────────────────────────────────────────────────
-- MÁQUINA NÃO É NÊMESIS
--
-- Numa partida solo, quem mais tromba com você é o Nestor, porque ele joga
-- todas as rodadas. O número seria verdadeiro e a frase seria vazia: nêmesis é
-- uma piada entre pessoas, e a máquina não está na piada.
--
-- ────────────────────────────────────────────────────────────────────────────
-- E SÓ CONTA ONDE TROMBAR CUSTA
--
-- Na regra gananciosa ninguém anula nada: as duas pessoas ficam com os pontos,
-- e "anular" não aconteceu. Na clássica a palavra vale zero para os dois; na
-- terceira, quem achou sozinho ganha um a mais — nos dois casos trombar custa,
-- e é isso que a estatística conta.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.letreiro_nemesis (
  eu    uuid not null references auth.users on delete cascade,
  outro uuid not null references auth.users on delete cascade,
  vezes int  not null default 0,
  visto timestamptz not null default now(),
  primary key (eu, outro)
);

alter table public.letreiro_nemesis enable row level security;
revoke all on table public.letreiro_nemesis from public, anon, authenticated;

/* SÓ O SEU, e nem isso pela porta da frente.

   A política existe como cinto de segurança: quem lê de verdade é
   `letreiro_nemesis_meu`, que é `security definer` e devolve nome em vez de id.
   Sem a política, um `grant` acidental amanhã abriria a tabela inteira; com
   ela, o pior caso continua sendo "cada um vê a própria coluna". */
drop policy if exists "nemesis: só o meu" on public.letreiro_nemesis;
create policy "nemesis: só o meu" on public.letreiro_nemesis
  for select using (eu = auth.uid());

comment on table public.letreiro_nemesis is
  'Quantas vezes cada par de pessoas trombou na mesma palavra do Letreiro. Duas '
  'linhas por par, uma para cada lado, porque a política de leitura é por dono — '
  'uma linha só forçaria a política a deixar cada um ler a contagem do outro. '
  'Máquina não entra: nêmesis é piada entre gente.';

-- ─────────────────────────────────────────────────────────────────────────────

/**
 * O seu nêmesis: com quem você mais trombou, e quantas vezes.
 *
 * Devolve NOME e não id. O id de terceiro não precisa atravessar a rede para a
 * frase "você e o Tonho se anulam há 14 palavras" existir — e o que não
 * atravessa não vaza.
 *
 * Nulo enquanto não houver ninguém: uma pessoa que só jogou sozinha não tem
 * nêmesis, e inventar um seria pior que a lacuna.
 */
create or replace function public.letreiro_nemesis_meu()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when n.outro is null then null else jsonb_build_object(
    'nome',   p.display_name,
    'avatar', p.avatar,
    'vezes',  n.vezes
  ) end
    from public.letreiro_nemesis n
    join public.profiles p on p.id = n.outro
   where n.eu = auth.uid()
   order by n.vezes desc, p.display_name
   limit 1;
$$;

revoke all on function public.letreiro_nemesis_meu() from public, anon;
grant execute on function public.letreiro_nemesis_meu() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.letreiro_score_bruto(p_match uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  partida   public.matches;
  tabuleiro public.letreiro_boards;
  regra     text;
  achadas   jsonb;
  perdidas  jsonb;
begin
  select * into partida from public.matches m where m.id = p_match for update;
  if not found or partida.status <> 'running' then return; end if;

  select * into tabuleiro from public.letreiro_boards b where b.id = partida.board_id;

  regra := coalesce(
    partida.public_state ->> 'scoring',
    (select r.settings ->> 'anulacao' from public.rooms r where r.id = partida.room_id),
    'classica'
  );

  drop table if exists _sub;
  drop table if exists _quantos;

  create temp table _sub on commit drop as
  select mps.user_id, (w ->> 'w') as palavra, (w ->> 'p') as caminho
    from public.match_private_state mps
    cross join lateral jsonb_array_elements(mps.data -> 'words') w
   where mps.match_id = p_match;

  delete from _sub s
   where not (tabuleiro.solution ? s.palavra)
      or not public.letreiro_path_ok(tabuleiro.grid, s.caminho, s.palavra, tabuleiro.size);

  create temp table _quantos on commit drop as
  select palavra, count(distinct user_id)::int quantos from _sub group by palavra;

  /* ── O NÊMESIS ──────────────────────────────────────────────────────────
     Com quem você mais tromba na mesma palavra. A conta cabe aqui porque é
     aqui que `_sub` existe: quem achou o quê, já validado contra o gabarito e
     contra o caminho.

     O auto-encontro de `_sub` com ela mesma em usuários diferentes JÁ é a
     definição de choque — não precisa de `_quantos`, que só conta o mesmo de
     outro jeito.

     Duas linhas por choque, uma para cada lado, e é a política de leitura que
     pede isso: guardar `(menor, maior)` uma vez só obrigaria a política a me
     deixar ler linhas em que eu sou o `maior`, e aí a mesma política deixaria
     alguém ler a minha.

     Máquina fora. Numa partida solo quem mais tromba com você é o Nestor,
     porque ele joga todas as rodadas — o número seria verdadeiro e a frase
     seria vazia.

     E só onde trombar CUSTA: na regra gananciosa as duas pessoas ficam com os
     pontos, e "anular" não aconteceu. */
  if regra <> 'gananciosa' then
    insert into public.letreiro_nemesis (eu, outro, vezes, visto)
    select a.user_id, b.user_id, count(*)::int, now()
      from _sub a
      join _sub b on b.palavra = a.palavra and b.user_id <> a.user_id
      join public.profiles pa on pa.id = a.user_id and not pa.is_bot
      join public.profiles pb on pb.id = b.user_id and not pb.is_bot
     group by a.user_id, b.user_id
    on conflict (eu, outro) do update
       set vezes = public.letreiro_nemesis.vezes + excluded.vezes,
           visto = now();
  end if;

  update public.match_players mp
     set score = coalesce(t.total, 0)
    from (
      select s.user_id,
             sum(
               case regra
                 when 'classica' then
                   case when q.quantos > 1 then 0
                        else public.letreiro_pontos_palavra(s.palavra) end
                 when 'gananciosa' then
                   public.letreiro_pontos_palavra(s.palavra)
                 else
                   public.letreiro_pontos_palavra(s.palavra)
                   + case when q.quantos = 1 then 1 else 0 end
               end
             )::int total
        from _sub s
        join _quantos q on q.palavra = s.palavra
       group by s.user_id
    ) t
   where mp.match_id = p_match and mp.user_id = t.user_id;

  select jsonb_object_agg(user_id::text, itens) into achadas
    from (
      select s.user_id,
             jsonb_agg(jsonb_build_object(
               'w',   coalesce(d.word, s.palavra),
               'p',   s.caminho,
               'pts', public.letreiro_pontos_palavra(s.palavra),
               'dup', q.quantos > 1,
               'comum', coalesce(tabuleiro.comuns, '{}') @> array[s.palavra]
             ) order by public.letreiro_pontos_palavra(s.palavra) desc, s.palavra) itens
        from _sub s
        join _quantos q on q.palavra = s.palavra
        left join public.dict_pt d on d.norm = s.palavra
       group by s.user_id
    ) x;

  -- AS CINCO MELHORES QUE NINGUÉM ACHOU, entre as COMUNS. Antes vinham do
  -- gabarito inteiro, e o jogo terminava exibindo palavra que ninguém conhece.
  select jsonb_agg(jsonb_build_object(
           'w',   coalesce(d.word, k.palavra),
           'p',   k.caminho,
           'pts', public.letreiro_pontos_palavra(k.palavra)
         ) order by public.letreiro_pontos_palavra(k.palavra))
    into perdidas
    from (
      select c as palavra, tabuleiro.solution ->> c as caminho
        from unnest(coalesce(tabuleiro.comuns, '{}')) c
       where c not in (select palavra from _sub)
       order by public.letreiro_pontos_palavra(c) desc, c
       limit 5
    ) k
    left join public.dict_pt d on d.norm = k.palavra;

  update public.matches
     set status = 'finished', ended_at = now(), version = version + 1,
         public_state = public_state || jsonb_build_object(
           'phase',     'reveal',
           'found',     coalesce(achadas, '{}'::jsonb),
           'missed',    coalesce(perdidas, '[]'::jsonb),
           -- o aproveitamento passa a ser sobre o que dá para achar de verdade
           'maxScore',  coalesce(tabuleiro.max_score_comum, tabuleiro.max_score),
           'wordCount', coalesce(array_length(tabuleiro.comuns, 1), tabuleiro.word_count),
           'scores', (
             select coalesce(jsonb_object_agg(user_id::text, score), '{}'::jsonb)
               from public.match_players where match_id = p_match
           )
         )
   where id = p_match;

  update public.rooms set status = 'lobby' where id = partida.room_id;
end;
$function$;

revoke all on function public.letreiro_score_bruto(uuid) from public, anon, authenticated;
