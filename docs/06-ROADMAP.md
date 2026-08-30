# PRD 06 — Roadmap

**Premissa das estimativas:** 1 desenvolvedor com assistência de IA, ~20h/semana. Multiplique ou
divida conforme o time. Os números são em **semanas de calendário**, não em horas de esforço.

**Regra que vale mais que o cronograma:** entre uma fase e a seguinte existe um **portão de
qualidade**. Se o jogo anterior não passa nos critérios de aceite do PRD dele, o próximo não começa.
Quatro jogos medianos valem menos que um jogo excelente.

---

## Fase 0 — Fundação · 2 a 3 semanas

Nada de jogo. Só o chassi.

| Entrega | Detalhe |
|---|---|
| Next.js 16 + Vercel `gru1` + Supabase São Paulo | Projeto rodando, deploy automático |
| Auth completo | Google, Discord, magic link, **e anônimo** com promoção de conta |
| Esquema do banco + RLS + testes de RLS no CI | Ver [PRD 00 §8.3–8.4](00-PRD-PLATAFORMA.md) |
| Salas: criar, código, link, QR, entrar, sair | Os três caminhos de convite |
| Lobby: presença ao vivo, assentos, cores, ready, chat | Broadcast + Presence funcionando |
| Reconexão e migração de host | Testado desligando o wi-fi |
| Design tokens + textura + tipografia + sistema de movimento | O CSS de [PRD 01](01-DIRECAO-DE-ARTE.md) |
| Conjunto inicial de ícones autorais (~15) e 24 avatares | |
| CI: `axe-core`, `size-limit`, regressão visual | |

**Um "jogo" de mentira** — um botão que todo mundo aperta e um contador compartilhado sobe — para
exercitar RPC → `match_events` → Realtime → animação de ponta a ponta. Descartável, e vale cada hora.

**Portão:** seis pessoas em seis dispositivos entram numa sala pelo QR, veem umas às outras, uma
fecha o navegador e volta, o host sai e outro assume — tudo sem recarregar a página.

---

## Onde o projeto está de verdade

Isto não é estimativa — é o que existe e roda, medido no dia em que esta seção foi escrita.
Números vêm de contar, não de lembrar: **91 migrações** aplicadas, 30.858 linhas de SQL,
32 componentes, e **760 verificações** em cinco suítes de fumaça que rodam contra o
Supabase de verdade, mais uma suíte de lógica pura que roda sem banco (`npm run smoke:bloco`,
o caderno do Dossiê).

### A plataforma

| Entregue | Estado |
|---|---|
| Chassi Next 16 + Vercel `gru1` + Supabase São Paulo | ✅ no ar |
| Sessão de convidado, nativa **e** por `/api/guest` (sem depender de toggle de painel) | ✅ |
| Perfil persistido, avatares animados (respiram e piscam, com compasso próprio por hash) | ✅ |
| Salas: código, link, QR, lobby ao vivo, cor, pronto, migração de host | ✅ |
| XP, patente, 11 medalhas, confete | ✅ |
| Som sintetizado por Web Audio nos quatro jogos, sem um único arquivo de áudio | ✅ |
| Auditoria de privilégio no CI: a lista de funções chamáveis é conferida nos dois sentidos | ✅ |
| **Jogar sozinho contra a máquina nos quatro jogos**, num toque a partir da carta | ✅ |
| Auditoria de `_como`: nenhuma delas pode olhar `auth.uid()` — o ator é parâmetro | ✅ |
| Auditoria de `seat` ambíguo, porque a regra foi quebrada três vezes | ✅ |
| `npm run css`: toda classe do projeto usada num componente tem estilo | ✅ |
| Auth com Google, Discord e magic link | ⬜ só convidado e senha, por enquanto |
| `axe-core`, `size-limit` e regressão visual no CI | ⬜ |

### Os quatro jogos

Todos os quatro **jogam**. Não é "o motor está pronto": é começar uma sala, convidar
gente e terminar uma partida.

| | Motor | Interface | Verificações | O que falta |
|---|---|---|---|---|
| **Letreiro** | ✅ | ✅ | 143 | — |
| **Dossiê** | ✅ | ✅ | 128 | — |
| **Domínio** | ✅ | ✅ | 187 | — |
| **Metrópole** | ✅ | ✅ | 285 | animação de construção |

**Letreiro** — dicionário de 248.632 palavras com frequência de fala, bandeja de 4×4 ou 5×5,
1.801 grades aprovadas por solver, pontuação por letra, revelação em três atos que mostra só
palavra que gente usa.

