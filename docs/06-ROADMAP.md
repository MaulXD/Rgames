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

Isto não é estimativa — é o que existe e roda:

| Entregue | Estado |
|---|---|
| Chassi Next 16 + Vercel `gru1` + Supabase São Paulo | ✅ no ar |
| Sessão de convidado (nativa **e** por `/api/guest`, sem depender de toggle de painel) | ✅ |
| Perfil persistido, avatar de esmalte e metal | ✅ |
| Salas: código, link, QR, lobby ao vivo, cor, pronto, migração de host | ✅ |
| Dicionário PT-BR: 248.614 palavras em `dict_pt` | ✅ |
| Pool de 1.500 grades aprovadas por solver | ✅ |
| Motor do Letreiro: começar, submeter, apurar, varredura por `pg_cron` | ✅ |
| Interface do Letreiro: bandeja, cronômetro, digitação e arraste, revelação em 3 atos | ✅ |
| Testes de fumaça: 33 + 25 verificações contra o Supabase real | ✅ |
| **Falta no Letreiro** | modo Relâmpago na interface, desafio diário, multiplicadores, estatísticas |
| **Falta nos outros três** | tudo — Dossiê, Domínio e Metrópole são só documento |

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
