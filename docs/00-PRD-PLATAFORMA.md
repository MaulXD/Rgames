# PRD 00 — Plataforma "Mesa"

## 1. Pitch

Abrir um link, digitar um apelido e estar jogando tabuleiro com os amigos em menos de 15 segundos —
com jogos clássicos que já conhecemos, refeitos para funcionar bem online e para serem bonitos de
verdade.

## 2. Por que existe

O que existe hoje para jogar tabuleiro remotamente com amigos:

| Opção | Problema |
|---|---|
| Tabletop Simulator | Pago, exige PC com Steam, física frustrante, curva alta |
| Board Game Arena | Interface travada em 2010, lento, forte fricção de cadastro |
| Apps oficiais (Monopoly, Clue) | Anúncios, microtransação, um app por jogo, contas separadas |
| Discord + tabuleiro físico na câmera | Só funciona se alguém tiver o jogo |

A lacuna: **um site**, sem instalação, que abre no celular e no notebook, entra por link, é grátis,
e onde as versões dos clássicos foram *corrigidas* — porque quase todo tabuleiro dos anos 80 tem
um defeito estrutural que ninguém conserta (partidas longas demais, jogadores eliminados assistindo,
turnos mortos).

## 3. Princípios

Estes princípios resolvem discussões de escopo. Quando dois requisitos brigarem, o de número menor ganha.

1. **Entrar em 15 segundos.** Link → apelido → dentro. Nenhuma tela obrigatória entre isso.
2. **O host não configura nada.** Todo jogo tem defaults bons. Configuração é opcional e fica atrás
   de um botão "Regras da casa".
3. **Nenhuma partida trava.** Timer de turno, auto-pass, reconexão com estado, migração de host.
   Uma pessoa que sumiu no meio não pode matar a noite de cinco.
4. **Ninguém fica sem jogar.** Todo jogo com eliminação tem um papel para o eliminado.
5. **Bonito de perto.** Textura, peso, som. O teste é: *isto poderia ser a foto de um jogo real?*
6. **Mobile é primeira classe**, não adaptação. Metade do grupo vai estar no celular.
7. **O servidor é a verdade.** O cliente pode prever, animar e errar — nunca decidir.

## 4. Público e contexto de uso

**Primário:** grupos fechados de 3 a 6 amigos, 20–40 anos, Brasil, jogando à noite com uma chamada
de voz aberta em paralelo (Discord ou WhatsApp). Dispositivos misturados: metade celular Android/iOS,
metade notebook. Conexão residencial ou 4G.

**Consequências diretas dessa escolha:**
- **Não** precisamos de chat de voz (eles já têm um). Precisamos de chat de texto leve para links e piadas.
- **Precisamos** que a tela do celular seja jogável de uma mão só nos momentos de espera.
- **Precisamos** que sair e voltar (atender o telefone, trocar de app) não perca nada.
- Latência de 200–300ms é irrelevante em jogos por turno — não vamos otimizar prematuramente para isso.

**Não é público-alvo (v1):** desconhecidos via matchmaking, torneios ranqueados, jogo assíncrono de
vários dias, streamers, público infantil.

## 5. Escopo

### Dentro [v1]
- Contas (Google, Discord, e-mail magic link) e modo convidado
- Perfil: apelido, avatar, cor, estatísticas por jogo
- Salas privadas com código de 6 caracteres, link direto e QR Code
- Lobby com presença ao vivo, seleção de assento/cor, ready-check, chat
- Espectadores
- Reconexão e migração de host
- Quatro jogos (ver PRDs 02–05), lançados em sequência
- Sistema de temas: pacotes de conteúdo carregados sob demanda, com seleção, sorteio e modo surpresa (ver [PRD 07](07-SISTEMA-DE-TEMAS.md))
- Histórico de partidas e placar do grupo
- PT-BR. Estrutura pronta para i18n, sem segundo idioma no v1

