const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');

const GRAPH_VER = 'v20.0';

function mapFbFields(fieldData) {
  const m = {};
  for (const f of (fieldData || [])) {
    const v = f.values?.[0] || '';
    switch (f.name) {
      case 'full_name':                         m.nome = v; break;
      case 'first_name':                        m.first = v; break;
      case 'last_name':                         m.last = v; break;
      case 'email':                             m.email = v; break;
      case 'phone_number': case 'phone':        m.telefone = v; m.whatsapp = v; break;
      case 'company_name': case 'company':      m.empresa = v; break;
      case 'job_title':                         m.cargo = v; break;
      case 'city':                              m.cidade = v; break;
      case 'state': case 'province': case 'region': m.uf = v.toUpperCase().slice(0, 2); break;
      default:
        if (!m._extra) m._extra = [];
        m._extra.push(`${f.name}: ${v}`);
    }
  }
  if (!m.nome && (m.first || m.last)) m.nome = [m.first, m.last].filter(Boolean).join(' ');
  if (m._extra?.length) m.observacoes = m._extra.join('\n');
  delete m.first; delete m.last; delete m._extra;
  return m;
}

// GET /api/webhooks/facebook-leads — verificação do webhook pelo Meta
router.get('/facebook-leads', async (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode !== 'subscribe' || !token) return res.status(403).send('Forbidden');

  try {
    const pool = getPool();
    const [[cfg]] = await pool.query(
      `SELECT fb_verify_token FROM configuracao WHERE excluido='N' ORDER BY id DESC LIMIT 1`
    );
    if (!cfg?.fb_verify_token || cfg.fb_verify_token !== token) {
      return res.status(403).send('Verify token mismatch');
    }
    res.send(challenge);
  } catch (err) {
    console.error('[webhook/fb] GET error:', err.message);
    res.status(500).send('Internal error');
  }
});

// POST /api/webhooks/facebook-leads — recebe notificação e cria o lead
router.post('/facebook-leads', async (req, res) => {
  res.sendStatus(200); // responde imediatamente — Meta não deve aguardar

  const body = req.body;
  if (!body || body.object !== 'page') return;

  try {
    const pool = getPool();
    const [[cfg]] = await pool.query(
      `SELECT fb_page_access_token, fb_default_id_empresa, fb_default_id_vendedor
       FROM configuracao WHERE excluido='N' ORDER BY id DESC LIMIT 1`
    );
    if (!cfg?.fb_page_access_token) {
      console.warn('[webhook/fb] Page Access Token não configurado — lead ignorado');
      return;
    }

    const axios = require('axios');
    const idEmpresa  = parseInt(cfg.fb_default_id_empresa || 1, 10);
    const idVendedor = cfg.fb_default_id_vendedor ? parseInt(cfg.fb_default_id_vendedor, 10) : null;

    for (const entry of (body.entry || [])) {
      for (const change of (entry.changes || [])) {
        if (change.field !== 'leadgen') continue;
        const leadgenId = change.value?.leadgen_id;
        if (!leadgenId) continue;

        try {
          const { data } = await axios.get(
            `https://graph.facebook.com/${GRAPH_VER}/${leadgenId}`,
            {
              params: {
                access_token: cfg.fb_page_access_token,
                fields: 'field_data,created_time,form_id,id'
              },
              timeout: 15000
            }
          );

          const f = mapFbFields(data.field_data || []);
          if (!f.nome) {
            console.warn(`[webhook/fb] Leadgen ${leadgenId} sem nome — ignorado`);
            continue;
          }

          const [result] = await pool.query(
            `INSERT INTO leads (
               id_empresa, id_usuario, id_vendedor,
               nome, empresa, telefone, whatsapp, email, cidade, uf, cargo, observacoes,
               origem, campanha, status_funil, temperatura_lead, prioridade, canal_atendimento,
               motivo_perda, valor_estimado, tags
             ) VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Facebook Ads', ?, 'NOVO', 'FRIO', 'MEDIA', 'COMERCIAL', '', 0, '')`,
            [
              idEmpresa, idVendedor,
              f.nome, f.empresa || '', f.telefone || '', f.whatsapp || '',
              f.email || '', f.cidade || '', (f.uf || '').toUpperCase().slice(0, 2),
              f.cargo || '', f.observacoes || '',
              data.form_id || ''
            ]
          );

          await pool.query(
            `INSERT INTO lead_historico (lead_id, id_usuario, tipo, descricao) VALUES (?, 0, 'CRIACAO', ?)`,
            [result.insertId, `Lead recebido via Facebook Lead Ads. Form: ${data.form_id || '—'} · Leadgen: ${leadgenId}`]
          );

          console.log(`[webhook/fb] Lead #${result.insertId} criado: ${f.nome}`);
        } catch (e) {
          console.error(`[webhook/fb] Erro leadgen ${leadgenId}:`, e.message);
        }
      }
    }
  } catch (err) {
    console.error('[webhook/fb] POST error:', err.message);
  }
});

