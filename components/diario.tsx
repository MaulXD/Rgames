"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Board } from "@/components/letreiro/board";
import { Avatar } from "@/components/avatar";
import { Confete } from "@/components/confete";
import { useSession } from "@/components/session";
import { supabaseBrowser } from "@/lib/supabase/client";
import { parseAvatar } from "@/lib/avatar";
import {
  REJECTION,
  findPath,
  normalize,
  pathToString,
  pathWord,
  wordScore,
} from "@/lib/letreiro";
import * as sfx from "@/lib/sfx";

/**
 * O DESAFIO DIÁRIO.
 *
 * Uma grade por dia, a mesma para todo mundo, três minutos, uma tentativa.
 *
 * É o modo que faz alguém abrir o site num dia em que não tem com quem jogar —
 * e o que dá assunto no dia seguinte, porque todos jogaram a MESMA grade. A
 * comparação é o produto: "você achou CAPACETES?" só existe se a grade for
 * comum.
 *
 * A tela é deliberadamente mais nua que a da partida com amigos: não há barra
 * de rival, não há contagem alheia. Você contra a grade, e o placar só no fim.
 * Ver o número do outro durante a rodada mudaria o que você tenta.
 */

type Palavra = { w: string; p: string; pts: number; comum?: boolean };

type Aberto = {
  dia: string;
  grid: string[];
  size: number;
  termina_em: string;
  fechado: boolean;
  score: number;
  palavras: Palavra[];
  comuns: number;
  maxComum: number;
};

type Fim = {
  dia: string;
  score: number;
  palavras: Palavra[];
  maxComum: number;
  comuns: number;
  perdidas: { w: string; p: string; pts: number }[];
};

type LinhaPlacar = {
  nome: string;
  avatar: unknown;
  score: number;
  palavras: number;
  eu: boolean;
};

