/**
 * SysRepWeb — Gerenciador de Temas Global
 * Aplica o tema em todas as páginas via localStorage
 */
function _sysrepInjectMobileGuard() {
  try {
    if (window.SysRepMobile) return;
    if (document.querySelector('script[data-sysrep-mobile-route]')) return;
    var el = document.createElement('script');
    el.src = '/assets/mobile-route.js';
    el.setAttribute('data-sysrep-mobile-route', '1');
    (document.head || document.documentElement).appendChild(el);
  } catch (_) {}
}

if (window._sysThemesLoaded) {
  // Já carregado (ex: iframe recarregado no mesmo contexto) — só reaplica o tema salvo
  try { document.documentElement.setAttribute('data-theme', localStorage.getItem('sysrep_theme') || 'sistema'); } catch(_) {}
  _sysrepInjectMobileGuard();
  throw 'themes.js: skip (already loaded)';
}
window._sysThemesLoaded = true;

var THEMES = [
  {
    id: 'sistema',
    name: 'Tema Sistema',
    desc: 'Padrão NC Sistemas',
    preview: { sidebar: '#1e293b', accent: '#0ea5e9', content: '#f1f5f9' }
  },
  {
    id: 'dark',
    name: 'SysRep Dark',
    desc: 'Escuro quente e confortável',
    preview: { sidebar: '#24231f', accent: '#e46f4e', content: '#1b1a17' }
  },
  {
    id: 'light',
    name: 'SysRep Light',
    desc: 'Tema claro SysRep',
    preview: { sidebar: '#f3f3f3', accent: '#5b2d82', content: '#ffffff' }
  },
  {
    id: 'blue',
    name: 'Blue Ocean',
    desc: 'Profissional azul (Salesforce)',
    preview: { sidebar: '#0b2447', accent: '#0ea5e9', content: '#f0f6ff' }
  },
  {
    id: 'purple',
    name: 'Purple Pro',
    desc: 'Moderno roxo (Monday.com)',
    preview: { sidebar: '#2c1654', accent: '#9b59f5', content: '#faf8ff' }
  },
  {
    id: 'green',
    name: 'Green Fresh',
    desc: 'Natural verde (Freshworks)',
    preview: { sidebar: '#0a3d2e', accent: '#10b981', content: '#f0fdf8' }
  },
  {
    id: 'navy',
    name: 'Midnight Navy',
    desc: 'Elegante marinho escuro',
    preview: { sidebar: '#0f172a', accent: '#38bdf8', content: '#f8fafc' }
  },
  {
    id: 'orange',
    name: 'Orange Bold',
    desc: 'Vibrante e enérgico',
    preview: { sidebar: '#431407', accent: '#f97316', content: '#fff8f4' }
  },
  {
    id: 'rose',
    name: 'Rose Dark',
    desc: 'Elegante e sofisticado',
    preview: { sidebar: '#1c0a14', accent: '#f43f7a', content: '#fff5f8' }
  },
  {
    id: 'sgi',
    name: 'Premium',
    desc: 'Paleta exclusiva S.G.I WEB',
    preview: { sidebar: '#111111', accent: '#00f2fe', content: '#0f111a' }
  },
  {
    id: 'diamond',
    name: 'Diamond Black',
    desc: 'O ápice do design premium',
    preview: { sidebar: '#000000', accent: '#ffffff', content: '#0a0a0a' }
  },
  {
    id: 'gray',
    name: 'Gray Soft',
    desc: 'Cinza claro — neutro profissional',
    preview: { sidebar: '#4a4e5a', accent: '#4361ee', content: '#f5f6f8' }
  }
];

var THEME_KEY ='sysrep_theme';
var HIDDEN_THEME_IDS = ['purple', 'orange', 'rose', 'green', 'sgi', 'diamond'];

