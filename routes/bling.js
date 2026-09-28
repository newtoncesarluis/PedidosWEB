'use strict';
/**
 * /api/bling — Integração com o ERP Bling (somente administrador).
 * Regras e mapeamento de campos em config/bling.js. Tela: /pages/integracao-bling.html
 */
const express = require('express');
const router = express.Router();
const { getPool, getBoundChave } = require('../config/database');
const { isAdminUser } = require('../config/cadastros-permissoes');
const bling = require('../config/bling');

bling.iniciarAgendador(() => (getBoundChave() ? getPool() : null));

const usuarioDe = (req) => req.user?.loginusu || req.user?.nome || (req.user?.idusuario ? `id ${req.user.idusuario}` : null);
const chaveTenant = (req) => getBoundChave() || req.user?.chave_licenca || 'local';

function responderErro(res, e) {
  const st = e.status >= 400 && e.status < 600 ? e.status : 500;
  // 401 do Bling não pode virar "sessão expirada" do SysRepWeb (o front faria logout)
  res.status(st === 401 ? 409 : st).json({ ok: false, error: e.message });
}

// ── Callback do OAuth (aberto numa janela à parte; o cookie da sessão identifica o tenant)
router.get('/callback', async (req, res) => {
  const pagina = (ok, msg) => res.type('html').send(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Integração Bling</title>
<link rel="stylesheet" href="/assets/themes.css"><script src="/assets/themes.js"></script>
<style>body{font-family:Inter,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px}
.c{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:28px;max-width:440px;text-align:center}
h1{font-size:18px;margin:0 0 8px;color:${ok ? 'var(--success,#16a34a)' : 'var(--danger,#ef4444)'}}p{color:var(--text2);font-size:14px;line-height:1.5;margin:0}</style></head>
<body><div class="c"><h1>${ok ? 'Bling conectado' : 'Não foi possível conectar'}</h1><p>${String(msg).replace(/[<>&]/g, '')}</p>
<p style="margin-top:14px">Pode fechar esta janela.</p></div>
<script>try{window.opener&&window.opener.postMessage({bling:${ok ? "'ok'" : "'erro'"}},location.origin);if(window.opener)setTimeout(function(){window.close()},1800)}catch(e){}</script></body></html>`);
  if (!isAdminUser(req)) return pagina(false, 'Somente o administrador pode conectar o Bling.');
  if (req.query.error) return pagina(false, `O Bling recusou a autorização (${req.query.error_description || req.query.error}).`);
  try {
    const cfg = await bling.concluirAutorizacao(getPool(), req.query.code, req.query.state);
    await bling.log(getPool(), { acao: 'conectar', mensagem: `Conectado${cfg.conta_nome ? ' à conta ' + cfg.conta_nome : ''}`, usuario: usuarioDe(req) });
    pagina(true, cfg.conta_nome ? `Conta: ${cfg.conta_nome}` : 'A conta foi autorizada.');
  } catch (e) {
    await bling.log(getPool(), { acao: 'conectar', ok: false, mensagem: e.message, usuario: usuarioDe(req) });
    pagina(false, e.message);
  }
});

router.use((req, res, next) => {
  if (!isAdminUser(req)) return res.status(403).json({ ok: false, error: 'Somente o administrador acessa a integração com o Bling.' });
  bling.registrarPool(getPool());
  next();
});

// ── Configuração
router.get('/config', async (req, res) => {
  try { res.json({ ok: true, config: bling.configPublica(await bling.getConfig(getPool())) }); }
  catch (e) { responderErro(res, e); }
});

router.put('/config', async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body || {};
    const atual = await bling.getConfig(pool);
    const sn = (v) => (v === true || v === 'S' ? 'S' : 'N');
    const idNum = (v) => { const n = parseInt(String(v ?? '').replace(/\D/g, ''), 10); return Number.isFinite(n) && n > 0 ? n : null; };
    const campos = {};

    if (b.client_id !== undefined) {
      const cid = String(b.client_id || '').trim();
      campos.client_id = cid || null;
      if (cid !== (atual.client_id || '')) {
        // outro aplicativo: os tokens antigos não valem mais
        Object.assign(campos, { access_token: null, refresh_token: null, token_expira_em: null, conta_nome: null, conta_cnpj: null, conectado_em: null, envio_auto: 'N' });
      }
    }
    if (b.client_secret) campos.client_secret = String(b.client_secret).trim();
    for (const k of ['gerar_nfe_auto', 'enviar_nfe_sefaz', 'atualizar_precos', 'importar_estoque']) {
      if (b[k] !== undefined) campos[k] = sn(b[k]);
    }
    if (b.envio_auto !== undefined) {
      campos.envio_auto = sn(b.envio_auto);
      if (campos.envio_auto === 'S' && !atual.refresh_token && !campos.refresh_token) {
        return res.status(400).json({ ok: false, error: 'Conecte o Bling antes de ligar o envio automático.' });
      }
    }
    if (b.envio_auto_desde !== undefined) campos.envio_auto_desde = /^\d{4}-\d{2}-\d{2}$/.test(String(b.envio_auto_desde)) ? b.envio_auto_desde : null;
    if (campos.envio_auto === 'S' && !campos.envio_auto_desde && !atual.envio_auto_desde) {
      campos.envio_auto_desde = new Date().toISOString().slice(0, 10);
    }
    if (b.id_loja !== undefined) campos.id_loja = idNum(b.id_loja);
    if (b.id_forma_pagamento !== undefined) campos.id_forma_pagamento = idNum(b.id_forma_pagamento);
    if (b.fornecedor_padrao !== undefined) campos.fornecedor_padrao = String(b.fornecedor_padrao || '').replace(/\D/g, '') || null;

    await bling.salvarConfig(pool, campos);
    await bling.log(pool, { acao: 'config', mensagem: 'Configuração salva: ' + Object.keys(campos).filter((k) => !/secret|token/.test(k)).join(', '), usuario: usuarioDe(req) });
    res.json({ ok: true, config: bling.configPublica(await bling.getConfig(pool)) });
  } catch (e) { responderErro(res, e); }
});

// ── Conexão
router.post('/autorizar', async (req, res) => {
  try { res.json({ ok: true, url: await bling.gerarUrlAutorizacao(getPool()) }); }
  catch (e) { responderErro(res, e); }
});

router.post('/testar', async (req, res) => {
  try {
    const pool = getPool();
    const r = await bling.request(pool, 'GET', '/empresas/me/dados-basicos');
    const d = r?.data || {};
    await bling.salvarConfig(pool, { conta_nome: d.nome || null, conta_cnpj: d.cnpj || null, ultimo_erro: null });
    res.json({ ok: true, conta: { nome: d.nome || null, cnpj: d.cnpj || null, email: d.email || null } });
  } catch (e) { responderErro(res, e); }
});

router.post('/desconectar', async (req, res) => {
  try {
    await bling.desconectar(getPool());
    await bling.log(getPool(), { acao: 'desconectar', mensagem: 'Conexão removida', usuario: usuarioDe(req) });
    res.json({ ok: true });
  } catch (e) { responderErro(res, e); }
});

router.get('/formas-pagamento', async (req, res) => {
  try {
    const r = await bling.request(getPool(), 'GET', '/formas-pagamentos', { params: { limite: 100 } });
    res.json({ ok: true, formas: (r?.data || []).filter((f) => f.situacao !== 0).map((f) => ({ id: f.id, descricao: f.descricao })) });
  } catch (e) { responderErro(res, e); }
});

// ── Importações Bling → SysRepWeb
router.post('/importar/:tipo', async (req, res) => {
  try {
    const pool = getPool();
    const tipo = req.params.tipo;
    const fn = tipo === 'produtos' ? bling.importarProdutos : tipo === 'clientes' ? bling.importarClientes : null;
    if (!fn) return res.status(400).json({ ok: false, error: 'Tipo de importação inválido' });
    await bling.getConfig(pool); // garante as tabelas antes de rodar em segundo plano
    const usuario = usuarioDe(req);
    const st = bling.iniciarJob(chaveTenant(req), tipo, (s) => fn(pool, s, usuario));
    res.json({ ok: true, job: st });
  } catch (e) { responderErro(res, e); }
});

router.get('/importacao', (req, res) => {
  res.json({ ok: true, job: bling.jobStatus(chaveTenant(req)) });
});

// ── Pedidos
router.get('/pedidos', async (req, res) => {
  try {
    const pool = getPool();
    await bling.getConfig(pool);
    const dias = Math.min(Math.max(parseInt(req.query.dias, 10) || 30, 1), 365);
    const filtro = String(req.query.filtro || 'todos');
    const q = String(req.query.q || '').trim();
    const where = [
      "COALESCE(p.excluido,'N')='N'",
      "UPPER(COALESCE(p.tipo_pedido,'PEDIDO')) NOT LIKE '%ORC%'",
      'p.data_abertura >= CURDATE() - INTERVAL ? DAY',
    ];
    const args = [dias];
    if (filtro === 'pendentes') where.push('v.id_bling IS NULL');
    if (filtro === 'enviados') where.push('v.id_bling IS NOT NULL');
    if (filtro === 'erros') where.push("v.id_bling IS NULL AND EXISTS (SELECT 1 FROM bling_log l2 WHERE l2.tipo='pedido' AND CAST(l2.id_local AS UNSIGNED)=p.id AND l2.ok='N')");
    if (q) { where.push('(p.numero LIKE ? OR p.nome_cliente LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }

    const [rows] = await pool.query(
      `SELECT p.id, p.numero, p.data_abertura, p.nome_cliente, p.nome_vendedor, p.vlrtotalpedido, p.status,
              v.id_bling, v.situacao, v.id_nfe, v.numero_nfe, v.situacao_nfe, v.sincronizado_em,
              (SELECT l.mensagem FROM bling_log l
                WHERE l.tipo='pedido' AND CAST(l.id_local AS UNSIGNED)=p.id AND l.ok='N'
                  AND (v.sincronizado_em IS NULL OR l.criado_em > v.sincronizado_em)
                ORDER BY l.id DESC LIMIT 1) AS ultimo_erro
         FROM pedidos p
         LEFT JOIN bling_vinculo v ON v.tipo='pedido' AND CAST(v.id_local AS UNSIGNED)=p.id
        WHERE ${where.join(' AND ')}
        ORDER BY p.id DESC LIMIT 300`, args);

    const [[tot]] = await pool.query(
      `SELECT COUNT(*) total, SUM(v.id_bling IS NOT NULL) enviados, SUM(v.id_nfe IS NOT NULL) com_nfe
         FROM pedidos p LEFT JOIN bling_vinculo v ON v.tipo='pedido' AND CAST(v.id_local AS UNSIGNED)=p.id
        WHERE COALESCE(p.excluido,'N')='N' AND UPPER(COALESCE(p.tipo_pedido,'PEDIDO')) NOT LIKE '%ORC%'
          AND p.data_abertura >= CURDATE() - INTERVAL ? DAY`, [dias]);
    res.json({ ok: true, pedidos: rows, totais: { total: Number(tot.total) || 0, enviados: Number(tot.enviados) || 0, com_nfe: Number(tot.com_nfe) || 0 } });
  } catch (e) { responderErro(res, e); }
});

router.post('/pedidos/enviar-lote', async (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map((x) => parseInt(x, 10)).filter((x) => x > 0).slice(0, 50);
  if (!ids.length) return res.status(400).json({ ok: false, error: 'Nenhum pedido selecionado' });
  const pool = getPool();
  const resultados = [];
  for (const id of ids) {
    try { const r = await bling.enviarPedido(pool, id, { usuario: usuarioDe(req) }); resultados.push({ id, ok: true, id_bling: r.id, jaEnviado: r.jaEnviado }); }
    catch (e) {
      resultados.push({ id, ok: false, error: e.message });
      if (e.status === 401) break; // sem conexão: não adianta seguir
    }
  }
  res.json({ ok: true, resultados, enviados: resultados.filter((r) => r.ok).length, falhas: resultados.filter((r) => !r.ok).length });
});

router.post('/pedidos/:id/enviar', async (req, res) => {
  try { res.json({ ok: true, ...(await bling.enviarPedido(getPool(), parseInt(req.params.id, 10), { usuario: usuarioDe(req) })) }); }
  catch (e) { responderErro(res, e); }
});

router.post('/pedidos/:id/nfe', async (req, res) => {
  try { res.json({ ok: true, ...(await bling.gerarNfe(getPool(), parseInt(req.params.id, 10), { usuario: usuarioDe(req) })) }); }
  catch (e) { responderErro(res, e); }
});

router.post('/pedidos/:id/situacao', async (req, res) => {
  try { res.json({ ok: true, situacao: await bling.atualizarSituacao(getPool(), parseInt(req.params.id, 10)) }); }
  catch (e) { responderErro(res, e); }
});

// Pré-visualização do que seria enviado (sem enviar nada)
router.get('/pedidos/:id/previa', async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const [[ped]] = await pool.query(`SELECT * FROM pedidos WHERE id=? AND COALESCE(excluido,'N')='N'`, [id]);
    if (!ped) return res.status(404).json({ ok: false, error: 'Pedido não encontrado' });
    const [itens] = await pool.query(`SELECT * FROM itensped WHERE numpedido=? AND COALESCE(excluido,'N')='N' ORDER BY CAST(sequencia AS UNSIGNED), id`, [ped.numero]);
    const [[cli]] = await pool.query('SELECT * FROM clientes WHERE id=?', [ped.cod_cliente]);
    const cfg = await bling.getConfig(pool);
    const vinCli = cli ? await bling.getVinculo(pool, 'cliente', cli.id) : null;
    const pedido = await bling.montarPedidoVenda(pool, ped, itens, vinCli?.id_bling || '(será criado/vinculado)', cfg);
    res.json({ ok: true, contato: cli ? bling.clienteParaContato(cli) : null, pedido });
  } catch (e) { responderErro(res, e); }
});

// ── Clientes
router.post('/clientes/:id/enviar', async (req, res) => {
  try { res.json({ ok: true, ...(await bling.enviarCliente(getPool(), parseInt(req.params.id, 10), usuarioDe(req))) }); }
  catch (e) { responderErro(res, e); }
});

// ── Histórico
router.get('/log', async (req, res) => {
  try {
    const pool = getPool();
    await bling.getConfig(pool);
    const lim = Math.min(parseInt(req.query.limite, 10) || 60, 300);
    const [rows] = await pool.query('SELECT * FROM bling_log ORDER BY id DESC LIMIT ?', [lim]);
    res.json({ ok: true, log: rows });
  } catch (e) { responderErro(res, e); }
});

module.exports = router;
