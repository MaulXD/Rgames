#!/usr/bin/env node
/**
 * Gera a migração 0118 — a mentira do assassino.
 *
 * Uso: node scripts/gera-dossie-mentira.mjs
 *
 * Parte das definições VIVAS de `dossie_refute_como`, `dossie_pass_refute_como`
 * e `dossie_candidatos` — ver o cabeçalho de `scripts/defs.mjs` para a
 * armadilha de gerar em cima de uma definição que já tem a mudança.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { config } from "dotenv";
import pg from "pg";

const ARQUIVO = "supabase/migrations/0118_a_mentira_do_assassino.sql";

config({ path: ".env.local", quiet: true });
const db = new pg.Client({
  connectionString: process.env.POSTGRES_URL_NON_POOLING + "&uselibpqcompat=true",
});
await db.connect();

async function viva(nome) {
  const { rows } = await db.query(
    `select pg_get_functiondef(p.oid) d from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = $1`,
    [nome],
  );
  if (rows.length !== 1) throw new Error(`${nome}: esperava uma definição, achei ${rows.length}`);
  return rows[0].d.replace(/\r\n/g, "\n");
}

let refuta = await viva("dossie_refute_como");
let passa = await viva("dossie_pass_refute_como");
const candidatos = await viva("dossie_candidatos");
await db.end();

for (const [nome, texto] of [
  ["dossie_refute_como", refuta],
  ["dossie_pass_refute_como", passa],
  ["dossie_candidatos", candidatos],
]) {
  if (texto.includes("mentir") || texto.includes("todas as")) {
    throw new Error(`${nome} viva já conhece a mentira — devolva-a à migração anterior`);
  }
}

function troca(texto, de, para, onde) {
  if (!texto.includes(de)) throw new Error(`não achei ${onde}`);
  if (texto.indexOf(de) !== texto.lastIndexOf(de)) throw new Error(`${onde} aparece duas vezes`);
  return texto.replace(de, para);
}

/* ── dossie_refute_como: refutar com uma carta que não se tem ───────────────── */

refuta = troca(
  refuta,
  `  no_palpite boolean;
  escuro   boolean;
begin`,
  `  no_palpite boolean;
  escuro   boolean;
  mentiu   boolean := false;
begin`,
  "as declarações do refute",
);

refuta = troca(
  refuta,
  `  if not tenho then raise exception 'NOT_IN_HAND'; end if;`,
  `  /* ── A MENTIRA DO ASSASSINO (0118) ────────────────────────────────────
     Uma por partida, armada de propósito antes. Sem ela armada, a regra é a de
     sempre: mostrar carta que não se tem é a trapaça mais óbvia do jogo.

     A carta continua tendo de ser UMA DAS TRÊS do palpite, e isso não é
     detalhe: mostrar algo de fora do palpite não seria mentira, seria uma
     jogada que não existe, e a tela de quem palpitou não saberia desenhá-la.

     E o servidor não confere se a carta está na mão de quem palpitou. Conferir
     seria contar ao assassino o que o outro tem — "essa não, escolhe outra" é
     informação que ele não pode ter. Mentir com a carta errada é o risco da
     jogada, e é o primeiro dos três jeitos de pegá-lo. */
  if not tenho then
    if not public.dossie_pode_mentir(p_match, p_seat) then
      raise exception 'NOT_IN_HAND';
    end if;
    mentiu := true;
  end if;`,
  "o NOT_IN_HAND",
);

refuta = troca(
  refuta,
  `  estado := estado || jsonb_build_object('pending', null);

  update public.matches set public_state = estado, version = version + 1 where id = p_match;`,
  `  estado := estado || jsonb_build_object('pending', null);

  /* Gasta DEPOIS do log, e com o seq da linha que acabou de nascer: é ela que o
     desfecho vai apontar quando a partida acabar e a mesa quiser reconstituir
     onde estava o buraco. */
  if mentiu then
    perform public.dossie_gasta_mentira(p_match, p_seat, (estado ->> 'seq')::int);
  end if;

  update public.matches set public_state = estado, version = version + 1 where id = p_match;`,
  "a gravação do refute",
);

