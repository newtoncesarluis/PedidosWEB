'use strict';

/**
 * Relatórios comerciais de Região / Carteira
 * GET /api/comercial/relatorios/*
 */
const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');
const {
  buildPedidosVendedorWhereSync,
  canPickOtherVendors,
  canAccessAllVendors,
  isGerenteComercial,
} = require('../config/vendedor-visibilidade');
const { tipoPedidoNormSql } = require('../config/pedido-gerafinanceiro');

/** Expressão SQL: tipo é orçamento (ORCAMENTO / ORÇAMENTO / ORCA…). */
function sqlIsOrcamento(pAlias = 'p') {
  const n = tipoPedidoNormSql(`${pAlias}.tipo_pedido`);
  return `(${n} LIKE '%ORCAMENTO%' OR ${n} LIKE '%ORCA%')`;
}

function statusLabel(s) {
  const u = String(s || '').toUpperCase();
  if (u === 'A') return 'Ativo';
  if (u === 'I') return 'Inativo';
  if (u === 'E') return 'Encerrado';
  return s || '—';
}

function applyClienteVendScope(where, params, req, vendedorQuery) {
  const scope = buildPedidosVendedorWhereSync(req, vendedorQuery, 'c.cod_vendedor');
  if (scope.clause) {
    where.push(scope.clause.replace(/^ AND /, ''));
    params.push(...scope.params);
  }
  return scope;
}

function applyPedidoVendScope(where, params, req, vendedorQuery) {
  const scope = buildPedidosVendedorWhereSync(req, vendedorQuery, 'p.id_usuario');
  if (scope.clause) {
    where.push(scope.clause.replace(/^ AND /, ''));
    params.push(...scope.params);
  }
  return scope;
}

// ─── GET /clientes-geral ─────────────────────────────────────────────────────
router.get('/clientes-geral', async (req, res) => {
  try {
    const pool = getPool();
    const {
      q, cidade, uf, regiao, vendedor, status, ordenar,
    } = req.query;

    const where = [`COALESCE(c.excluido, 'N') = 'N'`];
    const params = [];

    if (q && String(q).trim()) {
      const like = `%${String(q).trim()}%`;
      where.push(`(c.nome LIKE ? OR c.apelido LIKE ? OR c.cpf LIKE ?)`);
      params.push(like, like, like);
    }
    if (cidade && String(cidade).trim()) {
      where.push(`LOWER(c.cidade) LIKE ?`);
      params.push(`%${String(cidade).trim().toLowerCase()}%`);
    }
    if (uf && String(uf).trim()) {
      where.push(`UPPER(c.uf) = ?`);
      params.push(String(uf).trim().toUpperCase());
    }
    if (regiao) {
      where.push(`c.regiao = ?`);
      params.push(regiao);
    }
    if (status && status !== 'TODOS') {
      where.push(`c.status = ?`);
      params.push(status);
    }

    const vendScope = applyClienteVendScope(where, params, req, vendedor);

    const orderMap = {
      nome: 'c.nome ASC',
      cidade: 'c.cidade ASC, c.nome ASC',
      uf: 'c.uf ASC, c.cidade ASC, c.nome ASC',
      regiao: 'nome_regiao ASC, c.nome ASC',
    };
    const orderBy = orderMap[String(ordenar || 'nome').toLowerCase()] || orderMap.nome;

    const [rows] = await pool.query(
      `SELECT
         c.id,
         COALESCE(NULLIF(TRIM(c.nome), ''), c.apelido, '') AS nome,
         c.apelido,
         c.cidade,
         c.uf,
         c.status,
         c.cod_vendedor,
         c.regiao AS id_regiao,
         COALESCE(rr.descricao, 'Sem região') AS nome_regiao,
         COALESCE(u.nomeusu, '—') AS nome_vendedor,
         c.foneprincipal,
         c.fonesecundario,
         c.celularcomprador
       FROM clientes c
       LEFT JOIN regiao_rota rr ON rr.id = c.regiao AND (rr.excluido = 'N' OR rr.excluido IS NULL)
       LEFT JOIN usuarios u ON u.idusuario = c.cod_vendedor AND u.excluido = 'N'
       WHERE ${where.join(' AND ')}
       ORDER BY ${orderBy}
       LIMIT 10000`,
      params
    );

    const data = rows.map((r) => ({
      id: r.id,
      nome: r.nome,
      apelido: r.apelido || '',
      cidade: r.cidade || '',
      uf: r.uf || '',
      status: r.status,
      status_label: statusLabel(r.status),
      id_regiao: r.id_regiao,
      nome_regiao: r.nome_regiao || 'Sem região',
      cod_vendedor: r.cod_vendedor,
      nome_vendedor: r.nome_vendedor,
      fone: r.fonesecundario || r.celularcomprador || r.foneprincipal || '',
    }));

    res.json({
      total: data.length,
      data,
      canPickOthers: vendScope.canPickOthers || canPickOtherVendors(req),
    });
  } catch (err) {
    console.error('[relatorios-regiao/clientes-geral]', err);
    res.status(500).json({ error: 'Erro ao gerar relatório geral de clientes' });
  }
});

