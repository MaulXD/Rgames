"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { LegendaContinentes, MapaVantara } from "@/components/dominio/mapa";
import { Rolagem, type Assalto } from "@/components/dominio/dados";
import { useMenosMovimento } from "@/lib/movimento";
import { Mao, Objetivo, type Carta } from "@/components/dominio/cartas";
import { Avatar } from "@/components/avatar";
import { Confete } from "@/components/confete";
import { useSession } from "@/components/session";
import { supabaseBrowser } from "@/lib/supabase/client";
import { parseAvatar } from "@/lib/avatar";
import { COLORS, type ColorKey } from "@/lib/avatar";
import { conectados, mapaDe, placar, type Mapa } from "@/lib/dominio/mapas";
import * as sfx from "@/lib/sfx";

/* ── o estado que o servidor publica ─────────────────────────────────────── */

export type DominioState = {
  map: string;
  mode?: "campanha" | "classico";
  round: number;
  /** doze na Campanha; nulo no Clássico */
  rodadaFinal?: number | null;
  /** o placar da Campanha, acumulado a cada virada de rodada */
  pontos?: Record<string, number>;
  /** assento → rodada em que volta ao mapa (Campanha) */
  aguardando?: Record<string, number>;
  phase: "reforco" | "ataque" | "remanejo" | "fim";
  turnSeat: number;
  donos: Record<string, number>;
  exercitos: Record<string, number>;
  players: { seat: number; userId: string; cor: ColorKey; cartas: number; ativo: boolean }[];
  eliminados: number[];
  conquistou: boolean;
  remanejou: boolean;
  trocas: number;
  reforcoLeft: number;
  avanco: { de: string; para: string; max: number } | null;
  abates?: Record<string, number>;
  /** tréguas em vigor: "a:b" → rodada até a qual valem, com a < b sempre */
  treguas?: Record<string, number>;
  /** propostas de trégua abertas: "a:b" → { de } */
  tregProp?: Record<string, { de: number; rodada: number }>;
  /** quem rompeu trégua, pelo resto da partida */
  traidores?: number[];
  /** multa de reforço pendente por ter rompido */
  multaReforco?: Record<string, number>;
  log: LinhaLog[];
  vencedor: number | null;
};

type LinhaLog = {
  k: string;
  seat?: number;
  ter?: string;
  /** território de origem, ou (na volta da Campanha) o assento de quem pagou */
  de?: string;
  para?: string;
  n?: number;
  vitima?: number;
  por?: number;
  vale?: number;
  bonus?: number;
  /** o outro lado de uma trégua */
  com?: number;
  /** até que rodada a trégua vale */
  ate?: number;
  /** as rolagens de um ataque, uma por assalto (migração 0113) */
  rodadas?: Assalto[];
};

export type DominioMatch = {
  id: string;
  status: string;
  turn_deadline: string | null;
  public_state: DominioState;
};

export type Assento = {
  user_id: string;
  display_name: string;
  avatar: unknown;
  is_bot?: boolean;
};

/** Quanto tempo a máquina "pensa" antes de jogar o turno dela.
 *
 *  NÃO É ENFEITE. O servidor resolve o turno de uma máquina em alguns
 *  milissegundos; sem esta pausa, a pessoa encerra o turno e o mapa aparece com
 *  seis territórios trocados de cor sem que nada tenha acontecido na tela. Num
 *  jogo de tabuleiro, ver o adversario jogar é metade do jogo.
 *
 *  1200ms é o tempo de ler "Vez de Creuza" e olhar para o mapa. */
const PENSA_MS = 850;

/**
 * O rótulo técnico de um passo de máquina virado frase.
 *
 * Desde 0068 a máquina do Domínio joga um PASSO por vez, e não o turno inteiro:
 * reforça, ataca, avança, remaneja, passa. Sem a frase, a pessoa veria o mapa
 * mudar cinco vezes seguidas sem saber o que está acontecendo — e no Domínio o
 * que está acontecendo é literalmente um ataque contra ela.
 */
function frasePasso(mapa: Mapa, passo: string): string {
  const nome = (id?: string) => (id ? (mapa.porId[id]?.nome ?? id) : "");
  const m = /^(\w+)\(\d+\)\s*(.*)$/.exec(passo);
  if (!m) return passo;
  const [, k, resto] = m;
  const partes = resto.split(/\s+/);
  switch (k) {
    case "troca":
      return "trocou cartas";
    case "reforca":
      return `reforçou ${nome(partes[0])}`;
    case "ataca":
      return `atacou ${nome(partes[0])}` + (/e toma$/.test(resto) ? " e tomou" : "");
    case "avanca":
      return "avançou";
    case "remaneja":
      return "remanejou";
    case "passa":
      return "passou a vez";
    default:
      return passo;
  }
}

/** As mensagens de erro do servidor, em português e no contexto certo. */
const RECADO: Record<string, string> = {
  NOT_YOUR_TURN: "Não é a sua vez.",
  WRONG_PHASE: "Não dá para fazer isso nesta fase do turno.",
  NOT_YOURS: "Esse território não é seu.",
  TARGET_IS_YOURS: "Esse território já é seu.",
  NOT_ADJACENT: "Esses dois territórios não fazem fronteira.",
  NEED_TWO_ARMIES: "Precisa de pelo menos dois exércitos para atacar.",
  NOT_ENOUGH_REINFORCEMENTS: "Você não tem tantos exércitos para colocar.",
  MUST_TRADE: "Com cinco cartas na mão, você precisa trocar antes.",
  PLACE_REINFORCEMENTS: "Coloque todo o reforço antes de passar a vez.",
  ADVANCE_PENDING: "Resolva o avanço para o território que você tomou.",
  ALREADY_MOVED: "Um remanejo por turno.",
  NOT_CONNECTED: "Não há caminho seu entre esses dois territórios.",
  WOULD_EMPTY: "Território nunca fica sem exército.",
  BAD_COMBO: "Essas três cartas não fecham.",
  CARD_NOT_HELD: "Essa carta não está na sua mão.",
  MATCH_NOT_RUNNING: "Esta partida já terminou.",
  NOT_BOT_TURN: "Não é a vez de nenhuma máquina.",
};

function recado(msg: string): string {
  for (const [k, v] of Object.entries(RECADO)) if (msg.includes(k)) return v;
  return msg;
}

/* ── a tela ──────────────────────────────────────────────────────────────── */

