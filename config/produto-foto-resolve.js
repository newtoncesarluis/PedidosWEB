'use strict';

const path = require('path');
const fs = require('fs');
const { getProdTabela } = require('./produto-colunas');

const UPLOADS_PRODUTOS = path.join(process.cwd(), 'public', 'uploads', 'produtos');

const _prodImgTbMap = new Map();
const _prodColsMap = new Map();

function fotoExisteNoDisco(url) {
  const u = String(url || '').trim();
  if (!u) return false;
  if (!u.startsWith('/uploads/produtos/')) return true;
  const rel = u.replace(/^\/uploads\/produtos\//, '');
  const i = rel.indexOf('/');
  if (i <= 0) return false;
  const cod = rel.slice(0, i);
  const file = rel.slice(i + 1);
  return fs.existsSync(path.join(UPLOADS_PRODUTOS, cod, file));
}

async function detectProdImagensTb(pool) {
  if (_prodImgTbMap.has(pool)) return _prodImgTbMap.get(pool);
  const [rows] = await pool.query(`SHOW TABLES LIKE 'produto_imagens'`).catch(() => [[]]);
  const has = rows.length > 0;
  _prodImgTbMap.set(pool, has);
  return has;
}

async function detectProdCols(pool, prodTb) {
  const key = `${pool}:${prodTb}`;
  if (_prodColsMap.has(key)) return _prodColsMap.get(key);
  const [cols] = await pool.query(`DESCRIBE \`${prodTb}\``).catch(() => [[]]);
  const set = new Set(cols.map(c => String(c.Field).toLowerCase()));
  const idCol = set.has('id') && !set.has('ID') ? 'id' : 'ID';
  const info = { foto: set.has('foto_principal'), idRef: set.has('id_referencia'), idCol };
  _prodColsMap.set(key, info);
  return info;
}

/** Foto: própria → galeria → referência mãe (foto ou galeria). */
function buildProdutoFotoSql(prodTb, prodCols, hasImgTb, opts = {}) {
  const alias = opts.alias || 'p';
  const idCol = opts.idCol || prodCols.idCol || 'ID';
  const idExpr = idCol === 'ID' ? `${alias}.ID` : `${alias}.\`${idCol}\``;
  const maeWhere = opts.maeWhere || `mae.excluido = 'N'`;
  const { foto, idRef } = prodCols;
  const parts = [];
  if (foto) parts.push(`NULLIF(TRIM(${alias}.foto_principal), '')`);
  if (hasImgTb) {
    parts.push(`(
      SELECT CONCAT('/uploads/produtos/', pi.cod_produto, '/', pi.filename)
      FROM produto_imagens pi
      WHERE pi.cod_produto = ${idExpr}
      ORDER BY (pi.is_principal = 1 OR pi.is_principal = 'S') DESC, pi.ordem, pi.id
      LIMIT 1
    )`);
  }
  if (idRef && foto) {
    parts.push(`(
      SELECT NULLIF(TRIM(mae.foto_principal), '')
      FROM \`${prodTb}\` mae
      WHERE mae.\`${idCol}\` = ${alias}.id_referencia AND ${maeWhere}
      LIMIT 1
    )`);
  }
  if (idRef && hasImgTb) {
    parts.push(`(
      SELECT CONCAT('/uploads/produtos/', pi.cod_produto, '/', pi.filename)
      FROM produto_imagens pi
      WHERE pi.cod_produto = ${alias}.id_referencia
      ORDER BY (pi.is_principal = 1 OR pi.is_principal = 'S') DESC, pi.ordem, pi.id
      LIMIT 1
    )`);
  }
  if (!parts.length) return `'' AS foto_principal`;
  return `COALESCE(${parts.join(', ')}) AS foto_principal`;
}

function buildProdutoQtdFotosSql(prodCols, hasImgTb) {
  if (!hasImgTb) return `, 0 AS qtd_fotos`;
  if (prodCols.idRef) return `, COALESCE(NULLIF(im.qtd, 0), im_mae.qtd, 0) AS qtd_fotos`;
  return `, COALESCE(im.qtd, 0) AS qtd_fotos`;
}

function buildProdutoImgJoins(prodCols, hasImgTb, opts = {}) {
  if (!hasImgTb) return '';
  const alias = opts.alias || 'p';
  const idCol = opts.idCol || prodCols.idCol || 'ID';
  const idExpr = idCol === 'ID' ? `${alias}.ID` : `${alias}.\`${idCol}\``;
  let sql = `
    LEFT JOIN (
      SELECT cod_produto, COUNT(*) AS qtd FROM produto_imagens GROUP BY cod_produto
    ) im ON im.cod_produto = ${idExpr}`;
  if (prodCols.idRef) {
    sql += `
    LEFT JOIN (
      SELECT cod_produto, COUNT(*) AS qtd FROM produto_imagens GROUP BY cod_produto
    ) im_mae ON im_mae.cod_produto = ${alias}.id_referencia`;
  }
  return sql;
}

async function resolveProdImagens(pool, prodId, opts = {}) {
  const prodTb = opts.prodTb || await getProdTabela(pool);
  const prodCols = opts.prodCols || await detectProdCols(pool, prodTb);
  const hasImgTb = opts.hasImgTb != null ? opts.hasImgTb : await detectProdImagensTb(pool);
  const idCol = opts.idCol || prodCols.idCol || 'ID';
  const excluidoSql = opts.excluidoSql || "excluido = 'N'";

  let idRef = null;
  if (prodCols.idRef) {
    const [[row]] = await pool.query(
      `SELECT id_referencia FROM \`${prodTb}\` WHERE \`${idCol}\` = ? AND ${excluidoSql} LIMIT 1`,
      [prodId]
    ).catch(() => [[null]]);
    const n = parseInt(row?.id_referencia, 10);
    if (n > 0) idRef = n;
  }

  async function imgsFromGaleria(cod, origem = 'galeria') {
    if (!hasImgTb) return [];
    const [rows] = await pool.query(
      `SELECT id, filename, is_principal FROM produto_imagens
       WHERE cod_produto = ? ORDER BY is_principal DESC, ordem, id`,
      [String(cod)]
    ).catch(() => [[]]);
    return rows
      .filter(r => r.filename && fs.existsSync(path.join(UPLOADS_PRODUTOS, String(cod), r.filename)))
      .map(r => ({
        id: r.id,
        url: `/uploads/produtos/${cod}/${r.filename}`,
        is_principal: r.is_principal,
        origem,
        heredada: origem === 'referencia',
        cod_produto: Number(cod),
      }));
  }

  async function fotoCampo(cod) {
    if (!prodCols.foto) return null;
    const [[p]] = await pool.query(
      `SELECT foto_principal FROM \`${prodTb}\` WHERE \`${idCol}\` = ? AND ${excluidoSql} LIMIT 1`,
      [cod]
    ).catch(() => [[null]]);
    const url = String(p?.foto_principal || '').trim();
    if (!url || !fotoExisteNoDisco(url)) return null;
    return url;
  }

  let imgs = await imgsFromGaleria(prodId, 'galeria');
  if (!imgs.length) {
    const url = await fotoCampo(prodId);
    if (url) imgs = [{ id: null, url, is_principal: 1, origem: 'foto_principal', heredada: false, cod_produto: Number(prodId) }];
  }
  if (!imgs.length && idRef) {
    imgs = await imgsFromGaleria(idRef, 'referencia');
    if (!imgs.length) {
      const url = await fotoCampo(idRef);
      if (url) imgs = [{ id: null, url, is_principal: 1, origem: 'referencia', heredada: true, cod_produto: Number(idRef) }];
    }
  }
  return imgs;
}

/** Corrige foto_principal quebrada ou vazia (ex.: filho sem foto, pai com foto). */
async function corrigirFotoItens(pool, itens, opts = {}) {
  const idField = opts.idField || 'id';
  const fotoField = opts.fotoField || 'foto_principal';
  for (const item of itens) {
    const id = item[idField];
    if (!id) continue;
    const atual = item[fotoField];
    if (atual && fotoExisteNoDisco(atual)) continue;
    const imgs = await resolveProdImagens(pool, id, opts.resolveOpts);
    item[fotoField] = imgs[0]?.url || null;
  }
  return itens;
}

module.exports = {
  UPLOADS_PRODUTOS,
  fotoExisteNoDisco,
  detectProdImagensTb,
  detectProdCols,
  buildProdutoFotoSql,
  buildProdutoQtdFotosSql,
  buildProdutoImgJoins,
  resolveProdImagens,
  corrigirFotoItens,
};
