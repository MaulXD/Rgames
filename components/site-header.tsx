"use client";

import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { useSession } from "@/components/session";
import { DEFAULT_AVATAR, parseAvatar } from "@/lib/avatar";

export function SiteHeader() {
  const { status, profile } = useSession();
  const spec = profile ? parseAvatar(profile.avatar) : DEFAULT_AVATAR;
  const named = profile && profile.display_name !== "Convidado";

  return (
    <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8 sm:py-5">
      <Link
        href="/"
        className="text-2xl leading-none"
        style={{
          fontFamily: "var(--font-fraunces), Georgia, serif",
          fontVariationSettings: '"SOFT" 0, "WONK" 1, "opsz" 96',
          fontWeight: 700,
          letterSpacing: "-0.03em",
        }}
      >
        Mesa
      </Link>

      <Link
        href="/perfil"
        className="flex items-center gap-3 py-1 pl-1 pr-3 transition-colors"
        style={{
          border: "3px solid var(--ink)",
          borderRadius: 999,
          minHeight: 46,
          background: "rgb(7 28 26 / .5)",
          fontWeight: 700,
        }}
      >
        {status === "ready" ? (
          <Avatar spec={spec} size={34} />
        ) : (
          <span
            className="block h-[34px] w-[34px] rounded-full"
            style={{ background: "var(--line)", border: "3px solid var(--ink)" }}
            aria-hidden
          />
        )}
        <span className="text-sm font-medium">
          {status === "ready" ? (named ? profile!.display_name : "Montar bichinho") : "…"}
        </span>
      </Link>
    </header>
  );
}
