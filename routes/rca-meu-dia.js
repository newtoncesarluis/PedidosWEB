'use strict';

/**
 * Painel RCA «Meu Dia» + dados para Oferta WhatsApp rápida.
 * Escopo de carteira/pedidos igual ao restante do sistema (vendedor-visibilidade + carteira-politica).
 */

const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');
const {
  buildClienteVendedorWhere,
  getSistemaCarteiraConfig,
} = require('../config/carteira-politica');
const { buildPedidosListVisWhere } = require('../config/vendedor-visibilidade');
const {
  tipoPedidosJoinSql,
  geraFinanceiroExprSql,
  ensureTipoPedidosColumns,
} = require('../config/pedido-gerafinanceiro');
const { calcularPrecoPromocao } = require('../config/promocoes-produto');

const TEL_EXPR = `COALESCE(
  NULLIF(TRIM(c.fonesecundario), ''),
  NULLIF(TRIM(c.celularcomprador), ''),
  NULLIF(TRIM(c.foneprincipal), '')
)`;

function podeUsarPainelRca(user) {
  if (!user) return false;
  if (user.perfil == 1 || user.role === 'admin') return true;
  return String(user.permissoes?.p_vender || '').toUpperCase() === 'S';
}

async function getProdTabela(pool) {
  const [t] = await pool.query("SHOW TABLES LIKE 'produto'");
  if (t.length) return 'produto';
  const [t2] = await pool.query("SHOW TABLES LIKE 'produtos'");
  return t2.length ? 'produtos' : 'produto';
}

async function tabelaPromocoesExiste(pool) {
  try {
    const [r] = await pool.query("SHOW TABLES LIKE 'produto_promocoes'");
    return r.length > 0;
  } catch {
    return false;
  }
}

