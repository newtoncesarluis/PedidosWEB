/**
 * Bot WhatsApp para vendedores — comandos de consulta via Evolution API
 *
 * Endpoint: POST /api/webhook/wa-vendedor
 * Configure na Evolution API: Webhook URL = https://seu-dominio/api/webhook/wa-vendedor
 *                              Eventos     = messages.upsert
 *
 * Identifica o vendedor pelo campo WhatsApp do cadastro de usuário (numero_whatsApp / whatsapp / fonesecundario).
 * Se o número não estiver cadastrado, ignora a mensagem silenciosamente.
 *
 * Comandos disponíveis (case-insensitive):
 *   ajuda                  → lista de comandos
 *   pedidos                → seus pedidos do dia (ou da semana)
 *   meta                   → seu atingimento do mês atual
 *   cliente NOME           → info do cliente por nome
 *   pedidos NOME           → últimos pedidos de um cliente
 *   fin NOME               → títulos em aberto de um cliente
 *   status                 → resumo do dia (pedidos + valor)
 */

const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const { getPool } = require('../config/database');

// ─── helper: busca config Evolution do banco (mesmo padrão de whatsapp.js) ────
async function getWaConfig() {
  // 1) env vars diretas (mais simples para multi-tenant)
  const envUrl    = process.env.ALERTA_WA_URL;
  const envApikey = process.env.ALERTA_WA_APIKEY;
  if (envUrl && envApikey) return { url: envUrl, apikey: envApikey };

  // 2) banco (tabela configuracao, campo w_urlplataforma / w_apiglobal)
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT w_urlplataforma, w_apiglobal FROM configuracao WHERE excluido='N' ORDER BY id DESC LIMIT 1`
    );
    if (rows[0]?.w_urlplataforma && rows[0]?.w_apiglobal) {
      return { url: rows[0].w_urlplataforma, apikey: rows[0].w_apiglobal };
    }
  } catch (_) {}
  return null;
}

const _instancia = () => process.env.ALERTA_WA_INSTANCIA || '';

async function enviarMensagem(numero, texto) {
  const cfg = await getWaConfig();
  if (!cfg || !_instancia()) return;
  const base = cfg.url.replace(/\/$/, '');
  await axios.post(
    `${base}/message/sendText/${_instancia()}`,
    { number: numero, text: texto },
    { headers: { apikey: cfg.apikey }, timeout: 10000 }
  ).catch(e => console.error('[wa-vendedor] enviarMensagem erro:', e.message));
}

// ─── normaliza número para dígitos (sem código de país obrigatório) ───────────
function normFone(f) {
  return String(f || '').replace(/\D/g, '');
}

// ─── busca vendedor pelo número de telefone ───────────────────────────────────
async function buscarVendedor(pool, fromNum) {
  // tenta match exato, depois por sufixo (8 dígitos) para cobrir DDD com/sem 55
  const [rows] = await pool.query(
    `SELECT u.idusuario, u.nomeusu,
            COALESCE(NULLIF(TRIM(u.numero_whatsApp),''), NULLIF(TRIM(u.whatsapp),''), NULLIF(TRIM(u.fonesecundario),'')) AS wa_fone,
            p.p_vender
     FROM usuarios u
     INNER JOIN perfil p ON p.id = u.perfil
     WHERE u.excluido = 'N' AND u.SITUACAO = 'ATIVO'
     AND p.p_vender = 'S'`
  );
  for (const u of rows) {
    const fn = normFone(u.wa_fone);
    if (!fn) continue;
    if (fn === fromNum) return u;
    // sufixo de 8 dígitos (ignora DDD/55)
    if (fn.length >= 8 && fromNum.endsWith(fn.slice(-8))) return u;
    if (fromNum.length >= 8 && fn.endsWith(fromNum.slice(-8))) return u;
  }
  return null;
}

// ─── formatação ──────────────────────────────────────────────────────────────
function fmtMoeda(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtData(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt) ? String(d) : dt.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

// ─── comandos ────────────────────────────────────────────────────────────────

async function cmdAjuda() {
  return `📋 *Comandos disponíveis:*\n\n` +
    `▸ *pedidos* — seus pedidos de hoje\n` +
    `▸ *status* — resumo do seu dia\n` +
    `▸ *meta* — atingimento do mês\n` +
    `▸ *cliente NOME* — buscar cliente\n` +
    `▸ *pedidos NOME* — pedidos de um cliente\n` +
    `▸ *fin NOME* — financeiro de um cliente\n\n` +
    `💡 Dúvidas? Fale com o administrador.`;
}

async function cmdStatus(pool, idUsuario, nomeVendedor) {
  const hoje = new Date().toISOString().slice(0, 10);
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS qtd, COALESCE(SUM(vlrtotalpedido),0) AS total
     FROM pedidos
     WHERE id_usuario=? AND data_abertura=? AND COALESCE(excluido,'N')='N'
     AND situacao_pedido NOT IN ('CANCELADO')`,
    [idUsuario, hoje]
  );
  const r = rows[0] || {};
  return `📊 *Seu dia — ${new Date().toLocaleDateString('pt-BR')}*\n\n` +
    `Pedidos: *${r.qtd || 0}*\n` +
    `Faturado: *${fmtMoeda(r.total)}*\n\n` +
    `_${nomeVendedor}_`;
}

