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
import { comRede } from "./rede.mjs";
import {
  arquivosDeCss,
  compoe,
  declaradas,
  razao,
  regrasDeCor,
  tamanhoEmPx,
  tokensDeCss,
} from "./cores.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(raiz, ".env.local"), quiet: true });

let falhas = 0;
const ok = (c, m) => {
  if (!c) falhas++;
  console.log(`${c ? "  ok    " : "  FALHA "} ${m}`);
};

const conn = new URL(process.env.POSTGRES_URL_NON_POOLING);
conn.searchParams.set("uselibpqcompat", "true");
const db = comRede(new pg.Pool({ connectionString: conn.toString(), max: 2, keepAlive: true }));

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
const TUDO_QUE_FOI_DESENHADO = [];

function monta(nome, componente, props, contem) {
  let html;
  try {
    html = renderToStaticMarkup(createElement(componente, props));
  } catch (e) {
    ok(false, `${nome}: ESTOUROU — ${String(e?.message).slice(0, 160)}`);
    return "";
  }

  TUDO_QUE_FOI_DESENHADO.push({ nome, html });

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

const { SessionContext } = await import("@/components/session");
const { Abertura } = await import("@/components/dossie/abertura");
const { Mapa } = await import("@/components/dossie/mapa");
const { Bloco } = await import("@/components/dossie/bloco");
const { Pistas } = await import("@/components/dossie/pistas");

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

  /* AS DUAS FORMAS. A abertura normal é uma sequência de quase trinta
     segundos, um tempo da narração por vez; para quem pediu menos movimento os
     seis aparecem juntos, embaixo do cartaz. */
  for (const calmo of [false, true]) {
    monta(
      `dossie/${caso.id} · abertura${calmo ? " · inteira (menos movimento)" : ""}`,
      Abertura,
      { caso, reviravolta: !!caso.twist, calmo, onFim: nada },
      /* Na forma calma a narração está toda na tela desde o primeiro quadro, e
         é isso que se cobra: o último tempo, que a sequência só mostraria aos
         vinte e oito segundos. */
      calmo ? [caso.victim.name, String(caso.narracao.at(-1) ?? "").slice(0, 24)] : caso.victim.name,
    );
  }

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

  /* ── Modo Avançado ────────────────────────────────────────────────────
     A mão traz AS SEIS cartas de uma vez. Numa partida de verdade ninguém
     terá as seis, mas é exatamente por isso que o teste tem: cada uma desenha
     um pedaço diferente da ficha, e a que ninguém vê é a que quebra calada.

     E o marcador é a frase do ÁLIBI, que só aparece se a lista percorrer a mão
     inteira — um `slice` acidental em cima dela passaria por qualquer
     verificação de "montou". */
  monta(`dossie/${caso.id} · pistas`, Pistas, {
    caso,
    mao: ["chave-mestra", "tempo-curto", "alibi", "impressao", "recado", "interrogatorio"],
    avisos: [
      { k: "recado", card: caso.weapons[1].id },
      { k: "impressao", a: caso.suspects[0].id, b: caso.suspects[1].id, sim: true },
      { k: "impressao", a: caso.suspects[2].id, b: caso.suspects[3].id, sim: false },
    ],
    minhaVez: true,
    devoRefutar: false,
    acoesRestantes: 2,
    sozinhoAqui: true,
    jogadores: peoes.map((p) => ({ seat: p.seat, nome: p.nome })),
    meuAssento: 0,
    lugares: caso.rooms.map((r) => ({ id: r.id, name: r.name })),
    onInvestigar: nada,
    onUsar: nada,
  }, [
    /* O NOME DESTE CASO, e não o genérico: é o que prova que `copy` chegou até
       a ficha. "Álibi" apareceria de qualquer jeito, inclusive com o pacote
       ignorado — o marcador tem de ser a palavra que só este caso usa. */
    caso.copy["pista.alibi"],
    "Deixe de refutar uma vez",
    /* E os dois avisos falam a MESMA língua: os dois dizem o que sai do
       envelope. O "sim" é escrito ao contrário de propósito — é assim que ele
       serve no caderno. */
    `${caso.weapons[1].name} não está no envelope`,
    "nenhum dos outros quatro",
  ]);

  /* A mão VAZIA é um estado que toda partida avançada tem no primeiro turno, e
     é onde a tela precisa explicar como se compra uma carta. */
  monta(`dossie/${caso.id} · pistas (mão vazia, longe de todos)`, Pistas, {
    caso,
    mao: [],
    avisos: [],
    minhaVez: true,
    devoRefutar: false,
    acoesRestantes: 2,
    sozinhoAqui: false,
    jogadores: peoes.map((p) => ({ seat: p.seat, nome: p.nome })),
    meuAssento: 0,
    lugares: caso.rooms.map((r) => ({ id: r.id, name: r.name })),
    onInvestigar: nada,
    onUsar: nada,
  }, [
    "Sua mão de pistas está vazia",
    /* O botão apagado DIZ POR QUÊ. Um botão apagado sem motivo é a interface
       dizendo "não" e virando as costas. */
    "onde mais ninguém está",
  ]);
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
  /* AS DUAS FORMAS. A revelação normal é uma sequência de 2,2 segundos por
     palavra que escapou; para quem pediu menos movimento no sistema ela vira
     lista, sem relógio. As duas são tela, com tipografia e botões próprios, e
     nenhuma das cinco auditorias do HTML veria a segunda se ela existisse só
     atrás de uma preferência do sistema. */
  for (const calmo of [false, true]) {
    monta(`letreiro/revelação${calmo ? " · sem sequência (menos movimento)" : ""}`, Reveal, {
      calmo,
      match: encerrada,
      seats: assentos,
      meId: assentos[0]?.user_id ?? "",
      onDone: nada,
      onRematch: nada,
    }, assentos[0]?.display_name ?? "");
  }
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
  /* As três cláusulas pelo texto que elas REALMENTE produzem. Pedi a palavra
     "opção" e reprovou: a frase diz "direito de comprar". O marcador tem de
     sair da tela, e não do nome que eu dou à coisa por dentro. */
}, ["propõe", "Aceitar", "por rodada", "isenção de aluguel", "direito de comprar"]);

