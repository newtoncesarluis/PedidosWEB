'use strict';

const { getPool } = require('../../../config/database');

// Cache de colunas de socios_clientes
let _colunas = false;

async function _getColunas(conn) {
  if (_colunas !== false) return _colunas;
  try {
    const [rows] = await conn.query('DESCRIBE socios_clientes');
    _colunas = new Set(rows.map(r => r.Field));
  } catch (e) {
    console.error('[socios] DESCRIBE socios_clientes:', e.message);
    _colunas = null;
  }
  return _colunas;
}

/**
 * Busca sócios ativos do cliente.
 * Retorna aliases normalizados independente do schema (Delphi ou normalizado).
 */
async function buscarSocios(idCliente, pool) {
  const executor = pool || getPool();

  // Tenta schema Delphi
  try {
    const [rows] = await executor.query(
      `SELECT id, id_cliente, excluido,
              nome,
              cpf,
              telefone      AS fone,
              qualificacao  AS cargo,
              nascimento    AS dtnascimento,
              percentual    AS participacao
       FROM socios_clientes
       WHERE id_cliente = ? AND excluido = 'N'
       ORDER BY nome`,
      [idCliente]
    );
    return rows;
  } catch {
    const [rows] = await executor.query(
      `SELECT * FROM socios_clientes
       WHERE id_cliente = ? AND excluido = 'N'
       ORDER BY nome`,
      [idCliente]
    ).catch(() => [[]]);
    return rows;
  }
}

/**
 * Salva sócios do cliente (INSERT / UPDATE / soft-delete).
 * Usa DESCRIBE para detectar schema e evitar erros em colunas NOT NULL.
 *
 * Delphi usa: telefone, qualificacao, nascimento, percentual
 * Normalizado: fone, cargo, dtnascimento, participacao
 */
async function salvarSocios(idCliente, socios, conn) {
  if (!Array.isArray(socios) || socios.length === 0) return;

  const cols = await _getColunas(conn);
  if (!cols) return; // tabela não encontrada

  // Detecta schema: Delphi usa 'qualificacao', normalizado usa 'cargo'
  const isDelphi = cols.has('qualificacao');
  // Helper: para colunas NOT NULL do Delphi, usar '' em vez de null
  const sv = v => v || (isDelphi ? '' : null);

  for (const socio of socios) {
    if (socio.excluido === 'S' || socio._delete) {
      if (socio.id) {
        await conn.query(
          `UPDATE socios_clientes SET excluido = 'S' WHERE id = ? AND id_cliente = ?`,
          [socio.id, idCliente]
        ).catch(e => console.error('[socios/inativar]', e.message));
      }
      continue;
    }

    // Monta dados dinâmicos baseado em colunas existentes
    const dados = {};

    if (cols.has('telefone'))     dados.telefone     = sv(socio.fone);
    else if (cols.has('fone'))    dados.fone         = sv(socio.fone);
    if (cols.has('qualificacao')) dados.qualificacao = sv(socio.cargo);
    else if (cols.has('cargo'))   dados.cargo        = sv(socio.cargo);
    if (cols.has('nascimento'))   dados.nascimento   = socio.dtnascimento || null;
    else if (cols.has('dtnascimento')) dados.dtnascimento = socio.dtnascimento || null;
    if (cols.has('percentual'))   dados.percentual   = socio.participacao != null ? socio.participacao : 0;
    else if (cols.has('participacao')) dados.participacao = socio.participacao ?? null;
    if (cols.has('nome'))  dados.nome  = sv(socio.nome);
    if (cols.has('cpf'))   dados.cpf   = sv(socio.cpf);
    if (cols.has('rg'))    dados.rg    = sv(socio.rg || '');
    if (cols.has('email')) dados.email = sv(socio.email || '');

    if (socio.id) {
      // UPDATE
      const entries = Object.entries(dados);
      if (entries.length === 0) continue;
      const setStr = entries.map(([k]) => `\`${k}\` = ?`).join(', ');
      const vals   = [...entries.map(([,v]) => v), socio.id, idCliente];
      await conn.query(
        `UPDATE socios_clientes SET ${setStr} WHERE id = ? AND id_cliente = ?`, vals
      ).catch(e => console.error('[socios/update]', e.message));
      continue;
    }

    // Verifica se já existe pelo CPF
    if (socio.cpf) {
      const [ex] = await conn.query(
        `SELECT id FROM socios_clientes WHERE cpf = ? AND id_cliente = ? LIMIT 1`,
        [socio.cpf, idCliente]
      ).catch(() => [[]]);
      if (ex && ex.length > 0) {
        const entries = Object.entries(dados);
        if (entries.length === 0) continue;
        const setStr = entries.map(([k]) => `\`${k}\` = ?`).join(', ');
        const vals   = [...entries.map(([,v]) => v), ex[0].id, idCliente];
        await conn.query(
          `UPDATE socios_clientes SET ${setStr} WHERE id = ? AND id_cliente = ?`, vals
        ).catch(e => console.error('[socios/update-cpf]', e.message));
        continue;
      }
    }

    // INSERT
    dados.id_cliente = idCliente;
    if (cols.has('excluido')) dados.excluido = 'N';

    const entries = Object.entries(dados);
    const colStr  = entries.map(([k]) => `\`${k}\``).join(', ');
    const phStr   = entries.map(() => '?').join(', ');
    const vals    = entries.map(([,v]) => v);
    await conn.query(
      `INSERT INTO socios_clientes (${colStr}) VALUES (${phStr})`, vals
    ).catch(e => console.error('[socios/insert]', e.message));
  }
}

/**
 * Soft delete de um sócio
 */
async function excluirSocio(id, conn) {
  const executor = conn || getPool();
  await executor.query(
    `UPDATE socios_clientes SET excluido = 'S' WHERE id = ?`,
    [id]
  ).catch(() => {});
}

module.exports = { buscarSocios, salvarSocios, excluirSocio };
