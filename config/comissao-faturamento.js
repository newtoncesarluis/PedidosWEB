/**
 * Comissão por Faturamento (modelo "escritório de representação").
 *
 * Opt-in por CNPJ da empresa (licenciado): só vale quando o CNPJ da empresa
 * do pedido/usuário está em `sistemas.comissao_fat_cnpjs` (lista separada por
 * vírgula/ponto-e-vírgula/quebra de linha) ou na env `COMISSAO_FAT_CNPJS`.
 * Sem CNPJ na lista → fluxo antigo (provisão por parcela) inalterado.
 *
 * Regras (doc "Regras de Pedido, Faturamento e Comissão"):
 *  - % do pedido vem da fábrica e é editável; no faturamento o % também é editável
 *    e fica gravado no faturamento (o % do pedido é preservado).
 *  - Comissão = valor efetivamente faturado × % do faturamento.
 *  - Cada faturamento gera UMA linha de comissão (pagtocomissao.id_faturamento),
 *    na data do faturamento — nunca parcelada.
 *  - Diferença (saldo antes − faturado) → CANCELADA ou SALDO (próxima fatura).
 *    Saldo = vlrtotalpedido − Σ faturado − Σ diferenças canceladas.
 *  - Divisão: % escritório (padrão sistemas.comissao_fat_pct_escritorio = 30)
 *    e % representante (padrão usuarios.comissao_fat_pct_rep ou 100 − escritório).
 */

const { hojeIsoBrasil } = require('./date-brasil');

const CACHE_TTL_MS = 60 * 1000;
const _schemaOk = new Set();
const _cfgCache = new Map();

function round2(n) {
  return Math.round((parseFloat(n) || 0) * 100) / 100;
}

function normCnpj(s) {
  return String(s || '').replace(/\D/g, '');
}

function parseListaCnpjs(txt) {
  return String(txt || '')
    .split(/[,;\n\r\s]+/)
    .map(normCnpj)
    .filter(c => c.length >= 11);
}

async function _dbName(pool) {
  const [[r]] = await pool.query('SELECT DATABASE() AS db');
  return r?.db || '';
}