**Dossiê** — caso narrado com chuva animada, planta baixa, refutação, caderno de dedução com
três níveis de ajuda, e o desfecho. Quatro casos publicados, e três deles com a **reviravolta**
que o PRD 03 §6.7 pede: o Apagão da Boate Aurora, a Tempestade de Areia do Ras Zamir e o
Registro da Estação do Meridiano-9. Desligáveis nas Regras da Casa, para quem quer o jogo limpo.

**Domínio** — Vantara com 42 territórios, combate com a matemática provada por enumeração de
força bruta, ciclo de turno completo, e o modo **Campanha** (12 rodadas, placar, ninguém é
eliminado) além do Clássico.

**Metrópole** — Capibara com 40 casas, leilão obrigatório, contratos que o servidor cobra
sozinho (parcelamento, isenção de aluguel, opção de compra), painel de fluxo de caixa com a
distribuição estacionária do tabuleiro calculada de verdade, o Investidor, seis eventos da
cidade, e quatro regras da casa com o custo em minutos na etiqueta.

### O que a construção ensinou, e que não estava em nenhum PRD

Cinco regras que saíram de defeitos reais, todas com o teste que as guarda:

1. **Dinheiro não passa por ponto flutuante.** `Math.ceil(1300 * 1.1)` dá 1431 e o servidor
   cobra 1430 — a tela prometia um real a mais em seis das treze faixas de hipoteca.
   Porcentagem virou fração de inteiros em todo o projeto.

2. **Em jsonb, ausência é NULL, e comparação com NULL é NULL.** Isso derrubou duas coisas:
   o patrimônio contava toda propriedade sem dono para todos os jogadores, e a faxina do
   Dossiê caía no ramo errado em toda partida fora de refutação — abortando a varredura
   inteira, o que significava que ninguém nunca perdia o turno no relógio.

3. **Revogar de PUBLIC não basta.** O projeto Supabase concede EXECUTE a `anon` e
   `authenticated` por ALTER DEFAULT PRIVILEGES. Dezesseis funções internas ficaram abertas,
   e uma delas recebia o estado da partida como argumento e gravava.

4. **Teste de sorteio mede DISTRIBUIÇÃO, não "acontece pelo menos uma vez".** Um teste fraco
   reprovou e revelou que `shuffle_text` — um Fisher-Yates com LCG lendo os bits baixos —
   enviesava o culpado do Dossiê, a repartição do mapa do Domínio e os baralhos da Metrópole.
   Dois dos seis eventos da cidade nunca saíam.

5. **Dentro de PL/pgSQL, nome de variável e alias de subconsulta vivem no mesmo espaço.**
   Uma variável com nome de coluna matou `dominio_start`; um alias com nome de variável matou
   `met_bankrupt`.

### Onde está a maior lacuna

**Nenhuma tela foi vista.** Tudo aqui foi verificado por tipo, lint, build, 514 verificações
contra o banco real e as páginas respondendo 200 num servidor de verdade — mas layout,
contraste, o que cabe num celular e se a coisa é agradável de usar estão fundamentados no
código, não observados. É a primeira coisa a fazer com olhos humanos.

Ela continua sendo a maior lacuna — mas encolheu, e encolheu pelo único lado que dá para
encolher sem olhos: **a parte dela que é aritmética**. `npm run css` faz quatro perguntas e
todas têm resposta calculável a partir do código:

| | o que prova | o que achou |
|---|---|---|
| classe sem CSS | todo `className` do projeto tem estilo | 2, um deles no botão de ENTRAR NUMA SALA |
| campo sem nome | todo `<input>` tem nome acessível | 5 campos de cláusula da Metrópole |
| contraste | toda regra que pinta texto e fundo passa no piso da WCAG AA | 6 pares |
| alvo de toque | nenhum botão abaixo de 44px | 6 botões, de 36px a 42px |

Os seis de contraste eram todos o mesmo erro, e ele é estrutural: a paleta viva deste projeto
é CLARA de propósito — é o que faz o tabuleiro parecer brinquedo e não planilha —, e branco
por cima não passa em nenhum dos dez tons (de 1.48:1 no limão a 3.58:1 no roxo). A tinta passa
em todos, de 4.94:1 a 11.99:1. Os botões principais já faziam certo; cinco etiquetas e um botão
tinham escorregado para branco.