// ── Aplica o tema no documento ───────────────────────────────────
function applyTheme(themeId) {
  const valid = THEMES.find(t => t.id === themeId);
  const id = valid ? themeId : 'sistema';
  document.documentElement.setAttribute('data-theme', id);
  localStorage.setItem(THEME_KEY, id);
  syncThemeAccent(id);

  // Propaga para iframes
  try {
    document.querySelectorAll('iframe').forEach(fr => {
      fr.contentWindow.postMessage({ type: 'theme-changed', theme: id }, '*');
    });
  } catch(e) {}

  // Atualiza meta theme-color (mobile browser bar)
  const theme = THEMES.find(t => t.id === id);
  let metaColor = document.querySelector('meta[name="theme-color"]');
  if (!metaColor) {
    metaColor = document.createElement('meta');
    metaColor.name = 'theme-color';
    document.head.appendChild(metaColor);
  }
  metaColor.content = theme?.preview?.sidebar || '#2c2c2c';
}

// ── Lê o tema salvo e aplica imediatamente ───────────────────────
function loadTheme() {
  const saved = localStorage.getItem(THEME_KEY) || 'light';
  applyTheme(saved);
  return saved;
}

// ── Renderiza o modal de seleção de temas ────────────────────────
function renderThemeModal() {
  if (document.getElementById('theme-modal')) return;

  const currentTheme = localStorage.getItem(THEME_KEY) || 'dark';
  const visibleThemes = THEMES.filter(t => !HIDDEN_THEME_IDS.includes(t.id));

  const modal = document.createElement('div');
  modal.id = 'theme-modal';
  modal.innerHTML = `
    <div class="tm-overlay" onclick="closeThemeModal()"></div>
    <div class="tm-panel">
      <div class="tm-header">
        <span class="tm-title">
          <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="vertical-align:middle;margin-right:6px">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2
                 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486
                 8.485M7 17h.01"/>
          </svg>
          Escolher Tema
        </span>
        <button class="tm-close" onclick="closeThemeModal()">✕</button>
      </div>
      <div class="tm-grid">
        ${visibleThemes.map(t => `
          <div class="tm-card ${t.id === currentTheme ? 'tm-active' : ''}"
               onclick="selectTheme('${t.id}')" data-id="${t.id}">
            <div class="tm-preview">
              <div class="tm-prev-sidebar" style="background:${t.preview.sidebar}">
                <div style="width:10px;height:6px;background:rgba(255,255,255,.3);border-radius:2px;margin-bottom:3px"></div>
                <div style="width:10px;height:6px;background:rgba(255,255,255,.2);border-radius:2px;margin-bottom:3px"></div>
                <div style="width:10px;height:6px;background:rgba(255,255,255,.2);border-radius:2px"></div>
              </div>
              <div class="tm-prev-content" style="background:${t.preview.content}">
                <div style="height:8px;background:${t.preview.accent};border-radius:2px;margin-bottom:4px;width:70%"></div>
                <div style="height:4px;background:#e0e0e0;border-radius:2px;margin-bottom:3px;width:90%"></div>
                <div style="height:4px;background:#e0e0e0;border-radius:2px;margin-bottom:3px;width:75%"></div>
                <div style="height:4px;background:#e0e0e0;border-radius:2px;width:60%"></div>
              </div>
            </div>
            <div class="tm-info">
              <span class="tm-name">${t.name}</span>
              <span class="tm-desc">${t.desc}</span>
            </div>
            <div class="tm-check">✓</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  // Estilos do modal
  const style = document.createElement('style');
  style.textContent = `
    #theme-modal { position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px; }
    .tm-overlay  { position:fixed;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(4px); }
    .tm-panel    { position:relative;background:var(--card-bg,#fff);border:1px solid var(--border,#eee);border-radius:16px;width:100%;max-width:680px;
                   max-height:85vh;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3);
                   display:flex;flex-direction:column;animation:tmIn .25s ease-out; }
    @keyframes tmIn { from{opacity:0;transform:scale(.92)} to{opacity:1;transform:scale(1)} }
    .tm-header   { display:flex;align-items:center;justify-content:space-between;
                   padding:18px 20px;border-bottom:1px solid var(--border,#eee);background:var(--card-bg,#fff);flex-shrink:0; }
    .tm-title    { font-size:15px;font-weight:700;color:var(--text,#1e2433); }
    .tm-close    { background:none;border:none;font-size:18px;color:var(--text-secondary,#888);cursor:pointer;
                   width:32px;height:32px;border-radius:50%;transition:.2s;
                   display:flex;align-items:center;justify-content:center; }
    .tm-close:hover { background:var(--hover,#f0f0f0);color:var(--text,#333); }
    .tm-grid     { display:grid;grid-template-columns:repeat(4,1fr);gap:12px;
                   padding:20px;overflow-y:auto; }
    .tm-card     { border:2px solid var(--border,#eee);border-radius:12px;overflow:hidden;cursor:pointer;
                   transition:.2s;position:relative;background:var(--bg2,#fff); }
    .tm-card:hover { border-color:var(--accent,#aaa);transform:translateY(-2px);box-shadow:0 4px 12px rgba(0,0,0,.1); }
    .tm-card.tm-active { border-color:var(--accent,#4361ee);box-shadow:0 0 0 3px var(--accent-soft,rgba(67,97,238,.2)); }
    .tm-preview  { display:flex;height:70px;overflow:hidden; }
    .tm-prev-sidebar { width:30px;flex-shrink:0;padding:8px 5px; }
    .tm-prev-content { flex:1;padding:8px; }
    .tm-info     { padding:8px 10px 6px; }
    .tm-name     { display:block;font-size:12px;font-weight:700;color:var(--text,#1e2433);margin-bottom:2px; }
    .tm-desc     { display:block;font-size:10px;color:var(--text-secondary,#888);line-height:1.3; }
    .tm-check    { position:absolute;top:6px;right:6px;background:var(--accent,#4361ee);color:var(--accent-text,#fff);
                   width:20px;height:20px;border-radius:50%;font-size:11px;
                   display:none;align-items:center;justify-content:center;font-weight:700; }
    .tm-card.tm-active .tm-check { display:flex; }
    @media(max-width:600px) { .tm-grid{grid-template-columns:repeat(2,1fr)} }
  `;
  document.head.appendChild(style);
  document.body.appendChild(modal);
}

