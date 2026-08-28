"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Room } from "@/lib/supabase/types";

/**
 * Regras da casa.
 *
 * O host não é obrigado a configurar nada — os defaults são bons e a partida
 * começa num clique. Isso fica atrás de um botão, e cada opção diz o que faz
 * com a partida em vez de só nomear a regra.
 * Ver docs/00-PRD-PLATAFORMA.md §3 (princípio 2).
 */

/**
 * A duração depende do tamanho da bandeja — 25 letras dão muito mais caminho
 * para varrer que 16, e o mesmo relógio viraria pressa em vez de desafio. Os
 * números aqui são os mesmos de `letreiro_start`; se um lado mudar, muda o
 * outro, senão a tela promete um tempo que o servidor não dá.
 */
const DURACAO: Record<number, { classico: string; relampago: string }> = {
  4: { classico: "Três minutos", relampago: "Um minuto" },
  5: { classico: "Cinco minutos", relampago: "Um minuto e meio" },
};

function modos(tamanho: number) {
  const d = DURACAO[tamanho] ?? DURACAO[4];
  return [
    { id: "classico", nome: "Clássico", nota: `${d.classico}. O padrão.` },
    {
      id: "relampago",
      nome: "Relâmpago",
      nota: `${d.relampago}. Cabe entre duas partidas.`,
    },
  ] as const;
}

const TAMANHOS = [
  {
    id: 4,
    nome: "4 × 4 — dezesseis letras",
    nota: "A bandeja clássica. Rodada curta e disputada, cabe na mão no celular.",
  },
  {
    id: 5,
    nome: "5 × 5 — vinte e cinco letras",
    nota: "Mais letra, palavra mais longa, muito mais caminho. O relógio cresce junto.",
  },
] as const;

/* ═══════════════════════════════════════════════════════════════════════════
   AS QUATRO BANDEJAS

   É a única regra da casa deste jogo que NÃO muda nada na partida — e o texto
   diz isso na cara, em vez de fingir que é uma escolha de estratégia. O que ela
   resolve é outro problema, e um real: o jogo enjoa em quatro rodadas se a mesa
   for sempre a mesma.

   A prévia é o próprio material, e não um rótulo colorido. "Osso e Areia" não
   diz nada para quem nunca viu; três retângulos com a cor da bandeja, do forro e
   do dado dizem tudo, e dizem antes de começar a partida.
   ══════════════════════════════════════════════════════════════════════════ */

const BANDEJAS = [
  {
    id: "nogueira",
    nome: "Nogueira",
    nota: "Madeira, feltro escuro e dados de baquelite creme. A mesa de sempre.",
  },
  {
    id: "osso",
    nome: "Osso e Areia",
    nota: "Couro cru sobre areia, dados de osso talhado, sol a pino. A única clara.",
  },
  {
    id: "fliperama",
    nome: "Fliperama",
    nota: "Fórmica rosa e acrílico iluminado por baixo. Barulhenta até parada.",
  },
  {
    id: "meridiano",
    nome: "Meridiano",
    nota: "Alumínio escovado e cerâmica gravada a laser, sob âmbar de tubo.",
  },
] as const;

const ANULACOES = [
  {
    id: "classica",
    nome: "Clássica",
    nota: "Palavra achada por dois vale zero para os dois. Premia achar o que ninguém acha.",
  },
  {
    id: "gananciosa",
    nome: "Gananciosa",
    nota: "Ninguém anula ninguém. Melhor quando há muita diferença de nível na mesa.",
  },
  {
    id: "bonus",
    nome: "Bônus de exclusividade",
    nota: "Todos pontuam, e quem achou sozinho leva +1 por palavra. O meio-termo.",
  },
] as const;

