#!/usr/bin/env node
/**
 * Gera a migração 0116 — Modo Assassino.
 *
 * Uso: node scripts/gera-dossie-assassino.mjs
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

async function def(nome) {
  const { rows } = await db.query(
    `select pg_get_functiondef(p.oid) d from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = $1`,
    [nome],
  );
  if (!rows.length) throw new Error(`${nome} não existe`);
  const t = rows[0].d.replace(/\r\n/g, "\n");
  if (t.includes("assassino")) {
    throw new Error(`${nome} já conhece o Modo Assassino — devolva-a à migração anterior`);
  }
  return t;
}

let cfg = await def("set_room_settings");
let start = await def("dossie_start");
let advance = await def("dossie_advance");
let acusa = await def("dossie_accuse_como");
await db.end();

function troca(texto, de, para, onde) {
  if (!texto.includes(de)) throw new Error(`não achei ${onde}`);
  return texto.replace(de, para);
}

/* ── 1. a regra da casa ───────────────────────────────────────────────────── */

cfg = troca(
  cfg,
  `    when 'dossie'    then array['tema', 'reviravolta', 'avancado']`,
  `    when 'dossie'    then array['tema', 'reviravolta', 'avancado', 'assassino']`,
  "as chaves do Dossiê",
);

cfg = troca(
  cfg,
  `      'avancado', coalesce(
        (p_settings ->> 'avancado')::boolean,
        (sala.settings ->> 'avancado')::boolean,
        false)
    );`,
  `      'avancado', coalesce(
        (p_settings ->> 'avancado')::boolean,
        (sala.settings ->> 'avancado')::boolean,
        false),
      /* O MODO ASSASSINO também nasce desligado, pelo mesmo motivo do Avançado:
         ele muda o que o jogo É. O Dossiê normal é dedução sobre cartas; com
         assassino, é dedução sobre gente — e a mesa precisa escolher isso de
         propósito, não descobrir no meio. */
      'assassino', coalesce(
        (p_settings ->> 'assassino')::boolean,
        (sala.settings ->> 'assassino')::boolean,
        false)
    );`,
  "o objeto limpo do Dossiê",
);

/* ── 2. o sorteio do assassino ────────────────────────────────────────────── */

start = troca(
  start,
  `  i := 0;
  for membros in
    select user_id, seat from public.room_members
     where room_id = p_room and seat is not null order by seat
  loop`,
  `  /* ── QUEM É O ASSASSINO ──────────────────────────────────────────────────
     Sorteado da semente, e portanto reproduzível: a mesma partida sorteia o
     mesmo, o que importa para poder investigar uma reclamação depois.

     E É GENTE, sempre que houver gente. Duas razões, e a segunda é a que
     decide:

     De jogo: a máquina não usaria a informação. Ela deduz porque não tem outro
     jeito, e dar-lhe o envelope sem ensiná-la a mentir produziria um assassino
     que joga exatamente como um detetive.

     De confiança: a suíte confere, partida a partida, que NENHUMA máquina risca
     carta do envelope, e essa frase vale porque é absoluta. Uma exceção —
     "menos quando ela é o assassino" — é o tipo de furo que se abre uma vez e
     some dentro de um \`if\` para sempre. */
  if coalesce((sala.settings ->> 'assassino')::boolean, false) then
    select rm.seat into culpado
      from public.room_members rm
      join public.profiles p on p.id = rm.user_id
     where rm.room_id = p_room and rm.seat is not null and not p.is_bot
     order by ('x' || substr(md5(semente::text || ':assassino:' || rm.seat::text), 1, 6))
              ::bit(24)::int
     limit 1;

    -- mesa só de máquinas: cai no primeiro assento, e é partida que não existe
    -- fora de teste
    if culpado is null then
      select min(rm.seat) into culpado
        from public.room_members rm
       where rm.room_id = p_room and rm.seat is not null;
    end if;
  end if;

  i := 0;
  for membros in
    select user_id, seat from public.room_members
     where room_id = p_room and seat is not null order by seat
  loop`,
  "o laço dos jogadores",
);

start = troca(
  start,
  `    insert into public.match_private_state (match_id, user_id, data)
    values (nova.id, membros.user_id,
      jsonb_build_object('hand', to_jsonb(mao), 'seen', '[]'::jsonb, 'pad', '{}'::jsonb));`,
  `    /* O ENVELOPE VAI PARA O ASSASSINO, e para mais ninguém.

       Ele mora no estado PRIVADO, que a RLS já protege — e com o nome
       \`envelope\`, e não \`solution\`: a suíte confere que nenhuma máquina tem
       \`solution\` no privado, e essa checagem tem de continuar significando o
       que significa. */
    insert into public.match_private_state (match_id, user_id, data)
    values (nova.id, membros.user_id,
      jsonb_build_object('hand', to_jsonb(mao), 'seen', '[]'::jsonb, 'pad', '{}'::jsonb)
      || case when membros.seat = culpado then jsonb_build_object(
              'assassino', true,
              'envelope', jsonb_build_object(
                'suspect', sol_s, 'weapon', sol_w, 'room', sol_r))
         else '{}'::jsonb end);`,
  "o estado privado inicial",
);

