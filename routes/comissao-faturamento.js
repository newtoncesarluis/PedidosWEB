/**
 * Relatórios da Comissão por Faturamento (opt-in por CNPJ — config/comissao-faturamento.js)
 *  - GET /api/comissao-faturamento/config     → { ativo, pct_escritorio }
 *  - GET /api/comissao-faturamento/relatorio  → linhas de pedido_faturamentos (conferência com as fábricas
 *                                               e base do relatório de representantes)
 */
const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');
const comFat = require('../config/comissao-faturamento');
const { canAccessAllVendors } = require('../config/vendedor-visibilidade');

function _soAdmin(req, res) {
  if (req.user?.perfil != 1) {
    res.status(403).json({ error: 'Só o administrador pode aplicar a comissão por faturamento nos pedidos já faturados.' });
    return false;
  }
  return true;
}

router.get('/config', async (req, res) => {
  try {
    const cfg = await comFat.getComissaoFatConfig(getPool(), req);
    res.json({
      ativo: cfg.ativo,
      pct_escritorio: cfg.pctEscritorio,
      pode_aplicar: req.user?.perfil == 1,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/aplicar-faturados/resumo', async (req, res) => {
  try {
    if (!_soAdmin(req, res)) return;
    const pool = getPool();
    const cfg = await comFat.getComissaoFatConfig(pool, req);
    if (!cfg.ativo) {
      return res.status(400).json({ error: 'A comissão por faturamento não está habilitada para o CNPJ desta empresa.' });
    }
    const resumo = await comFat.prepararAplicacaoLegado(pool, req);
    res.json(resumo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/aplicar-faturados', async (req, res) => {
  try {
    if (!_soAdmin(req, res)) return;
    const out = await comFat.aplicarPedidosJaFaturados(getPool(), req);
    res.json(out);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/reverter-faturados/resumo', async (req, res) => {
  try {
    if (!_soAdmin(req, res)) return;
    const pool = getPool();
    const cfg = await comFat.getComissaoFatConfig(pool, req);
    if (!cfg.ativo) {
      return res.status(400).json({ error: 'A comissão por faturamento não está habilitada para o CNPJ desta empresa.' });
    }
    const resumo = await comFat.prepararReversaoLegado(pool, req);
    res.json(resumo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/reverter-faturados', async (req, res) => {
  try {
    if (!_soAdmin(req, res)) return;
    const out = await comFat.reverterPedidosJaFaturados(getPool(), req);
    res.json(out);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/relatorio', async (req, res) => {
  try {
    const pool = getPool();
    await comFat.ensureComissaoFaturamentoSchema(pool);
    const q = req.query || {};
    const where = [`pf.excluido = 'N'`];
    const params = [];

    const isoRe = /^\d{4}-\d{2}-\d{2}$/;
    if (isoRe.test(q.dt_ini || '')) { where.push('pf.data_faturamento >= ?'); params.push(q.dt_ini); }
    if (isoRe.test(q.dt_fim || '')) { where.push('pf.data_faturamento <= ?'); params.push(q.dt_fim); }
    if (parseInt(q.id_fornecedor, 10)) { where.push('pf.cod_fornecedor = ?'); params.push(parseInt(q.id_fornecedor, 10)); }
    if (parseInt(q.cod_cliente, 10)) { where.push('pf.cod_cliente = ?'); params.push(parseInt(q.cod_cliente, 10)); }

    // Sem acesso a todos os vendedores → só os próprios faturamentos
    let idRep = parseInt(q.id_representante, 10) || null;
    if (!canAccessAllVendors(req)) idRep = parseInt(req.user?.id, 10) || -1;
    if (idRep) { where.push('pf.id_representante = ?'); params.push(idRep); }

    if (q.nf) { where.push('(pf.numeronf LIKE ? OR pf.nf_fabrica LIKE ?)'); params.push(`%${q.nf}%`, `%${q.nf}%`); }

    const [rows] = await pool.query(
      `SELECT pf.id, pf.id_pedido, pf.numpedido, pf.data_faturamento, pf.numeronf, pf.nf_fabrica,
              pf.vlr_pedido, pf.saldo_anterior, pf.vlr_faturado, pf.diferenca, pf.destino_diferenca,
              pf.pct_comissao_pedido, pf.pct_comissao, pf.vlr_comissao,
              pf.pct_escritorio, pf.vlr_escritorio, pf.pct_representante, pf.vlr_representante,
              pf.cod_fornecedor, pf.cod_cliente, pf.id_representante,
              COALESCE(f.nome, p.nome_fornecedor, '') AS fabrica,
              COALESCE(c.nome, c.apelido, p.nome_cliente, '') AS cliente,
              COALESCE(u.nomeusu, p.nome_vendedor, '') AS representante,
              pc.status AS status_comissao_rep
         FROM pedido_faturamentos pf
         LEFT JOIN pedidos p       ON p.id = pf.id_pedido
         LEFT JOIN fornecedores f  ON f.id = pf.cod_fornecedor
         LEFT JOIN clientes c      ON c.id = pf.cod_cliente
         LEFT JOIN usuarios u      ON u.idusuario = pf.id_representante
         LEFT JOIN pagtocomissao pc ON pc.id_faturamento = pf.id AND COALESCE(pc.excluido,'N') = 'N'
        WHERE ${where.join(' AND ')}
        ORDER BY pf.data_faturamento, fabrica, pf.id
        LIMIT 5000`,
      params
    );

    const tot = rows.reduce((t, r) => {
      t.faturado += parseFloat(r.vlr_faturado) || 0;
      t.comissao += parseFloat(r.vlr_comissao) || 0;
      t.escritorio += parseFloat(r.vlr_escritorio) || 0;
      t.representante += parseFloat(r.vlr_representante) || 0;
      if (r.destino_diferenca === 'SALDO') t.saldo += parseFloat(r.diferenca) || 0;
      if (r.destino_diferenca === 'CANCELADA') t.cancelado += parseFloat(r.diferenca) || 0;
      return t;
    }, { faturado: 0, comissao: 0, escritorio: 0, representante: 0, saldo: 0, cancelado: 0 });
    for (const k of Object.keys(tot)) tot[k] = comFat.round2(tot[k]);

    res.json({ rows, totais: tot, limitado: rows.length >= 5000, so_proprio: !canAccessAllVendors(req) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
