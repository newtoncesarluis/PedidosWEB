const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');
const {
  SQL_VENCIMENTO_ISO, SQL_VENCIMENTO_BR, mapPagarRow,
  extrairDataIso, vencimentoComRecorrencia,
} = require('../config/pagar-dates');
const {
  resolveDespesasLabelColumn,
  despesasLabelExpr,
} = require('../config/despesas-label');
const { ensureFinanceiroContabilCols } = require('../config/plano-contas-schema');

function hojeIsoBrasil() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

function mensagemErroPagar(err) {
  const msg = String(err?.message || err || '');
  if (/truncated/i.test(msg) && /numeronf/i.test(msg)) {
    return 'Não foi possível gravar: o Nº do título/NF aceita no máximo 25 caracteres.';
  }
  if (/truncated/i.test(msg)) {
    return 'Não foi possível gravar: algum campo passou do tamanho permitido no banco. '
      + 'Encurte o Nº do título/NF (máx. 25 caracteres) ou as observações e tente novamente.';
  }
  return msg || 'Não foi possível gravar a conta a pagar.';
}

/** Nº do Título / NF digitado pelo usuário → coluna numeronf (varchar 25). */
function normalizarNumeronfPagar(data) {
  const raw = data.numeronf != null ? String(data.numeronf).trim() : '';
  return raw ? raw.slice(0, 25) : null;
}

/** Código sequencial interno → coluna numero (INT): último + 1. */
async function proximoNumeroPagar(pool) {
  const [rows] = await pool.query(
    `SELECT COALESCE(MAX(numero), 0) + 1 AS proximo FROM pagar`
  );
  return parseInt(rows[0]?.proximo, 10) || 1;
}

/** doc legado: P + número com 6 dígitos (ex.: P002847). */
function docFromNumeroPagar(numero) {
  const n = parseInt(numero, 10) || 0;
  return ('P' + String(n).padStart(6, '0')).slice(0, 15);
}

function valorLancamentoPagar(data) {
  return parseFloat(data.valor) || 0;
}

async function nomeDespesaPorId(pool, idDesp) {
  const id = parseInt(idDesp, 10);
  if (!id) return null;
  await resolveDespesasLabelColumn(pool);
  const labelSql = despesasLabelExpr('d');
  const [rows] = await pool.query(
    `SELECT ${labelSql} AS nome FROM despesas d WHERE d.id = ? AND d.excluido = 'N' LIMIT 1`,
    [id]
  );
  return rows[0]?.nome || null;
}

const SQL_EXCLUIDO = "(p.excluido = 'N' OR p.excluido IS NULL OR p.excluido = '')";
const SQL_ABERTO = "(p.status IN ('ABERTA','ABERTO') OR p.status IS NULL OR p.status = '')";
const SQL_LIQUIDADO = "(p.status IN ('LIQUIDADO','PAGO','BAIXADO','QUITADO'))";
const SQL_ABERTO_COL = "(status IN ('ABERTA','ABERTO') OR status IS NULL OR status = '')";
const SQL_LIQUIDADO_COL = "(status IN ('LIQUIDADO','PAGO','BAIXADO','QUITADO'))";
const SQL_STATUS_DISPLAY = `CASE
    WHEN p.status IN ('LIQUIDADO','PAGO','BAIXADO','QUITADO') THEN 'LIQUIDADO'
    WHEN (${SQL_ABERTO}) AND p.vencimento < CURDATE() THEN 'EM ATRASO'
    ELSE 'ABERTA'
  END`;

/** Filtro de vencimento (mesma regra da listagem: DATE(vencimento)). */
function sqlFiltroPeriodoVencimento(dt_inicio, dt_fim, alias = 'p') {
  const col = alias ? `${alias}.vencimento` : 'vencimento';
  if (dt_inicio && dt_fim) {
    return { clause: ` AND DATE(${col}) BETWEEN ? AND ?`, params: [dt_inicio, dt_fim] };
  }
  if (dt_inicio) {
    return { clause: ` AND DATE(${col}) >= ?`, params: [dt_inicio] };
  }
  if (dt_fim) {
    return { clause: ` AND DATE(${col}) <= ?`, params: [dt_fim] };
  }
  return { clause: '', params: [] };
}

