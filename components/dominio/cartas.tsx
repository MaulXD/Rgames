"use client";

import { useMemo, useState } from "react";
import { POR_ID } from "@/lib/dominio/vantara";

/**
 * A mão e a troca.
 *
 * A regra da troca é a que tem mais jeito de dar errado em silêncio: três
 * iguais, três diferentes, ou duas iguais com um coringa. Em vez de deixar a
 * pessoa tentar e o servidor recusar com um código em inglês, a tela avalia a
 * seleção EM TEMPO REAL e diz por que não fecha — e o botão só acende quando
 * fecha. O servidor confere de novo, claro; esta conta aqui é cortesia, não
 * autoridade.
 */

export type Carta = { id: string; ter: string | null; simbolo: Simbolo };
export type Simbolo = "infante" | "cavalo" | "canhao" | "coringa";

const NOME: Record<Simbolo, string> = {
  infante: "Infante",
  cavalo: "Cavalo",
  canhao: "Canhão",
  coringa: "Coringa",
};

/** Glifos simples e legíveis a 28px — o naipe tem de ler no polegar. */
function Glifo({ s }: { s: Simbolo }) {
  if (s === "infante") {
    return (
      <svg viewBox="0 0 40 40" aria-hidden>
        <circle cx="20" cy="11" r="6" />
        <path d="M11 38 Q11 21 20 21 Q29 21 29 38 Z" />
      </svg>
    );
  }
  if (s === "cavalo") {
    return (
      <svg viewBox="0 0 40 40" aria-hidden>
        <path d="M12 38 Q12 24 18 19 L14 12 L21 14 L24 7 L27 15 Q33 20 31 29 Q30 34 28 38 Z" />
      </svg>
    );
  }
  if (s === "canhao") {
    return (
      <svg viewBox="0 0 40 40" aria-hidden>
        <circle cx="14" cy="27" r="8" />
        <path d="M18 22 L34 12 L37 18 L21 28 Z" />
        <rect x="7" y="33" width="26" height="4" rx="2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 40 40" aria-hidden>
      <path d="M20 4 L24 15 L36 15 L26 22 L30 34 L20 27 L10 34 L14 22 L4 15 L16 15 Z" />
    </svg>
  );
}

/** Por que esta seleção de três não fecha? Devolve null quando fecha. */
export function porQueNaoFecha(sel: Carta[]): string | null {
  if (sel.length !== 3) return `escolha ${3 - sel.length > 0 ? 3 - sel.length : 0} carta(s) a mais`;
  const coringas = sel.filter((c) => c.simbolo === "coringa").length;
  const outros = sel.filter((c) => c.simbolo !== "coringa").map((c) => c.simbolo);

  if (coringas >= 2) return null; // dois coringas fecham com qualquer carta
  if (coringas === 1) {
    return outros[0] === outros[1]
      ? null
      : "com um coringa, as outras duas têm de ser do mesmo naipe";
  }
  const iguais = outros[0] === outros[1] && outros[1] === outros[2];
  const todosDiferentes =
    outros[0] !== outros[1] && outros[1] !== outros[2] && outros[0] !== outros[2];
  if (iguais || todosDiferentes) return null;
  return "três iguais ou três diferentes — duas iguais e uma diferente não vale";
}

export function Mao({
  cartas,
  donos,
  meuAssento,
  podeTrocar,
  obrigado,
  onTrocar,
}: {
  cartas: Carta[];
  donos: Record<string, number>;
  meuAssento: number | null;
  /** só na fase de reforço, e só na sua vez */
  podeTrocar: boolean;
  /** com cinco ou mais, trocar deixa de ser opcional */
  obrigado: boolean;
  onTrocar: (indices: number[]) => void;
}) {
  const [sel, setSel] = useState<number[]>([]);

  const escolhidas = useMemo(() => sel.map((i) => cartas[i]).filter(Boolean), [sel, cartas]);
  const motivo = porQueNaoFecha(escolhidas);
  const fecha = escolhidas.length === 3 && motivo === null;

  function toca(i: number) {
    if (!podeTrocar) return;
    setSel((s) => (s.includes(i) ? s.filter((x) => x !== i) : s.length >= 3 ? s : [...s, i]));
  }

  if (cartas.length === 0) {
    return (
      <div className="panel mao-vazia">
        <p className="eyebrow">Sua mão</p>
        <p className="dim mt-2 text-sm">
          Sem cartas. Você ganha uma no fim de todo turno em que conquistar pelo menos um
          território — uma por turno, não uma por conquista.
        </p>
      </div>
    );
  }

  return (
    <div className="panel mao">
      <div className="mao-topo">
        <p className="eyebrow">Sua mão · {cartas.length}</p>
        {obrigado && <span className="mao-aviso">com cinco, é obrigatório trocar</span>}
      </div>

      <ul className="mao-lista">
        {cartas.map((c, i) => {
          const meu = c.ter ? donos[c.ter] === meuAssento : false;
          const ordem = sel.indexOf(i);
          return (
            <li key={`${c.id}-${i}`}>
              <button
                type="button"
                className="carta"
                data-sel={ordem >= 0}
                data-naipe={c.simbolo}
                data-meu={meu}
                disabled={!podeTrocar}
                onClick={() => toca(i)}
                aria-pressed={ordem >= 0}
              >
                <span className="carta-glifo">
                  <Glifo s={c.simbolo} />
                </span>
                <span className="carta-nome">
                  {c.ter ? (POR_ID[c.ter]?.nome ?? c.ter) : NOME.coringa}
                </span>
                <span className="carta-naipe">{NOME[c.simbolo]}</span>
                {/* Carta do próprio território vale dois exércitos ALI na hora
                    da troca. É a informação que muda a decisão, então ela fica
                    na carta e não num rodapé de regras. */}
                {meu && <span className="carta-bonus">+2 aqui</span>}
                {ordem >= 0 && <span className="carta-ordem mono">{ordem + 1}</span>}
              </button>
            </li>
          );
        })}
      </ul>

      {podeTrocar && (
        <div className="mao-acao">
          <button
            type="button"
            className="btn btn-brass"
            disabled={!fecha}
            onClick={() => {
              onTrocar(sel);
              setSel([]);
            }}
          >
            Trocar as três
          </button>
          {sel.length > 0 && (
            <button type="button" className="btn btn-ghost" onClick={() => setSel([])}>
              Limpar
            </button>
          )}
          {sel.length > 0 && !fecha && <p className="mao-motivo">{motivo}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * O objetivo secreto, atrás de um toque.
 *
 * Fica escondido de propósito: muita gente joga com o celular na mesa, entre
 * amigos, e um objetivo impresso na tela é um objetivo que o vizinho leu. O
 * toque para revelar é a versão digital de virar a cartinha na mão.
 */
export function Objetivo({ texto }: { texto: string | null }) {
  const [aberto, setAberto] = useState(false);
  if (!texto) return null;

  return (
    <button
      type="button"
      className="objetivo"
      data-aberto={aberto}
      onClick={() => setAberto((a) => !a)}
      aria-expanded={aberto}
    >
      <span className="eyebrow">Seu objetivo</span>
      <span className="objetivo-texto">{aberto ? texto : "toque para ver"}</span>
      <span className="objetivo-selo" aria-hidden>
        {aberto ? "◉" : "●"}
      </span>
    </button>
  );
}
