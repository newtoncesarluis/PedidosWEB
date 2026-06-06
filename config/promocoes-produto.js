'use strict';

const PROMO_SELECT_COLS = `id, cod_produto, id_campanha, cod_cliente, id_regiao, cod_fornecedor, id_tabela_preco, tabelas_preco,
  descricao, tipo, valor, qtd_minima, data_inicio, data_fim, destaque, ativo, sync_precopromo`;

let _tabelaOk = null;

async function tabelaPromocoesExiste(pool) {
  if (_tabelaOk !== null) return _tabelaOk;
  try {
    const [rows] = await pool.query("SHOW TABLES LIKE 'produto_promocoes'");
    _tabelaOk = rows.length > 0;
  } catch {
    _tabelaOk = false;
  }
  return _tabelaOk;
}

function parseOptInt(v) {
  if (v == null || v === '' || v === '0') return null;
  const n = parseInt(v, 10);
  return n > 0 ? n : null;
}

function parseTabelasPrecoLista(raw) {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) {
    return [...new Set(raw.map((x) => parseInt(x, 10)).filter((n) => n > 0))];
  }
  const s = String(raw).trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try { return parseTabelasPrecoLista(JSON.parse(s)); } catch (_) { /* ignora */ }
  }
  return [...new Set(s.split(/[\s,;]+/).map((x) => parseInt(x, 10)).filter((n) => n > 0))];
}

function normalizarEscopoTabelasPreco(body) {
  let lista = parseTabelasPrecoLista(body?.tabelas_preco);
  const one = parseOptInt(body?.id_tabela_preco);
  if (!lista.length && one) lista = [one];
  return {
    tabelasPrecoLista: lista,
    tabelasPrecoStr: lista.length ? lista.join(',') : null,
    idTabelaPreco: lista.length === 1 ? lista[0] : null,
  };
}

function promoRestringeTabelas(row) {
  const lista = parseTabelasPrecoLista(row?.tabelas_preco);
  if (lista.length) return lista;
  const one = parseOptInt(row?.id_tabela_preco);
  return one ? [one] : [];
}

function promocaoCombinaTabela(row, tab) {
  const restritas = promoRestringeTabelas(row);
  if (!restritas.length) return true;
  if (!tab) return false;
  return restritas.includes(parseInt(tab, 10));
}

function validarPayloadPromocao(body, vlrVenda = null) {
  const erros = [];
  const desc = String(body?.descricao || '').trim();
  if (!desc) erros.push('Descrição da promoção é obrigatória');

  const tipoNorm = String(body?.tipo || '').toUpperCase() === 'DESCONTO_PERC' ? 'DESCONTO_PERC' : 'PRECO_FIXO';
  const val = parseFloat(body?.valor);
  if (isNaN(val) || val < 0) erros.push('Valor inválido');
  if (tipoNorm === 'DESCONTO_PERC' && val > 100) erros.push('Desconto não pode passar de 100%');
  if (tipoNorm === 'PRECO_FIXO' && val <= 0) erros.push('Preço fixo deve ser maior que zero');

  const qtdMin = parseFloat(body?.qtd_minima);
  if (isNaN(qtdMin) || qtdMin < 1) erros.push('Quantidade mínima deve ser >= 1');

  const di = body?.data_inicio || null;
  const df = body?.data_fim || null;
  if (di && df && String(df) < String(di)) erros.push('Data final não pode ser anterior à data inicial');

  for (const [field, label] of [
    ['cod_cliente', 'Cliente'],
    ['id_regiao', 'Região'],
    ['cod_fornecedor', 'Fornecedor'],
    ['id_tabela_preco', 'Tabela de preço'],
  ]) {
    const v = body?.[field];
    if (v != null && v !== '' && parseInt(v, 10) <= 0) erros.push(`${label} inválido`);
  }

  if (tipoNorm === 'PRECO_FIXO' && vlrVenda != null && val > parseFloat(vlrVenda) * 3) {
    erros.push('Preço promocional parece muito acima do preço de venda — confira o valor');
  }

  const tabNorm = normalizarEscopoTabelasPreco(body);

  return {
    ok: !erros.length,
    erros,
    tipoNorm,
    val,
    qtdMin,
    desc,
    codCliente: parseOptInt(body?.cod_cliente),
    idRegiao: parseOptInt(body?.id_regiao),
    codFornecedor: parseOptInt(body?.cod_fornecedor),
    idTabelaPreco: tabNorm.idTabelaPreco,
    tabelasPrecoLista: tabNorm.tabelasPrecoLista,
    tabelasPrecoStr: tabNorm.tabelasPrecoStr,
    syncPrecopromo: body?.sync_precopromo === 'S' || body?.sync_precopromo === true ? 'S' : 'N',
  };
}

