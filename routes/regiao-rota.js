const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const { getPool } = require('../config/database');
const { permCrud, negarCad } = require('../config/cadastros-permissoes');

const _permRegiao = (req) => permCrud(req, {
  incluir: 'incluir_regioes',
  alterar: 'alterar_regioes',
  excluir: 'excluir_regioes',
});

// ─── Push PWA helper ──────────────────────────────────────────────────────────
let _webpush = null;
try {
  _webpush = require('web-push');
  const vapidPublic  = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  if (vapidPublic && vapidPrivate) {
    _webpush.setVapidDetails('mailto:suporte@ncsistemas.com.br', vapidPublic, vapidPrivate);
  } else {
    _webpush = null; // push desabilitado até configurar VAPID
  }
} catch (_) { _webpush = null; }

async function enviarPushVendedor(pool, idUsuario, { title, body, url = '/' }) {
  if (!_webpush) return;
  try {
    const [subs] = await pool.query(`SELECT endpoint, p256dh, auth FROM push_subscription WHERE id_usuario=?`, [idUsuario]);
    for (const s of subs) {
      const payload = JSON.stringify({ title, body, url });
      await _webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)
        .catch(async (e) => {
          if (e.statusCode === 410 || e.statusCode === 404) {
            await pool.query(`DELETE FROM push_subscription WHERE endpoint=?`, [s.endpoint]).catch(() => {});
          }
        });
    }
  } catch (_) {}
}

