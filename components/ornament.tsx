/**
 * Ornamento generativo — guilhoché.
 *
 * A mesma matemática que faz o desenho de fundo de carta de baralho e a
 * trama de cédula: um epitrocoide traçado em linha fina. É ornamento de
 * verdade, autoral, e custa um punhado de bytes — o oposto de encher a tela
 * de glow para "parecer jogo".
 */

function epitrochoid(R: number, r: number, d: number, steps = 1600): string {
  const pts: string[] = [];
  const k = (R + r) / r;
  let max = 0;
  const raw: [number, number][] = [];

  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2 * r;
    const x = (R + r) * Math.cos(t) - d * Math.cos(k * t);
    const y = (R + r) * Math.sin(t) - d * Math.sin(k * t);
    raw.push([x, y]);
    max = Math.max(max, Math.abs(x), Math.abs(y));
  }

  const s = 49 / max;
  for (const [x, y] of raw) {
    pts.push(`${(50 + x * s).toFixed(2)},${(50 + y * s).toFixed(2)}`);
  }
  return `M${pts.join("L")}`;
}

/** Rosácea de guilhoché. Decorativa — sempre aria-hidden. */
export function Rosette({
  size = 320,
  opacity = 0.16,
  className,
}: {
  size?: number;
  opacity?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      aria-hidden
      style={{ display: "block", opacity, color: "var(--brass-400)" }}
    >
      <g fill="none" stroke="currentColor" strokeWidth="0.24">
        <path d={epitrochoid(7, 3, 5)} />
        <path d={epitrochoid(9, 4, 3.4)} opacity="0.75" />
        <path d={epitrochoid(5, 2, 4.2)} opacity="0.5" />
        <circle cx="50" cy="50" r="49" strokeWidth="0.4" />
        <circle cx="50" cy="50" r="45.5" strokeWidth="0.2" />
      </g>
    </svg>
  );
}

/**
 * Fleurão de divisão de seção — losango central com filetes que afinam,
 * como marca de fim de capítulo em livro impresso.
 */
export function Fleuron({ width = 210 }: { width?: number }) {
  return (
    <svg
      width={width}
      height={18}
      viewBox="0 0 210 18"
      aria-hidden
      style={{ display: "block", color: "var(--brass-500)" }}
    >
      <g fill="none" stroke="currentColor" strokeWidth="1">
        <path d="M0 9h72" opacity="0.35" />
        <path d="M138 9h72" opacity="0.35" />
        <path d="M78 9h14M118 9h14" opacity="0.7" />
        <path d="M105 2l7 7-7 7-7-7z" fill="currentColor" />
        <path d="M96 9l-4-4v8zM114 9l4-4v8z" fill="currentColor" opacity="0.8" />
      </g>
    </svg>
  );
}

/** Cantoneira: quarto de moldura para os cantos de um painel. */
export function Corner({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden style={{ display: "block" }}>
      <g fill="none" stroke="currentColor" strokeWidth="1.1">
        <path d="M1 25V6a5 5 0 0 1 5-5h19" opacity="0.55" />
        <path d="M5 25V9a4 4 0 0 1 4-4h16" opacity="0.3" />
        <circle cx="7.5" cy="7.5" r="1.9" fill="currentColor" stroke="none" />
      </g>
    </svg>
  );
}
