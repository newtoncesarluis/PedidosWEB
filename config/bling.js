'use strict';
/**
 * Integração com o ERP Bling (API v3).
 *
 *   Bling → SysRepWeb : produtos (preço/custo/estoque) e, opcional, base inicial de clientes
 *   SysRepWeb → Bling : clientes novos (contatos) e pedidos de venda; a NF-e é gerada no Bling
 *
 * Autenticação: OAuth2 authorization_code, um aplicativo por tenant (Client ID/Secret na
 * tabela `bling_config`). Tokens JWT (`enable-jwt: 1`); access token renovado sozinho pelo
 * refresh token (vale 30 dias — se ficar 30 dias sem uso, precisa conectar de novo).
 * Limite da API: 3 requisições/s por conta → fila por pool com intervalo mínimo.
 *
 * Tabelas próprias (criadas sob demanda): bling_config, bling_vinculo, bling_log.
 * Não altera pedidos/clientes/produto além de: gravar produto/cliente importado e, quando a
 * NF-e é autorizada no Bling, preencher pedidos.chave_nfe / status_nfe / num_nf.
 */
const axios = require('axios');
const crypto = require('crypto');

const API_BASE = 'https://api.bling.com.br/Api/v3';
const OAUTH_BASE = 'https://www.bling.com.br/Api/v3';
const INTERVALO_MIN_MS = 360;        // ~2,8 req/s (limite do Bling: 3/s)
const TIMEOUT_MS = 30000;

// ─────────────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────────────
const _schemaOk = new WeakSet();

const CONFIG_COLS = {
  client_id:           'VARCHAR(120) NULL',
  client_secret:       'VARCHAR(250) NULL',
  access_token:        'TEXT NULL',
  refresh_token:       'VARCHAR(600) NULL',
  token_expira_em:     'DATETIME NULL',
  oauth_state:         'VARCHAR(64) NULL',
  oauth_state_em:      'DATETIME NULL',
  conta_nome:          'VARCHAR(200) NULL',
  conta_cnpj:          'VARCHAR(20) NULL',
  conectado_em:        'DATETIME NULL',
  envio_auto:          "CHAR(1) NOT NULL DEFAULT 'N'",
  envio_auto_desde:    'DATE NULL',
  gerar_nfe_auto:      "CHAR(1) NOT NULL DEFAULT 'N'",
  enviar_nfe_sefaz:    "CHAR(1) NOT NULL DEFAULT 'N'",
  id_loja:             'BIGINT NULL',
  id_forma_pagamento:  'BIGINT NULL',
  fornecedor_padrao:   'VARCHAR(15) NULL',
  atualizar_precos:    "CHAR(1) NOT NULL DEFAULT 'S'",
  importar_estoque:    "CHAR(1) NOT NULL DEFAULT 'N'",
  ultimo_erro:         'VARCHAR(500) NULL',
  atualizado_em:       'DATETIME NULL',
};

