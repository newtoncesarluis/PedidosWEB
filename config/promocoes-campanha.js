'use strict';

const {
  validarPayloadPromocao,
  sincronizarPrecopromoLegado,
  parseOptInt,
  promoRestringeTabelas,
  calcularPrecoPromocao,
} = require('./promocoes-produto');
const { ensurePromocoesCampanhaTables } = require('./schema-migrations');

const _campanhaOkByDb = new Map();

async function tabelaCampanhaExiste(pool) {
  let dbKey = 'default';
  try {
    const [[r]] = await pool.query('SELECT DATABASE() AS db');
    dbKey = r?.db || dbKey;
  } catch { /* ignora */ }

  if (_campanhaOkByDb.get(dbKey) === true) return true;

  const ok = await ensurePromocoesCampanhaTables(pool);
  _campanhaOkByDb.set(dbKey, ok);
  return ok;
}

function resetCampanhaCache(pool) {
  if (!pool) {
    _campanhaOkByDb.clear();
    return;
  }
  pool.query('SELECT DATABASE() AS db').then(([rows]) => {
    const dbKey = rows?.[0]?.db || 'default';
    _campanhaOkByDb.delete(dbKey);
  }).catch(() => _campanhaOkByDb.clear());
}

function validarPayloadCampanha(body) {
  const base = validarPayloadPromocao(body, null);
  if (!base.ok) return base;
  return {
    ...base,
    prioridade: parseInt(body?.prioridade, 10) || 0,
  };
}

function formatarCampanhaRow(row, extras = {}) {
  if (!row) return null;
  return {
    id: row.id,
    descricao: row.descricao,
    tipo: row.tipo,
    valor: parseFloat(row.valor) || 0,
    qtd_minima: parseFloat(row.qtd_minima) || 1,
    data_inicio: row.data_inicio || null,
    data_fim: row.data_fim || null,
    destaque: row.destaque === 'S',
    ativo: row.ativo === 'S',
    cod_cliente: row.cod_cliente != null ? parseInt(row.cod_cliente, 10) : null,
    id_regiao: row.id_regiao != null ? parseInt(row.id_regiao, 10) : null,
    cod_fornecedor: row.cod_fornecedor != null ? parseInt(row.cod_fornecedor, 10) : null,
    id_tabela_preco: row.id_tabela_preco != null ? parseInt(row.id_tabela_preco, 10) : null,
    tabelas_preco: promoRestringeTabelas(row),
    sync_precopromo: row.sync_precopromo === 'S',
    prioridade: parseInt(row.prioridade, 10) || 0,
    dtcadastro: row.dtcadastro || null,
    qtd_produtos: Number(extras.qtd_produtos) || 0,
    qtd_escopos: Number(extras.qtd_escopos) || 0,
  };
}

async function getCampanha(pool, id) {
  if (!(await tabelaCampanhaExiste(pool))) return null;
  const [[row]] = await pool.query(
    `SELECT c.*,
      (SELECT COUNT(*) FROM produto_promocoes pp
       WHERE pp.id_campanha = c.id AND pp.excluido = 'N') AS qtd_produtos,
      (SELECT COUNT(*) FROM promocoes_campanha_escopo e
       WHERE e.id_campanha = c.id AND e.excluido = 'N') AS qtd_escopos
     FROM promocoes_campanha c
     WHERE c.id = ? AND c.excluido = 'N' LIMIT 1`,
    [id]
  );
  if (!row) return null;
  const camp = formatarCampanhaRow(row, row);
  const [escopos] = await pool.query(
    `SELECT tipo, ref_id, ref_valor FROM promocoes_campanha_escopo
     WHERE id_campanha = ? AND excluido = 'N' ORDER BY id`,
    [id]
  );
  camp.escopos = escopos || [];
  return camp;
}

