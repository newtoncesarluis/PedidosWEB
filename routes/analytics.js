const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');
const {
  canPickOtherVendors,
  canAccessAllVendors,
  buildPedidosVendedorWhereSync,
} = require('../config/vendedor-visibilidade');
const { REPORT_GTELA, isAdminUser, permSn } = require('../config/cadastros-permissoes');

function buildPedidosWhereFromQuery(query, user, reqOpt) {
  const { dt_inicio, dt_fim, situacao, tipo_pedido, id_vendedor } = query || {};
  const where = [`COALESCE(p.excluido, 'N') = 'N'`];
  const params = [];

  if (dt_inicio) {
    where.push('p.data_abertura >= ?');
    params.push(dt_inicio);
  }

  if (dt_fim) {
    where.push('p.data_abertura <= ?');
    params.push(dt_fim);
  }

  if (situacao && situacao !== 'TODOS') {
    where.push('p.situacao_pedido = ?');
    params.push(situacao);
  }

  if (tipo_pedido && tipo_pedido !== 'TODOS') {
    where.push('p.tipo_pedido = ?');
    params.push(tipo_pedido);
  }

  const req = reqOpt || { user };
  const vendScope = buildPedidosVendedorWhereSync(req, id_vendedor, 'p.id_usuario');
  if (vendScope.clause) {
    where.push(vendScope.clause.replace(/^ AND /, ''));
    params.push(...vendScope.params);
  }

  return {
    clause: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params,
    isAdmin: vendScope.canPickOthers,
    canPickOthers: vendScope.canPickOthers,
  };
}

function buildPedidosWhere(req) {
  return buildPedidosWhereFromQuery(req.query, req.user, req);
}

