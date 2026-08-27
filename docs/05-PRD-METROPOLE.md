# PRD 05 — Metrópole

> **Referência:** Banco Imobiliário / Monopoly · **Ordem:** 4º jogo · **Jogadores:** 2–6 · **Duração:** 30–120 min (por modo)

---

## 1. Pitch

Um tabuleiro de cidade brasileira em art déco tropical, prédios que crescem na sua frente, e uma
mesa de negociação onde o acordo **vale de verdade**: "te pago R$ 500 por rodada durante seis
rodadas" é um contrato que o jogo cobra sozinho. É o Banco Imobiliário que acaba antes da meia-noite.

## 2. Por que este jogo é o quarto

É o mais **denso em economia** e o mais **longo**. Depende de tudo que os outros três construíram:
estado grande e persistente, negociação assíncrona, retomada de partida, e a maior carga de
animação 3D do projeto (prédios crescendo, peões andando, dados rolando).

Também é o jogo com o **maior potencial de decepção** se feito mal — todo mundo já jogou uma partida
de Banco Imobiliário que arrastou por quatro horas. O trabalho aqui é quase todo de conserto.

---

## 3. O tabuleiro

Cidade fictícia composta de bairros brasileiros reais — nomes de lugar são de domínio público. A
ordem, os preços, os agrupamentos e toda a arte são autorais.

**40 casas. 28 propriedades: 22 bairros em 8 grupos, 4 transportes, 2 companhias.**

| Grupo | Bairros | Preço | Casa |
|---|---|---|---|
| Marrom | Feira de Caruaru · Ver-o-Peso | 600 · 600 | 500 |
| Azul-claro | Pelourinho · Olinda · Praia de Iracema | 1000 · 1000 · 1200 | 500 |
| Rosa | Ponta Negra · Boa Viagem · Porto da Barra | 1400 · 1400 · 1600 | 1000 |
| Laranja | Pampulha · Praça da Liberdade · Mercado Municipal | 1800 · 1800 · 2000 | 1000 |
| Vermelho | Batel · Moinhos de Vento · Beira-Mar Norte | 2200 · 2200 · 2400 | 1500 |
| Amarelo | Barra da Tijuca · Asa Sul · Meireles | 2600 · 2600 · 2800 | 1500 |
| Verde | Ipanema · Lago Sul · Vila Nova Conceição | 3000 · 3000 · 3200 | 2000 |
| Azul-escuro | Leblon · Jardins | 3500 · 4000 | 2000 |

**Transportes** (R$ 2.000 cada): Aeroporto de Congonhas · Porto de Santos · Estação da Luz · Ponte Rio–Niterói
**Companhias** (R$ 1.500 cada): Companhia de Energia · Companhia de Saneamento

**Cantos:** Largada (+R$ 2.000) · Cadeia / Só de passagem · Praça Central · Vá para a Cadeia
**Taxas:** Imposto de Renda (R$ 2.000) · Taxa de Luxo (R$ 1.000)
**Cartas:** 16 de **Sorte**, 16 de **Revés**

**Escala:** salário R$ 2.000, banco inicial R$ 15.000. Escala 10× a do Monopoly clássico —
balanceamento comprovado, números que soam brasileiros.

**Escassez de construção mantida:** 32 casas e 12 hotéis no banco, e acabou. O contador fica visível.
Segurar casas para sufocar a construção alheia é uma jogada real, e quase toda versão digital
joga fora essa camada.

---

## 4. O que quebra no Banco Imobiliário

