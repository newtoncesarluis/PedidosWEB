'use strict';

/**
 * Integração com a API OFICIAL da Meta — WhatsApp Cloud API (graph.facebook.com).
 *
 * Provedor opcional por cliente (tenant): só é usado quando `wa_provedor = 'META'` e as credenciais estão salvas.
 * Mesmo desenho do EuAtendo (config/euatendo.js): um endpoint único com Bearer token, sem instância nem QR Code.
 *
 *   Texto:    POST {graph}/{versao}/{phone_number_id}/messages   { type:'text',     text:{ body } }
 *   Modelo:   POST {graph}/{versao}/{phone_number_id}/messages   { type:'template', template:{ name, language, components } }
 *   Mídia:    POST {graph}/{versao}/{phone_number_id}/media      (multipart) → id  →  /messages { type:'image'|'document'|... }
 *   Teste:    GET  {graph}/{versao}/{phone_number_id}?fields=display_phone_number,verified_name,quality_rating
 *
 * REGRA DA META (janela de 24 horas): texto livre só é entregue a quem falou com a empresa nas últimas 24h.
 * Fora da janela (caso normal de ofertas/campanhas/pedidos) a Meta exige um MODELO (template) aprovado.
 * Por isso, quando a Meta recusa o texto livre (erro 131047) e o tenant cadastrou um modelo, este módulo reenvia
 * automaticamente como modelo, com o texto da mensagem na variável {{1}} do corpo.
 *
 * Configuração por tenant na tabela `configuracao`:
 *   wa_provedor          — 'EVOLUTION' (padrão) | 'EUATENDO' | 'META'
 *   meta_phone_number_id — ID do número (Meta for Developers → WhatsApp → Configuração da API)
 *   meta_waba_id         — ID da conta do WhatsApp Business (informativo)
 *   meta_access_token    — token PERMANENTE (Usuário do sistema) — nunca é devolvido ao navegador
 *   meta_api_version     — ex.: v21.0
 *   meta_template_nome   — nome do modelo aprovado (1 variável no corpo) — usado fora da janela de 24h
 *   meta_template_idioma — ex.: pt_BR
 *   meta_validado_em     — data do último teste bem-sucedido
 */

const axios    = require('axios');
const FormData = require('form-data');

const VERSAO_PADRAO = 'v21.0';
const IDIOMA_PADRAO = 'pt_BR';

// Sobrescrevível por variável de ambiente (usado nos testes com um servidor Graph falso)
function _graphBase() {
  return String(process.env.META_GRAPH_BASE || 'https://graph.facebook.com').replace(/\/$/, '');
}

// ─── config ──────────────────────────────────────────────────────────────────
function _versao(v) {
  return /^v\d+\.\d+$/.test(String(v || '').trim()) ? String(v).trim() : VERSAO_PADRAO;
}

async function getMetaConfig(pool) {
  const [rows] = await pool.query(
    `SELECT wa_provedor, meta_phone_number_id, meta_waba_id, meta_access_token,
            meta_api_version, meta_template_nome, meta_template_idioma
     FROM configuracao WHERE excluido='N' ORDER BY id DESC LIMIT 1`
  ).catch(() => [[]]);
  const row = rows[0] || {};
  return {
    provedor:      String(row.wa_provedor || 'EVOLUTION').toUpperCase(),
    phoneNumberId: String(row.meta_phone_number_id || '').replace(/\D/g, '') || null,
    wabaId:        String(row.meta_waba_id || '').replace(/\D/g, '') || null,
    token:         row.meta_access_token || null,
    versao:        _versao(row.meta_api_version),
    template:      String(row.meta_template_nome || '').trim() || null,
    idioma:        String(row.meta_template_idioma || IDIOMA_PADRAO).trim() || IDIOMA_PADRAO,
  };
}

/** Devolve a config quando o tenant escolheu a Meta e tem número + token salvos; senão null. */
async function metaAtivo(pool) {
  const cfg = await getMetaConfig(pool);
  return cfg.provedor === 'META' && cfg.token && cfg.phoneNumberId ? cfg : null;
}

// ─── helpers ─────────────────────────────────────────────────────────────────
/** DDI + DDD + número, só dígitos (ex.: 5514999999999). Assume Brasil (55) quando o DDI não veio. */
function normNumeroMeta(fone) {
  const dig = String(fone || '').replace(/\D/g, '');
  if (!dig) return '';
  return dig.startsWith('55') && dig.length >= 12 ? dig : (dig.length <= 11 ? `55${dig}` : dig);
}

