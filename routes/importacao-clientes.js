const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');

const CAMPOS_NUMERICOS = new Set(['cod_vendedor', 'limite_credito', 'prazo_pagamento']);

const DEFAULT_CAMPOS = [
  { nome_campo: 'nome',          apelido: 'Nome / Razão Social',    tipo: 'texto',   ordem: 1,  obrigatorio: 'S' },
  { nome_campo: 'apelido',       apelido: 'Apelido / Nome Fantasia', tipo: 'texto',   ordem: 2,  obrigatorio: 'N' },
  { nome_campo: 'cpf',           apelido: 'CPF / CNPJ',             tipo: 'texto',   ordem: 3,  obrigatorio: 'S' },
  { nome_campo: 'rg',            apelido: 'RG / Insc. Estadual',    tipo: 'texto',   ordem: 4,  obrigatorio: 'N' },
  { nome_campo: 'tipo_pessoa',   apelido: 'Tipo Pessoa (F/J)',       tipo: 'texto',   ordem: 5,  obrigatorio: 'N' },
  { nome_campo: 'foneprincipal', apelido: 'Fone Principal',          tipo: 'texto',   ordem: 6,  obrigatorio: 'N' },
  { nome_campo: 'fonesecundario',apelido: 'Fone Secundário',         tipo: 'texto',   ordem: 7,  obrigatorio: 'N' },
  { nome_campo: 'email',         apelido: 'E-mail',                  tipo: 'texto',   ordem: 8,  obrigatorio: 'N' },
  { nome_campo: 'cep',           apelido: 'CEP',                     tipo: 'texto',   ordem: 9,  obrigatorio: 'N' },
  { nome_campo: 'endereco',      apelido: 'Endereço',                tipo: 'texto',   ordem: 10, obrigatorio: 'N' },
  { nome_campo: 'numero',        apelido: 'Número',                  tipo: 'texto',   ordem: 11, obrigatorio: 'N' },
  { nome_campo: 'bairro',        apelido: 'Bairro',                  tipo: 'texto',   ordem: 12, obrigatorio: 'N' },
  { nome_campo: 'cidade',        apelido: 'Cidade',                  tipo: 'texto',   ordem: 13, obrigatorio: 'N' },
  { nome_campo: 'uf',            apelido: 'UF',                      tipo: 'texto',   ordem: 14, obrigatorio: 'N' },
  { nome_campo: 'cod_vendedor',  apelido: 'Cód. Vendedor',           tipo: 'numero',  ordem: 15, obrigatorio: 'N' },
  { nome_campo: 'segmento',      apelido: 'Segmento',                tipo: 'texto',   ordem: 16, obrigatorio: 'N' },
  { nome_campo: 'regiao',        apelido: 'Região',                  tipo: 'texto',   ordem: 17, obrigatorio: 'N' },
  { nome_campo: 'limite_credito',apelido: 'Limite de Crédito',       tipo: 'decimal', ordem: 18, obrigatorio: 'N' },
  { nome_campo: 'observacoes',   apelido: 'Observações',             tipo: 'texto',   ordem: 19, obrigatorio: 'N' },
];

async function ensureDefaultCampos(pool) {
  const [existing] = await pool.query(
    `SELECT COUNT(*) AS total FROM campos_importacao WHERE tabela = 'cliente'`
  ).catch(() => [[{ total: 0 }]]);
  if (existing[0]?.total > 0) return;
  for (const c of DEFAULT_CAMPOS) {
    await pool.query(
      `INSERT IGNORE INTO campos_importacao (tabela, nome_campo, apelido, tipo, ordem, obrigatorio, excluido)
       VALUES ('cliente', ?, ?, ?, ?, ?, 'N')`,
      [c.nome_campo, c.apelido, c.tipo, c.ordem, c.obrigatorio]
    ).catch(() => {});
  }
}

