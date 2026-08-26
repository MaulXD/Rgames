"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { CODE_LENGTH, isCompleteCode, sanitizeCode } from "@/lib/games";

export function JoinForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const ready = isCompleteCode(code);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (ready) router.push(`/j/${code}`);
  }

  return (
    <form onSubmit={onSubmit} className="w-full max-w-sm">
      <label htmlFor="code" className="eyebrow mb-2 block">
        Tenho um código
      </label>
      <div className="code-field">
        <input
          id="code"
          value={code}
          onChange={(e) => setCode(sanitizeCode(e.target.value))}
          placeholder="ABC234"
          maxLength={CODE_LENGTH}
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          aria-describedby="code-help"
        />
        <button type="submit" className="btn btn-primary" disabled={!ready}>
          Entrar
        </button>
      </div>
      <p id="code-help" className="mt-2 text-xs" style={{ color: "var(--fg-faint)" }}>
        Seis caracteres. Sem <span className="mono">I</span>, <span className="mono">L</span>,{" "}
        <span className="mono">O</span>, <span className="mono">0</span> ou{" "}
        <span className="mono">1</span> — ninguém erra ao ler em voz alta.
      </p>
    </form>
  );
}
