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
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(raiz, ".env.local"), quiet: true });

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

/* E COM ESPAÇO. É critério de aceite da plataforma, e a razão é concreta: o
   código circula por WhatsApp, e o teclado do celular corrige, capitaliza e
   deixa espaço sobrando no fim. Quem digita "hq qg j8" com o polegar não está
   errando — está usando um celular. */
const comEspaco = await rpc(B.token, "join_room", {
  p_code: ` ${room.code.slice(0, 3)} ${room.code.slice(3)} `,
});
ok(
  comEspaco.status === 200 && comEspaco.body?.id === room.id,
  comEspaco.status === 200
    ? "e com espaço no meio e nas pontas — o código circula por mensagem, e teclado de celular põe espaço"
    : `espaço no código derruba a entrada: ${JSON.stringify(comEspaco.body)}`,
);

/* SERVIDOR E CLIENTE PRECISAM CONCORDAR sobre o que é um código.

   `sanitizeCode` em lib/games.ts é generosa: tira o que não é do alfabeto e
   dobra os glifos que se confundem à mão (I, L → 1; O → 0, e aí os dois somem,
   porque o alfabeto não os contém). O formulário e a rota `/j/[code]` passam por
   ela; o servidor não passava, e aí a mesma entrada entrava por um caminho e
   não pelo outro.

   Duas normalizações que discordam é defeito silencioso: funciona por onde a
   maioria entra e falha exatamente para quem chega diferente. Este teste
   confere as duas com as mesmas entradas embaralhadas, e é o que impede uma de
   mudar sem a outra. */
const embaralhadas = [
  room.code.toLowerCase(),
  ` ${room.code} `,
  room.code.split("").join(" "),
  room.code.split("").join("-"),
  room.code.slice(0, 3) + " " + room.code.slice(3),
];
/* Pela porta da frente, e não pelo `normaliza_codigo` direto: o que importa é
   que a PESSOA entra, e o caminho dela é `join_room`. Testar o ajudante provaria
   que o ajudante funciona, e não que quem digitou torto chega na sala. */
const discordam = [];
for (const bruto of embaralhadas) {
  const r = await rpc(B.token, "join_room", { p_code: bruto });
  if (r.status !== 200 || r.body?.id !== room.id) {
    discordam.push(`${JSON.stringify(bruto)} → ${r.status}`);
  }
}
ok(
  discordam.length === 0,
  discordam.length === 0
    ? `o servidor entende as ${embaralhadas.length} formas embaralhadas do código` +
      " — minúsculo, espaçado, com hífen e com espaço não-quebrável de copiar-e-colar"
    : `o servidor não entende: ${discordam.join(" · ")}`,
);

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
  "dossie_tocar",
  "dossie_deducoes",
  // Domínio
  "dominio_atacar", "dominio_avancar", "dominio_encerrar_turno",
  "dominio_reforcar", "dominio_remanejar", "dominio_start", "dominio_trocar",
  "dominio_tocar",
  "dominio_propor_tregua", "dominio_responder_tregua",
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
const db = new pg.Pool({
  connectionString:
    (process.env.POSTGRES_URL ?? process.env.DATABASE_URL) + "&uselibpqcompat=true",
  max: 4,
  keepAlive: true,
});
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
const consultaCrua = db.query.bind(db);
db.query = async (...args) => {
  try {
    return await consultaCrua(...args);
  } catch (e) {
    if (!CONEXAO_CAIU.test(e?.message ?? "")) throw e;
    return await consultaCrua(...args);
  }
};

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

/* ── a auditoria do `seat` ambíguo ────────────────────────────────

       column reference "seat" is ambiguous
       It could refer to either a PL/pgSQL variable or a table column.

   Em PL/pgSQL nome de variável e nome de coluna vivem no MESMO espaço, e
   `match_players.seat` existe. Então `where mp.seat = seat` não compila — o
   Postgres recusa em vez de escolher.

   Este projeto aprendeu isso três vezes: em `met_bankrupt` (0032, alias `c`
   brigando com variável `c`), no cérebro do Domínio (0049 e 0050), e de novo em
   `dominio_tocar` (0069) — essa última ao reescrever a função do zero, com a
   regra já escrita em dois arquivos de migração.

   A conclusão não é "prestar mais atenção". É que disciplina que depende de eu
   lembrar não é disciplina, é sorte — e o jeito de transformar em disciplina é
   pedir para a máquina conferir. Variável de assento se chama `assento`.

   A busca é pelo padrão exato que quebra: `<qualquer>.seat = seat`. Um `seat`
   solto num comentário ou numa string não interessa. */