### Fora [v1]
- Matchmaking público, ranking global, ligas
- Monetização de qualquer tipo
- App nativo / PWA instalável com push
- Editor de temas da comunidade (o contrato é JSON desde o v1, mas a UI e a moderação ficam para depois)
- Editor de jogos, mods, tabuleiros customizados
- Bots com IA jogando de verdade (só auto-pass)
- Chat de voz

## 6. Identidade e contas

### 6.1 Três formas de estar na Mesa

| Tipo | Como | O que tem |
|---|---|---|
| **Convidado** | Só apelido, direto do link | Joga tudo. Perfil vive naquele navegador. Histórico local |
| **Conta** | Google / Discord / magic link | Perfil, avatar, estatísticas, histórico, grupos salvos, sincroniza entre dispositivos |
| **Convidado promovido** | Convidado que cria conta depois | **Mantém todo o histórico** |

### 6.2 A decisão técnica que faz isso funcionar

O convidado **não** é um objeto em memória com um UUID inventado. Ele é criado com
`supabase.auth.signInAnonymously()`, que gera um usuário real na tabela `auth.users` com
`is_anonymous = true`.

Isso resolve três problemas de uma vez:
- **RLS funciona igual** para convidado e conta. Nenhum caminho de código duplicado, nenhuma
  brecha de segurança em "modo convidado".
- **Promoção sem migração**: `supabase.auth.updateUser({ email })` ou `linkIdentity({ provider })`
  converte o usuário anônimo em permanente **mantendo o mesmo `user_id`**. Todo o histórico,
  todas as estatísticas, todas as partidas continuam apontando para ele.
- **Sessão sobrevive ao refresh** sem nada além do refresh token padrão do Supabase.

Riscos e mitigação: contas anônimas acumulam lixo. Job diário (`pg_cron`) apaga usuários anônimos
sem partidas há mais de 30 dias. Rate limit de criação anônima por IP ativado no painel do Supabase.

### 6.3 Perfil

- **Apelido**: 2–16 caracteres, permite acentos e emoji, filtro de palavrões desligado (grupo fechado).
  Não precisa ser único globalmente — precisa ser único **dentro da sala** (colisão → sufixo automático).
- **Avatar**: conjunto autoral de ~24 avatares ilustrados (ver [Direção de Arte](01-DIRECAO-DE-ARTE.md)).
  Upload próprio só para contas, via Supabase Storage, recortado para 256×256 WebP.
- **Cor**: escolhida no lobby, exclusiva por sala, com padrão de hachura associado para daltonismo.
- **Estatísticas** por jogo: partidas, vitórias, e 2–3 métricas específicas por jogo
  (ex: melhor palavra no Letreiro, maior império no Domínio).

## 7. Salas

### 7.1 Código

Alfabeto de 31 caracteres sem ambiguidade visual ou fonética:

```
ABCDEFGHJKMNPQRSTUVWXYZ23456789
```

Removidos `I`, `L`, `O`, `0` e `1` — os cinco caracteres que as pessoas erram ao ler em voz alta
ou ao digitar de um QR borrado. 23 letras + 8 dígitos.

6 caracteres = **887 milhões** de combinações. Geração aleatória com retry em colisão. Códigos
expiram junto com a sala (24h de inatividade) e voltam ao pool.

Códigos são **case-insensitive** na entrada e sempre exibidos em maiúsculas, agrupados `ABC · 123`
para leitura em voz alta.

### 7.2 Três caminhos para a mesma sala

Tela **Convidar** — um único modal, sem abas:

1. **QR Code** grande (mínimo 240px), gerado no cliente com `qrcode` (SVG, sem chamada de rede).
   Contém a URL completa. Centro do QR com o brasão da Mesa.
2. **Código** em display gigante, tipografia tabular, com botão de copiar e feedback tátil.
   É o que a pessoa fala em voz alta na chamada.
