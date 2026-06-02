const fs   = require('fs');
const path = require('path');

const LOG_DIR  = path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'errors.log');

function _ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function _write(level, context, message, extra) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const line = `[${_ts()}] [${level}] [${context}] ${message}${extra ? '\n  ' + extra : ''}\n`;
    fs.appendFileSync(LOG_FILE, line, 'utf8');
    if (level === 'ERROR') process.stderr.write(line);
    else process.stdout.write(line);
  } catch {}
}

function logError(context, err) {
  const msg   = err?.message || String(err);
  const stack = err?.stack ? err.stack.split('\n').slice(1, 4).map(s => s.trim()).join(' | ') : '';
  _write('ERROR', context, msg, stack);
  // Alerta assíncrono — fire-and-forget, nunca lança
  try { require('./alert').notifyError(context, err); } catch {}
}

function logInfo(context, msg) {
  _write('INFO', context, msg);
}

module.exports = { logError, logInfo };
