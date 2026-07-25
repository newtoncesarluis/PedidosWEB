'use strict';

const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');
const { permCrud, negarCad } = require('../config/cadastros-permissoes');
const {
  ensureCartoesSchema,
  datasFaturaCompetencia,
} = require('../config/cartoes-schema');
const { hojeIsoBrasil } = require('../config/date-brasil');

const _perm = (req) => permCrud(req, {
  incluir: 'incluir_cartoes',
  alterar: 'alterar_cartoes',
  excluir: 'excluir_cartoes',
});

function clampDia(v, def) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(28, Math.max(1, n));
}

// GET /api/cartoes
router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    await ensureCartoesSchema(pool);
    const status = req.query.status || 'A';
    let where = `(excluido='N' OR excluido IS NULL OR excluido='')`;
    const vals = [];
    if (status === 'A' || status === 'I') {
      where += ` AND status=?`;
      vals.push(status);
    }
    if (req.query.q) {
      where += ` AND (LOWER(descricao) LIKE ? OR LOWER(COALESCE(bandeira,'')) LIKE ?)`;
      const like = `%${String(req.query.q).toLowerCase()}%`;
      vals.push(like, like);
    }
    const [rows] = await pool.query(
      `SELECT * FROM cartoes_corporativos WHERE ${where} ORDER BY descricao`,
      vals
    );
    res.json({ cartoes: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cartoes/:id
router.get('/:id', async (req, res) => {
  try {
    const pool = getPool();
    await ensureCartoesSchema(pool);
    const [rows] = await pool.query(
      `SELECT * FROM cartoes_corporativos WHERE id=? AND (excluido='N' OR excluido IS NULL)`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Cartão não encontrado' });
    const [faturas] = await pool.query(
      `SELECT * FROM cartao_faturas WHERE id_cartao=? AND excluido='N' ORDER BY competencia DESC LIMIT 24`,
      [req.params.id]
    );
    res.json({ ...rows[0], faturas });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cartoes
router.post('/', async (req, res) => {
  const pc = _perm(req);
  if (pc.incluir !== 'S') return negarCad(res, 'Sem permissão para incluir cartões');
  try {
    const pool = getPool();
    await ensureCartoesSchema(pool);
    const b = req.body || {};
    if (!String(b.descricao || '').trim()) {
      return res.status(400).json({ error: 'Descrição é obrigatória' });
    }
    const [r] = await pool.query(
      `INSERT INTO cartoes_corporativos
        (descricao, bandeira, ultimos4, dia_fechamento, dia_vencimento,
         id_banco, id_despesas, id_planoconta, id_centrocusto, status, excluido)
       VALUES (?,?,?,?,?,?,?,?,?,'A','N')`,
      [
        String(b.descricao).trim().toUpperCase(),
        b.bandeira ? String(b.bandeira).trim().toUpperCase() : null,
        b.ultimos4 ? String(b.ultimos4).replace(/\D/g, '').slice(-4) : null,
        clampDia(b.dia_fechamento, 1),
        clampDia(b.dia_vencimento, 10),
        parseInt(b.id_banco, 10) || null,
        parseInt(b.id_despesas, 10) || null,
        parseInt(b.id_planoconta, 10) || null,
        parseInt(b.id_centrocusto, 10) || null,
      ]
    );
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/cartoes/:id
router.put('/:id', async (req, res) => {
  const pc = _perm(req);
  if (pc.alterar !== 'S') return negarCad(res, 'Sem permissão para alterar cartões');
  try {
    const pool = getPool();
    await ensureCartoesSchema(pool);
    const b = req.body || {};
    if (!String(b.descricao || '').trim()) {
      return res.status(400).json({ error: 'Descrição é obrigatória' });
    }
    await pool.query(
      `UPDATE cartoes_corporativos SET
        descricao=?, bandeira=?, ultimos4=?, dia_fechamento=?, dia_vencimento=?,
        id_banco=?, id_despesas=?, id_planoconta=?, id_centrocusto=?, status=?
       WHERE id=?`,
      [
        String(b.descricao).trim().toUpperCase(),
        b.bandeira ? String(b.bandeira).trim().toUpperCase() : null,
        b.ultimos4 ? String(b.ultimos4).replace(/\D/g, '').slice(-4) : null,
        clampDia(b.dia_fechamento, 1),
        clampDia(b.dia_vencimento, 10),
        parseInt(b.id_banco, 10) || null,
        parseInt(b.id_despesas, 10) || null,
        parseInt(b.id_planoconta, 10) || null,
        parseInt(b.id_centrocusto, 10) || null,
        b.status === 'I' ? 'I' : 'A',
        req.params.id,
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/cartoes/:id
router.delete('/:id', async (req, res) => {
  const pc = _perm(req);
  if (pc.excluir !== 'S') return negarCad(res, 'Sem permissão para excluir cartões');
  try {
    const pool = getPool();
    await ensureCartoesSchema(pool);
    await pool.query(`UPDATE cartoes_corporativos SET excluido='S', status='I' WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cartoes/:id/faturas/:fid/lancamentos
router.get('/:id/faturas/:fid/lancamentos', async (req, res) => {
  try {
    const pool = getPool();
    await ensureCartoesSchema(pool);
    const [rows] = await pool.query(
      `SELECT * FROM cartao_lancamentos WHERE id_fatura=? AND excluido='N' ORDER BY data_compra, id`,
      [req.params.fid]
    );
    res.json({ lancamentos: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cartoes/:id/faturas — abre/obtém fatura da competência
router.post('/:id/faturas', async (req, res) => {
  const pc = _perm(req);
  if (pc.alterar !== 'S' && pc.incluir !== 'S') {
    return negarCad(res, 'Sem permissão para gerenciar faturas');
  }
  try {
    const pool = getPool();
    await ensureCartoesSchema(pool);
    const [[cartao]] = await pool.query(
      `SELECT * FROM cartoes_corporativos WHERE id=? AND excluido='N'`,
      [req.params.id]
    );
    if (!cartao) return res.status(404).json({ error: 'Cartão não encontrado' });

    let comp = String(req.body?.competencia || '').trim();
    if (!/^\d{4}-\d{2}$/.test(comp)) {
      const hoje = hojeIsoBrasil();
      comp = hoje.slice(0, 7);
    }
    const datas = datasFaturaCompetencia(comp, cartao.dia_fechamento, cartao.dia_vencimento);

    const [exist] = await pool.query(
      `SELECT * FROM cartao_faturas WHERE id_cartao=? AND competencia=? AND excluido='N'`,
      [req.params.id, comp]
    );
    if (exist.length) return res.json({ ok: true, fatura: exist[0] });

    const [ins] = await pool.query(
      `INSERT INTO cartao_faturas
        (id_cartao, competencia, data_fechamento, data_vencimento, valor_total, status, excluido)
       VALUES (?,?,?,?,0,'ABERTA','N')`,
      [req.params.id, comp, datas.data_fechamento, datas.data_vencimento]
    );
    const [[fatura]] = await pool.query(`SELECT * FROM cartao_faturas WHERE id=?`, [ins.insertId]);
    res.status(201).json({ ok: true, fatura });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cartoes/:id/faturas/:fid/lancamentos
router.post('/:id/faturas/:fid/lancamentos', async (req, res) => {
  const pc = _perm(req);
  if (pc.alterar !== 'S' && pc.incluir !== 'S') {
    return negarCad(res, 'Sem permissão para lançar no cartão');
  }
  try {
    const pool = getPool();
    await ensureCartoesSchema(pool);
    const [[fat]] = await pool.query(
      `SELECT * FROM cartao_faturas WHERE id=? AND id_cartao=? AND excluido='N'`,
      [req.params.fid, req.params.id]
    );
    if (!fat) return res.status(404).json({ error: 'Fatura não encontrada' });
    if (fat.status === 'GERADA' || fat.id_pagar) {
      return res.status(400).json({ error: 'Fatura já gerada no Contas a Pagar — não aceite novos lançamentos' });
    }
    const b = req.body || {};
    const valor = parseFloat(b.valor);
    if (!b.descricao?.trim() || !Number.isFinite(valor) || valor <= 0) {
      return res.status(400).json({ error: 'Informe descrição e valor válidos' });
    }
    const dataCompra = String(b.data_compra || hojeIsoBrasil()).slice(0, 10);
    const [ins] = await pool.query(
      `INSERT INTO cartao_lancamentos
        (id_fatura, data_compra, descricao, valor, parcela, qt_parcelas, excluido)
       VALUES (?,?,?,?,?,?, 'N')`,
      [
        fat.id,
        dataCompra,
        String(b.descricao).trim().toUpperCase(),
        valor,
        parseInt(b.parcela, 10) || 1,
        parseInt(b.qt_parcelas, 10) || 1,
      ]
    );
    await pool.query(
      `UPDATE cartao_faturas SET valor_total = (
         SELECT COALESCE(SUM(valor),0) FROM cartao_lancamentos WHERE id_fatura=? AND excluido='N'
       ) WHERE id=?`,
      [fat.id, fat.id]
    );
    res.status(201).json({ ok: true, id: ins.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE lançamento
router.delete('/:id/faturas/:fid/lancamentos/:lid', async (req, res) => {
  const pc = _perm(req);
  if (pc.alterar !== 'S') return negarCad(res, 'Sem permissão');
  try {
    const pool = getPool();
    await ensureCartoesSchema(pool);
    const [[fat]] = await pool.query(
      `SELECT * FROM cartao_faturas WHERE id=? AND id_cartao=? AND excluido='N'`,
      [req.params.fid, req.params.id]
    );
    if (!fat) return res.status(404).json({ error: 'Fatura não encontrada' });
    if (fat.id_pagar) return res.status(400).json({ error: 'Fatura já gerada — não altere lançamentos' });
    await pool.query(`UPDATE cartao_lancamentos SET excluido='S' WHERE id=? AND id_fatura=?`, [
      req.params.lid, fat.id,
    ]);
    await pool.query(
      `UPDATE cartao_faturas SET valor_total = (
         SELECT COALESCE(SUM(valor),0) FROM cartao_lancamentos WHERE id_fatura=? AND excluido='N'
       ) WHERE id=?`,
      [fat.id, fat.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Gera título no Contas a Pagar a partir da fatura (não altera lógica de baixa).
 * POST /api/cartoes/:id/faturas/:fid/gerar-pagar
 */
router.post('/:id/faturas/:fid/gerar-pagar', async (req, res) => {
  const pc = _perm(req);
  if (pc.alterar !== 'S' && pc.incluir !== 'S') {
    return negarCad(res, 'Sem permissão para gerar no Contas a Pagar');
  }
  try {
    const pool = getPool();
    await ensureCartoesSchema(pool);
    const [[cartao]] = await pool.query(
      `SELECT * FROM cartoes_corporativos WHERE id=? AND excluido='N'`,
      [req.params.id]
    );
    if (!cartao) return res.status(404).json({ error: 'Cartão não encontrado' });
    const [[fat]] = await pool.query(
      `SELECT * FROM cartao_faturas WHERE id=? AND id_cartao=? AND excluido='N'`,
      [req.params.fid, req.params.id]
    );
    if (!fat) return res.status(404).json({ error: 'Fatura não encontrada' });
    if (fat.id_pagar) {
      return res.status(400).json({ error: `Fatura já possui título a pagar #${fat.id_pagar}` });
    }
    if (!(parseFloat(fat.valor_total) > 0)) {
      return res.status(400).json({ error: 'Fatura sem lançamentos / valor zerado' });
    }

    // Reutiliza criação via HTTP interno seria complexo — INSERT direto espelhando pagar.js
    const { ensureFinanceiroContabilCols } = require('../config/plano-contas-schema');
    await ensureFinanceiroContabilCols(pool);

    const [[maxRow]] = await pool.query(`SELECT COALESCE(MAX(numero),0)+1 AS n FROM pagar`).catch(() => [[{ n: 1 }]]);
    const numero = maxRow?.n || 1;
    const doc = 'P' + String(numero).padStart(6, '0');
    const vlr = parseFloat(fat.valor_total);
    const obs = `CARTÃO DE CRÉDITO · ${cartao.descricao} · Fat. ${fat.competencia}`
      + (cartao.ultimos4 ? ` · ****${cartao.ultimos4}` : '');

    let despesasTxt = 'CARTÃO DE CRÉDITO';
    if (cartao.id_despesas) {
      const [[d]] = await pool.query(
        `SELECT COALESCE(nome, descricao) AS n FROM despesas WHERE id=? LIMIT 1`,
        [cartao.id_despesas]
      ).catch(() => [[null]]);
      if (d?.n) despesasTxt = d.n;
    }

    const [ins] = await pool.query(
      `INSERT INTO pagar (
        numero, tipo, vencimento, valor, valor_pagar, vlrcomjuros, status, obs, doc, numeronf,
        prazo, parcela, forma_pagto, qt_parcelas, historico_rec, cond_pagto,
        cod_fornecedor, nome_fornecedor, data_lanc, id_natureza,
        id_despesas, despesas, cod_vendedor, data_pagto, vlrpago,
        forma_foipagto, juros, vlrjuros, vrljuros, vlracressimo,
        id_planoconta, id_centrocusto, excluido
      ) VALUES (?, 'PAGAR', STR_TO_DATE(?, '%Y-%m-%d'), ?, ?, ?, 'ABERTA', ?, ?, ?, 1, 1, 'CARTAO', 1, 'PAGAMENTO EFETUADO', 'CARTAO',
        NULL, ?, NOW(), NULL, ?, ?, NULL, NULL, 0, 'DINHEIRO', 0, 0, 0, 0, ?, ?, 'N')`,
      [
        numero, fat.data_vencimento, vlr, vlr, vlr, obs, doc, fat.competencia,
        cartao.descricao,
        cartao.id_despesas || null, despesasTxt,
        cartao.id_planoconta || null, cartao.id_centrocusto || null,
      ]
    );

    await pool.query(
      `UPDATE cartao_faturas SET id_pagar=?, status='GERADA' WHERE id=?`,
      [ins.insertId, fat.id]
    );

    res.json({ ok: true, id_pagar: ins.insertId, numero, doc });
  } catch (err) {
    console.error('[cartoes/gerar-pagar]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
