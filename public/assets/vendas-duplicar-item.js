/**
 * fornecedores.vendasduplicaritem — mesmo produto no pedido:
 * S = somar na linha existente | N = bloquear | D = permitir nova linha
 */
(function (global) {
  'use strict';

  function normalize(v) {
    const u = String(v == null ? 'S' : v).trim().toUpperCase();
    if (u === 'N' || u === 'D') return u;
    return 'S';
  }

  function consolida(v) { return normalize(v) === 'S'; }
  function bloqueia(v) { return normalize(v) === 'N'; }
  function permiteNovaLinha(v) { return normalize(v) === 'D'; }

  global.VendasDuplicarItem = {
    normalize,
    consolida,
    bloqueia,
    permiteNovaLinha,
  };
})(typeof window !== 'undefined' ? window : global);
