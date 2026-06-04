/**
 * Cache em memória de PDFs para download/compartilhamento via URL HTTP
 * (necessário em mobile HTTP — blob: não abre nem compartilha bem).
 */
const crypto = require('crypto');

const TTL_MS = 10 * 60 * 1000;
const cache = new Map();

function cleanExpired() {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (v.exp < now) cache.delete(k);
  }
}

function putPdfShare(buffer, filename) {
  cleanExpired();
  const token = crypto.randomBytes(24).toString('hex');
  const safeName = String(filename || 'pedido.pdf').replace(/[^\w.\-() ]+/g, '_').slice(0, 120);
  cache.set(token, { buf: buffer, name: safeName || 'pedido.pdf', exp: Date.now() + TTL_MS });
  return token;
}

function getPdfShare(token) {
  if (!token || typeof token !== 'string') return null;
  const item = cache.get(token);
  if (!item || Date.now() > item.exp) {
    cache.delete(token);
    return null;
  }
  return item;
}

module.exports = { putPdfShare, getPdfShare, TTL_MS };
