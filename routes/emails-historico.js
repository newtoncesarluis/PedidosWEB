'use strict';

/**
 * Histórico de e-mails enviados (cliente_mensagens canal EMAIL).
 * Não é webmail/IMAP — apenas consulta do que o sistema já enviou.
 */
const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');
const { ensureClienteMensagensTable } = require('../config/cliente-mensagens');

router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    await ensureClienteMensagensTable(pool);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const q = String(req.query.q || '').trim();

    let where = `m.canal = 'EMAIL'`;
    const vals = [];
    if (q) {
      where += ` AND (
        LOWER(COALESCE(m.destino,'')) LIKE ? OR
        LOWER(COALESCE(m.mensagem,'')) LIKE ? OR
        LOWER(COALESCE(c.nome,'')) LIKE ? OR
        LOWER(COALESCE(c.apelido,'')) LIKE ?
      )`;
      const like = `%${q.toLowerCase()}%`;
      vals.push(like, like, like, like);
    }
    if (req.query.cod_cliente) {
      where += ` AND m.cod_cliente=?`;
      vals.push(parseInt(req.query.cod_cliente, 10));
    }

    const [rows] = await pool.query(
      `SELECT m.id, m.cod_cliente, m.id_pedido, m.id_usuario, m.destino, m.mensagem,
              m.anexo, m.status, m.erro, m.data_envio, m.provedor,
              COALESCE(NULLIF(TRIM(c.nome), ''), NULLIF(TRIM(c.apelido), ''), '') AS cliente_nome
         FROM cliente_mensagens m
         LEFT JOIN clientes c ON c.id = m.cod_cliente
        WHERE ${where}
        ORDER BY m.data_envio DESC
        LIMIT ? OFFSET ?`,
      [...vals, limit, offset]
    );

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total
         FROM cliente_mensagens m
         LEFT JOIN clientes c ON c.id = m.cod_cliente
        WHERE ${where}`,
      vals
    );

    res.json({
      emails: rows,
      total,
      info: 'O SysRepWeb envia e-mails via SMTP (pedido PDF, avisos). Não há inbox/IMAP — mensagens recebidas ficam no seu provedor de e-mail.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