async function ensureSchema(pool) {
  if (_schemaOk.has(pool)) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS bling_config (
    id INT NOT NULL PRIMARY KEY
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  const [cols] = await pool.query('SHOW COLUMNS FROM bling_config');
  const tem = new Set(cols.map((c) => c.Field.toLowerCase()));
  for (const [k, def] of Object.entries(CONFIG_COLS)) {
    if (!tem.has(k)) await pool.query(`ALTER TABLE bling_config ADD COLUMN \`${k}\` ${def}`);
  }
  await pool.query('INSERT IGNORE INTO bling_config (id) VALUES (1)');

  await pool.query(`CREATE TABLE IF NOT EXISTS bling_vinculo (
    tipo            VARCHAR(12) NOT NULL,
    id_local        VARCHAR(30) NOT NULL,
    id_bling        BIGINT NOT NULL,
    situacao        VARCHAR(60) NULL,
    id_nfe          BIGINT NULL,
    numero_nfe      VARCHAR(20) NULL,
    chave_nfe       VARCHAR(44) NULL,
    situacao_nfe    VARCHAR(30) NULL,
    sincronizado_em DATETIME NULL,
    PRIMARY KEY (tipo, id_local),
    KEY idx_bling (tipo, id_bling)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await pool.query(`CREATE TABLE IF NOT EXISTS bling_log (
    id        INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    criado_em DATETIME NOT NULL,
    tipo      VARCHAR(12) NULL,
    id_local  VARCHAR(30) NULL,
    acao      VARCHAR(30) NULL,
    ok        CHAR(1) NOT NULL DEFAULT 'S',
    mensagem  VARCHAR(1000) NULL,
    usuario   VARCHAR(60) NULL,
    KEY idx_data (criado_em),
    KEY idx_ref (tipo, id_local)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  _schemaOk.add(pool);
}

async function getConfig(pool) {
  await ensureSchema(pool);
  const [[row]] = await pool.query('SELECT * FROM bling_config WHERE id=1');
  return row || {};
}

async function salvarConfig(pool, campos) {
  await ensureSchema(pool);
  const keys = Object.keys(campos).filter((k) => k in CONFIG_COLS);
  if (!keys.length) return;
  await pool.query(
    `UPDATE bling_config SET ${keys.map((k) => `\`${k}\`=?`).join(', ')}, atualizado_em=NOW() WHERE id=1`,
    keys.map((k) => campos[k])
  );
}

/** Config sem segredos, para a tela. */
function configPublica(cfg) {
  return {
    client_id: cfg.client_id || '',
    client_secret_configurado: !!cfg.client_secret,
    conectado: !!cfg.refresh_token,
    conta_nome: cfg.conta_nome || null,
    conta_cnpj: cfg.conta_cnpj || null,
    conectado_em: cfg.conectado_em || null,
    token_expira_em: cfg.token_expira_em || null,
    envio_auto: cfg.envio_auto === 'S',
    envio_auto_desde: cfg.envio_auto_desde || null,
    gerar_nfe_auto: cfg.gerar_nfe_auto === 'S',
    enviar_nfe_sefaz: cfg.enviar_nfe_sefaz === 'S',
    id_loja: cfg.id_loja || null,
    id_forma_pagamento: cfg.id_forma_pagamento || null,
    fornecedor_padrao: cfg.fornecedor_padrao || null,
    atualizar_precos: cfg.atualizar_precos !== 'N',
    importar_estoque: cfg.importar_estoque === 'S',
    ultimo_erro: cfg.ultimo_erro || null,
  };
}

async function log(pool, { tipo, id_local, acao, ok = true, mensagem = '', usuario = null }) {
  try {
    await pool.query(
      `INSERT INTO bling_log (criado_em, tipo, id_local, acao, ok, mensagem, usuario) VALUES (NOW(),?,?,?,?,?,?)`,
      [tipo || null, id_local != null ? String(id_local) : null, acao || null, ok ? 'S' : 'N',
        String(mensagem || '').slice(0, 1000), usuario ? String(usuario).slice(0, 60) : null]
    );
  } catch (_) { /* log nunca derruba a operação */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Vínculos (id local ↔ id Bling)
// ─────────────────────────────────────────────────────────────────────────────
async function getVinculo(pool, tipo, idLocal) {
  const [[r]] = await pool.query('SELECT * FROM bling_vinculo WHERE tipo=? AND id_local=?', [tipo, String(idLocal)]);
  return r || null;
}
async function getVinculoPorBling(pool, tipo, idBling) {
  const [[r]] = await pool.query('SELECT * FROM bling_vinculo WHERE tipo=? AND id_bling=? LIMIT 1', [tipo, idBling]);
  return r || null;
}
async function gravarVinculo(pool, tipo, idLocal, idBling, extra = {}) {
  const cols = ['tipo', 'id_local', 'id_bling', 'sincronizado_em', ...Object.keys(extra)];
  const vals = [tipo, String(idLocal), idBling, new Date(), ...Object.values(extra)];
  const upd = ['id_bling=VALUES(id_bling)', 'sincronizado_em=VALUES(sincronizado_em)',
    ...Object.keys(extra).map((k) => `\`${k}\`=VALUES(\`${k}\`)`)];
  await pool.query(
    `INSERT INTO bling_vinculo (${cols.map((c) => `\`${c}\``).join(',')}) VALUES (${cols.map(() => '?').join(',')})
     ON DUPLICATE KEY UPDATE ${upd.join(', ')}`,
    vals
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OAuth
// ─────────────────────────────────────────────────────────────────────────────
function _basic(cfg) {
  return 'Basic ' + Buffer.from(`${cfg.client_id}:${cfg.client_secret}`).toString('base64');
}

async function gerarUrlAutorizacao(pool) {
  const cfg = await getConfig(pool);
  if (!cfg.client_id || !cfg.client_secret) throw new BlingErro('Salve o Client ID e o Client Secret do aplicativo antes de conectar.', 400);
  const state = crypto.randomBytes(20).toString('hex');
  await salvarConfig(pool, { oauth_state: state, oauth_state_em: new Date() });
  const u = new URL(OAUTH_BASE + '/oauth/authorize');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', cfg.client_id);
  u.searchParams.set('state', state);
  return u.toString();
}

async function _pedirToken(cfg, body) {
  try {
    const r = await axios.post(OAUTH_BASE + '/oauth/token', new URLSearchParams(body).toString(), {
      timeout: TIMEOUT_MS,
      headers: {
        Authorization: _basic(cfg),
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: '1.0',
        'enable-jwt': '1',
      },
    });
    return r.data;
  } catch (e) {
    throw _erroDeAxios(e, 'oauth/token');
  }
}

async function _gravarTokens(pool, tk, extra = {}) {
  const seg = Number(tk.expires_in) || 21600;
  await salvarConfig(pool, {
    access_token: tk.access_token,
    refresh_token: tk.refresh_token || null,
    token_expira_em: new Date(Date.now() + (seg - 120) * 1000),
    ultimo_erro: null,
    ...extra,
  });
}

/** Callback do OAuth: valida o state e troca o code (vale 1 minuto) pelos tokens. */
async function concluirAutorizacao(pool, code, state) {
  const cfg = await getConfig(pool);
  const idade = cfg.oauth_state_em ? Date.now() - new Date(cfg.oauth_state_em).getTime() : Infinity;
  if (!state || !cfg.oauth_state || state !== cfg.oauth_state || idade > 15 * 60 * 1000) {
    throw new BlingErro('Autorização expirada ou de outra sessão. Clique em "Conectar ao Bling" novamente.', 400);
  }
  if (!code) throw new BlingErro('O Bling não devolveu o código de autorização.', 400);
  const tk = await _pedirToken(cfg, { grant_type: 'authorization_code', code });
  await _gravarTokens(pool, tk, { oauth_state: null, oauth_state_em: null, conectado_em: new Date() });
  try {
    const me = await request(pool, 'GET', '/empresas/me/dados-basicos');
    const d = me?.data || {};
    await salvarConfig(pool, { conta_nome: d.nome || null, conta_cnpj: d.cnpj || null });
  } catch (_) { /* nome da conta é só informativo */ }
  return getConfig(pool);
}

async function desconectar(pool) {
  await salvarConfig(pool, {
    access_token: null, refresh_token: null, token_expira_em: null,
    conta_nome: null, conta_cnpj: null, conectado_em: null, envio_auto: 'N',
  });
}

const _refreshEmCurso = new WeakMap();
async function _renovar(pool) {
  if (_refreshEmCurso.has(pool)) return _refreshEmCurso.get(pool);
  const p = (async () => {
    const cfg = await getConfig(pool);
    if (!cfg.refresh_token) throw new BlingErro('Bling não conectado. Abra Integração Bling e clique em "Conectar ao Bling".', 401);
    try {
      const tk = await _pedirToken(cfg, { grant_type: 'refresh_token', refresh_token: cfg.refresh_token });
      await _gravarTokens(pool, tk);
      return tk.access_token;
    } catch (e) {
      if (e.status === 400 || e.status === 401) {
        // refresh vencido/revogado: força reconectar
        await salvarConfig(pool, { access_token: null, refresh_token: null, envio_auto: 'N',
          ultimo_erro: 'Conexão com o Bling expirou — conecte novamente.' });
        throw new BlingErro('A conexão com o Bling expirou (mais de 30 dias sem uso ou acesso revogado). Conecte novamente.', 401);
      }
      throw e;
    }
  })();
  _refreshEmCurso.set(pool, p);
  try { return await p; } finally { _refreshEmCurso.delete(pool); }
}

async function _accessToken(pool) {
  const cfg = await getConfig(pool);
  if (!cfg.refresh_token && !cfg.access_token) {
    throw new BlingErro('Bling não conectado. Abra Integração Bling e clique em "Conectar ao Bling".', 401);
  }
  const exp = cfg.token_expira_em ? new Date(cfg.token_expira_em).getTime() : 0;
  if (cfg.access_token && exp > Date.now()) return cfg.access_token;
  return _renovar(pool);
}

// ─────────────────────────────────────────────────────────────────────────────
// Requisições (fila por conta + novas tentativas)
// ─────────────────────────────────────────────────────────────────────────────
class BlingErro extends Error {
  constructor(msg, status = 500, detalhe = null) {
    super(msg);
    this.status = status;
    this.detalhe = detalhe;
  }
}

function _erroDeAxios(e, endpoint) {
  const st = e.response?.status || 0;
  const d = e.response?.data;
  const er = d?.error || d || {};
  let msg = er.description || er.message || er.error_description || (typeof er === 'string' ? er : '') || e.message;
  const campos = Array.isArray(er.fields) ? er.fields : [];
  if (campos.length) {
    msg += ' — ' + campos.map((f) => [f.element, f.msg].filter(Boolean).join(': ')).join('; ');
  }
  if (!st) msg = `Sem resposta do Bling (${endpoint}): ${e.code || e.message}`;
  return new BlingErro(String(msg).slice(0, 800), st || 502, d || null);
}

const _filas = new WeakMap();
function _enfileirar(pool, fn) {
  const anterior = _filas.get(pool) || Promise.resolve();
  const atual = anterior.catch(() => {}).then(async () => {
    try { return await fn(); } finally { await _esperar(INTERVALO_MIN_MS); }
  });
  _filas.set(pool, atual.catch(() => {}));
  return atual;
}
const _esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Chamada à API de recursos. `path` começa com "/" (ex.: "/contatos").
 * 429 → espera e tenta de novo; 401 → renova o token uma vez.
 */
async function request(pool, method, path, { params, data } = {}) {
  let renovou = false;
  for (let tentativa = 1; ; tentativa++) {
    const token = await _accessToken(pool);
    try {
      const r = await _enfileirar(pool, () => axios({
        method, url: API_BASE + path, params, data, timeout: TIMEOUT_MS,
        headers: { Authorization: 'Bearer ' + token, 'enable-jwt': '1', Accept: 'application/json' },
      }));
      return r.data;
    } catch (e) {
      const st = e.response?.status;
      if (st === 401 && !renovou) { renovou = true; await salvarConfig(pool, { token_expira_em: new Date(0) }); continue; }
      if (st === 429 && tentativa <= 4) { await _esperar(1200 * tentativa); continue; }
      if ((!st || st >= 500) && tentativa <= 2 && method === 'GET') { await _esperar(1500 * tentativa); continue; }
      throw _erroDeAxios(e, path);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilitários de dados
// ─────────────────────────────────────────────────────────────────────────────
const soDigitos = (v) => String(v || '').replace(/\D/g, '');
const txt = (v, max) => { const s = String(v ?? '').trim(); return s ? (max ? s.slice(0, max) : s) : undefined; };
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const arred = (v, c = 2) => Math.round(num(v) * 10 ** c) / 10 ** c;
function dataISO(v) {
  if (!v) return undefined;
  if (v instanceof Date) {
    if (isNaN(v)) return undefined;
    const p = (n) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}
function somarDias(iso, dias) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + dias);
  return dataISO(d);
}
function mascararDoc(doc) {
  if (doc.length === 14) return doc.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (doc.length === 11) return doc.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return doc;
}
function tipoPessoaCliente(cli) {
  const t = String(cli.tipo_pessoa || '').toUpperCase();
  if (t.startsWith('J')) return 'J';
  if (t.startsWith('F')) return 'F';
  return soDigitos(cli.cpf).length === 11 ? 'F' : 'J';
}
function ehOrcamento(ped) {
  return String(ped.tipo_pedido || '').toUpperCase().replace(/Ç/g, 'C').includes('ORCA');
}

let _colsCache = new WeakMap();
async function colunas(pool, tabela) {
  let m = _colsCache.get(pool);
  if (!m) { m = {}; _colsCache.set(pool, m); }
  if (!m[tabela]) {
    const [c] = await pool.query(`SHOW COLUMNS FROM \`${tabela}\``);
    m[tabela] = new Set(c.map((x) => x.Field));
  }
  return m[tabela];
}

