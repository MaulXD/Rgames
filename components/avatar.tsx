import { useId } from "react";
import {
  COLORS,
  avatarKey,
  bodyPath,
  faceBox,
  hatAnchor,
  type AvatarSpec,
  type Eyes,
  type Hat,
  type Mouth,
} from "@/lib/avatar";

const OUTLINE = "#1D1526";
const WHITE = "#FFFFFF";

/** Centro nominal da cara. O grupo inteiro é escalado em torno dele. */
const FACE_CX = 50;
const FACE_CY = 58;

/** Olhos — dois de cada, em x 39 e 61. */
function Olhos({ kind }: { kind: Eyes }) {
  const par = (node: (x: number) => React.ReactNode) => (
    <>
      {node(39)}
      {node(61)}
    </>
  );

  switch (kind) {
    case "normal":
      return par((x) => (
        <g key={x}>
          <circle cx={x} cy={52} r={6.4} fill={OUTLINE} />
          <circle cx={x + 2} cy={50} r={2.1} fill={WHITE} />
        </g>
      ));
    case "feliz":
      return par((x) => (
        <path
          key={x}
          d={`M${x - 7} 54 Q${x} 43 ${x + 7} 54`}
          stroke={OUTLINE}
          strokeWidth={4}
          fill="none"
          strokeLinecap="round"
        />
      ));
    case "sono":
      return par((x) => (
        <path
          key={x}
          d={`M${x - 7} 51 Q${x} 58 ${x + 7} 51`}
          stroke={OUTLINE}
          strokeWidth={4}
          fill="none"
          strokeLinecap="round"
        />
      ));
    case "uau":
      return par((x) => (
        <g key={x}>
          <circle cx={x} cy={52} r={9} fill={WHITE} stroke={OUTLINE} strokeWidth={3} />
          <circle cx={x} cy={52} r={4} fill={OUTLINE} />
        </g>
      ));
    case "esperto":
      return (
        <>
          <circle cx={39} cy={52} r={6.4} fill={OUTLINE} />
          <circle cx={41} cy={50} r={2.1} fill={WHITE} />
          <path
            d="M54 51 Q61 58 68 51"
            stroke={OUTLINE}
            strokeWidth={4}
            fill="none"
            strokeLinecap="round"
          />
        </>
      );
    case "brilho":
      return par((x) => (
        <g key={x}>
          <circle cx={x} cy={52} r={7.4} fill={OUTLINE} />
          <circle cx={x + 2.4} cy={49.4} r={2.9} fill={WHITE} />
          <circle cx={x - 2.6} cy={54.6} r={1.4} fill={WHITE} opacity={0.85} />
        </g>
      ));
  }
}

/** Boca — centrada em 50, y ≈ 68. */
function Boca({ kind }: { kind: Mouth }) {
  switch (kind) {
    case "sorriso":
      return (
        <path
          d="M38 66 Q50 77 62 66"
          stroke={OUTLINE}
          strokeWidth={4}
          fill="none"
          strokeLinecap="round"
        />
      );
    case "riso":
      return (
        <g>
          <path d="M37 65 Q50 80 63 65 Z" fill={OUTLINE} />
          <path d="M45 74 Q50 80 55 74 Z" fill="#FF7C93" />
        </g>
      );
    case "bico":
      return <circle cx={50} cy={69} r={5} fill={OUTLINE} />;
    case "lingua":
      return (
        <g>
          <path
            d="M38 65 Q50 76 62 65"
            stroke={OUTLINE}
            strokeWidth={4}
            fill="none"
            strokeLinecap="round"
          />
          <path d="M46 72 Q50 80 54 72 Z" fill="#FF7C93" />
        </g>
      );
    case "serio":
      return <path d="M41 70 H59" stroke={OUTLINE} strokeWidth={4} strokeLinecap="round" />;
    case "assobio":
      return <ellipse cx={50} cy={69} rx={4} ry={5.6} fill={OUTLINE} />;
  }
}

