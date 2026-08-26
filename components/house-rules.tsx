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

const MODOS = [
  { id: "classico", nome: "Clássico", nota: "Três minutos. O padrão." },
  { id: "relampago", nome: "Relâmpago", nota: "Um minuto. Cabe entre duas partidas." },
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

  async function salvar(patch: Record<string, string>) {
    setBusy(true);
    setErro(null);
    const { data, error } = await supabaseBrowser().rpc("set_room_settings", {
      p_room: room.id,
      p_settings: { modo, anulacao, ...patch },
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

  const resumo = `${MODOS.find((m) => m.id === modo)?.nome} · anulação ${
    ANULACOES.find((a) => a.id === anulacao)?.nome?.toLowerCase()
  }`;

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
        <span className="mono text-xs" style={{ color: "var(--brass-300)" }}>
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
  onClick,
}: {
  ativo: boolean;
  nome: string;
  nota: string;
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
      <span>
        <span className="rule-name">{nome}</span>
        <span className="rule-note">{nota}</span>
      </span>
    </button>
  );
}
