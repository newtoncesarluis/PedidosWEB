/**
 * Rotas de gestão de licenças — Portal de licenças do SysRepWeb
 * Acesso protegido por senha de desenvolvedor (DEV_PASSWORD no .env)
 * Conecta à base Oracle central (config/db-license.js)
 */
const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');

const { getPool }            = require('../config/database');
const { getLicensePool }     = require('../config/db-license');
const LicenseService         = require('../services/license-service');
const { invalidateLicenseCache } = require('../middleware/license');

const DEV_PASSWORD  = process.env.DEV_PASSWORD || 'mudar@123';
const MAX_ATTEMPTS  = 5;
const BLOCK_TIME    = 15 * 60 * 1000; // 15 min
const failedAttempts = {};

// ── Middleware de autenticação ─────────────────────────────────────────────
function devAuth(req, res, next) {
  const ip  = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  if (failedAttempts[ip]?.count >= MAX_ATTEMPTS) {
    if (now - failedAttempts[ip].time < BLOCK_TIME) {
      const rem = Math.ceil((BLOCK_TIME - (now - failedAttempts[ip].time)) / 60000);
      return res.status(429).json({ error: `IP bloqueado por ${rem} minuto(s) por excesso de tentativas.` });
    }
    delete failedAttempts[ip];
  }
  const senha = req.headers['x-dev-password'] || req.body?.senha || req.query?.senha;
  if (senha !== DEV_PASSWORD) {
    if (!failedAttempts[ip]) failedAttempts[ip] = { count: 0, time: now };
    failedAttempts[ip].count++;
    failedAttempts[ip].time = now;
    return res.status(401).json({ error: 'Senha incorreta', tentativas_restantes: MAX_ATTEMPTS - failedAttempts[ip].count });
  }
  delete failedAttempts[ip];
  next();
}

// POST /api/licencas/auth — verifica senha e retorna token de sessão
router.post('/auth', (req, res) => {
  const ip  = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  if (failedAttempts[ip]?.count >= MAX_ATTEMPTS) {
    if (now - failedAttempts[ip].time < BLOCK_TIME) {
      const rem = Math.ceil((BLOCK_TIME - (now - failedAttempts[ip].time)) / 60000);
      return res.status(429).json({ error: `Bloqueado por ${rem} min` });
    }
    delete failedAttempts[ip];
  }
  const { senha } = req.body;
  if (senha !== DEV_PASSWORD) {
    if (!failedAttempts[ip]) failedAttempts[ip] = { count: 0, time: now };
    failedAttempts[ip].count++;
    failedAttempts[ip].time = now;
    return res.status(401).json({ error: 'Senha incorreta', tentativas_restantes: MAX_ATTEMPTS - failedAttempts[ip].count });
  }
  delete failedAttempts[ip];
  const token = crypto.createHmac('sha256', DEV_PASSWORD).update(Date.now().toString()).digest('hex');
  res.json({ sucesso: true, token, expira_em: Date.now() + 7200000 });
});

// Todas as rotas abaixo exigem autenticação
router.use(devAuth);

// ── LICENÇA LOCAL ──────────────────────────────────────────────────────────