async function listarCampanhas(pool, opts = {}) {
  if (!(await tabelaCampanhaExiste(pool))) return { data: [], total: 0 };
  const somenteAtivas = opts.ativo !== 'N';
  const q = String(opts.q || '').trim();
  const limit = Math.min(200, Math.max(1, parseInt(opts.limit, 10) || 50));
  const offset = Math.max(0, parseInt(opts.offset, 10) || 0);

  let where = `c.excluido = 'N'`;
  const params = [];
  if (somenteAtivas) {
    where += ` AND c.ativo = 'S'
      AND (c.data_inicio IS NULL OR c.data_inicio <= CURDATE())
      AND (c.data_fim IS NULL OR c.data_fim >= CURDATE())`;
  }
  if (q) {
    where += ` AND c.descricao LIKE ?`;
    params.push(`%${q}%`);
  }

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM promocoes_campanha c WHERE ${where}`,
    params
  );

  const [rows] = await pool.query(
    `SELECT c.*,
      (SELECT COUNT(*) FROM produto_promocoes pp
       WHERE pp.id_campanha = c.id AND pp.excluido = 'N') AS qtd_produtos,
      (SELECT COUNT(*) FROM promocoes_campanha_escopo e
       WHERE e.id_campanha = c.id AND e.excluido = 'N') AS qtd_escopos
     FROM promocoes_campanha c
     WHERE ${where}
     ORDER BY c.data_fim IS NULL DESC, c.data_fim DESC, c.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return {
    data: rows.map((r) => formatarCampanhaRow(r, r)),
    total: Number(total) || 0,
  };
}

