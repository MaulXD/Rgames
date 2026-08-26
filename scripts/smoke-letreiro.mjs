#!/usr/bin/env node
/**
 * Teste de fumaça do Letreiro: partida completa, do começar ao placar.
 *
 *   npm run smoke:letreiro
 *
 * Usa a Admin API para criar jogadores e a conexão direta para as partes que
 * só o servidor faz (ler o gabarito, adiantar o relógio, rodar a varredura).
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(root, ".env.local"), quiet: true });

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;

let falhas = 0;
const ok = (c, m) => {
  if (!c) falhas++;
  console.log(`${c ? "  ok    " : "  FALHA "} ${m}`);
};

const conn = new URL(process.env.POSTGRES_URL_NON_POOLING);
conn.searchParams.set("uselibpqcompat", "true");
const db = new pg.Client({ connectionString: conn.toString() });
await db.connect();

async function admin(path, opts = {}) {
  const r = await fetch(`${URL_}/auth/v1${path}`, {
    ...opts,
    headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, "Content-Type": "application/json" },
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function player(email) {
  const { body } = await admin("/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password: "SenhaDeTeste!2026", email_confirm: true }),
  });
  const t = await (
    await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "SenhaDeTeste!2026" }),
    })
  ).json();
  return { id: body?.id, token: t.access_token };
}

async function rpc(token, fn, args) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args ?? {}),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function get(token, path) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

const stamp = Date.now();
const A = await player(`let-a-${stamp}@mesa.invalid`);
const B = await player(`let-b-${stamp}@mesa.invalid`);
ok(A.token && B.token, "dois jogadores autenticados");

const sala = (await rpc(A.token, "create_room", { p_game: "letreiro" })).body;
await rpc(B.token, "join_room", { p_code: sala.code });
ok(!!sala?.id, `sala ${sala?.code} criada`);

// ── regras da casa ────────────────────────────────────────────────────────
const regraB = await rpc(B.token, "set_room_settings", {
  p_room: sala.id,
  p_settings: { modo: "relampago" },
});
ok(regraB.status >= 400 && /NOT_HOST/.test(JSON.stringify(regraB.body)), "quem não é anfitrião não muda as regras");

const regraRuim = await rpc(A.token, "set_room_settings", {
  p_room: sala.id,
  p_settings: { modo: "eterno" },
});
ok(regraRuim.status >= 400 && /BAD_MODE/.test(JSON.stringify(regraRuim.body)), "modo fora do vocabulário é recusado");

const regraRuim2 = await rpc(A.token, "set_room_settings", {
  p_room: sala.id,
  p_settings: { anulacao: "vale-tudo" },
});
ok(regraRuim2.status >= 400 && /BAD_SCORING/.test(JSON.stringify(regraRuim2.body)), "anulação fora do vocabulário é recusada");

const regraRuim3 = await rpc(A.token, "set_room_settings", {
  p_room: sala.id,
  p_settings: { tamanho: 6 },
});
ok(regraRuim3.status >= 400 && /BAD_SIZE/.test(JSON.stringify(regraRuim3.body)), "tamanho fora do vocabulário é recusado");

const regraOk = await rpc(A.token, "set_room_settings", {
  p_room: sala.id,
  p_settings: { modo: "relampago", anulacao: "classica", tamanho: 4 },
});
ok(regraOk.status === 200 && regraOk.body?.settings?.modo === "relampago", "anfitrião grava Relâmpago + anulação clássica");
ok(regraOk.body?.settings?.tamanho === 4, "o tamanho da bandeja é gravado nas regras da casa");

// só o anfitrião começa
const naoHost = await rpc(B.token, "letreiro_start", { p_room: sala.id });
ok(naoHost.status >= 400 && /NOT_HOST/.test(JSON.stringify(naoHost.body)), "quem não é anfitrião não começa");

const inicio = await rpc(A.token, "letreiro_start", { p_room: sala.id });
const partida = inicio.body;
ok(inicio.status === 200 && partida?.id, "letreiro_start criou a partida");
ok(Array.isArray(partida?.public_state?.grid) && partida.public_state.grid.length === 16,
   "grade de 16 faces no estado público");
ok(partida?.public_state?.size === 4, `o tamanho vem no estado público (${partida?.public_state?.size})`);
ok(partida?.public_state?.solution === undefined && partida?.solution === undefined,
   "o gabarito NÃO vem no estado público");

const dupla = await rpc(A.token, "letreiro_start", { p_room: sala.id });
ok(dupla.status >= 400 && /ALREADY_RUNNING/.test(JSON.stringify(dupla.body)), "não começa duas partidas na mesma sala");

// o cliente vê a partida pelo RLS
const vista = await get(B.token, `matches?select=id,ends_at,public_state&id=eq.${partida.id}`);
ok(vista.body?.[0]?.id === partida.id, "RLS: membro da sala lê a partida");

const dura = Math.round((new Date(partida.ends_at).getTime() - new Date(partida.started_at).getTime()) / 1000);
ok(dura >= 58 && dura <= 62, `Relâmpago aplicou 60s de rodada (medido ${dura}s)`);
ok(partida.public_state.scoring === "classica", "a regra de anulação foi congelada no início da partida");

// gabarito pelo servidor, para escolher palavras de verdade
const { rows } = await db.query(
  `select b.grid, b.solution, b.word_count, b.comuns, b.max_score_comum, b.max_score
     from letreiro_boards b join matches m on m.board_id = b.id where m.id = $1`,
  [partida.id],
);
const { grid, solution, comuns, max_score_comum: maxComum } = rows[0];
const todas = Object.entries(solution).sort((a, b) => b[0].length - a[0].length);
console.log(
  `  grade: ${grid.join(" ")} · ${rows[0].word_count} palavras · ${comuns?.length ?? 0} comuns`,
);
ok(Array.isArray(comuns) && comuns.length > 0, `a grade tem lista de palavras comuns (${comuns?.length ?? 0})`);
ok(comuns.every((c) => c in solution), "toda palavra comum está no gabarito");
ok(maxComum > 0 && maxComum <= rows[0].max_score, `o teto comum (${maxComum}) não passa do teto total (${rows[0].max_score})`);

const [w1, p1] = todas[0];
const [w2, p2] = todas[1];
const [w3, p3] = todas[Math.floor(todas.length / 2)];

// A acha 1, 2 e 3 · B acha só a 3 -> a 3 é duplicada
ok((await rpc(A.token, "letreiro_submit", { p_match: partida.id, p_word: w1, p_path: p1 })).body?.ok === true,
   `A submete ${w1} (${w1.length} letras)`);
ok((await rpc(A.token, "letreiro_submit", { p_match: partida.id, p_word: w2, p_path: p2 })).body?.ok === true,
   `A submete ${w2}`);
ok((await rpc(A.token, "letreiro_submit", { p_match: partida.id, p_word: w3, p_path: p3 })).body?.ok === true,
   `A submete ${w3}`);
ok((await rpc(B.token, "letreiro_submit", { p_match: partida.id, p_word: w3, p_path: p3 })).body?.ok === true,
   `B submete ${w3} também`);

const repetida = await rpc(A.token, "letreiro_submit", { p_match: partida.id, p_word: w1, p_path: p1 });
ok(repetida.body?.reason === "REPEATED", "palavra repetida pelo mesmo jogador é recusada");

const naoPalavra = await rpc(A.token, "letreiro_submit", { p_match: partida.id, p_word: "ZZQXJ", p_path: "0123" });
ok(naoPalavra.body?.reason === "NOT_A_WORD", "palavra inexistente dá NOT_A_WORD");

// palavra ainda nao submetida, para nao bater no REPEATED antes do BAD_PATH
const [w4] = todas[2];
const caminhoRuim = await rpc(A.token, "letreiro_submit", { p_match: partida.id, p_word: w4, p_path: "0f" });
ok(caminhoRuim.body?.reason === "BAD_PATH", `palavra certa (${w4}) com caminho errado dá BAD_PATH`);

const curta = await rpc(A.token, "letreiro_submit", { p_match: partida.id, p_word: "AB", p_path: "01" });
ok(curta.body?.reason === "SHORT", "palavra de 2 letras é recusada");

// contagem pública mostra quantidade, nunca as palavras
const est = (await get(B.token, `matches?select=public_state&id=eq.${partida.id}`)).body?.[0]?.public_state;
ok(est?.counts?.[A.id] === 3 && est?.counts?.[B.id] === 1, "contagem pública por jogador está certa");
ok(JSON.stringify(est).includes(w1) === false, "o estado público NÃO contém as palavras dos jogadores");

// a lista de outro jogador é invisível
const espiar = await get(B.token, `match_private_state?select=data&user_id=eq.${A.id}`);
ok(Array.isArray(espiar.body) && espiar.body.length === 0, "RLS: ninguém lê a lista de palavras do outro");

const minha = await get(A.token, `match_private_state?select=data&match_id=eq.${partida.id}`);
ok(minha.body?.[0]?.data?.words?.length === 3, "cada um lê a própria lista");

// fim do tempo: o banco encerra, não o cliente
await db.query("update matches set ends_at = now() - interval '1 second' where id = $1", [partida.id]);
const tarde = await rpc(A.token, "letreiro_submit", { p_match: partida.id, p_word: w1, p_path: p1 });
ok(tarde.status >= 400 && /TIME_OVER/.test(JSON.stringify(tarde.body)), "palavra depois do tempo é recusada");

const naoPode = await rpc(A.token, "letreiro_score", { p_match: partida.id });
ok(naoPode.status >= 400, "cliente não consegue chamar letreiro_score");

const regraDurante = await rpc(A.token, "set_room_settings", {
  p_room: sala.id,
  p_settings: { modo: "classico" },
});
ok(regraDurante.status >= 400 && /MATCH_IN_PROGRESS/.test(JSON.stringify(regraDurante.body)),
   "não muda as regras com partida rolando");

// o pg_cron tambem varre a cada 10s: se ele chegou primeiro, o contador volta
// 0 e esta tudo certo. O que importa e o ESTADO, nao quem varreu.
await db.query("select public.letreiro_sweep()");
const { rows: st } = await db.query("select status from matches where id = $1", [partida.id]);
ok(st[0].status === "finished", `a rodada foi encerrada pelo servidor (${st[0].status})`);

// apuração
const fim = (await get(A.token, `matches?select=status,public_state&id=eq.${partida.id}`)).body?.[0];
ok(fim?.status === "finished", "partida marcada como encerrada");
ok(fim?.public_state?.phase === "reveal", "fase virou revelação");

const placar = fim?.public_state?.scores ?? {};
const ptsA = placar[A.id];
const ptsB = placar[B.id];
// mesma conta do servidor (letreiro_pontos_palavra) e do cliente
const VALOR = { A:1,E:1,I:1,O:1,U:1,S:1,M:1,R:1,T:1, D:2,L:2,C:2,P:2, N:3,B:3, F:4,G:4,H:4,V:4, J:5,Q:5, X:6,Z:6 };
const val = (w) => {
  let s = 0;
  for (const ch of w) s += VALOR[ch] ?? 1;
  const n = w.length;
  return s + (n <= 3 ? 0 : n === 4 ? 1 : n === 5 ? 3 : n === 6 ? 5 : n === 7 ? 8 : 14);
};
// anulação clássica: w3 valeu zero para os dois
ok(ptsA === val(w1) + val(w2), `anulação clássica: A ficou com ${ptsA} (esperado ${val(w1) + val(w2)})`);
ok(ptsB === 0, `anulação clássica: B ficou com ${ptsB} (esperado 0)`);

const achadasA = fim?.public_state?.found?.[A.id] ?? [];
ok(achadasA.length === 3, "conferência lista as 3 palavras de A");
ok(achadasA.some((x) => x.dup === true), "a palavra duplicada está marcada como dup");
ok(achadasA.every((x) => typeof x.w === "string" && x.w.length > 0), "as palavras saem com a grafia acentuada");

const perdidas = fim?.public_state?.missed ?? [];
ok(perdidas.length === 5, "revelação traz as 5 melhores que ninguém achou");
ok(perdidas.every((x) => x.p && x.w), "cada perdida tem caminho e grafia");
console.log(`  perdidas: ${perdidas.map((x) => `${x.w}(${x.pts})`).join(", ")}`);

/* A REGRA QUE MAIS MUDA A SENSAÇÃO DO JOGO: a revelação só mostra palavra que
   alguém reconhece. Antes ela exibia o topo do gabarito inteiro, e o gabarito
   inteiro tem "aalênio". O teste compara contra a lista `comuns` da grade,
   normalizando, porque a revelação devolve a grafia acentuada. */
