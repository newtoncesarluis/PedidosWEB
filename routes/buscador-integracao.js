'use strict';
/**
 * Integração com o Buscador de Clientes (Prospecta): o PedidosWeb "puxa" os leads novos do Buscador
 * usando a chave de licença do Buscador (cabeçalho X-Buscador-Licenca no outro lado).
 *   GET  /api/buscador/config        → configuração (a chave volta mascarada)
 *   PUT  /api/buscador/config        → grava { url, licenca?, ativo, intervalo_min, id_vendedor }
 *   POST /api/buscador/testar        → confere URL + chave no Buscador
 *   POST /api/buscador/sincronizar   → importa agora os leads novos
 *   POST /api/buscador/auto          → importa só se ligado e o intervalo já venceu (chamado ao abrir Leads)
 * Só quem enxerga a equipe toda (admin / gerente) configura ou sincroniza.
 */
const express = require('express');
const { getPool } = require('../config/database');
const { canPickOtherVendors } = require('../config/vendedor-visibilidade');

const crypto = require('crypto');

const router = express.Router();
const POR_PAGINA = 200;
const MAX_PAGINAS = 10;   // 2.000 leads por sincronização; o resto fica para a próxima

const CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS buscador_config (
    id_empresa INT NOT NULL PRIMARY KEY,
    url VARCHAR(200) NOT NULL DEFAULT '',
    licenca VARCHAR(40) NOT NULL DEFAULT '',
    ativo CHAR(1) NOT NULL DEFAULT 'N',
    intervalo_min INT NOT NULL DEFAULT 30,
    id_vendedor INT NULL,
    ultimo_id INT NOT NULL DEFAULT 0,
    ultimo_sync DATETIME NULL,
    ultimo_resultado VARCHAR(255) NOT NULL DEFAULT '',
    dtalterado DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;
const _ok = new WeakSet();
async function ensureTable() {
  const pool = getPool();
  if (_ok.has(pool)) return;
  await pool.query(CREATE_SQL);
  _ok.add(pool);
}

const empresaDe = (req) => parseInt(req.user && req.user.id_empresa, 10) || 1;
const usuarioDe = (req) => parseInt((req.user && (req.user.idusuario || req.user.id)) || 0, 10);

function soGestor(req, res) {
  if (canPickOtherVendors(req)) return true;
  res.status(403).json({ error: 'Apenas administrador ou gerente pode configurar a integração com o Buscador.' });
  return false;
}

function normalizarChave(raw) {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length === 16 ? `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12)}` : null;
}

/** Só https (http apenas para localhost, em desenvolvimento). Devolve a URL sem barra final ou null. */
function normalizarUrl(raw) {
  try {
    const u = new URL(/^https?:\/\//i.test(String(raw).trim()) ? String(raw).trim() : 'https://' + String(raw).trim());
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
    return (u.origin + u.pathname).replace(/\/+$/, '');
  } catch (_) { return null; }
}

async function carregarConfig(pool, req) {
  await ensureTable();
  const emp = empresaDe(req);
  await pool.query('INSERT IGNORE INTO buscador_config (id_empresa) VALUES (?)', [emp]);
  const [[c]] = await pool.query('SELECT * FROM buscador_config WHERE id_empresa = ?', [emp]);
  return c;
}

function mascarar(chave) {
  return chave ? `****-****-****-${String(chave).slice(-4)}` : '';
}

function publico(c) {
  return {
    url: c.url, licenca_mascarada: mascarar(c.licenca), tem_licenca: !!c.licenca, ativo: c.ativo === 'S',
    intervalo_min: c.intervalo_min, id_vendedor: c.id_vendedor, ultimo_sync: c.ultimo_sync, ultimo_resultado: c.ultimo_resultado,
  };
}

async function chamar(c, caminho) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch(c.url + caminho, { headers: { 'X-Buscador-Licenca': c.licenca, Accept: 'application/json' }, signal: ctl.signal });
    let corpo = null;
    try { corpo = await r.json(); } catch (_) { /* resposta sem JSON */ }
    if (!r.ok) throw new Error((corpo && corpo.error) || `Buscador respondeu HTTP ${r.status}`);
    return corpo || {};
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('O Buscador demorou demais para responder');
    throw e;
  } finally { clearTimeout(timer); }
}