// ─────────────────────────────────────────────────────────────────────────────
// Clientes → Contatos
// ─────────────────────────────────────────────────────────────────────────────
function clienteParaContato(cli) {
  const tipo = tipoPessoaCliente(cli);
  const doc = soDigitos(cli.cpf);
  const ie = soDigitos(cli.rg);
  const isento = /ISENT/i.test(String(cli.rg || ''));
  const body = {
    nome: txt(cli.nome, 120),
    codigo: String(cli.id),
    situacao: 'A',
    numeroDocumento: doc || undefined,
    telefone: txt(cli.foneprincipal || cli.telefone, 30),
    celular: txt(cli.celularcomprador || cli.fonesecundario, 30),
    fantasia: txt(cli.apelido, 120),
    tipo,
    email: txt(cli.email, 100),
    endereco: {
      geral: {
        endereco: txt(cli.endereco, 100),
        numero: txt(cli.numero_end, 10),
        complemento: txt(cli.complemento, 60),
        bairro: txt(cli.bairro, 60),
        cep: soDigitos(cli.cep) || undefined,
        municipio: txt(cli.cidade, 60),
        uf: txt(String(cli.uf || '').toUpperCase(), 2),
      },
    },
  };
  if (tipo === 'J') {
    if (ie && !isento) { body.ie = ie; body.indicadorIe = 1; }
    else if (isento) { body.ie = 'ISENTO'; body.indicadorIe = 2; }
    else body.indicadorIe = 9;
  } else {
    body.indicadorIe = 9;
    if (cli.rg) body.rg = txt(cli.rg, 20);
  }
  return body;
}

