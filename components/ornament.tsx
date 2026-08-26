const VIVAS = ["#FF4D5E", "#FF8A2B", "#FFC42E", "#A8E827", "#2FD8C4", "#2E8CFF", "#B25CFF", "#FF6FA5"];
const INK = "#1D1526";

/**
 * Ornamento.
 *
 * A primeira versão era guilhoché — a trama de verso de baralho, desenhada com
 * epitrocoide. Bonita e completamente fora de registro: linha fina de cédula
 * num jogo que quer ser brinquedo. Trocada por confete e estrela, que é o
 * ornamento que caixa de jogo infantil usa de verdade.
 */

/** Estrelinha de cinco pontas, com contorno grosso. */
function estrela(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.44;
    const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`);
  }
  return `M${pts.join("L")}Z`;
}

/** Explosão de raios coloridos — o fundo festivo do título. */
export function Rosette({
  size = 320,
  opacity = 0.5,
  className,
}: {
  size?: number;
  opacity?: number;
  className?: string;
}) {
  const raios = 18;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      aria-hidden
      style={{ display: "block", opacity }}
    >
      <g>
        {Array.from({ length: raios }, (_, i) => {
          const a1 = (i / raios) * Math.PI * 2;
          const a2 = ((i + 0.42) / raios) * Math.PI * 2;
          const r0 = 16;
          const r1 = 49;
          return (
            <path
              key={i}
              d={
                `M${50 + r0 * Math.cos(a1)},${50 + r0 * Math.sin(a1)}` +
                `L${50 + r1 * Math.cos(a1)},${50 + r1 * Math.sin(a1)}` +
                `L${50 + r1 * Math.cos(a2)},${50 + r1 * Math.sin(a2)}` +
                `L${50 + r0 * Math.cos(a2)},${50 + r0 * Math.sin(a2)}Z`
              }
              fill={VIVAS[i % VIVAS.length]}
              opacity={0.55}
            />
          );
        })}
        <circle cx="50" cy="50" r="13" fill="#FFC42E" opacity="0.6" />
      </g>
    </svg>
  );
}

/** Divisor de seção: confete alinhado. */
export function Fleuron({ width = 210 }: { width?: number }) {
  const pecas = [
    { x: 18, tipo: "circ", c: 0 },
    { x: 42, tipo: "diam", c: 1 },
    { x: 66, tipo: "circ", c: 2 },
    { x: 105, tipo: "star", c: 3 },
    { x: 144, tipo: "circ", c: 4 },
    { x: 168, tipo: "diam", c: 5 },
    { x: 192, tipo: "circ", c: 6 },
  ];
  return (
    <svg width={width} height={28} viewBox="0 0 210 28" aria-hidden style={{ display: "block" }}>
      {pecas.map((p, i) => {
        const cor = VIVAS[(p.c * 2) % VIVAS.length];
        if (p.tipo === "star") {
          return (
            <path
              key={i}
              d={estrela(p.x, 14, 11)}
              fill={cor}
              stroke={INK}
              strokeWidth={2.4}
              strokeLinejoin="round"
            />
          );
        }
        if (p.tipo === "diam") {
          return (
            <path
              key={i}
              d={`M${p.x} 7 l6 7 -6 7 -6 -7z`}
              fill={cor}
              stroke={INK}
              strokeWidth={2.2}
              strokeLinejoin="round"
            />
          );
        }
        return <circle key={i} cx={p.x} cy={14} r={5} fill={cor} stroke={INK} strokeWidth={2.2} />;
      })}
    </svg>
  );
}

/** Estrelinha solta, para cantos e enfeites. */
export function Corner({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden style={{ display: "block" }}>
      <path
        d={estrela(13, 13, 11)}
        fill="currentColor"
        stroke={INK}
        strokeWidth={2.2}
        strokeLinejoin="round"
      />
    </svg>
  );
}
