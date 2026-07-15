const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const { extractMysqlConfigFromLicenseRow } = require('./customer-db-from-license');
const { openTunnel, getTunnelConfig } = require('./ssh-tunnel');

let pool = null;
// Config resolvida do modo BOUND (da licença) — usada para RECONECTAR o pool global
// se ele cair (idle/rede). NUNCA reconectar via process.env.DB_NAME em bound mode:
// isso causava vazamento cross-tenant (pool reconectava no banco do .env, ex: bdally).
let _boundCfg = null;
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
  if (v) return v;
  // DEV LOCALHOST: a base escolhida em license-binding.json amarra o processo a UM tenant
  // (bound mode). Elimina a fragilidade multi-tenant (token precisa de chave, pool por
  // requisição) que atrapalha testes locais. NUNCA em produção — lá vale o multi-tenant real.
  if (process.env.NODE_ENV !== 'production') {
    const b = readLicenseBinding();
    if (b?.chave_licenca) return String(b.chave_licenca).trim().toUpperCase();
  }
  return null;
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

  let cfg = extractMysqlConfigFromLicenseRow(rows[0]);

  // Fallback: licença sem mysql_user cadastrado + credenciais no .env (dev local)
  if (!cfg && process.env.DB_HOST && process.env.DB_USER) {
    const row = rows[0];
    const db = row.mysql_database ?? row.db_name ?? row.database_cliente ?? row.nome_banco ?? '';
    if (db) {
      cfg = {
        host: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT || '3306', 10),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD || '',
        database: String(db).trim(),
        waitForConnections: true,
        connectionLimit: 5,
        queueLimit: 0,
        timezone: '-03:00',
      };
      console.log(`[DB] Multi-tenant — credenciais do .env + banco da licença: ${cfg.database}`);
    }
  }

  if (!cfg) {
    return {
      ok: false,
      error:
        'Licença sem colunas de MySQL no cadastro (mysql_host, mysql_user, mysql_database, mysql_password). ' +
        'Altere a tabela sistema_licencas ou configure PAINEL_API_URL + PAINEL_API_KEY.',
    };
  }

  // Dev local: roteia pelo usuário da licença (Oracle direto ou túnel Hostinger).
  _applyDevHostRouting(cfg);

  const newPool = createPool(cfg, binding.chave_licenca);

  // Garante schema atualizado no banco recém-conectado
  try {
    const { runMigrations, ensurePerfilCadastroColumns } = require('./schema-migrations');
    const { syncChangelogQueue } = require('./changelog-sync');
    await runMigrations(newPool);
    await ensurePerfilCadastroColumns(newPool);
    await syncChangelogQueue(newPool);
  } catch (e) {
    console.warn('[DB] Aviso de migração:', e.message);
  }

  return { ok: true };
}

/**
 * Banco Delphi recém-migrado pode vir com empresa e usuario_empresas vazios.
 * Usa os dados da licença (sistema_licencas) para criar o registro da empresa
 * e vincular o ADMIN ao primeiro login funcionar sem configuração manual.
 */
