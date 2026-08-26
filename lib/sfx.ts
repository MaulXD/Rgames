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

  // no máximo um disparo por 45 ms: senão vira ruído
  const agora = performance.now();
  if (agora - ultimo < 45) return;
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

/** Sala: alguém chegou. */
export function chegou() {
  toca([
    { freq: semi(19), dur: 0.09, vol: 0.14, tipo: "triangle" },
    { freq: semi(26), em: 0.07, dur: 0.13, vol: 0.14, tipo: "triangle" },
  ]);
}
