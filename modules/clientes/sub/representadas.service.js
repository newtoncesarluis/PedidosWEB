'use strict';

const { getPool } = require('../../../config/database');

/**
 * Vínculo Cliente ↔ Representada (fábrica) + código do cliente na fábrica.
 * Tabela: cliente_representadas
 * Opcional: marca própria + logo por fábrica.
 */

async function ensureRepresentadasCols(pool) {
  const executor = pool || getPool();
  try {
    const { ensureTableColumns } = require('../../../config/schema-migrations');
    await ensureTableColumns(executor, 'cliente_representadas', [
      'marca_propria', 'nome_marca', 'logo_caminho',
    ]);
  } catch { /* ok */ }
}

async function buscarRepresentadas(idCliente, pool) {
  const executor = pool || getPool();
  await ensureRepresentadasCols(executor);
  try {
    const [rows] = await executor.query(
      `SELECT cr.id, cr.cod_cliente, cr.cod_fornecedor, cr.codigo_na_fabrica,
              cr.ativo, cr.obs, cr.excluido,
              COALESCE(cr.marca_propria, 'N') AS marca_propria,
              cr.nome_marca, cr.logo_caminho,
              COALESCE(NULLIF(TRIM(f.apelido), ''), f.nome) AS nome_fornecedor
       FROM cliente_representadas cr
       LEFT JOIN fornecedores f ON f.id = cr.cod_fornecedor
       WHERE cr.cod_cliente = ? AND COALESCE(cr.excluido, 'N') = 'N'
       ORDER BY nome_fornecedor, cr.id`,
      [idCliente]
    );
    return rows.map((r) => {
      let logo = String(r.logo_caminho || '').trim();
      if (logo && !logo.startsWith('/')) logo = '/' + logo;
      return { ...r, logo_caminho: logo || null };
    });
  } catch (e) {
    // Fallback sem colunas novas (base ainda sem migration)
    try {
      const [rows] = await executor.query(
        `SELECT cr.id, cr.cod_cliente, cr.cod_fornecedor, cr.codigo_na_fabrica,
                cr.ativo, cr.obs, cr.excluido,
                'N' AS marca_propria, NULL AS nome_marca, NULL AS logo_caminho,
                COALESCE(NULLIF(TRIM(f.apelido), ''), f.nome) AS nome_fornecedor
         FROM cliente_representadas cr
         LEFT JOIN fornecedores f ON f.id = cr.cod_fornecedor
         WHERE cr.cod_cliente = ? AND COALESCE(cr.excluido, 'N') = 'N'
         ORDER BY nome_fornecedor, cr.id`,
        [idCliente]
      );
      return rows;
    } catch {
      return [];
    }
  }
}

/**
 * Retorna true se o cliente tem a trava ligada (restringe pedido às fábricas vinculadas).
 * Default false — não altera o fluxo legado.
 */
async function clienteRestringeRepresentadas(idCliente, pool) {
  if (!idCliente) return false;
  const executor = pool || getPool();
  try {
    const [[row]] = await executor.query(
      `SELECT restringe_representadas FROM clientes WHERE id = ? LIMIT 1`,
      [idCliente]
    );
    return String(row?.restringe_representadas || 'N').toUpperCase() === 'S';
  } catch {
    return false;
  }
}

function _sn(v, def = 'N') {
  return String(v || def).toUpperCase() === 'S' ? 'S' : 'N';
}

