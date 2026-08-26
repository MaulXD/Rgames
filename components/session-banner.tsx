"use client";

import { useSession } from "@/components/session";

/**
 * Falha de sessão precisa ser barulhenta.
 *
 * Antes, quando a sessão não abria, o único sinal era uma linha cinza dentro
 * de cada carta — e o botão simplesmente não respondia. "Nenhum jogo tá
 * criando a sala" foi exatamente esse silêncio. Agora a página inteira diz o
 * que está errado e o que fazer.
 */
export function SessionBanner() {
  const { status, error } = useSession();
  if (status !== "error") return null;

  return (
    <div
      role="alert"
      className="relative z-40 px-5 py-3 sm:px-8"
      style={{
        background: "linear-gradient(180deg, #7d2418, #5e1a10)",
        borderBottom: "1px solid #a8402f",
        boxShadow: "0 6px 20px -8px rgb(0 0 0 / .7)",
      }}
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-baseline gap-x-3 gap-y-1">
        <strong
          style={{
            fontFamily: "var(--font-archivo), sans-serif",
            fontSize: "0.7rem",
            fontWeight: 700,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "#ffd9cf",
          }}
        >
          Sessão não abriu
        </strong>
        <span className="text-sm" style={{ color: "#ffeae4" }}>
          {error ?? "Erro desconhecido."} Sem sessão, criar sala não funciona.
        </span>
      </div>
    </div>
  );
}