/** Óculos: acompanham a cara, não o topo do corpo. */
function Oculos() {
  return (
    <g stroke={OUTLINE} strokeWidth={3.4} fill="none">
      <circle cx={39} cy={52} r={11.5} fill={WHITE} fillOpacity={0.3} />
      <circle cx={61} cy={52} r={11.5} fill={WHITE} fillOpacity={0.3} />
      <path d="M50.5 52 h-0.5" />
      <path d="M27.5 49 l-6 -3M72.5 49 l6 -3" strokeLinecap="round" />
    </g>
  );
}

/** Chapéu, apoiado no topo da silhueta. */
function Chapeu({ kind, x, y }: { kind: Hat; x: number; y: number }) {
  if (kind === "nenhum" || kind === "oculos") return null;
  return (
    <g transform={`translate(${x} ${y})`}>
      {kind === "coroa" && (
        <g>
          <path
            d="M-19 2 L-19 -12 L-10 -4 L0 -16 L10 -4 L19 -12 L19 2 Z"
            fill="#FFC42E"
            stroke={OUTLINE}
            strokeWidth={3.4}
            strokeLinejoin="round"
          />
          <circle cx={0} cy={-19} r={3.2} fill="#FF4D5E" stroke={OUTLINE} strokeWidth={2.4} />
        </g>
      )}
      {kind === "boina" && (
        <g>
          <path
            d="M-20 1 Q-18 -14 0 -14 Q18 -14 20 1 Z"
            fill="#2E8CFF"
            stroke={OUTLINE}
            strokeWidth={3.4}
            strokeLinejoin="round"
          />
          <circle cx={2} cy={-17} r={3.4} fill="#2E8CFF" stroke={OUTLINE} strokeWidth={2.6} />
        </g>
      )}
      {kind === "laco" && (
        <g stroke={OUTLINE} strokeWidth={3.2} strokeLinejoin="round">
          <path d="M-3 0 L-18 -9 L-18 5 Z" fill="#FF6FA5" />
          <path d="M3 0 L18 -9 L18 5 Z" fill="#FF6FA5" />
          <circle cx={0} cy={-2} r={4} fill="#FF4D5E" />
        </g>
      )}
      {kind === "antena" && (
        <g stroke={OUTLINE} strokeWidth={3.4} strokeLinecap="round">
          <path d="M0 2 L0 -14" />
          <circle cx={0} cy={-19} r={5} fill="#A8E827" />
        </g>
      )}
      {kind === "pena" && (
        <g stroke={OUTLINE} strokeWidth={3} strokeLinejoin="round">
          <path d="M2 2 Q-6 -12 4 -22 Q14 -12 8 2 Z" fill="#2FD8C4" />
          <path d="M5 1 L5 -19" strokeWidth={2} />
        </g>
      )}
    </g>
  );
}

/**
 * O bichinho. Contorno grosso, barriga clara, bochecha rosada.
 *
 * A cara entra num grupo transformado pelo `faceBox` da silhueta — sem isso a
 * estrela e a nuvem ficavam com olhos e bochechas do lado de fora do corpo,
 * que era exatamente o "elemento quebrado" da tela de perfil.
 */
/**
 * Cada bicho tem uma cadência própria: se todos balançassem no mesmo compasso,
 * uma fileira de avatares pareceria uma engrenagem, não um grupo de gente. O
 * desvio sai da própria chave do avatar, então é estável entre recargas.
 */
