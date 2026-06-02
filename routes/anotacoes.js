const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');

const INIT = `
  CREATE TABLE IF NOT EXISTS anotacoes (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa    INT          NOT NULL DEFAULT 1,
    id_usuario    INT          NOT NULL DEFAULT 0,
    titulo        VARCHAR(200) NOT NULL DEFAULT '',
    conteudo      TEXT,
    cor           VARCHAR(20)  NOT NULL DEFAULT 'default',
    fixado        TINYINT(1)   NOT NULL DEFAULT 0,
    dtcriacao     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    dtatualizacao DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    excluido      CHAR(1)      NOT NULL DEFAULT 'N',
    INDEX idx_empresa (id_empresa),
    INDEX idx_usuario (id_usuario)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

async function ensureTable() {
  try { await getPool().query(INIT); } catch (_) {}
}

// GET /api/anotacoes
router.get('/', async (req, res) => {
  await ensureTable();
  try {
    const pool = getPool();
    const user = req.user || {};
    const id_empresa = parseInt(user.id_empresa || req.query.id_empresa || 1);
    const id_usuario = parseInt(user.id || 0);
    const { q, page = 1, limit = 100 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const conds = ["excluido='N'", 'id_empresa=?'];
    const params = [id_empresa];

    // vendedor/rep vê só as próprias; admin vê todas
    if (user.perfil !== '1' && user.role !== 'admin') {
      conds.push('id_usuario=?');
      params.push(id_usuario);
    }

    if (q) { conds.push('(titulo LIKE ? OR conteudo LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }

    const where = conds.join(' AND ');
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM anotacoes WHERE ${where}`, params);
    const [rows] = await pool.query(
      `SELECT * FROM anotacoes WHERE ${where} ORDER BY fixado DESC, dtatualizacao DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );
    res.json({ anotacoes: rows, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/anotacoes
router.post('/', async (req, res) => {
  await ensureTable();
  try {
    const pool = getPool();
    const user = req.user || {};
    const { titulo, conteudo, cor = 'default', fixado = 0 } = req.body;
    if (!titulo?.trim()) return res.status(400).json({ error: 'Título obrigatório.' });
    const [result] = await pool.query(
      `INSERT INTO anotacoes (id_empresa, id_usuario, titulo, conteudo, cor, fixado) VALUES (?,?,?,?,?,?)`,
      [parseInt(user.id_empresa || 1), parseInt(user.id || 0), titulo.trim(), conteudo || '', cor, fixado ? 1 : 0]
    );
    const [[row]] = await pool.query('SELECT * FROM anotacoes WHERE id=?', [result.insertId]);
    res.json({ ok: true, anotacao: row });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/anotacoes/:id
router.put('/:id', async (req, res) => {
  try {
    const pool = getPool();
    const { titulo, conteudo, cor, fixado } = req.body;
    const sets = [], params = [];
    if (titulo !== undefined) { sets.push('titulo=?'); params.push(titulo.trim()); }
    if (conteudo !== undefined) { sets.push('conteudo=?'); params.push(conteudo); }
    if (cor !== undefined) { sets.push('cor=?'); params.push(cor); }
    if (fixado !== undefined) { sets.push('fixado=?'); params.push(fixado ? 1 : 0); }
    if (!sets.length) return res.json({ ok: true });
    params.push(req.params.id);
    await pool.query(`UPDATE anotacoes SET ${sets.join(',')} WHERE id=?`, params);
    const [[row]] = await pool.query('SELECT * FROM anotacoes WHERE id=?', [req.params.id]);
    res.json({ ok: true, anotacao: row });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/anotacoes/:id
router.delete('/:id', async (req, res) => {
  try {
    await getPool().query(`UPDATE anotacoes SET excluido='S' WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