// ─── GET /regiao-por-vendedor ────────────────────────────────────────────────
router.get('/regiao-por-vendedor', async (req, res) => {
  try {
    const pool = getPool();
    const { vendedor } = req.query;

    const scope = buildPedidosVendedorWhereSync(req, vendedor, 'c.cod_vendedor');
    let idVendEfetivo = vendedor ? parseInt(vendedor, 10) : null;
    if (!scope.canPickOthers) {
      idVendEfetivo = req.user?.id || null;
    }
    if (Number.isNaN(idVendEfetivo)) idVendEfetivo = null;

    // Clientes visíveis (carteira do vendedor / equipe / todos)
    const cliWhere = [`COALESCE(c.excluido, 'N') = 'N'`];
    const cliParams = [];
    applyClienteVendScope(cliWhere, cliParams, req, vendedor);

    // Quando há filtro de vendedor: regiões do padrão OU com clientes dele na região
    let filtroPadraoSql = 'rr.id_vendedor_padrao IS NOT NULL';
    let filtroPadraoParams = [];
    if (idVendEfetivo) {
      filtroPadraoSql = 'rr.id_vendedor_padrao = ?';
      filtroPadraoParams = [idVendEfetivo];
    } else if (!canAccessAllVendors(req) && isGerenteComercial(req)) {
      filtroPadraoSql =
        '(rr.id_vendedor_padrao = ? OR rr.id_vendedor_padrao IN (SELECT idusuario FROM usuarios WHERE id_gerente = ? AND excluido = \'N\'))';
      filtroPadraoParams = [req.user.id, req.user.id];
    }

    const [rows] = await pool.query(
      `SELECT
         rr.id AS id_regiao,
         COALESCE(rr.descricao, 'Sem região') AS nome_regiao,
         rr.id_vendedor_padrao,
         COALESCE(up.nomeusu, '—') AS nome_vendedor_padrao,
         COUNT(DISTINCT c.id) AS qtd_clientes
       FROM regiao_rota rr
       LEFT JOIN usuarios up ON up.idusuario = rr.id_vendedor_padrao AND up.excluido = 'N'
       LEFT JOIN clientes c ON c.regiao = rr.id
         AND ${cliWhere.join(' AND ')}
       WHERE (rr.excluido = 'N' OR rr.excluido IS NULL)
         AND (rr.status = 'A' OR rr.status IS NULL)
         AND (
           (${filtroPadraoSql})
           OR c.id IS NOT NULL
         )
       GROUP BY rr.id, rr.descricao, rr.id_vendedor_padrao, up.nomeusu
       HAVING COUNT(DISTINCT c.id) > 0
           OR (${filtroPadraoSql})
       ORDER BY nome_regiao ASC`,
      [...cliParams, ...filtroPadraoParams, ...filtroPadraoParams]
    );

    const data = rows.map((r) => {
      const isPadrao = idVendEfetivo
        ? Number(r.id_vendedor_padrao) === Number(idVendEfetivo)
        : r.id_vendedor_padrao != null;
      const hasCli = Number(r.qtd_clientes || 0) > 0;
      return {
        id_regiao: r.id_regiao,
        nome_regiao: r.nome_regiao,
        id_vendedor_padrao: r.id_vendedor_padrao,
        nome_vendedor_padrao: r.nome_vendedor_padrao,
        qtd_clientes: Number(r.qtd_clientes || 0),
        vinculo_padrao: isPadrao,
        vinculo_clientes: hasCli,
        origem: [isPadrao ? 'vendedor_padrao' : null, hasCli ? 'clientes' : null].filter(Boolean).join('+') || '—',
      };
    }).filter((r) => r.vinculo_padrao || r.vinculo_clientes);

    const porVendedorMap = new Map();
    for (const r of data) {
      const vid = r.id_vendedor_padrao || 0;
      const vnome = r.id_vendedor_padrao ? (r.nome_vendedor_padrao || '—') : 'Sem vendedor padrão';
      if (!porVendedorMap.has(vid)) {
        porVendedorMap.set(vid, {
          id_vendedor: r.id_vendedor_padrao || null,
          nome_vendedor: vnome,
          regioes: [],
          total_clientes: 0,
        });
      }
      const g = porVendedorMap.get(vid);
      g.regioes.push({
        id_regiao: r.id_regiao,
        nome_regiao: r.nome_regiao,
        qtd_clientes: r.qtd_clientes,
        vinculo_padrao: r.vinculo_padrao,
        vinculo_clientes: r.vinculo_clientes,
      });
      g.total_clientes += r.qtd_clientes;
    }

    res.json({
      total: data.length,
      data,
      por_vendedor: Array.from(porVendedorMap.values()),
      canPickOthers: scope.canPickOthers,
      filtro_vendedor: idVendEfetivo,
    });
  } catch (err) {
    console.error('[relatorios-regiao/regiao-por-vendedor]', err);
    res.status(500).json({ error: 'Erro ao gerar relatório região por vendedor' });
  }
});

