'use strict';

/**
 * Política unificada de carteira de clientes (visibilidade + vínculo no cadastro).
 *
 * Modos em sistemas.carteira_politica (opt-in por tenant):
 *   LEGADO  — comportamento idêntico às flags antigas (padrão; não quebra bases existentes)
 *   FECHADA — carteira por vendedor; novo cliente sempre vincula a quem cadastrou
 *   EQUIPE  — igual FECHADA + gestores com gerentecomercial veem a equipe (via perfil)
 *   ABERTA  — todos os usuários veem todos os clientes (exceto regras de preposto)
 */

const MODOS = Object.freeze(['LEGADO', 'FECHADA', 'EQUIPE', 'ABERTA']);

let _configCache = { db: null, at: 0, data: null };
const CONFIG_TTL_MS = 60_000;

function normalizeModo(v) {
  const m = String(v || 'LEGADO').trim().toUpperCase();
  return MODOS.includes(m) ? m : 'LEGADO';
}

function isAdminCliente(user) {
  return user?.perfil == 1 || user?.role === 'admin';
}

function perm(user) {
  return user?.permissoes || {};
}

function resolveModoFromConfig(config) {
  if (!config) return 'LEGADO';
  return normalizeModo(config.carteira_politica);
}

/** Carteira fechada/equipe exige vendedor informado no cadastro. */
function vendedorObrigatorioNaCarteira(config) {
  const modo = resolveModoFromConfig(config);
  return modo === 'FECHADA' || modo === 'EQUIPE';
}

/** cod_vendedor válido para gravar (rejeita vazio, null e zero legado). */
function codVendedorInformado(val) {
  const s = String(val ?? '').trim();
  return s !== '' && s !== '0';
}

/** Carrega flags de carteira da tabela sistemas (cache curto por banco). */
async function getSistemaCarteiraConfig(pool) {
  const now = Date.now();
  let dbName = '';
  try {
    const [[row]] = await pool.query('SELECT DATABASE() AS db');
    dbName = row?.db || '';
  } catch { /* ignore */ }

  if (_configCache.db === dbName && _configCache.data && (now - _configCache.at) < CONFIG_TTL_MS) {
    return _configCache.data;
  }

  let config = {};
  try {
    const [rows] = await pool.query(
      `SELECT carteira_politica, gacessartodosclientes, gcompartilhaCliente
       FROM sistemas ORDER BY id DESC LIMIT 1`
    );
    config = rows[0] || {};
  } catch {
    try {
      const [rows] = await pool.query(
        `SELECT gacessartodosclientes, gcompartilhaCliente FROM sistemas ORDER BY id DESC LIMIT 1`
      );
      config = rows[0] || {};
    } catch { /* tabela/coluna inexistente */ }
  }

  _configCache = { db: dbName, at: now, data: config };
  return config;
}

function invalidateSistemaCarteiraCache() {
  _configCache = { db: null, at: 0, data: null };
}

/** Admin ou perfil com acessartodosclientes = S (modo ABERTA amplia para todos). */
function podeVerTodosClientes(user, config = null) {
  if (isAdminCliente(user)) return true;
  const modo = resolveModoFromConfig(config);
  if (modo === 'ABERTA') return true;
  return perm(user).acessartodosclientes === 'S';
}

function isGerenteComercialCliente(user) {
  return !isAdminCliente(user) && perm(user).gerentecomercial === 'S';
}

/**
 * Filtro SQL por cod_vendedor / preposto.
 * @param {object|null} config — sistemas; omitido = LEGADO (compatível com chamadas antigas)
 */
