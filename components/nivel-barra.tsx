"use client";

import { useSession } from "@/components/session";
import { parseStats, patente, progresso } from "@/lib/gamificacao";

/**
 * A barra de nível. Fica no cabeçalho, ao lado do bichinho.
 *
 * Mostra a patente e quanto falta para a próxima — número puro não diz nada,
 * e "faltam 40 de XP" diz. O XP vem de `profiles.stats`, creditado pelo
 * servidor no fim de cada partida.
 */
export function NivelBarra({ compacto = false }: { compacto?: boolean }) {
  const { profile } = useSession();
  if (!profile) return null;

  const s = parseStats(profile.stats);
  const { nivel, faltam, fracao } = progresso(s.xp ?? 0);

  return (
    <div className="nivel" data-compacto={compacto}>
      <span className="nivel-num" title={`Nível ${nivel} · ${patente(nivel)}`}>
        {nivel}
      </span>
      {!compacto && (
        <span className="nivel-texto">
          <span className="nivel-patente">{patente(nivel)}</span>
          <span className="nivel-falta">
            {faltam === 0 ? "no topo" : `faltam ${faltam} de XP`}
          </span>
        </span>
      )}
      <span className="nivel-barra">
        <span style={{ width: `${(fracao * 100).toFixed(1)}%` }} />
      </span>
    </div>
  );
}
