/**
 * Status de pagtocomissao — rótulos e filtros unificados (back + front).
 * P=Pendente, C=Conferido, R=Pago/Liquidado, I=Inadimplente, T=Todos
 */
const STATUS_MAP = {
  P: { label: 'Pendente', badge: 'pendente' },
  C: { label: 'Conferido', badge: 'conferido' },
  R: { label: 'Pago', badge: 'pago' },
  I: { label: 'Inadimplente', badge: 'inadimplente' },
  G: { label: 'Gerada', badge: 'pendente' },
};

function statusLabel(code) {
  const c = String(code || '').toUpperCase();
  return STATUS_MAP[c]?.label || c || '—';
}

function statusBadgeKey(code) {
  const c = String(code || '').toUpperCase();
  return STATUS_MAP[c]?.badge || 'pendente';
}

/** SQL CASE para rótulo em queries */
const SQL_STATUS_LABEL = `
  CASE pc.status
    WHEN 'P' THEN 'Pendente'
    WHEN 'C' THEN 'Conferido'
    WHEN 'R' THEN 'Pago'
    WHEN 'I' THEN 'Inadimplente'
    ELSE pc.status
  END`;

function applyStatusFilter(whereParts, params, status) {
  if (!status || status === 'T') return;
  if (status === 'Q') {
    whereParts.push(`pc.status IN ('R','C')`);
    return;
  }
  whereParts.push('pc.status = ?');
  params.push(status);
}

module.exports = {
  STATUS_MAP,
  statusLabel,
  statusBadgeKey,
  SQL_STATUS_LABEL,
  applyStatusFilter,
};
