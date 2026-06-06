'use strict';

const { tabelaCampanhaExiste, listarCampanhas } = require('./promocoes-campanha');
const { ensureItenspedPromoColumns } = require('./schema-migrations');
const { tabelaPromocoesExiste } = require('./promocoes-produto');

async function itenspedTemIdPromocao(pool) {
  try {
    await ensureItenspedPromoColumns(pool);
    const [rows] = await pool.query("SHOW COLUMNS FROM itensped LIKE 'id_promocao'");
    return rows.length > 0;
  } catch {
    return false;
  }
}

/** Preço de referência do item (tabela/cadastro gravado no pedido) */
function sqlRefPrecoItem() {
  return 'COALESCE(NULLIF(i.vlr_padrao, 0), prod.vlr_venda, 0)';
}

/** Espelha calcularPrecoPromocao() em SQL */
function sqlPrecoPromo(ppAlias, refExpr) {
  return `CASE
    WHEN ${ppAlias}.tipo = 'DESCONTO_PERC' THEN ROUND(${refExpr} * (1 - ${ppAlias}.valor / 100), 4)
    ELSE ${ppAlias}.valor
  END`;
}

/**
 * Monta CTE dash_itens com origem real:
 * - campanha: id_promocao gravado no item
 * - vinculado: preço bate com promo ativa na data do pedido (produto_promocoes)
 * - estimado: valor_unitario abaixo do cadastro/tabela (≥0,5%), sem vínculo acima
 */
function buildDashItensCte(tb, idCampanhaFiltro) {
  const ref = sqlRefPrecoItem();
  const precoPromoPp2 = sqlPrecoPromo('pp2', ref);

  const matchSub = `(SELECT pp2.id
    FROM produto_promocoes pp2
    WHERE pp2.cod_produto = i.cod_produto
      AND pp2.excluido = 'N' AND pp2.ativo = 'S'
      AND (pp2.data_inicio IS NULL OR pp2.data_inicio <= p.data_abertura)
      AND (pp2.data_fim IS NULL OR pp2.data_fim >= p.data_abertura)
      AND i.quantidade >= COALESCE(pp2.qtd_minima, 1)
      AND i.valor_unitario > 0
      AND ABS(i.valor_unitario - (${precoPromoPp2})) <= GREATEST(0.02, i.valor_unitario * 0.005)
    ORDER BY (pp2.id_campanha IS NOT NULL) DESC, pp2.qtd_minima DESC, pp2.id DESC
    LIMIT 1)`;

  const campanhaFilter = idCampanhaFiltro
    ? ` AND pp_f.id_campanha = ${parseInt(idCampanhaFiltro, 10)} `
    : '';

  return `
WITH dash_base AS (
  SELECT
    i.id AS item_id,
    i.cod_produto,
    i.quantidade,
    i.valor_unitario,
    i.id_promocao,
    i.promocao_descricao,
    p.id AS pedido_id,
    p.id_usuario,
    p.nome_vendedor,
    prod.descricao AS nome_produto,
    ${ref} AS ref_preco,
    ${matchSub} AS promo_match_id
  FROM itensped i
  INNER JOIN pedidos p ON p.id = i.id_pedido
  INNER JOIN ${tb} prod ON prod.ID = i.cod_produto
  WHERE (i.excluido = 'N' OR i.excluido IS NULL)
    AND (p.excluido = 'N' OR p.excluido IS NULL)
    AND p.data_abertura >= ? AND p.data_abertura <= ?
    AND i.valor_unitario > 0
),
dash_itens AS (
  SELECT
    b.*,
    COALESCE(b.id_promocao, b.promo_match_id) AS promo_efetivo_id,
    CASE
      WHEN b.id_promocao IS NOT NULL THEN 'campanha'
      WHEN b.promo_match_id IS NOT NULL THEN 'vinculado'
      WHEN b.ref_preco > 0 AND b.valor_unitario < b.ref_preco * 0.995 THEN 'estimado'
      ELSE NULL
    END AS origem,
    ROUND(GREATEST(0, b.ref_preco - b.valor_unitario) * b.quantidade, 2) AS economia_linha,
    ROUND(b.quantidade * b.valor_unitario, 2) AS total_linha
  FROM dash_base b
),
dash_filtrado AS (
  SELECT di.*
  FROM dash_itens di
  LEFT JOIN produto_promocoes pp_f ON pp_f.id = di.promo_efetivo_id AND pp_f.excluido = 'N'
  WHERE di.origem IS NOT NULL
    ${idCampanhaFiltro ? `AND di.origem IN ('campanha', 'vinculado') ${campanhaFilter}` : ''}
)`;
}

