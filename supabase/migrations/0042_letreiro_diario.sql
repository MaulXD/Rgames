-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0042 · o desafio diário do Letreiro
--
-- Uma grade por dia, a mesma para todo mundo, três minutos, uma tentativa só.
-- É o modo que faz alguém abrir o site num dia em que não tem com quem jogar —
-- e o que dá assunto no dia seguinte, porque todos jogaram a MESMA grade.
--
-- AS QUATRO DECISÕES QUE MOLDAM ISTO
--
-- 1. A GRADE DO DIA É DERIVADA DA DATA, não sorteada e guardada. Não há tabela
--    de "grade de amanhã", não há tarefa que precisa rodar à meia-noite, e não
--    há como o dia 12 não ter grade porque um cron falhou. `md5(data)` escolhe
--    entre as 901 grades de 4×4 e pronto — o dia 12 tem a mesma grade daqui a
--    um ano, e isso é uma propriedade e não um defeito: dá para conferir.
--
-- 2. UMA TENTATIVA. A chave primária é (dia, jogador), então a segunda
--    tentativa não é recusada por uma checagem que eu possa esquecer: ela é
--    impossível de gravar. E o relógio começa quando a pessoa ABRE, não quando
--    a grade é gerada, senão quem entra às 23h50 teria dez minutos.
--
-- 3. QUATRO POR QUATRO, sempre. O 5×5 existe e é bom, mas comparar placar entre
--    grades de tamanhos diferentes não significa nada — e um placar do dia que
--    não significa nada é pior que placar nenhum.
--
-- 4. O PLACAR É PÚBLICO, as palavras não. Você vê quanto o outro fez e não o
--    que ele achou, porque ver as palavras dele tiraria a graça de quem ainda
--    vai jogar no mesmo dia. As palavras só aparecem para o dono, e depois do
--    fim aparecem para todos — mas aí o dia já virou.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.letreiro_diario (
  dia         date        not null,
  user_id     uuid        not null references auth.users on delete cascade,
  board_id    bigint      not null references public.letreiro_boards,
  comecou_em  timestamptz not null default now(),
  termina_em  timestamptz not null,
  fechado     boolean     not null default false,
  score       integer     not null default 0,
  -- as palavras aceitas, com caminho e pontos, como no `match_private_state`
  palavras    jsonb       not null default '[]'::jsonb,
  primary key (dia, user_id)
);

create index if not exists letreiro_diario_placar_idx
  on public.letreiro_diario (dia, score desc);

alter table public.letreiro_diario enable row level security;

/* A LEITURA É EM DUAS CAMADAS, e é o que permite placar público com palavra
   privada:

   · a tabela inteira NÃO é legível pelo cliente (nenhuma policy de select)
   · o placar sai por uma função `security definer` que devolve só nome, cor e
     pontos
   · as palavras saem por outra função, e só as do próprio dono

   Dar `select` na tabela e confiar numa policy de coluna seria frágil: `grant
   select on tabela` concede TODAS as colunas, e essa lição já custou uma
   correção neste projeto (ver 0013). */
revoke all on public.letreiro_diario from anon, authenticated;

-- ── a grade do dia ─────────────────────────────────────────────────────────

/**
 * Qual grade cai no dia `p_dia`. Determinística, e de propósito.
 *
 * `md5` da data dá 32 hex; os primeiros 8 viram um inteiro sem sinal, e o resto
 * da divisão pelo número de grades de 4×4 escolhe. Sem tabela, sem cron, sem
 * "amanhã não tem grade porque a tarefa falhou".
 */
create or replace function public.letreiro_grade_do_dia(p_dia date)
returns public.letreiro_boards
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  quantas int;
  qual    public.letreiro_boards;
begin
  select count(*) into quantas from public.letreiro_boards b where b.size = 4;
  if quantas = 0 then raise exception 'NO_BOARDS'; end if;

  select * into qual
    from public.letreiro_boards b
   where b.size = 4
   order by b.id
  offset (('x' || substr(md5('mesa:diario:' || p_dia::text), 1, 8))::bit(32)::bigint
          % quantas)
   limit 1;

  return qual;
end;
$$;

revoke all on function public.letreiro_grade_do_dia(date) from public, anon, authenticated;

-- ── abrir o desafio de hoje ────────────────────────────────────────────────

/**
 * Abre (ou reabre) o desafio de hoje para quem chamou.
 *
 * Chamar duas vezes no mesmo dia devolve a MESMA rodada, com o mesmo relógio —
 * recarregar a página não dá tempo extra, e fechar a aba não perde a tentativa.
 * Se já estava fechada, devolve o resultado.
 *
 * O que volta nunca inclui o gabarito. A grade, sim: ela é a mesma para todo
 * mundo, então não há o que esconder nela.
 */
