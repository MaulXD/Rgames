#!/usr/bin/env node
/**
 * Tudo, na ordem certa, com um relatório no fim.
 *
 *   npm run verifica
 *
 * POR QUE ISTO EXISTE. Antes disto, verificar o projeto era encadear onze
 * comandos à mão. Fazer isso pelo terminal tem dois defeitos que já custaram
 * caro nesta base:
 *
 *   · `npm run lint | tail -2` esconde a falha. O status do cano é o do `tail`,
 *     que sempre dá zero. Um commit saiu com erro de lint por causa disso, e a
 *     saída na tela parecia limpa.
 *
 *   · encadeando com `&&`, a primeira falha para tudo — e aí não se sabe se as
 *     outras dez também quebraram ou se era só aquela. Um relatório que diz
 *     "falhou uma" vale mais que um que diz "parou na terceira".
 *
 * A ORDEM É DELIBERADA. Primeiro o que é rápido e barato — tipo, lint, CSS,
 * pacotes, telas, bloco, build —, em sequência e em menos de um minuto. Assim,
 * quando alguma coisa está quebrada, na maior parte das vezes você descobre em
 * segundos em vez de em minutos.
 *
 * Depois as cinco suítes contra o Supabase, EM PARALELO, duas de cada vez. Elas
 * eram 29 dos 30 minutos da primeira rodada, e quase toda essa espera é latência
 * de rede: cada passo de máquina é uma ida e volta. Espera é o que se paraleliza
 * de graça.
 */
import { spawn } from "node:child_process";

/* As rápidas rodam em ordem e param cedo o que estiver quebrado; as lentas
   falam com o Supabase e rodam em paralelo. */
const RAPIDAS = [
  { nome: "typecheck", cmd: "typecheck", nota: "os tipos fecham" },
  { nome: "lint", cmd: "lint", nota: "o estilo e as regras do React" },
  { nome: "css", cmd: "css", nota: "classe com estilo, campo com nome, contraste, alvo de toque" },
  { nome: "pacotes", cmd: "smoke:pacotes", nota: "cliente e servidor têm o mesmo conteúdo" },
  { nome: "telas", cmd: "smoke:render", nota: "as telas montam com o conteúdo publicado" },
  { nome: "bloco", cmd: "smoke:bloco", nota: "o caderno de dedução do Dossiê" },
  { nome: "build", cmd: "build", nota: "o Next compila" },
];

const LENTAS = [
  { nome: "smoke", cmd: "smoke", nota: "a plataforma" },
  { nome: "letreiro", cmd: "smoke:letreiro", nota: "" },
  { nome: "dossie", cmd: "smoke:dossie", nota: "" },
  { nome: "dominio", cmd: "smoke:dominio", nota: "" },
  { nome: "metropole", cmd: "smoke:metropole", nota: "" },
];

/** Roda um script do npm e devolve o código de saída DELE, não o do cano. */
function roda(cmd) {
  return new Promise((resolve) => {
    const p = spawn("npm", ["run", cmd], {
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let saida = "";
    p.stdout.on("data", (d) => (saida += d));
    p.stderr.on("data", (d) => (saida += d));
    p.on("close", (codigo) => resolve({ codigo: codigo ?? 1, saida }));
  });
}

/** A última linha que diz alguma coisa — é onde as suítes põem o veredicto. */
function resumo(saida) {
  const linhas = saida.split("\n").map((l) => l.trim()).filter(Boolean);
  const veredicto = linhas.findLast(
    (l) => /Tudo passou|falha\(s\)|problem|error/i.test(l),
  );
  return (veredicto ?? linhas.at(-1) ?? "").slice(0, 76);
}

console.log("\nMesa — verificação completa\n");

const inicio = Date.now();
const ruins = [];

/** Mostra o veredicto de uma etapa assim que ela termina. */
function relata(etapa, codigo, saida, ms) {
  const seg = (ms / 1000).toFixed(0).padStart(3);
  if (codigo === 0) {
    console.log(`  ${etapa.nome.padEnd(11)} ok    ${seg}s   ${etapa.nota}`);
  } else {
    console.log(`  ${etapa.nome.padEnd(11)} FALHA ${seg}s   ${resumo(saida)}`);
    ruins.push({ ...etapa, saida });
  }
}

/* ── as rápidas, uma de cada vez ──────────────────────────────────────
   Elas somam menos de um minuto e a maior parte falha em segundos. Rodar em
   ordem aqui é o que faz "typecheck quebrado" aparecer antes de qualquer coisa
   ligar no Supabase. */
for (const etapa of RAPIDAS) {
  const t0 = Date.now();
  const { codigo, saida } = await roda(etapa.cmd);
  relata(etapa, codigo, saida, Date.now() - t0);
}

/* ── as suítes contra o banco, em paralelo ───────────────────────────

   Elas eram 29 dos 30 minutos, e 23 desses eram DUAS: a Metrópole (13 min) e o
   Dossiê (10 min). Cada passo de máquina é uma ida e volta ao Supabase, e o que
   o relógio mede na maior parte do tempo é latência — quer dizer, espera. Espera
   é exatamente o que se paraleliza de graça.

   AS SUÍTES SÃO INDEPENDENTES: cada uma cria os próprios jogadores, as próprias
   salas, e apaga tudo no fim. O que elas compartilham é o banco e as máquinas,
   e as duas coisas já aguentam concorrência — as varreduras usam
   `for update skip locked` desde sempre, e é por isso que os testes têm o
   `varre()` que insiste três vezes.

   DUAS DE CADA VEZ, e não cinco. O limite não é técnico, é de diagnóstico:
   quanto mais partidas simultâneas, mais uma falha intermitente vira "aconteceu
   alguma coisa" em vez de "isto quebrou". Duas cortam o tempo pela metade e
   deixam a saída legível. */
const AO_MESMO_TEMPO = 2;
const fila = [...LENTAS];

await Promise.all(
  Array.from({ length: AO_MESMO_TEMPO }, async () => {
    while (fila.length) {
      const etapa = fila.shift();
      const t0 = Date.now();
      const { codigo, saida } = await roda(etapa.cmd);
      relata(etapa, codigo, saida, Date.now() - t0);
    }
  }),
);

const total = ((Date.now() - inicio) / 1000 / 60).toFixed(1);

if (ruins.length === 0) {
  console.log(`\n  as ${(RAPIDAS.length + LENTAS.length)} etapas passaram, em ${total} min.\n`);
  process.exit(0);
}

/* A SAÍDA DE QUEM FALHOU, INTEIRA. Um relatório que diz só "falhou" obriga a
   rodar de novo para ver o quê — e rodar de novo é justamente o que custa
   minutos. */
for (const r of ruins) {
  console.log(`\n${"═".repeat(72)}\n  ${r.nome}\n${"═".repeat(72)}`);
  console.log(
    r.saida
      .split("\n")
      .filter((l) => /FALHA|error|Error|✖|warning/i.test(l))
      .slice(0, 30)
      .join("\n") || r.saida.slice(-2000),
  );
}

console.log(`\n  ${ruins.length} de ${(RAPIDAS.length + LENTAS.length)} etapas falharam, em ${total} min.\n`);
process.exit(1);
