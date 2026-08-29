# PRD 01 — Direção de Arte

> Este documento existe por um motivo específico: **o pedido foi fugir do AI slop.** Isso não se
> resolve com bom gosto na hora de codar. Resolve-se com regras escritas, uma lista de proibições e
> um teste que qualquer tela precisa passar antes de entrar.

---

## 1. O teste

Antes de qualquer tela ir para o `main`, ela passa por uma pergunta:

> **Isto poderia ser a fotografia de um jogo de tabuleiro real, em cima de uma mesa, com luz de
> luminária?**

Se a resposta for *"não, parece um dashboard SaaS"*, a tela volta.

O corolário é a tese estética inteira do projeto: **não estamos fazendo um app com tema de jogo.
Estamos fotografando um objeto que não existe.** Papel tem grão. Feltro absorve sombra. Latão tem
risco. Carta tem espessura e canto gasto. Dado tem peso. Nada aqui "flutua com blur".

---

## 2. A lista de proibições

Não são preferências. São **regras de merge**. Qualquer uma destas em um PR é motivo de rejeição
sem discussão.

| # | Proibido | Por quê |
|---|---|---|
| 1 | Gradiente linear roxo→azul, índigo→violeta, ou qualquer "brand gradient" | É a assinatura visual do template genérico |
| 2 | Glassmorphism (`backdrop-blur` + borda `white/10`) sem justificativa diegética | Vidro que não é vidro de nada |
| 3 | Emoji como ícone ou ilustração — em botão, card, título, vazio, tudo | Emoji é fala, não interface. Um só lugar é permitido: mensagem de chat digitada pelo usuário |
| 4 | Ícone de biblioteca dentro de círculo pastel | O clichê visual mais reconhecível de 2023 |
| 5 | Inter, Poppins ou Montserrat como fonte de **display** | Inter Tight é ótima para corpo. Como título, é ausência de decisão |
| 6 | `shadow-md` / `shadow-lg` do Tailwind em elemento de destaque | Sombra difusa e cinza não existe no mundo físico. Ver §4 |
| 7 | Card branco `rounded-xl` sobre `bg-slate-50`, empilhado em grade de 3 colunas | O layout padrão de tudo |
| 8 | Texto com gradiente clipado (`bg-clip-text`) | Ver #1 |
| 9 | "Bento grid" sem hierarquia real de conteúdo | Grade não é hierarquia |
| 10 | Skeleton com shimmer diagonal roxo | Ver §5 para o que fazer no lugar |
| 11 | Ilustração 3D de blob / "corporate memphis" / pessoas sem rosto | — |
| 12 | Copy tipo "Eleve sua experiência", "Desbloqueie o poder de", "Sem esforço", "Simples assim" | Escrever como gente. Ver §7 |
| 13 | Dark mode que é só `slate-900` com o mesmo layout | Ver §3.1 |
| 14 | Ícone de dado com 6 pontinhos genérico | Desenhamos os nossos |
| 15 | Qualquer item da lista própria do tema em que você está trabalhando | Cada estética tem a sua armadilha. Ver §3.5 |

### O que fazer no lugar

| Em vez de | Faça |
|---|---|
| Gradiente de marca | Cor sólida com textura de material. Papel tem variação, não gradiente |
| Glassmorphism | Camadas físicas: carta sobre feltro, com sombra de contato curta |
| Emoji | Ícone autoral da grade de 24px (§4.4) ou ilustração |
| Sombra difusa | Sombra de contato (curta, escura, próxima) + sombra ambiente (longa, suave) |
| Card flutuante | Objeto apoiado: borda de 1px na cor do material escurecida, não `border-gray-200` |
| Shimmer | O objeto real, em estado "ainda não virado" (verso da carta, dado parado) |

---

## 3. Cor

### 3.1 O modelo mental

**Não há "light mode" e "dark mode".** Há **luz de dia** (mesa perto da janela: papel creme, sombras
frias) e **luz de luminária** (mesa à noite: feltro escuro, luz quente pontual, sombras profundas).
São duas cenas diferentes do mesmo objeto, não uma inversão de tokens.

Consequência prática: no tema noturno, a superfície não fica `#0f172a`. Ela fica **feltro verde
escuro** com um halo quente no centro da mesa. As cartas continuam claras — papel não vira preto
quando você apaga a luz.

### 3.2 Chassi da plataforma — "Feltro e Latão"

O chassi é tudo que não é jogo: home, lobby, perfil, convite, placar.

