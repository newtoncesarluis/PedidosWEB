/**
 * Lembretes push para vendedores (rotas de amanhã + visitas pendentes).
 * Requer VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY no .env e web-push instalado.
 *
 * PUSH_LEMBRETES_HORAS — horas no fuso PUSH_LEMBRETES_TZ (padrão: 7,18)
 */
const { getPool } = require('./database');

let _webpush = null;
try {
  _webpush = require('web-push');
  const vapidPublic = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  if (vapidPublic && vapidPrivate) {
    _webpush.setVapidDetails('mailto:suporte@ncsistemas.com.br', vapidPublic, vapidPrivate);
  } else {
    _webpush = null;
  }
} catch (_) {
  _webpush = null;
}

const TZ = process.env.PUSH_LEMBRETES_TZ || 'America/Sao_Paulo';
const HORAS = (process.env.PUSH_LEMBRETES_HORAS || '7,18')
  .split(',')
  .map((h) => parseInt(h.trim(), 10))
  .filter((h) => h >= 0 && h <= 23);

async function enviarPushUsuario(pool, idUsuario, { title, body, url = '/mobile-shell.html' }) {
  if (!_webpush || !idUsuario) return;
  const [subs] = await pool.query(
    'SELECT endpoint, p256dh, auth FROM push_subscription WHERE id_usuario=?',
    [idUsuario]
  );
  const payload = JSON.stringify({ title, body, url });
  for (const s of subs) {
    await _webpush
      .sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)
      .catch(async (e) => {
        if (e.statusCode === 410 || e.statusCode === 404) {
          await pool.query('DELETE FROM push_subscription WHERE endpoint=?', [s.endpoint]).catch(() => {});
        }
      });
  }
}

async function ensureLembreteTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_lembrete_enviado (
      id INT AUTO_INCREMENT PRIMARY KEY,
      id_usuario INT NOT NULL,
      tipo VARCHAR(32) NOT NULL,
      ref_data DATE NOT NULL,
      enviado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_push_lembrete (id_usuario, tipo, ref_data)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `).catch(() => {});
}

async function jaEnviouHoje(pool, idUsuario, tipo, refDate) {
  const [rows] = await pool.query(
    `SELECT id FROM push_lembrete_enviado WHERE id_usuario=? AND tipo=? AND ref_data=? LIMIT 1`,
    [idUsuario, tipo, refDate]
  );
  return rows.length > 0;
}

async function marcarEnviado(pool, idUsuario, tipo, refDate) {
  await pool.query(
    `INSERT IGNORE INTO push_lembrete_enviado (id_usuario, tipo, ref_data) VALUES (?,?,?)`,
    [idUsuario, tipo, refDate]
  ).catch(() => {});
}

async function runLembretesPush() {
  if (!_webpush) return;
  const pool = getPool();
  if (!pool) return;

  await ensureLembreteTable(pool);

  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: TZ });

  const [rotasAmanha] = await pool.query(`
    SELECT rv.id_usuario, COUNT(*) AS qtd,
           MIN(rv.descricao) AS primeira_desc
    FROM rota_vendedor rv
    WHERE rv.excluido = 'N'
      AND rv.status IN ('PENDENTE', 'EM_ANDAMENTO')
      AND rv.data_prevista = DATE_ADD(CURDATE(), INTERVAL 1 DAY)
    GROUP BY rv.id_usuario
  `).catch(() => [[]]);

  for (const row of rotasAmanha || []) {
    const uid = row.id_usuario;
    if (!uid) continue;
    const tipo = 'rota_amanha';
    if (await jaEnviouHoje(pool, uid, tipo, hoje)) continue;
    const qtd = row.qtd || 0;
    const desc = (row.primeira_desc || 'Rota').slice(0, 60);
    await enviarPushUsuario(pool, uid, {
      title: '📍 Rota amanhã',
      body: qtd > 1 ? `${qtd} rotas — ${desc}` : desc,
      url: '/mobile-shell.html',
    });
    await marcarEnviado(pool, uid, tipo, hoje);
  }

  const [visitasPend] = await pool.query(`
    SELECT v.id_vendedor AS id_usuario, COUNT(*) AS qtd
    FROM visitas v
    WHERE v.exluido = 'N'
      AND v.status = 'ABERTA'
      AND v.data_visita <= CURDATE()
    GROUP BY v.id_vendedor
  `).catch(() => [[]]);

  for (const row of visitasPend || []) {
    const uid = row.id_usuario;
    if (!uid) continue;
    const tipo = 'visita_pendente';
    if (await jaEnviouHoje(pool, uid, tipo, hoje)) continue;
    const qtd = row.qtd || 0;
    await enviarPushUsuario(pool, uid, {
      title: '📅 Visitas pendentes',
      body: qtd === 1 ? '1 visita em aberto para hoje ou atrasada' : `${qtd} visitas em aberto`,
      url: '/pages/visitas.html',
    });
    await marcarEnviado(pool, uid, tipo, hoje);
  }
}

function _horaAtualTz() {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const p = Object.fromEntries(partes.map(({ type, value }) => [type, value]));
  return parseInt(p.hour, 10);
}

function _msAteProxima(hora) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const p = Object.fromEntries(partes.map(({ type, value }) => [type, value]));
  const horaAtual = parseInt(p.hour, 10);
  const minAtual = parseInt(p.minute, 10);
  const secAtual = parseInt(p.second, 10);
  const segHoje = (hora - horaAtual) * 3600 - minAtual * 60 - secAtual;
  return (segHoje > 0 ? segHoje : segHoje + 86400) * 1000;
}

const _horasDisparadas = new Set();

function startPushLembretesScheduler() {
  if (!_webpush) {
    console.log('[push-lembretes] VAPID não configurado — lembretes push desativados.');
    return;
  }
  if (!HORAS.length) return;

  console.log(`[push-lembretes] Agendado às ${HORAS.join('h e ')}h (${TZ}).`);

  setInterval(() => {
    const h = _horaAtualTz();
    if (!HORAS.includes(h)) return;
    const chave = `${new Date().toLocaleDateString('en-CA', { timeZone: TZ })}-${h}`;
    if (_horasDisparadas.has(chave)) return;
    _horasDisparadas.add(chave);
    runLembretesPush().catch((e) => console.warn('[push-lembretes]', e.message));
  }, 60 * 1000);

  HORAS.forEach((hora) => {
    const ms = _msAteProxima(hora);
    setTimeout(() => {
      const chave = `${new Date().toLocaleDateString('en-CA', { timeZone: TZ })}-${hora}`;
      if (!_horasDisparadas.has(chave)) {
        _horasDisparadas.add(chave);
        runLembretesPush().catch((e) => console.warn('[push-lembretes]', e.message));
      }
      setInterval(() => {
        const ch = `${new Date().toLocaleDateString('en-CA', { timeZone: TZ })}-${hora}`;
        if (_horasDisparadas.has(ch)) return;
        _horasDisparadas.add(ch);
        runLembretesPush().catch((e) => console.warn('[push-lembretes]', e.message));
      }, 24 * 60 * 60 * 1000);
    }, ms);
  });
}

module.exports = { startPushLembretesScheduler, runLembretesPush };
