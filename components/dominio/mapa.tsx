"use client";

import { useEffect, useMemo, useRef } from "react";
import { COLORS, type ColorKey } from "@/lib/avatar";
import type { Mapa } from "@/lib/dominio/mapas";

/**
 * O tabuleiro de Vantara.
 *
 * Uma decisão de fundo, tomada contra o reflexo: este mapa NÃO é um mapa. Não
 * tem litoral desenhado, não tem relevo, não tem projeção. É um GRAFO
 * esquemático numa grade de 12 × 7, e cada território é uma peça quadrada.
 *
 * O motivo é que a única informação que decide jogada no WAR é topológica —
 * quem é vizinho de quem, e quantos exércitos tem cada um. Um mapa bonito com
 * fronteiras sinuosas esconde justamente isso: você fica adivinhando se dois
 * territórios se tocam. Aqui as arestas são desenhadas. Se há linha, há
 * fronteira; se não há linha, não há. Nunca mais "eu achei que dava para
 * atacar dali".
 *
 * As três leituras que a peça carrega ao mesmo tempo:
 *   1. DE QUEM É   — a cor do esmalte, a mesma do avatar da pessoa.
 *   2. QUANTO TEM  — o número, grande, no meio.
 *   3. ONDE FICA   — a placa de continente atrás, na cor do continente.
 */

const CELULA = 100;
const PECA = 78;

type Props = {
  /** qual mapa esta partida usa — Vantara ou o recorte Relâmpago */
  mapa: Mapa;
  donos: Record<string, number>;
  exercitos: Record<string, number>;
  /** assento → chave de cor (a mesma cor do avatar dele) */
  cores: Record<number, ColorKey>;
  meuAssento: number | null;
  /** o território de onde a ação parte */
  origem: string | null;
  /** para onde a ação PODE ir — o resto fica apagado */
  alvos: string[];
  /** exércitos que acabaram de mudar, para piscar */
  mexeu?: string[];
  onEscolher: (ter: string) => void;
  disabled?: boolean;
};

