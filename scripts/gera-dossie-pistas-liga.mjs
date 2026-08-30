#!/usr/bin/env node
/**
 * Gera a migração 0104 — as Cartas de Pista entram em cena.
 *
 * Uso: node scripts/gera-dossie-pistas-liga.mjs
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
let start = await def("dossie_start");
let advance = await def("dossie_advance");
let passa = await def("dossie_pass_refute_como");
let usar = await def("dossie_usar_pista_como");
await db.end();

function troca(texto, de, para, onde) {
  if (!texto.includes(de)) throw new Error(`não achei ${onde}`);
  return texto.replace(de, para);
}

/* ── 1. a regra da casa ───────────────────────────────────────────────────── */

cfg = troca(
  cfg,
  `    when 'dossie'    then array['tema', 'reviravolta']`,
  `    when 'dossie'    then array['tema', 'reviravolta', 'avancado']`,
  "as chaves do Dossiê",
);

cfg = troca(
  cfg,
  `      'reviravolta', coalesce(
        (p_settings ->> 'reviravolta')::boolean,
        (sala.settings ->> 'reviravolta')::boolean,
        true)
    );`,
  `      'reviravolta', coalesce(
        (p_settings ->> 'reviravolta')::boolean,
        (sala.settings ->> 'reviravolta')::boolean,
        true),
      /* O Modo Avançado é DESLIGADO por padrão, ao contrário da reviravolta.

         A reviravolta é a mecânica que o caso entrega e sem ela o caso é o
         Solar com outra roupa — por isso ela vem ligada. As Cartas de Pista são
         uma sétima coisa para aprender numa mesa que já tem seis suspeitos,
         nove lugares, um caderno de dedução e uma regra própria. Ligada por
         padrão, ela transforma a primeira partida de alguém numa aula. */
      'avancado', coalesce(
        (p_settings ->> 'avancado')::boolean,
        (sala.settings ->> 'avancado')::boolean,
        false)
    );`,
  "o objeto limpo do Dossiê",
);

/* ── 2. o baralho nasce com a partida ─────────────────────────────────────── */

start = troca(
  start,
  `    'round', 1,
    'twist', giro,`,
  `    'round', 1,
    'twist', giro,
    /* \`{"tirou": 0}\` quando o Modo Avançado está ligado, e NULO quando não —
       e a diferença importa: \`dossie_investigar\` recusa com SEM_PISTAS quando
       a chave é nula, então a mesa que jogou sem cartas não tem como uma
       chamada solta injetar uma. A regra da casa é lida uma vez, aqui. */
    'pistas', case
                when coalesce((sala.settings ->> 'avancado')::boolean, false)
                then jsonb_build_object('tirou', 0)
                else null
              end,`,
  "o estado inicial do Dossiê",
);

/* ── 3. "tempo é curto" surte efeito na virada ────────────────────────────── */

advance = troca(
  advance,
  `  update public.matches
     set version = version + 1,
         turn_deadline = now() + interval '90 seconds',
         public_state = estado || jsonb_build_object(
           'phase', 'turn',
           'turnSeat', prox,
           'round', rodada,
           'actionsLeft', 2,
           'pending', null
         )
   where id = p_match;`,
  `  /* TEMPO É CURTO: uma ação em vez de duas, para quem foi marcado.

     A marca é consumida ao ser paga, e não fica. É o mesmo desenho da multa de
     traição do Domínio, e pelo mesmo motivo: uma penalidade que se cobra toda
     rodada não é penalidade, é regra nova. */
  acoes := 2;
  if (estado ->> 'tempoCurto')::smallint is not distinct from prox
     and estado ->> 'tempoCurto' is not null then
    acoes := 1;
    estado := estado || jsonb_build_object('tempoCurto', null);
  end if;

  update public.matches
     set version = version + 1,
         turn_deadline = now() + interval '90 seconds',
         public_state = estado || jsonb_build_object(
           'phase', 'turn',
           'turnSeat', prox,
           'round', rodada,
           'actionsLeft', acoes,
           'pending', null
         )
   where id = p_match;`,
  "o update do advance",
);

advance = troca(
  advance,
  `  estado  jsonb;
  virou   boolean;
begin`,
  `  estado  jsonb;
  virou   boolean;
  acoes   int;
begin`,
  "as declarações do advance",
);

/* ── 4. o álibi vale na refutação obrigatória ─────────────────────────────── */

passa = troca(
  passa,
  `  if tenho then raise exception 'YOU_MUST_REFUTE'; end if;`,
  `  /* O ÁLIBI é a única coisa no jogo que deixa alguém não refutar tendo a
     carta, e por isso ele é gasto AQUI e não quando foi jogado: entre jogar e
     passar, a pessoa pode mudar de ideia e refutar mesmo assim — e aí a carta
     tem de continuar na mão dela.

     A bandeira em \`alibi\` diz "esta pessoa declarou álibi nesta refutação". Ela
     morre junto com a passada. */
  if tenho and coalesce((estado -> 'alibi' ->> meu::text)::boolean, false) then
    tenho := false;
    estado := public.jsonb_poe(estado, 'alibi', meu::text, 'null'::jsonb);
    estado := public.dossie_log(estado, jsonb_build_object(
      'type', 'alibi', 'seat', meu
    ));
  end if;
  if tenho then raise exception 'YOU_MUST_REFUTE'; end if;`,
  "a checagem do YOU_MUST_REFUTE",
);

