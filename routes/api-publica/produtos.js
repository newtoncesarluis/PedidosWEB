/**
 * GET /api/v1/produtos     — lista paginada de produtos ativos
 */
const express = require('express');
const router  = express.Router();
const { getPool } = require('../../config/database');

let _prodTabela = null;
async function getProdTabela(pool) {
  if (_prodTabela) return _prodTabela;
  const [r] = await pool.query(`SHOW TABLES LIKE 'produto'`);
  _prodTabela = r.length ? 'produto' : 'produtos';
  return _prodTabela;
}

router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    const { busca, id_fornecedor, page = 1, limit = 100 } = req.query;

    const pageNum  = Math.max(1, parseInt(page)  || 1);
    const limitNum = Math.min(500, Math.max(1, parseInt(limit) || 100));
    const offset   = (pageNum - 1) * limitNum;
    const pt       = await getProdTabela(pool);

    let where  = `WHERE p.excluido = 'N' AND p.situacao = 'A'`;
    const params = [];

    if (busca) {
      where += ` AND (p.descricao LIKE ? OR p.referencia LIKE ? OR p.cod_ref LIKE ?)`;
      const b = `%${busca}%`;
      params.push(b, b, b);
    }
    if (id_fornecedor) {
      where += ` AND p.cod_fornecedor = ?`;
      params.push(id_fornecedor);
    }

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(p.ID) AS total FROM \`${pt}\` p ${where}`,
      params
    );

    const [rows] = await pool.query(
      `SELECT
         p.ID                    AS id,
         COALESCE(p.referencia, p.cod_ref, '') AS codigo,
         p.descricao,
         p.unidade,
         p.preco1                AS preco_venda,
         p.preco2                AS preco_atacado,
         p.preco3                AS preco_promocao,
         p.situacao,
         p.cod_fornecedor,
         f.nome                  AS nome_fornecedor
       FROM \`${pt}\` p
       LEFT JOIN fornecedores f ON f.id = p.cod_fornecedor AND f.excluido = 'N'
       ${where}
       ORDER BY p.descricao ASC
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    const data = rows.map(p => ({
      id:           p.id,
      codigo:       p.codigo    || null,
      descricao:    p.descricao,
      unidade:      p.unidade   || null,
      preco_venda:  Number(p.preco_venda   || 0),
      preco_atacado:Number(p.preco_atacado || 0),
      preco_promocao:Number(p.preco_promocao || 0),
      situacao:     p.situacao,
      fornecedor: {
        id:   p.cod_fornecedor || null,
        nome: p.nome_fornecedor || null,
      },
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
    console.error('[api/v1/produtos] GET /', err.message);
    res.status(500).json({ error: { code: 500, message: 'Erro interno ao buscar produtos' } });
  }
});

module.exports = router;
