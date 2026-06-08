'use strict';

const { getFaixaByCodigo, getPrecoMedioMaxFaixa } = require('./feirinha-calc');
const { ensureFeirinhaTables } = require('./schema-migrations');

const FAIXA_CODIGOS = ['R5', 'R10', 'R15', 'R20', 'PREMIUM'];
const _okByDb = new Map();

async function tabelaExiste(pool) {
  let dbKey = 'default';
  try {
    const [[r]] = await pool.query('SELECT DATABASE() AS db');
    dbKey = r?.db || dbKey;
  } catch { /* ignora */ }
  if (_okByDb.get(dbKey) === true) return true;
  const ok = await ensureFeirinhaTables(pool);
  _okByDb.set(dbKey, ok);
  return ok;
}

function formatarCampanha(row, extras = {}) {
  if (!row) return null;
  const faixa = getFaixaByCodigo(row.faixa_codigo);
  const precoRevendaAlvo = row.preco_revenda_alvo != null
    ? parseFloat(row.preco_revenda_alvo)
    : faixa.precoSugerido;
  const precoMedioMeta = row.preco_medio_meta != null
    ? parseFloat(row.preco_medio_meta)
    : getPrecoMedioMaxFaixa(row.faixa_codigo);
  return {
    id: row.id,
    descricao: row.descricao,
    cod_fornecedor: parseInt(row.cod_fornecedor, 10) || null,
    nome_fornecedor: extras.nome_fornecedor || row.nome_fornecedor || null,
    faixa_codigo: row.faixa_codigo,
    faixa_label: faixa.label,
    faixa_emoji: faixa.emoji,
    preco_revenda_alvo: precoRevendaAlvo,
    preco_medio_meta: precoMedioMeta,
    data_inicio: row.data_inicio || null,
    data_fim: row.data_fim || null,
    ativo: row.ativo === 'S',
    observacoes: row.observacoes || '',
    tema_banner: row.tema_banner || '',
    dtcadastro: row.dtcadastro || null,
    qtd_pedidos: Number(extras.qtd_pedidos) || 0,
    qtd_kit: Number(extras.qtd_kit) || 0,
  };
}

function validarPayload(body) {
  const erros = [];
  const desc = String(body?.descricao || '').trim();
  if (!desc) erros.push('Informe o nome da campanha.');
  const codForn = parseInt(body?.cod_fornecedor, 10);
  if (!codForn) erros.push('Selecione a fábrica.');
  const faixa = String(body?.faixa_codigo || 'R10').toUpperCase();
  if (!FAIXA_CODIGOS.includes(faixa)) erros.push('Faixa inválida.');
  if (erros.length) return { ok: false, erros };
  const faixaObj = getFaixaByCodigo(faixa);
  let precoRevenda = parseFloat(body?.preco_revenda_alvo);
  if (!Number.isFinite(precoRevenda) || precoRevenda <= 0) {
    precoRevenda = faixaObj.precoSugerido;
  }
  let precoMedioMeta = parseFloat(body?.preco_medio_meta);
  if (!Number.isFinite(precoMedioMeta) || precoMedioMeta <= 0) {
    precoMedioMeta = getPrecoMedioMaxFaixa(faixa);
  }
  return {
    ok: true,
    descricao: desc.slice(0, 200),
    cod_fornecedor: codForn,
    faixa_codigo: faixa,
    preco_revenda_alvo: precoRevenda,
    preco_medio_meta: precoMedioMeta,
    data_inicio: body?.data_inicio || null,
    data_fim: body?.data_fim || null,
    ativo: body?.ativo === 'N' ? 'N' : 'S',
    observacoes: String(body?.observacoes || '').slice(0, 2000),
    tema_banner: String(body?.tema_banner || '').slice(0, 200),
  };
}

/** Campanha ativa e dentro de data_inicio / data_fim (datas inclusivas). */
function campanhaEmVigencia(camp) {
  if (!camp || !camp.ativo) return false;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  if (camp.data_inicio) {
    const ini = new Date(String(camp.data_inicio).slice(0, 10) + 'T12:00:00');
    if (hoje < ini) return false;
  }
  if (camp.data_fim) {
    const fim = new Date(String(camp.data_fim).slice(0, 10) + 'T12:00:00');
    if (hoje > fim) return false;
  }
  return true;
}