function _url(cfg, caminho) {
  return `${_graphBase()}/${_versao(cfg.versao)}/${caminho}`;
}

function _headers(cfg, extra) {
  return { Authorization: `Bearer ${cfg.token}`, ...(extra || {}) };
}

// Mensagens em português para os códigos de erro mais comuns da Cloud API
const ERROS_META = {
  190:    'Token de acesso da Meta inválido ou expirado — gere um token permanente (Usuário do sistema) e salve de novo',
  10:     'O token não tem permissão para enviar mensagens (whatsapp_business_messaging)',
  200:    'O token não tem permissão para este número do WhatsApp',
  33:     'Phone Number ID não encontrado — confira o ID do número em Meta for Developers',
  100:    'Parâmetro inválido — confira o Phone Number ID e o número de destino',
  131047: 'Fora da janela de 24 horas: a Meta só aceita um MODELO (template) aprovado. Cadastre o nome do modelo nas configurações',
  131051: 'Tipo de mensagem não suportado pela Meta',
  131026: 'Mensagem não entregue: o número não tem WhatsApp ou não pode receber mensagens',
  131030: 'Número de destino fora da lista de permitidos (conta em modo de teste da Meta)',
  131056: 'Muitas mensagens para o mesmo número em pouco tempo — tente novamente em instantes',
  130429: 'Limite de envios da Meta atingido — tente novamente em instantes',
  132000: 'Quantidade de variáveis do modelo diferente da esperada — o modelo deve ter 1 variável no corpo ({{1}})',
  132001: 'Modelo não encontrado — confira o nome e o idioma cadastrados',
  132005: 'Texto do modelo longo demais',
  132007: 'Modelo recusado pela política do WhatsApp',
  132012: 'Parâmetro do modelo em formato inválido',
  132015: 'Modelo pausado por baixa qualidade',
  132016: 'Modelo desativado por baixa qualidade',
};

function _erro(err) {
  const g = err && err.response && err.response.data && err.response.data.error;
  let e;
  if (g) {
    const codigo = Number(g.code) || null;
    const base = (codigo && ERROS_META[codigo]) || String(g.error_user_msg || g.message || 'erro desconhecido');
    e = new Error(`Meta (HTTP ${err.response.status}): ${base}${codigo ? ` [código ${codigo}]` : ''}`.slice(0, 400));
    e.metaCode = codigo;
    e.metaDetalhe = g.message || null;
    e.fbtrace = g.fbtrace_id || null;
  } else if (err && err.response) {
    e = new Error(`Meta respondeu HTTP ${err.response.status}: ${String(JSON.stringify(err.response.data)).slice(0, 200)}`);
  } else if (err && (err.code === 'ECONNABORTED' || /timeout/i.test(err.message || ''))) {
    e = new Error('Timeout na API da Meta — verifique a conexão com a internet');
  } else {
    e = new Error((err && err.message) || 'Falha ao falar com a API da Meta');
  }
  e.status = err && err.response ? err.response.status : null;
  return e;
}

/** O corpo de um modelo não aceita quebra de linha/tab nem muitos espaços seguidos, e tem limite de tamanho. */
function textoParaTemplate(texto) {
  return String(texto || '')
    .replace(/[\r\n\t]+/g, ' · ')
    .replace(/ {4,}/g, '   ')
    .trim()
    .slice(0, 1000);
}

async function _postMensagem(cfg, carga, opts) {
  try {
    const resp = await axios.post(
      _url(cfg, `${cfg.phoneNumberId}/messages`),
      { messaging_product: 'whatsapp', recipient_type: 'individual', ...carga },
      { headers: _headers(cfg, { 'Content-Type': 'application/json' }), timeout: (opts && opts.timeoutMs) || 20000 }
    );
    const idMsg = resp.data && resp.data.messages && resp.data.messages[0] && resp.data.messages[0].id;
    return { ok: true, status: resp.status, data: resp.data, messageId: idMsg || null };
  } catch (err) {
    throw _erro(err);
  }
}

