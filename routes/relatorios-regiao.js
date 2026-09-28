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

/**
 * Escopo de vendedor na listagem de clientes.
 * base = 'cliente' → clientes.cod_vendedor
 * base = 'pedido'  → clientes com pedido em pedidos.id_usuario (padrão)
 */
function applyVendBaseClienteScope(where, params, req, vendedorQuery, baseRaw) {
  const base = String(baseRaw || 'pedido').toLowerCase() === 'cliente' ? 'cliente' : 'pedido';
  if (base === 'cliente') {
    return {
      base,
      scope: applyClienteVendScope(where, params, req, vendedorQuery),
      idUsuarioPedido: null,
    };
  }
  const scope = buildPedidosVendedorWhereSync(req, vendedorQuery, 'p.id_usuario');
  if (scope.clause) {
    const inner = scope.clause.replace(/^ AND /, '');
    where.push(`EXISTS (
      SELECT 1 FROM pedidos p
      WHERE p.cod_cliente = c.id
        AND COALESCE(p.excluido, 'N') = 'N'
        AND ${inner}
    )`);
    params.push(...scope.params);
  }
  let idUsuarioPedido = null;
  if (vendedorQuery) {
    idUsuarioPedido = parseInt(vendedorQuery, 10);
  } else if (!scope.canPickOthers) {
    idUsuarioPedido = req.user?.id || null;
  }
  if (Number.isNaN(idUsuarioPedido)) idUsuarioPedido = null;
  return { base, scope, idUsuarioPedido };
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

// ─── GET /carteira-operacional ───────────────────────────────────────────────
// Carteira com última compra, último pedido, geo e dias sem compra (follow-up).
router.get('/carteira-operacional', async (req, res) => {
  try {
    const pool = getPool();
    const {
      q, cidade, uf, regiao, vendedor, status, ordenar,
      dias_sem_compra, // mínimo de dias sem compra (filtra)
      so_com_geo, // 'S' = só com lat/lng
      base_vendedor, // 'pedido' (padrão) | 'cliente'
      id_cliente,
    } = req.query;

    const where = [`COALESCE(c.excluido, 'N') = 'N'`];
    const params = [];

    if (id_cliente) {
      where.push('c.id = ?');
      params.push(Number(id_cliente));
    } else if (q && String(q).trim()) {
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
    if (String(so_com_geo || '').toUpperCase() === 'S') {
      where.push(`c.latitude IS NOT NULL AND c.longitude IS NOT NULL
        AND TRIM(c.latitude) <> '' AND TRIM(c.longitude) <> ''
        AND c.latitude+0 <> 0 AND c.longitude+0 <> 0`);
    }

    const { base: baseVend, scope: vendScope, idUsuarioPedido } =
      applyVendBaseClienteScope(where, params, req, vendedor, base_vendedor);

    const diasMin = parseInt(dias_sem_compra, 10);
    const temFiltroDias = Number.isFinite(diasMin) && diasMin > 0;
    if (temFiltroDias) {
      // Sem compra = nunca comprou OU última compra há mais de N dias
      where.push(`(
        c.dtultimacompra IS NULL
        OR DATEDIFF(CURDATE(), c.dtultimacompra) >= ?
      )`);
      params.push(diasMin);
    }

    const orderMap = {
      nome: 'c.nome ASC',
      cidade: 'c.cidade ASC, c.nome ASC',
      uf: 'c.uf ASC, c.cidade ASC, c.nome ASC',
      regiao: 'nome_regiao ASC, c.nome ASC',
      dias: 'dias_sem_compra DESC, c.nome ASC',
      ultima_compra: 'c.dtultimacompra ASC, c.nome ASC',
    };
    const orderBy = orderMap[String(ordenar || 'dias').toLowerCase()] || orderMap.dias;

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
         c.celularcomprador,
         c.endereco,
         c.bairro,
         c.cep,
         c.latitude,
         c.longitude,
         c.dtultimacompra,
         CASE
           WHEN c.dtultimacompra IS NULL THEN 9999
           ELSE DATEDIFF(CURDATE(), c.dtultimacompra)
         END AS dias_sem_compra
       FROM clientes c
       LEFT JOIN regiao_rota rr ON rr.id = c.regiao AND (rr.excluido = 'N' OR rr.excluido IS NULL)
       LEFT JOIN usuarios u ON u.idusuario = c.cod_vendedor AND u.excluido = 'N'
       WHERE ${where.join(' AND ')}
       ORDER BY ${orderBy}
       LIMIT 10000`,
      params
    );

    const ids = rows.map((r) => r.id).filter(Boolean);
    const ultimoPedidoByCli = new Map();
    const ultimaCompraByCli = new Map();

    if (ids.length) {
      const isOrcP2 = sqlIsOrcamento('p2');
      const filtroVendSql = idUsuarioPedido ? ' AND id_usuario = ?' : '';
      const filtroVendSqlP2 = idUsuarioPedido ? ' AND p2.id_usuario = ?' : '';
      const vendParams = idUsuarioPedido ? [idUsuarioPedido] : [];

      // Último documento (pedido ou orçamento) por cliente — MAX(id) = mais recente (AI)
      const [ultDocs] = await pool.query(
        `SELECT p.id, p.numero, p.cod_cliente, p.data_abertura, p.vlrtotalpedido,
                p.tipo_pedido, p.situacao_pedido, p.cod_fornecedor,
                COALESCE(NULLIF(TRIM(f.nome), ''), '—') AS nome_fornecedor
         FROM pedidos p
         INNER JOIN (
           SELECT cod_cliente, MAX(id) AS mid
           FROM pedidos
           WHERE COALESCE(excluido, 'N') = 'N' AND cod_cliente IN (?)${filtroVendSql}
           GROUP BY cod_cliente
         ) t ON t.mid = p.id
         LEFT JOIN fornecedores f ON f.id = p.cod_fornecedor
           AND (f.excluido = 'N' OR f.excluido IS NULL)`,
        [ids, ...vendParams]
      );
      for (const p of ultDocs) {
        ultimoPedidoByCli.set(Number(p.cod_cliente), p);
      }

      // Última compra = último doc que NÃO é orçamento
      const [ultCompras] = await pool.query(
        `SELECT p.id, p.numero, p.cod_cliente, p.data_abertura, p.vlrtotalpedido,
                p.tipo_pedido, p.situacao_pedido, p.cod_fornecedor,
                COALESCE(NULLIF(TRIM(f.nome), ''), '—') AS nome_fornecedor
         FROM pedidos p
         INNER JOIN (
           SELECT cod_cliente, MAX(id) AS mid
           FROM pedidos p2
           WHERE COALESCE(p2.excluido, 'N') = 'N'
             AND p2.cod_cliente IN (?)
             AND NOT (${isOrcP2})${filtroVendSqlP2}
           GROUP BY cod_cliente
         ) t ON t.mid = p.id
         LEFT JOIN fornecedores f ON f.id = p.cod_fornecedor
           AND (f.excluido = 'N' OR f.excluido IS NULL)`,
        [ids, ...vendParams]
      );
      for (const p of ultCompras) {
        ultimaCompraByCli.set(Number(p.cod_cliente), p);
      }
    }

    function mapPedido(p) {
      if (!p) return null;
      const dt = p.data_abertura
        ? String(p.data_abertura).slice(0, 10)
        : null;
      return {
        id: p.id,
        numero: p.numero,
        data: dt,
        valor: Number(Number(p.vlrtotalpedido || 0).toFixed(2)),
        tipo_pedido: p.tipo_pedido || '',
        situacao: p.situacao_pedido || '',
        cod_fornecedor: p.cod_fornecedor || null,
        nome_fornecedor: p.nome_fornecedor || '',
      };
    }

    const limiar = temFiltroDias ? diasMin : 60; // destaque padrão 60 dias

    const data = rows.map((r) => {
      const dias = Number(r.dias_sem_compra);
      const lat = parseFloat(r.latitude);
      const lng = parseFloat(r.longitude);
      const temGeo = Number.isFinite(lat) && Number.isFinite(lng)
        && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
        && !(lat === 0 && lng === 0);
      const compra = mapPedido(ultimaCompraByCli.get(Number(r.id)));
      const pedido = mapPedido(ultimoPedidoByCli.get(Number(r.id)));
      const forn = compra?.nome_fornecedor || pedido?.nome_fornecedor || '';
      const codForn = compra?.cod_fornecedor || pedido?.cod_fornecedor || null;
      // Preferir data do pedido real; fallback dtultimacompra do cadastro
      let dtCompra = compra?.data || null;
      if (!dtCompra && r.dtultimacompra) {
        dtCompra = String(r.dtultimacompra).slice(0, 10);
      }
      let diasCalc = dias;
      if (compra?.data) {
        // recalcular a partir do pedido real se existir
        const [yy, mm, dd] = compra.data.split('-').map(Number);
        const dComp = new Date(yy, mm - 1, dd);
        const hoje = new Date();
        const hoje0 = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
        diasCalc = Math.max(0, Math.round((hoje0 - dComp) / 86400000));
      } else if (!r.dtultimacompra) {
        diasCalc = 9999;
      }

      let alerta = 'ok';
      if (diasCalc >= 9999 || !dtCompra) alerta = 'nunca';
      else if (diasCalc >= limiar) alerta = 'atrasado';
      else if (diasCalc >= Math.max(1, Math.floor(limiar * 0.7))) alerta = 'atencao';

      return {
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
        cod_fornecedor: codForn,
        nome_fornecedor: forn || '—',
        fone: r.fonesecundario || r.celularcomprador || r.foneprincipal || '',
        endereco: r.endereco || '',
        bairro: r.bairro || '',
        cep: r.cep || '',
        latitude: temGeo ? lat : null,
        longitude: temGeo ? lng : null,
        tem_geo: temGeo,
        dt_ultima_compra: dtCompra,
        dias_sem_compra: diasCalc,
        alerta,
        ultima_compra: compra || (dtCompra ? {
          id: null,
          numero: null,
          data: dtCompra,
          valor: null,
          tipo_pedido: '',
          situacao: '',
          origem: 'cadastro',
        } : null),
        ultimo_pedido: pedido,
      };
    });

    const kpis = {
      total: data.length,
      com_geo: data.filter((d) => d.tem_geo).length,
      nunca: data.filter((d) => d.alerta === 'nunca').length,
      atrasado: data.filter((d) => d.alerta === 'atrasado').length,
      atencao: data.filter((d) => d.alerta === 'atencao').length,
      ok: data.filter((d) => d.alerta === 'ok').length,
    };

    res.json({
      total: data.length,
      data,
      kpis,
      limiar_dias: limiar,
      base_vendedor: baseVend,
      canPickOthers: vendScope.canPickOthers || canPickOtherVendors(req),
    });
  } catch (err) {
    console.error('[relatorios-regiao/carteira-operacional]', err);
    res.status(500).json({ error: 'Erro ao gerar relatório operacional da carteira' });
  }
});

// ─── GET /carteira-compras ───────────────────────────────────────────────────
// Visão prospecção: cidade → cliente → cada compra (1 linha por pedido).
// Colunas alinhadas ao relatório do representante: data, tipo, nº, fábrica, vendedor, frete, forma, total.
router.get('/carteira-compras', async (req, res) => {
  try {
    const pool = getPool();
    const {
      q, cidade, uf, regiao, vendedor, status,
      de, ate, situacao,
      base_vendedor,
      so_pedidos, // 'S' = só pedidos reais (não orçamento) — padrão S
      id_cliente,
      fornecedor,
    } = req.query;

    const where = [
      `COALESCE(p.excluido, 'N') = 'N'`,
      `COALESCE(c.excluido, 'N') = 'N'`,
    ];
    const params = [];

    const soPed = String(so_pedidos || 'S').toUpperCase() !== 'N';
    if (soPed) {
      where.push(`NOT (${sqlIsOrcamento('p')})`);
    }

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
    } else {
      // Não misturar cancelados na visão de prospecção (padrão do print)
      where.push(`(p.situacao_pedido IS NULL OR UPPER(p.situacao_pedido) <> 'CANCELADO')`);
    }

    if (id_cliente) {
      where.push('c.id = ?');
      params.push(Number(id_cliente));
    } else if (q && String(q).trim()) {
      const like = `%${String(q).trim()}%`;
      where.push(`(c.nome LIKE ? OR c.apelido LIKE ? OR c.cpf LIKE ? OR CAST(p.numero AS CHAR) LIKE ?)`);
      params.push(like, like, like, like);
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
    if (fornecedor) {
      where.push(`p.cod_fornecedor = ?`);
      params.push(Number(fornecedor));
    }
    if (status && status !== 'TODOS') {
      where.push(`c.status = ?`);
      params.push(status);
    }

    const base = String(base_vendedor || 'pedido').toLowerCase() === 'cliente' ? 'cliente' : 'pedido';
    let vendScope;
    if (base === 'cliente') {
      vendScope = applyClienteVendScope(where, params, req, vendedor);
    } else {
      vendScope = applyPedidoVendScope(where, params, req, vendedor);
    }

    const [rows] = await pool.query(
      `SELECT
         p.id,
         p.numero,
         p.data_abertura,
         p.tipo_pedido,
         p.situacao_pedido,
         p.vlrtotalpedido,
         p.tipo_frete,
         p.forma_pagto,
         p.condicao_pagto,
         p.cod_fornecedor,
         COALESCE(NULLIF(TRIM(f.nome), ''), NULLIF(TRIM(p.nome_fornecedor), ''), '—') AS nome_fornecedor,
         p.id_usuario,
         COALESCE(NULLIF(TRIM(u.nomeusu), ''), NULLIF(TRIM(p.nome_vendedor), ''), '—') AS nome_vendedor,
         c.id AS id_cliente,
         COALESCE(NULLIF(TRIM(c.nome), ''), c.apelido, '') AS nome_cliente,
         c.cidade,
         c.uf,
         c.status AS status_cliente,
         c.cod_vendedor,
         c.regiao AS id_regiao,
         COALESCE(rr.descricao, 'Sem região') AS nome_regiao,
         c.foneprincipal,
         c.fonesecundario,
         c.celularcomprador
       FROM pedidos p
       INNER JOIN clientes c ON c.id = p.cod_cliente
       LEFT JOIN fornecedores f ON f.id = p.cod_fornecedor
         AND (f.excluido = 'N' OR f.excluido IS NULL)
       LEFT JOIN usuarios u ON u.idusuario = p.id_usuario AND u.excluido = 'N'
       LEFT JOIN regiao_rota rr ON rr.id = c.regiao
         AND (rr.excluido = 'N' OR rr.excluido IS NULL)
       WHERE ${where.join(' AND ')}
       ORDER BY
         COALESCE(c.cidade, '') ASC,
         COALESCE(c.uf, '') ASC,
         nome_cliente ASC,
         p.data_abertura ASC,
         p.id ASC
       LIMIT 25000`,
      params
    );

    const data = rows.map((r) => ({
      id: r.id,
      numero: r.numero,
      data: r.data_abertura ? String(r.data_abertura).slice(0, 10) : null,
      tipo_pedido: r.tipo_pedido || '',
      situacao: r.situacao_pedido || '',
      valor: Number(Number(r.vlrtotalpedido || 0).toFixed(2)),
      tipo_frete: r.tipo_frete || '',
      forma_pagto: r.forma_pagto || r.condicao_pagto || '',
      cod_fornecedor: r.cod_fornecedor,
      nome_fornecedor: r.nome_fornecedor || '—',
      id_usuario: r.id_usuario,
      nome_vendedor: r.nome_vendedor || '—',
      id_cliente: r.id_cliente,
      nome_cliente: r.nome_cliente,
      cidade: r.cidade || '',
      uf: r.uf || '',
      status_cliente: r.status_cliente,
      status_cliente_label: statusLabel(r.status_cliente),
      cod_vendedor: r.cod_vendedor,
      id_regiao: r.id_regiao,
      nome_regiao: r.nome_regiao || 'Sem região',
      fone: r.fonesecundario || r.celularcomprador || r.foneprincipal || '',
    }));

    const totais = data.reduce(
      (acc, r) => {
        acc.qtd += 1;
        acc.valor += r.valor;
        return acc;
      },
      { qtd: 0, valor: 0 }
    );
    totais.valor = Number(totais.valor.toFixed(2));

    const clientesSet = new Set(data.map((r) => r.id_cliente));
    const cidadesSet = new Set(data.map((r) => `${r.cidade}|${r.uf}`));

    res.json({
      total: data.length,
      data,
      totais,
      kpis: {
        pedidos: data.length,
        clientes: clientesSet.size,
        cidades: cidadesSet.size,
        valor: totais.valor,
      },
      periodo: { de: de || null, ate: ate || null },
      base_vendedor: base,
      canPickOthers: vendScope.canPickOthers || canPickOtherVendors(req),
    });
  } catch (err) {
    console.error('[relatorios-regiao/carteira-compras]', err);
    res.status(500).json({ error: 'Erro ao gerar mapa de compras da carteira' });
  }
});

module.exports = router;
