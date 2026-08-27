#!/usr/bin/env node
/**
 * Metrópole — monta, valida e publica a cidade.
 *
 * Por que este arquivo GERA o tabuleiro em vez de eu digitá-lo:
 *
 * São 28 propriedades × 6 faixas de aluguel = 168 números, mais 40 casas em
 * ordem, mais 32 cartas. Digitar isso à mão é garantir um erro de um dígito em
 * algum lugar — e um aluguel errado no meio do tabuleiro não quebra o jogo,
 * só o desequilibra em silêncio, que é pior.
 *
 * A ESCALA. Os preços do PRD são exatamente 10× os do Monopoly clássico
 * (Mediterranean 60 → Feira de Caruaru 600; Boardwalk 400 → Jardins 4000).
 * Isso não é coincidência: o balanceamento do tabuleiro clássico é o resultado
 * de noventa anos de mesa, e jogar fora essa curva para inventar números
 * "originais" seria apostar contra a casa. Então os ALUGUÉIS também saem de lá,
 * multiplicados por dez, e a tabela abaixo é a única coisa copiada — números,
 * que não são protegidos. Nome, ordem, arte, agrupamento e as 32 cartas são
 * autorais. Ver docs/README.md.
 *
 * Uso: npm run cidade
 */

import { writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(root, ".env.local"), quiet: true });

/* ══════════════════════════════════════════════════════════════════════════
   A CURVA DE ALUGUEL

   Cada linha: [preço, base, 1 casa, 2, 3, 4, hotel] na escala clássica. A
   posição no tabuleiro identifica a linha, porque duas propriedades do mesmo
   grupo podem ter preços iguais e aluguéis diferentes (Pelourinho e Olinda
   custam o mesmo e rendem o mesmo; Ponta Negra e Boa Viagem também) — mas
   Leblon e Jardins não. A chave é a casa, nunca o preço.
   ══════════════════════════════════════════════════════════════════════════ */

const CURVA = {
  1: [60, 2, 10, 30, 90, 160, 250],
  3: [60, 4, 20, 60, 180, 320, 450],
  6: [100, 6, 30, 90, 270, 400, 550],
  8: [100, 6, 30, 90, 270, 400, 550],
  9: [120, 8, 40, 100, 300, 450, 600],
  11: [140, 10, 50, 150, 450, 625, 750],
  13: [140, 10, 50, 150, 450, 625, 750],
  14: [160, 12, 60, 180, 500, 700, 900],
  16: [180, 14, 70, 200, 550, 750, 950],
  18: [180, 14, 70, 200, 550, 750, 950],
  19: [200, 16, 80, 220, 600, 800, 1000],
  21: [220, 18, 90, 250, 700, 875, 1050],
  23: [220, 18, 90, 250, 700, 875, 1050],
  24: [240, 20, 100, 300, 750, 925, 1100],
  26: [260, 22, 110, 330, 800, 975, 1150],
  27: [260, 22, 110, 330, 800, 975, 1150],
  29: [280, 24, 120, 360, 850, 1025, 1200],
  31: [300, 26, 130, 390, 900, 1100, 1275],
  32: [300, 26, 130, 390, 900, 1100, 1275],
  34: [320, 28, 150, 450, 1000, 1200, 1400],
  37: [350, 35, 175, 500, 1100, 1300, 1500],
  39: [400, 50, 200, 600, 1400, 1700, 2000],
};

const ESCALA = 10;

/** Grupos: cor, nome e o que uma casa custa neles. */
const GRUPOS = [
  { id: "marrom", nome: "Feira", cor: "#8A5A3C", casa: 500 },
  { id: "azul-claro", nome: "Litoral colonial", cor: "#7FC8E8", casa: 500 },
  { id: "rosa", nome: "Orla", cor: "#F27DA8", casa: 1000 },
  { id: "laranja", nome: "Centro velho", cor: "#F08A34", casa: 1000 },
  { id: "vermelho", nome: "Sul urbano", cor: "#E0483F", casa: 1500 },
  { id: "amarelo", nome: "Planejada", cor: "#F2C14E", casa: 1500 },
  { id: "verde", nome: "Nobre", cor: "#3FA96B", casa: 2000 },
  { id: "azul-escuro", nome: "Cobiçada", cor: "#2B5FA8", casa: 2000 },
];

