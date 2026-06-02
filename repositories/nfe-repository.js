const { getPool } = require('../config/database');

/**
 * Verifica se a nota já foi importada.
 * Retorna o registro existente ou null.
 */
async function verificarNotaJaImportada(numDoc, serieNf) {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT id FROM pedidos
     WHERE excluido = 'N'
       AND num_doc  = ?
       AND serie_nf = ?
     LIMIT 1`,
    [numDoc, serieNf]
  );
  return rows[0] ?? null;
}

/**
 * Busca produto pelo cod_fabricante, respeitando os filtros de
 * fornecedor padrão e compartilhamento de empresa.
 *
 * @param {string}  codFabricante
 * @param {number}  idFornecedor       - id do fornecedor selecionado
 * @param {string}  produtoFornecedor  - 'S' = filtrar por fornecedor
 * @param {string}  compartilhaProduto - 'N' = restringir à empresa
 * @param {number}  idEmpresa
 */
async function buscarProduto({ codFabricante, idFornecedor, produtoFornecedor, compartilhaProduto, idEmpresa }) {
  const pool = getPool();

  const params = [codFabricante];
  let filtros  = '';

  if (produtoFornecedor === 'S') {
    filtros += ' AND p.cod_fornecedorpadrao = ?';
    params.push(idFornecedor);
  }

  if (compartilhaProduto === 'N') {
    filtros += ' AND p.id_empresa = ?';
    params.push(idEmpresa);
  }

  const [rows] = await pool.query(
    `SELECT p.*,
            fp.nome AS nome_familia
       FROM produto p
       LEFT JOIN familia_produtos fp ON fp.id = p.id_familiaproduto
      WHERE p.excluido    = 'N'
        AND p.cod_fabricante = ?
        ${filtros}
      LIMIT 1`,
    params
  );

  return rows[0] ?? null;
}

/**
 * Busca a flag gcompartilhaproduto da tabela sistemas.
 */
async function buscarFlagCompartilhaProduto() {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT gcompartilhaproduto FROM sistemas ORDER BY id DESC LIMIT 1`
  ).catch(() => [[]]);
  return rows[0]?.gcompartilhaproduto ?? 'S';
}

module.exports = { verificarNotaJaImportada, buscarProduto, buscarFlagCompartilhaProduto };
