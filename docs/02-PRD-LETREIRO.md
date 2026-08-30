# PRD 02 — Letreiro

> **Referência:** Boggle · **Status:** MVP da plataforma · **Jogadores:** 1–8 · **Duração:** 3–12 min

---

## 1. Pitch

Dezesseis dados de letra caem numa bandeja de madeira. Três minutos. Todo mundo olha a **mesma**
grade e caça palavras ao mesmo tempo, ligando letras vizinhas. No fim, o jogo mostra as palavras
que ninguém viu — e é aí que vem o "eu não acredito que perdi essa".

## 2. Por que este jogo é o MVP

Ele exercita **100% da infraestrutura** com **0% do risco de regras**:

| Precisa de | Letreiro exercita? |
|---|---|
| Salas, código, QR, lobby | Sim |
| Login + convidado | Sim |
| Realtime (presença, placar ao vivo) | Sim |
| Estado privado por jogador (RLS) | Sim — a lista de palavras de cada um é secreta até o fim |
| Ação autoritativa no servidor | Sim — validação de caminho e dicionário |
| Aleatoriedade determinística | Sim — sorteio dos dados |
| 3D com física | Sim — os dados caem na bandeja |
| Degradação para 2D | Sim |
| Turnos, fases, informação oculta complexa | **Não** — e é exatamente por isso que ele é o primeiro |

Não há turnos. Não há espera. Não há "o Fulano travou e ninguém pode jogar". Todos jogam simultaneamente
por 3 minutos e acabou. É o jogo com a **maior razão diversão/complexidade** dos quatro, e o
esqueleto que os outros três herdam.

E tem um bônus estratégico: Letreiro é o único dos quatro que funciona **sozinho**. Se o grupo não
juntar hoje, você joga o desafio diário. Isso é retenção que os outros três não dão.

---

## 3. Regras base

- Grade **4×4** com 16 dados de letra.
- **3 minutos** cronometrados, iguais para todos, simultâneos.
- Uma palavra é formada ligando letras **adjacentes** (8 direções, incluindo diagonais).
- **Nenhuma célula pode ser usada duas vezes na mesma palavra.**
- Mínimo **3 letras**.
- A palavra precisa existir no dicionário PT-BR.
- **Pontuação:**

| Letras | 3 | 4 | 5 | 6 | 7 | 8+ |
|---|---|---|---|---|---|---|
| Pontos | 1 | 1 | 2 | 3 | 5 | **11** |

