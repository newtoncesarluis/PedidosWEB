const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');
const {
  resolveDespesasLabelColumn,
  despesasLabelExpr,
} = require('../config/despesas-label');
const { ensureFinanceiroContabilCols } = require('../config/plano-contas-schema');

/**
 * Endpoint principal do BI Financeiro
 * Retorna KPIs consolidados, aging list e dados para gráficos.
 */
router.get('/dashboard', async (req, res) => {
    const pool = getPool();
    try {
        // 1. KPIs de Resumo
        // Saldo Acumulado (Recebido - Pago)
        const [recebidoTotal] = await pool.query("SELECT SUM(valor_pago) as total FROM receber WHERE (status = 'LIQUIDADO' OR status = 'RECEBIDO') AND excluido = 'N'");
        const [pagoTotal] = await pool.query("SELECT SUM(vlrpago) as total FROM pagar WHERE status = 'LIQUIDADO' AND excluido = 'N'");
        
        const saldoAtual = (parseFloat(recebidoTotal[0]?.total || 0)) - (parseFloat(pagoTotal[0]?.total || 0));

        // Aberto (A Receber e A Pagar)
        const [abertoReceber] = await pool.query("SELECT SUM(valor) as total FROM receber WHERE status = 'ABERTA' AND excluido = 'N'");
        const [abertoPagar] = await pool.query("SELECT SUM(valor) as total FROM pagar WHERE status = 'ABERTA' AND excluido = 'N'");

        // Inadimplência (Vencidos / Total Aberto)
        const [vencidoReceber] = await pool.query("SELECT SUM(valor) as total FROM receber WHERE status = 'ABERTA' AND vencimento < CURDATE() AND excluido = 'N'");
        const inadimplencia = abertoReceber[0]?.total > 0 ? (vencidoReceber[0]?.total / abertoReceber[0]?.total) * 100 : 0;

        // 2. Dados para Gráfico de Fluxo (Últimos 30 dias) com Saldo Acumulado
        const [fluxoHistorico] = await pool.query(`
            SELECT 
                data_ref,
                SUM(entrada) as entradas,
                SUM(saida) as saidas
            FROM (
                SELECT data_pagto as data_ref, valor_pago as entrada, 0 as saida FROM receber 
                WHERE (status = 'LIQUIDADO' OR status = 'RECEBIDO') AND excluido = 'N' AND data_pagto >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
                UNION ALL
                SELECT data_pagto as data_ref, 0 as entrada, vlrpago as saida FROM pagar 
                WHERE status = 'LIQUIDADO' AND excluido = 'N' AND data_pagto >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
            ) as union_caixa
            GROUP BY data_ref
            ORDER BY data_ref ASC
        `);

        // Calcular saldo acumulado para o gráfico
        let saldoAcumulado = saldoAtual - fluxoHistorico.reduce((acc, curr) => acc + (curr.entradas - curr.saidas), 0);
        const fluxoComSaldo = fluxoHistorico.map(f => {
            saldoAcumulado += (f.entradas - f.saidas);
            return { ...f, saldo_dia: saldoAcumulado };
        });

        // 3. Projeção Futura (Próximos 30 dias)
        const [projecao] = await pool.query(`
            SELECT 
                vencimento as data_ref,
                SUM(entrada) as entradas,
                SUM(saida) as saidas
            FROM (
                SELECT vencimento, valor as entrada, 0 as saida FROM receber 
                WHERE status = 'ABERTA' AND excluido = 'N' AND vencimento BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)
                UNION ALL
                SELECT vencimento, 0 as entrada, valor as saida FROM pagar 
                WHERE status = 'ABERTA' AND excluido = 'N' AND vencimento BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)
            ) as union_proj
            GROUP BY vencimento
            ORDER BY vencimento ASC
        `);

        // 4. Aging List (Receber)
        const [agingReceber] = await pool.query(`
            SELECT 
                CASE 
                    WHEN DATEDIFF(CURDATE(), vencimento) <= 30 THEN '0-30 dias'
                    WHEN DATEDIFF(CURDATE(), vencimento) <= 60 THEN '31-60 dias'
                    ELSE '60+ dias'
                END as faixa,
                SUM(valor) as total
            FROM receber
            WHERE status = 'ABERTA' AND vencimento < CURDATE() AND excluido = 'N'
            GROUP BY faixa
        `);

        // 5. Composição de Despesas — prioriza Plano de Contas; fallback Despesa (id_despesas)
        await ensureFinanceiroContabilCols(pool);
        await resolveDespesasLabelColumn(pool);
        const despLabel = despesasLabelExpr('d');
        const [despesasPorCategoria] = await pool.query(`
            SELECT
              COALESCE(
                NULLIF(TRIM(CONCAT_WS(' — ', NULLIF(TRIM(pc.numero), ''), NULLIF(TRIM(pc.descricao), ''))), ''),
                ${despLabel},
                'Não classificado'
              ) AS categoria,
              SUM(p.valor) AS total
            FROM pagar p
            LEFT JOIN despesas d ON d.id = p.id_despesas
            LEFT JOIN plano_contas pc ON pc.id = COALESCE(p.id_planoconta, d.id_planoconta)
            WHERE (p.excluido = 'N' OR p.excluido IS NULL OR p.excluido = '')
            GROUP BY categoria
            ORDER BY total DESC
            LIMIT 5
        `);

        res.json({
            kpis: {
                saldoAtual,
                totalReceber: parseFloat(abertoReceber[0]?.total || 0),
                totalPagar: parseFloat(abertoPagar[0]?.total || 0),
                inadimplencia: parseFloat(inadimplencia.toFixed(2)),
                projetado30: (parseFloat(abertoReceber[0]?.total || 0)) - (parseFloat(abertoPagar[0]?.total || 0)) // Simplificado
            },
            graficos: {
                fluxo: fluxoComSaldo,
                projecao: projecao,
                aging: agingReceber,
                categorias: despesasPorCategoria
            }
        });
    } catch (err) {
        console.error('[financeiro/dashboard]', err);
        res.status(500).json({ error: 'Erro ao processar dados do dashboard financeiro' });
    }
});

