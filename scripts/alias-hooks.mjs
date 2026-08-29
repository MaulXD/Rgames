/**
 * Os ganchos de módulo: `@/`, extensão implícita, JSON e JSX.
 *
 * Registrado por `scripts/alias.mjs`. Vive num arquivo próprio porque um gancho
 * precisa importar coisa (o SWC), e gancho escrito como `data:` URL não importa
 * nada com conforto.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O QUE CADA GANCHO RESOLVE
 *
 *   @/                O apelido do `tsconfig`, que o Node não lê.
 *   sem extensão      O TypeScript importa "@/lib/dossie"; o Node quer ".ts".
 *   .json             O TypeScript importa sem cerimônia; o Node quer o
 *                     atributo `type: "json"`.
 *   .tsx              O Node 24 tira TIPOS sozinho e NÃO tira JSX. É aqui que
 *                     o gancho deixa de ser conveniência e vira o que destrava
 *                     testar componente.
 *
 * O TRANSFORMADOR JÁ ESTAVA INSTALADO: o SWC vem dentro do Next. Nenhuma
 * dependência nova para renderizar uma tela — o que importa, porque a alternativa
 * era um `vitest` mais um `jsdom` mais uma configuração, tudo para provar que
 * uma abertura de caso não estoura.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const RAIZ = new URL("../", import.meta.url).href;

/** O TypeScript importa sem extensão; o Node exige. Sondar fecha a distância. */
function comExtensao(url) {
  if (existsSync(fileURLToPath(url))) return url;
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const tentativa = url + ext;
    if (existsSync(fileURLToPath(tentativa))) return tentativa;
  }
  return url;
}

/* O atributo do JSON tem de sair no RESULTADO do gancho, e não no contexto que
   se passa adiante: o contexto é o que o gancho RECEBEU, e o Node valida contra
   o que ele DEVOLVE. */
async function comJson(promessa) {
  const r = await promessa;
  return r.url.endsWith(".json")
    ? { ...r, importAttributes: { type: "json" }, format: "json" }
    : r;
}

export async function resolve(especificador, contexto, proximo) {
  if (especificador.startsWith("@/")) {
    return comJson(proximo(comExtensao(new URL(especificador.slice(2), RAIZ).href), contexto));
  }
  if (especificador.startsWith("./") || especificador.startsWith("../")) {
    return comJson(
      proximo(comExtensao(new URL(especificador, contexto.parentURL).href), contexto),
    );
  }
  return proximo(especificador, contexto);
}

/* O SWC é caro de carregar e barato de reusar: uma vez só, na primeira `.tsx`. */
let swc = null;
async function transformador() {
  if (!swc) swc = await require("next/dist/build/swc").loadBindings();
  return swc;
}

export async function load(url, contexto, proximo) {
  if (!url.endsWith(".tsx")) return proximo(url, contexto);

  const fonte = await readFile(fileURLToPath(url), "utf8");
  const { code } = await (
    await transformador()
  ).transform(fonte, {
    filename: fileURLToPath(url),
    jsc: {
      parser: { syntax: "typescript", tsx: true },
      target: "es2022",
      /* `automatic` para não precisar de `import React` nos componentes — que é
         o que o Next faz, e o que os arquivos deste projeto assumem. */
      transform: { react: { runtime: "automatic" } },
    },
    module: { type: "es6" },
  });

  return { format: "module", source: code, shortCircuit: true };
}
