#!/usr/bin/env node
/**
 * Dossiê — publica e valida os pacotes de tema.
 *
 * O motor do Dossiê não sabe o que é uma "biblioteca" nem um "Coronel": ele
 * conhece seis suspeitos, seis objetos e nove lugares, e tudo o mais vem do
 * pacote. Isso foi decidido antes da primeira linha do jogo (ver
 * docs/07-SISTEMA-DE-TEMAS.md §1), e é o que faz um tema novo ser CONTEÚDO e
 * não engenharia.
 *
 * A prova disso é este arquivo: os três temas abaixo entram sem uma linha de
 * SQL nova e sem uma linha de React nova.
 *
 * O QUE ESTE SCRIPT NÃO FAZ, e é de propósito: nenhum dos três traz a
 * REVIRAVOLTA que o PRD 03 especifica para ele (Apagão, Tempestade de Areia,
 * Registro da Estação). Reviravolta é regra, e regra é motor. Declarar um campo
 * `twist` no pacote que o servidor ignora seria configuração decorativa — o
 * mesmo defeito que o `modo` do Domínio tinha, e que já custou uma migração
 * para consertar. Os três temas jogam com as regras base, que é um jogo
 * completo, e as reviravoltas entram quando o motor souber executá-las.
 *
 * Uso: npm run dossie
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(root, ".env.local"), quiet: true });

/* ══════════════════════════════════════════════════════════════════════════
   AS CORES

   O suspeito é desenhado com uma peça da paleta da plataforma — a mesma dos
   avatares e dos exércitos do Domínio. São oito chaves, e cada tema usa seis
   distintas. Os nomes de cor do PRD ("magenta", "âmbar", "verde-fosforescente")
   descrevem a INTENÇÃO; aqui eles viram a chave mais próxima que o motor sabe
   pintar. Inventar uma cor por tema significaria um sistema de cor por tema, e
   o pacote de tema não é o lugar de decidir paleta de plataforma.
   ══════════════════════════════════════════════════════════════════════════ */

const COPY_PADRAO = {
  prep: "no",
  suggest: "acusou",
  refuted: "mostrou uma carta",
  noRefute: "Ninguém pôde refutar.",
  accuse: "Fechar o caso",
  ghost: "Fantasma",
};

/* ══════════════════════════════════════════════════════════════════════════
   BOATE AURORA — 1987

   O disco ainda estava girando.

   O mapa é núcleo denso com satélites: a Pista é o centro de tudo, como numa
   boate de verdade. Quem controla a Pista alcança quase todo mundo em dois
   passos — e é o lugar onde é mais difícil se esconder.
   ══════════════════════════════════════════════════════════════════════════ */