/**
 * As 40 casas, em ordem. `g` é o grupo; a curva de aluguel vem da posição.
 * Os nomes são de lugares reais do Brasil — topônimo é domínio público — numa
 * cidade que não existe.
 */
const CASAS = [
  { t: "largada", nome: "Largada", nota: "Receba R$ 2.000 ao passar" },
  { t: "bairro", id: "caruaru", nome: "Feira de Caruaru", g: "marrom" },
  { t: "reves", nome: "Revés" },
  { t: "bairro", id: "ver-o-peso", nome: "Ver-o-Peso", g: "marrom" },
  { t: "imposto", nome: "Imposto de Renda", valor: 2000 },
  { t: "transporte", id: "congonhas", nome: "Aeroporto de Congonhas" },
  { t: "bairro", id: "pelourinho", nome: "Pelourinho", g: "azul-claro" },
  { t: "sorte", nome: "Sorte" },
  { t: "bairro", id: "olinda", nome: "Olinda", g: "azul-claro" },
  { t: "bairro", id: "iracema", praia: true, nome: "Praia de Iracema", g: "azul-claro" },
  { t: "cadeia", nome: "Cadeia", nota: "Só de passagem" },
  { t: "bairro", id: "ponta-negra", praia: true, nome: "Ponta Negra", g: "rosa" },
  { t: "companhia", id: "energia", nome: "Companhia de Energia" },
  { t: "bairro", id: "boa-viagem", praia: true, nome: "Boa Viagem", g: "rosa" },
  { t: "bairro", id: "porto-da-barra", praia: true, nome: "Porto da Barra", g: "rosa" },
  { t: "transporte", id: "santos", nome: "Porto de Santos" },
  { t: "bairro", id: "pampulha", nome: "Pampulha", g: "laranja" },
  { t: "reves", nome: "Revés" },
  { t: "bairro", id: "liberdade", nome: "Praça da Liberdade", g: "laranja" },
  { t: "bairro", id: "mercado", nome: "Mercado Municipal", g: "laranja" },
  { t: "praca", nome: "Praça Central", nota: "Descanso" },
  { t: "bairro", id: "batel", nome: "Batel", g: "vermelho" },
  { t: "sorte", nome: "Sorte" },
  { t: "bairro", id: "moinhos", nome: "Moinhos de Vento", g: "vermelho" },
  { t: "bairro", id: "beira-mar", praia: true, nome: "Beira-Mar Norte", g: "vermelho" },
  { t: "transporte", id: "luz", nome: "Estação da Luz" },
  { t: "bairro", id: "barra", praia: true, nome: "Barra da Tijuca", g: "amarelo" },
  { t: "bairro", id: "asa-sul", nome: "Asa Sul", g: "amarelo" },
  { t: "companhia", id: "saneamento", nome: "Companhia de Saneamento" },
  { t: "bairro", id: "meireles", praia: true, nome: "Meireles", g: "amarelo" },
  { t: "va-cadeia", nome: "Vá para a Cadeia" },
  { t: "bairro", id: "ipanema", praia: true, nome: "Ipanema", g: "verde" },
  { t: "bairro", id: "lago-sul", nome: "Lago Sul", g: "verde" },
  { t: "reves", nome: "Revés" },
  { t: "bairro", id: "vila-nova", nome: "Vila Nova Conceição", g: "verde" },
  { t: "transporte", id: "rio-niteroi", nome: "Ponte Rio–Niterói" },
  { t: "sorte", nome: "Sorte" },
  { t: "bairro", id: "leblon", praia: true, nome: "Leblon", g: "azul-escuro" },
  { t: "taxa", nome: "Taxa de Luxo", valor: 1000 },
  { t: "bairro", id: "jardins", nome: "Jardins", g: "azul-escuro" },
];

