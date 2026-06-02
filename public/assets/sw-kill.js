/** Remove SW legado em localhost (evita sw.js:86 Failed to fetch em /pages/). */
(function () {
  var h = location.hostname;
  if (h !== 'localhost' && h !== '127.0.0.1') return;
  if (!navigator.serviceWorker) return;
  navigator.serviceWorker.getRegistrations().then(function (regs) {
    return Promise.all(regs.map(function (r) { return r.unregister(); }));
  }).catch(function () {});
})();
