import Link from "next/link";
import { Diario } from "@/components/diario";
import { SiteHeader } from "@/components/site-header";

export const metadata = {
  title: "Desafio diário · Mesa",
  description: "Uma grade por dia, a mesma para todo mundo. Três minutos, uma tentativa.",
};

export default function Pagina() {
  return (
    <>
      <SiteHeader />
      <main className="relative z-10 mx-auto w-full max-w-3xl px-5 pb-16 sm:px-8">
        <div className="py-6">
          <Link href="/" className="eyebrow" style={{ color: "var(--fg-faint)" }}>
            ← Mesa
          </Link>
          <h1 className="mt-3 text-[clamp(2.2rem,9vw,3.4rem)]">
            <span className="brass-text">Desafio</span> diário
          </h1>
          <p className="mt-4 max-w-[46ch] text-lg leading-snug" style={{ color: "var(--fg-mid)" }}>
            Uma grade por dia, a mesma para todo mundo. Três minutos, uma tentativa — e no dia
            seguinte dá para perguntar se alguém achou a palavra que você achou.
          </p>
        </div>
        <Diario />
      </main>
    </>
  );
}