/* ══════════════════════════════════════════════════════════════════════════
   AS CARTAS

   Trinta e duas, autorais, e escritas com uma regra: cada uma tem de MEXER no
   tabuleiro, não só no caixa. Carta que só dá ou tira dinheiro é carta que a
   pessoa lê sem olhar — e as versões digitais do Banco Imobiliário costumam
   ter dezesseis dessas.

   `k` é o que a carta faz, e é o vocabulário fechado que o servidor entende:
     dinheiro   — soma (ou subtrai) no caixa
     cada       — recebe de cada jogador (ou paga a cada um)
     anda       — vai para uma casa, cobrando a Largada se passar
     anda-tras  — anda para trás N casas, sem cobrar Largada
     cadeia     — vai preso, sem cobrar Largada
     livra      — carta de saída, fica guardada
     obra       — paga por construção: casa e hotel a preços diferentes
     proximo    — vai ao próximo transporte ou companhia, aluguel dobrado
   ══════════════════════════════════════════════════════════════════════════ */

const SORTE = [
  { k: "anda", casa: 0, texto: "A ponte nova abriu: siga direto para a Largada." },
  { k: "anda", casa: 19, texto: "Convite para a feira orgânica do Mercado Municipal. Vá até lá." },
  { k: "anda", casa: 37, texto: "Aluguel de temporada no Leblon fechado. Vá para o Leblon." },
  { k: "anda", casa: 11, texto: "Festival na beira do rio: siga para Ponta Negra." },
  { k: "proximo", tipo: "transporte", texto: "Passagem de graça: vá ao próximo transporte. Se tiver dono, pague o dobro." },
  { k: "proximo", tipo: "companhia", texto: "Vistoria de medidores: vá à próxima companhia. Se tiver dono, pague dez vezes o dado." },
  { k: "anda-tras", n: 3, texto: "Você esqueceu a carteira. Volte três casas." },
  { k: "cadeia", texto: "Multas acumuladas. Vá para a Cadeia, sem passar pela Largada." },
  { k: "livra", texto: "Um advogado amigo resolveu. Guarde esta carta: ela tira você da Cadeia." },
  { k: "dinheiro", valor: 1500, texto: "Restituição do imposto: receba R$ 1.500." },
  { k: "dinheiro", valor: 500, texto: "Venda de móveis usados: receba R$ 500." },
  { k: "dinheiro", valor: -1500, texto: "IPTU atrasado com juros: pague R$ 1.500." },
  { k: "dinheiro", valor: -500, texto: "Multa de trânsito na avenida: pague R$ 500." },
  { k: "cada", valor: 500, texto: "Você virou notícia boa: receba R$ 500 de cada jogador." },
  { k: "cada", valor: -500, texto: "Sua obra sujou a rua toda: pague R$ 500 a cada jogador." },
  { k: "obra", casa: 250, hotel: 1000, texto: "Reforma geral: pague R$ 250 por casa e R$ 1.000 por hotel que você tiver." },
];

