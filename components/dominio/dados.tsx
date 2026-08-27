"use client";

import { useEffect, useState } from "react";
import * as sfx from "@/lib/sfx";

/**
 * A rolagem, contada assalto por assalto.
 *
 * O servidor resolve a briga inteira de uma vez e devolve TODAS as rolagens
 * (ver `dominio_atacar`). Isso é bom para a rede e péssimo para o drama: o
 * resultado chegaria pronto e o jogo perderia a única coisa que o WAR tem de
 * melhor, que é ver o dado cair.
 *
 * Então o cliente não decide nada e ainda assim conta a história: ele
 * REPRODUZ, um a um, os assaltos que já aconteceram. O número que aparece é o
 * número que o servidor tirou. A animação é encenação de um fato, não sorteio.
 */

export type Assalto = {
  dAtac: number[];
  dDefe: number[];
  perdeAtac: number;
  perdeDefe: number;
  atac: number;
  defe: number;
};

const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [
    [30, 30],
    [70, 70],
  ],
  3: [
    [28, 28],
    [50, 50],
    [72, 72],
  ],
  4: [
    [30, 30],
    [70, 30],
    [30, 70],
    [70, 70],
  ],
  5: [
    [28, 28],
    [72, 28],
    [50, 50],
    [28, 72],
    [72, 72],
  ],
  6: [
    [30, 26],
    [70, 26],
    [30, 50],
    [70, 50],
    [30, 74],
    [70, 74],
  ],
};

function Dado({
  valor,
  lado,
  rolando,
  ganhou,
  atraso,
}: {
  valor: number;
  lado: "atac" | "defe";
  rolando: boolean;
  /** ganhou o par, perdeu o par, ou não foi comparado */
  ganhou: boolean | null;
  atraso: number;
}) {
  return (
    <span
      className="dado"
      data-lado={lado}
      data-rolando={rolando}
      data-ganhou={ganhou === null ? undefined : ganhou}
      style={{ animationDelay: `${atraso}ms` }}
    >
      <svg viewBox="0 0 100 100" aria-hidden>
        {PIPS[valor]?.map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r={9.5} />
        ))}
      </svg>
      <span className="sr-only">{valor}</span>
    </span>
  );
}

export function Rolagem({
  assaltos,
  nomeAtac,
  nomeDefe,
  onFim,
}: {
  assaltos: Assalto[];
  nomeAtac: string;
  nomeDefe: string;
  onFim: () => void;
}) {
  const [passo, setPasso] = useState(0);
  const [rolando, setRolando] = useState(true);

  /* UM relógio para a briga inteira, e não um efeito por assalto.
     A primeira versão religava `rolando` no corpo do efeito a cada passo —
     que é setState dentro de efeito, o padrão que o React pede para evitar
     porque encadeia renderizações. Aqui a sequência caminha dentro dos
     temporizadores, que é onde mexer em estado é legítimo: o temporizador é
     o "sistema externo" com que o efeito se sincroniza.

     E resolve outro problema de brinde: com um efeito por passo, uma aba que
     perde o foco e volta podia pular assalto. Agora a cadeia é uma só. */
  useEffect(() => {
    let vivo = true;
    let id: ReturnType<typeof setTimeout>;

    const conta = (i: number) => {
      if (!vivo) return;
      if (i >= assaltos.length) {
        id = setTimeout(() => vivo && onFim(), 700);
        return;
      }
      setPasso(i);
      setRolando(true);
      sfx.arm();
      sfx.dado();

      id = setTimeout(() => {
        if (!vivo) return;
        setRolando(false);
        const a = assaltos[i];
        if (a.perdeDefe > a.perdeAtac) sfx.avanca();
        else if (a.perdeAtac > a.perdeDefe) sfx.recua();

        id = setTimeout(() => conta(i + 1), 1150);
      }, 620);
    };

    conta(0);
    return () => {
      vivo = false;
      clearTimeout(id);
    };
  }, [assaltos, onFim]);

  const atual = assaltos[Math.min(passo, assaltos.length - 1)];
  if (!atual) return null;

  const pares = Math.min(atual.dAtac.length, atual.dDefe.length);
  // o par i é vitória do atacante quando o dado dele é MAIOR; empate é do
  // defensor, e é por isso que a comparação não é simétrica
  const venceuPar = (i: number) => atual.dAtac[i] > atual.dDefe[i];

  return (
    <div className="rolagem" role="status" aria-live="polite">
      <div className="rolagem-topo">
        <span className="rolagem-quem">{nomeAtac}</span>
        <span className="rolagem-vs mono">
          {passo + 1} de {assaltos.length}
        </span>
        <span className="rolagem-quem rolagem-quem-d">{nomeDefe}</span>
      </div>

      <div className="rolagem-mesa">
        <div className="rolagem-lado">
          {atual.dAtac.map((v, i) => (
            <Dado
              key={i}
              valor={v}
              lado="atac"
              rolando={rolando}
              ganhou={i < pares ? venceuPar(i) : null}
              atraso={i * 90}
            />
          ))}
        </div>

        <div className="rolagem-meio" aria-hidden>
          {Array.from({ length: pares }, (_, i) => (
            <span key={i} className="rolagem-par" data-para={rolando ? undefined : venceuPar(i) ? "atac" : "defe"}>
              {rolando ? "·" : venceuPar(i) ? "‹" : "›"}
            </span>
          ))}
        </div>

        <div className="rolagem-lado rolagem-lado-d">
          {atual.dDefe.map((v, i) => (
            <Dado
              key={i}
              valor={v}
              lado="defe"
              rolando={rolando}
              ganhou={i < pares ? !venceuPar(i) : null}
              atraso={i * 90 + 45}
            />
          ))}
        </div>
      </div>

      {!rolando && (
        <p className="rolagem-conta">
          {atual.perdeAtac > 0 && (
            <span className="rolagem-baixa" data-lado="atac">
              −{atual.perdeAtac} atacante{atual.perdeAtac > 1 ? "s" : ""}
            </span>
          )}
          {atual.perdeDefe > 0 && (
            <span className="rolagem-baixa" data-lado="defe">
              −{atual.perdeDefe} defensor{atual.perdeDefe > 1 ? "es" : ""}
            </span>
          )}
          <span className="rolagem-restam mono">
            {atual.atac} × {atual.defe}
          </span>
        </p>
      )}
    </div>
  );
}
