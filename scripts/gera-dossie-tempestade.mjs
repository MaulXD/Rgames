#!/usr/bin/env node
/**
 * Gera a migração 0089 — a tempestade fecha lugar de verdade.
 *
 * 0087 sorteia o par e 0088 grava no estado. Nada ainda IMPEDE nada: a
 * tempestade é, até aqui, duas palavras num jsonb. Esta migração é o que dá
 * dentes a ela.
 *
 * Quatro costuras:
 *
 *   dossie_move_como     ninguém entra, ninguém sai
 *   dossie_suggest_como  e o palpite não arrasta ninguém para dentro
 *   dossie_passo_para    a busca desvia dos lugares fechados
 *   dossie_bot_passo     a máquina presa palpita ou passa, e nunca se debate
 *
 * Uso: node scripts/gera-dossie-tempestade.mjs
 */
import { writeFileSync } from "node:fs";
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local", quiet: true });
const db = new pg.Client({
  connectionString: process.env.POSTGRES_URL_NON_POOLING + "&uselibpqcompat=true",
});
await db.connect();

async function def(nome) {
  const { rows } = await db.query(
    `select pg_get_functiondef(p.oid) d from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = $1`,
    [nome],
  );
  if (!rows.length) throw new Error(`${nome} não existe`);
  // migrações antigas gravaram o corpo em CRLF; alvo de várias linhas só casa em LF
  return rows[0].d.replace(/\r\n/g, "\n");
}

function troca(texto, de, para, onde) {
  if (!texto.includes(de)) throw new Error(`não achei ${onde}`);
  return texto.replace(de, para);
}

/* ── 1. dossie_move_como: ninguém entra, ninguém sai ──────────────────────── */

let move = await def("dossie_move_como");

move = troca(
  move,
  `  if not public.dossie_can_move(tema, aqui, p_room) then
    raise exception 'UNREACHABLE';
  end if;`,
  `  if not public.dossie_can_move(tema, aqui, p_room) then
    raise exception 'UNREACHABLE';
  end if;

  /* A TEMPESTADE fecha os dois lados. Sair de um lugar fechado é tão proibido
     quanto entrar nele — a regra é "ninguém entra e ninguém sai", e conferir só
     o destino deixaria quem está preso escapar no primeiro turno. */
  fechados := public.dossie_fechados(estado);
  if p_room = any(fechados) or aqui = any(fechados) then
    raise exception 'ROOM_CLOSED';
  end if;`,
  "a checagem de alcance",
);

move = troca(
  move,
  `  aqui   text;
begin`,
  `  aqui   text;
  fechados text[];
begin`,
  "as declarações do move",
);

/* ── 2. dossie_suggest_como: o palpite não arrasta ninguém para dentro ────── */

let suggest = await def("dossie_suggest_como");

suggest = troca(
  suggest,
  `  -- se o suspeito nomeado é o peão de alguém, ele vem também
  select array_agg((value ->> 'seat')::smallint)
    into outros
    from jsonb_array_elements(estado -> 'players')
   where value ->> 'suspect' = p_suspect;
  if outros is not null then`,
  `  /* Se o suspeito nomeado é o peão de alguém, ele vem também — MENOS durante
     a tempestade, se o palpite foi feito dentro de um lugar fechado.

     Sem esta linha, quem fica preso arrasta a mesa inteira para dentro com ele,
     um palpite por vez, e a rodada de tempestade vira uma armadilha coletiva —
     o oposto exato do que a regra quer, que é dar POSIÇÃO a quem está preso.

     O objeto continua vindo: "ninguém entra" é sobre gente. Um taco de sinuca
     dentro de uma sala fechada não prende nem liberta ninguém. */
  select array_agg((value ->> 'seat')::smallint)
    into outros
    from jsonb_array_elements(estado -> 'players')
   where value ->> 'suspect' = p_suspect;
  if aqui = any(public.dossie_fechados(estado)) then
    outros := null;
  end if;
  if outros is not null then`,
  "a convocação do peão",
);

