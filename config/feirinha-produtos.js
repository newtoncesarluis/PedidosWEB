'use strict';

const {
  agregarItensFeirinha,
  calcQtdParaAtingirMedia,
  getFaixaByCodigo,
  getPrecoMedioMaxFaixa,
} = require('./feirinha-calc');
const { getCampanha } = require('./feirinha-campanhas');
const { buildProdutoFornecedorSql, getItensPedidoFornecedorFlag } = require('./reposicao-produtos');

async function resolverFaixaFiltro(pool, opts = {}) {
  let faixaCodigo = String(opts.faixa_codigo || opts.faixaCodigo || 'R10').toUpperCase();
  let precoMedioMeta = parseFloat(opts.preco_medio_meta);
  let precoRevendaAlvo = parseFloat(opts.preco_revenda_alvo);

  const idCamp = parseInt(opts.id_campanha, 10);
  if (idCamp) {
    const camp = await getCampanha(pool, idCamp);
    if (camp) {
      faixaCodigo = camp.faixa_codigo;
      if (!Number.isFinite(precoMedioMeta)) precoMedioMeta = camp.preco_medio_meta;
      if (!Number.isFinite(precoRevendaAlvo)) precoRevendaAlvo = camp.preco_revenda_alvo;
    }
  }

  if (!Number.isFinite(precoMedioMeta) || precoMedioMeta <= 0) {
    precoMedioMeta = getPrecoMedioMaxFaixa(faixaCodigo);
  }
  const faixa = getFaixaByCodigo(faixaCodigo);
  return { faixaCodigo, faixa, precoMedioMeta, precoRevendaAlvo };
}

/**
 * Produtos com preço unitário (tabela/cadastro) dentro do teto da faixa Feirinha.
 */
async function listarProdutosFeirinha(pool, getProdTabela, opts = {}) {
  const idFornecedor = parseInt(opts.idFornecedor, 10) || null;
  const tabelaId = parseInt(opts.tabelaId, 10) || null;
  const q = String(opts.q || '').trim();
  const limit = Math.min(100, Math.max(1, parseInt(opts.limit, 10) || 40));
  const catalogo = opts.catalogo !== false;

  const { faixaCodigo, faixa, precoMedioMeta } = await resolverFaixaFiltro(pool, opts);
  if (precoMedioMeta == null) {
    return { data: [], faixa_codigo: faixaCodigo, faixa_label: faixa.label, mensagem: 'Faixa Premium — defina filtro manualmente.' };
  }

  const tb = await getProdTabela(pool);
  const itensForn = await getItensPedidoFornecedorFlag(pool);
  const fornProd = buildProdutoFornecedorSql(tb, idFornecedor, itensForn, 'p');

  const params = [];
  let join = '';
  let vlrExpr = 'p.vlr_venda';
  if (catalogo && tabelaId) {
    join = ` INNER JOIN tabela_preco_itens tpi ON CAST(tpi.cod_produto AS UNSIGNED) = p.ID
      AND tpi.id_tabela = ? AND (tpi.excluido = 'N' OR tpi.excluido IS NULL OR tpi.excluido = '')
      AND tpi.ativo = 'S' `;
    params.push(tabelaId);
    vlrExpr = 'COALESCE(tpi.valor_tabela, tpi.preco_venda, p.vlr_venda)';
  } else if (tabelaId) {
    join = ` LEFT JOIN tabela_preco_itens tpi ON CAST(tpi.cod_produto AS UNSIGNED) = p.ID
      AND tpi.id_tabela = ? AND (tpi.excluido = 'N' OR tpi.excluido IS NULL OR tpi.excluido = '')
      AND tpi.ativo = 'S' `;
    params.push(tabelaId);
    vlrExpr = 'COALESCE(tpi.valor_tabela, p.vlr_venda)';
  }

  params.push(precoMedioMeta);
  let buscaSql = '';
  if (q) {
    buscaSql = ' AND (p.descricao LIKE ? OR p.cod_fabricante LIKE ? OR p.cod_barras LIKE ?) ';
    const lk = `%${q}%`;
    params.push(lk, lk, lk);
  }

  params.push(...fornProd.params, limit);

  const [rows] = await pool.query(
    `SELECT p.ID AS cod_produto, p.descricao AS desc_produto, p.cod_fabricante,
            ${vlrExpr} AS preco_unitario, IFNULL(p.multiplo_venda, 1) AS multiplo_venda
     FROM ${tb} p
     ${join}
     WHERE (p.excluido = 'N' OR p.excluido IS NULL OR p.excluido = '')
       AND p.situacao = 'A'
       AND (${vlrExpr}) > 0
       AND (${vlrExpr}) <= ?
       ${buscaSql}
       ${fornProd.sql}
     ORDER BY (${vlrExpr}) ASC, p.descricao
     LIMIT ?`,
    params
  );

  return {
    data: rows.map((r) => ({
      cod_produto: parseInt(r.cod_produto, 10),
      desc_produto: r.desc_produto,
      cod_fabricante: r.cod_fabricante,
      preco_unitario: parseFloat(r.preco_unitario) || 0,
      multiplo_venda: parseFloat(r.multiplo_venda) || 1,
      faixa_codigo: faixaCodigo,
      faixa_label: faixa.label,
      preco_medio_meta: precoMedioMeta,
    })),
    faixa_codigo: faixaCodigo,
    faixa_label: faixa.label,
    preco_medio_meta: precoMedioMeta,
    total: rows.length,
  };
}

