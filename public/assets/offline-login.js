/**
 * Login offline — permite entrar sem internet usando a última sessão validada online.
 *
 * Segurança: a senha NUNCA é gravada. No login online guardamos um hash PBKDF2
 * (SHA-256, 100k iterações, salt aleatório por usuário). No login offline a senha
 * digitada é derivada com o mesmo salt e comparada. Validade: 7 dias (janela do
 * pacote offline). A sessão restaurada só serve para o modo offline — ao voltar
 * online, APIs com token expirado exigem login normal.
 */
(function (global) {
  'use strict';

  var KEY = 'sysrep_offline_cred_v1';
  var VALIDADE_DIAS = 7;
  var ITER = 100000;

  function _lerTodos() {
    try {
      var raw = localStorage.getItem(KEY);
      var obj = raw ? JSON.parse(raw) : {};
      return obj && typeof obj === 'object' ? obj : {};
    } catch (_) { return {}; }
  }

  function _gravarTodos(map) {
    try { localStorage.setItem(KEY, JSON.stringify(map)); } catch (_) {}
  }

  function _hex(buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (b) {
      return ('0' + b.toString(16)).slice(-2);
    }).join('');
  }

  function _hexToBytes(hex) {
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  function _suporta() {
    return !!(global.crypto && global.crypto.subtle && global.TextEncoder);
  }

  async function _derivar(senha, saltHex, iter) {
    var enc = new TextEncoder();
    var km = await crypto.subtle.importKey('raw', enc.encode(String(senha)), 'PBKDF2', false, ['deriveBits']);
    var bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: _hexToBytes(saltHex), iterations: iter || ITER, hash: 'SHA-256' },
      km, 256
    );
    return _hex(bits);
  }

  /** Chamar após login ONLINE bem-sucedido. sess = { token, user, empresa, parametros_locais } */
  async function salvar(loginusu, senha, sess) {
    if (!_suporta() || !loginusu || !senha || !sess || !sess.token) return false;
    try {
      var salt = _hex(crypto.getRandomValues(new Uint8Array(16)));
      var hash = await _derivar(senha, salt, ITER);
      var map = _lerTodos();
      map[String(loginusu).trim().toLowerCase()] = {
        salt: salt,
        hash: hash,
        iter: ITER,
        token: sess.token,
        user: sess.user || null,
        empresa: sess.empresa || null,
        parametros_locais: sess.parametros_locais || null,
        savedAt: Date.now()
      };
      _gravarTodos(map);
      return true;
    } catch (_) { return false; }
  }

  /**
   * Tenta login offline. Retorna:
   *  { ok:true, sess }              — senha confere, sessão restaurada nos storages
   *  { ok:false, motivo:'sem_cadastro' }  — usuário nunca logou online neste aparelho
   *  { ok:false, motivo:'expirado' }      — último login online há mais de 7 dias
   *  { ok:false, motivo:'senha' }         — senha não confere com a última usada
   *  { ok:false, motivo:'sem_suporte' }   — navegador sem WebCrypto
   */
  async function tentar(loginusu, senha) {
    if (!_suporta()) return { ok: false, motivo: 'sem_suporte' };
    var cred = _lerTodos()[String(loginusu || '').trim().toLowerCase()];
    if (!cred || !cred.hash || !cred.salt) return { ok: false, motivo: 'sem_cadastro' };
    if (Date.now() - (cred.savedAt || 0) > VALIDADE_DIAS * 86400000) return { ok: false, motivo: 'expirado' };
    var h;
    try { h = await _derivar(senha, cred.salt, cred.iter); } catch (_) { return { ok: false, motivo: 'sem_suporte' }; }
    if (h !== cred.hash) return { ok: false, motivo: 'senha' };

    try {
      sessionStorage.setItem('token', cred.token);
      localStorage.setItem('token', cred.token);
      if (cred.user) {
        sessionStorage.setItem('user', JSON.stringify(cred.user));
        localStorage.setItem('user', JSON.stringify(cred.user));
      }
      if (cred.empresa) {
        sessionStorage.setItem('empresa', JSON.stringify(cred.empresa));
        localStorage.setItem('empresa', JSON.stringify(cred.empresa));
      }
      if (cred.parametros_locais) {
        sessionStorage.setItem('parametros_locais', JSON.stringify(cred.parametros_locais));
        localStorage.setItem('parametros_locais', JSON.stringify(cred.parametros_locais));
      }
      localStorage.setItem('sysrep_has_used_system', '1');
    } catch (_) {}
    return { ok: true, sess: cred };
  }

  function limpar(loginusu) {
    if (!loginusu) { try { localStorage.removeItem(KEY); } catch (_) {} return; }
    var map = _lerTodos();
    delete map[String(loginusu).trim().toLowerCase()];
    _gravarTodos(map);
  }

  global.SysRepOfflineLogin = { salvar: salvar, tentar: tentar, limpar: limpar, suporta: _suporta };
})(window);
