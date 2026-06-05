const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const { extractMysqlConfigFromLicenseRow } = require('./customer-db-from-license');

let pool = null;
// Per-request pool isolation: map of chave_licenca → pool
const _poolMap = new Map();
const _als = new AsyncLocalStorage();

/**
 * Modo "bound": CHAVE_LICENCA no .env amarra o processo a UM tenant.
 * Pool global é criado no startup com as credenciais da Oracle.
 * Sem ALS, sem _poolMap — isolamento por processo de SO.
 */
function getBoundChave() {
  const v = (process.env.CHAVE_LICENCA || '').trim().toUpperCase();
  return v || null;
}

function customerDbFromLicense() {
  const v = process.env.CUSTOMER_DB_FROM_LICENSE;
  return v === '1' || String(v).toLowerCase() === 'true' || String(v).toLowerCase() === 'yes';
}

function getLicenseBindingPath() {
  return path.join(process.cwd(), 'data', 'license-binding.json');
}

function readLicenseBinding() {
  try {
    const p = getLicenseBindingPath();
    if (!fs.existsSync(p)) return null;
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!j || !j.chave_licenca) return null;
    return { chave_licenca: String(j.chave_licenca).trim() };
  } catch {
    return null;
  }
}

function writeLicenseBinding(obj) {
  const dir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getLicenseBindingPath(), `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

/**
 * Conecta ao banco operacional (dados do cliente) usando LICENSE_DB_* + chave em data/license-binding.json.
 */
async function createPoolFromLicenseBinding() {
  const binding = readLicenseBinding();
  if (!binding) return { ok: false, error: 'Sem arquivo license-binding.json' };

  const { getLicensePool } = require('./db-license');
  const licPool = getLicensePool();
  const [rows] = await licPool.query(
    'SELECT * FROM sistema_licencas WHERE chave_licenca = ? AND ativo = 1',
    [binding.chave_licenca]
  );
  if (!rows.length) return { ok: false, error: 'Chave do binding não encontrada no servidor de licenças' };

  const cfg = extractMysqlConfigFromLicenseRow(rows[0]);
  if (!cfg) {
    return {
      ok: false,
      error:
        'Licença sem colunas de MySQL no cadastro (mysql_host, mysql_user, mysql_database, mysql_password). ' +
        'Altere a tabela sistema_licencas ou configure PAINEL_API_URL + PAINEL_API_KEY.',
    };
  }

  const newPool = createPool(cfg, binding.chave_licenca);

  // Garante schema atualizado no banco recém-conectado
  try {
    const { runMigrations } = require('./schema-migrations');
    await runMigrations(newPool);
  } catch (e) {
    console.warn('[DB] Aviso de migração:', e.message);
  }

  return { ok: true };
}

async function initCustomerDatabase() {
  const boundChave = getBoundChave();

  // ── Modo BOUND: CHAVE_LICENCA no .env ───────────────────────────────────────
  // Um processo = um tenant = um pool global. Sem ALS. Sem contaminação possível.
  if (boundChave) {
    console.log(`[DB] Bound mode — chave ${boundChave.slice(0, 8)}…`);
    const { getLicensePool } = require('./db-license');
    const licPool = getLicensePool();
    const [rows] = await licPool.query(
      'SELECT * FROM sistema_licencas WHERE chave_licenca = ? AND ativo = 1',
      [boundChave]
    );
    if (!rows.length) throw new Error(`Licença ${boundChave} não encontrada na base central`);
    let cfg = extractMysqlConfigFromLicenseRow(rows[0]);

    // Fallback: cliente local — DB configurado diretamente no .env
    if (!cfg) {
      const h = process.env.DB_HOST, n = process.env.DB_NAME, u = process.env.DB_USER;
      if (h && n && u) {
        cfg = { host: h, port: parseInt(process.env.DB_PORT||'3306',10), database: n, user: u, password: process.env.DB_PASSWORD||'' };
        console.log(`[DB] Bound mode — usando DB local do .env (${h})`);
      } else {
        throw new Error(`Licença ${boundChave} sem dados de conexão MySQL. Cadastre mysql_host/user/database na Oracle OU defina DB_HOST, DB_NAME, DB_USER no .env`);
      }
    }
    createPool(cfg); // sem chave_licenca → pool global
    await pool.query('SELECT 1');
    try {
      const { runMigrations } = require('./schema-migrations');
      await runMigrations(pool);
    } catch (e) {
      console.warn('[DB] Migração:', e.message);
    }
    console.log(`[DB] Conectado: ${cfg.database}@${cfg.host}`);
    return;
  }

  // ── Modo legado (XAMPP / DB no .env) ───────────────────────────────────────
  if (!customerDbFromLicense()) {
    createPool();
    await pool.query('SELECT 1');
    try {
      const { runMigrations } = require('./schema-migrations');
      await runMigrations(pool);
    } catch (e) {
      console.warn('[DB] Migração:', e.message);
    }
    console.log(`[DB] Conectado: ${process.env.DB_NAME || 'sysrepweb'}@${process.env.DB_HOST || 'localhost'}`);
    return;
  }

  const binding = readLicenseBinding();
  if (!binding) {
    console.log(
      '[DB] CUSTOMER_DB_FROM_LICENSE=1: pool do cliente será criado ao ativar a chave na tela de login (sem DB_HOST no .env).'
    );
    return;
  }

  const r = await createPoolFromLicenseBinding();
  if (!r.ok) {
    throw new Error(r.error);
  }
  const bindingChave = readLicenseBinding().chave_licenca;
  const p = getPoolForLicense(bindingChave);
  if (!p) throw new Error('Pool não criado para a chave do binding após createPoolFromLicenseBinding');
  await p.query('SELECT 1');
  console.log(`[DB] Cliente conectado via licença (${bindingChave.slice(0, 8)}…)`);
}

/**
 * Lazy init quando o servidor já está no ar e a licença acabou de ser ativada.
 */
async function ensureCustomerPoolFromLicenseIfNeeded() {
  if (!customerDbFromLicense()) return;
  const binding = readLicenseBinding();
  if (!binding) return;
  if (_poolMap.has(binding.chave_licenca)) return; // pool já existe, não recriar
  const r = await createPoolFromLicenseBinding();
  if (!r.ok) throw new Error(r.error);
}

function createPool(config = null, chave_licenca = null) {
  // Multi-tenant mode: each license gets its own isolated pool
  if (customerDbFromLicense() && chave_licenca) {
    const oldPool = _poolMap.get(chave_licenca) || null;
    if (oldPool) oldPool.end().catch(() => {});
    if (!config) throw new Error('createPool em modo multi-tenant requer config');
    if (!config.dateStrings) config.dateStrings = ['DATE'];
    const newPool = mysql.createPool(config);
    _poolMap.set(chave_licenca, newPool);
    // fail-closed multi-tenant: pool global nunca aponta para tenant específico
    return newPool;
  }

  // Single-tenant / sem chave: comportamento original
  // IMPORTANTE: lança erro ANTES de fechar o pool para não corromper o estado em modo multi-tenant
  if (!config && customerDbFromLicense()) {
    throw new Error(
      'Modo CUSTOMER_DB_FROM_LICENSE: não use DB_HOST no .env. Ative a chave no login ou reinicie após criar data/license-binding.json'
    );
  }
  if (pool) pool.end().catch(() => {});
  if (!config) {
    config = {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'sysrepweb',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      timezone: '-03:00',
      // DATE como string 'YYYY-MM-DD' — evita Date UTC deslocar dia (30 virar 31)
      dateStrings: ['DATE'],
    };
  }
  if (config && !config.dateStrings) {
    config.dateStrings = ['DATE'];
  }
  pool = mysql.createPool(config);
  return pool;
}

function getPool() {
  // Requisições HTTP sempre têm contexto ALS injetado pelo authMiddleware ou pelas rotas de login
  const ctxPool = _als.getStore();
  if (ctxPool) return ctxPool;

  if (!pool) {
    if (customerDbFromLicense()) {
      throw new Error('Banco do cliente ainda não conectado. Ative a licença na tela de login ou reinicie o servidor.');
    }
    createPool();
  }
  return pool;
}

/**
 * Pool do tenant para a requisição atual (ALS, JWT ou pool global em modo bound/.env).
 * Usar após middlewares assíncronos (ex.: multer) que podem perder o AsyncLocalStorage.
 */
function resolvePool(req) {
  const ctxPool = _als.getStore();
  if (ctxPool) return ctxPool;

  const chave = req?.user?.chave_licenca;
  if (chave) {
    const p = getPoolForLicense(String(chave).trim());
    if (p) return p;
  }

  if (getBoundChave() || !customerDbFromLicense()) {
    if (!pool) {
      if (customerDbFromLicense()) {
        throw new Error('Banco do cliente ainda não conectado. Ative a licença na tela de login ou reinicie o servidor.');
      }
      createPool();
    }
    return pool;
  }

  throw new Error('Banco do cliente ainda não conectado. Ative a licença na tela de login ou reinicie o servidor.');
}

/** Executa fn com o pool do tenant (recria ALS após multer e outros middlewares assíncronos). */
function runWithRequestPool(req, fn) {
  const tenantPool = resolvePool(req);
  if (_als.getStore()) return fn();
  return runWithPool(tenantPool, fn);
}

/** Retorna o pool registrado para a chave, ou null se não encontrado. */
function getPoolForLicense(chave) {
  if (!chave) return null;
  return _poolMap.get(String(chave).trim()) || null;
}

/** Destrói e remove o pool da chave — força recriação com credenciais atuais. */
function destroyPoolForLicense(chave) {
  if (!chave) return;
  const key = String(chave).trim();
  const p = _poolMap.get(key);
  if (p) {
    p.end().catch(() => {});
    _poolMap.delete(key);
  }
}

/** Executa fn() com o pool correto no contexto assíncrono (AsyncLocalStorage). */
function runWithPool(targetPool, fn) {
  return _als.run(targetPool, fn);
}

async function testConnection(config) {
  const testPool = mysql.createPool({ ...config, connectionLimit: 1 });
  try {
    const conn = await testPool.getConnection();
    conn.release();
    await testPool.end();
    return { ok: true };
  } catch (err) {
    try {
      await testPool.end();
    } catch {}
    return { ok: false, error: err.message };
  }
}

module.exports = {
  createPool,
  getPool,
  resolvePool,
  runWithRequestPool,
  getPoolForLicense,
  runWithPool,
  testConnection,
  initCustomerDatabase,
  customerDbFromLicense,
  getBoundChave,
  readLicenseBinding,
  writeLicenseBinding,
  ensureCustomerPoolFromLicenseIfNeeded,
  extractMysqlConfigFromLicenseRow,
  createPoolFromLicenseBinding,
  getGlobalPool: () => pool,
  destroyPoolForLicense,
  _poolMapKeys: () => _poolMap.keys(),
};