/* A MESA DE NEGOCIAÇÃO é a tela mais densa que este projeto tem: escolhe com
   quem, monta os dois lados, e cada lado aceita dinheiro, propriedades, cartas
   de saída e TRÊS tipos de cláusula com campos próprios.

   Ela é também onde estavam os cinco campos sem nome acessível, e o motivo é o
   mesmo que a torna difícil de acertar: muito controle, pouco texto, e cada
   pedaço só aparece depois de um clique. Uma tela assim é a última que alguém
   abre de propósito para conferir, e a primeira que quebra. */
const { MesaDeNegociacao } = await import("@/components/metropole/negociar");

monta(
  "metropole/mesa de negociação",
  MesaDeNegociacao,
  {
    props,
    jogadores: [
      { seat: 0, cor: "carmim", cash: 12000, livras: 1, quebrado: false },
      { seat: 1, cor: "jade", cash: 8000, livras: 0, quebrado: false },
      { seat: 2, cor: "prussia", cash: 3000, livras: 2, quebrado: false },
    ],
    nomes,
    meuAssento: 0,
    rodada: 8,
    rodadaFinal: 20,
    ocupado: false,
    onPropor: nada,
    onFechar: nada,
  },
  ["Creuza", "Nestor"],
);

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

/* ── DOMÍNIO — a rolagem, nas duas formas ───────────────────────────────────

   A briga inteira vem resolvida do servidor, e o cliente ENCENA: um assalto por
   vez, 620ms para o dado cair e 1150ms para ler. Doze assaltos são vinte e um
   segundos.

   Para quem pediu menos movimento no sistema, a encenação não roda — a folha de
   estilo já tirava o giro, mas não tirava o tempo, e dados PARADOS por vinte e
   um segundos são pior que a animação que a pessoa não queria. No lugar dela, o
   painel mostra os assaltos TODOS DE UMA VEZ, que é mais informação do que a
   encenação chega a mostrar (ela sempre mostra um), e quem fecha é a pessoa.

   As duas formas são montadas porque as duas são tela: a lista tem tipografia,
   cor e um botão próprios, e nenhuma das cinco auditorias do HTML a veria se
   ela existisse só atrás de uma preferência do sistema. */
const { Rolagem } = await import("@/components/dominio/dados");

const A_BRIGA = [
  { dAtac: [6, 5, 2], dDefe: [4, 3], perdeAtac: 0, perdeDefe: 2, atac: 9, defe: 4 },
  { dAtac: [3, 3, 1], dDefe: [5, 2], perdeAtac: 1, perdeDefe: 1, atac: 8, defe: 3 },
  { dAtac: [6, 6, 4], dDefe: [6, 1], perdeAtac: 1, perdeDefe: 1, atac: 7, defe: 2 },
  { dAtac: [2, 2, 1], dDefe: [5, 4], perdeAtac: 2, perdeDefe: 0, atac: 5, defe: 2 },
];

monta(
  "dominio/rolagem · encenada",
  Rolagem,
  { assaltos: A_BRIGA, nomeAtac: "Creuza", nomeDefe: "Nestor", calmo: false, onFim: nada },
  ["Creuza", "Nestor"],
);

monta(
  "dominio/rolagem · sem encenação (menos movimento)",
  Rolagem,
  { assaltos: A_BRIGA, nomeAtac: "Creuza", nomeDefe: "Nestor", calmo: true, onFim: nada },
  /* Os quatro assaltos de uma vez, e a saída que a pessoa controla. */
  ["Creuza", "4 assaltos", "Continuar"],
);

