#!/usr/bin/env node
/**
 * Gera a migração 0093 — as quatro bandejas do Letreiro.
 *
 * Duas costuras:
 *
 *   set_room_settings  aceita e valida a chave `bandeja`
 *   letreiro_start     congela a escolha no estado da partida
 *
 * Uso: node scripts/gera-letreiro-bandeja.mjs
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

let cfg = await def("set_room_settings");
let start = await def("letreiro_start");
await db.end();

function troca(texto, de, para, onde) {
  if (!texto.includes(de)) throw new Error(`não achei ${onde}`);
  return texto.replace(de, para);
}

/* ── set_room_settings ────────────────────────────────────────────────────── */

cfg = troca(
  cfg,
  `    when 'letreiro'  then array['modo', 'anulacao', 'tamanho']`,
  `    when 'letreiro'  then array['modo', 'anulacao', 'tamanho', 'bandeja']`,
  "a lista de chaves do Letreiro",
);

cfg = troca(
  cfg,
  `    if tam not in (4, 5) then raise exception 'BAD_SIZE'; end if;

    limpo := jsonb_build_object('modo', modo, 'anulacao', anul, 'tamanho', tam);`,
  `    if tam not in (4, 5) then raise exception 'BAD_SIZE'; end if;

    /* A BANDEJA NÃO MUDA REGRA NENHUMA, e é validada com o mesmo rigor.

       A lista fechada aqui é o que impede a chave de virar campo de texto livre
       — um \`bandeja: "roxo"\` que o CSS não conhece deixaria a mesa sem material
       nenhum, e o defeito apareceria só na tela de quem escolheu. */
    band := coalesce(p_settings ->> 'bandeja', sala.settings ->> 'bandeja', 'nogueira');
    if band not in ('nogueira', 'osso', 'fliperama', 'meridiano') then
      raise exception 'BAD_TRAY';
    end if;

    limpo := jsonb_build_object(
      'modo', modo, 'anulacao', anul, 'tamanho', tam, 'bandeja', band);`,
  "o objeto limpo do Letreiro",
);

cfg = troca(
  cfg,
  `  tema   text;
  chave  text;`,
  `  tema   text;
  band   text;
  chave  text;`,
  "as declarações",
);

/* ── letreiro_start ───────────────────────────────────────────────────────── */

start = troca(
  start,
  `      'seconds', segundos,
      'counts', '{}'::jsonb`,
  `      'seconds', segundos,
      /* A BANDEJA MORA NO ESTADO DA PARTIDA, e não na sala.

         Ela é cosmética — nenhuma regra depende dela — e mesmo assim o lugar
         certo é aqui, pelo motivo que é o slogan do jogo: TODO MUNDO OLHA A
         MESMA GRADE. Lida da sala, o anfitrião troca de bandeja entre duas
         partidas e quem ainda tem a tela da anterior aberta passa a ver outro
         material na mesma grade. Congelada aqui, a bandeja é tão estável quanto
         os dados. */
      'tray', coalesce(sala.settings ->> 'bandeja', 'nogueira'),
      'counts', '{}'::jsonb`,
  "o estado inicial",
);

const sql = `-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0093 · as quatro bandejas do Letreiro
--
-- PRD 07 §7: o Letreiro é o tema mais barato dos quatro jogos, porque o tema
-- troca SÓ O MATERIAL — bandeja, dados, luz e som. Zero conteúdo, zero regra.
--
--   Nogueira    madeira, feltro cinza-azulado, dados de baquelite creme
--   Osso e Areia couro cru sobre areia, dados de osso talhado, sol vertical
--   Fliperama   fórmica Memphis, acrílico translúcido iluminado por baixo
--   Meridiano   alumínio escovado, cerâmica gravada a laser, âmbar de CRT
--
-- É a prova do sistema de temas no contexto mais barato que existe, e resolve
-- de graça o "enjoa em quatro rodadas" — o jogo em si não muda em nada.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE A BANDEJA MORA NO ESTADO DA PARTIDA
--
-- Ela é cosmética, e ainda assim não fica na sala. O motivo é o slogan do jogo:
-- TODO MUNDO OLHA A MESMA GRADE.
--
-- Lida de \`rooms.settings\`, o anfitrião troca de bandeja entre duas partidas e
-- quem ainda tem a tela da anterior aberta passa a ver outro material sobre a
-- mesma grade. Congelada em \`public_state\`, a bandeja é tão estável quanto os
-- dados — e é o mesmo tratamento que \`mode\`, \`size\` e \`scoring\` já recebem.
--
-- ────────────────────────────────────────────────────────────────────────────
-- E A LISTA É FECHADA
--
-- \`bandeja\` podia ser texto livre: nada no servidor depende do valor. Mas um
-- \`bandeja: "roxo"\` que o CSS não conhece deixaria a mesa sem material nenhum, e
-- o defeito apareceria só na tela de quem escolheu — que é o pior lugar para um
-- defeito aparecer. Vocabulário fechado, e BAD_TRAY quando não é um dos quatro.
-- ════════════════════════════════════════════════════════════════════════════

${cfg.trimEnd()};

revoke all on function public.set_room_settings(uuid, jsonb) from public, anon;
grant execute on function public.set_room_settings(uuid, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

${start.trimEnd()};

revoke all on function public.letreiro_start(uuid) from public, anon;
grant execute on function public.letreiro_start(uuid) to authenticated;
`;

writeFileSync("supabase/migrations/0093_letreiro_quatro_bandejas.sql", sql, "utf8");
console.log("0093 gerado");
