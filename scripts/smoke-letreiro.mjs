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
import { readFile } from "node:fs/promises";
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
/* POR QUE POOL E NÃO CLIENT.

   Um `pg.Client` é UMA conexão, aberta no começo e mantida até o fim. Quando
   ela cai — e ela cai, porque estas suítes passam minutos entre consultas —, o
   `pg` emite `error` num objeto sem ouvinte e o Node derruba o processo:

       Error: Connection terminated unexpectedly
       Emitted 'error' event on Client instance

   A suíte fica vermelha por causa da rede, que é o pior vermelho que existe: o
   que ensina a olhar para a saída e pensar "ah, deve ser aquilo".

   O Pool abre conexão sob demanda e devolve ao fim de cada consulta — uma que
   morreu enquanto ninguém a usava simplesmente não volta, e a próxima consulta
   abre outra. `keepAlive` é o cinto: impede que um NAT ou proxy no caminho
   desligue por ociosidade, que é a causa mais provável.

   Nada aqui depende de sessão: sem `set local`, sem tabela temporária, sem
   trava consultiva. A API de `query` e `end` é a mesma. */
const db = new pg.Pool({ connectionString: conn.toString(), max: 4, keepAlive: true });
/* Sem `connect()`: no Pool ele reserva uma conexão que precisa ser devolvida,
   e descartar o retorno segura uma das quatro pela partida inteira. O Pool
   abre sozinho na primeira consulta. */

/* UMA REPETIÇÃO QUANDO A CONEXÃO CAI, e só quando ela cai.

   O Pool já resolveu a conexão que morre OCIOSA — a próxima consulta abre
   outra. O que ele não resolve é a que morre NO MEIO de uma consulta, e essas
   suítes provocam isso: a do Dossiê joga duas partidas solo inteiras, centenas
   de ida e volta ao Supabase, e uma delas leva "Connection terminated
   unexpectedly" a cada poucas centenas.

   O estrago não era o passo perdido. Era a MENSAGEM: o laço solo reporta
   qualquer erro como "TRAPAÇA OU DEDUÇÃO ERRADA", e uma queda de TCP saía
   escrita como acusação de trapaça da máquina. Saída que mente sobre a causa é
   pior que saída nenhuma — ela manda consertar o que não está quebrado.

   UMA repetição, e não um laço: se a segunda também cair, o problema não é
   blip de rede e o teste tem de ficar vermelho mesmo. Retentativa sem teto
   transforma banco fora do ar em suíte que trava. */
const CONEXAO_CAIU = /Connection terminated|ECONNRESET|socket hang up|Client has encountered/i;
/* E os erros de ABRIR conexao, que sao outros: o Pool cria uma nova quando a
   anterior morreu, e essa criacao tambem falha de vez em quando. O `ETIMEDOUT`
   chega como AggregateError de MENSAGEM VAZIA -- so o `code` identifica --, e
   por isso a checagem olha os dois lugares. */
const CODIGO_DE_REDE = new Set([
  "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EPIPE",
]);
const ehDaRede = (e) =>
  CODIGO_DE_REDE.has(e?.code ?? "") || CONEXAO_CAIU.test(e?.message ?? "");
const consultaCrua = db.query.bind(db);
db.query = async (...args) => {
  try {
    return await consultaCrua(...args);
  } catch (e) {
    if (!ehDaRede(e)) throw e;
    return await consultaCrua(...args);
  }
};

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
/* ESTA CHECAGEM VEM ANTES de forçar o fim da rodada, e a ordem é o conserto de
   uma falha que aparecia uma vez a cada tantas execuções.

   `letreiro_sweep` roda por cron a cada dez segundos. Quando ela apura a
   rodada, devolve a sala ao lobby — e aí mudar a regra da casa passa a ser
   PERMITIDO, corretamente. Com a checagem depois do `ends_at` no passado, era
   uma corrida: se o cron chegasse primeiro, o teste reprovava sem nada estar
   errado. Aqui a partida ainda está rolando de verdade. */
const regraDurante = await rpc(A.token, "set_room_settings", {
  p_room: sala.id,
  p_settings: { modo: "classico" },
});
ok(regraDurante.status >= 400 && /MATCH_IN_PROGRESS/.test(JSON.stringify(regraDurante.body)),
   "não muda as regras com partida rolando");

await db.query("update matches set ends_at = now() - interval '1 second' where id = $1", [partida.id]);
const tarde = await rpc(A.token, "letreiro_submit", { p_match: partida.id, p_word: w1, p_path: p1 });
ok(tarde.status >= 400 && /TIME_OVER/.test(JSON.stringify(tarde.body)), "palavra depois do tempo é recusada");

const naoPode = await rpc(A.token, "letreiro_score", { p_match: partida.id });
ok(naoPode.status >= 400, "cliente não consegue chamar letreiro_score");

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

/* ══════════════════════════════════════════════════════════════════════════
   AS PALAVRAS QUE O JOGO MOSTRA

   O Letreiro tem duas listas e a diferença entre elas é uma decisão de projeto:
   ele ACEITA generosamente (recusar palavra que a pessoa sabe que existe é a
   pior coisa que um Boggle faz) e MOSTRA seletivamente. A lista do MOSTRA é a
   da revelação e é de onde a máquina tira as palavras dela.

   Antes de 0051 o MOSTRA tinha um corte único de 50 mil no posto do corpus, e
   uma grade real saía assim:

     SONO SONDA ONO ONDA ONDE DOS DONO DONDE DONA DUNA DUDA UNOS UNA ADE
     ADELE AGUDO FONE FOR FOLE FUNDO NOS NON NOR NUNO NULO NEURO NELE NET
     NETA NONO GUA GUDE GAEL GATE OUT ORE UFO ENDO ENA EURO

   A revelação é o momento em que o jogo ENSINA. Mostrar "ADE" ali é o jogo
   dizendo que ADE era uma palavra que a pessoa devia ter achado.

   ESTE BLOCO GUARDA AS DUAS PONTAS, e a segunda é a que mais importa. Um filtro
   de qualidade erra nas duas direções: mostrar "ADELE" faz o jogo parecer
   desleixado, mas ESCONDER "CASA" faz a revelação mentir. A lista curada já
   teve, em duas versões diferentes, "dentro", "fora", "porto", "clara", "para"
   e "meta" — todas palavras do dia a dia que também são nome, sobrenome ou
   parecem prefixo.
   ══════════════════════════════════════════════════════════════════════════ */

console.log("\n  ── as palavras que o jogo mostra ──");

const naoComum = new Set(
  (await readFile(join(root, "data", "letreiro-nao-comum.txt"), "utf8"))
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("#"))
    .flatMap((l) => l.trim().split(/\s+/))
    .filter(Boolean)
    .map((w) => w.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()),
);
ok(naoComum.size > 300, `a lista curada tem ${naoComum.size} palavras`);

/* A INVARIANTE: nenhuma grade SORTEÁVEL mostra palavra da lista curada.
   É a checagem que sobrevive a mim: se um dia alguém acrescentar palavra à
   lista e esquecer de recomputar as grades, isto quebra. */