const REVES = [
  { k: "anda", casa: 0, texto: "Recomeço: vá para a Largada e receba o salário." },
  { k: "anda", casa: 10, semSalario: true, texto: "Intimação. Vá até a Cadeia — só de passagem, você não está preso." },
  { k: "anda", casa: 5, texto: "Voo remarcado: vá ao Aeroporto de Congonhas." },
  { k: "anda", casa: 24, texto: "Vistoria na Beira-Mar Norte. Vá até lá." },
  { k: "anda-tras", n: 3, texto: "Engarrafamento: volte três casas." },
  { k: "cadeia", texto: "Fiscalização flagrou a obra sem alvará. Vá para a Cadeia." },
  { k: "livra", texto: "O processo caiu por falta de provas. Guarde: esta carta tira você da Cadeia." },
  { k: "dinheiro", valor: 2000, texto: "Herança de um tio distante: receba R$ 2.000." },
  { k: "dinheiro", valor: 1000, texto: "Aluguel atrasado que você já tinha esquecido: receba R$ 1.000." },
  { k: "dinheiro", valor: 500, texto: "Seguro reembolsado: receba R$ 500." },
  { k: "dinheiro", valor: -1000, texto: "Conta de luz de três meses: pague R$ 1.000." },
  { k: "dinheiro", valor: -2000, texto: "Reforma emergencial do telhado: pague R$ 2.000." },
  { k: "dinheiro", valor: -500, texto: "Taxa de condomínio extra: pague R$ 500." },
  { k: "cada", valor: -1000, texto: "Aniversário na laje: pague R$ 1.000 a cada jogador." },
  { k: "cada", valor: 1000, texto: "Vaquinha para o seu projeto: receba R$ 1.000 de cada jogador." },
  { k: "obra", casa: 400, hotel: 1150, texto: "Vistoria estrutural: pague R$ 400 por casa e R$ 1.150 por hotel." },
];

/* ══════════════════════════════════════════════════════════════════════════
   MONTAGEM
   ══════════════════════════════════════════════════════════════════════════ */

const casas = CASAS.map((c, pos) => {
  const base = { pos, ...c };
  if (c.t === "bairro") {
    const linha = CURVA[pos];
    if (!linha) throw new Error(`sem curva de aluguel para a casa ${pos} (${c.nome})`);
    const [preco, ...alugueis] = linha;
    const grupo = GRUPOS.find((g) => g.id === c.g);
    if (!grupo) throw new Error(`grupo desconhecido: ${c.g}`);
    return {
      ...base,
      preco: preco * ESCALA,
      /** [sem casa, 1, 2, 3, 4, hotel] */
      aluguel: alugueis.map((a) => a * ESCALA),
      casa: grupo.casa,
      hipoteca: (preco * ESCALA) / 2,
    };
  }
  if (c.t === "transporte") {
    return {
      ...base,
      preco: 2000,
      /** por quantos transportes o dono tem: 1, 2, 3, 4 */
      aluguel: [250, 500, 1000, 2000],
      hipoteca: 1000,
    };
  }
  if (c.t === "companhia") {
    return {
      ...base,
      preco: 1500,
      /** multiplicador sobre a soma dos dados, por companhias possuídas */
      multiplo: [40, 100],
      hipoteca: 750,
    };
  }
  return base;
});

/* ══════════════════════════════════════════════════════════════════════════
   OS EVENTOS DA CIDADE

   Um evento global a cada cinco rodadas, valendo por tres — anunciado como
   manchete de jornal. Ver docs/05-PRD-METROPOLE.md §5.6.

   O PROBLEMA QUE ELES RESOLVEM e o meio de jogo monotono: quarenta minutos de
   "anda e paga" antes do desfecho. O evento muda a TEMPERATURA por tres
   rodadas e cria janela de oportunidade que vale a pena esperar — hipotecar
   agora ou depois do aperto de credito passa a ser uma decisao.

   Cada efeito e uma FRACAO DE INTEIROS, nunca um multiplicador decimal:
   dinheiro nao passa por ponto flutuante neste projeto. "-50%" e /2, "+50%" e
   x3/2, "-30%" e x7/10. Com os precos na escala x10, todas as contas fecham
   exatas.
   ══════════════════════════════════════════════════════════════════════════ */