start = troca(
  start,
  `    'round', 1,
    'twist', giro,`,
  `    'round', 1,
    /* O MODO é público; a PESSOA não. Todo mundo sabe que há um assassino na
       mesa — é isso que faz a mesa olhar de lado para todo mundo — e ninguém
       sabe quem.

       \`rodadaFinal\` entra junto e desde o começo: um limite que só aparece
       quando estoura é armadilha, não regra. Quem joga precisa sentir o tempo
       acabando. */
    'assassino', coalesce((sala.settings ->> 'assassino')::boolean, false),
    'rodadaFinal', case
                     when coalesce((sala.settings ->> 'assassino')::boolean, false)
                     then 12 else null
                   end,
    'twist', giro,`,
  "o estado inicial do Dossiê",
);

start = troca(
  start,
  `  i         int := 0;`,
  `  i         int := 0;
  culpado   smallint;`,
  "as declarações do start",
);

/* ── 3. o assassino não fecha o caso ──────────────────────────────────────── */

acusa = troca(
  acusa,
  `  if exists (select 1 from jsonb_array_elements_text(estado -> 'accused') a
              where a::smallint = meu) then
    raise exception 'ALREADY_ACCUSED';
  end if;`,
  `  if exists (select 1 from jsonb_array_elements_text(estado -> 'accused') a
              where a::smallint = meu) then
    raise exception 'ALREADY_ACCUSED';
  end if;

  /* O ASSASSINO NÃO FECHA O CASO.

     Ele sabe a resposta. Sem esta linha o modo inteiro dura um turno: ele
     acusa, acerta, e ganha como detetive. Não é caso extremo — é a jogada
     ÓBVIA, e a primeira que qualquer pessoa tentaria.

     No servidor, e não escondendo o botão: quem descobrisse a chamada ganharia
     a partida. */
  if coalesce((estado ->> 'assassino')::boolean, false) and exists (
    select 1 from public.match_private_state mps
     where mps.match_id = p_match
       and mps.user_id = public.dossie_dono(p_match, meu)
       and coalesce((mps.data ->> 'assassino')::boolean, false)
  ) then
    raise exception 'ASSASSINO_NAO_ACUSA';
  end if;`,
  "a guarda do já acusou",
);

/* ── 4. doze rodadas, e o assassino vence ─────────────────────────────────── */

advance = troca(
  advance,
  `  /* A reviravolta acontece DEPOIS do estado da rodada nova estar gravado, e
     nunca antes: \`dossie_vira_rodada\` lê \`round\` do banco para saber em que
     rodada está. Chamar antes seria fazê-la decidir sobre a rodada anterior. */
  if virou then
    perform public.dossie_vira_rodada(p_match);
  end if;`,
  `  /* ── O RELÓGIO DO ASSASSINO ──────────────────────────────────────────────
     Doze rodadas. Se ninguém fechou o caso até ali, ele venceu — e o envelope
     é aberto para a mesa ver o que passou debaixo do nariz de todo mundo.

     Vem ANTES da reviravolta porque a partida acabou: uma tempestade que fecha
     dois lugares numa mesa encerrada é ruído no registro, e a reviravolta lê o
     estado do banco, que agora diz que a fase e o fim. */
  if virou
     and coalesce((estado ->> 'assassino')::boolean, false)
     and rodada > coalesce((estado ->> 'rodadaFinal')::int, 12) then
    update public.matches
       set status = 'finished', ended_at = now(), version = version + 1,
           turn_deadline = null,
           public_state = estado || jsonb_build_object(
             'phase', 'over',
             'round', rodada,
             'winner', null,
             'assassinoVenceu', true,
             'solution', m.solution,
             'pending', null
           )
     where id = p_match;
    update public.rooms set status = 'lobby' where id = m.room_id;
    return;
  end if;

  /* A reviravolta acontece DEPOIS do estado da rodada nova estar gravado, e
     nunca antes: \`dossie_vira_rodada\` lê \`round\` do banco para saber em que
     rodada está. Chamar antes seria fazê-la decidir sobre a rodada anterior. */
  if virou then
    perform public.dossie_vira_rodada(p_match);
  end if;`,
  "a chamada da reviravolta",
);

const CABECA = readFileSync("supabase/migrations/0116_dossie_modo_assassino.sql", "utf8").replace(
  /\r\n/g,
  "\n",
);
if (CABECA.includes("CREATE OR REPLACE FUNCTION")) {
  throw new Error("o arquivo já foi gerado; parta do cabeçalho escrito à mão");
}

const sql = `${CABECA.trimEnd()}

-- ─────────────────────────────────────────────────────────────────────────────

${cfg.trimEnd()};

revoke all on function public.set_room_settings(uuid, jsonb) from public, anon;
grant execute on function public.set_room_settings(uuid, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

${start.trimEnd()};

revoke all on function public.dossie_start(uuid, text) from public, anon;
grant execute on function public.dossie_start(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

${acusa.trimEnd()};

revoke all on function public.dossie_accuse_como(smallint, uuid, text, text, text)
  from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

${advance.trimEnd()};

revoke all on function public.dossie_advance(uuid) from public, anon, authenticated;
`;

writeFileSync("supabase/migrations/0116_dossie_modo_assassino.sql", sql, "utf8");
console.log("0116 gerado");
