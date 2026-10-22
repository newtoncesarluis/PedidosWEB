'use strict';
/**
 * Detecção automática de resposta dos leads (tela "Hoje"): o provedor de WhatsApp (EuAtendo, Evolution ou Meta)
 * avisa este endereço quando alguém manda mensagem; se o número for de um lead que já recebeu um toque,
 * registra "RESPOSTA", cancela os próximos toques e move NOVO → CONTATO.
 *   POST /api/webhook/lead-whatsapp/:segredo   → mensagens recebidas (responde 200 na hora)
 *   GET  /api/webhook/lead-whatsapp/:segredo   → verificação da Meta (hub.challenge; token de verificação = o segredo)
 * Público (o provedor não tem login): o segredo na URL identifica a empresa. Só LÊ a mensagem — não responde nada.
 * Gerenciamento (ver URL / gerar outra): rotas em routes/leads.js (/api/leads/whatsapp-webhook).
 */
const crypto = require('crypto');
const express = require('express');
const { getPool } = require('../config/database');

const router = express.Router();

const CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS lead_wa_webhook (
    id_empresa INT NOT NULL PRIMARY KEY,
    segredo VARCHAR(40) NOT NULL,
    ultimo_em DATETIME NULL,
    ultimo_resumo VARCHAR(200) NOT NULL DEFAULT '',
    ultimo_payload TEXT NULL,
    UNIQUE KEY uk_lead_wa_segredo (segredo)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;
const _ok = new WeakSet();
async function ensureTable(pool) {
  if (_ok.has(pool)) return;
  await pool.query(CREATE_SQL);
  _ok.add(pool);
}

const novoSegredo = () => crypto.randomBytes(14).toString('hex');

/** Segredo da empresa (cria se ainda não existir). */
async function segredoDa(pool, idEmpresa) {
  await ensureTable(pool);
  await pool.query('INSERT IGNORE INTO lead_wa_webhook (id_empresa, segredo) VALUES (?, ?)', [idEmpresa, novoSegredo()]);
  const [[r]] = await pool.query('SELECT segredo, ultimo_em, ultimo_resumo, ultimo_payload FROM lead_wa_webhook WHERE id_empresa = ?', [idEmpresa]);
  return r;
}

async function gerarOutroSegredo(pool, idEmpresa) {
  await segredoDa(pool, idEmpresa);
  await pool.query('UPDATE lead_wa_webhook SET segredo = ?, ultimo_em = NULL, ultimo_resumo = \'\', ultimo_payload = NULL WHERE id_empresa = ?', [novoSegredo(), idEmpresa]);
  return segredoDa(pool, idEmpresa);
}

const digitos = (v) => String(v || '').replace(/\D/g, '');

/** Procura (em largura, até 5 níveis) o 1º telefone e o 1º texto de um payload de formato desconhecido (ex.: EuAtendo). */
function extrairGenerico(corpo) {
  const CH_FONE = ['number', 'phone', 'from', 'remotejid', 'wa_id', 'telefone', 'contactnumber', 'sender'];
  const CH_TEXTO = ['body', 'text', 'conversation', 'message', 'content', 'msg'];
  let fone = '', texto = '', minha = false;
  const fila = [{ o: corpo, d: 0 }];
  while (fila.length) {
    const { o, d } = fila.shift();
    if (!o || typeof o !== 'object' || d > 5) continue;
    if (o.fromMe === true || o.fromme === true || o.from_me === true) minha = true;
    for (const [k, v] of Object.entries(o)) {
      const kk = k.toLowerCase();
      if (!fone && CH_FONE.includes(kk) && (typeof v === 'string' || typeof v === 'number')) {
        const s = String(v);
        if (!s.includes('@g.us') && !s.includes('status@')) {
          const dg = digitos(s.split('@')[0]);
          if (dg.length >= 10 && dg.length <= 15) fone = dg;
        }
      }
      if (!texto && CH_TEXTO.includes(kk) && typeof v === 'string' && v.trim()) texto = v.trim();
      if (v && typeof v === 'object') fila.push({ o: v, d: d + 1 });
    }
  }
  return fone && !minha ? [{ fone, texto: texto || '(mensagem sem texto)' }] : [];
}

/** Extrai { fone, texto } das mensagens recebidas (Evolution, Meta e, na falta, formato genérico). */
function extrairMensagens(body) {
  const out = [];
  const ev = String((body && body.event) || '').toLowerCase().replace(/_/g, '.');
  if (body && body.data && (ev === '' || ev.includes('messages.upsert'))) {
    const d = body.data;
    const itens = Array.isArray(d) ? d : (Array.isArray(d.messages) ? d.messages : [d]);
    for (const m of itens) {
      const key = m && m.key;
      if (!key || key.fromMe) continue;
      const jid = String(key.remoteJid || '');
      if (!jid || jid.includes('@g.us') || jid.includes('status@')) continue;
      const msg = m.message || {};
      const texto = msg.conversation || (msg.extendedTextMessage && msg.extendedTextMessage.text) || (msg.imageMessage && msg.imageMessage.caption)
        || (msg.buttonsResponseMessage && msg.buttonsResponseMessage.selectedDisplayText) || '';
      out.push({ fone: digitos(jid.split('@')[0]), texto: String(texto || '(mensagem sem texto)') });
    }
  }
  if (body && Array.isArray(body.entry)) {   // Meta (API oficial)
    for (const e of body.entry) {
      for (const c of (e.changes || [])) {
        for (const m of ((c.value && c.value.messages) || [])) {
          const texto = (m.text && m.text.body) || (m.button && m.button.text)
            || (m.interactive && ((m.interactive.button_reply && m.interactive.button_reply.title) || (m.interactive.list_reply && m.interactive.list_reply.title))) || '(mensagem sem texto)';
          out.push({ fone: digitos(m.from), texto: String(texto) });
        }
      }
    }
  }
  const validas = out.filter(m => m.fone.length >= 8);
  return validas.length ? validas : extrairGenerico(body).filter(m => m.fone.length >= 8);
}

const LIMPO = (col) => `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${col},'(',''),')',''),'-',''),' ',''),'+','')`;

/** Lead (que já recebeu toque) dono do número → registra a resposta. Devolve true se casou com algum lead. */
async function registrarResposta(pool, idEmpresa, fone, texto) {
  const fim = fone.slice(-8);
  const [rows] = await pool.query(
    `SELECT l.id FROM leads l
      WHERE l.excluido = 'N' AND l.id_empresa = ?
        AND (RIGHT(${LIMPO('l.whatsapp')}, 8) = ? OR RIGHT(${LIMPO('l.telefone')}, 8) = ?)
        AND EXISTS (SELECT 1 FROM lead_historico h WHERE h.lead_id = l.id AND h.tipo = 'TOQUE')
      ORDER BY l.id DESC LIMIT 1`,
    [idEmpresa, fim, fim]
  );
  if (!rows.length) return false;
  const id = rows[0].id;
  const [rec] = await pool.query(
    "SELECT id FROM lead_historico WHERE lead_id = ? AND tipo = 'RESPOSTA' AND dtcadastro >= DATE_SUB(NOW(), INTERVAL 60 SECOND) LIMIT 1", [id]);
  if (rec.length) return true;   // várias mensagens seguidas: registra uma só
  await pool.query("INSERT INTO lead_historico (lead_id, id_usuario, tipo, descricao) VALUES (?, 0, 'RESPOSTA', ?)",
    [id, `Respondeu no WhatsApp: "${String(texto).slice(0, 200)}"`]);
  await pool.query(
    "UPDATE lead_tarefas SET status = 'CANCELADA' WHERE lead_id = ? AND excluido = 'N' AND status = 'PENDENTE' AND titulo REGEXP '^[0-9]º toque'", [id]);
  await pool.query("UPDATE leads SET data_ultimo_contato = NOW(), status_funil = IF(status_funil = 'NOVO', 'CONTATO', status_funil) WHERE id = ?", [id]);
  return true;
}

async function processar(segredo, body) {
  const pool = getPool();
  await ensureTable(pool);
  const [[cfg]] = await pool.query('SELECT id_empresa FROM lead_wa_webhook WHERE segredo = ? LIMIT 1', [segredo]);
  if (!cfg) return;
  const msgs = extrairMensagens(body);
  let casadas = 0;
  for (const m of msgs) {
    try { if (await registrarResposta(pool, cfg.id_empresa, m.fone, m.texto)) casadas++; }
    catch (e) { console.warn('[lead-webhook] resposta:', e.message); }
  }
  const resumo = msgs.length ? `${msgs.length} mensagem(ns) recebida(s); ${casadas} de lead(s) com toque` : 'Recebido, mas sem mensagem de cliente reconhecida';
  let amostra = '';
  try { amostra = JSON.stringify(body).slice(0, 1500); } catch (_) { /* ignora */ }
  await pool.query('UPDATE lead_wa_webhook SET ultimo_em = NOW(), ultimo_resumo = ?, ultimo_payload = ? WHERE id_empresa = ?', [resumo, amostra, cfg.id_empresa]);
}

// Verificação da Meta: o "token de verificação" a digitar lá é o próprio segredo da URL
router.get('/:segredo', async (req, res) => {
  try {
    const pool = getPool();
    await ensureTable(pool);
    const [[cfg]] = await pool.query('SELECT id_empresa FROM lead_wa_webhook WHERE segredo = ? LIMIT 1', [req.params.segredo]);
    if (cfg && req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === req.params.segredo) {
      return res.status(200).send(String(req.query['hub.challenge'] || ''));
    }
    res.sendStatus(cfg ? 403 : 404);
  } catch (_) { res.sendStatus(500); }
});

router.post('/:segredo', (req, res) => {
  res.sendStatus(200);   // o provedor não espera o processamento
  processar(req.params.segredo, req.body || {}).catch((e) => console.warn('[lead-webhook]', e.message));
});

module.exports = router;
module.exports.segredoDa = segredoDa;
module.exports.gerarOutroSegredo = gerarOutroSegredo;
module.exports._extrairMensagens = extrairMensagens;