function formatDateLocal(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function diffDays(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const ms = end.getTime() - start.getTime();
  return Math.max(1, Math.round(ms / 86400000) + 1);
}

function deriveComparisonRanges(query) {
  const today = new Date();
  let currentStart;
  let currentEnd;

  if (query?.dt_inicio && query?.dt_fim) {
    currentStart = new Date(`${query.dt_inicio}T00:00:00`);
    currentEnd = new Date(`${query.dt_fim}T00:00:00`);
  } else {
    currentStart = new Date(today.getFullYear(), today.getMonth(), 1);
    currentEnd = today;
  }

  const spanDays = diffDays(currentStart, currentEnd);
  const previousEnd = addDays(currentStart, -1);
  const previousStart = addDays(previousEnd, -(spanDays - 1));

  return {
    current: {
      dt_inicio: formatDateLocal(currentStart),
      dt_fim: formatDateLocal(currentEnd),
    },
    previous: {
      dt_inicio: formatDateLocal(previousStart),
      dt_fim: formatDateLocal(previousEnd),
    },
    span_days: spanDays,
  };
}

function buildClientesScope(req) {
  const { id_vendedor, cidade, uf, segmento } = req.query;
  const where = [`COALESCE(c.excluido, 'N') = 'N'`];
  const params = [];
  const canPickOthers = canPickOtherVendors(req);

  if (cidade) {
    where.push('LOWER(COALESCE(c.cidade, \'\')) LIKE ?');
    params.push(`%${cidade.toLowerCase()}%`);
  }

  if (uf) {
    where.push('UPPER(COALESCE(c.uf, \'\')) = ?');
    params.push(uf.toUpperCase());
  }

  if (segmento) {
    where.push('c.segmento = ?');
    params.push(segmento);
  }

  const vendScope = buildPedidosVendedorWhereSync(req, id_vendedor, 'c.cod_vendedor');
  if (vendScope.clause) {
    where.push(vendScope.clause.replace(/^ AND /, ''));
    params.push(...vendScope.params);
  }

  return {
    clause: `WHERE ${where.join(' AND ')}`,
    params,
    isAdmin: canPickOthers,
    canPickOthers,
  };
}

function buildVisitasWhere(req) {
  const { dt_inicio, dt_fim, status, id_vendedor, id_motivo } = req.query;
  const where = [`COALESCE(v.excluido, 'N') = 'N'`];
  const params = [];
  const canPickOthers = canPickOtherVendors(req);

  if (dt_inicio) {
    where.push('v.data_visita >= ?');
    params.push(dt_inicio);
  }

  if (dt_fim) {
    where.push('v.data_visita <= ?');
    params.push(dt_fim);
  }

  if (status && status !== 'TODOS') {
    where.push('v.status = ?');
    params.push(status);
  }

  if (id_motivo) {
    where.push('v.id_motivo = ?');
    params.push(parseInt(id_motivo, 10));
  }

  const vendScope = buildPedidosVendedorWhereSync(req, id_vendedor, 'v.id_vendedor');
  if (vendScope.clause) {
    where.push(vendScope.clause.replace(/^ AND /, ''));
    params.push(...vendScope.params);
  }

  return {
    clause: `WHERE ${where.join(' AND ')}`,
    params,
    isAdmin: canPickOthers,
    canPickOthers,
  };
}

router.get('/comercial/overview', async (req, res) => {
  const pool = getPool();

  try {
    const ranges = deriveComparisonRanges(req.query);
    const currentQuery = { ...req.query, ...ranges.current };
    const previousQuery = { ...req.query, ...ranges.previous };
    const { clause, params, isAdmin } = buildPedidosWhereFromQuery(currentQuery, req.user);
    const previousBase = buildPedidosWhereFromQuery(previousQuery, req.user);

    const [kpiRows] = await pool.query(
      `
      SELECT
        COUNT(*) AS total_pedidos,
        COALESCE(SUM(p.vlrtotalpedido), 0) AS valor_total,
        COALESCE(AVG(NULLIF(p.vlrtotalpedido, 0)), 0) AS ticket_medio,
        COUNT(DISTINCT p.cod_cliente) AS total_clientes,
        COUNT(DISTINCT p.cod_fornecedor) AS total_fornecedores,
        COUNT(CASE WHEN p.situacao_pedido = 'PENDENTE' THEN 1 END) AS pendentes,
        COUNT(CASE WHEN p.situacao_pedido = 'APROVADO' THEN 1 END) AS aprovados,
        COUNT(CASE WHEN p.situacao_pedido = 'CANCELADO' THEN 1 END) AS cancelados
      FROM pedidos p
      ${clause}
      `,
      params
    );

    const [kpiPrevRows] = await pool.query(
      `
      SELECT
        COUNT(*) AS total_pedidos,
        COALESCE(SUM(p.vlrtotalpedido), 0) AS valor_total,
        COALESCE(AVG(NULLIF(p.vlrtotalpedido, 0)), 0) AS ticket_medio,
        COUNT(DISTINCT p.cod_cliente) AS total_clientes,
        COUNT(DISTINCT p.cod_fornecedor) AS total_fornecedores,
        COUNT(CASE WHEN p.situacao_pedido = 'PENDENTE' THEN 1 END) AS pendentes,
        COUNT(CASE WHEN p.situacao_pedido = 'APROVADO' THEN 1 END) AS aprovados,
        COUNT(CASE WHEN p.situacao_pedido = 'CANCELADO' THEN 1 END) AS cancelados
      FROM pedidos p
      ${previousBase.clause}
      `,
      previousBase.params
    );

    const [statusRows] = await pool.query(
      `
      SELECT
        COALESCE(NULLIF(TRIM(p.situacao_pedido), ''), 'SEM_STATUS') AS situacao,
        COUNT(*) AS total,
        COALESCE(SUM(p.vlrtotalpedido), 0) AS valor_total
      FROM pedidos p
      ${clause}
      GROUP BY COALESCE(NULLIF(TRIM(p.situacao_pedido), ''), 'SEM_STATUS')
      ORDER BY total DESC, valor_total DESC
      `,
      params
    );

    const [tipoRows] = await pool.query(
      `
      SELECT
        COALESCE(NULLIF(TRIM(p.tipo_pedido), ''), 'SEM_TIPO') AS tipo_pedido,
        COUNT(*) AS total,
        COALESCE(SUM(p.vlrtotalpedido), 0) AS valor_total
      FROM pedidos p
      ${clause}
      GROUP BY COALESCE(NULLIF(TRIM(p.tipo_pedido), ''), 'SEM_TIPO')
      ORDER BY valor_total DESC, total DESC
      `,
      params
    );

    const [serieRows] = await pool.query(
      `
      SELECT
        DATE_FORMAT(p.data_abertura, '%Y-%m') AS periodo,
        COUNT(*) AS total,
        COALESCE(SUM(p.vlrtotalpedido), 0) AS valor_total,
        COUNT(CASE WHEN p.situacao_pedido = 'APROVADO' THEN 1 END) AS aprovados
      FROM pedidos p
      ${clause}
      GROUP BY DATE_FORMAT(p.data_abertura, '%Y-%m')
      ORDER BY periodo DESC
      LIMIT 6
      `,
      params
    );

    const [clientesRows] = await pool.query(
      `
      SELECT
        p.cod_cliente AS id_cliente,
        COALESCE(NULLIF(TRIM(p.nome_cliente), ''), c.nome, CONCAT('Cliente #', p.cod_cliente)) AS nome_cliente,
        COUNT(*) AS total_pedidos,
        COALESCE(SUM(p.vlrtotalpedido), 0) AS valor_total
      FROM pedidos p
      LEFT JOIN clientes c ON c.id = p.cod_cliente
      ${clause}
      GROUP BY p.cod_cliente, COALESCE(NULLIF(TRIM(p.nome_cliente), ''), c.nome, CONCAT('Cliente #', p.cod_cliente))
      ORDER BY valor_total DESC, total_pedidos DESC
      LIMIT 8
      `,
      params
    );

    const [produtosRows] = await pool.query(
      `
      SELECT
        i.cod_produto,
        COALESCE(NULLIF(TRIM(i.desc_prod), ''), CONCAT('Produto #', i.cod_produto)) AS desc_prod,
        COALESCE(SUM(i.quantidade), 0) AS quantidade_total,
        COALESCE(SUM(i.vlrtotal_itens), 0) AS valor_total
      FROM itensped i
      INNER JOIN pedidos p ON p.numero = i.numpedido
      ${clause}
      AND COALESCE(i.excluido, 'N') = 'N'
      GROUP BY i.cod_produto, COALESCE(NULLIF(TRIM(i.desc_prod), ''), CONCAT('Produto #', i.cod_produto))
      ORDER BY valor_total DESC, quantidade_total DESC
      LIMIT 8
      `,
      params
    );

    let vendedoresRows = [];
    if (isAdmin) {
      const [rows] = await pool.query(
        `
        SELECT
          p.id_usuario AS id_vendedor,
          COALESCE(NULLIF(TRIM(p.nome_vendedor), ''), u.nomeusu, CONCAT('Vendedor #', p.id_usuario)) AS nome_vendedor,
          COUNT(*) AS total_pedidos,
          COALESCE(SUM(p.vlrtotalpedido), 0) AS valor_total
        FROM pedidos p
        LEFT JOIN usuarios u ON u.idusuario = p.id_usuario
        ${clause}
        GROUP BY p.id_usuario, COALESCE(NULLIF(TRIM(p.nome_vendedor), ''), u.nomeusu, CONCAT('Vendedor #', p.id_usuario))
        ORDER BY valor_total DESC, total_pedidos DESC
        LIMIT 8
        `,
        params
      );
      vendedoresRows = rows;
    }

    const kpis = kpiRows[0] || {};
    const kpisPrev = kpiPrevRows[0] || {};
    const totalPedidos = Number(kpis.total_pedidos || 0);
    const aprovados = Number(kpis.aprovados || 0);
    const pendentes = Number(kpis.pendentes || 0);
    const cancelados = Number(kpis.cancelados || 0);
    const taxaAprovacao = totalPedidos ? (aprovados / totalPedidos) * 100 : 0;
    const taxaCancelamento = totalPedidos ? (cancelados / totalPedidos) * 100 : 0;

    const totalPedidosPrev = Number(kpisPrev.total_pedidos || 0);
    const aprovadosPrev = Number(kpisPrev.aprovados || 0);
    const canceladosPrev = Number(kpisPrev.cancelados || 0);
    const taxaAprovacaoPrev = totalPedidosPrev ? (aprovadosPrev / totalPedidosPrev) * 100 : 0;
    const taxaCancelamentoPrev = totalPedidosPrev ? (canceladosPrev / totalPedidosPrev) * 100 : 0;

    const calcPct = (current, previous) => {
      const c = Number(current || 0);
      const p = Number(previous || 0);
      if (!p && !c) return 0;
      if (!p) return 100;
      return ((c - p) / p) * 100;
    };

    const comparativos = {
      atual: ranges.current,
      anterior: ranges.previous,
      faturamento: {
        atual: Number(kpis.valor_total || 0),
        anterior: Number(kpisPrev.valor_total || 0),
        variacao_pct: Number(calcPct(kpis.valor_total, kpisPrev.valor_total).toFixed(2)),
      },
      pedidos: {
        atual: totalPedidos,
        anterior: totalPedidosPrev,
        variacao_pct: Number(calcPct(totalPedidos, totalPedidosPrev).toFixed(2)),
      },
      ticket_medio: {
        atual: Number(kpis.ticket_medio || 0),
        anterior: Number(kpisPrev.ticket_medio || 0),
        variacao_pct: Number(calcPct(kpis.ticket_medio, kpisPrev.ticket_medio).toFixed(2)),
      },
      taxa_aprovacao: {
        atual: Number(taxaAprovacao.toFixed(2)),
        anterior: Number(taxaAprovacaoPrev.toFixed(2)),
        variacao_pct: Number((taxaAprovacao - taxaAprovacaoPrev).toFixed(2)),
      },
      taxa_cancelamento: {
        atual: Number(taxaCancelamento.toFixed(2)),
        anterior: Number(taxaCancelamentoPrev.toFixed(2)),
        variacao_pct: Number((taxaCancelamento - taxaCancelamentoPrev).toFixed(2)),
      },
    };

    const insights = [];
    if (pendentes > aprovados && pendentes > 0) {
      insights.push({
        tipo: 'alerta',
        titulo: 'Volume pendente alto',
        mensagem: 'A carteira tem mais pedidos pendentes do que aprovados no filtro atual. Vale revisar gargalos de aprovação.',
      });
    }
    if (taxaCancelamento >= 15) {
      insights.push({
        tipo: 'risco',
        titulo: 'Cancelamento acima do ideal',
        mensagem: `A taxa de cancelamento está em ${taxaCancelamento.toFixed(1)}%. Isso merece acompanhamento por vendedor, cliente ou fornecedor.`,
      });
    }
    if (clientesRows.length > 0) {
      const topCliente = clientesRows[0];
      insights.push({
        tipo: 'oportunidade',
        titulo: 'Cliente com maior concentração',
        mensagem: `${topCliente.nome_cliente} lidera o faturamento no período, com ${Number(topCliente.valor_total || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`,
      });
    }
    if (!insights.length) {
      insights.push({
        tipo: 'ok',
        titulo: 'Carteira estável',
        mensagem: 'Os indicadores principais não mostram desvio relevante no filtro atual.',
      });
    }

    res.json({
      filtros: {
        isAdmin,
        dt_inicio: currentQuery.dt_inicio || null,
        dt_fim: currentQuery.dt_fim || null,
        situacao: currentQuery.situacao || 'TODOS',
        tipo_pedido: currentQuery.tipo_pedido || 'TODOS',
        id_vendedor: currentQuery.id_vendedor || null,
      },
      kpis: {
        total_pedidos: totalPedidos,
        valor_total: Number(kpis.valor_total || 0),
        ticket_medio: Number(kpis.ticket_medio || 0),
        total_clientes: Number(kpis.total_clientes || 0),
        total_fornecedores: Number(kpis.total_fornecedores || 0),
        pendentes,
        aprovados,
        cancelados,
        taxa_aprovacao: Number(taxaAprovacao.toFixed(2)),
        taxa_cancelamento: Number(taxaCancelamento.toFixed(2)),
      },
      comparativos,
      status: statusRows,
      tipos: tipoRows,
      serie_mensal: serieRows.reverse(),
      rankings: {
        clientes: clientesRows,
        produtos: produtosRows,
        vendedores: vendedoresRows,
      },
      insights,
    });
  } catch (err) {
    console.error('[analytics/comercial/overview]', err);
    res.status(500).json({ error: 'Erro ao carregar analytics comercial' });
  }
});

router.get('/comercial/clientes', async (req, res) => {
  const pool = getPool();

  try {
    const ranges = deriveComparisonRanges(req.query);
    const currentQuery = { ...req.query, ...ranges.current };
    const previousQuery = { ...req.query, ...ranges.previous };

    const { dt_inicio, dt_fim } = currentQuery;
    const { clause, params, isAdmin } = buildClientesScope(req);

    const periodoPedidos = [];
    let periodoSql = '';
    if (dt_inicio) {
      periodoSql += ' AND p.data_abertura >= ?';
      periodoPedidos.push(dt_inicio);
    }
    if (dt_fim) {
      periodoSql += ' AND p.data_abertura <= ?';
      periodoPedidos.push(dt_fim);
    }

    const [kpiRows] = await pool.query(
      `
      SELECT
        COUNT(*) AS total_clientes,
        COUNT(CASE WHEN c.status = 'A' THEN 1 END) AS ativos,
        COUNT(CASE WHEN c.dtcadastro >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) THEN 1 END) AS novos_30d,
        COUNT(CASE WHEN uc.ultima_compra IS NOT NULL THEN 1 END) AS clientes_com_compra,
        COUNT(CASE WHEN uc.ultima_compra IS NULL OR uc.ultima_compra < DATE_SUB(CURDATE(), INTERVAL 90 DAY) THEN 1 END) AS sem_compra_90d,
        COALESCE(SUM(vp.valor_periodo), 0) AS valor_periodo,
        COUNT(CASE WHEN vp.total_pedidos_periodo > 0 THEN 1 END) AS clientes_com_pedido_periodo
      FROM clientes c
      LEFT JOIN (
        SELECT p.cod_cliente, MAX(p.data_abertura) AS ultima_compra
        FROM pedidos p
        WHERE COALESCE(p.excluido, 'N') = 'N'
        GROUP BY p.cod_cliente
      ) uc ON uc.cod_cliente = c.id
      LEFT JOIN (
        SELECT p.cod_cliente,
               COUNT(*) AS total_pedidos_periodo,
               COALESCE(SUM(p.vlrtotalpedido), 0) AS valor_periodo
        FROM pedidos p
        WHERE COALESCE(p.excluido, 'N') = 'N' ${periodoSql}
        GROUP BY p.cod_cliente
      ) vp ON vp.cod_cliente = c.id
      ${clause}
      `,
      [...periodoPedidos, ...params]
    );

    const periodoPedidosPrev = [];
    let periodoSqlPrev = '';
    if (previousQuery.dt_inicio) {
      periodoSqlPrev += ' AND p.data_abertura >= ?';
      periodoPedidosPrev.push(previousQuery.dt_inicio);
    }
    if (previousQuery.dt_fim) {
      periodoSqlPrev += ' AND p.data_abertura <= ?';
      periodoPedidosPrev.push(previousQuery.dt_fim);
    }

    const [kpiPrevRows] = await pool.query(
      `
      SELECT
        COUNT(*) AS total_clientes,
        COUNT(CASE WHEN c.status = 'A' THEN 1 END) AS ativos,
        COUNT(CASE WHEN c.dtcadastro >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) THEN 1 END) AS novos_30d,
        COUNT(CASE WHEN uc.ultima_compra IS NOT NULL THEN 1 END) AS clientes_com_compra,
        COUNT(CASE WHEN uc.ultima_compra IS NULL OR uc.ultima_compra < DATE_SUB(CURDATE(), INTERVAL 90 DAY) THEN 1 END) AS sem_compra_90d,
        COALESCE(SUM(vp.valor_periodo), 0) AS valor_periodo,
        COUNT(CASE WHEN vp.total_pedidos_periodo > 0 THEN 1 END) AS clientes_com_pedido_periodo
      FROM clientes c
      LEFT JOIN (
        SELECT p.cod_cliente, MAX(p.data_abertura) AS ultima_compra
        FROM pedidos p
        WHERE COALESCE(p.excluido, 'N') = 'N'
        GROUP BY p.cod_cliente
      ) uc ON uc.cod_cliente = c.id
      LEFT JOIN (
        SELECT p.cod_cliente,
               COUNT(*) AS total_pedidos_periodo,
               COALESCE(SUM(p.vlrtotalpedido), 0) AS valor_periodo
        FROM pedidos p
        WHERE COALESCE(p.excluido, 'N') = 'N' ${periodoSqlPrev}
        GROUP BY p.cod_cliente
      ) vp ON vp.cod_cliente = c.id
      ${clause}
      `,
      [...periodoPedidosPrev, ...params]
    );

    const [topClientes] = await pool.query(
      `
      SELECT
        c.id AS id_cliente,
        c.nome,
        c.cidade,
        c.uf,
        COALESCE(uc.ultima_compra, c.dtultimacompra) AS ultima_compra,
        COALESCE(vp.total_pedidos_periodo, 0) AS total_pedidos_periodo,
        COALESCE(vp.valor_periodo, 0) AS valor_periodo
      FROM clientes c
      LEFT JOIN (
        SELECT p.cod_cliente, MAX(p.data_abertura) AS ultima_compra
        FROM pedidos p
        WHERE COALESCE(p.excluido, 'N') = 'N'
        GROUP BY p.cod_cliente
      ) uc ON uc.cod_cliente = c.id
      LEFT JOIN (
        SELECT p.cod_cliente,
               COUNT(*) AS total_pedidos_periodo,
               COALESCE(SUM(p.vlrtotalpedido), 0) AS valor_periodo
        FROM pedidos p
        WHERE COALESCE(p.excluido, 'N') = 'N' ${periodoSql}
        GROUP BY p.cod_cliente
      ) vp ON vp.cod_cliente = c.id
      ${clause}
      ORDER BY valor_periodo DESC, total_pedidos_periodo DESC, c.nome
      LIMIT 8
      `,
      [...periodoPedidos, ...params]
    );

    const [semCompraRows] = await pool.query(
      `
      SELECT
        c.id AS id_cliente,
        c.nome,
        c.cidade,
        c.uf,
        COALESCE(uc.ultima_compra, c.dtultimacompra) AS ultima_compra,
        DATEDIFF(CURDATE(), COALESCE(uc.ultima_compra, c.dtultimacompra, c.dtcadastro)) AS dias_sem_compra
      FROM clientes c
      LEFT JOIN (
        SELECT p.cod_cliente, MAX(p.data_abertura) AS ultima_compra
        FROM pedidos p
        WHERE COALESCE(p.excluido, 'N') = 'N'
        GROUP BY p.cod_cliente
      ) uc ON uc.cod_cliente = c.id
      ${clause}
      AND (uc.ultima_compra IS NULL OR uc.ultima_compra < DATE_SUB(CURDATE(), INTERVAL 90 DAY))
      ORDER BY dias_sem_compra DESC, c.nome
      LIMIT 8
      `,
      params
    );

    const [cidadeRows] = await pool.query(
      `
      SELECT
        CONCAT(COALESCE(NULLIF(TRIM(c.cidade), ''), 'Sem cidade'), ' / ', COALESCE(NULLIF(TRIM(c.uf), ''), '--')) AS cidade_uf,
        COUNT(*) AS total_clientes,
        COALESCE(SUM(vp.valor_periodo), 0) AS valor_periodo
      FROM clientes c
      LEFT JOIN (
        SELECT p.cod_cliente, COALESCE(SUM(p.vlrtotalpedido), 0) AS valor_periodo
        FROM pedidos p
        WHERE COALESCE(p.excluido, 'N') = 'N' ${periodoSql}
        GROUP BY p.cod_cliente
      ) vp ON vp.cod_cliente = c.id
      ${clause}
      GROUP BY CONCAT(COALESCE(NULLIF(TRIM(c.cidade), ''), 'Sem cidade'), ' / ', COALESCE(NULLIF(TRIM(c.uf), ''), '--'))
      ORDER BY total_clientes DESC, valor_periodo DESC
      LIMIT 8
      `,
      [...periodoPedidos, ...params]
    );

    const [recenciaRows] = await pool.query(
      `
      SELECT
        CASE
          WHEN base.ultima_compra IS NULL THEN 'Sem compra'
          WHEN DATEDIFF(CURDATE(), base.ultima_compra) <= 30 THEN '0-30 dias'
          WHEN DATEDIFF(CURDATE(), base.ultima_compra) <= 90 THEN '31-90 dias'
          WHEN DATEDIFF(CURDATE(), base.ultima_compra) <= 180 THEN '91-180 dias'
          ELSE '180+ dias'
        END AS faixa,
        COUNT(*) AS total_clientes
      FROM (
        SELECT c.id, uc.ultima_compra
        FROM clientes c
        LEFT JOIN (
          SELECT p.cod_cliente, MAX(p.data_abertura) AS ultima_compra
          FROM pedidos p
          WHERE COALESCE(p.excluido, 'N') = 'N'
          GROUP BY p.cod_cliente
        ) uc ON uc.cod_cliente = c.id
        ${clause}
      ) base
      GROUP BY faixa
      ORDER BY total_clientes DESC
      `,
      params
    );

    let vendedoresRows = [];
    if (isAdmin) {
      const [rows] = await pool.query(
        `
        SELECT
          c.cod_vendedor AS id_vendedor,
          COALESCE(u.nomeusu, CONCAT('Vendedor #', c.cod_vendedor)) AS nome_vendedor,
          COUNT(*) AS total_clientes,
          COALESCE(SUM(vp.valor_periodo), 0) AS valor_periodo
        FROM clientes c
        LEFT JOIN usuarios u ON u.idusuario = c.cod_vendedor
        LEFT JOIN (
          SELECT p.cod_cliente, COALESCE(SUM(p.vlrtotalpedido), 0) AS valor_periodo
          FROM pedidos p
          WHERE COALESCE(p.excluido, 'N') = 'N' ${periodoSql}
          GROUP BY p.cod_cliente
        ) vp ON vp.cod_cliente = c.id
        ${clause}
        GROUP BY c.cod_vendedor, COALESCE(u.nomeusu, CONCAT('Vendedor #', c.cod_vendedor))
        ORDER BY valor_periodo DESC, total_clientes DESC
        LIMIT 8
        `,
        [...periodoPedidos, ...params]
      );
      vendedoresRows = rows;
    }

    const kpis = kpiRows[0] || {};
    const clientesComPedidoPeriodo = Number(kpis.clientes_com_pedido_periodo || 0);
    const totalClientes = Number(kpis.total_clientes || 0);
    const taxaAtivacao = totalClientes ? (clientesComPedidoPeriodo / totalClientes) * 100 : 0;
    const ticketCarteira = clientesComPedidoPeriodo ? Number(kpis.valor_periodo || 0) / clientesComPedidoPeriodo : 0;

    const kpisPrev = kpiPrevRows[0] || {};
    const clientesComPedidoPeriodoPrev = Number(kpisPrev.clientes_com_pedido_periodo || 0);
    const totalClientesPrev = Number(kpisPrev.total_clientes || 0);
    const taxaAtivacaoPrev = totalClientesPrev ? (clientesComPedidoPeriodoPrev / totalClientesPrev) * 100 : 0;
    const ticketCarteiraPrev = clientesComPedidoPeriodoPrev ? Number(kpisPrev.valor_periodo || 0) / clientesComPedidoPeriodoPrev : 0;

    const calcPct = (current, previous) => {
      const c = Number(current || 0);
      const p = Number(previous || 0);
      if (!p && !c) return 0;
      if (!p) return 100;
      return ((c - p) / p) * 100;
    };

    const comparativos = {
      atual: ranges.current,
      anterior: ranges.previous,
      valor_periodo: {
        atual: Number(kpis.valor_periodo || 0),
        anterior: Number(kpisPrev.valor_periodo || 0),
        variacao_pct: Number(calcPct(kpis.valor_periodo, kpisPrev.valor_periodo).toFixed(2)),
      },
      clientes_com_pedido_periodo: {
        atual: clientesComPedidoPeriodo,
        anterior: clientesComPedidoPeriodoPrev,
        variacao_pct: Number(calcPct(clientesComPedidoPeriodo, clientesComPedidoPeriodoPrev).toFixed(2)),
      },
      taxa_ativacao: {
        atual: Number(taxaAtivacao.toFixed(2)),
        anterior: Number(taxaAtivacaoPrev.toFixed(2)),
        variacao_pct: Number((taxaAtivacao - taxaAtivacaoPrev).toFixed(2)),
      },
      ticket_carteira: {
        atual: Number(ticketCarteira.toFixed(2)),
        anterior: Number(ticketCarteiraPrev.toFixed(2)),
        variacao_pct: Number(calcPct(ticketCarteira, ticketCarteiraPrev).toFixed(2)),
      },
    };

    const insights = [];
    if (Number(kpis.sem_compra_90d || 0) > totalClientes * 0.3) {
      insights.push({
        tipo: 'alerta',
        titulo: 'Base com recência fraca',
        mensagem: 'Mais de 30% da carteira está sem compra há pelo menos 90 dias no recorte atual.',
      });
    }
    if (topClientes[0]) {
      insights.push({
        tipo: 'oportunidade',
        titulo: 'Conta com maior potencial atual',
        mensagem: `${topClientes[0].nome} lidera o período com ${Number(topClientes[0].valor_periodo || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`,
      });
    }
    if (!insights.length) {
      insights.push({
        tipo: 'ok',
        titulo: 'Carteira equilibrada',
        mensagem: 'Os indicadores de clientes estão estáveis no filtro atual.',
      });
    }

    res.json({
      filtros: {
        isAdmin,
        dt_inicio: dt_inicio || null,
        dt_fim: dt_fim || null,
        id_vendedor: req.query.id_vendedor || null,
        cidade: req.query.cidade || null,
        uf: req.query.uf || null,
        segmento: req.query.segmento || null,
      },
      kpis: {
        total_clientes: totalClientes,
        ativos: Number(kpis.ativos || 0),
        novos_30d: Number(kpis.novos_30d || 0),
        clientes_com_compra: Number(kpis.clientes_com_compra || 0),
        sem_compra_90d: Number(kpis.sem_compra_90d || 0),
        clientes_com_pedido_periodo: clientesComPedidoPeriodo,
        valor_periodo: Number(kpis.valor_periodo || 0),
        taxa_ativacao: Number(taxaAtivacao.toFixed(2)),
        ticket_carteira: Number(ticketCarteira.toFixed(2)),
      },
      comparativos,
      rankings: {
        top_clientes: topClientes,
        sem_compra: semCompraRows,
        cidades: cidadeRows,
        vendedores: vendedoresRows,
      },
      recencia: recenciaRows,
      insights,
    });
  } catch (err) {
    console.error('[analytics/comercial/clientes]', err);
    res.status(500).json({ error: 'Erro ao carregar analytics de clientes' });
  }
});

router.get('/comercial/financeiro-pedidos', async (req, res) => {
  const pool = getPool();

  try {
    const ranges = deriveComparisonRanges(req.query);
    const currentQuery = { ...req.query, ...ranges.current };
    const previousQuery = { ...req.query, ...ranges.previous };

    const { clause, params, isAdmin } = buildPedidosWhereFromQuery(currentQuery, req.user);
    const previousBase = buildPedidosWhereFromQuery(previousQuery, req.user);

    const [kpiRows] = await pool.query(
      `
      SELECT
        COUNT(r.id) AS total_parcelas,
        COALESCE(SUM(CASE WHEN r.status = 'ABERTA' THEN r.valor ELSE 0 END), 0) AS total_aberto,
        COALESCE(SUM(CASE WHEN r.status IN ('LIQUIDADO', 'RECEBIDO') THEN COALESCE(r.valor_pago, r.valor, 0) ELSE 0 END), 0) AS total_recebido,
        COALESCE(SUM(CASE WHEN r.status = 'ABERTA' AND r.vencimento < CURDATE() THEN r.valor ELSE 0 END), 0) AS total_vencido,
        COUNT(CASE WHEN r.status = 'ABERTA' AND r.vencimento < CURDATE() THEN 1 END) AS qtd_vencida,
        COUNT(DISTINCT p.cod_cliente) AS clientes_expostos,
        COALESCE(SUM(r.valor), 0) AS carteira_total
      FROM receber r
      INNER JOIN pedidos p ON p.numero = r.numero
      ${clause}
      AND COALESCE(r.excluido, 'N') = 'N'
      `,
      params
    );

    const [kpiPrevRows] = await pool.query(
      `
      SELECT
        COUNT(r.id) AS total_parcelas,
        COALESCE(SUM(CASE WHEN r.status = 'ABERTA' THEN r.valor ELSE 0 END), 0) AS total_aberto,
        COALESCE(SUM(CASE WHEN r.status IN ('LIQUIDADO', 'RECEBIDO') THEN COALESCE(r.valor_pago, r.valor, 0) ELSE 0 END), 0) AS total_recebido,
        COALESCE(SUM(CASE WHEN r.status = 'ABERTA' AND r.vencimento < CURDATE() THEN r.valor ELSE 0 END), 0) AS total_vencido,
        COUNT(CASE WHEN r.status = 'ABERTA' AND r.vencimento < CURDATE() THEN 1 END) AS qtd_vencida,
        COUNT(DISTINCT p.cod_cliente) AS clientes_expostos,
        COALESCE(SUM(r.valor), 0) AS carteira_total
      FROM receber r
      INNER JOIN pedidos p ON p.numero = r.numero
      ${previousBase.clause}
      AND COALESCE(r.excluido, 'N') = 'N'
      `,
      previousBase.params
    );

    const [statusRows] = await pool.query(
      `
      SELECT
        CASE
          WHEN r.status = 'ABERTA' AND r.vencimento < CURDATE() THEN 'EM_ATRASO'
          WHEN r.status = 'ABERTA' THEN 'A_VENCER'
          WHEN r.status IN ('LIQUIDADO', 'RECEBIDO') THEN 'RECEBIDO'
          ELSE COALESCE(NULLIF(TRIM(r.status), ''), 'SEM_STATUS')
        END AS faixa_status,
        COUNT(*) AS total_parcelas,
        COALESCE(SUM(CASE WHEN r.status IN ('LIQUIDADO', 'RECEBIDO') THEN COALESCE(r.valor_pago, r.valor, 0) ELSE r.valor END), 0) AS valor_total
      FROM receber r
      INNER JOIN pedidos p ON p.numero = r.numero
      ${clause}
      AND COALESCE(r.excluido, 'N') = 'N'
      GROUP BY faixa_status
      ORDER BY valor_total DESC, total_parcelas DESC
      `,
      params
    );

    const [agingRows] = await pool.query(
      `
      SELECT
        CASE
          WHEN DATEDIFF(CURDATE(), r.vencimento) <= 0 THEN 'A vencer'
          WHEN DATEDIFF(CURDATE(), r.vencimento) <= 30 THEN '1-30 dias'
          WHEN DATEDIFF(CURDATE(), r.vencimento) <= 60 THEN '31-60 dias'
          WHEN DATEDIFF(CURDATE(), r.vencimento) <= 90 THEN '61-90 dias'
          ELSE '90+ dias'
        END AS faixa,
        COUNT(*) AS total_parcelas,
        COALESCE(SUM(r.valor), 0) AS valor_total
      FROM receber r
      INNER JOIN pedidos p ON p.numero = r.numero
      ${clause}
      AND COALESCE(r.excluido, 'N') = 'N'
      AND r.status = 'ABERTA'
      GROUP BY faixa
      ORDER BY valor_total DESC
      `,
      params
    );

    const [serieRows] = await pool.query(
      `
      SELECT
        DATE_FORMAT(r.vencimento, '%Y-%m') AS periodo,
        COALESCE(SUM(CASE WHEN r.status = 'ABERTA' THEN r.valor ELSE 0 END), 0) AS aberto,
        COALESCE(SUM(CASE WHEN r.status IN ('LIQUIDADO', 'RECEBIDO') THEN COALESCE(r.valor_pago, r.valor, 0) ELSE 0 END), 0) AS recebido,
        COALESCE(SUM(CASE WHEN r.status = 'ABERTA' AND r.vencimento < CURDATE() THEN r.valor ELSE 0 END), 0) AS vencido
      FROM receber r
      INNER JOIN pedidos p ON p.numero = r.numero
      ${clause}
      AND COALESCE(r.excluido, 'N') = 'N'
      GROUP BY DATE_FORMAT(r.vencimento, '%Y-%m')
      ORDER BY periodo DESC
      LIMIT 6
      `,
      params
    );

    const [topClientes] = await pool.query(
      `
      SELECT
        p.cod_cliente AS id_cliente,
        COALESCE(NULLIF(TRIM(p.nome_cliente), ''), c.nome, CONCAT('Cliente #', p.cod_cliente)) AS nome_cliente,
        COUNT(*) AS total_parcelas,
        COALESCE(SUM(CASE WHEN r.status = 'ABERTA' THEN r.valor ELSE 0 END), 0) AS aberto,
        COALESCE(SUM(CASE WHEN r.status = 'ABERTA' AND r.vencimento < CURDATE() THEN r.valor ELSE 0 END), 0) AS vencido
      FROM receber r
      INNER JOIN pedidos p ON p.numero = r.numero
      LEFT JOIN clientes c ON c.id = p.cod_cliente
      ${clause}
      AND COALESCE(r.excluido, 'N') = 'N'
      GROUP BY p.cod_cliente, COALESCE(NULLIF(TRIM(p.nome_cliente), ''), c.nome, CONCAT('Cliente #', p.cod_cliente))
      ORDER BY vencido DESC, aberto DESC, total_parcelas DESC
      LIMIT 8
      `,
      params
    );

    const [formasRows] = await pool.query(
      `
      SELECT
        COALESCE(NULLIF(TRIM(r.forma_pagto), ''), COALESCE(NULLIF(TRIM(p.forma_pagto), ''), 'SEM_FORMA')) AS forma_pagto,
        COUNT(*) AS total_parcelas,
        COALESCE(SUM(r.valor), 0) AS valor_total
      FROM receber r
      INNER JOIN pedidos p ON p.numero = r.numero
      ${clause}
      AND COALESCE(r.excluido, 'N') = 'N'
      GROUP BY COALESCE(NULLIF(TRIM(r.forma_pagto), ''), COALESCE(NULLIF(TRIM(p.forma_pagto), ''), 'SEM_FORMA'))
      ORDER BY valor_total DESC, total_parcelas DESC
      LIMIT 8
      `,
      params
    );

    let vendedoresRows = [];
    if (isAdmin) {
      const [rows] = await pool.query(
        `
        SELECT
          p.id_usuario AS id_vendedor,
          COALESCE(NULLIF(TRIM(p.nome_vendedor), ''), u.nomeusu, CONCAT('Vendedor #', p.id_usuario)) AS nome_vendedor,
          COALESCE(SUM(CASE WHEN r.status = 'ABERTA' THEN r.valor ELSE 0 END), 0) AS aberto,
          COALESCE(SUM(CASE WHEN r.status = 'ABERTA' AND r.vencimento < CURDATE() THEN r.valor ELSE 0 END), 0) AS vencido,
          COUNT(*) AS total_parcelas
        FROM receber r
        INNER JOIN pedidos p ON p.numero = r.numero
        LEFT JOIN usuarios u ON u.idusuario = p.id_usuario
        ${clause}
        AND COALESCE(r.excluido, 'N') = 'N'
        GROUP BY p.id_usuario, COALESCE(NULLIF(TRIM(p.nome_vendedor), ''), u.nomeusu, CONCAT('Vendedor #', p.id_usuario))
        ORDER BY vencido DESC, aberto DESC, total_parcelas DESC
        LIMIT 8
        `,
        params
      );
      vendedoresRows = rows;
    }

    const kpis = kpiRows[0] || {};
    const kpisPrev = kpiPrevRows[0] || {};
    const totalAberto = Number(kpis.total_aberto || 0);
    const totalVencido = Number(kpis.total_vencido || 0);
    const carteiraTotal = Number(kpis.carteira_total || 0);
    const inadimplencia = totalAberto > 0 ? (totalVencido / totalAberto) * 100 : 0;
    const percentualRecebido = carteiraTotal > 0 ? (Number(kpis.total_recebido || 0) / carteiraTotal) * 100 : 0;

    const totalAbertoPrev = Number(kpisPrev.total_aberto || 0);
    const totalVencidoPrev = Number(kpisPrev.total_vencido || 0);
    const carteiraTotalPrev = Number(kpisPrev.carteira_total || 0);
    const inadimplenciaPrev = totalAbertoPrev > 0 ? (totalVencidoPrev / totalAbertoPrev) * 100 : 0;
    const percentualRecebidoPrev = carteiraTotalPrev > 0 ? (Number(kpisPrev.total_recebido || 0) / carteiraTotalPrev) * 100 : 0;

    const calcPct = (current, previous) => {
      const c = Number(current || 0);
      const p = Number(previous || 0);
      if (!p && !c) return 0;
      if (!p) return 100;
      return ((c - p) / p) * 100;
    };

    const comparativos = {
      atual: ranges.current,
      anterior: ranges.previous,
      carteira_total: {
        atual: carteiraTotal,
        anterior: carteiraTotalPrev,
        variacao_pct: Number(calcPct(carteiraTotal, carteiraTotalPrev).toFixed(2)),
      },
      total_aberto: {
        atual: totalAberto,
        anterior: totalAbertoPrev,
        variacao_pct: Number(calcPct(totalAberto, totalAbertoPrev).toFixed(2)),
      },
      total_vencido: {
        atual: totalVencido,
        anterior: totalVencidoPrev,
        variacao_pct: Number(calcPct(totalVencido, totalVencidoPrev).toFixed(2)),
      },
      inadimplencia: {
        atual: Number(inadimplencia.toFixed(2)),
        anterior: Number(inadimplenciaPrev.toFixed(2)),
        variacao_pct: Number((inadimplencia - inadimplenciaPrev).toFixed(2)),
      },
      percentual_recebido: {
        atual: Number(percentualRecebido.toFixed(2)),
        anterior: Number(percentualRecebidoPrev.toFixed(2)),
        variacao_pct: Number((percentualRecebido - percentualRecebidoPrev).toFixed(2)),
      },
    };

    const insights = [];
    if (inadimplencia >= 20) {
      insights.push({
        tipo: 'risco',
        titulo: 'Inadimplência elevada',
        mensagem: `A carteira vencida está em ${inadimplencia.toFixed(1)}% do saldo aberto no filtro atual.`,
      });
    }
    if (topClientes[0] && Number(topClientes[0].vencido || 0) > 0) {
      insights.push({
        tipo: 'alerta',
        titulo: 'Cliente com maior exposição vencida',
        mensagem: `${topClientes[0].nome_cliente} lidera o vencido, com ${Number(topClientes[0].vencido || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`,
      });
    }
    if (!insights.length) {
      insights.push({
        tipo: 'ok',
        titulo: 'Carteira sob controle',
        mensagem: 'O recorte atual não mostra desvio crítico de recebimento.',
      });
    }

    res.json({
      filtros: {
        isAdmin,
        dt_inicio: currentQuery.dt_inicio || null,
        dt_fim: currentQuery.dt_fim || null,
        situacao: currentQuery.situacao || 'TODOS',
        tipo_pedido: currentQuery.tipo_pedido || 'TODOS',
        id_vendedor: currentQuery.id_vendedor || null,
      },
      kpis: {
        total_parcelas: Number(kpis.total_parcelas || 0),
        total_aberto: totalAberto,
        total_recebido: Number(kpis.total_recebido || 0),
        total_vencido: totalVencido,
        qtd_vencida: Number(kpis.qtd_vencida || 0),
        clientes_expostos: Number(kpis.clientes_expostos || 0),
        carteira_total: carteiraTotal,
        inadimplencia: Number(inadimplencia.toFixed(2)),
        percentual_recebido: Number(percentualRecebido.toFixed(2)),
      },
      comparativos,
      status: statusRows,
      aging: agingRows,
      serie_mensal: serieRows.reverse(),
      rankings: {
        clientes: topClientes,
        formas_pagto: formasRows,
        vendedores: vendedoresRows,
      },
      insights,
    });
  } catch (err) {
    console.error('[analytics/comercial/financeiro-pedidos]', err);
    res.status(500).json({ error: 'Erro ao carregar analytics financeiro dos pedidos' });
  }
});

router.get('/comercial/produtos-mix', async (req, res) => {
  const pool = getPool();

  try {
    const ranges = deriveComparisonRanges(req.query);
    const currentQuery = { ...req.query, ...ranges.current };
    const previousQuery = { ...req.query, ...ranges.previous };

    const { clause, params, isAdmin } = buildPedidosWhereFromQuery(currentQuery, req.user);
    const previousBase = buildPedidosWhereFromQuery(previousQuery, req.user);

    const [kpiRows] = await pool.query(
      `
      SELECT
        COUNT(DISTINCT i.cod_produto) AS total_produtos,
        COALESCE(SUM(i.quantidade), 0) AS quantidade_total,
        COALESCE(SUM(i.vlrtotal_itens), 0) AS faturamento_total,
        COALESCE(AVG(NULLIF(i.vlrtotal_itens, 0)), 0) AS ticket_item,
        COUNT(DISTINCT p.cod_fornecedor) AS total_fornecedores,
        COUNT(DISTINCT pr.id_familiaproduto) AS total_familias
      FROM itensped i
      INNER JOIN pedidos p ON p.numero = i.numpedido
      LEFT JOIN produto pr ON pr.id = i.cod_produto
      ${clause}
      AND COALESCE(i.excluido, 'N') = 'N'
      `,
      params
    );

    const [kpiPrevRows] = await pool.query(
      `
      SELECT
        COUNT(DISTINCT i.cod_produto) AS total_produtos,
        COALESCE(SUM(i.quantidade), 0) AS quantidade_total,
        COALESCE(SUM(i.vlrtotal_itens), 0) AS faturamento_total,
        COALESCE(AVG(NULLIF(i.vlrtotal_itens, 0)), 0) AS ticket_item,
        COUNT(DISTINCT p.cod_fornecedor) AS total_fornecedores,
        COUNT(DISTINCT pr.id_familiaproduto) AS total_familias
      FROM itensped i
      INNER JOIN pedidos p ON p.numero = i.numpedido
      LEFT JOIN produto pr ON pr.id = i.cod_produto
      ${previousBase.clause}
      AND COALESCE(i.excluido, 'N') = 'N'
      `,
      previousBase.params
    );

    const [topProdutos] = await pool.query(
      `
      SELECT
        i.cod_produto,
        COALESCE(NULLIF(TRIM(i.desc_prod), ''), pr.descricao, CONCAT('Produto #', i.cod_produto)) AS desc_prod,
        COALESCE(pr.cod_fabricante, i.cod_fabricante, '') AS cod_fabricante,
        COALESCE(pr.unidade, i.unidade, '') AS unidade,
        COALESCE(SUM(i.quantidade), 0) AS quantidade_total,
        COALESCE(SUM(i.vlrtotal_itens), 0) AS valor_total
      FROM itensped i
      INNER JOIN pedidos p ON p.numero = i.numpedido
      LEFT JOIN produto pr ON pr.id = i.cod_produto
      ${clause}
      AND COALESCE(i.excluido, 'N') = 'N'
      GROUP BY i.cod_produto, COALESCE(NULLIF(TRIM(i.desc_prod), ''), pr.descricao, CONCAT('Produto #', i.cod_produto)), COALESCE(pr.cod_fabricante, i.cod_fabricante, ''), COALESCE(pr.unidade, i.unidade, '')
      ORDER BY valor_total DESC, quantidade_total DESC
      LIMIT 12
      `,
      params
    );

    const [familiasRows] = await pool.query(
      `
      SELECT
        COALESCE(NULLIF(TRIM(f.nome), ''), 'SEM_FAMILIA') AS familia,
        COUNT(DISTINCT i.cod_produto) AS total_produtos,
        COALESCE(SUM(i.quantidade), 0) AS quantidade_total,
        COALESCE(SUM(i.vlrtotal_itens), 0) AS valor_total
      FROM itensped i
      INNER JOIN pedidos p ON p.numero = i.numpedido
      LEFT JOIN produto pr ON pr.id = i.cod_produto
      LEFT JOIN familia_produtos f ON f.id = pr.id_familiaproduto
      ${clause}
      AND COALESCE(i.excluido, 'N') = 'N'
      GROUP BY COALESCE(NULLIF(TRIM(f.nome), ''), 'SEM_FAMILIA')
      ORDER BY valor_total DESC, quantidade_total DESC
      LIMIT 8
      `,
      params
    );

    const [gruposRows] = await pool.query(
      `
      SELECT
        COALESCE(NULLIF(TRIM(g.descricao), ''), COALESCE(NULLIF(TRIM(pr.nome_grupo), ''), 'SEM_GRUPO')) AS grupo,
        COUNT(DISTINCT i.cod_produto) AS total_produtos,
        COALESCE(SUM(i.quantidade), 0) AS quantidade_total,
        COALESCE(SUM(i.vlrtotal_itens), 0) AS valor_total
      FROM itensped i
      INNER JOIN pedidos p ON p.numero = i.numpedido
      LEFT JOIN produto pr ON pr.id = i.cod_produto
      LEFT JOIN grupos g ON g.id = pr.id_grupo
      ${clause}
      AND COALESCE(i.excluido, 'N') = 'N'
      GROUP BY COALESCE(NULLIF(TRIM(g.descricao), ''), COALESCE(NULLIF(TRIM(pr.nome_grupo), ''), 'SEM_GRUPO'))
      ORDER BY valor_total DESC, quantidade_total DESC
      LIMIT 8
      `,
      params
    );

    const [fornecedoresRows] = await pool.query(
      `
      SELECT
        COALESCE(NULLIF(TRIM(p.nome_fornecedor), ''), CONCAT('Fornecedor #', p.cod_fornecedor)) AS nome_fornecedor,
        COUNT(DISTINCT i.cod_produto) AS total_produtos,
        COALESCE(SUM(i.quantidade), 0) AS quantidade_total,
        COALESCE(SUM(i.vlrtotal_itens), 0) AS valor_total
      FROM itensped i
      INNER JOIN pedidos p ON p.numero = i.numpedido
      ${clause}
      AND COALESCE(i.excluido, 'N') = 'N'
      GROUP BY COALESCE(NULLIF(TRIM(p.nome_fornecedor), ''), CONCAT('Fornecedor #', p.cod_fornecedor))
      ORDER BY valor_total DESC, quantidade_total DESC
      LIMIT 8
      `,
      params
    );

    const [serieRows] = await pool.query(
      `
      SELECT
        DATE_FORMAT(p.data_abertura, '%Y-%m') AS periodo,
        COUNT(DISTINCT i.cod_produto) AS mix_produtos,
        COALESCE(SUM(i.quantidade), 0) AS quantidade_total,
        COALESCE(SUM(i.vlrtotal_itens), 0) AS valor_total
      FROM itensped i
      INNER JOIN pedidos p ON p.numero = i.numpedido
      ${clause}
      AND COALESCE(i.excluido, 'N') = 'N'
      GROUP BY DATE_FORMAT(p.data_abertura, '%Y-%m')
      ORDER BY periodo DESC
      LIMIT 6
      `,
      params
    );

    let vendedoresRows = [];
    if (isAdmin) {
      const [rows] = await pool.query(
        `
        SELECT
          COALESCE(NULLIF(TRIM(p.nome_vendedor), ''), u.nomeusu, CONCAT('Vendedor #', p.id_usuario)) AS nome_vendedor,
          COUNT(DISTINCT i.cod_produto) AS total_produtos,
          COALESCE(SUM(i.quantidade), 0) AS quantidade_total,
          COALESCE(SUM(i.vlrtotal_itens), 0) AS valor_total
        FROM itensped i
        INNER JOIN pedidos p ON p.numero = i.numpedido
        LEFT JOIN usuarios u ON u.idusuario = p.id_usuario
        ${clause}
        AND COALESCE(i.excluido, 'N') = 'N'
        GROUP BY COALESCE(NULLIF(TRIM(p.nome_vendedor), ''), u.nomeusu, CONCAT('Vendedor #', p.id_usuario))
        ORDER BY valor_total DESC, quantidade_total DESC
        LIMIT 8
        `,
        params
      );
      vendedoresRows = rows;
    }

    const faturamentoTotal = Number(kpiRows[0]?.faturamento_total || 0);
    const kpisPrev = kpiPrevRows[0] || {};

    const calcPct = (current, previous) => {
      const c = Number(current || 0);
      const p = Number(previous || 0);
      if (!p && !c) return 0;
      if (!p) return 100;
      return ((c - p) / p) * 100;
    };

    const comparativos = {
      atual: ranges.current,
      anterior: ranges.previous,
      faturamento_total: {
        atual: faturamentoTotal,
        anterior: Number(kpisPrev.faturamento_total || 0),
        variacao_pct: Number(calcPct(faturamentoTotal, kpisPrev.faturamento_total).toFixed(2)),
      },
      total_produtos: {
        atual: Number(kpiRows[0]?.total_produtos || 0),
        anterior: Number(kpisPrev.total_produtos || 0),
        variacao_pct: Number(calcPct(kpiRows[0]?.total_produtos, kpisPrev.total_produtos).toFixed(2)),
      },
      quantidade_total: {
        atual: Number(kpiRows[0]?.quantidade_total || 0),
        anterior: Number(kpisPrev.quantidade_total || 0),
        variacao_pct: Number(calcPct(kpiRows[0]?.quantidade_total, kpisPrev.quantidade_total).toFixed(2)),
      },
      ticket_item: {
        atual: Number(kpiRows[0]?.ticket_item || 0),
        anterior: Number(kpisPrev.ticket_item || 0),
        variacao_pct: Number(calcPct(kpiRows[0]?.ticket_item, kpisPrev.ticket_item).toFixed(2)),
      },
    };
    const topSorted = topProdutos.map(r => ({ ...r, valor_total: Number(r.valor_total || 0) }));
    let acumulado = 0;
    const curvaAbc = topSorted.slice(0, 10).map((row) => {
      acumulado += row.valor_total;
      const share = faturamentoTotal ? (row.valor_total / faturamentoTotal) * 100 : 0;
      const acumuladoPct = faturamentoTotal ? (acumulado / faturamentoTotal) * 100 : 0;
      const classe = acumuladoPct <= 80 ? 'A' : acumuladoPct <= 95 ? 'B' : 'C';
      return {
        ...row,
        share: Number(share.toFixed(2)),
        acumulado_pct: Number(acumuladoPct.toFixed(2)),
        classe,
      };
    });

    const insights = [];
    if (curvaAbc[0]) {
      insights.push({
        tipo: 'oportunidade',
        titulo: 'Produto líder do período',
        mensagem: `${curvaAbc[0].desc_prod} representa ${curvaAbc[0].share.toFixed(1)}% do faturamento analisado.`,
      });
    }
    if (curvaAbc.filter(i => i.classe === 'A').length <= 3 && curvaAbc.length >= 5) {
      insights.push({
        tipo: 'alerta',
        titulo: 'Mix concentrado',
        mensagem: 'Poucos itens concentram a maior parte da receita. Vale acompanhar dependência do mix.',
      });
    }
    if (!insights.length) {
      insights.push({
        tipo: 'ok',
        titulo: 'Mix equilibrado',
        mensagem: 'A distribuição dos itens não mostra concentração crítica no recorte atual.',
      });
    }

    res.json({
      filtros: {
        isAdmin,
        dt_inicio: currentQuery.dt_inicio || null,
        dt_fim: currentQuery.dt_fim || null,
        situacao: currentQuery.situacao || 'TODOS',
        tipo_pedido: currentQuery.tipo_pedido || 'TODOS',
        id_vendedor: currentQuery.id_vendedor || null,
      },
      kpis: {
        total_produtos: Number(kpiRows[0]?.total_produtos || 0),
        quantidade_total: Number(kpiRows[0]?.quantidade_total || 0),
        faturamento_total: faturamentoTotal,
        ticket_item: Number(kpiRows[0]?.ticket_item || 0),
        total_fornecedores: Number(kpiRows[0]?.total_fornecedores || 0),
        total_familias: Number(kpiRows[0]?.total_familias || 0),
      },
      comparativos,
      rankings: {
        produtos: topSorted,
        familias: familiasRows,
        grupos: gruposRows,
        fornecedores: fornecedoresRows,
        vendedores: vendedoresRows,
      },
      serie_mensal: serieRows.reverse(),
      curva_abc: curvaAbc,
      insights,
    });
  } catch (err) {
    console.error('[analytics/comercial/produtos-mix]', err);
    res.status(500).json({ error: 'Erro ao carregar analytics de produtos' });
  }
});

router.get('/comercial/visitas-relacionamento', async (req, res) => {
  const pool = getPool();

  try {
    const ranges = deriveComparisonRanges(req.query);
    const currentQuery = { ...req.query, ...ranges.current };
    const previousQuery = { ...req.query, ...ranges.previous };

    const base = buildVisitasWhere({ query: currentQuery, user: req.user });
    const previousBase = buildVisitasWhere({ query: previousQuery, user: req.user });
    const { clause, params, isAdmin } = base;

    const [kpiRows] = await pool.query(
      `
      SELECT
        COUNT(*) AS total_visitas,
        COUNT(CASE WHEN v.status = 'ABERTA' THEN 1 END) AS abertas,
        COUNT(CASE WHEN v.status = 'FINALIZADA' THEN 1 END) AS finalizadas,
        COUNT(DISTINCT v.id_cliente) AS clientes_visitados,
        COUNT(DISTINCT v.id_motivo) AS motivos_ativos,
        COUNT(DISTINCT CASE
          WHEN EXISTS (
            SELECT 1
            FROM pedidos p
            WHERE p.cod_cliente = v.id_cliente
              AND COALESCE(p.excluido, 'N') = 'N'
              AND p.data_abertura >= v.data_visita
              AND p.data_abertura <= DATE_ADD(v.data_visita, INTERVAL 30 DAY)
          ) THEN v.id_cliente
        END) AS clientes_convertidos_30d
      FROM visitas v
      ${clause}
      `,
      params
    );

    const [kpiPrevRows] = await pool.query(
      `
      SELECT
        COUNT(*) AS total_visitas,
        COUNT(CASE WHEN v.status = 'ABERTA' THEN 1 END) AS abertas,
        COUNT(CASE WHEN v.status = 'FINALIZADA' THEN 1 END) AS finalizadas,
        COUNT(DISTINCT v.id_cliente) AS clientes_visitados,
        COUNT(DISTINCT v.id_motivo) AS motivos_ativos,
        COUNT(DISTINCT CASE
          WHEN EXISTS (
            SELECT 1
            FROM pedidos p
            WHERE p.cod_cliente = v.id_cliente
              AND COALESCE(p.excluido, 'N') = 'N'
              AND p.data_abertura >= v.data_visita
              AND p.data_abertura <= DATE_ADD(v.data_visita, INTERVAL 30 DAY)
          ) THEN v.id_cliente
        END) AS clientes_convertidos_30d
      FROM visitas v
      ${previousBase.clause}
      `,
      previousBase.params
    );

    const [statusRows] = await pool.query(
      `
      SELECT
        COALESCE(NULLIF(TRIM(v.status), ''), 'SEM_STATUS') AS status,
        COUNT(*) AS total
      FROM visitas v
      ${clause}
      GROUP BY COALESCE(NULLIF(TRIM(v.status), ''), 'SEM_STATUS')
      ORDER BY total DESC
      `,
      params
    );

    const [motivosRows] = await pool.query(
      `
      SELECT
        COALESCE(NULLIF(TRIM(m.descricao), ''), 'SEM_MOTIVO') AS motivo,
        COUNT(*) AS total_visitas,
        COUNT(DISTINCT v.id_cliente) AS clientes_visitados,
        COUNT(CASE WHEN v.status = 'FINALIZADA' THEN 1 END) AS finalizadas,
        COUNT(DISTINCT CASE
          WHEN EXISTS (
            SELECT 1
            FROM pedidos p
            WHERE p.cod_cliente = v.id_cliente
              AND COALESCE(p.excluido, 'N') = 'N'
              AND p.data_abertura >= v.data_visita
              AND p.data_abertura <= DATE_ADD(v.data_visita, INTERVAL 30 DAY)
          ) THEN v.id_cliente
        END) AS clientes_convertidos_30d
      FROM visitas v
      LEFT JOIN motivo_visitas m ON m.id = v.id_motivo
      ${clause}
      GROUP BY COALESCE(NULLIF(TRIM(m.descricao), ''), 'SEM_MOTIVO')
      ORDER BY total_visitas DESC, finalizadas DESC
      LIMIT 8
      `,
      params
    );

    const [clientesRows] = await pool.query(
      `
      SELECT
        v.id_cliente,
        COALESCE(NULLIF(TRIM(c.nome), ''), NULLIF(TRIM(c.apelido), ''), CONCAT('Cliente #', v.id_cliente)) AS nome_cliente,
        COALESCE(NULLIF(TRIM(c.cidade), ''), 'Sem cidade') AS cidade,
        COALESCE(NULLIF(TRIM(c.uf), ''), '--') AS uf,
        COUNT(*) AS total_visitas,
        MAX(v.data_visita) AS ultima_visita,
        COUNT(CASE WHEN v.status = 'ABERTA' THEN 1 END) AS abertas,
        COUNT(CASE WHEN v.status = 'FINALIZADA' THEN 1 END) AS finalizadas,
        MAX(
          CASE
            WHEN EXISTS (
              SELECT 1
              FROM pedidos p
              WHERE p.cod_cliente = v.id_cliente
                AND COALESCE(p.excluido, 'N') = 'N'
                AND p.data_abertura >= v.data_visita
                AND p.data_abertura <= DATE_ADD(v.data_visita, INTERVAL 30 DAY)
            ) THEN 1 ELSE 0
          END
        ) AS converteu_30d
      FROM visitas v
      LEFT JOIN clientes c ON c.id = v.id_cliente
      ${clause}
      GROUP BY v.id_cliente, COALESCE(NULLIF(TRIM(c.nome), ''), NULLIF(TRIM(c.apelido), ''), CONCAT('Cliente #', v.id_cliente)), COALESCE(NULLIF(TRIM(c.cidade), ''), 'Sem cidade'), COALESCE(NULLIF(TRIM(c.uf), ''), '--')
      ORDER BY total_visitas DESC, ultima_visita DESC
      LIMIT 8
      `,
      params
    );

    const [semConversaoRows] = await pool.query(
      `
      SELECT
        v.id_cliente,
        COALESCE(NULLIF(TRIM(c.nome), ''), NULLIF(TRIM(c.apelido), ''), CONCAT('Cliente #', v.id_cliente)) AS nome_cliente,
        COALESCE(NULLIF(TRIM(c.cidade), ''), 'Sem cidade') AS cidade,
        COALESCE(NULLIF(TRIM(c.uf), ''), '--') AS uf,
        COUNT(*) AS total_visitas,
        MAX(v.data_visita) AS ultima_visita,
        DATEDIFF(CURDATE(), MAX(v.data_visita)) AS dias_desde_ultima_visita
      FROM visitas v
      LEFT JOIN clientes c ON c.id = v.id_cliente
      ${clause}
      AND NOT EXISTS (
        SELECT 1
        FROM pedidos p
        WHERE p.cod_cliente = v.id_cliente
          AND COALESCE(p.excluido, 'N') = 'N'
          AND p.data_abertura >= v.data_visita
          AND p.data_abertura <= DATE_ADD(v.data_visita, INTERVAL 30 DAY)
      )
      GROUP BY v.id_cliente, COALESCE(NULLIF(TRIM(c.nome), ''), NULLIF(TRIM(c.apelido), ''), CONCAT('Cliente #', v.id_cliente)), COALESCE(NULLIF(TRIM(c.cidade), ''), 'Sem cidade'), COALESCE(NULLIF(TRIM(c.uf), ''), '--')
      ORDER BY total_visitas DESC, ultima_visita DESC
      LIMIT 8
      `,
      params
    );

    const [serieRows] = await pool.query(
      `
      SELECT
        DATE_FORMAT(v.data_visita, '%Y-%m') AS periodo,
        COUNT(*) AS total_visitas,
        COUNT(CASE WHEN v.status = 'FINALIZADA' THEN 1 END) AS finalizadas,
        COUNT(DISTINCT v.id_cliente) AS clientes_visitados
      FROM visitas v
      ${clause}
      GROUP BY DATE_FORMAT(v.data_visita, '%Y-%m')
      ORDER BY periodo DESC
      LIMIT 6
      `,
      params
    );

    let vendedoresRows = [];
    if (isAdmin) {
      const [rows] = await pool.query(
        `
        SELECT
          COALESCE(NULLIF(TRIM(u.nomeusu), ''), CONCAT('Vendedor #', v.id_vendedor)) AS nome_vendedor,
          COUNT(*) AS total_visitas,
          COUNT(DISTINCT v.id_cliente) AS clientes_visitados,
          COUNT(CASE WHEN v.status = 'FINALIZADA' THEN 1 END) AS finalizadas
        FROM visitas v
        LEFT JOIN usuarios u ON u.idusuario = v.id_vendedor
        ${clause}
        GROUP BY COALESCE(NULLIF(TRIM(u.nomeusu), ''), CONCAT('Vendedor #', v.id_vendedor))
        ORDER BY total_visitas DESC, finalizadas DESC
        LIMIT 8
        `,
        params
      );
      vendedoresRows = rows;
    }

    const kpis = kpiRows[0] || {};
    const kpisPrev = kpiPrevRows[0] || {};
    const totalVisitas = Number(kpis.total_visitas || 0);
    const abertas = Number(kpis.abertas || 0);
    const finalizadas = Number(kpis.finalizadas || 0);
    const clientesVisitados = Number(kpis.clientes_visitados || 0);
    const clientesConvertidos30d = Number(kpis.clientes_convertidos_30d || 0);
    const taxaFinalizacao = totalVisitas ? (finalizadas / totalVisitas) * 100 : 0;
    const taxaConversao = clientesVisitados ? (clientesConvertidos30d / clientesVisitados) * 100 : 0;

    const totalVisitasPrev = Number(kpisPrev.total_visitas || 0);
    const finalizadasPrev = Number(kpisPrev.finalizadas || 0);
    const clientesVisitadosPrev = Number(kpisPrev.clientes_visitados || 0);
    const clientesConvertidos30dPrev = Number(kpisPrev.clientes_convertidos_30d || 0);
    const taxaFinalizacaoPrev = totalVisitasPrev ? (finalizadasPrev / totalVisitasPrev) * 100 : 0;
    const taxaConversaoPrev = clientesVisitadosPrev ? (clientesConvertidos30dPrev / clientesVisitadosPrev) * 100 : 0;

    const calcPct = (current, previous) => {
      const c = Number(current || 0);
      const p = Number(previous || 0);
      if (!p && !c) return 0;
      if (!p) return 100;
      return ((c - p) / p) * 100;
    };

    const comparativos = {
      atual: ranges.current,
      anterior: ranges.previous,
      total_visitas: {
        atual: totalVisitas,
        anterior: totalVisitasPrev,
        variacao_pct: Number(calcPct(totalVisitas, totalVisitasPrev).toFixed(2)),
      },
      clientes_visitados: {
        atual: clientesVisitados,
        anterior: clientesVisitadosPrev,
        variacao_pct: Number(calcPct(clientesVisitados, clientesVisitadosPrev).toFixed(2)),
      },
      taxa_finalizacao: {
        atual: Number(taxaFinalizacao.toFixed(2)),
        anterior: Number(taxaFinalizacaoPrev.toFixed(2)),
        variacao_pct: Number((taxaFinalizacao - taxaFinalizacaoPrev).toFixed(2)),
      },
      taxa_conversao_30d: {
        atual: Number(taxaConversao.toFixed(2)),
        anterior: Number(taxaConversaoPrev.toFixed(2)),
        variacao_pct: Number((taxaConversao - taxaConversaoPrev).toFixed(2)),
      },
    };

    const insights = [];
    if (abertas > finalizadas && abertas > 0) {
      insights.push({
        tipo: 'alerta',
        titulo: 'Agenda com muitas visitas abertas',
        mensagem: 'O volume de visitas em aberto esta maior do que o de finalizadas no recorte atual. Vale revisar follow-up e fechamento.',
      });
    }
    if (clientesVisitados > 0 && taxaConversao < 25) {
      insights.push({
        tipo: 'risco',
        titulo: 'Conversao baixa apos visita',
        mensagem: `Apenas ${taxaConversao.toFixed(1)}% dos clientes visitados geraram pedido em ate 30 dias.`,
      });
    }
    if (motivosRows[0]) {
      insights.push({
        tipo: 'oportunidade',
        titulo: 'Motivo mais recorrente',
        mensagem: `${motivosRows[0].motivo} lidera com ${Number(motivosRows[0].total_visitas || 0).toLocaleString('pt-BR')} visitas no periodo analisado.`,
      });
    }
    if (!insights.length) {
      insights.push({
        tipo: 'ok',
        titulo: 'Relacionamento sob controle',
        mensagem: 'A agenda esta equilibrada no recorte aplicado e sem alertas criticos de conversao.',
      });
    }

    res.json({
      filtros: {
        isAdmin,
        dt_inicio: currentQuery.dt_inicio || null,
        dt_fim: currentQuery.dt_fim || null,
        status: currentQuery.status || 'TODOS',
        id_vendedor: currentQuery.id_vendedor || null,
        id_motivo: currentQuery.id_motivo || null,
      },
      kpis: {
        total_visitas: totalVisitas,
        abertas,
        finalizadas,
        clientes_visitados: clientesVisitados,
        motivos_ativos: Number(kpis.motivos_ativos || 0),
        clientes_convertidos_30d: clientesConvertidos30d,
        taxa_finalizacao: Number(taxaFinalizacao.toFixed(2)),
        taxa_conversao_30d: Number(taxaConversao.toFixed(2)),
      },
      comparativos,
      status: statusRows,
      rankings: {
        motivos: motivosRows,
        clientes: clientesRows,
        sem_conversao: semConversaoRows,
        vendedores: vendedoresRows,
      },
      serie_mensal: serieRows.reverse(),
      insights,
    });
  } catch (err) {
    console.error('[analytics/comercial/visitas-relacionamento]', err);
    res.status(500).json({ error: 'Erro ao carregar analytics de visitas' });
  }
});

router.get('/comercial/fabricas-dependencia', async (req, res) => {
  const pool = getPool();

  try {
    const ranges = deriveComparisonRanges(req.query);
    const currentQuery = { ...req.query, ...ranges.current };
    const previousQuery = { ...req.query, ...ranges.previous };
    const base = buildPedidosWhereFromQuery(currentQuery, req.user);
    const previousBase = buildPedidosWhereFromQuery(previousQuery, req.user);
    const where = [];
    const params = [...base.params];
    const previousWhere = [];
    const previousParams = [...previousBase.params];
    const isAdmin = base.isAdmin;

    if (base.clause) {
      where.push(base.clause.replace(/^WHERE\s+/i, ''));
    }
    if (previousBase.clause) {
      previousWhere.push(previousBase.clause.replace(/^WHERE\s+/i, ''));
    }

    if (req.query.id_fornecedor) {
      where.push('p.cod_fornecedor = ?');
      params.push(parseInt(req.query.id_fornecedor, 10));
      previousWhere.push('p.cod_fornecedor = ?');
      previousParams.push(parseInt(req.query.id_fornecedor, 10));
    }

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const previousClause = previousWhere.length ? `WHERE ${previousWhere.join(' AND ')}` : '';

    const [kpiRows] = await pool.query(
      `
      SELECT
        COUNT(*) AS total_pedidos,
        COUNT(DISTINCT p.cod_fornecedor) AS total_fabricas,
        COUNT(DISTINCT p.cod_cliente) AS total_clientes,
        COALESCE(SUM(p.vlrtotalpedido), 0) AS faturamento_total,
        COALESCE(AVG(NULLIF(p.vlrtotalpedido, 0)), 0) AS ticket_medio,
        COUNT(CASE WHEN p.situacao_pedido = 'APROVADO' THEN 1 END) AS aprovados,
        COUNT(CASE WHEN p.situacao_pedido = 'CANCELADO' THEN 1 END) AS cancelados
      FROM pedidos p
      ${clause}
      `,
      params
    );

    const [comparisonRows] = await pool.query(
      `
      SELECT
        COUNT(*) AS total_pedidos,
        COUNT(DISTINCT p.cod_fornecedor) AS total_fabricas,
        COUNT(DISTINCT p.cod_cliente) AS total_clientes,
        COALESCE(SUM(p.vlrtotalpedido), 0) AS faturamento_total,
        COALESCE(AVG(NULLIF(p.vlrtotalpedido, 0)), 0) AS ticket_medio
      FROM pedidos p
      ${previousClause}
      `,
      previousParams
    );

    const [mixRows] = await pool.query(
      `
      SELECT
        COUNT(DISTINCT i.cod_produto) AS total_skus,
        COUNT(DISTINCT pr.id_familiaproduto) AS total_familias,
        COALESCE(SUM(i.quantidade), 0) AS quantidade_total
      FROM itensped i
      INNER JOIN pedidos p ON p.numero = i.numpedido
      LEFT JOIN produto pr ON pr.id = i.cod_produto
      ${clause}
      AND COALESCE(i.excluido, 'N') = 'N'
      `,
      params
    );

    const [fabricasRows] = await pool.query(
      `
      SELECT
        p.cod_fornecedor AS id_fornecedor,
        COALESCE(NULLIF(TRIM(p.nome_fornecedor), ''), f.nome, CONCAT('Fabrica #', p.cod_fornecedor)) AS nome_fornecedor,
        COALESCE(NULLIF(TRIM(f.cidade), ''), 'Sem cidade') AS cidade,
        COALESCE(NULLIF(TRIM(f.uf), ''), '--') AS uf,
        COALESCE(NULLIF(TRIM(f.segmento), ''), 'Sem segmento') AS segmento,
        COUNT(*) AS total_pedidos,
        COUNT(DISTINCT p.cod_cliente) AS total_clientes,
        COALESCE(SUM(p.vlrtotalpedido), 0) AS faturamento,
        COALESCE(AVG(NULLIF(p.vlrtotalpedido, 0)), 0) AS ticket_medio,
        COUNT(CASE WHEN p.situacao_pedido = 'APROVADO' THEN 1 END) AS aprovados,
        COUNT(CASE WHEN p.situacao_pedido = 'CANCELADO' THEN 1 END) AS cancelados
      FROM pedidos p
      LEFT JOIN fornecedores f ON f.id = p.cod_fornecedor
      ${clause}
      GROUP BY p.cod_fornecedor, COALESCE(NULLIF(TRIM(p.nome_fornecedor), ''), f.nome, CONCAT('Fabrica #', p.cod_fornecedor)), COALESCE(NULLIF(TRIM(f.cidade), ''), 'Sem cidade'), COALESCE(NULLIF(TRIM(f.uf), ''), '--'), COALESCE(NULLIF(TRIM(f.segmento), ''), 'Sem segmento')
      ORDER BY faturamento DESC, total_pedidos DESC
      LIMIT 12
      `,
      params
    );

    const [segmentosRows] = await pool.query(
      `
      SELECT
        COALESCE(NULLIF(TRIM(f.segmento), ''), 'Sem segmento') AS segmento,
        COUNT(DISTINCT p.cod_fornecedor) AS total_fabricas,
        COALESCE(SUM(p.vlrtotalpedido), 0) AS faturamento
      FROM pedidos p
      LEFT JOIN fornecedores f ON f.id = p.cod_fornecedor
      ${clause}
      GROUP BY COALESCE(NULLIF(TRIM(f.segmento), ''), 'Sem segmento')
      ORDER BY faturamento DESC, total_fabricas DESC
      LIMIT 8
      `,
      params
    );

    const [cidadesRows] = await pool.query(
      `
      SELECT
        CONCAT(COALESCE(NULLIF(TRIM(f.cidade), ''), 'Sem cidade'), ' / ', COALESCE(NULLIF(TRIM(f.uf), ''), '--')) AS cidade_uf,
        COUNT(DISTINCT p.cod_fornecedor) AS total_fabricas,
        COALESCE(SUM(p.vlrtotalpedido), 0) AS faturamento
      FROM pedidos p
      LEFT JOIN fornecedores f ON f.id = p.cod_fornecedor
      ${clause}
      GROUP BY CONCAT(COALESCE(NULLIF(TRIM(f.cidade), ''), 'Sem cidade'), ' / ', COALESCE(NULLIF(TRIM(f.uf), ''), '--'))
      ORDER BY faturamento DESC, total_fabricas DESC
      LIMIT 8
      `,
      params
    );

    const [mixFabricasRows] = await pool.query(
      `
      SELECT
        COALESCE(NULLIF(TRIM(p.nome_fornecedor), ''), f.nome, CONCAT('Fabrica #', p.cod_fornecedor)) AS nome_fornecedor,
        COUNT(DISTINCT i.cod_produto) AS total_skus,
        COUNT(DISTINCT pr.id_familiaproduto) AS total_familias,
        COALESCE(SUM(i.quantidade), 0) AS quantidade_total,
        COALESCE(SUM(i.vlrtotal_itens), 0) AS faturamento
      FROM itensped i
      INNER JOIN pedidos p ON p.numero = i.numpedido
      LEFT JOIN produto pr ON pr.id = i.cod_produto
      LEFT JOIN fornecedores f ON f.id = p.cod_fornecedor
      ${clause}
      AND COALESCE(i.excluido, 'N') = 'N'
      GROUP BY COALESCE(NULLIF(TRIM(p.nome_fornecedor), ''), f.nome, CONCAT('Fabrica #', p.cod_fornecedor))
      ORDER BY faturamento DESC, total_skus DESC
      LIMIT 8
      `,
      params
    );

    const [serieRows] = await pool.query(
      `
      SELECT
        DATE_FORMAT(p.data_abertura, '%Y-%m') AS periodo,
        COUNT(DISTINCT p.cod_fornecedor) AS total_fabricas,
        COUNT(*) AS total_pedidos,
        COALESCE(SUM(p.vlrtotalpedido), 0) AS faturamento
      FROM pedidos p
      ${clause}
      GROUP BY DATE_FORMAT(p.data_abertura, '%Y-%m')
      ORDER BY periodo DESC
      LIMIT 6
      `,
      params
    );

    const [variacaoFabricasRows] = await pool.query(
      `
      SELECT
        atual.id_fornecedor,
        atual.nome_fornecedor,
        atual.faturamento_atual,
        COALESCE(anterior.faturamento_anterior, 0) AS faturamento_anterior,
        atual.total_pedidos_atual,
        COALESCE(anterior.total_pedidos_anterior, 0) AS total_pedidos_anterior
      FROM (
        SELECT
          p.cod_fornecedor AS id_fornecedor,
          COALESCE(NULLIF(TRIM(p.nome_fornecedor), ''), f.nome, CONCAT('Fabrica #', p.cod_fornecedor)) AS nome_fornecedor,
          COALESCE(SUM(p.vlrtotalpedido), 0) AS faturamento_atual,
          COUNT(*) AS total_pedidos_atual
        FROM pedidos p
        LEFT JOIN fornecedores f ON f.id = p.cod_fornecedor
        ${clause}
        GROUP BY p.cod_fornecedor, COALESCE(NULLIF(TRIM(p.nome_fornecedor), ''), f.nome, CONCAT('Fabrica #', p.cod_fornecedor))
      ) atual
      LEFT JOIN (
        SELECT
          p.cod_fornecedor AS id_fornecedor,
          COALESCE(SUM(p.vlrtotalpedido), 0) AS faturamento_anterior,
          COUNT(*) AS total_pedidos_anterior
        FROM pedidos p
        ${previousClause}
        GROUP BY p.cod_fornecedor
      ) anterior ON anterior.id_fornecedor = atual.id_fornecedor
      ORDER BY faturamento_atual DESC
      LIMIT 30
      `,
      [...params, ...previousParams]
    );

    let vendedoresRows = [];
    if (isAdmin) {
      const [rows] = await pool.query(
        `
        SELECT
          COALESCE(NULLIF(TRIM(p.nome_vendedor), ''), u.nomeusu, CONCAT('Vendedor #', p.id_usuario)) AS nome_vendedor,
          COUNT(DISTINCT p.cod_fornecedor) AS total_fabricas,
          COUNT(*) AS total_pedidos,
          COALESCE(SUM(p.vlrtotalpedido), 0) AS faturamento
        FROM pedidos p
        LEFT JOIN usuarios u ON u.idusuario = p.id_usuario
        ${clause}
        GROUP BY COALESCE(NULLIF(TRIM(p.nome_vendedor), ''), u.nomeusu, CONCAT('Vendedor #', p.id_usuario))
        ORDER BY faturamento DESC, total_pedidos DESC
        LIMIT 8
        `,
        params
      );
      vendedoresRows = rows;
    }

    const kpis = kpiRows[0] || {};
    const mix = mixRows[0] || {};
    const comparison = comparisonRows[0] || {};
    const faturamentoTotal = Number(kpis.faturamento_total || 0);
    const totalPedidos = Number(kpis.total_pedidos || 0);
    const aprovados = Number(kpis.aprovados || 0);
    const cancelados = Number(kpis.cancelados || 0);
    const taxaAprovacao = totalPedidos ? (aprovados / totalPedidos) * 100 : 0;
    const taxaCancelamento = totalPedidos ? (cancelados / totalPedidos) * 100 : 0;
    const top5Share = faturamentoTotal
      ? fabricasRows.slice(0, 5).reduce((acc, row) => acc + Number(row.faturamento || 0), 0) / faturamentoTotal * 100
      : 0;
    const faturamentoAnterior = Number(comparison.faturamento_total || 0);
    const pedidosAnterior = Number(comparison.total_pedidos || 0);
    const fabricasAnterior = Number(comparison.total_fabricas || 0);
    const ticketAnterior = Number(comparison.ticket_medio || 0);

    const calcPct = (current, previous) => {
      if (!previous && !current) return 0;
      if (!previous) return 100;
      return ((current - previous) / previous) * 100;
    };

    const comparativos = {
      faturamento: {
        atual: faturamentoTotal,
        anterior: faturamentoAnterior,
        variacao_pct: Number(calcPct(faturamentoTotal, faturamentoAnterior).toFixed(2)),
      },
      pedidos: {
        atual: totalPedidos,
        anterior: pedidosAnterior,
        variacao_pct: Number(calcPct(totalPedidos, pedidosAnterior).toFixed(2)),
      },
      fabricas: {
        atual: Number(kpis.total_fabricas || 0),
        anterior: fabricasAnterior,
        variacao_pct: Number(calcPct(Number(kpis.total_fabricas || 0), fabricasAnterior).toFixed(2)),
      },
      ticket_medio: {
        atual: Number(kpis.ticket_medio || 0),
        anterior: ticketAnterior,
        variacao_pct: Number(calcPct(Number(kpis.ticket_medio || 0), ticketAnterior).toFixed(2)),
      },
    };

    let acumulado = 0;
    const curvaFabricas = fabricasRows.slice(0, 10).map((row) => {
      const faturamento = Number(row.faturamento || 0);
      acumulado += faturamento;
      const share = faturamentoTotal ? (faturamento / faturamentoTotal) * 100 : 0;
      const acumuladoPct = faturamentoTotal ? (acumulado / faturamentoTotal) * 100 : 0;
      const classe = acumuladoPct <= 80 ? 'A' : acumuladoPct <= 95 ? 'B' : 'C';
      return {
        ...row,
        share: Number(share.toFixed(2)),
        acumulado_pct: Number(acumuladoPct.toFixed(2)),
        classe,
      };
    });

    const variacaoNormalizada = variacaoFabricasRows.map((row) => {
      const atual = Number(row.faturamento_atual || 0);
      const anterior = Number(row.faturamento_anterior || 0);
      const variacaoPct = calcPct(atual, anterior);
      return {
        ...row,
        faturamento_atual: atual,
        faturamento_anterior: anterior,
        total_pedidos_atual: Number(row.total_pedidos_atual || 0),
        total_pedidos_anterior: Number(row.total_pedidos_anterior || 0),
        variacao_pct: Number(variacaoPct.toFixed(2)),
      };
    });

    const emExpansao = variacaoNormalizada
      .filter((row) => row.faturamento_atual > 0 && row.variacao_pct > 0)
      .sort((a, b) => b.variacao_pct - a.variacao_pct)
      .slice(0, 8);

    const emRetracao = variacaoNormalizada
      .filter((row) => row.faturamento_anterior > 0 && row.variacao_pct < 0)
      .sort((a, b) => a.variacao_pct - b.variacao_pct)
      .slice(0, 8);

    const insights = [];
    if (curvaFabricas[0]) {
      insights.push({
        tipo: 'oportunidade',
        titulo: 'Fabrica lider do periodo',
        mensagem: `${curvaFabricas[0].nome_fornecedor} concentra ${curvaFabricas[0].share.toFixed(1)}% do faturamento filtrado.`,
      });
    }
    if (top5Share >= 75) {
      insights.push({
        tipo: 'alerta',
        titulo: 'Dependencia alta de poucas fabricas',
        mensagem: `As 5 principais fabricas concentram ${top5Share.toFixed(1)}% da receita. Vale acompanhar risco de concentracao.`,
      });
    }
    if (taxaCancelamento >= 15) {
      insights.push({
        tipo: 'risco',
        titulo: 'Cancelamento acima do esperado',
        mensagem: `A taxa de cancelamento no recorte atual esta em ${taxaCancelamento.toFixed(1)}%.`,
      });
    }
    if (comparativos.faturamento.variacao_pct <= -15) {
      insights.push({
        tipo: 'risco',
        titulo: 'Queda relevante contra o periodo anterior',
        mensagem: `O faturamento caiu ${Math.abs(comparativos.faturamento.variacao_pct).toFixed(1)}% em relacao ao periodo comparado.`,
      });
    }
    if (comparativos.faturamento.variacao_pct >= 15) {
      insights.push({
        tipo: 'oportunidade',
        titulo: 'Expansao forte de receita',
        mensagem: `O faturamento cresceu ${comparativos.faturamento.variacao_pct.toFixed(1)}% frente ao periodo anterior.`,
      });
    }
    if (!insights.length) {
      insights.push({
        tipo: 'ok',
        titulo: 'Base de fabricas equilibrada',
        mensagem: 'O recorte atual nao mostra concentracao critica nem desvio relevante de performance.',
      });
    }

    res.json({
      filtros: {
        isAdmin,
        dt_inicio: req.query.dt_inicio || null,
        dt_fim: req.query.dt_fim || null,
        situacao: req.query.situacao || 'TODOS',
        tipo_pedido: req.query.tipo_pedido || 'TODOS',
        id_vendedor: req.query.id_vendedor || null,
        id_fornecedor: req.query.id_fornecedor || null,
      },
      kpis: {
        total_fabricas: Number(kpis.total_fabricas || 0),
        total_pedidos: totalPedidos,
        total_clientes: Number(kpis.total_clientes || 0),
        faturamento_total: faturamentoTotal,
        ticket_medio: Number(kpis.ticket_medio || 0),
        taxa_aprovacao: Number(taxaAprovacao.toFixed(2)),
        taxa_cancelamento: Number(taxaCancelamento.toFixed(2)),
        total_skus: Number(mix.total_skus || 0),
        total_familias: Number(mix.total_familias || 0),
        quantidade_total: Number(mix.quantidade_total || 0),
        share_top5: Number(top5Share.toFixed(2)),
      },
      comparativos: {
        ...comparativos,
        atual: ranges.current,
        anterior: ranges.previous,
      },
      rankings: {
        fabricas: fabricasRows,
        mix_fabricas: mixFabricasRows,
        segmentos: segmentosRows,
        cidades: cidadesRows,
        vendedores: vendedoresRows,
        em_expansao: emExpansao,
        em_retracao: emRetracao,
      },
      serie_mensal: serieRows.reverse(),
      curva_abc: curvaFabricas,
      insights,
    });
  } catch (err) {
    console.error('[analytics/comercial/fabricas-dependencia]', err);
    res.status(500).json({ error: 'Erro ao carregar analytics de fabricas' });
  }
});

router.get('/comercial/clientes-inativos', async (req, res) => {
  const pool = getPool();

  try {
    const dias = Math.max(0, parseInt(req.query.dias || '90', 10) || 90);
    const agrupamento = (req.query.agrupamento || 'cidade').toLowerCase(); // cidade | uf
    const faixa = String(req.query.faixa || '').toLowerCase(); // a | b | c | sem_compra
    const ordenar = String(req.query.ordenar || 'dias').toLowerCase(); // dias | score | valor12m
    const minValor12m = Math.max(0, Number(req.query.min_valor_12m || 0) || 0);
    const minPedidos12m = Math.max(0, parseInt(req.query.min_pedidos_12m || '0', 10) || 0);
    const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
    const limit = Math.min(200, Math.max(10, parseInt(req.query.limit || '50', 10) || 50));
    const offset = (page - 1) * limit;

    const scope = buildClientesScope(req);
    const whereParts = [scope.clause.replace(/^WHERE\s+/i, '')];
    const params = [...scope.params];

    // Filtros adicionais
    if (req.query.cidade) {
      whereParts.push('LOWER(COALESCE(c.cidade, \'\')) LIKE ?');
      params.push(`%${String(req.query.cidade).toLowerCase()}%`);
    }
    if (req.query.uf) {
      whereParts.push('UPPER(COALESCE(c.uf, \'\')) = ?');
      params.push(String(req.query.uf).toUpperCase());
    }

    const whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

    // Ultimo pedido por cliente (data + id)
    const lastPedidoSql = `
      SELECT x.cod_cliente, x.ultima_compra, MAX(p.id) AS id_pedido, MAX(p.numero) AS numero_pedido
      FROM (
        SELECT p.cod_cliente, MAX(p.data_abertura) AS ultima_compra
        FROM pedidos p
        WHERE COALESCE(p.excluido,'N')='N'
        GROUP BY p.cod_cliente
      ) x
      LEFT JOIN pedidos p
        ON p.cod_cliente = x.cod_cliente
       AND p.data_abertura = x.ultima_compra
       AND COALESCE(p.excluido,'N')='N'
      GROUP BY x.cod_cliente, x.ultima_compra
    `;

    const stats12mSql = `
      SELECT
        p.cod_cliente,
        COUNT(*) AS pedidos_12m,
        COALESCE(SUM(p.vlrtotalpedido), 0) AS valor_12m,
        COALESCE(AVG(NULLIF(p.vlrtotalpedido, 0)), 0) AS ticket_12m
      FROM pedidos p
      WHERE COALESCE(p.excluido,'N')='N'
        AND p.data_abertura >= DATE_SUB(CURDATE(), INTERVAL 365 DAY)
      GROUP BY p.cod_cliente
    `;

    const stats90dSql = `
      SELECT
        p.cod_cliente,
        COUNT(*) AS pedidos_90d,
        COALESCE(SUM(p.vlrtotalpedido), 0) AS valor_90d
      FROM pedidos p
      WHERE COALESCE(p.excluido,'N')='N'
        AND p.data_abertura >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
      GROUP BY p.cod_cliente
    `;

    const lastVisitaSql = `
      SELECT v.id_cliente, MAX(v.data_visita) AS ultima_visita
      FROM visitas v
      WHERE v.exluido='N'
      GROUP BY v.id_cliente
    `;

    const visitas60dSql = `
      SELECT v.id_cliente, COUNT(*) AS visitas_60d
      FROM visitas v
      WHERE v.exluido='N'
        AND v.data_visita >= DATE_SUB(CURDATE(), INTERVAL 60 DAY)
      GROUP BY v.id_cliente
    `;

    // Condicoes extras (dependem de joins)
    const extraConds = [];
    const extraParams = [];

    if (minValor12m > 0) { extraConds.push('COALESCE(s12.valor_12m, 0) >= ?'); extraParams.push(minValor12m); }
    if (minPedidos12m > 0) { extraConds.push('COALESCE(s12.pedidos_12m, 0) >= ?'); extraParams.push(minPedidos12m); }

    if (faixa === 'sem_compra') {
      extraConds.push('lp.ultima_compra IS NULL');
    } else if (faixa === 'a') {
      extraConds.push('lp.ultima_compra IS NOT NULL AND DATEDIFF(CURDATE(), lp.ultima_compra) BETWEEN ? AND 179');
      extraParams.push(dias);
    } else if (faixa === 'b') {
      extraConds.push('lp.ultima_compra IS NOT NULL AND DATEDIFF(CURDATE(), lp.ultima_compra) BETWEEN 180 AND 364');
    } else if (faixa === 'c') {
      extraConds.push('lp.ultima_compra IS NOT NULL AND DATEDIFF(CURDATE(), lp.ultima_compra) >= 365');
    }

    const extraWhere = extraConds.length ? (' AND ' + extraConds.join(' AND ')) : '';

    // Score (prioridade):
    // - Mais dias sem compra => sobe
    // - Mais valor/recorrencia historica => sobe
    // - Sem visita ha muito tempo => sobe
    // - Muitas visitas recentes sem compra => penaliza
    // - Queda 12m vs 90d => sobe (cliente "sumiu")
    const diasSemCompraExpr = `LEAST(COALESCE(DATEDIFF(CURDATE(), lp.ultima_compra), 400), 400)`;
    const valor12Expr = `LEAST(COALESCE(s12.valor_12m, 0) / 100, 200)`;
    const pedidos12Expr = `LEAST(COALESCE(s12.pedidos_12m, 0) * 5, 50)`;
    const diasSemVisitaExpr = `LEAST(COALESCE(DATEDIFF(CURDATE(), lv.ultima_visita), 200), 200)`;
    const penalVisitasExpr = `LEAST(COALESCE(v60.visitas_60d, 0) * 12, 48)`;
    const quedaExpr = `(
      CASE
        WHEN COALESCE(s12.valor_12m, 0) >= 1000 AND COALESCE(s90.valor_90d, 0) <= (COALESCE(s12.valor_12m, 0) / 12) THEN 40
        WHEN COALESCE(s12.valor_12m, 0) >= 3000 AND COALESCE(s90.valor_90d, 0) = 0 THEN 70
        ELSE 0
      END
    )`;
    const scoreExpr = `(
      ${diasSemCompraExpr}
      + ${valor12Expr}
      + ${pedidos12Expr}
      + (${diasSemVisitaExpr} / 4)
      + ${quedaExpr}
      - ${penalVisitasExpr}
    )`;

    const orderBy = ordenar === 'valor12m'
      ? 'COALESCE(s12.valor_12m, 0) DESC, dias_sem_compra DESC, c.nome'
      : ordenar === 'score'
        ? `${scoreExpr} DESC, dias_sem_compra DESC, c.nome`
        : 'dias_sem_compra DESC, c.nome';

    const [[{ total }]] = await pool.query(
      `
      SELECT COUNT(*) AS total
      FROM clientes c
      LEFT JOIN (${lastPedidoSql}) lp ON lp.cod_cliente = c.id
      LEFT JOIN (${stats12mSql}) s12 ON s12.cod_cliente = c.id
      LEFT JOIN (${stats90dSql}) s90 ON s90.cod_cliente = c.id
      LEFT JOIN (${lastVisitaSql}) lv ON lv.id_cliente = c.id
      LEFT JOIN (${visitas60dSql}) v60 ON v60.id_cliente = c.id
      ${whereClause}
        AND (lp.ultima_compra IS NULL OR DATEDIFF(CURDATE(), lp.ultima_compra) >= ?)
        ${extraWhere}
      `,
      [...params, dias, ...extraParams]
    );

    const [rows] = await pool.query(
      `
      SELECT
        c.id AS id_cliente,
        c.nome,
        c.apelido,
        c.cpf,
        c.cidade,
        c.uf,
        c.endereco,
        c.bairro,
        c.cep,
        c.latitude,
        c.longitude,
        lp.ultima_compra,
        lp.numero_pedido,
        lp.id_pedido,
        pu.vlrtotalpedido AS vlr_ult_pedido,
        s12.pedidos_12m,
        s12.valor_12m,
        s12.ticket_12m,
        s90.pedidos_90d,
        s90.valor_90d,
        v60.visitas_60d,
        lv.ultima_visita,
        DATEDIFF(CURDATE(), lp.ultima_compra) AS dias_sem_compra,
        DATEDIFF(CURDATE(), lv.ultima_visita) AS dias_sem_visita,
        ${scoreExpr} AS score
      FROM clientes c
      LEFT JOIN (${lastPedidoSql}) lp ON lp.cod_cliente = c.id
      LEFT JOIN pedidos pu ON pu.id = lp.id_pedido AND COALESCE(pu.excluido,'N')='N'
      LEFT JOIN (${stats12mSql}) s12 ON s12.cod_cliente = c.id
      LEFT JOIN (${stats90dSql}) s90 ON s90.cod_cliente = c.id
      LEFT JOIN (${lastVisitaSql}) lv ON lv.id_cliente = c.id
      LEFT JOIN (${visitas60dSql}) v60 ON v60.id_cliente = c.id
      ${whereClause}
        AND (lp.ultima_compra IS NULL OR DATEDIFF(CURDATE(), lp.ultima_compra) >= ?)
        ${extraWhere}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
      `,
      [...params, dias, ...extraParams, limit, offset]
    );

    // Busca ultimos produtos (top 5) e ranking historico recente (ultimos 180 dias) apenas para os clientes retornados
    const ids = rows.map(r => Number(r.id_cliente)).filter(Boolean);
    let ultimosProdutosByCliente = {};
    let rankingProdutosByCliente = {};

    if (ids.length) {
      const inList = ids.map(() => '?').join(',');

      const [ultRows] = await pool.query(
        `
        SELECT
          p.cod_cliente AS id_cliente,
          i.cod_produto,
          COALESCE(NULLIF(TRIM(i.desc_prod), ''), CONCAT('Produto #', i.cod_produto)) AS desc_prod,
          COALESCE(SUM(i.quantidade), 0) AS quantidade_total,
          COALESCE(SUM(i.vlrtotal_itens), 0) AS valor_total
        FROM pedidos p
        INNER JOIN itensped i ON i.numpedido = p.numero AND COALESCE(i.excluido,'N')='N'
        INNER JOIN (
          SELECT x.cod_cliente, x.ultima_compra, MAX(p.id) AS id_pedido
          FROM (
            SELECT cod_cliente, MAX(data_abertura) AS ultima_compra
            FROM pedidos
            WHERE COALESCE(excluido,'N')='N'
            GROUP BY cod_cliente
          ) x
          LEFT JOIN pedidos p
            ON p.cod_cliente = x.cod_cliente
           AND p.data_abertura = x.ultima_compra
           AND COALESCE(p.excluido,'N')='N'
          GROUP BY x.cod_cliente, x.ultima_compra
        ) lp ON lp.id_pedido = p.id
        WHERE p.cod_cliente IN (${inList})
        GROUP BY p.cod_cliente, i.cod_produto, COALESCE(NULLIF(TRIM(i.desc_prod), ''), CONCAT('Produto #', i.cod_produto))
        ORDER BY valor_total DESC
        `,
        ids
      );

      ultimosProdutosByCliente = ultRows.reduce((acc, r) => {
        const key = String(r.id_cliente);
        if (!acc[key]) acc[key] = [];
        if (acc[key].length < 5) acc[key].push(r);
        return acc;
      }, {});

      const [rankRows] = await pool.query(
        `
        SELECT
          p.cod_cliente AS id_cliente,
          i.cod_produto,
          COALESCE(NULLIF(TRIM(i.desc_prod), ''), CONCAT('Produto #', i.cod_produto)) AS desc_prod,
          COALESCE(SUM(i.quantidade), 0) AS quantidade_total,
          COALESCE(SUM(i.vlrtotal_itens), 0) AS valor_total
        FROM pedidos p
        INNER JOIN itensped i ON i.numpedido = p.numero AND COALESCE(i.excluido,'N')='N'
        WHERE COALESCE(p.excluido,'N')='N'
          AND p.cod_cliente IN (${inList})
          AND p.data_abertura >= DATE_SUB(CURDATE(), INTERVAL 180 DAY)
        GROUP BY p.cod_cliente, i.cod_produto, COALESCE(NULLIF(TRIM(i.desc_prod), ''), CONCAT('Produto #', i.cod_produto))
        ORDER BY valor_total DESC
        `,
        ids
      );

      rankingProdutosByCliente = rankRows.reduce((acc, r) => {
        const key = String(r.id_cliente);
        if (!acc[key]) acc[key] = [];
        if (acc[key].length < 8) acc[key].push(r);
        return acc;
      }, {});
    }

    // Agregacoes (UF/cidade) para leitura rapida
    const groupExpr = agrupamento === 'uf'
      ? `COALESCE(NULLIF(TRIM(c.uf), ''), '--')`
      : `CONCAT(COALESCE(NULLIF(TRIM(c.cidade), ''), 'Sem cidade'), ' / ', COALESCE(NULLIF(TRIM(c.uf), ''), '--'))`;

    const [agrRows] = await pool.query(
      `
      SELECT
        ${groupExpr} AS grupo,
        COUNT(*) AS total_clientes
      FROM clientes c
      LEFT JOIN (${lastPedidoSql}) lp ON lp.cod_cliente = c.id
      LEFT JOIN (${stats12mSql}) s12 ON s12.cod_cliente = c.id
      LEFT JOIN (${stats90dSql}) s90 ON s90.cod_cliente = c.id
      LEFT JOIN (${lastVisitaSql}) lv ON lv.id_cliente = c.id
      LEFT JOIN (${visitas60dSql}) v60 ON v60.id_cliente = c.id
      ${whereClause}
        AND (lp.ultima_compra IS NULL OR DATEDIFF(CURDATE(), lp.ultima_compra) >= ?)
        ${extraWhere}
      GROUP BY ${groupExpr}
      ORDER BY total_clientes DESC
      LIMIT 20
      `,
      [...params, dias, ...extraParams]
    );

    const [faixaRows] = await pool.query(
      `
      SELECT
        SUM(CASE WHEN COALESCE(DATEDIFF(CURDATE(), lp.ultima_compra), 99999) BETWEEN ? AND 179 THEN 1 ELSE 0 END) AS f_${dias}_179,
        SUM(CASE WHEN COALESCE(DATEDIFF(CURDATE(), lp.ultima_compra), 99999) BETWEEN 180 AND 364 THEN 1 ELSE 0 END) AS f_180_364,
        SUM(CASE WHEN COALESCE(DATEDIFF(CURDATE(), lp.ultima_compra), 99999) >= 365 THEN 1 ELSE 0 END) AS f_365_plus
      FROM clientes c
      LEFT JOIN (${lastPedidoSql}) lp ON lp.cod_cliente = c.id
      LEFT JOIN (${stats12mSql}) s12 ON s12.cod_cliente = c.id
      LEFT JOIN (${stats90dSql}) s90 ON s90.cod_cliente = c.id
      LEFT JOIN (${lastVisitaSql}) lv ON lv.id_cliente = c.id
      LEFT JOIN (${visitas60dSql}) v60 ON v60.id_cliente = c.id
      ${whereClause}
        AND (lp.ultima_compra IS NULL OR DATEDIFF(CURDATE(), lp.ultima_compra) >= ?)
        ${extraWhere}
      `,
      [...params, dias, ...extraParams, dias]
    );

    const insights = [];
    if (total > 0 && dias >= 90) {
      insights.push({
        tipo: 'alerta',
        titulo: 'Recuperacao de carteira',
        mensagem: `Existem ${Number(total).toLocaleString('pt-BR')} clientes sem compra ha ${dias} dias ou mais no filtro atual.`,
      });
    }
    if (agrRows[0]) {
      insights.push({
        tipo: 'oportunidade',
        titulo: 'Concentracao geografica',
        mensagem: `O maior grupo e ${agrRows[0].grupo}, com ${Number(agrRows[0].total_clientes || 0).toLocaleString('pt-BR')} clientes.`,
      });
    }
    if (!insights.length) {
      insights.push({
        tipo: 'ok',
        titulo: 'Sem alertas criticos',
        mensagem: 'O recorte atual nao gerou sinais relevantes para recuperacao.',
      });
    }

    res.json({
      filtros: {
        isAdmin: scope.isAdmin,
        dias,
        agrupamento,
        faixa,
        ordenar,
        min_valor_12m: minValor12m,
        min_pedidos_12m: minPedidos12m,
        page,
        limit,
        total,
      },
      agregacoes: {
        grupos: agrRows,
        faixas_inatividade: faixaRows?.[0] || {},
      },
      clientes: rows.map(r => ({
        ...r,
        ultimos_produtos: ultimosProdutosByCliente[String(r.id_cliente)] || [],
        ranking_produtos: rankingProdutosByCliente[String(r.id_cliente)] || [],
      })),
      insights,
    });
  } catch (err) {
    console.error('[analytics/comercial/clientes-inativos]', err);
    res.status(500).json({ error: 'Erro ao carregar clientes inativos' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Mapa de Oportunidades (Cliente x Fabrica) — cross-sell
// ─────────────────────────────────────────────────────────────────────────────

/** Classifica o valor comprado por um cliente numa fabrica frente a media dos clientes que compraram dela. */
function classificarCelula(valor, media) {
  if (!valor) return 'NUNCA';
  if (!media) return 'BAIXO';
  if (valor >= media * 1.5) return 'ALTO';
  if (valor >= media * 0.5) return 'MEDIO';
  return 'BAIXO';
}

router.get('/comercial/mapa-oportunidades', async (req, res) => {
  const pool = getPool();
  try {
    const base = buildPedidosWhereFromQuery(req.query, req.user);
    const idFornecedorFiltro = parseInt(req.query.id_fornecedor || '0', 10) || null;
    const limiteClientes = Math.min(Math.max(parseInt(req.query.limite || '60', 10) || 60, 10), 150);
    const q = String(req.query.q || '').trim();

    const [fornecedores] = await pool.query(
      `SELECT id, nome FROM fornecedores
       WHERE (excluido='N' OR excluido IS NULL OR excluido='')
         AND (status='A' OR status IS NULL OR status='')
         ${idFornecedorFiltro ? 'AND id = ?' : ''}
       ORDER BY nome`,
      idFornecedorFiltro ? [idFornecedorFiltro] : []
    );

    if (!fornecedores.length) {
      return res.json({ fornecedores: [], clientes: [], celulas: [], filtros: { isAdmin: base.canPickOthers } });
    }

    const idsFornecedor = fornecedores.map(f => f.id);

    const celulasWhere = [...(base.clause ? [base.clause.replace(/^WHERE /, '')] : []), 'p.cod_fornecedor IN (?)'];
    const celulasParams = [...base.params, idsFornecedor];
    if (q) {
      celulasWhere.push('c.nome LIKE ?');
      celulasParams.push(`%${q}%`);
    }

    const [linhas] = await pool.query(
      `
      SELECT
        p.cod_cliente AS id_cliente,
        c.nome AS nome_cliente,
        p.cod_fornecedor AS id_fornecedor,
        COALESCE(SUM(i.vlrtotal_itens), 0) AS valor_total,
        COUNT(DISTINCT p.numero) AS total_pedidos,
        MAX(p.data_abertura) AS ultima_compra
      FROM pedidos p
      INNER JOIN itensped i ON i.numpedido = p.numero AND COALESCE(i.excluido,'N')='N'
      INNER JOIN clientes c ON c.id = p.cod_cliente
      WHERE ${celulasWhere.join(' AND ')}
      GROUP BY p.cod_cliente, c.nome, p.cod_fornecedor
      `,
      celulasParams
    );

    // Totais por cliente, para selecionar os mais relevantes e ordenar o ranking
    const totalPorCliente = new Map();
    for (const r of linhas) {
      const acc = totalPorCliente.get(r.id_cliente) || { nome: r.nome_cliente, total: 0 };
      acc.total += Number(r.valor_total || 0);
      totalPorCliente.set(r.id_cliente, acc);
    }
    const clientesOrdenados = [...totalPorCliente.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, limiteClientes);
    const idsClientesVisiveis = new Set(clientesOrdenados.map(([id]) => id));

    // Media por fornecedor (somente entre clientes que compraram), para o bucket de cor
    const somaPorFornecedor = new Map();
    const qtdPorFornecedor = new Map();
    for (const r of linhas) {
      const v = Number(r.valor_total || 0);
      if (!v) continue;
      somaPorFornecedor.set(r.id_fornecedor, (somaPorFornecedor.get(r.id_fornecedor) || 0) + v);
      qtdPorFornecedor.set(r.id_fornecedor, (qtdPorFornecedor.get(r.id_fornecedor) || 0) + 1);
    }
    const mediaPorFornecedor = new Map(
      idsFornecedor.map(id => [id, qtdPorFornecedor.get(id) ? somaPorFornecedor.get(id) / qtdPorFornecedor.get(id) : 0])
    );

    const celulas = linhas
      .filter(r => idsClientesVisiveis.has(r.id_cliente))
      .map(r => {
        const valor = Number(r.valor_total || 0);
        return {
          id_cliente: r.id_cliente,
          id_fornecedor: r.id_fornecedor,
          valor_total: valor,
          total_pedidos: Number(r.total_pedidos || 0),
          ultima_compra: r.ultima_compra,
          classe: classificarCelula(valor, mediaPorFornecedor.get(r.id_fornecedor)),
        };
      });

    // Oportunidades sugeridas: clientes fortes que nunca compraram de uma fabrica ativa
    const comprouMap = new Map(); // id_cliente -> Set(id_fornecedor)
    for (const r of linhas) {
      if (!Number(r.valor_total)) continue;
      if (!comprouMap.has(r.id_cliente)) comprouMap.set(r.id_cliente, new Set());
      comprouMap.get(r.id_cliente).add(r.id_fornecedor);
    }
    const oportunidades = [];
    for (const [idCliente, info] of clientesOrdenados) {
      const compradas = comprouMap.get(idCliente) || new Set();
      for (const f of fornecedores) {
        if (!compradas.has(f.id)) {
          oportunidades.push({ id_cliente: idCliente, nome_cliente: info.nome, id_fornecedor: f.id, nome_fornecedor: f.nome, valor_total_cliente: info.total });
        }
      }
    }
    oportunidades.sort((a, b) => b.valor_total_cliente - a.valor_total_cliente);

    res.json({
      filtros: { isAdmin: base.canPickOthers, id_fornecedor: idFornecedorFiltro, limite: limiteClientes },
      fornecedores,
      clientes: clientesOrdenados.map(([id, info]) => ({ id_cliente: id, nome_cliente: info.nome, valor_total: info.total })),
      celulas,
      oportunidades: oportunidades.slice(0, 30),
    });
  } catch (err) {
    console.error('[analytics/comercial/mapa-oportunidades]', err);
    res.status(500).json({ error: 'Erro ao gerar mapa de oportunidades' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Relatorios Padrao (Comercial)
// ─────────────────────────────────────────────────────────────────────────────

function parseAno(v, fallback) {
  const n = parseInt(String(v || ''), 10);
  if (!Number.isFinite(n) || n < 2000 || n > 2100) return fallback;
  return n;
}

function deriveAnoRange(query) {
  const nowY = new Date().getFullYear();
  const anoFim = parseAno(query?.ano_fim, nowY);
  const anoIni = parseAno(query?.ano_ini, Math.max(2000, anoFim - 4));
  return { ano_ini: Math.min(anoIni, anoFim), ano_fim: Math.max(anoIni, anoFim) };
}

router.get('/comercial/relatorios-padrao/catalogo', async (req, res) => {
  const { ano_ini, ano_fim } = deriveAnoRange(req.query);
  const _admin = isAdminUser(req);
  const _podeRelatorio = (id) => {
    if (_admin) return true;
    const jwt = REPORT_GTELA[id];
    if (!jwt) return true; // sem permissão mapeada → liberado
    return permSn(req, jwt) === 'S';
  };
  res.json({
    filtros: { ano_ini, ano_fim },
    relatorios: ([
      {
        id: 'vendas_fornecedor_ano',
        titulo: 'Vendas por Fabrica (Ano)',
        categoria: 'Vendas',
        endpoint: '/api/analytics/comercial/relatorios-padrao/vendas-fornecedor-ano',
        defaults: { ano_ini, ano_fim },
      },
      {
        id: 'vendas_produtos_ano',
        titulo: 'Vendas por Produto (Ano)',
        categoria: 'Produtos',
        endpoint: '/api/analytics/comercial/relatorios-padrao/vendas-produtos-ano',
        defaults: { ano_ini, ano_fim, top: 20 },
      },
      {
        id: 'vendas_clientes_ano',
        titulo: 'Vendas por Cliente (Ano)',
        categoria: 'Clientes',
        endpoint: '/api/analytics/comercial/relatorios-padrao/vendas-clientes-ano',
        defaults: { ano_ini, ano_fim, top: 20 },
      },
      {
        id: 'vendas_vendedor_ano',
        titulo: 'Vendas por Vendedor (Ano)',
        categoria: 'Vendas',
        endpoint: '/api/analytics/comercial/relatorios-padrao/vendas-vendedor-ano',
        defaults: { ano_ini, ano_fim, top: 20 },
      },
      {
        id: 'pedidos_por_situacao',
        titulo: 'Pedidos por Situacao',
        categoria: 'Operacional',
        endpoint: '/api/analytics/comercial/relatorios-padrao/pedidos-por-situacao',
        defaults: { dt_inicio: '', dt_fim: '' },
      },
      {
        id: 'top_clientes_periodo',
        titulo: 'Top Clientes do Periodo',
        categoria: 'Clientes',
        endpoint: '/api/analytics/comercial/relatorios-padrao/top-clientes-periodo',
        defaults: { dt_inicio: '', dt_fim: '', top: 20 },
      },
      {
        id: 'produtos_por_cliente',
        titulo: 'Produtos Vendidos por Cliente (Detalhe)',
        categoria: 'Drilldown',
        endpoint: '/api/analytics/comercial/relatorios-padrao/produtos-por-cliente',
        defaults: { dt_inicio: '', dt_fim: '', id_cliente: '' },
      },
      {
        id: 'produtos_por_vendedor',
        titulo: 'Produtos Vendidos por Vendedor (Detalhe)',
        categoria: 'Drilldown',
        endpoint: '/api/analytics/comercial/relatorios-padrao/produtos-por-vendedor',
        defaults: { dt_inicio: '', dt_fim: '', id_vendedor: '' },
      },
      {
        id: 'produtos_por_fornecedor',
        titulo: 'Produtos Vendidos por Fabrica (Detalhe)',
        categoria: 'Drilldown',
        endpoint: '/api/analytics/comercial/relatorios-padrao/produtos-por-fornecedor',
        defaults: { dt_inicio: '', dt_fim: '', id_fornecedor: '' },
      },
    ]).filter((r) => _podeRelatorio(r.id)),
  });
});

router.get('/comercial/relatorios-padrao/vendas-fornecedor-ano', async (req, res) => {
  const pool = getPool();
  try {
    const { ano_ini, ano_fim } = deriveAnoRange(req.query);
    const top = Math.min(30, Math.max(5, parseInt(req.query.top || '15', 10) || 15));

    const baseQuery = { ...req.query };
    // limita por anos se não houver dt_inicio/dt_fim explícitos
    if (!baseQuery.dt_inicio) baseQuery.dt_inicio = `${ano_ini}-01-01`;
    if (!baseQuery.dt_fim) baseQuery.dt_fim = `${ano_fim}-12-31`;
    const base = buildPedidosWhereFromQuery(baseQuery, req.user);

    const where = base.clause;
    const params = [...base.params];

    const [rows] = await pool.query(
      `
      SELECT
        YEAR(p.data_abertura) AS ano,
        p.cod_fornecedor AS id_fornecedor,
        COALESCE(NULLIF(TRIM(p.nome_fornecedor), ''), f.nome, CONCAT('Fabrica #', p.cod_fornecedor)) AS nome_fornecedor,
        COUNT(*) AS total_pedidos,
        COALESCE(SUM(p.vlrtotalpedido), 0) AS valor_total
      FROM pedidos p
      LEFT JOIN fornecedores f ON f.id = p.cod_fornecedor
      ${where}
      GROUP BY YEAR(p.data_abertura), p.cod_fornecedor, COALESCE(NULLIF(TRIM(p.nome_fornecedor), ''), f.nome, CONCAT('Fabrica #', p.cod_fornecedor))
      ORDER BY valor_total DESC
      `,
      params
    );

    // Top fornecedores no período (por valor total) + série por ano
    const totByForn = rows.reduce((acc, r) => {
      const k = String(r.id_fornecedor);
      acc[k] = (acc[k] || 0) + Number(r.valor_total || 0);
      return acc;
    }, {});
    const topIds = Object.entries(totByForn)
      .sort((a, b) => b[1] - a[1])
      .slice(0, top)
      .map(([id]) => id);

    const serie = rows
      .filter(r => topIds.includes(String(r.id_fornecedor)))
      .map(r => ({
        ano: Number(r.ano),
        id_fornecedor: Number(r.id_fornecedor),
        nome_fornecedor: r.nome_fornecedor,
        total_pedidos: Number(r.total_pedidos || 0),
        valor_total: Number(r.valor_total || 0),
      }));

    res.json({ filtros: { ano_ini, ano_fim, top }, rows: serie });
  } catch (err) {
    console.error('[analytics/comercial/relatorios-padrao/vendas-fornecedor-ano]', err);
    res.status(500).json({ error: 'Erro ao gerar relatorio' });
  }
});

router.get('/comercial/relatorios-padrao/vendas-produtos-ano', async (req, res) => {
  const pool = getPool();
  try {
    const { ano_ini, ano_fim } = deriveAnoRange(req.query);
    const top = Math.min(50, Math.max(5, parseInt(req.query.top || '20', 10) || 20));

    const baseQuery = { ...req.query };
    if (!baseQuery.dt_inicio) baseQuery.dt_inicio = `${ano_ini}-01-01`;
    if (!baseQuery.dt_fim) baseQuery.dt_fim = `${ano_fim}-12-31`;
    const base = buildPedidosWhereFromQuery(baseQuery, req.user);

    const [rows] = await pool.query(
      `
      SELECT
        YEAR(p.data_abertura) AS ano,
        i.cod_produto AS id_produto,
        COALESCE(NULLIF(TRIM(i.desc_prod), ''), CONCAT('Produto #', i.cod_produto)) AS desc_prod,
        COALESCE(SUM(i.quantidade), 0) AS quantidade_total,
        COALESCE(SUM(i.vlrtotal_itens), 0) AS valor_total
      FROM pedidos p
      INNER JOIN itensped i ON i.numpedido = p.numero AND COALESCE(i.excluido,'N')='N'
      ${base.clause}
      GROUP BY YEAR(p.data_abertura), i.cod_produto, COALESCE(NULLIF(TRIM(i.desc_prod), ''), CONCAT('Produto #', i.cod_produto))
      ORDER BY valor_total DESC
      `,
      base.params
    );

    const totByProd = rows.reduce((acc, r) => {
      const k = String(r.id_produto);
      acc[k] = (acc[k] || 0) + Number(r.valor_total || 0);
      return acc;
    }, {});
    const topIds = Object.entries(totByProd)
      .sort((a, b) => b[1] - a[1])
      .slice(0, top)
      .map(([id]) => id);

    res.json({
      filtros: { ano_ini, ano_fim, top },
      rows: rows
        .filter(r => topIds.includes(String(r.id_produto)))
        .map(r => ({
          ano: Number(r.ano),
          id_produto: Number(r.id_produto),
          desc_prod: r.desc_prod,
          quantidade_total: Number(r.quantidade_total || 0),
          valor_total: Number(r.valor_total || 0),
        })),
    });
  } catch (err) {
    console.error('[analytics/comercial/relatorios-padrao/vendas-produtos-ano]', err);
    res.status(500).json({ error: 'Erro ao gerar relatorio' });
  }
});

router.get('/comercial/relatorios-padrao/vendas-clientes-ano', async (req, res) => {
  const pool = getPool();
  try {
    const { ano_ini, ano_fim } = deriveAnoRange(req.query);
    const top = Math.min(50, Math.max(5, parseInt(req.query.top || '20', 10) || 20));

    const baseQuery = { ...req.query };
    if (!baseQuery.dt_inicio) baseQuery.dt_inicio = `${ano_ini}-01-01`;
    if (!baseQuery.dt_fim) baseQuery.dt_fim = `${ano_fim}-12-31`;
    const base = buildPedidosWhereFromQuery(baseQuery, req.user);

    const [rows] = await pool.query(
      `
      SELECT
        YEAR(p.data_abertura) AS ano,
        p.cod_cliente AS id_cliente,
        COALESCE(NULLIF(TRIM(p.nome_cliente), ''), c.nome, CONCAT('Cliente #', p.cod_cliente)) AS nome_cliente,
        COUNT(*) AS total_pedidos,
        COALESCE(SUM(p.vlrtotalpedido), 0) AS valor_total
      FROM pedidos p
      LEFT JOIN clientes c ON c.id = p.cod_cliente
      ${base.clause}
      GROUP BY YEAR(p.data_abertura), p.cod_cliente, COALESCE(NULLIF(TRIM(p.nome_cliente), ''), c.nome, CONCAT('Cliente #', p.cod_cliente))
      ORDER BY valor_total DESC
      `,
      base.params
    );

    const totByCli = rows.reduce((acc, r) => {
      const k = String(r.id_cliente);
      acc[k] = (acc[k] || 0) + Number(r.valor_total || 0);
      return acc;
    }, {});
    const topIds = Object.entries(totByCli)
      .sort((a, b) => b[1] - a[1])
      .slice(0, top)
      .map(([id]) => id);

    res.json({
      filtros: { ano_ini, ano_fim, top },
      rows: rows
        .filter(r => topIds.includes(String(r.id_cliente)))
        .map(r => ({
          ano: Number(r.ano),
          id_cliente: Number(r.id_cliente),
          nome_cliente: r.nome_cliente,
          total_pedidos: Number(r.total_pedidos || 0),
          valor_total: Number(r.valor_total || 0),
        })),
    });
  } catch (err) {
    console.error('[analytics/comercial/relatorios-padrao/vendas-clientes-ano]', err);
    res.status(500).json({ error: 'Erro ao gerar relatorio' });
  }
});

router.get('/comercial/relatorios-padrao/vendas-vendedor-ano', async (req, res) => {
  const pool = getPool();
  try {
    const { ano_ini, ano_fim } = deriveAnoRange(req.query);
    const top = Math.min(50, Math.max(5, parseInt(req.query.top || '20', 10) || 20));

    const baseQuery = { ...req.query };
    if (!baseQuery.dt_inicio) baseQuery.dt_inicio = `${ano_ini}-01-01`;
    if (!baseQuery.dt_fim) baseQuery.dt_fim = `${ano_fim}-12-31`;
    const base = buildPedidosWhereFromQuery(baseQuery, req.user);

    const [rows] = await pool.query(
      `
      SELECT
        YEAR(p.data_abertura) AS ano,
        p.id_usuario AS id_vendedor,
        COALESCE(NULLIF(TRIM(p.nome_vendedor), ''), u.nomeusu, CONCAT('Vendedor #', p.id_usuario)) AS nome_vendedor,
        COUNT(*) AS total_pedidos,
        COALESCE(SUM(p.vlrtotalpedido), 0) AS valor_total
      FROM pedidos p
      LEFT JOIN usuarios u ON u.idusuario = p.id_usuario
      ${base.clause}
      GROUP BY YEAR(p.data_abertura), p.id_usuario, COALESCE(NULLIF(TRIM(p.nome_vendedor), ''), u.nomeusu, CONCAT('Vendedor #', p.id_usuario))
      ORDER BY valor_total DESC
      `,
      base.params
    );

    const totByVend = rows.reduce((acc, r) => {
      const k = String(r.id_vendedor);
      acc[k] = (acc[k] || 0) + Number(r.valor_total || 0);
      return acc;
    }, {});
    const topIds = Object.entries(totByVend)
      .sort((a, b) => b[1] - a[1])
      .slice(0, top)
      .map(([id]) => id);

    res.json({
      filtros: { ano_ini, ano_fim, top },
      rows: rows
        .filter(r => topIds.includes(String(r.id_vendedor)))
        .map(r => ({
          ano: Number(r.ano),
          id_vendedor: Number(r.id_vendedor),
          nome_vendedor: r.nome_vendedor,
          total_pedidos: Number(r.total_pedidos || 0),
          valor_total: Number(r.valor_total || 0),
        })),
    });
  } catch (err) {
    console.error('[analytics/comercial/relatorios-padrao/vendas-vendedor-ano]', err);
    res.status(500).json({ error: 'Erro ao gerar relatorio' });
  }
});

router.get('/comercial/relatorios-padrao/pedidos-por-situacao', async (req, res) => {
  const pool = getPool();
  try {
    const base = buildPedidosWhereFromQuery(req.query, req.user);
    const [rows] = await pool.query(
      `
      SELECT
        COALESCE(NULLIF(TRIM(p.situacao_pedido), ''), 'SEM_STATUS') AS situacao,
        COUNT(*) AS total_pedidos,
        COALESCE(SUM(p.vlrtotalpedido), 0) AS valor_total
      FROM pedidos p
      ${base.clause}
      GROUP BY COALESCE(NULLIF(TRIM(p.situacao_pedido), ''), 'SEM_STATUS')
      ORDER BY valor_total DESC, total_pedidos DESC
      `,
      base.params
    );

    res.json({
      filtros: {
        dt_inicio: req.query.dt_inicio || '',
        dt_fim: req.query.dt_fim || '',
      },
      rows: rows.map(r => ({
        situacao: r.situacao,
        total_pedidos: Number(r.total_pedidos || 0),
        valor_total: Number(r.valor_total || 0),
      })),
    });
  } catch (err) {
    console.error('[analytics/comercial/relatorios-padrao/pedidos-por-situacao]', err);
    res.status(500).json({ error: 'Erro ao gerar relatorio' });
  }
});

router.get('/comercial/relatorios-padrao/top-clientes-periodo', async (req, res) => {
  const pool = getPool();
  try {
    const top = Math.min(50, Math.max(5, parseInt(req.query.top || '20', 10) || 20));
    const base = buildPedidosWhereFromQuery(req.query, req.user);

    const [rows] = await pool.query(
      `
      SELECT
        p.cod_cliente AS id_cliente,
        COALESCE(NULLIF(TRIM(p.nome_cliente), ''), c.nome, CONCAT('Cliente #', p.cod_cliente)) AS nome_cliente,
        COUNT(*) AS total_pedidos,
        COALESCE(SUM(p.vlrtotalpedido), 0) AS valor_total,
        COALESCE(AVG(NULLIF(p.vlrtotalpedido, 0)), 0) AS ticket_medio
      FROM pedidos p
      LEFT JOIN clientes c ON c.id = p.cod_cliente
      ${base.clause}
      GROUP BY p.cod_cliente, COALESCE(NULLIF(TRIM(p.nome_cliente), ''), c.nome, CONCAT('Cliente #', p.cod_cliente))
      ORDER BY valor_total DESC
      LIMIT ${top}
      `,
      base.params
    );

    res.json({
      filtros: {
        dt_inicio: req.query.dt_inicio || '',
        dt_fim: req.query.dt_fim || '',
        top,
      },
      rows: rows.map(r => ({
        id_cliente: Number(r.id_cliente),
        nome_cliente: r.nome_cliente,
        total_pedidos: Number(r.total_pedidos || 0),
        valor_total: Number(r.valor_total || 0),
        ticket_medio: Number(r.ticket_medio || 0),
      })),
    });
  } catch (err) {
    console.error('[analytics/comercial/relatorios-padrao/top-clientes-periodo]', err);
    res.status(500).json({ error: 'Erro ao gerar relatorio' });
  }
});

router.get('/comercial/relatorios-padrao/produtos-por-cliente', async (req, res) => {
  const pool = getPool();
  try {
    const id = parseInt(req.query.id_cliente || '0', 10);
    if (!id) return res.status(400).json({ error: 'Informe id_cliente' });

    const baseQuery = { ...req.query };
    // força filtro cliente
    baseQuery.id_vendedor = baseQuery.id_vendedor || ''; // permitido (admin) ou vai ser imposto (nao admin)
    const base = buildPedidosWhereFromQuery(baseQuery, req.user);

    const [rows] = await pool.query(
      `
      SELECT
        i.cod_produto AS id_produto,
        COALESCE(NULLIF(TRIM(i.desc_prod), ''), CONCAT('Produto #', i.cod_produto)) AS desc_prod,
        COALESCE(SUM(i.quantidade), 0) AS quantidade_total,
        COALESCE(SUM(i.vlrtotal_itens), 0) AS valor_total,
        COUNT(DISTINCT p.numero) AS total_pedidos
      FROM pedidos p
      INNER JOIN itensped i ON i.numpedido = p.numero AND COALESCE(i.excluido,'N')='N'
      ${base.clause}
        AND p.cod_cliente = ?
      GROUP BY i.cod_produto, COALESCE(NULLIF(TRIM(i.desc_prod), ''), CONCAT('Produto #', i.cod_produto))
      ORDER BY valor_total DESC
      LIMIT 500
      `,
      [...base.params, id]
    );

    res.json({ filtros: { id_cliente: id }, rows: rows.map(r => ({ ...r, quantidade_total: Number(r.quantidade_total||0), valor_total: Number(r.valor_total||0), total_pedidos: Number(r.total_pedidos||0) })) });
  } catch (err) {
    console.error('[analytics/comercial/relatorios-padrao/produtos-por-cliente]', err);
    res.status(500).json({ error: 'Erro ao gerar relatorio' });
  }
});

router.get('/comercial/relatorios-padrao/produtos-por-vendedor', async (req, res) => {
  const pool = getPool();
  try {
    const idVend = parseInt(req.query.id_vendedor || '0', 10);
    const baseQuery = { ...req.query };
    if (idVend) baseQuery.id_vendedor = idVend;
    const base = buildPedidosWhereFromQuery(baseQuery, req.user);

    const [rows] = await pool.query(
      `
      SELECT
        i.cod_produto AS id_produto,
        COALESCE(NULLIF(TRIM(i.desc_prod), ''), CONCAT('Produto #', i.cod_produto)) AS desc_prod,
        COALESCE(SUM(i.quantidade), 0) AS quantidade_total,
        COALESCE(SUM(i.vlrtotal_itens), 0) AS valor_total,
        COUNT(DISTINCT p.numero) AS total_pedidos
      FROM pedidos p
      INNER JOIN itensped i ON i.numpedido = p.numero AND COALESCE(i.excluido,'N')='N'
      ${base.clause}
      GROUP BY i.cod_produto, COALESCE(NULLIF(TRIM(i.desc_prod), ''), CONCAT('Produto #', i.cod_produto))
      ORDER BY valor_total DESC
      LIMIT 500
      `,
      base.params
    );

    res.json({ filtros: { id_vendedor: idVend || null }, rows: rows.map(r => ({ ...r, quantidade_total: Number(r.quantidade_total||0), valor_total: Number(r.valor_total||0), total_pedidos: Number(r.total_pedidos||0) })) });
  } catch (err) {
    console.error('[analytics/comercial/relatorios-padrao/produtos-por-vendedor]', err);
    res.status(500).json({ error: 'Erro ao gerar relatorio' });
  }
});

router.get('/comercial/relatorios-padrao/produtos-por-fornecedor', async (req, res) => {
  const pool = getPool();
  try {
    const idForn = parseInt(req.query.id_fornecedor || '0', 10);
    if (!idForn) return res.status(400).json({ error: 'Informe id_fornecedor' });

    const baseQuery = { ...req.query };
    const base = buildPedidosWhereFromQuery(baseQuery, req.user);

    const [rows] = await pool.query(
      `
      SELECT
        i.cod_produto AS id_produto,
        COALESCE(NULLIF(TRIM(i.desc_prod), ''), CONCAT('Produto #', i.cod_produto)) AS desc_prod,
        COALESCE(SUM(i.quantidade), 0) AS quantidade_total,
        COALESCE(SUM(i.vlrtotal_itens), 0) AS valor_total,
        COUNT(DISTINCT p.numero) AS total_pedidos
      FROM pedidos p
      INNER JOIN itensped i ON i.numpedido = p.numero AND COALESCE(i.excluido,'N')='N'
      ${base.clause}
        AND p.cod_fornecedor = ?
      GROUP BY i.cod_produto, COALESCE(NULLIF(TRIM(i.desc_prod), ''), CONCAT('Produto #', i.cod_produto))
      ORDER BY valor_total DESC
      LIMIT 500
      `,
      [...base.params, idForn]
    );

    res.json({ filtros: { id_fornecedor: idForn }, rows: rows.map(r => ({ ...r, quantidade_total: Number(r.quantidade_total||0), valor_total: Number(r.valor_total||0), total_pedidos: Number(r.total_pedidos||0) })) });
  } catch (err) {
    console.error('[analytics/comercial/relatorios-padrao/produtos-por-fornecedor]', err);
    res.status(500).json({ error: 'Erro ao gerar relatorio' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARDS PRO — séries ano-a-ano genéricas + drill-down paginado
// Usados pela página /pages/comercial-dashboards-pro.html (7 abas).
// ─────────────────────────────────────────────────────────────────────────────

// Configuração por dimensão. level: 'pedido' agrega pedidos; 'item' agrega itensped.
// clientes (c) é sempre juntado em pedido-level para permitir recortes geográficos.
function dashDimConfig(dim) {
  const D = {
    fornecedor: {
      level: 'pedido', label: 'Fábrica',
      idExpr: 'p.cod_fornecedor',
      nomeExpr: "COALESCE(NULLIF(TRIM(p.nome_fornecedor), ''), f.nome, CONCAT('Fabrica #', p.cod_fornecedor))",
      extraJoin: 'LEFT JOIN fornecedores f ON f.id = p.cod_fornecedor',
    },
    cliente: {
      level: 'pedido', label: 'Cliente',
      idExpr: 'p.cod_cliente',
      nomeExpr: "COALESCE(NULLIF(TRIM(p.nome_cliente), ''), c.nome, CONCAT('Cliente #', p.cod_cliente))",
      extraJoin: '',
    },
    vendedor: {
      level: 'pedido', label: 'Vendedor',
      idExpr: 'p.id_usuario',
      nomeExpr: "COALESCE(NULLIF(TRIM(p.nome_vendedor), ''), u.nomeusu, CONCAT('Vendedor #', p.id_usuario))",
      extraJoin: 'LEFT JOIN usuarios u ON u.idusuario = p.id_usuario',
    },
    estado: {
      level: 'pedido', label: 'Estado', idIsString: true,
      idExpr: "UPPER(COALESCE(NULLIF(TRIM(c.uf), ''), '--'))",
      nomeExpr: "UPPER(COALESCE(NULLIF(TRIM(c.uf), ''), '--'))",
      extraJoin: '',
    },
    cidade: {
      level: 'pedido', label: 'Cidade', idIsString: true,
      idExpr: "CONCAT(COALESCE(NULLIF(TRIM(c.cidade), ''), 'Sem cidade'), ' / ', UPPER(COALESCE(NULLIF(TRIM(c.uf), ''), '--')))",
      nomeExpr: "CONCAT(COALESCE(NULLIF(TRIM(c.cidade), ''), 'Sem cidade'), ' / ', UPPER(COALESCE(NULLIF(TRIM(c.uf), ''), '--')))",
      extraJoin: '',
    },
    segmento: {
      level: 'pedido', label: 'Segmento', idIsString: true,
      idExpr: "COALESCE(NULLIF(TRIM(c.segmento), ''), 'Sem segmento')",
      nomeExpr: "COALESCE(NULLIF(TRIM(c.segmento), ''), 'Sem segmento')",
      extraJoin: '',
    },
    produto: {
      level: 'item', label: 'Produto',
      idExpr: 'i.cod_produto',
      nomeExpr: "COALESCE(NULLIF(TRIM(i.desc_prod), ''), pr.descricao, CONCAT('Produto #', i.cod_produto))",
      extraJoin: 'LEFT JOIN produto pr ON pr.id = i.cod_produto',
    },
    familia: {
      level: 'item', label: 'Família',
      idExpr: 'COALESCE(pr.id_familiaproduto, 0)',
      nomeExpr: "COALESCE(NULLIF(TRIM(fam.nome), ''), 'Sem familia')",
      extraJoin: 'LEFT JOIN produto pr ON pr.id = i.cod_produto LEFT JOIN familia_produtos fam ON fam.id = pr.id_familiaproduto',
    },
  };
  return D[dim] || null;
}

// Monta a cláusula WHERE (base de pedidos + filtros extras geográficos/fábrica).
function dashBuildWhere(req, anoIni, anoFim) {
  const baseQuery = { ...req.query };
  if (!baseQuery.dt_inicio) baseQuery.dt_inicio = `${anoIni}-01-01`;
  if (!baseQuery.dt_fim) baseQuery.dt_fim = `${anoFim}-12-31`;
  const base = buildPedidosWhereFromQuery(baseQuery, req.user);
  const where = [base.clause.replace(/^WHERE /, '')];
  const params = [...base.params];
  if (req.query.uf) { where.push("UPPER(COALESCE(c.uf, '')) = ?"); params.push(String(req.query.uf).toUpperCase()); }
  if (req.query.segmento) { where.push('c.segmento = ?'); params.push(req.query.segmento); }
  if (req.query.cidade) { where.push("LOWER(COALESCE(c.cidade, '')) LIKE ?"); params.push(`%${String(req.query.cidade).toLowerCase()}%`); }
  if (req.query.id_fornecedor) { where.push('p.cod_fornecedor = ?'); params.push(parseInt(req.query.id_fornecedor, 10)); }
  return { where, params, isAdmin: base.canPickOthers };
}

router.get('/comercial/dash/series', async (req, res) => {
  const pool = getPool();
  try {
    const cfg = dashDimConfig(String(req.query.dim || '').toLowerCase());
    if (!cfg) return res.status(400).json({ error: 'Dimensão inválida' });

    const { ano_ini, ano_fim } = deriveAnoRange(req.query);
    const top = Math.min(50, Math.max(3, parseInt(req.query.top || '15', 10) || 15));

    const { where, params, isAdmin } = dashBuildWhere(req, ano_ini, ano_fim);
    const whereSql = where.filter(Boolean).length ? `WHERE ${where.filter(Boolean).join(' AND ')}` : '';

    let fromSql, valExpr, qtyExpr;
    if (cfg.level === 'item') {
      fromSql = `FROM pedidos p
        INNER JOIN itensped i ON i.numpedido = p.numero AND COALESCE(i.excluido,'N')='N'
        LEFT JOIN clientes c ON c.id = p.cod_cliente
        ${cfg.extraJoin}`;
      valExpr = 'COALESCE(SUM(i.vlrtotal_itens),0)';
      qtyExpr = 'COALESCE(SUM(i.quantidade),0)';
    } else {
      fromSql = `FROM pedidos p
        LEFT JOIN clientes c ON c.id = p.cod_cliente
        ${cfg.extraJoin}`;
      valExpr = 'COALESCE(SUM(p.vlrtotalpedido),0)';
      qtyExpr = 'COUNT(DISTINCT p.numero)';
    }

    const [rows] = await pool.query(
      `SELECT YEAR(p.data_abertura) AS ano,
              ${cfg.idExpr} AS id,
              ${cfg.nomeExpr} AS nome,
              ${valExpr} AS valor_total,
              ${qtyExpr} AS quantidade
       ${fromSql}
       ${whereSql}
       GROUP BY YEAR(p.data_abertura), ${cfg.idExpr}, ${cfg.nomeExpr}
       ORDER BY valor_total DESC`,
      params
    );

    const totById = new Map();
    const nomeById = new Map();
    for (const r of rows) {
      const k = String(r.id);
      totById.set(k, (totById.get(k) || 0) + Number(r.valor_total || 0));
      if (!nomeById.has(k)) nomeById.set(k, r.nome);
    }
    const topIds = [...totById.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k]) => k);

    const anos = [];
    for (let a = ano_ini; a <= ano_fim; a++) anos.push(a);
    rows.forEach((r) => { const a = Number(r.ano); if (a && !anos.includes(a)) anos.push(a); });
    anos.sort((a, b) => a - b);

    const series = topIds.map((k) => {
      const porAno = {};
      anos.forEach((a) => { porAno[a] = 0; });
      let qtd = 0;
      rows.forEach((r) => {
        if (String(r.id) === k) {
          porAno[Number(r.ano)] = Number(r.valor_total || 0);
          qtd += Number(r.quantidade || 0);
        }
      });
      return { id: k, nome: nomeById.get(k), porAno, total: totById.get(k), quantidade: qtd };
    });

    res.json({
      dim: req.query.dim,
      label: cfg.label,
      idIsString: !!cfg.idIsString,
      isAdmin,
      filtros: { ano_ini, ano_fim, top },
      anos,
      series,
    });
  } catch (err) {
    console.error('[analytics/comercial/dash/series]', err);
    res.status(500).json({ error: 'Erro ao gerar série' });
  }
});

router.get('/comercial/dash/detalhe', async (req, res) => {
  const pool = getPool();
  try {
    const cfg = dashDimConfig(String(req.query.dim || '').toLowerCase());
    if (!cfg) return res.status(400).json({ error: 'Dimensão inválida' });
    const idRaw = req.query.id;
    if (idRaw === undefined || idRaw === '') return res.status(400).json({ error: 'Informe id' });

    const { ano_ini, ano_fim } = deriveAnoRange(req.query);
    const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
    const pageSize = Math.min(200, Math.max(5, parseInt(req.query.page_size || '20', 10) || 20));
    const offset = (page - 1) * pageSize;

    const { where, params } = dashBuildWhere(req, ano_ini, ano_fim);
    where.push(`${cfg.idExpr} = ?`);
    params.push(cfg.idIsString ? String(idRaw) : parseInt(idRaw, 10));
    const whereSql = `WHERE ${where.filter(Boolean).join(' AND ')}`;

    if (cfg.level === 'item') {
      const fromSql = `FROM pedidos p
        INNER JOIN itensped i ON i.numpedido = p.numero AND COALESCE(i.excluido,'N')='N'
        LEFT JOIN clientes c ON c.id = p.cod_cliente
        ${cfg.extraJoin}`;
      const [cntRows] = await pool.query(`SELECT COUNT(*) AS total ${fromSql} ${whereSql}`, params);
      const total = Number(cntRows[0]?.total || 0);
      const [sumRows] = await pool.query(`SELECT COALESCE(SUM(i.vlrtotal_itens),0) AS soma ${fromSql} ${whereSql}`, params);
      const [rows] = await pool.query(
        `SELECT p.numero, p.data_abertura,
                COALESCE(NULLIF(TRIM(p.nome_cliente),''), c.nome, CONCAT('Cliente #', p.cod_cliente)) AS nome_cliente,
                COALESCE(NULLIF(TRIM(i.desc_prod),''), CONCAT('Produto #', i.cod_produto)) AS desc_prod,
                COALESCE(i.quantidade,0) AS quantidade,
                COALESCE(i.vlrtotal_itens,0) AS valor,
                p.situacao_pedido
         ${fromSql} ${whereSql}
         ORDER BY p.data_abertura DESC, p.numero DESC
         LIMIT ? OFFSET ?`,
        [...params, pageSize, offset]
      );
      return res.json({
        level: 'item', page, page_size: pageSize, total,
        total_pages: Math.ceil(total / pageSize) || 1, soma: Number(sumRows[0]?.soma || 0),
        rows: rows.map((r) => ({
          numero: r.numero, data: r.data_abertura, nome_cliente: r.nome_cliente,
          desc_prod: r.desc_prod, quantidade: Number(r.quantidade), valor: Number(r.valor), situacao: r.situacao_pedido,
        })),
      });
    }

    const fromSql = `FROM pedidos p
      LEFT JOIN clientes c ON c.id = p.cod_cliente
      LEFT JOIN fornecedores f ON f.id = p.cod_fornecedor
      LEFT JOIN usuarios u ON u.idusuario = p.id_usuario`;
    const [cntRows] = await pool.query(`SELECT COUNT(DISTINCT p.numero) AS total ${fromSql} ${whereSql}`, params);
    const total = Number(cntRows[0]?.total || 0);
    const [sumRows] = await pool.query(
      `SELECT COALESCE(SUM(t.valor),0) AS soma FROM (SELECT p.numero, MAX(COALESCE(p.vlrtotalpedido,0)) AS valor ${fromSql} ${whereSql} GROUP BY p.numero) t`,
      params
    );
    const [rows] = await pool.query(
      `SELECT p.numero, p.data_abertura,
              COALESCE(NULLIF(TRIM(p.nome_cliente),''), c.nome, CONCAT('Cliente #', p.cod_cliente)) AS nome_cliente,
              COALESCE(NULLIF(TRIM(p.nome_fornecedor),''), f.nome, CONCAT('Fabrica #', p.cod_fornecedor)) AS nome_fornecedor,
              COALESCE(NULLIF(TRIM(p.nome_vendedor),''), u.nomeusu, CONCAT('Vendedor #', p.id_usuario)) AS nome_vendedor,
              p.situacao_pedido,
              COALESCE(p.vlrtotalpedido,0) AS valor
       ${fromSql} ${whereSql}
       ORDER BY p.data_abertura DESC, p.numero DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    return res.json({
      level: 'pedido', page, page_size: pageSize, total,
      total_pages: Math.ceil(total / pageSize) || 1, soma: Number(sumRows[0]?.soma || 0),
      rows: rows.map((r) => ({
        numero: r.numero, data: r.data_abertura, nome_cliente: r.nome_cliente,
        nome_fornecedor: r.nome_fornecedor, nome_vendedor: r.nome_vendedor,
        situacao: r.situacao_pedido, valor: Number(r.valor),
      })),
    });
  } catch (err) {
    console.error('[analytics/comercial/dash/detalhe]', err);
    res.status(500).json({ error: 'Erro ao gerar detalhe' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Curva ABC de Clientes
// ─────────────────────────────────────────────────────────────────────────────
router.get('/comercial/curva-abc-clientes', async (req, res) => {
  const pool = getPool();
  try {
    const base = buildPedidosWhereFromQuery(req.query, req.user);

    const [rows] = await pool.query(
      `
      SELECT
        p.cod_cliente AS id_cliente,
        COALESCE(NULLIF(TRIM(p.nome_cliente), ''), c.nome, CONCAT('Cliente #', p.cod_cliente)) AS nome_cliente,
        COALESCE(c.cidade, '') AS cidade,
        COALESCE(c.uf, '') AS uf,
        COUNT(DISTINCT p.numero) AS total_pedidos,
        COALESCE(SUM(p.vlrtotalpedido), 0) AS valor_total,
        COALESCE(AVG(NULLIF(p.vlrtotalpedido, 0)), 0) AS ticket_medio,
        MAX(p.data_abertura) AS ultima_compra
      FROM pedidos p
      LEFT JOIN clientes c ON c.id = p.cod_cliente
      ${base.clause}
      AND p.situacao_pedido NOT IN ('CANCELADO')
      GROUP BY p.cod_cliente, COALESCE(NULLIF(TRIM(p.nome_cliente), ''), c.nome, CONCAT('Cliente #', p.cod_cliente)), c.cidade, c.uf
      ORDER BY valor_total DESC
      LIMIT 2000
      `,
      base.params
    );

    const totalGeral = rows.reduce((s, r) => s + Number(r.valor_total || 0), 0);
    let acumulado = 0;
    const clientes = rows.map((r, idx) => {
      const v = Number(r.valor_total || 0);
      acumulado += v;
      const share = totalGeral > 0 ? (v / totalGeral) * 100 : 0;
      const acumuladoPct = totalGeral > 0 ? (acumulado / totalGeral) * 100 : 0;
      const classe = acumuladoPct <= 80 ? 'A' : acumuladoPct <= 95 ? 'B' : 'C';
      return {
        posicao: idx + 1,
        id_cliente: r.id_cliente,
        nome_cliente: r.nome_cliente,
        cidade: r.cidade,
        uf: r.uf,
        total_pedidos: Number(r.total_pedidos || 0),
        valor_total: v,
        ticket_medio: Number(r.ticket_medio || 0),
        ultima_compra: r.ultima_compra,
        share: Number(share.toFixed(2)),
        acumulado_pct: Number(acumuladoPct.toFixed(2)),
        classe,
      };
    });

    const resumo = { A: { count: 0, valor: 0 }, B: { count: 0, valor: 0 }, C: { count: 0, valor: 0 } };
    clientes.forEach(c => {
      resumo[c.classe].count++;
      resumo[c.classe].valor += c.valor_total;
    });

    res.json({
      filtros: {
        isAdmin: base.isAdmin,
        dt_inicio: req.query.dt_inicio || null,
        dt_fim: req.query.dt_fim || null,
        id_vendedor: req.query.id_vendedor || null,
      },
      total_geral: totalGeral,
      resumo,
      clientes,
    });
  } catch (err) {
    console.error('[analytics/comercial/curva-abc-clientes]', err);
    res.status(500).json({ error: 'Erro ao calcular curva ABC de clientes' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Ranking de Vendedores com Metas
// ─────────────────────────────────────────────────────────────────────────────
router.get('/comercial/ranking-vendedores', async (req, res) => {
  const pool = getPool();
  try {
    const isAdmin = req.user?.role === 'admin';
    if (!isAdmin) return res.status(403).json({ error: 'Acesso restrito a administradores' });

    const now = new Date();
    const mes  = parseInt(req.query.mes  || String(now.getMonth() + 1), 10);
    const ano  = parseInt(req.query.ano  || String(now.getFullYear()),   10);

    const _ultimoDia = (y, m) => String(new Date(y, m, 0).getDate()).padStart(2, '0');
    const dtInicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
    const dtFim    = `${ano}-${String(mes).padStart(2, '0')}-${_ultimoDia(ano, mes)}`;

    // mês anterior para comparativo
    const mesAnt = mes === 1 ? 12 : mes - 1;
    const anoAnt = mes === 1 ? ano - 1 : ano;
    const dtInicioAnt = `${anoAnt}-${String(mesAnt).padStart(2, '0')}-01`;
    const dtFimAnt    = `${anoAnt}-${String(mesAnt).padStart(2, '0')}-${_ultimoDia(anoAnt, mesAnt)}`;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS comissao_metas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        id_usuario INT NOT NULL,
        mes INT NOT NULL,
        ano INT NOT NULL,
        vlr_meta_vendas DECIMAL(15,2) DEFAULT 0,
        vlr_meta_comissao DECIMAL(15,2) DEFAULT 0,
        obs VARCHAR(500) DEFAULT NULL,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_meta (id_usuario, mes, ano)
      )
    `).catch(() => {});

    // Detectar esquema legado: alguns bancos têm p_vender direto em usuarios (sem JOIN perfil)
    // e usam idperfil em vez de perfil como FK
    const [[dbRow]] = await pool.query(`SELECT DATABASE() AS db`);
    const [[colInfo]] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'p_vender' LIMIT 1`,
      [dbRow.db]
    );
    const temPVenderDireto = !!colInfo;

    // Se usuarios já tem p_vender, filtrar direto; senão JOIN com perfil usando coluna correta
    let joinPerfil, wherePerfil;
    if (temPVenderDireto) {
      joinPerfil = '';
      wherePerfil = `AND u.p_vender = 'S'`;
    } else {
      const [[colPerfil]] = await pool.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'usuarios' AND COLUMN_NAME IN ('perfil','idperfil')
         ORDER BY FIELD(COLUMN_NAME,'perfil','idperfil') LIMIT 1`,
        [dbRow.db]
      );
      const colFK = colPerfil?.COLUMN_NAME || 'perfil';
      joinPerfil = `INNER JOIN perfil pf ON pf.id = u.${colFK} AND pf.p_vender = 'S'`;
      wherePerfil = '';
    }

    const [rows] = await pool.query(
      `
      SELECT
        u.idusuario AS id_usuario,
        u.nomeusu AS nome_vendedor,
        COALESCE(SUM(CASE WHEN p.data_abertura BETWEEN ? AND ? AND p.situacao_pedido NOT IN ('CANCELADO') THEN p.vlrtotalpedido END), 0) AS valor_mes,
        COALESCE(COUNT(DISTINCT CASE WHEN p.data_abertura BETWEEN ? AND ? AND p.situacao_pedido NOT IN ('CANCELADO') THEN p.numero END), 0) AS pedidos_mes,
        COALESCE(SUM(CASE WHEN p.data_abertura BETWEEN ? AND ? AND p.situacao_pedido NOT IN ('CANCELADO') THEN p.vlrtotalpedido END), 0) AS valor_ant,
        COALESCE(m.vlr_meta_vendas, 0) AS meta_vendas
      FROM usuarios u
      ${joinPerfil}
      LEFT JOIN pedidos p ON p.id_usuario = u.idusuario AND COALESCE(p.excluido, 'N') = 'N'
      LEFT JOIN comissao_metas m ON m.id_usuario = u.idusuario AND m.mes = ? AND m.ano = ?
      WHERE u.excluido = 'N' AND u.SITUACAO = 'ATIVO' ${wherePerfil}
      GROUP BY u.idusuario, u.nomeusu, m.vlr_meta_vendas
      ORDER BY valor_mes DESC
      `,
      [dtInicio, dtFim, dtInicio, dtFim, dtInicioAnt, dtFimAnt, mes, ano]
    );

    const ranking = rows.map((r, idx) => {
      const v = Number(r.valor_mes || 0);
      const meta = Number(r.meta_vendas || 0);
      const ant = Number(r.valor_ant || 0);
      const pctMeta = meta > 0 ? (v / meta) * 100 : null;
      const variacao = ant > 0 ? ((v - ant) / ant) * 100 : null;
      return {
        posicao: idx + 1,
        id_usuario: r.id_usuario,
        nome_vendedor: r.nome_vendedor,
        valor_mes: v,
        pedidos_mes: Number(r.pedidos_mes || 0),
        valor_ant: ant,
        meta_vendas: meta,
        pct_meta: pctMeta !== null ? Number(pctMeta.toFixed(1)) : null,
        variacao_pct: variacao !== null ? Number(variacao.toFixed(1)) : null,
      };
    });

    res.json({ mes, ano, mes_ant: mesAnt, ano_ant: anoAnt, ranking });
  } catch (err) {
    console.error('[analytics/comercial/ranking-vendedores]', err);
    res.status(500).json({ error: 'Erro ao carregar ranking de vendedores' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/analytics/comercial/peso-por-vendedor-rota
// ─────────────────────────────────────────────────────────────────────────────
router.get('/comercial/peso-por-vendedor-rota', async (req, res) => {
  try {
    const pool = getPool();
    const { dt_inicio, dt_fim, situacao, id_vendedor, id_rota } = req.query;

    // --- base WHERE (pedidos) ---
    const baseWhere = [`COALESCE(p.excluido, 'N') = 'N'`];
    const baseParams = [];
    if (dt_inicio) { baseWhere.push('p.data_abertura >= ?'); baseParams.push(dt_inicio); }
    if (dt_fim)    { baseWhere.push('p.data_abertura <= ?'); baseParams.push(dt_fim); }
    if (situacao && situacao !== 'TODOS') { baseWhere.push('p.situacao_pedido = ?'); baseParams.push(situacao); }

    // visibilidade vendedor
    const vendScope = buildPedidosVendedorWhereSync(req, id_vendedor, 'p.id_usuario');
    if (vendScope.clause) {
      baseWhere.push(vendScope.clause.replace(/^ AND /, ''));
      baseParams.push(...vendScope.params);
    }

    // filtro de rota (via cliente)
    if (id_rota) { baseWhere.push('c.regiao = ?'); baseParams.push(id_rota); }

    const wClause = `WHERE ${baseWhere.join(' AND ')}`;

    // ── Por Vendedor ──────────────────────────────────────────────────────────
    // Subquery agrupa por pedido primeiro (peso + valor), depois agrupa por vendedor
    const [vendRows] = await pool.query(`
      SELECT
        COALESCE(u.nomeusu, 'Sem vendedor') AS nome_vendedor,
        sub.id_usuario,
        COUNT(*)            AS total_pedidos,
        SUM(sub.kg)         AS total_kg,
        SUM(sub.valor)      AS total_valor
      FROM (
        SELECT p.id, p.id_usuario,
          SUM(COALESCE(ip.quantidade, 0) * COALESCE(ip.peso, 0)) AS kg,
          MAX(COALESCE(p.vlrtotalpedido, 0))                      AS valor
        FROM pedidos p
        LEFT JOIN clientes c  ON p.cod_cliente = c.id
        LEFT JOIN itensped ip ON ip.id_pedido  = p.id
                              AND COALESCE(ip.excluido, 'N') = 'N'
        ${wClause}
        GROUP BY p.id, p.id_usuario
      ) sub
      LEFT JOIN usuarios u ON sub.id_usuario = u.idusuario
      GROUP BY sub.id_usuario, u.nomeusu
      ORDER BY total_kg DESC
    `, baseParams);

    // ── Por Rota ──────────────────────────────────────────────────────────────
    const [rotaRows] = await pool.query(`
      SELECT
        COALESCE(rr.descricao, 'Sem rota') AS nome_rota,
        sub.id_rota,
        COUNT(*)            AS total_pedidos,
        SUM(sub.kg)         AS total_kg,
        SUM(sub.valor)      AS total_valor
      FROM (
        SELECT p.id, c.regiao AS id_rota,
          SUM(COALESCE(ip.quantidade, 0) * COALESCE(ip.peso, 0)) AS kg,
          MAX(COALESCE(p.vlrtotalpedido, 0))                      AS valor
        FROM pedidos p
        LEFT JOIN clientes c  ON p.cod_cliente = c.id
        LEFT JOIN itensped ip ON ip.id_pedido  = p.id
                              AND COALESCE(ip.excluido, 'N') = 'N'
        ${wClause}
        GROUP BY p.id, c.regiao
      ) sub
      LEFT JOIN regiao_rota rr ON sub.id_rota = rr.id
      GROUP BY sub.id_rota, rr.descricao
      ORDER BY total_kg DESC
    `, baseParams);

    // ── Totais ────────────────────────────────────────────────────────────────
    const totalKg      = vendRows.reduce((s, r) => s + Number(r.total_kg    || 0), 0);
    const totalPedidos = vendRows.reduce((s, r) => s + Number(r.total_pedidos || 0), 0);
    const totalValor   = vendRows.reduce((s, r) => s + Number(r.total_valor  || 0), 0);

    res.json({
      por_vendedor: vendRows.map(r => ({
        nome_vendedor: r.nome_vendedor,
        total_pedidos: Number(r.total_pedidos),
        total_kg:      Number(Number(r.total_kg).toFixed(3)),
        total_valor:   Number(Number(r.total_valor).toFixed(2)),
        pct_kg:        totalKg > 0 ? Number((Number(r.total_kg) / totalKg * 100).toFixed(1)) : 0,
      })),
      por_rota: rotaRows.map(r => ({
        nome_rota:     r.nome_rota,
        total_pedidos: Number(r.total_pedidos),
        total_kg:      Number(Number(r.total_kg).toFixed(3)),
        total_valor:   Number(Number(r.total_valor).toFixed(2)),
        pct_kg:        totalKg > 0 ? Number((Number(r.total_kg) / totalKg * 100).toFixed(1)) : 0,
      })),
      totais: {
        total_kg:           Number(totalKg.toFixed(3)),
        total_pedidos:      totalPedidos,
        total_valor:        Number(totalValor.toFixed(2)),
        media_kg_por_pedido: totalPedidos > 0 ? Number((totalKg / totalPedidos).toFixed(3)) : 0,
      },
      canPickOthers: vendScope.canPickOthers,
    });
  } catch (err) {
    console.error('[analytics/peso-por-vendedor-rota]', err);
    res.status(500).json({ error: 'Erro ao gerar relatório de peso' });
  }
});

module.exports = router;