const gradesAmostra = (
  await db.query(
    "select id, size, comuns from letreiro_boards where usavel order by random() limit 300",
  )
).rows;
const vazando = [];
for (const g of gradesAmostra) {
  for (const w of g.comuns) if (naoComum.has(w)) vazando.push(`${w} (grade ${g.id})`);
}
ok(
  vazando.length === 0,
  vazando.length === 0
    ? `em 300 grades sorteáveis, nenhuma palavra da lista curada aparece na revelação`
    : `VAZOU para a revelação: ${vazando.slice(0, 6).join(", ")}`,
);

/* O corte por tamanho, medido no dicionário. Não é uma opinião sobre onde
   cortar: é a conferência de que o corte existe e escala. */
const cortes = (
  await db.query(
    `select len, count(*) filter (where comum)::int comuns, count(*)::int total,
            max(freq) filter (where comum) pior
       from dict_pt where len between 3 and 7 group by len order by len`,
  )
).rows;
ok(
  cortes.every((c, i) => i === 0 || Number(c.pior) >= Number(cortes[i - 1].pior)),
  `o corte escala com o tamanho: ${cortes.map((c) => `${c.len}→${c.pior}`).join(" ")}`,
);
ok(
  Number(cortes[0].pior) <= 4000,
  `palavra de 3 letras só é comum no topo do corpus (pior posto ${cortes[0].pior}) — é ali que vive o lixo`,
);

/* E O DIA A DIA CONTINUA APARECENDO. Sem esta metade, o teste acima premiaria
   um filtro que marcasse tudo como não-comum. */
const diaADia = [
  "CASA", "MESA", "TEMPO", "NOITE", "AMIGO", "CIDADE", "PALAVRA", "TRABALHO",
  "DENTRO", "FORA", "PARA", "META", "PORTO", "CLARA", "ESCOLA", "COMIDA",
  "JANELA", "CADEIRA", "DINHEIRO", "SEMANA", "MINUTO", "CORACAO", "VERDADE",
];
const estado = (
  await db.query("select norm, comum from dict_pt where norm = any($1)", [diaADia])
).rows;
const faltando = estado.filter((r) => !r.comum).map((r) => r.norm);
const vistas = new Set(estado.map((r) => r.norm));
const ausentes = diaADia.filter((w) => !vistas.has(w));
ok(
  faltando.length === 0 && ausentes.length === 0,
  faltando.length === 0 && ausentes.length === 0
    ? `e as ${diaADia.length} palavras do dia a dia seguem comuns — o filtro não apertou demais`
    : `O FILTRO APERTOU DEMAIS: escondeu ${faltando.join(", ")}${ausentes.length ? ` · fora do dicionário: ${ausentes.join(", ")}` : ""}`,
);

/* A revelação de uma grade de verdade, para o olho humano ver. Um teste que
   mede tudo e não mostra nada deixa a pessoa que lê sem opinião. */
const vitrine = (
  await db.query(
    `select grid, comuns from letreiro_boards
      where usavel and size = 5 order by id desc limit 1`,
  )
).rows[0];
console.log(`         ${vitrine.grid.join("")}`);
console.log(`         ${vitrine.comuns.slice(0, 34).join(" ")}`);

/* ══════════════════════════════════════════════════════════════════════════
   JOGADOR CONTRA A MÁQUINA

   Uma máquina é um jogador de verdade: conta, perfil, assento, cor e linha em
   `match_players`. A consequência que este teste tem de provar é que a
   APURAÇÃO NÃO MUDOU — as palavras da máquina estão no estado privado dela, e
   `letreiro_score_bruto` já sabia somar estado privado de todo mundo.

   E a propriedade que decide se o adversário serve para alguma coisa: na MESMA
   grade, difícil tem de pontuar mais que médio, e médio mais que fácil. Um
   nível que não significa nada é pior que não ter nível.
   ══════════════════════════════════════════════════════════════════════════ */

const salaM = (await rpc(A.token, "create_room", { p_game: "letreiro" })).body;

const botNaoHost = await rpc(B.token, "adicionar_bot", { p_room: salaM.id, p_nivel: "medio" });
ok(
  /NOT_HOST/.test(JSON.stringify(botNaoHost.body)),
  "quem não é anfitrião não convida máquina",
);

const nivelRuim = await rpc(A.token, "adicionar_bot", { p_room: salaM.id, p_nivel: "impossivel" });
ok(/BAD_LEVEL/.test(JSON.stringify(nivelRuim.body)), "nível fora do vocabulário é recusado");

/* MÁQUINA SÓ ENTRA ONDE SABE JOGAR — e agora ela sabe jogar os quatro.

   Esta trava nasceu em 0045 com uma lista de um jogo só, e o teste dela era uma
   lista de três RECUSAS. A lista de recusas encolheu até sumir: Domínio em 0048,
   Metrópole em 0055, Dossiê em 0057.

   O teste virou o contrário, e continua sendo o mesmo teste: a trava existe, e
   o que ela permite É o registro honesto de onde o trabalho chegou. Se alguém
   acrescentar um quinto jogo e esquecer o cérebro, \`bot_sabe_jogar\` recusa e
   este teste conta quantos são. */
const sabeJogar = (
  await db.query(
    `select g, public.bot_sabe_jogar(g) sabe
       from unnest(array['letreiro', 'dominio', 'metropole', 'dossie']) g`,
  )
).rows;
ok(
  sabeJogar.every((r) => r.sabe),
  `a máquina sabe jogar os quatro: ${sabeJogar.map((r) => r.g).join(", ")}`,
);
const inventado = await rpc(A.token, "adicionar_bot", {
  p_room: (await rpc(A.token, "create_room", { p_game: "letreiro" })).body.id,
  p_nivel: "medio",
});
ok(
  inventado.status === 200,
  "e entra numa sala de Letreiro sem reclamar",
);
const semCerebro = (
  await db.query("select public.bot_sabe_jogar('xadrez') s")
).rows[0].s;
ok(
  semCerebro === false,
  "e a trava continua de pé para um jogo que ainda não existe — assento ocupado por quem não joga é pior que assento vazio",
);


const bot1 = await rpc(A.token, "adicionar_bot", { p_room: salaM.id, p_nivel: "facil" });
ok(bot1.status === 200, `máquina convidada no fácil (assento ${bot1.body?.seat})`);
ok(bot1.body?.is_ready === true, "e ela entra PRONTA: não há por que ela não estar");
ok(bot1.body?.bot_nivel === "facil", "com o nível gravado na sala, não na conta");
ok(bot1.body?.color !== null, "e com cor própria");

const bot2 = await rpc(A.token, "adicionar_bot", { p_room: salaM.id, p_nivel: "dificil" });
ok(bot2.status === 200, `segunda máquina, no difícil (assento ${bot2.body?.seat})`);
ok(
  bot2.body?.user_id !== bot1.body?.user_id,
  "e é OUTRA máquina — a mesma não senta duas vezes na mesma mesa",
);
ok(bot2.body?.color !== bot1.body?.color, "com cor diferente da primeira");

