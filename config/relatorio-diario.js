/**
 * Relatório diário automático via WhatsApp para o administrador.
 *
 * Dispara automaticamente no horário configurado (padrão: 18h).
 * Env vars:
 *   RELATORIO_DIARIO_HORA  — hora de disparo (0–23, padrão: 18)
 *   RELATORIO_DIARIO_TZ    — fuso horário (padrão: America/Sao_Paulo)
 *   ALERTA_WHATSAPP        — número destino (já usado pelo sistema de alertas)
 *
 * Não é disparado se ALERTA_WHATSAPP não estiver configurado.
 */

const { getPool, customerDbFromLicense, getPoolForLicense, _poolMapKeys } = require('./database');
const { sendMessage } = require('./alert');

// Retorna lista de pools ativos: em modo multi-tenant, um por licença; senão, o pool padrão.
function _todosOsPools() {
  try {
    if (customerDbFromLicense && customerDbFromLicense()) {
      const pools = [];
      for (const chave of (_poolMapKeys ? _poolMapKeys() : [])) {
        const p = getPoolForLicense(chave);
        if (p) pools.push({ pool: p, chave });
      }
      return pools.length ? pools : [{ pool: getPool(), chave: null }];
    }
  } catch (_) {}
  return [{ pool: getPool(), chave: null }];
}

const TZ   = process.env.RELATORIO_DIARIO_TZ   || 'America/Sao_Paulo';
const HORA = parseInt(process.env.RELATORIO_DIARIO_HORA || '18', 10);

function _horaAtualTz() {
  return parseInt(
    new Date().toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }),
    10
  );
}

function _dataBrasil() {
  return new Date().toLocaleDateString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
}

function _msAteProxima(hora) {
  const now = new Date();
  const tz = new Date(now.toLocaleString('en-US', { timeZone: TZ }));
  const alvo = new Date(tz);
  alvo.setHours(hora, 0, 0, 0);
  if (alvo <= tz) alvo.setDate(alvo.getDate() + 1);
  return alvo - tz;
}

