/**
 * offline-db.js — wrapper IndexedDB para dados offline do SysRep
 *
 * Stores:
 *   clientes  — cadastro dos clientes do vendedor
 *   produtos  — catálogo de produtos ativos
 *   fila      — pedidos e visitas pendentes de sync
 *   meta      — chaves de controle (last_sync, vendedor_id, etc.)
 */
(function (global) {
  'use strict';

  const DB_NAME    = 'sysrep-offline-v1';
  const DB_VERSION = 2;

  let _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = function (e) {
        const db = e.target.result;

        if (!db.objectStoreNames.contains('clientes')) {
          const s = db.createObjectStore('clientes', { keyPath: 'id' });
          s.createIndex('nome',        'nome',        { unique: false });
          s.createIndex('cod_vendedor','cod_vendedor', { unique: false });
        }
        if (!db.objectStoreNames.contains('produtos')) {
          const s = db.createObjectStore('produtos', { keyPath: 'id' });
          s.createIndex('nome', 'nome', { unique: false });
        }
        if (!db.objectStoreNames.contains('fila')) {
          const s = db.createObjectStore('fila', { keyPath: 'localId' });
          s.createIndex('tipo',   'tipo',   { unique: false });
          s.createIndex('status', 'status', { unique: false });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      };

      req.onsuccess = function (e) { _db = e.target.result; resolve(_db); };
      req.onerror   = function (e) { reject(e.target.error); };
    });
  }

  // ── helpers genéricos ──────────────────────────────────────────────────────
  function tx(store, mode) {
    return open().then(db => db.transaction(store, mode).objectStore(store));
  }

  function promReq(req) {
    return new Promise((res, rej) => {
      req.onsuccess = e => res(e.target.result);
      req.onerror   = e => rej(e.target.error);
    });
  }

  // ── Meta ───────────────────────────────────────────────────────────────────
  function getMeta(key) {
    return tx('meta', 'readonly').then(s => promReq(s.get(key))).then(r => r ? r.value : null);
  }
  function setMeta(key, value) {
    return tx('meta', 'readwrite').then(s => promReq(s.put({ key, value })));
  }

  // ── Clientes ───────────────────────────────────────────────────────────────
  function salvarClientes(lista) {
    return open().then(db => {
      return new Promise((resolve, reject) => {
        const t  = db.transaction('clientes', 'readwrite');
        const s  = t.objectStore('clientes');
        s.clear();
        lista.forEach(c => s.put(c));
        t.oncomplete = () => resolve(lista.length);
        t.onerror    = e  => reject(e.target.error);
      });
    });
  }

  function buscarClientes(q, limit) {
    limit = limit || 50;
    return open().then(db => {
      return new Promise((resolve, reject) => {
        const resultados = [];
        const termo = (q || '').toLowerCase().trim();
        const req = db.transaction('clientes', 'readonly')
                      .objectStore('clientes')
                      .openCursor();

        req.onsuccess = function (e) {
          const cursor = e.target.result;
          if (!cursor || resultados.length >= limit) {
            return resolve(resultados);
          }
          const c = cursor.value;
          if (
            !termo ||
            (c.nome  && c.nome.toLowerCase().includes(termo))  ||
            (c.cpf   && c.cpf.includes(termo))                 ||
            (c.cidade && c.cidade.toLowerCase().includes(termo))
          ) {
            resultados.push(c);
          }
          cursor.continue();
        };
        req.onerror = e => reject(e.target.error);
      });
    });
  }

  function getCliente(id) {
    return tx('clientes', 'readonly').then(s => promReq(s.get(Number(id))));
  }

  function contarClientes() {
    return tx('clientes', 'readonly').then(s => promReq(s.count()));
  }

  // ── Produtos ───────────────────────────────────────────────────────────────
  function salvarProdutos(lista) {
    return open().then(db => {
      return new Promise((resolve, reject) => {
        const t = db.transaction('produtos', 'readwrite');
        const s = t.objectStore('produtos');
        s.clear();
        lista.forEach(p => s.put(p));
        t.oncomplete = () => resolve(lista.length);
        t.onerror    = e  => reject(e.target.error);
      });
    });
  }

  function buscarProdutos(q, limit) {
    limit = limit || 50;
    return open().then(db => {
      return new Promise((resolve, reject) => {
        const resultados = [];
        const termo = (q || '').toLowerCase().trim();
        const req = db.transaction('produtos', 'readonly')
                      .objectStore('produtos')
                      .openCursor();

        req.onsuccess = function (e) {
          const cursor = e.target.result;
          if (!cursor || resultados.length >= limit) {
            return resolve(resultados);
          }
          const p = cursor.value;
          if (
            !termo ||
            (p.nome       && p.nome.toLowerCase().includes(termo))  ||
            (p.referencia && p.referencia.toLowerCase().includes(termo))
          ) {
            resultados.push(p);
          }
          cursor.continue();
        };
        req.onerror = e => reject(e.target.error);
      });
    });
  }

  function getProduto(id) {
    return tx('produtos', 'readonly').then(s => promReq(s.get(Number(id))));
  }

  function contarProdutos() {
    return tx('produtos', 'readonly').then(s => promReq(s.count()));
  }

  // ── Fila (pedidos + visitas pendentes) ─────────────────────────────────────
  function enfileirar(tipo, dados) {
    let dadosCopy;
    try {
      dadosCopy = JSON.parse(JSON.stringify(dados));
    } catch (e) {
      return Promise.reject(new Error('Dados inválidos para offline: ' + e.message));
    }
    const entry = {
      localId:    'off_' + tipo + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      tipo:       tipo,
      status:     'pendente',
      tentativas: 0,
      criadoEm:   new Date().toISOString(),
      dados:      dadosCopy,
    };
    // Aguarda a Promise para garantir que a gravação foi concluída
    return tx('fila', 'readwrite').then(s => promReq(s.put(entry)).then(() => entry));
  }

  function getFila(tipo) {
    return open().then(db => {
      return new Promise((resolve, reject) => {
        const resultados = [];
        const s   = db.transaction('fila', 'readonly').objectStore('fila');
        const req = tipo
          ? s.index('tipo').openCursor(IDBKeyRange.only(tipo))
          : s.openCursor();

        req.onsuccess = function (e) {
          const cursor = e.target.result;
          if (!cursor) return resolve(resultados);
          if (cursor.value.status === 'pendente') resultados.push(cursor.value);
          cursor.continue();
        };
        req.onerror = e => reject(e.target.error);
      });
    });
  }

  function marcarSincronizado(localId) {
    return open().then(db => {
      return new Promise((resolve, reject) => {
        const t = db.transaction('fila', 'readwrite');
        const s = t.objectStore('fila');
        const g = s.get(localId);
        g.onsuccess = function () {
          if (g.result) {
            g.result.status = 'sincronizado';
            s.put(g.result);
          }
          resolve();
        };
        g.onerror = e => reject(e.target.error);
      });
    });
  }

  function removerDaFila(localId) {
    return tx('fila', 'readwrite').then(s => promReq(s.delete(localId)));
  }

  function contarFila() {
    return open().then(db => {
      return new Promise((resolve, reject) => {
        let count = 0;
        const req = db.transaction('fila', 'readonly')
                      .objectStore('fila')
                      .index('status')
                      .openCursor(IDBKeyRange.only('pendente'));
        req.onsuccess = e => {
          const cursor = e.target.result;
          if (!cursor) return resolve(count);
          count++;
          cursor.continue();
        };
        req.onerror = e => reject(e.target.error);
      });
    });
  }

  // ── Limpar tudo ────────────────────────────────────────────────────────────
  function limpar() {
    return open().then(db => {
      return new Promise((resolve, reject) => {
        const t = db.transaction(['clientes','produtos','fila','meta'], 'readwrite');
        ['clientes','produtos','fila','meta'].forEach(s => t.objectStore(s).clear());
        t.oncomplete = () => resolve();
        t.onerror    = e  => reject(e.target.error);
      });
    });
  }

  global.OfflineDB = {
    open,
    // meta
    getMeta, setMeta,
    // clientes
    salvarClientes, buscarClientes, getCliente, contarClientes,
    // produtos
    salvarProdutos, buscarProdutos, getProduto, contarProdutos,
    // fila
    enfileirar, getFila, marcarSincronizado, removerDaFila, contarFila,
    // utils
    limpar,
  };

})(window);