/* ══════════════════════════════════════════════════════════════════════════
   AS TELAS INTEIRAS, com uma partida de verdade

   Até aqui foram FOLHAS: componentes que recebem o conteúdo por propriedade. As
   folhas são onde moram os `.map` que quebram, mas elas não têm o que os
   contêineres têm — o ramo por FASE.

   `MetropoleGame` desenha coisa diferente em rolar, comprar, leilão, cadeia e
   falência; `DominioGame` em reforço, ataque, remanejo e fim. Cada um desses é
   um caminho de código que só existe quando a partida está naquele estado, e
   nenhum deles aparece numa folha isolada.

   Eles montam porque recebem `match` e `assentos` por propriedade — não há
   busca em efeito no caminho. O `SessionProvider` entra em volta porque
   `useSession` LEVANTA sem ele, e de propósito: um componente que lê a sessão
   fora do provedor é um erro de montagem, não um caso a tratar.

   COM `user: null`, o que se renderiza é a visão de ESPECTADOR — sem "sua vez",
   sem os botões de ação. É menos que a visão de quem joga e é o que dá para
   fazer sem forjar uma sessão, e cobre o mesmo desenho de tabuleiro, painel e
   registro. Vale dizer em vez de fingir que cobre tudo.

   O DOSSIÊ FICA DE FORA, e o motivo é honesto: `DossieGame` busca o caso num
   efeito, e efeito não roda aqui — ele pararia em "Abrindo o dossiê…" e o teste
   diria "montou" sobre uma frase de carregamento. As três telas dele já são
   cobertas como folhas, que é onde o conteúdo dele realmente entra.
   ══════════════════════════════════════════════════════════════════════════ */

const { DominioGame } = await import("@/components/dominio/game");
const { MetropoleGame } = await import("@/components/metropole/game");
const { LetreiroGame } = await import("@/components/letreiro/game");

/** Uma partida de cada jogo, com os assentos como o lobby os entrega. */
async function partidaDe(jogo, ondeMais = "m.status = 'running'") {
  const m = (
    await db.query(
      `select m.id, m.status, m.turn_deadline, m.ends_at, m.started_at, m.public_state
         from public.matches m
        where m.game_key = $1 and ${ondeMais}
        order by m.started_at desc limit 1`,
      [jogo],
    )
  ).rows[0];
  if (!m) return null;
  const assentos = (
    await db.query(
      `select mp.user_id, p.display_name, p.avatar, p.is_bot
         from public.match_players mp join public.profiles p on p.id = mp.user_id
        where mp.match_id = $1 order by mp.seat`,
      [m.id],
    )
  ).rows;
  return { match: m, assentos };
}

const AS_TELAS = [
  {
    jogo: "dominio",
    componente: DominioGame,
    propNome: "assentos",
    extra: { onSair: nada },
    /* O registro da partida: prova que o ramo de fase chegou até o fim da tela,
       e não parou num estado vazio no meio. */
    contem: "turno",
    /* As três do turno e o fim. Cada uma acende um painel de ações diferente, e
       é ali que moram os botões que nenhuma folha desenha. */
    fases: ["reforco", "ataque", "remanejo", "fim"],
  },
  {
    jogo: "metropole",
    componente: MetropoleGame,
    propNome: "assentos",
    extra: { onSair: nada },
    contem: "quadro",
    /* `leilao` fica de fora: ela quer um `st.leilao` inteiro para desenhar, e
       sintetizá-lo aqui seria inventar uma partida. O painel do leilão é
       montado sozinho, com os dados dele, mais acima. */
    fases: ["rolar", "acao", "fim"],
  },
  {
    jogo: "letreiro",
    componente: LetreiroGame,
    propNome: "seats",
    extra: { onLeaveMatch: nada, onRematch: nada },
    /* A rodada do Letreiro dura três minutos e acaba sozinha, então quase nunca
       há uma "rodando" no banco — e a busca aceita as duas fases para achar
       ALGUMA coisa para montar. */
    ondeMais: "m.public_state ->> 'phase' in ('round', 'reveal')",
    /* E POR ISSO O MARCADOR É POR FASE, e não um texto fixo.

       Ele era "Conferência", que é o título do primeiro ato da revelação — e
       reprovava no dia em que a partida encontrada estava em `round`, porque
       aí a tela é outra e está certa. Um teste cujo resultado depende de que
       linha o banco tinha naquela hora não mede o código: mede a sorte, e
       ensina a ignorar a saída vermelha.

       Na revelação o LetreiroGame delega para o Reveal, cuja raiz é `.reveal`
       e não `.letreiro`; na rodada, quem está na tela é a lista das palavras
       de quem joga. Cada fase tem a sua prova. */
    contem: (st) => (st.phase === "reveal" ? "Conferência" : "Suas palavras"),
    /* As duas do jogo, e são telas completamente diferentes: na revelação o
       LetreiroGame delega para o Reveal, cuja raiz nem é `.letreiro`. */
    fases: ["round", "reveal"],
  },
];

