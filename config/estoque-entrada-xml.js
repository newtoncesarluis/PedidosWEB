'use strict';

/**
 * Entrada de mercadoria via NF-e XML (Estoque):
 * 1) Preview / conferência (não grava)
 * 2) Confirmação → Contas a Pagar (duplicatas) + estoque (se habilitado)
 */

const { parseNFe } = require('../parsers/nfe-parser');
const { ensureMovimentoEstoqueTable } = require('./estoque-movimentacao');
const { ensureFinanceiroContabilCols } = require('./plano-contas-schema');
const { hojeIsoBrasil, horaBrasil } = require('./date-brasil');

async function _tabelaProduto(pool) {
  const [r] = await pool.query(`SHOW TABLES LIKE 'produto'`);
  return r.length ? 'produto' : 'produtos';
}

async function _colsMap(pool, table) {
  const [rows] = await pool.query(`DESCRIBE \`${table}\``).catch(() => [[]]);
  const map = {};
  for (const c of rows || []) map[String(c.Field || '').toLowerCase()] = c.Field;
  return map;
}

function _pickCol(cols, ...candidates) {
  for (const c of candidates) {
    if (cols[c.toLowerCase()]) return cols[c.toLowerCase()];
  }
  return null;
}

async function estoqueHabilitado(pool) {
  try {
    const [[s]] = await pool.query(
      `SELECT IFNULL(habilitarestoque,'N') AS h FROM sistemas ORDER BY id DESC LIMIT 1`
    );
    if (String(s?.h || 'N').toUpperCase() === 'S') return true;
  } catch (_) {}
  try {
    const [[s2]] = await pool.query(
      `SELECT IFNULL(gerenciaestoque,'N') AS g FROM sistema LIMIT 1`
    );
    if (String(s2?.g || 'N').toUpperCase() === 'S') return true;
  } catch (_) {}
  try {
    const [[s3]] = await pool.query(
      `SELECT IFNULL(gerenciaestoque,'N') AS g FROM sistemas ORDER BY id DESC LIMIT 1`
    );
    if (String(s3?.g || 'N').toUpperCase() === 'S') return true;
  } catch (_) {}
  return false;
}

async function _buscarFornecedorPorDoc(pool, cnpj, cpf, nome) {
  const cols = await _colsMap(pool, 'fornecedores');
  // Neste projeto o documento do fornecedor costuma ser a coluna `cpf` (CPF/CNPJ)
  const colDoc = _pickCol(cols, 'cpf', 'cnpj', 'cgc', 'cpf_cnpj', 'cpfcnpj', 'documento');
  const colNome = _pickCol(cols, 'nome') || 'nome';
  const doc = (cnpj || cpf || '').replace(/\D/g, '');

  if (colDoc && doc) {
    const [rows] = await pool.query(
      `SELECT id, ${colNome} AS nome FROM fornecedores
       WHERE REPLACE(REPLACE(REPLACE(REPLACE(IFNULL(${colDoc},''),'.',''),'/',''),'-',''),' ','') = ?
         AND (excluido='N' OR excluido IS NULL OR excluido='')
       LIMIT 1`,
      [doc]
    ).catch(() => [[]]);
    if (rows[0]) return { id: rows[0].id, nome: rows[0].nome, match: 'documento' };
  }

  const nomeTrim = String(nome || '').trim().toUpperCase();
  if (nomeTrim) {
    const [rows] = await pool.query(
      `SELECT id, ${colNome} AS nome FROM fornecedores
       WHERE UPPER(${colNome}) = ?
         AND (excluido='N' OR excluido IS NULL OR excluido='')
       LIMIT 1`,
      [nomeTrim]
    ).catch(() => [[]]);
    if (rows[0]) return { id: rows[0].id, nome: rows[0].nome, match: 'nome' };
  }
  return null;
}

/**
 * Cria fornecedor (tipo FABRICA) com colunas que existirem na base.
 * @param {object} db - pool ou connection
 */