const AURORA = {
  id: "boate-aurora",
  name: "Boate Aurora",
  era: "1987",
  tagline: "O disco ainda estava girando quando alguém desligou a mesa.",
  clima: "neon",
  copy: { ...COPY_PADRAO, ghost: "Encostado", accuse: "Fechar a noite" },
  victim: { name: "Nelson Braga", role: "Dono da casa, 51 anos" },
  suspects: [
    { id: "marcao", name: "DJ Marcão", role: "Residente da casa há seis anos", color: "vinho", crest: "fone" },
    { id: "bete", name: "Bete Andrade", role: "Cantora da banda residente", color: "ocre", crest: "microfone" },
    { id: "zezinho", name: "Zezinho Portela", role: "Segurança da porta", color: "grafite", crest: "lanterna" },
    { id: "claudia", name: "Cláudia Fiúza", role: "Sócia e gerente da casa", color: "prussia", crest: "agenda" },
    { id: "ivan", name: "Ivan Torres", role: "Promoter — devia dinheiro ao Nelson", color: "oliva", crest: "convite" },
    { id: "sueli", name: "Dona Sueli", role: "Do bar, desde a inauguração", color: "terracota", crest: "coqueteleira" },
  ],
  weapons: [
    { id: "taco", name: "Taco de sinuca" },
    { id: "cabo", name: "Cabo de microfone" },
    { id: "espumante", name: "Garrafa de espumante" },
    { id: "extintor", name: "Extintor" },
    { id: "laque", name: "Laquê e isqueiro" },
    { id: "chave-roda", name: "Chave de roda" },
  ],
  rooms: [
    { id: "bar", name: "Bar", col: 0, row: 0, piso: "ladrilho" },
    { id: "cabine", name: "Cabine do DJ", col: 1, row: 0, piso: "madeira" },
    { id: "camarim", name: "Camarim", col: 2, row: 0, piso: "tapete" },
    { id: "deposito", name: "Depósito", col: 0, row: 1, piso: "ladrilho" },
    { id: "pista", name: "Pista", col: 1, row: 1, piso: "madeira" },
    { id: "vip", name: "Área VIP", col: 2, row: 1, piso: "tapete" },
    { id: "estacionamento", name: "Estacionamento", col: 0, row: 2, piso: "ladrilho" },
    { id: "fliperama", name: "Fliperama", col: 1, row: 2, piso: "ladrilho" },
    { id: "escada", name: "Escada de incêndio", col: 2, row: 2, piso: "ladrilho" },
  ],
  adjacency: {
    bar: ["pista", "deposito"],
    cabine: ["camarim", "pista"],
    camarim: ["cabine", "vip"],
    deposito: ["bar", "fliperama", "estacionamento"],
    pista: ["bar", "cabine", "vip", "fliperama"],
    vip: ["camarim", "pista", "escada"],
    estacionamento: ["deposito", "fliperama", "escada"],
    fliperama: ["pista", "deposito", "estacionamento"],
    escada: ["vip", "estacionamento"],
  },
  secretPassages: [
    ["camarim", "estacionamento"],
    ["cabine", "deposito"],
  ],
  narracao: {
    0: "Três da manhã de sábado. A Aurora tinha acabado o último set e ninguém tinha ido embora.",
    1: "Nelson Braga era dono da casa há onze anos. Tinha começado com uma vitrola emprestada e terminado com uma fila na calçada.",
    2: "Encontraram ele na cabine do DJ. O disco ainda estava girando, e a agulha já tinha passado do fim.",
    3: "A luz da pista continuou piscando por vinte minutos, porque ninguém sabia onde ficava o disjuntor.",
    4: "Seis pessoas ficaram. Nenhuma delas tinha por que estar na casa depois do último set.",
    5: "Uma das seis desligou a mesa. As outras cinco estavam devendo alguma coisa a ele.",
  },
  encerramento:
    "Quando a polícia chegou, o gelo do bar já tinha derretido e alguém tinha guardado o disco na capa errada.",
};

/* ══════════════════════════════════════════════════════════════════════════
   RAS ZAMIR — 1928

   Abriram a câmara à meia-noite. Ao amanhecer, o homem que pagou a expedição
   estava morto.

   O mapa é um acampamento com PROFUNDIDADE: a Câmara Selada tem uma entrada
   só, pelo Poço. Quem desce fica exposto — a não ser que conheça o poço de
   ventilação, que é a passagem secreta. É o lugar mais tenso dos quatro mapas,
   e a topologia é o oposto da Aurora: aqui existe um fim do mundo.
   ══════════════════════════════════════════════════════════════════════════ */