const semAcento = (s) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z]/g, "");
ok(
  perdidas.every((x) => comuns.includes(semAcento(x.w))),
  `as perdidas saem SÓ da lista de comuns (${perdidas.map((x) => x.w).join(", ")})`,
);
ok(
  fim?.public_state?.maxScore === maxComum,
  `o aproveitamento usa o teto comum (${fim?.public_state?.maxScore} = ${maxComum})`,
);
ok(
  fim?.public_state?.wordCount === comuns.length,
  `"a grade tinha" conta as comuns (${fim?.public_state?.wordCount} = ${comuns.length})`,
);
ok(
  achadasA.every((x) => typeof x.comum === "boolean"),
  "cada palavra achada vem marcada como comum ou não",
);

/* ══════════════════════════════════════════════════════════════════════════
   BANDEJA DE 5×5

   Aqui mora a regressão silenciosa que a base 36 conserta: em hexadecimal só
   cabem 16 células, então as nove últimas de uma grade de 25 não tinham dígito
   e todo caminho que passasse por elas era recusado como BAD_PATH. O teste
   exige uma palavra que USE uma célula de índice ≥ 16.
   ══════════════════════════════════════════════════════════════════════════ */

const sala5 = (await rpc(A.token, "create_room", { p_game: "letreiro" })).body;
await rpc(B.token, "join_room", { p_code: sala5.code });
const regra5 = await rpc(A.token, "set_room_settings", {
  p_room: sala5.id,
  p_settings: { modo: "relampago", anulacao: "classica", tamanho: 5 },
});
ok(regra5.body?.settings?.tamanho === 5, "sala configurada para 5×5");

