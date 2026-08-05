'use strict';

/**
 * CRUD unificado dos auxiliares do produto:
 * grupos-produto, subfamilias, unidades, tipos-grade, locais (local_armazenamento)
 */
const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');
const { permCrud, negarCad } = require('../config/cadastros-permissoes');
const {
  ensureProdutoAuxiliares,
  ensureGruposTable,
  ensureLocalArmazenamentoTable,
  normKey,
} = require('../config/produto-auxiliares-schema');

const _perm = (req) => permCrud(req, {
  incluir: 'incluir_produto_auxiliares',
  alterar: 'alterar_produto_auxiliares',
  excluir: 'excluir_produto_auxiliares',
});

function codigoFromDesc(desc) {
  return normKey(desc).replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
}

async function listAux(pool, table) {
  const [rows] = await pool.query(
    `SELECT id, codigo, descricao, ordem, status
     FROM \`${table}\`
     WHERE COALESCE(excluido,'N')='N'
     ORDER BY ordem, descricao`
  );
  return rows;
}

function mountAuxCrud(basePath, table, label) {
  router.get(basePath, async (req, res) => {
    try {
      const pool = getPool();
      await ensureProdutoAuxiliares(pool);
      const rows = await listAux(pool, table);
      res.json({ ok: true, items: rows });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post(basePath, async (req, res) => {
    try {
      const pc = _perm(req);
      if (pc.incluir !== 'S') return negarCad(res, `Sem permissão para incluir ${label}`);
      const pool = getPool();
      await ensureProdutoAuxiliares(pool);
      const descricao = String(req.body.descricao || '').trim().toUpperCase();
      let codigo = String(req.body.codigo || '').trim().toUpperCase() || codigoFromDesc(descricao);
      const ordem = parseInt(req.body.ordem, 10) || 0;
      if (!descricao) return res.status(400).json({ error: 'Descrição é obrigatória' });
      if (!codigo) return res.status(400).json({ error: 'Código é obrigatório' });
      const [dup] = await pool.query(
        `SELECT id FROM \`${table}\` WHERE UPPER(TRIM(codigo))=? AND COALESCE(excluido,'N')='N' LIMIT 1`,
        [codigo]
      );
      if (dup.length) return res.status(409).json({ error: 'Já existe um registro com este código' });
      const [ins] = await pool.query(
        `INSERT INTO \`${table}\` (codigo, descricao, ordem, status, excluido) VALUES (?,?,?,'A','N')`,
        [codigo, descricao, ordem]
      );
      res.json({ ok: true, id: ins.insertId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put(`${basePath}/:id`, async (req, res) => {
    try {
      const pc = _perm(req);
      if (pc.alterar !== 'S') return negarCad(res, `Sem permissão para alterar ${label}`);
      const pool = getPool();
      const id = parseInt(req.params.id, 10);
      const descricao = String(req.body.descricao || '').trim().toUpperCase();
      let codigo = String(req.body.codigo || '').trim().toUpperCase() || codigoFromDesc(descricao);
      const ordem = parseInt(req.body.ordem, 10) || 0;
      const status = String(req.body.status || 'A').toUpperCase() === 'I' ? 'I' : 'A';
      if (!descricao) return res.status(400).json({ error: 'Descrição é obrigatória' });
      await pool.query(
        `UPDATE \`${table}\` SET codigo=?, descricao=?, ordem=?, status=? WHERE id=?`,
        [codigo, descricao, ordem, status, id]
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete(`${basePath}/:id`, async (req, res) => {
    try {
      const pc = _perm(req);
      if (pc.excluir !== 'S') return negarCad(res, `Sem permissão para excluir ${label}`);
      const pool = getPool();
      await pool.query(
        `UPDATE \`${table}\` SET excluido='S' WHERE id=?`,
        [parseInt(req.params.id, 10)]
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

mountAuxCrud('/subfamilias', 'subfamilia_produto', 'subfamília');
mountAuxCrud('/unidades', 'unidade_produto', 'unidade');
mountAuxCrud('/tipos-grade', 'tipo_produto_grade', 'tipo de grade');

// ─── Grupos (tabela legado grupos) ───────────────────────────────────────────
router.get('/grupos', async (req, res) => {
  try {
    const pool = getPool();
    await ensureProdutoAuxiliares(pool);
    const [rows] = await pool.query(
      `SELECT id, descricao,
              CASE WHEN UPPER(TRIM(IFNULL(ativo,'SIM'))) IN ('SIM','S','A','1') THEN 'A' ELSE 'I' END AS status
       FROM grupos
       WHERE COALESCE(excluido,'N')='N'
       ORDER BY descricao`
    );
    res.json({ ok: true, items: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/grupos', async (req, res) => {
  try {
    const pc = _perm(req);
    if (pc.incluir !== 'S') return negarCad(res, 'Sem permissão para incluir grupo');
    const pool = getPool();
    await ensureGruposTable(pool);
    const descricao = String(req.body.descricao || '').trim().toUpperCase();
    if (!descricao) return res.status(400).json({ error: 'Descrição é obrigatória' });
    const [dup] = await pool.query(
      `SELECT id FROM grupos WHERE UPPER(TRIM(descricao))=? AND COALESCE(excluido,'N')='N' LIMIT 1`,
      [descricao]
    );
    if (dup.length) return res.status(409).json({ error: 'Já existe um grupo com esta descrição' });
    const [ins] = await pool.query(
      `INSERT INTO grupos (descricao, ativo, excluido) VALUES (?,'SIM','N')`,
      [descricao]
    );
    res.json({ ok: true, id: ins.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/grupos/:id', async (req, res) => {
  try {
    const pc = _perm(req);
    if (pc.alterar !== 'S') return negarCad(res, 'Sem permissão para alterar grupo');
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const descricao = String(req.body.descricao || '').trim().toUpperCase();
    const ativo = String(req.body.status || 'A').toUpperCase() === 'I' ? 'NAO' : 'SIM';
    if (!descricao) return res.status(400).json({ error: 'Descrição é obrigatória' });
    await pool.query(`UPDATE grupos SET descricao=?, ativo=? WHERE id=?`, [descricao, ativo, id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/grupos/:id', async (req, res) => {
  try {
    const pc = _perm(req);
    if (pc.excluir !== 'S') return negarCad(res, 'Sem permissão para excluir grupo');
    const pool = getPool();
    await pool.query(`UPDATE grupos SET excluido='S' WHERE id=?`, [parseInt(req.params.id, 10)]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Locais (local_armazenamento — mesma tabela do produto) ──────────────────
router.get('/locais', async (req, res) => {
  try {
    const pool = getPool();
    await ensureProdutoAuxiliares(pool);
    const [rows] = await pool.query(
      `SELECT id, nome_local AS descricao, nome_local,
              CASE WHEN UPPER(TRIM(IFNULL(status,'A'))) IN ('I','N','NAO') THEN 'I' ELSE 'A' END AS status
       FROM local_armazenamento
       WHERE COALESCE(excluido,'N')='N'
       ORDER BY nome_local`
    );
    res.json({ ok: true, items: rows, locais: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/locais', async (req, res) => {
  try {
    const pc = _perm(req);
    if (pc.incluir !== 'S') return negarCad(res, 'Sem permissão para incluir local');
    const pool = getPool();
    await ensureLocalArmazenamentoTable(pool);
    const nome = String(req.body.descricao || req.body.nome_local || '').trim().toUpperCase();
    if (!nome) return res.status(400).json({ error: 'Nome do local é obrigatório' });
    const [ins] = await pool.query(
      `INSERT INTO local_armazenamento (nome_local, excluido, status) VALUES (?,'N','A')`,
      [nome]
    );
    res.json({ ok: true, id: ins.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/locais/:id', async (req, res) => {
  try {
    const pc = _perm(req);
    if (pc.alterar !== 'S') return negarCad(res, 'Sem permissão para alterar local');
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const nome = String(req.body.descricao || req.body.nome_local || '').trim().toUpperCase();
    const status = String(req.body.status || 'A').toUpperCase() === 'I' ? 'I' : 'A';
    if (!nome) return res.status(400).json({ error: 'Nome do local é obrigatório' });
    await pool.query(
      `UPDATE local_armazenamento SET nome_local=?, status=? WHERE id=?`,
      [nome, status, id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/locais/:id', async (req, res) => {
  try {
    const pc = _perm(req);
    if (pc.excluir !== 'S') return negarCad(res, 'Sem permissão para excluir local');
    const pool = getPool();
    await pool.query(
      `UPDATE local_armazenamento SET excluido='S' WHERE id=?`,
      [parseInt(req.params.id, 10)]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
