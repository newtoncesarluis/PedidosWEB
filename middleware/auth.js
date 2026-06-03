const jwt = require('jsonwebtoken');
const {
  getBoundChave,
  customerDbFromLicense,
  getPoolForLicense,
  createPool,
  runWithPool,
  createPoolFromLicenseBinding,
  getGlobalPool,
  readLicenseBinding,
  _poolMapKeys,
} = require('../config/database');
const { extractMysqlConfigFromLicenseRow } = require('../config/customer-db-from-license');
const LicenseCache = require('../services/license-cache');

async function authMiddleware(req, res, next) {
  const pathOnly = String(req.originalUrl || req.url || '/').split('?')[0];
  const isApi = pathOnly.startsWith('/api/') || pathOnly === '/api';

  const candidates = [
    req.cookies?.token,
    req.headers.authorization?.split(' ')[1],
  ].filter(Boolean);

  if (!candidates.length) {
    if (isApi) return res.status(401).json({ error: 'Sessão expirada ou não autenticado', redirect: true });
    return res.redirect('/login.html');
  }

  for (const t of candidates) {
    try {
      req.user = jwt.verify(t, process.env.JWT_SECRET);

      // ── Modo BOUND: pool global criado no startup, sem ALS, sem risco de contaminação ──
      if (getBoundChave()) return next();

      // ── Modo multi-tenant legado ──────────────────────────────────────────────
      if (customerDbFromLicense() && req.user.chave_licenca) {
        const chaveToken = String(req.user.chave_licenca).trim();
        let p = getPoolForLicense(chaveToken);

        // Recuperação 1: cache .enc por chave (após restart do PM2)
        if (!p) {
          try {
            const cached = LicenseCache.read(chaveToken);
            if (cached?.dados) {
              const cfg = extractMysqlConfigFromLicenseRow(cached.dados);
              if (cfg) p = createPool(cfg, chaveToken);
            }
          } catch (_) {}
        }

        // Recuperação 2: consulta Oracle direta pela chave do JWT (sem fallback global)
        if (!p) {
          try {
            const { getLicensePool } = require('../config/db-license');
            const licPool = getLicensePool();
            const [rows] = await licPool.query(
              'SELECT * FROM sistema_licencas WHERE chave_licenca = ? AND ativo = 1',
              [chaveToken]
            );
            if (rows.length) {
              const cfg = extractMysqlConfigFromLicenseRow(rows[0]);
              if (cfg) {
                p = createPool(cfg, chaveToken);
                LicenseCache.write(chaveToken, { valid: true, status: rows[0].status || 'ativo', chave_licenca: chaveToken, dados: rows[0] });
              }
            }
          } catch (_) {}
        }

        if (p) return runWithPool(p, () => next());

        console.error(`[auth] POOL NULL. chave="${chaveToken}" pool_keys=[${[..._poolMapKeys()].join(',')}]`);
        if (isApi) return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.', redirect: true });
        return res.redirect('/login.html');
      }

      // Multi-tenant sem chave no token: nega acesso (nunca cair no pool global)
      if (customerDbFromLicense()) {
        if (isApi) return res.status(401).json({ error: 'Token sem licença. Faça login novamente.', redirect: true });
        return res.redirect('/login.html');
      }

      return next();
    } catch (_) {}
  }

  if (isApi) return res.status(401).json({ error: 'Token inválido ou expirado', redirect: true });
  return res.redirect('/login.html');
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso restrito a administradores' });
  }
  next();
}

module.exports = { authMiddleware, adminOnly };
