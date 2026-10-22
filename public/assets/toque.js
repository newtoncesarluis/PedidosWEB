/**
 * Toque (1º, 2º, 3º) por WhatsApp com mensagem pronta.
 * Toque.abrir(lead, { numero, onDone }) abre o cartão com a mensagem personalizada;
 * "Abrir no WhatsApp" abre o wa.me com o texto, registra o toque no lead e agenda a cadência.
 * Usado em Leads, Hoje e Mapa.
 */
(function (global) {
  'use strict';

  var CSS = [
    '.tq-ov{position:fixed;inset:0;z-index:4000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px}',
    '.tq-card{width:min(460px,100%);max-height:92vh;overflow-y:auto;background:var(--card,#fff);color:var(--text,#1e293b);border:1px solid var(--border,#e2e8f0);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.4);padding:16px;font-family:var(--font,system-ui,sans-serif)}',
    '.tq-top{display:flex;align-items:center;gap:8px;margin-bottom:4px}',
    '.tq-top h3{flex:1;font-size:16px;font-weight:800}',
    '.tq-x{width:40px;height:40px;border-radius:50%;border:1px solid var(--border,#e2e8f0);background:var(--bg,#f1f5f9);color:inherit;font-size:22px;cursor:pointer}',
    '.tq-chip{display:inline-block;font-size:11px;font-weight:800;padding:3px 9px;border-radius:99px;background:#dbeafe;color:#1e40af;margin-bottom:10px}',
    '.tq-lead{font-size:13px;color:var(--text2,#64748b);margin-bottom:10px;line-height:1.4}',
    '.tq-msg{border:1px solid #bfdbfe;background:#eff6ff;color:#0f172a;border-radius:12px;padding:12px;font-size:14px;line-height:1.5;white-space:pre-wrap;word-break:break-word}',
    '.tq-ta{width:100%;min-height:130px;border:1px solid var(--border,#cbd5e1);border-radius:12px;padding:10px;font:14px/1.5 inherit;font-family:inherit;background:var(--card,#fff);color:inherit;resize:vertical}',
    '.tq-linha{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}',
    '.tq-btn{flex:1 1 140px;min-height:44px;border-radius:10px;border:1px solid var(--border,#cbd5e1);background:transparent;color:inherit;font:700 13px inherit;font-family:inherit;cursor:pointer;padding:0 12px}',
    '.tq-btn:hover{border-color:var(--accent,#2563eb);color:var(--accent,#2563eb)}',
    '.tq-wa{width:100%;min-height:50px;border:0;border-radius:12px;background:#16a34a;color:#fff;font:800 15px inherit;font-family:inherit;cursor:pointer;margin-top:12px;display:flex;align-items:center;justify-content:center;gap:8px}',
    '.tq-wa:disabled{background:var(--border,#cbd5e1);color:var(--text2,#64748b);cursor:not-allowed}',
    '.tq-aviso{font-size:12px;color:#92400e;background:#fef3c7;border-radius:10px;padding:8px 10px;margin-top:10px;line-height:1.4}',
    '.tq-ok{font-size:13px;color:#166534;background:#dcfce7;border-radius:10px;padding:10px;margin-top:12px;font-weight:700;line-height:1.4}',
    '.tq-dica{font-size:11px;color:var(--text2,#64748b);margin-top:6px;line-height:1.4}'
  ].join('');
  var st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);

  function api(url, opts) {
    var tk = '';
    try { tk = sessionStorage.getItem('token') || localStorage.getItem('token') || ''; } catch (_) {}
    var o = opts || {};
    var headers = Object.assign({ 'Content-Type': 'application/json' }, tk ? { Authorization: 'Bearer ' + tk } : {}, o.headers || {});
    return fetch(url, Object.assign({ credentials: 'include' }, o, { headers: headers })).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (r.status === 401) { try { top.location.href = '/login.html'; } catch (_) {} }
        if (!r.ok) throw new Error(d.error || ('Erro ' + r.status));
        return d;
      });
    });
  }

  // há API de WhatsApp configurada no sistema? (consultado uma vez por página)
  var _apiWa = null;
  function apiWhats() {
    if (!_apiWa) _apiWa = api('/api/leads/whatsapp-api').then(function (d) { return d && d.disponivel ? d : null; }).catch(function () { return null; });
    return _apiWa;
  }

  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }
  function aviso(msg) { if (typeof global.toast === 'function') global.toast(msg, 'ok'); }

  // textos de reserva (o servidor manda os mesmos; isto cobre servidor/banco fora do ar)
  var PADRAO = {
    1: '{cumprimento} Aqui é {meu_nome}, da {minha_empresa}. Estou falando com {tipo_pl} de {cidade} e queria te mostrar uma solução que pode ajudar a {empresa}. Posso te explicar em 1 minuto?',
    2: '{cumprimento} Passando de novo por aqui: sou {meu_nome}, da {minha_empresa}. Conseguiu ver minha mensagem? Se fizer sentido, te mostro rapidinho como funciona para a {empresa}.',
    3: 'Vou encerrar por aqui para não te incomodar. Se em algum momento a {empresa} quiser conhecer a {minha_empresa}, é só me chamar. Obrigado pela atenção! — {meu_nome}'
  };
  // Celular: wa.me já abre o app. Computador: tenta o aplicativo instalado (whatsapp://) e, se nada
  // abrir, mostra o link para o WhatsApp Web (sem janela nova automática, que o navegador bloquearia).
  function abrirWhats(f, texto, aviso) {
    var web = 'https://wa.me/' + f + '?text=' + encodeURIComponent(texto);
    if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) { global.open(web, '_blank'); return; }
    var abriu = false;
    function saiu() { abriu = true; }
    global.addEventListener('blur', saiu, { once: true });
    document.addEventListener('visibilitychange', saiu, { once: true });
    var a = document.createElement('a');
    a.href = 'whatsapp://send?phone=' + f + '&text=' + encodeURIComponent(texto);
    a.style.display = 'none'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () {
      global.removeEventListener('blur', saiu);
      if (abriu || !aviso) return;
      var d = document.createElement('div');
      d.className = 'tq-aviso';
      d.innerHTML = 'Não abriu o aplicativo? <a href="' + web + '" target="_blank" rel="noopener">Abrir pelo WhatsApp Web</a>';
      aviso.appendChild(d);
    }, 1800);
  }
  var modelos = null;
  function carregarModelos(forcar) {
    if (modelos && !forcar) return Promise.resolve(modelos);
    return api('/api/leads/modelos').then(function (d) { modelos = d; return d; })
      .catch(function () { modelos = modelos || { padroes: {}, salvos: [] }; return modelos; });
  }

  function saudacao() { var h = new Date().getHours(); return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'; }
  function plural(seg) {
    var t = norm(seg);
    if (!t) return 'empresas';
    if (/[sz]$/.test(t)) return t;
    if (/ao$/.test(t)) return t.replace(/ao$/, 'oes');
    return t + 's';
  }
  function cap(s) { s = String(s || '').trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s; }
  function perfil() { try { return JSON.parse(localStorage.getItem('buscardor_perfil') || '{}') || {}; } catch (_) { return {}; } }
  function eu() {
    var u = {}, e = {};
    try { u = JSON.parse(sessionStorage.getItem('user') || '{}'); } catch (_) {}
    try { e = JSON.parse(sessionStorage.getItem('empresa') || '{}'); } catch (_) {}
    return {
      nome: cap(String(u.nome || u.login || '').split(/\s+/)[0]) || 'a equipe',
      empresa: e.nome_fantasia || e.Razao_empresa || 'nossa empresa'
    };
  }

  /** Escolhe o texto: personalizado do tipo > personalizado geral > padrão; troca as {variáveis}. */
  function textoModelo(numero, segmento) {
    var m = modelos || { padroes: {}, salvos: [] };
    var seg = norm(segmento);
    var achado = (m.salvos || []).filter(function (x) { return +x.toque === +numero; });
    var porTipo = achado.filter(function (x) { return x.segmento !== '*' && norm(x.segmento) === seg; })[0];
    var geral = achado.filter(function (x) { return x.segmento === '*'; })[0];
    return (porTipo && porTipo.texto) || (geral && geral.texto) || (m.padroes && m.padroes[numero]) || PADRAO[numero] || '';
  }
  function montar(lead, numero, textoBase) {
    var me = eu();
    var empresa = lead.empresa || lead.nome || 'sua empresa';
    var primeiro = String(lead.nome || '').split(/\s+/)[0];
    // só trata como pessoa se o nome não repete a empresa (ex.: "Padaria 4" x "Padaria 4 LTDA" não é pessoa)
    var contato = lead.decisor ? cap(String(lead.decisor).split(/\s+/)[0]) : lead.empresa && primeiro && !/\d/.test(lead.nome) && norm(lead.empresa).indexOf(norm(primeiro)) < 0 ? cap(primeiro) : '';
    var vars = {
      cumprimento: saudacao() + (contato ? ', ' + contato : '') + '!',
      saudacao: saudacao(), nome: contato || empresa, empresa: empresa,
      meu_nome: me.nome, minha_empresa: me.empresa,
      produto: perfil().produto || 'nossos produtos',
      tipo: lead.segmento || 'comércio', tipo_pl: plural(lead.segmento), cidade: lead.cidade || 'sua região'
    };
    return String(textoBase != null ? textoBase : textoModelo(numero, lead.segmento)).replace(/\{(\w+)\}/g, function (a, k) { return vars[k] != null ? vars[k] : a; });
  }
  function fone(lead) {
    var d = String(lead.whatsapp || lead.telefone || '').replace(/\D/g, '');
    if (d.length === 10 || d.length === 11) d = '55' + d;
    return d.length >= 12 ? d : '';
  }
  function numeroDo(lead) { return Math.min((+lead.toques || 0) + 1, 3); }

  function abrir(lead, opts) {
    opts = opts || {};
    var numero = opts.numero || numeroDo(lead);
    return Promise.all([carregarModelos(), apiWhats()]).then(function (rs) {
      var apiInfo = rs[1];
      var f = fone(lead);
      var texto = montar(lead, numero);
      var base = textoModelo(numero, lead.segmento);
      var ov = document.createElement('div');
      ov.className = 'tq-ov';
      ov.innerHTML = '<div class="tq-card" role="group" aria-modal="true">' +
        '<div class="tq-top"><h3>' + numero + 'º toque' + (lead.segmento ? ' · ' + esc(lead.segmento) : '') + '</h3><button type="button" class="tq-x" aria-label="Fechar">&times;</button></div>' +
        '<span class="tq-chip">' + (numero === 1 ? 'Primeira abordagem' : numero === 2 ? 'Retomada' : 'Último toque') + '</span>' +
        '<div class="tq-lead"><b>' + esc(lead.empresa || lead.nome) + '</b>' + (f ? ' · ' + esc(lead.whatsapp || lead.telefone) : '') + '</div>' +
        '<div class="tq-msg" id="tqMsg"></div>' +
        '<textarea class="tq-ta" id="tqTa" hidden></textarea>' +
        '<div class="tq-linha"><button type="button" class="tq-btn" id="tqEd">Editar mensagem</button><button type="button" class="tq-btn" id="tqCp">Copiar</button></div>' +
        '<div class="tq-linha" id="tqSalvar" hidden><button type="button" class="tq-btn" id="tqPad">Salvar como padrão' + (lead.segmento ? ' de ' + esc(lead.segmento) : '') + '</button><button type="button" class="tq-btn" id="tqVolta">Voltar ao texto original</button></div>' +
        '<div class="tq-dica" id="tqDica" hidden>Variáveis: {cumprimento} {empresa} {nome} {tipo} {tipo_pl} {cidade} {produto} {meu_nome} {minha_empresa}</div>' +
        (f ? '' : '<div class="tq-aviso">Este lead não tem WhatsApp/telefone com DDD. Cadastre o número no lead para enviar.</div>') +
        '<button type="button" class="tq-wa" id="tqWa"' + (f ? '' : ' disabled') + '>' + (apiInfo ? 'Enviar pelo WhatsApp' : 'Abrir no WhatsApp') + '</button>' +
        (apiInfo ? '<div class="tq-dica">Envio pela ' + esc(apiInfo.provedor) + ' do WhatsApp.</div><div class="tq-linha"><button type="button" class="tq-btn" id="tqWaManual"' + (f ? '' : ' disabled') + '>Prefiro abrir no meu WhatsApp</button></div>' : '') +
        '<div id="tqRes"></div></div>';
      document.body.appendChild(ov);
      var msg = ov.querySelector('#tqMsg'), ta = ov.querySelector('#tqTa');
      var atual = texto;
      function fechar() { ov.remove(); document.removeEventListener('keydown', esc_); }
      function esc_(e) { if (e.key === 'Escape') fechar(); }
      document.addEventListener('keydown', esc_);
      function mostrar() { msg.textContent = atual; }
      mostrar();
      ov.addEventListener('click', function (e) { if (e.target === ov) fechar(); });
      ov.querySelector('.tq-x').onclick = fechar;

      var editando = false;
      ov.querySelector('#tqEd').onclick = function () {
        editando = !editando;
        ta.hidden = !editando; msg.hidden = editando;
        ov.querySelector('#tqSalvar').hidden = !editando;
        ov.querySelector('#tqDica').hidden = !editando;
        this.textContent = editando ? 'Concluir edição' : 'Editar mensagem';
        if (editando) { ta.value = base; ta.focus(); } else { atual = montar(lead, numero, ta.value.trim() || base); mostrar(); }
      };
      ov.querySelector('#tqCp').onclick = function () {
        if (editando) atual = montar(lead, numero, ta.value);
        (navigator.clipboard ? navigator.clipboard.writeText(atual) : Promise.reject()).then(function () { aviso('Mensagem copiada'); }).catch(function () { ta.hidden = false; ta.value = atual; ta.select(); });
      };
      ov.querySelector('#tqPad').onclick = function () {
        // grava o texto original (com as {variáveis}) como padrão deste tipo de comércio
        var bruto = ta.value.trim();
        api('/api/leads/modelos', { method: 'PUT', body: JSON.stringify({ toque: numero, segmento: lead.segmento || '*', texto: bruto }) })
          .then(function () { return carregarModelos(true); })
          .then(function () { base = bruto; aviso('Mensagem padrão salva'); });
      };
      ov.querySelector('#tqVolta').onclick = function () {
        api('/api/leads/modelos', { method: 'PUT', body: JSON.stringify({ toque: numero, segmento: lead.segmento || '*', texto: '' }) })
          .then(function () { return carregarModelos(true); })
          .then(function () { base = textoModelo(numero, lead.segmento); atual = montar(lead, numero); ta.value = base; mostrar(); aviso('Voltou ao texto original'); });
      };
      function disparar(btn, viaApi) {
        if (!f) return;
        if (editando) atual = montar(lead, numero, ta.value.trim() || base);
        var rotulo = btn.textContent;
        // wa.me: abre o WhatsApp primeiro (dentro do toque, para o navegador não bloquear) e só então registra
        if (!viaApi) abrirWhats(f, atual, ov.querySelector('#tqRes'));
        btn.disabled = true; btn.textContent = viaApi ? 'Enviando…' : 'Registrando…';
        api('/api/leads/' + lead.id + '/toque', { method: 'POST', body: JSON.stringify({ numero: numero, texto: atual, enviar: !!viaApi }) })
          .then(function (d) {
            var prox = d.proximo ? ' Próximo: ' + d.proximo + 'º toque' + (d.agendados && d.agendados.length ? ' (agendei o 2º em 3 dias e o 3º em 7)' : '') + '.' : ' Cadência concluída.';
            ov.querySelector('#tqRes').innerHTML = '<div class="tq-ok">✔ ' + numero + 'º toque ' + (viaApi ? 'enviado e registrado.' : 'registrado.') + esc(prox) + '</div>';
            btn.textContent = 'Feito';
            if (typeof opts.onDone === 'function') opts.onDone(d);
            setTimeout(fechar, /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? 2200 : 6000);
          })
          .catch(function (e) {
            btn.disabled = false; btn.textContent = rotulo;
            ov.querySelector('#tqRes').innerHTML = viaApi
              ? '<div class="tq-aviso">Não enviei: ' + esc(e.message) + ' Você pode usar "Prefiro abrir no meu WhatsApp".</div>'
              : '<div class="tq-aviso">Abri o WhatsApp, mas não consegui registrar o toque: ' + esc(e.message) + '</div>';
          });
      }
      ov.querySelector('#tqWa').onclick = function () { disparar(this, !!apiInfo); };
      var man = ov.querySelector('#tqWaManual');
      if (man) man.onclick = function () { disparar(this, false); };
    });
  }

  global.Toque = { abrir: abrir, montar: montar, carregarModelos: carregarModelos, api: api, numeroDo: numeroDo, fone: fone };
})(window);
