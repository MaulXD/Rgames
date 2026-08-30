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
 * A REVIRAVOLTA É A ÚNICA PARTE DE UM PACOTE QUE NÃO É CONTEÚDO.
 *
 * Por três temas seguidos este script publicou os casos SEM ela, e o comentário
 * que ficava aqui explicava por quê: reviravolta é regra, e regra é motor.
 * Declarar um campo `twist` que o servidor ignora seria configuração decorativa
 * — a tela prometendo o que a partida não entrega, sem nada quebrar para
 * acusar. É o mesmo defeito que o `modo` do Domínio teve e que custou uma
 * migração para consertar.
 *
 * Agora o motor sabe executar as três (migrações 0086–0092), então elas entram.
 * E entra com elas a regra que faltava: `REVIRAVOLTAS_DO_MOTOR` é o espelho do
 * `case` de `dossie_vira_rodada`, e um pacote que declare uma quarta é REPROVADO
 * na publicação.
 *
 * Isso tem um custo real e vale a pena pagar: um tema da comunidade NÃO pode
 * inventar uma regra nova. Quando uma quarta reviravolta fizer sentido, ela
 * entra como código primeiro — e aí todo pacote pode usá-la.
 *
 * Uso: npm run dossie
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";
import { validaTema } from "./valida-tema.mjs";

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

/* AS SEIS CARTAS DE PISTA, com o nome que cada caso lhes dá.

   O efeito é do motor; o nome é do pacote. Uma "chave-mestra" numa estação
   orbital é um acesso de manutenção, e numa boate é um passe de camarim — o
   servidor não sabe nem precisa saber disso.

   Mora em `copy` e não num campo novo porque é exatamente a mesma coisa que
   `accuse` e `ghost` já fazem: uma casa só para as palavras que o caso troca.
   A chave é `pista.<id>`, e `PISTAS_DO_MOTOR`, em `scripts/valida-tema.mjs`, é o
   guarda — um pacote que escreva `pista.chavemestra` seria decoração
   silenciosa, e o crivo reprova. */