const ambiguas = (
  await db.query(`
    select p.proname nome
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and pg_get_functiondef(p.oid) ~ '\\.seat\\s*=\\s*seat[^a-z_]'
     order by 1`)
).rows.map((r) => r.nome);

ok(
  ambiguas.length === 0,
  ambiguas.length === 0
    ? "nenhuma função compara `.seat = seat` — variável de assento se chama `assento`"
    : `\`seat\` ambíguo em: ${ambiguas.join(", ")} — o Postgres recusa isso em tempo de execução`,
);

/* ── a auditoria do `jsonb_set` com pai ausente ─────────────────────

       select jsonb_set('{"a":1}', array['novo','chave'], '[]', true)
       → {"a": 1}

   O quarto argumento (`create_missing`) cria só o ÚLTIMO degrau do caminho. Se a
   chave do meio não existe, `jsonb_set` devolve o objeto INTACTO — sem erro,
   sem aviso, sem nada.

   ISTO ACONTECEU QUATRO VEZES NESTE PROJETO, e cada uma delas tem um comentário
   meu explicando a armadilha, escrito algumas linhas acima de onde eu caí nela
   de novo:

     `botTempos`     a barra de tensão da máquina ficaria em zero a partida toda
     `tregProp`      o jogo dizia ter recebido a proposta e não a encontrava
     `multaReforco`  a traição continuaria de graça, com aparência de custar
     `botProp`       o teto de propostas nunca valia, e o laço de propor-recusar
                     voltava inteiro — 1170 propostas em 2400 passos

   Comentário não é mecanismo. O mecanismo é `jsonb_poe`, que faz a coisa certa e
   é mais curta de escrever do que a errada, e esta lista.

   COMO ELA FUNCIONA: toda escrita de dois níveis com chave literária é extraída
   das funções, e a primeira chave tem de estar na lista abaixo — que é a lista
   das que EXISTEM no estado inicial de algum jogo, conferida uma vez. Chave nova
   quebra o teste, e aí são dois caminhos: ou ela está garantida no estado
   inicial e entra na lista, ou usa-se `jsonb_poe`. */

const GARANTIDAS = new Set([
  // Domínio: no estado inicial de `dominio_start`
  "donos", "exercitos", "players", "pontos", "tomou", "atacou", "aguardando",
  // backfill de `dominio_ator` antes de qualquer ação
  "abates",
  // Letreiro: no estado inicial de `letreiro_start`
  "counts",
  // Metrópole: no estado inicial de `met_start`
  "props", "bank", "leilao", "cartas",
  // Dossiê
  "positions", "weapons",
  // caminhos de dois níveis sobre parâmetro, não sobre o estado da partida
  "p_est",
]);

const dedois = (
  await db.query(`
    select p.proname nome, pg_get_functiondef(p.oid) corpo
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'`)
).rows;

