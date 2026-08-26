import {
  COLORS,
  avatarKey,
  bodyPath,
  hatAnchor,
  type AvatarSpec,
  type Eyes,
  type Hat,
  type Mouth,
} from "@/lib/avatar";

const OUTLINE = "#1D1526";
const WHITE = "#FFFFFF";

/** Olhos — dois de cada, em x 39 e 61. */
function Olhos({ kind, ink }: { kind: Eyes; ink: string }) {
  const par = (node: (x: number, sinal: number) => React.ReactNode) => (
    <>
      {node(39, 1)}
      {node(61, -1)}
    </>
  );

  switch (kind) {
    case "normal":
      return par((x) => (
        <g key={x}>
          <circle cx={x} cy={52} r={6.4} fill={OUTLINE} />
          <circle cx={x + 2} cy={50} r={2.1} fill={WHITE} />
        </g>
      ));
    case "feliz":
      return par((x) => (
        <path
          key={x}
          d={`M${x - 7} 54 Q${x} 43 ${x + 7} 54`}
          stroke={OUTLINE}
          strokeWidth={4}
          fill="none"
          strokeLinecap="round"
        />
      ));
    case "sono":
      return par((x) => (
        <g key={x}>
          <path
            d={`M${x - 7} 52 Q${x} 58 ${x + 7} 52`}
            stroke={OUTLINE}
            strokeWidth={4}
            fill="none"
            strokeLinecap="round"
          />
        </g>
      ));
    case "uau":
      return par((x) => (
        <g key={x}>
          <circle cx={x} cy={52} r={9} fill={WHITE} stroke={OUTLINE} strokeWidth={3} />
          <circle cx={x} cy={52} r={4} fill={OUTLINE} />
        </g>
      ));
    case "esperto":
      return (
        <>
          <circle cx={39} cy={52} r={6.4} fill={OUTLINE} />
          <circle cx={41} cy={50} r={2.1} fill={WHITE} />
          <path
            d="M54 52 Q61 58 68 52"
            stroke={OUTLINE}
            strokeWidth={4}
            fill="none"
            strokeLinecap="round"
          />
        </>
      );
    case "brilho":
      return par((x) => (
        <g key={x}>
          <circle cx={x} cy={52} r={7.4} fill={OUTLINE} />
          <circle cx={x + 2.4} cy={49.4} r={2.8} fill={WHITE} />
          <circle cx={x - 2.6} cy={54.6} r={1.4} fill={WHITE} opacity={0.85} />
          <path
            d={`M${x + 8} 43 l1.5 3.2 3.2 1.5 -3.2 1.5 -1.5 3.2 -1.5 -3.2 -3.2 -1.5 3.2 -1.5Z`}
            fill={ink === "#FFFFFF" ? WHITE : "#FFF6B0"}
          />
        </g>
      ));
  }
}

/** Boca — centrada em 50, y ≈ 68. */
function Boca({ kind }: { kind: Mouth }) {
  switch (kind) {
    case "sorriso":
      return (
        <path
          d="M38 66 Q50 77 62 66"
          stroke={OUTLINE}
          strokeWidth={4}
          fill="none"
          strokeLinecap="round"
        />
      );
    case "riso":
      return (
        <g>
          <path d="M37 65 Q50 80 63 65 Z" fill={OUTLINE} />
          <path d="M45 74 Q50 80 55 74 Z" fill="#FF7C93" />
        </g>
      );
    case "bico":
      return <circle cx={50} cy={69} r={5} fill={OUTLINE} />;
    case "lingua":
      return (
        <g>
          <path
            d="M38 65 Q50 76 62 65"
            stroke={OUTLINE}
            strokeWidth={4}
            fill="none"
            strokeLinecap="round"
          />
          <path d="M46 72 Q50 80 54 72 Z" fill="#FF7C93" />
        </g>
      );
    case "serio":
      return (
        <path d="M41 70 H59" stroke={OUTLINE} strokeWidth={4} strokeLinecap="round" />
      );
    case "assobio":
      return (
        <ellipse cx={50} cy={69} rx={4} ry={5.6} fill={OUTLINE} />
      );
  }
}

