#!/usr/bin/env node
/**
 * Gera a migração 0117 — o caderno deixa de acreditar no `pass` do álibi.
 *
 * Uso: node scripts/gera-dossie-alibi-caderno.mjs
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
    where n.nspname = 'public' and p.proname = 'dossie_deduz'`,
);
if (!rows.length) throw new Error("dossie_deduz não existe");
let deduz = rows[0].d.replace(/\r\n/g, "\n");
await db.end();

if (deduz.includes("comalibi")) {
  throw new Error("a função viva já conhece o álibi — devolva-a à migração anterior");
}

function troca(texto, de, para, onde) {
  if (!texto.includes(de)) throw new Error(`não achei ${onde}`);
  return texto.replace(de, para);
}

/* ── a lista de quem alibiou nesta rodada de refutação ─────────────────────── */

deduz = troca(
  deduz,
  `  palpite jsonb;
  autor   smallint;`,
  `  palpite jsonb;
  autor   smallint;
  /* Quem apresentou álibi desde o último palpite. Zera a cada palpite novo,
     porque a carta vale para UMA refutação. */
  comalibi jsonb := '[]'::jsonb;`,
  "as declarações do deduz",
);

deduz = troca(
  deduz,
  `      if linha ->> 'type' = 'suggest' then
        palpite := linha -> 'guess';
        autor := (linha ->> 'seat')::smallint;`,
  `      if linha ->> 'type' = 'suggest' then
        palpite := linha -> 'guess';
        autor := (linha ->> 'seat')::smallint;
        comalibi := '[]'::jsonb;

      /* ── O ÁLIBI ────────────────────────────────────────────────────────
         A única mentira legítima do jogo: não refutar TENDO a carta.

         \`dossie_pass_refute_como\` registra o álibi e, logo depois, um \`pass\`
         normal — e o \`pass\` diz "não tenho nenhuma das três", que naquele caso
         é falso. Acreditar nele não é perder informação: é FABRICAR informação
         falsa, e ela se propaga pelo laço que resolve restrições em cima do
         \`naoTem\` até riscar uma carta que está no envelope.

         A linha é PÚBLICA e a tela a narra, então saber disto não é privilégio
         de ninguém — é o que está escrito na mesa. O que a carta protege é O
         QUE ele tem, e isso continua protegido: descobre-se que não se
         descobriu nada. */
      elsif linha ->> 'type' = 'alibi' and linha -> 'seat' is not null then
        comalibi := comalibi || jsonb_build_array((linha ->> 'seat')::smallint);`,
  "o ramo do suggest",
);

deduz = troca(
  deduz,
  `      elsif linha ->> 'type' = 'pass' and palpite is not null then
        -- REGRA 1: quem passou não tem nenhuma das três
        s := linha ->> 'seat';`,
  `      elsif linha ->> 'type' = 'pass' and palpite is not null
            and not (comalibi @> jsonb_build_array((linha ->> 'seat')::smallint)) then
        -- REGRA 1: quem passou não tem nenhuma das três — a não ser que tenha
        -- apresentado álibi, e aí a passada não diz nada
        s := linha ->> 'seat';`,
  "a regra 1",
);

deduz = troca(
  deduz,
  `        for outro in select mp.seat from public.match_players mp
                      where mp.match_id = p_match and mp.seat is distinct from autor loop
          for c in select value #>> '{}' from jsonb_array_elements(palpite) loop`,
  `        /* E QUEM ALIBIOU FICA DE FORA. "Ninguém refutou" prova que nenhum dos
           outros tem nenhuma das três — de todo mundo menos de quem usou a
           carta para não refutar tendo. Para essa pessoa, a rodada não disse
           nada. */
        for outro in select mp.seat from public.match_players mp
                      where mp.match_id = p_match and mp.seat is distinct from autor
                        and not (comalibi @> jsonb_build_array(mp.seat)) loop
          for c in select value #>> '{}' from jsonb_array_elements(palpite) loop`,
  "a regra 3",
);

const CABECA = readFileSync(
  "supabase/migrations/0117_o_alibi_mente_e_o_caderno_sabe.sql",
  "utf8",
).replace(/\r\n/g, "\n");
if (CABECA.includes("CREATE OR REPLACE FUNCTION")) {
  throw new Error("o arquivo já foi gerado; parta do cabeçalho escrito à mão");
}

const sql = `${CABECA.trimEnd()}

-- ─────────────────────────────────────────────────────────────────────────────

${deduz.trimEnd()};

revoke all on function public.dossie_deduz(uuid, smallint) from public, anon, authenticated;
`;

writeFileSync("supabase/migrations/0117_o_alibi_mente_e_o_caderno_sabe.sql", sql, "utf8");
console.log("0117 gerado");
