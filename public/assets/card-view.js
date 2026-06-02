/* ============================================================
   CARD VIEW — módulo plugável
   ============================================================
   Como usar (mínimo):

     CardView.attach({
       toolbar: '.toolbar-bar',         // onde injetar o botão toggle
       tableWrap: '.table-wrap',        // wrapper da tabela existente
       container: '.table-card',        // onde colocar o grid de cards
       wrap: 'renderLista',             // nome da função global a interceptar
       card: (row) => ({
         title:    row.nome,
         subtitle: row.apelido,
         avatar:   row.nome,            // string p/ inicial+cor
         badge:    row.status === 'A'
                     ? { label:'Ativo',    tone:'success' }
                     : { label:'Inativo',  tone:'neutral' },
         rows: [
           { icon: 'phone', text: row.telefone },
           { icon: 'map',   text: row.cidade   }
         ],
         onClick: () => abrirEditar(row.id),
         actions: [
           { label:'Excluir', icon:'trash', onClick: () => excluir(row.id) }
         ]
       })
     });

   O módulo:
   - Insere botão (tabela | cards) na toolbar
   - Cria <div class="cv-cards-grid"> dentro do container
   - Intercepta a função global indicada em `wrap` — quando o modo
     é 'cards', renderiza o grid; quando é 'table', delega ao
     comportamento original. Mostra/esconde tableWrap automaticamente.
   - Persiste a preferência do usuário em localStorage por página
   ============================================================ */
