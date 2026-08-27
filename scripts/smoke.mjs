#!/usr/bin/env node
/**
 * Teste de fumaça do servidor: exercita as RPCs e o RLS contra o Supabase de
 * verdade, criando usuários pela Admin API e removendo no fim.
 *
 *   npm run smoke
 *
 * Não depende de "Anonymous sign-ins" estar ligado — por isso dá para validar
 * o servidor antes de o cliente conseguir entrar.
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";

config({ path: join(dirname(fileURLToPath(import.meta.url)), "..", ".env.local"), quiet: true });

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;

let falhas = 0;
const ok = (c, m) => {
  if (!c) falhas++;
  console.log(`${c ? "  ok    " : "  FALHA "} ${m}`);
};

async function admin(path, opts = {}) {
  const r = await fetch(`${URL_}/auth/v1${path}`, {
    ...opts,
    headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, "Content-Type": "application/json" },
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function makeUser(email) {
  const { body } = await admin("/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password: "SenhaDeTeste!2026", email_confirm: true }),
  });
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "SenhaDeTeste!2026" }),
  });
  const tok = await r.json();
  return { id: body?.id, token: tok.access_token };
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
const A = await makeUser(`teste-a-${stamp}@mesa.invalid`);
const B = await makeUser(`teste-b-${stamp}@mesa.invalid`);
const C = await makeUser(`teste-c-${stamp}@mesa.invalid`);
ok(A.token && B.token && C.token, "tres usuarios criados e autenticados");

// perfil criado pelo trigger
const pA = await get(A.token, "profiles?select=id,display_name,is_guest");
ok(pA.body?.length === 1 && pA.body[0].id === A.id, "trigger criou o perfil");

// set_profile
const sp = await rpc(A.token, "set_profile", {
  p_name: "Anfitriao",
  p_avatar: { shape: "selo", color: "jade", pattern: "raios", metal: "latao", mark: "bussola" },
});
ok(sp.status === 200 && sp.body?.display_name === "Anfitriao", "set_profile grava apelido e avatar");

// nome invalido barrado pelo CHECK
const bad = await rpc(A.token, "set_profile", { p_name: "x", p_avatar: null });
ok(bad.status >= 400, "apelido de 1 caractere e recusado pelo banco");

// create_room
const cr = await rpc(A.token, "create_room", { p_game: "letreiro" });
const room = cr.body;
ok(cr.status === 200 && /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(room?.code ?? ""),
   `create_room devolveu codigo valido (${room?.code})`);

// jogo invalido
const badGame = await rpc(A.token, "create_room", { p_game: "xadrez" });
ok(badGame.status >= 400, "game_key fora do vocabulario e recusado");

// RLS: quem nao esta na sala nao le a sala
const peek = await get(B.token, `rooms?select=code&code=eq.${room.code}`);
ok(Array.isArray(peek.body) && peek.body.length === 0, "RLS: estranho NAO le a sala");

// join_room
const jr = await rpc(B.token, "join_room", { p_code: room.code });
ok(jr.status === 200 && jr.body?.id === room.id, "join_room entra pelo codigo");

const jr2 = await rpc(B.token, "join_room", { p_code: room.code.toLowerCase() });
ok(jr2.status === 200, "join_room aceita codigo em minusculas");

const jrBad = await rpc(B.token, "join_room", { p_code: "ZZZZZZ" });
ok(jrBad.status >= 400 && /ROOM_NOT_FOUND/.test(JSON.stringify(jrBad.body)), "codigo inexistente da ROOM_NOT_FOUND");

// assentos
const mem = await get(B.token, `room_members?select=user_id,seat,role&room_id=eq.${room.id}&order=seat`);
ok(mem.body?.length === 2 && mem.body[0].seat === 0 && mem.body[0].role === "host" && mem.body[1].seat === 1,
   "assentos 0 (host) e 1 atribuidos em ordem");

// perfis visiveis entre quem divide sala
const seeProf = await get(B.token, `profiles?select=display_name&id=eq.${A.id}`);
ok(seeProf.body?.[0]?.display_name === "Anfitriao", "RLS: quem divide sala LE o perfil do outro");

const noProf = await get(C.token, `profiles?select=display_name&id=eq.${A.id}`);
ok(Array.isArray(noProf.body) && noProf.body.length === 0, "RLS: quem NAO divide sala nao le o perfil");

// cores
ok((await rpc(A.token, "set_color", { p_room: room.id, p_color: "carmim" })).status < 300, "set_color grava");
const clash = await rpc(B.token, "set_color", { p_room: room.id, p_color: "carmim" });
ok(clash.status >= 400 && /COLOR_TAKEN/.test(JSON.stringify(clash.body)), "cor repetida da COLOR_TAKEN");
ok((await rpc(B.token, "set_color", { p_room: room.id, p_color: "prussia" })).status < 300, "outra cor passa");
const badColor = await rpc(B.token, "set_color", { p_room: room.id, p_color: "rosa-choque" });
ok(badColor.status >= 400, "cor fora do vocabulario e recusada");

// pronto
ok((await rpc(A.token, "set_ready", { p_room: room.id, p_ready: true })).status < 300, "set_ready liga");
const notMember = await rpc(C.token, "set_ready", { p_room: room.id, p_ready: true });
ok(notMember.status >= 400 && /NOT_A_MEMBER/.test(JSON.stringify(notMember.body)), "quem nao e membro nao marca pronto");

// escrita direta e bloqueada
const direct = await fetch(`${URL_}/rest/v1/room_members?room_id=eq.${room.id}&user_id=eq.${B.id}`, {
  method: "PATCH",
  headers: { apikey: ANON, Authorization: `Bearer ${B.token}`, "Content-Type": "application/json", Prefer: "return=representation" },
  body: JSON.stringify({ is_ready: true, seat: 0 }),
});
const dbody = await direct.json().catch(() => null);
ok(direct.status >= 400 || (Array.isArray(dbody) && dbody.length === 0),
   `escrita direta em room_members e bloqueada (${direct.status})`);

// migracao de host: o host sai, o assento 1 assume
ok((await rpc(A.token, "leave_room", { p_room: room.id })).status < 300, "host sai da sala");
const after = await get(B.token, `rooms?select=host_id&id=eq.${room.id}`);
ok(after.body?.[0]?.host_id === B.id, "migracao de host: assento 1 virou anfitriao");
const roleNow = await get(B.token, `room_members?select=role&room_id=eq.${room.id}&user_id=eq.${B.id}`);
ok(roleNow.body?.[0]?.role === "host", "papel do novo anfitriao atualizado");

// ultimo sai -> sala apaga
ok((await rpc(B.token, "leave_room", { p_room: room.id })).status < 300, "ultimo membro sai");
const gone = await fetch(`${URL_}/rest/v1/rooms?select=id&id=eq.${room.id}`, {
  headers: { apikey: SVC, Authorization: `Bearer ${SVC}` },
});
ok((await gone.json()).length === 0, "sala vazia foi apagada");

/* ── auditoria de privilégio ──────────────────────────────────────────────
   Esta é a verificação mais importante do arquivo, e ela existe por causa de
   um erro cometido duas vezes.

   O Postgres concede EXECUTE em toda função nova ao papel PUBLIC, e o projeto
   Supabase concede também, por ALTER DEFAULT PRIVILEGES, a `anon` e
   `authenticated`. Os três grants têm de ser revogados; revogar só de PUBLIC
   parece funcionar e não funciona. Já deixou aberto `letreiro_score` (encerrar
   a rodada quando quiser), `sweep_guests` (APAGAR usuários) e, na segunda vez,
   `dominio_termina` — que recebe o estado da partida como argumento e grava,
   ou seja: escrever o mapa que quiser e se coroar vencedor.

   Em vez de confiar que eu vou lembrar de escrever as três palavras na
   próxima migração, a lista permitida está aqui e é comparada nos DOIS
   sentidos. Função nova exposta por acidente quebra o teste. Função do
   cliente trancada por acidente também. */

