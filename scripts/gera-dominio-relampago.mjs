#!/usr/bin/env node
/**
 * Gera a migração 0098 — o modo Relâmpago do Domínio.
 *
 * Uso: node scripts/gera-dominio-relampago.mjs
 */
import { writeFileSync } from "node:fs";
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

let start = await def("dominio_start");
let cfg = await def("set_room_settings");
await db.end();

function troca(texto, de, para, onde) {
  if (!texto.includes(de)) throw new Error(`não achei ${onde}`);
  return texto.replace(de, para);
}

/* ── dominio_start ────────────────────────────────────────────────────────── */

start = troca(
  start,
  `  select data into mapa from public.game_themes gt where gt.id = 'vantara';`,
  `  /* O MAPA SAI DO MODO, e é a única coisa que o Relâmpago muda de verdade.

     A leitura do mapa se mudou de lugar: ela ficava aqui em cima, antes de
     'modo' existir. Agora depende dele. */
  modo := coalesce(sala.settings ->> 'modo', 'campanha');
  if modo not in ('campanha', 'classico', 'relampago') then modo := 'campanha'; end if;

  qual_mapa := case modo when 'relampago' then 'relampago' else 'vantara' end;
  select data into mapa from public.game_themes gt where gt.id = qual_mapa;`,
  "a leitura do mapa",
);

start = troca(
  start,
  `  modo := coalesce(sala.settings ->> 'modo', 'campanha');
  if modo not in ('campanha', 'classico') then modo := 'campanha'; end if;
`,
  ``,
  "a leitura antiga do modo",
);

start = troca(
  start,
  `    'map', 'vantara',`,
  `    'map', qual_mapa,`,
  "a chave do mapa no estado",
);

start = troca(
  start,
  `    'rodadaFinal', case modo when 'campanha' then 12 else null end,`,
  `    /* Doze rodadas na Campanha, DEZ no Relâmpago, nenhuma no Clássico.
       O Relâmpago é a Campanha num mapa menor e com duas rodadas a menos: as
       regras são as mesmas, e é isso que o faz caber numa hora sem virar outro
       jogo (PRD 04 §5.2). */
    'rodadaFinal', case modo
                     when 'campanha'  then 12
                     when 'relampago' then 10
                     else null
                   end,`,
  "a rodada final",
);

start = troca(
  start,
  `  modo      text;`,
  `  modo      text;
  qual_mapa text;`,
  "as declarações",
);

/* ── set_room_settings ────────────────────────────────────────────────────── */

cfg = troca(
  cfg,
  `    modo := coalesce(p_settings ->> 'modo', sala.settings ->> 'modo', 'campanha');
    if modo not in ('campanha', 'classico') then raise exception 'BAD_MODE'; end if;`,
  `    modo := coalesce(p_settings ->> 'modo', sala.settings ->> 'modo', 'campanha');
    if modo not in ('campanha', 'classico', 'relampago') then raise exception 'BAD_MODE'; end if;`,
  "o vocabulário de modos do Domínio",
);

const sql = `-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0098 · o modo Relâmpago do Domínio (PRD 04 §3 e §5.2)
--
-- O último modo que faltava nos quatro jogos. As Regras da Casa diziam isto,
-- em texto, para quem abrisse o painel:
--
--     "O Relâmpago do PRD não está aqui: ele pede um mapa de 24 territórios
--      que ainda não existe, e um rótulo que o jogo não cumpre é pior que
--      rótulo nenhum. Quando o mapa existir, ele aparece."
--
-- O mapa existe. Ele aparece.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O RELÂMPAGO É UM ARQUIVO DE DADOS, NÃO UM SEGUNDO JOGO
--
-- É a frase do PRD, e ela é literal aqui: o modo troca DUAS coisas.
--
--   o mapa      \`relampago\` no lugar de \`vantara\` — 24 territórios em vez de
--               42, recortados do sul de Vantara pelo
--               \`scripts/gera-mapa-relampago.mjs\`
--   as rodadas  10 em vez de 12
--
-- Nada mais. Combate, reforço, cartas, objetivos, pontuação, o não-eliminar da
-- Campanha: tudo igual. Se este bloco precisasse de um terceiro item, o
-- Relâmpago teria virado um jogo separado disfarçado de opção.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O RECORTE, E POR QUE ELE NÃO É "O OESTE"
--
-- O PRD pede "Meridiana, Velária, Sarnath, Nauria + oeste de Khadar". Os quatro
-- continentes dão 21 e faltam três de Khadar — e os três mais a oeste pela
-- coluna deixariam o mapa PARTIDO: a Nauria tem uma porta de terra só,
-- \`corais → amur\`, e \`amur\` fica na coluna 9.
--
-- A fatia é \`guran\`, \`ryn\`, \`amur\`: a mesma quantidade, e a que forma a ponte.
-- Eles viram Sarnath, que é com quem fazem fronteira. O validador confere a
-- contiguidade, a conexidade e o grau médio dos DOIS mapas com o mesmo código —
-- é isso que faz o recorte ser dado em vez de engenharia.
--
-- ────────────────────────────────────────────────────────────────────────────
-- E O CLIENTE PAROU DE IMPORTAR VANTARA
--
-- \`lib/dominio/vantara.ts\` exportava \`TERRITORIOS\`, \`POR_ID\` e \`GRADE\` como
-- constantes de módulo, e três componentes as usavam direto. Com dois mapas
-- isso é uma armadilha silenciosa: numa partida Relâmpago a tela desenharia
-- Vantara sobre um estado de 24 territórios, e o resultado é um mapa com metade
-- dos lugares vazios — sem erro, sem aviso, sem nada.
--
-- As constantes foram embora e viraram \`mapaDe(st.map)\`. Quem encontrou os usos
-- esquecidos foi o compilador, hoje.
-- ════════════════════════════════════════════════════════════════════════════

${cfg.trimEnd()};

revoke all on function public.set_room_settings(uuid, jsonb) from public, anon;
grant execute on function public.set_room_settings(uuid, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

${start.trimEnd()};

revoke all on function public.dominio_start(uuid) from public, anon;
grant execute on function public.dominio_start(uuid) to authenticated;
`;

writeFileSync("supabase/migrations/0098_dominio_relampago.sql", sql, "utf8");
console.log("0098 gerado");
