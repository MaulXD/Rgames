-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0087 · as reviravoltas do Dossiê (PRD 03 §6.7)
--
-- Cada caso carrega EXATAMENTE UMA regra própria. Uma, não duas — a restrição é
-- o que impede o sistema de temas de virar uma bagunça de exceções.
--
--   Solar das Acácias   —            o jogo limpo, a referência
--   Boate Aurora        Apagão       uma rodada de refutações anônimas
--   Ras Zamir           Tempestade   dois lugares fechados, com aviso antes
--   Meridiano-9         Registro     um fato público verdadeiro a cada 4 rodadas
--
-- POR QUE ISTO NÃO ENTROU JUNTO COM OS TRÊS TEMAS. O `scripts/seed-dossie.mjs`
-- publicou os três casos sem reviravolta nenhuma, e o comentário no topo dele
-- explicava: reviravolta é REGRA, e regra é motor. Declarar um campo `twist` no
-- pacote que o servidor ignora seria configuração decorativa — a tela prometendo
-- o que a partida não entrega, sem nada quebrar para acusar. É o mesmo defeito
-- que o `modo` do Domínio teve, e que já custou uma migração para consertar.
--
-- Agora o motor sabe executá-las, então elas entram — e o validador dos pacotes
-- ganhou a lista das três, para que um pacote da comunidade não possa inventar
-- uma quarta que ninguém executa.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O DESENHO
--
-- A reviravolta mora no estado público, em `twist`, e é congelada no início da
-- partida: quem escolheu jogar limpo nas Regras da Casa joga limpo até o fim,
-- e ninguém muda a regra no meio.
--
--   {"id": "apagao", "round": 6, "fired": false, "active": false}
--   {"id": "tempestade", "fechados": [], "aviso": ["poco", "cisterna"]}
--   {"id": "registro", "publicados": ["taco"]}
--
-- `dossie_vira_rodada` é chamada por `dossie_advance` só quando a rodada VIRA,
-- e é o único lugar onde reviravolta acontece. Um lugar só, três ramos.
--
-- O CUSTO DE CADA UMA está no que ela NÃO tira de você:
--
--   Apagão      você perde a atribuição, nunca a carta. "Aquela carta não está
--               no envelope" continua sendo sua, que é a informação que decide.
--   Tempestade  quem fica preso continua palpitando. Lugar fechado é posição,
--               não punição — ninguém entra para te desmentir de perto.
--   Registro    o fato é verdadeiro e é de todos ao mesmo tempo. Vira corrida
--               de conversão, não loteria.
-- ════════════════════════════════════════════════════════════════════════════

/**
 * A reviravolta que este caso carrega, ou NULO se ele joga limpo.
 *
 * Devolver nulo para o Solar das Acácias é o contrato: ele é a referência, o
 * caso sem regra própria, e quem chama depende disso.
 */
create or replace function public.dossie_twist_do_tema(p_tema jsonb)
returns text
language sql
immutable
as $$
  select nullif(p_tema -> 'twist' ->> 'id', '');
$$;

revoke all on function public.dossie_twist_do_tema(jsonb) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

/**
 * O mapa continua conexo se estes dois lugares fecharem?
 *
 * Uma busca em largura a partir de um lugar aberto qualquer, andando pelas
 * portas E pelas passagens secretas — as mesmas arestas que `dossie_can_move`
 * aceita, porque de nada adianta a busca achar um caminho que o jogo proíbe.
 *
 * Fechar o Poço e a Conservação do Ras Zamir ao mesmo tempo isolaria a Câmara
 * Selada de todo mundo, e um lugar inalcançável durante uma rodada inteira é
 * uma partida que pode não terminar. Este é o guarda dessa porta.
 */
create or replace function public.dossie_conexo_sem(p_tema jsonb, p_a text, p_b text)
returns boolean
language plpgsql
immutable
as $$
declare
  abertos  text[];
  vistos   text[] := '{}';
  fila     text[];
  atual    text;
  vizinho  text;
