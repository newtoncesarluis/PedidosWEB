'use strict';
const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const { getPool } = require('../config/database');
const {
  ensureMovimentoEstoqueTable,
  entradaEstoque,
  ajusteEstoque,
  entradaXml,
} = require('../config/estoque-movimentacao');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function _isAdmin(req)  { return req.user?.perfil == 1; }
// JWT expõe tela_estoque como gtela_estoque; crud como alterar_estoque / excluir_estoque (mesmo nome)
const _JWT_MAP = { tela_estoque: 'gtela_estoque' };
function _hasPerm(req, col) {
  const jwtKey = _JWT_MAP[col] || col;
  return _isAdmin(req) || req.user?.permissoes?.[jwtKey] === 'S' || req.user?.[jwtKey] === 'S';
}
function _requirePerm(col) {
  return (req, res, next) => {
    if (_hasPerm(req, col)) return next();
    return res.status(403).json({ error: 'Sem permissão' });
  };
}

async function _tabelaProduto(pool) {
  const [r] = await pool.query(`SHOW TABLES LIKE 'produto'`);
  return r.length ? 'produto' : 'produtos';
}

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/estoque/saldos
// Lista posição atual do estoque com alertas de mínimo e máximo
// ──────────────────────────────────────────────────────────────────────────────
router.get('/saldos', async (req, res) => {
  try {
    const pool   = getPool();
    const tabela = await _tabelaProduto(pool);
    const { q, fornecedor, alerta, page = 1, limit = 60 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = [];
    let where = `WHERE (p.excluido IS NULL OR p.excluido='N') AND p.situacao='A'`;

    if (q) {
      where += ` AND (p.descricao LIKE ? OR p.ID = ?)`;
      params.push(`%${q}%`, parseInt(q) || 0);
    }
    if (fornecedor) {
      where += ` AND p.cod_fornecedor = ?`;
      params.push(parseInt(fornecedor));
    }
    if (alerta === 'baixo') {
      where += ` AND IFNULL(p.estoque_minimo,0) > 0 AND IFNULL(p.estoque_atual,0) <= IFNULL(p.estoque_minimo,0)`;
    } else if (alerta === 'zero') {
      where += ` AND IFNULL(p.estoque_atual,0) <= 0`;
    }

    const [rows] = await pool.query(
      `SELECT p.ID, p.descricao,
              IFNULL(p.estoque_atual,0)    AS estoque_atual,
              IFNULL(p.estoque_minimo,0)   AS estoque_minimo,
              IFNULL(p.estoque_maximo,0)   AS estoque_maximo,
              IFNULL(p.estoque_seguranca,0) AS estoque_seguranca,
              p.situacao, p.unidade,
              f.nome AS fornecedor
       FROM ${tabela} p
       LEFT JOIN fornecedores f ON f.id = p.cod_fornecedor
       ${where}
       ORDER BY p.descricao
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM ${tabela} p ${where}`,
      params
    );

    res.json({ rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/estoque/movimentos
// Histórico de movimentações com filtros
// ──────────────────────────────────────────────────────────────────────────────
router.get('/movimentos', async (req, res) => {
  try {
    const pool = getPool();
    await ensureMovimentoEstoqueTable(pool);

    const { cod_produto, tipo, data_ini, data_fim, q, page = 1, limit = 60 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = [];
    let where = 'WHERE 1=1';

    if (cod_produto) { where += ' AND m.cod_produto = ?'; params.push(parseInt(cod_produto)); }
    if (tipo)        { where += ' AND m.tipo_movimento = ?'; params.push(tipo); }
    if (data_ini)    { where += ' AND m.data_movimento >= ?'; params.push(data_ini); }
    if (data_fim)    { where += ' AND m.data_movimento <= ?'; params.push(data_fim); }
    if (q)           { where += ' AND (m.desc_produto LIKE ? OR m.nota_fiscal = ? OR m.numero_pedido = ?)'; params.push(`%${q}%`, q, q); }

    const [rows] = await pool.query(
      `SELECT m.id, m.cod_produto, m.desc_produto, m.tipo_movimento,
              m.quantidade, m.saldo_anterior, m.saldo_posterior,
              m.id_pedido, m.numero_pedido,
              m.nome_usuario, m.observacao,
              m.nota_fiscal, m.chave_nfe, m.fornecedor_nome,
              m.data_movimento, m.hora_movimento
       FROM movimento_estoque m
       ${where}
       ORDER BY m.id DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM movimento_estoque m ${where}`,
      params
    );

    res.json({ rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/estoque/entrada
// Lançamento manual de entrada
// ──────────────────────────────────────────────────────────────────────────────
router.post('/entrada', _requirePerm('tela_estoque'), async (req, res) => {
  try {
    const pool = getPool();
    const { cod_produto, quantidade, observacao, nota_fiscal, chave_nfe, fornecedor_nome } = req.body;
    if (!cod_produto || !quantidade || parseFloat(quantidade) <= 0)
      return res.status(400).json({ error: 'cod_produto e quantidade são obrigatórios' });

    const result = await entradaEstoque(pool, {
      cod_produto:    parseInt(cod_produto),
      quantidade:     parseFloat(quantidade),
      observacao,
      nota_fiscal,
      chave_nfe,
      fornecedor_nome,
      id_usuario:    req.user?.id,
      nome_usuario:  req.user?.name || req.user?.nomeusu || req.user?.nome,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/estoque/ajuste
// Ajuste de inventário (define saldo absoluto)
// ──────────────────────────────────────────────────────────────────────────────
router.post('/ajuste', _requirePerm('alterar_estoque'), async (req, res) => {
  try {
    const pool = getPool();
    const { cod_produto, quantidade_nova, observacao } = req.body;
    if (cod_produto === undefined || quantidade_nova === undefined)
      return res.status(400).json({ error: 'cod_produto e quantidade_nova são obrigatórios' });

    const result = await ajusteEstoque(pool, {
      cod_produto:    parseInt(cod_produto),
      quantidade_nova: parseFloat(quantidade_nova),
      observacao,
      id_usuario:    req.user?.id,
      nome_usuario:  req.user?.name || req.user?.nomeusu || req.user?.nome,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/estoque/entrada-xml
// Upload de NF-e XML e entrada automática de estoque
// ──────────────────────────────────────────────────────────────────────────────
router.post('/entrada-xml', _requirePerm('tela_estoque'), upload.single('xml'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo XML enviado' });
    const pool = getPool();
    const result = await entradaXml(pool, req.file.buffer.toString('utf8'), {
      id_usuario:   req.user?.id,
      nome_usuario: req.user?.name || req.user?.nomeusu || req.user?.nome,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/estoque/relatorio
// Posição consolidada: total SKUs, valor estoque, qtd zerados, qtd abaixo do mínimo
// ──────────────────────────────────────────────────────────────────────────────
router.get('/relatorio', async (req, res) => {
  try {
    const pool   = getPool();
    const tabela = await _tabelaProduto(pool);
    const [[sum]] = await pool.query(
      `SELECT
         COUNT(*) AS total_skus,
         SUM(CASE WHEN IFNULL(estoque_atual,0) <= 0 THEN 1 ELSE 0 END) AS zerados,
         SUM(CASE WHEN IFNULL(estoque_minimo,0) > 0 AND IFNULL(estoque_atual,0) <= IFNULL(estoque_minimo,0) THEN 1 ELSE 0 END) AS abaixo_minimo,
         SUM(CASE WHEN IFNULL(estoque_maximo,0) > 0 AND IFNULL(estoque_atual,0) > IFNULL(estoque_maximo,0) THEN 1 ELSE 0 END) AS acima_maximo,
         SUM(IFNULL(estoque_atual,0) * IFNULL(vlr_custo,0)) AS valor_custo_total
       FROM ${tabela}
       WHERE (excluido IS NULL OR excluido='N') AND situacao='A'`
    ).catch(() => [[{}]]);

    await ensureMovimentoEstoqueTable(pool);
    const [[mov]] = await pool.query(
      `SELECT
         COUNT(*) AS total_movimentos,
         SUM(CASE WHEN tipo_movimento IN ('ENTRADA','XML') THEN quantidade ELSE 0 END) AS total_entradas,
         SUM(CASE WHEN tipo_movimento IN ('SAIDA','PEDIDO') THEN quantidade ELSE 0 END) AS total_saidas,
         MAX(data_movimento) AS ultima_movimentacao
       FROM movimento_estoque`
    ).catch(() => [[{}]]);

    res.json({ ...sum, ...mov });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// DELETE /api/estoque/movimentos/:id  (admin only — estorno)
// ──────────────────────────────────────────────────────────────────────────────
router.delete('/movimentos/:id', _requirePerm('excluir_estoque'), async (req, res) => {
  try {
    const pool = getPool();
    const id   = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido' });

    const [[mov]] = await pool.query(
      `SELECT * FROM movimento_estoque WHERE id = ? LIMIT 1`, [id]
    );
    if (!mov) return res.status(404).json({ error: 'Movimento não encontrado' });

    const tabela = await _tabelaProduto(pool);
    // Estorna: inverte o movimento no saldo
    const delta = mov.tipo_movimento === 'AJUSTE'
      ? mov.saldo_anterior - mov.saldo_posterior          // volta ao saldo_anterior
      : mov.saldo_anterior - mov.saldo_posterior;         // idem — simplesmente restaura

    await pool.query(
      `UPDATE ${tabela} SET estoque_atual = estoque_atual + ? WHERE ID = ?`,
      [delta, mov.cod_produto]
    );
    await pool.query(`DELETE FROM movimento_estoque WHERE id = ?`, [id]);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
