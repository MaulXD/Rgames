#!/usr/bin/env node
/**
 * Gera a migração 0106 — Interrogatório.
 *
 * Uso: node scripts/gera-dossie-interrogatorio.mjs
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
let sweep = await def("dossie_sweep");
let bot = await def("dossie_bot_passo");
await db.end();

function troca(texto, de, para, onde) {
  if (!texto.includes(de)) throw new Error(`não achei ${onde}`);
  return texto.replace(de, para);
}

/* ── 1. o ramo que abre a fase ────────────────────────────────────────────── */

usar = troca(
  usar,
  "    else\n      raise exception 'PISTA_DESCONHECIDA_%', p_carta;",
  `    /* INTERROGATÓRIO — a única carta que precisa de outra pessoa.

       As outras cinco resolvem dentro desta função. Esta abre uma FASE e
       espera, do mesmo jeito que a refutação — e a diferença que importa está
       no fim dela: a refutação encerra o turno de quem palpitou, o
       interrogatório o DEVOLVE. Quem perguntou volta com as ações que tinha.

       Sem isso a carta seria "passar a vez com informação", e ninguém a jogaria
       no começo do turno, que é justamente quando ela serve: descobrir que o
       assento 2 tem uma arma ANTES de escolher para onde andar.

       Enquanto a fase dura, \`phase\` não é 'turn' — e mover, palpitar e jogar
       as outras cartas exigem 'turn'. Quem perguntou fica travado até a
       resposta chegar, sem nenhuma guarda nova. */
    when 'interrogatorio' then
      if (estado ->> 'turnSeat')::smallint <> meu then raise exception 'NOT_YOUR_TURN'; end if;
      if estado ->> 'phase' <> 'turn' then raise exception 'WRONG_PHASE'; end if;
      if p_arg -> 'alvo' is null then raise exception 'FALTA_O_ALVO'; end if;
      alvo := (p_arg ->> 'alvo')::smallint;
      /* Interrogar a si mesmo devolveria uma carta da própria mão: a carta
         gasta para não descobrir nada. */
      if alvo = meu then raise exception 'NAO_SE_INTERROGA_SOZINHO'; end if;
      if not exists (
        select 1 from public.match_players mp
         where mp.match_id = p_match and mp.seat = alvo
      ) then
        raise exception 'ALVO_NAO_ESTA_NA_MESA';
      end if;
      /* O tipo é a chave do próprio tema, e não um nome traduzido: um nome só
         para uma coisa só. */
      if coalesce(p_arg ->> 'tipo', '') not in ('suspects', 'weapons', 'rooms') then
        raise exception 'TIPO_DESCONHECIDO';
      end if;
      estado := estado || jsonb_build_object(
        'phase', 'interroga',
        'pending', jsonb_build_object(
          'kind', 'interroga', 'bySeat', meu, 'alvo', alvo, 'tipo', p_arg ->> 'tipo'));
      /* A PERGUNTA É PÚBLICA, e é o preço da carta: quem interroga anuncia
         exatamente onde está procurando, e a mesa inteira ganha a resposta
         junto. */
      estado := public.dossie_log(estado, jsonb_build_object(
        'type', 'pista', 'seat', meu, 'carta', 'interrogatorio',
        'alvo', alvo, 'tipo', p_arg ->> 'tipo'));
      /* O relógio passa a ser de quem responde, e é curto: enquanto ele não
         responde, a mesa inteira espera. Mesmos trinta segundos da refutação. */
      prazo := interval '30 seconds';

    else
      raise exception 'PISTA_DESCONHECIDA_%', p_carta;`,
  "o else do case das pistas",
);

usar = troca(
  usar,
  `  alvo    smallint;
  um      text;`,
  `  alvo    smallint;
  prazo   interval;
  um      text;`,
  "as declarações do usar_pista",
);

/* O relógio só muda quando um ramo pede. `case when prazo is null then
   turn_deadline` preserva o que estava lá — a chave-mestra não deve dar mais
   tempo a ninguém. */
usar = troca(
  usar,
  "  update public.matches set public_state = estado, version = version + 1 where id = p_match;\n  return jsonb_build_object('ok', true);",
  `  update public.matches
     set public_state = estado,
         version = version + 1,
         turn_deadline = case when prazo is null then turn_deadline else now() + prazo end
   where id = p_match;
  return jsonb_build_object('ok', true);`,
  "o update final do usar_pista",
);

/* ── 2. o caderno aprende com o "não tenho nenhum" ────────────────────────── */

deduz = troca(
  deduz,
  `      elsif linha ->> 'type' = 'refute' and palpite is not null then`,
  `      elsif linha ->> 'type' = 'interroga_nada' then
        /* A DECLARAÇÃO MAIS FORTE DO JOGO: seis cartas de uma vez.

           Um \`pass\` de refutação diz que a pessoa não tem TRÊS cartas
           nomeadas. Isto diz que ela não tem NENHUMA das seis de um tipo — e
           num baralho de 18 para três mãos, costuma fechar um terço do caderno
           de uma vez.

           Não precisa de \`palpite\`: a frase é inteira sozinha, ao contrário do
           \`pass\`, que só significa alguma coisa colado ao palpite anterior. */
        s := linha ->> 'seat';
        foreach c in array public.dossie_cartas_do_tipo(tema, linha ->> 'tipo') loop
          if not coalesce(naotem -> s, '[]'::jsonb) @> to_jsonb(array[c]) then
            naotem := jsonb_set(naotem, array[s],
              coalesce(naotem -> s, '[]'::jsonb) || to_jsonb(array[c]), true);
          end if;
        end loop;

      elsif linha ->> 'type' = 'refute' and palpite is not null then`,
  "o ramo do refute no laço do registro",
);

