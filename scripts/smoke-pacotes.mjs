#!/usr/bin/env node
/**
 * Os pacotes de conteúdo: o que o cliente empacota e o que o servidor publica
 * são a mesma coisa?
 *
 *   npm run smoke:pacotes
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUE ISTO EXISTE
 *
 * A primeira pessoa a jogar o Dossiê recebeu uma tela de erro. A causa foi de
 * FORMA: a narração dos três casos novos estava publicada como objeto
 * (`{ 0: "…" }`) e a abertura a percorre com `.map`. Setecentas e sessenta
 * verificações de servidor não achariam isso nunca, porque o servidor não liga
 * para a forma da narração — quem liga é a tela.
 *
 * Esta suíte cuida dessa fronteira, e ela tem duas metades:
 *
 *   1. O CLIENTE EMPACOTA JSON, O SERVIDOR LÊ O PUBLICADO.
 *
 *      `lib/dominio/vantara.json` é importado pelo componente do mapa e vira
 *      parte do bundle. A mesma coisa vive em `game_themes`, e é de lá que o
 *      servidor tira a adjacência para autorizar um ataque.
 *
 *      Editar o JSON e esquecer de rodar `npm run mapa` produz o pior tipo de
 *      defeito: a tela desenha uma fronteira que o servidor não conhece, o
 *      ataque é recusado, e não há nada na tela dizendo por quê. Os dois lados
 *      "funcionam" — eles só discordam.
 *
 *   2. O QUE ESTÁ PUBLICADO TEM A FORMA QUE A TELA ESPERA.
 *
 *      O Dossiê não empacota nada: cada caso é baixado do banco quando a
 *      partida começa. Então não há o que comparar — há o que CONFERIR. Cada
 *      campo que um componente dereferencia com `.map`, `.length` ou índice tem
 *      de estar publicado com a forma certa, nos quatro casos.
 *
 * A regra que sai das duas: CONTEÚDO NÃO PODE DERRUBAR O MOTOR. Um pacote é
 * dado, e dado errado merece uma tela feia — nunca uma tela quebrada.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";
import { validaTema } from "./valida-tema.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(raiz, ".env.local"), quiet: true });

let falhas = 0;
const ok = (c, m) => {
  if (!c) falhas++;
  console.log(`${c ? "  ok    " : "  FALHA "} ${m}`);
};

const conn = new URL(process.env.POSTGRES_URL_NON_POOLING);
conn.searchParams.set("uselibpqcompat", "true");
const db = new pg.Pool({ connectionString: conn.toString(), max: 2, keepAlive: true });

const publicado = async (id) =>
  (await db.query("select data from public.game_themes where id = $1", [id])).rows[0]?.data;

const local = (arq) => JSON.parse(readFileSync(join(raiz, "lib", arq), "utf8"));

console.log("\nPACOTES — o cliente e o servidor têm o mesmo conteúdo?\n");

/* ── 1. O QUE O CLIENTE EMPACOTA CONTRA O QUE ESTÁ NO AR ──────────────────── */

/**
 * Compara dois pacotes campo a campo.
 *
 * `ignora` existe para os campos DERIVADOS na publicação: `seed-dominio.mjs`
 * calcula `adjacencia` a partir de `territorios[].vizinhos` para o servidor não
 * precisar percorrer o array a cada ataque. Ele não está no JSON local e não
 * deveria estar — derivado que se guarda nos dois lugares é derivado que
 * diverge.
 */
/**
 * JSON com as chaves em ordem, recursivamente.
 *
 * `jsonb` do Postgres NÃO guarda a ordem em que as chaves chegaram: ele
 * normaliza por tamanho e depois por bytes. Comparar com `JSON.stringify` cru
 * acusa divergência em TODO objeto, e a primeira rodada desta suíte reprovou os
 * três pacotes por isso — um teste que reprova sempre é um teste que se aprende
 * a ignorar, e eu quase o deixei assim.
 *
 * Ordenar antes de comparar responde à pergunta que interessa: o CONTEÚDO é o
 * mesmo? A ordem das chaves nunca foi contrato de nada.
 */
function canonico(v) {
  if (Array.isArray(v)) return v.map(canonico);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonico(v[k])]),
    );
  }
  return v;
}
const mesmo = (a, b) => JSON.stringify(canonico(a)) === JSON.stringify(canonico(b));

