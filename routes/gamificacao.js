/**
 * Gamificação — ranking, metas visuais e conquistas dos representantes
 */
const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');

let _prodTb = null;
async function getProdTb(pool) {
  if (_prodTb) return _prodTb;
  const [r] = await pool.query(`SHOW TABLES LIKE 'produto'`);
  _prodTb = r.length ? 'produto' : 'produtos';
  return _prodTb;
}

function subtrairAno(d) {
  const dt = new Date(d);
  dt.setFullYear(dt.getFullYear() - 1);
  return dt.toISOString().slice(0, 10);
}

function calcScore({ margemPct, positivacaoPct, metaPct, crescimentoPct, inadimplenciaPct }) {
  let sMargem = 10;
  if (margemPct > 0) {
    if      (margemPct >= 35) sMargem = 30;
    else if (margemPct >= 25) sMargem = 24;
    else if (margemPct >= 15) sMargem = 16;
    else if (margemPct >= 5)  sMargem = 8;
    else                      sMargem = 2;
  }
  let sPosit = 0;
  if      (positivacaoPct >= 80) sPosit = 25;
  else if (positivacaoPct >= 60) sPosit = 20;
  else if (positivacaoPct >= 40) sPosit = 13;
  else if (positivacaoPct >= 20) sPosit = 7;
  else                           sPosit = 2;

  let sMeta = 12;
  if (metaPct !== null) {
    if      (metaPct >= 100) sMeta = 25;
    else if (metaPct >= 85)  sMeta = 20;
    else if (metaPct >= 70)  sMeta = 13;
    else if (metaPct >= 50)  sMeta = 6;
    else                     sMeta = 1;
  }
  let sCrsc = 5;
  if      (crescimentoPct > 30)  sCrsc = 15;
  else if (crescimentoPct > 10)  sCrsc = 12;
  else if (crescimentoPct > 0)   sCrsc = 8;
  else if (crescimentoPct > -10) sCrsc = 4;
  else if (crescimentoPct > -30) sCrsc = 1;
  else                           sCrsc = 0;

  let sInad = 5;
  if      (inadimplenciaPct > 20) sInad = 0;
  else if (inadimplenciaPct > 10) sInad = 1;
  else if (inadimplenciaPct > 5)  sInad = 3;

  return Math.min(100, Math.round(sMargem + sPosit + sMeta + sCrsc + sInad));
}

function computeConquistas(r, todos) {
  const c = [];
  if (r.meta_pct !== null && r.meta_pct >= 100)
    c.push({ id: 'meta100',  icone: '🎯', titulo: 'Meta Batida',           desc: `${r.meta_pct.toFixed(0)}% da meta`,            cor: '#059669' });
  if (r.meta_pct !== null && r.meta_pct >= 120)
    c.push({ id: 'meta120',  icone: '🔥', titulo: 'Acima da Meta',         desc: `${r.meta_pct.toFixed(0)}% — superou`,           cor: '#dc2626' });
  if (r.positivacao_pct >= 80)
    c.push({ id: 'positv',   icone: '👥', titulo: 'Positivador',           desc: `${r.positivacao_pct.toFixed(0)}% da carteira`,  cor: '#0ea5e9' });
  if (r.crescimento_pct !== null && r.crescimento_pct >= 30)
    c.push({ id: 'rocket',   icone: '🚀', titulo: 'Crescimento Explosivo', desc: `+${r.crescimento_pct.toFixed(0)}% vs ano`,      cor: '#7c3aed' });
  if (r.inadimplencia_pct === 0 && r.faturamento > 0)
    c.push({ id: 'inad0',    icone: '🏦', titulo: 'Carteira Limpa',        desc: '0% inadimplência',                             cor: '#0891b2' });
  if (r.score >= 75)
    c.push({ id: 'elite',    icone: '💎', titulo: 'Elite',                 desc: `Score ${r.score}`,                             cor: '#d97706' });

  // Conquistas relativas (só 1 rep pode ter cada uma)
  const maxFat     = Math.max(...todos.map(x => x.faturamento));
  const maxVisitas = Math.max(...todos.map(x => x.total_visitas));
  const maxTicket  = Math.max(...todos.map(x => x.ticket_medio));

  if (todos.length > 1 && r.faturamento === maxFat && maxFat > 0)
    c.push({ id: 'topfat',   icone: '🥇', titulo: '# 1 em Faturamento',   desc: 'Maior faturamento',                           cor: '#f59e0b' });
  if (todos.length > 1 && r.total_visitas === maxVisitas && maxVisitas > 0)
    c.push({ id: 'topvis',   icone: '🚗', titulo: 'Rei das Visitas',       desc: `${r.total_visitas} visitas`,                   cor: '#6366f1' });
  if (todos.length > 1 && r.ticket_medio === maxTicket && maxTicket > 0)
    c.push({ id: 'topticket',icone: '💰', titulo: 'Ticket de Ouro',        desc: `R$ ${r.ticket_medio.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`,  cor: '#0d9488' });

  return c;
}