function calcularPrecoPromocao(tipo, valor, vlrBase) {
  const base = parseFloat(vlrBase) || 0;
  const v = parseFloat(valor) || 0;
  if (tipo === 'DESCONTO_PERC') {
    if (v <= 0) return base;
    if (v >= 100) return 0;
    return Math.round(base * (1 - v / 100) * 10000) / 10000;
  }
  return v > 0 ? v : base;
}

function formatarPromocaoRow(row, vlrBase, qtd = 1) {
  if (!row) return null;
  const qtdMin = parseFloat(row.qtd_minima) || 1;
  const precoPromo = calcularPrecoPromocao(row.tipo, row.valor, vlrBase);
  return {
    id: row.id,
    id_campanha: row.id_campanha != null ? parseInt(row.id_campanha, 10) : null,
    descricao: row.descricao,
    tipo: row.tipo,
    valor: parseFloat(row.valor) || 0,
    qtd_minima: qtdMin,
    preco_promo: precoPromo,
    cod_cliente: row.cod_cliente != null ? parseInt(row.cod_cliente, 10) : null,
    id_regiao: row.id_regiao != null ? parseInt(row.id_regiao, 10) : null,
    cod_fornecedor: row.cod_fornecedor != null ? parseInt(row.cod_fornecedor, 10) : null,
    id_tabela_preco: row.id_tabela_preco != null ? parseInt(row.id_tabela_preco, 10) : null,
    tabelas_preco: promoRestringeTabelas(row),
    sync_precopromo: row.sync_precopromo === 'S',
    data_inicio: row.data_inicio || null,
    data_fim: row.data_fim || null,
    destaque: row.destaque === 'S' || row.destaque === true,
    ativo: row.ativo === 'S' || row.ativo === true,
    aplica_agora: qtd >= qtdMin,
  };
}

function scoreEspecificidadePromo(row) {
  let s = 0;
  if (row.cod_cliente != null && row.cod_cliente !== '') s += 1000;
  if (row.id_regiao != null && row.id_regiao !== '') s += 100;
  if (row.cod_fornecedor != null && row.cod_fornecedor !== '') s += 10;
  if (row.id_tabela_preco != null && row.id_tabela_preco !== '') s += 1;
  if (parseTabelasPrecoLista(row.tabelas_preco).length > 1) s += 1;
  return s;
}

function promocaoCombinaContexto(row, ctx = {}) {
  const cid = parseOptInt(ctx.codCliente);
  const reg = parseOptInt(ctx.idRegiao);
  const forn = parseOptInt(ctx.codFornecedor);
  const tab = parseOptInt(ctx.idTabelaPreco);

  if (row.cod_cliente != null && row.cod_cliente !== '') {
    if (!cid || parseInt(row.cod_cliente, 10) !== cid) return false;
  } else if (!cid) {
    return false;
  }

  if (row.id_regiao != null && row.id_regiao !== '') {
    if (!reg || parseInt(row.id_regiao, 10) !== reg) return false;
  } else if (!reg) {
    /* promo geral de região não exige região no pedido */
  }

  if (row.cod_fornecedor != null && row.cod_fornecedor !== '') {
    if (!forn || parseInt(row.cod_fornecedor, 10) !== forn) return false;
  } else if (!forn) {
    /* ok */
  }

  if (!promocaoCombinaTabela(row, tab)) return false;

  return true;
}

