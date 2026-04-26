'use strict';

const { getPool } = require('../../../config/database');

// Cache de colunas de clicnpj_faturamento
let _colunas = false;

async function _getColunas(conn) {
  if (_colunas !== false) return _colunas;
  try {
    const [rows] = await conn.query('DESCRIBE clicnpj_faturamento');
    _colunas = new Set(rows.map(r => r.Field));
  } catch (e) {
    console.error('[faturamento] DESCRIBE clicnpj_faturamento:', e.message);
    _colunas = null;
  }
  return _colunas;
}

/**
 * Busca CNPJs de faturamento ativos do cliente.
 * Retorna aliases normalizados.
 */
async function buscarFaturamento(idCliente, pool) {
  const executor = pool || getPool();

  // Tenta schema Delphi
  try {
    const [rows] = await executor.query(
      `SELECT id, id_cliente, excluido, cnpj,
              razao         AS razao_social,
              fantasia,
              insc_estadual AS ie,
              endereco,
              numero,
              bairro,
              cidade,
              uf,
              telefone      AS fone,
              obs,
              data_cadastro
       FROM clicnpj_faturamento
       WHERE id_cliente = ? AND excluido = 'N'
       ORDER BY id`,
      [idCliente]
    );
    return rows;
  } catch {
    const [rows] = await executor.query(
      `SELECT * FROM clicnpj_faturamento
       WHERE id_cliente = ? AND excluido = 'N'
       ORDER BY id`,
      [idCliente]
    ).catch(() => [[]]);
    return rows;
  }
}

/**
 * Salva CNPJs de faturamento (INSERT / UPDATE / soft-delete).
 * Usa DESCRIBE para detectar schema e evitar erros em colunas NOT NULL.
 *
 * Delphi usa: razao, insc_estadual, telefone
 * Normalizado: razao_social, ie, fone
 */
async function salvarFaturamento(idCliente, cnpjs, conn) {
  if (!Array.isArray(cnpjs) || cnpjs.length === 0) return;

  // Validar duplicatas na lista enviada
  const cnpjsAtivos = cnpjs
    .filter(c => c.excluido !== 'S' && !c._delete)
    .map(c => (c.cnpj || '').replace(/\D/g, ''));
  const unicos = new Set(cnpjsAtivos);
  if (unicos.size !== cnpjsAtivos.length) {
    throw new Error('Existem CNPJs de faturamento duplicados na lista');
  }

  const cols = await _getColunas(conn);
  if (!cols) return; // tabela não encontrada

  // Detecta schema: Delphi usa 'razao', normalizado usa 'razao_social'
  const isDelphi = cols.has('razao') && !cols.has('razao_social');
  // Helper NOT NULL: vazio = '' para Delphi, null para normalizado
  const sv = v => v || (isDelphi ? '' : null);

  for (const item of cnpjs) {
    if (item.excluido === 'S' || item._delete) {
      if (item.id) {
        await conn.query(
          `UPDATE clicnpj_faturamento SET excluido = 'S' WHERE id = ? AND id_cliente = ?`,
          [item.id, idCliente]
        ).catch(e => console.error('[faturamento/inativar]', e.message));
      }
      continue;
    }

    // Monta dados dinâmicos
    const dados = {};
    if (cols.has('cnpj'))          dados.cnpj          = sv(item.cnpj);
    if (cols.has('razao'))         dados.razao         = sv(item.razao_social);
    else if (cols.has('razao_social')) dados.razao_social = sv(item.razao_social);
    if (cols.has('fantasia'))      dados.fantasia      = sv(item.fantasia);
    if (cols.has('insc_estadual')) dados.insc_estadual = sv(item.ie);
    else if (cols.has('ie'))       dados.ie            = sv(item.ie);
    if (cols.has('endereco'))      dados.endereco      = sv(item.endereco);
    if (cols.has('numero'))        dados.numero        = sv(item.numero);
    if (cols.has('bairro'))        dados.bairro        = sv(item.bairro);
    if (cols.has('cidade'))        dados.cidade        = sv(item.cidade);
    if (cols.has('uf'))            dados.uf            = sv(item.uf);
    if (cols.has('telefone'))      dados.telefone      = sv(item.fone);
    else if (cols.has('fone'))     dados.fone          = sv(item.fone);
    if (cols.has('obs'))           dados.obs           = sv(item.obs);
    if (cols.has('cep'))           dados.cep           = sv(item.cep);
    if (cols.has('email'))         dados.email         = sv(item.email);

    if (item.id) {
      // UPDATE
      const entries = Object.entries(dados);
      if (entries.length === 0) continue;
      const setStr = entries.map(([k]) => `\`${k}\` = ?`).join(', ');
      const vals   = [...entries.map(([,v]) => v), item.id, idCliente];
      await conn.query(
        `UPDATE clicnpj_faturamento SET ${setStr} WHERE id = ? AND id_cliente = ?`, vals
      ).catch(e => console.error('[faturamento/update]', e.message));
    } else {
      // INSERT
      dados.id_cliente = idCliente;
      if (cols.has('excluido'))      dados.excluido      = 'N';
      if (cols.has('data_cadastro')) dados.data_cadastro = new Date();

      const entries = Object.entries(dados);
      const colStr  = entries.map(([k]) => `\`${k}\``).join(', ');
      const phStr   = entries.map(() => '?').join(', ');
      const vals    = entries.map(([,v]) => v);
      await conn.query(
        `INSERT INTO clicnpj_faturamento (${colStr}) VALUES (${phStr})`, vals
      ).catch(e => console.error('[faturamento/insert]', e.message));
    }
  }
}

/**
 * Soft delete de um CNPJ de faturamento
 */
async function excluirFaturamento(id, conn) {
  const executor = conn || getPool();
  await executor.query(
    `UPDATE clicnpj_faturamento SET excluido = 'S' WHERE id = ?`,
    [id]
  ).catch(() => {});
}

module.exports = { buscarFaturamento, salvarFaturamento, excluirFaturamento };
