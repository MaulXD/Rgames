"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Abertura } from "@/components/dossie/abertura";
import { Mapa, type Peao } from "@/components/dossie/mapa";
import { Bloco } from "@/components/dossie/bloco";
import { Escolher } from "@/components/dossie/escolher";
import { Pistas } from "@/components/dossie/pistas";
import {
  TIPOS,
  tipoDaCarta,
  type Aviso,
  type IdPista,
  type IdTipo,
} from "@/lib/dossie-pistas";
import type { Pad } from "@/lib/dossie-bloco";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useSession } from "@/components/session";
import { carregaCaso, nomeDaCarta, type Caso } from "@/lib/dossie";
import type { LinhaLog } from "@/lib/dossie-bloco";
import * as sfx from "@/lib/sfx";

/**
 * A pendência da mesa: alguém esperando por outra pessoa.
 *
 * Duas formas, e o `kind` as separa. A refutação tem FILA — pergunta-se a um de
 * cada vez até alguém mostrar. O interrogatório tem ALVO — pergunta-se a uma
 * pessoa só. Escrever as duas como um objeto de campos opcionais deixaria o
 * compilador aceitar `pending.queue[pending.at]` num interrogatório, que é
 * justamente o erro que a fila ausente causa em tempo de execução.
 */
export type Pendencia =
  | { kind?: never; bySeat: number; guess: [string, string, string]; queue: number[]; at: number }
  | { kind: "interroga"; bySeat: number; alvo: number; tipo: IdTipo };

export type DossieState = {
  theme: string;
  phase: "turn" | "refute" | "interroga" | "over";
  turnSeat: number;
  actionsLeft: number;
  positions: Record<string, string>;
  weapons: Record<string, string>;
  players: { seat: number; userId: string; suspect: string; hand: number }[];
  ghosts: number[];
  accused: number[];
  pending: Pendencia | null;
  /** o baralho do Modo Avançado, ou nulo quando a mesa jogou sem ele */
  pistas?: { tirou: number } | null;
  /* ── MODO ASSASSINO ──────────────────────────────────────────────────
     O MODO é público e a PESSOA não. Todo mundo sabe que há um assassino na
     mesa — é isso que faz olhar de lado para todo mundo — e o assento dele não
     está aqui: mora no estado privado de quem é. */
  assassino?: boolean;
  /** a última rodada, quando há assassino: passou dela, ele venceu */
  rodadaFinal?: number | null;
  /** o relógio estourou antes de alguém fechar o caso */
  assassinoVenceu?: boolean;
  /** o assento que joga a próxima vez com uma ação só */
  tempoCurto?: number | null;
  seq: number;
  round?: number;
  log: LinhaLog[];
  winner?: number | null;
  solution?: { suspect: string; weapon: string; room: string };
  /**
   * A reviravolta do caso, ou nulo quando ele joga limpo — o Solar das Acácias
   * e toda mesa que desligou a regra. Congelada no início da partida.
   */
  twist?: {
    id: "apagao" | "tempestade" | "registro";
    round?: number;
    fired?: boolean;
    active?: boolean;
    fechados?: string[];
    aviso?: string[];
    publicados?: string[];
  } | null;
};


export type DossieMatch = {
  id: string;
  status: string;
  turn_deadline: string | null;
  public_state: DossieState;
};

type Privado = {
  hand: string[];
  seen: { card: string; from: number | null; seq: number }[];
  pad?: Pad;
  /** a mão de Cartas de Pista e o que elas já contaram */
  pistas?: { mao?: string[]; avisos?: Aviso[] };
  /** você é o assassino — e o envelope veio junto */
  assassino?: boolean;
  envelope?: { suspect: string; weapon: string; room: string };
};