async function salvarRepresentadas(idCliente, lista, conn) {
  if (!Array.isArray(lista)) return;
  await ensureRepresentadasCols(conn);

  for (const item of lista) {
    if (item.excluido === 'S' || item._delete) {
      if (item.id) {
        await conn.query(
          `UPDATE cliente_representadas SET excluido = 'S' WHERE id = ? AND cod_cliente = ?`,
          [item.id, idCliente]
        ).catch(() => {});
      }
      continue;
    }

    const codForn = parseInt(item.cod_fornecedor, 10);
    if (!(codForn > 0)) continue;

    const codigo = String(item.codigo_na_fabrica || '').trim().slice(0, 60) || null;
    const ativo = _sn(item.ativo, 'S');
    const obs = String(item.obs || '').trim().slice(0, 200) || null;
    const marcaPropria = _sn(item.marca_propria, 'N');
    const nomeMarca = marcaPropria === 'S'
      ? (String(item.nome_marca || '').trim().slice(0, 100) || null)
      : null;
    let logo = marcaPropria === 'S'
      ? (String(item.logo_caminho || '').trim().replace(/^\//, '') || null)
      : null;
    if (logo && logo.startsWith('uploads/')) {
      /* ok */
    } else if (logo && logo.startsWith('/uploads/')) {
      logo = logo.slice(1);
    }

    if (item.id) {
      await conn.query(
        `UPDATE cliente_representadas
         SET cod_fornecedor = ?, codigo_na_fabrica = ?, ativo = ?, obs = ?,
             marca_propria = ?, nome_marca = ?, logo_caminho = ?, excluido = 'N'
         WHERE id = ? AND cod_cliente = ?`,
        [codForn, codigo, ativo, obs, marcaPropria, nomeMarca, logo, item.id, idCliente]
      ).catch(async (e) => {
        // Fallback se colunas novas ainda não existem
        if (String(e.message || '').includes('Unknown column')) {
          await conn.query(
            `UPDATE cliente_representadas
             SET cod_fornecedor = ?, codigo_na_fabrica = ?, ativo = ?, obs = ?, excluido = 'N'
             WHERE id = ? AND cod_cliente = ?`,
            [codForn, codigo, ativo, obs, item.id, idCliente]
          ).catch((e2) => console.error('[representadas/update]', e2.message));
        } else {
          console.error('[representadas/update]', e.message);
        }
      });
    } else {
      const [exist] = await conn.query(
        `SELECT id FROM cliente_representadas
         WHERE cod_cliente = ? AND cod_fornecedor = ?
         LIMIT 1`,
        [idCliente, codForn]
      ).catch(() => [[]]);

      if (exist[0]) {
        await conn.query(
          `UPDATE cliente_representadas
           SET codigo_na_fabrica = ?, ativo = ?, obs = ?,
               marca_propria = ?, nome_marca = ?, logo_caminho = ?, excluido = 'N'
           WHERE id = ?`,
          [codigo, ativo, obs, marcaPropria, nomeMarca, logo, exist[0].id]
        ).catch(async (e) => {
          if (String(e.message || '').includes('Unknown column')) {
            await conn.query(
              `UPDATE cliente_representadas
               SET codigo_na_fabrica = ?, ativo = ?, obs = ?, excluido = 'N'
               WHERE id = ?`,
              [codigo, ativo, obs, exist[0].id]
            ).catch((e2) => console.error('[representadas/reactivate]', e2.message));
          } else {
            console.error('[representadas/reactivate]', e.message);
          }
        });
      } else {
        await conn.query(
          `INSERT INTO cliente_representadas
             (cod_cliente, cod_fornecedor, codigo_na_fabrica, ativo, obs,
              marca_propria, nome_marca, logo_caminho, excluido)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'N')`,
          [idCliente, codForn, codigo, ativo, obs, marcaPropria, nomeMarca, logo]
        ).catch(async (e) => {
          if (String(e.message || '').includes('Unknown column')) {
            await conn.query(
              `INSERT INTO cliente_representadas
                 (cod_cliente, cod_fornecedor, codigo_na_fabrica, ativo, obs, excluido)
               VALUES (?, ?, ?, ?, ?, 'N')`,
              [idCliente, codForn, codigo, ativo, obs]
            ).catch((e2) => console.error('[representadas/insert]', e2.message));
          } else {
            console.error('[representadas/insert]', e.message);
          }
        });
      }
    }
  }
}

/** Atualiza só o caminho do logo (após upload). */
async function atualizarLogo(idCliente, codFornecedor, caminho, pool) {
  const executor = pool || getPool();
  await ensureRepresentadasCols(executor);
  const logo = String(caminho || '').replace(/^\//, '') || null;
  const [r] = await executor.query(
    `UPDATE cliente_representadas
     SET logo_caminho = ?, marca_propria = 'S'
     WHERE cod_cliente = ? AND cod_fornecedor = ? AND COALESCE(excluido,'N') = 'N'`,
    [logo, idCliente, codFornecedor]
  );
  return r.affectedRows > 0;
}

/**
 * Marca própria do cliente na fábrica do pedido — só retorna se marca_propria='S'.
 * Opt-in: maioria dos clientes não usa → null.
 */
async function buscarMarcaPropriaClienteFabrica(codCliente, codFornecedor, pool) {
  const idCli = parseInt(codCliente, 10);
  const idForn = parseInt(codFornecedor, 10);
  if (!(idCli > 0) || !(idForn > 0)) return null;
  const executor = pool || getPool();
  await ensureRepresentadasCols(executor);
  try {
    const [rows] = await executor.query(
      `SELECT COALESCE(cr.marca_propria, 'N') AS marca_propria,
              cr.nome_marca, cr.logo_caminho, cr.codigo_na_fabrica
       FROM cliente_representadas cr
       WHERE cr.cod_cliente = ? AND cr.cod_fornecedor = ?
         AND COALESCE(cr.excluido, 'N') = 'N'
       LIMIT 1`,
      [idCli, idForn]
    );
    const r = rows[0];
    if (!r || String(r.marca_propria || 'N').toUpperCase() !== 'S') return null;
    let logo = String(r.logo_caminho || '').trim();
    if (logo && !logo.startsWith('/')) logo = '/' + logo;
    return {
      nome_marca: r.nome_marca || null,
      logo_caminho: logo || null,
      codigo_na_fabrica: r.codigo_na_fabrica || null,
    };
  } catch {
    return null;
  }
}

module.exports = {
  buscarRepresentadas,
  salvarRepresentadas,
  clienteRestringeRepresentadas,
  atualizarLogo,
  buscarMarcaPropriaClienteFabrica,
  ensureRepresentadasCols,
};
