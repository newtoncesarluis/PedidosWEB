'use strict';

/**
 * Tabelas auxiliares do cadastro de produto:
 * - grupos (já existia no Delphi — garante estrutura mínima)
 * - local_armazenamento (lookup do produto; unifica com locais_armazenamento)
 * - subfamilia_produto, unidade_produto, tipo_produto_grade (antes hardcoded)
 */

const _ready = new Set();

async function dbKey(pool) {
  try {
    const [[r]] = await pool.query('SELECT DATABASE() AS db');
    return String(r?.db || 'default');
  } catch {
    return 'default';
  }
}

function normKey(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim()
    .replace(/\s+/g, ' ');
}

async function tableExists(pool, name) {
  const [rows] = await pool.query(`SHOW TABLES LIKE ?`, [name]).catch(() => [[]]);
  return rows.length > 0;
}

async function ensureGruposTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS grupos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      descricao VARCHAR(100) NOT NULL,
      ativo VARCHAR(3) DEFAULT 'SIM',
      excluido CHAR(1) DEFAULT 'N',
      INDEX idx_grupos_desc (descricao)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3
  `).catch(() => {});
}

async function ensureLocalArmazenamentoTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS local_armazenamento (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nome_local VARCHAR(100) NOT NULL,
      excluido CHAR(1) DEFAULT 'N',
      status CHAR(1) DEFAULT 'A',
      INDEX idx_local_arm_nome (nome_local)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3
  `).catch(() => {});

  // Migra registros da tela antiga (locais_armazenamento) se existir
  if (await tableExists(pool, 'locais_armazenamento')) {
    await pool.query(`
      INSERT INTO local_armazenamento (nome_local, excluido, status)
      SELECT UPPER(TRIM(l.descricao)), 'N', COALESCE(NULLIF(l.status,''),'A')
      FROM locais_armazenamento l
      WHERE COALESCE(l.excluido,'N')='N'
        AND TRIM(IFNULL(l.descricao,'')) <> ''
        AND NOT EXISTS (
          SELECT 1 FROM local_armazenamento a
          WHERE UPPER(TRIM(a.nome_local)) = UPPER(TRIM(l.descricao))
            AND COALESCE(a.excluido,'N')='N'
        )
    `).catch(() => {});
  }
}

async function ensureAuxTable(pool, table, seedRows) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`${table}\` (
      id INT AUTO_INCREMENT PRIMARY KEY,
      codigo VARCHAR(40) NOT NULL,
      descricao VARCHAR(100) NOT NULL,
      ordem INT NOT NULL DEFAULT 0,
      status CHAR(1) DEFAULT 'A',
      excluido CHAR(1) DEFAULT 'N',
      dt_cadastro DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unq_${table}_codigo (codigo),
      INDEX idx_${table}_desc (descricao)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3
  `).catch(() => {});

  for (const row of seedRows) {
    const [ex] = await pool.query(
      `SELECT id FROM \`${table}\` WHERE UPPER(TRIM(codigo))=? AND COALESCE(excluido,'N')='N' LIMIT 1`,
      [row.codigo]
    ).catch(() => [[]]);
    if (ex.length) continue;
    await pool.query(
      `INSERT INTO \`${table}\` (codigo, descricao, ordem, status, excluido) VALUES (?,?,?,'A','N')`,
      [row.codigo, row.descricao, row.ordem]
    ).catch(() => {});
  }
}

const SEED_SUBFAMILIA = [
  { codigo: 'MASCULINO', descricao: 'MASCULINO', ordem: 1 },
  { codigo: 'FEMININO', descricao: 'FEMININO', ordem: 2 },
  { codigo: 'INFANTIL', descricao: 'INFANTIL', ordem: 3 },
];

const SEED_UNIDADE = [
  { codigo: 'UN', descricao: 'UNIDADE', ordem: 1 },
  { codigo: 'CX', descricao: 'CAIXA', ordem: 2 },
  { codigo: 'KG', descricao: 'QUILOGRAMA', ordem: 3 },
  { codigo: 'LT', descricao: 'LITRO', ordem: 4 },
  { codigo: 'MT', descricao: 'METRO', ordem: 5 },
  { codigo: 'PC', descricao: 'PEÇA', ordem: 6 },
  { codigo: 'PCT', descricao: 'PACOTE', ordem: 7 },
  { codigo: 'RL', descricao: 'ROLO', ordem: 8 },
  { codigo: 'DZ', descricao: 'DÚZIA', ordem: 9 },
  { codigo: 'GL', descricao: 'GALÃO', ordem: 10 },
  { codigo: 'PR', descricao: 'PAR', ordem: 11 },
];