/* ══════════════════════════════════════════════════════════════════════════
   AS REGRAS DA CASA DA METRÓPOLE

   A decisão de produto aqui é não brigar com ninguém. As regras da casa estão
   todas disponíveis, funcionando, e cada uma diz O QUE FAZ COM A PARTIDA em
   minutos. Na prática, mostrar "+35 a +50 min" ao lado do bolão resolve a
   discussão sozinho — e o jogo não precisou proibir nada.

   O custo em minutos não é chute: sai do que cada regra faz com a economia. O
   bolão devolve à mesa dinheiro que já havia saído do jogo, e adia a quebra de
   todos ao mesmo tempo; "construir solto" antecipa a construção, que é o que
   termina a partida. Ver docs/05-PRD-METROPOLE.md §5.7.
   ══════════════════════════════════════════════════════════════════════════ */

const MODOS_MET = [
  {
    id: "metropole",
    nome: "Metrópole",
    nota: "Vinte rodadas, três propriedades sorteadas por pessoa, e ganha o maior patrimônio. Quem quebra vira Investidor.",
    tempo: "45 a 60 min",
  },
  {
    id: "classico",
    nome: "Clássico",
    nota: "Tabuleiro vazio, acaba quando sobra um, e quem quebra sai. É a experiência original, inteira e correta.",
    tempo: "90 a 120 min",
  },
  {
    id: "relampago",
    nome: "Relâmpago",
    nota: "Doze rodadas, quatro propriedades sorteadas, banco inicial maior. Cabe numa pausa de almoço.",
    tempo: "25 a 35 min",
  },
] as const;

const CASA_MET = [
  {
    id: "bolao",
    nome: "Bolão da Praça Central",
    nota: "Multas e taxas vão para um pote, e quem parar na Praça leva tudo.",
    porque:
      "É a regra da casa mais popular do mundo e a que mais alonga o jogo: devolve à mesa um dinheiro que já tinha saído da partida, e adia a quebra de todos ao mesmo tempo.",
    tempo: "+35 a +50 min",
    piora: true,
  },
  {
    id: "largadaDobrada",
    nome: "Salário dobrado na Largada",
    nota: "Parar exatamente na Largada paga o salário duas vezes.",
    porque: "Injeta pouco dinheiro, mas injeta — e todo dinheiro novo empurra o fim para longe.",
    tempo: "+10 min",
    piora: true,
  },
  {
    id: "semLeilao",
    nome: "Sem leilão",
    nota: "Quem não compra devolve a propriedade ao banco, e ela fica esperando.",
    porque:
      "Sem leilão, a fase de aquisição vira roleta: você só compra o que cai no seu dado. O tabuleiro leva 15 rodadas para se distribuir em vez de 6.",
    tempo: "+25 min",
    piora: true,
  },
  {
    id: "construirSolto",
    nome: "Construir sem o grupo completo",
    nota: "Dá para construir sem ter todas as propriedades da cor.",
    porque:
      "Encurta a partida porque a construção começa antes — mas tira o motivo de negociar, que é a melhor parte do jogo.",
    tempo: "−15 min",
    piora: false,
  },
] as const;

/* ══════════════════════════════════════════════════════════════════════════
   OS MODOS DO DOMÍNIO

   A Campanha é o padrão recomendado, e é ela que conserta os dois piores
   problemas do WAR: a partida que não acaba e quem é eliminado cedo assistindo
   uma hora. Doze rodadas, vitória por pontos, e ninguém sai.

   O Clássico continua ali inteiro, com eliminação de verdade, para quem quer a
   experiência original — e o texto diz o preço em vez de esconder.

   O Relâmpago é a Campanha em cima do mapa menor, e o texto dele diz isso: ele
   troca DUAS coisas, o mapa e o número de rodadas. Nada mais. Prometer "outro
   jeito de jogar" seria vender uma diferença que não existe — o que ele vende é
   uma hora em vez de duas, e isso é uma diferença e tanto.
   ══════════════════════════════════════════════════════════════════════════ */