async function getCampanha(pool, id) {
  if (!(await tabelaExiste(pool))) return null;
  const [[row]] = await pool.query(
    `SELECT c.*, f.nome AS nome_fornecedor,
      (SELECT COUNT(*) FROM pedidos p
       WHERE p.id_campanha_feirinha = c.id AND COALESCE(p.excluido,'N') = 'N') AS qtd_pedidos
     FROM campanhas_feirinha c
     LEFT JOIN fornecedores f ON f.id = c.cod_fornecedor
     WHERE c.id = ? AND c.excluido = 'N' LIMIT 1`,
    [id]
  );
  return row ? formatarCampanha(row, row) : null;
}

async function listarCampanhas(pool, opts = {}) {
  if (!(await tabelaExiste(pool))) return { data: [], total: 0 };
  const limit = Math.min(200, Math.max(1, parseInt(opts.limit, 10) || 50));
  const offset = Math.max(0, parseInt(opts.offset, 10) || 0);
  const q = String(opts.q || '').trim();
  const somenteAtivas = opts.ativo !== 'N';
  const codForn = parseInt(opts.cod_fornecedor, 10);

  let where = `c.excluido = 'N'`;
  const params = [];
  if (somenteAtivas) {
    where += ` AND c.ativo = 'S'
      AND (c.data_inicio IS NULL OR c.data_inicio <= CURDATE())
      AND (c.data_fim IS NULL OR c.data_fim >= CURDATE())`;
  }
  if (codForn) {
    where += ` AND c.cod_fornecedor = ?`;
    params.push(codForn);
  }
  if (q) {
    where += ` AND c.descricao LIKE ?`;
    params.push(`%${q}%`);
  }

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM campanhas_feirinha c WHERE ${where}`,
    params
  );
  const [rows] = await pool.query(
    `SELECT c.*, f.nome AS nome_fornecedor,
      (SELECT COUNT(*) FROM pedidos p
       WHERE p.id_campanha_feirinha = c.id AND COALESCE(p.excluido,'N') = 'N') AS qtd_pedidos
     FROM campanhas_feirinha c
     LEFT JOIN fornecedores f ON f.id = c.cod_fornecedor
     WHERE ${where}
     ORDER BY c.data_fim IS NULL DESC, c.data_fim DESC, c.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return {
    data: rows.map((r) => formatarCampanha(r, r)),
    total: Number(total) || 0,
  };
}

async function gravarCampanha(pool, body, campanhaId = null) {
  if (!(await tabelaExiste(pool))) {
    return { status: 503, json: { error: 'Tabela campanhas_feirinha indisponível. Reinicie o servidor.' } };
  }
  const val = validarPayload(body);
  if (!val.ok) return { status: 400, json: { error: val.erros[0] } };

  const params = [
    val.descricao,
    val.cod_fornecedor,
    val.faixa_codigo,
    val.preco_revenda_alvo,
    val.preco_medio_meta,
    val.data_inicio,
    val.data_fim,
    val.ativo,
    val.observacoes || null,
    val.tema_banner || null,
  ];

  if (campanhaId) {
    const [[ex]] = await pool.query(
      `SELECT id FROM campanhas_feirinha WHERE id=? AND excluido='N' LIMIT 1`,
      [campanhaId]
    );
    if (!ex) return { status: 404, json: { error: 'Campanha não encontrada' } };
    await pool.query(
      `UPDATE campanhas_feirinha SET
         descricao=?, cod_fornecedor=?, faixa_codigo=?, preco_revenda_alvo=?, preco_medio_meta=?,
         data_inicio=?, data_fim=?, ativo=?, observacoes=?, tema_banner=?
       WHERE id=?`,
      [...params, campanhaId]
    );
    return { status: 200, json: { ok: true, id: campanhaId } };
  }

  const [r] = await pool.query(
    `INSERT INTO campanhas_feirinha
       (descricao, cod_fornecedor, faixa_codigo, preco_revenda_alvo, preco_medio_meta,
        data_inicio, data_fim, ativo, observacoes, tema_banner, excluido)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'N')`,
    params
  );
  return { status: 201, json: { ok: true, id: r.insertId } };
}

async function excluirCampanha(pool, id) {
  if (!(await tabelaExiste(pool))) {
    return { status: 503, json: { error: 'Tabela campanhas_feirinha indisponível.' } };
  }
  const [r] = await pool.query(
    `UPDATE campanhas_feirinha SET excluido='S' WHERE id=? AND excluido='N'`,
    [id]
  );
  if (!r.affectedRows) return { status: 404, json: { error: 'Campanha não encontrada' } };
  return { status: 200, json: { ok: true } };
}