create or replace function public.letreiro_diario_abrir()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  hoje    date := (now() at time zone 'America/Sao_Paulo')::date;
  grade   public.letreiro_boards;
  linha   public.letreiro_diario;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into linha from public.letreiro_diario d
   where d.dia = hoje and d.user_id = auth.uid();

  if not found then
    grade := public.letreiro_grade_do_dia(hoje);
    insert into public.letreiro_diario (dia, user_id, board_id, termina_em)
    values (hoje, auth.uid(), grade.id, now() + interval '180 seconds')
    on conflict (dia, user_id) do nothing
    returning * into linha;

    -- corrida de dois cliques: se o outro inseriu, lê o que ficou
    if linha.dia is null then
      select * into linha from public.letreiro_diario d
       where d.dia = hoje and d.user_id = auth.uid();
    end if;
  end if;

  select * into grade from public.letreiro_boards b where b.id = linha.board_id;

  return jsonb_build_object(
    'dia', hoje,
    'grid', to_jsonb(grade.grid),
    'size', grade.size,
    'termina_em', linha.termina_em,
    'fechado', linha.fechado,
    'score', linha.score,
    'palavras', linha.palavras,
    'comuns', coalesce(array_length(grade.comuns, 1), 0),
    'maxComum', coalesce(grade.max_score_comum, grade.max_score)
  );
end;
$$;

revoke all on function public.letreiro_diario_abrir() from public, anon, authenticated;
grant execute on function public.letreiro_diario_abrir() to authenticated;

-- ── submeter uma palavra ───────────────────────────────────────────────────

/**
 * Submete uma palavra no desafio de hoje.
 *
 * Reusa `letreiro_path_ok` e `letreiro_pontos_palavra` — as mesmas funções da
 * partida com amigos, já testadas. Uma segunda implementação da validação de
 * caminho seria a garantia de que uma das duas ficaria diferente.
 */
create or replace function public.letreiro_diario_submeter(p_word text, p_path text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  hoje    date := (now() at time zone 'America/Sao_Paulo')::date;
  linha   public.letreiro_diario;
  grade   public.letreiro_boards;
  palavra text;
  ja      boolean;
  pts     int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into linha from public.letreiro_diario d
   where d.dia = hoje and d.user_id = auth.uid() for update;
  if not found then raise exception 'NOT_OPEN'; end if;
  if linha.fechado then raise exception 'ALREADY_CLOSED'; end if;
  if now() > linha.termina_em then raise exception 'TIME_OVER'; end if;

  palavra := upper(translate(
    p_word,
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'
  ));
  if char_length(palavra) < 3 then
    return jsonb_build_object('ok', false, 'reason', 'SHORT');
  end if;

  select exists (
    select 1 from jsonb_array_elements(linha.palavras) w where w ->> 'w' = palavra
  ) into ja;
  if ja then return jsonb_build_object('ok', false, 'reason', 'REPEATED'); end if;

  select * into grade from public.letreiro_boards b where b.id = linha.board_id;

  if not (grade.solution ? palavra) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_A_WORD');
  end if;
  if not public.letreiro_path_ok(grade.grid, p_path, palavra, grade.size) then
    return jsonb_build_object('ok', false, 'reason', 'BAD_PATH');
  end if;

  pts := public.letreiro_pontos_palavra(palavra);

  update public.letreiro_diario
     set palavras = palavras || jsonb_build_object(
           'w', palavra, 'p', p_path, 'pts', pts,
           'comum', coalesce(grade.comuns, '{}') @> array[palavra]),
         score = score + pts
   where dia = hoje and user_id = auth.uid();

  return jsonb_build_object('ok', true, 'pts', pts);
end;
$$;

revoke all on function public.letreiro_diario_submeter(text, text) from public, anon, authenticated;
grant execute on function public.letreiro_diario_submeter(text, text) to authenticated;

-- ── fechar ─────────────────────────────────────────────────────────────────

/**
 * Fecha a rodada de hoje e credita XP.
 *
 * Idempotente: chamar duas vezes não credita duas vezes, porque o `fechado`
 * é conferido antes. Pode ser chamada pela pessoa (o botão "encerrar") ou pelo
 * relógio ter estourado — o resultado é o mesmo, e não depende de a aba estar
 * aberta na hora.
 *
 * NÃO há anulação de palavra repetida aqui: no desafio diário todos jogam a
 * mesma grade, e anular o que dois acharam anularia quase tudo. O placar do dia
 * mede o que você achou, não o que você achou sozinho.
 */
create or replace function public.letreiro_diario_fechar()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  hoje  date := (now() at time zone 'America/Sao_Paulo')::date;
  linha public.letreiro_diario;
  grade public.letreiro_boards;
  maior text;
  quantas int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into linha from public.letreiro_diario d
   where d.dia = hoje and d.user_id = auth.uid() for update;
  if not found then raise exception 'NOT_OPEN'; end if;

  if not linha.fechado then
    update public.letreiro_diario set fechado = true
     where dia = hoje and user_id = auth.uid();

    quantas := jsonb_array_length(linha.palavras);
    select w ->> 'w' into maior
      from jsonb_array_elements(linha.palavras) w
     order by (w ->> 'pts')::int desc limit 1;

    -- o mesmo cofre de XP da partida com amigos, com um crédito mais modesto:
    -- o diário é solo, e solo não vale o mesmo que ganhar de gente
    perform public.dar_xp(
      auth.uid(),
      greatest(10, linha.score / 4),
      jsonb_build_object('palavras', quantas, 'diarios', 1),
      case when quantas >= 15 then array['dia-cheio'] else '{}'::text[] end
    );
    if maior is not null then
      perform public.melhor_palavra(auth.uid(), maior,
        public.letreiro_pontos_palavra(maior));
    end if;
  end if;

  select * into grade from public.letreiro_boards b where b.id = linha.board_id;

  return jsonb_build_object(
    'dia', hoje,
    'score', linha.score,
    'palavras', linha.palavras,
    'maxComum', coalesce(grade.max_score_comum, grade.max_score),
    'comuns', coalesce(array_length(grade.comuns, 1), 0),
    -- as cinco melhores COMUNS que a pessoa não achou: o mesmo critério da
    -- revelação da partida, porque mostrar "aalênio" é inútil nos dois casos
    'perdidas', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'w', coalesce(d.word, k.palavra),
               'p', k.caminho,
               'pts', public.letreiro_pontos_palavra(k.palavra)
             ) order by public.letreiro_pontos_palavra(k.palavra) desc), '[]'::jsonb)
        from (
          select c as palavra, grade.solution ->> c as caminho
            from unnest(coalesce(grade.comuns, '{}')) c
           where not exists (
             select 1 from jsonb_array_elements(linha.palavras) w where w ->> 'w' = c
           )
           order by public.letreiro_pontos_palavra(c) desc, c
           limit 5
        ) k
        left join public.dict_pt d on d.norm = k.palavra
    )
  );
