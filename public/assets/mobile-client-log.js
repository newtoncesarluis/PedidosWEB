/**
 * Mobile shell: encaminha erros JS, alert() e confirm() do iframe para POST /api/client-log
 * (aparece na janela cmd do node server.js / iniciar-sysrepweb.bat).
 */
(function () {
  'use strict';

  function authHeader() {
    try {
      var t = sessionStorage.getItem('token') || localStorage.getItem('token');
      return t ? { Authorization: 'Bearer ' + t } : {};
    } catch (_) {
      return {};
    }
  }

  function send(level, message, stack, url) {
    try {
      fetch('/api/client-log', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, authHeader()),
        body: JSON.stringify({
          source: 'mobile-iframe',
          level: level,
          message: message == null ? '' : String(message),
          stack: stack || '',
          url: url || ''
        }),
        keepalive: true
      }).catch(function () {});
    } catch (_) {}
  }

  function attachWindow(w) {
    if (!w || !w.window) return;

    var prevOnError = w.onerror;
    w.onerror = function (msg, src, line, col, err) {
      var loc = (src || '') + ':' + (line || 0) + ':' + (col || 0);
      send('error', String(msg), err && err.stack ? err.stack : '', loc);
      if (typeof prevOnError === 'function') return prevOnError.apply(this, arguments);
      return false;
    };

    w.addEventListener('unhandledrejection', function (ev) {
      var r = ev.reason;
      send('error', String(r), r && r.stack ? r.stack : '', w.location && w.location.href);
    });

    try {
      var a = w.alert;
      w.alert = function (text) {
        send('alert', String(text), '', w.location && w.location.href);
        return a.call(w, text);
      };
    } catch (_) {}

    try {
      var c = w.confirm;
      w.confirm = function (text) {
        send('confirm', String(text), '', w.location && w.location.href);
        return c.call(w, text);
      };
    } catch (_) {}
  }

  function hookShellWindow() {
    attachWindow(window);
  }

  function hookIframe() {
    var frame = document.getElementById('ms-frame');
    if (!frame) return;
    frame.addEventListener('load', function () {
      try {
        attachWindow(frame.contentWindow);
      } catch (e) {
        send('warn', 'mobile-client-log: iframe attach falhou (cross-origin?)', String(e), '');
      }
    });
    try {
      if (frame.contentWindow && frame.contentDocument && frame.contentDocument.readyState === 'complete') {
        attachWindow(frame.contentWindow);
      }
    } catch (_) {}
  }

  window.addEventListener('message', function (ev) {
    var d = ev.data || {};
    if (d.type !== 'sysrep-client-log') return;
    send(d.level || 'info', d.message, d.stack, d.url || '');
  });

  function run() {
    hookShellWindow();
    hookIframe();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