O que a auditoria NÃO vê, e importa dizer: cor herdada de um pai, fundo de gradiente ou com
alfa, layout, ritmo, e se a coisa é agradável de usar. Ela cobre 47 das 81 regras que pintam
as duas coisas, e diz isso na saída — senão "0 problemas" mentiria sobre a cobertura.

E `npm run css` ganhou a segunda metade: todo `<input>` tem nome acessível. Achou cinco campos
de cláusula da Metrópole cercados de `<span>` que explicam tudo para quem enxerga e nada para
quem não enxerga.

Depois disso, em ordem de valor: as **cartas de pista** do Dossiê (§6.8), as estatísticas e as
quatro bandejas temáticas do Letreiro, e a animação de construção da Metrópole.

### E o que entrou depois desta seção ser escrita

| | |
|---|---|
| Desafio diário do Letreiro | ✅ mesma grade para todo mundo, placar do dia |
| Vocabulário do Letreiro consertado | ✅ corte por posto que ESCALA com o tamanho da palavra, mais 327 nomes e estrangeirismos curados — a revelação parou de mostrar ONO, ADE, ADELE e GATE |
| Máquinas nos quatro jogos | ✅ ver [08 — As Máquinas](08-MAQUINAS.md) |
| Leilão de falência da Metrópole (§5.1 do PRD) | ✅ as escrituras de quem quebra vão a leilão em fila, e não ao banco |
| O relógio não corre contra quem está sozinho | ✅ |
| Mesa abandonada deixa de ser varrida | ✅ 27 partidas rodavam para uma plateia vazia até a sala expirar |
| Trégua com preço do Domínio (§6.6 do PRD) | ✅ o servidor DEIXA romper, e cobra: dois exércitos e a marca de Traidor |
| Auditoria do `jsonb_set` com pai ausente | ✅ o mesmo defeito apareceu **cinco vezes**, cada uma ao lado de um comentário meu explicando a armadilha — a quinta foi dentro de um TESTE, e a auditoria agora varre as suítes também |
| As três reviravoltas do Dossiê (§6.7 do PRD) | ✅ Apagão, Tempestade de Areia e Registro da Estação, com 23 verificações — a da tempestade confere a conexidade por enumeração COMPLETA dos 144 pares |
| Todo campo de digitação tem nome acessível | ✅ `npm run css` prova, e achou cinco |
| Contraste e alvo de toque medidos | ✅ a maior lacuna do projeto encolheu pelo lado que é aritmética — 6 pares de cor abaixo do piso da WCAG e 6 botões menores que o dedo |
| As quatro bandejas do Letreiro | ✅ seis tokens de CSS, zero regra, e a escolha congela na partida |
| Estatísticas do Letreiro (§6.9) | ✅ três das quatro. A "palavra mais rara" guardou `sodomia` na primeira rodada de teste — o seletor procura o incomum, e é ali que mora o palavrão |
| As suítes deixam de morrer com a conexão | ✅ `pg.Pool` no lugar de `pg.Client`: suíte vermelha por causa da rede é o pior vermelho que existe |
| Modo Relâmpago do Domínio | ✅ o último modo que faltava nos quatro jogos. 24 territórios recortados de Vantara por programa, e o mesmo validador para os dois mapas |
| O cliente tinha TRUNCATE em quatro tabelas | ✅ **RLS não se aplica a TRUNCATE**. Em `matches`, `anon` podia apagar a tabela e não podia lê-la. Mesma causa de 0022: o default do Supabase é `GRANT ALL`, e ALL inclui TRUNCATE |
| Os critérios de aceite conferidos contra a EVIDÊNCIA | ✅ os PRDs subestimavam o que está construído, e checklist desatualizado é pior que nenhum. Domínio 17→6, Letreiro 24→11, Dossiê 31→15, Plataforma 11→8 — e o que fica aberto fica com o motivo escrito |
| O bloco de dedução ganhou testes | ✅ ele é "o que separa quem joga bem de quem joga mal" e não tinha nenhum. O Node 24 tira os tipos sozinho: 16 verificações de lógica pura, zero dependência nova |
| Cliente e servidor concordam sobre o remanejo | ✅ `conectados` (TypeScript) e `dominio_conectado` (PL/pgSQL) respondem a mesma pergunta e não compartilham código. 3.200 comparações nos dois mapas: a tela não acende o que o servidor recusa |
| A abertura do Dossiê quebrava em três dos quatro casos | ✅ **primeiro relato de alguém JOGANDO**, e ele achou de primeira o que 760 verificações de servidor não achariam nunca: a narração publicada como objeto, e a abertura a percorre com `.map` |
| A tela de erro passa a dizer o que aconteceu | ✅ não havia `global-error`. A parede padrão do Next, em inglês, sem a mensagem — quem relata só conseguia dizer "deu erro" |
| `npm run smoke:pacotes` | ✅ a fronteira entre o conteúdo que o cliente EMPACOTA e o que o servidor PUBLICA. Editar `vantara.json` sem republicar faz a tela desenhar uma fronteira que o servidor não conhece |
| `npm run smoke:render` | ✅ 27 telas dos quatro jogos MONTADAS com o conteúdo publicado, sem navegador e sem dependência nova — o SWC já vem dentro do Next. Reproduz o defeito da abertura e achou um segundo: o peão do tabuleiro da Metrópole era a única leitura de cor sem rede |
| As telas INTEIRAS do Domínio, da Metrópole e do Letreiro | ✅ 44 KB, 21 KB e 6 KB de HTML com uma partida de verdade. As folhas não têm o que o contêiner tem: o ramo por FASE |
| E o HTML que SAIU, auditado | ✅ três coisas que só o resultado revela: controle dentro de controle, `id` repetido, campo sem nome. Achou o `id` do avatar, que saía de um hash do bichinho — dois jogadores com o mesmo bicho colidiam |
| A hachura das facções e dos grupos ganhou guarda | ✅ a ligação mora no CSS e a paleta no TypeScript, e nada obrigava as duas a andarem juntas. Uma cor nova sem trama volta a ser só cor, e nada acusa |
| `npm run verifica` | ✅ as doze etapas num comando, com relatório. As cinco suítes em paralelo: **29,6 min → 12 a 19 min** (a variação é latência de rede, e ela é grande: a mesma suíte do Dossiê mediu 354s e 776s em rodadas seguidas) |
| A mentira do Modo Assassino (§6.9 do PRD) | ✅ a metade social da variante: refutar com uma carta que não se tem, ou passar podendo. Armada de propósito, uma por partida, e INDISTINGUÍVEL — a suíte compara a linha honesta e a mentirosa campo a campo |
| E o defeito que ela destravou | ✅ **zero candidatos não é conhecimento, é contradição**. A carta do envelope nunca entrava em `fora` numa partida honesta, então a máquina lia o elemento 1 de um vetor vazio e ninguém tinha motivo para desconfiar. A mentira alcança: mostrar a carta do envelope derruba a categoria inteira |
| A Metrópole sozinha caiu de 9m46s para 5m17s | ✅ 300 sorteios de evento eram 300 idas e voltas ao Supabase para uma função PURA — 113 dos 586 segundos, e nenhum deles trabalho. `generate_series` faz o laço dentro do banco |

