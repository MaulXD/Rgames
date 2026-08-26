# PRD 07 — Sistema de Temas

> Um tema não é uma paleta trocada. É um **mundo completo** — elenco, lugares, objetos, mapa,
> tipografia, som, escrita e uma regra própria — rodando sobre o mesmo motor.

---

## 1. A regra: um motor, muitos pacotes

Nenhum código de jogo sabe o que é uma "biblioteca" ou um "Coronel". O motor do Dossiê conhece
**6 suspeitos, 6 armas, 9 cômodos e um grafo**. Tudo o mais é dado.

```
motor/dossie/          ← lógica, RPCs, validação. Zero conteúdo. Nunca muda ao adicionar tema
temas/dossie/
  solar-das-acacias/   ← 1953, mansão paulista
  ras-zamir/           ← 1928, escavação no deserto
  boate-aurora/        ← 1987, boate
  meridiano-9/         ← 2189, estação orbital
```

Consequência prática: **adicionar um tema é conteúdo, não engenharia.** Se adicionar um tema exigir
tocar no motor, o contrato está errado e o conserto é no contrato.

Isso é decidido **antes** de escrever a primeira linha do Dossiê. Retrofitar tema em um jogo que
nasceu com o conteúdo cravado custa três vezes mais.

---

## 2. O contrato do pacote

```jsonc
{
  "id": "boate-aurora",
  "game": "dossie",
  "name": "Boate Aurora",
  "era": "1987",
  "tagline": "O disco ainda estava girando.",
  "synopsis": "Na madrugada de 3 de outubro de 1987, depois do último set...",
  "difficulty": 2,                     // 1–3, afeta só a curadoria de recomendação

  "victim": { "name": "Nelson Braga", "role": "Dono da casa" },

  "suspects": [                        // exatamente 6
    { "id": "marcao", "name": "DJ Marcão", "role": "Residente da casa há 6 anos",
      "color": "#E5387F", "hatch": "diagonal-r", "crest": "fone", "pawn": "marcao.glb" }
  ],
  "weapons": [                         // exatamente 6
    { "id": "taco", "name": "Taco de sinuca", "mesh": "taco.glb" }
  ],
  "rooms": [                           // exatamente 9
    { "id": "pista", "name": "Pista", "poly": [[..]], "light": "#E5387F" }
  ],

  "adjacency": { "pista": ["bar","cabine","vip"], ... },
  "secretPassages": [["camarim","escada"], ["deposito","estacionamento"]],

  "twist": {                           // opcional — a regra própria do tema
    "id": "apagao",
    "name": "Apagão",
    "rule": "Uma vez por partida, entre as rodadas 4 e 8, refutações ficam anônimas por 1 rodada."
  },

  "art": {
    "palette": { "bg": "#141018", "surface": "#1E1826", "ink": "#F0E9F2", ... },
    "fonts":   { "display": "Syne", "body": "Inter Tight", "data": "DM Mono" },
    "atlas": "aurora.ktx2", "hdri": "aurora-1k.hdr", "cards": "aurora-cards.webp"
  },

  "copy": {                            // o jogo fala a língua do tema
    "suggest": "acusou",
    "noRefute": "Ninguém pôde desmentir.",
    "accuse": "Fechar o caso",
    "ghost": "Encostado",              // como o tema chama o Fantasma
    "reveal": "FOI %SUSPECT%, com %WEAPON%, %ROOM_PREP%"
  },

  "sfx": { "step": {"pista":"passo-carpete", "estacionamento":"passo-asfalto"}, ... },
  "openingCard": "aurora-title.webp"
}
```

Regras do contrato:
- **Nenhum campo é opcional além de `twist`.** Não existe herança do tema padrão — se faltar texto,
  o validador reprova. Fallback silencioso é como um tema fica pela metade sem ninguém perceber.
- **O grafo de cômodos pode mudar por tema.** Isso é intencional: cada tema joga um pouco diferente.
  O validador garante que continue balanceado (§5).
- **`copy` cobre toda a interface do jogo.** O log do Dossiê é narrado; no Solar ele diz
  *"Otávio acusou Marisa"*, na Aurora diz *"Ivan botou a culpa na Bete"*.

---

## 3. Escolher, sortear ou ser surpreendido

No lobby, quatro modos:

| Modo | Como funciona |
|---|---|
| **Escolher** | O host seleciona. Cada tema mostra capa, era, dificuldade e a reviravolta |
| **Aleatório** | O servidor sorteia e revela no lobby, com a capa |
| **Surpresa** | Ninguém sabe. O tema só é revelado quando a partida começa, com a abertura |
| **Rodízio** | Em revanches seguidas, nunca repete até esgotar os temas |

