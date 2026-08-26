import type { GameKey } from "@/lib/games";

/**
 * Emblemas autorais, desenhados em grade de 96 com traço de 1.75.
 * Nada de biblioteca de ícones — ver docs/01-DIRECAO-DE-ARTE.md §4.4.
 */

const base = {
  width: 96,
  height: 96,
  viewBox: "0 0 96 96",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "butt" as const,
  strokeLinejoin: "miter" as const,
  "aria-hidden": true,
};

/** Letreiro — grade 4×4 com um caminho traçado por quatro dados */
function Letreiro() {
  const cells = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const lit = (r === 1 && c === 0) || (r === 1 && c === 1) || (r === 2 && c === 2) || (r === 3 && c === 3);
      cells.push(
        <rect
          key={`${r}-${c}`}
          x={12 + c * 18}
          y={12 + r * 18}
          width={14}
          height={14}
          opacity={lit ? 1 : 0.32}
          fill={lit ? "currentColor" : "none"}
          fillOpacity={lit ? 0.16 : 0}
        />,
      );
    }
  }
  return (
    <svg {...base}>
      {cells}
      <polyline
        points="19,37 37,37 55,55 73,73"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="19" cy="37" r="2.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Dossiê — planta baixa de nove cômodos, um aceso */
function Dossie() {
  return (
    <svg {...base}>
      <rect x="12" y="12" width="72" height="72" />
      <path d="M36 12v72M60 12v72M12 36h72M12 60h72" opacity={0.45} />
      <rect x="36" y="36" width="24" height="24" fill="currentColor" fillOpacity={0.2} stroke="none" />
      {/* vãos de porta */}
      <path d="M42 36h12M42 60h12M36 42v12M60 42v12" stroke="var(--c-bg)" strokeWidth={3.5} />
      {/* foco de luz no cômodo central */}
      <circle cx="48" cy="48" r="7" strokeWidth={2.2} />
      <path d="M48 41v-4M48 59v4M41 48h-4M59 48h4" strokeWidth={2.2} strokeLinecap="round" />
    </svg>
  );
}

/** Domínio — território com hachura e um marcador de exército */
function Dominio() {
  return (
    <svg {...base}>
      <defs>
        <pattern id="dom-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" strokeWidth="1.1" opacity="0.5" />
        </pattern>
      </defs>
      <path d="M14 30 L34 14 L62 18 L82 34 L74 62 L52 82 L26 72 L14 48 Z" opacity={0.55} />
      <path d="M34 14 L46 44 L62 18" opacity={0.4} />
      <path d="M46 44 L74 62" opacity={0.4} />
      <path d="M46 44 L26 72" opacity={0.4} />
      <path d="M34 14 L46 44 L26 72 L14 48 Z" fill="url(#dom-hatch)" stroke="none" />
      {/* torre de exército */}
      <path d="M56 62 h12 v-9 h-3 v-3 h-6 v3 h-3 z" fill="currentColor" fillOpacity={0.85} strokeWidth={1.4} />
    </svg>
  );
}

/** Metrópole — quarteirão isométrico com prédios crescendo */
function Metropole() {
  const block = (x: number, h: number, op: number) => (
    <g key={x} opacity={op}>
      <path d={`M${x} ${72 - h} l12 -7 l12 7 l-12 7 z`} fill="currentColor" fillOpacity={0.22} />
      <path d={`M${x} ${72 - h} v${h} l12 7 v${-h} z`} />
      <path d={`M${x + 24} ${72 - h} v${h} l-12 7 v${-h} z`} fill="currentColor" fillOpacity={0.1} />
    </g>
  );
  return (
    <svg {...base}>
      {block(10, 12, 0.5)}
      {block(34, 24, 0.75)}
      {block(58, 38, 1)}
      <path d="M8 79 L48 56 L88 79" opacity={0.3} strokeDasharray="3 4" />
    </svg>
  );
}

const MAP: Record<GameKey, () => React.JSX.Element> = {
  letreiro: Letreiro,
  dossie: Dossie,
  dominio: Dominio,
  metropole: Metropole,
};

export function Emblem({ game }: { game: GameKey }) {
  const C = MAP[game];
  return <C />;
}
