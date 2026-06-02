const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');
const { resolveNaturezaLabelColumn, naturezaLabelExpr } = require('../config/natureza-label');

// GET /api/dre?dt_inicio=YYYY-MM-DD&dt_fim=YYYY-MM-DD
router.get('/', async (req, res) => {
  const pool = getPool();
  const { dt_inicio, dt_fim } = req.query;

  if (!dt_inicio || !dt_fim) {
    return res.status(400).json({ error: 'dt_inicio e dt_fim são obrigatórios' });
  }

  try {
    await resolveNaturezaLabelColumn(pool);
    const natLabel = naturezaLabelExpr('n');

    // 1. Faturamento pedidos aprovados
    const [[fat]] = await pool.query(
      `SELECT COALESCE(SUM(vlrtotalpedido), 0) AS total
       FROM pedidos
       WHERE tipo_pedido = 'PEDIDO'
         AND situacao_pedido IN ('APROVADO','FATURADO')
         AND excluido = 'N'
         AND data_abertura BETWEEN ? AND ?`,
      [dt_inicio, dt_fim]
    );

    // 2. Cancelamentos no período
    const [[canc]] = await pool.query(
      `SELECT COALESCE(SUM(vlrtotalpedido), 0) AS total
       FROM pedidos
       WHERE tipo_pedido = 'PEDIDO'
         AND situacao_pedido = 'CANCELADO'
         AND excluido = 'N'
         AND data_abertura BETWEEN ? AND ?`,
      [dt_inicio, dt_fim]
    );

    // 3. Comissões pagas no período
    const [[comm]] = await pool.query(
      `SELECT COALESCE(SUM(vlr_pago), 0) AS total
       FROM pagtocomissao
       WHERE status = 'C'
         AND excluido = 'N'
         AND data_lancamento BETWEEN ? AND ?`,
      [dt_inicio, dt_fim]
    );

    // 4. Despesas pagas no período (contas a pagar liquidadas)
    const [[desp]] = await pool.query(
      `SELECT COALESCE(SUM(vlrpago), 0) AS total
       FROM pagar
       WHERE status = 'LIQUIDADO'
         AND excluido = 'N'
         AND data_pagto BETWEEN ? AND ?`,
      [dt_inicio, dt_fim]
    );

    // 5. Despesas por natureza
    const [despPorNat] = await pool.query(
      `SELECT ${natLabel} AS natureza, COALESCE(SUM(p.vlrpago), 0) AS total
       FROM pagar p
       LEFT JOIN natureza n ON n.id = p.id_natureza
       WHERE p.status = 'LIQUIDADO'
         AND p.excluido = 'N'
         AND p.data_pagto BETWEEN ? AND ?
       GROUP BY p.id_natureza, ${natLabel}
       ORDER BY total DESC`,
      [dt_inicio, dt_fim]
    );

    // 6. Posição financeira atual (em aberto)
    const [[aRec]] = await pool.query(
      `SELECT COALESCE(SUM(valor), 0) AS total
       FROM receber
       WHERE status = 'ABERTA'
         AND (excluido = 'N' OR excluido IS NULL OR excluido = '')`
    );
    const [[aPag]] = await pool.query(
      `SELECT COALESCE(SUM(valor), 0) AS total
       FROM pagar
       WHERE status = 'ABERTA'
         AND excluido = 'N'`
    );

    // 7. Evolução mensal (últimos 12 meses)
    const [evolucao] = await pool.query(`
      SELECT
        DATE_FORMAT(mes, '%Y-%m') AS mes,
        SUM(faturamento) AS faturamento,
        SUM(cancelamentos) AS cancelamentos,
        SUM(despesas) AS despesas,
        SUM(comissoes) AS comissoes
      FROM (
        SELECT DATE_FORMAT(data_abertura, '%Y-%m-01') AS mes,
               COALESCE(vlrtotalpedido, 0) AS faturamento, 0 AS cancelamentos,
               0 AS despesas, 0 AS comissoes
        FROM pedidos
        WHERE tipo_pedido = 'PEDIDO' AND situacao_pedido IN ('APROVADO','FATURADO')
          AND excluido = 'N'
          AND data_abertura >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 11 MONTH), '%Y-%m-01')
        UNION ALL
        SELECT DATE_FORMAT(data_abertura, '%Y-%m-01') AS mes,
               0, COALESCE(vlrtotalpedido, 0), 0, 0
        FROM pedidos
        WHERE tipo_pedido = 'PEDIDO' AND situacao_pedido = 'CANCELADO'
          AND excluido = 'N'
          AND data_abertura >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 11 MONTH), '%Y-%m-01')
        UNION ALL
        SELECT DATE_FORMAT(data_pagto, '%Y-%m-01') AS mes,
               0, 0, COALESCE(vlrpago, 0), 0
        FROM pagar
        WHERE status = 'LIQUIDADO' AND excluido = 'N'
          AND data_pagto >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 11 MONTH), '%Y-%m-01')
        UNION ALL
        SELECT DATE_FORMAT(data_lancamento, '%Y-%m-01') AS mes,
               0, 0, 0, COALESCE(vlr_pago, 0)
        FROM pagtocomissao
        WHERE status = 'C' AND excluido = 'N'
          AND data_lancamento >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 11 MONTH), '%Y-%m-01')
      ) t
      GROUP BY mes
      ORDER BY mes ASC
    `);

    const faturamento = parseFloat(fat.total);
    const cancelamentos = parseFloat(canc.total);
    const receitaLiquida = faturamento - cancelamentos;
    const comissoes = parseFloat(comm.total);
    const despesas = parseFloat(desp.total);
    const resultado = receitaLiquida - comissoes - despesas;

    res.json({
      periodo: { dt_inicio, dt_fim },
      receita: { faturamento, cancelamentos, receita_liquida: receitaLiquida },
      despesas: {
        comissoes,
        operacional: despesas,
        por_natureza: despPorNat.map(r => ({
          natureza: r.natureza || 'Não classificado',
          total: parseFloat(r.total),
        })),
      },
      resultado,
      posicao: {
        a_receber: parseFloat(aRec.total),
        a_pagar: parseFloat(aPag.total),
        saldo: parseFloat(aRec.total) - parseFloat(aPag.total),
      },
      evolucao: evolucao.map(r => ({
        mes: r.mes,
        faturamento: parseFloat(r.faturamento),
        cancelamentos: parseFloat(r.cancelamentos),
        despesas: parseFloat(r.despesas),
        comissoes: parseFloat(r.comissoes),
        resultado: parseFloat(r.faturamento) - parseFloat(r.cancelamentos)
                 - parseFloat(r.despesas) - parseFloat(r.comissoes),
      })),
    });
  } catch (err) {
    console.error('DRE error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
