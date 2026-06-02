(function (global) {
  'use strict';

  var _registry = {};
  var _state = null;

  function ensureRoot() {
    var root = document.getElementById('sysrep-tour-root');
    if (root) return root;

    root = document.createElement('div');
    root.id = 'sysrep-tour-root';
    root.hidden = true;
    root.innerHTML =
      '<div class="sysrep-tour-backdrop" data-tour-close></div>' +
      '<div class="sysrep-tour-hole" aria-hidden="true"></div>' +
      '<div class="sysrep-tour-popover" role="dialog" aria-modal="true" aria-live="polite">' +
        '<div class="sysrep-tour-step-label"></div>' +
        '<h3 class="sysrep-tour-title"></h3>' +
        '<p class="sysrep-tour-text"></p>' +
        '<div class="sysrep-tour-actions">' +
          '<button type="button" class="sysrep-tour-btn sysrep-tour-btn-ghost" data-tour-sair>Sair</button>' +
          '<span class="sysrep-tour-actions-spacer"></span>' +
          '<button type="button" class="sysrep-tour-btn" data-tour-prev>Anterior</button>' +
          '<button type="button" class="sysrep-tour-btn sysrep-tour-btn-primary" data-tour-next>Próximo</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(root);

    root.querySelector('[data-tour-close]').addEventListener('click', stop);
    root.querySelector('[data-tour-sair]').addEventListener('click', stop);
    root.querySelector('[data-tour-prev]').addEventListener('click', prev);
    root.querySelector('[data-tour-next]').addEventListener('click', next);

    document.addEventListener('keydown', function (e) {
      if (!_state) return;
      if (e.key === 'Escape') stop();
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    });

    return root;
  }

  function register(id, tour) {
    _registry[id] = tour;
  }

  function registerMany(map) {
    Object.keys(map).forEach(function (id) {
      register(id, map[id]);
    });
  }

  function resolveTour(idOrTour) {
    if (typeof idOrTour === 'string') return _registry[idOrTour] || null;
    return idOrTour || null;
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function isVisible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    var st = window.getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden' && st.opacity !== '0';
  }

  function scrollToTarget(el) {
    if (!el) return Promise.resolve();
    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    return wait(320);
  }

  function positionPopover(root, targetRect, placement) {
    var pop = root.querySelector('.sysrep-tour-popover');
    var pad = 14;
    var gap = 12;
    pop.classList.remove('is-center');
    pop.style.top = '';
    pop.style.left = '';

    if (!targetRect || placement === 'center') {
      pop.classList.add('is-center');
      return;
    }

    var popRect = pop.getBoundingClientRect();
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var top = 0;
    var left = 0;
    var place = placement || 'auto';

    if (place === 'auto') {
      if (targetRect.bottom + gap + popRect.height < vh - pad) place = 'bottom';
      else if (targetRect.top - gap - popRect.height > pad) place = 'top';
      else place = 'bottom';
    }

    if (place === 'bottom') {
      top = targetRect.bottom + gap;
      left = targetRect.left + (targetRect.width / 2) - (popRect.width / 2);
    } else if (place === 'top') {
      top = targetRect.top - gap - popRect.height;
      left = targetRect.left + (targetRect.width / 2) - (popRect.width / 2);
    } else if (place === 'left') {
      top = targetRect.top + (targetRect.height / 2) - (popRect.height / 2);
      left = targetRect.left - gap - popRect.width;
    } else if (place === 'right') {
      top = targetRect.top + (targetRect.height / 2) - (popRect.height / 2);
      left = targetRect.right + gap;
    }

    left = Math.max(pad, Math.min(left, vw - popRect.width - pad));
    top = Math.max(pad, Math.min(top, vh - popRect.height - pad));

    pop.style.top = top + 'px';
    pop.style.left = left + 'px';
  }

  function positionHole(hole, rect, padding) {
    if (!rect) {
      hole.style.display = 'none';
      return;
    }
    hole.style.display = 'block';
    var p = padding == null ? 8 : padding;
    hole.style.top = (rect.top - p) + 'px';
    hole.style.left = (rect.left - p) + 'px';
    hole.style.width = (rect.width + p * 2) + 'px';
    hole.style.height = (rect.height + p * 2) + 'px';
  }

  async function renderStep() {
    if (!_state) return;

    var root = ensureRoot();
    var tour = _state.tour;
    var step = tour.steps[_state.index];
    var hole = root.querySelector('.sysrep-tour-hole');
    var pop = root.querySelector('.sysrep-tour-popover');

    pop.classList.remove('is-visible');

    if (typeof step.beforeShow === 'function') {
      await step.beforeShow();
    }

    await wait(step.delay || 80);

    var target = null;
    if (step.selector) {
      target = document.querySelector(step.selector);
      if (target && !isVisible(target) && step.fallbackSelector) {
        target = document.querySelector(step.fallbackSelector);
      }
    }

    if (target) {
      await scrollToTarget(target);
    }

    var rect = target ? target.getBoundingClientRect() : null;
    var useCenter = !target || step.placement === 'center';

    positionHole(hole, useCenter ? null : rect, step.padding);
    hole.classList.toggle('is-pulse', !!target && step.highlight !== false);

    root.querySelector('.sysrep-tour-step-label').textContent =
      'Passo ' + (_state.index + 1) + ' de ' + tour.steps.length;
    root.querySelector('.sysrep-tour-title').textContent = step.title || '';
    root.querySelector('.sysrep-tour-text').innerHTML = step.text || '';

    var btnPrev = root.querySelector('[data-tour-prev]');
    var btnNext = root.querySelector('[data-tour-next]');
    btnPrev.hidden = _state.index === 0;
    btnNext.textContent = _state.index >= tour.steps.length - 1 ? 'Concluir' : 'Próximo';

    requestAnimationFrame(function () {
      positionPopover(root, useCenter ? null : rect, step.placement);
      requestAnimationFrame(function () {
        pop.classList.add('is-visible');
      });
    });
  }

  async function goTo(index) {
    if (!_state) return;
    var tour = _state.tour;
    if (index < 0 || index >= tour.steps.length) return;
    _state.index = index;
    await renderStep();
  }

  function next() {
    if (!_state) return;
    if (_state.index >= _state.tour.steps.length - 1) {
      stop();
      return;
    }
    goTo(_state.index + 1);
  }

  function prev() {
    if (!_state) return;
    if (_state.index <= 0) return;
    goTo(_state.index - 1);
  }

  async function start(idOrTour) {
    var tour = resolveTour(idOrTour);
    if (!tour || !tour.steps || !tour.steps.length) return false;

    stop();

    var root = ensureRoot();
    _state = { tour: tour, index: 0 };

    root.hidden = false;
    root.classList.add('is-active');
    document.body.classList.add('sysrep-tour-active');

    if (typeof tour.onStart === 'function') {
      await tour.onStart();
    }

    await renderStep();
    return true;
  }

  function stop() {
    if (!_state) {
      var rootIdle = document.getElementById('sysrep-tour-root');
      if (rootIdle) {
        rootIdle.hidden = true;
        rootIdle.classList.remove('is-active');
      }
      document.body.classList.remove('sysrep-tour-active');
      return;
    }

    var tour = _state.tour;
    if (typeof tour.onStop === 'function') {
      tour.onStop();
    }

    _state = null;

    var root = document.getElementById('sysrep-tour-root');
    if (root) {
      root.classList.remove('is-active');
      root.hidden = true;
      root.querySelector('.sysrep-tour-popover').classList.remove('is-visible', 'is-center');
      root.querySelector('.sysrep-tour-hole').style.display = 'none';
    }
    document.body.classList.remove('sysrep-tour-active');
  }

  function initFromUrl() {
    var params = new URLSearchParams(window.location.search);
    var tourId = params.get('tour');
    if (!tourId) return;
    if (tourId === '1' && document.body.dataset.tourDefault) {
      tourId = document.body.dataset.tourDefault;
    }
    if (_registry[tourId]) {
      setTimeout(function () { start(tourId); }, 450);
    }
  }

  global.SysRepTour = {
    register: register,
    registerMany: registerMany,
    start: start,
    stop: stop,
    next: next,
    prev: prev
  };

  document.addEventListener('DOMContentLoaded', initFromUrl);
})(window);