| # | Problema | Por que dói |
|---|---|---|
| 1 | **Dura 3 horas** e ninguém termina | É o problema definidor do jogo |
| 2 | **Quem quebra primeiro assiste 90 minutos** | Pior que no WAR, porque a quebra vem cedo |
| 3 | **Ninguém usa o leilão** (que é regra oficial) | Sem leilão, a fase de aquisição vira roleta lenta: você só compra o que cair no seu dado |
| 4 | **"Bolão do Estacionamento Livre"** | A regra da casa mais popular do mundo é justamente a que mais alonga a partida — injeta dinheiro do nada e adia a quebra de todo mundo |
| 5 | **Decisão zero na maior parte dos turnos** | Rola o dado, anda, paga. Repetir 60 vezes |
| 6 | **Negociação trava** | "Te dou o Leblon se você não cobrar aluguel por 3 rodadas" — impossível de cumprir no papel |
| 7 | **Você não sabe se está ganhando** | Patrimônio, fluxo de caixa e risco são invisíveis. Só descobre que quebrou quando quebra |
| 8 | **Meio de jogo monótono** | 40 minutos de "andar e pagar" antes do desfecho |

---

## 5. Melhorias

### 5.1 Leilão obrigatório [v1] — a regra que já existe e ninguém aplica

**Resolve o problema #3.** Caiu numa propriedade sem dono e **não comprou**? Ela vai a leilão
imediatamente, aberto a todos, **inclusive a você**. Lance inicial R$ 100, incrementos livres,
15 segundos de relógio que reseta a cada lance.

Por que isso conserta o jogo:
- **Acelera a aquisição.** O tabuleiro se distribui em ~6 rodadas em vez de 15
- **Cria decisão em turno alheio.** Você participa do turno dos outros
- **Precifica o jogo.** Você descobre quanto o Laranja vale pela cara dos outros
- **Cria dívida cedo**, e dívida é o que produz negociação

É a regra oficial do Monopoly desde sempre. A maioria das mesas não usa porque no papel o leilão é
lento e confuso. Digitalmente, leva 20 segundos e é o momento mais tenso da fase inicial.

**Leilão também acontece** quando alguém quebra: as propriedades dele vão a leilão em vez de voltar
ao banco.

### 5.2 Contratos que o jogo cobra [v1] — a melhoria que não existe no papel

**Resolve o problema #6.** A mesa de negociação aceita muito mais que dinheiro e escritura:

| Item negociável | Como funciona |
|---|---|
| **Dinheiro à vista** | Imediato |
| **Escrituras** | Com ou sem construções (construídas são vendidas ao banco primeiro) |
| **Parcelamento** | `R$ 500 por rodada durante 6 rodadas` — o jogo debita sozinho, todo início de turno |
| **Isenção de aluguel** | `não pago aluguel em Ipanema por 4 rodadas` — aplicado automaticamente |
| **Isenção total** | `você não me cobra nada por 2 rodadas` |
| **Opção de compra** | `posso comprar o Leblon de você por R$ 5.000 até a rodada 14` |
| **Carta Saída Livre da Cadeia** | Item negociável |

**Isto é o que a versão digital pode fazer e a de papel não pode.** Um parcelamento no papel depende
de todo mundo lembrar toda rodada; aqui, o servidor debita. Isso abre uma economia inteira — crédito,
seguro, opções — que nunca existiu numa mesa de Banco Imobiliário.

Contratos ativos ficam visíveis num painel público. Se o devedor não tem dinheiro para uma parcela,
ele **entra em inadimplência**: precisa hipotecar ou vender até cobrir, ou quebra.

Negociação tem timer de 90s, contra-oferta em um clique, e acontece **a qualquer momento**, não só
no seu turno.

### 5.3 O painel de fluxo de caixa [v1]

**Resolve o problema #7.** Um painel sempre visível, em números tabulares:

```
  PATRIMÔNIO           R$ 24.300
  ├ dinheiro            R$  3.100
  ├ propriedades        R$ 19.200
  └ construções         R$  2.000

  POR RODADA
  ├ salário            + R$ 2.000
  ├ aluguel a receber  + R$ 1.240   (esperado)
  ├ aluguel a pagar    − R$ 3.180   (esperado)
  ├ parcelas           − R$   500
  └ SALDO              − R$   440   ▼

  ⚠  No ritmo atual, você fica sem dinheiro em ~7 rodadas.
```

