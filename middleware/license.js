const { checkLicense } = require('../config/license');

async function licenseMiddleware(req, res, next) {
  // Rotas que não precisam de licença
  const exempt = ['/api/setup', '/api/auth/login', '/setup.html', '/login.html',
                  '/assets', '/favicon.ico', '/api/license/status'];
  if (exempt.some(r => req.path.startsWith(r))) return next();

  const result = await checkLicense();

  if (!result.valid) {
    if (req.accepts('html')) {
      return res.redirect(`/login.html?license=expired`);
    }
    return res.status(402).json({ error: result.reason, expired: result.expired });
  }

  // Aviso de expiração próxima (7 dias)
  if (result.daysLeft <= 7) {
    res.setHeader('X-License-Warning', `Licença expira em ${result.daysLeft} dia(s)`);
  }

  req.license = result;
  next();
}

module.exports = { licenseMiddleware };
