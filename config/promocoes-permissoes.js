/** Permissões granulares — Comercial › Promoções de Produtos */

const PROMO_PERM_KEYS = [
  'incluir_promocoes',
  'alterar_promocoes',
  'excluir_promocoes',
  'prorrogar_promocoes',
  'manutencao_promocoes',
];

function isPromoAdmin(req) {
  const u = req.user;
  return u?.perfil == 1 || u?.role === 'admin';
}

function promoPerms(req) {
  return req.user?.permissoes || {};
}

function hasAnyPromoAccess(req) {
  if (isPromoAdmin(req)) return true;
  const p = promoPerms(req);
  return PROMO_PERM_KEYS.some((k) => p[k] === 'S');
}

function hasPromoPerm(req, key) {
  if (isPromoAdmin(req)) return true;
  return promoPerms(req)[key] === 'S';
}

function denyPromo(res, message) {
  return res.status(403).json({ error: message || 'Sem permissão para promoções' });
}

function requirePromoAccess(req, res) {
  if (!hasAnyPromoAccess(req)) {
    denyPromo(res, 'Sem permissão para acessar promoções');
    return false;
  }
  return true;
}

function requirePromoPerm(req, res, key, message) {
  if (!hasPromoPerm(req, key)) {
    denyPromo(res, message || 'Sem permissão para esta operação em promoções');
    return false;
  }
  return true;
}

function requirePromoLote(req, res, acao) {
  const a = String(acao || '').toLowerCase();
  if (a === 'prorrogar') {
    return requirePromoPerm(req, res, 'prorrogar_promocoes', 'Sem permissão para prorrogar promoções');
  }
  if (a === 'inativar' || a === 'ativar') {
    return requirePromoPerm(req, res, 'manutencao_promocoes', 'Sem permissão para manutenção de promoções');
  }
  if (a === 'excluir') {
    return requirePromoPerm(req, res, 'excluir_promocoes', 'Sem permissão para excluir promoções');
  }
  denyPromo(res, 'Ação inválida');
  return false;
}

module.exports = {
  PROMO_PERM_KEYS,
  isPromoAdmin,
  hasAnyPromoAccess,
  hasPromoPerm,
  denyPromo,
  requirePromoAccess,
  requirePromoPerm,
  requirePromoLote,
};
