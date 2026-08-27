/**
 * Gera 0047_dominio_ator.sql a partir das definicoes VIVAS no banco.
 *
 * Por que gerar em vez de escrever a mao: as seis funcoes do turno do Dominio
 * foram redefinidas em 0023, 0024, 0039 e 0040, e a versao viva de cada uma
 * esta num arquivo diferente. Copiar do arquivo errado ja custou um "cannot
 * change return type" antes. `pg_get_functiondef` nao tem essa duvida.
 *
 * A transformacao e mecanica e e a mesma para todas:
 *   1. o nome ganha `_como` e a assinatura ganha `p_seat smallint`
 *   2. a linha do `dominio_na_vez` vira `dominio_ator(p_match, p_seat)`
 *   3. `auth.uid()` vira `quem`, que e o dono daquele assento
 *   4. o declare ganha `quem uuid;`
 *
 * Nada mais muda. O ator deixa de ser ambiente e passa a ser parametro, que e a
 * mesma disciplina de "o servidor e a fonte da verdade": identidade explicita,
 * nunca implicita.
 */
import { writeFileSync } from "node:fs";
import { config } from "dotenv";
import pg from "pg";

config({ path: "d:/Cursor/Raul Games/.env.local", quiet: true });

const db = new pg.Client({
  connectionString:
    (process.env.POSTGRES_URL ?? process.env.DATABASE_URL) + "&uselibpqcompat=true",
});
await db.connect();

const ALVOS = [
  { nome: "dominio_reforcar", args: "uuid, text, int" },
  { nome: "dominio_trocar", args: "uuid, int[]" },
  { nome: "dominio_atacar", args: "uuid, text, text, int" },
  { nome: "dominio_avancar", args: "uuid, int" },
  { nome: "dominio_remanejar", args: "uuid, text, text, int" },
  { nome: "dominio_encerrar_turno", args: "uuid" },
];

const LINHA_NA_VEZ =
  "select * into est, semente, meu, mapa from public.dominio_na_vez(p_match);";
const NOVA_LINHA = `select * into est, semente, mapa, quem from public.dominio_ator(p_match, p_seat);
  meu := p_seat;`;

const partes = [];
const assinaturas = [];

for (const alvo of ALVOS) {
  const { rows } = await db.query(
    `select pg_get_functiondef(p.oid) def,
            pg_get_function_identity_arguments(p.oid) ident
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = $1`,
    [alvo.nome],
  );
  if (rows.length !== 1) {
    console.error(`  FALHA   ${alvo.nome}: ${rows.length} definicoes encontradas`);
    process.exit(1);
  }
  let def = rows[0].def;

  // 1. o nome e a assinatura
  const antes = def;
  def = def.replace(
    new RegExp(`FUNCTION public\\.${alvo.nome}\\(`),
    `FUNCTION public.${alvo.nome}_como(p_seat smallint, `,
  );
  if (def === antes) {
    console.error(`  FALHA   ${alvo.nome}: assinatura nao casou`);
    process.exit(1);
  }
  // funcao de um argumento: sobra "p_seat smallint, p_match uuid)" -> ok;
  // mas se a original nao tinha argumento nenhum sobraria virgula solta
  def = def.replace(/,\s*\)/g, ")");

  // 2. a linha do na_vez
  if (!def.includes(LINHA_NA_VEZ)) {
    console.error(`  FALHA   ${alvo.nome}: a linha do dominio_na_vez nao esta la`);
    process.exit(1);
  }
  def = def.replace(LINHA_NA_VEZ, NOVA_LINHA);

  // 3. o ator deixa de ser ambiente
  const quantasUid = (def.match(/auth\.uid\(\)/g) ?? []).length;
  def = def.replaceAll("auth.uid()", "quem");

  // 4. o declare ganha `quem`
  const MARCA = "\ndeclare\n";
  const decl = def.indexOf(MARCA);
  if (decl < 0) {
    console.error(`  FALHA   ${alvo.nome}: sem bloco declare`);
    process.exit(1);
  }
  const fim = decl + MARCA.length - 1;
  def = def.slice(0, fim) + "\n  quem uuid;" + def.slice(fim);

  // `create or replace` em vez de `CREATE OR REPLACE FUNCTION` cru, e sem o
  // ponto e virgula que o pg_get_functiondef nao poe
  partes.push(
    `-- ${alvo.nome}_como \u2014 ${quantasUid} uso(s) de auth.uid() viraram \`quem\`\n${def.trimEnd()}\n;\n`,
  );
  assinaturas.push({ nome: `${alvo.nome}_como`, ident: `p_seat smallint, ${rows[0].ident}` });
  console.log(`  ok      ${alvo.nome} -> ${alvo.nome}_como (${quantasUid} auth.uid())`);
}

