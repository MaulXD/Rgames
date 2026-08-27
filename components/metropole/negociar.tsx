"use client";

import { useMemo, useState } from "react";
import { COLORS, type ColorKey } from "@/lib/avatar";
import { GRUPO_POR_ID, POR_ID, reais, type Props } from "@/lib/metropole/cidade";

/**
 * A MESA DE NEGOCIAÇÃO.
 *
 * O problema de desenho aqui é real: são sete tipos de item, de cada lado, e
 * uma proposta pode combinar vários. Um formulário com quatorze campos abertos
 * é o caminho mais rápido para ninguém negociar nada.
 *
 * A solução é a mesma que a mesa de verdade usa: você EMPILHA coisas no meio.
 * Cada item é um botão que entra ou sai da pilha, e a pilha se lê numa frase.
 * As três cláusulas — parcelamento, isenção, opção — ficam atrás de um "mais",
 * porque são as menos usadas e as que precisam de dois números cada.
 *
 * E a proposta inteira é RESUMIDA EM UMA LINHA antes de sair. É o único jeito
 * de alguém conferir o que está mandando sem reler quatorze campos.
 */

export type Lado = {
  dinheiro?: number;
  props?: string[];
  livras?: number;
  parcela?: { valor: number; rodadas: number } | null;
  isencao?: { props: string[] | null; rodadas: number } | null;
  opcao?: { prop: string; preco: number; ate: number } | null;
};

export type Oferta = {
  id: string;
  de: number;
  para: number;
  da: Lado;
  quer: Lado;
  rodada: number;
};

export type Contrato = {
  id: string;
  tipo: "parcela" | "isencao" | "opcao";
  de: number;
  para: number;
  valor: number;
  props: string[] | null;
  rodadas: number;
  ate: number | null;
};

type Jogador = {
  seat: number;
  cor: ColorKey;
  cash: number;
  livras: number;
  quebrado: boolean;
};

/** Escreve um lado da proposta em português corrido. */
export function frase(lado: Lado): string {
  const partes: string[] = [];
  if (lado.dinheiro) partes.push(reais(lado.dinheiro));
  if (lado.props?.length) {
    partes.push(lado.props.map((p) => POR_ID[p]?.nome ?? p).join(", "));
  }
  if (lado.livras) partes.push(`${lado.livras} carta de saída`);
  if (lado.parcela) {
    partes.push(
      `${reais(lado.parcela.valor)} por rodada durante ${lado.parcela.rodadas} ${
        lado.parcela.rodadas === 1 ? "rodada" : "rodadas"
      }`,
    );
  }
  if (lado.isencao) {
    const onde = lado.isencao.props?.length
      ? lado.isencao.props.map((p) => POR_ID[p]?.nome ?? p).join(", ")
      : "tudo o que é seu";
    partes.push(`isenção de aluguel em ${onde} por ${lado.isencao.rodadas} rodadas`);
  }
  if (lado.opcao) {
    partes.push(
      `direito de comprar ${POR_ID[lado.opcao.prop]?.nome} por ${reais(lado.opcao.preco)} até a rodada ${lado.opcao.ate}`,
    );
  }
  return partes.length === 0 ? "nada" : partes.join(" + ");
}

/** Limpa o lado para o formato que o servidor espera. */
function paraServidor(lado: Lado): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (lado.dinheiro) out.dinheiro = lado.dinheiro;
  if (lado.props?.length) out.props = lado.props;
  if (lado.livras) out.livras = lado.livras;
  if (lado.parcela) out.parcela = lado.parcela;
  if (lado.isencao) {
    out.isencao = {
      props: lado.isencao.props?.length ? lado.isencao.props : null,
      rodadas: lado.isencao.rodadas,
    };
  }
  if (lado.opcao) out.opcao = lado.opcao;
  return out;
}

/* ── os contratos ativos, públicos ───────────────────────────────────────── */