// POST /api/webhooks/evolution — recebe eventos da Evolution API (Instagram DM, etc.)
router.post('/evolution', async (req, res) => {
  res.sendStatus(200); // sempre 200 imediato — Evolution API não aguarda

  const body = req.body;
  if (!body) return;

  // Só processa mensagens recebidas (não enviadas por nós)
  if (body.event !== 'messages.upsert') return;
  const data = body.data;
  if (!data || data.key?.fromMe) return;

  const remoteJid = data.key?.remoteJid || '';
  // Identifica Instagram pelo remoteJid ou pelo nome da instância
  const isInstagram = remoteJid.includes('@instagram') ||
                      String(body.instance || '').toLowerCase().includes('instagram') ||
                      String(body.instance || '').toLowerCase().startsWith('ig-') ||
                      String(body.instance || '').toLowerCase().startsWith('ig_');
  if (!isInstagram) return;

  try {
    const pool = getPool();
    const [[cfg]] = await pool.query(
      `SELECT ig_instancia, fb_default_id_empresa, fb_default_id_vendedor,
              ig_autoreply, ig_reply_msg, w_urlplataforma, w_apiglobal
       FROM configuracao WHERE excluido='N' ORDER BY id DESC LIMIT 1`
    ).catch(() => [[null]]);
    if (!cfg) return;

    // Valida instância se configurada
    if (cfg.ig_instancia && body.instance !== cfg.ig_instancia) return;

    const idEmpresa  = parseInt(cfg.fb_default_id_empresa || 1, 10);
    const idVendedor = cfg.fb_default_id_vendedor ? parseInt(cfg.fb_default_id_vendedor, 10) : null;

    // Handle Instagram: @usuario ou ID numérico
    const igId = remoteJid.split('@')[0];
    const pushName = String(data.pushName || igId).slice(0, 150);
    const igField  = `@${igId}`;

    // Extrai texto da mensagem
    const msgText = (
      data.message?.conversation ||
      data.message?.extendedTextMessage?.text ||
      data.message?.imageMessage?.caption ||
      data.message?.videoMessage?.caption ||
      '[mídia]'
    ).slice(0, 500);

    // Verifica se já existe um lead com este Instagram
    const [[existing]] = await pool.query(
      `SELECT id FROM leads WHERE (instagram=? OR instagram=?) AND excluido='N' AND id_empresa=? LIMIT 1`,
      [igField, igId, idEmpresa]
    );

    if (existing) {
      // Atualiza data_ultimo_contato e adiciona histórico
      await pool.query(`UPDATE leads SET data_ultimo_contato=NOW() WHERE id=?`, [existing.id]);
      await pool.query(
        `INSERT INTO lead_historico (lead_id, id_usuario, tipo, descricao) VALUES (?, 0, 'NOTA', ?)`,
        [existing.id, `Instagram DM: "${msgText}"`]
      );
      console.log(`[webhook/ig] Histórico adicionado ao lead #${existing.id}`);
    } else {
      // Cria novo lead
      const [result] = await pool.query(
        `INSERT INTO leads (
           id_empresa, id_usuario, id_vendedor,
           nome, instagram, origem, status_funil, temperatura_lead,
           prioridade, canal_atendimento, motivo_perda, valor_estimado, tags, observacoes
         ) VALUES (?, 0, ?, ?, ?, 'Instagram DM', 'NOVO', 'MORNO', 'MEDIA', 'COMERCIAL', '', 0, '', ?)`,
        [idEmpresa, idVendedor, pushName, igField,
         `Primeiro contato via Instagram DM:\n"${msgText}"`]
      );
      await pool.query(
        `INSERT INTO lead_historico (lead_id, id_usuario, tipo, descricao) VALUES (?, 0, 'CRIACAO', ?)`,
        [result.insertId, `Lead criado via Instagram DM — ${igField}. Mensagem: "${msgText}"`]
      );
      console.log(`[webhook/ig] Lead #${result.insertId} criado: ${pushName} (${igField})`);
    }

    // Auto-resposta configurável
    if (cfg.ig_autoreply === 'S' && cfg.ig_reply_msg && cfg.w_urlplataforma && body.instance) {
      try {
        const axios = require('axios');
        const base  = cfg.w_urlplataforma.replace(/\/$/, '');
        await axios.post(
          `${base}/message/sendText/${body.instance}`,
          { number: remoteJid, text: cfg.ig_reply_msg },
          { headers: { 'Content-Type': 'application/json', apikey: cfg.w_apiglobal }, timeout: 10000 }
        );
      } catch (e) {
        console.error('[webhook/ig] Auto-reply error:', e.message);
      }
    }
  } catch (err) {
    console.error('[webhook/ig] Error:', err.message);
  }
});

module.exports = router;
