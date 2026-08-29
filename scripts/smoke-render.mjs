#!/usr/bin/env node
/**
 * As telas dos quatro jogos renderizam com dados de verdade?
 *
 *   npm run smoke:render
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUE ISTO EXISTE
 *
 * A maior lacuna declarada deste projeto é que NINGUÉM VIU NENHUMA TELA. E a
 * primeira pessoa a abrir o Dossiê recebeu uma tela de erro: a narração estava
 * publicada como objeto e a abertura a percorre com `.map`.
 *
 * Setecentas e sessenta verificações de servidor não achariam aquilo, porque o
 * servidor não liga para a forma da narração. Nenhuma checagem de tipo acharia,
 * porque o TypeScript acredita no que o `as` diz. Só uma coisa acharia: montar
 * o componente com o dado que existe de verdade no banco.
 *
 * É o que esta suíte faz. Ela NÃO substitui olhos — não sabe se ficou bonito,
 * se cabe no celular, se a cor está certa. Ela responde uma pergunta só, e é a
 * que separa "feio" de "quebrado":
 *
 *     com o conteúdo que está publicado agora, a tela MONTA?
 *
 * ────────────────────────────────────────────────────────────────────────────
 * COMO, SEM NAVEGADOR E SEM DEPENDÊNCIA NOVA
 *
 * `scripts/alias-hooks.mjs` ensina o Node a carregar `.tsx` transformando o JSX
 * com o SWC que já vem dentro do Next. Daí é `renderToStaticMarkup`, que é o
 * mesmo renderizador que o servidor do Next usa.
 *
 * A ESCOLHA QUE FAZ ISSO FUNCIONAR: renderizar as FOLHAS, e não os contêineres.
 * `DossieGame` busca o caso num efeito, e efeito não roda em renderização de
 * servidor — montá-lo pararia em "Abrindo o dossiê…" e não provaria nada. As
 * folhas recebem o conteúdo por propriedade, e é nelas que moram os `.map` que
 * quebram.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(raiz, ".env.local"), quiet: true });

let falhas = 0;
const ok = (c, m) => {
  if (!c) falhas++;
  console.log(`${c ? "  ok    " : "  FALHA "} ${m}`);
};

const conn = new URL(process.env.POSTGRES_URL_NON_POOLING);
conn.searchParams.set("uselibpqcompat", "true");
const db = new pg.Pool({ connectionString: conn.toString(), max: 2, keepAlive: true });

/** Monta um componente e conta o que saiu. Estourar é a única falha. */
function monta(nome, componente, props) {
  try {
    const html = renderToStaticMarkup(createElement(componente, props));
    ok(html.length > 0, `${nome}: montou (${html.length} bytes de HTML)`);
    return html;
  } catch (e) {
    ok(false, `${nome}: ESTOUROU — ${String(e?.message).slice(0, 160)}`);
    return "";
  }
}

const nada = () => {};

console.log("\nTELAS — elas montam com o conteúdo que está publicado?\n");

/* ══════════════════════════════════════════════════════════════════════════
   DOSSIÊ — os quatro casos, e cada um nas três telas que leem o pacote
   ══════════════════════════════════════════════════════════════════════════ */

const { Abertura } = await import("@/components/dossie/abertura");
const { Mapa } = await import("@/components/dossie/mapa");
const { Bloco } = await import("@/components/dossie/bloco");

const casos = (
  await db.query(
    "select id, name, era, tagline, data from public.game_themes where game_key = 'dossie' order by id",
  )
).rows.map((r) => ({ id: r.id, name: r.name, era: r.era, tagline: r.tagline, ...r.data }));