async function _addColumnIfMissing(pool, table, column, type) {
  const [cols] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  if (!cols.length) {
    await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${type}`).catch(e => {
      if (!/Duplicate column/i.test(e.message)) console.warn(`[comissao-fat] ADD ${table}.${column}:`, e.message);
    });
  }
}

/** Cria tabela/colunas usadas pelo modo (idempotente, cacheado por base). */
async function ensureComissaoFaturamentoSchema(pool) {
  const db = await _dbName(pool);
  if (_schemaOk.has(db)) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pedido_faturamentos (
      id INT NOT NULL AUTO_INCREMENT,
      id_pedido INT NOT NULL,
      numpedido VARCHAR(20) NULL,
      cod_fornecedor INT NULL,
      cod_cliente INT NULL,
      id_representante INT NULL,
      id_empresa INT NULL,
      data_faturamento DATE NOT NULL,
      numeronf VARCHAR(30) NULL,
      serie_nf VARCHAR(10) NULL,
      nf_fabrica VARCHAR(30) NULL,
      vlr_pedido DECIMAL(15,2) NOT NULL DEFAULT 0,
      saldo_anterior DECIMAL(15,2) NOT NULL DEFAULT 0,
      vlr_faturado DECIMAL(15,2) NOT NULL DEFAULT 0,
      diferenca DECIMAL(15,2) NOT NULL DEFAULT 0,
      destino_diferenca VARCHAR(10) NULL,
      pct_comissao_pedido DECIMAL(7,4) NULL,
      pct_comissao DECIMAL(7,4) NOT NULL DEFAULT 0,
      vlr_comissao DECIMAL(15,2) NOT NULL DEFAULT 0,
      pct_escritorio DECIMAL(7,4) NOT NULL DEFAULT 0,
      vlr_escritorio DECIMAL(15,2) NOT NULL DEFAULT 0,
      pct_representante DECIMAL(7,4) NOT NULL DEFAULT 0,
      vlr_representante DECIMAL(15,2) NOT NULL DEFAULT 0,
      situacao_anterior VARCHAR(50) NULL,
      obs TEXT NULL,
      id_usuario_cad INT NULL,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      excluido CHAR(1) NOT NULL DEFAULT 'N',
      id_usuario_exc INT NULL,
      excluido_em DATETIME NULL,
      PRIMARY KEY (id),
      KEY idx_pf_pedido (id_pedido),
      KEY idx_pf_data (data_faturamento),
      KEY idx_pf_forn (cod_fornecedor),
      KEY idx_pf_rep (id_representante)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await _addColumnIfMissing(pool, 'pedido_faturamentos', 'origem', "VARCHAR(20) NULL DEFAULT NULL");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS comissao_fat_reversao (
      id INT NOT NULL AUTO_INCREMENT,
      id_faturamento INT NOT NULL,
      id_pedido INT NOT NULL,
      numpedido VARCHAR(20) NULL,
      snapshot_pedido LONGTEXT NULL,
      snapshot_comissoes LONGTEXT NULL,
      revertido CHAR(1) NOT NULL DEFAULT 'N',
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      revertido_em DATETIME NULL,
      id_usuario_rev INT NULL,
      PRIMARY KEY (id),
      KEY idx_cfr_fat (id_faturamento),
      KEY idx_cfr_ped (id_pedido)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await _addColumnIfMissing(pool, 'pagtocomissao', 'id_faturamento', 'INT NULL DEFAULT NULL');
  await _addColumnIfMissing(pool, 'pedidos', 'saldo_faturar', 'DECIMAL(15,2) NULL DEFAULT NULL');
  await _addColumnIfMissing(pool, 'usuarios', 'comissao_fat_pct_rep', 'DECIMAL(5,2) NULL DEFAULT NULL');
  await _addColumnIfMissing(pool, 'sistemas', 'comissao_fat_cnpjs', 'TEXT NULL');
  await _addColumnIfMissing(pool, 'sistemas', 'comissao_fat_pct_escritorio', 'DECIMAL(5,2) NULL DEFAULT 30.00');
  _schemaOk.add(db);
}

/**
 * Config do modo para a empresa informada (ou a do usuário logado).
 * @returns {Promise<{ativo:boolean, pctEscritorio:number, cnpjEmpresa:string, idEmpresa:number|null}>}
 */
async function getComissaoFatConfig(pool, req, idEmpresaPedido) {
  const idEmpresa = parseInt(idEmpresaPedido || req?.user?.id_empresa || 0, 10) || null;
  const db = await _dbName(pool);
  const key = `${db}|${idEmpresa || 0}`;
  const hit = _cfgCache.get(key);
  if (hit && Date.now() - hit.t < CACHE_TTL_MS) return hit.v;

  const out = { ativo: false, pctEscritorio: 30, cnpjEmpresa: '', idEmpresa };
  try {
    await ensureComissaoFaturamentoSchema(pool);
    const [[sis]] = await pool.query(
      `SELECT comissao_fat_cnpjs, comissao_fat_pct_escritorio FROM sistemas ORDER BY id DESC LIMIT 1`
    ).catch(() => [[null]]);
    const lista = new Set([
      ...parseListaCnpjs(sis?.comissao_fat_cnpjs),
      ...parseListaCnpjs(process.env.COMISSAO_FAT_CNPJS),
    ]);
    const pctE = parseFloat(sis?.comissao_fat_pct_escritorio);
    if (Number.isFinite(pctE) && pctE >= 0 && pctE <= 100) out.pctEscritorio = pctE;

    if (lista.size) {
      const [emp] = idEmpresa
        ? await pool.query(`SELECT cnpj FROM empresa WHERE id_empresa = ? LIMIT 1`, [idEmpresa]).catch(() => [[]])
        : await pool.query(
            `SELECT cnpj FROM empresa WHERE (excluido IS NULL OR excluido = 'N') ORDER BY id_empresa LIMIT 1`
          ).catch(() => pool.query(`SELECT cnpj FROM empresa ORDER BY id_empresa LIMIT 1`).catch(() => [[]]));
      out.cnpjEmpresa = normCnpj(emp[0]?.cnpj);
      out.ativo = !!out.cnpjEmpresa && lista.has(out.cnpjEmpresa);
    }
  } catch (e) {
    console.warn('[comissao-fat] config:', e.message);
  }
  _cfgCache.set(key, { t: Date.now(), v: out });
  return out;
}

function invalidateComissaoFatCache() {
  _cfgCache.clear();
}

/** % do representante: override do usuário, senão 100 − % escritório. */
async function getPctRepresentante(pool, idUsuario, pctEscritorio) {
  if (idUsuario) {
    const [[u]] = await pool.query(
      `SELECT comissao_fat_pct_rep FROM usuarios WHERE idusuario = ? LIMIT 1`,
      [idUsuario]
    ).catch(() => [[null]]);
    const v = parseFloat(u?.comissao_fat_pct_rep);
    if (Number.isFinite(v) && v >= 0 && v <= 100) return v;
  }
  return round2(100 - (parseFloat(pctEscritorio) || 0));
}

/** Soma dos faturamentos ativos + diferenças canceladas de um pedido. */
async function totaisFaturamentoPedido(conn, idPedido) {
  const [[t]] = await conn.query(
    `SELECT COUNT(*) AS qtd,
            COALESCE(SUM(vlr_faturado),0) AS faturado,
            COALESCE(SUM(CASE WHEN destino_diferenca = 'CANCELADA' THEN diferenca ELSE 0 END),0) AS cancelado,
            COALESCE(SUM(vlr_comissao),0) AS comissao
     FROM pedido_faturamentos WHERE id_pedido = ? AND excluido = 'N'`,
    [idPedido]
  );
  return {
    qtd: parseInt(t.qtd, 10) || 0,
    faturado: round2(t.faturado),
    cancelado: round2(t.cancelado),
    comissao: round2(t.comissao),
  };
}

function calcSaldo(vlrPedido, totais) {
  return Math.max(0, round2((parseFloat(vlrPedido) || 0) - totais.faturado - totais.cancelado));
}

/** Cálculo puro de um faturamento (usado no back e espelhado no front). */
function calcularFaturamento({ saldoAnterior, vlrFaturado, pctComissao, pctRepresentante }) {
  const vlrFat = round2(vlrFaturado);
  const pct = parseFloat(pctComissao) || 0;
  const pctRep = Math.min(100, Math.max(0, parseFloat(pctRepresentante) || 0));
  const vlrCom = round2(vlrFat * pct / 100);
  const vlrRep = round2(vlrCom * pctRep / 100);
  return {
    vlr_faturado: vlrFat,
    diferenca: Math.max(0, round2((parseFloat(saldoAnterior) || 0) - vlrFat)),
    pct_comissao: pct,
    vlr_comissao: vlrCom,
    pct_representante: pctRep,
    vlr_representante: vlrRep,
    pct_escritorio: round2(100 - pctRep),
    vlr_escritorio: round2(vlrCom - vlrRep),
  };
}

async function _colunaExiste(pool, table, column) {
  const [cols] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  return cols.length > 0;
}

/**
 * Pedidos já faturados no modelo antigo (sem linha em pedido_faturamentos).
 * Comissão já baixada (status diferente de P/I) não entra: criar outra linha duplicaria o pagamento.
 */
async function listarPedidosJaFaturadosLegado(pool, cfg) {
  await ensureComissaoFaturamentoSchema(pool);
  if (!cfg?.ativo) return { ativo: false, elegiveis: [], ignorados: [] };

  const temEmpresa = await _colunaExiste(pool, 'pedidos', 'id_empresa');
  const filtroEmp = temEmpresa && cfg.idEmpresa
    ? ' AND (p.id_empresa IS NULL OR p.id_empresa = 0 OR p.id_empresa = ?)'
    : '';
  const params = temEmpresa && cfg.idEmpresa ? [cfg.idEmpresa] : [];

  const [rows] = await pool.query(
    `SELECT p.id, p.numero, p.vlrtotalpedido,
            COALESCE(p.vlr_faturado, 0) AS vlr_faturado,
            DATE_FORMAT(p.data_faturado, '%Y-%m-%d') AS data_faturado,
            p.numeronf, p.serie_nf, p.nf_fabrica, p.comissao,
            p.cod_fornecedor, p.cod_cliente, p.id_usuario, p.situacao_pedido,
            COALESCE(pc.abertas, 0) AS com_abertas,
            COALESCE(pc.outras, 0) AS com_outras
       FROM pedidos p
       LEFT JOIN (
         SELECT pedido,
                SUM(CASE WHEN status IN ('P','I') THEN 1 ELSE 0 END) AS abertas,
                SUM(CASE WHEN status NOT IN ('P','I') THEN 1 ELSE 0 END) AS outras
           FROM pagtocomissao
          WHERE COALESCE(excluido,'N') = 'N' AND id_faturamento IS NULL
          GROUP BY pedido
       ) pc ON pc.pedido = CAST(p.numero AS CHAR)
      WHERE COALESCE(p.excluido,'N') = 'N'
        AND UPPER(COALESCE(p.situacao_pedido,'')) <> 'CANCELADO'
        AND (
          UPPER(COALESCE(p.situacao_pedido,'')) = 'FATURADO'
          OR UPPER(COALESCE(p.informado_faturamento,'')) = 'S'
        )
        AND NOT EXISTS (
          SELECT 1 FROM pedido_faturamentos pf
           WHERE pf.id_pedido = p.id AND pf.excluido = 'N'
        )
        ${filtroEmp}`,
    params
  );

  const elegiveis = [];
  const ignorados = [];
  for (const r of rows) {
    if ((parseInt(r.com_outras, 10) || 0) > 0) ignorados.push(r);
    else elegiveis.push(r);
  }
  return { ativo: true, elegiveis, ignorados };
}

const OBS_LEGADO = 'Convertido do faturamento já existente';

function _valorSql(v) {
  if (v == null) return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    const p = (n) => String(n).padStart(2, '0');
    const dia = `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
    if (!v.getHours() && !v.getMinutes() && !v.getSeconds()) return dia;
    return `${dia} ${p(v.getHours())}:${p(v.getMinutes())}:${p(v.getSeconds())}`;
  }
  if (typeof v === 'bigint') return Number(v);
  if (Buffer.isBuffer(v)) return v.toString();
  return v;
}

