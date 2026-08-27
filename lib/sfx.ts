/**
 * Som do Letreiro — sintetizado, não baixado.
 *
 * Um pacote de áudio decente custa uns 400 KB e ainda te amarra a um asset
 * que você não controla. Aqui cada som é meia dúzia de osciladores com
 * envelope: pesa zero, dá para afinar no código, e nunca fica fora de sintonia
 * com a cor da tela.
 *
 * Duas regras de plataforma respeitadas de propósito:
 *   1. navegador não deixa tocar antes de um gesto do usuário — o contexto só
 *      é criado (e retomado) em `arm()`, chamado no primeiro toque;
 *   2. o grupo já está em chamada de voz — mute é um clique visível e fica
 *      guardado.
 */

const CHAVE = "mesa:som";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let mudo = false;
let lido = false;
let ultimo = 0;

const ouvintes = new Set<() => void>();

function avisa() {
  for (const f of ouvintes) f();
}

function carrega() {
  if (lido || typeof window === "undefined") return;
  lido = true;
  try {
    mudo = window.localStorage.getItem(CHAVE) === "0";
  } catch {
    /* navegador privado, cookies bloqueados: fica ligado */
  }
}

/** Chamar no primeiro gesto do usuário. Sem isso, o navegador bloqueia. */
export function arm() {
  carrega();
  if (typeof window === "undefined") return;
  if (!ctx) {
    type ComWebkit = typeof window & { webkitAudioContext?: typeof AudioContext };
    const Ctor = window.AudioContext ?? (window as ComWebkit).webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
}

export function isMuted() {
  carrega();
  return mudo;
}

export function setMuted(v: boolean) {
  carrega();
  mudo = v;
  if (v) paraTrilha();
  try {
    window.localStorage.setItem(CHAVE, v ? "0" : "1");
  } catch {
    /* sem persistência: vale só nesta sessão */
  }
  avisa();
}

export function toggleMuted() {
  setMuted(!isMuted());
}

/** Para `useSyncExternalStore` — sem descompasso de hidratação. */
export function subscribe(f: () => void) {
  ouvintes.add(f);
  return () => ouvintes.delete(f);
}
export const getSnapshot = () => isMuted();
export const getServerSnapshot = () => false;

/* ── motor ──────────────────────────────────────────────────────────────── */

type Nota = {
  freq: number;
  /** segundos a partir de agora */
  em?: number;
  dur?: number;
  vol?: number;
  tipo?: OscillatorType;
  /** corte do filtro passa-baixa; sem isso vira apito */
  corte?: number;
  /** desliza até esta frequência */
  para?: number;
};

function toca(notas: Nota[]) {
  carrega();
  if (mudo || !ctx || !master) return;

  // no máximo um disparo por 40 ms: senão vira ruído. Vale para a CHAMADA,
  // não para cada nota — um arpejo de três notas é um disparo só.
  const agora = performance.now();
  if (agora - ultimo < 40) return;
  ultimo = agora;

  const t0 = ctx.currentTime;

  for (const n of notas) {
    const t = t0 + (n.em ?? 0);
    const dur = n.dur ?? 0.09;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();

    osc.type = n.tipo ?? "triangle";
    osc.frequency.setValueAtTime(n.freq, t);
    if (n.para) osc.frequency.exponentialRampToValueAtTime(n.para, t + dur);

    lp.type = "lowpass";
    lp.frequency.value = n.corte ?? 4200;

    const pico = n.vol ?? 0.22;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(pico, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(lp);
    lp.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }
}

/* ── vocabulário ────────────────────────────────────────────────────────── */

const ESCALA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31, 33, 36];
const semi = (n: number) => 220 * Math.pow(2, n / 12);

/**
 * Letra encostada. O tom sobe conforme a palavra cresce — é o que dá a
 * sensação de estar construindo algo, e não de apertar botões iguais.
 */
export function letra(indice: number) {
  const n = ESCALA[Math.min(indice, ESCALA.length - 1)] + 24;
  toca([{ freq: semi(n), dur: 0.075, vol: 0.2, tipo: "triangle", corte: 2600 }]);
}

/** Desfez uma letra. */
export function apaga() {
  toca([{ freq: semi(20), para: semi(13), dur: 0.09, vol: 0.14, tipo: "triangle", corte: 1400 }]);
}

/** Palavra aceita. Quanto mais longa, mais alto o arpejo sobe. */
export function certa(letras: number) {
  const base = 24 + Math.min(letras - 3, 6) * 2;
  toca([
    { freq: semi(base), dur: 0.1, vol: 0.2, tipo: "triangle" },
    { freq: semi(base + 4), em: 0.055, dur: 0.11, vol: 0.19, tipo: "triangle" },
    { freq: semi(base + 7), em: 0.11, dur: 0.16, vol: 0.22, tipo: "sine", corte: 5200 },
  ]);
}

/** Palavra recusada. Baixo e abafado — errar tem de ser barato. */
export function errada() {
  toca([
    { freq: semi(6), para: semi(1), dur: 0.17, vol: 0.2, tipo: "sawtooth", corte: 520 },
  ]);
}

/** Metrônomo dos últimos dez segundos. */
export function tique(urgente = false) {
  toca([
    {
      freq: urgente ? semi(36) : semi(31),
      dur: 0.045,
      vol: urgente ? 0.16 : 0.1,
      tipo: "square",
      corte: 3000,
    },
  ]);
}

/** Fim da rodada. */
export function fim() {
  toca([
    { freq: semi(24), dur: 0.14, vol: 0.2 },
    { freq: semi(19), em: 0.12, dur: 0.14, vol: 0.2 },
    { freq: semi(12), em: 0.24, dur: 0.34, vol: 0.22, tipo: "sine", corte: 2400 },
  ]);
}

/** Palavra que ninguém achou, sendo traçada na grade. */
export function revela(i: number) {
  const base = 22 + i * 2;
  toca([
    { freq: semi(base), dur: 0.2, vol: 0.16, tipo: "sine", corte: 4000 },
    { freq: semi(base + 12), em: 0.02, dur: 0.3, vol: 0.1, tipo: "sine", corte: 6000 },
  ]);
}

/* ── vocabulario do site ────────────────────────────────────────────────── */

/** Clique de botao. Curto e seco, para nao cansar. */
export function clique() {
  toca([{ freq: semi(28), dur: 0.05, vol: 0.11, tipo: "triangle", corte: 2200 }]);
}

/** Painel/modal abrindo. */
export function abre() {
  toca([
    { freq: semi(17), dur: 0.09, vol: 0.13, tipo: "triangle" },
    { freq: semi(24), em: 0.05, dur: 0.12, vol: 0.13, tipo: "triangle" },
  ]);
}

/** Painel/modal fechando. */
export function fecha() {
  toca([
    { freq: semi(24), dur: 0.08, vol: 0.12, tipo: "triangle" },
    { freq: semi(17), em: 0.05, dur: 0.11, vol: 0.12, tipo: "triangle" },
  ]);
}

/** Alguem entrou na sala. */
export function entrou() {
  toca([
    { freq: semi(19), dur: 0.09, vol: 0.15, tipo: "triangle" },
    { freq: semi(26), em: 0.07, dur: 0.13, vol: 0.15, tipo: "triangle" },
    { freq: semi(31), em: 0.14, dur: 0.18, vol: 0.13, tipo: "sine", corte: 5000 },
  ]);
}

/** Alguem ficou pronto. */
export function pronto() {
  toca([{ freq: semi(31), dur: 0.09, vol: 0.14, tipo: "sine", corte: 4200 }]);
}

/** Passo do peao. O timbre muda pelo piso do lugar. */
export function passo(piso: "madeira" | "tapete" | "ladrilho" = "madeira") {
  const cfg = {
    madeira: { freq: semi(9), corte: 900, vol: 0.11, tipo: "triangle" as OscillatorType },
    tapete: { freq: semi(5), corte: 420, vol: 0.08, tipo: "sine" as OscillatorType },
    ladrilho: { freq: semi(14), corte: 1800, vol: 0.1, tipo: "square" as OscillatorType },
  }[piso];
  toca([{ ...cfg, dur: 0.06 }]);
}

/** Porta pesada. */
export function porta() {
  toca([{ freq: semi(8), para: semi(3), dur: 0.22, vol: 0.13, tipo: "sawtooth", corte: 380 }]);
}

/** Carta virando: o "tec" seco. */
export function carta() {
  toca([{ freq: semi(33), para: semi(27), dur: 0.055, vol: 0.12, tipo: "square", corte: 3400 }]);
}

/** Sino: ninguem pode refutar. A linha mais importante do Dossie. */
export function sino() {
  toca([
    { freq: semi(28), dur: 0.5, vol: 0.2, tipo: "sine", corte: 4800 },
    { freq: semi(40), em: 0.01, dur: 0.7, vol: 0.09, tipo: "sine", corte: 7000 },
  ]);
}

/** Acusacao certa: o caso fechou. */
export function caso() {
  toca([
    { freq: semi(12), dur: 0.16, vol: 0.2 },
    { freq: semi(19), em: 0.14, dur: 0.16, vol: 0.2 },
    { freq: semi(24), em: 0.28, dur: 0.2, vol: 0.2 },
    { freq: semi(31), em: 0.44, dur: 0.5, vol: 0.22, tipo: "sine", corte: 5200 },
  ]);
}

/** Acusacao errada: virou fantasma. */
export function fantasma() {
  toca([
    { freq: semi(20), para: semi(6), dur: 0.55, vol: 0.16, tipo: "sine", corte: 900 },
  ]);
}

/* ── trilha ambiente ────────────────────────────────────────────────────── */
/**
 * Nao e musica gravada: e um acorde lento que respira, com uma nota solta de
 * vez em quando. Fica muito abaixo do resto (a mesa provavelmente esta em
 * chamada de voz) e morre junto com o mudo.
 */

let trilhaId: ReturnType<typeof setInterval> | null = null;
let trilhaPasso = 0;

/**
 * Um clima por caso do Dossie, e a escala e o que faz o clima.
 *
 * Nao ha instrumento aqui, so intervalos: o `raiz` diz a altura, `graus` diz
 * quais notas da escala entram, e `dur` diz o quanto cada uma se arrasta. Menor
 * com setima que nao resolve soa a misterio; quintas vazias soam a deserto;
 * segundas maiores empilhadas soam a espaco. E o mesmo motor de tres
 * osciladores em todos.
 *
 * Se um tema pede um clima que nao esta aqui, `iniciaTrilha` cai no misterio em
 * vez de quebrar — antes desta lista, um tema novo derrubava o som.
 */
const CLIMAS = {
  /** Dossie: menor, arrastado, com uma nota que nao resolve. */
  misterio: { raiz: 3, graus: [0, 3, 7, 10, 12, 15], dur: 2.6, vol: 0.05, tipo: "sine" as OscillatorType },
  /** Letreiro: maior, leve, quase infantil. */
  brincadeira: { raiz: 12, graus: [0, 4, 7, 9, 12, 16], dur: 1.7, vol: 0.04, tipo: "triangle" as OscillatorType },
  /** Boate Aurora: menor com quarta aumentada, pulso curto. Sintetizador de 87. */
  neon: { raiz: 8, graus: [0, 3, 6, 10, 12, 15], dur: 1.2, vol: 0.045, tipo: "sawtooth" as OscillatorType },
  /** Ras Zamir: quintas vazias e uma segunda menor. Deserto e distancia. */
  areia: { raiz: 5, graus: [0, 1, 7, 12, 13, 19], dur: 3.4, vol: 0.04, tipo: "triangle" as OscillatorType },
  /** Meridiano-9: segundas maiores empilhadas, sem terca. Frio e sem centro. */
  orbita: { raiz: 0, graus: [0, 2, 4, 7, 14, 16], dur: 4.2, vol: 0.035, tipo: "sine" as OscillatorType },
} as const;

export type Clima = keyof typeof CLIMAS;

export function iniciaTrilha(clima: Clima = "misterio") {
  carrega();
  if (typeof window === "undefined") return;
  paraTrilha();
  // tema com clima desconhecido toca o misterio em vez de derrubar o som: o
  // pacote de tema e conteudo, e conteudo nao pode quebrar o motor
  const c = CLIMAS[clima] ?? CLIMAS.misterio;
  trilhaPasso = 0;

  const bater = () => {
    if (mudo || !ctx) return;
    const g = c.graus[trilhaPasso % c.graus.length];
    const alt = c.graus[(trilhaPasso * 3 + 2) % c.graus.length];
    // dois toques por batida: a nota e uma quinta acima, bem apagada
    toca([
      { freq: semi(c.raiz + g), dur: c.dur, vol: c.vol, tipo: c.tipo, corte: 1500 },
      { freq: semi(c.raiz + alt + 12), em: c.dur * 0.4, dur: c.dur * 0.8, vol: c.vol * 0.55, tipo: "sine", corte: 2600 },
    ]);
    trilhaPasso++;
  };

  bater();
  trilhaId = setInterval(bater, (c.dur + 1.1) * 1000);
}

export function paraTrilha() {
  if (trilhaId) {
    clearInterval(trilhaId);
    trilhaId = null;
  }
}

/** Sala: alguém chegou. */
export function chegou() {
  toca([
    { freq: semi(19), dur: 0.09, vol: 0.14, tipo: "triangle" },
    { freq: semi(26), em: 0.07, dur: 0.13, vol: 0.14, tipo: "triangle" },
  ]);
}

/* ── Domínio ────────────────────────────────────────────────────────────────
   Um vocabulário de MADEIRA e METAL, distinto do Letreiro (que é xilofone) e
   do Dossiê (que é sino e passo). O dado é o som central do jogo, então ele
   tem de aguentar tocar cem vezes numa partida sem cansar: ruído curto,
   grave, sem nota definida — quase percussão. Uma melodia ali viraria tortura
   no décimo ataque.
   ─────────────────────────────────────────────────────────────────────────── */

/** Dado rolando na mesa: três batidas secas, cada vez em altura diferente. */
export function dado() {
  const base = 92 + Math.random() * 26;
  toca([
    { freq: base, dur: 0.05, vol: 0.2, tipo: "square", corte: 900, para: base * 0.7 },
    { freq: base * 1.3, em: 0.055, dur: 0.045, vol: 0.16, tipo: "square", corte: 1100, para: base },
    { freq: base * 0.9, em: 0.11, dur: 0.06, vol: 0.13, tipo: "square", corte: 800, para: base * 0.6 },
  ]);
}

/** O par foi meu: duas notas subindo, curtas. */
export function avanca() {
  toca([
    { freq: semi(12), dur: 0.07, vol: 0.15, tipo: "triangle" },
    { freq: semi(19), em: 0.06, dur: 0.1, vol: 0.15, tipo: "triangle" },
  ]);
}

/** O par foi dele: a mesma figura, descendo. */
export function recua() {
  toca([
    { freq: semi(12), dur: 0.07, vol: 0.14, tipo: "sawtooth", corte: 1600 },
    { freq: semi(5), em: 0.06, dur: 0.12, vol: 0.14, tipo: "sawtooth", corte: 1300 },
  ]);
}

/** Território tomado: fanfarra curta de três notas, com peso embaixo. */
export function conquista() {
  toca([
    { freq: semi(12), dur: 0.1, vol: 0.18, tipo: "triangle" },
    { freq: semi(16), em: 0.08, dur: 0.1, vol: 0.18, tipo: "triangle" },
    { freq: semi(24), em: 0.16, dur: 0.22, vol: 0.2, tipo: "triangle" },
    { freq: semi(0), em: 0.16, dur: 0.3, vol: 0.12, tipo: "sine", corte: 600 },
  ]);
}

/** Exército colocado no mapa: um toque só, seco, de madeira. */
export function planta() {
  toca([{ freq: 150 + Math.random() * 40, dur: 0.05, vol: 0.15, tipo: "square", corte: 1000, para: 110 }]);
}

/** Passou a vez: virada de página. */
export function vez() {
  toca([
    { freq: semi(9), dur: 0.09, vol: 0.13, tipo: "triangle" },
    { freq: semi(14), em: 0.08, dur: 0.14, vol: 0.13, tipo: "triangle" },
  ]);
}

/** Alguém saiu da partida: uma descida longa, e ninguém precisa de legenda. */
export function eliminado() {
  toca([
    { freq: semi(21), dur: 0.5, vol: 0.16, tipo: "sawtooth", corte: 1500, para: semi(2) },
    { freq: semi(9), em: 0.2, dur: 0.5, vol: 0.1, tipo: "sine", corte: 700, para: semi(-3) },
  ]);
}

/** Troca de cartas: baralho batendo. */
export function troca() {
  toca([
    { freq: 320, dur: 0.04, vol: 0.12, tipo: "square", corte: 2400, para: 240 },
    { freq: 380, em: 0.05, dur: 0.04, vol: 0.12, tipo: "square", corte: 2600, para: 280 },
    { freq: 440, em: 0.1, dur: 0.05, vol: 0.13, tipo: "square", corte: 2800, para: 320 },
  ]);
}

/** Vitória da partida: a única fanfarra longa do jogo. */
export function venceu() {
  toca([
    { freq: semi(12), dur: 0.14, vol: 0.18, tipo: "triangle" },
    { freq: semi(16), em: 0.12, dur: 0.14, vol: 0.18, tipo: "triangle" },
    { freq: semi(19), em: 0.24, dur: 0.14, vol: 0.18, tipo: "triangle" },
    { freq: semi(24), em: 0.36, dur: 0.45, vol: 0.22, tipo: "triangle" },
    { freq: semi(28), em: 0.36, dur: 0.45, vol: 0.12, tipo: "sine" },
    { freq: semi(0), em: 0.36, dur: 0.6, vol: 0.13, tipo: "sine", corte: 600 },
  ]);
}
