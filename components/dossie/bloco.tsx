"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import { baralho, nomeDaCarta, type Caso } from "@/lib/dossie";
import {
  ENVELOPE,
  apura,
  celula,
  proxima,
  type Jogador,
  type LinhaLog,
  type Marca,
  type Marcas,
  type Nivel,
  type Pad,
  type Vista,
} from "@/lib/dossie-bloco";
import type { Aviso } from "@/lib/dossie-pistas";
import * as sfx from "@/lib/sfx";

const NIVEIS: { id: Nivel; nome: string; nota: string }[] = [
  { id: "manual", nome: "Manual", nota: "Grade vazia. Você anota tudo." },
  {
    id: "assistido",
    nome: "Assistido",
    nota: "Marca os fatos públicos e mantém os conjuntos, mas não resolve a lógica por você.",
  },
  {
    id: "dedutivo",
    nome: "Dedutivo",
    nota: "Resolve toda inferência possível e avisa quando o envelope está determinado.",
  },
];

const SIMBOLO: Record<Marca, string> = { check: "✓", x: "✗", duvida: "?" };

/**
 * O bloco de dedução.
 *
 * O nível é POR JOGADOR, não pela sala: quem quer o desafio puro joga no
 * Manual contra alguém no Dedutivo, e os dois estão jogando o jogo que
 * querem. Ver docs/03-PRD-DOSSIE.md §6.2.
 *
 * Funciona no turno dos outros — é isso que mata o tempo morto.
 */
