-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0080 · `botTempos` passa a usar `jsonb_poe`
--
-- A auditoria de 0079 achou dois casos de escrita em dois níveis sobre chave que
-- pode não existir. Um deles era `counts` em `letreiro_submit` — e essa chave
-- está no estado inicial de `letreiro_start`, então entrou na lista das
-- garantidas.
--
-- O outro era este: `botTempos` em `letreiro_prepara_bots`. Ele estava CORRETO —
-- 0044 consertou o problema criando o objeto vazio num `update` logo antes. Mas
-- a correção morava a dez linhas de distância do risco, e a auditoria não tinha
-- como enxergar isso.
--
-- Duas opções: abrir exceção na auditoria para esta função, ou fazer a função
-- carregar a garantia dentro dela. A segunda é melhor por um motivo simples:
-- exceção numa auditoria é dívida que ninguém revisita, e a próxima pessoa a
-- mexer aqui não vai ler 0044.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.letreiro_prepara_bots(p_match uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  /* O OBJETO VAZIO NÃO PRECISA MAIS SER CRIADO À MÃO.

     Antes daqui havia um `update` só para garantir que `botTempos` existisse,
     porque `jsonb_set` com pai ausente devolve o estado intacto e em silêncio.
     Funcionava — e obrigava quem lesse a função a entender POR QUE aquele update
     estava ali, o que é a mesma coisa que confiar num comentário.

     `jsonb_poe` carrega a garantia dentro do nome, e a auditoria de
     scripts/smoke.mjs deixa de precisar de exceção para esta função. */

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
       set public_state = public.jsonb_poe(
             public_state, 'botTempos', linha.user_id::text,
             (select coalesce(jsonb_agg((w ->> 'em')::int order by (w ->> 'em')::int), '[]'::jsonb)
                from jsonb_array_elements(lista) w)
           )
     where id = p_match;

    quantos := quantos + 1;
  end loop;

  return quantos;
end;
$function$;

revoke all on function public.letreiro_prepara_bots(uuid) from public, anon, authenticated;
