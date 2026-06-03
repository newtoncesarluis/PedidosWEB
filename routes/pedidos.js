const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');

// tabela de produtos pode ser "produto" ou "produtos" — detecta e cacheia
let _prodTabela = null;
async function _getProdTabela(pool) {
  if (_prodTabela) return _prodTabela;
  const [rows] = await pool.query(`SHOW TABLES LIKE 'produto'`);
  _prodTabela = rows.length ? 'produto' : 'produtos';
  return _prodTabela;
}

// garante colunas extras que podem não existir em schemas mais antigos
let _prodColsOk = false;
async function _ensureProdCols(pool) {
  if (_prodColsOk) return;
  const tb = await _getProdTabela(pool);
  const [cols] = await pool.query(`DESCRIBE ${tb}`);
  const names = new Set(cols.map(c => c.Field.toLowerCase()));
  if (!names.has('multiplo_venda'))
    await pool.query(`ALTER TABLE ${tb} ADD COLUMN multiplo_venda INT NOT NULL DEFAULT 1`).catch(() => {});
  if (!names.has('foto_principal'))
    await pool.query(`ALTER TABLE ${tb} ADD COLUMN foto_principal VARCHAR(500) NULL`).catch(() => {});
  if (!names.has('comissao'))
    await pool.query(`ALTER TABLE ${tb} ADD COLUMN comissao DECIMAL(5,2) NULL DEFAULT 0`).catch(() => {});
  if (!names.has('st'))
    await pool.query(`ALTER TABLE ${tb} ADD COLUMN st DECIMAL(5,2) NULL DEFAULT 0`).catch(() => {});
  if (!names.has('valor_puxada'))
    await pool.query(`ALTER TABLE ${tb} ADD COLUMN valor_puxada DECIMAL(15,4) NULL DEFAULT 0`).catch(() => {});
  _prodColsOk = true;
}

/** Evita dois usuários editando o mesmo pedido ao mesmo tempo (memória + TTL; use ping ao editar). */
const PEDIDO_EDIT_LOCK_TTL_MS = 3 * 60 * 1000;
const pedidoEditLocks = new Map();

function cleanExpiredPedidoEditLocks() {
  const now = Date.now();
  for (const [k, v] of pedidoEditLocks) {
    if (v.exp < now) pedidoEditLocks.delete(k);
  }
}

function tryAcquirePedidoEditLock(pedidoId, userId, userName) {
  cleanExpiredPedidoEditLocks();
  const id = String(pedidoId);
  const now = Date.now();
  const cur = pedidoEditLocks.get(id);
  const uid = userId != null ? String(userId) : '';
  if (cur && cur.exp >= now && cur.userId !== uid) {
    return { ok: false, lockedBy: cur.userName || 'Outro usuário' };
  }
  pedidoEditLocks.set(id, {
    userId: uid,
    userName: (userName || '').trim(),
    exp: now + PEDIDO_EDIT_LOCK_TTL_MS
  });
  return { ok: true };
}

function renewPedidoEditLock(pedidoId, userId) {
  const id = String(pedidoId);
  const cur = pedidoEditLocks.get(id);
  const uid = userId != null ? String(userId) : '';
  if (!cur || cur.userId !== uid) return false;
  cur.exp = Date.now() + PEDIDO_EDIT_LOCK_TTL_MS;
  return true;
}

function releasePedidoEditLock(pedidoId, userId) {
  const id = String(pedidoId);
  const cur = pedidoEditLocks.get(id);
  const uid = userId != null ? String(userId) : '';
  if (!cur || cur.userId !== uid) return;
  pedidoEditLocks.delete(id);
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
  'vlr_comissao_preposto'
]);

