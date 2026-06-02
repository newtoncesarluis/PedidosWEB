/**
 * Rotas de gestão de licenças — Portal de licenças do SysRepWeb
 * Acesso protegido por senha de desenvolvedor (DEV_PASSWORD no .env)
 * Conecta à base Oracle central (config/db-license.js)
 */
const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');

const { getPool, customerDbFromLicense } = require('../config/database');
const { getLicensePool }     = require('../config/db-license');
const LicenseService         = require('../services/license-service');
const { invalidateLicenseCache } = require('../middleware/license');
const axios                  = require('axios');

const DEV_EMAIL     = (process.env.DEV_EMAIL || '').toLowerCase().trim();
const DEV_PASSWORD  = process.env.DEV_PASSWORD || 'mudar@123';
const MAX_ATTEMPTS  = 5;
const BLOCK_TIME    = 15 * 60 * 1000; // 15 min
const failedAttempts  = {};
const unblockTokens   = {}; // token → { ip, expires }

// ── Desbloqueio por email ──────────────────────────────────────────────────
function gerarTokenDesbloqueio(ip) {
  const token = crypto.randomBytes(32).toString('hex');
  unblockTokens[token] = { ip, expires: Date.now() + 2 * 60 * 60 * 1000 }; // 2h
  return token;
}

async function enviarAlertaWhatsApp(ip, req) {
  const numero   = (process.env.DEV_WHATSAPP || '').replace(/\D/g, '');
  const wappUrl  = process.env.WAPP_URL;
  const wappKey  = process.env.WAPP_KEY;
  const instancia= process.env.WAPP_INSTANCE;
  if (!numero || !wappUrl || !wappKey || !instancia) {
    // Tenta ler config do banco como fallback
    try {
      const pool = getPool();
      const [rows] = await pool.query(
        `SELECT w_urlplataforma, w_apiglobal FROM configuracao WHERE excluido='N' ORDER BY id DESC LIMIT 1`
      );
      if (!rows[0]?.w_urlplataforma || !numero) {
        console.warn('[licencas] WhatsApp não configurado — alerta de bloqueio não enviado');
        return;
      }
      process.env.WAPP_URL  = rows[0].w_urlplataforma;
      process.env.WAPP_KEY  = rows[0].w_apiglobal;
    } catch {
      console.warn('[licencas] WhatsApp não configurado — alerta de bloqueio não enviado');
      return;
    }
  }

  const token   = gerarTokenDesbloqueio(ip);
  const baseUrl = process.env.BASE_URL || `http://${req.headers.host}`;
  const link    = `${baseUrl}/api/licencas/unblock?token=${token}`;
  const hora    = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  const texto = [
    `🔒 *Painel de Licenças bloqueado*`,
    ``,
    `${MAX_ATTEMPTS} tentativas incorretas de login às ${hora}.`,
    `IP: ${ip}`,
    ``,
    `Para desbloquear, acesse o link abaixo:`,
    link,
    ``,
    `_Link válido por 2 horas._`,
  ].join('\n');

  const url = `${(process.env.WAPP_URL || '').replace(/\/$/, '')}/message/sendText/${process.env.WAPP_INSTANCE || instancia}`;
  axios.post(url, { number: numero, text: texto }, {
    headers: { 'Content-Type': 'application/json', apikey: process.env.WAPP_KEY || wappKey },
    timeout: 10000,
  }).catch(err => console.error('[licencas] Erro ao enviar WhatsApp de bloqueio:', err.message));
}

// GET /api/licencas/unblock — rota pública, desbloqueia IP via token do email
router.get('/unblock', (req, res) => {
  const { token } = req.query;
  const entry = token && unblockTokens[token];
  if (!entry) {
    return res.status(400).send('<h2>Link inválido ou já utilizado.</h2>');
  }
  if (Date.now() > entry.expires) {
    delete unblockTokens[token];
    return res.status(410).send('<h2>Link expirado. Solicite um novo tentando fazer login novamente.</h2>');
  }
  const { ip } = entry;
  delete unblockTokens[token];
  delete failedAttempts[ip];
  res.send(`
    <div style="font-family:sans-serif;max-width:400px;margin:60px auto;text-align:center">
      <div style="font-size:48px">✅</div>
      <h2 style="color:#16a34a">IP desbloqueado com sucesso!</h2>
      <p style="color:#6b7280">O acesso ao Painel de Licenças foi liberado.<br>
      Você já pode fechar esta aba.</p>
    </div>`);
});

