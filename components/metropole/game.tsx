"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Tabuleiro } from "@/components/metropole/tabuleiro";
import { Fluxo, MinhasProps } from "@/components/metropole/painel";
import {
  Contratos,
  MesaDeNegociacao,
  Propostas,
  type Contrato,
  type Oferta,
} from "@/components/metropole/negociar";
import { Avatar } from "@/components/avatar";
import { Confete } from "@/components/confete";
import { useSession } from "@/components/session";
import { supabaseBrowser } from "@/lib/supabase/client";
import { COLORS, parseAvatar, type ColorKey } from "@/lib/avatar";
import {
  CASAS,
  GRUPO_POR_ID,
  POR_ID,
  REGRAS,
  patrimonio,
  reais,
  type Evento,
  type Props,
} from "@/lib/metropole/cidade";
import * as sfx from "@/lib/sfx";

/* ── o estado publicado pelo servidor ────────────────────────────────────── */

export type MetState = {
  map: string;
  mode: "metropole" | "classico" | "relampago";
  round: number;
  turnSeat: number;
  phase: "rolar" | "acao" | "resolve" | "leilao" | "fim";
  players: Record<
    string,
    {
      userId: string;
      cor: ColorKey;
      cash: number;
      pos: number;
      jail: number;
      livras: number;
      quebrado: boolean;
      investidor: boolean;
      patrimonio?: number;
    }
  >;
  props: Props;
  bank: { casas: number; hoteis: number };
  dados: [number, number] | null;
  duplos: number;
  pendente:
    | { k: "comprar"; prop: string; preco: number }
    | { k: "divida"; quanto: number; para: number | null; motivo: string }
    | null;
  leilao: {
    prop: string;
    alto: number;
    altoSeat: number | null;
    passou: number[];
    abriuSeat: number;
    /** quem administra, quando quem lidera é um Investidor */
    admin?: number | null;
  } | null;
  /** reveladas só no fim: as apostas secretas dos Investidores */
  apostas?: { seat: number; em: number; acertou: boolean }[];
  /** o evento da cidade em curso, ou nenhum */
  evento?: Evento | null;
  devedores?: number[];
  ofertas?: Oferta[];
  contratos?: Contrato[];
  rodadaFinal: number | null;
  log: LinhaLog[];
  vencedor: number | null;
};

type LinhaLog = {
  k: string;
  seat?: number | null;
  de?: number;
  para?: number | null;
  valor?: number;
  motivo?: string;
  prop?: string;
  texto?: string;
  qual?: string;
  n?: number;
  d?: number[];
  auto?: boolean;
  tipo?: string;
  seq?: number;
};

export type MetMatch = {
  id: string;
  status: string;
  turn_deadline: string | null;
  public_state: MetState;
};

export type Assento = { user_id: string; display_name: string; avatar: unknown };

const RECADO: Record<string, string> = {
  NOT_YOUR_TURN: "Não é a sua vez.",
  WRONG_PHASE: "Não dá para fazer isso agora.",
  RESOLVE_FIRST: "Resolva o que está pendente primeiro.",
  ROLL_FIRST: "Jogue o dado antes de passar a vez.",
  PAY_YOUR_DEBT: "Você está no negativo: hipoteque, venda construção ou quebre.",
  IN_JAIL: "Você está na cadeia — escolha como sair.",
  NOT_ENOUGH_CASH: "Dinheiro insuficiente.",
  NOTHING_TO_BUY: "Não há nada para comprar agora.",
  BID_TOO_LOW: "O lance tem de ser maior que o atual.",
  NO_AUCTION: "Não há leilão aberto.",
  GROUP_INCOMPLETE: "Você precisa do grupo de cor inteiro para construir.",
  GROUP_MORTGAGED: "Resgate as hipotecas do grupo antes de construir.",
  BUILD_UNEVEN: "Construção par: as propriedades do grupo sobem juntas.",
  SELL_UNEVEN: "A desconstrução também é par.",
  NO_HOUSES_LEFT: "O banco ficou sem casas — alguém tem de vender.",
  NO_HOTELS_LEFT: "O banco ficou sem hotéis.",
  SELL_BUILDINGS_FIRST: "Venda as construções antes de hipotecar.",
  ALREADY_MORTGAGED: "Já está hipotecada.",
  NOT_MORTGAGED: "Essa não está hipotecada.",
  NOT_IN_JAIL: "Você não está na cadeia.",
  NO_CARD: "Você não tem carta de saída.",
  NOT_BROKE: "Você não está no negativo.",
  AUCTION_OPEN: "Espere o leilão fechar.",
  BANKRUPT: "Você está fora da partida.",
  SELF_OFFER: "Não dá para negociar consigo mesmo.",
  NEED_ADMIN: "Escolha quem vai administrar o que você arrematar.",
  BAD_ADMIN: "O administrador tem de ser um jogador ativo.",
  NOT_AN_INVESTOR: "Só o Investidor aposta.",
  SELF_BET: "Não dá para apostar em si mesmo.",
  EMPTY_OFFER: "A proposta está vazia dos dois lados.",
  TOO_MANY_OFFERS: "Você já tem três propostas na mesa. Retire uma antes.",
  NO_SUCH_OFFER: "Essa proposta não está mais na mesa.",
  NOT_FOR_YOU: "Essa proposta não é para você.",
  BUILDINGS_ON_PROP: "Escritura com construção não passa de mão: venda as casas primeiro.",
  NOT_ENOUGH_CARDS: "Você não tem tantas cartas de saída.",
  NO_SUCH_OPTION: "Essa opção não existe mais.",
  OPTION_EXPIRED: "O prazo da opção venceu.",
  OWNER_CHANGED: "A propriedade mudou de dono: a opção não vale contra terceiro.",
  BAD_OFFER: "Algum número da proposta não fecha.",
  OFFER_STALE: "A proposta ficou impossível desde que foi feita — refaça.",
  THEY_NOT_YOURS: "O que você pediu não é mais dele.",
  THEY_NOT_ENOUGH_CASH: "Ele não tem esse dinheiro.",
};

