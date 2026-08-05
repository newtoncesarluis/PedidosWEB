const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');
const {
  resolveVendedorIdForFilter,
  buildPedidosVendedorWhereSync,
  isVendedorVisivel,
} = require('../config/vendedor-visibilidade');

/** VISITA | PROSPECT | COMPROMISSO | PENDENCIA */
function normalizeTipoAgenda(t) {
  const u = String(t || 'COMPROMISSO').toUpperCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (u === 'PROSPECT') return 'PROSPECT';
  if (u === 'PENDENCIA') return 'PENDENCIA';
  if (u === 'COMPROMISSO') return 'COMPROMISSO';
  if (u === 'VISITA') return 'VISITA';
  return 'COMPROMISSO';
}

/** Nome exibido na lista/calendário (cliente OU título OU contato). */
const SQL_NOME_AGENDA = `COALESCE(
  NULLIF(TRIM(c.nome), ''),
  NULLIF(TRIM(v.titulo), ''),
  NULLIF(TRIM(v.contato_nome), ''),
  '(sem título)'
) AS nome_cliente`;

function parseAgendaBody(body) {
  const idCliente = body.id_cliente ? String(body.id_cliente).trim() : null;
  // Sem tipo explícito: com cliente = VISITA; sem cliente = COMPROMISSO
  // (evita a tela de clientes falhar pedindo assunto/contato)
  const tipoExplicit = body.tipo != null && String(body.tipo).trim() !== '';
  const tipo = tipoExplicit
    ? normalizeTipoAgenda(body.tipo)
    : (idCliente ? 'VISITA' : 'COMPROMISSO');
  const titulo = String(body.titulo || '').trim().slice(0, 150) || null;
  const contatoNome = String(body.contato_nome || '').trim().slice(0, 150) || null;
  const contatoFone = String(body.contato_fone || '').trim().slice(0, 30) || null;
  return { tipo, idCliente: idCliente || null, titulo, contatoNome, contatoFone };
}

function validarAgendaPayload({ tipo, idCliente, titulo, contatoNome }) {
  if (tipo === 'VISITA' && !idCliente) {
    return 'Selecione o cliente para a visita';
  }
  if ((tipo === 'PROSPECT' || tipo === 'COMPROMISSO' || tipo === 'PENDENCIA') && !titulo && !contatoNome) {
    return 'Informe o assunto ou o nome do contato';
  }
  return null;
}

