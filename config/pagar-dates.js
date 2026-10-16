/** Expressões SQL para datas da tabela pagar (legado com 0000-00-00). */
const SQL_VENCIMENTO_VALIDO = `(p.vencimento IS NOT NULL AND CAST(p.vencimento AS CHAR) NOT LIKE '0000-00-00%')`;
const SQL_VENCIMENTO_ISO = `CASE WHEN ${SQL_VENCIMENTO_VALIDO} THEN DATE_FORMAT(p.vencimento, '%Y-%m-%d') ELSE NULL END`;
const SQL_VENCIMENTO_BR = `CASE WHEN ${SQL_VENCIMENTO_VALIDO} THEN DATE_FORMAT(p.vencimento, '%d/%m/%Y') ELSE NULL END`;

/**
 * Extrai YYYY-MM-DD sem usar new Date('YYYY-MM-DD') (evita deslocar ±1 dia por fuso).
 */
function extrairDataIso(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, '0');
    const d = String(v.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  if (!s || s.startsWith('0000-00-00') || s === 'Invalid Date') return null;
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

/** @deprecated use extrairDataIso */
function normalizarDataCampo(v) {
  return extrairDataIso(v);
}

function diasNoMes(ano, mes) {
  return new Date(ano, mes, 0).getDate();
}

/** Soma meses em YYYY-MM-DD sem deslocar fuso (evita 31 virar 30). */
function vencimentoComRecorrencia(isoBase, indiceMes) {
  const s = extrairDataIso(isoBase);
  if (!s || indiceMes <= 0) return s;
  const p = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!p) return s;
  let y = parseInt(p[1], 10);
  let mo = parseInt(p[2], 10) - 1 + indiceMes;
  y += Math.floor(mo / 12);
  mo = ((mo % 12) + 12) % 12;
  const d = Math.min(parseInt(p[3], 10), diasNoMes(y, mo + 1));
  return `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Vencimento da parcela `indice` (0 = primeira) a partir de uma data base.
 * unidade: DIAS | SEMANAS | MESES | ANOS; intervalo = nº de unidades entre parcelas.
 * Dias/semanas usam UTC puro (sem deslocar fuso); meses/anos reaproveitam a regra de fim de mês.
 */
function vencimentoParcela(isoBase, indice, intervalo = 1, unidade = 'MESES') {
  const s = extrairDataIso(isoBase);
  if (!s || indice <= 0) return s;
  const n = Math.max(1, parseInt(intervalo, 10) || 1) * indice;
  const un = String(unidade || 'MESES').toUpperCase();
  if (un === 'MESES') return vencimentoComRecorrencia(s, n);
  if (un === 'ANOS') return vencimentoComRecorrencia(s, n * 12);
  const dias = un === 'SEMANAS' ? n * 7 : n;
  const [y, m, d] = s.split('-').map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1, d + dias));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** Soma dias a YYYY-MM-DD (carência antes da 1ª parcela). */
function somarDiasIso(isoBase, dias) {
  return vencimentoParcela(isoBase, parseInt(dias, 10) > 0 ? 1 : 0, parseInt(dias, 10) || 0, 'DIAS');
}

/**
 * Nº do documento por parcela: "3681" -> "3681/1", "3681/2"... (só quando há mais de 1 parcela).
 * `max` = tamanho da coluna (pagar.numeronf = 25, receber.doc = 15); o texto digitado é cortado para caber.
 */
function numeroDocParcela(base, indice, total, max) {
  const b = String(base == null ? '' : base).trim();
  if (!b || !(total > 1)) return b || null;
  const suf = '/' + (indice + 1);
  return b.slice(0, Math.max(1, max - suf.length)) + suf;
}

function mapPagarRow(r) {
  if (!r || typeof r !== 'object') return r;
  const br = r.vencimento_br && String(r.vencimento_br).trim() ? String(r.vencimento_br).trim() : null;
  const iso =
    extrairDataIso(r.vencimento_iso) ||
    extrairDataIso(r.vencimento) ||
    (br ? extrairDataIso(br) : null);
  return {
    ...r,
    vencimento: iso,
    vencimento_br: br,
    data_pagto: extrairDataIso(r.data_pagto),
    data_lanc: extrairDataIso(r.data_lanc),
  };
}

module.exports = {
  SQL_VENCIMENTO_VALIDO,
  SQL_VENCIMENTO_ISO,
  SQL_VENCIMENTO_BR,
  extrairDataIso,
  normalizarDataCampo,
  vencimentoComRecorrencia,
  vencimentoParcela,
  somarDiasIso,
  numeroDocParcela,
  mapPagarRow,
};