const suspeitas = new Map();
for (const f of dedois) {
  for (const m of f.corpo.matchAll(/jsonb_set\s*\(\s*\w+\s*,\s*array\[\s*'([a-zA-Z_]+)'\s*,/g)) {
    if (GARANTIDAS.has(m[1])) continue;
    if (!suspeitas.has(m[1])) suspeitas.set(m[1], f.nome);
  }
}

ok(
  suspeitas.size === 0,
  suspeitas.size === 0
    ? `nenhuma escrita de dois níveis sobre chave não garantida (${GARANTIDAS.size} na lista)`
    : `\`jsonb_set\` de dois níveis sobre chave que pode não existir: ` +
      [...suspeitas].map(([k, f]) => `${k} em ${f}`).join(", ") +
      " — use `jsonb_poe`, ou garanta a chave no estado inicial e entre na lista",
);

/* E O MESMO NAS SUÍTES, que é onde a armadilha se escondeu da QUINTA vez.

   O teste do Registro da Estação riscava uma carta no caderno de todo mundo com
   `jsonb_set(data, '{dedu,fora}', …)`. O `dedu` ainda não existia — a partida
   tinha acabado de começar —, o update não riscou nada, e o teste REPROVOU uma
   função que estava certa.

   Repare na direção: das cinco vezes, quatro a armadilha aprovou código errado e
   uma reprovou código certo. As duas direções fazem a mesma coisa com quem lê a
   saída — ensinam a não acreditar nela.

   Uma armadilha que a auditoria pega no servidor e não pega no teste é uma
   auditoria pela metade, porque o teste é justamente o lugar onde ninguém vai
   procurar. */

const suitesComSql = [
  "smoke.mjs", "smoke-letreiro.mjs", "smoke-dossie.mjs",
  "smoke-dominio.mjs", "smoke-metropole.mjs",
];
const nosTestes = new Map();
for (const arq of suitesComSql) {
  /* Os comentários saem antes. A primeira versão desta varredura acusou a
     PRÓPRIA DOCUMENtaÇÃO dela: o exemplo `jsonb_set('{"a":1}', array['novo',…])`
     escrito logo acima, e a explicação do defeito do `dedu`. Auditoria que
     reporta o texto que a explica é auditoria que se aprende a ignorar — a mesma
     lição do `npm run css`, que teve de tirar os comentários do CSS pelo mesmo
     motivo. */
  const texto = readFileSync(join(raiz, "scripts", arq), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
  for (const m of texto.matchAll(/jsonb_set\s*\(\s*[^,]+,\s*'\{\s*([a-zA-Z_]+)\s*,/g)) {
    if (GARANTIDAS.has(m[1])) continue;
    if (!nosTestes.has(m[1])) nosTestes.set(m[1], arq);
  }
  for (const m of texto.matchAll(/jsonb_set\s*\(\s*[^,]+,\s*array\[\s*'([a-zA-Z_]+)'\s*,/g)) {
    if (GARANTIDAS.has(m[1])) continue;
    if (!nosTestes.has(m[1])) nosTestes.set(m[1], arq);
  }
}

/* ── e o cliente não ESCREVE em tabela nenhuma ───────────────────────

   A arquitetura inteira deste projeto é "o servidor é a fonte da verdade": todo
   movimento passa por uma RPC `security definer`, e o cliente só LÊ. Até agora
   isso era garantido por disciplina — cada migração que criou tabela revogou o
   que lembrou de revogar.

   Auditando pela primeira vez, INSERT, UPDATE e DELETE estavam fechados em toda
   parte. E TRUNCATE estava ABERTO em quatro tabelas de jogo, para `anon`.

   RLS NÃO SE APLICA A TRUNCATE. Em `matches`, `anon` tinha TRUNCATE e não tinha
   SELECT: não dava para ler a tabela e dava para apagá-la.

   A causa é a de 0022, de novo: o default do projeto Supabase é
   `GRANT ALL ON TABLES` para `anon` e `authenticated`, e ALL inclui TRUNCATE,
   TRIGGER e REFERENCES. Ou seja, TODA TABELA NOVA nasce assim — e é por isso
   que a resposta certa não é revogar nas quatro (0099 fez isso) e sim ESTA
   varredura, que percorre todas e reprova a próxima.

   SELECT fica de fora: é o único privilégio de tabela que o cliente tem, e ele
   é guardado por RLS — e, em `matches`, por grant de COLUNA, com `seed`,
   `solution` e `board_id` fora da lista. */

const ESCRITA = ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "TRIGGER", "REFERENCES"];
const abertas = (
  await db.query(
    `select c.relname tabela, r.rolname papel, p.priv
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       cross join (values ('anon'), ('authenticated')) r(rolname)
       cross join unnest($1::text[]) p(priv)
      where n.nspname = 'public' and c.relkind = 'r'
        and has_table_privilege(r.rolname, 'public.' || quote_ident(c.relname), p.priv)
      order by 1, 2, 3`,
    [ESCRITA],
  )
).rows;

ok(
  abertas.length === 0,
  abertas.length === 0
    ? `nenhum papel de cliente escreve em tabela nenhuma (${ESCRITA.length} privilégios × 2 papéis, em todas as tabelas de public)`
    : `O CLIENTE PODE ESCREVER: ` +
      abertas.map((a) => `${a.papel} tem ${a.priv} em ${a.tabela}`).join(", "),
);

ok(
  nosTestes.size === 0,
  nosTestes.size === 0
    ? "e nenhuma suíte escreve dois níveis sobre chave que pode não existir"
    : `SQL de teste com a mesma armadilha: ` +
      [...nosTestes].map(([k, f]) => `${k} em ${f}`).join(", ") +
      " — um teste que não escreve o que diz escrever mede outra coisa",
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


/* ══════════════════════════════════════════════════════════════════════════
   JOGAR SOZINHO NUM TOQUE

   Antes disto, começar uma partida solo eram cinco toques: criar sala, abrir o
   painel das máquinas, chamar a primeira, chamar a segunda, começar. Cinco
   toques é a diferença entre um recurso que existe e um recurso que se usa — e
   num celular, às onze da noite, quatro deles são motivo de desistir.

   O botão "Jogar sozinho" faz a sequência inteira: cria a sala, chama as
   máquinas que aquele jogo precisa, e começa. Este teste percorre exatamente o
   que ele faz, nos QUATRO jogos — porque um caminho novo que ninguém testa é um
   caminho que quebra na primeira mudança de regra de um deles.

   E prova o que importa no fim: a pessoa cai numa partida RODANDO, com a mesa
   cheia, sem ter dito mais nada.
   ══════════════════════════════════════════════════════════════════════════ */

console.log("\n  ── jogar sozinho ──");

/* Um jogador PRÓPRIO para este bloco. O `A` do começo do arquivo já passou pelo
   teste da faxina de convidados e não tem mais perfil — e sem perfil,
   `create_room` estoura na chave estrangeira de `host_id`. Reaproveitar um
   usuário depois de testá-lo é herdar o estado que o teste deixou. */
const S = await makeUser(`teste-solo-${stamp}@mesa.invalid`);
await rpc(S.token, "set_profile", {
  p_name: "Solo",
  p_avatar: { shape: "selo", color: "jade", pattern: "raios", metal: "latao", mark: "bussola" },
});

const SOLO = [
  { jogo: "letreiro", maquinas: 1, rpc: "letreiro_start" },
  { jogo: "dossie", maquinas: 2, rpc: "dossie_start" },
  { jogo: "dominio", maquinas: 2, rpc: "dominio_start" },
  { jogo: "metropole", maquinas: 1, rpc: "met_start" },
];

for (const caso of SOLO) {
  const criada = await rpc(S.token, "create_room", { p_game: caso.jogo });
  const sala = criada.body;
  if (!sala?.id) {
    ok(false, `${caso.jogo}: create_room deu ${criada.status}`);
    continue;
  }

  let falhou = null;
  for (let i = 0; i < caso.maquinas; i++) {
    const r = await rpc(S.token, "adicionar_bot", { p_room: sala.id, p_nivel: "medio" });
    if (r.status !== 200) falhou = `adicionar_bot: ${JSON.stringify(r.body).slice(0, 110)}`;
  }

  const ini = falhou ? null : await rpc(S.token, caso.rpc, { p_room: sala.id });
  if (ini && ini.status !== 200) {
    falhou = `${caso.rpc}: ${JSON.stringify(ini.body).slice(0, 110)}`;
  }

  const partida = falhou
    ? null
    : (
        await db.query(
          `select m.status, count(mp.*)::int gente,
                  count(*) filter (where p.is_bot)::int maquinas
             from matches m
             join match_players mp on mp.match_id = m.id
             join profiles p on p.id = mp.user_id
            where m.room_id = $1
            group by m.status`,
          [sala.id],
        )
      ).rows[0];

  ok(
    !falhou && partida?.status === "running" && partida.maquinas === caso.maquinas,
    falhou
      ? `${caso.jogo}: ${falhou}`
      : `${caso.jogo}: um toque leva a uma partida rodando com ${partida?.gente} na mesa (${partida?.maquinas} máquina(s))`,
  );
}


await db.end();

// faxina
for (const u of [A, B, C]) await admin(`/admin/users/${u.id}`, { method: "DELETE" });
ok(true, "usuarios de teste removidos");

console.log(falhas === 0 ? "\nTudo passou." : "\n" + falhas + " falha(s).");
process.exit(falhas === 0 ? 0 : 1);