async function _resolverOuCriarFornecedor(db, emitente) {
  const found = await _buscarFornecedorPorDoc(
    db,
    emitente?.cnpj,
    emitente?.cpf,
    emitente?.nome || emitente?.fantasia
  );
  if (found) return found;

  const nome = String(emitente?.nome || emitente?.fantasia || 'FORNECEDOR XML').trim().toUpperCase();
  const cols = await _colsMap(db, 'fornecedores');
  const colDoc = _pickCol(cols, 'cpf', 'cnpj', 'cgc', 'cpf_cnpj', 'cpfcnpj', 'documento');
  const doc = (emitente?.cnpj || emitente?.cpf || '').replace(/\D/g, '') || null;

  const fields = [];
  const vals = [];
  const add = (colName, val) => {
    const real = cols[colName.toLowerCase()];
    if (!real) return;
    fields.push(real);
    vals.push(val);
  };

  add('nome', nome);
  add('tipo', 'FABRICA');
  add('status', 'A');
  add('excluido', 'N');
  add('dtcadastro', hojeIsoBrasil());
  if (colDoc && doc) {
    fields.push(colDoc);
    vals.push(doc);
  }

  if (!fields.length || !cols.nome) {
    throw new Error('Não foi possível cadastrar o fornecedor da NF-e (tabela incompleta).');
  }

  const [ins] = await db.query(
    `INSERT INTO fornecedores (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`,
    vals
  );
  return { id: ins.insertId, nome, match: 'criado' };
}

/**
 * Cadastra produto a partir do item da NF-e (colunas existentes na base).
 */
