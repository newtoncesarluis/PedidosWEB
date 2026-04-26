'use strict';

const { getPool } = require('../../../config/database');

// Cache de colunas existentes em contato_clientes
// false = ainda não carregado | Set = carregado com sucesso
let _colunas = false;

async function _getColunas(conn) {
  if (_colunas !== false) return _colunas;
  try {
    const [rows] = await conn.query('DESCRIBE contato_clientes');
    _colunas = new Set(rows.map(r => r.Field));
  } catch (e) {
    console.error('[contatos] DESCRIBE falhou:', e.message);
    _colunas = null; // marca como falhou
  }
  return _colunas;
}

/**
 * Busca contatos ativos do cliente.
 * Usa SELECT * e normaliza nomes de colunas em JS, evitando falhar
 * quando colunas opcionais (ramal, setor, email) não existem no BD.
 */
async function buscarContatos(idCliente, pool) {
  const executor = pool || getPool();
  let rows = [];
  try {
    [rows] = await executor.query(
      `SELECT * FROM contato_clientes
       WHERE id_cliente = ? AND tipo = 'C' AND excluido = 'N'
       ORDER BY id`,
      [idCliente]
    );
  } catch {
    // tipo ou excluido podem não existir no schema Delphi original
    [rows] = await executor.query(
      `SELECT * FROM contato_clientes WHERE id_cliente = ? ORDER BY id`,
      [idCliente]
    ).catch(() => [[]]);
  }
  // Normalizar para o frontend: comprador → nome, telefone → fone
  return rows.map(r => ({
    ...r,
    nome:       r.nome       || r.comprador || null,
    fone:       r.fone       || r.telefone  || null,
    cargo:      r.cargo      || null,
    observacao: r.observacao || null,
  }));
}

/**
 * Salva contatos (INSERT / UPDATE / soft-delete).
 * Usa DESCRIBE para construir SQL dinâmico compatível com qualquer schema.
 *
 * Mapeamento frontend → BD:
 *   contato.nome  → comprador (Delphi) ou nome (normalizado)
 *   contato.fone  → telefone  (Delphi) ou fone (normalizado)
 */
async function salvarContatos(idCliente, contatos, conn) {
  if (!Array.isArray(contatos) || contatos.length === 0) return;

  const cols = await _getColunas(conn);
  if (!cols) return; // tabela não existe ou DESCRIBE falhou

  for (const contato of contatos) {
    // Soft delete
    if (contato.excluido === 'S' || contato._delete) {
      if (contato.id) {
        await conn.query(
          `UPDATE contato_clientes SET excluido = 'S' WHERE id = ? AND id_cliente = ?`,
          [contato.id, idCliente]
        ).catch(() => {});
      }
      continue;
    }

    // Montar dados respeitando schema real do BD
    const dados = { id_cliente: idCliente };
    if (cols.has('tipo'))    dados.tipo    = 'C';
    if (cols.has('excluido')) dados.excluido = 'N';

    // Delphi usa '' em vez de NULL para campos NOT NULL
    const isDelphi = cols.has('comprador');
    const sv = v => v || (isDelphi ? '' : null);

    // nome: Delphi = comprador | normalizado = nome
    if (cols.has('comprador'))     dados.comprador = sv(contato.nome);
    else if (cols.has('nome'))     dados.nome      = sv(contato.nome);

    // fone: Delphi = telefone | normalizado = fone
    if (cols.has('telefone'))      dados.telefone = sv(contato.fone);
    else if (cols.has('fone'))     dados.fone     = sv(contato.fone);

    if (cols.has('ramal'))      dados.ramal      = sv(contato.ramal);
    if (cols.has('setor'))      dados.setor      = sv(contato.setor);
    if (cols.has('email'))      dados.email      = sv(contato.email);
    if (cols.has('cargo'))      dados.cargo      = sv(contato.cargo);
    if (cols.has('observacao')) dados.observacao = sv(contato.observacao);

    if (contato.id) {
      // UPDATE — não reatribuir id_cliente, tipo, excluido
      const entries = Object.entries(dados).filter(([k]) => !['id_cliente','tipo','excluido'].includes(k));
      if (entries.length) {
        const set  = entries.map(([k]) => `\`${k}\` = ?`).join(', ');
        const vals = [...entries.map(([,v]) => v), contato.id, idCliente];
        await conn.query(
          `UPDATE contato_clientes SET ${set} WHERE id = ? AND id_cliente = ?`, vals
        ).catch(e => console.error('[contatos/update]', e.message));
      }
    } else {
      const entries = Object.entries(dados);
      const colStr  = entries.map(([k]) => `\`${k}\``).join(', ');
      const phStr   = entries.map(() => '?').join(', ');
      const vals    = entries.map(([,v]) => v);
      await conn.query(
        `INSERT INTO contato_clientes (${colStr}) VALUES (${phStr})`, vals
      ).catch(e => console.error('[contatos/insert]', e.message));
    }
  }
}

/**
 * Soft delete de um contato específico
 */
async function excluirContato(id, conn) {
  const executor = conn || getPool();
  await executor.query(
    `UPDATE contato_clientes SET excluido = 'S' WHERE id = ?`, [id]
  ).catch(() => {});
}

module.exports = { buscarContatos, salvarContatos, excluirContato };