await db.end();

const revogas = assinaturas
  .map(
    (a) =>
      `revoke all on function public.${a.nome}(${a.ident}) from public, anon, authenticated;`,
  )
  .join("\n");

const cabeca = `-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
-- Mesa \u2014 0047 \u00b7 o ator do Dom\u00ednio deixa de ser ambiente
--
-- Uma m\u00e1quina precisa jogar as MESMAS regras que uma pessoa. E as seis a\u00e7\u00f5es do
-- turno do Dom\u00ednio come\u00e7am todas assim:
--
--     select * into est, semente, meu, mapa from public.dominio_na_vez(p_match);
--
-- \u2014 e \`dominio_na_vez\` resolve o assento por \`auth.uid()\`. Uma m\u00e1quina n\u00e3o faz
-- login, ent\u00e3o n\u00e3o h\u00e1 \`auth.uid()\` nenhum: ela n\u00e3o consegue chamar nada disso.
--
-- HAVIA DOIS CAMINHOS, e o segundo era uma armadilha:
--
--   1. Escrever um turno de m\u00e1quina que mexe no estado por conta pr\u00f3pria. Isso
--      duplica a matem\u00e1tica do combate, o b\u00f4nus da carta de territ\u00f3rio, a
--      heran\u00e7a da m\u00e3o de quem foi eliminado e a virada de rodada da Campanha \u2014
--      e no dia em que uma regra mudar, muda em um lugar s\u00f3 e a m\u00e1quina passa a
--      jogar outro jogo. Divergiria em sil\u00eancio, que \u00e9 o pior jeito de divergir.
--
--   2. Deixar \`auth.uid()\` ser sobrescrito por \`set_config\` dentro da
--      transa\u00e7\u00e3o. Elegante, curto \u2014 e um buraco de privil\u00e9gio da mesma fam\u00edlia
--      dos dois que este projeto j\u00e1 abriu: identidade que vem do ambiente \u00e9
--      identidade que algu\u00e9m pode trocar.
--
-- O caminho escolhido \u00e9 o chato: O ATOR VIRA PAR\u00c2METRO. Cada a\u00e7\u00e3o ganha um
-- irm\u00e3o \`_como(p_seat, ...)\` que cont\u00e9m as regras, e a fun\u00e7\u00e3o p\u00fablica de mesmo
-- nome fica sendo uma casca de tr\u00eas linhas: resolve quem \u00e9 por \`auth.uid()\`, e
-- delega. Uma implementa\u00e7\u00e3o das regras, dois chamadores. \u00c9 a mesma disciplina
-- de "o servidor \u00e9 a fonte da verdade" aplicada \u00e0 identidade: expl\u00edcita, nunca
-- implicada.
--
-- ESTE ARQUIVO FOI GERADO a partir de \`pg_get_functiondef\` das defini\u00e7\u00f5es VIVAS
-- \u2014 n\u00e3o dos arquivos de migra\u00e7\u00e3o. As seis fun\u00e7\u00f5es foram redefinidas ao longo de
-- 0023, 0024, 0039 e 0040, e a viva de cada uma est\u00e1 num arquivo diferente;
-- copiar do arquivo errado j\u00e1 custou um "cannot change return type" antes.
-- O gerador est\u00e1 em scripts/gera-dominio-ator.mjs, e a transforma\u00e7\u00e3o \u00e9 mec\u00e2nica:
-- o nome ganha \`_como\`, a assinatura ganha \`p_seat\`, a linha do \`dominio_na_vez\`
-- vira \`dominio_ator\`, e \`auth.uid()\` vira \`quem\`. Nada mais muda.
-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

-- \u2500\u2500 o ator, sem ambiente nenhum \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

/**
 * O que \`dominio_na_vez\` fazia, mas com o assento DITO em vez de descoberto.
 * Devolve tamb\u00e9m o dono daquele assento, porque as regras precisam dele para
 * mexer na m\u00e3o de cartas \u2014 e essa \u00e9 a \u00fanica coisa que \`auth.uid()\` dava e que
 * um par\u00e2metro tem de dar tamb\u00e9m.
 */
create or replace function public.dominio_ator(
  p_match uuid, p_seat smallint,
  out r_estado jsonb, out r_seed bigint, out r_mapa jsonb, out r_user uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  faltou jsonb;
  vivo   text;
begin
  select m.public_state, m.seed, m.status
    into r_estado, r_seed, vivo
    from public.matches m where m.id = p_match for update;
  if not found then raise exception 'MATCH_NOT_FOUND'; end if;
  if vivo <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;

  select mp.user_id into r_user
    from public.match_players mp
   where mp.match_id = p_match and mp.seat = p_seat;
  if r_user is null then raise exception 'NOT_A_PLAYER'; end if;

  if (r_estado ->> 'turnSeat')::smallint <> p_seat then
    raise exception 'NOT_YOUR_TURN';
  end if;

  faltou := jsonb_build_object(
    'abates',      coalesce(r_estado -> 'abates', '{}'::jsonb),
    'cartasDadas', coalesce(r_estado -> 'cartasDadas', '0'::jsonb),
    'avanco',      coalesce(r_estado -> 'avanco', 'null'::jsonb)
  );
  if not (r_estado @> faltou) then
    r_estado := faltou || r_estado;
    update public.matches m set public_state = r_estado where m.id = p_match;
  end if;

  select data into r_mapa from public.game_themes gt
   where gt.id = (r_estado ->> 'map');
end;
$$;

revoke all on function public.dominio_ator(uuid, smallint) from public, anon, authenticated;

/**
 * E \`dominio_na_vez\` passa a ser a casca de autentica\u00e7\u00e3o do \`dominio_ator\`.
 *
 * A ORDEM DAS CONFER\u00caNCIAS \u00c9 A MESMA DE ANTES, de prop\u00f3sito: partida existe,
 * partida rodando, sou jogador, \u00e9 minha vez. Trocar a ordem trocaria a mensagem
 * de erro que o cliente recebe, e h\u00e1 teste em cima de cada uma delas.
 */
create or replace function public.dominio_na_vez(
  p_match uuid,
  out r_estado jsonb, out r_seed bigint, out r_seat smallint, out r_mapa jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  vivo text;
  lixo uuid;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select m.status into vivo from public.matches m where m.id = p_match;
  if not found then raise exception 'MATCH_NOT_FOUND'; end if;
  if vivo <> 'running' then raise exception 'MATCH_NOT_RUNNING'; end if;

  select mp.seat into r_seat
    from public.match_players mp
   where mp.match_id = p_match and mp.user_id = auth.uid();
  if r_seat is null then raise exception 'NOT_A_PLAYER'; end if;

  select * into r_estado, r_seed, r_mapa, lixo
    from public.dominio_ator(p_match, r_seat);
end;
$$;

revoke all on function public.dominio_na_vez(uuid) from public, anon, authenticated;

-- \u2500\u2500 as seis a\u00e7\u00f5es, com o ator dito \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

`;

