'use strict';

const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');
const { permCrud, negarCad } = require('../config/cadastros-permissoes');
const { ensureChequesSchema } = require('../config/cheques-schema');
const { hojeIsoBrasil } = require('../config/date-brasil');

const _perm = (req) => permCrud(req, {
  incluir: 'incluir_cheques',
  alterar: 'alterar_cheques',
  excluir: 'excluir_cheques',
});

function parseChequeBody(b = {}) {
  const valor = parseFloat(b.valor);
  const numero = String(b.numero || '').trim();
  const bom = String(b.bom_para || '').slice(0, 10);
  if (!numero) return { error: 'Informe o número do cheque' };
  if (!Number.isFinite(valor) || valor <= 0) return { error: 'Informe o valor do cheque' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bom)) return { error: 'Informe a data bom para (YYYY-MM-DD)' };
  return {
    data: {
      tipo: b.tipo === 'R' ? 'R' : 'T',
      numero,
      banco_nome: b.banco_nome ? String(b.banco_nome).trim().toUpperCase() : null,
      agencia: b.agencia ? String(b.agencia).trim() : null,
      conta: b.conta ? String(b.conta).trim() : null,
      emitente: b.emitente ? String(b.emitente).trim().toUpperCase() : null,
      cpf_cnpj: b.cpf_cnpj ? String(b.cpf_cnpj).replace(/\D/g, '') : null,
      valor,
      bom_para: bom,
      data_recebimento: b.data_recebimento
        ? String(b.data_recebimento).slice(0, 10)
        : hojeIsoBrasil(),
      id_receber: parseInt(b.id_receber, 10) || null,
      id_cliente: parseInt(b.id_cliente, 10) || null,
      obs: b.obs ? String(b.obs).trim().slice(0, 255) : null,
    },
  };
}

