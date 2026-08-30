-- ════════════════════════════════════════════════════════════════════════════
-- Mesa — 0108 · o Solar das Acácias dá nome às Cartas de Pista
--
-- Os outros três casos ganharam os nomes em `scripts/seed-dossie.mjs`, que é
-- onde eles moram. O Solar é mais velho que o script: ele foi publicado direto
-- em SQL na 0011, e nunca foi movido de lá.
--
-- Movê-lo agora seria republicar o caso inteiro — nove lugares, seis suspeitos,
-- seis objetos, a narração e o grafo — para escrever seis linhas. Uma migração
-- que mexe só no `copy` diz exatamente o que mudou, e o `||` preserva o que já
-- estava lá: quem lê o diff vê seis nomes, e não um caso inteiro reescrito.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE O NOME É DO PACOTE E O EFEITO É DO MOTOR
--
-- Uma "chave-mestra" numa estação orbital é um acesso de manutenção; numa boate
-- é um passe de camarim; num solar dos anos quarenta é a chave do caseiro. O
-- servidor não sabe nada disso e não precisa saber — é a mesma divisão que
-- `accuse` e `ghost` já faziam, e por isso o nome mora em `copy` e não num campo
-- novo. Uma casa só para as palavras que o caso troca.
--
-- O validador em `seed-dossie.mjs` cobra as SEIS ou nenhuma: meia mão reescrita
-- é uma mão em que duas cartas falam a língua do caso e quatro falam a do motor,
-- o que é pior que as seis genéricas.
-- ════════════════════════════════════════════════════════════════════════════

update public.game_themes
   set data = jsonb_set(
         data,
         '{copy}',
         coalesce(data -> 'copy', '{}'::jsonb) || jsonb_build_object(
           'pista.chave-mestra',  'Chave do caseiro',
           'pista.tempo-curto',   'A ceia está servida',
           'pista.alibi',         'Eu estava na copa',
           'pista.impressao',     'Marca de dedos na prata',
           'pista.recado',        'Bilhete sob a porta',
           'pista.interrogatorio', 'Conversa no corredor'
         )
       )
 where id = 'solar-das-acacias';