// GET /api/licencas/license — status da licença local
router.get('/license', async (req, res) => {
  try {
    res.json(await LicenseService.checkLocal());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/licencas/license/demo — ativa modo demo (30 dias)
router.post('/license/demo', async (req, res) => {
  try {
    const result = await LicenseService.activateDemo();
    invalidateLicenseCache();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/licencas/license/activate — ativa por chave
router.post('/license/activate', async (req, res) => {
  try {
    const { chave, dados_cliente } = req.body;
    if (!chave) return res.status(400).json({ error: 'Chave obrigatória' });
    const result = await LicenseService.activateLicense(chave, dados_cliente);
    if (result.sucesso) invalidateLicenseCache();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/licencas/license/sync — sincroniza com Oracle remoto
router.post('/license/sync', async (req, res) => {
  try {
    const pool = getPool();
    let chave = (req.body?.chave_licenca || '').trim().toUpperCase() || null;
    if (chave) {
      const [rows] = await pool.query('SELECT chave_licenca FROM config_licenca WHERE chave_licenca = ?', [chave]);
      if (!rows.length) return res.json({ sucesso: false, nao_instalada: true, mensagem: 'Alteração registrada na base central. O servidor do cliente sincronizará em até 24h.' });
    } else {
      const [rows] = await pool.query('SELECT chave_licenca FROM config_licenca LIMIT 1');
      if (!rows.length) return res.json({ sucesso: false, nao_instalada: true, mensagem: 'Nenhuma licença ativada neste servidor.' });
      chave = rows[0].chave_licenca;
    }
    const result = await LicenseService.syncWithRemote(chave);
    if (result.sucesso) invalidateLicenseCache();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CONFIGURAÇÕES DE SUPORTE / PIX ────────────────────────────────────────

// GET /api/licencas/support-config
router.get('/support-config', (_req, res) => {
  res.json({
    suporte_whatsapp: process.env.SUPORTE_WHATSAPP || '',
    suporte_nome:     process.env.SUPORTE_NOME     || '',
    suporte_email:    process.env.SUPORTE_EMAIL    || '',
    pix_tipo:         process.env.PIX_TIPO         || '',
    pix_chave:        process.env.PIX_CHAVE        || '',
    pix_nome:         process.env.PIX_NOME         || '',
    pix_descricao:    process.env.PIX_DESCRICAO    || '',
  });
});

// POST /api/licencas/support-config
router.post('/support-config', (req, res) => {
  const fs   = require('fs');
  const path = require('path');
  const envPath = path.join(process.cwd(), '.env');
  try {
    const fields = {
      SUPORTE_WHATSAPP: req.body.suporte_whatsapp,
      SUPORTE_NOME:     req.body.suporte_nome,
      SUPORTE_EMAIL:    req.body.suporte_email,
      PIX_TIPO:         req.body.pix_tipo,
      PIX_CHAVE:        req.body.pix_chave,
      PIX_NOME:         req.body.pix_nome,
      PIX_DESCRICAO:    req.body.pix_descricao,
    };
    let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    for (const [key, val] of Object.entries(fields)) {
      if (val === undefined) continue;
      const re   = new RegExp(`^${key}=.*$`, 'm');
      const line = `${key}=${val}`;
      env = re.test(env) ? env.replace(re, line) : env.trimEnd() + '\n' + line;
      process.env[key] = val;
    }
    fs.writeFileSync(envPath, env.trimEnd() + '\n');
    res.json({ sucesso: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── BASE ORACLE REMOTA ─────────────────────────────────────────────────────

// GET /api/licencas/license/remote/ping — testa conexão remota
router.get('/license/remote/ping', async (req, res) => {
  const cfg = {
    host:     process.env.LICENSE_DB_HOST || process.env.DB_HOST || 'localhost',
    port:     process.env.LICENSE_DB_PORT || '3306',
    user:     process.env.LICENSE_DB_USER || process.env.DB_USER || '(não definido)',
    database: process.env.LICENSE_DB_NAME || 'sistemas_licencas',
  };
  try {
    const licPool = getLicensePool();
    const [[row]] = await licPool.query('SELECT COUNT(*) as total FROM sistema_licencas');
    res.json({ ok: true, config: cfg, total_licencas: row.total });
  } catch (err) {
    res.json({ ok: false, config: cfg, erro: err.message });
  }
});

// GET /api/licencas/license/remote/stats — estatísticas do dashboard
router.get('/license/remote/stats', async (req, res) => {
  try {
    const licPool = getLicensePool();
    const [[stats]] = await licPool.query(`
      SELECT
        COUNT(*) as total,
        SUM(status = 'ativo')     as ativos,
        SUM(status = 'bloqueado') as bloqueados,
        SUM(status IN ('trial','demo')) as trials,
        SUM(status = 'expirado' OR (data_fim IS NOT NULL AND data_fim < CURDATE() AND status = 'ativo')) as expirados,
        SUM(status = 'ativo' AND data_fim IS NOT NULL AND data_fim >= CURDATE() AND data_fim <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)) as vencendo_30d,
        SUM(status = 'ativo' AND data_fim IS NOT NULL AND data_fim >= CURDATE() AND data_fim <= DATE_ADD(CURDATE(), INTERVAL 7 DAY))  as vencendo_7d
      FROM sistema_licencas
    `);
    const [expirando] = await licPool.query(`
      SELECT id, razao_social, chave_licenca, data_fim, status, whatsapp, email,
             DATEDIFF(data_fim, CURDATE()) as dias_restantes
      FROM sistema_licencas
      WHERE status = 'ativo' AND data_fim IS NOT NULL AND data_fim >= CURDATE()
        AND data_fim <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
      ORDER BY data_fim ASC LIMIT 10
    `);
    const [recentes] = await licPool.query(`
      SELECT id, razao_social, chave_licenca, status, data_ultimo_acesso
      FROM sistema_licencas WHERE data_ultimo_acesso IS NOT NULL
      ORDER BY data_ultimo_acesso DESC LIMIT 5
    `);
    res.json({ stats, expirando, recentes });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao acessar base remota: ' + err.message });
  }
});

// GET /api/licencas/license/remote/search — busca com filtros
router.get('/license/remote/search', async (req, res) => {
  try {
    const licPool = getLicensePool();
    const { q, status, tipo } = req.query;
    let where  = '1=1';
    const params = [];
    if (q)      { where += ' AND (razao_social LIKE ? OR chave_licenca LIKE ? OR cnpj_cpf LIKE ? OR email LIKE ? OR cidade LIKE ?)'; params.push(...Array(5).fill(`%${q}%`)); }
    if (status) { where += ' AND status = ?'; params.push(status); }
    if (tipo)   { where += ' AND tipo_licenca = ?'; params.push(tipo); }
    const [rows] = await licPool.query(
      `SELECT * FROM sistema_licencas WHERE ${where} ORDER BY criado_em DESC LIMIT 200`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao acessar base remota: ' + err.message });
  }
});

// GET /api/licencas/license/remote/:id — detalhes + histórico
router.get('/license/remote/:id', async (req, res) => {
  try {
    const licPool = getLicensePool();
    const [[lic]] = await licPool.query('SELECT * FROM sistema_licencas WHERE id = ?', [req.params.id]);
    if (!lic) return res.status(404).json({ error: 'Licença não encontrada' });
    const [historico] = await licPool.query(
      'SELECT * FROM historico_licencas WHERE licenca_id = ? ORDER BY data_hora DESC LIMIT 30',
      [req.params.id]
    );
    res.json({ ...lic, historico });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/licencas/license/remote/create — cria licença na base Oracle
router.post('/license/remote/create', async (req, res) => {
  try {
    const licPool = getLicensePool();
    const {
      chave_licenca, razao_social, cnpj_cpf, email, telefone, whatsapp, cidade, estado,
      tipo_licenca, data_inicio, data_fim, limite_usuarios, valor_mensal, observacoes, status,
    } = req.body;
    const chave = (chave_licenca || '').trim().toUpperCase() || LicenseService.generateKey();

    const [result] = await licPool.query(
      `INSERT INTO sistema_licencas
         (chave_licenca, razao_social, cnpj_cpf, email, telefone, whatsapp, cidade, estado,
          tipo_licenca, data_inicio, data_fim, limite_usuarios,
          valor_mensal, observacoes, status, ativo, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
      [chave, razao_social, cnpj_cpf || null, email || null, telefone || null,
       whatsapp || null, cidade || null, estado || null,
       tipo_licenca || 'anual', data_inicio || null, data_fim || null,
       limite_usuarios || 10, valor_mensal || null, observacoes || null, status || 'ativo']
    );

    await licPool.query(
      'INSERT INTO historico_licencas (licenca_id, acao, detalhes) VALUES (?, ?, ?)',
      [result.insertId, 'criacao', JSON.stringify({ chave, razao_social, tipo_licenca })]
    );

    res.json({ sucesso: true, chave, id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar licença: ' + err.message });
  }
});

// PUT /api/licencas/license/remote/:id — atualiza status (bloquear/desbloquear/etc)
router.put('/license/remote/:id', async (req, res) => {
  try {
    const licPool = getLicensePool();
    const { status, data_fim, motivo_bloqueio, limite_usuarios } = req.body;
    const campos = {};
    if (status !== undefined)           campos.status           = status;
    if (data_fim !== undefined)         campos.data_fim         = data_fim;
    if (motivo_bloqueio !== undefined)  campos.motivo_bloqueio  = motivo_bloqueio;
    if (limite_usuarios !== undefined)  campos.limite_usuarios  = limite_usuarios;
    if (status === 'bloqueado')         campos.bloqueado_em     = new Date();

    const sets = Object.keys(campos).map(k => `${k} = ?`);
    const vals = [...Object.values(campos), req.params.id];
    await licPool.query(`UPDATE sistema_licencas SET ${sets.join(', ')} WHERE id = ?`, vals);

    const acao = status === 'bloqueado' ? 'bloqueio' : (status === 'ativo' ? 'desbloqueio' : 'alteracao');
    await licPool.query(
      'INSERT INTO historico_licencas (licenca_id, acao, detalhes) VALUES (?, ?, ?)',
      [req.params.id, acao, JSON.stringify(req.body)]
    );

    // Replica para config_licenca local se essa chave estiver instalada
    const [[lic]] = await licPool.query('SELECT chave_licenca FROM sistema_licencas WHERE id = ?', [req.params.id]);
    if (lic) {
      const pool = getPool();
      const [local] = await pool.query('SELECT id FROM config_licenca WHERE chave_licenca = ?', [lic.chave_licenca]);
      if (local.length) {
        await pool.query(
          `UPDATE config_licenca SET status = ?, data_expiracao = ?, ultima_verificacao = NOW() WHERE chave_licenca = ?`,
          [status || 'ativo', data_fim || null, lic.chave_licenca]
        );
        invalidateLicenseCache();
      }
    }

    res.json({ sucesso: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/licencas/license/remote/:id/edit — editar dados do cliente
router.put('/license/remote/:id/edit', async (req, res) => {
  try {
    const licPool = getLicensePool();
    const {
      razao_social, cnpj_cpf, email, telefone, whatsapp, cidade, estado,
      tipo_licenca, status, data_inicio, data_fim, limite_usuarios,
      valor_mensal, observacoes,
    } = req.body;

    await licPool.query(`
      UPDATE sistema_licencas SET
        razao_social=?, cnpj_cpf=?, email=?, telefone=?, whatsapp=?, cidade=?, estado=?,
        tipo_licenca=?, status=?, data_inicio=?, data_fim=?,
        limite_usuarios=?, valor_mensal=?, observacoes=?
      WHERE id=?`,
      [razao_social, cnpj_cpf||null, email||null, telefone||null, whatsapp||null,
       cidade||null, estado||null, tipo_licenca, status||'ativo', data_inicio||null, data_fim||null,
       limite_usuarios, valor_mensal||null, observacoes||null, req.params.id]
    );

    await licPool.query('INSERT INTO historico_licencas (licenca_id, acao, detalhes) VALUES (?, ?, ?)',
      [req.params.id, 'edicao', JSON.stringify(req.body)]);

    // Replica para local
    const [[licRec]] = await licPool.query('SELECT chave_licenca FROM sistema_licencas WHERE id = ?', [req.params.id]);
    if (licRec) {
      const pool = getPool();
      const [local] = await pool.query('SELECT id FROM config_licenca WHERE chave_licenca = ?', [licRec.chave_licenca]);
      if (local.length) {
        await pool.query(
          `UPDATE config_licenca SET status = ?, data_expiracao = ?, ultima_verificacao = NOW() WHERE chave_licenca = ?`,
          [status || 'ativo', data_fim || null, licRec.chave_licenca]
        );
        invalidateLicenseCache();
      }
    }

    res.json({ sucesso: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/licencas/license/remote/:id/renew — renovar licença
router.post('/license/remote/:id/renew', async (req, res) => {
  try {
    const licPool = getLicensePool();
    const { meses = 12 } = req.body;
    const [[lic]] = await licPool.query('SELECT * FROM sistema_licencas WHERE id = ?', [req.params.id]);
    if (!lic) return res.status(404).json({ error: 'Não encontrada' });

    const mesesN = parseInt(meses);
    let novaData = null;
    if (mesesN > 0) {
      const base = lic.data_fim && new Date(lic.data_fim) > new Date() ? new Date(lic.data_fim) : new Date();
      base.setMonth(base.getMonth() + mesesN);
      novaData = base.toISOString().split('T')[0];
    }

    await licPool.query(
      `UPDATE sistema_licencas SET data_fim = ?, status = 'ativo' WHERE id = ?`,
      [novaData, req.params.id]
    );
    await licPool.query('INSERT INTO historico_licencas (licenca_id, acao, detalhes) VALUES (?, ?, ?)',
      [req.params.id, 'renovacao', JSON.stringify({ meses, nova_data_fim: novaData, anterior: lic.data_fim })]);

    // Replica para local
    const pool = getPool();
    const [local] = await pool.query('SELECT id FROM config_licenca WHERE chave_licenca = ?', [lic.chave_licenca]);
    if (local.length) {
      await pool.query(
        `UPDATE config_licenca SET status = 'ativo', data_expiracao = ?, ultima_verificacao = NOW() WHERE chave_licenca = ?`,
        [novaData, lic.chave_licenca]
      );
      invalidateLicenseCache();
    }

    res.json({ sucesso: true, nova_data_fim: novaData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/licencas/license/remote/:id — deletar licença
router.delete('/license/remote/:id', async (req, res) => {
  try {
    const licPool = getLicensePool();
    await licPool.query('DELETE FROM sistema_licencas WHERE id = ?', [req.params.id]);
    res.json({ sucesso: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/licencas/license/remote/history/:id — histórico de uma licença
router.get('/license/remote/history/:id', async (req, res) => {
  try {
    const licPool = getLicensePool();
    const [rows] = await licPool.query(
      'SELECT * FROM historico_licencas WHERE licenca_id = ? ORDER BY data_hora DESC LIMIT 50',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