// a mesma máquina PODE estar em outra sala ao mesmo tempo
const outraSala = (await rpc(A.token, "create_room", { p_game: "letreiro" })).body;
const emDuas = await rpc(A.token, "adicionar_bot", { p_room: outraSala.id, p_nivel: "medio" });
ok(emDuas.status === 200, "e a mesma máquina pode estar em várias salas ao mesmo tempo");

// dispensar
const naoBot = await rpc(A.token, "remover_bot", { p_room: salaM.id, p_seat: 0 });
ok(
  /NOT_A_BOT/.test(JSON.stringify(naoBot.body)),
  "`remover_bot` NÃO dispensa gente: sair é decisão de quem entrou",
);
const dispensou = await rpc(A.token, "remover_bot", {
  p_room: salaM.id,
  p_seat: bot2.body.seat,
});
// `remover_bot` devolve void, e o PostgREST responde 204 sem corpo: exigir 200
// aqui é exigir o que a função não promete
ok(dispensou.status < 300, `a máquina é dispensada pelo assento (${dispensou.status})`);
const assentosDepois = (
  await db.query("select seat from room_members where room_id = $1 order by seat", [salaM.id])
).rows.map((r) => r.seat);
ok(
  !assentosDepois.includes(bot2.body.seat),
  `e o assento ${bot2.body.seat} de fato vagou: sobraram ${assentosDepois.join(", ")}`,
);
const voltou = await rpc(A.token, "adicionar_bot", { p_room: salaM.id, p_nivel: "dificil" });
ok(voltou.status === 200, "e outra entra no lugar");

/* ── a partida com máquina ────────────────────────────────────────────── */

await rpc(A.token, "set_room_settings", {
  p_room: salaM.id,
  p_settings: { modo: "classico", anulacao: "gananciosa", tamanho: 4 },
});
const partidaM = (await rpc(A.token, "letreiro_start", { p_room: salaM.id })).body;
ok(!!partidaM?.id, "a partida com máquinas começa");

const jogadoresM = (
  await db.query(
    `select mp.user_id, mp.seat, p.is_bot, p.display_name, rm.bot_nivel
       from match_players mp
       join profiles p on p.id = mp.user_id
       left join room_members rm on rm.room_id = $2 and rm.user_id = mp.user_id
      where mp.match_id = $1 order by mp.seat`,
    [partidaM.id, salaM.id],
  )
).rows;
ok(
  jogadoresM.length === 3,
  `três na mesa: ${jogadoresM.map((j) => j.display_name + (j.is_bot ? " (máquina)" : "")).join(", ")}`,
);
ok(
  jogadoresM.filter((j) => j.is_bot).length === 2,
  "duas delas são máquina, e ocupam assento como qualquer um",
);

// as palavras das máquinas estão no estado privado, e são válidas
const gradeM = (
  await db.query(
    `select b.comuns, b.solution, b.max_score_comum, b.grid, b.size
       from letreiro_boards b join matches m on m.board_id = b.id where m.id = $1`,
    [partidaM.id],
  )
).rows[0];

for (const j of jogadoresM.filter((x) => x.is_bot)) {
  const priv = (
    await db.query(
      "select data from match_private_state where match_id = $1 and user_id = $2",
      [partidaM.id, j.user_id],
    )
  ).rows[0].data;
  const ws = priv.words ?? [];
  ok(ws.length > 0, `${j.display_name} (${j.bot_nivel}) recebeu ${ws.length} palavras`);
  ok(
    ws.every((w) => gradeM.comuns.includes(w.w)),
    `${j.display_name}: toda palavra dela é COMUM — a máquina jamais acha "aalênio"`,
  );
  const caminhosOk = await db.query(
    `select bool_and(public.letreiro_path_ok($1::text[], w ->> 'p', w ->> 'w', $2::int)) ok
       from jsonb_array_elements($3::jsonb) w`,
    [gradeM.grid, gradeM.size, JSON.stringify(ws)],
  );
  ok(
    caminhosOk.rows[0].ok === true,
    `${j.display_name}: todo caminho dela fecha na grade — a apuração não vai recusar nada`,
  );
  ok(
    ws.every((w, i) => i === 0 || w.em >= ws[i - 1].em),
    `${j.display_name}: as descobertas estão em ordem de tempo`,
  );
  ok(
    ws[0].pts <= ws[ws.length - 1].pts,
    `${j.display_name}: acha as fáceis primeiro (${ws[0].w} antes de ${ws[ws.length - 1].w})`,
  );
}

// o estado público tem os TEMPOS e nenhuma palavra
const publicoM = (
  await db.query("select public_state from matches where id = $1", [partidaM.id])
).rows[0].public_state;
ok(
  !!publicoM.botTempos && Object.keys(publicoM.botTempos).length === 2,
  "o estado público traz os tempos das duas máquinas",
);
const algumaPalavra = gradeM.comuns[0];
ok(
  !JSON.stringify(publicoM.botTempos).includes(algumaPalavra),
  "e NENHUMA palavra: o público sabe quantas, nunca quais — igual a uma pessoa",
);

// a pessoa joga também
const todasM = Object.entries(gradeM.solution).sort((a, b) => b[0].length - a[0].length);
await rpc(A.token, "letreiro_submit", {
  p_match: partidaM.id,
  p_word: todasM[0][0],
  p_path: todasM[0][1],
});

// e a apuração conta todo mundo, sem uma linha nova
await db.query("update matches set ends_at = now() - interval '1 second' where id = $1", [
  partidaM.id,
]);
await db.query("select public.letreiro_sweep()");

const placarM = (
  await db.query(
    `select mp.score, p.is_bot, p.display_name
       from match_players mp join profiles p on p.id = mp.user_id
      where mp.match_id = $1 order by mp.score desc`,
    [partidaM.id],
  )
).rows;
ok(
  placarM.every((l) => l.score > 0),
  `todos pontuaram: ${placarM.map((l) => l.display_name + "=" + l.score).join(", ")}`,
);
ok(
  placarM.filter((l) => l.is_bot).every((l) => l.score > 0),
  "as máquinas foram apuradas pela MESMA função que apura gente — nenhuma linha nova",
);

/* MÁQUINA NÃO SOBE DE NÍVEL.
   `letreiro_premia` percorre `match_players` e dá XP a todos — e depois das
   máquinas isso passou a incluir elas. Nestor chegou a xp=1228, com "partidas":3
   e a conquista "cem-palavras". Três coisas erradas: ela conta em contagem de
   gente, desbloqueia recompensa por esforço que não fez, e tem "melhor palavra
   da vida", que é frase sobre uma pessoa.

   O portão está em `dar_xp` e `melhor_palavra`, e não nas quatro funções de
   prêmio: corrigir nos quatro chamadores é escolher esquecer no quinto. Este
   teste guarda o portão, e vale para os quatro jogos. */