const SEED_TIPO_GRADE = [
  { codigo: 'ROUPA', descricao: 'ROUPA', ordem: 1 },
  { codigo: 'SAPATO', descricao: 'SAPATO', ordem: 2 },
];

const _upperDone = new Set();

/** Padroniza descrições/códigos já gravados em MAIÚSCULAS (seed antigo vinha Title Case). */
async function normalizeAuxUppercase(pool) {
  const key = await dbKey(pool);
  if (_upperDone.has(key)) return;
  const stmts = [
    `UPDATE subfamilia_produto SET descricao=UPPER(TRIM(descricao)), codigo=UPPER(TRIM(codigo))
     WHERE COALESCE(excluido,'N')='N'
       AND (descricao <> UPPER(TRIM(descricao)) OR codigo <> UPPER(TRIM(codigo)))`,
    `UPDATE unidade_produto SET descricao=UPPER(TRIM(descricao)), codigo=UPPER(TRIM(codigo))
     WHERE COALESCE(excluido,'N')='N'
       AND (descricao <> UPPER(TRIM(descricao)) OR codigo <> UPPER(TRIM(codigo)))`,
    `UPDATE tipo_produto_grade SET descricao=UPPER(TRIM(descricao)), codigo=UPPER(TRIM(codigo))
     WHERE COALESCE(excluido,'N')='N'
       AND (descricao <> UPPER(TRIM(descricao)) OR codigo <> UPPER(TRIM(codigo)))`,
    `UPDATE grupos SET descricao=UPPER(TRIM(descricao))
     WHERE COALESCE(excluido,'N')='N' AND descricao <> UPPER(TRIM(descricao))`,
    `UPDATE local_armazenamento SET nome_local=UPPER(TRIM(nome_local))
     WHERE COALESCE(excluido,'N')='N' AND nome_local <> UPPER(TRIM(nome_local))`,
  ];
  for (const sql of stmts) {
    await pool.query(sql).catch(() => {});
  }
  _upperDone.add(key);
}

async function ensureProdutoAuxiliares(pool) {
  if (!pool) return;
  const key = await dbKey(pool);
  if (!_ready.has(key)) {
    await ensureGruposTable(pool);
    await ensureLocalArmazenamentoTable(pool);
    await ensureAuxTable(pool, 'subfamilia_produto', SEED_SUBFAMILIA);
    await ensureAuxTable(pool, 'unidade_produto', SEED_UNIDADE);
    await ensureAuxTable(pool, 'tipo_produto_grade', SEED_TIPO_GRADE);

    // Valores já usados em produto que ainda não estão nas tabelas
    await seedFromProdutoDistinct(pool, 'subfamilia', 'subfamilia_produto');
    await seedFromProdutoDistinct(pool, 'unidade', 'unidade_produto');
    await seedFromProdutoDistinct(pool, 'tipoprodutograde', 'tipo_produto_grade');

    _ready.add(key);
  }
  await normalizeAuxUppercase(pool);
}

async function seedFromProdutoDistinct(pool, colProd, table) {
  try {
    const tb = (await tableExists(pool, 'produto')) ? 'produto' : 'produtos';
    const [rows] = await pool.query(`
      SELECT DISTINCT TRIM(${colProd}) AS v FROM \`${tb}\`
      WHERE TRIM(IFNULL(${colProd},'')) <> ''
        AND COALESCE(excluido,'N') IN ('N','')
    `);
    let ordem = 100;
    for (const r of rows) {
      const raw = String(r.v || '').trim();
      if (!raw) continue;
      const codigo = normKey(raw).replace(/\s+/g, '_').slice(0, 40);
      const [ex] = await pool.query(
        `SELECT id FROM \`${table}\`
         WHERE (UPPER(TRIM(codigo))=? OR UPPER(TRIM(descricao))=?)
           AND COALESCE(excluido,'N')='N' LIMIT 1`,
        [codigo, normKey(raw)]
      );
      if (ex.length) continue;
      await pool.query(
        `INSERT INTO \`${table}\` (codigo, descricao, ordem, status, excluido) VALUES (?,?,?,'A','N')`,
        [codigo, raw.toUpperCase(), ordem++]
      );
    }
  } catch (_) { /* bases sem coluna */ }
}

module.exports = {
  ensureProdutoAuxiliares,
  ensureGruposTable,
  ensureLocalArmazenamentoTable,
  normKey,
  SEED_SUBFAMILIA,
  SEED_UNIDADE,
  SEED_TIPO_GRADE,
};
