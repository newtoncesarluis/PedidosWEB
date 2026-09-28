'use strict';

const { hojeIsoBrasil } = require('./date-brasil');

function parsePrazoDias(prazoPadrao) {
  const s = String(prazoPadrao || '').trim();
  if (!s) return 0;
  const first = s.split('/')[0].trim();
  const n = parseInt(first, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function addDaysToIsoDate(isoDate, days) {
  const n = parseInt(days, 10) || 0;
  const base = String(isoDate || hojeIsoBrasil()).slice(0, 10);
  const p = base.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!p) return base;
  const dt = new Date(parseInt(p[1], 10), parseInt(p[2], 10) - 1, parseInt(p[3], 10));
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/** Parcela única à vista (vitrine/showroom sem condição detalhada). */
async function inserirParcelaUnicaReceber(conn, opts) {
  const {
    numero,
    pedidoId,
    total,
    dataAbertura,
    codFornecedor,
    nomeFornecedor,
    formaPagto = 'BOLETO',
    prazoPadrao = '0',
  } = opts;
  const valor = parseFloat(total) || 0;
  if (valor <= 0) return;
  const dataBase = dataAbertura || hojeIsoBrasil();
  const prazoDias = parsePrazoDias(prazoPadrao);
  const venc = addDaysToIsoDate(dataBase, prazoDias);
  const forma = String(formaPagto || 'BOLETO').toUpperCase().slice(0, 15);
  await conn.query(
    `INSERT INTO receber
      (numero, tipo, prazo, vencimento, valor, parcela, status, doc,
       qt_parcelas, tipo_lancamento, cod_fornecedor, nome_fornecedor,
       comissao, id_pedido, vlrreceber, forma_pagto, excluido)
     VALUES (?, 'VENDA', ?, ?, ?, 1, 'A RECEBER', ?, 1, '', ?, ?, 0, ?, ?, ?, 'N')`,
    [
      numero,
      prazoDias,
      venc,
      valor,
      'R' + numero + '1',
      codFornecedor || null,
      String(nomeFornecedor || '').toUpperCase(),
      pedidoId,
      valor,
      forma,
    ]
  ).catch((e) => {
    console.warn('[pedido-parcela-canal] receber:', e.message);
  });
}

module.exports = { inserirParcelaUnicaReceber, parsePrazoDias };