const PEDIDO_ID_FIELDS = new Set(['id_empresa', 'id_filial', 'id_preposto']);
/** Campos DATE no MySQL: string vazia quebra o UPDATE — usar NULL */
const PEDIDO_DATE_FIELDS = new Set(['data_entrega', 'data_faturado', 'data_faturadofabrica']);

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

    // ── descricao_grades ──────────────────────────────────────────────────────
    pool.query(`ALTER TABLE descricao_grades ADD COLUMN qtd_minima INT NOT NULL DEFAULT 0`).catch(() => {}),

    // ── tipo_pedidos ─────────────────────────────────────────────────────────
    pool.query(`ALTER TABLE tipo_pedidos ADD COLUMN padrao_vitrine CHAR(1) NOT NULL DEFAULT 'N'`).catch(() => {}),
  ]);
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
  let forn = { comissao: 0, com_sobre_ipi: 'S', com_sobre_st: 'S' };
  if (codFornecedor) {
    const [fr] = await conn.query(
      `SELECT COALESCE(comissao,0) AS comissao,
              COALESCE(com_sobre_ipi,'S') AS com_sobre_ipi,
              COALESCE(com_sobre_st,'S')  AS com_sobre_st
       FROM fornecedores WHERE id = ? LIMIT 1`,
      [codFornecedor]
    ).catch(() => [[]]);
    if (fr[0]) Object.assign(forn, fr[0]);
  }

  let vend = { comissaofixavendedor: 0, comissaogerente: 0, compartilhacomissaogerente: 'N' };
  if (idUsuario) {
    const [vr] = await conn.query(
      `SELECT COALESCE(comissaofixavendedor,0)       AS comissaofixavendedor,
              COALESCE(comissaogerente,0)             AS comissaogerente,
              COALESCE(compartilhacomissaogerente,'N') AS compartilhacomissaogerente
       FROM usuarios WHERE idusuario = ? LIMIT 1`,
      [idUsuario]
    ).catch(() => [[]]);
    if (vr[0]) Object.assign(vend, vr[0]);
  }

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

  // Comissão do preposto — 1. por fornecedor; 2. fallback: % padrão do preposto
  let vlrComissaoPreposto = 0;
  let nomePreposto = null;
  if (idPreposto) {
    let pctPrep = 0;
    if (codFornecedor) {
      const [pcf] = await conn.query(
        `SELECT pct_comissao FROM preposto_comissao_fornecedor WHERE id_usuario = ? AND id_fornecedor = ? LIMIT 1`,
        [idPreposto, codFornecedor]
      ).catch(() => [[]]);
      if (pcf[0]) pctPrep = parseFloat(pcf[0].pct_comissao) || 0;
    }
    const [pr] = await conn.query(
      `SELECT COALESCE(comissao_preposto_pct,6) AS pct, nomeusu AS nome
       FROM usuarios WHERE idusuario = ? LIMIT 1`,
      [idPreposto]
    ).catch(() => [[]]);
    if (pr[0]) {
      nomePreposto = pr[0].nome || null;
      if (!pctPrep) pctPrep = parseFloat(pr[0].pct) || 6;
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
  await conn.query(`DELETE FROM receber WHERE numero = ? AND id_pedido = ?`, [num, pedidoId]).catch(() => {});
  const dataBase = pedido.data_abertura || new Date().toISOString().slice(0, 10);

  // ── Config de comissão do fornecedor ────────────────────────────────────────
  let fornConfig = { com_sobre_ipi: 'S', com_sobre_st: 'S', com_tipo: 'PARCELADA' };
  if (pedido.cod_fornecedor) {
    const [fc] = await conn.query(
      `SELECT COALESCE(com_sobre_ipi,'S') AS com_sobre_ipi,
              COALESCE(com_sobre_st,'S') AS com_sobre_st,
              COALESCE(com_tipo,'PARCELADA') AS com_tipo
       FROM fornecedores WHERE id = ? LIMIT 1`,
      [pedido.cod_fornecedor]
    ).catch(() => [[]]);
    if (fc[0]) Object.assign(fornConfig, fc[0]);
  }
  let totalIpi = 0, totalSt = 0;
  const totalParcelas = parcelas.reduce((s, p) => s + (p.valor || 0), 0);
  if (fornConfig.com_sobre_ipi !== 'S' || fornConfig.com_sobre_st !== 'S') {
    const [impos] = await conn.query(
      `SELECT COALESCE(SUM(vlr_ipi),0) AS ipi, COALESCE(SUM(vlr_st),0) AS st FROM itensped WHERE id_pedido = ?`,
      [pedidoId]
    ).catch(() => [[{ ipi: 0, st: 0 }]]);
    totalIpi = parseFloat(impos[0]?.ipi || 0);
    totalSt  = parseFloat(impos[0]?.st  || 0);
  }
  // ── Config gerente (lookup único fora do loop) ──────────────────────────────
  let idGerente = null;
  const pctGerenteFromPedido = parseFloat(pedido.comissaogerente) || 0;
  const compartilhaGerente = String(pedido.compartilhacomissao || '').toUpperCase() === 'S';
  if (compartilhaGerente && pctGerenteFromPedido > 0 && pedido.id_usuario) {
    const [gr] = await conn.query(
      `SELECT id_gerente FROM usuarios WHERE idusuario = ? LIMIT 1`,
      [pedido.id_usuario]
    ).catch(() => [[]]);
    idGerente = (gr[0] && gr[0].id_gerente) ? parseInt(gr[0].id_gerente) : null;
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

    // Comissão do preposto (proporcional à parcela)
    const idPrep = pedido.id_preposto ? parseInt(pedido.id_preposto) : null;
    if (idPrep) {
      // 1. Tenta comissão específica por fornecedor; 2. Fallback: % padrão do preposto
      let pctPrep = 0;
      if (pedido.cod_fornecedor) {
        const [pcf] = await conn.query(
          `SELECT pct_comissao FROM preposto_comissao_fornecedor WHERE id_usuario = ? AND id_fornecedor = ? LIMIT 1`,
          [idPrep, pedido.cod_fornecedor]
        ).catch(() => [[]]);
        if (pcf[0]) pctPrep = parseFloat(pcf[0].pct_comissao) || 0;
      }
      if (!pctPrep) {
        const [pr] = await conn.query(
          `SELECT COALESCE(comissao_preposto_pct,6) AS pct FROM usuarios WHERE idusuario = ? LIMIT 1`,
          [idPrep]
        ).catch(() => [[]]);
        pctPrep = parseFloat(pr[0]?.pct || 6);
      }
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
    const idUsuario  = req.user?.id || 0;
    const isAdmin    = req.user?.perfil == 1;
    const perm       = req.user?.permissoes || {};
    const acessaTodos = isAdmin ? 'S' : (perm.acessartodosclientes || '');
    const eGerente    = !isAdmin && perm.gerentecomercial === 'S';

    const [vendedores]   = await pool.query("SELECT idusuario as id, nomeusu as nome, pix_tipo, pix_chave FROM usuarios WHERE excluido='N' ORDER BY nomeusu");
    const [fornecedores] = await pool.query("SELECT id as id, nome as nome FROM fornecedores WHERE (excluido='N' OR excluido IS NULL) AND COALESCE(tipo, 'FABRICA') = 'FABRICA' ORDER BY nome");

    let qClientes = `SELECT id as id, nome as nome FROM clientes WHERE (excluido='N' OR excluido IS NULL)`;
    let pClientes = [];

    if (!isAdmin && acessaTodos === 'N') {
      if (eGerente) {
        qClientes += ` AND (cod_vendedor = ? OR cod_vendedor IN (SELECT idusuario FROM usuarios WHERE id_gerente = ? AND excluido = 'N'))`;
        pClientes.push(idUsuario, idUsuario);
      } else {
        qClientes += ` AND (cod_vendedor IS NULL OR cod_vendedor = '' OR cod_vendedor = ?)`;
        pClientes.push(idUsuario);
      }
    }
    qClientes += ` ORDER BY nome`;

    const [clientes] = await pool.query(qClientes, pClientes);

    res.json({ vendedores, fornecedores, clientes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pedidos — Com Busca e Paginação
router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    await ensureTablesOnce(pool);
    
    const { 
      q, page = 1, limit = 50, status, tipo, dt_ini, dt_fim, id_vendedor,
      min_total, max_total, min_peso, max_peso,
      comprador, ped_compras, nome_transp, origem, nome_empresa,
      cod_cliente, id_cliente, cod_fornecedor, id_fornecedor,
      sort = 'p.id', dir = 'DESC',
      lat, lng, raio = 50
    } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // ── Visibilidade por perfil ───────────────────────────────────────────────
    const _userId    = req.user?.id || 0;
    const _isAdmin   = req.user?.perfil == 1;
    const _perm      = req.user?.permissoes || {};
    const _acessaTodos = _isAdmin ? 'S' : (_perm.acessartodosclientes || '');
    const _eGerente    = !_isAdmin && _perm.gerentecomercial === 'S';

    let visWhere = '';
    let visParams = [];
    if (!_isAdmin && _acessaTodos === 'N') {
      if (_eGerente) {
        visWhere = ` AND (p.id_usuario = ? OR p.id_usuario IN (SELECT idusuario FROM usuarios WHERE id_gerente = ? AND excluido = 'N'))`;
        visParams = [_userId, _userId];
      } else {
        visWhere = ` AND p.id_usuario = ?`;
        visParams = [_userId];
      }
    }

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
      whereClause += ` AND p.situacao_pedido = ?`;
      params.push(status);
      // Mantemos nos cards também para os status básicos (Pendente/Aprovado/Cancelado)
      whereClauseCards += ` AND p.situacao_pedido = ?`;
      paramsCards.push(status);
    }

    if (tipo && tipo !== '' && tipo !== 'ALL') {
      whereClause += ` AND p.tipo_pedido = ?`;
      params.push(tipo);
      // NOTA: NÃO adicionamos o filtro de tipo em whereClauseCards para os cards não sumirem!
    }

    if (dt_ini) {
      whereClause += ` AND p.data_abertura >= ?`; whereClauseCards += ` AND p.data_abertura >= ?`;
      params.push(dt_ini); paramsCards.push(dt_ini);
    }
    if (dt_fim) {
      whereClause += ` AND p.data_abertura <= ?`; whereClauseCards += ` AND p.data_abertura <= ?`;
      params.push(dt_fim); paramsCards.push(dt_fim);
    }

    if (id_vendedor) addFilter('p.id_usuario', id_vendedor);

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
    
    // COUNT e stats em paralelo para não esperar um pelo outro
    const _countPromise = pool.query(
      `SELECT COUNT(p.id) as total FROM pedidos p ${joinFilterClause} ${whereClause}`, params
    ).catch(e => { console.error('Erro ao contar pedidos:', e.message); return [[{ total: 0 }]]; });

    const _statsPromise = pool.query(`
        SELECT
          tipo_pedido,
          COUNT(p.id) as total,
          SUM(p.vlrtotalpedido) as vlr_total,
          COUNT(CASE WHEN p.situacao_pedido = 'PENDENTE' THEN 1 END) as pendentes,
          COUNT(CASE WHEN p.situacao_pedido = 'APROVADO' THEN 1 END) as aprovados,
          COUNT(CASE WHEN p.situacao_pedido = 'CANCELADO' THEN 1 END) as cancelados,
          COUNT(CASE WHEN p.situacao_pedido = 'FATURADO' THEN 1 END) as faturados
        FROM pedidos p
        ${joinFilterClause}
        ${whereClauseCards}
        GROUP BY tipo_pedido
      `, paramsCards).catch(() => null);

    const [[countRows], _tsRaw] = await Promise.all([_countPromise, _statsPromise]);
    let totalItems = (countRows && countRows[0]) ? countRows[0].total : 0;

    let statsRows = [{ total: 0, vlr_total: 0, pendentes: 0, aprovados: 0, cancelados: 0 }];
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
          cancelados: typeStats.reduce((s,r) => s + Number(r.cancelados || 0), 0),
          faturados:  typeStats.reduce((s,r) => s + Number(r.faturados  || 0), 0),
        }];
      } else {
        const [fb] = await pool.query(`
          SELECT COUNT(p.id) as total, SUM(p.vlrtotalpedido) as vlr_total,
                 COUNT(CASE WHEN p.situacao_pedido = 'PENDENTE' THEN 1 END) as pendentes,
                 COUNT(CASE WHEN p.situacao_pedido = 'APROVADO' THEN 1 END) as aprovados,
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
                 COUNT(CASE WHEN p.situacao_pedido = 'PENDENTE' THEN 1 END) as pendentes,
                 COUNT(CASE WHEN p.situacao_pedido = 'APROVADO' THEN 1 END) as aprovados,
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
          `SELECT p.* FROM pedidos p ${whereClause} ORDER BY ${orderCol} ${orderDir} LIMIT ? OFFSET ?`,
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

    res.json({ 
      pedidos: rows,
      pagination: {
        totalItems,
        totalGlobal: (statsRows[0] && statsRows[0].total) || 0,
        valorGlobal: (statsRows[0] && statsRows[0].vlr_total) || 0,
        pendentes:  (statsRows[0] && statsRows[0].pendentes)  || 0,
        aprovados:  (statsRows[0] && statsRows[0].aprovados)  || 0,
        cancelados: (statsRows[0] && statsRows[0].cancelados) || 0,
        faturados:  (statsRows[0] && statsRows[0].faturados)  || 0,
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
      WHERE u.excluido = 'N'
      AND (u.situacao = 'ATIVO' OR u.situacao IS NULL)
      AND p.excluido = 'N'
      AND p.p_vender = 'S'
      ORDER BY u.nomeusu
    `).catch(() => [[]]);
    res.json({ vendedores: rows });
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
    res.json({ empresas: rows });
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
    const { q = '', limit = 15, id_fornecedor, id_tabela, catalogo } = req.query;
    const tabelaId = (id_tabela && id_tabela !== 'null' && id_tabela !== '0') ? parseInt(id_tabela) : null;
    const isCatalogo = catalogo === '1' || catalogo === 'true';

    const [sysRows] = await pool.query('SELECT itenspedidofornecedor FROM sistemas ORDER BY id DESC LIMIT 1').catch(() => [[]]);
    const itensForn = sysRows[0]?.itenspedidofornecedor || 'N';

    const params = [];
    let join = '';
    let whereExtra = '';
    let vlrVendaExpr = 'p.vlr_venda';
    let precoTabelaExpr = 'NULL';
    const fId = (id_fornecedor && id_fornecedor !== 'null' && id_fornecedor !== '0') ? parseInt(id_fornecedor) : null;

    // Catálogo visual com tabela ativa: produtos cadastrados na tabela (estilo Mercos)
    if (isCatalogo && tabelaId) {
      join = ` INNER JOIN tabela_preco_itens tpi ON CAST(tpi.cod_produto AS UNSIGNED) = p.ID
                 AND tpi.id_tabela = ?
                 AND (tpi.excluido = 'N' OR tpi.excluido IS NULL OR tpi.excluido = '')
                 AND tpi.ativo = 'S' `;
      params.push(tabelaId);
      vlrVendaExpr = 'COALESCE(tpi.valor_tabela, tpi.preco_venda, p.vlr_venda)';
      precoTabelaExpr = 'tpi.valor_tabela';
    } else if (tabelaId) {
      join += ` LEFT JOIN tabela_preco_itens tpi ON CAST(tpi.cod_produto AS UNSIGNED) = p.ID AND tpi.id_tabela = ? AND (tpi.excluido = 'N' OR tpi.excluido IS NULL OR tpi.excluido = '') AND tpi.ativo = 'S'`;
      params.push(tabelaId);
      vlrVendaExpr = 'COALESCE(tpi.valor_tabela, p.vlr_venda)';
      precoTabelaExpr = 'tpi.valor_tabela';
    }

    if (!(isCatalogo && tabelaId)) {
      if (itensForn === 'S') {
        if (!fId) return res.json({ data: [] });
        whereExtra = 'AND CAST(p.cod_fornecedorpadrao AS UNSIGNED) = ?';
        params.push(fId);
      } else if (fId) {
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
    const qTrim = String(q || '').trim();
    const lk = `%${qTrim}%`;
    const isBarcodeLike = /^\d{8,}$/.test(qTrim);

    let whereSearch = '1=1';
    const searchParams = [];
    if (qTrim) {
      whereSearch = '(p.descricao LIKE ? OR p.cod_fabricante LIKE ? OR p.cod_barras LIKE ?)';
      searchParams.push(lk, lk, lk);
      if (isBarcodeLike) {
        whereSearch = '(p.cod_barras = ? OR p.cod_fabricante = ? OR p.descricao LIKE ? OR p.cod_fabricante LIKE ? OR p.cod_barras LIKE ?)';
        searchParams.length = 0;
        searchParams.push(qTrim, qTrim, lk, lk, lk);
      }
    }

    const [rows] = await pool.query(
      `SELECT p.ID as id, p.ID as cod_produto,
              p.cod_fabricante, p.cod_barras, p.descricao, p.descricao as desc_produto,
              p.unidade, ${vlrVendaExpr} as vlr_venda, ${precoTabelaExpr} as preco_da_tabela, p.ipi, p.comissao,
              IFNULL(p.precoa, 0) as precoa, IFNULL(p.precob, 0) as precob,
              IFNULL(p.precoc, 0) as precoc, IFNULL(p.precopromo, 0) as precopromo,
              IFNULL(p.st, 0) as st,
              IFNULL(p.valor_puxada, 0) as valor_puxada,
              IFNULL(p.kilo_embalagem, 0) as kilo_embalagem,
              IFNULL(p.multiplo_venda, 1) as multiplo_venda,
              IFNULL(p.estoque_atual, 0) as estoque_atual,
              IFNULL(p.disponivel, 'S') as disponivel,
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
       WHERE (p.excluido = 'N' OR p.excluido IS NULL OR p.excluido = '')
         AND p.situacao = 'A'
         ${whereExtra}
         AND ${whereSearch}
       ORDER BY ${isBarcodeLike ? '(p.cod_barras = ? OR p.cod_fabricante = ?) DESC,' : ''} p.descricao
       LIMIT ?`,
      [...params, ...searchParams, ...(isBarcodeLike ? [qTrim, qTrim] : []), parseInt(limit)]
    );
    res.json({ data: rows });
  } catch (err) {
    console.error('[/produtos/busca] ERRO:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pedidos/grade-historico/:id_produto/:id_cliente — último pedido com grade para esse produto/cliente
router.get('/grade-historico/:id_produto/:id_cliente', async (req, res) => {
  try {
    const { id_produto, id_cliente } = req.params;
    // Busca o item mais recente desse produto para esse cliente que tenha grade
    const [itemRows] = await getPool().query(
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
    const N = 5;
    const [itemRows] = await getPool().query(
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

// GET /api/pedidos/grade/:id_grade — itens da grade (descricao_grades)
router.get('/grade/:id_grade', async (req, res) => {
  try {
    const [rows] = await getPool().query(
      `SELECT id, nome, sequencial, COALESCE(qtd_minima,0) AS qtd_minima FROM descricao_grades
       WHERE id_grade = ? AND excluido = 'N'
       ORDER BY sequencial`,
      [req.params.id_grade]
    );
    res.json({ itens: rows });
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
        IFNULL(p.disponivel, 'S') as disponivel
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
      sql += ` AND (p.descricao LIKE ? OR p.cod_fabricante LIKE ? OR p.cod_barras LIKE ? OR p.id = ?) `;
      const lk = `%${q.trim()}%`;
      params.push(lk, lk, lk, q.trim());
    }

    sql += ` ORDER BY p.descricao LIMIT 600 `;

    const [rows] = await pool.query(sql, params);
    res.json({ produtos: rows });
  } catch (err) {
    console.error('Erro lookup produtos:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pedidos/config/grid — Busca o layout salvo do usuário
router.get('/config/grid', async (req, res) => {
  try {
    const pool = getPool();
    await ensureTablesOnce(pool);
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

// POST /api/pedidos/config/grid — Salva layout (JSON na tabela preferencias_grid)
router.post('/config/grid', async (req, res) => {
  try {
    const pool = getPool();
    await ensureTablesOnce(pool);
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
        `SELECT COALESCE(SUM(vlr_ipi),0) AS ipi, COALESCE(SUM(vlr_st),0) AS st FROM itensped WHERE id_pedido = ?`,
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

    res.json({
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
    });
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
         status               = 'FATURADO',
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
    const uname = req.user?.name || req.user?.login || 'Usuário';

    if (action === 'acquire') {
      const r = tryAcquirePedidoEditLock(rawId, uid, uname);
      if (!r.ok) {
        return res.status(409).json({
          error: 'Este pedido está em uso. Aguarde ou peça para a outra pessoa salvar e fechar.',
          lockedBy: r.lockedBy
        });
      }
      return res.json({ ok: true });
    }
    if (action === 'ping') {
      const ok = renewPedidoEditLock(rawId, uid);
      return res.json({ ok: !!ok });
    }
    if (action === 'release') {
      releasePedidoEditLock(rawId, uid);
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
    const _acessaTodos = _isAdmin ? 'S' : (_perm.acessartodosclientes || '');
    const _eGerente = !_isAdmin && _perm.gerentecomercial === 'S';

    let visWhere = '';
    const visParams = [];
    if (!_isAdmin && _acessaTodos === 'N') {
      if (_eGerente) {
        visWhere = ` AND (p.id_usuario = ? OR p.id_usuario IN (SELECT idusuario FROM usuarios WHERE id_gerente = ? AND excluido = 'N'))`;
        visParams.push(_userId, _userId);
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
      SELECT p.acessartodosclientes, p.gerentecomercial,
             p.acessar_configuracoes, p.alterar_configuracoes, p.manutencaocadastros,
             p.acessogerenciais, p.acessoperfil, p.mudarempresa, p.tela_usuarios,
             p.alterardatapedido, p.trocarvendedorpedido, p.p_vender
      FROM usuarios u
      INNER JOIN perfil p ON p.id = u.idperfil
      WHERE u.idusuario = ? AND u.excluido = 'N' LIMIT 1
    `, [idUsuario]).catch(() => [[]]);
    const permDb = permRows[0] || {};

    const acessaTodos = isAdmin ? 'S' : (permDb.acessartodosclientes || '');
    const eGerente = !isAdmin && permDb.gerentecomercial === 'S';
    const veTodosClientes = isAdmin || acessaTodos === 'S' || eGerente;

    let qCli = `SELECT c.* FROM clientes c WHERE (c.excluido = 'N' OR c.excluido IS NULL OR c.excluido = '')`;
    const pCli = [];
    if (!veTodosClientes) {
      qCli += ` AND (c.cod_vendedor IS NULL OR c.cod_vendedor = '' OR c.cod_vendedor = ?)`;
      pCli.push(idUsuario);
    }
    qCli += ` ORDER BY c.nome`;
    const [clientes] = await pool.query(qCli, pCli);

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
               p.cod_fabricante, p.cod_barras, p.descricao, p.descricao AS desc_produto,
               p.unidade,
               COALESCE(tpi.valor_tabela, tpi.preco_venda, p.vlr_venda) AS vlr_venda,
               p.ipi, p.comissao,
               IFNULL(p.st, 0) AS st,
               IFNULL(p.valor_puxada, 0) AS valor_puxada,
               IFNULL(p.kilo_embalagem, 0) AS kilo_embalagem,
               IFNULL(p.multiplo_venda, 1) AS multiplo_venda,
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
          multiplos: multRows.length
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
        gerentecomercial: isAdmin ? 'S' : (permDb.gerentecomercial || 'N'),
        isAdmin
      },
      sistema,
      clientes,
      fornecedores,
      fornecedorCondicoes,
      vendedores,
      tiposPedido,
      tiposFrete,
      empresas,
      transportadoras,
      condicoesPagto,
      vinculosTabela,
      produtosPorTabela,
      produtoFornecedor,
      prepostos,
      fornecedorPadrao,
      gradesPorGrade,
      multiplosPorProduto,
      historicoClientes,
      clienteInadimplente
    });
  } catch (err) {
    console.error('[offline-pack]', err.message);
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
    const _ptb = await _getProdTabela(pool);
    const [itens] = await pool.query(
      `SELECT i.*, p.foto_principal
       FROM itensped i
       LEFT JOIN ${_ptb} p ON i.cod_produto = p.id
       WHERE i.numpedido = ? AND (i.excluido = 'N' OR i.excluido IS NULL)`,
      [numPedido]
    );
    
    // Carrega quantidades de grade para os itens
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
      }
    }

    const [parcelas] = await pool.query(`SELECT * FROM receber WHERE numero = ?`, [numPedido]).catch(() => [[]]);

    // Buscar logs de auditoria
    const [logs] = await pool.query(`
      SELECT l.*, u.nomeusu as nome_usuario
      FROM logs_pedidos l
      LEFT JOIN usuarios u ON l.id_usuario = u.idusuario
      WHERE l.id_pedido = ?
      ORDER BY l.data_hora DESC
    `, [req.params.id]).catch(() => [[]]);

    // Dados completos do cliente (para impressão)
    const codCli = header[0].cod_cliente;
    const [cliRows] = codCli
      ? await pool.query(`SELECT * FROM clientes WHERE id = ? LIMIT 1`, [codCli]).catch(() => [[]])
      : [[]];
    const cliente = cliRows[0] || {};
    if (cliente.numerosulframa && !cliente.numero_suframa) cliente.numero_suframa = cliente.numerosulframa;
    if (cliente.numero_suframa && !cliente.numerosulframa) cliente.numerosulframa = cliente.numero_suframa;

    // Dados da empresa emissora
    const idFilial = header[0].id_empresa ?? header[0].id_filial;
    const [empRows] = await (idFilial
      ? pool.query(`SELECT * FROM empresa WHERE id_empresa = ? LIMIT 1`, [idFilial])
      : pool.query(`SELECT * FROM empresa WHERE excluido = 'N' ORDER BY id_empresa LIMIT 1`)
    ).catch(() => [[]]);
    const empresa = empRows[0] || {};

    res.json({
      pedido: header[0],
      itens: itens,
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
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const { pedido, itens, parcelas } = req.body;

    // Comissão calculada no backend — ignora valores enviados pelo frontend
    const idPreposto = nPedidoId(pedido.id_preposto);
    const comissaoCalc = await _calcComissaoBackend(conn, pedido.cod_fornecedor, pedido.id_usuario, itens || [], idPreposto);
    if (comissaoCalc._nome_preposto) pedido.nome_preposto = comissaoCalc._nome_preposto;
    delete comissaoCalc._nome_preposto;
    Object.assign(pedido, comissaoCalc);

    // Geração automática de número seguindo sequência do Delphi
    let num = pedido.numero;
    if (!num || num === '') {
      const [seq] = await conn.query(`SELECT LPAD((COALESCE(MAX(numero + 0), 0) + 1), 6, '0') AS proximo FROM pedidos`);
      num = seq[0]?.proximo || '000001';
    }

    const up = s => (s || '').toString().toUpperCase();
    const horaBR = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false });
    const sit = (pedido.situacao_pedido || 'ENTREGAR').toUpperCase();
    // Usa a data enviada pelo frontend (hora local do usuário) para evitar problema de fuso horário
    // CURDATE() no servidor MySQL pode ser um dia à frente do horário do Brasil (UTC vs BRT)
    const dataAbertura = pedido.data_abertura || new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }).split('/').reverse().join('-');
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

    if (itens && itens.length > 0) {
      for (let seqItem = 0; seqItem < itens.length; seqItem++) {
        const item = itens[seqItem];
        const vlrUnitSemImp  = Math.round((item.valor_unitario || 0) * (1 - (item.desconto_percentual || 0) / 100) * 10000) / 10000;
        const vlrDescTotal   = Math.round((item.valor_unitario || 0) * (item.quantidade || 0) * (item.desconto_percentual || 0) / 100 * 100) / 100;
        const pesoItem       = item.total_peso || 0;
        const gradeResumo = (item.grade_qtd || []).filter(g => g.quantidade > 0).map(g => `${g.nome_grade}:${g.quantidade}`).join(' ');
        const iResult = await conn.query(
          `INSERT INTO itensped (
            numpedido, id_pedido, cod_produto, cod_fabricante, cod_fornecedor,
            desc_prod, unidade, kilo_embalagem, quantidade, valor_unitario, vlrtotal_itens,
            desconto, comissao,
            st, vlr_st, ipi, vlr_ipi, icms, vlr_icms,
            valor_puxada, total_peso, cores, obsitem,
            tipo_pedido, id_tipopedido,
            sequencia, vlr_unitariosemimposto, vlr_totalsemimposto, vlr_descontototal, peso,
            multiplo_sigla, multiplo_fator,
            id_grade, solado, tipo_grade, grade_resumo,
            tipo_preco,
            data_inclusao, sincronizar, excluido
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), 'N', 'N')`,
          [
            num, pedidoId,
            item.cod_produto, item.cod_fabricante || '', pedido.cod_fornecedor || null,
            item.desc_prod, item.unidade || '', item.embalagem || 0,
            item.quantidade, item.valor_unitario, item.vlrtotal_itens,
            item.desconto_percentual || 0, item.comissao_percentual || 0,
            item.st_percentual || 0, item.vlr_st || 0,
            item.ipi_percentual || 0, item.vlr_ipi || 0,
            0, 0,
            item.valor_puxada || 0, pesoItem,
            item.cores_qt || '', '',
            up(pedido.tipo_pedido) || 'PEDIDO', pedido.id_tipopedido || null,
            seqItem + 1, vlrUnitSemImp, item.vlrtotal_itens || 0, vlrDescTotal, pesoItem,
            item.multiplo_sigla || null, item.multiplo_fator || 1,
            item.id_grade || null, item.solado || null, item.tipo_grade || null, gradeResumo || null,
            item.tipo_preco || 'venda'
          ]
        );
        await _salvarGradeQtd(conn, iResult[0].insertId, item.grade_qtd);
      }
    }

    await salvarParcelas(conn, num, pedidoId, pedido, parcelas);

    await conn.commit();
    res.status(201).json({ ok: true, id: pedidoId });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
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

// POST /api/pedidos/:id — Atualização de Pedido
router.post('/:id', async (req, res) => {
  const conn = await getPool().getConnection();
  try {
    const { id } = req.params;
    const { pedido, itens, parcelas } = req.body;
    const id_usuario_log = req.user?.id || 1;
    await conn.beginTransaction();

    // Comissão calculada no backend quando itens são enviados (salvamento completo)
    if (pedido && itens && itens.length > 0) {
      let idVend = pedido.id_usuario;
      if (!idVend) {
        const [pv] = await conn.query(`SELECT id_usuario, id_preposto FROM pedidos WHERE id = ? LIMIT 1`, [id]).catch(() => [[]]);
        idVend = pv[0]?.id_usuario;
        if (pedido.id_preposto === undefined) pedido.id_preposto = pv[0]?.id_preposto || null;
      }
      const idPrepostoUpd = nPedidoId(pedido.id_preposto);
      const comissaoCalc = await _calcComissaoBackend(conn, pedido.cod_fornecedor, idVend, itens, idPrepostoUpd);
      if (comissaoCalc._nome_preposto) pedido.nome_preposto = comissaoCalc._nome_preposto;
      delete comissaoCalc._nome_preposto;
      Object.assign(pedido, comissaoCalc);
    }

    // Busca o estado atual para o log
    const [atual] = await conn.query('SELECT situacao_pedido, tipo_pedido FROM pedidos WHERE id = ?', [id]);
    const statusAntigo = atual[0]?.situacao_pedido;

    // 1. Atualiza cabeçalho do pedido
    if (pedido) {
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
        'vlr_faturado', 'vlr_faturamento', 'vlr_diferencafaturamento', 'notarecebida'
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
      
      await conn.query(`
        INSERT INTO logs_pedidos (id_pedido, id_usuario, acao, status_antigo, status_novo, detalhes)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
        id, id_usuario_log, acao, statusAntigo, pedido.situacao_pedido || statusAntigo,
        JSON.stringify(pedido) // Salva o que foi alterado nos detalhes
      ]);
    }

    // 2. Atualiza Itens (Se fornecidos)
    if (itens && Array.isArray(itens)) {
      // Busca o número do pedido para os itens
      const [p] = await conn.query('SELECT numero FROM pedidos WHERE id = ?', [id]);
      if (p[0]) {
        const numPedido = p[0].numero;
        // Apaga grade_qtd dos itens antigos antes de deletar os itens
        const [oldIds] = await conn.query(`SELECT id FROM itensped WHERE numpedido = ?`, [numPedido]);
        if (oldIds.length) {
          await conn.query(`DELETE FROM itensped_grade_qtd WHERE id_item_ped IN (?)`, [oldIds.map(r => r.id)]);
        }
        await conn.query(`DELETE FROM itensped WHERE numpedido = ?`, [numPedido]);

        for (let seqItem = 0; seqItem < itens.length; seqItem++) {
          const item = itens[seqItem];
          const vlrUnitSemImp = Math.round((item.valor_unitario || 0) * (1 - (item.desconto_percentual || 0) / 100) * 10000) / 10000;
          const vlrDescTotal  = Math.round((item.valor_unitario || 0) * (item.quantidade || 0) * (item.desconto_percentual || 0) / 100 * 100) / 100;
          const pesoItem      = item.total_peso || 0;
          const gradeResumo   = (item.grade_qtd || []).filter(g => g.quantidade > 0).map(g => `${g.nome_grade}:${g.quantidade}`).join(' ');
          const iResult = await conn.query(
            `INSERT INTO itensped (
              numpedido, id_pedido, cod_produto, cod_fabricante, cod_fornecedor,
              desc_prod, unidade, kilo_embalagem, quantidade, valor_unitario, vlrtotal_itens,
              desconto, comissao,
              st, vlr_st, ipi, vlr_ipi, icms, vlr_icms,
              valor_puxada, total_peso, cores, obsitem,
              tipo_pedido, id_tipopedido,
              sequencia, vlr_unitariosemimposto, vlr_totalsemimposto, vlr_descontototal, peso,
              multiplo_sigla, multiplo_fator,
              id_grade, solado, tipo_grade, grade_resumo,
              tipo_preco,
              data_inclusao, sincronizar, excluido
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), 'N', 'N')`,
            [
              numPedido, id,
              item.cod_produto, item.cod_fabricante || '', pedido?.cod_fornecedor || null,
              item.desc_prod, item.unidade || '', item.embalagem || 0,
              item.quantidade, item.valor_unitario, item.vlrtotal_itens,
              item.desconto_percentual || 0, item.comissao_percentual || 0,
              item.st_percentual || 0, item.vlr_st || 0,
              item.ipi_percentual || 0, item.vlr_ipi || 0,
              0, 0,
              item.valor_puxada || 0, pesoItem,
              item.cores_qt || '', '',
              (pedido?.tipo_pedido || '').toUpperCase() || 'PEDIDO', pedido?.id_tipopedido || null,
              seqItem + 1, vlrUnitSemImp, item.vlrtotal_itens || 0, vlrDescTotal, pesoItem,
              item.multiplo_sigla || null, item.multiplo_fator || 1,
              item.id_grade || null, item.solado || null, item.tipo_grade || null, gradeResumo || null,
              item.tipo_preco || 'venda'
            ]
          );
          await _salvarGradeQtd(conn, iResult[0].insertId, item.grade_qtd);
        }
      }
    }

    // 3. Parcelas (só regrava se vieram com conteúdo — preserva ao mudar só status)
    if (parcelas && Array.isArray(parcelas) && parcelas.length > 0) {
      const [ph] = await conn.query(
        'SELECT numero, cod_fornecedor, nome_fornecedor, comissao, id_usuario, data_abertura FROM pedidos WHERE id = ?',
        [id]
      );
      if (ph[0]) {
        const pedidoAtual = pedido || {};
        pedidoAtual.cod_fornecedor  = pedidoAtual.cod_fornecedor  ?? ph[0].cod_fornecedor;
        pedidoAtual.nome_fornecedor = pedidoAtual.nome_fornecedor ?? ph[0].nome_fornecedor;
        pedidoAtual.comissao        = pedidoAtual.comissao        ?? ph[0].comissao;
        pedidoAtual.id_usuario      = pedidoAtual.id_usuario      ?? ph[0].id_usuario;
        pedidoAtual.data_abertura   = pedidoAtual.data_abertura   ?? ph[0].data_abertura;
        await conn.query(`DELETE FROM receber WHERE numero = ?`, [ph[0].numero]);
        await salvarParcelas(conn, ph[0].numero, parseInt(id), pedidoAtual, parcelas);
      }
    }

    await conn.commit();
    releasePedidoEditLock(id, req.user?.id);
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

    // 1. Exclui itens do pedido
    await conn.query(`DELETE FROM itensped WHERE numpedido = ?`, [numPedido]);

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
    releasePedidoEditLock(id, id_usuario_log);
    res.json({ ok: true, numero: numPedido });
  } catch (err) {
    await conn.rollback();
    console.error('ERRO AO EXCLUIR PEDIDO:', err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// POST /api/pedidos/bulk-update — Atualização em Massa

router.post('/bulk-update', async (req, res) => {
  const conn = await getPool().getConnection();
  try {
    const { ids, update } = req.body; // ids: [1,2,3], update: { situacao_pedido: 'APROVADO' }
    const id_usuario_log = req.user?.id || 1;
    if (!ids || !ids.length) return res.status(400).json({ error: 'Nenhum pedido selecionado' });

    await conn.beginTransaction();

    for (const id of ids) {
      // Pega status antigo para o log
      const [old] = await conn.query('SELECT situacao_pedido FROM pedidos WHERE id = ?', [id]);
      
      // Aplica atualização (Suporta conversão de Orçamento para Pedido se necessário)
      const sets = [];
      const vals = [];
      if (update.situacao_pedido) { sets.push('situacao_pedido = ?'); vals.push(update.situacao_pedido); }
      if (update.tipo_pedido)     { sets.push('tipo_pedido = ?');     vals.push(update.tipo_pedido); }
      
      if (sets.length > 0) {
        vals.push(id);
        await conn.query(`UPDATE pedidos SET ${sets.join(', ')} WHERE id = ?`, vals);
        
        // Log individual para cada alteração em massa
        await conn.query(`
          INSERT INTO logs_pedidos (id_pedido, id_usuario, acao, status_antigo, status_novo, detalhes)
          VALUES (?, ?, 'ALTERACAO_MASSA', ?, ?, ?)
        `, [id, id_usuario_log, old[0]?.situacao_pedido, update.situacao_pedido || old[0]?.situacao_pedido, 'Atualização via ação em massa']);
      }
    }

    await conn.commit();
    res.json({ ok: true, count: ids.length });
  } catch (err) {
    await conn.rollback();
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
const fsSync  = require('fs');
const pathMod = require('path');

// ── detecta Chrome/Chromium instalado (Windows e Linux) ─────────────────────
function findChrome() {
  const local = process.env.LOCALAPPDATA || '';
  const candidates = [
    process.env.CHROME_PATH,
    // Linux
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    // Windows
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    local ? pathMod.join(local, 'Google\\Chrome\\Application\\chrome.exe') : null,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  return candidates.find(p => fsSync.existsSync(p)) || null;
}

// ── converte HTML string → Buffer PDF via puppeteer-core ────────────────────
async function htmlToPdf(html) {
  const puppeteer = require('puppeteer-core');
  const execPath  = findChrome();
  if (!execPath) throw new Error('Chrome/Edge não encontrado. Defina CHROME_PATH no .env');
  const browser = await puppeteer.launch({
    executablePath: execPath,
    headless: 'new',
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 800));
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '12mm', right: '12mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

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

// POST /api/pedidos/:id/pdf-generate
// Recebe HTML do front, gera PDF, devolve base64
router.post('/:id/pdf-generate', async (req, res) => {
  try {
    const { html } = req.body;
    if (!html) return res.status(400).json({ error: 'HTML não informado' });
    const pdf = await htmlToPdf(html);
    res.json({ ok: true, pdf: pdf.toString('base64'), size: pdf.length });
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
      } catch (err) {
        results.email = { ok: false, error: err.message };
      }
    }

    // ── WhatsApp ────────────────────────────────────────────────────────────
    if ((via === 'whatsapp' || via === 'ambos') && telefone) {
      try {
        const [cfgRows] = await pool.query(
          `SELECT w_urlplataforma, w_apiglobal FROM configuracao WHERE excluido='N' ORDER BY id DESC LIMIT 1`
        ).catch(() => [[]]);
        if (!cfgRows[0]?.w_urlplataforma) throw new Error('Evolution API não configurada');
        const cfg = { url: cfgRows[0].w_urlplataforma, apikey: cfgRows[0].w_apiglobal };

        const [uRows] = await pool.query(
          `SELECT instancia FROM usuarios WHERE idusuario=? AND excluido='N' LIMIT 1`, [userId]
        ).catch(() => [[]]);
        if (!uRows[0]?.instancia) throw new Error('Usuário sem instância WhatsApp configurada');
        const instancia = uRows[0].instancia;

        const fone = telefone.replace(/\D/g, '');
        const numero = fone.startsWith('55') ? fone : `55${fone}`;

        const r = await evoRequest(cfg.url, `/message/sendMedia/${instancia}`, 'POST', cfg.apikey, {
          number:    numero,
          mediatype: 'document',
          mimetype:  'application/pdf',
          caption:   mensagem || `Segue em anexo o Pedido Nº ${numero_pedido}`,
          media:     pdf_base64,
          fileName,
        });
        results.whatsapp = r.status < 300 ? { ok: true } : { ok: false, error: JSON.stringify(r.body).slice(0,200) };
      } catch (err) {
        results.whatsapp = { ok: false, error: err.message };
      }
    }

    res.json({ ok: true, results });
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
