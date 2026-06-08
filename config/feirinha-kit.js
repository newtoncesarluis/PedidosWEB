'use strict';

const { ensureFeirinhaTables } = require('./schema-migrations');

const _okByDb = new Map();

async function tabelaKitExiste(pool) {
  let dbKey = 'default';
  try {
    const [[r]] = await pool.query('SELECT DATABASE() AS db');
    dbKey = r?.db || dbKey;
  } catch { /* ignora */ }
  if (_okByDb.get(dbKey) === true) return true;
  const ok = await ensureFeirinhaTables(pool);
  _okByDb.set(dbKey, ok);
  return ok;
}

async function detectProdTable(pool) {
  const [t1] = await pool.query("SHOW TABLES LIKE 'produto'").catch(() => [[]]);
  return t1.length ? 'produto' : 'produtos';
}

const _prodColCache = new Map();

async function prodSelectExtras(pool, tb) {
  let dbKey = 'default';
  try {
    const [[r]] = await pool.query('SELECT DATABASE() AS db');
    dbKey = r?.db || dbKey;
  } catch { /* ignora */ }
  const cacheKey = `${dbKey}:${tb}`;
  if (_prodColCache.has(cacheKey)) return _prodColCache.get(cacheKey);
  const [cols] = await pool.query(`SHOW COLUMNS FROM ${tb}`).catch(() => [[]]);
  const set = new Set((cols || []).map((c) => c.Field));
  const out = {
    fotoExpr: set.has('foto_principal') ? 'p.foto_principal' : 'NULL AS foto_principal',
    multiploExpr: set.has('multiplo_venda') ? 'IFNULL(p.multiplo_venda, 1)' : '1',
  };
  _prodColCache.set(cacheKey, out);
  return out;
}

async function listarKitItens(pool, idCampanha, opts = {}) {
  if (!(await tabelaKitExiste(pool))) return [];
  const id = parseInt(idCampanha, 10);
  if (!id) return [];
  const tb = await detectProdTable(pool);
  const { fotoExpr, multiploExpr } = await prodSelectExtras(pool, tb);
  const [rows] = await pool.query(
    `SELECT ki.id, ki.id_campanha, ki.cod_produto, ki.quantidade, ki.ordem,
            p.descricao AS desc_produto, p.cod_fabricante, p.unidade,
            ${multiploExpr} AS multiplo_venda, ${fotoExpr}
     FROM campanhas_feirinha_itens ki
     INNER JOIN ${tb} p ON p.ID = ki.cod_produto
     WHERE ki.id_campanha = ? AND ki.excluido = 'N'
       AND (p.excluido = 'N' OR p.excluido IS NULL OR p.excluido = '')
     ORDER BY ki.ordem ASC, ki.id ASC`,
    [id]
  );
  return rows.map((r) => ({
    id: r.id,
    id_campanha: r.id_campanha,
    cod_produto: parseInt(r.cod_produto, 10),
    quantidade: parseFloat(r.quantidade) || 1,
    ordem: parseInt(r.ordem, 10) || 0,
    desc_produto: r.desc_produto,
    cod_fabricante: r.cod_fabricante,
    unidade: r.unidade,
    multiplo_venda: parseFloat(r.multiplo_venda) || 1,
    foto: r.foto_principal || null,
  }));
}

async function gravarKitItens(pool, idCampanha, itens) {
  if (!(await tabelaKitExiste(pool))) {
    return { status: 503, json: { error: 'Tabela kit Feirinha indisponível.' } };
  }
  const id = parseInt(idCampanha, 10);
  if (!id) return { status: 400, json: { error: 'Campanha inválida.' } };

  const lista = Array.isArray(itens) ? itens : [];
  await pool.query(
    `UPDATE campanhas_feirinha_itens SET excluido='S' WHERE id_campanha=? AND excluido='N'`,
    [id]
  );

  let ordem = 0;
  for (const raw of lista) {
    const codProd = parseInt(raw.cod_produto, 10);
    const qtd = parseFloat(raw.quantidade);
    if (!codProd || !Number.isFinite(qtd) || qtd <= 0) continue;
    await pool.query(
      `INSERT INTO campanhas_feirinha_itens (id_campanha, cod_produto, quantidade, ordem, excluido)
       VALUES (?, ?, ?, ?, 'N')`,
      [id, codProd, qtd, ordem++]
    );
  }
  return { status: 200, json: { ok: true, qtd: ordem } };
}

async function contarKitItens(pool, idCampanha) {
  if (!(await tabelaKitExiste(pool))) return 0;
  const [[r]] = await pool.query(
    `SELECT COUNT(*) AS n FROM campanhas_feirinha_itens
     WHERE id_campanha=? AND excluido='N'`,
    [parseInt(idCampanha, 10)]
  ).catch(() => [[{ n: 0 }]]);
  return Number(r?.n) || 0;
}

module.exports = {
  listarKitItens,
  gravarKitItens,
  contarKitItens,
  prodSelectExtras,
  detectProdTable,
};
