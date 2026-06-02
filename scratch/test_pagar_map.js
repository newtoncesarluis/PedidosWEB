require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

function normalizarDataCampo(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, '0');
    const d = String(v.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  if (!s || s.startsWith('0000-00-00')) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
}

function mapPagarRow(r) {
  return {
    ...r,
    vencimento: normalizarDataCampo(r.vencimento),
    data_pagto: normalizarDataCampo(r.data_pagto),
    data_lanc: normalizarDataCampo(r.data_lanc),
  };
}

function fmtDate(d) {
  if (d == null || d === '') return '-';
  const s = String(d).trim();
  if (!s || s.startsWith('0000-00-00')) return '-';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? '-' : dt.toLocaleDateString('pt-BR');
}

(async () => {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sysrep',
  });
  const [rows] = await pool.query("SELECT * FROM pagar WHERE excluido='N' LIMIT 5");
  rows.map(mapPagarRow).forEach((r) => {
    console.log('id', r.id, 'raw type', typeof rows.find(x => x.id === r.id).vencimento, 'mapped', r.vencimento, 'fmt', fmtDate(r.vencimento));
  });
  const json = JSON.stringify(rows.map(mapPagarRow));
  const parsed = JSON.parse(json);
  console.log('JSON sample vencimento:', parsed[0].vencimento, fmtDate(parsed[0].vencimento));
  const [nf] = await pool.query("SHOW COLUMNS FROM pagar LIKE '%nf%'");
  console.log('NF cols:', nf.map((c) => c.Field));
  await pool.end();
})();