function selectTheme(id) {
  applyTheme(id);

  // Atualiza visual do modal
  document.querySelectorAll('.tm-card').forEach(c => {
    c.classList.toggle('tm-active', c.dataset.id === id);
  });

  // Persiste tema no banco — só se o usuário já tem prefs de fonte salvas (evita gravar defaults vazios)
  const p = JSON.parse(localStorage.getItem(FONT_KEY)   || 'null');
  const v = JSON.parse(localStorage.getItem(VISUAL_KEY) || 'null');
  if ((p || v) && !_isLoginPage()) {
    fetch('/api/user-prefs', {
      method: 'PUT',
      headers: _authHeaders(),
      credentials: 'include',
      body: JSON.stringify({ font_family: (p||{}).familyId || 'inter', font_size: (p||{}).sizeId || 'md', accent: (v||{}).accentId || 'blue', compact: (v||{}).compact ? 1 : 0, tema: id })
    }).catch(() => {});
  }

  // Fecha após breve delay
  setTimeout(closeThemeModal, 300);
}

function openThemeModal() {
  renderThemeModal();
}

function closeThemeModal() {
  const modal = document.getElementById('theme-modal');
  if (modal) modal.remove();
}

// ── Renderiza botão flutuante de tema (para todas as páginas) ────
function renderThemeButton() {
  if (document.getElementById('theme-fab')) return;

  const fab = document.createElement('button');
  fab.id = 'theme-fab';
  fab.title = 'Mudar Tema';
  fab.innerHTML = `<svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
      d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2
         0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829
         2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"/>
  </svg>`;
  fab.onclick = openThemeModal;

  const style = document.createElement('style');
  style.textContent = `
    #theme-fab {
      position:fixed;bottom:52px;right:16px;z-index:1000;
      width:40px;height:40px;border-radius:50%;
      background:var(--accent,#4361ee);color:#fff;
      border:none;cursor:pointer;
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 4px 12px rgba(0,0,0,.3);
      transition:.2s;
      opacity:.85;
    }
    #theme-fab:hover { opacity:1;transform:scale(1.1); }
  `;
  document.head.appendChild(style);
  document.body.appendChild(fab);
}