async function _seedEmpresaFromLicense(targetPool, licRow) {
  try {
    const [[{ cnt }]] = await targetPool.query('SELECT COUNT(*) AS cnt FROM empresa');
    if (cnt > 0) return;

    const razao = (licRow.razao_social || '').trim();
    if (!razao) return;

    await targetPool.query(
      `INSERT IGNORE INTO empresa
         (id_empresa, Razao_empresa, nome_fantasia, cnpj, cidade, uf, telefone, email, responsavel)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        razao,
        razao,
        (licRow.cnpj_cpf   || '').trim(),
        (licRow.cidade      || '').trim(),
        (licRow.estado      || '').trim(),
        (licRow.telefone    || licRow.whatsapp || '').trim(),
        (licRow.email       || '').trim(),
        (licRow.responsavel || '').trim(),
      ]
    );

    // Vincula todos os admins (idperfil=1) à empresa recém-criada
    await targetPool.query(
      `INSERT IGNORE INTO usuario_empresas (cod_empresa, id_usuario, status, excluido)
       SELECT '1', CAST(idusuario AS CHAR), 'SIM', 'N'
       FROM usuarios WHERE idperfil = 1 AND excluido = 'N'`
    );

    console.log(`[DB] Seed empresa: "${razao}" + vínculo ADMIN criados.`);
  } catch (e) {
    console.warn('[DB] Seed empresa ignorado:', e.message);
  }
}

async function initCustomerDatabase() {
  // Abre túnel SSH automaticamente se TUNNEL_SSH_HOST estiver no .env
  if (getTunnelConfig()) await openTunnel();

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

    // ── PROTEÇÃO: licença com user/senha vazios → fallback no .env ──────────────
    // Evita "Access denied" silencioso quando mysql_password está NULL na licença
    // ou db_password_enc não descriptografa. NUNCA faz fallback de database (banco
    // vem SEMPRE da licença — previne contaminação cross-tenant tipo bdally).
    if (cfg) {
      if ((!cfg.user || cfg.user === '') && process.env.DB_USER) {
        console.warn(`[DB] ⚠️ Licença ${boundChave} sem mysql_user — usando DB_USER do .env`);
        cfg.user = process.env.DB_USER;
      }
      if ((cfg.password == null || cfg.password === '') && process.env.DB_PASSWORD) {
        console.warn(`[DB] ⚠️ Licença ${boundChave} sem mysql_password — usando DB_PASSWORD do .env`);
        cfg.password = process.env.DB_PASSWORD;
      }
    }

    // Dev local: roteia pelo USUÁRIO da licença (igual ao multi-tenant) — DEV_DBHOST_<user>
    // aponta direto (ex: DEV_DBHOST_nilton=147.15.106.135 → Oracle); sem mapeamento vai pelo
    // túnel SSH (TUNNEL_LOCAL_PORT). Só muda host:port — user/senha/database vêm da licença.
    // Em produção (sem TUNNEL_LOCAL_PORT) o bloco é NO-OP e usa os dados da licença.
    if (cfg && process.env.NODE_ENV !== 'production') {
      _applyDevHostRouting(cfg);
    }
    if (cfg) {
      console.log(`[DB] Bound mode — ${cfg.host}:${cfg.port}/${cfg.database} (user: ${cfg.user})`);
    }
    _boundCfg = { ...cfg };           // cache p/ reconexão segura (nunca via .env DB_NAME)
    createPool(cfg); // sem chave_licenca → pool global
    await pool.query('SELECT 1');
    try {
      const { runMigrations, ensurePerfilCadastroColumns } = require('./schema-migrations');
      const { syncChangelogQueue } = require('./changelog-sync');
      await runMigrations(pool);
      await ensurePerfilCadastroColumns(pool);
      await syncChangelogQueue(pool);
    } catch (e) {
      console.warn('[DB] Migração:', e.message);
    }
    await _seedEmpresaFromLicense(pool, rows[0]);
    console.log(`[DB] Conectado: ${cfg.database}@${cfg.host}`);
    return;
  }

  // ── Modo legado (XAMPP / DB no .env) ───────────────────────────────────────
  if (!customerDbFromLicense()) {
    createPool();
    await pool.query('SELECT 1');
    try {
      const { runMigrations, ensurePerfilCadastroColumns } = require('./schema-migrations');
      const { syncChangelogQueue } = require('./changelog-sync');
      await runMigrations(pool);
      await ensurePerfilCadastroColumns(pool);
      await syncChangelogQueue(pool);
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

// Plugins de autenticação que o mysql2 nativo não suporta — dão erro claro em vez de "unknown plugin"
const _UNSUPPORTED_AUTH_PLUGINS = {
  auth_gssapi_client: (pluginData, authPlugin, authPluginOutput, authSwitchHandler) => {
    const cfg = authPlugin?.connection?._config || {};
    const where = `${cfg.host || '?'}:${cfg.port || '?'} user=${cfg.user || '?'} db=${cfg.database || '?'}`;
    console.error(`[DB] GSSAPI detectado! Conexão: ${where}`);
    return () => {
      throw new Error(
        `O banco de dados usa autenticação Windows/GSSAPI, não suportada pelo driver. ` +
        `Conexão: ${where}. ` +
        `Corrija o usuário MySQL executando: ` +
        `ALTER USER '${cfg.user || 'usuario'}'@'%' IDENTIFIED WITH mysql_native_password BY 'senha'; FLUSH PRIVILEGES;`
      );
    };
  },
};

function _applyPoolDefaults(config) {
  if (!config.dateStrings) config.dateStrings = ['DATE'];
  if (!config.authPlugins) config.authPlugins = _UNSUPPORTED_AUTH_PLUGINS;
  return config;
}

/**
 * DEV LOCAL: roteia a conexão para o servidor certo conforme o usuário da licença.
 * - DEV_DBHOST_<user> no .env → conexão direta a esse host:port (ex.: Oracle remoto).
 * - Sem mapeamento → vai pelo túnel SSH local (TUNNEL_LOCAL_PORT, ex.: Hostinger).
 * Só atua quando TUNNEL_LOCAL_PORT existe (dev) e o host da licença é local. NO-OP em produção.
 * Muda apenas host:port — user/senha/database continuam vindo da licença.
 */
function _applyDevHostRouting(config) {
  const tunnelPort = parseInt(process.env.TUNNEL_LOCAL_PORT || '0', 10);
  if (!tunnelPort) return; // produção (sem túnel) → não mexe
  const hostLocal = ['localhost', '127.0.0.1', ''].includes((config.host || '').toLowerCase());
  if (!hostLocal) return;
  const devUser = (config.user || '').trim();
  const direct  = (process.env['DEV_DBHOST_' + devUser] || '').trim();
  if (direct) {
    const [h, p] = direct.split(':');
    config.host = (h || '127.0.0.1').trim();
    config.port = parseInt(p || '3306', 10);
    console.log(`[DB] dev routing: user '${devUser}' → direto ${config.host}:${config.port}`);
  } else {
    config.host = '127.0.0.1';
    config.port = tunnelPort;
    console.log(`[DB] dev routing: user '${devUser}' → túnel 127.0.0.1:${tunnelPort}`);
  }
}

function createPool(config = null, chave_licenca = null) {
  // Multi-tenant mode: each license gets its own isolated pool
  if (customerDbFromLicense() && chave_licenca) {
    const oldPool = _poolMap.get(chave_licenca) || null;
    if (oldPool) oldPool.end().catch(() => {});
    if (!config) throw new Error('createPool em modo multi-tenant requer config');
    _applyPoolDefaults(config);
    // Dev local: a licença grava mysql_host=localhost (co-locado em produção), mas do
    // localhost "localhost" é ambíguo — cada cliente vive num servidor diferente.
    // Roteia pelo USUÁRIO da licença (sinal de qual servidor): DEV_DBHOST_<user> no .env
    // aponta direto (ex: DEV_DBHOST_nilton=147.15.106.135:3306 → Oracle). Sem mapeamento,
    // vai pelo túnel SSH (TUNNEL_LOCAL_PORT → Hostinger). Só muda host:port — user/senha/db
    // vêm da licença. Em produção TUNNEL_LOCAL_PORT não existe → bloco ignorado.
    _applyDevHostRouting(config);
    console.log(`[DB] createPool tenant ${chave_licenca.slice(0,8)}… → ${config.user}@${config.host}:${config.port}/${config.database}`);
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
    };
  }
  _applyPoolDefaults(config);
  pool = mysql.createPool(config);
  return pool;
}

function getPool() {
  // Requisições HTTP sempre têm contexto ALS injetado pelo authMiddleware ou pelas rotas de login
  const ctxPool = _als.getStore();
  if (ctxPool) return ctxPool;

  if (!pool || pool.pool._closed) {
    if (customerDbFromLicense()) {
      throw new Error('Banco do cliente ainda não conectado. Ative a licença na tela de login ou reinicie o servidor.');
    }
    // BOUND mode: reconectar SEMPRE pela config da licença em cache — nunca via
    // process.env.DB_NAME (evita vazamento cross-tenant, ex: reconectar em bdally).
    if (getBoundChave()) {
      if (!_boundCfg) {
        throw new Error('Pool bound fechado e sem config em cache. Reinicie o servidor.');
      }
      createPool(_boundCfg);
    } else {
      createPool();
    }
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
    if (!pool || pool.pool._closed) {
      if (customerDbFromLicense()) {
        throw new Error('Banco do cliente ainda não conectado. Ative a licença na tela de login ou reinicie o servidor.');
      }
      // BOUND mode: reconectar pela config da licença em cache — nunca via .env DB_NAME.
      if (getBoundChave()) {
        if (!_boundCfg) {
          throw new Error('Pool bound fechado e sem config em cache. Reinicie o servidor.');
        }
        createPool(_boundCfg);
      } else {
        createPool();
      }
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

/** Retorna o pool registrado para a chave, ou null se não encontrado ou fechado. */
function getPoolForLicense(chave) {
  if (!chave) return null;
  const p = _poolMap.get(String(chave).trim()) || null;
  if (p && p.pool._closed) {
    _poolMap.delete(String(chave).trim());
    return null;
  }
  return p;
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

// ─── DEV LOCALHOST: seletor de base de testes ────────────────────────────────
// Lista as bases disponíveis a partir do cache de licenças (.enc) já baixadas neste
// computador. Usado só em dev (localhost) para escolher em qual cliente testar.
function listDevBases() {
  if (process.env.NODE_ENV === 'production') return [];
  const LicenseCache = require('../services/license-cache');
  const dir = path.join(process.cwd(), 'data', 'licenses');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.enc')); } catch { return []; }
  const atual = (readLicenseBinding()?.chave_licenca || '').trim().toUpperCase();
  const out = [];
  for (const f of files) {
    const chave = f.replace(/\.enc$/i, '');
    const c = LicenseCache.readIgnoreTtl(chave);
    if (!c) continue;
    let cfg = null;
    try { cfg = c.dados ? extractMysqlConfigFromLicenseRow(c.dados) : null; } catch {}
    out.push({
      chave,
      razao: c.dados?.razao_social || c.dados?.nome || chave,
      database: cfg?.database || null,
      atual: chave.toUpperCase() === atual,
    });
  }
  out.sort((a, b) => String(a.razao).localeCompare(String(b.razao)));
  return out;
}

/**
 * Versão completa (async): mescla o cache local (.enc) com TODAS as licenças
 * ativas do servidor de licenças — bases novas aparecem no seletor de dev
 * mesmo sem nunca terem sido usadas neste PC. Se o servidor de licenças
 * estiver fora, cai no cache local (comportamento antigo).
 */
async function listDevBasesFull() {
  const cached = listDevBases();
  if (process.env.NODE_ENV === 'production') return cached;
  try {
    const { getLicensePool } = require('./db-license');
    const licPool = getLicensePool();
    const [rows] = await licPool.query(
      `SELECT * FROM sistema_licencas WHERE ativo = 1`
    );
    const byChave = new Map(cached.map((b) => [b.chave.toUpperCase(), b]));
    const atual = (readLicenseBinding()?.chave_licenca || '').trim().toUpperCase();
    for (const row of rows) {
      const chave = String(row.chave_licenca || '').trim();
      if (!chave || byChave.has(chave.toUpperCase())) continue;
      let cfg = null;
      try { cfg = extractMysqlConfigFromLicenseRow(row); } catch {}
      // Sem banco configurado = licença de outro produto — não serve para o seletor
      if (!cfg?.database) continue;
      byChave.set(chave.toUpperCase(), {
        chave,
        razao: row.razao_social || row.nome || chave,
        database: cfg.database,
        atual: chave.toUpperCase() === atual,
      });
    }
    const out = Array.from(byChave.values());
    out.sort((a, b) => String(a.razao).localeCompare(String(b.razao)));
    return out;
  } catch (e) {
    console.warn('[dev-bases] servidor de licenças indisponível, usando só cache local:', e.message);
    return cached;
  }
}

/**
 * Troca a base ativa em DEV (bound mode) sem reiniciar: grava o binding e recria o
 * pool global apontando para o banco da nova chave. Bloqueado em produção.
 */
async function rebindBoundPool(chave) {
  if (process.env.NODE_ENV === 'production') {
    return { ok: false, error: 'Troca de base desabilitada em produção' };
  }
  const ch = String(chave || '').trim().toUpperCase();
  if (!ch) return { ok: false, error: 'Chave vazia' };

  const { getLicensePool } = require('./db-license');
  const licPool = getLicensePool();
  const [rows] = await licPool.query(
    'SELECT * FROM sistema_licencas WHERE chave_licenca = ? AND ativo = 1',
    [ch]
  );
  if (!rows.length) return { ok: false, error: `Licença ${ch} não encontrada/ativa` };

  let cfg = extractMysqlConfigFromLicenseRow(rows[0]);
  if (!cfg) return { ok: false, error: `Licença ${ch} sem dados de conexão MySQL` };

  // Fallbacks de credencial (mesma proteção do boot bound)
  if ((!cfg.user || cfg.user === '') && process.env.DB_USER) cfg.user = process.env.DB_USER;
  if ((cfg.password == null || cfg.password === '') && process.env.DB_PASSWORD) cfg.password = process.env.DB_PASSWORD;

  // Mesmo roteamento dev do boot (DEV_DBHOST_<user> → direto; senão túnel)
  _applyDevHostRouting(cfg);

  // Recria o pool global e valida a conexão ANTES de gravar o binding
  createPool(cfg); // sem chave → pool global
  await pool.query('SELECT 1');
  _boundCfg = { ...cfg };

  // Persiste a escolha e atualiza o cache de licença desta base
  writeLicenseBinding({ chave_licenca: ch });
  try {
    const LicenseCache = require('../services/license-cache');
    LicenseCache.write(ch, { valid: true, status: rows[0].status || 'ativo', chave_licenca: ch, dados: rows[0] });
  } catch {}

  console.log(`[DB] Base trocada (dev) → ${ch} | ${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}`);
  return { ok: true, chave: ch, database: cfg.database, host: cfg.host, razao: rows[0].razao_social || ch };
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
  listDevBases,
  listDevBasesFull,
  rebindBoundPool,
  _poolMapKeys: () => _poolMap.keys(),
};
