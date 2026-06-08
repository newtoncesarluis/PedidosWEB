const express = require('express');
const router  = express.Router();
const { getPool } = require('../config/database');
const { permCrud, negarCad } = require('../config/cadastros-permissoes');

const _permCores = (req) => permCrud(req, {
  incluir: 'incluir_cores',
  alterar: 'alterar_cores',
  excluir: 'excluir_cores',
});

// ─── Cache de colunas reais da tabela cores ───────────────────────────────────
let _cols = null;
async function getColunas(pool) {
  if (_cols) return _cols;
  const [rows] = await pool.query('DESCRIBE cores').catch(() => [[]]);
  _cols = new Set(rows.map(r => r.Field));
  return _cols;
}

// ─── GET /api/cores ──────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    const cols = await getColunas(pool);
    const { q = '', status = 'A', limit = 100, offset = 0 } = req.query;

    let where = [`(c.excluido = 'N' OR c.excluido IS NULL OR c.excluido = '')`];
    const vals = [];

    if (cols.has('status')) {
      if (status === 'A')      where.push(`(c.status = 'A' OR c.status IS NULL OR c.status = '')`);
      else if (status === 'I') where.push(`c.status = 'F'`);
    }

    if (q.trim()) {
      where.push(`LOWER(c.descricao) LIKE ?`);
      vals.push(`%${q.trim().toLowerCase()}%`);
    }

    const wc = where.join(' AND ');
    const [rows] = await pool.query(
      `SELECT c.id, c.descricao ${cols.has('status') ? ', c.status' : ''}
       FROM cores c WHERE ${wc} ORDER BY c.descricao LIMIT ? OFFSET ?`,
      [...vals, parseInt(limit), parseInt(offset)]
    );
    const [[tot]] = await pool.query(
      `SELECT COUNT(*) AS total FROM cores c WHERE ${wc}`, vals
    );
    res.json({ cores: rows, total: tot.total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/cores/notificacoes ─────────────────────────────────────────────
router.get('/notificacoes', async (req, res) => {
  try {
    const pool = getPool();
    const cols = await getColunas(pool);
    let ativos = 0, inativos = 0;

    if (cols.has('status')) {
      const [[a]] = await pool.query(
        `SELECT COUNT(*) AS n FROM cores WHERE (status='A' OR status IS NULL OR status='') AND (excluido='N' OR excluido IS NULL OR excluido='')`
      );
      const [[i]] = await pool.query(
        `SELECT COUNT(*) AS n FROM cores WHERE status='F' AND (excluido='N' OR excluido IS NULL OR excluido='')`
      );
      ativos   = a.n;
      inativos = i.n;
    } else {
      const [[tot]] = await pool.query(
        `SELECT COUNT(*) AS n FROM cores WHERE (excluido='N' OR excluido IS NULL OR excluido='')`
      );
      ativos = tot.n;
    }
    res.json({ ativos, inativos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/cores/:id ──────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT * FROM cores WHERE id = ? AND (excluido='N' OR excluido IS NULL OR excluido='')`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Cor não encontrada' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/cores ─────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const pc = _permCores(req);
    if (pc.incluir !== 'S') return negarCad(res, 'Sem permissão para incluir cores');
    const pool = getPool();
    const cols = await getColunas(pool);
    const { descricao } = req.body;
    if (!descricao?.trim()) return res.status(400).json({ error: 'Descrição é obrigatória' });

    let sql, params;
    if (cols.has('status')) {
      sql    = `INSERT INTO cores (descricao, status, excluido) VALUES (?, 'A', 'N')`;
      params = [descricao.toUpperCase().trim()];
    } else {
      sql    = `INSERT INTO cores (descricao, excluido) VALUES (?, 'N')`;
      params = [descricao.toUpperCase().trim()];
    }
    const [result] = await pool.query(sql, params);
    res.json({ id: result.insertId, ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/cores/:id ──────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const pc = _permCores(req);
    if (pc.alterar !== 'S') return negarCad(res, 'Sem permissão para alterar cores');
    const pool = getPool();
    const cols = await getColunas(pool);
    const { descricao, status } = req.body;
    if (!descricao?.trim()) return res.status(400).json({ error: 'Descrição é obrigatória' });

    let sql, params;
    if (cols.has('status')) {
      const dbStatus = status === 'I' ? 'F' : 'A';
      sql    = `UPDATE cores SET descricao=?, status=? WHERE id=?`;
      params = [descricao.toUpperCase().trim(), dbStatus, req.params.id];
    } else {
      sql    = `UPDATE cores SET descricao=? WHERE id=?`;
      params = [descricao.toUpperCase().trim(), req.params.id];
    }
    await pool.query(sql, params);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/cores/:id/ativar ───────────────────────────────────────────────
router.put('/:id/ativar', async (req, res) => {
  try {
    const pc = _permCores(req);
    if (pc.alterar !== 'S') return negarCad(res, 'Sem permissão para alterar cores');
    const pool = getPool();
    const cols = await getColunas(pool);
    if (cols.has('status')) {
      await pool.query(`UPDATE cores SET status='A' WHERE id=?`, [req.params.id]);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/cores/:id/inativar ─────────────────────────────────────────────
router.put('/:id/inativar', async (req, res) => {
  try {
    const pc = _permCores(req);
    if (pc.alterar !== 'S') return negarCad(res, 'Sem permissão para alterar cores');
    const pool = getPool();
    const cols = await getColunas(pool);
    if (cols.has('status')) {
      await pool.query(`UPDATE cores SET status='F' WHERE id=?`, [req.params.id]);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/cores/:id ───────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const pc = _permCores(req);
    if (pc.excluir !== 'S') return negarCad(res, 'Sem permissão para excluir cores');
    const pool = getPool();
    const [[uso]] = await pool.query(
      `SELECT COUNT(*) AS n FROM dependentes WHERE id_cor = ?`,
      [req.params.id]
    ).catch(() => [[{ n: 0 }]]);

    if (uso.n > 0) {
      return res.status(409).json({ error: `Esta cor está em uso e não pode ser excluída.` });
    }
    await pool.query(`UPDATE cores SET excluido='S' WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