const EVENTOS = [
  {
    id: "obra",
    manchete: "Obra na avenida paralisa o bairro",
    corpo: "Um grupo de cor sorteado tem os alugueis reduzidos a metade enquanto a obra durar.",
    efeito: "aluguel-grupo",
    num: 1,
    den: 2,
    sorteiaGrupo: true,
  },
  {
    id: "alta-temporada",
    manchete: "Alta temporada enche a orla",
    corpo: "Os bairros de praia cobram metade a mais de aluguel.",
    efeito: "aluguel-praia",
    num: 3,
    den: 2,
  },
  {
    id: "greve",
    manchete: "Greve geral dos transportes",
    corpo: "Aeroporto, porto, estacao e ponte nao cobram aluguel nenhum.",
    efeito: "aluguel-transporte",
    num: 0,
    den: 1,
  },
  {
    id: "boom",
    manchete: "Boom imobiliario derruba o preco da obra",
    corpo: "Construir custa trinta por cento menos.",
    efeito: "construcao",
    num: 7,
    den: 10,
  },
  {
    id: "aperto",
    manchete: "Aperto de credito no sistema bancario",
    corpo: "Hipotecar rende vinte por cento menos, e resgatar custa vinte por cento de juros.",
    efeito: "credito",
    num: 4,
    den: 5,
    jurosNum: 6,
    jurosDen: 5,
  },
  {
    id: "feriadao",
    manchete: "Feriadao prolongado movimenta a cidade",
    corpo: "O salario da Largada vale o dobro.",
    efeito: "salario",
    num: 2,
    den: 1,
  },
];

const cidade = {
  id: "capibara",
  nome: "Capibara",
  /** as constantes de escala, num lugar só */
  regras: {
    salario: 2000,
    bancoInicial: 15000,
    fiancaCadeia: 500,
    casasNoBanco: 32,
    hoteisNoBanco: 12,
    /** juros ao resgatar hipoteca */
    jurosResgate: 0.1,
    /** turnos até a partida acabar no modo Metrópole */
    rodadasMetropole: 20,
    rodadasRelampago: 12,
    /** propriedades sorteadas no começo, por modo */
    sorteioMetropole: 3,
    sorteioRelampago: 4,
    /** lance inicial do leilão */
    lanceMinimo: 100,
  },
  grupos: GRUPOS,
  eventos: EVENTOS,
  casas,
  sorte: SORTE,
  reves: REVES,
};

/* ══════════════════════════════════════════════════════════════════════════
   VALIDAÇÃO

   O mesmo espírito do validador de Vantara: o tabuleiro só é publicado se
   passar por tudo. Um tabuleiro de economia errada não dá erro — dá partida
   chata, e chato é o que ninguém consegue depurar depois.
   ══════════════════════════════════════════════════════════════════════════ */

let falhas = 0;
function ok(cond, msg) {
  if (cond) {
    console.log(`  ok      ${msg}`);
  } else {
    falhas++;
    console.error(`  FALHA   ${msg}`);
  }
}

console.log("\nMetrópole — a cidade de Capibara\n");

ok(casas.length === 40, `40 casas (${casas.length})`);

const bairros = casas.filter((c) => c.t === "bairro");
const transportes = casas.filter((c) => c.t === "transporte");
const companhias = casas.filter((c) => c.t === "companhia");
const props = [...bairros, ...transportes, ...companhias];

ok(bairros.length === 22, `22 bairros (${bairros.length})`);
ok(transportes.length === 4, `4 transportes (${transportes.length})`);
ok(companhias.length === 2, `2 companhias (${companhias.length})`);
ok(props.length === 28, `28 propriedades no total (${props.length})`);

const ids = props.map((p) => p.id);
ok(new Set(ids).size === ids.length, "nenhum id de propriedade repetido");
ok(
  ids.every((i) => /^[a-z0-9-]+$/.test(i)),
  "todo id é minúsculo, sem acento e sem espaço (vai virar chave de jsonb)",
);

