/**
 * Ensina o Node a importar o código do cliente.
 *
 *   node --import ./scripts/alias.mjs scripts/smoke-bloco.mjs
 *
 * POR QUE ISTO EXISTE. O Node 24 tira os tipos do TypeScript sozinho — dá para
 * importar um `.ts` direto, sem compilar, sem `tsx`, sem `vitest`, sem
 * dependência nova. Faltam quatro coisas, e as quatro estão em
 * `scripts/alias-hooks.mjs`: o apelido `@/`, a extensão implícita, o atributo do
 * JSON e o JSX.
 *
 * O que isso destrava é grande: a lógica PURA deste projeto — o bloco de dedução
 * do Dossiê, a pontuação do Letreiro, o grafo do Domínio — e, com o JSX, os
 * COMPONENTES. As suítes já provam o servidor; isto é o que faltava para provar
 * a tela.
 *
 * NÃO É UM EMPACOTADOR. Ele resolve caminho e transforma JSX, e mais nada:
 * `next/image`, CSS e o que depender do bundler continuam de fora.
 */
import { register } from "node:module";

register("./alias-hooks.mjs", import.meta.url);
