"use client";

import { useCallback, useMemo, useRef } from "react";
import { areNeighbors, faceLabel, letterValue, sizeOf } from "@/lib/letreiro";

/**
 * A bandeja: 16 ou 25 dados sobre feltro — quem manda é `grid.length`.
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
  bandeja,
  path,
  state,
  onPathChange,
  onCommit,
  disabled,
}: {
  grid: string[];
  /** o material: nogueira (padrão), osso, fliperama ou meridiano */
  bandeja?: string;
  path: number[];
  /** idle | path | bad — pinta o dado e a trilha */
  state: "idle" | "path" | "bad";
  onPathChange: (path: number[]) => void;
  onCommit: () => void;
  disabled?: boolean;
}) {
  const pressing = useRef(false);
  const entered = useRef(0);
  const lado = useMemo(() => sizeOf(grid), [grid]);

  /** Tenta acrescentar (ou desfazer) uma célula. Diz se mudou algo. */
  const touch = useCallback(
    (cell: number): boolean => {
      if (disabled) return false;
      const last = path[path.length - 1];
      if (last === cell) return false;

      // clicar numa célula que já está no caminho: corta ali. Serve para
      // desfazer uma letra (a penúltima) e para voltar várias de uma vez.
      const jaEm = path.indexOf(cell);
      if (jaEm >= 0) {
        onPathChange(path.slice(0, jaEm + 1));
        return true;
      }

      // clicar longe do fim NÃO é mais ignorado em silêncio: recomeça dali.
      // Ignorar era o que dava a sensação de que o jogo não respondia.
      if (path.length && !areNeighbors(last, cell, lado)) {
        onPathChange([cell]);
        return true;
      }

      onPathChange([...path, cell]);
      return true;
    },
    [disabled, path, onPathChange, lado],
  );

  const endPress = useCallback(() => {
    if (!pressing.current) return;
    pressing.current = false;
    // só arraste envia ao soltar; clique deixa o caminho montado
    if (entered.current > 0 && path.length >= 2) onCommit();
    entered.current = 0;
  }, [onCommit, path.length]);

  return (
    /* O material inteiro sai daqui: seis tokens de CSS trocam por `data-bandeja`,
       e nem o componente nem a grade sabem qual foi escolhida. É o que faz uma
       bandeja nova custar dez linhas de CSS e nenhuma de React. */
    <div className="tray" data-bandeja={bandeja ?? "nogueira"}>
      <div
        className="tray-grid"
        role="grid"
        aria-label="Bandeja de letras"
        data-lado={lado}
        style={{ "--lado": lado } as React.CSSProperties}
        onPointerUp={endPress}
        onPointerLeave={endPress}
        onPointerCancel={() => {
          pressing.current = false;
          entered.current = 0;
        }}
      >
        {Array.from({ length: grid.length }, (_, i) => {
          const ordem = path.indexOf(i);
          const ultima = ordem >= 0 && ordem === path.length - 1;
          // a entrada dos dados é em diagonal: onda que atravessa a bandeja,
          // em vez de tudo aparecendo no mesmo instante
          const onda = Math.floor(i / lado) + (i % lado);
          return (
            <button
              key={i}
              type="button"
              role="gridcell"
              className="die"
              style={{ "--onda": onda } as React.CSSProperties}
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
              <span className="die-val">{letterValue(grid[i])}</span>
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
                  const r = Math.floor(i / lado);
                  const c = i % lado;
                  return `${(c + 0.5) * (100 / lado)},${(r + 0.5) * (100 / lado)}`;
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