// ── Middleware de autenticação ─────────────────────────────────────────────
// Contagem de tentativas só em POST /auth (evita 10×401 no dashboard com sessão expirada = bloqueio instantâneo).
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
    return res.status(401).json({ error: 'Senha incorreta ou sessão expirada. Faça login novamente.' });
  }
  delete failedAttempts[ip];
  next();
}

// POST /api/licencas/auth — verifica email + senha e retorna token de sessão
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
  const { email, senha } = req.body;
  const emailOk = DEV_EMAIL ? (email || '').toLowerCase().trim() === DEV_EMAIL : true;
  if (!emailOk || senha !== DEV_PASSWORD) {
    if (!failedAttempts[ip]) failedAttempts[ip] = { count: 0, time: now };
    failedAttempts[ip].count++;
    failedAttempts[ip].time = now;
    if (failedAttempts[ip].count >= MAX_ATTEMPTS) {
      enviarAlertaWhatsApp(ip, req);
    }
    return res.status(401).json({ error: 'E-mail ou senha incorretos', tentativas_restantes: Math.max(0, MAX_ATTEMPTS - failedAttempts[ip].count) });
  }
  delete failedAttempts[ip];
  const token = crypto.createHmac('sha256', DEV_PASSWORD).update(Date.now().toString()).digest('hex');
  res.json({ sucesso: true, token, expira_em: Date.now() + 7200000 });
});

