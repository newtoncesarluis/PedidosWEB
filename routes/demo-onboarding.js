/**
 * demo-onboarding.js — rotas públicas (proxy → Painel NC, fail-open).
 */
const express = require('express');
const router = express.Router();
const { statusOnboarding, registrarOnboarding, configDemo } = require('../services/painel-demo');

const FALLBACK = {
  landing_url: process.env.DEMO_LANDING_URL || 'https://pedidos.nresolutions.com.br/landing.html?novo=1',
  demo_usuario: process.env.DEMO_USUARIO || 'ADMIN',
  demo_senha: process.env.DEMO_SENHA || 'ADMIN',
};

router.get('/config', async (req, res) => {
  const data = await configDemo();
  if (data?.ok) return res.json(data);
  res.json({
    ok: true,
    landing_url: FALLBACK.landing_url,
    demo_usuario: FALLBACK.demo_usuario,
    demo_senha: FALLBACK.demo_senha,
    resumo: [
      'Pedidos, clientes e produtos integrados',
      'Financeiro, comissões e relatórios',
      'App mobile com modo offline',
      'Vitrine B2B para seus clientes',
    ],
  });
});

router.get('/onboarding-status', async (req, res) => {
  // Nunca cachear — evita loop de redirect com resposta stale no mobile
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');

  const chave = String(req.query.chave || req.query.chave_licenca || '').trim();
  const deviceId = String(req.query.device_id || '').trim();
  if (!deviceId) return res.json({ ok: true, show: false });

  const data = await statusOnboarding({
    chave_licenca: chave || 'LOCAL-DEMO',
    device_id: deviceId,
    modo_demo: req.query.modo_demo || '0',
  });

  if (data) return res.json(data);

  // Painel indisponível — fail-safe: não bloquear login com onboarding que o usuário
  // não consegue concluir. O controle "1x" continua funcionando quando o painel voltar.
  res.json({ ok: true, show: false, motivo: 'painel_indisponivel' });
});

router.post('/onboarding', async (req, res) => {
  const body = {
    ...(req.body || {}),
    ip: req.ip,
    user_agent: String(req.headers['user-agent'] || '').slice(0, 400),
  };
  const data = await registrarOnboarding(body);
  if (data?.ok) return res.json(data);
  // Fail-open: marca como ok localmente mesmo se painel falhar
  res.json({ ok: true, offline: true });
});

module.exports = router;
