"use client";

import { useState } from "react";
import {
  DO_GRUPO,
  GRUPOS,
  POR_ID,
  REGRAS,
  aluguelAtual,
  custoResgate,
  fluxo,
  grupoCompleto,
  reais,
  type GrupoId,
  type Props,
} from "@/lib/metropole/cidade";

/**
 * O PAINEL DE FLUXO DE CAIXA.
 *
 * É a melhoria mais importante deste jogo, e a que não existe na mesa.
 *
 * O problema que ela resolve: em Banco Imobiliário você não sabe se está
 * ganhando. Patrimônio, entrada e saída são invisíveis, e você descobre que
 * quebrou no instante em que quebra — quando já não há nada a negociar. Aqui o
 * número aparece antes: quanto entra, quanto sai, e em quantas rodadas o caixa
 * acaba no ritmo atual.
 *
 * E os valores esperados são calculados DE VERDADE. Não é "aluguel médio":
 * é a chance de parar em cada casa (distribuição estacionária do tabuleiro,
 * com a Cadeia e as cartas dentro da conta — ver lib/metropole/cidade.ts)
 * multiplicada pelo aluguel que cada casa cobra agora.
 *
 * Isso muda o jogo. Você para de descobrir que quebrou quando quebra, e passa
 * a negociar antes. Ver docs/05-PRD-METROPOLE.md §5.3.
 */
export function Fluxo({
  props,
  seat,
  cash,
  quantosJogam,
}: {
  props: Props;
  seat: number;
  cash: number;
  quantosJogam: number;
}) {
  const f = fluxo(props, seat, cash, quantosJogam);
  const ruim = f.saldo < 0;

  return (
    <div className="panel fluxo">
      <p className="eyebrow">Seu balanço</p>

      <p className="fluxo-total mono">{reais(f.patrimonio)}</p>
      <ul className="fluxo-quebra">
        <li>
          <span>dinheiro</span>
          <span className="mono">{reais(cash)}</span>
        </li>
        <li>
          <span>propriedades</span>
          <span className="mono">{reais(f.emPropriedades)}</span>
        </li>
        <li>
          <span>construções</span>
          <span className="mono">{reais(f.emConstrucoes)}</span>
        </li>
      </ul>

      <p className="eyebrow fluxo-titulo">Por rodada</p>
      <ul className="fluxo-quebra">
        <li>
          <span>salário</span>
          <span className="mono fluxo-mais">+{reais(REGRAS.salario).slice(1)}</span>
        </li>
        <li>
          <span>aluguel a receber</span>
          <span className="mono fluxo-mais">+{reais(f.receber).slice(1)}</span>
        </li>
        <li>
          <span>aluguel a pagar</span>
          <span className="mono fluxo-menos">−{reais(f.pagar).slice(1)}</span>
        </li>
        <li className="fluxo-saldo" data-ruim={ruim}>
          <span>saldo</span>
          <span className="mono">
            {f.saldo >= 0 ? "+" : "−"}
            {reais(f.saldo).replace("−", "").slice(1)}
          </span>
        </li>
      </ul>

      {/* O aviso só aparece quando é aviso. Um alerta que está sempre na tela
          não é alerta, é decoração. */}
      {f.rodadasDeSobrevida !== null && (
        <p className="fluxo-aviso">
          No ritmo de agora, seu dinheiro acaba em{" "}
          <strong>
            {f.rodadasDeSobrevida} {f.rodadasDeSobrevida === 1 ? "rodada" : "rodadas"}
          </strong>
          . Hipotecar, vender construção ou negociar — antes, não depois.
        </p>
      )}

      <p className="fluxo-nota dim">
        Os valores esperados usam a chance real de parar em cada casa. A Cadeia é a casa mais
        visitada do tabuleiro, e as próximas a ela recebem mais visita que a média — a conta sabe
        disso.
      </p>
    </div>
  );
}

/**
 * As minhas propriedades, por grupo — e é aqui que se administra.
 *
 * O tabuleiro responde "onde estou"; esta lista responde "o que eu tenho e o
 * que faço com isso". Separar as duas é o que permite o tabuleiro caber num
 * celular sem virar letra de bula: a informação de gestão sai de cima das casas
 * e vem para onde há espaço.
 */
