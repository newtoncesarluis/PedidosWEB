const express = require('express');
const router  = express.Router();
const { getPool } = require('../config/database');

// ─── GET /api/familia-produtos ───────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    const { q = '', status = 'A', limit = 100, offset = 0 } = req.query;

    let where = [`(f.excluido = 'N' OR f.excluido IS NULL OR f.excluido = '')`];
    const vals = [];

    if (status === 'A')      where.push(`(f.status = 'A' OR f.status IS NULL OR f.status = '')`);
    else if (status === 'I') where.push(`f.status = 'N'`);

    if (q.trim()) {
      where.push(`LOWER(f.nome) LIKE ?`);
      vals.push(`%${q.trim().toLowerCase()}%`);
    }

    const wc = where.join(' AND ');
    const [rows] = await pool.query(
      `SELECT f.id, f.nome, f.status, f.informar_nota
       FROM familia_produtos f WHERE ${wc} ORDER BY f.nome LIMIT ? OFFSET ?`,
      [...vals, parseInt(limit), parseInt(offset)]
    );
    const [[tot]] = await pool.query(
      `SELECT COUNT(*) AS total FROM familia_produtos f WHERE ${wc}`, vals
    );
    res.json({ familias: rows, total: tot.total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/familia-produtos/notificacoes ──────────────────────────────────
router.get('/notificacoes', async (req, res) => {
  try {
    const pool = getPool();
    const [[ativos]]   = await pool.query(`SELECT COUNT(*) AS n FROM familia_produtos WHERE (status='A' OR status IS NULL OR status='') AND (excluido='N' OR excluido IS NULL OR excluido='')`);
    const [[inativos]] = await pool.query(`SELECT COUNT(*) AS n FROM familia_produtos WHERE status='N' AND (excluido='N' OR excluido IS NULL OR excluido='')`);
    res.json({ ativos: ativos.n, inativos: inativos.n });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/familia-produtos/:id ──────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT * FROM familia_produtos WHERE id = ? AND (excluido='N' OR excluido IS NULL OR excluido='')`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Família não encontrada' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/familia-produtos ──────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const pool = getPool();
    const { nome, informar_nota = 'N' } = req.body;
    if (!nome?.trim()) return res.status(400).json({ error: 'Nome é obrigatório' });
    const [result] = await pool.query(
      `INSERT INTO familia_produtos (nome, status, informar_nota, excluido) VALUES (?, 'A', ?, 'N')`,
      [nome.toUpperCase().trim(), informar_nota || 'N']
    );
    res.json({ id: result.insertId, ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/familia-produtos/:id ──────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const pool = getPool();
    const { nome, status, informar_nota } = req.body;
    if (!nome?.trim()) return res.status(400).json({ error: 'Nome é obrigatório' });
    await pool.query(
      `UPDATE familia_produtos SET nome=?, status=?, informar_nota=? WHERE id=?`,
      [nome.toUpperCase().trim(), status || 'A', informar_nota || 'N', req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/familia-produtos/:id/ativar ────────────────────────────────────
router.put('/:id/ativar', async (req, res) => {
  try {
    await getPool().query(`UPDATE familia_produtos SET status='A' WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/familia-produtos/:id/inativar ──────────────────────────────────
router.put('/:id/inativar', async (req, res) => {
  try {
    await getPool().query(`UPDATE familia_produtos SET status='N' WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/familia-produtos/:id ───────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const pool = getPool();
    // Bloqueia se houver produtos vinculados
    const [[uso]] = await pool.query(
      `SELECT COUNT(*) AS n FROM produto WHERE id_familiaproduto = ? AND (excluido='N' OR excluido IS NULL OR excluido='')`,
      [req.params.id]
    ).catch(() => [[{ n: 0 }]]);

    if (uso.n > 0) {
      return res.status(409).json({
        error: `Esta família possui ${uso.n} produto(s) vinculado(s) e não pode ser excluída.`
      });
    }
    await pool.query(`UPDATE familia_produtos SET excluido='S' WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
