#!/usr/bin/env node
/**
 * Gera `lib/dominio/relampago.json` a partir de `vantara.json`.
 *
 *   node scripts/gera-mapa-relampago.mjs
 *
 * POR QUE DERIVAR EM VEZ DE ESCREVER À MÃO
 *
 * O mapa Relâmpago é um RECORTE de Vantara (PRD 04 §3): os mesmos lugares, com
 * os mesmos nomes e as mesmas fronteiras, sem a metade norte. Escrever 24
 * territórios num segundo arquivo é garantir que um dia os dois discordem sobre
 * onde termina a Velária — e a discordância aparece como um ataque que o mapa
 * mostra e o servidor recusa.
 *
 * Derivar deixa uma fonte só para a topologia. O que este script ACRESCENTA, e
 * que não dá para derivar, são as três decisões de desenho:
 *
 *   1. QUAIS territórios entram
 *   2. A QUEM pertence a fatia de Khadar
 *   3. QUANTO vale cada continente com o mapa menor
 *
 * O resto — nome, coluna, linha, fronteira — é recortado, e recortado por
 * programa.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 1. QUAIS ENTRAM
 *
 * O PRD pede "Meridiana, Velária, Sarnath, Nauria + oeste de Khadar", 24 no
 * total. Os quatro continentes dão 21, e faltam três de Khadar.
 *
 * "Oeste de Khadar" pela coluna seria `sarn`, `guran` e `ryn` — e o mapa sairia
 * PARTIDO. A Nauria tem uma porta de terra só, `corais → amur`, e `amur` está
 * na coluna 9. Sem ela, quatro territórios ficam inalcançáveis a partida
 * inteira, o que não é um mapa difícil: é um mapa quebrado.
 *
 * Então a fatia é `guran`, `ryn`, `amur` — a mesma quantidade, e a que forma a
 * ponte: guran → ryn → amur → corais. A letra do PRD diz "oeste"; o que ele
 * quer é um recorte jogável dos quatro continentes, e é isso que isto é.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 2. A FATIA VIRA SARNATH
 *
 * Todo território precisa de continente, e o PRD pede QUATRO. `guran` faz
 * fronteira com `zubar` e `nilar`, que são Sarnath, então a anexação é
 * contígua — e o validador confere isso, não a minha palavra.
 *
 * Narrativamente também fecha: Deserto de Guran e Planície de Ryn ao lado do
 * Deserto de Khem e do Vale do Nilar. A fronteira de Khadar recuou; os lugares
 * continuam onde estavam.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 3. O BÔNUS ACOMPANHA O TAMANHO E A DIFICULDADE
 *
 * Vantara usa, grosso modo, metade do tamanho — com a Velária pagando mais que
 * o tamanho por ser corredor, e a Meridiana pagando pouco por ser fortaleza:
 *
 *     aurelia 9→5   meridiana 4→2   velaria 7→5
 *     sarnath 6→3   khadar 12→7     nauria 4→2
 *
 * No Relâmpago a Sarnath cresce para 9 e vira o continente grande, com muitas
 * portas: +5. A Nauria continua com quatro territórios e UMA porta, e continua
 * valendo +2 — fortaleza barata é o que faz alguém tentar. Meridiana e Velária
 * ficam como estavam, porque não mudaram de tamanho nem de forma.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const vantara = JSON.parse(readFileSync(join(raiz, "lib", "dominio", "vantara.json"), "utf8"));

/** Os quatro continentes inteiros, mais a ponte de Khadar. */
const CONTINENTES_INTEIROS = ["meridiana", "velaria", "sarnath", "nauria"];
const PONTE_DE_KHADAR = ["guran", "ryn", "amur"];

/** A quem a ponte pertence agora. */
const ANEXA_A = "sarnath";

/** O que cada continente vale no mapa menor. */
const BONUS = { meridiana: 2, velaria: 5, sarnath: 5, nauria: 2 };

const dentro = new Set(
  vantara.territorios
    .filter((t) => CONTINENTES_INTEIROS.includes(t.continente))
    .map((t) => t.id)
    .concat(PONTE_DE_KHADAR),
);

const territorios = vantara.territorios
  .filter((t) => dentro.has(t.id))
  .map((t) => ({
    id: t.id,
    nome: t.nome,
    continente: PONTE_DE_KHADAR.includes(t.id) ? ANEXA_A : t.continente,
    /* As coordenadas encolhem junto: a grade de Vantara é 12 × 7 e o recorte
       ocupa um retângulo dentro dela. Manter os números originais deixaria
       metade da tela vazia, e o mapa se desenha a partir daqui. */
    col: t.col,
    row: t.row,
    vizinhos: t.vizinhos.filter((v) => dentro.has(v)),
  }));

