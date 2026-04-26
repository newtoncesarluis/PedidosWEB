'use strict';

const { getPool } = require('../../../config/database');

/**
 * Busca histórico completo do cliente: pedidos + itens + parcelas.
 *
 * Estratégia batch (3 queries, sem N+1):
 *   Query 1 — todos os pedidos do cliente (JOIN clientes para filtro de empresa)
 *   Query 2 — todos os itens dos pedidos encontrados (IN clause)
 *   Query 3 — todas as parcelas dos pedidos encontrados (IN clause)
 *
 * @param {string|number} idCliente
 * @param {object}        pool
 * @param {object}        opts
 *   opts.gcompartilhaCliente  'S'|'N'  — filtra por empresa do cliente
 *   opts.gIdEmpresa           string   — empresa do usuário logado
 *   opts.ghabilitapedidograde 'S'|'N'  — usa itenspedgrade ao invés de itensped
 */
async function buscarHistoricoCompleto(idCliente, pool, opts = {}) {
  const executor = pool || getPool();
  const {
    gcompartilhaCliente  = 'S',
    gIdEmpresa           = '',
    ghabilitapedidograde = 'N',
  } = opts;

  // ── 1. Pedidos ────────────────────────────────────────────────────────────────
  // JOIN clientes necessário apenas para filtrar id_empresa quando gcompartilhaCliente='N'.
  // SELECT p.* evita conflito de colunas (ambas as tabelas têm 'id').
  let sqlPedidos = `
    SELECT p.*
    FROM pedidos p
    INNER JOIN clientes c ON c.id = p.cod_cliente
    WHERE p.cod_cliente = ?
      AND p.excluido = 'N'`;

  const paramsPedidos = [idCliente];

  if (gcompartilhaCliente === 'N' && gIdEmpresa) {
    sqlPedidos += ` AND c.id_empresa = ?`;
    paramsPedidos.push(gIdEmpresa);
  }

  sqlPedidos += ` ORDER BY p.id DESC LIMIT 200`;

  let pedidos = [];
  try {
    [pedidos] = await executor.query(sqlPedidos, paramsPedidos);
  } catch (e) {
    console.error('[historico/pedidos]', e.message);
    return [];
  }

  if (pedidos.length === 0) return [];

  // ── 2. Extrair números de pedido (chave para itensped e receber) ──────────────
  // Convertemos para String porque Delphi usa QuotedStr (VARCHAR), então
  // itensped.numpedido pode ser '0123' enquanto pedidos.numero retorna 123 (INT).
  // Passar strings no IN garante comparação correta em ambos os tipos.
  const numeros = [...new Set(
    pedidos.map(p => p.numero).filter(n => n != null && n !== '').map(String)
  )];

  if (numeros.length === 0) {
    // Pedidos sem 'numero' — retorna sem itens/parcelas
    return pedidos.map((p, i) => ({
      pedido:   _normalizarPedido(p, i + 1),
      itens:    [],
      parcelas: [],
    }));
  }

  const ph = numeros.map(() => '?').join(',');

  // ── 3. Itens (batch) ──────────────────────────────────────────────────────────
  // Respeita ghabilitapedidograde; fallback automático para a outra tabela.
  const tabelaPrimaria   = ghabilitapedidograde === 'S' ? 'itenspedgrade' : 'itensped';
  const tabelaSecundaria = ghabilitapedidograde === 'S' ? 'itensped'      : 'itenspedgrade';

  let itens = [];
  try {
    [itens] = await executor.query(
      `SELECT * FROM ${tabelaPrimaria} WHERE numpedido IN (${ph})`,
      numeros
    );
  } catch {
    try {
      [itens] = await executor.query(
        `SELECT * FROM ${tabelaSecundaria} WHERE numpedido IN (${ph})`,
        numeros
      );
    } catch (e) {
      console.error('[historico/itens]', e.message);
    }
  }

  // ── 4. Parcelas (batch) ───────────────────────────────────────────────────────
  let parcelas = [];
  try {
    [parcelas] = await executor.query(
      `SELECT * FROM receber WHERE numero IN (${ph}) ORDER BY numero, parcela`,
      numeros
    );
  } catch (e) {
    console.error('[historico/parcelas]', e.message);
  }

  // ── 5. Indexar itens por número de pedido ─────────────────────────────────────
  const itensPorPedido = {};
  for (const item of itens) {
    const key = String(item.numpedido);
    if (!itensPorPedido[key]) itensPorPedido[key] = [];
    itensPorPedido[key].push({
      id:             item.id,
      cod_produto:    item.cod_produto,
      desc_prod:      item.desc_prod,
      quantidade:     item.quantidade,
      unidade:        item.unidade,
      valor_unitario: item.valor_unitario,
      kilo_embalagem: item.kilo_embalagem,
      valor_kilo:     item.valor_kilo,
      vlrtotal_itens: item.vlrtotal_itens,
    });
  }

  // ── 6. Indexar parcelas por número de pedido e calcular status visual ─────────
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);

  const parcelasPorPedido = {};
  for (const parc of parcelas) {
    const key = String(parc.numero);
    if (!parcelasPorPedido[key]) parcelasPorPedido[key] = [];

    // Replica a lógica de status do Delphi (MostraParcelas):
    //   'A RECEBER' → 'S' (a receber), 'V' (vencida), 'U' (vence hoje)
    //   qualquer outro → 'R' (recebido)
    let statusVisual = 'R';
    if (parc.status === 'A RECEBER') {
      const venc = new Date(parc.vencimento); venc.setHours(0, 0, 0, 0);
      if (venc < hoje)                          statusVisual = 'V'; // Vencida
      else if (venc.getTime() === hoje.getTime()) statusVisual = 'U'; // Vence hoje
      else                                      statusVisual = 'S'; // A receber
    }

    parcelasPorPedido[key].push({
      id:          parc.id,
      doc:         parc.doc,
      parcela:     parc.parcela,
      qt_parcelas: parc.qt_parcelas,
      vencimento:  parc.vencimento,
      valor:       parc.valor,
      prazo:       parc.prazo,
      status:      parc.status,       // valor original do BD
      status_cor:  statusVisual,      // S/V/U/R para colorização no frontend
    });
  }

  // ── 7. Montar array final ─────────────────────────────────────────────────────
  return pedidos.map((p, idx) => ({
    pedido:   _normalizarPedido(p, idx + 1),
    itens:    itensPorPedido[String(p.numero)]    || [],
    parcelas: parcelasPorPedido[String(p.numero)] || [],
  }));
}

