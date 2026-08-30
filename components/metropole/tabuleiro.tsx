"use client";

import { useEffect, useState } from "react";
import { COLORS, type ColorKey } from "@/lib/avatar";
import {
  CASAS,
  GRUPO_POR_ID,
  aluguelAtual,
  borda,
  naGrade,
  reais,
  type Casa,
  type Evento,
  type Props,
} from "@/lib/metropole/cidade";

/**
 * O tabuleiro de Capibara.
 *
 * Onze por onze, com a casa 0 no canto de baixo à direita e a contagem subindo
 * pela borda de baixo para a esquerda — o sentido do peão na mesa.
 *
 * A DECISÃO DE LEITURA: cada casa mostra, no máximo, três coisas — a faixa da
 * cor do grupo, o nome, e o número que importa AGORA. "O número que importa
 * agora" muda: sem dono é o preço; com dono é o aluguel que ela cobra. É a
 * mesma casa contando duas histórias diferentes, e a segunda é a que decide
 * jogada.
 *
 * O que NÃO está na casa: quanto custa construir, quantas casas cabem, a
 * tabela de aluguel inteira. Isso é informação de gestão, e mora no painel de
 * propriedades — onde há espaço para lê-la sem apertar os olhos.
 */

type Peao = { seat: number; cor: ColorKey; pos: number; nome: string; preso: boolean };

export function Tabuleiro({
  props,
  peoes,
  cores,
  meuAssento,
  evento,
  destaque,
  onEscolher,
}: {
  props: Props;
  peoes: Peao[];
  /** assento → cor, para pintar a barra do dono mesmo sem ele estar na casa */
  cores: Record<number, ColorKey>;
  meuAssento: number | null;
  /** o evento em curso: o número na casa tem de ser o que o servidor cobra */
  evento?: Evento | null;
  /** a casa que a jogada em curso aponta — o resto apaga */
  destaque?: string | null;
  onEscolher?: (prop: string) => void;
}) {
  /* ── O QUE ACABOU DE SER CONSTRUÍDO ────────────────────────────────────
     Construir é uma das duas ou três decisões grandes da Metrópole, e a
     casinha aparecia sem nenhum peso: um quadradinho verde surgia no canto e
     pronto. Quem não estava olhando para aquele quadro não via nada
     acontecer.

     A comparação é feita DURANTE a renderização, contra o estado anterior
     guardado em estado — o padrão que o React recomenda para "ajustar estado
     quando a prop muda". Um efeito aqui encadearia uma renderização a mais a
     cada mensagem do servidor.

     E é a COMPARAÇÃO que importa, não a montagem: animar tudo o que aparece
     faria o tabuleiro inteiro pipocar a cada recarga de página, com trinta
     casas construídas piscando por nada. */
  const [obrasVistas, setObrasVistas] = useState<Record<string, number>>(() =>
    Object.fromEntries(Object.entries(props).map(([id, e]) => [id, e.hotel ? 5 : e.casas])),
  );
  const [subindo, setSubindo] = useState<string[]>([]);
  const agora = Object.fromEntries(
    Object.entries(props).map(([id, e]) => [id, e.hotel ? 5 : e.casas]),
  );
  if (
    Object.keys(agora).some((id) => agora[id] !== obrasVistas[id]) ||
    Object.keys(obrasVistas).length !== Object.keys(agora).length
  ) {
    const cresceu = Object.keys(agora).filter(
      (id) => obrasVistas[id] !== undefined && agora[id] > obrasVistas[id],
    );
    setObrasVistas(agora);
    if (cresceu.length > 0) setSubindo(cresceu);
  }

  /* A limpeza depende de tempo passar, então ela mora num efeito — e o
     `setState` fica dentro do temporizador, que é onde ele é legítimo. */
  useEffect(() => {
    if (subindo.length === 0) return;
    const id = setTimeout(() => setSubindo([]), 600);
    return () => clearTimeout(id);
  }, [subindo]);

  return (
    <div className="tab-rolo">
      <div className="tab">
        {CASAS.map((casa) => (
          <Quadro
            key={casa.pos}
            casa={casa}
            props={props}
            peoes={peoes.filter((p) => p.pos === casa.pos)}
            cores={cores}
            meuAssento={meuAssento}
            evento={evento}
            apagada={!!destaque && casa.id !== destaque}
            subindo={!!casa.id && subindo.includes(casa.id)}
            aceso={!!casa.id && casa.id === destaque}
            onEscolher={onEscolher}
          />
        ))}

        {/* o miolo: nome da cidade, e é onde o leilão e os dados aparecem */}
        <div className="tab-miolo">
          <p className="tab-marca">Capibara</p>
          <p className="tab-lema">déco tropical</p>
        </div>
      </div>
    </div>
  );
}

