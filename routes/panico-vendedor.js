/**
 * Pânico do Vendedor — análise de cobertura e alertas regionais
 * GET /api/panico-vendedor/analise
 */
const express = require('express');
const router  = express.Router();
const { getPool } = require('../config/database');

// Regiões descobertas, clientes inativos geolocalizados, heatmap de faturamento
router.get('/analise', async (req, res) => {
  try {
    const pool = getPool();
    const { vendedor_id, dias_inatividade = 90 } = req.query;
    const diasInativ = parseInt(dias_inatividade, 10) || 90;

    // Cláusulas de vendedor para cada tabela
    const vendedorPedidoClause  = vendedor_id ? `AND p.id_usuario = ${pool.escape(vendedor_id)}`    : '';
    const vendedorVisitaClause  = vendedor_id ? `AND v.id_vendedor = ${pool.escape(vendedor_id)}`   : '';
    const vendedorClienteClause = vendedor_id ? `AND c.cod_vendedor = ${pool.escape(vendedor_id)}`  : '';

    // Clientes inativos com geocoordenadas
    const [clientesInativos] = await pool.query(`
      SELECT
        c.id, c.nome, c.cidade, c.uf,
        c.latitude, c.longitude,
        DATEDIFF(CURDATE(), MAX(p.data_abertura)) AS dias_sem_compra,
        SUM(p.vlrtotalpedido) AS faturamento_12m
      FROM clientes c
      LEFT JOIN pedidos p ON p.cod_cliente = c.id
        AND p.data_abertura >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
        AND COALESCE(p.excluido, 'N') = 'N'
        ${vendedorPedidoClause}
      WHERE (c.excluido = 'N' OR c.excluido IS NULL OR c.excluido = '')
        AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
        AND c.latitude <> 0 AND c.longitude <> 0
        ${vendedorClienteClause}
      GROUP BY c.id, c.nome, c.cidade, c.uf, c.latitude, c.longitude
      HAVING dias_sem_compra >= ${pool.escape(diasInativ)}
         OR MAX(p.data_abertura) IS NULL
      ORDER BY dias_sem_compra DESC
      LIMIT 200
    `).catch(() => [[]]);

    // Faturamento por cidade (para heatmap)
    const [porCidade] = await pool.query(`
      SELECT
        c.cidade, c.uf,
        AVG(c.latitude)  AS lat,
        AVG(c.longitude) AS lng,
        COUNT(DISTINCT p.id)          AS total_pedidos,
        COUNT(DISTINCT p.cod_cliente) AS clientes_ativos,
        SUM(p.vlrtotalpedido)         AS faturamento,
        AVG(p.vlrtotalpedido)         AS ticket_medio,
        DATEDIFF(CURDATE(), MAX(p.data_abertura)) AS dias_ultima_compra
      FROM pedidos p
      INNER JOIN clientes c ON c.id = p.cod_cliente
      WHERE COALESCE(p.excluido, 'N') = 'N'
        AND p.data_abertura >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
        AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
        AND c.latitude <> 0 AND c.longitude <> 0
        ${vendedorPedidoClause}
      GROUP BY c.cidade, c.uf
      ORDER BY faturamento DESC
      LIMIT 100
    `).catch(() => [[]]);

    // Regiões sem nenhuma visita nos últimos N dias
    const [semVisita] = await pool.query(`
      SELECT
        c.cidade, c.uf,
        COUNT(DISTINCT c.id) AS total_clientes,
        MAX(v.data_visita)   AS ultima_visita,
        DATEDIFF(CURDATE(), MAX(v.data_visita)) AS dias_sem_visita
      FROM clientes c
      LEFT JOIN visitas v ON v.id_cliente = c.id AND v.exluido = 'N'
        ${vendedorVisitaClause}
      WHERE (c.excluido = 'N' OR c.excluido IS NULL OR c.excluido = '')
        AND c.cidade IS NOT NULL AND c.cidade <> ''
      GROUP BY c.cidade, c.uf
      HAVING dias_sem_visita >= ${pool.escape(diasInativ)} OR ultima_visita IS NULL
      ORDER BY total_clientes DESC
      LIMIT 50
    `).catch(() => [[]]);

    // Alertas críticos gerados
    const alertas = [];
    const inativosTotal = clientesInativos.length;

    if (inativosTotal > 0) {
      alertas.push({
        tipo: 'danger',
        icone: '🔴',
        mensagem: `${inativosTotal} cliente${inativosTotal > 1 ? 's' : ''} sem compra há mais de ${diasInativ} dias`,
        valor: inativosTotal,
      });
    }
    semVisita.slice(0, 3).forEach(sv => {
      if (sv.total_clientes >= 2) {
        alertas.push({
          tipo: 'warn',
          icone: '⚠️',
          mensagem: `${sv.cidade}/${sv.uf}: ${sv.total_clientes} clientes sem visita há ${sv.dias_sem_visita || '60+'} dias`,
          valor: sv.total_clientes,
        });
      }
    });

    // Cidades com queda de faturamento vs período anterior
    const [quedaCidades] = await pool.query(`
      SELECT
        c.cidade, c.uf,
        SUM(CASE WHEN p.data_abertura >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH) THEN p.vlrtotalpedido ELSE 0 END) AS fat_atual,
        SUM(CASE WHEN p.data_abertura  < DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
                 AND p.data_abertura  >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH) THEN p.vlrtotalpedido ELSE 0 END) AS fat_anterior
      FROM pedidos p
      INNER JOIN clientes c ON c.id = p.cod_cliente
      WHERE COALESCE(p.excluido, 'N') = 'N'
        AND p.data_abertura >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
        ${vendedorPedidoClause}
      GROUP BY c.cidade, c.uf
      HAVING fat_anterior > 0 AND fat_atual < fat_anterior * 0.8
      ORDER BY (fat_anterior - fat_atual) DESC
      LIMIT 5
    `).catch(() => [[]]);

    quedaCidades.forEach(q => {
      const queda = Math.round(((q.fat_anterior - q.fat_atual) / q.fat_anterior) * 100);
      alertas.push({
        tipo: 'warn',
        icone: '📉',
        mensagem: `${q.cidade}/${q.uf}: queda de ${queda}% no faturamento nos últimos 3 meses`,
        valor: queda,
      });
    });

    res.json({
      clientes_inativos: clientesInativos.map(c => ({
        id: c.id,
        nome: c.nome,
        cidade: c.cidade,
        uf: c.uf,
        lat: parseFloat(c.latitude),
        lng: parseFloat(c.longitude),
        dias_sem_compra: c.dias_sem_compra || 999,
        faturamento_12m: parseFloat(c.faturamento_12m || 0),
        nivel: c.dias_sem_compra > 180 ? 'critical' : c.dias_sem_compra > 90 ? 'danger' : 'warn',
      })),
      heatmap_cidades: porCidade.map(c => ({
        cidade: c.cidade,
        uf: c.uf,
        lat: parseFloat(c.lat || 0),
        lng: parseFloat(c.lng || 0),
        faturamento: parseFloat(c.faturamento || 0),
        clientes: c.clientes_ativos || 0,
        pedidos: c.total_pedidos || 0,
        ticket_medio: parseFloat(c.ticket_medio || 0),
        dias_ultima_compra: c.dias_ultima_compra || 0,
        intensidade: Math.min(1, parseFloat(c.faturamento || 0) / 100000),
      })),
      sem_visita: semVisita,
      alertas,
      totais: {
        clientes_inativos: inativosTotal,
        cidades_ativas: porCidade.length,
        cidades_sem_visita: semVisita.length,
      },
    });
  } catch (err) {
    console.error('[panico-vendedor]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
