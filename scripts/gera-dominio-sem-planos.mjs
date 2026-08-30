#!/usr/bin/env node
/**
 * Gera a migração 0115 — o campo morto sai de `dominio_start`.
 *
 * Uso: node scripts/gera-dominio-sem-planos.mjs
 *
 * Parte da definição VIVA — ver o cabeçalho de `scripts/defs.mjs`.
 */
import { readFileSync, writeFileSync } from "node:fs";
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
    where n.nspname = 'public' and p.proname = 'dominio_start'`,
);
if (!rows.length) throw new Error("dominio_start não existe");
let start = rows[0].d.replace(/\r\n/g, "\n");
await db.end();

const DE = `        'objetivo', objs -> (ordem_obj[i])::int,
        'cartas', '[]'::jsonb,
        'planos', '[]'::jsonb
      )`;
const PARA = `        'objetivo', objs -> (ordem_obj[i])::int,
        'cartas', '[]'::jsonb
      )`;
if (!start.includes(DE)) {
  throw new Error("não achei o campo morto — a função já foi limpa?");
}
start = start.replace(DE, PARA);

const CABECA = readFileSync(
  "supabase/migrations/0115_estado_privado_sem_campo_morto.sql",
  "utf8",
).replace(/\r\n/g, "\n");
if (CABECA.includes("CREATE OR REPLACE FUNCTION")) {
  throw new Error("o arquivo já foi gerado; parta do cabeçalho escrito à mão");
}

const sql = `${CABECA.trimEnd()}

-- ─────────────────────────────────────────────────────────────────────────────

${start.trimEnd()};

revoke all on function public.dominio_start(uuid) from public, anon;
grant execute on function public.dominio_start(uuid) to authenticated;
`;

writeFileSync("supabase/migrations/0115_estado_privado_sem_campo_morto.sql", sql, "utf8");
console.log("0115 gerado");