---

## Fase 1 — Letreiro · 4 semanas

**Ataque o dicionário na semana 1.** É o único risco que pode inviabilizar o jogo, e descobrir isso
na semana 3 é caro.

| Semana | Foco |
|---|---|
| 1 | Pipeline do dicionário: Hunspell `pt_BR` → expansão → filtro → DAWG → benchmark de tamanho e velocidade. **Se o DAWG passar de 600 KB brotli, mude a estratégia agora** |
| 1 | Gerador + solver de grades, geração do pool de 5.000 |
| 2 | Loop de jogo completo em 2D feio: grade, entrada, cronômetro, submissão, pontuação, revelação |
| 3 | Cena 3D: bandeja, 16 dados instanciados, física de preparo, câmera. Fallback 2D |
| 3–4 | Polimento: caminho aceso ao digitar, barras de tensão, os 3 atos da revelação, som |
| 4 | **Carregador de tema + validador no CI** e as 4 bandejas (Nogueira, Osso e Areia, Fliperama, Meridiano) |
| 4 | Modo Relâmpago, anulação configurável, estatísticas, testes de aceite |

As bandejas custam cerca de um dia cada e são a **primeira prova real do sistema de temas**
([PRD 07](07-SISTEMA-DE-TEMAS.md)) num contexto barato — antes de apostar o Dossiê inteiro nele.

