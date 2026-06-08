const express = require('express');
const router  = express.Router();
const { getPool } = require('../config/database');
const { permCrud, negarCad } = require('../config/cadastros-permissoes');

const _permTransp = (req) => permCrud(req, {
  incluir: 'transportadora_incluir',
  alterar: 'transportadora_alterar',
  excluir: 'transportadora_excluir',
});

// ─── Cache de colunas reais da tabela transportadora ─────────────────────────
let _colunasCache = null;
async function getColunasReais(pool) {
  if (_colunasCache) return _colunasCache;
  const [cols] = await pool.query('DESCRIBE transportadora').catch(() => [[]]);
  _colunasCache = new Set(cols.map(c => c.Field));
  return _colunasCache;
}

// Campos texto que devem ser salvos em UPPERCASE
const _camposUpper = new Set([
  'nome','apelido','rg',
  'cep','endereco','bairro','cidade','uf','contato',
  'segmento','obsgerais',
  'endereco_faturamento','bairro_faturamento','cidade_faturamento',
  'cep_faturamento','uf_faturamento','contato_recebedor','contato_financeiro',
  'telefone1_faturamento','telefone2_faturamento'
]);

function aplicarUpper(body) {
  const out = { ...body };
  for (const k of _camposUpper) {
    if (typeof out[k] === 'string' && out[k].trim()) {
      out[k] = out[k].toUpperCase();
    }
  }
  return out;
}