async function cmdPedidos(pool, idUsuario, filtroCliente) {
  const hoje = new Date().toISOString().slice(0, 10);
  let sql, params;

  if (filtroCliente) {
    sql = `SELECT p.numero, p.nome_cliente, p.data_abertura, p.situacao_pedido,
                  COALESCE(p.vlrtotalpedido,0) AS total
           FROM pedidos p
           WHERE p.id_usuario=? AND COALESCE(p.excluido,'N')='N'
           AND p.nome_cliente LIKE ?
           ORDER BY p.data_abertura DESC, p.id DESC LIMIT 5`;
    params = [idUsuario, `%${filtroCliente}%`];
  } else {
    sql = `SELECT p.numero, p.nome_cliente, p.data_abertura, p.situacao_pedido,
                  COALESCE(p.vlrtotalpedido,0) AS total
           FROM pedidos p
           WHERE p.id_usuario=? AND p.data_abertura=? AND COALESCE(p.excluido,'N')='N'
           ORDER BY p.id DESC LIMIT 8`;
    params = [idUsuario, hoje];
  }

  const [rows] = await pool.query(sql, params);
  if (!rows.length) {
    return filtroCliente
      ? `❌ Nenhum pedido encontrado para cliente *${filtroCliente}*.`
      : `ℹ️ Nenhum pedido registrado hoje.`;
  }

  const titulo = filtroCliente
    ? `📦 *Pedidos — ${filtroCliente}*`
    : `📦 *Seus pedidos de hoje*`;

  return titulo + '\n\n' + rows.map(r =>
    `▸ Ped. #${r.numero} — ${r.nome_cliente}\n` +
    `  ${fmtData(r.data_abertura)} · ${r.situacao_pedido} · *${fmtMoeda(r.total)}*`
  ).join('\n\n');
}

