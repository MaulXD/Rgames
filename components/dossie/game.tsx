"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Abertura } from "@/components/dossie/abertura";
import { Mapa, type Peao } from "@/components/dossie/mapa";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useSession } from "@/components/session";
import { carregaCaso, nomeDaCarta, type Caso } from "@/lib/dossie";
import * as sfx from "@/lib/sfx";

export type DossieState = {
  theme: string;
  phase: "turn" | "refute" | "over";
  turnSeat: number;
  actionsLeft: number;
  positions: Record<string, string>;
  weapons: Record<string, string>;
  players: { seat: number; userId: string; suspect: string; hand: number }[];
  ghosts: number[];
  accused: number[];
  pending: { bySeat: number; guess: [string, string, string]; queue: number[]; at: number } | null;
  seq: number;
  log: LinhaLog[];
  winner?: number | null;
  solution?: { suspect: string; weapon: string; room: string };
};

type LinhaLog = {
  seq: number;
  type: "move" | "suggest" | "refute" | "pass" | "no_refute" | "accuse";
  seat?: number | null;
  room?: string;
  guess?: string[];
  right?: boolean;
  auto?: boolean;
};

export type DossieMatch = {
  id: string;
  status: string;
  turn_deadline: string | null;
  public_state: DossieState;
};

type Privado = { hand: string[]; seen: { card: string; from: number | null; seq: number }[] };

export function DossieGame({
  match,
  assentos,
  onSair,
}: {
  match: DossieMatch;
  assentos: { user_id: string; display_name: string; avatar: unknown }[];
  onSair: () => void;
}) {
  const { user } = useSession();
  const st = match.public_state;
  const [caso, setCaso] = useState<Caso | null>(null);
  const [priv, setPriv] = useState<Privado>({ hand: [], seen: [] });
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
  const devoRefutar =
    st.phase === "refute" &&
    !!st.pending &&
    st.pending.queue[st.pending.at] === meuAssento;

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
      if (d) setPriv({ hand: d.hand ?? [], seen: d.seen ?? [] });
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

  if (!caso) return <p className="eyebrow py-16">Abrindo o dossiê…</p>;

  if (!abriu && st.phase !== "over") {
    return <Abertura caso={caso} onFim={() => setAbriu(true)} />;
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
  const focoDoPalpite = st.pending ? st.pending.guess[2] : null;

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
              ? st.winner === null
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
          <p className="eyebrow">Era</p>
          <p className="desfecho-linha">{nomeDaCarta(caso, st.solution.suspect)}</p>
          <p className="desfecho-com">com {nomeDaCarta(caso, st.solution.weapon)}</p>
          <p className="desfecho-onde">na {nomeDaCarta(caso, st.solution.room)}</p>
          {caso.encerramento && <p className="desfecho-nota">{caso.encerramento}</p>}
          <button className="btn btn-brass mt-4 w-full" onClick={onSair}>
            Voltar para a sala
          </button>
        </div>
      )}

      <Mapa
        caso={caso}
        posicoes={st.positions}
        objetos={st.weapons}
        peoes={peoes}
        euEstouEm={euEstouEm}
        destaque={focoDoPalpite}
        alcancaveis={minhaVez && st.actionsLeft > 0 && !souFantasma}
        onEscolher={(lugar) =>
          void chama("dossie_move", { p_match: match.id, p_room: lugar })
        }
      />

      {/* ── refutação ─────────────────────────────────────────────────── */}
      {devoRefutar && st.pending && (
        <div className="panel dossie-refuta">
          <p className="eyebrow">Alguém acusou</p>
          <p className="refuta-palpite">
            {st.pending.guess.map((c) => nomeDaCarta(caso, c)).join(" · ")}
          </p>
          {(() => {
            const posso = priv.hand.filter((c) => st.pending!.guess.includes(c));
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
      return `${quem(l.seat)} mostrou uma carta.${l.auto ? " (tempo esgotado)" : ""}`;
    case "pass":
      return `${quem(l.seat)} não pôde refutar.`;
    case "no_refute":
      return caso.copy?.noRefute ?? "Ninguém pôde refutar.";
    case "accuse":
      return l.right
        ? `${quem(l.seat)} fechou o caso — e acertou.`
        : `${quem(l.seat)} acusou e errou. Virou Fantasma.`;
  }
}

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
  return msg;
}

/* ── caixa de escolha ──────────────────────────────────────────────────── */

function Escolher({
  titulo,
  nota,
  grupos,
  pronto,
  onConfirmar,
  onFechar,
  rotuloBotao,
  perigo,
}: {
  titulo: string;
  nota: string;
  grupos: { rotulo: string; itens: { id: string; name: string }[]; sel?: string; set: (v: string) => void }[];
  pronto: boolean;
  onConfirmar: () => void;
  onFechar: () => void;
  rotuloBotao: string;
  perigo?: boolean;
}) {
  useEffect(() => {
    sfx.abre();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
      style={{ background: "rgb(4 12 18 / 0.85)" }}
      onClick={() => {
        sfx.fecha();
        onFechar();
      }}
    >
      <div
        className="panel w-full max-w-lg p-5 sm:p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={titulo}
      >
        <h2 className="text-2xl">{titulo}</h2>
        <p className="mt-2 text-sm dim">{nota}</p>

        {grupos.map((g) => (
          <div key={g.rotulo} className="mt-5">
            <p className="eyebrow mb-2">{g.rotulo}</p>
            <div className="flex flex-wrap gap-2">
              {g.itens.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  className="escolha"
                  data-on={g.sel === it.id}
                  onClick={() => g.set(it.id)}
                >
                  {it.name}
                </button>
              ))}
            </div>
          </div>
        ))}

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <button
            className={perigo ? "btn btn-lacquer flex-1" : "btn btn-brass flex-1"}
            disabled={!pronto}
            onClick={onConfirmar}
          >
            {rotuloBotao}
          </button>
          <button
            className="btn btn-ghost flex-1"
            onClick={() => {
              sfx.fecha();
              onFechar();
            }}
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
