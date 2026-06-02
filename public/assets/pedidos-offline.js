/**
 * Fila local de pedidos offline — salva no localStorage e sincroniza via POST /api/pedidos.
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'sysrep_pedidos_offline_v1';
  const NUM_KEY = 'sysrep_pedidos_off_num_v1';

  function loadQueue() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      return [];
    }
  }

  function saveQueue(queue) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    updateBadge();
  }

  function nextNumeroOff() {
    let n = parseInt(localStorage.getItem(NUM_KEY) || '0', 10);
    if (!Number.isFinite(n) || n < 0) n = 0;
    n += 1;
    localStorage.setItem(NUM_KEY, String(n));
    return String(n).padStart(6, '0');
  }

  function enqueue(body) {
    const queue = loadQueue();
    const entry = {
      localId: 'off_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      createdAt: new Date().toISOString(),
      body: JSON.parse(JSON.stringify(body))
    };
    queue.push(entry);
    saveQueue(queue);
    return entry;
  }

  function remove(localId) {
    const queue = loadQueue().filter(e => e.localId !== localId);
    saveQueue(queue);
  }

  function getQueue() {
    return loadQueue();
  }

  function count() {
    return loadQueue().length;
  }

  function isOnline() {
    return typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
  }

  function updateBadge() {
    const n = count();
    const badge = document.getElementById('offlineQueueBadge');
    if (badge) {
      if (n > 0) {
        badge.style.display = 'inline-flex';
        badge.style.cursor = 'pointer';
        badge.textContent = n === 1 ? '1 pedido offline' : n + ' pedidos offline';
        badge.title = 'Toque para ver a fila · sincronize quando voltar online';
      } else {
        badge.style.display = 'none';
        badge.style.cursor = '';
        badge.textContent = '';
        badge.title = '';
      }
    }
  }

  function queueSummary(entry) {
    const p = entry.body?.pedido || {};
    const itens = (entry.body?.itens || []).filter(i => !i._delete);
    return {
      localId: entry.localId,
      numero: p.numero_off || '—',
      cliente: p.nome_cliente || ('Cliente #' + (p.cod_cliente || '?')),
      fornecedor: p.nome_fornecedor || p.nome_fabrica || '',
      total: parseFloat(p.vlrtotalpedido || 0),
      itens: itens.length,
      createdAt: entry.createdAt
    };
  }

  function ensureQueueModal() {
    if (document.getElementById('_offlineQueueModal')) return;
    const wrap = document.createElement('div');
    wrap.id = '_offlineQueueModal';
    wrap.className = 'offline-queue-modal';
    wrap.innerHTML = `
      <div class="offline-queue-backdrop" id="_offlineQueueBackdrop"></div>
      <div class="offline-queue-panel" role="dialog" aria-labelledby="_offlineQueueTitle">
        <div class="offline-queue-head">
          <h3 id="_offlineQueueTitle">Pedidos aguardando sync</h3>
          <button type="button" id="_offlineQueueClose" aria-label="Fechar">×</button>
        </div>
        <div id="_offlineQueueList" class="offline-queue-list"></div>
        <div class="offline-queue-foot">
          <button type="button" id="_offlineQueueSync" class="offline-queue-btn primary">Sincronizar agora</button>
          <button type="button" id="_offlineQueueClose2" class="offline-queue-btn">Fechar</button>
        </div>
      </div>`;
    if (!document.getElementById('_offlineQueueModalStyles')) {
      const st = document.createElement('style');
      st.id = '_offlineQueueModalStyles';
      st.textContent = `
        .offline-queue-modal{display:none;position:fixed;inset:0;z-index:2147483600;align-items:center;justify-content:center;padding:16px}
        .offline-queue-modal.show{display:flex}
        .offline-queue-backdrop{position:absolute;inset:0;background:rgba(15,23,42,.45)}
        .offline-queue-panel{position:relative;background:var(--card,#fff);border-radius:16px;width:min(480px,100%);max-height:min(80vh,560px);display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(0,0,0,.22);font-family:var(--font,'Segoe UI',sans-serif)}
        .offline-queue-head{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid var(--border,#e2e8f0)}
        .offline-queue-head h3{margin:0;font-size:16px;font-weight:800}
        .offline-queue-head button{border:none;background:transparent;font-size:24px;line-height:1;cursor:pointer;color:var(--text2,#64748b)}
        .offline-queue-list{overflow:auto;padding:12px 16px;flex:1}
        .offline-queue-item{padding:12px 14px;border:1px solid var(--border,#e2e8f0);border-radius:12px;margin-bottom:8px;background:var(--bg,#f8fafc)}
        .offline-queue-item strong{display:block;font-size:14px;margin-bottom:4px}
        .offline-queue-item span{display:block;font-size:12px;color:var(--text2,#64748b);line-height:1.5}
        .offline-queue-foot{display:flex;gap:8px;padding:12px 16px 16px;border-top:1px solid var(--border,#e2e8f0)}
        .offline-queue-btn{flex:1;border:1px solid var(--border,#e2e8f0);background:var(--card,#fff);border-radius:10px;padding:10px 12px;font:inherit;font-size:13px;font-weight:700;cursor:pointer}
        .offline-queue-btn.primary{background:linear-gradient(135deg,var(--accent,#6f63ff),var(--accent-hover,#5f55ec));color:#fff;border:none}
      `;
      document.head.appendChild(st);
    }
    document.body.appendChild(wrap);
    wrap.querySelector('#_offlineQueueBackdrop').onclick = closeQueueModal;
    wrap.querySelector('#_offlineQueueClose').onclick = closeQueueModal;
    wrap.querySelector('#_offlineQueueClose2').onclick = closeQueueModal;
  }

  function closeQueueModal() {
    document.getElementById('_offlineQueueModal')?.classList.remove('show');
  }

  function renderQueueModal(apiJFn) {
    ensureQueueModal();
    const list = document.getElementById('_offlineQueueList');
    const queue = loadQueue();
    if (!list) return;
    if (!queue.length) {
      list.innerHTML = '<p style="margin:0;padding:8px 4px;color:var(--text2,#64748b);font-size:13px">Nenhum pedido na fila offline.</p>';
    } else {
      list.innerHTML = queue.map(entry => {
        const s = queueSummary(entry);
        const dt = s.createdAt ? new Date(s.createdAt).toLocaleString('pt-BR') : '';
        const total = Number.isFinite(s.total) ? s.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—';
        return `<div class="offline-queue-item" data-local-id="${s.localId}">
          <strong>#${s.numero} · ${escapeHtml(s.cliente)}</strong>
          <span>${escapeHtml(s.fornecedor || 'Sem fábrica')} · ${s.itens} item(ns) · ${total}</span>
          <span>${dt}</span>
        </div>`;
      }).join('');
    }
    const syncBtn = document.getElementById('_offlineQueueSync');
    if (syncBtn) {
      syncBtn.onclick = async () => {
        if (!isOnline()) {
          if (typeof global.toast === 'function') global.toast('Sem conexão para sincronizar', 'warn');
          return;
        }
        syncBtn.disabled = true;
        const res = await syncAll(apiJFn);
        syncBtn.disabled = false;
        if (typeof global.toast === 'function') {
          if (res.synced > 0) global.toast(res.synced + ' pedido(s) sincronizado(s)', 'ok');
          if (res.failed > 0) {
            const msg = (res.errors && res.errors[0]) || 'Erro ao sincronizar';
            global.toast(res.failed + ' pedido(s) com erro: ' + msg, 'err');
          }
          if (res.error && !res.synced) global.toast(res.error, 'warn');
        }
        if (typeof global.carregar === 'function') global.carregar();
        renderQueueModal(apiJFn);
        if (!count()) closeQueueModal();
      };
    }
    document.getElementById('_offlineQueueModal')?.classList.add('show');
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function openQueueModal(apiJFn) {
    renderQueueModal(apiJFn);
  }

  async function syncAll(apiJFn) {
    if (!isOnline()) return { ok: false, error: 'Sem conexão', synced: 0, failed: 0 };
    const queue = loadQueue();
    if (!queue.length) {
      updateBadge();
      return { ok: true, synced: 0, failed: 0 };
    }
    if (typeof apiJFn !== 'function') {
      return { ok: false, error: 'apiJ indisponível', synced: 0, failed: queue.length };
    }

    let synced = 0;
    let failed = 0;
    const errors = [];

    for (const entry of queue) {
      try {
        const r = await apiJFn('/api/pedidos', 'POST', entry.body);
        if (r.status === 401) {
          throw new Error('Sessão expirada — faça login online e sincronize novamente');
        }
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Erro ao sincronizar');
        remove(entry.localId);
        synced++;
      } catch (e) {
        failed++;
        errors.push(e.message || String(e));
      }
    }

    updateBadge();
    return { ok: failed === 0, synced, failed, errors };
  }

  function bindEvents(apiJFn) {
    if (global.__sysrepPedidosOfflineBound) return;
    global.__sysrepPedidosOfflineBound = true;

    window.addEventListener('online', () => {
      updateBadge();
      if (typeof apiJFn === 'function') {
        syncAll(apiJFn).then(res => {
          if (res.synced > 0 && typeof global.toast === 'function') {
            global.toast(res.synced + ' pedido(s) sincronizado(s)', 'ok');
            if (typeof global.carregar === 'function') global.carregar();
          }
        }).catch(() => {});
      }
    });

    window.addEventListener('offline', updateBadge);
    document.addEventListener('DOMContentLoaded', () => {
      updateBadge();
      const badge = document.getElementById('offlineQueueBadge');
      if (badge && !badge.dataset.queueBound) {
        badge.dataset.queueBound = '1';
        badge.addEventListener('click', () => {
          if (count() > 0) openQueueModal(apiJFn);
        });
      }
    });
    updateBadge();
  }

  global.SysRepPedidosOffline = {
    enqueue,
    remove,
    getQueue,
    count,
    nextNumeroOff,
    isOnline,
    syncAll,
    updateBadge,
    bindEvents,
    openQueueModal,
    queueSummary
  };
})(window);
