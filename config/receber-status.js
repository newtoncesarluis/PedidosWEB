'use strict';

/**
 * Status de títulos em `receber`.
 * Delphi legado usa "A RECEBER"; a web grava "ABERTA" / "RECEBIDO".
 * Aberto = tudo que NÃO está liquidado (inclui "A RECEBER", ABERTA, NULL, etc.).
 */

const STATUS_LIQUIDADO = [
  'LIQUIDADO',
  'RECEBIDO',
  'RECEBIDA',
  'PAGO',
  'BAIXADO',
  'QUITADO',
];

const _liqIn = STATUS_LIQUIDADO.map((s) => `'${s}'`).join(',');

function sqlLiquidado(alias = 'p') {
  const col = alias ? `${alias}.status` : 'status';
  return `(${col} IN (${_liqIn}))`;
}

function sqlAberto(alias = 'p') {
  const col = alias ? `${alias}.status` : 'status';
  return `(${col} IS NULL OR TRIM(COALESCE(${col},'')) = '' OR ${col} NOT IN (${_liqIn}))`;
}

function sqlStatusDisplay(alias = 'p') {
  const venc = alias ? `${alias}.vencimento` : 'vencimento';
  return `CASE
    WHEN ${sqlLiquidado(alias)} THEN 'LIQUIDADO'
    WHEN (${sqlAberto(alias)}) AND ${venc} < CURDATE() THEN 'EM ATRASO'
    ELSE 'ABERTA'
  END`;
}

/** forma_pagto em bases Delphi costuma ser VARCHAR(15). */
function truncFormaPagto(v, max = 15) {
  const s = String(v == null ? '' : v).trim().toUpperCase();
  if (!s) return 'DINHEIRO';
  return s.length > max ? s.slice(0, max) : s;
}

module.exports = {
  STATUS_LIQUIDADO,
  sqlLiquidado,
  sqlAberto,
  sqlStatusDisplay,
  truncFormaPagto,
};
