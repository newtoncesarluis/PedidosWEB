const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');

// GET /api/mobile/resumo-dia — KPIs do dia para o top bar do shell
router.get('/resumo-dia', async (req, res) => {
  try {
    if (!req.user || !(req.user.id || req.user.idusuario)) return res.status(401).json({ error: 'Não autenticado' });

    const pool = getPool();
    const user = req.user;
    const idEmpresa = parseInt(user.id_empresa || 1, 10);
    const idUsuario = parseInt(user.id || user.idusuario || 0, 10);
    const isAdmin = user.perfil === '1' || user.role === 'admin';

    const [[pedidos], [visitas]] = await Promise.all([
      isAdmin
        ? pool.query(
            `SELECT COUNT(*) AS qt, COALESCE(SUM(vlrtotalpedido), 0) AS total
             FROM pedidos p
             WHERE DATE(p.data_abertura) = CURDATE() AND p.id_empresa = ? AND COALESCE(p.excluido,'N')='N'`,
            [idEmpresa]
          ).catch(() => [[{ qt: 0, total: 0 }]])
        : pool.query(
            `SELECT COUNT(*) AS qt, COALESCE(SUM(vlrtotalpedido), 0) AS total
             FROM pedidos p
             WHERE DATE(p.data_abertura) = CURDATE() AND p.id_empresa = ? AND COALESCE(p.excluido,'N')='N' AND p.id_usuario = ?`,
            [idEmpresa, idUsuario]
          ).catch(() => [[{ qt: 0, total: 0 }]]),
      isAdmin
        ? pool.query(
            `SELECT COUNT(*) AS qt FROM visitas v
             WHERE v.data_visita = CURDATE() AND COALESCE(v.exluido,'N')='N'`
          ).catch(() => [[{ qt: 0 }]])
        : pool.query(
            `SELECT COUNT(*) AS qt FROM visitas v
             WHERE v.data_visita = CURDATE() AND COALESCE(v.exluido,'N')='N' AND v.id_vendedor = ?`,
            [idUsuario]
          ).catch(() => [[{ qt: 0 }]]),
    ]);

    res.json({
      pedidos:   pedidos[0]?.qt ?? 0,
      valor:     parseFloat(pedidos[0]?.total ?? 0),
      visitas:   visitas[0]?.qt ?? 0,
    });
  } catch (err) {
    res.status(500).json({ pedidos: 0, valor: 0, visitas: 0 });
  }
});

// ── GET /api/mobile/dados-offline — batch para pre-cache no IndexedDB ─────────
// Retorna clientes do vendedor + produtos ativos em uma única chamada.
// Pensado para ser chamado ao abrir o app com internet e armazenar tudo offline.
router.get('/dados-offline', async (req, res) => {
  try {
    if (!req.user || !(req.user.id || req.user.idusuario)) return res.status(401).json({ error: 'Não autenticado' });

    const pool    = getPool();
    const user    = req.user;
    const idVend  = parseInt(user.id || user.idusuario || 0, 10);
    const isAdmin = user.perfil === '1' || user.role === 'admin';

    // Detecta tabela de produtos
    const [prodRows] = await pool.query(`SHOW TABLES LIKE 'produto'`);
    const prodTb = prodRows.length ? 'produto' : 'produtos';

    // Clientes: admin vê todos, vendedor só a própria carteira
    const clienteWhere = isAdmin
      ? `WHERE COALESCE(NULLIF(TRIM(c.excluido),''),'N') = 'N'`
      : `WHERE COALESCE(NULLIF(TRIM(c.excluido),''),'N') = 'N' AND c.cod_vendedor = ${pool.escape(idVend)}`;

    const [clientes, produtos] = await Promise.all([
      pool.query(`
        SELECT
          c.id, c.nome, c.apelido, c.cpf, c.tipo_pessoa,
          c.foneprincipal, c.fonesecundario, c.celularcomprador,
          c.email, c.cidade, c.uf, c.bairro, c.endereco,
          c.cod_vendedor, c.status, c.latitude, c.longitude,
          c.limite_credito, c.venda_suspensa
        FROM clientes c
        ${clienteWhere}
        ORDER BY c.nome
        LIMIT 2000
      `).then(([rows]) => rows).catch(() => []),

      pool.query(`
        SELECT
          p.id, p.nome, p.referencia,
          COALESCE(p.vlr_venda, 0)   AS preco_venda,
          COALESCE(p.vlr_custo, 0)   AS preco_custo,
          COALESCE(p.estoque, 0)     AS estoque,
          p.unidade, p.ativo,
          p.cod_fornecedor
        FROM ${prodTb} p
        WHERE COALESCE(NULLIF(TRIM(p.excluido),''),'N') = 'N'
          AND (p.ativo IS NULL OR p.ativo NOT IN ('N','NAO','INATIVO'))
        ORDER BY p.nome
        LIMIT 3000
      `).then(([rows]) => rows).catch(() => []),
    ]);

    res.json({
      clientes,
      produtos,
      vendedor_id:  idVend,
      is_admin:     isAdmin,
      synced_at:    new Date().toISOString(),
      totais: {
        clientes:  clientes.length,
        produtos:  produtos.length,
      },
    });
  } catch (err) {
    console.error('[mobile/dados-offline]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
