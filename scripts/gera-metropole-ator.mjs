#!/usr/bin/env node
/**
 * Gera 0053_metropole_ator.sql a partir das definicoes VIVAS no banco.
 *
 * Mesma disciplina de 0047 no Dominio, e mais limpa aqui: na Metropole
 * `auth.uid()` aparece em DOIS lugares so -- `met_na_vez` (que exige que seja
 * sua vez) e `met_sou` (que so exige que voce esteja na partida). As quinze
 * funcoes do cliente chamam uma das duas e nao tocam em auth.uid() no corpo.
 *
 * Entao a transformacao e ainda mais mecanica:
 *   1. o nome ganha `_como` e a assinatura ganha `p_seat smallint` na frente
 *   2. a chamada de met_na_vez/met_sou vira met_ator/met_ator_livre com o
 *      assento DITO
 *
 * Uso: node scripts/gera-metropole-ator.mjs
 */
import { writeFileSync } from "node:fs";
import { config } from "dotenv";
import pg from "pg";

config({ path: "d:/Cursor/Raul Games/.env.local", quiet: true });

const db = new pg.Client({
  connectionString: process.env.POSTGRES_URL_NON_POOLING + "&uselibpqcompat=true",
});
await db.connect();

/* As do cliente que resolvem quem e por auth.uid(). `met_start` fica de fora:
   ela e do anfitriao, e anfitriao nunca e maquina. */
const { rows: alvos } = await db.query(`
  select p.proname nome,
         pg_get_function_identity_arguments(p.oid) args,
         pg_get_functiondef(p.oid) def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname like 'met\\_%'
     and p.proname not in ('met_na_vez', 'met_sou', 'met_start')
     and (pg_get_functiondef(p.oid) like '%met_na_vez(%'
       or pg_get_functiondef(p.oid) like '%met_sou(%')
   order by p.proname
`);

const partes = [];
const assinaturas = [];

for (const alvo of alvos) {
  let def = alvo.def;

  // 1. nome e assinatura
  const antes = def;
  def = def.replace(
    new RegExp(`FUNCTION public\\.${alvo.nome}\\(`),
    `FUNCTION public.${alvo.nome}_como(p_seat smallint, `,
  );
  if (def === antes) throw new Error(`${alvo.nome}: assinatura nao casou`);
  def = def.replace(/,\s*\)/g, ")");

  // 2. o resolvedor
  let qual = null;
  for (const [de, para] of [
    ["public.met_na_vez(p_match)", "public.met_ator(p_match, p_seat)"],
    ["public.met_sou(p_match)", "public.met_ator_livre(p_match, p_seat)"],
  ]) {
    if (def.includes(de)) {
      def = def.replaceAll(de, para);
      qual = de.includes("na_vez") ? "met_ator" : "met_ator_livre";
    }
  }
  if (!qual) throw new Error(`${alvo.nome}: nao achei a chamada do resolvedor`);

  partes.push(`-- ${alvo.nome}_como \u2192 ${qual}\n${def.trimEnd()}\n;\n`);
  assinaturas.push({ nome: `${alvo.nome}_como`, args: `p_seat smallint, ${alvo.args}` });
  console.log(`  ok      ${alvo.nome} -> ${alvo.nome}_como (${qual})`);
}

await db.end();

const revogas = assinaturas
  .map((a) => `revoke all on function public.${a.nome}(${a.args}) from public, anon, authenticated;`)
  .join("\n");

const cascas = alvos
  .map((a) => {
    const nomesArgs = a.args
      .split(",")
      .map((s) => s.trim().split(/\s+/)[0])
      .filter((n) => n && !n.startsWith("OUT"));
    const decl = a.args
      .split(",")
      .map((s) => s.trim())
      .join(", ");
    return `create or replace function public.${a.nome}(${decl})
returns ${/RETURNS (\S+)/.exec(a.def)[1]}
language plpgsql security definer set search_path = public as $$
declare est jsonb; s bigint; meu smallint; mp jsonb;
begin
  select * into est, s, meu, mp from public.${
    a.def.includes("met_na_vez(") ? "met_na_vez" : "met_sou"
  }(p_match);
  return public.${a.nome}_como(meu, ${nomesArgs.join(", ")});
end;
$$;`;
  })
  .join("\n\n");

const grants = alvos
  .map(
    (a) =>
      `grant execute on function public.${a.nome}(${a.args
        .split(",")
        .map((s) => s.trim().split(/\s+/).slice(1).join(" "))
        .join(", ")}) to authenticated;`,
  )
  .join("\n");

