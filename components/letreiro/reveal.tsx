"use client";

import { useEffect, useMemo, useState } from "react";
import { Board } from "@/components/letreiro/board";
import { Avatar } from "@/components/avatar";
import { Fleuron } from "@/components/ornament";
import { parseAvatar } from "@/lib/avatar";
import { pathFromString } from "@/lib/letreiro";
import type { MatchRow, Seat } from "@/components/letreiro/game";

/**
 * A Revelação, em três atos — docs/02-PRD-LETREIRO.md §6.1.
 *
 * É a parte mais importante do jogo. Não é um modal de placar: é a hora em
 * que a grade mostra o que você deixou passar. O "não acredito que tinha
 * ISSO aí" é o que faz alguém apertar Revanche.
 */
export function Reveal({
  match,
  seats,
  meId,
  onDone,
}: {
  match: MatchRow;
  seats: Seat[];
  meId: string;
  onDone: () => void;
}) {
  const st = match.public_state;
  const grid = st.grid;
  const missed = useMemo(() => st.missed ?? [], [st.missed]);
  const found = st.found ?? {};
  const scores = st.scores ?? {};

  const [ato, setAto] = useState<1 | 2 | 3>(1);
  const [qual, setQual] = useState(0);

  // ato 1 → 2 → 3, com passo automático e possibilidade de pular
  useEffect(() => {
    if (ato === 1) {
      const id = setTimeout(() => setAto(missed.length ? 2 : 3), 5200);
      return () => clearTimeout(id);
    }
    if (ato === 2) {
      if (qual >= missed.length) {
        const id = setTimeout(() => setAto(3), 900);
        return () => clearTimeout(id);
      }
      const id = setTimeout(() => setQual((q) => q + 1), 2200);
      return () => clearTimeout(id);
    }
  }, [ato, qual, missed.length]);

  const ranking = [...seats]
    .map((s) => ({ ...s, pts: scores[s.user_id] ?? 0, achadas: found[s.user_id] ?? [] }))
    .sort((a, b) => b.pts - a.pts);

  const atual = missed[Math.min(qual, missed.length - 1)];
  const meuTotal = scores[meId] ?? 0;
  const aproveitamento = st.maxScore ? Math.round((meuTotal / st.maxScore) * 100) : 0;

  return (
    <div className="reveal">
      <div className="reveal-top">
        <p className="eyebrow">
          {ato === 1 ? "Conferência" : ato === 2 ? "O que escapou" : "Placar"}
        </p>
        {ato !== 3 && (
          <button className="btn btn-ghost reveal-skip" onClick={() => setAto(3)}>
            Pular
          </button>
        )}
      </div>

      {/* ── ato 1 · conferência ───────────────────────────────────────── */}
      {ato === 1 && (
        <div className="reveal-check">
          {ranking.map((p) => (
            <div key={p.user_id} className="panel reveal-player">
              <div className="reveal-player-head">
                <Avatar spec={parseAvatar(p.avatar)} size={32} />
                <span className="reveal-player-name">{p.display_name}</span>
                <span className="mono reveal-player-pts">{p.pts} pts</span>
              </div>
              {p.achadas.length === 0 ? (
                <p className="dim reveal-empty">nenhuma palavra</p>
              ) : (
                <ul className="wordlist reveal-list">
                  {p.achadas.map((w, i) => (
                    <li
                      key={w.w + i}
                      data-dup={w.dup}
                      style={{ animationDelay: `${Math.min(i, 14) * 55}ms` }}
                    >
                      <span className="mono">{w.w}</span>
                      <span className="wordlist-pts">{w.dup ? "anulada" : `+${w.pts}`}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── ato 2 · o que ninguém achou ───────────────────────────────── */}
      {ato === 2 && atual && (
        <div className="reveal-missed">
          <Board
            grid={grid}
            path={pathFromString(atual.p)}
            state="ok"
            onPathChange={() => {}}
            onCommit={() => {}}
            disabled
          />
          <p className="reveal-word" key={atual.w}>
            {atual.w}
          </p>
          <p className="reveal-word-pts mono">
            {atual.pts} {atual.pts === 1 ? "ponto" : "pontos"} · ninguém achou
          </p>
          <div className="reveal-dots" aria-hidden>
            {missed.map((_, i) => (
              <span key={i} data-on={i <= qual} />
            ))}
          </div>
        </div>
      )}

      {/* ── ato 3 · placar ────────────────────────────────────────────── */}
      {ato === 3 && (
        <div className="reveal-final">
          <div className="flex justify-center">
            <Fleuron width={200} />
          </div>

          <ol className="podium">
            {ranking.map((p, i) => (
              <li key={p.user_id} className="panel podium-row" data-me={p.user_id === meId}>
                <span className="seal podium-seal">{i + 1}</span>
                <Avatar spec={parseAvatar(p.avatar)} size={38} />
                <div className="min-w-0 flex-1">
                  <p className="podium-name">{p.display_name}</p>
                  <p className="mono podium-sub">
                    {p.achadas.filter((w) => !w.dup).length} valendo ·{" "}
                    {p.achadas.filter((w) => w.dup).length} anuladas
                  </p>
                </div>
                <span className="mono podium-pts">{p.pts}</span>
              </li>
            ))}
          </ol>

          <div className="panel reveal-stats">
            <div>
              <p className="eyebrow">Aproveitamento</p>
              <p className="mono reveal-stat-num">{aproveitamento}%</p>
              <p className="dim reveal-stat-note">
                {meuTotal} de {st.maxScore ?? 0} pontos possíveis
              </p>
            </div>
            <div>
              <p className="eyebrow">A grade tinha</p>
              <p className="mono reveal-stat-num">{st.wordCount ?? 0}</p>
              <p className="dim reveal-stat-note">palavras no total</p>
            </div>
          </div>

          {missed.length > 0 && (
            <div className="panel reveal-missed-list">
              <p className="eyebrow">As melhores que escaparam</p>
              <ul className="wordlist">
                {[...missed].reverse().map((w) => (
                  <li key={w.w}>
                    <span className="mono">{w.w}</span>
                    <span className="wordlist-pts">+{w.pts}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button className="btn btn-brass reveal-again" onClick={onDone}>
            Voltar para a sala
          </button>
        </div>
      )}
    </div>
  );
}