const statsBots = (
  await db.query(
    `select p.display_name, coalesce(p.stats, '{}'::jsonb) stats
       from match_players mp join profiles p on p.id = mp.user_id
      where mp.match_id = $1 and p.is_bot`,
    [partidaM.id],
  )
).rows;
ok(
  statsBots.length === 2 && statsBots.every((b) => Object.keys(b.stats).length === 0),
  `nenhuma máquina ganhou XP, nível, conquista ou recorde: ${statsBots
    .map((b) => b.display_name + "=" + JSON.stringify(b.stats))
    .join(" ")}`,
);
const gentePremiada = (
  await db.query(
    `select coalesce((p.stats ->> 'xp')::int, 0) xp
       from match_players mp join profiles p on p.id = mp.user_id
      where mp.match_id = $1 and not p.is_bot`,
    [partidaM.id],
  )
).rows;
ok(
  gentePremiada.every((g) => g.xp > 0),
  `e a gente da mesma mesa ganhou normalmente (${gentePremiada.map((g) => g.xp).join(", ")} de XP) — o portão filtra máquina, não premiação`,
);

/* ── AS ESTATÍSTICAS QUE VALEM ALGUMA COISA (PRD 02 §6.9) ─────────────

   A régua do PRD é boa: "não 'partidas jogadas'; coisas que a pessoa quer contar
   para os amigos". Duas entraram em 0094, e as duas têm uma armadilha própria.

   A PALAVRA MAIS RARA: `dict_pt.freq` é um POSTO e é NULO para a maior parte do
   dicionário. Ler nulo como "raríssima" premiaria `ababalhar` e `aaleniano` — o
   mesmo defeito que fez a revelação mostrar ONO, ADE e ADELE. Aqui se confere
   que a palavra guardada TEM posto e que ela é a de maior posto entre as achadas.

   O APROVEITAMENTO: guardado como FRAÇÃO, nunca como porcentagem, porque média
   de porcentagens não é a porcentagem da soma. */

const estat = (
  await db.query(
    `select coalesce(p.stats, '{}'::jsonb) s
       from match_players mp join profiles p on p.id = mp.user_id
      where mp.match_id = $1 and not p.is_bot
      order by mp.score desc limit 1`,
    [partidaM.id],
  )
).rows[0]?.s ?? {};

const achadas = (
  await db.query(
    /* Tudo com JOIN explícito. Misturar vírgula com JOIN faz o `join` seguinte
       se prender ao LATERAL em vez da tabela de trás, e o Postgres responde
       "invalid reference to FROM-clause entry for table mps". */
    `select w ->> 'w' palavra
       from match_private_state mps
       join match_players mp on mp.match_id = mps.match_id and mp.user_id = mps.user_id
       join profiles p on p.id = mps.user_id
       cross join lateral jsonb_array_elements(coalesce(mps.data -> 'words', '[]'::jsonb)) w
      where mps.match_id = $1 and not p.is_bot
      order by mp.score desc`,
    [partidaM.id],
  )
).rows.map((r) => r.palavra);

if (achadas.length > 0) {
  /* A COMPARAÇÃO QUE ESTE TESTE JÁ ERROU: `stats.rara` é recorde de VIDA, e
     `achadas` é uma partida. Conferir um contra o outro reprovou por
     `amentos` (posto 687.004, achada numa partida anterior desta mesma suíte)
     contra `esperanto` (89.849, achada nesta) — e a função estava certa.

     A regra que eu venho repetindo a sessão inteira vale aqui também: confere-se
     a DECISÃO onde ela mora. A política é "posto maior ganha", e ela se prova em
     três chamadas, sem depender de que palavra caiu na grade. */
  const posto0 = (
    await db.query("select stats -> 'rara' r from profiles where id = $1", [A.id])
  ).rows[0]?.r;

  /* HAVIA O QUE GUARDAR? A pergunta vem antes da asserção, e a primeira versão
     deste teste pulou essa parte — exigia que a partida SEMPRE deixasse uma
     palavra rara, e reprovou numa rodada em que nenhuma das palavras achadas
     tinha posto no corpus.

     Não era defeito da função: era o teste medindo a sorte da grade. Se nenhuma
     palavra da rodada é elegível, não guardar é o comportamento certo, e dizer
     isso na saída vale mais que reprovar. */
  const elegiveis = (
    await db.query(
      `select count(*)::int n from public.dict_pt d
        where d.norm = any($1::text[]) and d.freq is not null
          and public.palavra_apresentavel(d.norm)`,
      [achadas],
    )
  ).rows[0].n;

  if (elegiveis === 0) {
    ok(
      true,
      "nenhuma das palavras desta rodada tem posto no corpus — nada a guardar, e não guardar é o certo",
    );
  } else {
    ok(
      !!posto0?.w && Number(posto0.posto) > 0,
      posto0
        ? `a partida guardou uma palavra rara: ${posto0.w}, posto ${posto0.posto}` +
          ` (${elegiveis} elegível(is) na rodada)`
        : `havia ${elegiveis} palavra(s) elegível(is) e nenhuma foi guardada`,
    );
  }

  /* E ELA TEM POSTO DE VERDADE. Esta é a checagem que guarda a lição do
     ONO/ADE/ADELE: `freq` é nulo para a maior parte do dicionário, e ler nulo
     como "raríssima" premiaria `ababalhar` e `aaleniano`. */
  const semPosto = (
    await db.query(
      `select count(*)::int n from public.dict_pt d
        where d.norm = any($1::text[]) and d.freq is null`,
      [achadas],
    )
  ).rows[0].n;
  const postoDaGuardada = posto0
    ? (await db.query("select freq from public.dict_pt where word = $1", [posto0.w])).rows[0]
        ?.freq
    : null;
  ok(
    !posto0 || postoDaGuardada !== null,
    postoDaGuardada !== null
      ? `e ela tem posto no corpus (${semPosto} das achadas nesta grade não têm, e nenhuma delas foi escolhida)`
      : `guardou ${posto0?.w}, que o corpus nunca ouviu — ruído com cara de troféu`,
  );

  /* E O TROFÉU TEM DE SER APRESENTÁVEL (0095/0096).

     A primeira rodada de teste desta estatística guardou `sodomia`, e não foi
     azar: o seletor procura o INCOMUM, e num dicionário completo de português
     é exatamente ali que mora o palavrão. O perfil existe para ser mostrado.

     A palavra continua valendo na partida — pontua, aparece na revelação, conta
     para as conquistas. O que ela não faz é virar troféu permanente.

     E o teste confere as DUAS direções, porque uma lista de bloqueio que bloqueia
     demais é tão defeituosa quanto uma que bloqueia de menos: `cágado` e
     `trepadeira` passaram a vida de radical mal escolhido e têm de continuar
     passáveis. */
  const veredicto = {};
  for (const w of ["SODOMIA", "CARALHO", "FLOGISTO", "CAGADO", "TREPADEIRA"]) {
    veredicto[w] = (
      await db.query("select public.palavra_apresentavel($1) a", [w])
    ).rows[0].a;
  }
  ok(
    veredicto.SODOMIA === false && veredicto.CARALHO === false,
    veredicto.SODOMIA === false
      ? "palavrão não vira troféu do perfil (e continua valendo na partida)"
      : "SODOMIA passaria como a palavra mais rara do perfil de alguém",
  );
  ok(
    veredicto.FLOGISTO && veredicto.CAGADO && veredicto.TREPADEIRA,
    veredicto.CAGADO && veredicto.TREPADEIRA
      ? "e a lista não bloqueia demais: cágado, trepadeira e flogisto continuam podendo"
      : `a lista pegou palavra inocente: ${Object.entries(veredicto)
          .filter(([, v]) => !v)
          .map(([k]) => k)
          .join(", ")}`,
  );

  await db.query("select public.palavra_rara($1::uuid, 'CARALHO', 999998)", [A.id]);
  const naoEntrou = (
    await db.query("select stats -> 'rara' ->> 'w' w from profiles where id = $1", [A.id])
  ).rows[0].w;
  ok(
    naoEntrou !== "CARALHO",
    naoEntrou !== "CARALHO"
      ? "— e nem por posto altíssimo ela entra: o filtro está na apuração, antes de gravar"
      : "gravou CARALHO como troféu por ter posto alto",
  );

  /* A POLÍTICA, em três chamadas. */
  const grande = Number(posto0?.posto ?? 0) + 1000;
  await db.query("select public.palavra_rara($1::uuid, 'PARADIGMA', $2::int)", [A.id, grande]);
  const subiu = (await db.query("select stats -> 'rara' r from profiles where id = $1", [A.id]))
    .rows[0].r;
  ok(
    subiu?.w === "PARADIGMA",
    subiu?.w === "PARADIGMA"
      ? `posto maior toma o lugar (${posto0?.posto ?? 0} → ${subiu.posto})`
      : `posto maior NÃO tomou o lugar: continua ${subiu?.w}`,
  );

  await db.query("select public.palavra_rara($1::uuid, 'CASA', 95)", [A.id]);
  const naoCaiu = (await db.query("select stats -> 'rara' r from profiles where id = $1", [A.id]))
    .rows[0].r;
  ok(
    naoCaiu?.w === "PARADIGMA",
    naoCaiu?.w === "PARADIGMA"
      ? "e uma palavra comum não derruba o recorde — recorde que anda para trás não é recorde"
      : `CASA derrubou o recorde: virou ${naoCaiu?.w}`,
  );

  /* E máquina não coleciona palavra rara, pelo mesmo motivo de sempre: "a
     palavra mais rara que você já achou" é uma frase sobre uma pessoa. */
  const umBot = (
    await db.query("select id, display_name from profiles where is_bot limit 1")
  ).rows[0];
  await db.query("select public.palavra_rara($1::uuid, 'PARADIGMA', 999999)", [umBot.id]);
  await db.query("select public.aproveitamento($1::uuid, 100, 100)", [umBot.id]);
  const statsBot = (
    await db.query("select coalesce(stats, '{}'::jsonb) s from profiles where id = $1", [umBot.id])
  ).rows[0].s;
  ok(
    !statsBot.rara && !statsBot.aproveita,
    !statsBot.rara && !statsBot.aproveita
      ? `e ${umBot.display_name} não coleciona nem palavra rara nem aproveitamento`
      : `a máquina colecionou: ${JSON.stringify(statsBot)}`,
  );
}