const MODOS_DOM = [
  {
    id: "campanha",
    nome: "Campanha",
    nota: "Doze rodadas e ganha quem tem mais pontos. Ninguém é eliminado: quem é zerado volta na rodada seguinte com três exércitos, tomados do território mais fraco de quem está na frente. E rodada inteira sem atacar custa dois pontos.",
    tempo: "45 a 60 min",
  },
  {
    id: "classico",
    nome: "Clássico",
    nota: "Acaba quando alguém cumpre o objetivo secreto, e quem perde todos os territórios sai da partida. É a experiência original — inclusive a parte em que alguém assiste o resto da noite.",
    tempo: "60 a 90 min",
  },
  {
    id: "relampago",
    nome: "Relâmpago",
    nota: "A Campanha no sul de Vantara: 24 territórios em vez de 42, dez rodadas em vez de doze. Mesmas regras, metade do mapa — cada reforço pesa mais e ninguém tem canto para se esconder.",
    tempo: "30 a 40 min",
  },
] as const;

export function HouseRules({
  room,
  isHost,
  onChanged,
}: {
  room: Room;
  isHost: boolean;
  onChanged: (r: Room) => void;
}) {
  if (room.game_key === "metropole") {
    return <RegrasMetropole room={room} isHost={isHost} onChanged={onChanged} />;
  }
  if (room.game_key === "dominio") {
    return <RegrasDominio room={room} isHost={isHost} onChanged={onChanged} />;
  }
  if (room.game_key === "dossie") {
    return <RegrasDossie room={room} isHost={isHost} onChanged={onChanged} />;
  }
  return <RegrasLetreiro room={room} isHost={isHost} onChanged={onChanged} />;
}

/* ══════════════════════════════════════════════════════════════════════════
   O CASO DO DOSSIÊ

   A lista de casos NÃO está escrita aqui. Ela é lida do banco, de
   `game_themes`, que é público de propósito: um tema novo aparece nesta tela
   no instante em que `npm run dossie` o publica, sem uma linha de código.

   É a mesma disciplina do motor do Dossiê, que não sabe o que é uma
   "biblioteca". Se a lista estivesse cravada aqui, "tema é conteúdo e não
   engenharia" seria verdade no servidor e mentira na interface — e a interface
   é onde a pessoa vê.

   Duas opções e só duas: escolher um caso, ou surpresa. O PRD lista quatro
   modos, mas "aleatório" e "surpresa" só são diferentes se o lobby sortear
   antes e mostrar o resultado, o que nada faz hoje. Dois rótulos para o mesmo
   comportamento parece generosidade e é confusão.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * O que o lobby precisa saber de um caso publicado.
 *
 * A reviravolta vem como DUAS colunas derivadas do pacote, e não como o pacote
 * inteiro: o `data` de um tema carrega nove lugares, seis suspeitos, seis
 * objetos, a narração e o grafo. Puxar tudo isso para escrever duas linhas na
 * tela do lobby seria trocar dezenas de kilobytes por um nome e uma frase.
 */
type CasoDisponivel = {
  id: string;
  name: string;
  era: string;
  tagline: string;
  /** o nome da reviravolta deste caso, ou nulo se ele joga limpo */
  twist: string | null;
  /** e a regra dela numa frase */
  rule: string | null;
};