const nomesDePista = (m) =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [`pista.${k}`, v]));

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
  copy: {
    ...COPY_PADRAO,
    ghost: "Encostado",
    accuse: "Fechar a noite",
    ...nomesDePista({
      "chave-mestra": "Passe de camarim",
      "tempo-curto": "Última música",
      alibi: "Eu tava no camarim",
      impressao: "Copo com digital",
      recado: "Bilhete no espelho",
      interrogatorio: "Conversinha no banheiro",
    }),
  },
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
  /* A REVIRAVOLTA — Apagão (PRD 03 §3, §6.7).

     Uma vez por partida, numa rodada sorteada entre a 4 e a 8, a luz cai. As
     refutações daquela rodada são anônimas: você vê a carta que te mostraram,
     não vê quem mostrou, e o log diz só que alguém desmentiu.

     Por que é uma boa regra: você NÃO perde a informação que decide o jogo —
     aquela carta não está no envelope. Perde só a atribuição, que é a metade
     lenta da dedução. Choque sem prejuízo, e uma rodada em que a mesa grita. */
  twist: {
    id: "apagao",
    name: "Apagão",
    rule: "Numa rodada entre a quarta e a oitava, as refutações ficam anônimas.",
  },
  narracao: [
    "Três da manhã de sábado. A Aurora tinha acabado o último set e ninguém tinha ido embora.",
    "Nelson Braga era dono da casa há onze anos. Tinha começado com uma vitrola emprestada e terminado com uma fila na calçada.",
    "Encontraram ele na cabine do DJ. O disco ainda estava girando, e a agulha já tinha passado do fim.",
    "A luz da pista continuou piscando por vinte minutos, porque ninguém sabia onde ficava o disjuntor.",
    "Seis pessoas ficaram. Nenhuma delas tinha por que estar na casa depois do último set.",
    "Uma das seis desligou a mesa. As outras cinco estavam devendo alguma coisa a ele.",
  ],
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
  copy: {
    ...COPY_PADRAO,
    ghost: "Insolado",
    accuse: "Fechar o relatório",
    ...nomesDePista({
      "chave-mestra": "Atalho pelas galerias",
      "tempo-curto": "O sol está caindo",
      alibi: "Eu estava catalogando",
      impressao: "Digital no lacre",
      recado: "Bilhete no caderno de campo",
      interrogatorio: "Conversa sob o toldo",
    }),
  },
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
  /* A REVIRAVOLTA — Tempestade de Areia (PRD 03 §3, §6.7).

     A cada três rodadas o vento vira. Uma rodada ANTES, o jogo avisa quais dois
     lugares vão fechar — e é o aviso que faz a regra ser jogável em vez de
     cruel: dá para sair a tempo, ou entrar de propósito.

     Quem fica preso continua podendo palpitar. É o que transforma um lugar
     fechado em posição, não em punição: ninguém entra para te desmentir de
     perto, e você segue perguntando.

     O servidor só sorteia pares que mantêm o mapa conexo. Fechar o Poço e a
     Conservação ao mesmo tempo isolaria a Câmara Selada de todo mundo — e um
     lugar inalcançável numa rodada é uma partida que não termina. */
  twist: {
    id: "tempestade",
    name: "Tempestade de Areia",
    rule: "A cada três rodadas, dois lugares fecham. O aviso vem uma rodada antes.",
  },
  narracao: [
    "Quatorze de março, quatro da manhã. O vento tinha parado, o que no Ras Zamir é sempre um aviso.",
    "Sir Alistair Crewe pagou três temporadas de escavação sem descer ao poço uma única vez.",
    "Na noite anterior tinham quebrado o selo da câmara. Ele desceu para ver, e foi a primeira vez.",
    "Encontraram ele na tenda do arquivo, ao lado do selo partido, com areia nos punhos da camisa.",
    "Seis pessoas dormiam no acampamento. Nenhuma delas tinha dormido.",
    "Uma das seis desceu ao poço depois dele. Todas as outras sabiam o caminho.",
  ],
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
  copy: {
    ...COPY_PADRAO,
    ghost: "Desligado",
    accuse: "Fechar o ciclo",
    ...nomesDePista({
      "chave-mestra": "Acesso de manutenção",
      "tempo-curto": "Ciclo encurtado",
      alibi: "Meu turno está registrado",
      impressao: "Cotejo biométrico",
      recado: "Mensagem sem remetente",
      interrogatorio: "Chamada no canal privado",
    }),
  },
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
  /* A REVIRAVOLTA — Registro da Estação (PRD 03 §3, §6.7).

     A cada quatro rodadas, NÚBIA divulga publicamente um fato VERDADEIRO: uma
     carta que comprovadamente não está no envelope.

     A escolha não é sorteio. Entre as cartas fora do envelope, o servidor
     publica aquela que o MAIOR NÚMERO de jogadores ainda não riscou — então o
     fato sempre vale alguma coisa para a maioria da mesa, e nunca é a carta que
     todo mundo já sabia.

     Todo mundo recebe ao mesmo tempo, o que vira uma corrida: quem já tinha
     mais dados converte o fato em conclusão primeiro. */
  twist: {
    id: "registro",
    name: "Registro da Estação",
    rule: "A cada quatro rodadas, NÚBIA publica uma carta que não está no envelope.",
  },
  narracao: [
    "Ciclo 8.412. A estação estava em turno de sono e o zumbido do suporte de vida era o único som.",
    "A comandante Ilse Navarro estava no Meridiano-9 há quatro anos, e tinha assinado sozinha os quatro relatórios anuais.",
    "O auditor chegou há nove dias, com autorização para abrir qualquer registro da estação.",
    "Encontraram Navarro na câmara de vácuo. O registro biométrico dela tinha sido apagado do sistema.",
    "Só uma coisa a bordo tem acesso para apagar um registro. E ela é uma das seis.",
    "Seis pessoas acordadas em turno de sono. Nenhuma delas devia estar acordada.",
  ],
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


console.log("\nDossiê — pacotes de tema\n");

for (const t of TEMAS) validaTema(t, ok);

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

/* UMA FORMA SÓ, E ELA É RESPONSABILIDADE DA MIGRAÇÃO.

   O Solar das Acácias nasceu numa migração e guardava nome, era e chamada
   apenas nas COLUNAS; os três casos publicados depois trazem os campos também
   dentro do pacote. O cliente monta o caso com `{...colunas, ...data}`, o jsonb
   por cima, então a diferença nunca apareceu: a coluna sobrevivia porque nada a
   sobrescrevia.

   O backfill morava aqui, e estava no lugar errado — quem sobe um banco novo
   roda as migrações, e a suíte reprovaria até alguém lembrar de rodar o seed.
   Migração 0119 faz os três, idempotente. */

// e agora o que já estava no banco passa pelo mesmo crivo
const outros = await db.query(
  `select data from public.game_themes
    where game_key = 'dossie' and id <> all($1::text[])`,
  [TEMAS.map((t) => t.id)],
);
if (outros.rows.length > 0) {
  console.log(`\n  ── conferindo os ${outros.rows.length} tema(s) que já estavam publicados ──`);
  for (const linha of outros.rows) validaTema(linha.data, ok);
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
