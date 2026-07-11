/**
 * Helpers de status de comissão — espelha config/comissao-status.js no browser.
 */
(function (global) {
  'use strict';

  const STATUS_MAP = {
    P: { label: 'Pendente', badge: 'bg-pendente' },
    C: { label: 'Conferido', badge: 'bg-conferido' },
    R: { label: 'Pago', badge: 'bg-pago' },
    I: { label: 'Inadimplente', badge: 'bg-inadimplente' },
    G: { label: 'Gerada', badge: 'bg-pendente' },
  };

  function label(code) {
    const c = String(code || '').toUpperCase();
    return STATUS_MAP[c]?.label || c || '—';
  }

  function badgeClass(code) {
    const c = String(code || '').toUpperCase();
    return STATUS_MAP[c]?.badge || 'bg-pendente';
  }

  function badgeHtml(code) {
    return `<span class="badge ${badgeClass(code)}">${label(code)}</span>`;
  }

  /** Gera CSV e dispara download (BOM UTF-8 para Excel). */
  function downloadCsv(filename, headers, rows) {
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.map(esc).join(';')].concat(
      rows.map((r) => r.map(esc).join(';'))
    );
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 500);
  }

  global.ComissaoStatusUi = { STATUS_MAP, label, badgeClass, badgeHtml, downloadCsv };
})(window);
