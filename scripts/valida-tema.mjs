/**
 * O crivo por onde todo pacote de tema do Dossiê passa.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUE ELE SAIU DO SEED
 *
 * O PRD 07 §5 diz, com todas as letras: "Validador — roda no CI, reprova o
 * build". Ele existia, era bom, e rodava num lugar só: dentro de
 * `npm run dossie`, o script que PUBLICA os temas.
 *
 * Quer dizer que ele conferia os temas no instante em que alguém decidia
 * republicá-los, e em nenhum outro. Um tema que mudasse no banco depois disso —
 * por migração, por mão na tabela, por uma coluna que passasse a divergir do
 * jsonb — nunca mais seria olhado, e a verificação diria "tudo passou".
 *
 * É a mesma forma de defeito que este projeto já pegou várias vezes, e sempre
 * com o mesmo nome: a regra está escrita, e existe um caminho que não passa por
 * ela.
 *
 * Agora o crivo mora aqui e é usado por dois:
 *
 *   `npm run dossie`         valida o que VAI publicar, e reprova antes de
 *                            escrever qualquer coisa
 *   `npm run smoke:pacotes`  valida o que ESTÁ publicado, toda verificação
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AS CHECAGENS DE GRAFO SÃO AS QUE IMPORTAM
 *
 * Um mapa com beco sem saída deixa alguém encurralado sem escolha; um mapa
 * desconexo deixa um cômodo onde a partida nunca acontece; um mapa de diâmetro
 * grande faz o jogo virar caminhada. As três passam despercebidas na leitura e
 * aparecem na quinta partida.
 *
 * `ok` entra como parâmetro porque quem chama já tem o seu: o seed conta falhas
 * para não publicar, a suíte conta para reprovar. A regra é a mesma; o que se
 * faz com o veredicto, não.
 */

const CORES = ["carmim", "terracota", "ocre", "oliva", "jade", "grafite", "prussia", "vinho"];

/* AS SEIS CARTAS QUE O MOTOR SABE JOGAR. Cada caso lhes dá o seu nome em
   `copy["pista.<id>"]` — a mesma carta é Chave do caseiro no Solar e Passe de
   camarim na Aurora —, e uma chave que o motor não conheça (`pista.chavemestra`,
   sem o hífen) não quebra nada: simplesmente nunca é lida, e a carta aparece na
   mesa com o nome genérico enquanto o pacote jura ter reescrito. É o mesmo
   veneno do `twist` decorativo, e o mesmo remédio. */
const PISTAS_DO_MOTOR = [
  "chave-mestra",
  "tempo-curto",
  "alibi",
  "impressao",
  "recado",
  "interrogatorio",
];

/* Os esmaltes, copiados de lib/avatar.ts porque este script roda em Node puro e
   aquele arquivo é TypeScript do cliente. Se um dia divergirem, o número que
   sai daqui passa a descrever uma paleta que não existe — e é por isso que a
   cópia é destas oito linhas e não do módulo inteiro: oito linhas dá para
   conferir de olho. */
const ENAMEL = {
  carmim: "#FF4D5E",
  terracota: "#FF8A2B",
  ocre: "#FFC42E",
  oliva: "#5FD13A",
  jade: "#25C08B",
  grafite: "#2FD8C4",
  prussia: "#2E8CFF",
  vinho: "#B25CFF",
};
const PISOS = ["madeira", "tapete", "ladrilho"];
const CLIMAS = ["misterio", "brincadeira", "neon", "areia", "orbita"];

/** As reviravoltas que o servidor sabe executar — espelho de `dossie_vira_rodada`. */
const REVIRAVOLTAS_DO_MOTOR = ["apagao", "tempestade", "registro"];

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

/**
 * @param t     o pacote
 * @param ok    (condição, frase) — quem chama decide o que fazer com o veredicto
 * @param conta se `false`, o crivo cala as linhas que não são veredicto: a
 *              suíte quer saber o que REPROVOU, e quatrocentas linhas de `ok`
 *              afogariam as dela. `npm run dossie` quer o relatório inteiro.
 */