// ─── GET /regiao-por-clientes ────────────────────────────────────────────────
router.get('/regiao-por-clientes', async (req, res) => {
  try {
    const pool = getPool();
    const { regiao, vendedor, cidade, uf } = req.query;

    const where = [`COALESCE(c.excluido, 'N') = 'N'`];
    const params = [];

    if (regiao) {
      where.push(`c.regiao = ?`);
      params.push(regiao);
    }
    if (cidade && String(cidade).trim()) {
      where.push(`LOWER(c.cidade) LIKE ?`);
      params.push(`%${String(cidade).trim().toLowerCase()}%`);
    }
    if (uf && String(uf).trim()) {
      where.push(`UPPER(c.uf) = ?`);
      params.push(String(uf).trim().toUpperCase());
    }

    const vendScope = applyClienteVendScope(where, params, req, vendedor);

    const [rows] = await pool.query(
      `SELECT
         c.id,
         COALESCE(NULLIF(TRIM(c.nome), ''), c.apelido, '') AS nome,
         c.cidade,
         c.uf,
         c.status,
         c.regiao AS id_regiao,
         COALESCE(rr.descricao, 'Sem região') AS nome_regiao,
         COALESCE(u.nomeusu, '—') AS nome_vendedor,
         c.cod_vendedor
       FROM clientes c
       LEFT JOIN regiao_rota rr ON rr.id = c.regiao AND (rr.excluido = 'N' OR rr.excluido IS NULL)
       LEFT JOIN usuarios u ON u.idusuario = c.cod_vendedor AND u.excluido = 'N'
       WHERE ${where.join(' AND ')}
       ORDER BY nome_regiao ASC, c.nome ASC
       LIMIT 15000`,
      params
    );

    const gruposMap = new Map();
    for (const r of rows) {
      const key = r.id_regiao != null ? String(r.id_regiao) : 'null';
      if (!gruposMap.has(key)) {
        gruposMap.set(key, {
          id_regiao: r.id_regiao,
          nome_regiao: r.nome_regiao || 'Sem região',
          qtd_clientes: 0,
          clientes: [],
        });
      }
      const g = gruposMap.get(key);
      g.qtd_clientes += 1;
      g.clientes.push({
        id: r.id,
        nome: r.nome,
        cidade: r.cidade || '',
        uf: r.uf || '',
        status: r.status,
        status_label: statusLabel(r.status),
        nome_vendedor: r.nome_vendedor,
        cod_vendedor: r.cod_vendedor,
      });
    }

    const grupos = Array.from(gruposMap.values()).sort((a, b) =>
      String(a.nome_regiao).localeCompare(String(b.nome_regiao), 'pt-BR')
    );

    res.json({
      total_clientes: rows.length,
      total_regioes: grupos.length,
      grupos,
      canPickOthers: vendScope.canPickOthers,
    });
  } catch (err) {
    console.error('[relatorios-regiao/regiao-por-clientes]', err);
    res.status(500).json({ error: 'Erro ao gerar relatório região por clientes' });
  }
});

