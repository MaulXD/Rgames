#!/usr/bin/env node
/**
 * Gera a migração 0092 — a máquina presa palpita em vez de passar.
 *
 * Uso: node scripts/gera-dossie-presa-palpita.mjs
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
    where n.nspname = 'public' and p.proname = 'dossie_bot_passo'`,
);
let bot = rows[0].d.replace(/\r\n/g, "\n");
await db.end();

function troca(de, para, onde) {
  if (!bot.includes(de)) throw new Error(`não achei ${onde}`);
  bot = bot.replace(de, para);
}

/* `fechados` era lido no bloco 2c; o 2b precisa dele antes. */
troca(
  `  aqui := est -> 'positions' ->> assento::text;`,
  `  aqui := est -> 'positions' ->> assento::text;
  fechados := public.dossie_fechados(est);`,
  "a leitura da posição",
);

troca(
  `  fechados := public.dossie_fechados(est);
  if (est ->> 'actionsLeft')::int >= 1 and aqui is not null
     and not (aqui = any(fechados)) then`,
  `  if (est ->> 'actionsLeft')::int >= 1 and aqui is not null
     and not (aqui = any(fechados)) then`,
  "a leitura duplicada no bloco de andar",
);

troca(
  `     and (nivel = 'facil' or aqui = any(sala) or coalesce(array_length(sala, 1), 0) <= 1) then`,
  `     and (nivel = 'facil' or aqui = any(sala) or coalesce(array_length(sala, 1), 0) <= 1
          /* PRESA PELA TEMPESTADE, ela palpita de qualquer jeito.

             Aqui a regra normal ("não gaste turno palpitando num lugar que
             você já riscou") se inverte, porque a alternativa mudou. Solta, a
             escolha é entre palpitar num lugar riscado e ANDAR até um que
             importa — e andar ganha. Presa, a escolha é entre palpitar num
             lugar riscado e NÃO FAZER NADA.

             E palpitar nunca é nada: mesmo com o lugar já descartado, as
             respostas ensinam sobre o suspeito e o objeto. É exatamente a
             razão pela qual o PRD 03 §3 diz que lugar fechado é posição e não
             punição — a máquina precisa jogar isso, não só sofrer. */
          or aqui = any(fechados)) then`,
  "a condição de palpitar",
);

const sql = `-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0092 · a máquina presa pela tempestade palpita em vez de passar
--
-- 0089 ensinou a máquina a não se debater contra uma porta fechada: presa, ela
-- não tenta andar. Mas a regra que decide se ela PALPITA continuou a mesma —
-- "só palpite se este lugar ainda é candidato" —, e presa num lugar já riscado
-- ela passava a vez.
--
-- A regra estava certa e virou errada quando o contexto mudou, que é o jeito
-- mais silencioso de uma regra ficar errada.
--
--   Solta:  palpitar num lugar riscado  ×  ANDAR até um que importa  → andar
--   Presa:  palpitar num lugar riscado  ×  NÃO FAZER NADA            → palpitar
--
-- Palpitar nunca é nada. Mesmo com o lugar já descartado, as respostas da mesa
-- ensinam sobre o suspeito e sobre o objeto — duas das três colunas do caderno.
--
-- E é exatamente o que o PRD 03 §3 diz que a Tempestade de Areia deve ser:
-- "quem está dentro fica preso, mas continua podendo palpitar, o que faz de um
-- lugar fechado uma POSIÇÃO estratégica, não uma punição".
--
-- A máquina precisa JOGAR isso, não só sofrer. Uma reviravolta que só as pessoas
-- sabem aproveitar é uma reviravolta que torna a máquina mais fácil — e o modo
-- solo é onde a maioria das partidas deste projeto vai acontecer.
-- ════════════════════════════════════════════════════════════════════════════

${bot.trimEnd()};

revoke all on function public.dossie_bot_passo(uuid) from public, anon, authenticated;
`;

writeFileSync("supabase/migrations/0092_dossie_presa_palpita.sql", sql, "utf8");
console.log("0092 gerado");
