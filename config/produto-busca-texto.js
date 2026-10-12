'use strict';

/**
 * Busca textual de produto no pedido (descrição, ref./SKU, EAN, segmento…).
 * @param {string} alias — alias SQL da tabela produto (p, pr…)
 * @param {string} q — termo digitado
 * @param {{ includeSegmento?: boolean, includeApelido?: boolean, includeId?: boolean }} [opts]
 */
function produtoBuscaOrSql(alias, q, opts = {}) {
  const a = alias || 'p';
  const qTrim = String(q || '').trim();
  if (!qTrim) return { fragment: '1=1', params: [], isBarcodeLike: false, qTrim: '' };

  // Estilo Google: cada palavra precisa aparecer em algum campo (qualquer ordem).
  const termos = qTrim.split(/\s+/).filter(Boolean).slice(0, 6);
  const isBarcodeLike = termos.length === 1 && /^\d{8,}$/.test(qTrim);

  const blocos = [];
  const params = [];
  termos.forEach((t) => {
    const lk = `%${t}%`;
    const parts = [
      `${a}.descricao LIKE ?`,
      `${a}.cod_fabricante LIKE ?`,
      `${a}.cod_barras LIKE ?`,
    ];
    const ps = [lk, lk, lk];
    if (opts.includeSegmento !== false) {
      parts.push(`${a}.segmento LIKE ?`);
      ps.push(lk);
    }
    if (opts.includeApelido) {
      parts.push(`${a}.apelido LIKE ?`);
      ps.push(lk);
    }
    if (opts.includeId && /^\d+$/.test(t)) {
      parts.push(`CAST(${a}.ID AS CHAR) LIKE ?`);
      ps.push(lk);
    }
    blocos.push(`(${parts.join(' OR ')})`);
    params.push(...ps);
  });

  if (isBarcodeLike) {
    return {
      fragment: `(${a}.cod_barras = ? OR ${a}.cod_fabricante = ? OR ${blocos[0]})`,
      params: [qTrim, qTrim, ...params],
      isBarcodeLike: true,
      qTrim,
    };
  }
  return { fragment: `(${blocos.join(' AND ')})`, params, isBarcodeLike: false, qTrim };
}

function andProdutoBuscaSql(alias, q, opts = {}) {
  const b = produtoBuscaOrSql(alias, q, opts);
  if (b.fragment === '1=1') return { sql: '', params: [], ...b };
  return { sql: ` AND ${b.fragment} `, params: b.params, ...b };
}

/** Filtro em memória (IndexedDB / offline-pack). */
function matchProdutoBuscaLocal(p, q) {
  const qTrim = String(q || '').trim();
  if (!qTrim) return true;
  const qt = qTrim.toLowerCase();
  const fields = [
    p.nome, p.descricao, p.desc_produto, p.desc_prod,
    p.referencia, p.cod_fabricante, p.cod_barras, p.segmento,
    p.id, p.cod_produto,
  ].map((v) => String(v ?? '').toLowerCase());

  if (/^\d{8,}$/.test(qTrim)) {
    return String(p.cod_barras) === qTrim
      || String(p.cod_fabricante) === qTrim
      || fields.some((h) => h.includes(qt));
  }
  const termos = qt.split(/\s+/).filter(Boolean);
  const todos = fields.join(' ');
  return termos.every((t) => todos.includes(t));
}

module.exports = { produtoBuscaOrSql, andProdutoBuscaSql, matchProdutoBuscaLocal };