begin
  select coalesce(array_agg(value ->> 'id'), '{}')
    into abertos
    from jsonb_array_elements(p_tema -> 'rooms')
   where value ->> 'id' not in (p_a, p_b);

  if array_length(abertos, 1) is null then return false; end if;

  fila := array[abertos[1]];
  vistos := fila;

  while array_length(fila, 1) > 0 loop
    atual := fila[1];
    fila := fila[2:];

    for vizinho in
      select v from jsonb_array_elements_text(p_tema -> 'adjacency' -> atual) v
      union
      select case when pas ->> 0 = atual then pas ->> 1 else pas ->> 0 end
        from jsonb_array_elements(p_tema -> 'secretPassages') pas
       where pas ->> 0 = atual or pas ->> 1 = atual
    loop
      if vizinho = any(abertos) and not (vizinho = any(vistos)) then
        vistos := vistos || vizinho;
        fila := fila || vizinho;
      end if;
    end loop;
  end loop;

  return array_length(vistos, 1) = array_length(abertos, 1);
end;
$$;

revoke all on function public.dossie_conexo_sem(jsonb, text, text) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

/**
 * O par de lugares que a tempestade fecha nesta virada de vento.
 *
 * Sorteia entre os pares que mantêm o mapa conexo. Devolve um array vazio se
 * nenhum par serve — o que não acontece em nenhum dos quatro mapas, mas um tema
 * da comunidade pode ter uma topologia frágil, e a resposta certa aí é não
 * fechar nada em vez de travar a partida.
 */
create or replace function public.dossie_par_da_tempestade(p_tema jsonb, p_semente bigint)
returns text[]
language plpgsql
stable
as $$
declare
  lugares text[];
  sorteio text[];
  a       text;
  b       text;
  i       int;
  j       int;
begin
  select array_agg(value ->> 'id') into lugares
    from jsonb_array_elements(p_tema -> 'rooms');

  sorteio := public.shuffle_text(lugares, p_semente);

  /* Percorre os pares na ordem embaralhada e devolve o primeiro que serve.
     Sortear um par e reprovar seria ou repetir até dar certo (sem teto) ou
     desistir (viés); percorrer a ordem sorteada é sortear entre os válidos. */
  for i in 1..array_length(sorteio, 1) - 1 loop
    for j in i + 1..array_length(sorteio, 1) loop
      a := sorteio[i];
      b := sorteio[j];
      if public.dossie_conexo_sem(p_tema, a, b) then
        return array[a, b];
      end if;
    end loop;
  end loop;

  return '{}';
end;
$$;

revoke all on function public.dossie_par_da_tempestade(jsonb, bigint) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

/**
 * A carta que NÚBIA publica: entre as que não estão no envelope, aquela que o
 * maior número de jogadores ainda não riscou.
 *
 * "Ainda não riscou" se lê no bloco de dedução de cada um (`dedu.fora`), que é
 * privado — esta função é SECURITY DEFINER e só devolve o id de uma carta que
 * comprovadamente NÃO está no envelope, então ela não vaza nada que a publicação
 * não fosse vazar de qualquer jeito.
 *
 * Cartas já publicadas saem da conta: republicar um fato é gastar a reviravolta
 * à toa.
 */
create or replace function public.dossie_fato_do_registro(p_match uuid, p_ja text[])
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  m       public.matches;
  tema    jsonb;
  escolha text;
begin
  select * into m from public.matches where id = p_match;
  if not found then return null; end if;
  select data into tema from public.game_themes where id = m.public_state ->> 'theme';

  /* Todas as cartas do caso, menos as três do envelope, menos as já publicadas.
     Para cada uma, quantos jogadores ainda NÃO a riscaram. A de maior contagem
     ganha; empate desempata pelo id, para a escolha ser determinística e o
     teste poder conferir a política em vez do sorteio. */
  select carta into escolha from (
    select c.carta,
           (select count(*) from public.match_private_state mps
             where mps.match_id = p_match
               and not exists (
                 select 1 from jsonb_array_elements_text(coalesce(mps.data -> 'dedu' -> 'fora', '[]'::jsonb)) f
                  where f = c.carta
               )
           ) quantos
      from (
        select value ->> 'id' carta from jsonb_array_elements(tema -> 'suspects')
        union all
        select value ->> 'id' from jsonb_array_elements(tema -> 'weapons')
        union all
        select value ->> 'id' from jsonb_array_elements(tema -> 'rooms')
      ) c
     where c.carta not in (
             m.solution ->> 'suspect', m.solution ->> 'weapon', m.solution ->> 'room'
           )
       and not (c.carta = any(coalesce(p_ja, '{}')))
     order by quantos desc, c.carta
     limit 1
  ) t;

  return escolha;
end;
$$;

revoke all on function public.dossie_fato_do_registro(uuid, text[]) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