// ══════════════════════════════════════════════════════════════════
// SISTEMA DE PREFERÊNCIA DE FONTE
// ══════════════════════════════════════════════════════════════════

var FONT_KEY = 'sysrep_font_pref';
var VISUAL_KEY = 'sysrep_visual_pref';

var FONT_FAMILIES = [
  { id:'dmsans',   name:'DM Sans',       value:"'DM Sans', sans-serif",          desc:'Elegante · SGI', spacing: '-0.02em' },
  { id:'roboto',   name:'Roboto',        value:"'Roboto', sans-serif",          desc:'Google Sans Clean', spacing: '-0.01em' },
  { id:'inter',    name:'Inter',         value:"'Inter', sans-serif",           desc:'Moderna · Padrão', spacing: '-0.02em' },
  { id:'opensans', name:'Open Sans',     value:"'Open Sans', sans-serif",       desc:'Google Sans Soft', spacing: '-0.01em' },
  { id:'poppins',  name:'Poppins',       value:"'Poppins', sans-serif",         desc:'Geométrica', spacing: '0' },
  { id:'montserrat',name:'Montserrat',   value:"'Montserrat', sans-serif",      desc:'Elegante', spacing: '0' },
  { id:'system',   name:'Sistema',       value:"system-ui, sans-serif",         desc:'Nativa do SO', spacing: '0' }
];

var FONT_SIZES = [
  { id:'sm', label:'Pequena', px: 11 },
  { id:'md', label:'Média',   px: 13 },
  { id:'lg', label:'Grande',  px: 15 },
  { id:'xl', label:'Extra',   px: 18 }
];

var ACCENT_COLORS = [
  { id: 'blue',   name: 'Padrão',   value: '#4361ee' },
  { id: 'emerald',name: 'Esmeralda',value: '#10b981' },
  { id: 'indigo', name: 'Índigo',   value: '#6366f1' },
  { id: 'amber',  name: 'Âmbar',    value: '#f59e0b' },
  { id: 'rose',   name: 'Rose',     value: '#f43f7a' },
  { id: 'slate',  name: 'Slate',    value: '#475569' }
];

