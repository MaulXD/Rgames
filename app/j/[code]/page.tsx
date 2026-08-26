import { notFound } from "next/navigation";
import { Lobby } from "@/components/lobby";
import { SiteHeader } from "@/components/site-header";
import { isCompleteCode, sanitizeCode } from "@/lib/games";

export default async function SalaPage({ params }: PageProps<"/j/[code]">) {
  const { code: raw } = await params;
  const code = sanitizeCode(decodeURIComponent(raw));

  if (!isCompleteCode(code)) notFound();

  return (
    <>
      <SiteHeader />
      <main className="relative z-10 mx-auto w-full max-w-3xl flex-1 px-5 py-8 sm:px-8 sm:py-12">
        <Lobby code={code} />
      </main>
    </>
  );
}
