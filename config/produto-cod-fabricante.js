/**
 * Unicidade: cod_fabricante + cod_fornecedorpadrao (por produto ativo).
 */
const { getProdTabela, listProdutoColunas } = require('./produto-colunas');

/**
 * Normaliza código (trim). Códigos só numéricos perdem zeros à esquerda
 * ("0002" → "2") — Excel manda número sem padding; planilha texto pode ter zeros.
 */
function normalizarCodFabricante(cod) {
  let s = String(cod ?? '').trim();
  if (!s) return '';
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    s = Number.isFinite(n) ? String(n) : s;
  }
  return s;
}

/** Chave de comparação (normalizado + upper). */
function chaveCodFabricante(cod) {
  return normalizarCodFabricante(cod).toUpperCase();
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
  const chave = chaveCodFabricante(cod);

  // Match exato (case-insensitive) OU mesmo valor numérico (0002 = 2)
  const params = [idForn, chave];
  let sql = `
    SELECT \`${pk}\` AS id, descricao, cod_fabricante
    FROM \`${tb}\`
    WHERE cod_fornecedorpadrao = ?
      AND (excluido = 'N' OR excluido IS NULL OR excluido = '')
      AND (
        UPPER(TRIM(IFNULL(cod_fabricante, ''))) = ?
        OR (
          TRIM(IFNULL(cod_fabricante, '')) REGEXP '^[0-9]+$'
          AND ? REGEXP '^[0-9]+$'
          AND CAST(TRIM(cod_fabricante) AS UNSIGNED) = CAST(? AS UNSIGNED)
        )
      )`;
  params.push(chave, chave);

  const excludeId = parseInt(opts.excludeId, 10);
  if (excludeId > 0) {
    sql += ` AND \`${pk}\` <> ?`;
    params.push(excludeId);
  }
  sql += ` ORDER BY \`${pk}\` ASC LIMIT 1`;

  let rows;
  try {
    [rows] = await pool.query(sql, params);
  } catch (e) {
    console.error('[produto-cod-fabricante] buscarDuplicata:', e.message);
    return null;
  }
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
  chaveCodFabricante,
  parseIdFornecedor,
  mensagemDuplicataCodFabricante,
  buscarDuplicataCodFabricanteFornecedor,
  validarCodFabricanteFornecedor,
};
