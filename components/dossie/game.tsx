"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Abertura } from "@/components/dossie/abertura";
import { Mapa, type Peao } from "@/components/dossie/mapa";
import { Bloco } from "@/components/dossie/bloco";
import type { Pad } from "@/lib/dossie-bloco";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useSession } from "@/components/session";
import { carregaCaso, nomeDaCarta, type Caso } from "@/lib/dossie";
import type { LinhaLog } from "@/lib/dossie-bloco";
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
  const devoRefutar =
    st.phase === "refute" &&
    !!st.pending &&
    st.pending.queue[st.pending.at] === meuAssento;

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
    !!st.pending &&
    st.players.some(
      (p) => p.seat === st.pending!.queue[st.pending!.at] && idsBot.has(p.userId),
    );

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
    if (minhaVez || devoRefutar) seguidos.current = 0;   // voltou para gente: zera
    if (!temMaquina || st.phase === "over" || maquinaEmpacou) return;
    if (!maquinaNaVez && !maquinaRefutando) return;
    // o setState mora dentro do temporizador
    const id = setTimeout(() => void tocarMaquina(), 1300);
    return () => clearTimeout(id);
  }, [
    temMaquina,
    maquinaNaVez,
    maquinaRefutando,
    maquinaEmpacou,
    tocarMaquina,
    st.phase,
    st.turnSeat,
    st.seq,
    tique,
    minhaVez,
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
  const focoDoPalpite = st.pending ? st.pending.guess[2] : null;

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
          {(maquinaNaVez || maquinaRefutando) && !minhaVez && !devoRefutar &&
            st.phase !== "over" && !maquinaEmpacou && (
            <p className="dossie-acoes dossie-pensando">
              <span className="pensa-pontos" aria-hidden>
                <i />
                <i />
                <i />
              </span>
              {maquinaRefutando ? "conferindo a mão" : "pensando"}
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
          <p className="eyebrow">Era</p>
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
        onPad={(novo) => {
          setPriv((a) => ({ ...a, pad: novo }));
          void supabaseBrowser().rpc("dossie_pad", { p_match: match.id, p_pad: novo });
        }}
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
