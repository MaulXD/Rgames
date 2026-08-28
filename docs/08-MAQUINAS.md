# PRD 08 — As Máquinas

> Jogar sozinho não é um modo à parte. É a mesma partida, com uma cadeira ocupada por alguém que
> não vai embora.

---

## 1. A decisão de fundo: uma máquina é um jogador

Uma máquina tem conta em `auth.users`, perfil com nome e cara, assento, cor e linha em
`match_players`. Não existe um "segundo tipo de jogador" em lugar nenhum do código.

Isso não foi estética. `room_members.user_id` referencia `profiles`, que referencia `auth.users`, e
**todo mecanismo que já existia** — assentos, cores, RLS, migração de anfitrião, apuração, placar —
pressupõe um usuário por assento. Inventar um segundo tipo significaria tocar em cada um desses
lugares, e cada toque é uma chance de divergir.

A consequência mais bonita apareceu no Letreiro: **a apuração não precisou de uma linha nova.** As
palavras da máquina moram no `match_private_state` dela, e `letreiro_score_bruto` já somava o estado
privado de todo mundo. Até a anulação de palavra repetida funciona contra a máquina, porque ela
sempre funcionou entre estados privados.

São **oito máquinas para o site inteiro** — Zulmira, Nestor, Dedeu, Guiomar, Tonho, Creuza,
Wanderley, Belinha. A chave de `room_members` é `(sala, jogador)`, então a mesma máquina senta em
quantas mesas quiser ao mesmo tempo; o que muda por sala é o **nível**, em `room_members.bot_nivel`.

Cada uma tem nome e cara própria, e nenhuma se chama "Bot 1". Sentar numa mesa com "Bot 1, Bot 2,
Bot 3" é sentar numa planilha. O custo é o mesmo e o efeito não.

---

## 2. O ator é parâmetro, nunca ambiente

Toda ação de jogo resolvia quem estava agindo por `auth.uid()`. Uma máquina não faz login — não há
`auth.uid()` nenhum.

Havia dois caminhos, e o segundo era armadilha:

1. **Escrever um turno de máquina que mexe no estado por conta própria.** Duplicaria a matemática do
   combate, o bônus da carta de território, a herança da mão de quem foi eliminado, a virada de
   rodada da Campanha. No dia em que uma regra mudasse, a máquina passaria a jogar outro jogo — em
   silêncio, que é o pior jeito de divergir.

2. **Deixar `auth.uid()` ser sobrescrito por `set_config` dentro da transação.** Curto, elegante, e
   um buraco de privilégio da mesma família dos dois que este projeto já abriu: identidade que vem
   do ambiente é identidade que alguém pode trocar.

O caminho escolhido é o chato. Cada ação ganhou um irmão `_como(p_seat, …)` com as regras, e a
função pública de mesmo nome virou uma casca que resolve quem é e delega:

```sql
create or replace function public.dominio_atacar(p_match uuid, p_de text, p_para text, p_vezes int)
returns jsonb ... as $$
begin
  select * into est, s, meu, mp from public.dominio_na_vez(p_match);   -- auth
  return public.dominio_atacar_como(meu, p_match, p_de, p_para, p_vezes);
end $$;
```

**Uma implementação das regras, dois chamadores.** É a disciplina de "o servidor é a fonte da
verdade" aplicada à identidade: explícita, nunca implicada.

As trinta funções `_como` foram **geradas** de `pg_get_functiondef` das definições vivas
(`scripts/gera-*-ator.mjs`), e não copiadas dos arquivos de migração — as funções foram redefinidas
ao longo de dezenas de migrações, e copiar do arquivo errado já custou um *cannot change return
type* três vezes.

### O que guarda o contrato

Duas auditorias em `scripts/smoke.mjs`, e cada uma existe porque a coisa aconteceu:

| Invariante | O que ela pegou |
|---|---|
| Nenhuma função `_como` contém `auth.uid()` | `met_aposta_como` gravava a aposta secreta da máquina no estado privado da **pessoa** que tocou o passo dela |
| Nenhuma função compara `<tabela>.seat = seat` | `dominio_tocar` reescrita do zero usou `seat` como variável — o mesmo 42702 de duas migrações anteriores |
| Os núcleos `_como` não são chamáveis pelo cliente | `dominio_atacar_como(3, …)` ataca no lugar do assento 3 |

---

## 3. O ritmo é metade do jogo

O caminho óbvio era: quando a pessoa encerra o turno, o servidor joga o turno das três máquinas ali
mesmo e devolve o estado final. Funciona, é uma transação só — **e é um jogo pior.** O mapa dá um
salto: seis territórios mudaram de cor, dois exércitos seus sumiram, e a pessoa não viu nada
acontecer.

