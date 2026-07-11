'use strict';

/**
 * Trava anti-duplicação do número do pedido.
 *
 * O número é gerado por `MAX(numero)+1`, que é uma leitura de snapshot sem lock:
 * dois saves concorrentes leem o mesmo MAX e nasce mais de um pedido com o MESMO
 * número. Como `itensped` é chaveado por `numpedido` (a string do número), pedidos
 * com número repetido embaralham/zeram itens — daí os relatos de "duplicou e não
 * salvou os itens".
 *
 * A trava serializa a geração entre requisições concorrentes do MESMO tenant, via
 * GET_LOCK nomeado por `DATABASE()`. Todos os caminhos que inserem em `pedidos`
 * (tela de pedidos, vitrine, promoções-share, feirinha-share) usam o MESMO nome de
 * lock, então serializam entre si — sem afetar outros clientes (bancos distintos).
 *
 * Uso: acquire logo após `beginTransaction`; release no `finally`, DEPOIS do commit
 * (para o próximo a esperar já enxergar o número recém-gravado).
 */

function _lockName(dbRow) {
  return 'pednum_' + ((dbRow && dbRow.db) || 'default');
}

/** Adquire a trava na conexão informada. Retorna o nome do lock (ou null se falhar). */
async function acquireNumeroPedidoLock(conn) {
  try {
    const [[dbRow]] = await conn.query('SELECT DATABASE() AS db');
    const name = _lockName(dbRow);
    await conn.query('SELECT GET_LOCK(?, 10) AS l', [name]);
    return name;
  } catch (_) {
    return null;
  }
}

/** Libera a trava (no-op se name for null). Nunca lança. */
async function releaseNumeroPedidoLock(conn, name) {
  if (!name) return;
  try { await conn.query('SELECT RELEASE_LOCK(?)', [name]); } catch (_) {}
}

module.exports = { acquireNumeroPedidoLock, releaseNumeroPedidoLock };