**Surpresa é o padrão em revanche.** Terminou uma partida, o botão principal é
`Revanche · tema surpresa`. Um clique, mundo novo.

Quem escolhe pode também **travar a reviravolta**: em "Regras da casa → Reviravolta do tema:
ligada / desligada". Quem quer o jogo limpo joga o jogo limpo.

### A abertura

Seis segundos, pulável a partir do segundo 2, e ninguém pula na primeira vez:

1. Tela escurece completa (600ms)
2. A ilustração de capa entra em escala 1.06 → 1.00, com o grão do tema
3. O título entra na tipografia display do tema, em três tempos
4. Era e chamada aparecem embaixo
5. Corte para o mapa, já iluminado

É a coisa mais barata do sistema inteiro e é o que faz o tema parecer um jogo diferente em vez de
uma opção num menu.

---

## 4. Reviravolta: uma regra por tema, e só uma

Cada tema pode carregar **exatamente uma** regra própria. Não duas. A restrição é o que impede o
sistema de virar uma bagunça de exceções.

A regra precisa passar em três testes:

1. **Cabe numa frase** que qualquer jogador entende na primeira vez que ouve
2. **Nasce do lugar** — tempestade de areia numa escavação, apagão numa boate. Nunca é uma mecânica
   genérica pintada com o tema
3. **Não muda quem ganha, muda como se joga.** Reviravolta que decide a partida é desbalanço, não tema

As quatro do Dossiê estão em [PRD 03 §4](03-PRD-DOSSIE.md).

---

## 5. Validador — roda no CI, reprova o build

Um tema quebrado é pior que um tema ausente. Todo pacote passa por:

**Estrutura**
- Exatamente 6 suspeitos, 6 armas, 9 cômodos
- Todo `id` único; todo `mesh` e `poly` existem
- Nenhuma chave de `copy` faltando

**Grafo** — é o que garante que um tema novo não quebre o balanceamento
- Conexo
- Grau médio entre **2,5 e 3,5**
- Diâmetro **≤ 4** (nenhum cômodo a mais de 4 movimentos de qualquer outro)
- Exatamente **2 passagens secretas**, e elas ligam cômodos a **≥ 3 movimentos** de distância
- Nenhum cômodo com grau 1 (beco sem saída trava o jogo)

**Cor e acessibilidade**
- Todos os 15 pares de suspeitos distinguíveis em protanopia, deuteranopia e tritanopia
- Contraste AA de cada cor de texto sobre cada superfície do tema
- Toda cor de suspeito tem hachura e brasão declarados

**Peso**
- Pacote de assets **≤ 900 KB** (§6)
- Capa e miniatura otimizadas

**Idioma**
- Nenhum texto do tema cai no tema padrão

---

## 6. O custo real

Isto é o item que mais pode estourar o cronograma, então está escrito com número.

### 6.1 Assets 3D — o barato

A geometria pesada é **compartilhada**. Os cômodos são polígonos extrudados a partir do próprio
`adjacency` + `poly` do pacote, com o material vindo do atlas. Não há um modelo de mansão e um
modelo de estação — há um extrusor e duas texturas.

O que é próprio de cada tema:

| Item | Orçamento |
|---|---|
| 6 peões (low poly, silhueta distinta) | 240 KB |
| 6 armas em miniatura | 120 KB |
| 1 atlas de textura 2048² KTX2 | 380 KB |
| 1 HDRI 1k comprimido | 120 KB |
| Capa + miniatura | 40 KB |
| **Total** | **≤ 900 KB** |

Carregado sob demanda quando a partida começa. O lobby carrega só a miniatura de 12 KB por tema.

### 6.2 Ilustração — o caro

**21 cartas por tema.** Quatro temas são **84 ilustrações**. É o maior item de custo do projeto e
não adianta fingir que não é.

Três decisões que tornam isso viável:

1. **Uma técnica por tema, escolhida por ser rápida e consistente.** Não é estilo livre:
   - Solar das Acácias → retrato em meio-tom de alto contraste (cartaz policial)
   - Ras Zamir → prancha de cianotipia sobre papel de caderno de campo
   - Boate Aurora → risografia de 2 cores com registro desalinhado
   - Meridiano-9 → foto de crachá com varredura de CRT e etiqueta Dymo por cima

   Técnica fixa = decisões já tomadas = produção 3× mais rápida e resultado coeso.

2. **Cartas de arma e cômodo são mais simples que as de suspeito.** Objeto isolado e planta baixa
   custam uma fração de um retrato. O peso real é 6 retratos por tema, não 21 peças.

3. **Um tema por lançamento.** Dossiê estreia com **dois** temas. Os outros dois chegam como
   *conteúdo novo* depois — o que também é o melhor motivo que existe para o grupo voltar.

---

## 7. Temas nos outros três jogos

