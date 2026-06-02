'use strict';

const express        = require('express');
const { exec, spawn } = require('child_process');
const fs             = require('fs');
const path           = require('path');
const os             = require('os');
const https          = require('https');

// Carrega .env do app principal
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const app  = express();
const PORT = parseInt(process.env.ADMIN_PORT || '4200', 10);
const ADMIN_TOKEN   = process.env.ADMIN_TOKEN   || 'nc-admin-2024';
const INSTANCES_DIR = process.env.INSTANCES_DIR || '/home/ubuntu/pedidosweb-clients';
const APP_DIR       = process.env.APP_DIR        || '/home/ubuntu/pedidosweb';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Auth ──────────────────────────────────────────────────────────────────────
function auth(req, res, next) {
  const t = req.headers['x-admin-token'] || req.query.token;
  if (t !== ADMIN_TOKEN) return res.status(401).json({ error: 'Token inválido' });
  next();
}

// ── Helpers básicos ───────────────────────────────────────────────────────────
function pm2List() {
  return new Promise(resolve => {
    exec('pm2 jlist', { timeout: 10000 }, (_err, stdout) => {
      try { resolve(JSON.parse(stdout || '[]')); } catch { resolve([]); }
    });
  });
}

function parseEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const r = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([^#=\s][^=]*?)\s*=\s*(.*?)\s*$/);
    if (m) r[m[1]] = m[2];
  }
  return r;
}

function getSlugs() {
  if (!fs.existsSync(INSTANCES_DIR)) return [];
  return fs.readdirSync(INSTANCES_DIR).filter(d =>
    fs.statSync(path.join(INSTANCES_DIR, d)).isDirectory() &&
    fs.existsSync(path.join(INSTANCES_DIR, d, '.env'))
  );
}

function execAsync(cmd, opts = {}) {
  return new Promise(resolve => {
    exec(cmd, { timeout: 8000, ...opts }, (_err, stdout) => resolve((stdout || '').trim()));
  });
}

// ── SSL Expiry ────────────────────────────────────────────────────────────────
const sslCache = new Map(); // slug → { expiry: Date|null, checkedAt: number }

async function checkSSL(slug, domainBase) {
  const cached = sslCache.get(slug);
  if (cached && Date.now() - cached.checkedAt < 12 * 3600 * 1000) return cached.expiry;

  const domain = `${slug}.${domainBase || 'nresolutions.com.br'}`;
  const candidates = [
    `/etc/letsencrypt/live/${domain}/fullchain.pem`,
    `/etc/letsencrypt/live/${domainBase || 'nresolutions.com.br'}/fullchain.pem`,
  ];

  let expiry = null;
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const out = await execAsync(`sudo openssl x509 -enddate -noout -in ${p} 2>/dev/null`);
    const m   = out.match(/notAfter=(.+)/);
    if (m) { expiry = new Date(m[1]); break; }
  }

  sslCache.set(slug, { expiry, checkedAt: Date.now() });
  return expiry;
}

// ── WhatsApp Alert ────────────────────────────────────────────────────────────
function sendWhatsAppAlert(instanceName, prevStatus, newStatus) {
  const url      = process.env.EVOLUTION_URL;
  const key      = process.env.EVOLUTION_KEY;
  const instance = process.env.EVOLUTION_INSTANCE;
  const phone    = process.env.ALERT_PHONE;
  if (!url || !key || !instance || !phone) return;

  const text =
    `⚠️ *NC Sistemas — Alerta*\n\n` +
    `Instância *${instanceName}* caiu!\n` +
    `Status: \`${prevStatus}\` → \`${newStatus}\`\n\n` +
    `Acesse: http://admin.nresolutions.com.br`;

  const body = JSON.stringify({ number: phone, text });
  const urlObj = new URL(`${url}/message/sendText/${instance}`);
  const opts = {
    hostname: urlObj.hostname,
    port:     urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
    path:     urlObj.pathname,
    method:   'POST',
    headers:  { 'Content-Type': 'application/json', apikey: key, 'Content-Length': Buffer.byteLength(body) },
  };
  const mod = urlObj.protocol === 'https:' ? https : require('http');
  const req = mod.request(opts, () => {});
  req.on('error', () => {});
  req.write(body);
  req.end();
}

// ── Metrics ring buffer + status watcher ─────────────────────────────────────
const HISTORY     = [];
const prevStatus  = new Map();

async function snapshot() {
  const list = await pm2List();
  const procs = list.filter(p => p.name?.startsWith('sysrep-'));

  // Detecta mudanças de status
  for (const p of procs) {
    const curr = p.pm2_env?.status ?? 'unknown';
    const prev = prevStatus.get(p.name);
    if (prev && prev !== curr && curr !== 'online') {
      sendWhatsAppAlert(p.name, prev, curr);
    }
    prevStatus.set(p.name, curr);
  }

  HISTORY.push({
    ts: Date.now(),
    procs: procs.map(p => ({
      name:   p.name,
      slug:   p.name.replace('sysrep-', ''),
      cpu:    p.monit?.cpu    ?? 0,
      mem:    p.monit?.memory ?? 0,
      status: p.pm2_env?.status ?? 'unknown',
    })),
    sys: { free: os.freemem(), total: os.totalmem(), load: os.loadavg()[0] },
  });
  if (HISTORY.length > 60) HISTORY.shift();
}

snapshot();
setInterval(snapshot, 30000);

// ── Provision jobs ────────────────────────────────────────────────────────────
const jobs = new Map(); // id → { output, done, error, slug }

