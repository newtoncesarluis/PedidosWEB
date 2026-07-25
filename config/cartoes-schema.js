'use strict';

/**
 * Schema cartões corporativos + faturas + lançamentos (on-demand por tenant).
 */

const _ok = new Map();

async function dbKey(pool) {
  const [[r]] = await pool.query('SELECT DATABASE() AS db');
  return String(r?.db || 'default');
}

async function ensureCartoesSchema(pool) {
  const key = await dbKey(pool);
  if (_ok.has(key)) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cartoes_corporativos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      descricao VARCHAR(100) NOT NULL,
      bandeira VARCHAR(30) NULL,
      ultimos4 VARCHAR(4) NULL,
      dia_fechamento TINYINT NOT NULL DEFAULT 1,
      dia_vencimento TINYINT NOT NULL DEFAULT 10,
      id_banco INT NULL,
      id_despesas INT NULL,
      id_planoconta INT NULL,
      id_centrocusto INT NULL,
      status CHAR(1) NOT NULL DEFAULT 'A',
      excluido CHAR(1) NOT NULL DEFAULT 'N',
      dt_cadastro DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cartao_faturas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      id_cartao INT NOT NULL,
      competencia CHAR(7) NOT NULL,
      data_fechamento DATE NOT NULL,
      data_vencimento DATE NOT NULL,
      valor_total DECIMAL(15,2) NOT NULL DEFAULT 0,
      id_pagar INT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'ABERTA',
      excluido CHAR(1) NOT NULL DEFAULT 'N',
      UNIQUE KEY uk_cartao_comp (id_cartao, competencia),
      KEY idx_cf_cartao (id_cartao)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cartao_lancamentos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      id_fatura INT NOT NULL,
      data_compra DATE NOT NULL,
      descricao VARCHAR(200) NOT NULL,
      valor DECIMAL(15,2) NOT NULL,
      parcela TINYINT NOT NULL DEFAULT 1,
      qt_parcelas TINYINT NOT NULL DEFAULT 1,
      excluido CHAR(1) NOT NULL DEFAULT 'N',
      KEY idx_cl_fatura (id_fatura)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  _ok.set(key, true);
}

function resetCartoesSchemaCache(db) {
  if (db) _ok.delete(db);
  else _ok.clear();
}

/** Calcula datas de fechamento/vencimento da competência YYYY-MM. */
function datasFaturaCompetencia(competencia, diaFech, diaVenc) {
  const [y, m] = String(competencia).split('-').map(Number);
  const df = Math.min(Math.max(parseInt(diaFech, 10) || 1, 1), 28);
  const dv = Math.min(Math.max(parseInt(diaVenc, 10) || 10, 1), 28);
  const fech = `${y}-${String(m).padStart(2, '0')}-${String(df).padStart(2, '0')}`;
  let vy = y;
  let vm = m;
  if (dv <= df) {
    vm += 1;
    if (vm > 12) { vm = 1; vy += 1; }
  }
  const venc = `${vy}-${String(vm).padStart(2, '0')}-${String(dv).padStart(2, '0')}`;
  return { data_fechamento: fech, data_vencimento: venc };
}

module.exports = {
  ensureCartoesSchema,
  resetCartoesSchemaCache,
  datasFaturaCompetencia,
};
