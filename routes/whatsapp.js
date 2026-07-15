const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const { getPool } = require('../config/database');
const { logError } = require('../config/logger');
const {
  euatendoAtivo, enviarTextoEuAtendo, enviarMediaEuAtendo, EUATENDO_URL_PADRAO,
} = require('../config/euatendo');

// ─── helper: faz request HTTP/HTTPS para a Evolution API (via axios) ─────────
async function apiRequest(baseUrl, path, method = 'GET', apikey, body = null, timeoutMs = 15000) {
  const url = (baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl) + path;
  try {
    const resp = await axios({
      method,
      url,
      headers: { 'Content-Type': 'application/json', apikey },
      data: body || undefined,
      timeout: timeoutMs
    });
    return { status: resp.status, body: resp.data };
  } catch (err) {
    if (err.response) {
      // A API respondeu com status de erro (4xx/5xx) — não lançamos, retornamos
      return { status: err.response.status, body: err.response.data };
    }
    if (err.code === 'ECONNABORTED' || err.message.includes('timeout')) {
      throw new Error(`Timeout na API (${timeoutMs/1000}s) — verifique se a URL está correta e a API está no ar`);
    }
    throw err;
  }
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

// ─── pega chave por instância (fallback: GlobalAPI) ──────────────────────────
// O Delphi usa ChaveApi (por instância) para ObterQrCode e chamadas de instância.
// Aqui buscamos a chave salva no banco, com fallback para GlobalAPI.
async function getInstKey(pool, cfg, instancia) {
  try {
    const [rows] = await pool.query(
      `SELECT chave FROM usuarios WHERE instancia=? AND excluido='N' LIMIT 1`, [instancia]
    );
    return rows[0]?.chave || cfg.apikey;
  } catch {
    return cfg.apikey;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/whatsapp/testar-api
// Testa a conexão com a Evolution API (lista instâncias)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/testar-api', async (req, res) => {
  const { url, apikey } = req.body;
  if (!url || !apikey) return res.status(400).json({ error: 'url e apikey obrigatórios' });
  try {
    const r = await apiRequest(url, '/instance/fetchInstances', 'GET', apikey, null, 20000);
    if (r.status === 200 || r.status === 201) {
      const lista = Array.isArray(r.body) ? r.body : (r.body?.instances || []);
      res.json({ ok: true, instancias: lista.length, url });
    } else {
      res.json({ ok: false, error: `Erro ${r.status}: ${JSON.stringify(r.body)}`, url });
    }
  } catch (err) {
    const msg = err.message.includes('timeout') || err.message.includes('Timeout')
      ? `Sem resposta da API — verifique se a URL está correta e o servidor está no ar`
      : err.message;
    res.json({ ok: false, error: msg, url });
  }
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
        `ALTER TABLE usuarios ADD COLUMN numero_whatsApp VARCHAR(50) NULL DEFAULT NULL`
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
  } catch (err) { logError(`${req.method} ${req.path}`, err); res.status(500).json({ error: err.message }); }
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
    }, 45000);

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
  } catch (err) { logError(`${req.method} ${req.path}`, err); res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/whatsapp/qr/:instanceName
// Busca/renova QR Code de uma instância existente
// ─────────────────────────────────────────────────────────────────────────────
router.get('/qr/:instanceName', async (req, res) => {
  try {
    const cfg     = await getConfig();
    const pool    = getPool();
    const instKey = await getInstKey(pool, cfg, req.params.instanceName);
    const r       = await apiRequest(cfg.url, `/instance/connect/${req.params.instanceName}`, 'GET', instKey, null, 30000);

    if (r.status !== 200 && r.status !== 201) {
      return res.status(500).json({ error: `Erro ${r.status}: ${JSON.stringify(r.body)}` });
    }

    res.json({
      qrcode: r.body?.base64 || null,
      code:   r.body?.code   || null
    });
  } catch (err) { logError(`${req.method} ${req.path}`, err); res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/whatsapp/status
// Verifica estado de conexão do usuário logado (usado na topbar/home)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/status', async (req, res) => {
  try {
    const pool = getPool();

    // EuAtendo ativo → sempre pronto (plataforma hospedada, sem instância/QR)
    const ea = await euatendoAtivo(pool).catch(() => null);
    if (ea) {
      return res.json({ conectado: true, status: 'open', provedor: 'EUATENDO' });
    }

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
    const cfg     = await getConfig();
    const pool    = getPool();
    const instKey = await getInstKey(pool, cfg, req.params.instanceName);
    const r       = await apiRequest(cfg.url, `/instance/connectionState/${req.params.instanceName}`, 'GET', instKey);
    const state   = r.body?.instance?.state || r.body?.state || 'unknown';
    const owner   = r.body?.instance?.owner || r.body?.owner || null;
    res.json({ state, conectado: state === 'open', owner });
  } catch (err) { logError(`${req.method} ${req.path}`, err); res.status(500).json({ error: err.message }); }
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
      `ALTER TABLE usuarios ADD COLUMN numero_whatsApp VARCHAR(50) NULL DEFAULT NULL`
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
  } catch (err) { logError(`${req.method} ${req.path}`, err); res.status(500).json({ error: err.message }); }
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
  } catch (err) { logError(`${req.method} ${req.path}`, err); res.status(500).json({ error: err.message }); }
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

    const pool = getPool();

    // EuAtendo ativo → envia pela plataforma (não depende de instância do usuário)
    const ea = await euatendoAtivo(pool).catch(() => null);
    if (ea) {
      await enviarTextoEuAtendo(ea, numero, mensagem);
      return res.json({ ok: true, provedor: 'EUATENDO' });
    }

    const cfg  = await getConfig();

    const [rows] = await pool.query(
      'SELECT instancia, chave FROM usuarios WHERE idusuario=? AND excluido=\'N\' LIMIT 1',
      [usuarioId]
    );
    const instancia = rows[0]?.instancia;
    if (!instancia) return res.status(400).json({ error: 'Usuário sem instância configurada' });

    const instKey = rows[0]?.chave || cfg.apikey;

    // Normaliza número: remove tudo que não for dígito
    const numeroLimpo = numero.replace(/\D/g, '');

    const r = await apiRequest(
      cfg.url,
      `/message/sendText/${instancia}`,
      'POST',
      instKey,
      { number: numeroLimpo, text: mensagem }
    );

    if (r.status === 200 || r.status === 201) {
      res.json({ ok: true });
    } else {
      res.status(500).json({ error: `Erro ${r.status}: ${JSON.stringify(r.body)}` });
    }
  } catch (err) { logError(`${req.method} ${req.path}`, err); res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/whatsapp/qrcode
// Chamado pelo home.html ao clicar no botão WhatsApp da topbar.
// Usa a instância do usuário logado; se não tiver, tenta criar automaticamente.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/qrcode', async (req, res) => {
  try {
    const cfg  = await getConfig();
    const pool = getPool();

    const [[user]] = await pool.query(
      `SELECT idusuario, loginusu, instancia FROM usuarios WHERE idusuario=? AND excluido='N'`,
      [req.user.id]
    );
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

    let instancia = user.instancia;

    // Se não tem instância, cria automaticamente
    if (!instancia) {
      instancia = `rep_${user.loginusu}`.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase().slice(0, 50);

      const rc = await apiRequest(cfg.url, '/instance/create', 'POST', cfg.apikey, {
        instanceName: instancia, qrcode: true, integration: 'WHATSAPP-BAILEYS'
      }, 45000);
      const instKey = rc.body?.hash?.apikey || rc.body?.apikey || null;
      await pool.query(
        `UPDATE usuarios SET instancia=?, chave=?, status='AGUARDANDO', data_conexao=NULL WHERE idusuario=?`,
        [instancia, instKey, user.idusuario]
      ).catch(() => {});

      if (rc.body?.qrcode?.base64) {
        return res.json({ qrcode: rc.body.qrcode.base64 });
      }
    }

    // Busca QR atual da instância (usa chave por instância se disponível)
    const [[uRow]] = await pool.query(
      `SELECT chave FROM usuarios WHERE idusuario=? AND excluido='N'`, [req.user.id]
    );
    const instKey = uRow?.chave || cfg.apikey;
    const r = await apiRequest(cfg.url, `/instance/connect/${instancia}`, 'GET', instKey, null, 30000);
    res.json({ qrcode: r.body?.base64 || null });
  } catch (err) {
    res.json({ qrcode: null, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET  /api/whatsapp/config-global  — lê config da Evolution API
// POST /api/whatsapp/config-global  — salva config da Evolution API (sem senha admin)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/config-global', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS configuracao (
        id              INT(11)      NOT NULL AUTO_INCREMENT,
        w_apiglobal     VARCHAR(250) NULL DEFAULT NULL,
        w_urlplataforma VARCHAR(250) NULL DEFAULT NULL,
        excluido        VARCHAR(1)   NULL DEFAULT 'N',
        empresa_liberada VARCHAR(50) NULL DEFAULT NULL,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8;
    `).catch(() => {});

    const [rows] = await pool.query(
      `SELECT w_apiglobal, w_urlplataforma, empresa_liberada
       FROM configuracao WHERE excluido='N' ORDER BY id DESC LIMIT 1`
    );
    res.json(rows[0] || {});
  } catch (err) { logError(`${req.method} ${req.path}`, err); res.status(500).json({ error: err.message }); }
});

router.post('/config-global', async (req, res) => {
  try {
    const pool = getPool();
    const { w_apiglobal, w_urlplataforma, empresa_liberada } = req.body;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS configuracao (
        id              INT(11)      NOT NULL AUTO_INCREMENT,
        w_apiglobal     VARCHAR(250) NULL DEFAULT NULL,
        w_urlplataforma VARCHAR(250) NULL DEFAULT NULL,
        excluido        VARCHAR(1)   NULL DEFAULT 'N',
        empresa_liberada VARCHAR(50) NULL DEFAULT NULL,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8;
    `).catch(() => {});

    const url = w_urlplataforma ? w_urlplataforma.replace(/\/$/, '') : null;
    const [existing] = await pool.query(
      `SELECT id FROM configuracao WHERE excluido='N' ORDER BY id DESC LIMIT 1`
    );

    if (existing[0]) {
      await pool.query(
        `UPDATE configuracao SET w_apiglobal=?, w_urlplataforma=?, empresa_liberada=? WHERE id=?`,
        [w_apiglobal||null, url, empresa_liberada||null, existing[0].id]
      );
    } else {
      await pool.query(
        `INSERT INTO configuracao (w_apiglobal, w_urlplataforma, empresa_liberada) VALUES (?, ?, ?)`,
        [w_apiglobal||null, url, empresa_liberada||null]
      );
    }
    res.json({ ok: true });
  } catch (err) { logError(`${req.method} ${req.path}`, err); res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/whatsapp/qr-usuario/:usuarioId
// Cria instância se não existir e retorna QR code
// ─────────────────────────────────────────────────────────────────────────────
router.get('/qr-usuario/:usuarioId', async (req, res) => {
  try {
    const cfg  = await getConfig();
    const pool = getPool();
    const { usuarioId } = req.params;

    const [[user]] = await pool.query(
      `SELECT idusuario, loginusu, instancia FROM usuarios WHERE idusuario=? AND excluido='N'`,
      [usuarioId]
    );
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

    let instancia = user.instancia;

    if (!instancia) {
      // Gera nome de instância a partir do login
      instancia = `rep_${user.loginusu}`.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase().slice(0, 50);

      const r = await apiRequest(cfg.url, '/instance/create', 'POST', cfg.apikey, {
        instanceName: instancia, qrcode: true, integration: 'WHATSAPP-BAILEYS'
      });
      if (r.status !== 200 && r.status !== 201) {
        return res.status(500).json({ error: `Erro ao criar instância: ${JSON.stringify(r.body)}` });
      }
      const instKey  = r.body?.hash?.apikey || r.body?.apikey || null;
      const qrBase64 = r.body?.qrcode?.base64 || null;

      await pool.query(
        `UPDATE usuarios SET instancia=?, chave=?, status='AGUARDANDO', data_conexao=NULL WHERE idusuario=?`,
        [instancia, instKey, usuarioId]
      ).catch(() => {});

      return res.json({ ok: true, instancia, qrcode: qrBase64 });
    }

    // Instância já existe — pega QR de conexão usando chave por instância
    const [[uRow]] = await pool.query(
      `SELECT chave FROM usuarios WHERE idusuario=? AND excluido='N'`, [usuarioId]
    );
    const connKey = uRow?.chave || cfg.apikey;
    const r = await apiRequest(cfg.url, `/instance/connect/${instancia}`, 'GET', connKey, null, 30000);
    res.json({ instancia, qrcode: r.body?.base64 || null, code: r.body?.code || null });
  } catch (err) { logError(`${req.method} ${req.path}`, err); res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/whatsapp/verificar-usuario/:usuarioId
// Verifica estado de conexão e confirma no banco se conectado
// Body: { instancia }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/verificar-usuario/:usuarioId', async (req, res) => {
  try {
    const cfg  = await getConfig();
    const pool = getPool();
    const { instancia } = req.body;
    if (!instancia) return res.status(400).json({ error: 'instancia obrigatória' });

    const instKey = await getInstKey(pool, cfg, instancia);
    const r       = await apiRequest(cfg.url, `/instance/connectionState/${instancia}`, 'GET', instKey);
    const state = r.body?.instance?.state || r.body?.state || 'unknown';
    const owner = r.body?.instance?.owner || r.body?.owner || null;
    const conectado = state === 'open';

    if (conectado) {
      await pool.query(
        `ALTER TABLE usuarios ADD COLUMN numero_whatsApp VARCHAR(50) NULL DEFAULT NULL`
      ).catch(() => {});

      const sets = ['status=\'CONECTADO\'', 'data_conexao=NOW()'];
      const vals = [];
      if (owner) { sets.push('numero_whatsApp=?'); vals.push(owner); }
      vals.push(req.params.usuarioId);
      await pool.query(`UPDATE usuarios SET ${sets.join(', ')} WHERE idusuario=?`, vals).catch(() => {});
    }

    res.json({ conectado, status: state, owner });
  } catch (err) { logError(`${req.method} ${req.path}`, err); res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/whatsapp/desconectar-usuario/:usuarioId
// Faz logout da instância sem deletá-la
// ─────────────────────────────────────────────────────────────────────────────
router.post('/desconectar-usuario/:usuarioId', async (req, res) => {
  try {
    const pool = getPool();
    const [[user]] = await pool.query(
      `SELECT instancia FROM usuarios WHERE idusuario=?`, [req.params.usuarioId]
    );
    const instancia = user?.instancia;

    if (instancia) {
      let cfg = null;
      try { cfg = await getConfig(); } catch {}
      if (cfg) {
        const instKey = await getInstKey(pool, cfg, instancia);
        await apiRequest(cfg.url, `/instance/logout/${instancia}`, 'DELETE', instKey).catch(() => {});
      }
    }

    await pool.query(
      `UPDATE usuarios SET status='DESCONECTADO', data_conexao=NULL WHERE idusuario=?`,
      [req.params.usuarioId]
    ).catch(() => {});

    res.json({ ok: true });
  } catch (err) { logError(`${req.method} ${req.path}`, err); res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/whatsapp/testar-euatendo
// Testa a API do EuAtendo enviando uma mensagem real para o número informado
// Body: { url?, token?, numero, mensagem? }  (sem url/token usa o que está salvo)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/testar-euatendo', async (req, res) => {
  try {
    const { url, token, numero, mensagem } = req.body;
    if (!numero) return res.status(400).json({ error: 'Informe o número de destino do teste' });

    let cfg;
    if (token) {
      cfg = { url: (url || EUATENDO_URL_PADRAO).replace(/\/$/, ''), token };
    } else {
      const { getEuAtendoConfig } = require('../config/euatendo');
      cfg = await getEuAtendoConfig(getPool());
      if (url) cfg.url = String(url).replace(/\/$/, '');
      if (!cfg.token) return res.status(400).json({ error: 'Token do EuAtendo não configurado — informe o token ou salve a configuração primeiro' });
    }

    const r = await enviarTextoEuAtendo(cfg, numero,
      mensagem || 'Teste de integração SysRepWeb ↔ EuAtendo ✅');

    // Teste OK = conexão liberada — registra para exibir o selo "ApiChat liberado"
    const validadoEm = new Date();
    await getPool().query(
      `UPDATE configuracao SET euatendo_validado_em=NOW()
       WHERE excluido='N' ORDER BY id DESC LIMIT 1`
    ).catch(() => {});

    res.json({ ok: true, status: r.status, validado_em: validadoEm.toISOString() });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/whatsapp/enviar
// Envio genérico de texto (+ anexo opcional) para um cliente — roteia pelo
// provedor configurado.
// Body: { numero, mensagem, cod_cliente?, id_pedido?,
//         anexo_base64?, anexo_nome?, anexo_tipo? }
//   EuAtendo:  endpoint único com Bearer token
//   Evolution: instância do usuário logado
// Com cod_cliente informado, o envio (ou a falha) entra no histórico do cliente.
// Limite de anexo: 10MB — base64 adiciona ~33%, o body parser aceita até 20MB.
// ─────────────────────────────────────────────────────────────────────────────
const ANEXO_MAX_BYTES = 10 * 1024 * 1024;

router.post('/enviar', async (req, res) => {
  const {
    numero, mensagem, cod_cliente, id_pedido,
    anexo_base64, anexo_nome, anexo_tipo,
  } = req.body || {};
  const pool = getPool();
  const { registrarMensagemCliente } = require('../config/cliente-mensagens');
  const logEnvio = (extra) => registrarMensagemCliente(pool, {
    cod_cliente: parseInt(cod_cliente, 10) || null,
    id_pedido:   parseInt(id_pedido, 10) || null,
    id_usuario:  req.user?.id || null,
    canal:       'WHATSAPP',
    destino:     numero,
    mensagem,
    anexo:       anexo_base64 ? (anexo_nome || 'anexo') : null,
    ...extra,
  });

  try {
    if (!numero || (!mensagem && !anexo_base64)) {
      return res.status(400).json({ error: 'numero e mensagem (ou anexo) obrigatórios' });
    }

    let anexoBuffer = null;
    if (anexo_base64) {
      anexoBuffer = Buffer.from(String(anexo_base64).replace(/^data:[^,]+,/, ''), 'base64');
      if (anexoBuffer.length > ANEXO_MAX_BYTES) {
        return res.status(400).json({ error: 'Anexo maior que 10MB' });
      }
    }

    const ea = await euatendoAtivo(pool).catch(() => null);
    if (ea) {
      if (anexoBuffer) {
        await enviarMediaEuAtendo(ea, numero, {
          buffer: anexoBuffer,
          filename: anexo_nome || 'anexo',
          mimetype: anexo_tipo || 'application/octet-stream',
          caption: mensagem || '',
        });
      } else {
        await enviarTextoEuAtendo(ea, numero, mensagem);
      }
      void logEnvio({ provedor: 'EUATENDO' });
      return res.json({ ok: true, provedor: 'EUATENDO' });
    }

    // Evolution: usa a instância do usuário logado
    const cfg = await getConfig();
    const [rows] = await pool.query(
      'SELECT instancia, chave FROM usuarios WHERE idusuario=? AND excluido=\'N\' LIMIT 1',
      [req.user.id]
    );
    const instancia = rows[0]?.instancia;
    if (!instancia) return res.status(400).json({ error: 'Usuário sem instância WhatsApp configurada' });

    const instKey     = rows[0]?.chave || cfg.apikey;
    const numeroLimpo = String(numero).replace(/\D/g, '');

    let r;
    if (anexoBuffer) {
      const mediatype = /^image\//.test(anexo_tipo || '') ? 'image' : 'document';
      r = await apiRequest(cfg.url, `/message/sendMedia/${instancia}`, 'POST', instKey, {
        number:    numeroLimpo,
        mediatype,
        mimetype:  anexo_tipo || 'application/octet-stream',
        caption:   mensagem || '',
        media:     anexoBuffer.toString('base64'),
        fileName:  anexo_nome || 'anexo',
      });
    } else {
      r = await apiRequest(cfg.url, `/message/sendText/${instancia}`, 'POST', instKey,
        { number: numeroLimpo, text: mensagem });
    }

    if (r.status === 200 || r.status === 201) {
      void logEnvio({ provedor: 'EVOLUTION' });
      res.json({ ok: true, provedor: 'EVOLUTION' });
    } else {
      const erro = `Erro ${r.status}: ${JSON.stringify(r.body)}`;
      void logEnvio({ provedor: 'EVOLUTION', status: 'FALHOU', erro });
      res.status(500).json({ error: erro });
    }
  } catch (err) {
    void logEnvio({ status: 'FALHOU', erro: err.message });
    logError(`${req.method} ${req.path}`, err); res.status(500).json({ error: err.message });
  }
});

module.exports = router;
