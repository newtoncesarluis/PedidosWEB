/**
 * Detecta novo deploy consultando GET /api/version (BUILD_ID + versao semântica).
 * Usado pela home (desktop PWA) e pelo mobile-shell — não depende de Service Worker.
 */
(function () {
  'use strict';

  var VERSION_URL = '/api/version';
  var DEFAULT_POLL_MS = 90000;

  function versionKey(d) {
    if (!d) return '';
    return String(d.versao || '') + '|' + String(d.v || '');
  }

  function fetchVersion() {
    return fetch(VERSION_URL, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  window.sysrepVersionUpdateInit = function (opts) {
    opts = opts || {};
    var baseline = null;
    var notified = false;
    var checking = false;
    var pollMs = opts.pollMs || DEFAULT_POLL_MS;
    var onUpdate = typeof opts.onUpdate === 'function' ? opts.onUpdate : null;
    var onVersion = typeof opts.onVersion === 'function' ? opts.onVersion : null;

    function notifyUpdate(d) {
      if (notified) return;
      notified = true;
      if (onUpdate) onUpdate(d);
    }

    function applyVersion(d, isInitial) {
      if (!d) return;
      var key = versionKey(d);
      if (baseline == null) {
        baseline = key;
        if (onVersion) onVersion(d);
        return;
      }
      if (!isInitial && key && key !== baseline) notifyUpdate(d);
    }

    function checkForUpdate() {
      if (checking || notified || navigator.onLine === false) return;
      checking = true;
      fetchVersion().then(function (d) {
        checking = false;
        applyVersion(d, false);
      });
    }

    fetchVersion().then(function (d) { applyVersion(d, true); });

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') checkForUpdate();
    });
    window.addEventListener('focus', checkForUpdate);
    setInterval(checkForUpdate, pollMs);
  };
})();