/**
 * Garante o contato no Bling: vínculo salvo → procura pelo CPF/CNPJ → cria.
 * Contato que já existe no Bling NÃO é sobrescrito (o cadastro de lá manda).
 */
async function garantirContato(pool, cli, usuario) {
  const vin = await getVinculo(pool, 'cliente', cli.id);
  if (vin) return { id: vin.id_bling, acao: 'vinculado' };

  const doc = soDigitos(cli.cpf);
  if (!doc) throw new BlingErro(`Cliente "${cli.nome}" está sem CPF/CNPJ — o Bling exige o documento para emitir a nota.`, 400);

  const busca = await request(pool, 'GET', '/contatos', { params: { numeroDocumento: doc, limite: 5 } });
  const achado = (busca?.data || []).find((c) => soDigitos(c.numeroDocumento) === doc);
  if (achado) {
    await gravarVinculo(pool, 'cliente', cli.id, achado.id);
    await log(pool, { tipo: 'cliente', id_local: cli.id, acao: 'vincular', mensagem: `Já existia no Bling (contato ${achado.id})`, usuario });
    return { id: achado.id, acao: 'existente' };
  }

  const r = await request(pool, 'POST', '/contatos', { data: clienteParaContato(cli) });
  const id = r?.data?.id;
  if (!id) throw new BlingErro('O Bling não devolveu o id do contato criado.', 502, r);
  await gravarVinculo(pool, 'cliente', cli.id, id);
  await log(pool, { tipo: 'cliente', id_local: cli.id, acao: 'criar', mensagem: `Contato ${id} criado no Bling`, usuario });
  return { id, acao: 'criado' };
}

