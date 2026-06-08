'use strict';

/** Data de hoje em America/Sao_Paulo → YYYY-MM-DD (sem deslocamento de fuso). */
function hojeIsoBrasil() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

/** Hora atual em America/Sao_Paulo → HH:MM:SS */
function horaBrasil() {
  return new Date().toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour12: false,
  });
}

/** Soma dias à data de hoje (Brasil) e retorna YYYY-MM-DD. */
function addDaysIsoBrasil(days) {
  const n = parseInt(days, 10) || 0;
  const base = hojeIsoBrasil();
  const p = base.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!p) return base;
  const dt = new Date(parseInt(p[1], 10), parseInt(p[2], 10) - 1, parseInt(p[3], 10));
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/** YYYY-MM-DD (ou ISO) → DD/MM/YYYY sem usar new Date('YYYY-MM-DD'). */
function isoToDisplayBr(v) {
  if (v == null || v === '') return '';
  const s = String(v).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return s;
  return s;
}

module.exports = {
  hojeIsoBrasil,
  horaBrasil,
  addDaysIsoBrasil,
  isoToDisplayBr,
};
