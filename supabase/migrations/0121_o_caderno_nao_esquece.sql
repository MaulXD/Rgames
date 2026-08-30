-- 0121 — O CADERNO NÃO ESQUECE
--
-- `dossie_log` guarda as SESSENTA linhas mais novas, e o teto tem um bom
-- motivo: o registro viaja inteiro pelo Realtime a cada jogada, e um registro
-- sem teto vira quilobytes por ação num celular.
--
-- Só que `apura`, o bloco assistido de quem joga, deriva os fatos do REGISTRO,
-- do zero, a cada renderização. Uma partida deste banco chegou a `seq` 281 com
-- sessenta linhas guardadas: duzentas e vinte e uma caíram, e com elas todo
-- "fulano não tem nenhuma das três" que elas provavam.
--
-- Medido em `npm run smoke:bloco`, numa partida de cem linhas: 54 marcas com o
-- registro inteiro, 9 com o cortado. QUARENTA E CINCO FATOS que a pessoa viu
-- acontecer, provou, e o bloco esqueceu.
--
-- ────────────────────────────────────────────────────────────────────────────
-- E A MÁQUINA NÃO ESQUECE NENHUM
--
-- `dossie_deduz` é incremental desde sempre: guarda `dedu` no estado privado,
-- lê só as linhas depois do último `visto`, e o que ela provou uma vez fica
-- provado. O teto do registro não a alcança.
--
-- Quer dizer que numa partida longa a máquina segue com o caderno cheio e a
-- pessoa que joga com o bloco assistido volta a ter um caderno quase vazio.
-- É exatamente a assimetria que o PRD 03 diz não querer — "quem joga com o
-- bloco assistido ficaria abaixo da máquina, riscando à mão o que ela risca
-- sozinha" —, e ela estava acontecendo ao contrário do que o texto imagina: não
-- por o bloco ser fraco, mas por ele ser AMNÉSICO.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O CONSERTO É DAR À PESSOA O MESMO CADERNO, E NÃO UM SEGUNDO MOTOR
--
-- `dossie_deduz` já faz a conta certa, para qualquer assento, e já a guarda. O
-- que faltava era um caminho pelo qual quem joga pudesse pedir o SEU.
--
-- E ele devolve o do CHAMADOR e de mais ninguém. Não recebe assento: o assento
-- é lido de `auth.uid()`. Um parâmetro de assento aqui seria uma porta para ler
-- o caderno alheio — e o caderno alheio é, literalmente, a mão dos outros
-- deduzida.
--
-- O CLIENTE CONTINUA DERIVANDO. Isto não substitui `apura`: substituir custaria
-- uma ida e volta por linha do registro, e o bloco se atualizar depois do resto
-- da tela seria pior do que ele esquecer. O que a resposta daqui faz é SEMEAR —
-- os fatos velhos entram prontos, e o cliente segue derivando os novos na hora
-- em que eles chegam. É o mesmo desenho incremental que o servidor já usa,
-- espelhado.

create or replace function public.dossie_caderno(p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  meu smallint;
  m   public.matches;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into m from public.matches where id = p_match;
  if not found then raise exception 'NO_MATCH'; end if;

  select mp.seat into meu from public.match_players mp
   where mp.match_id = p_match and mp.user_id = auth.uid();
  if meu is null then raise exception 'NOT_A_PLAYER'; end if;

  /* SÓ O QUE DÁ PARA PROVAR, e nada do que a máquina infere além disso.

     `dossie_deduz` devolve quatro campos: `fora` (não está no envelope),
     `naoTem` (quem não tem o quê), `abertos` (restrições ainda sem resposta) e
     `visto` (até onde ela leu). Os dois primeiros são FATO PÚBLICO — saem de
     linhas do registro que a mesa inteira viu acontecer — e são os que o bloco
     desenha.

     `abertos` fica de fora de propósito. Ele é o raciocínio EM CURSO da
     máquina, e mandá-lo para a tela seria entregar a conta feita a quem o PRD
     diz que deve fazer a conta. O bloco assistido risca o que é fato; quem
     fecha o caso é a pessoa. */
  return (
    select jsonb_build_object(
      'fora', coalesce(d -> 'fora', '[]'::jsonb),
      'naoTem', coalesce(d -> 'naoTem', '{}'::jsonb)
    )
    from public.dossie_deduz(p_match, meu) d
  );
end;
$$;

revoke all on function public.dossie_caderno(uuid) from public, anon, authenticated;
grant execute on function public.dossie_caderno(uuid) to authenticated, anon;
