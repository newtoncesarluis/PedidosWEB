const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');

// Detecta nome da tabela de produtos (produto ou produtos)
async function getProdTable(pool) {
  const [r] = await pool.query(`SHOW TABLES LIKE 'produto'`);
  return r.length ? 'produto' : 'produtos';
}

function checkPerm(req, res, next) {
  const isAdmin = req.user?.perfil == 1 || req.user?.idperfil == 1;
  if (!isAdmin && req.user?.permissoes?.manutencaocadastros !== 'S') {
    return res.status(403).json({ error: 'Sem permissão para manutenção de cadastros' });
  }
  next();
}

// ─── PRODUTOS ────────────────────────────────────────────────────────────────

// GET /api/manutencao/produtos
router.get('/produtos', checkPerm, async (req, res) => {
  try {
    const pool = getPool();
    const tb = await getProdTable(pool);
    const { q = '', situacao = '', fornecedor = '', limit = 100, offset = 0 } = req.query;

    const where = [`(p.excluido='N' OR p.excluido IS NULL OR p.excluido='')`];
    const vals = [];

    if (q.trim()) { where.push(`p.descricao LIKE ?`); vals.push(`%${q.trim()}%`); }
    if (situacao) { where.push(`p.situacao=?`); vals.push(situacao); }
    if (fornecedor) { where.push(`p.cod_fornecedorpadrao=?`); vals.push(fornecedor); }

    const whereStr = where.join(' AND ');

    const [rows] = await pool.query(
      `SELECT p.ID as id, p.descricao, p.situacao,
              f.nome as fornecedor,
              p.multiplo_venda,
              (SELECT COUNT(*) FROM itensped i WHERE i.cod_produto = p.ID LIMIT 1) > 0 AS tem_movimento
         FROM ${tb} p
         LEFT JOIN fornecedores f ON f.id = p.cod_fornecedorpadrao
        WHERE ${whereStr}
        ORDER BY p.descricao
        LIMIT ? OFFSET ?`,
      [...vals, Number(limit), Number(offset)]
    );
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM ${tb} p WHERE ${whereStr}`, vals
    );
    res.json({ rows, total });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/manutencao/produtos/bulk
// body: { ids: [1,2,3] }
router.post('/produtos/bulk', checkPerm, async (req, res) => {
  try {
    const pool = getPool();
    const tb = await getProdTable(pool);
    const ids = (req.body.ids || []).map(Number).filter(Boolean);
    if (!ids.length) return res.status(400).json({ error: 'Nenhum item selecionado' });

    // IDs com movimento em pedidos
    const [movRows] = await pool.query(
      `SELECT DISTINCT cod_produto FROM itensped WHERE cod_produto IN (?)`,
      [ids]
    );
    const comMov = new Set(movRows.map(r => Number(r.cod_produto)));

    const semMov = ids.filter(id => !comMov.has(id));
    const comMovArr = ids.filter(id => comMov.has(id));

    let excluidos = 0, inativados = 0;

    if (semMov.length) {
      const [r] = await pool.query(
        `UPDATE ${tb} SET excluido='S' WHERE ID IN (?)`, [semMov]
      );
      excluidos = r.affectedRows;
    }
    if (comMovArr.length) {
      const [r] = await pool.query(
        `UPDATE ${tb} SET situacao='I' WHERE ID IN (?) AND situacao='A'`, [comMovArr]
      );
      inativados = r.affectedRows;
    }

    res.json({ ok: true, excluidos, inativados, total: ids.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── CLIENTES ────────────────────────────────────────────────────────────────

// GET /api/manutencao/clientes
router.get('/clientes', checkPerm, async (req, res) => {
  try {
    const pool = getPool();
    const { q = '', cidade = '', uf = '', limit = 100, offset = 0 } = req.query;

    const where = [`(c.excluido='N' OR c.excluido IS NULL OR c.excluido='')`];
    const vals = [];

    if (q.trim()) { where.push(`c.nome LIKE ?`); vals.push(`%${q.trim()}%`); }
    if (cidade.trim()) { where.push(`c.cidade LIKE ?`); vals.push(`%${cidade.trim()}%`); }
    if (uf.trim()) { where.push(`c.uf=?`); vals.push(uf.trim().toUpperCase()); }

    const whereStr = where.join(' AND ');

    const [rows] = await pool.query(
      `SELECT c.id, c.nome, c.cidade, c.uf, COALESCE(c.status,'A') as status,
              (SELECT COUNT(*) FROM pedidos p WHERE p.cod_cliente = c.id
                AND COALESCE(p.excluido,'N')='N' LIMIT 1) > 0 AS tem_movimento
         FROM clientes c
        WHERE ${whereStr}
        ORDER BY c.nome
        LIMIT ? OFFSET ?`,
      [...vals, Number(limit), Number(offset)]
    );
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM clientes c WHERE ${whereStr}`, vals
    );
    res.json({ rows, total });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/manutencao/clientes/bulk
router.post('/clientes/bulk', checkPerm, async (req, res) => {
  try {
    const pool = getPool();
    const ids = (req.body.ids || []).map(Number).filter(Boolean);
    if (!ids.length) return res.status(400).json({ error: 'Nenhum item selecionado' });

    const [movRows] = await pool.query(
      `SELECT DISTINCT cod_cliente FROM pedidos WHERE cod_cliente IN (?) AND COALESCE(excluido,'N')='N'`,
      [ids]
    );
    const comMov = new Set(movRows.map(r => Number(r.cod_cliente)));

    const semMov = ids.filter(id => !comMov.has(id));
    const comMovArr = ids.filter(id => comMov.has(id));

    let excluidos = 0, inativados = 0;

    if (semMov.length) {
      const [r] = await pool.query(
        `UPDATE clientes SET excluido='S', status='E', dtalterado=NOW() WHERE id IN (?)`, [semMov]
      );
      excluidos = r.affectedRows;
    }
    if (comMovArr.length) {
      const [r] = await pool.query(
        `UPDATE clientes SET status='I', dtalterado=NOW() WHERE id IN (?)`, [comMovArr]
      );
      inativados = r.affectedRows;
    }

    res.json({ ok: true, excluidos, inativados, total: ids.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── FÁBRICAS (fornecedores) ─────────────────────────────────────────────────

// GET /api/manutencao/fabricas
router.get('/fabricas', checkPerm, async (req, res) => {
  try {
    const pool = getPool();
    const { q = '', limit = 100, offset = 0 } = req.query;

    const where = [`(f.excluido='N' OR f.excluido IS NULL OR f.excluido='')`];
    const vals = [];

    if (q.trim()) {
      where.push(`f.nome LIKE ?`);
      vals.push(`%${q.trim()}%`);
    }

    const whereStr = where.join(' AND ');

    const [rows] = await pool.query(
      `SELECT f.id,
              f.nome,
              COALESCE(f.status,'A') as status,
              (SELECT COUNT(*) FROM pedidos p WHERE p.cod_fornecedor = f.id
                AND COALESCE(p.excluido,'N')='N' LIMIT 1) > 0 AS tem_movimento
         FROM fornecedores f
        WHERE ${whereStr}
        ORDER BY f.nome
        LIMIT ? OFFSET ?`,
      [...vals, Number(limit), Number(offset)]
    );
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM fornecedores f WHERE ${whereStr}`, vals
    );
    res.json({ rows, total });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/manutencao/fabricas/bulk
router.post('/fabricas/bulk', checkPerm, async (req, res) => {
  try {
    const pool = getPool();
    const ids = (req.body.ids || []).map(Number).filter(Boolean);
    if (!ids.length) return res.status(400).json({ error: 'Nenhum item selecionado' });

    const [movRows] = await pool.query(
      `SELECT DISTINCT cod_fornecedor FROM pedidos WHERE cod_fornecedor IN (?) AND COALESCE(excluido,'N')='N'`,
      [ids]
    );
    const comMov = new Set(movRows.map(r => Number(r.cod_fornecedor)));

    const semMov = ids.filter(id => !comMov.has(id));
    const comMovArr = ids.filter(id => comMov.has(id));

    let excluidos = 0, inativados = 0;

    if (semMov.length) {
      const [r] = await pool.query(
        `UPDATE fornecedores SET excluido='S', status='E', dtalterado=NOW() WHERE id IN (?)`, [semMov]
      );
      excluidos = r.affectedRows;
    }
    if (comMovArr.length) {
      const [r] = await pool.query(
        `UPDATE fornecedores SET status='I', dtalterado=NOW() WHERE id IN (?)`, [comMovArr]
      );
      inativados = r.affectedRows;
    }

    // Ao inativar/excluir fábricas, inativar produtos sem outro fornecedor ativo? (não — escopo da tela)
    res.json({ ok: true, excluidos, inativados, total: ids.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/manutencao/produtos/bulk-multiplo
// body: { ids: [1,2,3], multiplo_venda: 6 }
router.post('/produtos/bulk-multiplo', checkPerm, async (req, res) => {
  try {
    const pool = getPool();
    const tb = await getProdTable(pool);
    const ids = (req.body.ids || []).map(Number).filter(Boolean);
    const mvRaw = parseInt(req.body.multiplo_venda, 10);
    if (!ids.length) return res.status(400).json({ error: 'Nenhum item selecionado' });
    if (!Number.isFinite(mvRaw) || mvRaw < 0) return res.status(400).json({ error: 'Valor inválido' });
    const mv = mvRaw < 1 ? 1 : mvRaw; // 0 = "sem restrição" = equivale a 1

    const [r] = await pool.query(
      `UPDATE ${tb} SET multiplo_venda = ? WHERE ID IN (?)`,
      [mv, ids]
    );
    res.json({ ok: true, atualizados: r.affectedRows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/manutencao/fornecedores-lista (para o combo de filtro de produtos)
router.get('/fornecedores-lista', checkPerm, async (_req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT id, nome
         FROM fornecedores
        WHERE (excluido='N' OR excluido IS NULL OR excluido='')
        ORDER BY nome LIMIT 500`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// REATRIBUIÇÃO EM LOTE
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Lookups ────────────────────────────────────────────────────────────────

router.get('/reattr/lookup/vendedores', checkPerm, async (_req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT u.idusuario AS id, u.nomeusu AS nome
         FROM usuarios u
         INNER JOIN perfil p ON p.id = u.idperfil
        WHERE u.excluido='N' AND u.SITUACAO='ATIVO' AND p.p_vender='S'
        ORDER BY u.nomeusu LIMIT 300`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/reattr/lookup/regioes', checkPerm, async (_req, res) => {
  try {
    const pool = getPool();
    let rows = [];
    try { [rows] = await pool.query(`SELECT id, descricao FROM regiao_rota WHERE (status='A' OR status IS NULL) AND (excluido='N' OR excluido IS NULL) ORDER BY descricao LIMIT 300`); } catch (_) {}
    if (!rows.length) {
      try { [rows] = await pool.query(`SELECT id, descricao FROM regioes ORDER BY descricao LIMIT 300`); } catch (_) {}
    }
    if (!rows.length) {
      try { [rows] = await pool.query(`SELECT DISTINCT regiao AS id, regiao AS descricao FROM clientes WHERE regiao IS NOT NULL AND regiao <> '' ORDER BY regiao LIMIT 300`); } catch (_) {}
    }
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/reattr/lookup/segmentos', checkPerm, async (_req, res) => {
  try {
    const pool = getPool();
    // Tenta tabela categoria primeiro, depois segmentos
    let rows = [];
    try {
      [rows] = await pool.query(
        `SELECT id, descricao FROM categoria WHERE COALESCE(excluido,'N')='N' ORDER BY descricao LIMIT 300`
      );
    } catch (_) {
      try {
        [rows] = await pool.query(
          `SELECT id, descricao FROM segmentos WHERE COALESCE(excluido,'N')='N' ORDER BY descricao LIMIT 300`
        );
      } catch (_2) {}
    }
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/reattr/lookup/grupos', checkPerm, async (_req, res) => {
  try {
    const pool = getPool();
    const tb = await getProdTable(pool);
    const [rows] = await pool.query(
      `SELECT DISTINCT nome_grupo AS nome FROM ${tb}
        WHERE nome_grupo IS NOT NULL AND nome_grupo <> ''
          AND (excluido='N' OR excluido IS NULL OR excluido='')
        ORDER BY nome_grupo LIMIT 300`
    );
    res.json(rows.map(r => ({ id: r.nome, nome: r.nome })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Listar clientes para reatribuição ──────────────────────────────────────
// GET /api/manutencao/reattr/clientes?campo=vendedor&valor_atual=5&regiao=2&segmento=3&cidade=&uf=
router.get('/reattr/clientes', checkPerm, async (req, res) => {
  try {
    const pool = getPool();
    const { campo, valor_atual, regiao, segmento, cidade, uf, limit = 200, offset = 0 } = req.query;

    const where = [`(c.excluido='N' OR c.excluido IS NULL OR c.excluido='')`];
    const vals = [];

    if (campo === 'vendedor' && valor_atual) {
      where.push(`c.cod_vendedor = ?`); vals.push(valor_atual);
    }
    if (campo === 'regiao' && valor_atual) {
      where.push(`c.regiao = ?`); vals.push(valor_atual);
    }
    if (campo === 'segmento' && valor_atual) {
      where.push(`c.cod_segmento = ?`); vals.push(valor_atual);
    }
    if (regiao && campo !== 'regiao')  { where.push(`c.regiao = ?`);        vals.push(regiao); }
    if (segmento && campo !== 'segmento') { where.push(`c.cod_segmento = ?`); vals.push(segmento); }
    if (cidade.trim()) { where.push(`c.cidade LIKE ?`);  vals.push(`%${cidade.trim()}%`); }
    if (uf.trim())     { where.push(`c.uf = ?`);          vals.push(uf.trim().toUpperCase()); }

    const whereStr = where.join(' AND ');

    const [rows] = await pool.query(
      `SELECT c.id, c.nome, c.cidade, c.uf,
              COALESCE(u.nomeusu,'—') AS nome_vendedor,
              c.cod_vendedor,
              r.descricao AS nome_regiao, c.regiao,
              c.segmento, c.cod_segmento
         FROM clientes c
         LEFT JOIN usuarios u ON u.idusuario = c.cod_vendedor AND u.excluido='N'
         LEFT JOIN regiao_rota r ON r.id = c.regiao
        WHERE ${whereStr}
        ORDER BY c.nome
        LIMIT ? OFFSET ?`,
      [...vals, Number(limit), Number(offset)]
    );
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM clientes c WHERE ${whereStr}`, vals
    );
    res.json({ rows, total });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/manutencao/reattr/clientes/bulk
// body: { ids, campo, novo_id, novo_texto }
router.post('/reattr/clientes/bulk', checkPerm, async (req, res) => {
  try {
    const pool = getPool();
    const { ids, campo, novo_id, novo_texto } = req.body;
    const idList = (ids || []).map(Number).filter(Boolean);
    if (!idList.length) return res.status(400).json({ error: 'Nenhum item selecionado' });

    const camposPermitidos = ['vendedor', 'regiao', 'segmento'];
    if (!camposPermitidos.includes(campo)) return res.status(400).json({ error: 'Campo inválido' });

    let sql, sqlVals;
    if (campo === 'vendedor') {
      sql = `UPDATE clientes SET cod_vendedor=?, dtalterado=NOW() WHERE id IN (?)`;
      sqlVals = [novo_id || null, idList];
    } else if (campo === 'regiao') {
      sql = `UPDATE clientes SET regiao=?, dtalterado=NOW() WHERE id IN (?)`;
      sqlVals = [novo_id || null, idList];
    } else if (campo === 'segmento') {
      sql = `UPDATE clientes SET cod_segmento=?, segmento=?, dtalterado=NOW() WHERE id IN (?)`;
      sqlVals = [novo_id || null, novo_texto || '', idList];
    }

    const [r] = await pool.query(sql, sqlVals);
    res.json({ ok: true, atualizados: r.affectedRows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Listar produtos para reatribuição ──────────────────────────────────────
// GET /api/manutencao/reattr/produtos?campo=fornecedor&valor_atual=10&grupo=
router.get('/reattr/produtos', checkPerm, async (req, res) => {
  try {
    const pool = getPool();
    const tb = await getProdTable(pool);
    const { campo, valor_atual, grupo, limit = 200, offset = 0 } = req.query;

    const where = [`(p.excluido='N' OR p.excluido IS NULL OR p.excluido='')`];
    const vals = [];

    if (campo === 'fornecedor' && valor_atual) {
      where.push(`p.cod_fornecedorpadrao = ?`); vals.push(valor_atual);
    }
    if (campo === 'grupo' && valor_atual) {
      where.push(`p.nome_grupo = ?`); vals.push(valor_atual);
    }
    if (grupo && campo !== 'grupo')  { where.push(`p.nome_grupo = ?`); vals.push(grupo); }

    const whereStr = where.join(' AND ');

    const [rows] = await pool.query(
      `SELECT p.ID as id, p.descricao, p.situacao, p.nome_grupo,
              f.nome AS nome_fornecedor,
              p.cod_fornecedorpadrao
         FROM ${tb} p
         LEFT JOIN fornecedores f ON f.id = p.cod_fornecedorpadrao
        WHERE ${whereStr}
        ORDER BY p.descricao
        LIMIT ? OFFSET ?`,
      [...vals, Number(limit), Number(offset)]
    );
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM ${tb} p WHERE ${whereStr}`, vals
    );
    res.json({ rows, total });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/manutencao/reattr/produtos/bulk
// body: { ids, campo, novo_id, novo_texto }
router.post('/reattr/produtos/bulk', checkPerm, async (req, res) => {
  try {
    const pool = getPool();
    const tb = await getProdTable(pool);
    const { ids, campo, novo_id, novo_texto } = req.body;
    const idList = (ids || []).map(Number).filter(Boolean);
    if (!idList.length) return res.status(400).json({ error: 'Nenhum item selecionado' });

    const camposPermitidos = ['fornecedor', 'grupo'];
    if (!camposPermitidos.includes(campo)) return res.status(400).json({ error: 'Campo inválido' });

    let sql, sqlVals;
    if (campo === 'fornecedor') {
      sql = `UPDATE ${tb} SET cod_fornecedorpadrao=? WHERE ID IN (?)`;
      sqlVals = [novo_id || null, idList];
    } else if (campo === 'grupo') {
      sql = `UPDATE ${tb} SET nome_grupo=? WHERE ID IN (?)`;
      sqlVals = [novo_texto || '', idList];
    }

    const [r] = await pool.query(sql, sqlVals);
    res.json({ ok: true, atualizados: r.affectedRows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
