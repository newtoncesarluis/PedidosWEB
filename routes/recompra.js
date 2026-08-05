'use strict';

/**
 * Carteira de Recompra (Gap 2 — Fase 1, só leitura).
 * Montada em server.js: app.use('/api/recompra', authMiddleware, require('./routes/recompra'))
 *
 * Endpoints:
 *   GET /api/recompra/carteira — clientes por semáforo (ciclo próprio de cada cliente)
 *   GET /api/recompra/kpis     — só o resumo (contadores + valor potencial)
 *
 * O drill-down de itens sugeridos por cliente REUSA o endpoint já existente e testado
 * GET /api/pedidos/produtos/reposicao?cod_cliente=  (não duplicar aqui).
 */

const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');
const { canPickOtherVendors, listVendedoresVisiveis } = require('../config/vendedor-visibilidade');
const { listarCarteiraRecompra } = require('../config/recompra-carteira');

function parseOpts(req) {
  return {
    idVendedor: req.query.id_vendedor,
    fornecedor: req.query.fornecedor || req.query.id_fornecedor,
    cidade: req.query.cidade,
    uf: req.query.uf,
    regiao: req.query.regiao,
    q: req.query.q,
    semaforo: req.query.semaforo,
    limit: req.query.limit,
  };
}

// GET /api/recompra/carteira
router.get('/carteira', async (req, res) => {
  try {
    const pool = getPool();
    const { data, resumo } = await listarCarteiraRecompra(pool, req, parseOpts(req));

    let vendedores = [];
    try {
      vendedores = await listVendedoresVisiveis(pool, req, { onlyPVender: true });
    } catch (_) { /* combo é opcional */ }

    res.json({
      data,
      resumo,
      vendedores,
      filtros: { canPickOthers: canPickOtherVendors(req) },
      total: data.length,
    });
  } catch (err) {
    console.error('[/recompra/carteira] ERRO:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/recompra/kpis
router.get('/kpis', async (req, res) => {
  try {
    const pool = getPool();
    const { resumo } = await listarCarteiraRecompra(pool, req, parseOpts(req));
    res.json({ resumo });
  } catch (err) {
    console.error('[/recompra/kpis] ERRO:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