export function DominioGame({
  match,
  assentos,
  onSair,
}: {
  match: DominioMatch;
  assentos: Assento[];
  onSair: () => void;
}) {
  const { user } = useSession();
  const st = match.public_state;
  /* QUAL MAPA. Vantara ou o recorte Relâmpago, e a resposta vem do ESTADO da
     partida — nunca das regras da sala. O anfitrião pode trocar de modo entre
     duas partidas, e o mapa de uma partida em curso é o que ela começou com. */
  const mapa = mapaDe(st.map);

  const [origem, setOrigem] = useState<string | null>(null);
  /* `destinoBruto` é o que foi tocado; `destino` é o que VALE — e sem origem
     escolhida nenhum destino vale. Derivar em vez de limpar por efeito tira
     uma renderização encadeada e, principalmente, tira a chance de a tela
     mostrar por um quadro um destino órfão. */
  const [destinoBruto, setDestinoBruto] = useState<string | null>(null);
  const [quanto, setQuanto] = useState(1);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [briga, setBriga] = useState<{
    assaltos: Assalto[];
    de: string;
    para: string;
    congelado: DominioState;
  } | null>(null);
  const [priv, setPriv] = useState<{ objetivo?: { texto: string }; cartas?: Carta[] }>({});
  const [resto, setResto] = useState<number>(0);
  const [mexeu, setMexeu] = useState<string[]>([]);
  const ultimoLog = useRef("");

  const mudo = useSyncExternalStore(sfx.subscribe, sfx.getSnapshot, sfx.getServerSnapshot);

  const eu = st.players.find((p) => p.userId === user?.id);
  const meuAssento = eu?.seat ?? null;
  /* Quem está na vez é máquina? Vem do lobby, que leu `profiles.is_bot`.
     Derivado, nunca guardado em estado: se virasse estado, a virada de turno
     teria dois passos e por um quadro a tela diria "sua vez" com a máquina na
     vez. */
  const donoDaVez = st.players.find((p) => p.seat === st.turnSeat);
  const maquinaNaVez =
    assentos.find((a) => a.user_id === donoDaVez?.userId)?.is_bot === true;
  const minhaVez = meuAssento !== null && st.turnSeat === meuAssento && st.phase !== "fim";
  const acabou = st.phase === "fim" || match.status === "finished" || st.vencedor !== null;
  /* A folha de estilo já tira o giro do dado; o que ela não tira é o TEMPO da
     encenação, e é aqui que ele é decidido. */
  const calmo = useMenosMovimento();
  // papel picado não precisa de estado: é uma leitura do resultado
  const festa = acabou && st.vencedor === meuAssento;

  const cores = useMemo(
    () => Object.fromEntries(st.players.map((p) => [p.seat, p.cor])) as Record<number, ColorKey>,
    [st.players],
  );
  const nomePorAssento = useMemo(() => {
    const m: Record<number, string> = {};
    for (const p of st.players) {
      m[p.seat] = assentos.find((a) => a.user_id === p.userId)?.display_name ?? `Assento ${p.seat}`;
    }
    return m;
  }, [st.players, assentos]);

  // durante a rolagem o mapa mostra o estado ANTERIOR: se ele já mudasse, o
  // dado estaria contando uma história cujo fim já está na tela
  const visto = briga ? briga.congelado : st;
  /* E QUEM NÃO ATACOU TAMBÉM PRECISA DESSE "ANTERIOR".

     Quem ataca congela o estado ANTES de chamar o servidor. Quem assiste
     recebe o estado já mudado junto com a linha do registro, então o congelado
     dele é o último estado que esteve na tela — guardado durante a
     renderização, do mesmo jeito que `visto_ex` guarda os exércitos.

     É uma aproximação e ela é honesta: pode haver mais de uma mudança entre
     dois quadros, e aí o mapa de fundo já mostra parte do resultado. O que
     importa é o dado, e o dado é exato. */
  const anterior = useRef<DominioState>(st);
  useEffect(() => {
    if (!briga) anterior.current = st;
  }, [st, briga]);
  const destino = origem ? destinoBruto : null;

  /**
   * Uma chave que muda a cada acontecimento da partida.
   *
   * Serve para reler o estado privado (mão e objetivo) na hora certa. Não dá
   * para depender de `st.turnSeat` e amigos: quando OUTRO jogador me elimina,
   * a mão dele cresce com as minhas cartas sem que a vez mude, e a mão na tela
   * ficaria velha. `log.length` também não serve — o log é capado em 80 linhas
   * e o comprimento congela no meio da partida.
   */
  const chaveEstado = useMemo(
    () => `${st.round}:${st.turnSeat}:${st.trocas}:${JSON.stringify(st.log?.[0] ?? null)}`,
    [st.round, st.turnSeat, st.trocas, st.log],
  );

  /* ── o que está privado: objetivo e mão ─────────────────────────────── */
  useEffect(() => {
    let vivo = true;
    async function puxa() {
      const { data } = await supabaseBrowser()
        .from("match_private_state")
        .select("data")
        .eq("match_id", match.id)
        .maybeSingle();
      if (!vivo) return;
      const d = (data as { data?: { objetivo?: { texto: string }; cartas?: Carta[] } } | null)?.data;
      if (d) setPriv({ objetivo: d.objetivo, cartas: d.cartas ?? [] });
    }
    void puxa();
    return () => {
      vivo = false;
    };
  }, [match.id, chaveEstado]);

  /* ── relógio do turno ───────────────────────────────────────────────── */
  useEffect(() => {
    if (!match.turn_deadline || acabou) return;
    const fim = new Date(match.turn_deadline).getTime();
    const tick = () => setResto(Math.max(0, Math.ceil((fim - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [match.turn_deadline, acabou]);

  /* ── a máquina joga, com respiro ────────────────────────────────

     O SERVIDOR NÃO JOGA O TURNO DA MÁQUINA SOZINHO, e essa é a decisão de
     ritmo do jogo todo. Se ele jogasse dentro da chamada de "encerrar turno", a
     pessoa clicaria uma vez e receberia o mapa três turnos depois — sem ver o
     dado rolar, sem ver o território mudar de cor, sem entender por que perdeu
     a Aurélia.

     Então a máquina FICA NA VEZ, e quem chama `dominio_tocar` é este efeito,
     depois de PENSA_MS. O servidor confere que é vez de uma máquina e nada mais:
     o cliente manda no RITMO, nunca no RESULTADO.

     Numa mesa com duas pessoas, as duas chamam. A segunda recebe NOT_BOT_TURN
     porque a vez já mudou, e isso é silêncio de propósito — não é erro, é a
     corrida sendo resolvida pelo `for update` do servidor.

     E se falhar três vezes seguidas, o efeito desiste e a tela oferece um botão.
     Girar para sempre chamando um RPC que dá erro seria pior que travar: gasta
     bateria de celular e não conta a ninguém que travou. */
  const tocando = useRef(false);
  const falhasSeguidas = useRef(0);
  const [maquinaEmpacou, setMaquinaEmpacou] = useState(false);
  /* UM CONTADOR QUE SÓ CRESCE, e é o gatilho de tentar de novo.

     Sem ele, uma falha de `dominio_tocar` não mudava nenhuma dependência deste
     efeito: `turnSeat` continua o mesmo (a máquina não jogou), `falhasSeguidas`
     é um ref e não re-renderiza, e `maquinaEmpacou` só vira true na TERCEIRA
     falha. Ou seja: a primeira falha parava a corrente para sempre, e a tela
     nunca chegava a oferecer o botão de tentar de novo — ela ficava dizendo
     "está jogando" sobre uma máquina que não ia jogar mais. */
  const [tique, setTique] = useState(0);
  const [passoBot, setPassoBot] = useState<string | null>(null);
  /* UM TETO DE PASSOS SEGUIDOS DE MÁQUINA.

     A causa do laço de 0070 está consertada no servidor. Este teto é seguro
     contra o PRÓXIMO laço — e vai existir um, porque ele nasce de duas regras
     certas se encontrando, e não de uma errada.

     Sem ele, o cliente chama o RPC enquanto houver passo: num laço, para sempre.
     Num celular isso é bateria queimada com a tela dizendo "está jogando" sobre
     uma mesa que não anda.

     O teto é folgado de propósito — três máquinas jogando turnos completos cabem
     bem abaixo dele — e zera quando a vez volta para gente. */
  const TETO_PASSOS = 150;
  const seguidos = useRef(0);

  const tocarMaquina = useCallback(async () => {
    if (tocando.current) return;
    tocando.current = true;
    try {
      const { data, error } = await supabaseBrowser().rpc("dominio_tocar", {
        p_match: match.id,
      });
      if (error) {
        const msg = (error as { message?: string }).message ?? "";
        // outra pessoa da mesa tocou primeiro: nao e erro, e a corrida resolvida
        if (/NOT_BOT_TURN|MATCH_NOT_RUNNING/.test(msg)) {
          falhasSeguidas.current = 0;
          return;
        }
        falhasSeguidas.current += 1;
        if (falhasSeguidas.current >= 3) setMaquinaEmpacou(true);
        else setTique((t) => t + 1);   // tenta de novo depois do respiro
        return;
      }
      falhasSeguidas.current = 0;
      setPassoBot((data as { passo?: string } | null)?.passo ?? null);
      seguidos.current += 1;
      if (seguidos.current > TETO_PASSOS) setMaquinaEmpacou(true);
      else setTique((t) => t + 1);
    } finally {
      tocando.current = false;
    }
  }, [match.id]);

  useEffect(() => {
    if (minhaVez) seguidos.current = 0;   // a vez voltou para gente: zera
    if (!maquinaNaVez || acabou || maquinaEmpacou) return;
    // o setState mora DENTRO do temporizador; no corpo do efeito ele seria uma
    // renderização encadeada, e o lint deste projeto recusa — com razão
    const id = setTimeout(() => void tocarMaquina(), PENSA_MS);
    return () => clearTimeout(id);
  }, [maquinaNaVez, acabou, maquinaEmpacou, st.turnSeat, st.round, tique, tocarMaquina,
    minhaVez,
  ]);

  /* ── som e brilho conforme o log anda ───────────────────────────────── */
  useEffect(() => {
    const nova = st.log?.[0];
    if (!nova) return;
    // o log e capado em 80 linhas, entao o COMPRIMENTO para de mudar depois da
    // linha 80 e o som sumiria no meio da partida. A chave e a linha em si.
    // Durante a rolagem quem faz som é a rolagem — e a saída vem ANTES de
    // marcar a linha como ouvida. Se marcasse primeiro, a conquista seria
    // consumida em silêncio e o som nunca tocaria: `briga` é dependência
    // deste efeito, então ele roda de novo quando a rolagem acaba.
    if (briga) return;
    const chave = JSON.stringify(nova);
    if (chave === ultimoLog.current) return;
    ultimoLog.current = chave;
    /* A ROLAGEM DE QUEM ASSISTE.

       Quem atacou já está animando com o que a chamada devolveu; para todo o
       resto da mesa, esta linha é a única forma de ver o dado cair. Sem o
       guarda de assento, quem atacou veria a mesma briga duas vezes.

       DUAS LINHAS PODEM TRAZÊ-LA, e é de propósito: o registro é capado em 80
       linhas, então um ataque custa UMA. Quando conquista, as rolagens viajam
       dentro da própria linha da conquista; quando não, vêm numa linha
       `assalto` — que antes não existia, e é o ataque que sangra sem tomar
       nada.

       Fica antes dos sons porque ela RETORNA: enquanto a rolagem toca, quem
       faz som é a rolagem, e é o mesmo motivo do `if (briga) return` acima. */
    if (
      (nova.k === "assalto" || nova.k === "conquista") &&
      nova.rodadas?.length &&
      nova.seat !== meuAssento
    ) {
      setBriga({
        assaltos: nova.rodadas,
        de: nova.de ?? "",
        para: nova.para ?? "",
        congelado: anterior.current,
      });
      return;
    }

    if (nova.k === "conquista") sfx.conquista();
    else if (nova.k === "eliminado") sfx.eliminado();
    else if (nova.k === "vez") sfx.vez();
    else if (nova.k === "troca") sfx.troca();
    else if (nova.k === "reforco") sfx.planta();
    else if (nova.k === "vitoria") sfx.venceu();
  }, [st.log, briga, meuAssento]);

  /* ── territórios que mudaram de exército: piscam ──────────────────────
     O cálculo do que mudou é feito DURANTE a renderização, comparando com o
     estado anterior guardado em estado — é o padrão que o React recomenda
     para "ajustar estado quando a prop muda", e não um efeito. Um efeito aqui
     encadearia uma renderização extra a cada mensagem do servidor, e numa
     partida de seis pessoas isso é muita renderização por nada.

     Só a LIMPEZA continua em efeito, porque ela depende de tempo passar — e
     lá o setState mora dentro do temporizador, onde é legítimo. */
  const [visto_ex, setVistoEx] = useState<Record<string, number>>(st.exercitos);
  if (visto_ex !== st.exercitos) {
    const mudou = Object.keys(st.exercitos).filter(
      (k) => visto_ex[k] !== undefined && visto_ex[k] !== st.exercitos[k],
    );
    setVistoEx(st.exercitos);
    if (mudou.length > 0 && !briga) setMexeu(mudou);
  }

  useEffect(() => {
    if (mexeu.length === 0) return;
    const id = setTimeout(() => setMexeu([]), 700);
    return () => clearTimeout(id);
  }, [mexeu]);

  /* ── chamar o servidor ──────────────────────────────────────────────── */
  const chama = useCallback(
    async (fn: string, args: Record<string, unknown>) => {
      setErro(null);
      setOcupado(true);
      const { data, error } = await supabaseBrowser().rpc(fn, args);
      setOcupado(false);
      if (error) {
        setErro(recado(error.message ?? String(error)));
        setOrigem(null);
        return null;
      }
      return data;
    },
    [],
  );

  /* ── o que ainda cabe neste turno ───────────────────────────────────── */

  const podeAtacar = st.phase === "ataque";
  // Um remanejo por turno, e ele ENCERRA o ataque: mover é a última coisa que
  // se faz. É a regra do tabuleiro, e o servidor a impõe virando a fase.
  const podeRemanejar = !st.remanejou && (st.phase === "ataque" || st.phase === "remanejo");
  const semNadaAFazer = !podeAtacar && !podeRemanejar && st.phase !== "reforco";

  /* ── alvos válidos ──────────────────────────────────────────────────────
     Atacar e mover tropa NÃO disputam o gesto, e não precisam de aba: o
     destino desambigua sozinho. Território inimigo vizinho é ataque;
     território meu ligado é remanejo. Um toque, dois significados, zero
     ambiguidade — porque um território nunca é as duas coisas. */
  const alvos = useMemo(() => {
    if (!minhaVez || acabou) return [];
    if (visto.phase === "reforco") {
      return mapa.territorios.filter((t) => visto.donos[t.id] === meuAssento).map((t) => t.id);
    }
    if (visto.avanco) return [visto.avanco.para];
    if (!origem) {
      // sem origem escolhida, acende de onde a jogada PODE partir
      return mapa.territorios.filter(
        (t) => visto.donos[t.id] === meuAssento && (visto.exercitos[t.id] ?? 0) >= 2,
      ).map((t) => t.id);
    }
    const out: string[] = [];
    if (podeAtacar) {
      out.push(...(mapa.porId[origem]?.vizinhos ?? []).filter((v) => visto.donos[v] !== meuAssento));
    }
    if (podeRemanejar) {
      out.push(...conectados(mapa, visto.donos, meuAssento!, origem));
    }
    return out;
  }, [mapa, minhaVez, acabou, visto, origem, meuAssento, podeAtacar, podeRemanejar]);

  /* ── a diplomacia ───────────────────────────────────────

     A chave de uma trégua é sempre "menor:maior", para que 2:5 e 5:2 sejam a
     mesma coisa e não dê para ter duas tréguas do mesmo par. */
  const chaveTregua = (a: number, b: number) =>
    `${Math.min(a, b)}:${Math.max(a, b)}`;

  const temTregua = (outro: number) =>
    meuAssento !== null &&
    (st.treguas?.[chaveTregua(meuAssento, outro)] ?? -1) >= st.round;

  /** A proposta que está esperando UMA resposta minha, se houver. */
  const propostaParaMim =
    meuAssento === null
      ? null
      : (Object.entries(st.tregProp ?? {})
          .map(([chave, v]) => ({ chave, de: v.de }))
          .find(
            (x) =>
              x.de !== meuAssento &&
              x.chave.split(":").map(Number).includes(meuAssento),
          ) ?? null);

  /** O dono do destino, se atacar ali rompesse uma trégua minha. */
  const romperia =
    destino !== null && meuAssento !== null
      ? (() => {
          const dono = visto.donos[destino];
          return dono !== undefined && dono !== meuAssento && temTregua(dono) ? dono : null;
        })()
      : null;

  const souFantasmaDominio =
    meuAssento !== null && !st.players.find((j) => j.seat === meuAssento)?.ativo;


  /** O destino escolhido é meu? Então é remanejo, não ataque. */
  const destinoEhMeu = destino !== null && visto.donos[destino] === meuAssento;

  const escolher = useCallback(
    (ter: string) => {
      if (!minhaVez || ocupado || acabou || briga) return;
      sfx.arm();
      setErro(null);

      if (visto.phase === "reforco") {
        if (visto.donos[ter] !== meuAssento) {
          setErro(RECADO.NOT_YOURS);
          return;
        }
        setOrigem(ter);
        setQuanto(Math.min(1, visto.reforcoLeft) || 1);
        return;
      }

      // primeira escolha: a origem
      if (!origem) {
        if (visto.donos[ter] !== meuAssento) {
          setErro(RECADO.NOT_YOURS);
          return;
        }
        if ((visto.exercitos[ter] ?? 0) < 2) {
          setErro("Território com um exército só não pode nem atacar nem mandar tropa.");
          return;
        }
        setOrigem(ter);
        setQuanto(1);
        return;
      }

      // tocar de novo na origem cancela — é o gesto que todo mundo tenta
      if (ter === origem) {
        setOrigem(null);
        return;
      }
      if (!alvos.includes(ter)) {
        // trocar de origem em vez de reclamar: era o que a pessoa queria
        if (visto.donos[ter] === meuAssento && (visto.exercitos[ter] ?? 0) >= 2) {
          setOrigem(ter);
          return;
        }
        setErro(
          podeAtacar
            ? "Daqui você só ataca vizinho, ou move tropa para território seu ligado."
            : RECADO.NOT_CONNECTED,
        );
        return;
      }
      setDestinoBruto(ter);
    },
    [minhaVez, ocupado, acabou, briga, visto, meuAssento, origem, alvos, podeAtacar],
  );

  /* ── as ações ───────────────────────────────────────────────────────── */

  async function reforcar() {
    if (!origem) return;
    sfx.planta();
    const r = await chama("dominio_reforcar", {
      p_match: match.id,
      p_ter: origem,
      p_qtd: quanto,
    });
    if (r) setOrigem(null);
  }

  async function atacar(vezes: number) {
    if (!origem || !destino) return;
    const congelado = st;
    const r = (await chama("dominio_atacar", {
      p_match: match.id,
      p_de: origem,
      p_para: destino,
      p_vezes: vezes,
    })) as { assaltos?: Assalto[] } | null;
    if (!r?.assaltos?.length) return;
    setBriga({ assaltos: r.assaltos, de: origem, para: destino, congelado });
    setOrigem(null);
    setDestinoBruto(null);
  }

  async function avancar(n: number) {
    await chama("dominio_avancar", { p_match: match.id, p_qtd: n });
  }

  async function remanejar() {
    if (!origem || !destino) return;
    const r = await chama("dominio_remanejar", {
      p_match: match.id,
      p_de: origem,
      p_para: destino,
      p_qtd: quanto,
    });
    if (r) {
      setOrigem(null);
      setDestinoBruto(null);
    }
  }

  async function encerrar() {
    setOrigem(null);
    setDestinoBruto(null);
    await chama("dominio_encerrar_turno", { p_match: match.id });
  }

  async function trocar(indices: number[]) {
    await chama("dominio_trocar", { p_match: match.id, p_cartas: indices });
  }

  /* ── placar lateral ─────────────────────────────────────────────────── */
  const conta = useMemo(() => placar(mapa, visto.donos, visto.exercitos), [mapa, visto]);
  const ehCampanha = (st.mode ?? "campanha") === "campanha";
  const aguarda = (seat: number) =>
    st.aguardando?.[String(seat)] !== undefined &&
    st.aguardando[String(seat)] > st.round;
  const maiorForca = Math.max(1, ...[...conta.values()].map((x) => x.forca));

  const urgente = resto <= 20 && resto > 0 && minhaVez;

  /* ── fim de partida ─────────────────────────────────────────────────── */
  if (acabou) {
    const venc = st.vencedor;
    const nome = venc !== null ? nomePorAssento[venc] : null;
    const souEu = venc === meuAssento;
    return (
      <div className="dominio-fim">
        {festa && <Confete pecas={56} />}
        <p className="eyebrow">Fim da campanha</p>
        <h2 className="dominio-fim-titulo">{souEu ? "Vantara é sua." : `${nome} venceu.`}</h2>
        <p className="dim dominio-fim-nota">
          {souEu
            ? "Objetivo cumprido. O mapa ficou do jeito que você precisava."
            : "O objetivo de cada um era secreto — e agora dá para entender por que ele atacava sempre do mesmo lado."}
        </p>

        <MapaVantara
          mapa={mapa}
          donos={st.donos}
          exercitos={st.exercitos}
          cores={cores}
          meuAssento={meuAssento}
          origem={null}
          alvos={[]}
          onEscolher={() => {}}
          disabled
        />

        <ol className="dominio-podio">
          {[...conta.entries()]
            .sort((a, b) => b[1].ters - a[1].ters)
            .map(([seat, x], i) => (
              <li key={seat} className="panel dominio-podio-linha" data-eu={seat === meuAssento}>
                <span className="seal">{i + 1}</span>
                <span
                  className="dominio-cor"
                  style={{ background: COLORS[cores[seat] ?? "grafite"].enamel }}
                  aria-hidden
                />
                <span className="dominio-podio-nome">{nomePorAssento[seat]}</span>
                <span className="mono dim">{x.ters} territórios · {x.forca} exércitos</span>
                {seat === venc && <span className="dominio-coroa">venceu</span>}
              </li>
            ))}
        </ol>

        <button className="btn btn-ghost" onClick={onSair}>
          Voltar para a sala
        </button>
      </div>
    );
  }

  /* ── a partida ──────────────────────────────────────────────────────── */
  return (
    <div className="dominio" onPointerDown={() => sfx.arm()}>
      {/* ── barra de turno ──────────────────────────────────────────── */}
      <div className="turno" data-minha={minhaVez}>
        <span
          className="dominio-cor turno-cor"
          style={{ background: COLORS[cores[st.turnSeat] ?? "grafite"].enamel }}
          aria-hidden
        />
        <div className="turno-quem">
          <p className="eyebrow">
            Rodada {st.round}
            {st.rodadaFinal ? ` de ${st.rodadaFinal}` : ""}
          </p>
          <p className="turno-nome">
            {minhaVez ? "Sua vez" : `Vez de ${nomePorAssento[st.turnSeat]}`}
          </p>
        </div>
        <span className="turno-fase mono">
          {st.phase === "reforco"
            ? `reforço · ${st.reforcoLeft}`
            : st.phase === "ataque"
              ? "ataque"
              : "remanejo"}
        </span>
        {match.turn_deadline ? (
          <span className="turno-relogio mono" data-urgente={urgente}>
            {Math.floor(resto / 60)}:{String(resto % 60).padStart(2, "0")}
          </span>
        ) : (
          /* "SEM PRESSA" NO LUGAR DA CONTAGEM.

     Quando a mesa não tem mais nenhuma pessoa além de você, a faxina desliga o
     relógio (`turn_deadline` nulo) em vez de tirar o seu turno — ver 0065. Sem
     este ramo, o cliente ficaria mostrando a última contagem congelada, e
     "0:00" parado na tela lê como "seu tempo acabou", que é exatamente o
     contrário do que aconteceu. */
          <span className="turno-relogio turno-sem-pressa mono">sem pressa</span>
        )}
        <button
          type="button"
          className="som"
          aria-pressed={mudo}
          aria-label={mudo ? "Ligar som" : "Desligar som"}
          onClick={() => {
            sfx.arm();
            sfx.toggleMuted();
          }}
        >
          {mudo ? "✕" : "♪"}
        </button>
      </div>

      {/* ── rolagem, quando há briga ────────────────────────────────── */}
      {briga && (
        <Rolagem
          /* a chave garante remontagem: uma segunda briga com a mesma
             quantidade de assaltos reaproveitaria o estado interno da
             primeira e começaria do passo errado */
          key={`${briga.de}-${briga.para}-${briga.assaltos.length}`}
          assaltos={briga.assaltos}
          calmo={calmo}
          nomeAtac={mapa.porId[briga.de]?.nome ?? briga.de}
          nomeDefe={mapa.porId[briga.para]?.nome ?? briga.para}
          onFim={() => setBriga(null)}
        />
      )}

      <MapaVantara
        mapa={mapa}
        donos={visto.donos}
        exercitos={visto.exercitos}
        cores={cores}
        meuAssento={meuAssento}
        origem={origem ?? (briga ? briga.de : null)}
        alvos={briga ? [briga.para] : alvos}
        mexeu={mexeu}
        onEscolher={escolher}
        disabled={!minhaVez || ocupado || !!briga}
      />

      {/* ── painel de ação ──────────────────────────────────────────── */}
      {!briga && (
        <div className="acao">
          {/* A PROPOSTA RECEBIDA VEM ANTES DE TUDO, e fora da sua vez.

              Uma proposta de trégua chega no turno de quem propôs. Se ela só
              aparecesse na sua vez, ficaria pendurada uma volta inteira do
              tabuleiro — e proposta pendurada é proposta que ninguém lembra de
              responder. */}
          {propostaParaMim && !acabou && (
            <div className="acao-bloco tregua-proposta">
              <p className="acao-titulo">
                {nomePorAssento[propostaParaMim.de]} propõe trégua.
              </p>
              <p className="acao-nota dim">
                Vale até o fim da próxima rodada. Você PODE romper depois — custa dois
                exércitos de reforço e a marca de Traidor pelo resto da partida.
              </p>
              <div className="acao-botoes">
                <button
                  type="button"
                  className="btn btn-brass"
                  disabled={ocupado}
                  onClick={() =>
                    void chama("dominio_responder_tregua", {
                      p_match: match.id,
                      p_de: propostaParaMim.de,
                      p_aceita: true,
                    })
                  }
                >
                  Aceitar
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={ocupado}
                  onClick={() =>
                    void chama("dominio_responder_tregua", {
                      p_match: match.id,
                      p_de: propostaParaMim.de,
                      p_aceita: false,
                    })
                  }
                >
                  Recusar
                </button>
              </div>
            </div>
          )}

          {!minhaVez && maquinaNaVez && !maquinaEmpacou && (
            <p className="acao-espera acao-pensando">
              <span className="pensa-pontos" aria-hidden>
                <i />
                <i />
                <i />
              </span>
              {nomePorAssento[st.turnSeat]} está jogando
              {passoBot ? <span className="dim"> · {frasePasso(mapa, passoBot)}</span> : null}
            </p>
          )}

          {!minhaVez && maquinaNaVez && maquinaEmpacou && (
            <div className="acao-bloco">
              <p className="acao-titulo">A vez de {nomePorAssento[st.turnSeat]} empacou.</p>
              <p className="acao-nota dim">
                Pode ser conexão. O turno dela também passa sozinho no relógio — mas se
                quiser empurrar, é aqui.
              </p>
              <div className="acao-botoes">
                <button
                  type="button"
                  className="btn btn-brass"
                  onClick={() => {
                    falhasSeguidas.current = 0;
                    setMaquinaEmpacou(false);
                  }}
                >
                  Tentar de novo
                </button>
              </div>
            </div>
          )}

          {!minhaVez && !maquinaNaVez && (
            <p className="acao-espera dim">
              Esperando {nomePorAssento[st.turnSeat]}. O turno passa sozinho se ninguém jogar.
            </p>
          )}

          {/* PROPOR TRÉGUA, na sua vez e sem gastar ação nenhuma.

              Diplomacia não custa turno de propósito: se custasse, ninguém
              negociaria, e a mecânica existiria só no papel. O que custa é
              ROMPER. */}
          {minhaVez && !st.avanco && !acabou && !souFantasmaDominio && (
            <details className="acao-bloco tregua-propor">
              <summary className="tregua-abre">Propor trégua</summary>
              <p className="acao-nota dim">
                Vale até o fim da próxima rodada. Qualquer um dos dois pode romper — e
                quem romper perde dois exércitos de reforço e carrega a marca de
                Traidor até o fim.
              </p>
              <div className="acao-botoes tregua-quem">
                {st.players
                  .filter(
                    (j) =>
                      j.seat !== meuAssento &&
                      j.ativo &&
                      !temTregua(j.seat) &&
                      !(st.tregProp ?? {})[chaveTregua(meuAssento ?? 0, j.seat)],
                  )
                  .map((j) => (
                    <button
                      key={j.seat}
                      type="button"
                      className="btn btn-ghost btn-mini"
                      disabled={ocupado}
                      onClick={() =>
                        void chama("dominio_propor_tregua", {
                          p_match: match.id,
                          p_com: j.seat,
                        })
                      }
                    >
                      <span
                        className="dominio-cor"
                        style={{ background: COLORS[j.cor].enamel }}
                        aria-hidden
                      />
                      {nomePorAssento[j.seat]}
                    </button>
                  ))}
              </div>
              {st.players.filter(
                (j) => j.seat !== meuAssento && j.ativo && !temTregua(j.seat),
              ).length === 0 && (
                <p className="acao-nota dim">
                  Não há com quem — ou já há trégua com todo mundo.
                </p>
              )}
            </details>
          )}

          {minhaVez && st.avanco && (
            <div className="acao-bloco">
              <p className="acao-titulo">
                {mapa.porId[st.avanco.para]?.nome} é seu. Mandar mais quantos de{" "}
                {mapa.porId[st.avanco.de]?.nome}?
              </p>
              <p className="acao-nota dim">
                Até {st.avanco.max}. Quem avança segura o que tomou; quem fica defende a
                retaguarda. Não há resposta certa.
              </p>
              <div className="acao-botoes">
                {Array.from({ length: st.avanco.max + 1 }, (_, n) => (
                  <button
                    key={n}
                    type="button"
                    className={n === st.avanco!.max ? "btn btn-brass" : "btn btn-ghost"}
                    disabled={ocupado}
                    onClick={() => void avancar(n)}
                  >
                    {n === 0 ? "nenhum" : `+${n}`}
                  </button>
                ))}
              </div>
            </div>
          )}

          {minhaVez && !st.avanco && st.phase === "reforco" && (
            <div className="acao-bloco">
              <p className="acao-titulo">
                {origem
                  ? `Quantos em ${mapa.porId[origem]?.nome}?`
                  : `Coloque ${st.reforcoLeft} ${st.reforcoLeft === 1 ? "exército" : "exércitos"}`}
              </p>
              {!origem && (
                <p className="acao-nota dim">
                  Toque num território seu. O reforço vem de território ÷ 2, mínimo três, mais o
                  bônus de continente fechado.
                </p>
              )}
              {origem && (
                <>
                  <Contador
                    valor={quanto}
                    max={st.reforcoLeft}
                    onMuda={setQuanto}
                    disabled={ocupado}
                  />
                  <div className="acao-botoes">
                    <button
                      type="button"
                      className="btn btn-brass"
                      disabled={ocupado}
                      onClick={() => void reforcar()}
                    >
                      Colocar {quanto}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setOrigem(null)}
                    >
                      Outro lugar
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {minhaVez && !st.avanco && semNadaAFazer && (
            <div className="acao-bloco">
              <p className="acao-titulo">Turno cumprido.</p>
              <p className="acao-nota dim">
                Você já atacou e já remanejou. O que sobra é passar a vez — e pegar a carta, se
                conquistou algo.
              </p>
            </div>
          )}

          {minhaVez && !st.avanco && st.phase !== "reforco" && !semNadaAFazer && (
            <div className="acao-bloco">
              {!origem && (
                <>
                  <p className="acao-titulo">
                    {podeAtacar && podeRemanejar
                      ? "Atacar ou mover tropa: de onde?"
                      : podeAtacar
                        ? "Atacar: de onde?"
                        : "Mover tropa: de onde?"}
                  </p>
                  <p className="acao-nota dim">
                    Toque num território seu com dois exércitos ou mais — território com um só não
                    ataca nem manda tropa, porque alguém tem de ficar.
                    {podeAtacar && podeRemanejar
                      ? " Depois, toque num vizinho inimigo para atacar ou num território seu para mover."
                      : ""}
                  </p>
                </>
              )}
              {origem && !destino && (
                <>
                  <p className="acao-titulo">
                    De {mapa.porId[origem]?.nome} ({visto.exercitos[origem]}) para onde?
                  </p>
                  <p className="acao-nota dim">
                    {alvos.length === 0
                      ? "Nenhum destino válido daqui. Toque em outro território."
                      : "Os destinos possíveis estão acesos, e as fronteiras deles também."}
                  </p>
                </>
              )}
              {origem && destino && !destinoEhMeu && (
                <>
                  <p className="acao-titulo">
                    {mapa.porId[origem]?.nome} ({visto.exercitos[origem]}) ataca{" "}
                    {mapa.porId[destino]?.nome} ({visto.exercitos[destino]})
                  </p>
                  {/* O AVISO ANTES DE ROMPER.

                      O servidor deixa romper, e é o ponto do §6.6. Mas romper
                      sem saber que se está rompendo não é traição — é acidente,
                      e acidente não vira história, vira reclamação.

                      A marca de Traidor dura o resto da partida. Ninguém deve
                      ganhá-la por ter tocado no território errado. */}
                  {romperia !== null ? (
                    <p className="acao-nota tregua-aviso">
                      Isso ROMPE a trégua com {nomePorAssento[romperia]}. Você começa o
                      próximo reforço com dois exércitos a menos e fica marcado como
                      Traidor pelo resto da partida.
                    </p>
                  ) : (
                    <p className="acao-nota dim">
                      {visto.exercitos[origem] >= 4 && visto.exercitos[destino] <= 2
                        ? "Com essa diferença, ir até o fim costuma valer."
                        : "Um assalto por vez dá para desistir no meio; ir até o fim resolve numa vez."}
                    </p>
                  )}
                  <div className="acao-botoes">
                    <button
                      type="button"
                      className={romperia !== null ? "btn btn-lacquer" : "btn btn-brass"}
                      disabled={ocupado}
                      onClick={() => void atacar(1)}
                    >
                      {romperia !== null ? "Romper e atacar" : "Um assalto"}
                    </button>
                    <button
                      type="button"
                      className={romperia !== null ? "btn btn-lacquer" : "btn btn-vivo"}
                      disabled={ocupado}
                      onClick={() => void atacar(12)}
                    >
                      {romperia !== null ? "Romper e ir até o fim" : "Até acabar"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setDestinoBruto(null)}
                    >
                      Outro alvo
                    </button>
                  </div>
                </>
              )}
              {origem && destino && destinoEhMeu && (
                <>
                  <p className="acao-titulo">
                    Mandar tropa de {mapa.porId[origem]?.nome} para {mapa.porId[destino]?.nome}
                  </p>
                  {/* a consequência tem de estar visível ANTES do toque, não
                      numa mensagem de erro depois */}
                  <p className="acao-nota dim">
                    É o seu único remanejo do turno{podeAtacar ? ", e ele encerra o ataque" : ""}.
                  </p>
                  <Contador
                    valor={quanto}
                    max={Math.max(1, (visto.exercitos[origem] ?? 1) - 1)}
                    onMuda={setQuanto}
                    disabled={ocupado}
                  />
                  <div className="acao-botoes">
                    <button
                      type="button"
                      className="btn btn-brass"
                      disabled={ocupado}
                      onClick={() => void remanejar()}
                    >
                      Mandar {quanto}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setDestinoBruto(null)}
                    >
                      Cancelar
                    </button>
                  </div>
                </>
              )}

            </div>
          )}

          {minhaVez && !st.avanco && (
            <button
              type="button"
              className="btn btn-lacquer acao-passar"
              disabled={ocupado || st.reforcoLeft > 0}
              onClick={() => void encerrar()}
              title={st.reforcoLeft > 0 ? "Coloque todo o reforço antes" : undefined}
            >
              {st.reforcoLeft > 0
                ? `Coloque ${st.reforcoLeft} antes de passar`
                : st.conquistou
                  ? "Encerrar turno e pegar a carta"
                  : "Encerrar turno"}
            </button>
          )}

          {erro && (
            <p className="acao-erro" role="alert">
              {erro}
            </p>
          )}
        </div>
      )}

      {/* ── quem está na mesa ───────────────────────────────────────── */}
      <div className="panel dominio-mesa">
        <p className="eyebrow">Na mesa</p>
        <ul className="dominio-jogadores">
          {st.players.map((p) => {
            const x = conta.get(p.seat) ?? { ters: 0, forca: 0 };
            const perfil = assentos.find((a) => a.user_id === p.userId);
            return (
              <li
                key={p.seat}
                className="dominio-jogador"
                data-vez={p.seat === st.turnSeat}
                data-fora={!p.ativo}
              >
                {perfil && <Avatar spec={parseAvatar(perfil.avatar)} size={30} />}
                <span
                  className="dominio-cor"
                  style={{ background: COLORS[p.cor ?? "grafite"].enamel }}
                  aria-hidden
                />
                <span
                  className={
                    (st.traidores ?? []).includes(p.seat)
                      ? "dominio-jogador-nome traidor"
                      : "dominio-jogador-nome"
                  }
                >
                  {nomePorAssento[p.seat]}
                </span>
                {/* A TRÉGUA APARECE NA MESA, e não num painel à parte. O PRD pede
                    que ela seja pública com contador: é informação de negociação,
                    e informação de negociação escondida não negocia nada. */}
                {meuAssento !== null && p.seat !== meuAssento && temTregua(p.seat) && (
                  <span className="dominio-tregua" title="trégua em vigor">
                    trégua até {st.treguas![chaveTregua(meuAssento, p.seat)]}
                  </span>
                )}
                {aguarda(p.seat) ? (
                  <span className="dominio-volta">
                    volta na rodada {st.aguardando![String(p.seat)]}
                  </span>
                ) : p.ativo ? (
                  <>
                    {ehCampanha && (
                      <span className="mono dominio-pontos">
                        {st.pontos?.[String(p.seat)] ?? 0}
                      </span>
                    )}
                    <span className="dominio-barra">
                      <span
                        style={{
                          width: `${(x.forca / maiorForca) * 100}%`,
                          background: COLORS[p.cor ?? "grafite"].enamel,
                        }}
                      />
                    </span>
                    <span className="mono dominio-jogador-num">{x.ters}</span>
                    <span className="mono dominio-jogador-cartas" title="cartas na mão">
                      {p.cartas > 0 ? `▤${p.cartas}` : ""}
                    </span>
                  </>
                ) : (
                  <span className="dominio-fora">fora</span>
                )}
              </li>
            );
          })}
        </ul>
        <p className="dim dominio-mesa-nota">
          {ehCampanha ? (
            <>
              O número em amarelo é o PLACAR. Ele soma, a cada virada de rodada: um por território,
              o dobro do bônus por continente inteiro, um por território tomado de alguém — e{" "}
              <strong>menos dois se você passou a rodada sem atacar ninguém</strong>. Cumprir o
              objetivo secreto vale vinte e acaba a partida na hora.
            </>
          ) : (
            <>
              A barra é a força total; o número é quantos territórios. A mão de cada um é pública em
              quantidade e secreta em conteúdo.
            </>
          )}
        </p>
      </div>

      <Objetivo texto={priv.objetivo?.texto ?? null} />

      <Mao
        mapa={mapa}
        cartas={priv.cartas ?? []}
        donos={st.donos}
        meuAssento={meuAssento}
        podeTrocar={minhaVez && st.phase === "reforco" && !ocupado}
        obrigado={(priv.cartas?.length ?? 0) >= 5}
        onTrocar={(ix) => void trocar(ix)}
      />

      <div className="panel dominio-continentes">
        <p className="eyebrow">Continentes</p>
        <LegendaContinentes mapa={mapa} donos={visto.donos} cores={cores} />
      </div>

      <Registro mapa={mapa} log={st.log ?? []} nomes={nomePorAssento} />
    </div>
  );
}

/* ── peças pequenas ──────────────────────────────────────────────────────── */

/**
 * O contador.
 *
 * Três formas de escolher a quantidade, porque três dedos diferentes tentam
 * três coisas: os botões de menos e mais para ajuste fino, o "tudo" para o
 * caso comum (quase sempre você quer colocar tudo num lugar só), e arrastar
 * para o meio.
 */
function Contador({
  valor,
  max,
  onMuda,
  disabled,
}: {
  valor: number;
  max: number;
  onMuda: (n: number) => void;
  disabled?: boolean;
}) {
  const preso = Math.min(Math.max(1, valor), Math.max(1, max));
  return (
    <div className="contador">
      <button
        type="button"
        className="contador-btn"
        disabled={disabled || preso <= 1}
        onClick={() => onMuda(preso - 1)}
        aria-label="Menos um"
      >
        −
      </button>
      <input
        className="contador-faixa"
        type="range"
        min={1}
        max={Math.max(1, max)}
        value={preso}
        disabled={disabled || max <= 1}
        onChange={(e) => onMuda(Number(e.target.value))}
        aria-label="Quantidade"
      />
      <span className="contador-num mono">{preso}</span>
      <button
        type="button"
        className="contador-btn"
        disabled={disabled || preso >= max}
        onClick={() => onMuda(preso + 1)}
        aria-label="Mais um"
      >
        +
      </button>
      <button
        type="button"
        className="contador-tudo"
        disabled={disabled || preso >= max}
        onClick={() => onMuda(max)}
      >
        tudo
      </button>
    </div>
  );
}

/** O registro: a partida contada em linhas curtas, a mais nova em cima. */
function Registro({
  mapa,
  log,
  nomes,
}: {
  mapa: Mapa;
  log: LinhaLog[];
  nomes: Record<number, string>;
}) {
  if (log.length === 0) return null;
  const quem = (s?: number) => (s === undefined ? "alguém" : (nomes[s] ?? `assento ${s}`));
  const onde = (id?: string) => (id ? (mapa.porId[id]?.nome ?? id) : "?");

  function frase(l: LinhaLog): string {
    switch (l.k) {
      case "reforco":
        return `${quem(l.seat)} reforçou ${onde(l.ter)} com ${l.n}`;
      case "reforco-automatico":
        return `o tempo acabou: o reforço de ${quem(l.seat)} caiu em ${onde(l.ter)}`;
      case "assalto": {
        /* A LINHA QUE CONTA O ATAQUE QUE NÃO DEU EM NADA.

           A conquista sempre teve linha; o ataque que sangra e não toma era
           invisível — e ele é metade do jogo, porque é o que explica por que
           alguém ficou fraco. As perdas somadas dizem o que a rolagem custou
           aos dois lados.

           Só o ataque SEM conquista chega aqui: quando há conquista, as
           rolagens viajam dentro da linha dela, para um ataque custar uma linha
           só do teto de 80. */
        const rodadas = l.rodadas ?? [];
        const perdeuAtac = rodadas.reduce((a, r) => a + r.perdeAtac, 0);
        const perdeuDefe = rodadas.reduce((a, r) => a + r.perdeDefe, 0);
        return (
          `${quem(l.seat)} atacou ${onde(l.para)} de ${onde(l.de)}` +
          ` — ${rodadas.length} assalto${rodadas.length === 1 ? "" : "s"},` +
          ` ${perdeuAtac} perdido${perdeuAtac === 1 ? "" : "s"} contra ${perdeuDefe}`
        );
      }
      case "conquista":
        return `${quem(l.seat)} tomou ${onde(l.para)} de ${quem(l.vitima)}`;
      case "avanco":
        return `${quem(l.seat)} mandou ${l.n} de ${onde(l.de)} para ${onde(l.para)}`;
      case "remanejo":
        return `${quem(l.seat)} moveu ${l.n} de ${onde(l.de)} para ${onde(l.para)}`;
      case "eliminado":
        return `${quem(l.seat)} está fora — ${quem(l.por)} ficou com as cartas`;
      case "troca":
        return `${quem(l.seat)} trocou cartas por ${l.vale}${l.bonus ? ` (+${l.bonus} no mapa)` : ""}`;
      case "carta":
        return `${quem(l.seat)} pegou uma carta`;
      case "vez":
        return `vez de ${quem(l.seat)}`;
      case "tempo-esgotado":
        return `${quem(l.seat)} perdeu o turno no relógio`;
      case "tregua-propoe":
        return `${quem(l.seat)} propôs trégua a ${quem(l.com)}`;
      case "tregua-aceita":
        return `${quem(l.seat)} e ${quem(l.com)} fecharam trégua até a rodada ${l.ate}`;
      case "tregua-recusa":
        return `${quem(l.seat)} recusou a trégua de ${quem(l.com)}`;
      case "tregua-rompe":
        /* A ÚNICA LINHA DO REGISTRO QUE PRECISA GRITAR. O PRD pede vermelho de
           laca, e a razão é que esta é a linha que a mesa vai lembrar. */
        return `${quem(l.seat)} ROMPEU A TRÉGUA com ${quem(l.vitima)} e atacou ${onde(l.ter)}`;
      case "tregua-multa":
        return `${quem(l.seat)} começa com ${l.n} exército(s) a menos — o preço da traição`;
      case "vitoria":
        return `${quem(l.seat)} cumpriu o objetivo`;
      case "placar":
        return "fim da rodada: o placar foi somado";
      case "zerado":
        return `${quem(l.seat)} ficou sem território — volta na próxima rodada`;
      case "volta":
        return `${quem(l.seat)} voltou ao mapa em ${onde(l.ter)}, tomado de ${quem(l.de as unknown as number)}`;
      case "objetivo-cumprido":
        return `${quem(l.seat)} cumpriu o objetivo secreto: +${l.n} pontos`;
      case "fim-rodadas":
        return `acabaram as doze rodadas: ${quem(l.seat)} venceu com ${l.n} pontos`;
      default:
        return l.k;
    }
  }

  return (
    <div className="panel dominio-log">
      <p className="eyebrow">O que aconteceu</p>
      <ol className="dominio-log-lista">
        {log.slice(0, 14).map((l, i) => (
          <li key={i} data-k={l.k}>
            {frase(l)}
          </li>
        ))}
      </ol>
    </div>
  );
}
