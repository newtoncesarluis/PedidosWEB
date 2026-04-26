const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');

let _tablesEnsured = false;
async function ensureTables(pool) {
  if (_tablesEnsured) return;
  _tablesEnsured = true;
  
  // ─── Índices de Performance ────────────────────────────────────────────────
  const indexes = [
    { name: 'idx_ped_data', col: 'data_abertura' },
    { name: 'idx_ped_tipo', col: 'tipo_pedido' },
    { name: 'idx_ped_sit',  col: 'situacao_pedido' },
    { name: 'idx_ped_exc',  col: 'excluido' },
    { name: 'idx_ped_user', col: 'id_usuario' }
  ];
  for (const idx of indexes) {
    await pool.query(`ALTER TABLE pedidos ADD INDEX IF NOT EXISTS ${idx.name} (${idx.col})`).catch(() => {});
  }
  await pool.query(`ALTER TABLE itensped ADD INDEX IF NOT EXISTS idx_it_num (numpedido)`).catch(() => {});

  // ─── Tabela Principal de Pedidos (Expandida) ───────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pedidos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      numero VARCHAR(50),
      data_abertura DATE,
      hora_abertura TIME,
      id_usuario INT,
      nome_vendedor VARCHAR(100),
      cod_cliente INT,
      nome_cliente VARCHAR(100),
      cod_fornecedor INT, -- Fábrica / Representada
      nome_fornecedor VARCHAR(100),
      cod_transportadora INT,
      nome_transportadora VARCHAR(100),
      tipo_frete VARCHAR(10), -- CIF / FOB
      ped_compras VARCHAR(100), -- Ordem de Compra
      comprador VARCHAR(100),
      data_entrega DATE,
      condicao_pagto VARCHAR(100),
      forma_pagto VARCHAR(100),
      vlrsubtotal DECIMAL(15,2) DEFAULT 0,
      vlrdesconto DECIMAL(15,2) DEFAULT 0,
      vlrtotalimposto DECIMAL(15,2) DEFAULT 0,
      vlrfrete DECIMAL(15,2) DEFAULT 0,
      vlrjuros DECIMAL(15,2) DEFAULT 0,
      vlrtotalpedido DECIMAL(15,2) DEFAULT 0,
      situacao_pedido VARCHAR(50) DEFAULT 'ABERTO',
      origem_comissao VARCHAR(20),
      obs TEXT,
      excluido VARCHAR(1) DEFAULT 'N',
      dtcadastro DATE,
      dtalterado DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3
  `).catch(err => console.error('Erro ao expandir pedidos:', err));

  // ─── Tabela de Preferências de Grid (Por Usuário) ───────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS preferencias_grid (
      id INT AUTO_INCREMENT PRIMARY KEY,
      id_usuario INT NOT NULL,
      nome_grid VARCHAR(50) NOT NULL,
      config_json TEXT NOT NULL,
      dt_alterado DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unq_user_grid (id_usuario, nome_grid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3
  `).catch(err => console.error('Erro ao criar preferencias_grid:', err));

  // Tenta criar colunas faltantes para suporte Diamond Flow
  const colsToAdd = [
    { name: 'tipo_pedido', type: "VARCHAR(50) DEFAULT 'PEDIDO'" },
    { name: 'nome_empresa', type: "VARCHAR(100)" },
    { name: 'origem', type: "VARCHAR(50)" },
    { name: 'vlrtotalbruto', type: "DECIMAL(15,2) DEFAULT 0" },
    { name: 'vlr_total_comissao', type: "DECIMAL(15,2) DEFAULT 0" },
    { name: 'total_peso', type: "DECIMAL(15,4) DEFAULT 0" },
    { name: 'total_qt', type: "DECIMAL(15,4) DEFAULT 0" },
    { name: 'vlrtotalitens', type: "DECIMAL(15,2) DEFAULT 0" },
    { name: 'qt_parcelas', type: "INT DEFAULT 1" },
    { name: 'prazo_pagto', type: "VARCHAR(100)" },
    { name: 'nome_transp', type: "VARCHAR(100)" },
    { name: 'coduser_digitacao', type: "INT" },
    { name: 'id_empresa', type: "INT" },
    { name: 'puxada', type: "VARCHAR(1) DEFAULT 'N'" },
    { name: 'tipo_documento', type: "VARCHAR(20)" }
  ];

  for (const c of colsToAdd) {
    try {
      await pool.query(`ALTER TABLE pedidos ADD COLUMN ${c.name} ${c.type}`);
    } catch(e) { /* Coluna provavelmente já existe */ }
  }

  // ─── Tabela de Logs de Auditoria ──────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS logs_pedidos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      id_pedido INT NOT NULL,
      id_usuario INT NOT NULL,
      acao VARCHAR(100) NOT NULL, -- Ex: 'ALTERACAO', 'MUDANCA_STATUS'
      status_antigo VARCHAR(50),
      status_novo VARCHAR(50),
      detalhes TEXT,
      data_hora DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3
  `).catch(err => console.error('Erro ao criar logs_pedidos:', err));

  // ─── Índices de Performance ───────────────────────────────────────────────
  const indexesPerf = [
    `CREATE INDEX IF NOT EXISTS idx_ped_data_exc ON pedidos (excluido, data_abertura)`,
    `CREATE INDEX IF NOT EXISTS idx_ped_situacao ON pedidos (situacao_pedido)`,
    `CREATE INDEX IF NOT EXISTS idx_ped_tipo     ON pedidos (tipo_pedido)`,
    `CREATE INDEX IF NOT EXISTS idx_ped_usuario  ON pedidos (id_usuario)`,
    `CREATE INDEX IF NOT EXISTS idx_ped_cliente  ON pedidos (cod_cliente)`,
  ];
  for (const idx of indexesPerf) {
    await pool.query(idx).catch(() => {});
  }

  // ─── Tabela de Itens (Expandida) ──────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS itensped (
      id INT AUTO_INCREMENT PRIMARY KEY,
      numpedido VARCHAR(50),
      cod_produto INT,
      desc_prod VARCHAR(150),
      unidade VARCHAR(10),
      quantidade DECIMAL(15,4) DEFAULT 0,
      valor_unitario DECIMAL(15,4) DEFAULT 0,
      vlrtotal_itens DECIMAL(15,2) DEFAULT 0,
      
      -- Impostos e Logística (Delphi)
      st DECIMAL(15,2) DEFAULT 0,
      vlr_st DECIMAL(15,2) DEFAULT 0,
      ipi DECIMAL(15,2) DEFAULT 0,
      vlr_ipi DECIMAL(15,2) DEFAULT 0,
      icms DECIMAL(15,2) DEFAULT 0,
      vlr_icms DECIMAL(15,2) DEFAULT 0,
      
      valor_puxada DECIMAL(15,4) DEFAULT 0,
      total_puxada DECIMAL(15,2) DEFAULT 0,
      
      desconto1 DECIMAL(15,2) DEFAULT 0,
      desconto2 DECIMAL(15,2) DEFAULT 0,
      cor1 VARCHAR(50),
      cor2 VARCHAR(50),
      obsitemitenspedido TEXT,
      
      excluido VARCHAR(1) DEFAULT 'N'
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3
  `).catch(err => console.error('Erro ao expandir itensped:', err));
}

