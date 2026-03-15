const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];

  if (!token) {
    if (req.accepts('html')) return res.redirect('/login.html');
    return res.status(401).json({ error: 'Não autenticado' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    if (req.accepts('html')) return res.redirect('/login.html');
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso restrito a administradores' });
  }
  next();
}

module.exports = { authMiddleware, adminOnly };
