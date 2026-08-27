"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { Emblem } from "@/components/emblems";
import { Corner } from "@/components/ornament";
import { useSession } from "@/components/session";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Room } from "@/lib/supabase/types";
import type { Game } from "@/lib/games";

/**
 * Carta de jogo. Antes ela tinha aparência de clicável e não fazia nada —
 * era a reclamação certa. Agora o botão cria a sala de verdade via RPC e
 * leva para o lobby.
 *
 * Cada jogo é uma caixa de brinquedo de cor diferente: fundo chapado,
 * contorno grosso e a lateral pintada por baixo (a sombra sólida). O reflexo
 * segue o ponteiro; onde não há ponteiro, ele fica parado e o toque abre a sala.
 */
export function GameCard({ game }: { game: Game }) {
  const router = useRouter();
  const { status } = useSession();
  const ref = useRef<HTMLElement>(null);
  const frame = useRef(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function onMove(e: PointerEvent<HTMLElement>) {
    if (e.pointerType !== "mouse") return;
    const el = ref.current;
    if (!el) return;
    cancelAnimationFrame(frame.current);
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    frame.current = requestAnimationFrame(() => {
      el.style.setProperty("--mx", `${(px * 100).toFixed(1)}%`);
      el.style.setProperty("--my", `${(py * 100).toFixed(1)}%`);
      el.style.setProperty("--tilt-y", `${((px - 0.5) * 6).toFixed(2)}deg`);
      el.style.setProperty("--tilt-x", `${((0.5 - py) * 4.5).toFixed(2)}deg`);
    });
  }

  function onLeave() {
    const el = ref.current;
    if (!el) return;
    cancelAnimationFrame(frame.current);
    el.style.setProperty("--tilt-x", "0deg");
    el.style.setProperty("--tilt-y", "0deg");
    el.style.setProperty("--mx", "50%");
    el.style.setProperty("--my", "0%");
  }

  async function criarSala() {
    setBusy(true);
    setErr(null);
    try {
      const sb = supabaseBrowser();
      const { data, error } = await sb.rpc("create_room", { p_game: game.key });
      if (error) throw error;
      const room = data as unknown as Room;
      router.push(`/j/${room.code}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const skin = {
    "--c-bg": game.skin.bg,
    "--c-deep": game.skin.deep,
    "--c-ink": game.skin.ink,
    "--c-dim": game.skin.dim,
    "--c-glow": game.skin.glow,
  } as CSSProperties;

  // "jogável" e não "é o MVP": três jogos já rodam, e o selo tem de dizer o
  // que a pessoa pode fazer AGORA, não em que fase do roadmap a coisa entrou.
  const isMvp = game.seal === "Jogável";

  return (
    <article ref={ref} className="card" style={skin} onPointerMove={onMove} onPointerLeave={onLeave}>
      <div className="card-foil" aria-hidden />
      <div className="card-gloss" aria-hidden />
      <div className="card-frame" aria-hidden />
      <span className="card-seal" data-kind={isMvp ? "mvp" : "soon"}>
        {game.seal}
      </span>

      {/* estrelinhas de canto */}
      <span
        aria-hidden
        style={{ position: "absolute", top: 13, left: 13, zIndex: 5, color: "var(--c-glow)", opacity: 0.5 }}
      >
        <Corner />
      </span>
      <span
        aria-hidden
        style={{
          position: "absolute",
          bottom: 13,
          right: 13,
          zIndex: 5,
          color: "var(--c-glow)",
          opacity: 0.5,
          transform: "rotate(180deg)",
        }}
      >
        <Corner />
      </span>

      <div className="card-body">
        <p className="card-ref">
          {game.ord} · {game.ref}
        </p>

        <div className="card-emblem">
          <Emblem game={game.key} size={112} />
        </div>

        <h3 className="card-name">{game.name}</h3>
        <p className="card-pitch">{game.pitch}</p>

        <div className="card-meta">
          <span className="pill">{game.players} jogadores</span>
          <span className="pill">{game.duration}</span>
        </div>

        <div className="card-action">
          <button
            type="button"
            className={isMvp ? "btn btn-brass w-full" : "btn btn-ghost w-full"}
            onClick={criarSala}
            disabled={busy || status !== "ready"}
          >
            {busy ? "Abrindo…" : "Criar sala"}
          </button>
          {err && (
            <p className="mt-2 text-xs" style={{ color: "#ffb3a7" }}>
              {err}
            </p>
          )}
          {!err && status !== "ready" && (
            <p className="mt-2 text-xs" style={{ color: "var(--c-dim)" }}>
              {status === "loading" ? "Abrindo a mesa…" : "Sessão indisponível"}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
