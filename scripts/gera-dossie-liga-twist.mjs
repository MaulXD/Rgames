#!/usr/bin/env node
/**
 * Gera a migração 0088 — a reviravolta nasce no início e dispara na virada.
 *
 * Três costuras, todas em função que já existe e que eu não quero reescrever:
 *
 *   dossie_start        cria `twist` no estado, ou não cria (regra da casa)
 *   dossie_advance      chama `dossie_vira_rodada` quando a rodada vira
 *   dossie_refute_como  o apagão apaga QUEM mostrou, nunca O QUE mostrou
 *
 * Tudo sai de `pg_get_functiondef` da definição VIVA. Copiar de arquivo de
 * migração já custou três "cannot change return type" nesta sessão.
 *
 * Uso: node scripts/gera-dossie-liga-twist.mjs
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
  /* `pg_get_functiondef` devolve o corpo COMO FOI ESCRITO, terminadores de
     linha inclusive — e este projeto tem migrações antigas em CRLF. Um alvo de
     busca de uma linha só casa nos dois; um de várias linhas só casa em LF, e
     falha em silêncio no resto. Foi assim que `dossie_refute_como` recusou três
     das quatro costuras enquanto `dossie_start` aceitava todas. */
  return rows[0].d.replace(/\r\n/g, "\n");
}

function troca(texto, de, para, onde) {
  if (!texto.includes(de)) throw new Error(`não achei ${onde}`);
  return texto.replace(de, para);
}

/* ── 1. dossie_start: a reviravolta do caso, congelada no início ──────────── */

let start = await def("dossie_start");

start = troca(
  start,
  `  estado := jsonb_build_object(`,
  `  /* A REVIRAVOLTA DO CASO, congelada agora.

     Congelar no início é a decisão de produto: quem escolheu jogar limpo joga
     limpo até o fim, e ninguém muda a regra no meio da partida. A alternativa —
     ler a regra da casa a cada rodada — deixaria o anfitrião desligar o Apagão
     na rodada 5 depois de ver que ele ia cair na 6.

     A rodada do Apagão sai do mesmo \`semente\` de tudo o mais, entre a 4 e a 8
     como manda o PRD 03 §3. Sorteada AQUI e guardada: se fosse sorteada na hora,
     "uma vez por partida" viraria "uma vez por rodada, com 20% de chance". */
  if coalesce((sala.settings ->> 'reviravolta')::boolean, true) then
    giro := tema.data -> 'twist';
    if giro is not null and giro <> 'null'::jsonb then
      giro := jsonb_build_object('id', giro ->> 'id');
      case giro ->> 'id'
        when 'apagao' then
          giro := giro || jsonb_build_object(
            'round', 4 + (abs(semente) % 5), 'fired', false, 'active', false
          );
        when 'tempestade' then
          giro := giro || jsonb_build_object('fechados', '[]'::jsonb, 'aviso', '[]'::jsonb);
        when 'registro' then
          giro := giro || jsonb_build_object('publicados', '[]'::jsonb);
        else
          giro := null;
      end case;
    end if;
  end if;

  estado := jsonb_build_object(`,
  "o bloco do estado inicial",
);

start = troca(
  start,
  `    'round', 1,`,
  `    'round', 1,\n    'twist', giro,`,
  "a chave 'round'",
);

start = troca(
  start,
  `  idx       int;\n`,
  `  idx       int;\n  giro      jsonb := null;\n`,
  "as declarações",
);

/* ── 2. dossie_advance: chamar a virada quando a rodada vira ──────────────── */

let advance = await def("dossie_advance");

advance = troca(
  advance,
  `  update public.matches
     set version = version + 1,
         turn_deadline = now() + interval '90 seconds',`,
  `  virou := prox <= atual;

  update public.matches
     set version = version + 1,
         turn_deadline = now() + interval '90 seconds',`,
  "o update final",
);

advance = troca(
  advance,
  `   where id = p_match;
end;`,
  `   where id = p_match;

  /* A reviravolta acontece DEPOIS do estado da rodada nova estar gravado, e
     nunca antes: \`dossie_vira_rodada\` lê \`round\` do banco para saber em que
     rodada está. Chamar antes seria fazê-la decidir sobre a rodada anterior. */
  if virou then
    perform public.dossie_vira_rodada(p_match);
  end if;
end;`,
  "o fim da função",
);

advance = troca(
  advance,
  `  estado  jsonb;
begin`,
  `  estado  jsonb;
  virou   boolean;
begin`,
  "as declarações do advance",
);