const inicio5 = await rpc(A.token, "letreiro_start", { p_room: sala5.id });
const p5 = inicio5.body;
ok(inicio5.status === 200 && p5?.id, `letreiro_start com 5×5 (${JSON.stringify(inicio5.body).slice(0, 100)})`);
ok(p5?.public_state?.grid?.length === 25, `grade de 25 faces (${p5?.public_state?.grid?.length})`);
ok(p5?.public_state?.size === 5, "o estado público diz size 5");

const dura5 = Math.round((new Date(p5.ends_at).getTime() - new Date(p5.started_at).getTime()) / 1000);
ok(dura5 >= 88 && dura5 <= 92, `Relâmpago de 5×5 dá 90s, não 60 (medido ${dura5}s)`);

const g5 = await db.query(
  `select b.solution, b.comuns from letreiro_boards b join matches m on m.board_id = b.id where m.id = $1`,
  [p5.id],
);
const sol5 = g5.rows[0].solution;
const B36 = "0123456789abcdefghijklmnopqrstuvwxyz";
// uma palavra cujo caminho toca a metade de baixo da grade
const longe = Object.entries(sol5).find(([, cam]) =>
  [...cam].some((c) => B36.indexOf(c) >= 16),
);
ok(!!longe, "existe palavra usando célula de índice ≥ 16");
if (longe) {
  const [w5, cam5] = longe;
  const env5 = await rpc(A.token, "letreiro_submit", { p_match: p5.id, p_word: w5, p_path: cam5 });
  ok(
    env5.body?.ok === true,
    `${w5} pelo caminho ${cam5} é aceita — a base 36 endereça as 25 células (${JSON.stringify(env5.body)})`,
  );
}
// e o caminho de 5×5 tem de ser recusado se as células não forem vizinhas:
// 0 e 4 são a mesma linha em 4×4 (vizinhas de canto? não) mas em 5×5 estão a
// quatro colunas de distância — a adjacência precisa do tamanho certo
const doisEm5 = Object.entries(sol5).find(([w]) => w.length >= 4);
if (doisEm5) {
  const ruim5 = await rpc(A.token, "letreiro_submit", {
    p_match: p5.id,
    p_word: doisEm5[0],
    p_path: "0o",
  });
  ok(ruim5.body?.ok === false, `caminho impossível em 5×5 é recusado (${ruim5.body?.reason})`);
}
ok(g5.rows[0].comuns?.length > 0, `a grade de 5×5 tem ${g5.rows[0].comuns?.length ?? 0} palavras comuns`);

// a sala volta para o lobby, pronta para revanche
const salaFim = (await get(A.token, `rooms?select=status&id=eq.${sala.id}`)).body?.[0];
ok(salaFim?.status === "lobby", "sala voltou para o lobby");

// faxina
for (const u of [A, B]) await admin(`/admin/users/${u.id}`, { method: "DELETE" });
await db.end();

console.log(falhas === 0 ? "\nTudo passou." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