3. **Link** `mesa.app/j/ABC123` com botão copiar + Web Share API (`navigator.share`) no mobile,
   que abre a folha nativa de compartilhamento do sistema.

O link direto pula a tela de "entrar com código" — vai direto para o apelido.

### 7.3 Ciclo de vida

```
CRIADA → LOBBY → EM_PARTIDA → PLACAR → LOBBY (revanche)  →  ...  →  ARQUIVADA
                      ↑______________________|
```

- **Criada**: host escolhe o jogo. Sala nasce em LOBBY.
- **Lobby**: lista de membros com presença ao vivo, assentos, cores, ready-check, chat, botão
  "Regras da casa" (configurações do jogo), botão Convidar. Host inicia quando todos prontos —
  ou força início após 10s de aviso.
- **Em partida**: ver PRD do jogo.
- **Placar**: resultado, estatísticas da partida, replay/resumo, botão **Revanche** (mesma sala,
  mesmos jogadores, assentos rotacionados) e **Trocar de jogo**.
- **Arquivada**: 24h sem atividade. `public_state` compactado, código liberado.

### 7.4 Presença, desconexão e host

- **Presença** via Supabase Realtime Presence no canal `room:{code}`. Heartbeat a cada 10s.
- **30s sem heartbeat** → jogador marcado `ausente` (avatar dessatura, badge no assento). O jogo
  **não** para.
- **Se for a vez dele**: o `turn_deadline` normal do jogo continua correndo. Ao estourar, auto-pass
  (definido por jogo: passa a vez, joga a ação mais segura, ou não faz nada).
- **120s ausente** → assento entra em modo automático permanente até ele voltar. Ele **nunca** perde
  o assento durante a partida.
- **Volta a qualquer momento** → recebe o `public_state` completo + seu `private_state`, com uma
  animação de "recap" dos eventos que perdeu (últimos 10 do `match_events`).
- **Host sai** → o assento ativo de menor índice vira host automaticamente. Ninguém precisa saber
  que isso aconteceu.

### 7.5 Espectadores

Entram por link com `?spec=1` ou quando a sala está cheia. Veem só o `public_state` — nunca o
`private_state` de ninguém. Chat separado, colapsável. Limite de 20.

## 8. Arquitetura

### 8.1 Stack

```
Cliente     Next.js 16 (App Router) · React 19 · TypeScript strict
            Tailwind CSS v4 (tokens próprios) · Motion · React Three Fiber + drei + rapier
            Zustand (estado de UI) · TanStack Query (dados) · Zod (contratos)

Hospedagem  Vercel — região gru1 (São Paulo). Route Handlers em Node runtime,
            páginas com RSC. Sem WebSocket na Vercel.

Backend     Supabase — projeto na região South America (São Paulo)
            Postgres 15 · Auth · Realtime · Storage · pg_cron
```

**Por que São Paulo nos dois:** o caminho crítico é `cliente → RPC no Postgres → replicação lógica
→ Realtime → clientes`. Cada salto transatlântico custa ~120ms. Com tudo em `sa-east-1`, o
ida-e-volta de uma ação fica em **100–250ms**, imperceptível em jogo por turno.

### 8.2 O princípio: o servidor é a verdade

Nenhuma regra de jogo roda no cliente de forma autoritativa. Toda ação segue o mesmo caminho:

```
cliente                     Postgres (RPC SECURITY DEFINER)              todos os clientes
   │                                    │                                       │
   │── rpc_submit_action ──────────────▶│                                       │
   │   { match_id, expected_version,    │  1. auth.uid() é o jogador da vez?     │
   │     action }                       │  2. a ação é legal neste estado?       │
   │                                    │  3. expected_version == version?       │
   │◀─ ok / erro tipado ────────────────│  4. aplica efeito no public_state      │
   │                                    │  5. atualiza private_state afetado     │
   │                                    │  6. INSERT em match_events (seq++)     │
   │                                    │  7. version++, turn_deadline novo      │
   │                                    │                                       │
   │◀═══════ Realtime: match_events INSERT ═══════════════════════════════════▶│
```