function compara(nome, doCliente, doServidor, ignora = []) {
  if (!doServidor) {
    ok(false, `${nome}: não está publicado — o cliente tem e o servidor não`);
    return;
  }
  const chaves = [...new Set([...Object.keys(doCliente), ...Object.keys(doServidor)])].filter(
    (k) => !ignora.includes(k),
  );
  const diferentes = chaves.filter((k) => !mesmo(doCliente[k], doServidor[k]));
  ok(
    diferentes.length === 0,
    diferentes.length === 0
      ? `${nome}: o JSON do bundle e o pacote publicado são idênticos (${chaves.length} campos)`
      : `${nome}: DIVERGEM em ${diferentes.join(", ")} — rode a semeadura;` +
        " enquanto isso a tela desenha o que o servidor não conhece",
  );
}

/* ESTA COMPARAÇÃO TEM DENTES?

   Uma suíte que passa na primeira rodada e nunca reprova é decoração. Antes de
   confiar nela para dizer "cliente e servidor concordam", vale provar que ela
   sabe DISCORDAR — e provar com o tipo de diferença que aconteceria de verdade:
   um vizinho a mais num território, que é exatamente o que uma edição no JSON
   sem republicar produz.

   E a outra ponta importa igual: a ordem das chaves NÃO pode contar, porque o
   `jsonb` reordena e aí a suíte reprovaria sempre. */
{
  const base = { territorios: [{ id: "a", vizinhos: ["b"] }], nome: "x" };
  const trocado = { nome: "x", territorios: [{ vizinhos: ["b"], id: "a" }] };
  const alterado = { territorios: [{ id: "a", vizinhos: ["b", "c"] }], nome: "x" };
  ok(
    mesmo(base, trocado),
    "a comparação ignora a ordem das chaves — o `jsonb` reordena, e ordem nunca foi contrato",
  );
  ok(
    !mesmo(base, alterado),
    "e enxerga um vizinho a mais num território — que é o que uma edição sem republicar produz",
  );
}

compara("dominio/vantara", local("dominio/vantara.json"), await publicado("vantara"), [
  "adjacencia",
]);
compara("dominio/relampago", local("dominio/relampago.json"), await publicado("relampago"), [
  "adjacencia",
]);
compara("metropole/capibara", local("metropole/cidade.json"), await publicado("capibara"));

/* ── 2. A FORMA DO QUE ESTÁ PUBLICADO ─────────────────────────────────────── */

/**
 * O contrato, escrito como a TELA usa e não como o banco guarda.
 *
 * Cada linha aqui existe porque um componente faz `.map`, `.length` ou índice em
 * cima do campo. `narracao` está na lista pelo motivo mais caro possível: ela
 * não estava, e a abertura quebrou em três dos quatro casos.
 */
const CONTRATO = {
  dossie: {
    suspects: "array",
    weapons: "array",
    rooms: "array",
    adjacency: "object",
    secretPassages: "array",
    narracao: "array",
    victim: "object",
    copy: "object",
    clima: "string",
    encerramento: "string",
    tagline: "string",
  },
  dominio: {
    continentes: "array",
    territorios: "array",
    objetivos: "array",
    portos: "array",
    adjacencia: "object",
  },
  metropole: {
    casas: "array",
    grupos: "array",
    sorte: "array",
    reves: "array",
    eventos: "array",
    regras: "object",
  },
};

for (const [jogo, campos] of Object.entries(CONTRATO)) {
  const pacotes = (
    await db.query("select id, data from public.game_themes where game_key = $1 order by id", [
      jogo,
    ])
  ).rows;

  ok(pacotes.length > 0, `${jogo}: ${pacotes.length} pacote(s) publicado(s)`);

  for (const p of pacotes) {
    const erradas = [];
    for (const [campo, esperado] of Object.entries(campos)) {
      const v = p.data[campo];
      const achado =
        v === undefined || v === null
          ? "ausente"
          : Array.isArray(v)
            ? "array"
            : typeof v === "object"
              ? "object"
              : typeof v;
      if (achado !== esperado) erradas.push(`${campo}: ${achado} (esperado ${esperado})`);
    }
    ok(
      erradas.length === 0,
      erradas.length === 0
        ? `${jogo}/${p.id}: os ${Object.keys(campos).length} campos que a tela percorre têm a forma certa`
        : `${jogo}/${p.id}: ${erradas.join(" · ")}`,
    );
  }
}

