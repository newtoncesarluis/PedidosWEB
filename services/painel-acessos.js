/**
 * painel-acessos.js
 * Envia cada acesso para o Painel NC central (projeto painelnc) via HTTP.
 * Fail-open: qualquer erro/timeout é engolido — NUNCA pode atrapalhar o login.
 *
 * Configuração (.env do cliente):
 *   PAINEL_ACESSOS_URL  = https://painelnc.nresolutions.com.br
 *   PAINEL_ACESSOS_KEY  = <mesma chave do INGEST_API_KEY no Painel>
 *   LICENCA_SISTEMA     = pedidosweb   (reaproveitado se existir)
 */
const BASE = (process.env.PAINEL_ACESSOS_URL || '').replace(/\/$/, '');
const KEY = process.env.PAINEL_ACESSOS_KEY || '';
const SISTEMA = process.env.LICENCA_SISTEMA || 'pedidosweb';

function configurado() {
  return Boolean(BASE && KEY);
}

/** Envia 1 acesso. Não lança. */
async function enviarAcesso(record = {}) {
  if (!configurado()) return; // sem painel configurado → só grava local
  try {
    await fetch(`${BASE}/api/acessos/registrar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': KEY },
      body: JSON.stringify({ ...record, sistema: SISTEMA }),
      signal: AbortSignal.timeout(6000),
    });
  } catch (_) { /* painel indisponível — acesso já está salvo localmente */ }
}

module.exports = { enviarAcesso, configurado };