/* ── 3. dossie_bot_passo: a máquina presa não se debate ───────────────────── */

let bot = await def("dossie_bot_passo");

bot = troca(
  bot,
  `  /* 2c. ANDAR na direção da sala candidata mais próxima. */
  if (est ->> 'actionsLeft')::int >= 1 and aqui is not null then
    select s into alvo
      from unnest(sala) s
     where s <> aqui
     order by ('x' || substr(md5(semente::text || assento::text || s), 1, 6))::bit(24)::int
     limit 1;

    if alvo is not null then
      passo := public.dossie_passo_para(tema, aqui, alvo);`,
  `  /* 2c. ANDAR na direção da sala candidata mais próxima.

     Presa pela tempestade, ela não anda: cai direto no "passa". Tentar andar
     levantaria ROOM_CLOSED de dentro de \`dossie_move_como\`, e a exceção subiria
     pela faxina inteira — foi assim que o Dossiê parou de tirar o turno de
     ninguém no relógio uma vez (0033). A máquina que não pode andar passa a vez
     de propósito, não por acidente.

     E o alvo exclui o que está fechado: andar rumo a um lugar onde não se pode
     entrar é gastar o turno para bater na porta. */
  fechados := public.dossie_fechados(est);
  if (est ->> 'actionsLeft')::int >= 1 and aqui is not null
     and not (aqui = any(fechados)) then
    select s into alvo
      from unnest(sala) s
     where s <> aqui and not (s = any(fechados))
     order by ('x' || substr(md5(semente::text || assento::text || s), 1, 6))::bit(24)::int
     limit 1;

    if alvo is not null then
      passo := public.dossie_passo_para(tema, aqui, alvo, fechados);`,
  "o bloco de andar",
);

bot = troca(
  bot,
  `  susp    text[];
  arma    text[];
  sala    text[];
begin`,
  `  susp    text[];
  arma    text[];
  sala    text[];
  fechados text[];
begin`,
  "as declarações do bot",
);

await db.end();

