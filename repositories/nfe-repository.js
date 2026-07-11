const { getPool } = require('../config/database');

/** PK do produto (legado usa ID maiúsculo). */
function produtoIdOf(produto) {
  if (!produto) return null;
  const raw = produto.id ?? produto.ID;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

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

/**
 * Preço ativo na tabela (valor_tabela ou preco_venda). Null se não houver item na tabela.
 */
async function buscarPrecoTabela(idTabela, codProduto) {
  const tabId = parseInt(idTabela, 10);
  const prodId = parseInt(codProduto, 10);
  if (!tabId || !prodId) return null;

  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT COALESCE(valor_tabela, preco_venda) AS preco
       FROM tabela_preco_itens
      WHERE id_tabela = ?
        AND CAST(cod_produto AS UNSIGNED) = ?
        AND (excluido = 'N' OR excluido IS NULL OR excluido = '')
        AND (ativo = 'S' OR ativo IS NULL OR ativo = '')
      LIMIT 1`,
    [tabId, prodId]
  ).catch(() => [[]]);

  const v = parseFloat(rows[0]?.preco);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Define preço do item na importação (XML/Excel) conforme tabela escolhida ou arquivo.
 */
async function resolverPrecoImportacao({ idTabela, produto, precoArquivo }) {
  const vCatalogo = parseFloat(produto?.vlr_venda) || 0;
  const vArquivo = parseFloat(precoArquivo);
  const precoArquivoOk = Number.isFinite(vArquivo) ? vArquivo : 0;
  const prodId = produtoIdOf(produto);

  if (!idTabela || !prodId) {
    const vu = precoArquivoOk > 0 ? precoArquivoOk : vCatalogo;
    return {
      valor_unitario: vu,
      vlr_padrao: vCatalogo > 0 ? vCatalogo : vu,
      preco_da_tabela: null,
      usou_tabela: false,
    };
  }

  const precoTab = await buscarPrecoTabela(idTabela, prodId);
  if (precoTab != null) {
    return {
      valor_unitario: precoTab,
      vlr_padrao: precoTab,
      preco_da_tabela: precoTab,
      usou_tabela: true,
    };
  }

  const vu = vCatalogo > 0 ? vCatalogo : precoArquivoOk;
  return {
    valor_unitario: vu,
    vlr_padrao: vCatalogo > 0 ? vCatalogo : vu,
    preco_da_tabela: null,
    usou_tabela: false,
  };
}

module.exports = {
  verificarNotaJaImportada,
  buscarProduto,
  buscarFlagCompartilhaProduto,
  buscarPrecoTabela,
  resolverPrecoImportacao,
  produtoIdOf,
};
