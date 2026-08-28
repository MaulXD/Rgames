# Mesa — Documentação de Produto

> **Mesa** é o nome de trabalho da plataforma. Substituível a qualquer momento — o nome só aparece
> no chassi (header, lobby, e-mails), nunca dentro dos jogos, que têm identidade própria.

Site de jogos de tabuleiro para jogar com amigos por link. Quatro jogos, salas com código/QR,
conta opcional, hospedado na Vercel com Supabase como backend autoritativo.

## Índice

| Doc | Conteúdo |
|---|---|
| [00 — PRD Plataforma](00-PRD-PLATAFORMA.md) | Visão, público, contas, salas, convites, arquitetura, RLS, anti-cheat, requisitos não-funcionais, métricas |
| [01 — Direção de Arte](01-DIRECAO-DE-ARTE.md) | O sistema anti-AI-slop: paletas, tipografia, textura, movimento, som, pipeline 3D, checklist de rejeição |
| [02 — PRD Letreiro](02-PRD-LETREIRO.md) | Boggle em português — **MVP** |
| [03 — PRD Dossiê](03-PRD-DOSSIE.md) | Detetive / dedução — **quatro casos temáticos** |
| [04 — PRD Domínio](04-PRD-DOMINIO.md) | WAR / conquista territorial |
| [05 — PRD Metrópole](05-PRD-METROPOLE.md) | Banco Imobiliário / economia |
| [06 — Roadmap](06-ROADMAP.md) | Fases, marcos, critérios de saída, estimativas |
| [07 — Sistema de Temas](07-SISTEMA-DE-TEMAS.md) | Um motor, muitos mundos: contrato de pacote, seleção, sorteio, validador, orçamento |
| [08 — As Máquinas](08-MAQUINAS.md) | Jogar sozinho: o ator explícito, o ritmo de um passo por vez, os níveis, a dedução honesta do Dossiê |

## Decisões travadas

| Decisão | Escolha | Consequência |
|---|---|---|
| Hospedagem | Vercel (região `gru1`) | Next.js 16 App Router, React 19, Edge/Node functions |
| Backend | Supabase (região São Paulo) | Postgres + Auth + Realtime + Storage num lugar só |
| Tempo real | Supabase Realtime | Sem WebSocket persistente na Vercel; Broadcast + Presence + Postgres Changes |
| Autoridade | 100% servidor | Toda ação passa por RPC `SECURITY DEFINER` no Postgres. Cliente nunca decide resultado |
| Identidade | Conta **ou** convidado | Convidado usa `signInAnonymously()` — é um `user_id` real, então RLS funciona igual e a conta pode ser promovida depois sem perder histórico |
| Entrada na sala | Link + código de 6 caracteres + QR Code | Três caminhos para a mesma sala |
| 3D | Elementos, não cenas inteiras | Dados, peças, tabuleiros com relevo em R3F. Cartas e HUD em 2D autoral |
| MVP | Letreiro (Boggle) | Menor risco de escopo, exercita 100% da infra |
| Temática | Tema é **pacote de conteúdo**, não skin | O motor nasce agnóstico. Dossiê estreia com 2 casos (1953 e 1987); deserto e sci-fi vêm no v1.1 |

## Nomes próprios e propriedade intelectual

**Regras de jogo não são protegidas por direito autoral.** Nomes, marcas, arte, personagens,
nomes de ruas e o design gráfico do tabuleiro **são**.

"Detetive", "WAR" e "Banco Imobiliário" são marcas registradas (Estrela/Grow/Hasbro). Por isso
cada jogo aqui tem nome, elenco, mapa e arte 100% autorais:

| Referência | Nosso jogo | O que muda |
|---|---|---|
| Boggle | **Letreiro** | Distribuição de letras e dicionário em PT-BR, grade, modos e quatro bandejas próprias |
| Detetive / Clue | **Dossiê** | Quatro casos autorais: mansão 1953, escavação 1928, boate 1987, estação orbital 2189 |
| WAR / Risk | **Domínio** | Mapa fictício próprio, objetivos e balanceamento originais |
| Banco Imobiliário | **Metrópole** | Bairros brasileiros reais (domínio público) em tabuleiro autoral |

Isso não é excesso de cautela: é o que permite o projeto existir publicamente e, se um dia quiser,
ser monetizado.

## Como ler estes documentos

Cada PRD de jogo segue a mesma estrutura:

1. **Pitch** — uma frase
2. **Por que este jogo** — o que ele prova/entrega para a plataforma
3. **Regras base** — o núcleo herdado, sem invenção
4. **O que quebra no original** — problemas reais, observados
5. **Melhorias** — cada uma numerada, com justificativa e custo
6. **Fluxo de partida** — telas e estados
7. **Modelo de dados** — `public_state`, `private_state`, ações
8. **Direção de arte** — paleta, tipografia, 3D, som
9. **Escopo v1 vs. depois** — o corte explícito
10. **Critérios de aceite** — testável

Quando um PRD diz **[v1]** é escopo do primeiro lançamento do jogo.
**[v1.1]** é planejado mas cortável. **[futuro]** é ideia registrada, sem compromisso.
