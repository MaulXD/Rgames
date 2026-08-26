import { GameCard } from "@/components/game-card";
import { SiteHeader } from "@/components/site-header";
import { JoinForm } from "@/components/join-form";
import { GAMES } from "@/lib/games";

const PASSOS = [
  {
    n: "01",
    t: "Crie a sala",
    d: "Escolha o jogo. A sala nasce com um código de seis caracteres.",
  },
  {
    n: "02",
    t: "Chame o pessoal",
    d: "Manda o link, lê o código em voz alta ou aponta a câmera no QR.",
  },
  {
    n: "03",
    t: "Joguem",
    d: "Sem instalar nada. Metade no celular, metade no notebook, todo mundo na mesma mesa.",
  },
];

export default function Home() {
  return (
    <>
      <SiteHeader />

      <main className="relative z-10 mx-auto w-full max-w-6xl px-5 sm:px-8">
        {/* ── hero ────────────────────────────────────────────────────── */}
        <section className="pt-10 pb-14 sm:pt-20 sm:pb-24">
          <div className="brass-rule mb-8 max-w-24" />
          <p className="eyebrow">Tabuleiro com os amigos, pelo navegador</p>
          <h1
            className="mt-4 text-[clamp(2.9rem,11vw,6.5rem)] leading-[0.9]"
            style={{
              fontVariationSettings: '"SOFT" 0, "WONK" 1, "opsz" 144',
              fontWeight: 700,
              letterSpacing: "-0.035em",
            }}
          >
            A mesa está
            <br />
            posta.
          </h1>

          <p
            className="mt-6 max-w-[42ch] text-lg leading-snug sm:text-xl"
            style={{ color: "var(--fg-mid)" }}
          >
            Abre o link, digita um apelido e pronto. Quatro clássicos refeitos
            para funcionar online — e{" "}
            <strong style={{ color: "var(--fg)", fontWeight: 600 }}>
              consertados
            </strong>{" "}
            nos lugares onde todo mundo sabe que eles travam.
          </p>

          <div className="mt-9 flex flex-col gap-5 sm:flex-row sm:items-end sm:gap-8">
            <a className="btn btn-primary w-full sm:w-auto" href="#jogos">
              Criar uma sala
            </a>
            <JoinForm />
          </div>
        </section>

        {/* ── jogos ───────────────────────────────────────────────────── */}
        <section id="jogos" className="scroll-mt-6 border-t pt-12 sm:pt-16" style={{ borderColor: "var(--line)" }}>
          <div className="mb-8 flex flex-wrap items-baseline gap-x-5 gap-y-2">
            <h2 className="text-[clamp(1.7rem,4vw,2.4rem)]">Os quatro jogos</h2>
            <p className="max-w-[46ch] text-sm" style={{ color: "var(--fg-dim)" }}>
              Nomes, elenco, mapas e arte 100% autorais. Lançamento em sequência,
              começando pelo Letreiro.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 sm:gap-5 xl:gap-6">
            {GAMES.map((g) => (
              <GameCard key={g.key} game={g} />
            ))}
          </div>
        </section>

        {/* ── como funciona ───────────────────────────────────────────── */}
        <section className="mt-16 border-t pt-12 sm:mt-24 sm:pt-16" style={{ borderColor: "var(--line)" }}>
          <h2 className="text-[clamp(1.7rem,4vw,2.4rem)]">Em quinze segundos</h2>
          <ol className="mt-8 grid gap-px overflow-hidden sm:grid-cols-3" style={{ background: "var(--line)" }}>
            {PASSOS.map((p) => (
              <li key={p.n} className="p-6" style={{ background: "var(--bg-sunk)" }}>
                <span className="mono text-xs tracking-[0.16em]" style={{ color: "var(--accent)" }}>
                  {p.n}
                </span>
                <h3 className="mt-2 text-xl">{p.t}</h3>
                <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--fg-dim)" }}>
                  {p.d}
                </p>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer
        className="relative z-10 mx-auto mt-20 flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 border-t px-5 py-8 text-sm sm:px-8"
        style={{ borderColor: "var(--line-strong)", color: "var(--fg-faint)" }}
      >
        <span>Mesa · em construção</span>
        <a
          className="underline decoration-1 underline-offset-4"
          href="https://github.com/MaulXD/Rgames"
          target="_blank"
          rel="noreferrer"
        >
          Código e documentação
        </a>
      </footer>
    </>
  );
}
