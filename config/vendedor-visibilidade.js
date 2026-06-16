/**
 * Visibilidade de vendedores em listagens, relatórios e lookups.
 * Quem NÃO tem acesso a outros vendedores só enxerga a si (preposto: regras em comissao-preposto-guard).
 */

function isAdminUser(req) {
  return req?.user?.perfil == 1 || req?.user?.role === 'admin';
}

function perm(req) {
  return req?.user?.permissoes || {};
}

/** Vê todos os vendedores (admin ou perfil acessartodosclientes). */
function canAccessAllVendors(req) {
  if (isAdminUser(req)) return true;
  return perm(req).acessartodosclientes === 'S';
}

/** Gerente comercial — carteira da equipe (não necessariamente todos). */
function isGerenteComercial(req) {
  return !isAdminUser(req) && perm(req).gerentecomercial === 'S';
}

/** Preposto — vendedor vinculado a um representante principal (id_gerente). */
function isPrepostoUser(req) {
  return req?.user?.tipo_usuario === 'PREPOSTO';
}

/**
 * Contexto de visibilidade do preposto logado.
 * Retorna null se o usuário não é preposto.
 * @returns {{ idRep:number|null, idPreposto:number, modo:'TODOS'|'ATRIBUIDOS' }|null}
 *  - idRep: id do representante principal (carteira que o preposto enxerga)
 *  - modo TODOS = toda a carteira do representante
 *  - modo ATRIBUIDOS = só clientes vinculados em preposto_cliente
 */
async function getPrepostoContext(pool, req) {
  if (!isPrepostoUser(req)) return null;
  const idPreposto = req?.user?.id;
  let idRep = req?.user?.id_gerente || null;
  let modo = 'TODOS';
  try {
    const [[row]] = await pool.query(
      `SELECT id_gerente, COALESCE(preposto_visibilidade,'TODOS') AS modo
       FROM usuarios WHERE idusuario = ? LIMIT 1`,
      [idPreposto]
    );
    if (row) {
      idRep = row.id_gerente || idRep;
      modo = String(row.modo || 'TODOS').toUpperCase() === 'ATRIBUIDOS' ? 'ATRIBUIDOS' : 'TODOS';
    }
  } catch { /* coluna/tabela pode não existir em base muito antiga → TODOS */ }
  return { idRep, idPreposto, modo };
}

/** Pode escolher outro vendedor no combo (admin, acessartodosclientes ou gerente). */
function canPickOtherVendors(req) {
  return canAccessAllVendors(req) || isGerenteComercial(req);
}

async function isVendedorVisivel(pool, req, idVendedor) {
  const uid = req?.user?.id;
  const vid = parseInt(idVendedor, 10);
  if (!uid || !vid) return false;
  if (canAccessAllVendors(req)) return true;
  if (String(vid) === String(uid)) return true;
  if (isGerenteComercial(req)) {
    const [[row]] = await pool.query(
      `SELECT idusuario FROM usuarios
       WHERE idusuario = ? AND excluido = 'N'
         AND (idusuario = ? OR id_gerente = ?)
       LIMIT 1`,
      [vid, uid, uid]
    ).catch(() => [[]]);
    return !!row;
  }
  return false;
}

/**
 * ID de vendedor efetivo para filtros de API.
 * null = sem filtro por vendedor (todos permitidos ao perfil).
 */
async function resolveVendedorIdForFilter(pool, req, idFromQuery) {
  const uid = req?.user?.id;
  if (!uid) return null;

  const q = idFromQuery != null && idFromQuery !== '' ? String(idFromQuery).trim() : '';

  if (canAccessAllVendors(req)) {
    return q || null;
  }

  if (isGerenteComercial(req)) {
    if (!q || q === String(uid)) return q || null;
    const ok = await isVendedorVisivel(pool, req, q);
    return ok ? q : String(uid);
  }

  return String(uid);
}

