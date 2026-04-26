const express = require('express');
const router  = express.Router();
const { getPool } = require('../config/database');

async function salvarVinculosTabelas(pool, clienteId, tabelasPreco) {
  if (!Array.isArray(tabelasPreco)) return;
  try {
    await pool.query(
      `DELETE FROM tabela_preco_vinculo WHERE id_entidade = ? AND tipo_entidade = 'CLIENTE'`,
      [clienteId]
    );
    for (const t of tabelasPreco) {
      if (t.check) {
        await pool.query(
          `INSERT INTO tabela_preco_vinculo (id_entidade, id_tabela, tipo_entidade, excluido) VALUES (?, ?, 'CLIENTE', 'N')`,
          [clienteId, t.id_tabela || t.id]
        );
      }
    }
  } catch(e) {}
}

// ─── GET /api/clientes ────────────────────────────────────────────────────────
// Query params: q (busca), status (A|I|todos), limit, offset
router.get('/', async (req, res) => {
  try {
    const pool   = getPool();
    const { q = '', status = 'A', limit = 100, offset = 0,
            tipo_cliente = '', cidade = '', sem_compra_dias = '', suspensa = '',
            lat, lng, raio = 50 } = req.query;

    let where = [`(c.excluido = 'N' OR c.excluido IS NULL OR c.excluido = '')`];
    const vals = [];

    if (status === 'A') { where.push(`(c.status = 'A' OR c.status IS NULL OR c.status = '')`); }
    else if (status === 'I') { where.push(`c.status = 'I'`); }

    if (q.trim()) {
      where.push(`(LOWER(c.nome) LIKE ? OR LOWER(c.apelido) LIKE ? OR c.cpf LIKE ? OR c.foneprincipal LIKE ? OR LOWER(c.cidade) LIKE ? OR LOWER(c.bairro) LIKE ?)`);
      const like = `%${q.trim().toLowerCase()}%`;
      vals.push(like, like, like, like, like, like);
    }

    if (tipo_cliente.trim()) {
      where.push(`LOWER(c.tipo_cliente) LIKE ?`);
      vals.push(`%${tipo_cliente.trim().toLowerCase()}%`);
    }

    if (cidade.trim()) {
      where.push(`LOWER(c.cidade) LIKE ?`);
      vals.push(`%${cidade.trim().toLowerCase()}%`);
    }

    if (sem_compra_dias && parseInt(sem_compra_dias) > 0) {
      const dtLimite = new Date();
      dtLimite.setDate(dtLimite.getDate() - parseInt(sem_compra_dias));
      where.push(`(c.dtultimacompra IS NULL OR c.dtultimacompra < ?)`);
      vals.push(dtLimite.toISOString().slice(0,10));
    }

    if (suspensa === 'S') {
      where.push(`c.venda_suspensa = 'S'`);
    }

    let distanceCol = "";
    let selectVals = [];
    if (lat && lng) {
      distanceCol = `, (6371 * acos(cos(radians(?)) * cos(radians(c.latitude)) * cos(radians(c.longitude) - radians(?)) + sin(radians(?)) * sin(radians(c.latitude)))) AS distancia`;
      selectVals = [lat, lng, lat];
      
      where.push(`(6371 * acos(cos(radians(?)) * cos(radians(c.latitude)) * cos(radians(c.longitude) - radians(?)) + sin(radians(?)) * sin(radians(c.latitude)))) <= ?`);
      vals.push(lat, lng, lat, parseFloat(raio));
    }

    const whereClause = where.join(' AND ');

    const [rows] = await pool.query(
      `SELECT c.id, c.nome, c.apelido, c.tipo_pessoa, c.cpf, c.foneprincipal, c.fonesecundario,
              c.email, c.cidade, c.uf, c.bairro, c.status, c.dtultimacompra, c.dtcadastro,
              c.tipo_cliente, c.segmento, c.cod_vendedor, u.nomeusu AS nome_vendedor,
              c.credito, c.desconto, c.conceitocliente, c.venda_suspensa,
              (SELECT COUNT(p.id) FROM pedidos p WHERE p.cod_cliente = c.id AND COALESCE(p.excluido, 'N') = 'N') as total_pedidos
              ${distanceCol}
        FROM clientes c
       LEFT JOIN usuarios u ON u.idusuario = c.cod_vendedor AND u.excluido = 'N'
       WHERE ${whereClause}
       ORDER BY ${lat && lng ? 'distancia ASC' : 'c.nome'}
       LIMIT ? OFFSET ?`,
      [...selectVals, ...vals, parseInt(limit), parseInt(offset)]
    );

    const [total] = await pool.query(
      `SELECT COUNT(*) AS total FROM clientes c WHERE ${whereClause}`,
      vals
    );

    res.json({ clientes: rows, total: total[0].total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/clientes/check-cnpj ────────────────────────────────────────────
// Query params: cpf (obrigatório), excluir_id (opcional — id do cliente em edição)
// Retorna: { permiteDuplicado, duplicado, cliente }
router.get('/check-cnpj', async (req, res) => {
  try {
    const pool  = getPool();
    const { cpf, excluir_id } = req.query;

    if (!cpf?.trim()) return res.status(400).json({ error: 'CPF/CNPJ obrigatório' });

    // Verifica parâmetro gpermitecnpjduplicadoclientes na tabela sistemas
    const [sysRows] = await pool.query(
      `SELECT gpermitecnpjduplicadoclientes FROM sistemas ORDER BY id DESC LIMIT 1`
    ).catch(() => [[]]);

    const permite = (sysRows[0]?.gpermitecnpjduplicadoclientes || 'S').toUpperCase();

    // Se permite duplicados, não precisa checar
    if (permite === 'S') {
      return res.json({ permiteDuplicado: true, duplicado: false, cliente: null });
    }

    // Busca cliente com mesmo CPF/CNPJ (excluindo o próprio em caso de edição)
    const docLimpo = cpf.replace(/\D/g, '');
    let sql    = `SELECT id, nome, apelido, cpf, foneprincipal, cidade, uf, status
                  FROM clientes
                  WHERE REPLACE(REPLACE(REPLACE(cpf,'.',''),'-',''),'/','') = ?
                    AND (excluido = 'N' OR excluido IS NULL OR excluido = '')`;
    const vals = [docLimpo];

    if (excluir_id) {
      sql += ` AND id <> ?`;
      vals.push(parseInt(excluir_id, 10));
    }

    sql += ` LIMIT 1`;

    const [rows] = await pool.query(sql, vals);

    if (rows[0]) {
      return res.json({ permiteDuplicado: false, duplicado: true, cliente: rows[0] });
    }

    res.json({ permiteDuplicado: false, duplicado: false, cliente: null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/clientes/lookup/vendedores ──────────────────────────────────────
router.get('/lookup/vendedores', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT idusuario AS id, nomeusu AS nome FROM usuarios WHERE excluido='N' AND vendedor='S' ORDER BY nomeusu`
    ).catch(() => [[]]);
    res.json({ vendedores: rows });
  } catch (err) {
    res.json({ vendedores: [] });
  }
});

// ─── GET /api/clientes/notificacoes ──────────────────────────────────────────
router.get('/notificacoes', async (req, res) => {
  try {
    const pool = getPool();
    const hoje = new Date();
    const dias90 = new Date(hoje); dias90.setDate(dias90.getDate() - 90);
    const proximos7 = new Date(hoje); proximos7.setDate(hoje.getDate() + 7);

    const [inat90] = await pool.query(`
      SELECT COUNT(*) AS total FROM clientes
      WHERE (excluido='N' OR excluido IS NULL OR excluido='')
        AND (status='A' OR status IS NULL OR status='')
        AND (dtultimacompra IS NULL OR dtultimacompra < ?)
    `, [dias90.toISOString().slice(0,10)]).catch(() => [[{total:0}]]);

    const mesH = hoje.getMonth() + 1;
    const diaH = hoje.getDate();
    const mesP = proximos7.getMonth() + 1;
    const diaP = proximos7.getDate();
    let aniSql, aniVals;
    if (mesH === mesP) {
      aniSql  = `SELECT id, nome, dtnascimento FROM clientes WHERE (excluido='N' OR excluido IS NULL OR excluido='') AND dtnascimento IS NOT NULL AND MONTH(dtnascimento)=? AND DAY(dtnascimento) BETWEEN ? AND ? ORDER BY DAY(dtnascimento) LIMIT 20`;
      aniVals = [mesH, diaH, diaP];
    } else {
      aniSql  = `SELECT id, nome, dtnascimento FROM clientes WHERE (excluido='N' OR excluido IS NULL OR excluido='') AND dtnascimento IS NOT NULL AND ((MONTH(dtnascimento)=? AND DAY(dtnascimento)>=?) OR (MONTH(dtnascimento)=? AND DAY(dtnascimento)<=?)) ORDER BY MONTH(dtnascimento),DAY(dtnascimento) LIMIT 20`;
      aniVals = [mesH, diaH, mesP, diaP];
    }
    const [aniversarios] = await pool.query(aniSql, aniVals).catch(() => [[]]);

    const [novos] = await pool.query(`
      SELECT COUNT(*) AS total FROM clientes
      WHERE (excluido='N' OR excluido IS NULL OR excluido='') AND dtcadastro >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
    `).catch(() => [[{total:0}]]);

    res.json({
      inativos90dias: inat90[0]?.total || 0,
      aniversarios: aniversarios || [],
      novos7dias: novos[0]?.total || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/clientes/:id ────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT * FROM clientes WHERE id = ? AND (excluido = 'N' OR excluido IS NULL OR excluido = '') LIMIT 1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Cliente não encontrado' });
    let tabelasPreco = [];
    try {
      const [vinc] = await pool.query(
        `SELECT id_tabela FROM tabela_preco_vinculo WHERE id_entidade = ? AND tipo_entidade = 'CLIENTE' AND excluido = 'N'`,
        [req.params.id]
      );
      tabelasPreco = vinc;
    } catch(e) {}
    res.json({ ...rows[0], tabelasPreco });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/clientes ───────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const pool  = getPool();
    const body  = req.body;

    // Campos essenciais
    if (!body.nome?.trim()) return res.status(400).json({ error: 'Nome obrigatório' });

    const campos = [
      'tipo_pessoa','nome','apelido','cpf','rg','sexo','dtnascimento',
      'cep','endereco','numero_end','bairro','cidade','uf','complemento',
      'foneprincipal','fonesecundario','contato','email',
      'tipo_cliente','segmento','cod_segmento','zonavenda',
      'conceitocliente','diapgt','cod_vendedor',
      'credito','desconto','status','obsendereco','obsgerais',
      'venda_suspensa','skype','site','instagram','facebook','linkedin',
      'cobrast','icms','ipi','regiao',
      'endereco_faturamento','bairro_faturamento','cidade_faturamento',
      'cep_faturamento','uf_faturamento',
      'telefone1_faturamento','telefone2_faturamento',
      'contato_recebedor','contato_financeiro',
      'clienteprincipal','cod_clienteprincipal','nomeclienteprincipal',
      'lembrete','possuilembrete',
      'id_ramoatividades','ramoatividades',
      'tipodocumento','id_empresa'
    ].filter(c => body[c] !== undefined);

    if (campos.length === 0) return res.status(400).json({ error: 'Nenhum campo enviado' });

    const colNames  = campos.map(c => `\`${c}\``).join(', ');
    const placeholders = campos.map(() => '?').join(', ');
    const values  = campos.map(c => body[c] !== undefined ? body[c] : null);

    // Garante status padrão
    const statusIdx = campos.indexOf('status');
    let newId;
    if (statusIdx === -1) {
      campos.push('status');
      const finalCols  = campos.map(c => `\`${c}\``).join(', ');
      const finalPH    = campos.map(() => '?').join(', ');
      values.push('A');
      const [result] = await pool.query(
        `INSERT INTO clientes (${finalCols}, excluido, dtcadastro) VALUES (${finalPH}, 'N', CURDATE())`,
        values
      );
      newId = result.insertId;
    } else {
      const [result] = await pool.query(
        `INSERT INTO clientes (${colNames}, excluido, dtcadastro) VALUES (${placeholders}, 'N', CURDATE())`,
        values
      );
      newId = result.insertId;
    }
    await salvarVinculosTabelas(pool, newId, body.tabelasPreco);
    res.status(201).json({ ok: true, id: newId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/clientes/:id ────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const pool  = getPool();
    const body  = req.body;
    const { id } = req.params;

    // Verifica se o registro existe antes de atualizar
    const [existing] = await pool.query(
      `SELECT id FROM clientes WHERE id = ? AND (excluido = 'N' OR excluido IS NULL OR excluido = '') LIMIT 1`,
      [id]
    );
    if (!existing[0]) return res.status(404).json({ error: 'Cliente não encontrado' });

    if (!body.nome?.trim()) return res.status(400).json({ error: 'Nome obrigatório' });

    const campos = [
      'tipo_pessoa','nome','apelido','cpf','rg','sexo','dtnascimento',
      'cep','endereco','numero_end','bairro','cidade','uf','complemento',
      'foneprincipal','fonesecundario','contato','email',
      'tipo_cliente','segmento','cod_segmento','zonavenda',
      'conceitocliente','diapgt','cod_vendedor',
      'credito','desconto','status','obsendereco','obsgerais',
      'venda_suspensa','skype','site','instagram','facebook','linkedin',
      'cobrast','icms','ipi','regiao',
      'endereco_faturamento','bairro_faturamento','cidade_faturamento',
      'cep_faturamento','uf_faturamento',
      'telefone1_faturamento','telefone2_faturamento',
      'contato_recebedor','contato_financeiro',
      'clienteprincipal','cod_clienteprincipal','nomeclienteprincipal',
      'lembrete','possuilembrete',
      'id_ramoatividades','ramoatividades',
      'tipodocumento','id_empresa'
    ].filter(c => body[c] !== undefined);

    if (campos.length === 0) return res.status(400).json({ error: 'Nenhum campo para atualizar' });

    const setClause = campos.map(c => `\`${c}\`=?`).join(', ');
    const values    = [...campos.map(c => body[c] !== undefined ? body[c] : null), id];

    await pool.query(
      `UPDATE clientes SET ${setClause}, dtalterado=NOW() WHERE id=?`,
      values
    );
    await salvarVinculosTabelas(pool, id, body.tabelasPreco);
    res.json({ ok: true, id: parseInt(id, 10) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/clientes/:id/ativar ─────────────────────────────────────────────
router.put('/:id/ativar', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(`UPDATE clientes SET status='A', dtalterado=NOW() WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/clientes/:id/inativar ──────────────────────────────────────────
router.put('/:id/inativar', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(`UPDATE clientes SET status='I', dtalterado=NOW() WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/clientes/:id (soft delete) ───────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(
      `UPDATE clientes SET excluido='S', status='E', dtalterado=NOW() WHERE id=?`,
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/clientes/:id/financeiro ─────────────────────────────────────────
router.get('/:id/financeiro', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(`
      SELECT r.status, r.vencimento, r.valor, p.forma_pagto, p.data_abertura, p.numero as pedido
      FROM receber r
      INNER JOIN pedidos p ON r.numero = p.numero
      WHERE p.cod_cliente = ? AND (p.excluido = 'N' OR p.excluido IS NULL)
      ORDER BY r.vencimento DESC
      LIMIT 50
    `, [req.params.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/clientes/:id/historico ──────────────────────────────────────────
router.get('/:id/historico', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(`
      SELECT id, numero, data_abertura, situacao_pedido, vlrtotalpedido, tipo_pedido
      FROM pedidos
      WHERE cod_cliente = ? AND (excluido = 'N' OR excluido IS NULL)
      ORDER BY data_abertura DESC, id DESC
      LIMIT 20
    `, [req.params.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
