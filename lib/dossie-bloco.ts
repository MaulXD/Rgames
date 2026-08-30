import { baralho, type Caso } from "@/lib/dossie";
import { avisoEnsina, cartasDoTipo, type Aviso } from "@/lib/dossie-pistas";

/**
 * O bloco de dedução — a lógica.
 *
 * Isto é o que separa quem joga bem de quem joga mal no Detetive de mesa, e é
 * a razão pela qual o jogo funciona melhor no computador do que no papel:
 *
 *   - os FATOS públicos são calculados do log, iguais para todo mundo;
 *   - os CONJUNTOS ("Cândida tem uma de três") existem, e o papel não comporta;
 *   - a inferência encadeada é opcional, porque para muita gente resolver a
 *     lógica é o jogo.
 *
 * Nada aqui adivinha: só deduz o que o log e a sua mão provam.
 * Ver docs/03-PRD-DOSSIE.md §6.2.
 */

export type Marca = "check" | "x" | "duvida";
export const ENVELOPE = "env";

/** cartaId -> coluna -> marca. Coluna é o assento em texto, ou "env". */
export type Marcas = Record<string, Partial<Record<string, Marca>>>;

export type Conjunto = { seat: number; cards: string[]; seq: number };

export type Nivel = "manual" | "assistido" | "dedutivo";

export type Pad = { marks: Marcas; assist: Nivel };

/**
 * Uma linha do registro público da partida.
 *
 * O tipo mora AQUI e não no componente, e é de propósito: o bloco de dedução lê
 * o log para apurar fatos, e a tela lê o mesmo log para narrar. Dois tipos com
 * o mesmo nome em dois arquivos foi o que aconteceu quando as reviravoltas
 * chegaram — a tela ganhou cinco tipos novos, o bloco não, e o TypeScript
 * reprovou. Isso foi sorte: se os dois tivessem `string`, o bloco simplesmente
 * ignoraria o Registro da Estação em silêncio.
 */
export type LinhaLog = {
  seq: number;
  type:
    | "move"
    | "suggest"
    | "refute"
    | "pass"
    | "no_refute"
    | "accuse"
    /* as reviravoltas falam no log como qualquer outra coisa que acontece na
       mesa — quem chegou atrasado lê o que perdeu na mesma lista */
    | "apagao"
    | "luz"
    | "vento"
    | "tempestade"
    | "registro"
    /* o Modo Avançado. `investiga` e `pista` dizem que ALGO aconteceu sem dizer
       o quê — a carta comprada é de quem comprou, e a resposta da impressão
       digital é de quem a jogou. O que o log conta é o que a mesa viu. */
    | "investiga"
    | "pista"
    | "alibi"
    | "interroga_ok"
    | "interroga_nada";
  seat?: number | null;
  room?: string;
  /** os dois lugares que a tempestade fecha, ou vai fechar */
  rooms?: string[];
  /** a carta que o Registro da Estação publicou */
  card?: string;
  /** a refutação aconteceu no escuro */
  anon?: boolean;
  guess?: string[];
  right?: boolean;
  auto?: boolean;
  /** qual Carta de Pista foi jogada */
  carta?: string;
  /** a quem ela foi dirigida — ausente no recado, que é anônimo */
  alvo?: number | null;
  /** o tipo pedido no interrogatório: 'suspects' | 'weapons' | 'rooms' */
  tipo?: string;
  /** os dois nomeados na impressão digital. A RESPOSTA nunca vem. */
  a?: string;
  b?: string;
};

export type Vista = { card: string; from: number | null; seq: number };

export type Jogador = { seat: number; userId: string; hand: number };

function poe(m: Marcas, carta: string, col: string, marca: Marca) {
  (m[carta] ??= {})[col] = marca;
}

/** Carta na mão de alguém: não está no envelope, e não está com mais ninguém. */
function daPara(m: Marcas, carta: string, dono: number, jogadores: Jogador[]) {
  poe(m, carta, String(dono), "check");
  poe(m, carta, ENVELOPE, "x");
  for (const j of jogadores) if (j.seat !== dono) poe(m, carta, String(j.seat), "x");
}

/**
 * Fatos e conjuntos, do log público mais a sua mão.
 *
 * O log vem com o mais novo primeiro; aqui ele é lido do começo, porque cada
 * `pass`/`refute` se refere ao último `suggest` que veio antes dele — e o
 * banco não repete o palpite nessas linhas de propósito (repetir seria vazar
 * qual das três cartas foi mostrada).
 */
