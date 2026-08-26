import {
  COLORS,
  METAL_TONES,
  avatarKey,
  markPath,
  shapePath,
  type AvatarSpec,
} from "@/lib/avatar";

/**
 * Ficha de esmalte e metal. Metal é literalmente gradiente, então é a única
 * exceção à proibição de gradiente (ver docs/01-DIRECAO-DE-ARTE.md §4.3).
 * O resto é cor chapada, hachura e um reflexo especular no esmalte.
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
  const m = METAL_TONES[spec.metal];
  const uid = `av-${avatarKey(spec)}`;

  const hatch = () => {
    const stroke = c.ink;
    switch (spec.pattern) {
      case "liso":
        return null;
      case "diagonal":
        return (
          <pattern id={`${uid}-p`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="7" stroke={stroke} strokeWidth="2" opacity="0.16" />
          </pattern>
        );
      case "vertical":
        return (
          <pattern id={`${uid}-p`} width="8" height="8" patternUnits="userSpaceOnUse">
            <line x1="1" y1="0" x2="1" y2="8" stroke={stroke} strokeWidth="2.2" opacity="0.15" />
          </pattern>
        );
      case "grade":
        return (
          <pattern id={`${uid}-p`} width="9" height="9" patternUnits="userSpaceOnUse">
            <path d="M0 0H9M0 0V9" stroke={stroke} strokeWidth="1.4" opacity="0.17" fill="none" />
          </pattern>
        );
      case "pontos":
        return (
          <pattern id={`${uid}-p`} width="9" height="9" patternUnits="userSpaceOnUse">
            <circle cx="4.5" cy="4.5" r="1.7" fill={stroke} opacity="0.2" />
          </pattern>
        );
      case "raios":
        return (
          <pattern id={`${uid}-p`} width="100" height="100" patternUnits="userSpaceOnUse">
            {Array.from({ length: 12 }, (_, i) => (
              <line
                key={i}
                x1="50"
                y1="50"
                x2={50 + 70 * Math.cos((i / 12) * Math.PI * 2)}
                y2={50 + 70 * Math.sin((i / 12) * Math.PI * 2)}
                stroke={stroke}
                strokeWidth="3"
                opacity="0.13"
              />
            ))}
          </pattern>
        );
    }
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ display: "block", flex: "none" }}
    >
      <defs>
        <linearGradient id={`${uid}-metal`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={m.hi} />
          <stop offset="28%" stopColor={m.mid} />
          <stop offset="55%" stopColor={m.lo} />
          <stop offset="78%" stopColor={m.mid} />
          <stop offset="100%" stopColor={m.hi} />
        </linearGradient>
        <radialGradient id={`${uid}-enamel`} cx="34%" cy="26%" r="82%">
          <stop offset="0%" stopColor={c.enamel} />
          <stop offset="72%" stopColor={c.enamel} />
          <stop offset="100%" stopColor={c.deep} />
        </radialGradient>
        <clipPath id={`${uid}-clip`}>
          <path d={shapePath(spec.shape, 39)} />
        </clipPath>
        {hatch()}
      </defs>

      {/* aro de metal */}
      <path d={shapePath(spec.shape, 47)} fill={`url(#${uid}-metal)`} />
      <path d={shapePath(spec.shape, 43)} fill={m.lo} opacity="0.55" />

      {/* campo de esmalte */}
      <path d={shapePath(spec.shape, 39)} fill={`url(#${uid}-enamel)`} />
      {spec.pattern !== "liso" && (
        <path d={shapePath(spec.shape, 39)} fill={`url(#${uid}-p)`} />
      )}

      {/* brasão gravado: sombra de sulco + relevo */}
      <g clipPath={`url(#${uid}-clip)`}>
        <path d={markPath(spec.mark)} fill={c.deep} opacity="0.85" transform="translate(0,1.4)" />
        <path d={markPath(spec.mark)} fill={c.ink} opacity="0.92" />
      </g>

      {/* reflexo especular do esmalte */}
      <g clipPath={`url(#${uid}-clip)`}>
        <ellipse cx="34" cy="24" rx="26" ry="14" fill="#fff" opacity="0.14" transform="rotate(-22 34 24)" />
      </g>
    </svg>
  );
}