/** Filtro por data de pagamento (relatórios de contas pagas). */
function sqlFiltroPeriodoPagamento(dt_inicio, dt_fim, alias = 'p') {
  const col = alias ? `${alias}.data_pagto` : 'data_pagto';
  if (dt_inicio && dt_fim) {
    return { clause: ` AND DATE(${col}) BETWEEN ? AND ?`, params: [dt_inicio, dt_fim] };
  }
  if (dt_inicio) {
    return { clause: ` AND DATE(${col}) >= ?`, params: [dt_inicio] };
  }
  if (dt_fim) {
    return { clause: ` AND DATE(${col}) <= ?`, params: [dt_fim] };
  }
  return { clause: '', params: [] };
}

function parsePreferenciasGridConfigJson(raw) {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw;
  if (Buffer.isBuffer(raw)) {
    try { raw = raw.toString('utf8'); } catch { return null; }
  }
  if (typeof raw === 'object') return null;
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : null;
    } catch { return null; }
  }
  return null;
}

/** Ordenação da listagem (whitelist — evita SQL injection). */
const PAGAR_ORDEM_SQL = {
  venc_antigo: 'p.vencimento ASC, p.id ASC',
  venc_recente: 'p.vencimento DESC, p.id DESC',
  valor_maior: 'p.valor DESC, p.vencimento ASC',
  valor_menor: 'p.valor ASC, p.vencimento ASC',
};

function sqlOrdemPagar(ordem) {
  return PAGAR_ORDEM_SQL[ordem] || PAGAR_ORDEM_SQL.venc_antigo;
}