function _jsonLinhas(rows) {
  return JSON.stringify((rows || []).map((row) => {
    const o = {};
    for (const [k, v] of Object.entries(row)) o[k] = _valorSql(v);
    return o;
  }));
}

function _resumoLegado(lista) {
  return {
    qtd: lista.elegiveis.length,
    ignorados_baixados: lista.ignorados.length,
    amostra_ignorados: lista.ignorados.slice(0, 12).map(r => String(r.numero)),
  };
}

const _acoes = new Map();

async function _chaveAcao(pool, req, tipo) {
  return `${await _dbName(pool)}|${req.user?.id || 0}|${tipo}`;
}

async function _contarJaConvertidos(pool) {
  await ensureComissaoFaturamentoSchema(pool);
  const [[r]] = await pool.query(
    `SELECT COUNT(*) AS n FROM pedido_faturamentos
      WHERE excluido = 'N' AND (origem = 'LEGADO' OR obs = ?)`,
    [OBS_LEGADO]
  );
  return parseInt(r?.n, 10) || 0;
}

/** Monta a fila uma vez. Os lotes seguintes só consomem essa fila e devolvem o andamento. */
async function prepararAplicacaoLegado(pool, req) {
  const cfg = await getComissaoFatConfig(pool, req);
  if (!cfg.ativo) {
    const err = new Error('A comissão por faturamento não está habilitada para o CNPJ desta empresa.');
    err.status = 400;
    throw err;
  }
  const lista = await listarPedidosJaFaturadosLegado(pool, cfg);
  const chave = await _chaveAcao(pool, req, 'aplicar');
  _acoes.set(chave, {
    cfg,
    fila: lista.elegiveis,
    ignorados: lista.ignorados.length,
    cursor: 0,
    aplicados: 0,
    erros: [],
    pctCache: new Map(),
    busy: false,
    t: Date.now(),
  });
  return { ..._resumoLegado(lista), ja_convertidos: await _contarJaConvertidos(pool) };
}

