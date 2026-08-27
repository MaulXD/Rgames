"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { Avatar } from "@/components/avatar";
import { Fleuron } from "@/components/ornament";
import { HouseRules } from "@/components/house-rules";
import { useSession } from "@/components/session";
import { LetreiroGame, type MatchRow } from "@/components/letreiro/game";
import { DossieGame, type DossieMatch } from "@/components/dossie/game";
import { DominioGame, type DominioMatch } from "@/components/dominio/game";
import { MetropoleGame, type MetMatch } from "@/components/metropole/game";
import { supabaseBrowser } from "@/lib/supabase/client";
import { COLORS, parseAvatar, type ColorKey } from "@/lib/avatar";
import { GAMES } from "@/lib/games";
import type { Room } from "@/lib/supabase/types";

const COLOR_KEYS = Object.keys(COLORS) as ColorKey[];
const SEATS = 8;

type NivelBot = "facil" | "medio" | "dificil";

type Seat = {
  user_id: string;
  seat: number | null;
  color: ColorKey | null;
  role: "host" | "player" | "spectator";
  is_ready: boolean;
  bot_nivel: NivelBot | null;
  profiles: { display_name: string; avatar: unknown; is_bot: boolean } | null;
};

/* Os tres niveis, com o nome que a pessoa ve e a promessa que cada um faz.
   "Medio" sem explicacao nao quer dizer nada: quem escolhe precisa saber o que
   vai encontrar do outro lado da mesa. */
const NIVEIS: { chave: NivelBot; nome: string; promessa: string }[] = [
  { chave: "facil", nome: "Tranquila", promessa: "joga devagar e deixa muita coisa passar" },
  { chave: "medio", nome: "Firme", promessa: "acha boa parte do que da para achar" },
  { chave: "dificil", nome: "Impiedosa", promessa: "vai doer, mas ainda e possivel ganhar" },
];

/* ONDE A MÁQUINA SABE JOGAR.
   Espelha `bot_sabe_jogar` no banco, e a cópia é de propósito: o servidor
   RECUSA (é ele a autoridade) e a interface NÃO OFERECE (botão que dá erro é
   uma promessa quebrada). Quando o cérebro do Domínio existir, são duas linhas
   — esta e a do banco. */
const BOT_SABE_JOGAR = new Set(["letreiro", "dominio", "metropole"]);

const NOME_NIVEL: Record<NivelBot, string> = {
  facil: "tranquila",
  medio: "firme",
  dificil: "impiedosa",
};

