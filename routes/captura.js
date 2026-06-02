const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');

const CREATE_CAPTURAS_SQL = `
  CREATE TABLE IF NOT EXISTS lead_capturas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL DEFAULT 1,
    id_usuario INT NOT NULL DEFAULT 0,
    id_vendedor INT NULL,
    token VARCHAR(64) NOT NULL UNIQUE,
    titulo VARCHAR(150) NOT NULL DEFAULT 'Fale Conosco',
    subtitulo VARCHAR(255) NOT NULL DEFAULT '',
    campos JSON NOT NULL,
    origem VARCHAR(60) NOT NULL DEFAULT 'Formulário Web',
    campanha VARCHAR(120) NOT NULL DEFAULT '',
    msg_sucesso VARCHAR(500) NOT NULL DEFAULT 'Obrigado! Entraremos em contato em breve.',
    ativo CHAR(1) NOT NULL DEFAULT 'S',
    total_leads INT NOT NULL DEFAULT 0,
    dtcadastro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    excluido CHAR(1) NOT NULL DEFAULT 'N',
    INDEX idx_cap_token (token),
    INDEX idx_cap_empresa (id_empresa)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

async function ensureCapturas() {
  const pool = getPool();
  try { await pool.query(CREATE_CAPTURAS_SQL); } catch (_) {}
}

// GET /api/captura/:token — retorna configuração pública do formulário
router.get('/:token', async (req, res) => {
  await ensureCapturas();
  try {
    const pool = getPool();
    const [[row]] = await pool.query(
      `SELECT titulo, subtitulo, campos, msg_sucesso
       FROM lead_capturas
       WHERE token=? AND ativo='S' AND excluido='N'
       LIMIT 1`,
      [req.params.token]
    );
    if (!row) return res.status(404).json({ error: 'Formulário não encontrado ou inativo' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/captura/:token — submissão pública do formulário
router.post('/:token', async (req, res) => {
  await ensureCapturas();
  try {
    const pool = getPool();
    const [[cfg]] = await pool.query(
      `SELECT id, id_empresa, id_vendedor, origem, campanha
       FROM lead_capturas
       WHERE token=? AND ativo='S' AND excluido='N'
       LIMIT 1`,
      [req.params.token]
    );
    if (!cfg) return res.status(404).json({ error: 'Formulário não encontrado' });

    const b = req.body;
    const nome = String(b.nome || '').trim().slice(0, 150);
    if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });

    const phone = String(b.telefone || b.whatsapp || '').trim().slice(0, 30);
    const email = String(b.email || '').trim().slice(0, 150);

    if (!phone && !email) {
      return res.status(400).json({ error: 'Informe telefone ou e-mail para contato' });
    }

    const [result] = await pool.query(
      `INSERT INTO leads (
         id_empresa, id_usuario, id_vendedor,
         nome, empresa, telefone, whatsapp, email, cidade, uf,
         interesse, observacoes, origem, campanha,
         status_funil, temperatura_lead, prioridade, canal_atendimento,
         motivo_perda, valor_estimado, tags
       ) VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?, ?,  ?, ?, ?, ?, 'NOVO', 'FRIO', 'MEDIA', 'COMERCIAL', '', 0, '')`,
      [
        cfg.id_empresa,
        cfg.id_vendedor || null,
        nome,
        String(b.empresa || '').trim().slice(0, 150),
        phone,
        phone,
        email,
        String(b.cidade || '').trim().slice(0, 100),
        String(b.uf || '').trim().toUpperCase().slice(0, 2),
        String(b.interesse || '').trim().slice(0, 150),
        String(b.mensagem || b.observacoes || '').trim(),
        cfg.origem || 'Formulário Web',
        cfg.campanha || '',
      ]
    );

    await pool.query(
      `INSERT INTO lead_historico (lead_id, id_usuario, tipo, descricao) VALUES (?, 0, 'CRIACAO', ?)`,
      [result.insertId, `Lead recebido via formulário web (token: ${req.params.token})`]
    );

    await pool.query(
      `UPDATE lead_capturas SET total_leads = total_leads + 1 WHERE id=?`,
      [cfg.id]
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, ensureCapturas };
