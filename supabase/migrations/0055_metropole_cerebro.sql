-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0055 · o cérebro da máquina na Metrópole
--
-- UM PASSO POR CHAMADA, e isto é melhor do que o Domínio faz.
--
-- No Domínio a máquina joga o turno inteiro numa chamada, porque um turno de
-- WAR é uma sequência de decisões que só faz sentido junta. Aqui não: rolar o
-- dado, andar, decidir comprar, construir e passar a vez são cinco momentos, e
-- cada um merece ser VISTO. Então `met_bot_passo` faz exatamente UM, e devolve
-- o que fez.
--
-- O cliente chama, espera um respiro, chama de novo. A pessoa vê o dado cair,
-- vê o peão andar, vê a máquina hesitar e comprar. Um jogo de tabuleiro é feito
-- de ver o adversário decidir — e a Metrópole é o jogo em que isso mais importa,
-- porque o que ela compra hoje é o aluguel que você paga na rodada oito.
--
-- ─────────────────────────────────────────────────────────────────────────
-- A MÁQUINA AGE FORA DA PRÓPRIA VEZ, e este jogo é o único assim.
--
-- Leilão: todo mundo dá lance. Proposta de troca: quem recebe responde. Aposta
-- do Investidor: quem quebrou continua na mesa. Se a máquina só agisse na vez
-- dela, um leilão com duas máquinas travaria para sempre — e é por isso que
-- 0053 precisou de dois resolvedores.
--
-- A ordem de urgência do passo é essa, e ela importa: leilão primeiro (o
-- relógio dele é de 20 segundos e ele bloqueia a mesa toda), depois proposta,
-- depois a vez.
--
-- ─────────────────────────────────────────────────────────────────────────
-- COMO ELA PENSA
--
-- Ela vê o mesmo tabuleiro que todo mundo: escritura, dinheiro na mão, casa
-- construída. Nunca vê carta de Sorte antes de tirar, nem a aposta secreta de
-- um Investidor, nem o dado antes de rolar.
--
--   tranquila  compra quase tudo que pode pagar, sem reserva nenhuma — e é o
--              erro clássico de quem está aprendendo: fica sem dinheiro na
--              rodada seis e hipoteca o jogo inteiro. Constrói pouco, dá lance
--              só até o preço de tabela, e recusa toda troca.
--   firme      guarda reserva, constrói quando fecha grupo, paga acima da
--              tabela por propriedade que FECHA grupo dela.
--   impiedosa  a mesma coisa, e paga acima da tabela também por propriedade que
--              IMPEDE o grupo de outro. Bloquear é metade do jogo.
--
-- E o desempate é md5 de (semente, assento, rodada, coisa) — nunca `random()`.
-- A lição de 0038 vale aqui igual: sorteio que parece aleatório e não é faz o
-- jogo pior em silêncio.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── o que a máquina vê ─────────────────────────────────────────────────────

/**
 * O nível de uma máquina naquela sala, ou nulo se o assento não é máquina.
 */
create or replace function public.met_bot_nivel(p_match uuid, p_seat smallint)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(rm.bot_nivel, 'medio')
    from public.matches m
    join public.match_players mp on mp.match_id = m.id and mp.seat = p_seat
    join public.profiles p on p.id = mp.user_id and p.is_bot
    left join public.room_members rm on rm.room_id = m.room_id and rm.user_id = mp.user_id
   where m.id = p_match;
$$;

revoke all on function public.met_bot_nivel(uuid, smallint) from public, anon, authenticated;

/**
 * Quanto esta propriedade vale PARA ESTE ASSENTO, em centavos de reais do jogo.
 *
 * Não é o preço de tabela: é o preço mais o que ela significa no mapa.
 *   · fecha um grupo dela          → vale muito mais (é o que libera construir)
 *   · impede o grupo de outro      → vale mais (bloquear é metade do jogo)
 *   · é a segunda ou terceira de um grupo que ela já começou → vale mais
 *   · transporte                   → vale mais por quantos ela já tem
 *
 * A tranquila não usa nada disso: para ela, valor é preço. É a diferença entre
 * jogar Metrópole e jogar "comprei porque caí".
 */
create or replace function public.met_bot_valor(
  p_mapa jsonb, p_est jsonb, p_seat smallint, p_prop text, p_nivel text
)
returns int
language plpgsql
stable
as $$
declare
  casa    jsonb;
  preco   int;
  grupo   text;
  total   int;
  meus    int;
  outros  int;
  valor   int;
