/**
 * Confirm / aviso dialog seguro para páginas abertas no iframe da home.
 *
 * Armadilha (2026-07-30 / Grades):
 * - `position:fixed` no overlay/card pode NÃO grudar na viewport do iframe.
 * - O diálogo cai no fluxo do documento → só aparece após rolar até o fim da lista.
 * - NÃO usar `position:fixed` + `top:50%` no card.
 * - Usar overlay `position:absolute` na área VISÍVEL: top=scrollY, height=innerHeight,
 *   com `display:flex; align-items:center; justify-content:center`.
 *
 * Uso:
 *   <script src="/assets/confirm-dialog.js"></script>
 *   confirmar('Excluir?', 'Não pode ser desfeito.', () => { ... });
 *   const ok = await SysRepConfirm.ask({ titulo:'Excluir?', mensagem:'...' });
 *   await avisar('Atenção', 'Selecione o banco.'); // substitui alert()
 *   await SysRepConfirm.alert({ titulo:'Atenção', mensagem:'...' });
 */
(function (global) {
  'use strict';

  const ATTR = 'data-sysrep-confirm';

  function _cssVar(name, fallback) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (_) {
      return fallback;
    }
  }

  function _scrollPos() {
    return {
      x: window.scrollX || document.documentElement.scrollLeft || 0,
      y: window.scrollY || document.documentElement.scrollTop || 0,
    };
  }

  function _viewportSize() {
    return {
      w: window.innerWidth || document.documentElement.clientWidth || 0,
      h: window.innerHeight || document.documentElement.clientHeight || 0,
    };
  }

  /**
   * @param {object} opts
   * @param {string} [opts.titulo]
   * @param {string} [opts.mensagem]
   * @param {string} [opts.okTexto]
   * @param {string} [opts.cancelTexto]
   * @param {boolean} [opts.perigo=true] — botão OK vermelho (confirmação)
   * @param {boolean} [opts.somenteOk=false] — só botão OK (substitui alert)
   * @returns {Promise<boolean>}
   */
  /** Host visível quando a página trava o scroll (ex.: formulário fixed em produtos). */
  function _overlayHost() {
    // NÃO usar #formSection como host: overflow:hidden + flex clipava/escondia o
    // diálogo e o overlay invisível engolia todos os cliques (X da foto / Cancelar).
    const openModal = document.querySelector(
      '.prod-cols-overlay.open, #modalImportFotos.open, #modalConfirm.open, #sysrepProdCoresPicker.show, #catalogoAfvOverlay.show'
    );
    if (openModal) return openModal;
    return null;
  }

  function _overflowLocked() {
    try {
      const b = getComputedStyle(document.body);
      const h = getComputedStyle(document.documentElement);
      const lock = (v) => /hidden|clip/.test(String(v || ''));
      return lock(b.overflow) || lock(b.overflowY) || lock(h.overflow) || lock(h.overflowY);
    } catch (_) {
      return false;
    }
  }

  function _formProdutoAberto() {
    const fs = document.getElementById('formSection');
    return !!(fs && fs.classList.contains('prod-form-visible'));
  }

  function ask(opts) {
    opts = opts || {};
    const somenteOk = !!(opts.somenteOk || opts._somenteOk || opts.alert);
    const titulo = opts.titulo || opts.title || (somenteOk ? 'Aviso' : 'Confirmar');
    const mensagem = opts.mensagem || opts.message || opts.msg || '';
    const okTexto = opts.okTexto || opts.okText || (somenteOk ? 'OK' : 'Confirmar');
    const cancelTexto = opts.cancelTexto || opts.cancelText || 'Cancelar';
    const perigo = somenteOk
      ? opts.perigo === true || opts.danger === true
      : (opts.perigo !== false && opts.danger !== false);

    return new Promise((resolve) => {
      document.querySelectorAll('[' + ATTR + ']').forEach((el) => el.remove());

      const { x: scrollX, y: scrollY } = _scrollPos();
      const { w: vw, h: vh } = _viewportSize();
      const host = _overlayHost();
      // Form aberto OU body com overflow travado → fixed na viewport (não clipa).
      const useFixed = !host && (_formProdutoAberto() || _overflowLocked());

      const wrap = document.createElement('div');
      wrap.setAttribute(ATTR, '1');
      wrap.setAttribute('role', 'dialog');
      wrap.setAttribute('aria-modal', 'true');
      // Com body overflow:hidden + form fixed, absolute no body era CLIPADO → "nada acontece".
      // 1) Host = outro modal aberto → absolute inset:0 nele
      // 2) Form produto / overflow travado → fixed na viewport (acima do form z-index:400)
      // 3) Lista normal no iframe → absolute + scrollY (regra grades)
      if (host) {
        const pos = getComputedStyle(host).position;
        if (pos === 'static') host.style.position = 'relative';
        wrap.style.cssText = [
          'position:absolute',
          'inset:0',
          'z-index:2147483646',
          'background:rgba(15,23,42,.55)',
          'display:flex',
          'align-items:center',
          'justify-content:center',
          'padding:16px',
          'box-sizing:border-box',
        ].join(';');
      } else if (useFixed) {
        wrap.style.cssText = [
          'position:fixed',
          'inset:0',
          'z-index:2147483646',
          'background:rgba(15,23,42,.55)',
          'display:flex',
          'align-items:center',
          'justify-content:center',
          'padding:16px',
          'box-sizing:border-box',
        ].join(';');
      } else {
        wrap.style.cssText = [
          'position:absolute',
          'top:' + scrollY + 'px',
          'left:' + scrollX + 'px',
          'width:' + vw + 'px',
          'height:' + vh + 'px',
          'z-index:2147483646',
          'background:rgba(15,23,42,.55)',
          'display:flex',
          'align-items:center',
          'justify-content:center',
          'padding:16px',
          'box-sizing:border-box',
        ].join(';');
      }

      const card = _cssVar('--card', _cssVar('--glass-bg', '#ffffff'));
      const text = _cssVar('--text', _cssVar('--content-text', '#111827'));
      const text2 = _cssVar('--text2', '#6b7280');
      const border = _cssVar('--border', '#e5e7eb');

      const box = document.createElement('div');
      box.style.cssText = [
        'background:' + card,
        'color:' + text,
        'border:1px solid ' + border,
        'border-radius:14px',
        'padding:26px',
        'max-width:400px',
        'width:100%',
        'text-align:center',
        'box-shadow:0 20px 60px rgba(0,0,0,.28)',
        'box-sizing:border-box',
        'flex-shrink:0',
      ].join(';');

      const h3 = document.createElement('h3');
      h3.textContent = String(titulo);
      h3.style.cssText = 'font-size:16px;font-weight:700;margin:0 0 9px;color:' + text;

      const p = document.createElement('p');
      p.textContent = String(mensagem);
      p.style.cssText = 'font-size:13px;line-height:1.5;margin:0;color:' + text2;

      const btns = document.createElement('div');
      btns.style.cssText = 'display:flex;gap:10px;justify-content:center;margin-top:18px;flex-wrap:wrap';

      // As classes .btn/.btn-primary/.btn-ghost nao existem no projeto: os botoes
      // ficavam sem estilo nenhum. O visual vai inline, como o resto do dialogo.
      const baseBtn = [
        'min-width:118px',
        'height:40px',
        'padding:0 20px',
        'border-radius:10px',
        'font:inherit',
        'font-size:13px',
        'font-weight:700',
        'cursor:pointer',
        'transition:filter .12s,background .12s,border-color .12s',
        'box-sizing:border-box',
      ].join(';');

      const btnOk = document.createElement('button');
      btnOk.type = 'button';
      btnOk.className = perigo ? 'btn btn-danger' : 'btn btn-primary';
      btnOk.textContent = okTexto;
      const corOk = perigo ? '#dc2626' : _cssVar('--accent', '#0284c7');
      btnOk.style.cssText = baseBtn + ';border:1.5px solid ' + corOk + ';background:' + corOk + ';color:#fff';
      btnOk.onmouseenter = () => { btnOk.style.filter = 'brightness(.92)'; };
      btnOk.onmouseleave = () => { btnOk.style.filter = ''; };

      let btnNo = null;
      if (!somenteOk) {
        btnNo = document.createElement('button');
        btnNo.type = 'button';
        btnNo.className = 'btn btn-ghost';
        btnNo.textContent = cancelTexto;
        btnNo.style.cssText = baseBtn + ';border:1.5px solid ' + border + ';background:transparent;color:' + text2;
        btnNo.onmouseenter = () => { btnNo.style.background = _cssVar('--surface-2', 'rgba(0,0,0,.04)'); };
        btnNo.onmouseleave = () => { btnNo.style.background = 'transparent'; };
      }

      const blockScroll = (e) => { e.preventDefault(); };
      const syncOverlay = () => {
        if (host || useFixed) return;
        const pos = _scrollPos();
        const size = _viewportSize();
        wrap.style.top = pos.y + 'px';
        wrap.style.left = pos.x + 'px';
        wrap.style.width = size.w + 'px';
        wrap.style.height = size.h + 'px';
      };

      let settled = false;
      function fechar(ok) {
        if (settled) return;
        settled = true;
        wrap.removeEventListener('wheel', blockScroll);
        wrap.removeEventListener('touchmove', blockScroll);
        window.removeEventListener('scroll', syncOverlay, true);
        window.removeEventListener('resize', syncOverlay);
        wrap.remove();
        if (!host && !useFixed) {
          requestAnimationFrame(() => {
            window.scrollTo(scrollX, scrollY);
            document.documentElement.scrollTop = scrollY;
            document.body.scrollTop = scrollY;
          });
        }
        resolve(!!ok);
      }

      if (btnNo) btnNo.onclick = (e) => { e.stopPropagation(); fechar(false); };
      btnOk.onclick = (e) => { e.stopPropagation(); fechar(true); };
      wrap.onclick = (e) => { if (e.target === wrap) fechar(somenteOk); };
      box.onclick = (e) => e.stopPropagation();

      wrap.addEventListener('wheel', blockScroll, { passive: false });
      wrap.addEventListener('touchmove', blockScroll, { passive: false });
      if (!host && !useFixed) {
        window.addEventListener('scroll', syncOverlay, true);
        window.addEventListener('resize', syncOverlay);
      }

      if (btnNo) btns.appendChild(btnNo);
      btns.appendChild(btnOk);
      box.appendChild(h3);
      box.appendChild(p);
      box.appendChild(btns);
      wrap.appendChild(box);
      (host || document.body).appendChild(wrap);
      setTimeout(() => { try { btnOk.focus(); } catch (_) {} }, 40);
    });
  }

  /** Compatível com telas antigas: confirmar(titulo, msg, onOk) */
  function confirmar(titulo, msg, onOk) {
    ask({ titulo: titulo, mensagem: msg }).then((ok) => {
      if (ok && typeof onOk === 'function') onOk();
    });
  }

  /** Aviso com um botão — substitui alert() nativo. */
  function alertDialog(optsOuTitulo, mensagem) {
    const opts = typeof optsOuTitulo === 'string'
      ? { titulo: optsOuTitulo, mensagem: mensagem || '' }
      : (optsOuTitulo || {});
    return ask({
      titulo: opts.titulo || opts.title || 'Aviso',
      mensagem: opts.mensagem || opts.message || opts.msg || '',
      okTexto: opts.okTexto || opts.okText || 'OK',
      perigo: opts.perigo === true,
      somenteOk: true,
    }).then(() => undefined);
  }

  function avisar(titulo, msg) {
    return alertDialog({ titulo: titulo || 'Aviso', mensagem: msg || '' });
  }

  global.SysRepConfirm = { ask: ask, confirmar: confirmar, alert: alertDialog, avisar: avisar };
  global.confirmar = confirmar;
  global.avisar = avisar;
})(typeof window !== 'undefined' ? window : globalThis);