(function (global) {
  'use strict';

  // ─── Ícones SVG inline ─────────────────────────────────────
  const ICONS = {
    table: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>',
    cards: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
    phone:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
    map:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    doc:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    money:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
    bank: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/></svg>',
    box:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
    tag:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    truck:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>',
    calendar:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    trash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    dots: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>',
    inbox:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>'
  };

  function escHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  function initialOf(str) {
    const s = String(str || '').trim();
    if (!s) return '?';
    return s[0].toUpperCase();
  }

  function avatarClassFor(str) {
    const c = initialOf(str);
    if (/[A-Z]/.test(c)) return 'cv-av-' + c;
    if (/[0-9]/.test(c)) return 'cv-av-NUM';
    return 'cv-av-A';
  }

  function iconHtml(name) {
    return ICONS[name] || '';
  }

  // ─── Render do grid ────────────────────────────────────────
  function renderCards(opts, rows) {
    const grid = opts._grid;
    if (!grid) return;
    if (!rows || !rows.length) {
      grid.innerHTML = `<div class="cv-empty">
        ${iconHtml('inbox')}
        <div>Nenhum registro encontrado</div>
      </div>`;
      return;
    }
    grid.innerHTML = rows.map(row => {
      let def;
      try { def = opts.card(row) || {}; }
      catch (e) { console.error('[CardView] erro em card():', e); def = {}; }

      const title    = def.title    != null ? def.title    : '';
      const subtitle = def.subtitle != null ? def.subtitle : '';
      const avatarStr = def.avatar != null ? def.avatar : title;
      const avInit    = initialOf(avatarStr);
      const avCls     = avatarClassFor(avatarStr);
      const isNew     = !!def.isNew;
      const isSel     = !!def.selected;

      const head = `
        <div class="cv-card-head">
          <div class="cv-avatar ${avCls}">${escHtml(avInit)}</div>
          <div class="cv-card-head-text">
            <div class="cv-card-title">
              <span>${escHtml(title)}</span>
              ${isNew ? '<span class="cv-badge-new">novo</span>' : ''}
            </div>
            ${subtitle ? `<div class="cv-card-sub">${escHtml(subtitle)}</div>` : ''}
          </div>
        </div>`;

      const bodyRows = (def.rows || []).filter(r => r && r.text != null && r.text !== '').map(r => `
        <div class="cv-card-row">
          ${r.icon ? iconHtml(r.icon) : ''}
          <span class="cv-val">${escHtml(r.text)}</span>
        </div>`).join('');
      const body = bodyRows ? `<div class="cv-card-body">${bodyRows}</div>` : '';

      const badge = def.badge
        ? `<span class="cv-badge cv-badge-${def.badge.tone || 'neutral'}">${escHtml(def.badge.label || '')}</span>`
        : '';
      const extras = (def.badges || []).map(b => 
        `<span class="cv-badge cv-badge-${b.tone || 'neutral'}">${escHtml(b.label || '')}</span>`
      ).join('');

      const acts = (def.actions || []).map((a, i) =>
        `<button class="cv-card-action" data-act="${i}" title="${escHtml(a.label || '')}">${iconHtml(a.icon || 'dots')}</button>`
      ).join('');

      const foot = (badge || extras || acts) ? `
        <div class="cv-card-foot">
          <div class="cv-card-foot-left">${badge}${extras}</div>
          <div class="cv-card-foot-right">${acts}</div>
        </div>` : '';

      return `<div class="cv-card ${isSel ? 'cv-selected' : ''}" data-cv-row>${head}${body}${foot}</div>`;
    }).join('');

    // Hook clicks
    Array.from(grid.querySelectorAll('.cv-card')).forEach((el, i) => {
      const row = rows[i];
      let def;
      try { def = opts.card(row) || {}; } catch (e) { def = {}; }
      if (def.onClick) {
        el.addEventListener('click', (e) => {
          if (e.target.closest('.cv-card-action')) return;
          def.onClick(row, e);
        });
      }
      el.querySelectorAll('.cv-card-action').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.dataset.act, 10);
          const act = (def.actions || [])[idx];
          if (act && act.onClick) act.onClick(row, e);
        });
      });
    });
  }

  // ─── Aplicar modo ──────────────────────────────────────────
  function applyMode(opts) {
    const isCards = opts._mode === 'cards';
    const tw  = document.querySelector(opts.tableWrap);
    if (tw)  tw.style.display  = isCards ? 'none' : '';
    if (opts._grid) opts._grid.style.display = isCards ? '' : 'none';
    const [btnT, btnC] = opts._btns || [];
    if (btnT) btnT.classList.toggle('active', !isCards);
    if (btnC) btnC.classList.toggle('active', isCards);
  }

  // ─── attach ────────────────────────────────────────────────
  function attach(opts) {
    if (!opts || !opts.toolbar || !opts.tableWrap || !opts.container ||
        !opts.wrap || typeof opts.card !== 'function') {
      console.error('[CardView] attach: faltam opções obrigatórias');
      return;
    }
    const tb = document.querySelector(opts.toolbar);
    const tw = document.querySelector(opts.tableWrap);
    const ct = document.querySelector(opts.container);
    if (!tb || !tw || !ct) {
      console.error('[CardView] attach: seletor não encontrado', { tb: !!tb, tw: !!tw, ct: !!ct });
      return;
    }

    // 1) Criar grid de cards dentro do container
    const grid = document.createElement('div');
    grid.className = 'cv-cards-grid';
    grid.style.display = 'none';
    ct.appendChild(grid);
    opts._grid = grid;

    // 2) Criar botão toggle e adicionar à toolbar
    const wrap = document.createElement('div');
    wrap.className = 'cv-view-toggle';
    wrap.innerHTML = `
      <button class="cv-vt-btn active" type="button" title="Tabela">${iconHtml('table')}</button>
      <button class="cv-vt-btn" type="button" title="Cards">${iconHtml('cards')}</button>`;
    tb.appendChild(wrap);
    const [btnT, btnC] = wrap.querySelectorAll('button');
    opts._btns = [btnT, btnC];

    // 3) Estado inicial (lembra do último modo desta página)
    const storeKey = 'cv-mode:' + location.pathname;
    opts._mode = localStorage.getItem(storeKey) || 'table';
    applyMode(opts);

    btnT.addEventListener('click', () => {
      if (opts._mode === 'table') return;
      opts._mode = 'table';
      localStorage.setItem(storeKey, 'table');
      applyMode(opts);
      // força re-render no modo tabela usando o último dataset
      if (opts._lastRows) callOriginal();
    });
    btnC.addEventListener('click', () => {
      if (opts._mode === 'cards') return;
      opts._mode = 'cards';
      localStorage.setItem(storeKey, 'cards');
      applyMode(opts);
      if (opts._lastRows) renderCards(opts, opts._lastRows);
    });

    // 4) Interceptar função global indicada em `wrap`
    const fname = opts.wrap;
    let original = global[fname];
    function callOriginal() {
      if (typeof original === 'function' && opts._lastRows) {
        original.apply(null, opts._lastArgs || [opts._lastRows]);
      }
    }
    function wrapped() {
      // 1º arg é o array de linhas em todas as páginas conhecidas
      opts._lastArgs = Array.from(arguments);
      opts._lastRows = arguments[0];
      if (opts._mode === 'cards') {
        renderCards(opts, opts._lastRows);
        // ainda assim chamamos a original p/ não quebrar lógicas paralelas
        // (paginação, contadores etc.) — mas só se houver dados
        if (typeof original === 'function') {
          try { original.apply(null, opts._lastArgs); } catch (e) {}
        }
      } else if (typeof original === 'function') {
        original.apply(null, opts._lastArgs);
      }
    }

    if (typeof original !== 'function') {
      // ainda não está definida: esperamos próxima tick
      const tries = 40;
      let n = 0;
      const iv = setInterval(() => {
        if (typeof global[fname] === 'function') {
          original = global[fname];
          global[fname] = wrapped;
          clearInterval(iv);
        } else if (++n > tries) {
          clearInterval(iv);
          console.warn('[CardView] função', fname, 'não encontrada — wrap não aplicado');
        }
      }, 50);
    } else {
      global[fname] = wrapped;
    }
  }

  // ─── API pública ───────────────────────────────────────────
  global.CardView = {
    attach,
    icons: ICONS,
    // helper que páginas podem usar p/ ler o modo atual:
    mode: () => localStorage.getItem('cv-mode:' + location.pathname) || 'table'
  };
})(window);
