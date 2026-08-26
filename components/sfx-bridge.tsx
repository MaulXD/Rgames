"use client";

import { useEffect } from "react";
import * as sfx from "@/lib/sfx";

/**
 * Som no site inteiro, com um ouvinte só.
 *
 * Em vez de pendurar `onClick` de som em cada botão (e esquecer metade), um
 * ouvinte no documento decide pelo elemento clicado. O primeiro gesto também
 * libera o áudio — o navegador não deixa tocar nada antes disso.
 *
 * A bandeja do Letreiro fica de fora de propósito: cada dado tem o seu próprio
 * som, com o tom subindo. Dois sons no mesmo toque viram ruído.
 */
export function SfxBridge() {
  useEffect(() => {
    function onDown(e: PointerEvent) {
      sfx.arm();
      const alvo = e.target;
      if (!(alvo instanceof Element)) return;
      if (alvo.closest(".die, .tray-grid")) return;
      if (alvo.closest(".btn, .chip, .rule-option, .seat, .som, .lugar, a[href]")) {
        sfx.clique();
      }
    }
    window.addEventListener("pointerdown", onDown, { passive: true });
    return () => window.removeEventListener("pointerdown", onDown);
  }, []);

  return null;
}