export function MapaVantara({
  mapa,
  donos,
  exercitos,
  cores,
  meuAssento,
  origem,
  alvos,
  mexeu = [],
  onEscolher,
  disabled,
}: Props) {
  const largura = mapa.grade.cols * CELULA;
  const altura = mapa.grade.rows * CELULA;

  const centro = (id: string) => {
    const t = mapa.porId[id];
    return { x: t.col * CELULA + CELULA / 2, y: t.row * CELULA + CELULA / 2 };
  };

  /** Cada fronteira uma vez só: 83 arestas, não 166. */
  const arestas = useMemo(() => {
    const vistas = new Set<string>();
    const out: { a: string; b: string }[] = [];
    for (const t of mapa.territorios) {
      for (const v of t.vizinhos) {
        const chave = [t.id, v].sort().join("~");
        if (vistas.has(chave)) continue;
        vistas.add(chave);
        out.push({ a: t.id, b: v });
      }
    }
    return out;
    /* `mapa` é constante de módulo (VANTARA ou RELAMPAGO), então a dependência
       não custa nada em recálculo — e sem ela o compilador do React desiste do
       componente inteiro, que custa muito. */
  }, [mapa]);

  const alvoSet = useMemo(() => new Set(alvos), [alvos]);
  const mexeuSet = useMemo(() => new Set(mexeu), [mexeu]);

  /* ── O MAPA SEGUE O QUE ACONTECEU ─────────────────────────────

     Num celular de 360px, o mapa tem 680px — quase metade fica fora da tela. E
     desde que existe máquina, boa parte do que acontece na partida acontece
     enquanto a pessoa só assiste. Se a máquina toma um território que está fora
     do pedaço visível, a pessoa vê a barra de exército mudar em algum lugar que
     ela não está olhando — ou seja, não vê nada.

     Então quando um território pisca (`mexeu`), a rolagem vai até ele. Só na
     horizontal, só quando ele está mesmo fora, e com `behavior: smooth` para o
     olho acompanhar o movimento em vez de se perder num salto.

     Numa tela larga isto não faz nada, porque não há o que rolar. */
  const rolo = useRef<HTMLDivElement | null>(null);
  const primeiroMexeu = mexeu[0] ?? null;

  useEffect(() => {
    const caixa = rolo.current;
    if (!caixa || !primeiroMexeu) return;
    const t = mapa.porId[primeiroMexeu];
    if (!t) return;
    if (caixa.scrollWidth <= caixa.clientWidth) return;   // nada a rolar

    const svg = caixa.querySelector("svg");
    if (!svg) return;
    // do sistema do viewBox para o pixel da tela
    const escala = svg.clientWidth / (mapa.grade.cols * CELULA);
    const x = (t.col * CELULA + CELULA / 2) * escala;
    const alvoX = Math.max(0, x - caixa.clientWidth / 2);

    // já está à vista? então não mexe: rolagem que se move sem motivo cansa
    const margem = CELULA * escala;
    if (x > caixa.scrollLeft + margem && x < caixa.scrollLeft + caixa.clientWidth - margem) {
      return;
    }
    caixa.scrollTo({ left: alvoX, behavior: "smooth" });
  }, [mapa, primeiroMexeu]);

  return (
    <div className="mapa-rolo" ref={rolo}>
      <svg
        className="mapa"
        viewBox={`0 0 ${largura} ${altura}`}
        role="group"
        aria-label="Mapa de Vantara"
      >
        {/* As tramas das facções, definidas uma vez e referenciadas por CSS.
            `patternUnits="userSpaceOnUse"` mantém a trama do mesmo tamanho em
            todas as peças — com `objectBoundingBox` ela esticaria junto com o
            retângulo e duas facções ficariam parecidas de novo. */}
        <defs>
          <pattern id="tex-ponto" width="10" height="10" patternUnits="userSpaceOnUse">
            <circle cx="5" cy="5" r="1.7" fill="#fff" fillOpacity="0.3" />
          </pattern>
          <pattern
            id="tex-diag-d"
            width="9"
            height="9"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="3" height="9" fill="#fff" fillOpacity="0.22" />
          </pattern>
          <pattern
            id="tex-diag-e"
            width="9"
            height="9"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(-45)"
          >
            <rect width="3" height="9" fill="#fff" fillOpacity="0.22" />
          </pattern>
          <pattern id="tex-vert" width="9" height="9" patternUnits="userSpaceOnUse">
            <rect width="3" height="9" fill="#fff" fillOpacity="0.22" />
          </pattern>
          <pattern id="tex-horiz" width="9" height="9" patternUnits="userSpaceOnUse">
            <rect width="9" height="3" fill="#fff" fillOpacity="0.22" />
          </pattern>
          <pattern
            id="tex-xadrez"
            width="9"
            height="9"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="3" height="9" fill="#fff" fillOpacity="0.2" />
            <rect width="9" height="3" fill="#fff" fillOpacity="0.2" />
          </pattern>
          <pattern id="tex-grade" width="11" height="11" patternUnits="userSpaceOnUse">
            <rect width="11" height="2.5" fill="#fff" fillOpacity="0.26" />
            <rect width="2.5" height="11" fill="#fff" fillOpacity="0.26" />
          </pattern>
        </defs>
        {/* ── placas de continente ────────────────────────────────────────
            Cada continente é um grupo com opacidade ÚNICA. Se a opacidade
            fosse por retângulo, as sobreposições entre células vizinhas
            escureceriam e apareceriam costuras onde não há divisão. */}
        {mapa.continentes.map((c) => (
          <g key={c.id} opacity={0.17}>
            {mapa.territorios.filter((t) => t.continente === c.id).map((t) => (
              <rect
                key={t.id}
                x={t.col * CELULA + 2}
                y={t.row * CELULA + 2}
                width={CELULA - 4}
                height={CELULA - 4}
                rx={26}
                fill={c.cor}
              />
            ))}
          </g>
        ))}

        {/* ── fronteiras ──────────────────────────────────────────────────
            Todas visíveis de leve; a da jogada em curso acende. É a camada
            que substitui o litoral desenhado. */}
        <g className="mapa-arestas">
          {arestas.map(({ a, b }) => {
            const p = centro(a);
            const q = centro(b);
            const ativa =
              !!origem && ((a === origem && alvoSet.has(b)) || (b === origem && alvoSet.has(a)));
            return (
              <line
                key={`${a}~${b}`}
                x1={p.x}
                y1={p.y}
                x2={q.x}
                y2={q.y}
                data-ativa={ativa}
              />
            );
          })}
        </g>

        {/* ── territórios ─────────────────────────────────────────────── */}
        {mapa.territorios.map((t) => {
          const dono = donos[t.id];
          const cor = COLORS[cores[dono] ?? "grafite"];
          const meu = dono === meuAssento;
          const n = exercitos[t.id] ?? 0;
          const ehOrigem = origem === t.id;
          const ehAlvo = alvoSet.has(t.id);
          // com uma jogada em curso, o que não participa dela apaga. É o que
          // faz 42 peças pararem de competir pela atenção.
          const apagado = !!origem && !ehOrigem && !ehAlvo;
          const x = t.col * CELULA + (CELULA - PECA) / 2;
          const y = t.row * CELULA + (CELULA - PECA) / 2;

          return (
            <g
              key={t.id}
              className="ter"
              data-origem={ehOrigem}
              data-alvo={ehAlvo}
              data-apagado={apagado}
              data-meu={meu}
              data-cor={cores[dono] ?? "grafite"}
              data-mexeu={mexeuSet.has(t.id)}
              onClick={() => !disabled && onEscolher(t.id)}
              role="button"
              tabIndex={disabled ? -1 : 0}
              aria-label={`${t.nome}, ${n} ${n === 1 ? "exército" : "exércitos"}${
                meu ? ", seu" : ""
              }`}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if (!disabled) onEscolher(t.id);
                }
              }}
            >
              {/* a sombra sólida embaixo é o que dá o volume de peça de
                  madeira; sem ela o mapa vira diagrama */}
              <rect
                className="ter-sombra"
                x={x}
                y={y + 6}
                width={PECA}
                height={PECA}
                rx={16}
                fill={cor.deep}
              />
              <rect
                className="ter-face"
                x={x}
                y={y}
                width={PECA}
                height={PECA}
                rx={16}
                fill={cor.enamel}
              />
              {/* A TEXTURA DA FACÇÃO, por cima do esmalte.
                  Critério de aceite do PRD: duas facções quaisquer têm de ser
                  distinguíveis em protanopia, deuteranopia e tritanopia. As
                  oito cores do projeto não garantem isso — vermelho e verde
                  caem no mesmo tom em duas dessas condições, e o mapa pode ter
                  as duas na mesma partida. Confundir facção num mapa de guerra
                  é atacar o aliado.

                  A solução não é trocar a paleta: a cor é como as pessoas
                  falam ("o vermelho vai me atacar"). É somar uma textura, e
                  oito texturas continuam sendo oito coisas em escala de cinza
                  total. Ela é discreta de propósito — quem vê cor não deve
                  notar; quem não vê, sim. */}
              <rect
                className="ter-textura"
                x={x}
                y={y}
                width={PECA}
                height={PECA}
                rx={16}
              />
              <text className="ter-num" x={x + PECA / 2} y={y + PECA / 2 + 1} fill={cor.ink}>
                {n}
              </text>
              <text className="ter-nome" x={x + PECA / 2} y={y + PECA - 9} fill={cor.ink}>
                {t.nome}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** A legenda: qual continente vale quanto, e quem está perto de fechar. */
export function LegendaContinentes({
  mapa,
  donos,
  cores,
}: {
  mapa: Mapa;
  donos: Record<string, number>;
  cores: Record<number, ColorKey>;
}) {
  return (
    <ul className="continentes">
      {mapa.continentes.map((c) => {
        const meus = mapa.porContinente[c.id] ?? [];
        const contagem = new Map<number, number>();
        for (const t of meus) {
          const d = donos[t.id];
          if (d === undefined) continue;
          contagem.set(d, (contagem.get(d) ?? 0) + 1);
        }
        // quem está mais perto de fechar o continente
        const lider = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0];
        const fechou = lider && lider[1] === meus.length;

        return (
          <li key={c.id} className="continente" data-fechado={!!fechou}>
            <span className="continente-cor" style={{ background: c.cor }} aria-hidden />
            <span className="continente-nome">{c.nome}</span>
            <span className="continente-bonus mono">+{c.bonus}</span>
            <span className="continente-conta mono">
              {fechou ? (
                <span
                  className="continente-selo"
                  style={{ background: COLORS[cores[lider[0]] ?? "grafite"].enamel }}
                >
                  fechado
                </span>
              ) : (
                `${lider?.[1] ?? 0}/${meus.length}`
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
