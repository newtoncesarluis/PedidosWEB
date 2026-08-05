/**
 * Confirm dialog seguro para páginas abertas no iframe da home.
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
 *   // ou
 *   const ok = await SysRepConfirm.ask({ titulo:'Excluir?', mensagem:'...' });
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
   * @param {boolean} [opts.perigo=true] — botão OK vermelho
   * @returns {Promise<boolean>}
   */
  function ask(opts) {
    opts = opts || {};
    const titulo = opts.titulo || opts.title || 'Confirmar';
    const mensagem = opts.mensagem || opts.message || opts.msg || '';
    const okTexto = opts.okTexto || opts.okText || 'Confirmar';
    const cancelTexto = opts.cancelTexto || opts.cancelText || 'Cancelar';
    const perigo = opts.perigo !== false && opts.danger !== false;

    return new Promise((resolve) => {
      document.querySelectorAll('[' + ATTR + ']').forEach((el) => el.remove());

      const { x: scrollX, y: scrollY } = _scrollPos();
      const { w: vw, h: vh } = _viewportSize();

      const wrap = document.createElement('div');
      wrap.setAttribute(ATTR, '1');
      wrap.setAttribute('role', 'dialog');
      wrap.setAttribute('aria-modal', 'true');
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

      const btnNo = document.createElement('button');
      btnNo.type = 'button';
      btnNo.className = 'btn btn-ghost';
      btnNo.textContent = cancelTexto;

      const btnOk = document.createElement('button');
      btnOk.type = 'button';
      btnOk.className = perigo ? 'btn btn-danger' : 'btn btn-primary';
      btnOk.textContent = okTexto;

      const blockScroll = (e) => { e.preventDefault(); };
      const syncOverlay = () => {
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
        requestAnimationFrame(() => {
          window.scrollTo(scrollX, scrollY);
          document.documentElement.scrollTop = scrollY;
          document.body.scrollTop = scrollY;
        });
        resolve(!!ok);
      }

      btnNo.onclick = (e) => { e.stopPropagation(); fechar(false); };
      btnOk.onclick = (e) => { e.stopPropagation(); fechar(true); };
      wrap.onclick = (e) => { if (e.target === wrap) fechar(false); };
      box.onclick = (e) => e.stopPropagation();

      wrap.addEventListener('wheel', blockScroll, { passive: false });
      wrap.addEventListener('touchmove', blockScroll, { passive: false });
      window.addEventListener('scroll', syncOverlay, true);
      window.addEventListener('resize', syncOverlay);

      btns.appendChild(btnNo);
      btns.appendChild(btnOk);
      box.appendChild(h3);
      box.appendChild(p);
      box.appendChild(btns);
      wrap.appendChild(box);
      document.body.appendChild(wrap);
    });
  }

  /** Compatível com telas antigas: confirmar(titulo, msg, onOk) */
  function confirmar(titulo, msg, onOk) {
    ask({ titulo: titulo, mensagem: msg }).then((ok) => {
      if (ok && typeof onOk === 'function') onOk();
    });
  }

  global.SysRepConfirm = { ask: ask, confirmar: confirmar };
  global.confirmar = confirmar;
})(typeof window !== 'undefined' ? window : globalThis);
