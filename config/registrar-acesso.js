/**
 * registrar-acesso.js
 * Controle de acessos: grava cada login em duas tabelas (criadas em schema-migrations.js):
 *   - acessos_dispositivos : 1 linha por (usuário + empresa + aparelho), INSERT no 1º acesso,
 *                            UPDATE (último acesso + contador) nos seguintes.
 *   - acessos_log          : histórico completo, 1 linha por login.
 *
 * Captura: dados da licença, empresa, usuário, IP, user-agent e — derivados do user-agent —
 * plataforma (MOBILE/DESKTOP/TABLET), sistema operacional e navegador.
 *
 * Localização (duas fontes complementares):
 *   - Geo-IP (servidor): cidade/estado/país aproximados a partir do IP público (ip-api.com).
 *   - GPS (navegador): latitude/longitude precisas enviadas pelo cliente (com permissão).
 *
 * Observação: o navegador NÃO expõe o nome real da máquina/aparelho. O reconhecimento do
 * mesmo aparelho entre logins vem de um device_id persistente gerado no cliente (localStorage);
 * na ausência dele, geramos um fingerprint estável a partir de user-agent + IP.
 */

const crypto = require('crypto');
const { enviarAcesso: enviarAcessoPainel } = require('../services/painel-acessos');

/** Deriva plataforma, sistema operacional e navegador a partir do user-agent. */
function parseUserAgent(ua = '') {
  const s = String(ua || '');
  const lower = s.toLowerCase();

  // Plataforma
  let plataforma = 'DESKTOP';
  const isTablet = /ipad|tablet|playbook|silk/.test(lower) || (/android/.test(lower) && !/mobile/.test(lower));
  const isMobile = /mobile|iphone|ipod|windows phone|blackberry|opera mini|iemobile/.test(lower);
  if (isTablet) plataforma = 'TABLET';
  else if (isMobile) plataforma = 'MOBILE';

  // Sistema operacional
  let so = 'Desconhecido';
  let m;
  if (/windows nt 10/.test(lower)) so = 'Windows 10/11';
  else if ((m = lower.match(/windows nt ([0-9.]+)/))) so = 'Windows ' + m[1];
  else if (/windows phone/.test(lower)) so = 'Windows Phone';
  else if ((m = lower.match(/android ([0-9.]+)/))) so = 'Android ' + m[1];
  else if (/android/.test(lower)) so = 'Android';
  else if ((m = lower.match(/iphone os ([0-9_]+)/))) so = 'iOS ' + m[1].replace(/_/g, '.');
  else if ((m = lower.match(/cpu os ([0-9_]+)/))) so = 'iPadOS ' + m[1].replace(/_/g, '.');
  else if (/mac os x/.test(lower)) so = 'macOS';
  else if (/cros/.test(lower)) so = 'ChromeOS';
  else if (/linux/.test(lower)) so = 'Linux';

  // Navegador (ordem importa: Edge/Opera mascaram-se de Chrome)
  let navegador = 'Desconhecido';
  if (/edg(a|ios)?\//.test(lower)) navegador = 'Edge';
  else if (/opr\/|opera/.test(lower)) navegador = 'Opera';
  else if (/samsungbrowser/.test(lower)) navegador = 'Samsung Internet';
  else if (/firefox\/|fxios\//.test(lower)) navegador = 'Firefox';
  else if (/chrome\/|crios\//.test(lower)) navegador = 'Chrome';
  else if (/safari\//.test(lower)) navegador = 'Safari';
  else if (/msie |trident\//.test(lower)) navegador = 'Internet Explorer';

  return { plataforma, so, navegador };
}

/** Usa o device_id do cliente; se ausente, gera um fingerprint estável (ua + ip). */
function deviceFingerprint(deviceId, ua, ip) {
  const id = String(deviceId || '').trim();
  if (id) return id.slice(0, 64);
  return 'auto-' + crypto.createHash('sha1')
    .update(String(ua || '') + '|' + String(ip || ''))
    .digest('hex')
    .slice(0, 24);
}

/** Normaliza IPv6-mapeado (::ffff:x.x.x.x) para IPv4. */
function _normIp(ip) {
  return String(ip || '').replace(/^::ffff:/i, '').trim();
}

/** IP local/privado/loopback — Geo-IP não se aplica (localhost, rede interna). */
function _isPrivateIp(ip) {
  const s = _normIp(ip).toLowerCase();
  if (!s) return true;
  if (s === '::1' || s === 'localhost') return true;
  if (s.startsWith('127.') || s.startsWith('10.') || s.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(s)) return true;
  if (s.startsWith('169.254.')) return true;             // link-local IPv4
  if (s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80')) return true; // ULA/link-local IPv6
  return false;
}

// Cache em memória de Geo-IP (evita bater no serviço a cada login do mesmo IP)
const _geoCache = new Map(); // ip -> { cidade, estado, pais, exp }
const GEO_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/** Resolve cidade/estado/país a partir do IP público (null para IP privado/falha). */
async function geoFromIp(ip) {
  const s = _normIp(ip);
  if (_isPrivateIp(s)) return null;

  const cached = _geoCache.get(s);
  if (cached && cached.exp > Date.now()) return cached;

  try {
    const axios = require('axios');
    const r = await axios.get(
      `http://ip-api.com/json/${encodeURIComponent(s)}?fields=status,country,regionName,city&lang=pt-BR`,
      { timeout: 4000 }
    );
    if (r.data && r.data.status === 'success') {
      const geo = {
        cidade: r.data.city || null,
        estado: r.data.regionName || null,
        pais: r.data.country || null,
        exp: Date.now() + GEO_TTL_MS,
      };
      _geoCache.set(s, geo);
      return geo;
    }
  } catch (_) { /* serviço indisponível — segue sem localização */ }
  return null;
}

/**
 * Grava o acesso nas duas tabelas. Nunca lança — falha é logada e ignorada
 * (não pode bloquear o login).
 */
async function registrarAcesso(pool, dados = {}) {
  try {
    if (!pool?.query) return;
    const {
      chave_licenca = null,
      id_empresa = null,
      nome_empresa = null,
      id_usuario = null,
      login_usuario = null,
      nome_usuario = null,
      ip = null,
      user_agent = null,
      device_id = null,
      device_apelido = null,
      latitude = null,
      longitude = null,
    } = dados;

    const { plataforma, so, navegador } = parseUserAgent(user_agent);
    const devId = deviceFingerprint(device_id, user_agent, ip);
    const ua = user_agent ? String(user_agent).slice(0, 400) : null;
    const ipv = ip ? _normIp(ip).slice(0, 64) : null;
    const chave = chave_licenca ? String(chave_licenca).slice(0, 120) : null;
    const apelido = device_apelido ? String(device_apelido).slice(0, 120) : null;
    // id_empresa/id_usuario coeridos para 0 no resumo (NULL quebraria a UNIQUE KEY)
    const empId = parseInt(id_empresa, 10) || 0;
    const usrId = parseInt(id_usuario, 10) || 0;

    // GPS (do navegador) — valida faixa
    const lat = Number.isFinite(parseFloat(latitude)) && Math.abs(parseFloat(latitude)) <= 90
      ? parseFloat(latitude) : null;
    const lng = Number.isFinite(parseFloat(longitude)) && Math.abs(parseFloat(longitude)) <= 180
      ? parseFloat(longitude) : null;

    // Geo-IP (do servidor) — cidade/estado/país aproximados
    const geo = await geoFromIp(ipv);
    const cidade = geo?.cidade || null;
    const estado = geo?.estado || null;
    const pais = geo?.pais || null;

    // 1. Histórico (1 linha por login)
    await pool.query(
      `INSERT INTO acessos_log
        (chave_licenca, id_empresa, nome_empresa, id_usuario, login_usuario, nome_usuario,
         device_id, device_apelido, plataforma, sistema_operacional, navegador, ip, user_agent,
         cidade, estado, pais, latitude, longitude)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [chave, id_empresa || null, nome_empresa || null, id_usuario || null, login_usuario || null,
       nome_usuario || null, devId, apelido, plataforma, so, navegador, ipv, ua,
       cidade, estado, pais, lat, lng]
    );

    // 2. Resumo por aparelho (INSERT ou UPDATE)
    await pool.query(
      `INSERT INTO acessos_dispositivos
        (chave_licenca, id_empresa, nome_empresa, id_usuario, login_usuario, nome_usuario,
         device_id, device_apelido, plataforma, sistema_operacional, navegador, ip, user_agent,
         cidade, estado, pais, latitude, longitude,
         qtd_acessos, dt_primeiro_acesso, dt_ultimo_acesso)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,NOW(),NOW())
       ON DUPLICATE KEY UPDATE
         chave_licenca       = VALUES(chave_licenca),
         nome_empresa        = VALUES(nome_empresa),
         login_usuario       = VALUES(login_usuario),
         nome_usuario        = VALUES(nome_usuario),
         plataforma          = VALUES(plataforma),
         sistema_operacional = VALUES(sistema_operacional),
         navegador           = VALUES(navegador),
         ip                  = VALUES(ip),
         user_agent          = VALUES(user_agent),
         device_apelido      = COALESCE(NULLIF(VALUES(device_apelido), ''), device_apelido),
         cidade              = COALESCE(VALUES(cidade), cidade),
         estado              = COALESCE(VALUES(estado), estado),
         pais                = COALESCE(VALUES(pais), pais),
         latitude            = COALESCE(VALUES(latitude), latitude),
         longitude           = COALESCE(VALUES(longitude), longitude),
         qtd_acessos         = qtd_acessos + 1,
         dt_ultimo_acesso    = NOW()`,
      [chave, empId, nome_empresa || null, usrId, login_usuario || null, nome_usuario || null,
       devId, apelido, plataforma, so, navegador, ipv, ua,
       cidade, estado, pais, lat, lng]
    );

    // 3. Envia ao Painel NC central (não bloqueia; fail-open se não configurado/offline)
    enviarAcessoPainel({
      chave_licenca: chave,
      id_empresa: id_empresa || null,
      nome_empresa: nome_empresa || null,
      id_usuario: id_usuario || null,
      login_usuario: login_usuario || null,
      nome_usuario: nome_usuario || null,
      device_id: devId,
      device_apelido: apelido,
      plataforma, sistema_operacional: so, navegador,
      ip: ipv, user_agent: ua,
      cidade, estado, pais, latitude: lat, longitude: lng,
      dt_acesso: new Date().toISOString(),
    }).catch(() => {});
  } catch (e) {
    console.warn('[registrarAcesso]', e.message);
  }
}

module.exports = { registrarAcesso, parseUserAgent, deviceFingerprint, geoFromIp };
