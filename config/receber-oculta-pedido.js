'use strict';
/**
 * Opção "Não exibir parcelas de pedido no Contas a Receber" (sistemas.ocultar_receber_pedido = 'S').
 * As parcelas continuam sendo gravadas em `receber` (comissão, conciliação e BI dependem delas);
 * apenas as telas/KPIs de Contas a Receber passam a ignorar títulos gerados por pedido
 * (tipo='VENDA' com id_pedido preenchido). Título lançado manualmente continua aparecendo.
 */
const _cache = new Map(); // DATABASE() -> { v, t }
const TTL_MS = 15000;

async function ocultarReceberPedidoAtivo(pool) {
  let db = '';
  try { const [[r]] = await pool.query('SELECT DATABASE() AS db'); db = r?.db || ''; } catch (_) {}
  const hit = _cache.get(db);
  if (hit && Date.now() - hit.t < TTL_MS) return hit.v;
  let v = false;
  try {
    const [rows] = await pool.query(`SELECT ocultar_receber_pedido AS v FROM sistemas ORDER BY id DESC LIMIT 1`);
    v = String(rows[0]?.v || 'N').toUpperCase() === 'S';
  } catch (_) { v = false; } // coluna ainda não existe = desligado
  _cache.set(db, { v, t: Date.now() });
  return v;
}

function invalidateOcultarReceberPedido() { _cache.clear(); }

/** Fragmento SQL (começa com AND). alias opcional: 'p' ou ''. */
function sqlSemParcelasPedido(ativo, alias = '') {
  if (!ativo) return '';
  const a = alias ? alias + '.' : '';
  return ` AND NOT (${a}id_pedido IS NOT NULL AND ${a}id_pedido <> '' AND ${a}id_pedido <> '0')`;
}

module.exports = { ocultarReceberPedidoAtivo, invalidateOcultarReceberPedido, sqlSemParcelasPedido };
