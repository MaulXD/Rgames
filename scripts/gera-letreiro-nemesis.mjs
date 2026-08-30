#!/usr/bin/env node
/**
 * Gera a migração 0114 — o Nêmesis passa a ser contado.
 *
 * Uso: node scripts/gera-letreiro-nemesis.mjs
 *
 * Parte da definição VIVA de `letreiro_score_bruto` — ver o cabeçalho de
 * `scripts/defs.mjs` para a armadilha disso.
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
    where n.nspname = 'public' and p.proname = 'letreiro_score_bruto'`,
);
if (!rows.length) throw new Error("letreiro_score_bruto não existe");
let bruto = rows[0].d.replace(/\r\n/g, "\n");
await db.end();

if (bruto.includes("letreiro_nemesis")) {
  throw new Error(
    "a função viva já conta o nêmesis — devolva-a à migração que a definiu por último antes desta",
  );
}

const DE = `  create temp table _quantos on commit drop as
  select palavra, count(distinct user_id)::int quantos from _sub group by palavra;
`;
if (!bruto.includes(DE)) throw new Error("não achei a tabela _quantos");

bruto = bruto.replace(
  DE,
  `${DE}
  /* ── O NÊMESIS ──────────────────────────────────────────────────────────
     Com quem você mais tromba na mesma palavra. A conta cabe aqui porque é
     aqui que \`_sub\` existe: quem achou o quê, já validado contra o gabarito e
     contra o caminho.

     O auto-encontro de \`_sub\` com ela mesma em usuários diferentes JÁ é a
     definição de choque — não precisa de \`_quantos\`, que só conta o mesmo de
     outro jeito.

     Duas linhas por choque, uma para cada lado, e é a política de leitura que
     pede isso: guardar \`(menor, maior)\` uma vez só obrigaria a política a me
     deixar ler linhas em que eu sou o \`maior\`, e aí a mesma política deixaria
     alguém ler a minha.

     Máquina fora. Numa partida solo quem mais tromba com você é o Nestor,
     porque ele joga todas as rodadas — o número seria verdadeiro e a frase
     seria vazia.

     E só onde trombar CUSTA: na regra gananciosa as duas pessoas ficam com os
     pontos, e "anular" não aconteceu. */
  if regra <> 'gananciosa' then
    insert into public.letreiro_nemesis (eu, outro, vezes, visto)
    select a.user_id, b.user_id, count(*)::int, now()
      from _sub a
      join _sub b on b.palavra = a.palavra and b.user_id <> a.user_id
      join public.profiles pa on pa.id = a.user_id and not pa.is_bot
      join public.profiles pb on pb.id = b.user_id and not pb.is_bot
     group by a.user_id, b.user_id
    on conflict (eu, outro) do update
       set vezes = public.letreiro_nemesis.vezes + excluded.vezes,
           visto = now();
  end if;
`,
);

const CABECA = readFileSync("supabase/migrations/0114_o_nemesis_ganha_tabela.sql", "utf8").replace(
  /\r\n/g,
  "\n",
);
if (CABECA.includes("CREATE OR REPLACE FUNCTION public.letreiro_score_bruto")) {
  throw new Error("o arquivo já foi gerado; parta do cabeçalho escrito à mão");
}

const sql = `${CABECA.trimEnd()}

-- ─────────────────────────────────────────────────────────────────────────────

${bruto.trimEnd()};

revoke all on function public.letreiro_score_bruto(uuid) from public, anon, authenticated;
`;

writeFileSync("supabase/migrations/0114_o_nemesis_ganha_tabela.sql", sql, "utf8");
console.log("0114 gerado");
