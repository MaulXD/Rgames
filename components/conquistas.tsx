"use client";

import { Medalha } from "@/components/medalha";
import { useSession } from "@/components/session";
import { CONQUISTAS, parseStats, patente, progresso } from "@/lib/gamificacao";

/**
 * A coleção e os números da vida.
 *
 * As medalhas que faltam aparecem em cinza, com o "como se ganha" à vista — o
 * buraco na coleção é metade da graça, e esconder o critério só irrita.
 */
export function Conquistas() {
  const { profile, status } = useSession();
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
