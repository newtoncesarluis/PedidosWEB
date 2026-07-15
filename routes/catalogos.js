'use strict';

/**
 * Catálogos visuais do vendedor — CRUD + listagem para o pedido.
 * Tabelas: catalogos / catalogos_itens (criadas on-demand via ensureCatalogosTables).
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getPool } = require('../config/database');
const { ensureCatalogosTables } = require('../config/schema-migrations');
const { getProdTabela } = require('../config/produto-colunas');

const router = express.Router();

const _uploadsBase = path.join(process.cwd(), 'public', 'uploads', 'catalogos');
const _storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(_uploadsBase, String(req.params.id || 'tmp'));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    cb(null, `${Date.now()}_${base}${ext}`);
  },
});
const upload = multer({
  storage: _storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(file.originalname);
    cb(ok ? null : new Error('Tipo de arquivo não permitido'), ok);
  },
});

function permSn(req, key) {
  if (req.user?.perfil == 1) return true;
  const p = req.user?.permissoes || {};
  // Telas novas: se a chave ainda não veio no JWT/perfil, libera (default 'S')
  if (p[key] === undefined || p[key] === null || p[key] === '') return true;
  return p[key] === 'S';
}

function podeVer(req) {
  return permSn(req, 'gtela_catalogos') || req.user?.perfil == 1;
}

function podeGerenciar(req) {
  if (req.user?.perfil == 1) return true;
  const p = req.user?.permissoes || {};
  if (p.manutencaocadastros === 'S') return true;
  return permSn(req, 'gtela_catalogos');
}

async function ensure(pool) {
  await ensureCatalogosTables(pool);
}

function sn(v, def = 'S') {
  const s = String(v == null ? def : v).toUpperCase();
  return s === 'N' ? 'N' : 'S';
}

async function countItens(pool, idCatalogo) {
  const [[r]] = await pool.query(
    `SELECT COUNT(*) AS n FROM catalogos_itens
     WHERE id_catalogo = ? AND (excluido='N' OR excluido IS NULL OR excluido='')`,
    [idCatalogo]
  );
  return r?.n || 0;
}

async function getCatalogo(pool, id) {
  const [rows] = await pool.query(
    `SELECT c.*, f.nome AS nome_fornecedor
     FROM catalogos c
     LEFT JOIN fornecedores f ON f.id = c.cod_fornecedor
     WHERE c.id = ? AND (c.excluido='N' OR c.excluido IS NULL OR c.excluido='')`,
    [id]
  );
  return rows[0] || null;
}

async function listItensCatalogo(pool, idCatalogo) {
  const tb = await getProdTabela(pool);
  const [cols] = await pool.query(`DESCRIBE \`${tb}\``);
  const colSet = new Set(cols.map((c) => c.Field));
  const idCol = colSet.has('ID') ? 'ID' : 'id';
  const fotoExpr = colSet.has('foto_principal')
    ? `COALESCE(p.foto_principal, (
         SELECT CONCAT('/uploads/produtos/', pi.cod_produto, '/', pi.filename)
         FROM produto_imagens pi
         WHERE pi.cod_produto = p.\`${idCol}\` AND (pi.is_principal = 1 OR pi.is_principal = 'S')
         ORDER BY pi.ordem ASC LIMIT 1
       ))`
    : `(
         SELECT CONCAT('/uploads/produtos/', pi.cod_produto, '/', pi.filename)
         FROM produto_imagens pi
         WHERE pi.cod_produto = p.\`${idCol}\` AND (pi.is_principal = 1 OR pi.is_principal = 'S')
         ORDER BY pi.ordem ASC LIMIT 1
       )`;
  const tipograde = colSet.has('tipograde') ? 'IFNULL(p.tipograde, 0)' : '0';
  const vlr = colSet.has('vlr_venda') ? 'COALESCE(p.vlr_venda, 0)' : '0';
  const mv = colSet.has('multiplo_venda') ? 'IFNULL(p.multiplo_venda, 1)' : '1';
  const qmin = colSet.has('qtd_minima_pedido') ? 'IFNULL(p.qtd_minima_pedido, 0)' : '0';
  const precopeso = colSet.has('precopeso') ? "IFNULL(p.precopeso, 'N')" : "'N'";
  const kilo = colSet.has('kilo_embalagem') ? 'IFNULL(p.kilo_embalagem, 0)' : '0';
  const disp = colSet.has('disponivel') ? "IFNULL(p.disponivel, 'S')" : "'S'";
  const forn = colSet.has('cod_fornecedorpadrao') ? 'p.cod_fornecedorpadrao' : 'NULL';
  const [rows] = await pool.query(
    `SELECT ci.id, ci.cod_produto, ci.ordem,
            p.descricao AS desc_produto,
            p.cod_fabricante,
            p.unidade,
            ${tipograde} AS tipograde,
            ${fotoExpr} AS foto_principal,
            ${vlr} AS vlr_venda,
            ${mv} AS multiplo_venda,
            ${qmin} AS qtd_minima_pedido,
            ${precopeso} AS precopeso,
            ${kilo} AS kilo_embalagem,
            ${disp} AS disponivel,
            ${forn} AS cod_fornecedorpadrao
     FROM catalogos_itens ci
     INNER JOIN \`${tb}\` p ON p.\`${idCol}\` = ci.cod_produto
     WHERE ci.id_catalogo = ?
       AND (ci.excluido='N' OR ci.excluido IS NULL OR ci.excluido='')
       AND (p.excluido='N' OR p.excluido IS NULL OR p.excluido='')
       AND (p.situacao='A' OR p.situacao IS NULL OR p.situacao='')
     ORDER BY ci.ordem ASC, p.descricao ASC`,
    [idCatalogo]
  );
  return rows;
}

// ─── GET /api/catalogos ───────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  if (!podeVer(req)) return res.status(403).json({ error: 'Sem permissão' });
  try {
    const pool = getPool();
    await ensure(pool);
    const q = String(req.query.q || '').trim();
    const codForn = parseInt(req.query.cod_fornecedor || req.query.id_fornecedor, 10) || null;
    const todos = req.query.todos === '1' || req.query.todos === 'true';
    const where = [`(c.excluido='N' OR c.excluido IS NULL OR c.excluido='')`];
    const vals = [];
    if (!todos) {
      where.push(`c.ativo='S'`);
    }
    if (codForn) {
      where.push(`(c.cod_fornecedor = ? OR c.cod_fornecedor IS NULL)`);
      vals.push(codForn);
    }
    if (q) {
      where.push(`(c.nome LIKE ? OR c.subtitulo LIKE ?)`);
      vals.push(`%${q}%`, `%${q}%`);
    }
    const [rows] = await pool.query(
      `SELECT c.*, f.nome AS nome_fornecedor,
              (SELECT COUNT(*) FROM catalogos_itens ci
               WHERE ci.id_catalogo = c.id
                 AND (ci.excluido='N' OR ci.excluido IS NULL OR ci.excluido='')) AS qtd_itens
       FROM catalogos c
       LEFT JOIN fornecedores f ON f.id = c.cod_fornecedor
       WHERE ${where.join(' AND ')}
       ORDER BY c.ordem ASC, c.nome ASC
       LIMIT 200`,
      vals
    );
    res.json({ catalogos: rows });
  } catch (err) {
    console.error('[catalogos GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/catalogos/:id ───────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  if (!podeVer(req)) return res.status(403).json({ error: 'Sem permissão' });
  try {
    const pool = getPool();
    await ensure(pool);
    const cat = await getCatalogo(pool, req.params.id);
    if (!cat) return res.status(404).json({ error: 'Catálogo não encontrado' });
    const itens = await listItensCatalogo(pool, cat.id);
    cat.qtd_itens = itens.length;
    res.json({ catalogo: cat, itens });
  } catch (err) {
    console.error('[catalogos GET :id]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/catalogos ──────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  if (!podeGerenciar(req)) return res.status(403).json({ error: 'Sem permissão' });
  try {
    const pool = getPool();
    await ensure(pool);
    const b = req.body || {};
    const nome = String(b.nome || '').trim();
    if (!nome) return res.status(400).json({ error: 'Informe o nome do catálogo' });
    const [r] = await pool.query(
      `INSERT INTO catalogos
        (nome, subtitulo, cod_fornecedor, imagem_capa, cor_fundo, ordem, ativo, excluido, observacoes, id_usuario)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'N', ?, ?)`,
      [
        nome.slice(0, 200),
        (b.subtitulo || '').toString().trim().slice(0, 200) || null,
        parseInt(b.cod_fornecedor, 10) || null,
        (b.imagem_capa || '').toString().trim().slice(0, 500) || null,
        (b.cor_fundo || '#1f2937').toString().trim().slice(0, 20) || '#1f2937',
        parseInt(b.ordem, 10) || 0,
        sn(b.ativo, 'S'),
        (b.observacoes || '').toString().trim() || null,
        req.user?.id || req.user?.idusuario || null,
      ]
    );
    const id = r.insertId;
    if (Array.isArray(b.itens) && b.itens.length) {
      await gravarItens(pool, id, b.itens);
    }
    const cat = await getCatalogo(pool, id);
    res.json({ ok: true, id, catalogo: cat });
  } catch (err) {
    console.error('[catalogos POST]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/catalogos/:id ───────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  if (!podeGerenciar(req)) return res.status(403).json({ error: 'Sem permissão' });
  try {
    const pool = getPool();
    await ensure(pool);
    const id = parseInt(req.params.id, 10);
    const cat = await getCatalogo(pool, id);
    if (!cat) return res.status(404).json({ error: 'Catálogo não encontrado' });
    const b = req.body || {};
    const nome = String(b.nome != null ? b.nome : cat.nome).trim();
    if (!nome) return res.status(400).json({ error: 'Informe o nome do catálogo' });
    await pool.query(
      `UPDATE catalogos SET
        nome=?, subtitulo=?, cod_fornecedor=?, imagem_capa=?, cor_fundo=?,
        ordem=?, ativo=?, observacoes=?
       WHERE id=?`,
      [
        nome.slice(0, 200),
        (b.subtitulo != null ? b.subtitulo : cat.subtitulo || '').toString().trim().slice(0, 200) || null,
        b.cod_fornecedor !== undefined ? (parseInt(b.cod_fornecedor, 10) || null) : cat.cod_fornecedor,
        b.imagem_capa !== undefined
          ? ((b.imagem_capa || '').toString().trim().slice(0, 500) || null)
          : cat.imagem_capa,
        (b.cor_fundo != null ? b.cor_fundo : cat.cor_fundo || '#1f2937').toString().trim().slice(0, 20),
        b.ordem !== undefined ? (parseInt(b.ordem, 10) || 0) : (cat.ordem || 0),
        b.ativo !== undefined ? sn(b.ativo, 'S') : sn(cat.ativo, 'S'),
        b.observacoes !== undefined
          ? ((b.observacoes || '').toString().trim() || null)
          : cat.observacoes,
        id,
      ]
    );
    if (Array.isArray(b.itens)) {
      await gravarItens(pool, id, b.itens);
    }
    const updated = await getCatalogo(pool, id);
    const itens = await listItensCatalogo(pool, id);
    res.json({ ok: true, catalogo: updated, itens });
  } catch (err) {
    console.error('[catalogos PUT]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/catalogos/:id (soft) ─────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  if (!podeGerenciar(req)) return res.status(403).json({ error: 'Sem permissão' });
  try {
    const pool = getPool();
    await ensure(pool);
    const id = parseInt(req.params.id, 10);
    await pool.query(`UPDATE catalogos SET excluido='S', ativo='N' WHERE id=?`, [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/catalogos/:id/itens ─────────────────────────────────────────────
router.put('/:id/itens', async (req, res) => {
  if (!podeGerenciar(req)) return res.status(403).json({ error: 'Sem permissão' });
  try {
    const pool = getPool();
    await ensure(pool);
    const id = parseInt(req.params.id, 10);
    const cat = await getCatalogo(pool, id);
    if (!cat) return res.status(404).json({ error: 'Catálogo não encontrado' });
    await gravarItens(pool, id, req.body?.itens || []);
    const itens = await listItensCatalogo(pool, id);
    res.json({ ok: true, itens, qtd_itens: itens.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/catalogos/:id/capa ─────────────────────────────────────────────
router.post('/:id/capa', upload.single('arquivo'), async (req, res) => {
  if (!podeGerenciar(req)) return res.status(403).json({ error: 'Sem permissão' });
  try {
    const pool = getPool();
    await ensure(pool);
    const id = parseInt(req.params.id, 10);
    const cat = await getCatalogo(pool, id);
    if (!cat) return res.status(404).json({ error: 'Catálogo não encontrado' });
    if (!req.file) return res.status(400).json({ error: 'Envie um arquivo de imagem' });
    const url = `/uploads/catalogos/${id}/${req.file.filename}`;
    await pool.query(`UPDATE catalogos SET imagem_capa=? WHERE id=?`, [url, id]);
    res.json({ ok: true, imagem_capa: url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function gravarItens(pool, idCatalogo, itens) {
  await pool.query(
    `UPDATE catalogos_itens SET excluido='S' WHERE id_catalogo=?`,
    [idCatalogo]
  );
  const lista = Array.isArray(itens) ? itens : [];
  let ordem = 0;
  for (const it of lista) {
    const cod = parseInt(it.cod_produto || it.id || it.ID, 10);
    if (!cod) continue;
    ordem += 1;
    const ord = parseInt(it.ordem, 10) || ordem;
    const [exist] = await pool.query(
      `SELECT id FROM catalogos_itens WHERE id_catalogo=? AND cod_produto=? LIMIT 1`,
      [idCatalogo, cod]
    );
    if (exist[0]) {
      await pool.query(
        `UPDATE catalogos_itens SET excluido='N', ordem=? WHERE id=?`,
        [ord, exist[0].id]
      );
    } else {
      await pool.query(
        `INSERT INTO catalogos_itens (id_catalogo, cod_produto, ordem, excluido) VALUES (?, ?, ?, 'N')`,
        [idCatalogo, cod, ord]
      );
    }
  }
  return countItens(pool, idCatalogo);
}

module.exports = router;