Os valores esperados são calculados de verdade: probabilidade de cair em cada casa (a distribuição
estacionária do tabuleiro, com Cadeia e cartas, é conhecida e pré-computável) × aluguel atual.

Isso muda o jogo. Você para de descobrir que quebrou **quando** quebra e passa a negociar **antes**.
E acelera turnos, porque as decisões ficam óbvias mais rápido.

O mesmo cálculo alimenta a **decisão da Cadeia**: no fim do jogo, ficar preso é bom. O painel diz
por quê, com números.

### 5.4 Três modos, e o padrão não é o clássico [v1]

**Resolve o problema #1.**

| | **Metrópole** (padrão) | Clássico | Relâmpago |
|---|---|---|---|
| Início | 3 propriedades sorteadas por jogador | Tabuleiro vazio | 4 propriedades sorteadas |
| Banco inicial | R$ 15.000 | R$ 15.000 | R$ 20.000 |
| Fim | **20 rodadas** | Sobrar um | **12 rodadas** |
| Vitória | **Maior patrimônio** | Último de pé | Maior patrimônio |
| Falência | Vira **Investidor** | Elimina | Vira Investidor |
| Aluguéis | Normais | Normais | **×1,5** |
| Duração | **45–60 min** | 90–120 min | 25–35 min |

Distribuir 3 propriedades no início é a mudança mais eficaz: cria quase-monopólios na rodada 1 e
**a negociação começa antes do primeiro dado**. Toda a lentidão da fase de aquisição desaparece.

O modo Clássico continua lá, inteiro e correto, para quem quer a experiência original.

### 5.5 O Investidor [v1]

**Resolve o problema #2.** Quem quebra não sai. Vira Investidor:

- Recebe **10% do patrimônio líquido** que tinha antes de quebrar, em dinheiro
- **Não** possui propriedades e não anda pelo tabuleiro
- **Participa de todos os leilões** — pode comprar, mas o que compra é administrado por um jogador
  ativo à escolha dele, que fica com metade do aluguel
- Aposta em segredo em quem vai vencer. Acertou → 2º lugar no placar final
- Pode fazer **empréstimos** a jogadores ativos, com contratos (§5.2)

O Investidor é um **banqueiro sombrio**. Não pode vencer, mas todo mundo precisa falar com ele. É o
oposto de assistir.

### 5.6 Eventos da cidade [v1.1]

**Resolve o problema #8.** A cada 5 rodadas, um evento global sorteado, anunciado como manchete de
jornal, valendo por 3 rodadas:

| Evento | Efeito |
|---|---|
| **Obra na avenida** | Um grupo de cor sorteado: aluguéis −50% |
| **Alta temporada** | Bairros de praia: aluguéis +50% |
| **Greve dos transportes** | Transportes não cobram aluguel |
| **Boom imobiliário** | Construção custa −30% |
| **Aperto de crédito** | Hipotecar rende −20%; juros de resgate sobem para 20% |
| **Feriadão** | Salário da Largada dobra |

Muda a temperatura do meio de jogo e cria janelas de oportunidade que valem a pena esperar.

### 5.7 Regras da casa, com o preço na etiqueta [v1]

**Resolve o problema #4** sem brigar com ninguém. As regras da casa estão todas lá, desligadas por
padrão, e cada uma mostra **o que faz com a partida**:

```
  REGRAS DA CASA

  ☐  Bolão da Praça Central
     Multas e taxas vão para um pote, e quem parar na Praça leva tudo.
     ⏱  +35 a +50 min na partida.  A regra da casa mais popular do
        mundo é a que mais alonga o jogo — ela injeta dinheiro que
        ninguém pagou e adia a quebra de todos.

  ☐  Salário dobrado ao parar exatamente na Largada        ⏱ +10 min
  ☐  Sem leilão (quem não compra, a propriedade volta ao banco)  ⏱ +25 min
  ☐  Construir sem ter o grupo completo                    ⏱ −15 min
  ☑  Leilão obrigatório                                    ⏱ −25 min
```