export function DossieGame({
  match,
  assentos,
  onSair,
}: {
  match: DossieMatch;
  assentos: { user_id: string; display_name: string; avatar: unknown; is_bot?: boolean }[];
  onSair: () => void;
}) {
  const { user } = useSession();
  const st = match.public_state;
  const [caso, setCaso] = useState<Caso | null>(null);
  const [priv, setPriv] = useState<Privado>({
    hand: [],
    seen: [],
    pad: { marks: {}, assist: "assistido" },
  });
  const [abriu, setAbriu] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [palpite, setPalpite] = useState<{ s?: string; w?: string } | null>(null);
  const [acusa, setAcusa] = useState<{ s?: string; w?: string; r?: string } | null>(null);
  const ultimoSeq = useRef(0);

  const mudo = useSyncExternalStore(sfx.subscribe, sfx.getSnapshot, sfx.getServerSnapshot);

  const meuAssento = st.players.find((p) => p.userId === user?.id)?.seat ?? null;
  const minhaVez = meuAssento !== null && st.turnSeat === meuAssento && st.phase === "turn";
  const souFantasma = meuAssento !== null && st.ghosts.includes(meuAssento);
  const jaAcusei = meuAssento !== null && st.accused.includes(meuAssento);
  /* AS DUAS FORMAS DA PENDÊNCIA, cada uma num nome.

     A refutação tem FILA — pergunta-se a um de cada vez. O interrogatório tem
     ALVO — pergunta-se a uma pessoa só. `st.pending!.queue` compilava com as
     duas juntas e quebraria em tempo de execução no dia em que a pendência
     fosse a outra; separar aqui, uma vez, faz o compilador cobrar a distinção
     em todo lugar que as usa. */
  const refutacao = st.pending?.kind !== "interroga" ? (st.pending ?? null) : null;
  const interrogatorio = st.pending?.kind === "interroga" ? st.pending : null;

  const devoRefutar =
    st.phase === "refute" &&
    !!refutacao &&
    refutacao.queue[refutacao.at] === meuAssento;

  /* Perguntaram A MIM, e a mesa inteira está parada esperando. */
  const devoResponder = st.phase === "interroga" && interrogatorio?.alvo === meuAssento;

  /* ── a máquina joga, um passo por vez ─────────────────────────

     No Dossiê o respiro tem um papel a mais que nos outros dois jogos: aqui o
     que acontece na mesa É a informação. Quem palpitou, quem refutou, quem
     passou — cada uma dessas linhas é uma dedução possível para quem está
     assistindo. Uma máquina que palpita, ouve três respostas e passa a vez em
     duzentos milissegundos rouba do humano exatamente aquilo que o jogo é.

     Por isso 1300ms, mais que os 900 da Metrópole: aqui a pausa não é para ver
     bonito, é para ANOTAR. */
  const idsBot = useMemo(
    () => new Set(assentos.filter((a) => a.is_bot).map((a) => a.user_id)),
    [assentos],
  );
  const temMaquina = st.players.some((p) => idsBot.has(p.userId));
  const maquinaNaVez = st.players.some(
    (p) => p.seat === st.turnSeat && idsBot.has(p.userId),
  );
  const maquinaRefutando =
    st.phase === "refute" &&
    !!refutacao &&
    st.players.some(
      (p) => p.seat === refutacao.queue[refutacao.at] && idsBot.has(p.userId),
    );

  /* Interrogaram uma máquina. Sem este ramo o cliente não a cutuca, e a mesa
     espera os noventa segundos da faxina por uma resposta que a máquina daria
     na hora — a carta viraria castigo de quem a jogou. */
  const maquinaRespondendo =
    st.phase === "interroga" &&
    !!interrogatorio &&
    st.players.some((p) => p.seat === interrogatorio.alvo && idsBot.has(p.userId));

  const tocando = useRef(false);
  const falhasBot = useRef(0);
  const [maquinaEmpacou, setMaquinaEmpacou] = useState(false);
  /* ── QUANTO CADA MÁQUINA JÁ SABIA ──────────────────────────────

     Jogando com gente, a pergunta "eu estava perto?" se responde sozinha: a mesa
     comenta, alguém diz "eu já sabia da corda na rodada quatro". Sozinho, o caso
     fecha em silêncio.

     O servidor só conta depois que a partida acabou, e só a CONTAGEM — ver 0067.
     A lista de cartas dela continua sendo dela. */
  const [deducoes, setDeducoes] = useState<
    { seat: number; nome: string; riscadas: number }[] | null
  >(null);
  // o mesmo contador do Domínio, pelo mesmo motivo: sem ele a primeira falha
  // parava a corrente e a tela nunca oferecia o botão
  const [tique, setTique] = useState(0);
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
      const { data, error } = await supabaseBrowser().rpc("dossie_tocar", {
        p_match: match.id,
      });
      if (error) {
        const msg = (error as { message?: string }).message ?? "";
        if (/MATCH_NOT_RUNNING/.test(msg)) return;
        falhasBot.current += 1;
        if (falhasBot.current >= 3) setMaquinaEmpacou(true);
        else setTique((t) => t + 1);
        return;
      }
      falhasBot.current = 0;
      seguidos.current += 1;
      if (seguidos.current > TETO_PASSOS) setMaquinaEmpacou(true);
      else setTique((t) => t + 1);
      /* O RÓTULO DO PASSO NÃO VAI PARA A TELA AQUI, e a Metrópole leva.
         Lá ele conta o que ninguém mais contaria ("comprou o Ver-o-Peso"); no
         Dossiê o registro da mesa JÁ conta tudo que é público, linha por linha, e
         é dele que a pessoa deduz. Repetir seria ruído no lugar onde a atenção
         mais importa. */
      void data;
    } finally {
      tocando.current = false;
    }
  }, [match.id]);

  useEffect(() => {
    if (minhaVez || devoRefutar || devoResponder) seguidos.current = 0;   // voltou para gente: zera
    if (!temMaquina || st.phase === "over" || maquinaEmpacou) return;
    if (!maquinaNaVez && !maquinaRefutando && !maquinaRespondendo) return;
    // o setState mora dentro do temporizador
    const id = setTimeout(() => void tocarMaquina(), 1300);
    return () => clearTimeout(id);
  }, [
    temMaquina,
    maquinaNaVez,
    maquinaRefutando,
    maquinaRespondendo,
    maquinaEmpacou,
    tocarMaquina,
    st.phase,
    st.turnSeat,
    st.seq,
    tique,
    minhaVez,
    devoResponder,
    devoRefutar,
  ]);

  useEffect(() => {
    let vivo = true;
    void carregaCaso(st.theme).then((c) => vivo && setCaso(c));
    return () => {
      vivo = false;
    };
  }, [st.theme]);

  // a mao e as cartas vistas sao relidas a cada avanco do log (st.seq): uma
  // refutacao pode ter acabado de escrever no meu estado privado.
  useEffect(() => {
    let vivo = true;
    async function puxa() {
      const sb = supabaseBrowser();
      const { data } = await sb
        .from("match_private_state")
        .select("data")
        .eq("match_id", match.id)
        .maybeSingle();
      if (!vivo) return;
      const d = (data as { data?: Privado } | null)?.data;
      if (d) {
        setPriv({
          hand: d.hand ?? [],
          seen: d.seen ?? [],
          pad: d.pad?.marks ? d.pad : { marks: {}, assist: d.pad?.assist ?? "assistido" },
          pistas: d.pistas ?? { mao: [], avisos: [] },
          assassino: d.assassino,
          envelope: d.envelope,
        });
      }
    }
    void puxa();
    return () => {
      vivo = false;
    };
  }, [match.id, st.seq]);

  // som conforme o log anda
  useEffect(() => {
    const nova = st.log?.[0];
    if (!nova || nova.seq <= ultimoSeq.current) return;
    ultimoSeq.current = nova.seq;
    if (nova.type === "move") {
      const lugar = caso?.rooms.find((r) => r.id === nova.room);
      sfx.passo(lugar?.piso ?? "madeira");
    } else if (nova.type === "suggest") sfx.porta();
    else if (nova.type === "refute") sfx.carta();
    else if (nova.type === "no_refute") sfx.sino();
    else if (nova.type === "accuse") (nova.right ? sfx.caso : sfx.fantasma)();
  }, [st.log, caso]);

  useEffect(() => {
    if (st.phase === "over") sfx.paraTrilha();
  }, [st.phase]);

  async function chama(fn: string, args: Record<string, unknown>) {
    setErro(null);
    const { error } = await supabaseBrowser().rpc(fn, args);
    if (error) setErro(traduz(error.message));
  }

  /* Este efeito vive ACIMA dos retornos antecipados: hook depois de `return`
     roda em ordem diferente entre renderizações, e o React proíbe — com razão. */
  useEffect(() => {
    if (st.phase !== "over" || deducoes !== null) return;
    let vivo = true;
    void supabaseBrowser()
      .rpc("dossie_deducoes", { p_match: match.id })
      .then(({ data }: { data: unknown }) => {
        if (!vivo) return;
        const d = data as { maquinas?: { seat: number; nome: string; riscadas: number }[] } | null;
        if (d?.maquinas?.length) setDeducoes(d.maquinas);
      });
    return () => {
      vivo = false;
    };
  }, [st.phase, match.id, deducoes]);

  if (!caso) return <p className="eyebrow py-16">Abrindo o dossiê…</p>;

  if (!abriu && st.phase !== "over") {
    return (
      <Abertura caso={caso} reviravolta={!!st.twist} onFim={() => setAbriu(true)} />
    );
  }

  const peoes: Peao[] = st.players.map((p) => {
    const a = assentos.find((x) => x.user_id === p.userId);
    return {
      seat: p.seat,
      userId: p.userId,
      nome: a?.display_name ?? "Convidado",
      avatar: a?.avatar,
      suspeito: p.suspect,
      fantasma: st.ghosts.includes(p.seat),
    };
  });

  const euEstouEm = meuAssento !== null ? st.positions[String(meuAssento)] : undefined;
  const daVez = peoes.find((p) => p.seat === st.turnSeat);
  const focoDoPalpite = refutacao ? refutacao.guess[2] : null;

  /* ── O QUE A REVIRAVOLTA ESTÁ FAZENDO AGORA ─────────────────────────

     Nulo quando não há nada acontecendo, que é a maior parte do tempo — uma
     faixa permanente dizendo "este caso tem Apagão" viraria móvel da tela em
     duas rodadas, e ninguém leria quando a luz caísse de verdade.

     O Registro não entra aqui: ele é um fato que acontece UMA vez e vale para
     sempre, e o lugar de um fato desses é o registro da mesa e o bloco de
     dedução, onde ele já vira uma carta riscada. Faixa é para o que muda o que
     você pode FAZER neste turno. */
  const aviso = ((): { tipo: string; texto: string } | null => {
    const t = st.twist;
    if (!t || !caso) return null;
    if (t.id === "apagao" && t.active) {
      return {
        tipo: "apagao",
        texto:
          "A luz caiu. Nesta rodada você vê a carta que te mostrarem, mas não de quem é.",
      };
    }
    const nomes = (ids?: string[]) =>
      (ids ?? []).map((r) => nomeDaCarta(caso, r)).join(" e ");
    if (t.fechados?.length) {
      const preso = !!euEstouEm && t.fechados.includes(euEstouEm);
      return {
        tipo: "tempestade",
        texto: preso
          ? `A areia fechou ${nomes(t.fechados)}. Você está preso — mas continua podendo palpitar.`
          : `A areia fechou ${nomes(t.fechados)}. Ninguém entra, ninguém sai.`,
      };
    }
    if (t.aviso?.length) {
      return {
        tipo: "vento",
        texto: `O vento está virando: ${nomes(t.aviso)} fecham na próxima rodada.`,
      };
    }
    return null;
  })();

  return (
    <div className="dossie">
      {/* ── cabeçalho ─────────────────────────────────────────────────── */}
      <div className="dossie-head">
        <div>
          <p className="eyebrow">
            {caso.name} · {caso.era}
          </p>
          <h1 className="dossie-titulo">
            {st.phase === "over"
              ? st.assassinoVenceu
                ? "O assassino escapou"
                : st.winner === null
                  ? "Ninguém fechou o caso"
                  : "Caso encerrado"
              : devoRefutar
                ? "Você precisa responder"
                : minhaVez
                  ? "Sua vez"
                  : `Vez de ${daVez?.nome ?? "…"}`}
          </h1>
          {st.phase === "turn" && minhaVez && (
            <p className="dossie-acoes">
              {st.actionsLeft} {st.actionsLeft === 1 ? "ação" : "ações"} nesta rodada
            </p>
          )}
          {/* O RELÓGIO DO ASSASSINO, à vista desde a primeira rodada.

              Um limite que só aparece quando estoura é armadilha, não regra —
              e a tensão do modo é justamente ver o número subir. */}
          {st.assassino && st.phase !== "over" && (
            <p className="dossie-acoes dossie-relogio">
              rodada {st.round ?? 1} de {st.rodadaFinal ?? 12}
            </p>
          )}
          {(maquinaNaVez || maquinaRefutando || maquinaRespondendo) &&
            !minhaVez && !devoRefutar && !devoResponder &&
            st.phase !== "over" && !maquinaEmpacou && (
            <p className="dossie-acoes dossie-pensando">
              <span className="pensa-pontos" aria-hidden>
                <i />
                <i />
                <i />
              </span>
              {maquinaRefutando
                ? "conferindo a mão"
                : maquinaRespondendo
                  ? "procurando na mão"
                  : "pensando"}
            </p>
          )}
          {maquinaEmpacou && st.phase !== "over" && (
            <button
              type="button"
              className="btn btn-ghost btn-mini"
              onClick={() => {
                falhasBot.current = 0;
                setMaquinaEmpacou(false);
              }}
            >
              a máquina empacou · tentar de novo
            </button>
          )}
        </div>
        <button
          type="button"
          className="som"
          aria-pressed={mudo}
          aria-label={mudo ? "Ligar som" : "Desligar som"}
          onClick={() => {
            sfx.arm();
            sfx.toggleMuted();
            if (!sfx.isMuted()) sfx.iniciaTrilha(caso.clima ?? "misterio");
          }}
        >
          {mudo ? "✕" : "♪"}
        </button>
      </div>

      {/* ── desfecho ──────────────────────────────────────────────────── */}
      {st.phase === "over" && st.solution && (
        <div className="panel dossie-desfecho">
          <p className="eyebrow">{st.assassinoVenceu ? "O relógio acabou. Era" : "Era"}</p>
          <p className="desfecho-linha">{nomeDaCarta(caso, st.solution.suspect)}</p>
          <p className="desfecho-com">com {nomeDaCarta(caso, st.solution.weapon)}</p>
          <p className="desfecho-onde">na {nomeDaCarta(caso, st.solution.room)}</p>
          {caso.encerramento && <p className="desfecho-nota">{caso.encerramento}</p>}

          {deducoes && deducoes.length > 0 && (
            <div className="desfecho-sabia">
              <p className="eyebrow">O que elas já sabiam</p>
              <ul>
                {deducoes.map((d) => (
                  <li key={d.seat}>
                    <span>{d.nome}</span>
                    <span className="mono">
                      {d.riscadas} {d.riscadas === 1 ? "carta riscada" : "cartas riscadas"}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="desfecho-sabia-nota dim">
                Riscada é carta que ela provou não estar no envelope. Compare com o seu
                bloco — é aí que dá para ver se faltou pouco.
              </p>
            </div>
          )}
          <button className="btn btn-brass mt-4 w-full" onClick={onSair}>
            Voltar para a sala
          </button>
        </div>
      )}

      {/* ── A REVIRAVOLTA DO CASO, quando ela está acontecendo ────────────

           Uma faixa só, acima do mapa, e só quando há o que dizer. A regra não
           precisa de painel: precisa de aviso no instante em que muda o que
           você pode fazer.

           O registro da mesa conta a história completa logo abaixo; esta faixa
           existe porque quem está no meio de um turno não lê o log, olha o
           tabuleiro. */}
      {aviso && (
        <p className="dossie-reviravolta" data-tipo={aviso.tipo}>
          {aviso.texto}
        </p>
      )}

      <Mapa
        caso={caso}
        posicoes={st.positions}
        objetos={st.weapons}
        peoes={peoes}
        euEstouEm={euEstouEm}
        destaque={focoDoPalpite}
        alcancaveis={minhaVez && st.actionsLeft > 0 && !souFantasma}
        fechados={st.twist?.fechados}
        aviso={st.twist?.aviso}
        onEscolher={(lugar) =>
          void chama("dossie_move", { p_match: match.id, p_room: lugar })
        }
      />

      {/* ── bloco de dedução ─────────────────────────────────────────────
           Fica aberto durante TODO o tempo, inclusive no turno dos outros —
           é isso que mata o tempo morto do Detetive. */}
      <Bloco
        caso={caso}
        log={st.log ?? []}
        mao={priv.hand}
        vistas={priv.seen}
        jogadores={st.players.map((p) => ({ seat: p.seat, userId: p.userId, hand: p.hand }))}
        nomes={Object.fromEntries(peoes.map((p) => [p.seat, p.nome]))}
        meuAssento={meuAssento}
        pad={priv.pad ?? { marks: {}, assist: "assistido" }}
        avisos={priv.pistas?.avisos ?? []}
        onPad={(novo) => {
          setPriv((a) => ({ ...a, pad: novo }));
          void supabaseBrowser().rpc("dossie_pad", { p_match: match.id, p_pad: novo });
        }}
      />

      {/* ── VOCÊ É O ASSASSINO ─────────────────────────────────────────────
           O envelope fica à vista o tempo todo, e não escondido atrás de um
           toque: quem é o assassino precisa dele em cada decisão — para onde
           andar, o que palpitar, o que deixar a mesa acreditar.

           A frase que importa é a última. "Vença deixando o relógio acabar" é a
           regra inteira do lado dele, e é o oposto do que o resto da mesa está
           tentando fazer. */}
      {priv.assassino && priv.envelope && st.phase !== "over" && (
        <div className="panel dossie-assassino">
          <p className="eyebrow">Foi você</p>
          <p className="assassino-linha">{nomeDaCarta(caso, priv.envelope.suspect)}</p>
          <p className="assassino-com">
            com {nomeDaCarta(caso, priv.envelope.weapon)} · na{" "}
            {nomeDaCarta(caso, priv.envelope.room)}
          </p>
          <p className="mt-3 text-sm dim">
            Ninguém sabe que é você. Você não pode fechar o caso — vence deixando as{" "}
            {st.rodadaFinal ?? 12} rodadas acabarem sem que ninguém acerte.
          </p>
        </div>
      )}

      {/* ── responder ao interrogatório ───────────────────────────────────
           Fica ACIMA da refutação porque as duas nunca acontecem juntas — as
           fases se excluem — e porque esta é a que trava a mesa inteira num
           relógio de trinta segundos. */}
      {devoResponder && interrogatorio && (
        <div className="panel dossie-refuta">
          <p className="eyebrow">
            {peoes.find((x) => x.seat === interrogatorio.bySeat)?.nome ?? "Alguém"} interrogou você
          </p>
          {(() => {
            const doTipo = priv.hand.filter((c) => tipoDaCarta(caso, c) === interrogatorio.tipo);
            const nome = TIPOS.find((t) => t.id === interrogatorio.tipo)?.nome ?? "uma carta";
            if (doTipo.length === 0) {
              return (
                <>
                  <p className="mt-2 text-sm dim">
                    Pediram {nome}, e você não tem nenhum. Diga isso — o servidor confere, e a
                    mesa inteira fica sabendo.
                  </p>
                  <button
                    className="btn btn-ghost mt-3"
                    onClick={() =>
                      void chama("dossie_passa_interroga", { p_match: match.id })
                    }
                  >
                    Não tenho nenhum
                  </button>
                </>
              );
            }
            return (
              <>
                <p className="mt-2 text-sm dim">
                  Pediram {nome}. Escolha qual mostrar — só quem perguntou vê a carta.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {doTipo.map((c) => (
                    <button
                      key={c}
                      className="btn btn-brass"
                      onClick={() =>
                        void chama("dossie_responde_interroga", {
                          p_match: match.id,
                          p_card: c,
                        })
                      }
                    >
                      {nomeDaCarta(caso, c)}
                    </button>
                  ))}
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* ── refutação ─────────────────────────────────────────────────── */}
      {devoRefutar && refutacao && (
        <div className="panel dossie-refuta">
          <p className="eyebrow">Alguém acusou</p>
          <p className="refuta-palpite">
            {refutacao.guess.map((c) => nomeDaCarta(caso, c)).join(" · ")}
          </p>
          {(() => {
            const posso = priv.hand.filter((c) => refutacao.guess.includes(c));
            if (posso.length === 0) {
              return (
                <>
                  <p className="mt-2 text-sm dim">
                    Você não tem nenhuma dessas três. Diga isso na mesa — o servidor confere.
                  </p>
                  <button
                    className="btn btn-ghost mt-4 w-full"
                    onClick={() => void chama("dossie_pass_refute", { p_match: match.id })}
                  >
                    Não posso refutar
                  </button>
                </>
              );
            }
            return (
              <>
                <p className="mt-2 text-sm dim">
                  Escolha qual mostrar. Só quem acusou vê a carta — a mesa vê apenas que você
                  mostrou algo.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {posso.map((c) => (
                    <button
                      key={c}
                      className="btn btn-brass"
                      onClick={() => void chama("dossie_refute", { p_match: match.id, p_card: c })}
                    >
                      {nomeDaCarta(caso, c)}
                    </button>
                  ))}
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* ── ações do turno ────────────────────────────────────────────── */}
      {minhaVez && !souFantasma && (
        <div className="panel dossie-acoes-painel">
          <div className="flex flex-wrap gap-2">
            <button
              className="btn btn-brass"
              disabled={st.actionsLeft < 1 || !euEstouEm}
              onClick={() => setPalpite({})}
            >
              Acusar aqui
            </button>
            <button
              className="btn btn-ghost"
              disabled={jaAcusei}
              onClick={() => setAcusa({})}
              title={jaAcusei ? "Você já fechou o caso uma vez" : undefined}
            >
              Fechar o caso
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => void chama("dossie_end_turn", { p_match: match.id })}
            >
              Passar a vez
            </button>
          </div>
          <p className="mt-3 text-sm dim">
            Mover custa uma ação — toque num lugar aceso. Acusar custa uma e encerra seu turno.
            Fechar o caso é de graça, e só uma vez na partida.
          </p>
        </div>
      )}

      {souFantasma && st.phase !== "over" && (
        <div className="panel dossie-fantasma">
          <p className="eyebrow">Fantasma</p>
          <p className="mt-2 text-sm dim">
            Você errou a acusação. Não joga mais turno e não pode vencer — mas continua sendo
            consultado nas refutações, e sem você o jogo perderia informação.
          </p>
        </div>
      )}

      {/* ── minha mão ─────────────────────────────────────────────────── */}
      <div className="panel dossie-mao">
        <p className="eyebrow">Sua mão · {priv.hand.length} cartas</p>
        <div className="mao">
          {priv.hand.map((c, i) => (
            <span
              key={c}
              className="carta"
              style={{ ["--gir" as string]: `${(i - (priv.hand.length - 1) / 2) * 3.2}deg` }}
            >
              {nomeDaCarta(caso, c)}
            </span>
          ))}
        </div>
        {priv.seen.length > 0 && (
          <>
            <p className="eyebrow mt-4">Mostraram para você</p>
            <div className="mao">
              {priv.seen.map((s, i) => (
                <span key={`${s.card}-${i}`} className="carta carta-vista">
                  {nomeDaCarta(caso, s.card)}
                  <em>
                    {s.from === null
                      ? "alguém"
                      : (peoes.find((p) => p.seat === s.from)?.nome ?? `assento ${s.from}`)}
                  </em>
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Cartas de Pista ───────────────────────────────────────────────
           Só quando a mesa ligou o Modo Avançado. `st.pistas` nulo não é zero
           cartas tiradas: é uma mesa que escolheu jogar sem o baralho, e para
           ela este painel não existe. */}
      {st.pistas != null && meuAssento !== null && (
        <Pistas
          caso={caso}
          mao={priv.pistas?.mao ?? []}
          avisos={priv.pistas?.avisos ?? []}
          minhaVez={minhaVez && !souFantasma}
          devoRefutar={devoRefutar}
          acoesRestantes={st.actionsLeft}
          sozinhoAqui={
            !!euEstouEm &&
            !st.players.some(
              (o) => o.seat !== meuAssento && st.positions[String(o.seat)] === euEstouEm,
            )
          }
          jogadores={peoes.map((x) => ({ seat: x.seat, nome: x.nome }))}
          meuAssento={meuAssento}
          lugares={caso.rooms.map((r) => ({ id: r.id, name: r.name }))}
          onInvestigar={() => void chama("dossie_investigar", { p_match: match.id })}
          onUsar={(cartaId: IdPista, arg: Record<string, unknown>) =>
            void chama("dossie_usar_pista", {
              p_match: match.id,
              p_carta: cartaId,
              p_arg: arg,
            })
          }
        />
      )}

      {/* ── log narrado ───────────────────────────────────────────────── */}
      <div className="panel dossie-log">
        <p className="eyebrow">Investigação</p>
        <ol aria-live="polite">
          {(st.log ?? []).map((l) => (
            <li key={l.seq} data-tipo={l.type}>
              {narra(l, caso, peoes)}
            </li>
          ))}
        </ol>
      </div>

      {erro && <p className="flash" data-kind="bad">{erro}</p>}

      {/* ── caixa de palpite ──────────────────────────────────────────── */}
      {palpite && (
        <Escolher
          titulo="Quem, com o quê?"
          nota={`Aqui: ${nomeDaCarta(caso, euEstouEm ?? "")}. O suspeito e o objeto vêm para cá.`}
          grupos={[
            { rotulo: "Suspeito", itens: caso.suspects, sel: palpite.s, set: (v) => setPalpite({ ...palpite, s: v }) },
            { rotulo: "Objeto", itens: caso.weapons, sel: palpite.w, set: (v) => setPalpite({ ...palpite, w: v }) },
          ]}
          pronto={!!palpite.s && !!palpite.w}
          onConfirmar={() => {
            void chama("dossie_suggest", {
              p_match: match.id,
              p_suspect: palpite.s,
              p_weapon: palpite.w,
            });
            setPalpite(null);
          }}
          onFechar={() => setPalpite(null)}
          rotuloBotao="Acusar"
        />
      )}

      {/* ── caixa de acusação final ───────────────────────────────────── */}
      {acusa && (
        <Escolher
          titulo="Fechar o caso"
          nota="Uma vez por partida. Se errar, você vira Fantasma e não pode mais vencer."
          grupos={[
            { rotulo: "Suspeito", itens: caso.suspects, sel: acusa.s, set: (v) => setAcusa({ ...acusa, s: v }) },
            { rotulo: "Objeto", itens: caso.weapons, sel: acusa.w, set: (v) => setAcusa({ ...acusa, w: v }) },
            { rotulo: "Lugar", itens: caso.rooms, sel: acusa.r, set: (v) => setAcusa({ ...acusa, r: v }) },
          ]}
          pronto={!!acusa.s && !!acusa.w && !!acusa.r}
          onConfirmar={() => {
            void chama("dossie_accuse", {
              p_match: match.id,
              p_suspect: acusa.s,
              p_weapon: acusa.w,
              p_room: acusa.r,
            });
            setAcusa(null);
          }}
          onFechar={() => setAcusa(null)}
          rotuloBotao="Fechar o caso"
          perigo
        />
      )}
    </div>
  );
}

/* ── o log, na voz do caso ─────────────────────────────────────────────── */

function narra(l: LinhaLog, caso: Caso, peoes: Peao[]): string {
  const quem = (s?: number | null) =>
    s === null || s === undefined
      ? "Alguém"
      : (peoes.find((p) => p.seat === s)?.nome ?? `Assento ${s}`);

  switch (l.type) {
    case "move":
      return `${quem(l.seat)} foi para ${nomeDaCarta(caso, l.room ?? "")}.`;
    case "suggest":
      return `${quem(l.seat)} ${caso.copy?.suggest ?? "acusou"} ${nomeDaCarta(caso, l.guess?.[0] ?? "")}, com ${nomeDaCarta(caso, l.guess?.[1] ?? "")}, ${nomeDaCarta(caso, l.guess?.[2] ?? "")}.`;
    case "refute":
      /* No apagão o servidor manda `seat: null`, e `quem()` já responde
         "Alguém" — a frase sai certa sem um ramo próprio. O `anon` existe para
         a frase poder DIZER que foi no escuro, que é diferente de uma máquina
         anônima por acaso. */
      return l.anon
        ? "Alguém desmentiu, no escuro."
        : `${quem(l.seat)} mostrou uma carta.${l.auto ? " (tempo esgotado)" : ""}`;
    case "apagao":
      return "A luz caiu. Nesta rodada, ninguém vai saber quem desmentiu.";
    case "luz":
      return "A luz voltou.";
    case "vento":
      return `O vento está virando. ${(l.rooms ?? []).map((r) => nomeDaCarta(caso, r)).join(" e ")} fecham na próxima rodada.`;
    case "tempestade":
      return `A areia fechou ${(l.rooms ?? []).map((r) => nomeDaCarta(caso, r)).join(" e ")}. Ninguém entra, ninguém sai.`;
    case "registro":
      return `Registro da estação: ${nomeDaCarta(caso, l.card ?? "")} não está no envelope.`;
    case "pass":
      return `${quem(l.seat)} não pôde refutar.`;
    case "no_refute":
      return caso.copy?.noRefute ?? "Ninguém pôde refutar.";
    case "accuse":
      return l.right
        ? `${quem(l.seat)} fechou o caso — e acertou.`
        : `${quem(l.seat)} acusou e errou. Virou Fantasma.`;

    /* ── Modo Avançado ────────────────────────────────────────────────────
       Todas estas frases dizem O QUE ACONTECEU sem dizer o que foi
       descoberto. É a mesma linha que separa "mostrou uma carta" de "mostrou
       a corda", e ela vale para as pistas inteiras: a carta comprada é de
       quem comprou, e a resposta da impressão digital é de quem a jogou. */
    case "investiga":
      return `${quem(l.seat)} vasculhou ${nomeDaCarta(caso, l.room ?? "")} e guardou o que achou.`;
    case "alibi":
      return `${quem(l.seat)} apresentou um álibi e não precisou mostrar nada.`;
    case "interroga_ok":
      return `${quem(l.seat)} mostrou uma carta no interrogatório.`;
    case "interroga_nada":
      return `${quem(l.seat)} não tem ${nomeDoTipo(l.tipo)} — nenhum.`;
    case "pista":
      return narraPista(l, caso, quem);
  }
}

/** O nome de um tipo na frase da mesa. */
function nomeDoTipo(id?: string): string {
  return TIPOS.find((t) => t.id === id)?.nome ?? "essa carta";
}

/**
 * A frase de uma Carta de Pista jogada.
 *
 * Cada uma conta exatamente o que a mesa viu, e nem uma vírgula a mais: a
 * impressão digital diz QUAIS dois nomes, e nunca a resposta; o recado diz que
 * saiu, e nunca para quem. É o que dá preço às cartas — quem as joga paga
 * anunciando onde está procurando.
 */
function narraPista(
  l: LinhaLog,
  caso: Caso,
  quem: (s?: number | null) => string,
): string {
  switch (l.carta) {
    case "chave-mestra":
      return `${quem(l.seat)} abriu uma porta e apareceu em ${nomeDaCarta(caso, l.room ?? "")}.`;
    case "tempo-curto":
      return `${quem(l.seat)} apertou o relógio: ${quem(l.alvo)} joga a próxima vez com uma ação só.`;
    case "impressao":
      return `${quem(l.seat)} comparou uma impressão com ${nomeDaCarta(caso, l.a ?? "")} e ${nomeDaCarta(caso, l.b ?? "")}. A resposta é só dele.`;
    case "recado":
      return `${quem(l.seat)} deixou um recado anônimo. Ninguém viu para quem.`;
    case "interrogatorio":
      return `${quem(l.seat)} interrogou ${quem(l.alvo)}: quer ver ${nomeDoTipo(l.tipo)}.`;
    default:
      return `${quem(l.seat)} jogou uma carta de pista.`;
  }
}

/* Nas frases acima o nome genérico basta, porque cada uma já descreve o efeito
   por extenso. Onde o nome do caso importa é na FICHA, que a pessoa lê antes de
   decidir — e é lá que `nomeDaPista` entra. */

function traduz(msg: string): string {
  if (/NOT_YOUR_TURN/.test(msg)) return "Não é a sua vez.";
  if (/NO_ACTIONS/.test(msg)) return "Você já gastou as duas ações.";
  if (/UNREACHABLE/.test(msg)) return "Não dá para chegar lá em um movimento.";
  if (/NOT_IN_A_ROOM/.test(msg)) return "Você precisa estar num lugar para acusar.";
  if (/YOU_MUST_REFUTE/.test(msg)) return "Você tem uma das cartas — precisa mostrar.";
  if (/NOT_IN_HAND/.test(msg)) return "Essa carta não está na sua mão.";
  if (/NOT_IN_GUESS/.test(msg)) return "Essa carta não é uma das três acusadas.";
  if (/ALREADY_ACCUSED/.test(msg)) return "Você já fechou o caso uma vez.";
  if (/NOT_YOUR_REFUTE/.test(msg)) return "Ainda não é a sua vez de responder.";

  /* Modo Avançado */
  if (/SEM_PISTAS/.test(msg)) return "Esta mesa está jogando sem as Cartas de Pista.";
  if (/LUGAR_COM_GENTE/.test(msg))
    return "Só se investiga um lugar onde mais ninguém está.";
  if (/BARALHO_VAZIO/.test(msg)) return "O baralho de pistas acabou.";
  if (/PISTA_NAO_ESTA_NA_MAO/.test(msg)) return "Essa carta de pista não está na sua mão.";
  if (/ROOM_CLOSED/.test(msg)) return "Esse lugar está fechado.";
  if (/DOIS_NOMES_IGUAIS/.test(msg)) return "Nomeie dois suspeitos diferentes.";
  if (/SUSPEITO_NAO_EXISTE/.test(msg)) return "Esse suspeito não é do caso.";
  if (/RECADO_SEM_NOVIDADE/.test(msg))
    return "Não sobrou nada que essa pessoa ainda não saiba. A carta continua na sua mão.";
  if (/ALVO_NAO_ESTA_NA_MESA/.test(msg)) return "Essa pessoa não está na mesa.";
  if (/NAO_SE_INTERROGA_SOZINHO/.test(msg)) return "Escolha outra pessoa.";
  if (/NAO_PERGUNTARAM_A_VOCE/.test(msg)) return "A pergunta não foi para você.";
  if (/CARTA_DE_OUTRO_TIPO/.test(msg)) return "Pediram outro tipo de carta.";
  if (/YOU_MUST_SHOW/.test(msg)) return "Você tem uma carta desse tipo — precisa mostrar.";
  if (/NADA_PARA_RESPONDER/.test(msg)) return "Não há interrogatório aberto.";
  if (/NADA_PARA_REFUTAR/.test(msg)) return "Não há nada para refutar agora.";
  if (/WRONG_PHASE/.test(msg)) return "Agora não dá — a mesa está esperando outra coisa.";
  return msg;
}

