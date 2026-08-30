"use client";

import { useEffect, useMemo, useState } from "react";
import { Board } from "@/components/letreiro/board";
import { Avatar } from "@/components/avatar";
import { Fleuron } from "@/components/ornament";
import { parseAvatar } from "@/lib/avatar";
import { pathFromString } from "@/lib/letreiro";
import * as sfx from "@/lib/sfx";
import { Confete } from "@/components/confete";
import type { MatchRow, Seat } from "@/components/letreiro/game";

/**
 * A Revelação, em três atos — docs/02-PRD-LETREIRO.md §6.1.
 *
 * É a parte mais importante do jogo. Não é um modal de placar: é a hora em
 * que a grade mostra o que você deixou passar. O "não acredito que tinha
 * ISSO aí" é o que faz alguém apertar Revanche.
 */
export function Reveal({
  calmo,
  match,
  seats,
  meId,
  onDone,
  onRematch,
}: {
/* QUEM PEDIU MENOS MOVIMENTO NO SISTEMA — decidido pelo contêiner.

     A revelação é uma sequência cronometrada: cinco segundos de conferência, e
     depois 2,2 segundos POR PALAVRA que escapou. Numa grade rica isso passa de
     quarenta segundos, e a folha de estilo não encurta nenhum deles — ela só
     tira o desenho do caminho.

     Aqui a sequência não roda: os atos passam no botão, e o que escapou aparece
     TUDO DE UMA VEZ, em lista. Nada se perde e ninguém espera. */
  calmo: boolean;
    match: MatchRow;
  seats: Seat[];
  meId: string;
  onDone: () => void;
  onRematch?: () => void;
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
    /* Para quem pediu menos movimento, quem passa de ato é a pessoa. */
    if (calmo) return;
    if (ato === 1) {
      const id = setTimeout(() => setAto(missed.length ? 2 : 3), 5200);
      return () => clearTimeout(id);
    }
    if (ato === 2) {
      if (qual >= missed.length) {
        const id = setTimeout(() => setAto(3), 900);
        return () => clearTimeout(id);
      }
      sfx.revela(qual);
      const id = setTimeout(() => setQual((q) => q + 1), 2200);
      return () => clearTimeout(id);
    }
  }, [ato, qual, missed.length, calmo]);

  const ranking = [...seats]
    .map((s) => ({ ...s, pts: scores[s.user_id] ?? 0, achadas: found[s.user_id] ?? [] }))
    .sort((a, b) => b.pts - a.pts);

  const atual = missed[Math.min(qual, missed.length - 1)];
  const meuTotal = scores[meId] ?? 0;

  /* ── O QUE A MÁQUINA ACHOU E VOCÊ NÃO ───────────────────────────

     "As melhores que escaparam" mostra o que NINGUÉM achou, e essa lista é sobre
     a grade. Jogando sozinho, a lista que dói é outra: o que a Creuza achou e
     você deixou passar. Uma é sobre o quanto a grade era rica; a outra é sobre
     você ter perdido — e é a segunda que faz apertar "Outra grade".

     Só palavra que valeu ponto para ela entra: mostrar o que foi ANULADO (as
     duas acharam) seria mostrar empate como derrota. */
  /* Sem `useMemo`: `found` é `st.found ?? {}`, um objeto novo a cada
     renderização, e uma dependência instável faz o compilador do React desistir
     de otimizar o componente inteiro. A conta é de algumas dezenas de palavras
     numa tela que aparece uma vez por partida — o compilador cuida dela melhor
     do que uma memoização quebrada. */
  const roubadas = (() => {
    const minhas = new Set((found[meId] ?? []).map((w) => w.w));
    const porPalavra = new Map<string, { w: string; pts: number; quem: string }>();
    for (const s of seats) {
      if (!s.is_bot) continue;
      for (const w of found[s.user_id] ?? []) {
        if (w.dup || minhas.has(w.w)) continue;
        const antes = porPalavra.get(w.w);
        if (!antes || w.pts > antes.pts) {
          porPalavra.set(w.w, { w: w.w, pts: w.pts, quem: s.display_name });
        }
      }
    }
    return [...porPalavra.values()].sort((a, b) => b.pts - a.pts).slice(0, 8);
  })();

  const quantasMaquinas = seats.filter((s) => s.is_bot).length;
  const aproveitamento = st.maxScore ? Math.round((meuTotal / st.maxScore) * 100) : 0;

  return (
    <div className="reveal">
      <div className="reveal-top">
        <p className="eyebrow">
          {ato === 1 ? "Conferência" : ato === 2 ? "O que escapou" : "Placar"}
        </p>
        {/* SEM O RELÓGIO, PRECISA DE UM CAMINHO PARA A FRENTE. "Pular" sempre
            foi um atalho para o placar, e com os atos parados ele deixaria o
            segundo ato inalcançável — quem pediu menos movimento perderia
            justamente a lista do que escapou. */}
        {calmo && ato === 1 && missed.length > 0 && (
          <button className="btn btn-brass reveal-skip" onClick={() => setAto(2)}>
            O que escapou
          </button>
        )}
        {ato !== 3 && (
          <button className="btn btn-ghost reveal-skip" onClick={() => setAto(3)}>
            {calmo && ato === 2 ? "Placar" : "Pular"}
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
                <ul className="wordlist">
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
      {/* ── ato 2, sem sequência ─────────────────────────────────────────
          A grade UMA vez, parada, e a lista inteira do lado. O caminho traçado
          é o que se perde, e é o único pedaço que era movimento; as palavras e
          o que elas valiam — que é o que dói e faz apertar Revanche — ficam
          todas na tela, ao mesmo tempo, sem relógio nenhum. */}
      {calmo && ato === 2 && missed.length > 0 && (
        <div className="reveal-missed">
          <Board
            grid={grid}
            path={[]}
            state="idle"
            onPathChange={() => {}}
            onCommit={() => {}}
            disabled
          />
          <ul className="reveal-escaparam">
            {missed.map((w) => (
              <li key={w.w}>
                <span className="reveal-escaparam-w">{w.w}</span>
                <span className="mono reveal-escaparam-pts">
                  {w.pts} {w.pts === 1 ? "ponto" : "pontos"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!calmo && ato === 2 && atual && (
        <div className="reveal-missed">
          <Board
            grid={grid}
            path={pathFromString(atual.p)}
            state="path"
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
          {ranking[0]?.user_id === meId && ranking.length > 1 && <Confete pecas={48} />}
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
              {/* o teto conta só palavra comum. Antes contava o gabarito
                  inteiro — 100% era inalcançável e a porcentagem não media
                  nada, porque ninguém acha "aalênio". */}
              <p className="dim reveal-stat-note">
                {meuTotal} de {st.maxScore ?? 0} pontos em palavra do dia a dia
              </p>
            </div>
            <div>
              <p className="eyebrow">A grade tinha</p>
              <p className="mono reveal-stat-num">{st.wordCount ?? 0}</p>
              <p className="dim reveal-stat-note">
                palavras conhecidas — as raras também valem, se você achar
              </p>
            </div>
          </div>

          {roubadas.length > 0 && (
            <div className="panel reveal-missed-list reveal-roubadas">
              <p className="eyebrow">
                {quantasMaquinas === 1
                  ? `${roubadas[0].quem} achou e você não`
                  : "As máquinas acharam e você não"}
              </p>
              <ul className="wordlist">
                {roubadas.map((w) => (
                  <li key={w.w}>
                    <span className="mono">{w.w}</span>
                    {quantasMaquinas > 1 && <span className="roubada-quem dim">{w.quem}</span>}
                    <span className="wordlist-pts">+{w.pts}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

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

          <div className="reveal-again flex flex-col gap-2 sm:flex-row">
            {onRematch && (
              <button className="btn btn-brass flex-1" onClick={onRematch}>
                Outra grade
              </button>
            )}
            <button className="btn btn-ghost flex-1" onClick={onDone}>
              Voltar para a sala
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
