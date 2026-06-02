/**
 * Inteligência Comercial por Cliente
 * Analisa histórico real de compras e gera score + recomendações.
 * Nenhum dado é inventado: tudo vem do banco.
 */
const express = require('express');
const router  = express.Router();
const { getPool } = require('../config/database');

// ─── Helpers ─────────────────────────────────────────────────────────────────
const money = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function calcularScore({ recenciaDias, pedidosPorMes, ticketMedio, ticketCarteira, variacaoPct }) {
  // Recência (0-30)
  let r = 3;
  if (recenciaDias <= 30)       r = 30;
  else if (recenciaDias <= 60)  r = 25;
  else if (recenciaDias <= 90)  r = 18;
  else if (recenciaDias <= 180) r = 10;

  // Frequência (0-30)
  let f = 3;
  if (pedidosPorMes >= 2)        f = 30;
  else if (pedidosPorMes >= 1)   f = 25;
  else if (pedidosPorMes >= 0.5) f = 18;
  else if (pedidosPorMes >= 0.2) f = 10;

  // Valor vs. carteira (0-30)
  let v = 5;
  if (ticketCarteira > 0) {
    const ratio = ticketMedio / ticketCarteira;
    if (ratio >= 2)      v = 30;
    else if (ratio >= 1) v = 25;
    else if (ratio >= 0.7) v = 20;
    else if (ratio >= 0.4) v = 12;
  }

  // Tendência (0-10)
  let t = 0;
  if (variacaoPct > 20)       t = 10;
  else if (variacaoPct > 5)   t = 7;
  else if (variacaoPct >= -5) t = 5;
  else if (variacaoPct >= -20) t = 2;

  return Math.min(100, r + f + v + t);
}

function nivelRisco(score, recenciaDias) {
  if (score < 30 || recenciaDias > 180) return 'ALTO';
  if (score < 55 || recenciaDias > 90)  return 'MÉDIO';
  return 'BAIXO';
}

function gerarMensagemWhatsapp(dados) {
  const { nome, recenciaDias, ticketMedio, produtos, diasSemProduto } = dados;
  const primeiroNome = (nome || '').split(' ')[0];
  const lines = [];
  lines.push(`Olá ${primeiroNome}, tudo bem? 😊`);
  if (recenciaDias > 90) {
    lines.push(`Notei que faz ${recenciaDias} dias desde o seu último pedido conosco.`);
    lines.push(`Sentimos sua falta e gostaríamos de retomar nossa parceria!`);
  } else {
    lines.push(`Passando para manter contato e ver como podemos te atender melhor.`);
  }
  if (produtos?.length) {
    const p = produtos[0];
    lines.push(`\nTemos *${p.descricao}* com ótimas condições para você.`);
    if (diasSemProduto > 0) {
      lines.push(`Você comprava esse item regularmente — está precisando renovar o estoque?`);
    }
  }
  lines.push(`\nQual seria o melhor horário para conversarmos? 🤝`);
  return lines.join('\n');
}

function gerarRoteiroChamada(dados) {
  const { nome, recenciaDias, totalPedidos12m, ticketMedio, produtos } = dados;
  const primeiroNome = (nome || '').split(' ')[0];
  const linhas = [
    `📞 ROTEIRO DE LIGAÇÃO — ${nome.toUpperCase()}`,
    ``,
    `1. ABERTURA`,
    `   "Bom dia/tarde, ${primeiroNome}! Aqui é [SEU NOME] da [EMPRESA]."`,
    `   "Tudo bem com você e sua empresa?"`,
    ``,
    `2. CONTEXTO`,
  ];
  if (recenciaDias > 90) {
    linhas.push(`   "Percebi que faz ${recenciaDias} dias desde o seu último pedido."`);
    linhas.push(`   "Queria entender se houve algum problema ou se posso te ajudar com algo."`);
  } else {
    linhas.push(`   "Você costuma fazer em média ${totalPedidos12m} pedidos nos últimos 12 meses."`);
    linhas.push(`   "Gostaria de saber se está satisfeito com nosso atendimento."`);
  }
  linhas.push(``);
  linhas.push(`3. OFERTA`);
  if (produtos?.length) {
    linhas.push(`   "Tenho algumas novidades que combinam muito com o que você costuma comprar:"`);
    produtos.slice(0, 3).forEach(p => linhas.push(`   • ${p.descricao}`));
  }
  linhas.push(`   "Posso te enviar uma proposta personalizada agora?"`);
  linhas.push(``);
  linhas.push(`4. FECHAMENTO`);
  linhas.push(`   "Qual seria a melhor data para entrega/visita?"`);
  linhas.push(`   "Vou te enviar o orçamento pelo WhatsApp ainda hoje."`);
  return linhas.join('\n');
}

