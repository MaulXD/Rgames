"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Board } from "@/components/letreiro/board";
import { Reveal } from "@/components/letreiro/reveal";
import { Avatar } from "@/components/avatar";
import { useSession } from "@/components/session";
import { supabaseBrowser } from "@/lib/supabase/client";
import { parseAvatar } from "@/lib/avatar";
import {
  REJECTION,
  findPath,
  normalize,
  pathToString,
  pathWord,
  score,
  type PlayerWord,
} from "@/lib/letreiro";

export type MatchRow = {
  id: string;
  status: string;
  ends_at: string;
  public_state: {
    phase: string;
    grid: string[];
    mode?: string;
    scoring?: string;
    seconds?: number;
    counts?: Record<string, number>;
    found?: Record<string, { w: string; p: string; pts: number; dup: boolean }[]>;
    missed?: { w: string; p: string; pts: number }[];
    scores?: Record<string, number>;
    maxScore?: number;
    wordCount?: number;
  };
};

export type Seat = {
  user_id: string;
  display_name: string;
  avatar: unknown;
};

export function LetreiroGame({
  match,
  seats,
  onLeaveMatch,
}: {
  match: MatchRow;
  seats: Seat[];
  onLeaveMatch: () => void;
}) {
  const { user } = useSession();
  const grid = match.public_state.grid;

  // Dois modos de entrada, um estado cada. O caminho efetivo e derivado:
  // quando existe texto digitado, ele manda; senao vale o que o dedo tracou.
  const [tapPath, setTapPath] = useState<number[]>([]);
  const [typed, setTyped] = useState("");
  const [words, setWords] = useState<PlayerWord[]>([]);
  const [flash, setFlash] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const [left, setLeft] = useState<number>(0);
  const offset = useRef(0);

  const revealing = match.public_state.phase === "reveal" || match.status === "finished";

  /* ── relógio do servidor ────────────────────────────────────────────────
     O cliente não conta o tempo sozinho: mede o desvio do próprio relógio
     contra o cabeçalho Date do servidor. Máquina com hora errada não quebra
     o cronômetro. */
  useEffect(() => {
    let alive = true;
    async function medir() {
      try {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
        const t0 = Date.now();
        const r = await fetch(`${url}/rest/v1/`, { method: "HEAD", cache: "no-store" });
        const t1 = Date.now();
        const server = r.headers.get("date");
        if (server && alive) {
          offset.current = new Date(server).getTime() + (t1 - t0) / 2 - t1;
        }
      } catch {
        /* sem medição: cai no relógio local */
      }
    }
    void medir();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (revealing) return;
    const fim = new Date(match.ends_at).getTime();
    const tick = () => {
      const agora = Date.now() + offset.current;
      setLeft(Math.max(0, Math.ceil((fim - agora) / 1000)));
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [match.ends_at, revealing]);

  /* ── minha lista, ao entrar ou reconectar ──────────────────────────────── */
  useEffect(() => {
    let alive = true;
    async function carregar() {
      const sb = supabaseBrowser();
      const { data } = await sb
        .from("match_private_state")
        .select("data")
        .eq("match_id", match.id)
        .maybeSingle();
      if (!alive) return;
      const lista = (data as { data?: { words?: PlayerWord[] } } | null)?.data?.words ?? [];
      setWords(lista.map((w) => ({ ...w, confirmed: true })));
    }
    void carregar();
    return () => {
      alive = false;
    };
  }, [match.id]);

  /* ── digitação ─────────────────────────────────────────────────────────── */
  const pathForTyped = useMemo(
    () => (typed.length >= 1 ? findPath(grid, typed) : null),
    [grid, typed],
  );

  const path = useMemo(
    () => (typed ? (pathForTyped ?? []) : tapPath),
    [typed, pathForTyped, tapPath],
  );
  const current = typed ? normalize(typed) : pathWord(grid, path);
  const trailState: "idle" | "ok" | "bad" =
    !current || current.length < 3 ? "idle" : typed && !pathForTyped ? "bad" : "ok";

  const limpar = useCallback(() => {
    setTapPath([]);
    setTyped("");
  }, []);

  const submit = useCallback(
    async (palavra: string, caminho: number[]) => {
      const w = normalize(palavra);
      if (w.length < 3 || caminho.length < 2) return;

      if (words.some((x) => x.w === w && !x.rejected)) {
        setFlash({ kind: "bad", text: `${w} — ${REJECTION.REPEATED}` });
        limpar();
        return;
      }

      const pts = score(w.length);
      const p = pathToString(caminho);

      // otimista: a palavra sobe para a lista antes do servidor responder
      setWords((prev) => [{ w, p, pts, confirmed: false }, ...prev]);
      limpar();

      const sb = supabaseBrowser();
      const { data, error } = await sb.rpc("letreiro_submit", {
        p_match: match.id,
        p_word: w,
        p_path: p,
      });

      const res = data as { ok?: boolean; reason?: string } | null;
      if (error || !res?.ok) {
        const motivo = error ? "TIME_OVER" : (res?.reason ?? "NOT_A_WORD");
        setWords((prev) => prev.filter((x) => !(x.w === w && !x.confirmed)));
        setFlash({ kind: "bad", text: `${w} — ${REJECTION[motivo] ?? motivo}` });
        return;
      }
      setWords((prev) => prev.map((x) => (x.w === w ? { ...x, confirmed: true } : x)));
      setFlash({ kind: "ok", text: `${w} · +${pts}` });
    },
    [match.id, words, limpar],
  );

  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 1400);
    return () => clearTimeout(id);
  }, [flash]);

  /* ── teclado ───────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (revealing) return;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Enter") {
        e.preventDefault();
        const alvo = typed ? pathForTyped : path;
        if (alvo && alvo.length >= 2) void submit(pathWord(grid, alvo), alvo);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        limpar();
        return;
      }
      if (e.key === "Backspace") {
        e.preventDefault();
        if (typed) setTyped((t) => t.slice(0, -1));
        else setTapPath((p) => p.slice(0, -1));
        return;
      }
      if (/^[a-zA-ZçÇáàâãéêíóôõúüÁÀÂÃÉÊÍÓÔÕÚÜ]$/.test(e.key)) {
        e.preventDefault();
        setTyped((t) => (t + e.key).slice(0, 16));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [revealing, typed, path, pathForTyped, grid, submit, limpar]);

  /* ── placar ao vivo ────────────────────────────────────────────────────── */
  const counts = match.public_state.counts ?? {};
  const meus = words.filter((w) => !w.rejected);
  const meuTotal = meus.reduce((s, w) => s + w.pts, 0);
  const maxConta = Math.max(1, ...Object.values(counts), meus.length);

  if (revealing) {
    return (
      <Reveal
        match={match}
        seats={seats}
        meId={user?.id ?? ""}
        onDone={onLeaveMatch}
      />
    );
  }

  const urgente = left <= 10;

  return (
    <div className="game">
      {/* ── cronômetro e conta ─────────────────────────────────────────── */}
      <div className="game-head">
        <div className="clock" data-urgent={urgente}>
          <span className="mono clock-num">
            {String(Math.floor(left / 60)).padStart(1, "0")}:
            {String(left % 60).padStart(2, "0")}
          </span>
        </div>
        <div className="game-mine">
          <p className="eyebrow">Suas palavras</p>
          <p className="mono game-mine-num">
            {meus.length} <span style={{ color: "var(--fg-faint)" }}>·</span> {meuTotal} pts
          </p>
        </div>
      </div>

      <Board
        grid={grid}
        path={path}
        state={trailState}
        onPathChange={(p) => {
          setTyped("");
          setTapPath(p);
        }}
        onCommit={() => void submit(pathWord(grid, path), path)}
        disabled={left === 0}
      />

      {/* ── palavra em construção ──────────────────────────────────────── */}
      <div className="compose" data-state={trailState}>
        <span className="mono compose-text">{current || " "}</span>
        {current.length >= 3 && trailState === "ok" && (
          <span className="compose-pts">+{score(current.length)}</span>
        )}
      </div>

      <div className="compose-actions">
        <button
          type="button"
          className="btn btn-brass"
          disabled={trailState !== "ok" || current.length < 3}
          onClick={() => {
            const alvo = typed ? pathForTyped : path;
            if (alvo) void submit(pathWord(grid, alvo), alvo);
          }}
        >
          Enviar
        </button>
        <button type="button" className="btn btn-ghost" onClick={limpar} disabled={!current}>
          Limpar
        </button>
      </div>

      {flash && (
        <p className="flash" data-kind={flash.kind} role="status">
          {flash.text}
        </p>
      )}

      <p className="hint dim">
        Digite ou arraste o dedo pelas letras vizinhas. <kbd>Enter</kbd> envia,{" "}
        <kbd>Esc</kbd> limpa.
      </p>

      {/* ── barras de tensão ───────────────────────────────────────────── */}
      <div className="panel game-rivals">
        <p className="eyebrow">Na mesa agora</p>
        <ul className="rivals">
          {seats.map((s) => {
            const n = s.user_id === user?.id ? meus.length : (counts[s.user_id] ?? 0);
            return (
              <li key={s.user_id} className="rival">
                <Avatar spec={parseAvatar(s.avatar)} size={28} />
                <span className="rival-name">{s.display_name}</span>
                <span className="rival-bar">
                  <span style={{ width: `${(n / maxConta) * 100}%` }} />
                </span>
                <span className="mono rival-n">{n}</span>
              </li>
            );
          })}
        </ul>
        <p className="rivals-note dim">
          Só a quantidade aparece. Ninguém vê as palavras de ninguém até o fim.
        </p>
      </div>

      {/* ── minha lista ────────────────────────────────────────────────── */}
      {meus.length > 0 && (
        <div className="panel game-words">
          <p className="eyebrow">Achadas</p>
          <ul className="wordlist">
            {meus.map((w) => (
              <li key={w.w} data-pending={!w.confirmed}>
                <span className="mono">{w.w}</span>
                <span className="wordlist-pts">+{w.pts}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
