#!/usr/bin/env node
/**
 * As telas dos quatro jogos renderizam com dados de verdade?
 *
 *   npm run smoke:render
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUE ISTO EXISTE
 *
 * A maior lacuna declarada deste projeto é que NINGUÉM VIU NENHUMA TELA. E a
 * primeira pessoa a abrir o Dossiê recebeu uma tela de erro: a narração estava
 * publicada como objeto e a abertura a percorre com `.map`.
 *
 * Setecentas e sessenta verificações de servidor não achariam aquilo, porque o
 * servidor não liga para a forma da narração. Nenhuma checagem de tipo acharia,
 * porque o TypeScript acredita no que o `as` diz. Só uma coisa acharia: montar
 * o componente com o dado que existe de verdade no banco.
 *
 * É o que esta suíte faz. Ela NÃO substitui olhos — não sabe se ficou bonito,
 * se cabe no celular, se a cor está certa. Ela responde uma pergunta só, e é a
 * que separa "feio" de "quebrado":
 *
 *     com o conteúdo que está publicado agora, a tela MONTA?
 *
 * ────────────────────────────────────────────────────────────────────────────
 * COMO, SEM NAVEGADOR E SEM DEPENDÊNCIA NOVA
 *
 * `scripts/alias-hooks.mjs` ensina o Node a carregar `.tsx` transformando o JSX
 * com o SWC que já vem dentro do Next. Daí é `renderToStaticMarkup`, que é o
 * mesmo renderizador que o servidor do Next usa.
 *
 * A ESCOLHA QUE FAZ ISSO FUNCIONAR: renderizar as FOLHAS, e não os contêineres.
 * `DossieGame` busca o caso num efeito, e efeito não roda em renderização de
 * servidor — montá-lo pararia em "Abrindo o dossiê…" e não provaria nada. As
 * folhas recebem o conteúdo por propriedade, e é nelas que moram os `.map` que
 * quebram.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";

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

/**
 * Monta um componente e confere que ele desenhou o que devia.
 *
 * `contem` é a diferença entre "montou" e "montou alguma coisa", e ela importa
 * mais do que parece: quase todo componente deste projeto tem um estado vazio —
 * "nenhuma proposta na mesa", "carregando os casos" —, e um estado vazio monta
 * lindamente com propriedade errada. Uma suíte que só exige `length > 0` passa
 * a valer zero no dia em que eu passar a propriedade com o nome trocado.
 *
 * O marcador é sempre um dado que veio do BANCO — o nome de um território, de
 * um caso, de uma propriedade. Assim ele prova as duas pontas de uma vez: o
 * componente montou, e montou com o conteúdo que está publicado.
 */
function monta(nome, componente, props, contem) {
  let html;
  try {
    html = renderToStaticMarkup(createElement(componente, props));
  } catch (e) {
    ok(false, `${nome}: ESTOUROU — ${String(e?.message).slice(0, 160)}`);
    return "";
  }

  if (contem === undefined) {
    ok(html.length > 0, `${nome}: montou (${html.length} bytes)`);
    return html;
  }

  const alvos = Array.isArray(contem) ? contem : [contem];
  const sumidos = alvos.filter((a) => !html.includes(a));
  ok(
    sumidos.length === 0,
    sumidos.length === 0
      ? `${nome}: montou com o conteúdo certo (${html.length} bytes, achou ${alvos.join(", ").slice(0, 42)})`
      : `${nome}: montou mas SEM ${sumidos.join(", ")} — provavelmente caiu no estado vazio`,
  );
  return html;
}

const nada = () => {};

console.log("\nTELAS — elas montam com o conteúdo que está publicado?\n");

/* ══════════════════════════════════════════════════════════════════════════
   DOSSIÊ — os quatro casos, e cada um nas três telas que leem o pacote
   ══════════════════════════════════════════════════════════════════════════ */

const { Abertura } = await import("@/components/dossie/abertura");
const { Mapa } = await import("@/components/dossie/mapa");
const { Bloco } = await import("@/components/dossie/bloco");

const casos = (
  await db.query(
    "select id, name, era, tagline, data from public.game_themes where game_key = 'dossie' order by id",
  )
).rows.map((r) => ({ id: r.id, name: r.name, era: r.era, tagline: r.tagline, ...r.data }));

