/**
 * SysRepWeb — Gerenciador de Temas Global
 * Aplica o tema em todas as páginas via localStorage
 */

const THEMES = [
  {
    id: 'dark',
    name: 'Dark Classic',
    desc: 'Tema escuro clássico',
    preview: { sidebar: '#2c2c2c', accent: '#5b8dee', content: '#ffffff' }
  },
  {
    id: 'light',
    name: 'Light Clean',
    desc: 'Limpo e moderno',
    preview: { sidebar: '#f4f5f7', accent: '#4361ee', content: '#f9fafb' }
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
  }
];

const THEME_KEY = 'sysrep_theme';

// ── Aplica o tema no documento ───────────────────────────────────
function applyTheme(themeId) {
  const valid = THEMES.find(t => t.id === themeId);
  const id = valid ? themeId : 'dark';
  document.documentElement.setAttribute('data-theme', id);
  localStorage.setItem(THEME_KEY, id);

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
  const saved = localStorage.getItem(THEME_KEY) || 'dark';
  applyTheme(saved);
  return saved;
}

// ── Renderiza o modal de seleção de temas ────────────────────────
function renderThemeModal() {
  if (document.getElementById('theme-modal')) return;

  const currentTheme = localStorage.getItem(THEME_KEY) || 'dark';

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
        ${THEMES.map(t => `
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
    .tm-panel    { position:relative;background:#fff;border-radius:16px;width:100%;max-width:680px;
                   max-height:85vh;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3);
                   display:flex;flex-direction:column;animation:tmIn .25s ease-out; }
    @keyframes tmIn { from{opacity:0;transform:scale(.92)} to{opacity:1;transform:scale(1)} }
    .tm-header   { display:flex;align-items:center;justify-content:space-between;
                   padding:18px 20px;border-bottom:1px solid #eee;background:#fff;flex-shrink:0; }
    .tm-title    { font-size:15px;font-weight:700;color:#1e2433; }
    .tm-close    { background:none;border:none;font-size:18px;color:#888;cursor:pointer;
                   width:32px;height:32px;border-radius:50%;transition:.2s;
                   display:flex;align-items:center;justify-content:center; }
    .tm-close:hover { background:#f0f0f0;color:#333; }
    .tm-grid     { display:grid;grid-template-columns:repeat(4,1fr);gap:12px;
                   padding:20px;overflow-y:auto; }
    .tm-card     { border:2px solid #eee;border-radius:12px;overflow:hidden;cursor:pointer;
                   transition:.2s;position:relative; }
    .tm-card:hover { border-color:#aaa;transform:translateY(-2px);box-shadow:0 4px 12px rgba(0,0,0,.1); }
    .tm-card.tm-active { border-color:#4361ee;box-shadow:0 0 0 3px rgba(67,97,238,.2); }
    .tm-preview  { display:flex;height:70px;overflow:hidden; }
    .tm-prev-sidebar { width:30px;flex-shrink:0;padding:8px 5px; }
    .tm-prev-content { flex:1;padding:8px; }
    .tm-info     { padding:8px 10px 6px; }
    .tm-name     { display:block;font-size:12px;font-weight:700;color:#1e2433;margin-bottom:2px; }
    .tm-desc     { display:block;font-size:10px;color:#888;line-height:1.3; }
    .tm-check    { position:absolute;top:6px;right:6px;background:#4361ee;color:#fff;
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

// ── Auto-inicializa ──────────────────────────────────────────────
(function init() {
  // Aplica tema imediatamente (antes do DOMContentLoaded para evitar flash)
  loadTheme();

  // Adiciona botão flutuante após carregar o DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderThemeButton);
  } else {
    renderThemeButton();
  }
})();

// Exporta para uso externo
window.SysTheme = { apply: applyTheme, open: openThemeModal, list: THEMES };
