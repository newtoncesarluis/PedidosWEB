/**
 * Editor simples da observação do pedido (negrito / itálico / sublinhado / cor).
 * Espelha config/obs-pedido-html.js no browser + UI contenteditable.
 */
(function (root) {
  const TAG_OK = /^(B|STRONG|I|EM|U|SPAN|BR|DIV|P|FONT)$/;

  function _somenteCorStyle(styleVal) {
    const raw = String(styleVal || '');
    const m = raw.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
    if (!m) return '';
    const cor = String(m[1] || '').trim().slice(0, 40);
    if (!cor || /expression|url\s*\(|javascript/i.test(cor)) return '';
    return `color:${cor}`;
  }

  function sanitizeObsPedidoHtml(input) {
    if (input == null) return '';
    let s = String(input);
    if (!s.trim()) return '';
    if (!/<[a-z]/i.test(s)) return s;

    if (typeof DOMParser === 'undefined') {
      return s
        .replace(/<(script|iframe|object|embed|link|style|meta|base)[\s\S]*?<\/\1>/gi, '')
        .replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    }

    const doc = new DOMParser().parseFromString(
      `<div id="__obs_root">${s
        .replace(/<(script|iframe|object|embed|link|style|meta|base)[\s\S]*?<\/\1>/gi, '')
        .replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')}</div>`,
      'text/html'
    );
    const wrap = doc.getElementById('__obs_root');
    if (!wrap) return '';

    function scrub(el) {
      Array.from(el.childNodes).forEach((child) => {
        if (child.nodeType === 3) return;
        if (child.nodeType !== 1) {
          child.remove();
          return;
        }
        const tag = child.tagName;
        if (!TAG_OK.test(tag)) {
          while (child.firstChild) el.insertBefore(child.firstChild, child);
          child.remove();
          return;
        }
        const styleBefore = child.getAttribute('style') || '';
        const colorAttr = child.getAttribute('color') || '';
        Array.from(child.attributes).forEach((a) => child.removeAttribute(a.name));
        if (tag === 'SPAN' || tag === 'FONT' || tag === 'P' || tag === 'DIV') {
          let cor = _somenteCorStyle(styleBefore);
          if (!cor && colorAttr) {
            const c = String(colorAttr).trim().slice(0, 40);
            if (c && !/expression|url\s*\(|javascript/i.test(c)) cor = `color:${c}`;
          }
          if (cor) child.setAttribute('style', cor);
        }
        scrub(child);
      });
    }
    scrub(wrap);
    return wrap.innerHTML.trim();
  }

  function obsPedidoTemHtml(s) {
    return /<\s*(b|strong|i|em|u|span|br|div|p|font)\b/i.test(String(s || ''));
  }

  function plainToEditorHtml(text) {
    const t = String(text || '');
    if (!t) return '';
    if (obsPedidoTemHtml(t)) return sanitizeObsPedidoHtml(t);
    return t
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
  }

  function htmlToPlain(html) {
    return String(html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(div|p)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\n+|\n+$/g, '');
  }

  function editorHtmlToValue(html) {
    const clean = sanitizeObsPedidoHtml(html);
    const hasFormat = /<(b|strong|i|em|u|span|font)\b/i.test(clean);
    if (!hasFormat) return htmlToPlain(clean);
    const plain = htmlToPlain(clean);
    return plain ? clean : '';
  }

  function toPrintHtml(obs, obsCSS, escapeFn) {
    const esc = typeof escapeFn === 'function'
      ? escapeFn
      : ((x) => String(x || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
    const raw = String(obs || '');
    if (!raw.trim()) return '';
    if (root.ObsPedidoEditor && root.ObsPedidoEditor.maiuscula) obsCSS = `${obsCSS || ''};text-transform:uppercase`;
    if (!obsPedidoTemHtml(raw)) {
      return raw.split('\n').map((ln) => `<div style="${obsCSS || ''}">${esc(ln)}</div>`).join('');
    }
    return `<div class="obs-rich" style="${obsCSS || ''}">${sanitizeObsPedidoHtml(raw)}</div>`;
  }

  function syncHidden(ta, editor) {
    if (!ta || !editor) return;
    ta.value = editorHtmlToValue(editor.innerHTML);
  }

  function setEditorFromValue(editor, ta, value) {
    if (!editor) return;
    const v = value == null ? '' : String(value);
    editor.innerHTML = plainToEditorHtml(v);
    if (ta) ta.value = editorHtmlToValue(editor.innerHTML) || (obsPedidoTemHtml(v) ? sanitizeObsPedidoHtml(v) : v);
  }

  function cmd(command, value) {
    try { document.execCommand(command, false, value || null); } catch (_) {}
  }

  /** Minúsculas + inicial maiúscula no começo de cada frase/linha, preservando a formatação. */
  function sentenceCaseEditor(editor) {
    let cap = true;
    const w = document.createTreeWalker(editor, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (n.nodeType === 1) {
        if (/^(BR|DIV|P|LI)$/.test(n.tagName)) cap = true;
        continue;
      }
      const src = n.nodeValue.toLowerCase();
      let out = '';
      for (const ch of src) {
        if (cap && /\p{L}/u.test(ch)) { out += ch.toUpperCase(); cap = false; }
        else {
          out += ch;
          if (/[.!?:]/.test(ch)) cap = true;
          else if (/\p{L}|\d/u.test(ch)) cap = false;
        }
      }
      n.nodeValue = out;
    }
  }

  function mount(opts) {
    opts = opts || {};
    const ta = typeof opts.textarea === 'string' ? document.getElementById(opts.textarea) : opts.textarea;
    const host = typeof opts.host === 'string' ? document.getElementById(opts.host) : opts.host;
    if (!ta || !host) return null;

    ta.style.display = 'none';
    host.innerHTML = '';
    host.classList.add('obs-ped-host');

    const toolbar = document.createElement('div');
    toolbar.className = 'obs-ped-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.innerHTML = `
      <button type="button" class="obs-ped-btn" data-cmd="bold" title="Negrito (Ctrl+B)"><b>N</b></button>
      <button type="button" class="obs-ped-btn" data-cmd="italic" title="Itálico (Ctrl+I)"><i>I</i></button>
      <button type="button" class="obs-ped-btn" data-cmd="underline" title="Sublinhado (Ctrl+U)"><u>S</u></button>
      <span class="obs-ped-sep" aria-hidden="true"></span>
      <label class="obs-ped-color" title="Cor do texto">
        <span class="obs-ped-color-lbl">Cor</span>
        <input type="color" class="obs-ped-color-input" value="#c0392b" aria-label="Cor do texto">
      </label>
      <button type="button" class="obs-ped-btn" data-cmd="removeFormat" title="Limpar formatação">✕</button>
      <button type="button" class="obs-ped-btn obs-ped-btn-case" data-act="sentence" title="Converter o texto para minúsculas (primeira letra de cada frase em maiúscula)"${root.ObsPedidoEditor && root.ObsPedidoEditor.maiuscula ? ' style="display:none"' : ''}>Aa</button>
    `;

    const editor = document.createElement('div');
    editor.className = 'obs-ped-editor input-field';
    editor.id = opts.editorId || 'f_obs_editor';
    editor.contentEditable = 'true';
    editor.setAttribute('role', 'textbox');
    editor.setAttribute('aria-multiline', 'true');
    editor.setAttribute('aria-label', 'Observações do pedido');
    if (root.ObsPedidoEditor && root.ObsPedidoEditor.maiuscula) editor.style.textTransform = 'uppercase';
    editor.dataset.placeholder = opts.placeholder || 'Instruções de entrega, horários, destaques…';

    host.appendChild(toolbar);
    host.appendChild(editor);
    setEditorFromValue(editor, ta, ta.value);

    toolbar.addEventListener('mousedown', (e) => {
      if (e.target.closest('button, label, input')) e.preventDefault();
    });
    toolbar.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="sentence"]')) {
        sentenceCaseEditor(editor);
        syncHidden(ta, editor);
        return;
      }
      const btn = e.target.closest('[data-cmd]');
      if (!btn) return;
      editor.focus();
      const c = btn.getAttribute('data-cmd');
      if (c === 'removeFormat') { cmd('removeFormat'); cmd('unlink'); }
      else cmd(c);
      syncHidden(ta, editor);
    });

    const colorInput = toolbar.querySelector('.obs-ped-color-input');
    if (colorInput) {
      colorInput.addEventListener('input', () => {
        editor.focus();
        cmd('foreColor', colorInput.value);
        syncHidden(ta, editor);
      });
    }

    editor.addEventListener('input', () => syncHidden(ta, editor));
    editor.addEventListener('blur', () => syncHidden(ta, editor));
    editor.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData)?.getData('text/plain') || '';
      cmd('insertText', text);
      syncHidden(ta, editor);
    });

    return {
      editor,
      textarea: ta,
      getValue() { syncHidden(ta, editor); return ta.value; },
      setValue(v) { setEditorFromValue(editor, ta, v); },
      sync() { syncHidden(ta, editor); },
    };
  }

  root.ObsPedidoEditor = {
    maiuscula: false, // config da empresa (sistemas.obs_maiuscula): exibe/imprime em CAIXA ALTA
    setMaiuscula(on) {
      root.ObsPedidoEditor.maiuscula = !!on;
      if (typeof document !== 'undefined') {
        document.querySelectorAll('.obs-ped-editor').forEach((el) => { el.style.textTransform = on ? 'uppercase' : ''; });
        document.querySelectorAll('.obs-ped-btn-case').forEach((el) => { el.style.display = on ? 'none' : ''; });
      }
    },
    sanitizeObsPedidoHtml,
    obsPedidoTemHtml,
    plainToEditorHtml,
    editorHtmlToValue,
    toPrintHtml,
    mount,
  };
})(typeof window !== 'undefined' ? window : globalThis);
