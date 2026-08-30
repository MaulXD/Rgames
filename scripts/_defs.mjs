import { config } from "dotenv";
import pg from "pg";
config({ path: ".env.local", quiet: true });
const db = new pg.Client({ connectionString: process.env.POSTGRES_URL_NON_POOLING + "&uselibpqcompat=true" });
await db.connect();
for (const nome of process.argv.slice(2)) {
  const { rows } = await db.query(
    `select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = $1`, [nome]);
  console.log(`\n══════ ${nome} ══════`);
  for (const r of rows) console.log(r.d.replace(/\r\n/g, "\n"));
}
await db.end();