const PERMITIDAS = [
  // plataforma
  "create_room", "join_room", "leave_room", "set_color", "set_profile",
  "set_ready", "set_room_settings", "touch_presence",
  "adicionar_bot", "remover_bot",
  // Letreiro
  "letreiro_start", "letreiro_submit",
  "letreiro_diario_abrir", "letreiro_diario_submeter", "letreiro_diario_fechar",
  "letreiro_diario_placar",
  // Dossiê
  "dossie_accuse", "dossie_end_turn", "dossie_move", "dossie_pad",
  "dossie_pass_refute", "dossie_refute", "dossie_start", "dossie_suggest",
  // Domínio
  "dominio_atacar", "dominio_avancar", "dominio_encerrar_turno",
  "dominio_reforcar", "dominio_remanejar", "dominio_start", "dominio_trocar",
  "dominio_tocar",
  // Metrópole
  "met_bankrupt", "met_bid", "met_build", "met_buy", "met_decline", "met_end_turn",
  "met_jail", "met_mortgage", "met_pass", "met_roll", "met_sell", "met_start",
  "met_unmortgage", "met_offer", "met_offer_reply", "met_offer_cancel", "met_exercer",
  "met_aposta",
  "met_tocar",
  // auxiliares que a RLS PRECISA executar: a expressão de uma policy roda com
  // o privilégio de quem consulta, então revogar estas mata o lobby inteiro
  "is_match_member", "is_room_member", "shares_room_with",
];