async function _criarProdutoFromNfe(db, tabela, cols, item, idFornecedor) {
  const colDesc = _pickCol(cols, 'descricao');
  if (!colDesc) throw new Error('Tabela de produto sem coluna descricao.');

  const fields = [];
  const vals = [];
  const add = (candidates, val) => {
    if (val == null || val === '') return;
    const real = _pickCol(cols, ...(Array.isArray(candidates) ? candidates : [candidates]));
    if (!real || fields.includes(real)) return;
    fields.push(real);
    vals.push(val);
  };

  const desc = String(item.descricao || item.descricao_nfe || 'PRODUTO XML').trim().toUpperCase().slice(0, 200);
  add('descricao', desc);
  add(['cod_fabricante', 'codfabricante'], String(item.cod_fabricante || '').trim().slice(0, 60) || null);
  add(['cod_barras', 'cod_barra', 'codbarra', 'ean'], String(item.cod_barras || '').trim().slice(0, 20) || null);
  add(['unidade', 'un'], String(item.unidade || 'UN').trim().toUpperCase().slice(0, 10) || 'UN');
  add(['ncm'], String(item.ncm || '').replace(/\D/g, '').slice(0, 10) || null);
  add(['vlr_venda', 'preco_venda', 'valor_venda'], parseFloat(item.valor_unitario) || 0);
  add(['vlr_custo', 'preco_custo', 'custo'], parseFloat(item.valor_unitario) || 0);
  add(['cod_fornecedorpadrao', 'cod_fornecedor'], idFornecedor || null);
  add(['situacao'], 'A');
  add(['excluido'], 'N');
  add(['estoque_atual'], 0);
  add(['estoque_minimo'], 0);
  if (cols.dt_cadastro) {
    fields.push(cols.dt_cadastro);
    vals.push(hojeIsoBrasil());
  }

  if (!fields.length) throw new Error('Não foi possível montar o cadastro do produto.');

  const [ins] = await db.query(
    `INSERT INTO ${tabela} (${fields.map((f) => `\`${f}\``).join(',')}) VALUES (${fields.map(() => '?').join(',')})`,
    vals
  );
  return {
    id: ins.insertId,
    descricao: desc,
    estoque_atual: 0,
    criado: true,
  };
}

async function _casarProduto(pool, tabela, item, colsCache) {
  const cols = colsCache || await _colsMap(pool, tabela);
  const colFab = _pickCol(cols, 'cod_fabricante', 'codfabricante');
  const colBar = _pickCol(cols, 'cod_barras', 'cod_barra', 'codbarra', 'ean');
  const colDesc = _pickCol(cols, 'descricao') || 'descricao';
  const colId = _pickCol(cols, 'ID', 'id') || 'ID';
  const temEstoque = !!cols.estoque_atual;
  const selEstoque = temEstoque ? 'IFNULL(estoque_atual,0) AS estoque_atual' : '0 AS estoque_atual';

  if (colFab && item.cod_fabricante) {
    const params = [item.cod_fabricante];
    let sql = `SELECT ${colId} AS id, ${colDesc} AS descricao, ${selEstoque}
               FROM ${tabela}
               WHERE ${colFab} = ? AND (excluido IS NULL OR excluido='N')`;
    if (colBar && item.cod_barras && item.cod_barras !== 'SEM GTIN') {
      sql = `SELECT ${colId} AS id, ${colDesc} AS descricao, ${selEstoque}
             FROM ${tabela}
             WHERE (${colFab} = ? OR ${colBar} = ?) AND (excluido IS NULL OR excluido='N')`;
      params.push(item.cod_barras);
    }
    sql += ' LIMIT 1';
    const [[p]] = await pool.query(sql, params).catch(() => [[null]]);
    if (p) return p;
  }

  if (colBar && item.cod_barras && item.cod_barras !== 'SEM GTIN') {
    const [[p]] = await pool.query(
      `SELECT ${colId} AS id, ${colDesc} AS descricao, ${selEstoque}
       FROM ${tabela}
       WHERE ${colBar} = ? AND (excluido IS NULL OR excluido='N') LIMIT 1`,
      [item.cod_barras]
    ).catch(() => [[null]]);
    if (p) return p;
  }

  if (item.cod_fabricante && /^\d+$/.test(item.cod_fabricante)) {
    const [[p]] = await pool.query(
      `SELECT ${colId} AS id, ${colDesc} AS descricao, ${selEstoque}
       FROM ${tabela}
       WHERE ${colId} = ? AND (excluido IS NULL OR excluido='N') LIMIT 1`,
      [parseInt(item.cod_fabricante, 10)]
    ).catch(() => [[null]]);
    if (p) return p;
  }

  return null;
}

async function _jaImportouChave(pool, chave) {
  if (!chave) return { estoque: false, pagar: false };
  await ensureMovimentoEstoqueTable(pool);
  const [[mov]] = await pool.query(
    `SELECT id FROM movimento_estoque WHERE chave_nfe = ? LIMIT 1`,
    [chave]
  ).catch(() => [[null]]);

  const [[pag]] = await pool.query(
    `SELECT id FROM pagar
     WHERE (excluido='N' OR excluido IS NULL OR excluido='')
       AND obs LIKE ?
     LIMIT 1`,
    [`%chave:${chave}%`]
  ).catch(() => [[null]]);

  return { estoque: !!mov, pagar: !!pag };
}

async function _proximoNumeroPagar(db) {
  const [rows] = await db.query(`SELECT COALESCE(MAX(numero), 0) + 1 AS proximo FROM pagar`);
  return parseInt(rows[0]?.proximo, 10) || 1;
}

function _docFromNumero(numero) {
  return ('P' + String(parseInt(numero, 10) || 0).padStart(6, '0')).slice(0, 15);
}

/**
 * Grava movimento na conexão (mesma lógica do motor de estoque).
 */
async function _gravarMovimentoConn(conn, {
  cod_produto, tipo_movimento, quantidade, id_usuario, nome_usuario,
  observacao, nota_fiscal, chave_nfe, fornecedor_nome, tabela,
}) {
  const tab = tabela || await _tabelaProduto(conn);
  const [[prod]] = await conn.query(
    `SELECT ID, descricao, IFNULL(estoque_atual,0) AS estoque_atual FROM ${tab} WHERE ID = ? LIMIT 1`,
    [cod_produto]
  );
  if (!prod) throw new Error(`Produto ${cod_produto} não encontrado`);

  const saldo_ant = parseFloat(prod.estoque_atual) || 0;
  const qtd = parseFloat(quantidade) || 0;
  const saldo_pos = saldo_ant + qtd;
  const data = hojeIsoBrasil();
  const hora = horaBrasil();

  await conn.query(
    `UPDATE ${tab} SET estoque_atual = ? WHERE ID = ?`,
    [saldo_pos, cod_produto]
  );
  await conn.query(
    `INSERT INTO movimento_estoque
      (cod_produto, desc_produto, tipo_movimento, quantidade, saldo_anterior, saldo_posterior,
       id_usuario, nome_usuario, observacao, nota_fiscal, chave_nfe, fornecedor_nome,
       data_movimento, hora_movimento)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      cod_produto, prod.descricao, tipo_movimento, qtd, saldo_ant, saldo_pos,
      id_usuario || null, nome_usuario || null, observacao || null,
      nota_fiscal || null, chave_nfe || null, fornecedor_nome || null,
      data, hora,
    ]
  );
  return { saldo_anterior: saldo_ant, saldo_posterior: saldo_pos };
}

