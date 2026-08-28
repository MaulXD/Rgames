-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0062 · a agressão de cada nível sai do meio do turno e vira tabela
--
-- Os três números que DEFINEM o nível do Domínio estavam escondidos no meio de
-- `dominio_bot_turno`, entre o reforço e o ataque:
--
--     teto   := case nivel when 'facil' then 2 ...
--     margem := case nivel when 'facil' then 2 ...
--     vezes  := case nivel when 'facil' then 3 ...
--
-- Escondidos ali, a única forma de testá-los era jogar uma partida e medir o
-- resultado. E foi o que o teste fazia — comparando territórios tomados por
-- turno entre duas partidas de sessenta turnos. O problema: uma partida é uma
-- amostra de um. Em três execuções seguidas o mesmo teste mediu 0,50 contra
-- 3,17; depois 1,63 contra 4,32; depois 1,79 contra 2,26 — e nessa última
-- reprovou, porque o dado foi bom para a tranquila.
--
-- Teste que reprova por sorte do dado é pior que teste nenhum: ele ensina a
-- ignorar a saída vermelha.
--
-- É a mesma lição que a Metrópole já tinha dado em 0055, onde patrimônio final e
-- caixa final mediram a coisa errada duas vezes. A regra que sobrou das duas:
-- CONFERE-SE A DECISÃO ONDE ELA MORA, e o comportamento observado vira relatório.
--
-- Então os três números viram uma tabela com nome, e o teste lê a tabela.
-- O que continua sendo testado na mesa é o que a política GARANTE, e não o que
-- ela costuma dar: a tranquila ataca no máximo duas vezes por turno, então ela
-- nunca toma mais de dois territórios num turno. Isso é um teto, não uma média —
-- e teto não depende de dado.
-- ════════════════════════════════════════════════════════════════════════════

/**
 * O quanto cada nível arrisca, em três números.
 *
 *   margem  quanta vantagem ela exige para atacar. `força >= defesa + margem`,
 *           onde força é exercitos-1. Em paridade o atacante leva vantagem
 *           (três dados contra dois), e é por isso que a impiedosa ataca com
 *           margem zero e a tranquila não.
 *   teto    quantos ataques ela faz num turno.
 *   vezes   até quantos assaltos ela aguenta num ataque antes de desistir.
 */
create or replace function public.dominio_bot_agressao(p_nivel text)
returns table (t_margem int, t_teto int, t_vezes int)
language sql
immutable
as $$
  select
    case p_nivel when 'facil' then 2 when 'medio' then 1 else 0 end,
    case p_nivel when 'facil' then 2 when 'medio' then 5 else 12 end,
    case p_nivel when 'facil' then 3 when 'medio' then 8 else 12 end;
$$;