export function MinhasProps({
  props,
  seat,
  cash,
  banco,
  podeAgir,
  onConstruir,
  onVender,
  onHipotecar,
  onResgatar,
}: {
  props: Props;
  seat: number;
  cash: number;
  banco: { casas: number; hoteis: number };
  podeAgir: boolean;
  onConstruir: (prop: string, n: number) => void;
  onVender: (prop: string, n: number) => void;
  onHipotecar: (prop: string) => void;
  onResgatar: (prop: string) => void;
}) {
  const [aberto, setAberto] = useState<string | null>(null);

  const meus = Object.entries(props).filter(([, e]) => e.owner === seat);
  if (meus.length === 0) {
    return (
      <div className="panel">
        <p className="eyebrow">Suas propriedades</p>
        <p className="dim mt-2 text-sm">
          Nenhuma ainda. Comprar quando cair, ou dar lance no leilão de quem não comprou.
        </p>
      </div>
    );
  }

  const gruposComAlgo = GRUPOS.filter((g) =>
    DO_GRUPO[g.id].some((c) => props[c.id!]?.owner === seat),
  );
  const outras = meus
    .map(([id]) => POR_ID[id])
    .filter((c) => c.t === "transporte" || c.t === "companhia");

  return (
    <div className="panel minhas">
      <div className="minhas-topo">
        <p className="eyebrow">Suas propriedades · {meus.length}</p>
        <p className="minhas-banco mono dim">
          banco: {banco.casas} casas · {banco.hoteis} hotéis
        </p>
      </div>

      {gruposComAlgo.map((g) => {
        const doGrupo = DO_GRUPO[g.id];
        const completo = grupoCompleto(props, seat, g.id);
        const hipotecado = doGrupo.some((c) => props[c.id!]?.hipotecada);

        return (
          <div key={g.id} className="grupo" data-completo={completo}>
            <div className="grupo-cabeca">
              <span className="grupo-cor" style={{ background: g.cor }} aria-hidden />
              <span className="grupo-nome">{g.nome}</span>
              <span className="grupo-conta mono">
                {doGrupo.filter((c) => props[c.id!]?.owner === seat).length}/{doGrupo.length}
              </span>
              {completo && <span className="grupo-selo">monopólio</span>}
            </div>

            {/* A razão de o monopólio aparecer aqui e não no tabuleiro: é a
                informação que muda o que você FAZ, e o que você faz é nesta
                lista. */}
            {!completo && (
              <p className="grupo-nota dim">
                Faltam {doGrupo.length - doGrupo.filter((c) => props[c.id!]?.owner === seat).length}{" "}
                para construir. Sem o grupo inteiro, o aluguel também não dobra.
              </p>
            )}
            {completo && hipotecado && (
              <p className="grupo-nota dim">
                Tem propriedade hipotecada no grupo: resgate antes de construir.
              </p>
            )}

            <ul className="props">
              {doGrupo
                .filter((c) => props[c.id!]?.owner === seat)
                .map((c) => {
                  const e = props[c.id!];
                  const podeConstruir =
                    podeAgir && completo && !hipotecado && !e.hotel && cash >= (c.casa ?? 0);
                  return (
                    <li key={c.id} className="prop" data-aberta={aberto === c.id}>
                      <button
                        type="button"
                        className="prop-linha"
                        onClick={() => setAberto((a) => (a === c.id ? null : c.id!))}
                        aria-expanded={aberto === c.id}
                      >
                        <span className="prop-nome">{c.nome}</span>
                        {e.hotel ? (
                          <span className="prop-obra">hotel</span>
                        ) : e.casas > 0 ? (
                          <span className="prop-obra">
                            {e.casas} {e.casas === 1 ? "casa" : "casas"}
                          </span>
                        ) : null}
                        {e.hipotecada && <span className="prop-hip">hipotecada</span>}
                        {/* metade do aluguel desta não é sua: o Investidor pôs
                            o dinheiro e você pôs a mão. A etiqueta existe para
                            o administrador não esquecer disso ao construir. */}
                        {e.investidor !== undefined && (
                          <span className="prop-socio" title="meia-parte de Investidor">
                            ½
                          </span>
                        )}
                        <span className="prop-aluguel mono">
                          {reais(aluguelAtual(props, c.id!))}
                        </span>
                      </button>

                      {aberto === c.id && (
                        <div className="prop-corpo">
                          <TabelaAluguel prop={c.id!} props={props} seat={seat} />

                          <div className="prop-acoes">
                            {podeConstruir && (
                              <>
                                <button
                                  className="btn btn-brass prop-btn"
                                  onClick={() => onConstruir(c.id!, 1)}
                                >
                                  Construir · {reais(c.casa ?? 0)}
                                </button>
                                {e.casas === 4 && banco.hoteis > 0 && (
                                  <span className="prop-dica">a próxima vira hotel</span>
                                )}
                              </>
                            )}
                            {podeAgir && (e.casas > 0 || e.hotel) && (
                              <button
                                className="btn btn-ghost prop-btn"
                                onClick={() => onVender(c.id!, 1)}
                              >
                                Vender construção · +{reais((c.casa ?? 0) / 2).slice(3)}
                              </button>
                            )}
                            {podeAgir && !e.hipotecada && e.casas === 0 && !e.hotel && (
                              <button
                                className="btn btn-ghost prop-btn"
                                onClick={() => onHipotecar(c.id!)}
                              >
                                Hipotecar · +{reais(c.hipoteca ?? 0).slice(3)}
                              </button>
                            )}
                            {podeAgir && e.hipotecada && (
                              <button
                                className="btn btn-ghost prop-btn"
                                onClick={() => onResgatar(c.id!)}
                              >
                                Resgatar ·{" "}
                                {reais(custoResgate(c.hipoteca ?? 0))}
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
            </ul>
          </div>
        );
      })}

      {outras.length > 0 && (
        <div className="grupo">
          <div className="grupo-cabeca">
            <span className="grupo-cor" style={{ background: "#7BA392" }} aria-hidden />
            <span className="grupo-nome">Transportes e companhias</span>
          </div>
          <ul className="props">
            {outras.map((c) => {
              const e = props[c.id!];
              return (
                <li key={c.id} className="prop">
                  <div className="prop-linha">
                    <span className="prop-nome">{c.nome}</span>
                    {e.hipotecada && <span className="prop-hip">hipotecada</span>}
                    <span className="prop-aluguel mono">{reais(aluguelAtual(props, c.id!))}</span>
                  </div>
                  {podeAgir && (
                    <div className="prop-acoes">
                      {!e.hipotecada ? (
                        <button
                          className="btn btn-ghost prop-btn"
                          onClick={() => onHipotecar(c.id!)}
                        >
                          Hipotecar · +{reais(c.hipoteca ?? 0).slice(3)}
                        </button>
                      ) : (
                        <button
                          className="btn btn-ghost prop-btn"
                          onClick={() => onResgatar(c.id!)}
                        >
                          Resgatar ·{" "}
                          {reais(custoResgate(c.hipoteca ?? 0))}
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** A escada de aluguel, com a faixa de agora acesa. */
function TabelaAluguel({
  prop,
  props,
  seat,
}: {
  prop: string;
  props: Props;
  seat: number;
}) {
  const c = POR_ID[prop];
  const e = props[prop];
  if (c.t !== "bairro") return null;

  const completo = grupoCompleto(props, seat, c.g as GrupoId);
  const agora = e.hotel ? 5 : e.casas;
  const rotulos = ["sem casa", "1 casa", "2 casas", "3 casas", "4 casas", "hotel"];

  return (
    <ul className="tabela">
      {c.aluguel!.map((v, i) => (
        <li key={i} data-agora={i === agora}>
          <span>{rotulos[i]}</span>
          <span className="mono">
            {reais(i === 0 && completo ? v * 2 : v)}
            {i === 0 && completo && <span className="tabela-dobro"> ×2</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