async function previewEntradaXml(pool, xmlString) {
  const nfe = parseNFe(Buffer.from(xmlString, 'utf8'));
  const tabela = await _tabelaProduto(pool);
  const colsProd = await _colsMap(pool, tabela);
  const estoqueOn = await estoqueHabilitado(pool);
  const ja = await _jaImportouChave(pool, nfe.chave);
  const forn = await _buscarFornecedorPorDoc(
    pool,
    nfe.emitente?.cnpj,
    nfe.emitente?.cpf,
    nfe.emitente?.nome
  );

  const itens = [];
  for (const item of nfe.items) {
    const qty = parseFloat(item.quantidade) || 0;
    if (qty <= 0) continue;
    const prod = await _casarProduto(pool, tabela, item, colsProd);
    itens.push({
      sequencial: item.sequencial,
      cod_fabricante: item.cod_fabricante,
      cod_barras: item.cod_barras,
      descricao_nfe: item.descricao,
      quantidade: qty,
      valor_unitario: item.valor_unitario,
      total_produtos: item.total_produtos,
      cod_produto: prod?.id || null,
      descricao_sys: prod?.descricao || null,
      estoque_atual: prod ? parseFloat(prod.estoque_atual) || 0 : null,
      status: prod ? 'ok' : 'nao_encontrado',
    });
  }

  return {
    chave: nfe.chave,
    numero: nfe.numero,
    serie: nfe.serie,
    data_emissao: nfe.data_emissao,
    natureza: nfe.natureza,
    emitente: nfe.emitente,
    total: nfe.total,
    duplicatas: nfe.duplicatas,
    fornecedor: forn,
    fornecedor_ausente: !forn,
    estoque_habilitado: estoqueOn,
    ja_importado_estoque: ja.estoque,
    ja_importado_pagar: ja.pagar,
    itens,
    ok: itens.filter((i) => i.status === 'ok').length,
    nao_encontrado: itens.filter((i) => i.status === 'nao_encontrado').length,
    xml_base64: Buffer.from(xmlString, 'utf8').toString('base64'),
  };
}

