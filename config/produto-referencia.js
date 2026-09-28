'use strict';

/**
 * Referência mãe + cores (opt-in).
 * - Cada produto continua sendo 1 SKU pedível.
 * - id_referencia NULL = avulso ou mãe (sem vínculo).
 * - id_referencia = ID de outro produto = este é cor/variação da mãe.
 * - Se a mãe tem Cor preenchida e está disponível p/ venda, ela entra como
 *   1ª opção em cores[] no Showroom/pedido (além dos filhos).
 */

const { ensureProdutoColunas, getProdTabela } = require('./produto-colunas');

const COL_REF = { column: 'id_referencia', type: 'INT NULL DEFAULT NULL' };
const COL_AGRUPA = { column: 'agrupa_cores', type: "ENUM('S','N') NOT NULL DEFAULT 'N'" };

async function ensureProdutoReferenciaCol(pool) {
  await ensureProdutoColunas(pool, [COL_REF, COL_AGRUPA]);
}

const SQL_ATIVO = `(excluido='N' OR excluido IS NULL OR excluido='')`;

/**
 * @param {import('mysql2/promise').Pool} pool
 * @param {{ idProduto?: number|null, idReferencia?: number|null }} opts
 */
async function validarVinculoReferencia(pool, { idProduto = null, idReferencia = null } = {}) {
  await ensureProdutoReferenciaCol(pool);
  const idRef = parseInt(idReferencia, 10);
  if (!(idRef > 0)) return { ok: true, id_referencia: null };

  const idProd = parseInt(idProduto, 10) || null;
  if (idProd && idProd === idRef) {
    return { ok: false, error: 'Produto não pode ser referência mãe de si mesmo' };
  }

  const tb = await getProdTabela(pool);
  const [[mae]] = await pool.query(
    `SELECT ID AS id, id_referencia, cod_fornecedorpadrao, descricao, cod_fabricante
     FROM ${tb} WHERE ID=? AND ${SQL_ATIVO} LIMIT 1`,
    [idRef]
  );
  if (!mae) return { ok: false, error: 'Referência mãe não encontrada' };

  if (mae.id_referencia) {
    return {
      ok: false,
      error: 'A referência escolhida já é cor de outra referência. Escolha a referência principal (mãe).',
    };
  }

  if (idProd) {
    const [filhos] = await pool.query(
      `SELECT ID AS id FROM ${tb}
       WHERE id_referencia=? AND ID<>? AND ${SQL_ATIVO} LIMIT 1`,
      [idProd, idProd]
    );
    if (filhos.length) {
      return {
        ok: false,
        error: 'Este produto já é referência mãe de outras cores. Desvincule as cores antes de torná-lo filho.',
      };
    }
  }

  return { ok: true, id_referencia: idRef, mae };
}

/**
 * Lista produtos que podem ser mãe (id_referencia IS NULL).
 */
async function listarReferenciasMae(pool, { q = '', fornecedor = null, limit = 40, excludeId = null } = {}) {
  await ensureProdutoReferenciaCol(pool);
  const tb = await getProdTabela(pool);
  const lim = Math.min(Math.max(parseInt(limit, 10) || 40, 1), 100);
  const where = [
    `(p.excluido='N' OR p.excluido IS NULL OR p.excluido='')`,
    `(p.id_referencia IS NULL OR p.id_referencia=0)`,
  ];
  const params = [];

  const forn = parseInt(fornecedor, 10);
  if (forn > 0) {
    where.push('p.cod_fornecedorpadrao = ?');
    params.push(forn);
  }
  const qq = String(q || '').trim();
  if (qq) {
    where.push('(p.descricao LIKE ? OR p.cod_fabricante LIKE ? OR p.apelido LIKE ? OR CAST(p.ID AS CHAR) LIKE ?)');
    const like = `%${qq}%`;
    params.push(like, like, like, like);
  }
  const excl = parseInt(excludeId, 10);
  if (excl > 0) {
    where.push('p.ID <> ?');
    params.push(excl);
  }

  const [rows] = await pool.query(
    `SELECT p.ID AS id, p.descricao, p.cod_fabricante, p.cor1, p.cor2, p.foto_principal,
            p.cod_fornecedorpadrao,
            (SELECT COUNT(*) FROM ${tb} c
             WHERE c.id_referencia = p.ID
               AND (c.excluido='N' OR c.excluido IS NULL OR c.excluido=''))
            + CASE
                WHEN TRIM(IFNULL(p.cor1,'')) <> ''
                 AND IFNULL(p.disponivel,'S') <> 'N'
                THEN 1 ELSE 0
              END AS qtd_cores
     FROM ${tb} p
     WHERE ${where.join(' AND ')}
     ORDER BY p.descricao
     LIMIT ?`,
    [...params, lim]
  );
  return rows;
}

