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
const {
  detectProdImagensTb,
  detectProdCols,
  buildProdutoFotoSql,
  corrigirFotoItens,
  fotoExisteNoDisco,
} = require('../config/produto-foto-resolve');

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
  const prodCols = await detectProdCols(pool, tb);
  const hasImgTb = await detectProdImagensTb(pool);
  const maeWhere = `(mae.excluido='N' OR mae.excluido IS NULL OR mae.excluido='')`;
  const fotoExpr = buildProdutoFotoSql(tb, prodCols, hasImgTb, { idCol, maeWhere });
  const tipograde = colSet.has('tipograde') ? 'IFNULL(p.tipograde, 0)' : '0';
  const tipoprod = colSet.has('tipoprodutograde') ? 'p.tipoprodutograde' : 'NULL';
  const vlr = colSet.has('vlr_venda') ? 'COALESCE(p.vlr_venda, 0)' : '0';
  const mv = colSet.has('multiplo_venda') ? 'IFNULL(p.multiplo_venda, 1)' : '1';
  const qmin = colSet.has('qtd_minima_pedido') ? 'IFNULL(p.qtd_minima_pedido, 0)' : '0';
  const precopeso = colSet.has('precopeso') ? "IFNULL(p.precopeso, 'N')" : "'N'";
  const kilo = colSet.has('kilo_embalagem') ? 'IFNULL(p.kilo_embalagem, 0)' : '0';
  const disp = colSet.has('disponivel') ? "IFNULL(p.disponivel, 'S')" : "'S'";
  const forn = colSet.has('cod_fornecedorpadrao') ? 'p.cod_fornecedorpadrao' : 'NULL';
  const idRef = colSet.has('id_referencia') ? 'p.id_referencia' : 'NULL';
  const cor1 = colSet.has('cor1') ? 'p.cor1' : 'NULL';
  const nomeGrupo = colSet.has('nome_grupo') ? 'p.nome_grupo' : 'NULL';
  const codBarras = colSet.has('cod_barras') ? 'p.cod_barras' : 'NULL';
  const embMaster = colSet.has('embalagemmaster') ? 'IFNULL(p.embalagemmaster, 0)' : '0';
  const apelido = colSet.has('apelido') ? 'p.apelido' : 'NULL';
  const [rows] = await pool.query(
    `SELECT ci.id, ci.cod_produto, ci.ordem,
            p.descricao AS desc_produto,
            p.cod_fabricante,
            p.unidade,
            ${tipograde} AS tipograde,
            ${tipoprod} AS tipoprodutograde,
            ${fotoExpr},
            ${vlr} AS vlr_venda,
            ${mv} AS multiplo_venda,
            ${qmin} AS qtd_minima_pedido,
            ${precopeso} AS precopeso,
            ${kilo} AS kilo_embalagem,
            ${disp} AS disponivel,
            ${forn} AS cod_fornecedorpadrao,
            ${idRef} AS id_referencia,
            ${cor1} AS cor1,
            ${nomeGrupo} AS nome_grupo,
            ${codBarras} AS cod_barras,
            ${embMaster} AS embalagemmaster,
            ${apelido} AS apelido
     FROM catalogos_itens ci
     INNER JOIN \`${tb}\` p ON p.\`${idCol}\` = ci.cod_produto
     WHERE ci.id_catalogo = ?
       AND (ci.excluido='N' OR ci.excluido IS NULL OR ci.excluido='')
       AND (p.excluido='N' OR p.excluido IS NULL OR p.excluido='')
       AND (p.situacao='A' OR p.situacao IS NULL OR p.situacao='')
     ORDER BY ci.ordem ASC, p.descricao ASC`,
    [idCatalogo]
  );
  await corrigirFotoItens(pool, rows, {
    idField: 'cod_produto',
    resolveOpts: {
      prodTb: tb,
      prodCols,
      hasImgTb,
      idCol,
      excluidoSql: `(excluido='N' OR excluido IS NULL OR excluido='')`,
    },
  });
  return rows;
}

function statsItens(itens) {
  const total = itens.length;
  const comFoto = itens.filter((i) => i.foto_principal && fotoExisteNoDisco(i.foto_principal)).length;
  return { total, com_foto: comFoto, sem_foto: total - comFoto };
}