```css
:root {
  /* Tinta */
  --ink-900:   #14100E;   /* preto-marrom de tinta de impressão */
  --ink-700:   #2B231E;
  --ink-500:   #4A3E36;
  --ink-300:   #7C6E63;

  /* Papel */
  --paper-50:  #F7F2E7;   /* superfície principal, luz de dia */
  --paper-100: #EDE4D3;
  --paper-200: #DED2BC;   /* bordas, divisores */

  /* Feltro */
  --felt-900:  #0E241D;
  --felt-800:  #14352B;   /* superfície principal, luz de luminária */
  --felt-600:  #1F4E3D;

  /* Latão — o único metal, usado com parcimônia */
  --brass-600: #8E6B2C;
  --brass-500: #B08A3E;
  --brass-300: #D9B863;

  /* Sinais */
  --lacquer:   #B23A2E;   /* vermelho de laca — destrutivo, perigo, seu turno */
  --jade:      #2E7D5B;   /* confirmação */
}
```

**Regra de proporção 60-30-10**: 60% material de fundo (papel ou feltro), 30% tinta, 10% latão +
sinal. Se o latão passar de 10%, vira bijuteria.

### 3.3 Cada jogo é um mundo

O chassi é comum. Dentro do jogo, a paleta muda inteira. Isso é o que faz quatro jogos parecerem
quatro jogos e não quatro skins.

#### Letreiro — "Madeira e Baquelite"

Bandeja de nogueira, forro de feltro cinza-azulado, dados de baquelite creme com letras gravadas.

```css
--let-wood:    #4A3524;   /* nogueira */
--let-wood-lt: #6B5138;
--let-felt:    #2E3A40;   /* feltro cinza-azulado do fundo da bandeja */
--let-tile:    #EFE6D2;   /* baquelite creme */
--let-tile-sh: #D6C9AC;
--let-letter:  #1A1512;   /* letra gravada, tinta preta */
--let-hit:     #A8D046;   /* verde-limão elétrico — palavra válida */
--let-miss:    #C0553F;   /* palavra inválida */
--let-bonus:   #D9A441;   /* célula multiplicadora */
```

O verde-limão é a **única** cor saturada do jogo inteiro. Aparece por 400ms quando você acerta uma
palavra e some. É o que dá a sensação de recompensa — e só funciona porque tudo ao redor é dessaturado.

#### Dossiê — quatro casos, quatro mundos