// GET /api/pedidos — Com Busca e Paginação
router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    await ensureTables(pool);
    
    const { 
      q, page = 1, limit = 50, status, tipo, dt_ini, dt_fim, id_vendedor,
      min_total, max_total, min_peso, max_peso,
      comprador, ped_compras, nome_transp, origem, nome_empresa,
      cod_cliente, id_cliente, cod_fornecedor, id_fornecedor,
      sort = 'p.id', dir = 'DESC',
      lat, lng, raio = 50
    } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    // ─── WHERE CLAUSE PARA A LISTA (Todos os filtros) ────────────────────────
    let whereClause = `WHERE (p.excluido = 'N' OR p.excluido IS NULL OR p.excluido = '')`;
    let params = [];
    
    // ─── WHERE CLAUSE PARA OS CARDS (Ignora o filtro de tipo/status clicado) ──
    let whereClauseCards = `WHERE (p.excluido = 'N' OR p.excluido IS NULL OR p.excluido = '')`;
    let paramsCards = [];
    
    if (q) {
      const qp = ` AND (p.numero LIKE ? OR p.nome_cliente LIKE ?)`;
      whereClause += qp; whereClauseCards += qp;
      params.push(`%${q}%`, `%${q}%`); paramsCards.push(`%${q}%`, `%${q}%`);
    }

    const addFilter = (col, val) => {
      whereClause += ` AND ${col} = ?`; whereClauseCards += ` AND ${col} = ?`;
      params.push(val); paramsCards.push(val);
    };

    if (cod_cliente) addFilter('p.cod_cliente', cod_cliente);
    if (id_cliente) addFilter('p.id_cliente', id_cliente);
    if (cod_fornecedor) addFilter('p.cod_fornecedor', cod_fornecedor);
    if (id_fornecedor) addFilter('p.id_fornecedor', id_fornecedor);

    if (status && status !== '' && status !== 'todos') {
      whereClause += ` AND p.situacao_pedido = ?`;
      params.push(status);
      // Mantemos nos cards também para os status básicos (Pendente/Aprovado/Cancelado)
      whereClauseCards += ` AND p.situacao_pedido = ?`;
      paramsCards.push(status);
    }

    if (tipo && tipo !== '' && tipo !== 'ALL') {
      whereClause += ` AND p.tipo_pedido = ?`;
      params.push(tipo);
      // NOTA: NÃO adicionamos o filtro de tipo em whereClauseCards para os cards não sumirem!
    }

    if (dt_ini) {
      whereClause += ` AND p.data_abertura >= ?`; whereClauseCards += ` AND p.data_abertura >= ?`;
      params.push(dt_ini); paramsCards.push(dt_ini);
    }
    if (dt_fim) {
      whereClause += ` AND p.data_abertura <= ?`; whereClauseCards += ` AND p.data_abertura <= ?`;
      params.push(dt_fim); paramsCards.push(dt_fim);
    }

    if (id_vendedor) addFilter('p.id_usuario', id_vendedor);

    // Filtros de Faixa
    if (min_total) { whereClause += ` AND p.vlrtotalpedido >= ?`; whereClauseCards += ` AND p.vlrtotalpedido >= ?`; params.push(parseFloat(min_total)); paramsCards.push(parseFloat(min_total)); }
    if (max_total) { whereClause += ` AND p.vlrtotalpedido <= ?`; whereClauseCards += ` AND p.vlrtotalpedido <= ?`; params.push(parseFloat(max_total)); paramsCards.push(parseFloat(max_total)); }
    if (min_peso)  { whereClause += ` AND p.total_peso >= ?`; whereClauseCards += ` AND p.total_peso >= ?`; params.push(parseFloat(min_peso)); paramsCards.push(parseFloat(min_peso)); }
    if (max_peso)  { whereClause += ` AND p.total_peso <= ?`; whereClauseCards += ` AND p.total_peso <= ?`; params.push(parseFloat(max_peso)); paramsCards.push(parseFloat(max_peso)); }

    // Filtros de Texto Específicos
    if (comprador)   { whereClause += ` AND p.comprador LIKE ?`; whereClauseCards += ` AND p.comprador LIKE ?`; params.push(`%${comprador}%`); paramsCards.push(`%${comprador}%`); }
    if (ped_compras) { whereClause += ` AND p.ped_compras LIKE ?`; whereClauseCards += ` AND p.ped_compras LIKE ?`; params.push(`%${ped_compras}%`); paramsCards.push(`%${ped_compras}%`); }
    if (nome_transp) { whereClause += ` AND p.nome_transp LIKE ?`; whereClauseCards += ` AND p.nome_transp LIKE ?`; params.push(`%${nome_transp}%`); paramsCards.push(`%${nome_transp}%`); }
    if (origem)      { whereClause += ` AND p.origem = ?`; whereClauseCards += ` AND p.origem = ?`; params.push(origem); paramsCards.push(origem); }
    if (nome_empresa){ whereClause += ` AND p.nome_empresa LIKE ?`; whereClauseCards += ` AND p.nome_empresa LIKE ?`; params.push(`%${nome_empresa}%`); paramsCards.push(`%${nome_empresa}%`); }
    
    let joinFilterClause = '';
    if (lat && lng) {
      joinFilterClause = 'LEFT JOIN clientes c ON p.cod_cliente = c.id';
      const haversine = `(6371 * acos(cos(radians(?)) * cos(radians(c.latitude)) * cos(radians(c.longitude) - radians(?)) + sin(radians(?)) * sin(radians(c.latitude))))`;
      whereClause += ` AND ${haversine} <= ?`;
      whereClauseCards += ` AND ${haversine} <= ?`;
      const latFloat = parseFloat(lat);
      const lngFloat = parseFloat(lng);
      const raioFloat = parseFloat(raio);
      params.push(latFloat, lngFloat, latFloat, raioFloat);
      paramsCards.push(latFloat, lngFloat, latFloat, raioFloat);
    }
    
    let totalItems = 0;
    try {
      const [countRows] = await pool.query(`SELECT COUNT(p.id) as total FROM pedidos p ${joinFilterClause} ${whereClause}`, params);
      totalItems = (countRows && countRows[0]) ? countRows[0].total : 0;
    } catch (e) {
      console.error('Erro ao contar pedidos:', e.message);
    }

    let statsRows = [{ total: 0, vlr_total: 0, pendentes: 0, aprovados: 0, cancelados: 0 }];
    let typeStats = [];
    try {
      const [ts] = await pool.query(`
        SELECT 
          tipo_pedido,
          COUNT(p.id) as total,
          SUM(p.vlrtotalpedido) as vlr_total,
          COUNT(CASE WHEN p.situacao_pedido = 'PENDENTE' THEN 1 END) as pendentes,
          COUNT(CASE WHEN p.situacao_pedido = 'APROVADO' THEN 1 END) as aprovados,
          COUNT(CASE WHEN p.situacao_pedido = 'CANCELADO' THEN 1 END) as cancelados
        FROM pedidos p
        ${joinFilterClause}
        ${whereClauseCards}
        GROUP BY tipo_pedido
      `, paramsCards);
      
      typeStats = Array.isArray(ts) ? ts : [];
      if (typeStats.length > 0) {
        statsRows = [{
          total:     typeStats.reduce((s,r) => s + Number(r.total || 0), 0),
          vlr_total: typeStats.reduce((s,r) => s + Number(r.vlr_total || 0), 0),
          pendentes: typeStats.reduce((s,r) => s + Number(r.pendentes || 0), 0),
          aprovados: typeStats.reduce((s,r) => s + Number(r.aprovados || 0), 0),
          cancelados:typeStats.reduce((s,r) => s + Number(r.cancelados || 0), 0),
        }];
      } else {
        const [fb] = await pool.query(`
          SELECT COUNT(p.id) as total, SUM(p.vlrtotalpedido) as vlr_total,
                 COUNT(CASE WHEN p.situacao_pedido = 'PENDENTE' THEN 1 END) as pendentes,
                 COUNT(CASE WHEN p.situacao_pedido = 'APROVADO' THEN 1 END) as aprovados,
                 COUNT(CASE WHEN p.situacao_pedido = 'CANCELADO' THEN 1 END) as cancelados
          FROM pedidos p ${joinFilterClause} ${whereClauseCards}
        `, paramsCards);
        statsRows = (fb && fb.length > 0) ? fb : statsRows;
        if (typeStats.length === 0 && statsRows[0]) {
          typeStats = [{ tipo_pedido: 'PEDIDO', total: statsRows[0].total, vlr_total: statsRows[0].vlr_total }];
        }
      }
    } catch (errType) {
      console.log('Nao foi possivel agrupar por tipo_pedido:', errType.message);
      try {
        const [fb] = await pool.query(`
          SELECT COUNT(p.id) as total, SUM(p.vlrtotalpedido) as vlr_total,
                 COUNT(CASE WHEN p.situacao_pedido = 'PENDENTE' THEN 1 END) as pendentes,
                 COUNT(CASE WHEN p.situacao_pedido = 'APROVADO' THEN 1 END) as aprovados,
                 COUNT(CASE WHEN p.situacao_pedido = 'CANCELADO' THEN 1 END) as cancelados
          FROM pedidos p ${joinFilterClause} ${whereClauseCards}
        `, paramsCards);
        statsRows = (fb && fb.length > 0) ? fb : statsRows;
        typeStats = [{ tipo_pedido: 'PEDIDO', total: statsRows[0].total, vlr_total: statsRows[0].vlr_total }];
      } catch (e2) {
        console.error('Falha crítica nas estatísticas:', e2.message);
      }
    }
    
    const allowedSort = ['p.id', 'p.numero', 'p.data_abertura', 'p.vlrtotalpedido', 'p.nome_cliente'];
    const orderCol = allowedSort.includes(sort) ? sort : 'p.id';
    const orderDir = dir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    let rows = [];
    try {
      const [r] = await pool.query(
        `SELECT p.*, u.nomeusu, c.cpf as cnpj_cliente, 
                c.latitude, c.longitude, c.endereco, c.cidade, c.id as id_cliente, c.apelido as fantasia_cliente
         FROM pedidos p 
         LEFT JOIN usuarios u ON p.id_usuario = u.idusuario
         LEFT JOIN clientes c ON p.cod_cliente = c.id
         ${whereClause}
         ORDER BY ${orderCol} ${orderDir} LIMIT ? OFFSET ?`,
        [...params, parseInt(limit) || 50, parseInt(offset) || 0]
      );
      rows = r;
    } catch(errJoin) {
      console.log('Falha no JOIN de usuarios/clientes:', errJoin.message);
      try {
        const [rFall] = await pool.query(
          `SELECT p.* FROM pedidos p ${whereClause} ORDER BY ${orderCol} ${orderDir} LIMIT ? OFFSET ?`,
          [...params, parseInt(limit) || 50, parseInt(offset) || 0]
        );
        rows = rFall;
      } catch (e3) {
        console.error('Falha na query fallback:', e3.message);
        rows = [];
      }
    }

    if (cod_cliente || id_cliente || cod_fornecedor || id_fornecedor) {
      for (let p of rows) {
        const [itens] = await pool.query(
          `SELECT i.cod_produto, i.desc_prod, i.quantidade, i.valor_unitario, i.vlrtotal_itens, i.unidade
           FROM itensped i WHERE i.numpedido = ? AND COALESCE(i.excluido, 'N') = 'N'`,
          [p.numero]
        ).catch(() => [[]]);
        p.itens = itens;

        const [parcelas] = await pool.query(
          `SELECT r.vencimento, r.valor, r.parcela, r.qt_parcelas
           FROM receber r WHERE r.numero = ? AND COALESCE(r.excluido, 'N') = 'N'
           ORDER BY r.parcela`,
          [p.numero]
        ).catch(() => [[]]);
        p.parcelas = parcelas;
      }
    }

    res.json({ 
      pedidos: rows,
      pagination: {
        totalItems,
        totalGlobal: (statsRows[0] && statsRows[0].total) || 0,
        valorGlobal: (statsRows[0] && statsRows[0].vlr_total) || 0,
        pendentes: (statsRows[0] && statsRows[0].pendentes) || 0,
        aprovados: (statsRows[0] && statsRows[0].aprovados) || 0,
        cancelados: (statsRows[0] && statsRows[0].cancelados) || 0,
        tipos: typeStats,
        totalPages: Math.ceil(totalItems / (parseInt(limit) || 50)),
        currentPage: parseInt(page) || 1,
        limit: parseInt(limit) || 50
      }
    });
  } catch (err) {
    console.error('ERRO GERAL PEDIDOS:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pedidos/lookup/vendedores
router.get('/lookup/vendedores', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(`
      SELECT 
        u.idusuario AS id, 
        u.nomeusu AS nome_vendedor, 
        u.nomeusu AS nome,
        p.acessartodosclientes, 
        p.alterardatapedido,
        u.rota_vendedor, 
        u.email, 
        u.comissaofixavendedor, 
        u.comissaogerente, 
        u.permitevendasemcomissao, 
        u.compartilhacomissaogerente,
        u.fonesecundario
      FROM usuarios u
      INNER JOIN perfil p ON p.id = u.idperfil
      WHERE u.excluido = 'N'
      AND (u.situacao = 'ATIVO' OR u.situacao IS NULL)
      AND p.excluido = 'N'
      AND p.p_vender = 'S'
      ORDER BY u.nomeusu
    `).catch(() => [[]]);
    res.json({ vendedores: rows });
  } catch (err) {
    res.json({ vendedores: [] });
  }
});