/* ── E CADA TELA EM TODAS AS FASES QUE ELA TEM ──────────────────────────────

   A partida encontrada no banco está numa fase, e é a fase em que a última
   suíte deixou o jogo — quer dizer que o que esta montagem cobre depende de
   qual linha o banco tinha naquela hora. Foi assim que a auditoria de contraste
   achou o relógio do Letreiro numa rodada e a manchete da Metrópole na
   seguinte: ela estava EXPLORANDO, uma tela por vez, e passando verde no meio.

   Teste que depende do estado do banco não mede o código: mede a sorte — é o
   mesmo defeito que fez o marcador do Letreiro ser um texto fixo, e a resposta
   é a mesma. A fase é sobrescrita, uma montagem por fase, e o que sai é o mesmo
   conjunto de telas em toda rodada.

   AS FASES SÃO AS QUE NÃO PRECISAM DE ESTADO NOVO. `leilao` da Metrópole quer
   um `st.leilao` inteiro para desenhar, e sintetizá-lo aqui seria inventar uma
   partida — o painel do leilão já é montado sozinho, com os dados dele, mais
   acima. Aqui o que se cobra é o RAMO POR FASE do contêiner, que é o pedaço que
   nenhuma folha alcança. */
for (const t of AS_TELAS) {
  const dados = await partidaDe(t.jogo, t.ondeMais ?? "m.status = 'running'");
  if (!dados) {
    ok(true, `${t.jogo}/tela inteira: nenhuma partida rodando no banco — nada a montar`);
    continue;
  }

  const original = dados.match.public_state.phase ?? "—";
  const fases = [...new Set([original, ...(t.fases ?? [])])];

  /* ── É A SUA VEZ ────────────────────────────────────────────────────────
     Metade de cada tela de jogo só existe quando é a sua vez: reforçar,
     atacar, comprar, construir, palpitar, encerrar. É a metade que as pessoas
     de fato APERTAM — e ela era invisível para as auditorias do HTML, porque a
     montagem não tinha sessão e `minhaVez` era sempre falso.

     A sessão fingida é do assento da vez. Não é trapaça: é a única maneira de
     um teste sem navegador ver o botão que o navegador desenha. Nada aqui
     chama rede — `renderToStaticMarkup` não roda efeito. */
  const daVez = dados.assentos[dados.match.public_state.turnSeat ?? 0] ?? dados.assentos[0];
  const sessao = {
    status: "ready",
    user: { id: daVez?.user_id ?? "00000000-0000-0000-0000-000000000000" },
    profile: { display_name: daVez?.display_name ?? "Você", avatar: daVez?.avatar ?? null },
    error: null,
    save: async () => {},
  };

  for (const fase of fases) {
    const estado = { ...dados.match.public_state, phase: fase };
    /* O STATUS ANDA COM A FASE, senão a montagem forçada é incoerente e não
       desenha nada. `acabou` é `phase === "fim" || status === "finished"`, e a
       partida achada no banco quase sempre está encerrada — foi por isso que a
       rodada do Letreiro saía byte a byte igual à revelação: com o status
       encerrado, o contêiner delega para o Reveal em qualquer fase. */
    const encerrada = fase === "fim" || fase === "reveal" || fase === "over";
    const partida = {
      ...dados.match,
      status: encerrada ? "finished" : "running",
      public_state: estado,
    };
    monta(
      `${t.jogo}/tela inteira (fase ${fase}, é a sua vez)`,
      SessionContext.Provider,
      {
        value: sessao,
        children: createElement(t.componente, {
          match: partida,
          [t.propNome]: dados.assentos,
          ...t.extra,
        }),
      },
      /* O marcador é da fase ORIGINAL: as outras são montagens forçadas, e
         cobrar delas o texto de uma partida de verdade seria cobrar de um
         estado que ninguém montou. O que se quer delas é que MONTEM — e que o
         que elas desenham passe nas auditorias do HTML. */
      fase === original
        ? typeof t.contem === "function"
          ? t.contem(estado)
          : t.contem
        : [],
    );
  }
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

/* ══════════════════════════════════════════════════════════════════════════
   O HTML QUE SAIU — três coisas que só o resultado revela

   `npm run css` já audita o CÓDIGO-FONTE: toda classe tem estilo, todo
   `<input>` escrito à mão tem nome. O que ele não alcança é o que só existe
   DEPOIS de renderizar — o botão que nasceu dentro de um `.map`, o `id` que
   dois componentes irmãos geraram igual, o controle cujo texto vem de um dado.

   Agora que as 37 telas produzem HTML, dá para olhar o resultado.
   ══════════════════════════════════════════════════════════════════════════ */

console.log("\n  ── e o HTML que saiu ──\n");

/** Percorre as tags de um HTML, em ordem, dizendo onde cada uma começa e acaba. */
function* tags(html) {
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g)) {
    yield {
      fecha: !!m[1],
      nome: m[2].toLowerCase(),
      attrs: m[3],
      vazia: !!m[4],
      bruto: m[0],
      inicio: m.index,
      fim: m.index + m[0].length,
    };
  }
}

