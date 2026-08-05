'use strict';

/**
 * Carteira de Recompra — nível CLIENTE × FÁBRICA (proativo).
 *
 * Como o pedido de representação é POR FORNECEDOR, cada linha da carteira é a dupla
 * cliente + fábrica: o mesmo cliente pode estar 🟢 em dia numa fábrica e 🔴 atrasado
 * noutra (ciclos diferentes). Diferente do dashboard de BI (comercial-clientes-ia.html,
 * corte fixo de 90 dias), o semáforo é o CICLO PRÓPRIO daquela dupla:
 *   ciclo_medio = média de dias entre pedidos da dupla (span / (n-1)); fallback 30 dias
 *   razao       = dias_desde_ultima / ciclo_medio
 *     🟢 Em dia   razao < 0.8
 *     🟡 Na janela 0.8 ≤ razao ≤ 1.2
 *     🔴 Atrasado razao > 1.2
 *
 * Reusa o mesmo conceito de "venda real" do config/reposicao-produtos.js
 * (tipo_pedido='PEDIDO' e situacao NOT IN CANCELADO/RECUSADO) para o semáforo bater
 * com o que a aba Reposição sugere no pedido — que também filtra por fornecedor quando
 * sistemas.itenspedidofornecedor='S'. Escopo por vendedor/gerente/preposto via
 * buildPedidosVendedorWhereSync(req, idVendedor, 'c.cod_vendedor'). Só leitura.
 *
 * Armadilhas respeitadas (CLAUDE.md):
 *  - pedidos referencia o cliente por cod_cliente (NÃO id_cliente); fábrica = cod_fornecedor
 *  - total do pedido = pedidos.vlrtotalpedido
 *  - clientes: nome / apelido / cidade / uf / cod_vendedor / regiao / excluido
 *  - fornecedores: coluna de nome = nome; cod_fornecedor pode ser varchar → CAST UNSIGNED
 */

const { buildPedidosVendedorWhereSync } = require('./vendedor-visibilidade');

const CICLO_FALLBACK = 30; // sem histórico suficiente p/ medir intervalo
const CICLO_MIN = 7;       // piso p/ não explodir a razão em clientes de compra diária
const JANELA_MESES = 24;   // horizonte de histórico considerado

/** Ciclo médio de compra do cliente (dias entre pedidos). */
function calcCicloMedio(totalPedidos, spanDias) {
  const n = parseInt(totalPedidos, 10) || 0;
  const span = parseInt(spanDias, 10) || 0;
  if (n >= 2 && span > 0) {
    return Math.max(CICLO_MIN, Math.round(span / (n - 1)));
  }
  return CICLO_FALLBACK;
}

/** Semáforo pela razão dias_desde_ultima / ciclo_medio. */
function calcSemaforoRecompra(diasDesdeUltima, cicloMedio) {
  const dias = parseInt(diasDesdeUltima, 10) || 0;
  const ciclo = Math.max(CICLO_MIN, parseInt(cicloMedio, 10) || CICLO_FALLBACK);
  const razao = dias / ciclo;
  if (razao > 1.2) return { codigo: 'vermelho', emoji: '🔴', label: 'Atrasado', razao };
  if (razao >= 0.8) return { codigo: 'amarelo', emoji: '🟡', label: 'Na janela', razao };
  return { codigo: 'verde', emoji: '🟢', label: 'Em dia', razao };
}

/** Soma dias a uma data ISO (YYYY-MM-DD) em UTC puro — sem deslocamento de fuso. */
function addDaysIso(iso, days) {
  const s = String(iso || '').slice(0, 10);
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + (parseInt(days, 10) || 0));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

const round2 = (v) => Math.round((parseFloat(v) || 0) * 100) / 100;
const SEMAFOROS = ['vermelho', 'amarelo', 'verde'];

/**
 * Lista a carteira de recompra do usuário logado (respeita a visibilidade dele).
 * @param {import('mysql2/promise').Pool} pool
 * @param {object} req  — request (req.user, req.query)
 * @param {object} opts — { idVendedor, cidade, uf, regiao, q, semaforo, limit }
 * @returns {Promise<{ data: object[], resumo: object }>}
 */
