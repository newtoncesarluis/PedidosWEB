const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

// Aplica authMiddleware em todas as rotas deste router
router.use(authMiddleware);

// ─── GET /api/mobile/home ────────────────────────────────────────────────────
router.get('/home', async (req, res) => {
  try {
    const pool = getPool();
    const userId = req.user?.id;
    const userName = req.user?.name || '';

    const [resumo] = await pool.query(
      `SELECT COUNT(*) as qtd_pedidos,
              COALESCE(SUM(vlrtotalpedido), 0) as total_dia
       FROM pedidos
       WHERE DATE(data_abertura) = CURDATE()
         AND excluido = 'N'
         AND (idusuario = ? OR nome_vendedor LIKE ?)`,
      [userId, `%${userName}%`]
    ).catch(() => [[{ qtd_pedidos: 0, total_dia: 0 }]]);

    const [ultimos] = await pool.query(
      `SELECT p.id, p.nome_cliente, p.vlrtotalpedido, p.tipo_pedido,
              p.data_abertura, p.situacao
       FROM pedidos p
       WHERE p.excluido = 'N'
       ORDER BY p.id DESC LIMIT 5`
    ).catch(() => [[]]);

    res.json({
      qtd_pedidos: resumo[0]?.qtd_pedidos || 0,
      total_dia: resumo[0]?.total_dia || 0,
      ultimos_pedidos: ultimos || []
    });
  } catch {
    res.json({ qtd_pedidos: 0, total_dia: 0, ultimos_pedidos: [] });
  }
});

// ─── GET /api/mobile/clientes?q=termo ───────────────────────────────────────
router.get('/clientes', async (req, res) => {
  try {
    const pool   = getPool();
    const q      = req.query.q || '';
    const limit  = Math.min(parseInt(req.query.limit)  || 20, 100);
    const offset = Math.max(parseInt(req.query.offset) || 0,   0);
    const excWhere = `(c.excluido = 'N' OR c.excluido IS NULL OR c.excluido = '')`;

    let rows, totalRows;

    if (!q.trim()) {
      [[{ total: totalRows }]] = await pool.query(
        `SELECT COUNT(*) AS total FROM clientes c WHERE ${excWhere}`
      ).catch(() => [[{ total: 0 }]]);

      [rows] = await pool.query(
        `SELECT c.id, c.nome, c.apelido, c.cidade, c.uf,
                c.foneprincipal AS telefone, c.cpf, c.status
         FROM clientes c WHERE ${excWhere}
         ORDER BY c.nome ASC LIMIT ? OFFSET ?`,
        [limit, offset]
      ).catch(() => [[]]);
    } else {
      const like = `%${q}%`;
      const qWhere = `AND (c.nome LIKE ? OR c.cpf LIKE ? OR c.foneprincipal LIKE ? OR c.apelido LIKE ?)`;

      [[{ total: totalRows }]] = await pool.query(
        `SELECT COUNT(*) AS total FROM clientes c WHERE ${excWhere} ${qWhere}`,
        [like, like, like, like]
      ).catch(() => [[{ total: 0 }]]);

      [rows] = await pool.query(
        `SELECT c.id, c.nome, c.apelido, c.cidade, c.uf,
                c.foneprincipal AS telefone, c.cpf, c.status
         FROM clientes c WHERE ${excWhere} ${qWhere}
         ORDER BY c.nome LIMIT ? OFFSET ?`,
        [like, like, like, like, limit, offset]
      ).catch(() => [[]]);
    }

    res.json({ clientes: rows || [], total: totalRows || 0, limit, offset });
  } catch (err) {
    console.error('[mobile/clientes]', err.message);
    res.status(500).json({ clientes: [], total: 0, error: err.message });
  }
});

// ─── GET /api/mobile/clientes/:id ────────────────────────────────────────────
router.get('/clientes/:id', async (req, res) => {
  try {
    const pool = getPool();
    const id = req.params.id;

    const [clienteRows] = await pool.query(
      `SELECT id, nome, apelido, tipo_pessoa, cpf, foneprincipal, fonesecundario,
              email, cep, endereco, numero_end, bairro, cidade, uf, status, dtcadastro
       FROM clientes
       WHERE id = ? AND (excluido = 'N' OR excluido IS NULL OR excluido = '')
       LIMIT 1`,
      [id]
    ).catch(() => [[]]);

    if (!clienteRows[0]) {
      return res.status(404).json({ error: 'Cliente não encontrado' });
    }

    const c = clienteRows[0];
    res.json({
      id:       c.id,
      nome:     c.nome,
      apelido:  c.apelido,
      cnpj:     c.cpf,
      telefone: c.foneprincipal,
      telefone2: c.fonesecundario,
      email:    c.email,
      endereco: [c.endereco, c.numero_end].filter(Boolean).join(', '),
      cidade:   c.cidade,
      uf:       c.uf,
      situacao: c.status === 'A' ? 'ATIVO' : c.status === 'I' ? 'INATIVO' : (c.status || ''),
      dtcadastro: c.dtcadastro,
      ultimos_pedidos: []
    });
  } catch {
    res.json({ cliente: null, ultimos_pedidos: [] });
  }
});