const txt = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const STATUS = ['NOVO', 'CONTATO', 'QUALIFICADO', 'PROPOSTA', 'GANHO', 'PERDIDO'];

function paraLead(b, c, req) {
  const st = String(b.status_funil || 'NOVO').toUpperCase();
  const tags = [txt(b.tags, 200), `buscador:${b.id}`].filter(Boolean).join(',').slice(0, 255);
  const lat = parseFloat(b.latitude), lng = parseFloat(b.longitude);
  const geo = isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  return {
    id_empresa: empresaDe(req),
    id_usuario: usuarioDe(req),
    id_vendedor: c.id_vendedor || null,
    nome: txt(b.nome || b.empresa, 150),
    empresa: txt(b.empresa, 150),
    telefone: txt(b.telefone, 30), whatsapp: txt(b.whatsapp, 30), email: txt(b.email, 150),
    instagram: txt(b.instagram, 120), facebook: txt(b.facebook, 120),
    endereco: txt(b.endereco, 255), cep: txt(b.cep, 20), bairro: txt(b.bairro, 100),
    cidade: txt(b.cidade, 100), uf: txt(b.uf, 2).toUpperCase(),
    latitude: geo ? String(lat) : null, longitude: geo ? String(lng) : null,
    segmento: txt(b.segmento, 120), cargo: txt(b.cargo, 100),
    origem: 'Buscador', campanha: txt(b.campanha, 120),
    observacoes: txt(b.observacoes, 2000), tags,
    status_funil: STATUS.includes(st) ? st : 'NOVO',
    cnpj: txt(b.cnpj, 18), decisor: txt(b.decisor, 150), cnae: txt(b.cnae, 12),
    cnae_descricao: txt(b.cnae_descricao, 200), porte: txt(b.porte, 60),
    buscador_id: parseInt(b.id, 10),
  };
}

async function sincronizar(pool, req, c) {
  await require('./leads').ensureTable();
  let cursor = c.ultimo_id || 0, importados = 0, repetidos = 0, vistos = 0;
  for (let pag = 0; pag < MAX_PAGINAS; pag++) {
    const d = await chamar(c, `/api/integracao/leads?desde_id=${cursor}&limite=${POR_PAGINA}`);
    const lista = Array.isArray(d.leads) ? d.leads : [];
    for (const b of lista) {
      vistos++;
      const lead = paraLead(b, c, req);
      if (!lead.nome || !lead.buscador_id) continue;
      const [ja] = await pool.query(
        "SELECT id FROM leads WHERE id_empresa = ? AND buscador_id = ? AND excluido = 'N' LIMIT 1", [lead.id_empresa, lead.buscador_id]
      );
      if (ja.length) { repetidos++; continue; }
      const [ins] = await pool.query('INSERT INTO leads SET ?', [lead]);
      await pool.query(
        "INSERT INTO lead_historico (lead_id, id_usuario, tipo, descricao) VALUES (?, ?, 'CRIACAO', 'Lead importado do Buscador.')",
        [ins.insertId, lead.id_usuario]
      ).catch(() => {});
      importados++;
    }
    if (d.ultimo_id && d.ultimo_id > cursor) cursor = d.ultimo_id;
    if (!d.restantes || !lista.length) break;
  }
  const resumo = importados ? `${importados} lead(s) importado(s)` + (repetidos ? `, ${repetidos} já existiam` : '') : 'Nenhum lead novo';
  await pool.query(
    'UPDATE buscador_config SET ultimo_id = ?, ultimo_sync = NOW(), ultimo_resultado = ? WHERE id_empresa = ?',
    [cursor, resumo, empresaDe(req)]
  );
  return { importados, repetidos, vistos, resumo };
}

/** Impressão digital (não reversível) de host:porta/banco do pool — igual dos dois lados = mesmo MySQL. */
function impressaoBanco(pool) {
  try {
    const cc = pool.pool.config.connectionConfig;
    const host = String(cc.host || '').replace(/^localhost$/i, '127.0.0.1').toLowerCase();
    return crypto.createHash('sha256').update(`${host}:${cc.port || 3306}/${String(cc.database || '').toLowerCase()}`).digest('hex').slice(0, 20);
  } catch (_) { return ''; }
}

const MSG_MESMO_BANCO = 'Este Buscador usa o MESMO banco de dados do PedidosWeb: os leads dele já aparecem aqui, não precisa integrar.';

