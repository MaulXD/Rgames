"use client";

import { useSyncExternalStore } from "react";

/**
 * Quem pediu menos movimento.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUE ISTO NÃO É SÓ CSS
 *
 * O `globals.css` já tem o desligamento universal: sob
 * `prefers-reduced-motion: reduce`, todo `animation-duration` vira 0,01ms e
 * toda iteração vira uma. Isso resolve a metade que é CSS, e resolve bem.
 *
 * Só que a outra metade é TEMPO, e tempo não é CSS. A rolagem do Domínio é
 * encenada por `setTimeout`: 620ms para o dado cair mais 1150ms para ler o
 * resultado, por assalto. Doze assaltos são vinte e um segundos, e a folha de
 * estilo não encurta um único deles — ela só tira o giro. Quem ligou a
 * preferência ficava olhando dados PARADOS pelos mesmos vinte e um segundos, o
 * que é pior que a animação: a tela parece travada.
 *
 * E a preferência não quer dizer só "sinto enjoo". Muita gente a liga porque
 * quer que as coisas ACONTEÇAM — e um jogo que insiste em encenar para essa
 * pessoa está ignorando o que ela pediu, com uma animação invisível.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * `useSyncExternalStore`, e não `useState` mais efeito
 *
 * A preferência é um sistema de fora do React, e ler sistema de fora no corpo
 * de um efeito produz descompasso de hidratação: o servidor renderiza sem saber
 * e o cliente corrige no primeiro quadro. É o mesmo motivo pelo qual o botão de
 * mudo do Letreiro já usa este mesmo padrão.
 *
 * No servidor a resposta é sempre "não" — é a hipótese que faz a primeira
 * pintura ser igual à do navegador que não tem a preferência, que é a maioria.
 */

const CONSULTA = "(prefers-reduced-motion: reduce)";

function assina(avisa: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(CONSULTA);
  mq.addEventListener("change", avisa);
  return () => mq.removeEventListener("change", avisa);
}

const agora = () =>
  typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(CONSULTA).matches;

const noServidor = () => false;

/** `true` quando a pessoa pediu menos movimento no sistema dela. */
export function useMenosMovimento(): boolean {
  return useSyncExternalStore(assina, agora, noServidor);
}