async function gravarCampanha(pool, body, campanhaId = null) {
  if (!(await tabelaCampanhaExiste(pool))) {
    return { status: 503, json: { error: 'Tabela promocoes_campanha indisponível. Reinicie o servidor.' } };
  }

  const val = validarPayloadCampanha(body);
  if (!val.ok) return { status: 400, json: { error: val.erros[0] } };

  const params = [
    val.desc.slice(0, 200),
    val.tipoNorm,
    val.val,
    val.qtdMin,
    body.data_inicio || null,
    body.data_fim || null,
    body.destaque === 'S' || body.destaque === true ? 'S' : 'N',
    body.ativo === 'N' ? 'N' : 'S',
    val.codCliente,
    val.idRegiao,
    val.codFornecedor,
    val.idTabelaPreco,
    val.tabelasPrecoStr,
    val.syncPrecopromo,
    val.prioridade,
  ];

  if (campanhaId) {
    const [[ex]] = await pool.query(
      `SELECT id FROM promocoes_campanha WHERE id=? AND excluido='N' LIMIT 1`,
      [campanhaId]
    );
    if (!ex) return { status: 404, json: { error: 'Campanha não encontrada' } };

    await pool.query(
      `UPDATE promocoes_campanha SET
         descricao=?, tipo=?, valor=?, qtd_minima=?, data_inicio=?, data_fim=?, destaque=?, ativo=?,
         cod_cliente=?, id_regiao=?, cod_fornecedor=?, id_tabela_preco=?, tabelas_preco=?, sync_precopromo=?, prioridade=?
       WHERE id=?`,
      [...params, campanhaId]
    );

    await pool.query(
      `UPDATE produto_promocoes SET
         descricao=?, tipo=?, valor=?, qtd_minima=?, data_inicio=?, data_fim=?, destaque=?, ativo=?,
         cod_cliente=?, id_regiao=?, cod_fornecedor=?, id_tabela_preco=?, tabelas_preco=?, sync_precopromo=?
       WHERE id_campanha=? AND excluido='N'`,
      [
        val.desc.slice(0, 200), val.tipoNorm, val.val, val.qtdMin,
        body.data_inicio || null, body.data_fim || null,
        body.destaque === 'S' || body.destaque === true ? 'S' : 'N',
        body.ativo === 'N' ? 'N' : 'S',
        val.codCliente, val.idRegiao, val.codFornecedor, val.idTabelaPreco, val.tabelasPrecoStr, val.syncPrecopromo,
        campanhaId,
      ]
    );

    return { status: 200, json: { ok: true, id: campanhaId } };
  }

  const [r] = await pool.query(
    `INSERT INTO promocoes_campanha
       (descricao, tipo, valor, qtd_minima, data_inicio, data_fim, destaque, ativo,
        cod_cliente, id_regiao, cod_fornecedor, id_tabela_preco, tabelas_preco, sync_precopromo, prioridade)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    params
  );
  return { status: 201, json: { ok: true, id: r.insertId } };
}

async function excluirCampanha(pool, campanhaId) {
  if (!(await tabelaCampanhaExiste(pool))) {
    return { status: 503, json: { error: 'Tabela promocoes_campanha indisponível.' } };
  }
  const [r] = await pool.query(
    `UPDATE promocoes_campanha SET excluido='S' WHERE id=? AND excluido='N'`,
    [campanhaId]
  );
  if (!r.affectedRows) return { status: 404, json: { error: 'Campanha não encontrada' } };
  await pool.query(`UPDATE produto_promocoes SET excluido='S' WHERE id_campanha=? AND excluido='N'`, [campanhaId]);
  await pool.query(`UPDATE promocoes_campanha_escopo SET excluido='S' WHERE id_campanha=? AND excluido='N'`, [campanhaId]);
  return { status: 200, json: { ok: true } };
}

async function upsertPromoProduto(pool, tb, campanha, codProduto, overrides = {}) {
  const prodId = parseInt(codProduto, 10);
  if (!prodId) return { ok: false, error: 'ID produto inválido' };

  const [[prod]] = await pool.query(
    `SELECT ID, vlr_venda FROM ${tb} WHERE ID=? AND (excluido='N' OR excluido IS NULL OR excluido='') LIMIT 1`,
    [prodId]
  );
  if (!prod) return { ok: false, error: `Produto #${prodId} não encontrado` };

  const tipo = overrides.tipo || campanha.tipo;
  const valor = overrides.valor != null ? parseFloat(overrides.valor) : parseFloat(campanha.valor);
  const qtdMin = overrides.qtd_minima != null ? parseFloat(overrides.qtd_minima) : parseFloat(campanha.qtd_minima);

  const payload = {
    descricao: campanha.descricao,
    tipo,
    valor,
    qtd_minima: qtdMin,
    data_inicio: campanha.data_inicio,
    data_fim: campanha.data_fim,
    destaque: campanha.destaque ? 'S' : 'N',
    ativo: campanha.ativo ? 'S' : 'N',
    cod_cliente: campanha.cod_cliente,
    id_regiao: campanha.id_regiao,
    cod_fornecedor: campanha.cod_fornecedor,
    id_tabela_preco: campanha.id_tabela_preco,
    tabelas_preco: campanha.tabelas_preco,
    sync_precopromo: campanha.sync_precopromo ? 'S' : 'N',
  };

  const val = validarPayloadPromocao(payload, parseFloat(prod.vlr_venda) || 0);
  if (!val.ok) return { ok: false, error: val.erros[0] };

  const [[existing]] = await pool.query(
    `SELECT id FROM produto_promocoes
     WHERE cod_produto=? AND id_campanha=? AND excluido='N' LIMIT 1`,
    [prodId, campanha.id]
  );

  const promoParams = [
    val.desc.slice(0, 200), val.tipoNorm, val.val, val.qtdMin,
    payload.data_inicio || null, payload.data_fim || null,
    payload.destaque, payload.ativo,
    val.codCliente, val.idRegiao, val.codFornecedor, val.idTabelaPreco, val.tabelasPrecoStr, val.syncPrecopromo,
    campanha.id,
  ];

  if (existing) {
    await pool.query(
      `UPDATE produto_promocoes SET
         descricao=?, tipo=?, valor=?, qtd_minima=?, data_inicio=?, data_fim=?, destaque=?, ativo=?,
         cod_cliente=?, id_regiao=?, cod_fornecedor=?, id_tabela_preco=?, tabelas_preco=?, sync_precopromo=?, id_campanha=?
       WHERE id=?`,
      [...promoParams, existing.id]
    );
  } else {
    await pool.query(
      `INSERT INTO produto_promocoes
         (cod_produto, descricao, tipo, valor, qtd_minima, data_inicio, data_fim, destaque, ativo,
          cod_cliente, id_regiao, cod_fornecedor, id_tabela_preco, tabelas_preco, sync_precopromo, id_campanha)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [prodId, ...promoParams]
    );
  }

  if (val.syncPrecopromo === 'S' && payload.ativo !== 'N') {
    await sincronizarPrecopromoLegado(pool, tb, prodId, {
      tipo: val.tipoNorm, valor: val.val, qtd_minima: val.qtdMin, ativo: 'S', sync_precopromo: 'S',
    }, prod.vlr_venda);
  }

  return { ok: true };
}

async function adicionarProdutosCampanha(pool, getTabela, campanhaId, prodIds = []) {
  const camp = await getCampanha(pool, campanhaId);
  if (!camp) return { status: 404, json: { error: 'Campanha não encontrada' } };

  const tb = await getTabela(pool);
  const ids = [...new Set(prodIds.map((x) => parseInt(x, 10)).filter((x) => x > 0))];
  if (!ids.length) return { status: 400, json: { error: 'Informe ao menos um produto' } };

  const erros = [];
  let ok = 0;
  for (const pid of ids) {
    const r = await upsertPromoProduto(pool, tb, camp, pid);
    if (r.ok) ok += 1;
    else erros.push({ cod_produto: pid, error: r.error });
  }

  for (const pid of ids) {
    await pool.query(
      `INSERT INTO promocoes_campanha_escopo (id_campanha, tipo, ref_id, excluido)
       SELECT ?, 'PRODUTO', ?, 'N' FROM DUAL
       WHERE NOT EXISTS (
         SELECT 1 FROM promocoes_campanha_escopo
         WHERE id_campanha=? AND tipo='PRODUTO' AND ref_id=? AND excluido='N'
       )`,
      [campanhaId, pid, campanhaId, pid]
    ).catch(() => {});
  }

  return { status: 200, json: { ok: true, inseridos: ok, erros } };
}

async function adicionarEscopoCampanha(pool, getTabela, campanhaId, escopos = []) {
  const camp = await getCampanha(pool, campanhaId);
  if (!camp) return { status: 404, json: { error: 'Campanha não encontrada' } };

  const tb = await getTabela(pool);
  const tiposValidos = new Set(['PRODUTO', 'GRUPO', 'SEGMENTO', 'CATEGORIA', 'FAMILIA']);
  let materializados = 0;
  const erros = [];

  for (const e of escopos) {
    const tipo = String(e.tipo || '').toUpperCase();
    if (!tiposValidos.has(tipo)) {
      erros.push({ escopo: e, error: 'Tipo de escopo inválido' });
      continue;
    }

    const refId = parseOptInt(e.ref_id);
    const refValor = e.ref_valor != null ? String(e.ref_valor).trim() : null;

    if (tipo === 'PRODUTO' && !refId) {
      erros.push({ escopo: e, error: 'ref_id obrigatório para PRODUTO' });
      continue;
    }
    if (tipo === 'CATEGORIA' && !refId && !refValor) {
      erros.push({ escopo: e, error: 'ref_id ou ref_valor obrigatório para CATEGORIA' });
      continue;
    }
    if (tipo !== 'PRODUTO' && tipo !== 'CATEGORIA' && !refValor) {
      erros.push({ escopo: e, error: 'ref_valor obrigatório para escopo por grupo/categoria' });
      continue;
    }

    await pool.query(
      `INSERT INTO promocoes_campanha_escopo (id_campanha, tipo, ref_id, ref_valor, valor_override, excluido)
       VALUES (?,?,?,?,?, 'N')`,
      [campanhaId, tipo, refId, refValor, e.valor_override != null ? parseFloat(e.valor_override) : null]
    );

    let prodIds = [];
    if (tipo === 'PRODUTO') {
      prodIds = [refId];
    } else if (tipo === 'GRUPO') {
      const [rows] = await pool.query(
        `SELECT ID FROM ${tb} WHERE nome_grupo=? AND (excluido='N' OR excluido IS NULL OR excluido='') AND situacao='A'`,
        [refValor]
      );
      prodIds = rows.map((r) => r.ID);
    } else if (tipo === 'SEGMENTO' || tipo === 'CATEGORIA') {
      let descCat = refValor;
      if (tipo === 'CATEGORIA' && refId) {
        const [cats] = await pool.query(
          `SELECT descricao FROM categoria WHERE id=? AND (excluido='N' OR excluido IS NULL) LIMIT 1`,
          [refId]
        ).catch(() => [[]]);
        if (cats.length) descCat = cats[0].descricao;
      }
      if (!descCat) {
        erros.push({ escopo: e, error: 'Categoria não encontrada' });
        continue;
      }
      const [cols] = await pool.query(`SHOW COLUMNS FROM ${tb} LIKE 'segmento'`);
      if (!cols.length) {
        erros.push({ escopo: e, error: 'Coluna segmento não existe na tabela de produtos' });
        continue;
      }
      const [rows] = await pool.query(
        `SELECT ID FROM ${tb} WHERE segmento=? AND (excluido='N' OR excluido IS NULL OR excluido='') AND situacao='A'`,
        [descCat]
      );
      prodIds = rows.map((r) => r.ID);
    } else if (tipo === 'FAMILIA') {
      const [cols] = await pool.query(`SHOW COLUMNS FROM ${tb} LIKE 'id_familiaproduto'`);
      if (!cols.length) {
        erros.push({ escopo: e, error: 'Coluna id_familiaproduto não existe' });
        continue;
      }
      const [rows] = await pool.query(
        `SELECT ID FROM ${tb} WHERE id_familiaproduto=? AND (excluido='N' OR excluido IS NULL OR excluido='') AND situacao='A'`,
        [refId]
      );
      prodIds = rows.map((r) => r.ID);
    }

    const overrides = e.valor_override != null ? { valor: e.valor_override } : {};
    for (const pid of prodIds) {
      const r = await upsertPromoProduto(pool, tb, camp, pid, overrides);
      if (r.ok) materializados += 1;
      else erros.push({ cod_produto: pid, error: r.error });
    }
  }

  return { status: 200, json: { ok: true, materializados, erros } };
}

async function materializarCampanha(pool, getTabela, campanhaId) {
  const camp = await getCampanha(pool, campanhaId);
  if (!camp) return { status: 404, json: { error: 'Campanha não encontrada' } };

  const [escopos] = await pool.query(
    `SELECT * FROM promocoes_campanha_escopo WHERE id_campanha=? AND excluido='N'`,
    [campanhaId]
  );
  if (!escopos.length) return { status: 400, json: { error: 'Campanha sem escopos cadastrados' } };

  return adicionarEscopoCampanha(pool, getTabela, campanhaId, escopos.map((e) => ({
    tipo: e.tipo,
    ref_id: e.ref_id,
    ref_valor: e.ref_valor,
    valor_override: e.valor_override,
  })));
}

async function listarProdutosCampanha(pool, getTabela, campanhaId, opts = {}) {
  const camp = await getCampanha(pool, campanhaId);
  if (!camp) return { status: 404, json: { error: 'Campanha não encontrada' } };

  const tb = await getTabela(pool);
  const limit = Math.min(500, Math.max(1, parseInt(opts.limit, 10) || 100));
  const offset = Math.max(0, parseInt(opts.offset, 10) || 0);

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM produto_promocoes WHERE id_campanha=? AND excluido='N'`,
    [campanhaId]
  );

  const [rows] = await pool.query(
    `SELECT pp.*, p.descricao AS nome_produto, p.vlr_venda
     FROM produto_promocoes pp
     INNER JOIN ${tb} p ON p.ID = pp.cod_produto
     WHERE pp.id_campanha=? AND pp.excluido='N'
     ORDER BY p.descricao
     LIMIT ? OFFSET ?`,
    [campanhaId, limit, offset]
  );

  return {
    status: 200,
    json: {
      campanha: camp,
      data: rows,
      total: Number(total) || 0,
    },
  };
}

async function previewDescontoCampanha(pool, getTabela, campanhaId, overrides = {}) {
  const camp = await getCampanha(pool, campanhaId);
  if (!camp) return { status: 404, json: { error: 'Campanha não encontrada' } };

  const tipoRaw = overrides.tipo != null ? overrides.tipo : camp.tipo;
  const tipo = String(tipoRaw || '').toUpperCase() === 'DESCONTO_PERC' ? 'DESCONTO_PERC' : 'PRECO_FIXO';
  const valor = overrides.valor != null ? parseFloat(overrides.valor) : parseFloat(camp.valor) || 0;
  const qtdMin = overrides.qtd_minima != null ? parseFloat(overrides.qtd_minima) : parseFloat(camp.qtd_minima) || 1;
  const qtdSim = overrides.qtd_simulada != null ? parseFloat(overrides.qtd_simulada) : qtdMin;
  const descricao = overrides.descricao != null ? String(overrides.descricao).trim() : camp.descricao;

  const limit = Math.min(500, Math.max(1, parseInt(overrides.limit, 10) || 100));
  const offset = Math.max(0, parseInt(overrides.offset, 10) || 0);
  const tb = await getTabela(pool);

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM produto_promocoes WHERE id_campanha=? AND excluido='N'`,
    [campanhaId]
  );

  const [rows] = await pool.query(
    `SELECT pp.id, pp.cod_produto, pp.tipo AS tipo_atual, pp.valor AS valor_atual, pp.qtd_minima AS qtd_atual,
            p.descricao, p.vlr_venda, p.cod_fabricante
     FROM produto_promocoes pp
     INNER JOIN ${tb} p ON p.ID = pp.cod_produto
     WHERE pp.id_campanha=? AND pp.excluido='N'
     ORDER BY p.descricao
     LIMIT ? OFFSET ?`,
    [campanhaId, limit, offset]
  );

  const items = rows.map((r) => {
    const base = parseFloat(r.vlr_venda) || 0;
    const precoAtual = calcularPrecoPromocao(r.tipo_atual, r.valor_atual, base);
    const precoNovo = calcularPrecoPromocao(tipo, valor, base);
    const valorDescontoNovo = Math.round((base - precoNovo) * 100) / 100;
    const valorDescontoAtual = Math.round((base - precoAtual) * 100) / 100;
    const aplicaComQtdSim = qtdSim >= qtdMin;
    const precoEfetivoPedido = aplicaComQtdSim ? precoNovo : base;
    const descontoEfetivoPedido = aplicaComQtdSim ? valorDescontoNovo : 0;
    const valorAtual = parseFloat(r.valor_atual) || 0;
    const altera = Math.abs(precoAtual - precoNovo) > 0.0001
      || String(r.tipo_atual || '').toUpperCase() !== tipo
      || Math.abs(valorAtual - valor) > 0.0001
      || Math.abs((parseFloat(r.qtd_atual) || 1) - qtdMin) > 0.0001;
    const descontoRegra = tipo === 'DESCONTO_PERC'
      ? `${valor}%`
      : `Fixo R$ ${valor.toFixed(2).replace('.', ',')}`;
    return {
      cod_produto: r.cod_produto,
      descricao: r.descricao,
      cod_fabricante: r.cod_fabricante || null,
      vlr_venda: base,
      preco_atual: precoAtual,
      preco_novo: precoNovo,
      economia: valorDescontoNovo,
      valor_desconto_novo: valorDescontoNovo,
      valor_desconto_atual: valorDescontoAtual,
      desconto_regra: descontoRegra,
      pct_efetivo: base > 0 ? Math.round((1 - precoNovo / base) * 10000) / 100 : 0,
      aplica_com_qtd_sim: aplicaComQtdSim,
      preco_efetivo_pedido: precoEfetivoPedido,
      desconto_efetivo_pedido: descontoEfetivoPedido,
      altera,
    };
  });

  const regraTxt = tipo === 'DESCONTO_PERC'
    ? `${valor}% de desconto (R$ por unidade varia conforme o preço de tabela)`
    : `Preço fixo R$ ${valor.toFixed(2).replace('.', ',')}`;

  const aplicaPagina = items.filter((i) => i.aplica_com_qtd_sim).length;
  const naoAplicaPagina = items.length - aplicaPagina;

  return {
    status: 200,
    json: {
      campanha: {
        id: campanhaId,
        descricao,
        tipo,
        valor,
        qtd_minima: qtdMin,
        data_inicio: overrides.data_inicio !== undefined ? overrides.data_inicio : camp.data_inicio,
        data_fim: overrides.data_fim !== undefined ? overrides.data_fim : camp.data_fim,
        ativo: overrides.ativo !== undefined ? overrides.ativo !== 'N' : camp.ativo,
      },
      desconto_regra: tipo === 'DESCONTO_PERC' ? `${valor}%` : `R$ ${valor.toFixed(2)}`,
      qtd_simulada: qtdSim,
      regra_txt: regraTxt,
      qtd_minima_aviso: qtdMin > 1
        ? `No pedido, o preço promocional só é aplicado quando a quantidade do item for ${qtdMin} ou mais.`
        : null,
      total: Number(total) || 0,
      items,
      resumo: {
        produtos_total: Number(total) || 0,
        nesta_pagina: items.length,
        com_alteracao: items.filter((i) => i.altera).length,
        economia_total_pagina: Math.round(items.reduce((s, i) => s + i.valor_desconto_novo, 0) * 100) / 100,
        aplica_com_qtd_sim: aplicaPagina,
        nao_aplica_com_qtd_sim: naoAplicaPagina,
        desconto_total_pedido_pagina: Math.round(items.reduce((s, i) => s + i.desconto_efetivo_pedido, 0) * 100) / 100,
      },
    },
  };
}

async function acoesLotePromocoes(pool, body = {}) {
  const acao = String(body.acao || '').toLowerCase();
  const ids = Array.isArray(body.ids) ? body.ids.map((x) => parseInt(x, 10)).filter((x) => x > 0) : [];
  const idCampanha = parseOptInt(body.id_campanha);
  const dataFim = body.data_fim || null;
  const dataInicio = body.data_inicio || null;
  const ativo = body.ativo === 'S' ? 'S' : (body.ativo === 'N' ? 'N' : null);

  if (!acao) return { status: 400, json: { error: 'Informe acao' } };
  if (!ids.length && !idCampanha) {
    return { status: 400, json: { error: 'Informe ids ou id_campanha' } };
  }

  let where = `excluido='N'`;
  const params = [];
  if (ids.length) {
    where += ` AND id IN (${ids.map(() => '?').join(',')})`;
    params.push(...ids);
  }
  if (idCampanha) {
    where += ids.length ? ` AND id_campanha=?` : ` AND id_campanha=?`;
    params.push(idCampanha);
  }

  if (acao === 'prorrogar') {
    if (!dataFim && !dataInicio) {
      return { status: 400, json: { error: 'Informe data_fim ou data_inicio para prorrogar' } };
    }
    const sets = [];
    const p2 = [];
    if (dataFim) { sets.push('data_fim=?'); p2.push(dataFim); }
    if (dataInicio) { sets.push('data_inicio=?'); p2.push(dataInicio); }
    const [r] = await pool.query(
      `UPDATE produto_promocoes SET ${sets.join(', ')} WHERE ${where}`,
      [...p2, ...params]
    );
    if (idCampanha && (await tabelaCampanhaExiste(pool))) {
      await pool.query(
        `UPDATE promocoes_campanha SET ${sets.join(', ')} WHERE id=? AND excluido='N'`,
        [...p2, idCampanha]
      );
    }
    return { status: 200, json: { ok: true, afetados: r.affectedRows } };
  }

  if (acao === 'inativar' || acao === 'ativar') {
    const flag = acao === 'ativar' ? 'S' : 'N';
    const [r] = await pool.query(
      `UPDATE produto_promocoes SET ativo=? WHERE ${where}`,
      [flag, ...params]
    );
    if (idCampanha && (await tabelaCampanhaExiste(pool))) {
      await pool.query(
        `UPDATE promocoes_campanha SET ativo=? WHERE id=? AND excluido='N'`,
        [flag, idCampanha]
      );
    }
    return { status: 200, json: { ok: true, afetados: r.affectedRows } };
  }

  if (acao === 'excluir') {
    const [r] = await pool.query(
      `UPDATE produto_promocoes SET excluido='S' WHERE ${where}`,
      params
    );
    return { status: 200, json: { ok: true, afetados: r.affectedRows } };
  }

  return { status: 400, json: { error: 'Ação inválida. Use prorrogar, inativar, ativar ou excluir' } };
}

module.exports = {
  tabelaCampanhaExiste,
  validarPayloadCampanha,
  formatarCampanhaRow,
  getCampanha,
  listarCampanhas,
  gravarCampanha,
  excluirCampanha,
  adicionarProdutosCampanha,
  adicionarEscopoCampanha,
  materializarCampanha,
  listarProdutosCampanha,
  acoesLotePromocoes,
  upsertPromoProduto,
  previewDescontoCampanha,
};