// ─── WhatsApp helper ──────────────────────────────────────────────────────────
async function enviarWpp(pool, idRemetente, telefone, texto) {
  const [cfgRows] = await pool.query(
    `SELECT w_urlplataforma, w_apiglobal FROM configuracao WHERE excluido='N' ORDER BY id DESC LIMIT 1`
  );
  if (!cfgRows[0]?.w_urlplataforma) throw new Error('Evolution API não configurada. Configure em Configurações > WhatsApp.');
  const { w_urlplataforma: urlBase, w_apiglobal: apikey } = cfgRows[0];
  const [uRows] = await pool.query(
    `SELECT instancia FROM usuarios WHERE idusuario=? AND excluido='N' LIMIT 1`, [idRemetente]
  );
  if (!uRows[0]?.instancia) throw new Error('Usuário sem instância WhatsApp configurada.');
  const fone = String(telefone || '').replace(/\D/g, '');
  if (!fone) throw new Error('Telefone inválido ou não cadastrado.');
  const numero = fone.startsWith('55') ? fone : `55${fone}`;
  const url = (urlBase.endsWith('/') ? urlBase.slice(0, -1) : urlBase) + `/message/sendText/${uRows[0].instancia}`;
  await axios.post(url, { number: numero, text: texto }, {
    headers: { 'Content-Type': 'application/json', apikey },
    timeout: 15000,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MIGRATIONS
// ═══════════════════════════════════════════════════════════════════════════════
let _migratedRR = false;
async function ensureRegiaoRotaCols(pool) {
  if (_migratedRR) return;
  for (const sql of [
    `ALTER TABLE regiao_rota ADD COLUMN cor VARCHAR(7) NOT NULL DEFAULT '#3b82f6'`,
    `ALTER TABLE regiao_rota ADD COLUMN observacao TEXT NULL`,
    `ALTER TABLE regiao_rota ADD COLUMN id_vendedor_padrao INT NULL DEFAULT NULL`,
  ]) await pool.query(sql).catch(() => {});
  _migratedRR = true;
}

let _migratedRotas = false;
async function ensureRotasTables(pool) {
  if (_migratedRotas) return;
  // Tabelas base
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rota_vendedor (
      id                    INT AUTO_INCREMENT PRIMARY KEY,
      descricao             VARCHAR(200) NOT NULL,
      id_regiao             INT NULL,
      id_usuario            INT NOT NULL,
      id_gestor             INT NULL,
      data_prevista         DATE NULL,
      status                VARCHAR(20)  NOT NULL DEFAULT 'PENDENTE',
      observacao            TEXT NULL,
      criado_por            INT NULL,
      criado_em             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      data_hora_inicio      DATETIME     NULL,
      data_hora_finalizacao DATETIME     NULL,
      notif_wpp_enviada     VARCHAR(1)   NOT NULL DEFAULT 'N',
      data_hora_notif       DATETIME     NULL,
      visualizado_vendedor  VARCHAR(1)   NOT NULL DEFAULT 'N',
      data_hora_visualizacao DATETIME    NULL,
      excluido              VARCHAR(1)   NOT NULL DEFAULT 'N'
    ) ENGINE=InnoDB DEFAULT CHARSET=latin1
  `).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS rota_vendedor_cliente (
      id                      INT AUTO_INCREMENT PRIMARY KEY,
      id_rota                 INT NOT NULL,
      id_cliente              INT NOT NULL,
      ordem                   INT NOT NULL DEFAULT 0,
      status_visita           VARCHAR(30)   NOT NULL DEFAULT 'PENDENTE',
      observacao              TEXT NULL,
      motivo_nao_encontrado   TEXT NULL,
      data_retorno            DATE NULL,
      data_hora_checkin       DATETIME      NULL,
      latitude_checkin        DECIMAL(10,7) NULL,
      longitude_checkin       DECIMAL(10,7) NULL,
      gps_autorizado          VARCHAR(1)    NOT NULL DEFAULT 'N',
      id_pedido_vinculado     INT NULL,
      data_hora_pedido        DATETIME      NULL,
      whatsapp_enviado        VARCHAR(1)    NOT NULL DEFAULT 'N',
      data_hora_whatsapp      DATETIME      NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=latin1
  `).catch(() => {});

  // Colunas incrementais para tabelas já existentes
  for (const sql of [
    `ALTER TABLE rota_vendedor ADD COLUMN id_gestor INT NULL`,
    `ALTER TABLE rota_vendedor ADD COLUMN data_hora_inicio DATETIME NULL`,
    `ALTER TABLE rota_vendedor ADD COLUMN data_hora_finalizacao DATETIME NULL`,
    `ALTER TABLE rota_vendedor ADD COLUMN notif_wpp_enviada VARCHAR(1) NOT NULL DEFAULT 'N'`,
    `ALTER TABLE rota_vendedor ADD COLUMN data_hora_notif DATETIME NULL`,
    `ALTER TABLE rota_vendedor ADD COLUMN visualizado_vendedor VARCHAR(1) NOT NULL DEFAULT 'N'`,
    `ALTER TABLE rota_vendedor ADD COLUMN data_hora_visualizacao DATETIME NULL`,
    `ALTER TABLE rota_vendedor_cliente ADD COLUMN motivo_nao_encontrado TEXT NULL`,
    `ALTER TABLE rota_vendedor_cliente ADD COLUMN data_retorno DATE NULL`,
    `ALTER TABLE rota_vendedor_cliente ADD COLUMN data_hora_checkin DATETIME NULL`,
    `ALTER TABLE rota_vendedor_cliente ADD COLUMN latitude_checkin DECIMAL(10,7) NULL`,
    `ALTER TABLE rota_vendedor_cliente ADD COLUMN longitude_checkin DECIMAL(10,7) NULL`,
    `ALTER TABLE rota_vendedor_cliente ADD COLUMN gps_autorizado VARCHAR(1) NOT NULL DEFAULT 'N'`,
    `ALTER TABLE rota_vendedor_cliente ADD COLUMN id_pedido_vinculado INT NULL`,
    `ALTER TABLE rota_vendedor_cliente ADD COLUMN data_hora_pedido DATETIME NULL`,
    `ALTER TABLE rota_vendedor_cliente ADD COLUMN whatsapp_enviado VARCHAR(1) NOT NULL DEFAULT 'N'`,
    `ALTER TABLE rota_vendedor_cliente ADD COLUMN data_hora_whatsapp DATETIME NULL`,
  ]) await pool.query(sql).catch(() => {});

  await ensureRegiaoRotaCols(pool);
  _migratedRotas = true;
}

// ═══════════════════════════════════════════════════════════════════════════════
// REGIÕES
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    await ensureRegiaoRotaCols(pool);
    const { q = '', status = 'A' } = req.query;
    const vals = [];
    const where = [`(r.excluido = 'N' OR r.excluido IS NULL)`];
    if (status === 'A') where.push(`(r.status = 'A' OR r.status IS NULL)`);
    else if (status === 'I') where.push(`r.status = 'I'`);
    if (q.trim()) {
      where.push(`(LOWER(r.descricao) LIKE ? OR LOWER(r.sigla) LIKE ?)`);
      vals.push(`%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`);
    }
    const wc = where.join(' AND ');
    const [rows] = await pool.query(`
      SELECT r.*, u.nomeusu AS nome_vendedor_padrao,
        (SELECT COUNT(*) FROM clientes c WHERE c.regiao = r.id AND (c.excluido='N' OR c.excluido IS NULL)) AS total_clientes
      FROM regiao_rota r
      LEFT JOIN usuarios u ON u.idusuario = r.id_vendedor_padrao
      WHERE ${wc} ORDER BY r.descricao
    `, vals);
    const [[tot]] = await pool.query(`SELECT COUNT(*) AS total FROM regiao_rota r WHERE ${wc}`, vals);
    res.json({ regioes: rows, total: tot.total });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/notificacoes', async (req, res) => {
  try {
    const pool = getPool();
    const [[a]] = await pool.query(`SELECT COUNT(*) AS n FROM regiao_rota WHERE (status='A' OR status IS NULL) AND (excluido='N' OR excluido IS NULL)`);
    const [[i]] = await pool.query(`SELECT COUNT(*) AS n FROM regiao_rota WHERE status='I' AND (excluido='N' OR excluido IS NULL)`);
    res.json({ ativos: a.n, inativos: i.n });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/lookup', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(`
      SELECT id, descricao, sigla, cor FROM regiao_rota
      WHERE (status='A' OR status IS NULL) AND (excluido='N' OR excluido IS NULL)
      ORDER BY descricao
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const pool = getPool();
    await ensureRegiaoRotaCols(pool);
    const [[row]] = await pool.query(`
      SELECT r.*, u.nomeusu AS nome_vendedor_padrao FROM regiao_rota r
      LEFT JOIN usuarios u ON u.idusuario = r.id_vendedor_padrao
      WHERE r.id = ?
    `, [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Região não encontrada' });
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id/clientes', async (req, res) => {
  try {
    const pool = getPool();
    const { q = '', limit = 500, offset = 0 } = req.query;
    const vals = [req.params.id];
    const where = [`(c.excluido='N' OR c.excluido IS NULL)`, `c.regiao = ?`];
    if (q.trim()) {
      where.push(`(LOWER(c.nome) LIKE ? OR LOWER(c.cidade) LIKE ?)`);
      vals.push(`%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`);
    }
    const wc = where.join(' AND ');
    const [rows] = await pool.query(`
      SELECT c.id, c.nome, c.apelido, c.cidade, c.uf, c.latitude, c.longitude,
        c.foneprincipal, c.email, c.cod_vendedor, c.dtultimacompra,
        CASE WHEN c.dtultimacompra IS NULL THEN 9999
             ELSE DATEDIFF(CURDATE(), c.dtultimacompra)
        END AS dias_sem_compra
      FROM clientes c WHERE ${wc} ORDER BY c.nome LIMIT ? OFFSET ?
    `, [...vals, parseInt(limit), parseInt(offset)]);
    const [[tot]] = await pool.query(`SELECT COUNT(*) AS total FROM clientes c WHERE ${wc}`, vals);
    res.json({ clientes: rows, total: tot.total });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const pc = _permRegiao(req);
    if (pc.incluir !== 'S') return negarCad(res, 'Sem permissão para incluir regiões');
    const pool = getPool();
    await ensureRegiaoRotaCols(pool);
    const { descricao, sigla, distancia = 0, cor = '#3b82f6', observacao = null, id_vendedor_padrao = null, status = 'A' } = req.body;
    if (!descricao?.trim()) return res.status(400).json({ error: 'Descrição obrigatória' });
    const [r] = await pool.query(`
      INSERT INTO regiao_rota (descricao, sigla, distancia, cor, observacao, id_vendedor_padrao, status, excluido)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'N')
    `, [descricao.trim(), sigla?.trim() || null, parseFloat(distancia) || 0, cor, observacao, id_vendedor_padrao || null, status]);
    res.status(201).json({ id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const pc = _permRegiao(req);
    if (pc.alterar !== 'S') return negarCad(res, 'Sem permissão para alterar regiões');
    const pool = getPool();
    await ensureRegiaoRotaCols(pool);
    const { descricao, sigla, distancia, cor, observacao, id_vendedor_padrao, status } = req.body;
    if (!descricao?.trim()) return res.status(400).json({ error: 'Descrição obrigatória' });
    await pool.query(`
      UPDATE regiao_rota SET descricao=?, sigla=?, distancia=?, cor=?, observacao=?, id_vendedor_padrao=?, status=? WHERE id=?
    `, [descricao.trim(), sigla?.trim() || null, parseFloat(distancia) || 0, cor || '#3b82f6', observacao || null, id_vendedor_padrao || null, status || 'A', req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const pc = _permRegiao(req);
    if (pc.excluir !== 'S') return negarCad(res, 'Sem permissão para excluir regiões');
    const pool = getPool();
    await pool.query(`UPDATE regiao_rota SET excluido='S' WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Helper: verifica se o usuário pode operar sobre uma rota ────────────────
async function checkRotaAccess(pool, idRota, user, { soAdminGerente = false } = {}) {
  const [[rota]] = await pool.query(`SELECT id_usuario FROM rota_vendedor WHERE id=? AND excluido='N'`, [idRota]);
  if (!rota) return { ok: false, status: 404, error: 'Rota não encontrada' };
  const isAdmin   = user.perfil == 1 || user.acessartodosclientes === 'S';
  const isGerente = user.gerentecomercial === 'S';
  if (soAdminGerente && !isAdmin && !isGerente) return { ok: false, status: 403, error: 'Sem permissão' };
  if (!isAdmin && !isGerente && rota.id_usuario !== user.id) return { ok: false, status: 403, error: 'Sem permissão' };
  return { ok: true };
}

// ─── Helper: conclui rota automaticamente se todos os clientes foram atendidos ─
async function autoConluirRotaSeCompleta(pool, idRota) {
  const [[{ total, pendentes }]] = await pool.query(`
    SELECT
      COUNT(*) AS total,
      SUM(status_visita NOT IN ('VISITADO','PEDIDO_REALIZADO','NAO_ENCONTRADO','REAGENDAR')) AS pendentes
    FROM rota_vendedor_cliente
    WHERE id_rota = ?
  `, [idRota]);
  if (total > 0 && pendentes == 0) {
    await pool.query(`
      UPDATE rota_vendedor
      SET status = 'CONCLUIDA', data_hora_finalizacao = COALESCE(data_hora_finalizacao, NOW())
      WHERE id = ? AND excluido = 'N' AND status != 'CONCLUIDA'
    `, [idRota]);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROTAS DE VENDEDOR — rotas específicas ANTES de /:id
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /rotas-vendedor/vapid-public ────────────────────────────────────────
router.get('/rotas-vendedor/vapid-public', (req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY || '';
  res.type('text/plain').send(key);
});

// ─── GET /rotas-vendedor/lista ────────────────────────────────────────────────
router.get('/rotas-vendedor/lista', async (req, res) => {
  try {
    const pool = getPool();
    await ensureRotasTables(pool);
    const isAdmin  = req.user.perfil == 1 || req.user.acessartodosclientes === 'S';
    const isGerente = req.user.gerentecomercial === 'S';
    const { id_usuario, status, data_inicio, data_fim, hoje = '', q = '', limit = 100, offset = 0 } = req.query;
    const vals  = [];
    const where = [`rv.excluido = 'N'`];

    if (!isAdmin && !isGerente) {
      where.push(`rv.id_usuario = ?`); vals.push(req.user.id);
    } else if (id_usuario) {
      where.push(`rv.id_usuario = ?`); vals.push(id_usuario);
    }
    if (status) { where.push(`rv.status = ?`); vals.push(status); }
    if (hoje === '1') {
      where.push(`DATE(rv.data_prevista) = CURDATE()`);
    } else {
      if (data_inicio) { where.push(`rv.data_prevista >= ?`); vals.push(data_inicio); }
      if (data_fim)    { where.push(`rv.data_prevista <= ?`); vals.push(data_fim); }
    }
    if (q.trim()) {
      where.push(`(LOWER(rv.descricao) LIKE ? OR LOWER(u.nomeusu) LIKE ?)`);
      vals.push(`%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`);
    }
    const wc = where.join(' AND ');
    const [rows] = await pool.query(`
      SELECT rv.*,
        rr.descricao AS nome_regiao, rr.cor AS cor_regiao, rr.sigla AS sigla_regiao,
        u.nomeusu AS nome_vendedor,
        uc.nomeusu AS nome_criador,
        (SELECT COUNT(*) FROM rota_vendedor_cliente rvc WHERE rvc.id_rota = rv.id) AS total_clientes,
        (SELECT COUNT(*) FROM rota_vendedor_cliente rvc WHERE rvc.id_rota = rv.id AND rvc.status_visita IN ('VISITADO','PEDIDO_REALIZADO')) AS total_visitados,
        (SELECT COUNT(*) FROM rota_vendedor_cliente rvc WHERE rvc.id_rota = rv.id AND rvc.status_visita = 'PEDIDO_REALIZADO') AS total_pedidos,
        (SELECT COUNT(*) FROM rota_vendedor_cliente rvc WHERE rvc.id_rota = rv.id AND rvc.status_visita = 'NAO_ENCONTRADO') AS total_nao_enc
      FROM rota_vendedor rv
      LEFT JOIN regiao_rota rr ON rr.id = rv.id_regiao
      LEFT JOIN usuarios u ON u.idusuario = rv.id_usuario
      LEFT JOIN usuarios uc ON uc.idusuario = rv.criado_por
      WHERE ${wc}
      ORDER BY rv.data_prevista DESC, rv.criado_em DESC
      LIMIT ? OFFSET ?
    `, [...vals, parseInt(limit), parseInt(offset)]);
    const [[tot]] = await pool.query(`
      SELECT COUNT(*) AS total FROM rota_vendedor rv
      LEFT JOIN usuarios u ON u.idusuario = rv.id_usuario
      WHERE ${wc}
    `, vals);
    res.json({ rotas: rows, total: tot.total });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /rotas-vendedor/minhas-rotas-pendentes ──────────────────────────────
// Retorna rotas PENDENTE ou EM_ANDAMENTO do vendedor logado, para alerta na home
router.get('/rotas-vendedor/minhas-rotas-pendentes', async (req, res) => {
  try {
    const pool = getPool();
    await ensureRotasTables(pool);
    const [rows] = await pool.query(`
      SELECT rv.id, rv.descricao, rv.data_prevista, rv.status, rv.criado_em,
        rr.descricao AS nome_regiao, rr.cor AS cor_regiao,
        (SELECT COUNT(*) FROM rota_vendedor_cliente WHERE id_rota=rv.id) AS total_clientes,
        (SELECT COUNT(*) FROM rota_vendedor_cliente WHERE id_rota=rv.id AND status_visita IN ('VISITADO','PEDIDO_REALIZADO')) AS visitados
      FROM rota_vendedor rv
      LEFT JOIN regiao_rota rr ON rr.id=rv.id_regiao
      WHERE rv.id_usuario=? AND rv.excluido='N' AND rv.status IN ('PENDENTE','EM_ANDAMENTO')
      ORDER BY ISNULL(rv.data_prevista), rv.data_prevista ASC, rv.criado_em DESC
      LIMIT 10
    `, [req.user.id]);
    res.json({ rotas: rows, total: rows.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /rotas-vendedor/resumo-dia ───────────────────────────────────────────
// Stats do dia para o mobile top bar
router.get('/rotas-vendedor/resumo-dia', async (req, res) => {
  try {
    const pool = getPool();
    await ensureRotasTables(pool);
    const [[stats]] = await pool.query(`
      SELECT
        COUNT(DISTINCT rv.id) AS total_rotas,
        COUNT(rvc.id) AS total_clientes,
        SUM(rvc.status_visita IN ('VISITADO','PEDIDO_REALIZADO')) AS visitados,
        SUM(rvc.status_visita = 'PEDIDO_REALIZADO') AS pedidos,
        (SELECT COUNT(*) FROM rota_vendedor rv2 WHERE rv2.id_usuario=? AND rv2.excluido='N'
          AND rv2.status IN ('PENDENTE','EM_ANDAMENTO')) AS rotas_pendentes
      FROM rota_vendedor rv
      LEFT JOIN rota_vendedor_cliente rvc ON rvc.id_rota=rv.id
      WHERE rv.id_usuario=? AND rv.excluido='N'
        AND DATE(rv.data_prevista)=CURDATE()
        AND rv.status IN ('PENDENTE','EM_ANDAMENTO','CONCLUIDA')
    `, [req.user.id, req.user.id]);
    res.json(stats);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST /rotas-vendedor/push-subscription ───────────────────────────────────
// Salva subscription PWA do vendedor
router.post('/rotas-vendedor/push-subscription', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS push_subscription (
        id INT AUTO_INCREMENT PRIMARY KEY,
        id_usuario INT NOT NULL,
        endpoint TEXT NOT NULL,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_endpoint (endpoint(255))
      ) ENGINE=InnoDB DEFAULT CHARSET=latin1
    `).catch(() => {});
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) return res.status(400).json({ error: 'Dados inválidos' });
    await pool.query(`
      INSERT INTO push_subscription (id_usuario, endpoint, p256dh, auth)
      VALUES (?,?,?,?)
      ON DUPLICATE KEY UPDATE id_usuario=VALUES(id_usuario), p256dh=VALUES(p256dh), auth=VALUES(auth)
    `, [req.user.id, endpoint, keys.p256dh, keys.auth]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /rotas-vendedor/minhas-notificacoes ──────────────────────────────────
router.get('/rotas-vendedor/minhas-notificacoes', async (req, res) => {
  try {
    const pool = getPool();
    await ensureRotasTables(pool);
    const [rows] = await pool.query(`
      SELECT rv.id, rv.descricao, rv.data_prevista, rv.status, rv.criado_em,
        uc.nomeusu AS nome_gestor,
        (SELECT COUNT(*) FROM rota_vendedor_cliente WHERE id_rota = rv.id) AS qtde_clientes
      FROM rota_vendedor rv
      LEFT JOIN usuarios uc ON uc.idusuario = rv.criado_por
      WHERE rv.id_usuario = ? AND rv.excluido = 'N'
        AND rv.visualizado_vendedor = 'N' AND rv.status IN ('PENDENTE','EM_ANDAMENTO')
      ORDER BY rv.criado_em DESC
    `, [req.user.id]);
    res.json({ notificacoes: rows, total: rows.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /rotas-vendedor/clientes-em-rota — IDs dos clientes em rota ativa ───
router.get('/rotas-vendedor/clientes-em-rota', async (req, res) => {
  try {
    const pool = getPool();
    await ensureRotasTables(pool);
    const [rows] = await pool.query(`
      SELECT rvc.id_cliente, rv.id AS id_rota, rv.descricao, rvc.status_visita, rv.status AS status_rota
      FROM rota_vendedor_cliente rvc
      JOIN rota_vendedor rv ON rv.id = rvc.id_rota
      WHERE rv.id_usuario = ? AND rv.excluido = 'N'
        AND rv.status IN ('PENDENTE','EM_ANDAMENTO')
      ORDER BY rv.data_prevista ASC, rvc.ordem ASC
    `, [req.user.id]);
    const seen = new Set();
    const items = [];
    for (const r of rows) {
      if (seen.has(r.id_cliente)) continue;
      seen.add(r.id_cliente);
      items.push(r);
    }
    res.json({ ids: items.map(r => r.id_cliente), items });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /rotas-vendedor/check-cliente — verifica se cliente está em rota aberta ─
router.get('/rotas-vendedor/check-cliente', async (req, res) => {
  try {
    const pool = getPool();
    await ensureRotasTables(pool);
    const { id_cliente } = req.query;
    const userId = req.query.id_usuario || req.user.id;
    const [rows] = await pool.query(`
      SELECT rv.id, rv.descricao, rvc.status_visita, rvc.id AS id_item
      FROM rota_vendedor_cliente rvc
      JOIN rota_vendedor rv ON rv.id = rvc.id_rota
      WHERE rvc.id_cliente = ? AND rv.id_usuario = ? AND rv.excluido = 'N'
        AND rv.status IN ('PENDENTE','EM_ANDAMENTO')
      LIMIT 1
    `, [id_cliente, userId]);
    res.json({ rota: rows[0] || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /rotas-vendedor/relatorio-produtividade ──────────────────────────────
router.get('/rotas-vendedor/relatorio-produtividade', async (req, res) => {
  try {
    const pool = getPool();
    await ensureRotasTables(pool);
    const isAdmin   = req.user.perfil == 1 || req.user.acessartodosclientes === 'S';
    const isGerente = req.user.gerentecomercial === 'S';
    const { data_inicio, data_fim, id_usuario } = req.query;
    const vals  = [];
    const where = [`rv.excluido = 'N'`];
    if (!isAdmin && !isGerente) {
      where.push(`rv.id_usuario = ?`); vals.push(req.user.id);
    } else if (id_usuario) {
      where.push(`rv.id_usuario = ?`); vals.push(id_usuario);
    }
    if (data_inicio) { where.push(`rv.data_prevista >= ?`); vals.push(data_inicio); }
    if (data_fim)    { where.push(`rv.data_prevista <= ?`); vals.push(data_fim); }
    const wc = where.join(' AND ');
    const [rows] = await pool.query(`
      SELECT
        u.nomeusu AS vendedor,
        COUNT(DISTINCT rv.id) AS total_rotas,
        COUNT(rvc.id) AS total_clientes,
        SUM(rvc.status_visita IN ('VISITADO','PEDIDO_REALIZADO')) AS total_visitados,
        SUM(rvc.status_visita = 'NAO_ENCONTRADO') AS total_nao_enc,
        SUM(rvc.status_visita = 'PEDIDO_REALIZADO') AS total_pedidos,
        SUM(rvc.status_visita = 'REAGENDAR') AS total_reagendados,
        SUM(rvc.id_pedido_vinculado IS NOT NULL) AS pedidos_vinculados,
        ROUND(SUM(rvc.status_visita IN ('VISITADO','PEDIDO_REALIZADO')) / NULLIF(COUNT(rvc.id),0) * 100, 1) AS taxa_conversao
      FROM rota_vendedor rv
      JOIN usuarios u ON u.idusuario = rv.id_usuario
      LEFT JOIN rota_vendedor_cliente rvc ON rvc.id_rota = rv.id
      WHERE ${wc}
      GROUP BY rv.id_usuario, u.nomeusu
      ORDER BY total_visitados DESC
    `, vals);
    res.json({ relatorio: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /rotas-vendedor/mapa-calor ──────────────────────────────────────────
router.get('/rotas-vendedor/mapa-calor', async (req, res) => {
  try {
    const pool = getPool();
    await ensureRotasTables(pool);
    const { data_inicio, data_fim } = req.query;
    const vals  = [];
    const where = [`rv.excluido = 'N'`, `c.latitude IS NOT NULL`, `c.longitude IS NOT NULL`];
    if (data_inicio) { where.push(`rv.data_prevista >= ?`); vals.push(data_inicio); }
    if (data_fim)    { where.push(`rv.data_prevista <= ?`); vals.push(data_fim); }
    const wc = where.join(' AND ');
    const [rows] = await pool.query(`
      SELECT c.id, c.nome, c.latitude, c.longitude, c.cidade, c.uf,
        COUNT(rvc.id) AS total_visitas,
        SUM(rvc.status_visita IN ('VISITADO','PEDIDO_REALIZADO')) AS visitas_realizadas,
        SUM(rvc.status_visita = 'PEDIDO_REALIZADO') AS pedidos_realizados,
        MAX(rvc.data_hora_checkin) AS ultimo_checkin
      FROM rota_vendedor_cliente rvc
      JOIN rota_vendedor rv ON rv.id = rvc.id_rota
      JOIN clientes c ON c.id = rvc.id_cliente
      WHERE ${wc}
      GROUP BY c.id
      ORDER BY total_visitas DESC LIMIT 500
    `, vals);
    res.json({ pontos: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /rotas-vendedor/:id ──────────────────────────────────────────────────
router.get('/rotas-vendedor/:id', async (req, res) => {
  try {
    const pool = getPool();
    await ensureRotasTables(pool);
    const [[rota]] = await pool.query(`
      SELECT rv.*,
        rr.descricao AS nome_regiao, rr.cor AS cor_regiao, rr.sigla AS sigla_regiao,
        u.nomeusu AS nome_vendedor, u.foneprincipal AS fone_vendedor,
        uc.nomeusu AS nome_criador
      FROM rota_vendedor rv
      LEFT JOIN regiao_rota rr ON rr.id = rv.id_regiao
      LEFT JOIN usuarios u ON u.idusuario = rv.id_usuario
      LEFT JOIN usuarios uc ON uc.idusuario = rv.criado_por
      WHERE rv.id = ? AND rv.excluido = 'N'
    `, [req.params.id]);
    if (!rota) return res.status(404).json({ error: 'Rota não encontrada' });

    const [clientes] = await pool.query(`
      SELECT rvc.*,
        c.nome, c.apelido, c.cidade, c.uf, c.foneprincipal, c.endereco, c.bairro, c.cep,
        c.latitude, c.longitude, c.dtultimacompra,
        DATEDIFF(CURDATE(), c.dtultimacompra) AS dias_sem_compra
      FROM rota_vendedor_cliente rvc
      JOIN clientes c ON c.id = rvc.id_cliente
      WHERE rvc.id_rota = ?
      ORDER BY rvc.ordem ASC, c.nome ASC
    `, [req.params.id]);
    res.json({ ...rota, clientes });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST /rotas-vendedor ─────────────────────────────────────────────────────
router.post('/rotas-vendedor', async (req, res) => {
  try {
    const pool = getPool();
    await ensureRotasTables(pool);
    const { descricao, id_regiao, id_usuario, data_prevista, observacao, clientes = [] } = req.body;
    if (!descricao?.trim()) return res.status(400).json({ error: 'Descrição obrigatória' });
    if (!id_usuario) return res.status(400).json({ error: 'Vendedor obrigatório' });

    const [r] = await pool.query(`
      INSERT INTO rota_vendedor (descricao, id_regiao, id_usuario, id_gestor, data_prevista, observacao, criado_por, status, excluido)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDENTE', 'N')
    `, [descricao.trim(), id_regiao || null, id_usuario, req.user.id, data_prevista || null, observacao || null, req.user.id]);
    const idRota = r.insertId;

    if (clientes.length) {
      const vals = clientes.map((c, i) => [idRota, c.id_cliente || c, i + 1, 'PENDENTE']);
      await pool.query(`INSERT INTO rota_vendedor_cliente (id_rota, id_cliente, ordem, status_visita) VALUES ?`, [vals]);
    }
    res.status(201).json({ id: idRota });

    // Push PWA para o vendedor (fire-and-forget)
    enviarPushVendedor(pool, id_usuario, {
      title: '📍 Nova rota atribuída',
      body: `${descricao.trim()} — ${clientes.length} cliente(s)`,
      url: '/mobile-shell.html'
    }).catch(() => {});
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PUT /rotas-vendedor/:id — preserva dados de visita já registrados ────────
router.put('/rotas-vendedor/:id', async (req, res) => {
  try {
    const pool = getPool();
    const idRota = req.params.id;
    const acc = await checkRotaAccess(pool, idRota, req.user, { soAdminGerente: true });
    if (!acc.ok) return res.status(acc.status).json({ error: acc.error });
    const { descricao, id_regiao, id_usuario, data_prevista, observacao, status, clientes } = req.body;
    await pool.query(`
      UPDATE rota_vendedor SET descricao=?, id_regiao=?, id_usuario=?, data_prevista=?, observacao=?, status=?
      WHERE id=? AND excluido='N'
    `, [descricao, id_regiao || null, id_usuario, data_prevista || null, observacao || null, status || 'PENDENTE', idRota]);

    if (Array.isArray(clientes)) {
      const novosIds = clientes.map(c => c.id_cliente || c).filter(Boolean);
      // Remove clientes que saíram da lista
      if (novosIds.length) {
        await pool.query(`DELETE FROM rota_vendedor_cliente WHERE id_rota=? AND id_cliente NOT IN (?)`, [idRota, novosIds]);
      } else {
        await pool.query(`DELETE FROM rota_vendedor_cliente WHERE id_rota=?`, [idRota]);
      }
      // Upsert preservando dados de visita
      for (let i = 0; i < clientes.length; i++) {
        const idCliente = clientes[i].id_cliente || clientes[i];
        const [ex] = await pool.query(`SELECT id FROM rota_vendedor_cliente WHERE id_rota=? AND id_cliente=?`, [idRota, idCliente]);
        if (ex.length) {
          await pool.query(`UPDATE rota_vendedor_cliente SET ordem=? WHERE id_rota=? AND id_cliente=?`, [i + 1, idRota, idCliente]);
        } else {
          await pool.query(`INSERT INTO rota_vendedor_cliente (id_rota, id_cliente, ordem, status_visita) VALUES (?,?,?,'PENDENTE')`, [idRota, idCliente, i + 1]);
        }
      }
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PATCH /rotas-vendedor/:id/status ────────────────────────────────────────
router.patch('/rotas-vendedor/:id/status', async (req, res) => {
  try {
    const pool = getPool();
    const acc = await checkRotaAccess(pool, req.params.id, req.user);
    if (!acc.ok) return res.status(acc.status).json({ error: acc.error });
    const { status } = req.body;
    if (status === 'EM_ANDAMENTO') {
      await pool.query(`
        UPDATE rota_vendedor SET status=?,
          data_hora_inicio = COALESCE(data_hora_inicio, NOW()),
          visualizado_vendedor = 'S',
          data_hora_visualizacao = COALESCE(data_hora_visualizacao, NOW())
        WHERE id=? AND excluido='N'
      `, [status, req.params.id]);
    } else if (status === 'CONCLUIDA') {
      await pool.query(`
        UPDATE rota_vendedor SET status=?, data_hora_finalizacao = NOW()
        WHERE id=? AND excluido='N'
      `, [status, req.params.id]);
    } else {
      await pool.query(`UPDATE rota_vendedor SET status=? WHERE id=? AND excluido='N'`, [status, req.params.id]);
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PATCH /rotas-vendedor/:id/visualizar ────────────────────────────────────
router.patch('/rotas-vendedor/:id/visualizar', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(`
      UPDATE rota_vendedor SET visualizado_vendedor='S',
        data_hora_visualizacao = COALESCE(data_hora_visualizacao, NOW())
      WHERE id=? AND excluido='N'
    `, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PATCH /rotas-vendedor/:id/reordenar ─────────────────────────────────────
router.patch('/rotas-vendedor/:id/reordenar', async (req, res) => {
  try {
    const pool = getPool();
    const acc = await checkRotaAccess(pool, req.params.id, req.user);
    if (!acc.ok) return res.status(acc.status).json({ error: acc.error });
    const { ordem = [] } = req.body;
    for (const item of ordem) {
      await pool.query(`UPDATE rota_vendedor_cliente SET ordem=? WHERE id_rota=? AND id_cliente=?`,
        [item.ordem, req.params.id, item.id_cliente]);
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PATCH /rotas-vendedor/:id/cliente/:idCliente/status ─────────────────────
router.patch('/rotas-vendedor/:id/cliente/:idCliente/status', async (req, res) => {
  try {
    const pool = getPool();
    const acc = await checkRotaAccess(pool, req.params.id, req.user);
    if (!acc.ok) return res.status(acc.status).json({ error: acc.error });
    const {
      status_visita, observacao, motivo_nao_encontrado, data_retorno,
      latitude, longitude, gps_autorizado = 'N',
    } = req.body;

    const sets = [
      'status_visita=?', 'observacao=?', 'motivo_nao_encontrado=?',
      'data_retorno=?', 'data_hora_checkin=NOW()', 'gps_autorizado=?',
    ];
    const vals = [status_visita, observacao || null, motivo_nao_encontrado || null, data_retorno || null, gps_autorizado];

    if (latitude != null && longitude != null) {
      sets.push('latitude_checkin=?', 'longitude_checkin=?');
      vals.push(latitude, longitude);
    }
    vals.push(req.params.id, req.params.idCliente);

    await pool.query(`UPDATE rota_vendedor_cliente SET ${sets.join(',')} WHERE id_rota=? AND id_cliente=?`, vals);

    // Inicia a rota automaticamente se ainda estiver PENDENTE
    await pool.query(`
      UPDATE rota_vendedor SET
        status = IF(status='PENDENTE','EM_ANDAMENTO',status),
        data_hora_inicio = COALESCE(data_hora_inicio, NOW())
      WHERE id=? AND excluido='N' AND status='PENDENTE'
    `, [req.params.id]);

    // Auto-conclusão: se todos os clientes foram visitados, conclui a rota
    await autoConluirRotaSeCompleta(pool, req.params.id);

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PATCH /rotas-vendedor/:id/cliente/:idCliente/vincular-pedido ─────────────
router.patch('/rotas-vendedor/:id/cliente/:idCliente/vincular-pedido', async (req, res) => {
  try {
    const pool = getPool();
    const acc = await checkRotaAccess(pool, req.params.id, req.user);
    if (!acc.ok) return res.status(acc.status).json({ error: acc.error });
    const { id_pedido } = req.body;
    await pool.query(`
      UPDATE rota_vendedor_cliente SET
        id_pedido_vinculado=?, data_hora_pedido=NOW(),
        status_visita='PEDIDO_REALIZADO', data_hora_checkin=COALESCE(data_hora_checkin,NOW())
      WHERE id_rota=? AND id_cliente=?
    `, [id_pedido, req.params.id, req.params.idCliente]);
    // Inicia rota automaticamente
    await pool.query(`
      UPDATE rota_vendedor SET
        status=IF(status='PENDENTE','EM_ANDAMENTO',status),
        data_hora_inicio=COALESCE(data_hora_inicio,NOW())
      WHERE id=? AND excluido='N' AND status='PENDENTE'
    `, [req.params.id]);

    // Auto-conclusão: se todos os clientes foram atendidos, conclui a rota
    await autoConluirRotaSeCompleta(pool, req.params.id);

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST /rotas-vendedor/:id/notificar-wpp — avisa vendedor via WhatsApp ─────
router.post('/rotas-vendedor/:id/notificar-wpp', async (req, res) => {
  try {
    const pool = getPool();
    const [[rota]] = await pool.query(`
      SELECT rv.*, u.nomeusu AS nome_vendedor, u.foneprincipal AS fone_vendedor,
        uc.nomeusu AS nome_gestor,
        (SELECT COUNT(*) FROM rota_vendedor_cliente WHERE id_rota=rv.id) AS qtde
      FROM rota_vendedor rv
      LEFT JOIN usuarios u ON u.idusuario = rv.id_usuario
      LEFT JOIN usuarios uc ON uc.idusuario = rv.criado_por
      WHERE rv.id=? AND rv.excluido='N'
    `, [req.params.id]);
    if (!rota) return res.status(404).json({ error: 'Rota não encontrada' });

    const data = rota.data_prevista
      ? new Date(rota.data_prevista.toString().substring(0, 10) + 'T12:00:00').toLocaleDateString('pt-BR')
      : 'sem data definida';
    const { mensagem } = req.body;
    const texto = mensagem ||
      `Olá, ${rota.nome_vendedor}! Uma nova rota foi criada para você: *${rota.descricao}*, com *${rota.qtde}* cliente(s), para o dia *${data}*.\n\nAcesse o sistema para visualizar e iniciar as visitas. Boas vendas! 🚀`;

    await enviarWpp(pool, req.user.id, rota.fone_vendedor, texto);
    await pool.query(`UPDATE rota_vendedor SET notif_wpp_enviada='S', data_hora_notif=NOW() WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST /rotas-vendedor/:id/cliente/:idCliente/whatsapp-chegando ────────────
router.post('/rotas-vendedor/:id/cliente/:idCliente/whatsapp-chegando', async (req, res) => {
  try {
    const pool = getPool();
    const [[cli]] = await pool.query(`
      SELECT c.nome, c.foneprincipal, u.nomeusu AS nome_vendedor
      FROM rota_vendedor_cliente rvc
      JOIN clientes c ON c.id = rvc.id_cliente
      JOIN rota_vendedor rv ON rv.id = rvc.id_rota
      JOIN usuarios u ON u.idusuario = rv.id_usuario
      WHERE rvc.id_rota=? AND rvc.id_cliente=?
    `, [req.params.id, req.params.idCliente]);
    if (!cli) return res.status(404).json({ error: 'Cliente não encontrado na rota' });

    const { mensagem } = req.body;
    const texto = mensagem ||
      `Olá, *${cli.nome}*! Aqui é *${cli.nome_vendedor}*. Estou a caminho para realizar sua visita. Em breve estarei aí. Obrigado! 😊`;

    await enviarWpp(pool, req.user.id, cli.foneprincipal, texto);
    await pool.query(`
      UPDATE rota_vendedor_cliente SET whatsapp_enviado='S', data_hora_whatsapp=NOW()
      WHERE id_rota=? AND id_cliente=?
    `, [req.params.id, req.params.idCliente]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── DELETE /rotas-vendedor/:id ───────────────────────────────────────────────
router.delete('/rotas-vendedor/:id', async (req, res) => {
  try {
    const pool = getPool();
    const acc = await checkRotaAccess(pool, req.params.id, req.user, { soAdminGerente: true });
    if (!acc.ok) return res.status(acc.status).json({ error: acc.error });
    await pool.query(`UPDATE rota_vendedor SET excluido='S' WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