function applyFont(familyId, sizeId) {
  const fam = FONT_FAMILIES.find(f => f.id === familyId) || FONT_FAMILIES[0];
  const size = FONT_SIZES.find(s => s.id === sizeId) || FONT_SIZES[1];
  
  if (['roboto', 'opensans', 'poppins', 'montserrat', 'dmsans'].includes(familyId)) {
    const linkId = 'google-font-' + familyId;
    if (!document.getElementById(linkId)) {
      const link = document.createElement('link');
      link.id = linkId;
      link.rel = 'stylesheet';
      const fontName = fam.value.split(',')[0].replace(/'/g, '').replace(/ /g, '+');
      link.href = `https://fonts.googleapis.com/css2?family=${fontName}:wght@400;500;700&display=swap`;
      document.head.appendChild(link);
    }
  }

  let el = document.getElementById('sysrep-font-style');
  if (!el) { el = document.createElement('style'); el.id = 'sysrep-font-style'; document.head.appendChild(el); }
  el.textContent = `
    :root {
      --font: ${fam.value};
      --base-font-size: ${size.px}px;
      --letter-spacing: ${fam.spacing || '0'};
      --home-nav-font-size: calc(var(--base-font-size) * 1.12);
      --home-menu-title-font-size: calc(var(--base-font-size) * 1.18);
      --home-menu-group-font-size: calc(var(--base-font-size) * .9);
      --home-menu-item-font-size: calc(var(--base-font-size) * 1.18);
      --home-menu-meta-font-size: calc(var(--base-font-size) * .85);
      --sys-tab-font-size: var(--base-font-size);
      --sys-tab-badge-font-size: calc(var(--base-font-size) * .82);
    }
    body, html {
      font-family: ${fam.value} !important;
      font-size: var(--base-font-size) !important;
      letter-spacing: var(--letter-spacing) !important;
    }
    /* Tabelas e células em «em» para herdarem o tamanho da página (evita texto fixo em px) */
    table, .base-table {
      font-family: ${fam.value} !important;
      font-size: 1em !important;
      letter-spacing: var(--letter-spacing) !important;
    }
    td, th, .base-table td, .base-table th,
    input, select, textarea, .mc-val, .toolbar-title {
      font-family: ${fam.value} !important;
      font-size: 1em !important;
      letter-spacing: var(--letter-spacing) !important;
    }
    /* Home desktop: menu, grupos e subgrupos também seguem o botão Fonte */
    .navstrip, .nav-dropdown, .nav-accordion,
    .nav-btn, .drop-mod-title, .drop-search-input,
    .drop-group-header-label, .drop-group-badge, .drop-item,
    .nav-acc-section, .nav-acc-item,
    #tab-bar, #tab-bar .tab, #tab-bar .tab-label, #tab-bar .tab-x,
    .tabs-bar, .tabs-bar-wrap, .tab-btn, .tab-label, .tab-badge,
    .form-tabs, .form-tab, .filter-tabs, .filter-tab,
    .section-tabs, .section-tab, .tab-link, .acc-header {
      font-family: ${fam.value} !important;
      letter-spacing: var(--letter-spacing) !important;
    }
    .nav-btn {
      font-size: var(--home-nav-font-size) !important;
    }
    .drop-mod-title {
      font-size: var(--home-menu-title-font-size) !important;
    }
    .drop-search-input {
      font-size: var(--base-font-size) !important;
    }
    .drop-group-header-label,
    .nav-acc-section {
      font-size: var(--home-menu-group-font-size) !important;
    }
    .drop-group-badge,
    .drop-mod-count {
      font-size: var(--home-menu-meta-font-size) !important;
    }
    .drop-item,
    .nav-acc-item {
      font-size: var(--home-menu-item-font-size) !important;
    }
    /* Abas abertas no topo e abas internas dos formulários seguem o tamanho selecionado */
    #tab-bar .tab,
    #tab-bar .tab-label,
    .tab-btn,
    .form-tab,
    .filter-tab,
    .section-tab,
    .tab-link,
    .acc-header {
      font-size: var(--sys-tab-font-size) !important;
    }
    .tab-badge {
      font-size: var(--sys-tab-badge-font-size) !important;
    }
  `;
}

function applyVisualPrefs(accentId, compact) {
  const color = ACCENT_COLORS.find(c => c.id === accentId) || ACCENT_COLORS[0];
  document.documentElement.style.setProperty('--accent', color.value);
  document.documentElement.style.setProperty('--accent-soft', color.value + '26');
  const applyCompact = () => document.body?.classList.toggle('sys-compact', !!compact);
  if (document.body) applyCompact();
  else document.addEventListener('DOMContentLoaded', applyCompact, { once: true });
  
  // Salva no storage para persistir
  localStorage.setItem(VISUAL_KEY, JSON.stringify({ accentId, compact }));
}

function clearVisualAccentOverride() {
  document.documentElement.style.removeProperty('--accent');
  document.documentElement.style.removeProperty('--accent-soft');
}

function syncThemeAccent(themeId) {
  try {
    const v = JSON.parse(localStorage.getItem(VISUAL_KEY) || 'null');
    const isDefaultVisual = !v || ((v.accentId || 'blue') === 'blue' && !v.compact);
    if ((themeId === 'dark' || themeId === 'light') && isDefaultVisual) clearVisualAccentOverride();
  } catch (_) {}
}

function loadFont() {
  try {
    const p = JSON.parse(localStorage.getItem(FONT_KEY) || '{}');
    applyFont(p.familyId || 'roboto', p.sizeId || 'md');

    const rawVisual = localStorage.getItem(VISUAL_KEY);
    if (rawVisual) {
      const v = JSON.parse(rawVisual || '{}');
      const themeId = localStorage.getItem(THEME_KEY) || 'sistema';
      const isDefaultVisual = (v.accentId || 'blue') === 'blue' && !v.compact;
      if ((themeId === 'dark' || themeId === 'light') && isDefaultVisual) {
        clearVisualAccentOverride();
        const removeCompact = () => document.body?.classList.remove('sys-compact');
        if (document.body) removeCompact();
        else document.addEventListener('DOMContentLoaded', removeCompact, { once: true });
      } else {
        applyVisualPrefs(v.accentId || 'blue', v.compact || false);
      }
    } else {
      const removeCompact = () => document.body?.classList.remove('sys-compact');
      if (document.body) removeCompact();
      else document.addEventListener('DOMContentLoaded', removeCompact, { once: true });
    }
  } catch(e) { applyFont('inter','md'); }
}

function savePrefs(familyId, sizeId, accentId, compact) {
  localStorage.setItem(FONT_KEY, JSON.stringify({ familyId, sizeId }));
  localStorage.setItem(VISUAL_KEY, JSON.stringify({ accentId, compact }));
  applyFont(familyId, sizeId);
  applyVisualPrefs(accentId, compact);
  try { window.parent.postMessage({ type: 'font-pref-changed', familyId, sizeId, accentId, compact }, '*'); } catch(_) {}
  // Persiste no banco vinculado ao usuário logado (fire-and-forget)
  if (!_isLoginPage()) {
    const tema = localStorage.getItem(THEME_KEY) || 'sistema';
    fetch('/api/user-prefs', {
      method: 'PUT',
      headers: _authHeaders(),
      credentials: 'include',
      body: JSON.stringify({ font_family: familyId, font_size: sizeId, accent: accentId, compact: compact ? 1 : 0, tema })
    }).catch(() => {});
  }
}

function _isLoginPage() {
  return window.location.pathname.replace(/\/+$/, '').endsWith('login.html') ||
         window.location.pathname === '/login';
}

function _authHeaders(extra) {
  const token = localStorage.getItem('token') || sessionStorage.getItem('token');
  const h = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
  if (token) h['Authorization'] = 'Bearer ' + token;
  return h;
}

function loadPrefsFromServer() {
  if (_isLoginPage()) return;
  fetch('/api/user-prefs', { credentials: 'include', headers: _authHeaders({}) })
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (!data || !data.font_family) return;
      // Só restaura do servidor quando o cache foi limpo (localStorage vazio)
      // Se já existem valores locais, eles têm prioridade — foram definidos pelo usuário nesta sessão
      const hasFont   = !!localStorage.getItem(FONT_KEY);
      const hasVisual = !!localStorage.getItem(VISUAL_KEY);
      const hasTheme  = !!localStorage.getItem(THEME_KEY);
      if (!hasFont) {
        localStorage.setItem(FONT_KEY, JSON.stringify({ familyId: data.font_family, sizeId: data.font_size }));
        applyFont(data.font_family, data.font_size);
      }
      if (!hasVisual) {
        localStorage.setItem(VISUAL_KEY, JSON.stringify({ accentId: data.accent, compact: data.compact ? true : false }));
        applyVisualPrefs(data.accent, data.compact ? true : false);
      }
      if (!hasTheme && data.tema) {
        localStorage.setItem(THEME_KEY, data.tema);
        applyTheme(data.tema);
      }
    })
    .catch(() => {});
}