// os oito grupos, com o tamanho certo
const porGrupo = Object.fromEntries(GRUPOS.map((g) => [g.id, bairros.filter((b) => b.g === g.id)]));
ok(
  GRUPOS.every((g) => porGrupo[g.id].length >= 2),
  "todo grupo tem pelo menos dois bairros",
);
ok(porGrupo["marrom"].length === 2, "marrom tem 2");
ok(porGrupo["azul-escuro"].length === 2, "azul-escuro tem 2");
ok(
  ["azul-claro", "rosa", "laranja", "vermelho", "amarelo", "verde"].every(
    (g) => porGrupo[g].length === 3,
  ),
  "os seis grupos do meio têm 3 cada",
);

// a economia: aluguel tem de subir sempre
ok(
  bairros.every((b) => b.aluguel.every((a, i) => i === 0 || a > b.aluguel[i - 1])),
  "o aluguel de bairro sobe a cada construção, sem platô",
);
ok(
  bairros.every((b) => b.aluguel[5] >= b.preco),
  "o hotel de todo bairro rende pelo menos o preço da propriedade num acerto",
);
ok(
  bairros.every((b) => b.hipoteca === b.preco / 2),
  "hipoteca é sempre metade do preço",
);
/* A curva clássica NÃO é proporcional, e a primeira versão desta checagem
   assumia que era: eu exigi que todo bairro levasse ~17 acertos para se pagar
   no aluguel base. É falso, e de propósito. O aluguel base do bairro caro
   rende uma fração MAIOR do preço (Jardins: 500 sobre 4000, 12,5%) que o do
   barato (Feira de Caruaru: 20 sobre 600, 3,3%). É o que faz valer a pena
   comprar caro mesmo sem construir — e é a razão de o azul-escuro ser
   disputado desde a primeira rodada. A checagem certa é a FAIXA. */
const retorno = bairros.map((b) => b.aluguel[0] / b.preco);
ok(
  retorno.every((r) => r >= 0.03 && r <= 0.13),
  `o aluguel base fica entre 3% e 13% do preço (${(Math.min(...retorno) * 100).toFixed(1)}% a ${(Math.max(...retorno) * 100).toFixed(1)}%)`,
);
ok(
  retorno[retorno.length - 1] > retorno[0],
  "o bairro mais caro rende proporcionalmente MAIS no aluguel base que o mais barato",
);

// preço tem de crescer ao longo do tabuleiro, grupo por grupo
const precoPorGrupo = GRUPOS.map((g) => Math.max(...porGrupo[g.id].map((b) => b.preco)));
ok(
  precoPorGrupo.every((p, i) => i === 0 || p > precoPorGrupo[i - 1]),
  `o preço sobe do primeiro grupo ao último (${precoPorGrupo.join(" < ")})`,
);

// os cantos, nas posições certas
ok(casas[0].t === "largada", "casa 0 é a Largada");
ok(casas[10].t === "cadeia", "casa 10 é a Cadeia");
ok(casas[20].t === "praca", "casa 20 é a Praça Central");
ok(casas[30].t === "va-cadeia", "casa 30 é o Vá para a Cadeia");

// distribuição das cartas pelo tabuleiro
const posSorte = casas.filter((c) => c.t === "sorte").map((c) => c.pos);
const posReves = casas.filter((c) => c.t === "reves").map((c) => c.pos);
ok(posSorte.length === 3 && posReves.length === 3, `3 casas de Sorte e 3 de Revés (${posSorte} · ${posReves})`);
/* Três é a distância mínima no tabuleiro clássico (Revés na 33, Sorte na 36),
   e não é descuido: as duas casas de carta perto do canto caro dão duas
   chances de escapar do azul-escuro. Exigir 4 aqui era eu inventando uma
   regra que o tabuleiro nunca teve. */
const menorVao = Math.min(
  ...posSorte.map((p) => Math.min(...posReves.map((q) => Math.abs(p - q)))),
);
ok(menorVao >= 3, `nenhuma casa de carta é vizinha de outra (menor vão: ${menorVao})`);