const RAS_ZAMIR = {
  id: "ras-zamir",
  name: "Ras Zamir",
  era: "1928",
  tagline: "Abriram a câmara à meia-noite. Ao amanhecer, quem pagou pela escavação estava morto.",
  clima: "areia",
  copy: { ...COPY_PADRAO, ghost: "Insolado", accuse: "Fechar o relatório" },
  victim: { name: "Sir Alistair Crewe", role: "Financiador da expedição, 58 anos" },
  suspects: [
    { id: "helena", name: "Prof.ª Helena Vasari", role: "Epigrafista — decifrou a inscrição", color: "prussia", crest: "estilete" },
    { id: "yusuf", name: "Yusuf al-Rashid", role: "Chefe dos escavadores", color: "terracota", crest: "enxada" },
    { id: "pryce", name: "Major Edmund Pryce", role: "Segurança da concessão", color: "oliva", crest: "binoculo" },
    { id: "nadira", name: "Nadira Sabbagh", role: "Intérprete e cartógrafa", color: "jade", crest: "compasso" },
    { id: "behring", name: "Dr. Otto Behring", role: "Conservador e químico", color: "grafite", crest: "frasco" },
    { id: "constance", name: "Constance Crewe", role: "Sobrinha e única herdeira", color: "carmim", crest: "leque" },
  ],
  weapons: [
    { id: "martelo", name: "Martelo de geólogo" },
    { id: "rapel", name: "Corda de rapel" },
    { id: "fixador", name: "Frasco de fixador" },
    { id: "lampiao", name: "Lampião a querosene" },
    { id: "punhal", name: "Punhal cerimonial" },
    { id: "estaca", name: "Estaca de tenda" },
  ],
  rooms: [
    { id: "mirante", name: "Mirante da duna", col: 0, row: 0, piso: "ladrilho" },
    { id: "radio", name: "Radiotelegrafia", col: 1, row: 0, piso: "madeira" },
    { id: "arquivo", name: "Tenda do arquivo", col: 2, row: 0, piso: "tapete" },
    { id: "estabulo", name: "Estábulo", col: 0, row: 1, piso: "ladrilho" },
    { id: "conservacao", name: "Tenda de conservação", col: 1, row: 1, piso: "tapete" },
    { id: "cozinha", name: "Cozinha de campo", col: 2, row: 1, piso: "ladrilho" },
    { id: "cisterna", name: "Cisterna", col: 0, row: 2, piso: "ladrilho" },
    { id: "poco", name: "Poço da escavação", col: 1, row: 2, piso: "ladrilho" },
    { id: "camara", name: "Câmara selada", col: 2, row: 2, piso: "ladrilho" },
  ],
  adjacency: {
    mirante: ["radio", "arquivo"],
    radio: ["mirante", "arquivo", "estabulo"],
    arquivo: ["mirante", "radio", "conservacao", "cozinha"],
    // o Estábulo NÃO tem porta para a Cisterna: o que liga os dois é o canal
    // de água, que é a passagem secreta. Ter os dois faria da passagem uma
    // passagem de nada — e o validador reprovou exatamente isso na primeira
    // versão deste pacote.
    estabulo: ["radio", "conservacao", "poco"],
    conservacao: ["arquivo", "estabulo", "cozinha", "poco"],
    cozinha: ["arquivo", "conservacao", "cisterna"],
    cisterna: ["cozinha", "poco"],
    // a Câmara Selada tem UMA entrada. É o ponto do mapa.
    poco: ["estabulo", "conservacao", "cisterna", "camara"],
    camara: ["poco"],
  },
  secretPassages: [
    // o poço de ventilação antigo: a única outra forma de sair da Câmara
    ["camara", "mirante"],
    ["estabulo", "cisterna"],
  ],
  narracao: {
    0: "Quatorze de março, quatro da manhã. O vento tinha parado, o que no Ras Zamir é sempre um aviso.",
    1: "Sir Alistair Crewe pagou três temporadas de escavação sem descer ao poço uma única vez.",
    2: "Na noite anterior tinham quebrado o selo da câmara. Ele desceu para ver, e foi a primeira vez.",
    3: "Encontraram ele na tenda do arquivo, ao lado do selo partido, com areia nos punhos da camisa.",
    4: "Seis pessoas dormiam no acampamento. Nenhuma delas tinha dormido.",
    5: "Uma das seis desceu ao poço depois dele. Todas as outras sabiam o caminho.",
  },
  encerramento:
    "A tempestade chegou ao meio-dia e cobriu as pegadas todas. O relatório saiu antes dela, com um nome.",
};

/* ══════════════════════════════════════════════════════════════════════════
   MERIDIANO-9 — 2189

   A comandante morreu na câmara de vácuo e o registro biométrico dela foi
   apagado.

   O mapa é um anel: tudo dá volta, não há becos, não há profundidade. É o mais
   aberto dos quatro e o mais difícil de encurralar alguém — o oposto exato de
   Ras Zamir, e é essa diferença que faz valer a pena ter os dois.
   ══════════════════════════════════════════════════════════════════════════ */

