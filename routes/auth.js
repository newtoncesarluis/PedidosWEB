const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { getPool, getBoundChave, customerDbFromLicense, getPoolForLicense, runWithPool, createPool,
  createPoolFromLicenseBinding, readLicenseBinding, getGlobalPool } = require('../config/database');
const LicenseCache = require('../services/license-cache');
const { extractMysqlConfigFromLicenseRow } = require('../config/customer-db-from-license');
const parametroLocaisRouter = require('./parametro-locais');
const { resolveEmpresaLogoRelatorio, sanitizeEmpresaRow, fsPathFromLogoRelatorio } = require('../services/empresa-logo');
const { buildGtelaFromPerfil, PERFIL_SN_CADASTRO } = require('../config/cadastros-permissoes');
const { sqlPerfilOverlayAliases, overlayPerfilPermissoes } = require('../config/permissoes-usuario-perfil');
const { ensurePerfilCadastroColumns } = require('../config/schema-migrations');

const EMPRESA_NAO_EXCLUIDA = `COALESCE(NULLIF(TRIM(excluido), ''), 'N') = 'N'`;
const E_EMPRESA_NAO_EXCLUIDA = `COALESCE(NULLIF(TRIM(e.excluido), ''), 'N') = 'N'`;

let _empresaLogoColAuth = false;
async function ensureEmpresaLogoColumnAuth(pool) {
  if (_empresaLogoColAuth) return;
  await pool.query(
    `ALTER TABLE empresa ADD COLUMN logo_relatorio VARCHAR(512) NULL DEFAULT NULL`
  ).catch(() => {});
  await pool.query(
    `ALTER TABLE empresa ADD COLUMN logo_tamanho_relatorio VARCHAR(1) NULL DEFAULT 'M'`
  ).catch(() => {});
  _empresaLogoColAuth = true;
}

/** URL absoluta da logo para o navegador (login), mesmo host da API. */
function publicAssetUrl(req, relPath) {
  if (!relPath || typeof relPath !== 'string') return null;
  const p = relPath.trim();
  if (!p) return null;
  if (/^https?:\/\//i.test(p)) return p;
  const host = req.get('x-forwarded-host') || req.get('host') || '';
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
  const pathOnly = p.startsWith('/') ? p : `/${p}`;
  return `${proto}://${host}${pathOnly}`;
}

/** Sessão curta pós empresas-usuario: só permite baixar logo das empresas do usuário (evita enumeração por id). */
const LOGO_SESSION_TTL_MS = 15 * 60 * 1000;
const LOGO_SESSION_MAX = 500;
const logoSessionStore = new Map();

function pruneLogoSessions() {
  const now = Date.now();
  for (const [k, v] of logoSessionStore) {
    if (v.exp < now) logoSessionStore.delete(k);
  }
  while (logoSessionStore.size > LOGO_SESSION_MAX) {
    const first = logoSessionStore.keys().next().value;
    logoSessionStore.delete(first);
  }
}

function createLogoSession(empresaIds) {
  pruneLogoSessions();
  const key = crypto.randomBytes(24).toString('base64url');
  const ids = new Set(
    (empresaIds || []).map((x) => parseInt(x, 10)).filter((n) => n > 0)
  );
  logoSessionStore.set(key, {
    ids,
    exp: Date.now() + LOGO_SESSION_TTL_MS,
    allowInstalacao: true,
  });
  return key;
}

function logoSessionAllowsInstalacao(sessionKey) {
  if (!sessionKey || typeof sessionKey !== 'string' || sessionKey.length > 200) return false;
  const v = logoSessionStore.get(sessionKey);
  if (!v || v.exp < Date.now()) {
    if (v) logoSessionStore.delete(sessionKey);
    return false;
  }
  return v.allowInstalacao === true;
}

function logoSessionAllows(sessionKey, idEmpresa) {
  if (!sessionKey || typeof sessionKey !== 'string' || sessionKey.length > 200) return false;
  const v = logoSessionStore.get(sessionKey);
  if (!v || v.exp < Date.now()) {
    if (v) logoSessionStore.delete(sessionKey);
    return false;
  }
  const id = parseInt(idEmpresa, 10);
  return id > 0 && v.ids.has(id);
}

/**
 * GET /api/auth/empresa/:id/brand-logo?ls=...
 * Logo da empresa para a tela de login. Exige ls (token devolvido em empresas-usuario).
 */
router.get('/empresa/:id/brand-logo', async (req, res) => {
  try {
    const pool = getPool();
    await ensureEmpresaLogoColumnAuth(pool);
    const id = parseInt(req.params.id, 10);
    if (!id || id < 1) return res.status(404).end();
    const ls = req.query.ls;
    if (!logoSessionAllows(ls, id)) return res.status(403).end();

    const [[row]] = await pool.query(
      `SELECT logo_relatorio FROM empresa WHERE id_empresa = ? AND ${EMPRESA_NAO_EXCLUIDA} LIMIT 1`,
      [id]
    );
    const relRaw = row && row.logo_relatorio ? String(row.logo_relatorio).trim() : '';
    const rel = resolveEmpresaLogoRelatorio(id, relRaw) || '';
    const m = rel.match(/^\/uploads\/empresas\/(\d+)\/([^/]+)$/);
    if (!m || String(m[1]) !== String(id)) return res.status(404).end();

    let fileName = m[2];
    if (!fileName || fileName.includes('..') || /[\\/]/.test(fileName)) return res.status(404).end();

    const abs = fsPathFromLogoRelatorio(rel);
    if (!abs || !fs.existsSync(abs)) return res.status(404).end();

    const ext = path.extname(abs).toLowerCase();
    const types = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
    };
    res.type(types[ext] || 'application/octet-stream');
    res.set('Cache-Control', 'private, max-age=120');
    res.sendFile(abs);
  } catch (err) {
    console.error('brand-logo:', err.message);
    res.status(500).end();
  }
});

