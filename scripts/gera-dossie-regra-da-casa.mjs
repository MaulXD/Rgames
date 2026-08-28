#!/usr/bin/env node
/**
 * Gera a migração 0091 — "Reviravolta do caso" nas Regras da Casa.
 *
 * Uso: node scripts/gera-dossie-regra-da-casa.mjs
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
    where n.nspname = 'public' and p.proname = 'set_room_settings'`,
);
let f = rows[0].d.replace(/\r\n/g, "\n");
await db.end();

function troca(de, para, onde) {
  if (!f.includes(de)) throw new Error(`não achei ${onde}`);
  f = f.replace(de, para);
}

troca(
  `    when 'dossie'    then array['tema']`,
  `    when 'dossie'    then array['tema', 'reviravolta']`,
  "a lista de chaves aceitas",
);

troca(
  `    limpo := jsonb_build_object('tema', tema);`,
  `    /* A reviravolta é LIGADA por padrão, e o \`coalesce\` de três degraus é o
       que faz isso valer para as salas que existiam antes desta migração: o
       pedido, depois o que a sala já tinha, depois o padrão.

       Ligada por padrão porque é a mecânica que o sistema de temas entrega — um
       caso sem a regra dele é o Solar das Acácias com outra roupa. Quem quer o
       jogo limpo desliga em um toque, e o PRD 03 §3.5 promete exatamente isso. */
    limpo := jsonb_build_object(
      'tema', tema,
      'reviravolta', coalesce(
        (p_settings ->> 'reviravolta')::boolean,
        (sala.settings ->> 'reviravolta')::boolean,
        true)
    );`,
  "o objeto limpo do Dossiê",
);

const sql = `-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0091 · "Reviravolta do caso" nas Regras da Casa
--
-- \`dossie_start\` já lê \`settings ->> 'reviravolta'\` desde 0088. E
-- \`set_room_settings\` recusava a chave com UNKNOWN_SETTING_reviravolta, porque
-- a lista de chaves aceitas do Dossiê tinha só \`tema\`.
--
-- Ou seja: a regra existia no motor e não havia como ligá-la ou desligá-la. O
-- padrão (ligada) valia sempre, e o PRD 03 §3.5 promete o contrário — "quem quer
-- o jogo limpo joga o jogo limpo, em qualquer caso".
--
-- LIGADA POR PADRÃO é a decisão de produto. A reviravolta é a mecânica que o
-- sistema de temas entrega: um caso sem a regra dele é o Solar das Acácias com
-- outra roupa. Quem quer limpo desliga em um toque.
-- ════════════════════════════════════════════════════════════════════════════

${f.trimEnd()};

revoke all on function public.set_room_settings(uuid, jsonb) from public, anon;
grant execute on function public.set_room_settings(uuid, jsonb) to authenticated;
`;

writeFileSync("supabase/migrations/0091_dossie_regra_da_reviravolta.sql", sql, "utf8");
console.log("0091 gerado");