// as cartas
ok(SORTE.length === 16, `16 cartas de Sorte (${SORTE.length})`);
ok(REVES.length === 16, `16 cartas de Revés (${REVES.length})`);
const VOCAB = ["dinheiro", "cada", "anda", "anda-tras", "cadeia", "livra", "obra", "proximo"];
ok(
  [...SORTE, ...REVES].every((c) => VOCAB.includes(c.k)),
  "toda carta usa um efeito do vocabulário fechado",
);
ok(
  [...SORTE, ...REVES].every((c) => typeof c.texto === "string" && c.texto.length > 20),
  "toda carta tem texto escrito, não rótulo",
);
ok(
  [...SORTE, ...REVES].filter((c) => c.k === "livra").length === 2,
  "existem exatamente duas cartas de saída da Cadeia",
);
ok(
  [...SORTE, ...REVES].every((c) => c.k !== "anda" || (c.casa >= 0 && c.casa < 40)),
  "toda carta que manda andar aponta para uma casa que existe",
);
ok(
  [...SORTE, ...REVES].filter((c) => c.k === "dinheiro" || c.k === "cada").length <= 20,
  "no máximo 20 das 32 cartas são só dinheiro — o resto mexe no tabuleiro",
);

// dinheiro entrando × saindo: as cartas não podem ser uma torneira
const entra = [...SORTE, ...REVES]
  .filter((c) => c.k === "dinheiro" && c.valor > 0)
  .reduce((s, c) => s + c.valor, 0);
const sai = [...SORTE, ...REVES]
  .filter((c) => c.k === "dinheiro" && c.valor < 0)
  .reduce((s, c) => s - c.valor, 0);
ok(
  Math.abs(entra - sai) <= 1500,
  `as cartas de dinheiro estão quase equilibradas: entram ${entra}, saem ${sai}`,
);

// escassez de construção: 32 casas para 22 bairros é escasso de verdade
ok(
  cidade.regras.casasNoBanco < bairros.length * 4,
  `as ${cidade.regras.casasNoBanco} casas do banco não cobrem 4 por bairro (${bairros.length * 4}) — a escassez é real`,
);
ok(
  cidade.regras.hoteisNoBanco < bairros.length,
  `os ${cidade.regras.hoteisNoBanco} hotéis não cobrem os ${bairros.length} bairros`,
);

/* ── a economia da volta ─────────────────────────────────────────────────
   Esta checagem começou invertida. Eu exigi que o aluguel SEM construção
   pesasse contra o salário — e ele não pesa, nem deve. Sem casas, uma volta
   no tabuleiro RENDE dinheiro: o salário de R$ 2.000 é maior que o aluguel
   que você paga no caminho. É por isso que Banco Imobiliário sem construção
   nunca acaba, e é a razão de existir o modo por rodadas.

   A propriedade que o tabuleiro TEM de ter é a outra ponta: com hotéis, a
   volta custa um múltiplo do salário. Construir é o motor que termina a
   partida, e a distância entre as duas pontas é o tamanho da decisão de
   construir. Aqui isso é medido, não afirmado.

   O passo médio de dois dados é 7, então uma volta de 40 casas são ~5,7
   paradas; a chance de cada parada cair num bairro é 22/40. */
const PARADAS_POR_VOLTA = 40 / 7;
const CHANCE_BAIRRO = bairros.length / casas.length;
const custoVolta = (faixa) => {
  const medio = bairros.reduce((soma, b) => soma + b.aluguel[faixa], 0) / bairros.length;
  return medio * PARADAS_POR_VOLTA * CHANCE_BAIRRO;
};
const semCasa = custoVolta(0);
const comHotel = custoVolta(5);

