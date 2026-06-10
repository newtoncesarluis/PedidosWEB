const { EventEmitter } = require('events');

const pedidoEmitter = new EventEmitter();
pedidoEmitter.setMaxListeners(200);

/**
 * Emite evento de novo pedido para todos os clientes SSE conectados.
 * @param {object} info - { numero, tipo_pedido, nome_cliente, nome_fornecedor, origem, vlrtotalpedido }
 */
function emitNovoPedido(info) {
  pedidoEmitter.emit('novo-pedido', info);
}

module.exports = { pedidoEmitter, emitNovoPedido };