/**
 * GET /api/auth/instalacao-brand-logo?ls=...
 * Logo padrão da instalação (parametro_locais). Mesmo token de empresas-usuario.
 */
router.get('/instalacao-brand-logo', async (req, res) => {
  try {
    const pool = getPool();
    const ls = req.query.ls;
    if (!logoSessionAllowsInstalacao(ls)) return res.status(403).end();

    await parametroLocaisRouter.ensureParametroLocaisTable(pool);
    const [[row]] = await pool.query(
      `SELECT logo_relatorio FROM parametro_locais WHERE id = 1 AND COALESCE(excluido,'N') = 'N' LIMIT 1`
    );
    const rel = row && row.logo_relatorio ? String(row.logo_relatorio).trim() : '';
    const m = rel.match(/^\/uploads\/parametro_locais\/([^/]+)$/);
    if (!m) return res.status(404).end();

    const fileName = m[1];
    if (!fileName || fileName.includes('..') || /[\\/]/.test(fileName)) return res.status(404).end();

    const abs = path.resolve(path.join(__dirname, '..', 'public', 'uploads', 'parametro_locais', fileName));
    const publicRoot = path.resolve(path.join(process.cwd(), 'public'));
    if (!abs.startsWith(publicRoot + path.sep)) return res.status(404).end();
    if (!fs.existsSync(abs)) return res.status(404).end();

    const ext = path.extname(abs).toLowerCase();
    const types = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
    };
    res.type(types[ext] || 'application/octet-stream');
    res.set('Cache-Control', 'private, max-age=120');
    res.sendFile(abs);
  } catch (err) {
    console.error('instalacao-brand-logo:', err.message);
    res.status(500).end();
  }
});