// GET /api/cheques
router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    await ensureChequesSchema(pool);
    const status = req.query.status || 'EM_CARTEIRA';
    let where = `(c.excluido='N' OR c.excluido IS NULL OR c.excluido='')`;
    const vals = [];
    if (status && status !== 'TODOS') {
      where += ` AND c.status=?`;
      vals.push(status);
    }
    if (req.query.q) {
      where += ` AND (c.numero LIKE ? OR LOWER(COALESCE(c.emitente,'')) LIKE ? OR LOWER(COALESCE(c.banco_nome,'')) LIKE ?)`;
      const like = `%${String(req.query.q).trim()}%`;
      vals.push(like, like.toLowerCase(), like.toLowerCase());
    }
    const [rows] = await pool.query(
      `SELECT c.*,
              COALESCE(NULLIF(TRIM(cli.nome), ''), NULLIF(TRIM(cli.apelido), ''), '') AS cliente_nome,
              forn.nome AS fornecedor_nome
         FROM cheques c
         LEFT JOIN clientes cli ON cli.id = c.id_cliente
         LEFT JOIN fornecedores forn ON forn.id = c.id_fornecedor
        WHERE ${where}
        ORDER BY c.bom_para, c.id
        LIMIT 500`,
      vals
    );
    res.json({ cheques: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cheques/:id
router.get('/:id', async (req, res) => {
  try {
    const pool = getPool();
    await ensureChequesSchema(pool);
    const [rows] = await pool.query(
      `SELECT * FROM cheques WHERE id=? AND excluido='N'`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Cheque não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cheques — entra na carteira (ex.: após receber de cliente)
router.post('/', async (req, res) => {
  const pc = _perm(req);
  if (pc.incluir !== 'S') return negarCad(res, 'Sem permissão para incluir cheques');
  try {
    const pool = getPool();
    await ensureChequesSchema(pool);
    const parsed = parseChequeBody(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const d = parsed.data;
    const [r] = await pool.query(
      `INSERT INTO cheques
        (tipo, numero, banco_nome, agencia, conta, emitente, cpf_cnpj, valor, bom_para,
         data_recebimento, id_receber, id_cliente, status, obs, excluido)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'EM_CARTEIRA',?,'N')`,
      [
        d.tipo, d.numero, d.banco_nome, d.agencia, d.conta, d.emitente, d.cpf_cnpj, d.valor,
        d.bom_para, d.data_recebimento, d.id_receber, d.id_cliente, d.obs,
      ]
    );
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/cheques/:id
router.put('/:id', async (req, res) => {
  const pc = _perm(req);
  if (pc.alterar !== 'S') return negarCad(res, 'Sem permissão para alterar cheques');
  try {
    const pool = getPool();
    await ensureChequesSchema(pool);
    const [[cur]] = await pool.query(`SELECT * FROM cheques WHERE id=? AND excluido='N'`, [req.params.id]);
    if (!cur) return res.status(404).json({ error: 'Cheque não encontrado' });
    if (cur.status === 'USADO_PAGAR' || cur.status === 'COMPENSADO') {
      return res.status(400).json({ error: 'Cheque já utilizado/compensado — não altere' });
    }
    const parsed = parseChequeBody({ ...cur, ...req.body, valor: req.body.valor ?? cur.valor });
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const d = parsed.data;
    await pool.query(
      `UPDATE cheques SET
        numero=?, banco_nome=?, agencia=?, conta=?, emitente=?, cpf_cnpj=?,
        valor=?, bom_para=?, data_recebimento=?, id_cliente=?, obs=?
       WHERE id=?`,
      [
        d.numero, d.banco_nome, d.agencia, d.conta, d.emitente, d.cpf_cnpj,
        d.valor, d.bom_para, d.data_recebimento, d.id_cliente, d.obs, req.params.id,
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Usa cheque da carteira para quitar um título a pagar.
 * POST /api/cheques/:id/usar-pagar  { id_pagar, id_fornecedor? }
 * Não faz a baixa — só vincula; a baixa continua no Contas a Pagar com forma CHEQUE.
 */
router.post('/:id/usar-pagar', async (req, res) => {
  const pc = _perm(req);
  if (pc.alterar !== 'S') return negarCad(res, 'Sem permissão');
  try {
    const pool = getPool();
    await ensureChequesSchema(pool);
    const idPagar = parseInt(req.body?.id_pagar, 10);
    if (!idPagar) return res.status(400).json({ error: 'Informe id_pagar' });

    const [[ch]] = await pool.query(`SELECT * FROM cheques WHERE id=? AND excluido='N'`, [req.params.id]);
    if (!ch) return res.status(404).json({ error: 'Cheque não encontrado' });
    if (ch.status !== 'EM_CARTEIRA') {
      return res.status(400).json({ error: `Cheque não está em carteira (status: ${ch.status})` });
    }

    const [[tit]] = await pool.query(
      `SELECT id, valor, status, nome_fornecedor, cod_fornecedor FROM pagar
        WHERE id=? AND (excluido='N' OR excluido IS NULL)`,
      [idPagar]
    );
    if (!tit) return res.status(404).json({ error: 'Título a pagar não encontrado' });
    if (tit.status === 'LIQUIDADO') {
      return res.status(400).json({ error: 'Título já liquidado' });
    }

    const idForn = parseInt(req.body?.id_fornecedor, 10) || tit.cod_fornecedor || null;

    // Marca cheque; baixa opcional se baixar=true
    await pool.query(
      `UPDATE cheques SET status='USADO_PAGAR', id_pagar=?, id_fornecedor=? WHERE id=?`,
      [idPagar, idForn, ch.id]
    );

    // Grava id_cheque no pagar se a coluna existir
    try {
      const [cols] = await pool.query(`SHOW COLUMNS FROM pagar LIKE 'id_cheque'`);
      if (cols.length) {
        await pool.query(`UPDATE pagar SET id_cheque=? WHERE id=?`, [ch.id, idPagar]);
      }
    } catch (_) {}

    if (req.body?.baixar === true || req.body?.baixar === 'S') {
      await pool.query(
        `UPDATE pagar SET status='LIQUIDADO', data_pagto=?, vlrpago=valor, forma_foipagto='CHEQUE'
          WHERE id=?`,
        [hojeIsoBrasil(), idPagar]
      );
    }

    res.json({
      ok: true,
      id_cheque: ch.id,
      id_pagar: idPagar,
      rastreio: {
        cliente: ch.id_cliente,
        receber: ch.id_receber,
        fornecedor: idForn,
        valor: ch.valor,
        numero: ch.numero,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cheques/:id/status — DEPOSITADO | COMPENSADO | DEVOLVIDO | CANCELADO | EM_CARTEIRA
router.post('/:id/status', async (req, res) => {
  const pc = _perm(req);
  if (pc.alterar !== 'S') return negarCad(res, 'Sem permissão');
  const status = String(req.body?.status || '').toUpperCase();
  const allowed = ['EM_CARTEIRA', 'DEPOSITADO', 'COMPENSADO', 'DEVOLVIDO', 'CANCELADO'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: 'Status inválido' });
  }
  try {
    const pool = getPool();
    await ensureChequesSchema(pool);
    const [[ch]] = await pool.query(`SELECT * FROM cheques WHERE id=? AND excluido='N'`, [req.params.id]);
    if (!ch) return res.status(404).json({ error: 'Cheque não encontrado' });
    if (ch.status === 'USADO_PAGAR' && status !== 'DEVOLVIDO') {
      return res.status(400).json({ error: 'Cheque já usado no pagar — só pode marcar devolvido' });
    }
    await pool.query(`UPDATE cheques SET status=? WHERE id=?`, [status, ch.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE soft
router.delete('/:id', async (req, res) => {
  const pc = _perm(req);
  if (pc.excluir !== 'S') return negarCad(res, 'Sem permissão');
  try {
    const pool = getPool();
    await ensureChequesSchema(pool);
    const [[ch]] = await pool.query(`SELECT * FROM cheques WHERE id=? AND excluido='N'`, [req.params.id]);
    if (!ch) return res.status(404).json({ error: 'Cheque não encontrado' });
    if (ch.status === 'USADO_PAGAR') {
      return res.status(400).json({ error: 'Cheque usado no pagar — cancele o vínculo antes' });
    }
    await pool.query(`UPDATE cheques SET excluido='S', status='CANCELADO' WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