const cabeca = `-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
-- Mesa \u2014 0053 \u00b7 o ator da Metr\u00f3pole deixa de ser ambiente
--
-- O mesmo movimento de 0047 no Dom\u00ednio, e mais limpo aqui: na Metr\u00f3pole
-- \`auth.uid()\` aparece em DOIS lugares s\u00f3, e nenhum deles no corpo das a\u00e7\u00f5es.
--
--   \`met_na_vez\`  resolve quem \u00e9 E exige que seja a vez dele
--   \`met_sou\`     resolve quem \u00e9 e s\u00f3 exige que ele esteja na partida
--
-- A segunda existe porque na Metr\u00f3pole se age FORA da pr\u00f3pria vez: leil\u00e3o (todo
-- mundo d\u00e1 lance), resposta a proposta de troca, aposta do Investidor. E \u00e9 isso
-- que faz o c\u00e9rebro da m\u00e1quina aqui ser diferente do Dom\u00ednio: no Dom\u00ednio ela
-- joga um turno e passa; aqui ela pode precisar dar lance no meio do turno de
-- outra pessoa.
--
-- Cada a\u00e7\u00e3o ganha um irm\u00e3o \`_como(p_seat, ...)\` com as regras, e a fun\u00e7\u00e3o
-- p\u00fablica de mesmo nome fica sendo uma casca que resolve quem \u00e9 e delega. Uma
-- implementa\u00e7\u00e3o das regras, dois chamadores \u2014 e nenhuma regra de dinheiro,
-- aluguel, hipoteca ou leil\u00e3o escrita duas vezes.
--
-- GERADO de \`pg_get_functiondef\` das defini\u00e7\u00f5es VIVAS
-- (scripts/gera-metropole-ator.mjs). As fun\u00e7\u00f5es da Metr\u00f3pole foram redefinidas
-- ao longo de 0026\u20130038, e a viva de cada uma est\u00e1 num arquivo diferente.
-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

-- \u2500\u2500 os dois resolvedores, com o assento dito \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

create or replace function public.met_ator(
  p_match uuid, p_seat smallint,
  out r_estado jsonb, out r_seed bigint, out r_seat smallint, out r_mapa jsonb
)
returns record
language plpgsql
security definer
set search_path = public
as $$
declare
  vivo text;
  cru  jsonb;
begin
  select m.public_state, m.seed, m.status into cru, r_seed, vivo
    from public.matches m where m.id = p_match for update;
  if not found then raise exception 'MATCH_NOT_FOUND'; end if;
  if vivo <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;

  if not exists (
    select 1 from public.match_players mp
     where mp.match_id = p_match and mp.seat = p_seat
  ) then
    raise exception 'NOT_A_PLAYER';
  end if;
  r_seat := p_seat;

  if (cru ->> 'turnSeat')::smallint <> r_seat then
    raise exception 'NOT_YOUR_TURN';
  end if;

  r_estado := public.met_normaliza(cru);
  if r_estado <> cru then
    update public.matches set public_state = r_estado where id = p_match;
  end if;

  select data into r_mapa from public.game_themes gt where gt.id = (r_estado ->> 'map');
end;
$$;

create or replace function public.met_ator_livre(
  p_match uuid, p_seat smallint,
  out r_estado jsonb, out r_seed bigint, out r_seat smallint, out r_mapa jsonb
)
returns record
language plpgsql
security definer
set search_path = public
as $$
declare
  vivo text;
  cru  jsonb;
begin
  select m.public_state, m.seed, m.status into cru, r_seed, vivo
    from public.matches m where m.id = p_match for update;
  if not found then raise exception 'MATCH_NOT_FOUND'; end if;
  if vivo <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;

  if not exists (
    select 1 from public.match_players mp
     where mp.match_id = p_match and mp.seat = p_seat
  ) then
    raise exception 'NOT_A_PLAYER';
  end if;
  r_seat := p_seat;

  r_estado := public.met_normaliza(cru);
  if r_estado <> cru then
    update public.matches set public_state = r_estado where id = p_match;
  end if;

  select data into r_mapa from public.game_themes gt where gt.id = (r_estado ->> 'map');
end;
$$;

revoke all on function public.met_ator(uuid, smallint) from public, anon, authenticated;
revoke all on function public.met_ator_livre(uuid, smallint) from public, anon, authenticated;

-- \u2500\u2500 as a\u00e7\u00f5es, com o ator dito \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

`;

const fim = `
-- \u2500\u2500 e as p\u00fablicas viram casca \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
-- \`met_na_vez\` e \`met_sou\` continuam sendo quem estoura NOT_AUTHENTICATED,
-- NOT_A_PLAYER e NOT_YOUR_TURN, e por isso nenhuma mensagem de erro do cliente
-- muda.

${cascas}

-- \u2500\u2500 privil\u00e9gio \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
-- OS N\u00daCLEOS N\u00c3O S\u00c3O CHAM\u00c1VEIS PELO CLIENTE. \`met_buy_como(3, ...)\` compra no
-- lugar do assento 3 \u2014 \u00e9 o buraco de \`dominio_termina\` de 0025 outra vez. As
-- tr\u00eas palavras, em todas.

${revogas}

${grants}
`;

writeFileSync(
  "d:/Cursor/Raul Games/supabase/migrations/0053_metropole_ator.sql",
  cabeca + partes.join("\n") + fim,
  "utf8",
);
console.log("\n0053_metropole_ator.sql gerado\n");
