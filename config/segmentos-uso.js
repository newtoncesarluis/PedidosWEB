'use strict';

/** Uso do segmento: CLIENTE | FORNECEDOR | AMBOS (default legado). */

function normalizeSegmentoUso(v) {
  const u = String(v || 'AMBOS').toUpperCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (u === 'CLIENTE' || u === 'C') return 'CLIENTE';
  if (u === 'FORNECEDOR' || u === 'F' || u === 'FABRICA') return 'FORNECEDOR';
  return 'AMBOS';
}

/** Filtro SQL: retorna segmentos do escopo + AMBOS. Params a concatenar. */
function sqlFiltroUsoSegmento(usoQuery, alias = '') {
  const col = alias ? `${alias}.uso` : 'uso';
  const uso = normalizeSegmentoUso(usoQuery);
  if (!usoQuery || uso === 'AMBOS') {
    return { sql: '1=1', params: [] };
  }
  return {
    sql: `(UPPER(COALESCE(${col},'AMBOS')) = 'AMBOS' OR UPPER(COALESCE(${col},'AMBOS')) = ?)`,
    params: [uso],
  };
}

function labelSegmentoUso(uso) {
  const u = normalizeSegmentoUso(uso);
  if (u === 'CLIENTE') return 'Cliente';
  if (u === 'FORNECEDOR') return 'Fornecedor';
  return 'Ambos';
}

module.exports = {
  normalizeSegmentoUso,
  sqlFiltroUsoSegmento,
  labelSegmentoUso,
};
