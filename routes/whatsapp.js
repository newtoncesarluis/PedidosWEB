const express = require('express');
const router  = express.Router();
const https   = require('https');
const http    = require('http');
const { getPool } = require('../config/database');

// ─── helper: faz request HTTP/HTTPS para a Evolution API ─────────────────────
function apiRequest(baseUrl, path, method = 'GET', apikey, body = null) {
  return new Promise((resolve, reject) => {
    const url    = new URL(path, baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');
    const isHttps = url.protocol === 'https:';
    const lib    = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port:     url.port || (isHttps ? 443 : 80),
      path:     url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': apikey
      },
      timeout: 15000,
      rejectUnauthorized: false   // aceita cert auto-assinado
    };

    const bodyStr = body ? JSON.stringify(body) : null;
    if (bodyStr) options.headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const req = lib.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout na API')); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ─── pega configuração salva no banco ────────────────────────────────────────
async function getConfig() {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT w_urlplataforma, w_apiglobal FROM configuracao WHERE excluido='N' ORDER BY id DESC LIMIT 1`
  );
  if (!rows[0] || !rows[0].w_urlplataforma || !rows[0].w_apiglobal) {
    throw new Error('API não configurada. Configure a URL e a API Key primeiro.');
  }
  return { url: rows[0].w_urlplataforma, apikey: rows[0].w_apiglobal };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/whatsapp/testar-api
// Testa a conexão com a Evolution API (lista instâncias)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/testar-api', async (req, res) => {
  try {
    const { url, apikey } = req.body;
    if (!url || !apikey) return res.status(400).json({ error: 'url e apikey obrigatórios' });

    const r = await apiRequest(url, '/instance/fetchInstances', 'GET', apikey);
    if (r.status === 200 || r.status === 201) {
      const lista = Array.isArray(r.body) ? r.body : (r.body?.instances || []);
      res.json({ ok: true, instancias: lista.length });
    } else {
      res.json({ ok: false, error: `Erro ${r.status}: ${JSON.stringify(r.body)}` });
    }
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/whatsapp/usuarios
// Lista usuários com status de conexão WhatsApp
// ─────────────────────────────────────────────────────────────────────────────
router.get('/usuarios', async (req, res) => {
  try {
    const pool = getPool();
    const [usuarios] = await pool.query(
      `SELECT idusuario, nomeusu, loginusu, instancia, chave, data_conexao, status, numero_whatsApp
       FROM usuarios WHERE excluido='N' ORDER BY nomeusu`
    );

    // Tenta buscar instâncias da API (se configurada)
    let cfg = null;
    let apiInstancias = [];  // [{instanceName, apikey, owner, state}]
    try {
      cfg = await getConfig();
      const r = await apiRequest(cfg.url, '/instance/fetchInstances', 'GET', cfg.apikey);
      if (Array.isArray(r.body)) {
        apiInstancias = r.body.map(inst => ({
          instanceName: inst.instance?.instanceName || inst.instanceName,
          apikey:       inst.hash?.apikey           || inst.apikey || null,
          owner:        inst.instance?.owner        || inst.owner  || null,
          state:        inst.instance?.connectionStatus || inst.connectionStatus || null
        }));
      }
    } catch {}

    // Monta mapa por nome para enriquecer chave/owner (lookup auxiliar)
    const mapaNome = {};
    for (const inst of apiInstancias) {
      const nome = inst.instanceName;
      if (nome) mapaNome[nome.toLowerCase()] = inst;
    }

    // Garante coluna numero_whatsApp (silencioso se já existir)
    if (cfg) {
      await pool.query(
        `ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS numero_whatsApp VARCHAR(50) NULL DEFAULT NULL`
      ).catch(() => {});
    }

    for (const u of usuarios) {
      if (!u.instancia) {
        u.status = 'SEM INSTÂNCIA';
        delete u.chave;
        continue;
      }

      if (!cfg) {
        // API não configurada — mantém status do banco
        delete u.chave;
        continue;
      }

      try {
        // Sempre consulta connectionState diretamente pelo nome da instância no banco
        const r     = await apiRequest(cfg.url, `/instance/connectionState/${u.instancia}`, 'GET', cfg.apikey);
        const state = r.body?.instance?.state || r.body?.state;
        u.status    = state === 'open' ? 'CONECTADO' : (state || 'DESCONECTADO');

        const owner = r.body?.instance?.owner || r.body?.owner || null;
        if (owner) u.numero_whatsApp = owner;

        // Tenta enriquecer chave do mapa de fetchInstances se ainda não está no banco
        const apiInst  = mapaNome[u.instancia.toLowerCase()];
        const novaChave  = !u.chave && apiInst?.apikey ? apiInst.apikey : null;
        const novoNumero = !u.numero_whatsApp && owner ? owner : null;

        if (novaChave || novoNumero) {
          const updates = [];
          const vals    = [];
          if (novaChave)  { updates.push('chave=?');           vals.push(novaChave); }
          if (novoNumero) { updates.push('numero_whatsApp=?'); vals.push(novoNumero); u.numero_whatsApp = novoNumero; }
          vals.push(u.idusuario);
          pool.query(`UPDATE usuarios SET ${updates.join(', ')} WHERE idusuario=?`, vals).catch(() => {});
        }
      } catch {
        // Se connectionState falhar, instância provavelmente foi deletada da API
        u.status = 'DESCONECTADO';
      }

      delete u.chave;
    }

    res.json({ usuarios });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/whatsapp/criar-instancia
// Cria instância na Evolution API e grava no usuário
// Body: { usuarioId, instanceName }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/criar-instancia', async (req, res) => {
  try {
    const { usuarioId, instanceName } = req.body;
    if (!usuarioId || !instanceName) {
      return res.status(400).json({ error: 'usuarioId e instanceName obrigatórios' });
    }

    const cfg  = await getConfig();
    const pool = getPool();

    // Verifica se instância já existe; se sim, deleta antes
    const [rows] = await pool.query('SELECT instancia FROM usuarios WHERE idusuario=?', [usuarioId]);
    if (rows[0]?.instancia) {
      await apiRequest(cfg.url, `/instance/delete/${rows[0].instancia}`, 'DELETE', cfg.apikey)
        .catch(() => {});
    }

    // Cria a nova instância com qrcode: true
    const r = await apiRequest(cfg.url, '/instance/create', 'POST', cfg.apikey, {
      instanceName,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS'
    });

    if (r.status !== 200 && r.status !== 201) {
      return res.status(500).json({ error: `Erro ao criar instância: ${JSON.stringify(r.body)}` });
    }

    // Evolution API v2 pode retornar a chave em campos diferentes
    const instKey   = r.body?.hash?.apikey || r.body?.apikey || r.body?.instance?.apikey || null;
    const qrBase64  = r.body?.qrcode?.base64 || null;
    const qrCode    = r.body?.qrcode?.code   || null;

    // Salva instância e chave no banco
    await pool.query(
      `UPDATE usuarios SET instancia=?, chave=?, status='AGUARDANDO', data_conexao=NULL WHERE idusuario=?`,
      [instanceName, instKey, usuarioId]
    ).catch(() => {});

    res.json({ ok: true, instanceName, qrcode: qrBase64, code: qrCode });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/whatsapp/qr/:instanceName
// Busca/renova QR Code de uma instância existente
// ─────────────────────────────────────────────────────────────────────────────
router.get('/qr/:instanceName', async (req, res) => {
  try {
    const cfg = await getConfig();
    const r   = await apiRequest(cfg.url, `/instance/connect/${req.params.instanceName}`, 'GET', cfg.apikey);

    if (r.status !== 200 && r.status !== 201) {
      return res.status(500).json({ error: `Erro ${r.status}: ${JSON.stringify(r.body)}` });
    }

    res.json({
      qrcode: r.body?.base64 || null,
      code:   r.body?.code   || null
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/whatsapp/status
// Verifica estado de conexão do usuário logado (usado na topbar/home)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/status', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      'SELECT instancia FROM usuarios WHERE idusuario=? AND excluido=\'N\'', 
      [req.user.id]
    );
    const instancia = rows[0]?.instancia;
    
    if (!instancia) {
      return res.json({ conectado: false, status: 'SEM INSTÂNCIA' });
    }

    const cfg = await getConfig();
    const r   = await apiRequest(cfg.url, `/instance/connectionState/${instancia}`, 'GET', cfg.apikey);
    const state = r.body?.instance?.state || r.body?.state || 'unknown';
    
    res.json({ 
      conectado: state === 'open', 
      status: state === 'open' ? 'open' : state,
      instancia 
    });
  } catch (err) {
    res.json({ conectado: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/whatsapp/status/:instanceName
// Verifica estado de conexão de uma instância específica
// ─────────────────────────────────────────────────────────────────────────────
router.get('/status/:instanceName', async (req, res) => {
  try {
    const cfg   = await getConfig();
    const r     = await apiRequest(cfg.url, `/instance/connectionState/${req.params.instanceName}`, 'GET', cfg.apikey);
    const state = r.body?.instance?.state || r.body?.state || 'unknown';
    const owner = r.body?.instance?.owner || r.body?.owner || null;
    res.json({ state, conectado: state === 'open', owner });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/whatsapp/confirmar-conexao/:usuarioId
// Chamado quando status = open; atualiza DB com data/status
// ─────────────────────────────────────────────────────────────────────────────
router.post('/confirmar-conexao/:usuarioId', async (req, res) => {
  try {
    const pool = getPool();
    const { numero } = req.body;   // número do dono da instância (owner), opcional

    // Garante que coluna existe
    await pool.query(
      `ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS numero_whatsApp VARCHAR(50) NULL DEFAULT NULL`
    ).catch(() => {});

    if (numero) {
      await pool.query(
        `UPDATE usuarios SET status='CONECTADO', data_conexao=NOW(), numero_whatsApp=? WHERE idusuario=?`,
        [numero, req.params.usuarioId]
      ).catch(() => {});
    } else {
      await pool.query(
        `UPDATE usuarios SET status='CONECTADO', data_conexao=NOW() WHERE idusuario=?`,
        [req.params.usuarioId]
      ).catch(() => {});
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/whatsapp/deletar/:usuarioId
// Faz logout + deleta instância da API e limpa o banco
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/deletar/:usuarioId', async (req, res) => {
  try {
    const pool   = getPool();
    const [rows] = await pool.query('SELECT instancia FROM usuarios WHERE idusuario=?', [req.params.usuarioId]);
    const instancia = rows[0]?.instancia;

    if (instancia) {
      let cfg = null;
      try { cfg = await getConfig(); } catch {}
      if (cfg) {
        await apiRequest(cfg.url, `/instance/logout/${instancia}`,  'DELETE', cfg.apikey).catch(() => {});
        await apiRequest(cfg.url, `/instance/delete/${instancia}`, 'DELETE', cfg.apikey).catch(() => {});
      }
    }

    await pool.query(
      `UPDATE usuarios SET instancia=NULL, chave=NULL, status=NULL, data_conexao=NULL WHERE idusuario=?`,
      [req.params.usuarioId]
    ).catch(() => {});

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/whatsapp/enviar-teste
// Envia mensagem de teste via instância do usuário
// Body: { usuarioId, numero, mensagem }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/enviar-teste', async (req, res) => {
  try {
    const { usuarioId, numero, mensagem } = req.body;
    if (!usuarioId || !numero || !mensagem) {
      return res.status(400).json({ error: 'usuarioId, numero e mensagem obrigatórios' });
    }

    const cfg  = await getConfig();
    const pool = getPool();

    const [rows] = await pool.query(
      'SELECT instancia FROM usuarios WHERE idusuario=? AND excluido=\'N\' LIMIT 1',
      [usuarioId]
    );
    const instancia = rows[0]?.instancia;
    if (!instancia) return res.status(400).json({ error: 'Usuário sem instância configurada' });

    // Normaliza número: remove tudo que não for dígito
    const numeroLimpo = numero.replace(/\D/g, '');

    const r = await apiRequest(
      cfg.url,
      `/message/sendText/${instancia}`,
      'POST',
      cfg.apikey,
      { number: numeroLimpo, text: mensagem }
    );

    if (r.status === 200 || r.status === 201) {
      res.json({ ok: true });
    } else {
      res.status(500).json({ error: `Erro ${r.status}: ${JSON.stringify(r.body)}` });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
