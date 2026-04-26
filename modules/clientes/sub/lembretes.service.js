'use strict';

const { getPool } = require('../../../config/database');

/**
 * Busca todos os campos de cadastro cadastrados no sistema
 */
async function buscarCamposCadastro(pool) {
  const executor = pool || getPool();
  const [rows] = await executor.query(
    `SELECT * FROM campos_cadastros WHERE excluido = 'N' ORDER BY nome`,
    []
  ).catch(() => [[]]);
  return rows;
}

/**
 * Busca lembretes marcados para o cliente
 */
async function buscarLembretesCliente(idCliente, pool) {
  const executor = pool || getPool();
  const [rows] = await executor.query(
    `SELECT * FROM campos_cadastrocliente WHERE id_cliente = ? AND excluido = 'N'`,
    [idCliente]
  ).catch(() => [[]]);
  return rows;
}

/**
 * Salva lembretes do cliente
 * Lógica:
 *   - check=true  e salvar='S' → INSERT
 *   - check=true  e salvar='N' → UPDATE (reativar)
 *   - check=false e salvar='N' → soft delete
 */
async function salvarLembretes(idCliente, campos, conn) {
  if (!Array.isArray(campos) || campos.length === 0) return;

  for (const campo of campos) {
    const check = campo.check === true || campo.check === 'true' || campo.check === 1;
    const salvar = campo.salvar || 'S'; // 'S' = não existe no banco, 'N' = já existe

    if (check && salvar === 'S') {
      // Não existe no banco → INSERT
      await conn.query(
        `INSERT INTO campos_cadastrocliente
         (id_cliente, id_campo, excluido)
         VALUES (?, ?, 'N')`,
        [idCliente, campo.id_campo || campo.id]
      ).catch(() => {});
    } else if (check && salvar === 'N') {
      // Existe mas estava inativo → UPDATE para reativar
      await conn.query(
        `UPDATE campos_cadastrocliente
         SET excluido = 'N'
         WHERE id_cliente = ? AND id_campo = ?`,
        [idCliente, campo.id_campo || campo.id]
      ).catch(() => {});
    } else if (!check && salvar === 'N') {
      // Existe e foi desmarcado → soft delete
      await conn.query(
        `UPDATE campos_cadastrocliente
         SET excluido = 'S'
         WHERE id_cliente = ? AND id_campo = ?`,
        [idCliente, campo.id_campo || campo.id]
      ).catch(() => {});
    }
  }
}

module.exports = { buscarCamposCadastro, buscarLembretesCliente, salvarLembretes };
