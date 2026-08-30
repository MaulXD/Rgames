"use client";

/**
 * A escolha em cima da mesa: um painel com um ou mais grupos de opções e um
 * botão que só acende quando a escolha está completa.
 *
 * Mora sozinho porque quatro telas o usam — palpite, acusação e as duas Cartas
 * de Pista que perguntam alguma coisa. Cada uma delas com o seu próprio painel
 * seria a mesma tela desenhada quatro vezes, e a quinta chegaria diferente das
 * outras quatro.
 */

import { useEffect } from "react";
import * as sfx from "@/lib/sfx";

export function Escolher({
  titulo,
  nota,
  grupos,
  pronto,
  onConfirmar,
  onFechar,
  rotuloBotao,
  perigo,
}: {
  titulo: string;
  nota: string;
  grupos: { rotulo: string; itens: { id: string; name: string }[]; sel?: string; set: (v: string) => void }[];
  pronto: boolean;
  onConfirmar: () => void;
  onFechar: () => void;
  rotuloBotao: string;
  perigo?: boolean;
}) {
  useEffect(() => {
    sfx.abre();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
      style={{ background: "rgb(4 12 18 / 0.85)" }}
      onClick={() => {
        sfx.fecha();
        onFechar();
      }}
    >
      <div
        className="panel w-full max-w-lg p-5 sm:p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={titulo}
      >
        <h2 className="text-2xl">{titulo}</h2>
        <p className="mt-2 text-sm dim">{nota}</p>

        {grupos.map((g) => (
          <div key={g.rotulo} className="mt-5">
            <p className="eyebrow mb-2">{g.rotulo}</p>
            <div className="flex flex-wrap gap-2">
              {g.itens.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  className="escolha"
                  data-on={g.sel === it.id}
                  onClick={() => g.set(it.id)}
                >
                  {it.name}
                </button>
              ))}
            </div>
          </div>
        ))}

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <button
            className={perigo ? "btn btn-lacquer flex-1" : "btn btn-brass flex-1"}
            disabled={!pronto}
            onClick={onConfirmar}
          >
            {rotuloBotao}
          </button>
          <button
            className="btn btn-ghost flex-1"
            onClick={() => {
              sfx.fecha();
              onFechar();
            }}
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