function filtrarPromocoesPorContexto(rows, ctx = {}) {
  const cid = parseOptInt(ctx.codCliente);
  const reg = parseOptInt(ctx.idRegiao);
  const forn = parseOptInt(ctx.codFornecedor);
  const tab = parseOptInt(ctx.idTabelaPreco);

  return (rows || []).filter((r) => {
    if (r.cod_cliente != null && r.cod_cliente !== '') {
      if (!cid || parseInt(r.cod_cliente, 10) !== cid) return false;
    } else if (!cid) {
      /* promo geral — ok sem cliente no pedido */
    }

    if (r.id_regiao != null && r.id_regiao !== '') {
      if (!reg || parseInt(r.id_regiao, 10) !== reg) return false;
    }

    if (r.cod_fornecedor != null && r.cod_fornecedor !== '') {
      if (!forn || parseInt(r.cod_fornecedor, 10) !== forn) return false;
    }

    if (!promocaoCombinaTabela(r, tab)) return false;

    if (!cid && r.cod_cliente != null && r.cod_cliente !== '') return false;
    if (!reg && r.id_regiao != null && r.id_regiao !== '') return false;
    if (!forn && r.cod_fornecedor != null && r.cod_fornecedor !== '') return false;
    if (!tab && promoRestringeTabelas(r).length) return false;

    return true;
  });
}

/** @deprecated use filtrarPromocoesPorContexto */
function filtrarPromocoesPorCliente(rows, codCliente) {
  return filtrarPromocoesPorContexto(rows, { codCliente });
}

function escolherMelhorPromocao(rows, vlrBase, qtd = 1, ctx = null) {
  if (!rows?.length) return null;
  const q = parseFloat(qtd) || 1;
  const contexto = typeof ctx === 'object' && ctx !== null
    ? ctx
    : { codCliente: ctx };
  const filtradas = filtrarPromocoesPorContexto(rows, contexto);
  if (!filtradas.length) return null;

  const elegivel = filtradas.filter((r) => (parseFloat(r.qtd_minima) || 1) <= q);
  const pool = elegivel.length ? elegivel : filtradas;
  const base = parseFloat(vlrBase) || 0;

  pool.sort((a, b) => {
    const esp = scoreEspecificidadePromo(b) - scoreEspecificidadePromo(a);
    if (esp !== 0) return esp;
    const pa = calcularPrecoPromocao(a.tipo, a.valor, base);
    const pb = calcularPrecoPromocao(b.tipo, b.valor, base);
    if (pa !== pb) return pa - pb;
    return (parseFloat(b.qtd_minima) || 1) - (parseFloat(a.qtd_minima) || 1);
  });

  return formatarPromocaoRow(pool[0], vlrBase, q);
}

async function buscarPromocoesProduto(pool, codProduto, opts = {}) {
  if (!(await tabelaPromocoesExiste(pool))) return [];
  const { somenteAtivas = true } = opts;
  const ctx = {
    codCliente: opts.codCliente,
    idRegiao: opts.idRegiao,
    codFornecedor: opts.codFornecedor,
    idTabelaPreco: opts.idTabelaPreco,
  };

  let sql = `
    SELECT ${PROMO_SELECT_COLS}
    FROM produto_promocoes
    WHERE cod_produto = ?
      AND excluido = 'N'`;
  const params = [codProduto];

  if (somenteAtivas) {
    sql += ` AND ativo = 'S'
      AND (data_inicio IS NULL OR data_inicio <= CURDATE())
      AND (data_fim IS NULL OR data_fim >= CURDATE())`;
  }

  sql += ' ORDER BY qtd_minima DESC, id DESC';

  const [rows] = await pool.query(sql, params);
  return filtrarPromocoesPorContexto(rows, ctx);
}