function RegrasDossie({
  room,
  isHost,
  onChanged,
}: {
  room: Room;
  isHost: boolean;
  onChanged: (r: Room) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [casos, setCasos] = useState<CasoDisponivel[]>([]);

  const tema = (room.settings?.tema as string) ?? "surpresa";
  /* Ligada por padrão, e o `??` é o que faz isso valer para as salas criadas
     antes desta regra existir. O servidor faz o mesmo `coalesce`; se um lado
     mudar, a tela passa a prometer o que a partida não entrega. */
  const reviravolta = (room.settings?.reviravolta as boolean | undefined) ?? true;

  useEffect(() => {
    let vivo = true;
    async function puxa() {
      const { data } = await supabaseBrowser()
        .from("game_themes")
        .select("id, name, era, tagline, twist:data->twist->>name, rule:data->twist->>rule")
        .eq("game_key", "dossie")
        .order("era");
      if (vivo && data) setCasos(data as unknown as CasoDisponivel[]);
    }
    void puxa();
    return () => {
      vivo = false;
    };
  }, []);

  async function salvar(mudanca: Record<string, unknown>) {
    setBusy(true);
    setErro(null);
    const { data, error } = await supabaseBrowser().rpc("set_room_settings", {
      p_room: room.id,
      p_settings: mudanca,
    });
    setBusy(false);
    if (error) {
      const msg = error.message ?? String(error);
      setErro(
        /MATCH_IN_PROGRESS/.test(msg)
          ? "Não dá para mudar com partida rolando."
          : /NOT_HOST/.test(msg)
            ? "Só o anfitrião escolhe o caso."
            : /BAD_THEME/.test(msg)
              ? "Esse caso não existe mais."
              : msg,
      );
      return;
    }
    onChanged(data as unknown as Room);
  }

  const escolhido = casos.find((c) => c.id === tema);
  const resumo = escolhido ? `${escolhido.name} · ${escolhido.era}` : "Caso surpresa";

  return (
    <div className="panel mt-4 p-5 sm:p-6">
      <button
        type="button"
        className="flex w-full items-baseline justify-between gap-3 text-left"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span>
          <span className="eyebrow">O caso</span>
          <span className="mt-1 block text-sm dim">{resumo}</span>
        </span>
        <span className="mono text-xs" style={{ color: "var(--vivo-amarelo)" }}>
          {open ? "fechar" : "mudar"}
        </span>
      </button>

      {open && (
        <div className="mt-5 flex flex-col gap-6">
          {!isHost && (
            <p className="text-sm dim">
              Só o anfitrião escolhe o caso. Você está vendo o que valeu para esta sala.
            </p>
          )}

          <fieldset disabled={!isHost || busy} style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="eyebrow mb-3">Qual caso</legend>
            <div className="flex flex-col gap-2">
              <Opcao
                ativo={tema === "surpresa"}
                nome="Caso surpresa"
                nota="O servidor sorteia na hora de começar. Ninguém na mesa sabe qual mundo vai abrir — nem o anfitrião."
                previa={<span className="regra-tempo">sorteio</span>}
                onClick={() => void salvar({ tema: "surpresa" })}
              />
              {casos.map((c) => (
                <Opcao
                  key={c.id}
                  ativo={tema === c.id}
                  nome={`${c.name} · ${c.era}`}
                  nota={c.tagline}
                  previa={
                    c.twist ? <span className="regra-tempo">{c.twist}</span> : undefined
                  }
                  onClick={() => void salvar({ tema: c.id })}
                />
              ))}
            </div>
          </fieldset>

          {/* A REVIRAVOLTA.

              Ligada por padrão porque é a mecânica que o sistema de temas
              entrega: um caso sem a regra dele é o Solar das Acácias com outra
              roupa. Mas o PRD 03 §3.5 promete que quem quer o jogo limpo joga o
              jogo limpo, em qualquer caso — e é este par de botões.

              A nota diz o que a regra DESTE caso faz, não "liga a reviravolta".
              O Solar das Acácias não tem nenhuma, e aí o bloco some: oferecer
              desligar o que não existe é ruído. */}
          {escolhido?.twist && (
            <fieldset disabled={!isHost || busy} style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="eyebrow mb-3">{escolhido.twist}</legend>
              <div className="flex flex-col gap-2">
                <Opcao
                  ativo={reviravolta}
                  nome="Com a reviravolta"
                  nota={escolhido.rule ?? "A regra própria deste caso."}
                  onClick={() => void salvar({ reviravolta: true })}
                />
                <Opcao
                  ativo={!reviravolta}
                  nome="Jogo limpo"
                  nota="O mesmo mundo, sem a regra própria. É o Detetive puro, no cenário deste caso."
                  onClick={() => void salvar({ reviravolta: false })}
                />
              </div>
            </fieldset>
          )}

          {casos.length === 0 && (
            <p className="text-sm dim">Carregando os casos publicados…</p>
          )}

          {erro && (
            <p className="text-sm" style={{ color: "#ffb3a7" }}>
              {erro}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function RegrasDominio({
  room,
  isHost,
  onChanged,
}: {
  room: Room;
  isHost: boolean;
  onChanged: (r: Room) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const modo = (room.settings?.modo as string) ?? "campanha";
  const oModo = MODOS_DOM.find((m) => m.id === modo);

  async function salvar(id: string) {
    setBusy(true);
    setErro(null);
    const { data, error } = await supabaseBrowser().rpc("set_room_settings", {
      p_room: room.id,
      p_settings: { modo: id },
    });
    setBusy(false);
    if (error) {
      const msg = error.message ?? String(error);
      setErro(
        /MATCH_IN_PROGRESS/.test(msg)
          ? "Não dá para mudar com partida rolando."
          : /NOT_HOST/.test(msg)
            ? "Só o anfitrião muda as regras."
            : msg,
      );
      return;
    }
    onChanged(data as unknown as Room);
  }

  return (
    <div className="panel mt-4 p-5 sm:p-6">
      <button
        type="button"
        className="flex w-full items-baseline justify-between gap-3 text-left"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span>
          <span className="eyebrow">Regras da casa</span>
          <span className="mt-1 block text-sm dim">
            {oModo?.nome} · {oModo?.tempo}
          </span>
        </span>
        <span className="mono text-xs" style={{ color: "var(--vivo-amarelo)" }}>
          {open ? "fechar" : "mudar"}
        </span>
      </button>

      {open && (
        <div className="mt-5 flex flex-col gap-6">
          {!isHost && (
            <p className="text-sm dim">
              Só o anfitrião muda as regras. Você está vendo o que valeu para esta sala.
            </p>
          )}

          <fieldset disabled={!isHost || busy} style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="eyebrow mb-3">Modo</legend>
            <div className="flex flex-col gap-2">
              {MODOS_DOM.map((m) => (
                <Opcao
                  key={m.id}
                  ativo={modo === m.id}
                  nome={m.nome}
                  nota={m.nota}
                  previa={<span className="regra-tempo">{m.tempo}</span>}
                  onClick={() => void salvar(m.id)}
                />
              ))}
            </div>
          </fieldset>

          <p className="text-sm dim">
            O Relâmpago ainda não está aqui: ele pede um mapa de 24 territórios que não existe, e
            um rótulo que o jogo não cumpre é pior que rótulo nenhum.
          </p>

          {erro && (
            <p className="text-sm" style={{ color: "#ffb3a7" }}>
              {erro}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function RegrasMetropole({
  room,
  isHost,
  onChanged,
}: {
  room: Room;
  isHost: boolean;
  onChanged: (r: Room) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const modo = (room.settings?.modo as string) ?? "metropole";
  const ligada = (id: string) => room.settings?.[id] === true;
  const quantasLigadas = CASA_MET.filter((r) => ligada(r.id)).length;

  async function salvar(patch: Record<string, unknown>) {
    setBusy(true);
    setErro(null);
    const { data, error } = await supabaseBrowser().rpc("set_room_settings", {
      p_room: room.id,
      p_settings: patch,
    });
    setBusy(false);
    if (error) {
      const msg = error.message ?? String(error);
      setErro(
        /MATCH_IN_PROGRESS/.test(msg)
          ? "Não dá para mudar com partida rolando."
          : /NOT_HOST/.test(msg)
            ? "Só o anfitrião muda as regras."
            : msg,
      );
      return;
    }
    onChanged(data as unknown as Room);
  }

  const oModo = MODOS_MET.find((m) => m.id === modo);
  const resumo = `${oModo?.nome} · ${oModo?.tempo}${
    quantasLigadas > 0 ? ` · ${quantasLigadas} regra${quantasLigadas > 1 ? "s" : ""} da casa` : ""
  }`;

  return (
    <div className="panel mt-4 p-5 sm:p-6">
      <button
        type="button"
        className="flex w-full items-baseline justify-between gap-3 text-left"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span>
          <span className="eyebrow">Regras da casa</span>
          <span className="mt-1 block text-sm dim">{resumo}</span>
        </span>
        <span className="mono text-xs" style={{ color: "var(--vivo-amarelo)" }}>
          {open ? "fechar" : "mudar"}
        </span>
      </button>

      {open && (
        <div className="mt-5 flex flex-col gap-6">
          {!isHost && (
            <p className="text-sm dim">
              Só o anfitrião muda as regras. Você está vendo o que valeu para esta sala.
            </p>
          )}

          <fieldset disabled={!isHost || busy} style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="eyebrow mb-3">Modo</legend>
            <div className="flex flex-col gap-2">
              {MODOS_MET.map((m) => (
                <Opcao
                  key={m.id}
                  ativo={modo === m.id}
                  nome={m.nome}
                  nota={m.nota}
                  previa={<span className="regra-tempo">{m.tempo}</span>}
                  onClick={() => void salvar({ modo: m.id })}
                />
              ))}
            </div>
          </fieldset>

          <fieldset disabled={!isHost || busy} style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="eyebrow mb-3">Regras da casa</legend>
            {/* A frase que faz a coisa funcionar: ninguém está proibido de
                nada, está informado. Sem isso, as etiquetas de tempo pareceriam
                repreensão em vez de informação. */}
            <p className="mb-3 text-sm dim">
              Todas desligadas por padrão. Nenhuma é proibida — cada uma diz o que faz com a
              duração da partida, e a mesa decide.
            </p>
            <div className="flex flex-col gap-2">
              {CASA_MET.map((r) => (
                <Opcao
                  key={r.id}
                  ativo={ligada(r.id)}
                  nome={r.nome}
                  nota={`${r.nota} ${r.porque}`}
                  previa={
                    <span className="regra-tempo" data-piora={r.piora}>
                      {r.tempo}
                    </span>
                  }
                  onClick={() => void salvar({ [r.id]: !ligada(r.id) })}
                />
              ))}
            </div>
          </fieldset>

          {erro && (
            <p className="text-sm" style={{ color: "#ffb3a7" }}>
              {erro}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function RegrasLetreiro({
  room,
  isHost,
  onChanged,
}: {
  room: Room;
  isHost: boolean;
  onChanged: (r: Room) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const modo = (room.settings?.modo as string) ?? "classico";
  const anulacao = (room.settings?.anulacao as string) ?? "classica";
  const tamanho = Number(room.settings?.tamanho ?? 4);
  const bandeja = (room.settings?.bandeja as string) ?? "nogueira";
  const MODOS = modos(tamanho);

  async function salvar(patch: Record<string, string | number>) {
    setBusy(true);
    setErro(null);
    /* Só o que MUDOU vai no patch. O servidor funde com o que já está na sala
       (ver 0035), então mandar o conjunto inteiro a cada clique só cria a
       chance de sobrescrever com um valor velho lido de outra aba. */
    const { data, error } = await supabaseBrowser().rpc("set_room_settings", {
      p_room: room.id,
      p_settings: patch,
    });
    setBusy(false);
    if (error) {
      setErro(
        /MATCH_IN_PROGRESS/.test(error.message)
          ? "Não dá para mudar com partida rolando."
          : /NOT_HOST/.test(error.message)
            ? "Só o anfitrião muda as regras."
            : error.message,
      );
      return;
    }
    onChanged(data as unknown as Room);
  }

  const resumo = `${tamanho}×${tamanho} · ${
    MODOS.find((m) => m.id === modo)?.nome
  } · ${BANDEJAS.find((b) => b.id === bandeja)?.nome}`;

  return (
    <div className="panel mt-4 p-5 sm:p-6">
      <button
        type="button"
        className="flex w-full items-baseline justify-between gap-3 text-left"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span>
          <span className="eyebrow">Regras da casa</span>
          <span className="mt-1 block text-sm dim">{resumo}</span>
        </span>
        <span className="mono text-xs" style={{ color: "var(--vivo-amarelo)" }}>
          {open ? "fechar" : "mudar"}
        </span>
      </button>

      {open && (
        <div className="mt-5 flex flex-col gap-6">
          {!isHost && (
            <p className="text-sm dim">
              Só o anfitrião muda as regras. Você está vendo o que valeu para esta sala.
            </p>
          )}

          <fieldset disabled={!isHost || busy} style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="eyebrow mb-3">Tamanho da bandeja</legend>
            <div className="flex flex-col gap-2">
              {TAMANHOS.map((t) => (
                <Opcao
                  key={t.id}
                  ativo={tamanho === t.id}
                  nome={t.nome}
                  nota={t.nota}
                  previa={<GradeMini lado={t.id} />}
                  onClick={() => void salvar({ tamanho: t.id })}
                />
              ))}
            </div>
          </fieldset>

          <fieldset disabled={!isHost || busy} style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="eyebrow mb-3">Duração</legend>
            <div className="flex flex-col gap-2">
              {MODOS.map((m) => (
                <Opcao
                  key={m.id}
                  ativo={modo === m.id}
                  nome={m.nome}
                  nota={m.nota}
                  onClick={() => void salvar({ modo: m.id })}
                />
              ))}
            </div>
          </fieldset>

          <fieldset disabled={!isHost || busy} style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="eyebrow mb-3">A bandeja</legend>
            <div className="flex flex-col gap-2">
              {BANDEJAS.map((b) => (
                <Opcao
                  key={b.id}
                  ativo={bandeja === b.id}
                  nome={b.nome}
                  nota={b.nota}
                  previa={<BandejaMini id={b.id} />}
                  onClick={() => void salvar({ bandeja: b.id })}
                />
              ))}
            </div>
            <p className="text-sm dim mt-2">
              Só o material muda. A grade, o relógio e as regras são os mesmos.
            </p>
          </fieldset>

          <fieldset disabled={!isHost || busy} style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="eyebrow mb-3">Palavra repetida</legend>
            <div className="flex flex-col gap-2">
              {ANULACOES.map((a) => (
                <Opcao
                  key={a.id}
                  ativo={anulacao === a.id}
                  nome={a.nome}
                  nota={a.nota}
                  onClick={() => void salvar({ anulacao: a.id })}
                />
              ))}
            </div>
          </fieldset>

          {erro && (
            <p className="text-sm" style={{ color: "#ffb3a7" }}>
              {erro}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Opcao({
  ativo,
  nome,
  nota,
  previa,
  onClick,
}: {
  ativo: boolean;
  nome: string;
  nota: string;
  /** miniatura opcional à direita — vale mais que a descrição em texto */
  previa?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className="rule-option"
      data-on={ativo}
    >
      <span className="rule-mark" aria-hidden />
      <span style={{ flex: 1 }}>
        <span className="rule-name">{nome}</span>
        <span className="rule-note">{nota}</span>
      </span>
      {previa}
    </button>
  );
}

/** A bandeja em miniatura: dá para ver a diferença sem começar a partida. */
/**
 * A prévia de uma bandeja: a bandeja, o forro e um dado.
 *
 * Ela não repete as cores em JavaScript — usa `data-bandeja`, exatamente como a
 * bandeja de verdade, e herda os mesmos seis tokens. Repetir os hexadecimais
 * aqui seria criar um segundo lugar para a cor de cada tema morar, e o dia em
 * que os dois divergissem a prévia passaria a mentir sobre o que vem depois.
 */
function BandejaMini({ id }: { id: string }) {
  return <span className="rule-bandeja" data-bandeja={id} aria-hidden />;
}

function GradeMini({ lado }: { lado: number }) {
  return (
    <span
      className="rule-grade"
      style={{ gridTemplateColumns: `repeat(${lado}, 1fr)` }}
      aria-hidden
    >
      {Array.from({ length: lado * lado }, (_, i) => (
        <span key={i} style={{ "--onda": (i % lado) + Math.floor(i / lado) } as React.CSSProperties} />
      ))}
    </span>
  );
}
