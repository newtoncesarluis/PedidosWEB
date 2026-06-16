/**
 * Visibilidade de clientes por perfil (acessartodosclientes / gerentecomercial).
 * Usado em listagens, mobile offline e APIs que filtram carteira.
 */

function isAdminCliente(user) {
  return user?.perfil == 1 || user?.role === 'admin';
}

function perm(user) {
  return user?.permissoes || {};
}

/** Admin ou perfil com acessartodosclientes = S */
function podeVerTodosClientes(user) {
  if (isAdminCliente(user)) return true;
  return perm(user).acessartodosclientes === 'S';
}

function isGerenteComercialCliente(user) {
  return !isAdminCliente(user) && perm(user).gerentecomercial === 'S';
}

/**
 * Filtro SQL por cod_vendedor.
 * @param {object} user req.user
 * @param {string} alias alias da tabela clientes (ex: 'c' ou '' )
 * @param {{idRep:number|null,idPreposto:number,modo:string}|null} prepCtx contexto do preposto
 *        (getPrepostoContext) — quando presente força a carteira do representante.
 * @returns {{ clause: string, params: number[] }} clause começa com " AND " ou vazio
 */
function buildClienteVendedorWhere(user, alias = 'c', prepCtx = null) {
  const col = alias ? `${alias}.cod_vendedor` : 'cod_vendedor';
  const idCol = alias ? `${alias}.id` : 'id';

  // Preposto: enxerga a carteira do representante (id_gerente), tem precedência sobre demais regras
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
  if (!uid || podeVerTodosClientes(user)) {
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

module.exports = {
  isAdminCliente,
  podeVerTodosClientes,
  isGerenteComercialCliente,
  buildClienteVendedorWhere,
};