for (const caso of casos) {
  const peoes = caso.suspects.slice(0, 3).map((s, i) => ({
    seat: i,
    userId: `u${i}`,
    nome: `Jogador ${i}`,
    avatar: null,
    suspeito: s.id,
    fantasma: false,
  }));
  const posicoes = Object.fromEntries(peoes.map((p, i) => [String(p.seat), caso.rooms[i].id]));
  const objetos = Object.fromEntries(caso.weapons.map((w, i) => [w.id, caso.rooms[i % 9].id]));

  monta(`dossie/${caso.id} · abertura`, Abertura, {
    caso,
    reviravolta: !!caso.twist,
    onFim: nada,
  }, caso.victim.name);

  monta(`dossie/${caso.id} · mapa`, Mapa, {
    caso,
    posicoes,
    objetos,
    peoes,
    euEstouEm: caso.rooms[0].id,
    destaque: null,
    alcancaveis: true,
    /* Com a tempestade em vigor, que é o estado que menos gente vai ver e o
       que tem mais caminho de código novo. */
    fechados: [caso.rooms[3].id, caso.rooms[4].id],
    aviso: [caso.rooms[5].id],
    onEscolher: nada,
  }, [caso.rooms[0].name, caso.rooms[8].name]);

  monta(`dossie/${caso.id} · bloco`, Bloco, {
    caso,
    log: [
      { seq: 1, type: "suggest", seat: 0, guess: [caso.suspects[1].id, caso.weapons[1].id, caso.rooms[1].id] },
      { seq: 2, type: "pass", seat: 1 },
      { seq: 3, type: "refute", seat: 2 },
      /* As linhas das reviravoltas entram aqui de propósito: elas são as mais
         novas e as que menos partida real produziu até agora. */
      { seq: 4, type: "apagao" },
      { seq: 5, type: "vento", rooms: [caso.rooms[0].id, caso.rooms[1].id] },
      { seq: 6, type: "registro", card: caso.weapons[2].id },
    ],
    mao: caso.suspects.slice(0, 2).map((s) => s.id),
    vistas: [{ card: caso.weapons[0].id, from: 1, seq: 2 }, { card: caso.rooms[0].id, from: null, seq: 3 }],
    jogadores: peoes.map((p) => ({ seat: p.seat, userId: p.userId, hand: 6 })),
    nomes: Object.fromEntries(peoes.map((p) => [p.seat, p.nome])),
    meuAssento: 0,
    pad: { marks: {}, assist: "dedutivo" },
    onPad: nada,
  }, [caso.suspects[0].name, caso.weapons[0].name]);
}

/* ══════════════════════════════════════════════════════════════════════════
   DOMÍNIO — os dois mapas
   ══════════════════════════════════════════════════════════════════════════ */

const { MapaVantara, LegendaContinentes } = await import("@/components/dominio/mapa");
const { mapaDe } = await import("@/lib/dominio/mapas");

