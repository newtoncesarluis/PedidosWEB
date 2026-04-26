const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];

  // Identifica se é uma chamada de API
  const isApi = req.path.startsWith('/api/');

  if (!token) {
    if (isApi) {
      return res.status(401).json({ error: 'Sessão expirada ou não autenticado', redirect: true });
    }
    return res.redirect('/login.html');
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    if (isApi) {
      return res.status(401).json({ error: 'Token inválido ou expirado', redirect: true });
    }
    return res.redirect('/login.html');
  }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso restrito a administradores' });
  }
  next();
}

module.exports = { authMiddleware, adminOnly };
