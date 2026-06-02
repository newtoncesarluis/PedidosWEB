/**
 * alert.js
 * Notifica erros críticos e relatórios via WhatsApp (Evolution API) e/ou email (SMTP).
 *
 * Env vars:
 *   ALERTA_WHATSAPP      — número destino ex: 5514999999999
 *   ALERTA_WA_INSTANCIA  — nome da instância Evolution API
 *   ALERTA_EMAIL         — email destino (usa SMTP já configurado)
 *   ALERTA_THROTTLE_MIN  — minutos entre alertas do mesmo erro (padrão: 5)
 *   ALERTA_WA_URL        — URL Evolution (fallback se não houver config no banco)
 *   ALERTA_WA_APIKEY     — API Key Evolution (fallback)
 */

const axios      = require('axios');
const { sendMail } = require('./mailer');

// ─── Throttle ─────────────────────────────────────────────────────────────────
const THROTTLE_MS = (parseInt(process.env.ALERTA_THROTTLE_MIN, 10) || 5) * 60 * 1000;
const _throttle   = new Map();
function _canSend(key) {
  const last = _throttle.get(key) || 0;
  if (Date.now() - last < THROTTLE_MS) return false;
  _throttle.set(key, Date.now());
  return true;
}

// ─── Config Evolution API (banco → fallback env vars) ────────────────────────
let _waConfig = null;
async function _getWaConfig() {
  if (_waConfig) return _waConfig;
  try {
    const { getPool } = require('./database');
    const [rows] = await getPool().query(
      `SELECT w_urlplataforma, w_apiglobal FROM configuracao WHERE excluido='N' ORDER BY id DESC LIMIT 1`
    );
    if (rows[0]?.w_urlplataforma && rows[0]?.w_apiglobal) {
      _waConfig = { url: rows[0].w_urlplataforma, apikey: rows[0].w_apiglobal };
      return _waConfig;
    }
  } catch { /* banco ainda não disponível */ }
  if (process.env.ALERTA_WA_URL && process.env.ALERTA_WA_APIKEY) {
    _waConfig = { url: process.env.ALERTA_WA_URL, apikey: process.env.ALERTA_WA_APIKEY };
    return _waConfig;
  }
  return null;
}

// ─── Info da licença local (empresa + chave) — cache 1h ──────────────────────
let _licCache = null;
let _licCacheAt = 0;
const LIC_CACHE_MS = 60 * 60 * 1000;

async function _getLicenseInfo() {
  if (_licCache && Date.now() - _licCacheAt < LIC_CACHE_MS) return _licCache;
  try {
    const { getPool } = require('./database');
    const [rows] = await getPool().query(
      `SELECT chave_licenca, dados_cliente FROM config_licenca ORDER BY id DESC LIMIT 1`
    );
    if (!rows.length) return null;
    const chave  = rows[0].chave_licenca;
    let empresa  = null;
    // dados_cliente é JSON com os dados do remote (razao_social, cnpj_cpf, etc.)
    try {
      const d = typeof rows[0].dados_cliente === 'string'
        ? JSON.parse(rows[0].dados_cliente)
        : rows[0].dados_cliente;
      empresa = d?.razao_social || d?.nome || null;
    } catch {}
    // Se não veio no JSON local, tenta buscar no banco remoto (não bloqueia se falhar)
    if (!empresa) {
      try {
        const { getLicensePool } = require('./db-license');
        const [rem] = await getLicensePool().query(
          `SELECT razao_social FROM sistema_licencas WHERE chave_licenca = ? LIMIT 1`, [chave]
        );
        empresa = rem[0]?.razao_social || null;
      } catch {}
    }
    _licCache  = { chave, empresa };
    _licCacheAt = Date.now();
    return _licCache;
  } catch {
    return null;
  }
}

// ─── Envio WhatsApp ───────────────────────────────────────────────────────────
async function _sendWhatsApp(text) {
  const numero    = process.env.ALERTA_WHATSAPP;
  const instancia = process.env.ALERTA_WA_INSTANCIA;
  if (!numero || !instancia) return;
  const cfg = await _getWaConfig();
  if (!cfg) return;
  const base = cfg.url.replace(/\/$/, '');
  await axios.post(
    `${base}/message/sendText/${instancia}`,
    { number: numero, text },
    { headers: { apikey: cfg.apikey }, timeout: 10000 }
  );
}

// ─── Envio Email ──────────────────────────────────────────────────────────────
async function _sendEmail(assunto, text) {
  const to = process.env.ALERTA_EMAIL;
  if (!to) return;
  await sendMail({
    to,
    subject: `[SysRepWeb] ${assunto}`,
    html: `<pre style="font-family:monospace;font-size:13px;line-height:1.5">${
      text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\*/g, '')
    }</pre>`,
  });
}

// ─── Formata mensagem de erro ─────────────────────────────────────────────────
async function _formatError(context, errMsg, stack) {
  const ts    = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const nome  = process.env.SYSTEM_NAME || 'SysRepWeb';
  const lic   = await _getLicenseInfo().catch(() => null);

  let msg = `🚨 *${nome}* — Erro crítico\n`;
  if (lic?.empresa) msg += `🏢 *${lic.empresa}*\n`;
  if (lic?.chave)   msg += `🔑 ${lic.chave}\n`;
  msg += `📍 *${context}*\n`;
  msg += `📝 ${errMsg}\n`;
  if (stack)        msg += `🔍 ${stack}\n`;
  msg += `🕐 ${ts}`;
  return msg;
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Notifica erro via WhatsApp e/ou email.
 * Throttle: mesmo contexto+mensagem não repete antes de ALERTA_THROTTLE_MIN min.
 * Fire-and-forget.
 */
async function notifyError(context, err) {
  const errMsg = err?.message || String(err);
  const stack  = err?.stack
    ? err.stack.split('\n').slice(1, 3).map(s => s.trim()).join(' → ')
    : '';
  if (!_canSend(`${context}::${errMsg.slice(0, 120)}`)) return;
  const msg = await _formatError(context, errMsg, stack);
  _sendWhatsApp(msg).catch(() => {});
  _sendEmail(`Erro — ${context}`, msg).catch(() => {});
}

/**
 * Envia mensagem livre (usada pelo relatório diário e outros).
 * Sem throttle.
 */
async function sendMessage(text, emailAssunto) {
  _sendWhatsApp(text).catch(() => {});
  if (emailAssunto) _sendEmail(emailAssunto, text).catch(() => {});
}

module.exports = { notifyError, sendMessage };
