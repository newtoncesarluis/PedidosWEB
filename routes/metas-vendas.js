'use strict';
const express = require('express');
const router  = express.Router();
const { getPool } = require('../config/database');
const { hojeIsoBrasil } = require('../config/date-brasil');

function mesBrasil() {
  const [ano, mes] = hojeIsoBrasil().split('-');
  return { mes: parseInt(mes, 10), ano: parseInt(ano, 10) };
}

const PEDIDOS_SUM = `SUM(COALESCE(vlrtotalpedido, vlrtotalbruto, 0))`;
const PEDIDOS_WHERE = `COALESCE(excluido,'N') = 'N' AND situacao_pedido NOT IN ('CANCELADO')`;

// ── GET /api/metas-vendas?mes=&ano= ──────────────────────────────────────────
// Metas gerais por indústria
router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    const hoje = mesBrasil();
    const mes = parseInt(req.query.mes) || hoje.mes;
    const ano = parseInt(req.query.ano) || hoje.ano;

    const [rows] = await pool.query(`
      SELECT
        f.id                          AS id_fornecedor,
        f.nome                        AS nome_fornecedor,
        COALESCE(m.valor_meta, 0)     AS valor_meta,
        COALESCE(r.realizado, 0)      AS realizado
      FROM fornecedores f
      LEFT JOIN meta_vendas_fornecedor m
             ON m.id_fornecedor = f.id AND m.mes = ? AND m.ano = ?
      LEFT JOIN (
        SELECT cod_fornecedor, ${PEDIDOS_SUM} AS realizado
        FROM pedidos
        WHERE ${PEDIDOS_WHERE} AND MONTH(data_abertura) = ? AND YEAR(data_abertura) = ?
        GROUP BY cod_fornecedor
      ) r ON r.cod_fornecedor = f.id
      WHERE f.excluido = 'N' AND (f.status = 'A' OR f.status IS NULL OR f.status = '')
      ORDER BY f.nome
    `, [mes, ano, mes, ano]);

    res.json({ metas: rows, mes, ano });
  } catch (e) {
    console.error('[metas-vendas GET]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/metas-vendas/dashboard ──────────────────────────────────────────
// Widget home — indústrias com meta no mês atual
router.get('/dashboard', async (req, res) => {
  try {
    const pool = getPool();
    const { mes, ano } = mesBrasil();

    const [rows] = await pool.query(`
      SELECT
        f.id AS id_fornecedor, f.nome AS nome_fornecedor,
        m.valor_meta,
        COALESCE(r.realizado, 0) AS realizado,
        ROUND(COALESCE(r.realizado, 0) / m.valor_meta * 100, 1) AS pct
      FROM meta_vendas_fornecedor m
      JOIN fornecedores f ON f.id = m.id_fornecedor AND f.excluido = 'N'
      LEFT JOIN (
        SELECT cod_fornecedor, ${PEDIDOS_SUM} AS realizado
        FROM pedidos
        WHERE ${PEDIDOS_WHERE} AND MONTH(data_abertura) = ? AND YEAR(data_abertura) = ?
        GROUP BY cod_fornecedor
      ) r ON r.cod_fornecedor = f.id
      WHERE m.mes = ? AND m.ano = ? AND m.valor_meta > 0
      ORDER BY pct DESC LIMIT 10
    `, [mes, ano, mes, ano]);

    res.json({ metas: rows, mes, ano });
  } catch (e) {
    res.json({ metas: [] });
  }
});

// ── PUT /api/metas-vendas/:id_fornecedor — meta geral ────────────────────────
router.put('/:id_fornecedor', async (req, res) => {
  try {
    const pool = getPool();
    const { mes, ano, valor_meta } = req.body;
    if (!mes || !ano || valor_meta == null)
      return res.status(400).json({ error: 'mes, ano e valor_meta obrigatórios' });

    await pool.query(`
      INSERT INTO meta_vendas_fornecedor (id_fornecedor, mes, ano, valor_meta)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE valor_meta = VALUES(valor_meta)
    `, [req.params.id_fornecedor, mes, ano, valor_meta]);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/metas-vendas/:id_fornecedor — meta geral ─────────────────────
router.delete('/:id_fornecedor', async (req, res) => {
  try {
    const pool = getPool();
    const { mes, ano } = req.query;
    await pool.query(
      `DELETE FROM meta_vendas_fornecedor WHERE id_fornecedor = ? AND mes = ? AND ano = ?`,
      [req.params.id_fornecedor, mes, ano]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// METAS POR VENDEDOR
// ══════════════════════════════════════════════════════════════════════════════

// ── GET /api/metas-vendas/vendedor?mes=&ano=&id_fornecedor= ──────────────────
// Lista vendedores × indústria com meta e realizado
router.get('/vendedor', async (req, res) => {
  try {
    const pool = getPool();
    const hoje = mesBrasil();
    const mes = parseInt(req.query.mes) || hoje.mes;
    const ano = parseInt(req.query.ano) || hoje.ano;
    const idForn = parseInt(req.query.id_fornecedor) || null;

    // Sem filtro de fábrica: mostra apenas combinações com meta ou realizado
    // Com filtro: mostra todas as fábricas do vendedor para aquela indústria
    const semFornFilter = !idForn ? 'AND (m.valor_meta > 0 OR r.realizado > 0)' : '';
    const fornFilter    =  idForn ? 'AND f.id = ?' : '';
    const params = [mes, ano, mes, ano];
    if (idForn) params.push(idForn);

    const [rows] = await pool.query(`
      SELECT
        u.idusuario                   AS id_usuario,
        u.nome                        AS nome_vendedor,
        f.id                          AS id_fornecedor,
        f.nome                        AS nome_fornecedor,
        COALESCE(m.valor_meta, 0)     AS valor_meta,
        COALESCE(r.realizado, 0)      AS realizado
      FROM usuarios u
      JOIN perfil p ON p.id = u.idperfil AND p.p_vender = 'S' AND p.excluido = 'N'
      CROSS JOIN fornecedores f
      LEFT JOIN meta_vendas_vendedor m
             ON m.id_usuario = u.idusuario AND m.id_fornecedor = f.id
            AND m.mes = ? AND m.ano = ?
      LEFT JOIN (
        SELECT id_usuario, cod_fornecedor, ${PEDIDOS_SUM} AS realizado
        FROM pedidos
        WHERE ${PEDIDOS_WHERE} AND MONTH(data_abertura) = ? AND YEAR(data_abertura) = ?
        GROUP BY id_usuario, cod_fornecedor
      ) r ON r.id_usuario = u.idusuario AND r.cod_fornecedor = f.id
      WHERE u.excluido = 'N' AND u.SITUACAO = 'ATIVO'
        AND f.excluido = 'N' AND (f.status = 'A' OR f.status IS NULL OR f.status = '')
        ${semFornFilter}
        ${fornFilter}
      ORDER BY u.nome, f.nome
      LIMIT 500
    `, params);

    res.json({ metas: rows, mes, ano });
  } catch (e) {
    console.error('[metas-vendas/vendedor GET]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── PUT /api/metas-vendas/vendedor/:id_usuario/:id_fornecedor ────────────────
router.put('/vendedor/:id_usuario/:id_fornecedor', async (req, res) => {
  try {
    const pool = getPool();
    const { mes, ano, valor_meta } = req.body;
    if (!mes || !ano || valor_meta == null)
      return res.status(400).json({ error: 'mes, ano e valor_meta obrigatórios' });

    await pool.query(`
      INSERT INTO meta_vendas_vendedor (id_usuario, id_fornecedor, mes, ano, valor_meta)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE valor_meta = VALUES(valor_meta)
    `, [req.params.id_usuario, req.params.id_fornecedor, mes, ano, valor_meta]);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/metas-vendas/vendedor/:id_usuario/:id_fornecedor ─────────────
router.delete('/vendedor/:id_usuario/:id_fornecedor', async (req, res) => {
  try {
    const pool = getPool();
    const { mes, ano } = req.query;
    await pool.query(
      `DELETE FROM meta_vendas_vendedor WHERE id_usuario = ? AND id_fornecedor = ? AND mes = ? AND ano = ?`,
      [req.params.id_usuario, req.params.id_fornecedor, mes, ano]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