begin
  select c into casa
    from jsonb_array_elements(p_mapa -> 'casas') c
   where c ->> 'id' = p_prop;
  if casa is null then return 0; end if;

  preco := coalesce((casa ->> 'preco')::int, 0);
  if p_nivel = 'facil' then return preco; end if;

  valor := preco;
  grupo := casa ->> 'g';

  if grupo is not null then
    select count(*)::int into total
      from jsonb_array_elements(p_mapa -> 'casas') c
     where c ->> 'g' = grupo;
    select count(*)::int into meus
      from jsonb_array_elements(p_mapa -> 'casas') c
     where c ->> 'g' = grupo
       and coalesce((p_est -> 'props' -> (c ->> 'id') ->> 'owner')::smallint, -1) = p_seat;
    -- quantos do grupo são de UMA outra pessoa só (candidata a fechar)
    select coalesce(max(quantos), 0) into outros
      from (
        select count(*)::int quantos
          from jsonb_array_elements(p_mapa -> 'casas') c
         where c ->> 'g' = grupo
           and (p_est -> 'props' -> (c ->> 'id') ->> 'owner') is not null
           and (p_est -> 'props' -> (c ->> 'id') ->> 'owner')::smallint <> p_seat
         group by (p_est -> 'props' -> (c ->> 'id') ->> 'owner')::smallint
      ) t;

    -- esta fecha o grupo dela: o passo que libera construir, e construir é
    -- onde o dinheiro da Metrópole realmente está
    if meus = total - 1 then
      valor := valor + preco;                      -- dobra
    elsif meus > 0 then
      valor := valor + preco / 2;
    end if;

    -- e para a impiedosa, impedir o grupo de outro vale quase o mesmo
    if p_nivel = 'dificil' and outros = total - 1 then
      valor := valor + preco * 3 / 4;
    end if;
  end if;

  if casa ->> 't' = 'transporte' then
    select count(*)::int into meus
      from jsonb_array_elements(p_mapa -> 'casas') c
     where c ->> 't' = 'transporte'
       and coalesce((p_est -> 'props' -> (c ->> 'id') ->> 'owner')::smallint, -1) = p_seat;
    valor := valor + meus * preco / 4;   -- o aluguel dobra a cada uma
  end if;

  return valor;
end;
$$;

revoke all on function public.met_bot_valor(jsonb, jsonb, smallint, text, text)
  from public, anon, authenticated;

/**
 * A reserva de caixa: quanto ela se recusa a gastar.
 *
 * É a diferença entre a tranquila e as outras duas, e é o erro mais comum de
 * quem está aprendendo Metrópole: comprar tudo, ficar sem dinheiro, e hipotecar
 * o tabuleiro inteiro no primeiro aluguel caro.
 */
create or replace function public.met_bot_reserva(p_nivel text, p_rodada int)
returns int
language sql
immutable
as $$
  select case p_nivel
    when 'facil'   then 0
    when 'medio'   then 1500
    else greatest(1500, 3000 - p_rodada * 100)   -- aperta no começo, solta no fim
  end;
$$;

revoke all on function public.met_bot_reserva(text, int) from public, anon, authenticated;

-- ── um passo ───────────────────────────────────────────────────────────────

/**
 * Faz UM passo de máquina e devolve o que fez, ou nulo se não havia nada.
 *
 * Devolver texto e não booleano é de propósito: o teste lê a sequência de
 * passos de uma partida inteira, e "rolar, comprar, construir, passar" conta
 * uma história que `true, true, true, true` não conta.
 */
