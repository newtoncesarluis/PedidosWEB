'use strict';

const { getPool } = require('../../../config/database');

// Cache de colunas
const _cache = {};

async function _getColunas(conn, tabela) {
  if (tabela in _cache) return _cache[tabela];
  try {
    const [rows] = await conn.query(`DESCRIBE \`${tabela}\``);
    _cache[tabela] = new Set(rows.map(r => r.Field));
  } catch {
    _cache[tabela] = null;
  }
  return _cache[tabela];
}

async function _resolverTabela(conn) {
  let cols = await _getColunas(conn, 'dependentes_clientes');
  if (cols) return { tabela: 'dependentes_clientes', cols };
  cols = await _getColunas(conn, 'dependentes');
  if (cols) return { tabela: 'dependentes', cols };
  return { tabela: null, cols: null };
}

/**
 * Busca dependentes ativos do cliente.
 * Tenta cada combinação de tabela/JOIN até encontrar uma que funcione.
 */
async function buscarDependentes(idCliente, pool) {
  const executor = pool || getPool();

  for (const tabela of ['dependentes_clientes', 'dependentes']) {
    // 1) com JOIN + excluido
    try {
      const [rows] = await executor.query(
        `SELECT d.*, c.descricao AS nome_cor, r.descricao AS nome_raca
         FROM \`${tabela}\` d
         LEFT JOIN cores c ON c.id = d.id_cor AND c.excluido = 'N'
         LEFT JOIN raca  r ON r.id = d.id_raca AND r.excluido = 'N'
         WHERE d.id_cliente = ? AND d.excluido = 'N' ORDER BY d.nome`,
        [idCliente]
      );
      return rows;
    } catch { /* tenta variação */ }

    // 2) com JOIN, sem filtro excluido
    try {
      const [rows] = await executor.query(
        `SELECT d.*, c.descricao AS nome_cor, r.descricao AS nome_raca
         FROM \`${tabela}\` d
         LEFT JOIN cores c ON c.id = d.id_cor
         LEFT JOIN raca  r ON r.id = d.id_raca
         WHERE d.id_cliente = ? ORDER BY d.nome`,
        [idCliente]
      );
      return rows;
    } catch { /* tenta sem JOIN */ }

    // 3) sem JOIN (cores/raca podem não existir)
    try {
      const [rows] = await executor.query(
        `SELECT * FROM \`${tabela}\` WHERE id_cliente = ? ORDER BY nome`,
        [idCliente]
      );
      return rows.map(r => ({ ...r, nome_cor: null, nome_raca: null }));
    } catch { /* tenta próxima tabela */ }
  }
  return [];
}

/**
 * Salva dependentes do cliente (INSERT / UPDATE / soft-delete).
 * Usa DESCRIBE para construir SQL dinâmico compatível com qualquer schema.
 */
async function salvarDependentes(idCliente, dependentes, conn) {
  if (!Array.isArray(dependentes) || dependentes.length === 0) return;

  const { tabela, cols } = await _resolverTabela(conn);
  if (!tabela) return; // nenhuma tabela existe

  const temExcluido = cols.has('excluido');
  const temStatus   = cols.has('status');

  for (const dep of dependentes) {
    if (dep.excluido === 'S' || dep._delete) {
      if (dep.id) {
        if (temExcluido) {
          await conn.query(
            `UPDATE \`${tabela}\` SET excluido = 'S' WHERE id = ? AND id_cliente = ?`,
            [dep.id, idCliente]
          ).catch(() => {});
        } else {
          await conn.query(
            `DELETE FROM \`${tabela}\` WHERE id = ? AND id_cliente = ?`,
            [dep.id, idCliente]
          ).catch(() => {});
        }
      }
      continue;
    }

    // Montar dados respeitando schema real
    const dados = { id_cliente: idCliente };
    if (temExcluido)         dados.excluido   = 'N';
    if (temStatus)           dados.status     = 'A';

    if (cols.has('nome'))        dados.nome       = dep.nome       || null;
    if (cols.has('sexo'))        dados.sexo       = dep.sexo       || null;
    if (cols.has('id_cor'))      dados.id_cor     = dep.id_cor     || null;
    if (cols.has('id_raca'))     dados.id_raca    = dep.id_raca    || null;
    if (cols.has('idade'))       dados.idade      = dep.idade      || null;
    if (cols.has('observacao'))  dados.observacao = dep.observacao || null;

    if (dep.id) {
      const entries = Object.entries(dados).filter(([k]) => !['id_cliente','excluido','status'].includes(k));
      if (entries.length) {
        const set  = entries.map(([k]) => `\`${k}\` = ?`).join(', ');
        const vals = [...entries.map(([,v]) => v), dep.id, idCliente];
        await conn.query(
          `UPDATE \`${tabela}\` SET ${set} WHERE id = ? AND id_cliente = ?`, vals
        ).catch(e => console.error('[dependentes/update]', e.message));
      }
    } else {
      const entries = Object.entries(dados);
      const colStr  = entries.map(([k]) => `\`${k}\``).join(', ');
      const phStr   = entries.map(() => '?').join(', ');
      const vals    = entries.map(([,v]) => v);
      await conn.query(
        `INSERT INTO \`${tabela}\` (${colStr}) VALUES (${phStr})`, vals
      ).catch(e => console.error('[dependentes/insert]', e.message));
    }
  }
}

module.exports = { buscarDependentes, salvarDependentes };
