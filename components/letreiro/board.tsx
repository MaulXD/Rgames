"use client";

import { useCallback, useMemo, useRef } from "react";
import { CELLS, SIZE, areNeighbors, faceLabel } from "@/lib/letreiro";

/**
 * A bandeja: 16 dados de baquelite sobre feltro.
 *
 * O caminho é desenhado como uma linha de tinta por cima, em SVG, com os
 * centros das células. Célula tocada afunda — não ganha contorno colorido:
 * é o dado sendo pressionado.
 *
 * Entrada por toque/arraste e por teclado convivem sem modo. No celular o
 * dedo encosta e arrasta; no desktop dá para clicar célula a célula ou
 * simplesmente digitar.
 */
export function Board({
  grid,
  path,
  state,
  onPathChange,
  onCommit,
  disabled,
}: {
  grid: string[];
  path: number[];
  /** idle | ok | bad — pinta a trilha */
  state: "idle" | "ok" | "bad";
  onPathChange: (path: number[]) => void;
  onCommit: () => void;
  disabled?: boolean;
}) {
  const dragging = useRef(false);
  const inPath = useMemo(() => new Set(path), [path]);

  const touch = useCallback(
    (cell: number) => {
      if (disabled) return;
      const last = path[path.length - 1];
      if (last === cell) return;

      // voltar uma casa: desfaz o último
      if (path.length >= 2 && path[path.length - 2] === cell) {
        onPathChange(path.slice(0, -1));
        return;
      }
      if (inPath.has(cell)) return;
      if (path.length && !areNeighbors(last, cell)) return;
      onPathChange([...path, cell]);
    },
    [disabled, path, inPath, onPathChange],
  );

  return (
    <div className="tray">
      <div
        className="tray-grid"
        role="grid"
        aria-label="Bandeja de letras"
        onPointerUp={() => {
          if (dragging.current) {
            dragging.current = false;
            if (path.length >= 2) onCommit();
          }
        }}
        onPointerLeave={() => {
          dragging.current = false;
        }}
      >
        {Array.from({ length: CELLS }, (_, i) => {
          const ordem = path.indexOf(i);
          return (
            <button
              key={i}
              type="button"
              role="gridcell"
              className="die"
              data-on={ordem >= 0}
              data-state={ordem >= 0 ? state : "idle"}
              disabled={disabled}
              aria-label={`${faceLabel(grid[i])}${ordem >= 0 ? `, ${ordem + 1}ª letra` : ""}`}
              onPointerDown={(e) => {
                e.preventDefault();
                dragging.current = true;
                touch(i);
              }}
              onPointerEnter={() => {
                if (dragging.current) touch(i);
              }}
            >
              <span className="die-face">{faceLabel(grid[i])}</span>
              {ordem >= 0 && <span className="die-order">{ordem + 1}</span>}
            </button>
          );
        })}

        {/* trilha de tinta */}
        <svg className="tray-trail" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {path.length >= 2 && (
            <polyline
              points={path
                .map((i) => {
                  const r = Math.floor(i / SIZE);
                  const c = i % SIZE;
                  return `${(c + 0.5) * (100 / SIZE)},${(r + 0.5) * (100 / SIZE)}`;
                })
                .join(" ")}
              data-state={state}
            />
          )}
        </svg>
      </div>
    </div>
  );
}
