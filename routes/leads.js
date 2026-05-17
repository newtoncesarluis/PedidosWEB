const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS leads (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL DEFAULT 1,
    id_usuario INT NOT NULL DEFAULT 0,
    id_vendedor INT NULL,
    nome VARCHAR(150) NOT NULL,
    empresa VARCHAR(150) NOT NULL DEFAULT '',
    telefone VARCHAR(30) NOT NULL DEFAULT '',
    whatsapp VARCHAR(30) NOT NULL DEFAULT '',
    email VARCHAR(150) NOT NULL DEFAULT '',
    instagram VARCHAR(120) NOT NULL DEFAULT '',
    facebook VARCHAR(120) NOT NULL DEFAULT '',
    cidade VARCHAR(100) NOT NULL DEFAULT '',
    uf VARCHAR(2) NOT NULL DEFAULT '',
    segmento VARCHAR(120) NOT NULL DEFAULT '',
    cargo VARCHAR(100) NOT NULL DEFAULT '',
    origem VARCHAR(60) NOT NULL DEFAULT 'Manual',
    campanha VARCHAR(120) NOT NULL DEFAULT '',
    anuncio VARCHAR(120) NOT NULL DEFAULT '',
    interesse VARCHAR(150) NOT NULL DEFAULT '',
    produto_interesse VARCHAR(150) NOT NULL DEFAULT '',
    score INT NOT NULL DEFAULT 0,
    temperatura_lead VARCHAR(20) NOT NULL DEFAULT 'FRIO',
    prioridade VARCHAR(20) NOT NULL DEFAULT 'MEDIA',
    canal_atendimento VARCHAR(40) NOT NULL DEFAULT 'COMERCIAL',
    status_funil VARCHAR(30) NOT NULL DEFAULT 'NOVO',
    motivo_perda VARCHAR(255) NOT NULL DEFAULT '',
    valor_estimado DECIMAL(14,2) NOT NULL DEFAULT 0,
    tags VARCHAR(255) NOT NULL DEFAULT '',
    observacoes TEXT NULL,
    data_ultimo_contato DATETIME NULL,
    data_proximo_contato DATE NULL,
    convertido_cliente_id INT NULL,
    convertido_pedido_id INT NULL,
    data_conversao DATETIME NULL,
    excluido CHAR(1) NOT NULL DEFAULT 'N',
    dtcadastro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    dtalterado DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_leads_status (status_funil),
    INDEX idx_leads_vendedor (id_vendedor),
    INDEX idx_leads_empresa (id_empresa),
    INDEX idx_leads_convertido (convertido_cliente_id),
    INDEX idx_leads_origem (origem),
    INDEX idx_leads_prioridade (prioridade)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const CREATE_TAREFAS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS lead_tarefas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    lead_id INT NOT NULL,
    id_empresa INT NOT NULL DEFAULT 1,
    id_usuario INT NOT NULL DEFAULT 0,
    id_responsavel INT NULL,
    titulo VARCHAR(200) NOT NULL,
    descricao TEXT,
    data_vencimento DATE NULL,
    hora_vencimento TIME NULL,
    prioridade ENUM('ALTA','MEDIA','BAIXA') NOT NULL DEFAULT 'MEDIA',
    status ENUM('PENDENTE','CONCLUIDA','CANCELADA') NOT NULL DEFAULT 'PENDENTE',
    dtcadastro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    dtconclusao DATETIME NULL,
    excluido CHAR(1) NOT NULL DEFAULT 'N',
    INDEX idx_tarefas_lead (lead_id),
    INDEX idx_tarefas_empresa (id_empresa),
    INDEX idx_tarefas_responsavel (id_responsavel),
    INDEX idx_tarefas_vencimento (data_vencimento),
    INDEX idx_tarefas_status (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const CREATE_HISTORY_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS lead_historico (
    id INT AUTO_INCREMENT PRIMARY KEY,
    lead_id INT NOT NULL,
    id_usuario INT NOT NULL DEFAULT 0,
    tipo VARCHAR(30) NOT NULL DEFAULT 'NOTA',
    descricao TEXT NOT NULL,
    dtcadastro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_lead_historico_lead (lead_id),
    INDEX idx_lead_historico_tipo (tipo)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const REQUIRED_COLUMNS = {
  whatsapp: "ALTER TABLE leads ADD COLUMN whatsapp VARCHAR(30) NOT NULL DEFAULT '' AFTER telefone",
  instagram: "ALTER TABLE leads ADD COLUMN instagram VARCHAR(120) NOT NULL DEFAULT '' AFTER email",
  facebook: "ALTER TABLE leads ADD COLUMN facebook VARCHAR(120) NOT NULL DEFAULT '' AFTER instagram",
  segmento: "ALTER TABLE leads ADD COLUMN segmento VARCHAR(120) NOT NULL DEFAULT '' AFTER uf",
  cargo: "ALTER TABLE leads ADD COLUMN cargo VARCHAR(100) NOT NULL DEFAULT '' AFTER segmento",
  campanha: "ALTER TABLE leads ADD COLUMN campanha VARCHAR(120) NOT NULL DEFAULT '' AFTER origem",
  anuncio: "ALTER TABLE leads ADD COLUMN anuncio VARCHAR(120) NOT NULL DEFAULT '' AFTER campanha",
  produto_interesse: "ALTER TABLE leads ADD COLUMN produto_interesse VARCHAR(150) NOT NULL DEFAULT '' AFTER interesse",
  score: "ALTER TABLE leads ADD COLUMN score INT NOT NULL DEFAULT 0 AFTER produto_interesse",
  temperatura_lead: "ALTER TABLE leads ADD COLUMN temperatura_lead VARCHAR(20) NOT NULL DEFAULT 'FRIO' AFTER score",
  prioridade: "ALTER TABLE leads ADD COLUMN prioridade VARCHAR(20) NOT NULL DEFAULT 'MEDIA' AFTER temperatura_lead",
  canal_atendimento: "ALTER TABLE leads ADD COLUMN canal_atendimento VARCHAR(40) NOT NULL DEFAULT 'COMERCIAL' AFTER prioridade",
  motivo_perda: "ALTER TABLE leads ADD COLUMN motivo_perda VARCHAR(255) NOT NULL DEFAULT '' AFTER status_funil",
  valor_estimado: "ALTER TABLE leads ADD COLUMN valor_estimado DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER motivo_perda",
  tags: "ALTER TABLE leads ADD COLUMN tags VARCHAR(255) NOT NULL DEFAULT '' AFTER valor_estimado",
  data_ultimo_contato: "ALTER TABLE leads ADD COLUMN data_ultimo_contato DATETIME NULL AFTER observacoes",
  convertido_pedido_id: "ALTER TABLE leads ADD COLUMN convertido_pedido_id INT NULL AFTER convertido_cliente_id"
};

async function ensureColumns(pool) {
  const [rows] = await pool.query('SHOW COLUMNS FROM leads');
  const existing = new Set(rows.map(r => r.Field));
  for (const [field, sql] of Object.entries(REQUIRED_COLUMNS)) {
    if (!existing.has(field)) {
      await pool.query(sql).catch(() => {});
    }
  }
}

async function ensureTable() {
  const pool = getPool();
  try { await pool.query(CREATE_TABLE_SQL); } catch (_) {}
  try { await ensureColumns(pool); } catch (_) {}
  try { await pool.query(CREATE_HISTORY_TABLE_SQL); } catch (_) {}
  try { await pool.query(CREATE_TAREFAS_TABLE_SQL); } catch (_) {}
}

function normalizeStatus(value) {
  const allowed = ['NOVO', 'CONTATO', 'QUALIFICADO', 'PROPOSTA', 'GANHO', 'PERDIDO'];
  const normalized = String(value || 'NOVO').trim().toUpperCase();
  return allowed.includes(normalized) ? normalized : 'NOVO';
}

function normalizePriority(value) {
  const allowed = ['ALTA', 'MEDIA', 'BAIXA'];
  const normalized = String(value || 'MEDIA').trim().toUpperCase();
  return allowed.includes(normalized) ? normalized : 'MEDIA';
}

function normalizeTemperature(value) {
  const allowed = ['QUENTE', 'MORNO', 'FRIO'];
  const normalized = String(value || '').trim().toUpperCase();
  return allowed.includes(normalized) ? normalized : '';
}

function deriveTemperature(payload) {
  const explicit = normalizeTemperature(payload.temperatura_lead);
  if (explicit) return explicit;
  const score = Number(payload.score || 0);
  if (score >= 80) return 'QUENTE';
  if (score >= 45) return 'MORNO';
  return 'FRIO';
}

function parseMoney(value) {
  const raw = String(value ?? '').trim().replace(/\./g, '').replace(',', '.');
  const num = Number(raw);
  return Number.isFinite(num) ? num : 0;
}

function cleanString(value, max = null) {
  const text = String(value || '').trim();
  return max ? text.slice(0, max) : text;
}

async function addHistory(pool, leadId, userId, tipo, descricao) {
  await pool.query(
    `INSERT INTO lead_historico (lead_id, id_usuario, tipo, descricao)
     VALUES (?, ?, ?, ?)`,
    [leadId, parseInt(userId || 0, 10), tipo, descricao]
  ).catch(() => {});
}

function buildPayload(body, user) {
  const score = Math.max(0, Math.min(parseInt(body.score || 0, 10) || 0, 100));
  const status = normalizeStatus(body.status_funil);
  return {
    id_empresa: parseInt(user.id_empresa || body.id_empresa || 1, 10),
    id_usuario: parseInt(user.idusuario || user.id || 0, 10),
    id_vendedor: body.id_vendedor ? parseInt(body.id_vendedor, 10) : null,
    nome: cleanString(body.nome, 150),
    empresa: cleanString(body.empresa, 150),
    telefone: cleanString(body.telefone, 30),
    whatsapp: cleanString(body.whatsapp || body.telefone, 30),
    email: cleanString(body.email, 150),
    instagram: cleanString(body.instagram, 120),
    facebook: cleanString(body.facebook, 120),
    cidade: cleanString(body.cidade, 100),
    uf: cleanString(body.uf, 2).toUpperCase(),
    segmento: cleanString(body.segmento, 120),
    cargo: cleanString(body.cargo, 100),
    origem: cleanString(body.origem || 'Manual', 60) || 'Manual',
    campanha: cleanString(body.campanha, 120),
    anuncio: cleanString(body.anuncio, 120),
    interesse: cleanString(body.interesse, 150),
    produto_interesse: cleanString(body.produto_interesse || body.interesse, 150),
    score,
    temperatura_lead: deriveTemperature({ ...body, score }),
    prioridade: normalizePriority(body.prioridade),
    canal_atendimento: cleanString(body.canal_atendimento || 'COMERCIAL', 40) || 'COMERCIAL',
    status_funil: status,
    motivo_perda: status === 'PERDIDO' ? cleanString(body.motivo_perda, 255) : '',
    valor_estimado: parseMoney(body.valor_estimado),
    tags: cleanString(body.tags, 255),
    observacoes: body.observacoes ? String(body.observacoes) : '',
    data_ultimo_contato: body.data_ultimo_contato || null,
    data_proximo_contato: body.data_proximo_contato || null,
  };
}

router.get('/lookup/vendedores', async (req, res) => {
  await ensureTable();
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT idusuario AS id, nomeusu AS nome
       FROM usuarios
       WHERE excluido='N' AND vendedor='S'
       ORDER BY nomeusu`
    ).catch(() => [[]]);
    res.json({ vendedores: rows || [] });
  } catch (_) {
    res.json({ vendedores: [] });
  }
});

router.get('/', async (req, res) => {
  await ensureTable();
  try {
    const pool = getPool();
    const user = req.user || {};
    const idEmpresa = parseInt(user.id_empresa || req.query.id_empresa || 1, 10);
    const page = Math.max(parseInt(req.query.page || 1, 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || 50, 10), 1), 1000);
    const offset = (page - 1) * limit;
    const q = cleanString(req.query.q);
    const status = normalizeStatus(req.query.status || '').replace('NOVO', req.query.status ? 'NOVO' : '');
    const idVendedor = cleanString(req.query.id_vendedor);
    const origem = cleanString(req.query.origem, 60);
    const prioridade = normalizePriority(req.query.prioridade || '').replace('MEDIA', req.query.prioridade ? 'MEDIA' : '');
    const temperatura = normalizeTemperature(req.query.temperatura_lead || '');

    const conds = ["l.excluido='N'", 'l.id_empresa=?'];
    const params = [idEmpresa];

    if (user.perfil !== '1' && user.role !== 'admin') {
      const userId = parseInt(user.idusuario || user.id || 0, 10);
      if (userId) {
        conds.push('(l.id_vendedor = ? OR l.id_usuario = ?)');
        params.push(userId, userId);
      }
    } else if (idVendedor) {
      conds.push('l.id_vendedor = ?');
      params.push(idVendedor);
    }

    if (q) {
      const like = `%${q.toLowerCase()}%`;
      conds.push(`(
        LOWER(l.nome) LIKE ? OR LOWER(l.empresa) LIKE ? OR l.telefone LIKE ? OR l.whatsapp LIKE ? OR
        LOWER(l.email) LIKE ? OR LOWER(l.cidade) LIKE ? OR LOWER(l.interesse) LIKE ? OR
        LOWER(l.produto_interesse) LIKE ? OR LOWER(l.campanha) LIKE ? OR LOWER(l.anuncio) LIKE ? OR LOWER(l.tags) LIKE ?
      )`);
      params.push(like, like, `%${q}%`, `%${q}%`, like, like, like, like, like, like, like);
    }

    if (req.query.status) {
      conds.push('l.status_funil = ?');
      params.push(normalizeStatus(req.query.status));
    }
    if (origem) {
      conds.push('l.origem = ?');
      params.push(origem);
    }
    if (req.query.prioridade) {
      conds.push('l.prioridade = ?');
      params.push(normalizePriority(req.query.prioridade));
    }
    if (temperatura) {
      conds.push('l.temperatura_lead = ?');
      params.push(temperatura);
    }

    const where = conds.join(' AND ');

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM leads l WHERE ${where}`,
      params
    );

    const [rows] = await pool.query(
      `SELECT l.*,
              u.nomeusu AS nome_vendedor,
              c.nome AS nome_cliente_convertido,
              COALESCE(tp.pendentes, 0) AS tarefas_pendentes,
              COALESCE(tv.vencidas, 0)  AS tarefas_vencidas
       FROM leads l
       LEFT JOIN usuarios u ON u.idusuario = l.id_vendedor
       LEFT JOIN clientes c ON c.id = l.convertido_cliente_id
       LEFT JOIN (
         SELECT lead_id, COUNT(*) AS pendentes
         FROM lead_tarefas WHERE status='PENDENTE' AND excluido='N'
         GROUP BY lead_id
       ) tp ON tp.lead_id = l.id
       LEFT JOIN (
         SELECT lead_id, COUNT(*) AS vencidas
         FROM lead_tarefas WHERE status='PENDENTE' AND excluido='N' AND data_vencimento < CURDATE()
         GROUP BY lead_id
       ) tv ON tv.lead_id = l.id
       WHERE ${where}
       ORDER BY
         CASE l.status_funil
           WHEN 'NOVO' THEN 1
           WHEN 'CONTATO' THEN 2
           WHEN 'QUALIFICADO' THEN 3
           WHEN 'PROPOSTA' THEN 4
           WHEN 'GANHO' THEN 5
           WHEN 'PERDIDO' THEN 6
           ELSE 9
         END,
         CASE l.prioridade
           WHEN 'ALTA' THEN 1
           WHEN 'MEDIA' THEN 2
           WHEN 'BAIXA' THEN 3
           ELSE 9
         END,
         COALESCE(l.data_proximo_contato, DATE(l.dtcadastro)) ASC,
         l.id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({ total, leads: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  await ensureTable();
  try {
    const pool = getPool();
    const [[row]] = await pool.query(
      `SELECT * FROM leads WHERE id = ? AND excluido='N' LIMIT 1`,
      [req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'Lead não encontrado' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/historico', async (req, res) => {
  await ensureTable();
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT h.*, u.nomeusu AS nome_usuario
       FROM lead_historico h
       LEFT JOIN usuarios u ON u.idusuario = h.id_usuario
       WHERE h.lead_id = ?
       ORDER BY h.id DESC
       LIMIT 100`,
      [req.params.id]
    );
    res.json({ historico: rows || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/historico', async (req, res) => {
  await ensureTable();
  try {
    const pool = getPool();
    const user = req.user || {};
    const descricao = cleanString(req.body?.descricao);
    if (!descricao) return res.status(400).json({ error: 'Descrição obrigatória' });

    const [existing] = await pool.query(`SELECT id FROM leads WHERE id = ? AND excluido='N' LIMIT 1`, [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Lead não encontrado' });

    await addHistory(pool, req.params.id, user.idusuario || user.id || 0, 'NOTA', descricao);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  await ensureTable();
  try {
    const pool = getPool();
    const user = req.user || {};
    const payload = buildPayload(req.body || {}, user);

    if (!payload.nome) return res.status(400).json({ error: 'Nome obrigatório' });

    const [result] = await pool.query(
      `INSERT INTO leads (
        id_empresa, id_usuario, id_vendedor, nome, empresa, telefone, whatsapp, email, instagram, facebook,
        cidade, uf, segmento, cargo, origem, campanha, anuncio, interesse, produto_interesse, score,
        temperatura_lead, prioridade, canal_atendimento, status_funil, motivo_perda, valor_estimado, tags,
        observacoes, data_ultimo_contato, data_proximo_contato
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.id_empresa, payload.id_usuario, payload.id_vendedor, payload.nome, payload.empresa,
        payload.telefone, payload.whatsapp, payload.email, payload.instagram, payload.facebook,
        payload.cidade, payload.uf, payload.segmento, payload.cargo, payload.origem, payload.campanha,
        payload.anuncio, payload.interesse, payload.produto_interesse, payload.score, payload.temperatura_lead,
        payload.prioridade, payload.canal_atendimento, payload.status_funil, payload.motivo_perda, payload.valor_estimado,
        payload.tags, payload.observacoes, payload.data_ultimo_contato, payload.data_proximo_contato
      ]
    );

    await addHistory(pool, result.insertId, payload.id_usuario, 'CRIACAO', `Lead criado com estágio inicial ${payload.status_funil}.`);
    res.status(201).json({ ok: true, id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  await ensureTable();
  try {
    const pool = getPool();
    const user = req.user || {};
    const payload = buildPayload(req.body || {}, user);
    if (!payload.nome) return res.status(400).json({ error: 'Nome obrigatório' });

    const [existing] = await pool.query(
      `SELECT id, convertido_cliente_id FROM leads WHERE id = ? AND excluido='N' LIMIT 1`,
      [req.params.id]
    );
    if (!existing[0]) return res.status(404).json({ error: 'Lead não encontrado' });

    await pool.query(
      `UPDATE leads
       SET id_vendedor = ?, nome = ?, empresa = ?, telefone = ?, whatsapp = ?, email = ?, instagram = ?, facebook = ?,
           cidade = ?, uf = ?, segmento = ?, cargo = ?, origem = ?, campanha = ?, anuncio = ?, interesse = ?,
           produto_interesse = ?, score = ?, temperatura_lead = ?, prioridade = ?, canal_atendimento = ?,
           status_funil = ?, motivo_perda = ?, valor_estimado = ?, tags = ?, observacoes = ?,
           data_ultimo_contato = ?, data_proximo_contato = ?
       WHERE id = ?`,
      [
        payload.id_vendedor, payload.nome, payload.empresa, payload.telefone, payload.whatsapp, payload.email,
        payload.instagram, payload.facebook, payload.cidade, payload.uf, payload.segmento, payload.cargo,
        payload.origem, payload.campanha, payload.anuncio, payload.interesse, payload.produto_interesse,
        payload.score, payload.temperatura_lead, payload.prioridade, payload.canal_atendimento, payload.status_funil,
        payload.motivo_perda, payload.valor_estimado, payload.tags, payload.observacoes,
        payload.data_ultimo_contato, payload.data_proximo_contato, req.params.id
      ]
    );

    await addHistory(pool, req.params.id, user.idusuario || user.id || 0, 'ATUALIZACAO', `Lead atualizado. Estágio atual: ${payload.status_funil}.`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/converter', async (req, res) => {
  await ensureTable();
  try {
    const pool = getPool();
    const user = req.user || {};
    const [[lead]] = await pool.query(`SELECT * FROM leads WHERE id = ? AND excluido='N' LIMIT 1`, [req.params.id]);

    if (!lead) return res.status(404).json({ error: 'Lead não encontrado' });
    if (lead.convertido_cliente_id) return res.status(400).json({ error: 'Este lead já foi convertido em cliente' });

    const nomeCliente = cleanString(lead.empresa) || cleanString(lead.nome);
    const contato = cleanString(lead.nome);
    const observacaoConversao = [
      `Convertido do lead #${lead.id} em ${new Date().toLocaleString('pt-BR')}.`,
      lead.origem ? `Origem: ${lead.origem}` : '',
      lead.campanha ? `Campanha: ${lead.campanha}` : '',
      lead.anuncio ? `Anúncio: ${lead.anuncio}` : '',
      lead.observacoes ? `Observações do lead: ${lead.observacoes}` : ''
    ].filter(Boolean).join('\n\n');

    const [result] = await pool.query(
      `INSERT INTO clientes (
        nome, apelido, contato, foneprincipal, email, cidade, uf,
        tipo_pessoa, tipo_cliente, cod_vendedor, status, obsgerais,
        id_empresa, excluido, dtcadastro
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'N', CURDATE())`,
      [
        nomeCliente,
        lead.empresa ? contato : '',
        contato,
        lead.whatsapp || lead.telefone || '',
        lead.email || '',
        lead.cidade || '',
        lead.uf || '',
        lead.empresa ? 'J' : 'F',
        'LEAD',
        lead.id_vendedor || parseInt(user.idusuario || user.id || 0, 10) || null,
        'A',
        observacaoConversao,
        parseInt(lead.id_empresa || 1, 10)
      ]
    );

    await pool.query(
      `UPDATE leads
       SET status_funil = 'GANHO',
           convertido_cliente_id = ?,
           data_conversao = NOW()
       WHERE id = ?`,
      [result.insertId, req.params.id]
    );

    await addHistory(pool, req.params.id, user.idusuario || user.id || 0, 'CONVERSAO', `Lead convertido no cliente #${result.insertId}.`);
    res.json({ ok: true, cliente_id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/importar', async (req, res) => {
  await ensureTable();
  try {
    const pool = getPool();
    const user = req.user || {};
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ error: 'Nenhum dado enviado' });
    let ok = 0;
    const erros = [];
    for (const row of rows) {
      try {
        const payload = buildPayload({ origem: 'Importação Excel', ...row }, user);
        if (!payload.nome) { erros.push({ nome: row.nome || '(sem nome)', erro: 'Nome vazio' }); continue; }
        const [r] = await pool.query(
          `INSERT INTO leads (
            id_empresa, id_usuario, id_vendedor, nome, empresa, telefone, whatsapp, email, instagram, facebook,
            cidade, uf, segmento, cargo, origem, campanha, anuncio, interesse, produto_interesse, score,
            temperatura_lead, prioridade, canal_atendimento, status_funil, motivo_perda, valor_estimado, tags,
            observacoes, data_ultimo_contato, data_proximo_contato
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            payload.id_empresa, payload.id_usuario, payload.id_vendedor, payload.nome, payload.empresa,
            payload.telefone, payload.whatsapp, payload.email, payload.instagram, payload.facebook,
            payload.cidade, payload.uf, payload.segmento, payload.cargo, payload.origem, payload.campanha,
            payload.anuncio, payload.interesse, payload.produto_interesse, payload.score, payload.temperatura_lead,
            payload.prioridade, payload.canal_atendimento, payload.status_funil, payload.motivo_perda, payload.valor_estimado,
            payload.tags, payload.observacoes, payload.data_ultimo_contato, payload.data_proximo_contato
          ]
        );
        await addHistory(pool, r.insertId, payload.id_usuario, 'CRIACAO', `Lead importado via planilha Excel.`);
        ok++;
      } catch (e) {
        erros.push({ nome: row.nome || '(sem nome)', erro: e.message });
      }
    }
    res.json({ ok, erros, total: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/leads/por-cliente/:clienteId — busca lead vinculado a um cliente convertido
router.get('/por-cliente/:clienteId', async (req, res) => {
  await ensureTable();
  try {
    const [[lead]] = await getPool().query(
      `SELECT id, nome, empresa, status_funil, origem, score, temperatura_lead, data_conversao
       FROM leads WHERE convertido_cliente_id=? AND excluido='N' LIMIT 1`,
      [req.params.clienteId]
    );
    res.json({ lead: lead || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/leads/:id/whatsapp — envia mensagem via Evolution API do usuário logado
router.post('/:id/whatsapp', async (req, res) => {
  await ensureTable();
  try {
    const pool = getPool();
    const user = req.user || {};
    const { mensagem } = req.body;
    if (!mensagem) return res.status(400).json({ error: 'Mensagem obrigatória' });

    const [[lead]] = await pool.query(
      `SELECT id, nome, whatsapp, telefone FROM leads WHERE id=? AND excluido='N'`, [req.params.id]
    );
    if (!lead) return res.status(404).json({ error: 'Lead não encontrado' });
    const numero = lead.whatsapp || lead.telefone;
    if (!numero) return res.status(400).json({ error: 'Lead sem número de WhatsApp' });

    const [[urow]] = await pool.query(
      `SELECT instancia, chave FROM usuarios WHERE idusuario=? AND COALESCE(excluido,'N')='N' LIMIT 1`,
      [user.id || 0]
    );
    if (!urow?.instancia) return res.status(400).json({ error: 'Usuário sem instância WhatsApp configurada. Configure em Configurações → WhatsApp.' });

    const [[cfg]] = await pool.query(
      `SELECT w_urlplataforma AS url, w_apiglobal AS apikey FROM configuracao LIMIT 1`
    );
    if (!cfg?.url) return res.status(400).json({ error: 'Evolution API não configurada no sistema.' });

    const axios = require('axios');
    const base = cfg.url.endsWith('/') ? cfg.url.slice(0, -1) : cfg.url;
    const resp = await axios.post(
      `${base}/message/sendText/${urow.instancia}`,
      { number: numero.replace(/\D/g, ''), text: mensagem },
      { headers: { 'Content-Type': 'application/json', apikey: urow.chave || cfg.apikey }, timeout: 15000 }
    );
    if (resp.status === 200 || resp.status === 201) {
      await addHistory(pool, req.params.id, user.id || 0, 'NOTA',
        `WhatsApp enviado: "${mensagem.slice(0, 120)}${mensagem.length > 120 ? '…' : ''}"`);
      res.json({ ok: true });
    } else {
      res.status(500).json({ error: `Erro Evolution API: ${resp.status}` });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/leads/:id/email — envia email usando SMTP do usuário (ou global como fallback)
router.post('/:id/email', async (req, res) => {
  await ensureTable();
  try {
    const pool = getPool();
    const user = req.user || {};
    const { assunto, corpo } = req.body;
    if (!assunto || !corpo) return res.status(400).json({ error: 'Assunto e corpo obrigatórios' });

    const [[lead]] = await pool.query(
      `SELECT id, nome, email FROM leads WHERE id=? AND excluido='N'`, [req.params.id]
    );
    if (!lead) return res.status(404).json({ error: 'Lead não encontrado' });
    if (!lead.email) return res.status(400).json({ error: 'Lead sem e-mail cadastrado' });

    const [[urow]] = await pool.query(
      `SELECT emailpedsmtp, emailpedporta, emailpedemail, emailpedsenha, emailpednome
       FROM usuarios WHERE idusuario=? AND COALESCE(excluido,'N')='N' LIMIT 1`,
      [user.id || 0]
    );
    const nodemailer = require('nodemailer');
    const htmlCorpo = corpo.replace(/\n/g, '<br>');

    if (urow?.emailpedemail && urow?.emailpedsenha) {
      const t = nodemailer.createTransport({
        host: urow.emailpedsmtp || 'smtp.gmail.com',
        port: parseInt(urow.emailpedporta || 587, 10),
        secure: false,
        auth: { user: urow.emailpedemail, pass: urow.emailpedsenha }
      });
      await t.sendMail({
        from: urow.emailpednome ? `"${urow.emailpednome}" <${urow.emailpedemail}>` : urow.emailpedemail,
        to: lead.email, subject: assunto, html: htmlCorpo
      });
    } else {
      const { sendMail } = require('../config/mailer');
      await sendMail({ to: lead.email, subject: assunto, html: htmlCorpo });
    }

    await addHistory(pool, req.params.id, user.id || 0, 'NOTA', `E-mail enviado: "${assunto}"`);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id/stage', async (req, res) => {
  await ensureTable();
  try {
    const pool = getPool();
    const user = req.user || {};
    const stage = normalizeStatus(req.body.status_funil);
    if (!stage) return res.status(400).json({ error: 'Estágio inválido' });
    const [[existing]] = await pool.query(
      `SELECT id, status_funil FROM leads WHERE id=? AND excluido='N'`, [req.params.id]
    );
    if (!existing) return res.status(404).json({ error: 'Lead não encontrado' });
    await pool.query(`UPDATE leads SET status_funil=? WHERE id=?`, [stage, req.params.id]);
    await addHistory(pool, req.params.id, user.idusuario || user.id || 0, 'ATUALIZACAO',
      `Estágio alterado de ${existing.status_funil} para ${stage} via funil`);
    res.json({ ok: true, status_funil: stage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── TAREFAS ──────────────────────────────────────────────────────────────────

// GET /api/leads/tarefas/hoje — tarefas pendentes/vencidas do usuário logado (painel)
router.get('/tarefas/hoje', async (req, res) => {
  await ensureTable();
  try {
    const pool = getPool();
    const user = req.user || {};
    const [rows] = await pool.query(
      `SELECT t.*, l.nome AS lead_nome, l.empresa AS lead_empresa, l.status_funil,
              u.nomeusu AS nome_responsavel
       FROM lead_tarefas t
       JOIN leads l ON l.id = t.lead_id AND l.excluido='N'
       LEFT JOIN usuarios u ON u.idusuario = t.id_responsavel
       WHERE t.excluido='N' AND t.status='PENDENTE'
         AND t.id_empresa=?
         AND (t.data_vencimento IS NULL OR t.data_vencimento <= CURDATE())
       ORDER BY t.data_vencimento ASC, t.prioridade='ALTA' DESC, t.dtcadastro ASC
       LIMIT 50`,
      [user.id_empresa || 1]
    );
    res.json({ tarefas: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/leads/:id/tarefas — lista tarefas de um lead
router.get('/:id/tarefas', async (req, res) => {
  await ensureTable();
  try {
    const [rows] = await getPool().query(
      `SELECT t.*, u.nomeusu AS nome_responsavel
       FROM lead_tarefas t
       LEFT JOIN usuarios u ON u.idusuario = t.id_responsavel
       WHERE t.lead_id=? AND t.excluido='N'
       ORDER BY FIELD(t.status,'PENDENTE','CONCLUIDA','CANCELADA'), t.data_vencimento ASC`,
      [req.params.id]
    );
    res.json({ tarefas: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/leads/:id/tarefas — criar tarefa
router.post('/:id/tarefas', async (req, res) => {
  await ensureTable();
  try {
    const pool = getPool();
    const user = req.user || {};
    const { titulo, descricao, data_vencimento, hora_vencimento, prioridade, id_responsavel } = req.body;
    if (!titulo) return res.status(400).json({ error: 'Título obrigatório' });
    const [r] = await pool.query(
      `INSERT INTO lead_tarefas (lead_id, id_empresa, id_usuario, id_responsavel, titulo, descricao,
        data_vencimento, hora_vencimento, prioridade)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.params.id, user.id_empresa || 1, user.id || 0,
       id_responsavel || user.id || null,
       String(titulo).slice(0, 200),
       descricao ? String(descricao).slice(0, 1000) : null,
       data_vencimento || null, hora_vencimento || null,
       ['ALTA','MEDIA','BAIXA'].includes(prioridade) ? prioridade : 'MEDIA']
    );
    await addHistory(pool, req.params.id, user.id || 0, 'NOTA',
      `Tarefa criada: "${String(titulo).slice(0, 80)}"${data_vencimento ? ' · vence ' + data_vencimento : ''}`);
    const [[tarefa]] = await pool.query(
      `SELECT t.*, u.nomeusu AS nome_responsavel FROM lead_tarefas t
       LEFT JOIN usuarios u ON u.idusuario=t.id_responsavel WHERE t.id=?`, [r.insertId]
    );
    res.status(201).json({ ok: true, tarefa });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/leads/tarefas/:id — atualizar (concluir, cancelar, editar)
router.put('/tarefas/:id', async (req, res) => {
  await ensureTable();
  try {
    const pool = getPool();
    const user = req.user || {};
    const { titulo, descricao, data_vencimento, hora_vencimento, prioridade, id_responsavel, status } = req.body;
    const validStatus = ['PENDENTE','CONCLUIDA','CANCELADA'];
    const [[existing]] = await pool.query(
      `SELECT * FROM lead_tarefas WHERE id=? AND excluido='N'`, [req.params.id]
    );
    if (!existing) return res.status(404).json({ error: 'Tarefa não encontrada' });
    const newStatus = validStatus.includes(status) ? status : existing.status;
    await pool.query(
      `UPDATE lead_tarefas SET
        titulo=?, descricao=?, data_vencimento=?, hora_vencimento=?,
        prioridade=?, id_responsavel=?, status=?,
        dtconclusao=?
       WHERE id=?`,
      [titulo != null ? String(titulo).slice(0,200) : existing.titulo,
       descricao != null ? String(descricao).slice(0,1000) : existing.descricao,
       data_vencimento !== undefined ? (data_vencimento || null) : existing.data_vencimento,
       hora_vencimento !== undefined ? (hora_vencimento || null) : existing.hora_vencimento,
       ['ALTA','MEDIA','BAIXA'].includes(prioridade) ? prioridade : existing.prioridade,
       id_responsavel !== undefined ? (id_responsavel || null) : existing.id_responsavel,
       newStatus,
       newStatus === 'CONCLUIDA' && existing.status !== 'CONCLUIDA' ? new Date() : existing.dtconclusao,
       req.params.id]
    );
    if (newStatus === 'CONCLUIDA' && existing.status !== 'CONCLUIDA') {
      await addHistory(pool, existing.lead_id, user.id || 0, 'NOTA',
        `Tarefa concluída: "${existing.titulo.slice(0, 80)}"`);
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/leads/tarefas/:id
router.delete('/tarefas/:id', async (req, res) => {
  await ensureTable();
  try {
    await getPool().query(`UPDATE lead_tarefas SET excluido='S' WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  await ensureTable();
  try {
    await getPool().query(`UPDATE leads SET excluido='S' WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
