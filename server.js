const path = require('path');
// Quando empacotado com pkg: paths de leitura/escrita ficam ao lado do .exe
const ROOT_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;
if (process.pkg) process.chdir(ROOT_DIR);
require('dotenv').config();

// ── Proteção contra DB_NAME de template (armadilha recorrente) ───────────────
// Em produção com BOUND mode: DB_* no .env são IGNORADOS (database.js usa a licença).
// Mas se DB_NAME ainda tem o valor de template, loga FATAL para alertar o admin.
if (
  process.env.DB_NAME === 'bdallyrepresentacoes' &&
  process.env.CHAVE_LICENCA &&
  process.env.NODE_ENV === 'production'
) {
  const msg = `[FATAL] DB_NAME=bdallyrepresentacoes no .env de processo bound em produção (CHAVE=${process.env.CHAVE_LICENCA}). ` +
    'Em produção os dados de conexão vêm da tabela de licenças — remova DB_* do .env deste cliente.';
  console.error(msg);
  // Em produção o database.js ignora DB_NAME (NODE_ENV=production), então o dano é zero.
  // Mas o .env deve ser limpo para evitar confusão.
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const { logError, logInfo } = require('./config/logger');
const { authLimiter, empresasUsuarioLimiter, licenseLimiter, resetIP, resetAll, getBlockedCount } = require('./middleware/rate-limiters');

// BUILD_ID muda a cada restart do servidor (= cada deploy) — força o browser a detectar novo SW
const BUILD_ID = Date.now().toString();

// Captura erros não tratados globalmente
process.on('uncaughtException',  err => logError('uncaughtException',  err));
process.on('unhandledRejection', err => logError('unhandledRejection', err));

const app = express();
const PORT = process.env.PORT || 30100;

// Atrás de Nginx/proxy: req.ip deve refletir o cliente real (X-Forwarded-For) para rate-limit
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS) || 1);

// ─── Segurança: headers HTTP ─────────────────────────────────────────────────
// CSP desativado: HTML usa scripts inline — configurar por rota futuramente se necessário
app.use(helmet({ contentSecurityPolicy: false }));

// ─── CORS: restringe origens permitidas ─────────────────────────────────────
const _allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

// Em desenvolvimento (sem ALLOWED_ORIGINS), aceita localhost e IPs de rede privada (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
const _devOriginRe = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/;

// Subdomínios próprios sempre permitidos (independente de ALLOWED_ORIGINS)
const _ownDomainRe = /^https?:\/\/([a-z0-9-]+\.)?nresolutions\.com\.br(:\d+)?$/;

app.use(cors({
  origin(origin, cb) {
    // Requisições sem origin (curl, Postman, mobile nativo) — permite
    if (!origin) return cb(null, true);
    if (_allowedOrigins.includes(origin)) return cb(null, true);
    if (_ownDomainRe.test(origin)) return cb(null, true);
    if (!_allowedOrigins.length && _devOriginRe.test(origin)) return cb(null, true);
    cb(new Error(`Origem não permitida pelo CORS: ${origin}`));
  },
  credentials: true,
}));

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(cookieParser());

/**
 * Favicon: PNG válido (muitos browsers ignoram SVG em GET /favicon.ico e retornavam 404).
 * 1×1 px — só para silenciar o pedido automático; use /favicon.svg no <link> para ícone nítido.
 */
const FAVICON_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);
app.get('/favicon.ico', (req, res) => {
  res.type('image/png');
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(FAVICON_PNG);
});

/** Páginas do app mobile — cache no navegador para abrir offline sem HTTPS/SW */
const PWA_OFFLINE_HTML = new Set([
  '/mobile-shell.html',
  '/home.html',
  '/login.html',
  '/pages/pedidos.html',
  '/pages/clientes.html',
  '/pages/mapa-operacoes.html',
  '/pages/visitas.html',
  '/pages/ajuda-pedidos-offline.html',
]);

function setPwaOfflineCacheHeaders(res) {
  res.set('Cache-Control', 'private, max-age=604800, stale-while-revalidate=86400');
}

app.get('/home.html', (req, res) => {
  setPwaOfflineCacheHeaders(res);
  res.sendFile(path.join(ROOT_DIR, 'public', 'home.html'), { etag: true, lastModified: true });
});

app.get('/mobile-shell.html', (req, res) => {
  setPwaOfflineCacheHeaders(res);
  res.sendFile(path.join(ROOT_DIR, 'public', 'mobile-shell.html'), { etag: true, lastModified: true });
});

/** Legado: favoritos / links antigos apontavam para mobile.html */
app.get('/mobile.html', (req, res) => {
  const i = req.originalUrl.indexOf('?');
  const q = i >= 0 ? req.originalUrl.slice(i) : '';
  res.redirect(302, '/mobile-shell.html' + q);
});

app.get('/login.html', (req, res) => {
  setPwaOfflineCacheHeaders(res);
  res.sendFile(path.join(ROOT_DIR, 'public', 'login.html'), { etag: true, lastModified: true });
});

