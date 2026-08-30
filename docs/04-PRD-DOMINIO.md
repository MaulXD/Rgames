# PRD 04 — Domínio

> **Referência:** WAR / Risk · **Ordem:** 3º jogo · **Jogadores:** 3–6 · **Duração:** 35–90 min (por modo)

---

## 1. Pitch

Um mapa de 1936 aberto sobre a mesa, 42 territórios, seis exércitos e um objetivo secreto no seu
bolso. Você negocia, trai, joga os dados e conta a história para os netos. Só que agora a partida
acaba na mesma noite.

## 2. Por que este jogo é o terceiro

Ele é o teste de **estado complexo**: 42 territórios, contagens de exército, fases de turno,
cartas, objetivos, e uma resolução de combate que precisa ser autoritativa e auditável. Também é o
primeiro com **eliminação** de verdade e com **negociação** — duas coisas que exigem que a plataforma
já esteja sólida.

E é o jogo mais **caro visualmente** dos quatro. Só faz sentido atacá-lo depois que Letreiro e Dossiê
provaram a pipeline 3D e o orçamento de performance.

---

## 3. O mundo: Vantara

Mapa original. Não é a Terra e não é o tabuleiro de nenhum jogo existente — é um planeta desenhado
para jogar bem, com gargalos, penínsulas defensáveis e continentes de risco/retorno diferentes.

| Continente | Territórios | Bônus | Fronteiras externas | Caráter |
|---|---|---|---|---|
| **Aurélia** | 8 | +5 | 3 | Grande, difícil de segurar. Norte gelado |
| **Meridiana** | 4 | +2 | 1 | Fortaleza. Um gargalo só. O melhor começo |
| **Velária** | 7 | +5 | 4 | O centro. Todo mundo passa por aqui. Indefensável |
| **Sarnath** | 6 | +3 | 3 | Deserto. Bônus modesto, posição excelente |
| **Khadar** | 13 | +7 | 5 | Vastidão. Quem segura ganha, quase ninguém segura |
| **Nauria** | 4 | +2 | 2 | Arquipélago. Isolado e barato |

**42 territórios. 6 continentes.** A soma dos bônus (24) e o número de fronteiras foram calibrados
para que Meridiana seja a abertura óbvia e Khadar a aposta de longo prazo.

<details>
<summary>Territórios (o grafo de adjacência completo vive em <code>data/vantara.json</code>)</summary>

**Aurélia** — Boreal · Fiorde Branco · Planalto de Vask · Costa de Âmbar · Lagos de Ilm · Vale Ruivo · Cabo Norte · Ermo de Tarn
**Meridiana** — Selva de Yaraq · Pampa Vermelho · Serra do Sal · Ponta Austral
**Velária** — Marca do Oeste · Colinas de Brann · Ducado de Selm · Bosque Cinzento · Estepe de Var · Porto de Calen · Passo de Ísel
**Sarnath** — Deserto de Khem · Oásis de Zubar · Costa de Marfim · Planalto de Uruk · Vale do Nilar · Cabo das Tempestades
**Khadar** — Tundra de Ossir · Montes Kel · Estepe Dourada · Planície de Ryn · Terras de Jade · Vale de Sarn · Deserto de Guran · Península de Amur · Costa de Lótus · Alturas de Zhen · Bacia de Tán · Ermos de Kesh · Cabo Oriental
**Nauria** — Ilhas Corais · Terra de Marrek · Arquipélago de Sund · Costa de Palmas

</details>

**Mapa Relâmpago:** um recorte de **24 territórios** e 4 continentes (Meridiana, Velária, Sarnath,
Nauria + oeste de Khadar), para partidas de 30–40 min. É um segundo arquivo de dados, não um segundo
jogo.