/** Campos úteis para Showroom / pedido ao trocar de cor. */
const SELECT_SKU = `ID AS id, descricao, cod_fabricante, cor1, cor2, foto_principal,
            id_referencia, IFNULL(agrupa_cores, 'N') AS agrupa_cores,
            cod_fornecedorpadrao, situacao, unidade,
            COALESCE(vlr_venda, 0) AS vlr_venda,
            IFNULL(tipograde, 0) AS tipograde,
            tipoprodutograde,
            IFNULL(multiplo_venda, 1) AS multiplo_venda,
            IFNULL(qtd_minima_pedido, 0) AS qtd_minima_pedido,
            IFNULL(precopeso, 'N') AS precopeso,
            IFNULL(kilo_embalagem, 0) AS kilo_embalagem,
            IFNULL(disponivel, 'S') AS disponivel`;

/**
 * Mãe entra como 1ª cor no Showroom/pedido quando tem Cor preenchida
 * e está disponível para venda (cenário: Pink no pai + 5 filhos = 6 opções).
 */
function maeVendeComoCor(mae) {
  if (!mae) return false;
  const cor = String(mae.cor1 || '').trim();
  if (!cor) return false;
  const disp = String(mae.disponivel != null ? mae.disponivel : 'S').toUpperCase();
  if (disp === 'N') return false;
  const sit = String(mae.situacao != null ? mae.situacao : 'A').toUpperCase();
  if (sit && sit !== 'A' && sit !== '') return false;
  return true;
}

/**
 * Coloca a mãe no início da lista de cores (sem duplicar se já estiver).
 */
function montarCoresComMaePrimeira(mae, cores) {
  const list = Array.isArray(cores) ? cores.slice() : [];
  if (!maeVendeComoCor(mae)) return list;
  const idMae = parseInt(mae.id, 10) || 0;
  if (!(idMae > 0)) return list;
  const semDup = list.filter((c) => parseInt(c.id || c.ID || c.cod_produto, 10) !== idMae);
  const maeSku = {
    ...mae,
    id: idMae,
    id_referencia: null,
    eh_mae_como_cor: true,
  };
  return [maeSku, ...semDup];
}

/**
 * Grupo completo: mãe + cores (incluindo o produto consultado).
 * Inclui preço/grade do cadastro (Showroom pode sobrescrever com tabela).
 * Se a mãe tem cor e está disponível p/ venda, ela entra como 1ª opção em cores[].
 */
async function obterGrupoReferencia(pool, idProduto) {
  await ensureProdutoReferenciaCol(pool);
  const tb = await getProdTabela(pool);
  const id = parseInt(idProduto, 10);
  if (!(id > 0)) return null;

  let eu;
  try {
    [[eu]] = await pool.query(
      `SELECT ${SELECT_SKU} FROM ${tb} WHERE ID=? AND ${SQL_ATIVO} LIMIT 1`,
      [id]
    );
  } catch (_) {
    // Bases sem alguma coluna opcional — fallback mínimo
    [[eu]] = await pool.query(
      `SELECT ID AS id, descricao, cod_fabricante, cor1, cor2, foto_principal,
              id_referencia, cod_fornecedorpadrao, situacao
       FROM ${tb} WHERE ID=? AND ${SQL_ATIVO} LIMIT 1`,
      [id]
    );
  }
  if (!eu) return null;

  const idMae = eu.id_referencia ? Number(eu.id_referencia) : id;
  let mae;
  try {
    [[mae]] = await pool.query(
      `SELECT ${SELECT_SKU} FROM ${tb} WHERE ID=? AND ${SQL_ATIVO} LIMIT 1`,
      [idMae]
    );
  } catch (_) {
    [[mae]] = await pool.query(
      `SELECT ID AS id, descricao, cod_fabricante, cor1, cor2, foto_principal,
              id_referencia, cod_fornecedorpadrao, situacao
       FROM ${tb} WHERE ID=? AND ${SQL_ATIVO} LIMIT 1`,
      [idMae]
    );
  }
  if (!mae) return { papel: 'avulso', mae: null, cores: [], eu };

  let cores;
  try {
    [cores] = await pool.query(
      `SELECT ${SELECT_SKU} FROM ${tb}
       WHERE id_referencia=? AND ${SQL_ATIVO}
       ORDER BY COALESCE(cor1,''), descricao`,
      [mae.id]
    );
  } catch (_) {
    [cores] = await pool.query(
      `SELECT ID AS id, descricao, cod_fabricante, cor1, cor2, foto_principal,
              id_referencia, situacao
       FROM ${tb}
       WHERE id_referencia=? AND ${SQL_ATIVO}
       ORDER BY COALESCE(cor1,''), descricao`,
      [mae.id]
    );
  }

  const papel = eu.id_referencia
    ? 'cor'
    : (cores.length || String(eu.agrupa_cores || '').toUpperCase() === 'S' || maeVendeComoCor(mae) ? 'mae' : 'avulso');

  const coresComMae = montarCoresComMaePrimeira(mae, cores);

  return { papel, mae, cores: coresComMae, eu };
}