/* ── 3. a faxina destrava a fase ──────────────────────────────────────────── */

sweep = troca(
  sweep,
  `      if pend is null or pend = 'null'::jsonb then
        perform public.dossie_advance(m.id);
      else`,
  `      if pend is null or pend = 'null'::jsonb then
        perform public.dossie_advance(m.id);
      elsif pend ->> 'kind' = 'interroga' then
        /* A pendência do interrogatório não tem FILA: pergunta-se a uma pessoa
           só. Sem este ramo, o cálculo de \`atual\` logo abaixo daria nulo, a
           faxina chamaria \`dossie_advance\` e o turno passaria por cima da
           pergunta — perdendo a carta de quem a jogou. */
        perform public.dossie_force_interroga(m.id);
      else`,
  "o ramo da pendência na faxina",
);

/* ── 4. a máquina responde ────────────────────────────────────────────────── */

bot = troca(
  bot,
  `  /* ── 1. REFUTAR ────────────────────────────────────────────────────────`,
  `  /* ── 0. RESPONDER AO INTERROGATÓRIO ────────────────────────────────────
     Antes até da refutação: aqui não há fila, é uma pessoa só, e enquanto ela
     não responde a mesa inteira para com trinta segundos no relógio.

     A faxina também destrava isto, mas noventa segundos depois. Numa partida
     solo, esperar a faxina para cada pergunta transformaria a carta em castigo
     de quem a jogou. */
  if est ->> 'phase' = 'interroga' and est -> 'pending' <> 'null'::jsonb
     and est -> 'pending' is not null then
    pend := est -> 'pending';
    naVez := (pend ->> 'alvo')::smallint;

    if naVez is not null then
      quem := public.dossie_dono(p_match, naVez);
      if exists (select 1 from public.profiles p where p.id = quem and p.is_bot) then
        select mps.data into priv from public.match_private_state mps
         where mps.match_id = p_match and mps.user_id = quem;

        select array_agg(c order by c) into tenho
          from jsonb_array_elements_text(coalesce(priv -> 'hand', '[]'::jsonb)) c
         where c = any(public.dossie_cartas_do_tipo(tema, pend ->> 'tipo'));

        if tenho is null or array_length(tenho, 1) = 0 then
          perform public.dossie_passa_interroga_como(naVez, p_match);
          return format('interroga:nada(%s)', naVez);
        end if;

        /* MESMA REGRA DA REFUTAÇÃO: mostre de novo o que já mostrou àquela
           pessoa. Carta nova revelada é informação de graça, e a máquina que dá
           informação de graça é a máquina que perde. */
        select c into mostrar
          from unnest(tenho) c
         where exists (
           select 1 from jsonb_array_elements(coalesce(priv -> 'mostrei', '[]'::jsonb)) m
            where m ->> 'card' = c and (m ->> 'para')::smallint = (pend ->> 'bySeat')::smallint
         )
         limit 1;

        if mostrar is null then
          select c into mostrar from unnest(tenho) c
           order by ('x' || substr(md5(semente::text || naVez::text || c), 1, 6))::bit(24)::int
           limit 1;
        end if;

        perform public.dossie_responde_interroga_como(naVez, p_match, mostrar);

        update public.match_private_state
           set data = jsonb_set(coalesce(data, '{}'::jsonb), '{mostrei}',
                 coalesce(data -> 'mostrei', '[]'::jsonb) || jsonb_build_array(
                   jsonb_build_object(
                     'card', mostrar,
                     'para', (pend ->> 'bySeat')::int,
                     'tipo', pend ->> 'tipo',
                     'tinha', (select coalesce(jsonb_agg(c), '[]'::jsonb)
                                 from unnest(tenho) c))), true)
         where match_id = p_match and user_id = quem;

        return format('interroga:mostra(%s)', naVez);
      end if;
    end if;
    return null;   -- é vez de gente responder
  end if;

  /* ── 1. REFUTAR ────────────────────────────────────────────────────────`,
  "o cabeçalho do bloco de refutação da máquina",
);

const CABECA = readFileSync("supabase/migrations/0106_dossie_interrogatorio.sql", "utf8")
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

-- ─────────────────────────────────────────────────────────────────────────────

${sweep.trimEnd()};

revoke all on function public.dossie_sweep() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

${bot.trimEnd()};

revoke all on function public.dossie_bot_passo(uuid) from public, anon, authenticated;
`;

writeFileSync("supabase/migrations/0106_dossie_interrogatorio.sql", sql, "utf8");
console.log("0106 gerado");