async function dashboardResumo(pool, opts = {}) {
  if (!(await tabelaExiste(pool))) return { campanhas: [], pedidos: [], kpis: {}, top_produtos: [], top_clientes: [] };
  const codForn = parseInt(opts.cod_fornecedor, 10);
  const dtIni = opts.dt_inicio || null;
  const dtFim = opts.dt_fim || null;
  let wherePed = `COALESCE(p.excluido,'N') = 'N' AND p.id_campanha_feirinha IS NOT NULL`;
  const params = [];
  if (codForn) {
    wherePed += ` AND p.cod_fornecedor = ?`;
    params.push(codForn);
  }
  if (dtIni) {
    wherePed += ` AND p.data_abertura >= ?`;
    params.push(dtIni);
  }
  if (dtFim) {
    wherePed += ` AND p.data_abertura <= ?`;
    params.push(dtFim);
  }

  const [[kpis]] = await pool.query(
    `SELECT COUNT(*) AS qtd_pedidos,
            SUM(COALESCE(p.vlrtotalitens,0)) AS valor_total,
            SUM(COALESCE(p.total_qt,0)) AS qtd_pecas,
            AVG(CASE WHEN p.preco_medio_feirinha IS NOT NULL THEN p.preco_medio_feirinha END) AS media_snapshot,
            AVG(COALESCE(p.vlrtotalitens,0)) AS ticket_medio
     FROM pedidos p WHERE ${wherePed}`,
    params
  ).catch(() => [[{}]]);

  const [pedRows] = await pool.query(
    `SELECT p.id_campanha_feirinha AS id_campanha,
            COUNT(*) AS qtd_pedidos,
            SUM(COALESCE(p.vlrtotalitens,0)) AS valor_total,
            SUM(COALESCE(p.total_qt,0)) AS qtd_total,
            AVG(CASE WHEN p.preco_medio_feirinha IS NOT NULL THEN p.preco_medio_feirinha END) AS preco_medio_medio
     FROM pedidos p
     WHERE ${wherePed}
     GROUP BY p.id_campanha_feirinha
     ORDER BY qtd_pedidos DESC
     LIMIT 50`,
    params
  );

  const topParams = [...params];
  const [topProdutos] = await pool.query(
    `SELECT i.cod_produto, MAX(i.desc_prod) AS desc_produto,
            SUM(i.quantidade) AS qtd_total,
            SUM(COALESCE(i.vlrtotal_itens, i.vlrtotalcomimposto, 0)) AS valor_total
     FROM itensped i
     INNER JOIN pedidos p ON p.id = i.id_pedido
     WHERE ${wherePed}
       AND COALESCE(i.excluido,'N') = 'N'
     GROUP BY i.cod_produto
     ORDER BY qtd_total DESC
     LIMIT 15`,
    topParams
  ).catch(() => [[]]);

  const [topClientes] = await pool.query(
    `SELECT p.cod_cliente, MAX(p.nome_cliente) AS nome_cliente,
            COUNT(*) AS qtd_pedidos,
            SUM(COALESCE(p.vlrtotalitens,0)) AS valor_total
     FROM pedidos p
     WHERE ${wherePed} AND p.cod_cliente IS NOT NULL
     GROUP BY p.cod_cliente
     ORDER BY valor_total DESC
     LIMIT 15`,
    topParams
  ).catch(() => [[]]);

  const { data: campanhas } = await listarCampanhas(pool, {
    cod_fornecedor: codForn || undefined,
    ativo: 'N',
    limit: 100,
  });
  return {
    campanhas,
    pedidos: pedRows,
    kpis: {
      qtd_pedidos: Number(kpis?.qtd_pedidos) || 0,
      valor_total: parseFloat(kpis?.valor_total) || 0,
      qtd_pecas: parseFloat(kpis?.qtd_pecas) || 0,
      media_snapshot: parseFloat(kpis?.media_snapshot) || 0,
      ticket_medio: parseFloat(kpis?.ticket_medio) || 0,
    },
    top_produtos: topProdutos || [],
    top_clientes: topClientes || [],
  };
}

module.exports = {
  FAIXA_CODIGOS,
  campanhaEmVigencia,
  listarCampanhas,
  getCampanha,
  gravarCampanha,
  excluirCampanha,
  dashboardResumo,
  formatarCampanha,
};