async function prepararReversaoLegado(pool, req) {
  const lista = await listarConversoesLegado(pool);
  const chave = await _chaveAcao(pool, req, 'reverter');
  _acoes.set(chave, {
    fila: lista.elegiveis,
    bloqueados_baixados: lista.bloqueadosBaixados.length,
    bloqueados_posteriores: lista.bloqueadosPosteriores.length,
    cursor: 0,
    revertidos: 0,
    semCopia: 0,
    erros: [],
    meta: null,
    busy: false,
    t: Date.now(),
  });
  return _resumoReversao(lista);
}

/**
 * Converte um lote de pedidos já faturados.
 * Não debita estoque de novo e não altera comissão já baixada.
 */
async function aplicarPedidosJaFaturados(pool, req) {
  const chave = await _chaveAcao(pool, req, 'aplicar');
  let job = _acoes.get(chave);
  if (!job || Date.now() - job.t > 20 * 60 * 1000) {
    await prepararAplicacaoLegado(pool, req);
    job = _acoes.get(chave);
  }
  if (job.busy) {
    return {
      ok: true, ocupado: true, aplicados_lote: 0, feitos: job.cursor, convertidos: job.aplicados,
      total: job.fila.length, restantes: Math.max(0, job.fila.length - job.cursor),
      ignorados_baixados: job.ignorados, ultimo: '', erros: job.erros,
    };
  }
  const limite = Math.min(80, Math.max(1, parseInt(req.body?.limite, 10) || 40));
  const cfg = job.cfg;
  const pctCache = job.pctCache;
  job.busy = true;
  job.t = Date.now();
  let lote = 0;
  let ultimo = '';
  const slice = job.fila.slice(job.cursor, job.cursor + limite);
  try {
  for (const ped of slice) {
    job.cursor++;
    ultimo = String(ped.numero);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('SELECT id FROM pedidos WHERE id = ? FOR UPDATE', [ped.id]);
      const [[ja]] = await conn.query(
        `SELECT id FROM pedido_faturamentos WHERE id_pedido = ? AND excluido = 'N' LIMIT 1`,
        [ped.id]
      );
      if (ja) {
        await conn.rollback();
        continue;
      }
      const num = String(ped.numero);
      const [[st]] = await conn.query(
        `SELECT SUM(CASE WHEN status NOT IN ('P','I') THEN 1 ELSE 0 END) AS outras
           FROM pagtocomissao
          WHERE pedido = ? AND COALESCE(excluido,'N') = 'N' AND id_faturamento IS NULL`,
        [num]
      );
      if ((parseInt(st?.outras, 10) || 0) > 0) {
        await conn.rollback();
        continue;
      }

      const vlrPedido = parseFloat(ped.vlrtotalpedido) || 0;
      const informado = round2(ped.vlr_faturado);
      const vlrFat = informado > 0 ? informado : vlrPedido;
      const pctCom = parseFloat(ped.comissao) || 0;
      let pctRep = pctCache.get(ped.id_usuario || 0);
      if (pctRep == null) {
        pctRep = await getPctRepresentante(pool, ped.id_usuario, cfg.pctEscritorio);
        pctCache.set(ped.id_usuario || 0, pctRep);
      }
      const calc = calcularFaturamento({
        saldoAnterior: vlrPedido, vlrFaturado: vlrFat, pctComissao: pctCom, pctRepresentante: pctRep,
      });
      const fechado = String(ped.situacao_pedido || '').toUpperCase() === 'FATURADO';
      const destino = calc.diferenca > 0.009 ? (fechado ? 'CANCELADA' : 'SALDO') : null;
      const dataFat = ped.data_faturado || hojeIsoBrasil();
      const [[antesPed]] = await conn.query(
        `SELECT situacao_pedido, informado_faturamento, saldo_faturar, vlr_faturado,
                DATE_FORMAT(data_faturado, '%Y-%m-%d') AS data_faturado
           FROM pedidos WHERE id = ?`,
        [ped.id]
      );
      const [comsAntigas] = await conn.query(
        `SELECT * FROM pagtocomissao
          WHERE pedido = ? AND status IN ('P','I') AND id_faturamento IS NULL`,
        [num]
      );

      await conn.query(
        `DELETE FROM pagtocomissao WHERE pedido = ? AND status IN ('P','I') AND id_faturamento IS NULL`,
        [num]
      );
      const [ins] = await conn.query(
        `INSERT INTO pedido_faturamentos
           (id_pedido, numpedido, cod_fornecedor, cod_cliente, id_representante, id_empresa,
            data_faturamento, numeronf, serie_nf, nf_fabrica, vlr_pedido, saldo_anterior, vlr_faturado,
            diferenca, destino_diferenca, pct_comissao_pedido, pct_comissao, vlr_comissao,
            pct_escritorio, vlr_escritorio, pct_representante, vlr_representante,
            situacao_anterior, obs, id_usuario_cad)
         VALUES (?,?,?,?,?,?, ?,?,?,?,?,?,?, ?,?,?,?,?, ?,?,?,?, ?,?,?)`,
        [ped.id, num, ped.cod_fornecedor || null, ped.cod_cliente || null, ped.id_usuario || null,
         cfg.idEmpresa || null,
         dataFat, ped.numeronf || null, ped.serie_nf || null, ped.nf_fabrica || null,
         vlrPedido, vlrPedido, calc.vlr_faturado,
         calc.diferenca, destino, pctCom, calc.pct_comissao, calc.vlr_comissao,
         calc.pct_escritorio, calc.vlr_escritorio, calc.pct_representante, calc.vlr_representante,
         ped.situacao_pedido || null, OBS_LEGADO, req.user?.id || null]
      );
      const idFat = ins.insertId;
      await conn.query(
        `UPDATE pedido_faturamentos SET origem = 'LEGADO' WHERE id = ?`,
        [idFat]
      ).catch(() => {});
      await conn.query(
        `INSERT INTO comissao_fat_reversao
           (id_faturamento, id_pedido, numpedido, snapshot_pedido, snapshot_comissoes)
         VALUES (?,?,?,?,?)`,
        [idFat, ped.id, num, JSON.stringify(antesPed || {}), _jsonLinhas(comsAntigas)]
      );
      if (calc.vlr_representante > 0 && ped.id_usuario) {
        const nf = ped.numeronf ? ` NF ${ped.numeronf}` : '';
        await conn.query(
          `INSERT INTO pagtocomissao
             (data_lancamento, data_movimento, data_pagar, data_pagamento, data_confirmacao,
              vlr_pago, vlr_pago_original, cod_user, pedido, id_parcela, status, observacao, id_faturamento)
           VALUES (CURDATE(), ?, ?, ?, CURDATE(), ?, ?, ?, ?, NULL, 'P', ?, ?)`,
          [dataFat, dataFat, dataFat, calc.vlr_representante, calc.vlr_representante, ped.id_usuario, num,
           `Comissão faturamento${nf} — ${calc.pct_representante}% de R$ ${calc.vlr_comissao.toFixed(2)} (pedido já faturado)`,
           idFat]
        );
      }
      const saldo = destino === 'CANCELADA' || calc.diferenca <= 0.009
        ? 0
        : calc.diferenca;
      const situacao = saldo > 0.009 ? (ped.situacao_pedido || 'ENVIADO') : 'FATURADO';
      await conn.query(
        `UPDATE pedidos SET saldo_faturar = ?, vlr_faturado = ?, informado_faturamento = 'S',
                data_faturado = COALESCE(data_faturado, ?), situacao_pedido = ?
          WHERE id = ?`,
        [saldo, calc.vlr_faturado, dataFat, situacao, ped.id]
      );
      await conn.query(
        `INSERT INTO logs_pedidos (id_pedido, id_usuario, acao, status_antigo, status_novo, detalhes)
         VALUES (?, ?, 'FATURAMENTO', ?, ?, ?)`,
        [ped.id, req.user?.id || 0, ped.situacao_pedido, situacao,
         JSON.stringify({ modo: 'COMISSAO_FAT_LEGADO', id_faturamento: idFat, data: dataFat, ...calc, destino })]
      ).catch(() => {});
      await conn.commit();
      job.aplicados++;
      lote++;
    } catch (e) {
      await conn.rollback().catch(() => {});
      if (job.erros.length < 20) job.erros.push({ numero: String(ped.numero), erro: e.message });
    } finally {
      conn.release();
    }
  }
  } finally {
    job.busy = false;
  }

  const total = job.fila.length;
  const restantes = Math.max(0, total - job.cursor);
  if (!restantes) _acoes.delete(chave);
  return {
    ok: true,
    aplicados_lote: lote,
    feitos: job.cursor,
    convertidos: job.aplicados,
    total,
    restantes,
    ignorados_baixados: job.ignorados,
    ultimo,
    erros: job.erros,
  };
}

