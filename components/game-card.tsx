"use client";

import { useRef, type CSSProperties, type PointerEvent } from "react";
import { Emblem } from "@/components/emblems";
import type { Game } from "@/lib/games";

/**
 * O brilho é de verniz e foil — luz especular refletindo num material,
 * não glow. Ver docs/01-DIRECAO-DE-ARTE.md §2 e §4.2.
 *
 * A inclinação só existe onde há ponteiro de verdade (@media hover em CSS).
 * No celular a carta fica com o foil estático e o toque abre o jogo.
 */
export function GameCard({ game }: { game: Game }) {
  const ref = useRef<HTMLElement>(null);
  const frame = useRef(0);

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
      el.style.setProperty("--tilt-y", `${((px - 0.5) * 7).toFixed(2)}deg`);
      el.style.setProperty("--tilt-x", `${((0.5 - py) * 5).toFixed(2)}deg`);
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

  const skin = {
    "--c-bg": game.skin.bg,
    "--c-ink": game.skin.ink,
    "--c-dim": game.skin.dim,
    "--c-glow": game.skin.glow,
    "--c-sheen": game.skin.sheen,
  } as CSSProperties;

  return (
    <article
      ref={ref}
      className="card"
      style={skin}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      tabIndex={0}
      aria-label={`${game.name}, ${game.ref}`}
    >
      <div className="card-foil" aria-hidden />
      <div className="card-gloss" aria-hidden />
      <div className="card-edge" aria-hidden />
      <span className="card-status">{game.status}</span>

      <div className="card-body">
        <div className="card-top">
          <span className="card-ord">{game.ord}</span>
          <span className="card-ref">{game.ref}</span>
        </div>

        <div className="card-emblem">
          <Emblem game={game.key} />
        </div>

        <h3 className="card-name">{game.name}</h3>
        <p className="card-pitch">{game.pitch}</p>

        <dl className="card-facts">
          <div>
            <dt>Jogadores</dt>
            <dd>{game.players}</dd>
          </div>
          <div>
            <dt>Duração</dt>
            <dd>{game.duration}</dd>
          </div>
        </dl>
      </div>
    </article>
  );
}
