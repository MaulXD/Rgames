-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0094 · a palavra mais rara e o aproveitamento (PRD 02 §6.9)
--
-- O PRD pede quatro estatísticas, e a régua dele é boa: "não 'partidas
-- jogadas'; coisas que a pessoa quer contar para os amigos".
--
--   melhor palavra da vida    ✅ já existia
--   palavra mais rara         ✅ entra aqui
--   aproveitamento            ✅ entra aqui
--   nêmesis                   ✗  ver o porquê no fim deste comentário
--
-- ────────────────────────────────────────────────────────────────────────────
-- A PALAVRA MAIS RARA É ENTRE AS QUE O CORPUS CONHECE
--
-- `dict_pt.freq` é um POSTO, não uma contagem, e é NULO para a maior parte do
-- dicionário: a lista de frequência de fala cobre uma fração das 248.632
-- palavras. A leitura ingênua — "sem posto é a mais rara de todas" — faria a
-- estatística premiar exatamente o lixo:
--
--     3 letras, sem posto:  iia, auô, dzô, ijé
--     9 letras, sem posto:  ababalhar, ababangai, aaleniano
--
-- É o MESMO defeito que fez a revelação do Letreiro mostrar ONO, ADE, ADELE e
-- GATE, e que custou um corte por posto escalado por tamanho mais 327 nomes
-- curados para consertar. Ler `freq` errado uma vez foi descuido; ler errado
-- de novo, no mesmo jogo, na mesma coluna, seria não ter aprendido.
--
-- Sem posto, o corpus nunca ouviu a palavra. E palavra que ninguém diz não é
-- troféu — é ruído com cara de troféu. A mais rara é a de MAIOR posto ENTRE AS
-- QUE TÊM POSTO, e a frase que ela vira é boa: "MOSTARDA, a 41.208ª palavra
-- mais falada do português".
--
-- ────────────────────────────────────────────────────────────────────────────
-- O APROVEITAMENTO GUARDA A FRAÇÃO, NÃO A PORCENTAGEM
--
--     { melhorNum, melhorDen, pontos, teto }
--
-- e não `{ melhor: 42, media: 31 }`. Duas razões, e as duas já morderam este
-- projeto:
--
--   · média de porcentagens não é a porcentagem da soma. Guardando `pontos` e
--     `teto` de vida, a média sai exata; guardando percentuais arredondados,
--     ela erra e erra mais a cada rodada.
--
--   · é a regra do dinheiro, generalizada: divisão só no fim. `Math.ceil(1300 *
--     1.1)` dando 1431 contra 1430 do servidor já custou uma correção em todo o
--     projeto.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE O NÊMESIS NÃO ENTRA AGORA
--
-- "Contra quem você mais anula palavra" precisa de uma contagem POR PAR de
-- jogadores. Isso não cabe em `profiles.stats`: seria um objeto que cresce sem
-- teto com o id de todo mundo com quem você já jogou, dentro de um jsonb que é
-- lido inteiro a cada carregamento de perfil — e guardar id de terceiro no
-- registro de alguém é uma decisão de privacidade que merece uma tabela e uma
-- política de RLS, não um campo que apareceu de lado.
--
-- Entra quando tiver a tabela. Meia estatística com o dado no lugar errado é
-- pior que nenhuma, porque ela fica.
-- ════════════════════════════════════════════════════════════════════════════

/**
 * A palavra mais rara da vida de alguém, se esta for mais rara que a guardada.
 *
 * Mesmo formato e mesma disciplina de `melhor_palavra`: máquina não acumula
 * estatística, porque "a palavra mais rara que você já achou" é uma frase sobre
 * uma pessoa.
 */
create or replace function public.palavra_rara(p_user uuid, p_word text, p_posto int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.profiles p where p.id = p_user and p.is_bot) then
    return;
  end if;

  update public.profiles
     set stats = stats || jsonb_build_object(
           'rara', jsonb_build_object('w', p_word, 'posto', p_posto)
         ),
         updated_at = now()
   where id = p_user
     -- posto MAIOR é mais raro. O `-1` faz a primeira vez sempre gravar.
     and coalesce((stats -> 'rara' ->> 'posto')::int, -1) < p_posto;
end;
$$;

revoke all on function public.palavra_rara(uuid, text, int) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

/**
 * O aproveitamento de uma rodada: pontos sobre o teto da grade.
 *
 * Guarda a melhor rodada COMO FRAÇÃO e os totais de vida, nunca porcentagem
 * calculada. Quem divide é a tela, uma vez, no fim.
 */