// ─── POST /api/mobile/clientes (alias para /api/clientes) ────────────────────
// O mobile.html usa /api/clientes diretamente para o cadastro completo.
// Esta rota permanece para compatibilidade com cadastro rápido legado.
router.post('/clientes', async (req, res) => {
  try {
    const pool = getPool();
    const { nome, telefone, cnpj, cidade, uf } = req.body;

    if (!nome?.trim()) return res.status(400).json({ error: 'nome é obrigatório' });

    const [result] = await pool.query(
      `INSERT INTO clientes (nome, foneprincipal, cpf, cidade, uf, status, excluido, dtcadastro)
       VALUES (?, ?, ?, ?, ?, 'A', 'N', CURDATE())`,
      [nome.trim(), telefone || null, cnpj || null, cidade || null, uf || null]
    );

    res.status(201).json({ ok: true, id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/mobile/produtos?q=termo ───────────────────────────────────────
router.get('/produtos', async (req, res) => {
  try {
    const pool = getPool();
    const q = req.query.q || '';
    const like = `%${q}%`;

    const [rows] = await pool.query(
      `SELECT p.idproduto as id, p.codigo, p.descricao,
              p.preco_venda as preco, p.estoque_atual as estoque,
              p.unidade
       FROM produtos p
       WHERE p.excluido = 'N' AND p.ativo = 'S'
         AND (p.descricao LIKE ? OR p.codigo LIKE ?)
       ORDER BY p.descricao LIMIT 20`,
      [like, like]
    ).catch(() => [[]]);

    res.json({ produtos: rows || [] });
  } catch {
    res.json({ produtos: [] });
  }
});

// ─── GET /api/mobile/formas-pagto ────────────────────────────────────────────
router.get('/formas-pagto', async (req, res) => {
  try {
    const pool = getPool();

    const [rows] = await pool.query(
      `SELECT id, descricao FROM formas_pagto
       WHERE excluido = 'N' AND ativo = 'S'
       ORDER BY descricao`
    ).catch(() => [null]);

    if (rows === null || rows === undefined) {
      // Tabela não existe — retorna lista padrão
      return res.json({
        formas: [
          { id: 1, descricao: 'À Vista' },
          { id: 2, descricao: '30 dias' },
          { id: 3, descricao: '60 dias' }
        ]
      });
    }

    res.json({ formas: rows || [] });
  } catch {
    res.json({
      formas: [
        { id: 1, descricao: 'À Vista' },
        { id: 2, descricao: '30 dias' },
        { id: 3, descricao: '60 dias' }
      ]
    });
  }
});

// ─── GET /api/mobile/meus-pedidos ────────────────────────────────────────────
router.get('/meus-pedidos', async (req, res) => {
  try {
    const pool = getPool();
    const userId = req.user?.id;
    const userName = req.user?.name || '';

    const [rows] = await pool.query(
      `SELECT p.id, p.nome_cliente, p.vlrtotalpedido,
              p.data_abertura, p.situacao, p.tipo_pedido,
              p.numero_pedido
       FROM pedidos p
       WHERE p.excluido = 'N'
         AND (p.idusuario = ? OR p.nome_vendedor = ?)
       ORDER BY p.id DESC LIMIT 50`,
      [userId, userName]
    ).catch(() => [[]]);

    res.json({ pedidos: rows || [] });
  } catch {
    res.json({ pedidos: [] });
  }
});

// ─── GET /api/mobile/pedidos/:id ─────────────────────────────────────────────
router.get('/pedidos/:id', async (req, res) => {
  try {
    const pool = getPool();
    const id = req.params.id;

    const [rows] = await pool.query(
      `SELECT p.*,
              i.idproduto, i.descricao, i.quantidade, i.preco_unitario, i.total_item
       FROM pedidos p
       LEFT JOIN itens_pedido i ON i.idpedido = p.id AND i.excluido = 'N'
       WHERE p.id = ? AND p.excluido = 'N'`,
      [id]
    ).catch(() => [[]]);

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }

    // Separa dados do pedido dos itens
    const { idproduto, descricao, quantidade, preco_unitario, total_item, ...pedidoData } = rows[0];

    const itens = rows
      .filter(r => r.idproduto !== null && r.idproduto !== undefined)
      .map(r => ({
        idproduto: r.idproduto,
        descricao: r.descricao,
        quantidade: r.quantidade,
        preco_unitario: r.preco_unitario,
        total_item: r.total_item
      }));

    res.json({ pedido: pedidoData, itens });
  } catch {
    res.json({ pedido: null, itens: [] });
  }
});

module.exports = router;