// ─── GET /valores-por-regiao ─────────────────────────────────────────────────
router.get('/valores-por-regiao', async (req, res) => {
  try {
    const pool = getPool();
    const { de, ate, vendedor, regiao, situacao } = req.query;

    const where = [`COALESCE(p.excluido, 'N') = 'N'`];
    const params = [];

    if (de) {
      where.push('p.data_abertura >= ?');
      params.push(de);
    }
    if (ate) {
      where.push('p.data_abertura <= ?');
      params.push(ate);
    }
    if (situacao && situacao !== 'TODOS') {
      where.push('p.situacao_pedido = ?');
      params.push(situacao);
    }
    if (regiao) {
      where.push('c.regiao = ?');
      params.push(regiao);
    }

    const vendScope = applyPedidoVendScope(where, params, req, vendedor);

    const isOrc = sqlIsOrcamento('p');

    // COALESCE(c.regiao,-1) une NULL/inválido numa só linha "Sem região" (evita duplicata no GROUP BY).
    const [rows] = await pool.query(
      `SELECT
         NULLIF(COALESCE(c.regiao, -1), -1) AS id_regiao,
         COALESCE(MAX(rr.descricao), 'Sem região') AS nome_regiao,
         SUM(CASE WHEN NOT ${isOrc} THEN 1 ELSE 0 END) AS qtd_pedidos,
         SUM(CASE WHEN NOT ${isOrc} THEN COALESCE(p.vlrtotalpedido, 0) ELSE 0 END) AS vlr_pedidos,
         SUM(CASE WHEN ${isOrc} THEN 1 ELSE 0 END) AS qtd_orcamentos,
         SUM(CASE WHEN ${isOrc} THEN COALESCE(p.vlrtotalpedido, 0) ELSE 0 END) AS vlr_orcamentos,
         COUNT(*) AS qtd_total,
         SUM(COALESCE(p.vlrtotalpedido, 0)) AS vlr_total
       FROM pedidos p
       LEFT JOIN clientes c ON c.id = p.cod_cliente
       LEFT JOIN regiao_rota rr ON rr.id = c.regiao AND (rr.excluido = 'N' OR rr.excluido IS NULL)
       WHERE ${where.join(' AND ')}
       GROUP BY COALESCE(c.regiao, -1)
       ORDER BY vlr_total DESC, nome_regiao ASC`,
      params
    );

    const data = rows.map((r) => ({
      id_regiao: r.id_regiao,
      nome_regiao: r.nome_regiao || 'Sem região',
      qtd_pedidos: Number(r.qtd_pedidos || 0),
      vlr_pedidos: Number(Number(r.vlr_pedidos || 0).toFixed(2)),
      qtd_orcamentos: Number(r.qtd_orcamentos || 0),
      vlr_orcamentos: Number(Number(r.vlr_orcamentos || 0).toFixed(2)),
      qtd_total: Number(r.qtd_total || 0),
      total: Number(Number(r.vlr_total || 0).toFixed(2)),
    }));

    const totais = data.reduce(
      (acc, r) => {
        acc.qtd_pedidos += r.qtd_pedidos;
        acc.vlr_pedidos += r.vlr_pedidos;
        acc.qtd_orcamentos += r.qtd_orcamentos;
        acc.vlr_orcamentos += r.vlr_orcamentos;
        acc.qtd_total += r.qtd_total;
        acc.total += r.total;
        return acc;
      },
      {
        qtd_pedidos: 0,
        vlr_pedidos: 0,
        qtd_orcamentos: 0,
        vlr_orcamentos: 0,
        qtd_total: 0,
        total: 0,
      }
    );
    totais.vlr_pedidos = Number(totais.vlr_pedidos.toFixed(2));
    totais.vlr_orcamentos = Number(totais.vlr_orcamentos.toFixed(2));
    totais.total = Number(totais.total.toFixed(2));

    res.json({
      data,
      totais,
      canPickOthers: vendScope.canPickOthers,
      periodo: { de: de || null, ate: ate || null },
    });
  } catch (err) {
    console.error('[relatorios-regiao/valores-por-regiao]', err);
    res.status(500).json({ error: 'Erro ao gerar relatório de valores por região' });
  }
});

module.exports = router;