// ─── LISTAR CONTAS A PAGAR ───────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const pool = getPool();
  const {
    dt_inicio, dt_fim, status, fornecedor, id_despesas, id_despesa, id_natureza,
    id_planoconta, id_centrocusto, page, limit, ordem, filtro_data,
  } = req.query;
  const orderSql = sqlOrdemPagar(ordem);
  
  let where = SQL_EXCLUIDO;
  const params = [];

  const usarDataPagto = String(filtro_data || '').toLowerCase() === 'pagto' || String(filtro_data || '').toLowerCase() === 'pagamento';
  const filtroPeriodo = usarDataPagto
    ? sqlFiltroPeriodoPagamento(dt_inicio, dt_fim, 'p')
    : sqlFiltroPeriodoVencimento(dt_inicio, dt_fim, 'p');
  where += filtroPeriodo.clause;
  params.push(...filtroPeriodo.params);

  if (status === 'ABERTA') {
    where += ` AND ${SQL_ABERTO}`;
  } else if (status === 'LIQUIDADO') {
    where += ` AND ${SQL_LIQUIDADO}`;
  } else if (status === 'EM ATRASO') {
    where += ` AND ${SQL_ABERTO} AND p.vencimento < CURDATE()`;
  } else if (status && status !== 'T') {
    where += ' AND p.status = ?';
    params.push(status);
  }

  if (fornecedor) {
    where += ' AND (p.nome_fornecedor LIKE ? OR CAST(p.cod_fornecedor AS CHAR) LIKE ? OR p.doc LIKE ? OR p.numero LIKE ?)';
    params.push(`%${fornecedor}%`, `%${fornecedor}%`, `%${fornecedor}%`, `%${fornecedor}%`);
  }
  const despId = parseInt(id_despesas || id_despesa || id_natureza, 10);
  if (despId > 0) {
    where += ' AND p.id_despesas = ?';
    params.push(despId);
  }
  // Subquery: COUNT não faz JOIN com despesas — não referenciar alias `d` no WHERE
  const planoId = parseInt(id_planoconta, 10);
  if (planoId > 0) {
    where += ` AND COALESCE(p.id_planoconta, (SELECT d2.id_planoconta FROM despesas d2 WHERE d2.id = p.id_despesas LIMIT 1)) = ?`;
    params.push(planoId);
  }
  const centroId = parseInt(id_centrocusto, 10);
  if (centroId > 0) {
    where += ' AND p.id_centrocusto = ?';
    params.push(centroId);
  }

  const p = parseInt(page, 10) || 1;
  const limReq = parseInt(limit, 10) || 50;
  const lim = Math.min(Math.max(limReq, 1), 10000);
  const offset = (p - 1) * lim;

  try {
    await resolveDespesasLabelColumn(pool);
    const despNome = despesasLabelExpr('d');

    const [totalRows] = await pool.query(`SELECT COUNT(*) as total FROM pagar p WHERE ${where}`, params);
    const total = totalRows[0]?.total || 0;

    await ensureFinanceiroContabilCols(pool).catch(() => {});

    const [rows] = await pool.query(`
      SELECT 
        p.*, 
        ${despNome} AS nome_natureza,
        COALESCE(NULLIF(TRIM(p.despesas), ''), ${despNome}) AS nome_despesa,
        COALESCE(p.id_planoconta, d.id_planoconta) AS id_planoconta_resolvido,
        pc.numero AS planoconta_numero,
        pc.descricao AS planoconta_nome,
        cc.codigo AS centrocusto_codigo,
        cc.descricao AS centrocusto_nome,
        ${SQL_VENCIMENTO_ISO} AS vencimento_iso,
        ${SQL_VENCIMENTO_BR} AS vencimento_br,
        ${SQL_STATUS_DISPLAY} AS status_display
      FROM pagar p
      LEFT JOIN despesas d ON p.id_despesas = d.id
      LEFT JOIN plano_contas pc ON pc.id = COALESCE(p.id_planoconta, d.id_planoconta)
      LEFT JOIN centro_custo cc ON cc.id = p.id_centrocusto
      WHERE ${where} 
      ORDER BY ${orderSql}
      LIMIT ? OFFSET ?
    `, [...params, lim, offset]);

    const periodoFiltro = sqlFiltroPeriodoVencimento(dt_inicio, dt_fim, 'p');
    const [periodoRows] = await pool.query(`
      SELECT COALESCE(SUM(p.valor), 0) AS total, COUNT(*) AS qtd
      FROM pagar p
      WHERE ${SQL_EXCLUIDO}${periodoFiltro.clause}
    `, periodoFiltro.params);
    const pr = periodoRows[0] || {};
    const periodo = {
      total: parseFloat(pr.total) || 0,
      qtd: parseInt(pr.qtd, 10) || 0,
    };

    res.json({ data: rows.map(mapPagarRow), total, page: p, limit: lim, periodo });
  } catch (err) {
    console.error('[pagar/listar]', err.message);
    res.status(500).json({ error: mensagemErroPagar(err) });
  }
});