/* ── 3. E OS ITENS DENTRO DOS ARRAYS TÊM O QUE A TELA LÊ ──────────────────── */

/* Forma do array não basta: um `rooms` com os nove itens certos e sem `col`
   desenha nove lugares empilhados na célula 0,0 do mapa. A tela não quebra —
   fica torta, que é o defeito que este projeto mais teme, porque nada acusa. */

const DENTRO = {
  dossie: {
    suspects: ["id", "name", "role", "color"],
    weapons: ["id", "name"],
    rooms: ["id", "name", "col", "row", "piso"],
  },
  dominio: {
    continentes: ["id", "nome", "bonus", "cor"],
    territorios: ["id", "nome", "continente", "col", "row", "vizinhos"],
    objetivos: ["id", "texto", "tipo"],
  },
  metropole: {
    /* A casa da Metrópole usa `pos` e `t`, e não `id` e `tipo` — e `id` só
       existe nas que são propriedade. A primeira versão desta lista chutou os
       nomes e acusou 52 chaves faltando; o contrato tem de sair do DADO, e não
       da minha lembrança de como ele devia ser. */
    casas: ["pos", "t", "nome"],
    grupos: ["id", "nome", "cor", "casa"],
  },
};

for (const [jogo, campos] of Object.entries(DENTRO)) {
  const pacotes = (
    await db.query("select id, data from public.game_themes where game_key = $1 order by id", [
      jogo,
    ])
  ).rows;

  for (const p of pacotes) {
    const faltando = [];
    for (const [campo, obrigatorios] of Object.entries(campos)) {
      const itens = p.data[campo];
      if (!Array.isArray(itens)) continue; // já reprovou acima
      for (const [i, item] of itens.entries()) {
        for (const chave of obrigatorios) {
          if (item?.[chave] === undefined) faltando.push(`${campo}[${i}].${chave}`);
        }
      }
    }
    ok(
      faltando.length === 0,
      faltando.length === 0
        ? `${jogo}/${p.id}: e todo item traz as chaves que a tela lê`
        : `${jogo}/${p.id}: faltam ${faltando.slice(0, 6).join(", ")}${faltando.length > 6 ? ` e mais ${faltando.length - 6}` : ""}`,
    );
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   E O CRIVO DO PRD 07 §5, EM CIMA DO QUE ESTÁ PUBLICADO

   "Validador — roda no CI, reprova o build." Ele existia, era bom, e rodava num
   lugar só: dentro de `npm run dossie`, o script que PUBLICA os temas.

   Quer dizer que os pacotes eram conferidos no instante em que alguém decidia
   republicá-los, e em nenhum outro. Um tema que mudasse no banco depois disso —
   por migração, por mão na tabela, por uma coluna que passasse a divergir do
   jsonb — nunca mais seria olhado, e a verificação diria "tudo passou".

   Aqui é o lugar certo para ele: esta suíte é a que pergunta se o que está
   PUBLICADO tem a forma que a tela espera. Grafo conexo, sem beco sem saída,
   diâmetro ≤ 4, duas passagens secretas, quinze pares de suspeitos separáveis
   nos três daltonismos, as seis cartas de pista nomeadas ou nenhuma, e uma
   reviravolta que o motor saiba executar.
   ══════════════════════════════════════════════════════════════════════════ */

console.log("\n  ── e cada pacote do Dossiê passa no crivo do PRD 07 §5 ──");

const temasDossie = (
  await db.query(
    "select id, data from public.game_themes where game_key = 'dossie' order by id",
  )
).rows;

ok(temasDossie.length === 4, `os quatro casos do Dossiê estão publicados (${temasDossie.length})`);

let reprovas = 0;
for (const t of temasDossie) {
  /* O crivo fala uma linha por conferência, e são dezenas por tema. Aqui só
     interessa o veredicto: quatrocentas linhas de "ok" afogariam as cento e
     poucas desta suíte. Quem quiser o detalhe roda `npm run dossie`. */
  validaTema(
    t.data,
    (cond, msg) => {
      if (!cond) {
        reprovas++;
        console.error(`  FALHA  ${t.id}: ${msg}`);
      }
    },
    false,
  );
}
ok(reprovas === 0, `nenhum dos ${temasDossie.length} casos está fora do padrão`);

await db.end();
console.log(falhas === 0 ? "\nTudo passou." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