const sql = `-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0089 · a tempestade fecha lugar de verdade
--
-- 0087 sorteia o par que mantém o mapa conexo, 0088 grava no estado. E até
-- aqui a Tempestade de Areia é duas palavras num jsonb: nada impede nada.
--
-- Esta migração é o que dá dentes a ela, e são quatro costuras:
--
--   dossie_move_como     ninguém entra, ninguém sai
--   dossie_suggest_como  e o palpite não arrasta ninguém para dentro
--   dossie_passo_para    a busca desvia do que está fechado
--   dossie_bot_passo     a máquina presa palpita ou passa, e nunca se debate
--
-- ────────────────────────────────────────────────────────────────────────────
-- OS DOIS LADOS DA PORTA
--
-- "Ninguém entra e ninguém sai" são duas checagens, não uma. Conferir só o
-- destino deixaria quem está preso escapar no primeiro turno, e a regra inteira
-- viraria um pedágio de um turno.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O PALPITE NÃO É PORTA
--
-- No Dossiê, palpitar convoca o peão do suspeito nomeado para a sala de quem
-- palpitou. Durante a tempestade, feito de DENTRO de um lugar fechado, isso
-- seria uma porta dos fundos: quem está preso arrasta a mesa inteira para
-- dentro, um palpite por vez, e a rodada vira armadilha coletiva.
--
-- O que é o oposto exato do que a regra quer. O PRD 03 §3 diz por que a
-- tempestade é jogável: "quem está dentro fica preso, mas continua podendo
-- palpitar, o que faz de um lugar fechado uma POSIÇÃO estratégica, não uma
-- punição". Posição, não isca.
--
-- O objeto continua vindo. "Ninguém" é sobre gente; um taco de sinuca dentro de
-- uma sala fechada não prende nem liberta.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE A MÁQUINA PRECISA SABER, E NÃO SÓ APANHAR
--
-- Uma máquina que tenta andar para um lugar fechado levanta ROOM_CLOSED de
-- dentro de \`dossie_move_como\`, e a exceção sobe pela varredura inteira. Foi
-- exatamente assim que o Dossiê passou uma temporada sem tirar o turno de
-- ninguém no relógio (0033): um ramo que abortava a faxina toda em silêncio.
--
-- A máquina presa passa a vez DE PROPÓSITO. É uma linha a mais e uma classe de
-- defeito a menos.
-- ════════════════════════════════════════════════════════════════════════════

/**
 * Os lugares que a tempestade fechou nesta rodada. Vazio quando não há
 * tempestade — que é o caso de três dos quatro casos e de toda mesa que
 * desligou a reviravolta.
 */
create or replace function public.dossie_fechados(p_estado jsonb)
returns text[]
language sql
immutable
as $$
  select coalesce(
    (select array_agg(value #>> '{}')
       from jsonb_array_elements(p_estado -> 'twist' -> 'fechados')),
    '{}'
  );
$$;

revoke all on function public.dossie_fechados(jsonb) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

/**
 * O primeiro passo do caminho mais curto de \`p_de\` até \`p_para\`, desviando dos
 * lugares em \`p_evitar\`.
 *
 * A versão de três argumentos é DERRUBADA e refeita com o quarto com valor
 * padrão, em vez de conviverem as duas: uma sobrecarga com padrão deixaria toda
 * chamada de três argumentos ambígua, e o erro sairia em tempo de execução,
 * dentro do turno de alguém.
 */
drop function if exists public.dossie_passo_para(jsonb, text, text);

create or replace function public.dossie_passo_para(
  p_tema jsonb, p_de text, p_para text, p_evitar text[] default '{}'
)
returns text
language plpgsql
immutable
as $$
declare
  fila    text[] := array[p_de];
  visto   text[] := array[p_de];
  origem  jsonb  := '{}'::jsonb;   -- sala -> de onde se chegou nela
  atual   text;
  v       text;
  passo   text;
begin
  if p_de is null or p_para is null or p_de = p_para then return null; end if;
  if p_para = any(coalesce(p_evitar, '{}')) then return null; end if;

  while array_length(fila, 1) > 0 loop
    atual := fila[1];
    fila := fila[2:];

    for v in
      select value #>> '{}' from jsonb_array_elements(p_tema -> 'adjacency' -> atual)
      union
      select case when pas ->> 0 = atual then pas ->> 1 else pas ->> 0 end
        from jsonb_array_elements(p_tema -> 'secretPassages') pas
       where pas ->> 0 = atual or pas ->> 1 = atual
    loop
      continue when v = any(visto);
      continue when v = any(coalesce(p_evitar, '{}'));
      visto := visto || v;
      origem := jsonb_set(origem, array[v], to_jsonb(atual), true);
      if v = p_para then
        -- volta pela trilha até o vizinho de \`p_de\`
        passo := v;
        while (origem ->> passo) is distinct from p_de loop
          passo := origem ->> passo;
          exit when passo is null;
        end loop;
        return passo;
      end if;
      fila := fila || v;
    end loop;
  end loop;

  return null;   -- inalcançável: sem tempestade o validador de temas garante que não há
end;
$$;

revoke all on function public.dossie_passo_para(jsonb, text, text, text[])
  from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

${move.trimEnd()};

revoke all on function public.dossie_move_como(smallint, uuid, text)
  from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

${suggest.trimEnd()};

revoke all on function public.dossie_suggest_como(smallint, uuid, text, text)
  from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

${bot.trimEnd()};

revoke all on function public.dossie_bot_passo(uuid) from public, anon, authenticated;
`;

writeFileSync("supabase/migrations/0089_dossie_a_tempestade_fecha.sql", sql, "utf8");
console.log("0089 gerado");
