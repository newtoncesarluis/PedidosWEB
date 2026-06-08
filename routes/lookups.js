/**
 * Lookups — endpoints de dados auxiliares usados em formulários
 * Silencioso em caso de tabela inexistente (retorna [])
 */
const express = require('express');
const router  = express.Router();
const { getPool } = require('../config/database');
const { resolveNaturezaLabelColumn, naturezaLabelColumnName } = require('../config/natureza-label');
const {
  resolveDespesasLabelColumn,
  despesasLabelExpr,
  despesasOrderExpr,
} = require('../config/despesas-label');
const { listarTabelasVinculadas } = require('../config/tabela-preco-vinculo');
const { listVendedoresVisiveis } = require('../config/vendedor-visibilidade');

async function query(sql, params = []) {
  try {
    const pool = getPool();
    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (_) { return []; }
}

// GET /api/lookups/grupos → tabela: grupos
router.get('/grupos', async (req, res) => {
  const rows = await query(
    `SELECT id, descricao FROM grupos WHERE excluido='N' AND ativo='SIM' ORDER BY descricao`
  );
  res.json(rows);
});

// GET /api/lookups/categorias → tabela: categoria (segmentos)
router.get('/categorias', async (req, res) => {
  const rows = await query(
    `SELECT id, descricao FROM categoria WHERE excluido='N' ORDER BY descricao`
  );
  res.json(rows);
});

// GET /api/lookups/familia → tabela: familia_produtos
router.get('/familia', async (req, res) => {
  const rows = await query(
    `SELECT id, nome FROM familia_produtos WHERE excluido='N' ORDER BY nome`
  );
  res.json(rows);
});

// GET /api/lookups/local-arm → tabela: local_armazenamento
router.get('/local-arm', async (req, res) => {
  const rows = await query(
    `SELECT id, nome_local FROM local_armazenamento WHERE excluido='N' ORDER BY nome_local`
  );
  res.json(rows);
});

// GET /api/lookups/tipograde → tabela: tipograde
router.get('/tipograde', async (req, res) => {
  const rows = await query(
    `SELECT id, nome, tipo FROM tipograde WHERE excluido='N' ORDER BY nome`
  );
  res.json(rows);
});

// GET /api/lookups/tabela-preco → cabecalho (+ legado). ?id_fornecedor= filtra vínculos FORNECEDOR
router.get('/tabela-preco', async (req, res) => {
  try {
    const pool = getPool();
    const fId = parseInt(req.query.id_fornecedor || req.query.cod_fornecedor, 10);
    if (fId > 0) {
      const rows = await listarTabelasVinculadas(pool, fId, 'FORNECEDOR');
      return res.json(rows);
    }

    let rows = await query(
      `SELECT id, Descricao AS descricao FROM tabela_preco_cabecalho
       WHERE excluido = 'N' AND Tabela_Ativa = 'S' ORDER BY Descricao`
    );
    if (!rows?.length) {
      rows = await query(
        `SELECT id, descricao FROM tabela_preco WHERE excluido='N' AND tipo_regra<>'PRODUTO' ORDER BY descricao`
      );
    }
    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/lookups/fornecedores → tabela: fornecedores (ativos, para select)
router.get('/fornecedores', async (req, res) => {
  const { q = '' } = req.query;
  let sql = `SELECT id, nome FROM fornecedores WHERE status='A' AND COALESCE(tipo, 'FABRICA') = 'FABRICA'`;
  const params = [];
  if (q.trim()) { sql += ` AND nome LIKE ?`; params.push(`%${q.trim()}%`); }
  sql += ` ORDER BY nome LIMIT 200`;
  const rows = await query(sql, params);
  res.json(rows);
});

// GET /api/lookups/vendedores → usuários visíveis ao logado
router.get('/vendedores', async (req, res) => {
  try {
    const pool = getPool();
    const rows = await listVendedoresVisiveis(pool, req);
    res.json(rows);
  } catch (_) {
    res.json([]);
  }
});

// GET /api/lookups/regioes → tabela: regiao_rota → fallback: regioes → fallback: distinct de clientes
router.get('/regioes', async (req, res) => {
  let rows = [];
  try { rows = await query(`SELECT id, descricao FROM regiao_rota WHERE (status='A' OR status IS NULL) AND (excluido='N' OR excluido IS NULL) ORDER BY descricao`); } catch (_) {}
  if (!rows?.length) {
    try { rows = await query(`SELECT id, descricao FROM regioes ORDER BY descricao`); } catch (_) {}
  }
  if (!rows?.length) {
    try { rows = await query(`SELECT DISTINCT regiao AS id, regiao AS descricao FROM clientes WHERE regiao IS NOT NULL AND regiao <> '' ORDER BY regiao`); } catch (_) {}
  }
  res.json(rows || []);
});

// GET /api/lookups/produto-especifico → produtos ativos id_grupo=4
router.get('/produto-especifico', async (req, res) => {
  const rows = await query(
    `SELECT ID AS id, descricao FROM produto WHERE situacao='A' AND excluido='N' AND id_grupo='4' ORDER BY descricao LIMIT 500`
  );
  res.json(rows);
});

// GET /api/lookups/transportadoras → tabela: transportadora
router.get('/transportadoras', async (req, res) => {
  const rows = await query(
    `SELECT id, nome FROM transportadora WHERE (status='A' OR status IS NULL) AND (excluido='N' OR excluido IS NULL) ORDER BY nome`
  );
  res.json(rows);
});

// GET /api/lookups/natureza → tabela: natureza (legado: nome; novo: descricao)
router.get('/natureza', async (req, res) => {
  try {
    const pool = getPool();
    await resolveNaturezaLabelColumn(pool);
    const label = naturezaLabelColumnName();
    const rows = await query(
      `SELECT id, \`${label}\` AS nome FROM natureza WHERE excluido='N' AND (status='A' OR status IS NULL) ORDER BY \`${label}\``
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/lookups/despesas — mesma SQL do legado (nome ou descricao conforme o banco)
router.get('/despesas', async (req, res) => {
  try {
    const pool = getPool();
    await resolveDespesasLabelColumn(pool);
    const labelSql = despesasLabelExpr('d');
    const orderSql = despesasOrderExpr('d');
    const [rows] = await pool.query(
      `SELECT d.id AS id_despesas, ${labelSql} AS nome
       FROM despesas d
       WHERE d.excluido = 'N'
       ORDER BY ${orderSql}`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/lookups/condicoes-pagamento → forma_pagto (Condições de Pagamento)
router.get('/condicoes-pagamento', async (req, res) => {
  let rows = await query(
    `SELECT id, descricao, prazopadrao FROM forma_pagto
     WHERE (excluido = 'N' OR excluido IS NULL)
     ORDER BY descricao`
  );
  if (!rows?.length) {
    rows = await query(`SELECT id, descricao, prazopadrao FROM forma_pagto ORDER BY descricao`);
  }
  res.json(rows);
});

module.exports = router;
