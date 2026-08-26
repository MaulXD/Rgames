# Mesa

Site de jogos de tabuleiro para jogar com amigos por link. Salas com código e QR, conta opcional,
e versões dos clássicos **consertadas** — partidas que acabam, ninguém eliminado assistindo, e
turnos sem tempo morto.

> **Status:** documentação de produto concluída. Nenhuma linha de código ainda.
> Comece por [`docs/06-ROADMAP.md`](docs/06-ROADMAP.md).

## Os jogos

| Jogo | A partir de | Jogadores | Duração |
|---|---|---|---|
| **Letreiro** | Boggle | 1–8 | 3–12 min |
| **Dossiê** | Detetive | 3–6 | 25–40 min |
| **Domínio** | WAR | 3–6 | 35–90 min |
| **Metrópole** | Banco Imobiliário | 2–6 | 30–120 min |

Nomes, elenco, mapas e arte são **100% autorais**. Regras de jogo não são protegidas por direito
autoral; nomes, marcas e tabuleiros são. Ver [`docs/README.md`](docs/README.md#nomes-próprios-e-propriedade-intelectual).

## Stack

| | |
|---|---|
| Front | Next.js 15 (App Router) · React 19 · TypeScript strict · Tailwind v4 |
| 3D | React Three Fiber · drei · Rapier |
| Animação | Motion |
| Backend | Supabase — Postgres, Auth, Realtime, Storage, `pg_cron` |
| Hospedagem | Vercel, região `gru1` (São Paulo) |

**Princípio inegociável:** o servidor é a fonte da verdade. Toda ação de jogo passa por uma RPC
`SECURITY DEFINER` no Postgres. O cliente prevê e anima — nunca decide.

## Documentação

| Doc | Conteúdo |
|---|---|
| [docs/README.md](docs/README.md) | Índice, decisões travadas, propriedade intelectual |
| [00 — Plataforma](docs/00-PRD-PLATAFORMA.md) | Contas, salas, arquitetura, RLS, anti-cheat, métricas |
| [01 — Direção de Arte](docs/01-DIRECAO-DE-ARTE.md) | O sistema anti-AI-slop: paletas, tipografia, movimento, som, 3D |
| [02 — Letreiro](docs/02-PRD-LETREIRO.md) | **MVP** — Boggle em português |
| [03 — Dossiê](docs/03-PRD-DOSSIE.md) | Dedução, com quatro casos temáticos |
| [04 — Domínio](docs/04-PRD-DOMINIO.md) | Conquista territorial |
| [05 — Metrópole](docs/05-PRD-METROPOLE.md) | Economia e negociação |
| [06 — Roadmap](docs/06-ROADMAP.md) | Fases, portões de qualidade, ordem de risco |
| [07 — Sistema de Temas](docs/07-SISTEMA-DE-TEMAS.md) | Um motor, muitos mundos |

## Primeiros passos

Ver [`docs/06-ROADMAP.md`](docs/06-ROADMAP.md#o-que-fazer-nos-primeiros-três-dias). Em resumo:

1. `create-next-app` + deploy na Vercel em `gru1`
2. Projeto Supabase em São Paulo, com auth anônimo
3. Migração inicial com RLS e testes de RLS no CI
4. Rota `/j/[code]` entrando numa sala como convidado
5. **Em paralelo:** construir o DAWG do dicionário `pt_BR`. Esse número decide o MVP inteiro

## Segredos

Nenhuma chave entra no repositório. As variáveis de ambiente vivem na Vercel e em `.env.local`
(ignorado). A `service_role` do Supabase **nunca** aparece em código de cliente.
