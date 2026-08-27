-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0048 · o cérebro da máquina no Domínio
--
-- O Domínio pede três jogadores. Sem máquina, não existe partida solo — e
-- juntar três pessoas ao mesmo tempo é a coisa mais difícil de um site de jogo
-- de tabuleiro. Este arquivo é o que faz o Domínio ser jogável sozinho.
--
-- A MÁQUINA JOGA PELAS FUNÇÕES DE 0047, e isso é o ponto todo. Ela chama
-- `dominio_atacar_como`, `dominio_reforcar_como`, `dominio_trocar_como` — as
-- MESMAS que uma pessoa chama, com a mesma matemática de dados, o mesmo bônus
-- de carta de território, a mesma herança da mão de quem foi eliminado, a mesma
-- virada de rodada da Campanha. Não existe uma regra de máquina em lugar
-- nenhum. Se uma regra mudar, muda para os dois.
--
-- ─────────────────────────────────────────────────────────────────────────
-- O RITMO, que é a decisão de projeto mais importante aqui.
--
-- O caminho óbvio era: quando a pessoa encerra o turno, o servidor joga o turno
-- das três máquinas ali mesmo e devolve o estado final. Funciona, é uma
-- transação só — e é UM JOGO PIOR. O mapa dá um salto: seis territórios
-- mudaram de cor, dois exércitos seus desapareceram, e a pessoa não viu nada
-- acontecer. Num jogo de tabuleiro, ver o adversário jogar É metade do jogo.
--
-- Então a máquina FICA NA VEZ, e existe um RPC — `dominio_tocar` — que joga
-- exatamente UM turno de máquina. Quem chama é o cliente, quando quer, depois
-- do tempo de respiro que ele escolher. O servidor confere que é vez de uma
-- máquina e nada mais: o cliente controla o RITMO, nunca o RESULTADO.
--
-- Três coisas boas vieram junto:
--   · nada roda no servidor sem alguém olhando — zero processo de fundo;
--   · a mesa com três máquinas gasta três chamadas curtas em vez de uma longa;
--   · e `dominio_sweep` continua sendo a rede de segurança: se ninguém está com
--     a aba aberta, o relógio da máquina estoura e a faxina joga o turno dela.
--     A partida nunca trava esperando uma máquina.
--
-- ─────────────────────────────────────────────────────────────────────────
-- COMO ELA PENSA, e por que ela erra de propósito.
--
-- Uma máquina que joga perfeito não é adversário, é parede. Os três níveis não
-- mudam a informação que ela tem — ela nunca vê carta de ninguém, nem objetivo
-- de ninguém, nem o dado antes de rolar. Mudam só o quanto ela é BOA:
--
--   tranquila  reforça no lugar errado (inclusive no interior, onde não serve
--              para nada), só ataca com dois de vantagem, desiste em três
--              assaltos, e nunca remaneja
--   firme      reforça na fronteira ameaçada, ataca com um de vantagem,
--              remaneja para onde dói
--   impiedosa  concentra reforço no continente que está quase fechando, ataca
--              em paridade, e vai até o fim do assalto
--
-- E o desempate nunca é `random()`: é md5 de (semente, assento, sequência,
-- território). Determinístico, sem viés, e a mesma lição de 0038 — LCG com
-- módulo 2^31 lida pelos bits baixos fez duas de seis cartas nunca saírem.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── ruído determinístico ───────────────────────────────────────────────────

/**
 * Um número de 0 a 999, estável para a mesma pergunta e sem viés.
 *
 * Serve de desempate: quando dois territórios têm a mesma nota, a máquina não
 * pode escolher sempre o primeiro em ordem alfabética — jogar contra alguém que
 * reforça sempre a Aurélia primeiro é jogar contra uma tabela.
 */
create or replace function public.dominio_ruido(
  p_semente bigint, p_seat smallint, p_seq int, p_chave text
)
returns int
language sql
immutable
as $$
  select ('x' || substr(
    md5(p_semente::text || ':' || p_seat::text || ':' || p_seq::text || ':' || p_chave),
    1, 6))::bit(24)::int % 1000;