async function cmdMeta(pool, idUsuario, nomeVendedor) {
  const now = new Date();
  const mes = now.getMonth() + 1;
  const ano = now.getFullYear();
  const dtIni = `${ano}-${String(mes).padStart(2,'0')}-01`;
  const dtFim = `${ano}-${String(mes).padStart(2,'0')}-${String(new Date(ano, mes, 0).getDate()).padStart(2,'0')}`;

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS comissao_metas (
        id INT AUTO_INCREMENT PRIMARY KEY, id_usuario INT NOT NULL,
        mes INT NOT NULL, ano INT NOT NULL,
        vlr_meta_vendas DECIMAL(15,2) DEFAULT 0,
        vlr_meta_comissao DECIMAL(15,2) DEFAULT 0,
        obs VARCHAR(500) DEFAULT NULL,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_meta (id_usuario, mes, ano)
      )
    `).catch(() => {});

    const [[meta]] = await pool.query(
      `SELECT vlr_meta_vendas FROM comissao_metas WHERE id_usuario=? AND mes=? AND ano=?`,
      [idUsuario, mes, ano]
    );
    const [[realizado]] = await pool.query(
      `SELECT COALESCE(SUM(vlrtotalpedido),0) AS total, COUNT(*) AS qtd
       FROM pedidos
       WHERE id_usuario=? AND data_abertura BETWEEN ? AND ?
       AND COALESCE(excluido,'N')='N' AND situacao_pedido NOT IN ('CANCELADO')`,
      [idUsuario, dtIni, dtFim]
    );

    const metaV = Number(meta?.vlr_meta_vendas || 0);
    const realV = Number(realizado?.total || 0);
    const pct   = metaV > 0 ? ((realV / metaV) * 100).toFixed(1) : null;
    const emoji = !pct ? '—' : Number(pct) >= 100 ? '🏆' : Number(pct) >= 70 ? '📈' : '⚠️';

    const mesesNomes = ['','Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    let msg = `${emoji} *Meta de ${mesesNomes[mes]}/${ano} — ${nomeVendedor}*\n\n`;
    msg += `Realizado: *${fmtMoeda(realV)}* (${realizado.qtd} pedidos)\n`;
    if (metaV > 0) {
      msg += `Meta: *${fmtMoeda(metaV)}*\n`;
      msg += `Atingimento: *${pct}%*`;
      if (Number(pct) >= 100) msg += ' ✅';
    } else {
      msg += `_Meta não definida para este mês._`;
    }
    return msg;
  } catch (e) {
    return `❌ Erro ao consultar meta: ${e.message}`;
  }
}

async function cmdCliente(pool, idUsuario, nomeCliente) {
  if (!nomeCliente) return `❌ Informe o nome do cliente. Ex: *cliente João*`;

  const [rows] = await pool.query(
    `SELECT c.id, c.nome, c.cidade, c.uf, c.foneprincipal, c.status
     FROM clientes c
     WHERE c.cod_vendedor=? AND (c.excluido='N' OR c.excluido IS NULL)
     AND c.nome LIKE ?
     ORDER BY c.nome LIMIT 3`,
    [idUsuario, `%${nomeCliente}%`]
  );
  if (!rows.length) return `❌ Cliente *${nomeCliente}* não encontrado na sua carteira.`;

  return `👤 *Clientes encontrados*\n\n` + rows.map(c =>
    `▸ *${c.nome}*\n  ${[c.cidade, c.uf].filter(Boolean).join(' / ')} · ${c.foneprincipal || 'sem fone'}\n  Status: ${c.status || 'Ativo'}`
  ).join('\n\n');
}

async function cmdFinanceiro(pool, idUsuario, nomeCliente) {
  if (!nomeCliente) return `❌ Informe o nome do cliente. Ex: *fin João*`;

  const [clientes] = await pool.query(
    `SELECT c.id, c.nome FROM clientes c
     WHERE c.cod_vendedor=? AND (c.excluido='N' OR c.excluido IS NULL) AND c.nome LIKE ?
     ORDER BY c.nome LIMIT 1`,
    [idUsuario, `%${nomeCliente}%`]
  );
  if (!clientes.length) return `❌ Cliente *${nomeCliente}* não encontrado na sua carteira.`;

  const cli = clientes[0];
  const [rows] = await pool.query(
    `SELECT doc, valor, vencimento, status
     FROM receber
     WHERE id_cliente=? AND (excluido='N' OR excluido IS NULL)
     AND status IN ('ABERTA','ABERTO')
     ORDER BY vencimento ASC LIMIT 8`,
    [cli.id]
  );

  if (!rows.length) return `✅ *${cli.nome}* não tem títulos em aberto.`;

  const total = rows.reduce((s, r) => s + Number(r.valor || 0), 0);
  const hoje = new Date().toISOString().slice(0, 10);
  const vencidos = rows.filter(r => r.vencimento && String(r.vencimento).slice(0, 10) < hoje);

  let msg = `💰 *Financeiro — ${cli.nome}*\n\n`;
  if (vencidos.length) msg += `⚠️ ${vencidos.length} título(s) vencido(s)\n`;
  msg += `Total aberto: *${fmtMoeda(total)}*\n\n`;
  msg += rows.map(r => {
    const dt = String(r.vencimento || '').slice(0, 10);
    const atrasado = dt < hoje ? ' ⚠️' : '';
    return `▸ ${r.doc || '—'} · ${fmtData(dt)} · *${fmtMoeda(r.valor)}*${atrasado}`;
  }).join('\n');
  return msg;
}

// ─── handler principal ────────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  res.sendStatus(200); // responde imediatamente

  try {
    const body = req.body;
    if (body.event !== 'messages.upsert') return;
    const data = body.data;
    if (!data || data.key?.fromMe) return;

    const remoteJid = data.key?.remoteJid || '';
    if (remoteJid.includes('@g.us')) return; // ignora grupos

    const fromNum = remoteJid.replace('@s.whatsapp.net', '').replace(/\D/g, '');
    const text = (
      data.message?.conversation ||
      data.message?.extendedTextMessage?.text || ''
    ).trim();

    if (!text) return;

    const pool = getPool();
    const vendedor = await buscarVendedor(pool, fromNum);
    if (!vendedor) return; // número não cadastrado — silencioso

    const cmd   = text.toLowerCase();
    const partes = cmd.split(/\s+/);
    const acao  = partes[0];
    const resto = partes.slice(1).join(' ').trim();

    let resposta = '';

    if (acao === 'ajuda' || acao === 'help' || acao === 'oi' || acao === 'olá' || acao === 'ola') {
      resposta = await cmdAjuda();
    } else if (acao === 'status') {
      resposta = await cmdStatus(pool, vendedor.idusuario, vendedor.nomeusu);
    } else if (acao === 'pedidos' || acao === 'pedido') {
      resposta = await cmdPedidos(pool, vendedor.idusuario, resto || null);
    } else if (acao === 'meta' || acao === 'metas') {
      resposta = await cmdMeta(pool, vendedor.idusuario, vendedor.nomeusu);
    } else if (acao === 'cliente' || acao === 'cli') {
      resposta = await cmdCliente(pool, vendedor.idusuario, resto);
    } else if (acao === 'fin' || acao === 'financeiro' || acao === 'titulos' || acao === 'títulos') {
      resposta = await cmdFinanceiro(pool, vendedor.idusuario, resto);
    } else {
      // mensagem não reconhecida — não responde para não poluir
      return;
    }

    if (resposta) {
      await enviarMensagem(fromNum, resposta);
    }
  } catch (e) {
    console.error('[wa-vendedor] erro:', e.message);
  }
});

module.exports = router;
