const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');

// --- Listar Motivos ---
router.get('/motivos', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query("SELECT id, descricao FROM motivo_visitas ORDER BY descricao ASC");
    res.json(rows);
  } catch (err) {
    // Caso a tabela não exista, retorna um fallback
    console.error('Erro ao buscar motivos:', err);
    res.json([{ id: 1, descricao: 'Visita de Rotina' }, { id: 2, descricao: 'Prospecção' }, { id: 3, descricao: 'Cobrança' }]);
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
      WHERE v.id_cliente = ?
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
    
    // Gerar próximo controle
    const [controleRows] = await pool.query("SELECT LPAD(IFNULL(MAX(CAST(controle AS UNSIGNED)), 0) + 1, 6, '0') as Ultimo FROM visitas");
    const controle = controleRows[0].Ultimo;
    
    const dtAtual = new Date().toISOString().slice(0,10);
    const hrAtual = new Date().toTimeString().slice(0,8);
    
    // Insere a visita principal
    const q = `
      INSERT INTO visitas (
        controle, data_abertura, hora_abertura, user_abertura,
        id_vendedor, id_cliente, id_motivo, status, tipo, origem_atendimento,
        obs, data_visita, hora_visita, data_finaliza, hora_finaliza, user_finaliza
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const params = [
      controle, dtAtual, hrAtual, body.id_usuario || '1',
      body.id_vendedor, body.id_cliente, body.id_motivo, body.status || 'ABERTA', 'VISITA', body.origem || 'WEB',
      body.obs || '', body.data_visita, body.hora_visita,
      body.status === 'FINALIZADA' ? dtAtual : null,
      body.status === 'FINALIZADA' ? hrAtual : null,
      body.status === 'FINALIZADA' ? (body.id_usuario || '1') : null
    ];
    
    const [result] = await pool.query(q, params);
    const idPrincipal = result.insertId;

    // Se houver agendamento futuro
    if (body.nova_data_visita) {
      const [controleRows2] = await pool.query("SELECT LPAD(IFNULL(MAX(CAST(controle AS UNSIGNED)), 0) + 1, 6, '0') as Ultimo FROM visitas");
      const controle2 = controleRows2[0].Ultimo;
      
      const params2 = [
        controle2, dtAtual, hrAtual, body.id_usuario || '1',
        body.id_vendedor, body.id_cliente, body.id_motivo, 'ABERTA', 'VISITA', body.origem || 'WEB',
        body.obs_nova || '', body.nova_data_visita, body.nova_hora_visita || '08:00:00',
        null, null, null
      ];
      await pool.query(q, params2);
    }
    
    // Marcar cliente com atividades ativas
    await pool.query("UPDATE clientes SET atividades = 'S', atividades_reiniciada = 'S' WHERE id = ?", [body.id_cliente]);

    res.json({ ok: true, id: idPrincipal });
  } catch (err) {
    console.error('Erro ao cadastrar visita:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Finalizar Atividade ---
router.put('/:id/finalizar', async (req, res) => {
  try {
    const pool = getPool();
    const dtAtual = new Date().toISOString().slice(0,10);
    const hrAtual = new Date().toTimeString().slice(0,8);
    
    const userId = req.user?.idusuario || req.user?.id || '1';

    await pool.query(`
      UPDATE visitas 
      SET status = 'FINALIZADA', data_finaliza = ?, hora_finaliza = ?, user_finaliza = ?
      WHERE id = ?
    `, [dtAtual, hrAtual, userId, req.params.id]);
    
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
      WHERE v.id_vendedor = ? AND v.data_visita <= ? AND v.status = 'ABERTA'
      ORDER BY v.data_visita ASC, v.hora_visita ASC
    `, [req.params.id_vendedor, dtAtual]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
