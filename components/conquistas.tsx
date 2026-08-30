"use client";

import { useEffect, useState } from "react";
import { Medalha } from "@/components/medalha";
import { useSession } from "@/components/session";
import { supabaseBrowser } from "@/lib/supabase/client";
import { CONQUISTAS, parseStats, patente, pct, progresso } from "@/lib/gamificacao";

/**
 * A coleção e os números da vida.
 *
 * As medalhas que faltam aparecem em cinza, com o "como se ganha" à vista — o
 * buraco na coleção é metade da graça, e esconder o critério só irrita.
 */
type Nemesis = { nome: string; vezes: number } | null;

export function Conquistas() {
  const { profile, status } = useSession();

  /* O NÊMESIS VEM DE FORA DE `stats`, e é de propósito.

     Contagem por PAR de jogadores não cabe num jsonb do perfil: seria um objeto
     que cresce sem teto com o id de todo mundo com quem você já jogou, lido
     inteiro a cada carregamento. E guardar id de terceiro no registro de alguém
     é decisão de privacidade, não campo que aparece de lado — por isso mora
     numa tabela com política própria (migração 0114), e o que atravessa a rede
     é o NOME, nunca o id. */
  const [nemesis, setNemesis] = useState<Nemesis>(null);
  useEffect(() => {
    if (status !== "ready") return;
    let vivo = true;
    void (async () => {
      const { data } = await supabaseBrowser().rpc("letreiro_nemesis_meu");
      if (vivo && data) setNemesis(data as Nemesis);
    })();
    return () => {
      vivo = false;
    };
  }, [status]);

  if (status !== "ready" || !profile) return null;

  const s = parseStats(profile.stats);
  const tenho = new Set(s.conquistas ?? []);
  const { nivel, faltam, fracao } = progresso(s.xp ?? 0);

  return (
    <>
      <div className="panel p-5 sm:p-6">
        <p className="eyebrow">Sua carreira na mesa</p>

        <div className="mt-4 flex items-center gap-4">
          <span className="nivel-num" style={{ width: 56, height: 56, fontSize: "1.4rem" }}>
            {nivel}
          </span>
          <div className="min-w-0 flex-1">
            <p className="nivel-patente" style={{ fontSize: "0.85rem" }}>
              {patente(nivel)}
            </p>
            <p className="mt-1 text-sm dim">
              {s.xp} de XP · {faltam === 0 ? "no topo da tabela" : `faltam ${faltam} para o nível ${nivel + 1}`}
            </p>
            <span className="nivel-barra mt-2">
              <span style={{ width: `${(fracao * 100).toFixed(1)}%` }} />
            </span>
          </div>
        </div>

        <dl className="numeros">
          <div className="numero">
            <dt>Partidas</dt>
            <dd>{s.partidas ?? 0}</dd>
          </div>
          <div className="numero">
            <dt>Casos fechados</dt>
            <dd>{s.vitorias ?? 0}</dd>
          </div>
          {/* OS DESAFIOS DIÁRIOS.

              O contador existe desde que o desafio existe e nenhuma tela o
              mostrava. Aparece só depois do primeiro, como o nêmesis: um zero
              ao lado de "Partidas" e "Palavras achadas" faria a pessoa que
              ainda não conhece o desafio achar que falhou nele. */}
          {(s.diarios ?? 0) > 0 && (
            <div className="numero">
              <dt>Desafios diários</dt>
              <dd>{s.diarios}</dd>
            </div>
          )}
          <div className="numero">
            <dt>Palavras achadas</dt>
            <dd>{s.palavras ?? 0}</dd>
          </div>
          <div className="numero">
            <dt>Melhor palavra</dt>
            <dd>
              {s.melhor?.pts ?? 0}
              <small>{s.melhor?.w ?? "ainda nenhuma"}</small>
            </dd>
          </div>

          {/* A MAIS RARA.

              O número grande é a PALAVRA e não o posto, ao contrário dos
              outros quatro. É de propósito: "41208" não é uma coisa que
              alguém conta para um amigo, e "MOSTARDA" é. O posto vai embaixo,
              como a escala que dá sentido à palavra.

              A frase diz "mais falada" e não "mais comum" porque o corpus é de
              FALA — legenda de filme e transcrição —, e essa diferença é o
              motivo de VERDADE aparecer antes de PARADIGMA. */}
          <div className="numero">
            <dt>Mais rara</dt>
            <dd>
              <span className="numero-palavra">{s.rara?.w ?? "—"}</span>
              <small>
                {s.rara
                  ? `${s.rara.posto.toLocaleString("pt-BR")}ª mais falada`
                  : "ainda nenhuma"}
              </small>
            </dd>
          </div>

          {/* O NÊMESIS.

              Aparece só quando existe. Uma pessoa que só jogou sozinha não tem
              nêmesis, e um card com travessão diria "você não tem amigos" —
              a lacuna é mais honesta calada.

              O número grande é a CONTAGEM e não o nome, ao contrário da
              palavra mais rara: aqui o nome já está na linha de baixo, e o que
              cresce com o tempo é quantas vezes. */}
          {nemesis && (
            <div className="numero">
              <dt>Nêmesis</dt>
              <dd>
                {nemesis.vezes}
                <small>
                  palavra{nemesis.vezes === 1 ? "" : "s"} anulada
                  {nemesis.vezes === 1 ? "" : "s"} com {nemesis.nome}
                </small>
              </dd>
            </div>
          )}

          {/* O APROVEITAMENTO.

              Duas divisões, feitas UMA vez cada, aqui — o servidor guarda as
              frações inteiras justamente para que a média da vida seja a
              porcentagem da soma, e não a soma das porcentagens. */}
          <div className="numero">
            <dt>Aproveitamento</dt>
            <dd>
              {pct(s.aproveita?.melhorNum, s.aproveita?.melhorDen) ?? 0}
              <small>
                {s.aproveita?.teto
                  ? `melhor rodada · ${pct(s.aproveita.pontos, s.aproveita.teto)}% na média`
                  : "da grade, na sua melhor rodada"}
              </small>
            </dd>
          </div>
        </dl>
      </div>

      <div className="panel mt-4 p-5 sm:p-6">
        <p className="eyebrow">
          Medalhas · {tenho.size} de {CONQUISTAS.length}
        </p>
        <div className="medalhas">
          {CONQUISTAS.map((c) => {
            const tem = tenho.has(c.id);
            return (
              <div key={c.id} className="medalha" data-tem={tem}>
                <Medalha glifo={c.glifo} cor={c.cor} conquistada={tem} size={46} title={c.nome} />
                <span className="min-w-0">
                  <span className="medalha-nome">{c.nome}</span>
                  <span className="medalha-como">{c.como}</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