// Painel de licenças — rota explícita (evita CDN/proxy entregar SPA ou login por engano)
app.get('/licencas.html', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.sendFile(path.join(ROOT_DIR, 'public', 'licencas.html'));
});

app.get('/licencas', (req, res) => {
  const q = req.url.indexOf('?');
  res.redirect(302, '/licencas.html' + (q >= 0 ? req.url.slice(q) : ''));
});

// Formulário de captura público — /c/:token
app.get('/c/:token', (_req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'public', 'captura.html'));
});

// Vitrine Digital pública — /vitrine/:token
app.get('/vitrine/:token', (_req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'public', 'vitrine.html'));
});
app.use('/api/vitrine', require('./routes/vitrine'));

// Catálogo público de promoções — /promocoes/:token
app.get('/promocoes/:token', (_req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'public', 'promocoes.html'));
});
app.get('/feirinha/:token', (_req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'public', 'feirinha.html'));
});
app.use('/api/promocoes-share', require('./routes/promocoes-share'));
app.use('/api/feirinha-share', require('./routes/feirinha-share'));

// Portal de suporte/solicitações de melhoria
app.use('/api/suporte', require('./routes/suporte'));

function sendServiceWorkerFile(_req, res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Content-Type', 'application/javascript');
  const sw = fs.readFileSync(path.join(ROOT_DIR, 'public', 'sw.js'), 'utf8');
  res.send(sw.replace('__BUILD_ID__', BUILD_ID));
}

// sw.js legado + sw-v3.js (novo — não intercepta /pages/)
app.get('/sw.js', sendServiceWorkerFile);
app.get('/sw-v3.js', sendServiceWorkerFile);

// Versão semântica (MAJOR.MINOR.RELEASE.SEQUENCIAL) — editada manualmente em version.json antes do deploy
let _appVersionCache = null;
function getAppVersion() {
  if (_appVersionCache) return _appVersionCache;
  try {
    _appVersionCache = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'version.json'), 'utf8')).versao || '0.0.0.0';
  } catch (_) {
    _appVersionCache = '0.0.0.0';
  }
  return _appVersionCache;
}

// Versão atual do servidor — cliente compara para detectar novo deploy
app.get('/api/version', (_req, res) => res.json({ v: BUILD_ID, versao: getAppVersion() }));

// HTML administrativo: no-store. Telas PWA/mobile: cache para uso offline no celular (HTTP sem SW).
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/') {
    if (PWA_OFFLINE_HTML.has(req.path)) {
      setPwaOfflineCacheHeaders(res);
    } else {
      res.set('Cache-Control', 'no-store');
    }
  } else if (
    req.path.startsWith('/assets/') || req.path.startsWith('/vendor/')
  ) {
    if (/\.(js|css|png|svg|woff2?|ico)$/i.test(req.path)) {
      res.set('Cache-Control', 'private, max-age=604800, stale-while-revalidate=86400');
    }
  }
  next();
});

// Uploads: diretório do TENANT (process.cwd()) PRIMEIRO — isola os uploads de cada
// cliente. Registrado ANTES do static geral. Se o arquivo não existir no tenant, cai
// no static compartilhado abaixo como FALLBACK (fotos antigas de produto/fornecedor que
// ainda vivem no dir do código). Logos de empresa NÃO vazam porque o dir compartilhado
// de empresas foi esvaziado e o git não versiona mais uploads. Nomes de arquivo de
// produto são únicos por upload, então o fallback nunca serve a foto de outro cliente.
const _tenantUploadsDir = path.join(process.cwd(), 'public', 'uploads');
app.use('/uploads', express.static(_tenantUploadsDir));

// Arquivos estáticos do código (CSS/JS) + fallback de /uploads do compartilhado.
app.use(express.static(path.join(ROOT_DIR, 'public')));

// Rotas de setup (sem autenticação nem licença)
app.use('/api/setup',    require('./routes/setup'));
app.use('/api/auth/login',            authLimiter);
app.use('/api/auth/empresas-usuario', empresasUsuarioLimiter);
app.use('/api/auth',         require('./routes/auth'));
app.use('/api/dbconfig',    require('./routes/dbconfig'));
app.use('/api/primeiro-admin', require('./routes/primeiro-admin'));

// Landing page pública — rota explícita (sem cache)
app.get('/landing.html', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.sendFile(path.join(ROOT_DIR, 'public', 'landing.html'));
});

app.get('/migracao', (req, res) => res.redirect('/migracao.html'));
app.get('/migracao.html', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.sendFile(path.join(ROOT_DIR, 'public', 'migracao.html'));
});

// Demo mode público — sem auth, dados fake
app.get('/demo', (req, res) => res.redirect('/demo.html'));
app.get('/demo.html', (req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.sendFile(path.join(ROOT_DIR, 'public', 'demo.html'));
});

// Recuperação de senha — página pública
app.get('/reset-senha.html', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(ROOT_DIR, 'public', 'reset-senha.html'));
});

// Portal do Representante — requer auth (JWT via cookie/header), sem cache
app.get('/portal', (req, res) => res.redirect('/portal.html'));
app.get('/portal.html', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(ROOT_DIR, 'public', 'portal.html'));
});

