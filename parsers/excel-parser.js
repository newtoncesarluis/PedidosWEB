const XLSX = require('xlsx');

/**
 * Layout esperado (colunas):
 *  0 — cod_fabricante
 *  1 — quantidade
 *  2 — valor_unitario
 *  3 — total  (opcional; se ausente calcula qty * vlr)
 *
 * Ignora a 1ª linha se parecer cabeçalho (texto na col 0).
 */
function parseExcelPedido(buffer) {
  let wb;
  try {
    wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  } catch (e) {
    throw new Error(`Falha ao ler o arquivo: ${e.message}`);
  }

  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  if (!rows.length) throw new Error('Planilha vazia.');

  // Detecta cabeçalho: se col 0 da primeira linha é texto (não número)
  const primeiraCol = String(rows[0]?.[0] ?? '').trim().toLowerCase();
  const temCabecalho = isNaN(Number(primeiraCol.replace(',', '.'))) && primeiraCol !== '';
  const inicio = temCabecalho ? 1 : 0;

  const _num = v => parseFloat(String(v ?? '').replace(',', '.').replace(/\s/g, '')) || 0;

  const items = [];
  for (let i = inicio; i < rows.length; i++) {
    const row = rows[i];
    const codFabricante = String(row[0] ?? '').trim();
    if (!codFabricante) continue;

    const quantidade    = _num(row[1]);
    const valorUnitario = _num(row[2]);
    const totalLinha    = _num(row[3]) || parseFloat((quantidade * valorUnitario).toFixed(4));

    if (quantidade <= 0 && valorUnitario <= 0) continue;

    items.push({
      sequencial:     items.length + 1,
      cod_fabricante: codFabricante,
      cod_barras:     '',
      descricao:      '',
      quantidade,
      valor_unitario: valorUnitario,
      total_produtos: totalLinha,
      // campos IPI/ST zerados (não vêm da planilha)
      ipi: 0, vlr_ipi: 0, st: 0, vlr_st: 0, icms: 0
    });
  }

  if (!items.length) throw new Error('Nenhuma linha válida encontrada na planilha.');
  return items;
}

module.exports = { parseExcelPedido };