const ap = estat.aproveita ?? {};
ok(
  Number(ap.teto) > 0 && Number(ap.pontos) >= 0 && Number(ap.melhorDen) > 0,
  ap.teto
    ? `o aproveitamento guardou fração e não porcentagem:` +
      ` melhor ${ap.melhorNum}/${ap.melhorDen}, vida ${ap.pontos}/${ap.teto}`
    : `o aproveitamento não foi creditado: ${JSON.stringify(ap)}`,
);
ok(
  Number(ap.melhorNum) <= Number(ap.melhorDen) && Number(ap.pontos) <= Number(ap.teto),
  `e nenhuma fração passa de 1 — ninguém pontua mais que o teto da grade`,
);

/* A MÉDIA É A PORCENTAGEM DA SOMA, e não a soma das porcentagens. Duas rodadas
   com tetos diferentes provam a diferença; guardar percentual arredondado daria
   outro número, e daria um número mais errado a cada rodada. */
const antesAp = { ...ap };
await db.query("select public.aproveitamento($1::uuid, 10, 100)", [A.id]);
await db.query("select public.aproveitamento($1::uuid, 90, 100)", [A.id]);
const depoisAp =
  (await db.query("select stats -> 'aproveita' a from profiles where id = $1", [A.id])).rows[0]
    ?.a ?? {};
ok(
  Number(depoisAp.teto) === Number(antesAp.teto ?? 0) + 200 &&
    Number(depoisAp.pontos) === Number(antesAp.pontos ?? 0) + 100,
  `duas rodadas somam nos totais de vida (${antesAp.pontos ?? 0}/${antesAp.teto ?? 0}` +
    ` → ${depoisAp.pontos}/${depoisAp.teto}) — e é a soma que vira média, não a média das partes`,
);
ok(
  Number(depoisAp.melhorNum) * 100 >= 90 * Number(depoisAp.melhorDen),
  `e o recorde subiu para a rodada de 90% (${depoisAp.melhorNum}/${depoisAp.melhorDen}),` +
    " comparado por multiplicação cruzada e nunca por divisão",
);

/* ── o nível significa alguma coisa? ──────────────────────────────────────
   Na MESMA grade, difícil tem de pontuar mais que médio, e médio mais que
   fácil. Sem isso, o nível é rótulo. */

const alvo = (
  await db.query(
    `select
       (select coalesce(sum((w ->> 'pts')::int), 0)
          from jsonb_array_elements(public.letreiro_bot_palavras(b.id, 42::bigint, 'facil', 180)) w) facil,
       (select coalesce(sum((w ->> 'pts')::int), 0)
          from jsonb_array_elements(public.letreiro_bot_palavras(b.id, 42::bigint, 'medio', 180)) w) medio,
       (select coalesce(sum((w ->> 'pts')::int), 0)
          from jsonb_array_elements(public.letreiro_bot_palavras(b.id, 42::bigint, 'dificil', 180)) w) dificil,
       b.max_score_comum teto
     from letreiro_boards b join matches m on m.board_id = b.id where m.id = $1`,
    [partidaM.id],
  )
).rows[0];
ok(
  Number(alvo.facil) < Number(alvo.medio) && Number(alvo.medio) < Number(alvo.dificil),
  `o nível significa algo na mesma grade: fácil ${alvo.facil} < médio ${alvo.medio} < difícil ${alvo.dificil} (teto comum ${alvo.teto})`,
);
ok(
  Number(alvo.dificil) < Number(alvo.teto),
  "e nem a difícil acha tudo — máquina imbatível não é adversário, é parede",
);

// a mesma máquina na mesma partida acha sempre as mesmas palavras
const repetivel = (
  await db.query(
    `select public.letreiro_bot_palavras(b.id, 7::bigint, 'medio', 180) =
            public.letreiro_bot_palavras(b.id, 7::bigint, 'medio', 180) igual
       from letreiro_boards b join matches m on m.board_id = b.id where m.id = $1`,
    [partidaM.id],
  )
).rows[0].igual;
ok(repetivel === true, "e o cérebro é determinístico: mesma semente, mesmas palavras");

