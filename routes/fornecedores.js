const express = require('express');
const router  = express.Router();
const { getPool } = require('../config/database');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

// ─── Multer: upload de fotos do fornecedor ────────────────────────────────────
const _uploadsBase = path.join(__dirname, '..', 'public', 'uploads', 'fornecedores');
const _storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(_uploadsBase, String(req.params.id));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `${Date.now()}_${base}${ext}`);
  }
});
const upload = multer({
  storage: _storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (req, file, cb) => {
    const ok = /\.(jpg|jpeg|png|gif|webp|bmp|svg|pdf)$/i.test(file.originalname);
    cb(ok ? null : new Error('Tipo de arquivo não permitido'), ok);
  }
});

// ─── Cache de colunas reais da tabela fornecedores ───────────────────────────
let _colunasCache = null;
async function getColunasReais(pool) {
  if (_colunasCache) return _colunasCache;
  const [cols] = await pool.query('DESCRIBE fornecedores').catch(() => [[]]);
  _colunasCache = new Set(cols.map(c => c.Field));
  return _colunasCache;
}

// Campos texto que devem ser salvos em UPPERCASE
const _camposUpper = new Set([
  'nome','apelido','rg','tipo_pessoa','tipo_cadastro','sexo',
  'cep','endereco','bairro','cidade','uf','contato',
  'segmento','obsgerais','observacaopedido','obspedido',
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

// ─── GET /api/fornecedores ────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    const { q = '', status = 'A', limit = 100, offset = 0, cidade = '', segmento = '' } = req.query;

    let where = [`(f.excluido = 'N' OR f.excluido IS NULL OR f.excluido = '')`];
    const vals = [];

    if (status === 'A')      where.push(`(f.status = 'A' OR f.status IS NULL OR f.status = '')`);
    else if (status === 'I') where.push(`f.status = 'I'`);

    if (q.trim()) {
      where.push(`(LOWER(f.nome) LIKE ? OR LOWER(f.apelido) LIKE ? OR f.cpf LIKE ? OR f.foneprincipal LIKE ? OR LOWER(f.cidade) LIKE ?)`);
      const like = `%${q.trim().toLowerCase()}%`;
      vals.push(like, like, like, like, like);
    }
    if (cidade.trim())    { where.push(`LOWER(f.cidade) LIKE ?`);    vals.push(`%${cidade.trim().toLowerCase()}%`); }
    if (segmento.trim())  { where.push(`LOWER(f.segmento) LIKE ?`);  vals.push(`%${segmento.trim().toLowerCase()}%`); }

    const whereClause = where.join(' AND ');

    const [rows] = await pool.query(
      `SELECT f.id, f.nome, f.apelido, f.cpf, f.tipo_pessoa,
              f.foneprincipal, f.email, f.contato,
              f.cidade, f.uf, f.segmento, f.status, f.dtcadastro,
              (SELECT COUNT(id) FROM pedidos WHERE cod_fornecedor = f.id AND COALESCE(excluido,'N')='N') as total_pedidos
       FROM fornecedores f
       WHERE ${whereClause}
       ORDER BY f.nome
       LIMIT ? OFFSET ?`,
      [...vals, parseInt(limit), parseInt(offset)]
    );

    const [total] = await pool.query(
      `SELECT COUNT(*) AS total FROM fornecedores f WHERE ${whereClause}`, vals
    );

    res.json({ fornecedores: rows, total: total[0].total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/fornecedores/check-cnpj ────────────────────────────────────────
router.get('/check-cnpj', async (req, res) => {
  try {
    const pool = getPool();
    const { cnpj, excluir_id } = req.query;
    if (!cnpj?.trim()) return res.status(400).json({ error: 'CPF/CNPJ obrigatório' });

    const [sysRows] = await pool.query(
      `SELECT gpermitecnpjduplicadoclientes FROM sistemas ORDER BY id DESC LIMIT 1`
    ).catch(() => [[]]);
    const permite = (sysRows[0]?.gpermitecnpjduplicadoclientes || 'S').toUpperCase();

    if (permite === 'S') return res.json({ permiteDuplicado: true, duplicado: false, fornecedor: null });

    const docLimpo = cnpj.replace(/\D/g, '');
    let sql  = `SELECT id, nome, cpf, cidade, uf, status FROM fornecedores
                WHERE REPLACE(REPLACE(REPLACE(cpf,'.',''),'-',''),'/','') = ?
                  AND (excluido='N' OR excluido IS NULL OR excluido='')`;
    const vals = [docLimpo];
    if (excluir_id) { sql += ` AND id <> ?`; vals.push(parseInt(excluir_id, 10)); }
    sql += ` LIMIT 1`;

    const [rows] = await pool.query(sql, vals);
    if (rows[0]) return res.json({ permiteDuplicado: false, duplicado: true, fornecedor: rows[0] });
    res.json({ permiteDuplicado: false, duplicado: false, fornecedor: null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/fornecedores/notificacoes ───────────────────────────────────────
router.get('/notificacoes', async (req, res) => {
  try {
    const pool = getPool();

    const [ativos] = await pool.query(`
      SELECT COUNT(*) AS total FROM fornecedores
      WHERE (excluido='N' OR excluido IS NULL OR excluido='') AND (status='A' OR status IS NULL OR status='')
    `).catch(() => [[{total:0}]]);

    const [inativos] = await pool.query(`
      SELECT COUNT(*) AS total FROM fornecedores
      WHERE (excluido='N' OR excluido IS NULL OR excluido='') AND status='I'
    `).catch(() => [[{total:0}]]);

    const [novos] = await pool.query(`
      SELECT COUNT(*) AS total FROM fornecedores
      WHERE (excluido='N' OR excluido IS NULL OR excluido='') AND dtcadastro >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
    `).catch(() => [[{total:0}]]);

    res.json({
      ativos:     ativos[0]?.total  || 0,
      inativos:   inativos[0]?.total || 0,
      novos7dias: novos[0]?.total   || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/fornecedores/lookup (simplificado) ───────────────────────────
router.get('/lookup', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT id, nome, apelido FROM fornecedores 
       WHERE (excluido='N' OR excluido IS NULL OR excluido='') 
       ORDER BY nome`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/fornecedores/tabelas-preco?cod_item=X ──────────────────────────
router.get('/tabelas-preco', async (req, res) => {
  const { cod_item } = req.query;
  try {
    const pool = getPool();
    // Busca tabelas ativas do novo sistema
    const [tabelas] = await pool.query(
      `SELECT id, Descricao as descricao, Tabela_Ativa
       FROM tabela_preco_cabecalho
       WHERE excluido = 'N' AND Tabela_Ativa = 'S'
       ORDER BY Descricao`
    ).catch(() => [[]]);

    if (!cod_item) {
      return res.json(tabelas.map(t => ({ ...t, check: false, cod_regra: null })));
    }

    // Busca vínculos na nova tabela de vinculação
    const [vincs] = await pool.query(
      `SELECT id_tabela, id FROM tabela_preco_vinculo
       WHERE excluido = 'N' AND id_entidade = ? AND tipo_entidade = 'FORNECEDOR'`,
      [cod_item]
    ).catch(() => [[]]);

    const vincMap = {};
    vincs.forEach(v => { vincMap[String(v.id_tabela)] = v.id; });

    res.json(tabelas.map(t => ({
      ...t,
      check:     !!vincMap[String(t.id)],
      cod_regra: vincMap[String(t.id)] || null
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/fornecedores/:id/tabelas-preco — salva vínculos ────────────────
router.post('/:id/tabelas-preco', async (req, res) => {
  const { id } = req.params;
  const { tabelas } = req.body;
  try {
    const pool = getPool();
    for (const tab of (tabelas || [])) {
      const idTabela = tab.id_tabela || tab.id;
      if (tab.check && !tab.cod_regra) {
        // Inclui vínculo na nova tabela
        await pool.query(
          `INSERT INTO tabela_preco_vinculo (id_entidade, id_tabela, tipo_entidade, excluido)
           VALUES (?, ?, 'FORNECEDOR', 'N')`,
          [id, idTabela]
        ).catch(() => {});
      } else if (!tab.check && tab.cod_regra) {
        // Remove vínculo na nova tabela
        await pool.query(
          `DELETE FROM tabela_preco_vinculo WHERE id = ?`,
          [tab.cod_regra]
        ).catch(() => {});
      }
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ─── GET /api/fornecedores/:id ────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT * FROM fornecedores WHERE id = ? AND (excluido='N' OR excluido IS NULL OR excluido='') LIMIT 1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Fornecedor não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/fornecedores ───────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const pool  = getPool();
    const body  = aplicarUpper(req.body);
    if (!body.nome?.trim()) return res.status(400).json({ error: 'Nome obrigatório' });

    const colunasReais = await getColunasReais(pool);

    const todosCampos = [
      'nome','apelido','cpf','rg','tipo_pessoa','tipo_cadastro','sexo',
      'cep','endereco','bairro','cidade','uf',
      'foneprincipal','fonesecundario','email','contato','site','skype',
      'segmento','cod_vendedor','comissao',
      'status','obsgerais','id_empresa',
      'exibirdescontopedido','importaprecos','importarimpostos','importaremablagens',
      'fornecedorpadraopedido','observacaopedido','obspedido',
      'consignado','logopedido','vendasduplicaritem','descontomultiplos',
      'xml_pedidovenda','peso_exibritelapedidos','manterobsped','manterprazoped',
      'tabelasunificadas','cod_fabrelgraficos','pedido_grades',
      'casasdecimaisqt','casasdecimaisvalor',
      'desconto1','desconto2','desconto3','desconto4','desconto5','desconto6',
      'desconto7','desconto8','desconto9','desconto10',
      'precoa','precob','precoc','precod','precoe','precof','precopromo','precoprincipal',
      'vlr_minimofaturamento',
      'cep_faturamento','endereco_faturamento','bairro_faturamento','cidade_faturamento',
      'uf_faturamento','telefone1_faturamento','telefone2_faturamento',
      'contato_recebedor','contato_financeiro','avisardiasfaturamento'
    ];

    const campos = todosCampos.filter(c => body[c] !== undefined && colunasReais.has(c));

    if (!campos.includes('status')) { campos.push('status'); body.status = 'A'; }

    const cols = campos.map(c => `\`${c}\``).join(', ');
    const phs  = campos.map(() => '?').join(', ');
    const vals = campos.map(c => body[c] ?? null);

    const [result] = await pool.query(
      `INSERT INTO fornecedores (${cols}, excluido, dtcadastro) VALUES (${phs}, 'N', CURDATE())`, vals
    );
    res.status(201).json({ ok: true, id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/fornecedores/:id ────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const pool = getPool();
    const { id } = req.params;
    const body = aplicarUpper(req.body);
    if (!body.nome?.trim()) return res.status(400).json({ error: 'Nome obrigatório' });

    const [existing] = await pool.query(
      `SELECT id FROM fornecedores WHERE id=? AND (excluido='N' OR excluido IS NULL OR excluido='') LIMIT 1`, [id]
    );
    if (!existing[0]) return res.status(404).json({ error: 'Fornecedor não encontrado' });

    const colunasReais = await getColunasReais(pool);

    const todosCampos = [
      'nome','apelido','cpf','rg','tipo_pessoa','tipo_cadastro','sexo',
      'cep','endereco','bairro','cidade','uf',
      'foneprincipal','fonesecundario','email','contato','site','skype',
      'segmento','cod_vendedor','comissao',
      'status','obsgerais','id_empresa',
      'exibirdescontopedido','importaprecos','importarimpostos','importaremablagens',
      'fornecedorpadraopedido','observacaopedido','obspedido',
      'consignado','logopedido','vendasduplicaritem','descontomultiplos',
      'xml_pedidovenda','peso_exibritelapedidos','manterobsped','manterprazoped',
      'tabelasunificadas','cod_fabrelgraficos','pedido_grades',
      'casasdecimaisqt','casasdecimaisvalor',
      'desconto1','desconto2','desconto3','desconto4','desconto5','desconto6',
      'desconto7','desconto8','desconto9','desconto10',
      'precoa','precob','precoc','precod','precoe','precof','precopromo','precoprincipal',
      'vlr_minimofaturamento',
      'cep_faturamento','endereco_faturamento','bairro_faturamento','cidade_faturamento',
      'uf_faturamento','telefone1_faturamento','telefone2_faturamento',
      'contato_recebedor','contato_financeiro','avisardiasfaturamento'
    ];

    const campos = todosCampos.filter(c => body[c] !== undefined && colunasReais.has(c));

    if (campos.length === 0) return res.status(400).json({ error: 'Nenhum campo para atualizar' });

    const set  = campos.map(c => `\`${c}\`=?`).join(', ');
    const vals = [...campos.map(c => body[c] ?? null), id];

    await pool.query(`UPDATE fornecedores SET ${set}, dtalterado=NOW() WHERE id=?`, vals);
    res.json({ ok: true, id: parseInt(id, 10) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/fornecedores/:id/ativar ─────────────────────────────────────────
router.put('/:id/ativar', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(`UPDATE fornecedores SET status='A', dtalterado=NOW() WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PUT /api/fornecedores/:id/inativar ──────────────────────────────────────
router.put('/:id/inativar', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(`UPDATE fornecedores SET status='I', dtalterado=NOW() WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── DELETE /api/fornecedores/:id (soft delete) ───────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(
      `UPDATE fornecedores SET excluido='S', status='E', dtalterado=NOW() WHERE id=?`,
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/fornecedores/:id/vendedores ─────────────────────────────────────
// Retorna todos os vendedores (usuários p_vender='S') com check e comissão para este fornecedor
router.get('/:id/vendedores', async (req, res) => {
  try {
    const pool = getPool();
    const { id } = req.params;

    const [todos] = await pool.query(`
      SELECT u.idusuario AS id, u.nomeusu AS nome
      FROM usuarios u
      INNER JOIN perfil p ON p.id = u.idperfil
      WHERE u.excluido = 'N' AND u.situacao = 'ATIVO' AND p.p_vender = 'S'
      ORDER BY u.nomeusu
    `).catch(() => [[]]);

    const [vincs] = await pool.query(`
      SELECT id AS id_lancamento, cod_vendedor, comissao
      FROM fornecedor_vendedor
      WHERE cod_fornecedor = ? AND excluido = 'N'
    `, [id]).catch(() => [[]]);

    const vincMap = {};
    vincs.forEach(v => { vincMap[String(v.cod_vendedor)] = v; });

    res.json(todos.map(v => ({
      id:            v.id,
      nome:          v.nome,
      check:         !!vincMap[String(v.id)],
      comissao:      vincMap[String(v.id)]?.comissao ?? '',
      id_lancamento: vincMap[String(v.id)]?.id_lancamento ?? null
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/fornecedores/:id/vendedores — salva vínculos ──────────────────
router.post('/:id/vendedores', async (req, res) => {
  const { id } = req.params;
  const { vendedores } = req.body;
  try {
    const pool = getPool();
    for (const v of (vendedores || [])) {
      if (v.check && !v.id_lancamento) {
        await pool.query(
          `INSERT INTO fornecedor_vendedor (cod_fornecedor, cod_vendedor, comissao, excluido)
           VALUES (?, ?, ?, 'N')`,
          [id, v.id, v.comissao || null]
        ).catch(() => {});
      } else if (v.check && v.id_lancamento) {
        // Atualiza comissão
        await pool.query(
          `UPDATE fornecedor_vendedor SET comissao = ? WHERE id = ?`,
          [v.comissao || null, v.id_lancamento]
        ).catch(() => {});
      } else if (!v.check && v.id_lancamento) {
        await pool.query(
          `UPDATE fornecedor_vendedor SET excluido = 'S' WHERE id = ?`,
          [v.id_lancamento]
        ).catch(() => {});
      }
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/fornecedores/:id/fotos ─────────────────────────────────────────
router.get('/:id/fotos', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT id, descricao, tipo_imagem AS tipo, principal, caminho
       FROM fornecedor_fotos
       WHERE cod_fornecedor = ? AND excluido = 'N'
       ORDER BY principal DESC, id`,
      [req.params.id]
    ).catch(() => [[]]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/fornecedores/:id/fotos — upload de arquivo ────────────────────
router.post('/:id/fotos', upload.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado' });
    const pool = getPool();
    const { id } = req.params;
    const { descricao, tipo_imagem, principal } = req.body;
    const caminho = `uploads/fornecedores/${id}/${req.file.filename}`;
    const [result] = await pool.query(
      `INSERT INTO fornecedor_fotos (cod_fornecedor, descricao, tipo_imagem, principal, caminho, excluido, dtcadastro)
       VALUES (?, ?, ?, ?, ?, 'N', CURDATE())`,
      [id, descricao || req.file.originalname, tipo_imagem || '', principal || 'N', caminho]
    );
    res.status(201).json({ ok: true, id: result.insertId, caminho });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/fornecedores/:id/fotos/:fotoId — soft delete ────────────────
router.delete('/:id/fotos/:fotoId', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT caminho FROM fornecedor_fotos WHERE id = ? AND cod_fornecedor = ? AND excluido = 'N' LIMIT 1`,
      [req.params.fotoId, req.params.id]
    );
    if (rows[0]?.caminho) {
      const abs = path.join(__dirname, '..', 'public', rows[0].caminho);
      fs.unlink(abs, () => {}); // silencioso se já não existir
    }
    await pool.query(`UPDATE fornecedor_fotos SET excluido = 'S' WHERE id = ?`, [req.params.fotoId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/fornecedores/:id/produtos — produtos vinculados ─────────────────
router.get('/:id/produtos', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(`
      SELECT fp.id, fp.cod_produto, fp.unidade, fp.embalagem,
             p.descricao AS nome_produto, p.referencia
      FROM fornecedor_produtos fp
      LEFT JOIN produtos p ON p.id = fp.cod_produto
      WHERE fp.cod_fornecedor = ? AND fp.excluido = 'N'
      ORDER BY p.descricao
    `, [req.params.id]).catch(() => [[]]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