$$;

revoke all on function public.dominio_ruido(bigint, smallint, int, text)
  from public, anon, authenticated;

-- ── o que a máquina vê do mapa ─────────────────────────────────────────────

/**
 * Cada território da máquina, com o que importa para decidir:
 *   meus     exércitos que ela tem ali
 *   ameaca   soma dos exércitos inimigos vizinhos
 *   frentes  quantos vizinhos são de outro
 *   quase    quantos territórios faltam para ela fechar o continente daquele
 *            território (0 = já é dela inteiro; alto = longe)
 *
 * `quase` é o que transforma reforço em estratégia. Continente fechado dá bônus
 * de exército toda rodada, e é assim que se ganha um WAR — não tomando
 * território solto no meio do mapa.
 */
create or replace function public.dominio_bot_visao(
  p_mapa jsonb, p_est jsonb, p_seat smallint
)
returns table (ter text, meus int, ameaca int, frentes int, quase int)
language sql
stable
as $$
  select
    d.key,
    (p_est -> 'exercitos' ->> d.key)::int,
    coalesce((
      select sum((p_est -> 'exercitos' ->> v)::int)::int
        from unnest(public.dominio_vizinhos(p_mapa, d.key)) v
       where coalesce((p_est -> 'donos' ->> v)::smallint, -1) <> p_seat
    ), 0),
    coalesce((
      select count(*)::int
        from unnest(public.dominio_vizinhos(p_mapa, d.key)) v
       where coalesce((p_est -> 'donos' ->> v)::smallint, -1) <> p_seat
    ), 0),
    coalesce((
      select count(*)::int
        from jsonb_array_elements(p_mapa -> 'territorios') t
       where t ->> 'continente' = (
               select t2 ->> 'continente'
                 from jsonb_array_elements(p_mapa -> 'territorios') t2
                where t2 ->> 'id' = d.key
             )
         and coalesce((p_est -> 'donos' ->> (t ->> 'id'))::smallint, -1) <> p_seat
    ), 99)
    from jsonb_each_text(p_est -> 'donos') d
   where d.value::smallint = p_seat;
$$;

revoke all on function public.dominio_bot_visao(jsonb, jsonb, smallint)
  from public, anon, authenticated;

-- ── o turno ────────────────────────────────────────────────────────────────

/**
 * Joga UM turno de máquina, do reforço ao encerramento.
 *
 * Devolve o número de ações que ela tomou — serve de sinal de vida no teste, e
 * de aviso: turno de máquina que faz zero ação é bug, não estratégia.
 *
 * Não confere autenticação de propósito: quem chama é `dominio_tocar` (que
 * confere) ou `dominio_sweep` (que roda no cron). Por isso está revogada dos
 * três papéis: uma função que joga o turno de outro assento nas mãos do cliente
 * é o buraco de `dominio_termina` de novo.
 */
