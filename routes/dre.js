const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');
const {
  resolveDespesasLabelColumn,
  despesasLabelExpr,
} = require('../config/despesas-label');
const { ensureFinanceiroContabilCols } = require('../config/plano-contas-schema');

// GET /api/dre?dt_inicio=YYYY-MM-DD&dt_fim=YYYY-MM-DD
router.get('/', async (req, res) => {
  const pool = getPool();
  const { dt_inicio, dt_fim } = req.query;

  if (!dt_inicio || !dt_fim) {
    return res.status(400).json({ error: 'dt_inicio e dt_fim são obrigatórios' });
  }

  try {
    await ensureFinanceiroContabilCols(pool);
    await resolveDespesasLabelColumn(pool);
    const despLabel = despesasLabelExpr('d');

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
       WHERE status IN ('LIQUIDADO','PAGO','BAIXADO','QUITADO')
         AND (excluido = 'N' OR excluido IS NULL OR excluido = '')
         AND data_pagto BETWEEN ? AND ?`,
      [dt_inicio, dt_fim]
    );

    // 5. Despesas por categoria (tabela despesas / id_despesas — não id_natureza)
    const [despPorNat] = await pool.query(
      `SELECT ${despLabel} AS natureza, COALESCE(SUM(p.vlrpago), 0) AS total
       FROM pagar p
       LEFT JOIN despesas d ON d.id = p.id_despesas
       WHERE p.status IN ('LIQUIDADO','PAGO','BAIXADO','QUITADO')
         AND (p.excluido = 'N' OR p.excluido IS NULL OR p.excluido = '')
         AND p.data_pagto BETWEEN ? AND ?
       GROUP BY p.id_despesas, ${despLabel}
       ORDER BY total DESC`,
      [dt_inicio, dt_fim]
    );

    // 5b. Despesas por plano de contas (override no título ou conta da despesa)
    const [despPorConta] = await pool.query(
      `SELECT
         COALESCE(pc.numero, '') AS numero,
         COALESCE(pc.descricao, 'Sem conta contábil') AS conta,
         COALESCE(pc.grupo, 'OUTROS') AS grupo,
         COALESCE(SUM(p.vlrpago), 0) AS total
       FROM pagar p
       LEFT JOIN despesas d ON d.id = p.id_despesas
       LEFT JOIN plano_contas pc ON pc.id = COALESCE(p.id_planoconta, d.id_planoconta)
       WHERE p.status IN ('LIQUIDADO','PAGO','BAIXADO','QUITADO')
         AND (p.excluido = 'N' OR p.excluido IS NULL OR p.excluido = '')
         AND p.data_pagto BETWEEN ? AND ?
       GROUP BY COALESCE(p.id_planoconta, d.id_planoconta), pc.numero, pc.descricao, pc.grupo
       ORDER BY total DESC`,
      [dt_inicio, dt_fim]
    );

    // 6. Posição financeira atual (em aberto)
    const [[aRec]] = await pool.query(
      `SELECT COALESCE(SUM(valor), 0) AS total
       FROM receber
       WHERE status IN ('ABERTA','ABERTO')
         AND (excluido = 'N' OR excluido IS NULL OR excluido = '')`
    );
    const [[aPag]] = await pool.query(
      `SELECT COALESCE(SUM(valor), 0) AS total
       FROM pagar
       WHERE status IN ('ABERTA','ABERTO')
         AND (excluido = 'N' OR excluido IS NULL OR excluido = '')`
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
        WHERE status IN ('LIQUIDADO','PAGO','BAIXADO','QUITADO')
          AND (excluido = 'N' OR excluido IS NULL OR excluido = '')
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
        por_planoconta: despPorConta.map(r => ({
          numero: r.numero || '',
          conta: r.conta || 'Sem conta contábil',
          grupo: r.grupo || 'OUTROS',
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