/**
 * Normaliza um registro de pedido para os campos que o frontend precisa.
 * Garante que campos ausentes (schema antigo vs novo) virem null, não undefined.
 */
function _normalizarPedido(p, seq) {
  return {
    sequencial:       seq,
    id:               p.id               ?? null,
    numero:           p.numero           ?? null,
    data_abertura:    p.data_abertura    ?? null,
    tipo_pedido:      p.tipo_pedido      ?? null,
    situacao_pedido:  p.situacao_pedido  ?? null,
    status:           p.status           ?? null,
    nome_vendedor:    p.nome_vendedor    ?? null,
    cod_cliente:      p.cod_cliente      ?? null,
    nome_cliente:     p.nome_cliente     ?? null,
    condicao_pagto:   p.condicao_pagto   ?? null,
    forma_pagto:      p.forma_pagto      ?? null,
    prazo_pagto:      p.prazo_pagto      ?? null,
    qt_parcelas:      p.qt_parcelas      ?? null,
    vlrdesconto:      p.vlrdesconto      ?? 0,
    vlrentrada:       p.vlrentrada       ?? 0,
    vlrfrete:         p.vlrfrete         ?? 0,
    vlrsubtotal:      p.vlrsubtotal      ?? 0,
    vlrtotalitens:    p.vlrtotalitens    ?? 0,
    vlrtotalpedido:   p.vlrtotalpedido   ?? 0,
    total_qt:         p.total_qt         ?? 0,
    total_peso:       p.total_peso       ?? 0,
    obs:              p.obs              ?? null,
    data_entrega:     p.data_entrega     ?? null,
    nome_transportadora: p.nome_transportadora ?? null,
    tipo_frete:       p.tipo_frete       ?? null,
  };
}

/**
 * Busca detalhes de UM pedido (itens + parcelas).
 * Mantido como fallback para chamada direta via /:id/historico/:numpedido.
 */
async function buscarDetalhesPedido(numpedido, pool) {
  const executor = pool || getPool();

  let itens = [];
  try {
    const [rows] = await executor.query(
      `SELECT cod_produto, desc_prod, quantidade, unidade,
              valor_unitario, kilo_embalagem, valor_kilo, vlrtotal_itens
       FROM itensped WHERE numpedido = ? ORDER BY id`,
      [numpedido]
    );
    itens = rows;
  } catch {
    const [rows] = await executor.query(
      `SELECT cod_produto, desc_prod, quantidade, unidade,
              valor_unitario, kilo_embalagem, valor_kilo, vlrtotal_itens
       FROM itenspedgrade WHERE numpedido = ? ORDER BY id`,
      [numpedido]
    ).catch(() => [[]]);
    itens = rows;
  }

  const [parcelas] = await executor.query(
    `SELECT doc, parcela, qt_parcelas, vencimento, valor, prazo, status
     FROM receber WHERE numero = ? ORDER BY parcela`,
    [numpedido]
  ).catch(() => [[]]);

  return { itens, parcelas };
}

module.exports = { buscarHistoricoCompleto, buscarDetalhesPedido };