for (const caso of casos) {
  const peoes = caso.suspects.slice(0, 3).map((s, i) => ({
    seat: i,
    userId: `u${i}`,
    nome: `Jogador ${i}`,
    avatar: null,
    suspeito: s.id,
    fantasma: false,
  }));
  const posicoes = Object.fromEntries(peoes.map((p, i) => [String(p.seat), caso.rooms[i].id]));
  const objetos = Object.fromEntries(caso.weapons.map((w, i) => [w.id, caso.rooms[i % 9].id]));

  monta(`dossie/${caso.id} · abertura`, Abertura, {
    caso,
    reviravolta: !!caso.twist,
    onFim: nada,
  });

  monta(`dossie/${caso.id} · mapa`, Mapa, {
    caso,
    posicoes,
    objetos,
    peoes,
    euEstouEm: caso.rooms[0].id,
    destaque: null,
    alcancaveis: true,
    /* Com a tempestade em vigor, que é o estado que menos gente vai ver e o
       que tem mais caminho de código novo. */
    fechados: [caso.rooms[3].id, caso.rooms[4].id],
    aviso: [caso.rooms[5].id],
    onEscolher: nada,
  });

  monta(`dossie/${caso.id} · bloco`, Bloco, {
    caso,
    log: [
      { seq: 1, type: "suggest", seat: 0, guess: [caso.suspects[1].id, caso.weapons[1].id, caso.rooms[1].id] },
      { seq: 2, type: "pass", seat: 1 },
      { seq: 3, type: "refute", seat: 2 },
      /* As linhas das reviravoltas entram aqui de propósito: elas são as mais
         novas e as que menos partida real produziu até agora. */
      { seq: 4, type: "apagao" },
      { seq: 5, type: "vento", rooms: [caso.rooms[0].id, caso.rooms[1].id] },
      { seq: 6, type: "registro", card: caso.weapons[2].id },
    ],
    mao: caso.suspects.slice(0, 2).map((s) => s.id),
    vistas: [{ card: caso.weapons[0].id, from: 1, seq: 2 }, { card: caso.rooms[0].id, from: null, seq: 3 }],
    jogadores: peoes.map((p) => ({ seat: p.seat, userId: p.userId, hand: 6 })),
    nomes: Object.fromEntries(peoes.map((p) => [p.seat, p.nome])),
    meuAssento: 0,
    pad: { marks: {}, assist: "dedutivo" },
    onPad: nada,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   DOMÍNIO — os dois mapas
   ══════════════════════════════════════════════════════════════════════════ */

const { MapaVantara, LegendaContinentes } = await import("@/components/dominio/mapa");
const { mapaDe } = await import("@/lib/dominio/mapas");

for (const qual of ["vantara", "relampago"]) {
  const mapa = mapaDe(qual);
  const donos = Object.fromEntries(mapa.territorios.map((t, i) => [t.id, i % 3]));
  const exercitos = Object.fromEntries(mapa.territorios.map((t, i) => [t.id, 1 + (i % 5)]));
  const cores = { 0: "carmim", 1: "jade", 2: "prussia" };

  monta(`dominio/${qual} · mapa`, MapaVantara, {
    mapa,
    donos,
    exercitos,
    cores,
    meuAssento: 0,
    origem: mapa.territorios[0].id,
    alvos: mapa.territorios[0].vizinhos,
    mexeu: [mapa.territorios[1].id],
    onEscolher: nada,
  });

  monta(`dominio/${qual} · legenda`, LegendaContinentes, { mapa, donos, cores });
}

/* ══════════════════════════════════════════════════════════════════════════
   LETREIRO — a bandeja, nas quatro peles e nos dois tamanhos
   ══════════════════════════════════════════════════════════════════════════ */

const { Board } = await import("@/components/letreiro/board");

const grades = (
  await db.query(
    /* Uma de cada tamanho. `order by size, id limit 2` trouxe duas de 4×4 e
       nenhuma de 5×5 — a bandeja grande, que é a que tem mais célula para dar
       errado, ficava sem teste. */
    `select distinct on (size) grid, size
       from public.letreiro_boards where usavel order by size, id`,
  )
).rows;

for (const g of grades) {
  for (const bandeja of ["nogueira", "osso", "fliperama", "meridiano"]) {
    monta(`letreiro/${g.size}×${g.size} · ${bandeja}`, Board, {
      grid: g.grid,
      bandeja,
      path: [0, 1],
      state: "path",
      onPathChange: nada,
      onCommit: nada,
    });
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   METRÓPOLE — o tabuleiro
   ══════════════════════════════════════════════════════════════════════════ */

const { Tabuleiro } = await import("@/components/metropole/tabuleiro");
const { CASAS } = await import("@/lib/metropole/cidade");

const props = Object.fromEntries(
  CASAS.filter((c) => c.id).map((c, i) => [
    c.id,
    { owner: i % 3, casas: i % 6, hipotecada: i % 7 === 0 },
  ]),
);

monta("metropole/capibara · tabuleiro", Tabuleiro, {
  props,
  peoes: [0, 1, 2].map((i) => ({
    seat: i,
    cor: ["carmim", "jade", "prussia"][i],
    nome: `Jogador ${i}`,
    pos: i * 7,
    preso: i === 2,
  })),
  cores: { 0: "carmim", 1: "jade", 2: "prussia" },
  meuAssento: 0,
  evento: null,
  destaque: null,
  onEscolher: nada,
});

/* ══════════════════════════════════════════════════════════════════════════
   E A REGRESSÃO QUE ORIGINOU TUDO ISTO

   A narração como objeto em vez de lista. Não basta a suíte passar hoje: ela
   tem de REPROVAR o defeito de ontem, senão não é ela que está segurando nada.
   ══════════════════════════════════════════════════════════════════════════ */

const comObjeto = {
  ...casos[0],
  narracao: Object.fromEntries(casos[0].narracao.map((t, i) => [i, t])),
};
let estourou = false;
try {
  renderToStaticMarkup(
    createElement(Abertura, { caso: comObjeto, reviravolta: false, onFim: nada }),
  );
} catch {
  estourou = true;
}
ok(
  estourou,
  estourou
    ? "e a abertura AINDA estoura com a narração em objeto — é este o defeito que a suíte segura"
    : "a narração em objeto não estoura mais: esta suíte deixou de guardar o defeito que a criou",
);

await db.end();
console.log(falhas === 0 ? "\nTudo passou." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