function renderFontModal() {
  if (document.getElementById('font-modal')) return;
  const pref = JSON.parse(localStorage.getItem(FONT_KEY) || '{}');
  const vis  = JSON.parse(localStorage.getItem(VISUAL_KEY) || '{}');
  const curFam  = pref.familyId || 'roboto';
  const curSize = pref.sizeId   || 'md';
  const curAccent = vis.accentId || 'blue';
  const curCompact = vis.compact || false;

  const modal = document.createElement('div');
  modal.id = 'font-modal';
  modal.innerHTML = `
    <div class="fm-overlay" onclick="closeFontModal()"></div>
    <div class="fm-panel">
      <div class="fm-header">
        <span class="fm-title">Personalização Visual</span>
        <button class="fm-close" onclick="closeFontModal()">✕</button>
      </div>
      <div class="fm-body">
        <p class="fm-section-label">Fonte do Sistema</p>
        <div class="fm-fam-grid">
          ${FONT_FAMILIES.map(f => `
            <div class="fm-fam-card ${f.id === curFam ? 'fm-active' : ''}" onclick="fmSelectFam('${f.id}')" data-fam="${f.id}">
              <span class="fm-fam-name" style="font-family:${f.value}">${f.name}</span>
              <span class="fm-fam-desc">${f.desc}</span>
            </div>`).join('')}
        </div>
        
        <p class="fm-section-label" style="margin-top:18px">Tamanho & Densidade</p>
        <div class="fm-size-row">
          ${FONT_SIZES.map(s => `
            <button class="fm-size-btn ${s.id === curSize ? 'fm-sz-active' : ''}" onclick="fmSelectSize('${s.id}')" data-sz="${s.id}">
              ${s.label}
            </button>`).join('')}
        </div>
        
        <div style="margin-top:12px; display:flex; align-items:center; gap:10px; padding:10px; background:var(--bg2,#f8fafc); border-radius:10px; border:1px dashed var(--border,#cbd5e1)">
          <input type="checkbox" id="chk-compact" ${curCompact ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--accent,#4361ee)">
          <label for="chk-compact" style="font-size:12px; font-weight:700; color:var(--text,#334155); cursor:pointer">Modo Compacto (Reduzir espaçamentos)</label>
        </div>

        <p class="fm-section-label" style="margin-top:18px">Cor de Destaque</p>
        <div class="fm-color-row" style="display:flex; gap:8px; flex-wrap:wrap">
          ${ACCENT_COLORS.map(c => `
            <div class="fm-color-dot ${c.id === curAccent ? 'active' : ''}" 
                 onclick="fmSelectAccent('${c.id}')" 
                 data-accent="${c.id}"
                 style="background:${c.value}; width:32px; height:32px; border-radius:50%; cursor:pointer; border:3px solid var(--card-bg,#fff); box-shadow:0 0 0 1px var(--border,#eee)"
                 title="${c.name}"></div>
          `).join('')}
        </div>
      </div>
      <div class="fm-footer">
        <button class="fm-btn-cancel" onclick="closeFontModal()">Cancelar</button>
        <button class="fm-btn-save" onclick="fmSave()">Aplicar Agora</button>
      </div>
    </div>`;

  const style = document.createElement('style');
  style.setAttribute('data-fm', 'true');
  style.textContent = `
    #font-modal{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px}
    .fm-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(3px)}
    .fm-panel{position:relative;background:var(--card-bg,#fff);border:1px solid var(--border,#eee);border-radius:16px;width:100%;max-width:480px;box-shadow:0 20px 60px rgba(0,0,0,.28);display:flex;flex-direction:column;animation:fmIn .22s ease-out}
    @keyframes fmIn{from{opacity:0;transform:scale(.93)}to{opacity:1;transform:scale(1)}}
    .fm-header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border,#eee)}
    .fm-title{font-size:14px;font-weight:700;color:var(--text,#1e2433)}
    .fm-close{background:none;border:none;font-size:16px;color:var(--text-secondary,#888);cursor:pointer;width:28px;height:28px;border-radius:50%;transition:.2s;display:flex;align-items:center;justify-content:center}
    .fm-close:hover{background:var(--hover,#f0f0f0);color:var(--text,#333)}
    .fm-body{padding:18px 20px; max-height:70vh; overflow-y:auto}
    .fm-section-label{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:var(--text-secondary,#888);margin-bottom:10px}
    .fm-fam-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
    .fm-fam-card{border:2px solid var(--border,#eee);border-radius:10px;padding:10px 12px;cursor:pointer;transition:.15s;background:var(--bg2,#fff)}
    .fm-fam-card:hover{border-color:var(--accent,#aaa)}
    .fm-fam-card.fm-active{border-color:var(--accent,#4361ee);background:var(--accent-soft,#f0f4ff)}
    .fm-fam-name{display:block;font-size:14px;font-weight:700;color:var(--text,#1e2433);margin-bottom:1px}
    .fm-fam-desc{display:block;font-size:9px;color:var(--text-secondary,#888)}
    .fm-size-row{display:flex;gap:8px}
    .fm-size-btn{flex:1;border:2px solid var(--border,#eee);border-radius:8px;padding:8px 4px;cursor:pointer;background:var(--input-bg,#fff);font-size:12px;font-weight:700;color:var(--text,#333);transition:.15s}
    .fm-size-btn.fm-sz-active{border-color:var(--accent,#4361ee);background:var(--accent-soft,#f0f4ff);color:var(--accent,#4361ee)}
    .fm-color-dot.active{box-shadow:0 0 0 2px var(--accent,#4361ee) !important}
    .fm-footer{display:flex;justify-content:flex-end;gap:8px;padding:14px 20px;border-top:1px solid var(--border,#eee)}
    .fm-btn-cancel{background:var(--hover,#f3f4f6);border:none;border-radius:8px;padding:9px 18px;font-size:13px;font-weight:600;cursor:pointer;color:var(--text-secondary,#555)}
    .fm-btn-save{background:var(--accent,#4361ee);border:none;border-radius:8px;padding:9px 20px;font-size:13px;font-weight:700;cursor:pointer;color:var(--btn-text,#fff)}
  `;
  document.head.appendChild(style);
  document.body.appendChild(modal);
}

