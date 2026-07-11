/**
 * Fetch autenticado para APIs SysRepWeb (JWT Bearer).
 */
(function (global) {
  function authToken() {
    if (global.ComissaoPrepostoUi && typeof global.ComissaoPrepostoUi.authToken === 'function') {
      return global.ComissaoPrepostoUi.authToken();
    }
    try {
      const fromCookie = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('token='));
      if (fromCookie) return decodeURIComponent(fromCookie.split('=').slice(1).join('='));
    } catch (_) {}
    return global.localStorage.getItem('token')
      || global.sessionStorage.getItem('token')
      || global.sessionStorage.getItem('sysrep_token')
      || '';
  }

  async function apiFetch(url, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (opts.body != null && headers['Content-Type'] == null && !(opts.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }
    const token = authToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, { ...opts, headers, credentials: 'include' });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      const _p = (global.top || global).location.pathname;
      if (_p !== '/login.html' && _p !== '/demo-bemvindo.html' && _p !== '/setup.html') {
        // Limpar token inválido para que login mostre o formulário em vez de redirecionar de volta
        try { global.localStorage.removeItem('token'); global.sessionStorage.removeItem('token'); global.sessionStorage.removeItem('sysrep_token'); global.document.cookie = 'token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax'; } catch (_) {}
        setTimeout(() => { (global.top || global).location.href = '/login.html'; }, 1200);
      }
      throw new Error(data.error || 'Sessão expirada — faça login novamente');
    }
    if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
    return data;
  }

  global.SysRepApi = { authToken, fetch: apiFetch, apiFetch };
})(window);
