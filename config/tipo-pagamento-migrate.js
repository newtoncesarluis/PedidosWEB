/**
 * Tabela de apoio `tipo_pagamento` — alimenta:
 *  - combo «Tipo de Pagamento» do cadastro de Formas de Pagamento;
 *  - combo «Forma Pagto Padrão» do pedido (e forma de cada parcela).
 * Os valores gravados (`forma_pagto.tipo_pagto`, `pedidos.forma_pagto`, `receber.forma_pagto`)
 * continuam sendo o **codigo** (ex.: BOLETO, CARTAO) — por isso os registros antigos seguem válidos.
 */

const DEFAULTS = [
  { codigo: 'BOLETO',   descricao: 'Boleto Bancário',        ordem: 1 },
  { codigo: 'PIX',      descricao: 'PIX / Dinheiro',         ordem: 2 },
  { codigo: 'CARTAO',   descricao: 'Cartão Crédito/Débito',  ordem: 3 },
  { codigo: 'DEPOSITO', descricao: 'Depósito / TED',         ordem: 4 },
  { codigo: 'DINHEIRO', descricao: 'Dinheiro',               ordem: 5 },
  { codigo: 'CHEQUE',   descricao: 'Cheque',                 ordem: 6 },
  { codigo: 'CONVENIO', descricao: 'Convênio',               ordem: 7 },
];

const _seeded = new Set();

function codigoFromDescricao(desc) {
  return String(desc || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 50);
}

async function ensureTipoPagamentoTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tipo_pagamento (
      id INT AUTO_INCREMENT PRIMARY KEY,
      codigo VARCHAR(50) NOT NULL,
      descricao VARCHAR(100) NOT NULL,
      ordem INT NOT NULL DEFAULT 0,
      status CHAR(1) DEFAULT 'A',
      excluido CHAR(1) DEFAULT 'N',
      dt_cadastro DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unq_tipo_pagto_codigo (codigo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3
  `).catch(() => {});
}

async function _dbKey(pool) {
  try {
    const [[r]] = await pool.query('SELECT DATABASE() AS db');
    return r?.db || 'default';
  } catch { return 'default'; }
}

/** Insere os padrões e os códigos já usados em forma_pagto.tipo_pagto (idempotente, por base). */
async function seedTipoPagamento(pool) {
  const key = await _dbKey(pool);
  if (_seeded.has(key)) return;
  try {
    await ensureTipoPagamentoTable(pool);
    const existe = async (cod) => {
      const [ex] = await pool.query(
        `SELECT id FROM tipo_pagamento WHERE UPPER(TRIM(codigo))=? LIMIT 1`, [cod]
      );
      return ex.length > 0;
    };
    for (const d of DEFAULTS) {
      if (await existe(d.codigo)) continue;
      await pool.query(
        `INSERT INTO tipo_pagamento (codigo, descricao, ordem, status, excluido) VALUES (?,?,?,'A','N')`,
        [d.codigo, d.descricao, d.ordem]
      );
    }
    // Tipos já gravados nas formas de pagamento (ex.: cadastros antigos)
    try {
      const [used] = await pool.query(
        `SELECT DISTINCT TRIM(tipo_pagto) AS v FROM forma_pagto WHERE TRIM(COALESCE(tipo_pagto,'')) <> ''`
      );
      for (const row of used) {
        const raw = String(row.v || '').trim();
        const cod = codigoFromDescricao(raw);
        if (!cod || await existe(cod)) continue;
        await pool.query(
          `INSERT INTO tipo_pagamento (codigo, descricao, ordem, status, excluido) VALUES (?,?,0,'A','N')`,
          [cod, raw]
        );
      }
    } catch { /* forma_pagto/tipo_pagto ausente */ }
    _seeded.add(key);
  } catch (e) {
    console.warn('[tipo-pagamento] seed:', e.message);
  }
}

async function ensureTipoPagamentoReady(pool) {
  await ensureTipoPagamentoTable(pool);
  await seedTipoPagamento(pool);
}

module.exports = { DEFAULTS, codigoFromDescricao, ensureTipoPagamentoTable, seedTipoPagamento, ensureTipoPagamentoReady };
