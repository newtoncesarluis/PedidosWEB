/**
 * Lookups — endpoints de dados auxiliares usados em formulários
 * Silencioso em caso de tabela inexistente (retorna [])
 */
const express = require('express');
const router  = express.Router();
const { getPool } = require('../config/database');

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

// GET /api/lookups/tabela-preco → tabela: tabela_preco
router.get('/tabela-preco', async (req, res) => {
  const rows = await query(
    `SELECT id, descricao FROM tabela_preco WHERE excluido='N' AND tipo_regra<>'PRODUTO' ORDER BY descricao`
  );
  res.json(rows);
});

// GET /api/lookups/fornecedores → tabela: fornecedores (ativos, para select)
router.get('/fornecedores', async (req, res) => {
  const { q = '' } = req.query;
  let sql = `SELECT id, nome FROM fornecedores WHERE status='A'`;
  const params = [];
  if (q.trim()) { sql += ` AND nome LIKE ?`; params.push(`%${q.trim()}%`); }
  sql += ` ORDER BY nome LIMIT 200`;
  const rows = await query(sql, params);
  res.json(rows);
});

// GET /api/lookups/vendedores → usuários que são vendedores
router.get('/vendedores', async (req, res) => {
  const rows = await query(
    `SELECT idusuario AS id, nomeusu AS nome FROM usuarios WHERE excluido='N' AND (SITUACAO='ATIVO' OR SITUACAO IS NULL) ORDER BY nomeusu`
  );
  res.json(rows);
});

// GET /api/lookups/regioes → tabela: regioes ou fallback de clientes
router.get('/regioes', async (req, res) => {
  let rows = await query(`SELECT id, descricao FROM regioes ORDER BY descricao`);
  if (!rows || rows.length === 0) {
    rows = await query(`SELECT DISTINCT regiao AS id, regiao AS descricao FROM clientes WHERE regiao IS NOT NULL AND regiao <> '' ORDER BY regiao`);
  }
  res.json(rows);
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

module.exports = router;
