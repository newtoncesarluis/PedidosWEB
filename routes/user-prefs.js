const express = require('express');
const router  = express.Router();
const { getPool } = require('../config/database');

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS usuario_preferencias (
    idusuario   INT          NOT NULL,
    font_family VARCHAR(32)  NOT NULL DEFAULT 'inter',
    font_size   VARCHAR(16)  NOT NULL DEFAULT 'md',
    accent      VARCHAR(32)  NOT NULL DEFAULT 'blue',
    compact     TINYINT(1)   NOT NULL DEFAULT 0,
    tema        VARCHAR(64)  NOT NULL DEFAULT 'default',
    updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (idusuario)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3
`;

// GET /api/user-prefs  — retorna as preferências do usuário logado
router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(CREATE_TABLE).catch(() => {});
    const [rows] = await pool.query(
      'SELECT font_family, font_size, accent, compact, tema FROM usuario_preferencias WHERE idusuario = ?',
      [req.user.id]
    );
    res.json(rows[0] || {});
  } catch (err) {
    res.json({});
  }
});

// PUT /api/user-prefs  — grava/atualiza as preferências
router.put('/', async (req, res) => {
  try {
    const { font_family, font_size, accent, compact, tema } = req.body;
    const pool = getPool();
    await pool.query(CREATE_TABLE).catch(() => {});
    await pool.query(
      `INSERT INTO usuario_preferencias (idusuario, font_family, font_size, accent, compact, tema)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         font_family = VALUES(font_family),
         font_size   = VALUES(font_size),
         accent      = VALUES(accent),
         compact     = VALUES(compact),
         tema        = VALUES(tema),
         updated_at  = NOW()`,
      [req.user.id, font_family || 'inter', font_size || 'md', accent || 'blue', compact ? 1 : 0, tema || 'default']
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false });
  }
});

// ── MODELO DE IMPRESSÃO DE PEDIDO (por usuário) ───────────────────────────────
const CREATE_MODELO = `
  CREATE TABLE IF NOT EXISTS config_impressao_pedido (
    idusuario  INT  NOT NULL,
    config     TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (idusuario)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

// GET /api/user-prefs/modelo-impressao
router.get('/modelo-impressao', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(CREATE_MODELO).catch(() => {});
    const [rows] = await pool.query(
      'SELECT config FROM config_impressao_pedido WHERE idusuario = ?',
      [req.user.id]
    );
    if (!rows.length) return res.json({});
    try { res.json(JSON.parse(rows[0].config)); }
    catch (_) { res.json({}); }
  } catch (_) {
    res.json({});
  }
});

// PUT /api/user-prefs/modelo-impressao
router.put('/modelo-impressao', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(CREATE_MODELO).catch(() => {});
    await pool.query(
      `INSERT INTO config_impressao_pedido (idusuario, config)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE config = VALUES(config), updated_at = NOW()`,
      [req.user.id, JSON.stringify(req.body)]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