export function validaTema(t, ok, conta = true) {
  if (conta) console.log(`\n  ── ${t.name} · ${t.era} ──`);

  /* NOME E ERA DENTRO DO PACOTE, e não só na coluna ao lado.

     O cliente monta o caso com `{...colunas, ...data}` — o jsonb por cima —,
     então um pacote sem `name` funciona por acidente: a coluna sobrevive
     porque nada a sobrescreve. O dia em que alguém publicar um `name` velho
     no jsonb, ele ganha da coluna calada.

     Foi exatamente o que aconteceu com `tagline`, e a resposta certa naquela
     vez não foi abrir exceção no crivo: foi fazer os quatro pacotes terem a
     mesma forma. Estes dois campos ficaram de fora daquela varredura. */
  ok(typeof t.name === "string" && t.name.length > 0, `o pacote traz o nome do caso`);
  ok(typeof t.era === "string" && t.era.length > 0, `e a era (${t.era})`);

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

  /* E QUÃO DISTINTAS ELAS SÃO EM ESCALA DE CINZA.

     Isto é um RELATÓRIO e não uma reprovação, e a diferença é deliberada.

     O PRD 03 §12 pede "peões distinguíveis em escala de cinza, nos quatro
     casos", e a paleta da plataforma não sustenta isso: as oito cores têm
     luminância entre 24 e 61, com dois grupos praticamente colados —
     vinho/prússia/carmim em 24–27, e terracota/jade em 39,6/40,0.

     Medido por força bruta: dos 28 conjuntos de seis cores possíveis, apenas
     DOIS chegam a uma separação mínima de 3 pontos, e 3 pontos ainda é pouco
     para o olho. Ou seja: não existe escolha de elenco que resolva. O que
     resolveria é abrir a faixa de luminância da paleta, e isso é decisão de
     direção de arte — não de quem publica um caso.

     Reprovar aqui deixaria o projeto sem publicar tema nenhum por causa de uma
     coisa que o tema não pode consertar. Então o validador MEDE, imprime, e
     deixa o número à vista de quem for decidir. */
  const luz = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const f = (c) => {
      const x = c / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    return (0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)) * 100;
  };
  let piorPar = [Infinity, ""];
  for (let i = 0; i < cores.length; i++) {
    for (let j = i + 1; j < cores.length; j++) {
      const d = Math.abs(luz(ENAMEL[cores[i]]) - luz(ENAMEL[cores[j]]));
      if (d < piorPar[0]) piorPar = [d, `${cores[i]}/${cores[j]}`];
    }
  }
  if (conta) {
    console.log(
      `         em escala de cinza, o par mais parecido é ${piorPar[1]} ` +
        `(ΔL ${piorPar[0].toFixed(1)}) — ver PRD 03 §12`,
    );
  }
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
  /* A FORMA ANTES DO CONTEÚDO, e esta linha nasceu de um defeito de verdade.

     A abertura do caso faz `beats.map(...)` para desenhar os pontinhos de
     progresso. Escrever a narração como `{ 0: "…", 1: "…" }` — que é o que eu
     fiz nos três casos novos — produz um OBJETO em JSON, e objeto não tem
     `.map`. A primeira pessoa que abriu o Dossiê recebeu a tela de erro do Next
     em vez do caso.

     E ESTE VALIDADOR DEIXOU PASSAR, porque `Object.keys()` funciona nos dois:
     seis chaves num array e seis chaves num objeto contam igual. Ele conferia o
     CONTEÚDO e não a FORMA — e forma é contrato. */
  ok(
    Array.isArray(t.narracao),
    Array.isArray(t.narracao)
      ? "a narração é uma LISTA (a abertura percorre ela; objeto não tem `.map`)"
      : "a narração é um objeto e precisa ser lista — a abertura quebra com objeto",
  );
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

  /* A REVIRAVOLTA TEM DE SER UMA QUE O MOTOR SABE EXECUTAR.

     Esta é a verificação que impede o defeito que este script passou três temas
     evitando: declarar um campo `twist` que o servidor ignora. Configuração que
     não muda nada é pior que configuração nenhuma — ela promete na tela o que a
     partida não entrega, e ninguém descobre porque nada quebra.

     A lista aqui é o espelho do `case` de `dossie_vira_rodada` (migração 0087).
     Se alguém inventar uma reviravolta num pacote da comunidade, ela reprova
     AQUI, na publicação, e não em silêncio na mesa. */
  if (t.twist) {
    ok(
      REVIRAVOLTAS_DO_MOTOR.includes(t.twist.id),
      `a reviravolta "${t.twist.id}" é uma que o motor executa`,
    );
    ok(
      !!t.twist.name && typeof t.twist.rule === "string" && t.twist.rule.length > 20,
      "e ela tem nome e uma regra escrita numa frase — é o que a mesa lê antes de começar",
    );
  }

  /* OS NOMES DAS CARTAS DE PISTA.

     Mesmo remédio da reviravolta, mesmo veneno: uma chave `pista.chavemestra`
     — sem o hífen, ou com o id de uma sétima carta que ninguém escreveu — não
     quebra nada. Ela simplesmente nunca é lida, e a carta aparece na mesa com o
     nome genérico enquanto o pacote jura ter reescrito.

     E ou o caso reescreve AS SEIS ou não reescreve nenhuma: metade reescrita é
     uma mão em que duas cartas falam a língua do caso e quatro falam a do
     motor, o que é pior que as seis genéricas. */
  const dePista = Object.keys(t.copy ?? {}).filter((k) => k.startsWith("pista."));
  if (dePista.length) {
    const forasteiras = dePista.filter((k) => !PISTAS_DO_MOTOR.includes(k.slice(6)));
    ok(
      forasteiras.length === 0,
      forasteiras.length === 0
        ? `as ${dePista.length} cartas de pista têm nome deste caso`
        : `nome de pista que o motor não conhece: ${forasteiras.join(", ")}`,
    );
    ok(
      dePista.length === PISTAS_DO_MOTOR.length,
      dePista.length === PISTAS_DO_MOTOR.length
        ? "e são as seis — meia mão reescrita fala duas línguas"
        : `só ${dePista.length} das ${PISTAS_DO_MOTOR.length} foram reescritas`,
    );
    ok(
      dePista.every((k) => typeof t.copy[k] === "string" && t.copy[k].length >= 3),
      "e todo nome é uma frase de verdade",
    );
  }
}
