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
    where n.nspname = 'public' and p.proname = 'letreiro_premia'`,
);
let premia = rows[0].d.replace(/\r\n/g, "\n");
await db.end();

const de = `      join public.dict_pt d on d.norm = (w ->> 'w')
     where d.freq is not null
     order by d.freq desc
     limit 1;`;
const para = `      join public.dict_pt d on d.norm = (w ->> 'w')
     where d.freq is not null
       -- e o troféu tem de ser apresentável: ver 0095
       and public.palavra_apresentavel(d.norm)
     order by d.freq desc
     limit 1;`;
if (!premia.includes(de)) throw new Error("não achei a consulta da rara");
premia = premia.replace(de, para);

const sql = `-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0096 · a apuração consulta a lista antes de gravar o troféu
--
-- 0095 criou \`palavra_apresentavel\` e a tabela de radicais, e ninguém as
-- chamava. Uma linha. É a metade do trabalho que não aparece em lugar nenhum e
-- sem a qual as outras duzentas não valem nada — mesma forma da 0088, em que as
-- três reviravoltas existiam e nada as disparava.
--
-- A palavra continua valendo na partida: pontua, aparece na revelação, conta
-- para as conquistas. O que ela não faz é virar o troféu permanente do perfil.
-- ════════════════════════════════════════════════════════════════════════════

${premia.trimEnd()};

revoke all on function public.letreiro_premia(uuid) from public, anon, authenticated;
`;

writeFileSync("supabase/migrations/0096_letreiro_trofeu_filtrado.sql", sql, "utf8");
console.log("0096 gerado");