/**
 * Cláusula SQL: só referência mãe ou produto avulso (esconde cores filhas).
 * Use só com coluna id_referencia existente.
 */
function sqlSomenteMaeOuAvulso(alias = 'p') {
  const a = alias ? `${alias}.` : '';
  return `(${a}id_referencia IS NULL OR ${a}id_referencia = 0)`;
}

/**
 * Colapsa lista (coleção) em 1 card por grupo: prefere a mãe se estiver na lista.
 * qtd_cores = filhos na lista + 1 se a mãe vende como cor (cor1 + disponível).
 */
function colapsarItensPorReferencia(itens) {
  const map = new Map();
  const order = [];
  for (const raw of itens || []) {
    const it = { ...raw };
    const cod = parseInt(it.cod_produto || it.id || it.ID, 10) || 0;
    const idRef = parseInt(it.id_referencia, 10) || 0;
    const key = idRef > 0 ? idRef : cod;
    if (!key) continue;
    const isFilho = idRef > 0;
    const existing = map.get(key);
    if (!existing) {
      it.qtd_cores = isFilho ? 1 : (maeVendeComoCor(it) ? 1 : 0);
      map.set(key, it);
      order.push(key);
    } else if (isFilho) {
      existing.qtd_cores = (existing.qtd_cores || 0) + 1;
    } else {
      // Prefere o produto mãe como card; conta mãe só se vende como cor
      it.qtd_cores = (existing.qtd_cores || 0) + (maeVendeComoCor(it) ? 1 : 0);
      map.set(key, it);
    }
  }
  return order.map((k) => map.get(k));
}

function parseIdReferenciaBody(body) {
  if (!body || !Object.prototype.hasOwnProperty.call(body, 'id_referencia')) {
    return { presente: false, id_referencia: undefined };
  }
  const raw = body.id_referencia;
  if (raw === null || raw === '' || raw === undefined) {
    return { presente: true, id_referencia: null };
  }
  const n = parseInt(raw, 10);
  return { presente: true, id_referencia: n > 0 ? n : null };
}

/**
 * Importação: resolve "Referência mãe" (ID numérico ou cod_fabricante) → id_referencia.
 * Vazio = desvincula. Mãe deve existir e não ser cor de outra.
 */
async function resolverReferenciaMaeImport(pool, { valor, idFornecedor = null, idProduto = null } = {}) {
  await ensureProdutoReferenciaCol(pool);
  const raw = String(valor ?? '').trim();
  if (!raw) {
    return { ok: true, presente: true, id_referencia: null };
  }

  const tb = await getProdTabela(pool);
  let idMae = null;

  if (/^\d+$/.test(raw)) {
    idMae = parseInt(raw, 10);
  } else {
    const forn = parseInt(idFornecedor, 10);
    let sql = `SELECT ID AS id FROM ${tb}
      WHERE UPPER(TRIM(cod_fabricante)) = UPPER(?)
        AND ${SQL_ATIVO}
        AND (id_referencia IS NULL OR id_referencia = 0)`;
    const params = [raw];
    if (forn > 0) {
      sql += ' AND CAST(cod_fornecedorpadrao AS UNSIGNED) = ?';
      params.push(forn);
    }
    sql += ' ORDER BY ID ASC LIMIT 2';
    const [rows] = await pool.query(sql, params);
    if (!rows.length) {
      return {
        ok: false,
        error: `Referência mãe «${raw}» não encontrada. Importe/cadastre a mãe antes (ou use o ID numérico).`,
      };
    }
    if (rows.length > 1 && !(forn > 0)) {
      return {
        ok: false,
        error: `Referência mãe «${raw}» ambígua (várias fábricas). Informe o Fornecedor Padrão na linha.`,
      };
    }
    idMae = rows[0].id;
  }

  return validarVinculoReferencia(pool, { idProduto, idReferencia: idMae });
}

module.exports = {
  COL_REF,
  ensureProdutoReferenciaCol,
  validarVinculoReferencia,
  listarReferenciasMae,
  obterGrupoReferencia,
  maeVendeComoCor,
  montarCoresComMaePrimeira,
  parseIdReferenciaBody,
  sqlSomenteMaeOuAvulso,
  colapsarItensPorReferencia,
  resolverReferenciaMaeImport,
};
