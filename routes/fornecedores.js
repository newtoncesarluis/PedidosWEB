const express = require('express');
const router  = express.Router();
const { getPool, runWithRequestPool } = require('../config/database');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

// ─── Multer: upload de fotos do fornecedor ────────────────────────────────────
const _uploadsBase = path.join(process.cwd(), 'public', 'uploads', 'fornecedores');
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

let _migrationDone = false;
async function ensureColumns(pool) {
  if (_migrationDone) return;
  _migrationDone = true;
  const cols = await getColunasReais(pool);
  if (!cols.has('tipo_desconto')) {
    await pool.query(`ALTER TABLE fornecedores ADD COLUMN tipo_desconto VARCHAR(20) DEFAULT 'PERCENTUAL'`).catch(() => {});
    _colunasCache = null; // invalida cache para próxima leitura
  }
  if (!cols.has('forma_pagtopadrao')) {
    await pool.query(`ALTER TABLE fornecedores ADD COLUMN forma_pagtopadrao INT(11) DEFAULT NULL`).catch(() => {});
    _colunasCache = null;
  }
  if (!cols.has('exibirtodosdesconto')) {
    await pool.query(`ALTER TABLE fornecedores ADD COLUMN exibirtodosdesconto VARCHAR(1) DEFAULT 'N'`).catch(() => {});
    _colunasCache = null;
  }
  if (!cols.has('imprimirparcelaspedido')) {
    await pool.query(`ALTER TABLE fornecedores ADD COLUMN imprimirparcelaspedido VARCHAR(1) DEFAULT 'N'`).catch(() => {});
    _colunasCache = null;
  }
  if (!cols.has('cor_obspedido')) {
    await pool.query(`ALTER TABLE fornecedores ADD COLUMN cor_obspedido VARCHAR(20) DEFAULT NULL`).catch(() => {});
    _colunasCache = null;
  }
  if (!cols.has('estilo_obspedido')) {
    await pool.query(`ALTER TABLE fornecedores ADD COLUMN estilo_obspedido VARCHAR(50) DEFAULT NULL`).catch(() => {});
    _colunasCache = null;
  }
  if (!cols.has('pedidos_codfabricante')) {
    await pool.query(`ALTER TABLE fornecedores ADD COLUMN pedidos_codfabricante VARCHAR(1) DEFAULT 'N'`).catch(() => {});
    _colunasCache = null;
  }
  if (!cols.has('tipo')) {
    await pool.query(`ALTER TABLE fornecedores ADD COLUMN tipo VARCHAR(20) DEFAULT 'FABRICA'`).catch(() => {});
    _colunasCache = null;
  }
  if (!cols.has('ipi_frete_base')) {
    await pool.query(`ALTER TABLE fornecedores ADD COLUMN ipi_frete_base CHAR(1) DEFAULT 'N'`).catch(() => {});
    _colunasCache = null;
  }
  if (!cols.has('com_sobre_ipi')) {
    await pool.query(`ALTER TABLE fornecedores ADD COLUMN com_sobre_ipi CHAR(1) DEFAULT 'S'`).catch(() => {});
    _colunasCache = null;
  }
  if (!cols.has('com_sobre_st')) {
    await pool.query(`ALTER TABLE fornecedores ADD COLUMN com_sobre_st CHAR(1) DEFAULT 'S'`).catch(() => {});
    _colunasCache = null;
  }
  if (!cols.has('com_tipo')) {
    await pool.query(`ALTER TABLE fornecedores ADD COLUMN com_tipo VARCHAR(20) DEFAULT 'PARCELADA'`).catch(() => {});
    _colunasCache = null;
  }
  if (!cols.has('tipo_num_pedido')) {
    await pool.query(`ALTER TABLE fornecedores ADD COLUMN tipo_num_pedido VARCHAR(20) DEFAULT 'SISTEMA'`).catch(() => {});
    _colunasCache = null;
  }
  if (!cols.has('base_conciliacao')) {
    await pool.query(`ALTER TABLE fornecedores ADD COLUMN base_conciliacao VARCHAR(10) DEFAULT 'PARCELA'`).catch(() => {});
    _colunasCache = null;
  }
  if (!cols.has('recalc_comissao_fatur')) {
    await pool.query(`ALTER TABLE fornecedores ADD COLUMN recalc_comissao_fatur CHAR(1) DEFAULT 'N'`).catch(() => {});
    _colunasCache = null;
  }
  if (!cols.has('min_cx_pedido')) {
    await pool.query(`ALTER TABLE fornecedores ADD COLUMN min_cx_pedido INT DEFAULT 0`).catch(() => {});
    _colunasCache = null;
  }
  if (!cols.has('enviar_pedido_fabrica')) {
    await pool.query(`ALTER TABLE fornecedores ADD COLUMN enviar_pedido_fabrica CHAR(1) DEFAULT 'N'`).catch(() => {});
    _colunasCache = null;
  }
  // Tabela de e-mails da fábrica
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fornecedor_emails (
      id INT AUTO_INCREMENT PRIMARY KEY,
      id_fornecedor INT NOT NULL,
      email VARCHAR(255) NOT NULL,
      descricao VARCHAR(100) DEFAULT NULL,
      excluido CHAR(1) DEFAULT 'N',
      dtcadastro DATE DEFAULT (CURDATE()),
      INDEX idx_fe_fornecedor (id_fornecedor)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `).catch(() => {});
  // Tabela de condições de pagamento por fornecedor
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fornecedor_condicoes_pagamento (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      id_fornecedor INT NOT NULL,
      id_condicao   INT NOT NULL,
      valor_minimo  DECIMAL(15,2) DEFAULT 0.00,
      excluido      CHAR(1) DEFAULT 'N',
      INDEX idx_forn_cond (id_fornecedor)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `).catch(() => {});
}

