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

module.exports = router;
