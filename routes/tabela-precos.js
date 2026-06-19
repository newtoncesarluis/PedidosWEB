const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');
const { listarTabelasVinculadas } = require('../config/tabela-preco-vinculo');
const { permCrud, negarCad } = require('../config/cadastros-permissoes');
const { ensureTabelaPrecoCondPagamentoNullable, ensureVitrineColumns } = require('../config/schema-migrations');

/** Normaliza flag S/N (default 'N') */
const _sn = (v) => (String(v).toUpperCase() === 'S' ? 'S' : 'N');

/**
 * Insere os itens da tabela em lotes de 500 (poucas queries em vez de N) —
 * rápido em banco remoto e seguro contra max_allowed_packet em tabelas grandes.
 */
async function _insertItensTabela(conn, idTabela, itens) {
  if (!Array.isArray(itens) || !itens.length) return;
  const CHUNK = 500;
  for (let start = 0; start < itens.length; start += CHUNK) {
    const rows = itens.slice(start, start + CHUNK).map((item, j) => {
      const i = start + j;
      return [
        idTabela, i + 1, item.cod_produto, item.descricao,
        item.cod_fabricante ?? null, item.unidade ?? null,
        item.preco_base ?? null, item.preco_venda,
        item.tipo_desconto || 'R', item.vlr_desconto ?? 0, item.valor_tabela,
        item.ativo || 'S', item.vigencia || null, 'N',
      ];
    });
    await conn.query(
      `INSERT INTO tabela_preco_itens
         (id_tabela, item, cod_produto, descricao, cod_fabricante, unidade, preco_base, preco_venda, tipo_desconto, vlr_desconto, valor_tabela, ativo, vigencia, excluido)
       VALUES ?`,
      [rows]
    );
  }
}

const _permTabelaPrecos = (req) => permCrud(req, {
  incluir: 'incluir_tabela_precos',
  alterar: 'alterar_tabela_precos',
  excluir: 'excluir_tabela_precos',
});

/**
 * Lógica de Autocriação de Tabelas (Opcional, mas seguro).
 * Cacheado por pool — só roda uma vez por base, não a cada gravação
 * (evita lentidão em banco remoto, onde cada ida/volta custa).
 */