O cliente pode **prever otimisticamente** (a carta já sai da mão, o dado já rola) para o feedback
ficar abaixo de 100ms — mas se o servidor recusar, o cliente reverte com uma animação de
"desfazer" e mostra o motivo.

### 8.3 Modelo de dados

```sql
-- Identidade -----------------------------------------------------------------
profiles (
  id            uuid primary key references auth.users on delete cascade,
  handle        text unique,              -- só para contas permanentes
  display_name  text not null,
  avatar_key    text,                     -- chave do conjunto autoral
  avatar_url    text,                     -- upload (contas)
  is_guest      boolean not null default true,
  stats         jsonb not null default '{}',
  created_at    timestamptz default now()
)

-- Salas ----------------------------------------------------------------------
rooms (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,       -- 6 chars, alfabeto sem ambiguidade
  host_id     uuid references profiles,
  game_key    text not null,              -- 'letreiro' | 'dossie' | 'dominio' | 'metropole'
  status      text not null,              -- lobby | playing | scoring | archived
  settings    jsonb not null default '{}',-- "regras da casa"
  created_at  timestamptz default now(),
  expires_at  timestamptz not null
)

room_members (
  room_id     uuid references rooms on delete cascade,
  user_id     uuid references profiles,
  seat        smallint,                   -- null para espectador
  color       text,
  role        text not null,              -- host | player | spectator
  is_ready    boolean default false,
  last_seen_at timestamptz,
  primary key (room_id, user_id)
)

-- Partidas -------------------------------------------------------------------
matches (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid references rooms on delete cascade,
  game_key      text not null,
  status        text not null,            -- running | finished | abandoned
  seed          bigint not null,          -- NUNCA exposto antes do fim
  public_state  jsonb not null,           -- verdade compartilhada, já redigida
  version       integer not null default 0,
  current_seat  smallint,
  turn_deadline timestamptz,
  started_at    timestamptz default now(),
  ended_at      timestamptz
)

match_players (
  match_id  uuid references matches on delete cascade,
  user_id   uuid references profiles,
  seat      smallint not null,
  status    text not null,                -- active | eliminated | ghost | left
  score     integer default 0,
  final_rank smallint,
  primary key (match_id, seat)
)

-- Informação oculta ----------------------------------------------------------
match_private_state (
  match_id  uuid references matches on delete cascade,
  user_id   uuid references profiles,
  data      jsonb not null,               -- mão de cartas, objetivo secreto, palavras
  primary key (match_id, user_id)
)

-- Log imutável ---------------------------------------------------------------
match_events (
  id         bigserial primary key,
  match_id   uuid references matches on delete cascade,
  seq        integer not null,
  actor_seat smallint,
  type       text not null,
  payload    jsonb not null,              -- já redigido para consumo público
  created_at timestamptz default now(),
  unique (match_id, seq)
)
```

**Por que event log + snapshot?** O `public_state` é o checkpoint (reconciliação, reconexão,
espectador entrando no meio). O `match_events` é o que o cliente **anima** — ele não redesenha o
tabuleiro, ele reproduz "peça foi de A para B". Isso é a diferença entre um tabuleiro que pisca e
um tabuleiro que se move. Também dá replay e auditoria de graça.

### 8.4 Row Level Security

O ponto mais importante de segurança do projeto inteiro.

```sql
-- Estado privado: só o dono lê. Ninguém escreve pelo client.
alter table match_private_state enable row level security;

create policy "dono lê seu estado privado"
  on match_private_state for select
  using (user_id = auth.uid());

-- Sem policy de INSERT/UPDATE/DELETE: só as RPCs SECURITY DEFINER escrevem.
```

```sql
-- Partidas: só quem está na sala lê o estado público.
create policy "membros da sala leem a partida"
  on matches for select
  using (exists (
    select 1 from room_members m
    where m.room_id = matches.room_id and m.user_id = auth.uid()
  ));
```