// ─── envio de modelo (template) ──────────────────────────────────────────────
async function enviarTemplateMeta(cfg, numero, params = [], opts = {}) {
  const to = normNumeroMeta(numero);
  if (!to) throw new Error('Número de destino inválido');
  if (!cfg.template) {
    throw new Error('Nenhum modelo (template) da Meta cadastrado — configure o nome do modelo aprovado em Configurações de API');
  }
  const template = { name: cfg.template, language: { code: cfg.idioma || IDIOMA_PADRAO } };
  if (params.length) {
    template.components = [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p) })) }];
  }
  const r = await _postMensagem(cfg, { to, type: 'template', template }, opts);
  return { ...r, via: 'template' };
}

// ─── envio de texto ──────────────────────────────────────────────────────────
async function enviarTextoMeta(cfg, numero, texto, opts = {}) {
  const to = normNumeroMeta(numero);
  if (!to) throw new Error('Número de destino inválido');
  try {
    const r = await _postMensagem(
      cfg,
      { to, type: 'text', text: { preview_url: !!opts.previewUrl, body: String(texto || '').slice(0, 4096) } },
      opts
    );
    return { ...r, via: 'texto' };
  } catch (err) {
    // Fora da janela de 24h: reenvia como modelo aprovado, se o cliente cadastrou um
    if (err.metaCode === 131047 && cfg.template && !opts.semModelo) {
      return enviarTemplateMeta(cfg, numero, [textoParaTemplate(texto)], opts);
    }
    throw err;
  }
}

// ─── envio de mídia (PDF, imagem…) ───────────────────────────────────────────
function _tipoMidia(mimetype) {
  const mt = String(mimetype || '').toLowerCase();
  if (/^image\/(jpeg|png)$/.test(mt)) return 'image';
  if (/^video\/(mp4|3gpp)$/.test(mt)) return 'video';
  if (/^audio\/(aac|mp4|mpeg|amr|ogg)/.test(mt)) return 'audio';
  return 'document';
}

async function enviarMediaMeta(cfg, numero, { buffer, filename, mimetype, caption, timeoutMs } = {}) {
  const to = normNumeroMeta(numero);
  if (!to) throw new Error('Número de destino inválido');
  if (!buffer || !buffer.length) throw new Error('Arquivo de mídia vazio');

  // 1) sobe o arquivo para a Meta e recebe o id
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mimetype || 'application/octet-stream');
  form.append('file', buffer, { filename: filename || 'arquivo', contentType: mimetype || 'application/octet-stream' });
  let idMidia;
  try {
    const up = await axios.post(_url(cfg, `${cfg.phoneNumberId}/media`), form, {
      headers: _headers(cfg, form.getHeaders()),
      timeout: timeoutMs || 45000,
      maxBodyLength: Infinity,
    });
    idMidia = up.data && up.data.id;
  } catch (err) {
    throw _erro(err);
  }
  if (!idMidia) throw new Error('A Meta não devolveu o identificador da mídia enviada');

  // 2) manda a mensagem apontando para o id
  const tipo = _tipoMidia(mimetype);
  const conteudo = { id: idMidia };
  if (tipo !== 'audio' && caption) conteudo.caption = String(caption).slice(0, 1024);
  if (tipo === 'document') conteudo.filename = filename || 'arquivo';
  const r = await _postMensagem(cfg, { to, type: tipo, [tipo]: conteudo }, { timeoutMs });
  return { ...r, via: 'midia' };
}

// ─── teste de conexão (não envia nada) ───────────────────────────────────────
async function testarConexaoMeta(cfg) {
  if (!cfg.phoneNumberId || !cfg.token) throw new Error('Informe o Phone Number ID e o token de acesso');
  try {
    const r = await axios.get(_url(cfg, cfg.phoneNumberId), {
      params: { fields: 'display_phone_number,verified_name,quality_rating,name_status' },
      headers: _headers(cfg),
      timeout: 15000,
    });
    const d = r.data || {};
    return {
      ok: true,
      numero: d.display_phone_number || null,
      nome: d.verified_name || null,
      qualidade: d.quality_rating || null,
      statusNome: d.name_status || null,
    };
  } catch (err) {
    throw _erro(err);
  }
}

module.exports = {
  VERSAO_PADRAO,
  IDIOMA_PADRAO,
  getMetaConfig,
  metaAtivo,
  normNumeroMeta,
  textoParaTemplate,
  enviarTextoMeta,
  enviarTemplateMeta,
  enviarMediaMeta,
  testarConexaoMeta,
};
