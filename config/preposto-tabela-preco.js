'use strict';

/**
 * Herança de tabela de preço do preposto a partir do representante (id_gerente).
 * Modo TODOS = todas as tabelas vinculadas ao representante (tipo_entidade='VENDEDOR').
 * Modo ATRIBUIDOS = só o subconjunto marcado em preposto_tabela_preco.
 */

const _ensuredPools = new WeakSet();

async function ensurePrepostoTabelaPrecoSchema(pool) {
  if (_ensuredPools.has(pool)) return;
  _ensuredPools.add(pool);
  await pool.query(
    `ALTER TABLE usuarios ADD COLUMN preposto_tabela_visibilidade VARCHAR(20) NOT NULL DEFAULT 'TODOS'`
  ).catch(() => {});
  await pool.query(`CREATE TABLE IF NOT EXISTS preposto_tabela_preco (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_preposto INT NOT NULL,
    id_tabela INT NOT NULL,
    excluido CHAR(1) NOT NULL DEFAULT 'N',
    dtcadastro DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unq_prep_tab (id_preposto, id_tabela),
    INDEX idx_pt_preposto (id_preposto)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).catch(() => {});
}

/**
 * Resolve a entidade "Vendedor" efetiva para a busca de tabela de preço.
 * Se idVendedor for um preposto, retorna o representante (id_gerente) e,
 * se o preposto estiver em modo ATRIBUIDOS, a lista de tabelas permitidas.
 * @returns {{idEntidade:number, idsPermitidos:number[]|null}|null}
 *   idsPermitidos null = sem restrição (usa tudo vinculado a idEntidade)
 */
async function resolverVendedorTabelaPreco(pool, idVendedor) {
  const id = parseInt(idVendedor, 10);
  if (!id) return null;
  await ensurePrepostoTabelaPrecoSchema(pool);

  let usr = null;
  try {
    const [[row]] = await pool.query(
      `SELECT tipo_usuario, id_gerente, COALESCE(preposto_tabela_visibilidade,'TODOS') AS modo
       FROM usuarios WHERE idusuario = ? LIMIT 1`,
      [id]
    );
    usr = row;
  } catch { /* coluna pode não existir em base muito antiga */ }

  if (!usr || usr.tipo_usuario !== 'PREPOSTO' || !usr.id_gerente) {
    return { idEntidade: id, idsPermitidos: null };
  }

  const idRep = parseInt(usr.id_gerente, 10);
  if (String(usr.modo || 'TODOS').toUpperCase() !== 'ATRIBUIDOS') {
    return { idEntidade: idRep, idsPermitidos: null };
  }

  const [rows] = await pool.query(
    `SELECT id_tabela FROM preposto_tabela_preco WHERE id_preposto = ? AND excluido = 'N'`,
    [id]
  ).catch(() => [[]]);
  const idsPermitidos = rows.map((r) => parseInt(r.id_tabela, 10)).filter(Boolean);
  return { idEntidade: idRep, idsPermitidos };
}

module.exports = { ensurePrepostoTabelaPrecoSchema, resolverVendedorTabelaPreco };
