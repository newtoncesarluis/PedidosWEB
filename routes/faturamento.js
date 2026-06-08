const express = require('express');
const router  = express.Router();
const { getPool } = require('../config/database');
const { listVendedoresVisiveis } = require('../config/vendedor-visibilidade');

function visFilter(user) {
  const isAdmin    = user?.perfil == 1;
  const perm       = user?.permissoes || {};
  const acessaTodos = isAdmin ? 'S' : (perm.acessartodosclientes || '');
  const eGerente   = !isAdmin && perm.gerentecomercial === 'S';
  const uid        = user?.id || 0;

  if (isAdmin || acessaTodos === 'S') return { where: '', params: [] };
  if (eGerente) return {
    where: ` AND (p.id_usuario = ? OR p.id_usuario IN (SELECT idusuario FROM usuarios WHERE id_gerente = ? AND excluido = 'N'))`,
    params: [uid, uid]
  };
  return { where: ` AND p.id_usuario = ?`, params: [uid] };
}

function dateFilter(dt_ini, dt_fim, col = 'p.data_faturado') {
  const w = []; const p = [];
  if (dt_ini) { w.push(`${col} >= ?`); p.push(dt_ini); }
  if (dt_fim) { w.push(`${col} <= ?`); p.push(dt_fim); }
  return { where: w.map(x => ` AND ${x}`).join(''), params: p };
}

