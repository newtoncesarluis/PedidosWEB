'use strict';

const QUEUE = require('./changelog-queue');

async function ensureChangelogTable(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS sistema_changelog (
    id INT AUTO_INCREMENT PRIMARY KEY,
    versao VARCHAR(20) NOT NULL,
    tipo ENUM('MELHORIA','BUG','NOVO') NOT NULL DEFAULT 'MELHORIA',
    titulo VARCHAR(200) NOT NULL,
    descricao TEXT NULL,
    data_lancamento DATE NOT NULL,
    ativo CHAR(1) NOT NULL DEFAULT 'S',
    dtcadastro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_chg_versao (versao),
    INDEX idx_chg_data (data_lancamento)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).catch(() => {});
}

async function syncChangelogQueue(pool) {
  if (!pool || !QUEUE.length) return;
  await ensureChangelogTable(pool);
  for (const entry of QUEUE) {
    const versao = String(entry.versao || '').trim();
    const titulo = String(entry.titulo || '').trim();
    if (!versao || !titulo || !entry.data_lancamento) continue;
    const tipo = ['MELHORIA', 'BUG', 'NOVO'].includes(entry.tipo) ? entry.tipo : 'MELHORIA';
    const [exists] = await pool.query(
      'SELECT id FROM sistema_changelog WHERE versao = ? AND titulo = ? LIMIT 1',
      [versao, titulo]
    );
    if (exists.length) continue;
    await pool.query(
      `INSERT INTO sistema_changelog (versao, tipo, titulo, descricao, data_lancamento, ativo)
       VALUES (?, ?, ?, ?, ?, 'S')`,
      [versao, tipo, titulo, entry.descricao?.trim() || null, entry.data_lancamento]
    );
    console.log('[Changelog] Entrada sincronizada:', versao, '—', titulo);
  }
}

module.exports = { syncChangelogQueue };
