function abrirCentralAjuda() {
  const page = '/pages/ajuda.html';
  if (window.parent && typeof window.parent.openTab === 'function') {
    window.parent.openTab(page, 'Ajuda');
    return;
  }
  window.location.href = page;
}

function abrirTourTela(page, tourId, tabLabel) {
  var base = page || '';
  var sep = base.indexOf('?') >= 0 ? '&' : '?';
  var url = base + sep + 'tour=' + encodeURIComponent(tourId || '1');
  if (window.parent && typeof window.parent.openTab === 'function') {
    window.parent.openTab(url, tabLabel || 'Tour');
    return;
  }
  window.location.href = url;
}

function initAjudaPage(options) {
  options = options || {};
  const sections = Array.from(document.querySelectorAll('.help-section'));
  if (!sections.length) return;

  const validIds = sections.map(function (s) { return s.id; }).filter(Boolean);
  const defaultSec = options.defaultSec || validIds[0];

  function resolveSec(sec) {
    if (sec && validIds.indexOf(sec) !== -1) return sec;
    return defaultSec;
  }

  function showSection(sec, updateUrl) {
    const active = resolveSec(sec);

    sections.forEach(function (el) {
      el.hidden = el.id !== active;
    });

    document.querySelectorAll('.nav-link[href^="?sec="]').forEach(function (link) {
      var linkSec = (link.getAttribute('href') || '').replace('?sec=', '');
      link.classList.toggle('is-active', linkSec === active);
    });

    var target = document.getElementById(active);
    if (target) {
      target.classList.remove('target-focus');
      void target.offsetWidth;
      target.classList.add('target-focus');
      setTimeout(function () { target.classList.remove('target-focus'); }, 2200);
    }

    if (updateUrl !== false) {
      var url = new URL(window.location.href);
      if (active === defaultSec && !sec) {
        url.searchParams.delete('sec');
      } else {
        url.searchParams.set('sec', active);
      }
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    }

    var navAuto = document.querySelector('.help-page .nav-card.nav-auto-hide');
    if (navAuto) navAuto.classList.remove('is-hidden');

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  document.querySelectorAll('.nav-link[href^="?sec="]').forEach(function (link) {
    link.addEventListener('click', function (e) {
      e.preventDefault();
      var sec = (link.getAttribute('href') || '').replace('?sec=', '');
      showSection(sec);
    });
  });

  var initialSec = new URLSearchParams(window.location.search).get('sec');
  showSection(initialSec, false);

  window.addEventListener('popstate', function () {
    var sec = new URLSearchParams(window.location.search).get('sec');
    showSection(sec, false);
  });

  initHelpNavAutoHide();
}

function initHelpNavAutoHide() {
  var nav = document.querySelector('.help-page .nav-card');
  if (!nav) return;

  nav.classList.add('nav-auto-hide');

  var lastY = window.scrollY || 0;
  var ticking = false;
  var THRESH = 10;
  var TOP = 48;

  function setVisible(show) {
    nav.classList.toggle('is-hidden', !show);
  }

  function onScroll() {
    var y = window.scrollY || 0;
    if (y <= TOP) {
      setVisible(true);
    } else if (y > lastY + THRESH) {
      setVisible(false);
    } else if (y < lastY - THRESH) {
      setVisible(true);
    }
    lastY = y;
    ticking = false;
  }

  window.addEventListener('scroll', function () {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(onScroll);
    }
  }, { passive: true });

  setVisible(true);
}

document.addEventListener('DOMContentLoaded', function () {
  if (document.body.classList.contains('help-page')) {
    initAjudaPage();
  }
});
