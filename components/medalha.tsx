import type { Glifo } from "@/lib/gamificacao";

const INK = "#1D1526";

/** Glifos autorais, na mesma grade dos ícones do site. Nada de biblioteca. */
function glifoPath(g: Glifo): string {
  switch (g) {
    case "estrela": {
      const pts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 26 : 11;
        const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
        pts.push(`${(50 + r * Math.cos(a)).toFixed(1)},${(50 + r * Math.sin(a)).toFixed(1)}`);
      }
      return `M${pts.join("L")}Z`;
    }
    case "raio":
      return "M57 22 L34 54 h12 l-6 24 24-32 h-12 z";
    case "coroa":
      return "M28 66 h44 v-8 H28z M28 54 l8-16 7 10 7-17 7 17 7-10 8 16z";
    case "chave":
      return "M50 24a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 6a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM46 44h8v32h-8zM54 56h10v6H54zM54 66h8v6h-8z";
    case "lua":
      return "M60 24a26 26 0 1 0 0 52 22 22 0 1 1 0-52z";
    case "olho":
      return "M50 32c15 0 26 11 28 18-2 7-13 18-28 18s-26-11-28-18c2-7 13-18 28-18zm0 9a9 9 0 1 0 0 18 9 9 0 0 0 0-18z";
    case "bussola": {
      const pts: string[] = [];
      for (let i = 0; i < 8; i++) {
        const r = i % 2 === 0 ? 27 : 9;
        const a = -Math.PI / 2 + (i / 8) * Math.PI * 2;
        pts.push(`${(50 + r * Math.cos(a)).toFixed(1)},${(50 + r * Math.sin(a)).toFixed(1)}`);
      }
      return `M${pts.join("L")}Z`;
    }
    case "fogo":
      return "M50 20c11 13 17 21 17 32a17 17 0 0 1-34 0c0-11 6-19 17-32zm0 19c-4 6-6 11-6 15a6 6 0 0 0 12 0c0-4-2-9-6-15z";
  }
}

/**
 * A medalha. Disco de cor viva com contorno grosso e o glifo em cima.
 * Sem conquista: fica em cinza, para você ver o que ainda falta — o buraco na
 * coleção é metade da graça.
 */
export function Medalha({
  glifo,
  cor,
  size = 56,
  conquistada = true,
  title,
}: {
  glifo: Glifo;
  cor: string;
  size?: number;
  conquistada?: boolean;
  title?: string;
}) {
  const fundo = conquistada ? cor : "#2C6D5B";
  const tinta = conquistada ? INK : "#0B2723";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ display: "block", flex: "none", opacity: conquistada ? 1 : 0.45 }}
    >
      <circle cx="50" cy="50" r="45" fill={fundo} stroke={INK} strokeWidth="5" />
      <circle cx="50" cy="50" r="37" fill="none" stroke={INK} strokeWidth="2.5" opacity="0.35" />
      {conquistada && (
        <ellipse cx="36" cy="30" rx="16" ry="9" fill="#fff" opacity="0.28" transform="rotate(-22 36 30)" />
      )}
      <path d={glifoPath(glifo)} fill={tinta} />
    </svg>
  );
}
