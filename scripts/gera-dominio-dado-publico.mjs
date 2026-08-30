#!/usr/bin/env node
/**
 * Gera a migração 0113 — o assalto entra no registro.
 *
 * Uso: node scripts/gera-dominio-dado-publico.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local", quiet: true });
const db = new pg.Client({
  connectionString: process.env.POSTGRES_URL_NON_POOLING + "&uselibpqcompat=true",
});
await db.connect();

async function def(nome) {
  const { rows } = await db.query(
    `select pg_get_functiondef(p.oid) d from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = $1`,
    [nome],
  );
  if (!rows.length) throw new Error(`${nome} não existe`);
  return rows[0].d.replace(/\r\n/g, "\n");
}

let atacar = await def("dominio_atacar_como");
await db.end();

function troca(texto, de, para, onde) {
  if (!texto.includes(de)) throw new Error(`não achei ${onde}`);
  return texto.replace(de, para);
}

/* Este gerador parte da definição VIVA. Se ela já tiver uma versão anterior
   desta mudança, o certo é devolver a função ao estado da migração que a
   definiu por último antes daqui (0078) e rodar de novo — somar em cima de si
   mesmo produz duas linhas de registro por ataque, que foi exatamente o defeito
   que esta migração existe para não ter. */

/* ── a rolagem entra no registro, SEM CUSTAR UMA LINHA A MAIS ─────────────── */

atacar = troca(
  atacar,
  `      'k', 'conquista', 'seat', meu, 'de', p_de, 'para', p_para, 'vitima', vitima));`,
  `      'k', 'conquista', 'seat', meu, 'de', p_de, 'para', p_para, 'vitima', vitima,
      'rodadas', assaltos));`,
  "a linha da conquista",
);

atacar = troca(
  atacar,
  `  if conquista then
    -- Um exército muda de território AGORA`,
  `  /* O ATAQUE QUE NÃO CONQUISTA DEIXA DE SER INVISÍVEL.

     A conquista sempre teve linha; sangrar sem tomar nada não tinha — e é o
     que explica por que alguém ficou fraco no meio da partida.

     E é UMA linha por ataque, nunca duas: quando há conquista, as rolagens
     viajam dentro da própria linha da conquista. O registro é capado em 80
     linhas, e uma linha a mais por ataque cortava pela metade a história que
     cabe ali — o primeiro desenho fazia isso, e o teste que confere as
     conquistas do registro parou de achar conquista nenhuma. */
  if not conquista then
    est := public.dominio_log(est, jsonb_build_object(
      'k', 'assalto', 'seat', meu, 'de', p_de, 'para', p_para,
      'vitima', vitima, 'rodadas', assaltos));
  end if;

  if conquista then
    -- Um exército muda de território AGORA`,
  "o ramo da conquista",
);

const CABECA = readFileSync("supabase/migrations/0113_o_dado_cai_para_a_mesa.sql", "utf8").replace(
  /\r\n/g,
  "\n",
);
/* O guarda procura a DEFINIÇÃO, e não o nome: o cabeçalho escrito à mão cita
   a função em prosa, e procurar o nome fazia o gerador se recusar a rodar a
   primeira vez. */
if (CABECA.includes("CREATE OR REPLACE FUNCTION")) {
  throw new Error("o arquivo já foi gerado; parta do cabeçalho escrito à mão");
}

const sql = `${CABECA.trimEnd()}

-- ─────────────────────────────────────────────────────────────────────────────

${atacar.trimEnd()};

revoke all on function public.dominio_atacar_como(smallint, uuid, text, text, integer)
  from public, anon, authenticated;
`;

writeFileSync("supabase/migrations/0113_o_dado_cai_para_a_mesa.sql", sql, "utf8");
console.log("0113 gerado");