async function listarConversoesLegado(pool) {
  await ensureComissaoFaturamentoSchema(pool);
  const [rows] = await pool.query(
    `SELECT pf.id, pf.id_pedido, pf.numpedido, pf.situacao_anterior,
            rev.id AS id_rev,
            (SELECT COUNT(*) FROM pagtocomissao pc
              WHERE pc.id_faturamento = pf.id AND COALESCE(pc.excluido,'N') = 'N'
                AND pc.status NOT IN ('P','I')) AS travadas,
            (SELECT COUNT(*) FROM pedido_faturamentos o
              WHERE o.id_pedido = pf.id_pedido AND o.excluido = 'N' AND o.id <> pf.id) AS outras
       FROM pedido_faturamentos pf
       LEFT JOIN comissao_fat_reversao rev
         ON rev.id_faturamento = pf.id AND rev.revertido = 'N'
      WHERE pf.excluido = 'N'
        AND (pf.origem = 'LEGADO' OR pf.obs = ?)`,
    [OBS_LEGADO]
  );
  const elegiveis = [];
  const bloqueadosBaixados = [];
  const bloqueadosPosteriores = [];
  for (const r of rows) {
    if ((parseInt(r.travadas, 10) || 0) > 0) bloqueadosBaixados.push(r);
    else if ((parseInt(r.outras, 10) || 0) > 0) bloqueadosPosteriores.push(r);
    else elegiveis.push(r);
  }
  return { elegiveis, bloqueadosBaixados, bloqueadosPosteriores };
}