/* ══════════════════════════════════════════════════════════════════════════
   O DESAFIO DIÁRIO

   Uma grade por dia, a mesma para todo mundo, uma tentativa. O que mais importa
   testar aqui é a DETERMINISMO da grade e a impossibilidade da segunda
   tentativa — as duas coisas que, se falharem, tornam o placar do dia uma
   ficção.
   ══════════════════════════════════════════════════════════════════════════ */

// a grade do dia é a mesma toda vez que se pergunta, e diferente entre dias
const g1 = (await db.query("select (public.letreiro_grade_do_dia('2026-03-15')).id")).rows[0].id;
const g2 = (await db.query("select (public.letreiro_grade_do_dia('2026-03-15')).id")).rows[0].id;
ok(g1 === g2, `a grade de um dia é sempre a mesma (${g1})`);

const dias = (
  await db.query(
    `select count(distinct (public.letreiro_grade_do_dia(d::date)).id) n
       from generate_series('2026-01-01'::date, '2026-03-01'::date, '1 day') d`,
  )
).rows[0].n;
ok(
  Number(dias) >= 50,
  `em 60 dias saíram ${dias} grades distintas — o dia de amanhã não repete o de hoje`,
);

const tamanho = (
  await db.query("select (public.letreiro_grade_do_dia(current_date)).size s")
).rows[0].s;
ok(
  Number(tamanho) === 4,
  "o diário é sempre 4×4: comparar placar entre tamanhos diferentes não significaria nada",
);

// abrir
const abriu = await rpc(A.token, "letreiro_diario_abrir", {});
ok(abriu.status === 200, `A abre o desafio de hoje (${JSON.stringify(abriu.body).slice(0, 80)})`);
const diario = abriu.body;
ok(Array.isArray(diario?.grid) && diario.grid.length === 16, "a grade de 16 faces veio");
ok(diario?.fechado === false && diario?.score === 0, "e a rodada está aberta, em zero");
ok(
  !JSON.stringify(diario).includes("solution"),
  "o gabarito NÃO vem — a grade é pública, o gabarito nunca",
);

// abrir de novo devolve a MESMA rodada, com o mesmo relógio
const abriu2 = await rpc(A.token, "letreiro_diario_abrir", {});
ok(
  abriu2.body?.termina_em === diario.termina_em,
  "recarregar a página não dá tempo extra: o relógio é o mesmo",
);

// e a grade é a mesma para outra pessoa no mesmo dia
const abriuB = await rpc(B.token, "letreiro_diario_abrir", {});
ok(
  JSON.stringify(abriuB.body?.grid) === JSON.stringify(diario.grid),
  "e é a MESMA grade para outra pessoa — é o ponto do desafio diário",
);

// submeter, com o gabarito lido pelo caminho de serviço
const gabaritoDia = (
  await db.query(
    `select b.solution, b.grid from public.letreiro_boards b
      where b.id = (public.letreiro_grade_do_dia((now() at time zone 'America/Sao_Paulo')::date)).id`,
  )
).rows[0];
const palavrasDia = Object.entries(gabaritoDia.solution).sort(
  (a, b) => b[0].length - a[0].length,
);
const [dw1, dp1] = palavrasDia[0];
const [dw2, dp2] = palavrasDia[1];

const env1 = await rpc(A.token, "letreiro_diario_submeter", { p_word: dw1, p_path: dp1 });
ok(env1.body?.ok === true, `A submete ${dw1} no diário (+${env1.body?.pts})`);
const rep1 = await rpc(A.token, "letreiro_diario_submeter", { p_word: dw1, p_path: dp1 });
ok(rep1.body?.reason === "REPEATED", "palavra repetida é recusada");
const falsa = await rpc(A.token, "letreiro_diario_submeter", {
  p_word: "ZZQXJ",
  p_path: "0123",
});
ok(falsa.body?.reason === "NOT_A_WORD", "palavra inexistente dá NOT_A_WORD");
const torto = await rpc(A.token, "letreiro_diario_submeter", { p_word: dw2, p_path: "0f" });
ok(torto.body?.reason === "BAD_PATH", "palavra certa por caminho errado dá BAD_PATH");

await rpc(A.token, "letreiro_diario_submeter", { p_word: dw2, p_path: dp2 });

// o placar não mostra quem ainda está jogando
const placarAberto = await rpc(A.token, "letreiro_diario_placar", {});
ok(
  Array.isArray(placarAberto.body) && placarAberto.body.length === 0,
  "quem ainda está jogando NÃO aparece no placar — o número mudaria, e contaria demais a quem não jogou",
);

// fechar
const fechou = await rpc(A.token, "letreiro_diario_fechar", {});
ok(fechou.status === 200, "A fecha a rodada");
const esperado = env1.body.pts + (await (async () => {
  const r = await db.query("select public.letreiro_pontos_palavra($1) p", [dw2]);
  return Number(r.rows[0].p);
})());
ok(
  fechou.body?.score === esperado,
  `o placar soma as duas palavras (${fechou.body?.score} = ${esperado})`,
);
ok(
  Array.isArray(fechou.body?.perdidas),
  `e a revelação traz as melhores comuns que escaparam (${(fechou.body?.perdidas ?? []).map((x) => x.w).join(", ")})`,
);

// fechar de novo não credita de novo
const xp1 = (
  await db.query("select stats -> 'diarios' n from profiles where id = $1", [A.id])
).rows[0].n;
await rpc(A.token, "letreiro_diario_fechar", {});
const xp2 = (
  await db.query("select stats -> 'diarios' n from profiles where id = $1", [A.id])
).rows[0].n;
ok(
  Number(xp1) === Number(xp2) && Number(xp1) === 1,
  `fechar duas vezes credita uma vez (diarios = ${xp2})`,
);

// e não se joga mais depois de fechado
const depois = await rpc(A.token, "letreiro_diario_submeter", { p_word: dw2, p_path: dp2 });
ok(
  /ALREADY_CLOSED/.test(JSON.stringify(depois.body)),
  "e não se submete mais nada depois de fechar — uma tentativa por dia",
);

// A SEGUNDA TENTATIVA É IMPOSSÍVEL DE GRAVAR, e não recusada por checagem
const duplicata = await db
  .query(
    `insert into public.letreiro_diario (dia, user_id, board_id, termina_em)
     values ((now() at time zone 'America/Sao_Paulo')::date, $1, $2, now())`,
    [A.id, gabaritoDia.board_id ?? 1],
  )
  .then(() => null)
  .catch((e) => e.code);
ok(
  duplicata === "23505",
  "a chave primária (dia, jogador) torna a segunda tentativa impossível de gravar, não só recusada",
);

// o placar agora mostra A, e B não (ainda não fechou)
const placarDia = await rpc(A.token, "letreiro_diario_placar", {});
ok(
  placarDia.body?.length === 1 && placarDia.body[0].score === esperado,
  `o placar do dia tem uma linha, com ${esperado} pontos`,
);
ok(placarDia.body[0].eu === true, "e marca qual linha é a de quem pediu");
ok(
  !JSON.stringify(placarDia.body).includes(dw1),
  "o placar NÃO contém as palavras de ninguém: ver as do outro tiraria a graça de quem ainda vai jogar",
);