function gerarEmailComercial(dados) {
  const { nome, empresa, recenciaDias, produtos } = dados;
  const primeiroNome = (nome || '').split(' ')[0];
  return `Assunto: Proposta Exclusiva para ${empresa || nome}

Olá ${primeiroNome},

Esperamos que esteja bem!

${recenciaDias > 90
  ? `Gostaríamos de retomar nossa parceria comercial. Sabemos que cada centavo conta para o seu negócio e trabalhamos constantemente para oferecer as melhores condições.`
  : `Entramos em contato para apresentar oportunidades que se encaixam perfeitamente no seu perfil de compras.`
}

Com base no seu histórico conosco, selecionamos alguns produtos que acreditamos ser de seu interesse:

${(produtos || []).slice(0, 4).map((p, i) => `${i + 1}. ${p.descricao}${p.motivo ? ' — ' + p.motivo : ''}`).join('\n')}

Podemos elaborar um orçamento personalizado ou agendar uma visita de acordo com sua conveniência.

Aguardamos seu retorno!

Atenciosamente,
[SEU NOME]
[EMPRESA] | [TELEFONE]`;
}

// ─── GET /api/inteligencia/cliente/:id ───────────────────────────────────────
router.get('/cliente/:id', async (req, res) => {
  try {
    const pool = getPool();
    const idCliente = parseInt(req.params.id);
    if (!idCliente) return res.status(400).json({ error: 'ID inválido' });

    // 1. Dados básicos do cliente
    const [[cli]] = await pool.query(`
      SELECT c.id, c.nome, c.apelido, c.cidade, c.uf, c.regiao,
             c.foneprincipal, c.email, c.dtultimacompra,
             c.cod_vendedor, c.credito, c.desconto, c.conceitocliente,
             c.venda_suspensa, c.segmento,
             DATEDIFF(CURDATE(), c.dtultimacompra) AS dias_sem_compra,
             rr.descricao AS nome_regiao, rr.sigla AS sigla_regiao,
             u.nomeusu AS nome_vendedor
      FROM clientes c
      LEFT JOIN regiao_rota rr ON rr.id = c.regiao
      LEFT JOIN usuarios u ON u.idusuario = c.cod_vendedor
      WHERE c.id = ? AND (c.excluido='N' OR c.excluido IS NULL)
    `, [idCliente]);
    if (!cli) return res.status(404).json({ error: 'Cliente não encontrado' });

    // 2. Histórico de pedidos (últimos 24 meses)
    const [pedidos] = await pool.query(`
      SELECT p.id, p.numero, p.data_abertura, p.vlrtotalpedido,
             p.nome_fornecedor, p.situacao_pedido, p.tipo_pedido
      FROM pedidos p
      WHERE p.cod_cliente = ? AND p.excluido = 'N'
        AND p.tipo_pedido = 'PEDIDO'
        AND p.situacao_pedido NOT IN ('CANCELADO','RECUSADO')
        AND p.data_abertura >= DATE_SUB(CURDATE(), INTERVAL 24 MONTH)
      ORDER BY p.data_abertura DESC
      LIMIT 200
    `, [idCliente]);

    // 3. KPIs de compra
    const [[kpis12m]] = await pool.query(`
      SELECT
        COUNT(*) AS total_pedidos,
        SUM(vlrtotalpedido) AS total_comprado,
        AVG(vlrtotalpedido) AS ticket_medio,
        MIN(data_abertura) AS primeira_compra,
        MAX(data_abertura) AS ultima_compra
      FROM pedidos
      WHERE cod_cliente = ? AND excluido='N' AND tipo_pedido='PEDIDO'
        AND situacao_pedido NOT IN ('CANCELADO','RECUSADO')
        AND data_abertura >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
    `, [idCliente]);

    const [[kpis6m_atual]] = await pool.query(`
      SELECT COALESCE(SUM(vlrtotalpedido),0) AS total
      FROM pedidos
      WHERE cod_cliente=? AND excluido='N' AND tipo_pedido='PEDIDO'
        AND situacao_pedido NOT IN ('CANCELADO','RECUSADO')
        AND data_abertura BETWEEN DATE_SUB(CURDATE(),INTERVAL 6 MONTH) AND CURDATE()
    `, [idCliente]);

    const [[kpis6m_ant]] = await pool.query(`
      SELECT COALESCE(SUM(vlrtotalpedido),0) AS total
      FROM pedidos
      WHERE cod_cliente=? AND excluido='N' AND tipo_pedido='PEDIDO'
        AND situacao_pedido NOT IN ('CANCELADO','RECUSADO')
        AND data_abertura BETWEEN DATE_SUB(CURDATE(),INTERVAL 12 MONTH) AND DATE_SUB(CURDATE(),INTERVAL 6 MONTH)
    `, [idCliente]);

    // 4. Produtos mais comprados (12 meses)
    const [produtosMaisComprados] = await pool.query(`
      SELECT ip.cod_produto AS codproduto, ip.desc_prod AS descricao,
             SUM(ip.quantidade) AS qtd_total,
             SUM(ip.vlrtotal_itens) AS valor_total,
             COUNT(DISTINCT p.numero) AS em_pedidos,
             MAX(p.data_abertura) AS ultima_compra_prod,
             DATEDIFF(CURDATE(), MAX(p.data_abertura)) AS dias_sem_comprar
      FROM itensped ip
      JOIN pedidos p ON p.numero = ip.numpedido
      WHERE p.cod_cliente = ? AND p.excluido='N' AND p.tipo_pedido='PEDIDO'
        AND p.situacao_pedido NOT IN ('CANCELADO','RECUSADO')
        AND p.data_abertura >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
      GROUP BY ip.cod_produto, ip.desc_prod
      ORDER BY valor_total DESC
      LIMIT 20
    `, [idCliente]);

    // 5. Produtos que o cliente parou de comprar (comprou antes, não compra há 90d+)
    const [produtosParou] = await pool.query(`
      SELECT ip.cod_produto AS codproduto, ip.desc_prod AS descricao,
             MAX(p.data_abertura) AS ultima_compra,
             DATEDIFF(CURDATE(), MAX(p.data_abertura)) AS dias_parado,
             SUM(ip.quantidade) AS qtd_historico
      FROM itensped ip
      JOIN pedidos p ON p.numero = ip.numpedido
      WHERE p.cod_cliente = ? AND p.excluido='N' AND p.tipo_pedido='PEDIDO'
        AND p.situacao_pedido NOT IN ('CANCELADO','RECUSADO')
      GROUP BY ip.cod_produto, ip.desc_prod
      HAVING MAX(p.data_abertura) < DATE_SUB(CURDATE(), INTERVAL 90 DAY)
         AND MAX(p.data_abertura) >= DATE_SUB(CURDATE(), INTERVAL 18 MONTH)
      ORDER BY dias_parado ASC
      LIMIT 10
    `, [idCliente]);

    // 6. Produtos comprados por clientes similares (mesma região) mas nunca por este
    const regiaoFiltro = cli.regiao ? `AND c2.regiao = ${pool.escape(cli.regiao)}` : '';
    const [produtosComplementares] = await pool.query(`
      SELECT ip.cod_produto AS codproduto, ip.desc_prod AS descricao,
             COUNT(DISTINCT p.cod_cliente) AS clientes_que_compram,
             SUM(ip.quantidade) AS qtd_total
      FROM itensped ip
      JOIN pedidos p ON p.numero = ip.numpedido
      JOIN clientes c2 ON c2.id = p.cod_cliente
      WHERE p.excluido='N' AND p.tipo_pedido='PEDIDO'
        AND p.situacao_pedido NOT IN ('CANCELADO','RECUSADO')
        AND p.cod_cliente != ?
        ${regiaoFiltro}
        AND p.data_abertura >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
        AND ip.cod_produto NOT IN (
          SELECT DISTINCT ip2.cod_produto
          FROM itensped ip2
          JOIN pedidos p2 ON p2.numero = ip2.numpedido
          WHERE p2.cod_cliente = ? AND p2.excluido='N'
        )
      GROUP BY ip.cod_produto, ip.desc_prod
      ORDER BY clientes_que_compram DESC, qtd_total DESC
      LIMIT 10
    `, [idCliente, idCliente]);

    // 7. Evolução mensal de compras (últimos 12 meses)
    const [evolucaoMensal] = await pool.query(`
      SELECT DATE_FORMAT(data_abertura, '%Y-%m') AS mes,
             COUNT(*) AS pedidos,
             SUM(vlrtotalpedido) AS valor
      FROM pedidos
      WHERE cod_cliente = ? AND excluido='N' AND tipo_pedido='PEDIDO'
        AND situacao_pedido NOT IN ('CANCELADO','RECUSADO')
        AND data_abertura >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
      GROUP BY mes ORDER BY mes
    `, [idCliente]);

    // 8. Ticket médio da carteira (para comparativo)
    const [[carteira]] = await pool.query(`
      SELECT AVG(sub.ticket) AS ticket_carteira
      FROM (
        SELECT cod_cliente, AVG(vlrtotalpedido) AS ticket
        FROM pedidos
        WHERE excluido='N' AND tipo_pedido='PEDIDO'
          AND situacao_pedido NOT IN ('CANCELADO','RECUSADO')
          AND data_abertura >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
        GROUP BY cod_cliente
      ) sub
    `);

    // 9. Sazonalidade (média por mês do ano, últimos 24 meses)
    const [sazonalidade] = await pool.query(`
      SELECT MONTH(data_abertura) AS mes_num, MONTHNAME(data_abertura) AS mes_nome,
             AVG(vlrtotalpedido) AS ticket_medio, COUNT(*) AS pedidos
      FROM pedidos
      WHERE cod_cliente = ? AND excluido='N' AND tipo_pedido='PEDIDO'
        AND situacao_pedido NOT IN ('CANCELADO','RECUSADO')
        AND data_abertura >= DATE_SUB(CURDATE(), INTERVAL 24 MONTH)
      GROUP BY mes_num, mes_nome ORDER BY mes_num
    `, [idCliente]);

    // ─── Cálculo do score ──────────────────────────────────────────────────
    const recenciaDias     = cli.dias_sem_compra || 999;
    const totalPedidos12m  = kpis12m.total_pedidos || 0;
    const ticketMedio      = parseFloat(kpis12m.ticket_medio || 0);
    const ticketCarteira   = parseFloat(carteira.ticket_carteira || 0);
    const total6mAtual     = parseFloat(kpis6m_atual.total || 0);
    const total6mAnt       = parseFloat(kpis6m_ant.total || 0);
    const variacaoPct      = total6mAnt > 0 ? ((total6mAtual - total6mAnt) / total6mAnt) * 100 : 0;
    // Pedidos por mês (últimos 12)
    const pedidosPorMes    = totalPedidos12m / 12;

    const score = calcularScore({ recenciaDias, pedidosPorMes, ticketMedio, ticketCarteira, variacaoPct });
    const risco = nivelRisco(score, recenciaDias);

    // ─── Produtos recomendados (priorizados) ──────────────────────────────
    const recomendados = [];

    // Recompra: produtos parados < 12 meses
    produtosParou.slice(0, 5).forEach(p => {
      recomendados.push({
        codproduto: p.codproduto,
        descricao: p.descricao,
        tipo: 'RECOMPRA',
        motivo: `Último pedido há ${p.dias_parado} dias. Cliente comprava regularmente.`,
        prioridade: p.dias_parado < 180 ? 'ALTA' : 'MÉDIA',
        ultima_compra: p.ultima_compra,
        qtd_historico: p.qtd_historico,
      });
    });

    // Complementares: mais populares na região
    produtosComplementares.slice(0, 5).forEach(p => {
      recomendados.push({
        codproduto: p.codproduto,
        descricao: p.descricao,
        tipo: 'COMPLEMENTAR',
        motivo: `${p.clientes_que_compram} clientes similares compram este produto.`,
        prioridade: 'MÉDIA',
        clientes_que_compram: p.clientes_que_compram,
      });
    });

    // ─── Sugestão de orçamento ─────────────────────────────────────────────
    const itensSugeridosOrcamento = [
      ...produtosParou.slice(0, 3).map(p => ({ codproduto: p.codproduto, descricao: p.descricao, quantidade: p.qtd_historico > 0 ? Math.ceil(p.qtd_historico / 4) : 1, tipo: 'recompra' })),
      ...produtosComplementares.slice(0, 2).map(p => ({ codproduto: p.codproduto, descricao: p.descricao, quantidade: 1, tipo: 'complementar' })),
    ];

    // ─── Mensagens geradas com dados reais ────────────────────────────────
    const dadosMensagem = {
      nome: cli.nome,
      empresa: cli.apelido || cli.nome,
      recenciaDias,
      totalPedidos12m,
      ticketMedio,
      produtos: recomendados.slice(0, 4),
      diasSemProduto: produtosParou[0]?.dias_parado || 0,
    };

    // ─── Alertas ──────────────────────────────────────────────────────────
    const alertas = [];
    if (cli.venda_suspensa === 'S') alertas.push({ tipo: 'danger', texto: 'Venda suspensa para este cliente.' });
    if (recenciaDias > 180) alertas.push({ tipo: 'danger', texto: `Sem compras há ${recenciaDias} dias — risco alto de perda.` });
    else if (recenciaDias > 90) alertas.push({ tipo: 'warning', texto: `Sem compras há ${recenciaDias} dias — atenção necessária.` });
    if (variacaoPct < -20) alertas.push({ tipo: 'warning', texto: `Queda de ${Math.abs(variacaoPct).toFixed(0)}% nas compras nos últimos 6 meses.` });
    if (produtosParou.length > 3) alertas.push({ tipo: 'info', texto: `${produtosParou.length} produtos que o cliente parou de comprar — oportunidade de reativação.` });
    if (score >= 70) alertas.push({ tipo: 'success', texto: `Score alto (${score}): cliente com grande potencial de compra agora.` });

    res.json({
      cliente: cli,
      score,
      risco,
      kpis: {
        total_pedidos_12m: totalPedidos12m,
        total_comprado_12m: kpis12m.total_comprado || 0,
        ticket_medio: ticketMedio,
        ticket_carteira: ticketCarteira,
        recencia_dias: recenciaDias,
        pedidos_por_mes: +pedidosPorMes.toFixed(2),
        variacao_6m_pct: +variacaoPct.toFixed(1),
        total_6m_atual: total6mAtual,
        total_6m_anterior: total6mAnt,
        primeira_compra_12m: kpis12m.primeira_compra,
        ultima_compra_12m: kpis12m.ultima_compra,
      },
      pedidos_recentes: pedidos.slice(0, 10),
      produtos_mais_comprados: produtosMaisComprados,
      produtos_parou: produtosParou,
      produtos_complementares: produtosComplementares,
      recomendados,
      orcamento_sugerido: itensSugeridosOrcamento,
      evolucao_mensal: evolucaoMensal,
      sazonalidade,
      alertas,
      mensagens: {
        whatsapp: gerarMensagemWhatsapp(dadosMensagem),
        chamada: gerarRoteiroChamada(dadosMensagem),
        email: gerarEmailComercial(dadosMensagem),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/inteligencia/ranking ────── ranking de oportunidades ────────────
router.get('/ranking', async (req, res) => {
  try {
    const pool = getPool();
    const isAdmin = req.user.perfil == 1 || req.user.acessartodosclientes === 'S';
    const { id_usuario, limit = 50 } = req.query;
    const vals = [];
    const where = [`(c.excluido='N' OR c.excluido IS NULL)`];

    if (!isAdmin) {
      where.push(`c.cod_vendedor = ?`);
      vals.push(req.user.id);
    } else if (id_usuario) {
      where.push(`c.cod_vendedor = ?`);
      vals.push(id_usuario);
    }

    const wc = where.join(' AND ');
    const [rows] = await pool.query(`
      SELECT
        c.id, c.nome, c.apelido, c.cidade, c.uf,
        c.dtultimacompra, DATEDIFF(CURDATE(), c.dtultimacompra) AS recencia_dias,
        c.cod_vendedor, u.nomeusu AS nome_vendedor,
        rr.descricao AS nome_regiao,
        COALESCE(stats.total_pedidos, 0) AS pedidos_12m,
        COALESCE(stats.ticket_medio, 0) AS ticket_medio,
        COALESCE(stats.total_comprado, 0) AS total_comprado_12m,
        COALESCE(stats.pedidos_por_mes, 0) AS pedidos_por_mes
      FROM clientes c
      LEFT JOIN usuarios u ON u.idusuario = c.cod_vendedor
      LEFT JOIN regiao_rota rr ON rr.id = c.regiao
      LEFT JOIN (
        SELECT cod_cliente,
               COUNT(*) AS total_pedidos,
               AVG(vlrtotalpedido) AS ticket_medio,
               SUM(vlrtotalpedido) AS total_comprado,
               COUNT(*)/12.0 AS pedidos_por_mes
        FROM pedidos
        WHERE excluido='N' AND tipo_pedido='PEDIDO'
          AND situacao_pedido NOT IN ('CANCELADO','RECUSADO')
          AND data_abertura >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
        GROUP BY cod_cliente
      ) stats ON stats.cod_cliente = c.id
      WHERE ${wc}
        AND c.dtultimacompra IS NOT NULL
      ORDER BY recencia_dias ASC, total_comprado_12m DESC
      LIMIT ?
    `, [...vals, parseInt(limit)]);

    // Calcula ticket médio da carteira para o score
    const [[carteira]] = await pool.query(`
      SELECT AVG(sub.ticket) AS ticket_carteira
      FROM (
        SELECT cod_cliente, AVG(vlrtotalpedido) AS ticket
        FROM pedidos
        WHERE excluido='N' AND tipo_pedido='PEDIDO'
          AND situacao_pedido NOT IN ('CANCELADO','RECUSADO')
          AND data_abertura >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
        GROUP BY cod_cliente
      ) sub
    `);
    const ticketCarteira = parseFloat(carteira.ticket_carteira || 0);

    const resultado = rows.map(c => {
      const score = calcularScore({
        recenciaDias: c.recencia_dias || 999,
        pedidosPorMes: parseFloat(c.pedidos_por_mes),
        ticketMedio: parseFloat(c.ticket_medio),
        ticketCarteira,
        variacaoPct: 0,
      });
      return { ...c, score, risco: nivelRisco(score, c.recencia_dias || 999) };
    }).sort((a, b) => b.score - a.score);

    res.json({ clientes: resultado, ticket_carteira: ticketCarteira });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/inteligencia/alertas ──── clientes em risco ─────────────────────
router.get('/alertas', async (req, res) => {
  try {
    const pool = getPool();
    const isAdmin = req.user.perfil == 1 || req.user.acessartodosclientes === 'S';
    const vals = [];
    const where = [`(c.excluido='N' OR c.excluido IS NULL)`, `c.dtultimacompra IS NOT NULL`];

    if (!isAdmin) {
      where.push(`c.cod_vendedor = ?`);
      vals.push(req.user.id);
    }
    where.push(`DATEDIFF(CURDATE(), c.dtultimacompra) > 60`);

    const wc = where.join(' AND ');
    const [rows] = await pool.query(`
      SELECT c.id, c.nome, c.cidade, c.uf,
             c.dtultimacompra, DATEDIFF(CURDATE(), c.dtultimacompra) AS recencia_dias,
             c.foneprincipal, u.nomeusu AS nome_vendedor,
             rr.descricao AS nome_regiao
      FROM clientes c
      LEFT JOIN usuarios u ON u.idusuario = c.cod_vendedor
      LEFT JOIN regiao_rota rr ON rr.id = c.regiao
      WHERE ${wc}
      ORDER BY recencia_dias DESC
      LIMIT 100
    `, vals);

    const alertas = rows.map(c => ({
      ...c,
      nivel: c.recencia_dias > 180 ? 'ALTO' : c.recencia_dias > 90 ? 'MÉDIO' : 'BAIXO',
    }));
    res.json({ alertas, total: alertas.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/inteligencia/ranking-vendedor ───────────────────────────────────
router.get('/ranking-vendedor', async (req, res) => {
  try {
    const pool = getPool();
    const isAdmin = req.user.perfil == 1 || req.user.acessartodosclientes === 'S';
    if (!isAdmin) return res.json({ vendedores: [] });

    const [rows] = await pool.query(`
      SELECT u.idusuario AS id, u.nomeusu AS nome,
             COUNT(DISTINCT p.cod_cliente) AS clientes_ativos,
             COUNT(p.id) AS pedidos_12m,
             SUM(p.vlrtotalpedido) AS volume_12m,
             AVG(p.vlrtotalpedido) AS ticket_medio,
             SUM(CASE WHEN DATEDIFF(CURDATE(), c.dtultimacompra) > 90 THEN 1 ELSE 0 END) AS clientes_risco
      FROM usuarios u
      JOIN pedidos p ON p.id_usuario = u.idusuario
      JOIN clientes c ON c.id = p.cod_cliente
      WHERE p.excluido='N' AND p.tipo_pedido='PEDIDO'
        AND p.situacao_pedido NOT IN ('CANCELADO','RECUSADO')
        AND p.data_abertura >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
      GROUP BY u.idusuario, u.nomeusu
      ORDER BY volume_12m DESC
    `);
    res.json({ vendedores: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