function fmtMoeda(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ─── Consulta dados do dia para um pool específico ───────────────────────────
async function _gerarRelatorioPool(pool, hoje) {
  try {
    // KPIs gerais do dia
    const [[kpi]] = await pool.query(`
      SELECT
        COUNT(*)                                    AS total_pedidos,
        COALESCE(SUM(vlrtotalpedido), 0)            AS faturamento,
        COUNT(CASE WHEN situacao_pedido IN ('PENDENTE','ABERTO','A APROVAR') THEN 1 END) AS pendentes,
        COUNT(CASE WHEN situacao_pedido = 'CANCELADO' THEN 1 END) AS cancelados,
        COUNT(DISTINCT cod_cliente)                  AS clientes_atendidos
      FROM pedidos
      WHERE COALESCE(excluido,'N') = 'N'
        AND data_abertura = ?
    `, [hoje]);

    // Top vendedor do dia
    const [topVend] = await pool.query(`
      SELECT nome_vendedor,
             COUNT(*) AS pedidos,
             COALESCE(SUM(vlrtotalpedido),0) AS total
      FROM pedidos
      WHERE COALESCE(excluido,'N') = 'N'
        AND data_abertura = ?
        AND situacao_pedido NOT IN ('CANCELADO')
      GROUP BY nome_vendedor
      ORDER BY total DESC
      LIMIT 1
    `, [hoje]);

    // Top cliente do dia
    const [topCli] = await pool.query(`
      SELECT nome_cliente,
             COUNT(*) AS pedidos,
             COALESCE(SUM(vlrtotalpedido),0) AS total
      FROM pedidos
      WHERE COALESCE(excluido,'N') = 'N'
        AND data_abertura = ?
        AND situacao_pedido NOT IN ('CANCELADO')
      GROUP BY nome_cliente
      ORDER BY total DESC
      LIMIT 1
    `, [hoje]);

    // Pedidos da vitrine
    const [[vitrine]] = await pool.query(`
      SELECT COUNT(*) AS total, COALESCE(SUM(vlrtotalpedido),0) AS valor
      FROM pedidos
      WHERE COALESCE(excluido,'N') = 'N'
        AND data_abertura = ?
        AND origem = 'VITRINE'
    `, [hoje]);

    const total = Number(kpi?.total_pedidos || 0);
    if (total === 0) {
      // Sem pedidos — não envia para não poluir
      console.log('[relatorio-diario] Nenhum pedido hoje — relatório não enviado.');
      return;
    }

    const tv = topVend[0];
    const tc = topCli[0];

    let msg = `📊 *Relatório do Dia — ${_dataBrasil()}*\n\n`;
    msg += `📦 Pedidos: *${total}*\n`;
    msg += `💰 Faturado: *${fmtMoeda(kpi?.faturamento)}*\n`;
    msg += `👥 Clientes atendidos: *${kpi?.clientes_atendidos || 0}*\n`;

    if (kpi?.pendentes > 0) {
      msg += `⏳ Aguardando aprovação: *${kpi.pendentes}*\n`;
    }
    if (kpi?.cancelados > 0) {
      msg += `❌ Cancelados: *${kpi.cancelados}*\n`;
    }

    if (tv) {
      msg += `\n🏆 Top vendedor: *${tv.nome_vendedor}*\n`;
      msg += `   ${tv.pedidos} pedido(s) · ${fmtMoeda(tv.total)}\n`;
    }
    if (tc) {
      msg += `\n🏅 Top cliente: *${tc.nome_cliente}*\n`;
      msg += `   ${tc.pedidos} pedido(s) · ${fmtMoeda(tc.total)}\n`;
    }

    if (Number(vitrine?.total || 0) > 0) {
      msg += `\n🛍️ Vitrine Digital: *${vitrine.total}* pedido(s) — ${fmtMoeda(vitrine.valor)}\n`;
    }

    return msg;
  } catch (err) {
    console.error('[relatorio-diario] Erro pool:', err.message);
    return null;
  }
}

// ─── Orquestrador: itera todos os pools (multi-tenant) ───────────────────────
async function gerarRelatorio() {
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  const pools = _todosOsPools();

  for (const { pool, chave } of pools) {
    try {
      const msg = await _gerarRelatorioPool(pool, hoje);
      if (!msg) continue;

      // Em multi-tenant, busca o número de destino no banco do tenant
      let destino = process.env.ALERTA_WHATSAPP || '';
      if (chave) {
        try {
          const [[cfg]] = await pool.query(
            `SELECT alerta_whatsapp FROM sistemas ORDER BY id DESC LIMIT 1`
          ).catch(() => [[null]]);
          if (cfg?.alerta_whatsapp) destino = cfg.alerta_whatsapp;
        } catch (_) {}
      }

      if (!destino) continue;

      // Em multi-tenant, usa o número do tenant mas a infra de envio global
      await sendMessage(msg, `Relatório diário — ${_dataBrasil()}`);
      console.log('[relatorio-diario] Enviado' + (chave ? ` (${chave})` : '') + ' —', _dataBrasil());
    } catch (err) {
      console.error('[relatorio-diario] Erro tenant', chave, ':', err.message);
    }
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────
const _disparos = new Set();

function startRelatorioDiarioScheduler() {
  if (!process.env.ALERTA_WHATSAPP) {
    console.log('[relatorio-diario] ALERTA_WHATSAPP não configurado — relatório diário desativado.');
    return;
  }

  console.log(`[relatorio-diario] Agendado para ${HORA}h (${TZ}).`);

  const agendarHoje = () => {
    const ms = _msAteProxima(HORA);
    setTimeout(() => {
      const chave = `${new Date().toLocaleDateString('en-CA', { timeZone: TZ })}-${HORA}`;
      if (!_disparos.has(chave)) {
        _disparos.add(chave);
        gerarRelatorio().catch(e => console.warn('[relatorio-diario]', e.message));
      }
      agendarHoje(); // reagenda para o próximo dia
    }, ms);
  };

  agendarHoje();
}

module.exports = { startRelatorioDiarioScheduler, gerarRelatorio };