**Portão:** [critérios do PRD 02](02-PRD-LETREIRO.md#12-critérios-de-aceite), e a prova final —
jogue 5 partidas com amigos de verdade. Se ninguém apertar Revanche, alguma coisa está errada e o
problema não é técnico.

---

## Fase 2 — Dossiê · 6 a 7 semanas

A fase cresceu por causa dos temas. **Vale a pena, e a ordem interna importa muito.**

| Semana | Foco |
|---|---|
| 1 | **Contrato de pacote do Dossiê** + carregador + validador de grafo. Escrever isto **antes** de qualquer regra é o que faz um caso novo custar conteúdo em vez de engenharia |
| 1–2 | Motor agnóstico: distribuição, turnos com 2 ações, palpite, cadeia de refutação, acusação. **Todos os testes de RLS antes de qualquer pixel** |
| 2–3 | Bloco de dedução: grade, marcações, conjuntos, os 3 níveis de assistência |
| 3–4 | Cena: extrusor de planta 2.5D a partir do pacote, iluminação por lugar, peões 3D, cartas em leque, a animação de refutação |
| 4–5 | **Caso 1 — Solar das Acácias**: 21 ilustrações, arte, som, `copy` |
| 5 | Log narrado, reconstituição, dossiês finais, Fantasma |
| 5–6 | **Caso 2 — Boate Aurora**: 21 ilustrações, arte, som, `copy`, **e a reviravolta Apagão** |
| 6 | Seleção de caso: Escolher, Aleatório, Surpresa, Rodízio + abertura de caso |
| 6–7 | Timers, fallbacks, testes de aceite nos dois casos |

**Duas coisas que não podem ser cortadas:** o contrato de pacote (semana 1) e o bloco de dedução.
Se o cronograma apertar, corte a reconstituição — nunca esses dois.

**Se apertar muito:** lance com **um** caso. O sistema continua pronto, e a Aurora vira o primeiro
"conteúdo novo" — o que talvez seja até melhor de marketing.

**Portão:** [critérios do PRD 03](03-PRD-DOSSIE.md#11-critérios-de-aceite). E dois testes
específicos: (1) peça a alguém para tentar ver a carta refutada de outro jogador pelo DevTools —
precisa ser impossível; (2) adicione um terceiro caso de mentira, com 9 lugares aleatórios, e
confirme que **nenhum arquivo do motor foi tocado**.

---

## Fase 3 — Domínio · 6 a 7 semanas

O maior salto de complexidade do projeto.

| Semana | Foco |
|---|---|
| 1 | Mapa Vantara: grafo, geometria, balanceamento. Mapa Relâmpago |
| 1–2 | Motor de combate em PL/pgSQL + suíte de 10.000 batalhas simuladas contra a distribuição teórica |
| 2–3 | Fases de turno, reforço, cartas, escalonamento, remanejamento com BFS |
| 3–4 | Modo Campanha: pontuação, retorno de eliminado, limite de rodadas |
| 4–5 | Cena 3D: mapa plano com relevo, peças de exército instanciadas, dados, câmera de combate |
| 5 | Objetivos, contratos públicos, trégua e traição |
| 6 | Log narrado, Atlas da Campanha, probabilidade de conquista no hover |
| 6–7 | Daltonismo, mobile, performance, testes de aceite |

As quatro peles de mapa ficam para v1.1 — o grafo não muda, então é trabalho de material e luz,
não de engenharia.

**Portão:** [critérios do PRD 04](04-PRD-DOMINIO.md#11-critérios-de-aceite). E o teste que importa:
uma partida de Campanha com 5 pessoas precisa acabar em **menos de 60 minutos**, cronometrada.

---

## Fase 4 — Metrópole · 7 a 8 semanas

| Semana | Foco |
|---|---|
| 1 | Tabuleiro: 40 casas, preços, aluguéis, cartas de Sorte e Revés, balanceamento |
| 1–2 | Motor econômico com **invariante de dinheiro** testada a cada evento |
| 2–3 | Leilão (sala dedicada, relógio, lances) |
| 3–4 | Mesa de negociação e o motor de contratos executáveis |
| 4 | Painel de fluxo de caixa + distribuição estacionária do tabuleiro |
| 4–5 | Cena 3D: tabuleiro isométrico, 8 arquiteturas de prédio, animação de construção, peão andando |
| 5–6 | Modos, Investidor, regras da casa com impacto declarado |
| 6–7 | Ritmo de turno: auto-roll, pagamentos automáticos, construção em lote |
| 7–8 | Testes de duração real (10 partidas cronometradas), performance, testes de aceite |

**Portão:** [critérios do PRD 05](05-PRD-METROPOLE.md#10-critérios-de-aceite). Especialmente a
duração: 45–60 min no modo padrão, medido, não estimado.

---

## Depois: os temas de v1.1 como conteúdo

Nenhum destes é uma fase. São **entregas de conteúdo** de 1 a 2 semanas cada, encaixáveis entre
fases ou depois de tudo — e cada uma é um motivo legítimo para o grupo voltar:

| Entrega | Custo | O que é |
|---|---|---|
| **Dossiê · Ras Zamir** | 2 semanas | 1928 no deserto + Tempestade de Areia |
| **Dossiê · Meridiano-9** | 2 semanas | 2189 na órbita + Registro da Estação |
| **Domínio · 4 peles de mapa** | 1 semana | Dunas, Grade Tática, Carta Orbital |
| **Metrópole · 2ª cidade** | 2 semanas | Oásis, Neon 87 ou Colônia |

O gargalo de todas é **ilustração**, não código.

---

## Linha do tempo

```
Semana   0    4    8   12   16   20   24   28   32
         │────┼────┼────┼────┼────┼────┼────┼────┤
Fase 0   ███
Letreiro    ████
  ↑ primeiro lançamento público — semana 7
Dossiê          ███████
  ↑ 2 casos temáticos
Domínio                ███████
Metrópole                     ████████
                                      ↑ semana 29
Temas v1.1                             ███████
```

**~29 semanas** para os quatro jogos, mais ~7 de conteúdo temático. Mas o site vai ao ar na
**semana 7**, com um jogo completo, bom e com quatro bandejas.

---

## Ordem de risco (leia isto antes do cronograma)

Se algo vai dar errado, vai ser nesta ordem:

| # | Risco | Quando descobrir | Como |
|---|---|---|---|
| 1 | **Ilustração é o gargalo do projeto inteiro** | Agora | 84 ilustrações só no Dossiê completo. Ver [PRD 07 §6.2](07-SISTEMA-DE-TEMAS.md#62-ilustração--o-caro): técnica fixa por caso, e um caso por lançamento. **Considere contratar ilustração antes da Fase 2** |
| 2 | **Dicionário PT-BR insuficiente** | Semana 1 da Fase 1 | Construa o DAWG antes de qualquer tela |
| 3 | **Motor do Dossiê nasce com conteúdo cravado** | Semana 1 da Fase 2 | Contrato de pacote antes de regra. Retrofitar custa 3× |
| 4 | **3D não roda em celular médio** | Semana 3 da Fase 1 | Teste num Android real de R$ 1.200, não no emulador |
| 5 | **Latência de Realtime pior que o esperado** | Fase 0 | O "jogo de mentira" mede isso |
| 6 | **RLS com brecha** | Fase 0, e de novo na Fase 2 | Testes automatizados desde o primeiro dia |
| 7 | **Partidas longas demais** | Fase 3 e 4 | Cronometre partidas reais, não confie na estimativa |
| 8 | **Temas viram exceções no motor** | Contínuo | O teste do "terceiro caso de mentira" no portão da Fase 2 |

---

## O que fazer nos primeiros três dias

1. `create-next-app` com App Router e TypeScript strict, deploy na Vercel em `gru1`
2. Projeto Supabase na região São Paulo. Auth com Google e anônimo funcionando
3. Migração inicial: `profiles`, `rooms`, `room_members` + as policies de RLS
4. Uma página `/j/[code]` que entra numa sala como convidado e mostra quem está online
5. **Em paralelo, sem esperar nada disso:** baixar o Hunspell `pt_BR`, expandir e contar quantas
   palavras sobram depois do filtro. Esse número decide o MVP inteiro.
6. **Decidir sobre ilustração.** É o item de maior risco e o de maior prazo de entrega se for
   contratado. Não descubra isso na semana 20.

---

## Depois dos quatro jogos

Nada disso está prometido. É a lista de para onde vale a pena olhar:

- **Desafio diário do Letreiro** — o mecanismo de retenção mais barato que existe
- **Quinto caso do Dossiê** — trem noturno, 1961. O sistema já aguenta
- **Editor de tema da comunidade** — o contrato já é um JSON. O que falta é a UI e a moderação
- **Perfis públicos e placar do grupo** — "a mesa dos amigos", com histórico e rivalidades
- **Quinto jogo** — provavelmente algo curto e social, para ter variedade de duração e não só de tema
- **PWA instalável** com notificação de "sua vez"
- **Internacionalização** — a arquitetura já está pronta; o Letreiro precisaria de um dicionário por
  idioma, o que é o mesmo pipeline
