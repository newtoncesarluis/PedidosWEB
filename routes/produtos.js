const express = require('express');
const router  = express.Router();
const { getPool } = require('../config/database');

// ─── cache DESCRIBE ───────────────────────────────────────────────────────────
let _colunasCache = null;
async function getColunasReais(pool) {
  if (_colunasCache) return _colunasCache;
  const tb = await getTabela(pool);
  const [rows] = await pool.query(`DESCRIBE ${tb}`);
  _colunasCache = rows.map(r => r.Field);
  return _colunasCache;
}

function filtrarBody(body, colunas) {
  // skip pk e campos de data/controle gerenciados pelo servidor
  const skip = ['ID','id','excluido','dt_cadastro','dt_atualizacao','user_atualizacao','status_sinc'];
  const colsLower = colunas.map(c => c.toLowerCase());
  return Object.fromEntries(
    Object.entries(body).filter(([k, v]) => {
      if (v === undefined || v === null) return false;
      return colsLower.includes(k.toLowerCase()) && !skip.map(s=>s.toLowerCase()).includes(k.toLowerCase());
    })
  );
}

const UPPER_CAMPOS = ['descricao','apelido','segmento','unidade','marca','solado','obs','obs2','cor1','cor2','nome_grupo'];
function aplicarUpper(body) {
  UPPER_CAMPOS.forEach(c => { if (body[c]) body[c] = String(body[c]).toUpperCase().trim(); });
  return body;
}

// tabela pode ser "produto" ou "produtos" — detecta automaticamente
let _tabela = null;
async function getTabela(pool) {
  if (_tabela) return _tabela;
  const [rows] = await pool.query(`SHOW TABLES LIKE 'produto'`);
  _tabela = rows.length ? 'produto' : 'produtos';
  return _tabela;
}

// ─── GET /api/produtos ────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    const tb = await getTabela(pool);
    const { q='', status='todos', limit=50, offset=0, grupo='', disponivel='' } = req.query;

    let where = [`(p.excluido='N' OR p.excluido IS NULL OR p.excluido='')`];
    const vals = [];

    if (status === 'A') where.push(`p.situacao='A'`);
    else if (status === 'I') where.push(`p.situacao='I'`);
    else if (status === 'E') where.push(`p.situacao='E'`);

    if (q.trim()) {
      where.push(`(p.descricao LIKE ? OR p.id LIKE ? OR p.cod_barras LIKE ? OR p.cod_fabricante LIKE ? OR p.apelido LIKE ?)`);
      const lk = `%${q.trim()}%`;
      vals.push(lk,lk,lk,lk,lk);
    }
    if (grupo.trim())     { where.push(`p.nome_grupo LIKE ?`);   vals.push(`%${grupo.trim()}%`); }
    if (disponivel)       { where.push(`p.disponivel=?`);        vals.push(disponivel); }

    const wc = where.join(' AND ');

    const [rows] = await pool.query(
      `SELECT p.ID AS id, p.descricao, p.apelido, p.cod_barras, p.cod_fabricante,
              p.unidade, p.kilo_embalagem, p.vlr_venda, p.estoque_atual,
              p.estoque_minimo, p.situacao, p.disponivel, p.kit,
              p.nome_grupo, p.dt_cadastro
       FROM ${tb} p
       WHERE ${wc}
       ORDER BY p.descricao
       LIMIT ? OFFSET ?`,
      [...vals, parseInt(limit), parseInt(offset)]
    );

    const [[{total}]] = await pool.query(
      `SELECT COUNT(*) AS total FROM ${tb} p WHERE ${wc}`, vals
    );

    res.json({ produtos: rows, total });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/produtos/notificacoes ──────────────────────────────────────────