Então a máquina **fica na vez**, e existe um RPC por jogo — `dominio_tocar`, `met_tocar`,
`dossie_tocar` — que joga exatamente **um passo**. O cliente chama, espera o respiro, chama de novo.

> O servidor confere que é vez de uma máquina e nada mais: **o cliente manda no ritmo, nunca no
> resultado.**

| Jogo | Granularidade | Respiro | O que a tela conta |
|---|---|---|---|
| Domínio | reforça · ataca · avança · remaneja · passa | 850ms | "Nestor atacou a Aurélia e tomou" |
| Metrópole | rola · compra · constrói · propõe · passa | 900ms (1700 no dado) | "Creuza comprou o Ver-o-Peso" |
| Dossiê | anda · palpita · refuta · acusa | 1300ms | "conferindo a mão" |
| Letreiro | — | — | a barra de tensão sobe com o relógio |

O Letreiro é a exceção e por um bom motivo: as palavras da máquina são decididas no início da
rodada, e só os **instantes** de descoberta vão para o estado público (`botTempos`). O cliente conta
quantos já passaram. Nenhum processo rodando ao lado, e o público sabe exatamente o que saberia de
uma pessoa: **quantas, nunca quais.**

O Dossiê usa o respiro maior porque ali a pausa não é para ver bonito — é para **anotar**. Cada
linha da mesa é uma dedução possível para quem está assistindo.

### Quando ninguém está olhando

`*_toca_pendentes` joga todos os passos pendentes de uma vez, e quem usa é a faxina. Se a pessoa
fecha a aba numa mesa com três máquinas, esperar uma passada do cron por máquina seria esperar
minutos por nada.

E se o cérebro falhar, **a mesa não para**: o erro cai no caminho de sempre e a vez passa como passa
a de quem sumiu. Perder um turno é ruim; travar a partida de todo mundo é pior — e um turno perdido
aparece no registro, então é um sintoma que dá para ver.

---

## 4. O nível é o quanto ela é boa, nunca o que ela vê

Nenhuma máquina vê carta de ninguém, objetivo de ninguém, o envelope do Dossiê, nem o dado antes de
rolar. O nível muda só o quanto ela aproveita a mesma informação.

| | Tranquila | Firme | Impiedosa |
|---|---|---|---|
| **Letreiro** | 25% do teto de palavras comuns | 45% | 72% |
| **Domínio** | ataca com +2 de vantagem, 2 ataques por turno, reforça até no interior, nunca remaneja, aceita toda trégua | +1, 5 ataques, reforça na fronteira ameaçada | paridade, 12 ataques, concentra no continente quase fechado, só aceita trégua quando está perdendo naquela fronteira |
| **Metrópole** | reserva R$ 0, valor = preço de tabela, não negocia | reserva R$ 1.500, paga o dobro pelo que fecha grupo | reserva variável, paga 75% a mais pelo que **impede** o grupo de outro |
| **Dossiê** | usa só a própria mão e o que mostraram a ela | cruza os "passou" | cruza restrições abertas e o "ninguém refutou" |

O erro da tranquila não é aleatório: é o erro **clássico de quem está aprendendo**. Ela reforça o
interior (onde não serve), compra tudo e fica sem dinheiro na rodada seis, não negocia, esquece o
remanejo. Uma máquina que joga mal por sorteio é frustrante; uma que joga mal como gente joga mal é
um adversário.

E o desempate nunca é `random()` — é md5 de `(semente, assento, sequência, coisa)`. Determinístico,
sem viés, e a lição de 0038: sorteio que parece aleatório e não é faz o jogo pior em silêncio.

### Como isso é testado

Quatro versões erradas antes da certa, e as primeiras erraram por motivo bom:

- **Patrimônio final** (Metrópole): a tranquila saiu na frente, 49.260 contra 44.320. Fazia sentido —
  ela compra tudo, e patrimônio conta escritura pelo preço de tabela.
- **Caixa final** (Metrópole): virou de uma rodada para outra. Também fazia sentido: a impiedosa
  converte caixa em **casa**.
- **Territórios por turno** (Domínio): mediu 0,50 × 3,17; depois 1,63 × 4,32; depois 1,79 × 2,26 — e
  nessa última reprovou, porque o dado foi bom para a tranquila.
- **Cartas riscadas** (Dossiê): 17 × 13 numa rodada, 9 × 10 na seguinte. Numa partida curta, uma
  máquina que recebe mão grande e vê muita carta mostrada risca mais que a impiedosa sem inferir
  nada — o número mede a distribuição, não o nível.

> **A regra que sobrou:** confere-se a decisão **onde ela mora** — nas funções que definem a
> política, com número exato — e o comportamento observado vira relatório. Uma partida é uma amostra
> de um, e teste que reprova por sorte do dado ensina a ignorar a saída vermelha.