var _fmFam  = null;
var _fmSize = null;
var _fmAccent = null;

function fmSelectFam(id) {
  _fmFam = id;
  document.querySelectorAll('.fm-fam-card').forEach(c => c.classList.toggle('fm-active', c.dataset.fam === id));
}
function fmSelectSize(id) {
  _fmSize = id;
  document.querySelectorAll('.fm-size-btn').forEach(b => b.classList.toggle('fm-sz-active', b.dataset.sz === id));
}
function fmSelectAccent(id) {
  _fmAccent = id;
  document.querySelectorAll('.fm-color-dot').forEach(d => d.classList.toggle('active', d.dataset.accent === id));
}
function fmSave() {
  const p = JSON.parse(localStorage.getItem(FONT_KEY) || '{}');
  const v = JSON.parse(localStorage.getItem(VISUAL_KEY) || '{}');
  const fam = _fmFam || p.familyId || 'roboto';
  const size = _fmSize || p.sizeId || 'md';
  const accent = _fmAccent || v.accentId || 'blue';
  const compact = document.getElementById('chk-compact').checked;
  savePrefs(fam, size, accent, compact);
  closeFontModal();
}
function openFontModal() {
  _fmFam = null; _fmSize = null; _fmAccent = null;
  renderFontModal();
}
function closeFontModal() {
  const m = document.getElementById('font-modal');
  if (m) m.remove();
  const s = document.querySelector('style[data-fm]');
  if (s) s.remove();
}