const db = new pg.Client({
  connectionString:
    (process.env.POSTGRES_URL ?? process.env.DATABASE_URL) + "&uselibpqcompat=true",
});
await db.connect();

/* ── a invariante das funções `_como` ─────────────────────────────

   Toda função `_como` existe para uma coisa: RECEBER o ator em vez de
   descobri-lo. É o que deixa a máquina jogar pelas mesmas regras que uma pessoa
   sem duplicar uma linha de regra. Se uma delas olhar `auth.uid()`, ela age em
   nome de quem CHAMOU e não de quem devia — e o contrato inteiro cai.

   Isto não é hipótese: aconteceu. `met_aposta_como` gravava a aposta secreta da
   máquina no estado privado da pessoa que tocou o passo dela. O gerador de 0053
   fazia a troca mecânica certa; a premissa dele ("nenhuma dessas funções olha
   auth.uid() no corpo") é que estava errada, e eu a havia conferido numa saída
   de consulta que veio truncada.

   Uma linha de teste guarda o contrato inteiro. */

const comAuth = (
  await db.query(`
    select p.proname nome
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname like '%\\_como'
       and pg_get_functiondef(p.oid) like '%auth.uid()%'
     order by 1`)
).rows.map((r) => r.nome);

const quantasComo = (
  await db.query(`
    select count(*)::int n
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like '%\\_como'`)
).rows[0].n;

ok(
  comAuth.length === 0,
  comAuth.length === 0
    ? `as ${quantasComo} funções \`_como\` recebem o ator, nenhuma descobre por auth.uid()`
    : `\`_como\` olhando quem chamou: ${comAuth.join(", ")} — age em nome da pessoa errada`,
);

const expostas = (
  await db.query(`
    select p.proname nome
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (has_function_privilege('authenticated', p.oid, 'execute')
         or has_function_privilege('anon', p.oid, 'execute'))
     order by 1`)
).rows.map((r) => r.nome);

const sobrando = expostas.filter((f) => !PERMITIDAS.includes(f));
const faltando = PERMITIDAS.filter((f) => !expostas.includes(f));

ok(
  sobrando.length === 0,
  sobrando.length === 0
    ? `nenhuma função interna exposta ao cliente (${expostas.length} chamáveis, todas previstas)`
    : `FUNÇÃO INTERNA EXPOSTA: ${sobrando.join(", ")} — revogue de public, anon E authenticated`,
);
ok(
  faltando.length === 0,
  faltando.length === 0
    ? "toda função do cliente continua chamável"
    : `função do cliente trancada por acidente: ${faltando.join(", ")}`,
);

// e a checagem que não depende de lista: nenhuma faxina na mão de ninguém
const faxinas = expostas.filter((f) => f.endsWith("_sweep") || f.startsWith("sweep_"));
ok(faxinas.length === 0, `nenhuma rotina de faxina é chamável pelo cliente${faxinas.length ? `: ${faxinas.join(", ")}` : ""}`);

const premios = expostas.filter((f) => f.endsWith("_premia") || f === "dar_xp" || f === "melhor_palavra");
ok(premios.length === 0, `nenhuma função de crédito de XP é chamável pelo cliente${premios.length ? `: ${premios.join(", ")}` : ""}`);

await db.end();

// faxina
for (const u of [A, B, C]) await admin(`/admin/users/${u.id}`, { method: "DELETE" });
ok(true, "usuarios de teste removidos");

console.log(falhas === 0 ? "\nTudo passou." : "\n" + falhas + " falha(s).");
process.exit(falhas === 0 ? 0 : 1);