end;
$$;

revoke all on function public.letreiro_diario_fechar() from public, anon, authenticated;
grant execute on function public.letreiro_diario_fechar() to authenticated;

-- ── o placar do dia ────────────────────────────────────────────────────────

/**
 * O placar de um dia. Público, e sem as palavras de ninguém.
 *
 * Só entra quem FECHOU: mostrar placar de quem está jogando agora seria mostrar
 * um número que muda, e pior, contar para quem ainda não jogou que dá para
 * fazer mais.
 */
create or replace function public.letreiro_diario_placar(p_dia date default null)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(x order by x.score desc, x.quando), '[]'::jsonb)
    from (
      select p.display_name as nome,
             p.avatar,
             d.score,
             jsonb_array_length(d.palavras) as palavras,
             d.comecou_em as quando,
             d.user_id = auth.uid() as eu
        from public.letreiro_diario d
        join public.profiles p on p.id = d.user_id
       where d.dia = coalesce(p_dia, (now() at time zone 'America/Sao_Paulo')::date)
         and d.fechado
       order by d.score desc
       limit 50
    ) x;
$$;

revoke all on function public.letreiro_diario_placar(date) from public, anon, authenticated;
grant execute on function public.letreiro_diario_placar(date) to authenticated;

-- ── faxina: fecha quem estourou o relógio e não voltou ─────────────────────

/**
 * Fecha as rodadas cujo tempo acabou.
 *
 * Sem isso, quem fecha a aba no meio nunca aparece no placar do dia — e o
 * placar do dia com gente faltando é um placar errado. O XP não é creditado
 * aqui de propósito: `dar_xp` precisa saber de quem é, e a faxina roda sem
 * usuário. Quem voltar e chamar `fechar` recebe; quem não voltar aparece no
 * placar sem o XP, que é a troca certa.
 */
create or replace function public.letreiro_diario_sweep()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  quantos int;
begin
  update public.letreiro_diario
     set fechado = true
   where not fechado and termina_em < now() - interval '10 seconds';
  get diagnostics quantos = row_count;
  return quantos;
end;
$$;

revoke all on function public.letreiro_diario_sweep() from public, anon, authenticated;

select cron.schedule('letreiro-diario-sweep', '* * * * *',
                     $cron$select public.letreiro_diario_sweep();$cron$)
where not exists (select 1 from cron.job where jobname = 'letreiro-diario-sweep');
