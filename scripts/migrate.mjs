#!/usr/bin/env node
/**
 * Aplica os arquivos de supabase/migrations em ordem, uma vez cada.
 * Usa POSTGRES_URL_NON_POOLING (conexão direta — DDL não funciona bem no pooler).
 *
 *   node scripts/migrate.mjs          aplica o que falta
 *   node scripts/migrate.mjs --status só lista
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(root, ".env.local"), quiet: true });

const url = process.env.POSTGRES_URL_NON_POOLING;
if (!url) {
  console.error("Falta POSTGRES_URL_NON_POOLING no .env.local");
  process.exit(1);
}

const dir = join(root, "supabase", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const statusOnly = process.argv.includes("--status");

/**
 * O Supabase serve a conexão direta com uma CA própria. A partir do pg 8.16,
 * `sslmode=require` na URL é tratado como `verify-full` e a conexão quebra com
 * "self-signed certificate". `uselibpqcompat` devolve a semântica do libpq:
 * conexão criptografada, sem verificar a cadeia.
 */
const conn = new URL(url);
conn.searchParams.set("uselibpqcompat", "true");

const client = new pg.Client({ connectionString: conn.toString() });
await client.connect();

// A tabela de controle não pode ficar legível pela API. RLS ligada e sem
// nenhuma policy = ninguém lê pelo PostgREST; só a conexão direta enxerga.
await client.query(`
  create table if not exists public._migrations (
    name       text primary key,
    applied_at timestamptz not null default now()
  );
  alter table public._migrations enable row level security;
  revoke all on public._migrations from anon, authenticated;
`);

const { rows } = await client.query("select name from public._migrations");
const done = new Set(rows.map((r) => r.name));

let applied = 0;
for (const name of files) {
  if (done.has(name)) {
    console.log(`  ok      ${name}`);
    continue;
  }
  if (statusOnly) {
    console.log(`  pendente ${name}`);
    continue;
  }
  const sql = readFileSync(join(dir, name), "utf8");
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("insert into public._migrations (name) values ($1)", [name]);
    await client.query("commit");
    console.log(`  aplicada ${name}`);
    applied++;
  } catch (err) {
    await client.query("rollback");
    console.error(`\n  FALHOU  ${name}\n  ${err.message}\n`);
    await client.end();
    process.exit(1);
  }
}

await client.end();
console.log(statusOnly ? "" : `\n${applied} migração(ões) aplicada(s).`);
