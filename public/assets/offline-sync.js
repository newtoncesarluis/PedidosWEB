/**
 * offline-sync.js — gerenciador de sincronização offline para o SysRep mobile
 *
 * Depende de: offline-db.js (deve ser carregado antes)
 *
 * API pública (window.OfflineSync):
 *   sincronizarDados()          — baixa clientes+produtos do servidor → IndexedDB
 *   sincronizarFila()           — envia fila pendente (pedidos/visitas) → servidor
 *   sincronizarTudo()           — faz os dois
 *   buscarClientes(q, limit)    — busca local (offline) ou API (online)
 *   buscarProdutos(q, limit)    — busca local (offline) ou API (online)
 *   getStatus()                 — { online, ultimoSync, pendentes, clientes, produtos }
 *   isStale(horas)              — true se dados tiverem mais de N horas (padrão 6)
 *   renderIndicador(el)         — injeta widget de status no elemento informado
 *   bindAutoSync()              — chama uma vez; auto-sync ao voltar online
 */
(function (global) {
  'use strict';

  const STALE_HORAS = 6;

  // ── utilitários internos ──────────────────────────────────────────────────
  function isOnline() {
    return typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
  }

  function authHeaders() {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token') || '';
    return token ? { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
                 : { 'Content-Type': 'application/json' };
  }

  function hasToken() {
    return !!(localStorage.getItem('token') || sessionStorage.getItem('token'));
  }

  async function apiFetch(url, opts) {
    const resp = await fetch(url, { ...opts, headers: { ...authHeaders(), ...(opts && opts.headers) } });
    if (resp.status === 401) {
      window.dispatchEvent(new CustomEvent('sysrep-auth-expired'));
      throw new Error('auth');
    }
    return resp;
  }

  // ── Sync locks (evita corrida de múltiplos sync simultâneos) ─────────────
  let _syncingDados = false;
  let _syncingFila  = false;

  // ── Sincronizar dados (clientes + produtos) ───────────────────────────────
  async function sincronizarDados() {
    if (_syncingDados) throw new Error('sync em andamento');
    if (!hasToken()) throw new Error('auth');
    if (!isOnline()) throw new Error('offline');
    if (!global.OfflineDB)  throw new Error('OfflineDB não carregado');

    _syncingDados = true;
    try {
    const resp = await apiFetch('/api/mobile/dados-offline');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();

    if (!Array.isArray(data.clientes)) throw new Error('Resposta inválida: clientes não é array');
    if (!Array.isArray(data.produtos))  throw new Error('Resposta inválida: produtos não é array');

    await Promise.all([
      global.OfflineDB.salvarClientes(data.clientes),
      global.OfflineDB.salvarProdutos(data.produtos),
    ]);

    await global.OfflineDB.setMeta('last_sync',    data.synced_at);
    await global.OfflineDB.setMeta('vendedor_id',  data.vendedor_id);
    await global.OfflineDB.setMeta('total_clientes', data.totais?.clientes || 0);
    await global.OfflineDB.setMeta('total_produtos',  data.totais?.produtos  || 0);

    _atualizarIndicadores();
    return data.totais;
    } finally {
      _syncingDados = false;
    }
  }

  // ── Sincronizar fila (pedidos + visitas) ──────────────────────────────────
  async function sincronizarFila() {
    if (_syncingFila) return { synced: 0, failed: 0, skipped: 0 };
    if (!isOnline()) return { synced: 0, failed: 0, skipped: 0 };
    if (!global.OfflineDB) return { synced: 0, failed: 0, skipped: 0 };

    _syncingFila = true;
    try {

    const fila = await global.OfflineDB.getFila();
    if (!fila.length) return { synced: 0, failed: 0, skipped: 0 };

    let synced = 0, failed = 0, erros = [];

    for (const entry of fila) {
      try {
        let url, body;

        if (entry.tipo === 'pedido') {
          url  = '/api/pedidos';
          body = entry.dados;
        } else if (entry.tipo === 'visita') {
          url  = '/api/visitas';
          body = entry.dados;
        } else {
          await global.OfflineDB.marcarSincronizado(entry.localId);
          continue;
        }

        const resp = await apiFetch(url, { method: 'POST', body: JSON.stringify(body) });
        if (resp.status === 401) throw new Error('auth');
        const json = await resp.json();
        if (!resp.ok) throw new Error(json.error || 'Erro ' + resp.status);

        await global.OfflineDB.removerDaFila(entry.localId);
        synced++;
      } catch (e) {
        failed++;
        erros.push(e.message);
        if (e.message === 'auth') break; // sessão expirada — para tudo

        // Descarta item após 3 tentativas para não bloquear a fila
        const novasTentativas = (entry.tentativas || 0) + 1;
        if (novasTentativas >= 3) {
          await global.OfflineDB.removerDaFila(entry.localId).catch(() => {});
        } else {
          await global.OfflineDB.getFila().then(async () => {
            const t = await global.OfflineDB.open();
            return new Promise((res, rej) => {
              const tr = t.transaction('fila', 'readwrite');
              const s  = tr.objectStore('fila');
              const g  = s.get(entry.localId);
              g.onsuccess = () => {
                if (g.result) { g.result.tentativas = novasTentativas; s.put(g.result); }
                res();
              };
              g.onerror = e => rej(e.target.error);
            });
          }).catch(() => {});
        }
      }
    }

    _atualizarIndicadores();
    return { synced, failed, erros };
    } finally {
      _syncingFila = false;
    }
  }

  async function sincronizarTudo() {
    const [dados, fila] = await Promise.allSettled([
      sincronizarDados(),
      sincronizarFila(),
    ]);
    return {
      dados: dados.status === 'fulfilled' ? dados.value : { erro: dados.reason?.message },
      fila:  fila.status  === 'fulfilled' ? fila.value  : { erro: fila.reason?.message  },
    };
  }

  // ── Busca transparente (online → API, offline → IndexedDB) ────────────────
  async function buscarClientes(q, limit) {
    if (isOnline()) {
      try {
        const resp = await apiFetch(`/api/clientes?q=${encodeURIComponent(q || '')}&limit=${limit || 50}`);
        if (resp.ok) {
          const data = await resp.json();
          const lista = Array.isArray(data) ? data : (data.clientes || data.data || []);
          if (lista.length > 0) return lista;
        }
      } catch (_) { /* cai para offline */ }
    }
    // fallback offline
    if (global.OfflineDB) return global.OfflineDB.buscarClientes(q, limit || 50);
    return [];
  }

  async function buscarProdutos(q, limit) {
    if (isOnline()) {
      try {
        const resp = await apiFetch(`/api/produtos?q=${encodeURIComponent(q || '')}&limit=${limit || 50}`);
        if (resp.ok) {
          const data = await resp.json();
          const lista = Array.isArray(data) ? data : (data.produtos || data.data || []);
          if (lista.length > 0) return lista;
        }
      } catch (_) { /* cai para offline */ }
    }
    if (global.OfflineDB) return global.OfflineDB.buscarProdutos(q, limit || 50);
    return [];
  }

  // ── Status ────────────────────────────────────────────────────────────────
  async function getStatus() {
    const online = isOnline();
    let ultimoSync = null, clientes = 0, produtos = 0, pendentes = 0;

    if (global.OfflineDB) {
      try {
        const [ls, tc, tp, pend] = await Promise.all([
          global.OfflineDB.getMeta('last_sync'),
          global.OfflineDB.contarClientes(),
          global.OfflineDB.contarProdutos(),
          global.OfflineDB.contarFila(),
        ]);
        ultimoSync = ls;
        clientes   = tc || 0;
        produtos   = tp || 0;
        pendentes  = pend || 0;
      } catch (_) {}
    }

    return { online, ultimoSync, clientes, produtos, pendentes };
  }

  function isStale(horas) {
    horas = horas || STALE_HORAS;
    return global.OfflineDB
      ? global.OfflineDB.getMeta('last_sync').then(ls => {
          if (!ls) return true;
          return (Date.now() - new Date(ls).getTime()) > horas * 3600000;
        })
      : Promise.resolve(true);
  }

  // ── Indicador visual ──────────────────────────────────────────────────────
  const _indicadores = new Set();

  function renderIndicador(el) {
    if (!el) return;
    _indicadores.add(el);
    _atualizarIndicador(el);
  }

  async function _atualizarIndicador(el) {
    if (!el) return;
    try {
      const st = await getStatus();
      const agora = Date.now();
      let texto, cor, icone;

      if (!st.online && st.clientes === 0) {
        icone = '⚠️'; cor = '#dc2626';
        texto = 'Offline — sem dados locais';
      } else if (!st.online) {
        icone = '📵'; cor = '#d97706';
        const pend = st.pendentes > 0 ? ` · ${st.pendentes} pendente${st.pendentes>1?'s':''}` : '';
        texto = `Offline · ${st.clientes} clientes${pend}`;
      } else if (!st.ultimoSync) {
        icone = '🔄'; cor = '#0ea5e9';
        texto = 'Sincronizar dados';
      } else {
        const mins = Math.floor((agora - new Date(st.ultimoSync).getTime()) / 60000);
        const tempoStr = mins < 1    ? 'agora'
                       : mins < 60   ? `há ${mins} min`
                       : mins < 1440 ? `há ${Math.floor(mins/60)}h`
                                     : `há ${Math.floor(mins/1440)}d`;
        if (st.pendentes > 0) {
          icone = '⏳'; cor = '#f59e0b';
          texto = `${st.pendentes} pendente${st.pendentes>1?'s':''} · sincronizado ${tempoStr}`;
        } else {
          icone = '✓'; cor = '#059669';
          texto = `Sincronizado ${tempoStr}`;
        }
      }

      el.textContent = `${icone} ${texto}`;
      el.style.cssText = `color:${cor};font-size:12px;font-weight:600`;
    } catch (_) {}
  }

  function _atualizarIndicadores() {
    _indicadores.forEach(el => _atualizarIndicador(el));
  }

  // ── Auto-sync ao voltar online ────────────────────────────────────────────
  let _bound = false;
  function bindAutoSync(onSyncCallback) {
    if (_bound) return;
    _bound = true;

    window.addEventListener('online', async () => {
      if (!hasToken()) return;
      _atualizarIndicadores();
      try {
        // 1. Envia fila primeiro
        const filaRes = await sincronizarFila();
        if (filaRes.synced > 0 && typeof onSyncCallback === 'function') {
          onSyncCallback({ tipo: 'fila', ...filaRes });
        }
        // 2. Atualiza dados se estiverem velhos
        const stale = await isStale();
        if (stale) {
          await sincronizarDados();
          if (typeof onSyncCallback === 'function') {
            onSyncCallback({ tipo: 'dados' });
          }
        }
      } catch (_) {}
      _atualizarIndicadores();
    });

    window.addEventListener('offline', _atualizarIndicadores);

    // Auto-sync silencioso ao abrir com internet + dados velhos
    if (isOnline() && hasToken()) {
      isStale().then(stale => {
        if (stale) {
          sincronizarDados()
            .then(() => {
              if (typeof onSyncCallback === 'function') onSyncCallback({ tipo: 'dados', silencioso: true });
            })
            .catch(() => {});
        }
      });
    }
  }

  global.OfflineSync = {
    sincronizarDados,
    sincronizarFila,
    sincronizarTudo,
    buscarClientes,
    buscarProdutos,
    getStatus,
    isStale,
    renderIndicador,
    bindAutoSync,
    isOnline,
  };

})(window);
