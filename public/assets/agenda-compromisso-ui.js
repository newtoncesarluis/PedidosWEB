/**
 * Modal «Agendar» + Google Agenda para entidades sem id_cliente
 * (fornecedor, usuário, etc.) — grava COMPROMISSO em /api/visitas.
 *
 * Uso:
 *   <script src="/assets/agenda-compromisso-ui.js"></script>
 *   SysRepAgenda.abrir({
 *     prefixo: 'Fornecedor',
 *     nome: 'ACME LTDA',
 *     location: 'Cidade / UF',
 *     onSalvo: () => {},
 *   });
 */
(function (global) {
  'use strict';

  const ATTR = 'data-sysrep-agenda';
  let _ctx = null;
  let _listeners = null;

  function _token() {
    return sessionStorage.getItem('token') || localStorage.getItem('token') || '';
  }

  function _userId() {
    try {
      const u = JSON.parse(sessionStorage.getItem('user') || '{}');
      return u.idusuario || u.id || null;
    } catch (_) {
      return null;
    }
  }

  function _toast(msg, tipo) {
    if (typeof global.toast === 'function') return global.toast(msg, tipo || 'ok');
    if (typeof global.showToast === 'function') {
      return global.showToast(msg, tipo === 'err' ? 'error' : 'success');
    }
    alert(msg);
  }

  function _scrollPos() {
    return {
      x: global.scrollX || document.documentElement.scrollLeft || 0,
      y: global.scrollY || document.documentElement.scrollTop || 0,
    };
  }

  function _viewportSize() {
    return {
      w: global.innerWidth || document.documentElement.clientWidth || 0,
      h: global.innerHeight || document.documentElement.clientHeight || 0,
    };
  }

  function _hojeIso() {
    if (typeof global.hojeIsoBrasil === 'function') return global.hojeIsoBrasil();
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function _ensureCss() {
    if (document.getElementById('sysrep-agenda-css')) return;
    const st = document.createElement('style');
    st.id = 'sysrep-agenda-css';
    st.textContent = `
      [${ATTR}]{position:absolute;z-index:2147483646;background:rgba(15,23,42,.55);
        display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
      [${ATTR}] .sa-card{background:var(--card,#fff);color:var(--text,#111);border-radius:14px;
        width:min(440px,100%);box-shadow:0 20px 60px rgba(0,0,0,.28);overflow:hidden;flex-shrink:0}
      [${ATTR}] .sa-head{background:linear-gradient(135deg,#4361ee,#3f37c9);color:#fff;padding:16px 20px}
      [${ATTR}] .sa-head h3{margin:0;font-size:16px;font-weight:700}
      [${ATTR}] .sa-head p{margin:4px 0 0;font-size:12px;opacity:.85}
      [${ATTR}] .sa-body{padding:18px 20px;display:flex;flex-direction:column;gap:12px}
      [${ATTR}] .sa-group{display:flex;flex-direction:column;gap:4px}
      [${ATTR}] .sa-group label{font-size:11px;font-weight:700;text-transform:uppercase;
        letter-spacing:.3px;color:var(--text2,#64748b)}
      [${ATTR}] .sa-input{width:100%;padding:8px 10px;border:1.5px solid var(--border,#e2e8f0);
        border-radius:8px;font-size:13px;font-family:inherit;background:var(--card,#fff);
        color:var(--text,#111);outline:none;box-sizing:border-box}
      [${ATTR}] .sa-input:focus{border-color:#4361ee;box-shadow:0 0 0 3px rgba(67,97,238,.12)}
      [${ATTR}] select.sa-input option{background:var(--card,#fff);color:var(--text,#111)}
      [${ATTR}] .sa-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      [${ATTR}] .sa-obs{min-height:72px;resize:vertical}
      [${ATTR}] .sa-google{display:flex;align-items:center;gap:8px;padding:10px 12px;
        background:#f0fdf4;border:1px solid #dcfce7;border-radius:10px}
      [${ATTR}] .sa-google label{margin:0;font-size:12px;font-weight:600;color:#166534;cursor:pointer;
        text-transform:none;letter-spacing:0}
      [${ATTR}] .sa-foot{padding:14px 20px;border-top:1px solid var(--border,#e2e8f0);
        display:flex;justify-content:flex-end;gap:8px;background:var(--card,#f9fafb)}
      [${ATTR}] .sa-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;
        padding:8px 16px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;
        font-family:inherit;border:1.5px solid transparent}
      [${ATTR}] .sa-btn-ghost{background:var(--card,#fff);color:var(--text2,#64748b);border-color:var(--border,#e2e8f0)}
      [${ATTR}] .sa-btn-primary{background:#4361ee;color:#fff;border-color:#4361ee}
      [${ATTR}] .sa-btn-primary:disabled{opacity:.6;cursor:not-allowed}
      @media(max-width:480px){[${ATTR}] .sa-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(st);
  }

  function _detachListeners() {
    if (!_listeners) return;
    const { wrap, blockScroll, sync } = _listeners;
    try { wrap.removeEventListener('wheel', blockScroll); } catch (_) {}
    try { wrap.removeEventListener('touchmove', blockScroll); } catch (_) {}
    try { global.removeEventListener('scroll', sync, true); } catch (_) {}
    try { global.removeEventListener('resize', sync); } catch (_) {}
    _listeners = null;
  }

  function fechar() {
    _detachListeners();
    document.querySelectorAll('[' + ATTR + ']').forEach((el) => el.remove());
    _ctx = null;
  }

  async function _carregarMotivos(sel) {
    if (!sel) return;
    try {
      const r = await fetch('/api/visitas/motivos', {
        headers: { Authorization: 'Bearer ' + _token() },
      });
      const rows = await r.json().catch(() => []);
      const list = Array.isArray(rows) ? rows : [];
      sel.innerHTML = '<option value="">— Opcional —</option>' +
        list.map((m) => {
          const desc = String(m.descricao || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
          return `<option value="${m.id}">${desc}</option>`;
        }).join('');
    } catch (_) {
      sel.innerHTML = '<option value="">— Opcional —</option>';
    }
  }

  function _abrirGoogle(payload, location) {
    const data = String(payload.data_visita || '').replace(/-/g, '');
    const hora = String(payload.hora_visita || '08:00:00').replace(/:/g, '').substring(0, 4);
    const hEnd = String(parseInt(hora.substring(0, 2), 10) + 1).padStart(2, '0') + hora.substring(2);
    const dates = `${data}T${hora}00/${data}T${hEnd}00`;
    const url = new URL('https://calendar.google.com/calendar/render');
    url.searchParams.set('action', 'TEMPLATE');
    url.searchParams.set('text', '📅 ' + (payload.titulo || 'Compromisso'));
    url.searchParams.set('details', ['Compromisso SysRep', payload.obs || ''].filter(Boolean).join('\n'));
    url.searchParams.set('dates', dates);
    if (location) url.searchParams.set('location', location);
    global.open(url.toString(), '_blank');
  }

  async function _salvar(wrap) {
    const titulo = (wrap.querySelector('#sa_titulo')?.value || '').trim();
    const data = wrap.querySelector('#sa_data')?.value || '';
    const hora = (wrap.querySelector('#sa_hora')?.value || '08:00') + ':00';
    const obs = wrap.querySelector('#sa_obs')?.value || '';
    const idMotivo = wrap.querySelector('#sa_motivo')?.value || null;
    const google = !!wrap.querySelector('#sa_google')?.checked;

    if (!data) return _toast('Informe a data', 'err');
    if (!titulo) return _toast('Informe o assunto', 'err');

    const btn = wrap.querySelector('#sa_btn_ok');
    if (btn) { btn.disabled = true; btn.textContent = 'Salvando…'; }

    const payload = {
      tipo: 'COMPROMISSO',
      id_cliente: null,
      titulo: titulo.slice(0, 150),
      id_vendedor: _userId(),
      id_usuario: _userId(),
      id_motivo: idMotivo || null,
      data_visita: data,
      hora_visita: hora,
      status: 'ABERTA',
      obs,
      origem: 'WEB',
    };

    const location = (_ctx && _ctx.location) || '';
    const onSalvo = _ctx && _ctx.onSalvo;

    try {
      const r = await fetch('/api/visitas', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + _token(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Erro ao agendar');

      _toast('Agendado com sucesso', 'ok');
      if (google) _abrirGoogle(payload, location);
      fechar();
      if (typeof onSalvo === 'function') onSalvo();
    } catch (e) {
      _toast(e.message || 'Erro ao agendar', 'err');
      if (btn) { btn.disabled = false; btn.textContent = 'Agendar'; }
    }
  }

  /**
   * @param {object} opts
   * @param {string} opts.prefixo  Ex: 'Fornecedor' | 'Usuário'
   * @param {string} opts.nome
   * @param {string} [opts.location]
   * @param {function} [opts.onSalvo]
   */
  function abrir(opts) {
    opts = opts || {};
    const prefixo = String(opts.prefixo || 'Compromisso').trim() || 'Compromisso';
    const nome = String(opts.nome || '').trim() || '—';
    const assunto = `${prefixo}: ${nome}`.slice(0, 150);
    const nomeSafe = nome.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

    _ensureCss();
    fechar();

    _ctx = {
      location: String(opts.location || '').trim(),
      onSalvo: opts.onSalvo,
    };

    const { x, y } = _scrollPos();
    const { w, h } = _viewportSize();

    const wrap = document.createElement('div');
    wrap.setAttribute(ATTR, '1');
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.style.top = y + 'px';
    wrap.style.left = x + 'px';
    wrap.style.width = w + 'px';
    wrap.style.height = h + 'px';

    wrap.innerHTML =
      '<div class="sa-card">' +
        '<div class="sa-head">' +
          '<h3>Agendar Atividade</h3>' +
          '<p>' + prefixo.replace(/</g, '&lt;') + ': ' + nomeSafe + '</p>' +
        '</div>' +
        '<div class="sa-body">' +
          '<div class="sa-group"><label for="sa_titulo">Assunto</label>' +
            '<input type="text" id="sa_titulo" class="sa-input" maxlength="150" autocomplete="off"></div>' +
          '<div class="sa-group"><label for="sa_motivo">Motivo</label>' +
            '<select id="sa_motivo" class="sa-input"><option value="">— Opcional —</option></select></div>' +
          '<div class="sa-grid">' +
            '<div class="sa-group"><label for="sa_data">Data</label>' +
              '<input type="date" id="sa_data" class="sa-input"></div>' +
            '<div class="sa-group"><label for="sa_hora">Hora</label>' +
              '<input type="time" id="sa_hora" class="sa-input" value="08:00"></div>' +
          '</div>' +
          '<div class="sa-group"><label for="sa_obs">Observações / Planejamento</label>' +
            '<textarea id="sa_obs" class="sa-input sa-obs" placeholder="O que pretende fazer neste compromisso?"></textarea></div>' +
          '<div class="sa-google">' +
            '<input type="checkbox" id="sa_google" checked style="width:16px;height:16px">' +
            '<label for="sa_google">Abrir Google Agenda ao salvar</label>' +
          '</div>' +
        '</div>' +
        '<div class="sa-foot">' +
          '<button type="button" class="sa-btn sa-btn-ghost" id="sa_btn_cancel">Cancelar</button>' +
          '<button type="button" class="sa-btn sa-btn-primary" id="sa_btn_ok">Agendar</button>' +
        '</div>' +
      '</div>';

    const blockScroll = (e) => e.preventDefault();
    const sync = () => {
      const pos = _scrollPos();
      const size = _viewportSize();
      wrap.style.top = pos.y + 'px';
      wrap.style.left = pos.x + 'px';
      wrap.style.width = size.w + 'px';
      wrap.style.height = size.h + 'px';
    };

    wrap.addEventListener('wheel', blockScroll, { passive: false });
    wrap.addEventListener('touchmove', blockScroll, { passive: false });
    wrap.addEventListener('click', (e) => { if (e.target === wrap) fechar(); });
    wrap.querySelector('.sa-card').addEventListener('click', (e) => e.stopPropagation());
    global.addEventListener('scroll', sync, true);
    global.addEventListener('resize', sync);
    _listeners = { wrap, blockScroll, sync };

    document.body.appendChild(wrap);

    wrap.querySelector('#sa_titulo').value = assunto;
    wrap.querySelector('#sa_data').value = _hojeIso();
    wrap.querySelector('#sa_btn_cancel').onclick = () => fechar();
    wrap.querySelector('#sa_btn_ok').onclick = () => _salvar(wrap);
    _carregarMotivos(wrap.querySelector('#sa_motivo'));
    setTimeout(() => wrap.querySelector('#sa_titulo')?.focus(), 40);
  }

  global.SysRepAgenda = { abrir, fechar };
})(typeof window !== 'undefined' ? window : globalThis);
