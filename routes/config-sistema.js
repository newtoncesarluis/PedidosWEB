const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURAÇÃO DO SISTEMA  (tabela: sistemas)
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/config/sistema — lê único registro da tabela sistemas
router.get('/sistema', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT * FROM sistemas ORDER BY id DESC LIMIT 1`
    );
    res.json(rows[0] || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/config/sistema — upsert (insert se vazio, update se já existir)
router.post('/sistema', async (req, res) => {
  try {
    const pool = getPool();
    const body = req.body;

    // Verifica se já existe algum registro
    const [existing] = await pool.query(
      `SELECT id FROM sistemas ORDER BY id DESC LIMIT 1`
    );

    if (existing[0]) {
      // Monta SET dinâmico com os campos enviados (exclui id)
      const campos = Object.keys(body).filter(k => k !== 'id');
      if (campos.length === 0) return res.status(400).json({ error: 'Nenhum campo para atualizar' });

      const setClause = campos.map(c => `\`${c}\`=?`).join(', ');
      const values    = campos.map(c => body[c] !== undefined ? body[c] : null);
      values.push(existing[0].id);

      await pool.query(
        `UPDATE sistemas SET ${setClause} WHERE id=?`,
        values
      );
      res.json({ ok: true, acao: 'update', id: existing[0].id });
    } else {
      // INSERT com os campos enviados
      const campos = Object.keys(body).filter(k => k !== 'id');
      if (campos.length === 0) return res.status(400).json({ error: 'Nenhum campo para inserir' });

      const colNames  = campos.map(c => `\`${c}\``).join(', ');
      const colPlaceholders = campos.map(() => '?').join(', ');
      const values    = campos.map(c => body[c] !== undefined ? body[c] : null);

      const [result] = await pool.query(
        `INSERT INTO sistemas (${colNames}) VALUES (${colPlaceholders})`,
        values
      );
      res.status(201).json({ ok: true, acao: 'insert', id: result.insertId });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURAÇÃO DE API / WHATSAPP  (tabela: configuracao)
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/config/api — lê campos relevantes da tabela configuracao
router.get('/api', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT w_apiglobal, w_urlplataforma, empresa_liberada, senha_acesso
       FROM configuracao
       WHERE excluido = 'N'
       ORDER BY id DESC LIMIT 1`
    );
    res.json(rows[0] || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/config/api — salva configuracao com validação de senha admin
router.post('/api', async (req, res) => {
  try {
    const pool = getPool();
    const { senha_admin, w_apiglobal, w_urlplataforma, empresa_liberada, senha_acesso } = req.body;

    // Valida senha administrativa
    if (senha_admin !== 'kzf010557f') {
      return res.status(401).json({ error: 'Senha administrativa inválida' });
    }

    // Garante que a tabela existe (compatibilidade)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS configuracao (
        id               INT(11)      NOT NULL AUTO_INCREMENT,
        w_apiglobal      VARCHAR(250) NULL DEFAULT NULL,
        w_urlplataforma  VARCHAR(250) NULL DEFAULT NULL,
        excluido         VARCHAR(1)   NULL DEFAULT 'N',
        empresa_liberada VARCHAR(50)  NULL DEFAULT NULL,
        senha_acesso     VARCHAR(100) NULL DEFAULT NULL,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
    `).catch(() => {});
    // Adiciona colunas que podem não existir em tabelas criadas anteriormente
    await pool.query(`ALTER TABLE configuracao ADD COLUMN IF NOT EXISTS empresa_liberada VARCHAR(50) NULL DEFAULT NULL`).catch(() => {});
    await pool.query(`ALTER TABLE configuracao ADD COLUMN IF NOT EXISTS senha_acesso VARCHAR(100) NULL DEFAULT NULL`).catch(() => {});

    // Upsert
    const [existing] = await pool.query(
      `SELECT id FROM configuracao WHERE excluido='N' ORDER BY id DESC LIMIT 1`
    );

    const url = w_urlplataforma ? w_urlplataforma.replace(/\/$/, '') : null;

    if (existing[0]) {
      await pool.query(
        `UPDATE configuracao
         SET w_apiglobal=?, w_urlplataforma=?, empresa_liberada=?, senha_acesso=?
         WHERE id=?`,
        [
          w_apiglobal || null,
          url,
          empresa_liberada || null,
          senha_acesso || null,
          existing[0].id
        ]
      );
      res.json({ ok: true, acao: 'update', id: existing[0].id });
    } else {
      const [result] = await pool.query(
        `INSERT INTO configuracao (w_apiglobal, w_urlplataforma, empresa_liberada, senha_acesso, excluido)
         VALUES (?, ?, ?, ?, 'N')`,
        [w_apiglobal || null, url, empresa_liberada || null, senha_acesso || null]
      );
      res.status(201).json({ ok: true, acao: 'insert', id: result.insertId });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
