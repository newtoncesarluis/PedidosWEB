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
 * @returns {{ clause: string, params: number[] }} clause começa com " AND " ou vazio
 */
function buildClienteVendedorWhere(user, alias = 'c') {
  const uid = user?.id || user?.idusuario;
  if (!uid || podeVerTodosClientes(user)) {
    return { clause: '', params: [] };
  }

  const col = alias ? `${alias}.cod_vendedor` : 'cod_vendedor';
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
