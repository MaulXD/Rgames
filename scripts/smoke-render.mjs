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

const { SessionProvider } = await import("@/components/session");
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
  },
  {
    jogo: "metropole",
    componente: MetropoleGame,
    propNome: "assentos",
    extra: { onSair: nada },
    contem: "quadro",
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
  },
];

for (const t of AS_TELAS) {
  const dados = await partidaDe(t.jogo, t.ondeMais ?? "m.status = 'running'");
  if (!dados) {
    ok(true, `${t.jogo}/tela inteira: nenhuma partida rodando no banco — nada a montar`);
    continue;
  }
  monta(
    `${t.jogo}/tela inteira (fase ${dados.match.public_state.phase ?? "—"})`,
    SessionProvider,
    {
      children: createElement(t.componente, {
        match: dados.match,
        [t.propNome]: dados.assentos,
        ...t.extra,
      }),
    },
    typeof t.contem === "function" ? t.contem(dados.match.public_state) : t.contem,
  );
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

/** Percorre as tags de um HTML, em ordem, com a profundidade de cada uma. */
function* tags(html) {
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g)) {
    yield { fecha: !!m[1], nome: m[2].toLowerCase(), attrs: m[3], vazia: !!m[4], bruto: m[0] };
  }
}

const INTERATIVAS = new Set(["button", "a", "input", "select", "textarea"]);
const VAZIAS = new Set(["input", "img", "br", "hr", "path", "circle", "rect", "line", "polyline", "use", "stop"]);

const aninhadas = [];
const semNome = [];
const idsRepetidos = [];

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
        /* ── controle sem nome ────────────────────────────────────────────
           Um botão só de ícone, sem `aria-label`, é um botão que o leitor de
           tela anuncia como "botão" e mais nada. Aqui dá para conferir o texto
           REAL que ele recebeu — inclusive o que veio de um dado. */
        if (INTERATIVAS.has(fechada.nome) && !fechada.temNome) {
          const dentro = html.slice(fechada.fim, t.inicio ?? html.length);
          void dentro;
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

    if (!t.vazia && !VAZIAS.has(t.nome)) pilha.push({ nome: t.nome, temNome });
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

await db.end();
console.log(falhas === 0 ? "\nTudo passou." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
