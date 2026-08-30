# PRD 03 — Dossiê

> **Referência:** Detetive / Clue · **Ordem:** 2º jogo · **Jogadores:** 3–6 · **Duração:** 25–40 min
>
> **Dossiê não é um caso. É quatro mundos rodando no mesmo motor.** Uma mansão paulista em 1953,
> uma escavação no deserto em 1928, uma boate em 1987 e uma estação orbital em 2189 — cada um com
> elenco, mapa, objetos, arte, som e **uma regra própria**. O sistema que torna isso possível está
> em [PRD 07 — Sistema de Temas](07-SISTEMA-DE-TEMAS.md).

---

## 1. Pitch

Alguém morreu. Seis suspeitos, seis objetos, nove lugares. Você elimina possibilidades a cada
palpite — e o bloco de dedução anota por você o que é fato público, mas **nunca** o que só você
percebeu. E cada partida pode acontecer num mundo diferente.

## 2. Por que este jogo é o segundo

**Teste de fogo da informação oculta.** Letreiro tinha estado privado trivial. Dossiê tem mãos que
nunca podem vazar, refutação privada entre dois jogadores com resultado público parcial, e uma
solução guardada no servidor que ninguém — nem o host — pode ler. Se o Dossiê ficar seguro, Domínio
e Metrópole são fáceis do ponto de vista de estado.

**E é o primeiro jogo temático.** O motor precisa nascer agnóstico. Retrofitar tema depois custa
três vezes mais, então o contrato de pacote é escrito antes da primeira linha de código.

É também o jogo mais **conversado** dos quatro: acontece 90% na chamada de voz. Perfeito para o público.

---

## 3. Os quatro casos

Conteúdo 100% autoral. Nenhum nome, lugar ou objeto vem do jogo original.