async function confirmarEntradaXml(pool, {
  xmlString,
  xml_base64,
  gerar_pagar = true,
  atualizar_estoque = true,
  criar_fornecedor = true,
  criar_produtos = true,
  id_usuario,
  nome_usuario,
  forcar = false,
} = {}) {
  const xml = xmlString || (xml_base64 ? Buffer.from(xml_base64, 'base64').toString('utf8') : '');
  if (!xml) {
    const err = new Error('XML não informado para confirmação.');
    err.code = 'XML_OBRIGATORIO';
    throw err;
  }

  const nfe = parseNFe(Buffer.from(xml, 'utf8'));
  if (!nfe.chave && !nfe.numero) {
    const err = new Error('NF-e sem chave/número — não é possível importar.');
    err.code = 'NFE_INVALIDA';
    throw err;
  }

  const ja = await _jaImportouChave(pool, nfe.chave);
  if (!forcar && gerar_pagar && ja.pagar) {
    const err = new Error('Já existem títulos no Contas a Pagar para esta chave NF-e.');
    err.code = 'DUPLICADO_PAGAR';
    throw err;
  }
  if (!forcar && atualizar_estoque && ja.estoque) {
    const err = new Error('Esta chave NF-e já gerou entrada de estoque.');
    err.code = 'DUPLICADO_ESTOQUE';
    throw err;
  }

  const estoqueOn = await estoqueHabilitado(pool);
  const doEstoque = !!atualizar_estoque && estoqueOn;
  const doPagar = !!gerar_pagar;
  const doCriarProdutos = !!criar_produtos;
  const doCriarForn = criar_fornecedor !== false && criar_fornecedor !== 'N';

  if (!doPagar && !doEstoque && !doCriarProdutos) {
    const err = new Error('Nada a gravar: marque Contas a Pagar, Atualizar estoque e/ou cadastro de itens.');
    err.code = 'NADA_A_FAZER';
    throw err;
  }

  if (doPagar && !(nfe.duplicatas || []).length) {
    const err = new Error('NF-e sem valor/parcelas para gerar Contas a Pagar.');
    err.code = 'SEM_PARCELAS';
    throw err;
  }

  const fornExistente = await _buscarFornecedorPorDoc(
    pool,
    nfe.emitente?.cnpj,
    nfe.emitente?.cpf,
    nfe.emitente?.nome || nfe.emitente?.fantasia
  );
  if (!fornExistente && !doCriarForn) {
    const err = new Error('Fornecedor da NF-e não está cadastrado. Cadastre antes ou confirme o cadastro automático.');
    err.code = 'FORNECEDOR_AUSENTE';
    throw err;
  }

  const tabela = await _tabelaProduto(pool);
  const colsProd = await _colsMap(pool, tabela);

  await ensureFinanceiroContabilCols(pool).catch(() => {});
  await ensureMovimentoEstoqueTable(pool);

  const conn = await pool.getConnection();
  const pagarIds = [];
  const estoqueItens = [];
  const produtosCriados = [];
  let forn = null;

  try {
    await conn.beginTransaction();

    if (fornExistente) {
      forn = fornExistente;
    } else {
      forn = await _resolverOuCriarFornecedor(conn, nfe.emitente);
    }

    if (doPagar) {
      const qtParc = nfe.duplicatas.length;
      for (let i = 0; i < qtParc; i++) {
        const dup = nfe.duplicatas[i];
        const vlr = parseFloat(dup.valor) || 0;
        if (vlr <= 0) continue;
        const venc = String(dup.vencimento || nfe.data_emissao || hojeIsoBrasil()).slice(0, 10);
        const numero = await _proximoNumeroPagar(conn);
        const doc = _docFromNumero(numero);
        const numeronf = String(nfe.numero || '').slice(0, 25);
        const obs = [
          `Entrada XML NF-e ${nfe.numero}/${nfe.serie}`,
          `chave:${nfe.chave}`,
          `Parcela ${dup.numero || i + 1}/${qtParc}`,
          forn.nome ? `Forn: ${forn.nome}` : '',
        ].filter(Boolean).join(' · ').slice(0, 500);

        const [ins] = await conn.query(
          `INSERT INTO pagar (
            numero, tipo, vencimento, valor, valor_pagar, vlrcomjuros, status, obs, doc, numeronf,
            prazo, parcela, forma_pagto, qt_parcelas, historico_rec, cond_pagto,
            cod_fornecedor, nome_fornecedor, data_lanc, id_natureza,
            id_despesas, despesas, cod_vendedor, data_pagto, vlrpago,
            forma_foipagto, juros, vlrjuros, vrljuros, vlracressimo,
            id_planoconta, id_centrocusto, excluido
          ) VALUES (?, 'PAGAR', STR_TO_DATE(?, '%Y-%m-%d'), ?, ?, ?, 'ABERTA', ?, ?, ?, 1, ?, 'DINHEIRO', ?, 'PAGAMENTO EFETUADO', 'DINHEIRO',
            ?, ?, NOW(), NULL, NULL, NULL, NULL, NULL, 0, 'DINHEIRO', 0, 0, 0, 0, NULL, NULL, 'N')`,
          [
            numero, venc, vlr, vlr, vlr, obs, doc, numeronf,
            i + 1, qtParc,
            forn.id || null, forn.nome || null,
          ]
        );
        pagarIds.push(ins.insertId);
      }
    }

    // Cadastro de produtos faltantes e/ou entrada de estoque
    if (doEstoque || doCriarProdutos) {
      for (const item of nfe.items) {
        const qty = parseFloat(item.quantidade) || 0;
        if (qty <= 0) continue;
        let prod = await _casarProduto(conn, tabela, item, colsProd);
        let criadoAgora = false;
        if (!prod && doCriarProdutos) {
          prod = await _criarProdutoFromNfe(conn, tabela, colsProd, item, forn.id);
          criadoAgora = true;
          produtosCriados.push({
            id: prod.id,
            descricao: prod.descricao,
            cod_fabricante: item.cod_fabricante,
          });
        }
        const row = {
          cod_fabricante: item.cod_fabricante,
          descricao_nfe: item.descricao,
          quantidade: qty,
          cod_produto: prod?.id || null,
          descricao_sys: prod?.descricao || null,
          status: prod ? (criadoAgora ? 'criado' : 'ok') : 'nao_encontrado',
          saldo_anterior: null,
          saldo_posterior: null,
          produto_criado: criadoAgora,
        };
        if (prod && doEstoque) {
          const mov = await _gravarMovimentoConn(conn, {
            cod_produto: prod.id,
            tipo_movimento: 'XML',
            quantidade: qty,
            observacao: `Entrada via XML — NF ${nfe.numero}/${nfe.serie}`,
            nota_fiscal: nfe.numero,
            chave_nfe: nfe.chave,
            fornecedor_nome: forn.nome || nfe.emitente?.nome || null,
            id_usuario,
            nome_usuario,
            tabela,
          });
          row.saldo_anterior = mov.saldo_anterior;
          row.saldo_posterior = mov.saldo_posterior;
        }
        estoqueItens.push(row);
      }
    }

    await conn.commit();
  } catch (e) {
    try { await conn.rollback(); } catch (_) {}
    throw e;
  } finally {
    conn.release();
  }

  return {
    ok: true,
    chave: nfe.chave,
    numero: nfe.numero,
    serie: nfe.serie,
    fornecedor: forn,
    fornecedor_criado: forn?.match === 'criado',
    pagar_ids: pagarIds,
    pagar_qtd: pagarIds.length,
    estoque_aplicado: doEstoque,
    estoque_habilitado: estoqueOn,
    produtos_criados: produtosCriados,
    produtos_criados_qtd: produtosCriados.length,
    itens_estoque: estoqueItens,
    ok_estoque: estoqueItens.filter((i) => i.status === 'ok' || i.status === 'criado').length,
    nao_encontrado: estoqueItens.filter((i) => i.status === 'nao_encontrado').length,
    erro_estoque: estoqueItens.filter((i) => i.status === 'erro').length,
  };
}

module.exports = {
  previewEntradaXml,
  confirmarEntradaXml,
  estoqueHabilitado,
};
