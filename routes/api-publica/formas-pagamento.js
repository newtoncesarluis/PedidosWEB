/**
 * GET   /api/v1/formas-pagamento      — lista formas de pagamento
 * POST  /api/v1/formas-pagamento      — cria forma de pagamento
 * PATCH /api/v1/formas-pagamento/:id  — atualiza forma de pagamento
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

// ─── POST /formas-pagamento — cria forma de pagamento ────────────────────────
router.post('/', async (req, res) => {
  try {
    const pool = getPool();
    const { descricao, prazo_padrao } = req.body;

    if (!descricao) return res.status(400).json({ error: { code: 400, message: 'Campo obrigatório: descricao' } });

    // Evita duplicidade pelo nome
    const [[ex]] = await pool.query(
      `SELECT id FROM forma_pagto WHERE descricao = ? LIMIT 1`, [descricao]
    );
    if (ex) return res.status(409).json({ error: { code: 409, message: 'Já existe uma forma de pagamento com esta descrição', id: ex.id } });

    const [result] = await pool.query(
      `INSERT INTO forma_pagto (descricao, prazopadrao, ativo) VALUES (?, ?, 1)`,
      [descricao, prazo_padrao || null]
    );

    res.status(201).json({ data: { id: result.insertId, descricao, prazo_padrao: prazo_padrao || null, ativo: true } });
  } catch (err) {
    console.error('[api/v1/formas-pagamento] POST /', err.message);
    res.status(500).json({ error: { code: 500, message: 'Erro interno ao criar forma de pagamento' } });
  }
});

// ─── PATCH /formas-pagamento/:id — atualiza forma de pagamento ───────────────
router.patch('/:id', async (req, res) => {
  try {
    const pool = getPool();
    const id   = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: { code: 400, message: 'ID inválido' } });

    const CAMPOS_PERMITIDOS = {
      descricao:   'descricao',
      prazo_padrao:'prazopadrao',
      ativo:       'ativo',
    };

    const campos = {};
    for (const [campo, coluna] of Object.entries(CAMPOS_PERMITIDOS)) {
      if (req.body[campo] !== undefined) campos[coluna] = req.body[campo];
    }

    if (!Object.keys(campos).length) {
      return res.status(400).json({ error: { code: 400, message: 'Nenhum campo válido para atualizar' } });
    }

    const [[fp]] = await pool.query(`SELECT id FROM forma_pagto WHERE id = ? LIMIT 1`, [id]);
    if (!fp) return res.status(404).json({ error: { code: 404, message: 'Forma de pagamento não encontrada' } });

    const sets   = Object.keys(campos).map(k => `\`${k}\` = ?`).join(', ');
    const values = Object.values(campos);
    await pool.query(`UPDATE forma_pagto SET ${sets} WHERE id = ?`, [...values, id]);

    res.json({ data: { id, atualizado_em: new Date().toISOString() } });
  } catch (err) {
    console.error('[api/v1/formas-pagamento] PATCH /:id', err.message);
    res.status(500).json({ error: { code: 500, message: 'Erro interno ao atualizar forma de pagamento' } });
  }
});

module.exports = router;