// POST /api/auth/login
// Lógica baseada no Delphi: SELECT p.*, s.* FROM usuarios s INNER JOIN perfil p ON p.id = s.idperfil
// WHERE s.SITUACAO = 'ATIVO' AND s.excluido = 'N' AND s.loginusu = ? AND s.senhausu = ?
router.post('/login', async (req, res) => {
  const { loginusu, senhausu, id_empresa } = req.body;
  // Em modo bound: chave vem do processo (.env). Em legado: vem do body/localStorage.
  // Fallback: license-binding.json (instalações locais com CUSTOMER_DB_FROM_LICENSE=1 mas sem CHAVE_LICENCA no env)
  const chave_licenca = getBoundChave() || req.body.chave_licenca || readLicenseBinding()?.chave_licenca || null;

  if (!loginusu || !senhausu) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
  }

  const handler = async () => {
  try {
    const pool = getPool();

    const perfilOverlay = sqlPerfilOverlayAliases('p');
    const [rows] = await pool.query(
      `SELECT p.*, s.*${perfilOverlay ? `, ${perfilOverlay}` : ''}
       FROM usuarios s
       INNER JOIN perfil p ON p.id = s.idperfil
       WHERE UPPER(s.loginusu) = UPPER(?)
         AND s.situacao = 'ATIVO'
         AND s.excluido = 'N'
       LIMIT 1`,
      [loginusu]
    );

    const user = overlayPerfilPermissoes(rows[0]);

    if (!user) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos' });
    }

    // Validação de senha case-insensitive (igual ao Delphi: UpperCase = UpperCase)
    // trim() necessário: MySQL PADSPACE ignora espaços finais mas JS não
    if (user.senhausu.trim().toUpperCase() !== senhausu.trim().toUpperCase()) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos' });
    }

    // Verifica mensalidade antes de liberar acesso
    const licCheck = await checkMensalidade(pool);
    if (licCheck.bloqueado) {
      return res.status(402).json({
        error: 'Sistema bloqueado por inadimplência',
        bloqueado: true,
        diasAtraso: licCheck.diasAtraso
      });
    }

    // Carrega permissões (igual ao PermissaoOperacao do Delphi)
    const permissoes = buildPermissoes(user);

    // Carrega dados da empresa selecionada
    let empresaData = null;
    if (id_empresa) {
      await ensureEmpresaLogoColumnAuth(pool);
      const [emp] = await pool.query(
        `SELECT e.* FROM empresa e WHERE e.id_empresa = ? AND ${E_EMPRESA_NAO_EXCLUIDA} LIMIT 1`,
        [id_empresa]
      );
      if (emp[0]) {
        const sanitized = await sanitizeEmpresaRow(pool, emp[0]);
        empresaData = {
          ...sanitized,
          logo_url: publicAssetUrl(req, sanitized.logo_relatorio),
        };
      }
    }

    // Registra acesso do terminal (InformacoesMaquina)
    const userAgent = req.headers['user-agent'] || '';
    const clientIp = req.ip || req.connection.remoteAddress;
    await registrarTerminal(pool, clientIp, userAgent, user.idusuario, id_empresa);

    // Atualiza último acesso
    await pool.query(
      `UPDATE usuarios SET dt_ultimoacesso = NOW() WHERE idusuario = ?`,
      [user.idusuario]
    ).catch(() => {}); // silencioso se campo não existir

    const tokenPayload = {
      id: user.idusuario,
      name: user.nomeusu,
      login: user.loginusu,
      perfil: user.idperfil,
      role: user.idperfil == 1 ? 'admin' : 'user',
      id_empresa: id_empresa || null,
      id_gerente: user.id_gerente || null,
      tipo_usuario: user.tipo_usuario || 'REPRESENTANTE',
      comissao_preposto_pct: parseFloat(user.comissao_preposto_pct) || 6,
      dash_avisofinanceiro: user.dash_avisofinanceiro || 'N',
      permissoes,
      chave_licenca: chave_licenca || null,
    };

    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: '8h' });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 8 * 60 * 60 * 1000
    });

    let parametros_locais = null;
    try {
      await parametroLocaisRouter.ensureParametroLocaisTable(pool);
      parametros_locais = await parametroLocaisRouter.getParametroLocais(pool);
    } catch (_) {
      parametros_locais = null;
    }

    res.json({
      ok: true,
      token,
      user: {
        id: user.idusuario,
        nome: user.nomeusu,
        login: user.loginusu,
        perfil: user.idperfil,
        role: user.idperfil == 1 ? 'admin' : 'user',
        email: user.email,
        rota_vendedor: user.rota_vendedor,
        id_gerente: user.id_gerente || null,
        acessartodosclientes: user.acessartodosclientes,
        dash_avisofinanceiro: user.dash_avisofinanceiro || 'N',
        empresapadrao: user.empresapadrao || null,
        permissoes
      },
      empresa: empresaData,
      parametros_locais,
      licenca: licCheck
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
  }; // fim handler

  // Modo bound: pool global já está criado no startup — só executa o handler
  if (getBoundChave()) return handler();

  if (customerDbFromLicense()) {
    if (!chave_licenca) {
      return res.status(400).json({ error: 'Informe sua chave de licença.' });
    }
    const chave = String(chave_licenca).trim().toUpperCase();
    let p = getPoolForLicense(chave);
    if (!p) {
      try {
        const cached = LicenseCache.read(chave);
        if (cached?.dados) {
          const cfg = extractMysqlConfigFromLicenseRow(cached.dados);
          if (cfg) p = createPool(cfg, chave);
        }
      } catch (_) {}
    }
    if (p) return runWithPool(p, handler);
    return res.status(401).json({ error: 'Licença não ativada. Reative sua chave de licença.', redirect: true });
  }
  return handler();
});