async function enviarCliente(pool, idCliente, usuario) {
  const [[cli]] = await pool.query('SELECT * FROM clientes WHERE id=? LIMIT 1', [idCliente]);
  if (!cli) throw new BlingErro('Cliente não encontrado.', 404);
  try {
    return await garantirContato(pool, cli, usuario);
  } catch (e) {
    await log(pool, { tipo: 'cliente', id_local: idCliente, acao: 'criar', ok: false, mensagem: e.message, usuario });
    throw e;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pedidos → Pedidos de venda
// ─────────────────────────────────────────────────────────────────────────────
async function _idProdutoBling(pool, prod, cacheCodigos) {
  if (!prod) return null;
  const vin = await getVinculo(pool, 'produto', prod.ID);
  if (vin) return vin.id_bling;
  const cod = txt(prod.cod_interno);
  if (!cod) return null;
  if (cacheCodigos.has(cod)) return cacheCodigos.get(cod);
  const r = await request(pool, 'GET', '/produtos', { params: { codigo: cod, limite: 5 } });
  const achado = (r?.data || []).find((p) => String(p.codigo || '').trim() === cod);
  const id = achado?.id || null;
  if (id) await gravarVinculo(pool, 'produto', prod.ID, id);
  cacheCodigos.set(cod, id);
  return id;
}

/** "30/60/90", "30,60", "28 DDL" → [30,60,90]; vazio + qt_parcelas → 30 em 30 dias. */
function diasParcelas(ped) {
  const dias = String(ped.prazo_pagto || ped.condicao_pagto || '').match(/\d+/g)?.map(Number).filter((n) => n >= 0 && n <= 720) || [];
  if (dias.length) return dias;
  const q = parseInt(ped.qt_parcelas, 10) || 1;
  return Array.from({ length: Math.min(q, 36) }, (_, i) => (q === 1 ? 0 : 30 * (i + 1)));
}

async function montarPedidoVenda(pool, ped, itens, contatoId, cfg) {
  const cache = new Map();
  const ids = [...new Set(itens.map((i) => parseInt(i.cod_produto, 10)).filter(Boolean))];
  const prods = new Map();
  if (ids.length) {
    const [rows] = await pool.query('SELECT ID, cod_interno, cod_barras, descricao, unidade FROM produto WHERE ID IN (?)', [ids]);
    rows.forEach((p) => prods.set(p.ID, p));
  }

  const itensBling = [];
  let somaItens = 0;
  for (const it of itens) {
    const qtd = num(it.quantidade);
    if (qtd <= 0) continue;
    // vlrtotal_itens = total líquido da linha, já com desconto do item e com o peso
    // (preço por peso) — sem impostos. O unitário enviado é derivado dele, desconto 0.
    const total = num(it.vlrtotal_itens) || arred(qtd * num(it.valor_unitario));
    somaItens += total;
    const prod = prods.get(parseInt(it.cod_produto, 10));
    const idProd = await _idProdutoBling(pool, prod, cache);
    const item = {
      codigo: txt(prod?.cod_interno || it.cod_produto, 60),
      unidade: txt(it.unidade || prod?.unidade, 6),
      quantidade: qtd,
      valor: Math.round((total / qtd) * 10000) / 10000,
      desconto: 0,
      descricao: txt(it.desc_prod || prod?.descricao, 120) || 'ITEM',
    };
    if (idProd) item.produto = { id: idProd };
    if (it.obsitem) item.descricaoDetalhada = txt(it.obsitem, 500);
    itensBling.push(item);
  }
  if (!itensBling.length) throw new BlingErro('O pedido não tem itens com quantidade.', 400);

  const hoje = dataISO(new Date());
  const data = dataISO(ped.data_abertura) || hoje;
  const prevista = dataISO(ped.data_entrega) || data;
  const frete = arred(ped.vlrfrete);

  const body = {
    numeroLoja: txt(ped.numero || ped.id, 50),
    data,
    dataSaida: prevista,
    dataPrevista: prevista,
    contato: { id: contatoId },
    itens: itensBling,
    observacoes: txt(ped.obs, 1800),
    observacoesInternas: txt(
      `Pedido ${ped.numero || ped.id} do SysRepWeb` +
      (ped.nome_vendedor ? ` — vendedor: ${ped.nome_vendedor}` : '') +
      (ped.condicao_pagto ? ` — condição: ${ped.condicao_pagto}` : '') +
      (ped.forma_pagto ? ` — forma: ${ped.forma_pagto}` : ''), 1000),
  };
  if (cfg.id_loja) body.loja = { id: Number(cfg.id_loja) };
  if (ped.ped_compras) body.numeroPedidoCompra = txt(ped.ped_compras, 30);

  // Desconto do pedido: só manda se os totais mostram que ele NÃO está dentro dos itens
  const desc = arred(ped.vlrdesconto);
  const impostos = itens.reduce((s, i) => s + num(i.vlr_ipi) + num(i.vlr_st), 0);
  const totalPed = num(ped.vlrtotalpedido);
  if (desc > 0 && totalPed > 0 && Math.abs((somaItens + frete - desc) - (totalPed - impostos)) < 0.1) {
    body.desconto = { valor: desc, unidade: 'REAL' };
  }

  const tf = String(ped.tipo_frete || '').toUpperCase();
  const porConta = tf.includes('CIF') ? 0 : tf.includes('FOB') ? 1 : tf.includes('TERC') ? 2 : (frete > 0 ? 0 : 9);
  body.transporte = { fretePorConta: porConta, frete };

  if (cfg.id_forma_pagamento) {
    const dias = diasParcelas(ped);
    const liquido = arred(somaItens + frete - (body.desconto?.valor || 0));
    const base = Math.floor((liquido / dias.length) * 100) / 100;
    body.parcelas = dias.map((d, i) => ({
      dataVencimento: somarDias(data, d),
      valor: i === dias.length - 1 ? arred(liquido - base * (dias.length - 1)) : base,
      formaPagamento: { id: Number(cfg.id_forma_pagamento) },
    }));
  }
  return body;
}

async function _carregarPedido(pool, idPedido) {
  const [[ped]] = await pool.query(`SELECT * FROM pedidos WHERE id=? AND COALESCE(excluido,'N')='N' LIMIT 1`, [idPedido]);
  if (!ped) throw new BlingErro('Pedido não encontrado.', 404);
  const [itens] = await pool.query(
    `SELECT * FROM itensped WHERE numpedido=? AND COALESCE(excluido,'N')='N'
     ORDER BY CAST(sequencia AS UNSIGNED), id`, [ped.numero]);
  return { ped, itens };
}

/** Envia um pedido. Já enviado → devolve o vínculo, sem duplicar no Bling. */
async function enviarPedido(pool, idPedido, { usuario = null, origem = 'manual' } = {}) {
  const cfg = await getConfig(pool);
  const ja = await getVinculo(pool, 'pedido', idPedido);
  if (ja) return { id: ja.id_bling, jaEnviado: true };

  try {
    const { ped, itens } = await _carregarPedido(pool, idPedido);
    if (ehOrcamento(ped)) throw new BlingErro('Orçamento não vai para o Bling — converta em pedido primeiro.', 400);
    if (/CANC/i.test(String(ped.status || '')) || ped.data_cancelamento) throw new BlingErro('Pedido cancelado não é enviado.', 400);

    const [[cli]] = await pool.query('SELECT * FROM clientes WHERE id=? LIMIT 1', [ped.cod_cliente]);
    if (!cli) throw new BlingErro('Cliente do pedido não encontrado.', 400);
    const contato = await garantirContato(pool, cli, usuario);

    const body = await montarPedidoVenda(pool, ped, itens, contato.id, cfg);
    const r = await request(pool, 'POST', '/pedidos/vendas', { data: body });
    const id = r?.data?.id;
    if (!id) throw new BlingErro('O Bling não devolveu o id do pedido criado.', 502, r);
    await gravarVinculo(pool, 'pedido', idPedido, id, { situacao: 'Enviado' });
    const alertas = (r.data.alertas || []).map((a) => a.msg || a.message).filter(Boolean).join('; ');
    await log(pool, { tipo: 'pedido', id_local: idPedido, acao: origem === 'auto' ? 'enviar-auto' : 'enviar',
      mensagem: `Pedido ${id} criado no Bling` + (alertas ? ` (alertas: ${alertas})` : ''), usuario });

    let nfe = null;
    if (cfg.gerar_nfe_auto === 'S') {
      try { nfe = await gerarNfe(pool, idPedido, { usuario }); } catch (e) { nfe = { erro: e.message }; }
    }
    return { id, jaEnviado: false, contato, nfe };
  } catch (e) {
    await log(pool, { tipo: 'pedido', id_local: idPedido, acao: origem === 'auto' ? 'enviar-auto' : 'enviar', ok: false, mensagem: e.message, usuario });
    throw e;
  }
}

/** Gera a NF-e do pedido no Bling (e transmite à SEFAZ se configurado). */
async function gerarNfe(pool, idPedido, { usuario = null } = {}) {
  const cfg = await getConfig(pool);
  const vin = await getVinculo(pool, 'pedido', idPedido);
  if (!vin) throw new BlingErro('Envie o pedido ao Bling antes de gerar a nota.', 400);
  try {
    let idNfe = vin.id_nfe;
    if (!idNfe) {
      const r = await request(pool, 'POST', `/pedidos/vendas/${vin.id_bling}/gerar-nfe`);
      idNfe = r?.data?.idNotaFiscal || r?.idNotaFiscal || r?.data?.id || null;
      if (!idNfe) throw new BlingErro('O Bling não devolveu o id da nota gerada.', 502, r);
      await gravarVinculo(pool, 'pedido', idPedido, vin.id_bling, { id_nfe: idNfe, situacao_nfe: 'Pendente' });
      await log(pool, { tipo: 'pedido', id_local: idPedido, acao: 'gerar-nfe', mensagem: `NF-e ${idNfe} gerada no Bling`, usuario });
    }
    let transmitida = false;
    if (cfg.enviar_nfe_sefaz === 'S') {
      await request(pool, 'POST', `/nfe/${idNfe}/enviar`);
      transmitida = true;
      await log(pool, { tipo: 'pedido', id_local: idPedido, acao: 'enviar-sefaz', mensagem: `NF-e ${idNfe} transmitida à SEFAZ`, usuario });
    }
    const sit = await atualizarSituacao(pool, idPedido).catch(() => null);
    return { idNfe, transmitida, situacao: sit };
  } catch (e) {
    await log(pool, { tipo: 'pedido', id_local: idPedido, acao: 'gerar-nfe', ok: false, mensagem: e.message, usuario });
    throw e;
  }
}

const SITUACAO_NFE = {
  1: 'Pendente', 2: 'Cancelada', 3: 'Aguardando recibo', 4: 'Rejeitada', 5: 'Autorizada',
  6: 'Emitida DANFE', 7: 'Registrada', 8: 'Aguardando protocolo', 9: 'Denegada', 10: 'Consulta situação', 11: 'Bloqueada',
};
const STATUS_NFE_PEDIDO = { 2: 'CANCELADA', 5: 'AUTORIZADA', 6: 'AUTORIZADA', 9: 'DENEGADA' };

/** Consulta o pedido e a NF-e no Bling; quando autorizada, grava chave/número no pedido. */
async function atualizarSituacao(pool, idPedido) {
  const vin = await getVinculo(pool, 'pedido', idPedido);
  if (!vin) throw new BlingErro('Pedido ainda não enviado ao Bling.', 400);
  const r = await request(pool, 'GET', `/pedidos/vendas/${vin.id_bling}`);
  const pv = r?.data || {};
  const extra = { situacao: pv.situacao?.id ? `Situação ${pv.situacao.id}` : vin.situacao };
  const idNfe = pv.notaFiscal?.id || vin.id_nfe;
  let nf = null;
  if (idNfe) {
    const n = await request(pool, 'GET', `/nfe/${idNfe}`);
    nf = n?.data || {};
    Object.assign(extra, {
      id_nfe: idNfe,
      numero_nfe: nf.numero ? String(nf.numero) : null,
      chave_nfe: soDigitos(nf.chaveAcesso) || null,
      situacao_nfe: SITUACAO_NFE[nf.situacao] || (nf.situacao != null ? `Situação ${nf.situacao}` : null),
    });
    const statusPed = STATUS_NFE_PEDIDO[nf.situacao] || 'PENDENTE';
    const cols = await colunas(pool, 'pedidos');
    const sets = []; const vals = [];
    if (cols.has('status_nfe')) { sets.push('status_nfe=?'); vals.push(statusPed); }
    if (cols.has('chave_nfe') && extra.chave_nfe && extra.chave_nfe.length === 44) { sets.push('chave_nfe=?'); vals.push(extra.chave_nfe); }
    if (cols.has('num_nf') && extra.numero_nfe) { sets.push('num_nf=?'); vals.push(extra.numero_nfe); }
    if (sets.length) await pool.query(`UPDATE pedidos SET ${sets.join(', ')} WHERE id=?`, [...vals, idPedido]);
  }
  await gravarVinculo(pool, 'pedido', idPedido, vin.id_bling, extra);
  return { id_bling: vin.id_bling, ...extra };
}

// ─────────────────────────────────────────────────────────────────────────────
// Importações Bling → SysRepWeb (rodam em segundo plano, com progresso)
// ─────────────────────────────────────────────────────────────────────────────
const _jobs = new Map(); // chave do tenant → estado

function jobStatus(chave) { return _jobs.get(chave) || null; }

function iniciarJob(chave, tipo, fn) {
  const atual = _jobs.get(chave);
  if (atual && !atual.fim) throw new BlingErro(`Já existe uma importação de ${atual.tipo} em andamento.`, 409);
  const st = { tipo, inicio: new Date(), fim: null, lidos: 0, criados: 0, atualizados: 0, vinculados: 0, ignorados: 0, erros: 0, ultimosErros: [], mensagem: 'Iniciando…' };
  _jobs.set(chave, st);
  Promise.resolve().then(() => fn(st))
    .then(() => { st.mensagem = 'Concluído'; })
    .catch((e) => { st.mensagem = 'Interrompido: ' + e.message; st.erro = e.message; })
    .finally(() => { st.fim = new Date(); });
  return st;
}
function _anotarErro(st, ref, e) {
  st.erros++;
  if (st.ultimosErros.length < 20) st.ultimosErros.push(`${ref}: ${e.message}`);
}

async function importarProdutos(pool, st, usuario) {
  const cfg = await getConfig(pool);
  const cols = await colunas(pool, 'produto');
  const tem = (c) => cols.has(c);
  for (let pagina = 1; pagina <= 1000; pagina++) {
    st.mensagem = `Lendo página ${pagina} de produtos do Bling…`;
    const r = await request(pool, 'GET', '/produtos', { params: { pagina, limite: 100, criterio: 2 } });
    const lista = r?.data || [];
    if (!lista.length) break;
    for (const p of lista) {
      st.lidos++;
      try {
        if (p.formato === 'V' && !p.idProdutoPai) { st.ignorados++; continue; } // pai de variações: vende-se a variação
        const codigo = txt(p.codigo, 20);
        let idLocal = (await getVinculoPorBling(pool, 'produto', p.id))?.id_local || null;
        if (!idLocal && codigo) {
          const [[loc]] = await pool.query(
            `SELECT ID FROM produto WHERE cod_interno=? AND COALESCE(excluido,'N')='N' ORDER BY ID LIMIT 1`, [codigo]);
          if (loc) { idLocal = loc.ID; st.vinculados++; }
        }
        const set = {};
        if (cfg.atualizar_precos !== 'N' && num(p.preco) > 0) set.vlr_venda = num(p.preco);
        if (num(p.precoCusto) > 0 && tem('vlr_custo')) set.vlr_custo = num(p.precoCusto);
        if (cfg.importar_estoque === 'S' && p.estoque && tem('estoque_atual')) set.estoque_atual = num(p.estoque.saldoVirtualTotal);

        if (idLocal) {
          set.descricao = txt(String(p.nome || '').toUpperCase(), 100);
          if (tem('dt_atualizacao')) set.dt_atualizacao = new Date();
          const k = Object.keys(set).filter((c) => tem(c) && set[c] !== undefined);
          if (k.length) await pool.query(`UPDATE produto SET ${k.map((c) => `\`${c}\`=?`).join(', ')} WHERE ID=?`, [...k.map((c) => set[c]), idLocal]);
          await gravarVinculo(pool, 'produto', idLocal, p.id);
          st.atualizados++;
          continue;
        }

        // Novo: busca o detalhe (unidade, GTIN, NCM, peso)
        const det = (await request(pool, 'GET', `/produtos/${p.id}`))?.data || p;
        const novo = {
          descricao: txt(String(det.nome || p.nome || '').toUpperCase(), 100),
          cod_interno: codigo,
          unidade: txt(String(det.unidade || 'UN').toUpperCase(), 3),
          cod_barras: txt(det.gtin, 25),
          ncm: txt(soDigitos(det.tributacao?.ncm), 20),
          peso_liquido: num(det.pesoLiquido) || undefined,
          vlr_venda: num(p.preco),
          vlr_custo: num(p.precoCusto) || undefined,
          estoque_atual: cfg.importar_estoque === 'S' ? num(p.estoque?.saldoVirtualTotal) : undefined,
          cod_fornecedorpadrao: txt(cfg.fornecedor_padrao, 15),
          situacao: 'A',
          excluido: 'N',
        };
        const k = Object.keys(novo).filter((c) => tem(c) && novo[c] !== undefined);
        const [ins] = await pool.query(
          `INSERT INTO produto (${k.map((c) => `\`${c}\``).join(',')}${tem('dt_cadastro') ? ', dt_cadastro' : ''})
           VALUES (${k.map(() => '?').join(',')}${tem('dt_cadastro') ? ', CURDATE()' : ''})`,
          k.map((c) => novo[c]));
        await gravarVinculo(pool, 'produto', ins.insertId, p.id);
        st.criados++;
      } catch (e) { _anotarErro(st, `Produto ${p.codigo || p.id}`, e); }
    }
    if (lista.length < 100) break;
  }
  await log(pool, { tipo: 'produto', acao: 'importar', ok: st.erros === 0,
    mensagem: `Produtos: ${st.lidos} lidos, ${st.criados} novos, ${st.atualizados} atualizados, ${st.ignorados} ignorados, ${st.erros} erros`, usuario });
}

async function importarClientes(pool, st, usuario) {
  const cols = await colunas(pool, 'clientes');
  const tem = (c) => cols.has(c);
  for (let pagina = 1; pagina <= 2000; pagina++) {
    st.mensagem = `Lendo página ${pagina} de contatos do Bling…`;
    const r = await request(pool, 'GET', '/contatos', { params: { pagina, limite: 100, criterio: 1 } });
    const lista = r?.data || [];
    if (!lista.length) break;
    for (const c of lista) {
      st.lidos++;
      try {
        const doc = soDigitos(c.numeroDocumento);
        if (!doc || (doc.length !== 11 && doc.length !== 14) || c.situacao === 'E') { st.ignorados++; continue; }
        if (await getVinculoPorBling(pool, 'cliente', c.id)) { st.ignorados++; continue; }
        const [[loc]] = await pool.query(
          `SELECT id FROM clientes
           WHERE REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(cpf,''),'.',''),'-',''),'/',''),' ','') = ?
             AND COALESCE(excluido,'N')='N' ORDER BY id LIMIT 1`, [doc]);
        if (loc) { await gravarVinculo(pool, 'cliente', loc.id, c.id); st.vinculados++; continue; }

        const d = (await request(pool, 'GET', `/contatos/${c.id}`))?.data || c;
        const e = d.endereco?.geral || {};
        const novo = {
          tipo_pessoa: doc.length === 14 ? 'JURIDICA' : 'FISICA',
          nome: txt(d.nome, 100),
          apelido: txt(d.fantasia, 100),
          cpf: mascararDoc(doc),
          rg: txt(doc.length === 14 ? d.ie : d.rg, 25),
          email: txt(d.email, 100),
          foneprincipal: txt(d.telefone, 18),
          celularcomprador: txt(d.celular, 15),
          cep: txt(e.cep, 15),
          endereco: txt(e.endereco, 150),
          numero_end: txt(e.numero, 15),
          complemento: txt(e.complemento, 100),
          bairro: txt(e.bairro, 150),
          cidade: txt(e.municipio, 150),
          uf: txt(e.uf, 2),
          status: 'A',
          excluido: 'N',
        };
        const k = Object.keys(novo).filter((x) => tem(x) && novo[x] !== undefined);
        const [ins] = await pool.query(
          `INSERT INTO clientes (${k.map((x) => `\`${x}\``).join(',')}${tem('dtcadastro') ? ', dtcadastro' : ''})
           VALUES (${k.map(() => '?').join(',')}${tem('dtcadastro') ? ', CURDATE()' : ''})`,
          k.map((x) => novo[x]));
        await gravarVinculo(pool, 'cliente', ins.insertId, c.id);
        st.criados++;
      } catch (e) { _anotarErro(st, `Contato ${c.nome || c.id}`, e); }
    }
    if (lista.length < 100) break;
  }
  await log(pool, { tipo: 'cliente', acao: 'importar', ok: st.erros === 0,
    mensagem: `Contatos: ${st.lidos} lidos, ${st.criados} novos, ${st.vinculados} já existiam, ${st.ignorados} ignorados, ${st.erros} erros`, usuario });
}

// ─────────────────────────────────────────────────────────────────────────────
// Envio automático (a cada 2 min, pedidos novos; e atualiza NF-e dos já enviados)
// ─────────────────────────────────────────────────────────────────────────────
const _poolsConhecidos = new Set();
let _timer = null;
const _cicloEmCurso = new WeakSet();

function registrarPool(pool) {
  if (pool) _poolsConhecidos.add(pool);
}

async function cicloAutomatico(pool) {
  if (_cicloEmCurso.has(pool)) return;
  _cicloEmCurso.add(pool);
  try {
    const cfg = await getConfig(pool);
    if (cfg.envio_auto !== 'S' || !cfg.refresh_token) return;
    const desde = dataISO(cfg.envio_auto_desde) || dataISO(new Date());
    const pc = await colunas(pool, 'pedidos');
    const semCancel = pc.has('data_cancelamento') ? 'AND p.data_cancelamento IS NULL' : '';
    const hora = pc.has('hora_abertura') ? "COALESCE(p.hora_abertura,'00:00:00')" : "'00:00:00'";
    // pedido com mais de 10 min (o vendedor já terminou de digitar), sem falha automática na última hora
    const [pend] = await pool.query(
      `SELECT p.id FROM pedidos p
        LEFT JOIN bling_vinculo v ON v.tipo='pedido' AND CAST(v.id_local AS UNSIGNED) = p.id
       WHERE v.id_local IS NULL
         AND COALESCE(p.excluido,'N')='N'
         AND UPPER(COALESCE(p.tipo_pedido,'PEDIDO')) NOT LIKE '%ORC%'
         AND UPPER(COALESCE(p.status,'')) NOT LIKE 'CANC%'
         ${semCancel}
         AND p.data_abertura >= ?
         AND TIMESTAMP(p.data_abertura, ${hora}) <= NOW() - INTERVAL 10 MINUTE
         AND NOT EXISTS (SELECT 1 FROM bling_log l WHERE l.tipo='pedido' AND CAST(l.id_local AS UNSIGNED) = p.id
                          AND l.acao='enviar-auto' AND l.ok='N' AND l.criado_em > NOW() - INTERVAL 60 MINUTE)
       ORDER BY p.id LIMIT 20`, [desde]);
    for (const { id } of pend) {
      try { await enviarPedido(pool, id, { usuario: 'automático', origem: 'auto' }); } catch (_) { /* já logado */ }
    }
    // NF-e ainda não finalizada: consulta de novo
    const [abertos] = await pool.query(
      `SELECT id_local FROM bling_vinculo
        WHERE tipo='pedido' AND id_nfe IS NOT NULL
          AND COALESCE(situacao_nfe,'') NOT IN ('Autorizada','Emitida DANFE','Cancelada','Denegada')
          AND sincronizado_em > NOW() - INTERVAL 15 DAY
        ORDER BY sincronizado_em LIMIT 10`);
    for (const { id_local } of abertos) {
      try { await atualizarSituacao(pool, id_local); } catch (_) { /* segue */ }
    }
  } catch (e) {
    if (!/doesn't exist|não conectado/i.test(e.message)) console.error('[bling] ciclo automático:', e.message);
  } finally {
    _cicloEmCurso.delete(pool);
  }
}

function iniciarAgendador(getPoolBound) {
  if (_timer) return;
  _timer = setInterval(() => {
    const pools = new Set(_poolsConhecidos);
    try { const p = getPoolBound && getPoolBound(); if (p) pools.add(p); } catch (_) {}
    for (const p of pools) cicloAutomatico(p);
  }, 2 * 60 * 1000);
  if (_timer.unref) _timer.unref();
}

module.exports = {
  API_BASE, OAUTH_BASE, BlingErro,
  ensureSchema, getConfig, salvarConfig, configPublica, log,
  getVinculo, gravarVinculo,
  gerarUrlAutorizacao, concluirAutorizacao, desconectar, request,
  clienteParaContato, montarPedidoVenda, diasParcelas,
  enviarCliente, enviarPedido, gerarNfe, atualizarSituacao,
  iniciarJob, jobStatus, importarProdutos, importarClientes,
  registrarPool, cicloAutomatico, iniciarAgendador,
};