/* ── 3. dossie_refute_como: o apagão apaga quem, nunca o quê ──────────────── */

let refute = await def("dossie_refute_como");

refute = troca(
  refute,
  `  -- a carta vai para o estado PRIVADO de quem palpitou. Nunca para o público.`,
  `  /* O APAGÃO apaga QUEM mostrou. Nunca O QUE mostrou.

     Essa é a linha inteira da regra, e é o que a torna choque sem prejuízo:
     "aquela carta não está no envelope" continua sendo sua, porque é a
     informação que decide a partida. O que some é a atribuição — saber de QUEM
     ela é —, que é a metade lenta da dedução.

     Se o apagão escondesse a carta, seria uma rodada jogada fora. */
  select coalesce((estado -> 'twist' ->> 'active')::boolean, false)
     and estado -> 'twist' ->> 'id' = 'apagao'
    into escuro;

  -- a carta vai para o estado PRIVADO de quem palpitou. Nunca para o público.`,
  "o comentário do estado privado",
);

refute = troca(
  refute,
  `           (data -> 'seen') || jsonb_build_object(
             'card', p_card, 'from', meu, 'seq', coalesce((estado ->> 'seq')::int, 0) + 1
           )`,
  `           (data -> 'seen') || jsonb_build_object(
             'card', p_card,
             'from', case when escuro then null else to_jsonb(meu) end,
             'seq', coalesce((estado ->> 'seq')::int, 0) + 1
           )`,
  "a gravação no estado privado",
);

refute = troca(
  refute,
  `  -- no log, só QUEM mostrou
  estado := public.dossie_log(estado, jsonb_build_object('type', 'refute', 'seat', meu));`,
  `  -- no log, só QUEM mostrou — e no apagão, nem isso
  estado := public.dossie_log(estado, case when escuro
    then jsonb_build_object('type', 'refute', 'seat', null, 'anon', true)
    else jsonb_build_object('type', 'refute', 'seat', meu)
  end);`,
  "o log da refutação",
);

refute = troca(
  refute,
  `  no_palpite boolean;
begin`,
  `  no_palpite boolean;
  escuro   boolean;
begin`,
  "as declarações do refute",
);

await db.end();

const sql = `-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0088 · a reviravolta entra em cena
--
-- 0087 escreveu as três reviravoltas e ninguém as chamava. Esta migração é a
-- fiação, e são três costuras:
--
--   dossie_start        cria \`twist\` no estado — ou não cria, se a mesa
--                       desligou a regra nas Regras da Casa
--   dossie_advance      chama \`dossie_vira_rodada\` no instante em que a rodada
--                       vira, e só aí
--   dossie_refute_como  durante o Apagão, o log diz que alguém desmentiu e o
--                       estado privado de quem palpitou grava \`from: null\`
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE A REVIRAVOLTA É CONGELADA NO INÍCIO
--
-- A regra da casa é lida uma vez, em \`dossie_start\`, e o resultado vive no
-- estado da partida. Ler a cada rodada deixaria o anfitrião desligar o Apagão na
-- rodada 5 depois de ver que ele ia cair na 6 — e uma regra que dá para desligar
-- quando incomoda não é regra, é sugestão.
--
-- Pelo mesmo motivo a rodada do Apagão é sorteada AGORA e guardada. Sorteada na
-- hora, "uma vez por partida, entre a 4 e a 8" viraria "uma vez por rodada, com
-- vinte por cento de chance" — que é outro jogo, e um pior.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O APAGÃO APAGA QUEM, NUNCA O QUÊ
--
-- É a linha inteira da regra. "Aquela carta não está no envelope" continua sendo
-- sua, porque é a informação que decide a partida; o que some é saber de QUEM
-- ela é, que é a metade lenta da dedução.
--
-- Um apagão que escondesse a carta seria uma rodada jogada fora, e a mesa
-- aprenderia a esperar ela passar em vez de jogar dentro dela.
-- ════════════════════════════════════════════════════════════════════════════

${start.trimEnd()};

revoke all on function public.dossie_start(uuid, text) from public, anon;
grant execute on function public.dossie_start(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

${advance.trimEnd()};

revoke all on function public.dossie_advance(uuid) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

${refute.trimEnd()};

revoke all on function public.dossie_refute_como(smallint, uuid, text)
  from public, anon, authenticated;
`;

writeFileSync("supabase/migrations/0088_dossie_liga_a_reviravolta.sql", sql, "utf8");
console.log("0088 gerado");