Ninguém está proibido de nada. Só está informado. Na prática, mostrar "+35 a +50 min" ao lado do
bolão resolve a discussão sozinho.

### 5.8 Ritmo de turno [v1]

O turno de Banco Imobiliário é 80% mecânico. Cortar essa gordura:

- **Rolagem automática** ligável: seu turno começa com o dado já rolando
- **Pagamentos automáticos** quando você tem dinheiro suficiente. Sem modal de "OK"
- **Compra em um toque**, com o preço e o impacto no seu caixa já visíveis no card
- **Construção em lote**: arrastar um seletor pelo grupo e construir 5 casas de uma vez
- **Hipoteca em um toque**, com o painel mostrando quanto ainda falta para cobrir a dívida
- Turno médio alvo: **12 segundos** sem decisão, **40 segundos** com decisão

O jogo só para quando há **escolha**. Nunca para para confirmar o inevitável.

---

## 6. Fluxo de turno

```
SEU TURNO

  ┌─ opcional, antes de rolar ───────────────────────────┐
  │  construir · hipotecar · resgatar · negociar         │
  └──────────────────────────────────────────────────────┘
                          ↓
                   ROLAR OS DADOS
                 (2 dados 3D, física)
                          ↓
        peão anda casa a casa, com passo e som
                          ↓
  ┌──────────────────────────────────────────────────────┐
  │  propriedade sem dono → Comprar por R$ X             │
  │                        ↳ recusou → LEILÃO (todos)    │
  │  propriedade com dono → aluguel debitado (auto)      │
  │  Sorte / Revés        → carta vira em arco           │
  │  Cadeia               → painel de decisão com números│
  │  Imposto              → debitado                     │
  └──────────────────────────────────────────────────────┘
                          ↓
     dado duplo? → rola de novo (3 duplos = Cadeia)
                          ↓
     parcelas de contratos são debitadas · passa a vez
```

**Negociação e leilão acontecem fora do turno.** Se você recebe uma proposta enquanto o Otávio joga,
você responde na hora, sem parar a partida.

**Auto-pass:** 60s sem ação → rola automaticamente e executa a ação padrão (comprar se o painel de
fluxo de caixa indicar saldo confortável; recusar caso contrário → vai a leilão, e o ausente não dá
lance).

---

## 7. Modelo de dados

```jsonc
// matches.public_state  — este é o maior estado dos quatro jogos
{
  "mode": "metropole",
  "round": 8,
  "turnSeat": 2,
  "phase": "roll",              // pre | roll | move | resolve | auction | trade
  "players": {
    "0": { "cash": 3100, "pos": 14, "jail": 0, "getOutCards": 1, "bankrupt": false }
  },
  "props": {
    "ipanema": { "owner": 0, "houses": 3, "hotel": false, "mortgaged": false }
  },
  "bank": { "houses": 21, "hotels": 9 },
  "auction": {
    "prop": "leblon", "high": 3800, "highSeat": 1, "endsAt": "..."
  },
  "contracts": [
    { "id": "c7", "from": 2, "to": 0, "type": "installment",
      "amount": 500, "roundsLeft": 4 },
    { "id": "c8", "from": 0, "to": 3, "type": "rent_immunity",
      "props": ["leblon"], "roundsLeft": 2 }
  ],
  "cityEvent": { "id": "alta-temporada", "roundsLeft": 2 },
  "investors": [4]
}
```

```jsonc
// match_private_state.data
{
  "secretBet": 1,          // aposta do Investidor
  "notes": {}              // anotações privadas sobre quem quer o quê
}
```

Metrópole tem pouquíssima informação oculta — quase tudo é público, por design. O estado privado
existe basicamente para a aposta do Investidor.

### Ações (RPC)

