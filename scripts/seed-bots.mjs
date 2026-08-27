#!/usr/bin/env node
/**
 * Cria as contas das máquinas.
 *
 * Um bot é um jogador de verdade: conta, perfil, avatar, assento, cor. O
 * servidor age no lugar dele dentro de funções `security definer`, e ele nunca
 * faz login — a senha é aleatória e não é guardada em lugar nenhum.
 *
 * SÃO OITO, e oito bastam para o site inteiro. A chave de `room_members` é
 * (sala, jogador), então a mesma máquina pode estar em quantas salas quiser ao
 * mesmo tempo. O que muda por sala é o NÍVEL, que fica em
 * `room_members.bot_nivel`.
 *
 * OS NOMES. Cada uma tem nome e cara própria, e nenhuma se chama "Bot 1".
 * Sentar numa mesa com "Bot 1, Bot 2, Bot 3" é sentar numa planilha; sentar com
 * a Zulmira e o Nestor é sentar numa mesa. O custo é o mesmo e o efeito não.
 *
 * Idempotente: rodar de novo não duplica ninguém.
 *
 * Uso: npm run bots
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(root, ".env.local"), quiet: true });

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PG = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;

if (!URL_ || !SVC || !PG) {
  console.error("faltam variáveis em .env.local");
  process.exit(1);
}

/**
 * As oito. `avatar` segue a especificação de `lib/avatar.ts`, e cada uma tem
 * corpo, olhos, boca e chapéu escolhidos para ser reconhecível de relance —
 * numa mesa de seis, a diferença entre duas máquinas tem de dar na vista.
 */
const MAQUINAS = [
  {
    slug: "zulmira",
    nome: "Zulmira",
    avatar: { body: "bolha", eyes: "esperto", mouth: "sorriso", hat: "oculos", color: "vinho" },
  },
  {
    slug: "nestor",
    nome: "Nestor",
    avatar: { body: "ovo", eyes: "sono", mouth: "serio", hat: "coroa", color: "prussia" },
  },
  {
    slug: "dedeu",
    nome: "Dedeu",
    avatar: { body: "bicho", eyes: "uau", mouth: "riso", hat: "antena", color: "terracota" },
  },
  {
    slug: "guiomar",
    nome: "Guiomar",
    avatar: { body: "estrela", eyes: "brilho", mouth: "sorriso", hat: "laco", color: "ocre" },
  },
  {
    slug: "tonho",
    nome: "Tonho",
    avatar: { body: "gota", eyes: "normal", mouth: "bico", hat: "boina", color: "oliva" },
  },
  {
    slug: "creuza",
    nome: "Creuza",
    avatar: { body: "nuvem", eyes: "feliz", mouth: "sorriso", hat: "nenhum", color: "jade" },
  },
  {
    slug: "wanderley",
    nome: "Wanderley",
    avatar: { body: "ovo", eyes: "esperto", mouth: "assobio", hat: "pena", color: "grafite" },
  },
  {
    slug: "belinha",
    nome: "Belinha",
    avatar: { body: "bolha", eyes: "feliz", mouth: "lingua", hat: "laco", color: "carmim" },
  },
];

async function admin(path, opts = {}) {
  const r = await fetch(`${URL_}/auth/v1${path}`, {
    ...opts,
    headers: {
      apikey: SVC,
      Authorization: `Bearer ${SVC}`,
      "Content-Type": "application/json",
    },
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

const db = new pg.Client({ connectionString: `${PG}&uselibpqcompat=true` });
await db.connect();

console.log("\nMesa — as máquinas\n");

let criadas = 0;
let atualizadas = 0;

for (const m of MAQUINAS) {
  const email = `maquina.${m.slug}@mesa.local`;

  // já existe?
  const ja = await db.query(
    "select id from auth.users where email = $1 limit 1",
    [email],
  );

  let id = ja.rows[0]?.id ?? null;

  if (!id) {
    // senha aleatória que ninguém guarda: a máquina não faz login
    const senha = `Mq!${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
    const { status, body } = await admin("/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email,
        password: senha,
        email_confirm: true,
        user_metadata: { is_bot: true, nome: m.nome },
      }),
    });
    if (status >= 300 || !body?.id) {
      console.error(`  FALHA   ${m.nome}: ${JSON.stringify(body).slice(0, 140)}`);
      continue;
    }
    id = body.id;
    criadas++;
  } else {
    atualizadas++;
  }

  /* O perfil é gravado direto, e não por `set_profile`: aquela função age em
     nome de `auth.uid()`, e aqui não há sessão nenhuma — a máquina não faz
     login. Este script roda com a chave de serviço, que é exatamente o caso de
     uso dela. */
  await db.query(
    `insert into public.profiles (id, display_name, avatar, is_guest, is_bot)
     values ($1, $2, $3::jsonb, false, true)
     on conflict (id) do update
        set display_name = excluded.display_name,
            avatar = excluded.avatar,
            is_bot = true,
            is_guest = false`,
    [id, m.nome, JSON.stringify(m.avatar)],
  );

  console.log(`  ok      ${m.nome.padEnd(10)} ${id}`);
}

/* ── conferência ─────────────────────────────────────────────────────────── */

let falhas = 0;
function ok(cond, msg) {
  if (cond) console.log(`  ok      ${msg}`);
  else {
    falhas++;
    console.error(`  FALHA   ${msg}`);
  }
}

console.log("");

const total = await db.query("select count(*)::int n from public.profiles where is_bot");
ok(total.rows[0].n === MAQUINAS.length, `${total.rows[0].n} máquinas no banco (${MAQUINAS.length} esperadas)`);

const nomes = await db.query(
  "select display_name from public.profiles where is_bot order by display_name",
);
ok(
  new Set(nomes.rows.map((r) => r.display_name)).size === MAQUINAS.length,
  `nomes distintos: ${nomes.rows.map((r) => r.display_name).join(", ")}`,
);

const semAvatar = await db.query(
  "select count(*)::int n from public.profiles where is_bot and avatar = '{}'::jsonb",
);
ok(semAvatar.rows[0].n === 0, "toda máquina tem avatar — numa mesa de seis, elas têm de se distinguir");

/* A conferência que importa mais: uma máquina NÃO pode ser confundida com
   gente em nenhum lugar que conte jogadores. `is_guest` false e `is_bot` true
   é o par que a interface usa para decidir o que mostrar. */
const marcadas = await db.query(
  "select count(*)::int n from public.profiles where is_bot and is_guest",
);
ok(marcadas.rows[0].n === 0, "nenhuma máquina está marcada como convidado ao mesmo tempo");

await db.end();

console.log(
  `\n${criadas} criada(s), ${atualizadas} atualizada(s).` +
    (falhas ? ` ${falhas} falha(s).` : " Tudo certo.") +
    "\n",
);
process.exit(falhas === 0 ? 0 : 1);