export function Diario() {
  const { status } = useSession();
  const [aberto, setAberto] = useState<Aberto | null>(null);
  const [fim, setFim] = useState<Fim | null>(null);
  const [placar, setPlacar] = useState<LinhaPlacar[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [tapPath, setTapPath] = useState<number[]>([]);
  const [typed, setTyped] = useState("");
  const [palavras, setPalavras] = useState<Palavra[]>([]);
  const [flash, setFlash] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const [left, setLeft] = useState(0);
  const [festa, setFesta] = useState(false);
  const fechando = useRef(false);
  const antes = useRef(0);

  const encerrar = useCallback(async (silencioso = false) => {
    if (fechando.current) return;
    fechando.current = true;
    const { data, error } = await supabaseBrowser().rpc("letreiro_diario_fechar");
    if (error) {
      setErro(error.message ?? String(error));
      fechando.current = false;
      return;
    }
    const f = data as unknown as Fim;
    setFim(f);
    if (!silencioso) sfx.fim();
    if (f.score > 0 && f.score >= f.maxComum / 2) setFesta(true);

    const { data: p } = await supabaseBrowser().rpc("letreiro_diario_placar");
    setPlacar((p ?? []) as unknown as LinhaPlacar[]);
  }, []);


  /* ── abrir ao entrar ────────────────────────────────────────────────── */
  useEffect(() => {
    if (status !== "ready") return;
    let vivo = true;
    async function puxa() {
      const { data, error } = await supabaseBrowser().rpc("letreiro_diario_abrir");
      if (!vivo) return;
      if (error) {
        setErro(error.message ?? String(error));
        return;
      }
      const a = data as unknown as Aberto;
      setAberto(a);
      setPalavras(a.palavras ?? []);
      if (a.fechado) void encerrar(true);
    }
    void puxa();
    return () => {
      vivo = false;
    };
  }, [status, encerrar]);

  /* ── relógio ────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!aberto || aberto.fechado || fim) return;
    const alvo = new Date(aberto.termina_em).getTime();
    const tick = () => setLeft(Math.max(0, Math.ceil((alvo - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [aberto, fim]);

  // o metrônomo dos últimos dez segundos
  useEffect(() => {
    if (fim || left <= 0 || left > 10) return;
    if (antes.current === left) return;
    antes.current = left;
    sfx.tique(left <= 3);
  }, [left, fim]);

  // o tempo acabou: fecha sozinho, sem depender de um clique
  useEffect(() => {
    if (!aberto || aberto.fechado || fim) return;
    if (left > 0) return;
    const id = setTimeout(() => void encerrar(), 400);
    return () => clearTimeout(id);
  }, [left, aberto, fim, encerrar]);

  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 1400);
    return () => clearTimeout(id);
  }, [flash]);

  useEffect(() => {
    if (!festa) return;
    const id = setTimeout(() => setFesta(false), 1800);
    return () => clearTimeout(id);
  }, [festa]);

  /* ── montar a palavra ─────────────────────────────────────────────────
     `grid` e `path` vão em `useMemo` porque o efeito do teclado depende dos
     dois: sem a memoização, um array novo a cada renderização religaria o
     ouvinte de tecla em toda letra digitada. */
  const grid = useMemo(() => aberto?.grid ?? [], [aberto]);
  const caminhoDigitado = useMemo(
    () => (typed.length >= 1 ? findPath(grid, typed) : null),
    [grid, typed],
  );
  const path = useMemo(
    () => (typed ? (caminhoDigitado ?? []) : tapPath),
    [typed, caminhoDigitado, tapPath],
  );
  const atual = typed ? normalize(typed) : pathWord(grid, path);
  const estado: "idle" | "path" | "bad" =
    !atual || atual.length < 3 ? "idle" : typed && !caminhoDigitado ? "bad" : "path";

  const limpar = () => {
    setTapPath([]);
    setTyped("");
  };

  const enviar = useCallback(
    async (palavra: string, caminho: number[]) => {
      const w = normalize(palavra);
      if (w.length < 3 || caminho.length < 2) return;
      if (palavras.some((x) => x.w === w)) {
        setFlash({ kind: "bad", text: `${w} — ${REJECTION.REPEATED}` });
        limpar();
        return;
      }
      const pts = wordScore(w);
      const p = pathToString(caminho);
      limpar();

      const { data, error } = await supabaseBrowser().rpc("letreiro_diario_submeter", {
        p_word: w,
        p_path: p,
      });
      const res = data as { ok?: boolean; reason?: string } | null;
      if (error || !res?.ok) {
        const motivo = error ? "TIME_OVER" : (res?.reason ?? "NOT_A_WORD");
        setFlash({ kind: "bad", text: `${w} — ${REJECTION[motivo] ?? motivo}` });
        sfx.errada();
        return;
      }
      setPalavras((prev) => [{ w, p, pts }, ...prev]);
      setFlash({ kind: "ok", text: `${w} · +${pts}` });
      sfx.certa(w.length);
    },
    [palavras],
  );

  /* ── teclado ────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (fim || !aberto) return;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "Enter") {
        e.preventDefault();
        const alvo = typed ? caminhoDigitado : path;
        if (alvo && alvo.length >= 2) void enviar(pathWord(grid, alvo), alvo);
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
        setTyped((t) => (t + e.key).slice(0, grid.length));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fim, aberto, typed, path, caminhoDigitado, grid, enviar]);

  /* ── telas ──────────────────────────────────────────────────────────── */

  if (status !== "ready") {
    return <p className="eyebrow py-16">Puxando a grade de hoje…</p>;
  }

  if (erro) {
    return (
      <div className="panel p-6">
        <p className="eyebrow">Não deu</p>
        <p className="mt-2 text-sm dim">{erro}</p>
      </div>
    );
  }

  if (!aberto) {
    return <p className="eyebrow py-16">Puxando a grade de hoje…</p>;
  }

  const dia = new Date(`${aberto.dia}T12:00:00`).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
  });

  /* ── depois do fim ──────────────────────────────────────────────────── */
  if (fim) {
    const aproveitamento = fim.maxComum
      ? Math.round((fim.score / fim.maxComum) * 100)
      : 0;
    return (
      <div className="diario">
        {festa && <Confete pecas={44} />}
        <div className="diario-topo">
          <p className="eyebrow">Desafio de {dia}</p>
          <p className="diario-placar mono">{fim.score}</p>
          <p className="dim diario-sub">
            {fim.palavras.length}{" "}
            {fim.palavras.length === 1 ? "palavra" : "palavras"} · {aproveitamento}% do que dava
            para achar em palavra do dia a dia
          </p>
        </div>

        {fim.palavras.length > 0 && (
          <div className="panel diario-bloco">
            <p className="eyebrow">O que você achou</p>
            <ul className="wordlist">
              {[...fim.palavras]
                .sort((a, b) => b.pts - a.pts)
                .map((w) => (
                  <li key={w.w}>
                    <span className="mono">{w.w}</span>
                    <span className="wordlist-pts">+{w.pts}</span>
                  </li>
                ))}
            </ul>
          </div>
        )}

        {fim.perdidas.length > 0 && (
          <div className="panel diario-bloco">
            <p className="eyebrow">As melhores que escaparam</p>
            <ul className="wordlist reveal-missed-list-ul">
              {fim.perdidas.map((w) => (
                <li key={w.w} data-dup={false}>
                  <span className="mono">{w.w}</span>
                  <span className="wordlist-pts">+{w.pts}</span>
                </li>
              ))}
            </ul>
            <p className="dim mt-3 text-xs">
              Só palavra que gente usa. A grade tinha {fim.comuns} delas.
            </p>
          </div>
        )}

        <div className="panel diario-bloco">
          <p className="eyebrow">Placar de hoje</p>
          {placar.length === 0 ? (
            <p className="dim mt-2 text-sm">
              Você é o primeiro a fechar hoje. Volte mais tarde para ver quem passou.
            </p>
          ) : (
            <ol className="diario-lista">
              {placar.map((l, i) => (
                <li key={`${l.nome}-${i}`} className="diario-linha" data-eu={l.eu}>
                  <span className="seal diario-pos">{i + 1}</span>
                  <Avatar spec={parseAvatar(l.avatar)} size={30} />
                  <span className="diario-nome">{l.nome}</span>
                  <span className="mono diario-palavras dim">{l.palavras}</span>
                  <span className="mono diario-pts">{l.score}</span>
                </li>
              ))}
            </ol>
          )}
          <p className="dim mt-3 text-xs">
            Todos jogaram esta mesma grade. As palavras de cada um ficam com cada um.
          </p>
        </div>

        <p className="dim diario-volta">
          A grade de amanhã já existe — ela sai da data, não de um sorteio. Volte depois da
          meia-noite.
        </p>
      </div>
    );
  }

  /* ── jogando ────────────────────────────────────────────────────────── */
  const total = palavras.reduce((s, w) => s + w.pts, 0);
  const urgente = left <= 10;

  return (
    <div className="diario" onPointerDown={() => sfx.arm()}>
      <div className="game-head">
        <div className="clock" data-urgent={urgente}>
          <span className="mono clock-num">
            {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
          </span>
        </div>
        <div className="game-mine">
          <p className="eyebrow">Desafio de {dia}</p>
          <p className="mono game-mine-num">
            {palavras.length} <span style={{ color: "var(--fg-faint)" }}>·</span> {total} pts
          </p>
        </div>
      </div>

      <Board
        grid={grid}
        path={path}
        state={estado}
        onPathChange={(p) => {
          sfx.arm();
          if (p.length > tapPath.length) sfx.letra(p.length);
          else if (p.length < tapPath.length) sfx.apaga();
          setTyped("");
          setTapPath(p);
        }}
        onCommit={() => void enviar(pathWord(grid, path), path)}
        disabled={left === 0}
      />

      <label className="compose" data-state={estado}>
        <input
          className="mono compose-input"
          value={atual}
          onChange={(e) => {
            setTapPath([]);
            setTyped(e.target.value.slice(0, grid.length));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const alvo = typed ? caminhoDigitado : path;
              if (alvo && alvo.length >= 2) void enviar(pathWord(grid, alvo), alvo);
            }
            if (e.key === "Escape") {
              e.preventDefault();
              limpar();
            }
          }}
          placeholder="digite ou arraste"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          aria-label="Palavra"
          disabled={left === 0}
        />
        {atual.length >= 3 && estado === "path" && (
          <span className="compose-pts">+{wordScore(atual)}</span>
        )}
      </label>

      <div className="compose-actions">
        <button
          type="button"
          className="btn btn-brass"
          disabled={estado !== "path" || atual.length < 3}
          onClick={() => {
            const alvo = typed ? caminhoDigitado : path;
            if (alvo) void enviar(pathWord(grid, alvo), alvo);
          }}
        >
          Enviar
        </button>
        <button type="button" className="btn btn-ghost" onClick={limpar} disabled={!atual}>
          Limpar
        </button>
        <button
          type="button"
          className="btn btn-lacquer"
          onClick={() => void encerrar()}
          title="Encerra agora e mostra o placar do dia"
        >
          Encerrar
        </button>
      </div>

      {flash && (
        <p className="flash" data-kind={flash.kind} role="status">
          {flash.text}
        </p>
      )}

      {palavras.length > 0 && (
        <div className="panel game-words">
          <p className="eyebrow">Achadas</p>
          <ul className="wordlist">
            {palavras.map((w) => (
              <li key={w.w}>
                <span className="mono">{w.w}</span>
                <span className="wordlist-pts">+{w.pts}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="hint dim">
        Uma tentativa por dia, e a grade é a mesma para todo mundo. Sem barra de rival de
        propósito: ver o número do outro durante a rodada mudaria o que você tenta.
      </p>
    </div>
  );
}
