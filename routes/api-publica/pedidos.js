/**
 * GET /api/v1/pedidos          — lista paginada com filtros
 * GET /api/v1/pedidos/:id      — detalhe de um pedido
 */
const express = require('express');
const router  = express.Router();
const { getPool } = require('../../config/database');

// ─── tabela de produto pode ser "produto" ou "produtos" ───────────────────────
let _prodTabela = null;
async function getProdTabela(pool) {
  if (_prodTabela) return _prodTabela;
  const [r] = await pool.query(`SHOW TABLES LIKE 'produto'`);
  _prodTabela = r.length ? 'produto' : 'produtos';
  return _prodTabela;
}

// ─── Lista de pedidos ─────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    const {
      data_inicio, data_fim,
      status, id_vendedor, id_cliente,
      page = 1, limit = 100,
    } = req.query;

    const pageNum  = Math.max(1, parseInt(page)  || 1);
    const limitNum = Math.min(500, Math.max(1, parseInt(limit) || 100));
    const offset   = (pageNum - 1) * limitNum;

    let where  = `WHERE (p.excluido = 'N' OR p.excluido IS NULL OR p.excluido = '')`;
    const params = [];

    if (data_inicio) { where += ` AND DATE(p.data_abertura) >= ?`; params.push(data_inicio); }
    if (data_fim)    { where += ` AND DATE(p.data_abertura) <= ?`; params.push(data_fim); }
    if (status)      { where += ` AND p.situacao_pedido = ?`;      params.push(status.toUpperCase()); }
    if (id_vendedor) { where += ` AND p.id_usuario = ?`;           params.push(id_vendedor); }
    if (id_cliente)  { where += ` AND p.cod_cliente = ?`;          params.push(id_cliente); }

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(p.id) AS total FROM pedidos p ${where}`,
      params
    );

    const [rows] = await pool.query(
      `SELECT
         p.id,
         p.numero,
         DATE_FORMAT(p.data_abertura, '%Y-%m-%d') AS data_emissao,
         p.situacao_pedido                        AS status,
         p.cod_cliente,
         p.nome_cliente,
         p.id_usuario                             AS id_vendedor,
         p.nome_vendedor,
         p.cod_fornecedor,
         p.nome_fornecedor,
         p.forma_pagto,
         p.vlrtotalpedido                         AS valor_total,
         p.vlrdesconto                            AS desconto,
         p.observacao
       FROM pedidos p
       ${where}
       ORDER BY p.id DESC
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    // Busca itens de todos os pedidos retornados em uma única query
    let itensMap = {};
    if (rows.length) {
      const ids = rows.map(r => r.id);
      const pt  = await getProdTabela(pool);
      const [itens] = await pool.query(
        `SELECT
           i.id_pedido,
           i.cod_produto    AS id_produto,
           i.descricao,
           COALESCE(pr.referencia, pr.cod_ref, '') AS codigo,
           i.qtd            AS quantidade,
           i.preco          AS preco_unitario,
           i.vltotal        AS valor_total,
           i.unidade
         FROM itensped i
         LEFT JOIN \`${pt}\` pr ON pr.ID = i.cod_produto
         WHERE i.id_pedido IN (?)
           AND (i.excluido IS NULL OR i.excluido = 'N')`,
        [ids]
      );
      for (const it of itens) {
        if (!itensMap[it.id_pedido]) itensMap[it.id_pedido] = [];
        itensMap[it.id_pedido].push({
          id_produto:    it.id_produto,
          codigo:        it.codigo,
          descricao:     it.descricao,
          quantidade:    Number(it.quantidade),
          preco_unitario:Number(it.preco_unitario),
          valor_total:   Number(it.valor_total),
          unidade:       it.unidade,
        });
      }
    }

    const data = rows.map(p => ({
      id:           p.id,
      numero:       p.numero,
      data_emissao: p.data_emissao,
      status:       p.status,
      cliente: {
        id:   p.cod_cliente,
        nome: p.nome_cliente,
      },
      vendedor: {
        id:   p.id_vendedor,
        nome: p.nome_vendedor,
      },
      fornecedor: {
        id:   p.cod_fornecedor,
        nome: p.nome_fornecedor,
      },
      forma_pagamento: p.forma_pagto,
      valor_total:     Number(p.valor_total || 0),
      desconto:        Number(p.desconto    || 0),
      observacao:      p.observacao || null,
      itens:           itensMap[p.id] || [],
    }));

    res.json({
      data,
      meta: {
        total:  Number(total),
        page:   pageNum,
        limit:  limitNum,
        pages:  Math.ceil(Number(total) / limitNum),
      },
    });
  } catch (err) {
    console.error('[api/v1/pedidos] GET /', err.message);
    res.status(500).json({ error: { code: 500, message: 'Erro interno ao buscar pedidos' } });
  }
});