Cada caso declara 6 suspeitos, 6 objetos, 9 lugares e um grafo próprio — validado no CI
([PRD 07 §5](07-SISTEMA-DE-TEMAS.md#5-validador--roda-no-ci-reprova-o-build)). Os grafos abaixo
foram desenhados e conferidos: grau médio 3,11 · diâmetro ≤ 4 · nenhum beco sem saída.

---

### 3.1 Solar das Acácias — 1953 · noir art déco · **[v1]**

> *Chovia desde a tarde e o Solar estava cheio de gente que não queria estar ali.*

**A vítima:** Leonel de Sousa Aguiar, 64, barão do café, morto na noite de 12 de julho de 1953.

| Suspeito | Quem é | Cor | Brasão |
|---|---|---|---|
| **Coronel Ubirajara Bastos** | Sogro da vítima, reformado do Exército | Verde-oliva | Espora |
| **Dona Cândida Meireles** | Viúva do irmão de Leonel | Bordô | Camafeu |
| **Dr. Anselmo Vidal** | Médico da família há 30 anos | Azul-prússia | Caduceu |
| **Zilda Rocha** | Governanta do solar | Ocre | Molho de chaves |
| **Otávio Prado** | Sócio na fazenda, endividado | Roxo-vinho | Caneta-tinteiro |
| **Marisa Duarte** | Cantora de rádio, hóspede | Carmim | Microfone |

**Objetos:** Abridor de cartas · Corda de piano · Castiçal de bronze · Vidro de veneno · Revólver · Bengala de castão

**Lugares e mapa** — planta de 3×3, o clássico:

```
   BIBLIOTECA ─── SALÃO DE BAILE ─── SALA DE MÚSICA
        │                │                 │
   ESCRITÓRIO ─── JARDIM DE INVERNO ─── VARANDA
        │                │                 │
      COPA    ─────── ADEGA ────── QUARTO DE HÓSPEDES

   passagens secretas:  Biblioteca ⇄ Quarto de Hóspedes
                        Adega      ⇄ Sala de Música
```

**Reviravolta:** nenhuma. Este é o caso limpo, a referência. Quem quer o Detetive puro joga aqui.

**Arte:** [Direção de Arte §3.5.1](01-DIRECAO-DE-ARTE.md#351-solar-das-acácias--noir-art-déco)
**Ilustração das cartas:** retrato em meio-tom de alto contraste, cartaz de cinema policial.

---

### 3.2 Boate Aurora — 1987 · **[v1]**

> *O disco ainda estava girando.*

**A vítima:** Nelson Braga, 51, dono da casa, encontrado na cabine do DJ na madrugada de 3 de
outubro de 1987, depois do último set.

| Suspeito | Quem é | Cor | Brasão |
|---|---|---|---|
| **DJ Marcão** | Residente da casa há seis anos | Magenta | Fone de ouvido |
| **Bete Andrade** | Cantora da banda residente | Amarelo-ácido | Microfone |
| **Zezinho Portela** | Segurança da porta | Ciano | Lanterna |
| **Cláudia Fiúza** | Sócia e gerente | Roxo-uva | Agenda |
| **Ivan Torres** | Promoter, devia dinheiro ao Nelson | Verde-limão | Talão de convites |
| **Dona Sueli** | Do bar, desde a inauguração | Laranja | Coqueteleira |

**Objetos:** Taco de sinuca · Cabo de microfone · Garrafa de espumante · Extintor · Laquê e isqueiro · Chave de roda

**Lugares e mapa** — núcleo denso com satélites. A Pista é o centro de tudo, como numa boate de verdade:

```
                    CABINE DO DJ ─── CAMARIM
                         │              │
       BAR ─────────── PISTA ───────── ÁREA VIP
        │                │              │
     DEPÓSITO ──── FLIPERAMA      ESCADA DE INCÊNDIO
        │    ╲          │              │
        └── ESTACIONAMENTO ────────────┘

   passagens secretas:  Camarim     ⇄ Estacionamento  (saída dos artistas)
                        Cabine do DJ ⇄ Depósito       (passagem de serviço)
```

**Reviravolta — Apagão.** Uma vez por partida, sorteada entre as rodadas 4 e 8, a luz cai por uma
rodada inteira. Durante o apagão, **as refutações são anônimas**: você vê a carta que te mostraram,
mas não sabe quem mostrou, e o log só diz *"alguém desmentiu"*.

Por que funciona: você ainda ganha a informação que mais importa — aquela carta não está no envelope.
Perde só a atribuição. Uma rodada de choque controlado, e a mesa inteira grita.

**Arte:** [Direção de Arte §3.5.2](01-DIRECAO-DE-ARTE.md#352-boate-aurora--1987-de-verdade)
**Ilustração das cartas:** risografia de duas cores com registro desalinhado.

---

### 3.3 Ras Zamir — 1928 · escavação no deserto · **[v1.1]**

> *Abriram a câmara à meia-noite. Ao amanhecer, o homem que pagou a expedição estava morto.*

**A vítima:** Sir Alistair Crewe, 58, financiador da expedição anglo-egípcia, morto na tenda do
arquivo na madrugada de 14 de março de 1928, com o selo da câmara quebrado ao lado.

| Suspeito | Quem é | Cor | Brasão |
|---|---|---|---|
| **Prof.ª Helena Vasari** | Epigrafista, decifrou a inscrição | Índigo | Estilete de escriba |
| **Yusuf al-Rashid** | Chefe dos escavadores | Ocre queimado | Enxada curva |
| **Major Edmund Pryce** | Segurança da concessão | Verde-oliva | Binóculo |
| **Nadira Sabbagh** | Intérprete e cartógrafa | Turquesa | Compasso |
| **Dr. Otto Behring** | Conservador e químico | Cinza-ferro | Frasco graduado |
| **Constance Crewe** | Sobrinha e única herdeira | Bordô-poeira | Leque de sândalo |

**Objetos:** Martelo de geólogo · Corda de rapel · Frasco de fixador · Lampião a querosene · Punhal cerimonial · Estaca de tenda

**Lugares e mapa** — um acampamento em linha, com a escavação descendo num braço. Topologia
completamente diferente da mansão: aqui existe **profundidade**, e a Câmara Selada é o fim do mundo.

```
   MIRANTE DA DUNA
       │      ╲
  RADIOTELEGRAFIA ─ TENDA DO ARQUIVO ─ COZINHA DE CAMPO
       │                  │            ╱      │
   ESTÁBULO ──── TENDA DE CONSERVAÇÃO ╱    CISTERNA
       ╲                  │              ╱
        ╲───────── POÇO DA ESCAVAÇÃO ───╯
                         │
                   CÂMARA SELADA
                         ╲___________ (poço de ventilação)

   passagens secretas:  Câmara Selada ⇄ Mirante da Duna  (poço de ventilação antigo)
                        Estábulo      ⇄ Cisterna         (canal de água)
```

A Câmara Selada tem **uma única entrada** pelo Poço. Quem desce fica exposto — a não ser que
conheça o poço de ventilação. É o lugar mais tenso de todos os quatro mapas.

**Reviravolta — Tempestade de Areia.** A cada 3 rodadas o vento vira. **Uma rodada antes**, o jogo
avisa. Na rodada seguinte, dois lugares ficam **fechados**: ninguém entra e ninguém sai.

Quem está dentro fica preso — mas continua podendo palpitar, o que faz de um lugar fechado uma
posição estratégica, não uma punição. O servidor só sorteia pares que mantêm o mapa conectado.

**Arte:** [Direção de Arte §3.5.3](01-DIRECAO-DE-ARTE.md#353-ras-zamir--1928-no-deserto)
**Ilustração das cartas:** cianotipia sobre papel quadriculado de caderno de campo.

---

### 3.4 Meridiano-9 — 2189 · estação orbital · **[v1.1]**

> *A comandante morreu na câmara de vácuo e o registro biométrico dela foi apagado. Só uma coisa
> na estação tem acesso para apagar um registro.*

**A vítima:** Comandante Ilse Navarro, 47, morta na câmara de vácuo no ciclo 8.412.

| Suspeito | Quem é | Cor | Brasão |
|---|---|---|---|
| **Auditor Kell Ramos** | Enviado da corporação, chegou há nove dias | Âmbar | Selo corporativo |
| **Téc. Yara Mbeki** | Manutenção de suporte de vida | Verde-fosforescente | Chave inglesa |
| **Dr. Sung Park** | Médico da estação | Branco-osso | Seringa |
| **Piloto Vann Ostrowski** | Cargueiro atracado há três semanas | Vermelho-sinal | Emblema de voo |
| **Bióloga Rhea Adeyemi** | Hidroponia | Ciano | Folha |
| **NÚBIA** | A IA da estação, num corpo de manutenção | Cinza-alumínio | Anel concêntrico |

Sim, a IA é suspeita. E sim, é ela quem libera as pistas (ver a reviravolta). Aproveite.

**Objetos:** Descarga de plasma · Cabo de dados · Injetor médico · Chave de torque · Despressurização · Refrigerante criogênico

**Lugares e mapa** — anel externo de seis módulos com um núcleo de três. Não há becos, não há
profundidade: tudo dá volta. É o mapa mais "aberto" dos quatro, e o mais difícil de encurralar
alguém.

```
             ARQUIVO ─── PONTE
                │           │  ╲
   CASA DE MÁQUINAS      REFEITÓRIO ── DORMITÓRIOS
          │                  │              │
   DOCA DE CARGA ── HIDROPONIA          ENFERMARIA
          │  ╲                              ╱ │
          │   ╲── CÂMARA DE VÁCUO ─────────╯  │
          └───────────────────────────────────┘

   passagens secretas:  Arquivo    ⇄ Câmara de Vácuo  (duto de refrigeração)
                        Hidroponia ⇄ Enfermaria       (linha de oxigênio médico)
```

**Reviravolta — Registro da Estação.** A cada 4 rodadas, NÚBIA divulga publicamente **um fato
verdadeiro**: uma carta que comprovadamente **não** está no envelope.

O servidor escolhe, entre as cartas fora do envelope, aquela que o **maior número de jogadores ainda
não descartou** — então a informação sempre vale alguma coisa para a maioria. Todo mundo recebe ao
mesmo tempo, o que transforma a partida numa corrida: quem já tinha mais dados converte primeiro.

**Arte:** [Direção de Arte §3.5.4](01-DIRECAO-DE-ARTE.md#354-meridiano-9--2189-o-futuro-usado)
**Ilustração das cartas:** foto de crachá com varredura de CRT e etiqueta Dymo por cima.

---

### 3.5 Escolher, sortear ou ser surpreendido

Quatro modos no lobby — detalhados em [PRD 07 §3](07-SISTEMA-DE-TEMAS.md#3-escolher-sortear-ou-ser-surpreendido):

**Escolher** · **Aleatório** · **Surpresa** (o caso só é revelado quando a partida começa) · **Rodízio**

Em revanche, o botão principal é `Revanche · caso surpresa`. Um clique, mundo novo.

A reviravolta é desligável em **Regras da casa → Reviravolta do caso**. Quem quer o jogo limpo joga
o jogo limpo, em qualquer caso.

---

## 4. Regras base

1. O servidor sorteia 1 suspeito, 1 objeto e 1 lugar para o **envelope**. Ninguém pode ler.
2. As 18 cartas restantes são distribuídas. Quantas cartas cada um tem é informação pública.
3. Cada jogador começa num lugar diferente, sorteado.
4. No seu turno você tem **2 ações**.
5. Dentro de um lugar você pode **palpitar**: nomear um suspeito, um objeto e o lugar onde você está.
   O suspeito e o objeto nomeados são **movidos** para lá.
6. O jogador à sua esquerda tenta **refutar**: se tem alguma das três cartas, mostra **uma**, só para
   você. Se não tem, passa. O primeiro que puder refutar, refuta, e para por aí.
7. Todos veem **quem** refutou. Ninguém além de você vê **o quê**.
8. A qualquer momento no seu turno você pode **fechar o caso**, de graça, uma única vez na partida.
   Acertou os três → venceu. Errou → vira **Fantasma**.

---

## 5. O que quebra no Detetive original

| # | Problema | Por que dói |
|---|---|---|
| 1 | **O dado.** Tirou 2, ficou no corredor | Três turnos sem fazer nada. É pura sorte roubando seu turno |
| 2 | **Errou a acusação, acabou.** Assiste 20 minutos | Fica só refutando, mudo |
| 3 | **Anotar no papel é o jogo inteiro** e é chato | Quem esquece de anotar perde. Isso é secretariado, não dedução |
| 4 | **Dedução de terceiros não cabe na gradezinha** | "O Otávio tem uma de três" é 60% do jogo real e o material não suporta |
| 5 | **Tempo morto no turno dos outros** | Online é pior: você fica olhando |
| 6 | **Solvable demais com 3 jogadores** | Muita carta na mão, pouca dúvida |
| 7 | **A vitória é uma planilha resolvida**, sem clímax | Você diz três nomes e o jogo acaba |
| 8 | **Uma mansão só, para sempre** | Na quinta partida você já sabe onde ficam as passagens |

---

## 6. Melhorias

### 6.1 Ações, não dados [v1]

**Resolve o problema #1.** Cada turno dá **2 pontos de ação**:

| Ação | Custo | Notas |
|---|---|---|
| **Mover** para um lugar vizinho | 1 | Pelo grafo do caso |
| **Passagem secreta** | 1 | Vai direto ao outro lado |
| **Palpitar** | 1 | Só dentro de um lugar. **Encerra o turno** |
| **Fechar o caso** | 0 | Uma vez na partida, a qualquer momento do seu turno |

Você pode andar dois lugares, ou andar e palpitar, ou palpitar direto. **Nunca há um turno em que
você não faz nada.** A sorte continua na distribuição das cartas, que é onde ela pertence.

> Quem quiser o caos do dado: "Regras da casa → Movimento: Dado". Ninguém vai usar, mas existe.

### 6.2 O bloco de dedução [v1] — a melhoria central

**Resolve os problemas #3, #4 e #5.** É a razão pela qual este jogo funciona melhor no computador
do que na mesa.

**A grade.** 21 linhas (as cartas), uma coluna por jogador + uma coluna "Envelope". Cada célula
aceita `✓`, `✗`, `?` e cor de anotação.

**Preenchimento automático de fatos públicos** — todos concordam com estes, então o app anota sozinho
e a célula fica com fundo de *fato*, não de *dedução*:

- Suas próprias cartas → `✓` na sua coluna, `✗` no Envelope
- Alguém **não** refutou → `✗` nas três cartas, na coluna dele
- Alguém mostrou uma carta **para você** → `✓` naquela carta, na coluna dele

**Conjuntos — a parte que o papel não faz.** Quando alguém refuta um palpite que não é seu, o bloco
cria uma linha de conjunto:

```
Cândida tem 1 de:  [ Revólver ] [ Adega ] [ Dr. Vidal ]
```

Os conjuntos vivem numa faixa lateral sempre visível, encolhem sozinhos quando você marca `✗` num
membro, e viram `✓` automaticamente quando sobra um só.

**Isto é o que separa quem joga bem de quem joga mal no Detetive de mesa.** Dar isso a todo mundo
não deixa o jogo mais fácil — deixa o jogo ser sobre *o que você pergunta*, e não sobre *quem tem
letra mais organizada*.

**Três níveis de assistência**, escolhidos **por jogador**, não pela sala:

| Nível | O que o bloco faz |
|---|---|
| **Manual** | Grade vazia. Você anota tudo |
| **Assistido** (padrão) | Fatos públicos e conjuntos, sem resolver inferência encadeada |
| **Dedutivo** | Resolve toda inferência possível e avisa quando o envelope está determinado |

Quem quer o desafio puro joga no Manual contra alguém no Dedutivo, e ambos estão jogando o jogo que
querem.

**O bloco funciona no turno dos outros.** Isso mata o problema #5.

### 6.3 O Fantasma [v1]

**Resolve o problema #2.** Quem erra não sai do jogo:

- **Continua refutando** — obrigatório, senão o jogo perde informação
- Não pode mais acusar nem vencer
- Ganha o **Palpite de Além-Túmulo**: uma vez por partida, força um palpite qualquer, de qualquer
  lugar, na vez de quem ele escolher
- Aposta em segredo em quem vai vencer. Acertou, fica em 2º no placar
- O peão fica translúcido, com um filete de luz. O nome no placar fica em itálico

Cada caso chama o Fantasma pelo nome dele: *Fantasma* no Solar, *Encostado* na Aurora, *Insolado*
em Ras Zamir, *Desligado* no Meridiano-9.

### 6.4 Refutação com escolha e prazo [v1]

Com **duas ou três** cartas do palpite, **você escolhe** qual mostrar. É uma decisão estratégica real
— mostrar sempre a mesma carta esconde o resto da sua mão — que quase toda implementação digital
ignora, resolvendo automaticamente.

**Prazo de 30 segundos.** Estourou, o servidor escolhe a que você já mostrou mais vezes: a jogada
conservadora, que é o que a maioria faria. Um jogador travado nunca segura a partida.

### 6.5 O log de investigação [v1]

Todo palpite e toda refutação viram uma linha pública, escrita na voz do caso:

```
21:14  Otávio acusou Marisa, com a corda de piano, no Jardim de Inverno.
       Cândida mostrou uma carta.
21:16  Zilda acusou o Coronel, com o revólver, na Adega.
       Ninguém pôde refutar.        ← destacada em laca, com sino
```

Na Aurora, a mesma linha lê *"Ivan botou a culpa na Bete"*. Em Meridiano-9, *"Kell registrou uma
hipótese"*. O `copy` vem do pacote do tema
([PRD 07 §2](07-SISTEMA-DE-TEMAS.md#2-o-contrato-do-pacote)).

"Ninguém pôde refutar" é a linha mais importante do jogo. É quando a mesa inteira entende que alguém
está perto.

### 6.6 A reconstituição [v1]

**Resolve o problema #7.** Quem acerta não recebe um modal de "Você venceu!".

A câmera desce sobre o lugar. Tudo apaga menos o lugar do crime. O peão do assassino atravessa o
mapa. O objeto aparece na mão dele. A luz apaga. Silêncio de 1,2s. Então o cartaz, na tipografia do
caso:

```
      ERA O DR. ANSELMO VIDAL
      com o VIDRO DE VENENO
      no JARDIM DE INVERNO
```

Doze segundos. Pulável, mas ninguém pula na primeira vez.

Depois, o **dossiê de cada jogador**: quantos palpites fez, quantas cartas viu, e — a métrica mais
deliciosa — **em que rodada ele já teria conseguido resolver o caso com a informação que tinha**.
Fácil de calcular: temos o log completo e todas as mãos no fim.

### 6.7 As reviravoltas [v1]

**Resolve o problema #8, e é o que o sistema de temas entrega de mecânica.**

Cada caso carrega **exatamente uma** regra própria (§3). Uma, não duas — a restrição é o que impede
o sistema de virar uma bagunça de exceções. A regra precisa nascer do lugar, caber numa frase, e
mudar *como* se joga, não *quem* ganha.

| Caso | Reviravolta | O que muda |
|---|---|---|
| Solar das Acácias | — | O jogo limpo |
| Boate Aurora | **Apagão** | Uma rodada de refutações anônimas |
| Ras Zamir | **Tempestade de Areia** | Dois lugares fechados, com aviso de uma rodada |
| Meridiano-9 | **Registro da Estação** | Um fato público verdadeiro a cada 4 rodadas |

Desligável em Regras da casa.

> **CONSTRUÍDO** — migrações 0086–0091. As três rodam no servidor, e o cliente as narra.
>
> O que a construção acrescentou ao que está escrito acima:
>
> **A rodada precisou existir primeiro.** As três reviravoltas são contadas em rodadas e o
> estado do Dossiê não tinha nenhuma — tinha `turnSeat`, que é outra coisa. A rodada vira
> quando o turno DÁ A VOLTA, e não a cada N turnos: o N muda quando alguém vira fantasma.
>
> **A reviravolta é congelada no início da partida.** A regra da casa é lida uma vez, em
> `dossie_start`. Lida a cada rodada, o anfitrião desligaria o Apagão na rodada 5 depois de
> ver que ele cairia na 6 — e regra que se desliga quando incomoda é sugestão. Pelo mesmo
> motivo a rodada do Apagão é sorteada AGORA e guardada: sorteada na hora, "uma vez por
> partida entre a 4 e a 8" viraria "toda rodada, com 20% de chance".
>
> **O palpite não é porta.** Palpitar convoca o peão do suspeito nomeado para a sala de quem
> palpitou. Durante a tempestade, feito de dentro de um lugar fechado, isso seria uma porta dos
> fundos: quem está preso arrastaria a mesa inteira para dentro, um palpite por vez. O objeto
> continua vindo — "ninguém entra" é sobre gente.
>
> **O apagão fabricava conhecimento falso.** `dossie_deduz` marcava quem NÃO tem a carta com
> `mp.seat is distinct from (linha ->> 'from')`. Com `from` nulo, isso é verdade para TODO
> assento — uma carta mostrada no escuro marcava a mesa inteira, inclusive quem mostrou. Não
> é perder informação, é inventar, e ela se propaga até a máquina acusar com certeza uma carta
> que está na mão de alguém.
>
> **O validador de temas ganhou a lista das três.** Um pacote que declare uma reviravolta que o
> motor não executa é reprovado na publicação. Sem isso, `twist` seria configuração
> decorativa: a tela prometendo o que a partida não entrega, sem nada quebrar para acusar.

### 6.8 Cartas de Pista [v1.1]

**Resolve o problema #6.** Baralho de 24 cartas. A ação **Investigar** (1 ação, só em lugares sem
outros jogadores) compra uma:

| Carta | Efeito |
|---|---|
| **Interrogatório** | Escolha um jogador. Ele mostra uma carta da mão, do tipo que você pedir |
| **Álibi** | Na próxima vez que precisar refutar, você pode não refutar. Uma vez |
| **Impressão digital** | O servidor diz se o suspeito do envelope está entre dois que você nomear |
| **Chave-mestra** | Mova-se para qualquer lugar, de graça |
| **Recado anônimo** | Escolha um jogador. Ele vê uma carta que **não** está no envelope |
| **Tempo é curto** | O próximo jogador tem 1 ação em vez de 2 |

Cada caso reescreve os nomes e a arte, mantendo os efeitos: na Aurora, "Interrogatório" vira
"Conversinha no banheiro"; no Meridiano-9, "Chave-mestra" vira "Acesso de manutenção".

Só entra em "Regras da casa → Modo Avançado".

> **Feito** — migrações 0103 a 0106. O baralho é DERIVADO da semente da partida e não guardado
> em lugar nenhum: derivar duas vezes dá o mesmo, e não há linha para vazar. `pistas` fica nulo
> quando a mesa jogou sem o modo, e nulo não é zero tirado — `dossie_investigar` recusa com
> `SEM_PISTAS`, então uma chamada solta não injeta carta numa mesa que escolheu jogar sem elas.
>
> **O Modo Avançado é DESLIGADO por padrão, e a reviravolta é ligada.** Parece incoerente e não
> é: a reviravolta é a mecânica que o *caso* entrega, e sem ela a Boate Aurora é o Solar com
> outra roupa. As Cartas de Pista são uma sétima coisa para aprender numa mesa que já tem seis
> suspeitos, nove lugares, um caderno de dedução e uma regra própria.
>
> **Cinco das seis resolvem no servidor; o Interrogatório abre uma fase.** E o que separa essa
> fase da refutação é o que acontece depois: a refutação ENCERRA o turno de quem palpitou, o
> interrogatório o DEVOLVE. Sem isso a carta seria "passar a vez com informação", e ninguém a
> jogaria no começo do turno — que é justamente quando ela serve.
>
> **A impressão digital vale a pena nos dois resultados.** O NÃO risca os dois nomeados; o SIM
> risca os outros quatro. Uma carta que só serve quando dá sorte é uma carta que ninguém joga, e
> aqui a decisão é *quais dois nomear*, não *será que dá certo*.
>
> **O preço de toda carta é exposição.** A impressão digital anuncia quais dois nomes foram
> comparados e nunca a resposta; o interrogatório anuncia a quem se perguntou e sobre o quê; o
> recado anuncia que saiu e nunca para quem. É o que o Dossiê cobra por tudo.
>
> **O caderno de gente aprende as mesmas coisas que o da máquina.** `apura` no cliente e
> `dossie_deduz` no servidor leem os mesmos avisos e o mesmo `interroga_nada` — sem isso, quem
> joga com o bloco assistido ficaria abaixo da máquina, riscando à mão o que ela risca sozinha.
>
> **A máquina joga o modo inteiro** — migração 0107. Ela investiga com a primeira ação num lugar
> que já riscou e onde não há mais ninguém, e anda com a segunda; e joga o que compra, por regras
> que dá para conferir de olho, sem fórmula com peso. O álibi é o único difícil: ela o gasta quando
> tem UMA carta para mostrar e nunca mostrou aquela carta àquela pessoa — que é exatamente quando
> refutar entrega informação nova.
>
> **Cada caso dá o seu nome às seis cartas** — `copy["pista.<id>"]`, migração 0108 para o Solar e
> `seed-dossie.mjs` para os outros três. A mesma carta é *Chave do caseiro* no Solar, *Passe de
> camarim* na Aurora e *Acesso de manutenção* no Meridiano-9. O validador cobra as seis ou nenhuma.
>
> **E a regra da casa tem onde ser ligada.** Isto quase não aconteceu: `set_room_settings` aceitava
> `avancado` desde 0104 e o lobby não tinha o botão — o modo inteiro era inalcançável pelo
> navegador, sem nada quebrar. Agora há uma auditoria em `scripts/smoke.mjs` que lê as chaves que o
> servidor aceita e cobra que cada uma apareça no lobby.

### 6.9 Modo Assassino [v1.1]

Variante um-contra-todos, e a que a mesa mais vai pedir depois de conhecer.

Um jogador é sorteado assassino e **recebe a solução**. Joga normalmente, mas:
- Pode **mentir uma vez** por partida: refutar mostrando uma carta que não tem, ou dizer que não
  pode refutar quando podia — *ainda não construído*
- Vence se ninguém fechar o caso corretamente em **12 rodadas** ✅
- Se alguém acertar, o assassino perde e todos os detetives ganham ✅

Os detetives não sabem quem é. Transforma o jogo em dedução social. Combina especialmente bem com
**Meridiano-9** — a IA suspeita que também distribui as pistas é o melhor assassino possível.

> **CONSTRUÍDO** — migração 0116, menos a mentira.
>
> **O ASSASSINO NÃO FECHA O CASO, e essa é a primeira regra.** Ele sabe a resposta: sem a
> proibição, o modo inteiro dura um turno — ele acusa, acerta, e ganha como detetive. Não é caso
> extremo, é a jogada ÓBVIA e a primeira que qualquer pessoa tentaria. `ASSASSINO_NAO_ACUSA` no
> servidor, e não escondendo o botão: quem descobrisse a chamada ganharia a partida.
>
> **O assassino é GENTE, sempre que houver gente.** Duas razões, e a segunda decide. De jogo: a
> máquina não usaria a informação — ela deduz porque não tem outro jeito, e dar-lhe o envelope sem
> ensiná-la a mentir produz um assassino que joga igual a um detetive. De confiança: a suíte
> confere, partida a partida, que NENHUMA máquina risca carta do envelope, e essa frase vale
> porque é absoluta. Uma exceção — "menos quando ela é o assassino" — é o tipo de furo que se abre
> uma vez e some dentro de um `if` para sempre.
>
> **O MODO é público; a PESSOA não.** Todo mundo sabe que há um assassino na mesa — é isso que faz
> a mesa olhar de lado para todo mundo — e o assento dele não está no estado público. Mora no
> privado de quem é, protegido pela mesma RLS que protege a mão de cada um.
>
> **O relógio fica à vista desde a primeira rodada.** Um limite que só aparece quando estoura é
> armadilha, não regra — e a tensão do modo é justamente ver o número subir.
>
> **Falta a mentira**, que é a metade social da variante: refutar com uma carta que não se tem, ou
> passar podendo refutar. Uma vez por partida, e catchável — é o que dá à mesa alguma coisa para
> desconfiar além de comportamento.

---

## 7. Fluxo de partida

```
LOBBY → escolha do caso (ou Aleatório / Surpresa / Rodízio) → escolha de suspeito → Começar
  │
  ▼
ABERTURA DO CASO (6s, pulável a partir do 2º segundo)
  │ capa · título na tipografia do tema · era e chamada · corte para o mapa
  ▼
DISTRIBUIÇÃO (5s)
  │ envelope sorteado, 18 cartas voando em arco para as mãos
  ▼
TURNO  (90s, timer visível)
  │  2 pontos de ação
  │    Mover → peão anda, com o som de passo daquele lugar
  │    Palpitar → suspeito e objeto voam até o lugar
  │      └─ REFUTAÇÃO (30s por jogador, em ordem)
  │           • modal privado para quem pode refutar
  │           • a carta escolhida aparece só para o autor do palpite,
  │             entrando por baixo da tela, virada
  │           • todos os outros veem apenas: "Cândida mostrou uma carta"
  │    Fechar o caso → tela isolada, confirmação dupla
  │
  │  [reviravolta do caso dispara aqui, quando aplicável]
  ▼
FIM
  │ acerto  → RECONSTITUIÇÃO → dossiês → placar → Revanche · caso surpresa
  │ erro    → vira Fantasma, turno passa
  │ todos fantasmas → envelope revelado, ninguém vence
```

Durante **todo** o tempo, o bloco de dedução está aberto e editável por todos.

---

## 8. Modelo de dados

```jsonc
// matches.public_state
{
  "theme": "boate-aurora",                // qual caso. Ausente até o início no modo Surpresa
  "phase": "turn",                        // deal | turn | refute | accuse | reveal
  "turnSeat": 2,
  "actionsLeft": 1,
  "positions": { "0": "pista", "1": "deposito", ... },
  "objects":   { "taco": "bar", "extintor": "vip", ... },
  "handSizes": { "0": 3, "1": 3, "2": 4, "3": 3 },
  "ghosts": [1],
  "twist": {                              // estado da reviravolta do caso
    "id": "apagao", "activeUntilRound": 6, "fired": true
  },
  "log": [
    { "seq": 14, "type": "suggest", "seat": 2,
      "guess": ["marcao", "taco", "cabine"] },
    { "seq": 15, "type": "refute", "seat": 4, "shown": true },
    { "seq": 16, "type": "refute", "seat": null, "shown": true, "anon": true }
  ]
}
```

`"seat": null, "anon": true` é o apagão da Aurora. O mesmo formato de log serve para os quatro casos.

```jsonc
// match_private_state.data — RLS: user_id = auth.uid()
{
  "hand": ["taco", "deposito", "marcao"],
  "seen": [
    { "card": "cabo", "from": 4, "seq": 15 },
    { "card": "vip",  "from": null, "seq": 16 }   // visto durante o apagão
  ],
  "pad": {
    "marks": { "taco": { "0": "x", "2": "check" } },
    "sets":  [ { "seat": 4, "cards": ["taco","deposito","marcao"], "seq": 15 } ],
    "assist": "assistido"
  },
  "role": "detetive"
}
```

```sql
-- Colunas SEM policy de leitura. Só as RPCs SECURITY DEFINER acessam.
alter table matches add column solution jsonb;      -- {"suspect":..,"weapon":..,"room":..}
alter table matches add column hidden_theme text;   -- no modo Surpresa, até o início
```

### Ações (RPC)

| RPC | Valida |
|---|---|
| `dossie_move(match, room)` | É seu turno · tem ação · o lugar é alcançável **no grafo do caso atual** · o lugar não está fechado por tempestade |
| `dossie_suggest(match, s, w)` | É seu turno · tem ação · você está num lugar · inicia a cadeia de refutação |
| `dossie_refute(match, card)` | Você é o refutador da vez · **a carta está de fato na sua mão** · é uma das três do palpite |
| `dossie_pass_refute(match)` | Você é o refutador da vez · **você não tem nenhuma das três** (o servidor confere — não dá para "esquecer" de refutar) |
| `dossie_accuse(match, s, w, r)` | É seu turno · não é Fantasma · ainda não acusou |
| `dossie_pad(match, patch)` | Escreve só no seu `private_state.pad`. Sem validação de regra — é o seu caderno |

**Nenhuma dessas funções conhece o nome de um cômodo.** Todas operam sobre o grafo carregado do
pacote do tema. É isso que faz um caso novo ser conteúdo, não engenharia.

A validação de `dossie_pass_refute` é o detalhe que impede a trapaça mais óbvia do jogo.

---

## 9. Direção de arte

As quatro paletas, tipografias, referências e — o mais importante — os **guardrails anti-slop de
cada estética** estão em [Direção de Arte §3.5](01-DIRECAO-DE-ARTE.md#35-os-quatro-casos-do-dossiê).
Resumo do que é comum aos quatro:

**A cena** é sempre a mesma máquina: planta baixa em **2.5D isométrico**, paredes extrudadas a 40%
da altura, vista de cima. Não é uma cena navegável — é uma maquete. O extrusor lê o `poly` de cada
lugar direto do pacote do tema; não existe "modelo da mansão" nem "modelo da estação".

**Iluminação como mecânica visual.** Cada lugar tem uma fonte de luz própria, declarada no pacote.
Lugares **vazios** ficam apagados. Lugares **com jogadores** acendem. Num palpite, o lugar ganha um
spot e o resto escurece 40%. A atenção vai sozinha para onde o jogo está. Isso vale igual para um
abajur de 1953, um lampião de 1928, um refletor de 1987 e uma luz de emergência de 2189 — o que muda
é a cor e a dureza da sombra.

**Peões 3D** com silhueta distinta por suspeito, reconhecíveis a 24px. Seis malhas por caso, ≤ 240 KB.

**Cartas 2D**, em leque na base da tela, com rotação real e sobreposição. Cada caso tem sua técnica
de ilustração (§3), escolhida por ser rápida **e** consistente.

**A refutação** é o momento de arte mais importante, e é igual nos quatro: a carta vem **por baixo**,
entrando pela borda inferior, virada. Você **segura** para ver. Solta, ela volta. Ninguém mais vê
nada — nem a animação.

**Bloco de dedução:** o suporte muda por caso (papel pautado em 1953, caderno de campo em 1928,
guardanapo da boate em 1987, terminal de datapad em 2189), mas a estrutura é idêntica. Fatos
automáticos em tinta impressa; suas anotações, em tinta de caneta. A diferença entre *fato* e
*palpite seu* é imediata.

---

## 10. Escopo

### v1
- Motor 100% agnóstico de tema + contrato de pacote + validador no CI
- **Dois casos completos: Solar das Acácias e Boate Aurora**
- Seleção: Escolher, Aleatório, Surpresa, Rodízio + abertura de caso
- Reviravolta (Apagão) com chave de liga/desliga
- Sistema de 2 ações, passagens secretas
- Palpite, refutação com escolha, fechamento do caso
- Bloco de dedução com os 3 níveis e a faixa de conjuntos
- Fantasma com Palpite de Além-Túmulo
- Log narrado na voz do caso
- Reconstituição e dossiês finais
- Timers e fallbacks
- Mapa 2.5D com iluminação por lugar, peões 3D, cartas 2D

### v1.1
- **Ras Zamir** e **Meridiano-9** (com Tempestade de Areia e Registro da Estação)
- Cartas de Pista (Modo Avançado)
- Modo Assassino
- Movimento por dado (regra da casa nostálgica)
- Estatísticas por caso

### Futuro
- Quinto caso — trem noturno, 1961
- Modo "Caso Frio": 2 jogadores, com um baralho de eventos no lugar dos outros detetives
- Editor de caso da comunidade (o contrato já é um JSON; falta a UI e a moderação)

---

## 11. Critérios de aceite

**Segurança — o mais importante deste jogo**
- [x] O `solution` nunca aparece em nenhuma resposta de rede antes do fim — `select=*` na partida
      dá 403, `dossie_start` não o carrega, e a coluna não tem grant de SELECT para papel de
      cliente nenhum
- [x] Jogador A não lê a mão de B — e quem não joga a partida não lê mão nenhuma
- [x] Refutar com carta que não está na mão falha no servidor — e com carta que não é do palpite
      também
- [x] `dossie_pass_refute` falha se o jogador tem alguma das três cartas
- [x] A linha de refutação no registro **não** contém a carta mostrada — o registro vive em
      `public_state.log` e não numa tabela `match_events`, que nunca foi construída
- [ ] No modo Surpresa, o tema não aparece em nenhuma resposta antes do início da partida
- [x] Espectador não recebe nenhuma mão nem a solução

**Temas**
- [x] Os quatro pacotes passam no validador de [PRD 07 §5](07-SISTEMA-DE-TEMAS.md#5-validador--roda-no-ci-reprova-o-build)
      — `npm run dossie`, e nada é publicado se um reprovar
- [x] Adicionar um caso novo não toca em nenhum arquivo do motor — os três casos novos entraram
      sem uma linha de SQL e sem uma linha de React
- [x] Nenhuma RPC contém um `id` de cômodo, suspeito ou objeto escrito à mão — auditado a cada
      rodada: os 83 ids dos quatro casos, procurados nas 39 funções `dossie_*`. É o tipo de
      promessa que apodrece em silêncio, porque um `if sala = 'biblioteca'` escrito às pressas
      funciona e passa em todo teste — e quebra o próximo tema
- [ ] Trocar de caso entre revanches não recarrega a página
- [ ] Rodízio não repete caso até esgotar
- [ ] Cada pacote pesa ≤ 900 KB e só baixa quando a partida começa

**Reviravoltas** — todos verificados em `npm run smoke:dossie`
- [x] **Apagão:** o log registra `seat: null` e o `private_state` do destinatário grava `from: null`
- [x] **Apagão:** o bloco de dedução não cria conjunto atribuído durante o apagão
- [x] **Tempestade:** o aviso vem uma rodada antes; o par sorteado nunca desconecta o mapa —
      conferido por enumeração COMPLETA dos 144 pares dos quatro mapas, e 5 deles são recusados
      (fechar o Poço e o Mirante isola a Câmara Selada), o que prova que a checagem tem dentes
- [x] **Tempestade:** quem está num lugar fechado pode palpitar, mas não sair — e nem entrar
- [x] **Registro:** a carta divulgada nunca está no envelope
- [x] **Registro:** a carta escolhida é a que mais jogadores ainda não descartaram
- [x] Reviravolta desligada nas Regras da casa → o caso roda como jogo limpo

**Regras**
- [x] Mover para lugar não adjacente **no grafo daquele caso** é rejeitado
- [ ] Palpitar fora de um lugar é rejeitado
- [x] Palpitar encerra o turno mesmo com ação sobrando
- [x] Palpitar move o suspeito e o objeto nomeados — menos para dentro de lugar fechado pela
      tempestade, que seria porta dos fundos
- [x] A cadeia de refutação segue a ordem e para no primeiro que refuta
- [x] Segundo fechamento de caso do mesmo jogador é rejeitado
- [x] Fantasma continua sendo consultado na cadeia de refutação — e não recebe mais turno

**Bloco**
- [x] Fato público é marcado automaticamente, igual para todos — dois jogadores com mãos
      diferentes tiram do MESMO registro exatamente os mesmos fatos
- [x] Conjunto encolhe ao marcar `✗` num membro e vira `✓` ao sobrar um
- [x] Manual não preenche nada; Dedutivo resolve uma cadeia de 3 inferências — uma em que
      nenhum passo isolado dá a resposta: os cinco suspeitos na mão provam o sexto no envelope,
      o envelope prova os outros fora dele, e o que sobra fecha o tipo
- [ ] O bloco é editável durante o turno dos outros

**Fluxo**
- [ ] Quem não refuta em 30s tem a carta escolhida pelo servidor e o jogo segue
- [x] Todos desconectados: a partida termina sozinha e revela o envelope — a faxina encerra, e
      desde 0071 ela pula a mesa abandonada em vez de jogá-la para uma plateia vazia
- [ ] Reconectar restaura mão, bloco, posição e o estado da reviravolta

**Sensação**
- [ ] Alguém olhando sua tela por cima do ombro não vê a carta refutada sem você segurar
- [ ] A reconstituição roda em 60fps no Galaxy A54, nos quatro casos
- [ ] Peões distinguíveis em escala de cinza, nos quatro casos — **MEDIDO, e a paleta não
      sustenta.** As oito cores da plataforma têm luminância entre 24 e 61, com dois grupos
      praticamente colados: vinho/prússia/carmim em 24–27, e terracota/jade em 39,6/40,0. Nos
      quatro casos publicados o par mais parecido fica em ΔL 0,3 (Ras Zamir), 0,8 (Meridiano-9 e
      Solar) e 2,2 (Aurora).

      Não é escolha de elenco: por força bruta, dos 28 conjuntos de seis cores possíveis apenas
      DOIS chegam a ΔL 3, e 3 ainda é pouco para o olho. O que resolveria é abrir a faixa de
      luminância da paleta — decisão de direção de arte, não de quem publica um caso. Por isso
      `npm run dossie` MEDE e imprime o número a cada publicação, em vez de reprovar tema por
      uma coisa que o tema não pode consertar.

      **E o impacto hoje é zero**, o que muda a urgência: `suspects[].color` e `suspects[].crest`
      não são lidos por nenhum componente. O peão no mapa é o avatar do JOGADOR, que carrega
      corpo e enfeite além da cor — os dois canais que o PRD 00 §110 promete para quem não
      separa as cores. Os campos do pacote existem para os peões 3D que ainda não existem.
- [ ] Cada caso passa no teste de [Direção de Arte §1](01-DIRECAO-DE-ARTE.md)
