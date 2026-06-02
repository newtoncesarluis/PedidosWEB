const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');

// Detecta tabela de produtos (produto ou produtos)
let _prodTb = null;
async function getProdTb(pool) {
  if (_prodTb) return _prodTb;
  const [r] = await pool.query(`SHOW TABLES LIKE 'produto'`);
  _prodTb = r.length ? 'produto' : 'produtos';
  return _prodTb;
}

function subtrairAno(dateStr) {
  const d = new Date(dateStr);
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

function calcScore({ margemPct, positivacaoPct, metaPct, crescimentoPct, inadimplenciaPct }) {
  // Margem real (0-30)
  let sMargem = 10; // neutro (custo não cadastrado)
  if (margemPct > 0) {
    if (margemPct >= 35)      sMargem = 30;
    else if (margemPct >= 25) sMargem = 24;
    else if (margemPct >= 15) sMargem = 16;
    else if (margemPct >= 5)  sMargem = 8;
    else                      sMargem = 2;
  }

  // Positivação — % da carteira com pedido no período (0-25)
  let sPosit = 0;
  if (positivacaoPct >= 80)      sPosit = 25;
  else if (positivacaoPct >= 60) sPosit = 20;
  else if (positivacaoPct >= 40) sPosit = 13;
  else if (positivacaoPct >= 20) sPosit = 7;
  else                           sPosit = 2;

  // Meta (0-25), neutro quando não há meta definida
  let sMeta = 12;
  if (metaPct !== null) {
    if (metaPct >= 100)      sMeta = 25;
    else if (metaPct >= 85)  sMeta = 20;
    else if (metaPct >= 70)  sMeta = 13;
    else if (metaPct >= 50)  sMeta = 6;
    else                     sMeta = 1;
  }

  // Crescimento vs mesmo período ano anterior (0-15)
  let sCrescimento = 5;
  if (crescimentoPct > 30)       sCrescimento = 15;
  else if (crescimentoPct > 10)  sCrescimento = 12;
  else if (crescimentoPct > 0)   sCrescimento = 8;
  else if (crescimentoPct > -10) sCrescimento = 4;
  else if (crescimentoPct > -30) sCrescimento = 1;
  else                           sCrescimento = 0;

  // Inadimplência — punição (0-5)
  let sInad = 5;
  if (inadimplenciaPct > 20)     sInad = 0;
  else if (inadimplenciaPct > 10) sInad = 1;
  else if (inadimplenciaPct > 5)  sInad = 3;

  return Math.min(100, Math.round(sMargem + sPosit + sMeta + sCrescimento + sInad));
}

function classificar(score) {
  if (score >= 75) return { classe: 'Elite',           cor: '#059669' };
  if (score >= 50) return { classe: 'Operacional',     cor: '#0ea5e9' };
  if (score >= 25) return { classe: 'Expansão',        cor: '#f59e0b' };
  return             { classe: 'Risco Comercial',  cor: '#dc2626' };
}

// ─── GET / — Ranking de representantes ───────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    const prodTb = await getProdTb(pool);

    const hoje = new Date();
    const mesIni = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-01`;
    const { dtini = mesIni, dtfim = hoje.toISOString().slice(0, 10), id_vendedor } = req.query;

    const diAnt = subtrairAno(dtini);
    const dfAnt = subtrairAno(dtfim);

    const extra = id_vendedor ? 'AND u.idusuario = ?' : '';
    const extraParams = id_vendedor ? [id_vendedor] : [];

    const sql = `
      SELECT
        u.idusuario                                       AS id,
        u.nomeusu                                         AS nome,
        COALESCE(u.vlr_meta, 0)                          AS meta,
        u.rota_vendedor                                   AS rota,

        COUNT(DISTINCT p.id)                              AS total_pedidos,
        COALESCE(SUM(p.vlrtotalpedido), 0)               AS faturamento,
        COALESCE(AVG(p.vlrtotalpedido), 0)               AS ticket_medio,
        COALESCE(SUM(COALESCE(p.vlrdesconto, 0)), 0)     AS desconto_total,
        COUNT(DISTINCT p.cod_cliente)                     AS clientes_positivados,

        (SELECT COUNT(*)
         FROM clientes c
         WHERE c.cod_vendedor = u.idusuario AND c.excluido = 'N'
        ) AS total_carteira,

        (SELECT COUNT(*)
         FROM visitas v
         WHERE v.id_vendedor = u.idusuario
           AND v.data_visita BETWEEN ? AND ?
           AND v.exluido = 'N'
        ) AS total_visitas,

        (SELECT COALESCE(SUM(pp2.vlrtotalpedido), 0)
         FROM pedidos pp2
         WHERE pp2.id_usuario = u.idusuario
           AND pp2.excluido = 'N'
           AND pp2.situacao_pedido NOT IN ('CANCELADO')
           AND pp2.data_abertura BETWEEN ? AND ?
        ) AS faturamento_anterior,

        (SELECT COALESCE(SUM(r.valor), 0)
         FROM receber r
         INNER JOIN pedidos pr ON pr.id = r.id_pedido AND pr.id_usuario = u.idusuario
         WHERE r.vencimento < CURDATE()
           AND r.status NOT IN ('PAGO', 'QUITADO')
           AND r.excluido = 'N'
        ) AS vlr_inadimplencia,

        (SELECT COALESCE(SUM(ip.quantidade * COALESCE(pr2.vlr_custo, 0)), 0)
         FROM itensped ip
         INNER JOIN pedidos pp3 ON pp3.id = ip.id_pedido
           AND pp3.id_usuario = u.idusuario
           AND pp3.data_abertura BETWEEN ? AND ?
           AND pp3.excluido = 'N'
           AND pp3.situacao_pedido NOT IN ('CANCELADO')
         LEFT JOIN ${prodTb} pr2 ON pr2.id = ip.cod_produto
         WHERE ip.excluido = 'N'
        ) AS custo_total

      FROM usuarios u
      INNER JOIN pedidos p
        ON p.id_usuario = u.idusuario
        AND p.data_abertura BETWEEN ? AND ?
        AND p.excluido = 'N'
        AND p.situacao_pedido NOT IN ('CANCELADO')
      WHERE u.excluido = 'N'
        AND u.situacao = 'ATIVO'
        ${extra}
      GROUP BY u.idusuario, u.nomeusu, u.vlr_meta, u.rota_vendedor
      ORDER BY faturamento DESC
    `;

    // Ordem dos params: visitas(di,df), fat_ant(diAnt,dfAnt), custo(di,df), main(di,df), extra
    const params = [dtini, dtfim, diAnt, dfAnt, dtini, dtfim, dtini, dtfim, ...extraParams];
    const [rows] = await pool.query(sql, params);

    // Calcula indicadores e score para cada rep
    const representantes = rows.map(r => {
      const fat     = Number(r.faturamento);
      const custo   = Number(r.custo_total);
      const desc    = Number(r.desconto_total);
      const fatAnt  = Number(r.faturamento_anterior);
      const inad    = Number(r.vlr_inadimplencia);
      const cart    = Number(r.total_carteira);
      const posit   = Number(r.clientes_positivados);
      const meta    = Number(r.meta);

      const descontoPct     = fat > 0 ? (desc / (fat + desc)) * 100 : 0;
      const positivacaoPct  = cart > 0 ? (posit / cart) * 100 : 0;
      const crescimentoPct  = fatAnt > 0 ? ((fat - fatAnt) / fatAnt) * 100 : 0;
      const inadimplenciaPct = fat > 0 ? (inad / fat) * 100 : 0;
      // margem só é confiável quando custo está cadastrado (custo > 0)
      const margemPct       = (fat > 0 && custo > 0) ? ((fat - custo) / fat) * 100 : 0;
      const metaPct         = meta > 0 ? (fat / meta) * 100 : null;

      const score = calcScore({ margemPct, positivacaoPct, metaPct, crescimentoPct, inadimplenciaPct });
      const { classe, cor } = classificar(score);

      return {
        id:                   r.id,
        nome:                 r.nome,
        rota:                 r.rota || '',
        total_pedidos:        Number(r.total_pedidos),
        faturamento:          fat,
        ticket_medio:         Number(r.ticket_medio),
        total_carteira:       cart,
        clientes_positivados: posit,
        total_visitas:        Number(r.total_visitas),
        faturamento_anterior: fatAnt,
        vlr_inadimplencia:    inad,
        custo_total:          custo,
        meta:                 meta,
        desconto_pct:         Math.round(descontoPct * 10) / 10,
        positivacao_pct:      Math.round(positivacaoPct * 10) / 10,
        crescimento_pct:      Math.round(crescimentoPct * 10) / 10,
        inadimplencia_pct:    Math.round(inadimplenciaPct * 10) / 10,
        margem_pct:           custo > 0 ? Math.round(margemPct * 10) / 10 : null,
        meta_pct:             metaPct !== null ? Math.round(metaPct * 10) / 10 : null,
        score,
        classe,
        cor,
      };
    });

    res.json({ representantes, periodo: { dtini, dtfim } });
  } catch (err) {
    console.error('Erro performance representantes:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /mapa — Cidades com status de cobertura ──────────────────────────────
router.get('/mapa', async (req, res) => {
  try {
    const pool = getPool();
    const { id_vendedor } = req.query;

    const extra    = id_vendedor ? 'AND c.cod_vendedor = ?' : '';
    const params   = id_vendedor ? [id_vendedor] : [];

    const [rows] = await pool.query(`
      SELECT
        c.cidade,
        c.uf,
        AVG(c.latitude)   AS lat,
        AVG(c.longitude)  AS lng,
        COUNT(DISTINCT c.id) AS total_clientes,

        MAX(p.data_abertura) AS ultimo_pedido,

        (SELECT MAX(v.data_visita)
         FROM visitas v
         INNER JOIN clientes cv ON cv.id = v.id_cliente AND cv.cidade = c.cidade AND (cv.uf = c.uf OR cv.uf IS NULL)
         WHERE v.exluido = 'N'
           ${id_vendedor ? 'AND v.id_vendedor = ?' : ''}
        ) AS ultima_visita,

        COUNT(DISTINCT CASE
          WHEN p.data_abertura >= DATE_SUB(CURDATE(), INTERVAL 90 DAY) THEN c.id
        END) AS clientes_ativos_90d

      FROM clientes c
      LEFT JOIN pedidos p ON p.cod_cliente = c.id
        AND p.excluido = 'N'
        AND p.situacao_pedido NOT IN ('CANCELADO')
      WHERE c.excluido = 'N'
        AND c.cidade IS NOT NULL
        AND c.latitude IS NOT NULL
        ${extra}
      GROUP BY c.cidade, c.uf
      HAVING COUNT(DISTINCT c.id) > 0
      ORDER BY total_clientes DESC
      LIMIT 500
    `, id_vendedor ? [id_vendedor, ...params] : params);

    const hoje = new Date();
    const cidades = rows.map(r => {
      const diasUltimoPedido = r.ultimo_pedido
        ? Math.floor((hoje - new Date(r.ultimo_pedido)) / 86400000)
        : 999;
      const diasUltimaVisita = r.ultima_visita
        ? Math.floor((hoje - new Date(r.ultima_visita)) / 86400000)
        : 999;

      let status = 'vermelho';
      if (diasUltimoPedido <= 60 && diasUltimaVisita <= 60) status = 'verde';
      else if (diasUltimoPedido <= 90 || diasUltimaVisita <= 90) status = 'amarelo';

      return {
        cidade:          r.cidade,
        uf:              r.uf,
        lat:             Number(r.lat),
        lng:             Number(r.lng),
        total_clientes:  Number(r.total_clientes),
        ativos_90d:      Number(r.clientes_ativos_90d),
        ultimo_pedido:   r.ultimo_pedido ? r.ultimo_pedido.toISOString().slice(0, 10) : null,
        ultima_visita:   r.ultima_visita ? new Date(r.ultima_visita).toISOString().slice(0, 10) : null,
        dias_sem_pedido: diasUltimoPedido < 999 ? diasUltimoPedido : null,
        dias_sem_visita: diasUltimaVisita < 999 ? diasUltimaVisita : null,
        status,
      };
    });

    res.json({ cidades });
  } catch (err) {
    console.error('Erro mapa cobertura:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /insights — Alertas e oportunidades automáticos ─────────────────────
router.get('/insights', async (req, res) => {
  try {
    const pool = getPool();
    const hoje = new Date();
    const mesIni = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-01`;
    const { dtini = mesIni, dtfim = hoje.toISOString().slice(0, 10) } = req.query;

    // Busca dados do ranking para gerar insights
    const forward = req.query.id_vendedor
      ? `?dtini=${dtini}&dtfim=${dtfim}&id_vendedor=${req.query.id_vendedor}`
      : `?dtini=${dtini}&dtfim=${dtfim}`;

    // Reutiliza a query principal internamente
    const prodTb = await getProdTb(pool);
    const diAnt  = subtrairAno(dtini);
    const dfAnt  = subtrairAno(dtfim);

    const [rows] = await pool.query(`
      SELECT
        u.nomeusu AS nome,
        u.idusuario AS id,
        COALESCE(SUM(p.vlrtotalpedido), 0)           AS faturamento,
        COALESCE(SUM(COALESCE(p.vlrdesconto,0)), 0)  AS desconto_total,
        COUNT(DISTINCT p.cod_cliente)                 AS clientes_positivados,
        (SELECT COUNT(*) FROM clientes c WHERE c.cod_vendedor = u.idusuario AND c.excluido = 'N') AS total_carteira,
        (SELECT COALESCE(SUM(pp2.vlrtotalpedido),0) FROM pedidos pp2
         WHERE pp2.id_usuario = u.idusuario AND pp2.excluido = 'N'
           AND pp2.situacao_pedido NOT IN ('CANCELADO')
           AND pp2.data_abertura BETWEEN ? AND ?) AS faturamento_anterior,
        (SELECT COALESCE(SUM(r.valor),0) FROM receber r
         INNER JOIN pedidos pr ON pr.id = r.id_pedido AND pr.id_usuario = u.idusuario
         WHERE r.vencimento < CURDATE()
           AND r.status NOT IN ('PAGO','QUITADO') AND r.excluido = 'N') AS vlr_inadimplencia,
        (SELECT COALESCE(SUM(ip.quantidade * COALESCE(pr2.vlr_custo,0)),0)
         FROM itensped ip
         INNER JOIN pedidos pp3 ON pp3.id = ip.id_pedido
           AND pp3.id_usuario = u.idusuario
           AND pp3.data_abertura BETWEEN ? AND ?
           AND pp3.excluido = 'N' AND pp3.situacao_pedido NOT IN ('CANCELADO')
         LEFT JOIN ${prodTb} pr2 ON pr2.id = ip.cod_produto
         WHERE ip.excluido = 'N') AS custo_total
      FROM usuarios u
      INNER JOIN pedidos p ON p.id_usuario = u.idusuario
        AND p.data_abertura BETWEEN ? AND ?
        AND p.excluido = 'N' AND p.situacao_pedido NOT IN ('CANCELADO')
      WHERE u.excluido = 'N' AND u.situacao = 'ATIVO'
      GROUP BY u.idusuario, u.nomeusu
      ORDER BY faturamento DESC
    `, [diAnt, dfAnt, dtini, dtfim, dtini, dtfim]);

    if (!rows.length) return res.json({ insights: [] });

    const avgFat = rows.reduce((s, r) => s + Number(r.faturamento), 0) / rows.length;
    const insights = [];

    for (const r of rows) {
      const fat    = Number(r.faturamento);
      const custo  = Number(r.custo_total);
      const desc   = Number(r.desconto_total);
      const fatAnt = Number(r.faturamento_anterior);
      const inad   = Number(r.vlr_inadimplencia);
      const cart   = Number(r.total_carteira);
      const posit  = Number(r.clientes_positivados);
      const nome   = r.nome.split(' ')[0];

      const descontoPct    = fat > 0 ? (desc / (fat + desc)) * 100 : 0;
      const margemPct      = (fat > 0 && custo > 0) ? ((fat - custo) / fat) * 100 : null;
      const crescimentoPct = fatAnt > 0 ? ((fat - fatAnt) / fatAnt) * 100 : null;
      const inadPct        = fat > 0 ? (inad / fat) * 100 : 0;
      const positPct       = cart > 0 ? (posit / cart) * 100 : 0;

      // Desconto excessivo
      if (descontoPct > 12) {
        insights.push({
          tipo: 'alerta',
          icone: '📉',
          titulo: `${nome} — desconto excessivo`,
          texto: `Desconto médio de ${descontoPct.toFixed(1)}% — acima da política comercial. Possível perda de R$ ${((desc)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} em margem.`,
          rep_id: r.id,
          rep_nome: r.nome,
        });
      }

      // Margem baixa (quando custo cadastrado)
      if (margemPct !== null && margemPct < 15) {
        insights.push({
          tipo: 'alerta',
          icone: '⚠️',
          titulo: `${nome} — margem abaixo do mínimo`,
          texto: `Margem real de ${margemPct.toFixed(1)}%. Verificar precificação e descontos concedidos.`,
          rep_id: r.id,
          rep_nome: r.nome,
        });
      }

      // Queda de faturamento
      if (crescimentoPct !== null && crescimentoPct < -20) {
        insights.push({
          tipo: 'alerta',
          icone: '🔴',
          titulo: `${nome} — queda de faturamento`,
          texto: `Queda de ${Math.abs(crescimentoPct).toFixed(1)}% vs mesmo período do ano anterior.`,
          rep_id: r.id,
          rep_nome: r.nome,
        });
      }

      // Positivação baixa
      if (cart > 5 && positPct < 30) {
        insights.push({
          tipo: 'alerta',
          icone: '👤',
          titulo: `${nome} — baixa positivação`,
          texto: `Apenas ${positPct.toFixed(0)}% da carteira (${posit} de ${cart} clientes) fez pedido no período.`,
          rep_id: r.id,
          rep_nome: r.nome,
        });
      }

      // Inadimplência alta
      if (inadPct > 10) {
        insights.push({
          tipo: 'alerta',
          icone: '💳',
          titulo: `${nome} — inadimplência elevada`,
          texto: `${inadPct.toFixed(1)}% do faturamento em aberto vencido. Total: ${inad.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`,
          rep_id: r.id,
          rep_nome: r.nome,
        });
      }

      // Crescimento expressivo
      if (crescimentoPct !== null && crescimentoPct > 25) {
        insights.push({
          tipo: 'oportunidade',
          icone: '🚀',
          titulo: `${nome} — crescimento expressivo`,
          texto: `Crescimento de ${crescimentoPct.toFixed(1)}% vs mesmo período do ano anterior. Perfil com alto potencial de expansão.`,
          rep_id: r.id,
          rep_nome: r.nome,
        });
      }

      // Margem excelente
      if (margemPct !== null && margemPct > 30 && fat > avgFat * 0.7) {
        insights.push({
          tipo: 'oportunidade',
          icone: '💎',
          titulo: `${nome} — alta rentabilidade`,
          texto: `Margem real de ${margemPct.toFixed(1)}% com faturamento expressivo. Representante altamente estratégico.`,
          rep_id: r.id,
          rep_nome: r.nome,
        });
      }
    }

    // Clientes sem compra há 45+ dias (global)
    const [semCompra] = await pool.query(`
      SELECT COUNT(*) AS total
      FROM clientes c
      WHERE c.excluido = 'N'
        AND (c.dt_ultimacompra IS NULL OR c.dt_ultimacompra < DATE_SUB(CURDATE(), INTERVAL 45 DAY))
    `).catch(() => [[{ total: 0 }]]);

    if (semCompra[0].total > 0) {
      insights.push({
        tipo: 'alerta',
        icone: '🕐',
        titulo: 'Clientes sem compra há 45+ dias',
        texto: `${semCompra[0].total} cliente(s) sem pedido há mais de 45 dias. Revisar carteira e acionar representantes.`,
        rep_id: null,
        rep_nome: null,
      });
    }

    res.json({ insights, periodo: { dtini, dtfim } });
  } catch (err) {
    console.error('Erro insights:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
