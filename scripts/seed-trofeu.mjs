#!/usr/bin/env node
/**
 * Publica os radicais que não viram troféu no perfil.
 *
 *   npm run trofeu
 *
 * A estatística "palavra mais rara já encontrada" procura o INCOMUM, e num
 * dicionário completo de português procurar o incomum encontra, mais cedo ou
 * mais tarde, palavrão e xingamento. O troféu fica no perfil, e o perfil existe
 * para ser mostrado.
 *
 * A palavra continua valendo na partida — pontua, aparece na revelação, conta.
 * O que ela não faz é virar o troféu permanente de alguém.
 *
 * ESTE SCRIPT IMPRIME O QUE CADA RADICAL CAPTURA, e isso é metade do porquê ele
 * existe: radical casa por prefixo, e prefixo é fácil de errar. `cag` pegaria
 * `cágado`. A saída é para ser LIDA — se aparecer palavra inocente na lista de
 * um radical, o radical está errado.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(raiz, ".env.local"), quiet: true });

const radicais = readFileSync(join(raiz, "data", "letreiro-fora-do-trofeu.txt"), "utf8")
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"))
  .map((l) => l.replace(/-$/, "").toUpperCase());

const curtos = radicais.filter((r) => r.length < 5);
if (curtos.length) {
  console.error(`\nRadical curto demais (mínimo 5): ${curtos.join(", ")}`);
  console.error("Radical curto pega palavra inocente. Nada foi publicado.\n");
  process.exit(1);
}

const url = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
const db = new pg.Client({ connectionString: `${url}&uselibpqcompat=true` });
await db.connect();

console.log(`\nLetreiro — o que não vira troféu\n`);
console.log(`  ${radicais.length} radicais lidos de data/letreiro-fora-do-trofeu.txt\n`);

await db.query("truncate table public.letreiro_fora_do_trofeu");
for (const r of radicais) {
  await db.query(
    "insert into public.letreiro_fora_do_trofeu (radical) values ($1) on conflict do nothing",
    [r],
  );
}

/* O QUE CADA RADICAL PEGA, e só o que tem posto no corpus: sem posto a palavra
   nunca seria escolhida como troféu de qualquer forma, e listá-la aqui encheria
   a saída de flexão que ninguém diz. Saída cheia de lixo é saída que se aprende
   a não ler. */
const { rows } = await db.query(
  `select f.radical, count(d.norm)::int quantas,
          coalesce(string_agg(d.word, ' ' order by d.freq), '') exemplos
     from public.letreiro_fora_do_trofeu f
     left join public.dict_pt d on d.norm like f.radical || '%' and d.freq is not null
    group by f.radical
    order by f.radical`,
);

let vazios = 0;
for (const r of rows) {
  if (r.quantas === 0) {
    vazios++;
    continue;
  }
  const lista = r.exemplos.split(" ").slice(0, 8).join(" ");
  console.log(
    `  ${r.radical.toLowerCase().padEnd(12)} ${String(r.quantas).padStart(3)}  ${lista}${r.quantas > 8 ? " …" : ""}`,
  );
}

const total = rows.reduce((a, r) => a + r.quantas, 0);
console.log(`\n  ${total} palavra(s) do corpus não podem virar troféu`);
if (vazios) {
  console.log(
    `  aviso   ${vazios} radical(is) não pegam nada com posto — inofensivos, mas não fazem nada`,
  );
}
console.log("\n  Leia a lista acima. Palavra inocente ali é radical errado.\n");

await db.end();
