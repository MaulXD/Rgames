#!/usr/bin/env node
/**
 * Despeja a definição VIVA de uma ou mais funções do banco.
 *
 *   node scripts/defs.mjs dossie_advance dominio_atacar_como
 *
 * Existe porque toda migração que muda uma função PL/pgSQL neste projeto é
 * gerada a partir do que está no banco, e não reescrita à mão — são quinze
 * geradores em `scripts/gera-*.mjs` fazendo isso. Antes de escrever o
 * dezesseis, o passo é sempre o mesmo: olhar a definição de agora e escolher a
 * âncora do `replace`.
 *
 * E ESSE PASSO TEM UMA ARMADILHA, que este arquivo existe para lembrar.
 *
 * Gerar a partir da definição viva SOMA quando ela já tem a mudança. Se um
 * gerador rodou uma vez, rodá-lo de novo empilha o novo trecho em cima do
 * anterior em vez de substituí-lo — aconteceu na 0113, e o resultado foi um
 * ataque escrevendo duas linhas de registro em vez de uma. O conserto é
 * devolver a função ao estado da última migração que a definiu antes da sua, e
 * gerar uma vez só.
 *
 * O `replace(/\r\n/g, "\n")` não é enfeite: migrações antigas guardaram corpos
 * com CRLF, e uma âncora escrita com LF não casa com eles.
 */
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local", quiet: true });

const db = new pg.Client({
  connectionString: process.env.POSTGRES_URL_NON_POOLING + "&uselibpqcompat=true",
});
await db.connect();

for (const nome of process.argv.slice(2)) {
  const { rows } = await db.query(
    `select pg_get_functiondef(p.oid) d from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = $1
      order by p.oid`,
    [nome],
  );
  if (!rows.length) {
    console.error(`\n══════ ${nome} — não existe no banco`);
    continue;
  }
  console.log(`\n══════ ${nome} ══════`);
  for (const r of rows) console.log(r.d.replace(/\r\n/g, "\n"));
}

await db.end();