// ── API ───────────────────────────────────────────────────────────────────────
app.get('/api/system', auth, (_req, res) => {
  res.json({
    hostname: os.hostname(),
    uptime:   os.uptime(),
    loadavg:  os.loadavg(),
    totalMem: os.totalmem(),
    freeMem:  os.freemem(),
    cpuCount: os.cpus().length,
  });
});

app.get('/api/instances', auth, async (_req, res) => {
  const [list, slugs] = await Promise.all([pm2List(), Promise.resolve(getSlugs())]);
  const byName = Object.fromEntries(
    list.filter(p => p.name?.startsWith('sysrep-')).map(p => [p.name, p])
  );

  const instances = await Promise.all(slugs.map(async slug => {
    const env    = parseEnv(path.join(INSTANCES_DIR, slug, '.env'));
    const proc   = byName[`sysrep-${slug}`];
    const ssl    = await checkSSL(slug, 'nresolutions.com.br').catch(() => null);
    const sslDaysLeft = ssl ? Math.ceil((ssl.getTime() - Date.now()) / 86400000) : null;

    return {
      slug,
      status:       proc?.pm2_env?.status  ?? 'stopped',
      pid:          proc?.pid              ?? null,
      port:         env.PORT               ?? null,
      chave:        env.CHAVE_LICENCA      ?? null,
      domain:       `https://${slug}.nresolutions.com.br`,
      uptime:       proc?.pm2_env?.pm_uptime ?? null,
      restarts:     proc?.pm2_env?.restart_time ?? 0,
      cpu:          proc?.monit?.cpu    ?? 0,
      memory:       proc?.monit?.memory ?? 0,
      sslDaysLeft,
    };
  }));

  res.json(instances);
});

app.get('/api/metrics/history', auth, (_req, res) => res.json(HISTORY));

app.get('/api/instances/:slug/logs', auth, (req, res) => {
  const lines = Math.min(parseInt(req.query.lines || '150', 10), 500);
  exec(
    `pm2 logs sysrep-${req.params.slug} --lines ${lines} --nostream --no-color 2>&1`,
    { timeout: 12000 },
    (_err, out) => res.json({ logs: out || '' })
  );
});

app.post('/api/instances/:slug/:action', auth, (req, res) => {
  const { slug, action } = req.params;
  const cmds = {
    restart: `pm2 restart sysrep-${slug} --update-env`,
    stop:    `pm2 stop sysrep-${slug}`,
    start:   `pm2 start sysrep-${slug}`,
  };
  if (!cmds[action]) return res.status(400).json({ error: 'Ação inválida' });
  exec(cmds[action], { timeout: 15000 }, err =>
    err ? res.status(500).json({ error: err.message }) : res.json({ ok: true })
  );
});

// ── Provision ─────────────────────────────────────────────────────────────────
app.post('/api/provision', auth, (req, res) => {
  const { slug, chave, domainBase } = req.body;
  if (!slug || !chave) return res.status(400).json({ error: 'Slug e chave são obrigatórios' });
  if (!/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: 'Slug inválido (só letras minúsculas, números e hífen)' });

  const jobId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const job   = { output: '', done: false, error: null, slug };
  jobs.set(jobId, job);

  const script = path.join(APP_DIR, 'novo-cliente.sh');
  const args   = [slug, chave.toUpperCase(), domainBase || 'nresolutions.com.br'];
  const child  = spawn('bash', [script, ...args], { env: { ...process.env } });

  child.stdout.on('data', d => { job.output += d.toString(); });
  child.stderr.on('data', d => { job.output += d.toString(); });
  child.on('close', code => {
    job.done  = true;
    job.error = code !== 0 ? `Processo encerrou com código ${code}` : null;
    setTimeout(() => jobs.delete(jobId), 600000); // limpa após 10 min
  });

  res.json({ jobId });
});

app.get('/api/provision/:jobId', auth, (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job não encontrado' });
  res.json({ output: job.output, done: job.done, error: job.error, slug: job.slug });
});

// ── Config WhatsApp Alerts (leitura) ─────────────────────────────────────────
app.get('/api/config/alerts', auth, (_req, res) => {
  res.json({
    configured: !!(process.env.EVOLUTION_URL && process.env.EVOLUTION_KEY && process.env.EVOLUTION_INSTANCE && process.env.ALERT_PHONE),
    phone: process.env.ALERT_PHONE ? '****' + process.env.ALERT_PHONE.slice(-4) : null,
  });
});

// ── MySQL ─────────────────────────────────────────────────────────────────────
const MYSQL_ROOT_PASS = process.env.MYSQL_ROOT_PASSWORD || 'NRE_Mysql2025';

app.get('/api/mysql/databases', auth, (_req, res) => {
  exec(
    `mysql -u root -p${MYSQL_ROOT_PASS} -e "SHOW DATABASES;" --batch --skip-column-names 2>&1`,
    { timeout: 8000 },
    (_err, out) => {
      const dbs = (out || '').split('\n').map(l => l.trim()).filter(l =>
        l && !['information_schema','performance_schema','sys','mysql'].includes(l)
      );
      res.json({ databases: dbs });
    }
  );
});

app.post('/api/mysql/create-db', auth, (req, res) => {
  const { dbName } = req.body;
  if (!dbName || !/^[a-z0-9_]+$/.test(dbName))
    return res.status(400).json({ error: 'Nome inválido — use apenas letras minúsculas, números e _' });
  exec(
    `mysql -u root -p${MYSQL_ROOT_PASS} -e "CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" 2>&1`,
    { timeout: 10000 },
    (err, _out, stderr) => {
      if (err) return res.status(500).json({ error: stderr || err.message });
      res.json({ ok: true });
    }
  );
});

app.listen(PORT, '127.0.0.1', () =>
  console.log(`[Admin Panel] http://localhost:${PORT}`)
);