const MERIDIANO = {
  id: "meridiano-9",
  name: "Meridiano-9",
  era: "2189",
  tagline: "A comandante morreu na câmara de vácuo, e o registro biométrico dela foi apagado.",
  clima: "orbita",
  copy: { ...COPY_PADRAO, ghost: "Desligado", accuse: "Fechar o ciclo" },
  victim: { name: "Comandante Ilse Navarro", role: "Comando da estação, 47 anos" },
  suspects: [
    { id: "kell", name: "Auditor Kell Ramos", role: "Enviado da corporação — chegou há nove dias", color: "ocre", crest: "selo" },
    { id: "yara", name: "Téc. Yara Mbeki", role: "Manutenção de suporte de vida", color: "oliva", crest: "chave" },
    { id: "park", name: "Dr. Sung Park", role: "Médico da estação", color: "jade", crest: "seringa" },
    { id: "vann", name: "Piloto Vann Ostrowski", role: "Cargueiro atracado há três semanas", color: "carmim", crest: "voo" },
    { id: "rhea", name: "Bióloga Rhea Adeyemi", role: "Hidroponia", color: "grafite", crest: "folha" },
    { id: "nubia", name: "NÚBIA", role: "A inteligência da estação, num corpo de manutenção", color: "prussia", crest: "anel" },
  ],
  weapons: [
    { id: "plasma", name: "Descarga de plasma" },
    { id: "cabo-dados", name: "Cabo de dados" },
    { id: "injetor", name: "Injetor médico" },
    { id: "torque", name: "Chave de torque" },
    { id: "despressurizacao", name: "Despressurização" },
    { id: "criogenico", name: "Refrigerante criogênico" },
  ],
  rooms: [
    { id: "arquivo", name: "Arquivo", col: 0, row: 0, piso: "ladrilho" },
    { id: "ponte", name: "Ponte", col: 1, row: 0, piso: "ladrilho" },
    { id: "dormitorios", name: "Dormitórios", col: 2, row: 0, piso: "tapete" },
    { id: "maquinas", name: "Casa de máquinas", col: 0, row: 1, piso: "ladrilho" },
    { id: "refeitorio", name: "Refeitório", col: 1, row: 1, piso: "ladrilho" },
    { id: "enfermaria", name: "Enfermaria", col: 2, row: 1, piso: "ladrilho" },
    { id: "doca", name: "Doca de carga", col: 0, row: 2, piso: "ladrilho" },
    { id: "hidroponia", name: "Hidroponia", col: 1, row: 2, piso: "tapete" },
    { id: "vacuo", name: "Câmara de vácuo", col: 2, row: 2, piso: "ladrilho" },
  ],
  adjacency: {
    arquivo: ["ponte", "maquinas"],
    ponte: ["arquivo", "refeitorio", "dormitorios"],
    dormitorios: ["ponte", "refeitorio", "enfermaria"],
    maquinas: ["arquivo", "doca"],
    refeitorio: ["ponte", "hidroponia", "dormitorios"],
    enfermaria: ["dormitorios", "vacuo", "doca"],
    doca: ["maquinas", "hidroponia", "vacuo", "enfermaria"],
    hidroponia: ["refeitorio", "doca"],
    vacuo: ["doca", "enfermaria"],
  },
  secretPassages: [
    ["arquivo", "vacuo"],
    ["hidroponia", "enfermaria"],
  ],
  narracao: {
    0: "Ciclo 8.412. A estação estava em turno de sono e o zumbido do suporte de vida era o único som.",
    1: "A comandante Ilse Navarro estava no Meridiano-9 há quatro anos, e tinha assinado sozinha os quatro relatórios anuais.",
    2: "O auditor chegou há nove dias, com autorização para abrir qualquer registro da estação.",
    3: "Encontraram Navarro na câmara de vácuo. O registro biométrico dela tinha sido apagado do sistema.",
    4: "Só uma coisa a bordo tem acesso para apagar um registro. E ela é uma das seis.",
    5: "Seis pessoas acordadas em turno de sono. Nenhuma delas devia estar acordada.",
  },
  encerramento:
    "O cargueiro desatracou no ciclo seguinte, com um passageiro a menos do que tinha chegado.",
};

const TEMAS = [AURORA, RAS_ZAMIR, MERIDIANO];

/* ══════════════════════════════════════════════════════════════════════════
   VALIDAÇÃO

   Roda sobre TODOS os temas do Dossiê que existem no banco, e não só sobre os
   três novos. O Solar das Acácias entra na conferência porque um validador que
   só olha o código novo não é um validador: é um teste de aceitação.

   As checagens de grafo são as que importam. Um mapa com beco sem saída deixa
   alguém encurralado sem escolha; um mapa desconexo deixa um cômodo onde a
   partida nunca acontece; um mapa de diâmetro grande faz o jogo virar
   caminhada. As três coisas passam desapercebidas na leitura e aparecem na
   quinta partida.
   ══════════════════════════════════════════════════════════════════════════ */

let falhas = 0;
function ok(cond, msg) {
  if (cond) console.log(`  ok      ${msg}`);
  else {
    falhas++;
    console.error(`  FALHA   ${msg}`);
  }
}