// Raiz: em modo bound vai direto ao login; senão verifica instalação local
app.get('/', async (req, res) => {
  const { getBoundChave, getPool } = require('./config/database');
  if (getBoundChave()) {
    // Verifica se existe algum admin — base vazia redireciona para criar primeiro admin
    try {
      const p = getPool();
      if (p) {
        const [[row]] = await p.query('SELECT COUNT(*) as n FROM usuarios WHERE role = ?', ['admin']);
        if (row.n === 0) return res.redirect('/primeiro-admin.html');
      }
    } catch (_) {}
    return res.redirect('/login.html');
  }
  const installed = fs.existsSync(path.join(process.cwd(), '.installed'));
  if (!installed) return res.redirect('/setup.html');
  res.redirect('/login.html');
});

// Rota pública para criar o primeiro admin (só funciona se não existir nenhum admin)
app.get('/primeiro-admin.html', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(ROOT_DIR, 'public', 'primeiro-admin.html'));
});

// ─── Licença e autenticação para rotas protegidas ───────────────────────────
const { licenseMiddleware } = require('./middleware/license');
const { authMiddleware } = require('./middleware/auth');

// ─── DEV LOCALHOST: seletor de base de testes (nunca em produção/rede) ───────
function _isLocalhostDev(req) {
  if (process.env.NODE_ENV === 'production') return false;
  const ip = (req.ip || req.connection?.remoteAddress || '').replace('::ffff:', '');
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}

