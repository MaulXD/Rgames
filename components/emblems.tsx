import type { GameKey } from "@/lib/games";

/**
 * Emblemas autorais. Antes eram traço fino e discreto — e discreto é
 * justamente o que fazia a página parecer catálogo. Agora são cheios,
 * pesados e legíveis a distância, como estampa de caixa de jogo.
 *
 * Nenhuma biblioteca de ícones. Ver docs/01-DIRECAO-DE-ARTE.md §4.4.
 */

const SVG = {
  viewBox: "0 0 96 96",
  width: "100%",
  height: "100%",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.4,
  strokeLinejoin: "miter" as const,
  strokeLinecap: "butt" as const,
};

/** Letreiro — bandeja 4×4 com quatro dados acesos e o caminho traçado */
function Letreiro() {
  const tiles: React.JSX.Element[] = [];
  const lit: Record<string, string> = { "1-0": "M", "1-1": "E", "2-2": "S", "3-3": "A" };
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const letter = lit[`${r}-${c}`];
      const x = 9 + c * 20;
      const y = 9 + r * 20;
      tiles.push(
        <g key={`${r}-${c}`}>
          <rect
            x={x}
            y={y}
            width={16}
            height={16}
            rx={1.5}
            fill="currentColor"
            fillOpacity={letter ? 0.92 : 0.13}
            stroke="currentColor"
            strokeWidth={letter ? 0 : 1.6}
            strokeOpacity={0.4}
          />
          {letter && (
            <text
              x={x + 8}
              y={y + 8}
              textAnchor="middle"
              dominantBaseline="central"
              fill="var(--c-bg, #0B2723)"
              stroke="none"
              fontFamily="var(--font-archivo), system-ui, sans-serif"
              fontSize={11}
              fontWeight={800}
            >
              {letter}
            </text>
          )}
        </g>,
      );
    }
  }
  return (
    <svg {...SVG}>
      {tiles}
      <polyline
        points="17,37 37,37 57,57 77,77"
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.95}
      />
      <circle cx="17" cy="37" r="4" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Dossiê — planta de nove cômodos, o do crime aceso, buraco de fechadura */
function Dossie() {
  return (
    <svg {...SVG}>
      <rect x="8" y="8" width="80" height="80" strokeWidth={2.8} />
      <path d="M34.7 8v80M61.3 8v80M8 34.7h80M8 61.3h80" strokeWidth={1.6} opacity={0.42} />
      {/* cômodo aceso */}
      <rect x="34.7" y="34.7" width="26.6" height="26.6" fill="currentColor" fillOpacity={0.9} stroke="none" />
      {/* vãos de porta, abertos na cor do fundo da carta */}
      <path
        d="M42 34.7h12M42 61.3h12M34.7 42v12M61.3 42v12"
        stroke="var(--c-bg, #000)"
        strokeWidth={4.5}
      />
      {/* buraco de fechadura */}
      <g fill="var(--c-bg, #000)" stroke="none">
        <circle cx="48" cy="44.5" r="5" />
        <path d="M45.4 47.5h5.2l1.9 8.5h-9z" />
      </g>
      <path d="M8 8l8 8M88 8l-8 8M8 88l8-8M88 88l-8-8" strokeWidth={2.2} opacity={0.6} />
    </svg>
  );
}

/** Domínio — território hachurado, fronteiras e uma torre de exército */
function Dominio() {
  return (
    <svg {...SVG}>
      <defs>
        <pattern
          id="dom-h"
          width="5"
          height="5"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1="0" y1="0" x2="0" y2="5" stroke="currentColor" strokeWidth="1.8" opacity="0.55" />
        </pattern>
      </defs>
      <path
        d="M10 30 L32 8 L64 12 L88 32 L79 64 L54 89 L24 77 L10 49 Z"
        strokeWidth={2.8}
        fill="currentColor"
        fillOpacity={0.1}
      />
      <path d="M32 8 L46 45 L64 12" strokeWidth={1.7} opacity={0.5} />
      <path d="M46 45 L79 64M46 45 L24 77" strokeWidth={1.7} opacity={0.5} />
      <path d="M32 8 L46 45 L24 77 L10 49 Z" fill="url(#dom-h)" stroke="none" />
      {/* torre */}
      <g stroke="none" fill="currentColor">
        <path d="M55 66h18V52h-4v-5h-4v5h-2v-5h-4v5h-4z" />
        <rect x="52" y="66" width="24" height="5" rx="1" />
      </g>
    </svg>
  );
}

/** Metrópole — quarteirão isométrico com prédios crescendo e janelas acesas */
function Metropole() {
  const block = (x: number, h: number, op: number, win: number) => (
    <g key={x}>
      {/* topo */}
      <path d={`M${x} ${74 - h} l13 -7.5 l13 7.5 l-13 7.5 z`} fill="currentColor" fillOpacity={0.85} stroke="none" />
      {/* face esquerda */}
      <path d={`M${x} ${74 - h} v${h} l13 7.5 v${-h} z`} fill="currentColor" fillOpacity={0.42 * op} stroke="none" />
      {/* face direita */}
      <path d={`M${x + 26} ${74 - h} v${h} l-13 7.5 v${-h} z`} fill="currentColor" fillOpacity={0.2 * op} stroke="none" />
      {/* contorno */}
      <path
        d={`M${x} ${74 - h} l13 -7.5 l13 7.5 v${h} l-13 7.5 l-13 -7.5 z`}
        strokeWidth={2}
      />
      <path d={`M${x + 13} ${74 - h + 7.5} v${h}`} strokeWidth={1.4} opacity={0.55} />
      {/* janelas acesas */}
      {Array.from({ length: win }, (_, i) => (
        <rect
          key={i}
          x={x + 3.5}
          y={74 - h + 13 + i * 8}
          width={4}
          height={4.5}
          fill="currentColor"
          fillOpacity={0.95}
          stroke="none"
        />
      ))}
    </g>
  );
  return (
    <svg {...SVG}>
      {block(6, 14, 1, 1)}
      {block(32, 30, 1, 2)}
      {block(58, 46, 1, 4)}
      <path d="M4 84 L48 59 L92 84" strokeWidth={1.8} opacity={0.35} strokeDasharray="4 5" />
    </svg>
  );
}

const MAP: Record<GameKey, () => React.JSX.Element> = {
  letreiro: Letreiro,
  dossie: Dossie,
  dominio: Dominio,
  metropole: Metropole,
};

export function Emblem({ game, size = 108 }: { game: GameKey; size?: number }) {
  const C = MAP[game];
  return (
    <span style={{ display: "block", width: size, height: size }}>
      <C />
    </span>
  );
}
