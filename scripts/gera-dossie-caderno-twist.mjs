#!/usr/bin/env node
/**
 * Gera a migração 0090 — o caderno de dedução aprende as reviravoltas.
 *
 * Duas correções e uma adição, todas em `dossie_deduz`.
 *
 * Uso: node scripts/gera-dossie-caderno-twist.mjs
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
    where n.nspname = 'public' and p.proname = 'dossie_deduz'`,
);
let deduz = rows[0].d.replace(/\r\n/g, "\n");
await db.end();

function troca(de, para, onde) {
  if (!deduz.includes(de)) throw new Error(`não achei ${onde}`);
  deduz = deduz.replace(de, para);
}

/* ── 1. o apagão não pode virar conhecimento atribuído ────────────────────── */

troca(
  `  for linha in select value from jsonb_array_elements(coalesce(priv -> 'seen', '[]'::jsonb)) loop
    c := linha ->> 'card';
    if not (fora @> to_jsonb(array[c])) then fora := fora || to_jsonb(array[c]); end if;
    -- quem mostrou tem a carta; logo mais ninguém tem
    for outro in select mp.seat from public.match_players mp
                  where mp.match_id = p_match
                    and mp.seat is distinct from (linha ->> 'from')::smallint loop
      if not coalesce(naotem -> outro.seat::text, '[]'::jsonb) @> to_jsonb(array[c]) then
        naotem := jsonb_set(naotem, array[outro.seat::text],
          coalesce(naotem -> outro.seat::text, '[]'::jsonb) || to_jsonb(array[c]), true);
      end if;
    end loop;
  end loop;`,
  `  for linha in select value from jsonb_array_elements(coalesce(priv -> 'seen', '[]'::jsonb)) loop
    c := linha ->> 'card';
    if not (fora @> to_jsonb(array[c])) then fora := fora || to_jsonb(array[c]); end if;

    /* NO APAGÃO, \`from\` é nulo — e é aqui que ele tinha de ser tratado.

       \`mp.seat is distinct from null\` é VERDADE para todo assento. Sem esta
       guarda, uma carta mostrada no escuro marcaria TODA a mesa como não tendo
       a carta, inclusive quem acabou de mostrá-la. Isso não é perder
       informação: é FABRICAR informação falsa, e ela se propaga — o laço lá
       embaixo resolve restrições em cima do \`naoTem\`, e a máquina acaba
       acusando com certeza uma carta que está na mão de alguém.

       A carta continua saindo do envelope, que é o que o apagão promete não
       tirar de você. O que some é a atribuição, e é exatamente o que deve
       sumir. */
    if (linha -> 'from') is not null and linha -> 'from' <> 'null'::jsonb then
      -- quem mostrou tem a carta; logo mais ninguém tem
      for outro in select mp.seat from public.match_players mp
                    where mp.match_id = p_match
                      and mp.seat is distinct from (linha ->> 'from')::smallint loop
        if not coalesce(naotem -> outro.seat::text, '[]'::jsonb) @> to_jsonb(array[c]) then
          naotem := jsonb_set(naotem, array[outro.seat::text],
            coalesce(naotem -> outro.seat::text, '[]'::jsonb) || to_jsonb(array[c]), true);
        end if;
      end loop;
    end if;
  end loop;

  /* ── o que NÚBIA publicou ─────────────────────────────────────────────
     O Registro da Estação é um fato PÚBLICO e verdadeiro: aquela carta não está
     no envelope. Não é dedução, é anúncio — por isso vive aqui, no bloco do que
     está na cara, e não lá embaixo com as regras que só a firme e a impiedosa
     cruzam. A tranquila também ouviu o alto-falante.

     Não diz de QUEM é a carta, e é de propósito: dizer isso entregaria a mão de
     alguém, e a reviravolta promete um fato sobre o ENVELOPE. */
  for linha in
    select value from jsonb_array_elements(coalesce(est -> 'log', '[]'::jsonb)) l
     where l.value ->> 'type' = 'registro'
  loop
    c := linha ->> 'card';
    if c is not null and not (fora @> to_jsonb(array[c])) then
      fora := fora || to_jsonb(array[c]);
    end if;
  end loop;`,
  "o laço do que foi mostrado",
);

