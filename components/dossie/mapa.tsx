"use client";

import { Avatar } from "@/components/avatar";
import { parseAvatar } from "@/lib/avatar";
import { alcancavel, ehPassagem, type Caso } from "@/lib/dossie";

export type Peao = {
  seat: number;
  userId: string;
  nome: string;
  avatar: unknown;
  suspeito: string;
  fantasma: boolean;
};

/**
 * A planta baixa do caso.
 *
 * Iluminação é mecânica visual, não enfeite: lugar vazio fica apagado, lugar
 * com gente acende. O lugar do palpite ganha foco e o resto escurece — a
 * atenção da mesa vai sozinha para onde o jogo está.
 *
 * O desenho todo sai do pacote do tema (`col`, `row`, `adjacency`,
 * `secretPassages`). Nenhum cômodo está escrito aqui — trocar o caso troca a
 * planta sem tocar neste arquivo.
 */
export function Mapa({
  caso,
  posicoes,
  objetos,
  peoes,
  euEstouEm,
  destaque,
  alcancaveis,
  fechados,
  aviso,
  onEscolher,
}: {
  caso: Caso;
  /** assento -> id do lugar */
  posicoes: Record<string, string>;
  /** id do objeto -> id do lugar */
  objetos: Record<string, string>;
  peoes: Peao[];
  euEstouEm?: string;
  /** lugar em foco (palpite acontecendo ali) */
  destaque?: string | null;
  /** true quando é a minha vez e eu tenho ação para gastar */
  alcancaveis?: boolean;
  /** lugares que a tempestade fechou AGORA: ninguém entra, ninguém sai */
  fechados?: string[];
  /** e os que fecham na PRÓXIMA rodada — o aviso é o que torna a regra jogável */
  aviso?: string[];
  onEscolher?: (lugar: string) => void;
}) {
  const cols = Math.max(...caso.rooms.map((r) => r.col)) + 1;
  const rows = Math.max(...caso.rooms.map((r) => r.row)) + 1;

  return (
    <div className="mapa" data-focando={!!destaque}>
      <div
        className="mapa-grade"
        style={{
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridTemplateRows: `repeat(${rows}, 1fr)`,
        }}
      >
        {caso.rooms.map((lugar) => {
          const aqui = peoes.filter((p) => posicoes[String(p.seat)] === lugar.id);
          const armas = Object.entries(objetos)
            .filter(([, onde]) => onde === lugar.id)
            .map(([id]) => id);
          /* A TEMPESTADE FECHA OS DOIS LADOS, e o mapa mostra os dois: quem
             está preso vê que não sai, e quem está fora vê que não entra. Um
             botão que parece clicável e recusa no servidor é a pior das duas
             opções — gasta o toque e não explica. */
          const trancado = (fechados ?? []).includes(lugar.id);
          const vaiFechar = (aviso ?? []).includes(lugar.id);
          const presoAqui = (fechados ?? []).includes(euEstouEm ?? "");

          const podeIr =
            !!alcancaveis && !!euEstouEm && euEstouEm !== lugar.id &&
            !trancado && !presoAqui &&
            alcancavel(caso, euEstouEm, lugar.id);
          const porPassagem = !!euEstouEm && ehPassagem(caso, euEstouEm, lugar.id);

          return (
            <button
              key={lugar.id}
              type="button"
              className="lugar"
              style={{ gridColumn: lugar.col + 1, gridRow: lugar.row + 1 }}
              data-aceso={aqui.length > 0}
              data-foco={destaque === lugar.id}
              data-aqui={euEstouEm === lugar.id}
              data-pode={podeIr}
              data-trancado={trancado}
              data-vai-fechar={vaiFechar}
              disabled={!podeIr || !onEscolher}
              onClick={() => podeIr && onEscolher?.(lugar.id)}
              aria-label={
                `${lugar.name}${aqui.length ? `, ${aqui.map((p) => p.nome).join(", ")}` : ", vazio"}` +
                (trancado ? ", fechado pela tempestade" : "") +
                (vaiFechar ? ", fecha na próxima rodada" : "") +
                (podeIr ? ", alcançável" : "")
              }
            >
              <span className="lugar-nome">{lugar.name}</span>

              {(trancado || vaiFechar) && (
                <span className="lugar-vento">{trancado ? "fechado" : "fecha já"}</span>
              )}

              {porPassagem && podeIr && (
                <span className="lugar-passagem" title="Passagem secreta">
                  passagem
                </span>
              )}

              <span className="lugar-peoes">
                {aqui.map((p) => (
                  <span key={p.userId} className="peao" data-fantasma={p.fantasma} title={p.nome}>
                    <Avatar spec={parseAvatar(p.avatar)} size={28} />
                  </span>
                ))}
              </span>

              {armas.length > 0 && (
                <span className="lugar-armas">
                  {armas.map((a) => (
                    <span key={a} className="arma" title={caso.weapons.find((w) => w.id === a)?.name}>
                      {(caso.weapons.find((w) => w.id === a)?.name ?? a).slice(0, 1)}
                    </span>
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* as passagens secretas, desenhadas por cima */}
      <svg className="mapa-passagens" viewBox={`0 0 ${cols * 100} ${rows * 100}`} aria-hidden>
        {caso.secretPassages.map(([a, b], i) => {
          const ra = caso.rooms.find((r) => r.id === a);
          const rb = caso.rooms.find((r) => r.id === b);
          if (!ra || !rb) return null;
          return (
            <line
              key={i}
              x1={ra.col * 100 + 50}
              y1={ra.row * 100 + 50}
              x2={rb.col * 100 + 50}
              y2={rb.row * 100 + 50}
            />
          );
        })}
      </svg>
    </div>
  );
}
