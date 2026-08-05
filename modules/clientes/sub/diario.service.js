'use strict';

const { getPool } = require('../../../config/database');
const { hojeIsoBrasil, horaBrasil } = require('../../../config/date-brasil');

const TIPOS = ['VISITA', 'CONTATO', 'NAO_COMPRA', 'ANOTACAO', 'RETORNO'];
const RESULTADOS = ['COMPROU', 'NAO_COMPROU', 'SEM_DECISAO', 'REAGENDAR', 'OUTRO'];

const MOTIVOS_NAO_COMPRA = [
  'Sem estoque / falta produto',
  'Preço / condição',
  'Já comprou da concorrência',
  'Cliente sem caixa',
  'Decisão adiada',
  'Fechado / ausente',
  'Não interessado',
  'Outro',
];

let _ensured = new Set();

async function ensureClienteDiarioTable(pool) {
  const p = pool || getPool();
  let db = '';
  try {
    const [[r]] = await p.query('SELECT DATABASE() AS db');
    db = r?.db || '';
  } catch { /* ok */ }
  const key = db || '_';
  if (_ensured.has(key)) return;
  await p.query(`
    CREATE TABLE IF NOT EXISTS cliente_diario (
      id INT AUTO_INCREMENT PRIMARY KEY,
      cod_cliente INT NOT NULL,
      id_vendedor INT NULL,
      data_evento DATE NOT NULL,
      hora_evento TIME NULL,
      tipo VARCHAR(30) NOT NULL DEFAULT 'CONTATO',
      resultado VARCHAR(30) NULL,
      motivo_nao_compra VARCHAR(200) NULL,
      assunto VARCHAR(200) NULL,
      conversa TEXT NULL,
      id_visita INT NULL,
      id_pedido INT NULL,
      excluido CHAR(1) NOT NULL DEFAULT 'N',
      dtcadastro DATETIME DEFAULT CURRENT_TIMESTAMP,
      id_usuario INT NULL,
      INDEX idx_cd_cliente (cod_cliente),
      INDEX idx_cd_data (data_evento)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  // Colunas extras em visitas (resultado da visita)
  for (const col of [
    { c: 'resultado', t: "VARCHAR(30) NULL" },
    { c: 'motivo_resultado', t: "VARCHAR(200) NULL" },
    { c: 'conversa', t: "TEXT NULL" },
  ]) {
    try {
      const [rows] = await p.query(`SHOW COLUMNS FROM visitas LIKE ?`, [col.c]);
      if (!rows.length) {
        await p.query(`ALTER TABLE visitas ADD COLUMN \`${col.c}\` ${col.t}`);
      }
    } catch { /* tabela visitas pode não existir em bases mínimas */ }
  }
  _ensured.add(key);
}

function _fmtData(v) {
  if (!v) return null;
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s.slice(0, 10);
}

function _fmtHora(v) {
  if (!v) return null;
  const s = String(v);
  return s.length >= 5 ? s.slice(0, 5) : s;
}

/**
 * Timeline unificada: diário manual + visitas + compras (pedidos).
 */
