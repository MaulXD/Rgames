import type { Metadata, Viewport } from "next";
import { Archivo, Fraunces, Inter_Tight, JetBrains_Mono } from "next/font/google";
import { SessionBanner } from "@/components/session-banner";
import { SfxBridge } from "@/components/sfx-bridge";
import { SessionProvider } from "@/components/session";
import "./globals.css";
import "./letreiro.css";
import "./dossie.css";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["SOFT", "WONK", "opsz"],
  display: "swap",
});

const interTight = Inter_Tight({
  variable: "--font-inter-tight",
  subsets: ["latin"],
  display: "swap",
});

// Archivo condensada para os móveis de interface: rótulos, botões, selos.
// É o registro de placa estampada, e contrasta com a Fraunces dos títulos.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Mesa — jogos de tabuleiro com os amigos",
  description:
    "Quatro jogos de tabuleiro para jogar com amigos por link. Sala com código e QR, conta opcional, e os clássicos consertados: partidas que acabam e ninguém eliminado assistindo.",
  applicationName: "Mesa",
};

export const viewport: Viewport = {
  themeColor: [
    { color: "#103128" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${fraunces.variable} ${interTight.variable} ${jetbrains.variable} ${archivo.variable} h-full antialiased`}
    >
      <body className="relative flex min-h-full flex-col">
        <SessionProvider>
          <SfxBridge />
          <SessionBanner />
          {children}
        </SessionProvider>
      </body>
    </html>
  );
}
