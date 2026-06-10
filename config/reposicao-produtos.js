/**
 * Sugestão de reposição por histórico de compras do cliente (aba Reposição no pedido).
 */

const { andProdutoBuscaSql } = require('./produto-busca-texto');

function calcSemaforoReposicao(diasDesdeUltima) {
  const d = parseInt(diasDesdeUltima, 10) || 0;
  if (d >= 60) return { codigo: 'vermelho', emoji: '🔴', label: 'Atrasado' };
  if (d >= 30) return { codigo: 'amarelo', emoji: '🟡', label: 'Atenção' };
  return { codigo: 'verde', emoji: '🟢', label: 'Em dia' };
}

function calcMediaMensal(qtd12m, mesesComCompra) {
  const qtd = parseFloat(qtd12m) || 0;
  const meses = Math.max(parseInt(mesesComCompra, 10) || 0, 1);
  return Math.round((qtd / meses) * 100) / 100;
}

function calcQtdSugerida(qtd12m, mesesComCompra, diasDesdeUltima) {
  const media = calcMediaMensal(qtd12m, mesesComCompra);
  if (media <= 0) return 1;
  const mesesAtraso = Math.max((parseInt(diasDesdeUltima, 10) || 0) / 30, 0.5);
  return Math.max(1, Math.ceil(media * mesesAtraso));
}

async function getItensPedidoFornecedorFlag(pool) {
  const [sysRows] = await pool.query('SELECT itenspedidofornecedor FROM sistemas ORDER BY id DESC LIMIT 1').catch(() => [[]]);
  return sysRows[0]?.itenspedidofornecedor || 'N';
}

function buildProdutoFornecedorSql(tb, fId, itensForn, alias = 'pr') {
  if (!fId) return { sql: '', params: [] };
  if (itensForn === 'S') {
    return {
      sql: ` AND CAST(${alias}.cod_fornecedorpadrao AS UNSIGNED) = ? `,
      params: [fId],
    };
  }
  return {
    sql: ` AND (
      CAST(${alias}.cod_fornecedorpadrao AS UNSIGNED) = ?
      OR EXISTS (
        SELECT 1 FROM produtofornecedor pf
        WHERE CAST(pf.cod_produto AS UNSIGNED) = ${alias}.ID
          AND CAST(pf.cod_fornecedor AS UNSIGNED) = ?
          AND (pf.excluido = 'N' OR pf.excluido IS NULL OR pf.excluido = '')
          AND pf.status = 'A'
      )
    ) `,
    params: [fId, fId],
  };
}

/**
 * Lista produtos para reposição com base no histórico do cliente (filtrado por fábrica).
 */
async function listarReposicaoProdutos(pool, getProdTabela, opts = {}) {
  const codCliente = parseInt(opts.codCliente, 10);
  const idFornecedor = parseInt(opts.idFornecedor, 10) || null;
  const q = String(opts.q || '').trim();
  if (!codCliente) {
    return { data: [], sem_historico: false, mensagem: 'Informe o cliente do pedido.' };
  }

  const tb = await getProdTabela(pool);
  const itensForn = await getItensPedidoFornecedorFlag(pool);
  const fornProd = buildProdutoFornecedorSql(tb, idFornecedor, itensForn, 'pr');

  const params = [codCliente];
  let pedFornSql = '';
  if (idFornecedor) {
    pedFornSql = ' AND CAST(p.cod_fornecedor AS UNSIGNED) = ? ';
    params.push(idFornecedor);
  }

  let buscaSql = '';
  if (q) {
    const busca = andProdutoBuscaSql('pr', q, { includeId: true });
    buscaSql = busca.sql;
    params.push(...busca.params);
  }

  const [rows] = await pool.query(
    `SELECT ip.cod_produto AS cod_produto,
            MAX(ip.desc_prod) AS desc_produto,
            MAX(pr.cod_fabricante) AS cod_fabricante,
            MAX(pr.unidade) AS unidade,
            SUM(CASE WHEN p.data_abertura >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH) THEN ip.quantidade ELSE 0 END) AS qtd_12m,
            COUNT(DISTINCT CASE
              WHEN p.data_abertura >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
              THEN DATE_FORMAT(p.data_abertura, '%Y-%m')
            END) AS meses_com_compra,
            MAX(p.data_abertura) AS ultima_compra,
            DATEDIFF(CURDATE(), MAX(p.data_abertura)) AS dias_desde_ultima,
            SUM(ip.quantidade) AS qtd_historico,
            COUNT(DISTINCT p.numero) AS total_pedidos
     FROM itensped ip
     JOIN pedidos p ON p.numero = ip.numpedido
     JOIN ${tb} pr ON CAST(pr.ID AS UNSIGNED) = CAST(ip.cod_produto AS UNSIGNED)
     WHERE p.cod_cliente = ?
       AND p.excluido = 'N'
       AND p.tipo_pedido = 'PEDIDO'
       AND p.situacao_pedido NOT IN ('CANCELADO','RECUSADO')
       AND COALESCE(ip.excluido, 'N') = 'N'
       AND (pr.excluido = 'N' OR pr.excluido IS NULL OR pr.excluido = '')
       AND pr.situacao = 'A'
       ${pedFornSql}
       ${fornProd.sql}
       ${buscaSql}
     GROUP BY ip.cod_produto
     HAVING MAX(p.data_abertura) >= DATE_SUB(CURDATE(), INTERVAL 18 MONTH)
     ORDER BY dias_desde_ultima DESC, qtd_12m DESC
     LIMIT 120`,
    [...params, ...fornProd.params]
  );

  if (!rows.length) {
    return {
      data: [],
      sem_historico: true,
      mensagem: 'Quando o cliente tiver um histórico de compras, você poderá lembrá-lo por aqui dos produtos que ele mais gosta de comprar.',
    };
  }

  const data = rows.map((r) => {
    const mediaMensal = calcMediaMensal(r.qtd_12m, r.meses_com_compra);
    const qtdSugerida = calcQtdSugerida(r.qtd_12m, r.meses_com_compra, r.dias_desde_ultima);
    const semaforo = calcSemaforoReposicao(r.dias_desde_ultima);
    return {
      ...r,
      media_mensal: mediaMensal,
      qtd_sugerida: qtdSugerida,
      semaforo: semaforo.codigo,
      semaforo_emoji: semaforo.emoji,
      semaforo_label: semaforo.label,
      ultima_compra_fmt: r.ultima_compra
        ? String(r.ultima_compra).slice(0, 10)
        : null,
      hint_reposicao: `Comprou ${Math.round(parseFloat(r.qtd_historico) || 0)} un. há ${r.dias_desde_ultima} dias`,
    };
  });

  return { data, sem_historico: false, total: data.length };
}

module.exports = {
  calcSemaforoReposicao,
  calcMediaMensal,
  calcQtdSugerida,
  getItensPedidoFornecedorFlag,
  buildProdutoFornecedorSql,
  listarReposicaoProdutos,
};
