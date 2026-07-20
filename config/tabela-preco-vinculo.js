'use strict';

/**
 * Tabelas de preço vinculadas a uma entidade (cliente/fornecedor/vendedor).
 * Regra: vínculo excluido='N' + cabeçalho excluido='N' e Tabela_Ativa='S'
 * (fallback legado tabela_preco só se não houver cabeçalho, com excluido='N').
 */
async function listarTabelasVinculadas(pool, entidadeId, tipoEntidade) {
  const id = parseInt(entidadeId, 10);
  if (!id || !tipoEntidade) return [];

  let vinculos = [];
  try {
    [vinculos] = await pool.query(
      `SELECT id_tabela FROM tabela_preco_vinculo
       WHERE id_entidade = ? AND tipo_entidade = ? AND excluido = 'N'
       ORDER BY id_tabela`,
      [id, String(tipoEntidade).toUpperCase()]
    );
  } catch (_) {
    return [];
  }

  const out = [];
  for (const v of vinculos) {
    const tid = parseInt(v.id_tabela, 10);
    if (!tid) continue;

    let incluir = false;
    let descricao = `Tabela #${tid}`;

    let apareceMobile = 'S';
    let apareceShowroom = 'N';
    try {
      const [[cab]] = await pool.query(
        `SELECT Descricao,
                IFNULL(aparece_mobile,'S') AS aparece_mobile,
                IFNULL(aparece_showroom,'N') AS aparece_showroom
         FROM tabela_preco_cabecalho
         WHERE id = ? AND excluido = 'N' AND Tabela_Ativa = 'S'
         LIMIT 1`,
        [tid]
      );
      if (cab) {
        descricao = String(cab.Descricao || descricao).trim();
        apareceMobile = cab.aparece_mobile || 'S';
        apareceShowroom = cab.aparece_showroom || 'N';
        incluir = true;
      }
    } catch (_) {
      /* coluna aparece_showroom pode faltar em bases antigas — tenta sem ela */
      try {
        const [[cab]] = await pool.query(
          `SELECT Descricao, IFNULL(aparece_mobile,'S') AS aparece_mobile FROM tabela_preco_cabecalho
           WHERE id = ? AND excluido = 'N' AND Tabela_Ativa = 'S'
           LIMIT 1`,
          [tid]
        );
        if (cab) {
          descricao = String(cab.Descricao || descricao).trim();
          apareceMobile = cab.aparece_mobile || 'S';
          incluir = true;
        }
      } catch (__) { /* cabecalho pode não existir em bases legadas */ }
    }

    if (!incluir) {
      try {
        const [[leg]] = await pool.query(
          `SELECT descricao FROM tabela_preco
           WHERE id = ? AND excluido = 'N'
             AND (tipo_regra IS NULL OR tipo_regra <> 'PRODUTO')
           LIMIT 1`,
          [tid]
        );
        if (leg) {
          descricao = String(leg.descricao || descricao).trim();
          incluir = true;
        }
      } catch (_) {}
    }

    if (!incluir) continue;

    out.push({
      id: tid,
      id_tabela: tid,
      descricao,
      tabela_ativa: 'S',
      aparece_mobile: apareceMobile,
      aparece_showroom: apareceShowroom,
    });
  }

  return out;
}

module.exports = { listarTabelasVinculadas };
