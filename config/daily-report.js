/**
 * daily-report.js
 * Envia 2x por dia (padrão 08:00 e 18:00) um resumo das licenças
 * que acessaram o sistema, consultando o banco remoto de licenças.
 *
 * Env vars:
 *   ALERTA_RELATORIO_HORARIOS  — horas separadas por vírgula, ex: "8,18" (padrão)
 *   ALERTA_RELATORIO_TIMEZONE  — fuso horário (padrão: America/Sao_Paulo)
 */

const { sendMessage }  = require('./alert');
const { getLicensePool } = require('./db-license');

const TZ    = process.env.ALERTA_RELATORIO_TIMEZONE || 'America/Sao_Paulo';
const HORAS = (process.env.ALERTA_RELATORIO_HORARIOS || '8,18')
  .split(',').map(h => parseInt(h.trim(), 10)).filter(h => h >= 0 && h <= 23);

// ─── Relatório ────────────────────────────────────────────────────────────────
async function buildReport() {
  const licPool = getLicensePool();

  // Licenças ativas que acessaram hoje
  const [acessaram] = await licPool.query(`
    SELECT razao_social, chave_licenca, status, data_ultimo_acesso
    FROM sistema_licencas
    WHERE ativo = 1
      AND DATE(data_ultimo_acesso) = CURDATE()
    ORDER BY data_ultimo_acesso DESC
  `);

  // Total de licenças ativas (para mostrar "X de Y acessaram")
  const [[{ total }]] = await licPool.query(
    `SELECT COUNT(*) as total FROM sistema_licencas WHERE ativo = 1`
  );

  const agora = new Date().toLocaleString('pt-BR', { timeZone: TZ });
  const hoje  = new Date().toLocaleDateString('pt-BR', { timeZone: TZ });
  const nome  = process.env.SYSTEM_NAME || 'SysRepWeb';

  if (!acessaram.length) {
    return `📊 *${nome}* — Relatório diário\n📅 ${hoje} — ${agora.split(' ')[1]}\n\n❌ Nenhuma licença acessou o sistema hoje.\n\nTotal ativas: ${total}`;
  }

  const linhas = acessaram.map(r => {
    const hora  = r.data_ultimo_acesso
      ? new Date(r.data_ultimo_acesso).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
      : '--';
    const emoji = r.status === 'ativo' ? '✅' : '⚠️';
    const emp   = (r.razao_social || 'Sem nome').padEnd(0);
    return `${emoji} ${emp}\n   🔑 ${r.chave_licenca}  🕐 ${hora}`;
  });

  return [
    `📊 *${nome}* — Relatório diário`,
    `📅 ${hoje} — ${agora.split(' ')[1]}`,
    ``,
    linhas.join('\n\n'),
    ``,
    `📈 *${acessaram.length} de ${total}* licenças ativas acessaram hoje.`,
  ].join('\n');
}

async function sendDailyReport() {
  try {
    const msg = await buildReport();
    await sendMessage(msg, 'Relatório diário de acessos');
    console.log('[daily-report] Relatório enviado.');
  } catch (err) {
    console.error('[daily-report] Erro ao enviar relatório:', err.message);
  }
}

// ─── Agendador ────────────────────────────────────────────────────────────────
function _msAteProxima(hora) {
  // Lê hora/minuto/segundo atuais no fuso TZ via Intl
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const p = Object.fromEntries(partes.map(({ type, value }) => [type, value]));
  const horaAtual = parseInt(p.hour,   10);
  const minAtual  = parseInt(p.minute, 10);
  const secAtual  = parseInt(p.second, 10);

  const segHoje = (hora - horaAtual) * 3600 - minAtual * 60 - secAtual;
  // Se a hora ainda está no futuro hoje usa segHoje; senão adiciona 24h
  return (segHoje > 0 ? segHoje : segHoje + 86400) * 1000;
}

function _agendarHora(hora) {
  const ms = _msAteProxima(hora);
  const hh = Math.floor(ms / 3600000);
  const mm = Math.floor((ms % 3600000) / 60000);
  console.log(`[daily-report] Relatório das ${hora}h agendado em ${hh}h ${mm}min.`);
  setTimeout(() => {
    sendDailyReport();
    // Reagenda para o mesmo horário no dia seguinte
    setInterval(sendDailyReport, 24 * 60 * 60 * 1000);
  }, ms);
}

function startScheduler() {
  if (!process.env.ALERTA_WHATSAPP && !process.env.ALERTA_EMAIL) {
    console.log('[daily-report] ALERTA_WHATSAPP/ALERTA_EMAIL não configurado — relatório desativado.');
    return;
  }
  if (!HORAS.length) return;
  HORAS.forEach(_agendarHora);
}

module.exports = { startScheduler, sendDailyReport };