// a tabela em si é inacessível ao cliente
const direto = await get(A.token, "letreiro_diario?select=*");
ok(
  direto.status >= 400 || (Array.isArray(direto.body) && direto.body.length === 0),
  `a tabela do diário não é legível pelo cliente (status ${direto.status})`,
);

// a faxina fecha quem estourou o relógio e não voltou
await db.query(
  `update public.letreiro_diario set termina_em = now() - interval '1 minute'
    where user_id = $1`,
  [B.id],
);
const varridos = (await db.query("select public.letreiro_diario_sweep() n")).rows[0].n;
ok(Number(varridos) >= 1, `a faxina fechou ${varridos} rodada(s) abandonada(s)`);
const placarFinal = await rpc(A.token, "letreiro_diario_placar", {});
ok(
  placarFinal.body?.length === 2,
  "e quem fechou a aba aparece no placar do dia — placar com gente faltando é placar errado",
);


/* ── O CLIENTE E O SERVIDOR CONCORDAM SOBRE O CAMINHO? ─────────────────────

   `findPath`/`areNeighbors` (lib/letreiro.ts) e `letreiro_path_ok` (PL/pgSQL)
   respondem a MESMA pergunta — "este caminho soletra esta palavra nesta grade?"
   — e não compartilham uma linha de código.

   O cliente usa a dele para DEIXAR o dedo traçar e para acender a trilha; o
   servidor usa a dele para PONTUAR. Discordando, a pessoa arrasta o dedo por um
   caminho que a tela aceitou, solta, e recebe BAD_PATH numa palavra que ela viu
   com os próprios olhos. É o pior tipo de recusa: a que parece injustiça.

   O teste não inventa caminhos: pega o GABARITO da grade — todas as palavras que
   o solver achou — e, para cada uma, faz o cliente traçar e o servidor julgar.
   Se o cliente acha um caminho, o servidor tem de aceitá-lo. E as três recusas
   clássicas (célula repetida, salto, palavra que não bate) precisam ser recusa
   nos dois.

   O `QU` é o motivo de isto não ser trivial: uma célula vale DUAS letras, então
   o casamento é por string consumida e não por índice, e é exatamente aí que
   duas implementações se desencontram. */

console.log("\nLETREIRO: o cliente e o servidor concordam sobre o caminho\n");

const { findPath, pathToString, areNeighbors, sizeOf } = await import("@/lib/letreiro");

const grades = (
  await db.query(
    "select grid, solution, size from public.letreiro_boards where usavel order by id limit 6",
  )
).rows;

let conferidas = 0;
const clienteAchouServidorNegou = [];
const clienteNaoAchou = [];

for (const g of grades) {
  const palavras = Object.keys(g.solution);
  /* Uma amostra por grade, e não todas: seis grades × ~200 palavras seriam
     1.200 idas ao banco. Trinta por grade cobre as formas que importam —
     curtas, longas, com QU — sem transformar a suíte numa espera. */
  const amostra = [
    ...palavras.filter((w) => w.includes("QU")).slice(0, 6),
    ...palavras.sort((a, b) => b.length - a.length).slice(0, 12),
    ...palavras.slice(0, 12),
  ];

  for (const palavra of [...new Set(amostra)]) {
    const caminho = findPath(g.grid, palavra);
    if (!caminho) {
      clienteNaoAchou.push(`${palavra} em [${g.grid.join("")}]`);
      continue;
    }
    const aceito = (
      await db.query("select public.letreiro_path_ok($1::text[], $2, $3, $4::int) ok", [
        g.grid,
        pathToString(caminho),
        palavra,
        g.size,
      ])
    ).rows[0].ok;
    conferidas++;
    if (!aceito) clienteAchouServidorNegou.push(`${palavra} em [${g.grid.join("")}]`);
  }
}

ok(
  clienteNaoAchou.length === 0,
  clienteNaoAchou.length === 0
    ? `o cliente traça todas as ${conferidas} palavras do gabarito que foram testadas`
    : `o cliente NÃO acha caminho para palavra do gabarito: ${clienteNaoAchou.slice(0, 3).join(" · ")}`,
);
ok(
  clienteAchouServidorNegou.length === 0,
  clienteAchouServidorNegou.length === 0
    ? `e o servidor aceita todos eles — a tela não deixa traçar o que o servidor recusa`
    : `A TELA DEIXA TRAÇAR O QUE O SERVIDOR RECUSA: ${clienteAchouServidorNegou.slice(0, 3).join(" · ")}`,
);

/* E AS TRÊS RECUSAS CLÁSSICAS, nos dois lados. */
const g0 = grades[0];
const lado = sizeOf(g0.grid);
const primeira = Object.keys(g0.solution).find((w) => w.length >= 4 && !w.includes("QU"));
const bom = findPath(g0.grid, primeira);

const celulaRepetida = [...bom.slice(0, bom.length - 1), bom[0]];
const salto = [...bom];
salto[salto.length - 1] = [...Array(g0.grid.length).keys()].find(
  (i) => !areNeighbors(salto[salto.length - 2], i, lado) && !bom.includes(i),
);

for (const [nome, caminho] of [
  ["célula repetida", celulaRepetida],
  ["salto entre c\u00e9lulas n\u00e3o vizinhas", salto],
]) {
  if (caminho.some((i) => i === undefined)) continue;
  const aceito = (
    await db.query("select public.letreiro_path_ok($1::text[], $2, $3, $4::int) ok", [
      g0.grid,
      pathToString(caminho),
      primeira,
      g0.size,
    ])
  ).rows[0].ok;
  ok(!aceito, `o servidor recusa ${nome} (${primeira})`);
}

/* ── A QUALIDADE DO POOL DE GRADES ────────────────────────────────

   Três critérios de aceite do PRD 02 §12, e nenhum deles se mede numa partida:
   eles falam do POOL inteiro, e o pool é sorteado. Uma partida só amostra uma
   grade, e amostra não prova qualidade de conjunto — é a mesma armadilha do
   "teste de sorteio mede DISTRIBUIÇÃO" que este projeto já pagou.

   O terceiro reprovou quando foi medido pela primeira vez: 72 das 866 grades de
   4×A4 sorteáveis tinham menos de três palavras de sete letras, e nove tinham
   ZERO. O Letreiro é um jogo de achar palavra longa — a pontuação cresce com o
   tamanho e a conversa depois da rodada é sempre sobre a palavra grande. Numa
   grade dessas a rodada fica plana e todo mundo acha que jogou mal. 0102 tirou
   as 72 do sorteio; este teste é o que impede a próxima de entrar. */

console.log("\nLETREIRO: a qualidade do pool\n");

