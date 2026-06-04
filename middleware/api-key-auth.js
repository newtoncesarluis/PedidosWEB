/**
 * api-key-auth.js
 * Middleware de autenticação por API Key para rotas públicas /api/v1/*
 *
 * A chave é enviada no header:
 *   Authorization: Bearer SUA_API_KEY
 *
 * Cada chave fica na tabela `api_keys` do banco de licenças e está vinculada
 * a uma chave_licenca (tenant). O pool correto é injetado via runWithPool.
 */

const { getLicensePool } = require('../config/db-license');
const { getPoolForLicense, createPool, runWithPool } = require('../config/database');
const { extractMysqlConfigFromLicenseRow } = require('../config/customer-db-from-license');
const LicenseCache = require('../services/license-cache');

async function apiKeyAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const key = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (!key) {
    return res.status(401).json({ error: { code: 401, message: 'API Key não informada. Use o header: Authorization: Bearer SUA_API_KEY' } });
  }

  try {
    const licPool = getLicensePool();
    const [rows] = await licPool.query(
      `SELECT ak.*, sl.*
       FROM api_keys ak
       JOIN sistema_licencas sl ON sl.chave_licenca = ak.chave_licenca
       WHERE ak.chave = ? AND ak.ativa = 1 AND sl.ativo = 1
       LIMIT 1`,
      [key]
    );

    if (!rows.length) {
      return res.status(401).json({ error: { code: 401, message: 'API Key inválida ou revogada' } });
    }

    const keyRow = rows[0];
    const chave = keyRow.chave_licenca;

    // Atualiza last_used
    licPool.query('UPDATE api_keys SET last_used = NOW() WHERE chave = ?', [key]).catch(() => {});

    // Resolve pool do tenant
    let pool = getPoolForLicense(chave);

    if (!pool) {
      try {
        const cached = LicenseCache.read(chave);
        if (cached?.dados) {
          const cfg = extractMysqlConfigFromLicenseRow(cached.dados);
          if (cfg) pool = createPool(cfg, chave);
        }
      } catch (_) {}
    }

    if (!pool) {
      try {
        const [licRows] = await licPool.query(
          'SELECT * FROM sistema_licencas WHERE chave_licenca = ? AND ativo = 1 LIMIT 1',
          [chave]
        );
        if (licRows.length) {
          const cfg = extractMysqlConfigFromLicenseRow(licRows[0]);
          if (cfg) {
            pool = createPool(cfg, chave);
            LicenseCache.write(chave, { valid: true, chave_licenca: chave, dados: licRows[0] });
          }
        }
      } catch (_) {}
    }

    if (!pool) {
      return res.status(503).json({ error: { code: 503, message: 'Banco de dados do tenant indisponível' } });
    }

    // Garante que as migrations rodaram para este tenant
    try {
      const { runMigrations } = require('../config/schema-migrations');
      await runWithPool(pool, () => runMigrations(pool));
    } catch (_) {}

    req.apiKey = keyRow;
    return runWithPool(pool, () => next());

  } catch (err) {
    console.error('[api-key-auth] erro:', err.message);
    return res.status(500).json({ error: { code: 500, message: 'Erro interno ao validar API Key' } });
  }
}

module.exports = { apiKeyAuth };
