#!/usr/bin/env node
/**
 * Gera a migração 0105 — Impressão digital e Recado anônimo.
 *
 * Uso: node scripts/gera-dossie-pistas-revelam.mjs
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

let usar = await def("dossie_usar_pista_como");
let deduz = await def("dossie_deduz");
await db.end();

function troca(texto, de, para, onde) {
  if (!texto.includes(de)) throw new Error(`não achei ${onde}`);
  return texto.replace(de, para);
}

/* ── 1. os dois ramos novos ───────────────────────────────────────────────── */

usar = troca(
  usar,
  "    else\n      raise exception 'PISTA_DESCONHECIDA_%', p_carta;",
  `    /* IMPRESSÃO DIGITAL — "o suspeito do envelope está entre estes dois?"

       Os DOIS NOMES são públicos e a RESPOSTA é privada, e essa divisão é a
       carta inteira. Quem joga paga anunciando onde está procurando; a mesa
       lê a resposta no que essa pessoa faz nas rodadas seguintes, e não no
       registro. É informação comprada com exposição, que é o preço que o
       Dossiê cobra por tudo.

       Vale a pena nos dois resultados — o NÃO risca dois suspeitos, o SIM
       risca os outros quatro — e por isso a decisão é QUAIS dois nomear, e
       não se a carta vai dar certo. */
    when 'impressao' then
      if (estado ->> 'turnSeat')::smallint <> meu then raise exception 'NOT_YOUR_TURN'; end if;
      if estado ->> 'phase' <> 'turn' then raise exception 'WRONG_PHASE'; end if;
      um  := p_arg ->> 'a';
      dois := p_arg ->> 'b';
      if um is null or dois is null then raise exception 'FALTAM_OS_DOIS_NOMES'; end if;
      if um = dois then raise exception 'DOIS_NOMES_IGUAIS'; end if;
      if (select count(*) from public.game_themes gt,
                 lateral jsonb_array_elements(gt.data -> 'suspects') s
           where gt.id = estado ->> 'theme' and s ->> 'id' in (um, dois)) <> 2 then
        raise exception 'SUSPEITO_NAO_EXISTE';
      end if;
      /* O envelope é lido AQUI e não sai daqui: o que atravessa é um booleano.
         \`security definer\` existe para este parágrafo. */
      resposta := (m.solution ->> 'suspect') in (um, dois);
      perform public.dossie_avisa(p_match, meu, jsonb_build_object(
        'k', 'impressao', 'a', um, 'b', dois, 'sim', resposta
      ));
      estado := public.dossie_log(estado, jsonb_build_object(
        'type', 'pista', 'seat', meu, 'carta', 'impressao', 'a', um, 'b', dois
      ));

    /* RECADO ANÔNIMO — alguém vê uma carta que não está no envelope.

       O registro diz que um recado saiu e NÃO diz para quem. É essa a
       anonimidade: a mesa vê a carta ser jogada, como vê qualquer outra, e
       não sabe quem ganhou o quê.

       E dá para mandar para si mesmo, o que parece brecha e é o desenho. Sem
       isso a carta seria puro presente e ninguém a jogaria por vontade
       própria; com isso, ela é informação para você OU um favor comprado, e
       de fora não dá para saber qual. */
    when 'recado' then
      if (estado ->> 'turnSeat')::smallint <> meu then raise exception 'NOT_YOUR_TURN'; end if;
      if estado ->> 'phase' <> 'turn' then raise exception 'WRONG_PHASE'; end if;
      if p_arg -> 'alvo' is null then raise exception 'FALTA_O_ALVO'; end if;
      alvo := (p_arg ->> 'alvo')::smallint;
      if not exists (
        select 1 from public.match_players mp
         where mp.match_id = p_match and mp.seat = alvo
      ) then
        raise exception 'ALVO_NAO_ESTA_NA_MESA';
      end if;
      destino := public.dossie_recado_para(p_match, alvo);
      /* Sem novidade, a carta NÃO É GASTA. O erro custa a jogada e devolve a
         carta, o que é melhor que queimá-la à toa — e é raro o bastante para
         não virar tentativa e erro: descobrir que alguém já sabe tudo o que
         está fora do envelope já é, em si, a informação. */
      if destino is null then raise exception 'RECADO_SEM_NOVIDADE'; end if;
      perform public.dossie_avisa(p_match, alvo, jsonb_build_object(
        'k', 'recado', 'card', destino
      ));
      estado := public.dossie_log(estado, jsonb_build_object(
        'type', 'pista', 'seat', meu, 'carta', 'recado'
      ));

    else
      raise exception 'PISTA_DESCONHECIDA_%', p_carta;`,
  "o else do case das pistas",
);

usar = troca(
  usar,
  `  destino text;
  prox    smallint;`,
  `  destino text;
  prox    smallint;
  alvo    smallint;
  um      text;
  dois    text;
  resposta boolean;`,
  "as declarações do usar_pista",
);

/* ── 2. o comentário duplicado que 0104 deixou para trás ──────────────────── */

usar = troca(
  usar,
  `  /* A carta sai da mão. Uma só, mesmo com quatro cópias no baralho: quem tem
     duas chave-mestras gasta uma. */
  /* A carta sai da mão — UMA`,
  `  /* A carta sai da mão — UMA`,
  "o comentário duplicado de 0104",
);

/* ── 3. o caderno aprende com os avisos ───────────────────────────────────── */

deduz = troca(
  deduz,
  `  /* ── o registro, do mais antigo para o mais novo ──────────────────────`,
  `  /* ── o que as Cartas de Pista contaram ────────────────────────────────
     Aviso não é dedução: é um fato que o servidor entregou pronto, lendo o
     envelope por trás de \`security definer\`. Por isso vive aqui em cima, com a
     própria mão e o Registro da Estação, e não lá embaixo com as regras que só
     a firme e a impiedosa cruzam — a tranquila também lê o que recebeu.

     Uma fonte só: o aviso. Quem transforma aviso em carta riscada é
     \`dossie_aviso_ensina\`, e é lá que mora a assimetria da impressão digital
     (o NÃO risca dois; o SIM risca os outros quatro). Gravar o fato derivado
     junto com o aviso daria duas fontes para a mesma verdade, e duas fontes
     divergem. */
  for linha in
    select value from jsonb_array_elements(coalesce(priv -> 'pistas' -> 'avisos', '[]'::jsonb))
  loop
    foreach c in array public.dossie_aviso_ensina(tema, linha) loop
      if c is not null and not (fora @> to_jsonb(array[c])) then
        fora := fora || to_jsonb(array[c]);
      end if;
    end loop;
  end loop;

  /* ── o registro, do mais antigo para o mais novo ──────────────────────`,
  "o cabeçalho do laço do registro",
);

const CABECA = readFileSync("supabase/migrations/0105_dossie_pistas_que_revelam.sql", "utf8")
  .replace(/\r\n/g, "\n");
if (CABECA.includes("dossie_usar_pista_como")) {
  throw new Error("o arquivo já foi gerado; parta do cabeçalho escrito à mão");
}

const sql = `${CABECA.trimEnd()}

-- ─────────────────────────────────────────────────────────────────────────────

${usar.trimEnd()};

revoke all on function public.dossie_usar_pista_como(smallint, uuid, text, jsonb)
  from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

${deduz.trimEnd()};

revoke all on function public.dossie_deduz(uuid, smallint) from public, anon, authenticated;
`;

writeFileSync("supabase/migrations/0105_dossie_pistas_que_revelam.sql", sql, "utf8");
console.log("0105 gerado");
