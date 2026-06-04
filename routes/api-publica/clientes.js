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

// ─── POST /clientes — cria cliente ───────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const pool = getPool();
    const { nome, nome_fantasia, cnpj, ie, telefone, celular, email,
            endereco, numero, complemento, bairro, cidade, uf, cep,
            codigo, id_parceiro } = req.body;

    if (!nome) return res.status(400).json({ error: { code: 400, message: 'Campo obrigatório: nome' } });

    // Evita duplicidade por id_parceiro
    if (id_parceiro) {
      const [[ex]] = await pool.query('SELECT id FROM clientes WHERE id_parceiro = ? LIMIT 1', [id_parceiro]);
      if (ex) return res.status(409).json({ error: { code: 409, message: 'Já existe um cliente com este id_parceiro', id: ex.id } });
    }

    const [result] = await pool.query(
      `INSERT INTO clientes
        (nome, apelido, cpf, ie, telefone, celular, email,
         endereco, numero, complemento, bairro, cidade, uf, cep,
         cod_cliente, id_parceiro, status, excluido)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'A','N')`,
      [nome, nome_fantasia||null, cnpj||null, ie||null, telefone||null,
       celular||null, email||null, endereco||null, numero||null,
       complemento||null, bairro||null, cidade||null, uf||null, cep||null,
       codigo||null, id_parceiro||null]
    );

    res.status(201).json({ data: { id: result.insertId, nome, status: 'A' } });
  } catch (err) {
    console.error('[api/v1/clientes] POST /', err.message);
    res.status(500).json({ error: { code: 500, message: 'Erro interno ao criar cliente' } });
  }
});

// ─── PATCH /clientes/:id — atualiza cliente (parcial) ────────────────────────
router.patch('/:id', async (req, res) => {
  try {
    const pool = getPool();
    const id   = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: { code: 400, message: 'ID inválido' } });

    const CAMPOS_PERMITIDOS = {
      nome: 'nome', nome_fantasia: 'apelido', cnpj: 'cpf', ie: 'ie',
      telefone: 'telefone', celular: 'celular', email: 'email',
      endereco: 'endereco', numero: 'numero', complemento: 'complemento',
      bairro: 'bairro', cidade: 'cidade', uf: 'uf', cep: 'cep',
      status: 'status', id_parceiro: 'id_parceiro',
    };

    const campos = {};
    for (const [campo, coluna] of Object.entries(CAMPOS_PERMITIDOS)) {
      if (req.body[campo] !== undefined) campos[coluna] = req.body[campo];
    }

    if (!Object.keys(campos).length) {
      return res.status(400).json({ error: { code: 400, message: 'Nenhum campo válido para atualizar' } });
    }

    const [[cli]] = await pool.query(
      `SELECT id FROM clientes WHERE id = ? AND excluido = 'N' LIMIT 1`, [id]
    );
    if (!cli) return res.status(404).json({ error: { code: 404, message: 'Cliente não encontrado' } });

    const sets   = Object.keys(campos).map(k => `\`${k}\` = ?`).join(', ');
    const values = Object.values(campos);
    await pool.query(`UPDATE clientes SET ${sets} WHERE id = ?`, [...values, id]);

    res.json({ data: { id, atualizado_em: new Date().toISOString() } });
  } catch (err) {
    console.error('[api/v1/clientes] PATCH /:id', err.message);
    res.status(500).json({ error: { code: 500, message: 'Erro interno ao atualizar cliente' } });
  }
});

module.exports = router;