create or replace function public.aproveitamento(p_user uuid, p_pontos int, p_teto int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  atual_num int;
  atual_den int;
begin
  if p_teto is null or p_teto <= 0 then return; end if;
  if exists (select 1 from public.profiles p where p.id = p_user and p.is_bot) then
    return;
  end if;

  select coalesce((stats -> 'aproveita' ->> 'melhorNum')::int, 0),
         coalesce((stats -> 'aproveita' ->> 'melhorDen')::int, 0)
    into atual_num, atual_den
    from public.profiles where id = p_user;

  update public.profiles
     set stats = stats || jsonb_build_object(
           'aproveita', jsonb_build_object(
             /* Compara fração com fração por MULTIPLICAÇÃO CRUZADA, e não
                dividindo: a/b > c/d vira a*d > c*b, tudo em inteiro. Dividir
                aqui traria ponto flutuante para dentro de uma comparação que
                decide um recorde — e recorde decidido por arredondamento é
                recorde que muda sozinho. */
             'melhorNum', case
               when atual_den = 0 or p_pontos::bigint * atual_den > atual_num::bigint * p_teto
               then p_pontos else atual_num end,
             'melhorDen', case
               when atual_den = 0 or p_pontos::bigint * atual_den > atual_num::bigint * p_teto
               then p_teto else atual_den end,
             'pontos', coalesce((stats -> 'aproveita' ->> 'pontos')::int, 0) + p_pontos,
             'teto', coalesce((stats -> 'aproveita' ->> 'teto')::int, 0) + p_teto
           )
         ),
         updated_at = now()
   where id = p_user;
end;
$$;

revoke all on function public.aproveitamento(uuid, int, int) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.letreiro_premia(p_match uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  j          record;
  tabuleiro  public.letreiro_boards;
  conquistas text[];
  palavras   int;
  maior      int;
  tem_qu     boolean;
  melhor_w   text;
  melhor_p   int;
  rara_w     text;
  rara_f     int;
  total_vida int;
begin
  select b.* into tabuleiro
    from public.letreiro_boards b
    join public.matches m on m.board_id = b.id
   where m.id = p_match;

  for j in
    select mp.user_id, mp.score, mps.data -> 'words' as words
      from public.match_players mp
      left join public.match_private_state mps
        on mps.match_id = mp.match_id and mps.user_id = mp.user_id
     where mp.match_id = p_match
  loop
    conquistas := array[]::text[];
    palavras := coalesce(jsonb_array_length(j.words), 0);

    select coalesce(max(char_length(w ->> 'w')), 0),
           coalesce(bool_or((w ->> 'w') like '%QU%'), false)
      into maior, tem_qu
      from jsonb_array_elements(coalesce(j.words, '[]'::jsonb)) w;

    melhor_w := null;
    melhor_p := null;
    select (w ->> 'w'), (w ->> 'pts')::int
      into melhor_w, melhor_p
      from jsonb_array_elements(coalesce(j.words, '[]'::jsonb)) w
     order by (w ->> 'pts')::int desc
     limit 1;

    if palavras >= 1 then
      conquistas := array_append(conquistas, 'primeira-palavra');
    end if;
    if maior >= 8 then
      conquistas := array_append(conquistas, 'oito-letras');
    end if;
    if tem_qu then
      conquistas := array_append(conquistas, 'palavra-qu');
    end if;
    if coalesce(tabuleiro.max_score, 0) > 0 and j.score * 2 >= tabuleiro.max_score then
      conquistas := array_append(conquistas, 'meia-grade');
    end if;

    perform public.dar_xp(
      j.user_id,
      coalesce(j.score, 0),
      jsonb_build_object('partidas', 1, 'palavras', palavras),
      conquistas
    );

    if melhor_w is not null then
      perform public.melhor_palavra(j.user_id, melhor_w, melhor_p);
    end if;

    /* A PALAVRA MAIS RARA, entre as que o corpus CONHECE.

       `dict_pt.freq` é um POSTO, não uma contagem — e é nulo para a maior parte
       do dicionário, porque a lista de frequência de fala cobre uma fração das
       248 mil palavras. Tratar nulo como "raríssima" faria a estatística
       premiar exatamente o lixo: flexão obscura que ninguém diz, que é o mesmo
       defeito que fez a revelação mostrar ONO, ADE e ADELE.

       Sem posto, o corpus nunca ouviu a palavra. E palavra que ninguém diz não
       é troféu — é ruído com cara de troféu. */
    rara_w := null;
    rara_f := null;
    select d.word, d.freq into rara_w, rara_f
      from jsonb_array_elements(coalesce(j.words, '[]'::jsonb)) w
      join public.dict_pt d on d.norm = (w ->> 'w')
     where d.freq is not null
     order by d.freq desc
     limit 1;

    if rara_w is not null then
      perform public.palavra_rara(j.user_id, rara_w, rara_f);
    end if;

    /* O APROVEITAMENTO: seus pontos sobre o teto da grade. */
    if coalesce(tabuleiro.max_score, 0) > 0 then
      perform public.aproveitamento(j.user_id, coalesce(j.score, 0), tabuleiro.max_score);
    end if;

    select coalesce((stats ->> 'palavras')::int, 0) into total_vida
      from public.profiles where id = j.user_id;

    if total_vida >= 500 then
      perform public.dar_xp(j.user_id, 0, '{}'::jsonb, array['cem-palavras', 'quinhentas-palavras']);
    elsif total_vida >= 100 then
      perform public.dar_xp(j.user_id, 0, '{}'::jsonb, array['cem-palavras']);
    end if;
  end loop;
end;
$function$;

revoke all on function public.letreiro_premia(uuid) from public, anon, authenticated;
