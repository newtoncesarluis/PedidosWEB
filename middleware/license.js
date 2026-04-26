const LicenseService = require('../services/license-service');

// Sem cache — verifica sempre no banco remoto para bloqueio em tempo real
let _cache     = null;
let _cacheTime = 0;
const CACHE_TTL = 30 * 1000; // 30 segundos (mínimo para não sobrecarregar o banco)

// Rotas que NÃO precisam de licença válida
const BYPASS = [
  '/api/setup',
  '/api/auth',
  '/api/license',
  '/api/licencas',
  '/setup.html',
  '/login.html',
  '/licencas.html',
  '/assets',
  '/favicon.ico',
];

async function licenseMiddleware(req, res, next) {
  if (BYPASS.some(p => req.originalUrl.startsWith(p))) return next();

  try {
    const now = Date.now();
    if (!_cache || now - _cacheTime > CACHE_TTL) {
      _cache     = await LicenseService.checkLocal();
      _cacheTime = now;
    }

    if (!_cache.valid) {
      if (req.accepts('html') && !req.originalUrl.startsWith('/api/')) {
        return res.redirect('/login.html?license=expired');
      }
      return res.status(402).json({
        error:    'licenca_invalida',
        status:   _cache.status,
        mensagem: _cache.mensagem || 'Licença inválida. Entre em contato com o suporte.',
        motivo:   _cache.motivo  || null,
        chave:    _cache.chave   || null,
        sistema:              process.env.SYSTEM_NAME         || 'SysRepWeb',
        suporte_whatsapp:     process.env.SUPORTE_WHATSAPP   || '',
        suporte_nome:         process.env.SUPORTE_NOME       || 'Suporte Técnico',
        suporte_email:        process.env.SUPORTE_EMAIL      || '',
        pix_chave:            process.env.PIX_CHAVE          || '',
        pix_tipo:             process.env.PIX_TIPO           || '',
        pix_nome:             process.env.PIX_NOME           || '',
        pix_descricao:        process.env.PIX_DESCRICAO      || '',
      });
    }

    // Aviso de vencimento próximo ou período de carência
    if (_cache.vencido) {
      res.setHeader('X-License-Warning', `Sistema vencido. Bloqueio em ${_cache.diasRestantesCarencia} dia(s)`);
    } else if (_cache.aviso) {
      res.setHeader('X-License-Warning', `Licença expira em ${_cache.diasRestantes} dia(s)`);
    }

    req.licenca = _cache;
    next();
  } catch {
    // Em caso de erro na verificação, libera o acesso (fail-open)
    next();
  }
}

function invalidateLicenseCache() {
  _cache     = null;
  _cacheTime = 0;
}

module.exports = { licenseMiddleware, invalidateLicenseCache };
