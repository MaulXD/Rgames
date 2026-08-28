#!/usr/bin/env node
/**
 * Gera 0056_dossie_ator.sql a partir das definicoes VIVAS no banco.
 *
 * O Dossie nao tem um resolvedor comum como o Dominio (`dominio_na_vez`) ou a
 * Metropole (`met_na_vez`): cada funcao resolve o assento na hora, sempre com o
 * mesmo par de linhas. Isso torna a transformacao ainda mais simples -- basta
 * trocar `auth.uid()` por `dossie_dono(p_match, p_seat)`, e as duas consultas
 * que usavam auth passam a olhar o dono do ASSENTO:
 *
 *   select mp.seat into meu from match_players mp
 *    where mp.match_id = p_match and mp.user_id = auth.uid();
 *
 * vira a mesma consulta com o dono do assento, o que devolve `meu = p_seat` e
 * NULL quando o assento nao existe -- exatamente o NOT_A_PLAYER de antes.
 *
 * Uso: node scripts/gera-dossie-ator.mjs
 */
import { writeFileSync } from "node:fs";
import { config } from "dotenv";
import pg from "pg";

config({ path: "d:/Cursor/Raul Games/.env.local", quiet: true });

const db = new pg.Client({
  connectionString: process.env.POSTGRES_URL_NON_POOLING + "&uselibpqcompat=true",
});
await db.connect();

/* `dossie_start` fica de fora: e do anfitriao, e anfitriao nunca e maquina. */
const { rows: alvos } = await db.query(`
  select p.proname nome,
         pg_get_function_identity_arguments(p.oid) args,
         pg_get_function_arguments(p.oid) comdefault,
         pg_get_functiondef(p.oid) def,
         (regexp_match(pg_get_functiondef(p.oid), 'RETURNS (\\S+)'))[1] retorno
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('dossie_move', 'dossie_suggest', 'dossie_refute',
                       'dossie_pass_refute', 'dossie_accuse', 'dossie_end_turn',
                       'dossie_pad')
   order by p.proname
`);

const partes = [];
const assinaturas = [];

for (const alvo of alvos) {
  let def = alvo.def;

  const antes = def;
  def = def.replace(
    new RegExp(`FUNCTION public\\.${alvo.nome}\\(`),
    `FUNCTION public.${alvo.nome}_como(p_seat smallint, `,
  );
  if (def === antes) throw new Error(`${alvo.nome}: assinatura nao casou`);
  def = def.replace(/,\s*\)/g, ")");

  const usos = (def.match(/auth\.uid\(\)/g) ?? []).length;
  if (usos === 0) throw new Error(`${alvo.nome}: nenhum auth.uid() — premissa errada`);
  def = def.replaceAll("auth.uid()", "public.dossie_dono(p_match, p_seat)");

  partes.push(`-- ${alvo.nome}_como \u2014 ${usos} uso(s) de auth.uid() viraram o dono do assento
${def.trimEnd()}
;
`);
  assinaturas.push({
    nome: `${alvo.nome}_como`,
    args: `p_seat smallint, ${alvo.args}`,
    publica: alvo.nome,
    argsPub: alvo.comdefault,
    identPub: alvo.args,
    retorno: alvo.retorno,
  });
  console.log(`  ok      ${alvo.nome} -> ${alvo.nome}_como (${usos} auth.uid())`);
}

await db.end();

const cascas = assinaturas
  .map((a) => {
    const nomes = a.identPub
      .split(",")
      .map((s) => s.trim().split(/\s+/)[0])
      .filter(Boolean);
    return `create or replace function public.${a.publica}(${a.argsPub})
returns ${a.retorno}
language plpgsql security definer set search_path = public as $$
declare meu smallint;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select mp.seat into meu from public.match_players mp
   where mp.match_id = p_match and mp.user_id = auth.uid();
  if meu is null then raise exception 'NOT_A_PLAYER'; end if;
  return public.${a.nome}(meu, ${nomes.join(", ")});
end;
$$;`;
  })
  .join("\n\n");

const revogas = assinaturas
  .map(
    (a) =>
      `revoke all on function public.${a.nome}(${a.args}) from public, anon, authenticated;`,
  )
  .join("\n");

const grants = assinaturas
  .map(
    (a) =>
      `revoke all on function public.${a.publica}(${a.identPub}) from public, anon, authenticated;
grant execute on function public.${a.publica}(${a.identPub}) to authenticated;`,
  )
  .join("\n");

const cabeca = `-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
-- Mesa \u2014 0056 \u00b7 o ator do Dossi\u00ea deixa de ser ambiente
--
-- O terceiro e \u00faltimo. O Dossi\u00ea n\u00e3o tem resolvedor comum como \`dominio_na_vez\`
-- ou \`met_na_vez\`: cada a\u00e7\u00e3o resolve o assento na hora, e sempre com o mesmo par
-- de linhas. Isso deixa a troca ainda mais simples \u2014 \`auth.uid()\` vira
-- \`dossie_dono(p_match, p_seat)\`, e as consultas continuam id\u00eanticas:
--
--   select mp.seat into meu from match_players mp
--    where mp.match_id = p_match and mp.user_id = <o dono do assento>;
--   if meu is null then raise exception 'NOT_A_PLAYER'; end if;
--
-- devolve \`meu = p_seat\` quando o assento existe e NULL quando n\u00e3o \u2014 que \u00e9
-- exatamente o NOT_A_PLAYER de antes. Nenhuma confer\u00eancia mudou de ordem, e
-- portanto nenhuma mensagem de erro do cliente mudou.
--
-- GERADO de \`pg_get_functiondef\` (scripts/gera-dossie-ator.mjs). \u00c9 a terceira
-- vez que este projeto gera em vez de copiar, e a raz\u00e3o \u00e9 sempre a mesma: as
-- fun\u00e7\u00f5es do Dossi\u00ea foram redefinidas em 0012, 0013, 0033 e 0041, e copiar do
-- arquivo errado j\u00e1 custou um "cannot change return type".
-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

/**
 * O dono de um assento nesta partida.
 *
 * \u00c9 o \u00fanico lugar em que a identidade entra nas fun\u00e7\u00f5es \`_como\` do Dossi\u00ea, e ela
 * entra pelo ASSENTO \u2014 nunca pela sess\u00e3o de quem chamou.
 */
create or replace function public.dossie_dono(p_match uuid, p_seat smallint)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select mp.user_id from public.match_players mp
   where mp.match_id = p_match and mp.seat = p_seat;
$$;

revoke all on function public.dossie_dono(uuid, smallint) from public, anon, authenticated;

-- \u2500\u2500 as a\u00e7\u00f5es, com o ator dito \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

`;

const fim = `
-- \u2500\u2500 e as p\u00fablicas viram casca \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

${cascas}

-- \u2500\u2500 privil\u00e9gio \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
-- \`dossie_accuse_como(3, ...)\` acusa no lugar do assento 3, e \`dossie_pad_como\`
-- escreve no bloco de anota\u00e7\u00f5es dele. As tr\u00eas palavras, em todas.

${revogas}

${grants}
`;

writeFileSync(
  "d:/Cursor/Raul Games/supabase/migrations/0056_dossie_ator.sql",
  cabeca + partes.join("\n") + fim,
  "utf8",
);
console.log("\n0056_dossie_ator.sql gerado\n");
