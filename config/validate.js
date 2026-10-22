/**
 * Validação de entradas — rejeita dados errados antes de tocar no banco / APIs externas.
 */

const CHAVE_RE = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

function normalizeChave(raw) {
  const s = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (s.length !== 16) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}`;
}

function isChaveValida(raw) {
  const n = normalizeChave(raw);
  return !!(n && CHAVE_RE.test(n));
}

function parseCoord(v, nome) {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
  if (!isFinite(n)) return { ok: false, error: `${nome} inválida` };
  return { ok: true, value: n };
}

function parseLatLng(latRaw, lngRaw) {
  const lat = parseCoord(latRaw, 'Latitude');
  if (!lat.ok) return lat;
  const lng = parseCoord(lngRaw, 'Longitude');
  if (!lng.ok) return lng;
  if (lat.value < -90 || lat.value > 90) return { ok: false, error: 'Latitude fora do intervalo (-90…90)' };
  if (lng.value < -180 || lng.value > 180) return { ok: false, error: 'Longitude fora do intervalo (-180…180)' };
  return { ok: true, lat: lat.value, lng: lng.value };
}

function parseRaioKm(raw, { min = 0.05, max = 100, def = 5 } = {}) {
  let n = parseFloat(String(raw ?? def).replace(',', '.'));
  if (!isFinite(n) || n <= 0) n = def;
  n = Math.min(Math.max(n, min), max);
  return n;
}

function cleanStr(v, max = 200) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

function assertLoginBody(body) {
  const loginusu = cleanStr(body?.loginusu, 80);
  const senhausu = String(body?.senhausu ?? '');
  if (!loginusu) return { ok: false, error: 'Informe o usuário' };
  if (!senhausu || senhausu.length > 120) return { ok: false, error: 'Senha inválida' };
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(loginusu)) return { ok: false, error: 'E-mail inválido' };
  return { ok: true, loginusu, senhausu };
}

module.exports = {
  normalizeChave,
  isChaveValida,
  parseLatLng,
  parseRaioKm,
  cleanStr,
  assertLoginBody,
};
