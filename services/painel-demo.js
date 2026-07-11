/**
 * painel-demo.js — proxy fail-open para onboarding DEMO no Painel NC.
 * Usa as mesmas variáveis PAINEL_ACESSOS_URL / PAINEL_ACESSOS_KEY.
 */
const BASE = (process.env.PAINEL_ACESSOS_URL || '').replace(/\/$/, '');
const KEY = process.env.PAINEL_ACESSOS_KEY || '';

function configurado() {
  return Boolean(BASE && KEY);
}

async function painelFetch(path, opts = {}) {
  if (!configurado()) return null;
  try {
    const r = await fetch(`${BASE}/api/demo${path}`, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': KEY,
        ...(opts.headers || {}),
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

async function statusOnboarding(params) {
  const q = new URLSearchParams(params).toString();
  return painelFetch(`/onboarding-status?${q}`, { method: 'GET' });
}

async function registrarOnboarding(body) {
  return painelFetch('/onboarding', { method: 'POST', body: JSON.stringify(body) });
}

async function configDemo() {
  return painelFetch('/config', { method: 'GET' });
}

module.exports = { configurado, statusOnboarding, registrarOnboarding, configDemo };
