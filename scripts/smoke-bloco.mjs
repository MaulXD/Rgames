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
import { comRede } from "./rede.mjs";
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
const db = comRede(new pg.Pool({ connectionString: conn.toString(), max: 2, keepAlive: true }));

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

/* ── 7. O MODO AVANÇADO NO CADERNO DE GENTE ────────────────────────────────

   O caderno da máquina aprende com as Cartas de Pista em `dossie_deduz`. Se o
   de gente não aprender, quem joga com o bloco assistido fica ABAIXO da
   máquina — riscando à mão o que ela risca sozinha — e o Modo Avançado vira
   uma vantagem do adversário.

   Estes quatro testes existem para as duas contas serem a mesma conta. */

for (const nivel of ["assistido", "dedutivo"]) {
  const comRecado = apura(
    caso,
    [],
    [],
    [],
    JOGADORES,
    0,
    nivel,
    [{ k: "recado", card: O[2] }],
  );
  ok(
    comRecado.fatos[O[2]]?.[ENVELOPE] === "x",
    `${nivel}: o recado anônimo risca a carta do envelope (${O[2]})`,
  );
}

/* A ASSIMETRIA DA IMPRESSÃO DIGITAL, medida nos dois resultados.

   O NÃO risca dois. O SIM risca os OUTROS QUATRO — e é essa metade que se
   perde primeiro quando alguém "simplifica" a carta para um "é um dos dois,
   anota aí". */
const digitalNao = apura(caso, [], [], [], JOGADORES, 0, "assistido", [
  { k: "impressao", a: S[1], b: S[2], sim: false },
]);
ok(
  digitalNao.fatos[S[1]]?.[ENVELOPE] === "x" &&
    digitalNao.fatos[S[2]]?.[ENVELOPE] === "x" &&
    digitalNao.fatos[S[3]]?.[ENVELOPE] !== "x",
  "um NÃO da impressão digital risca os dois nomeados, e só eles",
);

const digitalSim = apura(caso, [], [], [], JOGADORES, 0, "assistido", [
  { k: "impressao", a: S[0], b: S[1], sim: true },
]);
const outrosQuatro = S.filter((c) => c !== S[0] && c !== S[1]);
ok(
  outrosQuatro.every((c) => digitalSim.fatos[c]?.[ENVELOPE] === "x") &&
    digitalSim.fatos[S[0]]?.[ENVELOPE] !== "x" &&
    digitalSim.fatos[S[1]]?.[ENVELOPE] !== "x",
  `e um SIM risca os outros ${outrosQuatro.length}, sem tocar nos dois nomeados — ` +
    "a resposta fraca é a que rende mais",
);

/* "NÃO TENHO NENHUM" É PÚBLICO, e vale por seis cartas de uma vez.

   Vale SOZINHO, ao contrário do `pass`, que só significa alguma coisa colado
   ao palpite anterior — por isso o log aqui não tem palpite nenhum, e ainda
   assim tem de ensinar. */
const semNenhum = apura(
  caso,
  [{ seq: 1, type: "interroga_nada", seat: 1, tipo: "weapons" }],
  [],
  [],
  JOGADORES,
  0,
  "assistido",
);
ok(
  O.every((c) => semNenhum.fatos[c]?.["1"] === "x"),
  `o "não tenho nenhum objeto" risca as ${O.length} cartas do tipo na coluna dele`,
);
ok(
  semNenhum.fatos[O[0]]?.["2"] !== "x",
  "e não risca a coluna de mais ninguém — a frase é sobre uma pessoa só",
);

/* ── 8. O ÁLIBI MENTE, E O CADERNO SABE ────────────────────────────────────

   A carta Álibi existe para uma coisa só: deixar alguém NÃO REFUTAR TENDO A
   CARTA. É a única mentira legítima do Dossiê.

   O servidor registra o álibi e, logo depois, um `pass` normal. Um caderno que
   leia só o `pass` conclui "esta pessoa não tem nenhuma das três" — e naquele
   caso isso é FALSO. Não é perder informação: é fabricar informação falsa, e
   ela se propaga até riscar carta que está no envelope.

   Custou uma falha rara da suíte para aparecer, e o teste abaixo é o que
   impede a próxima. */

const acusado = [S[1], O[1], L[1]];
const semAlibi = apura(
  caso,
  [
    { seq: 1, type: "suggest", seat: 0, guess: acusado },
    { seq: 2, type: "pass", seat: 1 },
  ],
  [],
  [],
  JOGADORES,
  0,
  "assistido",
);
ok(
  acusado.every((c) => semAlibi.fatos[c]?.["1"] === "x"),
  "uma passada normal risca as três na coluna de quem passou",
);

