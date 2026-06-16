const LicenseService = require('../services/license-service');
const LicenseCache   = require('../services/license-cache');
const jwt            = require('jsonwebtoken');
const { customerDbFromLicense, getBoundChave } = require('../config/database');

// Cache em memória isolado por chave_licenca
const _cacheMap = new Map(); // chave → { data, ts }
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

// Rotas que NÃO precisam de licença válida
const BYPASS = [
  '/api/setup',
  '/api/auth',
  '/api/license',
  '/api/client-log',
  '/api/licencas',
  '/api/pedidos/pdf-download', // link temporário do PDF (token na URL; sem JWT no mobile)
  '/setup.html',
  '/login.html',
  '/licencas.html',
  '/assets',
  '/favicon.ico',
];

function getLicenseKey(req) {
  // Modo bound: chave vem do processo, não do JWT de cada usuário
  const bound = getBoundChave();
  if (bound) return bound;

  try {
    const raw = req.cookies?.token || (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (!raw) return null;
    const decoded = jwt.verify(raw, process.env.JWT_SECRET);
    return decoded.chave_licenca || null;
  } catch {
    return null;
  }
}

async function licenseMiddleware(req, res, next) {
  if (process.env.SKIP_LICENSE === 'true') return next();
  if (BYPASS.some(p => req.originalUrl.startsWith(p))) return next();

  try {
    const now    = Date.now();
    const chave  = getLicenseKey(req);
    const mapKey = chave || '__default__';

    // 1. Cache em memória (30 s)
    const entry = _cacheMap.get(mapKey);
    if (entry && now - entry.ts <= CACHE_TTL) {
      return applyResult(entry.data, req, res, next);
    }

    let result;

    if (chave) {
      // 2. Cache em arquivo criptografado (24 h) — isolado por chave
      const cached = LicenseCache.read(chave);
      if (cached) {
        _cacheMap.set(mapKey, { data: cached, ts: now });
        return applyResult(cached, req, res, next);
      }

      // 3. Consulta direta ao remoto pela chave
      result = await LicenseService.checkByKey(chave);
      if (result.valid) LicenseCache.write(chave, result);
    } else {
      if (customerDbFromLicense()) {
        result = { valid: false, status: 'sem_licenca', mensagem: 'Informe sua chave de licença' };
      } else {
        result = await LicenseService.checkLocal();
      }
    }

    // Resultados válidos: cache por CACHE_TTL (5 min). Inválidos: 30 s (retry rápido em falhas transitórias)
    _cacheMap.set(mapKey, { data: result, ts: result.valid ? now : now - (CACHE_TTL - 30_000) });
    return applyResult(result, req, res, next);

  } catch (err) {
    if (getBoundChave() || customerDbFromLicense()) {
      // Fallback: usar cache de arquivo mesmo expirado (Oracle temporariamente indisponível)
      const chaveErr = getLicenseKey(req);
      if (chaveErr) {
        const stale = LicenseCache.read(chaveErr);
        if (stale) {
          // Refresca memória por mais 60s para não sobrecarregar Oracle em retry
          _cacheMap.set(chaveErr || '__default__', { data: stale, ts: Date.now() - CACHE_TTL + 60_000 });
          return applyResult(stale, req, res, next);
        }
      }
      const isApi = (req.originalUrl || '').startsWith('/api/');
      if (isApi) return res.status(503).json({ error: 'Erro ao verificar licença. Tente novamente.' });
      return res.redirect('/login.html?license=error');
    }
    next();
  }
}

function applyResult(result, req, res, next) {
  if (!result.valid) {
    if (req.accepts('html') && !req.originalUrl.startsWith('/api/')) {
      return res.redirect('/login.html?license=expired');
    }
    return res.status(402).json({
      error:            'licenca_invalida',
      status:           result.status,
      mensagem:         result.mensagem         || 'Licença inválida. Entre em contato com o suporte.',
      motivo:           result.motivo           || null,
      chave:            result.chave            || null,
      sistema:          process.env.SYSTEM_NAME         || 'SysRepWeb',
      suporte_whatsapp: process.env.SUPORTE_WHATSAPP   || '',
      suporte_nome:     process.env.SUPORTE_NOME       || 'Suporte Técnico',
      suporte_email:    process.env.SUPORTE_EMAIL       || '',
      pix_chave:        process.env.PIX_CHAVE           || '',
      pix_tipo:         process.env.PIX_TIPO            || '',
      pix_nome:         process.env.PIX_NOME            || '',
      pix_descricao:    process.env.PIX_DESCRICAO       || '',
    });
  }

  if (result.vencido) {
    res.setHeader('X-License-Warning', `Sistema vencido. Bloqueio em ${result.diasRestantesCarencia} dia(s)`);
  } else if (result.aviso) {
    res.setHeader('X-License-Warning', `Licença expira em ${result.diasRestantes} dia(s)`);
  }

  req.licenca = result;
  next();
}

function invalidateLicenseCache(chave) {
  if (chave) {
    _cacheMap.delete(chave);
    LicenseCache.clear(chave);
    const { destroyPoolForLicense } = require('../config/database');
    destroyPoolForLicense(chave);
  } else {
    _cacheMap.clear();
  }
  const { resetDbConfigFlag } = require('../services/license-service');
  resetDbConfigFlag();
}

module.exports = { licenseMiddleware, invalidateLicenseCache };