function _resumoReversao(lista) {
  return {
    qtd: lista.elegiveis.length,
    sem_copia: lista.elegiveis.filter(r => !r.id_rev).length,
    bloqueados_baixados: lista.bloqueadosBaixados.length,
    bloqueados_posteriores: lista.bloqueadosPosteriores.length,
  };
}

async function _metaPagto(conn) {
  const [cols] = await conn.query('SHOW COLUMNS FROM pagtocomissao');
  const [keys] = await conn.query("SHOW KEYS FROM pagtocomissao WHERE Key_name = 'PRIMARY'");
  return { nomes: new Set(cols.map(c => c.Field)), pk: keys[0]?.Column_name || 'id' };
}

async function _inserirComissao(conn, meta, row) {
  const montar = (comPk) => {
    const nomes = [];
    const vals = [];
    for (const [k, v] of Object.entries(row)) {
      if (!meta.nomes.has(k)) continue;
      if (!comPk && k === meta.pk) continue;
      nomes.push('`' + k + '`');
      vals.push(v);
    }
    return { nomes, vals };
  };
  const tentativas = meta.nomes.has(meta.pk) ? [true, false] : [false];
  for (const comPk of tentativas) {
    const { nomes, vals } = montar(comPk);
    if (!nomes.length) return;
    try {
      await conn.query(
        `INSERT INTO pagtocomissao (${nomes.join(',')}) VALUES (${nomes.map(() => '?').join(',')})`,
        vals
      );
      return;
    } catch (e) {
      if (!comPk || !/Duplicate entry/i.test(e.message)) throw e;
    }
  }
}

