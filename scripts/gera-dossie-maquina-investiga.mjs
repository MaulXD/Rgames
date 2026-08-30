#!/usr/bin/env node
/**
 * Gera a migração 0107 — a máquina investiga e joga as Cartas de Pista.
 *
 * Uso: node scripts/gera-dossie-maquina-investiga.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local", quiet: true });
const db = new pg.Client({
  connectionString: process.env.POSTGRES_URL_NON_POOLING + "&uselibpqcompat=true",
});
await db.connect();

async function def(nome) {
  const { rows } = await db.query(
    `select pg_get_functiondef(p.oid) d from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = $1`,
    [nome],
  );
  if (!rows.length) throw new Error(`${nome} não existe`);
  return rows[0].d.replace(/\r\n/g, "\n");
}

let bot = await def("dossie_bot_passo");
await db.end();

function troca(texto, de, para, onde) {
  if (!texto.includes(de)) throw new Error(`não achei ${onde}`);
  return texto.replace(de, para);
}

/* ── 1. declarações ───────────────────────────────────────────────────────── */

bot = troca(
  bot,
  `  passo   text;
  susp    text[];`,
  `  passo   text;
  pistasmao text[];
  alvoseat  smallint;
  tipopede  text;
  susp    text[];`,
  "as declarações do bot",
);

/* ── 2. o álibi na refutação ──────────────────────────────────────────────── */

bot = troca(
  bot,
  `        if tenho is null or array_length(tenho, 1) = 0 then
          perform public.dossie_pass_refute_como(naVez, p_match);
          return format('refuta:passa(%s)', naVez);
        end if;`,
  `        if tenho is null or array_length(tenho, 1) = 0 then
          perform public.dossie_pass_refute_como(naVez, p_match);
          return format('refuta:passa(%s)', naVez);
        end if;

        /* O ÁLIBI, e a hora certa dele.

           Guardá-lo para sempre é o mesmo que não tê-lo; gastá-lo na primeira
           refutação é jogá-lo fora. Ela usa quando tem UMA carta para mostrar e
           nunca mostrou aquela carta àquela pessoa — que é exatamente quando
           refutar entrega informação nova.

           Com duas na mão ela escolhe a repetida e não precisa do álibi. Com
           uma já mostrada, refutar não custa nada. O caso caro é este, e é o
           único em que ela paga a carta.

           Joga e passa no mesmo passo: entre uma coisa e outra o estado teria
           uma bandeira levantada sem ninguém para baixá-la, e a faxina acharia
           uma refutação pendente com álibi declarado. */
        if array_length(tenho, 1) = 1
           and exists (
             select 1 from public.match_private_state mps,
                         jsonb_array_elements_text(
                           coalesce(mps.data -> 'pistas' -> 'mao', '[]'::jsonb)) c
              where mps.match_id = p_match and mps.user_id = quem and c = 'alibi'
           )
           and not exists (
             select 1 from jsonb_array_elements(coalesce(priv -> 'mostrei', '[]'::jsonb)) m
              where m ->> 'card' = tenho[1]
                and (m ->> 'para')::smallint = (pend ->> 'bySeat')::smallint
           ) then
          perform public.dossie_usar_pista_como(naVez, p_match, 'alibi', '{}'::jsonb);
          perform public.dossie_pass_refute_como(naVez, p_match);
          return format('refuta:alibi(%s)', naVez);
        end if;`,
  "a passada por falta de carta",
);

/* ── 3. jogar as cartas, antes de palpitar ────────────────────────────────── */