ok(
  semCasa < cidade.regras.salario,
  `sem construção, a volta é lucrativa: custa ~R$ ${Math.round(semCasa)} contra R$ ${cidade.regras.salario} de salário`,
);
ok(
  comHotel > cidade.regras.salario * 6,
  `com hotéis, a volta custa ${(comHotel / cidade.regras.salario).toFixed(1)}× o salário — construir é o que termina a partida`,
);
console.log(
  `\n  a economia: volta sem casa ~R$ ${Math.round(semCasa)} · com hotel ~R$ ${Math.round(comHotel)} · salário R$ ${cidade.regras.salario}`,
);

// ── os eventos ─────────────────────────────────────────────────────────────

ok(EVENTOS.length === 6, `6 eventos da cidade (${EVENTOS.length})`);
ok(
  EVENTOS.every((e) => e.manchete && e.corpo && e.efeito && e.den > 0),
  "todo evento tem manchete, corpo, efeito e denominador",
);
ok(
  new Set(EVENTOS.map((e) => e.id)).size === EVENTOS.length,
  "nenhum id de evento repetido",
);
const EFEITOS = ["aluguel-grupo", "aluguel-praia", "aluguel-transporte", "construcao", "credito", "salario"];
ok(
  EVENTOS.every((e) => EFEITOS.includes(e.efeito)),
  "todo efeito está no vocabulário fechado que o servidor entende",
);
ok(
  EVENTOS.every((e) => Number.isInteger(e.num) && Number.isInteger(e.den)),
  "todo efeito é fração de INTEIROS — dinheiro não passa por float",
);

const praias = bairros.filter((b) => b.praia);
ok(praias.length >= 6, `${praias.length} bairros de praia marcados, para a Alta temporada`);
ok(
  praias.every((b) => (b.aluguel[0] * 3) % 2 === 0),
  "o aluguel de todo bairro de praia sobe 50% em conta exata (×3/2 sem sobra)",
);
ok(
  GRUPOS.every((g) => (g.casa * 7) % 10 === 0),
  "o custo de casa de todo grupo cai 30% em conta exata (×7/10 sem sobra)",
);
ok(
  bairros.every((b) => (b.hipoteca * 4) % 5 === 0 && (b.hipoteca * 6) % 5 === 0),
  "a hipoteca de todo bairro suporta os ±20% do aperto de crédito em conta exata",
);

if (falhas > 0) {
  console.error(`\n${falhas} falha(s). A cidade NÃO foi publicada.`);
  process.exit(1);
}

/* ══════════════════════════════════════════════════════════════════════════
   PUBLICAÇÃO
   ══════════════════════════════════════════════════════════════════════════ */

const destino = join(root, "lib", "metropole", "cidade.json");
await writeFile(destino, JSON.stringify(cidade, null, 2) + "\n", "utf8");
console.log(`\n  escrito  lib/metropole/cidade.json`);

const url = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("  sem POSTGRES_URL — a cidade não foi publicada no banco.");
  process.exit(1);
}

const db = new pg.Client({ connectionString: `${url}&uselibpqcompat=true` });
await db.connect();
await db.query(
  `insert into public.game_themes (id, game_key, name, era, tagline, data)
   values ($1, 'metropole', $2, $3, $4, $5::jsonb)
   on conflict (id) do update
      set data = excluded.data, name = excluded.name,
          era = excluded.era, tagline = excluded.tagline`,
  [
    cidade.id,
    cidade.nome,
    "déco tropical",
    "Uma cidade que não existe, feita de lugares que existem.",
    JSON.stringify(cidade),
  ],
);
const conferida = await db.query(
  `select jsonb_array_length(data -> 'casas') n,
          jsonb_array_length(data -> 'sorte') s,
          jsonb_array_length(data -> 'reves') r
     from public.game_themes where id = $1`,
  [cidade.id],
);
await db.end();

const { n, s, r } = conferida.rows[0];
console.log(`  publicada  ${cidade.nome}: ${n} casas, ${s} cartas de Sorte, ${r} de Revés`);
console.log("\nTudo passou.\n");
