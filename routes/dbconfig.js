const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const { testConnection, createPool } = require('../config/database');

const TECH_PASSWORD = 'kzf010557f';
const ENV_PATH      = path.join(process.cwd(), '.env');

// ── Atualiza variáveis no arquivo .env ───────────────────────────────────────
function updateEnvFile(updates) {
  let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    content = regex.test(content)
      ? content.replace(regex, `${key}=${value}`)
      : content + `\n${key}=${value}`;
  }
  fs.writeFileSync(ENV_PATH, content, 'utf8');
}

// ── Aplica nova conexão: atualiza process.env e recria o pool ────────────────
// Recebe objeto com chaves: host, port, database, user, password (todas strings)
function applyConnection({ host, port, database, user, password }) {
  if (!host || !database || !user) {
    throw new Error('Parâmetros de conexão inválidos em applyConnection');
  }
  process.env.DB_HOST = host;
  process.env.DB_PORT = String(parseInt(port, 10) || 3306);
  process.env.DB_NAME = database;
  process.env.DB_USER = user;
  if (password !== undefined && password !== '') {
    process.env.DB_PASSWORD = password;
  }
  createPool();
}

// ── Valida senha técnica ─────────────────────────────────────────────────────
function checkAuth(req, res) {
  const pwd = req.headers['x-tech-password'] || req.body?.techPassword;
  if (pwd !== TECH_PASSWORD) {
    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '?';
    console.warn(`[dbconfig] Acesso negado — IP: ${ip} — ${new Date().toISOString()}`);
    res.status(403).json({ error: 'Acesso restrito' });
    return false;
  }
  return true;
}

// ── Verifica se o banco está configurado e acessível ────────────────────────
async function isDatabaseConfigured() {
  const host = process.env.DB_HOST;
  const name = process.env.DB_NAME;
  const user = process.env.DB_USER;
  if (!host || !name || !user) return false;
  const result = await testConnection({
    host, port: parseInt(process.env.DB_PORT, 10) || 3306,
    database: name, user, password: process.env.DB_PASSWORD || '',
  }).catch(() => ({ ok: false }));
  return result.ok;
}

// ────────────────────────────────────────────────────────────────────────────
//  ROTAS PÚBLICAS (sem senha)
// ────────────────────────────────────────────────────────────────────────────

// GET /api/dbconfig/status — informa se o banco está configurado e acessível
router.get('/status', async (req, res) => {
  // Modo bound: CHAVE_LICENCA amarra o processo a um tenant — DB vem da Oracle
  const { getBoundChave } = require('../config/database');
  if (getBoundChave()) {
    return res.json({ configured: true, mode: 'bound' });
  }

  // No modo CUSTOMER_DB_FROM_LICENSE o banco operacional vem da licença, não do .env.
  // Retorna "configured" para que o login.html não abra o modal de banco e deixe
  // o fluxo de licença controlar o acesso.
  const fromLicense = process.env.CUSTOMER_DB_FROM_LICENSE;
  if (fromLicense === '1' || String(fromLicense).toLowerCase() === 'true' || String(fromLicense).toLowerCase() === 'yes') {
    return res.json({ configured: true, mode: 'license' });
  }

  const host = process.env.DB_HOST;
  const name = process.env.DB_NAME;
  const user = process.env.DB_USER;

  if (!host || !name || !user) {
    return res.json({ configured: false, reason: 'missing_config' });
  }

  try {
    const result = await testConnection({
      host, port: parseInt(process.env.DB_PORT, 10) || 3306,
      database: name, user, password: process.env.DB_PASSWORD || '',
    });
    res.json({
      configured: result.ok,
      reason:     result.ok ? null : 'connection_failed',
      error:      result.ok ? undefined : result.error,
    });
  } catch (err) {
    res.json({ configured: false, reason: 'connection_failed', error: err.message });
  }
});

// POST /api/dbconfig/test — testa uma conexão sem persistir nada (público)
router.post('/test', async (req, res) => {
  const { host, port, database, user, password } = req.body;
  if (!host || !database || !user) {
    return res.status(400).json({ ok: false, error: 'Preencha todos os campos obrigatórios' });
  }
  const result = await testConnection({
    host, port: parseInt(port, 10) || 3306,
    database, user, password: password || '',
  }).catch(err => ({ ok: false, error: err.message }));
  res.json(result);
});

// POST /api/dbconfig/firstuse — configuração inicial (só funciona se banco NÃO estiver OK)
router.post('/firstuse', async (req, res) => {
  // Bloqueia se banco já estiver funcionando
  const alreadyOk = await isDatabaseConfigured();
  if (alreadyOk) {
    return res.status(403).json({
      ok: false,
      error: 'Sistema já configurado. Use o acesso técnico para alterações.',
    });
  }

  const { host, port, database, user, password } = req.body;
  if (!host || !database || !user) {
    return res.status(400).json({ ok: false, error: 'Preencha todos os campos obrigatórios' });
  }

  // Valida conexão antes de salvar
  const test = await testConnection({
    host, port: parseInt(port, 10) || 3306,
    database, user, password: password || '',
  }).catch(err => ({ ok: false, error: err.message }));

  if (!test.ok) {
    return res.json({
      ok: false,
      error: 'Não foi possível validar a conexão: ' + (test.error || 'falha desconhecida'),
    });
  }

  try {
    const portStr = String(parseInt(port, 10) || 3306);

    updateEnvFile({
      DB_HOST:     host,
      DB_PORT:     portStr,
      DB_NAME:     database,
      DB_USER:     user,
      DB_PASSWORD: password || '',
    });

    applyConnection({ host, port: portStr, database, user, password: password || '' });

    res.json({ ok: true });
  } catch (err) {
    console.error('[dbconfig/firstuse] Falha ao salvar:', err.message);
    res.status(500).json({ ok: false, error: 'Falha ao salvar configuração' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
//  ROTAS PROTEGIDAS (exigem senha técnica)
// ────────────────────────────────────────────────────────────────────────────

// GET /api/dbconfig/current — retorna configuração ativa (sem senha do banco)
router.get('/current', (req, res) => {
  if (!checkAuth(req, res)) return;
  res.json({
    host:     process.env.DB_HOST || '',
    port:     process.env.DB_PORT || '3306',
    database: process.env.DB_NAME || '',
    user:     process.env.DB_USER || '',
  });
});

// POST /api/dbconfig/save — persiste alterações no .env e reaplica o pool
router.post('/save', async (req, res) => {
  if (!checkAuth(req, res)) return;

  const { host, port, database, user, password } = req.body;
  if (!host || !database || !user) {
    return res.status(400).json({ ok: false, error: 'Dados de conexão inválidos' });
  }

  try {
    const portStr = String(parseInt(port, 10) || 3306);

    const envUpdates = {
      DB_HOST: host,
      DB_PORT: portStr,
      DB_NAME: database,
      DB_USER: user,
    };
    if (password && password.trim() !== '') {
      envUpdates.DB_PASSWORD = password;
    }

    updateEnvFile(envUpdates);

    // Passa os valores nomeados corretamente — sem spread de objeto com chaves DB_*
    applyConnection({
      host,
      port:     portStr,
      database,
      user,
      password: password || '',
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[dbconfig/save] Falha ao salvar:', err.message);
    res.status(500).json({ ok: false, error: 'Falha ao salvar configuração' });
  }
});

module.exports = router;
