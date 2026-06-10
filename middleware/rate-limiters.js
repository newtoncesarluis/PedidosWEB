'use strict';

const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;
const { sendMessage } = require('../config/alert');

// IPs atualmente bloqueados (em memória) — usado para "liberar tudo"
const _blockedIPs = new Set();
// Throttle de notificações por IP: não envia WA repetido dentro de 10 min
const _notifiedAt = new Map();
const NOTIFY_COOLDOWN_MS = 10 * 60 * 1000;

function _notifyBlock(ip, endpoint) {
  if (process.env.NODE_ENV !== 'production') return;
  const last = _notifiedAt.get(ip) || 0;
  if (Date.now() - last < NOTIFY_COOLDOWN_MS) return;
  _notifiedAt.set(ip, Date.now());

  const ts = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const msg =
    `🔒 *SysRepWeb — Acesso bloqueado*\n` +
    `📍 IP: \`${ip}\`\n` +
    `🛣️  Rota: ${endpoint}\n` +
    `🕐 ${ts}\n\n` +
    `Para liberar este IP responda:\n*liberar ${ip}*\n\n` +
    `Para liberar todos:\n*liberar tudo*\n\n` +
    `Para ver status:\n*status*`;
  sendMessage(msg).catch(() => {});
}

function _makeHandler(windowMs) {
  return function handler(req, res, _next, options) {
    _blockedIPs.add(req.ip);
    _notifyBlock(req.ip, req.path);
    const resetAt = req.rateLimit?.resetTime
      ? Math.floor(req.rateLimit.resetTime.getTime() / 1000)
      : Math.floor((Date.now() + windowMs) / 1000);
    res.status(options.statusCode).json({ error: options.message.error, resetAt });
  };
}

const AUTH_WINDOW_MS    = 15 * 60 * 1000;
const LICENSE_WINDOW_MS = 60 * 60 * 1000;

const _skipRateLimit = () => process.env.NODE_ENV !== 'production';

const authLimiter = rateLimit({
  windowMs: AUTH_WINDOW_MS,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  skip: _skipRateLimit,
  message: { error: 'Muitas tentativas. Aguarde 15 minutos antes de tentar novamente.' },
  handler: _makeHandler(AUTH_WINDOW_MS),
});

/** empresas-usuario é chamado ao sair do campo senha e no Enter — limite separado do login. */
const empresasUsuarioLimiter = rateLimit({
  windowMs: AUTH_WINDOW_MS,
  max: 45,
  standardHeaders: true,
  legacyHeaders: false,
  skip: _skipRateLimit,
  message: { error: 'Muitas consultas de empresa. Aguarde 15 minutos antes de tentar novamente.' },
  handler: _makeHandler(AUTH_WINDOW_MS),
});

const licenseLimiter = rateLimit({
  windowMs: LICENSE_WINDOW_MS,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: _skipRateLimit,
  message: { error: 'Muitas tentativas de ativação. Aguarde 1 hora.' },
  handler: _makeHandler(LICENSE_WINDOW_MS),
});

/** Rate limit para /api/v1 — identificado pela API Key (não por IP). */
const API_WINDOW_MS = 60 * 1000;
const apiLimiter = rateLimit({
  windowMs: API_WINDOW_MS,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  skip: _skipRateLimit,
  keyGenerator: (req) => {
    const auth = req.headers['authorization'] || '';
    return auth.startsWith('Bearer ') ? auth.slice(7) : ipKeyGenerator(req);
  },
  message: { error: { code: 429, message: 'Muitas requisições. Limite: 600/min por API Key.' } },
  handler: (req, res, _next, options) => {
    res.status(429).json(options.message);
  },
});

/** Libera um IP específico de todos os limiters. */
function resetIP(ip) {
  authLimiter.resetKey(ip);
  empresasUsuarioLimiter.resetKey(ip);
  licenseLimiter.resetKey(ip);
  _blockedIPs.delete(ip);
  _notifiedAt.delete(ip);
}

/** Libera todos os IPs bloqueados. */
function resetAll() {
  for (const ip of _blockedIPs) {
    authLimiter.resetKey(ip);
    empresasUsuarioLimiter.resetKey(ip);
    licenseLimiter.resetKey(ip);
    _notifiedAt.delete(ip);
  }
  const count = _blockedIPs.size;
  _blockedIPs.clear();
  return count;
}

function getBlockedCount() { return _blockedIPs.size; }

module.exports = { authLimiter, empresasUsuarioLimiter, licenseLimiter, apiLimiter, resetIP, resetAll, getBlockedCount };
