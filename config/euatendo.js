'use strict';

/**
 * Integração com a API do EuAtendo (envio de mensagens WhatsApp).
 *
 * Diferente da Evolution API (self-hosted, instância por usuário + QR Code),
 * o EuAtendo é uma plataforma hospedada: um único endpoint com Bearer token
 * por conexão — sem instância nem QR no nosso lado.
 *
 *   Texto: POST {url}/api/messages/send  (JSON)      { number, body }
 *   Mídia: POST {url}/api/messages/send  (multipart) number, body, medias(arquivo)
 *
 * Configuração por tenant na tabela `configuracao`:
 *   wa_provedor    — 'EVOLUTION' (padrão) | 'EUATENDO'
 *   euatendo_url   — base da API (ex: https://apichat.euatendo.app)
 *   euatendo_token — token da conexão (Bearer)
 */

const axios    = require('axios');
const FormData = require('form-data');

const EUATENDO_URL_PADRAO = 'https://apichat.euatendo.app';

// ─── config ──────────────────────────────────────────────────────────────────
async function getEuAtendoConfig(pool) {
  const [rows] = await pool.query(
    `SELECT wa_provedor, euatendo_url, euatendo_token
     FROM configuracao WHERE excluido='N' ORDER BY id DESC LIMIT 1`
  ).catch(() => [[]]);
  const row = rows[0] || {};
  return {
    provedor: String(row.wa_provedor || 'EVOLUTION').toUpperCase(),
    url:      String(row.euatendo_url || EUATENDO_URL_PADRAO).replace(/\/$/, ''),
    token:    row.euatendo_token || null,
  };
}

/** true quando o tenant escolheu EuAtendo como provedor e tem token salvo */
async function euatendoAtivo(pool) {
  const cfg = await getEuAtendoConfig(pool);
  return cfg.provedor === 'EUATENDO' && !!cfg.token ? cfg : null;
}

// ─── helpers ─────────────────────────────────────────────────────────────────
/** Normaliza para DDI+DDD+NÚMERO (ex: 5514999999999) */
function normNumeroEuAtendo(fone) {
  const dig = String(fone || '').replace(/\D/g, '');
  if (!dig) return '';
  return dig.startsWith('55') ? dig : `55${dig}`;
}

function _endpoint(cfg) {
  return `${cfg.url.replace(/\/$/, '')}/api/messages/send`;
}

function _erroLegivel(err) {
  if (err.response) {
    const b = err.response.data;
    const det = typeof b === 'string' ? b : JSON.stringify(b);
    return `EuAtendo respondeu ${err.response.status}: ${String(det).slice(0, 200)}`;
  }
  if (err.code === 'ECONNABORTED' || /timeout/i.test(err.message)) {
    return 'Timeout na API do EuAtendo — verifique a URL e a conexão';
  }
  return err.message;
}

// ─── envio de texto ──────────────────────────────────────────────────────────
async function enviarTextoEuAtendo(cfg, numero, texto, opts = {}) {
  const number = normNumeroEuAtendo(numero);
  if (!number) throw new Error('Número de destino inválido');
  try {
    const resp = await axios.post(_endpoint(cfg), {
      number,
      body: String(texto || ''),
      userId:        opts.userId  || '',
      queueId:       opts.queueId || '',
      sendSignature: !!opts.sendSignature,
      closeTicket:   !!opts.closeTicket,
    }, {
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${cfg.token}`,
      },
      timeout: opts.timeoutMs || 20000,
    });
    return { ok: true, status: resp.status, data: resp.data };
  } catch (err) {
    throw new Error(_erroLegivel(err));
  }
}

// ─── envio de mídia (PDF, imagem…) ───────────────────────────────────────────
async function enviarMediaEuAtendo(cfg, numero, { buffer, filename, mimetype, caption, userId, queueId, timeoutMs } = {}) {
  const number = normNumeroEuAtendo(numero);
  if (!number) throw new Error('Número de destino inválido');
  if (!buffer || !buffer.length) throw new Error('Arquivo de mídia vazio');

  const form = new FormData();
  form.append('number', number);
  form.append('body', String(caption || ''));
  form.append('medias', buffer, {
    filename:    filename || 'arquivo',
    contentType: mimetype || 'application/octet-stream',
  });
  if (userId)  form.append('userId', userId);
  if (queueId) form.append('queueId', queueId);

  try {
    const resp = await axios.post(_endpoint(cfg), form, {
      headers: {
        ...form.getHeaders(),
        'Authorization': `Bearer ${cfg.token}`,
      },
      timeout: timeoutMs || 45000,
      maxBodyLength: Infinity,
    });
    return { ok: true, status: resp.status, data: resp.data };
  } catch (err) {
    throw new Error(_erroLegivel(err));
  }
}

module.exports = {
  EUATENDO_URL_PADRAO,
  getEuAtendoConfig,
  euatendoAtivo,
  normNumeroEuAtendo,
  enviarTextoEuAtendo,
  enviarMediaEuAtendo,
};