/**
 * Sugere produtos baratos para baixar o preço médio até a meta da campanha/faixa.
 */
async function sugerirProdutosFeirinha(pool, getProdTabela, opts = {}) {
  const itens = Array.isArray(opts.itens) ? opts.itens : [];
  const agg = agregarItensFeirinha(itens);
  const { faixaCodigo, faixa, precoMedioMeta, precoRevendaAlvo } = await resolverFaixaFiltro(pool, opts);

  if (!agg.qtdTotal) {
    return {
      temItens: false,
      faixa_codigo: faixaCodigo,
      faixa_label: faixa.label,
      preco_medio_meta: precoMedioMeta,
      sugestoes: [],
      mensagem: 'Inclua itens no pedido para calcular sugestões.',
    };
  }

  if (precoMedioMeta != null && agg.precoMedio <= precoMedioMeta + 0.0001) {
    return {
      temItens: true,
      dentroMeta: true,
      preco_medio: agg.precoMedio,
      preco_medio_meta: precoMedioMeta,
      faixa_codigo: faixaCodigo,
      faixa_label: faixa.label,
      preco_revenda_alvo: precoRevendaAlvo,
      sugestoes: [],
      mensagem: `Preço médio ${agg.precoMedio.toFixed(2)} já está na faixa ${faixa.label}.`,
    };
  }

  const lista = await listarProdutosFeirinha(pool, getProdTabela, {
    idFornecedor: opts.idFornecedor,
    tabelaId: opts.tabelaId,
    faixa_codigo: faixaCodigo,
    preco_medio_meta: precoMedioMeta,
    id_campanha: opts.id_campanha,
    catalogo: !!opts.tabelaId,
    limit: Math.min(15, parseInt(opts.limit, 10) || 8),
  });

  const meta = precoMedioMeta != null ? precoMedioMeta : getPrecoMedioMaxFaixa(faixaCodigo);
  const sugestoes = [];
  for (const p of lista.data) {
    const calc = calcQtdParaAtingirMedia(agg.valorTotal, agg.qtdTotal, p.preco_unitario, meta);
    if (!calc || calc.alreadyOk) continue;
    const mult = Math.max(parseFloat(p.multiplo_venda) || 1, 1);
    let qtd = calc.qtd;
    if (mult > 1) qtd = Math.ceil(qtd / mult) * mult;
    sugestoes.push({
      cod_produto: p.cod_produto,
      desc_produto: p.desc_produto,
      cod_fabricante: p.cod_fabricante,
      preco_unitario: p.preco_unitario,
      qtd_sugerida: qtd,
      multiplo_venda: mult,
      hint: `Inclua ${qtd} un. × ${p.preco_unitario.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} para aproximar a média de ${meta.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
    });
    if (sugestoes.length >= 5) break;
  }

  return {
    temItens: true,
    dentroMeta: false,
    preco_medio: agg.precoMedio,
    preco_medio_meta: meta,
    faixa_codigo: faixaCodigo,
    faixa_label: faixa.label,
    preco_revenda_alvo: precoRevendaAlvo,
    sugestoes,
    mensagem: sugestoes.length
      ? `Média atual ${agg.precoMedio.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} — meta ${meta.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${faixa.label}).`
      : `Média ${agg.precoMedio.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} acima da meta. Não há produtos baratos o suficiente no catálogo/tabela.`,
  };
}

module.exports = {
  listarProdutosFeirinha,
  sugerirProdutosFeirinha,
  resolverFaixaFiltro,
};