bot = troca(
  bot,
  `  /* 2b. PALPITAR, se a sala em que ela está ainda é candidata.`,
  `  /* ── 2a-bis. AS CARTAS DE PISTA ─────────────────────────────────────────
     Uma por passo, e sempre a que muda mais a jogada de AGORA. A ordem abaixo é
     a ordem do valor: a chave-mestra muda ONDE ela está, e isso muda tudo o que
     vem depois.

     Cada regra é uma frase que dá para conferir de olho — nenhuma pontuação
     somada, nenhum peso. Uma máquina que joga cartas por uma fórmula que
     ninguém entende é uma máquina que ninguém consegue dizer se está
     trapaceando, e no Dossiê a suspeita de trapaça é fatal: ela TEM acesso ao
     envelope pela tabela e escolhe não olhar. */
  if est -> 'pistas' is not null and est -> 'pistas' <> 'null'::jsonb then
    select array_agg(c) into pistasmao
      from public.match_private_state mps,
           jsonb_array_elements_text(coalesce(mps.data -> 'pistas' -> 'mao', '[]'::jsonb)) c
     where mps.match_id = p_match and mps.user_id = quem;
  end if;

  if pistasmao is not null then
    /* CHAVE-MESTRA: estou num lugar que já risquei, e existe um candidato que
       não dá para alcançar andando. É a única forma de estar em dois lugares
       numa rodada, e gastá-la para andar até o vizinho seria jogá-la fora. */
    if 'chave-mestra' = any(pistasmao) and aqui is not null and not (aqui = any(sala)) then
      select s into alvo
        from unnest(sala) s
       where s <> aqui and not (s = any(fechados))
       order by ('x' || substr(md5(semente::text || assento::text || s), 1, 6))::bit(24)::int
       limit 1;
      if alvo is not null then
        perform public.dossie_usar_pista_como(
          assento, p_match, 'chave-mestra', jsonb_build_object('para', alvo));
        return format('pista(%s) chave-mestra para %s', assento, alvo);
      end if;
    end if;

    /* INTERROGATÓRIO: o tipo em que ela sabe MENOS, com quem pode saber MAIS.

       "Sabe menos" é ter mais candidatos de pé. "Pode saber mais" é o assento
       cujas cartas daquele tipo ela ainda não descartou — perguntar a quem ela
       já provou não ter nada do tipo é queimar a carta para ouvir o que já
       sabe. */
    if 'interrogatorio' = any(pistasmao) then
      tipopede := case
        when coalesce(array_length(susp, 1), 0) >= coalesce(array_length(arma, 1), 0)
         and coalesce(array_length(susp, 1), 0) >= coalesce(array_length(sala, 1), 0)
        then 'suspects'
        when coalesce(array_length(arma, 1), 0) >= coalesce(array_length(sala, 1), 0)
        then 'weapons'
        else 'rooms'
      end;

      select mp.seat into alvoseat
        from public.match_players mp
       where mp.match_id = p_match and mp.seat <> assento
       order by (
         select count(*)
           from unnest(public.dossie_cartas_do_tipo(tema, tipopede)) c
          where not coalesce(dedu -> 'naoTem' -> mp.seat::text, '[]'::jsonb)
                  @> to_jsonb(array[c])
       ) desc, mp.seat
       limit 1;

      if alvoseat is not null then
        perform public.dossie_usar_pista_como(
          assento, p_match, 'interrogatorio',
          jsonb_build_object('alvo', alvoseat, 'tipo', tipopede));
        return format('pista(%s) interroga %s sobre %s', assento, alvoseat, tipopede);
      end if;
    end if;

    /* IMPRESSÃO DIGITAL: só com TRÊS suspeitos de pé ou mais.

       Com dois, nomear os dois devolve "sim" com certeza e não ensina nada — a
       carta iria embora para confirmar o que ela já sabia. Com três, as duas
       respostas rendem, que é a promessa da carta. */
    if 'impressao' = any(pistasmao) and coalesce(array_length(susp, 1), 0) >= 3 then
      perform public.dossie_usar_pista_como(
        assento, p_match, 'impressao', jsonb_build_object('a', susp[1], 'b', susp[2]));
      return format('pista(%s) impressao %s/%s', assento, susp[1], susp[2]);
    end if;

    /* RECADO ANÔNIMO: para si mesma. Ela não faz favor.

       E só quando há novidade — o servidor recusa com RECADO_SEM_NOVIDADE, e
       uma exceção levantada aqui dentro sobe pela faxina inteira e para a mesa
       (foi assim em 0033). Perguntar antes é mais barato que tratar depois. */
    if 'recado' = any(pistasmao)
       and public.dossie_recado_para(p_match, assento) is not null then
      perform public.dossie_usar_pista_como(
        assento, p_match, 'recado', jsonb_build_object('alvo', assento));
      return format('pista(%s) recado para si', assento);
    end if;

    /* TEMPO É CURTO: por último, porque é a que menos muda a jogada de agora.
       Não custa ação e sempre rende alguma coisa, então não há o que decidir —
       o que havia era a ordem, e ela é esta. */
    if 'tempo-curto' = any(pistasmao)
       and public.dossie_next_seat(est, assento) is not null then
      perform public.dossie_usar_pista_como(assento, p_match, 'tempo-curto', '{}'::jsonb);
      return format('pista(%s) tempo-curto', assento);
    end if;
  end if;

  /* 2b. PALPITAR, se a sala em que ela está ainda é candidata.`,
  "o cabeçalho do palpite",
);

/* ── 4. investigar, entre palpitar e andar ────────────────────────────────── */

bot = troca(
  bot,
  `  /* 2c. ANDAR na direção da sala candidata mais próxima.`,
  `  /* ── 2b-bis. INVESTIGAR ─────────────────────────────────────────────────
     Com as DUAS ações na mão: ela vasculha com a primeira e anda com a segunda,
     e assim a carta não custa um passo.

     A exceção é estar presa pela tempestade, onde andar não é uma opção — e
     investigar com a única ação que sobrou é melhor que não fazer nada. Mesma
     lógica do palpite de dentro do lugar fechado: lugar fechado é posição, não
     punição, e a máquina precisa JOGAR isso, e não só sofrer.

     O lugar tem de estar vazio de gente, que é a regra do servidor; conferir
     aqui evita que LUGAR_COM_GENTE suba pela faxina e pare a mesa. */
  if est -> 'pistas' is not null and est -> 'pistas' <> 'null'::jsonb
     and aqui is not null
     and not (aqui = any(sala))
     and ((est ->> 'actionsLeft')::int >= 2
          or ((est ->> 'actionsLeft')::int >= 1 and aqui = any(fechados)))
     and coalesce((est -> 'pistas' ->> 'tirou')::int, 0)
         < coalesce(array_length(public.dossie_pistas_baralho(semente), 1), 0)
     and not exists (
       select 1 from jsonb_each_text(est -> 'positions') pos
        where pos.key <> assento::text and pos.value = aqui
     ) then
    perform public.dossie_investigar_como(assento, p_match);
    return format('investiga(%s) em %s', assento, aqui);
  end if;

  /* 2c. ANDAR na direção da sala candidata mais próxima.`,
  "o cabeçalho do andar",
);

const CABECA = readFileSync("supabase/migrations/0107_dossie_a_maquina_investiga.sql", "utf8")
  .replace(/\r\n/g, "\n");
if (CABECA.includes("dossie_bot_passo")) {
  throw new Error("o arquivo já foi gerado; parta do cabeçalho escrito à mão");
}

const sql = `${CABECA.trimEnd()}

-- ─────────────────────────────────────────────────────────────────────────────

${bot.trimEnd()};

revoke all on function public.dossie_bot_passo(uuid) from public, anon, authenticated;
`;

writeFileSync("supabase/migrations/0107_dossie_a_maquina_investiga.sql", sql, "utf8");
console.log("0107 gerado");
