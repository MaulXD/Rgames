"use client";

const CORES = ["#FF4D5E", "#FF8A2B", "#FFC42E", "#A8E827", "#2FD8C4", "#2E8CFF", "#B25CFF", "#FF6FA5"];

/**
 * Confete.
 *
 * Trinta e seis pedaços, cada um com trajetória e giro próprios, calculados do
 * índice — nada de aleatório, então o mesmo momento produz sempre a mesma
 * chuva e não há descompasso de hidratação. Some sozinho e não bloqueia clique.
 *
 * `prefers-reduced-motion` remove o componente inteiro: quem pediu menos
 * movimento não precisa de papel picado voando.
 */
export function Confete({ pecas = 36 }: { pecas?: number }) {
  return (
    <div className="confete" aria-hidden>
      {Array.from({ length: pecas }, (_, i) => {
        const t = i / pecas;
        const angulo = t * Math.PI * 2;
        const forca = 40 + ((i * 37) % 45);
        return (
          <span
            key={i}
            style={
              {
                "--dx": `${(Math.cos(angulo) * forca).toFixed(1)}vw`,
                "--dy": `${(Math.sin(angulo) * forca * 0.7 - 18).toFixed(1)}vh`,
                "--gir": `${((i * 97) % 720) - 360}deg`,
                "--atraso": `${((i * 23) % 260)}ms`,
                "--cor": CORES[i % CORES.length],
                "--lado": i % 3 === 0 ? "50%" : "2px",
              } as React.CSSProperties
            }
          />
        );
      })}
    </div>
  );
}