// ─── GET /api/transportadoras ─────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    const { q = '', status = 'A', campo = 'nome', limit = 100, offset = 0 } = req.query;

    let where = [`(t.excluido = 'N' OR t.excluido IS NULL OR t.excluido = '')`];
    const vals = [];

    if (status === 'A')      where.push(`(t.status = 'A' OR t.status IS NULL OR t.status = '')`);
    else if (status === 'I') where.push(`t.status = 'I'`);

    if (q.trim()) {
      const like = `%${q.trim().toLowerCase()}%`;
      const campoMap = {
        nome:      `LOWER(t.nome) LIKE ?`,
        cpf:       `t.cpf LIKE ?`,
        telefone1: `t.foneprincipal LIKE ?`,
        telefone2: `t.fonesecundario LIKE ?`,
        cep:       `t.cep LIKE ?`,
        endereco:  `LOWER(t.endereco) LIKE ?`,
        bairro:    `LOWER(t.bairro) LIKE ?`,
        cidade:    `LOWER(t.cidade) LIKE ?`,
        rg:        `t.rg LIKE ?`,
      };
      const expr = campoMap[campo] || `LOWER(t.nome) LIKE ?`;
      where.push(`(${expr})`);
      vals.push(like);
    }

    const whereClause = where.join(' AND ');

    const [rows] = await pool.query(
      `SELECT t.id, t.nome, t.apelido, t.cpf, t.tipo_pessoa,
              t.foneprincipal, t.fonesecundario, t.cidade, t.uf, t.status, t.dtcadastro,
              (SELECT COUNT(*) FROM pedidos p WHERE p.cod_transportadora = t.id AND COALESCE(p.excluido,'N')='N') as total_pedidos
       FROM transportadora t
       WHERE ${whereClause}
       ORDER BY t.nome
       LIMIT ? OFFSET ?`,
      [...vals, parseInt(limit), parseInt(offset)]
    );

    const [total] = await pool.query(
      `SELECT COUNT(*) AS total FROM transportadora t WHERE ${whereClause}`, vals
    );

    res.json({ transportadoras: rows, total: total[0].total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/transportadoras/check-cpf ──────────────────────────────────────
router.get('/check-cpf', async (req, res) => {
  try {
    const pool = getPool();
    const { cpf, excluir_id } = req.query;
    if (!cpf?.trim()) return res.status(400).json({ error: 'CPF/CNPJ obrigatório' });

    const docLimpo = cpf.replace(/\D/g, '');
    let sql = `SELECT id, nome, cpf, cidade, uf, status FROM transportadora
               WHERE REPLACE(REPLACE(REPLACE(cpf,'.',''),'-',''),'/','') = ?
                 AND (excluido='N' OR excluido IS NULL OR excluido='')`;
    const params = [docLimpo];
    if (excluir_id) { sql += ' AND id <> ?'; params.push(excluir_id); }
    sql += ' LIMIT 1';

    const [rows] = await pool.query(sql, params);
    res.json({ duplicado: rows.length > 0, transportadora: rows[0] || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/transportadoras/notificacoes ───────────────────────────────────
router.get('/notificacoes', async (req, res) => {
  try {
    const pool = getPool();
    const [[ativos]]   = await pool.query(`SELECT COUNT(*) AS n FROM transportadora WHERE status='A' AND (excluido='N' OR excluido IS NULL OR excluido='')`);
    const [[inativos]] = await pool.query(`SELECT COUNT(*) AS n FROM transportadora WHERE status='I' AND (excluido='N' OR excluido IS NULL OR excluido='')`);
    const [[novos]]    = await pool.query(`SELECT COUNT(*) AS n FROM transportadora WHERE dtcadastro >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND (excluido='N' OR excluido IS NULL OR excluido='')`).catch(() => [[{ n: 0 }]]);
    res.json({ ativos: ativos.n, inativos: inativos.n, novos7dias: novos.n });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/transportadoras/:id ────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT * FROM transportadora WHERE id = ? AND (excluido='N' OR excluido IS NULL OR excluido='')`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Transportadora não encontrada' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/transportadoras ────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const pc = _permTransp(req);
    if (pc.incluir !== 'S') return negarCad(res, 'Sem permissão para incluir transportadoras');
    const pool    = getPool();
    const colunas = await getColunasReais(pool);
    const body    = aplicarUpper(req.body);

    const campos = Object.keys(body).filter(k => colunas.has(k) && k !== 'id');
    if (!campos.length) return res.status(400).json({ error: 'Nenhum campo válido' });

    const sql = `INSERT INTO transportadora (${campos.join(',')}) VALUES (${campos.map(() => '?').join(',')})`;
    const [result] = await pool.query(sql, campos.map(k => body[k] ?? null));
    res.json({ id: result.insertId, ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/transportadoras/:id ─────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const pc = _permTransp(req);
    if (pc.alterar !== 'S') return negarCad(res, 'Sem permissão para alterar transportadoras');
    const pool    = getPool();
    const colunas = await getColunasReais(pool);
    const body    = aplicarUpper(req.body);

    const campos = Object.keys(body).filter(k => colunas.has(k) && k !== 'id');
    if (!campos.length) return res.status(400).json({ error: 'Nenhum campo válido' });

    const sql = `UPDATE transportadora SET ${campos.map(k => `${k}=?`).join(',')} WHERE id=?`;
    await pool.query(sql, [...campos.map(k => body[k] ?? null), req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/transportadoras/:id/ativar ─────────────────────────────────────
router.put('/:id/ativar', async (req, res) => {
  try {
    const pc = _permTransp(req);
    if (pc.alterar !== 'S') return negarCad(res, 'Sem permissão para alterar transportadoras');
    const pool = getPool();
    await pool.query(`UPDATE transportadora SET status='A' WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/transportadoras/:id/inativar ───────────────────────────────────
router.put('/:id/inativar', async (req, res) => {
  try {
    const pc = _permTransp(req);
    if (pc.alterar !== 'S') return negarCad(res, 'Sem permissão para alterar transportadoras');
    const pool = getPool();
    await pool.query(`UPDATE transportadora SET status='I' WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/transportadoras/:id ─────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const pc = _permTransp(req);
    if (pc.excluir !== 'S') return negarCad(res, 'Sem permissão para excluir transportadoras');
    const pool = getPool();

    // Bloqueia se houver pedidos vinculados
    const [pedidos] = await pool.query(
      `SELECT COUNT(*) AS n FROM pedidos WHERE cod_transportadora = ? AND (excluido='N' OR excluido IS NULL OR excluido='')`,
      [req.params.id]
    ).catch(() => [[{ n: 0 }]]);

    if (pedidos[0].n > 0) {
      return res.status(409).json({ error: `Esta transportadora possui ${pedidos[0].n} pedido(s) vinculado(s) e não pode ser excluída.` });
    }

    await pool.query(`UPDATE transportadora SET excluido='S' WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/transportadoras/:id/contatos ───────────────────────────────────
router.get('/:id/contatos', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT id, comprador, telefone, ramal, setor, email
       FROM contato_clientes
       WHERE id_cliente = ? AND tipo = 'T' AND (excluido = 'N' OR excluido IS NULL OR excluido = '')
       ORDER BY id`,
      [req.params.id]
    );
    res.json({ contatos: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/transportadoras/:id/contatos ──────────────────────────────────
router.post('/:id/contatos', async (req, res) => {
  try {
    const pc = _permTransp(req);
    if (pc.incluir !== 'S') return negarCad(res, 'Sem permissão para incluir contatos');
    const pool = getPool();
    const { comprador = '', telefone = '', ramal = '', setor = '', email = '' } = req.body;
    const [result] = await pool.query(
      `INSERT INTO contato_clientes (id_cliente, tipo, comprador, telefone, ramal, setor, email, excluido)
       VALUES (?, 'T', ?, ?, ?, ?, ?, 'N')`,
      [req.params.id, comprador.toUpperCase(), telefone, ramal, setor.toUpperCase(), email]
    );
    res.json({ id: result.insertId, ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/transportadoras/:id/contatos/:cid ──────────────────────────────
router.put('/:id/contatos/:cid', async (req, res) => {
  try {
    const pc = _permTransp(req);
    if (pc.alterar !== 'S') return negarCad(res, 'Sem permissão para alterar contatos');
    const pool = getPool();
    const { comprador = '', telefone = '', ramal = '', setor = '', email = '' } = req.body;
    await pool.query(
      `UPDATE contato_clientes SET comprador=?, telefone=?, ramal=?, setor=?, email=? WHERE id=? AND id_cliente=?`,
      [comprador.toUpperCase(), telefone, ramal, setor.toUpperCase(), email, req.params.cid, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/transportadoras/:id/contatos/:cid ───────────────────────────
router.delete('/:id/contatos/:cid', async (req, res) => {
  try {
    const pc = _permTransp(req);
    if (pc.excluir !== 'S') return negarCad(res, 'Sem permissão para excluir contatos');
    const pool = getPool();
    await pool.query(
      `UPDATE contato_clientes SET excluido='S' WHERE id=? AND id_cliente=?`,
      [req.params.cid, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
