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

  function resolveDescProd(item) {
    const raw = item.desc_prod || item.desc_produto || item.descricao || item.descProd || '';
    return String(raw).trim().slice(0, 150);
  }

  function normalizeBodyDescProd(body) {
    const b = JSON.parse(JSON.stringify(body || {}));
    if (Array.isArray(b.itens)) {
      b.itens = b.itens.map(i => ({
        ...i,
        desc_prod: resolveDescProd(i)
      }));
    }
    return b;
  }

  function offlineMatchesStatusFilter(status) {
    const s = String(status || '').trim().toUpperCase();
    if (!s || s === 'TODOS' || s === 'TODAS' || s === 'TODO') return true;
    if (s === 'PENDENTE' || s === 'ENTREGAR' || s === 'OFFLINE') return true;
    return false;
  }

  function matchesTipoFilter(tipoPedido, filterTipo) {
    const f = String(filterTipo || '').trim().toUpperCase();
    if (!f || f === 'ALL' || f === 'TODOS' || f === 'TODAS') return true;
    const t = String(tipoPedido || '').toUpperCase();
    if (f === 'ORÇAMENTO' || f === 'ORCAMENTO') {
      return t.includes('ORC') || t.includes('ORÇ') || t.includes('ORC');
    }
    if (f === 'PEDIDO') return !t.includes('ORC') && !t.includes('ORÇ');
    return t.includes(f);
  }

  function queueAsPedidoRows(filters) {
    filters = filters || {};
    if (!offlineMatchesStatusFilter(filters.status)) return [];

    const q = String(filters.q || '').trim().toLowerCase();
    const status = filters.status || '';
    const tipo = filters.tipo || '';
    const origem = filters.origem || '';
    const dtIni = filters.dt_ini || '';
    const dtFim = filters.dt_fim || '';

    return loadQueue()
      .map(entry => {
        const p = entry.body?.pedido || {};
        const itens = (entry.body?.itens || []).filter(i => !i._delete);
        const dataAbertura = p.data_abertura || (entry.createdAt ? entry.createdAt.slice(0, 10) : '');
        return {
          id: entry.localId,
          _offlineLocal: true,
          _offlineLocalId: entry.localId,
          numero: p.numero_off || '—',
          numero_off: p.numero_off,
          data_abertura: dataAbertura,
          nome_cliente: p.nome_cliente || '',
          cod_cliente: p.cod_cliente,
          id_cliente: p.cod_cliente,
          id_usuario: p.id_usuario || null,
          nome_fornecedor: p.nome_fornecedor || '',
          nomeusu: p.nome_vendedor || '',
          nome_vendedor: p.nome_vendedor || '',
          vlrtotalpedido: parseFloat(p.vlrtotalpedido) || 0,
          total_qt: p.total_qt || itens.length,
          total_peso: p.total_peso || 0,
          qt_parcelas: p.qt_parcelas || 1,
          tipo_pedido: p.tipo_pedido || 'PEDIDO',
          situacao_pedido: 'OFFLINE',
          origem: p.origem || 'MOBILE',
          status: p.status || 'ENTREGAR',
          _offlineCreatedAt: entry.createdAt
        };
      })
      .filter(row => {
        if (q) {
          const hay = [row.numero, row.nome_cliente, row.nome_fornecedor, row.nome_vendedor, row.numero_off]
            .join(' ').toLowerCase();
          if (!hay.includes(q)) return false;
        }
        if (!matchesTipoFilter(row.tipo_pedido, tipo)) return false;
        const orig = String(origem || '').trim().toUpperCase();
        if (orig && String(row.origem || '').toUpperCase() !== orig) return false;
        const idVend = String(filters.id_vendedor || '').trim();
        if (idVend && idVend !== '0' && idVend !== 'TODOS' && idVend !== 'TODAS') {
          if (row.id_usuario && String(row.id_usuario) !== idVend) return false;
        }
        if (dtIni && row.data_abertura && row.data_abertura < dtIni) return false;
        if (dtFim && row.data_abertura && row.data_abertura > dtFim) return false;
        return true;
      })
      .sort((a, b) => (b._offlineCreatedAt || '').localeCompare(a._offlineCreatedAt || ''));
  }

  function enqueue(body) {
    const b = normalizeBodyDescProd(body);
    if (b.pedido) {
      if (!b.pedido.id_usuario && b.pedido.coduser_digitacao) {
        b.pedido.id_usuario = b.pedido.coduser_digitacao;
      }
      if (!b.pedido.id_usuario) {
        try {
          const u = JSON.parse(sessionStorage.getItem('user') || localStorage.getItem('user') || '{}');
          const uid = u.id || u.idusuario || u.id_usuario;
          if (uid) b.pedido.id_usuario = parseInt(uid, 10) || uid;
        } catch (_) {}
      }
    }
    const queue = loadQueue();
    const entry = {
      localId: 'off_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      createdAt: new Date().toISOString(),
      body: b
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
    const firstDesc = itens.length
      ? (itens[0].desc_prod || itens[0].desc_produto || itens[0].descricao || '').trim()
      : '';
    return {
      localId: entry.localId,
      numero: p.numero_off || '—',
      cliente: p.nome_cliente || ('Cliente #' + (p.cod_cliente || '?')),
      fornecedor: p.nome_fornecedor || p.nome_fabrica || '',
      vendedor: p.nome_vendedor || '',
      total: parseFloat(p.vlrtotalpedido || 0),
      itens: itens.length,
      firstItemDesc: firstDesc,
      createdAt: entry.createdAt
    };
  }

  function defaultApiJ() {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token') || '';
    return function (url, method, body) {
      const opts = {
        method: method || 'GET',
        headers: { Authorization: 'Bearer ' + token }
      };
      if (body && method && method !== 'GET') {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
      return fetch(url, opts);
    };
  }

  function resolveApiJ(apiJFn) {
    return typeof apiJFn === 'function' ? apiJFn : defaultApiJ();
  }

  /** Modal no documento do shell (pai), não dentro do iframe — senão fica invisível no mobile. */
  function queueModalDoc() {
    try {
      if (window.parent && window.parent !== window && window.parent.document && window.parent.document.body) {
        return window.parent.document;
      }
    } catch (_) {}
    return document;
  }

  function ensureQueueModal() {
    const doc = queueModalDoc();
    if (doc.getElementById('_offlineQueueModal')) return;
    const wrap = doc.createElement('div');
    wrap.id = '_offlineQueueModal';
    wrap.className = 'offline-queue-modal';
    wrap.innerHTML = `
      <div class="offline-queue-backdrop" id="_offlineQueueBackdrop"></div>
      <div class="offline-queue-panel" role="dialog" aria-labelledby="_offlineQueueTitle">
        <div class="offline-queue-head">
          <div>
            <h3 id="_offlineQueueTitle">Pedidos pendentes</h3>
            <p id="_offlineQueueSub" class="offline-queue-sub">Selecione o que enviar ao servidor</p>
          </div>
          <button type="button" id="_offlineQueueClose" aria-label="Fechar">×</button>
        </div>
        <label class="offline-queue-select-all" id="_offlineQueueSelectAllWrap">
          <input type="checkbox" id="_offlineQueueSelectAll" checked>
          <span>Selecionar todos</span>
        </label>
        <div id="_offlineQueueList" class="offline-queue-list"></div>
        <div class="offline-queue-foot">
          <button type="button" id="_offlineQueueSyncSel" class="offline-queue-btn primary">Sincronizar selecionados</button>
          <button type="button" id="_offlineQueueSync" class="offline-queue-btn">Sincronizar todos</button>
          <button type="button" id="_offlineQueueClose2" class="offline-queue-btn ghost">Fechar</button>
        </div>
      </div>`;
    if (!doc.getElementById('_offlineQueueModalStyles')) {
      const st = doc.createElement('style');
      st.id = '_offlineQueueModalStyles';
      st.textContent = `
        .offline-queue-modal{display:none;position:fixed;inset:0;z-index:2147483647;align-items:center;justify-content:center;padding:16px}
        .offline-queue-modal.show{display:flex}
        .offline-queue-backdrop{position:absolute;inset:0;background:rgba(15,23,42,.45)}
        .offline-queue-panel{position:relative;background:var(--card,#fff);border-radius:16px;width:min(480px,100%);max-height:min(80vh,560px);display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(0,0,0,.22);font-family:var(--font,'Segoe UI',sans-serif)}
        .offline-queue-head{display:flex;align-items:flex-start;justify-content:space-between;padding:16px 18px 10px;border-bottom:1px solid var(--border,#e2e8f0);gap:10px}
        .offline-queue-head h3{margin:0;font-size:17px;font-weight:800;color:var(--text,#0f172a)}
        .offline-queue-sub{margin:4px 0 0;font-size:12px;color:var(--text2,#64748b);line-height:1.4}
        .offline-queue-head button{border:none;background:transparent;font-size:26px;line-height:1;cursor:pointer;color:var(--text2,#64748b);flex-shrink:0}
        .offline-queue-select-all{display:flex;align-items:center;gap:8px;padding:8px 18px 4px;font-size:12px;font-weight:700;color:var(--text2,#64748b);cursor:pointer}
        .offline-queue-select-all input{width:16px;height:16px}
        .offline-queue-list{overflow:auto;padding:8px 16px 12px;flex:1;-webkit-overflow-scrolling:touch}
        .offline-queue-item{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border:1px solid var(--border,#e2e8f0);border-radius:12px;margin-bottom:8px;background:var(--bg,#f8fafc)}
        .offline-queue-item input[type=checkbox]{margin-top:3px;width:16px;height:16px;flex-shrink:0}
        .offline-queue-item-body{flex:1;min-width:0}
        .offline-queue-item strong{display:block;font-size:14px;margin-bottom:4px;line-height:1.35}
        .offline-queue-item span{display:block;font-size:12px;color:var(--text2,#64748b);line-height:1.45}
        .offline-queue-item-actions{display:flex;gap:6px;margin-top:8px}
        .offline-queue-one-btn{border:1px solid var(--border,#e2e8f0);background:var(--card,#fff);border-radius:8px;padding:6px 10px;font:inherit;font-size:11px;font-weight:700;cursor:pointer;color:var(--accent,#4361ee)}
        .offline-queue-foot{display:flex;flex-wrap:wrap;gap:8px;padding:12px 16px 16px;border-top:1px solid var(--border,#e2e8f0)}
        .offline-queue-btn{flex:1 1 45%;border:1px solid var(--border,#e2e8f0);background:var(--card,#fff);border-radius:10px;padding:11px 12px;font:inherit;font-size:13px;font-weight:700;cursor:pointer;min-height:44px}
        .offline-queue-btn.primary{background:linear-gradient(135deg,var(--accent,#6f63ff),var(--accent-hover,#5f55ec));color:#fff;border:none;flex:1 1 100%}
        .offline-queue-btn.ghost{background:transparent;color:var(--text2,#64748b);flex:1 1 100%}
      `;
      doc.head.appendChild(st);
    }
    doc.body.appendChild(wrap);
    wrap.querySelector('#_offlineQueueBackdrop').onclick = closeQueueModal;
    wrap.querySelector('#_offlineQueueClose').onclick = closeQueueModal;
    wrap.querySelector('#_offlineQueueClose2').onclick = closeQueueModal;
  }

  function closeQueueModal() {
    queueModalDoc().getElementById('_offlineQueueModal')?.classList.remove('show');
  }

  function _notifySyncResult(res, label) {
    const fn = typeof global.msToast === 'function' ? global.msToast
      : (typeof global.toast === 'function' ? global.toast : null);
    if (!fn) return;
    if (res.synced > 0) fn((label || '') + res.synced + ' pedido(s) sincronizado(s)', 'ok');
    if (res.failed > 0) {
      const msg = (res.errors && res.errors[0]) || 'Erro ao sincronizar';
      fn(res.failed + ' pedido(s) com erro: ' + msg, 'err');
    }
    if (res.error && !res.synced) fn(res.error, 'warn');
  }

  function _afterSyncRefresh(apiJFn) {
    if (typeof global.carregar === 'function') global.carregar();
    if (typeof global.atualizarBotaoSync === 'function') global.atualizarBotaoSync();
    try {
      const frame = document.getElementById('ms-frame');
      if (frame && frame.contentWindow) {
        frame.contentWindow.postMessage({ type: 'mobile-refresh' }, '*');
      }
      // Notifica o frame pai (quando sincronizando dentro do iframe) para atualizar o badge
      if (global.parent && global.parent !== global) {
        global.parent.postMessage({ type: 'offline-queue-changed' }, '*');
      }
    } catch (_) {}
    renderQueueModal(apiJFn);
    if (!count()) closeQueueModal();
  }

  async function syncEntries(apiJFn, entries) {
    if (!isOnline()) return { ok: false, error: 'Sem conexão', synced: 0, failed: 0 };
    const api = resolveApiJ(apiJFn);
    if (!entries.length) return { ok: true, synced: 0, failed: 0 };
    let synced = 0;
    let failed = 0;
    const errors = [];
    for (const entry of entries) {
      try {
        const body = normalizeBodyDescProd(entry.body);
        const r = await api('/api/pedidos', 'POST', body);
        if (r.status === 401) throw new Error('Sessão expirada — faça login online e sincronize novamente');
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

  async function syncOne(apiJFn, localId) {
    const entry = loadQueue().find(e => e.localId === localId);
    if (!entry) return { ok: false, error: 'Pedido não encontrado', synced: 0, failed: 1 };
    return syncEntries(apiJFn, [entry]);
  }

  async function syncSelected(apiJFn, localIds) {
    const ids = new Set((localIds || []).map(String));
    const entries = loadQueue().filter(e => ids.has(String(e.localId)));
    return syncEntries(apiJFn, entries);
  }

  function renderQueueModal(apiJFn) {
    ensureQueueModal();
    const doc = queueModalDoc();
    const list = doc.getElementById('_offlineQueueList');
    const queue = loadQueue();
    const api = resolveApiJ(apiJFn);
    if (!list) return;
    if (!queue.length) {
      list.innerHTML = '<p style="margin:0;padding:8px 4px;color:var(--text2,#64748b);font-size:13px">Nenhum pedido pendente.</p>';
    } else {
      list.innerHTML = queue.map(entry => {
        const s = queueSummary(entry);
        const dt = s.createdAt ? new Date(s.createdAt).toLocaleString('pt-BR') : '';
        const total = Number.isFinite(s.total) ? s.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—';
        const descLinha = s.firstItemDesc ? `<span>${escapeHtml(s.firstItemDesc)}${s.itens > 1 ? '…' : ''}</span>` : '';
        return `<div class="offline-queue-item" data-local-id="${s.localId}">
          <input type="checkbox" class="offline-queue-chk" data-local-id="${s.localId}" checked>
          <div class="offline-queue-item-body">
            <strong>#${s.numero} · ${escapeHtml(s.cliente)}</strong>
            <span>${escapeHtml(s.fornecedor || 'Sem fábrica')} · ${s.itens} item(ns) · ${total}</span>
            ${descLinha}
            <span>${escapeHtml(s.vendedor || '')}${s.vendedor ? ' · ' : ''}${dt}</span>
            <div class="offline-queue-item-actions">
              <button type="button" class="offline-queue-one-btn" data-sync-one="${s.localId}">Sincronizar este</button>
            </div>
          </div>
        </div>`;
      }).join('');
    }

    const selectAll = doc.getElementById('_offlineQueueSelectAll');
    const selectWrap = doc.getElementById('_offlineQueueSelectAllWrap');
    if (selectWrap) selectWrap.style.display = queue.length ? 'flex' : 'none';
    if (selectAll) {
      selectAll.checked = true;
      selectAll.onchange = () => {
        list.querySelectorAll('.offline-queue-chk').forEach(chk => {
          chk.checked = selectAll.checked;
        });
      };
    }

    list.querySelectorAll('[data-sync-one]').forEach(btn => {
      btn.onclick = async () => {
        if (!isOnline()) {
          _notifySyncResult({ error: 'Sem conexão', synced: 0 }, '');
          return;
        }
        btn.disabled = true;
        const res = await syncOne(api, btn.getAttribute('data-sync-one'));
        btn.disabled = false;
        _notifySyncResult(res, '');
        _afterSyncRefresh(api);
      };
    });

    const syncSelBtn = doc.getElementById('_offlineQueueSyncSel');
    if (syncSelBtn) {
      syncSelBtn.onclick = async () => {
        if (!isOnline()) {
          _notifySyncResult({ error: 'Sem conexão', synced: 0 }, '');
          return;
        }
        const ids = [...list.querySelectorAll('.offline-queue-chk:checked')].map(chk => chk.dataset.localId);
        if (!ids.length) {
          _notifySyncResult({ error: 'Selecione ao menos um pedido', synced: 0 }, '');
          return;
        }
        syncSelBtn.disabled = true;
        const res = await syncSelected(api, ids);
        syncSelBtn.disabled = false;
        _notifySyncResult(res, '');
        _afterSyncRefresh(api);
      };
    }

    const syncBtn = doc.getElementById('_offlineQueueSync');
    if (syncBtn) {
      syncBtn.onclick = async () => {
        if (!isOnline()) {
          _notifySyncResult({ error: 'Sem conexão', synced: 0 }, '');
          return;
        }
        syncBtn.disabled = true;
        const res = await syncAll(api);
        syncBtn.disabled = false;
        _notifySyncResult(res, '');
        _afterSyncRefresh(api);
      };
    }
    doc.getElementById('_offlineQueueModal')?.classList.add('show');
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function openQueueModal(apiJFn) {
    ensureQueueModal();
    renderQueueModal(apiJFn);
  }

  async function syncAll(apiJFn) {
    const queue = loadQueue();
    if (!queue.length) {
      updateBadge();
      return { ok: true, synced: 0, failed: 0 };
    }
    return syncEntries(apiJFn, queue);
  }

  function bindEvents(apiJFn) {
    const bindKey = '__sysrepPedidosOfflineBound_' + (global.location && global.location.pathname ? global.location.pathname : 'root');
    if (global[bindKey]) return;
    global[bindKey] = true;

    window.addEventListener('online', () => {
      updateBadge();
      const n = count();
      if (n > 0) {
        const fn = typeof global.msToast === 'function' ? global.msToast
          : (typeof global.toast === 'function' ? global.toast : null);
        if (fn) fn(n + ' pedido' + (n > 1 ? 's' : '') + ' offline pendente' + (n > 1 ? 's' : '') + ' — toque no badge', 'warn');
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
    syncOne,
    syncSelected,
    defaultApiJ,
    updateBadge,
    bindEvents,
    openQueueModal,
    queueSummary,
    queueAsPedidoRows,
    normalizeBodyDescProd
  };
})(window);