/* ── dossie_pass_refute_como: passar podendo refutar ────────────────────────── */

passa = troca(
  passa,
  `  tenho  boolean;
  prox   int;
begin`,
  `  tenho  boolean;
  prox   int;
  mentiu boolean := false;
begin`,
  "as declarações do pass",
);

passa = troca(
  passa,
  `  if tenho then raise exception 'YOU_MUST_REFUTE'; end if;

  estado := public.dossie_log(estado, jsonb_build_object('type', 'pass', 'seat', meu));`,
  `  /* ── A MENTIRA DO ASSASSINO (0118) ────────────────────────────────────
     DEPOIS DO ÁLIBI, e a ordem é a regra. O álibi é público, custa uma carta
     que já foi comprada, e a mesa vê que foi usado; a mentira é secreta e há
     uma só. Gastar a cara para fazer o trabalho da barata seria desperdício —
     e o bloco do álibi acima já derrubou a bandeira quando ele valia. */
  if tenho then
    if not public.dossie_pode_mentir(p_match, p_seat) then
      raise exception 'YOU_MUST_REFUTE';
    end if;
    mentiu := true;
  end if;

  estado := public.dossie_log(estado, jsonb_build_object('type', 'pass', 'seat', meu));
  if mentiu then
    perform public.dossie_gasta_mentira(p_match, p_seat, (estado ->> 'seq')::int);
  end if;`,
  "o YOU_MUST_REFUTE",
);

/* ── dossie_candidatos: zero não é conhecimento, é contradição ──────────────── */

const NOVO_CANDIDATOS = `CREATE OR REPLACE FUNCTION public.dossie_candidatos(p_tema jsonb, p_dedu jsonb, p_tipo text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
  /* ZERO CANDIDATOS NÃO É CONHECIMENTO, É CONTRADIÇÃO.

     Numa partida honesta a carta do envelope nunca entra em \`fora\` — não há
     como prová-la fora, porque ela não está com ninguém. Então "sobrou zero"
     era inalcançável, e a máquina lia \`susp[1]\` de um vetor vazio sem que
     ninguém tivesse motivo para desconfiar.

     A mentira do assassino alcança: a jogada mais forte do modo é mostrar
     justamente a carta do envelope, e quem acreditar risca a resposta e derruba
     a categoria inteira. O NULL descia até \`dossie_suggest_como\` e a exceção
     subia pela faxina, parando a mesa para todo mundo — o defeito de 0033 com
     outra roupa.

     Se não sobrou nenhum, quem está errado é o caderno, não o mundo: a
     categoria volta inteira. A máquina perde a certeza e volta a investigar,
     que é o que uma pessoa faria ao chegar num absurdo. Ela não descobre que
     houve mentira — ela só não trava por causa de uma. */
  with todas as (
    select c ->> 'id' id
      from jsonb_array_elements(
        case p_tipo
          when 'suspect' then p_tema -> 'suspects'
          when 'weapon'  then p_tema -> 'weapons'
          else p_tema -> 'rooms'
        end) c
  )
  select coalesce(
    (select array_agg(id order by id) from todas
      where not coalesce(p_dedu -> 'fora', '[]'::jsonb) @> to_jsonb(array[id])),
    (select array_agg(id order by id) from todas),
    '{}');
$function$`;

/* ── o arquivo ─────────────────────────────────────────────────────────────── */

const CABECA = readFileSync(ARQUIVO, "utf8").replace(/\r\n/g, "\n");
if (CABECA.includes("CREATE OR REPLACE FUNCTION")) {
  throw new Error("o arquivo já foi gerado; parta do cabeçalho escrito à mão");
}

const sql = `${CABECA.trimEnd()}

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. REFUTAR SEM A CARTA

${refuta.trimEnd()};

revoke all on function public.dossie_refute_como(smallint, uuid, text)
  from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. PASSAR TENDO A CARTA

${passa.trimEnd()};

revoke all on function public.dossie_pass_refute_como(smallint, uuid)
  from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. E A MÁQUINA NÃO TRAVA NO ABSURDO

${NOVO_CANDIDATOS.trimEnd()};
`;

writeFileSync(ARQUIVO, sql, "utf8");
console.log("0118 gerado");