> **CONSTRUÍDO** — migração 0098. O recorte é GERADO de Vantara por
> `scripts/gera-mapa-relampago.mjs`, e não escrito à mão: os mesmos lugares, os mesmos nomes, as
> mesmas fronteiras. Dois arquivos com 24 territórios em comum acabam discordando sobre onde
> termina a Velária, e a discordância aparece como um ataque que o mapa mostra e o servidor recusa.
>
> **A FATIA DE KHADAR NÃO É "O OESTE".** Os quatro continentes dão 21 e faltam três. Os três mais
> a oeste pela coluna — `sarn`, `guran`, `ryn` — deixariam o mapa PARTIDO: a Nauria tem uma porta
> de terra só, `corais → amur`, e `amur` fica na coluna 9. A fatia é `guran`, `ryn`, `amur`: a
> mesma quantidade, e a que forma a ponte. Eles viram Sarnath, que é com quem fazem fronteira.
>
> **O VALIDADOR É O MESMO PARA OS DOIS MAPAS**, e é isso que faz o recorte ser dado em vez de
> engenharia: conexidade, simetria, contiguidade de continente, grau médio entre 3 e 5, e duas
> checagens novas que só um recorte precisa — nenhum objetivo fala de continente que este mapa
> não tem, e nenhum pede mais territórios do que ele tem. Objetivo impossível é a pior carta do
> baralho: a pessoa joga a partida inteira atrás de uma coisa que não pode acontecer.
>
> **E O CLIENTE PAROU DE IMPORTAR VANTARA.** `lib/dominio/vantara.ts` exportava `TERRITORIOS`,
> `POR_ID` e `GRADE` como constantes de módulo. Com dois mapas isso é armadilha silenciosa: numa
> partida Relâmpago a tela desenharia Vantara sobre um estado de 24 territórios, e o resultado é
> um mapa com metade dos lugares vazios — sem erro, sem aviso. As constantes saíram e viraram
> `mapaDe(st.map)`; quem encontrou os usos esquecidos foi o compilador.

---

## 4. Regras base

**Preparo.** Territórios distribuídos igualmente e ao acaso. Cada jogador recebe **1 objetivo secreto**
e distribui seus exércitos iniciais (35 para 3 jogadores, 30 para 4, 25 para 5, 20 para 6).

**Turno em três fases:**

### Fase 1 — Reforço
```
exércitos = max(3, floor(territórios / 2))
          + soma dos bônus de continente controlados
          + troca de cartas (opcional)
```

### Fase 2 — Ataque
Atacar um território **adjacente** e de outro dono, a partir de um território seu com **≥ 2 exércitos**.

- Atacante rola até **3 dados** (nunca mais que `exércitos − 1`)
- Defensor rola até **3 dados** (nunca mais que os exércitos que tem)
- Ordena os dois conjuntos e compara maior contra maior, segundo contra segundo, etc.
- **Empate: defensor ganha**
- Cada comparação perdida custa 1 exército
- Conquistou (defensor a zero): move de 1 até (dados usados) exércitos para o novo território

Conquistou pelo menos 1 território no turno → **compra 1 carta de território** no fim da fase.

### Fase 3 — Remanejamento
Mover exércitos **uma vez**, entre dois territórios seus **conectados por territórios seus**,
deixando ao menos 1 para trás.

### Cartas
54 cartas: 42 territórios (com símbolo: infantaria, cavalaria ou canhão) + 2 curingas.
Trocar 3 cartas iguais ou 3 diferentes por exércitos. Máximo 5 cartas na mão — com 5, a troca é
obrigatória no próximo reforço.