// GET /api/licencas/license/remote/ping — público: só testa conectividade com o servidor de licenças
// (sem devAuth — usado pelo diagnóstico do login.html)
router.get('/license/remote/ping', async (req, res) => {
  const cfg = {
    host:     process.env.LICENSE_DB_HOST || process.env.DB_HOST || 'localhost',
    port:     process.env.LICENSE_DB_PORT || '3306',
    user:     process.env.LICENSE_DB_USER || process.env.DB_USER || '(não definido)',
    database: process.env.LICENSE_DB_NAME || 'sistema_licencas',
  };
  try {
    const licPool = getLicensePool();
    const [[row]] = await licPool.query('SELECT COUNT(*) as total FROM sistema_licencas');
    res.json({ ok: true, config: cfg, total_licencas: row.total });
  } catch (err) {
    res.json({ ok: false, config: cfg, erro: err.message });
  }
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
    let chave = (req.body?.chave_licenca || '').trim().toUpperCase() || null;
    if (!customerDbFromLicense()) {
      const pool = getPool();
      if (chave) {
        const [rows] = await pool.query('SELECT chave_licenca FROM config_licenca WHERE chave_licenca = ?', [chave]);
        if (!rows.length) return res.json({ sucesso: false, nao_instalada: true, mensagem: 'Alteração registrada na base central. O servidor do cliente sincronizará em até 24h.' });
      } else {
        const [rows] = await pool.query('SELECT chave_licenca FROM config_licenca LIMIT 1');
        if (!rows.length) return res.json({ sucesso: false, nao_instalada: true, mensagem: 'Nenhuma licença ativada neste servidor.' });
        chave = rows[0].chave_licenca;
      }
    }
    if (!chave) return res.json({ sucesso: false, mensagem: 'Informe a chave_licenca no body.' });
    const result = await LicenseService.syncWithRemote(chave);
    if (result.sucesso) invalidateLicenseCache(chave);
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

// GET /api/licencas/license/remote/minhas — licenças do responsável logado
router.get('/license/remote/minhas', async (req, res) => {
  try {
    const licPool = getLicensePool();
    const [rows] = await licPool.query(
      `SELECT * FROM sistema_licencas WHERE responsavel_email = ? ORDER BY razao_social`,
      [DEV_EMAIL]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/licencas/license/remote/sessoes — clientes online (último acesso < 15 min), excluindo "minhas"
router.get('/license/remote/sessoes', async (req, res) => {
  try {
    const licPool = getLicensePool();
    const [rows] = await licPool.query(
      `SELECT id, razao_social, chave_licenca, status, tipo_licenca,
              cidade, estado, whatsapp, data_ultimo_acesso, responsavel
       FROM sistema_licencas
       WHERE ativo = 1
         AND data_ultimo_acesso >= NOW() - INTERVAL 15 MINUTE
         AND (responsavel_email IS NULL OR responsavel_email != ?)
       ORDER BY data_ultimo_acesso DESC`,
      [DEV_EMAIL]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
      responsavel, responsavel_email,
      mysql_host, mysql_port, mysql_database, mysql_user, mysql_password,
    } = req.body;
    const chave = (chave_licenca || '').trim().toUpperCase() || LicenseService.generateKey();

    const [result] = await licPool.query(
      `INSERT INTO sistema_licencas
         (chave_licenca, razao_social, cnpj_cpf, email, telefone, whatsapp, cidade, estado,
          tipo_licenca, data_inicio, data_fim, limite_usuarios,
          valor_mensal, observacoes, status, responsavel, responsavel_email,
          mysql_host, mysql_port, mysql_database, mysql_user, mysql_password,
          ativo, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
      [chave, razao_social, cnpj_cpf || null, email || null, telefone || null,
       whatsapp || null, cidade || null, estado || null,
       tipo_licenca || 'anual', data_inicio || null, data_fim || null,
       limite_usuarios || 10, valor_mensal || null, observacoes || null, status || 'ativo',
       responsavel || null, responsavel_email || null,
       mysql_host || null, mysql_port || null, mysql_database || null,
       mysql_user || null, mysql_password || null]
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

    // Invalida cache dessa licença e replica para config_licenca (somente single-tenant)
    const [[lic]] = await licPool.query('SELECT chave_licenca FROM sistema_licencas WHERE id = ?', [req.params.id]);
    if (lic) {
      invalidateLicenseCache(lic.chave_licenca);
      if (!customerDbFromLicense()) {
        try {
          const pool = getPool();
          const [local] = await pool.query('SELECT id FROM config_licenca WHERE chave_licenca = ?', [lic.chave_licenca]);
          if (local.length) {
            await pool.query(
              `UPDATE config_licenca SET status = ?, data_expiracao = ?, ultima_verificacao = NOW() WHERE chave_licenca = ?`,
              [status || 'ativo', data_fim || null, lic.chave_licenca]
            );
          }
        } catch { /* silencioso */ }
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
      valor_mensal, observacoes, responsavel, responsavel_email,
      mysql_host, mysql_port, mysql_database, mysql_user, mysql_password,
    } = req.body;

    await licPool.query(`
      UPDATE sistema_licencas SET
        razao_social=?, cnpj_cpf=?, email=?, telefone=?, whatsapp=?, cidade=?, estado=?,
        tipo_licenca=?, status=?, data_inicio=?, data_fim=?,
        limite_usuarios=?, valor_mensal=?, observacoes=?,
        responsavel=?, responsavel_email=?,
        mysql_host=?, mysql_port=?, mysql_database=?, mysql_user=?,
        mysql_password=COALESCE(NULLIF(?, ''), mysql_password)
      WHERE id=?`,
      [razao_social, cnpj_cpf||null, email||null, telefone||null, whatsapp||null,
       cidade||null, estado||null, tipo_licenca, status||'ativo', data_inicio||null, data_fim||null,
       limite_usuarios, valor_mensal||null, observacoes||null,
       responsavel||null, responsavel_email||null,
       mysql_host||null, mysql_port||null, mysql_database||null, mysql_user||null,
       mysql_password||null, req.params.id]
    );

    await licPool.query('INSERT INTO historico_licencas (licenca_id, acao, detalhes) VALUES (?, ?, ?)',
      [req.params.id, 'edicao', JSON.stringify(req.body)]);

    // Invalida cache dessa licença e replica para config_licenca (somente single-tenant)
    const [[licRec]] = await licPool.query('SELECT chave_licenca FROM sistema_licencas WHERE id = ?', [req.params.id]);
    if (licRec) {
      invalidateLicenseCache(licRec.chave_licenca);
      if (!customerDbFromLicense()) {
        try {
          const pool = getPool();
          const [local] = await pool.query('SELECT id FROM config_licenca WHERE chave_licenca = ?', [licRec.chave_licenca]);
          if (local.length) {
            await pool.query(
              `UPDATE config_licenca SET status = ?, data_expiracao = ?, ultima_verificacao = NOW() WHERE chave_licenca = ?`,
              [status || 'ativo', data_fim || null, licRec.chave_licenca]
            );
          }
        } catch { /* silencioso */ }
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

    // Invalida cache dessa licença e replica para config_licenca (somente single-tenant)
    invalidateLicenseCache(lic.chave_licenca);
    if (!customerDbFromLicense()) {
      try {
        const pool = getPool();
        const [local] = await pool.query('SELECT id FROM config_licenca WHERE chave_licenca = ?', [lic.chave_licenca]);
        if (local.length) {
          await pool.query(
            `UPDATE config_licenca SET status = 'ativo', data_expiracao = ?, ultima_verificacao = NOW() WHERE chave_licenca = ?`,
            [novaData, lic.chave_licenca]
          );
        }
      } catch { /* silencioso */ }
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
