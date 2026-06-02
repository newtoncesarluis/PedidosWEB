const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');

// --- Listar Motivos ---
router.get('/motivos', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query("SELECT id, descricao FROM motivo_visitas WHERE exluido='N' AND status='A' ORDER BY descricao ASC");
    res.json(rows);
  } catch (err) {
    console.error('Erro ao buscar motivos:', err);
    res.json([{ id: 1, descricao: 'Visita de Rotina' }, { id: 2, descricao: 'Prospecção' }, { id: 3, descricao: 'Cobrança' }]);
  }
});

// --- Listar Todas as Visitas (com filtros) ---
router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    const { q, status, id_vendedor, data_de, data_ate, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const conds = ["v.exluido = 'N'"];
    const params = [];

    if (q) {
      conds.push('(c.nome LIKE ? OR c.apelido LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    if (status) { conds.push('v.status = ?'); params.push(status); }
    if (id_vendedor) { conds.push('v.id_vendedor = ?'); params.push(id_vendedor); }
    if (data_de) { conds.push('v.data_visita >= ?'); params.push(data_de); }
    if (data_ate) { conds.push('v.data_visita <= ?'); params.push(data_ate); }

    const where = 'WHERE ' + conds.join(' AND ');

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM visitas v LEFT JOIN clientes c ON c.id = v.id_cliente ${where}`,
      params
    );

    const [rows] = await pool.query(
      `SELECT v.*, c.nome as nome_cliente, c.cidade, c.uf,
              m.descricao as motivo_desc, u.nomeusu as nome_vendedor
       FROM visitas v
       LEFT JOIN clientes c ON c.id = v.id_cliente
       LEFT JOIN motivo_visitas m ON m.id = v.id_motivo
       LEFT JOIN usuarios u ON u.idusuario = v.id_vendedor
       ${where}
       ORDER BY v.data_visita DESC, v.hora_visita DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    res.json({ total, visitas: rows });
  } catch (err) {
    console.error('Erro ao listar visitas:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Listar Atividades do Cliente ---
router.get('/cliente/:id', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(`
      SELECT v.*, m.descricao as motivo_desc, u.nomeusu as nome_vendedor
      FROM visitas v
      LEFT JOIN motivo_visitas m ON m.id = v.id_motivo
      LEFT JOIN usuarios u ON u.idusuario = v.id_vendedor
      WHERE v.id_cliente = ? AND v.exluido = 'N'
      ORDER BY v.data_visita DESC, v.hora_visita DESC
      LIMIT 50
    `, [req.params.id]);
    res.json(rows);
  } catch (err) {
    console.error('Erro ao buscar visitas:', err);
    res.json([]);
  }
});

// --- Cadastrar Atividade ---
router.post('/', async (req, res) => {
  try {
    const pool = getPool();
    const body = req.body;
    const userId = req.user?.idusuario || req.user?.id || body.id_usuario || '1';

    const [controleRows] = await pool.query("SELECT LPAD(IFNULL(MAX(CAST(controle AS UNSIGNED)), 0) + 1, 6, '0') as Ultimo FROM visitas");
    const controle = controleRows[0].Ultimo;

    const dtAtual = new Date().toISOString().slice(0,10);
    const hrAtual = new Date().toTimeString().slice(0,8);

    const q = `
      INSERT INTO visitas (
        controle, data_abertura, hora_abertura, user_abertura,
        id_vendedor, id_cliente, id_motivo, status, tipo, origem_atendimento,
        obs, data_visita, hora_visita, data_finaliza, hora_finaliza, user_finaliza
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      controle, dtAtual, hrAtual, userId,
      body.id_vendedor, body.id_cliente, body.id_motivo, body.status || 'ABERTA', 'VISITA', body.origem || 'WEB',
      body.obs || '', body.data_visita, body.hora_visita || '08:00:00',
      body.status === 'FINALIZADA' ? dtAtual : null,
      body.status === 'FINALIZADA' ? hrAtual : null,
      body.status === 'FINALIZADA' ? userId : null
    ];

    const [result] = await pool.query(q, params);
    const idPrincipal = result.insertId;

    if (body.nova_data_visita) {
      const [controleRows2] = await pool.query("SELECT LPAD(IFNULL(MAX(CAST(controle AS UNSIGNED)), 0) + 1, 6, '0') as Ultimo FROM visitas");
      const controle2 = controleRows2[0].Ultimo;
      const params2 = [
        controle2, dtAtual, hrAtual, userId,
        body.id_vendedor, body.id_cliente, body.id_motivo, 'ABERTA', 'VISITA', body.origem || 'WEB',
        body.obs_nova || '', body.nova_data_visita, body.nova_hora_visita || '08:00:00',
        null, null, null
      ];
      await pool.query(q, params2);
    }

    await pool.query("UPDATE clientes SET atividades = 'S', atividades_reiniciada = 'S' WHERE id = ?", [body.id_cliente]).catch(() => {});

    res.json({ ok: true, id: idPrincipal });
  } catch (err) {
    console.error('Erro ao cadastrar visita:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Atualizar Visita ---
router.put('/:id/finalizar', async (req, res) => {
  try {
    const pool = getPool();
    const dtAtual = new Date().toISOString().slice(0,10);
    const hrAtual = new Date().toTimeString().slice(0,8);
    const userId = req.user?.idusuario || req.user?.id || '1';

    await pool.query(
      `UPDATE visitas SET status='FINALIZADA', data_finaliza=?, hora_finaliza=?, user_finaliza=? WHERE id=?`,
      [dtAtual, hrAtual, userId, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const pool = getPool();
    const body = req.body;
    const userId = req.user?.idusuario || req.user?.id || '1';

    const dtFinaliza = body.status === 'FINALIZADA' ? new Date().toISOString().slice(0,10) : null;
    const hrFinaliza = body.status === 'FINALIZADA' ? new Date().toTimeString().slice(0,8) : null;
    const userFinaliza = body.status === 'FINALIZADA' ? userId : null;

    await pool.query(
      `UPDATE visitas SET id_motivo=?, obs=?, data_visita=?, hora_visita=?, status=?,
       data_finaliza=?, hora_finaliza=?, user_finaliza=? WHERE id=?`,
      [body.id_motivo, body.obs || '', body.data_visita, body.hora_visita || '08:00:00',
       body.status || 'ABERTA', dtFinaliza, hrFinaliza, userFinaliza, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Calendário mensal (contagem por dia) ---
router.get('/calendario', async (req, res) => {
  try {
    const pool = getPool();
    const ano  = parseInt(req.query.ano  || new Date().getFullYear());
    const mes  = parseInt(req.query.mes  || new Date().getMonth() + 1);
    const id_vendedor = req.query.id_vendedor || null;
    const user = req.user || {};

    // Intervalo: último dia do mês anterior até primeiro do próximo (cobre semanas parciais)
    const dtDe  = `${ano}-${String(mes).padStart(2,'0')}-01`;
    const last  = new Date(ano, mes, 0).getDate();
    const dtAte = `${ano}-${String(mes).padStart(2,'0')}-${String(last).padStart(2,'0')}`;

    const conds = ["v.exluido='N'", 'v.data_visita BETWEEN ? AND ?'];
    const params = [dtDe, dtAte];

    // não-admin vê só as próprias
    if (user.perfil !== '1' && user.role !== 'admin') {
      const uid = user.idusuario || user.id;
      if (uid) { conds.push('v.id_vendedor=?'); params.push(uid); }
    } else if (id_vendedor) {
      conds.push('v.id_vendedor=?'); params.push(id_vendedor);
    }

    const where = conds.join(' AND ');
    const [rows] = await pool.query(
      `SELECT DATE_FORMAT(v.data_visita,'%Y-%m-%d') AS dia,
              v.status,
              COUNT(*) AS qtd
       FROM visitas v
       WHERE ${where}
       GROUP BY dia, v.status
       ORDER BY dia`,
      params
    );

    // Agrupa: { '2026-05-10': { total:3, ABERTA:2, FINALIZADA:1 } }
    const dias = {};
    for (const r of rows) {
      if (!dias[r.dia]) dias[r.dia] = { total: 0 };
      dias[r.dia][r.status] = (dias[r.dia][r.status] || 0) + Number(r.qtd);
      dias[r.dia].total += Number(r.qtd);
    }

    // KPIs do mês
    const totais = Object.values(dias).reduce((acc, d) => {
      acc.total += d.total;
      acc.abertas    += (d.ABERTA    || 0);
      acc.finalizadas += (d.FINALIZADA || 0);
      acc.canceladas += (d.CANCELADA || 0);
      return acc;
    }, { total:0, abertas:0, finalizadas:0, canceladas:0 });

    res.json({ dias, kpis: totais, ano, mes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Buscar uma visita ---
router.get('/:id', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT v.*, c.nome as nome_cliente, c.cidade, c.uf,
              m.descricao as motivo_desc, u.nomeusu as nome_vendedor
       FROM visitas v
       LEFT JOIN clientes c ON c.id = v.id_cliente
       LEFT JOIN motivo_visitas m ON m.id = v.id_motivo
       LEFT JOIN usuarios u ON u.idusuario = v.id_vendedor
       WHERE v.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Excluir (soft delete) ---
router.delete('/:id', async (req, res) => {
  try {
    const pool = getPool();
    const userId = req.user?.idusuario || req.user?.id || '1';
    const dtAtual = new Date().toISOString().slice(0,10);
    const hrAtual = new Date().toTimeString().slice(0,8);

    await pool.query(
      `UPDATE visitas SET exluido='S', dataexclusao=?, horaexclusao=?, id_userexclusao=? WHERE id=?`,
      [dtAtual, hrAtual, userId, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Listar Atividades do Dia (Home) ---
router.get('/hoje/:id_vendedor', async (req, res) => {
  try {
    const pool = getPool();
    const dtAtual = new Date().toISOString().slice(0,10);
    const [rows] = await pool.query(`
      SELECT v.*, c.nome as nome_cliente, c.endereco, c.bairro, c.cidade, c.uf, c.latitude, c.longitude, m.descricao as motivo_desc
      FROM visitas v
      LEFT JOIN clientes c ON c.id = v.id_cliente
      LEFT JOIN motivo_visitas m ON m.id = v.id_motivo
      WHERE v.id_vendedor = ? AND v.data_visita <= ? AND v.status = 'ABERTA' AND v.exluido = 'N'
      ORDER BY v.data_visita ASC, v.hora_visita ASC
    `, [req.params.id_vendedor, dtAtual]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
