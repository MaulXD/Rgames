"use client";

import { useCallback, useMemo, useRef } from "react";
import { CELLS, SIZE, areNeighbors, faceLabel } from "@/lib/letreiro";

/**
 * A bandeja: 16 dados sobre feltro.
 *
 * Três formas de montar a palavra, e as três precisam conviver sem modo:
 *
 *   1. DIGITAR — o jeito natural no desktop. O caminho acende sozinho.
 *   2. ARRASTAR — o jeito natural no celular. Encosta e passa o dedo.
 *   3. CLICAR letra por letra — o jeito natural de quem usa mouse e não
 *      quer arrastar.
 *
 * O problema que isso conserta: antes, dois cliques viravam um arraste e o
 * jogo enviava sozinho uma palavra de duas letras. Agora clique e arraste são
 * distinguidos contando quantas células novas entraram enquanto o botão
 * estava pressionado:
 *
 *   - entrou alguma  → foi arraste  → soltar envia
 *   - não entrou     → foi clique   → o caminho FICA, você decide quando enviar
 *
 * E clicar de novo na última letra envia — o gesto de "acabei".
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
  /** idle | ok | bad — pinta o dado e a trilha */
  state: "idle" | "ok" | "bad";
  onPathChange: (path: number[]) => void;
  onCommit: () => void;
  disabled?: boolean;
}) {
  const pressing = useRef(false);
  const entered = useRef(0);
  const inPath = useMemo(() => new Set(path), [path]);

  /** Tenta acrescentar (ou desfazer) uma célula. Diz se mudou algo. */
  const touch = useCallback(
    (cell: number): boolean => {
      if (disabled) return false;
      const last = path[path.length - 1];
      if (last === cell) return false;

      // voltar uma casa: clicar/passar pela penúltima desfaz a última
      if (path.length >= 2 && path[path.length - 2] === cell) {
        onPathChange(path.slice(0, -1));
        return true;
      }
      if (inPath.has(cell)) return false;
      if (path.length && !areNeighbors(last, cell)) return false;
      onPathChange([...path, cell]);
      return true;
    },
    [disabled, path, inPath, onPathChange],
  );

  const endPress = useCallback(() => {
    if (!pressing.current) return;
    pressing.current = false;
    // só arraste envia ao soltar; clique deixa o caminho montado
    if (entered.current > 0 && path.length >= 2) onCommit();
    entered.current = 0;
  }, [onCommit, path.length]);

  return (
    <div className="tray">
      <div
        className="tray-grid"
        role="grid"
        aria-label="Bandeja de letras"
        onPointerUp={endPress}
        onPointerLeave={endPress}
        onPointerCancel={() => {
          pressing.current = false;
          entered.current = 0;
        }}
      >
        {Array.from({ length: CELLS }, (_, i) => {
          const ordem = path.indexOf(i);
          const ultima = ordem >= 0 && ordem === path.length - 1;
          return (
            <button
              key={i}
              type="button"
              role="gridcell"
              className="die"
              data-on={ordem >= 0}
              data-last={ultima}
              data-state={ordem >= 0 ? state : "idle"}
              disabled={disabled}
              aria-label={`${faceLabel(grid[i])}${ordem >= 0 ? `, ${ordem + 1}ª letra` : ""}`}
              onPointerDown={(e) => {
                e.preventDefault();
                if (disabled) return;
                // clicar de novo na última letra = enviar
                if (ultima && path.length >= 2) {
                  onCommit();
                  return;
                }
                pressing.current = true;
                entered.current = 0;
                touch(i);
              }}
              onPointerEnter={() => {
                if (pressing.current && touch(i)) entered.current += 1;
              }}
            >
              <span className="die-face">{faceLabel(grid[i])}</span>
              {ordem >= 0 && <span className="die-order">{ordem + 1}</span>}
            </button>
          );
        })}

        {/* trilha */}
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