/**
 * Desfaz a conversão dos pedidos já faturados. Recoloca as comissões por parcela
 * quando a cópia foi gravada. Não mexe em comissão já baixada nem em nota lançada depois.
 */
async function reverterPedidosJaFaturados(pool, req) {
  const chave = await _chaveAcao(pool, req, 'reverter');
  let job = _acoes.get(chave);
  if (!job || Date.now() - job.t > 20 * 60 * 1000) {
    await prepararReversaoLegado(pool, req);
    job = _acoes.get(chave);
  }
  if (job.busy) {
    return {
      ok: true, ocupado: true, revertidos_lote: 0, feitos: job.cursor, revertidos: job.revertidos,
      total: job.fila.length, restantes: Math.max(0, job.fila.length - job.cursor),
      ultimo: '', erros: job.erros, sem_copia_revertidos: job.semCopia,
    };
  }
  const limite = Math.min(80, Math.max(1, parseInt(req.body?.limite, 10) || 40));
  job.busy = true;
  job.t = Date.now();
  let lote = 0;
  let ultimo = '';
  const slice = job.fila.slice(job.cursor, job.cursor + limite);
  try {
  for (const fat of slice) {
    job.cursor++;
    ultimo = String(fat.numpedido);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('SELECT id FROM pedidos WHERE id = ? FOR UPDATE', [fat.id_pedido]);
      const [[ainda]] = await conn.query(
        `SELECT id FROM pedido_faturamentos WHERE id = ? AND excluido = 'N' LIMIT 1`,
        [fat.id]
      );
      if (!ainda) {
        await conn.rollback();
        continue;
      }
      const [[trav]] = await conn.query(
        `SELECT COUNT(*) AS n FROM pagtocomissao
          WHERE id_faturamento = ? AND COALESCE(excluido,'N') = 'N' AND status NOT IN ('P','I')`,
        [fat.id]
      );
      if ((parseInt(trav?.n, 10) || 0) > 0) {
        await conn.rollback();
        continue;
      }
      const [[outras]] = await conn.query(
        `SELECT COUNT(*) AS n FROM pedido_faturamentos
          WHERE id_pedido = ? AND excluido = 'N' AND id <> ?`,
        [fat.id_pedido, fat.id]
      );
      if ((parseInt(outras?.n, 10) || 0) > 0) {
        await conn.rollback();
        continue;
      }

      await conn.query(
        `DELETE FROM pagtocomissao WHERE id_faturamento = ? AND status IN ('P','I')`,
        [fat.id]
      );

      let pedidoSnap = null;
      let comissoes = [];
      if (fat.id_rev) {
        const [[rev]] = await conn.query(
          `SELECT snapshot_pedido, snapshot_comissoes FROM comissao_fat_reversao
            WHERE id = ? AND revertido = 'N'`,
          [fat.id_rev]
        );
        try { pedidoSnap = JSON.parse(rev?.snapshot_pedido || 'null'); } catch (_) { pedidoSnap = null; }
        try { comissoes = JSON.parse(rev?.snapshot_comissoes || '[]') || []; } catch (_) { comissoes = []; }
        if (!job.meta) job.meta = await _metaPagto(conn);
        for (const row of comissoes) {
          if (row && typeof row === 'object') await _inserirComissao(conn, job.meta, row);
        }
      }

      if (pedidoSnap && typeof pedidoSnap === 'object') {
        await conn.query(
          `UPDATE pedidos SET situacao_pedido = ?, informado_faturamento = ?, saldo_faturar = ?,
                  vlr_faturado = ?, data_faturado = ?
            WHERE id = ?`,
          [
            pedidoSnap.situacao_pedido,
            pedidoSnap.informado_faturamento,
            pedidoSnap.saldo_faturar,
            pedidoSnap.vlr_faturado,
            pedidoSnap.data_faturado || null,
            fat.id_pedido,
          ]
        );
      } else {
        job.semCopia++;
        await conn.query(
          `UPDATE pedidos SET situacao_pedido = ?, saldo_faturar = NULL WHERE id = ?`,
          [fat.situacao_anterior || 'FATURADO', fat.id_pedido]
        );
      }

      await conn.query(
        `UPDATE pedido_faturamentos
            SET excluido = 'S', id_usuario_exc = ?, excluido_em = NOW()
          WHERE id = ?`,
        [req.user?.id || null, fat.id]
      );
      if (fat.id_rev) {
        await conn.query(
          `UPDATE comissao_fat_reversao
              SET revertido = 'S', revertido_em = NOW(), id_usuario_rev = ?
            WHERE id = ?`,
          [req.user?.id || null, fat.id_rev]
        );
      }
      await conn.query(
        `INSERT INTO logs_pedidos (id_pedido, id_usuario, acao, status_antigo, status_novo, detalhes)
         VALUES (?, ?, 'FATURAMENTO', 'FATURADO', ?, ?)`,
        [fat.id_pedido, req.user?.id || 0, fat.situacao_anterior || 'FATURADO',
         JSON.stringify({ modo: 'COMISSAO_FAT_REVERSAO', id_faturamento: fat.id, com_copia: !!fat.id_rev })]
      ).catch(() => {});
      await conn.commit();
      job.revertidos++;
      lote++;
    } catch (e) {
      await conn.rollback().catch(() => {});
      if (job.erros.length < 20) job.erros.push({ numero: String(fat.numpedido), erro: e.message });
    } finally {
      conn.release();
    }
  }
  } finally {
    job.busy = false;
  }

  const total = job.fila.length;
  const restantes = Math.max(0, total - job.cursor);
  if (!restantes) _acoes.delete(chave);
  return {
    ok: true,
    revertidos_lote: lote,
    feitos: job.cursor,
    revertidos: job.revertidos,
    total,
    restantes,
    ultimo,
    sem_copia_revertidos: job.semCopia,
    erros: job.erros,
    bloqueados_baixados: job.bloqueados_baixados,
    bloqueados_posteriores: job.bloqueados_posteriores,
  };
}

module.exports = {
  ensureComissaoFaturamentoSchema,
  getComissaoFatConfig,
  invalidateComissaoFatCache,
  getPctRepresentante,
  totaisFaturamentoPedido,
  calcSaldo,
  calcularFaturamento,
  listarPedidosJaFaturadosLegado,
  aplicarPedidosJaFaturados,
  prepararAplicacaoLegado,
  prepararReversaoLegado,
  listarConversoesLegado,
  reverterPedidosJaFaturados,
  normCnpj,
  parseListaCnpjs,
  round2,
};