// POST /api/auth/empresas-usuario
// Valida credenciais e retorna empresas do usuário (EmpresasUsuarios do Delphi)
// Chamado ao sair do campo senha — antes do botão Entrar
router.post('/empresas-usuario', async (req, res) => {
  const { loginusu, senhausu } = req.body;
  const chave_licenca = getBoundChave() || req.body.chave_licenca || readLicenseBinding()?.chave_licenca || null;
  if (!loginusu || !senhausu) return res.json({ ok: false, empresas: [] });

  const handler = async () => {
  try {
    const pool = getPool();

    // 1. Valida credenciais básicas
    const [rows] = await pool.query(
      `SELECT s.idusuario, s.senhausu, s.empresapadrao, s.idperfil
       FROM usuarios s
       WHERE UPPER(s.loginusu) = UPPER(?)
         AND s.situacao = 'ATIVO'
         AND s.excluido = 'N'
       LIMIT 1`,
      [loginusu]
    );

    const user = rows[0];
    if (!user || user.senhausu.trim().toUpperCase() !== senhausu.trim().toUpperCase()) {
      return res.json({ ok: false, empresas: [] });
    }

    // 2. Busca mudarempresa do perfil
    const [perfRows] = await pool.query(
      `SELECT mudarempresa, alterarservidor FROM perfil WHERE id = ? LIMIT 1`,
      [user.idperfil]
    ).catch(() => [[]]);

    const perf = perfRows[0] || {};

    await ensureEmpresaLogoColumnAuth(pool);

    // 3. Carrega empresas vinculadas ao usuário (EmpresasUsuarios do Delphi)
    // id_usuario é varchar(15) na tabela, por isso converte para string
    let [empresas] = await pool.query(
      `SELECT e.id_empresa, e.Razao_empresa, e.logo_relatorio, e.logo_tamanho_relatorio
       FROM usuario_empresas t
       INNER JOIN empresa e ON e.id_empresa = t.cod_empresa
       WHERE t.excluido = 'N'
         AND t.status = 'SIM'
         AND t.id_usuario = ?
       ORDER BY e.Razao_empresa`,
      [String(user.idusuario)]
    );

    // Auto-seed: banco Delphi recém-migrado pode ter usuario_empresas vazio.
    // Se admin (idperfil=1) não tiver nenhuma empresa vinculada, vincula todas automaticamente.
    if ((!empresas || empresas.length === 0) && user.idperfil == 1) {
      const [todasEmpresas] = await pool.query(
        `SELECT id_empresa FROM empresa WHERE excluido IS NULL OR excluido = 'N' ORDER BY id_empresa`
      ).catch(() => [[]]);
      for (const emp of todasEmpresas) {
        await pool.query(
          `INSERT IGNORE INTO usuario_empresas (cod_empresa, id_usuario, status, excluido)
           VALUES (?, ?, 'SIM', 'N')`,
          [String(emp.id_empresa), String(user.idusuario)]
        ).catch(() => {});
      }
      if (todasEmpresas.length > 0) {
        [empresas] = await pool.query(
          `SELECT e.id_empresa, e.Razao_empresa, e.logo_relatorio, e.logo_tamanho_relatorio
           FROM usuario_empresas t
           INNER JOIN empresa e ON e.id_empresa = t.cod_empresa
           WHERE t.excluido = 'N' AND t.status = 'SIM' AND t.id_usuario = ?
           ORDER BY e.Razao_empresa`,
          [String(user.idusuario)]
        );
      }
    }

    const empresasOut = [];
    for (const row of empresas || []) {
      const sanitized = await sanitizeEmpresaRow(pool, row);
      empresasOut.push({
        ...sanitized,
        id_empresa: sanitized.id_empresa,
        logo_url: publicAssetUrl(req, sanitized.logo_relatorio),
      });
    }

    let parametros_locais = {
      logo_relatorio: null,
      logo_tamanho_relatorio: 'M',
      fonte_padrao: null,
    };
    try {
      await parametroLocaisRouter.ensureParametroLocaisTable(pool);
      parametros_locais = await parametroLocaisRouter.getParametroLocais(pool);
    } catch (_) {}

    const logo_session = createLogoSession((empresas || []).map((e) => e.id_empresa));

    res.json({
      ok: true,
      empresas: empresasOut,
      logo_session,
      parametros_locais,
      empresapadrao:   user.empresapadrao   || null,
      mudarempresa:    perf.mudarempresa    || 'S',
      alterarservidor: perf.alterarservidor || 'N',
      chave_licenca:   chave_licenca        || null,
    });
  } catch (err) {
    console.error('empresas-usuario error:', err.message);
    res.json({ ok: false, empresas: [], erro: err.message });
  }
  }; // fim handler

  // Modo bound: pool global já está criado no startup
  if (getBoundChave()) return handler();

  if (customerDbFromLicense()) {
    if (!chave_licenca) return res.json({ ok: false, empresas: [], erro: 'Informe sua chave de licença.' });
    const chave = String(chave_licenca).trim().toUpperCase();
    let p = getPoolForLicense(chave);
    if (!p) {
      try {
        const cached = LicenseCache.read(chave);
        if (cached?.dados) {
          const cfg = extractMysqlConfigFromLicenseRow(cached.dados);
          if (cfg) p = createPool(cfg, chave);
        }
      } catch (_) {}
    }
    if (p) return runWithPool(p, handler);
    return res.json({ ok: false, empresas: [], erro: 'Licença não ativada. Reative sua chave de licença.' });
  }
  return handler();
});

// GET /api/auth/mensalidade — verifica status da licença (VerificaMensalidade do Delphi)
router.get('/mensalidade', async (req, res) => {
  try {
    const pool = getPool();
    const result = await checkMensalidade(pool);
    res.json(result);
  } catch (err) {
    res.json({ bloqueado: false, aviso: false });
  }
});