/** Chapéu e acessório, apoiados no topo da silhueta. */
function Chapeu({ kind, x, y }: { kind: Hat; x: number; y: number }) {
  if (kind === "nenhum") return null;
  if (kind === "oculos") {
    return (
      <g stroke={OUTLINE} strokeWidth={3.4} fill="none">
        <circle cx={39} cy={52} r={11} fill="#FFFFFF" fillOpacity={0.34} />
        <circle cx={61} cy={52} r={11} fill="#FFFFFF" fillOpacity={0.34} />
        <path d="M50 52 h0" />
        <path d="M28 50 l-6 -3M72 50 l6 -3" strokeLinecap="round" />
      </g>
    );
  }
  return (
    <g transform={`translate(${x} ${y})`}>
      {kind === "coroa" && (
        <g>
          <path
            d="M-19 2 L-19 -12 L-10 -4 L0 -16 L10 -4 L19 -12 L19 2 Z"
            fill="#FFC42E"
            stroke={OUTLINE}
            strokeWidth={3.4}
            strokeLinejoin="round"
          />
          <circle cx={0} cy={-19} r={3.2} fill="#FF4D5E" stroke={OUTLINE} strokeWidth={2.4} />
        </g>
      )}
      {kind === "boina" && (
        <g>
          <path
            d="M-20 1 Q-18 -14 0 -14 Q18 -14 20 1 Z"
            fill="#2E8CFF"
            stroke={OUTLINE}
            strokeWidth={3.4}
            strokeLinejoin="round"
          />
          <circle cx={2} cy={-17} r={3.4} fill="#2E8CFF" stroke={OUTLINE} strokeWidth={2.6} />
        </g>
      )}
      {kind === "laco" && (
        <g stroke={OUTLINE} strokeWidth={3.2} strokeLinejoin="round">
          <path d="M-3 0 L-18 -9 L-18 5 Z" fill="#FF6FA5" />
          <path d="M3 0 L18 -9 L18 5 Z" fill="#FF6FA5" />
          <circle cx={0} cy={-2} r={4} fill="#FF4D5E" />
        </g>
      )}
      {kind === "antena" && (
        <g stroke={OUTLINE} strokeWidth={3.4} strokeLinecap="round">
          <path d="M0 2 L0 -14" />
          <circle cx={0} cy={-19} r={5} fill="#5FD13A" />
        </g>
      )}
      {kind === "pena" && (
        <g stroke={OUTLINE} strokeWidth={3} strokeLinejoin="round">
          <path d="M2 2 Q-6 -12 4 -22 Q14 -12 8 2 Z" fill="#2FD8C4" />
          <path d="M5 1 L5 -19" strokeWidth={2} />
        </g>
      )}
    </g>
  );
}

/**
 * O bichinho. Contorno grosso, barriga clara, bochecha rosada — a receita de
 * brinquedo. Ver docs/01-DIRECAO-DE-ARTE.md §3.
 */
export function Avatar({
  spec,
  size = 64,
  title,
}: {
  spec: AvatarSpec;
  size?: number;
  title?: string;
}) {
  const c = COLORS[spec.color];
  const uid = `av-${avatarKey(spec)}`;
  const path = bodyPath(spec.body);
  const anchor = hatAnchor(spec.body);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ display: "block", flex: "none", overflow: "visible" }}
    >
      <defs>
        <clipPath id={`${uid}-clip`}>
          <path d={path} />
        </clipPath>
      </defs>

      {/* corpo com contorno grosso */}
      <path d={path} fill={c.enamel} stroke={OUTLINE} strokeWidth={4.2} strokeLinejoin="round" />

      {/* barriga clara e brilho, recortados no corpo */}
      <g clipPath={`url(#${uid}-clip)`}>
        <ellipse cx={50} cy={82} rx={30} ry={20} fill={c.light} opacity={0.55} />
        <ellipse cx={34} cy={32} rx={16} ry={10} fill="#FFFFFF" opacity={0.3} transform="rotate(-20 34 32)" />
        <ellipse cx={26} cy={26} rx={7} ry={13} fill={c.light} opacity={0.5} />
      </g>

      {/* bochechas */}
      <circle cx={26} cy={63} r={5.4} fill="#FF7C93" opacity={0.5} />
      <circle cx={74} cy={63} r={5.4} fill="#FF7C93" opacity={0.5} />

      <Olhos kind={spec.eyes} ink={c.ink} />
      <Boca kind={spec.mouth} />
      <Chapeu kind={spec.hat} x={anchor.x} y={anchor.y} />
    </svg>
  );
}