**Duas armadilhas que já custaram caro neste projeto** — as duas foram encontradas pelo teste de
fumaça (`npm run smoke`), não em revisão de código:

**1. RLS é filtro, não permissão.** Ligar RLS e escrever policies não dá acesso a nada: sem
`GRANT SELECT` para `anon` e `authenticated`, toda leitura falha — inclusive o Realtime, porque
Postgres Changes só entrega linha que o assinante consegue ler. Migração `0003_grants.sql`.

**2. Policy que consulta a própria tabela recorre infinitamente.** A policy de `room_members`
perguntava "sou membro desta sala?" consultando `room_members`, e a consulta dispara a mesma policy:

```
42P17  infinite recursion detected in policy for relation "room_members"
```

Como `rooms` e `profiles` também passavam por `room_members`, as três tabelas ficaram ilegíveis — o
lobby inteiro estava morto e o build passava. **Conserto:** a pergunta de pertencimento sai da policy
e vai para uma função `SECURITY DEFINER` (`is_room_member`, `shares_room_with`), que roda como dona
e não reentra no RLS. Migração `0004_fix_rls_recursion.sql`. Vale para qualquer policy que precise
olhar a própria tabela — e vai valer de novo em `match_players`.

Regras absolutas:
- **Nenhuma tabela de jogo tem policy de escrita para o cliente.** Zero. Toda mutação é RPC.
- **O `public_state` já nasce redigido.** O baralho embaralhado, a solução do Dossiê, a distribuição
  de letras não sorteadas — nada disso entra no `public_state`. Vive em colunas separadas sem
  policy de leitura, acessíveis só dentro das funções.
- **`seed` não é exposto** até `status = 'finished'`.
- Testes automatizados de RLS rodam no CI: para cada tabela, um teste tenta ler o dado de outro
  usuário e **deve** falhar. Hoje isso vive em `scripts/smoke.mjs` (25 verificações contra o
  Supabase real, com usuários criados e removidos pela Admin API). Ele não depende de
  "Anonymous sign-ins" estar ligado, então dá para validar o servidor antes do cliente.

### 8.5 Canais de tempo real

Regra: **Broadcast para efeito, Postgres Changes para verdade.**

| Canal | Transporte | Conteúdo |
|---|---|---|
| `room:{code}` | Presence | quem está online, `is_ready`, ping de latência |
| `room:{code}` | Broadcast | chat, "está digitando", reações, cursor/hover no tabuleiro |
| `match:{id}` | Postgres Changes em `match_events` | cada ação confirmada, em ordem |
| `match:{id}` | Postgres Changes em `matches` (só `version`, `current_seat`, `turn_deadline`) | checkpoint |

Broadcast é volátil e não passa pelo banco — perfeito para hover, chat e reações (alto volume,
zero consequência). Postgres Changes é durável e ordenado — obrigatório para qualquer coisa que
mude o jogo.

**Reconciliação:** o cliente guarda o último `seq` aplicado. Se chegar um evento com `seq` maior
que `último + 1`, ele detectou um buraco → busca `match_events` a partir do último `seq` conhecido
e reaplica. Se o buraco for grande (>20), busca o `public_state` inteiro e redesenha sem animar.

### 8.6 Relógio de turno

`matches.turn_deadline` é `timestamptz`. O cliente **não** conta o tempo sozinho: ele calcula
`deadline - now()` usando um offset de relógio medido no handshake (mesma técnica de NTP simplificado,
3 amostras, mediana). Isso impede que um relógio de sistema errado quebre o timer.

Quem força o timeout é o **banco**, não o cliente:

```sql
select cron.schedule('sweep-turnos', '10 seconds', $$ select sweep_expired_turns(); $$);
```

