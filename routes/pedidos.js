const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');
const { sanitizeEmpresaRow } = require('../services/empresa-logo');
const { enrichProdutosComPromocao, parseOptInt, tabelaPromocoesExiste } = require('../config/promocoes-produto');
const { listarReposicaoProdutos } = require('../config/reposicao-produtos');
const { listarOportunidadesProdutos } = require('../config/oportunidades-produtos');
const {
  attachDestaquesComerciais,
  sqlExistsDestaqueComercial,
  tabelaProdutosDestaqueExiste,
} = require('../config/produtos-destaque');
const {
  ensureItenspedPromoColumns,
  ensureItenspedObsitemColumn,
  ensurePedidoRetornoColumns,
  ensurePedidoObsProximoColumns,
} = require('../config/schema-migrations');
const { hojeIsoBrasil, addDaysIsoBrasil } = require('../config/date-brasil');
const { calcFeirinhaResumo } = require('../config/feirinha-calc');
const { listarProdutosFeirinha } = require('../config/feirinha-produtos');
const {
  isPrepostoUser,
  stripPedidoComissaoRep,
  stripFornecedorComissaoRep,
  stripItensComissaoRep,
  sanitizeComissoesFaturamentoForPreposto,
  stripVendedorComissaoRep,
  stripProdutosComissaoRep,
} = require('../config/comissao-preposto-guard');
const { buildXmlAnexoPedidoVenda } = require('../config/pedido-xml-venda');
const {
  listVendedoresVisiveis,
  resolveVendedorIdForFilter,
  buildPedidosVendedorWhere,
  buildPedidosVendedorWhereSync,
  canPickOtherVendors,
  canAccessAllVendors,
  getPrepostoContext,
  buildPedidosListVisWhere,
} = require('../config/vendedor-visibilidade');
const { buildClienteVendedorWhere, assertUsuarioPodeAcessarCliente } = require('../config/cliente-visibilidade');
const { resolverVendedorTabelaPreco } = require('../config/preposto-tabela-preco');
const { produtoBuscaOrSql } = require('../config/produto-busca-texto');
const {
  calcBaseItemTotal,
  calcPesoTotalExibir,
} = require('../config/preco-peso-produto');
const { parseRegras, validarQuantidade } = require('../config/pedido-item-regras');
const { validarTotalGradeFechada } = require('../config/grade-fechada-regras');
const { ensureTipogradeColunas } = require('../config/tipograde-colunas');

/** Bloqueia pedido para cliente fora da carteira do usuário logado. */
async function _validarCarteiraClientePedido(req, poolOrConn, codCliente) {
  if (codCliente == null || codCliente === '') return null;
  const prepCtx = await getPrepostoContext(poolOrConn, req);
  const check = await assertUsuarioPodeAcessarCliente(poolOrConn, codCliente, req.user, prepCtx);
  if (check.ok) return null;
  return { status: check.status || 403, error: check.error || 'Cliente fora da sua carteira' };
}
const { ensureProdutoColunas, getProdTabela } = require('../config/produto-colunas');
const { sqlSomenteMaeOuAvulso } = require('../config/produto-referencia');
const { pedidoEmitter, emitNovoPedido } = require('../config/pedido-events');

async function _salvarObsProximoRegistro(conn, pedidoId, texto) {
  if (texto === undefined) return;
  await ensurePedidoObsProximoColumns(conn);
  const t = String(texto ?? '').trim().slice(0, 500);
  await conn.query(
    `UPDATE pedidos
     SET obs_proximo_pedido = ?,
         obs_proximo_consumido = CASE WHEN ? <> '' THEN 'N' ELSE obs_proximo_consumido END
     WHERE id = ?`,
    [t || null, t, pedidoId]
  );
}

async function _consumirObsProximo(conn, idOrigem, codCliente, codFornecedor) {
  const id = parseInt(idOrigem, 10);
  if (!id || id < 1) return;
  await ensurePedidoObsProximoColumns(conn);
  const params = [id];
  let matchSql = '';
  const cli = parseInt(codCliente, 10);
  const forn = parseInt(codFornecedor, 10);
  if (cli && forn) {
    matchSql = ' AND cod_cliente = ? AND cod_fornecedor = ?';
    params.push(cli, forn);
  }
  await conn.query(
    `UPDATE pedidos SET obs_proximo_consumido = 'S'
     WHERE id = ?
       AND COALESCE(obs_proximo_consumido, 'N') <> 'S'
       AND TRIM(COALESCE(obs_proximo_pedido, '')) <> ''
       ${matchSql}`,
    params
  );
}

async function _queryPedidosRetornoResumo(pool, req) {
  await ensurePedidoRetornoColumns(pool);
  const vis = await buildPedidosListVisWhere(pool, req);
  const hojeBr = hojeIsoBrasil();
  const [[row]] = await pool.query(`
    SELECT
      COUNT(CASE WHEN p.data_retorno = ? THEN 1 END) AS hoje,
      COUNT(CASE WHEN p.data_retorno < ? THEN 1 END) AS atrasados
    FROM pedidos p
    WHERE (p.excluido = 'N' OR p.excluido IS NULL OR p.excluido = '')
      AND p.data_retorno IS NOT NULL
      AND COALESCE(p.situacao_pedido,'') NOT IN ('CANCELADO','FATURADO')
      ${vis.clause}
  `, [hojeBr, hojeBr, ...vis.params]).catch(() => [[{ hoje: 0, atrasados: 0 }]]);
  return { hoje: row?.hoje || 0, atrasados: row?.atrasados || 0 };
}

async function _promoCtxFromPedidoQuery(pool, query) {
  const codCliente = parseOptInt(query.cod_cliente);
  let idRegiao = parseOptInt(query.id_regiao);
  const codFornecedor = parseOptInt(query.cod_fornecedor || query.id_fornecedor);
  const idTabelaPreco = parseOptInt(query.id_tabela || query.id_tabela_preco);

  if (codCliente && !idRegiao) {
    const [[cli]] = await pool.query(
      `SELECT regiao FROM clientes WHERE id = ? AND (excluido = 'N' OR excluido IS NULL) LIMIT 1`,
      [codCliente]
    );
    if (cli?.regiao) idRegiao = parseInt(cli.regiao, 10) || null;
  }

  return { codCliente, idRegiao, codFornecedor, idTabelaPreco };
}

// tabela de produtos pode ser "produto" ou "produtos" — detecta por tenant
async function _getProdTabela(pool) {
  return getProdTabela(pool);
}

async function _ensureProdCols(pool) {
  const { names, changed } = await ensureProdutoColunas(pool);
  let key = 'default';
  try { const [[r]] = await pool.query('SELECT DATABASE() AS db'); key = String(r?.db || 'default'); } catch (_) {}
  if (changed) {
    _prodColSetCache.delete(key);
  } else if (names && !_prodColSetCache.has(key)) {
    _prodColSetCache.set(key, names);
  }
}

// Conjunto de colunas reais da tabela de produto, cacheado por banco (multi-tenant).
// Usado para aplicar filtros opcionais (nome_grupo/marca/kit) só quando a coluna existe.
const _prodColSetCache = new Map(); // dbName -> Set(colnames lower)
async function _getProdColSet(pool) {
  let key = 'default';
  try { const [[r]] = await pool.query('SELECT DATABASE() AS db'); key = String(r?.db || 'default'); } catch (_) {}
  if (_prodColSetCache.has(key)) return _prodColSetCache.get(key);
  await _ensureProdCols(pool);
  if (_prodColSetCache.has(key)) return _prodColSetCache.get(key);
  const tb = await _getProdTabela(pool);
  const [cols] = await pool.query(`DESCRIBE ${tb}`);
  const set = new Set(cols.map(c => String(c.Field).toLowerCase()));
  _prodColSetCache.set(key, set);
  return set;
}

/** Evita dois usuários editando o mesmo pedido ao mesmo tempo (memória + TTL; use ping ao editar). */
const PEDIDO_EDIT_LOCK_TTL_MS = 3 * 60 * 1000;
const pedidoEditLocks = new Map();

function pedidoEditTenantKey(req) {
  return String(req?.user?.chave_licenca || process.env.DB_NAME || 'default');
}

function pedidoEditLockKey(tenantKey, pedidoId) {
  return `${String(tenantKey || 'default')}:${String(pedidoId)}`;
}

function cleanExpiredPedidoEditLocks() {
  const now = Date.now();
  for (const [k, v] of pedidoEditLocks) {
    if (v.exp < now) pedidoEditLocks.delete(k);
  }
}

function tryAcquirePedidoEditLock(tenantKey, pedidoId, userId, userName, meta = {}) {
  cleanExpiredPedidoEditLocks();
  const id = pedidoEditLockKey(tenantKey, pedidoId);
  const now = Date.now();
  const cur = pedidoEditLocks.get(id);
  const uid = userId != null ? String(userId) : '';
  if (cur && cur.exp >= now && cur.userId !== uid) {
    return {
      ok: false,
      lockedBy: cur.userName || 'Outro usuário',
      lockedHost: cur.clientHost || '',
      lockedIp: cur.clientIp || '',
      lockedSince: cur.since || null
    };
  }
  pedidoEditLocks.set(id, {
    userId: uid,
    userName: (userName || '').trim(),
    clientHost: String(meta.clientHost || '').trim().slice(0, 120),
    clientIp: String(meta.clientIp || '').trim().slice(0, 64),
    since: now,
    exp: now + PEDIDO_EDIT_LOCK_TTL_MS
  });
  return { ok: true };
}

function renewPedidoEditLock(tenantKey, pedidoId, userId) {
  const id = pedidoEditLockKey(tenantKey, pedidoId);
  const cur = pedidoEditLocks.get(id);
  const uid = userId != null ? String(userId) : '';
  if (!cur || cur.userId !== uid) return false;
  cur.exp = Date.now() + PEDIDO_EDIT_LOCK_TTL_MS;
  return true;
}

function releasePedidoEditLock(tenantKey, pedidoId, userId) {
  const id = pedidoEditLockKey(tenantKey, pedidoId);
  const cur = pedidoEditLocks.get(id);
  const uid = userId != null ? String(userId) : '';
  if (!cur || cur.userId !== uid) return;
  pedidoEditLocks.delete(id);
}

/** Nome do terminal: body/header, tabela terminais (login Delphi/web) ou fallback por IP. */
async function resolvePedidoEditClientHost(pool, clientHost, clientIp) {
  const fromClient = String(clientHost || '').trim().slice(0, 120);
  if (fromClient) return fromClient;
  const ip = String(clientIp || '').trim();
  if (!ip) return 'Navegador web';
  const ipSlug = ip.replace(/[.:]/g, '-');
  if (pool) {
    try {
      const [rows] = await pool.query(
        `SELECT host_name FROM terminais
         WHERE excluido = 'N' AND (ip = ? OR host_name = ? OR host_name LIKE ?)
         ORDER BY dt_ultimoacesso DESC, hora_ultimoacesso DESC, id DESC
         LIMIT 1`,
        [ip, `web-${ipSlug}`, `web-${ipSlug}%`]
      );
      const hn = rows[0]?.host_name;
      if (hn && String(hn).trim()) return String(hn).trim().slice(0, 120);
    } catch (_) {}
  }
  return `web-${ipSlug}`;
}

/** Evita gravar string concatenada no DECIMAL (ex.: JSON com número como string + reduce no browser). */
function nPedidoField(v, def = 0) {
  if (v === null || v === undefined || v === '') return def;
  const x = typeof v === 'number' && Number.isFinite(v)
    ? v
    : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(x) ? x : def;
}

/** id_empresa / id_filial — inteiro ou NULL (não 0). */
function nPedidoId(v) {
  if (v === null || v === undefined || v === '') return null;
  const x = parseInt(String(v), 10);
  return Number.isFinite(x) ? x : null;
}

/** DATETIME em horário de Brasília (independente do fuso do servidor MySQL). */
function mysqlDatetimeBrasil() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace('T', ' ');
}

/** Config de colunas da grade de itens do pedido (objeto JSON em preferencias_grid). */
function parseItensColunasConfigJson(raw) {
  if (raw == null) return null;
  let v = raw;
  if (Buffer.isBuffer(v)) {
    try { v = v.toString('utf8'); } catch { return null; }
  }
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return null; }
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  return null;
}

