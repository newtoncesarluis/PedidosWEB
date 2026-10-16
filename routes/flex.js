'use strict';

const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');
const flex = require('../config/flex-pedido');

function _admin(req) {
  return req.user?.perfil == 1 || req.user?.isAdmin;
}

/** Quem pode ver a conta de outro vendedor: admin, gerente comercial ou quem acessa todos os clientes. */
function _veTodos(req) {
  const p = req.user?.permissoes || {};
  return _admin(req) || p.gerentecomercial === 'S' || p.acessartodosclientes === 'S';
}

// GET /api/flex/saldo?cod_fornecedor=&id_usuario=&ignorar_pedido=
// Config da fábrica + saldo atual do vendedor (usado pela tela do pedido).
router.get('/saldo', async (req, res) => {
  try {
    const pool = getPool();
    const codFornecedor = parseInt(req.query.cod_fornecedor, 10);
    if (!codFornecedor) return res.json({ ativo: false });
    let idUsuario = parseInt(req.query.id_usuario, 10) || req.user?.id;
    if (idUsuario !== req.user?.id && !_veTodos(req)) {
      // Quem já abriu um pedido pode ver o saldo do vendedor DAQUELE pedido (ex.: dono fechando pedido da vendedora).
      let ok = false;
      const idPed = parseInt(req.query.ignorar_pedido, 10);
      if (idPed) {
        try {
          const [[pd]] = await pool.query('SELECT id_usuario FROM pedidos WHERE id = ? LIMIT 1', [idPed]);
          ok = !!pd && Number(pd.id_usuario) === idUsuario;
        } catch (_) { /* segue com o usuário logado */ }
      }
      if (!ok) idUsuario = req.user?.id;
    }

    const cfg = await flex.getConfigFornecedor(pool, codFornecedor);
    if (!cfg) return res.json({ ativo: false });
    const saldo = await flex.getSaldo(pool, {
      idUsuario, codFornecedor, validade: cfg.validade,
      ignorarPedido: parseInt(req.query.ignorar_pedido, 10) || null,
    });
    res.json({ ativo: true, saldo, id_usuario: idUsuario, ...cfg });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/flex/extrato?cod_fornecedor=&id_usuario=&de=&ate=
router.get('/extrato', async (req, res) => {
  try {
    const pool = getPool();
    await flex.ensureFlexTable(pool);
    let idUsuario = parseInt(req.query.id_usuario, 10) || req.user?.id;
    if (idUsuario !== req.user?.id && !_veTodos(req)) idUsuario = req.user?.id;
    const params = [idUsuario];
    let where = 'l.id_usuario = ?';
    const codFornecedor = parseInt(req.query.cod_fornecedor, 10);
    if (codFornecedor) { where += ' AND l.cod_fornecedor = ?'; params.push(codFornecedor); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.de || '')) { where += ' AND l.data_lancamento >= ?'; params.push(req.query.de); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.ate || '')) { where += ' AND l.data_lancamento <= ?'; params.push(req.query.ate); }
    const [rows] = await pool.query(
      `SELECT l.id, l.cod_fornecedor, f.nome AS nome_fornecedor, l.id_pedido, l.numero_pedido,
              l.cod_produto, l.descricao, l.valor, l.tipo, l.obs,
              DATE_FORMAT(l.data_lancamento, '%Y-%m-%d') AS data_lancamento
         FROM flex_lancamentos l
         LEFT JOIN fornecedores f ON f.id = l.cod_fornecedor
        WHERE ${where}
        ORDER BY l.data_lancamento DESC, l.id DESC
        LIMIT 500`,
      params
    );
    const total = rows.reduce((s, r) => s + (parseFloat(r.valor) || 0), 0);
    res.json({ rows, total: Math.round(total * 100) / 100 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/flex/config — o que o usuário logado pode fazer na tela de Conta Flex
router.get('/config', (req, res) => {
  res.json({ pode_ver_todos: !!_veTodos(req), pode_ajustar: !!_veTodos(req), id_usuario: req.user?.id });
});

// GET /api/flex/resumo?cod_fornecedor= — saldo por vendedor + fábrica (respeita a validade de cada fábrica)
router.get('/resumo', async (req, res) => {
  try {
    const pool = getPool();
    await flex.ensureFlexTable(pool);
    const params = [flex.inicioValidade('SEMANAL') || '1900-01-01', flex.inicioValidade('MENSAL') || '1900-01-01'];
    let where = '1=1';
    if (!_veTodos(req)) { where += ' AND l.id_usuario = ?'; params.push(req.user?.id); }
    const codFornecedor = parseInt(req.query.cod_fornecedor, 10);
    if (codFornecedor) { where += ' AND l.cod_fornecedor = ?'; params.push(codFornecedor); }
    const [rows] = await pool.query(
      `SELECT l.id_usuario, u.nomeusu AS nome_vendedor, l.cod_fornecedor, f.nome AS nome_fornecedor,
              COALESCE(f.flex_validade,'NUNCA') AS validade,
              ROUND(SUM(CASE WHEN l.data_lancamento >= CASE COALESCE(f.flex_validade,'NUNCA')
                                 WHEN 'SEMANAL' THEN ? WHEN 'MENSAL' THEN ? ELSE '1900-01-01' END
                             THEN l.valor ELSE 0 END), 2) AS saldo,
              ROUND(SUM(CASE WHEN l.valor > 0 THEN l.valor ELSE 0 END), 2) AS creditos_total,
              ROUND(SUM(CASE WHEN l.valor < 0 THEN l.valor ELSE 0 END), 2) AS debitos_total
         FROM flex_lancamentos l
         LEFT JOIN usuarios u ON u.idusuario = l.id_usuario
         LEFT JOIN fornecedores f ON f.id = l.cod_fornecedor
        WHERE ${where}
        GROUP BY l.id_usuario, u.nomeusu, l.cod_fornecedor, f.nome, f.flex_validade
        ORDER BY u.nomeusu, f.nome`,
      params
    );
    res.json({ rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/flex/ajuste — lançamento manual (crédito + / débito −); exige observação
router.post('/ajuste', async (req, res) => {
  try {
    if (!_veTodos(req)) return res.status(403).json({ error: 'Sem permissão para ajustar o flex.' });
    const pool = getPool();
    await flex.ensureFlexTable(pool);
    const idUsuario = parseInt(req.body?.id_usuario, 10);
    const codFornecedor = parseInt(req.body?.cod_fornecedor, 10);
    const valor = Math.round((parseFloat(req.body?.valor) || 0) * 100) / 100;
    const obs = String(req.body?.obs || '').trim().slice(0, 200);
    if (!idUsuario || !codFornecedor) return res.status(400).json({ error: 'Informe o vendedor e a fábrica.' });
    if (!valor) return res.status(400).json({ error: 'Informe um valor diferente de zero.' });
    if (!obs) return res.status(400).json({ error: 'Informe o motivo do ajuste.' });
    const { hojeIsoBrasil } = require('../config/date-brasil');
    const [r] = await pool.query(
      `INSERT INTO flex_lancamentos
         (id_usuario, cod_fornecedor, descricao, valor, tipo, obs, data_lancamento, id_usuario_lanc)
       VALUES (?, ?, 'AJUSTE MANUAL', ?, 'AJUSTE', ?, ?, ?)`,
      [idUsuario, codFornecedor, valor, obs, hojeIsoBrasil(), req.user?.id || null]
    );
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/flex/ajuste/:id — remove só ajuste manual (lançamentos de pedido se corrigem pelo pedido)
router.delete('/ajuste/:id', async (req, res) => {
  try {
    if (!_veTodos(req)) return res.status(403).json({ error: 'Sem permissão para ajustar o flex.' });
    const pool = getPool();
    const [r] = await pool.query(`DELETE FROM flex_lancamentos WHERE id = ? AND tipo = 'AJUSTE'`, [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Ajuste não encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