`sweep_expired_turns()` varre partidas com `turn_deadline < now()` e aplica a ação de auto-pass do
jogo. Usamos `pg_cron` e não Vercel Cron porque o plano Hobby da Vercel tem granularidade mínima de
1 minuto — inútil para um timer de turno.

### 8.7 Aleatoriedade e o problema do dado

**Toda aleatoriedade é do servidor.** Cada partida tem um `seed` e um contador; o PRNG é um
`mulberry32` implementado em PL/pgSQL, determinístico e auditável no replay.

O detalhe que separa "bonito" de "só um número": quando o servidor decide que o dado deu **4**,
o cliente **não** mostra um "4" — ele roda a simulação física do dado 3D e o dado **cai no 4**.

Como: pré-computamos, para cada dado, um conjunto de ~40 lançamentos gravados (posição inicial,
impulso, torque) e o resultado de cada um. O servidor manda o resultado, o cliente escolhe um
lançamento gravado que termina naquela face, adiciona jitter cosmético na trajetória e roda com
Rapier. O dado tem peso, bate na borda, gira e para no número certo.

Isso vale para tudo: cartas embaralhadas, ordem de sorteio, distribuição de letras. Sempre servidor.

### 8.8 Anti-cheat

Superfície real de ataque num jogo entre amigos é pequena, mas o custo de fazer certo também é.

| Vetor | Defesa |
|---|---|
| Ler a mão do adversário | RLS em `match_private_state`; `public_state` já redigido |
| Prever o baralho | `seed` só exposto após o fim |
| Agir fora do turno | RPC valida `auth.uid()` contra `current_seat` |
| Ação ilegal | Validação completa de legalidade dentro da RPC |
| Duplo clique / replay | `expected_version` obrigatório; divergiu, rejeita |
| Flood de ações | Rate limit por `(user_id, match_id)`: 20 ações / 10s |
| Solver externo (Letreiro) | Ver [PRD 02 §7](02-PRD-LETREIRO.md) — detecção de padrão |
| Cliente modificado | Irrelevante: o cliente não decide nada |

## 9. Requisitos não-funcionais

### 9.1 Performance

| Métrica | Orçamento |
|---|---|
| LCP do lobby, 4G, mid-tier Android | **< 2,0s** |
| Bundle JS inicial (rota `/j/[code]`) | **< 200 KB** gzip |
| Bundle de um jogo (lazy, por rota) | **< 350 KB** gzip |
| Assets 3D por cena | **< 1,5 MB** (glTF Draco + KTX2) |
| FPS em iPhone 12 / Galaxy A54 | **60fps** estável, mínimo 45 |
| Draw calls por cena 3D | **< 150** |
| Feedback visual após input | **< 100 ms** (otimista) |
| Ação confirmada pelo servidor | **< 400 ms** p95 |

Cada jogo é uma rota com `dynamic import`. O R3F e o Rapier **não** entram no bundle do lobby.

### 9.2 Acessibilidade

- Contraste AA (4.5:1 texto, 3:1 UI) em todos os temas. Verificado no CI com `axe-core`.
- **Daltonismo é requisito funcional**, não cosmético: Domínio e Metrópole dependem de identificar
  o dono de um território/propriedade. Toda cor de jogador vem acompanhada de um **padrão de hachura**
  e um **ícone de facção**. Testado com simulação de protanopia, deuteranopia e tritanopia.
- Navegação completa por teclado. Tabuleiros são grades navegáveis com setas, `role="grid"`.
- `aria-live="polite"` para o log de eventos — quem usa leitor de tela acompanha a partida.
- `prefers-reduced-motion: reduce` respeitado de verdade (ver [Direção de Arte §5](01-DIRECAO-DE-ARTE.md)).
- Alvos de toque ≥ 44×44px. Nada de ação destrutiva sem confirmação em área de toque apertada.

### 9.3 Confiabilidade