// ─── GET /ranking ─────────────────────────────────────────────────────────────
router.get('/ranking', async (req, res) => {
  try {
    const pool   = getPool();
    const prodTb = await getProdTb(pool);

    const hoje   = new Date();
    const mesIni = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-01`;
    const { dtini = mesIni, dtfim = hoje.toISOString().slice(0, 10) } = req.query;

    const diAnt = subtrairAno(dtini);
    const dfAnt = subtrairAno(dtfim);

    const [rows] = await pool.query(`
      SELECT
        u.idusuario                                    AS id,
        u.nomeusu                                      AS nome,
        COALESCE(u.vlr_meta, 0)                       AS meta,
        u.rota_vendedor                                AS rota,
        COUNT(DISTINCT p.id)                           AS total_pedidos,
        COALESCE(SUM(p.vlrtotalpedido), 0)            AS faturamento,
        COALESCE(AVG(p.vlrtotalpedido), 0)            AS ticket_medio,
        COALESCE(SUM(COALESCE(p.vlrdesconto, 0)), 0)  AS desconto_total,
        COUNT(DISTINCT p.cod_cliente)                  AS clientes_positivados,
        (SELECT COUNT(*) FROM clientes c
         WHERE c.cod_vendedor = u.idusuario AND c.excluido = 'N') AS total_carteira,
        (SELECT COUNT(*) FROM visitas v
         WHERE v.id_vendedor = u.idusuario
           AND v.data_visita BETWEEN ? AND ? AND v.exluido = 'N') AS total_visitas,
        (SELECT COALESCE(SUM(pp2.vlrtotalpedido), 0) FROM pedidos pp2
         WHERE pp2.id_usuario = u.idusuario AND pp2.excluido = 'N'
           AND pp2.situacao_pedido NOT IN ('CANCELADO')
           AND pp2.data_abertura BETWEEN ? AND ?) AS faturamento_anterior,
        (SELECT COALESCE(SUM(r2.valor), 0) FROM receber r2
         INNER JOIN pedidos pr ON pr.id = r2.id_pedido AND pr.id_usuario = u.idusuario
         WHERE r2.vencimento < CURDATE()
           AND r2.status NOT IN ('PAGO','QUITADO') AND r2.excluido = 'N') AS vlr_inadimplencia,
        (SELECT COALESCE(SUM(ip.quantidade * COALESCE(pr2.vlr_custo, 0)), 0)
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
      GROUP BY u.idusuario, u.nomeusu, u.vlr_meta, u.rota_vendedor
      ORDER BY faturamento DESC
    `, [dtini, dtfim, diAnt, dfAnt, dtini, dtfim, dtini, dtfim]);

    // Primeira passagem: calcular métricas brutas
    const base = rows.map((r, idx) => {
      const fat    = Number(r.faturamento);
      const custo  = Number(r.custo_total);
      const fatAnt = Number(r.faturamento_anterior);
      const inad   = Number(r.vlr_inadimplencia);
      const cart   = Number(r.total_carteira);
      const posit  = Number(r.clientes_positivados);
      const meta   = Number(r.meta);

      const positivacaoPct   = cart > 0 ? (posit / cart) * 100 : 0;
      const crescimentoPct   = fatAnt > 0 ? ((fat - fatAnt) / fatAnt) * 100 : 0;
      const inadimplenciaPct = fat > 0 ? (inad / fat) * 100 : 0;
      const margemPct        = (fat > 0 && custo > 0) ? ((fat - custo) / fat) * 100 : 0;
      const metaPct          = meta > 0 ? (fat / meta) * 100 : null;
      const score = calcScore({ margemPct, positivacaoPct, metaPct, crescimentoPct, inadimplenciaPct });

      return {
        posicao_fat: idx + 1,
        id:                   r.id,
        nome:                 r.nome,
        rota:                 r.rota || '',
        total_pedidos:        Number(r.total_pedidos),
        faturamento:          fat,
        ticket_medio:         Number(r.ticket_medio),
        total_carteira:       cart,
        clientes_positivados: posit,
        total_visitas:        Number(r.total_visitas),
        meta,
        score,
        positivacao_pct:    Math.round(positivacaoPct * 10) / 10,
        crescimento_pct:    Math.round(crescimentoPct * 10) / 10,
        inadimplencia_pct:  Math.round(inadimplenciaPct * 10) / 10,
        margem_pct:         custo > 0 ? Math.round(margemPct * 10) / 10 : null,
        meta_pct:           metaPct !== null ? Math.round(metaPct * 10) / 10 : null,
      };
    });

    // Segunda passagem: conquistas (precisam do array completo para conquistas relativas)
    const representantes = base.map(r => ({
      ...r,
      conquistas: computeConquistas(r, base),
    }));

    // Pódio por score
    const podio = [...representantes]
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((r, i) => ({ ...r, posicao_score: i + 1 }));

    res.json({ representantes, podio, periodo: { dtini, dtfim } });
  } catch (err) {
    console.error('[gamificacao/ranking]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /metas ───────────────────────────────────────────────────────────────
router.get('/metas', async (req, res) => {
  try {
    const pool = getPool();
    const hoje = new Date();
    const mesIni = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-01`;
    const ultimoDia = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
    const diaAtual = hoje.getDate();
    const mesNome = hoje.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

    const [rows] = await pool.query(`
      SELECT
        u.idusuario AS id,
        u.nomeusu   AS nome,
        COALESCE(u.vlr_meta, 0) AS meta,
        COALESCE(SUM(p.vlrtotalpedido), 0) AS faturamento_mes
      FROM usuarios u
      LEFT JOIN pedidos p ON p.id_usuario = u.idusuario
        AND p.data_abertura BETWEEN ? AND ?
        AND p.excluido = 'N'
        AND p.situacao_pedido NOT IN ('CANCELADO')
      WHERE u.excluido = 'N' AND u.situacao = 'ATIVO' AND u.vlr_meta > 0
      GROUP BY u.idusuario, u.nomeusu, u.vlr_meta
      ORDER BY (COALESCE(SUM(p.vlrtotalpedido), 0) / u.vlr_meta) DESC
    `, [mesIni, hoje.toISOString().slice(0, 10)]);

    const metas = rows.map(r => {
      const fat  = Number(r.faturamento_mes);
      const meta = Number(r.meta);
      const pct  = meta > 0 ? (fat / meta) * 100 : 0;
      const projetado = diaAtual > 0 ? Math.round((fat / diaAtual) * ultimoDia) : fat;
      const pctProjetado = meta > 0 ? (projetado / meta) * 100 : 0;

      let status = 'danger';
      if (pct >= 100)     status = 'success';
      else if (pct >= 75) status = 'on-track';
      else if (pct >= 50) status = 'warning';

      return {
        id: r.id, nome: r.nome, meta, faturamento: fat,
        pct: Math.round(pct * 10) / 10,
        projetado,
        pct_projetado: Math.round(pctProjetado * 10) / 10,
        faltam: Math.max(0, meta - fat),
        status,
      };
    });

    res.json({ metas, mes: mesNome, dia_atual: diaAtual, dias_mes: ultimoDia });
  } catch (err) {
    console.error('[gamificacao/metas]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