Dossiê não tem uma paleta — tem quatro, uma por caso: uma mansão em 1953, uma escavação em 1928,
uma boate em 1987 e uma estação orbital em 2189. Cada uma com tipografia, luz, técnica de ilustração,
som e **lista própria de proibições**. Estão em [§3.5](#35-os-quatro-casos-do-dossiê).

#### Domínio — "Cartografia 1936"

Mapa de papel dobrado, tinta sépia, batimetria em linhas. Nada de "espaço sideral com neon".

```css
--dom-map:     #E4D9BE;   /* papel de mapa */
--dom-sepia:   #7A6242;   /* tinta de fronteira e rótulo */
--dom-ocean:   #B9C9C4;   /* oceano, com linhas de batimetria */
--dom-fold:    #C9BC9C;   /* vinco do papel */

/* Facções: envelhecidas, nunca puras. Cada uma tem hachura própria (§3.4) */
--fac-carmim:  #A63D40;   /* hachura: diagonal / */
--fac-prussia: #3B6E8F;   /* hachura: pontos */
--fac-ocre:    #E9B44C;   /* hachura: horizontal — */
--fac-oliva:   #5B8C5A;   /* hachura: grade # */
--fac-vinho:   #6B4E71;   /* hachura: diagonal \ */
--fac-grafite: #2F3E46;   /* hachura: vertical | */
```

#### Metrópole — "Déco Tropical"

Cartão-postal de cidade brasileira dos anos 50. Terracota, menta, latão, azul de piscina.

```css
--met-cream:   #F2E9DC;
--met-terra:   #C86B4A;   /* terracota */
--met-mint:    #4FA88B;
--met-pool:    #2E7DA8;
--met-brass:   #C9A227;
--met-asphalt: #33302E;
--met-money:   #2F6B4F;   /* verde de cédula */
```

### 3.4 Daltonismo é requisito funcional

Em Domínio e Metrópole, saber de quem é um território/propriedade é **necessário para jogar**.
Cor sozinha não serve para ~8% dos homens.

Toda facção/jogador carrega **três** identificadores redundantes:
1. **Cor**
2. **Padrão de hachura** (SVG `<pattern>` aplicado ao preenchimento do território)
3. **Brasão** — ícone autoral de 16px, presente no marcador de exército e na legenda

Verificação obrigatória no CI: capturar screenshot da cena e rodar simulação de protanopia,
deuteranopia e tritanopia. Se duas facções ficarem indistinguíveis em qualquer uma delas, falha o build.

---

### 3.5 Os quatro casos do Dossiê

Dossiê não tem uma paleta. Tem quatro mundos ([PRD 03 §3](03-PRD-DOSSIE.md)). E aqui vale um aviso
que é o motivo desta seção existir:

> **Três dessas quatro estéticas são armadilhas de AI slop.** Junto com "startup SaaS", "anos 80
> retrô" e "futuro tecnológico" são os territórios onde qualquer gerador cai no clichê mais rápido —
> e o clichê que ele produz não é a estética real, é a lembrança de segunda mão dela. Por isso cada
> caso abaixo tem a sua **própria lista de proibições**, além da lista geral de §2.

---

#### 3.5.1 Solar das Acácias — Noir Art Déco

Mansão à noite. Luz dura de abajur, sombras com aresta, latão nas maçanetas.

```css
--dos-bottle:  #123027;   /* verde-garrafa — papel de parede */
--dos-wine:    #59161B;   /* bordô — carpete, cortina */
--dos-brass:   #C09A56;
--dos-paper:   #E8DCC4;   /* papel envelhecido — cartas e dossiê */
--dos-blue:    #1B2F45;   /* azul-blueprint — planta da mansão */
--dos-blood:   #8B1E1E;   /* usado uma vez por partida */
```

**Tipografia:** Bodoni Moda 700 (display) · Inter Tight (corpo) · Bodoni Moda `tnum` (números)
**Luz:** abajur pontual, quente. Sombra dura com aresta definida — luz de 1953 é uma lâmpada, não um softbox
**Ilustração:** retrato em meio-tom de alto contraste, estilo cartaz de cinema policial
**Referências:** cartazes policiais dos anos 40, Saul Bass, fotografia de José Medeiros para O Cruzeiro

**Proibido neste caso:** filtro sépia uniforme · máquina de escrever como ícone · lupa de detetive ·
pegada de sangue desenhada · silhueta de homem de chapéu sob poste de luz.

---

#### 3.5.2 Boate Aurora — 1987 de verdade

**O tema mais perigoso do projeto.** "Anos 80" em gerador significa: pôr-do-sol em gradiente
roxo-rosa, grade em perspectiva até o horizonte, palmeira em silhueta, aberração cromática no texto,
glow em tudo. **Nada disso é 1987.** É 2015 lembrando de 1987 — e lembrando errado.

O que 1987 era, materialmente:

- **Impressão offset CMYK** com registro 1–2px desalinhado e trama de retícula visível
- **Memphis Group** (Ettore Sottsass): formas geométricas primárias, squiggle, terrazzo, cores
  **chapadas** — nunca gradiente
- **Sideart de fliperama**: aerografia com contorno preto duro, cores sólidas
- **Néon de verdade**: um tubo de vidro branco-quente no centro, halo colorido difuso em volta e
  reflexo no chão molhado. Não é `text-shadow` colorido
- **A boate é escura e suja**: carpete bordô encardido, espelho riscado, cromado arranhado, fumaça
  de máquina, fita adesiva marcando o chão
- **VHS**: o sangramento é só no canal de cor (o luma continua nítido), mais dropout branco e tracking

```css
--au-black:   #141018;   /* preto de boate, com roxo dentro */
--au-carpet:  #7A1F3D;   /* carpete encardido */
--au-magenta: #E5387F;
--au-cyan:    #2ED3D9;
--au-acid:    #E8E24A;
--au-grape:   #5B3C8C;
--au-chrome:  #C9CDD4;
```

**A regra que salva este tema:** as cores saturadas são **fontes de luz**, não superfícies. O magenta
é um refletor apontando para a pista, não um fundo de card. **80% da tela é preto sujo e carpete.**

**Tipografia:** Syne 700/800 (display) · Inter Tight (corpo) · DM Mono (dados)
**Ilustração:** risografia de duas cores — magenta e ciano — com registro desalinhado

**Proibido neste caso:**
1. Gradiente pôr-do-sol roxo → rosa → laranja
2. Grade em perspectiva com linha de horizonte
3. Palmeira em silhueta
4. Aberração cromática em texto
5. Sol listrado / "retrowave sun"
6. A palavra `synthwave` em qualquer lugar do código
7. Monoton, ou qualquer display de néon com contorno duplo
8. Glow uniforme em todo elemento colorido

**Som:** o baixo chega **através da parede**, e o abafamento muda por lugar — seco e alto na Pista,
um thump distante com eco no Estacionamento, médio com reverberação de azulejo na Escada de Incêndio.
É a coisa mais barata do projeto que faz um mapa parecer um lugar real. Mais: gelo no copo, porta
pesada de boate, fliperama ao longe, microfonia, agulha caindo no disco.

---

#### 3.5.3 Ras Zamir — 1928 no deserto

Perigo médio. "Deserto" em gerador vira gradiente laranja→rosa, duna de curva perfeita, silhueta de
camelo e tipografia "papiro".

O que uma escavação em 1928 era:

- **Lona de tenda**: costura, ilhós, remendo, e uma sombra interna verde-oliva
- **Sol vertical não faz gradiente.** Faz sombra **dura e curta**, e estoura o branco
- **Poeira assenta em tudo** — toda superfície tem uma camada fosca por cima
- **Cianotipia** (azul-prússia sobre branco) para plantas e desenhos de campo
- **Caderno de campo**: papel quadriculado, tinta borrada, marca de caneca
- **Latão e cobre oxidado** (verdete), nunca ouro reluzente
- **Pranchas de Egiptologia do século XIX**: linha fina, hachura, legenda numerada

```css
--rz-sand:    #D9C6A5;
--rz-canvas:  #C6B393;   /* lona crua */
--rz-indigo:  #2B3A5B;   /* cianotipia, tinta */
--rz-verdete: #6E8B7A;   /* cobre oxidado */
--rz-brass:   #A67C2E;
--rz-sepia:   #4A3826;
--rz-shade:   #3A3A44;   /* sombra fria dentro da tenda */
```

**O contraste é a identidade:** o sol estoura o branco, a sombra é fria e profunda. Não existe
meio-tom quente aqui — é o oposto exato do "warm cream" genérico.

**Tipografia:** Cinzel (display, inscricional — das placas e do frontispício) · Inter Tight (corpo) ·
Spectral (legendas de campo, com numeração)
**Ilustração:** cianotipia sobre papel quadriculado de caderno de campo

**Proibido neste caso:**
1. Gradiente laranja → rosa de pôr-do-sol
2. Duna de curva suave e limpa — areia real tem crista irregular e rastro de vento
3. Silhueta de camelo ou de caravana
4. Tipografia "papiro" ou pseudo-hieróglifo decorativo
5. Ouro reluzente — latão de expedição é fosco e sujo
6. Filtro sépia uniforme sobre a tela

**Som:** lona batendo no vento (o único loop diegético permitido), pincel raspando pedra, rádio de
ondas curtas com estática, lampião chiando, poeira assentando.

---

#### 3.5.4 Meridiano-9 — 2189, o futuro usado

**O segundo tema mais perigoso.** "Futuro tecnológico" em gerador vira azul-ciano brilhante, linhas
de HUD holográfico, hexágonos, grid em perspectiva, glow em tudo e fundo azul-escuro→preto. Isso não
é design de ficção científica: é tela de carregamento de jogo mobile.

A referência é **futuro usado** — *Alien* (1979), *Silent Running*, os painéis da era Apollo, e
Dieter Rams na Braun.

O que isso significa em objeto:

- **Plástico ABS creme amarelado pelo tempo**, não branco brilhante
- **Metal pintado industrial**, com risco e desgaste na quina
- **Botões físicos com curso**, chaves de alavanca com proteção, mostradores analógicos
- **CRT de fósforo âmbar**, não azul: monoespaçado, sem antialias, com blooming leve e scanline
- **Etiquetas Dymo** — fita plástica com letras em relevo — coladas por cima de rótulos
  serigrafados que estão errados
- **Fita adesiva, remendo, cabo passado por fora do painel**
- **Tipografia suíça funcional**: condensada, maiúsculas, tracking largo
- A luz é **fluorescente**, não néon: chapada, levemente esverdeada, com flicker ocasional

```css
--m9-hull:   #B8B2A6;   /* ABS envelhecido */
--m9-panel:  #4C5157;   /* metal pintado */
--m9-dark:   #191C1F;
--m9-amber:  #E39B3C;   /* CRT — o único brilho da estação */
--m9-signal: #D8452F;   /* emergência */
--m9-mint:   #8FBFA8;   /* luz de crescimento da hidroponia */
--m9-tape:   #C8B560;   /* fita adesiva */
```

**Regra de ouro:** o âmbar é **a única coisa que brilha**, e ele brilha porque é um tubo de raios
catódicos — não porque fica bonito.

**Tipografia:** Archivo 700 condensada, maiúsculas, `letter-spacing: .14em` (rótulos de painel) ·
Inter Tight (corpo) · JetBrains Mono (o CRT)
**Ilustração:** foto de crachá com varredura de CRT e etiqueta Dymo colada por cima

**Proibido neste caso:**
1. Azul-ciano brilhante como cor dominante
2. Linhas de "HUD holográfico" flutuando no ar
3. Hexágonos
4. Grid em perspectiva com horizonte
5. Glow em texto
6. Display "tecnológico" com cortes nas letras — Orbitron, Michroma e parentes
7. Interface flutuando sem suporte físico
8. Qualquer coisa branca e brilhante. **Nada nesta estação é novo**

**Som:** zumbido de ventilação constante (o único loop diegético permitido), servo de porta
pneumática, bipe de terminal, alarme de despressurização (uma vez por partida, e ele para o coração),
passos com eco metálico. E a voz da NÚBIA: **calma e quase gentil**, nunca robótica — é muito mais
perturbador assim.

---

### 3.6 Temas nos outros três jogos

O sistema é da plataforma ([PRD 07](07-SISTEMA-DE-TEMAS.md)), mas o peso muda por jogo. Nos outros
três, o tema troca **material e luz**, não conteúdo — o que custa quase nada e resolve o "enjoa na
quinta partida".

**Letreiro — quatro bandejas [v1].** Mesma malha, mesmo código. Muda material, HDRI, som e paleta.
Cerca de um dia de trabalho cada:

| Bandeja | A cena |
|---|---|
| **Nogueira** (padrão) | Madeira, feltro cinza-azulado, dados de baquelite creme |
| **Osso e Areia** | Couro cru sobre areia, dados de osso talhado, sol vertical duro |
| **Fliperama** | Fórmica com padrão Memphis, dados de acrílico translúcido iluminados por baixo |
| **Meridiano** | Alumínio escovado, dados de cerâmica técnica gravados a laser, luz âmbar de CRT |

**Domínio — quatro cartas [v1.1].** O grafo de Vantara não muda; muda o suporte: papel de mapa 1936,
couro e areia, vetor de fósforo verde sobre acrílico (sala de guerra dos anos 80), placas tectônicas
de um planeta.

**Metrópole — quatro cidades [v1.1].** Aqui o tema troca os nomes das 28 propriedades e as 32 cartas,
então é conteúdo de verdade: Déco Tropical, Oásis, Neon 87, Colônia. Um por lançamento.

**As proibições de §3.5.2 e §3.5.4 valem igual** para a bandeja Fliperama, a bandeja Meridiano, a
Grade Tática do Domínio e a cidade Neon 87 da Metrópole. A estética é a mesma; a armadilha também.


---

## 4. Forma

### 4.1 Tipografia

Uma família de display por mundo. Uma grotesca para corpo em todo lugar. Todas em Google Fonts
(único host externo permitido, e com bom cache na Vercel).

| Onde | Display | Corpo | Números |
|---|---|---|---|
| Chassi | **Fraunces** (variable, eixos `SOFT` e `WONK`) | **Inter Tight** | Inter Tight `tnum` |
| Letreiro | **Fraunces** 700 `WONK 1` | Inter Tight | **JetBrains Mono** (pontuação) |
| Dossiê · Solar | **Bodoni Moda** 700 | Inter Tight | Bodoni Moda `tnum` |
| Dossiê · Aurora | **Syne** 800 | Inter Tight | **DM Mono** |
| Dossiê · Ras Zamir | **Cinzel** | Inter Tight | **Spectral** |
| Dossiê · Meridiano-9 | **Archivo** 700 condensada | Inter Tight | JetBrains Mono |
| Domínio | **Spectral** 600 (rótulos de mapa) | Inter Tight | JetBrains Mono (tropas) |
| Metrópole | **Archivo Expanded** 700 | Inter Tight | **Archivo** `tnum` (dinheiro) |

Regras:
- **`font-variant-numeric: tabular-nums` é obrigatório** em qualquer número que mude: dinheiro,
  tropas, pontos, cronômetro. Sem isso o número "pula" e parece amador. Esta é a diferença mais
  barata entre bonito e não-bonito.
- Rótulos de mapa em Domínio: `letter-spacing: 0.18em`, maiúsculas, como cartografia real.
- Máximo **2 famílias** visíveis em uma tela. Fraunces + Inter Tight, nunca três.
- Escala modular 1.25 (major third): 12 · 14 · 16 · 20 · 25 · 31 · 39 · 49 · 61.
- Corpo de texto: 16px mínimo, `line-height: 1.55`, `max-width: 68ch`.

### 4.2 Sombra: contato + ambiente

Objeto físico gera **duas** sombras, nunca uma:

```css
/* Papel/carta apoiado sobre feltro */
--shadow-rest:
  0 1px 1px    rgb(20 16 14 / 0.28),   /* contato — curta, escura, quase sem blur */
  0 8px 22px  -6px rgb(20 16 14 / 0.22); /* ambiente — longa, suave, deslocada */

/* Objeto levantado (drag, hover de carta) — contato afasta e clareia, ambiente cresce */
--shadow-lift:
  0 3px 4px   rgb(20 16 14 / 0.18),
  0 22px 44px -10px rgb(20 16 14 / 0.34);
```

A sombra é **da cor da tinta com alpha**, nunca preto puro, nunca cinza neutro. Sombra sobre feltro
verde puxa para o verde; sobre papel creme, puxa para o marrom.

### 4.3 Textura

O que separa "objeto" de "retângulo colorido":

- **Grão de papel**: `feTurbulence` SVG, `baseFrequency 0.8`, opacidade **2,5%**, em `mix-blend-mode:
  multiply` sobre superfícies claras. Um único SVG reaproveitado como CSS `background-image` em data-URI.
- **Feltro**: ruído mais grosso (`baseFrequency 0.35`) a 4%, mais um vignette radial suave que
  simula a luz da luminária no centro da mesa.
- **Borda de carta**: raio 6px, mais uma borda interna de 1px em `--paper-200` a 2px da aresta —
  a "moldura" que toda carta impressa tem.
- **Letterpress** em títulos sobre papel: `text-shadow: 0 1px 0 rgb(255 255 255 / 0.5)` — o relevo
  de tipografia prensada.
- **Latão**: nunca cor chapada. Gradiente de 3 paradas em ângulo fixo (135°) simulando reflexo
  anisotrópico + um risco fino. É a **única** exceção à proibição de gradiente, porque metal é
  literalmente gradiente.

Custo: um arquivo CSS, ~1KB. Retorno: a tela para de parecer feita por template.

### 4.4 Ícones

**Nenhuma biblioteca de ícones.** Nem Lucide, nem Heroicons, nem Phosphor. Conjunto autoral:

- Grade de 24×24, área segura de 20×20
- Traço **1,75px**, terminações retas (`stroke-linecap: butt`), junções em meia-esquadria
- Cantos vivos ou raio máximo de 1px. Nada de "rounded friendly"
- Desenhados como se fossem gravados em latão, não desenhados no Figma
- ~40 ícones para o v1 (chassi + 4 jogos). Entregues como sprite SVG único, `<use>` por referência
- Peças de jogo (dado, carta, exército, casa) **não são ícones** — são renderizações do objeto 3D
  real em baixa resolução, para manter coerência

### 4.5 Espaço e grade

- Base **4px**. Escala: 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96
- Chassi: grade de 12 colunas, gutter 24px, largura máxima 1200px
- Dentro do jogo: **não há grade de colunas.** O tabuleiro define o layout. A HUD orbita o tabuleiro
  em posições ancoradas às bordas da viewport, não em um `flex` genérico
- Raio: 2px (botões, inputs) · 6px (cartas) · 12px (painéis) · 999px (pílula de jogador)

---

## 5. Movimento

### 5.1 Tokens

```ts
export const spring = {
  snap:  { type: 'spring', stiffness: 700, damping: 40, mass: 0.6 },  // botão, toggle, chip
  card:  { type: 'spring', stiffness: 320, damping: 30, mass: 1.0 },  // carta, painel, drawer
  heavy: { type: 'spring', stiffness: 180, damping: 26, mass: 1.8 },  // peça, tabuleiro, câmera
} as const

export const ease = {
  out: [0.16, 1, 0.30, 1],   // entradas — rápido no início, assenta devagar
  in:  [0.70, 0, 0.84, 0],   // saídas — sai acelerando
  io:  [0.87, 0, 0.13, 1],   // reposicionamento
} as const

export const dur = {
  instant: 0.08, fast: 0.16, base: 0.26, slow: 0.42, beat: 0.70,
} as const
```

### 5.2 As sete regras

1. **Nada anima sem causa.** Nenhuma animação em loop, nenhum "pulse" ambiente, nenhum brilho
   passeando. Exceção: movimento diegético (chama de vela no Dossiê, papel do mapa respirando no
   Domínio) — coisas que um objeto real faria.
2. **Feedback de input em ≤ 100ms**, sempre otimista. A carta sai da mão antes do servidor responder.
   Se o servidor recusar, a carta **volta** com `spring.card` e um shake curto de 6px — o gesto de
   "não pode".
3. **Cartas viajam em arco**, nunca em linha reta. Bézier quadrática com controle deslocado
   perpendicular, rotação de −6° a +6° durante o voo, escala 1.06 no ápice. Linha reta é robótica e
   é o erro mais comum.
4. **Peso importa.** Objeto pesado (peça, dado, prédio) tem overshoot pequeno e assenta com
   `spring.heavy`. Objeto leve (tooltip, toast) não tem overshoot nenhum.
5. **Cascata com teto.** `stagger: 40ms`, máximo **8 itens**. Do nono em diante, entra tudo junto.
   Cascata de 20 itens é 800ms de espera que ninguém pediu.
6. **Saída é mais rápida que entrada.** Entrada `dur.base`, saída `dur.fast`. O usuário já decidiu.
7. **A câmera 3D não gira sozinha.** Nunca. Orbit automático é o "gradiente roxo" do 3D.

### 5.3 Movimento reduzido

`prefers-reduced-motion: reduce` não é "animação mais curta". É:

- Todas as transições de posição/escala/rotação → **0ms**, substituídas por crossfade de 120ms
- Física 3D **não roda**: o dado aparece já parado na face correta, com um flash de 120ms
- Nenhum parallax, nenhum scroll-linked, nenhum arco
- O **conteúdo é idêntico** — quem ativou não perde informação, só perde o espetáculo

Implementado uma vez, no provider da Motion (`MotionConfig reducedMotion="user"`) + um hook
`useReducedMotion()` que os componentes 3D consultam.

### 5.4 Estados de carregamento

Nenhum skeleton com shimmer. Em vez disso, o **objeto no estado anterior**:

- Cartas ainda não distribuídas → baralho fechado, com a animação de corte esperando
- Tabuleiro carregando → tabuleiro dobrado, abrindo
- Placar calculando → ábaco/contador rolando com números tabulares
- Dado esperando resultado do servidor → dado na mão, chacoalhando (loop curto, diegético)

Isso transforma latência em antecipação. É o truque mais barato de percepção de performance que existe.

---

## 6. 3D

### 6.1 Onde há 3D (e onde não há)

Decisão de escopo confirmada: **elementos em 3D, cartas e HUD em 2D**.

| Jogo | Em 3D | Em 2D |
|---|---|---|
| Letreiro | 16 dados de letra na bandeja de madeira | Lista de palavras, placar, cronômetro, teclado |
| Dossiê | Peões, objetos em miniatura, planta com relevo — **extrudada do pacote do tema**, uma por caso | Cartas de suspeito/objeto/lugar, bloco de dedução |
| Domínio | Mapa com relevo + marcadores de exército + dados de batalha | Cartas de território, objetivo, HUD de fase |
| Metrópole | Tabuleiro isométrico, prédios que crescem, peões, dados | Cartas Sorte/Revés, escrituras, painel de negociação |

**A regra:** 3D para o que tem **peso e posição** (a peça está ali, o dado caiu ali). 2D para o que
tem **informação densa** (texto, números, listas). Carta 3D com texto é ilegível em celular — é o
erro clássico.

### 6.2 Pipeline

```
Modelagem     Blender · low-poly, sem subdivisão · UV única por objeto
Bake          AO + curvature no Blender → mapa de detalhe
Textura       PBR: albedo + roughness + normal. 1024² por objeto, atlas quando possível
Export        glTF 2.0 · compressão Draco (geometria) + KTX2/Basis (textura)
Runtime       React Three Fiber + drei + @react-three/rapier (só onde há física)
```

### 6.3 Orçamento (por cena)

| Métrica | Teto |
|---|---|
| Peso total de assets | 1,5 MB |
| Triângulos | 60.000 |
| Draw calls | 150 |
| Luzes dinâmicas | 2 + 1 HDRI (1k, equirect, comprimido) |
| Texturas | 4 × 1024² KTX2 |
| FPS alvo | 60 (mínimo aceitável 45) |

Instancing obrigatório para tudo repetido: os 16 dados do Letreiro são **uma** `InstancedMesh`.
Os marcadores de exército do Domínio, idem.

### 6.4 Materiais

O material é o que faz parecer real. Valores concretos, não "ajustar até ficar bom":

| Material | `metalness` | `roughness` | Extra |
|---|---|---|---|
| Madeira de nogueira | 0 | 0.55 + roughness map | normal map de veio |
| Feltro | 0 | 0.95 | `sheen: 0.6`, `sheenColor` = cor base clareada |
| Baquelite (dado de letra) | 0 | 0.32 | `clearcoat: 0.45`, `clearcoatRoughness: 0.2` |
| Latão | 1.0 | 0.35 | `envMapIntensity: 1.2` |
| Papel/carta | 0 | 0.85 | espessura real de 0.4mm no modelo, não plano |
| Cerâmica (peão) | 0 | 0.25 | `clearcoat: 0.7` |

**Proibido:** `MeshBasicMaterial` com cor chapada, shader de gradiente arco-íris, emissive saturado,
bloom exagerado. Iluminação vem de **um** HDRI de estúdio + uma key light direcional com sombra
suave. Contact shadows do drei em vez de shadow map completo onde der.

### 6.5 Degradação — o requisito que salva metade do público

Detecção em três níveis, na montagem da cena:

```
1. WebGL2 disponível?              não → modo 2D
2. Renderer em blocklist / GPU     sim → modo 2D
   integrada antiga?
3. FPS médio < 40 por 3s seguidos? sim → degradar:
                                         a) desliga sombras dinâmicas → contact shadows bakeadas
                                         b) DPR 2 → 1.5 → 1
                                         c) desliga física (dados usam animação pré-gravada)
                                         d) ainda < 40 → modo 2D
```

**Modo 2D** não é um erro nem uma tela de aviso. É a mesma partida com sprites pré-renderizados dos
mesmos objetos, nos mesmos ângulos. O jogador percebe que "não tem o dado rolando" e nada mais.
Renderizamos os sprites a partir dos próprios modelos 3D no build — coerência garantida.

Alternar é manual também: **Configurações → Efeitos: Completo / Reduzido / Mínimo**, com a escolha
persistida no perfil.

---

## 7. Voz e texto

Como a Mesa fala:

- **Direta e concreta.** "Sua vez" não "É hora de fazer sua jogada!". "Ninguém achou" não "Nenhuma
  palavra foi encontrada por nenhum jogador nesta rodada".
- **Brasileira, não traduzida.** "Deu ruim", "revanche", "quebrou" (falência), "empatou no grito".
  Sem "Bem-vindo de volta, jogador!".
- **Sem exclamação em UI.** Exclamação só em momento de clímax real (vitória, última rodada).
- **Erros dizem o que fazer.** ❌ "Ação inválida" → ✅ "Não dá pra atacar dali: você precisa de pelo
  menos 2 exércitos no território."
- **Números por extenso até dez** em texto corrido; algarismo sempre em dado de jogo.
- **Nenhum texto de marketing dentro do produto.**

Momentos que merecem uma frase escrita à mão (não gerada por template):
- Sala vazia esperando gente
- Empate
- Jogador desconectou na hora decisiva
- Vitória apertada vs. atropelo
- Palavra mais longa da partida no Letreiro
- Primeira falência na Metrópole

---

## 8. Som

Som é metade da sensação de peso e é o primeiro corte que todo projeto faz. Aqui não.

**Biblioteca autoral por material**, não "SFX pack de UI":

| Evento | Som |
|---|---|
| Peça pousando | Feltro — abafado, curto, sem cauda |
| Dado batendo | Madeira contra madeira, 3 variações + rolagem |
| Carta virando | Papel — o "tec" seco da unha na borda |
| Dinheiro | Latão/cédula, dependendo do valor |
| Letra selecionada | Estalo de baquelite, pitch subindo com o comprimento da palavra |
| Palavra válida | Acorde curto, 2 notas, ascendente |
| Palavra inválida | Nota única abafada, não um "erro" agressivo |
| Seu turno | Sino de latão, uma vez, baixo |

Regras:
- **Throttle de 80ms**: no máximo um som por 80ms, senão vira ruído
- **Variação obrigatória**: mínimo 3 amostras por evento, escolhidas aleatoriamente + pitch shift de
  ±4%. Som idêntico repetido é a coisa mais barata que existe
- Volume padrão **60%**, persistido no perfil, mute em um clique visível (o grupo está em chamada
  de voz — respeitar isso)
- Formato `.webm` (Opus), fallback `.m4a`. Total < 400 KB, carregado depois do primeiro frame
- Nada toca antes da primeira interação do usuário (política de autoplay)

---

## 9. Entrega e verificação

### 9.1 Checklist de PR de interface

- [ ] Passa no teste de §1 ("poderia ser a foto de um jogo real?")
- [ ] Zero itens da lista de proibições (§2)
- [ ] Se é tela de um tema: zero itens da lista própria daquele tema (§3.5)
- [ ] Números que mudam usam `tabular-nums`
- [ ] Sombras usam o par contato+ambiente, na cor da tinta
- [ ] Textura de material presente na superfície de fundo
- [ ] Testado com `prefers-reduced-motion: reduce`
- [ ] Testado em 375px de largura (iPhone SE) e 1440px
- [ ] Contraste AA verificado
- [x] Se tem cor de jogador: hachura presente — e AUDITADA em `npm run css`. As sete facções
      não-lisas do Domínio têm trama própria, nenhuma se repete, e toda `url(#tex-…)` que o CSS
      pede existe no SVG. O mesmo para os sete grupos não-lisos da Metrópole. Em cada jogo UMA
      fica lisa de propósito: sem um liso de referência, o olho não tem contra o que comparar.
- [ ] Se tem 3D: cena degrada corretamente com `?fx=min`

### 9.2 Automatizado no CI

- `axe-core` — violações críticas quebram o build
- Regressão visual (Playwright + screenshot diff) nas 12 telas principais, em 3 viewports × 2 temas
- Simulação de daltonismo nas cenas de Domínio e Metrópole
- Orçamento de bundle (`size-limit`) por rota
- Orçamento de asset 3D: script que soma o peso do `public/models/{jogo}` e falha acima de 1,5 MB

### 9.3 Referências (para consulta, não para copiar)

- **Ilustração de tabuleiro moderno**: Kyle Ferrin (Root), Ian O'Toole (design gráfico de eurogames)
- **Cartografia**: mapas do National Geographic anos 30–50, cartas náuticas
- **Art déco tropical**: cartões-postais brasileiros dos anos 50, azulejaria carioca, Athos Bulcão
- **Noir gráfico**: cartazes de cinema policial dos anos 40, Saul Bass
- **1987 real**: Memphis Group (Ettore Sottsass), sideart de fliperama, capas de LP nacionais, impressos offset da época
- **1928 no deserto**: fotografia de Harry Burton na escavação de Tutancamôn, cianotipia, pranchas da *Description de l'Égypte*
- **Futuro usado**: *Alien* (1979), *Silent Running*, painéis da era Apollo, Dieter Rams na Braun
- **Objeto e material**: fotografia de produto de tabuleiro em superfície escura, luz lateral única
