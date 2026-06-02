/**
 * Entrada pública: landing/migração só para visitantes novos.
 * Quem já entrou no sistema vai para login; quem está logado vai para o app.
 * ?preview — não redireciona (edição/visualização)
 * ?novo=1 — força ver a landing mesmo após uso anterior (links de campanha internos)
 */
(function () {
  var q = new URLSearchParams(location.search);
  if (q.has('preview')) return;

  var token = sessionStorage.getItem('token') || localStorage.getItem('token');
  if (token) {
    location.replace('/home.html');
    return;
  }

  if (localStorage.getItem('sysrep_has_used_system') === '1' && !q.has('novo')) {
    location.replace('/login.html');
  }
})();
