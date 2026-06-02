const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');

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

        // 5. Composição de Despesas (Top 5 Categorias)
        const [despesasPorCategoria] = await pool.query(`
            SELECT n.nome as categoria, SUM(p.valor) as total
            FROM pagar p
            LEFT JOIN natureza n ON p.id_natureza = n.id
            WHERE p.excluido = 'N'
            GROUP BY n.nome
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

        const [maiorDespesa] = await pool.query(`
            SELECT n.nome, SUM(p.valor) as total
            FROM pagar p
            JOIN natureza n ON p.id_natureza = n.id
            WHERE p.excluido = 'N' AND p.vencimento >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
            GROUP BY n.nome ORDER BY total DESC LIMIT 1
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