create or replace function public.met_bot_passo(p_match uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  est     jsonb;
  mapa    jsonb;
  semente bigint;
  rodada  int;
  fase    text;
  assento smallint;
  nivel   text;
  jog     jsonb;
  caixa   int;

  -- leilão
  lei     jsonb;
  minimo  int;
  teto    int;
  lance   int;
  admin   smallint;

  -- compra
  prop    text;
  preco   int;
  valor   int;

  -- dívida / construção
  alvo    text;
  falta   int;
  linha   record;
begin
  select m.public_state, m.seed into est, semente
    from public.matches m
   where m.id = p_match and m.game_key = 'metropole' and m.status = 'running'
   for update;
  if not found then return null; end if;

  select data into mapa from public.game_themes gt where gt.id = (est ->> 'map');
  fase := est ->> 'phase';
  rodada := coalesce((est ->> 'round')::int, 1);

  /* ── 1. LEILÃO ─────────────────────────────────────────────────────────
     Primeiro de todos porque o relógio do leilão é de vinte segundos e ele
     tranca a mesa inteira: enquanto ele não fecha, ninguém joga. */
  if fase = 'leilao' and est -> 'leilao' is not null and est -> 'leilao' <> 'null'::jsonb then
    lei := est -> 'leilao';

    select mp.seat into assento
      from public.match_players mp
      join public.profiles p on p.id = mp.user_id and p.is_bot
     where mp.match_id = p_match
       and coalesce((lei ->> 'altoSeat')::smallint, -1) <> mp.seat
       and not coalesce(lei -> 'passou' @> to_jsonb(mp.seat), false)
       and (
         not coalesce((est -> 'players' -> mp.seat::text ->> 'quebrado')::boolean, false)
         or coalesce((est -> 'players' -> mp.seat::text ->> 'investidor')::boolean, false)
       )
     order by mp.seat
     limit 1;

    if assento is not null then
      nivel := public.met_bot_nivel(p_match, assento);
      caixa := coalesce((est -> 'players' -> assento::text ->> 'cash')::int, 0);
      minimo := greatest(
        coalesce((lei ->> 'alto')::int, 0) + 1,
        coalesce((mapa -> 'regras' ->> 'lanceMinimo')::int, 100));
      valor := public.met_bot_valor(mapa, est, assento, lei ->> 'prop', nivel);

      /* O TETO é o valor menos a reserva: ela não dá lance que a deixe sem
         dinheiro para o próximo aluguel. A tranquila não tem reserva, e é por
         isso que ela quebra sozinha. */
      teto := least(valor, caixa - public.met_bot_reserva(nivel, rodada));

      if minimo <= teto then
        -- a impiedosa sobe de degrau, para encurtar o leilão e assustar
        lance := case nivel when 'dificil' then least(teto, minimo + 200) else minimo end;
        admin := null;
        if coalesce((est -> 'players' -> assento::text ->> 'quebrado')::boolean, false) then
          -- Investidor precisa dizer quem administra: o ativo com mais caixa
          select mp.seat into admin
            from public.match_players mp
           where mp.match_id = p_match
             and not coalesce((est -> 'players' -> mp.seat::text ->> 'quebrado')::boolean, false)
           order by (est -> 'players' -> mp.seat::text ->> 'cash')::int desc, mp.seat
           limit 1;
          if admin is null then
            perform public.met_pass_como(assento, p_match);
            return format('leilao:passa(%s) sem administrador', assento);
          end if;
        end if;
        perform public.met_bid_como(assento, p_match, lance, admin);
        return format('leilao:lance(%s) %s por %s', assento, lei ->> 'prop', lance);
      end if;

      perform public.met_pass_como(assento, p_match);
      return format('leilao:passa(%s) %s vale %s e o minimo e %s',
                    assento, lei ->> 'prop', valor, minimo);
    end if;
  end if;

  /* ── 2. PROPOSTA DE TROCA ──────────────────────────────────────────────
     Proposta sem resposta é pior que proposta recusada: quem propôs fica
     esperando e não sabe se pode contar com aquilo. Máquina responde sempre.

     A CONTA É SIMPLES E HONESTA: vale a pena se o que ela recebe vale mais que
     o que ela dá, pela mesma função de valor que ela usa para comprar. A
     tranquila recusa tudo — não por burrice, mas porque não negociar é
     exatamente o comportamento de quem não entendeu o jogo ainda. */
  for linha in
    select (o ->> 'id') id, (o ->> 'para')::smallint para, o -> 'da' da, o -> 'quer' quer
      from jsonb_array_elements(coalesce(est -> 'ofertas', '[]'::jsonb)) o
     where coalesce(o ->> 'estado', 'aberta') = 'aberta'
     order by o ->> 'id'
  loop
    nivel := public.met_bot_nivel(p_match, linha.para);
    continue when nivel is null;

    if nivel = 'facil' then
      perform public.met_offer_reply_como(linha.para, p_match, linha.id, false);
      return format('troca:recusa(%s) a tranquila nao negocia', linha.para);
    end if;

    -- o que entra menos o que sai, pela mesma régua da compra
    select coalesce(sum(public.met_bot_valor(mapa, est, linha.para, p, nivel)), 0)
      into valor
      from jsonb_array_elements_text(coalesce(linha.da -> 'props', '[]'::jsonb)) p;
    valor := valor + coalesce((linha.da ->> 'cash')::int, 0);

    select coalesce(sum(public.met_bot_valor(mapa, est, linha.para, p, nivel)), 0)
      into preco
      from jsonb_array_elements_text(coalesce(linha.quer -> 'props', '[]'::jsonb)) p;
    preco := preco + coalesce((linha.quer ->> 'cash')::int, 0);

    perform public.met_offer_reply_como(linha.para, p_match, linha.id, valor > preco);
    return format('troca:%s(%s) recebe %s e da %s',
                  case when valor > preco then 'aceita' else 'recusa' end,
                  linha.para, valor, preco);
  end loop;

  /* ── 3. A VEZ DELA ─────────────────────────────────────────────────────── */
  assento := (est ->> 'turnSeat')::smallint;
  nivel := public.met_bot_nivel(p_match, assento);
  if nivel is null then return null; end if;   -- é a vez de gente

  jog := est -> 'players' -> assento::text;
  caixa := coalesce((jog ->> 'cash')::int, 0);

  /* 3a. DÍVIDA. Vender casa, depois hipotecar, e só então quebrar.
     A ordem é a que perde menos: casa devolve metade e não tira a escritura;
     hipoteca tira a propriedade de circulação mas dá mais dinheiro. Quebrar é
     último — e é uma decisão, não um acidente. */
  if fase = 'resolve'
     and coalesce(est -> 'pendente' ->> 'k', '') = 'divida' then
    falta := coalesce((est -> 'pendente' ->> 'quanto')::int, 0);

    -- uma casa da propriedade mais construída
    select p.key into alvo
      from jsonb_each(est -> 'props') p
     where coalesce((p.value ->> 'owner')::smallint, -1) = assento
       and coalesce((p.value ->> 'casas')::int, 0) > 0
     order by (p.value ->> 'casas')::int desc, p.key
     limit 1;
    if alvo is not null then
      perform public.met_sell_como(assento, p_match, alvo, 1);
      return format('divida:vende(%s) uma casa de %s, faltam %s', assento, alvo, falta);
    end if;

    -- a hipoteca mais barata primeiro: guarda as caras para depois
    select p.key into alvo
      from jsonb_each(est -> 'props') p
      join jsonb_array_elements(mapa -> 'casas') c on c ->> 'id' = p.key
     where coalesce((p.value ->> 'owner')::smallint, -1) = assento
       and not coalesce((p.value ->> 'hipotecada')::boolean, false)
     order by (c ->> 'hipoteca')::int, p.key
     limit 1;
    if alvo is not null then
      perform public.met_mortgage_como(assento, p_match, alvo);
      return format('divida:hipoteca(%s) %s, faltam %s', assento, alvo, falta);
    end if;

    perform public.met_bankrupt_como(assento, p_match);
    return format('divida:quebra(%s) nao havia mais o que vender', assento);
  end if;

  -- 3b. CADEIA
  if fase = 'rolar' and coalesce((jog ->> 'jail')::int, 0) > 0 then
    if coalesce((jog ->> 'livras')::int, 0) > 0 then
      perform public.met_jail_como(assento, p_match, 'carta');
      return format('cadeia:carta(%s)', assento);
    end if;
    /* Pagar a fiança no COMEÇO é bom (mais casas para comprar); no fim é ruim
       (o aluguel está caro e a cadeia é abrigo). A tranquila não sabe disso e
       paga sempre que tem. */
    if caixa - coalesce((mapa -> 'regras' ->> 'fiancaCadeia')::int, 500)
       > public.met_bot_reserva(nivel, rodada)
       and (nivel = 'facil' or rodada <= 12) then
      perform public.met_jail_como(assento, p_match, 'pagar');
      return format('cadeia:paga(%s)', assento);
    end if;
    perform public.met_jail_como(assento, p_match, 'dado');
    return format('cadeia:dado(%s)', assento);
  end if;

  -- 3c. ROLAR
  if fase = 'rolar' then
    perform public.met_roll_como(assento, p_match);
    return format('rola(%s)', assento);
  end if;

  -- 3d. COMPRAR OU DEIXAR IR PARA LEILÃO
  if coalesce(est -> 'pendente' ->> 'k', '') = 'comprar' then
    prop := est -> 'pendente' ->> 'prop';
    preco := coalesce((est -> 'pendente' ->> 'preco')::int, 0);
    valor := public.met_bot_valor(mapa, est, assento, prop, nivel);

    if preco <= valor and caixa - preco >= public.met_bot_reserva(nivel, rodada) then
      perform public.met_buy_como(assento, p_match);
      return format('compra(%s) %s por %s (vale %s)', assento, prop, preco, valor);
    end if;
    /* RECUSAR MANDA PARA LEILÃO, e é jogada de verdade: propriedade que ela não
       quer pelo preço de tabela pode sair por menos, e ela ainda dá lance. */
    perform public.met_decline_como(assento, p_match);
    return format('recusa(%s) %s por %s (vale %s)', assento, prop, preco, valor);
  end if;

  -- 3e. CONSTRUIR
  /* A REGRA DE CONSTRUIR NÃO É REESCRITA AQUI. A máquina escolhe a propriedade
     e OFERECE; `met_build_como` diz se pode (grupo completo, construção par,
     casa no banco, dinheiro). Reescrever a validação aqui seria a divergência
     silenciosa que este trabalho todo existe para evitar. */
  if fase = 'acao' and nivel <> 'facil' then
    for linha in
      select p.key prop, coalesce((p.value ->> 'casas')::int, 0) casas,
             (c ->> 'casa')::int custo
        from jsonb_each(est -> 'props') p
        join jsonb_array_elements(mapa -> 'casas') c on c ->> 'id' = p.key
       where coalesce((p.value ->> 'owner')::smallint, -1) = assento
         and not coalesce((p.value ->> 'hipotecada')::boolean, false)
         and not coalesce((p.value ->> 'hotel')::boolean, false)
         and coalesce((p.value ->> 'casas')::int, 0) < case nivel when 'medio' then 3 else 4 end
         and c ->> 'g' is not null
       order by coalesce((p.value ->> 'casas')::int, 0), (c ->> 'casa')::int, p.key
    loop
      exit when caixa - linha.custo < public.met_bot_reserva(nivel, rodada);
      begin
        perform public.met_build_como(assento, p_match, linha.prop, 1);
        return format('constroi(%s) em %s por %s', assento, linha.prop, linha.custo);
      exception when others then
        -- grupo incompleto, construção ímpar, banco sem casa: o "não" das
        -- regras é resposta esperada aqui
        if sqlerrm in ('NOT_ENOUGH_CASH', 'MATCH_NOT_RUNNING') then raise; end if;
      end;
    end loop;
  end if;

  -- 3f. PASSAR A VEZ
  if fase = 'acao' then
    perform public.met_end_turn_como(assento, p_match);
    return format('passa(%s)', assento);
  end if;

  return null;
end;
$$;

revoke all on function public.met_bot_passo(uuid) from public, anon, authenticated;

-- ── o RPC do ritmo ─────────────────────────────────────────────────────────

/**
 * Toca UM passo de máquina, se houver.
 *
 * Devolve o estado público mais o rótulo do passo, para o cliente poder
 * contar o que aconteceu enquanto anima. Se não havia nada a fazer, `passo` vem
 * nulo — e é assim que o cliente sabe parar de chamar.
 *
 * Qualquer pessoa da mesa pode chamar: numa mesa com duas pessoas, quem estiver
 * com a aba aberta faz o jogo andar. A corrida se resolve no `for update`.
 */
create or replace function public.met_tocar(p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  vivo  text;
  passo text;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select m.status into vivo from public.matches m where m.id = p_match;
  if not found then raise exception 'MATCH_NOT_FOUND'; end if;
  if vivo <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;

  if not exists (
    select 1 from public.match_players mp
     where mp.match_id = p_match and mp.user_id = auth.uid()
  ) then
    raise exception 'NOT_A_PLAYER';
  end if;

  passo := public.met_bot_passo(p_match);

  return jsonb_build_object('passo', passo, 'match', public.met_publico(p_match));
end;
$$;

revoke all on function public.met_tocar(uuid) from public, anon, authenticated;
grant execute on function public.met_tocar(uuid) to authenticated;

/**
 * Todos os passos pendentes de uma vez, até o teto.
 *
 * O cliente NUNCA usa: ele toca um por vez, porque ver a máquina decidir é
 * metade do jogo. Quem usa é a faxina, quando ninguém está com a aba aberta.
 */
create or replace function public.met_toca_pendentes(p_match uuid, p_max int default 40)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  quantos int := 0;
begin
  for i in 1 .. greatest(p_max, 1) loop
    exit when public.met_bot_passo(p_match) is null;
    quantos := quantos + 1;
  end loop;
  return quantos;
end;
$$;

revoke all on function public.met_toca_pendentes(uuid, int) from public, anon, authenticated;

-- ── e a máquina passa a saber jogar Metrópole ──────────────────────────────

create or replace function public.bot_sabe_jogar(p_game text)
returns boolean
language sql
immutable
as $$
  select p_game = any (array['letreiro', 'dominio', 'metropole']);
$$;

revoke all on function public.bot_sabe_jogar(text) from public, anon, authenticated;