| RPC | Valida |
|---|---|
| `met_roll(match)` | Sua vez · fase de rolagem · PRNG do servidor · resolve o movimento e a casa de chegada em uma transação |
| `met_buy(match)` | Você está na propriedade · sem dono · tem o dinheiro |
| `met_decline(match)` | Você está na propriedade · **abre o leilão** |
| `met_bid(match, amount)` | Leilão aberto · lance > atual · você tem o dinheiro · não é Investidor sem caixa |
| `met_build(match, prop, n)` | Você tem o grupo completo · nenhuma hipotecada · **construção uniforme** (diferença máxima de 1 casa entre propriedades do grupo) · há casas no banco · tem o dinheiro |
| `met_mortgage / met_unmortgage` | Sua propriedade · sem construções · juros de 10% no resgate |
| `met_offer(match, offer)` | Estrutura válida · você possui o que está oferecendo |
| `met_offer_reply(match, id, accept)` | Você é o destinatário · cria os contratos |
| `met_jail(match, choice)` | Você está na cadeia · `pagar` / `carta` / `tentar duplo` |
| `met_bankrupt(match)` | Patrimônio total < dívida · liquida, vira Investidor ou elimina conforme o modo |

Toda transação de dinheiro é **uma transação de banco de dados**. Nunca há um estado intermediário
onde o dinheiro sumiu de um lugar e não chegou no outro.

---

## 8. Direção de arte