// ─── CRIAR TÍTULO (COM RECORRÊNCIA) ───────────────────────────────────────────
router.post('/', async (req, res) => {
  const pool = getPool();
  const data = req.body;
  const numRecorrencias = parseInt(data.recorrencia) || 1;

  const vencBase = extrairDataIso(data.vencimento);
  if (!vencBase) {
    return res.status(400).json({ error: 'Informe a data de vencimento válida' });
  }
  
  try {
    await ensureFinanceiroContabilCols(pool);
    const idDesp = parseInt(data.id_despesas, 10) || null;
    const despesasTxt = data.despesas || (await nomeDespesaPorId(pool, idDesp));
    const idPlano = data.id_planoconta !== undefined && data.id_planoconta !== ''
      ? (parseInt(data.id_planoconta, 10) || null)
      : null;
    const idCentro = data.id_centrocusto !== undefined && data.id_centrocusto !== ''
      ? (parseInt(data.id_centrocusto, 10) || null)
      : null;
    const numeronf = normalizarNumeronfPagar(data);
    // Auto-cadastra o fornecedor caso seja novo e tenha apenas o nome
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
      const vencimento = vencimentoComRecorrencia(vencBase, i);
      const status = data.status || 'ABERTA';
      const vlrPago = status === 'LIQUIDADO' ? (data.vlrpago || data.valor) : 0;
      const dataPagto = status === 'LIQUIDADO'
        ? (extrairDataIso(data.data_pagto) || hojeIsoBrasil())
        : null;
      const numero = await proximoNumeroPagar(pool);
      const doc = docFromNumeroPagar(numero);
      const vlr = valorLancamentoPagar(data);

      const [result] = await pool.query(`
        INSERT INTO pagar (
          numero, tipo, vencimento, valor, valor_pagar, vlrcomjuros, status, obs, doc, numeronf,
          prazo, parcela, forma_pagto, qt_parcelas, historico_rec, cond_pagto,
          cod_fornecedor, nome_fornecedor, data_lanc, id_natureza,
          id_despesas, despesas, cod_vendedor, data_pagto, vlrpago,
          forma_foipagto, juros, vlrjuros, vrljuros, vlracressimo,
          id_planoconta, id_centrocusto, excluido
        ) VALUES (?, 'PAGAR', STR_TO_DATE(?, '%Y-%m-%d'), ?, ?, ?, ?, ?, ?, ?, 1, 1, 'DINHEIRO', 1, 'PAGAMENTO EFETUADO', 'DINHEIRO',
          ?, ?, NOW(), ?, ?, ?, ?, ?, ?, 'DINHEIRO', ?, ?, ?, ?, ?, ?, 'N')
      `, [
        numero, vencimento, vlr, vlr, vlr,
        status, data.obs || null, doc, numeronf,
        finalCodFornecedor, data.nome_fornecedor || null,
        null, idDesp, despesasTxt,
        data.cod_vendedor || null, dataPagto, vlrPago,
        parseFloat(data.juros) || 0, parseFloat(data.vlrjuros) || 0, parseFloat(data.vlrjuros) || 0, parseFloat(data.vlracressimo) || 0,
        idPlano, idCentro
      ]);
      results.push(result.insertId);
    }
    res.status(201).json({ ok: true, ids: results });
  } catch (err) {
    console.error('[pagar/criar]', err.message);
    res.status(500).json({ error: mensagemErroPagar(err) });
  }
});