/* ── 2. refutação anônima não vira restrição atribuída ────────────────────── */

troca(
  `        if autor is distinct from p_seat then
          abertos := abertos || jsonb_build_array(jsonb_build_object(
            'seat', (linha ->> 'seat')::smallint, 'cartas', palpite));
        end if;`,
  `        /* E não quando foi no escuro: uma restrição aberta é a frase "o
           assento N tem uma destas três". Sem o N, não há frase — e guardá-la
           com \`seat: null\` encheria a lista de restrições que nunca resolvem,
           porque o laço de propagação procura o \`naoTem\` de um assento que não
           existe e nunca descarta nada. Lixo silencioso que cresce a partida
           inteira. */
        if autor is distinct from p_seat
           and linha -> 'seat' is not null and linha -> 'seat' <> 'null'::jsonb then
          abertos := abertos || jsonb_build_array(jsonb_build_object(
            'seat', (linha ->> 'seat')::smallint, 'cartas', palpite));
        end if;`,
  "a restrição aberta",
);

const sql = `-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0090 · o caderno de dedução aprende as reviravoltas
--
-- \`dossie_deduz\` foi escrita quando refutação tinha sempre um dono e o log
-- nunca falava sozinho. As reviravoltas quebram as duas premissas, e as duas
-- quebras são silenciosas.
--
-- ────────────────────────────────────────────────────────────────────────────
-- 1. O APAGÃO FABRICAVA CONHECIMENTO FALSO
--
-- O laço do que foi mostrado dizia:
--
--     where mp.seat is distinct from (linha ->> 'from')::smallint
--
-- No apagão, \`from\` é nulo. E \`x is distinct from null\` é VERDADE para todo
-- assento — então uma carta mostrada no escuro marcava a MESA INTEIRA como não
-- tendo aquela carta, inclusive quem acabara de mostrá-la.
--
-- Isso não é perder informação. É inventar informação, e ela se PROPAGA: o laço
-- de baixo resolve restrições em cima do \`naoTem\`, e o fim da linha é uma
-- máquina acusando com certeza uma carta que está na mão de alguém.
--
-- É a mesma família dos defeitos de NULL que este projeto já pagou três vezes
-- (0029, 0033, 0073): a comparação com nulo não deu erro, não deu aviso, e deu
-- a resposta errada com toda a confiança do mundo.
--
-- Agora a carta continua saindo do envelope — que é o que o Apagão promete não
-- tirar de você — e a atribuição some, que é exatamente o que deve sumir.
--
-- ────────────────────────────────────────────────────────────────────────────
-- 2. A RESTRIÇÃO ABERTA SEM DONO NUNCA RESOLVIA
--
-- Uma restrição aberta é a frase "o assento N tem uma destas três". Sem o N não
-- há frase. Guardada com \`seat: null\`, ela nunca descarta nada — o laço procura
-- o \`naoTem\` de um assento que não existe — e fica na lista até o fim da
-- partida. Lixo silencioso que cresce.
--
-- ────────────────────────────────────────────────────────────────────────────
-- 3. E O REGISTRO DA ESTAÇÃO ENTRA NO BLOCO DO QUE ESTÁ NA CARA
--
-- O fato que NÚBIA publica é PÚBLICO e verdadeiro. Não é dedução, é anúncio —
-- então vale para os três níveis, inclusive a tranquila, que não cruza nada.
-- Pôr isso atrás de \`nivel <> 'facil'\` seria fazer a máquina fácil não ouvir o
-- alto-falante que toca para a mesa toda.
-- ════════════════════════════════════════════════════════════════════════════

${deduz.trimEnd()};

revoke all on function public.dossie_deduz(uuid, smallint) from public, anon, authenticated;
`;

writeFileSync("supabase/migrations/0090_dossie_caderno_e_reviravolta.sql", sql, "utf8");
console.log("0090 gerado");