function buildClienteVendedorWhere(user, alias = 'c', prepCtx = null, config = null) {
  const col = alias ? `${alias}.cod_vendedor` : 'cod_vendedor';
  const idCol = alias ? `${alias}.id` : 'id';

  if (prepCtx) {
    if (prepCtx.modo === 'ATRIBUIDOS') {
      return {
        clause: ` AND ${idCol} IN (SELECT cod_cliente FROM preposto_cliente WHERE id_preposto = ? AND excluido = 'N')`,
        params: [prepCtx.idPreposto],
      };
    }
    return {
      clause: ` AND (${col} = ? OR CAST(${col} AS UNSIGNED) = ?)`,
      params: [prepCtx.idRep, prepCtx.idRep],
    };
  }

  const uid = user?.id || user?.idusuario;
  if (!uid || podeVerTodosClientes(user, config)) {
    return { clause: '', params: [] };
  }

  if (isGerenteComercialCliente(user)) {
    return {
      clause: ` AND (${col} = ? OR CAST(${col} AS UNSIGNED) = ? OR ${col} IN (SELECT idusuario FROM usuarios WHERE id_gerente = ? AND excluido = 'N'))`,
      params: [uid, uid, uid],
    };
  }

  return {
    clause: ` AND (${col} = ? OR CAST(${col} AS UNSIGNED) = ?)`,
    params: [uid, uid],
  };
}

/**
 * Novo/edição de cliente: força cod_vendedor do usuário logado.
 * LEGADO: só quando gacessartodosclientes='S' no sistema (comportamento anterior).
 * FECHADA/EQUIPE: representantes sem "ver todos clientes" no perfil.
 */
function deveForcarVendedorNoCadastro(user, config = null) {
  if (isAdminCliente(user)) return false;
  if (perm(user).acessartodosclientes === 'S') return false;

  const modo = resolveModoFromConfig(config);
  if (modo === 'FECHADA' || modo === 'EQUIPE') return true;

  return String(config?.gacessartodosclientes || '').toUpperCase() === 'S';
}

/** Resolve cod_vendedor efetivo ao gravar cliente (preposto → representante). */
function resolveCodVendedorGravacao(user, config, prepCtx, bodyCodVendedor) {
  if (prepCtx?.idRep) return prepCtx.idRep;
  if (deveForcarVendedorNoCadastro(user, config)) {
    return user?.id || user?.idusuario || bodyCodVendedor;
  }
  return bodyCodVendedor;
}

/**
 * Verifica se o usuário pode acessar o cliente (consulta, pedido, histórico…).
 * @returns {Promise<{ ok: boolean, error?: string, status?: number }>}
 */
async function assertUsuarioPodeAcessarCliente(pool, clienteId, user, prepCtx = null) {
  const id = parseInt(clienteId, 10);
  if (!id || id < 1) {
    return { ok: false, status: 400, error: 'Cliente inválido' };
  }

  const config = await getSistemaCarteiraConfig(pool);
  const vendFiltro = buildClienteVendedorWhere(user, 'c', prepCtx, config);

  if (!vendFiltro.clause) {
    const [rows] = await pool.query(
      `SELECT 1 FROM clientes c
       WHERE c.id = ? AND (c.excluido = 'N' OR c.excluido IS NULL OR c.excluido = '')
       LIMIT 1`,
      [id]
    );
    return rows.length
      ? { ok: true }
      : { ok: false, status: 404, error: 'Cliente não encontrado' };
  }

  const [rows] = await pool.query(
    `SELECT 1 FROM clientes c
     WHERE c.id = ?
       AND (c.excluido = 'N' OR c.excluido IS NULL OR c.excluido = '')
       ${vendFiltro.clause}
     LIMIT 1`,
    [id, ...vendFiltro.params]
  );

  return rows.length
    ? { ok: true }
    : { ok: false, status: 403, error: 'Cliente fora da sua carteira' };
}

/** Rótulos amigáveis para a UI de configuração. */
const MODO_LABELS = {
  LEGADO: 'Legado (flags atuais do perfil — padrão)',
  FECHADA: 'Carteira fechada (cada vendedor só vê os seus)',
  EQUIPE: 'Carteira por equipe (gestor vê subordinados)',
  ABERTA: 'Carteira aberta (todos veem todos os clientes)',
};

module.exports = {
  MODOS,
  MODO_LABELS,
  normalizeModo,
  resolveModoFromConfig,
  vendedorObrigatorioNaCarteira,
  codVendedorInformado,
  isAdminCliente,
  podeVerTodosClientes,
  isGerenteComercialCliente,
  buildClienteVendedorWhere,
  deveForcarVendedorNoCadastro,
  resolveCodVendedorGravacao,
  assertUsuarioPodeAcessarCliente,
  getSistemaCarteiraConfig,
  invalidateSistemaCarteiraCache,
};
