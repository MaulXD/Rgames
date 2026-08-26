-- ═══════════════════════════════════════════════════════════════════════════
-- Mesa — 0015 · narração e piso do Dossiê
--
-- Imersão é conteúdo, não código. A história do caso entra no pacote do tema,
-- ao lado do elenco e do mapa — assim o próximo caso (1928 no deserto, 1987 na
-- boate, 2189 na órbita) traz a sua própria narração sem tocar em componente.
--
-- Vem também o `piso` de cada lugar: o passo do peão soa diferente em tapete,
-- assoalho e ladrilho. É um campo de texto e três timbres, e é o que faz o
-- mapa parecer um lugar em vez de um diagrama.
-- ═══════════════════════════════════════════════════════════════════════════

update public.game_themes
   set data = data || jsonb_build_object(
     'clima', 'misterio',
     'narracao', jsonb_build_array(
       'Chovia desde a tarde. O Solar das Acácias tinha luz em todas as janelas e ninguém com vontade de estar ali.',
       'Leonel de Sousa Aguiar chamou seis pessoas para o jantar. Disse que era para acertar contas. Não disse quais.',
       'Às onze e dez a energia caiu por quatro minutos. Quando voltou, a porta da biblioteca estava trancada por dentro.',
       'Leonel foi encontrado às onze e meia. O médico da casa disse que não havia mais o que fazer — e ninguém achou estranho ele já estar de luvas.',
       'A estrada para a cidade alagou. A polícia chega amanhã de manhã. Vocês têm a noite.',
       'Uma das seis pessoas nesta casa fez isso. Todas as outras têm alguma coisa a esconder.'
     ),
     'encerramento', 'A chuva parou pouco antes do amanhecer. Quando a polícia chegou, já havia um nome.'
   )
 where id = 'solar-das-acacias';

-- piso de cada lugar, para o som do passo
update public.game_themes
   set data = jsonb_set(
     data,
     '{rooms}',
     (
       select jsonb_agg(
         r || jsonb_build_object('piso', case r ->> 'id'
           when 'biblioteca' then 'tapete'
           when 'escritorio' then 'tapete'
           when 'quarto'     then 'tapete'
           when 'salao'      then 'madeira'
           when 'musica'     then 'madeira'
           else 'ladrilho'
         end)
         order by (r ->> 'row')::int, (r ->> 'col')::int
       )
       from jsonb_array_elements(data -> 'rooms') r
     )
   )
 where id = 'solar-das-acacias';
