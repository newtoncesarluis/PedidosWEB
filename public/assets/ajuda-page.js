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

  function showSection(sec, updateUrl, navOpts) {
    navOpts = navOpts || {};
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

    var scrollOpts = navOpts;
    if (scrollOpts.scrollTop !== false) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
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

  window.__ajudaNavigateSec = function (sec, opts) {
    showSection(sec, true, opts || {});
  };

  return { showSection: showSection };
}

function normalizarHelpQuery(txt) {
  return String(txt || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function pontuarHelpTopic(item, query) {
  if (!query) return 0;
  var q = normalizarHelpQuery(query);
  var title = normalizarHelpQuery(item.title);
  var keywords = normalizarHelpQuery(item.keywords);
  var text = normalizarHelpQuery(item.text);
  var score = 0;
  if (title.includes(q)) score += 12;
  if (keywords.includes(q)) score += 10;
  if (text.includes(q)) score += 3;
  q.split(/\s+/).filter(Boolean).forEach(function (token) {
    if (token.length < 2) return;
    if (title.includes(token)) score += 4;
    if (keywords.includes(token)) score += 5;
    if (text.includes(token)) score += 1;
  });
  return score;
}

function escHelpHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function initHelpTopicSearch(options) {
  options = options || {};
  var input = document.getElementById('helpTopicSearch');
  var resultsEl = document.getElementById('helpTopicResults');
  var noteEl = document.getElementById('helpTopicNote');
  if (!input || !resultsEl) return;

  var secLabels = Object.assign({
    preposto: 'Comissão do preposto',
    vendedor: 'Para o vendedor',
    gestor: 'Para o gestor',
    conciliacao: 'Conciliação com fábrica',
    status: 'Status e significados'
  }, options.secLabels || {});

  function buildIndex() {
    var items = [];
    document.querySelectorAll('[data-help-topic]').forEach(function (el) {
      var sec = el.getAttribute('data-help-sec') || (el.closest('.help-section') && el.closest('.help-section').id) || '';
      items.push({
        el: el,
        sec: sec,
        title: el.getAttribute('data-help-title') || ((el.querySelector('.step-label') || {}).textContent || '').trim(),
        keywords: el.getAttribute('data-help-keywords') || '',
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 420)
      });
    });
    document.querySelectorAll('.help-section[data-help-keywords]').forEach(function (sec) {
      var titleEl = sec.querySelector('.section-title') || sec.querySelector('h3');
      items.push({
        el: sec,
        sec: sec.id,
        title: titleEl ? titleEl.textContent.trim() : sec.id,
        keywords: sec.getAttribute('data-help-keywords') || '',
        text: (sec.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500),
        isSection: true
      });
    });
    return items;
  }

  var index = buildIndex();
  var autoTimer = null;
  var lastAutoQuery = '';

  function highlightEl(el) {
    if (!el) return;
    el.classList.remove('help-topic-hit');
    void el.offsetWidth;
    el.classList.add('help-topic-hit');
    setTimeout(function () { el.classList.remove('help-topic-hit'); }, 2600);
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function goToItem(item, query) {
    clearTimeout(autoTimer);
    if (noteEl) noteEl.style.display = 'none';

    if (typeof window.__ajudaNavigateSec === 'function') {
      window.__ajudaNavigateSec(item.sec, { scrollTop: false });
    }

    setTimeout(function () { highlightEl(item.el); }, 140);

    var url = new URL(window.location.href);
    url.searchParams.set('sec', item.sec);
    if (query) url.searchParams.set('q', query);
    else url.searchParams.delete('q');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }

  function shouldAutoGo(query, ranked) {
    var q = normalizarHelpQuery(query);
    if (!q || q.length < 8 || !ranked.length) return false;
    var best = ranked[0];
    if (!best || best.score < 14) return false;
    var title = normalizarHelpQuery(best.item.title);
    var keywords = normalizarHelpQuery(best.item.keywords);
    return title.includes(q) || keywords.includes(q) || best.score >= 20;
  }

  function render(query) {
    clearTimeout(autoTimer);
    if (noteEl) {
      noteEl.style.display = 'none';
      noteEl.textContent = '';
    }

    var q = normalizarHelpQuery(query);
    if (!q || q.length < 2) {
      resultsEl.hidden = true;
      resultsEl.innerHTML = '';
      resultsEl._ranked = [];
      return;
    }

    var ranked = index.map(function (item) {
      return { item: item, score: pontuarHelpTopic(item, query) };
    }).filter(function (row) { return row.score > 0; })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, 8);

    resultsEl._ranked = ranked;

    if (!ranked.length) {
      resultsEl.hidden = false;
      resultsEl.innerHTML = '<p class="help-topic-empty">Nenhum resultado para <strong>' + escHelpHtml(query) + '</strong>. Tente: <em>preposto</em>, <em>gerar comissão</em>, <em>conferir</em>, <em>pagar</em> ou <em>conciliação</em>.</p>';
      return;
    }

    resultsEl.hidden = false;
    resultsEl.innerHTML = ranked.map(function (row, idx) {
      var item = row.item;
      var secLabel = secLabels[item.sec] || item.sec;
      var excerpt = item.text.slice(0, 150);
      return '<button type="button" class="help-topic-result" data-idx="' + idx + '">' +
        '<span class="help-topic-result-title">' + escHelpHtml(item.title) + '</span>' +
        '<span class="help-topic-result-meta">' + escHelpHtml(secLabel) + '</span>' +
        '<span class="help-topic-result-snippet">' + escHelpHtml(excerpt) + (item.text.length > 150 ? '…' : '') + '</span>' +
        '</button>';
    }).join('');

    resultsEl.querySelectorAll('.help-topic-result').forEach(function (btn) {
      btn.addEventListener('click', function () {
        goToItem(ranked[+btn.getAttribute('data-idx')].item, query);
      });
    });

    if (shouldAutoGo(query, ranked) && lastAutoQuery !== q) {
      lastAutoQuery = q;
      if (noteEl) {
        noteEl.textContent = 'Melhor correspondência: "' + ranked[0].item.title + '". Abrindo o passo…';
        noteEl.style.display = 'block';
      }
      autoTimer = setTimeout(function () {
        goToItem(ranked[0].item, query);
      }, 360);
    }
  }

  input.addEventListener('input', function () { render(input.value); });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && resultsEl._ranked && resultsEl._ranked.length) {
      e.preventDefault();
      goToItem(resultsEl._ranked[0].item, input.value);
    }
  });

  document.querySelectorAll('[data-help-chip]').forEach(function (chip) {
    chip.addEventListener('click', function () {
      input.value = chip.getAttribute('data-help-chip') || chip.textContent.trim();
      input.focus();
      render(input.value);
    });
  });

  var qParam = new URLSearchParams(window.location.search).get('q');
  if (qParam) {
    input.value = qParam;
    render(qParam);
  }
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
    if (document.body.classList.contains('help-page--topic-search')) {
      initHelpTopicSearch();
    }
  }
});