async function listarTimeline(idCliente, pool, opts = {}) {
  const p = pool || getPool();
  await ensureClienteDiarioTable(p);
  const limit = Math.min(parseInt(opts.limit, 10) || 100, 200);
  const items = [];

  // 1) Registros manuais do diário
  try {
    const [rows] = await p.query(
      `SELECT d.*, u.nomeusu AS nome_vendedor
       FROM cliente_diario d
       LEFT JOIN usuarios u ON u.idusuario = d.id_vendedor
       WHERE d.cod_cliente = ? AND (d.excluido = 'N' OR d.excluido IS NULL)
       ORDER BY d.data_evento DESC, d.hora_evento DESC, d.id DESC
       LIMIT ?`,
      [idCliente, limit]
    );
    for (const r of rows) {
      items.push({
        fonte: 'diario',
        id: r.id,
        data: _fmtData(r.data_evento),
        hora: _fmtHora(r.hora_evento),
        tipo: r.tipo || 'CONTATO',
        resultado: r.resultado || null,
        motivo_nao_compra: r.motivo_nao_compra || null,
        assunto: r.assunto || null,
        conversa: r.conversa || null,
        id_visita: r.id_visita || null,
        id_pedido: r.id_pedido || null,
        id_vendedor: r.id_vendedor || null,
        nome_vendedor: r.nome_vendedor || null,
        editavel: true,
      });
    }
  } catch (e) {
    console.error('[diario/listar]', e.message);
  }

  // 2) Visitas do CRM (não duplicar se já houver vínculo no diário)
  const visitasJaLigadas = new Set(
    items.filter((i) => i.id_visita).map((i) => String(i.id_visita))
  );
  try {
    const [rows] = await p.query(
      `SELECT v.id, v.data_visita, v.hora_visita, v.status, v.obs, v.resultado,
              v.motivo_resultado, v.conversa, v.id_vendedor, v.id_motivo,
              m.descricao AS motivo_desc, u.nomeusu AS nome_vendedor
       FROM visitas v
       LEFT JOIN motivo_visitas m ON m.id = v.id_motivo
       LEFT JOIN usuarios u ON u.idusuario = v.id_vendedor
       WHERE v.id_cliente = ?
         AND (v.exluido = 'N' OR v.exluido IS NULL OR v.excluido = 'N')
       ORDER BY v.data_visita DESC, v.hora_visita DESC
       LIMIT ?`,
      [idCliente, limit]
    ).catch(async () => {
      // fallback sem colunas novas / typo excluido
      return p.query(
        `SELECT v.id, v.data_visita, v.hora_visita, v.status, v.obs,
                NULL AS resultado, NULL AS motivo_resultado, NULL AS conversa,
                v.id_vendedor, v.id_motivo,
                m.descricao AS motivo_desc, u.nomeusu AS nome_vendedor
         FROM visitas v
         LEFT JOIN motivo_visitas m ON m.id = v.id_motivo
         LEFT JOIN usuarios u ON u.idusuario = v.id_vendedor
         WHERE v.id_cliente = ?
         ORDER BY v.data_visita DESC, v.hora_visita DESC
         LIMIT ?`,
        [idCliente, limit]
      );
    });
    for (const r of rows) {
      if (visitasJaLigadas.has(String(r.id))) continue;
      items.push({
        fonte: 'visita',
        id: r.id,
        data: _fmtData(r.data_visita),
        hora: _fmtHora(r.hora_visita),
        tipo: 'VISITA',
        resultado: r.resultado || (r.status === 'FINALIZADA' ? 'SEM_DECISAO' : null),
        motivo_nao_compra: r.motivo_resultado || null,
        assunto: r.motivo_desc || 'Visita',
        conversa: r.conversa || r.obs || null,
        status_visita: r.status || null,
        id_visita: r.id,
        id_pedido: null,
        id_vendedor: r.id_vendedor || null,
        nome_vendedor: r.nome_vendedor || null,
        editavel: false,
      });
    }
  } catch (e) {
    console.error('[diario/visitas]', e.message);
  }

  // 3) Compras (pedidos) — só leitura
  try {
    const [rows] = await p.query(
      `SELECT p.id, p.numero, p.data_abertura, p.situacao_pedido, p.tipo_pedido,
              p.vlrtotalcomimposto, p.vlrtotalitens, p.id_usuario,
              f.nome AS nome_fornecedor,
              COALESCE(NULLIF(TRIM(p.nome_vendedor), ''), u.nomeusu) AS nome_vendedor
       FROM pedidos p
       LEFT JOIN fornecedores f ON f.id = p.cod_fornecedor
       LEFT JOIN usuarios u ON u.idusuario = p.id_usuario
       WHERE p.cod_cliente = ?
         AND (p.excluido = 'N' OR p.excluido IS NULL)
       ORDER BY p.data_abertura DESC, p.id DESC
       LIMIT ?`,
      [idCliente, Math.min(limit, 80)]
    );
    for (const r of rows) {
      const valor = Number(r.vlrtotalcomimposto || r.vlrtotalitens || 0);
      items.push({
        fonte: 'pedido',
        id: r.id,
        data: _fmtData(r.data_abertura),
        hora: null,
        tipo: 'COMPRA',
        resultado: 'COMPROU',
        motivo_nao_compra: null,
        assunto: `Pedido ${r.numero || r.id}${r.nome_fornecedor ? ' · ' + r.nome_fornecedor : ''}`,
        conversa: [
          r.tipo_pedido ? `Tipo: ${r.tipo_pedido}` : null,
          r.situacao_pedido ? `Situação: ${r.situacao_pedido}` : null,
          valor ? `Valor: R$ ${valor.toFixed(2).replace('.', ',')}` : null,
        ].filter(Boolean).join(' · '),
        valor,
        numero_pedido: r.numero,
        id_visita: null,
        id_pedido: r.id,
        id_vendedor: r.id_usuario || null,
        nome_vendedor: r.nome_vendedor || null,
        editavel: false,
      });
    }
  } catch (e) {
    console.error('[diario/pedidos]', e.message);
  }

  items.sort((a, b) => {
    const da = `${a.data || ''} ${a.hora || '00:00'}`;
    const db = `${b.data || ''} ${b.hora || '00:00'}`;
    return db.localeCompare(da);
  });

  return {
    itens: items.slice(0, limit),
    motivos_nao_compra: MOTIVOS_NAO_COMPRA,
    tipos: TIPOS,
    resultados: RESULTADOS,
  };
}

