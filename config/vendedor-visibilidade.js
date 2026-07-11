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

/** Vê todos os vendedores (admin ou perfil acessar_vendastodos). */
function canAccessAllVendors(req) {
  if (isAdminUser(req)) return true;
  const p = perm(req);
  const v = p.acessar_vendastodos;
  if (v === 'S') return true;
  if (v === 'N') return false;
  // legado: perfis sem a coluna — mantém regra antiga (acessartodosclientes)
  return p.acessartodosclientes === 'S';
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
 * @returns {{ idRep:number|null, idPreposto:number, modo:'TODOS'|'ATRIBUIDOS', pedidosVisib:'CARTEIRA'|'PROPRIOS' }|null}
 *  - idRep: id do representante principal (carteira que o preposto enxerga)
 *  - modo TODOS = toda a carteira do representante (clientes)
 *  - modo ATRIBUIDOS = só clientes vinculados em preposto_cliente
 *  - pedidosVisib CARTEIRA = vê pedidos da carteira/representante (padrão)
 *  - pedidosVisib PROPRIOS = só vê os pedidos que ele mesmo lançou (esconde vendas do representante)
 */
async function getPrepostoContext(pool, req) {
  if (!isPrepostoUser(req)) return null;
  const idPreposto = req?.user?.id;
  let idRep = req?.user?.id_gerente || null;
  let modo = 'TODOS';
  let pedidosVisib = 'CARTEIRA';
  try {
    const [[row]] = await pool.query(
      `SELECT id_gerente,
              COALESCE(preposto_visibilidade,'TODOS') AS modo,
              COALESCE(preposto_pedidos_visibilidade,'CARTEIRA') AS pedidos_visib
       FROM usuarios WHERE idusuario = ? LIMIT 1`,
      [idPreposto]
    );
    if (row) {
      idRep = row.id_gerente || idRep;
      modo = String(row.modo || 'TODOS').toUpperCase() === 'ATRIBUIDOS' ? 'ATRIBUIDOS' : 'TODOS';
      pedidosVisib = String(row.pedidos_visib || 'CARTEIRA').toUpperCase() === 'PROPRIOS' ? 'PROPRIOS' : 'CARTEIRA';
    }
  } catch { /* coluna/tabela pode não existir em base muito antiga → TODOS/CARTEIRA */ }
  return { idRep, idPreposto, modo, pedidosVisib };
}

/** Pode escolher outro vendedor no combo (admin, acessar_vendastodos ou gerente). */
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

  // Preposto em query de pedidos (id_usuario = representante, id_preposto = ele mesmo):
  // filtrar pela coluna correta — senão `id_usuario = uid` nunca bate (pedido fica no nome do representante).
  if (isPrepostoUser(req) && col === 'p.id_usuario') {
    const idRep = req?.user?.id_gerente || null;
    const pedidosVisib = String(req?.user?.preposto_pedidos_visibilidade || 'CARTEIRA').toUpperCase() === 'PROPRIOS'
      ? 'PROPRIOS' : 'CARTEIRA';
    if (pedidosVisib === 'PROPRIOS' || !idRep) {
      return { clause: ` AND p.id_preposto = ?`, params: [uid], canPickOthers: false };
    }
    return { clause: ` AND (p.id_usuario = ? OR p.id_preposto = ?)`, params: [idRep, uid], canPickOthers: false };
  }

  // Preposto em query de clientes (clientes.cod_vendedor = representante, não o preposto):
  // carteira segue preposto_visibilidade (TODOS/ATRIBUIDOS) — independe do pedidosVisib (que só afeta pedidos).
  if (isPrepostoUser(req) && col === 'c.cod_vendedor') {
    const idRep = req?.user?.id_gerente || null;
    if (!idRep) return { clause: ` AND ${col} = ?`, params: [uid], canPickOthers: false };
    const modo = String(req?.user?.preposto_visibilidade || 'TODOS').toUpperCase() === 'ATRIBUIDOS' ? 'ATRIBUIDOS' : 'TODOS';
    if (modo === 'ATRIBUIDOS') {
      return {
        clause: ` AND ${col} = ? AND c.id IN (SELECT cod_cliente FROM preposto_cliente WHERE id_preposto = ? AND excluido = 'N')`,
        params: [idRep, uid],
        canPickOthers: false,
      };
    }
    return { clause: ` AND ${col} = ?`, params: [idRep], canPickOthers: false };
  }

  return { clause: ` AND ${col} = ?`, params: [uid], canPickOthers: false };
}

/**
 * Mesma regra da listagem GET /api/pedidos (admin, gerente, preposto, vendedor restrito).
 * Usar em KPIs, alertas de retorno e qualquer agregação sobre pedidos.
 * @returns {{ clause: string, params: any[] }}
 */
async function buildPedidosListVisWhere(pool, req) {
  const _userId = req?.user?.id || 0;
  const _isAdmin = req?.user?.perfil == 1;
  const _perm = perm(req);
  const _acessaVendasTodos = canAccessAllVendors(req);
  const _eGerente = !_isAdmin && _perm.gerentecomercial === 'S';
  const _ePreposto = isPrepostoUser(req);
  const _prepCtx = _ePreposto && pool ? await getPrepostoContext(pool, req) : null;

  let visWhere = '';
  const visParams = [];
  if (!_isAdmin && !_acessaVendasTodos) {
    if (_eGerente) {
      visWhere = ` AND (p.id_usuario = ? OR p.id_usuario IN (SELECT idusuario FROM usuarios WHERE id_gerente = ? AND excluido = 'N'))`;
      visParams.push(_userId, _userId);
    } else if (_prepCtx) {
      if (_prepCtx.pedidosVisib === 'PROPRIOS') {
        visWhere = ` AND p.id_preposto = ?`;
        visParams.push(_prepCtx.idPreposto);
      } else if (_prepCtx.modo === 'ATRIBUIDOS') {
        visWhere = ` AND (p.id_preposto = ? OR p.cod_cliente IN (SELECT cod_cliente FROM preposto_cliente WHERE id_preposto = ? AND excluido = 'N'))`;
        visParams.push(_prepCtx.idPreposto, _prepCtx.idPreposto);
      } else {
        visWhere = ` AND (p.id_usuario = ? OR p.id_preposto = ?)`;
        visParams.push(_prepCtx.idRep, _prepCtx.idPreposto);
      }
    } else {
      visWhere = ` AND p.id_usuario = ?`;
      visParams.push(_userId);
    }
  }
  return { clause: visWhere, params: visParams };
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
  buildPedidosListVisWhere,
};