const CORES = ["carmim", "terracota", "ocre", "oliva", "jade", "grafite", "prussia", "vinho"];
const PISOS = ["madeira", "tapete", "ladrilho"];
const CLIMAS = ["misterio", "brincadeira", "neon", "areia", "orbita"];

/** Distância entre todos os pares, por BFS. Devolve o diâmetro e os becos. */
function topologia(adj, passagens) {
  const g = {};
  for (const [k, vs] of Object.entries(adj)) g[k] = [...vs];
  for (const [a, b] of passagens) {
    if (!g[a].includes(b)) g[a].push(b);
    if (!g[b].includes(a)) g[b].push(a);
  }

  const ids = Object.keys(g);
  let diametro = 0;
  let desconexo = false;

  for (const inicio of ids) {
    const dist = { [inicio]: 0 };
    const fila = [inicio];
    while (fila.length) {
      const atual = fila.shift();
      for (const v of g[atual]) {
        if (dist[v] === undefined) {
          dist[v] = dist[atual] + 1;
          fila.push(v);
        }
      }
    }
    if (Object.keys(dist).length !== ids.length) desconexo = true;
    diametro = Math.max(diametro, ...Object.values(dist));
  }

  const graus = Object.fromEntries(ids.map((k) => [k, g[k].length]));
  const becos = ids.filter((k) => graus[k] < 2);
  const grauMedio = ids.reduce((s, k) => s + graus[k], 0) / ids.length;
  return { diametro, desconexo, becos, grauMedio, graus };
}

function valida(t) {
  console.log(`\n  ── ${t.name} · ${t.era} ──`);

  ok(t.suspects?.length === 6, `6 suspeitos (${t.suspects?.length})`);
  ok(t.weapons?.length === 6, `6 objetos (${t.weapons?.length})`);
  ok(t.rooms?.length === 9, `9 lugares (${t.rooms?.length})`);

  const ids = [
    ...t.suspects.map((s) => s.id),
    ...t.weapons.map((w) => w.id),
    ...t.rooms.map((r) => r.id),
  ];
  ok(new Set(ids).size === ids.length, "nenhum id repetido entre suspeito, objeto e lugar");
  ok(
    ids.every((i) => /^[a-z0-9-]+$/.test(i)),
    "todo id é minúsculo, sem acento e sem espaço (vira chave de jsonb)",
  );

  const cores = t.suspects.map((s) => s.color);
  ok(
    cores.every((c) => CORES.includes(c)),
    `toda cor de suspeito está na paleta da plataforma (${cores.join(", ")})`,
  );
  ok(new Set(cores).size === 6, "as seis cores são distintas — dois suspeitos da mesma cor se confundem");
  ok(
    t.suspects.every((s) => s.name && s.role && s.crest),
    "todo suspeito tem nome, papel e brasão",
  );
  ok(
    t.rooms.every((r) => PISOS.includes(r.piso)),
    "todo lugar tem um piso que o som conhece (o passo soa diferente em cada)",
  );

  const celulas = t.rooms.map((r) => `${r.col},${r.row}`);
  ok(new Set(celulas).size === 9, "os nove lugares ocupam nove células distintas da grade");

  // grafo
  const chaves = Object.keys(t.adjacency);
  ok(chaves.length === 9, `a adjacência cobre os nove lugares (${chaves.length})`);
  ok(
    chaves.every((k) => t.rooms.some((r) => r.id === k)),
    "e não menciona lugar que não existe",
  );
  const assimetrias = [];
  for (const [a, vs] of Object.entries(t.adjacency)) {
    for (const b of vs) {
      if (!t.adjacency[b]?.includes(a)) assimetrias.push(`${a}→${b}`);
    }
  }
  ok(
    assimetrias.length === 0,
    assimetrias.length === 0
      ? "a adjacência é simétrica"
      : `porta de mão única: ${assimetrias.join(", ")}`,
  );

  ok(t.secretPassages?.length === 2, `2 passagens secretas (${t.secretPassages?.length})`);
  ok(
    t.secretPassages.every(([a, b]) => t.adjacency[a] && t.adjacency[b] && a !== b),
    "as passagens ligam lugares que existem",
  );
  ok(
    t.secretPassages.every(([a, b]) => !t.adjacency[a].includes(b)),
    "e nenhuma passagem duplica uma porta que já existe — seria passagem de nada",
  );

  const topo = topologia(t.adjacency, t.secretPassages);
  ok(!topo.desconexo, "o mapa é conexo: não há lugar onde a partida nunca chega");
  ok(
    topo.becos.length === 0,
    topo.becos.length === 0
      ? "nenhum beco sem saída (todo lugar tem duas saídas, contando passagem)"
      : `beco sem saída: ${topo.becos.join(", ")}`,
  );
  ok(topo.diametro <= 4, `diâmetro ${topo.diametro} — de qualquer lugar a qualquer outro em ≤ 4 passos`);
  ok(
    topo.grauMedio >= 2.6 && topo.grauMedio <= 4,
    `grau médio ${topo.grauMedio.toFixed(2)} — nem corredor, nem tudo ligado a tudo`,
  );

  // escrita
  ok(CLIMAS.includes(t.clima), `o clima "${t.clima}" existe no vocabulário sonoro`);
  ok(!!t.victim?.name && !!t.victim?.role, "a vítima tem nome e papel");
  const beats = Object.keys(t.narracao ?? {});
  ok(beats.length === 6, `a narração tem seis tempos (${beats.length})`);
  ok(
    Object.values(t.narracao ?? {}).every((s) => typeof s === "string" && s.length > 40),
    "e cada tempo é uma frase escrita, não um rótulo",
  );
  ok(
    typeof t.encerramento === "string" && t.encerramento.length > 40,
    "o encerramento é escrito",
  );
  ok(
    ["prep", "suggest", "refuted", "noRefute", "accuse", "ghost"].every((k) => t.copy?.[k]),
    "o vocabulário da interface está completo",
  );
  ok(
    typeof t.tagline === "string" && t.tagline.length > 30,
    "e a linha de chamada existe — é o que aparece no lobby",
  );
}