create or replace function public.dominio_bot_turno(p_match uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  est      jsonb;
  mapa     jsonb;
  semente  bigint;
  seat     smallint;
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

  seat := (est ->> 'turnSeat')::smallint;
  select data into mapa from public.game_themes gt where gt.id = (est ->> 'map');

  select mp.user_id into quem
    from public.match_players mp
   where mp.match_id = p_match and mp.seat = seat;
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
            perform public.dominio_trocar_como(seat, p_match, array[i, j, k]);
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
          from public.dominio_bot_visao(mapa, rascunho, seat) v
         order by public.dominio_ruido(semente, seat, seq + n, v.ter) desc
         limit 1;
      else
        select v.ter into alvo
          from public.dominio_bot_visao(mapa, rascunho, seat) v
         where v.frentes > 0
         order by
           v.ameaca * 2 - v.meus
           + case when nivel = 'dificil' and v.quase between 1 and 2 then 40 else 0 end
           + public.dominio_ruido(semente, seat, seq + n, v.ter) / 400.0 desc
         limit 1;
        -- sem fronteira nenhuma (o mapa todo é dela): cai em qualquer um
        if alvo is null then
          select v.ter into alvo
            from public.dominio_bot_visao(mapa, rascunho, seat) v
           order by public.dominio_ruido(semente, seat, seq + n, v.ter) desc
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
      perform public.dominio_reforcar_como(seat, p_match, alvo, quanto);
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
  teto := case nivel when 'facil' then 2 when 'medio' then 5 else 12 end;
  margem := case nivel when 'facil' then 2 when 'medio' then 1 else 0 end;
  vezes := case nivel when 'facil' then 3 when 'medio' then 8 else 12 end;

  while tentou < teto loop
    exit when est ->> 'phase' <> 'ataque';

    /* OS APELIDOS NÃO PODEM SE CHAMAR `para` NEM `def`: em PL/pgSQL nome de
       variável e apelido de subconsulta vivem no MESMO espaço, e foi assim que
       `met_bankrupt` estourou 42702 em 0032. `viz` e `nviz` não colidem com
       nada declarado aqui. */
    de := null;
    select v.ter, x.viz, v.meus - 1, x.nviz
      into de, para, forca, defesa
      from public.dominio_bot_visao(mapa, est, seat) v
      cross join lateral (
        select w as viz, (est -> 'exercitos' ->> w)::int as nviz
          from unnest(public.dominio_vizinhos(mapa, v.ter)) w
         where coalesce((est -> 'donos' ->> w)::smallint, -1) <> seat
      ) x
     where v.meus >= 2
       and v.meus - 1 >= x.nviz + margem
     order by
       -- primeiro a maior vantagem, e entre iguais o alvo mais barato
       (v.meus - 1 - x.nviz) desc,
       x.nviz,
       public.dominio_ruido(semente, seat, seq + tentou, v.ter || x.viz) desc
     limit 1;

    exit when de is null;

    saida := public.dominio_atacar_como(seat, p_match, de, para, least(vezes, forca));
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
        seat, p_match,
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
      from public.dominio_bot_visao(mapa, est, seat) v
     where v.frentes = 0 and v.meus >= 2
     order by v.meus desc, public.dominio_ruido(semente, seat, seq, v.ter) desc
     limit 1;

    if fonte is not null then
      select v.ter into destino
        from public.dominio_bot_visao(mapa, est, seat) v
       where v.frentes > 0
         and v.ter <> fonte
         and public.dominio_conectado(mapa, est, seat, fonte, v.ter)
       order by v.ameaca - v.meus desc, public.dominio_ruido(semente, seat, seq, v.ter) desc
       limit 1;

      if destino is not null then
        quanto := (est -> 'exercitos' ->> fonte)::int - 1;
        if quanto >= 1 then
          perform public.dominio_remanejar_como(seat, p_match, fonte, destino, quanto);
          acoes := acoes + 1;
        end if;
      end if;
    end if;
  end if;

  -- ── 5. PASSA A VEZ ───────────────────────────────────────────────────────
  perform public.dominio_encerrar_turno_como(seat, p_match);
  acoes := acoes + 1;

  return acoes;
end;
$$;

revoke all on function public.dominio_bot_turno(uuid) from public, anon, authenticated;

-- ── vários turnos de uma vez, para quando ninguém está olhando ──────────

/**
 * Joga turnos de máquina enquanto for vez de uma, até `p_max`.
 *
 * O cliente NUNCA usa isto — ele toca um turno por vez, porque o ritmo é metade
 * do jogo. Quem usa é a faxina: se a pessoa fechou a aba numa mesa com três
 * máquinas, esperar três passadas do cron seria esperar minutos por nada.
 *
 * O teto existe porque uma mesa só de máquinas é impossível hoje (o anfitrião
 * é gente e está sempre na partida) — e "impossível hoje" é exatamente o tipo de
 * coisa que vira laço infinito amanhã.
 */
create or replace function public.dominio_toca_pendentes(p_match uuid, p_max int default 8)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  seat    smallint;
  dono    uuid;
  vivo    text;
  feito   int;
  quantos int := 0;
begin
  for i in 1 .. greatest(p_max, 1) loop
    select m.status, (m.public_state ->> 'turnSeat')::smallint into vivo, seat
      from public.matches m where m.id = p_match;
    exit when vivo is distinct from 'running';

    select mp.user_id into dono
      from public.match_players mp
     where mp.match_id = p_match and mp.seat = seat;
    exit when not exists (
      select 1 from public.profiles p where p.id = dono and p.is_bot
    );

    feito := public.dominio_bot_turno(p_match);
    exit when feito = 0;   -- não andou: sair é melhor que girar
    quantos := quantos + 1;
  end loop;

  return quantos;
end;
$$;

revoke all on function public.dominio_toca_pendentes(uuid, int)
  from public, anon, authenticated;

-- ── o RPC do ritmo ─────────────────────────────────────────────────────────

/**
 * Joga um turno de máquina, se for vez de uma.
 *
 * Qualquer pessoa da mesa pode chamar, e é de propósito: numa mesa com duas
 * pessoas e duas máquinas, quem estiver com a aba aberta faz o jogo andar. Se
 * as duas chamarem juntas, a segunda encontra outro `turnSeat` e recebe
 * NOT_BOT_TURN — o `for update` de `dominio_ator` resolve a corrida.
 *
 * O CLIENTE MANDA NO RITMO, NUNCA NO RESULTADO. Ele decide QUANDO tocar; o que
 * a máquina faz é decidido aqui dentro, com o estado que o servidor tem.
 */
create or replace function public.dominio_tocar(p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  est   jsonb;
  vivo  text;
  seat  smallint;
  dono  uuid;
  feito int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select m.public_state, m.status into est, vivo
    from public.matches m where m.id = p_match;
  if not found then raise exception 'MATCH_NOT_FOUND'; end if;
  if vivo <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;

  if not exists (
    select 1 from public.match_players mp
     where mp.match_id = p_match and mp.user_id = auth.uid()
  ) then
    raise exception 'NOT_A_PLAYER';
  end if;

  seat := (est ->> 'turnSeat')::smallint;
  select mp.user_id into dono
    from public.match_players mp
   where mp.match_id = p_match and mp.seat = seat;

  if not exists (select 1 from public.profiles p where p.id = dono and p.is_bot) then
    raise exception 'NOT_BOT_TURN';
  end if;

  feito := public.dominio_bot_turno(p_match);
  if feito = 0 then raise exception 'BOT_STUCK'; end if;

  return public.dominio_publico(p_match);
end;
$$;

revoke all on function public.dominio_tocar(uuid) from public, anon, authenticated;
grant execute on function public.dominio_tocar(uuid) to authenticated;

-- ── a rede de segurança ────────────────────────────────────────────────────

/**
 * A faxina, com uma diferença: se quem está na vez é MÁQUINA, ela joga o turno
 * em vez de pular.
 *
 * É o que garante que a partida nunca trava. Se a pessoa fecha a aba com três
 * máquinas atrás dela, o relógio estoura, a faxina joga as três, e quando ela
 * voltar é a vez dela — com o mapa em ordem e o registro contando o que
 * aconteceu enquanto ela não estava.
 *
 * Pular a máquina no relógio seria pior: ela viraria um jogador morto segurando
 * território, que é exatamente o que 0045 impediu de acontecer no lobby.
 */
create or replace function public.dominio_sweep()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  linha    record;
  est      jsonb;
  mapa     jsonb;
  resta    int;
  maior    text;
  ativos   smallint[];
  onde     int;
  proximo  smallint;
  rodada   int;
  atual    smallint;
  dono     uuid;
  quantos  int := 0;
begin
  for linha in
    select m.id, m.public_state, m.room_id, m.seed
      from public.matches m
     where m.game_key = 'dominio' and m.status = 'running'
       and m.turn_deadline is not null and m.turn_deadline < now()
     for update skip locked
  loop
    est := linha.public_state;
    atual := (est ->> 'turnSeat')::smallint;

    /* MÁQUINA NO RELÓGIO JOGA, não é pulada. Um bloco de exceção por partida:
       máquina travada numa mesa não pode parar a faxina de todas as outras —
       foi essa a lição do `dossie_sweep` em 0033. */
    select mp.user_id into dono
      from public.match_players mp
     where mp.match_id = linha.id and mp.seat = atual;

    if exists (select 1 from public.profiles p where p.id = dono and p.is_bot) then
      begin
        -- TODAS as máquinas seguidas, não uma: esperar uma passada do cron por
        -- máquina seria esperar minutos numa mesa que ninguém está vendo
        quantos := quantos + public.dominio_toca_pendentes(linha.id, 8);
      exception when others then
        raise warning 'dominio_sweep: maquina travada em % (%)', linha.id, sqlerrm;
      end;
      continue;
    end if;

    select data into mapa from public.game_themes gt where gt.id = (est ->> 'map');

    -- exército que ficou na mão vai para o maior território
    resta := coalesce((est ->> 'reforcoLeft')::int, 0);
    if resta > 0 then
      select d.key into maior
        from jsonb_each_text(est -> 'donos') d
       where d.value::smallint = atual
       order by (est -> 'exercitos' ->> d.key)::int desc, d.key
       limit 1;
      if maior is not null then
        est := jsonb_set(est, array['exercitos', maior],
          to_jsonb((est -> 'exercitos' ->> maior)::int + resta));
        est := public.dominio_log(est, jsonb_build_object(
          'k', 'reforco-automatico', 'seat', atual, 'ter', maior, 'n', resta));
      end if;
      est := jsonb_set(est, '{reforcoLeft}', to_jsonb(0));
    end if;

    select array_agg((j ->> 'seat')::smallint order by (j ->> 'seat')::smallint)
      into ativos
      from jsonb_array_elements(est -> 'players') j
     where coalesce((j ->> 'ativo')::boolean, true);

    if coalesce(array_length(ativos, 1), 0) <= 1 then
      continue;
    end if;

    select i into onde from generate_subscripts(ativos, 1) i where ativos[i] = atual;
    proximo := ativos[(coalesce(onde, 0) % array_length(ativos, 1)) + 1];

    if proximo = ativos[1] then
      rodada := coalesce((est ->> 'round')::int, 1) + 1;
      est := jsonb_set(est, '{round}', to_jsonb(rodada));
      if (est ->> 'mode') = 'campanha' then
        est := public.dominio_pontua(mapa, est);
        est := public.dominio_restaura(mapa, est, linha.seed, rodada);
      end if;
    end if;

    est := jsonb_set(est, '{turnSeat}', to_jsonb(proximo));
    est := jsonb_set(est, '{phase}', '"reforco"');
    est := jsonb_set(est, '{conquistou}', 'false'::jsonb);
    est := jsonb_set(est, '{remanejou}', 'false'::jsonb);
    est := jsonb_set(est, '{avanco}', 'null'::jsonb);
    est := jsonb_set(est, '{reforcoLeft}',
      to_jsonb(public.dominio_reforco(mapa, est, proximo)));
    est := public.dominio_log(est, jsonb_build_object(
      'k', 'tempo-esgotado', 'seat', atual));
    est := public.dominio_log(est, jsonb_build_object('k', 'vez', 'seat', proximo));

    update public.matches
       set public_state = est, version = version + 1,
           turn_deadline = now() + interval '120 seconds'
     where id = linha.id;

    quantos := quantos + 1;
  end loop;

  return quantos;
end;
$$;

revoke all on function public.dominio_sweep() from public, anon, authenticated;

-- ── e a máquina passa a saber jogar Domínio ────────────────────────────────

create or replace function public.bot_sabe_jogar(p_game text)
returns boolean
language sql
immutable
as $$
  select p_game = any (array['letreiro', 'dominio']);
$$;

revoke all on function public.bot_sabe_jogar(text) from public, anon, authenticated;