export function Lobby({ code }: { code: string }) {
  const router = useRouter();
  const { status, user } = useSession();
  const [room, setRoom] = useState<Room | null>(null);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [match, setMatch] = useState<MatchRow | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [fatal, setFatal] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [convidando, setConvidando] = useState<NivelBot | null>(null);
  const roomIdRef = useRef<string | null>(null);

  const loadSeats = useCallback(async (roomId: string) => {
    const sb = supabaseBrowser();
    const { data, error } = await sb
      .from("room_members")
      .select(
        "user_id, seat, color, role, is_ready, bot_nivel, profiles(display_name, avatar, is_bot)",
      )
      .eq("room_id", roomId)
      .order("seat", { nullsFirst: false });
    if (error) return;
    setSeats((data ?? []) as unknown as Seat[]);
  }, []);

  const loadMatch = useCallback(async (roomId: string) => {
    const sb = supabaseBrowser();
    const { data } = await sb
      .from("matches")
      .select("id, status, ends_at, turn_deadline, public_state")
      .eq("room_id", roomId)
      .in("status", ["running", "finished"])
      .order("started_at", { ascending: false })
      .limit(1);
    const m = (data?.[0] as MatchRow | undefined) ?? null;
    setMatch(m ?? null);
  }, []);

  // entra na sala e assina presença, assentos e partidas
  useEffect(() => {
    if (status !== "ready" || !user) return;
    let alive = true;
    const sb = supabaseBrowser();
    const uid = user.id;
    let channel: ReturnType<typeof sb.channel> | null = null;

    async function enter() {
      try {
        const { data, error } = await sb.rpc("join_room", { p_code: code });
        if (error) throw error;
        const r = data as unknown as Room;
        if (!alive) return;
        setRoom(r);
        roomIdRef.current = r.id;
        await Promise.all([loadSeats(r.id), loadMatch(r.id)]);

        channel = sb.channel(`room:${code}`, { config: { presence: { key: uid } } });

        channel
          .on("presence", { event: "sync" }, () => {
            setOnline(new Set(Object.keys(channel!.presenceState())));
          })
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "room_members", filter: `room_id=eq.${r.id}` },
            () => void loadSeats(r.id),
          )
          .on(
            "postgres_changes",
            { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${r.id}` },
            (payload: { new: unknown }) => setRoom(payload.new as Room),
          )
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "matches", filter: `room_id=eq.${r.id}` },
            () => void loadMatch(r.id),
          )
          .subscribe((state: string) => {
            if (state === "SUBSCRIBED") void channel!.track({ at: Date.now() });
          });
      } catch (e) {
        if (!alive) return;
        const msg = e instanceof Error ? e.message : String(e);
        setFatal(
          /ROOM_NOT_FOUND/.test(msg)
            ? "Essa sala não existe mais. Códigos expiram 24h depois da última partida."
            : msg,
        );
      }
    }

    void enter();
    return () => {
      alive = false;
      if (channel) void sb.removeChannel(channel);
    };
  }, [status, user, code, loadSeats, loadMatch]);

  useEffect(() => {
    const id = setInterval(() => {
      const rid = roomIdRef.current;
      if (rid) void supabaseBrowser().rpc("touch_presence", { p_room: rid });
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  async function act(fn: () => Promise<{ error: unknown }>) {
    setNote(null);
    const { error } = await fn();
    if (error) {
      const msg = (error as { message?: string }).message ?? String(error);
      setNote(
        /COLOR_TAKEN/.test(msg)
          ? "Essa cor já é de outra pessoa."
          : /ROOM_FULL/.test(msg)
            ? "A mesa está cheia."
            : /NO_BOT_AVAILABLE/.test(msg)
              ? "Todas as máquinas já estão nesta mesa."
              : /NOT_HOST/.test(msg)
                ? "Só o anfitrião faz isso."
                : /MATCH_IN_PROGRESS/.test(msg)
                  ? "Com a partida rolando, não dá."
                  : /BOT_NOT_READY/.test(msg)
                    ? "A máquina ainda não aprendeu este jogo."
                    : msg,
      );
      return;
    }
    if (roomIdRef.current) await loadSeats(roomIdRef.current);
  }

  async function convidarMaquina(nivel: NivelBot) {
    if (!room) return;
    setConvidando(nivel);
    try {
      await act(async () =>
        supabaseBrowser().rpc("adicionar_bot", { p_room: room.id, p_nivel: nivel }),
      );
    } finally {
      setConvidando(null);
    }
  }

  async function comecar() {
    if (!room) return;
    setStarting(true);
    setNote(null);
    const rpc =
      room.game_key === "dossie"
        ? "dossie_start"
        : room.game_key === "dominio"
          ? "dominio_start"
          : room.game_key === "metropole"
            ? "met_start"
            : "letreiro_start";
    const { error } = await supabaseBrowser().rpc(rpc, { p_room: room.id });
    setStarting(false);
    if (error) {
      const msg = error.message ?? String(error);
      setNote(
        /NOT_HOST/.test(msg)
          ? "Só o anfitrião começa a partida."
          : /ALREADY_RUNNING/.test(msg)
            ? "Já tem partida rolando nesta sala."
            : /NEED_THREE/.test(msg)
              ? room.game_key === "dominio"
                ? "O Domínio precisa de pelo menos três jogadores."
                : "O Dossiê precisa de pelo menos três jogadores."
              : /NEED_TWO/.test(msg)
                ? "A Metrópole precisa de pelo menos dois jogadores."
                : /TOO_MANY/.test(msg)
                  ? "Este jogo vai até seis jogadores."
                : /NO_MAP/.test(msg)
                  ? "O mapa de Vantara não está publicado. Rode `npm run mapa`."
                  : msg,
      );
      return;
    }
    await loadMatch(room.id);
  }

  async function openInvite() {
    setShowInvite(true);
    if (!qr) {
      const svg = await QRCode.toString(`${window.location.origin}/j/${code}`, {
        type: "svg",
        margin: 1,
        errorCorrectionLevel: "M",
        color: { dark: "#f6efdd", light: "#0000" },
      });
      setQr(svg);
    }
  }

  async function copyLink() {
    await navigator.clipboard.writeText(`${window.location.origin}/j/${code}`);
    setNote("Link copiado.");
  }

  async function share() {
    const url = `${window.location.origin}/j/${code}`;
    if (navigator.share) {
      await navigator.share({ title: "Mesa", text: `Entra na sala ${code}`, url });
    } else {
      await copyLink();
    }
  }

  async function leave() {
    const rid = roomIdRef.current;
    if (rid) await supabaseBrowser().rpc("leave_room", { p_room: rid });
    router.push("/");
  }

  if (status === "loading") return <p className="eyebrow py-16">Abrindo a mesa…</p>;

  if (fatal || status === "error") {
    return (
      <div className="panel mt-8 p-6">
        <h2 className="text-2xl">Não deu para entrar.</h2>
        <p className="mt-3 dim">{fatal ?? "Sessão indisponível."}</p>
        <button className="btn btn-ghost mt-6" onClick={() => router.push("/")}>
          Voltar para a mesa
        </button>
      </div>
    );
  }

  if (!room) return <p className="eyebrow py-16">Puxando uma cadeira…</p>;

  const game = GAMES.find((g) => g.key === room.game_key);
  const me = seats.find((s) => s.user_id === user?.id);
  const iAmHost = room.host_id === user?.id;
  const takenColors = new Set(seats.filter((s) => s.user_id !== user?.id).map((s) => s.color));
  const players = seats.filter((s) => s.seat !== null).sort((a, b) => a.seat! - b.seat!);
  const maquinas = players.filter((s) => s.profiles?.is_bot);
  const mesaCheia = players.length >= SEATS;
  // os quatro jogam
  const jogavel = true;

  // ── partida em andamento ou recém-terminada: o jogo toma a tela ─────────
  if (match && !dismissed.has(match.id)) {
    const naMesa = players.map((p) => ({
      user_id: p.user_id,
      display_name: p.profiles?.display_name ?? "Convidado",
      avatar: p.profiles?.avatar,
      is_bot: p.profiles?.is_bot === true,
    }));

    if (room.game_key === "metropole") {
      return (
        <MetropoleGame
          match={match as unknown as MetMatch}
          assentos={naMesa}
          onSair={() => setDismissed((d) => new Set(d).add(match.id))}
        />
      );
    }

    if (room.game_key === "dominio") {
      return (
        <DominioGame
          match={match as unknown as DominioMatch}
          assentos={naMesa}
          onSair={() => setDismissed((d) => new Set(d).add(match.id))}
        />
      );
    }

    if (room.game_key === "dossie") {
      return (
        <DossieGame
          match={match as unknown as DossieMatch}
          assentos={naMesa}
          onSair={() => setDismissed((d) => new Set(d).add(match.id))}
        />
      );
    }

    return (
      <LetreiroGame
        match={match}
        seats={naMesa}
        onLeaveMatch={() => setDismissed((d) => new Set(d).add(match.id))}
        onRematch={
          iAmHost
            ? async () => {
                setDismissed((d) => new Set(d).add(match.id));
                await comecar();
              }
            : undefined
        }
      />
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <p className="eyebrow">{game?.ref ?? "Sala"}</p>
          <h1 className="mt-2 text-[clamp(2.4rem,9vw,4rem)]">{game?.name ?? "Sala"}</h1>
          <p className="mt-3 dim max-w-[46ch]">
            {game?.players} jogadores · {game?.duration}
          </p>
        </div>
        <div className="flex flex-col items-start gap-3 sm:items-end">
          <span className="code-plate text-[clamp(1.4rem,6vw,2rem)]">
            {code.slice(0, 3)}
            <span style={{ color: "var(--fg-faint)", letterSpacing: 0 }}>·</span>
            {code.slice(3)}
          </span>
          <button className="btn btn-brass" onClick={openInvite}>
            Convidar
          </button>
        </div>
      </div>

      <div className="my-9 flex justify-center">
        <Fleuron />
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2">
        {Array.from({ length: SEATS }, (_, i) => {
          const s = players.find((p) => p.seat === i);
          if (!s) {
            return (
              <div key={i} className="seat seat-empty">
                assento {i + 1} livre
              </div>
            );
          }
          const prof = s.profiles;
          const mine = s.user_id === user?.id;
          const maquina = prof?.is_bot === true;
          return (
            <div
              key={i}
              className="seat"
              data-me={mine}
              data-bot={maquina}
              /* MÁQUINA NUNCA APARECE AUSENTE. Ela não tem aba para fechar nem
                 sinal para cair — marcar de cinza seria mentir sobre ela. */
              data-away={!maquina && !online.has(s.user_id)}
            >
              <Avatar spec={parseAvatar(prof?.avatar)} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {prof?.display_name ?? "Convidado"}
                  {mine && <span className="dim"> · você</span>}
                </p>
                <p
                  className="mono text-[0.66rem] tracking-[0.14em] uppercase"
                  style={{ color: "var(--fg-faint)" }}
                >
                  {maquina
                    ? `máquina · ${NOME_NIVEL[s.bot_nivel ?? "medio"]}`
                    : s.role === "host"
                      ? "anfitrião"
                      : `assento ${i + 1}`}
                  {s.color ? ` · ${COLORS[s.color].name}` : ""}
                </p>
              </div>
              {maquina && iAmHost ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-mini"
                  title={`Dispensar ${prof?.display_name}`}
                  onClick={() =>
                    act(async () =>
                      supabaseBrowser().rpc("remover_bot", { p_room: room.id, p_seat: i }),
                    )
                  }
                >
                  dispensar
                </button>
              ) : (
                <span
                  className="dot"
                  data-on={s.is_ready}
                  title={s.is_ready ? "Pronto" : "Ainda não"}
                  style={
                    s.color
                      ? { background: s.is_ready ? COLORS[s.color].enamel : undefined }
                      : undefined
                  }
                />
              )}
            </div>
          );
        })}
      </div>

      {me && (
        <div className="panel mt-8 p-5 sm:p-6">
          <p className="eyebrow">Sua cor na mesa</p>
          <div className="mt-3 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {COLOR_KEYS.map((k) => {
              const taken = takenColors.has(k);
              return (
                <button
                  key={k}
                  type="button"
                  title={taken ? `${COLORS[k].name} — já é de outra pessoa` : COLORS[k].name}
                  aria-pressed={me.color === k}
                  disabled={taken}
                  onClick={() =>
                    act(async () =>
                      supabaseBrowser().rpc("set_color", { p_room: room.id, p_color: k }),
                    )
                  }
                  style={{
                    flex: "none",
                    width: 50,
                    height: 50,
                    borderRadius: 999,
                    background: COLORS[k].enamel,
                    opacity: taken ? 0.28 : 1,
                    cursor: taken ? "not-allowed" : "pointer",
                    border: `3px solid ${me.color === k ? "var(--ink)" : "transparent"}`,
                    boxShadow: `inset 0 -7px 0 ${COLORS[k].deep}, inset 0 5px 0 ${COLORS[k].light}`,
                  }}
                >
                  <span className="sr-only">{COLORS[k].name}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              className={me.is_ready ? "btn btn-ghost" : "btn btn-brass"}
              onClick={() =>
                act(async () =>
                  supabaseBrowser().rpc("set_ready", { p_room: room.id, p_ready: !me.is_ready }),
                )
              }
            >
              {me.is_ready ? "Não estou pronto" : "Estou pronto"}
            </button>
            <button className="btn btn-ghost" onClick={leave}>
              Sair da sala
            </button>
          </div>
          {note && (
            <p className="mt-3 text-sm" style={{ color: "var(--vivo-amarelo)" }}>
              {note}
            </p>
          )}
        </div>
      )}

      {/* NINGUÉM DEVE ESPERAR PARA JOGAR.
          Uma mesa vazia às três da manhã é o motivo mais comum de fechar a aba.
          O anfitrião completa a mesa em um toque — e escolhe o quanto quer
          sofrer. */}
      {iAmHost && BOT_SABE_JOGAR.has(room.game_key) && (
        <div className="panel mt-4 p-5 sm:p-6">
          <p className="eyebrow">Jogar contra a máquina</p>
          <p className="mt-2 text-sm dim">
            {maquinas.length === 0
              ? "Sem gente para completar a mesa? Chame uma máquina. Ela senta, pega uma cor e joga como qualquer um."
              : maquinas.length === 1
                ? "Uma máquina na mesa. Ela não vê a sua mão — joga com o que o servidor deu a ela."
                : `${maquinas.length} máquinas na mesa, cada uma com seu jeito. Nenhuma vê a sua mão.`}
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {NIVEIS.map((n) => (
              <button
                key={n.chave}
                type="button"
                className="btn btn-ghost btn-nivel"
                disabled={mesaCheia || convidando !== null}
                title={mesaCheia ? "A mesa está cheia" : n.promessa}
                onClick={() => convidarMaquina(n.chave)}
              >
                <span className="font-medium">
                  {convidando === n.chave ? "Chamando…" : n.nome}
                </span>
                <span className="text-[0.7rem] leading-snug dim">{n.promessa}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* os quatro jogos têm algo a combinar antes de começar */}
      <HouseRules room={room} isHost={iAmHost} onChanged={setRoom} />

      <div className="panel mt-4 p-5 sm:p-6">
        <button
          className="btn btn-brass w-full"
          onClick={comecar}
          disabled={!jogavel || !iAmHost || starting}
          title={
            !jogavel
              ? `${game?.name} entra na ${game?.phase} do roadmap`
              : !iAmHost
                ? "Só o anfitrião começa"
                : undefined
          }
        >
          {starting ? "Embaralhando…" : "Começar partida"}
        </button>
        <p className="mt-3 text-sm dim">
          {jogavel ? (
            iAmHost ? (
              room.game_key === "metropole" ? (
                <>
                  Quarenta casas, vinte e oito propriedades e três delas já sorteadas para cada um
                  — a negociação começa antes do primeiro dado. Vinte rodadas, e ganha quem tem
                  mais patrimônio.
                </>
              ) : room.game_key === "dominio" ? (
                <>
                  Quarenta e dois territórios, seis continentes, um objetivo secreto para cada um.
                  Precisa de três jogadores ou mais. Turno de dois minutos — quem sumir perde a vez,
                  não a partida de todos.
                </>
              ) : room.game_key === "dossie" ? (
                <>
                  Seis suspeitos, seis objetos, nove lugares. Precisa de três jogadores ou mais — e
                  começa com a história do caso.
                </>
              ) : (
                <>
                  Três minutos, todo mundo na mesma grade. Dá para jogar sozinho também — a
                  revelação no fim mostra o que escapou.
                </>
              )
            ) : (
              <>Esperando o anfitrião começar.</>
            )
          ) : (
            <>
              <strong style={{ color: "var(--fg)" }}>{game?.name}</strong> ainda não é jogável: entra
              na {game?.phase} do roadmap. Esta sala já funciona — entrar por link ou QR, ver quem
              chegou ao vivo, escolher cor, sair e voltar.
            </>
          )}
        </p>
      </div>

      {showInvite && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
          style={{ background: "rgb(4 14 11 / 0.82)" }}
          onClick={() => setShowInvite(false)}
        >
          <div
            className="panel w-full max-w-md p-6 sm:p-8"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Convidar para a sala"
          >
            <p className="eyebrow">Três caminhos para a mesma sala</p>

            <div className="mt-6 flex justify-center">
              <div
                className="p-4"
                style={{ background: "var(--felt-950)", border: "1px solid var(--line-strong)" }}
              >
                {qr ? (
                  <div style={{ width: 208, height: 208 }} dangerouslySetInnerHTML={{ __html: qr }} />
                ) : (
                  <div style={{ width: 208, height: 208 }} />
                )}
              </div>
            </div>

            <p className="mt-6 text-center">
              <span className="code-plate text-3xl">
                {code.slice(0, 3)}
                <span style={{ color: "var(--fg-faint)", letterSpacing: 0 }}>·</span>
                {code.slice(3)}
              </span>
            </p>
            <p className="mt-2 text-center text-xs dim">
              É isso que você fala em voz alta na chamada.
            </p>

            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <button className="btn btn-brass flex-1" onClick={share}>
                Compartilhar
              </button>
              <button className="btn btn-ghost flex-1" onClick={copyLink}>
                Copiar link
              </button>
            </div>
            <button className="btn btn-ghost mt-2 w-full" onClick={() => setShowInvite(false)}>
              Fechar
            </button>
          </div>
        </div>
      )}
    </>
  );
}