(function init() {
  loadTheme();
  loadFont();
  _sysrepInjectMobileGuard();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => document.getElementById('theme-fab')?.remove());
  } else { document.getElementById('theme-fab')?.remove(); }
  // Carrega preferências do servidor (só na janela principal, não em iframes)
  if (window === window.top) loadPrefsFromServer();
})();

window.addEventListener('message', (ev) => {
  if (!ev.data) return;
  if (ev.data.type === 'theme-changed') {
    applyTheme(ev.data.theme);
  }
  if (ev.data.type === 'font-pref-changed') {
    applyFont(ev.data.familyId, ev.data.sizeId);
    applyVisualPrefs(ev.data.accentId, ev.data.compact);
  }
});

window.SysTheme = { apply: applyTheme, open: openThemeModal, list: THEMES };
window.SysFont  = { apply: applyFont, save: savePrefs, open: openFontModal, families: FONT_FAMILIES, sizes: FONT_SIZES };
window.SysVisual = { apply: applyVisualPrefs };

// Carrega utilitário de transições de página (não-bloqueante, apenas uma vez por contexto)
(function () {
  try {
    if (window.PageTransitions) return;
    var s = document.createElement('script');
    s.src = '/assets/page-transitions.js';
    s.defer = true;
    (document.head || document.documentElement).appendChild(s);
  } catch (_) {}
})();
