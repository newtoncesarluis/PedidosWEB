/**
 * Colar imagem da área de transferência (Ctrl+V / Cmd+V).
 * Útil para fotos do Google Drive: abrir a imagem → Copiar imagem → colar no SysRep.
 *
 * Uso:
 *   SysRepClipboard.bindPaste(document, (files, e) => { ... }, {
 *     when: () => abaFotosAberta && produtoSalvo,
 *     ignoreTyping: true,
 *   });
 *   const files = SysRepClipboard.filesFromEvent(e);
 */
(function (global) {
  'use strict';

  const EXT = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
  };

  function _isTypingTarget(el) {
    if (!el || !el.closest) return false;
    const t = el.closest('input, textarea, select, [contenteditable="true"]');
    if (!t) return false;
    // file inputs não "digitam"
    if (t.tagName === 'INPUT' && String(t.type || '').toLowerCase() === 'file') return false;
    return true;
  }

  function _ensureFileName(file, idx) {
    if (!file) return null;
    const hasExt = /\.[a-z0-9]{2,5}$/i.test(file.name || '');
    if (file.name && hasExt) return file;
    const ext = EXT[file.type] || 'png';
    const name = (file.name && file.name.trim()) || `imagem-colar-${Date.now()}-${idx + 1}.${ext}`;
    const finalName = hasExt ? name : name.replace(/\.[^.]+$/, '') + '.' + ext;
    try {
      return new File([file], finalName, { type: file.type || 'image/png', lastModified: Date.now() });
    } catch (_) {
      return file;
    }
  }

  /**
   * Extrai arquivos de imagem de um evento paste/drop.
   * @param {ClipboardEvent|DragEvent} e
   * @returns {File[]}
   */
  function filesFromEvent(e) {
    const out = [];
    const cd = e && (e.clipboardData || e.dataTransfer);
    if (!cd) return out;

    if (cd.files && cd.files.length) {
      for (let i = 0; i < cd.files.length; i++) {
        const f = cd.files[i];
        if (f && String(f.type || '').startsWith('image/')) out.push(_ensureFileName(f, i));
      }
    }

    if (!out.length && cd.items) {
      for (let i = 0; i < cd.items.length; i++) {
        const it = cd.items[i];
        if (!it || it.kind !== 'file') continue;
        if (!String(it.type || '').startsWith('image/')) continue;
        const f = it.getAsFile();
        if (f) out.push(_ensureFileName(f, i));
      }
    }

    return out.filter(Boolean);
  }

  /**
   * @param {Element|Document|Window} target
   * @param {(files: File[], e: Event) => void} onFiles
   * @param {{ when?: () => boolean, ignoreTyping?: boolean }} [opts]
   */
  function bindPaste(target, onFiles, opts) {
    opts = opts || {};
    const ignoreTyping = opts.ignoreTyping !== false;
    const el = target === global ? global.document : target;
    if (!el || typeof el.addEventListener !== 'function') return () => {};

    const handler = (e) => {
      if (typeof opts.when === 'function' && !opts.when()) return;
      if (ignoreTyping && _isTypingTarget(e.target)) return;
      const files = filesFromEvent(e);
      if (!files.length) return;
      e.preventDefault();
      onFiles(files, e);
    };

    el.addEventListener('paste', handler);
    return () => el.removeEventListener('paste', handler);
  }

  global.SysRepClipboard = { filesFromEvent, bindPaste, ensureFileName: _ensureFileName };
})(typeof window !== 'undefined' ? window : globalThis);
