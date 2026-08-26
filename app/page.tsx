import { GameCard } from "@/components/game-card";
import { JoinForm } from "@/components/join-form";
import { Fleuron, Rosette } from "@/components/ornament";
import { SiteHeader } from "@/components/site-header";
import { GAMES } from "@/lib/games";

const PASSOS = [
  { n: "1", t: "Crie a sala", d: "Escolha o jogo. A sala nasce com um código de seis caracteres." },
  { n: "2", t: "Chame o pessoal", d: "Manda o link, lê o código em voz alta ou aponta a câmera no QR." },
  { n: "3", t: "Joguem", d: "Sem instalar nada. Metade no celular, metade no notebook, todos na mesma mesa." },
];

export default function Home() {
  return (
    <>
      <SiteHeader />

      <main className="relative z-10 mx-auto w-full max-w-6xl px-5 sm:px-8">
        {/* ── hero ────────────────────────────────────────────────────── */}
        <section className="relative pt-8 pb-16 sm:pt-16 sm:pb-24">
          {/* explosão de confete atrás do título */}
          <div
            aria-hidden
            className="pointer-events-none absolute -top-24 right-[-6rem] hidden sm:block"
            style={{ zIndex: -1 }}
          >
            <Rosette size={540} opacity={0.4} />
          </div>

          <p className="eyebrow">Tabuleiro com os amigos, pelo navegador</p>

          <h1 className="mt-5 text-[clamp(3.2rem,13vw,8rem)]">
            <span className="brass-text">A mesa</span>
            <br />
            está posta.
          </h1>

          <div className="mt-7 max-w-2xl">
            <div className="brass-rule max-w-40" />
            <p className="mt-5 text-lg leading-snug sm:text-xl" style={{ color: "var(--fg-mid)" }}>
              Abre o link, digita um apelido e pronto. Quatro clássicos refeitos para funcionar
              online — e <strong style={{ color: "var(--fg)" }}>consertados</strong> nos lugares onde
              todo mundo sabe que eles travam.
            </p>
          </div>

          <div className="mt-10 flex flex-col gap-6 sm:flex-row sm:items-end sm:gap-10">
            <a className="btn btn-brass sm:w-auto" href="#jogos">
              Escolher um jogo
            </a>
            <JoinForm />
          </div>
        </section>

        {/* ── jogos ───────────────────────────────────────────────────── */}
        <section id="jogos" className="scroll-mt-4">
          <div className="flex justify-center">
            <Fleuron width={260} />
          </div>

          <div className="mt-8 mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <h2 className="text-[clamp(1.9rem,5vw,2.8rem)]">Os quatro jogos</h2>
            <p className="max-w-[42ch] text-sm dim">
              Nomes, elenco, mapas e arte 100% autorais. O selo diz em que fase do roadmap cada um
              fica jogável. O Letreiro já dá para jogar agora.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 md:gap-5 xl:gap-6">
            {GAMES.map((g) => (
              <GameCard key={g.key} game={g} />
            ))}
          </div>
        </section>

        {/* ── como funciona ───────────────────────────────────────────── */}
        <section className="mt-20 sm:mt-28">
          <div className="flex justify-center">
            <Fleuron width={200} />
          </div>
          <h2 className="mt-8 text-center text-[clamp(1.9rem,5vw,2.8rem)]">Em quinze segundos</h2>

          <ol className="mt-10 grid gap-4 sm:grid-cols-3">
            {PASSOS.map((p) => (
              <li key={p.n} className="panel p-6">
                <span className="seal">{p.n}</span>
                <h3 className="mt-4 text-xl">{p.t}</h3>
                <p className="mt-2 text-sm leading-relaxed dim">{p.d}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="relative z-10 mx-auto mt-24 w-full max-w-6xl px-5 pb-10 sm:px-8">
        <div className="brass-rule opacity-60" />
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm dim">
          <span>Mesa · em construção</span>
          <a
            className="underline decoration-1 underline-offset-4 hover:text-[var(--vivo-amarelo)]"
            href="https://github.com/MaulXD/Rgames"
            target="_blank"
            rel="noreferrer"
          >
            Código e documentação
          </a>
        </div>
      </footer>
    </>
  );
}