console.log("\nDossiê — pacotes de tema\n");

for (const t of TEMAS) valida(t);

if (falhas > 0) {
  console.error(`\n${falhas} falha(s). Nada foi publicado.`);
  process.exit(1);
}

/* ══════════════════════════════════════════════════════════════════════════
   PUBLICAÇÃO, e a revalidação de tudo o que já estava lá
   ══════════════════════════════════════════════════════════════════════════ */

const url = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("sem POSTGRES_URL");
  process.exit(1);
}

const db = new pg.Client({ connectionString: `${url}&uselibpqcompat=true` });
await db.connect();

for (const t of TEMAS) {
  await db.query(
    `insert into public.game_themes (id, game_key, name, era, tagline, data)
     values ($1, 'dossie', $2, $3, $4, $5::jsonb)
     on conflict (id) do update
        set data = excluded.data, name = excluded.name,
            era = excluded.era, tagline = excluded.tagline`,
    [t.id, t.name, t.era, t.tagline, JSON.stringify(t)],
  );
  console.log(`\n  publicado  ${t.name}`);
}

/* UMA FORMA SÓ. O Solar das Acácias nasceu numa migração e guarda a linha de
   chamada apenas na COLUNA `tagline`; os três novos guardam nos dois lugares,
   porque o pacote é o que viaja para o cliente. O validador reprovou essa
   diferença — corretamente — e a resposta certa não é abrir exceção no
   validador: é fazer os quatro pacotes terem a mesma forma.

   O backfill copia a coluna para dentro do jsonb quando falta. É idempotente. */
await db.query(
  `update public.game_themes
      set data = data || jsonb_build_object('tagline', tagline)
    where game_key = 'dossie' and data ->> 'tagline' is null`,
);

// e agora o que já estava no banco passa pelo mesmo crivo
const outros = await db.query(
  `select data from public.game_themes
    where game_key = 'dossie' and id <> all($1::text[])`,
  [TEMAS.map((t) => t.id)],
);
if (outros.rows.length > 0) {
  console.log(`\n  ── conferindo os ${outros.rows.length} tema(s) que já estavam publicados ──`);
  for (const linha of outros.rows) valida(linha.data);
}

const total = await db.query(
  "select count(*)::int n from public.game_themes where game_key = 'dossie'",
);
await db.end();

if (falhas > 0) {
  console.error(`\n${falhas} falha(s) — os novos foram publicados, mas há tema fora do padrão.`);
  process.exit(1);
}

console.log(`\n${total.rows[0].n} temas do Dossiê no ar, todos validados.\n`);