O que continua sendo cobrado na mesa é o que a política **garante**, não o que ela costuma dar: a
tranquila ataca no máximo duas vezes por turno, então nunca toma mais de dois territórios num turno.
Teto não depende de dado.

E o Dossiê permite fazer melhor que os outros três, porque a dedução é uma **função pura** da
informação disponível: o teste roda `dossie_deduz` sobre a MESMA mão, a MESMA mesa e o MESMO
registro nos três níveis, e compara. A única coisa que varia é o quanto ela cruza — que é exatamente
o que se queria medir desde o começo.

### E a trégua

A máquina **responde** proposta de trégua na hora, e fora da própria vez — uma proposta chega no
turno de quem propôs, e esperar a vez dela seria pendurar a resposta por uma volta inteira do
tabuleiro. A conta é local e é a única honesta: quanto exército a pessoa tem colado na fronteira
dela, contra quanto ela tem colada na da pessoa. Se a pessoa é mais forte ali, a trégua serve.

E ela **nunca rompe**. Não porque romper seja proibido — o servidor deixa, e é o ponto do §6.6 —
mas porque uma máquina que trai não é mais difícil, é só imprevisível; e imprevisível sem intenção
é ruído. A traição vale justamente por alguém ter **escolhido**.

> Vale como regra de cérebro: tudo que a mesa pode exigir **fora da vez** — leilão, proposta de
> troca, resposta de trégua, refutação — vem antes de "é a minha vez?". Escrever depois é escrever
> onde nunca roda, e foi o que aconteceu em 0081.

---

## 5. A máquina do Dossiê não pode ver o envelope

É o cérebro mais difícil dos quatro, e por um motivo só. No Letreiro ela sorteia de uma lista; no
Domínio e na Metrópole ela vê o mesmo tabuleiro que todo mundo. No Dossiê a informação **é** o jogo,
e uma máquina que espiasse `matches.solution` ganharia na segunda rodada sem que ninguém entendesse
por quê — indistinguível de um bug, e pior, indistinguível de um adversário bom.

O que ela sabe é exatamente o que uma pessoa na cadeira dela saberia:

- as cartas da própria mão;
- as cartas que **mostraram** a ela (com quem mostrou);
- quem refutou e quem passou em cada palpite da mesa — que é público.

Nunca **qual** carta foi mostrada a outra pessoa.

As três regras de dedução:

| | |
|---|---|
| **Passou** | não tem nenhuma das três cartas do palpite. A informação mais barata da mesa e a mais subestimada |
| **Refutou** | tem pelo menos uma. Vira restrição aberta; quando duas das três já são de outro, a terceira é dele |
| **Ninguém refutou** | nenhum dos outros tem nenhuma. Ou estão no envelope, ou na mão de quem palpitou. A jogada mais forte do jogo |

A propagação roda até parar de mudar — o mesmo laço que uma pessoa faz no bloco de anotações, e é
por isso que o Dossiê tem bloco de anotações. O que ela conclui fica **gravado** no estado privado
dela e não recalculado do zero: `dossie_log` guarda 80 linhas, e uma máquina que recalculasse
esqueceria o que aprendeu na rodada dois.

Ela também não dá informação de graça: quando tem duas cartas do palpite, mostra de novo a que já
mostrou àquela pessoa.

### O teste central é de honestidade

> **Nenhuma carta que a máquina riscou pode estar no envelope.**

Se uma aparecer ali, ou ela espiou, ou a dedução está errada — e as duas coisas precisam quebrar o
teste. É a mesma checagem que pega trapaça e pega bug de inferência, que é exatamente o que se quer
de uma invariante. Somado a: quando ela acusa, ela **acerta**; e nenhuma função do cérebro contém a
palavra `solution`.

### E as reviravoltas

As três regras próprias dos casos (PRD 03 §6.7) tocam a máquina em três lugares, e cada um deles
foi um jeito diferente de ela ficar pior sem ninguém notar.

**O Apagão fabricava conhecimento falso.** `dossie_deduz` marcava quem NÃO tem a carta com
`mp.seat is distinct from (linha ->> 'from')`. No escuro `from` é nulo, e `x is distinct from null`
é verdade para TODO assento — uma carta mostrada no apagão marcava a mesa inteira, inclusive quem
mostrou. Isso se propaga pelo laço de inferência, e o fim da linha é uma máquina acusando **com
certeza** uma carta que está na mão de alguém. O teste central pega: nenhuma carta riscada pode
estar no envelope.

**A Tempestade a fazia se debater.** Uma máquina que tenta andar para um lugar fechado levanta
`ROOM_CLOSED` de dentro de `dossie_move_como`, e a exceção sobe pela varredura inteira — foi assim
que o Dossiê passou uma temporada sem tirar o turno de ninguém no relógio (0033). Agora ela sabe o
que está fechado e desvia, e a busca de caminho aceita a lista de lugares a evitar.