router.get('/notificacoes', async (req, res) => {
  try {
    const pool = getPool();
    const tb = await getTabela(pool);
    const base = `(excluido='N' OR excluido IS NULL OR excluido='')`;

    const [[{ativos}]]        = await pool.query(`SELECT COUNT(*) AS ativos FROM ${tb} WHERE ${base} AND situacao='A'`);
    const [[{inativos}]]      = await pool.query(`SELECT COUNT(*) AS inativos FROM ${tb} WHERE ${base} AND situacao='I'`);
    const [[{est_baixo}]]     = await pool.query(`SELECT COUNT(*) AS est_baixo FROM ${tb} WHERE ${base} AND situacao='A' AND estoque_minimo>0 AND estoque_atual<=estoque_minimo`);
    const [[{novos7dias}]]    = await pool.query(`SELECT COUNT(*) AS novos7dias FROM ${tb} WHERE ${base} AND dt_cadastro>=DATE_SUB(CURDATE(),INTERVAL 7 DAY)`);

    res.json({ ativos, inativos, est_baixo, novos7dias });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/produtos/grupos ─────────────────────────────────────────────────
router.get('/grupos', async (req, res) => {
  try {
    const pool = getPool();
    const tb = await getTabela(pool);
    const [rows] = await pool.query(
      `SELECT DISTINCT nome_grupo FROM ${tb} WHERE nome_grupo IS NOT NULL AND nome_grupo<>'' ORDER BY nome_grupo`
    );
    res.json(rows.map(r => r.nome_grupo));
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/produtos/:id ────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const pool = getPool();
    const tb = await getTabela(pool);
    const [rows] = await pool.query(
      `SELECT * FROM ${tb} WHERE ID=? AND (excluido='N' OR excluido IS NULL OR excluido='') LIMIT 1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Não encontrado' });
    res.json(rows[0]);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ─── POST /api/produtos ───────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const pool = getPool();
    const tb = await getTabela(pool);
    const cols = await getColunasReais(pool);
    const body = aplicarUpper(filtrarBody(req.body, cols));

    if (!body.descricao?.trim()) return res.status(400).json({ error: 'Descrição obrigatória' });
    if (!body.situacao) body.situacao = 'A';
    if (!body.excluido) body.excluido = 'N';

    const keys = Object.keys(body);
    const [r] = await pool.query(
      `INSERT INTO ${tb} (${keys.map(k=>`\`${k}\``).join(',')}, dt_cadastro)
       VALUES (${keys.map(()=>'?').join(',')}, CURDATE())`,
      keys.map(k => body[k] ?? null)
    );
    res.status(201).json({ ok: true, id: r.insertId });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ─── PUT /api/produtos/:id ────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const pool = getPool();
    const tb = await getTabela(pool);
    const cols = await getColunasReais(pool);
    const body = aplicarUpper(filtrarBody(req.body, cols));

    if (!body.descricao?.trim()) return res.status(400).json({ error: 'Descrição obrigatória' });

    const keys = Object.keys(body);
    if (!keys.length) return res.status(400).json({ error: 'Nenhum campo para atualizar' });

    await pool.query(
      `UPDATE ${tb} SET ${keys.map(k=>`\`${k}\`=?`).join(',')}, dt_atualizacao=NOW() WHERE ID=?`,
      [...keys.map(k => body[k] ?? null), req.params.id]
    );
    res.json({ ok: true, id: parseInt(req.params.id) });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ─── PUT /api/produtos/:id/ativar ─────────────────────────────────────────────
router.put('/:id/ativar', async (req, res) => {
  try {
    const pool = getPool();
    const tb = await getTabela(pool);
    await pool.query(`UPDATE ${tb} SET situacao='A', dt_atualizacao=NOW() WHERE ID=?`, [req.params.id]);
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ─── PUT /api/produtos/:id/inativar ──────────────────────────────────────────
router.put('/:id/inativar', async (req, res) => {
  try {
    const pool = getPool();
    const tb = await getTabela(pool);
    await pool.query(`UPDATE ${tb} SET situacao='I', dt_atualizacao=NOW() WHERE ID=?`, [req.params.id]);
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ─── DELETE /api/produtos/:id (soft) ─────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const pool = getPool();
    const tb = await getTabela(pool);
    await pool.query(
      `UPDATE ${tb} SET excluido='S', situacao='E', dt_atualizacao=NOW() WHERE ID=?`,
      [req.params.id]
    );
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