Paleta completa em [Direção de Arte §3.3](01-DIRECAO-DE-ARTE.md#metrópole--déco-tropical).

**A referência:** cartão-postal brasileiro dos anos 50. Art déco tropical — Athos Bulcão, azulejaria
carioca, marquises de cinema, letreiro de neon apagado de dia. Terracota, menta, latão, azul de
piscina, creme.

**O tabuleiro** é uma maquete isométrica 3D, inclinada ~30°, iluminada por uma luz quente de fim de
tarde que projeta sombras longas e diagonais pelo tabuleiro inteiro. As casas do tabuleiro têm
relevo de 3mm; as escrituras são cartões impressos apoiados sobre elas, levemente tortos.

**Os prédios são a estrela.** Cada grupo de cor tem **arquitetura própria** — não são cubinhos
coloridos:

| Grupo | Casa | Hotel |
|---|---|---|
| Marrom / Azul-claro | Sobrado colonial, telha capa-e-canal | Casarão com sacada de ferro |
| Rosa / Laranja | Casa modernista, laje plana, cobogó | Edifício de 4 andares com brise |
| Vermelho / Amarelo | Prédio déco com marquise | Torre com terraço |
| Verde / Azul-escuro | Torre de vidro e concreto | Arranha-céu com heliponto |

**A construção é uma animação de 900ms**: o terreno se abre, a estrutura sobe do chão em três tempos
com `spring.heavy`, a fachada preenche, e as janelas acendem uma a uma. Som de obra, curto. Este é o
momento de recompensa do jogo — ninguém pula.

**O peão** é uma peça de latão fundido (bonde, avião, chinelo, café, garrafa, chapéu) que **anda casa
a casa**, com um passo por casa, acelerando: 140ms por casa nas primeiras, 60ms depois da quarta.
Andar 12 casas leva ~1s e você **sente** a distância. Teleportar o peão mata metade da sensação do jogo.

**O dinheiro** aparece em cédulas empilhadas ao lado do jogador, com espessura proporcional ao caixa.
Você lê quem está rico de relance, sem ler número nenhum. Ao pagar, as cédulas voam em arco para o
outro lado da mesa. Números sempre em Archivo `tabular-nums`.

**As cartas de Sorte e Revés** são 2D, ilustradas como anúncio de revista dos anos 50, com meio-tom
visível e uma cor de acento por baralho. Viram em arco no centro da tela, grandes, por 2 segundos.

**O leilão** é a única tela que escurece tudo: o tabuleiro apaga, a escritura fica no centro sob um
foco, e os lances aparecem como plaquinhas erguidas em volta. Relógio de 15s em latão, resetando a
cada lance. É o momento mais tenso do jogo e a arte precisa dizer isso.

**Som:** martelo de leiloeiro, cédula sendo contada, obra (curta), campainha de bonde no passo do
peão, dados de acrílico no papelão, e um jingle de rádio dos anos 50 no menu (uma vez, não em loop).

---

## 9. Escopo

### v1
- Tabuleiro autoral de 40 casas, 28 propriedades, arte completa
- Modos **Metrópole** (padrão), Clássico e Relâmpago
- Leilão obrigatório, com sala de leilão dedicada
- Mesa de negociação com os 7 tipos de item, incluindo contratos executáveis
- Painel de fluxo de caixa com projeção de quebra
- Investidor
- Regras da casa com impacto de duração declarado
- Escassez de casas e hotéis
- Hipoteca com juros
- Ritmo de turno otimizado (auto-roll, pagamentos automáticos, construção em lote)
- Tabuleiro 3D isométrico, prédios com animação de construção, peões e dados 3D
- Fallback 2D completo

### v1.1
- **Segunda cidade temática** (Oásis, Neon 87 ou Colônia — uma por lançamento). Troca os nomes das
  28 propriedades, a arquitetura dos prédios e as 32 cartas
- Eventos da cidade
- Estatísticas: ROI por propriedade, casa mais lucrativa da partida, "quem te falisu"
- Gráfico de patrimônio ao longo das rodadas na tela final
- Retomada de partida longa em outro dia (o estado já persiste; falta a UX de convite de retorno)

### Futuro
- Segundo tabuleiro (cidade litorânea, com regras de temporada)
- Modo 2 jogadores balanceado (o Monopoly a dois é notoriamente ruim; exige regras próprias)
- Modo cooperativo contra "a Prefeitura"

---

## 10. Critérios de aceite

**Como ler as marcas.** ✅ significa que existe uma verificação automática que reprova se
quebrar — não "eu olhei e parecia certo". ⬜ é o que falta. 👁 é o que está implementado mas
depende de olho humano para ser aceito, porque nenhuma tela deste jogo foi vista ainda.

As verificações vivem em `scripts/smoke-metropole.mjs` (247 delas) e no validador do
tabuleiro, `npm run cidade`, que se recusa a publicar a cidade se a economia não fechar.

**Economia — precisa fechar na vírgula**
- ✅ Dinheiro entre jogadores é conservado. Verificado em transferência de aluguel, acordo
      negociado e partilha com o Investidor
- ✅ Imposto e taxa SAEM do jogo (é o que faz a partida ter fim) — e vão para o pote quando o
      bolão está ligado
- ✅ Nenhuma transação parcial: quem recebe é creditado cheio, quem paga vai para o negativo,
      e caixa negativo tranca o turno até ser resolvido
- ✅ Aluguel com grupo completo sem construção é o dobro
- ✅ Aluguel de transporte escala com quantos o dono tem (1/2/3/4 testados)
- ✅ Companhia cobra pelo dado (40× ou 100×, testados com dado 7 e 12)
- ✅ Hipotecada não cobra aluguel
- ✅ Resgate cobra 10% de juros — e a conta é em INTEIRO, porque em ponto flutuante ela dava
      um real a mais em seis das treze faixas
- ✅ Construção uniforme é obrigatória e o cliente não consegue burlar
- ✅ Acabaram as casas no banco → construir falha com mensagem clara
- ✅ Patrimônio não conta propriedade sem dono (contava, para todos, até a migração 0029)

**Leilão**
- ✅ Recusar compra abre leilão
- ✅ Quem recusou pode dar lance
- ✅ Lance acima do caixa é rejeitado; lance igual ao atual também
- ✅ Lance novo reabre o leilão para quem já havia passado
- ✅ Quando todos passam, fecha na hora — sem esperar relógio
- ✅ Ninguém deu lance → propriedade fica com o banco
- ✅ O Investidor dá lance, e o que ele arremata vai para o nome do administrador
- ⬜ Leilão de falência distribui as propriedades (hoje elas voltam ao banco e podem ser
      compradas de novo, que resolve o congelamento mas não é o leilão do PRD)

**Contratos**
- ✅ Parcela é debitada automaticamente no início do turno do devedor, e expira na rodada certa
- ✅ Devedor sem caixa entra em inadimplência pela mesma máquina de dívida do resto do jogo
- ✅ Isenção de aluguel é aplicada sem intervenção, vale contra o aluguel dobrado do monopólio
      e contra o agravo de carta, e expira na rodada certa
- ✅ Contrato sobrevive à falência do credor; a parcela devida por quem quebrou morre
- ✅ Contratos ativos são públicos
- ✅ Aceitar proposta que ficou impossível é recusado (a validação roda duas vezes: ao propor
      e ao aceitar, porque entre as duas o mundo anda)
- ✅ Opção de compra: exercida no preço combinado, vencida não vale, e não vale contra terceiro

**Modos**
- ✅ Modo Metrópole termina na rodada 20, sempre
- ✅ Patrimônio final é gravado no estado para todos, e não recalculado no cliente
- ✅ Investidor participa de leilões, e o que compra é administrado por um jogador ativo que
      fica com a metade maior do aluguel
- ✅ Investidor empresta por contrato, e aposta em segredo: acertar vale o segundo lugar
- ✅ Modo Clássico elimina de verdade
- 👁 Modo Relâmpago existe no vocabulário e no motor (12 rodadas, banco maior, 4 sorteadas)

**Eventos da cidade**
- ✅ Um evento a cada cinco rodadas, valendo por três, e nunca dois ao mesmo tempo
- ✅ Os seis efeitos, cada um em fração de inteiros, conferidos contra o número esperado
- ✅ O sorteio é uniforme — verificado por DISTRIBUIÇÃO em 300 sementes, depois de um viés
      real ter sido encontrado e consertado (migração 0038)
- ✅ O sorteio sai da semente, que o cliente não lê: ninguém sabe qual evento vem

**Regras da casa**
- ✅ As quatro nascem desligadas
- ✅ Cada uma mostra o custo em minutos no lobby
- ✅ São congeladas no início da partida — mudar a regra com partida rolando é recusado
- ✅ Chave de configuração de outro jogo é RECUSADA, não descartada em silêncio

**Ritmo — a métrica que define o jogo**
- ⬜ Turno sem decisão termina em ≤ 12s (falta medir com gente de verdade)
- ⬜ Partida completa no modo Metrópole com 4 jogadores: 45–60 min (falta medir)
- ⬜ Partida no Relâmpago: ≤ 35 min (falta medir)

**Sensação e performance**
- ⬜ Tabuleiro 3D isométrico, prédios com animação de construção, peões e dados 3D
- ⬜ Peão anda casa a casa (hoje ele aparece na casa de destino)
- 👁 Tabuleiro legível em 375px: o SVG rola na horizontal abaixo de 680px e a gestão das
      propriedades sai de cima das casas para o painel. Fundamentado, não observado
- ✅ Grupos de cor distinguíveis em protanopia e deuteranopia: oito texturas por cima da cor,
      em ordem crescente de densidade seguindo o preço
- 👁 Com `prefers-reduced-motion`, nada se perde
- ⬜ Cena ≤ 1,5 MB de assets (não há assets: tudo é CSS, SVG e som sintetizado)

**A lacuna que atravessa a lista.** Nenhuma tela deste jogo foi vista. As marcas ✅ são
verdadeiras no sentido de que uma verificação automática as guarda; as 👁 dependem de alguém
abrir o navegador. Ler esta lista como "o jogo está pronto" seria ler errado — ela diz que a
ECONOMIA está provada, o que é a parte que não dá para consertar depois.