const pool = (
  await db.query(
    `select size,
            count(*)::int usaveis,
            min(word_count)::int menos_palavras,
            min(public.letreiro_longas(solution, 7))::int menos_longas,
            min((select count(*) from unnest(grid) g where g ~ '^[AEIOU]'))::int menos_vogais,
            max((select count(*) from unnest(grid) g where g ~ '^[AEIOU]'))::int mais_vogais,
            count(*) filter (
              where exists (select 1 from unnest(grid) g where g ~ '[KWY]')
            )::int com_kwy
       from public.letreiro_boards
      where usavel
      group by size order by size`,
  )
).rows;

for (const b of pool) {
  ok(
    b.menos_palavras >= 60,
    `${b.size}×${b.size}: as ${b.usaveis} grades sorteáveis têm pelo menos` +
      ` ${b.menos_palavras} palavras (piso 60)`,
  );
  ok(
    b.menos_longas >= 3,
    b.menos_longas >= 3
      ? `${b.size}×${b.size}: e pelo menos ${b.menos_longas} palavras de sete letras ou mais` +
        " — com menos de três, quem achar a única ganha sozinho e o resto assiste"
      : `${b.size}×${b.size}: há grade com só ${b.menos_longas} palavra(s) longa(s)`,
  );
  ok(
    b.com_kwy === 0,
    `${b.size}×${b.size}: nenhuma grade traz K, W ou Y — letras que o português só usa em nome e estrangeirismo`,
  );
  /* A faixa de vogais escala com o tamanho, como tudo neste jogo: o PRD escreve
     "entre 5 e 9" pensando nas 16 letras do 4×4, e a proporção é o que vale. */
  const piso = b.size === 4 ? 5 : 8;
  const teto = b.size === 4 ? 9 : 14;
  ok(
    b.menos_vogais >= piso && b.mais_vogais <= teto,
    `${b.size}×${b.size}: vogais entre ${b.menos_vogais} e ${b.mais_vogais}` +
      ` (faixa ${piso}–${teto}) — pouca vogal trava, muita vira sopa`,
  );
}

/* E O `QU` É UMA FACE SÓ QUE VALE POR DUAS LETRAS.

   No dado ele ocupa uma célula — do contrário nenhuma palavra com Q caberia numa
   grade de dezesseis. Na pontuação ele conta por dois, senão QUEDA valeria menos
   que MESAS por ter "quatro" letras. */
const faces = (
  await db.query("select distinct g face from public.letreiro_boards, unnest(grid) g order by 1")
).rows.map((r) => r.face);
ok(
  faces.includes("QU") && !faces.includes("Q"),
  `o Q só aparece como face única QU (${faces.length} faces no total)`,
);
const pts = (
  await db.query(
    `select public.letreiro_pontos_palavra('QUEDA') qu,
            public.letreiro_pontos_palavra('MESAS') comum,
            public.letreiro_pontos(5) piso5`,
  )
).rows[0];
ok(
  Number(pts.qu) > Number(pts.comum),
  `e na pontuação ele vale por duas letras: QUEDA ${pts.qu} contra MESAS ${pts.comum}`,
);

/* ── AS QUATRO BANDEJAS ──────────────────────────────────────

   O tema mais barato dos quatro jogos: troca SÓ o material (PRD 07 §7). Duas
   coisas precisam ser verdade, e nenhuma delas é sobre cor:

     1. o vocabulário é FECHADO. `bandeja` podia ser texto livre, porque nada no
        servidor depende do valor — e aí um `"roxo"` que o CSS não conhece
        deixaria a mesa sem material nenhum, com o defeito aparecendo só na tela
        de quem escolheu.

     2. a escolha CONGELA na partida. É o slogan do jogo: todo mundo olha a mesma
        grade. Lida da sala, o anfitrião troca de bandeja entre duas partidas e
        quem tem a tela da anterior aberta vê outro material sob a mesma grade. */

console.log("\nLETREIRO: as quatro bandejas\n");

const salaB = (await rpc(A.token, "create_room", { p_game: "letreiro" })).body;

const aceitas = [];
for (const b of ["nogueira", "osso", "fliperama", "meridiano"]) {
  const r = await rpc(A.token, "set_room_settings", {
    p_room: salaB.id,
    p_settings: { bandeja: b },
  });
  if (r.status === 200 && r.body?.settings?.bandeja === b) aceitas.push(b);
}
ok(
  aceitas.length === 4,
  aceitas.length === 4
    ? `as quatro bandejas são aceitas e persistem: ${aceitas.join(", ")}`
    : `só ${aceitas.length} das quatro colaram: ${aceitas.join(", ") || "nenhuma"}`,
);

const inventada = await rpc(A.token, "set_room_settings", {
  p_room: salaB.id,
  p_settings: { bandeja: "roxo" },
});
ok(
  inventada.status >= 400 && /BAD_TRAY/.test(JSON.stringify(inventada.body)),
  inventada.status >= 400
    ? "e uma quinta inventada é recusada — material que o CSS não conhece é mesa sem material"
    : `o servidor aceitou \`bandeja: "roxo"\`: ${JSON.stringify(inventada.body?.settings)}`,
);

/* E a escolha chega CONGELADA na partida. */
await rpc(A.token, "set_room_settings", {
  p_room: salaB.id,
  p_settings: { bandeja: "fliperama" },
});
const iniB = await rpc(A.token, "letreiro_start", { p_room: salaB.id });
ok(
  iniB.status === 200 && iniB.body?.public_state?.tray === "fliperama",
  iniB.status === 200
    ? `a partida nasce com a bandeja escolhida (${iniB.body?.public_state?.tray})`
    : `letreiro_start falhou: ${JSON.stringify(iniB.body)}`,
);

/* Trocar a bandeja da sala DEPOIS não mexe na partida que já começou. Este é o
   teste que justifica a decisão de congelar: sem ele, "mora no estado" é uma
   preferência de estilo em vez de uma garantia. */
const trocaTarde = await rpc(A.token, "set_room_settings", {
  p_room: salaB.id,
  p_settings: { bandeja: "meridiano" },
});
const aindaFliperama = (
  await db.query("select public_state ->> 'tray' t from matches where id = $1", [
    iniB.body?.id,
  ])
).rows[0]?.t;
ok(
  aindaFliperama === "fliperama",
  aindaFliperama === "fliperama"
    ? `e trocar a bandeja da sala com partida rolando não muda a mesa de ninguém` +
      ` (recusa: ${trocaTarde.status >= 400 ? "MATCH_IN_PROGRESS" : "aceita, mas só na sala"})`
    : `a partida em curso trocou de material sozinha: virou ${aindaFliperama}`,
);

/* E a bandeja não toca em regra nenhuma: mesma grade, mesmo relógio. */
const semBandeja = iniB.body?.public_state ?? {};
ok(
  Array.isArray(semBandeja.grid) &&
    semBandeja.grid.length === 16 &&
    semBandeja.seconds === 180 &&
    semBandeja.scoring === "classica",
  `e ela não mexeu em regra nenhuma: ${semBandeja.grid?.length} letras,` +
    ` ${semBandeja.seconds}s, anulação ${semBandeja.scoring}`,
);

// faxina
for (const u of [A, B]) await admin(`/admin/users/${u.id}`, { method: "DELETE" });
await db.end();

console.log(falhas === 0 ? "\nTudo passou." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
