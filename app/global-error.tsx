"use client";

import { useEffect } from "react";

/**
 * A tela de quando o jogo quebra.
 *
 * ISTO NASCEU DE UM RELATO DE VERDADE. Alguém tentou jogar Dossiê sozinho e
 * recebeu a tela padrão do Next: "This page couldn't load. Reload to try again,
 * or go back." Em inglês, sem dizer o que aconteceu, sem dizer o que fazer, e
 * sem deixar rastro nenhum para quem fosse consertar.
 *
 * Três coisas estavam erradas ali, e as três são desta tela:
 *
 *   1. NÃO DIZIA O QUE QUEBROU. A mensagem do erro existe, o Next só não a
 *      mostra. Sem ela, quem relata o defeito só consegue dizer "deu erro" — e
 *      quem conserta começa adivinhando.
 *
 *   2. ESTAVA EM INGLÊS, num jogo que fala português do começo ao fim.
 *
 *   3. NÃO OFERECIA O CAMINHO DE VOLTA que importa. "Reload" numa partida que
 *      quebrou costuma quebrar de novo; o que a pessoa quer é voltar para a
 *      mesa e recomeçar.
 *
 * O `global-error` do App Router substitui o documento inteiro — por isso ele
 * traz o próprio `<html>` e o próprio estilo embutido: nesse ponto o CSS do
 * projeto pode não ter carregado, e uma tela de erro que depende de folha de
 * estilo é uma tela de erro que também quebra.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // o console é o que a pessoa consegue copiar e mandar
    console.error("[Mesa] a partida quebrou:", error);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "2rem 1.25rem",
          background: "#10362f",
          color: "#fdf7e8",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <div style={{ maxWidth: "38rem", width: "100%" }}>
          <p
            style={{
              margin: 0,
              fontSize: "0.7rem",
              fontWeight: 800,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "#a8c4b6",
            }}
          >
            A mesa virou
          </p>

          <h1
            style={{
              margin: "0.6rem 0 0",
              fontSize: "clamp(1.6rem, 6vw, 2.4rem)",
              lineHeight: 1.05,
            }}
          >
            Alguma coisa quebrou no meio do jogo.
          </h1>

          <p style={{ marginTop: "0.9rem", lineHeight: 1.5, color: "#e2dcc8" }}>
            A partida em si está no servidor e não se perdeu — quem quebrou foi
            esta tela. Voltar para a mesa e entrar de novo costuma resolver.
          </p>

          {/* A MENSAGEM CRUA, e não escondida atrás de "detalhes técnicos".

              Quem está jogando não vai ler, e não precisa. Quem for relatar o
              defeito precisa, e essa pessoa não tem como abrir o console num
              celular. Uma linha de monoespaçada é o preço de um relato que
              serve para alguma coisa. */}
          <pre
            style={{
              marginTop: "1.2rem",
              padding: "0.8rem 0.9rem",
              borderRadius: 14,
              border: "1px solid #2c6d5b",
              background: "rgb(7 28 26 / 0.55)",
              color: "#a8c4b6",
              fontSize: "0.78rem",
              lineHeight: 1.45,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              overflowX: "auto",
            }}
          >
            {error.message || "erro sem mensagem"}
            {error.digest ? `\n\ndigest ${error.digest}` : ""}
          </pre>

          <div
            style={{ marginTop: "1.4rem", display: "flex", gap: "0.6rem", flexWrap: "wrap" }}
          >
            <button
              type="button"
              onClick={() => reset()}
              style={{
                minHeight: 44,
                padding: "0 1.1rem",
                borderRadius: 14,
                border: "3px solid #1d1526",
                background: "#ffc42e",
                color: "#1d1526",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              Tentar de novo
            </button>
            <a
              href="/"
              style={{
                minHeight: 44,
                display: "inline-flex",
                alignItems: "center",
                padding: "0 1.1rem",
                borderRadius: 14,
                border: "3px solid #2c6d5b",
                background: "rgb(7 28 26 / 0.55)",
                color: "#fdf7e8",
                fontWeight: 700,
                textDecoration: "none",
              }}
            >
              Voltar para a mesa
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
