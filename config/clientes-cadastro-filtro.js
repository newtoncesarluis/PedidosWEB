'use strict';

const { hojeIsoBrasil } = require('./date-brasil');

function inicioSemanaIsoBrasil() {
  const hoje = hojeIsoBrasil();
  const m = hoje.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return hoje;
  const dt = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  const dow = dt.getDay();
  const back = dow === 0 ? 6 : dow - 1;
  dt.setDate(dt.getDate() - back);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function inicioMesIsoBrasil() {
  return hojeIsoBrasil().slice(0, 8) + '01';
}

function isoDateOrEmpty(v) {
  const s = String(v || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

/** Resolve cadastro_periodo + cadastro_de/ate → { de, ate } ISO (Brasil). */
function resolveCadastroFiltro(query) {
  const periodo = String(query.cadastro_periodo || '').trim().toLowerCase();
  let de = isoDateOrEmpty(query.cadastro_de);
  let ate = isoDateOrEmpty(query.cadastro_ate);
  const hoje = hojeIsoBrasil();

  if (periodo === 'hoje') {
    de = hoje;
    ate = hoje;
  } else if (periodo === 'semana') {
    de = inicioSemanaIsoBrasil();
    ate = hoje;
  } else if (periodo === 'mes') {
    de = inicioMesIsoBrasil();
    ate = hoje;
  } else if (periodo === 'ate' || periodo === 'intervalo') {
    // usa cadastro_de / cadastro_ate do query
  } else if (!periodo) {
    return { de: de || '', ate: ate || '' };
  }

  return { de, ate };
}

/** Expressão SQL da data de cadastro (dtcadastro com fallback dtalterado). */
function cadastroDateExpr(alias, colunasSet) {
  const p = alias ? `${alias}.` : '';
  const hasCad = colunasSet && colunasSet.has('dtcadastro');
  const hasAlt = colunasSet && colunasSet.has('dtalterado');
  if (hasCad && hasAlt) {
    return `COALESCE(DATE(${p}dtcadastro), DATE(${p}dtalterado))`;
  }
  if (hasCad) return `DATE(${p}dtcadastro)`;
  if (hasAlt) return `DATE(${p}dtalterado)`;
  return null;
}

function appendCadastroWhere(where, vals, cadastro, dateExpr) {
  if (!dateExpr) return;
  if (cadastro.de) {
    where.push(`(${dateExpr} IS NOT NULL AND ${dateExpr} >= ?)`);
    vals.push(cadastro.de);
  }
  if (cadastro.ate) {
    where.push(`(${dateExpr} IS NOT NULL AND ${dateExpr} <= ?)`);
    vals.push(cadastro.ate);
  }
}

module.exports = {
  resolveCadastroFiltro,
  cadastroDateExpr,
  appendCadastroWhere,
};