// ─── BAIXAR EM LOTE ──────────────────────────────────────────────────────────
router.post('/lote/baixar', async (req, res) => {
  const pool = getPool();
  const { ids, data_pagto, forma_foipagto } = req.body;

  if (!ids || !ids.length) return res.status(400).json({ error: 'Nenhum título selecionado' });

  try {
    const dt = data_pagto || new Date();
    const forma = forma_foipagto || 'DINHEIRO';

    await pool.query(`
      UPDATE pagar SET 
        status = 'LIQUIDADO', 
        data_pagto = ?, 
        vlrpago = valor, 
        forma_foipagto = ?,
        obs = CONCAT(COALESCE(obs,''), '\n--- Baixa em lote em: ', NOW())
      WHERE id IN (?) AND ${SQL_ABERTO_COL}
    `, [dt, forma, ids]);

    res.json({ ok: true, message: `${ids.length} títulos baixados com sucesso.` });
  } catch (err) {
    console.error('[pagar/baixa-lote]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── ATUALIZAR TÍTULO ────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  const pool = getPool();
  const data = req.body;
  const { id } = req.params;

  try {
    if (data.estornar) {
      const sqlExcluidoTitulo = "(excluido = 'N' OR excluido IS NULL OR excluido = '')";
      await pool.query(`
        UPDATE pagar SET
          status = 'ABERTA',
          data_pagto = NULL,
          vlrpago = 0,
          forma_foipagto = NULL,
          juros = 0,
          vlrjuros = 0,
          vlracressimo = 0,
          valor_pagar = COALESCE(valor, 0),
          vlrcomjuros = COALESCE(valor, 0)
        WHERE id = ? AND ${sqlExcluidoTitulo}
      `, [id]);
      return res.json({ ok: true, estornado: true });
    }
    if (data.baixar) {
      await pool.query(`
        UPDATE pagar SET 
          status = 'LIQUIDADO', 
          data_pagto = ?, 
          vlrpago = ?, 
          forma_foipagto = ?,
          obs = CONCAT(COALESCE(obs,''), '\n--- Baixa em: ', NOW())
        WHERE id = ?
      `, [
        extrairDataIso(data.data_pagto) || hojeIsoBrasil(),
        data.vlrpago || data.valor,
        data.forma_foipagto || 'DINHEIRO',
        id,
      ]);
    } else {
      const sets = [];
      const vals = [];
      if (data.valor !== undefined && data.valor === '') data.valor = 0;
      else if (data.valor !== undefined) {
        const vlr = parseFloat(data.valor) || 0;
        data.valor = vlr;
        data.valor_pagar = vlr;
        data.vlrcomjuros = vlr;
      }

      // Auto-cadastra o fornecedor na edição, caso não possua ID
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

      if (data.id_despesas !== undefined) {
        const idDesp = parseInt(data.id_despesas, 10) || null;
        data.id_despesas = idDesp;
        if (idDesp && !data.despesas) {
          data.despesas = await nomeDespesaPorId(pool, idDesp);
        }
      }

      if (data.numeronf !== undefined) {
        data.numeronf = normalizarNumeronfPagar(data);
      }
      if (data.doc !== undefined) {
        data.doc = data.doc != null ? String(data.doc).trim().slice(0, 15) || null : null;
      }

      if (data.id_planoconta !== undefined) {
        data.id_planoconta = parseInt(data.id_planoconta, 10) || null;
      }
      if (data.id_centrocusto !== undefined) {
        data.id_centrocusto = parseInt(data.id_centrocusto, 10) || null;
      }

      const allowed = [
        'vencimento', 'valor', 'valor_pagar', 'vlrcomjuros', 'status', 'obs', 'doc', 'numeronf',
        'cod_fornecedor', 'nome_fornecedor', 'id_despesas', 'despesas',
        'data_pagto', 'forma_foipagto', 'vlrpago',
        'juros', 'vlrjuros', 'vrljuros', 'vlracressimo',
        'id_planoconta', 'id_centrocusto'
      ];
      
      allowed.forEach(field => {
        if (data[field] !== undefined) {
          sets.push(`${field} = ?`);
          let val = data[field];
          if (field === 'vencimento' || field === 'data_pagto') {
            val = extrairDataIso(val);
          }
          vals.push(val);
        }
      });

      if (sets.length > 0) {
        vals.push(id);
        await pool.query(`UPDATE pagar SET ${sets.join(', ')} WHERE id = ?`, vals);
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[pagar/atualizar]', err.message);
    res.status(500).json({ error: mensagemErroPagar(err) });
  }
});

// ─── ESTATÍSTICAS (KPIs) ──────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  const pool = getPool();
  const { dt_inicio, dt_fim } = req.query;
  try {
    const [rows] = await pool.query(`
      SELECT 
        SUM(CASE WHEN ${SQL_ABERTO} AND p.vencimento < CURDATE() THEN p.valor ELSE 0 END) as total_vencido,
        SUM(CASE WHEN ${SQL_ABERTO} AND p.vencimento >= CURDATE() THEN p.valor ELSE 0 END) as total_pendente,
        SUM(CASE WHEN ${SQL_LIQUIDADO} AND DATE(p.data_pagto) = CURDATE() THEN COALESCE(p.vlrpago, p.valor) ELSE 0 END) as total_pago_hoje,
        COUNT(CASE WHEN ${SQL_ABERTO} AND p.vencimento < CURDATE() THEN 1 END) as qtd_vencidos
      FROM pagar p
      WHERE ${SQL_EXCLUIDO}
    `);
    const periodoFiltro = sqlFiltroPeriodoVencimento(dt_inicio, dt_fim, 'p');
    const [periodoRows] = await pool.query(`
      SELECT COALESCE(SUM(p.valor), 0) AS total_periodo, COUNT(*) AS qtd_periodo
      FROM pagar p
      WHERE ${SQL_EXCLUIDO}${periodoFiltro.clause}
    `, periodoFiltro.params);
    const row = rows[0] || {};
    const pr = periodoRows[0] || {};
    res.json({
      total_vencido: parseFloat(row.total_vencido) || 0,
      total_pendente: parseFloat(row.total_pendente) || 0,
      total_pago_hoje: parseFloat(row.total_pago_hoje) || 0,
      qtd_vencidos: parseInt(row.qtd_vencidos, 10) || 0,
      total_periodo: parseFloat(pr.total_periodo) || 0,
      qtd_periodo: parseInt(pr.qtd_periodo, 10) || 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ANALISE / DASHBOARD AVANÇADO ─────────────────────────────────────────────
router.get('/analise', async (req, res) => {
  const pool = getPool();
  const { dt_inicio, dt_fim } = req.query;
  const dtIni = dt_inicio || '2000-01-01';
  const dtFim = dt_fim   || '2100-12-31';

  try {
    await resolveDespesasLabelColumn(pool);
    const despNome = despesasLabelExpr('d');

    const [topDespesas] = await pool.query(`
      SELECT nome_fornecedor, SUM(valor) as total, COUNT(*) as qtd
      FROM pagar 
      WHERE excluido = 'N' AND vencimento BETWEEN ? AND ?
      GROUP BY nome_fornecedor 
      ORDER BY total DESC 
      LIMIT 10
    `, [dtIni, dtFim]);

    // 2. Agrupamento por natureza (despesas)
    const [porNatureza] = await pool.query(`
      SELECT ${despNome} AS nome, SUM(p.valor) as total
      FROM pagar p
      LEFT JOIN despesas d ON p.id_despesas = d.id
      WHERE p.excluido = 'N' AND DATE(p.vencimento) BETWEEN ? AND ?
      GROUP BY ${despNome}
      ORDER BY total DESC
    `, [dtIni, dtFim]);

    // 3. Métricas de Comissão e ROI
    const [comissaoROI] = await pool.query(`
      SELECT 
        SUM(p.valor) as total_comissao,
        SUM(ped.vlrtotalpedido) as total_vendas,
        (SUM(ped.vlrtotalpedido) / NULLIF(SUM(p.valor), 0)) as roi
      FROM pagar p
      INNER JOIN pedidos ped ON p.id_pedido = ped.numero
      WHERE p.excluido = 'N' AND p.tipo = 'COMISSAO' 
        AND p.vencimento BETWEEN ? AND ?
    `, [dtIni, dtFim]);

    // 4. Histórico Mensal
    const [historico] = await pool.query(`
      SELECT 
        DATE_FORMAT(vencimento, '%Y-%m') as mes,
        SUM(CASE WHEN status = 'LIQUIDADO' THEN vlrpago ELSE 0 END) as pago,
        SUM(CASE WHEN status = 'ABERTA' THEN valor ELSE 0 END) as pendente
      FROM pagar
      WHERE excluido = 'N' AND vencimento >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
      GROUP BY mes
      ORDER BY mes ASC
    `);

    res.json({
      topDespesas,
      porNatureza,
      metrics: comissaoROI[0] || { total_comissao: 0, total_vendas: 0, roi: 0 },
      historico
    });
  } catch (err) {
    console.error('[pagar/analise]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── DASHBOARD TOP 10 ─────────────────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  const pool = getPool();
  try {
    const [topAbertas] = await pool.query(`
      SELECT nome_fornecedor as fornecedor, SUM(valor) as total
      FROM pagar 
      WHERE (excluido = 'N' OR excluido IS NULL OR excluido = '') AND ${SQL_ABERTO_COL}
      GROUP BY nome_fornecedor 
      ORDER BY total DESC 
      LIMIT 10
    `);

    const [topPagas] = await pool.query(`
      SELECT nome_fornecedor as fornecedor, SUM(COALESCE(vlrpago, valor)) as total
      FROM pagar 
      WHERE (excluido = 'N' OR excluido IS NULL OR excluido = '') AND ${SQL_LIQUIDADO_COL}
      GROUP BY nome_fornecedor 
      ORDER BY total DESC 
      LIMIT 10
    `);

    res.json({ topAbertas, topPagas });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── TIMELINE FINANCEIRA (HOME) ───────────────────────────────────────────────
router.get('/timeline', async (req, res) => {
  const pool = getPool();
  try {
    const [rows] = await pool.query(`
      SELECT 
        SUM(CASE WHEN status = 'ABERTA' AND vencimento = CURDATE() THEN valor ELSE 0 END) as vlr_hoje,
        COUNT(CASE WHEN status = 'ABERTA' AND vencimento = CURDATE() THEN 1 END) as qtd_hoje,
        SUM(CASE WHEN status = 'ABERTA' AND vencimento > CURDATE() AND vencimento <= DATE_ADD(CURDATE(), INTERVAL 7 DAY) THEN valor ELSE 0 END) as vlr_semana,
        COUNT(CASE WHEN status = 'ABERTA' AND vencimento > CURDATE() AND vencimento <= DATE_ADD(CURDATE(), INTERVAL 7 DAY) THEN 1 END) as qtd_semana,
        SUM(CASE WHEN status = 'ABERTA' AND vencimento < CURDATE() THEN valor ELSE 0 END) as vlr_atrasado,
        COUNT(CASE WHEN status = 'ABERTA' AND vencimento < CURDATE() THEN 1 END) as qtd_atrasado
      FROM pagar 
      WHERE excluido = 'N'
    `);
    res.json(rows[0] || { vlr_hoje: 0, qtd_hoje: 0, vlr_semana: 0, qtd_semana: 0, vlr_atrasado: 0, qtd_atrasado: 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PREFERÊNCIAS DE COLUNAS DA LISTA (igual pedidos → preferencias_grid) ─────
router.get('/config/grid', async (req, res) => {
  try {
    const pool = getPool();
    const id_usuario = req.user?.id;
    if (!id_usuario) return res.status(401).json({ error: 'Usuário não identificado' });
    const [rows] = await pool.query(
      `SELECT config_json FROM preferencias_grid WHERE id_usuario = ? AND nome_grid = 'pagar_lista'`,
      [id_usuario]
    );
    const cfg = parsePreferenciasGridConfigJson(rows[0]?.config_json);
    res.json({ config: cfg && cfg.length ? cfg : null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/config/grid', async (req, res) => {
  try {
    const pool = getPool();
    const id_usuario = req.user?.id;
    if (!id_usuario) return res.status(401).json({ error: 'Usuário não identificado' });
    const { config } = req.body;
    if (!Array.isArray(config)) {
      return res.status(400).json({ error: 'config deve ser um array de colunas' });
    }
    const json = JSON.stringify(config);
    await pool.query(
      `INSERT INTO preferencias_grid (id_usuario, nome_grid, config_json, dt_alterado)
       VALUES (?, 'pagar_lista', ?, NOW())
       ON DUPLICATE KEY UPDATE config_json = VALUES(config_json), dt_alterado = NOW()`,
      [id_usuario, json]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[pagar/config/grid] POST', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── EXCLUIR (SOFT DELETE + motivo em historico_rec) ─────────────────────────
router.delete('/:id', async (req, res) => {
  const pool = getPool();
  const id = req.params.id;
  const motivo = String(req.body?.motivo || req.query?.motivo || '').trim();
  if (!motivo) {
    return res.status(400).json({ error: 'Informe o motivo da exclusão.' });
  }
  const sqlExcluidoTitulo = "(excluido = 'N' OR excluido IS NULL OR excluido = '')";
  try {
    const [result] = await pool.query(`
      UPDATE pagar SET
        excluido = 'S',
        historico_rec = TRIM(CONCAT(
          COALESCE(historico_rec, ''),
          CASE WHEN COALESCE(TRIM(historico_rec), '') <> '' THEN '\\n' ELSE '' END,
          'EXCLUSÃO: ',
          ?
        ))
      WHERE id = ? AND ${sqlExcluidoTitulo} AND ${SQL_ABERTO_COL}
    `, [motivo.slice(0, 500), id]);
    if (!result.affectedRows) {
      return res.status(400).json({
        error: 'Não foi possível excluir. O título precisa estar ABERTO (estorne antes, se estiver liquidado).',
      });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[pagar/excluir]', err.message);
    res.status(500).json({ error: mensagemErroPagar(err) });
  }
});

module.exports = router;
