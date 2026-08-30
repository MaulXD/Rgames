/**
 * `fetch` com UMA segunda chance, e só para falha de REDE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUE ISTO EXISTE
 *
 * As cinco suítes fazem, juntas, alguns milhares de chamadas HTTP contra um
 * servidor do outro lado do país, e rodam por vinte minutos. Um
 * `UND_ERR_CONNECT_TIMEOUT` em qualquer uma delas derrubava a suíte inteira com
 * um `TypeError: fetch failed` — sem dizer qual teste estava rodando, sem
 * distinguir "a internet piscou" de "o código quebrou".
 *
 * Aconteceu duas vezes numa tarde. Na primeira, no meio da partida solo do
 * Dossiê, e o remédio ficou só lá. Na segunda derrubou a plataforma e o
 * Letreiro na mesma passada da verificação, o que respondeu de onde o remédio
 * devia morar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SÓ PARA A CONEXÃO QUE NÃO SE ESTABELECEU
 *
 * Código de status é RESPOSTA. Um 403 é o servidor dizendo não, e repetir um
 * não transforma um teste de autorização num teste de paciência — a suíte tem
 * dezenas de testes cuja aprovação É o erro. Por isso a repetição está no
 * `catch`, e não numa checagem de `r.status`.
 *
 * Uma segunda chance, e só uma. Se a rede caiu de verdade, insistir só adia a
 * notícia; o que se quer é atravessar a piscada.
 *
 * É a mesma forma que o `pg.Pool` das suítes já usa para a conexão direta, pelo
 * mesmo motivo — este era o outro caminho, e ele estava descoberto.
 */

/** Erros que valem uma segunda tentativa: a conexão, e não a resposta. */
const PISCADA = /UND_ERR|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed/i;

export async function tenta(url, opts) {
  try {
    return await fetch(url, opts);
  } catch (e) {
    /* `AggregateError` de conexão chega com a mensagem VAZIA e a informação
       toda nos `errors` de dentro — foi o que já enganou o retry do `pg.Pool`.
       Olhar `cause` e `code` junto com a mensagem cobre as três formas. */
    const texto = [e?.message, e?.code, e?.cause?.code, e?.cause?.message]
      .filter(Boolean)
      .join(" ");
    if (!PISCADA.test(texto)) throw e;
    await new Promise((r) => setTimeout(r, 800));
    return await fetch(url, opts);
  }
}