const comAlibi = apura(
  caso,
  [
    { seq: 1, type: "suggest", seat: 0, guess: acusado },
    { seq: 2, type: "alibi", seat: 1 },
    { seq: 3, type: "pass", seat: 1 },
  ],
  [],
  [],
  JOGADORES,
  0,
  "assistido",
);
ok(
  acusado.every((c) => comAlibi.fatos[c]?.["1"] !== "x"),
  acusado.every((c) => comAlibi.fatos[c]?.["1"] !== "x")
    ? "e com álibi na frente, a mesma passada não risca nada — ela não prova coisa nenhuma"
    : `o caderno acreditou no álibi: ${JSON.stringify(comAlibi.fatos)}`,
);

/* O `no_refute` também. "Ninguém refutou" prova que nenhum dos outros tem
   nenhuma das três — de todo mundo MENOS de quem usou a carta. */
const ninguemComAlibi = apura(
  caso,
  [
    { seq: 1, type: "suggest", seat: 0, guess: acusado },
    { seq: 2, type: "alibi", seat: 1 },
    { seq: 3, type: "pass", seat: 1 },
    { seq: 4, type: "pass", seat: 2 },
    { seq: 5, type: "no_refute", guess: acusado },
  ],
  [],
  [],
  JOGADORES,
  0,
  "assistido",
);
ok(
  acusado.every((c) => ninguemComAlibi.fatos[c]?.["2"] === "x"),
  "num 'ninguém refutou', quem passou de verdade continua riscado",
);
ok(
  acusado.every((c) => ninguemComAlibi.fatos[c]?.["1"] !== "x"),
  acusado.every((c) => ninguemComAlibi.fatos[c]?.["1"] !== "x")
    ? "e quem alibiou fica de fora — para ele, a rodada não disse nada"
    : "o 'ninguém refutou' passou por cima do álibi",
);

/* E O ÁLIBI VALE POR UMA REFUTAÇÃO SÓ. Um palpite novo zera a lista: quem
   alibiou na rodada passada volta a ser gente cuja passada significa alguma
   coisa. */
const rodadaSeguinte = apura(
  caso,
  [
    { seq: 1, type: "suggest", seat: 0, guess: acusado },
    { seq: 2, type: "alibi", seat: 1 },
    { seq: 3, type: "pass", seat: 1 },
    { seq: 4, type: "suggest", seat: 0, guess: acusado },
    { seq: 5, type: "pass", seat: 1 },
  ],
  [],
  [],
  JOGADORES,
  0,
  "assistido",
);
ok(
  acusado.every((c) => rodadaSeguinte.fatos[c]?.["1"] === "x"),
  acusado.every((c) => rodadaSeguinte.fatos[c]?.["1"] === "x")
    ? "e o álibi vale por UMA refutação: na seguinte, a passada volta a valer"
    : "o álibi virou imunidade permanente",
);

/* ── 9. O CICLO DA MARCA ──────────────────────────────────────────────────

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

/* ══════════════════════════════════════════════════════════════════════════
   O TETO DO REGISTRO, E O QUE O CADERNO ESQUECE POR CAUSA DELE

   `dossie_log` guarda as SESSENTA linhas mais novas. O teto existe por um bom
   motivo — o registro viaja inteiro pelo Realtime a cada jogada, e um registro
   sem teto vira quilobytes por ação num celular.

   Só que `apura` deriva os fatos do REGISTRO, do zero, a cada renderização. Uma
   partida de verdade deste banco chegou a `seq` 281 com sessenta linhas
   guardadas: duzentas e vinte e uma linhas caíram, e com elas todo "fulano não
   tem nenhuma das três" que elas provavam.

   A MÁQUINA NÃO ESQUECE. `dossie_deduz` é incremental: guarda `dedu` no estado
   privado e só lê as linhas depois do último `visto`. Quer dizer que numa
   partida longa a máquina segue com o caderno cheio e a pessoa que joga com o
   bloco assistido volta a ter um caderno vazio — que é exatamente a assimetria
   que o PRD 03 diz não querer.

   Este teste mede a perda. Ele NÃO é uma prova de bug de `apura`: `apura` faz
   certo o que lhe pedem. A pergunta é se pedir isso a ela é o suficiente.
   ══════════════════════════════════════════════════════════════════════════ */