// Campos texto que devem ser salvos em UPPERCASE
const _camposUpper = new Set([
  'nome','apelido','rg','tipo_pessoa','tipo_cadastro','sexo',
  'cep','endereco','bairro','cidade','uf','contato',
  'segmento','obsgerais','observacaopedido','obspedido','tipo',
  'endereco_faturamento','bairro_faturamento','cidade_faturamento',
  'cep_faturamento','uf_faturamento','contato_recebedor','contato_financeiro',
  'telefone1_faturamento','telefone2_faturamento'
]);

function aplicarUpper(body) {
  const out = { ...body };
  for (const k of _camposUpper) {
    if (typeof out[k] === 'string' && out[k].trim()) {
      out[k] = out[k].trim().toUpperCase();
    }
  }
  return out;
}

// ─── GET /api/fornecedores ────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    await ensureColumns(pool);
    const { q = '', status = 'A', limit = 100, offset = 0, cidade = '', segmento = '', padrao = '', somente_fabricas = '', preposto_id = '' } = req.query;

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
    if (padrao === 'S')   { where.push(`f.fornecedorpadraopedido = 'S'`); }
    if (somente_fabricas === 'true') { where.push(`COALESCE(f.tipo, 'FABRICA') = 'FABRICA'`); }
    // Ocultar fábricas bloqueadas para o preposto informado
    if (preposto_id && parseInt(preposto_id)) {
      where.push(`NOT EXISTS (SELECT 1 FROM preposto_comissao_fornecedor pcf WHERE pcf.id_usuario = ? AND pcf.id_fornecedor = f.id AND pcf.oculta = 'S')`);
      vals.push(parseInt(preposto_id));
    }

    const whereClause = where.join(' AND ');

    const [rows] = await pool.query(
      `SELECT f.id, f.nome, f.apelido, f.cpf, f.tipo_pessoa,
              f.foneprincipal, f.email, f.contato,
              f.cidade, f.uf, f.segmento, f.status, f.dtcadastro, 
              COALESCE(f.tipo, 'FABRICA') as tipo,
              (SELECT COUNT(id) FROM pedidos WHERE cod_fornecedor = f.id AND COALESCE(excluido,'N')='N') as total_pedidos,
              (SELECT ff.caminho
                 FROM fornecedor_fotos ff
                WHERE ff.cod_fornecedor = f.id
                  AND (ff.excluido = 'N' OR ff.excluido IS NULL OR ff.excluido = '')
                  AND ff.caminho IS NOT NULL AND ff.caminho <> ''
                ORDER BY (UPPER(COALESCE(ff.tipo_imagem, '')) = 'LOGO') DESC,
                         (ff.principal = 'S') DESC, ff.id ASC
                LIMIT 1) AS foto_principal
       FROM fornecedores f
       WHERE ${whereClause}
       ORDER BY f.nome
       LIMIT ? OFFSET ?`,
      [...vals, parseInt(limit), parseInt(offset)]
    );

    rows.forEach(r => {
      if (r.foto_principal && !String(r.foto_principal).startsWith('/')) {
        r.foto_principal = '/' + r.foto_principal;
      }
    });

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