// GET /campos-importacao
router.get('/campos-importacao', async (req, res) => {
  try {
    const pool = getPool();
    await ensureDefaultCampos(pool);
    const [campos] = await pool.query(
      `SELECT * FROM campos_importacao WHERE tabela = 'cliente' AND excluido = 'N' ORDER BY ordem ASC, id ASC`
    ).catch(() => [[]]);
    res.json({ ok: true, campos });
  } catch (err) {
    console.error('[importacao-clientes/campos-importacao]', err);
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// POST /verificar-lote
router.post('/verificar-lote', async (req, res) => {
  const rows = req.body.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.json({ ok: false, msg: 'Nenhuma linha enviada.' });
  }
  try {
    const pool = getPool();
    const resultado = [];

    const cpfsLimpos = rows.map(r => String(r.cpf ?? '').trim().replace(/[.\-\/\s]/g, ''));
    const uniq = [...new Set(cpfsLimpos.filter(Boolean))];

    if (uniq.length === 0) {
      for (const r of rows) {
        resultado.push({ idx: r.idx, status_cadastro: 'N', status: 'SC', cod_registro: '', msg: 'CPF/CNPJ vazio' });
      }
      return res.json({ ok: true, resultado });
    }

    const placeholders = uniq.map(() => '?').join(',');
    const [dbRows] = await pool.query(
      `SELECT id, REPLACE(REPLACE(REPLACE(COALESCE(cpf,''), '.', ''), '-', ''), '/', '') AS cpf_limpo
       FROM clientes
       WHERE (excluido = 'N' OR excluido IS NULL)
       AND REPLACE(REPLACE(REPLACE(COALESCE(cpf,''), '.', ''), '-', ''), '/', '') IN (${placeholders})`,
      uniq
    ).catch(() => [[]]);

    const mapa = {};
    for (const row of dbRows) {
      mapa[String(row.cpf_limpo).trim()] = row;
    }

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const cpfLimpo = cpfsLimpos[i];
      if (!cpfLimpo) {
        resultado.push({ idx: r.idx, status_cadastro: 'N', status: 'SC', cod_registro: '', msg: 'CPF/CNPJ vazio' });
        continue;
      }
      const existe = Object.prototype.hasOwnProperty.call(mapa, cpfLimpo);
      resultado.push({
        idx: r.idx,
        status_cadastro: existe ? 'S' : 'N',
        status: existe ? 'A' : 'SC',
        cod_registro: existe ? String(mapa[cpfLimpo].id) : '',
        msg: ''
      });
    }

    res.json({ ok: true, resultado });
  } catch (err) {
    console.error('[importacao-clientes/verificar-lote]', err);
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// POST /importar-linha
router.post('/importar-linha', async (req, res) => {
  const status_cadastro = String(req.body.status_cadastro ?? 'N').trim();
  const cod_registro    = String(req.body.cod_registro ?? '').trim();

  let campos = req.body.campos;
  if (typeof campos === 'string') {
    try { campos = JSON.parse(campos); } catch { campos = {}; }
  }
  if (!campos || typeof campos !== 'object') {
    return res.json({ ok: false, msg: 'Nenhum campo mapeado para importar.' });
  }

  const pool = getPool();
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [validRows] = await conn.query(
      `SELECT nome_campo FROM campos_importacao WHERE tabela = 'cliente' AND excluido = 'N'`
    ).catch(() => [[]]);
    const camposValidos = validRows.map(r => r.nome_campo);

    const dados = {};
    for (const [campo, valor] of Object.entries(campos)) {
      if (camposValidos.includes(campo)) {
        dados[campo] = valor == null ? '' : String(valor);
      }
    }

    for (const cn of CAMPOS_NUMERICOS) {
      if (Object.prototype.hasOwnProperty.call(dados, cn) && dados[cn] === '') {
        dados[cn] = '0';
      }
    }

    if (status_cadastro === 'S' && cod_registro) {
      const cols = Object.keys(dados).filter(c => c !== 'id');
      if (cols.length === 0) {
        await conn.rollback(); conn.release();
        return res.json({ ok: false, msg: 'Nenhum campo válido para salvar.' });
      }
      const setParts = cols.map(c => `\`${c}\` = ?`);
      const vals = [...cols.map(c => dados[c]), cod_registro];
      await conn.query(
        `UPDATE clientes SET ${setParts.join(', ')}, dt_atualizacao = NOW() WHERE id = ?`, vals
      );
      await conn.commit(); conn.release();
      return res.json({ ok: true, operacao: 'UPDATE', msg: 'Cliente atualizado.' });
    }

    if (Object.keys(dados).length === 0) {
      await conn.rollback(); conn.release();
      return res.json({ ok: false, msg: 'Nenhum campo válido para salvar.' });
    }

    if (!dados.status)    dados.status = 'A';
    dados.excluido = 'N';
    if (!dados.dt_cadastro) {
      const [[d]] = await conn.query('SELECT CURDATE() AS hoje');
      dados.dt_cadastro = d?.hoje ? String(d.hoje).slice(0, 10) : new Date().toISOString().slice(0, 10);
    }

    const insertCols = Object.keys(dados);
    const placeholders = insertCols.map(() => '?').join(',');
    const colList = insertCols.map(c => `\`${c}\``).join(', ');
    const [ins] = await conn.query(
      `INSERT INTO clientes (${colList}) VALUES (${placeholders})`,
      insertCols.map(c => dados[c])
    );

    await conn.commit(); conn.release();
    res.json({ ok: true, operacao: 'INSERT', novo_id: ins.insertId, msg: 'Cliente inserido.' });
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (_) {} conn.release(); }
    console.error('[importacao-clientes/importar-linha]', err);
    res.json({ ok: false, msg: err.message });
  }
});

module.exports = router;