function recado(msg: string): string {
  for (const [k, v] of Object.entries(RECADO)) if (msg.includes(k)) return v;
  return msg;
}

/* ── a tela ──────────────────────────────────────────────────────────────── */

export function MetropoleGame({
  match,
  assentos,
  onSair,
}: {
  match: MetMatch;
  assentos: Assento[];
  onSair: () => void;
}) {
  const { user } = useSession();
  const st = match.public_state;

  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [lance, setLance] = useState<number | null>(null);
  const [resto, setResto] = useState(0);
  const [olhando, setOlhando] = useState<string | null>(null);
  const [negociando, setNegociando] = useState(false);
  const [admin, setAdmin] = useState<number | null>(null);
  const ultimoLog = useRef("");

  const mudo = useSyncExternalStore(sfx.subscribe, sfx.getSnapshot, sfx.getServerSnapshot);

  const entradas = useMemo(
    () =>
      Object.entries(st.players).map(([k, v]) => ({ seat: Number(k), ...v })),
    [st.players],
  );
  const eu = entradas.find((p) => p.userId === user?.id);
  const meuAssento = eu?.seat ?? null;
  const minhaVez = meuAssento !== null && st.turnSeat === meuAssento;
  /* O INVESTIDOR não anda pelo tabuleiro e não tem turno, mas está em toda
     disputa: o leilão e a mesa de negociação continuam abertos para ele. */
  const souInvestidor = !!eu?.investidor;
  const acabou = st.phase === "fim" || match.status === "finished" || st.vencedor !== null;
  // papel picado é uma leitura do resultado, não um estado a sincronizar
  const festa = acabou && st.vencedor === meuAssento;
  const ativos = entradas.filter((p) => !p.quebrado);

  const cores = useMemo(
    () => Object.fromEntries(entradas.map((p) => [p.seat, p.cor])) as Record<number, ColorKey>,
    [entradas],
  );
  const nomes = useMemo(() => {
    const m: Record<number, string> = {};
    for (const p of entradas) {
      m[p.seat] = assentos.find((a) => a.user_id === p.userId)?.display_name ?? `Assento ${p.seat}`;
    }
    return m;
  }, [entradas, assentos]);

  const peoes = useMemo(
    () =>
      entradas
        .filter((p) => !p.quebrado)
        .map((p) => ({
          seat: p.seat,
          cor: p.cor,
          pos: p.pos,
          nome: nomes[p.seat],
          preso: p.jail > 0,
        })),
    [entradas, nomes],
  );

  /* ── relógio ────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!match.turn_deadline || acabou) return;
    const fim = new Date(match.turn_deadline).getTime();
    const tick = () => setResto(Math.max(0, Math.ceil((fim - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [match.turn_deadline, acabou]);

  /* ── som conforme o registro anda ───────────────────────────────────── */
  useEffect(() => {
    const nova = st.log?.[0];
    if (!nova) return;
    const chave = JSON.stringify(nova);
    if (chave === ultimoLog.current) return;
    ultimoLog.current = chave;
    if (nova.k === "anda") sfx.dado();
    else if (nova.k === "compra" || nova.k === "leilao-fecha") sfx.conquista();
    else if (nova.k === "lance") sfx.clique();
    else if (nova.k === "carta") sfx.carta();
    else if (nova.k === "cadeia") sfx.eliminado();
    else if (nova.k === "constroi") sfx.planta();
    else if (nova.k === "vez") sfx.vez();
    else if (nova.k === "largada") sfx.troca();
    else if (nova.k === "fim-rodadas") sfx.venceu();
    else if (nova.k === "acordo" || nova.k === "opcao-exercida") sfx.troca();
    else if (nova.k === "proposta") sfx.sino();
    else if (nova.k === "parcela") sfx.clique();
  }, [st.log]);

  /* O CAMPO DE LANCE NÃO PRECISA SER ZERADO.
     A primeira versão apagava o valor digitado por efeito toda vez que o
     leilão subia — setState dentro de efeito, e pior: apagava o que a pessoa
     tinha acabado de digitar. Agora o valor é SEMPRE lido preso ao mínimo
     válido, então quando alguém cobre o seu lance o campo acompanha sozinho,
     sem apagar nada e sem uma renderização a mais. */
  const minimoLance = Math.max((st.leilao?.alto ?? 0) + 1, REGRAS.lanceMinimo);
  const meuLance = Math.max(lance ?? 0, minimoLance);
  /* O Investidor precisa nomear quem administra: sem administrador a
     propriedade não teria como participar do jogo. Para quem está jogando, o
     campo simplesmente não existe. */
  const adminEfetivo = souInvestidor ? admin : null;
  const faltaAdmin = souInvestidor && adminEfetivo === null;

  const chama = useCallback(async (fn: string, args: Record<string, unknown>) => {
    setErro(null);
    setOcupado(true);
    const { data, error } = await supabaseBrowser().rpc(fn, args);
    setOcupado(false);
    if (error) {
      setErro(recado(error.message ?? String(error)));
      return null;
    }
    return data;
  }, []);

  /* ── fim ────────────────────────────────────────────────────────────── */
  if (acabou) {
    /* A ORDEM FINAL não é só patrimônio.
       O vencedor é o vencedor. Depois dele vem o Investidor que ACERTOU a
       aposta — é a única coisa que ele ganha, e é o que dá a ele razão para ler
       a mesa em vez de só emprestar a quem paga mais. O resto por patrimônio.
       Ver §5.5 do PRD. */
    const acertou = new Set((st.apostas ?? []).filter((a) => a.acertou).map((a) => a.seat));
    const ranking = entradas
      .map((p) => ({
        ...p,
        valor: p.patrimonio ?? patrimonio(st.props, p.seat, p.cash),
        premio: p.seat === st.vencedor ? 0 : acertou.has(p.seat) ? 1 : 2,
      }))
      .sort((a, b) => a.premio - b.premio || b.valor - a.valor);
    const souEu = st.vencedor === meuAssento;

    return (
      <div className="met-fim">
        {festa && <Confete pecas={56} />}
        <p className="eyebrow">Fim da temporada</p>
        <h2 className="met-fim-titulo">
          {souEu ? "A cidade é sua." : `${nomes[st.vencedor ?? 0]} levou a cidade.`}
        </h2>
        <p className="dim met-fim-nota">
          {st.rodadaFinal
            ? `${st.rodadaFinal} rodadas, e ganha quem tem mais patrimônio — não quem sobrou. É o que faz a partida acabar antes da meia-noite.`
            : "Sobrou um."}
        </p>

        <ol className="met-podio">
          {ranking.map((p, i) => (
            <li key={p.seat} className="panel met-podio-linha" data-eu={p.seat === meuAssento}>
              <span className="seal">{i + 1}</span>
              <span
                className="met-cor"
                style={{ background: COLORS[p.cor].enamel }}
                aria-hidden
              />
              <span className="met-podio-nome">{nomes[p.seat]}</span>
              {p.quebrado && (
                <span className="met-fora">{p.investidor ? "investidor" : "fora"}</span>
              )}
              {acertou.has(p.seat) && (
                <span className="met-acertou" title="acertou a aposta secreta">
                  cravou a aposta
                </span>
              )}
              <span className="mono met-podio-valor">{reais(p.valor)}</span>
            </li>
          ))}
        </ol>

        <button className="btn btn-ghost" onClick={onSair}>
          Voltar para a sala
        </button>
      </div>
    );
  }

  /* ── a partida ──────────────────────────────────────────────────────── */

  const pend = st.pendente;
  const podeAgir = minhaVez && !ocupado && (st.phase === "rolar" || st.phase === "acao");
  const naCadeia = (eu?.jail ?? 0) > 0;
  const urgente = resto <= 15 && resto > 0;

  return (
    <div className="met" onPointerDown={() => sfx.arm()}>
      {/* ── barra de turno ──────────────────────────────────────────── */}
      <div className="met-turno" data-minha={minhaVez}>
        <span
          className="met-cor met-turno-cor"
          style={{ background: COLORS[cores[st.turnSeat] ?? "grafite"].enamel }}
          aria-hidden
        />
        <div className="met-turno-quem">
          <p className="eyebrow">
            Rodada {st.round}
            {st.rodadaFinal ? ` de ${st.rodadaFinal}` : ""}
          </p>
          <p className="met-turno-nome">
            {minhaVez ? "Sua vez" : `Vez de ${nomes[st.turnSeat]}`}
          </p>
        </div>
        {eu && <span className="met-caixa mono">{reais(eu.cash)}</span>}
        {st.dados && (
          <span className="met-dados mono" title="a última rolagem">
            {st.dados[0]}+{st.dados[1]}
          </span>
        )}
        <span className="met-relogio mono" data-urgente={urgente}>
          {Math.floor(resto / 60)}:{String(resto % 60).padStart(2, "0")}
        </span>
        <button
          type="button"
          className="som"
          aria-pressed={mudo}
          aria-label={mudo ? "Ligar som" : "Desligar som"}
          onClick={() => {
            sfx.arm();
            sfx.toggleMuted();
          }}
        >
          {mudo ? "✕" : "♪"}
        </button>
      </div>

      {/* ── A MANCHETE ───────────────────────────────────────────────────
          O evento é anunciado como jornal, e não como aviso de sistema, porque
          é assim que ele muda a conversa da mesa: alguém LÊ em voz alta. E o
          efeito vem escrito embaixo, porque "alta temporada" não diz a ninguém
          quanto o aluguel do Leblon passou a custar. */}
      {st.evento && (
        <div className="manchete" data-efeito={st.evento.efeito}>
          <div className="manchete-topo">
            <span className="manchete-jornal">A Gazeta de Capibara</span>
            <span className="manchete-prazo mono">
              até a rodada {st.evento.ate}
            </span>
          </div>
          <p className="manchete-titulo">{st.evento.manchete}</p>
          <p className="manchete-corpo">
            {st.evento.corpo}
            {st.evento.grupo && (
              <>
                {" "}
                O grupo sorteado foi{" "}
                <strong style={{ color: GRUPO_POR_ID[st.evento.grupo]?.cor }}>
                  {GRUPO_POR_ID[st.evento.grupo]?.nome}
                </strong>
                .
              </>
            )}
          </p>
        </div>
      )}

      {/* ── O LEILÃO, para todos ─────────────────────────────────────────
          Este bloco é o único do projeto que aparece igual para todo mundo,
          na vez de quem for. É o coração da correção deste jogo: sem leilão,
          a fase de aquisição é uma roleta lenta em que você só compra o que
          cai no seu dado. Ver docs/05-PRD-METROPOLE.md §5.1. */}
      {st.phase === "leilao" && st.leilao && (
        <div className="leilao">
          <div className="leilao-cabeca">
            <p className="eyebrow">Leilão</p>
            <span className="leilao-relogio mono" data-urgente={resto <= 8}>
              {resto}s
            </span>
          </div>
          <p className="leilao-prop">{POR_ID[st.leilao.prop]?.nome}</p>
          <p className="leilao-preco dim">
            vale {reais(POR_ID[st.leilao.prop]?.preco ?? 0)} na tabela · aberto a todos, inclusive
            a quem recusou
          </p>

          <p className="leilao-alto mono">
            {st.leilao.altoSeat === null ? (
              <span className="dim">nenhum lance</span>
            ) : (
              <>
                {reais(st.leilao.alto)} <span className="dim">· {nomes[st.leilao.altoSeat]}</span>
              </>
            )}
          </p>

          {/* O ADMINISTRADOR, só para o Investidor. Aparece antes dos botões de
              lance porque é pré-requisito: sem ele o lance não sai. */}
          {souInvestidor && st.leilao.altoSeat !== meuAssento && (
            <div className="leilao-admin">
              <p className="leilao-admin-titulo">
                Quem administra, se você levar?
              </p>
              <p className="leilao-admin-nota">
                A escritura fica no nome dele — inclusive para fechar grupo de cor e construir. O
                aluguel se parte no meio entre vocês dois.
              </p>
              <div className="leilao-admin-quem">
                {ativos.map((j) => (
                  <button
                    key={j.seat}
                    className="mesa-quem"
                    data-on={admin === j.seat}
                    onClick={() => setAdmin(j.seat)}
                  >
                    <span
                      className="met-cor"
                      style={{ background: COLORS[j.cor].enamel }}
                      aria-hidden
                    />
                    {nomes[j.seat]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {meuAssento !== null && (!eu?.quebrado || souInvestidor) &&
            st.leilao.altoSeat !== meuAssento && (
            <div className="leilao-acao">
              <div className="leilao-atalhos">
                {[minimoLance, minimoLance + 200, minimoLance + 500].map((v) => (
                  <button
                    key={v}
                    className="btn btn-brass leilao-btn"
                    disabled={ocupado || faltaAdmin || (eu?.cash ?? 0) < v}
                    onClick={() =>
                      void chama("met_bid", {
                        p_match: match.id,
                        p_valor: v,
                        p_admin: adminEfetivo,
                      })
                    }
                  >
                    {reais(v)}
                  </button>
                ))}
              </div>
              <div className="leilao-livre">
                <input
                  className="mono leilao-campo"
                  type="number"
                  min={minimoLance}
                  step={100}
                  value={meuLance}
                  onChange={(e) => setLance(Number(e.target.value))}
                  aria-label="Seu lance"
                />
                <button
                  className="btn btn-vivo leilao-btn"
                  disabled={ocupado || faltaAdmin || (eu?.cash ?? 0) < meuLance}
                  onClick={() =>
                    void chama("met_bid", {
                      p_match: match.id,
                      p_valor: meuLance,
                      p_admin: adminEfetivo,
                    })
                  }
                >
                  Dar lance
                </button>
                <button
                  className="btn btn-ghost leilao-btn"
                  disabled={ocupado}
                  onClick={() => void chama("met_pass", { p_match: match.id })}
                >
                  Passar
                </button>
              </div>
            </div>
          )}
          {st.leilao.altoSeat === meuAssento && (
            <p className="leilao-liderando">
              Você está na frente. O relógio reinicia a cada lance novo.
            </p>
          )}
          {st.leilao.passou.length > 0 && (
            <p className="leilao-passaram dim">
              passaram: {st.leilao.passou.map((s) => nomes[s]).join(", ")}
            </p>
          )}
        </div>
      )}

      <Tabuleiro
        props={st.props}
        peoes={peoes}
        cores={cores}
        meuAssento={meuAssento}
        evento={st.evento ?? null}
        destaque={
          st.phase === "leilao"
            ? (st.leilao?.prop ?? null)
            : pend?.k === "comprar"
              ? pend.prop
              : olhando
        }
        onEscolher={(p) => setOlhando((o) => (o === p ? null : p))}
      />

      {/* ── painel de ação ──────────────────────────────────────────── */}
      <div className="met-acao">
        {souInvestidor && st.phase !== "leilao" && (
          <p className="met-espera dim">
            Você é Investidor. Não anda pelo tabuleiro e não tem turno — mas dá lance em todo
            leilão, empresta a quem precisa, e a sua aposta secreta vale o segundo lugar.
          </p>
        )}

        {!minhaVez && !souInvestidor && st.phase !== "leilao" && (
          <p className="met-espera dim">
            Esperando {nomes[st.turnSeat]}. O relógio passa a vez sozinho se ninguém jogar — e o
            leilão você pode disputar de qualquer jeito.
          </p>
        )}

        {/* dívida */}
        {minhaVez && pend?.k === "divida" && (
          <div className="met-bloco met-divida">
            <p className="met-titulo">Você deve {reais(pend.quanto)}.</p>
            <p className="met-nota dim">
              O credor já recebeu — a dívida é sua. Hipoteque, venda construção, ou declare
              falência. Nada mais acontece até isso ser resolvido.
            </p>
            <button
              className="btn btn-lacquer"
              disabled={ocupado}
              onClick={() => void chama("met_bankrupt", { p_match: match.id })}
            >
              {st.mode === "classico" ? "Declarar falência (sai da partida)" : "Quebrar e virar Investidor"}
            </button>
          </div>
        )}

        {/* comprar ou recusar */}
        {minhaVez && pend?.k === "comprar" && (
          <div className="met-bloco">
            <p className="met-titulo">
              {POR_ID[pend.prop]?.nome} está à venda por {reais(pend.preco)}.
            </p>
            <p className="met-nota dim">
              Seu caixa depois: {reais((eu?.cash ?? 0) - pend.preco)}. Se você não comprar, ela vai
              a leilão — e você também pode dar lance lá, às vezes por menos.
            </p>
            <div className="met-botoes">
              <button
                className="btn btn-brass"
                disabled={ocupado || (eu?.cash ?? 0) < pend.preco}
                onClick={() => void chama("met_buy", { p_match: match.id })}
              >
                Comprar
              </button>
              <button
                className="btn btn-ghost"
                disabled={ocupado}
                onClick={() => void chama("met_decline", { p_match: match.id })}
              >
                Deixar ir a leilão
              </button>
            </div>
          </div>
        )}

        {/* cadeia */}
        {minhaVez && naCadeia && st.phase === "rolar" && (
          <div className="met-bloco">
            <p className="met-titulo">Você está na cadeia.</p>
            <p className="met-nota dim">
              Tentativa {eu?.jail} de 3. No fim da partida, ficar preso costuma ser BOM: você não
              anda, e quem não anda não paga aluguel de hotel de ninguém. Olhe seu balanço antes de
              pagar.
            </p>
            <div className="met-botoes">
              <button
                className="btn btn-brass"
                disabled={ocupado || (eu?.cash ?? 0) < REGRAS.fiancaCadeia}
                onClick={() => void chama("met_jail", { p_match: match.id, p_escolha: "pagar" })}
              >
                Pagar {reais(REGRAS.fiancaCadeia)}
              </button>
              {(eu?.livras ?? 0) > 0 && (
                <button
                  className="btn btn-vivo"
                  disabled={ocupado}
                  onClick={() => void chama("met_jail", { p_match: match.id, p_escolha: "carta" })}
                >
                  Usar a carta ({eu?.livras})
                </button>
              )}
              <button
                className="btn btn-ghost"
                disabled={ocupado}
                onClick={() => void chama("met_jail", { p_match: match.id, p_escolha: "dado" })}
              >
                Tentar o duplo
              </button>
            </div>
          </div>
        )}

        {/* rolar */}
        {minhaVez && !naCadeia && st.phase === "rolar" && !pend && (
          <div className="met-bloco">
            <p className="met-titulo">
              {st.duplos > 0 ? "Duplo! Você rola de novo." : "Sua vez de rolar."}
            </p>
            {st.duplos === 2 && (
              <p className="met-nota dim">
                Atenção: o terceiro duplo seguido vai para a cadeia. É o único momento do jogo em
                que tirar um bom dado é ruim.
              </p>
            )}
            <button
              className="btn btn-brass met-rolar"
              disabled={ocupado}
              onClick={() => void chama("met_roll", { p_match: match.id })}
            >
              Rolar os dados
            </button>
          </div>
        )}

        {/* passar a vez */}
        {minhaVez && st.phase === "acao" && (
          <button
            className="btn btn-lacquer met-passar"
            disabled={ocupado}
            onClick={() => void chama("met_end_turn", { p_match: match.id })}
          >
            Encerrar turno
          </button>
        )}

        {/* NEGOCIAR ESTÁ SEMPRE DISPONÍVEL, inclusive fora da sua vez. É a
            segunda ação do jogo que não espera turno, pelo mesmo motivo do
            leilão: metade das trocas boas nasce de ver o outro parar num lugar
            ruim e oferecer socorro na hora. */}
        {meuAssento !== null && (!eu?.quebrado || souInvestidor) && !acabou && (
          <button
            className="btn btn-ghost met-negociar"
            onClick={() => setNegociando((n) => !n)}
          >
            {negociando ? "Fechar a mesa" : "Negociar"}
            {(st.ofertas ?? []).some((o) => o.para === meuAssento) && (
              <span className="met-badge">
                {(st.ofertas ?? []).filter((o) => o.para === meuAssento).length}
              </span>
            )}
          </button>
        )}

        {erro && (
          <p className="met-erro" role="alert">
            {erro}
          </p>
        )}
      </div>

      {/* ── a casa que você está olhando ───────────────────────────── */}
      {olhando && <FichaCasa prop={olhando} st={st} nomes={nomes} onFechar={() => setOlhando(null)} />}

      {souInvestidor && !acabou && (
        <Aposta
          ativos={ativos.map((j) => ({ seat: j.seat, cor: j.cor }))}
          nomes={nomes}
          matchId={match.id}
          ocupado={ocupado}
          onApostar={(em) => void chama("met_aposta", { p_match: match.id, p_em: em })}
        />
      )}

      <Propostas
        ofertas={st.ofertas ?? []}
        nomes={nomes}
        meuAssento={meuAssento}
        onResponder={(id, aceita) =>
          void chama("met_offer_reply", { p_match: match.id, p_id: id, p_aceita: aceita })
        }
        onRetirar={(id) => void chama("met_offer_cancel", { p_match: match.id, p_id: id })}
      />

      {negociando && meuAssento !== null && (
        <MesaDeNegociacao
          props={st.props}
          jogadores={entradas}
          nomes={nomes}
          meuAssento={meuAssento}
          rodada={st.round}
          rodadaFinal={st.rodadaFinal}
          ocupado={ocupado}
          onPropor={async (para, da, quer) => {
            const r = await chama("met_offer", {
              p_match: match.id,
              p_para: para,
              p_da: da,
              p_quer: quer,
            });
            if (r) setNegociando(false);
          }}
          onFechar={() => setNegociando(false)}
        />
      )}

      <Contratos
        contratos={st.contratos ?? []}
        nomes={nomes}
        meuAssento={meuAssento}
        rodada={st.round}
        onExercer={(id) => void chama("met_exercer", { p_match: match.id, p_id: id })}
      />

      {eu && (
        <Fluxo
          props={st.props}
          seat={eu.seat}
          cash={eu.cash}
          quantosJogam={Math.max(ativos.length, 1)}
          evento={st.evento ?? null}
        />
      )}

      {eu && (
        <MinhasProps
          props={st.props}
          seat={eu.seat}
          cash={eu.cash}
          banco={st.bank}
          evento={st.evento ?? null}
          podeAgir={podeAgir}
          onConstruir={(p, n) => void chama("met_build", { p_match: match.id, p_prop: p, p_n: n })}
          onVender={(p, n) => void chama("met_sell", { p_match: match.id, p_prop: p, p_n: n })}
          onHipotecar={(p) => void chama("met_mortgage", { p_match: match.id, p_prop: p })}
          onResgatar={(p) => void chama("met_unmortgage", { p_match: match.id, p_prop: p })}
        />
      )}

      {/* ── quem está na mesa ─────────────────────────────────────── */}
      <div className="panel met-mesa">
        <p className="eyebrow">Na mesa</p>
        <ul className="met-jogadores">
          {entradas.map((p) => {
            const perfil = assentos.find((a) => a.user_id === p.userId);
            const val = patrimonio(st.props, p.seat, p.cash);
            const devendo = (st.devedores ?? []).includes(p.seat);
            return (
              <li
                key={p.seat}
                className="met-jogador"
                data-vez={p.seat === st.turnSeat}
                data-fora={p.quebrado}
              >
                {perfil && <Avatar spec={parseAvatar(perfil.avatar)} size={28} />}
                <span
                  className="met-cor"
                  style={{ background: COLORS[p.cor].enamel }}
                  aria-hidden
                />
                <span className="met-jogador-nome">{nomes[p.seat]}</span>
                {p.jail > 0 && <span className="met-preso">preso</span>}
                {devendo && <span className="met-devendo">devendo</span>}
                {p.quebrado && (
                  <span className="met-fora">{p.investidor ? "investidor" : "fora"}</span>
                )}
                <span className="mono met-jogador-caixa">{reais(p.cash)}</span>
                <span className="mono met-jogador-pat dim">{reais(val)}</span>
              </li>
            );
          })}
        </ul>
        <p className="dim met-mesa-nota">
          O caixa de todos é público, de propósito: você precisa ver quanto o outro tem para saber
          se vale apertar. Em Banco Imobiliário, informação escondida deixa o jogo pior.
        </p>
      </div>

      <Registro log={st.log ?? []} nomes={nomes} />
    </div>
  );
}

/* ── peças pequenas ──────────────────────────────────────────────────────── */

/** A ficha de uma casa, quando você toca nela no tabuleiro. */
function FichaCasa({
  prop,
  st,
  nomes,
  onFechar,
}: {
  prop: string;
  st: MetState;
  nomes: Record<number, string>;
  onFechar: () => void;
}) {
  const c = POR_ID[prop];
  const e = st.props[prop];
  if (!c) return null;

  return (
    <div className="panel ficha">
      <div className="ficha-topo">
        <p className="ficha-nome">{c.nome}</p>
        <button className="ficha-x" onClick={onFechar} aria-label="Fechar">
          ✕
        </button>
      </div>
      <p className="ficha-linha">
        <span className="dim">preço</span>
        <span className="mono">{reais(c.preco ?? 0)}</span>
      </p>
      <p className="ficha-linha">
        <span className="dim">dono</span>
        <span>{e?.owner === null || e?.owner === undefined ? "ninguém" : nomes[e.owner]}</span>
      </p>
      {c.t === "bairro" && (
        <>
          <p className="ficha-linha">
            <span className="dim">casa custa</span>
            <span className="mono">{reais(c.casa ?? 0)}</span>
          </p>
          <p className="ficha-linha">
            <span className="dim">hipoteca</span>
            <span className="mono">{reais(c.hipoteca ?? 0)}</span>
          </p>
        </>
      )}
      {c.t === "companhia" && (
        <p className="ficha-nota dim">
          Cobra {c.multiplo?.[0]}× o dado com uma; {c.multiplo?.[1]}× com as duas.
        </p>
      )}
      {c.t === "transporte" && (
        <p className="ficha-nota dim">
          {c.aluguel?.map((v, i) => `${i + 1}: ${reais(v)}`).join(" · ")}
        </p>
      )}
    </div>
  );
}

/** O registro: a partida em linhas curtas. */
function Registro({ log, nomes }: { log: LinhaLog[]; nomes: Record<number, string> }) {
  if (log.length === 0) return null;
  const quem = (s?: number | null) =>
    s === undefined || s === null ? "o banco" : (nomes[s] ?? `assento ${s}`);
  const onde = (id?: string) => (id ? (POR_ID[id]?.nome ?? id) : "?");
  const casaDe = (id?: string) => (id ? (POR_ID[id]?.nome ?? id) : "?");

  function frase(l: LinhaLog): string {
    switch (l.k) {
      case "abre":
        return `a partida começou no modo ${l.motivo ?? ""}`.trim();
      case "anda":
        return `${quem(l.seat)} tirou ${l.d?.join(" e ")} e foi para ${CASAS[l.para ?? 0]?.nome}`;
      case "largada":
        return `${quem(l.seat)} passou pela Largada e recebeu ${reais(REGRAS.salario)}`;
      case "paga":
        if (l.motivo?.startsWith("aluguel-investidor"))
          return `meia-parte de ${reais(l.valor ?? 0)} para o Investidor ${quem(l.para)}`;
        return l.motivo?.startsWith("aluguel")
          ? `${quem(l.de)} pagou ${reais(l.valor ?? 0)} de aluguel em ${casaDe(l.motivo.split(":")[1])}`
          : `${quem(l.de)} pagou ${reais(l.valor ?? 0)} — ${l.motivo}`;
      case "compra":
        return `${quem(l.seat)} comprou ${onde(l.prop)} por ${reais(l.valor ?? 0)}`;
      case "leilao-abre":
        return `${onde(l.prop)} foi a leilão${l.auto ? " (o relógio decidiu)" : ""}`;
      case "lance":
        return `${quem(l.seat)} deu ${reais(l.valor ?? 0)} em ${onde(l.prop)}`;
      case "leilao-fecha":
        return `${quem(l.seat)} levou ${onde(l.prop)} por ${reais(l.valor ?? 0)} no leilão`;
      case "leilao-investidor":
        return `${quem(l.seat)} arrematou ${onde(l.prop)} por ${reais(l.valor ?? 0)} — administrado por ${quem(l.para)}`;
      case "fim-sobrou-um":
        return `sobrou ${quem(l.seat)}`;
      case "evento":
        return `manchete: ${l.texto}`;
      case "evento-fim":
        return `passou: ${l.texto}`;
      case "bolao":
        return `${quem(l.seat)} parou na Praça e levou o bolão de ${reais(l.valor ?? 0)}`;
      case "largada-dobrada":
        return `${quem(l.seat)} parou exatamente na Largada e recebeu de novo`;
      case "leilao-vazio":
        return `ninguém deu lance em ${onde(l.prop)} — continua do banco`;
      case "carta":
        return `${quem(l.seat)}: ${l.texto}`;
      case "cadeia":
        return `${quem(l.seat)} foi para a cadeia`;
      case "tres-duplos":
        return `${quem(l.seat)} tirou três duplos seguidos e foi preso`;
      case "fianca":
      case "fianca-forcada":
        return `${quem(l.seat)} pagou a fiança`;
      case "livra":
        return `${quem(l.seat)} usou a carta de saída`;
      case "duplo-livra":
        return `${quem(l.seat)} tirou duplo e saiu da cadeia`;
      case "tenta-duplo":
        return `${quem(l.seat)} tentou o duplo e não veio (${l.n} de 3)`;
      case "constroi":
        return `${quem(l.seat)} construiu em ${onde(l.prop)} por ${reais(l.valor ?? 0)}`;
      case "vende-casa":
        return `${quem(l.seat)} vendeu construção em ${onde(l.prop)}`;
      case "hipoteca":
        return `${quem(l.seat)} hipotecou ${onde(l.prop)}${l.auto ? " (o relógio decidiu)" : ""}`;
      case "resgate":
        return `${quem(l.seat)} resgatou ${onde(l.prop)}`;
      case "investidor":
        return `${quem(l.seat)} quebrou e virou Investidor com ${reais(l.valor ?? 0)}`;
      case "eliminado":
        return `${quem(l.seat)} quebrou e saiu da partida`;
      case "quebrou-no-relogio":
        return `${quem(l.seat)} quebrou no relógio`;
      case "proposta":
        return `${quem(l.de)} fez uma proposta a ${quem(l.para)}`;
      case "proposta-recusada":
        return `${quem(l.para)} recusou a proposta de ${quem(l.de)}`;
      case "proposta-retirada":
        return `${quem(l.de)} retirou a proposta`;
      case "acordo":
        return `${quem(l.de)} e ${quem(l.para)} fecharam um acordo`;
      case "parcela":
        return `parcela de ${reais(l.valor ?? 0)}: ${quem(l.de)} pagou ${quem(l.para)}${
          l.n ? ` — faltam ${l.n}` : " — a última"
        }`;
      case "isento":
        return `${quem(l.seat)} não pagou ${reais(l.valor ?? 0)} em ${onde(l.prop)}: contrato de isenção`;
      case "opcao-exercida":
        return `${quem(l.seat)} exerceu a opção e comprou ${onde(l.prop)} por ${reais(l.valor ?? 0)}`;
      case "contrato-fim":
        return `um contrato de ${l.tipo ?? "acordo"} chegou ao fim`;
      case "vez":
        return `vez de ${quem(l.seat)}`;
      case "tempo-esgotado":
        return `${quem(l.seat)} perdeu o turno no relógio`;
      case "fim-rodadas":
        return `acabaram as rodadas: ${quem(l.seat)} venceu com ${reais(l.valor ?? 0)}`;
      default:
        return l.k;
    }
  }

  return (
    <div className="panel met-log">
      <p className="eyebrow">O que aconteceu</p>
      <ol className="met-log-lista">
        {log.slice(0, 16).map((l, i) => (
          <li key={l.seq ?? i} data-k={l.k}>
            {frase(l)}
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * A APOSTA SECRETA DO INVESTIDOR.
 *
 * A Metrópole é um jogo de informação aberta por desenho — o caixa de todos é
 * público, os contratos são públicos, o tabuleiro é público. Esta é a única
 * exceção, e ela se justifica: aposta revelada vira aliança pública, e o
 * Investidor deixa de ser neutro na hora em que todos sabem em quem ele
 * apostou.
 *
 * O texto embaixo não é enfeite: sem ele, o Investidor não tem como saber que
 * a aposta vale alguma coisa, e uma aposta que não vale nada ninguém faz.
 */
function Aposta({
  ativos,
  nomes,
  ocupado,
  onApostar,
}: {
  ativos: { seat: number; cor: ColorKey }[];
  nomes: Record<number, string>;
  matchId: string;
  ocupado: boolean;
  onApostar: (em: number) => void;
}) {
  const [escolhido, setEscolhido] = useState<number | null>(null);
  const [mandou, setMandou] = useState(false);

  return (
    <div className="panel aposta">
      <p className="eyebrow">Sua aposta secreta</p>
      <p className="dim aposta-nota">
        Em quem você acha que vai vencer? Ninguém vê a sua escolha — nem no fim, se você errar.
        Acertando, você fica em <strong>segundo lugar</strong> no placar final. É a única coisa
        que o Investidor ganha, e vale mais que qualquer empréstimo.
      </p>
      <div className="aposta-quem">
        {ativos.map((j) => (
          <button
            key={j.seat}
            className="mesa-quem"
            data-on={escolhido === j.seat}
            disabled={ocupado}
            onClick={() => {
              setEscolhido(j.seat);
              setMandou(false);
            }}
          >
            <span className="met-cor" style={{ background: COLORS[j.cor].enamel }} aria-hidden />
            {nomes[j.seat]}
          </button>
        ))}
      </div>
      <div className="aposta-acao">
        <button
          className="btn btn-brass"
          disabled={ocupado || escolhido === null}
          onClick={() => {
            if (escolhido !== null) {
              onApostar(escolhido);
              setMandou(true);
            }
          }}
        >
          {mandou ? "Aposta trocada" : "Apostar"}
        </button>
        {mandou && (
          <p className="aposta-feito dim">
            Guardada. Dá para trocar quantas vezes quiser até a partida acabar — travar a troca
            seria teatro, porque ninguém tem como saber quando você decidiu.
          </p>
        )}
      </div>
    </div>
  );
}