// GET /api/pedidos/lookup/tipos
router.get('/lookup/tipos', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(`
      SELECT id, gerafinanceiro, movimentaestoque, descricao as tipo_pedido, tratamento 
      FROM tipo_pedidos 
      WHERE excluido = 'N' AND situacao = 'A' 
      ORDER BY id
    `).catch(() => [[]]);
    res.json({ tipos: rows });
  } catch (err) {
    res.json({ tipos: [] });
  }
});

// GET /api/pedidos/lookup/tiposfrete
router.get('/lookup/tiposfrete', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(`
      SELECT p.* FROM tipo_frete p
      WHERE p.excluido = 'N'
      AND p.status = 'A'
      ORDER BY p.nome desc
    `).catch(() => [[]]);
    res.json({ tiposfrete: rows });
  } catch (err) {
    res.json({ tiposfrete: [] });
  }
});

// GET /api/pedidos/lookup/empresas
router.get('/lookup/empresas', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(`
      SELECT * FROM empresa 
      WHERE excluido = 'N' 
      ORDER BY Razao_empresa desc
    `).catch(() => [[]]);
    res.json({ empresas: rows });
  } catch (err) {
    res.json({ empresas: [] });
  }
});

// GET /api/pedidos/produtos/busca — autocomplete simples
router.get('/produtos/busca', async (req, res) => {
  try {
    const pool = getPool();
    const { q = '', limit = 15, id_fornecedor } = req.query;
    const lk = `%${q.trim()}%`;

    const params = [];
    let join = '';
    if (id_fornecedor && id_fornecedor !== 'null' && id_fornecedor !== '0') {
      join = `INNER JOIN produtofornecedor pf ON CAST(pf.cod_produto AS UNSIGNED) = p.ID
                AND CAST(pf.cod_fornecedor AS UNSIGNED) = ? AND pf.excluido = 'N' AND pf.status = 'A'`;
      params.push(parseInt(id_fornecedor));
    }

    const [rows] = await pool.query(
      `SELECT p.ID as id, p.ID as cod_produto,
              p.cod_fabricante, p.descricao, p.descricao as desc_produto,
              p.unidade, p.vlr_venda, p.ipi, p.comissao,
              IFNULL(p.kilo_embalagem, 0) as kilo_embalagem
       FROM produto p
       ${join}
       WHERE p.excluido = 'N'
         AND (p.descricao LIKE ? OR p.cod_fabricante LIKE ?)
       ORDER BY p.descricao
       LIMIT ?`,
      [...params, lk, lk, parseInt(limit)]
    );
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pedidos/lookup/produtos-avancado
router.get('/lookup/produtos-avancado', async (req, res) => {
  try {
    const pool = getPool();
    const { q = '', id_empresa, id_tabela_preco } = req.query;

    let sql = `
      SELECT 
        p.id as cod_produto, 
        p.cod_fabricante, 
        p.cod_barras,
        p.unidade, 
        p.descricao as desc_produto, 
        p.comissao, 
        p.ipi, 
        p.vlr_custo,
        COALESCE(tpi.valor_tabela, p.vlr_venda) as vlr_venda,
        g.descricao as grupo_descricao,
        f.nome as familia_descricao
      FROM produto p
      LEFT JOIN grupos g ON g.id = p.id_grupo
      LEFT JOIN familia_produtos f ON f.id = p.id_familiaproduto
    `;

    const params = [];

    // Só faz o JOIN com tabela de preço se o ID for válido e não estiver vazio
    if (id_tabela_preco && id_tabela_preco !== 'null' && id_tabela_preco !== 'undefined' && id_tabela_preco.trim() !== '') {
      sql += ` LEFT JOIN tabela_preco_itens tpi ON tpi.cod_produto = p.id AND tpi.id_tabela = ? AND tpi.excluido = 'N' AND tpi.ativo = 'S' `;
      params.push(id_tabela_preco);
    } else {
      // Se não tem tabela, garante que tpi.valor_tabela retorne NULL para o COALESCE funcionar
      sql += ` LEFT JOIN (SELECT NULL as valor_tabela, NULL as cod_produto) tpi ON 1=0 `;
    }

    sql += ` WHERE (p.excluido = 'N' OR p.excluido IS NULL) `;

    // Ignora id_empresa se estiver vazio ou 'null', conforme solicitação
    if (id_empresa && id_empresa !== 'null' && id_empresa !== 'undefined' && id_empresa.trim() !== '' && id_empresa !== '0') {
      sql += ` AND p.id_empresa = ? `;
      params.push(id_empresa);
    }

    if (q.trim()) {
      sql += ` AND (p.descricao LIKE ? OR p.cod_fabricante LIKE ? OR p.cod_barras LIKE ? OR p.id = ?) `;
      const lk = `%${q.trim()}%`;
      params.push(lk, lk, lk, q.trim());
    }

    sql += ` ORDER BY p.descricao LIMIT 600 `;

    const [rows] = await pool.query(sql, params);
    res.json({ produtos: rows });
  } catch (err) {
    console.error('Erro lookup produtos:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pedidos/config/grid — Busca o layout salvo do usuário
router.get('/config/grid', async (req, res) => {
  try {
    const pool = getPool();
    const id_usuario = req.user?.id || 1; 
    const [rows] = await pool.query(
      `SELECT config_json FROM preferencias_grid WHERE id_usuario = ? AND nome_grid = 'pedidos'`,
      [id_usuario]
    );
    res.json({ config: rows[0]?.config_json ? JSON.parse(rows[0].config_json) : null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pedidos/config/grid — Salva layout automaticamente
router.post('/config/grid', async (req, res) => {
  try {
    const pool = getPool();
    const id_usuario = req.user?.id || 1;
    const { config } = req.body;
    await pool.query(
      `INSERT INTO preferencias_grid (id_usuario, nome_grid, config_json) 
       VALUES (?, 'pedidos', ?) 
       ON DUPLICATE KEY UPDATE config_json = ?, dt_alterado = CURRENT_TIMESTAMP`,
      [id_usuario, JSON.stringify(config), JSON.stringify(config)]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pedidos/:id
router.get('/:id', async (req, res) => {
  try {
    const pool = getPool();
    // JOIN duplo com usuarios para trazer o vendedor e quem digitou
    const [header] = await pool.query(`
      SELECT p.*, u1.nomeusu as nome_vendedor, u2.nomeusu as nome_digitador
      FROM pedidos p
      LEFT JOIN usuarios u1 ON p.id_usuario = u1.idusuario
      LEFT JOIN usuarios u2 ON p.coduser_digitacao = u2.idusuario
      WHERE p.id = ?
    `, [req.params.id]);
    
    if (!header[0]) return res.status(404).json({ error: 'Pedido não encontrado' });

    const numPedido = header[0].numero;
    const [itens] = await pool.query(
      `SELECT i.*, p.foto_principal 
       FROM itensped i 
       LEFT JOIN produto p ON i.cod_produto = p.id 
       WHERE i.numpedido = ? AND (i.excluido = 'N' OR i.excluido IS NULL) `, 
      [numPedido]
    );
    
    const [parcelas] = await pool.query(`SELECT * FROM receber WHERE numero = ?`, [numPedido]).catch(() => [[]]);

    // Buscar logs de auditoria
    const [logs] = await pool.query(`
      SELECT l.*, u.nomeusu as nome_usuario
      FROM logs_pedidos l
      LEFT JOIN usuarios u ON l.id_usuario = u.idusuario
      WHERE l.id_pedido = ?
      ORDER BY l.data_hora DESC
    `, [req.params.id]).catch(() => [[]]);

    res.json({
      pedido: header[0],
      itens: itens,
      parcelas: parcelas || [],
      logs: logs || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pedidos
router.post('/', async (req, res) => {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const { pedido, itens } = req.body;
    
    // Geração automática de número se não vier preenchido
    let num = pedido.numero;
    if (!num || num === '' || num.startsWith('PR')) {
      const now = new Date();
      const prefix = now.getFullYear().toString() + (now.getMonth()+1).toString().padStart(2,'0') + now.getDate().toString().padStart(2,'0');
      const [last] = await conn.query('SELECT id FROM pedidos ORDER BY id DESC LIMIT 1');
      const nextId = (last[0]?.id || 0) + 1;
      num = `PED-${prefix}-${nextId.toString().padStart(4,'0')}`;
    }

    const [pResult] = await conn.query(
      `INSERT INTO pedidos (
        numero, data_abertura, hora_abertura, id_usuario, nome_vendedor, 
        cod_cliente, nome_cliente, cod_fornecedor, nome_fornecedor,
        cod_transportadora, nome_transportadora, tipo_frete,
        ped_compras, comprador, data_entrega, condicao_pagto, forma_pagto,
        vlrsubtotal, vlrdesconto, vlrtotalimposto, vlrfrete, vlrjuros, vlrtotalpedido,
        situacao_pedido, obs, excluido, dtcadastro, id_empresa, nome_empresa, tipo_pedido,
        puxada, tipo_documento
      ) VALUES (?, CURDATE(), CURTIME(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'N', CURDATE(), ?, ?, ?, ?, ?)`,
      [
        num, 
        req.user?.id || 0, req.user?.nome || 'Admin',
        pedido.cod_cliente, pedido.nome_cliente,
        pedido.cod_fornecedor, pedido.nome_fornecedor,
        pedido.cod_transportadora, pedido.nome_transportadora,
        pedido.tipo_frete, pedido.ped_compras, pedido.comprador,
        pedido.data_entrega || null, pedido.condicao_pagto, pedido.forma_pagto,
        pedido.vlrsubtotal || 0, pedido.vlrdesconto || 0,
        pedido.vlrtotalimposto || 0, pedido.vlrfrete || 0, pedido.vlrjuros || 0,
        pedido.vlrtotalpedido || 0,
        pedido.situacao_pedido || 'PENDENTE',
        pedido.obs || '',
        pedido.id_empresa || null,
        pedido.nome_empresa || '',
        pedido.tipo_pedido || 'PEDIDO',
        pedido.puxada || 'N',
        pedido.tipo_documento || ''
      ]
    );

    if (itens && itens.length > 0) {
      for (const item of itens) {
        await conn.query(
          `INSERT INTO itensped (
            numpedido, cod_produto, desc_prod, unidade, quantidade, valor_unitario, vlrtotal_itens,
            st, vlr_st, ipi, vlr_ipi, icms, vlr_icms, valor_puxada, total_puxada,
            desconto1, desconto2, cor1, cor2, obsitemitenspedido, excluido
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'N')`,
          [
            num, item.cod_produto, item.desc_prod, item.unidade, item.quantidade, 
            item.valor_unitario, item.vlrtotal_itens,
            item.st || 0, item.vlr_st || 0, item.ipi || 0, item.vlr_ipi || 0, item.icms || 0, item.vlr_icms || 0,
            item.valor_puxada || 0, item.total_puxada || 0,
            item.desconto1 || 0, item.desconto2 || 0,
            item.cor1 || '', item.cor2 || '', item.obsitemitenspedido || ''
          ]
        );
      }
    }

    await conn.commit();
    res.status(201).json({ ok: true, id: pResult.insertId });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// POST /api/pedidos/:id — Atualização de Pedido
router.post('/:id', async (req, res) => {
  const conn = await getPool().getConnection();
  try {
    const { id } = req.params;
    const { pedido, itens } = req.body;
    const id_usuario_log = req.user?.id || 1;
    await conn.beginTransaction();

    // Busca o estado atual para o log
    const [atual] = await conn.query('SELECT situacao_pedido, tipo_pedido FROM pedidos WHERE id = ?', [id]);
    const statusAntigo = atual[0]?.situacao_pedido;

    // 1. Atualiza cabeçalho do pedido
    if (pedido) {
      const sets = [];
      const vals = [];
      const allowedFields = [
        'situacao_pedido', 'tipo_pedido', 'vlrtotalpedido', 'vlrsubtotal', 'vlrdesconto',
        'obs', 'data_entrega', 'condicao_pagto', 'forma_pagto', 'cod_transportadora',
        'tipo_frete', 'vlrfrete', 'ped_compras', 'comprador', 'cod_cliente', 'nome_cliente',
        'cod_fornecedor', 'nome_fornecedor', 'id_usuario', 'coduser_digitacao', 'id_empresa', 'nome_empresa',
        'puxada', 'tipo_documento'
      ];

      for (const key of allowedFields) {
        if (pedido[key] !== undefined) {
          sets.push(`${key} = ?`);
          vals.push(pedido[key]);
        }
      }

      if (sets.length > 0) {
        vals.push(id);
        await conn.query(`UPDATE pedidos SET ${sets.join(', ')} WHERE id = ?`, vals);
      }

      // ── LOG DE AUDITORIA ──
      let acao = 'ALTERACAO_GERAL';
      if (pedido.situacao_pedido && pedido.situacao_pedido !== statusAntigo) acao = 'MUDANCA_STATUS';
      
      await conn.query(`
        INSERT INTO logs_pedidos (id_pedido, id_usuario, acao, status_antigo, status_novo, detalhes)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
        id, id_usuario_log, acao, statusAntigo, pedido.situacao_pedido || statusAntigo,
        JSON.stringify(pedido) // Salva o que foi alterado nos detalhes
      ]);
    }

    // 2. Atualiza Itens (Se fornecidos)
    if (itens && Array.isArray(itens)) {
      // Busca o número do pedido para os itens
      const [p] = await conn.query('SELECT numero FROM pedidos WHERE id = ?', [id]);
      if (p[0]) {
        const numPedido = p[0].numero;
        // Marca itens antigos como excluídos ou remove (depende do padrão do sistema, aqui vamos remover e reinserir para simplificar o sync)
        await conn.query(`DELETE FROM itensped WHERE numpedido = ?`, [numPedido]);
        
        for (const item of itens) {
          await conn.query(
            `INSERT INTO itensped (
              numpedido, cod_produto, desc_prod, unidade, quantidade, valor_unitario, vlrtotal_itens,
              st, vlr_st, ipi, vlr_ipi, icms, vlr_icms, valor_puxada, total_puxada,
              desconto1, desconto2, cor1, cor2, obsitemitenspedido, excluido
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'N')`,
            [
              numPedido, item.cod_produto, item.desc_prod, item.unidade, item.quantidade, 
              item.valor_unitario, item.vlrtotal_itens,
              item.st || 0, item.vlr_st || 0, item.ipi || 0, item.vlr_ipi || 0, item.icms || 0, item.vlr_icms || 0,
              item.valor_puxada || 0, item.total_puxada || 0,
              item.desconto1 || 0, item.desconto2 || 0,
              item.cor1 || '', item.cor2 || '', item.obsitemitenspedido || ''
            ]
          );
        }
      }
    }

    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    console.error('ERRO UPDATE PEDIDO:', err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// POST /api/pedidos/bulk-update — Atualização em Massa
router.post('/bulk-update', async (req, res) => {
  const conn = await getPool().getConnection();
  try {
    const { ids, update } = req.body; // ids: [1,2,3], update: { situacao_pedido: 'APROVADO' }
    const id_usuario_log = req.user?.id || 1;
    if (!ids || !ids.length) return res.status(400).json({ error: 'Nenhum pedido selecionado' });

    await conn.beginTransaction();

    for (const id of ids) {
      // Pega status antigo para o log
      const [old] = await conn.query('SELECT situacao_pedido FROM pedidos WHERE id = ?', [id]);
      
      // Aplica atualização (Suporta conversão de Orçamento para Pedido se necessário)
      const sets = [];
      const vals = [];
      if (update.situacao_pedido) { sets.push('situacao_pedido = ?'); vals.push(update.situacao_pedido); }
      if (update.tipo_pedido)     { sets.push('tipo_pedido = ?');     vals.push(update.tipo_pedido); }
      
      if (sets.length > 0) {
        vals.push(id);
        await conn.query(`UPDATE pedidos SET ${sets.join(', ')} WHERE id = ?`, vals);
        
        // Log individual para cada alteração em massa
        await conn.query(`
          INSERT INTO logs_pedidos (id_pedido, id_usuario, acao, status_antigo, status_novo, detalhes)
          VALUES (?, ?, 'ALTERACAO_MASSA', ?, ?, ?)
        `, [id, id_usuario_log, old[0]?.situacao_pedido, update.situacao_pedido || old[0]?.situacao_pedido, 'Atualização via ação em massa']);
      }
    }

    await conn.commit();
    res.json({ ok: true, count: ids.length });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
