const express = require('express');
const router  = express.Router();
const { getPool } = require('../config/database');
const { permCrud, negarCad } = require('../config/cadastros-permissoes');

const _permGrades = (req) => permCrud(req, {
  incluir: 'incluir_grades',
  alterar: 'alterar_grades',
  excluir: 'excluir_grades',
});

// ─── GET /api/grades ─────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    const { q = '', status = 'A', campo = 'nome', limit = 100, offset = 0 } = req.query;

    let where = [`(g.excluido = 'N' OR g.excluido IS NULL OR g.excluido = '')`];
    const vals = [];

    if (status === 'A')      where.push(`(g.status = 'A' OR g.status IS NULL OR g.status = '')`);
    else if (status === 'I') where.push(`(g.status = 'I' OR g.status = 'S')`);

    if (q.trim()) {
      const like = `%${q.trim().toLowerCase()}%`;
      const campoMap = {
        nome:    `LOWER(g.nome) LIKE ?`,
        apelido: `LOWER(g.apelido) LIKE ?`,
      };
      where.push(`(${campoMap[campo] || campoMap.nome})`);
      vals.push(like);
    }

    const wc = where.join(' AND ');
    const [rows] = await pool.query(
      `SELECT g.id, g.nome, g.apelido, g.tipo, g.qtnumero, g.status
       FROM tipograde g WHERE ${wc} ORDER BY g.nome LIMIT ? OFFSET ?`,
      [...vals, parseInt(limit), parseInt(offset)]
    );
    const [[tot]] = await pool.query(
      `SELECT COUNT(*) AS total FROM tipograde g WHERE ${wc}`, vals
    );
    res.json({ grades: rows, total: tot.total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/grades/notificacoes ─────────────────────────────────────────────
router.get('/notificacoes', async (req, res) => {
  try {
    const pool = getPool();
    const [[ativos]]   = await pool.query(
      `SELECT COUNT(*) AS n FROM tipograde WHERE (status='A' OR status IS NULL OR status='') AND (excluido='N' OR excluido IS NULL OR excluido='')`
    );
    const [[inativos]] = await pool.query(
      `SELECT COUNT(*) AS n FROM tipograde WHERE (status='I' OR status='S') AND (excluido='N' OR excluido IS NULL OR excluido='')`
    );
    res.json({ ativos: ativos.n, inativos: inativos.n });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/grades/:id ─────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT * FROM tipograde WHERE id = ? AND (excluido='N' OR excluido IS NULL OR excluido='')`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Grade não encontrada' });
    const grade = rows[0];
    const [itens] = await pool.query(
      `SELECT id, nome, sequencial, COALESCE(qtd_minima,0) AS qtd_minima FROM descricao_grades
       WHERE id_grade = ? AND (excluido='N' OR excluido IS NULL OR excluido='')
       ORDER BY sequencial, nome`,
      [req.params.id]
    );
    grade.itens = itens;
    res.json(grade);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/grades ────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const pc = _permGrades(req);
  if (pc.incluir !== 'S') return negarCad(res, 'Sem permissão para incluir grades');
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { nome, apelido, tipo = 'R', qtnumero = 0, itens = [] } = req.body;
    if (!nome?.trim())   return res.status(400).json({ error: 'Nome é obrigatório' });
    if (!apelido?.trim()) return res.status(400).json({ error: 'Apelido é obrigatório' });

    const [result] = await conn.query(
      `INSERT INTO tipograde (nome, apelido, tipo, qtnumero, status, excluido)
       VALUES (?, ?, ?, ?, 'A', 'N')`,
      [nome.toUpperCase().trim(), apelido.toUpperCase().trim(), tipo, parseInt(qtnumero) || 0]
    );
    const gradeId = result.insertId;

    for (let i = 0; i < itens.length; i++) {
      const item = itens[i];
      if (!item.nome?.trim()) continue;
      await conn.query(
        `INSERT INTO descricao_grades (id_grade, nome, sequencial, excluido, qtd_minima) VALUES (?, ?, ?, 'N', ?)`,
        [gradeId, item.nome.toUpperCase().trim(), i + 1, parseInt(item.qtd_minima) || 0]
      );
    }

    await conn.commit();
    res.json({ id: gradeId, ok: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ─── PUT /api/grades/:id ─────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  const pc = _permGrades(req);
  if (pc.alterar !== 'S') return negarCad(res, 'Sem permissão para alterar grades');
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { nome, apelido, tipo, qtnumero, status, itens = [] } = req.body;
    if (!nome?.trim())   return res.status(400).json({ error: 'Nome é obrigatório' });
    if (!apelido?.trim()) return res.status(400).json({ error: 'Apelido é obrigatório' });

    await conn.query(
      `UPDATE tipograde SET nome=?, apelido=?, tipo=?, qtnumero=?, status=? WHERE id=?`,
      [
        nome.toUpperCase().trim(),
        apelido.toUpperCase().trim(),
        tipo || 'R',
        parseInt(qtnumero) || 0,
        status || 'A',
        req.params.id,
      ]
    );

    // IDs dos itens que vieram no request (apenas existentes no DB)
    const sentIds = new Set(itens.filter(i => i.id).map(i => Number(i.id)));

    // Itens atuais no DB
    const [dbItens] = await conn.query(
      `SELECT id FROM descricao_grades WHERE id_grade = ? AND (excluido='N' OR excluido IS NULL OR excluido='')`,
      [req.params.id]
    );

    // Soft-delete dos itens removidos
    for (const row of dbItens) {
      if (!sentIds.has(row.id)) {
        await conn.query(`UPDATE descricao_grades SET excluido='S' WHERE id=?`, [row.id]);
      }
    }

    // Atualizar qtd_minima dos itens existentes
    for (const item of itens.filter(i => i.id)) {
      await conn.query(
        `UPDATE descricao_grades SET qtd_minima=? WHERE id=?`,
        [parseInt(item.qtd_minima) || 0, item.id]
      );
    }

    // Inserir itens novos (sem id)
    const novos = itens.filter(i => !i.id && i.nome?.trim());
    if (novos.length) {
      const [[maxRow]] = await conn.query(
        `SELECT COALESCE(MAX(sequencial),0) AS m FROM descricao_grades WHERE id_grade=?`,
        [req.params.id]
      );
      let seq = maxRow.m;
      for (const item of novos) {
        seq++;
        await conn.query(
          `INSERT INTO descricao_grades (id_grade, nome, sequencial, excluido, qtd_minima) VALUES (?, ?, ?, 'N', ?)`,
          [req.params.id, item.nome.toUpperCase().trim(), seq, parseInt(item.qtd_minima) || 0]
        );
      }
    }

    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ─── PUT /api/grades/:id/ativar ──────────────────────────────────────────────
router.put('/:id/ativar', async (req, res) => {
  try {
    const pc = _permGrades(req);
    if (pc.alterar !== 'S') return negarCad(res, 'Sem permissão para alterar grades');
    await getPool().query(`UPDATE tipograde SET status='A' WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/grades/:id/inativar ────────────────────────────────────────────
router.put('/:id/inativar', async (req, res) => {
  try {
    const pc = _permGrades(req);
    if (pc.alterar !== 'S') return negarCad(res, 'Sem permissão para alterar grades');
    await getPool().query(`UPDATE tipograde SET status='I' WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/grades/:id ──────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const pc = _permGrades(req);
    if (pc.excluir !== 'S') return negarCad(res, 'Sem permissão para excluir grades');
    const pool = getPool();
    const [[uso]] = await pool.query(
      `SELECT COUNT(*) AS n FROM itenspedgrade WHERE id_grade = ?`,
      [req.params.id]
    ).catch(() => [[{ n: 0 }]]);

    if (uso.n > 0) {
      return res.status(409).json({
        error: `Esta grade está em uso em ${uso.n} item(s) de pedido e não pode ser excluída.`
      });
    }
    await pool.query(`UPDATE tipograde SET excluido='S' WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