**Escalonamento da troca:** 4 · 6 · 8 · 10 · 12 · 15 · 20 · 25 · … (+5 a cada troca subsequente,
global, não por jogador). Ver [Melhoria 6.4](#64-o-relógio-da-guerra-anti-turtling).

### Vitória
Cumprir o objetivo secreto. Ou, se ele se tornar impossível, conquistar 24 territórios.

---

## 5. O que quebra no WAR original

| # | Problema | Por que dói |
|---|---|---|
| 1 | **Dura 4 horas** | Ninguém termina. A maioria das partidas de WAR da vida real foi abandonada |
| 2 | **Eliminado assiste 2 horas** | O pior caso de todos os jogos deste projeto |
| 3 | **"Destruir o exército amarelo"** como objetivo | Se o amarelo morre para outro, seu objetivo evapora. Se o amarelo é forte, é impossível. Puro azar de distribuição |
| 4 | **Turtling**: alguém se fecha em Meridiana e o jogo trava | Sem pressão, ninguém ataca, a partida arrasta |
| 5 | **Rolar dados 40 vezes num ataque grande** | 15 exércitos contra 12 = dez minutos de cliques |
| 6 | **Tempo morto no turno dos outros** | Turno de WAR é longo. Você espera 5 min para jogar 3 |
| 7 | **Ganhar sem entender por quê** | Objetivo secreto revelado no fim: "ah, era isso" |
| 8 | **Sem diplomacia formal** | Acordos existem só na conversa, e traição não custa nada |

---

## 6. Melhorias

### 6.1 Batalha em lote [v1] — a melhoria que devolve uma hora da sua noite

**Resolve o problema #5.** Você não clica "rolar" quarenta vezes. Você declara a **intenção**:

```
   Atacar  Estepe de Var  ←  Colinas de Brann  (14 exércitos)

   ○ Um assalto
   ○ Três assaltos
   ● Até conquistar
   ○ Até conquistar, parando se eu ficar com  [ 4 ]  exércitos
```

A última opção é o coração da coisa. É a decisão real de um general: *quanto eu estou disposto a
gastar nisso?* No jogo físico você toma essa decisão implicitamente, rolagem a rolagem, e leva dez
minutos. Aqui você toma **uma vez**, e ela é mais interessante.

O servidor resolve toda a sequência de uma vez, com o PRNG determinístico, e grava **cada assalto**
no evento. O cliente anima uma montagem rápida: os dados caem, os números aparecem em cascata
(≈120ms por assalto, acelerando), os exércitos somem do mapa, e o resultado final estampa. Toda a
batalha de 14v12 leva **4 segundos** e você viu todas as rolagens.

O log guarda tudo. Se alguém desconfiar, abre o detalhamento assalto a assalto.

### 6.2 O que fazer no turno dos outros [v1]

**Resolve o problema #6.** Enquanto não é sua vez, você pode:

- **Planejar**: marcar territórios-alvo no mapa. As marcas são privadas e ficam lá no seu turno
- **Ver o custo**: hover em qualquer fronteira mostra a probabilidade real de conquista com os
  exércitos atuais (calculada exatamente, não estimada — a matriz de Markov de combate é pequena e
  pré-computável). Isso é ensino de jogo embutido
- **Negociar**: propor trégua ou acordo (§6.6)
- **Ler o log narrado** (§6.7)

### 6.3 Objetivos: consertados e complementados [v1]

**Resolve o problema #3.** Duas mudanças.

**(a) Objetivos secretos reescritos.** Nenhum objetivo depende de outro jogador específico:

| Objetivo | Notas |
|---|---|
| Conquistar **Aurélia** e **Sarnath** | |
| Conquistar **Velária** e **Nauria** | |
| Conquistar **Khadar** e mais 3 territórios em qualquer lugar | |
| Conquistar **Meridiana**, **Sarnath** e mais um continente à sua escolha | |
| Conquistar **24 territórios** | O objetivo genérico |
| Conquistar **18 territórios** com **≥ 2 exércitos** em cada | Recompensa consolidação, não expansão rasa |
| Conquistar **todos os territórios com porto** (11 espalhados) | Objetivo transversal, força movimento pelo mapa inteiro |
| Eliminar **2 jogadores quaisquer** | Substitui "destrua o exército amarelo". Agressivo, mas nunca impossível nem gratuito |

**(b) Contratos públicos.** Dois contratos visíveis para todos, sorteados no início. Qualquer um pode
cumprir; o primeiro que cumprir leva o prêmio e o contrato é substituído.

```
CONTRATO   Controlar Porto de Calen, Costa de Marfim e Costa de Lótus
           ao mesmo tempo                                  →  +6 exércitos
```

Contratos fazem três coisas: dão a quem tirou um objetivo difícil uma rota alternativa de vantagem,
criam **conflito focado** (todo mundo quer o mesmo lugar) e dão ao público uma leitura do jogo —
você sabe por que o Otávio está indo para o Porto de Calen.

### 6.4 O relógio da guerra (anti-turtling) [v1]

**Resolve o problema #4.** Duas pressões que crescem:

**(a) Escalonamento da troca de cartas.** Global, não por jogador: 4 · 6 · 8 · 10 · 12 · 15 · 20 · 25 · 30…
A décima troca da partida vale 40 exércitos. Isso torna as cartas — que só se ganha **atacando** —
a maior fonte de exércitos do jogo tardio. Quem não ataca fica para trás matematicamente.

**(b) Bônus de continente crescente.** Segurar um continente por rodadas seguidas aumenta o bônus
em **+1 por rodada, até +3**. O contador é público, no mapa.

Isso parece premiar o turtle — e é justamente o ponto. **Torna o turtle intolerável para os outros.**
Quando o painel mostra "Meridiana: +2 → +5 em 3 rodadas", a mesa inteira olha para Meridiana. O
problema deixa de ser mecânico e vira social, que é onde ele se resolve.

### 6.5 Modo Campanha — a partida que acaba [v1]

**Resolve os problemas #1 e #2.** É o modo **padrão recomendado** para uma noite de semana.

| | Clássico | **Campanha** | Relâmpago |
|---|---|---|---|
| Mapa | 42 territórios | 42 territórios | 24 territórios |
| Duração | 60–90 min | **45–60 min** | 30–40 min |
| Fim | Objetivo cumprido | **12 rodadas** ou objetivo | **10 rodadas** |
| Eliminação | Sim | **Não** | **Não** |
| Vitória | Objetivo secreto | **Pontos** | **Pontos** |

**Pontuação da Campanha** (visível o tempo todo, num painel lateral):

| Fonte | Pontos |
|---|---|
| Território controlado | 1 |
| Continente controlado | valor do bônus × 2 |
| Contrato público cumprido | 5 |
| Objetivo secreto cumprido | **20** (e a partida acaba na hora) |
| Território tomado de outro jogador nesta rodada | 1 |
| Rodada inteira sem atacar ninguém | **−2** |

Sem eliminação: um jogador reduzido a zero territórios **volta** na rodada seguinte com 3 exércitos
num território neutro sorteado na borda do mapa, e continua pontuando. Ele não vai ganhar, mas
continua jogando, atrapalhando e sendo cortejado — que é o papel mais divertido do fim de um WAR.

O `−2` por rodada passiva é o dente do anti-turtling. Torna a passividade uma escolha com preço.

### 6.6 Diplomacia com preço [v1] — **construída** (migrações 0074–0084)

**Resolve o problema #8.** Uma mecânica só, deliberadamente simples:

**Trégua.** No seu turno, proponha a qualquer jogador uma trégua válida até o fim da **próxima**
rodada dele. Se ele aceitar, a trégua aparece publicamente no painel, com um contador.

Você **pode** quebrar a trégua. O servidor deixa. Mas:
- Você perde **2 exércitos** de reforço na sua próxima fase de Reforço
- Um marcador de **Traidor** fica ao lado do seu nome pelo resto da partida, visível para todos
- O log escreve a linha em vermelho de laca: *"Raul rompeu a trégua com Duda e atacou o Passo de Ísel."*

O ponto não é impedir a traição — é **dar peso a ela**. Traição sem custo é ruído; traição com custo
é história.

> **Como ficou.** O servidor deixa romper, e cobra as três coisas acima. A tela avisa antes: o botão
> vira laca vermelha e passa a dizer "Romper e atacar", porque romper sem saber que se está rompendo
> não é traição — é acidente, e acidente não vira história, vira reclamação.
>
> A trégua vive como um NÚMERO de rodada (`treguas["a:b"] = rodadaFinal`) e não como um contador que
> alguém precise decrementar: ela vence sozinha quando o relógio da partida passa por cima, e
> nenhuma faxina precisa saber que tréguas existem.
>
> A máquina responde na hora e fora da própria vez, aceita quando está perdendo naquela fronteira, e
> **nunca rompe** — máquina que trai não é mais difícil, é só imprevisível, e imprevisível sem
> intenção é ruído. Ver [08 — As Máquinas](08-MAQUINAS.md).

### 6.7 O log narrado [v1]

**Resolve o problema #7.** O log não é uma tabela de eventos. É a crônica da guerra:

```
Rodada 7

  Duda reforçou Meridiana. O Pampa Vermelho agora tem 14 exércitos.
  Duda atacou a Marca do Oeste a partir da Serra do Sal.
    A Marca do Oeste resistiu a três assaltos e caiu no quarto.
    Duda perdeu 5 exércitos. Bia perdeu 8.
  ▸ Bia foi expulsa de Velária.  Perdeu o bônus de +5.
  ▸ Duda cumpriu o contrato "Três Portos".  +6 exércitos.
```

E no fim da partida, o **Atlas da Campanha**: o mapa com uma linha do tempo raspável, mostrando as
fronteiras mudando rodada a rodada. Doze segundos que explicam a partida inteira. É a tela que a
pessoa vai printar e mandar no grupo.

### 6.8 Névoa de guerra [v1.1]

Modo opcional: você vê a contagem exata de exércitos só nos territórios **adjacentes aos seus**.
Nos demais, vê o dono e uma faixa (`~`, `pouco`, `muito`, `fortificado`). Muda o jogo inteiro —
blefe passa a existir. Alto valor, custo baixo (é uma função de redação do `public_state` por
assento), mas depende do modo padrão estar sólido.

### 6.9 Mercenário [v1.1]

Para o modo Clássico, que mantém eliminação. Quem é eliminado vira Mercenário: recebe 3 cartas de
intervenção (`+3 exércitos para quem eu escolher`, `este ataque tem −1 dado`, `bloqueie um
remanejamento`) e pode **negociá-las**. Não pode vencer, mas decide quem vence — e todo mundo sabe
disso, então ele volta a ser importante.

---

## 7. Fluxo de turno

```
SEU TURNO  (90s por fase, timer visível)

 ┌─ REFORÇO ────────────────────────────────────────────┐
 │  painel mostra: 8 (territórios) + 5 (Velária) = 13   │
 │  cartas na mão: [ Vask ♞ ] [ Khem ♟ ] [ Ísel ♜ ]     │
 │  → trocar? +12 exércitos (7ª troca da partida)       │
 │  clicar no mapa distribui. Botão "distribuir igual"  │
 └──────────────────────────────────────────────────────┘
                          ↓
 ┌─ ATAQUE ─────────────────────────────────────────────┐
 │  toque no seu território → fronteiras atacáveis      │
 │  acendem com a probabilidade de conquista            │
 │  toque no alvo → painel de intenção (§6.1)           │
 │  → dados 3D caem na borda do mapa, montagem rápida   │
 │  conquistou → escolher quantos exércitos avançam     │
 └──────────────────────────────────────────────────────┘
                          ↓
 ┌─ REMANEJAMENTO ──────────────────────────────────────┐
 │  arrastar de um território seu para outro conectado  │
 │  a rota se acende no mapa                            │
 │  (uma vez só)                                        │
 └──────────────────────────────────────────────────────┘
                          ↓
 comprou carta? → animação da carta entrando na mão
 → passa a vez
```

**Auto-pass:** fase estourou o timer → pula para a próxima. Reforço não distribuído é colocado
automaticamente no território de fronteira mais fraco. Nunca perde exército.

---

## 8. Modelo de dados

```jsonc
// matches.public_state
{
  "map": "vantara",
  "mode": "campanha",
  "round": 7,
  "phase": "attack",                       // reinforce | attack | fortify
  "turnSeat": 2,
  "reinforceLeft": 0,
  "territories": {
    "brann":  { "owner": 2, "armies": 14 },
    "var":    { "owner": 0, "armies": 3  },
    ...
  },
  "continentHold": { "meridiana": { "seat": 1, "rounds": 3, "bonus": 5 } },
  "tradeCount": 6,                          // próxima troca vale 20
  "handSizes": { "0": 2, "1": 4, "2": 1 },
  "contracts": [
    { "id": "tres-portos", "text": "...", "reward": 6, "claimed": null }
  ],
  "truces": [ { "a": 1, "b": 3, "untilRound": 8 } ],
  "traitors": [0],
  "scores": { "0": 22, "1": 31, "2": 19 },  // só no modo Campanha
  "fortifyUsed": false
}
```

```jsonc
// match_private_state.data
{
  "objective": { "id": "aurelia-sarnath", "text": "Conquistar Aurélia e Sarnath" },
  "hand": [ { "t": "vask", "sym": "cavalaria" }, ... ],
  "plans": ["var", "isel"]                  // marcas privadas no mapa
}
```

### Ações (RPC)

| RPC | Valida |
|---|---|
| `dominio_reinforce(match, placements)` | Sua vez · fase de reforço · soma == exércitos disponíveis · todos os territórios são seus |
| `dominio_trade(match, cards)` | Sua vez · fase de reforço · as 3 cartas estão na sua mão · combinação válida |
| `dominio_attack(match, from, to, intent)` | Sua vez · fase de ataque · `from` é seu com ≥2 · `to` é adjacente e de outro · **sem trégua ativa** (ou consome a quebra) · resolve toda a sequência com o PRNG e grava cada assalto |
| `dominio_advance(match, n)` | Conquistou · `n` entre 1 e dados usados · sobra ≥1 na origem |
| `dominio_fortify(match, from, to, n)` | Sua vez · fase de remanejamento · não usado ainda · caminho existe só por territórios seus (BFS no servidor) |
| `dominio_truce(match, seat)` / `dominio_truce_reply` | Proposta e resposta |
| `dominio_end_phase(match)` | Sua vez |

**A resolução de combate vive inteiramente numa função PL/pgSQL.** O cliente manda a intenção e
recebe a sequência completa. Não há como um cliente influenciar um dado.

---

## 9. Direção de arte

Paleta completa em [Direção de Arte §3.3](01-DIRECAO-DE-ARTE.md#domínio--cartografia-1936).

### 9.1 A decisão do mapa: plano, não globo

**Não vamos usar um globo 3D interativo**, e isso é uma escolha de produto, não de esforço.

Um globo esconde metade do mapa o tempo todo. Num jogo em que ler o tabuleiro inteiro é a
habilidade central, isso é um custo permanente pago por um segundo de "uau". Em celular, é fatal.

O mapa é **plano, com relevo**: uma cena 3D vista de cima com uma inclinação suave (~18°), onde
montanhas, planaltos e florestas têm altura real e projetam sombra longa. Os territórios são
polígonos extrudados 2–4mm, com aresta em tinta sépia. Papel de mapa como material do fundo, com
os **vincos de dobra** visíveis e uma leve ondulação — o mapa foi dobrado e reaberto.

O globo aparece em dois lugares: a tela de lobby (girando devagar, decorativo) e a tela de vitória
(zoom out do território conquistado até o planeta inteiro). Espetáculo onde não custa legibilidade.

### 9.2 Exércitos

Não são números num círculo. São **peças de metal fundido** empilháveis:

- 1–3 exércitos → peças individuais (soldadinho)
- 4–9 → uma peça de cavalaria + soldados
- 10+ → uma torre de canhão, com o número gravado em latão na base

O número **sempre** aparece, em JetBrains Mono tabular, sobre uma placa de latão. As peças são a
leitura periférica ("aquele lado tá pesado"); o número é a leitura precisa. Ambas necessárias.

Cada facção: cor + **hachura própria no preenchimento do território** + **brasão gravado na peça**
(ver [Direção de Arte §3.4](01-DIRECAO-DE-ARTE.md#34-daltonismo-é-requisito-funcional)).
Território de dono desconhecido nunca deve depender de distinguir carmim de vinho.

### 9.3 O combate

O único momento em que a câmera se mexe sozinha na partida inteira:

1. Zoom para a fronteira em 400ms, `spring.heavy`. O resto do mapa dessatura
2. Dois copos de couro entram pelas bordas e despejam os dados **na borda do mapa**, sobre o papel
3. Física real (Rapier). Dados de osso do atacante, de chumbo do defensor. Caem nos valores que o
   servidor decidiu
4. Comparação: um traço de tinta liga cada par de dados. O perdedor escurece
5. Peças somem do mapa com um baque de metal
6. Assaltos seguintes: ≈120ms cada, acelerando. Batalha de 20 assaltos em 4s
7. Conquista: a hachura do território **se preenche** a partir da fronteira, como tinta se espalhando
   no papel, em 500ms

### 9.4 Rótulos

Cartografia de verdade: maiúsculas, `letter-spacing: 0.18em`, Spectral 600, seguindo levemente a
curva do território. Rótulos de continente maiores, mais claros, com `opacity: 0.5`, **atrás** dos
territórios. Nomes de território somem abaixo de um nível de zoom e viram só as peças.

### 9.5 Som

Papel sendo desdobrado na abertura. Dados de osso no papel (som seco, alto). Peça de metal na mesa.
Corneta distante quando um continente é perdido. Selo de cera quando uma trégua é firmada — e o
som de papel rasgando quando é quebrada.

---

## 10. Escopo

### v1
- Mapa Vantara completo (42 territórios) + mapa Relâmpago (24) ✅
- Modos Clássico, **Campanha** (padrão) e Relâmpago ✅
- Três fases com timer e auto-pass
- Batalha em lote com as 4 intenções, incluindo limite de segurança
- 8 objetivos secretos reescritos + contratos públicos
- Escalonamento de troca + bônus de continente crescente
- Trégua com penalidade de traição
- Probabilidade de conquista no hover
- Log narrado + Atlas da Campanha
- Mapa 3D plano com relevo, peças de exército, dados com física
- Fallback 2D completo

### v1.1
- **As quatro peles de mapa**: Cartografia 1936, Carta de Dunas, Grade Tática, Carta Orbital.
  O grafo de Vantara não muda — muda o suporte, a luz e os marcadores
- Névoa de guerra
- Mercenário (para o modo Clássico)
- Marcas de planejamento compartilháveis com aliados
- Estatísticas: taxa de conquista, exércitos perdidos por conquista, "general mais sortudo"

### Futuro
- Segundo mapa (arquipélago, com regras navais)
- Modo 2v2 em duplas
- Cartas de comandante com habilidade única por facção

---

## 11. Critérios de aceite

**Combate**
- [x] 10.000 batalhas simuladas batem com a distribuição teórica dentro de 1% — nas cinco
      combinações (3v3, 2v3, 1v3, 3v2, 3v1), pior desvio 0,88 pp
- [x] Empate sempre favorece o defensor — 1v1 dá 41,7% para o atacante, que é o número exato
- [x] Atacante nunca rola mais dados que `exércitos − 1` — e o remanejo nunca deixa o
      território vazio, que é a mesma regra do outro lado
- [x] "Até conquistar, parando em N" para exatamente em N — o avanço tem teto de três no total,
      e o servidor devolve a lista de assaltos para a tela animar
- [x] Cada assalto individual está no registro e é auditável — **em `public_state.log`, e não
      numa tabela `match_events`, que nunca foi construída.** A decisão tem razão: uma tabela de
      eventos separada precisa de RLS própria, de faxina própria e de uma política de retenção, e
      o log no estado já é lido pela tela.

  > **E até a migração 0113 o assalto NÃO estava lá.** `dominio_atacar_como` montava o array com
  > cada rolagem — os dados dos dois lados, as baixas, como ficaram os territórios — e o DEVOLVIA
  > a quem atacou. Morria ali.
  >
  > O efeito não era de auditoria, era de mesa: **só o atacante via o dado cair.** Para os outros
  > cinco, um território mudava de cor e pronto — o mapa contava o resultado sem nunca contar a
  > história, que é a única coisa que a mesa de WAR faz junta. E quem se reconectasse no meio
  > perdia a rolagem inteira, inclusive quem atacou, porque a resposta de uma chamada não se
  > repete.
  >
  > O cliente já sabia encenar (`components/dominio/dados.tsx` existe desde o começo); o que
  > faltava era o dado chegar. Agora o ataque deixa uma linha `assalto` no registro público, e
  > quem não atacou anima a partir dela.
  >
  > **De quebra, o ataque que não conquista deixou de ser invisível.** A conquista sempre teve
  > linha; sangrar sem tomar nada não tinha — e é o que explica por que alguém ficou fraco.
  >
  > O que continua se perdendo é auditoria depois que a partida sai do banco, e depois das 80
  > linhas do teto do registro. É o que trava o critério do placar recalculado, logo abaixo
- [x] Nenhum cliente consegue influenciar um resultado de dado — a semente é do servidor e a
      coluna `seed` de `matches` não tem grant de SELECT para papel de cliente nenhum. O dado é
      determinístico na semente e no contador, e as faces são uniformes em 60.000 rolagens

**Regras**
- [x] Atacar território não adjacente é rejeitado — e, mais forte: as 19 conquistas de uma
      partida solo inteira foram TODAS entre territórios vizinhos
- [x] Remanejar por rota que passa por território de outro é rejeitado
- [x] Segundo remanejamento no mesmo turno é rejeitado
- [x] Com 5 cartas, a troca é obrigatória e o cliente não consegue pular
- [x] Bônus de continente sobe corretamente e zera ao perder um território — o "zera" é a
      metade que erra: somar é fácil, parar de somar quando o último território sai é o defeito
      clássico. E tanto faz se ele virou de outro ou ficou sem dono
- [x] Ataque com trégua ativa exige confirmação explícita e aplica a penalidade — a penalidade
      é conferida no servidor (dois exércitos a menos, cobrados uma vez, e a marca de Traidor que
      fica). A confirmação é de tela: o botão vira "Romper e atacar" em laca vermelha, e isso
      **não está verificado por teste**, só por leitura do código

**Modo Campanha** — implementado na migração 0039, com 28 verificações em
`scripts/smoke-dominio.mjs`
- [x] A partida termina na rodada 12, sempre
- [x] Jogador zerado retorna na rodada seguinte com 3 exércitos — tomados do território mais
      fraco de quem tem mais territórios. É uma adaptação declarada: Vantara não tem território
      neutro, então o líder paga pelo retorno
- [x] `−2` por rodada passiva é aplicado
- [x] Objetivo secreto cumprido vale +20 e encerra na hora; o placar acumula entre rodadas e
      os contadores de rodada (`tomou`, `atacou`) zeram a cada virada
- [ ] Placar bate com o recálculo independente a partir do `match_events` — bloqueado pela
      ausência da tabela (acima). Hoje o placar é
      verificado contra a regra escrita, não contra um recálculo a partir de eventos

**Objetivos**
- [x] Nenhum objetivo depende de um jogador específico por cor
- [x] Objetivo cumprido é detectado no mesmo instante e encerra a partida — os cinco tipos
      verificados contra estado montado à mão
- [x] Objetivo de outro jogador nunca vaza no `public_state`, e a RLS impede ler o estado
      privado alheio
- [x] Os objetivos NÃO se repetem entre jogadores (sorteados sem reposição)

**Sensação e performance**
- [x] Batalha de até 12 assaltos é resolvida numa chamada e devolve TODAS as rolagens, para o
      cliente encenar dado por dado sem inventar resultado. O mapa fica congelado no estado
      anterior enquanto o dado rola — senão o dado contaria uma história cujo fim já está na tela
- [ ] 60fps no mapa completo em Galaxy A54
- [ ] Cena ≤ 1,5 MB de assets
- [ ] Mapa legível em 375px de largura, com pinça para zoom
- [x] Duas facções quaisquer distinguíveis em protanopia, deuteranopia e tritanopia — oito
      texturas por cima do esmalte, porque carmim e oliva caem no mesmo tom em duas dessas
      condições e nada impede as duas na mesma partida
- [ ] Com `prefers-reduced-motion`, o combate mostra os resultados sem física, e nada se perde