const _tabelaPrecoReady = new Set();
async function ensureTables() {
  const pool = getPool();
  if (_tabelaPrecoReady.has(pool)) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tabela_preco_cabecalho (
        id INT AUTO_INCREMENT PRIMARY KEY,
        Descricao VARCHAR(200) NOT NULL,
        Data_Inicial DATE NOT NULL,
        Hora_Inicial TIME NOT NULL,
        Data_Final DATE NOT NULL,
        Hora_Final TIME NOT NULL,
        Cond_Pagamento INT NULL,
        Tabela_Ativa ENUM('S','N') DEFAULT 'S',
        excluido ENUM('S','N') DEFAULT 'N',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tabela_preco_itens (
        id INT AUTO_INCREMENT PRIMARY KEY,
        id_tabela INT NOT NULL,
        item INT NOT NULL,
        cod_produto INT NOT NULL,
        descricao VARCHAR(200) NOT NULL,
        cod_fabricante VARCHAR(100),
        unidade VARCHAR(10),
        preco_base DECIMAL(15,2),
        preco_venda DECIMAL(15,2) NOT NULL,
        tipo_desconto ENUM('R','P') DEFAULT 'R',
        vlr_desconto DECIMAL(15,2) DEFAULT 0.00,
        valor_tabela DECIMAL(15,2) NOT NULL,
        ativo ENUM('S','N') DEFAULT 'S',
        vigencia DATE NULL,
        excluido ENUM('S','N') DEFAULT 'N',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_item_tabela FOREIGN KEY (id_tabela) REFERENCES tabela_preco_cabecalho (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tabela_preco_vinculo (
        id INT AUTO_INCREMENT PRIMARY KEY,
        id_tabela INT NOT NULL,
        id_entidade INT NOT NULL,
        tipo_entidade ENUM('CLIENTE', 'FORNECEDOR', 'VENDEDOR') NOT NULL,
        excluido ENUM('S','N') DEFAULT 'N',
        CONSTRAINT fk_vinculo_tabela FOREIGN KEY (id_tabela) REFERENCES tabela_preco_cabecalho (id) ON DELETE CASCADE,
        INDEX idx_entidade (id_entidade, tipo_entidade)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await ensureTabelaPrecoCondPagamentoNullable(pool);
    await ensureTabelaPrecoVinculoVendedor(pool);
    await ensureVitrineColumns(pool);
    _tabelaPrecoReady.add(pool);
  } catch (err) { console.error('Erro ao garantir tabelas:', err); }
}

async function ensureTabelaPrecoVinculoVendedor(pool) {
  try {
    const [cols] = await pool.query(
      `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tabela_preco_vinculo' AND COLUMN_NAME = 'tipo_entidade'`
    );
    if (!cols.length) return;
    if (!String(cols[0].COLUMN_TYPE).includes('VENDEDOR')) {
      await pool.query(
        `ALTER TABLE \`tabela_preco_vinculo\`
         MODIFY COLUMN \`tipo_entidade\` ENUM('CLIENTE','FORNECEDOR','VENDEDOR') NOT NULL`
      );
      console.log('[schema] tabela_preco_vinculo.tipo_entidade -> inclui VENDEDOR');
    }
  } catch (e) {
    console.warn('[schema] ensureTabelaPrecoVinculoVendedor:', e.message);
  }
}

function normalizeCondPagamento(value) {
  if (value == null || value === '') return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ─── GET /api/condicoes-pagamento ──────────────────────────────────────────
router.get('/condicoes-pagamento', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT id, descricao, prazopadrao
       FROM forma_pagto
       WHERE (excluido = 'N' OR excluido IS NULL)
       ORDER BY descricao`
    );
    res.json(rows);
  } catch (err) {
    try {
      const pool = getPool();
      const [rows] = await pool.query(
        `SELECT id, descricao, prazopadrao FROM forma_pagto ORDER BY descricao`
      );
      res.json(rows);
    } catch (e2) {
      res.status(500).json({ error: e2.message });
    }
  }
});

// ─── POST /api/condicoes-pagamento (cria nova se não existir) ──────────────
router.post('/condicoes-pagamento', async (req, res) => {
  try {
    const pool = getPool();
    const { descricao, prazopadrao = '' } = req.body;
    if (!descricao || !descricao.trim()) return res.status(400).json({ error: 'Descrição obrigatória' });
    const desc = descricao.trim();
    const [existe] = await pool.query(
      `SELECT id, descricao, prazopadrao FROM forma_pagto WHERE descricao = ? AND excluido = 'N' LIMIT 1`, [desc]
    );
    if (existe.length) return res.json({ criado: false, ...existe[0] });
    const [ins] = await pool.query(
      `INSERT INTO forma_pagto (descricao, prazopadrao, status, excluido) VALUES (?, ?, 'A', 'N')`, [desc, prazopadrao]
    );
    res.json({ criado: true, id: ins.insertId, descricao: desc, prazopadrao });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST /api/tabela-precos/:id/clonar ──────────────────────────────────
router.post('/:id/clonar', async (req, res) => {
  const pc = _permTabelaPrecos(req);
  if (pc.incluir !== 'S') return negarCad(res, 'Sem permissão para incluir tabela de preços');
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const idOrigem = req.params.id;

    const [cabOrigem] = await conn.query(
      `SELECT * FROM tabela_preco_cabecalho WHERE id = ? AND excluido = 'N'`, [idOrigem]
    );
    if (!cabOrigem[0]) throw new Error('Tabela original não encontrada');

    const [resCab] = await conn.query(
      `INSERT INTO tabela_preco_cabecalho (Descricao, Data_Inicial, Hora_Inicial, Data_Final, Hora_Final, Cond_Pagamento, Tabela_Ativa, vitrine, usar_regras_fornecedor, excluido)
       VALUES (?, ?, ?, ?, ?, ?, 'N', ?, ?, 'N')`,
      [`CLONE - ${cabOrigem[0].Descricao}`, cabOrigem[0].Data_Inicial, cabOrigem[0].Hora_Inicial, cabOrigem[0].Data_Final, cabOrigem[0].Hora_Final, cabOrigem[0].Cond_Pagamento, _sn(cabOrigem[0].vitrine), _sn(cabOrigem[0].usar_regras_fornecedor)]
    );

    const novoId = resCab.insertId;

    const [itens] = await conn.query(
      `SELECT * FROM tabela_preco_itens WHERE id_tabela = ? AND COALESCE(excluido,'N') = 'N'`, [idOrigem]
    );

    for (const it of itens) {
      await conn.query(
        `INSERT INTO tabela_preco_itens (id_tabela, item, cod_produto, descricao, cod_fabricante, unidade, preco_base, preco_venda, tipo_desconto, vlr_desconto, valor_tabela, ativo, vigencia, excluido)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'N')`,
        [novoId, it.item, it.cod_produto, it.descricao, it.cod_fabricante, it.unidade, it.preco_base, it.preco_venda, it.tipo_desconto, it.vlr_desconto, it.valor_tabela, it.ativo, it.vigencia]
      );
    }

    await conn.commit();
    res.json({ ok: true, id: novoId });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally { conn.release(); }
});

// ─── PATCH /api/tabela-precos/:id/liberar ────────────────────────────────
router.patch('/:id/liberar', async (req, res) => {
  try {
    const pc = _permTabelaPrecos(req);
    if (pc.alterar !== 'S') return negarCad(res, 'Sem permissão para alterar tabela de preços');
    const pool = getPool();
    await pool.query(`UPDATE tabela_preco_cabecalho SET Tabela_Ativa = 'S' WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST /api/tabela-precos/:id/manutencao ─────────────────────────────
router.post('/:id/manutencao', async (req, res) => {
  const pc = _permTabelaPrecos(req);
  if (pc.alterar !== 'S') return negarCad(res, 'Sem permissão para alterar tabela de preços');
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const { tipo_ajuste, valor_ajuste, nova_vigencia } = req.body;
    const idTabela = req.params.id;

    const [itens] = await conn.query(
      `SELECT * FROM tabela_preco_itens WHERE id_tabela = ? AND COALESCE(excluido,'N') = 'N'`, [idTabela]
    );

    for (const it of itens) {
      let nvPrecoVenda = parseFloat(it.preco_venda);
      let nvVigencia = it.vigencia;

      if (tipo_ajuste === 'percentual' && valor_ajuste) {
        nvPrecoVenda = nvPrecoVenda * (1 + (parseFloat(valor_ajuste) / 100));
      }

      if (nova_vigencia) {
        nvVigencia = nova_vigencia;
      }

      let nvValorTabela = nvPrecoVenda;
      const vlrDesc = parseFloat(it.vlr_desconto) || 0;
      if (it.tipo_desconto === 'R') {
        nvValorTabela = nvPrecoVenda - vlrDesc;
      } else {
        nvValorTabela = nvPrecoVenda - (nvPrecoVenda * vlrDesc / 100);
      }
      if (nvValorTabela < 0) nvValorTabela = 0;

      await conn.query(
        `UPDATE tabela_preco_itens SET preco_venda = ?, vigencia = ?, valor_tabela = ? WHERE id = ?`,
        [nvPrecoVenda, nvVigencia, nvValorTabela, it.id]
      );
    }

    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally { conn.release(); }
});

// ─── GET /api/tabela-precos/vinculos/:tipo/:id ───────────────────────────
router.get('/vinculos/:tipo/:id', async (req, res) => {
  await ensureTables();
  try {
    const pool = getPool();
    const { tipo, id } = req.params;
    
    // Busca todas as tabelas ativas
    const [tabelas] = await pool.query(
      `SELECT id, Descricao as descricao, Tabela_Ativa
       FROM tabela_preco_cabecalho
       WHERE excluido = 'N' AND Tabela_Ativa = 'S'
       ORDER BY Descricao`
    );

    // Busca vínculos para a entidade específica
    const [vincs] = await pool.query(
      `SELECT id_tabela, id FROM tabela_preco_vinculo
       WHERE excluido = 'N' AND id_entidade = ? AND tipo_entidade = ?`,
      [id, tipo.toUpperCase()]
    );

    const vincMap = {};
    vincs.forEach(v => { vincMap[String(v.id_tabela)] = v.id; });

    res.json(tabelas.map(t => ({
      ...t,
      check:     !!vincMap[String(t.id)],
      cod_regra: vincMap[String(t.id)] || null
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/tabela-precos/vinculos/:tipo/:id ──────────────────────────
router.post('/vinculos/:tipo/:id', async (req, res) => {
  await ensureTables();
  const { tipo, id } = req.params;
  const { tabelas } = req.body; // Array de {id, check, cod_regra}
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    for (const tab of (tabelas || [])) {
      const idTabela = tab.id_tabela || tab.id;
      if (tab.check && !tab.cod_regra) {
        await conn.query(
          `INSERT INTO tabela_preco_vinculo (id_entidade, id_tabela, tipo_entidade, excluido)
           VALUES (?, ?, ?, 'N')`,
          [id, idTabela, tipo.toUpperCase()]
        );
      } else if (!tab.check && tab.cod_regra) {
        await conn.query(
          `DELETE FROM tabela_preco_vinculo WHERE id = ?`,
          [tab.cod_regra]
        );
      }
    }
    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

// ─── GET /api/tabela-precos/ativa-para/:entidadeType/:entidadeId ──────────
// Busca a primeira tabela ativa vinculada seguindo a regra de negócio
router.get('/ativa-para/:cliId/:forId/:venId', async (req, res) => {
  try {
    const pool = getPool();
    const { cliId, forId, venId } = req.params;

    // Regra: Fornecedor (fábrica) > Vendedor > Cliente
    const priorities = [
      { id: forId, tipo: 'FORNECEDOR' },
      { id: venId, tipo: 'VENDEDOR' },
      { id: cliId, tipo: 'CLIENTE' }
    ];

    for (const p of priorities) {
      if (!p.id || p.id === 'null' || p.id === '0') continue;
      try {
        const [vinc] = await pool.query(`
          SELECT v.id_tabela, c.Descricao
          FROM tabela_preco_vinculo v
          JOIN tabela_preco_cabecalho c ON c.id = v.id_tabela
          WHERE v.id_entidade = ? AND v.tipo_entidade = ? AND v.excluido = 'N' AND c.excluido = 'N' AND c.Tabela_Ativa = 'S'
          LIMIT 1
        `, [p.id, p.tipo]);

        if (vinc[0]) {
          return res.json({ id_tabela: vinc[0].id_tabela, descricao: vinc[0].Descricao, origem: p.tipo });
        }
      } catch (tableErr) {
        // Ignora erro se a tabela de preços não existir no banco do cliente
        continue;
      }
    }

    res.json({ id_tabela: null });
  } catch (err) {
    res.json({ id_tabela: null, error: err.message });
  }
});

// ─── GET /api/tabela-precos/disponiveis-para/:entidadeType/:entidadeId ─────
// Busca TODAS as tabelas ativas vinculadas ao cliente, fornecedor ou vendedor
router.get('/disponiveis-para/:cliId/:forId/:venId', async (req, res) => {
  try {
    const pool = getPool();
    const { cliId, forId, venId } = req.params;

    const priorities = [
      { id: forId, tipo: 'FORNECEDOR' },
      { id: venId, tipo: 'VENDEDOR' },
      { id: cliId, tipo: 'CLIENTE' }
    ];

    let tabelas = [];
    let origemTabela = null;

    // Tenta buscar as tabelas por prioridade: se achar na 1ª (fábrica) já usa elas; senão vendedor; senão cliente.
    for (const p of priorities) {
      if (!p.id || p.id === 'null' || p.id === '0') continue;
      try {
        const rows = await listarTabelasVinculadas(pool, p.id, p.tipo);
        if (rows.length > 0) {
          tabelas = rows.map((r) => ({
            id_tabela: r.id_tabela,
            descricao: r.descricao,
          }));
          origemTabela = p.tipo;
          break;
        }
      } catch (tableErr) {
        continue;
      }
    }

    res.json({ tabelas, origem: origemTabela });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Tabelas liberadas (fornecedor/fábrica > vendedor > cliente) — mesma regra de disponiveis-para. */
async function buscarTabelasLiberadas(pool, cliId, forId, venId) {
  const priorities = [
    { id: forId, tipo: 'FORNECEDOR' },
    { id: venId, tipo: 'VENDEDOR' },
    { id: cliId, tipo: 'CLIENTE' },
  ];
  for (const p of priorities) {
    if (!p.id || p.id === 'null' || p.id === '0') continue;
    try {
      const rows = await listarTabelasVinculadas(pool, p.id, p.tipo);
      if (rows.length > 0) {
        return {
          tabelas: rows.map((r) => ({
            id_tabela: r.id_tabela,
            descricao: r.descricao,
          })),
          origem: p.tipo,
        };
      }
    } catch (_) { /* tabela pode não existir em bases legadas */ }
  }
  return { tabelas: [], origem: null };
}

// ─── GET /api/tabela-precos/opcoes-item/:produtoId ───────────────────────
// Opções de preço por item (Tabela Padrão + tabelas liberadas com valor do produto)
router.get('/opcoes-item/:produtoId', async (req, res) => {
  try {
    const pool = getPool();
    const { produtoId } = req.params;
    const { cliId = '0', forId = '0', venId = '0' } = req.query;

    const [tbRows] = await pool.query(`SHOW TABLES LIKE 'produto'`);
    const tb = tbRows.length ? 'produto' : 'produtos';
    const [prodRow] = await pool.query(
      `SELECT vlr_venda FROM ${tb} WHERE id = ? LIMIT 1`,
      [produtoId]
    );
    const vlrPadrao = parseFloat(prodRow[0]?.vlr_venda) || 0;

    const { tabelas, origem } = await buscarTabelasLiberadas(pool, cliId, forId, venId);

    const opcoes = [{
      id_tabela: '',
      descricao: 'Tabela Padrão',
      valor: vlrPadrao,
      tipo: 'venda',
    }];

    if (tabelas.length) {
      const ids = tabelas.map(t => t.id_tabela);
      const [precos] = await pool.query(
        `SELECT id_tabela,
                COALESCE(valor_tabela, preco_venda, 0) AS valor
         FROM tabela_preco_itens
         WHERE cod_produto = ? AND id_tabela IN (?)
           AND excluido = 'N' AND ativo = 'S'`,
        [produtoId, ids]
      ).catch(() => [[]]);

      const precoMap = {};
      (precos || []).forEach((p) => {
        precoMap[String(p.id_tabela)] = parseFloat(p.valor) || 0;
      });

      tabelas.forEach((t) => {
        const val = precoMap[String(t.id_tabela)];
        opcoes.push({
          id_tabela: t.id_tabela,
          descricao: t.descricao,
          valor: Number.isFinite(val) ? val : vlrPadrao,
          tipo: 'tabela',
          is_fallback: !Number.isFinite(val),
        });
      });
    }

    res.json({ opcoes, origem });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/tabela-precos/vlr-venda/:tabelaId/:produtoId ──────────────
router.get('/vlr-venda/:tabelaId/:produtoId', async (req, res) => {
  try {
    const pool = getPool();
    const { tabelaId, produtoId } = req.params;
    const [row] = await pool.query(
      `SELECT valor_tabela FROM tabela_preco_itens 
       WHERE id_tabela = ? AND cod_produto = ? AND excluido = 'N' AND ativo = 'S' LIMIT 1`,
      [tabelaId, produtoId]
    );
    if (row[0]) return res.json({ valor: row[0].valor_tabela });

    // Fallback para preço base do produto (detecta nome correto da tabela)
    const [tbRows] = await pool.query(`SHOW TABLES LIKE 'produto'`);
    const tb = tbRows.length ? 'produto' : 'produtos';
    const [prod] = await pool.query(`SELECT vlr_venda FROM ${tb} WHERE id = ? LIMIT 1`, [produtoId]);
    res.json({ valor: prod[0]?.vlr_venda || 0, is_fallback: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/tabela-precos/ativas (Para combos e check-lists) ──────────
router.get('/ativas', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT id, Descricao as descricao, Tabela_Ativa 
       FROM tabela_preco_cabecalho 
       WHERE excluido = 'N' AND Tabela_Ativa = 'S' 
       ORDER BY Descricao`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/tabela-precos/produtos/segmentos ───────────────────────────────
router.get('/produtos/segmentos', async (req, res) => {
  try {
    const [rows] = await getPool().query(
      `SELECT DISTINCT segmento FROM produto
       WHERE segmento IS NOT NULL AND segmento != '' AND excluido='N'
       ORDER BY segmento`
    );
    res.json(rows.map(r => r.segmento));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/tabela-precos/produtos/busca (Paginado) ───────────────────────
router.get('/produtos/busca', async (req, res) => {
  try {
    const pool = getPool();
    const { q = '', page = 1, limit = 10, fabricante = '', ids_fornecedor = '', segmentos = '' } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * Math.max(1, parseInt(limit));

    let where = [`p.excluido = 'N'`];
    const joinParts = [];
    const params = [];

    if (q.trim()) {
      where.push(`(p.id = ? OR p.descricao LIKE ? OR p.cod_fabricante LIKE ?)`);
      const val = `%${q.trim()}%`;
      params.push(q.trim(), val, val);
    }

    if (fabricante.trim()) {
      where.push(`p.cod_fabricante LIKE ?`);
      params.push(`%${fabricante.trim()}%`);
    }

    // Múltiplos fornecedores: via cod_fornecedorpadrao OU fornecedor_produtos
    const fornIds = ids_fornecedor.split(',').map(s => parseInt(s)).filter(n => n > 0);
    if (fornIds.length > 0) {
      joinParts.push(
        `LEFT JOIN fornecedor_produtos fp ON fp.cod_produto = p.id AND COALESCE(fp.excluido,'N')='N'`
      );
      const inList = fornIds.map(() => '?').join(',');
      where.push(`(p.cod_fornecedorpadrao IN (${inList}) OR fp.cod_fornecedor IN (${inList}))`);
      params.push(...fornIds, ...fornIds);
    }

    // Múltiplos segmentos
    const segsArr = segmentos.split('|').map(s => s.trim()).filter(Boolean);
    if (segsArr.length > 0) {
      where.push(`p.segmento IN (${segsArr.map(() => '?').join(',')})`);
      params.push(...segsArr);
    }

    const joinClause = joinParts.join(' ');
    // DISTINCT evita duplicatas quando produto tem vários fornecedores
    const selectDistinct = fornIds.length > 0 ? 'DISTINCT' : '';
    const whereClause = where.join(' AND ');
    const lim = parseInt(limit);
    const off = offset;

    const [rows] = await pool.query(
      `SELECT ${selectDistinct} p.id, p.descricao, p.cod_fabricante, p.unidade, p.vlr_venda, p.segmento,
              f.nome AS nome_fornecedor
       FROM produto p
       LEFT JOIN fornecedores f ON f.id = p.cod_fornecedorpadrao AND (f.excluido='N' OR f.excluido IS NULL)
       ${joinClause}
       WHERE ${whereClause}
       ORDER BY p.descricao
       LIMIT ? OFFSET ?`,
      [...params, lim, off]
    );

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(${selectDistinct ? 'DISTINCT p.id' : '*'}) as total FROM produto p ${joinClause} WHERE ${whereClause}`,
      params
    );

    res.json({ data: rows, total, page: parseInt(page), last_page: Math.max(1, Math.ceil(total / lim)) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/tabelas-preco (Browse) ──────────────────────────────────────
router.get('/', async (req, res) => {
  await ensureTables();
  try {
    const pool = getPool();
    const { q = '', page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    let where = [`t.excluido = 'N'`];
    const params = [];

    if (q.trim()) {
      where.push(`t.Descricao LIKE ?`);
      params.push(`%${q.trim()}%`);
    }

    const [rows] = await pool.query(
      `SELECT t.*, f.descricao as condicao_pagto_desc
       FROM tabela_preco_cabecalho t
       LEFT JOIN forma_pagto f ON f.id = t.Cond_Pagamento
       WHERE ${where.join(' AND ')}
       ORDER BY t.id DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM tabela_preco_cabecalho t WHERE ${where.join(' AND ')}`,
      params
    );

    res.json({ tabelas: rows, total });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/tabelas-preco/:id (Detalhes + Itens) ────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const pool = getPool();
    const [cab] = await pool.query(
      `SELECT t.* FROM tabela_preco_cabecalho t WHERE t.id = ? AND t.excluido = 'N' LIMIT 1`,
      [req.params.id]
    );

    if (!cab[0]) return res.status(404).json({ error: 'Tabela não encontrada' });

    const [itens] = await pool.query(
      `SELECT i.* FROM tabela_preco_itens i WHERE i.id_tabela = ? AND COALESCE(i.excluido,'N') = 'N' ORDER BY i.item`,
      [req.params.id]
    );

    res.json({ ...cab[0], itens });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST /api/tabelas-preco (Salvar Nova) ───────────────────────────────
router.post('/', async (req, res) => {
  await ensureTables();
  const pc = _permTabelaPrecos(req);
  if (pc.incluir !== 'S') return negarCad(res, 'Sem permissão para incluir tabela de preços');
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const { itens, ...cab } = req.body;
    cab.Cond_Pagamento = normalizeCondPagamento(cab.Cond_Pagamento);

    // Validação básica
    if (new Date(cab.Data_Inicial) > new Date(cab.Data_Final)) {
      throw new Error('Data Inicial não pode ser maior que a Data Final');
    }

    const [resCab] = await conn.query(
      `INSERT INTO tabela_preco_cabecalho (Descricao, Data_Inicial, Hora_Inicial, Data_Final, Hora_Final, Cond_Pagamento, Tabela_Ativa, vitrine, usar_regras_fornecedor, excluido)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'N')`,
      [cab.Descricao, cab.Data_Inicial, cab.Hora_Inicial, cab.Data_Final, cab.Hora_Final, cab.Cond_Pagamento, cab.Tabela_Ativa || 'S', _sn(cab.vitrine), _sn(cab.usar_regras_fornecedor)]
    );

    const idTabela = resCab.insertId;

    await _insertItensTabela(conn, idTabela, itens);

    await conn.commit();
    res.status(201).json({ ok: true, id: idTabela });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ─── PUT /api/tabelas-preco/:id (Atualizar) ──────────────────────────────
router.put('/:id', async (req, res) => {
  await ensureTables();
  const pc = _permTabelaPrecos(req);
  if (pc.alterar !== 'S') return negarCad(res, 'Sem permissão para alterar tabela de preços');
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const { itens, ...cab } = req.body;
    const idTabela = req.params.id;
    cab.Cond_Pagamento = normalizeCondPagamento(cab.Cond_Pagamento);

    if (new Date(cab.Data_Inicial) > new Date(cab.Data_Final)) {
      throw new Error('Data Inicial não pode ser maior que a Data Final');
    }

    await conn.query(
      `UPDATE tabela_preco_cabecalho SET
        Descricao = ?, Data_Inicial = ?, Hora_Inicial = ?, Data_Final = ?, Hora_Final = ?, Cond_Pagamento = ?, Tabela_Ativa = ?, vitrine = ?, usar_regras_fornecedor = ?
       WHERE id = ?`,
      [cab.Descricao, cab.Data_Inicial, cab.Hora_Inicial, cab.Data_Final, cab.Hora_Final, cab.Cond_Pagamento, cab.Tabela_Ativa, _sn(cab.vitrine), _sn(cab.usar_regras_fornecedor), idTabela]
    );

    // Substituição de itens (Padrão Protheus: deleta e reinsere em lote)
    await conn.query(`DELETE FROM tabela_preco_itens WHERE id_tabela = ?`, [idTabela]);
    await _insertItensTabela(conn, idTabela, itens);

    await conn.commit();
    res.json({ ok: true, id: idTabela });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ─── DELETE /api/tabelas-preco/:id (Soft Delete) ─────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const pc = _permTabelaPrecos(req);
    if (pc.excluir !== 'S') return negarCad(res, 'Sem permissão para excluir tabela de preços');
    const pool = getPool();
    await pool.query(`UPDATE tabela_preco_cabecalho SET excluido = 'S' WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
module.exports = router;
