const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');
const {
  isAdminUser,
  canAccessAllVendors,
  isGerenteComercial,
} = require('../config/vendedor-visibilidade');
const { permSn, negarCad } = require('../config/cadastros-permissoes');

// ── DDL ──────────────────────────────────────────────────────────────────────

const CREATE_PIPELINES_SQL = `
  CREATE TABLE IF NOT EXISTS pipelines (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL DEFAULT 1,
    nome VARCHAR(120) NOT NULL,
    padrao CHAR(1) NOT NULL DEFAULT 'N',
    ativo CHAR(1) NOT NULL DEFAULT 'S',
    excluido CHAR(1) NOT NULL DEFAULT 'N',
    dtcadastro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    dtalterado DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_pipelines_empresa (id_empresa)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const CREATE_ETAPAS_SQL = `
  CREATE TABLE IF NOT EXISTS pipeline_etapas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_pipeline INT NOT NULL,
    nome VARCHAR(80) NOT NULL,
    ordem INT NOT NULL DEFAULT 0,
    tipo ENUM('ABERTA','GANHO','PERDIDO') NOT NULL DEFAULT 'ABERTA',
    cor VARCHAR(20) NOT NULL DEFAULT '#0d9488',
    probabilidade_padrao INT NOT NULL DEFAULT 0,
    excluido CHAR(1) NOT NULL DEFAULT 'N',
    INDEX idx_etapa_pipeline (id_pipeline)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const CREATE_PIPELINE_VENDEDOR_SQL = `
  CREATE TABLE IF NOT EXISTS pipeline_vendedor (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_pipeline INT NOT NULL,
    id_usuario INT NOT NULL,
    excluido CHAR(1) NOT NULL DEFAULT 'N',
    dtcadastro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_pipeline_vendedor (id_pipeline, id_usuario)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const CREATE_NEGOCIOS_SQL = `
  CREATE TABLE IF NOT EXISTS negocios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL DEFAULT 1,
    id_lead INT NULL,
    id_cliente INT NULL,
    id_pipeline INT NOT NULL,
    id_etapa INT NOT NULL,
    id_usuario INT NOT NULL,
    titulo VARCHAR(150) NOT NULL DEFAULT '',
    valor_previsto DECIMAL(14,2) NOT NULL DEFAULT 0,
    probabilidade INT NOT NULL DEFAULT 0,
    status ENUM('ABERTO','GANHO','PERDIDO') NOT NULL DEFAULT 'ABERTO',
    id_motivo_perda INT NULL,
    motivo_perda_obs VARCHAR(255) NOT NULL DEFAULT '',
    origem VARCHAR(60) NOT NULL DEFAULT 'MANUAL',
    fechado_em DATETIME NULL,
    excluido CHAR(1) NOT NULL DEFAULT 'N',
    dtcadastro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    dtalterado DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_negocio_pipeline (id_pipeline),
    INDEX idx_negocio_etapa (id_etapa),
    INDEX idx_negocio_usuario (id_usuario),
    INDEX idx_negocio_cliente (id_cliente),
    INDEX idx_negocio_lead (id_lead),
    INDEX idx_negocio_status (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const CREATE_NEGOCIO_PEDIDOS_SQL = `
  CREATE TABLE IF NOT EXISTS negocio_pedidos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_negocio INT NOT NULL,
    id_pedido INT NOT NULL,
    dtcadastro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_negocio_pedido (id_negocio, id_pedido),
    INDEX idx_np_negocio (id_negocio),
    INDEX idx_np_pedido (id_pedido)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const CREATE_NEGOCIO_HISTORICO_SQL = `
  CREATE TABLE IF NOT EXISTS negocio_historico (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_negocio INT NOT NULL,
    id_etapa_origem INT NULL,
    id_etapa_destino INT NOT NULL,
    id_usuario INT NOT NULL,
    dtcadastro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_hist_negocio (id_negocio)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const CREATE_MOTIVOS_PERDA_SQL = `
  CREATE TABLE IF NOT EXISTS motivos_perda (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL DEFAULT 1,
    descricao VARCHAR(150) NOT NULL,
    ativo CHAR(1) NOT NULL DEFAULT 'S',
    excluido CHAR(1) NOT NULL DEFAULT 'N',
    INDEX idx_motperda_empresa (id_empresa)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const CREATE_NEGOCIO_TAREFAS_SQL = `
  CREATE TABLE IF NOT EXISTS negocio_tarefas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_negocio INT NOT NULL,
    id_empresa INT NOT NULL DEFAULT 1,
    id_responsavel INT NULL,
    tipo ENUM('TAREFA','LIGACAO','REUNIAO','EMAIL','VISITA') NOT NULL DEFAULT 'TAREFA',
    titulo VARCHAR(200) NOT NULL,
    descricao TEXT,
    data_vencimento DATE NULL,
    hora_vencimento TIME NULL,
    prioridade ENUM('ALTA','MEDIA','BAIXA') NOT NULL DEFAULT 'MEDIA',
    status ENUM('PENDENTE','CONCLUIDA','CANCELADA') NOT NULL DEFAULT 'PENDENTE',
    dtcadastro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    dtconclusao DATETIME NULL,
    excluido CHAR(1) NOT NULL DEFAULT 'N',
    INDEX idx_tarefas_negocio (id_negocio),
    INDEX idx_tarefas_status (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

let _ensured = false;
async function ensureTable() {
  if (_ensured) return;
  const pool = getPool();
  try { await pool.query(CREATE_PIPELINES_SQL); } catch (_) {}
  try { await pool.query(CREATE_ETAPAS_SQL); } catch (_) {}
  try { await pool.query(CREATE_PIPELINE_VENDEDOR_SQL); } catch (_) {}
  try { await pool.query(CREATE_NEGOCIOS_SQL); } catch (_) {}
  try { await pool.query(CREATE_NEGOCIO_PEDIDOS_SQL); } catch (_) {}
  try { await pool.query(CREATE_NEGOCIO_HISTORICO_SQL); } catch (_) {}
  try { await pool.query(CREATE_MOTIVOS_PERDA_SQL); } catch (_) {}
  try { await pool.query(CREATE_NEGOCIO_TAREFAS_SQL); } catch (_) {}
  _ensured = true;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function uid(req) { return parseInt(req.user?.idusuario || req.user?.id || 0, 10); }
function idEmpresa(req) { return parseInt(req.user?.id_empresa || 1, 10); }

// ── Guards de permissão granular ─────────────────────────────────────────────
const podeVerKanban       = (req) => permSn(req, 'gtela_crm_pipeline') === 'S';
const podeVerConfig       = (req) => permSn(req, 'gtela_crm_config') === 'S';
const podeVerDashboard    = (req) => permSn(req, 'gtela_crm_dashboard') === 'S';
const podeIncluirPipeline = (req) => permSn(req, 'incluir_pipeline_crm') === 'S';
const podeAlterarPipeline = (req) => permSn(req, 'alterar_pipeline_crm') === 'S';
const podeExcluirPipeline = (req) => permSn(req, 'excluir_pipeline_crm') === 'S';
const podeAlterarVendedoresPipeline = (req) => permSn(req, 'alterar_vendedores_pipeline_crm') === 'S';
const podeIncluirNegocio  = (req) => permSn(req, 'incluir_negocio_crm') === 'S';
const podeAlterarNegocio  = (req) => permSn(req, 'alterar_negocio_crm') === 'S';
const podeExcluirNegocio  = (req) => permSn(req, 'excluir_negocio_crm') === 'S';
const podeMoverEtapa      = (req) => permSn(req, 'mover_etapa_crm') === 'S';
const podeIncluirTarefa   = (req) => permSn(req, 'incluir_tarefa_crm') === 'S';
const podeAlterarTarefa   = (req) => permSn(req, 'alterar_tarefa_crm') === 'S';
const podeExcluirTarefa   = (req) => permSn(req, 'excluir_tarefa_crm') === 'S';
const podeIncluirMotivo   = (req) => permSn(req, 'incluir_motivo_perda_crm') === 'S';
const podeAlterarMotivo   = (req) => permSn(req, 'alterar_motivo_perda_crm') === 'S';
const podeExcluirMotivo   = (req) => permSn(req, 'excluir_motivo_perda_crm') === 'S';

/** Pipelines visíveis ao usuário logado (ids). null = todas. */
async function pipelinesVisiveis(pool, req) {
  if (isAdminUser(req) || canAccessAllVendors(req) || isGerenteComercial(req)) return null;
  const [rows] = await pool.query(
    `SELECT id_pipeline FROM pipeline_vendedor WHERE id_usuario=? AND excluido='N'`,
    [uid(req)]
  );
  return rows.map(r => r.id_pipeline);
}

async function assertPipelineVisivel(pool, req, idPipeline) {
  const visiveis = await pipelinesVisiveis(pool, req);
  if (visiveis === null) return true;
  return visiveis.includes(parseInt(idPipeline, 10));
}

// ── PIPELINES ────────────────────────────────────────────────────────────────

router.get('/pipelines', async (req, res) => {
  await ensureTable();
  if (!podeVerKanban(req) && !podeVerConfig(req) && !podeVerDashboard(req)) return negarCad(res);
  try {
    const pool = getPool();
    const visiveis = await pipelinesVisiveis(pool, req);
    const conds = [`p.excluido='N'`, `p.id_empresa=?`];
    const params = [idEmpresa(req)];
    if (visiveis !== null) {
      if (!visiveis.length) return res.json({ pipelines: [] });
      conds.push(`p.id IN (${visiveis.map(() => '?').join(',')})`);
      params.push(...visiveis);
    }
    const [rows] = await pool.query(
      `SELECT p.*, (SELECT COUNT(*) FROM negocios n WHERE n.id_pipeline=p.id AND n.status='ABERTO' AND n.excluido='N') AS negocios_abertos
       FROM pipelines p WHERE ${conds.join(' AND ')} ORDER BY p.nome`,
      params
    );
    res.json({ pipelines: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/pipelines', async (req, res) => {
  await ensureTable();
  if (!podeIncluirPipeline(req)) return negarCad(res, 'Sem permissão para criar pipelines');
  try {
    const pool = getPool();
    const nome = String(req.body?.nome || '').trim();
    if (!nome) return res.status(400).json({ error: 'Nome obrigatório' });
    const padrao = req.body?.padrao === 'S' ? 'S' : 'N';
    if (padrao === 'S') {
      await pool.query(`UPDATE pipelines SET padrao='N' WHERE id_empresa=?`, [idEmpresa(req)]);
    }
    const [r] = await pool.query(
      `INSERT INTO pipelines (id_empresa, nome, padrao) VALUES (?, ?, ?)`,
      [idEmpresa(req), nome.slice(0, 120), padrao]
    );
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/pipelines/:id', async (req, res) => {
  await ensureTable();
  if (!podeAlterarPipeline(req)) return negarCad(res, 'Sem permissão para alterar pipelines');
  try {
    const pool = getPool();
    const nome = String(req.body?.nome || '').trim();
    const ativo = req.body?.ativo === 'N' ? 'N' : 'S';
    const padrao = req.body?.padrao === 'S' ? 'S' : 'N';
    if (padrao === 'S') {
      await pool.query(`UPDATE pipelines SET padrao='N' WHERE id_empresa=?`, [idEmpresa(req)]);
    }
    await pool.query(
      `UPDATE pipelines SET nome=?, ativo=?, padrao=? WHERE id=? AND id_empresa=?`,
      [nome.slice(0, 120) || 'Pipeline', ativo, padrao, req.params.id, idEmpresa(req)]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/pipelines/:id', async (req, res) => {
  await ensureTable();
  if (!podeExcluirPipeline(req)) return negarCad(res, 'Sem permissão para excluir pipelines');
  try {
    await getPool().query(`UPDATE pipelines SET excluido='S' WHERE id=? AND id_empresa=?`, [req.params.id, idEmpresa(req)]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── ETAPAS ───────────────────────────────────────────────────────────────────

router.get('/pipelines/:id/etapas', async (req, res) => {
  await ensureTable();
  try {
    const [rows] = await getPool().query(
      `SELECT * FROM pipeline_etapas WHERE id_pipeline=? AND excluido='N' ORDER BY ordem ASC, id ASC`,
      [req.params.id]
    );
    res.json({ etapas: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/pipelines/:id/etapas', async (req, res) => {
  await ensureTable();
  if (!podeIncluirPipeline(req)) return negarCad(res, 'Sem permissão para criar etapas');
  try {
    const pool = getPool();
    const nome = String(req.body?.nome || '').trim();
    if (!nome) return res.status(400).json({ error: 'Nome obrigatório' });
    const tipo = ['ABERTA', 'GANHO', 'PERDIDO'].includes(req.body?.tipo) ? req.body.tipo : 'ABERTA';
    const [[{ maxOrdem }]] = await pool.query(
      `SELECT COALESCE(MAX(ordem), 0) AS maxOrdem FROM pipeline_etapas WHERE id_pipeline=? AND excluido='N'`,
      [req.params.id]
    );
    const [r] = await pool.query(
      `INSERT INTO pipeline_etapas (id_pipeline, nome, ordem, tipo, cor, probabilidade_padrao)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.params.id, nome.slice(0, 80), maxOrdem + 1, tipo,
       String(req.body?.cor || '#0d9488').slice(0, 20),
       Math.max(0, Math.min(100, parseInt(req.body?.probabilidade_padrao || 0, 10)))]
    );
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/etapas/:id', async (req, res) => {
  await ensureTable();
  if (!podeAlterarPipeline(req)) return negarCad(res, 'Sem permissão para alterar etapas');
  try {
    const pool = getPool();
    const nome = String(req.body?.nome || '').trim();
    const tipo = ['ABERTA', 'GANHO', 'PERDIDO'].includes(req.body?.tipo) ? req.body.tipo : 'ABERTA';
    await pool.query(
      `UPDATE pipeline_etapas SET nome=?, tipo=?, cor=?, probabilidade_padrao=? WHERE id=?`,
      [nome.slice(0, 80) || 'Etapa', tipo, String(req.body?.cor || '#0d9488').slice(0, 20),
       Math.max(0, Math.min(100, parseInt(req.body?.probabilidade_padrao || 0, 10))), req.params.id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/etapas/:id', async (req, res) => {
  await ensureTable();
  if (!podeExcluirPipeline(req)) return negarCad(res, 'Sem permissão para excluir etapas');
  try {
    const pool = getPool();
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) total FROM negocios WHERE id_etapa=? AND excluido='N'`, [req.params.id]
    );
    if (total > 0) return res.status(409).json({ error: 'Existem negócios nesta etapa — mova-os antes de excluir' });
    await pool.query(`UPDATE pipeline_etapas SET excluido='S' WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/pipelines/:id/etapas/reordenar', async (req, res) => {
  await ensureTable();
  if (!podeAlterarPipeline(req)) return negarCad(res, 'Sem permissão para reordenar etapas');
  try {
    const pool = getPool();
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    for (let i = 0; i < ids.length; i++) {
      await pool.query(`UPDATE pipeline_etapas SET ordem=? WHERE id=? AND id_pipeline=?`, [i + 1, ids[i], req.params.id]);
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── VENDEDORES DA PIPELINE ───────────────────────────────────────────────────

router.get('/pipelines/:id/vendedores', async (req, res) => {
  await ensureTable();
  try {
    const [rows] = await getPool().query(
      `SELECT pv.id_usuario, u.nomeusu AS nome
       FROM pipeline_vendedor pv
       LEFT JOIN usuarios u ON u.idusuario = pv.id_usuario
       WHERE pv.id_pipeline=? AND pv.excluido='N'
       ORDER BY u.nomeusu`,
      [req.params.id]
    );
    res.json({ vendedores: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/pipelines/:id/vendedores', async (req, res) => {
  await ensureTable();
  if (!podeAlterarVendedoresPipeline(req)) return negarCad(res, 'Sem permissão para alterar vendedores da pipeline');
  try {
    const pool = getPool();
    const ids = Array.isArray(req.body?.ids_usuario) ? req.body.ids_usuario.map(n => parseInt(n, 10)).filter(Boolean) : [];
    await pool.query(`UPDATE pipeline_vendedor SET excluido='S' WHERE id_pipeline=?`, [req.params.id]);
    for (const idu of ids) {
      await pool.query(
        `INSERT INTO pipeline_vendedor (id_pipeline, id_usuario, excluido)
         VALUES (?, ?, 'N')
         ON DUPLICATE KEY UPDATE excluido='N'`,
        [req.params.id, idu]
      );
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── MOTIVOS DE PERDA ─────────────────────────────────────────────────────────

router.get('/motivos-perda', async (req, res) => {
  await ensureTable();
  try {
    const [rows] = await getPool().query(
      `SELECT * FROM motivos_perda WHERE id_empresa=? AND excluido='N' AND ativo='S' ORDER BY descricao`,
      [idEmpresa(req)]
    );
    res.json({ motivos: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/motivos-perda', async (req, res) => {
  await ensureTable();
  if (!podeIncluirMotivo(req)) return negarCad(res, 'Sem permissão para criar motivos de perda');
  try {
    const descricao = String(req.body?.descricao || '').trim();
    if (!descricao) return res.status(400).json({ error: 'Descrição obrigatória' });
    const [r] = await getPool().query(
      `INSERT INTO motivos_perda (id_empresa, descricao) VALUES (?, ?)`,
      [idEmpresa(req), descricao.slice(0, 150)]
    );
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/motivos-perda/:id', async (req, res) => {
  await ensureTable();
  if (!podeAlterarMotivo(req)) return negarCad(res, 'Sem permissão para alterar motivos de perda');
  try {
    const descricao = String(req.body?.descricao || '').trim();
    const ativo = req.body?.ativo === 'N' ? 'N' : 'S';
    await getPool().query(
      `UPDATE motivos_perda SET descricao=?, ativo=? WHERE id=? AND id_empresa=?`,
      [descricao.slice(0, 150) || 'Motivo', ativo, req.params.id, idEmpresa(req)]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/motivos-perda/:id', async (req, res) => {
  await ensureTable();
  if (!podeExcluirMotivo(req)) return negarCad(res, 'Sem permissão para excluir motivos de perda');
  try {
    await getPool().query(`UPDATE motivos_perda SET excluido='S' WHERE id=? AND id_empresa=?`, [req.params.id, idEmpresa(req)]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── NEGÓCIOS ─────────────────────────────────────────────────────────────────

router.get('/negocios', async (req, res) => {
  await ensureTable();
  if (!podeVerKanban(req)) return negarCad(res);
  try {
    const pool = getPool();
    const conds = [`n.excluido='N'`, `n.id_empresa=?`];
    const params = [idEmpresa(req)];

    if (req.query.id_pipeline) {
      conds.push('n.id_pipeline=?');
      params.push(req.query.id_pipeline);
    } else {
      return res.status(400).json({ error: 'id_pipeline obrigatório' });
    }
    if (!(await assertPipelineVisivel(pool, req, req.query.id_pipeline))) {
      return res.status(403).json({ error: 'Sem acesso a esta pipeline' });
    }
    if (req.query.status) {
      conds.push('n.status=?');
      params.push(req.query.status);
    }
    if (!isAdminUser(req) && !canAccessAllVendors(req) && !isGerenteComercial(req)) {
      conds.push('n.id_usuario=?');
      params.push(uid(req));
    }

    const [rows] = await pool.query(
      `SELECT n.*,
              COALESCE(l.nome, c.nome) AS nome_contato,
              l.empresa AS lead_empresa,
              u.nomeusu AS nome_vendedor,
              (SELECT COUNT(*) FROM negocio_pedidos npv WHERE npv.id_negocio=n.id) AS qt_pedidos,
              (SELECT GROUP_CONCAT(npv.id_pedido) FROM negocio_pedidos npv WHERE npv.id_negocio=n.id) AS ids_pedidos,
              (SELECT COUNT(*) FROM negocio_tarefas t WHERE t.id_negocio=n.id AND t.status='PENDENTE' AND t.excluido='N'
                 AND t.data_vencimento IS NOT NULL AND t.data_vencimento <= CURDATE()) AS tarefas_vencidas
       FROM negocios n
       LEFT JOIN leads l ON l.id = n.id_lead
       LEFT JOIN clientes c ON c.id = n.id_cliente
       LEFT JOIN usuarios u ON u.idusuario = n.id_usuario
       WHERE ${conds.join(' AND ')}
       ORDER BY n.id_etapa, n.dtcadastro DESC`,
      params
    );
    res.json({ negocios: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/negocios/:id', async (req, res) => {
  await ensureTable();
  if (!podeVerKanban(req)) return negarCad(res);
  try {
    const pool = getPool();
    const [[negocio]] = await pool.query(
      `SELECT n.*, COALESCE(l.nome, c.nome) AS nome_contato, l.empresa AS lead_empresa,
              l.telefone AS lead_telefone, l.email AS lead_email,
              u.nomeusu AS nome_vendedor
       FROM negocios n
       LEFT JOIN leads l ON l.id = n.id_lead
       LEFT JOIN clientes c ON c.id = n.id_cliente
       LEFT JOIN usuarios u ON u.idusuario = n.id_usuario
       WHERE n.id=? AND n.excluido='N' LIMIT 1`,
      [req.params.id]
    );
    if (!negocio) return res.status(404).json({ error: 'Negócio não encontrado' });

    const [pedidosVinc] = await pool.query(
      `SELECT np.id_pedido, p.numero, p.vlrtotalpedido, p.situacao_pedido, p.data_abertura
       FROM negocio_pedidos np
       JOIN pedidos p ON p.id = np.id_pedido
       WHERE np.id_negocio=?
       ORDER BY p.id DESC`,
      [req.params.id]
    );

    const [historico] = await pool.query(
      `SELECT h.*, eo.nome AS etapa_origem, ed.nome AS etapa_destino, u.nomeusu AS nome_usuario
       FROM negocio_historico h
       LEFT JOIN pipeline_etapas eo ON eo.id = h.id_etapa_origem
       LEFT JOIN pipeline_etapas ed ON ed.id = h.id_etapa_destino
       LEFT JOIN usuarios u ON u.idusuario = h.id_usuario
       WHERE h.id_negocio=? ORDER BY h.id DESC`,
      [req.params.id]
    );

    const [tarefas] = await pool.query(
      `SELECT t.*, u.nomeusu AS nome_responsavel
       FROM negocio_tarefas t
       LEFT JOIN usuarios u ON u.idusuario = t.id_responsavel
       WHERE t.id_negocio=? AND t.excluido='N'
       ORDER BY FIELD(t.status,'PENDENTE','CONCLUIDA','CANCELADA'), t.data_vencimento ASC`,
      [req.params.id]
    );

    res.json({ negocio, pedidos: pedidosVinc, historico, tarefas });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/negocios', async (req, res) => {
  await ensureTable();
  if (!podeIncluirNegocio(req)) return negarCad(res, 'Sem permissão para criar negócios');
  try {
    const pool = getPool();
    const b = req.body || {};
    if (!b.id_pipeline) return res.status(400).json({ error: 'id_pipeline obrigatório' });
    if (!b.id_lead && !b.id_cliente) return res.status(400).json({ error: 'Informe id_lead ou id_cliente' });

    const [[primeiraEtapa]] = await pool.query(
      `SELECT id, probabilidade_padrao FROM pipeline_etapas
       WHERE id_pipeline=? AND tipo='ABERTA' AND excluido='N' ORDER BY ordem ASC LIMIT 1`,
      [b.id_pipeline]
    );
    if (!primeiraEtapa) return res.status(400).json({ error: 'Pipeline sem etapa inicial configurada' });

    const [r] = await pool.query(
      `INSERT INTO negocios (id_empresa, id_lead, id_cliente, id_pipeline, id_etapa, id_usuario,
         titulo, valor_previsto, probabilidade, status, origem)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ABERTO', 'MANUAL')`,
      [
        idEmpresa(req),
        b.id_lead || null,
        b.id_cliente || null,
        b.id_pipeline,
        primeiraEtapa.id,
        b.id_usuario ? parseInt(b.id_usuario, 10) : uid(req),
        String(b.titulo || '').slice(0, 150),
        parseFloat(b.valor_previsto) || 0,
        primeiraEtapa.probabilidade_padrao || 0,
      ]
    );
    await pool.query(
      `INSERT INTO negocio_historico (id_negocio, id_etapa_origem, id_etapa_destino, id_usuario)
       VALUES (?, NULL, ?, ?)`,
      [r.insertId, primeiraEtapa.id, uid(req)]
    );
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/negocios/:id/etapa', async (req, res) => {
  await ensureTable();
  if (!podeMoverEtapa(req) && !podeAlterarNegocio(req)) return negarCad(res, 'Sem permissão para mover negócios entre etapas');
  try {
    const pool = getPool();
    const [[negocio]] = await pool.query(`SELECT * FROM negocios WHERE id=? AND excluido='N'`, [req.params.id]);
    if (!negocio) return res.status(404).json({ error: 'Negócio não encontrado' });

    const [[novaEtapa]] = await pool.query(`SELECT * FROM pipeline_etapas WHERE id=?`, [req.body?.id_etapa]);
    if (!novaEtapa) return res.status(400).json({ error: 'Etapa inválida' });

    if (novaEtapa.tipo === 'GANHO') {
      const [[{ total }]] = await pool.query(`SELECT COUNT(*) total FROM negocio_pedidos WHERE id_negocio=?`, [req.params.id]);
      if (!total) {
        return res.status(409).json({ error: 'Vincule um orçamento (pedido) antes de marcar como Ganho' });
      }
    }
    if (novaEtapa.tipo === 'PERDIDO' && !req.body?.id_motivo_perda) {
      return res.status(409).json({ error: 'Selecione o motivo da perda' });
    }

    const status = novaEtapa.tipo === 'GANHO' ? 'GANHO' : (novaEtapa.tipo === 'PERDIDO' ? 'PERDIDO' : 'ABERTO');
    const fechado = status !== 'ABERTO';

    await pool.query(
      `UPDATE negocios SET id_etapa=?, status=?, probabilidade=?,
         id_motivo_perda=?, motivo_perda_obs=?,
         fechado_em=${fechado ? 'NOW()' : 'NULL'}
       WHERE id=?`,
      [
        novaEtapa.id, status,
        req.body?.probabilidade != null ? Math.max(0, Math.min(100, parseInt(req.body.probabilidade, 10))) : novaEtapa.probabilidade_padrao,
        novaEtapa.tipo === 'PERDIDO' ? parseInt(req.body.id_motivo_perda, 10) : null,
        novaEtapa.tipo === 'PERDIDO' ? String(req.body?.motivo_perda_obs || '').slice(0, 255) : '',
        req.params.id
      ]
    );

    await pool.query(
      `INSERT INTO negocio_historico (id_negocio, id_etapa_origem, id_etapa_destino, id_usuario)
       VALUES (?, ?, ?, ?)`,
      [req.params.id, negocio.id_etapa, novaEtapa.id, uid(req)]
    );

    res.json({ ok: true, status });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/negocios/:id/pedidos/:idPedido', async (req, res) => {
  await ensureTable();
  if (!podeAlterarNegocio(req)) return negarCad(res, 'Sem permissão para vincular pedidos ao negócio');
  try {
    const pool = getPool();
    await pool.query(
      `INSERT IGNORE INTO negocio_pedidos (id_negocio, id_pedido) VALUES (?, ?)`,
      [req.params.id, req.params.idPedido]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/negocios/:id', async (req, res) => {
  await ensureTable();
  if (!podeExcluirNegocio(req)) return negarCad(res, 'Sem permissão para excluir negócios');
  try {
    await getPool().query(`UPDATE negocios SET excluido='S' WHERE id=? AND id_empresa=?`, [req.params.id, idEmpresa(req)]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── TAREFAS DO NEGÓCIO ───────────────────────────────────────────────────────

router.get('/tarefas/hoje', async (req, res) => {
  await ensureTable();
  try {
    const [rows] = await getPool().query(
      `SELECT t.*, n.titulo AS negocio_titulo, n.id_pipeline,
              COALESCE(l.nome, c.nome) AS nome_contato
       FROM negocio_tarefas t
       JOIN negocios n ON n.id = t.id_negocio AND n.excluido='N'
       LEFT JOIN leads l ON l.id = n.id_lead
       LEFT JOIN clientes c ON c.id = n.id_cliente
       WHERE t.excluido='N' AND t.status='PENDENTE'
         AND t.id_empresa=?
         AND (t.data_vencimento IS NULL OR t.data_vencimento <= CURDATE())
         AND (t.id_responsavel=? OR n.id_usuario=?)
       ORDER BY t.data_vencimento ASC, t.prioridade='ALTA' DESC
       LIMIT 50`,
      [idEmpresa(req), uid(req), uid(req)]
    );
    res.json({ tarefas: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/negocios/:id/tarefas', async (req, res) => {
  await ensureTable();
  try {
    const [rows] = await getPool().query(
      `SELECT t.*, u.nomeusu AS nome_responsavel
       FROM negocio_tarefas t
       LEFT JOIN usuarios u ON u.idusuario = t.id_responsavel
       WHERE t.id_negocio=? AND t.excluido='N'
       ORDER BY FIELD(t.status,'PENDENTE','CONCLUIDA','CANCELADA'), t.data_vencimento ASC`,
      [req.params.id]
    );
    res.json({ tarefas: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/negocios/:id/tarefas', async (req, res) => {
  await ensureTable();
  if (!podeIncluirTarefa(req)) return negarCad(res, 'Sem permissão para criar tarefas');
  try {
    const pool = getPool();
    const b = req.body || {};
    if (!b.titulo) return res.status(400).json({ error: 'Título obrigatório' });
    const tipo = ['TAREFA','LIGACAO','REUNIAO','EMAIL','VISITA'].includes(b.tipo) ? b.tipo : 'TAREFA';
    const prioridade = ['ALTA','MEDIA','BAIXA'].includes(b.prioridade) ? b.prioridade : 'MEDIA';
    const [r] = await pool.query(
      `INSERT INTO negocio_tarefas (id_negocio, id_empresa, id_responsavel, tipo, titulo, descricao,
         data_vencimento, hora_vencimento, prioridade)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.params.id, idEmpresa(req), b.id_responsavel ? parseInt(b.id_responsavel, 10) : uid(req),
       tipo, String(b.titulo).slice(0, 200), b.descricao ? String(b.descricao).slice(0, 1000) : null,
       b.data_vencimento || null, b.hora_vencimento || null, prioridade]
    );
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/tarefas/:id', async (req, res) => {
  await ensureTable();
  if (!podeAlterarTarefa(req)) return negarCad(res, 'Sem permissão para alterar tarefas');
  try {
    const pool = getPool();
    const b = req.body || {};
    const [[existing]] = await pool.query(`SELECT * FROM negocio_tarefas WHERE id=? AND excluido='N'`, [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Tarefa não encontrada' });
    const status = ['PENDENTE','CONCLUIDA','CANCELADA'].includes(b.status) ? b.status : existing.status;
    await pool.query(
      `UPDATE negocio_tarefas SET titulo=?, descricao=?, data_vencimento=?, hora_vencimento=?,
         prioridade=?, status=?, dtconclusao=?
       WHERE id=?`,
      [
        b.titulo != null ? String(b.titulo).slice(0, 200) : existing.titulo,
        b.descricao != null ? String(b.descricao).slice(0, 1000) : existing.descricao,
        b.data_vencimento !== undefined ? (b.data_vencimento || null) : existing.data_vencimento,
        b.hora_vencimento !== undefined ? (b.hora_vencimento || null) : existing.hora_vencimento,
        ['ALTA','MEDIA','BAIXA'].includes(b.prioridade) ? b.prioridade : existing.prioridade,
        status,
        status === 'CONCLUIDA' && existing.status !== 'CONCLUIDA' ? new Date() : existing.dtconclusao,
        req.params.id
      ]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/tarefas/:id/concluir', async (req, res) => {
  await ensureTable();
  if (!podeAlterarTarefa(req)) return negarCad(res, 'Sem permissão para concluir tarefas');
  try {
    await getPool().query(
      `UPDATE negocio_tarefas SET status='CONCLUIDA', dtconclusao=NOW() WHERE id=?`,
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/tarefas/:id', async (req, res) => {
  await ensureTable();
  if (!podeExcluirTarefa(req)) return negarCad(res, 'Sem permissão para excluir tarefas');
  try {
    await getPool().query(`UPDATE negocio_tarefas SET excluido='S' WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── COMISSÃO PREVISTA ────────────────────────────────────────────────────────

router.get('/negocios/:id/comissao-prevista', async (req, res) => {
  await ensureTable();
  try {
    const pool = getPool();
    const [[negocio]] = await pool.query(
      `SELECT n.*, (SELECT p.cod_fornecedor FROM negocio_pedidos np JOIN pedidos p ON p.id=np.id_pedido WHERE np.id_negocio=n.id ORDER BY np.id DESC LIMIT 1) AS cod_fornecedor,
              (SELECT p.vlrtotalpedido FROM negocio_pedidos np JOIN pedidos p ON p.id=np.id_pedido WHERE np.id_negocio=n.id ORDER BY np.id DESC LIMIT 1) AS valor_pedido
       FROM negocios n WHERE n.id=?`,
      [req.params.id]
    );
    if (!negocio) return res.status(404).json({ error: 'Negócio não encontrado' });

    const base = negocio.valor_pedido != null ? Number(negocio.valor_pedido) : Number(negocio.valor_previsto);

    let pct = 0;
    if (negocio.cod_fornecedor) {
      const [[comissaoRow]] = await pool.query(
        `SELECT pct_comissao FROM preposto_comissao_fornecedor
         WHERE id_usuario=? AND id_fornecedor=? AND COALESCE(oculta,'N')='N' LIMIT 1`,
        [negocio.id_usuario, negocio.cod_fornecedor]
      ).catch(() => [[null]]);
      pct = comissaoRow ? Number(comissaoRow.pct_comissao || 0) : 0;
    }

    res.json({
      base_calculo: base,
      percentual: pct,
      comissao_prevista: Math.round(base * pct) / 100,
      origem_valor: negocio.valor_pedido != null ? 'PEDIDO' : 'PREVISTO'
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── RECEBIMENTOS ─────────────────────────────────────────────────────────────

router.get('/negocios/:id/recebimentos', async (req, res) => {
  await ensureTable();
  try {
    const pool = getPool();
    const [pedidosVinc] = await pool.query(
      `SELECT p.id, p.numero, p.cod_cliente FROM negocio_pedidos np
       JOIN pedidos p ON p.id = np.id_pedido WHERE np.id_negocio=?`,
      [req.params.id]
    );
    if (!pedidosVinc.length) return res.json({ recebimentos: [] });

    const numeros = pedidosVinc.map(p => p.numero).filter(Boolean);
    if (!numeros.length) return res.json({ recebimentos: [] });

    const [rows] = await pool.query(
      `SELECT * FROM receber
       WHERE (excluido='N' OR excluido IS NULL)
         AND (numero IN (${numeros.map(() => '?').join(',')}) OR doc IN (${numeros.map(() => '?').join(',')}))
       ORDER BY vencimento ASC`,
      [...numeros, ...numeros]
    );
    res.json({ recebimentos: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DASHBOARD ────────────────────────────────────────────────────────────────

router.get('/dashboard', async (req, res) => {
  await ensureTable();
  if (!podeVerDashboard(req)) return negarCad(res);
  try {
    const pool = getPool();
    const conds = [`n.excluido='N'`, `n.id_empresa=?`];
    const params = [idEmpresa(req)];
    if (req.query.id_pipeline) {
      conds.push('n.id_pipeline=?');
      params.push(req.query.id_pipeline);
    }
    if (!isAdminUser(req) && !canAccessAllVendors(req) && !isGerenteComercial(req)) {
      conds.push('n.id_usuario=?');
      params.push(uid(req));
    }
    const where = conds.join(' AND ');

    const [
      [porEtapa],
      [ranking],
      [motivos],
      [[ponderado]]
    ] = await Promise.all([
      pool.query(
        `SELECT pe.id AS id_etapa, pe.nome, pe.tipo, COUNT(n.id) total, COALESCE(SUM(n.valor_previsto),0) valor
         FROM pipeline_etapas pe
         LEFT JOIN negocios n ON n.id_etapa=pe.id AND ${where}
         WHERE pe.excluido='N' ${req.query.id_pipeline ? 'AND pe.id_pipeline=?' : ''}
         GROUP BY pe.id, pe.nome, pe.tipo, pe.ordem
         ORDER BY pe.ordem`,
        req.query.id_pipeline ? [...params, req.query.id_pipeline] : params
      ),
      pool.query(
        `SELECT u.nomeusu AS vendedor, COUNT(*) total,
                SUM(n.status='GANHO') ganhos, SUM(n.status='PERDIDO') perdidos,
                COALESCE(SUM(CASE WHEN n.status='GANHO' THEN n.valor_previsto ELSE 0 END),0) valor_ganho
         FROM negocios n LEFT JOIN usuarios u ON u.idusuario=n.id_usuario
         WHERE ${where} GROUP BY n.id_usuario, u.nomeusu ORDER BY valor_ganho DESC LIMIT 10`,
        params
      ),
      pool.query(
        `SELECT COALESCE(mp.descricao,'Não informado') motivo, COUNT(*) total
         FROM negocios n LEFT JOIN motivos_perda mp ON mp.id=n.id_motivo_perda
         WHERE ${where} AND n.status='PERDIDO' GROUP BY motivo ORDER BY total DESC LIMIT 8`,
        params
      ),
      pool.query(
        `SELECT COALESCE(SUM(valor_previsto * probabilidade / 100), 0) AS valor_ponderado,
                COALESCE(AVG(valor_previsto), 0) AS ticket_medio
         FROM negocios n WHERE ${where} AND n.status='ABERTO'`,
        params
      )
    ]);

    res.json({ porEtapa, ranking, motivos, ponderado });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
module.exports.ensureTable = ensureTable;
