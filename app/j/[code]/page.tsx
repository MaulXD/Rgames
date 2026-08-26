import Link from "next/link";
import { notFound } from "next/navigation";
import { isCompleteCode, sanitizeCode } from "@/lib/games";

export default async function SalaPage({ params }: PageProps<"/j/[code]">) {
  const { code: raw } = await params;
  const code = sanitizeCode(decodeURIComponent(raw));

  if (!isCompleteCode(code)) notFound();

  return (
    <main className="relative z-10 mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-5 py-16 sm:px-8">
      <div className="brass-rule mb-8 max-w-24" />
      <p className="eyebrow">Sala</p>

      <p
        className="mono mt-3 text-[clamp(2.6rem,14vw,5rem)] leading-none"
        style={{ letterSpacing: "0.12em" }}
      >
        {code.slice(0, 3)}
        <span style={{ color: "var(--fg-faint)" }}>·</span>
        {code.slice(3)}
      </p>

      <h1 className="mt-8 text-[clamp(1.6rem,5vw,2.3rem)]">
        Esta sala ainda não existe.
      </h1>

      <p className="mt-4 max-w-[52ch]" style={{ color: "var(--fg-mid)" }}>
        O código é válido e a rota funciona — falta o outro lado. Salas de
        verdade chegam junto com o Supabase: presença ao vivo, assentos, cores e
        o estado da partida guardado no servidor.
      </p>

      <div className="mt-9 flex flex-wrap gap-3">
        <Link className="btn btn-primary" href="/">
          Voltar para a mesa
        </Link>
        <a
          className="btn btn-ghost"
          href="https://github.com/MaulXD/Rgames/blob/main/docs/00-PRD-PLATAFORMA.md"
          target="_blank"
          rel="noreferrer"
        >
          Como as salas vão funcionar
        </a>
      </div>
    </main>
  );
}