const cascas = `
-- \u2500\u2500 e as seis p\u00fablicas viram casca \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
-- Tr\u00eas linhas cada uma: resolve quem \u00e9, e delega. \`dominio_na_vez\` continua
-- sendo quem estoura NOT_AUTHENTICATED, NOT_A_PLAYER e NOT_YOUR_TURN, e por isso
-- nenhuma mensagem de erro do cliente muda.

create or replace function public.dominio_reforcar(p_match uuid, p_ter text, p_qtd int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare est jsonb; s bigint; meu smallint; mp jsonb;
begin
  select * into est, s, meu, mp from public.dominio_na_vez(p_match);
  return public.dominio_reforcar_como(meu, p_match, p_ter, p_qtd);
end;
$$;

create or replace function public.dominio_trocar(p_match uuid, p_cartas int[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare est jsonb; s bigint; meu smallint; mp jsonb;
begin
  select * into est, s, meu, mp from public.dominio_na_vez(p_match);
  return public.dominio_trocar_como(meu, p_match, p_cartas);
end;
$$;

create or replace function public.dominio_atacar(
  p_match uuid, p_de text, p_para text, p_vezes int default 1
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare est jsonb; s bigint; meu smallint; mp jsonb;
begin
  select * into est, s, meu, mp from public.dominio_na_vez(p_match);
  return public.dominio_atacar_como(meu, p_match, p_de, p_para, p_vezes);
end;
$$;

create or replace function public.dominio_avancar(p_match uuid, p_qtd int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare est jsonb; s bigint; meu smallint; mp jsonb;
begin
  select * into est, s, meu, mp from public.dominio_na_vez(p_match);
  return public.dominio_avancar_como(meu, p_match, p_qtd);
end;
$$;

create or replace function public.dominio_remanejar(
  p_match uuid, p_de text, p_para text, p_qtd int
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare est jsonb; s bigint; meu smallint; mp jsonb;
begin
  select * into est, s, meu, mp from public.dominio_na_vez(p_match);
  return public.dominio_remanejar_como(meu, p_match, p_de, p_para, p_qtd);
end;
$$;

create or replace function public.dominio_encerrar_turno(p_match uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare est jsonb; s bigint; meu smallint; mp jsonb;
begin
  select * into est, s, meu, mp from public.dominio_na_vez(p_match);
  return public.dominio_encerrar_turno_como(meu, p_match);
end;
$$;

-- \u2500\u2500 privil\u00e9gio \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
-- OS N\u00daCLEOS N\u00c3O S\u00c3O CHAM\u00c1VEIS PELO CLIENTE, e este \u00e9 o ponto mais delicado do
-- arquivo: \`dominio_atacar_como(3, ..., 'x', 'y', 1)\` age no lugar do assento 3.
-- \u00c9 exatamente o buraco que \`dominio_termina\` abriu em 0025 \u2014 fun\u00e7\u00e3o que recebe
-- de quem \u00e9 a a\u00e7\u00e3o como argumento e obedece. As tr\u00eas palavras, nas seis.

${revogas}

grant execute on function public.dominio_reforcar(uuid, text, int) to authenticated;
grant execute on function public.dominio_trocar(uuid, int[]) to authenticated;
grant execute on function public.dominio_atacar(uuid, text, text, int) to authenticated;
grant execute on function public.dominio_avancar(uuid, int) to authenticated;
grant execute on function public.dominio_remanejar(uuid, text, text, int) to authenticated;
grant execute on function public.dominio_encerrar_turno(uuid) to authenticated;
`;

writeFileSync(
  "d:/Cursor/Raul Games/supabase/migrations/0047_dominio_ator.sql",
  cabeca + partes.join("\n") + cascas,
  "utf8",
);
console.log("\n0047_dominio_ator.sql gerado\n");