for (const qual of ["vantara", "relampago"]) {
  const mapa = mapaDe(qual);
  const donos = Object.fromEntries(mapa.territorios.map((t, i) => [t.id, i % 3]));
  const exercitos = Object.fromEntries(mapa.territorios.map((t, i) => [t.id, 1 + (i % 5)]));
  const cores = { 0: "carmim", 1: "jade", 2: "prussia" };

  monta(`dominio/${qual} · mapa`, MapaVantara, {
    mapa,
    donos,
    exercitos,
    cores,
    meuAssento: 0,
    origem: mapa.territorios[0].id,
    alvos: mapa.territorios[0].vizinhos,
    mexeu: [mapa.territorios[1].id],
    onEscolher: nada,
  }, mapa.territorios[0].nome);

  monta(
    `dominio/${qual} · legenda`,
    LegendaContinentes,
    { mapa, donos, cores },
    mapa.continentes[0].nome,
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   LETREIRO — a bandeja, nas quatro peles e nos dois tamanhos
   ══════════════════════════════════════════════════════════════════════════ */

const { Board } = await import("@/components/letreiro/board");

const grades = (
  await db.query(
    /* Uma de cada tamanho. `order by size, id limit 2` trouxe duas de 4×4 e
       nenhuma de 5×5 — a bandeja grande, que é a que tem mais célula para dar
       errado, ficava sem teste. */
    `select distinct on (size) grid, size
       from public.letreiro_boards where usavel order by size, id`,
  )
).rows;

for (const g of grades) {
  for (const bandeja of ["nogueira", "osso", "fliperama", "meridiano"]) {
    monta(`letreiro/${g.size}×${g.size} · ${bandeja}`, Board, {
      grid: g.grid,
      bandeja,
      path: [0, 1],
      state: "path",
      onPathChange: nada,
      onCommit: nada,
    }, g.grid[0].replace("QU", "Qu"));
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   METRÓPOLE — o tabuleiro
   ══════════════════════════════════════════════════════════════════════════ */

const { Tabuleiro } = await import("@/components/metropole/tabuleiro");
const { CASAS } = await import("@/lib/metropole/cidade");

const props = Object.fromEntries(
  CASAS.filter((c) => c.id).map((c, i) => [
    c.id,
    { owner: i % 3, casas: i % 6, hipotecada: i % 7 === 0 },
  ]),
);

monta("metropole/capibara · tabuleiro", Tabuleiro, {
  props,
  peoes: [0, 1, 2].map((i) => ({
    seat: i,
    cor: ["carmim", "jade", "prussia"][i],
    nome: `Jogador ${i}`,
    pos: i * 7,
    preso: i === 2,
  })),
  cores: { 0: "carmim", 1: "jade", 2: "prussia" },
  meuAssento: 0,
  evento: null,
  destaque: null,
  onEscolher: nada,
}, CASAS[0].nome);

/* ══════════════════════════════════════════════════════════════════════════
   LETREIRO — a revelação, que é o pico emocional da rodada

   Ela lê uma partida ENCERRADA de verdade, e não um estado inventado: a
   revelação depende de `found`, `missed`, `scores`, `counts` e `maxScore`
   combinando entre si, e um estado montado à mão combina porque eu o montei
   para combinar.
   ══════════════════════════════════════════════════════════════════════════ */

const { Reveal } = await import("@/components/letreiro/reveal");

const encerrada = (
  await db.query(
    `select m.id, m.status, m.ends_at, m.started_at, m.public_state
       from public.matches m
      where m.game_key = 'letreiro' and m.public_state ->> 'phase' = 'reveal'
      order by m.started_at desc limit 1`,
  )
).rows[0];

if (encerrada) {
  const assentos = (
    await db.query(
      `select mp.user_id, p.display_name, p.avatar, p.is_bot
         from public.match_players mp join public.profiles p on p.id = mp.user_id
        where mp.match_id = $1 order by mp.seat`,
      [encerrada.id],
    )
  ).rows;
  monta("letreiro/revelação", Reveal, {
    match: encerrada,
    seats: assentos,
    meId: assentos[0]?.user_id ?? "",
    onDone: nada,
    onRematch: nada,
  }, assentos[0]?.display_name ?? "");
} else {
  ok(true, "letreiro/revelação: nenhuma partida em revelação no banco — nada a montar");
}

/* ══════════════════════════════════════════════════════════════════════════
   METRÓPOLE — o painel e a mesa de negociação

   A negociação é a tela mais densa do projeto: três tipos de cláusula, cada uma
   com campos próprios, e foi onde estavam os cinco campos sem nome acessível.
   ══════════════════════════════════════════════════════════════════════════ */

const { Fluxo, MinhasProps } = await import("@/components/metropole/painel");
const { Contratos, Propostas } = await import("@/components/metropole/negociar");

const nomes = { 0: "Você", 1: "Creuza", 2: "Nestor" };
const comId = CASAS.filter((c) => c.id);

monta("metropole/fluxo de caixa", Fluxo, {
  props,
  seat: 0,
  cash: 12000,
  quantosJogam: 3,
  evento: null,
  /* Marcador ESTRUTURAL e não numérico. Tentei exigir o patrimônio somado
     ("R$ 52.700") e ele muda com a hipoteca, com o número de casas, com o
     sorteio — marcador frágil reprova por motivo errado, e reprovar por motivo
     errado é como se ensina a ignorar a saída.

     As três seções provam o mesmo sem a fragilidade: "construções" só aparece
     se a conta percorreu as propriedades, e "salário" só se ela chegou no fluxo
     por rodada. */
}, ["Seu balanço", "construções", "salário"]);

monta("metropole/minhas propriedades", MinhasProps, {
  props,
  seat: 0,
  cash: 12000,
  banco: { casas: 20, hoteis: 8 },
  evento: null,
  podeAgir: true,
  onConstruir: nada,
  onVender: nada,
  onHipotecar: nada,
  onResgatar: nada,
}, comId[0].nome);

/* Um contrato de CADA tipo. Os três têm desenho próprio e só aparecem juntos
   numa partida longa — que é justamente a que ninguém jogou até agora. */
monta("metropole/contratos em vigor", Contratos, {
  contratos: [
    { id: "c1", tipo: "parcela", de: 1, para: 0, valor: 500, props: null, rodadas: 4, ate: null },
    {
      id: "c2", tipo: "isencao", de: 0, para: 2,
      valor: 0, props: [comId[0].id, comId[1].id], rodadas: 3, ate: null,
    },
    { id: "c3", tipo: "opcao", de: 2, para: 0, valor: 3000, props: [comId[2].id], rodadas: 0, ate: 14 },
  ],
  nomes,
  meuAssento: 0,
  rodada: 8,
  onExercer: nada,
}, ["parcela", "isencao", "opcao"]);

/* E uma oferta com as três cláusulas ao mesmo tempo, que é o caso mais denso
   que a tela sabe desenhar. */
monta("metropole/propostas na mesa", Propostas, {
  ofertas: [
    {
      id: "o1", de: 1, para: 0, rodada: 8,
      da: { dinheiro: 2000, props: [comId[3].id], livras: 1 },
      quer: {
        props: [comId[4].id],
        parcela: { valor: 400, rodadas: 5 },
        isencao: { props: null, rodadas: 2 },
        opcao: { prop: comId[5].id, preco: 2500, ate: 15 },
      },
    },
  ],
  nomes,
  meuAssento: 0,
  onResponder: nada,
  onRetirar: nada,
}, ["propõe", "Aceitar"]);

/* ══════════════════════════════════════════════════════════════════════════
   DOMÍNIO — a mão de cartas, nos dois mapas
   ══════════════════════════════════════════════════════════════════════════ */

const { Mao } = await import("@/components/dominio/cartas");

for (const qual of ["vantara", "relampago"]) {
  const mapa = mapaDe(qual);
  const donos = Object.fromEntries(mapa.territorios.map((t, i) => [t.id, i % 3]));
  monta(`dominio/${qual} · mão de cartas`, Mao, {
    mapa,
    /* Cinco cartas: é quando a troca deixa de ser opcional, e é o ramo que a
       tela menos mostra. */
    cartas: [
      { ter: mapa.territorios[0].id, f: "infantaria" },
      { ter: mapa.territorios[1].id, f: "cavalaria" },
      { ter: mapa.territorios[2].id, f: "canhao" },
      { ter: null, f: "coringa" },
      { ter: mapa.territorios[3].id, f: "infantaria" },
    ],
    donos,
    meuAssento: 0,
    podeTrocar: true,
    obrigado: true,
    onTrocar: nada,
  }, mapa.territorios[0].nome);
}

/* ══════════════════════════════════════════════════════════════════════════
   E A REGRESSÃO QUE ORIGINOU TUDO ISTO

   A narração como objeto em vez de lista. Não basta a suíte passar hoje: ela
   tem de REPROVAR o defeito de ontem, senão não é ela que está segurando nada.
   ══════════════════════════════════════════════════════════════════════════ */

const comObjeto = {
  ...casos[0],
  narracao: Object.fromEntries(casos[0].narracao.map((t, i) => [i, t])),
};
let estourou = false;
try {
  renderToStaticMarkup(
    createElement(Abertura, { caso: comObjeto, reviravolta: false, onFim: nada }),
  );
} catch {
  estourou = true;
}
ok(
  estourou,
  estourou
    ? "e a abertura AINDA estoura com a narração em objeto — é este o defeito que a suíte segura"
    : "a narração em objeto não estoura mais: esta suíte deixou de guardar o defeito que a criou",
);

await db.end();
console.log(falhas === 0 ? "\nTudo passou." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
