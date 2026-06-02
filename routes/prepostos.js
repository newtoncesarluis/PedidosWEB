const express = require('express');
const router  = express.Router();
const { getPool } = require('../config/database');

// Garante colunas necessárias na tabela usuarios
let _colsOk = false;
async function _ensureCols(pool) {
  if (_colsOk) return;
  _colsOk = true;
  const cols = [
    { name: 'tipo_usuario',          type: "VARCHAR(20) NOT NULL DEFAULT 'REPRESENTANTE'" },
    { name: 'comissao_preposto_pct', type: 'DECIMAL(5,2) NOT NULL DEFAULT 6.00' },
  ];
  for (const c of cols)
    await pool.query(`ALTER TABLE usuarios ADD COLUMN ${c.name} ${c.type}`).catch(() => {});
}

// GET /api/prepostos — lista prepostos do representante logado (ou todos se admin)
router.get('/', async (req, res) => {
  const pool = getPool();
  try {
    await _ensureCols(pool);
    const userId  = req.user?.id;
    const isAdmin = req.user?.perfil == 1;
    let q = `SELECT idusuario AS id, nomeusu AS nome, loginusu AS login, comissao_preposto_pct AS pct_comissao,
                    COALESCE(excluido,'N') AS excluido, id_gerente
             FROM usuarios
             WHERE tipo_usuario = 'PREPOSTO' AND COALESCE(excluido,'N') = 'N'`;
    const params = [];
    if (!isAdmin) {
      q += ` AND id_gerente = ?`;
      params.push(userId);
    }
    q += ` ORDER BY nomeusu`;
    const [rows] = await pool.query(q, params);
    res.json({ prepostos: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/prepostos/lookup — para dropdown no pedido (retorna todos ativos do representante)
router.get('/lookup', async (req, res) => {
  const pool = getPool();
  try {
    await _ensureCols(pool);
    const userId  = req.user?.id;
    const isAdmin = req.user?.perfil == 1;
    let q = `SELECT idusuario AS id, nomeusu AS nome, loginusu AS login, comissao_preposto_pct AS pct_comissao
             FROM usuarios
             WHERE tipo_usuario = 'PREPOSTO' AND COALESCE(excluido,'N') = 'N'`;
    const params = [];
    if (!isAdmin) { q += ` AND id_gerente = ?`; params.push(userId); }
    q += ` ORDER BY nomeusu`;
    const [rows] = await pool.query(q, params);
    res.json({ prepostos: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/prepostos/:id/pct?fornecedor=X — % do preposto para um fornecedor específico
router.get('/:id/pct', async (req, res) => {
  const pool = getPool();
  try {
    const idPreposto   = parseInt(req.params.id);
    const idFornecedor = parseInt(req.query.fornecedor) || 0;
    let pct = 0, origem = 'PADRAO';
    if (idFornecedor) {
      const [[pcf]] = await pool.query(
        `SELECT pct_comissao FROM preposto_comissao_fornecedor WHERE id_usuario = ? AND id_fornecedor = ? LIMIT 1`,
        [idPreposto, idFornecedor]
      ).catch(() => [[null]]);
      if (pcf) { pct = parseFloat(pcf.pct_comissao) || 0; origem = 'FORNECEDOR'; }
    }
    if (!pct) {
      const [[usr]] = await pool.query(
        `SELECT COALESCE(comissao_preposto_pct,6) AS pct FROM usuarios WHERE idusuario = ? LIMIT 1`,
        [idPreposto]
      ).catch(() => [[{ pct: 6 }]]);
      pct = parseFloat(usr?.pct || 6);
    }
    res.json({ pct, origem });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/prepostos/:id/comissoes — extrato de comissões do preposto
router.get('/:id/comissoes', async (req, res) => {
  const pool = getPool();
  try {
    const { id } = req.params;
    const { dt_inicio, dt_fim } = req.query;
    const dtIni = dt_inicio || '2000-01-01';
    const dtFim = dt_fim   || '2100-01-01';

    const [rows] = await pool.query(`
      SELECT pc.*, ped.nome_cliente, ped.nome_fornecedor, ped.vlrtotalpedido, ped.cod_fornecedor,
             u.nomeusu AS nome_representante,
             COALESCE(pcf.pct_comissao, usr.comissao_preposto_pct, 6) AS pct_aplicado
      FROM pagtocomissao pc
      LEFT JOIN pedidos ped ON pc.pedido = ped.numero
      LEFT JOIN usuarios u   ON u.idusuario = pc.cod_user
      LEFT JOIN usuarios usr ON usr.idusuario = pc.id_preposto
      LEFT JOIN preposto_comissao_fornecedor pcf
             ON pcf.id_usuario = pc.id_preposto AND pcf.id_fornecedor = ped.cod_fornecedor
      WHERE pc.id_preposto = ? AND COALESCE(pc.excluido,'N') = 'N'
        AND pc.data_lancamento BETWEEN ? AND ?
      ORDER BY pc.data_lancamento DESC
    `, [id, dtIni, dtFim]);

    const resumo = rows.reduce((acc, r) => {
      const v = parseFloat(r.vlr_pago) || 0;
      if (r.status === 'P') acc.prevista   += v;
      if (r.status === 'C') acc.confirmada += v;
      if (r.status === 'R') acc.paga       += v;
      return acc;
    }, { prevista: 0, confirmada: 0, paga: 0 });

    res.json({ comissoes: rows, resumo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/prepostos/:id/recalcular-comissoes — recalcula em lote todas as comissões pendentes
router.post('/:id/recalcular-comissoes', async (req, res) => {
  const pool = getPool();
  try {
    const idPreposto = parseInt(req.params.id);

    // Busca todas as comissões pendentes do preposto com dados do pedido
    const [pendentes] = await pool.query(`
      SELECT pc.id, pc.id_parcela, pc.pedido,
             rec.valor AS vlr_parcela,
             ped.cod_fornecedor, ped.id AS id_pedido
      FROM pagtocomissao pc
      LEFT JOIN receber rec ON rec.id = pc.id_parcela
      LEFT JOIN pedidos  ped ON ped.numero = pc.pedido
      WHERE pc.id_preposto = ? AND pc.status = 'P' AND COALESCE(pc.excluido,'N') = 'N'
    `, [idPreposto]);

    if (!pendentes.length) return res.json({ ok: true, atualizadas: 0 });

    // Busca % padrão do preposto (fallback)
    const [[usr]] = await pool.query(
      `SELECT COALESCE(comissao_preposto_pct,6) AS pct FROM usuarios WHERE idusuario = ? LIMIT 1`,
      [idPreposto]
    ).catch(() => [[{ pct: 6 }]]);
    const pctPadrao = parseFloat(usr?.pct || 6);

    // Busca todas as configurações por fornecedor do preposto (lookup único fora do loop)
    const [configs] = await pool.query(
      `SELECT id_fornecedor, pct_comissao FROM preposto_comissao_fornecedor WHERE id_usuario = ?`,
      [idPreposto]
    ).catch(() => [[]]);
    const configMap = {};
    for (const c of configs) configMap[c.id_fornecedor] = parseFloat(c.pct_comissao) || 0;

    let atualizadas = 0;
    for (const pc of pendentes) {
      const pct = (pc.cod_fornecedor && configMap[pc.cod_fornecedor]) || pctPadrao;

      // Busca base ajustada (IPI/ST) do fornecedor
      let fornConfig = { com_sobre_ipi: 'S', com_sobre_st: 'S' };
      if (pc.cod_fornecedor) {
        const [[fc]] = await pool.query(
          `SELECT COALESCE(com_sobre_ipi,'S') AS com_sobre_ipi, COALESCE(com_sobre_st,'S') AS com_sobre_st
           FROM fornecedores WHERE id = ? LIMIT 1`,
          [pc.cod_fornecedor]
        ).catch(() => [[null]]);
        if (fc) Object.assign(fornConfig, fc);
      }

      let base = parseFloat(pc.vlr_parcela || 0);
      if (!base && pc.id_pedido) {
        const [[tot]] = await pool.query(
          `SELECT COALESCE(SUM(valor),0) AS total FROM receber WHERE numero = ? AND id_pedido = ?`,
          [pc.pedido, pc.id_pedido]
        ).catch(() => [[{ total: 0 }]]);
        base = parseFloat(tot?.total || 0);
      }
      if (base > 0 && (fornConfig.com_sobre_ipi !== 'S' || fornConfig.com_sobre_st !== 'S')) {
        const [[imp]] = await pool.query(
          `SELECT COALESCE(SUM(vlr_ipi),0) AS ipi, COALESCE(SUM(vlr_st),0) AS st FROM itensped WHERE id_pedido = ?`,
          [pc.id_pedido]
        ).catch(() => [[{ ipi: 0, st: 0 }]]);
        const [[totParc]] = await pool.query(
          `SELECT COALESCE(SUM(valor),0) AS total FROM receber WHERE numero = ? AND id_pedido = ?`,
          [pc.pedido, pc.id_pedido]
        ).catch(() => [[{ total: 0 }]]);
        const prop = pc.id_parcela ? base / (parseFloat(totParc?.total || 1)) : 1;
        if (fornConfig.com_sobre_ipi !== 'S') base -= parseFloat(imp?.ipi || 0) * prop;
        if (fornConfig.com_sobre_st  !== 'S') base -= parseFloat(imp?.st  || 0) * prop;
        if (base < 0) base = 0;
      }

      const novoValor = Math.round(base * pct / 100 * 100) / 100;
      if (novoValor !== parseFloat(pc.vlr_parcela)) {
        await pool.query(
          `UPDATE pagtocomissao SET vlr_pago = ?, vlr_pago_original = COALESCE(vlr_pago_original, vlr_pago) WHERE id = ?`,
          [novoValor, pc.id]
        );
        atualizadas++;
      }
    }

    res.json({ ok: true, atualizadas, total: pendentes.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/prepostos — cadastra novo preposto (cria usuário com tipo_usuario='PREPOSTO')
router.post('/', async (req, res) => {
  const pool = getPool();
  try {
    await _ensureCols(pool);
    const userId = req.user?.id;
    const { nome, login, senha, pct_comissao } = req.body;
    if (!nome || !login) return res.status(400).json({ error: 'Nome e login são obrigatórios' });

    const pct = parseFloat(pct_comissao) || 6;
    const senhaCrypt = senha || login; // sem criptografia aqui — usa a mesma do sistema

    // Verifica login duplicado
    const [dup] = await pool.query(
      `SELECT idusuario FROM usuarios WHERE loginusu = ? AND COALESCE(excluido,'N') = 'N' LIMIT 1`,
      [login]
    );
    if (dup.length) return res.status(409).json({ error: 'Login já cadastrado' });

    const [result] = await pool.query(`
      INSERT INTO usuarios (nomeusu, loginusu, senhausu, situacao, tipo_usuario, comissao_preposto_pct, id_gerente, excluido)
      VALUES (?, ?, ?, 'ATIVO', 'PREPOSTO', ?, ?, 'N')
    `, [nome.toUpperCase(), login, senhaCrypt, pct, userId]);

    res.status(201).json({ ok: true, id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/prepostos/:id — atualiza preposto
router.put('/:id', async (req, res) => {
  const pool = getPool();
  try {
    const { id } = req.params;
    const { nome, pct_comissao, ativo } = req.body;
    const sets = [], vals = [];
    if (nome !== undefined)          { sets.push('nomeusu = ?');                vals.push(nome.toUpperCase()); }
    if (pct_comissao !== undefined)  { sets.push('comissao_preposto_pct = ?');  vals.push(parseFloat(pct_comissao) || 6); }
    if (ativo !== undefined)         { sets.push("excluido = ?");               vals.push(ativo ? 'N' : 'S'); }
    if (!sets.length) return res.status(400).json({ error: 'Nada para atualizar' });
    vals.push(id);
    await pool.query(`UPDATE usuarios SET ${sets.join(', ')} WHERE idusuario = ?`, vals);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/prepostos/:id — inativa preposto (soft delete)
router.delete('/:id', async (req, res) => {
  const pool = getPool();
  try {
    await pool.query(`UPDATE usuarios SET excluido = 'S' WHERE idusuario = ? AND tipo_usuario = 'PREPOSTO'`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
