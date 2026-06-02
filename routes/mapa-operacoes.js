'use strict';

const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');
const { geocodeEndereco } = require('./geocoding');

const STATUS_LABELS = {
  VISITADO: 'Cliente visitado',
  PENDENTE: 'Visita pendente',
  EM_ANDAMENTO: 'Visita em andamento',
  CANCELADA: 'Visita cancelada ou não realizada',
  PROSPECT: 'Prospect em acompanhamento',
};

const FUNIL_LABEL = {
  NOVO: 'Novo', CONTATO: 'Contato', QUALIFICADO: 'Qualificado',
  PROPOSTA: 'Proposta', GANHO: 'Ganho', PERDIDO: 'Perdido',
};

function isAdmin(user) {
  return user?.perfil === '1' || user?.role === 'admin';
}

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

/** Prioriza status de rota em campo e agenda comercial */
function derivarStatus(row, dataRef) {
  const rota = String(row.status_rota || '').toUpperCase();
  const agenda = String(row.status_visita_agenda || '').toUpperCase();
  const rotaGeral = String(row.status_rota_geral || '').toUpperCase();

  if (['VISITADO', 'PEDIDO_REALIZADO'].includes(rota)) return 'VISITADO';
  if (agenda === 'FINALIZADA') return 'VISITADO';

  if (['NAO_ENCONTRADO', 'CANCELADO'].includes(rota) || agenda === 'CANCELADA') return 'CANCELADA';

  if (rotaGeral === 'EM_ANDAMENTO' && (rota === 'PENDENTE' || !rota)) return 'EM_ANDAMENTO';
  if (agenda === 'ABERTA' && String(row.data_visita || '').slice(0, 10) === dataRef) return 'EM_ANDAMENTO';
  if (rota === 'REAGENDAR') return 'PENDENTE';

  return 'PENDENTE';
}

function ultimaAtualizacao(row) {
  if (row.data_hora_checkin) return row.data_hora_checkin;
  if (row.data_finaliza) {
    const h = row.hora_finaliza ? String(row.hora_finaliza).slice(0, 8) : '00:00:00';
    return `${String(row.data_finaliza).slice(0, 10)}T${h}`;
  }
  if (row.data_visita) {
    const h = row.hora_visita ? String(row.hora_visita).slice(0, 8) : '00:00:00';
    return `${String(row.data_visita).slice(0, 10)}T${h}`;
  }
  return null;
}

function prioridadeStatus(a, b) {
  const ordem = { EM_ANDAMENTO: 4, PENDENTE: 3, VISITADO: 2, CANCELADA: 1 };
  return (ordem[a] || 0) - (ordem[b] || 0);
}

let _visitasFiltroCache = null;

/** Filtro de visitas ativas conforme colunas existentes na tabela (varia por base legada). */
async function filtroVisitasAtivas(pool, alias = 'v') {
  if (_visitasFiltroCache !== null) return _visitasFiltroCache;

  try {
    const [cols] = await pool.query('SHOW COLUMNS FROM visitas');
    const names = new Set(cols.map(c => c.Field));
    if (names.has('excluido')) {
      _visitasFiltroCache = `AND (${alias}.excluido = 'N' OR ${alias}.excluido IS NULL)`;
    } else if (names.has('exluido')) {
      _visitasFiltroCache = `AND (${alias}.exluido = 'N' OR ${alias}.exluido IS NULL)`;
    } else if (names.has('dataexclusao')) {
      _visitasFiltroCache = `AND ${alias}.dataexclusao IS NULL`;
    } else {
      _visitasFiltroCache = '';
    }
  } catch {
    _visitasFiltroCache = '';
  }
  return _visitasFiltroCache;
}

let _leadsGeoOk = null;

async function leadsTemGeo(pool) {
  if (_leadsGeoOk !== null) return _leadsGeoOk;
  try {
    const [cols] = await pool.query('SHOW COLUMNS FROM leads');
    const names = new Set(cols.map(c => c.Field));
    _leadsGeoOk = names.has('latitude') && names.has('longitude');
  } catch {
    _leadsGeoOk = false;
  }
  return _leadsGeoOk;
}

