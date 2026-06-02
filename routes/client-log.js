const express = require('express');
const { logInfo, logError } = require('../config/logger');

const router = express.Router();
const MAX_MSG = 12000;

function clip(s, n) {
  const t = String(s ?? '');
  return t.length > n ? t.slice(0, n) + '…' : t;
}

/** Logs enviados pelo browser (mobile-shell iframe) → console Node + logs/errors.log */
router.post('/', (req, res) => {
  try {
    const body = req.body || {};
    const level = String(body.level || 'info').toLowerCase();
    const message = clip(body.message, MAX_MSG);
    const stack = clip(body.stack, MAX_MSG);
    const url = clip(body.url || body.href || '', 2000);
    const source = clip(body.source || 'client', 80);

    const head = `[CLIENT:${source}] [${level}]`;
    const line = `${head} ${message}${url ? ` @ ${url}` : ''}`;
    if (level === 'error') {
      const err = new Error(message || 'client-browser');
      if (stack) err.stack = stack;
      logError('client-browser', err);
    } else {
      logInfo('client-browser', line + (stack ? ` | ${stack.replace(/\n/g, ' ')}` : ''));
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false });
  }
});

module.exports = router;
