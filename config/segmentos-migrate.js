/**
 * Separa segmento de cliente (tabela segmentos) da categoria de produto (tabela categoria).
 * Migra registros já usados / existentes em categoria → segmentos, preservando IDs
 * para não quebrar clientes.cod_segmento.
 */

let _migratedDbs = new Set();

async function ensureSegmentosTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS segmentos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      descricao VARCHAR(100) NOT NULL,
      status CHAR(1) DEFAULT 'A',
      excluido CHAR(1) DEFAULT 'N',
      dt_cadastro DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_seg_desc (descricao)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3
  `).catch(() => {});
}

async function _fixAutoIncrement(pool) {
  try {
    const [[row]] = await pool.query(`SELECT COALESCE(MAX(id), 0) + 1 AS n FROM segmentos`);
    const n = Math.max(1, Number(row?.n) || 1);
    await pool.query(`ALTER TABLE segmentos AUTO_INCREMENT = ${n}`);
  } catch { /* ok */ }
}

async function _dbKey(pool) {
  try {
    const [[r]] = await pool.query('SELECT DATABASE() AS db');
    return r?.db || 'default';
  } catch {
    return 'default';
  }
}

/**
 * Copia de categoria → segmentos (idempotente).
 * 1) Snapshot de todas as categorias ativas (preserva id) — mesma lista que o combo usava.
 * 2) Textos só em clientes/fornecedores/transportadoras.
 * 3) Backfill cod_segmento + sincroniza texto segmento nos clientes.
 */
async function migrateSegmentosClienteFromCategoria(pool) {
  if (!pool) return { ok: false, reason: 'no-pool' };
  const dbKey = await _dbKey(pool);
  if (_migratedDbs.has(dbKey)) return { ok: true, skipped: 'already' };
  try {
    await ensureSegmentosTable(pool);

    const [catTables] = await pool.query(`SHOW TABLES LIKE 'categoria'`);
    if (!catTables.length) {
      _migratedDbs.add(dbKey);
      return { ok: true, skipped: 'sem-tabela-categoria' };
    }

    // 1) Copia categorias ativas preservando ID (não sobrescreve descrição já editada em segmentos)
    const [r1] = await pool.query(`
      INSERT IGNORE INTO segmentos (id, descricao, status, excluido)
      SELECT
        c.id,
        TRIM(c.descricao),
        CASE WHEN UPPER(TRIM(COALESCE(c.status, 'A'))) = 'A' THEN 'A' ELSE 'I' END,
        COALESCE(c.excluido, 'N')
      FROM categoria c
      WHERE COALESCE(c.excluido, 'N') = 'N'
        AND TRIM(COALESCE(c.descricao, '')) <> ''
    `);

    // 2) Descrições usadas em clientes/fornecedores/transportadoras que ainda não estão em segmentos
    const textSources = [];
    try {
      const [cli] = await pool.query(`
        SELECT DISTINCT TRIM(segmento) AS descricao
        FROM clientes
        WHERE COALESCE(excluido, 'N') = 'N'
          AND TRIM(COALESCE(segmento, '')) <> ''
      `);
      textSources.push(...cli);
    } catch { /* ok */ }
    try {
      const [forn] = await pool.query(`
        SELECT DISTINCT TRIM(segmento) AS descricao
        FROM fornecedores
        WHERE COALESCE(excluido, 'N') = 'N'
          AND TRIM(COALESCE(segmento, '')) <> ''
      `);
      textSources.push(...forn);
    } catch { /* ok */ }
    try {
      const [tr] = await pool.query(`
        SELECT DISTINCT TRIM(segmento) AS descricao
        FROM transportadoras
        WHERE COALESCE(excluido, 'N') = 'N'
          AND TRIM(COALESCE(segmento, '')) <> ''
      `);
      textSources.push(...tr);
    } catch { /* ok */ }

    let insertedText = 0;
    const seen = new Set();
    for (const row of textSources) {
      const desc = String(row.descricao || '').trim();
      if (!desc) continue;
      const key = desc.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const [exists] = await pool.query(
          `SELECT id FROM segmentos
           WHERE LOWER(TRIM(descricao)) = LOWER(?) AND COALESCE(excluido,'N')='N'
           LIMIT 1`,
          [desc]
        );
        if (exists.length) continue;
        const [ins] = await pool.query(
          `INSERT INTO segmentos (descricao, status, excluido) VALUES (?, 'A', 'N')`,
          [desc]
        );
        if (ins.affectedRows) insertedText += 1;
      } catch { /* ok */ }
    }

    // 3) Backfill cod_segmento a partir do texto
    try {
      await pool.query(`
        UPDATE clientes cl
        INNER JOIN segmentos s
          ON LOWER(TRIM(cl.segmento)) = LOWER(TRIM(s.descricao))
         AND COALESCE(s.excluido, 'N') = 'N'
        SET cl.cod_segmento = s.id
        WHERE COALESCE(cl.excluido, 'N') = 'N'
          AND TRIM(COALESCE(cl.segmento, '')) <> ''
          AND (
            cl.cod_segmento IS NULL
            OR TRIM(cl.cod_segmento) = ''
            OR CAST(cl.cod_segmento AS UNSIGNED) = 0
          )
      `);
    } catch { /* ok */ }

    // 4) Sincroniza texto segmento a partir do id (quando o id existe em segmentos)
    try {
      await pool.query(`
        UPDATE clientes cl
        INNER JOIN segmentos s ON CAST(cl.cod_segmento AS UNSIGNED) = s.id
          AND COALESCE(s.excluido, 'N') = 'N'
        SET cl.segmento = s.descricao
        WHERE COALESCE(cl.excluido, 'N') = 'N'
          AND TRIM(COALESCE(cl.cod_segmento, '')) <> ''
          AND CAST(cl.cod_segmento AS UNSIGNED) > 0
      `);
    } catch { /* ok */ }

    await _fixAutoIncrement(pool);

    const copied = Number(r1?.affectedRows || 0);
    if (copied || insertedText) {
      console.log(`[schema] segmentos (${dbKey}): migrados ${copied} de categoria + ${insertedText} por texto`);
    }
    _migratedDbs.add(dbKey);
    return { ok: true, fromCategoria: copied, fromTexto: insertedText };
  } catch (e) {
    console.warn('[schema] migrateSegmentosClienteFromCategoria:', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = {
  ensureSegmentosTable,
  migrateSegmentosClienteFromCategoria,
};
