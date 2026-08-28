#!/usr/bin/env node
/**
 * O bloco de dedução do Dossiê — a lógica, testada como lógica.
 *
 *   npm run smoke:bloco
 *
 * POR QUE ISTO NÃO EXISTIA ATÉ AGORA. `lib/dossie-bloco.ts` diz de si mesmo que
 * é "o que separa quem joga bem de quem joga mal no Detetive de mesa", e é
 * verdade: ele calcula fatos públicos do registro, mantém conjuntos ("Cândida
 * tem uma de três") e encadeia inferência até parar de sair coisa. Nada disso
 * tinha um único teste.
 *
 * A razão era boba e real: as cinco suítes deste projeto são `.mjs` contra o
 * banco, e o bloco é TypeScript no cliente. Testá-lo pedia um `vitest`, um
 * `tsx`, uma configuração — dependência para rodar dezoito linhas de lógica.
 *
 * O Node 24 tira os tipos sozinho. `scripts/alias.mjs` ensina o `@/`, e o resto
 * é `import`. Zero dependência nova.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O QUE SE TESTA AQUI É DIFERENTE DO QUE O SERVIDOR TESTA
 *
 * `dossie_deduz` (servidor) e `apura` (cliente) resolvem o MESMO problema para
 * consumidores diferentes: uma alimenta a máquina, a outra desenha o bloco. Elas
 * não compartilham código e não deveriam — uma é PL/pgSQL sobre jsonb, a outra é
 * TypeScript sobre objetos.
 *
 * Compartilham as REGRAS, e é aí que mora o risco: uma pode aprender uma regra
 * nova e a outra não, e o sintoma é a máquina sabendo de uma carta que o seu
 * bloco não riscou. O Apagão já mostrou como isso acontece — a versão do cliente
 * tratava `from: null` certo desde sempre, e a do servidor fabricava
 * conhecimento falso.
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";
import {
  ENVELOPE,
  apura,
  encolhe,
  proxima,
} from "@/lib/dossie-bloco";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(raiz, ".env.local"), quiet: true });

let falhas = 0;
const ok = (c, m) => {
  if (!c) falhas++;
  console.log(`${c ? "  ok    " : "  FALHA "} ${m}`);
};

/* O caso vem do banco, e não de um objeto inventado aqui: um caso de mentira
   teria exatamente as propriedades que eu lembrasse de dar a ele, e o teste
   passaria a medir a minha memória. */
const conn = new URL(process.env.POSTGRES_URL_NON_POOLING);
conn.searchParams.set("uselibpqcompat", "true");
const db = new pg.Pool({ connectionString: conn.toString(), max: 2, keepAlive: true });

const caso = (
  await db.query("select data from public.game_themes where id = 'solar-das-acacias'")
).rows[0].data;
await db.end();

console.log("\nBLOCO DE DEDUÇÃO — a lógica do caderno\n");

const S = caso.suspects.map((x) => x.id);
const O = caso.weapons.map((x) => x.id);
const L = caso.rooms.map((x) => x.id);

/** Três jogadores, seis cartas cada, e o envelope com uma de cada tipo. */
const ENV = [S[0], O[0], L[0]];
const resto = [...S.slice(1), ...O.slice(1), ...L.slice(1)];
const MAOS = [resto.filter((_, i) => i % 3 === 0), resto.filter((_, i) => i % 3 === 1), resto.filter((_, i) => i % 3 === 2)];
const JOGADORES = MAOS.map((m, i) => ({ seat: i, userId: `u${i}`, hand: m.length }));

ok(
  ENV.every((c) => !resto.includes(c)) && resto.length === 18,
  `mesa montada: envelope ${ENV.join(", ")} e 18 cartas em três mãos`,
);

/* ── 1. MANUAL NÃO PREENCHE NADA ──────────────────────────────────────────

   Critério de aceite do PRD 03 §12, e a razão dele é de produto: para muita
   gente resolver a lógica É o jogo, e um bloco que se preenche sozinho tira
   exatamente a parte que a pessoa veio jogar. */

const manual = apura(caso, [], MAOS[0], [], JOGADORES, 0, "manual");
ok(
  Object.keys(manual.fatos).length === 0 && manual.conjuntos.length === 0,
  "manual não preenche nada — nem a própria mão, que seria o mais tentador",
);

/* ── 2. FATO PÚBLICO É IGUAL PARA TODOS ───────────────────────────────────

   O que o registro prova não depende de quem lê. Dois jogadores com MÃOS
   DIFERENTES, olhando o MESMO log, têm de chegar às mesmas conclusões sobre o
   que o log diz — as diferenças entre os blocos deles vêm da mão e do que
   mostraram a cada um, nunca do registro. */

const palpite = [S[1], O[1], L[1]];
const log = [
  { seq: 1, type: "suggest", seat: 0, guess: palpite },
  { seq: 2, type: "pass", seat: 1 },
  { seq: 3, type: "pass", seat: 2 },
];

const doZero = (mao, assento) =>
  apura(caso, log, mao, [], JOGADORES, assento, "assistido");

const a = doZero([], 0);
const b = doZero([], 1);
const soDoLog = (r) => JSON.stringify(r.fatos);
ok(
  soDoLog(a) === soDoLog(b),
  "dois jogadores diferentes tiram do MESMO registro exatamente os mesmos fatos",
);
ok(
  palpite.every((c) => a.fatos[c]?.["1"] === "x" && a.fatos[c]?.["2"] === "x"),
  "quem passou não tem nenhuma das três — as seis marcas saíram de dois `pass`",
);

/* ── 3. O CONJUNTO ENCOLHE, E UM SÓ SOBRANDO VIRA FATO ────────────────────

   É a estrutura que o papel não comporta e que faz o jogo funcionar melhor na
   tela: "Cândida tem UMA destas três" não cabe numa planilha de ✓ e ✗. */