/** Lista vendedores para combos (já filtrada por permissão). */
async function listVendedoresVisiveis(pool, req, { pix = false, onlyPVender = false } = {}) {
  const uid = req?.user?.id || 0;
  const pixCols = pix ? ', pix_tipo, pix_chave' : '';
  let joinPerfil = '';
  let whereExtra = '';

  if (onlyPVender) {
    joinPerfil = ` INNER JOIN perfil p ON p.id = u.idperfil AND p.excluido = 'N' AND p.p_vender = 'S' `;
  }

  const baseSelect = `
    SELECT u.idusuario AS id, u.nomeusu AS nome, u.nomeusu AS nome_vendedor${pixCols}
    FROM usuarios u
    ${joinPerfil}
    WHERE u.excluido = 'N'
      AND (u.situacao = 'ATIVO' OR u.situacao IS NULL OR u.situacao = '')
      ${whereExtra}
  `;

  if (canAccessAllVendors(req)) {
    const [rows] = await pool.query(`${baseSelect} ORDER BY u.nomeusu`);
    return rows;
  }

  if (isGerenteComercial(req)) {
    const [rows] = await pool.query(
      `${baseSelect}
         AND (u.idusuario = ? OR u.id_gerente = ?)
       ORDER BY u.nomeusu`,
      [uid, uid]
    );
    return rows;
  }

  const [rows] = await pool.query(
    `${baseSelect} AND u.idusuario = ? LIMIT 1`,
    [uid]
  );
  return rows;
}

async function buildPedidosVendedorWhere(pool, req, idFromQuery, col = 'p.id_usuario') {
  const uid = req?.user?.id;
  if (!uid) return { clause: '', params: [], canPickOthers: false };

  const resolved = await resolveVendedorIdForFilter(pool, req, idFromQuery);

  if (canAccessAllVendors(req)) {
    if (resolved) {
      return { clause: ` AND ${col} = ?`, params: [parseInt(resolved, 10)], canPickOthers: true };
    }
    return { clause: '', params: [], canPickOthers: true };
  }

  if (isGerenteComercial(req)) {
    if (resolved) {
      return { clause: ` AND ${col} = ?`, params: [parseInt(resolved, 10)], canPickOthers: true };
    }
    return {
      clause: ` AND (${col} = ? OR ${col} IN (SELECT idusuario FROM usuarios WHERE id_gerente = ? AND excluido = 'N'))`,
      params: [uid, uid],
      canPickOthers: true,
    };
  }

  return { clause: ` AND ${col} = ?`, params: [uid], canPickOthers: false };
}

/** Filtro SQL por coluna de vendedor — versão síncrona para relatórios. */
function buildPedidosVendedorWhereSync(req, idFromQuery, col = 'p.id_usuario') {
  const uid = req?.user?.id;
  if (!uid) return { clause: '', params: [], canPickOthers: false };

  const q = idFromQuery != null && idFromQuery !== '' ? String(idFromQuery).trim() : '';

  if (canPickOtherVendors(req)) {
    if (q) {
      return { clause: ` AND ${col} = ?`, params: [parseInt(q, 10)], canPickOthers: true };
    }
    if (canAccessAllVendors(req)) {
      return { clause: '', params: [], canPickOthers: true };
    }
    return {
      clause: ` AND (${col} = ? OR ${col} IN (SELECT idusuario FROM usuarios WHERE id_gerente = ? AND excluido = 'N'))`,
      params: [uid, uid],
      canPickOthers: true,
    };
  }

  return { clause: ` AND ${col} = ?`, params: [uid], canPickOthers: false };
}

module.exports = {
  isAdminUser,
  canAccessAllVendors,
  isGerenteComercial,
  isPrepostoUser,
  getPrepostoContext,
  canPickOtherVendors,
  isVendedorVisivel,
  resolveVendedorIdForFilter,
  listVendedoresVisiveis,
  buildPedidosVendedorWhere,
  buildPedidosVendedorWhereSync,
};