// ── KPIs ──────────────────────────────────────────────────────────────────────
router.get('/resumo', async (req, res) => {
  try {
    const pool = getPool();
    const { dt_ini, dt_fim, id_vendedor, id_fornecedor } = req.query;
    const vis = visFilter(req.user);
    const df  = dateFilter(dt_ini, dt_fim);

    let extra = vis.where + df.where;
    let params = [...vis.params, ...df.params];
    if (id_vendedor)  { extra += ' AND p.id_usuario = ?';    params.push(id_vendedor); }
    if (id_fornecedor){ extra += ' AND p.cod_fornecedor = ?'; params.push(id_fornecedor); }

    const baseWhere = `WHERE COALESCE(p.excluido,'N')='N' AND p.informado_faturamento='S'${extra}`;

    const [[fat]] = await pool.query(
      `SELECT
         COUNT(*) AS qt_faturados,
         SUM(p.vlr_faturado) AS total_faturado,
         SUM(p.vlrtotalpedido) AS total_pedido,
         SUM(p.vlr_faturado - p.vlrtotalpedido) AS diferenca,
         AVG(DATEDIFF(p.data_faturado, p.data_abertura)) AS tempo_medio,
         SUM(CASE WHEN p.notarecebida='S' THEN 1 ELSE 0 END) AS notas_recebidas,
         SUM(CASE WHEN COALESCE(p.notarecebida,'N')='N' THEN 1 ELSE 0 END) AS notas_pendentes
       FROM pedidos p ${baseWhere}`,
      params
    );

    // Pedidos aprovados sem faturamento no período de abertura
    const dfAb = dateFilter(dt_ini, dt_fim, 'p.data_abertura');
    let extraAb = vis.where + dfAb.where;
    let paramsAb = [...vis.params, ...dfAb.params];
    if (id_vendedor)  { extraAb += ' AND p.id_usuario = ?';    paramsAb.push(id_vendedor); }
    if (id_fornecedor){ extraAb += ' AND p.cod_fornecedor = ?'; paramsAb.push(id_fornecedor); }

    const [[pend]] = await pool.query(
      `SELECT COUNT(*) AS qt_aguardando, SUM(p.vlrtotalpedido) AS vlr_aguardando
       FROM pedidos p
       WHERE COALESCE(p.excluido,'N')='N'
         AND p.situacao_pedido IN ('APROVADO','ENVIADO')
         AND COALESCE(p.informado_faturamento,'N')='N'${extraAb}`,
      paramsAb
    );

    res.json({ fat: fat || {}, pend: pend || {} });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── EVOLUÇÃO MENSAL ───────────────────────────────────────────────────────────
router.get('/evolucao', async (req, res) => {
  try {
    const pool = getPool();
    const { meses = 12, id_vendedor, id_fornecedor } = req.query;
    const vis = visFilter(req.user);

    let extra = vis.where;
    let params = [...vis.params];
    if (id_vendedor)  { extra += ' AND p.id_usuario = ?';    params.push(id_vendedor); }
    if (id_fornecedor){ extra += ' AND p.cod_fornecedor = ?'; params.push(id_fornecedor); }

    const [rows] = await pool.query(
      `SELECT
         DATE_FORMAT(p.data_faturado,'%Y-%m') AS mes,
         COUNT(*) AS qt,
         SUM(p.vlr_faturado) AS total_faturado,
         SUM(p.vlrtotalpedido) AS total_pedido
       FROM pedidos p
       WHERE COALESCE(p.excluido,'N')='N'
         AND p.informado_faturamento='S'
         AND p.data_faturado >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
         ${extra}
       GROUP BY mes ORDER BY mes`,
      [parseInt(meses) || 12, ...params]
    );
    res.json({ rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── TOP FORNECEDORES ──────────────────────────────────────────────────────────
router.get('/por-fornecedor', async (req, res) => {
  try {
    const pool = getPool();
    const { dt_ini, dt_fim, id_vendedor } = req.query;
    const vis = visFilter(req.user);
    const df  = dateFilter(dt_ini, dt_fim);

    let extra = vis.where + df.where;
    let params = [...vis.params, ...df.params];
    if (id_vendedor) { extra += ' AND p.id_usuario = ?'; params.push(id_vendedor); }

    const [rows] = await pool.query(
      `SELECT
         p.nome_fornecedor,
         COUNT(*) AS qt,
         SUM(p.vlr_faturado) AS total_faturado,
         SUM(p.vlrtotalpedido) AS total_pedido,
         ROUND(AVG(DATEDIFF(p.data_faturado, p.data_abertura)),1) AS tempo_medio
       FROM pedidos p
       WHERE COALESCE(p.excluido,'N')='N' AND p.informado_faturamento='S'${extra}
       GROUP BY p.nome_fornecedor
       ORDER BY total_faturado DESC LIMIT 12`,
      params
    );
    res.json({ rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── TOP VENDEDORES ────────────────────────────────────────────────────────────
router.get('/por-vendedor', async (req, res) => {
  try {
    const pool = getPool();
    const { dt_ini, dt_fim, id_fornecedor } = req.query;
    const vis = visFilter(req.user);
    const df  = dateFilter(dt_ini, dt_fim);

    let extra = vis.where + df.where;
    let params = [...vis.params, ...df.params];
    if (id_fornecedor) { extra += ' AND p.cod_fornecedor = ?'; params.push(id_fornecedor); }

    const [rows] = await pool.query(
      `SELECT
         COALESCE(u.nomeusu, p.nome_vendedor) AS vendedor,
         COUNT(*) AS qt,
         SUM(p.vlr_faturado) AS total_faturado,
         ROUND(AVG(DATEDIFF(p.data_faturado, p.data_abertura)),1) AS tempo_medio
       FROM pedidos p
       LEFT JOIN usuarios u ON p.id_usuario = u.idusuario
       WHERE COALESCE(p.excluido,'N')='N' AND p.informado_faturamento='S'${extra}
       GROUP BY p.id_usuario, vendedor
       ORDER BY total_faturado DESC LIMIT 10`,
      params
    );
    res.json({ rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── ALERTAS ───────────────────────────────────────────────────────────────────
router.get('/alertas', async (req, res) => {
  try {
    const pool = getPool();
    const { dias_sem_faturar = 10, dias_sem_nota = 15, id_vendedor, id_fornecedor } = req.query;
    const vis = visFilter(req.user);

    let extra = vis.where;
    let params = [...vis.params];
    if (id_vendedor)  { extra += ' AND p.id_usuario = ?';    params.push(id_vendedor); }
    if (id_fornecedor){ extra += ' AND p.cod_fornecedor = ?'; params.push(id_fornecedor); }

    const [semFaturar] = await pool.query(
      `SELECT p.id, p.numero, p.nome_cliente, p.nome_fornecedor, p.nome_vendedor,
              p.vlrtotalpedido, p.data_abertura, p.data_aprovacao,
              DATEDIFF(CURDATE(), COALESCE(p.data_aprovacao, p.data_abertura)) AS dias_espera
       FROM pedidos p
       WHERE COALESCE(p.excluido,'N')='N'
         AND p.situacao_pedido IN ('APROVADO','ENVIADO')
         AND COALESCE(p.informado_faturamento,'N')='N'
         AND DATEDIFF(CURDATE(), COALESCE(p.data_aprovacao, p.data_abertura)) >= ?
         ${extra}
       ORDER BY dias_espera DESC LIMIT 25`,
      [parseInt(dias_sem_faturar) || 10, ...params]
    );

    const [semNota] = await pool.query(
      `SELECT p.id, p.numero, p.nome_cliente, p.nome_fornecedor, p.numeronf,
              p.vlr_faturado, p.data_faturado,
              DATEDIFF(CURDATE(), p.data_faturado) AS dias_sem_nota
       FROM pedidos p
       WHERE COALESCE(p.excluido,'N')='N'
         AND p.informado_faturamento='S'
         AND COALESCE(p.notarecebida,'N')='N'
         AND DATEDIFF(CURDATE(), p.data_faturado) >= ?
         ${extra}
       ORDER BY dias_sem_nota DESC LIMIT 25`,
      [parseInt(dias_sem_nota) || 15, ...params]
    );

    res.json({ sem_faturar: semFaturar, sem_nota: semNota });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── LISTA PEDIDOS FATURADOS ───────────────────────────────────────────────────
router.get('/lista', async (req, res) => {
  try {
    const pool = getPool();
    const { dt_ini, dt_fim, id_vendedor, id_fornecedor, page = 1, limit = 50 } = req.query;
    const vis = visFilter(req.user);
    const df  = dateFilter(dt_ini, dt_fim);
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let extra = vis.where + df.where;
    let params = [...vis.params, ...df.params];
    if (id_vendedor)  { extra += ' AND p.id_usuario = ?';    params.push(id_vendedor); }
    if (id_fornecedor){ extra += ' AND p.cod_fornecedor = ?'; params.push(id_fornecedor); }

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM pedidos p
       WHERE COALESCE(p.excluido,'N')='N' AND p.informado_faturamento='S'${extra}`,
      params
    );

    const [rows] = await pool.query(
      `SELECT p.id, p.numero, p.nome_cliente, p.nome_fornecedor,
              COALESCE(u.nomeusu, p.nome_vendedor) AS vendedor,
              p.numeronf, p.serie_nf, p.data_abertura, p.data_faturado,
              p.vlrtotalpedido, p.vlr_faturado,
              (p.vlr_faturado - p.vlrtotalpedido) AS diferenca,
              DATEDIFF(p.data_faturado, p.data_abertura) AS dias_faturar,
              p.notarecebida
       FROM pedidos p
       LEFT JOIN usuarios u ON p.id_usuario = u.idusuario
       WHERE COALESCE(p.excluido,'N')='N' AND p.informado_faturamento='S'${extra}
       ORDER BY p.data_faturado DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    res.json({ rows, total, pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── LOOKUP VENDEDORES (para o filtro) ─────────────────────────────────────────
router.get('/lookup/vendedores', async (req, res) => {
  try {
    const pool = getPool();
    const rows = await listVendedoresVisiveis(pool, req);
    res.json({ rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
