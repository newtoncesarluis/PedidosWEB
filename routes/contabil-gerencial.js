'use strict';

/**
 * Relatórios gerenciais por plano de contas / centro de custo.
 * Não é contabilidade formal (partida dobrada).
 */
const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');
const { ensureFinanceiroContabilCols } = require('../config/plano-contas-schema');

const SQL_EXCL_P = "(p.excluido = 'N' OR p.excluido IS NULL OR p.excluido = '')";
const SQL_LIQ_PAGAR = "(p.status IN ('LIQUIDADO','PAGO','BAIXADO','QUITADO'))";
const SQL_LIQ_REC = "(p.status IN ('LIQUIDADO','RECEBIDO','PAGO','BAIXADO','QUITADO'))";

router.get('/balancete', async (req, res) => {
  const pool = getPool();
  const dtIni = (req.query.dt_inicio || '').toString().slice(0, 10);
  const dtFim = (req.query.dt_fim || '').toString().slice(0, 10);
  const idCentro = parseInt(req.query.id_centrocusto, 10) || null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dtIni) || !/^\d{4}-\d{2}-\d{2}$/.test(dtFim)) {
    return res.status(400).json({ error: 'Informe dt_inicio e dt_fim (YYYY-MM-DD)' });
  }

  try {
    await ensureFinanceiroContabilCols(pool);

    const centroClausePagar = idCentro ? ' AND p.id_centrocusto = ?' : '';
    const centroClauseRec = idCentro ? ' AND p.id_centrocusto = ?' : '';
    const paramsPagar = idCentro ? [dtIni, dtFim, idCentro] : [dtIni, dtFim];
    const paramsRec = idCentro ? [dtIni, dtFim, idCentro] : [dtIni, dtFim];

    const [saidas] = await pool.query(`
      SELECT
        COALESCE(p.id_planoconta, d.id_planoconta) AS id_conta,
        SUM(COALESCE(p.vlrpago, p.valor, 0)) AS total
      FROM pagar p
      LEFT JOIN despesas d ON d.id = p.id_despesas
      WHERE ${SQL_EXCL_P}
        AND ${SQL_LIQ_PAGAR}
        AND DATE(COALESCE(p.data_pagto, p.vencimento)) BETWEEN ? AND ?
        ${centroClausePagar}
        AND COALESCE(p.id_planoconta, d.id_planoconta) IS NOT NULL
      GROUP BY COALESCE(p.id_planoconta, d.id_planoconta)
    `, paramsPagar);

    const [entradas] = await pool.query(`
      SELECT
        COALESCE(p.id_planoconta, n.id_planoconta) AS id_conta,
        SUM(COALESCE(p.valor_pago, p.valor, 0)) AS total
      FROM receber p
      LEFT JOIN natureza n ON n.id = p.id_receitas
      WHERE ${SQL_EXCL_P}
        AND ${SQL_LIQ_REC}
        AND DATE(COALESCE(p.data_pagto, p.vencimento)) BETWEEN ? AND ?
        ${centroClauseRec}
        AND COALESCE(p.id_planoconta, n.id_planoconta) IS NOT NULL
      GROUP BY COALESCE(p.id_planoconta, n.id_planoconta)
    `, paramsRec);

    const mapSaida = new Map(saidas.map((r) => [Number(r.id_conta), parseFloat(r.total) || 0]));
    const mapEntrada = new Map(entradas.map((r) => [Number(r.id_conta), parseFloat(r.total) || 0]));
    const ids = new Set([...mapSaida.keys(), ...mapEntrada.keys()]);

    const [contas] = await pool.query(`
      SELECT id, numero, descricao, grupo, tipo, nivel, id_pai
      FROM plano_contas
      WHERE (excluido='N' OR excluido IS NULL)
      ORDER BY COALESCE(numero,''), descricao
    `);

    const byId = new Map(contas.map((c) => [Number(c.id), c]));
    const accEnt = new Map();
    const accSai = new Map();

    // Soma nas analíticas e sobe o rollup para os pais (sintéticas)
    for (const id of ids) {
      let cur = id;
      const e = mapEntrada.get(id) || 0;
      const s = mapSaida.get(id) || 0;
      for (let depth = 0; depth < 20 && cur; depth++) {
        accEnt.set(cur, (accEnt.get(cur) || 0) + e);
        accSai.set(cur, (accSai.get(cur) || 0) + s);
        const c = byId.get(cur);
        if (!c?.id_pai) break;
        cur = Number(c.id_pai);
      }
    }

    const linhas = [];
    for (const c of contas) {
      const id = Number(c.id);
      const entradas = accEnt.get(id) || 0;
      const saidas = accSai.get(id) || 0;
      if (!entradas && !saidas) continue;
      linhas.push({
        id: c.id,
        numero: c.numero,
        descricao: c.descricao,
        grupo: c.grupo,
        tipo: c.tipo,
        nivel: c.nivel,
        id_pai: c.id_pai,
        entradas,
        saidas,
        saldo: entradas - saidas,
        sintetico: String(c.tipo || '').toUpperCase() === 'SINTETICA',
      });
    }

    linhas.sort((a, b) => String(a.numero || '').localeCompare(String(b.numero || ''), 'pt-BR'));

    // Totais só nas analíticas (evita contar 2x com o rollup dos pais)
    const totais = linhas.reduce(
      (acc, l) => {
        if (l.sintetico) return acc;
        acc.entradas += l.entradas;
        acc.saidas += l.saidas;
        acc.saldo += l.saldo;
        return acc;
      },
      { entradas: 0, saidas: 0, saldo: 0 }
    );

    const [semContaPagar] = await pool.query(`
      SELECT COALESCE(SUM(COALESCE(p.vlrpago, p.valor, 0)), 0) AS total, COUNT(*) AS qtd
      FROM pagar p
      LEFT JOIN despesas d ON d.id = p.id_despesas
      WHERE ${SQL_EXCL_P}
        AND ${SQL_LIQ_PAGAR}
        AND DATE(COALESCE(p.data_pagto, p.vencimento)) BETWEEN ? AND ?
        ${centroClausePagar}
        AND COALESCE(p.id_planoconta, d.id_planoconta) IS NULL
    `, paramsPagar);

    const [semContaRec] = await pool.query(`
      SELECT COALESCE(SUM(COALESCE(p.valor_pago, p.valor, 0)), 0) AS total, COUNT(*) AS qtd
      FROM receber p
      LEFT JOIN natureza n ON n.id = p.id_receitas
      WHERE ${SQL_EXCL_P}
        AND ${SQL_LIQ_REC}
        AND DATE(COALESCE(p.data_pagto, p.vencimento)) BETWEEN ? AND ?
        ${centroClauseRec}
        AND COALESCE(p.id_planoconta, n.id_planoconta) IS NULL
    `, paramsRec);

    res.json({
      periodo: { dt_inicio: dtIni, dt_fim: dtFim },
      linhas,
      totais,
      sem_conta: {
        pagar: { total: parseFloat(semContaPagar[0]?.total) || 0, qtd: parseInt(semContaPagar[0]?.qtd, 10) || 0 },
        receber: { total: parseFloat(semContaRec[0]?.total) || 0, qtd: parseInt(semContaRec[0]?.qtd, 10) || 0 },
      },
    });
  } catch (err) {
    console.error('[contabil/balancete]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Razão gerencial: extrato de uma conta (títulos liquidados no período).
 * Não altera dados — só leitura.
 */
router.get('/razao', async (req, res) => {
  const pool = getPool();
  const idConta = parseInt(req.query.id_planoconta, 10);
  const idCentro = parseInt(req.query.id_centrocusto, 10) || null;
  const dtIni = (req.query.dt_inicio || '').toString().slice(0, 10);
  const dtFim = (req.query.dt_fim || '').toString().slice(0, 10);

  if (!(idConta > 0)) return res.status(400).json({ error: 'Informe id_planoconta' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dtIni) || !/^\d{4}-\d{2}-\d{2}$/.test(dtFim)) {
    return res.status(400).json({ error: 'Informe dt_inicio e dt_fim (YYYY-MM-DD)' });
  }

  try {
    await ensureFinanceiroContabilCols(pool);

    const [[conta]] = await pool.query(
      `SELECT id, numero, descricao, tipo, grupo FROM plano_contas
       WHERE id=? AND (excluido='N' OR excluido IS NULL) LIMIT 1`,
      [idConta]
    );
    if (!conta) return res.status(404).json({ error: 'Conta não encontrada' });

    const centroClause = idCentro ? ' AND p.id_centrocusto = ?' : '';
    const paramsBase = idCentro ? [dtIni, dtFim, idConta, idCentro] : [dtIni, dtFim, idConta];

    const [saidas] = await pool.query(`
      SELECT
        'PAGAR' AS origem,
        p.id,
        p.vencimento,
        p.data_pagto,
        p.nome_fornecedor AS nome,
        p.doc,
        p.numero,
        COALESCE(p.vlrpago, p.valor, 0) AS valor,
        p.status
      FROM pagar p
      LEFT JOIN despesas d ON d.id = p.id_despesas
      WHERE ${SQL_EXCL_P}
        AND ${SQL_LIQ_PAGAR}
        AND DATE(COALESCE(p.data_pagto, p.vencimento)) BETWEEN ? AND ?
        AND COALESCE(p.id_planoconta, d.id_planoconta) = ?
        ${centroClause}
    `, paramsBase);

    const [entradas] = await pool.query(`
      SELECT
        'RECEBER' AS origem,
        p.id,
        p.vencimento,
        p.data_pagto,
        p.nome_fornecedor AS nome,
        p.doc,
        p.numero,
        COALESCE(p.valor_pago, p.valor, 0) AS valor,
        p.status
      FROM receber p
      LEFT JOIN natureza n ON n.id = p.id_receitas
      WHERE ${SQL_EXCL_P}
        AND ${SQL_LIQ_REC}
        AND DATE(COALESCE(p.data_pagto, p.vencimento)) BETWEEN ? AND ?
        AND COALESCE(p.id_planoconta, n.id_planoconta) = ?
        ${centroClause}
    `, paramsBase);

    const lancamentos = [...saidas, ...entradas]
      .map((r) => ({
        ...r,
        valor: parseFloat(r.valor) || 0,
        data_ref: r.data_pagto || r.vencimento,
      }))
      .sort((a, b) => String(a.data_ref || '').localeCompare(String(b.data_ref || '')));

    const totalEntradas = entradas.reduce((s, r) => s + (parseFloat(r.valor) || 0), 0);
    const totalSaidas = saidas.reduce((s, r) => s + (parseFloat(r.valor) || 0), 0);

    res.json({
      conta,
      periodo: { dt_inicio: dtIni, dt_fim: dtFim },
      lancamentos,
      totais: {
        entradas: totalEntradas,
        saidas: totalSaidas,
        saldo: totalEntradas - totalSaidas,
        qtd: lancamentos.length,
      },
    });
  } catch (err) {
    console.error('[contabil/razao]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