function fmtMoeda(v) {
  const n = Number(v) || 0;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ─── GET /api/rca/meu-dia ─────────────────────────────────────────────────────
router.get('/meu-dia', async (req, res) => {
  try {
    if (!podeUsarPainelRca(req.user)) {
      return res.json({ ok: true, ativo: false, motivo: 'sem_permissao_venda' });
    }

    const pool = getPool();
    const dias = Math.min(180, Math.max(7, parseInt(req.query.dias_sem_compra, 10) || 45));
    const limitCli = Math.min(30, Math.max(3, parseInt(req.query.limit_clientes, 10) || 4));
    const limitOrc = Math.min(20, Math.max(3, parseInt(req.query.limit_orcamentos, 10) || 3));
    const limitPromo = Math.min(40, Math.max(5, parseInt(req.query.limit_promocoes, 10) || 12));

    await ensureTipoPedidosColumns(pool);

    const config = await getSistemaCarteiraConfig(pool);
    const cliVis = buildClienteVendedorWhere(req.user, 'c', null, config);
    const pedVis = await buildPedidosListVisWhere(pool, req);
    const tpJoin = tipoPedidosJoinSql('p', 'tp');
    const geraFinExpr = geraFinanceiroExprSql('p', 'tp');

    // Clientes parados (sem pedido no período) com telefone WhatsApp
    const [[kpiParados]] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM clientes c
       WHERE (c.excluido = 'N' OR c.excluido IS NULL OR c.excluido = '')
         AND (c.status = 'A' OR c.status IS NULL OR c.status = '')
         AND ${TEL_EXPR} IS NOT NULL
         ${cliVis.clause}
         AND NOT EXISTS (
           SELECT 1 FROM pedidos p
           WHERE p.cod_cliente = c.id
             AND (p.excluido = 'N' OR p.excluido IS NULL OR p.excluido = '')
             AND p.data_abertura >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         )`,
      [...cliVis.params, dias]
    ).catch(() => [{ total: 0 }]);

    const [clientesParados] = await pool.query(
      `SELECT c.id,
              COALESCE(NULLIF(TRIM(c.apelido), ''), c.nome) AS nome,
              c.nome AS nome_completo,
              c.cidade, c.uf,
              ${TEL_EXPR} AS telefone,
              c.dtultimacompra,
              DATEDIFF(CURDATE(), c.dtultimacompra) AS dias_sem_compra
       FROM clientes c
       WHERE (c.excluido = 'N' OR c.excluido IS NULL OR c.excluido = '')
         AND (c.status = 'A' OR c.status IS NULL OR c.status = '')
         AND ${TEL_EXPR} IS NOT NULL
         ${cliVis.clause}
         AND NOT EXISTS (
           SELECT 1 FROM pedidos p
           WHERE p.cod_cliente = c.id
             AND (p.excluido = 'N' OR p.excluido IS NULL OR p.excluido = '')
             AND p.data_abertura >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         )
       ORDER BY c.dtultimacompra IS NULL DESC, c.dtultimacompra ASC, c.nome ASC
       LIMIT ?`,
      [...cliVis.params, dias, limitCli]
    ).catch(() => [[]]);

    // Orçamentos pendentes (tipo sem geração financeira)
    const [[kpiOrc]] = await pool.query(
      `SELECT COUNT(*) AS total,
              IFNULL(SUM(p.vlrtotalpedido), 0) AS valor
       FROM pedidos p
       ${tpJoin}
       WHERE (p.excluido = 'N' OR p.excluido IS NULL OR p.excluido = '')
         AND ${geraFinExpr} = 'N'
         AND COALESCE(p.situacao_pedido, '') NOT IN ('CANCELADO')
         ${pedVis.clause}`,
      pedVis.params
    ).catch(() => [{ total: 0, valor: 0 }]);

    const [orcamentos] = await pool.query(
      `SELECT p.id, p.numero, p.nome_cliente, p.vlrtotalpedido, p.data_abertura,
              p.situacao_pedido, p.cod_cliente
       FROM pedidos p
       ${tpJoin}
       WHERE (p.excluido = 'N' OR p.excluido IS NULL OR p.excluido = '')
         AND ${geraFinExpr} = 'N'
         AND COALESCE(p.situacao_pedido, '') NOT IN ('CANCELADO')
         ${pedVis.clause}
       ORDER BY p.data_abertura DESC, p.id DESC
       LIMIT ?`,
      [...pedVis.params, limitOrc]
    ).catch(() => [[]]);

    // Promoções ativas (para oferta rápida — leitura leve, sem exigir tela de promoções)
    let promocoes = [];
    let qtdPromocoes = 0;
    if (await tabelaPromocoesExiste(pool)) {
      try {
        const tb = await getProdTabela(pool);
        const wherePromo = `pp.excluido = 'N' AND pp.ativo = 'S'
          AND (pp.data_inicio IS NULL OR pp.data_inicio <= CURDATE())
          AND (pp.data_fim IS NULL OR pp.data_fim >= CURDATE())`;
        const [[{ total }]] = await pool.query(
          `SELECT COUNT(*) AS total FROM produto_promocoes pp WHERE ${wherePromo}`
        );
        qtdPromocoes = Number(total) || 0;
        const [rows] = await pool.query(
          `SELECT pp.id, pp.cod_produto, pp.descricao AS promo_desc,
                  pp.tipo, pp.valor, pp.data_fim,
                  p.descricao AS nome_produto, p.vlr_venda
           FROM produto_promocoes pp
           INNER JOIN ${tb} p ON p.ID = pp.cod_produto
           WHERE ${wherePromo}
             AND (p.excluido = 'N' OR p.excluido IS NULL OR p.excluido = '')
           ORDER BY pp.data_fim IS NULL DESC, pp.data_fim ASC, pp.id DESC
           LIMIT ?`,
          [limitPromo]
        );
        promocoes = rows.map((r) => {
          const padrao = parseFloat(r.vlr_venda) || 0;
          const precoFinal = calcularPrecoPromocao(r.tipo, r.valor, padrao);
          return {
            id: r.id,
            cod_produto: r.cod_produto,
            nome: r.nome_produto || r.promo_desc || `Produto ${r.cod_produto}`,
            preco: precoFinal,
            preco_fmt: fmtMoeda(precoFinal),
            vlr_venda: padrao,
            data_fim: r.data_fim || null,
          };
        });
      } catch (_) {
        promocoes = [];
        qtdPromocoes = 0;
      }
    }

    res.json({
      ok: true,
      ativo: true,
      dias_sem_compra: dias,
      kpis: {
        clientes_parados: Number(kpiParados?.total) || 0,
        orcamentos_pendentes: Number(kpiOrc?.total) || 0,
        orcamentos_valor: Number(kpiOrc?.valor) || 0,
        promocoes_ativas: qtdPromocoes,
      },
      clientes_parados: (clientesParados || []).map((c) => ({
        id: c.id,
        nome: c.nome,
        nome_completo: c.nome_completo,
        cidade: c.cidade || '',
        uf: c.uf || '',
        telefone: String(c.telefone || '').replace(/\D/g, ''),
        dtultimacompra: c.dtultimacompra || null,
        dias_sem_compra: c.dias_sem_compra != null ? Number(c.dias_sem_compra) : null,
      })),
      orcamentos: (orcamentos || []).map((o) => ({
        id: o.id,
        numero: o.numero,
        nome_cliente: o.nome_cliente,
        valor: Number(o.vlrtotalpedido) || 0,
        valor_fmt: fmtMoeda(o.vlrtotalpedido),
        data_abertura: o.data_abertura,
        situacao: o.situacao_pedido || '',
        cod_cliente: o.cod_cliente,
      })),
      promocoes,
    });
  } catch (err) {
    console.error('[rca/meu-dia]', err);
    res.status(500).json({ error: err.message || 'Erro ao carregar Meu Dia' });
  }
});

// ─── GET /api/rca/oferta/buscar-clientes?q= ───────────────────────────────────
router.get('/oferta/buscar-clientes', async (req, res) => {
  try {
    if (!podeUsarPainelRca(req.user)) {
      return res.status(403).json({ error: 'Sem permissão' });
    }
    const pool = getPool();
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ clientes: [] });

    const config = await getSistemaCarteiraConfig(pool);
    const cliVis = buildClienteVendedorWhere(req.user, 'c', null, config);
    const lk = `%${q.toLowerCase()}%`;

    const [rows] = await pool.query(
      `SELECT c.id,
              COALESCE(NULLIF(TRIM(c.apelido), ''), c.nome) AS nome,
              c.nome AS nome_completo,
              c.cidade, c.uf,
              ${TEL_EXPR} AS telefone
       FROM clientes c
       WHERE (c.excluido = 'N' OR c.excluido IS NULL OR c.excluido = '')
         AND (c.status = 'A' OR c.status IS NULL OR c.status = '')
         AND (LOWER(c.nome) LIKE ? OR LOWER(COALESCE(c.apelido,'')) LIKE ? OR LOWER(COALESCE(c.cidade,'')) LIKE ?)
         ${cliVis.clause}
       ORDER BY c.nome
       LIMIT 20`,
      [lk, lk, lk, ...cliVis.params]
    );

    res.json({
      clientes: rows.map((c) => ({
        id: c.id,
        nome: c.nome,
        nome_completo: c.nome_completo,
        cidade: c.cidade || '',
        uf: c.uf || '',
        telefone: String(c.telefone || '').replace(/\D/g, ''),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
