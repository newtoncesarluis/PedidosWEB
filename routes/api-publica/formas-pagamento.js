/**
 * GET /api/v1/formas-pagamento   — formas de pagamento cadastradas
 */
const express = require('express');
const router  = express.Router();
const { getPool } = require('../../config/database');

router.get('/', async (req, res) => {
  try {
    const pool = getPool();

    const [rows] = await pool.query(
      `SELECT id, descricao, prazopadrao AS prazo_padrao, ativo
       FROM forma_pagto
       WHERE ativo = 1
       ORDER BY descricao ASC`
    );

    res.json({
      data: rows.map(r => ({
        id:          r.id,
        descricao:   r.descricao,
        prazo_padrao:r.prazo_padrao || null,
        ativo:       r.ativo === 1 || r.ativo === '1',
      })),
    });
  } catch (err) {
    console.error('[api/v1/formas-pagamento] GET /', err.message);
    res.status(500).json({ error: { code: 500, message: 'Erro interno ao buscar formas de pagamento' } });
  }
});

module.exports = router;
