/**
 * Produtos complementares — clientes similares (região) compram e este cliente ainda não.
 */

const { buildProdutoFornecedorSql, getItensPedidoFornecedorFlag } = require('./reposicao-produtos');
const { produtoBuscaOrSql } = require('./produto-busca-texto');

async function listarOportunidadesProdutos(pool, getProdTabela, opts = {}) {
  const codCliente = parseInt(opts.codCliente, 10);
  const idFornecedor = parseInt(opts.idFornecedor, 10) || null;
  const q = String(opts.q || '').trim();
  if (!codCliente) {
    return { data: [], sem_dados: false, mensagem: 'Informe o cliente do pedido.' };
  }

  const tb = await getProdTabela(pool);
  const itensForn = await getItensPedidoFornecedorFlag(pool);
  const fornProd = buildProdutoFornecedorSql(tb, idFornecedor, itensForn, 'pr');

  const [[cli]] = await pool.query(
    `SELECT regiao, nome FROM clientes
     WHERE id = ? AND (excluido = 'N' OR excluido IS NULL)
     LIMIT 1`,
    [codCliente]
  );
  if (!cli) {
    return { data: [], sem_dados: true, mensagem: 'Cliente não encontrado.' };
  }

  const params = [codCliente, codCliente];
  let regiaoSql = '';
  if (cli.regiao) {
    regiaoSql = ' AND c2.regiao = ? ';
    params.push(parseInt(cli.regiao, 10));
  }

  let pedFornSql = '';
  if (idFornecedor) {
    pedFornSql = ' AND CAST(p.cod_fornecedor AS UNSIGNED) = ? ';
    params.push(idFornecedor);
  }

  let buscaSql = '';
  if (q) {
    const busca = produtoBuscaOrSql('pr', q, { includeId: true });
    buscaSql = ` AND (${busca.fragment.slice(1, -1)} OR ip.desc_prod LIKE ?) `;
    params.push(...busca.params, `%${q}%`);
  }

  const [rows] = await pool.query(
    `SELECT ip.cod_produto AS cod_produto,
            MAX(ip.desc_prod) AS desc_produto,
            MAX(pr.cod_fabricante) AS cod_fabricante,
            MAX(pr.unidade) AS unidade,
            COUNT(DISTINCT p.cod_cliente) AS clientes_que_compram,
            SUM(ip.quantidade) AS qtd_total_regiao,
            SUM(ip.vlrtotal_itens) AS valor_total_regiao
     FROM itensped ip
     JOIN pedidos p ON p.numero = ip.numpedido
     JOIN clientes c2 ON c2.id = p.cod_cliente
     JOIN ${tb} pr ON CAST(pr.ID AS UNSIGNED) = CAST(ip.cod_produto AS UNSIGNED)
     WHERE p.excluido = 'N'
       AND p.tipo_pedido = 'PEDIDO'
       AND p.situacao_pedido NOT IN ('CANCELADO','RECUSADO')
       AND COALESCE(ip.excluido, 'N') = 'N'
       AND (c2.excluido = 'N' OR c2.excluido IS NULL)
       AND p.cod_cliente != ?
       ${regiaoSql}
       AND p.data_abertura >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
       AND (pr.excluido = 'N' OR pr.excluido IS NULL OR pr.excluido = '')
       AND pr.situacao = 'A'
       ${pedFornSql}
       ${fornProd.sql}
       ${buscaSql}
       AND ip.cod_produto NOT IN (
         SELECT DISTINCT ip2.cod_produto
         FROM itensped ip2
         JOIN pedidos p2 ON p2.numero = ip2.numpedido
         WHERE p2.cod_cliente = ?
           AND p2.excluido = 'N'
           AND COALESCE(ip2.excluido, 'N') = 'N'
       )
     GROUP BY ip.cod_produto
     ORDER BY clientes_que_compram DESC, qtd_total_regiao DESC
     LIMIT 80`,
    [...params, ...fornProd.params]
  );

  if (!rows.length) {
    const msgRegiao = cli.regiao
      ? 'Quando clientes similares da região comprarem produtos que este cliente ainda não experimentou, as oportunidades aparecerão aqui.'
      : 'Cadastre a região do cliente ou aguarde histórico de compras na carteira para sugerir oportunidades.';
    return { data: [], sem_dados: true, mensagem: msgRegiao };
  }

  const data = rows.map((r) => {
    const n = parseInt(r.clientes_que_compram, 10) || 0;
    return {
      ...r,
      qtd_sugerida: 1,
      hint_oportunidade: n === 1
        ? '1 cliente similar compra este produto'
        : `${n} clientes similares compram este produto`,
    };
  });

  return { data, sem_dados: false, total: data.length };
}

module.exports = { listarOportunidadesProdutos };