/* ── O QUE UM LEITOR DE TELA LERIA DENTRO DE UM CONTROLE ─────────────────────

   Não é "o texto entre as tags". `aria-hidden` existe justamente para tirar
   coisa da árvore de acessibilidade, e este projeto usa: os três pontinhos de
   "pensando", os ícones decorativos. Um botão cujo único conteúdo é
   `aria-hidden` tem texto na tela e NENHUM nome — que é o pior caso, porque
   quem enxerga jura que está tudo certo.

   Então a leitura pula esses pedaços, e recolhe o `alt` das imagens que
   sobraram. É a mesma conta que o navegador faz, na parte dela que dá para
   fazer sem navegador. */
function textoVisivel(frag) {
  let saida = "";
  let posicao = 0;
  let escondido = 0;
  const pilha = [];

  for (const t of tags(frag)) {
    if (!escondido) saida += frag.slice(posicao, t.inicio);
    posicao = t.fim;

    if (t.fecha) {
      const i = pilha.findLastIndex((x) => x.nome === t.nome);
      if (i >= 0) {
        for (const x of pilha.slice(i)) if (x.escondia) escondido--;
        pilha.length = i;
      }
      continue;
    }

    const esconde = /aria-hidden="true"/.test(t.attrs);
    if (!esconde && !escondido) {
      const alt = /(?:^|\s)alt="([^"]*)"/.exec(t.attrs)?.[1];
      if (alt) saida += " " + alt;
    }
    if (t.vazia || VAZIAS.has(t.nome)) continue;
    if (esconde) escondido++;
    pilha.push({ nome: t.nome, escondia: esconde });
  }

  if (!escondido) saida += frag.slice(posicao);
  return saida.replace(/&[a-z]+;|&#\d+;/gi, " ").replace(/\s+/g, " ").trim();
}

const INTERATIVAS = new Set(["button", "a", "input", "select", "textarea"]);
/* Os dois que tiram o nome do que têm DENTRO. `input`, `select` e `textarea`
   são nomeados de fora, por `<label>` — e isso já é conferido logo abaixo e em
   `npm run css`. */
const NOMEAVEIS = new Set(["button", "a"]);
const VAZIAS = new Set(["input", "img", "br", "hr", "path", "circle", "rect", "line", "polyline", "use", "stop"]);

const aninhadas = [];
const semNome = [];
const idsRepetidos = [];
const botoesMudos = [];

for (const { nome: tela, html } of TUDO_QUE_FOI_DESENHADO) {
  const pilha = [];
  const ids = new Map();

  for (const t of tags(html)) {
    /* ── `id` repetido ──────────────────────────────────────────────────
       Dois elementos com o mesmo `id` quebram `<label for>`, quebram
       `aria-labelledby` e fazem o navegador escolher um dos dois sem avisar.
       Num componente que se repete num `.map`, é o erro mais fácil de cometer
       e o mais difícil de ver. */
    const id = /(?:^|\s)id="([^"]*)"/.exec(t.attrs)?.[1];
    if (!t.fecha && id) {
      if (ids.has(id)) idsRepetidos.push(`${tela}: id="${id}" aparece duas vezes`);
      else ids.set(id, true);
    }

    if (t.fecha) {
      const i = pilha.findLastIndex((x) => x.nome === t.nome);
      if (i >= 0) {
        const fechada = pilha[i];
        pilha.length = i;
        /* ── BOTÃO MUDO ───────────────────────────────────────────────────
           Um botão só de ícone, sem `aria-label`, é um botão que o leitor de
           tela anuncia como "botão" e mais nada.

           ESTE GUARDA ESTAVA ESCRITO E NÃO LIGADO. O comentário prometia a
           conferência, o código recortava o miolo e jogava fora com um `void`,
           e a linha de saída da auditoria falava só dos campos de digitação —
           então nada acusava. É exatamente o defeito que esta suíte existe para
           pegar, na própria suíte.

           Agora o miolo é lido de verdade, e lido como um leitor de tela leria:
           `aria-hidden` não conta. */
        if (NOMEAVEIS.has(fechada.nome) && !fechada.temNome) {
          const dentro = html.slice(fechada.fim, t.inicio);
          if (textoVisivel(dentro) === "") {
            botoesMudos.push(`${tela}: <${fechada.nome}> sem nome nenhum`);
          }
        }
      }
      continue;
    }

    const temNome =
      /aria-label="[^"]+"/.test(t.attrs) ||
      /aria-labelledby="[^"]+"/.test(t.attrs) ||
      /title="[^"]+"/.test(t.attrs);

    if (INTERATIVAS.has(t.nome)) {
      /* ── interativo dentro de interativo ──────────────────────────────
         HTML inválido, e o estrago é concreto: o teclado não alcança o de
         dentro, o toque acerta o de fora, e o React não reclama porque para
         ele são só dois componentes.

         É o tipo de coisa que aparece quando um item de lista clicável ganha um
         botão de "remover" depois. */
      const pai = pilha.findLast((x) => INTERATIVAS.has(x.nome));
      if (pai) aninhadas.push(`${tela}: <${t.nome}> dentro de <${pai.nome}>`);
    }

    if (!t.vazia && !VAZIAS.has(t.nome)) pilha.push({ nome: t.nome, temNome, fim: t.fim });
    else if (t.nome === "input" && !temNome && !id) {
      /* O `<label>` em volta também dá nome, e é a forma mais comum aqui —
         "dinheiro", "cartas de saída". `npm run css` já sabia disso; esta
         auditoria não sabia, e acusou três campos que estão corretos.

         É o mesmo falso positivo, pela segunda vez, em duas ferramentas
         diferentes. A associação implícita é fácil de esquecer justamente
         porque não aparece no elemento: ela está no PAI. */
      const dentroDeLabel = pilha.some((x) => x.nome === "label");
      if (!dentroDeLabel) semNome.push(`${tela}: <input> sem nome`);
    }
  }
}

