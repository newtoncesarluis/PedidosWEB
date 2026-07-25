const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');
const { resolveNaturezaLabelColumn, naturezaLabelExpr } = require('../config/natureza-label');
const { ensureFinanceiroContabilCols } = require('../config/plano-contas-schema');
const {
  sqlAberto,
  sqlLiquidado,
  sqlStatusDisplay,
  truncFormaPagto,
} = require('../config/receber-status');

const SQL_EXCLUIDO = "(p.excluido = 'N' OR p.excluido IS NULL OR p.excluido = '')";
const SQL_ABERTO = sqlAberto('p');
const SQL_LIQUIDADO = sqlLiquidado('p');
const SQL_ABERTO_COL = sqlAberto('');
const SQL_LIQUIDADO_COL = sqlLiquidado('');
const SQL_STATUS_DISPLAY = sqlStatusDisplay('p');

const _idxReceberDone = new Set();
async function ensureReceberListIndexes(pool) {
  let dbName = '';
  try {
    const [[row]] = await pool.query('SELECT DATABASE() AS db');
    dbName = row?.db || '';
  } catch (_) {}
  if (_idxReceberDone.has(dbName)) return;
  // Listagem filtra excluido + ordena por vencimento — sem índice vira full scan + filesort
  try {
    await pool.query('CREATE INDEX idx_rec_excl_venc ON receber (excluido, vencimento)');
  } catch (_) {}
  try {
    await pool.query('CREATE INDEX idx_rec_status ON receber (status)');
  } catch (_) {}
  _idxReceberDone.add(dbName);
}

// Middleware para validar entradas (criação; baixa/estorno não exigem vencimento no body)
function validarEntradas(req, res, next) {
    if (req.body.baixar) return next();
    if (req.method === 'PUT' && !req.body.valor && !req.body.vencimento) return next();

    const valor = parseFloat(req.body.valor);
    if (req.body.valor != null && req.body.valor !== '' && (Number.isNaN(valor) || valor <= 0)) {
        return res.status(400).json({ error: 'O valor deve ser maior que zero.' });
    }
    if (req.method === 'POST') {
        if (!req.body.vencimento || Number.isNaN(Date.parse(req.body.vencimento))) {
            return res.status(400).json({ error: 'Data de vencimento inválida.' });
        }
        if (Number.isNaN(valor) || valor <= 0) {
            return res.status(400).json({ error: 'O valor deve ser maior que zero.' });
        }
    }
    next();
}