function Quadro({
  casa,
  props,
  peoes,
  cores,
  meuAssento,
  evento,
  apagada,
  aceso,
  subindo,
  onEscolher,
}: {
  casa: Casa;
  props: Props;
  peoes: Peao[];
  cores: Record<number, ColorKey>;
  meuAssento: number | null;
  evento?: Evento | null;
  apagada: boolean;
  aceso: boolean;
  /** a obra desta casa acabou de subir — a construção ganha um instante */
  subindo: boolean;
  onEscolher?: (prop: string) => void;
}) {
  const { col, row } = naGrade(casa.pos);
  const onde = borda(casa.pos);
  const est = casa.id ? props[casa.id] : undefined;
  const dono = est?.owner ?? null;
  const cor = casa.g ? GRUPO_POR_ID[casa.g]?.cor : undefined;
  const meu = dono !== null && dono === meuAssento;

  // o número que importa agora: preço se não tem dono, aluguel se tem
  const numero =
    casa.t === "bairro" || casa.t === "transporte" || casa.t === "companhia"
      ? dono === null
        ? casa.preco
        : aluguelAtual(props, casa.id!, 7, evento)
      : casa.valor;

  const clicavel = !!casa.id && !!onEscolher;

  return (
    <div
      className="quadro"
      style={{ gridColumn: col + 1, gridRow: row + 1 }}
      data-borda={onde}
      data-tipo={casa.t}
      data-dono={dono !== null}
      data-meu={meu}
      data-apagada={apagada}
      data-acesa={aceso}
      data-hipotecada={est?.hipotecada ?? false}
      onClick={clicavel ? () => onEscolher!(casa.id!) : undefined}
      role={clicavel ? "button" : undefined}
      tabIndex={clicavel ? 0 : undefined}
      onKeyDown={
        clicavel
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onEscolher!(casa.id!);
              }
            }
          : undefined
      }
      aria-label={
        casa.id
          ? `${casa.nome}${dono === null ? `, à venda por ${reais(casa.preco!)}` : `, aluguel ${reais(numero ?? 0)}`}`
          : casa.nome
      }
    >
      {/* `data-g` carrega o grupo para o CSS poder desenhar o PADRÃO por cima
          da cor. Verde e vermelho são a mesma coisa em deuteranopia e em
          protanopia, e o tabuleiro tem os dois — sem padrão, duas das oito
          famílias ficam indistinguíveis para uma parte das pessoas. */}
      {cor && (
        <span className="quadro-faixa" data-g={casa.g} style={{ background: cor }} aria-hidden />
      )}

      {/* a barra do dono: a cor dele atravessando a casa inteira. Dá para ver
          um monopólio se formando de longe, sem ler nome nenhum. */}
      {dono !== null && (
        <span
          className="quadro-dono"
          style={{ background: COLORS[cores[dono] ?? "grafite"].enamel }}
          aria-hidden
        />
      )}

      <span className="quadro-nome">{casa.nome}</span>

      {numero !== undefined && numero > 0 && (
        <span className="quadro-num mono">{numero.toLocaleString("pt-BR")}</span>
      )}

      {/* construção: quatro casinhas e um hotel, desenhados */}
      {est && (est.casas > 0 || est.hotel) && (
        <span className="quadro-obras" data-subindo={subindo || undefined} aria-hidden>
          {est.hotel ? (
            <span className="obra-hotel" />
          ) : (
            Array.from({ length: est.casas }, (_, i) => <span key={i} className="obra-casa" />)
          )}
        </span>
      )}

      {est?.hipotecada && (
        <span className="quadro-hip" aria-hidden>
          hip
        </span>
      )}

      {peoes.length > 0 && (
        <span className="quadro-peoes">
          {peoes.map((p) => (
            <span
              key={p.seat}
              className="peao-quadro"
              /* `?? "grafite"` como em todo outro lugar que lê cor de peão.
                 Esta linha era a única sem a rede, e a diferença é grande: um
                 peão sem cor é um peão cinza em qualquer outra tela e era o
                 TABULEIRO INTEIRO quebrado nesta. Cor é aparência; aparência
                 faltando não derruba tela. */
              /* E A TINTA VEM DA MESMA COR. O `.peao` pintava o número de
                 branco, e branco não passa em esmalte nenhum da paleta — no
                 turquesa dá 1,79:1. Cada cor já traz o seu `ink` para isto, e
                 a borda logo abaixo já usava. */
              style={{
                background: COLORS[p.cor ?? "grafite"].enamel,
                borderColor: COLORS[p.cor ?? "grafite"].ink,
                color: COLORS[p.cor ?? "grafite"].ink,
              }}
              data-preso={p.preso}
              title={p.nome}
            >
              {p.seat + 1}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}