export function apura(
  caso: Caso,
  log: LinhaLog[],
  mao: string[],
  vistas: Vista[],
  jogadores: Jogador[],
  meuAssento: number | null,
  nivel: Nivel,
  /* O que as Cartas de Pista contaram, do estado privado. Vem por último e com
     padrão vazio porque a mesa que jogou sem o Modo Avançado não tem nenhum —
     e porque uma mesa sem baralho não devia precisar saber que ele existe. */
  avisos: Aviso[] = [],
  /* ── A SEMENTE, do caderno que o servidor guarda ─────────────────────────

     O registro público tem teto: `dossie_log` guarda as sessenta linhas mais
     novas, porque ele viaja inteiro pelo Realtime a cada jogada. E `apura`
     deriva do registro, do zero, a cada renderização — então o que caiu do teto
     deixava de ser sabido.

     Não é hipótese: uma partida de verdade chegou a `seq` 281 com sessenta
     linhas guardadas, e `npm run smoke:bloco` mede a perda numa partida de cem
     linhas — 54 marcas com o registro inteiro, 9 com o cortado.

     A máquina nunca teve esse problema: `dossie_deduz` é incremental e guarda
     `dedu` no estado privado. Isto aqui é a mesma coisa para quem joga —
     `dossie_caderno` devolve o que o servidor já provou para ESTE assento, e a
     derivação a partir do registro fresco continua acontecendo por cima.

     Vazio por padrão: `apura` é uma função pura e continua sendo testável sem
     nada disso. */
  semente: { fora?: string[]; naoTem?: Record<string, string[]> } = {},
): { fatos: Marcas; conjuntos: Conjunto[] } {
  const fatos: Marcas = {};
  const conjuntos: Conjunto[] = [];
  if (nivel === "manual") return { fatos, conjuntos };

  /* 0. O QUE JÁ ESTAVA PROVADO. Vem primeiro porque é o passado: as linhas do
     registro que ainda existem vão reafirmar parte disto, e reafirmar um fato
     não custa nada. O que não vier do registro fica de pé por causa daqui. */
  for (const c of semente.fora ?? []) poe(fatos, c, ENVELOPE, "x");
  for (const [assento, cartas] of Object.entries(semente.naoTem ?? {})) {
    for (const c of cartas) poe(fatos, c, assento, "x");
  }

  // 1. minha mão
  if (meuAssento !== null) {
    for (const c of mao) daPara(fatos, c, meuAssento, jogadores);
  }

  // 2. cartas que mostraram para mim
  const porSeq = new Map(vistas.map((v) => [v.seq, v]));
  for (const v of vistas) {
    if (v.from === null) {
      // apagão: sei que a carta existe numa mão, mas não em qual
      poe(fatos, v.card, ENVELOPE, "x");
    } else {
      daPara(fatos, v.card, v.from, jogadores);
    }
  }

  /* 2b. O QUE AS CARTAS DE PISTA CONTARAM.

     Aviso não é dedução: é um fato que o servidor entregou pronto, lendo o
     envelope. Por isso vale já no nível assistido, junto com a própria mão e o
     Registro da Estação — e por isso o caderno de gente não pode ficar mais
     fraco que o da máquina, que aprende as mesmas coisas em `dossie_deduz`. */
  for (const a of avisos) {
    for (const c of avisoEnsina(caso, a)) poe(fatos, c, ENVELOPE, "x");
  }

  // 3. o log, do mais antigo para o mais novo
  const ordenado = [...log].sort((a, b) => a.seq - b.seq);
  let palpite: string[] | null = null;
  /* Quem apresentou álibi desde o último palpite. Zera a cada palpite novo,
     porque a carta vale para UMA refutação. */
  let comAlibi = new Set<number>();

  for (const l of ordenado) {
    /* O REGISTRO DA ESTAÇÃO é anúncio, não dedução: NÚBIA disse que aquela carta
       não está no envelope, e pronto. Não diz de quem é — dizer isso entregaria a
       mão de alguém, e a reviravolta promete um fato sobre o ENVELOPE.

       Por isso vale até no nível assistido, que não encadeia nada. */
    if (l.type === "registro") {
      if (l.card) poe(fatos, l.card, ENVELOPE, "x");
      continue;
    }
    /* "NÃO TENHO NENHUM" vale por seis cartas de uma vez, e vale SOZINHO —
       ao contrário do `pass`, que só significa alguma coisa colado ao palpite
       anterior. Por isso ele vem antes da guarda do `palpite` lá embaixo. */
    if (l.type === "interroga_nada" && l.seat !== null && l.seat !== undefined) {
      for (const c of cartasDoTipo(caso, l.tipo)) poe(fatos, c, String(l.seat), "x");
      continue;
    }
    if (l.type === "suggest") {
      palpite = l.guess ?? null;
      comAlibi = new Set();
      continue;
    }

    /* ── O ÁLIBI ────────────────────────────────────────────────────────────
       A única mentira legítima do jogo: não refutar TENDO a carta.

       O servidor registra o álibi e, logo depois, um `pass` normal — e o `pass`
       diz "não tenho nenhuma das três", que naquele caso é falso. Acreditar
       nele não é perder informação: é FABRICAR informação falsa, e o caderno
       assistido passaria a riscar coisa errada na cara de quem confia nele.

       A linha é PÚBLICA e o registro a narra, então saber disto não é
       privilégio: é o que está escrito na mesa. O que a carta protege é O QUE
       ele tem, e isso continua protegido. */
    if (l.type === "alibi" && l.seat !== null && l.seat !== undefined) {
      comAlibi.add(l.seat);
      continue;
    }
    if (l.type === "no_refute") {
      // ninguém tinha nenhuma das três — em nenhuma mão, MENOS a de quem
      // apresentou álibi: para essa pessoa, a rodada não disse nada
      for (const c of l.guess ?? []) {
        for (const j of jogadores) {
          // quem palpitou pode ter a carta na própria mão
          if (fatos[c]?.[String(j.seat)] === "check") continue;
          if (comAlibi.has(j.seat)) continue;
          poe(fatos, c, String(j.seat), "x");
        }
      }
      palpite = null;
      continue;
    }
    if (!palpite) continue;

    if (l.type === "pass" && l.seat !== null && l.seat !== undefined) {
      // não pôde refutar: não tem nenhuma das três — a não ser que tenha
      // apresentado álibi, e aí a passada não diz nada
      if (comAlibi.has(l.seat)) continue;
      for (const c of palpite) poe(fatos, c, String(l.seat), "x");
      continue;
    }

    if (l.type === "refute" && l.seat !== null && l.seat !== undefined) {
      const vista = porSeq.get(l.seq);
      if (vista) {
        // fui eu que palpitei: sei exatamente qual carta era
        daPara(fatos, vista.card, l.seat, jogadores);
      } else {
        // não vi a carta: sei que ele tem UMA das três
        conjuntos.push({ seat: l.seat, cards: [...palpite], seq: l.seq });
      }
      palpite = null;
    }
  }

  if (nivel === "dedutivo") {
    resolve(caso, fatos, conjuntos, jogadores);
  }

  return { fatos, conjuntos: encolhe(fatos, conjuntos) };
}