O sistema é da plataforma, não do Dossiê. Mas o **peso** de um tema muda por jogo:

| Jogo | O que o tema troca | Custo | Quando |
|---|---|---|---|
| **Dossiê** | Mundo inteiro: elenco, mapa, armas, regra própria | Alto | **v1 com 2 temas** |
| **Letreiro** | Só o material: bandeja, dados, som, luz. Zero conteúdo | Baixíssimo | **v1** |
| **Domínio** | A pele do mapa: papel, marcadores, rótulos. O grafo é o mesmo | Baixo | v1.1 |
| **Metrópole** | Nomes das 28 propriedades, arquitetura dos prédios, 32 cartas | Alto | v1.1, um por vez |

### Letreiro — quatro bandejas [v1]

Trivial de fazer e resolve o "enjoa em 4 rodadas" de graça, porque o jogo em si não muda:

| Tema | A cena |
|---|---|
| **Nogueira** (padrão) | Bandeja de madeira, feltro cinza-azulado, dados de baquelite creme |
| **Osso e Areia** | Bandeja de couro cru sobre areia, dados de osso talhado, luz de sol vertical |
| **Fliperama** | Bandeja de fórmica com padrão Memphis, dados de acrílico translúcido iluminados por baixo |
| **Meridiano** | Bandeja de alumínio escovado, dados de cerâmica técnica gravados a laser, luz âmbar de CRT |

Mesmo mesh, mesmo código. Muda material, HDRI, som e paleta. **Um dia de trabalho por tema.**

### Domínio — quatro cartas [v1.1]

| Tema | O mapa |
|---|---|
| **Cartografia 1936** (padrão) | Papel de mapa com vincos, tinta sépia, peças de metal fundido |
| **Carta de Dunas** | Couro e areia, fronteiras em cordão, marcadores de bronze |
| **Grade Tática** | Vetor de fósforo verde sobre acrílico, marcadores translúcidos — sala de guerra dos anos 80 |
| **Carta Orbital** | Placas tectônicas de um planeta, marcadores de cerâmica |

O grafo de Vantara não muda. É a mesma partida com outra luz — o que é exatamente o objetivo.

### Metrópole — quatro cidades [v1.1]

Aqui o tema troca os **nomes das 28 propriedades e as 32 cartas**, então é conteúdo de verdade:

| Tema | A cidade |
|---|---|
| **Déco Tropical** (padrão) | Bairros brasileiros, art déco, prédios modernistas |
| **Oásis** | Caravançarais, poços, mercados. Prédios viram torres de barro e cúpulas |
| **Neon 87** | Shopping, videolocadora, boate, fliperama. Prédios de vidro espelhado e néon |
| **Colônia** | Setores de uma cidade orbital. Prédios viram cúpulas e módulos empilhados |

Um por lançamento, começando pelo padrão.

---

## 8. Escopo e cadência

### v1
- Contrato de pacote + carregador + validador no CI
- **Letreiro:** as 4 bandejas (custo quase zero, entra no lançamento do MVP)
- **Dossiê:** motor 100% agnóstico + **2 temas completos** — Solar das Acácias e Boate Aurora
- Seleção: Escolher, Aleatório, Surpresa, Rodízio
- Abertura de tema

### v1.1
- **Dossiê:** Ras Zamir e Meridiano-9
- **Domínio:** as 4 peles de mapa
- **Metrópole:** primeira cidade alternativa

### Futuro
- Estatísticas por tema ("você é bom no Solar e péssimo na Aurora")
- Tema sazonal (uma noite de festa junina, um Natal)
- Editor de tema da comunidade — o contrato já é um JSON; o que falta é a UI e a moderação

---

## 9. Critérios de aceite

- [ ] Adicionar um tema novo não toca em **nenhum** arquivo dentro de `motor/`
- [ ] O validador reprova um pacote com 5 suspeitos, com cômodo de grau 1, ou com diâmetro 5
- [ ] O validador reprova duas cores de suspeito indistinguíveis em deuteranopia
- [ ] Faltar uma chave de `copy` reprova o build — não cai em fallback
- [ ] Cada pacote de assets pesa ≤ 900 KB e só é baixado quando a partida começa
- [ ] O lobby lista os temas carregando ≤ 60 KB no total
- [ ] Modo Surpresa: o tema não aparece em nenhuma resposta de rede antes do início da partida
- [ ] Rodízio não repete tema até esgotar
- [ ] Reviravolta desligada nas Regras da casa → o tema roda como jogo limpo
- [ ] Trocar de tema entre revanches não exige recarregar a página
- [ ] Cada tema passa no teste de [Direção de Arte §1](01-DIRECAO-DE-ARTE.md): *poderia ser a
      fotografia de um jogo real?*
