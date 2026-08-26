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

// só o anfitrião começa
const naoHost = await rpc(B.token, "letreiro_start", { p_room: sala.id });
ok(naoHost.status >= 400 && /NOT_HOST/.test(JSON.stringify(naoHost.body)), "quem não é anfitrião não começa");

const inicio = await rpc(A.token, "letreiro_start", { p_room: sala.id });
const partida = inicio.body;
ok(inicio.status === 200 && partida?.id, "letreiro_start criou a partida");
ok(Array.isArray(partida?.public_state?.grid) && partida.public_state.grid.length === 16,
   "grade de 16 faces no estado público");
ok(partida?.public_state?.solution === undefined && partida?.solution === undefined,
   "o gabarito NÃO vem no estado público");

const dupla = await rpc(A.token, "letreiro_start", { p_room: sala.id });
ok(dupla.status >= 400 && /ALREADY_RUNNING/.test(JSON.stringify(dupla.body)), "não começa duas partidas na mesma sala");

// o cliente vê a partida pelo RLS
const vista = await get(B.token, `matches?select=id,ends_at,public_state&id=eq.${partida.id}`);
ok(vista.body?.[0]?.id === partida.id, "RLS: membro da sala lê a partida");

// gabarito pelo servidor, para escolher palavras de verdade
const { rows } = await db.query(
  "select b.grid, b.solution, b.word_count from letreiro_boards b join matches m on m.board_id = b.id where m.id = $1",
  [partida.id],
);
const { grid, solution } = rows[0];
const todas = Object.entries(solution).sort((a, b) => b[0].length - a[0].length);
console.log(`  grade: ${grid.join(" ")} · ${rows[0].word_count} palavras`);

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

const { rows: varridas } = await db.query("select public.letreiro_sweep() n");
ok(varridas[0].n >= 1, "a varredura encerrou a rodada");

// apuração
const fim = (await get(A.token, `matches?select=status,public_state&id=eq.${partida.id}`)).body?.[0];
ok(fim?.status === "finished", "partida marcada como encerrada");
ok(fim?.public_state?.phase === "reveal", "fase virou revelação");

const placar = fim?.public_state?.scores ?? {};
const ptsA = placar[A.id];
const ptsB = placar[B.id];
const val = (w) => (w.length <= 4 ? 1 : w.length === 5 ? 2 : w.length === 6 ? 3 : w.length === 7 ? 5 : 11);
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

// a sala volta para o lobby, pronta para revanche
const salaFim = (await get(A.token, `rooms?select=status&id=eq.${sala.id}`)).body?.[0];
ok(salaFim?.status === "lobby", "sala voltou para o lobby");

// faxina
for (const u of [A, B]) await admin(`/admin/users/${u.id}`, { method: "DELETE" });
await db.end();

console.log(falhas === 0 ? "\nTudo passou." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