/** Corta de cada conjunto os membros já descartados; um só sobrando vira fato. */
export function encolhe(fatos: Marcas, conjuntos: Conjunto[]): Conjunto[] {
  return conjuntos
    .map((c) => ({
      ...c,
      cards: c.cards.filter((carta) => fatos[carta]?.[String(c.seat)] !== "x"),
    }))
    .filter((c) => c.cards.length > 1);
}

/**
 * Inferência encadeada, até não sair mais nada.
 *
 * São cinco regras, e nenhuma delas chuta:
 *   a) conjunto com um membro só  → ele é dele
 *   b) carta de alguém            → não é de mais ninguém nem do envelope
 *   c) carta negada por todos     → está no envelope
 *   d) tipo com uma só não negada no envelope → é ela
 *   e) mão completa               → todo o resto é negado para ele
 */
function resolve(caso: Caso, fatos: Marcas, conjuntos: Conjunto[], jogadores: Jogador[]) {
  const cartas = baralho(caso);
  const tipos = ["suspeito", "objeto", "lugar"] as const;

  for (let volta = 0; volta < 12; volta++) {
    let mudou = false;
    const antes = JSON.stringify(fatos);

    // a) conjunto reduzido a um
    for (const c of conjuntos) {
      const vivos = c.cards.filter((x) => fatos[x]?.[String(c.seat)] !== "x");
      if (vivos.length === 1 && fatos[vivos[0]]?.[String(c.seat)] !== "check") {
        daPara(fatos, vivos[0], c.seat, jogadores);
      }
    }

    // b) e c)
    for (const carta of cartas) {
      const col = fatos[carta.id] ?? {};
      const dono = jogadores.find((j) => col[String(j.seat)] === "check");
      if (dono) daPara(fatos, carta.id, dono.seat, jogadores);
      else if (
        jogadores.every((j) => col[String(j.seat)] === "x") &&
        col[ENVELOPE] !== "check"
      ) {
        poe(fatos, carta.id, ENVELOPE, "check");
      }
    }

    // d) um tipo com uma única candidata no envelope
    for (const tipo of tipos) {
      const doTipo = cartas.filter((c) => c.tipo === tipo);
      const possiveis = doTipo.filter((c) => fatos[c.id]?.[ENVELOPE] !== "x");
      if (possiveis.length === 1 && fatos[possiveis[0].id]?.[ENVELOPE] !== "check") {
        poe(fatos, possiveis[0].id, ENVELOPE, "check");
        for (const j of jogadores) poe(fatos, possiveis[0].id, String(j.seat), "x");
      }
    }

    // e) mão completa
    for (const j of jogadores) {
      const tem = cartas.filter((c) => fatos[c.id]?.[String(j.seat)] === "check").length;
      if (tem === j.hand) {
        for (const c of cartas) {
          if (fatos[c.id]?.[String(j.seat)] === undefined) poe(fatos, c.id, String(j.seat), "x");
        }
      }
    }

    mudou = JSON.stringify(fatos) !== antes;
    if (!mudou) break;
  }
}

/** O que aparece na célula: fato manda, anotação sua entra onde não há fato. */
export function celula(
  fatos: Marcas,
  meus: Marcas,
  carta: string,
  col: string,
): { marca: Marca | undefined; fato: boolean } {
  const f = fatos[carta]?.[col];
  if (f) return { marca: f, fato: true };
  return { marca: meus[carta]?.[col], fato: false };
}

/** Clique cicla: vazio → ✗ → ✓ → ? → vazio. */
export function proxima(atual: Marca | undefined): Marca | undefined {
  if (!atual) return "x";
  if (atual === "x") return "check";
  if (atual === "check") return "duvida";
  return undefined;
}