const minCol = Math.min(...territorios.map((t) => t.col));
const minRow = Math.min(...territorios.map((t) => t.row));
for (const t of territorios) {
  t.col -= minCol;
  t.row -= minRow;
}

/* E as colunas e linhas que ficaram VAZIAS somem.

   Recortar deixa buracos: a Aurélia ocupava as colunas 0 a 3, e sem ela a
   Meridiana fica sozinha à esquerda com duas colunas de nada até a Velária. O
   mapa se desenha a partir destes números, e duas colunas vazias são um vazio de
   verdade na tela — num celular, onde a largura é o recurso escasso, é um terço
   do mapa gasto com nada.

   Compactar NÃO mente sobre vizinhança: o mapa desenha uma linha por fronteira,
   e nunca infere fronteira de células encostadas. Vantara já depende disso —
   `boreal` na coluna 0 faz fronteira com `oriental` na 11. */
function compacta(eixo) {
  const usados = [...new Set(territorios.map((t) => t[eixo]))].sort((a, b) => a - b);
  const novo = new Map(usados.map((v, i) => [v, i]));
  for (const t of territorios) t[eixo] = novo.get(t[eixo]);
  return usados.length;
}
const cols = compacta("col");
const rows = compacta("row");

const continentes = vantara.continentes
  .filter((c) => CONTINENTES_INTEIROS.includes(c.id))
  .map((c) => ({ ...c, bonus: BONUS[c.id] }));

/* Os portos que sobraram. O objetivo "conquistar todos os portos" só faz
   sentido se sobrar porto suficiente para ser um desafio e pouco para ser
   possível — com dois, seria de graça. */
const portos = vantara.portos.filter((p) => dentro.has(p));

/* ── os objetivos ──────────────────────────────────────────────────────────
   Os oito de Vantara falam de Aurélia e de Khadar, que não existem aqui. Estes
   são escritos para o recorte, e a régua é a de sempre: cada um tem de ser
   alcançável a partir de qualquer posição inicial, e nenhum pode ser tão fácil
   que se cumpra sozinho.

   Vinte e quatro territórios com 3 a 6 jogadores dão 4 a 8 territórios cada, e
   é por isso que os alvos de contagem aqui são 13 e 10 — mais ou menos metade e
   um terço do mapa, as mesmas proporções que Vantara usa com 42. */
const objetivos = [
  {
    id: "velaria-nauria",
    texto: "Conquistar Velária e Nauria",
    tipo: "continentes",
    continentes: ["velaria", "nauria"],
  },
  {
    id: "sarnath-meridiana",
    texto: "Conquistar Sarnath e Meridiana",
    tipo: "continentes",
    continentes: ["sarnath", "meridiana"],
  },
  {
    id: "meridiana-mais-um",
    texto: "Conquistar Meridiana e mais um continente à sua escolha",
    tipo: "continentes",
    continentes: ["meridiana"],
    alvo: 1,
  },
  {
    id: "nauria-mais-seis",
    texto: "Conquistar Nauria e mais 6 territórios em qualquer lugar",
    tipo: "continentes",
    continentes: ["nauria"],
    extras: 6,
  },
  { id: "treze", texto: "Conquistar 13 territórios", tipo: "territorios", alvo: 13 },
  {
    id: "dez-com-dois",
    texto: "Conquistar 10 territórios com pelo menos 2 exércitos em cada",
    tipo: "territorios-com-dois",
    alvo: 10,
  },
  { id: "portos", texto: "Conquistar todos os portos do mapa", tipo: "portos" },
];

const mapa = { continentes, territorios, objetivos, portos };

writeFileSync(
  join(raiz, "lib", "dominio", "relampago.json"),
  JSON.stringify(mapa, null, 2) + "\n",
  "utf8",
);

console.log(`relampago.json: ${territorios.length} territórios, ${continentes.length} continentes`);
for (const c of continentes) {
  const n = territorios.filter((t) => t.continente === c.id).length;
  console.log(`  ${c.nome.padEnd(12)} ${n} territórios, bônus +${c.bonus}`);
}
const grau =
  territorios.reduce((s, t) => s + t.vizinhos.length, 0) / territorios.length;
console.log(`  grau médio ${grau.toFixed(2)} · ${portos.length} portos · grade ${cols} × ${rows}`);
const sozinhos = territorios.filter((t) => t.vizinhos.length === 0);
if (sozinhos.length) console.log(`  ISOLADOS: ${sozinhos.map((t) => t.id).join(", ")}`);
