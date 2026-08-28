"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as sfx from "@/lib/sfx";
import type { Caso } from "@/lib/dossie";

/**
 * A abertura do caso.
 *
 * Não é uma tela de carregamento com o nome do jogo: é a história sendo
 * contada, um parágrafo por vez, com a chuva ao fundo e a trilha entrando
 * embaixo. É aqui que a mesa para de conversar e presta atenção.
 *
 * Pulável a qualquer momento — na segunda partida ninguém quer ver de novo,
 * e obrigar a ver é o jeito mais rápido de fazer alguém odiar a abertura.
 */
export function Abertura({
  caso,
  reviravolta,
  onFim,
}: {
  caso: Caso;
  /** true quando a regra própria do caso está valendo nesta partida */
  reviravolta?: boolean;
  onFim: () => void;
}) {
  const beats = caso.narracao ?? [caso.tagline];
  const [ato, setAto] = useState(-1); // -1 = cartaz do título
  const fechado = useRef(false);

  const encerra = useCallback(() => {
    if (fechado.current) return;
    fechado.current = true;
    onFim();
  }, [onFim]);

  // a trilha entra na abertura e fica rodando na partida
  useEffect(() => {
    sfx.arm();
    sfx.iniciaTrilha(caso.clima ?? "misterio");
    return () => {
      /* a trilha continua: quem para é o fim da partida */
    };
  }, [caso.clima]);

  useEffect(() => {
    const espera = ato < 0 ? 3200 : 4200;
    const id = setTimeout(() => {
      if (ato + 1 >= beats.length) encerra();
      else {
        setAto(ato + 1);
        sfx.porta();
      }
    }, espera);
    return () => clearTimeout(id);
  }, [ato, beats.length, encerra]);

  return (
    <div className="abertura" onClick={encerra} role="presentation">
      <div className="abertura-chuva" aria-hidden />

      {ato < 0 ? (
        <div className="abertura-cartaz">
          <p className="abertura-era">{caso.era}</p>
          <h1 className="abertura-nome">{caso.name}</h1>
          <p className="abertura-tagline">{caso.tagline}</p>
          <p className="abertura-vitima">
            <strong>{caso.victim.name}</strong>
            <span> · {caso.victim.role}</span>
          </p>

          {/* A REGRA DO CASO, DITA ANTES DA PRIMEIRA JOGADA.

              Uma reviravolta que a pessoa descobre quando ela acontece é uma
              armadilha, não uma regra. "A luz vai cair uma vez entre a quarta e a
              oitava rodada" muda como se joga desde a primeira — quem sabe
              guarda uma pergunta para o escuro.

              Só aparece quando a regra está VALENDO: a mesa que desligou nas
              Regras da Casa não precisa ler sobre o que não vai acontecer. */}
          {reviravolta && caso.twist && (
            <p className="abertura-twist">
              <strong>{caso.twist.name}</strong>
              <span>{caso.twist.rule}</span>
            </p>
          )}
        </div>
      ) : (
        <p className="abertura-beat" key={ato}>
          {beats[ato]}
        </p>
      )}

      <button
        type="button"
        className="btn btn-ghost abertura-pular"
        onClick={(e) => {
          e.stopPropagation();
          encerra();
        }}
      >
        Pular
      </button>

      <div className="abertura-pontos" aria-hidden>
        {beats.map((_, i) => (
          <span key={i} data-on={i <= ato} />
        ))}
      </div>
    </div>
  );
}