// ─── LISTAR CONTAS A RECEBER ──────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const pool = getPool();
  const {
    page, limit, status, fornecedor, id_receitas, dt_inicio, dt_fim,
    id_planoconta, id_centrocusto, cod_cliente,
  } = req.query;

  let where = SQL_EXCLUIDO;
  const params = [];

  // vencimento é DATE — sem DATE() para permitir uso de índice
  if (dt_inicio && dt_fim) {
    where += ' AND p.vencimento BETWEEN ? AND ?';
    params.push(dt_inicio, dt_fim);
  } else if (dt_inicio) {
    where += ' AND p.vencimento >= ?';
    params.push(dt_inicio);
  } else if (dt_fim) {
    where += ' AND p.vencimento <= ?';
    params.push(dt_fim);
  }

  const st = String(status || 'T').trim().toUpperCase();
  if (st === 'ABERTA' || st === 'ABERTO' || st === 'A RECEBER') {
    where += ` AND ${SQL_ABERTO}`;
  } else if (st === 'LIQUIDADO' || st === 'RECEBIDO' || st === 'RECEBIDA') {
    where += ` AND ${SQL_LIQUIDADO}`;
  } else if (st === 'EM ATRASO' || st === 'EM_ATRASO' || st === 'ATRASO') {
    where += ` AND ${SQL_ABERTO} AND p.vencimento < CURDATE()`;
  } else if (st && st !== 'T' && st !== 'TODOS') {
    where += ' AND p.status = ?';
    params.push(status);
  }

  if (fornecedor) {
    where += ' AND (p.nome_fornecedor LIKE ? OR CAST(p.cod_fornecedor AS CHAR) LIKE ? OR p.doc LIKE ? OR p.numero LIKE ?)';
    params.push(`%${fornecedor}%`, `%${fornecedor}%`, `%${fornecedor}%`, `%${fornecedor}%`);
  }
  if (cod_cliente) {
    where += ' AND p.id_cliente = ?';
    params.push(cod_cliente);
  }
  const recId = parseInt(id_receitas, 10);
  if (recId > 0) {
    where += ' AND p.id_receitas = ?';
    params.push(recId);
  }
  const planoId = parseInt(id_planoconta, 10);
  if (planoId > 0) {
    where += ` AND COALESCE(p.id_planoconta, (SELECT n2.id_planoconta FROM natureza n2 WHERE n2.id = p.id_receitas LIMIT 1)) = ?`;
    params.push(planoId);
  }
  const centroId = parseInt(id_centrocusto, 10);
  if (centroId > 0) {
    where += ' AND p.id_centrocusto = ?';
    params.push(centroId);
  }

  const p = parseInt(page) || 1;
  const lim = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
  const offset = (p - 1) * lim;

  try {
    await Promise.all([
      resolveNaturezaLabelColumn(pool),
      ensureFinanceiroContabilCols(pool).catch(() => {}),
      ensureReceberListIndexes(pool).catch(() => {}),
    ]);
    const natLabel = naturezaLabelExpr('n');

    const [[totalRows], [rows]] = await Promise.all([
      pool.query(`SELECT COUNT(*) as total FROM receber p WHERE ${where}`, params),
      pool.query(`
        SELECT 
          p.id, p.numero, p.doc, p.tipo, p.vencimento, p.valor, p.status, p.obs,
          p.cod_fornecedor, p.nome_fornecedor, p.id_receitas, p.id_cliente, p.cod_vendedor,
          p.data_pagto, p.valor_pago, p.forma_pagto, p.juros, p.vlrjuros, p.vlracressimo,
          p.id_planoconta, p.id_centrocusto, p.excluido,
          ${natLabel} AS nome_receita,
          COALESCE(p.id_planoconta, n.id_planoconta) AS id_planoconta_resolvido,
          pc.numero AS planoconta_numero,
          pc.descricao AS planoconta_nome,
          cc.codigo AS centrocusto_codigo,
          cc.descricao AS centrocusto_nome,
          ${SQL_STATUS_DISPLAY} AS status_display
        FROM receber p
        LEFT JOIN natureza n ON p.id_receitas = n.id
        LEFT JOIN plano_contas pc ON pc.id = COALESCE(p.id_planoconta, n.id_planoconta)
        LEFT JOIN centro_custo cc ON cc.id = p.id_centrocusto
        WHERE ${where} 
        ORDER BY p.vencimento ASC 
        LIMIT ? OFFSET ?
      `, [...params, lim, offset]),
    ]);

    const total = totalRows[0]?.total || 0;
    res.json({ data: rows, total, page: p, limit: lim });
  } catch (err) {
    console.error('[receber/listar]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── STATS (KPIs) ────────────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  const pool = getPool();
  try {
    await ensureReceberListIndexes(pool).catch(() => {});
    const [rows] = await pool.query(`
      SELECT
        SUM(CASE WHEN ${SQL_ABERTO_COL} AND vencimento < CURDATE() THEN valor ELSE 0 END) as total_vencido,
        SUM(CASE WHEN ${SQL_ABERTO_COL} AND vencimento >= CURDATE() THEN valor ELSE 0 END) as total_pendente,
        SUM(CASE WHEN ${SQL_LIQUIDADO_COL} AND DATE(data_pagto) = CURDATE() THEN COALESCE(valor_pago, valor) ELSE 0 END) as total_recebido_hoje,
        COUNT(CASE WHEN ${SQL_ABERTO_COL} AND vencimento < CURDATE() THEN 1 END) as qtd_vencidos
      FROM receber
      WHERE (excluido = 'N' OR excluido IS NULL OR excluido = '')
    `);
    const s = rows[0] || {};
    res.json({
      total_pendente: parseFloat(s.total_pendente || 0),
      total_vencido: parseFloat(s.total_vencido || 0),
      qtd_vencidos: parseInt(s.qtd_vencidos || 0, 10),
      total_recebido_hoje: parseFloat(s.total_recebido_hoje || 0)
    });
  } catch (err) {
    console.error('[receber/stats]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── DASHBOARD (BI) ──────────────────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  const pool = getPool();
  try {
    await resolveNaturezaLabelColumn(pool);
    const natLabel = naturezaLabelExpr('n');

    const [topAbertas] = await pool.query(`
      SELECT nome_fornecedor as cliente, SUM(valor) as total 
      FROM receber 
      WHERE ${SQL_ABERTO_COL} AND (excluido = 'N' OR excluido IS NULL OR excluido = '')
      GROUP BY nome_fornecedor ORDER BY total DESC LIMIT 10
    `);

    const [topRecebidos] = await pool.query(`
      SELECT nome_fornecedor as cliente, SUM(COALESCE(valor_pago, valor)) as total 
      FROM receber 
      WHERE ${SQL_LIQUIDADO_COL} AND (excluido = 'N' OR excluido IS NULL OR excluido = '')
      GROUP BY nome_fornecedor ORDER BY total DESC LIMIT 10
    `);

    const [porCategoria] = await pool.query(`
      SELECT ${natLabel} as categoria, SUM(p.valor) as total
      FROM receber p
      LEFT JOIN natureza n ON p.id_receitas = n.id
      WHERE (p.excluido = 'N' OR p.excluido IS NULL OR p.excluido = '')
      GROUP BY ${natLabel} ORDER BY total DESC LIMIT 5
    `);

    const [fluxoSemanal] = await pool.query(`
      SELECT 
        WEEK(vencimento) as semana,
        MIN(vencimento) as data_inicio,
        SUM(valor) as total
      FROM receber
      WHERE ${SQL_ABERTO_COL} AND (excluido = 'N' OR excluido IS NULL OR excluido = '') AND vencimento >= CURDATE()
      GROUP BY WEEK(vencimento)
      ORDER BY vencimento ASC
      LIMIT 4
    `);

    res.json({ 
      topAbertas: topAbertas.map(i => ({...i, total: parseFloat(i.total||0)})),
      topRecebidos: topRecebidos.map(i => ({...i, total: parseFloat(i.total||0)})),
      porCategoria: porCategoria.map(i => ({...i, total: parseFloat(i.total||0)})),
      fluxoSemanal: fluxoSemanal.map(i => ({...i, total: parseFloat(i.total||0)}))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DASHBOARD FINANCEIRO (caixa / fluxo) ───────────────────────────────────
router.get('/dashboard-financeiro', async (req, res) => {
    const pool = getPool();
    try {
        // KPIs principais
        const [saldoAtual] = await pool.query("SELECT SUM(valor) as saldo FROM caixa WHERE excluido = 'N'");
        const [totalReceber] = await pool.query(
          `SELECT SUM(valor) as total FROM receber WHERE ${SQL_ABERTO_COL} AND (excluido = 'N' OR excluido IS NULL OR excluido = '')`
        );
        const [totalPagar] = await pool.query("SELECT SUM(valor) as total FROM pagar WHERE status = 'ABERTA' AND excluido = 'N'");

        // Fluxo de caixa
        const [cashflow] = await pool.query(`
            SELECT 
                DATE_FORMAT(data, '%Y-%m-%d') as label,
                SUM(CASE WHEN tipo = 'ENTRADA' THEN valor ELSE 0 END) as entradas,
                SUM(CASE WHEN tipo = 'SAIDA' THEN valor ELSE 0 END) as saidas
            FROM caixa
            WHERE excluido = 'N'
            GROUP BY DATE_FORMAT(data, '%Y-%m-%d')
            ORDER BY data ASC
        `);

        // Contas a pagar
        const [payables] = await pool.query(`
            SELECT 
                fornecedor, valor, vencimento, status
            FROM pagar
            WHERE status = 'ABERTA' AND excluido = 'N'
            ORDER BY vencimento ASC
            LIMIT 10
        `);

        res.json({
            saldoAtual: saldoAtual[0]?.saldo || 0,
            totalReceber: totalReceber[0]?.total || 0,
            totalPagar: totalPagar[0]?.total || 0,
            cashflow: {
                labels: cashflow.map(row => row.label),
                entradas: cashflow.map(row => row.entradas),
                saidas: cashflow.map(row => row.saidas)
            },
            payables
        });
    } catch (err) {
        console.error('[dashboard]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─── CRIAR TÍTULO ─────────────────────────────────────────────────────────────
router.post('/', validarEntradas, async (req, res) => {
  const pool = getPool();
  const data = req.body;
  const numRecorrencias = parseInt(data.recorrencia) || 1;
  
  try {
    await ensureFinanceiroContabilCols(pool);
    const idPlano = data.id_planoconta !== undefined && data.id_planoconta !== ''
      ? (parseInt(data.id_planoconta, 10) || null)
      : null;
    const idCentro = data.id_centrocusto !== undefined && data.id_centrocusto !== ''
      ? (parseInt(data.id_centrocusto, 10) || null)
      : null;
    // Auto-cadastra o cliente/pagador caso seja novo
    let finalCodFornecedor = data.cod_fornecedor || null;
    if (!finalCodFornecedor && data.nome_fornecedor) {
      const nomeTrim = data.nome_fornecedor.trim().toUpperCase();
      const [existing] = await pool.query(
        `SELECT id FROM fornecedores WHERE UPPER(nome) = ? AND (excluido='N' OR excluido IS NULL OR excluido='') LIMIT 1`, 
        [nomeTrim]
      );
      if (existing.length > 0) {
        finalCodFornecedor = existing[0].id;
      } else {
        const [ins] = await pool.query(
          `INSERT INTO fornecedores (nome, tipo, status, excluido, dtcadastro) VALUES (?, 'ADMINISTRATIVO', 'A', 'N', CURDATE())`,
          [nomeTrim]
        );
        finalCodFornecedor = ins.insertId;
      }
    }

    const results = [];
    for (let i = 0; i < numRecorrencias; i++) {
      const dataVenc = new Date(data.vencimento);
      dataVenc.setMonth(dataVenc.getMonth() + i);
      
      const status = data.status || 'ABERTA';
      const vlrPago = (status === 'LIQUIDADO' || status === 'RECEBIDO') ? (data.valor_pago || data.valor) : 0;
      const dataPagto = (status === 'LIQUIDADO' || status === 'RECEBIDO') ? (data.data_pagto || new Date()) : null;

      const [result] = await pool.query(`
        INSERT INTO receber (
          numero, tipo, vencimento, valor, status, obs, doc, 
          cod_fornecedor, nome_fornecedor, id_receitas, 
          id_cliente, cod_vendedor, data_pagto, valor_pago, 
          forma_pagto, juros, vlrjuros, vlracressimo,
          id_planoconta, id_centrocusto, excluido
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'N')
      `, [
        data.numero || null, data.tipo || 'MANUAL', dataVenc, parseFloat(data.valor) || 0, 
        status, data.obs || null, data.doc || null,
        finalCodFornecedor, data.nome_fornecedor || null,
        data.id_receitas || null, data.id_cliente || null, data.cod_vendedor || null,
        dataPagto, vlrPago, data.forma_pagto || null,
        parseFloat(data.juros) || 0, parseFloat(data.vlrjuros) || 0, parseFloat(data.vlracressimo) || 0,
        idPlano, idCentro
      ]);
      results.push(result.insertId);
    }
    res.status(201).json({ ok: true, ids: results });
  } catch (err) {
    console.error('[receber/criar]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── BAIXAR EM LOTE ──────────────────────────────────────────────────────────
router.post('/lote/baixar', async (req, res) => {
  const pool = getPool();
  const { ids, data_pagto, forma_pagto } = req.body;

  const idList = (Array.isArray(ids) ? ids : [])
    .map((id) => parseInt(id, 10))
    .filter((id) => id > 0);

  if (!idList.length) return res.status(400).json({ error: 'Nenhum título selecionado' });

  try {
    const dt = data_pagto || new Date();
    const forma = truncFormaPagto(forma_pagto || 'DINHEIRO');

    const [result] = await pool.query(`
      UPDATE receber SET 
        status = 'RECEBIDO', 
        data_pagto = ?, 
        valor_pago = valor, 
        forma_pagto = ?,
        obs = CONCAT(COALESCE(obs,''), '\n--- Recebimento em lote em: ', NOW())
      WHERE id IN (?) AND ${SQL_ABERTO_COL}
        AND (excluido = 'N' OR excluido IS NULL OR excluido = '')
    `, [dt, forma, idList]);

    const afetados = result?.affectedRows || 0;
    if (!afetados) {
      return res.status(400).json({
        error: 'Nenhum título em aberto foi atualizado. Confira se os selecionados ainda estão a receber.',
      });
    }

    res.json({
      ok: true,
      afetados,
      message: `${afetados} título(s) recebidos com sucesso.`,
    });
  } catch (err) {
    console.error('[receber/baixa-lote]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── ATUALIZAR / LIQUIDAR INDIVIDUAL ──────────────────────────────────────────
router.put('/:id', validarEntradas, async (req, res) => {
  const pool = getPool();
  const data = req.body;
  const { id } = req.params;

  try {
    if (data.baixar) {
      const forma = truncFormaPagto(data.forma_pagto || 'DINHEIRO');
      await pool.query(`
        UPDATE receber SET 
          status = 'RECEBIDO', 
          data_pagto = ?, 
          valor_pago = ?, 
          forma_pagto = ?,
          obs = CONCAT(COALESCE(obs,''), '\n--- Recebimento em: ', NOW())
        WHERE id = ?
      `, [data.data_pagto || new Date(), data.valor_pago || data.valor, forma, id]);

      // Opcional: entra cheque na carteira sem alterar a baixa se falhar
      if (forma === 'CHEQUE' && data.cheque) {
        try {
          const { ensureChequesSchema } = require('../config/cheques-schema');
          const { hojeIsoBrasil } = require('../config/date-brasil');
          await ensureChequesSchema(pool);
          const ch = data.cheque;
          const valor = parseFloat(ch.valor || data.valor_pago || data.valor) || 0;
          const numero = String(ch.numero || '').trim();
          const bom = String(ch.bom_para || data.data_pagto || hojeIsoBrasil()).slice(0, 10);
          if (numero && valor > 0) {
            const [[tit]] = await pool.query(
              `SELECT cod_cliente FROM receber WHERE id=? LIMIT 1`, [id]
            ).catch(() => [[null]]);
            const [ins] = await pool.query(
              `INSERT INTO cheques
                (tipo, numero, banco_nome, agencia, conta, emitente, cpf_cnpj, valor, bom_para,
                 data_recebimento, id_receber, id_cliente, status, obs, excluido)
               VALUES ('T',?,?,?,?,?,?,?,?,?,?,'EM_CARTEIRA',?,'N')`,
              [
                numero,
                ch.banco_nome ? String(ch.banco_nome).toUpperCase() : null,
                ch.agencia || null,
                ch.conta || null,
                ch.emitente ? String(ch.emitente).toUpperCase() : null,
                ch.cpf_cnpj || null,
                valor,
                bom,
                String(data.data_pagto || hojeIsoBrasil()).slice(0, 10),
                id,
                parseInt(ch.id_cliente || tit?.cod_cliente, 10) || null,
                ch.obs || null,
              ]
            );
            try {
              const [cols] = await pool.query(`SHOW COLUMNS FROM receber LIKE 'id_cheque'`);
              if (cols.length) await pool.query(`UPDATE receber SET id_cheque=? WHERE id=?`, [ins.insertId, id]);
            } catch (_) {}
          }
        } catch (e) {
          console.error('[receber/cheque-carteira]', e.message);
        }
      }
    } else {
      const sets = [];
      const vals = [];
      
      // Auto-cadastra o cliente na edição caso não tenha ID
      if (!data.cod_fornecedor && data.nome_fornecedor) {
        const nomeTrim = data.nome_fornecedor.trim().toUpperCase();
        const [existing] = await pool.query(
          `SELECT id FROM fornecedores WHERE UPPER(nome) = ? AND (excluido='N' OR excluido IS NULL OR excluido='') LIMIT 1`, 
          [nomeTrim]
        );
        if (existing.length > 0) {
          data.cod_fornecedor = existing[0].id;
        } else {
          const [ins] = await pool.query(
            `INSERT INTO fornecedores (nome, tipo, status, excluido, dtcadastro) VALUES (?, 'ADMINISTRATIVO', 'A', 'N', CURDATE())`,
            [nomeTrim]
          );
          data.cod_fornecedor = ins.insertId;
        }
      }

      if (data.id_planoconta !== undefined) {
        data.id_planoconta = parseInt(data.id_planoconta, 10) || null;
      }
      if (data.id_centrocusto !== undefined) {
        data.id_centrocusto = parseInt(data.id_centrocusto, 10) || null;
      }

      const allowed = [
        'numero', 'vencimento', 'valor', 'status', 'obs', 'doc', 
        'cod_fornecedor', 'nome_fornecedor', 'id_receitas', 
        'data_pagto', 'forma_pagto', 'valor_pago', 
        'juros', 'vlrjuros', 'vlracressimo',
        'id_planoconta', 'id_centrocusto'
      ];
      
      allowed.forEach(field => {
        if (data[field] !== undefined) {
          sets.push(`${field} = ?`);
          vals.push(data[field]);
        }
      });

      if (sets.length > 0) {
        vals.push(id);
        await pool.query(`UPDATE receber SET ${sets.join(', ')} WHERE id = ?`, vals);
      }
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── EXCLUIR ─────────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const pool = getPool();
  try {
    await pool.query("UPDATE receber SET excluido = 'S' WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DEBUG STRUCT ────────────────────────────────────────────────────────────
router.get('/debug-struct', async (req, res) => {
  const pool = getPool();
  try {
    const [columns] = await pool.query("SHOW COLUMNS FROM receber");
    res.json(columns);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── FLUXO DE CAIXA ──────────────────────────────────────────────────────────
router.get('/cashflow', async (req, res) => {
    const pool = getPool();
    const { period, category } = req.query;

    let groupBy = 'DATE(data_pagto)';
    if (period === 'weekly') groupBy = 'WEEK(data_pagto)';
    if (period === 'monthly') groupBy = 'MONTH(data_pagto)';

    let whereClause = "WHERE excluido = 'N'";
    if (category === 'receber') whereClause += " AND tipo = 'ENTRADA'";
    if (category === 'pagar') whereClause += " AND tipo = 'SAIDA'";

    try {
        const [cashflow] = await pool.query(`
            SELECT 
                ${groupBy} as label,
                SUM(CASE WHEN tipo = 'ENTRADA' THEN valor ELSE 0 END) as entradas,
                SUM(CASE WHEN tipo = 'SAIDA' THEN valor ELSE 0 END) as saidas
            FROM caixa
            ${whereClause}
            GROUP BY ${groupBy}
            ORDER BY data_pagto ASC
        `);

        const [movements] = await pool.query(`
            SELECT 
                id, data_pagto as data, descricao, tipo, valor
            FROM caixa
            ${whereClause}
            ORDER BY data_pagto DESC
            LIMIT 50
        `);

        res.json({
            labels: cashflow.map(row => row.label),
            entradas: cashflow.map(row => row.entradas),
            saidas: cashflow.map(row => row.saidas),
            movements
        });
    } catch (err) {
        console.error('[cashflow]', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