// ─── Preferências da lista (ex.: exibir fotos) ───────────────────────────────
const CREATE_PREFS_GRID = `
  CREATE TABLE IF NOT EXISTS preferencias_grid (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_usuario INT NOT NULL,
    nome_grid VARCHAR(50) NOT NULL,
    config_json TEXT NOT NULL,
    dt_alterado DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unq_user_grid (id_usuario, nome_grid)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3
`;

function parseListaConfig(raw) {
  if (!raw) return {};
  try {
    const cfg = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return cfg && typeof cfg === 'object' ? cfg : {};
  } catch (_) {
    return {};
  }
}

router.get('/config/lista', async (req, res) => {
  try {
    const id_usuario = req.user?.id;
    if (!id_usuario) return res.status(401).json({ error: 'Usuário não identificado' });
    const pool = getPool();
    await pool.query(CREATE_PREFS_GRID).catch(() => {});
    const [rows] = await pool.query(
      `SELECT config_json FROM preferencias_grid WHERE id_usuario = ? AND nome_grid = 'fornecedores_lista'`,
      [id_usuario]
    );
    res.json(parseListaConfig(rows[0]?.config_json));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/config/lista', async (req, res) => {
  try {
    const id_usuario = req.user?.id;
    if (!id_usuario) return res.status(401).json({ error: 'Usuário não identificado' });
    const pool = getPool();
    await pool.query(CREATE_PREFS_GRID).catch(() => {});
    const [rows] = await pool.query(
      `SELECT config_json FROM preferencias_grid WHERE id_usuario = ? AND nome_grid = 'fornecedores_lista'`,
      [id_usuario]
    );
    const cfg = { ...parseListaConfig(rows[0]?.config_json), ...req.body };
    const json = JSON.stringify(cfg);
    await pool.query(
      `INSERT INTO preferencias_grid (id_usuario, nome_grid, config_json, dt_alterado)
       VALUES (?, 'fornecedores_lista', ?, NOW())
       ON DUPLICATE KEY UPDATE config_json = VALUES(config_json), dt_alterado = NOW()`,
      [id_usuario, json]
    );
    res.json({ ok: true, ...cfg });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/fornecedores/lookup (simplificado) ───────────────────────────
router.get('/lookup', async (req, res) => {
  try {
    const { todostipos } = req.query;
    let tipoFilter = "AND COALESCE(tipo, 'FABRICA') = 'FABRICA'";
    if (todostipos === 'true') {
      tipoFilter = ""; // Retorna todos (usado no Contas a Pagar)
    }

    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT id, nome, apelido FROM fornecedores 
       WHERE (excluido='N' OR excluido IS NULL OR excluido='') 
       ${tipoFilter}
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


/** Caminho web da logo do fornecedor para pedido (tipo LOGO → principal → primeira). */
async function resolveFornecedorLogoCaminho(pool, idFornecedor) {
  const id = parseInt(idFornecedor, 10);
  if (!id) return null;
  const [rows] = await pool.query(
    `SELECT caminho, tipo_imagem, principal
     FROM fornecedor_fotos
     WHERE cod_fornecedor = ? AND COALESCE(excluido, 'N') = 'N'
     ORDER BY (UPPER(COALESCE(tipo_imagem, '')) = 'LOGO') DESC,
              (COALESCE(principal, 'N') = 'S') DESC,
              id ASC`,
    [id]
  ).catch(() => [[]]);
  if (!rows.length) return null;
  const pick = rows.find(r => String(r.tipo_imagem || '').toUpperCase() === 'LOGO')
    || rows.find(r => String(r.principal || '').toUpperCase() === 'S')
    || rows[0];
  let cam = String(pick?.caminho || '').trim();
  if (!cam) return null;
  if (!cam.startsWith('/')) cam = '/' + cam;
  const prefix = `/uploads/fornecedores/${id}/`;
  if (!cam.toLowerCase().startsWith(prefix.toLowerCase())) return null;
  const rel = cam.replace(/^\//, '');
  const abs = path.join(process.cwd(), 'public', rel.replace(/\//g, path.sep));
  if (!fs.existsSync(abs)) return null;
  return cam;
}

// ─── GET /api/fornecedores/:id ────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT * FROM fornecedores WHERE id = ? AND (excluido='N' OR excluido IS NULL OR excluido='') LIMIT 1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Fornecedor não encontrado' });
    const row = rows[0];
    row.logo_imagem = await resolveFornecedorLogoCaminho(pool, row.id);
    res.json(row);
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
      'tabelasunificadas','cod_fabrelgraficos','pedido_grades','fotosprodutospedido',
      'casasdecimaisqt','casasdecimaisvalor',
      'tipo_desconto','exibirtodosdesconto','forma_pagtopadrao',
      'desconto1','desconto2','desconto3','desconto4','desconto5','desconto6',
      'desconto7','desconto8','desconto9','desconto10',
      'precoa','precob','precoc','precod','precoe','precof','precopromo','precoprincipal',
      'vlr_minimofaturamento',
      'cep_faturamento','endereco_faturamento','bairro_faturamento','cidade_faturamento',
      'uf_faturamento','telefone1_faturamento','telefone2_faturamento',
      'contato_recebedor','contato_financeiro','avisardiasfaturamento',
      'imprimirparcelaspedido','cor_obspedido','estilo_obspedido',
      'pedidos_codfabricante',
      'tipo',
      'ipi_frete_base','com_sobre_ipi','com_sobre_st','com_tipo','tipo_num_pedido','base_conciliacao',
      'min_cx_pedido','recalc_comissao_fatur','enviar_pedido_fabrica'
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
      'tabelasunificadas','cod_fabrelgraficos','pedido_grades','fotosprodutospedido',
      'casasdecimaisqt','casasdecimaisvalor',
      'tipo_desconto','exibirtodosdesconto','forma_pagtopadrao',
      'desconto1','desconto2','desconto3','desconto4','desconto5','desconto6',
      'desconto7','desconto8','desconto9','desconto10',
      'precoa','precob','precoc','precod','precoe','precof','precopromo','precoprincipal',
      'vlr_minimofaturamento',
      'cep_faturamento','endereco_faturamento','bairro_faturamento','cidade_faturamento',
      'uf_faturamento','telefone1_faturamento','telefone2_faturamento',
      'contato_recebedor','contato_financeiro','avisardiasfaturamento',
      'imprimirparcelaspedido','cor_obspedido','estilo_obspedido',
      'pedidos_codfabricante',
      'tipo',
      'ipi_frete_base','com_sobre_ipi','com_sobre_st','com_tipo','tipo_num_pedido','base_conciliacao',
      'min_cx_pedido','recalc_comissao_fatur','enviar_pedido_fabrica'
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
       WHERE cod_fornecedor = ? AND COALESCE(excluido, 'N') = 'N'
       ORDER BY (UPPER(COALESCE(tipo_imagem, '')) = 'LOGO') DESC,
                (COALESCE(principal, 'N') = 'S') DESC,
                id ASC`,
      [req.params.id]
    ).catch(() => [[]]);
    const out = rows.map((r) => {
      let cam = String(r.caminho || '').trim();
      if (cam && !cam.startsWith('/')) cam = '/' + cam;
      return { ...r, caminho: cam };
    });
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/fornecedores/:id/fotos — upload de arquivo ────────────────────
router.post('/:id/fotos', upload.single('arquivo'), async (req, res) => {
  const handler = async () => {
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
  };

  try {
    return runWithRequestPool(req, handler);
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
      const abs = path.join(process.cwd(), 'public', rows[0].caminho);
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

// ─── GET /api/fornecedores/:id/condicoes-pagamento ───────────────────────────
router.get('/:id/condicoes-pagamento', async (req, res) => {
  try {
    const pool = getPool();
    await ensureColumns(pool);
    const [rows] = await pool.query(`
      SELECT fcp.id, fcp.id_condicao, fcp.valor_minimo,
             fp.descricao, fp.prazopadrao
      FROM fornecedor_condicoes_pagamento fcp
      INNER JOIN forma_pagto fp ON fp.id = fcp.id_condicao
      WHERE fcp.id_fornecedor = ? AND fcp.excluido = 'N'
      ORDER BY fp.descricao
    `, [req.params.id]).catch(() => [[]]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST /api/fornecedores/:id/condicoes-pagamento — substitui lista ────────
router.post('/:id/condicoes-pagamento', async (req, res) => {
  const { id } = req.params;
  const { condicoes = [] } = req.body; // [{ id_condicao, valor_minimo }]
  try {
    const pool = getPool();
    await ensureColumns(pool);
    await pool.query(
      `UPDATE fornecedor_condicoes_pagamento SET excluido='S' WHERE id_fornecedor=?`, [id]
    );
    for (const c of condicoes) {
      if (!c.id_condicao) continue;
      const [ex] = await pool.query(
        `SELECT id FROM fornecedor_condicoes_pagamento WHERE id_fornecedor=? AND id_condicao=? LIMIT 1`,
        [id, c.id_condicao]
      );
      if (ex.length) {
        await pool.query(
          `UPDATE fornecedor_condicoes_pagamento SET excluido='N', valor_minimo=? WHERE id=?`,
          [parseFloat(c.valor_minimo) || 0, ex[0].id]
        );
      } else {
        await pool.query(
          `INSERT INTO fornecedor_condicoes_pagamento (id_fornecedor, id_condicao, valor_minimo, excluido) VALUES (?,?,?,'N')`,
          [id, c.id_condicao, parseFloat(c.valor_minimo) || 0]
        );
      }
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/fornecedores/:id/emails ────────────────────────────────────────
router.get('/:id/emails', async (req, res) => {
  try {
    const pool = getPool();
    await ensureColumns(pool);
    const [rows] = await pool.query(
      `SELECT id, email, descricao FROM fornecedor_emails
       WHERE id_fornecedor = ? AND excluido = 'N'
       ORDER BY id`,
      [req.params.id]
    ).catch(() => [[]]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST /api/fornecedores/:id/emails — adiciona e-mail ─────────────────────
router.post('/:id/emails', async (req, res) => {
  const { id } = req.params;
  const { email, descricao } = req.body;
  if (!email?.trim()) return res.status(400).json({ error: 'E-mail obrigatório' });
  try {
    const pool = getPool();
    await ensureColumns(pool);
    const [result] = await pool.query(
      `INSERT INTO fornecedor_emails (id_fornecedor, email, descricao, excluido, dtcadastro)
       VALUES (?, ?, ?, 'N', CURDATE())`,
      [id, email.trim().toLowerCase(), (descricao || '').trim() || null]
    );
    res.status(201).json({ ok: true, id: result.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PUT /api/fornecedores/:id/emails/:emailId — edita e-mail ────────────────
router.put('/:id/emails/:emailId', async (req, res) => {
  const { emailId } = req.params;
  const { email, descricao } = req.body;
  if (!email?.trim()) return res.status(400).json({ error: 'E-mail obrigatório' });
  try {
    const pool = getPool();
    await pool.query(
      `UPDATE fornecedor_emails SET email=?, descricao=? WHERE id=? AND id_fornecedor=?`,
      [email.trim().toLowerCase(), (descricao || '').trim() || null, emailId, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── DELETE /api/fornecedores/:id/emails/:emailId — remove e-mail ────────────
router.delete('/:id/emails/:emailId', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(
      `UPDATE fornecedor_emails SET excluido='S' WHERE id=? AND id_fornecedor=?`,
      [req.params.emailId, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