/** `preferencias_grid.config_json` pode vir como string (TEXT) ou já parseado (tipo JSON no MySQL). */
function parsePreferenciasGridConfigJson(raw) {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw;
  if (Buffer.isBuffer(raw)) {
    try {
      raw = raw.toString('utf8');
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object') return null;
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  }
  return null;
}

const PEDIDO_NUMERIC_FIELDS = new Set([
  'vlrtotalpedido', 'vlrsubtotal', 'vlrtotalitens', 'vlrtotalbruto',
  'vlrdesconto', 'vlrtotalimposto', 'vlrfrete', 'vlrjuros',
  'qt_parcelas', 'total_qt', 'total_peso',
  'vlrtotalitenspuxada', 'vlr_totpuxada',
  'comissao', 'vlrcomissao', 'vlr_comissaonormal', 'vlr_total_comissao', 'comissaogerente',
  'vlr_faturado', 'vlr_faturamento', 'vlr_diferencafaturamento',
  'vlr_comissao_preposto',
  'preco_medio_feirinha', 'preco_revenda_feirinha',
]);

const PEDIDO_ID_FIELDS = new Set(['id_empresa', 'id_filial', 'id_preposto', 'id_campanha_feirinha']);
/** Campos DATE no MySQL: string vazia quebra o UPDATE — usar NULL */
const PEDIDO_DATE_FIELDS = new Set(['data_entrega', 'data_faturado', 'data_faturadofabrica', 'data_retorno']);

let _tablesEnsured = false;
let _ensureTablesPromise = null;
function ensureTablesOnce(pool) {
  if (!_ensureTablesPromise) _ensureTablesPromise = ensureTables(pool);
  return _ensureTablesPromise;
}
async function ensureTables(pool) {
  if (_tablesEnsured) return;
  _tablesEnsured = true;

  // ─── Fase 1: CREATE TABLE (em paralelo, rápido quando já existem) ─────────
  await Promise.all([
    pool.query(`
      CREATE TABLE IF NOT EXISTS pedidos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        numero VARCHAR(50),
        data_abertura DATE,
        hora_abertura TIME,
        id_usuario INT,
        nome_vendedor VARCHAR(100),
        cod_cliente INT,
        nome_cliente VARCHAR(100),
        cod_fornecedor INT,
        nome_fornecedor VARCHAR(100),
        cod_transportadora INT,
        nome_transportadora VARCHAR(100),
        tipo_frete VARCHAR(10),
        ped_compras VARCHAR(100),
        comprador VARCHAR(100),
        data_entrega DATE,
        condicao_pagto VARCHAR(100),
        forma_pagto VARCHAR(100),
        vlrsubtotal DECIMAL(15,2) DEFAULT 0,
        vlrdesconto DECIMAL(15,2) DEFAULT 0,
        vlrtotalimposto DECIMAL(15,2) DEFAULT 0,
        vlrfrete DECIMAL(15,2) DEFAULT 0,
        vlrjuros DECIMAL(15,2) DEFAULT 0,
        vlrtotalpedido DECIMAL(15,2) DEFAULT 0,
        situacao_pedido VARCHAR(50) DEFAULT 'ABERTO',
        origem_comissao VARCHAR(20),
        obs TEXT,
        excluido VARCHAR(1) DEFAULT 'N',
        dtcadastro DATE,
        dtalterado DATETIME
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3
    `).catch(err => console.error('Erro ao criar pedidos:', err)),

    pool.query(`
      CREATE TABLE IF NOT EXISTS itensped (
        id INT AUTO_INCREMENT PRIMARY KEY,
        numpedido VARCHAR(50),
        cod_produto INT,
        desc_prod VARCHAR(150),
        unidade VARCHAR(10),
        quantidade DECIMAL(15,4) DEFAULT 0,
        valor_unitario DECIMAL(15,4) DEFAULT 0,
        vlrtotal_itens DECIMAL(15,2) DEFAULT 0,
        st DECIMAL(15,2) DEFAULT 0,
        vlr_st DECIMAL(15,2) DEFAULT 0,
        ipi DECIMAL(15,2) DEFAULT 0,
        vlr_ipi DECIMAL(15,2) DEFAULT 0,
        icms DECIMAL(15,2) DEFAULT 0,
        vlr_icms DECIMAL(15,2) DEFAULT 0,
        valor_puxada DECIMAL(15,4) DEFAULT 0,
        total_puxada DECIMAL(15,2) DEFAULT 0,
        desconto1 DECIMAL(15,2) DEFAULT 0,
        desconto2 DECIMAL(15,2) DEFAULT 0,
        cor1 VARCHAR(50),
        cor2 VARCHAR(50),
        obsitemitenspedido TEXT,
        excluido VARCHAR(1) DEFAULT 'N'
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3
    `).catch(err => console.error('Erro ao criar itensped:', err)),

    pool.query(`
      CREATE TABLE IF NOT EXISTS preferencias_grid (
        id INT AUTO_INCREMENT PRIMARY KEY,
        id_usuario INT NOT NULL,
        nome_grid VARCHAR(50) NOT NULL,
        config_json TEXT NOT NULL,
        dt_alterado DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unq_user_grid (id_usuario, nome_grid)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3
    `).catch(err => console.error('Erro ao criar preferencias_grid:', err)),

    pool.query(`
      CREATE TABLE IF NOT EXISTS itensped_grade_qtd (
        id INT AUTO_INCREMENT PRIMARY KEY,
        id_item_ped INT NOT NULL,
        id_descricao_grade INT NOT NULL,
        sequencial INT NOT NULL,
        nome_grade VARCHAR(25) NOT NULL,
        quantidade DECIMAL(15,2) DEFAULT 0,
        INDEX idx_ipg_item (id_item_ped)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3
    `).catch(err => console.error('Erro ao criar itensped_grade_qtd:', err)),

    pool.query(`
      CREATE TABLE IF NOT EXISTS logs_pedidos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        id_pedido INT NOT NULL,
        id_usuario INT NOT NULL,
        acao VARCHAR(100) NOT NULL,
        status_antigo VARCHAR(50),
        status_novo VARCHAR(50),
        detalhes TEXT,
        data_hora DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3
    `).catch(err => console.error('Erro ao criar logs_pedidos:', err)),
  ]);

  // ─── Fase 2: ALTER TABLE por tabela em paralelo ───────────────────────────
  // Dentro de cada async IIFE as operações da mesma tabela ficam sequenciais
  // (MySQL não aceita dois DDL concorrentes na mesma tabela).
  await Promise.all([

    // ── pedidos ──────────────────────────────────────────────────────────────
    (async () => {
      const pedIndexes = [
        { name: 'idx_ped_data', col: 'data_abertura' },
        { name: 'idx_ped_tipo', col: 'tipo_pedido' },
        { name: 'idx_ped_sit',  col: 'situacao_pedido' },
        { name: 'idx_ped_exc',  col: 'excluido' },
        { name: 'idx_ped_user', col: 'id_usuario' },
      ];
      for (const idx of pedIndexes)
        await pool.query(`ALTER TABLE pedidos ADD INDEX ${idx.name} (${idx.col})`).catch(() => {});

      const colsToAdd = [
        { name: 'tipo_pedido',       type: "VARCHAR(50) DEFAULT 'PEDIDO'" },
        { name: 'nome_empresa',      type: 'VARCHAR(100)' },
        { name: 'origem',            type: 'VARCHAR(50)' },
        { name: 'vlrtotalbruto',     type: 'DECIMAL(15,2) DEFAULT 0' },
        { name: 'vlr_total_comissao',type: 'DECIMAL(15,2) DEFAULT 0' },
        { name: 'total_peso',        type: 'DECIMAL(15,4) DEFAULT 0' },
        { name: 'total_qt',          type: 'DECIMAL(15,4) DEFAULT 0' },
        { name: 'vlrtotalitens',     type: 'DECIMAL(15,2) DEFAULT 0' },
        { name: 'qt_parcelas',       type: 'INT DEFAULT 1' },
        { name: 'prazo_pagto',       type: 'VARCHAR(100)' },
        { name: 'nome_transp',       type: 'VARCHAR(100)' },
        { name: 'uf',                type: 'VARCHAR(2)' },
        { name: 'coduser_digitacao', type: 'INT' },
        { name: 'id_empresa',        type: 'INT' },
        { name: 'puxada',            type: "VARCHAR(1) DEFAULT 'N'" },
        { name: 'tipo_documento',    type: 'VARCHAR(20)' },
        { name: 'dataexclusao',      type: 'DATE' },
        { name: 'horaexclusao',      type: 'TIME' },
        { name: 'id_userexclusao',   type: 'INT' },
        { name: 'chave_nfe',              type: 'VARCHAR(44) NULL DEFAULT NULL' },
        { name: 'status_nfe',             type: 'VARCHAR(20) NULL DEFAULT NULL' },
        { name: 'id_preposto',            type: 'INT NULL DEFAULT NULL' },
        { name: 'nome_preposto',          type: 'VARCHAR(150) NULL DEFAULT NULL' },
        { name: 'vlr_comissao_preposto',  type: 'DECIMAL(15,2) NOT NULL DEFAULT 0' },
        { name: 'compartilhacomissao',    type: "VARCHAR(1) DEFAULT 'N'" },
        { name: 'comissaogerente',        type: 'DECIMAL(5,2) DEFAULT 0' },
        { name: 'vlr_comissaonormal',     type: 'DECIMAL(15,2) DEFAULT 0' },
        { name: 'descontos_cascata',      type: 'VARCHAR(200) NULL DEFAULT NULL' },
      ];
      for (const c of colsToAdd)
        await pool.query(`ALTER TABLE pedidos ADD COLUMN ${c.name} ${c.type}`).catch(() => {});

      const colsToResize = [
        { name: 'numero',              type: 'VARCHAR(50)' },
        { name: 'nome_cliente',        type: 'VARCHAR(150)' },
        { name: 'nome_fornecedor',     type: 'VARCHAR(150)' },
        { name: 'nome_transportadora', type: 'VARCHAR(150)' },
        { name: 'nome_vendedor',       type: 'VARCHAR(150)' },
      ];
      for (const c of colsToResize)
        await pool.query(`ALTER TABLE pedidos MODIFY COLUMN ${c.name} ${c.type}`).catch(() => {});

      const indexesPerf = [
        `CREATE INDEX IF NOT EXISTS idx_ped_data_exc ON pedidos (excluido, data_abertura)`,
        `CREATE INDEX IF NOT EXISTS idx_ped_situacao ON pedidos (situacao_pedido)`,
        `CREATE INDEX IF NOT EXISTS idx_ped_tipo     ON pedidos (tipo_pedido)`,
        `CREATE INDEX IF NOT EXISTS idx_ped_usuario  ON pedidos (id_usuario)`,
        `CREATE INDEX IF NOT EXISTS idx_ped_cliente  ON pedidos (cod_cliente)`,
      ];
      for (const idx of indexesPerf)
        await pool.query(idx).catch(() => {});
    })(),

    // ── itensped ─────────────────────────────────────────────────────────────
    (async () => {
      await pool.query(`ALTER TABLE itensped ADD INDEX idx_it_num (numpedido)`).catch(() => {});
      await pool.query(`ALTER TABLE itensped MODIFY COLUMN numpedido VARCHAR(50)`).catch(() => {});
      await pool.query(`ALTER TABLE itensped MODIFY COLUMN unidade VARCHAR(20)`).catch(() => {});
      const itCols = [
        { name: 'sequencia',              type: 'INT DEFAULT 0' },
        { name: 'vlr_unitariosemimposto', type: 'DECIMAL(15,4) DEFAULT 0' },
        { name: 'vlr_totalsemimposto',    type: 'DECIMAL(15,2) DEFAULT 0' },
        { name: 'vlr_descontototal',      type: 'DECIMAL(15,2) DEFAULT 0' },
        { name: 'peso',                   type: 'DECIMAL(15,4) DEFAULT 0' },
        { name: 'multiplo_sigla',         type: 'VARCHAR(20) NULL' },
        { name: 'multiplo_fator',         type: 'DECIMAL(10,4) DEFAULT 1' },
        { name: 'id_grade',               type: 'INT NULL' },
        { name: 'solado',                 type: 'VARCHAR(50) NULL' },
        { name: 'tipo_grade',             type: 'VARCHAR(200) NULL' },
        { name: 'grade_resumo',           type: 'VARCHAR(300) NULL' },
        { name: 'cod_fornecedor',         type: 'INT NULL' },
        { name: 'vlr_padrao',             type: 'DECIMAL(15,4) DEFAULT NULL' },
        { name: 'acrescimo',              type: 'DECIMAL(15,2) DEFAULT 0' },
        { name: 'valor_cliente',          type: 'DECIMAL(15,4) DEFAULT 0' },
        { name: 'vlrtotalcomimposto',     type: 'DECIMAL(15,3) DEFAULT 0' },
        { name: 'obsitem',                type: 'VARCHAR(100) DEFAULT NULL' },
      ];
      for (const c of itCols)
        await pool.query(`ALTER TABLE itensped ADD COLUMN ${c.name} ${c.type}`).catch(() => {});
    })(),

    // ── receber ───────────────────────────────────────────────────────────────
    (async () => {
      const recCols = [
        { name: 'id_pedido',       type: 'INT' },
        { name: 'nome_fornecedor', type: 'VARCHAR(150)' },
        { name: 'forma_pagto',     type: 'VARCHAR(50)' },
        { name: 'excluido',        type: "VARCHAR(1) DEFAULT 'N'" },
      ];
      for (const c of recCols)
        await pool.query(`ALTER TABLE receber ADD COLUMN ${c.name} ${c.type}`).catch(() => {});
    })(),

    // ── pagtocomissao ─────────────────────────────────────────────────────────
    (async () => {
      const pcCols = [
        { name: 'data_pagar',        type: 'DATE NULL DEFAULT NULL' },
        { name: 'data_pagamento',    type: 'DATE NULL DEFAULT NULL' },
        { name: 'data_confirmacao',  type: 'DATETIME NULL DEFAULT NULL' },
        { name: 'status',            type: "VARCHAR(1) DEFAULT 'P'" },
        { name: 'vlr_pago_original', type: 'DECIMAL(15,4) DEFAULT NULL' },
        { name: 'id_preposto',       type: 'INT NULL DEFAULT NULL' },
        { name: 'excluido',          type: "VARCHAR(1) DEFAULT 'N'" },
        { name: 'observacao',        type: 'TEXT NULL' },
      ];
      for (const c of pcCols)
        await pool.query(`ALTER TABLE pagtocomissao ADD COLUMN ${c.name} ${c.type}`).catch(() => {});
      // Índice p/ o DELETE por pedido no salvar de parcelas. Sem ele, cada save
      // fazia full scan da tabela inteira (que cresce sem limite com as comissões).
      await pool.query(`ALTER TABLE pagtocomissao ADD INDEX idx_pc_pedido (pedido)`).catch(() => {});
    })(),

    // ── usuarios (preposto / gerente) ────────────────────────────────────────
    (async () => {
      const uCols = [
        { name: 'tipo_usuario',              type: "VARCHAR(20) NOT NULL DEFAULT 'REPRESENTANTE'" },
        { name: 'comissao_preposto_pct',      type: 'DECIMAL(5,2) NOT NULL DEFAULT 6.00' },
        { name: 'id_gerente',                type: 'INT NULL DEFAULT NULL' },
        { name: 'comissaofixavendedor',       type: 'DECIMAL(5,2) DEFAULT 0' },
        { name: 'comissaogerente',            type: 'DECIMAL(5,2) DEFAULT 0' },
        { name: 'compartilhacomissaogerente', type: "VARCHAR(1) DEFAULT 'N'" },
      ];
      for (const c of uCols)
        await pool.query(`ALTER TABLE usuarios ADD COLUMN ${c.name} ${c.type}`).catch(() => {});
    })(),

    // ── produto/produtos ─────────────────────────────────────────────────────
    (async () => {
      // Índice p/ a subquery qtd_cores (referência mãe) na busca de produtos do
      // pedido. Sem ele, cada produto candidato dispara um full scan da própria
      // tabela produto (DEPENDENT SUBQUERY) — busca levava ~30s em bases legadas.
      await ensureProdutoColunas(pool).catch(() => {});
      const tbProd = await getProdTabela(pool).catch(() => null);
      if (tbProd) {
        await pool.query(`ALTER TABLE \`${tbProd}\` ADD INDEX idx_prod_id_ref (id_referencia)`).catch(() => {});
      }
    })(),

    // ── descricao_grades ──────────────────────────────────────────────────────
    pool.query(`ALTER TABLE descricao_grades ADD COLUMN qtd_minima INT NOT NULL DEFAULT 0`).catch(() => {}),

    // ── tipo_pedidos ─────────────────────────────────────────────────────────
    pool.query(`ALTER TABLE tipo_pedidos ADD COLUMN padrao_vitrine CHAR(1) NOT NULL DEFAULT 'N'`).catch(() => {}),
  ]);
}

// ─── Helper: INSERT itensped (campos alinhados ao legado Delphi) ─────────────
const ITENSPED_INSERT_COLS = [
  'numpedido', 'id_pedido', 'cod_produto', 'cod_fabricante', 'cod_fornecedor',
  'desc_prod', 'unidade', 'kilo_embalagem', 'quantidade', 'vlr_padrao', 'valor_unitario', 'vlrtotal_itens',
  'vlrtotalcomimposto',
  'desconto', 'comissao', 'acrescimo',
  'st', 'vlr_st', 'ipi', 'vlr_ipi', 'icms', 'vlr_icms',
  'valor_puxada', 'valor_cliente', 'total_peso', 'cores', 'obsitem',
  'tipo_pedido', 'id_tipopedido',
  'sequencia', 'vlr_unitariosemimposto', 'vlr_totalsemimposto', 'vlr_descontototal', 'peso',
  'multiplo_sigla', 'multiplo_fator',
  'id_grade', 'solado', 'tipo_grade', 'grade_resumo',
  'tipo_preco', 'id_promocao', 'promocao_descricao',
  'data_inclusao', 'sincronizar', 'excluido',
].join(', ');

function resolveObsitemGravacao(item) {
  if (!item || typeof item !== 'object') return '';
  return String(item.obsitem ?? item.obs_item ?? '').trim().slice(0, 100);
}

/** Leitura: somente itensped.obsitem (campo oficial). */
function resolveObsitemLeitura(row) {
  if (!row || typeof row !== 'object') return '';
  return String(row.obsitem ?? '').trim().slice(0, 100);
}

function sanitizeItensObsitemForSave(itens) {
  if (!Array.isArray(itens)) return itens;
  return itens.map((item) => ({
    ...item,
    obsitem: resolveObsitemGravacao(item),
  }));
}

function _normItemImpostosGravacao(item) {
  const icmsPct = parseFloat(item.icms_percentual ?? item.icms) || 0;
  const base = parseFloat(item.vlrtotal_itens) || 0;
  let vlrIcms = parseFloat(item.vlr_icms);
  if (!Number.isFinite(vlrIcms)) {
    vlrIcms = Math.round(base * icmsPct / 100 * 1000) / 1000;
  }
  let vlrTotalComImp = parseFloat(item.vlrtotal_com_imposto ?? item.vlrtotalcomimposto);
  if (!Number.isFinite(vlrTotalComImp)) {
    // ICMS é "por dentro" (já embutido no preço) — NÃO soma no total c/ imposto (apenas IPI + ST, que são "por fora")
    vlrTotalComImp = Math.round(
      (base + (parseFloat(item.vlr_st) || 0) + (parseFloat(item.vlr_ipi) || 0)) * 1000
    ) / 1000;
  }
  const obsitem = resolveObsitemGravacao(item);
  return { icmsPct, vlrIcms, vlrTotalComImp, obsitem };
}

/** Legado itensped.tipo_preco VARCHAR(10) — promo campanha grava como promo */
function normalizeTipoPrecoItensped(tipo) {
  const t = String(tipo || 'venda').trim().toLowerCase();
  if (t === 'promocao_campanha' || t === 'promo_camp') return 'promo';
  if (t.length > 10) return t.slice(0, 10);
  return t || 'venda';
}

async function _getSomaEmbalagemPedido(conn) {
  const [rows] = await conn.query(
    `SELECT COALESCE(soma_embalagempedido, 'N') AS v FROM sistemas ORDER BY id DESC LIMIT 1`
  ).catch(() => [[{ v: 'N' }]]);
  return rows[0]?.v || 'N';
}

async function _getPesoExibirFornecedor(conn, codFornecedor) {
  if (!codFornecedor) return 'N';
  const [rows] = await conn.query(
    `SELECT COALESCE(peso_exibritelapedidos, 'N') AS v FROM fornecedores WHERE id = ? LIMIT 1`,
    [codFornecedor]
  ).catch(() => [[]]);
  return rows[0]?.v || 'N';
}

/** Cache por DATABASE(): tipograde.modo_grade existe? (evita SHOW COLUMNS a cada save). */
const _tipogradeModoGradeCache = new Map(); // dbName -> boolean
async function _tipogradeTemModoGrade(conn) {
  let dbKey = 'default';
  try {
    const [[r]] = await conn.query('SELECT DATABASE() AS db');
    dbKey = String(r?.db || 'default');
  } catch (_) {}
  if (_tipogradeModoGradeCache.has(dbKey)) return _tipogradeModoGradeCache.get(dbKey);
  const [colModo] = await conn.query(`SHOW COLUMNS FROM tipograde LIKE 'modo_grade'`).catch(() => [[]]);
  const ok = !!(colModo && colModo.length);
  _tipogradeModoGradeCache.set(dbKey, ok);
  return ok;
}

/**
 * Uma passada de queries para validar + normalizar itens no save.
 * Antes: 3 validadores + normalize = vários SELECT sistemas/produto/tipograde repetidos.
 */
async function _carregarContextoItensSave(conn, itens, codFornecedor) {
  const vazios = {
    somaEmb: 'N',
    pesoExibir: 'N',
    gradeOn: false,
    prodMap: new Map(),
    gradeMap: new Map(),
  };
  if (!Array.isArray(itens) || !itens.length) return vazios;

  await _ensureProdCols(conn);
  const tb = await _getProdTabela(conn);
  const ids = [...new Set(itens.map((i) => parseInt(i.cod_produto, 10)).filter(Boolean))];

  const [sisRes, fornRes, prodRes] = await Promise.all([
    conn.query(
      `SELECT COALESCE(habilitapedidograde, 'N') AS habilitapedidograde,
              COALESCE(soma_embalagempedido, 'N') AS soma_embalagempedido
         FROM sistemas ORDER BY id DESC LIMIT 1`
    ).catch(() => [[{}]]),
    codFornecedor
      ? conn.query(
          `SELECT COALESCE(peso_exibritelapedidos, 'N') AS peso_exibir
             FROM fornecedores WHERE id = ? LIMIT 1`,
          [codFornecedor]
        ).catch(() => [[]])
      : Promise.resolve([[]]),
    ids.length
      ? conn.query(
          `SELECT ID, tipograde, descricao,
                  IFNULL(precopeso, 'N') AS precopeso,
                  IFNULL(kilo_embalagem, 0) AS kilo_embalagem,
                  IFNULL(bloquear_desconto, 'N') AS bloquear_desconto,
                  desconto_maximo,
                  IFNULL(multiplo_venda, 1) AS multiplo_venda,
                  IFNULL(qtd_minima_pedido, 0) AS qtd_minima_pedido
             FROM ${tb} WHERE ID IN (?)`,
          [ids]
        ).catch(() => [[]])
      : Promise.resolve([[]]),
  ]);

  const sis = sisRes[0]?.[0] || {};
  const gradeOn = (sis.habilitapedidograde || 'N') === 'S';
  const somaEmb = sis.soma_embalagempedido || 'N';
  const pesoExibir = fornRes[0]?.[0]?.peso_exibir || 'N';
  const prodMap = new Map((prodRes[0] || []).map((p) => [Number(p.ID), p]));

  let gradeMap = new Map();
  if (gradeOn && (await _tipogradeTemModoGrade(conn))) {
    const gradeIds = new Set();
    for (const item of itens) {
      if (item._delete || !item.cod_produto) continue;
      const prod = prodMap.get(parseInt(item.cod_produto, 10));
      const gid = item.id_grade || prod?.tipograde;
      if (gid) gradeIds.add(Number(gid));
    }
    if (gradeIds.size) {
      const [gradeRows] = await conn.query(
        `SELECT id,
                COALESCE(modo_grade, 'A') AS modo_grade,
                COALESCE(multiplo_grade, 0) AS multiplo_grade
           FROM tipograde WHERE id IN (?)`,
        [[...gradeIds]]
      ).catch(() => [[]]);
      gradeMap = new Map((gradeRows || []).map((g) => [String(g.id), g]));
    }
  }

  return { somaEmb, pesoExibir, gradeOn, prodMap, gradeMap };
}

function _validarItensComContexto(itens, ctx) {
  if (!Array.isArray(itens) || !itens.length) return null;
  const erros = [];
  const ativos = itens.filter((i) => !i._delete && i.cod_produto);

  for (const item of ativos) {
    const prod = ctx.prodMap.get(parseInt(item.cod_produto, 10));
    if (prod) {
      const regras = parseRegras(prod);
      const desc = item.desc_prod || item.desc_produto || prod.descricao || 'Item';
      erros.push(...validarQuantidade(item.quantidade, regras, desc));
    }

    if (!ctx.gradeOn) continue;
    const exigeGrade = prod?.tipograde || item.id_grade;
    if (!exigeGrade) continue;
    const somaGrade = (item.grade_qtd || []).reduce((s, g) => s + (parseFloat(g.quantidade) || 0), 0);
    const descG = item.desc_prod || item.desc_produto || prod?.descricao || 'Item';
    if (somaGrade <= 0) {
      erros.push(`«${descG}» exige grade. Informe os tamanhos antes de salvar.`);
      continue;
    }
    const gid = item.id_grade || prod?.tipograde;
    const g = gid ? ctx.gradeMap.get(String(gid)) : null;
    if (!g) continue;
    const total = somaGrade > 0 ? somaGrade : (parseFloat(item.quantidade) || 0);
    erros.push(...validarTotalGradeFechada(total, g.modo_grade, g.multiplo_grade, descG));
  }

  return erros.length ? erros : null;
}

function _aplicarNormalizeItens(itens, ctx) {
  const { somaEmb, pesoExibir, prodMap } = ctx;
  return itens.map((item) => {
    const prod = prodMap.get(parseInt(item.cod_produto, 10));
    const precopeso = item.precopeso || prod?.precopeso || 'N';

    let descontoPct = parseFloat(item.desconto_percentual ?? item.desconto ?? 0) || 0;
    if (prod?.bloquear_desconto === 'S') {
      descontoPct = 0;
    } else if (prod?.desconto_maximo != null) {
      const maxDesc = parseFloat(prod.desconto_maximo) || 0;
      if (descontoPct > maxDesc) descontoPct = maxDesc;
    }
    item = { ...item, desconto_percentual: descontoPct, desconto: descontoPct };
    const embalagem = parseFloat(item.embalagem ?? item.kilo_embalagem) || 0;
    let kiloCat = parseFloat(prod?.kilo_embalagem) || 0;
    if (item.embalagem != null && item.embalagem !== '' && item.kilo_embalagem != null) {
      kiloCat = parseFloat(item.kilo_embalagem) || kiloCat;
    }

    const base = calcBaseItemTotal({
      quantidade: item.quantidade,
      valorUnitario: item.valor_unitario,
      descontoPct: item.desconto_percentual ?? item.desconto ?? 0,
      acrescimoPct: item.acrescimo_percentual ?? item.acrescimo ?? 0,
      embalagem,
      kilo_embalagem: kiloCat,
      precopeso,
      somaEmbalagempedido: somaEmb,
    });

    const vlrtotal = Math.round(base * 100) / 100;
    const stPct = parseFloat(item.st_percentual ?? item.st) || 0;
    const ipiPct = parseFloat(item.ipi_percentual ?? item.ipi) || 0;
    const icmsPct = parseFloat(item.icms_percentual ?? item.icms) || 0;
    const vlrSt = Math.round(vlrtotal * stPct / 100 * 100) / 100;
    const vlrIpi = Math.round(vlrtotal * ipiPct / 100 * 100) / 100;
    const vlrIcms = Math.round(vlrtotal * icmsPct / 100 * 1000) / 1000;
    const vlrComImp = Math.round((vlrtotal + vlrSt + vlrIpi) * 1000) / 1000;

    return {
      ...item,
      desc_prod: resolveDescProdItem(item, prod?.descricao),
      precopeso,
      embalagem,
      vlrtotal_itens: vlrtotal,
      vlr_st: vlrSt,
      vlr_ipi: vlrIpi,
      vlr_icms: vlrIcms,
      vlrtotal_com_imposto: vlrComImp,
      vlrtotalcomimposto: vlrComImp,
      total_peso: calcPesoTotalExibir({
        quantidade: item.quantidade,
        embalagem,
        kilo_embalagem: kiloCat,
        precopeso,
        exibirPeso: pesoExibir,
      }),
    };
  });
}

/** Valida grade/qtd e normaliza totais com um único carregamento de produto/sistemas. */
async function validarENormalizarItensSave(conn, itens, codFornecedor) {
  const sanitized = sanitizeItensObsitemForSave(itens);
  if (!Array.isArray(sanitized) || !sanitized.length) {
    return { erros: null, itensNorm: sanitized };
  }
  const ctx = await _carregarContextoItensSave(conn, sanitized, codFornecedor);
  const erros = _validarItensComContexto(sanitized, ctx);
  if (erros) return { erros, itensNorm: null };
  return { erros: null, itensNorm: _aplicarNormalizeItens(sanitized, ctx) };
}

/** Recalcula total e peso do item (mantido p/ callers avulsos; save usa validarENormalizarItensSave). */
async function _normalizeItensPrecoPeso(conn, itens, codFornecedor) {
  if (!Array.isArray(itens) || !itens.length) return itens;
  const ctx = await _carregarContextoItensSave(conn, itens, codFornecedor);
  return _aplicarNormalizeItens(itens, ctx);
}

function resolveDescProdItem(item, prodDescricao) {
  const raw = item.desc_prod || item.desc_produto || item.descricao || item.descProd || prodDescricao || '';
  const s = String(raw).trim();
  return s ? s.slice(0, 150) : null;
}

function buildItenspedInsertParams(item, ctx) {
  const {
    numpedido, idPedido, codFornecedor, tipoPedido, idTipoPedido, seqItem,
  } = ctx;
  const vlrUnitSemImp = Math.round(
    (item.valor_unitario || 0)
      * (1 + (parseFloat(item.acrescimo_percentual ?? item.acrescimo) || 0) / 100)
      * (1 - (parseFloat(item.desconto_percentual ?? item.desconto) || 0) / 100)
      * 10000
  ) / 10000;
  const descPctSave = parseFloat(item.desconto_percentual ?? item.desconto) || 0;
  const acrPctSave = parseFloat(item.acrescimo_percentual ?? item.acrescimo) || 0;
  const vlrDescTotal = Math.round(
    (item.valor_unitario || 0) * (item.quantidade || 0) * descPctSave / 100 * 100
  ) / 100;
  const pesoItem = item.total_peso || 0;
  const gradeResumo = (item.grade_qtd || [])
    .filter(g => g.quantidade > 0)
    .map(g => `${g.nome_grade}:${g.quantidade}`)
    .join(' ');
  const imp = _normItemImpostosGravacao(item);
  return [
    numpedido, idPedido,
    item.cod_produto, item.cod_fabricante || '', codFornecedor || null,
    resolveDescProdItem(item), item.unidade || '', item.embalagem || 0,
    item.quantidade, nPedidoField(item.vlr_padrao), item.valor_unitario, item.vlrtotal_itens,
    imp.vlrTotalComImp,
    descPctSave, item.comissao_percentual || 0, acrPctSave,
    item.st_percentual || 0, item.vlr_st || 0,
    item.ipi_percentual || 0, item.vlr_ipi || 0,
    imp.icmsPct, imp.vlrIcms,
    item.valor_puxada || 0, nPedidoField(item.valor_cliente), pesoItem,
    item.cores_qt || '', imp.obsitem,
    (tipoPedido || '').toString().toUpperCase() || 'PEDIDO', idTipoPedido || null,
    seqItem + 1, vlrUnitSemImp, item.vlrtotal_itens || 0, vlrDescTotal, parseFloat(item.peso || 0),
    item.multiplo_sigla || null, item.multiplo_fator || 1,
    item.id_grade || null, item.solado || null, item.tipo_grade || null, gradeResumo || null,
    normalizeTipoPrecoItensped(item.tipo_preco),
    parseOptInt(item.id_promocao) || null,
    item.promocao_descricao ? String(item.promocao_descricao).slice(0, 200) : null,
  ];
}

/** Insere todos os itens em batches de até BATCH_SIZE linhas por INSERT para
 *  não estourar o max_allowed_packet do MySQL. Itens com grade_qtd buscam o
 *  id real via SELECT após o INSERT, filtrado por numpedido (evita colisão). */
const ITENSPED_BATCH_SIZE = 100;
const GRADE_QTD_BATCH_SIZE = 500;

async function insertItenspedBatch(conn, itensNorm, ctx) {
  if (!itensNorm.length) return;

  const rows = itensNorm.map((item, i) =>
    buildItenspedInsertParams(item, { ...ctx, seqItem: i })
  );
  // buildItenspedInsertParams retorna 43 params; data_inclusao/sincronizar/excluido são SQL literals
  const phRow = '(' + rows[0].map(() => '?').join(', ') + ", CURDATE(), 'N', 'N')";

  for (let off = 0; off < rows.length; off += ITENSPED_BATCH_SIZE) {
    const chunk = rows.slice(off, off + ITENSPED_BATCH_SIZE);
    await conn.query(
      `INSERT INTO itensped (${ITENSPED_INSERT_COLS}) VALUES ${chunk.map(() => phRow).join(', ')}`,
      chunk.flat()
    );
  }

  // Itens com grade precisam do id real. Filtramos por numpedido (não id_pedido):
  // itensped.id_pedido é varchar quase todo NULL em bases legadas e, recebendo um
  // valor numérico, o MySQL ignora o índice e faz full scan de toda a tabela.
  // numpedido tem índice usável (mesma coluna da soft-delete logo acima) e, como os
  // itens antigos já foram marcados excluido='S', o filtro só retorna os recém-inseridos.
  const hasGrade = itensNorm.some(item => item.grade_qtd?.length > 0);
  if (hasGrade) {
    const [inserted] = await conn.query(
      `SELECT id, sequencia FROM itensped WHERE numpedido = ? AND COALESCE(excluido,'N') = 'N' ORDER BY sequencia`,
      [String(ctx.numpedido)]
    );
    // Map O(1) + INSERT em lote (antes: 1 round-trip SQL por item com grade).
    const bySeq = new Map(inserted.map((r) => [Number(r.sequencia), r.id]));
    const gradeVals = [];
    for (let i = 0; i < itensNorm.length; i++) {
      const item = itensNorm[i];
      if (!item.grade_qtd?.length) continue;
      const itemId = bySeq.get(i + 1);
      if (!itemId) continue;
      for (const g of item.grade_qtd) {
        const qtd = parseFloat(g.quantidade) || 0;
        if (qtd <= 0) continue;
        gradeVals.push([
          itemId,
          g.id_descricao_grade,
          g.sequencial,
          g.nome_grade || '',
          qtd,
        ]);
      }
    }
    for (let off = 0; off < gradeVals.length; off += GRADE_QTD_BATCH_SIZE) {
      const chunk = gradeVals.slice(off, off + GRADE_QTD_BATCH_SIZE);
      await conn.query(
        `INSERT INTO itensped_grade_qtd (id_item_ped, id_descricao_grade, sequencial, nome_grade, quantidade) VALUES ?`,
        [chunk]
      );
    }
  }
}

/** Exclusão lógica dos itens ativos do pedido (não usa DELETE físico em itensped). */
async function softDeleteItenspedByNumPedido(conn, numPedido) {
  if (numPedido == null || numPedido === '') return;
  const num = String(numPedido);
  // Limpa grades dos itens que serão soft-deletados (evita órfãos e inchaço da tabela).
  await conn.query(
    `DELETE ig FROM itensped_grade_qtd ig
     INNER JOIN itensped i ON i.id = ig.id_item_ped
     WHERE i.numpedido = ? AND COALESCE(i.excluido, 'N') = 'N'`,
    [num]
  ).catch(() => {});
  await conn.query(
    `UPDATE itensped SET excluido = 'S' WHERE numpedido = ? AND COALESCE(excluido, 'N') = 'N'`,
    [num]
  );
}

// ─── Helper: grava quantidades de grade em itensped_grade_qtd ───────────────
async function _salvarGradeQtd(conn, itemId, grade_qtd) {
  if (!grade_qtd || !grade_qtd.length) return;
  const vals = grade_qtd
    .filter(g => parseFloat(g.quantidade) > 0)
    .map(g => [itemId, g.id_descricao_grade, g.sequencial, g.nome_grade || '', parseFloat(g.quantidade) || 0]);
  if (!vals.length) return;
  await conn.query(
    `INSERT INTO itensped_grade_qtd (id_item_ped, id_descricao_grade, sequencial, nome_grade, quantidade) VALUES ?`,
    [vals]
  );
}

/** @deprecated Preferir validarENormalizarItensSave (uma passada de queries). */
async function validarItensGradeObrigatoria(conn, itens) {
  const ctx = await _carregarContextoItensSave(conn, itens || [], null);
  if (!ctx.gradeOn) return null;
  const erros = [];
  for (const item of itens || []) {
    if (item._delete) continue;
    const prod = ctx.prodMap.get(parseInt(item.cod_produto, 10));
    const exigeGrade = prod?.tipograde || item.id_grade;
    if (!exigeGrade) continue;
    const somaGrade = (item.grade_qtd || []).reduce((s, g) => s + (parseFloat(g.quantidade) || 0), 0);
    if (somaGrade <= 0) {
      erros.push(`«${item.desc_prod || item.desc_produto || 'Item'}» exige grade. Informe os tamanhos antes de salvar.`);
    }
  }
  return erros.length ? erros : null;
}

/** @deprecated Preferir validarENormalizarItensSave. */
async function validarItensGradeFechada(conn, itens) {
  const ctx = await _carregarContextoItensSave(conn, itens || [], null);
  if (!ctx.gradeOn || !ctx.gradeMap.size) return null;
  const erros = [];
  for (const item of (itens || []).filter((i) => !i._delete && i.cod_produto)) {
    const prod = ctx.prodMap.get(parseInt(item.cod_produto, 10));
    const gid = item.id_grade || prod?.tipograde;
    if (!gid) continue;
    const g = ctx.gradeMap.get(String(gid));
    if (!g) continue;
    const somaGrade = (item.grade_qtd || []).reduce((s, x) => s + (parseFloat(x.quantidade) || 0), 0);
    const total = somaGrade > 0 ? somaGrade : (parseFloat(item.quantidade) || 0);
    const desc = item.desc_prod || item.desc_produto || 'Item';
    erros.push(...validarTotalGradeFechada(total, g.modo_grade, g.multiplo_grade, desc));
  }
  return erros.length ? erros : null;
}

/** @deprecated Preferir validarENormalizarItensSave. */
async function validarItensQtdRegras(conn, itens) {
  const ctx = await _carregarContextoItensSave(conn, itens || [], null);
  const erros = [];
  for (const item of (itens || []).filter((i) => !i._delete && i.cod_produto)) {
    const prod = ctx.prodMap.get(parseInt(item.cod_produto, 10));
    if (!prod) continue;
    const regras = parseRegras(prod);
    const desc = item.desc_prod || item.desc_produto || prod.descricao || 'Item';
    erros.push(...validarQuantidade(item.quantidade, regras, desc));
  }
  return erros.length ? erros : null;
}

// ─── Helper: grava parcelas na tabela receber ────────────────────────────────
function _parsePedidoDate(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  // Evita "2026-05-29T03:00:00.000Z" + "T12:00:00" → data inválida → NaN no prazo
  const d = new Date(/\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00` : s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Coluna DATE no MySQL — não aceita ISO com Z; normaliza para YYYY-MM-DD. */
function _toMysqlDate(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  const head = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s]|$)/);
  if (head) return head[1];
  const d = _parsePedidoDate(s);
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Calcula comissão no backend — cascata Fornecedor → Produto → Vendedor → Preposto, ajustando IPI/ST
async function _calcComissaoBackend(conn, codFornecedor, idUsuario, itens, idPreposto) {
  // Todas as queries independentes em paralelo
  const [fornRes, vendRes, prepFornRes, prepUserRes] = await Promise.all([
    codFornecedor
      ? conn.query(
          `SELECT COALESCE(comissao,0) AS comissao,
                  COALESCE(com_sobre_ipi,'S') AS com_sobre_ipi,
                  COALESCE(com_sobre_st,'S')  AS com_sobre_st
           FROM fornecedores WHERE id = ? LIMIT 1`,
          [codFornecedor]
        ).catch(() => [[]])
      : Promise.resolve([[]]),
    idUsuario
      ? conn.query(
          `SELECT COALESCE(comissaofixavendedor,0)        AS comissaofixavendedor,
                  COALESCE(comissaogerente,0)              AS comissaogerente,
                  COALESCE(compartilhacomissaogerente,'N') AS compartilhacomissaogerente
           FROM usuarios WHERE idusuario = ? LIMIT 1`,
          [idUsuario]
        ).catch(() => [[]])
      : Promise.resolve([[]]),
    (idPreposto && codFornecedor)
      ? conn.query(
          `SELECT pct_comissao FROM preposto_comissao_fornecedor WHERE id_usuario = ? AND id_fornecedor = ? LIMIT 1`,
          [idPreposto, codFornecedor]
        ).catch(() => [[]])
      : Promise.resolve([[]]),
    idPreposto
      ? conn.query(
          `SELECT COALESCE(comissao_preposto_pct,6) AS pct, nomeusu AS nome
           FROM usuarios WHERE idusuario = ? LIMIT 1`,
          [idPreposto]
        ).catch(() => [[]])
      : Promise.resolve([[]]),
  ]);

  let forn = { comissao: 0, com_sobre_ipi: 'S', com_sobre_st: 'S' };
  if (fornRes[0]?.[0]) Object.assign(forn, fornRes[0][0]);

  let vend = { comissaofixavendedor: 0, comissaogerente: 0, compartilhacomissaogerente: 'N' };
  if (vendRes[0]?.[0]) Object.assign(vend, vendRes[0][0]);

  const totalIpi = (itens || []).reduce((s, i) => s + (parseFloat(i.vlr_ipi) || 0), 0);
  const totalSt  = (itens || []).reduce((s, i) => s + (parseFloat(i.vlr_st)  || 0), 0);
  let base = (itens || []).reduce((s, i) => s + (parseFloat(i.vlrtotal_itens) || 0), 0);
  if (forn.com_sobre_ipi === 'S') base += totalIpi;
  if (forn.com_sobre_st  === 'S') base += totalSt;

  let pct = parseFloat(forn.comissao) || 0;
  let origLabel = 'FORNECEDOR';

  if (!pct) {
    origLabel = 'PRODUTO';
    const baseItems = (itens || []).reduce((s, i) => s + (parseFloat(i.vlrtotal_itens) || 0), 0);
    if (baseItems > 0)
      pct = (itens || []).reduce((s, i) =>
        s + ((parseFloat(i.comissao_percentual) || 0) * (parseFloat(i.vlrtotal_itens) || 0)), 0) / baseItems;
  }

  if (!pct) {
    origLabel = 'VENDEDOR';
    pct = parseFloat(vend.comissaofixavendedor) || 0;
  }

  const vlrNormal   = Math.round(base * pct / 100 * 100) / 100;
  const compartilha = vend.compartilhacomissaogerente === 'S';
  const pctGerente  = compartilha ? (parseFloat(vend.comissaogerente) || 0) : 0;
  const vlrGerente  = Math.round(vlrNormal * pctGerente / 100 * 100) / 100;

  let vlrComissaoPreposto = 0;
  let nomePreposto = null;
  if (idPreposto) {
    let pctPrep = parseFloat(prepFornRes[0]?.[0]?.pct_comissao) || 0;
    const prepUser = prepUserRes[0]?.[0];
    if (prepUser) {
      nomePreposto = prepUser.nome || null;
      if (!pctPrep) pctPrep = parseFloat(prepUser.pct) || 6;
      vlrComissaoPreposto = Math.round(base * pctPrep / 100 * 100) / 100;
    }
  }

  return {
    comissao:               Math.round(pct * 100) / 100,
    vlrcomissao:            vlrNormal,
    vlr_comissaonormal:     vlrNormal,
    vlr_total_comissao:     Math.round((vlrNormal - vlrGerente) * 100) / 100,
    comissaogerente:        pctGerente,
    compartilhacomissao:    compartilha ? 'S' : 'N',
    origem_comissao:        origLabel,
    vlr_comissao_preposto:  vlrComissaoPreposto,
    _nome_preposto:         nomePreposto,
  };
}

async function salvarParcelas(conn, num, pedidoId, pedido, parcelas) {
  if (!parcelas || !parcelas.length) return;

  const dataBase = pedido.data_abertura || hojeIsoBrasil();
  const pctGerenteFromPedido = parseFloat(pedido.comissaogerente) || 0;
  const compartilhaGerente = String(pedido.compartilhacomissao || '').toUpperCase() === 'S';

  // Deletes + queries de setup agrupados. Obs.: numa única conexão o mysql2
  // serializa as queries (sem paralelismo de rede real), então só incluímos
  // aqui o que SEMPRE é necessário — o SUM de IPI/ST fica condicional abaixo.
  const [, , fcRes, grRes] = await Promise.all([
    conn.query(
      `DELETE FROM pagtocomissao WHERE pedido = ? AND status IN ('P','I') AND COALESCE(excluido,'N') = 'N'`,
      [num]
    ).catch(() => {}),
    conn.query(`DELETE FROM receber WHERE numero = ? AND id_pedido = ?`, [num, pedidoId]).catch(() => {}),
    pedido.cod_fornecedor
      ? conn.query(
          `SELECT COALESCE(com_sobre_ipi,'S') AS com_sobre_ipi,
                  COALESCE(com_sobre_st,'S') AS com_sobre_st,
                  COALESCE(com_tipo,'PARCELADA') AS com_tipo
           FROM fornecedores WHERE id = ? LIMIT 1`,
          [pedido.cod_fornecedor]
        ).catch(() => [[]])
      : Promise.resolve([[]]),
    (compartilhaGerente && pctGerenteFromPedido > 0 && pedido.id_usuario)
      ? conn.query(
          `SELECT id_gerente FROM usuarios WHERE idusuario = ? LIMIT 1`,
          [pedido.id_usuario]
        ).catch(() => [[]])
      : Promise.resolve([[]]),
  ]);

  let fornConfig = { com_sobre_ipi: 'S', com_sobre_st: 'S', com_tipo: 'PARCELADA' };
  if (fcRes[0]?.[0]) Object.assign(fornConfig, fcRes[0][0]);

  const totalParcelas = parcelas.reduce((s, p) => s + (p.valor || 0), 0);
  // SUM de IPI/ST só importa quando a comissão NÃO incide sobre eles — no caso
  // comum (ambos 'S') pulamos este round trip por completo.
  let totalIpi = 0, totalSt = 0;
  if (fornConfig.com_sobre_ipi !== 'S' || fornConfig.com_sobre_st !== 'S') {
    // numpedido (string) usa índice; id_pedido (varchar quase todo NULL) faria full scan.
    const [impos] = await conn.query(
      `SELECT COALESCE(SUM(vlr_ipi),0) AS ipi, COALESCE(SUM(vlr_st),0) AS st
       FROM itensped WHERE numpedido = ? AND COALESCE(excluido, 'N') = 'N'`,
      [String(num)]
    ).catch(() => [[{ ipi: 0, st: 0 }]]);
    totalIpi = parseFloat(impos[0]?.ipi || 0);
    totalSt  = parseFloat(impos[0]?.st  || 0);
  }

  let idGerente = null;
  if (compartilhaGerente && pctGerenteFromPedido > 0) {
    idGerente = grRes[0]?.[0]?.id_gerente ? parseInt(grRes[0][0].id_gerente) : null;
  }

  // Busca % do preposto uma única vez (vale para todas as parcelas)
  const idPrep = pedido.id_preposto ? parseInt(pedido.id_preposto) : null;
  let pctPrepGlobal = 0;
  if (idPrep) {
    const [prepFornRes2, prepUserRes2] = await Promise.all([
      pedido.cod_fornecedor
        ? conn.query(
            `SELECT pct_comissao FROM preposto_comissao_fornecedor WHERE id_usuario = ? AND id_fornecedor = ? LIMIT 1`,
            [idPrep, pedido.cod_fornecedor]
          ).catch(() => [[]])
        : Promise.resolve([[]]),
      conn.query(
        `SELECT COALESCE(comissao_preposto_pct,6) AS pct FROM usuarios WHERE idusuario = ? LIMIT 1`,
        [idPrep]
      ).catch(() => [[]]),
    ]);
    pctPrepGlobal = parseFloat(prepFornRes2[0]?.[0]?.pct_comissao) || 0;
    if (!pctPrepGlobal) pctPrepGlobal = parseFloat(prepUserRes2[0]?.[0]?.pct || 6);
  }

  let comUnicaTotal = 0, comUnicaVenc = null;
  let comUnicaPrepTotal = 0, comUnicaPrepVenc = null;
  let comUnicaGerenteTotal = 0, comUnicaGerenteVenc = null;
  // ────────────────────────────────────────────────────────────────────────────

  for (let i = 0; i < parcelas.length; i++) {
    const parc    = parcelas[i];
    const numParc = i + 1;
    let prazo = 0;
    if (parc.vencimento) {
      const d1 = _parsePedidoDate(dataBase);
      const d2 = _parsePedidoDate(parc.vencimento);
      if (d1 && d2) prazo = Math.round((d2 - d1) / 86400000);
    }
    if (!Number.isFinite(prazo)) prazo = 0;
    const vencMysql = _toMysqlDate(parc.vencimento);
    // Salvar parcela no receber
    const [recRes] = await conn.query(`
      INSERT INTO receber
        (numero, tipo, prazo, vencimento, valor, parcela, status, doc,
         qt_parcelas, tipo_lancamento, cod_fornecedor, nome_fornecedor,
         comissao, id_pedido, vlrreceber, forma_pagto, excluido)
      VALUES (?, 'VENDA', ?, ?, ?, ?, 'A RECEBER', ?,
              ?, '', ?, ?, ?, ?, ?, ?, 'N')
    `, [
      num, prazo, vencMysql, parc.valor || 0, numParc,
      'R' + num + numParc,
      parcelas.length,
      pedido.cod_fornecedor || null,
      (pedido.nome_fornecedor || '').toUpperCase(),
      pedido.comissao || 0,
      pedidoId,
      parc.valor || 0,
      (parc.forma_pagto || '').toUpperCase()
    ]);

    const idParcela = recRes.insertId;

    // Gerar Provisão de Comissão — base ajustada conforme regras do fornecedor
    let baseComissao = parc.valor || 0;
    if (totalParcelas > 0 && (fornConfig.com_sobre_ipi !== 'S' || fornConfig.com_sobre_st !== 'S')) {
      const prop = baseComissao / totalParcelas;
      if (fornConfig.com_sobre_ipi !== 'S') baseComissao -= totalIpi * prop;
      if (fornConfig.com_sobre_st  !== 'S') baseComissao -= totalSt  * prop;
      if (baseComissao < 0) baseComissao = 0;
    }
    const vlrComissao = baseComissao * (pedido.comissao / 100);
    if (vlrComissao > 0) {
      if (fornConfig.com_tipo === 'UNICA') {
        comUnicaTotal += vlrComissao;
        if (!comUnicaVenc) comUnicaVenc = vencMysql;
      } else {
        await conn.query(`
          INSERT INTO pagtocomissao
          (data_lancamento, data_movimento, data_pagar, data_pagamento, data_confirmacao, vlr_pago, vlr_pago_original, cod_user, pedido, id_parcela, status, observacao)
          VALUES (CURDATE(), CURDATE(), ?, ?, CURDATE(), ?, ?, ?, ?, ?, 'P', 'Provisão gerada automaticamente pelo pedido')
        `, [vencMysql, vencMysql, vlrComissao, vlrComissao, pedido.id_usuario, num, idParcela]);
      }
    }

    // Comissão do preposto (proporcional à parcela) — % resolvido fora do loop
    if (idPrep) {
      const pctPrep = pctPrepGlobal;
      const vlrPrep = Math.round(baseComissao * pctPrep / 100 * 100) / 100;
      if (vlrPrep > 0) {
        if (fornConfig.com_tipo === 'UNICA') {
          comUnicaPrepTotal = (comUnicaPrepTotal || 0) + vlrPrep;
          if (!comUnicaPrepVenc) comUnicaPrepVenc = vencMysql;
        } else {
          await conn.query(`
            INSERT INTO pagtocomissao
            (data_lancamento, data_movimento, data_pagar, data_pagamento, data_confirmacao, vlr_pago, vlr_pago_original, cod_user, id_preposto, pedido, id_parcela, status, observacao)
            VALUES (CURDATE(), CURDATE(), ?, ?, CURDATE(), ?, ?, ?, ?, ?, ?, 'P', 'Comissão preposto gerada automaticamente')
          `, [vencMysql, vencMysql, vlrPrep, vlrPrep, pedido.id_usuario, idPrep, num, idParcela]);
        }
      }
    }

    // Comissão do gerente (override — recebe % sobre a comissão do vendedor)
    if (idGerente && vlrComissao > 0 && pctGerenteFromPedido > 0) {
      const vlrGerente = Math.round(vlrComissao * pctGerenteFromPedido / 100 * 100) / 100;
      if (vlrGerente > 0) {
        if (fornConfig.com_tipo === 'UNICA') {
          comUnicaGerenteTotal += vlrGerente;
          if (!comUnicaGerenteVenc) comUnicaGerenteVenc = vencMysql;
        } else {
          await conn.query(`
            INSERT INTO pagtocomissao
            (data_lancamento, data_movimento, data_pagar, data_pagamento, data_confirmacao, vlr_pago, vlr_pago_original, cod_user, pedido, id_parcela, status, observacao)
            VALUES (CURDATE(), CURDATE(), ?, ?, CURDATE(), ?, ?, ?, ?, ?, 'P', 'Comissão gerente gerada automaticamente')
          `, [vencMysql, vencMysql, vlrGerente, vlrGerente, idGerente, num, idParcela]);
        }
      }
    }
  }
  // Comissão parcela única — uma entrada para o total após o loop
  if (fornConfig.com_tipo === 'UNICA' && comUnicaTotal > 0) {
    await conn.query(`
      INSERT INTO pagtocomissao
      (data_lancamento, data_movimento, data_pagar, data_pagamento, data_confirmacao, vlr_pago, vlr_pago_original, cod_user, pedido, id_parcela, status, observacao)
      VALUES (CURDATE(), CURDATE(), ?, ?, CURDATE(), ?, ?, ?, ?, NULL, 'P', 'Comissão única gerada automaticamente pelo pedido')
    `, [comUnicaVenc, comUnicaVenc, comUnicaTotal, comUnicaTotal, pedido.id_usuario, num]);
  }
  if (fornConfig.com_tipo === 'UNICA' && comUnicaPrepTotal > 0) {
    await conn.query(`
      INSERT INTO pagtocomissao
      (data_lancamento, data_movimento, data_pagar, data_pagamento, data_confirmacao, vlr_pago, vlr_pago_original, cod_user, id_preposto, pedido, id_parcela, status, observacao)
      VALUES (CURDATE(), CURDATE(), ?, ?, CURDATE(), ?, ?, ?, ?, ?, NULL, 'P', 'Comissão única preposto gerada automaticamente')
    `, [comUnicaPrepVenc, comUnicaPrepVenc, comUnicaPrepTotal, comUnicaPrepTotal, pedido.id_usuario, pedido.id_preposto, num]);
  }
  if (fornConfig.com_tipo === 'UNICA' && comUnicaGerenteTotal > 0 && idGerente) {
    await conn.query(`
      INSERT INTO pagtocomissao
      (data_lancamento, data_movimento, data_pagar, data_pagamento, data_confirmacao, vlr_pago, vlr_pago_original, cod_user, pedido, id_parcela, status, observacao)
      VALUES (CURDATE(), CURDATE(), ?, ?, CURDATE(), ?, ?, ?, ?, NULL, 'P', 'Comissão única gerente gerada automaticamente')
    `, [comUnicaGerenteVenc, comUnicaGerenteVenc, comUnicaGerenteTotal, comUnicaGerenteTotal, idGerente, num]);
  }
}

// GET /api/pedidos/lookups — Vendedores, Fábricas, Clientes
router.get('/lookups', async (req, res) => {
  try {
    const pool = getPool();

    const vendedores = await listVendedoresVisiveis(pool, req, { pix: true });
    const [fornecedores] = await pool.query("SELECT id as id, nome as nome FROM fornecedores WHERE (excluido='N' OR excluido IS NULL) AND COALESCE(tipo, 'FABRICA') = 'FABRICA' ORDER BY nome");

    const prepCtxLk = await getPrepostoContext(pool, req);
    const vendCli = buildClienteVendedorWhere(req.user, '', prepCtxLk);
    const qClientes = `SELECT id as id, nome as nome FROM clientes WHERE (excluido='N' OR excluido IS NULL)${vendCli.clause} ORDER BY nome`;
    const [clientes] = await pool.query(qClientes, vendCli.params);

    res.json({ vendedores, fornecedores, clientes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pedidos — Com Busca e Paginação
router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    ensureTablesOnce(pool); // fire-and-forget: runMigrations já criou as tabelas no login

    const {
      q, page = 1, limit = 50, status, tipo, dt_ini, dt_fim, id_vendedor,
      min_total, max_total, min_peso, max_peso,
      comprador, ped_compras, nome_transp, origem, nome_empresa,
      cod_cliente, id_cliente, cod_fornecedor, id_fornecedor,
      sort = 'p.id', dir = 'DESC',
      lat, lng, raio = 50,
      retorno,
      gerafinanceiro
    } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // ── Visibilidade por perfil (mesma regra em alertas/KPIs de retorno) ─────
    const vis = await buildPedidosListVisWhere(pool, req);
    const visWhere = vis.clause;
    const visParams = vis.params;

    // ─── WHERE CLAUSE PARA A LISTA (Todos os filtros) ────────────────────────
    let whereClause = `WHERE (p.excluido = 'N' OR p.excluido IS NULL OR p.excluido = '')${visWhere}`;
    let params = [...visParams];

    // ─── WHERE CLAUSE PARA OS CARDS (Ignora o filtro de tipo/status clicado) ──
    let whereClauseCards = `WHERE (p.excluido = 'N' OR p.excluido IS NULL OR p.excluido = '')${visWhere}`;
    let paramsCards = [...visParams];
    
    if (q) {
      const qp = ` AND (p.numero LIKE ? OR p.nome_cliente LIKE ?)`;
      whereClause += qp; whereClauseCards += qp;
      params.push(`%${q}%`, `%${q}%`); paramsCards.push(`%${q}%`, `%${q}%`);
    }

    const addFilter = (col, val) => {
      whereClause += ` AND ${col} = ?`; whereClauseCards += ` AND ${col} = ?`;
      params.push(val); paramsCards.push(val);
    };

    if (cod_cliente) addFilter('p.cod_cliente', cod_cliente);
    if (id_cliente) addFilter('p.id_cliente', id_cliente);
    if (cod_fornecedor) addFilter('p.cod_fornecedor', cod_fornecedor);
    if (id_fornecedor) addFilter('p.id_fornecedor', id_fornecedor);

    if (status && status !== '' && status !== 'todos') {
      // 'PENDENTE' é sinônimo de 'ENTREGAR' nesta base (legado) — ver CLAUDE.md
      const statusValues = status === 'PENDENTE' ? ['PENDENTE', 'ENTREGAR'] : [status];
      const statusPh = statusValues.map(() => '?').join(',');
      whereClause += ` AND p.situacao_pedido IN (${statusPh})`;
      params.push(...statusValues);
      // Mantemos nos cards também para os status básicos (Pendente/Aprovado/Cancelado)
      whereClauseCards += ` AND p.situacao_pedido IN (${statusPh})`;
      paramsCards.push(...statusValues);
    }

    if (tipo && tipo !== '' && tipo !== 'ALL') {
      const tNorm = String(tipo).toUpperCase().replace(/Ç/g, 'C').replace(/\s/g, '');
      if (tNorm.includes('ORCAMENTO') || tNorm.includes('ORCA')) {
        whereClause += ` AND UPPER(REPLACE(REPLACE(REPLACE(COALESCE(p.tipo_pedido,''), 'Ç', 'C'), 'Ã', 'A'), ' ', '')) LIKE '%ORCAMENTO%'`;
      } else {
        whereClause += ` AND p.tipo_pedido = ?`;
        params.push(tipo);
      }
      // NOTA: NÃO adicionamos o filtro de tipo em whereClauseCards para os cards não sumirem!
    }

    if (dt_ini) {
      whereClause += ` AND DATE(p.data_abertura) >= ?`; whereClauseCards += ` AND DATE(p.data_abertura) >= ?`;
      params.push(dt_ini); paramsCards.push(dt_ini);
    }
    if (dt_fim) {
      whereClause += ` AND DATE(p.data_abertura) <= ?`; whereClauseCards += ` AND DATE(p.data_abertura) <= ?`;
      params.push(dt_fim); paramsCards.push(dt_fim);
    }

    if (retorno && ['hoje', 'atrasado', 'semana'].includes(String(retorno))) {
      await ensurePedidoRetornoColumns(pool);
      const hojeBr = hojeIsoBrasil();
      const abertosRet = ` AND p.data_retorno IS NOT NULL AND COALESCE(p.situacao_pedido,'') NOT IN ('CANCELADO','FATURADO')`;
      whereClause += abertosRet;
      whereClauseCards += abertosRet;
      if (retorno === 'hoje') {
        whereClause += ` AND p.data_retorno = ?`;
        whereClauseCards += ` AND p.data_retorno = ?`;
        params.push(hojeBr); paramsCards.push(hojeBr);
      } else if (retorno === 'atrasado') {
        whereClause += ` AND p.data_retorno < ?`;
        whereClauseCards += ` AND p.data_retorno < ?`;
        params.push(hojeBr); paramsCards.push(hojeBr);
      } else if (retorno === 'semana') {
        const fimSem = addDaysIsoBrasil(7);
        whereClause += ` AND p.data_retorno BETWEEN ? AND ?`;
        whereClauseCards += ` AND p.data_retorno BETWEEN ? AND ?`;
        params.push(hojeBr, fimSem); paramsCards.push(hojeBr, fimSem);
      }
    }

    const gfFiltro = String(gerafinanceiro || '').toUpperCase();
    const {
      ensureTipoPedidosColumns,
      tipoPedidosJoinSql,
      geraFinanceiroExprSql,
    } = require('../config/pedido-gerafinanceiro');
    const geraFinExpr = geraFinanceiroExprSql('p', 'tp');

    let joinFilterClause = '';
    if (lat && lng) {
      joinFilterClause = 'LEFT JOIN clientes c ON p.cod_cliente = c.id';
      const haversine = `(6371 * acos(cos(radians(?)) * cos(radians(c.latitude)) * cos(radians(c.longitude) - radians(?)) + sin(radians(?)) * sin(radians(c.latitude))))`;
      whereClause += ` AND ${haversine} <= ?`;
      whereClauseCards += ` AND ${haversine} <= ?`;
      const latFloat = parseFloat(lat);
      const lngFloat = parseFloat(lng);
      const raioFloat = parseFloat(raio);
      params.push(latFloat, lngFloat, latFloat, raioFloat);
      paramsCards.push(latFloat, lngFloat, latFloat, raioFloat);
    }

    if (gfFiltro === 'S' || gfFiltro === 'N') {
      await ensureTipoPedidosColumns(pool);
      if (!joinFilterClause.includes('tipo_pedidos')) {
        joinFilterClause += ' ' + tipoPedidosJoinSql('p', 'tp');
      }
      whereClause += ` AND ${geraFinExpr} = ?`;
      params.push(gfFiltro);
    }

    const idVendFiltro = await resolveVendedorIdForFilter(pool, req, id_vendedor);
    if (idVendFiltro) addFilter('p.id_usuario', idVendFiltro);

    // Filtros de Faixa
    if (min_total) { whereClause += ` AND p.vlrtotalpedido >= ?`; whereClauseCards += ` AND p.vlrtotalpedido >= ?`; params.push(parseFloat(min_total)); paramsCards.push(parseFloat(min_total)); }
    if (max_total) { whereClause += ` AND p.vlrtotalpedido <= ?`; whereClauseCards += ` AND p.vlrtotalpedido <= ?`; params.push(parseFloat(max_total)); paramsCards.push(parseFloat(max_total)); }
    if (min_peso)  { whereClause += ` AND p.total_peso >= ?`; whereClauseCards += ` AND p.total_peso >= ?`; params.push(parseFloat(min_peso)); paramsCards.push(parseFloat(min_peso)); }
    if (max_peso)  { whereClause += ` AND p.total_peso <= ?`; whereClauseCards += ` AND p.total_peso <= ?`; params.push(parseFloat(max_peso)); paramsCards.push(parseFloat(max_peso)); }

    // Filtros de Texto Específicos
    if (comprador)   { whereClause += ` AND p.comprador LIKE ?`; whereClauseCards += ` AND p.comprador LIKE ?`; params.push(`%${comprador}%`); paramsCards.push(`%${comprador}%`); }
    if (ped_compras) { whereClause += ` AND p.ped_compras LIKE ?`; whereClauseCards += ` AND p.ped_compras LIKE ?`; params.push(`%${ped_compras}%`); paramsCards.push(`%${ped_compras}%`); }
    if (nome_transp) { whereClause += ` AND p.nome_transp LIKE ?`; whereClauseCards += ` AND p.nome_transp LIKE ?`; params.push(`%${nome_transp}%`); paramsCards.push(`%${nome_transp}%`); }
    if (origem)      { whereClause += ` AND p.origem = ?`; whereClauseCards += ` AND p.origem = ?`; params.push(origem); paramsCards.push(origem); }
    if (nome_empresa){ whereClause += ` AND p.nome_empresa LIKE ?`; whereClauseCards += ` AND p.nome_empresa LIKE ?`; params.push(`%${nome_empresa}%`); paramsCards.push(`%${nome_empresa}%`); }
    
    // COUNT e stats em paralelo para não esperar um pelo outro
    const _countPromise = pool.query(
      `SELECT COUNT(p.id) as total FROM pedidos p ${joinFilterClause} ${whereClause}`, params
    ).catch(e => { console.error('Erro ao contar pedidos:', e.message); return [[{ total: 0 }]]; });

    // Contagem dinâmica por status — pega QUALQUER valor que exista em situacao_pedido,
    // não só os 5 conhecidos. Assim status novos aparecem na faixa de filtro sem precisar
    // alterar código depois (ENTREGAR é tratado como sinônimo de PENDENTE).
    const _statusCountsPromise = pool.query(`
        SELECT
          CASE WHEN p.situacao_pedido IN ('PENDENTE','ENTREGAR') THEN 'PENDENTE'
               ELSE COALESCE(p.situacao_pedido, 'SEM_STATUS') END as situacao,
          COUNT(p.id) as total
        FROM pedidos p
        ${joinFilterClause}
        ${whereClauseCards}
        GROUP BY situacao
      `, paramsCards).catch(() => [[]]);

    const _statsPromise = pool.query(`
        SELECT
          tipo_pedido,
          COUNT(p.id) as total,
          SUM(p.vlrtotalpedido) as vlr_total,
          COUNT(CASE WHEN p.situacao_pedido IN ('PENDENTE','ENTREGAR') THEN 1 END) as pendentes,
          COUNT(CASE WHEN p.situacao_pedido = 'APROVADO' THEN 1 END) as aprovados,
          COUNT(CASE WHEN p.situacao_pedido = 'ENVIADO' THEN 1 END) as enviados,
          COUNT(CASE WHEN p.situacao_pedido = 'CANCELADO' THEN 1 END) as cancelados,
          COUNT(CASE WHEN p.situacao_pedido = 'FATURADO' THEN 1 END) as faturados
        FROM pedidos p
        ${joinFilterClause}
        ${whereClauseCards}
        GROUP BY tipo_pedido
      `, paramsCards).catch(() => null);

    const [[countRows], _tsRaw, [statusCountRows]] = await Promise.all([_countPromise, _statsPromise, _statusCountsPromise]);
    let totalItems = (countRows && countRows[0]) ? countRows[0].total : 0;

    const statusCounts = {};
    for (const r of (statusCountRows || [])) statusCounts[r.situacao] = Number(r.total) || 0;

    let statsRows = [{ total: 0, vlr_total: 0, pendentes: 0, aprovados: 0, enviados: 0, cancelados: 0 }];
    let typeStats = [];
    try {
      const ts = _tsRaw ? _tsRaw[0] : null;
      
      typeStats = Array.isArray(ts) ? ts : [];
      if (typeStats.length > 0) {
        statsRows = [{
          total:     typeStats.reduce((s,r) => s + Number(r.total || 0), 0),
          vlr_total: typeStats.reduce((s,r) => s + Number(r.vlr_total || 0), 0),
          pendentes:  typeStats.reduce((s,r) => s + Number(r.pendentes  || 0), 0),
          aprovados:  typeStats.reduce((s,r) => s + Number(r.aprovados  || 0), 0),
          enviados:   typeStats.reduce((s,r) => s + Number(r.enviados   || 0), 0),
          cancelados: typeStats.reduce((s,r) => s + Number(r.cancelados || 0), 0),
          faturados:  typeStats.reduce((s,r) => s + Number(r.faturados  || 0), 0),
        }];
      } else {
        const [fb] = await pool.query(`
          SELECT COUNT(p.id) as total, SUM(p.vlrtotalpedido) as vlr_total,
                 COUNT(CASE WHEN p.situacao_pedido IN ('PENDENTE','ENTREGAR') THEN 1 END) as pendentes,
                 COUNT(CASE WHEN p.situacao_pedido = 'APROVADO' THEN 1 END) as aprovados,
                 COUNT(CASE WHEN p.situacao_pedido = 'ENVIADO' THEN 1 END) as enviados,
                 COUNT(CASE WHEN p.situacao_pedido = 'CANCELADO' THEN 1 END) as cancelados
          FROM pedidos p ${joinFilterClause} ${whereClauseCards}
        `, paramsCards);
        statsRows = (fb && fb.length > 0) ? fb : statsRows;
        if (typeStats.length === 0 && statsRows[0]) {
          typeStats = [{ tipo_pedido: 'PEDIDO', total: statsRows[0].total, vlr_total: statsRows[0].vlr_total }];
        }
      }
    } catch (errType) {
      console.log('Nao foi possivel agrupar por tipo_pedido:', errType.message);
      try {
        const [fb] = await pool.query(`
          SELECT COUNT(p.id) as total, SUM(p.vlrtotalpedido) as vlr_total,
                 COUNT(CASE WHEN p.situacao_pedido IN ('PENDENTE','ENTREGAR') THEN 1 END) as pendentes,
                 COUNT(CASE WHEN p.situacao_pedido = 'APROVADO' THEN 1 END) as aprovados,
                 COUNT(CASE WHEN p.situacao_pedido = 'ENVIADO' THEN 1 END) as enviados,
                 COUNT(CASE WHEN p.situacao_pedido = 'CANCELADO' THEN 1 END) as cancelados
          FROM pedidos p ${joinFilterClause} ${whereClauseCards}
        `, paramsCards);
        statsRows = (fb && fb.length > 0) ? fb : statsRows;
        typeStats = [{ tipo_pedido: 'PEDIDO', total: statsRows[0].total, vlr_total: statsRows[0].vlr_total }];
      } catch (e2) {
        console.error('Falha crítica nas estatísticas:', e2.message);
      }
    }
    
    const allowedSort = ['p.id', 'p.numero', 'p.data_abertura', 'p.vlrtotalpedido', 'p.nome_cliente'];
    const orderCol = allowedSort.includes(sort) ? sort : 'p.id';
    const orderDir = dir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    let rows = [];
    try {
      const [r] = await pool.query(
        `SELECT p.*, u.nomeusu, c.cpf as cnpj_cliente,
                c.latitude, c.longitude, c.endereco, c.cidade, c.id as id_cliente, c.apelido as fantasia_cliente
         FROM pedidos p
         ${joinFilterClause}
         LEFT JOIN usuarios u ON p.id_usuario = u.idusuario
         LEFT JOIN clientes c ON p.cod_cliente = c.id
         ${whereClause}
         ORDER BY ${orderCol} ${orderDir} LIMIT ? OFFSET ?`,
        [...params, parseInt(limit) || 50, parseInt(offset) || 0]
      );
      rows = r;
    } catch(errJoin) {
      console.log('Falha no JOIN de usuarios/clientes:', errJoin.message);
      try {
        const [rFall] = await pool.query(
          `SELECT p.* FROM pedidos p ${joinFilterClause} ${whereClause} ORDER BY ${orderCol} ${orderDir} LIMIT ? OFFSET ?`,
          [...params, parseInt(limit) || 50, parseInt(offset) || 0]
        );
        rows = rFall;
      } catch (e3) {
        console.error('Falha na query fallback:', e3.message);
        rows = [];
      }
    }

    // Busca unidades dos itens só para os pedidos retornados (evita full-scan em itensped)
    if (rows.length > 0) {
      const numeros = rows.map(r => r.numero).filter(Boolean);
      if (numeros.length) {
        try {
          const [unidRows] = await pool.query(
            `SELECT numpedido,
                    GROUP_CONCAT(DISTINCT TRIM(unidade) ORDER BY TRIM(unidade) SEPARATOR ', ') as unidades_itens
             FROM itensped
             WHERE numpedido IN (?) AND COALESCE(excluido,'N') = 'N' AND TRIM(COALESCE(unidade,'')) <> ''
             GROUP BY numpedido`,
            [numeros]
          );
          const unidMap = {};
          for (const u of unidRows) unidMap[u.numpedido] = u.unidades_itens;
          rows.forEach(r => { r.unidades_itens = unidMap[r.numero] || null; });
        } catch (e) {
          rows.forEach(r => { r.unidades_itens = null; });
        }
      }
    }

    if ((cod_cliente || id_cliente || cod_fornecedor || id_fornecedor) && rows.length > 0) {
      const numeros = rows.map(p => p.numero).filter(Boolean);
      if (numeros.length > 0) {
        const ph = numeros.map(() => '?').join(',');
        const [allItens] = await pool.query(
          `SELECT i.numpedido, i.cod_produto, i.desc_prod, i.quantidade, i.valor_unitario, i.vlrtotal_itens, i.unidade
           FROM itensped i WHERE i.numpedido IN (${ph}) AND COALESCE(i.excluido, 'N') = 'N'`,
          numeros
        ).catch(() => [[]]);
        const [allParcelas] = await pool.query(
          `SELECT r.numero, r.vencimento, r.valor, r.parcela, r.qt_parcelas
           FROM receber r WHERE r.numero IN (${ph}) AND COALESCE(r.excluido, 'N') = 'N'
           ORDER BY r.parcela`,
          numeros
        ).catch(() => [[]]);
        const itensMap = {}, parcMap = {};
        for (const i of allItens) { (itensMap[i.numpedido] = itensMap[i.numpedido] || []).push(i); }
        for (const p of allParcelas) { (parcMap[p.numero] = parcMap[p.numero] || []).push(p); }
        for (const p of rows) { p.itens = itensMap[p.numero] || []; p.parcelas = parcMap[p.numero] || []; }
      }
    }

    if (isPrepostoUser(req)) {
      rows = rows.map(stripPedidoComissaoRep);
    }

    res.json({ 
      pedidos: rows,
      pagination: {
        totalItems,
        totalGlobal: (statsRows[0] && statsRows[0].total) || 0,
        valorGlobal: (statsRows[0] && statsRows[0].vlr_total) || 0,
        pendentes:  (statsRows[0] && statsRows[0].pendentes)  || 0,
        aprovados:  (statsRows[0] && statsRows[0].aprovados)  || 0,
        enviados:   (statsRows[0] && statsRows[0].enviados)   || 0,
        cancelados: (statsRows[0] && statsRows[0].cancelados) || 0,
        faturados:  (statsRows[0] && statsRows[0].faturados)  || 0,
        statusCounts,
        tipos: typeStats,
        totalPages: Math.ceil(totalItems / (parseInt(limit) || 50)),
        currentPage: parseInt(page) || 1,
        limit: parseInt(limit) || 50
      }
    });
  } catch (err) {
    console.error('ERRO GERAL PEDIDOS:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pedidos/lookup/vendedores
router.get('/lookup/vendedores', async (req, res) => {
  try {
    const pool = getPool();
    const visiveis = await listVendedoresVisiveis(pool, req, { onlyPVender: true });
    const ids = visiveis.map(v => v.id).filter(Boolean);
    if (!ids.length) return res.json({ vendedores: [] });

    const [rows] = await pool.query(`
      SELECT
        u.idusuario AS id,
        u.nomeusu AS nome_vendedor,
        u.nomeusu AS nome,
        p.acessartodosclientes,
        p.alterardatapedido,
        u.rota_vendedor,
        u.email,
        u.comissaofixavendedor,
        u.comissaogerente,
        u.permitevendasemcomissao,
        u.compartilhacomissaogerente,
        u.fonesecundario
      FROM usuarios u
      INNER JOIN perfil p ON p.id = u.idperfil
      WHERE u.idusuario IN (?)
        AND u.excluido = 'N'
        AND (u.situacao = 'ATIVO' OR u.situacao IS NULL)
        AND p.excluido = 'N'
        AND p.p_vender = 'S'
      ORDER BY u.nomeusu
    `, [ids]).catch(() => [[]]);

    let vendedores = rows;
    if (isPrepostoUser(req)) {
      vendedores = vendedores.map(stripVendedorComissaoRep);
    }
    res.json({ vendedores });
  } catch (err) {
    res.json({ vendedores: [] });
  }
});

// GET /api/pedidos/lookup/tipos
router.get('/lookup/tipos', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(`
      SELECT id, gerafinanceiro, movimentaestoque, descricao as tipo_pedido, tratamento 
      FROM tipo_pedidos 
      WHERE excluido = 'N' AND situacao = 'A' 
      ORDER BY id
    `).catch(() => [[]]);
    res.json({ tipos: rows });
  } catch (err) {
    res.json({ tipos: [] });
  }
});

// GET /api/pedidos/lookup/tiposfrete
router.get('/lookup/tiposfrete', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(`
      SELECT p.* FROM tipo_frete p
      WHERE p.excluido = 'N'
      AND p.status = 'A'
      ORDER BY p.nome desc
    `).catch(() => [[]]);
    res.json({ tiposfrete: rows });
  } catch (err) {
    res.json({ tiposfrete: [] });
  }
});

// GET /api/pedidos/lookup/empresas
router.get('/lookup/empresas', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(`
      SELECT * FROM empresa 
      WHERE excluido = 'N' 
      ORDER BY Razao_empresa desc
    `).catch(() => [[]]);
    const empresas = [];
    for (const row of rows || []) {
      empresas.push(await sanitizeEmpresaRow(pool, row));
    }
    res.json({ empresas });
  } catch (err) {
    res.json({ empresas: [] });
  }
});

// GET /api/pedidos/produtos/busca — autocomplete simples
router.get('/produtos/busca', async (req, res) => {
  try {
    const pool = getPool();
    const tb = await _getProdTabela(pool);
    await _ensureProdCols(pool);
    const { q = '', limit = 15, offset = 0, id_fornecedor, id_tabela, catalogo, somente_promocao, somente_destaque, somente_lancamento, segmento, agrupar_referencia, showroom, lean, ids, skip_total } = req.query;
    const offsetNum = Math.max(0, parseInt(offset) || 0);
    const tabelaId = (id_tabela && id_tabela !== 'null' && id_tabela !== '0') ? parseInt(id_tabela) : null;
    const isCatalogo = catalogo === '1' || catalogo === 'true';
    const isShowroomLean = showroom === '1' || showroom === 'true' || lean === '1' || lean === 'true';
    const agruparRef = agrupar_referencia === '1' || agrupar_referencia === 'true' || agrupar_referencia === 'S';
    const filtrarPromo = somente_promocao === '1' || somente_promocao === 'true' || somente_promocao === 'S';
    const filtrarDestaque = somente_destaque === '1' || somente_destaque === 'true' || somente_destaque === 'S';
    const filtrarLancamento = somente_lancamento === '1' || somente_lancamento === 'true' || somente_lancamento === 'S';
    const idsBatch = String(ids || '')
      .split(',')
      .map((x) => parseInt(x, 10))
      .filter((n) => Number.isFinite(n) && n > 0)
      .slice(0, 80);

    const [sysRows] = await pool.query('SELECT itenspedidofornecedor FROM sistemas ORDER BY id DESC LIMIT 1').catch(() => [[]]);
    const itensForn = sysRows[0]?.itenspedidofornecedor || 'N';

    const params = [];
    let join = '';
    let whereExtra = '';
    let vlrVendaExpr = 'p.vlr_venda';
    let precoTabelaExpr = 'NULL';
    const fId = (id_fornecedor && id_fornecedor !== 'null' && id_fornecedor !== '0') ? parseInt(id_fornecedor) : null;

    // Verifica se a tabela tem itens em tabela_preco_itens (tabelas legado podem não ter)
    let tableHasItens = false;
    if (isCatalogo && tabelaId) {
      const [[tblChk]] = await pool.query(
        `SELECT 1 FROM tabela_preco_itens WHERE id_tabela = ? LIMIT 1`, [tabelaId]
      ).catch(() => [[null]]);
      tableHasItens = !!tblChk;
    }

    // Catálogo visual com tabela ativa: produtos cadastrados na tabela (estilo Mercos)
    if (isCatalogo && tabelaId && tableHasItens) {
      join = ` INNER JOIN tabela_preco_itens tpi ON CAST(tpi.cod_produto AS UNSIGNED) = p.ID
                 AND tpi.id_tabela = ?
                 AND (tpi.excluido = 'N' OR tpi.excluido IS NULL OR tpi.excluido = '')
                 AND (tpi.ativo = 'S' OR tpi.ativo IS NULL OR tpi.ativo = '') `;
      params.push(tabelaId);
      vlrVendaExpr = 'COALESCE(tpi.valor_tabela, tpi.preco_venda, p.vlr_venda)';
      precoTabelaExpr = 'tpi.valor_tabela';
    } else if (tabelaId) {
      join += ` LEFT JOIN tabela_preco_itens tpi ON CAST(tpi.cod_produto AS UNSIGNED) = p.ID AND tpi.id_tabela = ? AND (tpi.excluido = 'N' OR tpi.excluido IS NULL OR tpi.excluido = '') AND (tpi.ativo = 'S' OR tpi.ativo IS NULL OR tpi.ativo = '')`;
      params.push(tabelaId);
      vlrVendaExpr = 'COALESCE(tpi.valor_tabela, p.vlr_venda)';
      precoTabelaExpr = 'tpi.valor_tabela';
    }

    // Filtro de fábrica: pulado quando INNER JOIN (tabela já limita ao fornecedor)
    if (!(isCatalogo && tabelaId && tableHasItens)) {
      if (itensForn === 'S' && !fId) return res.json({ data: [] });
      if (fId) {
        whereExtra = `AND (
          CAST(p.cod_fornecedorpadrao AS UNSIGNED) = ?
          OR EXISTS (
            SELECT 1 FROM produtofornecedor pf
            WHERE CAST(pf.cod_produto AS UNSIGNED) = p.ID
              AND CAST(pf.cod_fornecedor AS UNSIGNED) = ?
              AND (pf.excluido = 'N' OR pf.excluido IS NULL OR pf.excluido = '')
              AND pf.status = 'A'
          )
        )`;
        params.push(fId, fId);
      }
    }
    const busca = produtoBuscaOrSql('p', q, { includeId: true });
    let whereSearch = busca.fragment;
    let searchParams = busca.params;
    const isBarcodeLike = busca.isBarcodeLike;
    const qTrim = busca.qTrim;

    // Favoritos do Showroom: 1 query com IN em vez de N buscas por ID
    if (idsBatch.length) {
      whereSearch = 'p.ID IN (?)';
      searchParams = [idsBatch];
    }

    if (filtrarDestaque) {
      const partesDestaque = [];
      if (await tabelaPromocoesExiste(pool)) {
        partesDestaque.push(`EXISTS (
          SELECT 1 FROM produto_promocoes pp
          WHERE pp.cod_produto = p.ID AND pp.excluido = 'N' AND pp.ativo = 'S'
            AND (pp.data_inicio IS NULL OR pp.data_inicio <= CURDATE())
            AND (pp.data_fim IS NULL OR pp.data_fim >= CURDATE())
            AND pp.destaque = 'S'
        )`);
      }
      if (await tabelaProdutosDestaqueExiste(pool)) {
        partesDestaque.push(sqlExistsDestaqueComercial('p', { idFornecedor: fId }));
      }
      if (partesDestaque.length) {
        whereExtra += ` AND (${partesDestaque.join(' OR ')})`;
      }
    } else if (filtrarPromo && (await tabelaPromocoesExiste(pool))) {
      whereExtra += ` AND EXISTS (
        SELECT 1 FROM produto_promocoes pp
        WHERE pp.cod_produto = p.ID AND pp.excluido = 'N' AND pp.ativo = 'S'
          AND (pp.data_inicio IS NULL OR pp.data_inicio <= CURDATE())
          AND (pp.data_fim IS NULL OR pp.data_fim >= CURDATE())
      )`;
    }

    if (filtrarLancamento) {
      whereExtra += ` AND p.dt_cadastro IS NOT NULL AND p.dt_cadastro >= DATE_SUB(CURDATE(), INTERVAL 90 DAY) `;
    }

    const prodCols = await _getProdColSet(pool);
    const grupoJoinSql = prodCols.has('id_grupo')
      ? ' LEFT JOIN grupos g ON g.id = p.id_grupo '
      : '';

    // Showroom: esconde cores filhas na grade (só com agrupar_referencia=1 e sem busca).
    // Com busca/q preenchido, mantém filhos visíveis (favoritos por ID, SKU da cor).
    if (agruparRef && !String(q || '').trim() && prodCols.has('id_referencia')) {
      whereExtra += ` AND ${sqlSomenteMaeOuAvulso('p')}`;
    }

    if (segmento && segmento.trim() && prodCols.has('segmento')) {
      whereExtra += ` AND p.segmento = ?`;
      params.push(segmento.trim());
    }

    // Filtros rápidos do catálogo (botão de subtabelas no modal): aplicados só se a coluna existir
    const { nome_grupo, marca, tipograde: fTipoGrade, kit } = req.query;
    if (nome_grupo && nome_grupo.trim()) {
      const ng = nome_grupo.trim();
      if (prodCols.has('nome_grupo') && prodCols.has('id_grupo')) {
        whereExtra += ` AND (p.nome_grupo = ? OR g.descricao = ?)`;
        params.push(ng, ng);
      } else if (prodCols.has('nome_grupo')) {
        whereExtra += ` AND p.nome_grupo = ?`;
        params.push(ng);
      } else if (prodCols.has('id_grupo')) {
        whereExtra += ` AND g.descricao = ?`;
        params.push(ng);
      }
    }
    if (marca && marca.trim() && prodCols.has('marca')) {
      whereExtra += ` AND p.marca = ?`;
      params.push(marca.trim());
    }
    if (fTipoGrade && String(fTipoGrade).trim() && prodCols.has('tipograde')) {
      whereExtra += ` AND p.tipograde = ?`;
      params.push(parseInt(fTipoGrade) || 0);
    }
    if ((kit === 'S' || kit === '1') && prodCols.has('kit')) {
      whereExtra += ` AND p.kit = 'S'`;
    }

    const whereBase = `(p.excluido = 'N' OR p.excluido IS NULL OR p.excluido = '')
         AND p.situacao = 'A'
         ${whereExtra}
         AND ${whereSearch}`;
    const whereParams = [...params, ...searchParams];

    // Facets do catálogo: categorias/marcas presentes na busca atual (não o cadastro inteiro)
    if (req.query.facets === '1' || req.query.facets === 'true') {
      const facets = { categorias: [], grupos: [], marcas: [], grades: [], tem_kit: false };
      if (prodCols.has('segmento')) {
        const [segRows] = await pool.query(
          `SELECT DISTINCT TRIM(p.segmento) AS v
             FROM ${tb} p ${join}${grupoJoinSql}
            WHERE ${whereBase}
              AND p.segmento IS NOT NULL AND TRIM(p.segmento) <> ''
            ORDER BY v`,
          whereParams
        );
        facets.categorias = segRows.map((r) => r.v).filter(Boolean);
      }

      const grupoSet = new Set();
      if (prodCols.has('nome_grupo')) {
        const [gRows] = await pool.query(
          `SELECT DISTINCT TRIM(p.nome_grupo) AS v
             FROM ${tb} p ${join}${grupoJoinSql}
            WHERE ${whereBase}
              AND p.nome_grupo IS NOT NULL AND TRIM(p.nome_grupo) <> ''
            ORDER BY v`,
          whereParams
        );
        gRows.map((r) => r.v).filter(Boolean).forEach((v) => grupoSet.add(v));
      }
      if (prodCols.has('id_grupo')) {
        const [gDescRows] = await pool.query(
          `SELECT DISTINCT TRIM(g.descricao) AS v
             FROM ${tb} p ${join}${grupoJoinSql}
            WHERE ${whereBase}
              AND g.descricao IS NOT NULL AND TRIM(g.descricao) <> ''
            ORDER BY v`,
          whereParams
        );
        gDescRows.map((r) => r.v).filter(Boolean).forEach((v) => grupoSet.add(v));
      }
      facets.grupos = [...grupoSet].sort((a, b) => String(a).localeCompare(String(b), 'pt-BR', { sensitivity: 'base' }));
      if (prodCols.has('marca')) {
        const [mRows] = await pool.query(
          `SELECT DISTINCT TRIM(p.marca) AS v
             FROM ${tb} p ${join}${grupoJoinSql}
            WHERE ${whereBase}
              AND p.marca IS NOT NULL AND TRIM(p.marca) <> ''
            ORDER BY v`,
          whereParams
        );
        facets.marcas = mRows.map((r) => r.v).filter(Boolean);
      }
      if (prodCols.has('tipograde')) {
        const [grRows] = await pool.query(
          `SELECT DISTINCT p.tipograde AS id, TRIM(tg.nome) AS nome
             FROM ${tb} p ${join}${grupoJoinSql}
             LEFT JOIN tipograde tg ON tg.id = p.tipograde
            WHERE ${whereBase}
              AND p.tipograde IS NOT NULL AND p.tipograde > 0
            ORDER BY nome`,
          whereParams
        );
        facets.grades = grRows
          .filter((r) => r.id && r.nome)
          .map((r) => ({ id: r.id, nome: r.nome }));
      }
      if (prodCols.has('kit')) {
        const [[kitRow]] = await pool.query(
          `SELECT COUNT(*) AS n FROM ${tb} p ${join}${grupoJoinSql}
            WHERE ${whereBase} AND p.kit = 'S' LIMIT 1`,
          whereParams
        );
        facets.tem_kit = (kitRow?.n || 0) > 0;
      }
      return res.json(facets);
    }

    const selSegmento = prodCols.has('segmento') ? 'p.segmento' : 'NULL AS segmento';
    const selMarca = prodCols.has('marca') ? 'p.marca' : 'NULL AS marca';
    const selNomeGrupo = prodCols.has('nome_grupo') ? 'p.nome_grupo' : 'NULL AS nome_grupo';
    const selKit = prodCols.has('kit') ? "IFNULL(p.kit, 'N') AS kit" : "NULL AS kit";
    const selGrupoDesc = prodCols.has('id_grupo') ? 'g.descricao AS grupo_descricao' : 'NULL AS grupo_descricao';
    const selIdRef = prodCols.has('id_referencia') ? 'p.id_referencia' : 'NULL AS id_referencia';
    const selCor1 = prodCols.has('cor1') ? 'p.cor1' : 'NULL AS cor1';
    // Showroom lean: só foto_principal (sem subquery em produto_imagens por linha).
    const selFoto = isShowroomLean
      ? `IFNULL(p.foto_principal, '') AS foto_principal`
      : `COALESCE(p.foto_principal, (
                SELECT CONCAT('/uploads/produtos/', p.ID, '/', pi.filename)
                FROM produto_imagens pi
                WHERE CAST(pi.cod_produto AS UNSIGNED) = p.ID
                ORDER BY pi.is_principal DESC, pi.id ASC
                LIMIT 1
              )) AS foto_principal`;
    // qtd_cores só quando agrupar referência (chips de cor); senão 0.
    const selQtdCores = (agruparRef && prodCols.has('id_referencia'))
      ? `(SELECT COUNT(*) FROM ${tb} c
          WHERE c.id_referencia = p.ID
            AND (c.excluido='N' OR c.excluido IS NULL OR c.excluido='')
            AND (c.situacao='A' OR c.situacao IS NULL OR c.situacao='')) AS qtd_cores`
      : '0 AS qtd_cores';

    const orderBarcode = (isBarcodeLike && !idsBatch.length)
      ? '(p.cod_barras = ? OR p.cod_fabricante = ?) DESC,'
      : '';
    const [rows] = await pool.query(
      `SELECT p.ID as id, p.ID as cod_produto,
              p.cod_fabricante, p.cod_barras, ${selSegmento}, ${selMarca}, ${selNomeGrupo}, ${selGrupoDesc}, ${selKit},
              p.descricao, p.descricao as desc_produto,
              p.unidade, ${vlrVendaExpr} as vlr_venda, ${precoTabelaExpr} as preco_da_tabela, p.ipi, p.comissao,
              IFNULL(p.precoa, 0) as precoa, IFNULL(p.precob, 0) as precob,
              IFNULL(p.precoc, 0) as precoc, IFNULL(p.precopromo, 0) as precopromo,
              IFNULL(p.st, 0) as st,
              IFNULL(p.icms, 0) as icms,
              IFNULL(p.valor_puxada, 0) as valor_puxada,
              IFNULL(p.kilo_embalagem, 0) as kilo_embalagem,
              IFNULL(p.precopeso, 'N') as precopeso,
              IFNULL(p.multiplo_venda, 1) as multiplo_venda,
              IFNULL(p.qtd_minima_pedido, 0) as qtd_minima_pedido,
              IFNULL(p.estoque_atual, 0) as estoque_atual,
              IFNULL(p.disponivel, 'S') as disponivel,
              ${selFoto},
              IFNULL(p.tipograde, 0) as tipograde,
              IFNULL(p.solado, '') as solado,
              IFNULL(p.tipoprodutograde, '') as tipoprodutograde,
              IFNULL(p.bloquear_desconto, 'N') as bloquear_desconto,
              p.desconto_maximo,
              IFNULL(p.peso_liquido, 0) as peso_liquido,
              ${selIdRef}, ${selCor1}, ${selQtdCores}
       FROM ${tb} p
       ${join}${grupoJoinSql}
       WHERE (p.excluido = 'N' OR p.excluido IS NULL OR p.excluido = '')
         AND p.situacao = 'A'
         ${whereExtra}
         AND ${whereSearch}
       ORDER BY ${orderBarcode} p.descricao
       LIMIT ? OFFSET ?`,
      [
        ...params,
        ...searchParams,
        ...(orderBarcode ? [qTrim, qTrim] : []),
        parseInt(limit),
        offsetNum,
      ]
    );
    // Total: pula favoritos batch / skip_total (scroll) / filtros que recontam no JS
    let total = null;
    const wantTotal = !(skip_total === '1' || skip_total === 'true')
      && !idsBatch.length
      && !filtrarPromo
      && !filtrarDestaque;
    if (wantTotal) {
      try {
        const [[cnt]] = await pool.query(
          `SELECT COUNT(DISTINCT p.ID) AS total
             FROM ${tb} p
             ${join}${grupoJoinSql}
             WHERE (p.excluido = 'N' OR p.excluido IS NULL OR p.excluido = '')
               AND p.situacao = 'A'
               ${whereExtra}
               AND ${whereSearch}`,
          [...params, ...searchParams]
        );
        total = cnt?.total ?? null;
      } catch (_) { total = null; }
    }
    let data = rows;
    // Showroom não usa badges de promo/destaque na grade — pula enrich (queries extras)
    if (!isShowroomLean) {
      const promoCtx = await _promoCtxFromPedidoQuery(pool, req.query);
      const qtdPromo = parseFloat(req.query.qtd) || 1;
      data = await enrichProdutosComPromocao(pool, rows, { qtd: qtdPromo, ...promoCtx });
      data = await attachDestaquesComerciais(pool, data, promoCtx);
      if (filtrarPromo) {
        data = data.filter((p) => p.tem_promocao || p.promocao_ativa);
      }
      if (filtrarDestaque) {
        data = data.filter((p) =>
          p.destaque_comercial
          || p.promocao_ativa?.destaque
          || (p.promocoes || []).some((x) => x.destaque)
        );
      }
    }
    if (isPrepostoUser(req)) {
      data = stripProdutosComissaoRep(data);
    }
    res.json({ data, total });
  } catch (err) {
    console.error('[/produtos/busca] ERRO:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pedidos/produtos/promocoes-resumo — qtd produtos em promoção da fábrica
router.get('/produtos/promocoes-resumo', async (req, res) => {
  try {
    const pool = getPool();
    const tb = await _getProdTabela(pool);
    const fId = parseInt(req.query.id_fornecedor, 10);
    const temPromo = await tabelaPromocoesExiste(pool);
    const temDestCom = await tabelaProdutosDestaqueExiste(pool);
    if (!fId || (!temPromo && !temDestCom)) {
      return res.json({ total: 0, destaques: 0 });
    }

    const [sysRows] = await pool.query('SELECT itenspedidofornecedor FROM sistemas ORDER BY id DESC LIMIT 1').catch(() => [[]]);
    const itensForn = sysRows[0]?.itenspedidofornecedor || 'N';

    let fornWhere = '';
    const params = [];
    if (itensForn === 'S') {
      fornWhere = 'AND CAST(p.cod_fornecedorpadrao AS UNSIGNED) = ?';
      params.push(fId);
    } else {
      fornWhere = `AND (
        CAST(p.cod_fornecedorpadrao AS UNSIGNED) = ?
        OR EXISTS (
          SELECT 1 FROM produtofornecedor pf
          WHERE CAST(pf.cod_produto AS UNSIGNED) = p.ID
            AND CAST(pf.cod_fornecedor AS UNSIGNED) = ?
            AND (pf.excluido = 'N' OR pf.excluido IS NULL OR pf.excluido = '')
            AND pf.status = 'A'
        )
      )`;
      params.push(fId, fId);
    }

    const promoExists = `EXISTS (
      SELECT 1 FROM produto_promocoes pp
      WHERE pp.cod_produto = p.ID AND pp.excluido = 'N' AND pp.ativo = 'S'
        AND (pp.data_inicio IS NULL OR pp.data_inicio <= CURDATE())
        AND (pp.data_fim IS NULL OR pp.data_fim >= CURDATE())
    )`;

    const [[{ total }]] = temPromo ? await pool.query(
      `SELECT COUNT(DISTINCT p.ID) AS total
       FROM ${tb} p
       WHERE (p.excluido = 'N' OR p.excluido IS NULL OR p.excluido = '')
         AND p.situacao = 'A'
         ${fornWhere}
         AND ${promoExists}`,
      params
    ) : [{ total: 0 }];

    const destPromoSql = temPromo ? `EXISTS (
           SELECT 1 FROM produto_promocoes pp
           WHERE pp.cod_produto = p.ID AND pp.excluido = 'N' AND pp.ativo = 'S'
             AND pp.destaque = 'S'
             AND (pp.data_inicio IS NULL OR pp.data_inicio <= CURDATE())
             AND (pp.data_fim IS NULL OR pp.data_fim >= CURDATE())
         )` : '0';
    const destComSql = temDestCom ? sqlExistsDestaqueComercial('p', { idFornecedor: fId }) : '0';

    const [[{ destaques }]] = await pool.query(
      `SELECT COUNT(DISTINCT p.ID) AS destaques
       FROM ${tb} p
       WHERE (p.excluido = 'N' OR p.excluido IS NULL OR p.excluido = '')
         AND p.situacao = 'A'
         ${fornWhere}
         AND (${destPromoSql} OR ${destComSql})`,
      params
    );

    res.json({ total: Number(total) || 0, destaques: Number(destaques) || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function _fetchProdutosEnriquecidosPorIds(pool, tb, ids, req, { idFornecedor, tabelaId } = {}) {
  if (!ids.length) return new Map();

  const placeholders = ids.map(() => '?').join(',');
  const [sysRows] = await pool.query('SELECT itenspedidofornecedor FROM sistemas ORDER BY id DESC LIMIT 1').catch(() => [[]]);
  const itensForn = sysRows[0]?.itenspedidofornecedor || 'N';

  const params = [...ids];
  let join = '';
  let vlrVendaExpr = 'p.vlr_venda';
  let precoTabelaExpr = 'NULL';
  if (tabelaId) {
    join = ` LEFT JOIN tabela_preco_itens tpi ON CAST(tpi.cod_produto AS UNSIGNED) = p.ID AND tpi.id_tabela = ? AND (tpi.excluido = 'N' OR tpi.excluido IS NULL OR tpi.excluido = '') AND tpi.ativo = 'S'`;
    params.unshift(tabelaId);
    vlrVendaExpr = 'COALESCE(tpi.valor_tabela, p.vlr_venda)';
    precoTabelaExpr = 'tpi.valor_tabela';
  }

  let fornWhere = '';
  if (idFornecedor) {
    if (itensForn === 'S') {
      fornWhere = ' AND CAST(p.cod_fornecedorpadrao AS UNSIGNED) = ? ';
      params.push(idFornecedor);
    } else {
      fornWhere = ` AND (
        CAST(p.cod_fornecedorpadrao AS UNSIGNED) = ?
        OR EXISTS (
          SELECT 1 FROM produtofornecedor pf
          WHERE CAST(pf.cod_produto AS UNSIGNED) = p.ID
            AND CAST(pf.cod_fornecedor AS UNSIGNED) = ?
            AND (pf.excluido = 'N' OR pf.excluido IS NULL OR pf.excluido = '')
            AND pf.status = 'A'
        )
      )`;
      params.push(idFornecedor, idFornecedor);
    }
  }

  const [prodRows] = await pool.query(
    `SELECT p.ID as id, p.ID as cod_produto,
            p.cod_fabricante, p.cod_barras, p.descricao, p.descricao as desc_produto,
            p.unidade, ${vlrVendaExpr} as vlr_venda, ${precoTabelaExpr} as preco_da_tabela, p.ipi, p.comissao,
            IFNULL(p.precoa, 0) as precoa, IFNULL(p.precob, 0) as precob,
            IFNULL(p.precoc, 0) as precoc, IFNULL(p.precopromo, 0) as precopromo,
            IFNULL(p.st, 0) as st,
            IFNULL(p.icms, 0) as icms,
            IFNULL(p.valor_puxada, 0) as valor_puxada,
            IFNULL(p.kilo_embalagem, 0) as kilo_embalagem,
            IFNULL(p.precopeso, 'N') as precopeso,
            IFNULL(p.multiplo_venda, 1) as multiplo_venda,
            IFNULL(p.qtd_minima_pedido, 0) as qtd_minima_pedido,
            IFNULL(p.estoque_atual, 0) as estoque_atual,
            IFNULL(p.disponivel, 'S') as disponivel,
            p.dt_cadastro,
            COALESCE(p.foto_principal, (
              SELECT CONCAT('/uploads/produtos/', p.ID, '/', pi.filename)
              FROM produto_imagens pi
              WHERE CAST(pi.cod_produto AS UNSIGNED) = p.ID
              ORDER BY pi.is_principal DESC, pi.id ASC
              LIMIT 1
            )) AS foto_principal,
            IFNULL(p.tipograde, 0) as tipograde,
            IFNULL(p.solado, '') as solado,
            IFNULL(p.tipoprodutograde, '') as tipoprodutograde
     FROM ${tb} p
     ${join}
     WHERE p.ID IN (${placeholders})
       AND (p.excluido = 'N' OR p.excluido IS NULL OR p.excluido = '')
       AND p.situacao = 'A'
       ${fornWhere}`,
    params
  );

  const promoCtx = await _promoCtxFromPedidoQuery(pool, req.query);
  const enriched = await enrichProdutosComPromocao(pool, prodRows, { qtd: 1, ...promoCtx });
  return new Map(enriched.map((p) => [parseInt(p.cod_produto, 10), p]));
}

// GET /api/pedidos/produtos/reposicao — sugestão de recompra pelo histórico do cliente
router.get('/produtos/reposicao', async (req, res) => {
  try {
    const pool = getPool();
    const tb = await _getProdTabela(pool);
    await _ensureProdCols(pool);
    const codCliente = parseOptInt(req.query.cod_cliente);
    const idFornecedor = parseOptInt(req.query.id_fornecedor || req.query.cod_fornecedor);
    const tabelaId = parseOptInt(req.query.id_tabela || req.query.id_tabela_preco);
    const q = String(req.query.q || '').trim();

    const resultado = await listarReposicaoProdutos(pool, _getProdTabela, {
      codCliente,
      idFornecedor,
      q,
    });

    if (!resultado.data.length) {
      return res.json({
        data: [],
        sem_historico: resultado.sem_historico,
        mensagem: resultado.mensagem || null,
        total: 0,
      });
    }

    const ids = resultado.data.map((r) => parseInt(r.cod_produto, 10)).filter(Boolean);
    const enrichedMap = await _fetchProdutosEnriquecidosPorIds(pool, tb, ids, req, {
      idFornecedor,
      tabelaId,
    });

    const data = resultado.data
      .filter((r) => enrichedMap.has(parseInt(r.cod_produto, 10)))
      .map((r) => {
        const pid = parseInt(r.cod_produto, 10);
        const prod = enrichedMap.get(pid) || {};
        return {
          ...prod,
          cod_produto: pid,
          desc_produto: prod.desc_produto || r.desc_produto,
          ultima_compra: r.ultima_compra,
          ultima_compra_fmt: r.ultima_compra_fmt,
          dias_desde_ultima: r.dias_desde_ultima,
          media_mensal: r.media_mensal,
          qtd_sugerida: r.qtd_sugerida,
          qtd_12m: r.qtd_12m,
          qtd_historico: r.qtd_historico,
          semaforo: r.semaforo,
          semaforo_emoji: r.semaforo_emoji,
          semaforo_label: r.semaforo_label,
          hint_reposicao: r.hint_reposicao,
        };
      });

    res.json({
      data,
      sem_historico: false,
      total: data.length,
    });
  } catch (err) {
    console.error('[/produtos/reposicao] ERRO:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pedidos/produtos/oportunidades — complementares por região (cliente ainda não comprou)
router.get('/produtos/oportunidades', async (req, res) => {
  try {
    const pool = getPool();
    const tb = await _getProdTabela(pool);
    await _ensureProdCols(pool);
    const codCliente = parseOptInt(req.query.cod_cliente);
    const idFornecedor = parseOptInt(req.query.id_fornecedor || req.query.cod_fornecedor);
    const tabelaId = parseOptInt(req.query.id_tabela || req.query.id_tabela_preco);
    const q = String(req.query.q || '').trim();

    const resultado = await listarOportunidadesProdutos(pool, _getProdTabela, {
      codCliente,
      idFornecedor,
      q,
    });

    if (!resultado.data.length) {
      return res.json({
        data: [],
        sem_dados: resultado.sem_dados,
        mensagem: resultado.mensagem || null,
        total: 0,
      });
    }

    const ids = resultado.data.map((r) => parseInt(r.cod_produto, 10)).filter(Boolean);
    const enrichedMap = await _fetchProdutosEnriquecidosPorIds(pool, tb, ids, req, {
      idFornecedor,
      tabelaId,
    });

    const data = resultado.data
      .filter((r) => enrichedMap.has(parseInt(r.cod_produto, 10)))
      .map((r) => {
        const pid = parseInt(r.cod_produto, 10);
        const prod = enrichedMap.get(pid) || {};
        return {
          ...prod,
          cod_produto: pid,
          desc_produto: prod.desc_produto || r.desc_produto,
          clientes_que_compram: r.clientes_que_compram,
          qtd_total_regiao: r.qtd_total_regiao,
          valor_total_regiao: r.valor_total_regiao,
          qtd_sugerida: r.qtd_sugerida || 1,
          hint_oportunidade: r.hint_oportunidade,
        };
      });

    res.json({ data, sem_dados: false, total: data.length });
  } catch (err) {
    console.error('[/produtos/oportunidades] ERRO:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pedidos/feirinha/calcular — preço médio, faixa e margem (espelha o painel do pedido)
router.post('/feirinha/calcular', (req, res) => {
  try {
    const { itens, preco_revenda: precoRevenda, faixa_codigo, preco_medio_meta, preco_revenda_alvo } = req.body || {};
    if (!Array.isArray(itens)) {
      return res.status(400).json({ error: 'Campo itens (array) é obrigatório.' });
    }
    const resumo = calcFeirinhaResumo(itens, {
      precoRevenda: precoRevenda != null ? parseFloat(precoRevenda) : null,
      faixaCodigo: faixa_codigo,
      precoMedioMeta: preco_medio_meta != null ? parseFloat(preco_medio_meta) : null,
      precoRevendaAlvo: preco_revenda_alvo != null ? parseFloat(preco_revenda_alvo) : null,
    });
    res.json(resumo);
  } catch (err) {
    console.error('[/feirinha/calcular] ERRO:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pedidos/produtos/feirinha — catálogo filtrado por faixa de preço médio
router.get('/produtos/feirinha', async (req, res) => {
  try {
    const pool = getPool();
    const tb = await _getProdTabela(pool);
    await _ensureProdCols(pool);
    const idFornecedor = parseOptInt(req.query.id_fornecedor || req.query.cod_fornecedor);
    const tabelaId = parseOptInt(req.query.id_tabela || req.query.id_tabela_preco);
    const resultado = await listarProdutosFeirinha(pool, _getProdTabela, {
      idFornecedor,
      tabelaId,
      q: req.query.q,
      faixa_codigo: req.query.faixa_codigo,
      id_campanha: req.query.id_campanha,
      preco_medio_meta: req.query.preco_medio_meta,
      catalogo: req.query.catalogo !== '0',
      limit: req.query.limit,
    });
    if (!resultado.data.length) {
      return res.json({ data: [], total: 0, ...resultado });
    }
    const ids = resultado.data.map((r) => parseInt(r.cod_produto, 10)).filter(Boolean);
    const enrichedMap = await _fetchProdutosEnriquecidosPorIds(pool, tb, ids, req, {
      idFornecedor,
      tabelaId,
    });
    const data = resultado.data
      .filter((r) => enrichedMap.has(parseInt(r.cod_produto, 10)))
      .map((r) => {
        const pid = parseInt(r.cod_produto, 10);
        const prod = enrichedMap.get(pid) || {};
        return {
          ...prod,
          cod_produto: pid,
          preco_unitario: r.preco_unitario,
          faixa_codigo: r.faixa_codigo,
          faixa_label: r.faixa_label,
          preco_medio_meta: r.preco_medio_meta,
          hint_feirinha: `Custo até ${r.preco_medio_meta != null ? Number(r.preco_medio_meta).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—'} (${r.faixa_label})`,
        };
      });
    res.json({
      data,
      total: data.length,
      faixa_codigo: resultado.faixa_codigo,
      faixa_label: resultado.faixa_label,
      preco_medio_meta: resultado.preco_medio_meta,
      mensagem: resultado.mensagem || null,
    });
  } catch (err) {
    console.error('[/produtos/feirinha] ERRO:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pedidos/grade-historico/:id_produto/:id_cliente — último pedido com grade para esse produto/cliente
router.get('/grade-historico/:id_produto/:id_cliente', async (req, res) => {
  try {
    const { id_produto, id_cliente } = req.params;
    const pool = getPool();
    const bloqueioCli = await _validarCarteiraClientePedido(req, pool, id_cliente);
    if (bloqueioCli) return res.status(bloqueioCli.status).json({ error: bloqueioCli.error });

    // Busca o item mais recente desse produto para esse cliente que tenha grade
    const [itemRows] = await pool.query(
      `SELECT i.id AS id_item, p.numero, p.data_abertura
       FROM itensped i
       INNER JOIN pedidos p ON i.id_pedido = p.id
       WHERE i.cod_produto = ?
         AND p.cod_cliente = ?
         AND p.excluido = 'N'
         AND (i.excluido = 'N' OR i.excluido IS NULL)
         AND i.id_grade IS NOT NULL
       ORDER BY p.data_abertura DESC, p.id DESC
       LIMIT 1`,
      [id_produto, id_cliente]
    );
    if (!itemRows.length) return res.json({ historico: null });

    const { id_item, numero, data_abertura } = itemRows[0];
    const [gradeRows] = await getPool().query(
      `SELECT id_descricao_grade, nome_grade, quantidade, sequencial
       FROM itensped_grade_qtd WHERE id_item_ped = ? ORDER BY sequencial`,
      [id_item]
    );
    res.json({
      historico: {
        numpedido: numero,
        data: data_abertura,
        itens: gradeRows
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pedidos/grade-sugestao/:id_produto/:id_cliente — distribuição % média dos últimos N pedidos
router.get('/grade-sugestao/:id_produto/:id_cliente', async (req, res) => {
  try {
    const { id_produto, id_cliente } = req.params;
    const pool = getPool();
    const bloqueioCli = await _validarCarteiraClientePedido(req, pool, id_cliente);
    if (bloqueioCli) return res.status(bloqueioCli.status).json({ error: bloqueioCli.error });

    const N = 5;
    const [itemRows] = await pool.query(
      `SELECT i.id AS id_item
       FROM itensped i
       INNER JOIN pedidos p ON i.id_pedido = p.id
       WHERE i.cod_produto = ? AND p.cod_cliente = ?
         AND p.excluido = 'N' AND (i.excluido = 'N' OR i.excluido IS NULL)
         AND i.id_grade IS NOT NULL
       ORDER BY p.data_abertura DESC, p.id DESC
       LIMIT ?`,
      [id_produto, id_cliente, N]
    );
    if (!itemRows.length) return res.json({ sugestao: null });

    const ids = itemRows.map(r => r.id_item);
    const [gradeRows] = await getPool().query(
      `SELECT id_descricao_grade, nome_grade, sequencial, SUM(quantidade) AS total_qtd
       FROM itensped_grade_qtd WHERE id_item_ped IN (?)
       GROUP BY id_descricao_grade, nome_grade, sequencial ORDER BY sequencial`,
      [ids]
    );
    const totalGeral = gradeRows.reduce((s, r) => s + (parseFloat(r.total_qtd) || 0), 0);
    res.json({
      sugestao: {
        pedidos_analisados: itemRows.length,
        itens: gradeRows.map(r => ({
          id_descricao_grade: r.id_descricao_grade,
          nome_grade: r.nome_grade,
          sequencial: r.sequencial,
          percentual: totalGeral > 0 ? Math.round(parseFloat(r.total_qtd) / totalGeral * 1000) / 10 : 0
        }))
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pedidos/grade/:id_grade — itens da grade (descricao_grades) + modo/múltiplo
router.get('/grade/:id_grade', async (req, res) => {
  try {
    const pool = getPool();
    await ensureTipogradeColunas(pool);
    const idGrade = parseInt(req.params.id_grade, 10) || 0;
    const [[cab]] = await pool.query(
      `SELECT id, nome,
              COALESCE(modo_grade, 'A') AS modo_grade,
              COALESCE(multiplo_grade, 0) AS multiplo_grade
         FROM tipograde
        WHERE id = ? AND (excluido='N' OR excluido IS NULL OR excluido='')
        LIMIT 1`,
      [idGrade]
    ).catch(() => [[null]]);
    const [rows] = await pool.query(
      `SELECT id, nome, sequencial, COALESCE(qtd_minima,0) AS qtd_minima FROM descricao_grades
       WHERE id_grade = ? AND excluido = 'N'
       ORDER BY sequencial`,
      [idGrade]
    );
    res.json({
      itens: rows,
      modo_grade: cab?.modo_grade || 'A',
      multiplo_grade: cab?.multiplo_grade || 0,
      nome: cab?.nome || '',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pedidos/lookup/produtos-avancado
router.get('/lookup/produtos-avancado', async (req, res) => {
  try {
    const pool = getPool();
    const tb = await _getProdTabela(pool);
    await _ensureProdCols(pool);
    const { q = '', id_empresa, id_tabela_preco } = req.query;

    let sql = `
      SELECT
        p.id as cod_produto,
        p.cod_fabricante,
        p.cod_barras,
        p.unidade,
        p.descricao as desc_produto,
        p.comissao,
        p.ipi,
        p.vlr_custo,
        COALESCE(tpi.valor_tabela, p.vlr_venda) as vlr_venda,
        tpi.valor_tabela as preco_da_tabela,
        IFNULL(p.precoa, 0) as precoa, IFNULL(p.precob, 0) as precob,
        IFNULL(p.precoc, 0) as precoc, IFNULL(p.precopromo, 0) as precopromo,
        g.descricao as grupo_descricao,
        f.nome as familia_descricao,
        COALESCE(p.foto_principal, (
          SELECT CONCAT('/uploads/produtos/', p.id, '/', pi.filename)
          FROM produto_imagens pi
          WHERE CAST(pi.cod_produto AS UNSIGNED) = p.id
          ORDER BY pi.is_principal DESC, pi.id ASC
          LIMIT 1
        )) AS foto_principal,
        IFNULL(p.estoque_atual, 0) as estoque_atual,
        IFNULL(p.disponivel, 'S') as disponivel,
        IFNULL(p.bloquear_desconto, 'N') as bloquear_desconto,
        p.desconto_maximo
      FROM ${tb} p
      LEFT JOIN grupos g ON g.id = p.id_grupo
      LEFT JOIN familia_produtos f ON f.id = p.id_familiaproduto
    `;

    const params = [];

    // Só faz o JOIN com tabela de preço se o ID for válido e não estiver vazio
    if (id_tabela_preco && id_tabela_preco !== 'null' && id_tabela_preco !== 'undefined' && id_tabela_preco.trim() !== '') {
      sql += ` LEFT JOIN tabela_preco_itens tpi ON tpi.cod_produto = p.id AND tpi.id_tabela = ? AND tpi.excluido = 'N' AND tpi.ativo = 'S' `;
      params.push(id_tabela_preco);
    } else {
      // Se não tem tabela, garante que tpi.valor_tabela retorne NULL para o COALESCE funcionar
      sql += ` LEFT JOIN (SELECT NULL as valor_tabela, NULL as cod_produto) tpi ON 1=0 `;
    }

    sql += ` WHERE (p.excluido = 'N' OR p.excluido IS NULL) `;

    // Ignora id_empresa se estiver vazio ou 'null', conforme solicitação
    if (id_empresa && id_empresa !== 'null' && id_empresa !== 'undefined' && id_empresa.trim() !== '' && id_empresa !== '0') {
      sql += ` AND p.id_empresa = ? `;
      params.push(id_empresa);
    }

    if (q.trim()) {
      const busca = produtoBuscaOrSql('p', q, { includeId: true });
      sql += ` AND ${busca.fragment} `;
      params.push(...busca.params);
    }

    sql += ` ORDER BY p.descricao LIMIT 600 `;

    const [rows] = await pool.query(sql, params);
    const promoCtx = await _promoCtxFromPedidoQuery(pool, req.query);
    let produtos = await enrichProdutosComPromocao(pool, rows, { qtd: 1, ...promoCtx });
    if (isPrepostoUser(req)) {
      produtos = stripProdutosComissaoRep(produtos);
    }
    res.json({ produtos });
  } catch (err) {
    console.error('Erro lookup produtos:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pedidos/config/grid — Busca o layout salvo do usuário
router.get('/config/grid', async (req, res) => {
  try {
    const pool = getPool();
    ensureTablesOnce(pool);
    const id_usuario = req.user?.id;
    if (!id_usuario) {
      return res.status(401).json({ error: 'Usuário não identificado no token' });
    }
    const [rows] = await pool.query(
      `SELECT config_json FROM preferencias_grid WHERE id_usuario = ? AND nome_grid = 'pedidos'`,
      [id_usuario]
    );
    const cfg = parsePreferenciasGridConfigJson(rows[0]?.config_json);
    res.json({ config: cfg && cfg.length ? cfg : null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pedidos/config/itens-colunas — colunas da grade de itens (tela + relatório)
router.get('/config/itens-colunas', async (req, res) => {
  try {
    const pool = getPool();
    ensureTablesOnce(pool);
    const id_usuario = req.user?.id;
    if (!id_usuario) return res.status(401).json({ error: 'Usuário não identificado no token' });
    const [rows] = await pool.query(
      `SELECT config_json FROM preferencias_grid WHERE id_usuario = ? AND nome_grid = 'pedidos_itens_colunas'`,
      [id_usuario]
    );
    const cfg = parseItensColunasConfigJson(rows[0]?.config_json);
    res.json({ config: cfg && Object.keys(cfg).length ? cfg : null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pedidos/config/itens-colunas
router.post('/config/itens-colunas', async (req, res) => {
  try {
    const pool = getPool();
    ensureTablesOnce(pool);
    const id_usuario = req.user?.id;
    if (!id_usuario) return res.status(401).json({ error: 'Usuário não identificado no token' });
    const { config } = req.body;
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      return res.status(400).json({ error: 'config deve ser um objeto' });
    }
    const json = JSON.stringify(config);
    const dtBr = mysqlDatetimeBrasil();
    await pool.query(
      `INSERT INTO preferencias_grid (id_usuario, nome_grid, config_json, dt_alterado)
       VALUES (?, 'pedidos_itens_colunas', ?, ?)
       ON DUPLICATE KEY UPDATE config_json = ?, dt_alterado = ?`,
      [id_usuario, json, dtBr, json, dtBr]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[pedidos/config/itens-colunas] POST', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pedidos/config/grid — Salva layout (JSON na tabela preferencias_grid)
router.post('/config/grid', async (req, res) => {
  try {
    const pool = getPool();
    ensureTablesOnce(pool);
    const id_usuario = req.user?.id;
    if (!id_usuario) {
      return res.status(401).json({ error: 'Usuário não identificado no token' });
    }
    const { config } = req.body;
    if (!Array.isArray(config)) {
      return res.status(400).json({ error: 'config deve ser um array de colunas' });
    }
    const json = JSON.stringify(config);
    const dtBr = mysqlDatetimeBrasil();
    await pool.query(
      `INSERT INTO preferencias_grid (id_usuario, nome_grid, config_json, dt_alterado) 
       VALUES (?, 'pedidos', ?, ?) 
       ON DUPLICATE KEY UPDATE config_json = ?, dt_alterado = ?`,
      [id_usuario, json, dtBr, json, dtBr]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[pedidos/config/grid] POST', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pedidos/comissoes-faturamento/:id — consolida parcelas, provisões e divisão (somente leitura)
async function getComissoesFaturamentoHandler(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'ID inválido' });
    const pool = getPool();

    const [rows] = await pool.query(`
      SELECT p.*,
        COALESCE(u.nomeusu, p.nome_vendedor, '') AS nome_vendedor_display,
        COALESCE(f.com_sobre_st,'S') AS com_sobre_st,
        COALESCE(f.com_sobre_ipi,'S') AS com_sobre_ipi,
        COALESCE(f.com_tipo,'PARCELADA') AS com_tipo
      FROM pedidos p
      LEFT JOIN usuarios u ON u.idusuario = p.id_usuario
      LEFT JOIN fornecedores f ON f.id = p.cod_fornecedor
      WHERE p.id = ? AND COALESCE(p.excluido,'N')='N'
      LIMIT 1
    `, [id]);
    if (!rows.length) return res.status(404).json({ error: 'Pedido não encontrado' });

    const ped = rows[0];
    const num = ped.numero;
    const idUsuario = ped.id_usuario;

    const [parcelasRaw] = await pool.query(`
      SELECT id, parcela, qt_parcelas, vencimento, valor, vlrreceber, status, forma_pagto
      FROM receber
      WHERE numero = ? AND COALESCE(excluido,'N')='N'
      ORDER BY parcela ASC
    `, [num]).catch(() => [[]]);

    const [comVend] = await pool.query(`
      SELECT id_parcela, SUM(vlr_pago) AS vlr_comissao
      FROM pagtocomissao
      WHERE pedido = ? AND COALESCE(excluido,'N')='N'
        AND cod_user = ? AND (id_preposto IS NULL OR id_preposto = 0)
        AND COALESCE(observacao,'') NOT LIKE '%gerente%'
        AND COALESCE(observacao,'') NOT LIKE '%preposto%'
      GROUP BY id_parcela
    `, [num, idUsuario]).catch(() => [[]]);
    const comMap = {};
    for (const c of comVend) comMap[c.id_parcela] = parseFloat(c.vlr_comissao) || 0;

    let totalIpi = 0, totalSt = 0;
    const fornConfig = { com_sobre_st: ped.com_sobre_st, com_sobre_ipi: ped.com_sobre_ipi };
    if (fornConfig.com_sobre_st !== 'S' || fornConfig.com_sobre_ipi !== 'S') {
      const [impos] = await pool.query(
        `SELECT COALESCE(SUM(vlr_ipi),0) AS ipi, COALESCE(SUM(vlr_st),0) AS st
         FROM itensped WHERE id_pedido = ? AND COALESCE(excluido, 'N') = 'N'`,
        [id]
      ).catch(() => [[{ ipi: 0, st: 0 }]]);
      totalIpi = parseFloat(impos[0]?.ipi || 0);
      totalSt  = parseFloat(impos[0]?.st  || 0);
    }

    const totalParcelas = parcelasRaw.reduce((s, p) => s + (parseFloat(p.valor) || parseFloat(p.vlrreceber) || 0), 0);
    const pctCom = parseFloat(ped.comissao) || 0;

    const parcelas = parcelasRaw.map(p => {
      const valor = parseFloat(p.valor) || parseFloat(p.vlrreceber) || 0;
      let vlrComissao = comMap[p.id];
      if (vlrComissao == null && pctCom > 0) {
        let base = valor;
        if (totalParcelas > 0 && (fornConfig.com_sobre_ipi !== 'S' || fornConfig.com_sobre_st !== 'S')) {
          const prop = valor / totalParcelas;
          if (fornConfig.com_sobre_ipi !== 'S') base -= totalIpi * prop;
          if (fornConfig.com_sobre_st  !== 'S') base -= totalSt  * prop;
          if (base < 0) base = 0;
        }
        vlrComissao = Math.round(base * pctCom / 100 * 100) / 100;
      }
      return {
        id: p.id,
        parcela: p.parcela,
        qt_parcelas: p.qt_parcelas,
        vencimento: p.vencimento,
        valor_cliente: valor,
        vlr_comissao: vlrComissao || 0,
        status_parcela: p.status,
        forma_pagto: p.forma_pagto
      };
    });

    const totalComissao = parcelas.reduce((s, p) => s + (p.vlr_comissao || 0), 0);

    const divisao = [];
    const nomeVend = (ped.nome_vendedor_display || ped.nome_vendedor || 'Vendedor').trim();
    divisao.push({
      tipo: 'VENDEDOR',
      nome: nomeVend,
      percentual: pctCom,
      origem: ped.origem_comissao || 'FORNECEDOR'
    });

    if (String(ped.compartilhacomissao || '').toUpperCase() === 'S' && parseFloat(ped.comissaogerente) > 0) {
      let nomeGerente = 'Gerente';
      if (idUsuario) {
        const [gr] = await pool.query(`
          SELECT g.nomeusu FROM usuarios v
          JOIN usuarios g ON g.idusuario = v.id_gerente
          WHERE v.idusuario = ? LIMIT 1
        `, [idUsuario]).catch(() => [[]]);
        if (gr[0]) nomeGerente = gr[0].nomeusu;
      }
      divisao.push({
        tipo: 'GERENTE',
        nome: nomeGerente,
        percentual: parseFloat(ped.comissaogerente) || 0,
        origem: 'SOBRE_COMISSAO'
      });
    }

    if (ped.id_preposto) {
      let pctPrep = 0;
      if (ped.cod_fornecedor) {
        const [pcf] = await pool.query(
          `SELECT pct_comissao FROM preposto_comissao_fornecedor WHERE id_usuario = ? AND id_fornecedor = ? LIMIT 1`,
          [ped.id_preposto, ped.cod_fornecedor]
        ).catch(() => [[]]);
        if (pcf[0]) pctPrep = parseFloat(pcf[0].pct_comissao) || 0;
      }
      const [pr] = await pool.query(
        `SELECT nomeusu, COALESCE(comissao_preposto_pct,6) AS pct FROM usuarios WHERE idusuario = ?`,
        [ped.id_preposto]
      ).catch(() => [[]]);
      if (pr[0]) {
        if (!pctPrep) pctPrep = parseFloat(pr[0].pct) || 6;
        divisao.push({
          tipo: 'PREPOSTO',
          nome: pr[0].nomeusu || ped.nome_preposto || 'Preposto',
          percentual: pctPrep,
          origem: pctPrep !== (parseFloat(pr[0].pct) || 6) ? 'POR_FORNECEDOR' : 'PADRAO'
        });
      }
    }

    const faturado = String(ped.informado_faturamento || '').toUpperCase() === 'S' ||
      String(ped.situacao_pedido || '').toUpperCase() === 'FATURADO';

    const payload = sanitizeComissoesFaturamentoForPreposto({
      pedido: {
        id: ped.id,
        numero: ped.numero,
        nome_cliente: ped.nome_cliente,
        nome_fornecedor: ped.nome_fornecedor,
        vlrtotalpedido: parseFloat(ped.vlrtotalpedido) || 0,
        vlr_faturado: parseFloat(ped.vlr_faturado) || 0,
        data_faturado: ped.data_faturado,
        data_abertura: ped.data_abertura,
        numeronf: ped.numeronf,
        serie_nf: ped.serie_nf,
        nf_fabrica: ped.nf_fabrica,
        notarecebida: ped.notarecebida,
        situacao_pedido: ped.situacao_pedido,
        comissao: pctCom,
        vlr_total_comissao: parseFloat(ped.vlr_total_comissao) || totalComissao,
        vlr_comissao_preposto: parseFloat(ped.vlr_comissao_preposto) || 0,
        condicao_pagto: ped.condicao_pagto
      },
      faturamento: {
        status: faturado ? 'faturado' : 'previsao',
        data: faturado ? ped.data_faturado : (ped.data_entrega || ped.data_abertura),
        valor: faturado
          ? (parseFloat(ped.vlr_faturado) || parseFloat(ped.vlrtotalpedido) || 0)
          : (parseFloat(ped.vlrtotalpedido) || 0),
        numeronf: ped.numeronf,
        notarecebida: ped.notarecebida
      },
      parcelas,
      divisao,
      total_comissao_prevista: Math.round(totalComissao * 100) / 100,
      nota_st: fornConfig.com_sobre_st !== 'S',
      nota_ipi: fornConfig.com_sobre_ipi !== 'S'
    }, req, ped.id_preposto);

    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

router.get('/comissoes-faturamento/:id', getComissoesFaturamentoHandler);
router.get('/:id/comissoes-faturamento', getComissoesFaturamentoHandler);

// POST /api/pedidos/:id/marcar-enviado — Marcar / desmarcar enviado p/ representada
router.post('/:id/marcar-enviado', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'ID inválido' });
    const desmarcar = req.body?.desmarcar === true || req.body?.acao === 'desmarcar';
    const pool = getPool();
    const id_usuario_log = req.user?.id || 0;

    const [atual] = await pool.query(
      `SELECT situacao_pedido, numero FROM pedidos WHERE id = ? AND COALESCE(excluido,'N')='N' LIMIT 1`,
      [id]
    );
    if (!atual.length) return res.status(404).json({ error: 'Pedido não encontrado' });

    const sitAtual = (atual[0].situacao_pedido || '').toUpperCase();
    if (sitAtual === 'CANCELADO') {
      return res.status(400).json({ error: 'Pedido cancelado não pode ser alterado' });
    }
    if (sitAtual === 'FATURADO') {
      return res.status(400).json({ error: 'Pedido faturado não pode ser alterado desta forma' });
    }

    if (desmarcar) {
      if (sitAtual !== 'ENVIADO') {
        return res.json({ ok: true, desmarcado: false, situacao_pedido: sitAtual });
      }

      // Verifica permissão desbloquear_pedido_enviado (admin sempre pode)
      const isAdminDesbloq = req.user?.perfil == 1 || req.user?.isAdmin;
      const permDesbloq = req.user?.permissoes?.desbloquear_pedido_enviado;
      if (!isAdminDesbloq && permDesbloq !== 'S') {
        return res.status(403).json({
          error: 'Você não tem permissão para desbloquear pedidos enviados à representada.',
          bloqueio: 'PEDIDO_ENVIADO_SEM_PERMISSAO'
        });
      }

      // Quem tem permissão precisa confirmar senha
      const senhaInformada = req.body?.senha;
      if (!senhaInformada) {
        return res.status(403).json({ error: 'Informe sua senha para desbloquear.', bloqueio: 'PEDIDO_ENVIADO_SENHA' });
      }
      const [uRows] = await pool.query(
        `SELECT senhausu FROM usuarios WHERE idusuario = ? AND SITUACAO='ATIVO' AND excluido='N' LIMIT 1`,
        [id_usuario_log]
      ).catch(() => [[]]);
      if (!uRows[0] || uRows[0].senhausu.trim().toUpperCase() !== senhaInformada.trim().toUpperCase()) {
        return res.status(401).json({ error: 'Senha inválida.', bloqueio: 'PEDIDO_ENVIADO_SENHA' });
      }

      const [logRows] = await pool.query(
        `SELECT status_antigo FROM logs_pedidos
         WHERE id_pedido = ? AND UPPER(status_novo) = 'ENVIADO'
         ORDER BY data_hora DESC LIMIT 1`,
        [id]
      ).catch(() => [[]]);

      let novoStatus = String(logRows[0]?.status_antigo || 'APROVADO').toUpperCase();
      if (!novoStatus || novoStatus === 'ENVIADO' || novoStatus === 'CANCELADO' || novoStatus === 'FATURADO') {
        novoStatus = 'APROVADO';
      }

      await pool.query(
        `UPDATE pedidos SET situacao_pedido = ?, status = ? WHERE id = ?`,
        [novoStatus, novoStatus, id]
      );

      await pool.query(
        `INSERT INTO logs_pedidos (id_pedido, id_usuario, acao, status_antigo, status_novo, detalhes)
         VALUES (?, ?, 'MUDANCA_STATUS', 'ENVIADO', ?, ?)`,
        [id, id_usuario_log, novoStatus, JSON.stringify({ origem: 'desmarcar_enviado_representada' })]
      ).catch(() => {});

      return res.json({ ok: true, desmarcado: true, situacao_pedido: novoStatus });
    }

    if (sitAtual === 'ENVIADO') {
      return res.json({ ok: true, situacao_pedido: 'ENVIADO' });
    }

    await pool.query(
      `UPDATE pedidos SET situacao_pedido = 'ENVIADO', status = 'ENVIADO' WHERE id = ?`,
      [id]
    );

    await pool.query(
      `INSERT INTO logs_pedidos (id_pedido, id_usuario, acao, status_antigo, status_novo, detalhes)
       VALUES (?, ?, 'MUDANCA_STATUS', ?, 'ENVIADO', ?)`,
      [id, id_usuario_log, atual[0].situacao_pedido, JSON.stringify({ origem: 'marcar_enviado_representada' })]
    ).catch(() => {});

    res.json({ ok: true, situacao_pedido: 'ENVIADO' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pedidos/:id/faturar — registra faturamento sem reprocessar itens/parcelas
router.post('/:id/faturar', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'ID inválido' });

    const {
      numeronf, serie_nf, nf_fabrica, data_faturado, vlr_faturado, notarecebida,
      info_adicional, comissoes_parcelas
    } = req.body || {};
    const pool = getPool();
    const id_usuario_log = req.user?.id || 0;

    const [atual] = await pool.query(
      `SELECT p.situacao_pedido, p.numero, p.vlrtotalpedido, p.cod_fornecedor, p.id_usuario,
              COALESCE(f.recalc_comissao_fatur,'N') AS recalc_comissao_fatur
       FROM pedidos p
       LEFT JOIN fornecedores f ON f.id = p.cod_fornecedor
       WHERE p.id = ? LIMIT 1`,
      [id]
    );
    if (!atual.length) return res.status(404).json({ error: 'Pedido não encontrado' });

    const dataFat  = data_faturado || new Date().toISOString().slice(0, 10);
    const vlrFat   = parseFloat(vlr_faturado) || 0;
    const numPed   = atual[0].numero;
    const idVend   = atual[0].id_usuario;

    await pool.query(
      `UPDATE pedidos SET
         situacao_pedido      = 'FATURADO',
         informado_faturamento = 'S',
         data_faturado        = ?,
         vlr_faturado         = ?,
         numeronf             = ?,
         nf_fabrica           = ?,
         serie_nf             = ?,
         notarecebida         = ?
       WHERE id = ?`,
      [
        dataFat,
        vlrFat,
        numeronf   || null,
        nf_fabrica || null,
        serie_nf   || null,
        notarecebida === 'S' ? 'S' : 'N',
        id
      ]
    );

    // Débito automático de estoque ao faturar
    const { debitarEstoquesPedido } = require('../config/estoque-movimentacao');
    debitarEstoquesPedido(pool, id, req.user?.id, req.user?.name || req.user?.nomeusu || req.user?.nome)
      .catch(e => console.warn('[estoque] faturamento:', e.message));

    // Ajustes manuais de comissão por parcela (modal Faturar pedido)
    if (Array.isArray(comissoes_parcelas) && comissoes_parcelas.length) {
      for (const cp of comissoes_parcelas) {
        const idParc = cp.id_parcela ? parseInt(cp.id_parcela, 10) : null;
        const dtParc = _toMysqlDate(cp.data) || dataFat;
        if (cp.excluir && idParc) {
          await pool.query(
            `DELETE FROM pagtocomissao
             WHERE pedido = ? AND id_parcela = ? AND status = 'P'
               AND cod_user = ? AND (id_preposto IS NULL OR id_preposto = 0)
               AND COALESCE(observacao,'') NOT LIKE '%gerente%'
               AND COALESCE(observacao,'') NOT LIKE '%preposto%'`,
            [numPed, idParc, idVend]
          ).catch(() => {});
          continue;
        }
        const vlrCom = parseFloat(cp.vlr_comissao);
        if (!Number.isFinite(vlrCom) || vlrCom <= 0) continue;
        if (idParc) {
          await pool.query(
            `UPDATE pagtocomissao
             SET vlr_pago = ?, vlr_pago_original = COALESCE(vlr_pago_original, vlr_pago),
                 data_pagar = ?, data_movimento = ?
             WHERE pedido = ? AND id_parcela = ? AND status = 'P'
               AND cod_user = ? AND (id_preposto IS NULL OR id_preposto = 0)
               AND COALESCE(observacao,'') NOT LIKE '%gerente%'
               AND COALESCE(observacao,'') NOT LIKE '%preposto%'`,
            [vlrCom, vlrCom, dtParc, dtParc, numPed, idParc, idVend]
          ).catch(() => {});
        } else {
          await pool.query(
            `INSERT INTO pagtocomissao
             (data_lancamento, data_movimento, data_pagar, data_pagamento, data_confirmacao,
              vlr_pago, vlr_pago_original, cod_user, pedido, id_parcela, status, observacao)
             VALUES (CURDATE(), ?, ?, ?, CURDATE(), ?, ?, ?, ?, NULL, 'P', 'Comissão incluída no faturamento manual')`,
            [dtParc, dtParc, vlrCom, vlrCom, idVend, numPed]
          ).catch(() => {});
        }
      }
    }

    // Recalcula provisões de comissão proporcionalmente ao valor faturado
    let comissaoRecalc = null;
    if (atual[0].recalc_comissao_fatur === 'S' && vlrFat > 0 && !(Array.isArray(comissoes_parcelas) && comissoes_parcelas.length)) {
      const vlrPedido = parseFloat(atual[0].vlrtotalpedido) || 0;
      if (vlrPedido > 0 && Math.abs(vlrFat - vlrPedido) > 0.01) {
        const ratio = vlrFat / vlrPedido;
        const [upd] = await pool.query(
          `UPDATE pagtocomissao
           SET vlr_pago = ROUND(COALESCE(vlr_pago_original, vlr_pago) * ?, 4)
           WHERE pedido = ? AND status = 'P'`,
          [ratio, numPed]
        );
        comissaoRecalc = { ratio: Math.round(ratio * 10000) / 10000, parcelas: upd.affectedRows };
      }
    }

    await pool.query(
      `INSERT INTO logs_pedidos (id_pedido, id_usuario, acao, status_antigo, status_novo, detalhes)
       VALUES (?, ?, 'FATURAMENTO', ?, 'FATURADO', ?)`,
      [id, id_usuario_log, atual[0].situacao_pedido,
       JSON.stringify({
         numeronf, serie_nf, nf_fabrica, data_faturado: dataFat, vlr_faturado: vlrFat,
         info_adicional: info_adicional || null, comissaoRecalc
       })]
    ).catch(() => {});

    res.json({ ok: true, comissaoRecalc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/edit-lock', async (req, res) => {
  try {
    const rawId = req.params.id;
    if (!/^\d+$/.test(String(rawId))) return res.status(400).json({ error: 'ID inválido' });
    const action = (req.body && req.body.action) || 'acquire';
    const uid = req.user?.id;
    const uname = req.user?.name || req.user?.login || req.user?.nome || 'Usuário';
    const tenantKey = pedidoEditTenantKey(req);
    const clientIp = String(req.ip || req.socket?.remoteAddress || '').trim();

    if (action === 'acquire') {
      const pool = getPool();
      const hostHint = String(
        (req.body && req.body.clientHost) ||
        req.headers['x-client-hostname'] ||
        ''
      ).trim();
      const clientHost = await resolvePedidoEditClientHost(pool, hostHint, clientIp);
      const r = tryAcquirePedidoEditLock(tenantKey, rawId, uid, uname, { clientHost, clientIp });
      if (!r.ok) {
        return res.status(409).json({
          error: 'Este pedido já está em edição por outro usuário.',
          lockedBy: r.lockedBy,
          lockedHost: r.lockedHost,
          lockedIp: r.lockedIp,
          lockedSince: r.lockedSince
        });
      }
      return res.json({ ok: true, clientHost });
    }
    if (action === 'ping') {
      const ok = renewPedidoEditLock(tenantKey, rawId, uid);
      return res.json({ ok: !!ok });
    }
    if (action === 'release') {
      releasePedidoEditLock(tenantKey, rawId, uid);
      return res.json({ ok: true });
    }
    return res.status(400).json({ error: 'Ação inválida' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pedidos/ultimo-por-cliente/:id_cliente — último pedido do cliente (para repetir)
router.get('/ultimo-por-cliente/:id_cliente', async (req, res) => {
  try {
    const pool = getPool();
    const idCliente = parseInt(req.params.id_cliente, 10);
    if (!idCliente) return res.status(400).json({ error: 'Cliente inválido' });

    const _userId = req.user?.id || 0;
    const _isAdmin = req.user?.perfil == 1;
    const _perm = req.user?.permissoes || {};
    const _acessaVendasTodos = canAccessAllVendors(req);
    const _eGerente = !_isAdmin && _perm.gerentecomercial === 'S';
    const _prepCtxHist = await getPrepostoContext(pool, req);

    let visWhere = '';
    const visParams = [];
    if (!_isAdmin && !_acessaVendasTodos) {
      if (_eGerente) {
        visWhere = ` AND (p.id_usuario = ? OR p.id_usuario IN (SELECT idusuario FROM usuarios WHERE id_gerente = ? AND excluido = 'N'))`;
        visParams.push(_userId, _userId);
      } else if (_prepCtxHist) {
        if (_prepCtxHist.pedidosVisib === 'PROPRIOS') {
          // Preposto restrito: só os pedidos que ele mesmo lançou
          visWhere = ` AND p.id_preposto = ?`;
          visParams.push(_prepCtxHist.idPreposto);
        } else {
          // Histórico da carteira do representante + seus próprios pedidos
          visWhere = ` AND (p.id_usuario = ? OR p.id_preposto = ?)`;
          visParams.push(_prepCtxHist.idRep, _prepCtxHist.idPreposto);
        }
      } else {
        visWhere = ` AND p.id_usuario = ?`;
        visParams.push(_userId);
      }
    }

    const [rows] = await pool.query(
      `SELECT p.id, p.numero, p.data_abertura, p.tipo_pedido, p.nome_fornecedor, p.vlrtotalpedido,
              p.cod_fornecedor, p.nome_cliente, p.total_qt, p.condicao_pagto, p.forma_pagto,
              (SELECT COUNT(*) FROM itensped i
               WHERE i.id_pedido = p.id AND (i.excluido = 'N' OR i.excluido IS NULL OR i.excluido = '')) AS qt_itens
       FROM pedidos p
       WHERE p.cod_cliente = ?
         AND (p.excluido = 'N' OR p.excluido IS NULL OR p.excluido = '')
         ${visWhere}
       ORDER BY p.data_abertura DESC, p.id DESC
       LIMIT 1`,
      [idCliente, ...visParams]
    );

    res.json({ pedido: rows[0] || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pedidos/offline-pack — dados locais para pedido novo offline (v1)
router.get('/offline-pack', async (req, res) => {
  try {
    const pool = getPool();
    const tb = await _getProdTabela(pool);
    await _ensureProdCols(pool);

    const idUsuario = req.user?.id || 0;
    const isAdmin = req.user?.perfil == 1;

    const [permRows] = await pool.query(`
      SELECT p.acessartodosclientes, p.acessar_vendastodos, p.gerentecomercial,
             p.acessar_configuracoes, p.alterar_configuracoes, p.manutencaocadastros,
             p.acessogerenciais, p.acessoperfil, p.mudarempresa, p.tela_usuarios,
             p.alterardatapedido, p.trocarvendedorpedido, p.p_vender
      FROM usuarios u
      INNER JOIN perfil p ON p.id = u.idperfil
      WHERE u.idusuario = ? AND u.excluido = 'N' LIMIT 1
    `, [idUsuario]).catch(() => [[]]);
    const permDb = permRows[0] || {};

    const permJwt = req.user?.permissoes || {};
    const userCliente = {
      ...req.user,
      permissoes: { ...permJwt, ...permDb },
    };
    const prepCtxPack = await getPrepostoContext(pool, req);
    const vendCli = buildClienteVendedorWhere(userCliente, 'c', prepCtxPack);
    const qCli = `SELECT c.* FROM clientes c WHERE (c.excluido = 'N' OR c.excluido IS NULL OR c.excluido = '')${vendCli.clause} ORDER BY c.nome`;
    const [clientes] = await pool.query(qCli, vendCli.params);

    const [fornecedores] = await pool.query(`
      SELECT * FROM fornecedores
      WHERE (excluido = 'N' OR excluido IS NULL OR excluido = '')
        AND COALESCE(tipo, 'FABRICA') = 'FABRICA'
      ORDER BY nome
    `);

    const [fornCondRows] = await pool.query(`
      SELECT fcp.id_fornecedor, fcp.id_condicao, fcp.valor_minimo,
             fp.descricao, fp.prazopadrao
      FROM fornecedor_condicoes_pagamento fcp
      INNER JOIN forma_pagto fp ON fp.id = fcp.id_condicao
      WHERE fcp.excluido = 'N'
      ORDER BY fp.descricao
    `).catch(() => [[]]);
    const fornecedorCondicoes = {};
    for (const row of fornCondRows) {
      const k = String(row.id_fornecedor);
      if (!fornecedorCondicoes[k]) fornecedorCondicoes[k] = [];
      fornecedorCondicoes[k].push(row);
    }

    const [vendedores] = await pool.query(`
      SELECT u.idusuario AS id, u.nomeusu AS nome_vendedor, u.nomeusu AS nome,
             p.acessartodosclientes, p.alterardatapedido, u.rota_vendedor, u.email,
             u.comissaofixavendedor, u.comissaogerente, u.permitevendasemcomissao,
             u.compartilhacomissaogerente, u.fonesecundario
      FROM usuarios u
      INNER JOIN perfil p ON p.id = u.idperfil
      WHERE u.excluido = 'N'
        AND (u.situacao = 'ATIVO' OR u.situacao IS NULL)
        AND p.excluido = 'N' AND p.p_vender = 'S'
      ORDER BY u.nomeusu
    `).catch(() => [[]]);

    const [tiposPedido] = await pool.query(`
      SELECT id, gerafinanceiro, movimentaestoque, descricao AS tipo_pedido, tratamento
      FROM tipo_pedidos WHERE excluido = 'N' AND situacao = 'A' ORDER BY id
    `).catch(() => [[]]);

    const [tiposFrete] = await pool.query(`
      SELECT p.* FROM tipo_frete p WHERE p.excluido = 'N' AND p.status = 'A' ORDER BY p.nome DESC
    `).catch(() => [[]]);

    const [empresas] = await pool.query(`
      SELECT * FROM empresa WHERE excluido = 'N' ORDER BY Razao_empresa DESC
    `).catch(() => [[]]);

    const [transportadoras] = await pool.query(`
      SELECT id, nome FROM transportadoras
      WHERE (excluido = 'N' OR excluido IS NULL)
      ORDER BY nome LIMIT 3000
    `).catch(() => [[]]);

    const [condicoesPagto] = await pool.query(`
      SELECT id, descricao, prazopadrao FROM forma_pagto
      WHERE (excluido = 'N' OR excluido IS NULL) ORDER BY descricao
    `).catch(() => [[]]);

    const [sysRows] = await pool.query('SELECT * FROM sistemas ORDER BY id DESC LIMIT 1').catch(() => [[]]);
    const sistema = sysRows[0] || {};

    const [vinculosTabela] = await pool.query(`
      SELECT v.id_entidade, v.tipo_entidade, v.id_tabela, c.Descricao AS descricao
      FROM tabela_preco_vinculo v
      JOIN tabela_preco_cabecalho c ON c.id = v.id_tabela
      WHERE v.excluido = 'N' AND c.excluido = 'N' AND c.Tabela_Ativa = 'S'
    `).catch(() => [[]]);

    const tabelaIds = [...new Set(vinculosTabela.map(v => v.id_tabela).filter(Boolean))];
    const produtosPorTabela = {};

    for (const tid of tabelaIds) {
      const [prods] = await pool.query(`
        SELECT p.ID AS id, p.ID AS cod_produto,
               p.cod_fabricante, p.cod_barras, p.segmento, p.descricao, p.descricao AS desc_produto,
               p.unidade,
               COALESCE(tpi.valor_tabela, tpi.preco_venda, p.vlr_venda) AS vlr_venda,
               p.ipi, p.comissao,
               IFNULL(p.st, 0) AS st,
               IFNULL(p.icms, 0) AS icms,
               IFNULL(p.valor_puxada, 0) AS valor_puxada,
               IFNULL(p.kilo_embalagem, 0) AS kilo_embalagem,
               IFNULL(p.precopeso, 'N') AS precopeso,
               IFNULL(p.multiplo_venda, 1) AS multiplo_venda,
               IFNULL(p.qtd_minima_pedido, 0) AS qtd_minima_pedido,
               IFNULL(p.estoque_atual, 0) AS estoque_atual,
               IFNULL(p.disponivel, 'S') AS disponivel,
               COALESCE(p.foto_principal, (
                 SELECT CONCAT('/uploads/produtos/', p.ID, '/', pi.filename)
                 FROM produto_imagens pi
                 WHERE CAST(pi.cod_produto AS UNSIGNED) = p.ID
                 ORDER BY pi.is_principal DESC, pi.id ASC
                 LIMIT 1
               )) AS foto_principal,
               IFNULL(p.tipograde, 0) AS tipograde,
               IFNULL(p.solado, '') AS solado,
               IFNULL(p.tipoprodutograde, '') AS tipoprodutograde,
               CAST(p.cod_fornecedorpadrao AS UNSIGNED) AS cod_fornecedorpadrao,
               tpi.valor_tabela, tpi.preco_venda
        FROM tabela_preco_itens tpi
        INNER JOIN ${tb} p ON CAST(tpi.cod_produto AS UNSIGNED) = p.ID
        WHERE tpi.id_tabela = ?
          AND (tpi.excluido = 'N' OR tpi.excluido IS NULL OR tpi.excluido = '')
          AND tpi.ativo = 'S'
          AND (p.excluido = 'N' OR p.excluido IS NULL OR p.excluido = '')
          AND p.situacao = 'A'
        ORDER BY p.descricao
      `, [tid]).catch(() => [[]]);
      produtosPorTabela[String(tid)] = prods;
    }

    const [produtoFornecedor] = await pool.query(`
      SELECT CAST(pf.cod_produto AS UNSIGNED) AS cod_produto,
             CAST(pf.cod_fornecedor AS UNSIGNED) AS cod_fornecedor
      FROM produtofornecedor pf
      WHERE (pf.excluido = 'N' OR pf.excluido IS NULL OR pf.excluido = '')
        AND pf.status = 'A'
    `).catch(() => [[]]);

    const [prepostos] = await pool.query(`
      SELECT idusuario AS id, nomeusu AS nome FROM usuarios
      WHERE excluido = 'N' AND id_gerente = ? AND tipo_usuario = 'PREPOSTO'
      ORDER BY nomeusu
    `, [idUsuario]).catch(() => [[]]);

    const prepostoVenCtx = {};
    const venIdsPack = new Set([idUsuario, ...prepostos.map((p) => p.id)]);
    for (const vid of venIdsPack) {
      if (!vid) continue;
      const ctx = await resolverVendedorTabelaPreco(pool, vid);
      if (ctx) prepostoVenCtx[String(vid)] = ctx;
    }

    const [gradeRows] = await pool.query(`
      SELECT id_grade, id, nome, sequencial, COALESCE(qtd_minima, 0) AS qtd_minima
      FROM descricao_grades
      WHERE excluido = 'N'
      ORDER BY id_grade, sequencial
    `).catch(() => [[]]);
    const gradesPorGrade = {};
    for (const g of gradeRows) {
      const k = String(g.id_grade);
      if (!gradesPorGrade[k]) gradesPorGrade[k] = [];
      gradesPorGrade[k].push(g);
    }

    const [multRows] = await pool.query(`
      SELECT cod_produto, id, sigla, descricao, fator FROM produto_multiplos
      WHERE (excluido = 'N' OR excluido IS NULL)
    `).catch(() => [[]]);
    const multiplosPorProduto = {};
    for (const m of multRows) {
      const k = String(m.cod_produto);
      if (!multiplosPorProduto[k]) multiplosPorProduto[k] = [];
      multiplosPorProduto[k].push(m);
    }

    const fornecedorPadrao = fornecedores.find(f => f.fornecedorpadraopedido === 'S') || null;

    // Histórico: últimos 3 pedidos por cliente do pack
    let historicoClientes = {};
    const cliIds = clientes.map(c => c.id).filter(Boolean);
    if (cliIds.length) {
      const [histRows] = await pool.query(`
        SELECT p.cod_cliente,
               p.numero_pedido,
               DATE(p.data_abertura) AS data_pedido,
               p.vlrtotalpedido,
               COALESCE(f.nomefantasia, f.nome, p.nome_fabrica, '') AS nome_fornecedor
        FROM pedidos p
        LEFT JOIN fornecedores f ON CAST(f.id AS UNSIGNED) = CAST(p.cod_fornecedorpadrao AS UNSIGNED)
        WHERE p.cod_cliente IN (?)
          AND COALESCE(p.excluido, 'N') = 'N'
          AND p.situacao_pedido NOT IN ('CANCELADO')
        ORDER BY p.cod_cliente, p.data_abertura DESC
        LIMIT 20000
      `, [cliIds]).catch(() => [[]]);
      for (const row of histRows) {
        const k = String(row.cod_cliente);
        if (!historicoClientes[k]) historicoClientes[k] = [];
        if (historicoClientes[k].length < 3) {
          historicoClientes[k].push({
            numero: row.numero_pedido,
            data: row.data_pedido,
            fornecedor: row.nome_fornecedor || '',
            total: parseFloat(row.vlrtotalpedido || 0)
          });
        }
      }
    }

    // Inadimplência: parcelas vencidas por cliente
    let clienteInadimplente = {};
    if (cliIds.length) {
      const [inadRows] = await pool.query(`
        SELECT cr.cod_cliente,
               COALESCE(SUM(cr.valor), 0) AS valor_vencido,
               COUNT(*) AS qtd_vencidas
        FROM contas_receber cr
        WHERE cr.vencimento < CURDATE()
          AND (cr.status IS NULL OR cr.status NOT IN ('BAIXADO', 'PAGO', 'B', 'Q'))
          AND cr.cod_cliente IN (?)
        GROUP BY cr.cod_cliente
      `, [cliIds]).catch(() => [[]]);
      for (const row of inadRows) {
        if ((row.qtd_vencidas || 0) > 0) {
          clienteInadimplente[String(row.cod_cliente)] = {
            valor_vencido: parseFloat(row.valor_vencido || 0),
            qtd_vencidas: parseInt(row.qtd_vencidas || 0, 10)
          };
        }
      }
    }

    const vendWherePack = buildPedidosVendedorWhereSync(req, null);
    const dtPedidosPack = addDaysIsoBrasil(-120);
    const [pedidosRecentes] = await pool.query(`
      SELECT p.id, p.numero, p.data_abertura, p.hora_abertura,
             p.cod_cliente, p.nome_cliente, p.cod_fornecedor, p.nome_fornecedor,
             p.id_usuario, p.nome_vendedor, p.vlrtotalpedido, p.total_qt, p.total_peso,
             p.qt_parcelas, p.tipo_pedido, p.situacao_pedido, p.origem, p.status,
             p.obs_proximo_pedido, p.obs_proximo_consumido,
             u.nomeusu
      FROM pedidos p
      LEFT JOIN usuarios u ON p.id_usuario = u.idusuario
      WHERE (p.excluido = 'N' OR p.excluido IS NULL OR p.excluido = '')
        AND p.data_abertura >= ?
        ${vendWherePack.clause}
      ORDER BY p.id DESC
      LIMIT 200
    `, [dtPedidosPack, ...vendWherePack.params]).catch(() => [[]]);

    const [kitItensRows] = await pool.query(`
      SELECT fki.id_fornecedor, fki.cod_produto, fki.quantidade, fki.sequencial,
             p.descricao AS nome_produto,
             IFNULL(p.multiplo_venda, 1) AS multiplo_venda,
             IFNULL(p.qtd_minima_pedido, 0) AS qtd_minima_pedido
      FROM fornecedor_kit_itens fki
      LEFT JOIN ${tb} p ON p.ID = fki.cod_produto
      WHERE fki.excluido = 'N'
      ORDER BY fki.id_fornecedor, fki.sequencial, fki.id
    `).catch(() => [[]]);
    const kitPedidoPorFornecedor = {};
    for (const row of kitItensRows) {
      const k = String(row.id_fornecedor);
      if (!kitPedidoPorFornecedor[k]) kitPedidoPorFornecedor[k] = { itens: [] };
      kitPedidoPorFornecedor[k].itens.push({
        cod_produto: row.cod_produto,
        quantidade: row.quantidade,
        sequencial: row.sequencial,
        nome_produto: row.nome_produto,
        desc_produto: row.nome_produto,
        multiplo_venda: row.multiplo_venda,
        qtd_minima_pedido: row.qtd_minima_pedido,
      });
    }

    let fornOut = fornecedores;
    let vendOut = vendedores;
    let prodOut = produtosPorTabela;
    if (isPrepostoUser(req)) {
      fornOut = fornecedores.map(stripFornecedorComissaoRep);
      vendOut = vendedores.map(stripVendedorComissaoRep);
      prodOut = {};
      for (const [k, arr] of Object.entries(produtosPorTabela)) {
        prodOut[k] = stripProdutosComissaoRep(arr);
      }
    }

    res.json({
      meta: {
        version: 1,
        generatedAt: new Date().toISOString(),
        userId: idUsuario,
        offlineDays: 7,
        stats: {
          clientes: clientes.length,
          fornecedores: fornecedores.length,
          tabelas: tabelaIds.length,
          produtos: Object.values(produtosPorTabela).reduce((n, arr) => n + arr.length, 0),
          grades: gradeRows.length,
          multiplos: multRows.length,
          pedidos: pedidosRecentes.length
        }
      },
      permissoes: {
        acessar_configuracoes: isAdmin ? 'S' : (permDb.acessar_configuracoes || 'N'),
        alterar_configuracoes: isAdmin ? 'S' : (permDb.alterar_configuracoes || 'N'),
        manutencaocadastros: isAdmin ? 'S' : (permDb.manutencaocadastros || 'N'),
        gtela_usuarios: isAdmin ? 'S' : (permDb.tela_usuarios || 'N'),
        mudarempresa: isAdmin ? 'S' : (permDb.mudarempresa || 'N'),
        alterardatapedido: isAdmin ? 'S' : (permDb.alterardatapedido || 'N'),
        trocarvendedorpedido: isAdmin ? 'S' : (permDb.trocarvendedorpedido || 'N'),
        p_vender: isAdmin ? 'S' : (permDb.p_vender || 'N'),
        acessartodosclientes: isAdmin ? 'S' : (permDb.acessartodosclientes || 'N'),
        acessar_vendastodos: isAdmin ? 'S' : (permDb.acessar_vendastodos || 'N'),
        gerentecomercial: isAdmin ? 'S' : (permDb.gerentecomercial || 'N'),
        isAdmin
      },
      sistema,
      clientes,
      fornecedores: fornOut,
      fornecedorCondicoes,
      vendedores: vendOut,
      tiposPedido,
      tiposFrete,
      empresas,
      transportadoras,
      condicoesPagto,
      vinculosTabela,
      prepostoVenCtx,
      produtosPorTabela: prodOut,
      produtoFornecedor,
      prepostos,
      fornecedorPadrao,
      gradesPorGrade,
      multiplosPorProduto,
      historicoClientes,
      clienteInadimplente,
      pedidosRecentes,
      kitPedidoPorFornecedor
    });
  } catch (err) {
    console.error('[offline-pack]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pedidos/events — SSE notificações de novos pedidos
router.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);

  const onNovoPedido = (info) => {
    res.write(`event: novo-pedido\ndata: ${JSON.stringify(info)}\n\n`);
  };

  pedidoEmitter.on('novo-pedido', onNovoPedido);

  req.on('close', () => {
    clearInterval(heartbeat);
    pedidoEmitter.off('novo-pedido', onNovoPedido);
  });
});

// GET /api/pedidos/obs-proximo — obs. pendente do último pedido (cliente + fábrica)
router.get('/obs-proximo', async (req, res) => {
  try {
    const codCliente = parseInt(req.query.cod_cliente, 10);
    const codFornecedor = parseInt(req.query.cod_fornecedor, 10);
    const excludeId = parseInt(req.query.exclude_id, 10) || null;
    if (!codCliente || !codFornecedor) return res.json({ pendente: null });

    const pool = getPool();
    const bloqueio = await _validarCarteiraClientePedido(req, pool, codCliente);
    if (bloqueio) return res.status(bloqueio.status).json({ error: bloqueio.error });

    await ensurePedidoObsProximoColumns(pool);
    const vis = await buildPedidosListVisWhere(pool, req);
    const params = [codCliente, codFornecedor];
    let exclSql = '';
    if (excludeId) {
      exclSql = ' AND p.id <> ?';
      params.push(excludeId);
    }

    const [[row]] = await pool.query(`
      SELECT p.id, p.numero, p.obs_proximo_pedido, p.data_abertura
      FROM pedidos p
      WHERE p.cod_cliente = ?
        AND p.cod_fornecedor = ?
        AND (p.excluido = 'N' OR p.excluido IS NULL OR p.excluido = '')
        AND TRIM(COALESCE(p.obs_proximo_pedido, '')) <> ''
        AND COALESCE(p.obs_proximo_consumido, 'N') <> 'S'
        ${exclSql}
        ${vis.clause}
      ORDER BY p.data_abertura DESC, p.id DESC
      LIMIT 1
    `, [...params, ...vis.params]).catch(() => [[]]);

    if (!row) return res.json({ pendente: null });
    res.json({
      pendente: {
        id: row.id,
        numero: row.numero,
        texto: String(row.obs_proximo_pedido || '').trim(),
        data_abertura: row.data_abertura,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pedidos/retornos-resumo — alertas de retorno (mesma visibilidade da lista)
router.get('/retornos-resumo', async (req, res) => {
  try {
    const pool = getPool();
    const resumo = await _queryPedidosRetornoResumo(pool, req);
    res.json(resumo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pedidos/:id
router.get('/:id', async (req, res) => {
  try {
    const pool = getPool();
    // JOIN duplo com usuarios para trazer o vendedor e quem digitou
    const [header] = await pool.query(`
      SELECT p.*, u1.nomeusu as nome_vendedor, u2.nomeusu as nome_digitador
      FROM pedidos p
      LEFT JOIN usuarios u1 ON p.id_usuario = u1.idusuario
      LEFT JOIN usuarios u2 ON p.coduser_digitacao = u2.idusuario
      WHERE p.id = ?
    `, [req.params.id]);
    
    if (!header[0]) return res.status(404).json({ error: 'Pedido não encontrado' });

    const numPedido = header[0].numero;
    const codCli   = header[0].cod_cliente;
    const idFilial = header[0].id_empresa ?? header[0].id_filial;

    // _getProdTabela é cacheado — quase gratuito após o 1º acesso
    const _ptb = await _getProdTabela(pool);

    // Garante colunas web-only antes da query de itens — necessário em bases Delphi legadas
    // onde runMigrations nunca rodou (ex: tenants novos no Oracle multi-tenant)
    await ensureProdutoColunas(pool).catch(() => {});

    // Todas as queries independentes rodam em paralelo (pool: cada uma usa conexão própria)
    const [[itens], [parcelas], [logs], [cliRows], [empRows]] = await Promise.all([
      pool.query(
        `SELECT i.*, p.foto_principal,
                COALESCE(i.vlr_padrao, p.vlr_venda, 0) AS vlr_padrao_efetivo,
                IFNULL(p.precopeso, 'N') AS precopeso,
                IFNULL(p.kilo_embalagem, 0) AS prod_kilo_embalagem,
                IFNULL(p.bloquear_desconto, 'N') AS bloquear_desconto,
                p.desconto_maximo,
                IFNULL(p.multiplo_venda, 1) AS multiplo_venda_produto,
                IFNULL(p.qtd_minima_pedido, 0) AS qtd_minima_pedido_produto
         FROM itensped i
         LEFT JOIN ${_ptb} p ON i.cod_produto = p.id
         WHERE i.numpedido = ? AND (i.excluido = 'N' OR i.excluido IS NULL)`,
        [numPedido]
      ),
      pool.query(`SELECT * FROM receber WHERE numero = ?`, [numPedido]).catch(() => [[]]),
      pool.query(`
        SELECT l.*, u.nomeusu as nome_usuario
        FROM logs_pedidos l
        LEFT JOIN usuarios u ON l.id_usuario = u.idusuario
        WHERE l.id_pedido = ?
        ORDER BY l.data_hora DESC
      `, [req.params.id]).catch(() => [[]]),
      codCli
        ? pool.query(`SELECT * FROM clientes WHERE id = ? LIMIT 1`, [codCli]).catch(() => [[]])
        : Promise.resolve([[]]),
      (idFilial
        ? pool.query(`SELECT * FROM empresa WHERE id_empresa = ? LIMIT 1`, [idFilial])
        : pool.query(`SELECT * FROM empresa WHERE excluido = 'N' ORDER BY id_empresa LIMIT 1`)
      ).catch(() => [[]]),
    ]);

    for (const row of itens) {
      if (row.vlr_padrao == null || row.vlr_padrao === '' || Number(row.vlr_padrao) === 0) {
        row.vlr_padrao = row.vlr_padrao_efetivo;
      }
      delete row.vlr_padrao_efetivo;
    }

    // Grade: depende dos IDs dos itens — não pode paralelizar com a query acima
    if (itens.length) {
      const itemIds = itens.map(i => i.id);
      const [gradeRows] = await pool.query(
        `SELECT * FROM itensped_grade_qtd WHERE id_item_ped IN (?) ORDER BY sequencial`,
        [itemIds]
      ).catch(() => [[]]);
      const gradeMap = {};
      for (const g of gradeRows) {
        if (!gradeMap[g.id_item_ped]) gradeMap[g.id_item_ped] = [];
        gradeMap[g.id_item_ped].push(g);
      }
      for (const item of itens) {
        item.grade_qtd = gradeMap[item.id] || [];
        item.obsitem = resolveObsitemLeitura(item);
        delete item.obsitemitenspedido;
      }
    }

    const cliente = cliRows[0] || {};
    if (cliente.numerosulframa && !cliente.numero_suframa) cliente.numero_suframa = cliente.numerosulframa;
    if (cliente.numero_suframa && !cliente.numerosulframa) cliente.numerosulframa = cliente.numero_suframa;

    const empresa = empRows[0] ? await sanitizeEmpresaRow(pool, empRows[0]) : {};

    let pedidoOut = header[0];
    let itensOut = itens;
    if (isPrepostoUser(req)) {
      pedidoOut = stripPedidoComissaoRep(pedidoOut);
      itensOut = stripItensComissaoRep(itensOut);
    }

    res.json({
      pedido: pedidoOut,
      itens: itensOut,
      parcelas: parcelas || [],
      logs: logs || [],
      cliente,
      empresa
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pedidos
router.post('/', async (req, res) => {
  const _ts = Date.now();                                                   // [DIAG-SAVE]
  const _mk = (l) => console.log(`[DIAG-SAVE] ${l}: +${Date.now() - _ts}ms`); // [DIAG-SAVE]
  const conn = await getPool().getConnection();
  _mk('getConnection (pool)');                                             // [DIAG-SAVE]
  let _numLockName = null;
  try {
    await conn.beginTransaction();
    _mk('beginTransaction');                                              // [DIAG-SAVE]
    const { pedido, itens, parcelas } = req.body;

    const bloqueioCli = await _validarCarteiraClientePedido(req, conn, pedido?.cod_cliente);
    if (bloqueioCli) {
      await conn.rollback();
      return res.status(bloqueioCli.status).json({ error: bloqueioCli.error });
    }

    // Idempotência: pedido offline já sincronizado antes não é duplicado.
    // Se a resposta da 1ª sincronização se perdeu, a fila reenvia o mesmo
    // numero_off — aqui devolvemos o pedido existente em vez de criar outro.
    // IMPORTANTE: numero_off é um contador no localStorage de CADA aparelho
    // (pedidos-offline.js → nextNumeroOff), então dois vendedores diferentes
    // geram o mesmo numero_off. Por isso o match é restrito a (numero_off +
    // mesmo digitador + mesmo cliente) — assim só deduplica o REENVIO do mesmo
    // pedido, nunca o pedido de outro vendedor (evita descartar pedido legítimo).
    if (pedido && pedido.numero_off && (pedido.cod_cliente != null)) {
      const _coduserDig = req.user?.id || 0;
      const [jaExiste] = await conn.query(
        `SELECT id, numero FROM pedidos
         WHERE numero_off = ? AND coduser_digitacao = ? AND cod_cliente = ? AND excluido = 'N'
         ORDER BY id DESC LIMIT 1`,
        [pedido.numero_off, _coduserDig, pedido.cod_cliente]
      );
      if (jaExiste[0]) {
        await conn.commit();
        return res.status(200).json({ ok: true, id: jaExiste[0].id, numero: jaExiste[0].numero, duplicado: true });
      }
    }

    // Uma passada: sistemas + produto + tipograde + validação + normalize
    // (antes eram 3 validadores + normalize com SELECTs repetidos).
    let itensNormSave = null;
    if (itens && itens.length > 0) {
      const prep = await validarENormalizarItensSave(conn, itens, pedido.cod_fornecedor);
      if (prep.erros) {
        await conn.rollback();
        return res.status(400).json({ error: prep.erros.join(' ') });
      }
      itensNormSave = prep.itensNorm;
    }
    _mk('validacoes+normalize (1 pass)');                                 // [DIAG-SAVE]

    // Comissão calculada no backend — ignora valores enviados pelo frontend
    const idPreposto = nPedidoId(pedido.id_preposto);
    const comissaoCalc = await _calcComissaoBackend(
      conn, pedido.cod_fornecedor, pedido.id_usuario, itensNormSave || itens || [], idPreposto
    );
    if (comissaoCalc._nome_preposto) pedido.nome_preposto = comissaoCalc._nome_preposto;
    delete comissaoCalc._nome_preposto;
    Object.assign(pedido, comissaoCalc);
    _mk('comissao');                                                     // [DIAG-SAVE]

    // Geração automática de número seguindo sequência do Delphi
    let num = pedido.numero;
    if (!num || num === '') {
      // Trava anti-duplicação: serializa a geração do número entre requisições
      // concorrentes do mesmo tenant. Sem isso, dois saves simultâneos liam o
      // mesmo MAX(numero) e nasciam dois pedidos com o mesmo número (o que depois
      // some/zera os itens, pois itensped é chaveado por numpedido). A trava é por
      // banco (DATABASE()) para não serializar entre clientes diferentes.
      try {
        const [[dbRow]] = await conn.query('SELECT DATABASE() AS db');
        _numLockName = 'pednum_' + (dbRow?.db || 'default');
        await conn.query('SELECT GET_LOCK(?, 10) AS l', [_numLockName]);
      } catch (_) { _numLockName = null; }
      const [seq] = await conn.query(`SELECT LPAD((COALESCE(MAX(numero + 0), 0) + 1), 6, '0') AS proximo FROM pedidos`);
      num = seq[0]?.proximo || '000001';
    }
    _mk('GET_LOCK + MAX(numero)');                                        // [DIAG-SAVE]

    const up = s => (s || '').toString().toUpperCase();
    const horaBR = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false });
    const sit = (pedido.situacao_pedido || 'ENTREGAR').toUpperCase();
    // Usa a data enviada pelo frontend (hora local do usuário) para evitar problema de fuso horário
    // CURDATE() no servidor MySQL pode ser um dia à frente do horário do Brasil (UTC vs BRT)
    const dataAbertura = pedido.data_abertura || hojeIsoBrasil();
    const idEmpresaPed = nPedidoId(pedido.id_empresa) ?? nPedidoId(pedido.id_filial);

    const [pResult] = await conn.query(
      `INSERT INTO pedidos (
        numero, data_abertura, hora_abertura,
        id_usuario, coduser_digitacao, nome_vendedor,
        cod_cliente, cnpj, nome_cliente,
        cod_fornecedor, nome_fornecedor,
        cod_transportadora, nome_transportadora,
        id_frete, tipo_frete,
        id_tipopedido, tipo_pedido, tipo_documento,
        id_condicaopagto, condicao_pagto, forma_pagto, prazo_pagto,
        ped_compras, Comprador, data_entrega,
        vlrsubtotal, vlrtotalitens, vlrdesconto, vlrtotalimposto,
        vlrtotalbruto, vlrfrete, vlrjuros, vlrtotalpedido,
        qt_parcelas, total_qt, total_peso,
        vlrtotalitenspuxada, vlr_totpuxada,
        comissao, vlrcomissao, vlr_comissaonormal, vlr_total_comissao,
        comissaogerente, compartilhacomissao, origem_comissao,
        status, situacao_pedido, obs, puxada,
        origem, sincronizar, statuspedweb, numero_off,
        id_filial, id_empresa, nome_empresa,
        id_preposto, nome_preposto, vlr_comissao_preposto,
        excluido, dtcadastro
      ) VALUES (
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        'N', ?
      )`,
      [
        num, dataAbertura, horaBR,
        req.user?.id || 0, req.user?.id || 0, up(pedido.nome_vendedor || req.user?.nome || 'ADMIN'),
        pedido.cod_cliente, up(pedido.cnpj), up(pedido.nome_cliente),
        pedido.cod_fornecedor || null, up(pedido.nome_fornecedor),
        pedido.cod_transportadora || null, up(pedido.nome_transportadora),
        pedido.id_frete || null, up(pedido.tipo_frete),
        pedido.id_tipopedido || null, up(pedido.tipo_pedido) || 'PEDIDO', up(pedido.tipo_documento),
        pedido.id_condicaopagto || null, up(pedido.condicao_pagto), up(pedido.forma_pagto), up(pedido.prazo_pagto),
        up(pedido.ped_compras), up(pedido.comprador), pedido.data_entrega || null,
        nPedidoField(pedido.vlrsubtotal), nPedidoField(pedido.vlrtotalitens !== undefined ? pedido.vlrtotalitens : pedido.vlrsubtotal),
        nPedidoField(pedido.vlrdesconto), nPedidoField(pedido.vlrtotalimposto),
        nPedidoField(pedido.vlrtotalbruto), nPedidoField(pedido.vlrfrete), nPedidoField(pedido.vlrjuros),
        nPedidoField(pedido.vlrtotalpedido),
        Math.max(1, nPedidoField(pedido.qt_parcelas, 1)), nPedidoField(pedido.total_qt), nPedidoField(pedido.total_peso),
        nPedidoField(pedido.vlrtotalitenspuxada), nPedidoField(pedido.vlr_totpuxada),
        nPedidoField(pedido.comissao), nPedidoField(pedido.vlrcomissao),
        nPedidoField(pedido.vlr_comissaonormal), nPedidoField(pedido.vlr_total_comissao),
        nPedidoField(pedido.comissaogerente), pedido.compartilhacomissao || 'N', up(pedido.origem_comissao) || 'FORNECEDOR',
        sit, sit, pedido.obs || '', pedido.puxada || 'N',
        pedido.origem || 'PEDIDO DE VENDA', (pedido.sincronizar === 'S' ? 'S' : 'N'), pedido.statuspedweb || 'S', pedido.numero_off || null,
        idEmpresaPed, idEmpresaPed,
        up(pedido.nome_empresa),
        idPreposto, up(pedido.nome_preposto || ''), nPedidoField(pedido.vlr_comissao_preposto),
        dataAbertura
      ]
    );

    const pedidoId = pResult.insertId;
    _mk('INSERT pedido');                                                 // [DIAG-SAVE]

    await require('../config/crm-auto-link').autoLinkNegocio({
      conn,
      id_empresa: idEmpresaPed,
      cod_cliente: pedido.cod_cliente,
      id_usuario: req.user?.id || 0,
      vlrtotalpedido: nPedidoField(pedido.vlrtotalpedido),
      id_pedido: pedidoId,
    }).catch(() => {});
    _mk('autoLinkNegocio (CRM)');                                         // [DIAG-SAVE]

    const idCampFeirinha = nPedidoId(pedido.id_campanha_feirinha);
    const hasSnapMedio = pedido.preco_medio_feirinha != null && pedido.preco_medio_feirinha !== '';
    const hasSnapRevenda = pedido.preco_revenda_feirinha != null && pedido.preco_revenda_feirinha !== '';
    const snapMedio = hasSnapMedio ? nPedidoField(pedido.preco_medio_feirinha) : null;
    const snapRevenda = hasSnapRevenda ? nPedidoField(pedido.preco_revenda_feirinha) : null;
    if (idCampFeirinha != null || hasSnapMedio || hasSnapRevenda) {
      await conn.query(
        `UPDATE pedidos SET id_campanha_feirinha=?, preco_medio_feirinha=?, preco_revenda_feirinha=? WHERE id=?`,
        [idCampFeirinha, snapMedio, snapRevenda, pedidoId]
      ).catch(() => {});
    }

    if (pedido.descontos_cascata !== undefined) {
      const snapDesc = pedido.descontos_cascata == null || pedido.descontos_cascata === ''
        ? null
        : String(pedido.descontos_cascata).slice(0, 200);
      await conn.query(
        `UPDATE pedidos SET descontos_cascata=? WHERE id=?`,
        [snapDesc, pedidoId]
      ).catch(() => {});
    }

    if (itensNormSave && itensNormSave.length > 0) {
      await Promise.all([ensureItenspedPromoColumns(conn), ensureItenspedObsitemColumn(conn)]);
      _mk(`ensure colunas itensped (${itensNormSave.length} itens)`);      // [DIAG-SAVE]
      await insertItenspedBatch(conn, itensNormSave, {
        numpedido: num,
        idPedido: pedidoId,
        codFornecedor: pedido.cod_fornecedor,
        tipoPedido: pedido.tipo_pedido,
        idTipoPedido: pedido.id_tipopedido,
      });
      _mk('insertItenspedBatch');                                         // [DIAG-SAVE]
    }

    await salvarParcelas(conn, num, pedidoId, pedido, parcelas);
    _mk(`salvarParcelas (${parcelas?.length || 0} parc)`);                // [DIAG-SAVE]

    if (pedido.obs_proximo_pedido !== undefined) {
      await _salvarObsProximoRegistro(conn, pedidoId, pedido.obs_proximo_pedido);
    }
    if (pedido.obs_proximo_consumir_id) {
      await _consumirObsProximo(conn, pedido.obs_proximo_consumir_id, pedido.cod_cliente, pedido.cod_fornecedor);
    }

    await conn.commit();
    _mk('COMMIT — FIM');                                                  // [DIAG-SAVE]
    res.status(201).json({ ok: true, id: pedidoId });

    emitNovoPedido({
      numero: num,
      id: pedidoId,
      tipo_pedido: pedido.tipo_pedido || 'PEDIDO',
      nome_cliente: pedido.nome_cliente || '',
      nome_fornecedor: pedido.nome_fornecedor || '',
      origem: pedido.origem || 'PEDIDO DE VENDA',
      vlrtotalpedido: pedido.vlrtotalpedido || 0,
    });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    if (_numLockName) { try { await conn.query('SELECT RELEASE_LOCK(?)', [_numLockName]); } catch (_) {} }
    conn.release();
  }
});

// POST /api/pedidos/:id/converter-pedido — converte orçamento em pedido
router.post('/:id/converter-pedido', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = getPool();
    const [[ped]] = await pool.query(
      `SELECT tipo_pedido FROM pedidos WHERE id = ? AND excluido = 'N' LIMIT 1`, [id]
    );
    if (!ped) return res.status(404).json({ error: 'Pedido não encontrado' });
    const _tp = String(ped.tipo_pedido || '').toUpperCase().replace(/Ç/g, 'C');
    if (!_tp.includes('ORCA')) return res.status(400).json({ error: 'Este registro não é um orçamento' });
    await pool.query(`ALTER TABLE pedidos ADD COLUMN data_confirmacao DATETIME NULL DEFAULT NULL`).catch(() => {});
    await pool.query(
      `UPDATE pedidos SET tipo_pedido = 'PEDIDO', data_confirmacao = NOW() WHERE id = ? AND excluido = 'N'`,
      [id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pedidos/bulk-update — Atualização em Massa (ANTES de /:id — senão Express trata "bulk-update" como id)
router.post('/bulk-update', async (req, res) => {
  const conn = await getPool().getConnection();
  try {
    const { ids, update } = req.body;
    const id_usuario_log = req.user?.id || 1;
    const idList = (Array.isArray(ids) ? ids : [])
      .map((id) => parseInt(id, 10))
      .filter((id) => Number.isFinite(id) && id > 0);
    if (!idList.length) return res.status(400).json({ error: 'Nenhum pedido selecionado' });
    if (!update || (!update.situacao_pedido && !update.tipo_pedido)) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    }

    await conn.beginTransaction();
    let updated = 0;

    for (const id of idList) {
      const [old] = await conn.query(
        `SELECT situacao_pedido FROM pedidos WHERE id = ? AND COALESCE(excluido,'N')='N' LIMIT 1`,
        [id]
      );
      if (!old[0]) continue;

      const sets = [];
      const vals = [];
      // NÃO gravar coluna `status` aqui: em bases Delphi costuma ser CHAR(1)/VARCHAR(1)
      // (ex.: 'P'). Gravar 'APROVADO'/'CANCELADO' estoura a coluna e a transação inteira falha.
      if (update.situacao_pedido) {
        sets.push('situacao_pedido = ?');
        vals.push(String(update.situacao_pedido).trim().toUpperCase());
      }
      if (update.tipo_pedido) {
        sets.push('tipo_pedido = ?');
        vals.push(String(update.tipo_pedido).trim().toUpperCase());
      }

      if (sets.length > 0) {
        vals.push(id);
        await conn.query(`UPDATE pedidos SET ${sets.join(', ')} WHERE id = ?`, vals);
        updated++;
        await conn.query(`
          INSERT INTO logs_pedidos (id_pedido, id_usuario, acao, status_antigo, status_novo, detalhes)
          VALUES (?, ?, 'ALTERACAO_MASSA', ?, ?, ?)
        `, [
          id,
          id_usuario_log,
          old[0].situacao_pedido,
          update.situacao_pedido || old[0].situacao_pedido,
          'Atualização via ação em massa',
        ]).catch(() => {});
      }
    }

    await conn.commit();
    res.json({ ok: true, count: updated });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// POST /api/pedidos/:id — Atualização de Pedido
router.post('/:id', async (req, res) => {
  const _ts = Date.now();                                                   // [DIAG-SAVE]
  const _mk = (l) => console.log(`[DIAG-SAVE:id] ${l}: +${Date.now() - _ts}ms`); // [DIAG-SAVE]
  const conn = await getPool().getConnection();
  _mk('getConnection (pool)');                                             // [DIAG-SAVE]
  try {
    const { id } = req.params;
    const { pedido, itens, parcelas } = req.body;
    const id_usuario_log = req.user?.id || 1;
    if (pedido && (pedido.data_retorno !== undefined || pedido.obs_retorno !== undefined)) {
      await ensurePedidoRetornoColumns(conn);
    }
    if (pedido && (
      pedido.obs_proximo_pedido !== undefined
      || pedido.obs_proximo_consumir_id != null
    )) {
      await ensurePedidoObsProximoColumns(conn);
    }
    await conn.beginTransaction();
    _mk('beginTransaction');                                              // [DIAG-SAVE]

    if (pedido?.cod_cliente != null && pedido.cod_cliente !== '') {
      const bloqueioCli = await _validarCarteiraClientePedido(req, conn, pedido.cod_cliente);
      if (bloqueioCli) {
        await conn.rollback();
        return res.status(bloqueioCli.status).json({ error: bloqueioCli.error });
      }
    }

    // Uma passada validação+normalize (reusa resultado no reinsert dos itens)
    let itensNormSave = null;
    if (pedido && itens && itens.length > 0) {
      const prep = await validarENormalizarItensSave(conn, itens, pedido.cod_fornecedor);
      if (prep.erros) {
        await conn.rollback();
        return res.status(400).json({ error: prep.erros.join(' ') });
      }
      itensNormSave = prep.itensNorm;
      let idVend = pedido.id_usuario;
      if (!idVend) {
        const [pv] = await conn.query(`SELECT id_usuario, id_preposto FROM pedidos WHERE id = ? LIMIT 1`, [id]).catch(() => [[]]);
        idVend = pv[0]?.id_usuario;
        if (pedido.id_preposto === undefined) pedido.id_preposto = pv[0]?.id_preposto || null;
      }
      const idPrepostoUpd = nPedidoId(pedido.id_preposto);
      const comissaoCalc = await _calcComissaoBackend(conn, pedido.cod_fornecedor, idVend, itensNormSave, idPrepostoUpd);
      if (comissaoCalc._nome_preposto) pedido.nome_preposto = comissaoCalc._nome_preposto;
      delete comissaoCalc._nome_preposto;
      Object.assign(pedido, comissaoCalc);
    }
    _mk('validacoes+normalize+comissao');                                // [DIAG-SAVE]

    // Cabeçalho + nº do pedido numa query só (itens e parcelas reusam)
    const [atual] = await conn.query(
      `SELECT situacao_pedido, tipo_pedido, numero, cod_fornecedor, nome_fornecedor,
              comissao, id_usuario, data_abertura
         FROM pedidos WHERE id = ?`,
      [id]
    );
    const statusAntigo = atual[0]?.situacao_pedido;
    const pedidoRow = atual[0] || null;

    // 1. Atualiza cabeçalho do pedido
    if (pedido) {
      if (pedido.situacao_pedido !== undefined && pedido.status === undefined) {
        pedido.status = pedido.situacao_pedido;
      }
      const empComboUp = nPedidoId(pedido.id_empresa) ?? nPedidoId(pedido.id_filial);
      if (empComboUp != null) {
        pedido.id_empresa = empComboUp;
        pedido.id_filial = empComboUp;
      }
      const sets = [];
      const vals = [];
      const allowedFields = [
        'situacao_pedido', 'tipo_pedido', 'id_tipopedido', 'tipo_documento',
        'vlrtotalpedido', 'vlrsubtotal', 'vlrtotalitens', 'vlrtotalbruto',
        'vlrdesconto', 'vlrtotalimposto', 'vlrfrete', 'vlrjuros',
        'qt_parcelas', 'total_qt', 'total_peso',
        'vlrtotalitenspuxada', 'vlr_totpuxada',
        'obs', 'data_entrega', 'data_abertura',
        'id_condicaopagto', 'condicao_pagto', 'forma_pagto', 'prazo_pagto',
        'id_frete', 'tipo_frete',
        'ped_compras', 'comprador',
        'cod_cliente', 'cnpj', 'nome_cliente',
        'cod_fornecedor', 'nome_fornecedor',
        'cod_transportadora', 'nome_transportadora',
        'id_usuario', 'coduser_digitacao', 'id_filial', 'id_empresa', 'nome_empresa',
        'status', 'puxada', 'origem', 'sincronizar', 'statuspedweb', 'numero_off',
        'comissao', 'vlrcomissao', 'vlr_comissaonormal', 'vlr_total_comissao',
        'comissaogerente', 'compartilhacomissao', 'origem_comissao',
        'chave_nfe', 'status_nfe',
        'informado_faturamento', 'data_faturado', 'data_faturadofabrica',
        'numeronf', 'nf_fabrica', 'serie_nf',
        'vlr_faturado', 'vlr_faturamento', 'vlr_diferencafaturamento', 'notarecebida',
        'id_campanha_feirinha',
        'preco_medio_feirinha', 'preco_revenda_feirinha',
        'data_retorno', 'obs_retorno',
        'obs_proximo_pedido', 'obs_proximo_consumido',
        'descontos_cascata',
      ];

      for (const key of allowedFields) {
        if (pedido[key] !== undefined) {
          sets.push(`${key} = ?`);
          let v = pedido[key];
          if (PEDIDO_NUMERIC_FIELDS.has(key)) v = nPedidoField(v);
          else if (PEDIDO_ID_FIELDS.has(key)) v = nPedidoId(v);
          else if (PEDIDO_DATE_FIELDS.has(key)) {
            if (v === '' || v === null || v === undefined) v = null;
            else if (typeof v === 'string' && !String(v).trim()) v = null;
          }
          vals.push(v);
        }
      }

      if (sets.length > 0) {
        vals.push(id);
        await conn.query(`UPDATE pedidos SET ${sets.join(', ')} WHERE id = ?`, vals);
      }

      // ── LOG DE AUDITORIA ──
      let acao = 'ALTERACAO_GERAL';
      if (pedido.situacao_pedido && pedido.situacao_pedido !== statusAntigo) acao = 'MUDANCA_STATUS';
      
      // Detalhes enxutos: o body.pedido inteiro pode ser grande e o stringify
      // no hot path do UPDATE atrasava o save sem ganho real de auditoria.
      const detalhesLog = JSON.stringify({
        situacao_pedido: pedido.situacao_pedido,
        tipo_pedido: pedido.tipo_pedido,
        status: pedido.status,
        vlrtotalpedido: pedido.vlrtotalpedido,
        vlrsubtotal: pedido.vlrsubtotal,
        total_qt: pedido.total_qt,
        cod_cliente: pedido.cod_cliente,
        cod_fornecedor: pedido.cod_fornecedor,
        id_usuario: pedido.id_usuario,
        condicao_pagto: pedido.condicao_pagto,
      });
      await conn.query(`
        INSERT INTO logs_pedidos (id_pedido, id_usuario, acao, status_antigo, status_novo, detalhes)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
        id, id_usuario_log, acao, statusAntigo, pedido.situacao_pedido || statusAntigo,
        detalhesLog,
      ]);
    }
    _mk('UPDATE cabecalho + log');                                        // [DIAG-SAVE]

    // 2. Atualiza Itens (somente salvamento completo — array vazio não toca itensped)
    if (itensNormSave && itensNormSave.length > 0 && pedidoRow?.numero != null) {
      const numPedido = pedidoRow.numero;
      const codFornUpd = pedido?.cod_fornecedor ?? pedidoRow.cod_fornecedor;
      await softDeleteItenspedByNumPedido(conn, numPedido);
      await Promise.all([ensureItenspedPromoColumns(conn), ensureItenspedObsitemColumn(conn)]);
      await insertItenspedBatch(conn, itensNormSave, {
        numpedido: numPedido,
        idPedido: id,
        codFornecedor: codFornUpd,
        tipoPedido: pedido?.tipo_pedido,
        idTipoPedido: pedido?.id_tipopedido,
      });
      _mk(`itens (${itensNormSave.length}) soft-del+batch`);               // [DIAG-SAVE]
    }

    // 3. Parcelas (só regrava se vieram com conteúdo — preserva ao mudar só status)
    if (parcelas && Array.isArray(parcelas) && parcelas.length > 0 && pedidoRow) {
      const pedidoAtual = pedido || {};
      pedidoAtual.cod_fornecedor  = pedidoAtual.cod_fornecedor  ?? pedidoRow.cod_fornecedor;
      pedidoAtual.nome_fornecedor = pedidoAtual.nome_fornecedor ?? pedidoRow.nome_fornecedor;
      pedidoAtual.comissao        = pedidoAtual.comissao        ?? pedidoRow.comissao;
      pedidoAtual.id_usuario      = pedidoAtual.id_usuario      ?? pedidoRow.id_usuario;
      pedidoAtual.data_abertura   = pedidoAtual.data_abertura   ?? pedidoRow.data_abertura;
      // salvarParcelas já faz DELETE receber por numero+id_pedido — sem DELETE extra.
      await salvarParcelas(conn, pedidoRow.numero, parseInt(id, 10), pedidoAtual, parcelas);
      _mk(`salvarParcelas (${parcelas.length} parc)`);                    // [DIAG-SAVE]
    }

    if (pedido?.obs_proximo_consumir_id) {
      await _consumirObsProximo(conn, pedido.obs_proximo_consumir_id, pedido.cod_cliente, pedido.cod_fornecedor);
    }
    if (pedido?.obs_proximo_pedido !== undefined) {
      const t = String(pedido.obs_proximo_pedido ?? '').trim();
      if (t) {
        await conn.query(`UPDATE pedidos SET obs_proximo_consumido = 'N' WHERE id = ?`, [id]);
      }
    }

    await conn.commit();
    _mk('COMMIT — FIM');                                                  // [DIAG-SAVE]
    releasePedidoEditLock(pedidoEditTenantKey(req), id, req.user?.id);
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    console.error('ERRO UPDATE PEDIDO:', err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// DELETE /api/pedidos/:id — Exclusão em Cascata (pedido + itens + receber + comissões)
router.delete('/:id', async (req, res) => {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const { id } = req.params;
    const id_usuario_log = req.user?.id || 0;

    // Busca o número do pedido para usar nas tabelas filhas
    const [pedRows] = await conn.query('SELECT id, numero, situacao_pedido FROM pedidos WHERE id = ?', [id]);
    if (!pedRows[0]) {
      await conn.rollback();
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }
    const numPedido = pedRows[0].numero;
    const sitPedido = (pedRows[0].situacao_pedido || '').toUpperCase();

    // ── BLOQUEIO: Pedido ENVIADO — requer permissão + senha ─────────────────
    if (sitPedido === 'ENVIADO') {
      const isAdminDesbloq = req.user?.perfil == 1 || req.user?.isAdmin;
      const permDesbloq = req.user?.permissoes?.desbloquear_pedido_enviado;
      if (!isAdminDesbloq && permDesbloq !== 'S') {
        await conn.rollback();
        return res.status(403).json({
          error: 'Você não tem permissão para excluir pedidos enviados à representada.',
          bloqueio: 'PEDIDO_ENVIADO_SEM_PERMISSAO'
        });
      }
      const senhaInformada = req.body?.senha;
      if (!senhaInformada) {
        await conn.rollback();
        return res.status(403).json({ error: 'Informe sua senha para excluir um pedido enviado.', bloqueio: 'PEDIDO_ENVIADO_SENHA' });
      }
      const [uRows] = await conn.query(
        `SELECT senhausu FROM usuarios WHERE idusuario = ? AND SITUACAO='ATIVO' AND excluido='N' LIMIT 1`,
        [req.user?.id || 0]
      ).catch(() => [[]]);
      if (!uRows[0] || uRows[0].senhausu.trim().toUpperCase() !== senhaInformada.trim().toUpperCase()) {
        await conn.rollback();
        return res.status(401).json({ error: 'Senha inválida.', bloqueio: 'PEDIDO_ENVIADO_SENHA' });
      }
    }

    // ── BLOQUEIO DE SEGURANÇA: Verificar se há parcelas baixadas ─────────────
    const [parcelasLiquidadas] = await conn.query(`
      SELECT parcela, qt_parcelas, vencimento, valor, status, data_pagamento
      FROM receber
      WHERE numero = ?
        AND status IN ('PAGO','QUITADO','BAIXADO','LIQUIDADO','RECEBIDO')
        AND COALESCE(excluido,'N') = 'N'
      ORDER BY parcela
    `, [numPedido]).catch(() => [[]]);

    if (parcelasLiquidadas.length > 0) {
      await conn.rollback();
      return res.status(409).json({
        error: `Pedido possui ${parcelasLiquidadas.length} parcela(s) já recebida(s). Não é possível excluir um pedido com financeiro baixado.`,
        bloqueio: 'FINANCEIRO_BAIXADO',
        parcelas: parcelasLiquidadas
      });
    }

    // ── BLOQUEIO: Verificar comissões já liquidadas ───────────────────────────
    const [comissoesLiquidadas] = await conn.query(`
      SELECT pc.id, pc.vlr_pago, pc.status, pc.data_lancamento, pc.data_pagamento,
             u.nomeusu AS nome_vendedor
      FROM pagtocomissao pc
      LEFT JOIN usuarios u ON u.idusuario = pc.cod_user
      WHERE pc.pedido = ? AND pc.status NOT IN ('P','G') AND COALESCE(pc.excluido,'N') = 'N'
    `, [numPedido]).catch(() => [[]]);

    if (comissoesLiquidadas.length > 0) {
      await conn.rollback();
      return res.status(409).json({
        error: `Pedido possui ${comissoesLiquidadas.length} comissão(ões) já liquidada(s). Não é possível excluir.`,
        bloqueio: 'COMISSAO_LIQUIDADA',
        comissoes: comissoesLiquidadas
      });
    }

    // 1. Exclusão lógica dos itens do pedido
    await softDeleteItenspedByNumPedido(conn, numPedido);

    // 2. Exclui parcelas/títulos a receber (apenas não baixadas — garantido pelo bloqueio acima)
    await conn.query(`DELETE FROM receber WHERE numero = ?`, [numPedido]).catch(() => {});

    // 3. Exclui provisões de comissão geradas por este pedido
    await conn.query(`DELETE FROM pagtocomissao WHERE pedido = ? AND status = 'P'`, [numPedido]).catch(() => {});

    // 4. Exclusão lógica do pedido
    const _dtExc = new Date();
    const _dataExc = _dtExc.getFullYear() + '-' + String(_dtExc.getMonth()+1).padStart(2,'0') + '-' + String(_dtExc.getDate()).padStart(2,'0');
    const _horaExc = String(_dtExc.getHours()).padStart(2,'0') + ':' + String(_dtExc.getMinutes()).padStart(2,'0') + ':' + String(_dtExc.getSeconds()).padStart(2,'0');
    await conn.query(
      `UPDATE pedidos SET excluido = 'S', dataexclusao = ?, horaexclusao = ?, id_userexclusao = ? WHERE id = ?`,
      [_dataExc, _horaExc, id_usuario_log, id]
    );

    // 5. Registra log de auditoria
    await conn.query(`
      INSERT INTO logs_pedidos (id_pedido, id_usuario, acao, status_antigo, status_novo, detalhes)
      VALUES (?, ?, 'EXCLUSAO', ?, 'EXCLUIDO', 'Pedido excluído com cascata: itens, receber e comissões removidos')
    `, [id, id_usuario_log, pedRows[0].situacao_pedido]).catch(() => {});

    await conn.commit();
    releasePedidoEditLock(pedidoEditTenantKey(req), id, id_usuario_log);
    res.json({ ok: true, numero: numPedido });
  } catch (err) {
    await conn.rollback();
    console.error('ERRO AO EXCLUIR PEDIDO:', err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PDF  •  EMAIL  •  WHATSAPP
// ═══════════════════════════════════════════════════════════════════════════

const https   = require('https');
const http    = require('http');
const { htmlToPdf } = require('../config/pdf-browser');

// ── helper Evolution API ────────────────────────────────────────────────────
function evoRequest(baseUrl, path, method, apikey, body) {
  return new Promise((resolve, reject) => {
    const url    = new URL(path, baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');
    const isHttps = url.protocol === 'https:';
    const lib    = isHttps ? https : http;
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      port:     url.port || (isHttps ? 443 : 80),
      path:     url.pathname + url.search,
      method,
      headers:  { 'Content-Type':'application/json', 'apikey': apikey },
      timeout:  30000,
      rejectUnauthorized: false,
    };
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
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout Evolution API')); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// POST /api/pedidos/:id/pdf-share-url — URL HTTP temporária para abrir/compartilhar PDF (mobile)
router.post('/:id/pdf-share-url', async (req, res) => {
  try {
    const { pdf_base64, filename } = req.body || {};
    if (!pdf_base64) return res.status(400).json({ error: 'pdf_base64 obrigatório' });
    const buf = Buffer.from(String(pdf_base64).replace(/\s/g, ''), 'base64');
    if (!buf.length || buf[0] !== 0x25 || buf[1] !== 0x50 || buf[2] !== 0x44 || buf[3] !== 0x46) {
      return res.status(400).json({ error: 'PDF inválido ou corrompido' });
    }
    const { putPdfShare, TTL_MS } = require('../config/pedido-pdf-share');
    const name = filename || `Pedido-${req.params.id}.pdf`;
    const token = putPdfShare(buf, name);
    const base = `${req.protocol}://${req.get('host')}`;
    res.json({
      ok: true,
      url: `${base}/api/pedidos/pdf-download/${token}`,
      expires_sec: Math.floor(TTL_MS / 1000),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pedidos/:id/pdf-generate
// Recebe HTML do front, gera PDF, devolve base64
router.post('/:id/pdf-generate', async (req, res) => {
  try {
    const { html, base_url: baseUrlBody } = req.body;
    if (!html) return res.status(400).json({ error: 'HTML não informado' });
    const baseUrl = baseUrlBody
      || process.env.APP_URL
      || process.env.PUBLIC_URL
      || `${req.protocol}://${req.get('host')}`;
    const t0 = Date.now();
    const pdf = await htmlToPdf(html, { baseUrl });
    if (!pdf.length || pdf[0] !== 0x25 || pdf[1] !== 0x50) {
      return res.status(500).json({ error: 'PDF gerado está vazio ou inválido' });
    }
    res.json({
      ok: true,
      pdf: pdf.toString('base64'),
      size: pdf.length,
      ms: Date.now() - t0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pedidos/:id/enviar
// Envia PDF (base64) por email e/ou WhatsApp
router.post('/:id/enviar', async (req, res) => {
  try {
    const { via, pdf_base64, numero_pedido, emails, assunto, mensagem, telefone } = req.body;
    // pdf_base64 pode ser null quando usuário optou por não anexar


    const pool     = getPool();
    const userId   = req.user?.id;
    const empresaId = req.user?.id_empresa;
    const fileName  = `Pedido-${numero_pedido || req.params.id}.pdf`;
    const pdfBuffer = pdf_base64 ? Buffer.from(pdf_base64, 'base64') : null;
    const results  = {};

    // ── Histórico de envios no cliente (cliente_mensagens) ──────────────────
    const { registrarMensagemCliente } = require('../config/cliente-mensagens');
    let _codClienteEnvio = null;
    try {
      const [[pedRow]] = await pool.query(
        `SELECT cod_cliente FROM pedidos WHERE id=? LIMIT 1`, [req.params.id]
      );
      _codClienteEnvio = pedRow?.cod_cliente || null;
    } catch {}
    const logEnvio = (extra) => registrarMensagemCliente(pool, {
      cod_cliente: _codClienteEnvio,
      id_pedido:   parseInt(req.params.id, 10) || null,
      id_usuario:  userId || null,
      mensagem:    mensagem || `Pedido Nº ${numero_pedido || req.params.id}`,
      anexo:       pdfBuffer ? fileName : null,
      ...extra,
    });

    // ── Email ───────────────────────────────────────────────────────────────
    if ((via === 'email' || via === 'ambos') && emails?.length) {
      try {
        // ── NOVO: Prioridade Vendedor → Depois Empresa ─────────────────────
        const [userRows] = await pool.query(
          `SELECT emailpedsmtp, emailpedporta, emailpedemail, emailpedsenha,
                  emailpednome, emailpedassinatura, emailpedemaildiretor
           FROM usuarios WHERE idusuario = ? AND excluido='N' LIMIT 1`,
          [userId]
        ).catch(() => [[]]);

        let smtpConfig = userRows[0] || {};

        // Se vendedor não tem SMTP, busca da empresa
        if (!smtpConfig.emailpedsmtp || !smtpConfig.emailpedemail) {
          const [empRows] = await pool.query(
            `SELECT email_smtp AS emailpedsmtp, email_port AS emailpedporta,
                    email_username AS emailpedemail, email_password AS emailpedsenha,
                    email_nomeexibicao AS emailpednome
             FROM empresa WHERE id_empresa = ? AND excluido='N' LIMIT 1`,
            [empresaId]
          ).catch(() => [[]]);
          smtpConfig = empRows[0] || {};
        }

        if (!smtpConfig.emailpedsmtp || !smtpConfig.emailpedemail) {
          throw new Error('CONFIG_EMAIL_NAO_ENCONTRADA');
        }

        const nodemailer  = require('nodemailer');
        const transporter = nodemailer.createTransport({
          host: smtpConfig.emailpedsmtp,
          port: parseInt(smtpConfig.emailpedporta) || 587,
          secure: parseInt(smtpConfig.emailpedporta) === 465,
          auth: { user: smtpConfig.emailpedemail, pass: smtpConfig.emailpedsenha },
          tls:  { rejectUnauthorized: false },
        });
        const assinatura = smtpConfig.emailpedassinatura
          ? `<br><br><img src="${smtpConfig.emailpedassinatura}" style="max-width:400px" alt="Assinatura">`
          : '';
        const mailOpts = {
          from:        `"${smtpConfig.emailpednome || 'S.G.I WEB'}" <${smtpConfig.emailpedemail}>`,
          to:          emails.join(', '),
          subject:     assunto || `Pedido Nº ${numero_pedido}`,
          html:        (mensagem ? `<p style="font-family:Arial">${mensagem.replace(/\n/g,'<br>')}</p>` : '') + assinatura,
          attachments: pdfBuffer ? [{ filename: fileName, content: pdfBuffer, contentType: 'application/pdf' }] : [],
        };
        if (smtpConfig.emailpedemaildiretor) mailOpts.cc = smtpConfig.emailpedemaildiretor;
        await transporter.sendMail(mailOpts);
        results.email = { ok: true };
        await pool.query(
          `UPDATE pedidos SET emailclienteenviado='S' WHERE id=? AND COALESCE(excluido,'N')='N'`,
          [req.params.id]
        ).catch(() => {});
        void logEnvio({ canal: 'EMAIL', destino: emails.join(', ') });
      } catch (err) {
        results.email = { ok: false, error: err.message };
        void logEnvio({ canal: 'EMAIL', destino: emails.join(', '), status: 'FALHOU', erro: err.message });
      }
    }

    // ── WhatsApp ────────────────────────────────────────────────────────────
    if ((via === 'whatsapp' || via === 'ambos') && telefone) {
      const fone = String(telefone).replace(/\D/g, '');
      const numero = fone.startsWith('55') ? fone : `55${fone}`;
      const waLink = `https://wa.me/${numero}?text=${encodeURIComponent(
        mensagem || `Segue o Pedido Nº ${numero_pedido}`
      )}`;
      try {
        // ── Provedor EuAtendo: endpoint único com Bearer token, sem instância ──
        const { euatendoAtivo, enviarTextoEuAtendo, enviarMediaEuAtendo } = require('../config/euatendo');
        const ea = await euatendoAtivo(pool).catch(() => null);
        if (ea) {
          const caption = mensagem || `Segue em anexo o Pedido Nº ${numero_pedido}`;
          if (pdfBuffer) {
            await enviarMediaEuAtendo(ea, numero, {
              buffer:   pdfBuffer,
              filename: fileName,
              mimetype: 'application/pdf',
              caption,
            });
          } else {
            await enviarTextoEuAtendo(ea, numero, caption);
          }
          results.whatsapp = { ok: true, via: 'api', provedor: 'EUATENDO' };
          void logEnvio({ canal: 'WHATSAPP', provedor: 'EUATENDO', destino: numero });
        } else {
          // ── Provedor Evolution: instância do usuário + sendMedia ──────────
          const [cfgRows] = await pool.query(
            `SELECT w_urlplataforma, w_apiglobal FROM configuracao WHERE excluido='N' ORDER BY id DESC LIMIT 1`
          ).catch(() => [[]]);
          if (!cfgRows[0]?.w_urlplataforma) {
            throw new Error('Evolution API não configurada');
          }
          const cfg = { url: cfgRows[0].w_urlplataforma, apikey: cfgRows[0].w_apiglobal };

          const [uRows] = await pool.query(
            `SELECT instancia FROM usuarios WHERE idusuario=? AND excluido='N' LIMIT 1`, [userId]
          ).catch(() => [[]]);
          if (!uRows[0]?.instancia) {
            throw new Error('Usuário sem instância WhatsApp configurada');
          }
          const instancia = uRows[0].instancia;

          const st = await evoRequest(cfg.url, `/instance/connectionState/${instancia}`, 'GET', cfg.apikey);
          const state = st.body?.instance?.state || st.body?.state || '';
          if (state !== 'open') {
            throw new Error('WhatsApp desconectado — reconecte em Configurações');
          }

          if (!pdf_base64) {
            throw new Error('PDF do pedido é obrigatório para envio pelo WhatsApp');
          }

          const r = await evoRequest(cfg.url, `/message/sendMedia/${instancia}`, 'POST', cfg.apikey, {
            number:    numero,
            mediatype: 'document',
            mimetype:  'application/pdf',
            caption:   mensagem || `Segue em anexo o Pedido Nº ${numero_pedido}`,
            media:     pdf_base64,
            fileName,
          });
          results.whatsapp = r.status < 300
            ? { ok: true, via: 'api' }
            : { ok: false, error: JSON.stringify(r.body).slice(0, 200), wa_link: waLink, fallback: true };
          void logEnvio({
            canal: 'WHATSAPP', provedor: 'EVOLUTION', destino: numero,
            ...(results.whatsapp.ok ? {} : { status: 'FALHOU', erro: results.whatsapp.error }),
          });
        }
      } catch (err) {
        results.whatsapp = { ok: false, error: err.message, wa_link: waLink, fallback: true };
        void logEnvio({ canal: 'WHATSAPP', destino: numero, status: 'FALHOU', erro: err.message });
      }
    }

    res.json({ ok: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/pedidos/:id/enviar-fabrica — envia PDF para e-mails da fábrica ──
router.post('/:id/enviar-fabrica', async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const { pdf_base64, numero_pedido, mensagem } = req.body;

    // Busca o fornecedor do pedido
    const [pedRows] = await pool.query(
      `SELECT cod_fornecedor FROM pedidos WHERE id=? AND COALESCE(excluido,'N')='N' LIMIT 1`, [id]
    );
    if (!pedRows[0]) return res.status(404).json({ error: 'Pedido não encontrado' });
    const cod_fornecedor = pedRows[0].cod_fornecedor;

    // Verifica se envio para fábrica está ativo + flag XML pedido venda
    const [fornRows] = await pool.query(
      `SELECT enviar_pedido_fabrica, xml_pedidovenda
         FROM fornecedores
        WHERE id=? AND (excluido='N' OR excluido IS NULL OR excluido='') LIMIT 1`,
      [cod_fornecedor]
    ).catch(() => [[]]);
    if (!fornRows[0]) return res.status(404).json({ error: 'Fornecedor não encontrado' });
    if ((fornRows[0].enviar_pedido_fabrica || 'N') !== 'S') {
      return res.status(400).json({ error: 'Fornecedor não tem envio para fábrica ativado' });
    }
    const geraXmlVenda = (fornRows[0].xml_pedidovenda || 'N') === 'S';

    // Busca os e-mails cadastrados
    const [emailRows] = await pool.query(
      `SELECT email FROM fornecedor_emails WHERE id_fornecedor=? AND excluido='N'`,
      [cod_fornecedor]
    ).catch(() => [[]]);
    if (!emailRows.length) {
      return res.status(400).json({ error: 'Nenhum e-mail de fábrica cadastrado para este fornecedor' });
    }
    const emails = emailRows.map(r => r.email);

    // Busca SMTP (vendedor → empresa)
    const userId = req.user?.id;
    const empresaId = req.user?.id_empresa;
    const [userRows] = await pool.query(
      `SELECT emailpedsmtp, emailpedporta, emailpedemail, emailpedsenha,
              emailpednome, emailpedassinatura
       FROM usuarios WHERE idusuario = ? AND excluido='N' LIMIT 1`,
      [userId]
    ).catch(() => [[]]);
    let smtpConfig = userRows[0] || {};
    if (!smtpConfig.emailpedsmtp || !smtpConfig.emailpedemail) {
      const [empRows] = await pool.query(
        `SELECT email_smtp AS emailpedsmtp, email_port AS emailpedporta,
                email_username AS emailpedemail, email_password AS emailpedsenha,
                email_nomeexibicao AS emailpednome
         FROM empresa WHERE id_empresa = ? AND excluido='N' LIMIT 1`,
        [empresaId]
      ).catch(() => [[]]);
      smtpConfig = empRows[0] || {};
    }
    if (!smtpConfig.emailpedsmtp || !smtpConfig.emailpedemail) {
      return res.status(400).json({ error: 'CONFIG_EMAIL_NAO_ENCONTRADA' });
    }

    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: smtpConfig.emailpedsmtp,
      port: parseInt(smtpConfig.emailpedporta) || 587,
      secure: parseInt(smtpConfig.emailpedporta) === 465,
      auth: { user: smtpConfig.emailpedemail, pass: smtpConfig.emailpedsenha },
      tls: { rejectUnauthorized: false },
    });
    const fileName = `Pedido-${numero_pedido || id}.pdf`;
    const pdfBuffer = pdf_base64 ? Buffer.from(pdf_base64, 'base64') : null;
    const assinatura = smtpConfig.emailpedassinatura
      ? `<br><br><img src="${smtpConfig.emailpedassinatura}" style="max-width:400px" alt="Assinatura">`
      : '';

    const attachments = [];
    if (pdfBuffer) {
      attachments.push({ filename: fileName, content: pdfBuffer, contentType: 'application/pdf' });
    }

    let xmlAnexo = false;
    if (geraXmlVenda) {
      const xmlPack = await buildXmlAnexoPedidoVenda(pool, id);
      if (xmlPack) {
        attachments.push({
          filename: xmlPack.fileName,
          content: xmlPack.buffer,
          contentType: 'application/xml',
        });
        xmlAnexo = true;
      }
    }

    if (!attachments.length) {
      return res.status(400).json({ error: 'Nenhum anexo disponível para envio (PDF ou XML do pedido)' });
    }

    await transporter.sendMail({
      from: `"${smtpConfig.emailpednome || 'S.G.I WEB'}" <${smtpConfig.emailpedemail}>`,
      to: emails.join(', '),
      subject: `Pedido Nº ${numero_pedido || id}`,
      html: (mensagem ? `<p style="font-family:Arial">${mensagem.replace(/\n/g, '<br>')}</p>` : '') + assinatura,
      attachments,
    });

    await pool.query(
      `UPDATE pedidos SET emailforenviado='S' WHERE id=? AND COALESCE(excluido,'N')='N'`,
      [id]
    ).catch(() => {});

    res.json({ ok: true, emails, xml_anexo: xmlAnexo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PATCH /api/pedidos/:id/nfe — registra/atualiza chave e status NF-e ───────
router.patch('/:id/nfe', async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const { chave_nfe, status_nfe } = req.body;

    const chave = (chave_nfe || '').replace(/\D/g, '');
    if (chave && chave.length !== 44) {
      return res.status(400).json({ error: 'Chave NF-e inválida — deve ter 44 dígitos' });
    }

    const statusValidos = ['PENDENTE', 'AUTORIZADA', 'CANCELADA', 'DENEGADA', 'INUTILIZADA', ''];
    const status = (status_nfe || '').toUpperCase().trim();
    if (status && !statusValidos.includes(status)) {
      return res.status(400).json({ error: 'Status NF-e inválido' });
    }

    await pool.query(
      `UPDATE pedidos SET chave_nfe = ?, status_nfe = ? WHERE id = ?`,
      [chave || null, status || null, id]
    );

    res.json({ ok: true, chave_nfe: chave || null, status_nfe: status || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