ok(
  aninhadas.length === 0,
  aninhadas.length === 0
    ? `nenhum controle dentro de outro nas ${TUDO_QUE_FOI_DESENHADO.length} telas — o teclado alcança tudo`
    : `CONTROLE DENTRO DE CONTROLE: ${aninhadas.slice(0, 4).join(" · ")}`,
);

ok(
  idsRepetidos.length === 0,
  idsRepetidos.length === 0
    ? "e nenhum id repetido — label-for e aria-labelledby apontam para um só"
    : `ID REPETIDO: ${idsRepetidos.slice(0, 4).join(" · ")}`,
);

ok(
  semNome.length === 0,
  semNome.length === 0
    ? "e todo campo de digitação que saiu no HTML tem nome"
    : `CAMPO SEM NOME NO HTML: ${semNome.slice(0, 4).join(" · ")}`,
);

ok(
  botoesMudos.length === 0,
  botoesMudos.length === 0
    ? "e todo botão e todo link que saiu no HTML tem nome — nenhum é só ícone"
    : `BOTÃO MUDO: ${botoesMudos.slice(0, 5).join(" · ")}`,
);

/* ── E O GUARDA CONSEGUE REPROVAR ──────────────────────────────────────────

   A linha acima passou na primeira vez que foi ligada, e isso por si só não
   prova nada: ela também "passava" antes, quando o código recortava o miolo do
   botão e jogava fora com um `void`. Um guarda que nunca viu um caso ruim é
   indistinguível de um guarda quebrado.

   Então ele lê quatro pedaços de HTML escritos à mão, dois que têm nome e dois
   que não têm, e a suíte cobra as quatro respostas. Se alguém quebrar
   `textoVisivel` amanhã, reprova aqui — e não daqui a seis meses, calada. */
const PROVAS = [
  ["<span>Comprar</span>", "Comprar", true],
  ['<span aria-hidden="true">x</span>', "", false],
  ['<span aria-hidden="true">x</span> Fechar', "Fechar", true],
  ['<img alt="mapa de Vantara" />', "mapa de Vantara", true],
];
const erradas = PROVAS.filter(([frag, esperado]) => textoVisivel(frag) !== esperado);
ok(
  erradas.length === 0,
  erradas.length === 0
    ? "e o guarda sabe reprovar: dos quatro miolos de prova, os dois mudos são vistos como mudos"
    : `O GUARDA DO BOTÃO MUDO ESTÁ CEGO: ${erradas
        .map(([f, e]) => `"${f}" devia dar "${e}" e deu "${textoVisivel(f)}"`)
        .join(" · ")}`,
);

/* ══════════════════════════════════════════════════════════════════════════
   E A COR QUE VEM DO PAI

   `npm run css` audita contraste no CÓDIGO-FONTE, e diz, na própria saída, o
   que não alcança: "cor herdada de um pai". Não é detalhe — é o caso mais
   comum de todos. Numa folha de estilo de verdade quase nenhum elemento pinta
   texto e fundo ao mesmo tempo: o painel pinta o fundo, a etiqueta lá dentro
   pinta o texto, e o par que a pessoa enxerga NÃO EXISTE EM REGRA NENHUMA. Ele
   nasce da árvore.

   Agora a árvore existe. Estas telas são HTML de verdade, com as classes de
   verdade, montadas com o conteúdo publicado — então dá para fazer o que o
   navegador faz: para cada pedaço de texto, achar de quem ele herdou a cor e
   sobre qual fundo ele caiu, subindo pelos pais até encontrar quem pintou.

   O piso é o mesmo da WCAG AA: 4.5:1, ou 3:1 quando a regra que pintou aquele
   texto também o declarou grande.

   O QUE ELA CONTINUA NÃO VENDO, e a contagem sai junto: fundo com alfa,
   gradiente ou imagem, seletor com pseudo-classe, e o texto que só aparece
   depois de um clique. Cobertura sem número ao lado é propaganda.
   ══════════════════════════════════════════════════════════════════════════ */

const cssDir = join(raiz, "app");
const arquivosCss = arquivosDeCss(cssDir);
const tokensCss = tokensDeCss(cssDir, arquivosCss);
const regrasCor = regrasDeCor(cssDir, arquivosCss);