export function Contratos({
  contratos,
  nomes,
  meuAssento,
  rodada,
  onExercer,
}: {
  contratos: Contrato[];
  nomes: Record<number, string>;
  meuAssento: number | null;
  rodada: number;
  onExercer: (id: string) => void;
}) {
  if (contratos.length === 0) return null;

  const texto = (c: Contrato) => {
    const de = nomes[c.de] ?? `assento ${c.de}`;
    const para = nomes[c.para] ?? `assento ${c.para}`;
    if (c.tipo === "parcela") {
      return `${de} paga ${reais(c.valor)} por rodada a ${para} — faltam ${c.rodadas}`;
    }
    if (c.tipo === "isencao") {
      const onde = c.props?.length
        ? c.props.map((p) => POR_ID[p]?.nome ?? p).join(", ")
        : `tudo de ${de}`;
      return `${para} não paga aluguel em ${onde} — faltam ${c.rodadas} rodadas`;
    }
    return `${para} pode comprar ${POR_ID[c.props?.[0] ?? ""]?.nome} de ${de} por ${reais(c.valor)} até a rodada ${c.ate}`;
  };

  return (
    <div className="panel contratos">
      <p className="eyebrow">Contratos em vigor · {contratos.length}</p>
      <p className="dim contratos-nota">
        Públicos de propósito: um acordo que ninguém vê não muda a mesa. E o servidor cobra sozinho
        — ninguém precisa lembrar.
      </p>
      <ul className="contratos-lista">
        {contratos.map((c) => {
          const meuDireito =
            c.tipo === "opcao" && c.para === meuAssento && (c.ate ?? 0) >= rodada;
          return (
            <li key={c.id} className="contrato" data-tipo={c.tipo}>
              <span className="contrato-tipo">
                {c.tipo === "parcela" ? "parcela" : c.tipo === "isencao" ? "isenção" : "opção"}
              </span>
              <span className="contrato-texto">{texto(c)}</span>
              {meuDireito && (
                <button className="btn btn-brass contrato-btn" onClick={() => onExercer(c.id)}>
                  Exercer
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ── propostas na mesa ───────────────────────────────────────────────────── */

export function Propostas({
  ofertas,
  nomes,
  meuAssento,
  onResponder,
  onRetirar,
}: {
  ofertas: Oferta[];
  nomes: Record<number, string>;
  meuAssento: number | null;
  onResponder: (id: string, aceita: boolean) => void;
  onRetirar: (id: string) => void;
}) {
  const paraMim = ofertas.filter((o) => o.para === meuAssento);
  const minhas = ofertas.filter((o) => o.de === meuAssento);
  if (paraMim.length === 0 && minhas.length === 0) return null;

  return (
    <div className="panel propostas">
      {paraMim.length > 0 && (
        <>
          <p className="eyebrow">Para você · {paraMim.length}</p>
          <ul className="propostas-lista">
            {paraMim.map((o) => (
              <li key={o.id} className="proposta" data-para-mim="true">
                <p className="proposta-quem">{nomes[o.de]} propõe:</p>
                <p className="proposta-corpo">
                  <span className="proposta-da">você recebe {frase(o.da)}</span>
                  <span className="proposta-quer">e dá {frase(o.quer)}</span>
                </p>
                <div className="proposta-acoes">
                  <button
                    className="btn btn-brass proposta-btn"
                    onClick={() => onResponder(o.id, true)}
                  >
                    Aceitar
                  </button>
                  <button
                    className="btn btn-ghost proposta-btn"
                    onClick={() => onResponder(o.id, false)}
                  >
                    Recusar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {minhas.length > 0 && (
        <>
          <p className="eyebrow propostas-titulo">Suas propostas · {minhas.length} de 3</p>
          <ul className="propostas-lista">
            {minhas.map((o) => (
              <li key={o.id} className="proposta">
                <p className="proposta-quem">para {nomes[o.para]}:</p>
                <p className="proposta-corpo">
                  <span className="proposta-da">você dá {frase(o.da)}</span>
                  <span className="proposta-quer">e recebe {frase(o.quer)}</span>
                </p>
                <button className="btn btn-ghost proposta-btn" onClick={() => onRetirar(o.id)}>
                  Retirar
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/* ── a mesa ──────────────────────────────────────────────────────────────── */

export function MesaDeNegociacao({
  props,
  jogadores,
  nomes,
  meuAssento,
  rodada,
  rodadaFinal,
  ocupado,
  onPropor,
  onFechar,
}: {
  props: Props;
  jogadores: Jogador[];
  nomes: Record<number, string>;
  meuAssento: number;
  rodada: number;
  rodadaFinal: number | null;
  ocupado: boolean;
  onPropor: (para: number, da: Record<string, unknown>, quer: Record<string, unknown>) => void;
  onFechar: () => void;
}) {
  const outros = jogadores.filter((j) => j.seat !== meuAssento && !j.quebrado);
  const [alvo, setAlvo] = useState<number | null>(outros[0]?.seat ?? null);
  const [da, setDa] = useState<Lado>({});
  const [quer, setQuer] = useState<Lado>({});

  const eu = jogadores.find((j) => j.seat === meuAssento);
  const ele = jogadores.find((j) => j.seat === alvo);

  /** As propriedades que cada um pode pôr na mesa: sem construção em cima. */
  const negociaveis = useMemo(
    () => (seat: number) =>
      Object.entries(props)
        .filter(([, e]) => e.owner === seat && e.casas === 0 && !e.hotel)
        .map(([id]) => POR_ID[id])
        .filter(Boolean)
        .sort((a, b) => a.pos - b.pos),
    [props],
  );

  const travadas = useMemo(
    () => (seat: number) =>
      Object.entries(props).filter(([, e]) => e.owner === seat && (e.casas > 0 || e.hotel)).length,
    [props],
  );

  if (!eu || alvo === null || !ele) {
    return (
      <div className="panel mesa">
        <p className="eyebrow">Negociar</p>
        <p className="dim mt-2 text-sm">Não há com quem negociar agora.</p>
        <button className="btn btn-ghost mt-3" onClick={onFechar}>
          Fechar
        </button>
      </div>
    );
  }

  const vazia =
    Object.keys(paraServidor(da)).length === 0 && Object.keys(paraServidor(quer)).length === 0;

  return (
    <div className="panel mesa">
      <div className="mesa-topo">
        <p className="eyebrow">Negociar</p>
        <button className="ficha-x" onClick={onFechar} aria-label="Fechar">
          ✕
        </button>
      </div>

      <div className="mesa-com">
        {outros.map((j) => (
          <button
            key={j.seat}
            className="mesa-quem"
            data-on={j.seat === alvo}
            onClick={() => {
              setAlvo(j.seat);
              setQuer({});
            }}
          >
            <span
              className="met-cor"
              style={{ background: COLORS[j.cor].enamel }}
              aria-hidden
            />
            {nomes[j.seat]}
            <span className="mono mesa-quem-caixa">{reais(j.cash)}</span>
          </button>
        ))}
      </div>

      <LadoEditor
        titulo="Você dá"
        lado={da}
        onMuda={setDa}
        propsDisponiveis={negociaveis(meuAssento)}
        travadas={travadas(meuAssento)}
        caixa={eu.cash}
        livras={eu.livras}
        rodada={rodada}
        rodadaFinal={rodadaFinal}
      />

      <LadoEditor
        titulo={`${nomes[alvo]} dá`}
        lado={quer}
        onMuda={setQuer}
        propsDisponiveis={negociaveis(alvo)}
        travadas={travadas(alvo)}
        caixa={ele.cash}
        livras={ele.livras}
        rodada={rodada}
        rodadaFinal={rodadaFinal}
      />

      {/* O RESUMO. É a única coisa que separa "mandei sem ler" de "conferi". */}
      <div className="mesa-resumo">
        <p>
          <strong>Você dá</strong> {frase(da)}
        </p>
        <p>
          <strong>Você recebe</strong> {frase(quer)}
        </p>
      </div>

      <div className="mesa-acoes">
        <button
          className="btn btn-brass"
          disabled={ocupado || vazia}
          onClick={() => onPropor(alvo, paraServidor(da), paraServidor(quer))}
        >
          Propor
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => {
            setDa({});
            setQuer({});
          }}
        >
          Limpar
        </button>
      </div>
    </div>
  );
}

/** Um lado da proposta: dinheiro, escrituras, cartas e as três cláusulas. */
function LadoEditor({
  titulo,
  lado,
  onMuda,
  propsDisponiveis,
  travadas,
  caixa,
  livras,
  rodada,
  rodadaFinal,
}: {
  titulo: string;
  lado: Lado;
  onMuda: (l: Lado) => void;
  propsDisponiveis: { id?: string; nome: string; g?: string; pos: number }[];
  travadas: number;
  caixa: number;
  livras: number;
  rodada: number;
  rodadaFinal: number | null;
}) {
  const [clausulas, setClausulas] = useState(false);
  const ate = Math.min(rodadaFinal ?? rodada + 10, rodada + 10);

  const alterna = (id: string) => {
    const atual = lado.props ?? [];
    onMuda({
      ...lado,
      props: atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id],
    });
  };

  return (
    <div className="lado">
      <p className="lado-titulo">{titulo}</p>

      <label className="lado-linha">
        <span>dinheiro</span>
        <input
          className="mono lado-campo"
          type="number"
          min={0}
          max={caixa}
          step={100}
          value={lado.dinheiro ?? 0}
          onChange={(e) =>
            onMuda({ ...lado, dinheiro: Math.max(0, Math.min(caixa, Number(e.target.value))) })
          }
        />
        <span className="lado-limite dim">de {reais(caixa)}</span>
      </label>

      {propsDisponiveis.length > 0 && (
        <div className="lado-props">
          {propsDisponiveis.map((c) => (
            <button
              key={c.id}
              className="chip-prop"
              data-on={(lado.props ?? []).includes(c.id!)}
              data-g={c.g}
              style={
                c.g
                  ? ({ "--cor": GRUPO_POR_ID[c.g]?.cor } as React.CSSProperties)
                  : undefined
              }
              onClick={() => alterna(c.id!)}
            >
              {c.nome}
            </button>
          ))}
        </div>
      )}
      {travadas > 0 && (
        <p className="lado-nota dim">
          {travadas} com construção {travadas === 1 ? "está" : "estão"} fora: escritura com casa
          não passa de mão. Venda as construções primeiro.
        </p>
      )}

      {livras > 0 && (
        <label className="lado-linha">
          <span>cartas de saída</span>
          <input
            className="mono lado-campo"
            type="number"
            min={0}
            max={livras}
            value={lado.livras ?? 0}
            onChange={(e) =>
              onMuda({ ...lado, livras: Math.max(0, Math.min(livras, Number(e.target.value))) })
            }
          />
          <span className="lado-limite dim">de {livras}</span>
        </label>
      )}

      <button className="lado-mais" onClick={() => setClausulas((c) => !c)}>
        {clausulas ? "− menos" : "+ cláusula"}{" "}
        <span className="dim">parcelamento · isenção · opção de compra</span>
      </button>

      {clausulas && (
        <div className="clausulas">
          {/* parcelamento */}
          <div className="clausula" data-on={!!lado.parcela}>
            <button
              className="clausula-nome"
              onClick={() =>
                onMuda({
                  ...lado,
                  parcela: lado.parcela ? null : { valor: 500, rodadas: 6 },
                })
              }
            >
              parcelamento
            </button>
            {lado.parcela && (
              <div className="clausula-campos">
                <input
                  className="mono lado-campo"
                  type="number"
                  min={100}
                  step={100}
                  value={lado.parcela.valor}
                  onChange={(e) =>
                    onMuda({
                      ...lado,
                      parcela: { ...lado.parcela!, valor: Math.max(1, Number(e.target.value)) },
                    })
                  }
                />
                <span className="dim">por rodada, durante</span>
                <input
                  className="mono lado-campo lado-campo-curto"
                  type="number"
                  min={1}
                  max={20}
                  value={lado.parcela.rodadas}
                  onChange={(e) =>
                    onMuda({
                      ...lado,
                      parcela: {
                        ...lado.parcela!,
                        rodadas: Math.max(1, Math.min(20, Number(e.target.value))),
                      },
                    })
                  }
                />
                <span className="dim">rodadas</span>
              </div>
            )}
          </div>

          {/* isenção */}
          <div className="clausula" data-on={!!lado.isencao}>
            <button
              className="clausula-nome"
              onClick={() =>
                onMuda({
                  ...lado,
                  isencao: lado.isencao ? null : { props: null, rodadas: 3 },
                })
              }
            >
              isenção de aluguel
            </button>
            {lado.isencao && (
              <div className="clausula-campos">
                <span className="dim">
                  {lado.isencao.props?.length
                    ? `em ${lado.isencao.props.length} ${lado.isencao.props.length === 1 ? "propriedade" : "propriedades"}`
                    : "em tudo"}
                </span>
                <span className="dim">por</span>
                <input
                  className="mono lado-campo lado-campo-curto"
                  type="number"
                  min={1}
                  max={20}
                  value={lado.isencao.rodadas}
                  onChange={(e) =>
                    onMuda({
                      ...lado,
                      isencao: {
                        ...lado.isencao!,
                        rodadas: Math.max(1, Math.min(20, Number(e.target.value))),
                      },
                    })
                  }
                />
                <span className="dim">rodadas</span>
                <div className="clausula-props">
                  {propsDisponiveis.map((c) => (
                    <button
                      key={c.id}
                      className="chip-prop chip-mini"
                      data-on={(lado.isencao?.props ?? []).includes(c.id!)}
                      onClick={() => {
                        const atual = lado.isencao?.props ?? [];
                        const novo = atual.includes(c.id!)
                          ? atual.filter((x) => x !== c.id)
                          : [...atual, c.id!];
                        onMuda({
                          ...lado,
                          isencao: { ...lado.isencao!, props: novo.length ? novo : null },
                        });
                      }}
                    >
                      {c.nome}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* opção de compra */}
          <div className="clausula" data-on={!!lado.opcao}>
            <button
              className="clausula-nome"
              disabled={propsDisponiveis.length === 0}
              onClick={() =>
                onMuda({
                  ...lado,
                  opcao: lado.opcao
                    ? null
                    : {
                        prop: propsDisponiveis[0]?.id ?? "",
                        preco: (POR_ID[propsDisponiveis[0]?.id ?? ""]?.preco ?? 1000) * 2,
                        ate,
                      },
                })
              }
            >
              opção de compra
            </button>
            {lado.opcao && (
              <div className="clausula-campos">
                <select
                  className="lado-campo"
                  value={lado.opcao.prop}
                  onChange={(e) => onMuda({ ...lado, opcao: { ...lado.opcao!, prop: e.target.value } })}
                >
                  {propsDisponiveis.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </select>
                <span className="dim">por</span>
                <input
                  className="mono lado-campo"
                  type="number"
                  min={0}
                  step={100}
                  value={lado.opcao.preco}
                  onChange={(e) =>
                    onMuda({
                      ...lado,
                      opcao: { ...lado.opcao!, preco: Math.max(0, Number(e.target.value)) },
                    })
                  }
                />
                <span className="dim">até a rodada</span>
                <input
                  className="mono lado-campo lado-campo-curto"
                  type="number"
                  min={rodada + 1}
                  max={rodadaFinal ?? rodada + 30}
                  value={lado.opcao.ate}
                  onChange={(e) =>
                    onMuda({
                      ...lado,
                      opcao: {
                        ...lado.opcao!,
                        ate: Math.max(rodada + 1, Number(e.target.value)),
                      },
                    })
                  }
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
