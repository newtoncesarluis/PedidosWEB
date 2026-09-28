/**
 * SysRepLookup — busca estilo Google (digita → sugere → seleciona).
 * Para campos que vinculam outra tabela (fornecedor, cliente, produto…).
 *
 * Uso:
 *   <script src="/assets/lookup-search.js"></script>
 *   SysRepLookup.attach({
 *     input: '#f_nome',
 *     hiddenId: '#f_cod_fornecedor',
 *     url: '/api/fornecedores/lookup?todostipos=true',
 *     minChars: 2,
 *     placeholder: 'Digite nome, CNPJ ou código…',
 *     mapItem: (r) => ({ id: r.id, title: r.nome, subtitle: ... }),
 *     allowFreeText: true, // permite digitar nome sem escolher da lista
 *   });
 */
(function (global) {
  'use strict';

  const STYLE_ID = 'sysrep-lookup-style';

  function _ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
.srl-wrap{position:relative;width:100%}
.srl-list{
  position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:4000;
  max-height:280px;overflow:auto;
  background:var(--card,var(--card-bg,#fff));
  border:1.5px solid var(--card-border,#e2e8f0);
  border-radius:10px;
  box-shadow:0 12px 32px rgba(15,23,42,.16);
  display:none;
}
.srl-list.open{display:block}
.srl-item{
  padding:10px 14px;cursor:pointer;font-size:13px;
  border-bottom:1px solid var(--card-border,#f1f5f9);
  color:var(--content-text,#0f172a);
  display:flex;flex-direction:column;gap:2px;
}
.srl-item:last-child{border-bottom:none}
.srl-item:hover,.srl-item.active{background:var(--accent-soft,rgba(13,148,136,.1))}
.srl-item .srl-title{font-weight:600;line-height:1.3}
.srl-item .srl-sub{font-size:11px;color:var(--text2,#64748b);font-weight:500}
.srl-empty,.srl-loading{
  padding:12px 14px;font-size:12px;color:var(--text2,#64748b);
}
.srl-mark{background:rgba(245,158,11,.35);border-radius:2px;padding:0 1px}
.srl-clear{
  position:absolute;right:8px;top:50%;transform:translateY(-50%);
  border:none;background:transparent;color:var(--text2);cursor:pointer;
  font-size:14px;line-height:1;padding:4px 6px;border-radius:6px;
  display:none;
}
.srl-clear:hover{background:var(--content-bg);color:var(--content-text)}
.srl-wrap.has-val .srl-clear{display:block}
.srl-wrap.has-val input{padding-right:32px}
`;
    document.head.appendChild(s);
  }

  function _esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _highlight(text, q) {
    const t = String(text || '');
    const term = String(q || '').trim();
    if (!term || term.length < 2) return _esc(t);
    try {
      const re = new RegExp('(' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
      return _esc(t).replace(re, '<span class="srl-mark">$1</span>');
    } catch (_) {
      return _esc(t);
    }
  }

  function _el(ref) {
    if (!ref) return null;
    if (typeof ref === 'string') return document.querySelector(ref);
    return ref;
  }

  function _authHeaders() {
    const t = sessionStorage.getItem('token') || localStorage.getItem('token') || '';
    return t ? { Authorization: 'Bearer ' + t } : {};
  }

  /**
   * @param {object} opts
   * @returns {{ setValue, clear, destroy }}
   */
  function attach(opts) {
    _ensureStyle();
    const input = _el(opts.input);
    if (!input) throw new Error('SysRepLookup: input não encontrado');
    const hidden = _el(opts.hiddenId);
    const minChars = opts.minChars != null ? opts.minChars : 2;
    const debounceMs = opts.debounceMs != null ? opts.debounceMs : 280;
    const allowFreeText = opts.allowFreeText !== false;
    const mapItem = opts.mapItem || ((r) => ({
      id: r.id,
      title: r.nome || r.descricao || r.name || String(r.id),
      subtitle: [r.apelido, r.cpf, [r.cidade, r.uf].filter(Boolean).join('/')].filter(Boolean).join(' · '),
    }));
    const buildUrl = typeof opts.url === 'function'
      ? opts.url
      : (q) => {
          const base = String(opts.url || '');
          const sep = base.includes('?') ? '&' : '?';
          return base + sep + 'q=' + encodeURIComponent(q) + '&limit=' + (opts.limit || 20);
        };

    if (opts.placeholder) input.setAttribute('placeholder', opts.placeholder);
    input.setAttribute('autocomplete', 'off');
    input.removeAttribute('list');

    let wrap = input.closest('.srl-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'srl-wrap';
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);
    }

    let btnClear = wrap.querySelector('.srl-clear');
    if (!btnClear) {
      btnClear = document.createElement('button');
      btnClear.type = 'button';
      btnClear.className = 'srl-clear';
      btnClear.title = 'Limpar';
      btnClear.setAttribute('aria-label', 'Limpar');
      btnClear.textContent = '✕';
      wrap.appendChild(btnClear);
    }

    let list = wrap.querySelector('.srl-list');
    if (!list) {
      list = document.createElement('div');
      list.className = 'srl-list';
      list.setAttribute('role', 'listbox');
      wrap.appendChild(list);
    }

    let timer = null;
    let abort = null;
    let items = [];
    let idx = -1;
    let lastQ = '';

    function _syncClear() {
      const has = !!(input.value || (hidden && hidden.value));
      wrap.classList.toggle('has-val', has);
    }

    function _close() {
      list.classList.remove('open');
      list.innerHTML = '';
      items = [];
      idx = -1;
    }

    function _setId(id, title) {
      if (hidden) hidden.value = id != null && id !== '' ? String(id) : '';
      if (title != null) input.value = title;
      _syncClear();
      if (typeof opts.onSelect === 'function') {
        opts.onSelect({ id: hidden ? hidden.value : id, title: input.value });
      }
    }

    function _select(i) {
      const it = items[i];
      if (!it) return;
      _setId(it.id, it.title);
      _close();
    }

    function _render() {
      if (!items.length) {
        list.innerHTML = '<div class="srl-empty">Nenhum resultado</div>';
        list.classList.add('open');
        return;
      }
      list.innerHTML = items.map((it, i) => `
        <div class="srl-item${i === idx ? ' active' : ''}" role="option" data-i="${i}">
          <span class="srl-title">${_highlight(it.title, lastQ)}</span>
          ${it.subtitle ? `<span class="srl-sub">${_esc(it.subtitle)}</span>` : ''}
        </div>
      `).join('');
      list.classList.add('open');
      list.querySelectorAll('.srl-item').forEach((el) => {
        el.addEventListener('mousedown', (e) => {
          e.preventDefault();
          _select(parseInt(el.getAttribute('data-i'), 10));
        });
      });
    }

    async function _search(q) {
      const term = String(q || '').trim();
      lastQ = term;
      if (term.length < minChars) {
        _close();
        return;
      }
      if (abort) {
        try { abort.abort(); } catch (_) {}
      }
      abort = typeof AbortController !== 'undefined' ? new AbortController() : null;
      list.innerHTML = '<div class="srl-loading">Buscando…</div>';
      list.classList.add('open');
      try {
        const r = await fetch(buildUrl(term), {
          headers: _authHeaders(),
          cache: 'no-store',
          signal: abort ? abort.signal : undefined,
        });
        const data = await r.json().catch(() => []);
        if (!r.ok) throw new Error(data.error || 'Erro na busca');
        const rows = Array.isArray(data) ? data : (data.rows || data.fornecedores || data.clientes || data.data || []);
        items = rows.map(mapItem).filter((x) => x && x.title);
        idx = -1;
        _render();
      } catch (e) {
        if (e?.name === 'AbortError') return;
        list.innerHTML = `<div class="srl-empty">${_esc(e.message || 'Erro na busca')}</div>`;
        list.classList.add('open');
      }
    }

    function onInput() {
      if (hidden) hidden.value = '';
      _syncClear();
      clearTimeout(timer);
      timer = setTimeout(() => _search(input.value), debounceMs);
    }

    function onKeyDown(e) {
      if (!list.classList.contains('open') || !items.length) {
        if (e.key === 'Escape') _close();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        idx = Math.min(idx + 1, items.length - 1);
        _render();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        idx = Math.max(idx - 1, 0);
        _render();
      } else if (e.key === 'Enter') {
        if (idx >= 0) {
          e.preventDefault();
          _select(idx);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        _close();
      }
    }

    function onBlur() {
      setTimeout(() => {
        _close();
        if (!allowFreeText && hidden && !hidden.value) {
          input.value = '';
        }
        _syncClear();
      }, 180);
    }

    function onClear(e) {
      e.preventDefault();
      e.stopPropagation();
      input.value = '';
      if (hidden) hidden.value = '';
      _close();
      _syncClear();
      input.focus();
      if (typeof opts.onClear === 'function') opts.onClear();
    }

    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKeyDown);
    input.addEventListener('blur', onBlur);
    input.addEventListener('focus', () => {
      if (String(input.value || '').trim().length >= minChars && !hidden?.value) {
        _search(input.value);
      }
    });
    btnClear.addEventListener('click', onClear);
    _syncClear();

    return {
      setValue(id, title) {
        _setId(id, title);
        _close();
      },
      clear() {
        input.value = '';
        if (hidden) hidden.value = '';
        _close();
        _syncClear();
      },
      destroy() {
        input.removeEventListener('input', onInput);
        input.removeEventListener('keydown', onKeyDown);
        input.removeEventListener('blur', onBlur);
        btnClear.removeEventListener('click', onClear);
        _close();
      },
    };
  }

  global.SysRepLookup = { attach };
})(typeof window !== 'undefined' ? window : global);