async function resolverMelhorPromocao(pool, codProduto, vlrBase, qtd = 1, ctx = null) {
  if (!(await tabelaPromocoesExiste(pool))) return null;
  const [rows] = await pool.query(
    `SELECT ${PROMO_SELECT_COLS}
     FROM produto_promocoes
     WHERE cod_produto = ? AND excluido = 'N' AND ativo = 'S'
       AND (data_inicio IS NULL OR data_inicio <= CURDATE())
       AND (data_fim IS NULL OR data_fim >= CURDATE())
     ORDER BY qtd_minima DESC, id DESC`,
    [codProduto]
  );
  const contexto = typeof ctx === 'object' && ctx !== null ? ctx : { codCliente: ctx };
  return escolherMelhorPromocao(rows, vlrBase, qtd, contexto);
}

async function enrichProdutosComPromocao(pool, produtos, opts = {}) {
  const qtd = parseFloat(opts.qtd) || 1;
  const ctx = {
    codCliente: opts.codCliente || null,
    idRegiao: opts.idRegiao || null,
    codFornecedor: opts.codFornecedor || null,
    idTabelaPreco: opts.idTabelaPreco || null,
  };
  if (!produtos?.length || !(await tabelaPromocoesExiste(pool))) return produtos;

  const ids = [...new Set(produtos.map((p) => p.id || p.cod_produto || p.ID).filter(Boolean))];
  if (!ids.length) return produtos;

  const placeholders = ids.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT ${PROMO_SELECT_COLS}
     FROM produto_promocoes
     WHERE cod_produto IN (${placeholders})
       AND excluido = 'N'
       AND ativo = 'S'
       AND (data_inicio IS NULL OR data_inicio <= CURDATE())
       AND (data_fim IS NULL OR data_fim >= CURDATE())
     ORDER BY cod_produto, qtd_minima DESC, id DESC`,
    ids
  );

  const porProduto = new Map();
  for (const r of rows) {
    const pid = String(r.cod_produto);
    if (!porProduto.has(pid)) porProduto.set(pid, []);
    porProduto.get(pid).push(r);
  }

  return produtos.map((p) => {
    const pid = String(p.id || p.cod_produto || p.ID);
    const todas = porProduto.get(pid) || [];
    const vlrBase = parseFloat(p.vlr_venda ?? p.preco_venda ?? p.preco1) || 0;
    const listaCtx = filtrarPromocoesPorContexto(todas, ctx);
    const promocao_ativa = escolherMelhorPromocao(todas, vlrBase, qtd, ctx);
    const promocoes = todas.map((r) => formatarPromocaoRow(r, vlrBase, qtd));
    return {
      ...p,
      tem_promocao: listaCtx.length > 0,
      promocoes,
      promocao_ativa,
    };
  });
}

async function sincronizarPrecopromoLegado(pool, produtoTabela, prodId, promoRow, vlrVenda) {
  if (!promoRow || promoRow.sync_precopromo !== 'S' || promoRow.ativo !== 'S') return;
  if ((parseFloat(promoRow.qtd_minima) || 1) > 1) return;
  const preco = calcularPrecoPromocao(promoRow.tipo, promoRow.valor, parseFloat(vlrVenda) || 0);
  const cols = await pool.query(`SHOW COLUMNS FROM ${produtoTabela} LIKE 'precopromo'`);
  if (!cols[0]?.length) return;
  await pool.query(
    `UPDATE ${produtoTabela} SET precopromo = ? WHERE ID = ?`,
    [preco, prodId]
  );
}

module.exports = {
  PROMO_SELECT_COLS,
  tabelaPromocoesExiste,
  parseOptInt,
  parseTabelasPrecoLista,
  promoRestringeTabelas,
  promocaoCombinaTabela,
  normalizarEscopoTabelasPreco,
  validarPayloadPromocao,
  calcularPrecoPromocao,
  formatarPromocaoRow,
  scoreEspecificidadePromo,
  promocaoCombinaContexto,
  filtrarPromocoesPorContexto,
  filtrarPromocoesPorCliente,
  escolherMelhorPromocao,
  buscarPromocoesProduto,
  resolverMelhorPromocao,
  enrichProdutosComPromocao,
  sincronizarPrecopromoLegado,
};