export function Bloco({
  caso,
  log,
  mao,
  vistas,
  jogadores,
  nomes,
  meuAssento,
  pad,
  avisos,
  semente,
  onPad,
}: {
  caso: Caso;
  log: LinhaLog[];
  mao: string[];
  vistas: Vista[];
  jogadores: Jogador[];
  nomes: Record<number, string>;
  meuAssento: number | null;
  pad: Pad;
  /* O que as Cartas de Pista contaram. Ausente na mesa que jogou sem o Modo
     Avançado — e uma mesa sem baralho não devia precisar saber que ele existe. */
  avisos?: Aviso[];
  /* O QUE O SERVIDOR JÁ PROVOU PARA ESTE ASSENTO.

     O registro público guarda as sessenta linhas mais novas — ele viaja inteiro
     pelo Realtime a cada jogada —, e este bloco deriva do registro do zero a
     cada renderização. O que caiu do teto deixava de ser sabido, e uma partida
     de verdade chegou a `seq` 281 com sessenta linhas guardadas.

     `dossie_caderno` traz o que não cabe mais no registro. Ausente enquanto a
     resposta não chega, e o bloco funciona sem ela — só com menos memória. */
  semente?: { fora?: string[]; naoTem?: Record<string, string[]> };
  onPad: (p: Pad) => void;
}) {
  const [aberto, setAberto] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nivel = pad.assist ?? "assistido";
  const meus: Marcas = pad.marks ?? {};

  const { fatos, conjuntos } = useMemo(
    () => apura(caso, log, mao, vistas, jogadores, meuAssento, nivel, avisos, semente),
    [caso, log, mao, vistas, jogadores, meuAssento, nivel, avisos, semente],
  );

  /** Grava com folga: anotar é rápido, e não vale uma ida ao servidor por clique. */
  function salva(p: Pad) {
    onPad(p);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onPad({ ...p, marks: p.marks }), 600);
  }

  function clique(carta: string, col: string) {
    if (fatos[carta]?.[col]) return; // fato não se apaga
    const atual = meus[carta]?.[col];
    const nova = proxima(atual);
    const marks: Marcas = { ...meus, [carta]: { ...(meus[carta] ?? {}) } };
    if (nova) marks[carta][col] = nova;
    else delete marks[carta][col];
    sfx.clique();
    salva({ ...pad, marks });
  }

  const cartas = baralho(caso);
  const colunas = [
    ...jogadores.map((j) => ({ id: String(j.seat), rotulo: nomes[j.seat] ?? `#${j.seat}`, mao: j.hand })),
    { id: ENVELOPE, rotulo: "Envelope", mao: 3 },
  ];

  // o envelope está resolvido?
  const fechado = (["suspeito", "objeto", "lugar"] as const).map((tipo) => {
    const eleitas = cartas.filter((c) => c.tipo === tipo && fatos[c.id]?.[ENVELOPE] === "check");
    return eleitas.length === 1 ? eleitas[0] : null;
  });
  const resolvido = fechado.every(Boolean);

  return (
    <div className="panel bloco">
      <button
        type="button"
        className="bloco-cabeca"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
      >
        <span>
          <span className="eyebrow">Bloco de dedução</span>
          <span className="bloco-resumo">
            {conjuntos.length > 0
              ? `${conjuntos.length} ${conjuntos.length === 1 ? "conjunto" : "conjuntos"} em aberto`
              : "nenhum conjunto em aberto"}
            {" · "}
            {NIVEIS.find((n) => n.id === nivel)?.nome.toLowerCase()}
          </span>
        </span>
        <span className="bloco-toggle">{aberto ? "fechar" : "abrir"}</span>
      </button>

      {resolvido && (
        <p className="bloco-resolvido">
          O envelope está determinado: <strong>{fechado[0]!.nome}</strong>, com{" "}
          <strong>{fechado[1]!.nome}</strong>, {fechado[2]!.nome}.
        </p>
      )}

      {aberto && (
        <>
          {/* ── conjuntos ────────────────────────────────────────────── */}
          {conjuntos.length > 0 && (
            <div className="conjuntos">
              <p className="eyebrow mb-2">O que dá para saber sem ver a carta</p>
              <ul>
                {conjuntos.map((c) => (
                  <li key={c.seq}>
                    <strong>{nomes[c.seat] ?? `#${c.seat}`}</strong> tem 1 de:
                    <span className="conjunto-cartas">
                      {c.cards.map((x) => (
                        <span key={x}>{nomeDaCarta(caso, x)}</span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── grade ────────────────────────────────────────────────── */}
          <div className="grade-wrap">
            <table className="grade">
              <thead>
                <tr>
                  <th scope="col">Carta</th>
                  {colunas.map((c) => (
                    <th key={c.id} scope="col" title={`${c.rotulo} · ${c.mao} cartas`}>
                      <span>{c.rotulo.slice(0, 6)}</span>
                      <em>{c.mao}</em>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(["suspeito", "objeto", "lugar"] as const).map((tipo) => (
                  // Fragment com key: sem ela o React reclama de lista sem chave
                  <Fragment key={tipo}>
                    <tr className="grade-sec">
                      <th colSpan={colunas.length + 1} scope="colgroup">
                        {tipo === "suspeito" ? "Suspeitos" : tipo === "objeto" ? "Objetos" : "Lugares"}
                      </th>
                    </tr>
                    {cartas
                      .filter((c) => c.tipo === tipo)
                      .map((carta) => (
                        <tr key={carta.id}>
                          <th scope="row" title={carta.nome}>
                            {carta.nome}
                          </th>
                          {colunas.map((col) => {
                            const { marca, fato } = celula(fatos, meus, carta.id, col.id);
                            return (
                              <td key={col.id}>
                                <button
                                  type="button"
                                  className="cel"
                                  data-marca={marca ?? "vazio"}
                                  data-fato={fato}
                                  disabled={fato}
                                  onClick={() => clique(carta.id, col.id)}
                                  aria-label={`${carta.nome}, ${col.rotulo}${marca ? `, ${marca}` : ", em branco"}${fato ? " (fato)" : ""}`}
                                >
                                  {marca ? SIMBOLO[marca] : ""}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── nível de assistência ─────────────────────────────────── */}
          <div className="bloco-niveis">
            <p className="eyebrow mb-2">Quanto o bloco te ajuda</p>
            {NIVEIS.map((n) => (
              <button
                key={n.id}
                type="button"
                className="rule-option"
                data-on={nivel === n.id}
                onClick={() => salva({ ...pad, assist: n.id })}
              >
                <span className="rule-mark" aria-hidden />
                <span>
                  <span className="rule-name">{n.nome}</span>
                  <span className="rule-note">{n.nota}</span>
                </span>
              </button>
            ))}
            <p className="bloco-nota dim">
              É a sua escolha, não da sala. Dá para jogar no Manual contra alguém no Dedutivo — e os
              dois estão jogando o jogo que querem.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
