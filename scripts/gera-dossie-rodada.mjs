#!/usr/bin/env node
/**
 * Gera a migração 0086 — a rodada do Dossiê passa a existir.
 *
 * As três reviravoltas do PRD 03 §6.7 são todas contadas em RODADAS: o Apagão
 * cai numa rodada sorteada entre a 4 e a 8, a Tempestade vira o vento a cada 3,
 * o Registro publica um fato a cada 4. E o estado do Dossiê não tem rodada
 * nenhuma — tem `turnSeat`, que é outra coisa.
 *
 * Então a primeira peça não é reviravolta: é o contador. Sem ele as três não
 * têm em que se apoiar.
 *
 * COMO SE CONTA UMA RODADA com gente virando fantasma no meio: a rodada vira
 * quando o turno DÁ A VOLTA, isto é, quando o próximo assento não é maior que o
 * atual. Isso continua certo quando o assento 2 vira fantasma e a ordem passa a
 * ser 0 → 1 → 3 → 0, e continua certo quando sobra um só (`prox = atual`, que
 * `<=` pega).
 *
 * A migração é gerada a partir da definição VIVA de `dossie_start` — duzentas
 * linhas em que eu só quero acrescentar uma chave. Copiar do arquivo de
 * migração já custou três erros de "cannot change return type" nesta sessão.
 *
 * Uso: node scripts/gera-dossie-rodada.mjs
 */
import { writeFileSync } from "node:fs";
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local", quiet: true });
const db = new pg.Client({
  connectionString: process.env.POSTGRES_URL_NON_POOLING + "&uselibpqcompat=true",
});
await db.connect();

const { rows } = await db.query(
  `select pg_get_functiondef(p.oid) d from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'dossie_start'`,
);
let start = rows[0].d;

const alvo = `    'seq', 0,`;
if (!start.includes(alvo)) throw new Error("nao achei a chave 'seq' no estado inicial");
start = start.replace(alvo, `    'round', 1,\n${alvo}`);

await db.end();

const sql = `-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0086 · a rodada do Dossiê passa a existir
--
-- As três reviravoltas do PRD 03 §6.7 são todas contadas em RODADAS:
--
--   Apagão      uma rodada sorteada entre a 4 e a 8
--   Tempestade  o vento vira a cada 3, com aviso uma antes
--   Registro    um fato público a cada 4
--
-- E o estado do Dossiê não tinha rodada nenhuma. Tinha \`turnSeat\`, que é de
-- quem é a vez — outra coisa. Escrever as três reviravoltas em cima de um
-- contador que não existe seria escrever três vezes o mesmo contador, cada uma
-- com uma definição ligeiramente diferente de "rodada".
--
-- COMO SE CONTA UMA RODADA quando gente vira fantasma no meio: a rodada vira
-- quando o turno DÁ A VOLTA — quando o próximo assento não é maior que o atual.
-- Continua certo quando o assento 2 vira fantasma e a ordem passa a ser
-- 0 → 1 → 3 → 0, e continua certo quando sobra um jogador só, caso em que
-- \`prox = atual\` e o \`<=\` pega.
--
-- A alternativa óbvia — "contei N turnos, logo passou uma rodada" — quebra
-- exatamente aí: o número de turnos por rodada muda quando alguém é eliminado.
--
-- PARTIDAS EM ANDAMENTO não têm a chave. Quem lê usa \`coalesce(…, 1)\`, e a
-- partida velha se comporta como se estivesse na primeira rodada para sempre —
-- o que é inofensivo, porque nenhuma delas tem reviravolta ligada.
-- ════════════════════════════════════════════════════════════════════════════

${start.trimEnd()};

revoke all on function public.dossie_start(uuid, text) from public, anon;
grant execute on function public.dossie_start(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

/**
 * Passa a vez, e vira a rodada quando o turno dá a volta.
 */
create or replace function public.dossie_advance(p_match uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m       public.matches;
  prox    smallint;
  atual   smallint;
  rodada  int;
  estado  jsonb;
begin
  select * into m from public.matches where id = p_match;
  estado := m.public_state;

  atual := (estado ->> 'turnSeat')::smallint;
  prox  := public.dossie_next_seat(estado, atual);

  if prox is null then
    -- todos viraram fantasma: o envelope é aberto e ninguém venceu
    update public.matches
       set status = 'finished',
           ended_at = now(),
           version = version + 1,
           turn_deadline = null,
           public_state = estado || jsonb_build_object(
             'phase', 'over',
             'winner', null,
             'solution', m.solution,
             'pending', null
           )
     where id = p_match;
    update public.rooms set status = 'lobby' where id = m.room_id;
    return;
  end if;

  /* A volta ao começo. \`<=\` e não \`<\` porque com um jogador só o próximo é
     ele mesmo, e a rodada tem de virar do mesmo jeito. */
  rodada := coalesce((estado ->> 'round')::int, 1);
  if prox <= atual then
    rodada := rodada + 1;
  end if;

  update public.matches
     set version = version + 1,
         turn_deadline = now() + interval '90 seconds',
         public_state = estado || jsonb_build_object(
           'phase', 'turn',
           'turnSeat', prox,
           'round', rodada,
           'actionsLeft', 2,
           'pending', null
         )
   where id = p_match;
end;
$$;

revoke all on function public.dossie_advance(uuid) from public, anon, authenticated;
`;

writeFileSync("supabase/migrations/0086_dossie_a_rodada_existe.sql", sql, "utf8");
console.log("0086 gerado");