revoke all on function public.dominio_bot_agressao(text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.dominio_bot_turno(p_match uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  est      jsonb;
  mapa     jsonb;
  semente  bigint;
  assento     smallint;
  quem     uuid;
  nivel    text;
  seq      int;
  acoes    int := 0;

  -- reforço
  resta    int;
  alvo     text;
  rascunho jsonb;
  plano    jsonb;
  n        int;
  cartas   jsonb;
  n_cartas int;
  i int; j int; k int;
  trocou   boolean;

  -- ataque
  de       text;
  para     text;
  forca    int;
  defesa   int;
  margem   int;
  vezes    int;
  teto     int;
  saida    jsonb;
  tentou   int := 0;

  -- remanejo
  fonte    text;
  destino  text;
  quanto   int;
begin
  select m.public_state, m.seed into est, semente
    from public.matches m
   where m.id = p_match and m.game_key = 'dominio' and m.status = 'running'
   for update;
  if not found then return 0; end if;

  assento := (est ->> 'turnSeat')::smallint;
  select data into mapa from public.game_themes gt where gt.id = (est ->> 'map');

  select mp.user_id into quem
    from public.match_players mp
   where mp.match_id = p_match and mp.seat = assento;
  if quem is null then return 0; end if;

  -- é máquina mesmo? jogar no lugar de gente é o pior bug possível aqui
  if not exists (select 1 from public.profiles p where p.id = quem and p.is_bot) then
    return 0;
  end if;

  select coalesce(rm.bot_nivel, 'medio') into nivel
    from public.matches m
    join public.room_members rm on rm.room_id = m.room_id and rm.user_id = quem
   where m.id = p_match;
  nivel := coalesce(nivel, 'medio');
  seq := coalesce((est ->> 'seq')::int, 0);

  /* ── 1. CARTA ────────────────────────────────────────────────────────────
     Quem tem cinco é OBRIGADO a trocar antes de reforçar — `dominio_reforcar`
     estoura MUST_TRADE. Fora disso, é escolha: guardar vale mais porque o
     próximo valor de troca é maior, mas guardar demais é exército parado.

     O TRIO É ACHADO TENTANDO. A regra do que fecha trio (três iguais, três
     diferentes, dois com coringa) vive dentro de `dominio_trocar_como`, e
     reescrevê-la aqui seria a divergência silenciosa que este arquivo todo
     existe para evitar. Então a máquina oferece um trio e ouve o "não" — no
     máximo dez tentativas, porque a mão tem no máximo cinco cartas. */
  select coalesce(jsonb_array_length(coalesce(mps.data -> 'cartas', '[]'::jsonb)), 0)
    into n_cartas
    from public.match_private_state mps
   where mps.match_id = p_match and mps.user_id = quem;

  if n_cartas >= 3 and (
       n_cartas >= 5                                        -- obrigatório
       or nivel = 'dificil'                                 -- troca sempre que pode
       or (nivel = 'medio' and n_cartas >= 4)
     ) then
    trocou := false;
    for i in 0 .. n_cartas - 3 loop
      exit when trocou;
      for j in i + 1 .. n_cartas - 2 loop
        exit when trocou;
        for k in j + 1 .. n_cartas - 1 loop
          begin
            perform public.dominio_trocar_como(assento, p_match, array[i, j, k]);
            trocou := true;
            acoes := acoes + 1;
            exit;
          exception when others then
            -- trio inválido é resposta esperada; qualquer outro erro é bug meu
            if sqlerrm not in
               ('BAD_COMBO', 'NEED_THREE_CARDS', 'CARD_NOT_HELD', 'REPEATED_INDEX') then
              raise;
            end if;
          end;
        end loop;
      end loop;
    end loop;
    select public_state into est from public.matches where id = p_match;
  end if;

  /* ── 2. REFORÇO ──────────────────────────────────────────────
     A máquina decide EXÉRCITO POR EXÉRCITO num rascunho, e só depois executa —
     uma chamada por território, não uma por exército. As duas coisas importam:

     Decidir um por um é o que faz a distribuição sair sozinha, sem regra de
     rateio: a nota de um território CAI quando ele recebe (o `- v.meus`), então
     o segundo exército pode ir para outro lugar. E a impiedosa concentra sem
     precisar de regra nova, porque o bônus de continente (+40) segura a escolha
     no mesmo território até valer a pena sair.

     Executar agrupado é pelo REGISTRO. `dominio_log` guarda 80 linhas; uma
     máquina com doze exércitos escreveria doze linhas de "reforcou X com 1" e
     empurraria para fora tudo que aconteceu antes. O registro é como a pessoa
     descobre o que a máquina fez — afogar o registro é apagar o adversario.

     A NOTA, por nível:
       tranquila  só ruído, e sobre TODOS os territórios dela. Reforçar o
                  interior é o erro mais comum de quem está aprendendo, e é
                  exatamente o erro que ela deve cometer.
       firme      ameaça pesa 2, exército próprio pesa -1: ela vai onde dói
       impiedosa  o mesmo, mais 40 quando o continente está a um ou dois
                  territórios de fechar. É assim que se ganha um WAR — não
                  tomando território solto no meio do mapa. */
  resta := coalesce((est ->> 'reforcoLeft')::int, 0);
  if resta > 0 then
    rascunho := est;
    plano := '{}'::jsonb;

    for n in 1 .. resta loop
      if nivel = 'facil' then
        select v.ter into alvo
          from public.dominio_bot_visao(mapa, rascunho, assento) v
         order by public.dominio_ruido(semente, assento, seq + n, v.ter) desc
         limit 1;
      else
        select v.ter into alvo
          from public.dominio_bot_visao(mapa, rascunho, assento) v
         where v.frentes > 0
         order by
           v.ameaca * 2 - v.meus
           + case when nivel = 'dificil' and v.quase between 1 and 2 then 40 else 0 end
           + public.dominio_ruido(semente, assento, seq + n, v.ter) / 400.0 desc
         limit 1;
        -- sem fronteira nenhuma (o mapa todo é dela): cai em qualquer um
        if alvo is null then
          select v.ter into alvo
            from public.dominio_bot_visao(mapa, rascunho, assento) v
           order by public.dominio_ruido(semente, assento, seq + n, v.ter) desc
           limit 1;
        end if;
      end if;
      exit when alvo is null;

      rascunho := jsonb_set(rascunho, array['exercitos', alvo],
        to_jsonb((rascunho -> 'exercitos' ->> alvo)::int + 1));
      plano := jsonb_set(plano, array[alvo],
        to_jsonb(coalesce((plano ->> alvo)::int, 0) + 1), true);
    end loop;

    for alvo, quanto in select key, value::int from jsonb_each_text(plano) loop
      perform public.dominio_reforcar_como(assento, p_match, alvo, quanto);
      acoes := acoes + 1;
    end loop;
    select public_state into est from public.matches where id = p_match;
  end if;

  /* ── 3. ATAQUE ───────────────────────────────────────────────────────────
     Enquanto houver ataque que valha, ataca. O que "valha" quer dizer:

       tranquila  força >= defesa + 2, no máximo 2 ataques, 3 assaltos cada
       firme      força >= defesa + 1, no máximo 5 ataques, até 8 assaltos
       impiedosa  força >= defesa,     no máximo 12 ataques, até 12 assaltos

     `força` é exercitos[de] - 1, porque um exército nunca sai do território.
     Em paridade o atacante leva vantagem (três dados contra dois), e é por isso
     que a impiedosa ataca em paridade e a tranquila não. */
  select t_teto, t_margem, t_vezes into teto, margem, vezes
    from public.dominio_bot_agressao(nivel);

  while tentou < teto loop
    exit when est ->> 'phase' <> 'ataque';

    /* OS APELIDOS NÃO PODEM SE CHAMAR `para` NEM `def`: em PL/pgSQL nome de
       variável e apelido de subconsulta vivem no MESMO espaço, e foi assim que
       `met_bankrupt` estourou 42702 em 0032. `viz` e `nviz` não colidem com
       nada declarado aqui. */
    de := null;
    select v.ter, x.viz, v.meus - 1, x.nviz
      into de, para, forca, defesa
      from public.dominio_bot_visao(mapa, est, assento) v
      cross join lateral (
        select w as viz, (est -> 'exercitos' ->> w)::int as nviz
          from unnest(public.dominio_vizinhos(mapa, v.ter)) w
         where coalesce((est -> 'donos' ->> w)::smallint, -1) <> assento
      ) x
     where v.meus >= 2
       and v.meus - 1 >= x.nviz + margem
     order by
       -- primeiro a maior vantagem, e entre iguais o alvo mais barato
       (v.meus - 1 - x.nviz) desc,
       x.nviz,
       public.dominio_ruido(semente, assento, seq + tentou, v.ter || x.viz) desc
     limit 1;

    exit when de is null;

    saida := public.dominio_atacar_como(assento, p_match, de, para, least(vezes, forca));
    acoes := acoes + 1;
    tentou := tentou + 1;

    -- a máquina pode ter cumprido o objetivo no meio do turno
    if coalesce((saida ->> 'venceu')::boolean, false) then
      return acoes;
    end if;

    select public_state into est from public.matches where id = p_match;

    /* O AVANÇO depois da conquista. Território recém-tomado fica com UM
       exército, e um exército é um convite. A tranquila deixa o convite de pé;
       as outras duas consolidam. */
    if est -> 'avanco' is not null and est -> 'avanco' <> 'null'::jsonb then
      perform public.dominio_avancar_como(
        assento, p_match,
        case when nivel = 'facil' then 0 else (est -> 'avanco' ->> 'max')::int end
      );
      acoes := acoes + 1;
      select public_state into est from public.matches where id = p_match;
    end if;
  end loop;

  /* ── 4. REMANEJO ─────────────────────────────────────────────────────────
     Um movimento por turno, entre territórios ligados. A máquina tira do
     interior mais gordo e põe na fronteira mais ameaçada — que é o único
     movimento de remanejo que sempre faz sentido. A tranquila não remaneja:
     esquecer o remanejo é o segundo erro mais comum de quem está aprendendo. */
  if nivel <> 'facil'
     and not coalesce((est ->> 'remanejou')::boolean, false)
     and est ->> 'phase' in ('ataque', 'remanejo')
     and (est -> 'avanco' is null or est -> 'avanco' = 'null'::jsonb) then

    select v.ter into fonte
      from public.dominio_bot_visao(mapa, est, assento) v
     where v.frentes = 0 and v.meus >= 2
     order by v.meus desc, public.dominio_ruido(semente, assento, seq, v.ter) desc
     limit 1;

    if fonte is not null then
      select v.ter into destino
        from public.dominio_bot_visao(mapa, est, assento) v
       where v.frentes > 0
         and v.ter <> fonte
         and public.dominio_conectado(mapa, est, assento, fonte, v.ter)
       order by v.ameaca - v.meus desc, public.dominio_ruido(semente, assento, seq, v.ter) desc
       limit 1;

      if destino is not null then
        quanto := (est -> 'exercitos' ->> fonte)::int - 1;
        if quanto >= 1 then
          perform public.dominio_remanejar_como(assento, p_match, fonte, destino, quanto);
          acoes := acoes + 1;
        end if;
      end if;
    end if;
  end if;

  -- ── 5. PASSA A VEZ ───────────────────────────────────────────────────────
  perform public.dominio_encerrar_turno_como(assento, p_match);
  acoes := acoes + 1;

  return acoes;
end;
$function$;

revoke all on function public.dominio_bot_turno(uuid) from public, anon, authenticated;