// ─── POST /api/catalogos/gerar-por-grupos ─────────────────────────────────────
// Cria/atualiza um catálogo por nome_grupo da fábrica — monta o índice em minutos.
router.post('/gerar-por-grupos', async (req, res) => {
  if (!podeGerenciar(req)) return res.status(403).json({ error: 'Sem permissão' });
  try {
    const pool = getPool();
    await ensure(pool);
    const codForn = parseInt(req.body.cod_fornecedor || req.body.id_fornecedor, 10);
    if (!codForn) return res.status(400).json({ error: 'Informe a fábrica (cod_fornecedor)' });

    const tb = await getProdTabela(pool);
    const [cols] = await pool.query(`DESCRIBE \`${tb}\``);
    const colSet = new Set(cols.map((c) => c.Field));
    const idCol = colSet.has('ID') ? 'ID' : 'id';
    if (!colSet.has('nome_grupo')) {
      return res.status(422).json({
        error: 'Produtos sem campo nome_grupo nesta base. Use «+ Incluir por fábrica» em cada catálogo.',
      });
    }
    const fornCol = colSet.has('cod_fornecedorpadrao') ? 'cod_fornecedorpadrao' : null;
    if (!fornCol) {
      return res.status(422).json({ error: 'Produtos sem fornecedor padrão nesta base.' });
    }

    const [produtos] = await pool.query(
      `SELECT \`${idCol}\` AS id, TRIM(nome_grupo) AS nome_grupo
       FROM \`${tb}\`
       WHERE ${fornCol} = ?
         AND (excluido='N' OR excluido IS NULL OR excluido='')
         AND (situacao='A' OR situacao IS NULL OR situacao='')
         AND TRIM(COALESCE(nome_grupo,'')) <> ''
       ORDER BY nome_grupo, descricao`,
      [codForn]
    );

    if (!produtos.length) {
      return res.status(404).json({
        error: 'Nenhum produto ativo com «Grupo» preenchido para esta fábrica. Cadastre nome_grupo nos produtos ou inclua manualmente.',
      });
    }

    const porGrupo = new Map();
    produtos.forEach((p) => {
      const g = String(p.nome_grupo || '').trim();
      if (!porGrupo.has(g)) porGrupo.set(g, []);
      porGrupo.get(g).push(p.id);
    });

    const userId = req.user?.id || req.user?.idusuario || null;
    const criados = [];
    const atualizados = [];
    let ordemCat = 0;

    for (const [grupo, ids] of porGrupo.entries()) {
      ordemCat += 1;
      const nomeCat = grupo.startsWith('Linha') ? grupo : `Linha ${grupo}`;
      const [[exist]] = await pool.query(
        `SELECT id FROM catalogos
         WHERE nome = ? AND cod_fornecedor = ?
           AND (excluido='N' OR excluido IS NULL OR excluido='')
         LIMIT 1`,
        [nomeCat, codForn]
      );

      let idCat;
      if (exist) {
        idCat = exist.id;
        await pool.query(
          `UPDATE catalogos SET ativo='S', subtitulo=?, ordem=? WHERE id=?`,
          [`${ids.length} produto(s) · gerado automaticamente`, ordemCat, idCat]
        );
        atualizados.push({ id: idCat, nome: nomeCat, qtd: ids.length });
      } else {
        const [ins] = await pool.query(
          `INSERT INTO catalogos
            (nome, subtitulo, cod_fornecedor, cor_fundo, ordem, ativo, excluido, id_usuario)
           VALUES (?, ?, ?, '#0c4a8a', ?, 'S', 'N', ?)`,
          [nomeCat.slice(0, 200), `${ids.length} produto(s)`, codForn, ordemCat, userId]
        );
        idCat = ins.insertId;
        criados.push({ id: idCat, nome: nomeCat, qtd: ids.length });
      }

      await gravarItens(
        pool,
        idCat,
        ids.map((cod, i) => ({ cod_produto: cod, ordem: i + 1 }))
      );
    }

    res.json({
      ok: true,
      grupos: porGrupo.size,
      criados,
      atualizados,
      mensagem: `${porGrupo.size} linha(s) montada(s). Importe as fotos (nome = código fabricante) e abra Apresentar.`,
    });
  } catch (err) {
    console.error('[catalogos gerar-por-grupos]', err.message);
    res.status(500).json({ error: err.message });
  }
});

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
    cat.stats = statsItens(itens);
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