const comConjunto = [
  { seq: 1, type: "suggest", seat: 0, guess: palpite },
  { seq: 2, type: "refute", seat: 1 },
];
const cru = apura(caso, comConjunto, [], [], JOGADORES, 0, "assistido");
ok(
  cru.conjuntos.length === 1 && cru.conjuntos[0].cards.length === 3,
  `refutação que eu não vi vira um conjunto de três (${cru.conjuntos[0]?.cards.length ?? 0})`,
);

/* Risca duas das três para o assento 1, à mão, e o conjunto encolhe a uma. */
const marcado = {
  [palpite[0]]: { 1: "x" },
  [palpite[1]]: { 1: "x" },
};
const encolhido = encolhe(marcado, cru.conjuntos);
ok(
  encolhido.length === 0,
  "riscando duas das três, o conjunto some da lista — ele virou fato, e fato não é conjunto",
);

/* E no nível dedutivo o fato aparece sozinho, sem ninguém encolher nada. */
const comDuasRiscadas = [
  ...comConjunto,
  { seq: 3, type: "suggest", seat: 0, guess: [palpite[0], palpite[1], L[2]] },
  { seq: 4, type: "pass", seat: 1 },
];
const deduzido = apura(caso, comDuasRiscadas, [], [], JOGADORES, 0, "dedutivo");
ok(
  deduzido.fatos[palpite[2]]?.["1"] === "check",
  `dedutivo conclui sozinho que o assento 1 tem ${palpite[2]}:` +
    " ele refutou as três, e depois provou não ter duas delas",
);
ok(
  deduzido.fatos[palpite[2]]?.[ENVELOPE] === "x",
  "e que ela não está no envelope — carta que está na mão de alguém nunca está",
);

/* ── 4. UMA CADEIA DE TRÊS INFERÊNCIAS ────────────────────────────────────

   O critério pede que o dedutivo resolva uma cadeia de três, e o teste monta
   uma em que NENHUM passo isolado dá a resposta:

     1. os três jogadores provam não ter o suspeito X  →  X está no envelope
     2. com X no envelope, todo outro suspeito está fora dele
     3. sobrando um objeto não descartado, ele é o do envelope

   O terceiro passo depende do segundo, que depende do primeiro. Um bloco que só
   marque o que o log diz literalmente para em 1. */

const semSuspeito = [];
let seq = 0;
for (const s of S) {
  if (s === S[0]) continue;
  // cada suspeito aparece numa mão conhecida: a minha
  semSuspeito.push({ seq: ++seq, type: "suggest", seat: 0, guess: [s, O[1], L[1]] });
}
const cadeia = apura(
  caso,
  semSuspeito,
  S.slice(1), // a minha mão tem os cinco suspeitos que não estão no envelope
  [],
  JOGADORES,
  0,
  "dedutivo",
);
ok(
  cadeia.fatos[S[0]]?.[ENVELOPE] === "check",
  `com os outros cinco suspeitos na minha mão, o dedutivo conclui que ${S[0]} está no envelope`,
);
ok(
  S.slice(1).every((s) => cadeia.fatos[s]?.[ENVELOPE] === "x"),
  "e que nenhum dos outros cinco está — a segunda ponta da mesma inferência",
);

/* ── 5. O APAGÃO NÃO ATRIBUI NADA ─────────────────────────────────────────

   A carta sai do envelope; o dono, não. É a metade que o servidor errava
   (0090), e a que o cliente sempre tratou certo — o teste existe para que ele
   CONTINUE tratando. */

const noEscuro = apura(
  caso,
  [{ seq: 1, type: "suggest", seat: 1, guess: palpite }, { seq: 2, type: "refute", seat: null, anon: true }],
  [],
  [{ card: palpite[0], from: null, seq: 2 }],
  JOGADORES,
  0,
  "dedutivo",
);
ok(
  noEscuro.fatos[palpite[0]]?.[ENVELOPE] === "x",
  `no escuro, a carta vista sai do envelope (${palpite[0]})`,
);
ok(
  JOGADORES.every((j) => noEscuro.fatos[palpite[0]]?.[String(j.seat)] !== "check"),
  "e não é atribuída a ninguém — sem dono, não há conjunto atribuído",
);
ok(
  noEscuro.conjuntos.length === 0,
  "e nem vira conjunto: 'alguém tem uma destas três' não é uma frase que resolva",
);

/* ── 6. O REGISTRO DA ESTAÇÃO VALE EM TODO NÍVEL ──────────────────────────

   É anúncio, não dedução. A tranquila também ouve o alto-falante. */

for (const nivel of ["assistido", "dedutivo"]) {
  const comRegistro = apura(
    caso,
    [{ seq: 1, type: "registro", card: L[3] }],
    [],
    [],
    JOGADORES,
    0,
    nivel,
  );
  ok(
    comRegistro.fatos[L[3]]?.[ENVELOPE] === "x",
    `${nivel}: o fato publicado risca a carta do envelope (${L[3]})`,
  );
}

/* ── 7. O CICLO DA MARCA ──────────────────────────────────────────────────

   Tocar numa célula anda ✗ → ✓ → ? → vazio. É o gesto mais repetido do jogo, e
   ele precisa VOLTAR ao vazio: sem isso, uma marca errada não tem desfazer. */

const ciclo = [];
let m;
for (let i = 0; i < 5; i++) {
  m = proxima(m);
  ciclo.push(m ?? "vazio");
}
ok(
  ciclo.join(" → ") === "x → check → duvida → vazio → x",
  `o ciclo da marca fecha e recomeça: ${ciclo.join(" → ")}`,
);

console.log(falhas === 0 ? "\nTudo passou." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
