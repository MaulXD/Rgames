import Link from "next/link";
import type { Metadata } from "next";
import { AvatarStudio } from "@/components/avatar-studio";

export const metadata: Metadata = {
  title: "Sua ficha — Mesa",
  description:
    "Monte sua ficha: forma, esmalte, hachura, metal e brasão. A hachura e o brasão também servem para quem não distingue as cores.",
};

export default function PerfilPage() {
  return (
    <main className="relative z-10 mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-16">
      <div className="brass-rule mb-8 max-w-24" />
      <p className="eyebrow">Perfil</p>
      <h1 className="mt-3 text-[clamp(2.1rem,7vw,3.4rem)] leading-[0.95]">Sua ficha</h1>
      <p className="mt-4 max-w-[54ch]" style={{ color: "var(--fg-mid)" }}>
        Uma peça de esmalte e metal, não uma foto. A hachura e o brasão não são
        enfeite: são o que distingue você de outro jogador para quem não separa
        as cores.
      </p>

      <div className="mt-10">
        <AvatarStudio />
      </div>

      <p className="mt-12 text-sm" style={{ color: "var(--fg-faint)" }}>
        Fica salvo mesmo sem conta — você entrou como convidado e isso já é um
        usuário de verdade no servidor.{" "}
        <Link href="/" className="underline decoration-1 underline-offset-4">
          Voltar para a mesa
        </Link>
      </p>
    </main>
  );
}