// ─── Detalhe de um pedido ─────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const pool = getPool();
    const id   = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: { code: 400, message: 'ID inválido' } });

    const [[pedido]] = await pool.query(
      `SELECT
         p.id,
         p.numero,
         DATE_FORMAT(p.data_abertura, '%Y-%m-%d') AS data_emissao,
         p.situacao_pedido    AS status,
         p.cod_cliente,
         p.nome_cliente,
         c.cpf                AS cnpj_cliente,
         c.telefone           AS telefone_cliente,
         c.email              AS email_cliente,
         c.endereco           AS endereco_cliente,
         c.cidade             AS cidade_cliente,
         c.uf                 AS uf_cliente,
         p.id_usuario         AS id_vendedor,
         p.nome_vendedor,
         p.cod_fornecedor,
         p.nome_fornecedor,
         p.forma_pagto,
         p.vlrtotalpedido     AS valor_total,
         p.vlrsubtotal        AS subtotal,
         p.vlrdesconto        AS desconto,
         p.vlrtotalimposto    AS total_impostos,
         p.vlrfrete           AS frete,
         p.observacao,
         p.data_entrega
       FROM pedidos p
       LEFT JOIN clientes c ON c.id = p.cod_cliente
       WHERE p.id = ?
         AND (p.excluido = 'N' OR p.excluido IS NULL OR p.excluido = '')
       LIMIT 1`,
      [id]
    );

    if (!pedido) return res.status(404).json({ error: { code: 404, message: 'Pedido não encontrado' } });

    const pt = await getProdTabela(pool);
    const [itens] = await pool.query(
      `SELECT
         i.id_pedido,
         i.cod_produto    AS id_produto,
         i.descricao,
         COALESCE(pr.referencia, pr.cod_ref, '') AS codigo,
         i.qtd            AS quantidade,
         i.preco          AS preco_unitario,
         i.vltotal        AS valor_total,
         i.unidade,
         i.vlr_desconto   AS desconto_item,
         i.vlr_ipi        AS ipi,
         i.vlr_st         AS st
       FROM itensped i
       LEFT JOIN \`${pt}\` pr ON pr.ID = i.cod_produto
       WHERE i.id_pedido = ?
         AND (i.excluido IS NULL OR i.excluido = 'N')`,
      [id]
    );

    res.json({
      data: {
        id:           pedido.id,
        numero:       pedido.numero,
        data_emissao: pedido.data_emissao,
        data_entrega: pedido.data_entrega || null,
        status:       pedido.status,
        cliente: {
          id:       pedido.cod_cliente,
          nome:     pedido.nome_cliente,
          cnpj:     pedido.cnpj_cliente     || null,
          telefone: pedido.telefone_cliente || null,
          email:    pedido.email_cliente    || null,
          endereco: pedido.endereco_cliente || null,
          cidade:   pedido.cidade_cliente   || null,
          uf:       pedido.uf_cliente       || null,
        },
        vendedor: {
          id:   pedido.id_vendedor,
          nome: pedido.nome_vendedor,
        },
        fornecedor: {
          id:   pedido.cod_fornecedor,
          nome: pedido.nome_fornecedor,
        },
        forma_pagamento: pedido.forma_pagto,
        valores: {
          subtotal:       Number(pedido.subtotal       || 0),
          desconto:       Number(pedido.desconto       || 0),
          total_impostos: Number(pedido.total_impostos || 0),
          frete:          Number(pedido.frete          || 0),
          total:          Number(pedido.valor_total    || 0),
        },
        observacao: pedido.observacao || null,
        itens: itens.map(i => ({
          id_produto:    i.id_produto,
          codigo:        i.codigo,
          descricao:     i.descricao,
          quantidade:    Number(i.quantidade),
          preco_unitario:Number(i.preco_unitario),
          desconto_item: Number(i.desconto_item || 0),
          ipi:           Number(i.ipi || 0),
          st:            Number(i.st  || 0),
          valor_total:   Number(i.valor_total),
          unidade:       i.unidade,
        })),
      },
    });
  } catch (err) {
    console.error('[api/v1/pedidos] GET /:id', err.message);
    res.status(500).json({ error: { code: 500, message: 'Erro interno ao buscar pedido' } });
  }
});

module.exports = router;