function compasso(chave: string): number {
  let h = 2166136261;
  for (let i = 0; i < chave.length; i++) {
    h ^= chave.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 2400;
}

/** Só quem tem olho de bolinha pisca — olho fechado não fecha mais. */
const PISCA: Eyes[] = ["normal", "brilho"];

export function Avatar({
  spec,
  size = 64,
  title,
  /** desliga a vida — serve para pódio impresso, print, teste */
  still,
}: {
  spec: AvatarSpec;
  size?: number;
  title?: string;
  still?: boolean;
}) {
  const c = COLORS[spec.color];

  /* DUAS COISAS DIFERENTES QUE ANTES ERAM A MESMA.

     O `uid` servia para duas coisas ao mesmo tempo: o id do `<clipPath>` no
     DOM e a semente do compasso da respiração. As duas saíam de
     `avatarKey(spec)`, e para a segunda isso está certo — é o que faz um
     bichinho respirar sempre no mesmo ritmo, em vez de mudar de compasso a cada
     re-render.

     Para a primeira estava errado, e a auditoria do HTML renderizado achou:
     dois jogadores com o MESMO bichinho produzem o mesmo `id`, e `id` repetido
     é HTML inválido. Na prática o estrago era nulo — os dois `<clipPath>` são
     idênticos por construção, então tanto faz qual o navegador escolhe. Mas
     "inválido e por acaso inofensivo" é uma frase que envelhece mal: basta o
     recorte passar a depender de um campo que a chave não cobre.

     `useId` é a ferramenta feita para isto — única por INSTÂNCIA, e estável
     entre servidor e cliente, que é o que a hidratação exige. */
  const uid = useId().replace(/:/g, "");
  const compassoDoBicho = `av-${avatarKey(spec)}`;

  const path = bodyPath(spec.body);
  const anchor = hatAnchor(spec.body);
  const fb = faceBox(spec.body);
  const atraso = still ? undefined : `${compasso(compassoDoBicho)}ms`;

  const faceTransform =
    `translate(${fb.dx} ${fb.dy}) ` +
    `translate(${FACE_CX} ${FACE_CY}) scale(${fb.s}) translate(${-FACE_CX} ${-FACE_CY})`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ display: "block", flex: "none" }}
    >
      <defs>
        <clipPath id={`${uid}-clip`}>
          <path d={path} />
        </clipPath>
      </defs>

      {/* Tudo que é o bicho fica dentro deste grupo: ele é que respira. O
          balanço é de ±1,6 unidade do viewBox, então vale igual num avatar de
          28px numa lista e num de 120px no estúdio. */}
      <g className={still ? undefined : "av-vida"} style={{ animationDelay: atraso }}>
      {/* corpo */}
      <path d={path} fill={c.enamel} stroke={OUTLINE} strokeWidth={4.2} strokeLinejoin="round" />

      {/* barriga e brilho, recortados no corpo */}
      <g clipPath={`url(#${uid}-clip)`}>
        <ellipse cx={50} cy={84} rx={30} ry={20} fill={c.light} opacity={0.5} />
        <ellipse
          cx={34}
          cy={32}
          rx={15}
          ry={9}
          fill={WHITE}
          opacity={0.26}
          transform="rotate(-20 34 32)"
        />
      </g>

      {/* a cara, ajustada à silhueta */}
      <g transform={faceTransform}>
        <circle cx={26} cy={63} r={5.4} fill="#FF7C93" opacity={0.5} />
        <circle cx={74} cy={63} r={5.4} fill="#FF7C93" opacity={0.5} />
        <Olhos kind={spec.eyes} />

        {/* A PISCADA. Duas pálpebras da cor do corpo que descem sobre o olho e
            voltam — nada mais que isso, e é o que separa um desenho parado de
            um bicho olhando para você. O grupo fica achatado (scaleY 0) quase
            todo o tempo; a animação abre por um instante e fecha de novo. */}
        {!still && PISCA.includes(spec.eyes) && (
          <g className="av-pisca" style={{ animationDelay: atraso }}>
            {[39, 61].map((x) => (
              <g key={x}>
                <rect x={x - 8} y={42} width={16} height={19} fill={c.enamel} />
                <path
                  d={`M${x - 7} 55 Q${x} 60 ${x + 7} 55`}
                  stroke={OUTLINE}
                  strokeWidth={3.6}
                  fill="none"
                  strokeLinecap="round"
                />
              </g>
            ))}
          </g>
        )}

        <Boca kind={spec.mouth} />
        {spec.hat === "oculos" && <Oculos />}
      </g>

      <Chapeu kind={spec.hat} x={anchor.x} y={anchor.y} />
      </g>
    </svg>
  );
}
