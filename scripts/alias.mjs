/**
 * Um gancho de resolução que ensina o Node a entender `@/`.
 *
 *   node --import ./scripts/alias.mjs scripts/smoke-bloco.mjs
 *
 * POR QUE ISTO EXISTE. O Node 24 tira os tipos do TypeScript sozinho — dá para
 * importar um `.ts` direto, sem compilar, sem `tsx`, sem `vitest`, sem
 * dependência nova. A única coisa que falta é o apelido `@/`, que é do
 * `tsconfig` e o Node não lê.
 *
 * Doze linhas resolvem, e o que elas destravam é grande: a lógica PURA deste
 * projeto — o bloco de dedução do Dossiê, a pontuação do Letreiro, o grafo do
 * Domínio — passa a ser testável em Node, do mesmo jeito que as suítes de
 * fumaça já testam o servidor.
 *
 * O bloco de dedução é o caso que mais precisava: ele é, nas palavras do próprio
 * arquivo, "o que separa quem joga bem de quem joga mal no Detetive de mesa", e
 * até agora não tinha um único teste — porque era TypeScript, e as suítes eram
 * `.mjs` contra o banco.
 *
 * NÃO É UM EMPACOTADOR. Ele resolve `@/` e mais nada; qualquer coisa que
 * dependa de bundler (CSS, JSX, `next/*`) continua de fora, e é por isso que o
 * que se testa aqui é lógica pura.
 */
import { pathToFileURL } from "node:url";
import { register } from "node:module";

const raiz = pathToFileURL(new URL("..", import.meta.url).pathname).href;

register(
  `data:text/javascript,
   const RAIZ = ${JSON.stringify(new URL("..", import.meta.url).href)};
   import { existsSync } from "node:fs";
   import { fileURLToPath } from "node:url";
   /* O TypeScript importa sem extensao ("@/lib/dossie"); o Node exige a
      extensao. Sondar .ts e .tsx e o que fecha a distancia, e nao ha ambiguidade
      porque este projeto nao tem .js ao lado de .ts. */
   function comExtensao(url) {
     if (existsSync(fileURLToPath(url))) return url;
     for (const ext of [".ts", ".tsx", "/index.ts"]) {
       const tentativa = url + ext;
       if (existsSync(fileURLToPath(tentativa))) return tentativa;
     }
     return url;
   }
   export function resolve(especificador, contexto, proximo) {
     if (especificador.startsWith("@/")) {
       return proximo(comExtensao(new URL(especificador.slice(2), RAIZ).href), contexto);
     }
     if (especificador.startsWith("./") || especificador.startsWith("../")) {
       return proximo(comExtensao(new URL(especificador, contexto.parentURL).href), contexto);
     }
     return proximo(especificador, contexto);
   }`,
  import.meta.url,
);

void raiz;
