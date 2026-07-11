/**
 * Unicidade: cod_fabricante + cod_fornecedorpadrao (por produto ativo).
 */
const { getProdTabela, listProdutoColunas } = require('./produto-colunas');

function normalizarCodFabricante(cod) {
  return String(cod ?? '').trim();
}

function parseIdFornecedor(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function mensagemDuplicataCodFabricante(duplicata, idFornecedor) {
  const cod = duplicata?.cod_fabricante || '';
  const desc = duplicata?.descricao || `ID ${duplicata?.id}`;
  return `Já existe o produto «${desc}» (ID ${duplicata?.id}) com o código de fabricante «${cod}» para este fornecedor (ID ${idFornecedor}).`;
}

/**
 * @param {import('mysql2/promise').Pool|import('mysql2/promise').PoolConnection} pool
 * @param {{ codFabricante?: string, idFornecedor?: number|string, excludeId?: number|string }} opts
 */
async function buscarDuplicataCodFabricanteFornecedor(pool, opts = {}) {
  const cod = normalizarCodFabricante(opts.codFabricante);
  const idForn = parseIdFornecedor(opts.idFornecedor);
  if (!cod || !idForn) return null;

  const cols = await listProdutoColunas(pool);
  const colsLower = new Set(cols.map((c) => String(c).toLowerCase()));
  if (!colsLower.has('cod_fabricante') || !colsLower.has('cod_fornecedorpadrao')) return null;

  const tb = await getProdTabela(pool);
  const pk = colsLower.has('id') ? 'id' : 'ID';
  const params = [cod, idForn];
  let sql = `
    SELECT \`${pk}\` AS id, descricao, cod_fabricante
    FROM \`${tb}\`
    WHERE UPPER(TRIM(IFNULL(cod_fabricante, ''))) = UPPER(?)
      AND cod_fornecedorpadrao = ?
      AND (excluido = 'N' OR excluido IS NULL OR excluido = '')`;

  const excludeId = parseInt(opts.excludeId, 10);
  if (excludeId > 0) {
    sql += ` AND \`${pk}\` <> ?`;
    params.push(excludeId);
  }
  sql += ' LIMIT 1';

  const [rows] = await pool.query(sql, params).catch(() => [[]]);
  return rows[0] || null;
}

async function validarCodFabricanteFornecedor(pool, opts = {}) {
  const idForn = parseIdFornecedor(opts.idFornecedor);
  const cod = normalizarCodFabricante(opts.codFabricante);
  if (!cod) return { ok: true };
  if (!idForn) {
    return {
      ok: false,
      error: 'Informe o Fornecedor Padrão ao cadastrar Cód. Fabricante/SKU.',
    };
  }
  const duplicata = await buscarDuplicataCodFabricanteFornecedor(pool, {
    codFabricante: cod,
    idFornecedor: idForn,
    excludeId: opts.excludeId,
  });
  if (!duplicata) return { ok: true };
  return {
    ok: false,
    error: mensagemDuplicataCodFabricante(duplicata, idForn),
    duplicata,
  };
}

module.exports = {
  normalizarCodFabricante,
  parseIdFornecedor,
  mensagemDuplicataCodFabricante,
  buscarDuplicataCodFabricanteFornecedor,
  validarCodFabricanteFornecedor,
};
