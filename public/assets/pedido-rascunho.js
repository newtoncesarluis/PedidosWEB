/**
 * Rascunho automático de pedido em andamento — localStorage por usuário.
 * Não grava no servidor; complementa a fila offline (que só entra após Salvar).
 */
(function (global) {
  'use strict';

  const STORAGE_PREFIX = 'sysrep_pedido_rascunho_v1_';
  const DEBOUNCE_MS = 2500;
  const IDLE_MS = 30000;

  let _hooks = null;
  let _debounceTimer = null;
  let _idleTimer = null;
  let _lastSavedHash = '';
  let _inited = false;

  function token() {
    return sessionStorage.getItem('token') || localStorage.getItem('token') || '';
  }

  function userId() {
    const t = token();
    if (!t) return '0';
    try {
      const p = JSON.parse(atob(t.split('.')[1]));
      return String(p.id || p.idusuario || '0');
    } catch (_) {
      return '0';
    }
  }

  function storageKey() {
    return STORAGE_PREFIX + userId();
  }

  function load() {
    try {
      const raw = localStorage.getItem(storageKey());
      if (!raw) return null;
      const data = JSON.parse(raw);
      return data && data.v === 1 ? data : null;
    } catch (_) {
      return null;
    }
  }

  function save(snap) {
    if (!snap) return false;
    try {
      localStorage.setItem(storageKey(), JSON.stringify(snap));
      return true;
    } catch (_) {
      return false;
    }
  }

  function clear() {
    try {
      localStorage.removeItem(storageKey());
    } catch (_) {}
    _lastSavedHash = '';
  }

  function draftMatchesContext(draft, ctx) {
    if (!draft || !ctx) return false;
    if (ctx.mode === 'new') return !draft.modoEdit && !draft.idEdit;
    if (ctx.mode === 'edit') return !!draft.modoEdit && String(draft.idEdit) === String(ctx.idEdit);
    return false;
  }

  function snapHash(snap) {
    if (!snap) return '';
    const s = Object.assign({}, snap);
    delete s.savedAt;
    return JSON.stringify(s);
  }

  function tryPersist() {
    if (!_hooks) return;
    if (typeof _hooks.canSave === 'function' && !_hooks.canSave()) return;
    const snap = typeof _hooks.collect === 'function' ? _hooks.collect() : null;
    if (!snap) return;
    if (typeof _hooks.shouldSave === 'function' && !_hooks.shouldSave(snap)) return;
    const h = snapHash(snap);
    if (h === _lastSavedHash) return;
    snap.savedAt = new Date().toISOString();
    if (save(snap)) {
      _lastSavedHash = h;
      if (typeof _hooks.onSaved === 'function') _hooks.onSaved(snap);
    }
  }

  function scheduleSave() {
    if (!_hooks) return;
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(tryPersist, DEBOUNCE_MS);
    clearTimeout(_idleTimer);
    _idleTimer = setTimeout(tryPersist, IDLE_MS);
  }

  function markSaved() {
    tryPersist();
  }

  function init(hooks) {
    _hooks = hooks || {};
    if (_inited) return;
    _inited = true;

    document.addEventListener('input', (ev) => {
      if (!_hooks.isActive || !_hooks.isActive()) return;
      if (ev.target.closest('#formSection')) scheduleSave();
    });
    document.addEventListener('change', (ev) => {
      if (!_hooks.isActive || !_hooks.isActive()) return;
      if (ev.target.closest('#formSection')) scheduleSave();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') tryPersist();
    });
    window.addEventListener('beforeunload', () => {
      tryPersist();
    });
    window.addEventListener('online', () => scheduleSave());
    window.addEventListener('offline', () => tryPersist());
  }

  global.SysRepPedidoRascunho = {
    init,
    load,
    clear,
    scheduleSave,
    tryPersist,
    markSaved,
    draftMatchesContext,
  };
})(typeof window !== 'undefined' ? window : globalThis);
