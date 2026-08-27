/**
 * Gera 0052 a partir das definicoes VIVAS de letreiro_start e
 * letreiro_grade_do_dia, com UMA edicao: o sorteio passa a filtrar `usavel`.
 *
 * Escrevi as duas a mao primeiro e a versao viva era outra -- letreiro_start
 * devolve jsonb, nao public.matches, e o corpo tem ALREADY_RUNNING e chaves de
 * estado que a minha nao tinha. E a terceira vez neste projeto que copiar do
 * arquivo em vez do banco daria uma funcao errada.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { config } from "dotenv";
import pg from "pg";

config({ path: "d:/Cursor/Raul Games/.env.local", quiet: true });

const db = new pg.Client({
  connectionString: process.env.POSTGRES_URL_NON_POOLING + "&uselibpqcompat=true",
});
await db.connect();

async function viva(nome) {
  const { rows } = await db.query(
    `select pg_get_functiondef(p.oid) d
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = $1`,
    [nome],
  );
  if (rows.length !== 1) throw new Error(`${nome}: ${rows.length} definicoes`);
  return rows[0].d;
}

/** As duas trocas, e as duas TEM de casar -- se nao casarem, o sorteio ficaria
 *  contando grades fracas e escolhendo entre as usaveis, o que daria offset
 *  fora da lista e grade nula. */
function filtrar(def, nome) {
  const trocas = [
    [
      /select count\(\*\) into quantas from public\.letreiro_boards b where b\.size = (tamanho|4);/,
      (m, alvo) =>
        `select count(*) into quantas\n    from public.letreiro_boards b where b.size = ${alvo} and b.usavel;`,
    ],
    [
      /where b\.size = (tamanho|4)\n(\s*)order by b\.id/,
      (m, alvo, esp) => `where b.size = ${alvo} and b.usavel\n${esp}order by b.id`,
    ],
  ];
  for (const [re, sub] of trocas) {
    const antes = def;
    def = def.replace(re, sub);
    if (def === antes) throw new Error(`${nome}: a troca ${re} nao casou`);
  }
  return def;
}

const cabeca = readFileSync(
  "C:/Users/Raul/AppData/Local/Temp/claude/d--Cursor-Raul-Games/b2ace913-8917-499e-ab08-b5c6122c682e/scratchpad/0052-cabeca.sql",
  "utf8",
);

const start = filtrar(await viva("letreiro_start"), "letreiro_start");
const dia = filtrar(await viva("letreiro_grade_do_dia"), "letreiro_grade_do_dia");

await db.end();

const rodape = `
revoke all on function public.letreiro_start(uuid) from public, anon, authenticated;
grant execute on function public.letreiro_start(uuid) to authenticated;
revoke all on function public.letreiro_grade_do_dia(date) from public, anon, authenticated;
`;

writeFileSync(
  "d:/Cursor/Raul Games/supabase/migrations/0052_grade_fraca_nao_sorteia.sql",
  cabeca +
    "\n-- ── a partida sorteia só entre as usáveis ──────────────────────────────────\n\n" +
    start.trimEnd() +
    ";\n\n-- ── e o desafio diário também ──────────────────────────────────────────────\n\n" +
    dia.trimEnd() +
    ";\n" +
    rodape,
  "utf8",
);
console.log("0052 gerado das definicoes vivas");