{
  const TETO = 60;

  /* Uma partida comprida: cada rodada é palpite, três passadas e um andar.
     Cinco linhas por rodada, vinte rodadas — cem linhas, e o teto corta em
     sessenta, que são as doze últimas rodadas.

     E OS PALPITES SÃO COMO NUMA PARTIDA DE VERDADE: no começo a mesa VASCULHA,
     cada palpite numa carta nova; no fim ela INSISTE nos poucos candidatos que
     sobraram. A primeira versão deste teste sorteava trios ciclando por resto
     de divisão, e as doze rodadas finais repetiam todas as cartas das oito
     primeiras — o corte não custava nada e o teste dizia que estava tudo bem.

     Era o teste medindo a própria fixture. Um registro em que as linhas velhas
     não provam nada que as novas não provem é um registro que pode ser cortado
     à vontade, e não é assim que uma partida se comporta. */
  const inteiro = [];
  let seq = 0;
  for (let r = 0; r < 20; r++) {
    const trio =
      r < 8
        ? [S[1 + (r % 5)], O[1 + ((r + 2) % 5)], L[1 + r]]
        : [S[1], O[1], L[1]];
    inteiro.push({ seq: ++seq, type: "suggest", seat: 0, guess: trio });
    inteiro.push({ seq: ++seq, type: "pass", seat: 1 });
    inteiro.push({ seq: ++seq, type: "pass", seat: 2 });
    inteiro.push({ seq: ++seq, type: "no_refute", guess: trio });
    inteiro.push({ seq: ++seq, type: "move", seat: 0, room: L[r % 9] });
  }

  /* O registro como ele chega ao cliente: as mais novas primeiro, cortado no
     teto. É o que `dossie_log` faz. */
  const cortado = [...inteiro].sort((a, b) => b.seq - a.seq).slice(0, TETO);
  const completo = [...inteiro].sort((a, b) => b.seq - a.seq);

  ok(
    inteiro.length > TETO && cortado.length === TETO,
    `a partida do teste produz ${inteiro.length} linhas e o registro guarda ${TETO}`,
  );

  const comTudo = apura(caso, completo, [], [], JOGADORES, 0, "assistido");
  const comCorte = apura(caso, cortado, [], [], JOGADORES, 0, "assistido");

  const riscadas = (f) =>
    Object.entries(f).reduce(
      (n, [, cols]) => n + Object.values(cols).filter((v) => v === "x").length,
      0,
    );

  const inteiras = riscadas(comTudo.fatos);
  const cortadas = riscadas(comCorte.fatos);

  ok(
    inteiras > cortadas,
    inteiras > cortadas
      ? `e o corte CUSTA: ${inteiras} marcas com o registro inteiro, ${cortadas} com o cortado` +
        ` — ${inteiras - cortadas} fatos que a pessoa provou e o bloco esqueceu`
      : `o corte não mudou nada (${inteiras} contra ${cortadas}) — o teste não está medindo o teto`,
  );

  /* E O QUE SE PERDE É FATO, e não palpite: cada uma dessas marcas saiu de uma
     linha PÚBLICA que todo mundo na mesa viu acontecer. */
  const sumiram = [];
  for (const [carta, cols] of Object.entries(comTudo.fatos)) {
    for (const [col, marca] of Object.entries(cols)) {
      if (marca === "x" && comCorte.fatos[carta]?.[col] !== "x") sumiram.push(`${carta}/${col}`);
    }
  }
  ok(
    sumiram.length === inteiras - cortadas,
    `e some justamente o mais antigo (${sumiram.slice(0, 3).join(", ")}${
      sumiram.length > 3 ? ` e mais ${sumiram.length - 3}` : ""
    })`,
  );

  /* ── E A SEMENTE DEVOLVE TUDO ────────────────────────────────────────────

     `dossie_caderno` entrega o que o servidor já provou para este assento —
     `fora` e `naoTem` —, e o cliente deriva o resto do registro fresco por
     cima. É o mesmo desenho incremental que `dossie_deduz` usa desde sempre,
     espelhado para quem joga.

     Aqui a semente é montada a partir do registro INTEIRO, que é o que o
     servidor teria acumulado linha a linha enquanto elas passavam. */
  const doServidor = { fora: [], naoTem: {} };
  for (const [carta, cols] of Object.entries(comTudo.fatos)) {
    for (const [col, marca] of Object.entries(cols)) {
      if (marca !== "x") continue;
      if (col === ENVELOPE) doServidor.fora.push(carta);
      else (doServidor.naoTem[col] ??= []).push(carta);
    }
  }

  const semeado = apura(caso, cortado, [], [], JOGADORES, 0, "assistido", [], doServidor);
  ok(
    riscadas(semeado.fatos) === inteiras,
    riscadas(semeado.fatos) === inteiras
      ? `e com a semente do servidor o bloco volta a ter as ${inteiras} — o teto do registro deixa de custar`
      : `a semente não devolveu tudo: ${riscadas(semeado.fatos)} de ${inteiras}`,
  );

  /* E ELA NÃO INVENTA NADA. Semear é lembrar, não adivinhar: sem registro
     nenhum, o bloco tem exatamente o que a semente trouxe, e nem uma marca a
     mais. */
  const soSemente = apura(caso, [], [], [], JOGADORES, 0, "assistido", [], doServidor);
  ok(
    riscadas(soSemente.fatos) === inteiras,
    `e sem registro nenhum ela sozinha dá as mesmas ${riscadas(soSemente.fatos)} — semear é lembrar, não adivinhar`,
  );
}

console.log(falhas === 0 ? "\nTudo passou." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
