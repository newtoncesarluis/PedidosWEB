/**
 * suporte-notificador.js
 * Bot que monitora nc_painel.solicitacoes (Painel NC central).
 * - A cada 30s: busca solicitações novas (notificado_wa=0) e notifica via WA
 * - Exporta sendWaAtualizacao() para o PATCH de licencas.js notificar interações
 */

const { getPainelPool }    = require('./db-painel');
const { sendWaLicenca } = require('./wa-licenca');

const TIPO_EMOJI = { ideia: '✨', bug: '🐛', melhoria: '💡', duvida: '❓' };
const STATUS_LABEL = {
  pendente:          '⏳ Pendente',
  em_analise:        '🔍 Em Análise',
  em_desenvolvimento:'🔧 Em Desenvolvimento',
  concluido:         '✅ Concluído',
  recusado:          '❌ Recusado',
};

function hora() {
  return new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short',
  });
}

// ── Polling: novas solicitações ───────────────────────────────────────────────
async function notificarPendentes() {
  const pool = getPainelPool();
  const [rows] = await pool.query(
    `SELECT id, chave_licenca, titulo, descricao, tipo, origem
     FROM solicitacoes WHERE notificado_wa = 0 ORDER BY id ASC LIMIT 5`
  );
  for (const s of rows) {
    const emoji = TIPO_EMOJI[s.tipo] || '📌';
    const orig  = s.origem === 'mobile' ? '📱 Mobile' : '🖥️ Desktop';
    const desc  = (s.descricao || '').slice(0, 250) + (s.descricao?.length > 250 ? '…' : '');
    const msg   = `📬 *Nova Solicitação #${s.id}*\n🔑 ${s.chave_licenca}\n${emoji} ${s.tipo} · ${orig}\n📝 *${s.titulo}*\n\n${desc}\n🕐 ${hora()}`;
    await sendWaLicenca(msg).catch(() => {});
    await pool.query(`UPDATE solicitacoes SET notificado_wa = 1 WHERE id = ?`, [s.id]);
  }
}

// ── Notificação imediata de atualização (chamada pelo PATCH) ─────────────────
async function sendWaAtualizacao(sol, novoStatus, novaResposta) {
  const statusLabel = STATUS_LABEL[novoStatus] || novoStatus;
  const resp = novaResposta ? `\n💬 _${novaResposta.slice(0, 200)}${novaResposta.length > 200 ? '…' : ''}_` : '';
  const msg = `🔔 *Solicitação #${sol.id} atualizada*\n🔑 ${sol.chave_licenca}\n📌 ${sol.titulo}\n📊 Status: *${statusLabel}*${resp}\n🕐 ${hora()}`;
  await sendWaLicenca(msg).catch(() => {});
}

// ── Start ─────────────────────────────────────────────────────────────────────
function startNotificador() {
  // Aguarda 10s antes da primeira checagem para o pool estar pronto
  setTimeout(() => {
    notificarPendentes().catch(() => {});
    setInterval(() => notificarPendentes().catch(() => {}), 30000);
    console.log('[suporte-notificador] Bot iniciado — polling a cada 30s');
  }, 10000);
}

module.exports = { startNotificador, sendWaAtualizacao };