function precisaConfig(c, res) {
  if (!c.url || !c.licenca) { res.status(400).json({ error: 'Informe a URL e a licença do Buscador antes.' }); return false; }
  return true;
}

router.get('/config', async (req, res) => {
  if (!soGestor(req, res)) return;
  try { res.json(publico(await carregarConfig(getPool(), req))); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/config', async (req, res) => {
  if (!soGestor(req, res)) return;
  try {
    const pool = getPool();
    const atual = await carregarConfig(pool, req);
    const b = req.body || {};
    let url = atual.url;
    if (b.url !== undefined) {
      url = b.url ? normalizarUrl(b.url) : '';
      if (url === null) return res.status(400).json({ error: 'URL inválida. Use o endereço https do Buscador.' });
    }
    let licenca = atual.licenca;
    if (b.licenca) {   // vazio = mantém a que já está gravada
      licenca = normalizarChave(b.licenca);
      if (!licenca) return res.status(400).json({ error: 'Licença inválida. Formato: XXXX-XXXX-XXXX-XXXX' });
    }
    const mudouOrigem = licenca !== atual.licenca || url !== atual.url;
    const intervalo = Math.min(Math.max(parseInt(b.intervalo_min, 10) || atual.intervalo_min || 30, 5), 1440);
    const idVend = b.id_vendedor ? parseInt(b.id_vendedor, 10) || null : null;
    await pool.query(
      `UPDATE buscador_config SET url = ?, licenca = ?, ativo = ?, intervalo_min = ?, id_vendedor = ?
         ${mudouOrigem ? ', ultimo_id = 0, ultimo_sync = NULL, ultimo_resultado = \'\'' : ''} WHERE id_empresa = ?`,
      [url, licenca, b.ativo ? 'S' : 'N', intervalo, idVend, empresaDe(req)]
    );
    res.json({ ok: true, ...publico(await carregarConfig(pool, req)) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/testar', async (req, res) => {
  if (!soGestor(req, res)) return;
  try {
    const c = await carregarConfig(getPool(), req);
    if (!precisaConfig(c, res)) return;
    const d = await chamar(c, '/api/integracao/ping');
    const mesmo = !!d.banco && d.banco === impressaoBanco(getPool());
    res.json({ ok: true, empresa: d.empresa || '', total_leads: d.total_leads || 0, mesmo_banco: mesmo, aviso: mesmo ? MSG_MESMO_BANCO : '' });
  } catch (err) { res.status(502).json({ error: err.message }); }
});

router.post('/sincronizar', async (req, res) => {
  if (!soGestor(req, res)) return;
  try {
    const pool = getPool();
    const c = await carregarConfig(pool, req);
    if (!precisaConfig(c, res)) return;
    const ping = await chamar(c, '/api/integracao/ping');
    if (ping.banco && ping.banco === impressaoBanco(pool)) return res.json({ ok: true, mesmo_banco: true, importados: 0, resumo: MSG_MESMO_BANCO });
    res.json({ ok: true, ...(await sincronizar(pool, req, c)) });
  } catch (err) { res.status(502).json({ error: err.message }); }
});

// Chamado ao abrir a tela de Leads: só roda se estiver ligado e o intervalo já venceu. Nunca devolve erro ao usuário.
const _emAndamento = new Set();
router.post('/auto', async (req, res) => {
  try {
    if (!canPickOtherVendors(req)) return res.json({ rodou: false });
    const pool = getPool();
    const c = await carregarConfig(pool, req);
    if (c.ativo !== 'S' || !c.url || !c.licenca) return res.json({ rodou: false });
    const idade = c.ultimo_sync ? (Date.now() - new Date(c.ultimo_sync).getTime()) / 60000 : Infinity;
    if (idade < c.intervalo_min) return res.json({ rodou: false });
    const ping = await chamar(c, '/api/integracao/ping');
    if (ping.banco && ping.banco === impressaoBanco(pool)) return res.json({ rodou: false, mesmo_banco: true });
    const chave = `${empresaDe(req)}`;
    if (_emAndamento.has(chave)) return res.json({ rodou: false });
    _emAndamento.add(chave);
    try { res.json({ rodou: true, ...(await sincronizar(pool, req, c)) }); }
    finally { _emAndamento.delete(chave); }
  } catch (err) {
    res.json({ rodou: false, erro: err.message });
  }
});

module.exports = router;
