'use strict';
const express = require('express');
const router  = express.Router();
const { getPool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

// Garante que a tabela existe (migration já cuida, mas como fallback)
async function ensureTable(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS sistema_changelog (
    id INT AUTO_INCREMENT PRIMARY KEY,
    versao VARCHAR(20) NOT NULL,
    tipo ENUM('MELHORIA','BUG','NOVO') NOT NULL DEFAULT 'MELHORIA',
    titulo VARCHAR(200) NOT NULL,
    descricao TEXT NULL,
    data_lancamento DATE NOT NULL,
    ativo CHAR(1) NOT NULL DEFAULT 'S',
    dtcadastro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_chg_versao (versao),
    INDEX idx_chg_data (data_lancamento)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).catch(() => {});
}

// ── GET /api/changelog  (público — lido no login/home) ────────────────────────
// ?desde=YYYY-MM-DD  filtra entradas a partir de uma data
router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    await ensureTable(pool);
    const { desde } = req.query;
    let sql  = `SELECT id, versao, tipo, titulo, descricao, data_lancamento
                FROM sistema_changelog
                WHERE ativo = 'S'`;
    const params = [];
    if (desde) { sql += ` AND data_lancamento > ?`; params.push(desde); }
    sql += ` ORDER BY data_lancamento DESC, id DESC LIMIT 50`;
    const [rows] = await pool.query(sql, params);
    res.json({ itens: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Rotas admin (requerem autenticação + perfil admin) ────────────────────────
router.use(authMiddleware);

function isAdmin(req, res) {
  if (req.user?.perfil != 1) { res.status(403).json({ error: 'Acesso restrito ao administrador' }); return false; }
  return true;
}

// GET /api/changelog/admin  — lista todos (inclusive inativos)
router.get('/admin', async (req, res) => {
  if (!isAdmin(req, res)) return;
  try {
    const pool = getPool();
    await ensureTable(pool);
    const [rows] = await pool.query(
      `SELECT * FROM sistema_changelog ORDER BY data_lancamento DESC, id DESC`
    );
    res.json({ itens: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/changelog  — cria entrada
router.post('/', async (req, res) => {
  if (!isAdmin(req, res)) return;
  try {
    const pool = getPool();
    await ensureTable(pool);
    const { versao, tipo, titulo, descricao, data_lancamento } = req.body;
    if (!versao?.trim() || !titulo?.trim() || !data_lancamento) {
      return res.status(400).json({ error: 'versao, titulo e data_lancamento são obrigatórios' });
    }
    const tipoVal = ['MELHORIA','BUG','NOVO'].includes(tipo) ? tipo : 'MELHORIA';
    const [r] = await pool.query(
      `INSERT INTO sistema_changelog (versao, tipo, titulo, descricao, data_lancamento)
       VALUES (?, ?, ?, ?, ?)`,
      [versao.trim(), tipoVal, titulo.trim(), descricao?.trim() || null, data_lancamento]
    );
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/changelog/:id  — edita
router.put('/:id', async (req, res) => {
  if (!isAdmin(req, res)) return;
  try {
    const pool = getPool();
    const { versao, tipo, titulo, descricao, data_lancamento, ativo } = req.body;
    const tipoVal = ['MELHORIA','BUG','NOVO'].includes(tipo) ? tipo : 'MELHORIA';
    await pool.query(
      `UPDATE sistema_changelog SET versao=?, tipo=?, titulo=?, descricao=?, data_lancamento=?, ativo=? WHERE id=?`,
      [versao?.trim(), tipoVal, titulo?.trim(), descricao?.trim() || null, data_lancamento, ativo || 'S', req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/changelog/:id  — soft delete (ativo='N')
router.delete('/:id', async (req, res) => {
  if (!isAdmin(req, res)) return;
  try {
    const pool = getPool();
    await pool.query(`UPDATE sistema_changelog SET ativo='N' WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