/* O CHÃO. Os componentes são montados soltos, sem a página em volta, então a
   raiz da árvore é sintética: um `body` com as classes que o layout do projeto
   põe nele. Sem isso, todo primeiro elemento ficaria sem fundo e a auditoria
   pularia a tela inteira. */
const CHAO = { tag: "body", classes: new Set(), id: null, attrs: {} };

const SEM_TEXTO = new Set(["script", "style", "svg", "title", "head", "path", "defs"]);

const fracos = [];
let lidos = 0;
let semFundo = 0;

for (const { nome: tela, html } of TUDO_QUE_FOI_DESENHADO) {
  const pilha = [CHAO];
  const efetivo = [{ cor: null, fundo: null, px: null, negrito: false, piso: 4.5 }];
  let posicao = 0;
  let mudo = 0;
  let fechado = 0;

  const olhaTexto = (bruto) => {
    if (mudo || fechado) return;
    const texto = bruto.replace(/&[a-z]+;|&#\d+;/gi, " ").replace(/\s+/g, " ").trim();
    if (!texto) return;
    const at = efetivo[efetivo.length - 1];
    if (!at.cor || !at.fundo) {
      semFundo++;
      return;
    }
    lidos++;
    const r = razao(at.cor, at.fundo);
    if (r < at.piso) {
      const el = pilha[pilha.length - 1];
      const onde = [el.tag, ...el.classes].join(".");
      fracos.push(`${tela} · ${onde}: "${texto.slice(0, 24)}" ${r.toFixed(2)}:1 (piso ${at.piso})`);
    }
  };

  for (const t of tags(html)) {
    olhaTexto(html.slice(posicao, t.inicio));
    posicao = t.fim;

    if (t.fecha) {
      const i = pilha.findLastIndex((x) => x.tag === t.nome);
      if (i >= 1) {
        for (const x of pilha.slice(i)) {
          if (x.mudo) mudo--;
          if (x.fechado) fechado--;
        }
        pilha.length = i;
        efetivo.length = i;
      }
      continue;
    }

    const classes = new Set(
      (/(?:^|\s)class="([^"]*)"/.exec(t.attrs)?.[1] ?? "").split(/\s+/).filter(Boolean),
    );
    const attrs = {};
    for (const a of t.attrs.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    const el = {
      tag: t.nome,
      classes,
      id: attrs.id ?? null,
      attrs,
      mudo: attrs["aria-hidden"] === "true",
      fechado: SEM_TEXTO.has(t.nome),
    };

    if (t.vazia || VAZIAS.has(t.nome)) continue;
    pilha.push(el);
    if (el.mudo) mudo++;
    if (el.fechado) fechado++;

    const pai = efetivo[efetivo.length - 1];
    const d = declaradas(regrasCor, pilha, tokensCss);
    /* HERDA A COR; O FUNDO NÃO SE HERDA — ELE SE ATRAVESSA. Um elemento sem
       fundo é transparente, e o que aparece atrás dele é o fundo do pai. Dá na
       mesma conta, e a diferença de nome importa: fundo com alfa não é
       transparente, é uma MISTURA — e mistura sobre um fundo conhecido é conta
       exata, `a·frente + (1−a)·fundo` por canal, que é o que o compositor faz.
       Este projeto usa muito alfa (`rgb(255 77 94 / 0.1)` é o painel do
       assassino), e recusar a conta jogaria fora um terço da tela.

       O que continua virando `null`, e some da contagem em vez de virar número
       inventado: alfa sobre fundo que ninguém resolveu, gradiente e imagem. */
    /* O FUNDO PRIMEIRO, porque a cor do texto pode precisar dele: `color` com
       alfa também compõe, e compõe sobre o que estiver atrás. */
    const fundo = d.fundo ? compoe(d.fundo.rgba, pai.fundo) : pai.fundo;
    const cor = d.cor ? compoe(d.cor.rgba, fundo ?? pai.fundo) : pai.cor;
    /* O TAMANHO HERDA COMO A COR, e por isso vem da árvore e não da regra que
       pintou. Quem declara o tamanho quase nunca é quem declara a cor: no
       relógio do Letreiro, `.clock-num` diz o tamanho e
       `.clock[data-urgent] .clock-num` diz a cor. Ler o tamanho só de quem
       pintou fez a auditoria cobrar 4,5:1 de um número de 27px em negrito — o
       piso dele é 3, e ele passava. Falso positivo é o jeito mais rápido de
       ensinar a ignorar a saída vermelha. */
    const px = d.px ?? pai.px;
    const negrito = d.negrito ?? pai.negrito;
    const grande = px !== null && (px >= 24 || (px >= 18.66 && negrito));
    efetivo.push({ cor, fundo, px, negrito, piso: grande ? 3 : 4.5 });
  }
  olhaTexto(html.slice(posicao));
}

console.log(
  `  ${lidos} pedaço(s) de texto com cor E fundo resolvidos pela árvore` +
    ` (${semFundo} sobre fundo que não dá para resolver)`,
);
/* ── E O PISO SAI DO TAMANHO CERTO ────────────────────────────────────────

   A WCAG derruba o piso de 4,5 para 3 em texto grande, e foi aí que esta
   auditoria deu o primeiro falso positivo: cobrou 4,5:1 do relógio do
   Letreiro, que tem 27px em negrito e passa com folga no piso dele. O tamanho
   estava sendo lido da regra que PINTOU, e quem pinta quase nunca é quem
   dimensiona — `.clock-num` diz o tamanho, `.clock[data-urgent] .clock-num` diz
   a cor.

   Falso positivo é o jeito mais rápido de ensinar alguém a ignorar a saída
   vermelha, então o conserto vem com prova. `clamp()` vira o MÍNIMO: é o menor
   tamanho em que aquele texto chega a aparecer, e o piso da WCAG é sobre o pior
   caso — chutar o ideal daria à auditoria uma tela de desktop que o celular não
   tem. */
const TAMANHOS = [
  ["2.3rem", 36.8],
  ["16px", 16],
  ["clamp(1.7rem, 7vw, 2.3rem)", 27.2],
  ["1.2em", null],
  ["inherit", null],
];
const tamErradas = TAMANHOS.filter(([v, e]) => tamanhoEmPx(v) !== e);
ok(
  tamErradas.length === 0,
  tamErradas.length === 0
    ? "e o piso sai do tamanho certo: clamp() vale pelo mínimo, e em/inherit viram 'não sei'"
    : `O TAMANHO ESTÁ SENDO LIDO ERRADO: ${tamErradas
        .map(([v, e]) => `"${v}" devia dar ${e} e deu ${tamanhoEmPx(v)}`)
        .join(" · ")}`,
);

ok(
  fracos.length === 0,
  fracos.length === 0
    ? "e todo texto que saiu no HTML passa no piso da WCAG AA, com a cor que ele HERDOU"
    : `TEXTO FRACO NA ÁRVORE: ${fracos.slice(0, 6).join(" | ")}`,
);

/* ── O BLOCO É EDITÁVEL O TEMPO INTEIRO ─────────────────────────────────────

   Critério de aceite do PRD 03 §11, e é ele que mata o tempo morto do Detetive:
   o bloco fica aberto DURANTE O TURNO DOS OUTROS, senão quem não está jogando
   fica olhando.

   Ele se sustenta por construção — `Bloco` não recebe prop nenhuma que fale de
   turno, então não há por onde desabilitá-lo. Mas "por construção" é uma frase
   sobre o código de hoje, e a prop que chega amanhã não avisa. Aqui o guarda
   pergunta ao HTML que saiu.

   A única célula desabilitada legítima é a que já é FATO: sobre o que o
   servidor provou, ninguém rabisca. */
const blocos = TUDO_QUE_FOI_DESENHADO.filter(({ nome }) => nome.endsWith("· bloco"));
const celulas = blocos.map(({ nome, html }) => {
  const todas = [...html.matchAll(/<button[^>]*class="cel"[^>]*>/g)].map((m) => m[0]);
  return {
    nome,
    livres: todas.filter((t) => !t.includes("disabled")).length,
    presas: todas.filter((t) => t.includes("disabled")).length,
  };
});

ok(
  celulas.length > 0 && celulas.every((c) => c.livres > 0),
  celulas.length === 0
    ? "não achei nenhum bloco de dedução no HTML — o guarda ficou sem o que olhar"
    : celulas.every((c) => c.livres > 0)
      ? `e o bloco de dedução sai editável nos ${celulas.length} casos` +
        ` (${celulas[0].livres} células livres, ${celulas[0].presas} já são fato)`
      : `BLOCO TRANCADO: ${celulas.filter((c) => !c.livres).map((c) => c.nome).join(" · ")}`,
);

/* ── NADA ANIMA SÓ POR TER APARECIDO ────────────────────────────────────────

   `data-subindo` marca a obra da Metrópole que CRESCEU desde a renderização
   anterior, e é o que faz a casinha subir. Numa tela recém-montada não houve
   renderização anterior — se a marca saísse aqui, recarregar a página faria
   trinta casas construídas pipocarem de uma vez.

   É a diferença entre "animar o que mudou" e "animar o que existe", e ela só
   aparece no HTML da primeira renderização. Por isso o guarda mora aqui, junto
   com as outras leituras do que de fato saiu. */
const pipocando = TUDO_QUE_FOI_DESENHADO.filter(({ html }) => html.includes("data-subindo"));
ok(
  pipocando.length === 0,
  pipocando.length === 0
    ? "e nenhuma tela recém-montada anuncia obra subindo — a animação é do que MUDOU"
    : `ANIMA NA MONTAGEM: ${pipocando.map((x) => x.nome).slice(0, 3).join(" · ")}`,
);

await db.end();
console.log(falhas === 0 ? "\nTudo passou." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