/* ── 5. tirar UMA carta da mão, legível ───────────────────────────────────── */

const TIRA_VELHO = usar.slice(
  usar.indexOf("  update public.match_private_state\n     set data = public.jsonb_poe"),
  usar.indexOf("  update public.matches set public_state = estado, version = version + 1 where id = p_match;\n  return jsonb_build_object('ok', true);"),
);
if (!TIRA_VELHO.includes("row_number")) throw new Error("não achei o trecho que tira a carta");

usar = usar.replace(
  TIRA_VELHO,
  `  /* A carta sai da mão — UMA, mesmo com quatro cópias no baralho.

     A primeira versão disto era um \`row_number()\` dentro de um \`not exists\`
     com uma subconsulta correlacionada, e ninguém consegue ler aquilo para
     conferir se está certo. \`jsonb_tira_um\` faz a mesma coisa com um nome. */
  update public.match_private_state
     set data = public.jsonb_poe(coalesce(data, '{}'::jsonb), 'pistas', 'mao',
           public.jsonb_tira_um(mao, p_carta))
   where match_id = p_match and user_id = quem;

`,
);

const sql = `-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0104 · as Cartas de Pista entram em cena
--
-- 0103 escreveu o baralho, a ação de investigar e três cartas, e ninguém as
-- alcançava: não havia regra da casa para ligar, o estado inicial não trazia o
-- baralho, e as duas bandeiras que as cartas levantam não eram lidas por
-- ninguém.
--
-- Cinco costuras:
--
--   set_room_settings          aceita e valida \`avancado\`
--   dossie_start               cria \`pistas\` — ou não cria
--   dossie_advance             "tempo é curto" vira uma ação em vez de duas
--   dossie_pass_refute_como    o álibi deixa passar tendo a carta
--   dossie_usar_pista_como     tirar a carta da mão passa a ser legível
--
-- ────────────────────────────────────────────────────────────────────────────
-- O MODO AVANÇADO É DESLIGADO POR PADRÃO, e a reviravolta é ligada
--
-- Parece incoerente e não é. A reviravolta é a mecânica que o CASO entrega —
-- sem ela, a Boate Aurora é o Solar das Acácias com outra roupa, e a mesa não
-- ganhou nada por escolher o caso. As Cartas de Pista são uma sétima coisa para
-- aprender numa mesa que já tem seis suspeitos, nove lugares, um caderno de
-- dedução e uma regra própria.
--
-- Ligada por padrão, ela transforma a primeira partida de alguém numa aula.
--
-- E \`pistas\` fica NULO quando o modo está desligado, em vez de \`{"tirou": 0}\`.
-- A diferença é o guarda: \`dossie_investigar\` recusa com SEM_PISTAS quando a
-- chave é nula, então uma chamada solta não injeta carta numa mesa que escolheu
-- jogar sem elas.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O ÁLIBI É GASTO NA PASSADA, E NÃO QUANDO É JOGADO
--
-- Entre declarar o álibi e efetivamente passar, a pessoa pode mudar de ideia e
-- refutar mesmo assim — e aí a carta tem de continuar na mão dela. A bandeira
-- diz "declarei álibi nesta refutação"; quem a consome é o \`pass_refute\`.
--
-- É a mesma forma da multa de traição do Domínio: cobra-se ao pagar, não ao
-- marcar. E pelo mesmo motivo — penalidade que se cobra toda rodada não é
-- penalidade, é regra nova.
-- ════════════════════════════════════════════════════════════════════════════

/**
 * Uma lista jsonb sem a PRIMEIRA ocorrência de um valor.
 *
 * Existe porque "tirar uma carta da mão" é uma frase simples que vira SQL
 * ilegível quando escrita inline: \`row_number()\` dentro de um \`not exists\` com
 * subconsulta correlacionada. Ninguém confere aquilo de olho, e o que não se
 * confere de olho é onde o defeito mora.
 */
create or replace function public.jsonb_tira_um(p_lista jsonb, p_valor text)
returns jsonb
language sql
immutable
as $$
  with numerada as (
    select c, row_number() over () n
      from jsonb_array_elements_text(coalesce(p_lista, '[]'::jsonb)) c
  ),
  primeira as (select min(n) n from numerada where c = p_valor)
  select coalesce(jsonb_agg(numerada.c order by numerada.n), '[]'::jsonb)
    from numerada left join primeira on true
   where primeira.n is null or numerada.n <> primeira.n;
$$;

revoke all on function public.jsonb_tira_um(jsonb, text) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

${cfg.trimEnd()};

revoke all on function public.set_room_settings(uuid, jsonb) from public, anon;
grant execute on function public.set_room_settings(uuid, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

${start.trimEnd()};

revoke all on function public.dossie_start(uuid, text) from public, anon;
grant execute on function public.dossie_start(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

${advance.trimEnd()};

revoke all on function public.dossie_advance(uuid) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

${passa.trimEnd()};

revoke all on function public.dossie_pass_refute_como(smallint, uuid)
  from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

${usar.trimEnd()};

revoke all on function public.dossie_usar_pista_como(smallint, uuid, text, jsonb)
  from public, anon, authenticated;
`;

writeFileSync("supabase/migrations/0104_dossie_pistas_em_cena.sql", sql, "utf8");
console.log("0104 gerado");
