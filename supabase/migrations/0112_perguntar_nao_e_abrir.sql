-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0112 · perguntar qual é a grade do dia não é abrir o dia
--
-- 0110 fez a grade do dia parar de ser recalculada e passar a ficar escrita. O
-- efeito colateral: `letreiro_grade_do_dia` escreve, e escrever numa função que
-- se chama "qual é a grade de tal dia" faz a PERGUNTA virar um ato.
--
-- Medido logo depois: a suíte pergunta a grade de sessenta dias seguidos para
-- conferir que o sorteio não repete, e deixou sessenta dias fixados em que
-- ninguém jogou — cada um segurando uma grade viva para sempre, porque a chave
-- estrangeira impede que ela seja apagada.
--
-- ────────────────────────────────────────────────────────────────────────────
-- QUEM FIXA O DIA É QUEM ABRE O DESAFIO
--
-- A promessa é "todo mundo joga a mesma grade no dia", e ela nasce quando a
-- PRIMEIRA PESSOA abre — não quando alguém pergunta. Separar as duas em duas
-- funções é a diferença entre uma consulta e uma decisão:
--
--   letreiro_grade_do_dia   consulta. Devolve o que está escrito, ou o que o
--                           sorteio daria. Não escreve nada, e volta a ser
--                           `stable`.
--   letreiro_fixa_o_dia     decisão. Escreve, e só `letreiro_diario_abrir` a
--                           chama.
--
-- A corrida de duas primeiras aberturas simultâneas continua resolvida no
-- `on conflict do nothing` seguido de releitura, e agora ela mora no único
-- lugar onde uma corrida dessas pode acontecer.
--
-- ────────────────────────────────────────────────────────────────────────────
-- E OS DIAS QUE A SUÍTE FIXOU SAEM
--
-- Sessenta e um dias, nenhum com uma linha de `letreiro_diario` — ninguém abriu,
-- ninguém jogou, e o único efeito deles era segurar sessenta e uma grades que a
-- regeração do pool não podia tocar. Dia em que alguém jogou fica.
-- ════════════════════════════════════════════════════════════════════════════

/**
 * A grade daquele dia — a PERGUNTA, sem efeito.
 *
 * Devolve o que está escrito. Se ninguém abriu ainda, devolve o que o sorteio
 * daria — e a resposta é boa até alguém abrir, que é quando ela se torna
 * definitiva.
 */
create or replace function public.letreiro_grade_do_dia(p_dia date)
returns public.letreiro_boards
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  quantas   int;
  escolhida bigint;
  qual      public.letreiro_boards;
begin
  select d.board_id into escolhida from public.letreiro_dia d where d.dia = p_dia;

  if escolhida is null then
    select count(*) into quantas
      from public.letreiro_boards b where b.size = 4 and b.usavel;
    if quantas = 0 then raise exception 'NO_BOARDS'; end if;

    select b.id into escolhida
      from public.letreiro_boards b
     where b.size = 4 and b.usavel
     order by b.id
    offset (('x' || substr(md5('mesa:diario:' || p_dia::text), 1, 8))::bit(32)::bigint
            % quantas)
     limit 1;
  end if;

  select * into qual from public.letreiro_boards b where b.id = escolhida;
  return qual;
end;
$$;

revoke all on function public.letreiro_grade_do_dia(date) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

/**
 * A grade daquele dia — a DECISÃO, escrita.
 *
 * A primeira pessoa a abrir o desafio decide, e todo mundo depois lê. Se outra
 * chegou primeiro no mesmo instante, vale a dela: a grade do dia é UMA, e quem
 * a fixou não importa.
 */
create or replace function public.letreiro_fixa_o_dia(p_dia date)
returns public.letreiro_boards
language plpgsql
security definer
set search_path = public
as $$
declare
  escolhida bigint;
  qual      public.letreiro_boards;
begin
  qual := public.letreiro_grade_do_dia(p_dia);
  if qual.id is null then raise exception 'NO_BOARDS'; end if;

  insert into public.letreiro_dia (dia, board_id)
  values (p_dia, qual.id)
  on conflict (dia) do nothing;

  select d.board_id into escolhida from public.letreiro_dia d where d.dia = p_dia;
  if escolhida is distinct from qual.id then
    select * into qual from public.letreiro_boards b where b.id = escolhida;
  end if;
  return qual;
end;
$$;

revoke all on function public.letreiro_fixa_o_dia(date) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

/* Quem abre o desafio é quem fixa o dia. É a única troca aqui. */
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
    grade := public.letreiro_fixa_o_dia(hoje);
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

revoke all on function public.letreiro_diario_abrir() from public, anon;
grant execute on function public.letreiro_diario_abrir() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

/* Os dias que a pergunta fixou sem ninguém jogar. */
delete from public.letreiro_dia d
 where not exists (
   select 1 from public.letreiro_diario x where x.dia = d.dia
 );
