"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Room } from "@/lib/supabase/types";

/**
 * Regras da casa.
 *
 * O host não é obrigado a configurar nada — os defaults são bons e a partida
 * começa num clique. Isso fica atrás de um botão, e cada opção diz o que faz
 * com a partida em vez de só nomear a regra.
 * Ver docs/00-PRD-PLATAFORMA.md §3 (princípio 2).
 */

/**
 * A duração depende do tamanho da bandeja — 25 letras dão muito mais caminho
 * para varrer que 16, e o mesmo relógio viraria pressa em vez de desafio. Os
 * números aqui são os mesmos de `letreiro_start`; se um lado mudar, muda o
 * outro, senão a tela promete um tempo que o servidor não dá.
 */
const DURACAO: Record<number, { classico: string; relampago: string }> = {
  4: { classico: "Três minutos", relampago: "Um minuto" },
  5: { classico: "Cinco minutos", relampago: "Um minuto e meio" },
};

function modos(tamanho: number) {
  const d = DURACAO[tamanho] ?? DURACAO[4];
  return [
    { id: "classico", nome: "Clássico", nota: `${d.classico}. O padrão.` },
    {
      id: "relampago",
      nome: "Relâmpago",
      nota: `${d.relampago}. Cabe entre duas partidas.`,
    },
  ] as const;
}

const TAMANHOS = [
  {
    id: 4,
    nome: "4 × 4 — dezesseis letras",
    nota: "A bandeja clássica. Rodada curta e disputada, cabe na mão no celular.",
  },
  {
    id: 5,
    nome: "5 × 5 — vinte e cinco letras",
    nota: "Mais letra, palavra mais longa, muito mais caminho. O relógio cresce junto.",
  },
] as const;

const ANULACOES = [
  {
    id: "classica",
    nome: "Clássica",
    nota: "Palavra achada por dois vale zero para os dois. Premia achar o que ninguém acha.",
  },
  {
    id: "gananciosa",
    nome: "Gananciosa",
    nota: "Ninguém anula ninguém. Melhor quando há muita diferença de nível na mesa.",
  },
  {
    id: "bonus",
    nome: "Bônus de exclusividade",
    nota: "Todos pontuam, e quem achou sozinho leva +1 por palavra. O meio-termo.",
  },
] as const;

export function HouseRules({
  room,
  isHost,
  onChanged,
}: {
  room: Room;
  isHost: boolean;
  onChanged: (r: Room) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const modo = (room.settings?.modo as string) ?? "classico";
  const anulacao = (room.settings?.anulacao as string) ?? "classica";
  const tamanho = Number(room.settings?.tamanho ?? 4);
  const MODOS = modos(tamanho);

  async function salvar(patch: Record<string, string | number>) {
    setBusy(true);
    setErro(null);
    const { data, error } = await supabaseBrowser().rpc("set_room_settings", {
      p_room: room.id,
      p_settings: { modo, anulacao, tamanho, ...patch },
    });
    setBusy(false);
    if (error) {
      setErro(
        /MATCH_IN_PROGRESS/.test(error.message)
          ? "Não dá para mudar com partida rolando."
          : /NOT_HOST/.test(error.message)
            ? "Só o anfitrião muda as regras."
            : error.message,
      );
      return;
    }
    onChanged(data as unknown as Room);
  }

  const resumo = `${tamanho}×${tamanho} · ${
    MODOS.find((m) => m.id === modo)?.nome
  } · anulação ${ANULACOES.find((a) => a.id === anulacao)?.nome?.toLowerCase()}`;

  return (
    <div className="panel mt-4 p-5 sm:p-6">
      <button
        type="button"
        className="flex w-full items-baseline justify-between gap-3 text-left"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span>
          <span className="eyebrow">Regras da casa</span>
          <span className="mt-1 block text-sm dim">{resumo}</span>
        </span>
        <span className="mono text-xs" style={{ color: "var(--vivo-amarelo)" }}>
          {open ? "fechar" : "mudar"}
        </span>
      </button>

      {open && (
        <div className="mt-5 flex flex-col gap-6">
          {!isHost && (
            <p className="text-sm dim">
              Só o anfitrião muda as regras. Você está vendo o que valeu para esta sala.
            </p>
          )}

          <fieldset disabled={!isHost || busy} style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="eyebrow mb-3">Tamanho da bandeja</legend>
            <div className="flex flex-col gap-2">
              {TAMANHOS.map((t) => (
                <Opcao
                  key={t.id}
                  ativo={tamanho === t.id}
                  nome={t.nome}
                  nota={t.nota}
                  previa={<GradeMini lado={t.id} />}
                  onClick={() => void salvar({ tamanho: t.id })}
                />
              ))}
            </div>
          </fieldset>

          <fieldset disabled={!isHost || busy} style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="eyebrow mb-3">Duração</legend>
            <div className="flex flex-col gap-2">
              {MODOS.map((m) => (
                <Opcao
                  key={m.id}
                  ativo={modo === m.id}
                  nome={m.nome}
                  nota={m.nota}
                  onClick={() => void salvar({ modo: m.id })}
                />
              ))}
            </div>
          </fieldset>

          <fieldset disabled={!isHost || busy} style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="eyebrow mb-3">Palavra repetida</legend>
            <div className="flex flex-col gap-2">
              {ANULACOES.map((a) => (
                <Opcao
                  key={a.id}
                  ativo={anulacao === a.id}
                  nome={a.nome}
                  nota={a.nota}
                  onClick={() => void salvar({ anulacao: a.id })}
                />
              ))}
            </div>
          </fieldset>

          {erro && (
            <p className="text-sm" style={{ color: "#ffb3a7" }}>
              {erro}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Opcao({
  ativo,
  nome,
  nota,
  previa,
  onClick,
}: {
  ativo: boolean;
  nome: string;
  nota: string;
  /** miniatura opcional à direita — vale mais que a descrição em texto */
  previa?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className="rule-option"
      data-on={ativo}
    >
      <span className="rule-mark" aria-hidden />
      <span style={{ flex: 1 }}>
        <span className="rule-name">{nome}</span>
        <span className="rule-note">{nota}</span>
      </span>
      {previa}
    </button>
  );
}

/** A bandeja em miniatura: dá para ver a diferença sem começar a partida. */
function GradeMini({ lado }: { lado: number }) {
  return (
    <span
      className="rule-grade"
      style={{ gridTemplateColumns: `repeat(${lado}, 1fr)` }}
      aria-hidden
    >
      {Array.from({ length: lado * lado }, (_, i) => (
        <span key={i} style={{ "--onda": (i % lado) + Math.floor(i / lado) } as React.CSSProperties} />
      ))}
    </span>
  );
}