// POST /api/auth/liberar — insere código de liberação (btnConfirmar1Click do Delphi)
router.post('/liberar', async (req, res) => {
  const { codigo_liberacao } = req.body;
  if (!codigo_liberacao) return res.status(400).json({ error: 'Código obrigatório' });

  try {
    const pool = getPool();
    const [result] = await pool.query(
      `UPDATE liberacoes SET data_pagto = CURDATE(), situacao = 'PAGO'
       WHERE codigo_liberacao = ?`,
      [codigo_liberacao]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Código não encontrado' });
    }
    res.json({ ok: true, message: 'Licença liberada com sucesso' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── LOGIN POR WHATSAPP OTP ──────────────────────────────────────────────────
// OTPs em memória: chave = número E.164, valor = { otp, idusuario, exp }
const _waOtps = new Map();
const WA_OTP_TTL = 5 * 60 * 1000; // 5 min

function _pruneWaOtps() {
  const now = Date.now();
  for (const [k, v] of _waOtps) {
    if (v.exp < now) _waOtps.delete(k);
  }
}

function _fmtWaNumber(raw) {
  // Normaliza para dígitos apenas; adiciona DDI 55 se ausente e tem 10-11 dígitos
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 11 || digits.length === 10) return '55' + digits;
  if (digits.length >= 12) return digits;
  return null;
}

// POST /api/auth/wa-otp-send  {whatsapp}
// Envia código OTP para o WhatsApp do usuário (sem revelar se existe ou não)
router.post('/wa-otp-send', async (req, res) => {
  const { whatsapp } = req.body || {};
  const numero = _fmtWaNumber(whatsapp);
  if (!numero) {
    return res.status(400).json({ ok: false, mensagem: 'Informe um número de WhatsApp válido.' });
  }
  try {
    const pool = getPool();
    const [[user]] = await pool.query(
      `SELECT idusuario, loginusu, whatsapp FROM usuarios WHERE REPLACE(REPLACE(REPLACE(whatsapp,'+',''),'(',''),')','') LIKE ? AND situacao = 'ATIVO' AND excluido = 'N' LIMIT 1`,
      ['%' + numero.slice(-9)]
    );
    // Responde ok mesmo se não encontrado — evita enumeração
    if (!user) return res.json({ ok: true });

    _pruneWaOtps();
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    _waOtps.set(numero, { otp, idusuario: user.idusuario, loginusu: user.loginusu, exp: Date.now() + WA_OTP_TTL });

    try {
      const axios = require('axios');
      const { getPool: _gp } = require('../config/database');
      const _pool = _gp();
      const [cfgRows] = await _pool.query(
        `SELECT w_urlplataforma, w_apiglobal FROM configuracao WHERE excluido='N' ORDER BY id DESC LIMIT 1`
      );
      const cfg = cfgRows[0];
      if (cfg?.w_urlplataforma && cfg?.w_apiglobal) {
        const instancia = process.env.ALERTA_WA_INSTANCIA || 'default';
        const base = cfg.w_urlplataforma.replace(/\/$/, '');
        await axios.post(
          `${base}/message/sendText/${instancia}`,
          { number: numero, text: `🔐 *PedidosWeb* — Código de acesso:\n\n*${otp}*\n\nVálido por 5 minutos. Não compartilhe este código.` },
          { headers: { apikey: cfg.w_apiglobal }, timeout: 10000 }
        );
      }
    } catch (waErr) {
      console.warn('[wa-otp-send] WhatsApp não enviado:', waErr.message);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[wa-otp-send]', err.message);
    res.status(500).json({ ok: false, mensagem: 'Erro interno.' });
  }
});

// POST /api/auth/wa-otp-verify  {whatsapp, otp, id_empresa, chave_licenca}
router.post('/wa-otp-verify', async (req, res) => {
  const { whatsapp, otp, id_empresa, chave_licenca } = req.body || {};
  const numero = _fmtWaNumber(whatsapp);
  if (!numero || !otp) {
    return res.status(400).json({ error: 'Número e código são obrigatórios.' });
  }
  _pruneWaOtps();
  const entry = _waOtps.get(numero);
  if (!entry || entry.exp < Date.now() || String(entry.otp) !== String(otp).trim()) {
    return res.status(401).json({ error: 'Código inválido ou expirado.' });
  }
  _waOtps.delete(numero);

  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT p.*, s.* FROM usuarios s INNER JOIN perfil p ON p.id = s.idperfil WHERE s.idusuario = ? AND s.situacao = 'ATIVO' AND s.excluido = 'N' LIMIT 1`,
      [entry.idusuario]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Usuário não encontrado.' });

    // Empresa
    let empresaId = id_empresa ? parseInt(id_empresa, 10) : null;
    if (!empresaId) {
      const [emps] = await pool.query(
        `SELECT e.id_empresa FROM empresa e INNER JOIN empresas_usuarios t ON t.id_empresa = e.id_empresa WHERE t.status = 'SIM' AND t.id_usuario = ? ORDER BY e.Razao_empresa LIMIT 1`,
        [String(user.idusuario)]
      );
      empresaId = emps[0]?.id_empresa || null;
    }

    const token = jwt.sign(
      { idusuario: user.idusuario, loginusu: user.loginusu, id_empresa: empresaId, chave_licenca: chave_licenca || null },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.cookie('token', token, { httpOnly: true, sameSite: 'Lax', maxAge: 8 * 60 * 60 * 1000 });
    res.json({ ok: true, token, id_empresa: empresaId });
  } catch (err) {
    console.error('[wa-otp-verify]', err.message);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ── RECUPERAÇÃO DE SENHA ────────────────────────────────────────────────────
// Tokens em memória: chave = token hex, valor = { idusuario, email, exp }
const _resetTokens = new Map();
const RESET_TTL_MS = 30 * 60 * 1000; // 30 min

function _pruneResetTokens() {
  const now = Date.now();
  for (const [k, v] of _resetTokens) {
    if (v.exp < now) _resetTokens.delete(k);
  }
}

// POST /api/auth/forgot-password  {email}
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ ok: false, mensagem: 'Informe o e-mail cadastrado.' });
  }
  try {
    const pool = getPool();
    const [[user]] = await pool.query(
      `SELECT idusuario, loginusu, email FROM usuarios WHERE LOWER(email) = LOWER(?) AND situacao = 'ATIVO' AND excluido = 'N' LIMIT 1`,
      [email.trim()]
    );
    // Responde ok mesmo se não encontrado — evita enumeração de e-mails
    if (!user) return res.json({ ok: true });

    _pruneResetTokens();
    const token = crypto.randomBytes(32).toString('hex');
    _resetTokens.set(token, { idusuario: user.idusuario, email: user.email, exp: Date.now() + RESET_TTL_MS });

    const host = req.get('x-forwarded-host') || req.get('host') || 'localhost';
    const proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
    const link = `${proto}://${host}/reset-senha.html?t=${token}`;

    try {
      const { sendMail } = require('../config/mailer');
      await sendMail({
        to: user.email,
        subject: 'PedidosWeb — Redefinição de Senha',
        html: `
          <div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f8fafc;border-radius:16px">
            <h2 style="color:#0f172a;font-size:22px;margin-bottom:8px">Redefinição de senha</h2>
            <p style="color:#64748b;font-size:14px;line-height:1.6">Clique no botão abaixo para redefinir sua senha. O link expira em <strong>30 minutos</strong>.</p>
            <a href="${link}" style="display:inline-block;margin:24px 0;background:#0ea5e9;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px">Redefinir minha senha →</a>
            <p style="color:#94a3b8;font-size:12px">Se você não solicitou isso, ignore este e-mail. Sua senha não será alterada.</p>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
            <p style="color:#cbd5e1;font-size:11px">PedidosWeb CRM — NC Sistemas</p>
          </div>
        `,
      });
    } catch (mailErr) {
      console.warn('[forgot-password] email não enviado:', mailErr.message);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[forgot-password]', err.message);
    res.status(500).json({ ok: false, mensagem: 'Erro interno. Tente novamente.' });
  }
});

// POST /api/auth/reset-password  {token, novaSenha}
router.post('/reset-password', async (req, res) => {
  const { token, novaSenha } = req.body || {};
  if (!token || !novaSenha) {
    return res.status(400).json({ ok: false, mensagem: 'Token e nova senha são obrigatórios.' });
  }
  if (novaSenha.length < 6) {
    return res.status(400).json({ ok: false, mensagem: 'A senha deve ter pelo menos 6 caracteres.' });
  }
  _pruneResetTokens();
  const entry = _resetTokens.get(token);
  if (!entry || entry.exp < Date.now()) {
    _resetTokens.delete(token);
    return res.status(400).json({ ok: false, mensagem: 'Link expirado ou inválido. Solicite um novo.' });
  }
  try {
    const pool = getPool();
    await pool.query(
      `UPDATE usuarios SET senhausu = ? WHERE idusuario = ? AND situacao = 'ATIVO' AND excluido = 'N'`,
      [novaSenha.toUpperCase(), entry.idusuario]
    );
    _resetTokens.delete(token);
    res.json({ ok: true, mensagem: 'Senha redefinida com sucesso.' });
  } catch (err) {
    console.error('[reset-password]', err.message);
    res.status(500).json({ ok: false, mensagem: 'Erro ao redefinir senha. Tente novamente.' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Não autenticado' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.json({ user: decoded });
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
});

// GET /api/auth/minhas-permissoes
// Retorna permissões completas do usuário logado (incluindo acessar_configuracoes)
// NOTA: esta rota bypassa authMiddleware (registrada antes em server.js), por isso
// resolve o pool manualmente para suportar modo multi-tenant.
router.get('/minhas-permissoes', async (req, res) => {
  const rawToken = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (!rawToken) return res.status(401).json({ error: 'Não autenticado' });

  let decoded;
  try {
    decoded = jwt.verify(rawToken, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Token inválido' });
  }

  // Resolve o pool correto: multi-tenant usa chave_licenca do JWT; single usa pool global
  let pool;
  try {
    if (customerDbFromLicense() && decoded.chave_licenca) {
      const chave = String(decoded.chave_licenca).trim();
      let p = getPoolForLicense(chave);
      if (!p) {
        try {
          const cached = LicenseCache.read(chave);
          if (cached?.dados) {
            const cfg = extractMysqlConfigFromLicenseRow(cached.dados);
            if (cfg) p = createPool(cfg, chave);
          }
        } catch (_) {}
      }
      if (!p) {
        try { await createPoolFromLicenseBinding(); p = getPoolForLicense(chave); } catch (_) {}
      }
      if (!p) {
        const binding = readLicenseBinding();
        if (binding && String(binding.chave_licenca).trim() === chave) p = getGlobalPool();
      }
      if (!p) return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
      pool = p;
    } else {
      pool = getPool();
    }
  } catch {
    return res.status(503).json({ error: 'Banco de dados não disponível.' });
  }

  try {
    await ensurePerfilCadastroColumns(pool);
    const perfilOverlay = sqlPerfilOverlayAliases('p');
    const [rows] = await pool.query(
      `SELECT p.*, u.*${perfilOverlay ? `, ${perfilOverlay}` : ''}
       FROM usuarios u
       INNER JOIN perfil p ON p.id = u.idperfil
       WHERE u.idusuario = ? AND u.excluido = 'N' LIMIT 1`,
      [decoded.id]
    );
    const row = overlayPerfilPermissoes(rows[0] || {});
    const perm = row;
    const isAdmin = decoded.perfil == 1;
    const permissoesEfetivas = buildPermissoes(row);
    const cadastroPerm = buildGtelaFromPerfil(perm, isAdmin);
    res.json({
      acessar_configuracoes:  isAdmin ? 'S' : (perm.acessar_configuracoes || 'N'),
      alterar_configuracoes:  isAdmin ? 'S' : (perm.alterar_configuracoes || 'N'),
      manutencaocadastros:    isAdmin ? 'S' : (perm.manutencaocadastros   || 'N'),
      acessar_cadastros:      isAdmin ? 'S' : (perm.acessar_cadastros     || 'N'),
      gtela_fornecedores:     isAdmin ? 'S' : (perm.tela_fornecedores     || 'N'),
      gtela_produtos:         isAdmin ? 'S' : (perm.tela_produtos         || 'N'),
      gtela_usuarios:         isAdmin ? 'S' : (perm.tela_usuarios         || 'N'),
      alteravendedorcadastrocli: isAdmin ? 'S' : (perm.alteravendedorcadastrocli || 'N'),
      mudarempresa:           permissoesEfetivas.mudarempresa || 'N',
      alterardatapedido:      permissoesEfetivas.alterardatapedido || 'N',
      trocarvendedorpedido:   permissoesEfetivas.trocarvendedorpedido || 'N',
      faturar_pedido:         permissoesEfetivas.faturar_pedido || 'N',
      marcar_enviado_rep:     permissoesEfetivas.marcar_enviado_rep || 'N',
      acessar_metas_vendas:   permissoesEfetivas.acessar_metas_vendas || 'N',
      p_vender:               permissoesEfetivas.p_vender || 'N',
      incluir_produtos:       permissoesEfetivas.incluir_produtos || 'N',
      alterar_produtos:       permissoesEfetivas.alterar_produtos || 'N',
      excluir_produtos:       permissoesEfetivas.excluir_produtos || 'N',
      incluir_pedvendas:      permissoesEfetivas.incluir_pedvendas || 'N',
      alterar_pedvendas:      permissoesEfetivas.alterar_pedvendas || 'N',
      excluir_pedvendas:      permissoesEfetivas.excluir_pedvendas || 'N',
      alertarpainelempresapedvenda: permissoesEfetivas.alertarpainelempresapedvenda || 'N',
      ...cadastroPerm,
      isAdmin
    });
  } catch (e) {
    console.error('[minhas-permissoes]', e.message);
    res.status(500).json({ error: 'Erro ao buscar permissões.' });
  }
});

// ─── Funções auxiliares ────────────────────────────────────────────────────

async function checkMensalidade(pool) {
  try {
    // Verifica se tabela existe
    const [tables] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'liberacoes'`
    );
    if (!tables[0]?.cnt) return { bloqueado: false, aviso: false, tabela: false };

    // Query idêntica ao Delphi: verifica mensalidades em aberto do mês atual e anterior
    const [rows] = await pool.query(
      `SELECT l.*,
              DATEDIFF(CURDATE(), l.data) AS dias_diferenca,
              CASE WHEN DATEDIFF(CURDATE(), l.data) > 30 THEN 'SIM' ELSE '' END AS sistema_bloqueado,
              CASE WHEN DATEDIFF(CURDATE(), l.data) <= 30 THEN 30 - DATEDIFF(CURDATE(), l.data) ELSE 0 END AS dias_para_bloqueio
       FROM liberacoes l
       WHERE l.data <= CURDATE()
         AND l.situacao = 'AGUARDANDO'
         AND (
           (YEAR(l.data) = YEAR(CURDATE()) AND MONTH(l.data) = MONTH(CURDATE()))
           OR
           (YEAR(l.data) = YEAR(CURDATE()) AND MONTH(l.data) = MONTH(CURDATE()) - 1)
         )`
    );

    if (rows.length === 0) return { bloqueado: false, aviso: false };

    const bloqueado = rows.some(r => r.sistema_bloqueado === 'SIM');
    const maxDias = Math.max(...rows.map(r => r.dias_diferenca || 0));

    return {
      bloqueado,
      aviso: true,
      diasAtraso: maxDias,
      parcelas: rows.length,
      diasParaBloqueio: rows[0]?.dias_para_bloqueio || 0
    };
  } catch {
    return { bloqueado: false, aviso: false };
  }
}

async function registrarTerminal(pool, ip, userAgent, userId, empresaId) {
  try {
    const hostname = `web-${ip.replace(/[.:]/g, '-')}`;
    const [existing] = await pool.query(
      `SELECT id FROM terminais WHERE host_name = ? AND excluido = 'N' LIMIT 1`,
      [hostname]
    );
    if (existing.length > 0) {
      await pool.query(
        `UPDATE terminais SET dt_ultimoacesso = CURDATE(), hora_ultimoacesso = TIME(NOW()),
         empresalogada = ? WHERE host_name = ?`,
        [empresaId || null, hostname]
      );
    } else {
      await pool.query(
        `INSERT INTO terminais (host_name, ip, versao, dt_ultimoacesso, hora_ultimoacesso, empresalogada, excluido)
         VALUES (?, ?, '1.0.0', CURDATE(), TIME(NOW()), ?, 'N')`,
        [hostname, ip, empresaId || null]
      );
    }
  } catch { /* silencioso */ }
}

// Constrói objeto de permissões (PermissaoOperacao do Delphi)
function buildPermissoes(rawUser) {
  const user = overlayPerfilPermissoes(rawUser);
  const isAdmin = user.idperfil == 1;
  // 'S'/'N' sem fallback opcional: blank continua blank (alguns campos ignoram blank)
  const s  = (field) => isAdmin ? 'S' : (user[field] || 'N');
  // Campos onde blank = "ignorar" (não forçar 'N')
  const sb = (field) => isAdmin ? 'S' : (user[field] || '');

  return {
    // Pedidos de venda
    incluir_pedvendas: s('incluir_pedvendas'),
    alterar_pedvendas: s('alterar_pedvendas'),
    excluir_pedvendas: s('excluir_pedvendas'),
    // Clientes
    incluir_clientes: s('incluir_clientes'),
    alterar_clientes: s('alterar_clientes'),
    excluir_clientes: s('exclui_clientes'),
    // Fornecedores
    incluir_fornecedor: s('incluir_fornecedor'),
    alterar_fornecedor: s('alterar_fornecedor'),
    excluir_fornecedor: s('excluir_fornecedor'),
    // Produtos
    incluir_produtos: s('incluir_produtos'),
    alterar_produtos: s('alterar_produtos'),
    excluir_produtos: s('excluir_produtos'),
    // Promoções comerciais
    incluir_promocoes: s('incluir_promocoes'),
    alterar_promocoes: s('alterar_promocoes'),
    excluir_promocoes: s('excluir_promocoes'),
    prorrogar_promocoes: s('prorrogar_promocoes'),
    manutencao_promocoes: s('manutencao_promocoes'),
    // Transportadoras
    transportadora_incluir: s('transportadora_incluir'),
    transportadora_alterar: s('transportadora_alterar'),
    transportadora_excluir: s('transportadora_excluir'),
    // Ações no pedido
    faturar_pedido: s('faturar_pedido'),
    marcar_enviado_rep: s('marcar_enviado_rep'),
    acessar_metas_vendas: s('acessar_metas_vendas'),
    // Gerais
    p_vender: s('p_vender'),
    p_comprar: isAdmin ? 'S' : (user.p_comprar || 'N'),
    acessogerenciais: s('acessogerenciais'),
    manutencaocadastros: s('manutencaocadastros'),
    acessar_cadastros: s('acessar_cadastros'),
    // acessartodosclientes e gerentecomercial usam sb (blank = ignorar)
    acessartodosclientes: sb('acessartodosclientes'),
    gerentecomercial: sb('gerentecomercial'),
    mudarempresa: isAdmin ? 'S' : (user.mudarempresa || 'N'),
    alterarbase: isAdmin ? 'S' : (user.alterarbase || 'N'),
    acesso_financeiro: isAdmin ? 'S' : (user.acesso_financeiro || 'N'),
    acessoperfil: isAdmin ? 'S' : (user.acessoperfil || 'N'),
    gtela_usuarios: s('tela_usuarios'),
    gtela_clientes: s('tela_clientes'),
    gtela_fornecedores: s('tela_fornecedores'),
    gtela_produtos: s('tela_produtos'),
    // Pedidos — permissões adicionais
    alteraprecovenda: isAdmin ? 'S' : (user.alteraprecovenda || 'S'),
    alertarpainelempresapedvenda: s('alertarpainelempresapedvenda'),
    habilitapuxada: isAdmin ? 'S' : (user.habilitapuxada || 'N'),
    trocarvendedorpedido: s('trocarvendedorpedido'),
    p_alterarcomissao: s('p_alterarcomissao'),
    alterar_emb: s('alterar_emb'),
    alterardatapedido: s('alterardatapedido'),
    alteravendedorcadastrocli: s('alteravendedorcadastrocli'),
    ...buildGtelaFromPerfil(user, isAdmin),
  };
}

module.exports = router;
module.exports.checkMensalidade = checkMensalidade;
