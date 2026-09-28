'use strict';

/**
 * Grades alternativas por produto (N:N).
 * - produto.tipograde continua sendo a grade padrão (compatível com tudo que já existe).
 * - produto_tipograde guarda extras (+ espelho do padrão).
 * - Produto sem linhas em produto_tipograde → lista só tipograde (comportamento atual).
 */

const { getProdTabela } = require('./produto-colunas');
const { ensureTipogradeColunas } = require('./tipograde-colunas');

const _ensured = new Set();

async function dbName(pool) {
  const [[r]] = await pool.query('SELECT DATABASE() AS db');
  return String(r?.db || 'default');
}

async function ensureProdutoTipogradeTable(pool) {
  const key = await dbName(pool);
  if (_ensured.has(key)) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS produto_tipograde (
      id INT NOT NULL AUTO_INCREMENT,
      cod_produto INT NOT NULL,
      id_grade INT NOT NULL,
      padrao ENUM('S','N') NOT NULL DEFAULT 'N',
      PRIMARY KEY (id),
      UNIQUE KEY uq_prod_grade (cod_produto, id_grade),
      KEY idx_ptg_prod (cod_produto),
      KEY idx_ptg_grade (id_grade)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  _ensured.add(key);
}

/** SELECT seguro de modo/múltiplo (cria colunas se faltarem; fallback sem elas). */
async function sqlTipogradeModoCols(pool) {
  try {
    await ensureTipogradeColunas(pool);
    return {
      modo: `COALESCE(tg.modo_grade, 'A') AS modo_grade`,
      mult: `COALESCE(tg.multiplo_grade, 0) AS multiplo_grade`,
      modoBare: `COALESCE(modo_grade, 'A') AS modo_grade`,
      multBare: `COALESCE(multiplo_grade, 0) AS multiplo_grade`,
    };
  } catch (_) {
    return {
      modo: `'A' AS modo_grade`,
      mult: `0 AS multiplo_grade`,
      modoBare: `'A' AS modo_grade`,
      multBare: `0 AS multiplo_grade`,
    };
  }
}

/**
 * Lista grades disponíveis do produto.
 * Sempre inclui produto.tipograde (se houver), mesmo sem linhas na tabela N:N.
 * @returns {Promise<Array<{id:number, nome:string, padrao:boolean, modo_grade:string, multiplo_grade:number}>>}
 */
async function listarGradesProduto(pool, idProduto) {
  await ensureProdutoTipogradeTable(pool);
  const id = parseInt(idProduto, 10);
  if (!(id > 0)) return [];

  const cols = await sqlTipogradeModoCols(pool);
  const tb = await getProdTabela(pool);
  let tipogradePadrao = 0;
  try {
    const [[row]] = await pool.query(
      `SELECT tipograde FROM \`${tb}\` WHERE ID = ? LIMIT 1`,
      [id]
    );
    tipogradePadrao = parseInt(row?.tipograde, 10) || 0;
  } catch (_) {
    return [];
  }

  let extras = [];
  try {
    const [rows] = await pool.query(
      `SELECT ptg.id_grade, ptg.padrao,
              tg.nome,
              ${cols.modo},
              ${cols.mult}
         FROM produto_tipograde ptg
         INNER JOIN tipograde tg ON tg.id = ptg.id_grade
          AND (tg.excluido='N' OR tg.excluido IS NULL OR tg.excluido='')
        WHERE ptg.cod_produto = ?
        ORDER BY ptg.padrao DESC, tg.nome`,
      [id]
    );
    extras = rows || [];
  } catch (err) {
    console.warn('[produto-grades] extras:', err.message);
    extras = [];
  }

  const map = new Map();
  const push = (idGrade, nome, padrao, modo, mult) => {
    const gid = parseInt(idGrade, 10) || 0;
    if (!(gid > 0)) return;
    const prev = map.get(gid);
    const isPad = !!padrao || gid === tipogradePadrao;
    if (!prev) {
      map.set(gid, {
        id: gid,
        nome: nome || ('Grade #' + gid),
        padrao: isPad,
        modo_grade: modo === 'F' ? 'F' : 'A',
        multiplo_grade: parseInt(mult, 10) || 0,
      });
    } else if (isPad) {
      prev.padrao = true;
    }
  };

  for (const r of extras) {
    push(r.id_grade, r.nome, String(r.padrao).toUpperCase() === 'S', r.modo_grade, r.multiplo_grade);
  }

  if (tipogradePadrao > 0 && !map.has(tipogradePadrao)) {
    try {
      const [[tg]] = await pool.query(
        `SELECT id, nome,
                ${cols.modoBare},
                ${cols.multBare}
           FROM tipograde
          WHERE id = ? AND (excluido='N' OR excluido IS NULL OR excluido='')
          LIMIT 1`,
        [tipogradePadrao]
      );
      if (tg) push(tg.id, tg.nome, true, tg.modo_grade, tg.multiplo_grade);
    } catch (_) {
      push(tipogradePadrao, 'Grade #' + tipogradePadrao, true, 'A', 0);
    }
  }

  // Cor (filho): extras costumam estar só na referência mãe.
  let idMae = 0;
  try {
    const [[ref]] = await pool.query(
      `SELECT id_referencia FROM \`${tb}\` WHERE ID = ? LIMIT 1`,
      [id]
    );
    idMae = parseInt(ref?.id_referencia, 10) || 0;
  } catch (_) {
    idMae = 0;
  }
  if (idMae > 0 && idMae !== id) {
    try {
      const [maeExtras] = await pool.query(
        `SELECT ptg.id_grade, ptg.padrao,
                tg.nome,
                ${cols.modo},
                ${cols.mult}
           FROM produto_tipograde ptg
           INNER JOIN tipograde tg ON tg.id = ptg.id_grade
            AND (tg.excluido='N' OR tg.excluido IS NULL OR tg.excluido='')
          WHERE ptg.cod_produto = ?`,
        [idMae]
      );
      for (const r of maeExtras || []) {
        push(r.id_grade, r.nome, false, r.modo_grade, r.multiplo_grade);
      }
      const [[mae]] = await pool.query(
        `SELECT tipograde FROM \`${tb}\` WHERE ID = ? LIMIT 1`,
        [idMae]
      );
      const maeTipog = parseInt(mae?.tipograde, 10) || 0;
      if (maeTipog > 0 && !map.has(maeTipog)) {
        const [[tg]] = await pool.query(
          `SELECT id, nome,
                  ${cols.modoBare},
                  ${cols.multBare}
             FROM tipograde
            WHERE id = ? AND (excluido='N' OR excluido IS NULL OR excluido='')
            LIMIT 1`,
          [maeTipog]
        );
        if (tg) push(tg.id, tg.nome, false, tg.modo_grade, tg.multiplo_grade);
      }
    } catch (_) { /* herança opcional — filho segue só com a grade dele */ }
  }

  // Garante um único padrao
  const list = [...map.values()];
  if (list.length) {
    const hasPad = list.some((g) => g.padrao);
    if (!hasPad) {
      const pref = list.find((g) => g.id === tipogradePadrao) || list[0];
      pref.padrao = true;
    } else if (tipogradePadrao > 0) {
      list.forEach((g) => { g.padrao = g.id === tipogradePadrao; });
      if (!list.some((g) => g.padrao)) list[0].padrao = true;
    }
  }

  list.sort((a, b) => (b.padrao - a.padrao) || String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
  return list;
}

/**
 * Sincroniza grades do produto.
 * - tipogradePadrao: grade principal (grava também em produto.tipograde se coluna existir — caller já grava)
 * - extrasIds: ids adicionais (não precisa incluir o padrão)
 * Se extrasIds for undefined, não altera produto_tipograde (só garante espelho do padrão se tipogradePadrao > 0).
 */
async function sincronizarGradesProduto(pool, idProduto, { tipogradePadrao = null, extrasIds = undefined } = {}) {
  await ensureProdutoTipogradeTable(pool);
  const id = parseInt(idProduto, 10);
  if (!(id > 0)) return { ok: false, error: 'Produto inválido' };

  const padrao = parseInt(tipogradePadrao, 10) || 0;

  // Sem array de extras: só espelha o padrão (não apaga extras existentes)
  if (extrasIds === undefined) {
    if (padrao > 0) {
      await pool.query(
        `INSERT INTO produto_tipograde (cod_produto, id_grade, padrao)
         VALUES (?, ?, 'S')
         ON DUPLICATE KEY UPDATE padrao='S'`,
        [id, padrao]
      );
      await pool.query(
        `UPDATE produto_tipograde SET padrao='N' WHERE cod_produto=? AND id_grade<>?`,
        [id, padrao]
      ).catch(() => {});
    }
    return { ok: true };
  }

  const extras = [...new Set(
    (Array.isArray(extrasIds) ? extrasIds : [])
      .map((x) => parseInt(x, 10) || 0)
      .filter((x) => x > 0 && x !== padrao)
  )];

  const keep = new Set(extras);
  if (padrao > 0) keep.add(padrao);

  // Remove o que não deve ficar
  if (keep.size) {
    await pool.query(
      `DELETE FROM produto_tipograde WHERE cod_produto=? AND id_grade NOT IN (${[...keep].map(() => '?').join(',')})`,
      [id, ...keep]
    );
  } else {
    await pool.query(`DELETE FROM produto_tipograde WHERE cod_produto=?`, [id]);
  }

  for (const gid of keep) {
    const isPad = gid === padrao ? 'S' : 'N';
    await pool.query(
      `INSERT INTO produto_tipograde (cod_produto, id_grade, padrao)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE padrao=VALUES(padrao)`,
      [id, gid, isPad]
    );
  }

  return { ok: true };
}

module.exports = {
  ensureProdutoTipogradeTable,
  listarGradesProduto,
  sincronizarGradesProduto,
};