- **Anulação (clássica):** palavra encontrada por dois ou mais jogadores vale **zero** para todos.
  Configurável — ver [Melhoria 6](#66-anulação-configurável).

---

## 4. O que ninguém faz: adaptar de verdade para o português

A maioria das implementações de Boggle em português pega a distribuição de letras do inglês e
traduz o dicionário. O resultado é injogável: grades cheias de K, W, Y e sem vogais suficientes.

Esta seção é o coração técnico do jogo.

### 4.1 Distribuição de letras

Baseada na frequência real do português brasileiro, mapeada em **96 faces** (16 dados × 6):

| Letra | Faces | | Letra | Faces | | Letra | Faces |
|---|---|---|---|---|---|---|---|
| A | 13 | | T | 4 | | G | 2 |
| E | 11 | | M | 4 | | B | 2 |
| O | 9 | | C | 4 | | H | 1 |
| S | 7 | | L | 3 | | F | 1 |
| R | 6 | | P | 3 | | **QU** | 1 |
| I | 6 | | V | 2 | | Z | 1 |
| N | 5 | | | | | J | 1 |
| D | 5 | | | | | X | 1 |
| U | 4 | | | | | | |

**Vogais: 43 de 96 (44,8%).** O Boggle inglês fica em ~30%. Português precisa de mais vogal ou a
grade não produz palavra.

**K, W e Y não existem** no conjunto. Não são letras do português para efeito de jogo.

**`QU` é uma face única**, como no Boggle original. Q sozinho em português é lixo — sempre vem
seguido de U. A face vale duas letras na contagem.

**H tem apenas 1 face.** H em português quase só aparece em dígrafos (CH, LH, NH) e no início de
poucas palavras. Mais que isso emperra a grade.

### 4.2 Os 16 dados

Cada dado é fixo — como no jogo físico. Isso garante que uma grade nunca saia toda de vogal ou toda
de consoante, o que aconteceria com sorteio livre do pool.

| Dado | Faces | | Dado | Faces |
|---|---|---|---|---|
| 1 | A E O · S R **QU** | | 9 | A E O · D T L |
| 2 | A E I · N T D | | 10 | A E I · P G Z |
| 3 | A E O · M C R | | 11 | A E O · M N S |
| 4 | A O U · S L P | | 12 | E U · R C D H |
| 5 | A E I · R D V | | 13 | O I · S T P F |
| 6 | A E O · N S T | | 14 | A O · L V G J |
| 7 | A E U · C M B | | 15 | E I · N D M X |
| 8 | A I O · S R N | | 16 | A U · S R C B |

Onze dados têm 3 vogais + 3 consoantes; cinco têm 2 vogais + 4 consoantes. As letras difíceis
(QU, Z, J, X, H, F) estão em dados **diferentes**, então nunca aparecem todas juntas.

### 4.3 Acentos, Ç e dígrafos

A grade tem apenas letras sem acento. A comparação é feita sobre a **forma normalizada**:

```ts
const normalizar = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()

// AÇÃO  → ACAO
// PÊSSEGO → PESSEGO
// CORAÇÃO → CORACAO
```

Consequências, todas intencionais:
- Digitar `ACAO` ou `AÇÃO` funciona igual. **Ninguém precisa achar o cedilha no teclado do celular.**
- `Ç` é atendido pela face `C`.
- No fim da rodada, exibimos a palavra na **grafia correta com acento** (guardamos a forma canônica),
  porque exibir "ACAO" seria feio e errado.
- Colisões de normalização (`SEDE`/`SEDE`, `CORTE`/`CÔRTE`) contam como a mesma palavra. É aceitável
  e simplifica tudo.

### 4.4 O dicionário

**Este é o risco número 1 do MVP.** Um dicionário ruim destrói o jogo de duas formas: recusa palavra
válida (raiva) ou aceita lixo (o jogo perde sentido).

**Fonte:** dicionário Hunspell `pt_BR` do projeto VERO (o que o LibreOffice usa) — arquivos `.dic` + `.aff`.

**Pipeline de construção** (roda uma vez, no build, não em runtime):

```
1. Expandir  .dic + .aff → todas as formas flexionadas (~320k palavras)
2. Filtrar   comprimento 3–16
             só [A-Z] após normalizar
             remover entradas capitalizadas no .dic (nomes próprios)
             remover abreviaturas e siglas
3. Enriquecer  cruzar com corpus de frequência (Corpus Brasileiro / subtitles)
               → cada palavra ganha um índice de raridade 1–5
4. Construir  DAWG (grafo acíclico de palavras) minimizado
5. Serializar formato binário succinto + tabela de grafias canônicas
6. Comprimir  brotli
```

**O que foi construído, e por que mudou:** o dicionário ficou **só no Postgres** — nada de DAWG no
cliente. Ao implementar, ficou claro que as duas coisas que o cliente precisa resolver na hora são
independentes do dicionário:

- **o caminho aceso enquanto você digita** é geometria pura: 16 células, busca em profundidade,
  instantâneo (`lib/letreiro.ts`);
- **a validação da palavra** só acontece ao submeter, onde 200 ms com UI otimista é imperceptível.

Isso economiza ~700 KB de download e ~40 MB de memória no celular, e nada é perdido. O DAWG no
cliente volta à mesa em v1.1, se e quando a recusa instantânea (antes de submeter) valer o custo.

**Resultado real:** 248.614 palavras em `dict_pt`, com a grafia acentuada preservada
(`ACAO → ação`). Pipeline em `scripts/build-dict.mjs` (`npm run dict`).

**Limitação conhecida da fonte:** a lista é toda minúscula, então nome próprio que virou substantivo
comum (`brasil`, `maria`) não dá para separar por caixa. Aceitar isso num Boggle não machuca;
recusar, sim. A lista curada do botão "contestar palavra" é o conserto quando incomodar.

**Curadoria manual obrigatória** antes do lançamento:
- Lista de exclusão: palavras ofensivas que não queremos ver na tela de revelação
- Lista de inclusão: gírias e regionalismos que o VOLP não tem mas todo brasileiro aceita
  (`bagulho`, `treta`, `mano`, `rolê`...). Configurável por sala em "Regras da casa": **Dicionário
  oficial** vs. **Dicionário oficial + gírias**
- Botão **"contestar palavra"** na tela de revelação, que alimenta uma fila de curadoria. Custa
  quase nada e conserta o dicionário com o uso real

### 4.5 Grades jogáveis

Uma grade sorteada às cegas pode ser terrível. Antes de entrar em jogo, ela precisa passar por um
solver:

| Critério | Faixa |
|---|---|
| Total de palavras válidas | **60 a 400** |
| Palavras de 7+ letras | **≥ 3** |
| Palavras de 8+ letras | **≥ 1** |
| Células que participam de alguma palavra de 6+ | **≥ 40%** |
| Vogais na grade | 5 a 9 (de 16) |

**Implementação:** `scripts/build-boards.mjs` (`npm run boards`) gera o pool offline e guarda em
`letreiro_boards` com o gabarito pré-computado. No início da partida o servidor sorteia uma linha
pelo `seed` — zero solver em tempo de jogo.

**Resultado real:** 1.500 grades aprovadas em 4 segundos, 40% de aproveitamento das candidatas,
63–394 palavras por grade, **3 MB** no banco. O gabarito é compacto de propósito —
`{ "CASA": "0123" }`, com o caminho em dígitos hexadecimais de índice de célula. A pontuação sai do
tamanho da chave e a grafia acentuada sai de `dict_pt` na revelação. Um gabarito verboso custaria
~40 KB por grade; este custa ~5 KB.

Vantagens: início instantâneo (zero solver em runtime), gabarito pronto para a tela de revelação,
e conseguimos ordenar grades por dificuldade para o modo Duelo.

---

## 5. O que quebra no Boggle original

Problemas reais, observados em quem joga:

| # | Problema | Consequência |
|---|---|---|
| 1 | Acaba a rodada e você nunca descobre o que perdeu | A parte mais interessante do jogo é invisível |
| 2 | Conferência manual das palavras é chata e demorada | 3 min de jogo, 5 min de conferência |
| 3 | Discussão sobre "isso é palavra?" | Mata o ritmo |
| 4 | Quem é bom ganha sempre, por muito | Desmotiva o grupo |
| 5 | Só existe um modo | Enjoa em 4 rodadas |
| 6 | No celular, digitar é lento | Desvantagem injusta por dispositivo |
| 7 | Só serve com gente | Não dá para jogar sozinho esperando o grupo |

---

## 6. Melhorias

### 6.1 A revelação — o momento que o jogo inteiro serve [v1]

**Resolve o problema #1.** É a melhoria mais importante do PRD.

Quando o cronômetro zera, não vai direto para o placar. Entra a **Revelação**, em três atos:

**Ato 1 — Conferência (≈6s).** As palavras de cada jogador aparecem em cascata, marcadas em verde
(válida), riscadas em vermelho (não existe) ou em âmbar com um símbolo de empate (anulada porque
outro achou também). Som de carimbo. Isso substitui a conferência manual inteira.

**Ato 2 — O que escapou (≈10s).** A grade fica sozinha na tela e o jogo traça, uma por uma, as
**5 melhores palavras que ninguém encontrou** — o caminho acende célula por célula, com a palavra
escrita embaixo em Fraunces grande e o valor em pontos. Ordenadas da menor para a maior, terminando
na mais valiosa da grade.

> É aqui que sai o "PUTA QUE PARIU, TINHA 'CORAÇÕES' AÍ". Este é o momento que faz alguém apertar
> Revanche.

**Ato 3 — Placar.** Pódio, destaques da rodada, botão Revanche em foco.

A grade toda é explorável depois: hover em qualquer palavra da lista completa traça o caminho.

### 6.2 Caminho aceso enquanto você digita [v1]

**Resolve o problema #6, e é o polimento que define a qualidade do jogo.**

Enquanto você digita `CASA`, a grade acende o caminho `C → A → S → A` em tempo real, com uma linha
que liga os centros das células. Se a próxima letra digitada não existir em nenhuma continuação
válida do caminho, a linha treme e a última letra fica vermelha — você sabe **na hora** que errou,
sem submeter.

Quando existe mais de um caminho possível para a mesma palavra, escolhemos o de maior pontuação
potencial (o que passa por células multiplicadoras) e permitimos alternar com `Tab`.

Custo: um trie do gabarito da grade em memória + um algoritmo de busca em profundidade sobre 16
células. Trivial. Impacto na sensação de qualidade: enorme.

### 6.3 Duas formas de entrar palavra [v1]

- **Teclado** (desktop e celular com teclado aberto): digita e `Enter`. `Backspace` volta uma letra.
  `Esc` limpa.
- **Arrastar** (celular): encosta o dedo na primeira letra e arrasta pelas vizinhas. A célula "afunda"
  e faz o estalo de baquelite, com pitch subindo a cada letra. Soltar submete.
- **Toque** (acessibilidade / mouse): tocar célula por célula. Tocar a última de novo submete.

Os três funcionam ao mesmo tempo, sem modo. Ninguém escolhe nada.

### 6.4 Tensão ao vivo, sem vazar informação [v1]

Durante os 3 minutos, cada jogador vê os outros como uma barra:

```
Duda      ████████░░░░  12 palavras
Raul      ██████░░░░░░   9 palavras
Bia       ███████████░  17 palavras   ← "a Bia tá voando"
```

**Mostra:** quantidade de palavras encontradas.
**Nunca mostra:** quais palavras, nem pontuação (que revelaria comprimento).

É pressão pura, e é impossível copiar. Enviado por Broadcast (volátil, alto volume, sem consequência) —
o caminho barato do Realtime.

### 6.5 Cinco modos [v1 parcial]

| Modo | Grade | Tempo | Notas |
|---|---|---|---|
| **Clássico** [v1] | 4×4 | 3:00 | Anulação ligada. O padrão |
| **Relâmpago** [v1] | 4×4 | 1:00 | Sem anulação. Cabe entre uma partida e outra |
| **Maratona** [v1.1] | 5×5 | 5:00 | Pontuação estendida (9+ letras = 15 pts) |
| **Duelo** [v1.1] | 4×4 | 3 × 2:00 | 1v1, melhor de 3 grades de dificuldade crescente |
| **Cooperativo** [v1.1] | 4×4 | 4:00 | Time contra uma meta de pontos calculada do gabarito. Palavras repetidas contam uma vez só. Muda tudo: agora você **quer** avisar |

### 6.6 Anulação configurável [v1]

Em "Regras da casa":

- **Clássica** (padrão): palavra achada por 2+ jogadores vale zero para todos. Recompensa achar o
  que os outros não acham.
- **Gananciosa**: ninguém anula, todo mundo pontua tudo. Melhor quando há muita diferença de nível
  no grupo — o jogador fraco não fica com zero.
- **Bônus de exclusividade**: todos pontuam, mas quem achou sozinho ganha **+1** por palavra. O
  meio-termo, e o nosso favorito.

### 6.7 Multiplicadores na grade [v1.1]

**Resolve o problema #4** — dá ao jogador mais fraco uma forma de pontuar alto com sorte e atenção.

Duas células com **letra ×2** e uma com **palavra ×3**, sorteadas junto com a grade e visíveis para
todos desde o começo. Marcadas com o dado em madeira mais clara e uma inscrição gravada em latão.

Adiciona decisão espacial real: vale mais `CASA` passando pelo ×3 do que `CASARÃO` sem passar.
Ativado por modo — Clássico fica sem, por padrão.

### 6.8 Desafio diário, para jogar sozinho [v1.1]

**Resolve o problema #7.** Uma grade por dia, igual para todo mundo, 3 minutos, uma tentativa.
Placar do seu grupo de amigos, sem ranking global. Resultado compartilhável como blocos de texto —
o padrão que o Wordle provou que funciona:

```
Letreiro #142   142 pts
🟩🟩🟩🟩🟨🟨⬜⬜   17 palavras · melhor: ESTRADA
```

Este é o mecanismo de retenção mais barato do projeto inteiro.

> **A GRADE DO DIA É UMA, E FICA ESCRITA** — migração 0110.
>
> Ela era sorteada por índice sobre o conjunto de grades sorteáveis, com o dia como semente:
> `offset (hash(dia) % quantas) order by id`. Determinístico, sim — mas determinístico sobre um
> conjunto que MUDA: `quantas` muda toda vez que `build-boards` roda, porque ele apaga as grades
> que ninguém referencia e grava outras.
>
> Duas pessoas abrindo o desafio no mesmo dia, com uma regeração de pool entre elas, jogariam
> tabuleiros diferentes e apareceriam no mesmo placar. Não é hipótese: recalibrar o dicionário
> trocou 1.801 grades por 2.409, e qualquer dia atravessado por isso teria dois desafios com o
> mesmo nome.
>
> Agora a decisão é uma linha em `letreiro_dia`: o primeiro a abrir decide, todo mundo depois lê.
> O sorteio continua igual — ele só deixou de ser a FONTE da resposta para virar o jeito de
> produzi-la na primeira vez. E a chave estrangeira impede que a grade do dia seja apagada por
> baixo, o que `build-boards` faria sem saber.

### 6.9 Estatísticas que valem alguma coisa [v1]

Não "partidas jogadas". Coisas que a pessoa quer contar para os amigos:

- **Melhor palavra da vida** (mais pontos numa única palavra) ✅
- **Palavra mais rara já encontrada** (índice de raridade do corpus) ✅
- **Aproveitamento**: seus pontos ÷ pontuação máxima da grade ✅
- **Nêmesis**: contra quem você mais anula palavra — *adiada, ver abaixo*

> **CONSTRUÍDO** — migrações 0094–0097. Três das quatro.
>
> **A RARIDADE É ENTRE AS PALAVRAS QUE O CORPUS CONHECE.** `dict_pt.freq` é um POSTO e é nulo
> para a maior parte do dicionário: a lista de frequência de fala cobre uma fração das 248.632
> palavras. Ler nulo como "raríssima" premiaria `ababalhar` e `aaleniano` — o MESMO defeito que
> fez a revelação mostrar ONO, ADE e ADELE. Sem posto, o corpus nunca ouviu a palavra, e palavra
> que ninguém diz não é troféu.
>
> **E O TROFÉU PRECISA SER APRESENTÁVEL.** A primeira rodada de teste guardou `sodomia`. Não foi
> azar: o seletor procura o INCOMUM, e num dicionário completo de português é exatamente ali que
> mora o palavrão. A palavra continua valendo na partida — pontua, aparece na revelação, conta
> para as conquistas. O que ela não faz é virar o troféu permanente do perfil, que existe para
> ser mostrado. A lista está em `data/letreiro-fora-do-trofeu.txt`, é de RADICAIS, e
> `npm run trofeu` imprime tudo o que cada um captura — porque prefixo é fácil de errar, e a
> primeira versão bloqueou `cágado` e `trepadeira`.
>
> **O APROVEITAMENTO GUARDA A FRAÇÃO, NÃO A PORCENTAGEM.** Média de porcentagens não é a
> porcentagem da soma. O servidor guarda `pontos/teto` de vida e a melhor rodada como fração
> inteira; quem divide é a tela, uma vez. Recordes são comparados por multiplicação cruzada —
> recorde decidido por arredondamento é recorde que muda sozinho.
>
> **POR QUE O NÊMESIS NÃO ENTROU.** "Contra quem você mais anula palavra" precisa de contagem
> POR PAR de jogadores. Isso não cabe em `profiles.stats`: seria um objeto que cresce sem teto
> com o id de todo mundo com quem você já jogou, dentro de um jsonb lido inteiro a cada
> carregamento de perfil — e guardar id de terceiro no registro de alguém é uma decisão de
> privacidade que merece uma tabela e uma política de RLS, não um campo que apareceu de lado.
> Meia estatística com o dado no lugar errado é pior que nenhuma, porque ela fica.

---

## 7. Anti-cheat: sendo honesto

**É impossível impedir um solver externo.** A grade está na tela da pessoa; ela pode digitá-la em um
site. Qualquer promessa contrária é falsa.

O que fazemos, na ordem certa:

**1. O cliente não decide nada.** O DAWG local dá feedback instantâneo, mas a pontuação vem de uma
revalidação completa no servidor ao fim da rodada: cada palavra é checada contra o gabarito
pré-computado da grade (existe? há caminho? o caminho é legal?) e contra a janela de tempo.

**2. Detecção comportamental**, com quatro sinais:

| Sinal | Limiar |
|---|---|
| Palavras submetidas em ordem decrescente de pontuação | ≥ 8 seguidas |
| Variância do intervalo entre submissões | < 15% em ≥ 10 submissões |
| Taxa sustentada | > 25 palavras/min por mais de 60s |
| Proporção de palavras de raridade 5 | > 40% da lista |

**3. A resposta é social, não automática.** Grupo de amigos não precisa de banimento. Dois ou mais
sinais disparados → um ícone discreto ao lado do nome no placar, com tooltip
*"Ritmo suspeito de solver"*, visível para todos. Ninguém é punido. O grupo resolve. Funciona melhor
que qualquer algoritmo.

**4. Modo Confiança** em "Regras da casa": desliga a detecção inteira. Padrão ligado.

---

## 8. Fluxo de partida

```
LOBBY
  │ host aperta Começar
  ▼
PREPARO  (4s, não pulável)
  │ • servidor sorteia grade do pool pelo seed, grava public_state
  │ • os 16 dados 3D caem na bandeja de feltro, batem, rolam e param
  │   nas faces que o servidor decidiu (§8.7 do PRD 00)
  │ • câmera desce de 3/4 para topdown
  │ • contagem 3 · 2 · 1 em latão
  ▼
RODADA  (tempo do modo)
  │ • todos jogam ao mesmo tempo, sem turno
  │ • cada palavra aceita vai para match_private_state (RLS: só o dono lê)
  │ • Broadcast a cada palavra: { seat, count } — só a contagem
  │ • últimos 10s: borda da bandeja pulsa em laca, cronômetro em vermelho,
  │   som de metrônomo acelerando
  ▼
REVELAÇÃO  (≈20s, pulável pelo host)
  │ Ato 1 conferência · Ato 2 o que escapou · Ato 3 placar
  ▼
PLACAR
  │ Revanche (nova grade, mesma sala) · Mesma grade (pra tirar a teima) · Trocar de jogo
  ▼
LOBBY
```

**Reconexão:** entrar no meio da rodada devolve a grade, o cronômetro sincronizado e a sua lista
de palavras. Não há estado a perder.

---

## 9. Modelo de dados

```jsonc
// matches.public_state
{
  "mode": "classico",
  "grid": ["C","A","S","A", "R","E","T","O", ...],   // 16 ou 25, já sorteados
  "size": 4,
  "bonus": { "letter2x": [5, 11], "word3x": [9] },   // índices de célula, ou null
  "startedAt": "2026-08-26T22:10:04.120Z",
  "endsAt":    "2026-08-26T22:13:04.120Z",
  "counts":    { "0": 12, "1": 9, "2": 17 },          // só quantidade, por assento
  "phase": "round"                                    // prep | round | reveal | scored
}
```

```jsonc
// match_private_state.data  — RLS: user_id = auth.uid()
{
  "words": [
    { "w": "CASA",  "path": [0,1,2,3], "at": 1740609012345 },
    { "w": "RETO",  "path": [4,5,6,7], "at": 1740609019801 }
  ]
}
```

```jsonc
// letreiro_boards — pool pré-computado, sem policy de leitura para o cliente
{
  "id": 3187,
  "grid": [...],
  "difficulty": 3,
  "solution": {
    "CASA":     { "paths": [[0,1,2,3]], "pts": 1, "rarity": 1 },
    "ESTRADA":  { "paths": [[...]],     "pts": 5, "rarity": 2 }
  },
  "maxScore": 214,
  "wordCount": 187
}
```

### Ações (RPC)

| RPC | Quem | Faz |
|---|---|---|
| `letreiro_start(match_id)` | host | Sorteia grade pelo seed, escreve `public_state`, define `endsAt` |
| `letreiro_submit(match_id, word, path)` | jogador | Valida janela de tempo + caminho contíguo + célula não repetida. **Não** valida dicionário aqui (é otimista). Grava no `private_state`. Broadcast da contagem |
| `letreiro_score(match_id)` | `pg_cron` ao estourar `endsAt` | Revalida tudo contra o gabarito, aplica anulação, calcula pontos, monta a Revelação, grava `public_state` + `match_events` |

Note que `letreiro_score` roda no servidor por cron, **não** por chamada do cliente. Ninguém pode
atrasar ou antecipar o fim da rodada.

---

## 10. Direção de arte

Paleta e materiais completos em [Direção de Arte §3.3](01-DIRECAO-DE-ARTE.md#letreiro--madeira-e-baquelite).

**A cena:** uma bandeja de nogueira com forro de feltro cinza-azulado, vista de cima, iluminada por
uma luz lateral única e quente. Dezesseis dados de baquelite creme com as letras **gravadas e
preenchidas com tinta preta** — não impressas, gravadas: há uma sombra dentro do sulco.

**3D:** os 16 dados são uma única `InstancedMesh`. Física com Rapier só nos 4 segundos de preparo;
depois disso os corpos rígidos são removidos e ficam meshes estáticas. Custo total da cena: ~340 KB.

**Seleção:** a célula tocada **afunda 1,5mm** com `spring.snap` e a sombra de contato encurta. Não é
um `outline` colorido — é o dado sendo pressionado. A linha do caminho é um `<path>` SVG por cima do
canvas, com `stroke-dasharray` animado, na cor da tinta com 70% de opacidade.

**Palavra válida:** flash de verde-limão `--let-hit` na trilha, 400ms, `ease.out`, e a palavra sobe
da grade para a lista lateral em arco. Palavra inválida: a trilha treme 6px em 120ms, som abafado,
sem cor de erro gritante — errar tem que ser barato.

**Cronômetro:** JetBrains Mono, `tabular-nums`, gravado numa placa de latão na borda da bandeja.
Nos últimos 10 segundos ganha um pulso vermelho de laca e o metrônomo acelera.

**Tela de revelação:** fundo escurece para `--let-felt`, a grade fica isolada no centro com uma luz
de spot, e cada palavra perdida é traçada com uma linha de tinta que "escreve" ao longo do caminho.
A palavra aparece embaixo em Fraunces 49px, `WONK 1`.

**Som:** estalo de baquelite por letra (pitch +2% por letra da palavra atual), acorde ascendente de
2 notas na palavra válida, nota abafada na inválida, dados de madeira caindo no preparo, carimbo na
conferência.

---

## 11. Escopo

### v1 — o lançamento
- Grade 4×4, modos Clássico e Relâmpago
- Dicionário PT-BR completo com normalização de acento e curadoria inicial
- Pool de 5.000 grades pré-aprovadas
- Entrada por teclado, arrastar e toque
- Caminho aceso ao digitar
- Barras de tensão ao vivo
- Revelação em 3 atos
- Anulação: as três variantes
- Dados 3D com física + fallback 2D
- Estatísticas ✅: melhor palavra, palavra mais rara, aproveitamento
- **As quatro bandejas** ✅: Nogueira, Osso e Areia, Fliperama, Meridiano — mesmo código, só
  material e paleta ([PRD 07 §7](07-SISTEMA-DE-TEMAS.md#7-temas-nos-outros-três-jogos)). Seis
  tokens de CSS, escolhíveis nas Regras da Casa, e a escolha congela no estado da partida. O SOM
  ainda é o mesmo nas quatro: a trilha do Letreiro não tem eixo de material como a do Dossiê tem
  de clima, e inventar um só para isto seria fazer engenharia para caber num item de lista
- Revanche e "mesma grade"

### v1.1
- Maratona 5×5, Duelo, Cooperativo
- Multiplicadores na grade
- Desafio diário + compartilhamento
- Nêmesis e palavra mais rara
- Contestação de palavra com fila de curadoria

### Futuro
- Modo "tema": só palavras de um campo semântico valem dobrado
- Grade hexagonal
- Torneio de 5 grades com pontuação acumulada

---

## 12. Critérios de aceite

**Regras**
- [x] `AÇÃO` e `ACAO` são a mesma palavra e ambas são aceitas — o dicionário guarda as duas
      formas em colunas separadas (`norm` sem acento, `word` com), e o gabarito casa pela primeira
- [x] A palavra aparece com acento correto na tela de revelação
- [x] `QU` conta como duas letras na pontuação — e ocupa UMA face no dado, senão nenhuma palavra
      com Q caberia numa grade de dezesseis
- [x] Reusar a mesma célula na mesma palavra é rejeitado — mesmo caminho de código do BAD_PATH
- [x] Caminho não contíguo é rejeitado pelo servidor mesmo se o cliente aceitar — palavra que
      EXISTE, com caminho inválido, dá BAD_PATH
- [x] Palavra submetida depois de `endsAt` não conta

**Grade**
- [x] Todas as grades sorteáveis com ≥60 palavras e ≥3 de 7+ — o pool INTEIRO, e não uma amostra
      de 100: amostra não prova qualidade de conjunto. Reprovou na primeira medição (72 de 866
      grades de 4×4 tinham menos de três palavras longas, e nove tinham zero) e 0102 as tirou do
      sorteio
- [x] Nenhuma grade com menos de 5 ou mais de 9 vogais no 4×4 — e 8 a 14 no 5×5, porque a faixa
      escala com o tamanho como tudo neste jogo
- [x] Nunca aparecem `K`, `W` ou `Y` — 23 faces no pool inteiro, e nenhuma das três

**Dicionário**
- [x] Lista de 200 palavras comuns do dia a dia brasileiro: 100% aceitas — são 240, em
      `data/letreiro-dia-a-dia.txt`, e todas passam
- [x] Lista de 100 não-palavras plausíveis (`CASARO`, `MENTO`): 100% rejeitadas — são 101, em
      `data/letreiro-nao-palavras.txt`

  > **Este par achou um defeito grande.** Ao ser escrito, 10 das 240 não estavam no dicionário —
  > SOPA, ESQUINA, TROCO, AMIGA, AMANHÃ, ANTES, VAZIO, CERTO, ERRADO, CALMO. Medindo o buraco de
  > verdade: das **cinco mil formas mais faladas do português brasileiro com 3 a 7 letras, 41,6%
  > eram recusadas**, e 27% já nos quinhentos primeiros postos.
  >
  > A causa: o `.dic` do Hunspell é uma lista de LEMAS com marcas de flexão. `sopa` não está lá;
  > está `sopar/ajkLMY`, e a marca `a` a gera. O build descartava as marcas. Agora expande —
  > `scripts/afixos.mjs` — e sobram 8% de recusa indevida, quase toda nome inglês de legenda.
  >
  > **E duas colisões de normalização estavam calando as palavras erradas.** PÃO e PAÓ colidem em
  > PAO; o desempate era por contagem de acentos, empatava, e caía na ordem da fonte — o
  > dicionário guardava `paó`. Pior: a lista curada casava por NORMA, então a entrada `caó` estava
  > escondendo **cão** (posto 1269) da revelação, e `paó` escondia **pão**. Trinta e quatro
  > entradas estavam nessa situação. A colisão passou a ser resolvida pelo corpus — a grafia que
  > as pessoas escrevem — e a lista curada passou a casar por grafia.
  >
  > **Custo medido:** o dicionário foi de 248 mil para 1,54 milhão de formas, e o banco de 62 MB
  > para 213 MB. O teto de tamanho caiu de 16 para 13 letras, que é a MAIOR palavra que já
  > apareceu em mil e oitocentas grades geradas — cortar ali não perde nenhuma palavra que o jogo
  > já foi capaz de oferecer, e evita 400 mil linhas.
- [ ] Nome próprio (`BRASIL`, `MARIA`) é rejeitado — **não é.** As duas estão no dicionário e
      pontuam. O que existe hoje é outra coisa: `data/letreiro-nao-comum.txt` tira 327 nomes e
      estrangeirismos da lista de COMUNS, então eles nunca aparecem na revelação como "você
      perdeu esta" — mas continuam valendo se alguém os achar.

      Para cumprir o critério falta uma coluna `proprio` separada de `comum`: são eixos
      diferentes (frequência contra categoria), e usar um pelo outro foi exatamente o erro que
      fez a revelação mostrar ADELE. E antes da coluna falta a DECISÃO de produto: recusar
      BRASIL a um jogador brasileiro que o achou na grade é defensável pela regra clássica do
      Boggle e desagradável na mesa
- [ ] Carregamento do dicionário < 500 KB transferidos, e apenas na primeira vez

**Tempo real**
- [ ] Cronômetro dos 6 jogadores sincronizado dentro de 300ms
- [ ] Relógio do sistema adiantado em 10 min não afeta o cronômetro
- [x] Rodada termina sozinha mesmo se todos fecharem o navegador — a faxina encerra, e o mesmo
      vale para o desafio diário
- [ ] Reconectar aos 2:30 restaura grade, tempo e lista de palavras

**Segurança**
- [x] Jogador A não consegue ler `match_private_state` de B durante a rodada
- [x] `letreiro_boards` não é legível pelo cliente — sem grant de SELECT para nenhum dos dois
      papéis, e a auditoria de privilégios confere isso em todas as tabelas a cada rodada
- [x] Chamar `letreiro_score` pelo cliente falha

**Sensação**
- [ ] Do toque na letra ao feedback visual: < 100ms
- [ ] 60fps durante a queda dos dados em Galaxy A54
- [ ] Com `prefers-reduced-motion`, os dados aparecem já parados e o jogo é idêntico
- [ ] Jogável de uma mão em 375px de largura
