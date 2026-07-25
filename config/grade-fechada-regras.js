/**
 * Grade fechada (pack): total de pares deve ser múltiplo de multiplo_grade.
 * Grade aberta (padrão): sem restrição — não altera comportamento legado.
 */

function normalizarModoGrade(v) {
  return String(v || 'A').toUpperCase() === 'F' ? 'F' : 'A';
}

function normalizarMultiploGrade(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 1 ? n : 0;
}

/**
 * @returns {string[]} mensagens de erro (vazio = ok)
 */
function validarTotalGradeFechada(total, modo, multiplo, descProd) {
  const erros = [];
  const modoN = normalizarModoGrade(modo);
  const mv = normalizarMultiploGrade(multiplo);
  if (modoN !== 'F' || mv < 2) return erros;

  const q = parseFloat(total) || 0;
  const nome = descProd || 'Produto';
  if (q <= 0) {
    erros.push(`«${nome}» usa grade fechada (múltiplo de ${mv}). Informe as quantidades por tamanho.`);
    return erros;
  }
  if (Math.abs(q % mv) > 0.0001) {
    erros.push(
      `«${nome}» usa grade fechada. O total deve ser múltiplo de ${mv} (ex.: ${mv}, ${mv * 2}…). Atual: ${q}.`
    );
  }
  return erros;
}

function hintGradeFechada(modo, multiplo) {
  const modoN = normalizarModoGrade(modo);
  const mv = normalizarMultiploGrade(multiplo);
  if (modoN !== 'F' || mv < 2) return '';
  return `Grade fechada · múltiplo de ${mv}`;
}

module.exports = {
  normalizarModoGrade,
  normalizarMultiploGrade,
  validarTotalGradeFechada,
  hintGradeFechada,
};