/**
 * A reviravolta acontece aqui, e só aqui.
 *
 * Chamada por `dossie_advance` no instante em que a rodada vira. Um lugar só,
 * três ramos — se um dia forem quatro, continuam sendo quatro ramos de uma
 * função, e não quatro remendos espalhados pelo motor.
 */
create or replace function public.dossie_vira_rodada(p_match uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m       public.matches;
  estado  jsonb;
  giro    jsonb;
  tema    jsonb;
  rodada  int;
  par     text[];
  fato    text;
  ja      text[];
begin
  select * into m from public.matches where id = p_match;
  if not found or m.status <> 'running' then return; end if;

  estado := m.public_state;
  giro := estado -> 'twist';

  /* Sem reviravolta é o caminho normal, não a exceção: o Solar das Acácias e
     toda mesa que desligou a regra passam por aqui. */
  if giro is null or giro = 'null'::jsonb then return; end if;

  rodada := coalesce((estado ->> 'round')::int, 1);
  select data into tema from public.game_themes where id = estado ->> 'theme';

  case giro ->> 'id'

    /* APAGÃO — a luz cai numa rodada só, sorteada no início entre a 4 e a 8.
       `active` liga na rodada certa e desliga na seguinte; `fired` é a memória
       de que já aconteceu, para o log poder contar a história depois. */
    when 'apagao' then
      if rodada = (giro ->> 'round')::int then
        giro := giro || jsonb_build_object('active', true, 'fired', true);
        estado := public.dossie_log(estado, jsonb_build_object('type', 'apagao'));
      elsif coalesce((giro ->> 'active')::boolean, false) then
        giro := giro || jsonb_build_object('active', false);
        estado := public.dossie_log(estado, jsonb_build_object('type', 'luz'));
      end if;

    /* TEMPESTADE — o vento vira a cada três rodadas, e o aviso vem uma antes.
       Ou seja: sorteia o par na rodada 2, fecha na 3; sorteia na 5, fecha na 6.
       O aviso é o que faz a regra ser jogável: dá para sair a tempo, ou entrar
       de propósito. */
    when 'tempestade' then
      if rodada % 3 = 0 then
        -- fecha o que foi avisado na rodada passada
        select coalesce(array_agg(value::text), '{}') into par
          from jsonb_array_elements_text(coalesce(giro -> 'aviso', '[]'::jsonb));
        giro := giro || jsonb_build_object(
          'fechados', coalesce(giro -> 'aviso', '[]'::jsonb),
          'aviso', '[]'::jsonb
        );
        if array_length(par, 1) = 2 then
          estado := public.dossie_log(estado, jsonb_build_object(
            'type', 'tempestade', 'rooms', to_jsonb(par)
          ));
        end if;
      elsif rodada % 3 = 2 then
        -- avisa o que vai fechar na próxima
        par := public.dossie_par_da_tempestade(tema, m.seed + rodada * 31);
        giro := giro || jsonb_build_object('fechados', '[]'::jsonb, 'aviso', to_jsonb(par));
        if array_length(par, 1) = 2 then
          estado := public.dossie_log(estado, jsonb_build_object(
            'type', 'vento', 'rooms', to_jsonb(par)
          ));
        end if;
      else
        -- a rodada de folga: nada fechado, nada avisado
        giro := giro || jsonb_build_object('fechados', '[]'::jsonb, 'aviso', '[]'::jsonb);
      end if;

    /* REGISTRO — a cada quatro rodadas, um fato verdadeiro para a mesa toda. */
    when 'registro' then
      if rodada % 4 = 0 then
        select coalesce(array_agg(value::text), '{}') into ja
          from jsonb_array_elements_text(coalesce(giro -> 'publicados', '[]'::jsonb));
        fato := public.dossie_fato_do_registro(p_match, ja);
        if fato is not null then
          giro := giro || jsonb_build_object(
            'publicados', coalesce(giro -> 'publicados', '[]'::jsonb) || to_jsonb(fato)
          );
          estado := public.dossie_log(estado, jsonb_build_object(
            'type', 'registro', 'card', fato
          ));
        end if;
      end if;

    else
      -- reviravolta que o motor não conhece: não faz nada, e é de propósito
      return;
  end case;

  estado := estado || jsonb_build_object('twist', giro);
  update public.matches set public_state = estado, version = version + 1 where id = p_match;
end;
$$;

revoke all on function public.dossie_vira_rodada(uuid) from public, anon, authenticated;