**E a Tempestade a fazia passar a vez.** Este é o mais interessante dos três, porque a regra estava
CERTA e virou errada quando o contexto mudou:

| | palpitar num lugar já riscado | contra | vence |
|---|---|---|---|
| solta | gasta o turno confirmando o que ela já sabe | **andar** até um lugar que importa | andar |
| presa | gasta o turno confirmando o que ela já sabe | **nada** | palpitar |

Palpitar nunca é nada: mesmo com o lugar descartado, as respostas ensinam sobre o suspeito e sobre
o objeto — duas das três colunas do caderno. Uma reviravolta que só as pessoas sabem aproveitar é
uma reviravolta que torna a máquina mais fácil, e o modo solo é onde a maioria das partidas deste
projeto vai acontecer.

O Registro da Estação não precisou de nada: o fato público entra no bloco "o que está na cara" de
`dossie_deduz`, que vale para os três níveis. A máquina tranquila também ouve o alto-falante.

---

## 6. Jogar sozinho num toque

Começar uma partida solo eram cinco toques: criar sala, abrir o painel, chamar a primeira máquina,
chamar a segunda, começar. Cinco toques é a diferença entre um recurso que existe e um recurso que
se usa — e num celular, às onze da noite, quatro deles são motivo de desistir.

A carta do jogo tem **Jogar sozinho**: escolhe o nível e cai na partida rodando. A única coisa
perguntada é o nível, porque é a única decisão que muda o jogo; cor, regras da casa e tamanho da
bandeja seguem no lobby para quem quiser.

| Jogo | Máquinas numa mesa solo |
|---|---|
| Letreiro | 1 |
| Dossiê | 2 |
| Domínio | 2 |
| Metrópole | 1 |

Não é o mínimo do jogo: é o número que faz a partida ser **boa** sozinho. O Letreiro roda com uma
pessoa só, mas uma grade sem ninguém para anular palavra é metade do Letreiro. A Metrópole com duas
máquinas vira longa demais para o celular.

Se `*_start` falhar, a pessoa cai no lobby com a mesa montada e o botão de começar na frente — nunca
numa tela sem saída.

---

## 7. O relógio não corre contra quem está sozinho

O relógio do turno existe por um motivo só: **proteger as outras pessoas** de quem sumiu. Numa mesa
em que todo o resto é máquina, não há quem proteger — e o que ele faz ali é tirar o turno de quem
atendeu o telefone.

No celular esse é o caso comum, não o raro: sair do aplicativo já é sair da aba, e o modo solo é
onde isso mais acontece.

Então, quando quem está na vez é gente e não sobrou mais nenhuma pessoa na mesa, `turn_deadline` vai
a **nulo** e a tela mostra "sem pressa" no lugar da contagem. Duas exceções, e as duas são a mesma
ideia: no **leilão** da Metrópole e na **fila de refutação** do Dossiê o relógio continua correndo,
porque ali ele não está pressionando ninguém — ele é o que faz a rodada fechar.

É também o que torna a partida longa viável no celular: dá para largar e voltar.

---

## 8. Máquina não ganha XP, nível, conquista nem recorde

`letreiro_premia` percorre `match_players` e dá XP a todos. Depois das máquinas isso passou a
incluir elas, e elas acumularam de verdade — Nestor chegou a `xp=1228`, `partidas=3` e a conquista
`cem-palavras`.

Três coisas erradas ao mesmo tempo: a máquina conta em qualquer contagem de gente; desbloqueia
conquista, que é recompensa por esforço que ela não fez; e tem "melhor palavra da vida", que é uma
frase sobre uma pessoa.

O portão foi para **`dar_xp` e `melhor_palavra`**, não para as quatro funções de prêmio. Corrigir
nos quatro chamadores é escolher esquecer no quinto. As duas seguem saindo caladas em vez de estourar
erro, porque quem chama está premiando a mesa inteira, e a mesa tem máquina.

---

## 9. Onde a máquina ainda não entra

`bot_sabe_jogar(game_key)` é a trava, e ela fica **no servidor** — o cliente não é autoridade. A
interface também não oferece, porque botão que dá erro é promessa quebrada.

A lista começou com um jogo e cresceu uma linha por cérebro: Letreiro (0043), Domínio (0048),
Metrópole (0055), Dossiê (0057). Ela **é** o registro honesto de onde o trabalho chegou.

Assento ocupado por quem não joga é pior que assento vazio: a máquina receberia territórios e um
objetivo secreto, e depois perderia a vez no relógio para sempre — os outros jogariam contra um
cadáver que segura um continente.
