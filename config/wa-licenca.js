/**
 * wa-licenca.js
 * Envia WhatsApp usando credenciais armazenadas em db_nresolutions.nre_config.
 * Fallback para env vars se o banco não tiver os valores configurados.
 *
 * Cache de 5 min — invalidado manualmente ao salvar config no painel.
 */

const axios = require('axios');

let _cache    = null;
let _cacheAt  = 0;
const CACHE_MS = 5 * 60 * 1000;

async function getWaConfig() {
  if (_cache && Date.now() - _cacheAt < CACHE_MS) return _cache;

  try {
    const { getNREPool } = require('./db-nresolution');
    const [rows] = await getNREPool().query(
      `SELECT chave, valor FROM nre_config WHERE chave IN ('wa_numero','wa_instancia','wa_url','wa_apikey')`
    );
    const cfg = {};
    rows.forEach(r => { cfg[r.chave] = r.valor; });

    if (cfg.wa_numero && cfg.wa_instancia && cfg.wa_url && cfg.wa_apikey) {
      _cache   = cfg;
      _cacheAt = Date.now();
      return _cache;
    }
  } catch { /* banco não disponível ainda */ }

  // Fallback: env vars
  const cfg = {
    wa_numero:    process.env.ALERTA_WHATSAPP,
    wa_instancia: process.env.ALERTA_WA_INSTANCIA,
    wa_url:       process.env.ALERTA_WA_URL,
    wa_apikey:    process.env.ALERTA_WA_APIKEY,
  };
  if (cfg.wa_numero && cfg.wa_instancia && cfg.wa_url && cfg.wa_apikey) {
    _cache   = cfg;
    _cacheAt = Date.now();
    return _cache;
  }

  return null;
}

function invalidateWaCache() {
  _cache   = null;
  _cacheAt = 0;
}

async function sendWaLicenca(text) {
  const cfg = await getWaConfig();
  if (!cfg) return;
  const base = cfg.wa_url.replace(/\/$/, '');
  await axios.post(
    `${base}/message/sendText/${cfg.wa_instancia}`,
    { number: cfg.wa_numero, text },
    { headers: { apikey: cfg.wa_apikey }, timeout: 10000 }
  );
}

module.exports = { sendWaLicenca, getWaConfig, invalidateWaCache };