// GET /api/dev/bases — lista as bases já baixadas neste PC + qual está ativa
app.get('/api/dev/bases', (req, res) => {
  if (!_isLocalhostDev(req)) return res.status(404).json({ error: 'not found' });
  try {
    const { listDevBases } = require('./config/database');
    res.json({ ok: true, bases: listDevBases() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/dev/base { chave } — troca a base ativa ao vivo (bound mode), sem reiniciar
app.post('/api/dev/base', async (req, res) => {
  if (!_isLocalhostDev(req)) return res.status(404).json({ error: 'not found' });
  try {
    const { rebindBoundPool } = require('./config/database');
    const r = await rebindBoundPool(req.body?.chave);
    if (!r.ok) return res.status(400).json(r);
    try { require('./middleware/license').invalidateLicenseCache(); } catch {}
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/license/check — verificação pública (sem auth) usada pelo login.html
app.get('/api/license/check', async (req, res) => {
  try {
    const LicenseService = require('./services/license-service');
    const { customerDbFromLicense, getBoundChave, readLicenseBinding } = require('./config/database');
    // Em modo BOUND: usa a chave do processo se não vier na query
    // Fallback: license-binding.json (instalações locais sem CHAVE_LICENCA no env)
    const chave  = (req.query.chave || '').trim().toUpperCase() || getBoundChave() || readLicenseBinding()?.chave_licenca || null;
    // Em multi-tenant: sem chave = tenant desconhecido → nunca cair no checkLocal() global
    const result = chave
      ? await LicenseService.checkByKey(chave)
      : customerDbFromLicense()
        ? { valid: false, status: 'sem_licenca', mensagem: 'Informe sua chave de licença' }
        : await LicenseService.checkLocal();
    res.json({
      valid:           result.valid,
      status:          result.status,
      mensagem:        result.mensagem  || null,
      diasRestantes:   result.diasRestantes || null,
      aviso:           result.aviso     || false,
      demo:            result.demo      || false,
      razao_social:    result.dados?.razao_social  || null,
      cnpj_cpf:        result.dados?.cnpj_cpf     || null,
      tipo:            result.dados?.tipo_licenca  || null,
      chave_licenca:   result.chave_licenca || result.dados?.chave_licenca || null,
      suporte_whatsapp: process.env.SUPORTE_WHATSAPP || '',
      suporte_nome:     process.env.SUPORTE_NOME     || 'Suporte Técnico',
      suporte_email:    process.env.SUPORTE_EMAIL    || '',
      pix_chave:        process.env.PIX_CHAVE        || '',
      pix_tipo:         process.env.PIX_TIPO         || '',
      pix_nome:         process.env.PIX_NOME         || '',
      pix_descricao:    process.env.PIX_DESCRICAO    || '',
    });
  } catch (err) {
    res.json({ valid: false, status: 'erro_verificacao' });
  }
});

// GET /api/license/ping — testa conexão com banco remoto de licenças (público)
app.get('/api/license/ping', async (req, res) => {
  try {
    const { getLicensePool } = require('./config/db-license');
    const licPool = getLicensePool();
    const [[row]] = await licPool.query('SELECT COUNT(*) as total FROM sistema_licencas');
    res.json({
      ok: true,
      host:     process.env.LICENSE_DB_HOST || '(não definido)',
      porta:    process.env.LICENSE_DB_PORT || '3306',
      banco:    process.env.LICENSE_DB_NAME || '(não definido)',
      usuario:  process.env.LICENSE_DB_USER || '(não definido)',
      total_licencas: row.total,
    });
  } catch (err) {
    res.json({
      ok: false,
      host:    process.env.LICENSE_DB_HOST || '(não definido)',
      porta:   process.env.LICENSE_DB_PORT || '3306',
      banco:   process.env.LICENSE_DB_NAME || '(não definido)',
      usuario: process.env.LICENSE_DB_USER || '(não definido)',
      erro:    err.message,
    });
  }
});

// /api/v1 e /api/licencas são públicas — não passam pelo licenseMiddleware
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/v1')) return next();
  if (req.path.startsWith('/licencas')) return next();
  if (req.path.startsWith('/pedidos/pdf-download/')) return next();
  return licenseMiddleware(req, res, next);
});

/** Logs do browser (mobile-shell / iframe) → console do Node + logs/errors.log */
app.use('/api/client-log', require('./routes/client-log'));

// GET /api/license/status — info da licença (protegida só por auth)
app.get('/api/license/status', authMiddleware, async (req, res) => {
  const LicenseService = require('./services/license-service');
  const result = await LicenseService.checkLocal();
  res.json(result);
});

// POST /api/license/activate — pública (usada na tela de login antes do auth)
app.post('/api/license/activate', licenseLimiter, async (req, res) => {
  const { chave } = req.body;
  if (!chave) return res.status(400).json({ sucesso: false, mensagem: 'Chave não informada' });
  try {
    const LicenseService = require('./services/license-service');
    const { invalidateLicenseCache } = require('./middleware/license');
    const result = await LicenseService.activateLicense(chave);
    if (result.sucesso) invalidateLicenseCache();
    // Sanitiza BigInt para evitar erro de serialização JSON
    res.json(JSON.parse(JSON.stringify(result, (k, v) => typeof v === 'bigint' ? v.toString() : v)));
  } catch (err) {
    console.error('[license/activate] ERRO:', err.message, err.stack);
    res.json({ sucesso: false, mensagem: 'Erro ao ativar: ' + err.message });
  }
});

// POST /api/webhook/wa-admin — recebe comandos WhatsApp do administrador (Evolution API)
// Configure na Evolution API: Webhook URL = https://seu-dominio/api/webhook/wa-admin
//                              Instância   = ALERTA_WA_INSTANCIA
//                              Eventos     = messages.upsert
app.post('/api/webhook/wa-admin', async (req, res) => {
  res.sendStatus(200); // responde imediatamente — Evolution API não aguarda processamento
  try {
    const body = req.body;
    if (body.event !== 'messages.upsert') return;
    const data = body.data;
    if (!data || data.key?.fromMe) return;

    // Só processa mensagens vindas do número do administrador
    const adminNum = (process.env.ALERTA_WHATSAPP || '').replace(/\D/g, '');
    const fromNum  = (data.key?.remoteJid || '').replace('@s.whatsapp.net', '').replace(/\D/g, '');
    if (!adminNum || fromNum !== adminNum) return;

    const text = (
      data.message?.conversation ||
      data.message?.extendedTextMessage?.text || ''
    ).trim().toLowerCase();

    const { sendMessage } = require('./config/alert');
    let reply = '';

    if (text.startsWith('liberar ')) {
      const ip = text.slice(8).trim();
      if (/^[\d.:\[\]a-fA-F]+$/.test(ip)) {
        resetIP(ip);
        reply = `✅ IP *${ip}* liberado.`;
      } else {
        reply = `❌ Formato inválido. Use: *liberar 1.2.3.4*`;
      }
    } else if (text === 'liberar tudo') {
      const count = resetAll();
      reply = count > 0 ? `✅ ${count} IP(s) liberado(s).` : `ℹ️ Nenhum IP bloqueado.`;
    } else if (text === 'status') {
      const ts = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      reply = `✅ *SysRepWeb online*\n🔒 IPs bloqueados: ${getBlockedCount()}\n🕐 ${ts}`;
    }

    if (reply) sendMessage(reply).catch(() => {});
  } catch (e) {
    console.error('[wa-admin] webhook error:', e.message);
  }
});

// POST /api/webhook/wa-vendedor — bot WhatsApp para consultas de vendedores (Evolution API)
// Configure na Evolution API: Webhook URL = https://seu-dominio/api/webhook/wa-vendedor
//                              Eventos     = messages.upsert
app.use('/api/webhook/wa-vendedor', require('./routes/wa-vendedor'));

// POST /api/license/demo — ativa modo demo por 30 dias
app.post('/api/license/demo', authMiddleware, async (req, res) => {
  const LicenseService = require('./services/license-service');
  const { invalidateLicenseCache } = require('./middleware/license');
  const result = await LicenseService.activateDemo();
  invalidateLicenseCache();
  res.json(result);
});

// POST /api/license/sync — sincroniza com base remota
app.post('/api/license/sync', authMiddleware, async (req, res) => {
  const LicenseService   = require('./services/license-service');
  const { invalidateLicenseCache } = require('./middleware/license');
  const { customerDbFromLicense }  = require('./config/database');
  // Em multi-tenant a chave vem do JWT; em single-tenant lê do banco local
  let chave;
  if (customerDbFromLicense()) {
    chave = req.user?.chave_licenca || null;
  } else {
    const status = await LicenseService.checkLocal();
    chave = status.dados?.chave_licenca || null;
  }
  if (!chave) return res.status(400).json({ error: 'Nenhuma licença ativa para sincronizar' });
  const result = await LicenseService.syncWithRemote(chave);
  if (result.sucesso) invalidateLicenseCache(chave);
  res.json(result);
});

// ─── Status do backup (tabela log_backup) ───────────────────────────────────
app.get('/api/backup/status', authMiddleware, async (req, res) => {
  try {
    const { getPool } = require('./config/database');
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT DATEDIFF(CURDATE(), data) AS dias, nome, data
       FROM log_backup WHERE excluido = 'N'
       ORDER BY id DESC LIMIT 1`
    ).catch(() => [[]]);
    if (!rows[0]) return res.json({ dias: -1 });
    res.json({ dias: rows[0].dias, nome: rows[0].nome, data: rows[0].data });
  } catch {
    res.json({ dias: -1 });
  }
});

// ─── Módulos liberados (tabela modulos) ─────────────────────────────────────
app.get('/api/modulos', authMiddleware, async (req, res) => {
  try {
    const { getPool } = require('./config/database');
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT id, descricao FROM modulos WHERE excluido = 'N' AND liberado = 'S' ORDER BY descricao`
    );
    res.json({ modulos: rows });
  } catch (err) {
    res.json({ modulos: [] });
  }
});

// ─── Portal de gestão de licenças (sem licenseMiddleware, sem authMiddleware) ─
app.use('/api/licencas', require('./routes/licencas'));

// ─── Webhooks públicos (sem auth — Meta, etc.) ───────────────────────────────
app.use('/api/webhooks', require('./routes/webhooks'));

// ─── Formulários de captura públicos (sem auth) ──────────────────────────────
app.use('/api/captura', require('./routes/captura').router);

// ─── API Pública v1 (autenticação por API Key) ───────────────────────────────
app.use('/api/v1', require('./routes/api-publica/index'));

// ─── Suas rotas de negócio vão aqui ─────────────────────────────────────────
app.use('/api/changelog', require('./routes/changelog')); // público (GET) + auth interna na rota
app.use('/api/clientes',     authMiddleware, require('./modules/clientes/clientes.routes'));
app.use('/api/fornecedores',     authMiddleware, require('./routes/fornecedores'));
app.use('/api/transportadoras',   authMiddleware, require('./routes/transportadoras'));
app.use('/api/familia-produtos',  authMiddleware, require('./routes/familia-produtos'));
app.use('/api/grades',            authMiddleware, require('./routes/grades'));
app.use('/api/cores',             authMiddleware, require('./routes/cores'));
app.use('/api/produtos',     authMiddleware, require('./routes/produtos'));
app.use('/api/lookups',      authMiddleware, require('./routes/lookups'));
app.use('/api/tabela-precos', authMiddleware, require('./routes/tabela-precos'));
app.use('/api/importacao-precos',       authMiddleware, require('./routes/importacao-precos'));
app.use('/api/importacao-clientes',    authMiddleware, require('./routes/importacao-clientes'));
app.use('/api/importacao-fornecedores',authMiddleware, require('./routes/importacao-fornecedores'));
app.use('/api/leads',        authMiddleware, require('./routes/leads'));
app.use('/api/crm',          authMiddleware, require('./routes/crm-pipeline'));
app.use('/api/teleatendimento', authMiddleware, require('./routes/teleatendimento'));
app.use('/api/visitas',      authMiddleware, require('./routes/visitas'));
app.use('/api/geocoding',    authMiddleware, require('./routes/geocoding'));
app.use('/api/geolocalizacao', authMiddleware, require('./routes/geolocalizacao'));
app.use('/api/mapa-operacoes', authMiddleware, require('./routes/mapa-operacoes'));
app.use('/api/panico-vendedor', authMiddleware, require('./routes/panico-vendedor'));
app.use('/api/gamificacao',    authMiddleware, require('./routes/gamificacao'));
app.use('/api/lgpd',           authMiddleware, require('./routes/lgpd'));
app.use('/api/user-prefs',    authMiddleware, require('./routes/user-prefs'));
app.use('/api/mobile',        authMiddleware, require('./routes/mobile'));
app.use('/api/metas-vendas',  authMiddleware, require('./routes/metas-vendas'));

// ─── GET /api/grupos-fab — grupos de fornecedores (tabela: grupos) ──────────
app.get('/api/grupos-fab', authMiddleware, async (req, res) => {
  try {
    const { getPool } = require('./config/database');
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT id, descricao FROM grupos
       WHERE excluido = 'N' AND ativo = 'SIM'
       ORDER BY descricao DESC`
    );
    res.json(rows);
  } catch (err) {
    res.json([]); // silencioso se tabela não existir
  }
});

// ─── GET /api/categorias — segmentos de clientes ─────────────────────────────
app.get('/api/categorias', authMiddleware, async (req, res) => {
  try {
    const { getPool } = require('./config/database');
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT id, descricao FROM categoria
       WHERE excluido = 'N' AND status = 'A'
       ORDER BY descricao`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/vendedores — acesso global para outros módulos ─────────────────
app.get('/api/vendedores', authMiddleware, async (req, res) => {
  try {
    const { getPool } = require('./config/database');
    const { listVendedoresVisiveis } = require('./config/vendedor-visibilidade');
    const rows = await listVendedoresVisiveis(getPool(), req, { onlyPVender: true });
    res.json({
      vendedores: rows.map(r => ({
        id: r.id,
        idusuario: r.id,
        nome: r.nome || r.nome_vendedor,
        nomeusu: r.nome || r.nome_vendedor,
      })),
    });
  } catch (err) {
    res.json({ vendedores: [] });
  }
});
app.use('/api/prepostos', authMiddleware, require('./routes/prepostos'));
// PDF temporário para compartilhar no mobile (sem JWT — token secreto na URL)
const { getPdfShare } = require('./config/pedido-pdf-share');
app.get('/api/pedidos/pdf-download/:token', (req, res) => {
  const item = getPdfShare(req.params.token);
  if (!item || !item.buf?.length || item.buf[0] !== 0x25) {
    return res.status(404).type('text/plain').send('Link expirado ou PDF inválido');
  }
  const safeName = item.name.replace(/[^\w.\-() ]+/g, '_').replace(/"/g, '') || 'pedido.pdf';
  const attach = req.query.attachment === '1' || req.query.dl === '1';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${attach ? 'attachment' : 'inline'}; filename="${safeName}"`);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.send(item.buf);
});
app.use('/api/estoque',   authMiddleware, require('./routes/estoque'));
app.use('/api/pedidos',   authMiddleware, require('./routes/pedidos'));
app.use('/api/feirinha',  authMiddleware, require('./routes/feirinha'));
app.use('/api/xml',       authMiddleware, require('./routes/xml'));
app.use('/api/excel',     authMiddleware, require('./routes/excel'));
app.use('/api/analytics', authMiddleware, require('./routes/analytics'));
app.use('/api/comissoes',     authMiddleware, require('./routes/comissoes'));
app.use('/api/conciliacao',  authMiddleware, require('./routes/conciliacao'));
app.use('/api/pagar',     authMiddleware, require('./routes/pagar'));
app.use('/api/receber',   authMiddleware, require('./routes/receber'));
app.use('/api/financeiro', authMiddleware, require('./routes/financeiro'));
app.use('/api/dre',       authMiddleware, require('./routes/dre'));
app.use('/api/faturamento', authMiddleware, require('./routes/faturamento'));

// ─── Inteligência Comercial e Regiões/Rotas ───────────────────────────────────
app.use('/api/regiao-rota',    authMiddleware, require('./routes/regiao-rota'));
app.use('/api/inteligencia',   authMiddleware, require('./routes/inteligencia-comercial'));
app.use('/api/performance',    authMiddleware, require('./routes/performance-representantes'));

// ─── Cadastros (perfis, grupos, usuários, empresas) ──────────────────────────
app.use('/api', authMiddleware, require('./routes/cadastros'));
app.use('/api/manutencao', authMiddleware, require('./routes/manutencao'));

// ─── Configurações do sistema e da API ───────────────────────────────────────
app.use('/api/config',    authMiddleware, require('./routes/config-sistema'));
app.use('/api/parametro-locais', authMiddleware, require('./routes/parametro-locais'));
app.use('/api/whatsapp',  authMiddleware, require('./routes/whatsapp'));
app.use('/api/anotacoes', authMiddleware, require('./routes/anotacoes'));

// ─── Dashboard home (Visão Executiva Diamond Flow) ───────────────────────────
app.get('/api/dashboard/home', authMiddleware, async (req, res) => {
  try {
    const { getPool } = require('./config/database');
    const pool = getPool();

    // 1. Determinar permissões de visualização
    const isAdmin = req.user.perfil == 1 || req.user.acessartodosclientes === 'S';
    let whereUser = isAdmin ? "" : " AND p.id_usuario = " + pool.escape(req.user.id);
    let whereUserLogs = isAdmin ? "" : " AND l.id_usuario = " + pool.escape(req.user.id);

    // 2. Pedidos do Mês Atual e Anterior (para comparativos)
    const [rows] = await pool.query(`
      SELECT 
        p.tipo_pedido, p.nome_cliente, p.nome_vendedor, p.nome_fornecedor, 
        p.vlrtotalpedido, p.data_abertura, p.situacao_pedido, p.id_usuario
      FROM pedidos p
      WHERE p.excluido = 'N'
        AND p.data_abertura >= DATE_FORMAT(CURDATE() - INTERVAL 1 MONTH, '%Y-%m-01')
        ${whereUser}
    `).catch(() => [[]]);

    const hoje = new Date();
    const mesAtual = hoje.getMonth() + 1;
    const anoAtual = hoje.getFullYear();
    const mesAnt   = mesAtual === 1 ? 12 : mesAtual - 1;
    const anoAnt   = mesAtual === 1 ? anoAtual - 1 : anoAtual;

    let totalGeral = 0, qtdPedidos = 0;
    let totalMesAnt = 0, qtdMesAnt = 0;
    
    const porTipo = {};
    const porCliente = {};
    const porVendedor = {};
    const porFabrica = {};
    const evolucaoDiaria = {};

    for (const r of rows) {
      const dt = new Date(r.data_abertura);
      const m = dt.getMonth() + 1;
      const y = dt.getFullYear();
      const vlr = parseFloat(r.vlrtotalpedido || 0);

      // Mês Atual
      if (m === mesAtual && y === anoAtual) {
        totalGeral += vlr;
        qtdPedidos++;

        const tipo = r.tipo_pedido || 'Outros';
        porTipo[tipo] = (porTipo[tipo] || 0) + vlr;

        const cli = r.nome_cliente || 'Sem nome';
        porCliente[cli] = (porCliente[cli] || 0) + vlr;

        const vend = r.nome_vendedor || 'Sem nome';
        porVendedor[vend] = (porVendedor[vend] || 0) + vlr;

        const fab = r.nome_fornecedor || 'Sem nome';
        porFabrica[fab] = (porFabrica[fab] || 0) + vlr;

        const dia = dt.getDate();
        evolucaoDiaria[dia] = (evolucaoDiaria[dia] || 0) + vlr;
      } 
      // Mês Anterior
      else if (m === mesAnt && y === anoAnt) {
        totalMesAnt += vlr;
        qtdMesAnt++;
      }
    }

    // 2. Ranking Formatado (Top 5 por Valor)
    const topClientes = Object.entries(porCliente).sort((a,b)=>b[1]-a[1]).slice(0,5);
    const topVendedores = Object.entries(porVendedor).sort((a,b)=>b[1]-a[1]).slice(0,5);
    const topFabricas = Object.entries(porFabrica).sort((a,b)=>b[1]-a[1]).slice(0,5);

    // Cálculos de Tendência
    const tendenciaVendas = totalMesAnt > 0 ? (((totalGeral - totalMesAnt) / totalMesAnt) * 100).toFixed(1) : 0;
    const tendenciaPedidos = qtdMesAnt > 0 ? (((qtdPedidos - qtdMesAnt) / qtdMesAnt) * 100).toFixed(1) : 0;

    // 3. Atividades Recentes (Logs) filtradas por permissão
    const [logs] = await pool.query(`
      SELECT l.*, u.nome as nome_usuario
      FROM logs_pedidos l
      LEFT JOIN usuarios u ON l.id_usuario = u.idusuario
      WHERE 1=1 ${whereUserLogs}
      ORDER BY l.data_hora DESC
      LIMIT 10
    `).catch(() => [[]]);

    // 4. KPIs mobile (hoje, abertos, orçamentos)
    const [[mobileKpi]] = await pool.query(`
      SELECT
        COUNT(CASE WHEN DATE(data_abertura) = CURDATE() AND tipo_pedido NOT LIKE '%ORCA%' THEN 1 END) AS qtdHoje,
        IFNULL(SUM(CASE WHEN DATE(data_abertura) = CURDATE() AND tipo_pedido NOT LIKE '%ORCA%' THEN vlrtotalpedido ELSE 0 END), 0) AS valorHoje,
        COUNT(CASE WHEN situacao_pedido NOT IN ('CANCELADO','ENVIADO') AND tipo_pedido NOT LIKE '%ORCA%' THEN 1 END) AS pedidosAbertos,
        COUNT(CASE WHEN tipo_pedido LIKE '%ORCA%' AND situacao_pedido != 'CANCELADO' THEN 1 END) AS orcamentosPendentes,
        COUNT(CASE WHEN origem = 'PROMO_SHARE' AND tipo_pedido LIKE '%ORCA%'
          AND situacao_pedido NOT IN ('CANCELADO','ENVIADO') THEN 1 END) AS promoSharePendentes,
        COUNT(CASE WHEN origem = 'FEIRINHA_SHARE' AND tipo_pedido LIKE '%ORCA%'
          AND situacao_pedido NOT IN ('CANCELADO','ENVIADO') THEN 1 END) AS feirinhaSharePendentes
      FROM pedidos
      WHERE excluido = 'N' ${whereUser}
    `).catch(() => [[{ qtdHoje:0, valorHoje:0, pedidosAbertos:0, orcamentosPendentes:0, promoSharePendentes:0, feirinhaSharePendentes:0 }]]);

    // 5. Visitas e Atividades Reais (Nova Tabela)
    const [visitas] = await pool.query(`
      SELECT 
        v.id, v.data_visita, v.hora_visita, v.status, v.id_cliente,
        c.nome as nome_cliente, m.descricao as motivo
      FROM visitas v
      LEFT JOIN clientes c ON v.id_cliente = c.id
      LEFT JOIN motivo_visitas m ON v.id_motivo = m.id
      WHERE v.id_vendedor = ? OR ? = 1
      ORDER BY v.data_visita DESC, v.hora_visita DESC
      LIMIT 10
    `, [req.user.id, req.user.perfil]).catch(() => [[]]);

    res.json({
      totalGeral,
      qtdPedidos,
      totalMesAnt,
      tendenciaVendas,
      tendenciaPedidos,
      porTipo,
      topClientes,
      topVendedores,
      topFabricas,
      evolucaoDiaria,
      logs,
      visitas,
      mesNome: hoje.toLocaleDateString('pt-BR', { month: 'long' }).toUpperCase(),
      qtdHoje: mobileKpi?.qtdHoje || 0,
      valorHoje: mobileKpi?.valorHoje || 0,
      pedidosAbertos: mobileKpi?.pedidosAbertos || 0,
      orcamentosPendentes: mobileKpi?.orcamentosPendentes || 0,
      promoSharePendentes: mobileKpi?.promoSharePendentes || 0,
      feirinhaSharePendentes: mobileKpi?.feirinhaSharePendentes || 0
    });
  } catch (err) {
    console.error('Dash Error:', err);
    res.status(500).json({ error: 'Erro ao processar dashboard' });
  }
});

// ─── WhatsApp / EvolutionAPI — status do usuário logado (topbar) ─────────────
app.get('/api/whatsapp/config', authMiddleware, async (req, res) => {
  try {
    const { getPool } = require('./config/database');
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT w_apiglobal, w_urlplataforma FROM configuracao WHERE excluido='N' ORDER BY id DESC LIMIT 1`
    ).catch(() => [[]]);
    if (!rows[0]?.w_urlplataforma) return res.json({ configurado: false });
    res.json({ configurado: true, urlPlataforma: rows[0].w_urlplataforma, apiGlobal: rows[0].w_apiglobal });
  } catch {
    res.json({ configurado: false });
  }
});

// Nota: todas as rotas /api/whatsapp/* estão em routes/whatsapp.js

// Middleware de log de erros Express (captura next(err))
app.use((err, req, res, next) => {
  logError(`${req.method} ${req.path}`, err);
  res.status(500).json({ error: err.message });
});

// 404 para API
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Rota não encontrada' });
});

// SPA fallback — /pages/* nunca faz redirect (evita iframe recursion)
app.get('*', (req, res) => {
  const ext = path.extname(req.path);
  // Recursos estáticos não-HTML → 404
  if (ext && ext !== '.html') return res.status(404).end();
  // Rotas dentro de /pages/ que não existem → 404 (nunca redireciona para login)
  if (req.path.startsWith('/pages/')) return res.status(404).end();
  // Nunca substituir páginas reais pelo shell de login (proxy estático pode não servir o arquivo)
  if (req.path === '/licencas.html' || req.path === '/setup.html') {
    const fn = req.path === '/licencas.html' ? 'licencas.html' : 'setup.html';
    return res.sendFile(path.join(ROOT_DIR, 'public', fn));
  }
  // Demais rotas HTML → login
  res.sendFile(path.join(ROOT_DIR, 'public', 'login.html'));
});

const { initCustomerDatabase, customerDbFromLicense, readLicenseBinding } = require('./config/database');

function startServer() {
  app.listen(PORT, () => {
    const installed = fs.existsSync(path.join(process.cwd(), '.installed'));
    console.log(`\n🚀 SysRepWeb rodando em http://localhost:${PORT}`);
    if (!installed) {
      console.log(`⚙️  Primeira execução — acesse http://localhost:${PORT}/setup.html`);
    }
    if (customerDbFromLicense() && readLicenseBinding()) {
      console.log('📎 CUSTOMER_DB_FROM_LICENSE: banco operacional amarrado à chave em data/license-binding.json');
    }
  });
}

initCustomerDatabase()
  .then(startServer)
  .then(() => {
    try {
      require('./config/db-nresolution').initSolicitacoesSchema()
        .then(() => { try { require('./config/suporte-notificador').startNotificador(); } catch (e) { console.warn('[notificador]', e.message); } })
        .catch(e => console.warn('[nre-schema]', e.message));
    } catch (e) { console.warn('[nre-schema]', e.message); }
    try { require('./config/daily-report').startScheduler(); } catch {}
    try { require('./config/push-lembretes-vendedor').startPushLembretesScheduler(); } catch (e) {
      console.warn('[push-lembretes] init:', e.message);
    }
    try { require('./config/relatorio-diario').startRelatorioDiarioScheduler(); } catch (e) {
      console.warn('[relatorio-diario] init:', e.message);
    }
    try { require('./config/api-keys-setup').setupApiKeysTable(); } catch {}
    setImmediate(() => {
      try { require('./config/pdf-browser').warmupPdfBrowser(); } catch {}
    });
  })
  .catch((err) => {
    console.error('\n╔══════════════════════════════════════════════════════════╗');
    console.error('║  ERRO AO CONECTAR NO BANCO DE DADOS                      ║');
    console.error('╠══════════════════════════════════════════════════════════╣');
    console.error('║  ' + String(err.message).padEnd(56) + '║');
    console.error('╚══════════════════════════════════════════════════════════╝\n');
    startServer();
  });