/**
 * Previsão de caixa consolidada (somente leitura).
 * GET /api/financeiro/previsao?dias=30
 * Despesas abertas (plano + centro) + recebimentos previstos + saldo bancário → saldo projetado.
 */
router.get('/previsao', async (req, res) => {
  const pool = getPool();
  try {
    await ensureFinanceiroContabilCols(pool);
    await resolveDespesasLabelColumn(pool);
    const dias = Math.min(180, Math.max(7, parseInt(req.query.dias, 10) || 30));
    const despLabel = despesasLabelExpr('d');

    const [[saldoBancos]] = await pool.query(
      `SELECT COALESCE(SUM(COALESCE(saldo,0)),0) AS total
         FROM bancos
        WHERE (excluido='N' OR excluido IS NULL OR excluido='')
          AND (status='A' OR status IS NULL OR status='')`
    ).catch(() => [[{ total: 0 }]]);

    const [despesas] = await pool.query(`
      SELECT
        COALESCE(
          NULLIF(TRIM(CONCAT_WS(' — ', NULLIF(TRIM(pc.numero), ''), NULLIF(TRIM(pc.descricao), ''))), ''),
          ${despLabel},
          'Não classificado'
        ) AS plano_contas,
        COALESCE(NULLIF(TRIM(cc.descricao), ''), '—') AS centro_custo,
        p.vencimento,
        p.valor,
        p.doc,
        p.nome_fornecedor,
        p.obs
      FROM pagar p
      LEFT JOIN despesas d ON d.id = p.id_despesas
      LEFT JOIN plano_contas pc ON pc.id = COALESCE(p.id_planoconta, d.id_planoconta)
      LEFT JOIN centro_custo cc ON cc.id = p.id_centrocusto
      WHERE (p.excluido='N' OR p.excluido IS NULL OR p.excluido='')
        AND p.status = 'ABERTA'
        AND p.vencimento BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
      ORDER BY p.vencimento, plano_contas
    `, [dias]);

    const [recebimentos] = await pool.query(`
      SELECT r.vencimento, r.valor, r.doc,
             COALESCE(NULLIF(TRIM(c.nome), ''), NULLIF(TRIM(c.apelido), ''), r.nome_cliente, '') AS nome_cliente,
             r.obs
        FROM receber r
        LEFT JOIN clientes c ON c.id = r.cod_cliente
       WHERE (r.excluido='N' OR r.excluido IS NULL OR r.excluido='')
         AND r.status = 'ABERTA'
         AND r.vencimento BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
       ORDER BY r.vencimento
    `, [dias]).catch(() => [[]]);

    // Cheques em carteira (se tabela existir)
    let cheques = [];
    try {
      const [cols] = await pool.query(`SHOW TABLES LIKE 'cheques'`);
      if (cols.length) {
        const [ch] = await pool.query(`
          SELECT bom_para AS vencimento, valor, numero AS doc, emitente AS nome_cliente, 'CHEQUE' AS tipo
            FROM cheques
           WHERE excluido='N' AND status='EM_CARTEIRA'
             AND bom_para BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
           ORDER BY bom_para
        `, [dias]);
        cheques = ch;
      }
    } catch (_) {}

    // Faturas de cartão abertas ainda não geradas no pagar
    let faturasCartao = [];
    try {
      const [cols] = await pool.query(`SHOW TABLES LIKE 'cartao_faturas'`);
      if (cols.length) {
        const [ft] = await pool.query(`
          SELECT f.data_vencimento AS vencimento, f.valor_total AS valor,
                 CONCAT('FAT ', f.competencia) AS doc,
                 c.descricao AS nome_fornecedor, 'CARTAO' AS tipo
            FROM cartao_faturas f
            JOIN cartoes_corporativos c ON c.id = f.id_cartao
           WHERE f.excluido='N' AND f.status='ABERTA' AND (f.id_pagar IS NULL OR f.id_pagar=0)
             AND f.data_vencimento BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
           ORDER BY f.data_vencimento
        `, [dias]);
        faturasCartao = ft;
      }
    } catch (_) {}

    const totalDespesas = despesas.reduce((s, r) => s + (parseFloat(r.valor) || 0), 0)
      + faturasCartao.reduce((s, r) => s + (parseFloat(r.valor) || 0), 0);
    const totalReceber = recebimentos.reduce((s, r) => s + (parseFloat(r.valor) || 0), 0)
      + cheques.reduce((s, r) => s + (parseFloat(r.valor) || 0), 0);
    const saldoBancario = parseFloat(saldoBancos?.total) || 0;
    const saldoProjetado = saldoBancario + totalReceber - totalDespesas;

    // Série diária
    const map = new Map();
    const add = (data, ent, sai) => {
      const k = String(data).slice(0, 10);
      if (!map.has(k)) map.set(k, { data: k, entradas: 0, saidas: 0 });
      const row = map.get(k);
      row.entradas += ent;
      row.saidas += sai;
    };
    recebimentos.forEach((r) => add(r.vencimento, parseFloat(r.valor) || 0, 0));
    cheques.forEach((r) => add(r.vencimento, parseFloat(r.valor) || 0, 0));
    despesas.forEach((r) => add(r.vencimento, 0, parseFloat(r.valor) || 0));
    faturasCartao.forEach((r) => add(r.vencimento, 0, parseFloat(r.valor) || 0));

    let acum = saldoBancario;
    const serie = [...map.keys()].sort().map((k) => {
      const row = map.get(k);
      acum += row.entradas - row.saidas;
      return { ...row, saldo_projetado: Math.round(acum * 100) / 100 };
    });

    res.json({
      dias,
      saldo_bancario: saldoBancario,
      total_despesas: Math.round(totalDespesas * 100) / 100,
      total_recebimentos: Math.round(totalReceber * 100) / 100,
      saldo_projetado: Math.round(saldoProjetado * 100) / 100,
      despesas,
      faturas_cartao: faturasCartao,
      recebimentos,
      cheques_carteira: cheques,
      serie,
    });
  } catch (err) {
    console.error('[financeiro/previsao]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Insights inteligentes baseados em IA (Regras de negócio)
 */
router.get('/insights', async (req, res) => {
    const pool = getPool();
    try {
        const insights = [];

        // 1. Verificação de Saldo Futuro Crítico
        const [proj] = await pool.query(`
            SELECT 
                vencimento,
                SUM(CASE WHEN tipo='R' THEN valor ELSE -valor END) as saldo_dia
            FROM (
                SELECT vencimento, valor, 'R' as tipo FROM receber WHERE status = 'ABERTA' AND excluido = 'N'
                UNION ALL
                SELECT vencimento, valor, 'P' as tipo FROM pagar WHERE status = 'ABERTA' AND excluido = 'N'
            ) as t
            WHERE vencimento BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 15 DAY)
            GROUP BY vencimento ORDER BY vencimento
        `);

        // 2. Análise de Inadimplência Crescente
        const [inadHist] = await pool.query(`
            SELECT 
                MONTH(vencimento) as mes,
                SUM(CASE WHEN status = 'ABERTA' AND vencimento < CURDATE() THEN valor ELSE 0 END) as vencido,
                SUM(valor) as total
            FROM receber
            WHERE excluido = 'N' AND vencimento >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
            GROUP BY mes
        `);

        // Lógica de geração de insights
        if (proj.some(p => p.saldo_dia < 0)) {
            insights.push({
                tipo: 'danger',
                titulo: 'Alerta de Fluxo de Caixa',
                mensagem: 'Identificamos dias com saldo projetado negativo nos próximos 15 dias. Considere antecipar recebíveis.'
            });
        }

        await ensureFinanceiroContabilCols(pool);
        await resolveDespesasLabelColumn(pool);
        const despLabelInsight = despesasLabelExpr('d');
        const [maiorDespesa] = await pool.query(`
            SELECT
              COALESCE(
                NULLIF(TRIM(CONCAT_WS(' — ', NULLIF(TRIM(pc.numero), ''), NULLIF(TRIM(pc.descricao), ''))), ''),
                ${despLabelInsight},
                'Não classificado'
              ) AS nome,
              SUM(p.valor) AS total
            FROM pagar p
            LEFT JOIN despesas d ON d.id = p.id_despesas
            LEFT JOIN plano_contas pc ON pc.id = COALESCE(p.id_planoconta, d.id_planoconta)
            WHERE (p.excluido = 'N' OR p.excluido IS NULL OR p.excluido = '')
              AND p.vencimento >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
            GROUP BY nome
            ORDER BY total DESC
            LIMIT 1
        `);

        if (maiorDespesa[0]) {
            insights.push({
                tipo: 'info',
                titulo: 'Sugestão de Economia',
                mensagem: `A categoria "${maiorDespesa[0].nome}" representa o maior volume de saídas este mês. Uma redução de 10% aqui economizaria ${new Intl.NumberFormat('pt-BR', {style:'currency', currency:'BRL'}).format(maiorDespesa[0].total * 0.1)}.`
            });
        }

        res.json(insights);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao gerar insights' });
    }
});

/**
 * Listagem consolidada de movimentações (Pagar + Receber)
 */
router.get('/movimentacoes', async (req, res) => {
    const pool = getPool();
    const { dt_inicio, dt_fim, tipo } = req.query;

    let where = "WHERE 1=1";
    const params = [];
    if (dt_inicio && dt_fim) {
        where += " AND data_ref BETWEEN ? AND ?";
        params.push(dt_inicio, dt_fim);
    }

    try {
        const outerConds = [];
        if (dt_inicio && dt_fim) { outerConds.push('data_ref BETWEEN ? AND ?'); params.push(dt_inicio, dt_fim); }
        if (tipo && tipo !== 'all') { outerConds.push(`tipo_mov = '${tipo === 'receber' ? 'ENTRADA' : 'SAIDA'}'`); }

        const outerWhere = outerConds.length ? `WHERE ${outerConds.join(' AND ')}` : '';

        const query = `
            SELECT * FROM (
                SELECT id, 'RECEBER' as origem, nome_fornecedor as pessoa, doc, vencimento as data_ref, valor, status, 'ENTRADA' as tipo_mov FROM receber WHERE excluido = 'N'
                UNION ALL
                SELECT id, 'PAGAR' as origem, nome_fornecedor as pessoa, doc, vencimento as data_ref, valor, status, 'SAIDA' as tipo_mov FROM pagar WHERE excluido = 'N'
            ) as consolidado
            ${outerWhere}
            ORDER BY data_ref DESC
            LIMIT 200
        `;

        const [rows] = await pool.query(query, params);
        res.json(rows);
    } catch (err) {
        console.error('[financeiro/movimentacoes]', err);
        res.status(500).json({ error: 'Erro ao buscar movimentações' });
    }
});

module.exports = router;