async function criarEntrada(idCliente, body, user, pool) {
  const p = pool || getPool();
  await ensureClienteDiarioTable(p);

  const tipo = String(body.tipo || 'CONTATO').toUpperCase();
  if (!TIPOS.includes(tipo)) {
    const err = new Error('Tipo inválido');
    err.statusCode = 400;
    throw err;
  }

  let resultado = body.resultado ? String(body.resultado).toUpperCase() : null;
  if (resultado && !RESULTADOS.includes(resultado)) resultado = 'OUTRO';
  if (tipo === 'NAO_COMPRA' && !resultado) resultado = 'NAO_COMPROU';

  const dataEvento = body.data_evento || hojeIsoBrasil();
  const horaEvento = body.hora_evento || horaBrasil().slice(0, 5) + ':00';
  const idVend = body.id_vendedor || user?.idusuario || user?.id || null;
  const idUser = user?.idusuario || user?.id || null;

  const [result] = await p.query(
    `INSERT INTO cliente_diario
      (cod_cliente, id_vendedor, data_evento, hora_evento, tipo, resultado,
       motivo_nao_compra, assunto, conversa, id_visita, id_pedido, excluido, id_usuario)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'N', ?)`,
    [
      idCliente,
      idVend,
      dataEvento,
      horaEvento,
      tipo,
      resultado,
      body.motivo_nao_compra || null,
      body.assunto || null,
      body.conversa || null,
      body.id_visita || null,
      body.id_pedido || null,
      idUser,
    ]
  );

  // Espelha resultado na visita se vinculada
  if (body.id_visita && (resultado || body.conversa || body.motivo_nao_compra)) {
    await p.query(
      `UPDATE visitas SET resultado=COALESCE(?, resultado),
       motivo_resultado=COALESCE(?, motivo_resultado),
       conversa=COALESCE(?, conversa)
       WHERE id=?`,
      [resultado, body.motivo_nao_compra || null, body.conversa || null, body.id_visita]
    ).catch(() => {});
  }

  return { id: result.insertId };
}

async function atualizarEntrada(idCliente, diarioId, body, pool) {
  const p = pool || getPool();
  await ensureClienteDiarioTable(p);

  const [[row]] = await p.query(
    `SELECT id FROM cliente_diario WHERE id=? AND cod_cliente=? AND (excluido='N' OR excluido IS NULL) LIMIT 1`,
    [diarioId, idCliente]
  );
  if (!row) {
    const err = new Error('Registro não encontrado');
    err.statusCode = 404;
    throw err;
  }

  const campos = [];
  const vals = [];
  const map = {
    data_evento: 'data_evento',
    hora_evento: 'hora_evento',
    tipo: 'tipo',
    resultado: 'resultado',
    motivo_nao_compra: 'motivo_nao_compra',
    assunto: 'assunto',
    conversa: 'conversa',
    id_vendedor: 'id_vendedor',
  };
  for (const [k, col] of Object.entries(map)) {
    if (body[k] !== undefined) {
      let v = body[k];
      if (k === 'tipo') v = String(v).toUpperCase();
      if (k === 'resultado' && v) v = String(v).toUpperCase();
      campos.push(`\`${col}\`=?`);
      vals.push(v);
    }
  }
  if (!campos.length) return { ok: true };
  vals.push(diarioId, idCliente);
  await p.query(
    `UPDATE cliente_diario SET ${campos.join(', ')} WHERE id=? AND cod_cliente=?`,
    vals
  );
  return { ok: true };
}

async function excluirEntrada(idCliente, diarioId, pool) {
  const p = pool || getPool();
  await ensureClienteDiarioTable(p);
  await p.query(
    `UPDATE cliente_diario SET excluido='S' WHERE id=? AND cod_cliente=?`,
    [diarioId, idCliente]
  );
  return { ok: true };
}

module.exports = {
  ensureClienteDiarioTable,
  listarTimeline,
  criarEntrada,
  atualizarEntrada,
  excluirEntrada,
  TIPOS,
  RESULTADOS,
  MOTIVOS_NAO_COMPRA,
};
