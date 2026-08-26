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

// faxina
for (const u of [A, B, C]) await admin(`/admin/users/${u.id}`, { method: "DELETE" });
ok(true, "usuarios de teste removidos");

console.log(falhas === 0 ? "\nTudo passou." : "\n" + falhas + " falha(s).");
process.exit(falhas === 0 ? 0 : 1);
