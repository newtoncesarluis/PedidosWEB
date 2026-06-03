/**
 * GET /api/v1/clientes     — lista paginada de clientes ativos
 */
const express = require('express');
const router  = express.Router();
const { getPool } = require('../../config/database');

router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    const { busca, page = 1, limit = 100 } = req.query;

    const pageNum  = Math.max(1, parseInt(page)  || 1);
    const limitNum = Math.min(500, Math.max(1, parseInt(limit) || 100));
    const offset   = (pageNum - 1) * limitNum;

    let where  = `WHERE c.excluido = 'N' AND c.status IN ('A','E')`;
    const params = [];

    if (busca) {
      where += ` AND (c.nome LIKE ? OR c.apelido LIKE ? OR c.cpf LIKE ? OR c.cod_cliente LIKE ?)`;
      const b = `%${busca}%`;
      params.push(b, b, b, b);
    }

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(c.id) AS total FROM clientes c ${where}`,
      params
    );

    const [rows] = await pool.query(
      `SELECT
         c.id,
         c.cod_cliente                          AS codigo,
         c.nome,
         c.apelido                              AS nome_fantasia,
         c.cpf                                  AS cnpj,
         c.ie,
         c.telefone,
         c.celular,
         c.email,
         c.endereco,
         c.numero                               AS numero_endereco,
         c.complemento,
         c.bairro,
         c.cidade,
         c.uf,
         c.cep,
         c.status,
         rr.descricao                           AS regiao
       FROM clientes c
       LEFT JOIN regiao_rota rr ON rr.id = c.regiao AND rr.excluido = 'N'
       ${where}
       ORDER BY c.nome ASC
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    const data = rows.map(c => ({
      id:          c.id,
      codigo:      c.codigo      || null,
      nome:        c.nome,
      nome_fantasia: c.nome_fantasia || null,
      cnpj:        c.cnpj        || null,
      ie:          c.ie          || null,
      telefone:    c.telefone    || null,
      celular:     c.celular     || null,
      email:       c.email       || null,
      endereco: {
        logradouro:  c.endereco         || null,
        numero:      c.numero_endereco  || null,
        complemento: c.complemento      || null,
        bairro:      c.bairro           || null,
        cidade:      c.cidade           || null,
        uf:          c.uf               || null,
        cep:         c.cep              || null,
      },
      regiao:  c.regiao  || null,
      status:  c.status,
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
    console.error('[api/v1/clientes] GET /', err.message);
    res.status(500).json({ error: { code: 500, message: 'Erro interno ao buscar clientes' } });
  }
});

module.exports = router;
