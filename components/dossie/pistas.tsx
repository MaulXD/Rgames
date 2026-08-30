"use client";

/**
 * O Modo Avançado na tela: a mão de Cartas de Pista, o que elas já contaram, e
 * a ação de investigar que as compra.
 *
 * O painel inteiro é dirigido pelo `pede` de cada carta — uma que não pede nada
 * é um botão, uma que pede um lugar abre a lista de lugares. Sem isso, cada
 * carta teria o seu próprio pedaço de tela, e a sexta chegaria numa tela já
 * grande demais para receber a sétima.
 */

import { useState } from "react";
import { Escolher } from "@/components/dossie/escolher";
import { nomeDaCarta, type Caso } from "@/lib/dossie";
import { pistaDe, TIPOS, type Aviso, type IdPista } from "@/lib/dossie-pistas";
import * as sfx from "@/lib/sfx";

type Jogador = { seat: number; nome: string };

export function Pistas({
  caso,
  mao,
  avisos,
  minhaVez,
  devoRefutar,
  acoesRestantes,
  sozinhoAqui,
  jogadores,
  meuAssento,
  lugares,
  onInvestigar,
  onUsar,
}: {
  caso: Caso;
  mao: string[];
  avisos: Aviso[];
  minhaVez: boolean;
  devoRefutar: boolean;
  acoesRestantes: number;
  /** Investigar só acontece num lugar onde mais ninguém está — é o preço da carta. */
  sozinhoAqui: boolean;
  jogadores: Jogador[];
  meuAssento: number | null;
  lugares: { id: string; name: string }[];
  onInvestigar: () => void;
  onUsar: (carta: IdPista, arg: Record<string, unknown>) => void;
}) {
  const [abrindo, setAbrindo] = useState<IdPista | null>(null);
  const [um, setUm] = useState<string | undefined>();
  const [dois, setDois] = useState<string | undefined>();

  function fecha() {
    setAbrindo(null);
    setUm(undefined);
    setDois(undefined);
  }

  const carta = abrindo ? pistaDe(abrindo) : null;
  const outros = jogadores.filter((j) => j.seat !== meuAssento);

  /* Por que a carta não pode ser jogada agora — a frase, e não só o botão
     apagado. Um botão apagado sem motivo é a interface dizendo "não" e virando
     as costas. */
  function porQueNao(id: IdPista): string | null {
    const p = pistaDe(id);
    if (!p) return "Esta carta não existe mais.";
    if (p.quando === "refutando") {
      return devoRefutar ? null : "Vale só quando pedirem que você refute.";
    }
    if (!minhaVez) return "Espere a sua vez.";
    if (p.id === "interrogatorio" && outros.length === 0) return "Não há mais ninguém na mesa.";
    return null;
  }

  return (
    <>
      <div className="panel dossie-pistas">
        <p className="eyebrow">Cartas de pista · {mao.length}</p>

        <button
          className="btn btn-ghost mt-3"
          disabled={!minhaVez || acoesRestantes < 1 || !sozinhoAqui}
          onClick={() => {
            sfx.carta();
            onInvestigar();
          }}
        >
          Investigar aqui
        </button>
        <p className="mt-2 text-sm dim">
          {!minhaVez
            ? "Investigar custa uma ação, na sua vez."
            : !sozinhoAqui
              ? "Só se investiga um lugar onde mais ninguém está — é o preço da carta."
              : acoesRestantes < 1
                ? "Sem ações nesta rodada."
                : "Uma ação, e você tira uma carta do baralho."}
        </p>

        {mao.length === 0 ? (
          <p className="mt-4 text-sm dim">Sua mão de pistas está vazia.</p>
        ) : (
          <ul className="dossie-pistas-lista mt-4">
            {mao.map((id, i) => {
              const p = pistaDe(id);
              if (!p) return null;
              const motivo = porQueNao(p.id);
              return (
                <li key={`${id}-${i}`} className="dossie-pista">
                  <div>
                    <p className="dossie-pista-nome">{p.nome}</p>
                    <p className="text-sm dim">{p.frase}</p>
                    {motivo && <p className="text-sm dim dossie-pista-motivo">{motivo}</p>}
                  </div>
                  <button
                    className="btn btn-brass"
                    disabled={motivo !== null}
                    onClick={() => {
                      if (p.pede === "nada") {
                        sfx.carta();
                        onUsar(p.id, {});
                      } else {
                        setAbrindo(p.id);
                      }
                    }}
                  >
                    {p.acao}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {avisos.length > 0 && (
          <>
            <p className="eyebrow mt-5">O que as pistas contaram</p>
            <ul className="dossie-avisos">
              {avisos.map((a, i) => (
                <li key={i}>{frase(caso, a)}</li>
              ))}
            </ul>
          </>
        )}
      </div>

      {carta && carta.pede === "lugar" && (
        <Escolher
          titulo={carta.nome}
          nota={carta.frase}
          grupos={[{ rotulo: "Para onde", itens: lugares, sel: um, set: setUm }]}
          pronto={!!um}
          rotuloBotao={carta.acao}
          onConfirmar={() => {
            onUsar(carta.id, { para: um });
            fecha();
          }}
          onFechar={fecha}
        />
      )}

      {carta && carta.pede === "dois-suspeitos" && (
        <Escolher
          titulo={carta.nome}
          nota="Se o culpado for um dos dois, você risca os outros quatro. Se não for, risca estes dois. A mesa vê quais você nomeou — não a resposta."
          grupos={[
            {
              rotulo: "Primeiro nome",
              itens: caso.suspects.filter((s) => s.id !== dois),
              sel: um,
              set: setUm,
            },
            {
              rotulo: "Segundo nome",
              itens: caso.suspects.filter((s) => s.id !== um),
              sel: dois,
              set: setDois,
            },
          ]}
          pronto={!!um && !!dois && um !== dois}
          rotuloBotao={carta.acao}
          onConfirmar={() => {
            onUsar(carta.id, { a: um, b: dois });
            fecha();
          }}
          onFechar={fecha}
        />
      )}

      {carta && carta.pede === "jogador" && (
        <Escolher
          titulo={carta.nome}
          nota="A mesa vê que um recado saiu, e não vê para quem. Você pode mandar para si mesmo."
          grupos={[
            {
              rotulo: "Para quem",
              itens: jogadores.map((j) => ({
                id: String(j.seat),
                name: j.seat === meuAssento ? `${j.nome} (você)` : j.nome,
              })),
              sel: um,
              set: setUm,
            },
          ]}
          pronto={!!um}
          rotuloBotao={carta.acao}
          onConfirmar={() => {
            onUsar(carta.id, { alvo: Number(um) });
            fecha();
          }}
          onFechar={fecha}
        />
      )}

      {carta && carta.pede === "jogador-e-tipo" && (
        <Escolher
          titulo={carta.nome}
          nota="A mesa inteira vê a quem você perguntou e sobre o quê. Só você vê a carta."
          grupos={[
            {
              rotulo: "A quem",
              itens: outros.map((j) => ({ id: String(j.seat), name: j.nome })),
              sel: um,
              set: setUm,
            },
            {
              rotulo: "Peça",
              itens: TIPOS.map((t) => ({ id: t.id, name: t.nome })),
              sel: dois,
              set: setDois,
            },
          ]}
          pronto={!!um && !!dois}
          rotuloBotao={carta.acao}
          onConfirmar={() => {
            onUsar(carta.id, { alvo: Number(um), tipo: dois });
            fecha();
          }}
          onFechar={fecha}
        />
      )}
    </>
  );
}

/**
 * O aviso em português.
 *
 * A frase do "sim" é escrita ao contrário de propósito — "não é nenhum dos
 * outros quatro" em vez de "é um dos dois" — porque é assim que ela serve no
 * caderno: o que se risca são os quatro.
 */
function frase(caso: Caso, a: Aviso): string {
  if (a.k === "recado") {
    return `Um recado anônimo: ${nomeDaCarta(caso, a.card)} não está no envelope.`;
  }
  const dois = `${nomeDaCarta(caso, a.a)} e ${nomeDaCarta(caso, a.b)}`;
  return a.sim
    ? `Impressão digital: o culpado é ${dois} — nenhum dos outros quatro.`
    : `Impressão digital: não é ${dois}.`;
}