// --- Listar Motivos ---
router.get('/motivos', async (req, res) => {
  try {
    const pool = getPool();
    // Delphi: «exluido»; web nova: «excluido»
    let rows = [];
    try {
      [rows] = await pool.query(
        `SELECT id, descricao FROM motivo_visitas
         WHERE (excluido='N' OR excluido IS NULL) AND status='A'
         ORDER BY descricao ASC`
      );
    } catch (e1) {
      if (!/Unknown column .*excluido/i.test(e1.message || '')) throw e1;
      [rows] = await pool.query(
        `SELECT id, descricao FROM motivo_visitas
         WHERE (exluido='N' OR exluido IS NULL) AND status='A'
         ORDER BY descricao ASC`
      );
    }
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
    const { q, status, id_vendedor, data_de, data_ate, tipo, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const conds = ["v.exluido = 'N'"];
    const params = [];

    if (q) {
      conds.push('(c.nome LIKE ? OR c.apelido LIKE ? OR v.titulo LIKE ? OR v.contato_nome LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (status) { conds.push('v.status = ?'); params.push(status); }
    if (tipo) {
      const t = normalizeTipoAgenda(tipo);
      conds.push("UPPER(COALESCE(v.tipo, 'VISITA')) = ?");
      params.push(t);
    }

    const vendScope = buildPedidosVendedorWhereSync(req, id_vendedor, 'v.id_vendedor');
    if (vendScope.clause) {
      conds.push(vendScope.clause.replace(/^ AND /, ''));
      params.push(...vendScope.params);
    }

    if (data_de) { conds.push('v.data_visita >= ?'); params.push(data_de); }
    if (data_ate) { conds.push('v.data_visita <= ?'); params.push(data_ate); }

    const where = 'WHERE ' + conds.join(' AND ');

    let total = 0;
    let rows = [];
    try {
      [[{ total }]] = await pool.query(
        `SELECT COUNT(*) as total FROM visitas v LEFT JOIN clientes c ON c.id = v.id_cliente ${where}`,
        params
      );
      [rows] = await pool.query(
        `SELECT v.*, ${SQL_NOME_AGENDA}, c.cidade, c.uf,
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
    } catch (e) {
      // Bases sem titulo/contato_nome ainda: fallback legado
      if (!/Unknown column/i.test(e.message || '')) throw e;
      const conds2 = ["v.exluido = 'N'"];
      const params2 = [];
      if (q) { conds2.push('(c.nome LIKE ? OR c.apelido LIKE ?)'); params2.push(`%${q}%`, `%${q}%`); }
      if (status) { conds2.push('v.status = ?'); params2.push(status); }
      if (vendScope.clause) {
        conds2.push(vendScope.clause.replace(/^ AND /, ''));
        params2.push(...vendScope.params);
      }
      if (data_de) { conds2.push('v.data_visita >= ?'); params2.push(data_de); }
      if (data_ate) { conds2.push('v.data_visita <= ?'); params2.push(data_ate); }
      const where2 = 'WHERE ' + conds2.join(' AND ');
      [[{ total }]] = await pool.query(
        `SELECT COUNT(*) as total FROM visitas v LEFT JOIN clientes c ON c.id = v.id_cliente ${where2}`,
        params2
      );
      [rows] = await pool.query(
        `SELECT v.*, c.nome as nome_cliente, c.cidade, c.uf,
                m.descricao as motivo_desc, u.nomeusu as nome_vendedor
         FROM visitas v
         LEFT JOIN clientes c ON c.id = v.id_cliente
         LEFT JOIN motivo_visitas m ON m.id = v.id_motivo
         LEFT JOIN usuarios u ON u.idusuario = v.id_vendedor
         ${where2}
         ORDER BY v.data_visita DESC, v.hora_visita DESC
         LIMIT ? OFFSET ?`,
        [...params2, parseInt(limit), offset]
      );
    }

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
    const agenda = parseAgendaBody(body);
    const errValid = validarAgendaPayload(agenda);
    if (errValid) return res.status(400).json({ error: errValid });

    if (agenda.idCliente) {
      const { assertUsuarioPodeAcessarCliente } = require('../config/carteira-politica');
      const { getPrepostoContext } = require('../config/vendedor-visibilidade');
      const prepCtx = await getPrepostoContext(pool, req);
      const check = await assertUsuarioPodeAcessarCliente(pool, agenda.idCliente, req.user, prepCtx);
      if (!check.ok) {
        return res.status(check.status || 403).json({ error: check.error });
      }
    }

    const [controleRows] = await pool.query("SELECT LPAD(IFNULL(MAX(CAST(controle AS UNSIGNED)), 0) + 1, 6, '0') as Ultimo FROM visitas");
    const controle = controleRows[0].Ultimo;

    const dtAtual = new Date().toISOString().slice(0,10);
    const hrAtual = new Date().toTimeString().slice(0,8);

    const baseCols = [
      'controle', 'data_abertura', 'hora_abertura', 'user_abertura',
      'id_vendedor', 'id_cliente', 'id_motivo', 'status', 'tipo', 'origem_atendimento',
      'obs', 'data_visita', 'hora_visita', 'data_finaliza', 'hora_finaliza', 'user_finaliza',
    ];
    const baseVals = [
      controle, dtAtual, hrAtual, userId,
      body.id_vendedor || null, agenda.idCliente, body.id_motivo || null,
      body.status || 'ABERTA', agenda.tipo, body.origem || 'WEB',
      body.obs || '', body.data_visita, body.hora_visita || '08:00:00',
      body.status === 'FINALIZADA' ? dtAtual : null,
      body.status === 'FINALIZADA' ? hrAtual : null,
      body.status === 'FINALIZADA' ? userId : null,
    ];

    async function insertVisita(extraCols, extraVals) {
      const cols = [...baseCols, ...extraCols];
      const vals = [...baseVals, ...extraVals];
      const ph = cols.map(() => '?').join(', ');
      const [result] = await pool.query(
        `INSERT INTO visitas (${cols.join(', ')}) VALUES (${ph})`,
        vals
      );
      return result.insertId;
    }

    let idPrincipal;
    try {
      idPrincipal = await insertVisita(
        ['titulo', 'contato_nome', 'contato_fone'],
        [agenda.titulo, agenda.contatoNome, agenda.contatoFone]
      );
    } catch (e) {
      if (!/Unknown column/i.test(e.message || '')) throw e;
      idPrincipal = await insertVisita([], []);
    }

    if (body.nova_data_visita) {
      const [controleRows2] = await pool.query("SELECT LPAD(IFNULL(MAX(CAST(controle AS UNSIGNED)), 0) + 1, 6, '0') as Ultimo FROM visitas");
      const controle2 = controleRows2[0].Ultimo;
      const vals2 = [
        controle2, dtAtual, hrAtual, userId,
        body.id_vendedor || null, agenda.idCliente, body.id_motivo || null,
        'ABERTA', agenda.tipo, body.origem || 'WEB',
        body.obs_nova || '', body.nova_data_visita, body.nova_hora_visita || '08:00:00',
        null, null, null,
      ];
      try {
        await pool.query(
          `INSERT INTO visitas (
            controle, data_abertura, hora_abertura, user_abertura,
            id_vendedor, id_cliente, id_motivo, status, tipo, origem_atendimento,
            obs, data_visita, hora_visita, data_finaliza, hora_finaliza, user_finaliza,
            titulo, contato_nome, contato_fone
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [...vals2, agenda.titulo, agenda.contatoNome, agenda.contatoFone]
        );
      } catch (e2) {
        if (!/Unknown column/i.test(e2.message || '')) throw e2;
        await pool.query(
          `INSERT INTO visitas (
            controle, data_abertura, hora_abertura, user_abertura,
            id_vendedor, id_cliente, id_motivo, status, tipo, origem_atendimento,
            obs, data_visita, hora_visita, data_finaliza, hora_finaliza, user_finaliza
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          vals2
        );
      }
    }

    if (agenda.idCliente) {
      await pool.query(
        "UPDATE clientes SET atividades = 'S', atividades_reiniciada = 'S' WHERE id = ?",
        [agenda.idCliente]
      ).catch(() => {});
    }

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
    const { hojeIsoBrasil, horaBrasil } = require('../config/date-brasil');
    const dtAtual = hojeIsoBrasil();
    const hrAtual = horaBrasil();
    const userId = req.user?.idusuario || req.user?.id || '1';
    const body = req.body || {};
    const resultado = body.resultado ? String(body.resultado).toUpperCase() : null;
    const motivo = body.motivo_resultado || body.motivo_nao_compra || null;
    const conversa = body.conversa || body.obs || null;

    // Tenta com colunas novas; fallback só status se a base ainda não migrou
    try {
      await pool.query(
        `UPDATE visitas SET status='FINALIZADA', data_finaliza=?, hora_finaliza=?, user_finaliza=?,
         resultado=COALESCE(?, resultado), motivo_resultado=COALESCE(?, motivo_resultado),
         conversa=COALESCE(?, conversa)
         WHERE id=?`,
        [dtAtual, hrAtual, userId, resultado, motivo, conversa, req.params.id]
      );
    } catch {
      await pool.query(
        `UPDATE visitas SET status='FINALIZADA', data_finaliza=?, hora_finaliza=?, user_finaliza=? WHERE id=?`,
        [dtAtual, hrAtual, userId, req.params.id]
      );
    }

    // Se informou resultado/conversa, grava também no diário do cliente
    if (resultado || conversa || motivo) {
      try {
        const [[v]] = await pool.query(
          `SELECT id_cliente, id_vendedor, data_visita, hora_visita FROM visitas WHERE id=? LIMIT 1`,
          [req.params.id]
        );
        if (v?.id_cliente) {
          const diarioSvc = require('../modules/clientes/sub/diario.service');
          await diarioSvc.criarEntrada(v.id_cliente, {
            tipo: resultado === 'NAO_COMPROU' ? 'NAO_COMPRA' : 'VISITA',
            resultado: resultado || 'SEM_DECISAO',
            motivo_nao_compra: motivo,
            conversa,
            assunto: 'Visita finalizada',
            data_evento: v.data_visita || dtAtual,
            hora_evento: v.hora_visita || hrAtual,
            id_vendedor: v.id_vendedor,
            id_visita: req.params.id,
          }, req.user, pool);
        }
      } catch (e) {
        console.warn('[visitas/finalizar→diario]', e.message);
      }
    }

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
    const agenda = parseAgendaBody(body);
    // Valida só quando o front envia tipo (formulário novo). PUT legado (só data/obs) não quebra.
    if (body.tipo != null && body.tipo !== '') {
      const errValid = validarAgendaPayload(agenda);
      if (errValid) return res.status(400).json({ error: errValid });
    }
    if (agenda.idCliente) {
      const { assertUsuarioPodeAcessarCliente } = require('../config/carteira-politica');
      const { getPrepostoContext } = require('../config/vendedor-visibilidade');
      const prepCtx = await getPrepostoContext(pool, req);
      const check = await assertUsuarioPodeAcessarCliente(pool, agenda.idCliente, req.user, prepCtx);
      if (!check.ok) {
        return res.status(check.status || 403).json({ error: check.error });
      }
    }

    const dtFinaliza = body.status === 'FINALIZADA' ? new Date().toISOString().slice(0,10) : null;
    const hrFinaliza = body.status === 'FINALIZADA' ? new Date().toTimeString().slice(0,8) : null;
    const userFinaliza = body.status === 'FINALIZADA' ? userId : null;
    const atualizaAgenda = body.tipo != null || body.titulo !== undefined
      || body.contato_nome !== undefined || body.contato_fone !== undefined
      || ('id_cliente' in body);

    try {
      if (atualizaAgenda) {
        await pool.query(
          `UPDATE visitas SET id_motivo=?, obs=?, data_visita=?, hora_visita=?, status=?,
           data_finaliza=?, hora_finaliza=?, user_finaliza=?,
           tipo=?, id_cliente=?, titulo=?, contato_nome=?, contato_fone=?
           WHERE id=?`,
          [
            body.id_motivo || null, body.obs || '', body.data_visita, body.hora_visita || '08:00:00',
            body.status || 'ABERTA', dtFinaliza, hrFinaliza, userFinaliza,
            agenda.tipo, agenda.idCliente, agenda.titulo, agenda.contatoNome, agenda.contatoFone,
            req.params.id,
          ]
        );
      } else {
        await pool.query(
          `UPDATE visitas SET id_motivo=?, obs=?, data_visita=?, hora_visita=?, status=?,
           data_finaliza=?, hora_finaliza=?, user_finaliza=? WHERE id=?`,
          [body.id_motivo, body.obs || '', body.data_visita, body.hora_visita || '08:00:00',
           body.status || 'ABERTA', dtFinaliza, hrFinaliza, userFinaliza, req.params.id]
        );
      }
    } catch (e) {
      if (!/Unknown column/i.test(e.message || '')) throw e;
      await pool.query(
        `UPDATE visitas SET id_motivo=?, obs=?, data_visita=?, hora_visita=?, status=?,
         data_finaliza=?, hora_finaliza=?, user_finaliza=? WHERE id=?`,
        [body.id_motivo, body.obs || '', body.data_visita, body.hora_visita || '08:00:00',
         body.status || 'ABERTA', dtFinaliza, hrFinaliza, userFinaliza, req.params.id]
      );
    }
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
    let rows;
    try {
      [rows] = await pool.query(
        `SELECT v.*, ${SQL_NOME_AGENDA}, c.cidade, c.uf,
                m.descricao as motivo_desc, u.nomeusu as nome_vendedor
         FROM visitas v
         LEFT JOIN clientes c ON c.id = v.id_cliente
         LEFT JOIN motivo_visitas m ON m.id = v.id_motivo
         LEFT JOIN usuarios u ON u.idusuario = v.id_vendedor
         WHERE v.id = ?`,
        [req.params.id]
      );
    } catch (e) {
      if (!/Unknown column/i.test(e.message || '')) throw e;
      [rows] = await pool.query(
        `SELECT v.*, c.nome as nome_cliente, c.cidade, c.uf,
                m.descricao as motivo_desc, u.nomeusu as nome_vendedor
         FROM visitas v
         LEFT JOIN clientes c ON c.id = v.id_cliente
         LEFT JOIN motivo_visitas m ON m.id = v.id_motivo
         LEFT JOIN usuarios u ON u.idusuario = v.id_vendedor
         WHERE v.id = ?`,
        [req.params.id]
      );
    }
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
    const visivel = await isVendedorVisivel(pool, req, req.params.id_vendedor);
    if (!visivel) return res.status(403).json({ error: 'Sem permissão para ver as atividades deste vendedor' });
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
