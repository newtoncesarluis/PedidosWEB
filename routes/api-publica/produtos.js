/**
 * GET /api/v1/produtos     — lista paginada de produtos ativos
 */
const express = require('express');
const router  = express.Router();
const { getPool } = require('../../config/database');
const { enrichProdutosComPromocao } = require('../../config/promocoes-produto');

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
    const { busca, id_fornecedor, atualizado_apos, page = 1, limit = 100 } = req.query;

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
    if (atualizado_apos) {
      where += ` AND p.updated_at >= ?`;
      params.push(atualizado_apos);
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
         p.updated_at,
         f.nome                  AS nome_fornecedor
       FROM \`${pt}\` p
       LEFT JOIN fornecedores f ON f.id = p.cod_fornecedor AND f.excluido = 'N'
       ${where}
       ORDER BY p.descricao ASC
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    let data = rows.map(p => ({
      id:           p.id,
      codigo:       p.codigo    || null,
      descricao:    p.descricao,
      unidade:      p.unidade   || null,
      preco_venda:  Number(p.preco_venda   || 0),
      preco_atacado:Number(p.preco_atacado || 0),
      preco_promocao:Number(p.preco_promocao || 0),
      vlr_venda:    Number(p.preco_venda   || 0),
      situacao:     p.situacao,
      updated_at:   p.updated_at || null,
      cod_fornecedor: p.cod_fornecedor || null,
      fornecedor: {
        id:   p.cod_fornecedor || null,
        nome: p.nome_fornecedor || null,
      },
    }));

    const codCliente = parseInt(req.query.cod_cliente, 10) || null;
    const idRegiao = parseInt(req.query.id_regiao, 10) || null;
    const codFornecedor = parseInt(req.query.cod_fornecedor || req.query.id_fornecedor, 10) || null;
    const idTabelaPreco = parseInt(req.query.id_tabela_preco || req.query.id_tabela, 10) || null;
    data = await enrichProdutosComPromocao(pool, data, {
      codCliente,
      idRegiao,
      codFornecedor,
      idTabelaPreco,
    });

    data = data.map((p) => {
      const out = {
        id: p.id,
        codigo: p.codigo || null,
        descricao: p.descricao,
        unidade: p.unidade || null,
        preco_venda: Number(p.preco_venda || 0),
        preco_atacado: Number(p.preco_atacado || 0),
        preco_promocao: Number(p.preco_promocao || 0),
        situacao:   p.situacao,
        updated_at: p.updated_at || null,
        fornecedor: p.fornecedor,
        tem_promocao: !!p.tem_promocao,
      };
      if (p.promocao_ativa) {
        out.promocao_ativa = {
          id: p.promocao_ativa.id,
          descricao: p.promocao_ativa.descricao,
          preco_promo: p.promocao_ativa.preco_promo,
          qtd_minima: p.promocao_ativa.qtd_minima,
          aplica_agora: p.promocao_ativa.aplica_agora,
        };
        if (p.promocao_ativa.aplica_agora) {
          out.preco_promocao = Number(p.promocao_ativa.preco_promo || 0);
        }
      }
      return out;
    });

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

// ─── POST /produtos — cria produto ───────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const pool = getPool();
    const pt   = await getProdTabela(pool);
    const { descricao, codigo, unidade, preco_venda, preco_atacado,
            preco_promocao, cod_fornecedor, id_parceiro } = req.body;

    if (!descricao) return res.status(400).json({ error: { code: 400, message: 'Campo obrigatório: descricao' } });

    // Evita duplicidade por id_parceiro
    if (id_parceiro) {
      const [[ex]] = await pool.query(`SELECT ID FROM \`${pt}\` WHERE id_parceiro = ? LIMIT 1`, [id_parceiro]);
      if (ex) return res.status(409).json({ error: { code: 409, message: 'Já existe um produto com este id_parceiro', id: ex.ID } });
    }

    const [result] = await pool.query(
      `INSERT INTO \`${pt}\`
        (descricao, referencia, unidade, preco1, preco2, preco3,
         cod_fornecedor, id_parceiro, situacao, excluido)
       VALUES (?,?,?,?,?,?,?,?,'A','N')`,
      [descricao, codigo||null, unidade||null,
       preco_venda||0, preco_atacado||0, preco_promocao||0,
       cod_fornecedor||null, id_parceiro||null]
    );

    res.status(201).json({ data: { id: result.insertId, descricao, situacao: 'A' } });
  } catch (err) {
    console.error('[api/v1/produtos] POST /', err.message);
    res.status(500).json({ error: { code: 500, message: 'Erro interno ao criar produto' } });
  }
});

// ─── PATCH /produtos/:id — atualiza produto (parcial) ────────────────────────
router.patch('/:id', async (req, res) => {
  try {
    const pool = getPool();
    const pt   = await getProdTabela(pool);
    const id   = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: { code: 400, message: 'ID inválido' } });

    const CAMPOS_PERMITIDOS = {
      descricao: 'descricao', codigo: 'referencia', unidade: 'unidade',
      preco_venda: 'preco1', preco_atacado: 'preco2', preco_promocao: 'preco3',
      cod_fornecedor: 'cod_fornecedor', situacao: 'situacao', id_parceiro: 'id_parceiro',
    };

    const campos = {};
    for (const [campo, coluna] of Object.entries(CAMPOS_PERMITIDOS)) {
      if (req.body[campo] !== undefined) campos[coluna] = req.body[campo];
    }

    if (!Object.keys(campos).length) {
      return res.status(400).json({ error: { code: 400, message: 'Nenhum campo válido para atualizar' } });
    }

    const [[prod]] = await pool.query(
      `SELECT ID FROM \`${pt}\` WHERE ID = ? AND excluido = 'N' LIMIT 1`, [id]
    );
    if (!prod) return res.status(404).json({ error: { code: 404, message: 'Produto não encontrado' } });

    const sets   = Object.keys(campos).map(k => `\`${k}\` = ?`).join(', ');
    const values = Object.values(campos);
    await pool.query(`UPDATE \`${pt}\` SET ${sets} WHERE ID = ?`, [...values, id]);

    res.json({ data: { id, atualizado_em: new Date().toISOString() } });
  } catch (err) {
    console.error('[api/v1/produtos] PATCH /:id', err.message);
    res.status(500).json({ error: { code: 500, message: 'Erro interno ao atualizar produto' } });
  }
});

module.exports = router;