async function buscarMarcadoresLeads(pool, { dataRef, idVendedor, q }) {
  if (!(await leadsTemGeo(pool))) return [];

  const params = [dataRef, dataRef, dataRef];
  const where = [
    `l.excluido = 'N'`,
    `l.convertido_cliente_id IS NULL`,
    `l.status_funil NOT IN ('GANHO', 'PERDIDO')`,
    `l.latitude IS NOT NULL AND l.latitude != ''`,
    `l.longitude IS NOT NULL AND l.longitude != ''`,
    `(
      l.data_proximo_contato = ?
      OR DATE(l.data_ultimo_contato) = ?
      OR DATE(l.dtcadastro) = ?
    )`,
  ];

  if (idVendedor) {
    where.push('l.id_vendedor = ?');
    params.push(idVendedor);
  }
  if (q) {
    where.push('(l.nome LIKE ? OR l.empresa LIKE ? OR l.cidade LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }

  const [rows] = await pool.query(`
    SELECT
      l.id AS id_lead,
      l.nome,
      l.empresa,
      l.endereco,
      l.bairro,
      l.cidade,
      l.uf,
      l.latitude,
      l.longitude,
      l.id_vendedor,
      l.status_funil,
      l.data_proximo_contato,
      l.data_ultimo_contato,
      l.dtalterado,
      u.nomeusu AS nome_vendedor
    FROM leads l
    LEFT JOIN usuarios u ON u.idusuario = l.id_vendedor AND u.excluido = 'N'
    WHERE ${where.join(' AND ')}
    ORDER BY l.nome
    LIMIT 500
  `, params).catch(() => [[]]);

  return (rows || []).map((row) => {
    const funil = String(row.status_funil || 'NOVO').toUpperCase();
    const funilLbl = FUNIL_LABEL[funil] || funil;
    const atualizado = row.data_ultimo_contato || row.dtalterado || row.data_proximo_contato;
    return {
      tipo: 'prospect',
      id_lead: row.id_lead,
      id_marcador: `lead-${row.id_lead}`,
      nome: row.nome,
      apelido: row.empresa || null,
      endereco: [row.endereco, row.bairro].filter(Boolean).join(', '),
      cidade: row.cidade,
      uf: row.uf,
      latitude: parseFloat(row.latitude),
      longitude: parseFloat(row.longitude),
      id_vendedor: row.id_vendedor,
      nome_vendedor: row.nome_vendedor,
      status_mapa: 'PROSPECT',
      status_label: `${STATUS_LABELS.PROSPECT} · ${funilLbl}`,
      status_funil: funil,
      data_proximo_contato: row.data_proximo_contato,
      ultima_atualizacao: atualizado,
    };
  });
}

/** Última posição GPS por vendedor (check-in de rota no dia). */
async function buscarPosicaoVendedores(pool, dataRef, idVendedor) {
  try {
    const params = [dataRef];
    let extra = '';
    if (idVendedor) {
      extra = ' AND rv.id_usuario = ?';
      params.push(idVendedor);
    }
    const [rows] = await pool.query(`
      SELECT
        rv.id_usuario AS id_vendedor,
        u.nomeusu AS nome_vendedor,
        rvc.latitude_checkin AS latitude,
        rvc.longitude_checkin AS longitude,
        rvc.data_hora_checkin AS ultimo_checkin,
        c.nome AS cliente_checkin,
        rvc.status_visita,
        rv.descricao AS descricao_rota
      FROM rota_vendedor_cliente rvc
      INNER JOIN rota_vendedor rv ON rv.id = rvc.id_rota AND rv.excluido = 'N' AND rv.data_prevista = ?
      INNER JOIN clientes c ON c.id = rvc.id_cliente
      LEFT JOIN usuarios u ON u.idusuario = rv.id_usuario AND u.excluido = 'N'
      WHERE rvc.latitude_checkin IS NOT NULL
        AND rvc.longitude_checkin IS NOT NULL
        AND rvc.data_hora_checkin IS NOT NULL
        ${extra}
      ORDER BY rvc.data_hora_checkin DESC
      LIMIT 500
    `, params);

    const porVendedor = new Map();
    for (const row of rows) {
      const id = row.id_vendedor;
      if (!id || porVendedor.has(id)) continue;
      porVendedor.set(id, {
        tipo: 'vendedor',
        id_vendedor: id,
        id_marcador: `vend-${id}`,
        nome: row.nome_vendedor || `Vendedor #${id}`,
        latitude: parseFloat(row.latitude),
        longitude: parseFloat(row.longitude),
        ultimo_checkin: row.ultimo_checkin,
        cliente_checkin: row.cliente_checkin,
        status_visita: row.status_visita,
        descricao_rota: row.descricao_rota,
        status_label: 'Posição do vendedor',
      });
    }
    return Array.from(porVendedor.values());
  } catch {
    return [];
  }
}

async function listarPendentesGeoDia(pool, dataRef, idVendedor, filtroVisita) {
  const pendentes = { clientes: [], leads: [] };

  try {
    const pSem = [dataRef, dataRef];
    const wSem = [
      `(c.excluido = 'N' OR c.excluido IS NULL)`,
      `(c.latitude IS NULL OR c.latitude = '' OR c.longitude IS NULL OR c.longitude = '')`,
      `(v.id IS NOT NULL OR rvc.id IS NOT NULL)`,
    ];
    if (idVendedor) {
      wSem.push(`(v.id_vendedor = ? OR rv.id_usuario = ? OR c.cod_vendedor = ?)`);
      pSem.push(idVendedor, idVendedor, idVendedor);
    }
    const [cliRows] = await pool.query(`
      SELECT DISTINCT c.id, c.nome, c.cidade, c.uf, c.endereco, c.cep
      FROM clientes c
      LEFT JOIN visitas v ON v.id_cliente = c.id AND v.data_visita = ? ${filtroVisita}
      LEFT JOIN rota_vendedor_cliente rvc ON rvc.id_cliente = c.id
      LEFT JOIN rota_vendedor rv ON rv.id = rvc.id_rota AND rv.data_prevista = ? AND rv.excluido = 'N'
      WHERE ${wSem.join(' AND ')}
      ORDER BY c.nome
      LIMIT 40
    `, pSem);
    pendentes.clientes = cliRows || [];
  } catch (_) {
    try {
      const p2 = [dataRef];
      let w2 = `(c.excluido = 'N' OR c.excluido IS NULL) AND (c.latitude IS NULL OR c.latitude = '') AND v.id IS NOT NULL`;
      if (idVendedor) { w2 += ' AND (v.id_vendedor = ? OR c.cod_vendedor = ?)'; p2.push(idVendedor, idVendedor); }
      const [cliRows] = await pool.query(`
        SELECT DISTINCT c.id, c.nome, c.cidade, c.uf, c.endereco, c.cep
        FROM clientes c
        LEFT JOIN visitas v ON v.id_cliente = c.id AND v.data_visita = ? ${filtroVisita}
        WHERE ${w2}
        ORDER BY c.nome LIMIT 40
      `, p2);
      pendentes.clientes = cliRows || [];
    } catch (_) {}
  }

  if (await leadsTemGeo(pool)) {
    try {
      const pL = [dataRef, dataRef, dataRef];
      const wL = [
        `l.excluido = 'N'`,
        `l.convertido_cliente_id IS NULL`,
        `l.status_funil NOT IN ('GANHO', 'PERDIDO')`,
        `(l.latitude IS NULL OR l.latitude = '' OR l.longitude IS NULL OR l.longitude = '')`,
        `(l.data_proximo_contato = ? OR DATE(l.data_ultimo_contato) = ? OR DATE(l.dtcadastro) = ?)`,
      ];
      if (idVendedor) { wL.push('l.id_vendedor = ?'); pL.push(idVendedor); }
      const [leadRows] = await pool.query(`
        SELECT l.id, l.nome, l.empresa, l.cidade, l.uf, l.endereco, l.cep, l.bairro
        FROM leads l
        WHERE ${wL.join(' AND ')}
        ORDER BY l.nome
        LIMIT 40
      `, pL);
      pendentes.leads = leadRows || [];
    } catch (_) {}
  }

  return pendentes;
}

// ─── GET /api/mapa-operacoes ─────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    const filtroVisita = await filtroVisitasAtivas(pool, 'v');
    const user = req.user || {};
    const dataRef = (req.query.data || hojeISO()).slice(0, 10);
    const statusFiltro = req.query.status ? String(req.query.status).toUpperCase() : '';
    const tipo = String(req.query.tipo || 'todos').toLowerCase();
    const q = String(req.query.q || '').trim();
    const idVendedorParam = req.query.id_vendedor ? parseInt(req.query.id_vendedor, 10) : null;

    let idVendedor = idVendedorParam;
    if (!isAdmin(user)) {
      idVendedor = user.idusuario || user.id || idVendedor;
    }

    const porCliente = new Map();
    let rows = [];

    if (tipo !== 'prospects') {
    const params = [dataRef, dataRef];
    const where = [
      `(c.excluido = 'N' OR c.excluido IS NULL)`,
      `c.latitude IS NOT NULL AND c.latitude != ''`,
      `c.longitude IS NOT NULL AND c.longitude != ''`,
      `(v.id IS NOT NULL OR rvc.id IS NOT NULL)`,
    ];

    if (idVendedor) {
      where.push(`(
        v.id_vendedor = ? OR rv.id_usuario = ? OR c.cod_vendedor = ?
      )`);
      params.push(idVendedor, idVendedor, idVendedor);
    }

    if (q) {
      where.push(`(c.nome LIKE ? OR c.apelido LIKE ? OR c.cidade LIKE ?)`);
      const like = `%${q}%`;
      params.push(like, like, like);
    }

    const sql = `
      SELECT
        c.id AS id_cliente,
        c.nome,
        c.apelido,
        c.endereco,
        c.bairro,
        c.cidade,
        c.uf,
        c.latitude,
        c.longitude,
        c.cod_vendedor,
        COALESCE(uv.nomeusu, uv2.nomeusu) AS nome_vendedor,
        v.id AS id_visita,
        v.status AS status_visita_agenda,
        v.data_visita,
        v.hora_visita,
        v.data_finaliza,
        v.hora_finaliza,
        v.id_vendedor AS id_vendedor_visita,
        rvc.status_visita AS status_rota,
        rvc.data_hora_checkin,
        rvc.observacao AS obs_rota,
        rv.id AS id_rota,
        rv.descricao AS descricao_rota,
        rv.status AS status_rota_geral,
        rv.data_prevista
      FROM clientes c
      LEFT JOIN visitas v
        ON v.id_cliente = c.id
        AND v.data_visita = ?
        ${filtroVisita}
      LEFT JOIN rota_vendedor_cliente rvc ON rvc.id_cliente = c.id
      LEFT JOIN rota_vendedor rv
        ON rv.id = rvc.id_rota
        AND rv.data_prevista = ?
        AND rv.excluido = 'N'
      LEFT JOIN usuarios uv ON uv.idusuario = v.id_vendedor AND uv.excluido = 'N'
      LEFT JOIN usuarios uv2 ON uv2.idusuario = COALESCE(rv.id_usuario, c.cod_vendedor) AND uv2.excluido = 'N'
      WHERE ${where.join(' AND ')}
      ORDER BY c.nome
      LIMIT 2000
    `;

    try {
      [rows] = await pool.query(sql, params);
    } catch (err) {
      if (!/rota_vendedor/i.test(err.message)) throw err;
      const sqlFallback = `
        SELECT
          c.id AS id_cliente,
          c.nome, c.apelido, c.endereco, c.bairro, c.cidade, c.uf,
          c.latitude, c.longitude, c.cod_vendedor,
          uv.nomeusu AS nome_vendedor,
          v.id AS id_visita,
          v.status AS status_visita_agenda,
          v.data_visita, v.hora_visita,
          v.data_finaliza, v.hora_finaliza,
          v.id_vendedor AS id_vendedor_visita,
          NULL AS status_rota, NULL AS data_hora_checkin, NULL AS obs_rota,
          NULL AS id_rota, NULL AS descricao_rota, NULL AS status_rota_geral, NULL AS data_prevista
        FROM clientes c
        LEFT JOIN visitas v
          ON v.id_cliente = c.id AND v.data_visita = ? ${filtroVisita}
        LEFT JOIN usuarios uv ON uv.idusuario = v.id_vendedor AND uv.excluido = 'N'
        WHERE (c.excluido = 'N' OR c.excluido IS NULL)
          AND c.latitude IS NOT NULL AND c.latitude != ''
          AND c.longitude IS NOT NULL AND c.longitude != ''
          AND v.id IS NOT NULL
          ${idVendedor ? 'AND (v.id_vendedor = ? OR c.cod_vendedor = ?)' : ''}
          ${q ? 'AND (c.nome LIKE ? OR c.apelido LIKE ? OR c.cidade LIKE ?)' : ''}
        ORDER BY c.nome
        LIMIT 2000
      `;
      const p2 = [dataRef];
      if (idVendedor) p2.push(idVendedor, idVendedor);
      if (q) { const like = `%${q}%`; p2.push(like, like, like); }
      [rows] = await pool.query(sqlFallback, p2);
    }

    for (const row of rows) {
      const id = row.id_cliente;
      const status = derivarStatus(row, dataRef);
      const atualizado = ultimaAtualizacao(row);
      const existente = porCliente.get(id);

      if (!existente) {
        porCliente.set(id, {
          tipo: 'cliente',
          id_cliente: id,
          nome: row.nome,
          apelido: row.apelido,
          endereco: [row.endereco, row.bairro].filter(Boolean).join(', '),
          cidade: row.cidade,
          uf: row.uf,
          latitude: parseFloat(row.latitude),
          longitude: parseFloat(row.longitude),
          id_vendedor: row.id_vendedor_visita || row.cod_vendedor,
          nome_vendedor: row.nome_vendedor,
          status_mapa: status,
          status_label: STATUS_LABELS[status],
          id_visita: row.id_visita,
          id_rota: row.id_rota,
          descricao_rota: row.descricao_rota,
          status_visita_agenda: row.status_visita_agenda,
          status_rota: row.status_rota,
          hora_visita: row.hora_visita,
          ultima_atualizacao: atualizado,
          observacao: row.obs_rota || null,
        });
        continue;
      }

      if (prioridadeStatus(status, existente.status_mapa) > 0) {
        existente.status_mapa = status;
        existente.status_label = STATUS_LABELS[status];
      }
      if (atualizado && (!existente.ultima_atualizacao || new Date(atualizado) > new Date(existente.ultima_atualizacao))) {
        existente.ultima_atualizacao = atualizado;
      }
      if (row.id_visita) existente.id_visita = row.id_visita;
      if (row.id_rota) existente.id_rota = row.id_rota;
      if (row.descricao_rota) existente.descricao_rota = row.descricao_rota;
    }
    }

    let marcadoresClientes = Array.from(porCliente.values());
    for (const m of marcadoresClientes) {
      m.id_marcador = `cli-${m.id_cliente}`;
    }

    let marcadoresLeads = [];
    if (tipo !== 'clientes') {
      marcadoresLeads = await buscarMarcadoresLeads(pool, { dataRef, idVendedor, q });
    }

    let marcadores = tipo === 'clientes'
      ? marcadoresClientes
      : tipo === 'prospects'
        ? marcadoresLeads
        : [...marcadoresClientes, ...marcadoresLeads];

    const resumo = {
      total: marcadores.length,
      visitado: 0,
      pendente: 0,
      em_andamento: 0,
      cancelada: 0,
      prospect: marcadoresLeads.length,
      clientes: marcadoresClientes.length,
    };
    for (const m of marcadoresClientes) {
      if (m.status_mapa === 'VISITADO') resumo.visitado++;
      else if (m.status_mapa === 'PENDENTE') resumo.pendente++;
      else if (m.status_mapa === 'EM_ANDAMENTO') resumo.em_andamento++;
      else if (m.status_mapa === 'CANCELADA') resumo.cancelada++;
    }

    if (statusFiltro) {
      marcadores = marcadores.filter(m => m.status_mapa === statusFiltro);
    }

    // Clientes com visita/rota no dia mas sem coordenadas
    let semGeo = 0;
    let semGeoLeads = 0;
    try {
      const pSem = [dataRef, dataRef];
      const wSem = [
        `(c.excluido = 'N' OR c.excluido IS NULL)`,
        `(c.latitude IS NULL OR c.latitude = '' OR c.longitude IS NULL OR c.longitude = '')`,
        `(v.id IS NOT NULL OR rvc.id IS NOT NULL)`,
      ];
      if (idVendedor) {
        wSem.push(`(v.id_vendedor = ? OR rv.id_usuario = ? OR c.cod_vendedor = ?)`);
        pSem.push(idVendedor, idVendedor, idVendedor);
      }
      const [[{ total }]] = await pool.query(`
        SELECT COUNT(DISTINCT c.id) AS total
        FROM clientes c
        LEFT JOIN visitas v ON v.id_cliente = c.id AND v.data_visita = ? ${filtroVisita}
        LEFT JOIN rota_vendedor_cliente rvc ON rvc.id_cliente = c.id
        LEFT JOIN rota_vendedor rv ON rv.id = rvc.id_rota AND rv.data_prevista = ? AND rv.excluido = 'N'
        WHERE ${wSem.join(' AND ')}
      `, pSem);
      semGeo = Number(total) || 0;
    } catch (_) {
      try {
        const p2 = [dataRef];
        let w2 = `(c.excluido = 'N' OR c.excluido IS NULL) AND (c.latitude IS NULL OR c.latitude = '') AND v.id IS NOT NULL`;
        if (idVendedor) { w2 += ' AND (v.id_vendedor = ? OR c.cod_vendedor = ?)'; p2.push(idVendedor, idVendedor); }
        const [[r2]] = await pool.query(`
          SELECT COUNT(DISTINCT c.id) AS total FROM clientes c
          LEFT JOIN visitas v ON v.id_cliente = c.id AND v.data_visita = ? ${filtroVisita}
          WHERE ${w2}
        `, p2);
        semGeo = Number(r2?.total) || 0;
      } catch (_) {}
    }

    if (await leadsTemGeo(pool)) {
      try {
        const pL = [dataRef, dataRef, dataRef];
        const wL = [
          `l.excluido = 'N'`,
          `l.convertido_cliente_id IS NULL`,
          `l.status_funil NOT IN ('GANHO', 'PERDIDO')`,
          `(l.latitude IS NULL OR l.latitude = '' OR l.longitude IS NULL OR l.longitude = '')`,
          `(l.data_proximo_contato = ? OR DATE(l.data_ultimo_contato) = ? OR DATE(l.dtcadastro) = ?)`,
        ];
        if (idVendedor) { wL.push('l.id_vendedor = ?'); pL.push(idVendedor); }
        const [[{ total: tL }]] = await pool.query(`
          SELECT COUNT(*) AS total FROM leads l WHERE ${wL.join(' AND ')}
        `, pL);
        semGeoLeads = Number(tL) || 0;
      } catch (_) {}
    }

    const vendedores = await buscarPosicaoVendedores(pool, dataRef, idVendedor);
    const pendentes_lista = await listarPendentesGeoDia(pool, dataRef, idVendedor, filtroVisita);

    res.json({
      data: dataRef,
      marcadores,
      resumo,
      sem_geo: semGeo,
      sem_geo_leads: semGeoLeads,
      vendedores,
      pendentes_lista,
      atualizado_em: new Date().toISOString(),
      status_labels: STATUS_LABELS,
    });
  } catch (err) {
    console.error('Erro mapa-operacoes:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/mapa-operacoes/processar-geo ──────────────────────────────────
router.post('/processar-geo', async (req, res) => {
  try {
    const pool = getPool();
    const filtroVisita = await filtroVisitasAtivas(pool, 'v');
    const dataRef = (req.body?.data || hojeISO()).slice(0, 10);
    const tipo = String(req.body?.tipo || 'ambos').toLowerCase();
    const limite = Math.min(parseInt(req.body?.limite || 10, 10), 20);
    const idVendedor = req.body?.id_vendedor ? parseInt(req.body.id_vendedor, 10) : null;

    const resultado = { clientes: { ok: 0, falha: 0 }, leads: { ok: 0, falha: 0 } };

    if (tipo === 'clientes' || tipo === 'ambos') {
      const { clientes } = await listarPendentesGeoDia(pool, dataRef, idVendedor, filtroVisita);
      for (const c of clientes.slice(0, limite)) {
        await new Promise(r => setTimeout(r, 1050));
        const coords = await geocodeEndereco(c.endereco, c.cidade, c.uf, c.cep);
        if (coords) {
          try {
            await pool.query(
              `UPDATE clientes SET latitude = ?, longitude = ?, dtalterado = NOW() WHERE id = ?`,
              [coords.lat, coords.lng, c.id]
            );
            resultado.clientes.ok++;
          } catch { resultado.clientes.falha++; }
        } else {
          resultado.clientes.falha++;
        }
      }
    }

    if ((tipo === 'leads' || tipo === 'ambos') && await leadsTemGeo(pool)) {
      const { leads } = await listarPendentesGeoDia(pool, dataRef, idVendedor, filtroVisita);
      for (const l of leads.slice(0, limite)) {
        await new Promise(r => setTimeout(r, 1050));
        const endLead = [l.endereco, l.bairro].filter(Boolean).join(', ');
        const coords = await geocodeEndereco(endLead, l.cidade, l.uf, l.cep);
        if (coords) {
          try {
            await pool.query(
              `UPDATE leads SET latitude = ?, longitude = ?, dtalterado = NOW() WHERE id = ?`,
              [coords.lat, coords.lng, l.id]
            );
            resultado.leads.ok++;
          } catch { resultado.leads.falha++; }
        } else {
          resultado.leads.falha++;
        }
      }
    }

    res.json({ ok: true, resultado });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