async function relatorioDashboard(pool, getTabela, opts = {}) {
  const dtIni = opts.dt_inicio || null;
  const dtFim = opts.dt_fim || null;
  const idCampanhaFiltro = opts.id_campanha ? parseInt(opts.id_campanha, 10) : null;

  if (!dtIni || !dtFim) {
    return { status: 400, json: { error: 'Informe dt_inicio e dt_fim (YYYY-MM-DD)' } };
  }

  const temAuditoria = await itenspedTemIdPromocao(pool);
  const tb = await getTabela(pool);
  const temPromo = await tabelaPromocoesExiste(pool);

  if (!temAuditoria || !temPromo) {
    return {
      status: 200,
      json: {
        aviso: !temPromo
          ? 'Tabela produto_promocoes não encontrada nesta base.'
          : 'Coluna id_promocao não disponível em itensped.',
        resumo: {},
        campanhas_vendas: [],
        top_produtos: [],
        por_vendedor: [],
        campanhas_ativas: [],
      },
    };
  }

  const cte = buildDashItensCte(tb, idCampanhaFiltro);
  const params = [dtIni, dtFim];

  const [[resumoRow]] = await pool.query(
    `${cte}
     SELECT
       COUNT(DISTINCT pedido_id) AS pedidos,
       COUNT(*) AS itens,
       SUM(CASE WHEN origem = 'campanha' THEN 1 ELSE 0 END) AS itens_campanha,
       SUM(CASE WHEN origem = 'vinculado' THEN 1 ELSE 0 END) AS itens_vinculados,
       SUM(CASE WHEN origem = 'estimado' THEN 1 ELSE 0 END) AS itens_estimados,
       SUM(quantidade) AS qtd_total,
       ROUND(SUM(total_linha), 2) AS total_vendido,
       ROUND(SUM(economia_linha), 2) AS economia
     FROM dash_filtrado`,
    params
  );

  const [[ticketRow]] = await pool.query(
    `${cte}
     SELECT ROUND(AVG(tot_ped), 2) AS ticket_medio_pedido
     FROM (
       SELECT pedido_id, SUM(total_linha) AS tot_ped
       FROM dash_filtrado
       GROUP BY pedido_id
     ) x`,
    params
  );

  const [porCampanha] = await pool.query(
    `${cte}
     SELECT
       pp.id_campanha,
       di.promo_efetivo_id AS id_promocao,
       COALESCE(MAX(di.promocao_descricao), MAX(pp.descricao), 'Sem nome') AS descricao,
       MAX(di.origem) AS origem,
       COUNT(*) AS itens,
       SUM(di.quantidade) AS qtd_total,
       ROUND(SUM(di.total_linha), 2) AS total_vendido,
       ROUND(SUM(di.economia_linha), 2) AS economia,
       COUNT(DISTINCT di.pedido_id) AS pedidos
     FROM dash_filtrado di
     INNER JOIN produto_promocoes pp ON pp.id = di.promo_efetivo_id AND pp.excluido = 'N'
     WHERE di.origem IN ('campanha', 'vinculado')
     GROUP BY pp.id_campanha, di.promo_efetivo_id
     ORDER BY total_vendido DESC
     LIMIT 50`,
    params
  );

  const [topProdutos] = await pool.query(
    `${cte}
     SELECT
       cod_produto,
       MAX(nome_produto) AS nome_produto,
       SUM(quantidade) AS qtd_total,
       COUNT(*) AS linhas,
       ROUND(SUM(total_linha), 2) AS total_vendido,
       ROUND(SUM(economia_linha), 2) AS economia,
       SUM(CASE WHEN origem = 'campanha' THEN 1 ELSE 0 END) AS linhas_campanha,
       SUM(CASE WHEN origem = 'vinculado' THEN 1 ELSE 0 END) AS linhas_vinculado,
       SUM(CASE WHEN origem = 'estimado' THEN 1 ELSE 0 END) AS linhas_estimado
     FROM dash_filtrado
     GROUP BY cod_produto
     ORDER BY total_vendido DESC
     LIMIT 20`,
    params
  );

  const [porVendedor] = await pool.query(
    `${cte}
     SELECT
       id_usuario,
       COALESCE(MAX(nome_vendedor), CONCAT('Usuário #', id_usuario)) AS nome_vendedor,
       COUNT(DISTINCT pedido_id) AS pedidos,
       COUNT(*) AS itens,
       SUM(CASE WHEN origem = 'campanha' THEN 1 ELSE 0 END) AS itens_campanha,
       SUM(CASE WHEN origem = 'vinculado' THEN 1 ELSE 0 END) AS itens_vinculados,
       SUM(CASE WHEN origem = 'estimado' THEN 1 ELSE 0 END) AS itens_estimados,
       ROUND(SUM(total_linha), 2) AS total_vendido,
       ROUND(SUM(economia_linha), 2) AS economia
     FROM dash_filtrado
     GROUP BY id_usuario
     ORDER BY total_vendido DESC
     LIMIT 30`,
    params
  );

  let campanhasAtivas = [];
  if (await tabelaCampanhaExiste(pool)) {
    const { data } = await listarCampanhas(pool, { ativo: 'S', limit: 100, offset: 0 });
    campanhasAtivas = (data || []).map((c) => ({
      id: c.id,
      descricao: c.descricao,
      qtd_produtos: c.qtd_produtos,
      data_inicio: c.data_inicio,
      data_fim: c.data_fim,
      tipo: c.tipo,
      valor: c.valor,
    }));
  }

  const pedidos = Number(resumoRow?.pedidos) || 0;
  const itens = Number(resumoRow?.itens) || 0;
  const totalVendido = Number(resumoRow?.total_vendido) || 0;
  const economia = Number(resumoRow?.economia) || 0;

  return {
    status: 200,
    json: {
      periodo: { dt_inicio: dtIni, dt_fim: dtFim },
      resumo: {
        pedidos,
        itens,
        itens_campanha: Number(resumoRow?.itens_campanha) || 0,
        itens_vinculados: Number(resumoRow?.itens_vinculados) || 0,
        itens_estimados: Number(resumoRow?.itens_estimados) || 0,
        qtd_total: Number(resumoRow?.qtd_total) || 0,
        total_vendido: totalVendido,
        economia,
        ticket_medio_pedido: Number(ticketRow?.ticket_medio_pedido) || 0,
        ticket_medio_item: itens > 0 ? Math.round((totalVendido / itens) * 100) / 100 : 0,
        roi_percent: totalVendido > 0
          ? Math.round((economia / (totalVendido + economia)) * 10000) / 100
          : 0,
      },
      campanhas_vendas: porCampanha.map((r) => ({
        id_campanha: r.id_campanha != null ? parseInt(r.id_campanha, 10) : null,
        id_promocao: r.id_promocao != null ? parseInt(r.id_promocao, 10) : null,
        descricao: r.descricao,
        origem: r.origem,
        itens: Number(r.itens) || 0,
        qtd_total: Number(r.qtd_total) || 0,
        total_vendido: Number(r.total_vendido) || 0,
        economia: Number(r.economia) || 0,
        pedidos: Number(r.pedidos) || 0,
        ticket_medio: Number(r.pedidos) > 0
          ? Math.round((Number(r.total_vendido) / Number(r.pedidos)) * 100) / 100
          : 0,
      })),
      top_produtos: topProdutos.map((r) => ({
        cod_produto: r.cod_produto,
        nome_produto: r.nome_produto,
        qtd_total: Number(r.qtd_total) || 0,
        linhas: Number(r.linhas) || 0,
        linhas_campanha: Number(r.linhas_campanha) || 0,
        linhas_vinculado: Number(r.linhas_vinculado) || 0,
        linhas_estimado: Number(r.linhas_estimado) || 0,
        total_vendido: Number(r.total_vendido) || 0,
        economia: Number(r.economia) || 0,
      })),
      por_vendedor: porVendedor.map((r) => ({
        id_usuario: r.id_usuario != null ? parseInt(r.id_usuario, 10) : null,
        nome_vendedor: r.nome_vendedor,
        pedidos: Number(r.pedidos) || 0,
        itens: Number(r.itens) || 0,
        itens_campanha: Number(r.itens_campanha) || 0,
        itens_vinculados: Number(r.itens_vinculados) || 0,
        itens_estimados: Number(r.itens_estimados) || 0,
        total_vendido: Number(r.total_vendido) || 0,
        economia: Number(r.economia) || 0,
      })),
      campanhas_ativas: campanhasAtivas,
    },
  };
}

module.exports = {
  itenspedTemIdPromocao,
  relatorioDashboard,
};