async function listarCarteiraRecompra(pool, req, opts = {}) {
  const filtros = [];
  const params = [];

  // Filtros de cliente
  if (opts.cidade) {
    filtros.push(`LOWER(COALESCE(c.cidade, '')) LIKE ?`);
    params.push(`%${String(opts.cidade).toLowerCase()}%`);
  }
  if (opts.uf) {
    filtros.push(`UPPER(COALESCE(c.uf, '')) = ?`);
    params.push(String(opts.uf).toUpperCase());
  }
  const regiao = parseInt(opts.regiao, 10);
  if (regiao) {
    filtros.push(`c.regiao = ?`);
    params.push(regiao);
  }
  const q = String(opts.q || '').trim();
  if (q) {
    filtros.push(`(c.nome LIKE ? OR c.apelido LIKE ?)`);
    params.push(`%${q}%`, `%${q}%`);
  }
  const idFornecedor = parseInt(opts.fornecedor, 10);
  if (idFornecedor) {
    filtros.push(`CAST(agg.cod_fornecedor AS UNSIGNED) = ?`);
    params.push(idFornecedor);
  }

  // Escopo por vendedor/gerente/preposto (mesmo primitivo do analytics)
  const vendScope = buildPedidosVendedorWhereSync(req, opts.idVendedor, 'c.cod_vendedor');
  const scopeClause = vendScope.clause || '';
  const scopeParams = vendScope.params || [];

  const filtrosSql = filtros.length ? ` AND ${filtros.join(' AND ')}` : '';

  const limit = Math.min(Math.max(parseInt(opts.limit, 10) || 400, 1), 2000);

  const [rows] = await pool.query(
    `SELECT
        c.id            AS cod_cliente,
        c.nome          AS nome,
        c.apelido       AS apelido,
        c.cidade        AS cidade,
        c.uf            AS uf,
        c.cod_vendedor  AS cod_vendedor,
        c.regiao        AS regiao,
        agg.cod_fornecedor  AS cod_fornecedor,
        f.nome              AS nome_fornecedor,
        agg.total_pedidos,
        agg.ultima_compra,
        agg.primeira_compra,
        DATEDIFF(CURDATE(), agg.ultima_compra)             AS dias_desde_ultima,
        DATEDIFF(agg.ultima_compra, agg.primeira_compra)   AS span_dias,
        agg.valor_total,
        agg.ticket_medio
     FROM clientes c
     JOIN (
        SELECT p.cod_cliente,
               p.cod_fornecedor,
               COUNT(DISTINCT p.numero)               AS total_pedidos,
               MAX(p.data_abertura)                   AS ultima_compra,
               MIN(p.data_abertura)                   AS primeira_compra,
               COALESCE(SUM(p.vlrtotalpedido), 0)     AS valor_total,
               COALESCE(AVG(p.vlrtotalpedido), 0)     AS ticket_medio
        FROM pedidos p
        WHERE COALESCE(p.excluido, 'N') = 'N'
          AND p.tipo_pedido = 'PEDIDO'
          AND p.situacao_pedido NOT IN ('CANCELADO', 'RECUSADO')
          AND p.data_abertura >= DATE_SUB(CURDATE(), INTERVAL ${JANELA_MESES} MONTH)
          AND p.cod_fornecedor IS NOT NULL
          AND CAST(p.cod_fornecedor AS UNSIGNED) > 0
        GROUP BY p.cod_cliente, p.cod_fornecedor
     ) agg ON agg.cod_cliente = c.id
     LEFT JOIN fornecedores f ON f.id = CAST(agg.cod_fornecedor AS UNSIGNED)
     WHERE (c.excluido = 'N' OR c.excluido IS NULL OR c.excluido = '')
       ${filtrosSql}
       ${scopeClause}
     ORDER BY dias_desde_ultima DESC
     LIMIT ${limit}`,
    [...params, ...scopeParams]
  );

  const resumo = {
    total_clientes: 0,
    valor_potencial_total: 0,
    valor_potencial_acionavel: 0, // 🔴 + 🟡
    vermelho: { qtd: 0, valor_potencial: 0 },
    amarelo: { qtd: 0, valor_potencial: 0 },
    verde: { qtd: 0, valor_potencial: 0 },
  };

  let data = rows.map((r) => {
    const cicloMedio = calcCicloMedio(r.total_pedidos, r.span_dias);
    const diasDesdeUltima = parseInt(r.dias_desde_ultima, 10) || 0;
    const sem = calcSemaforoRecompra(diasDesdeUltima, cicloMedio);
    const ultimaIso = r.ultima_compra ? String(r.ultima_compra).slice(0, 10) : null;
    const ticketMedio = round2(r.ticket_medio);

    resumo.total_clientes += 1;
    resumo.valor_potencial_total += ticketMedio;
    resumo[sem.codigo].qtd += 1;
    resumo[sem.codigo].valor_potencial += ticketMedio;
    if (sem.codigo === 'vermelho' || sem.codigo === 'amarelo') {
      resumo.valor_potencial_acionavel += ticketMedio;
    }

    return {
      cod_cliente: r.cod_cliente,
      nome: r.nome,
      apelido: r.apelido,
      cidade: r.cidade,
      uf: r.uf,
      cod_vendedor: r.cod_vendedor,
      regiao: r.regiao,
      cod_fornecedor: r.cod_fornecedor,
      nome_fornecedor: r.nome_fornecedor || ('Fábrica ' + r.cod_fornecedor),
      total_pedidos: parseInt(r.total_pedidos, 10) || 0,
      ultima_compra: ultimaIso,
      dias_desde_ultima: diasDesdeUltima,
      ciclo_medio: cicloMedio,
      previsao_proxima: addDaysIso(ultimaIso, cicloMedio),
      dias_atraso: diasDesdeUltima - cicloMedio, // >0 = atrasado
      valor_total: round2(r.valor_total),
      ticket_medio: ticketMedio,
      valor_potencial: ticketMedio,
      semaforo: sem.codigo,
      semaforo_emoji: sem.emoji,
      semaforo_label: sem.label,
      razao: round2(sem.razao),
    };
  });

  // Arredondar acumuladores do resumo
  resumo.valor_potencial_total = round2(resumo.valor_potencial_total);
  resumo.valor_potencial_acionavel = round2(resumo.valor_potencial_acionavel);
  for (const s of SEMAFOROS) resumo[s].valor_potencial = round2(resumo[s].valor_potencial);

  // Filtro opcional por semáforo (aplicado após o resumo, que reflete a carteira toda)
  const semFiltro = String(opts.semaforo || '').toLowerCase();
  if (SEMAFOROS.includes(semFiltro)) {
    data = data.filter((d) => d.semaforo === semFiltro);
  }

  // Mais "atrasado" primeiro (maior razão no topo)
  data.sort((a, b) => b.razao - a.razao);

  return { data, resumo };
}

module.exports = {
  listarCarteiraRecompra,
  calcCicloMedio,
  calcSemaforoRecompra,
  addDaysIso,
};