- Perda de conexão nunca perde progresso: o estado vive no servidor.
- Refresh da página no meio da partida volta exatamente ao mesmo ponto.
- Trocar de dispositivo no meio (celular → notebook) funciona para contas.
- Erro de RPC sempre retorna código tipado (`NOT_YOUR_TURN`, `ILLEGAL_ACTION`, `STALE_VERSION`,
  `RATE_LIMITED`) e o cliente mostra mensagem humana, nunca um stack trace.

## 10. Métricas

**A métrica que importa:** *taxa de partidas concluídas* — partidas iniciadas que chegaram ao placar.
Meta **> 75%**. Ela captura de uma vez: duração adequada, desconexão tratada, tédio, bug.

Secundárias:
- **Time-to-first-move**: tempo entre abrir o link e a primeira ação. Meta **< 60s**.
- **Revanche imediata**: partidas seguidas de outra na mesma sala. Meta **> 40%** (é o sinal mais
  honesto de que o jogo é divertido).
- **Retorno do grupo em 7 dias**: salas com ≥3 dos mesmos jogadores. Meta **> 30%**.
- **Taxa de promoção de convidado**: convidados que criam conta. Sem meta — é diagnóstico.

Instrumentação: Vercel Analytics para web vitals, eventos de produto no próprio Postgres
(tabela `analytics_events`, sem serviço externo, sem cookie de terceiro).

## 11. Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| Supabase Realtime com limite de conexões no free tier (200 concorrentes) | Bloqueia crescimento | Uma conexão por cliente, multiplexando canais. Monitorar. Plano Pro custa US$25 se necessário |
| Latência de replicação lógica em pico | Turnos "engasgam" | Broadcast como caminho rápido para o efeito visual, Postgres Changes confirma. Já é o design |
| Escopo de 4 jogos é grande demais | Nada fica bom | Lançamento sequencial. Letreiro sozinho já é um produto. Portão de qualidade antes de começar o próximo |
| 3D mata a performance no mobile | Metade do público não joga | Orçamento explícito + fallback 2D automático (ver [Direção de Arte §6](01-DIRECAO-DE-ARTE.md)) |
| Dicionário PT-BR de qualidade | Letreiro fica injogável | Ver [PRD 02 §6](02-PRD-LETREIRO.md) — risco número 1 do MVP, atacar primeiro |
| Marca registrada | Take-down | Nomes, arte e conteúdo 100% autorais desde o commit inicial |

## 12. Critérios de aceite da plataforma

- [ ] Abrir o link de convite em uma janela anônima e estar no lobby com apelido em < 15s
- [x] Código de sala funciona digitado em minúsculas e com espaços — e com hífen, e com o
      espaço não-quebrável que vem de copiar de uma página. A metade do espaço estava quebrada:
      `btrim` tira das pontas, e o espaço que a pessoa põe está no MEIO
- [ ] QR Code lido por câmera nativa de iOS e Android leva direto ao apelido
- [ ] Fechar a aba no meio da partida e reabrir restaura o estado exato, incluindo mão de cartas
- [ ] Host fecha o navegador → outro jogador vira host em < 5s, sem interação
- [ ] Um jogador ausente não impede a partida de terminar
- [ ] Convidado cria conta ao fim da partida e o histórico daquela partida está lá
- [x] Teste de RLS: cliente autenticado como jogador A não consegue ler `match_private_state` de B
      — conferido nas suítes do Dossiê ("o terceiro jogador não vê a carta mostrada") e do Letreiro
- [x] Nenhum caminho do cliente escreve direto em `matches` ou `match_private_state` — auditado
      por privilégio, em TODAS as tabelas de `public` e para os dois papéis de cliente. Achou
      **TRUNCATE aberto para `anon`** em quatro tabelas de jogo: RLS não se aplica a TRUNCATE, e
      em `matches` o `anon` tinha TRUNCATE e não tinha SELECT (0099)
- [ ] `axe-core` sem violações críticas no lobby e em cada jogo
- [ ] Lighthouse mobile ≥ 90 em Performance e 100 em Acessibilidade no lobby
