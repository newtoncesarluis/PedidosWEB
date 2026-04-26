'use strict';

/**
 * Valida CPF (11 dígitos) ou CNPJ (14 dígitos)
 * Remove pontuação antes de validar
 */
function validarCpfCnpj(doc) {
  if (!doc) return false;
  const limpo = doc.replace(/\D/g, '');
  if (limpo.length === 11) return validarCPF(limpo);
  if (limpo.length === 14) return validarCNPJ(limpo);
  return false;
}

/**
 * Valida CPF
 */
function validarCPF(cpf) {
  const c = cpf.replace(/\D/g, '');
  if (c.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(c)) return false;

  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(c[i]) * (10 - i);
  let resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(c[9])) return false;

  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(c[i]) * (11 - i);
  resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  return resto === parseInt(c[10]);
}

/**
 * Valida CNPJ — usado também para consulta na Receita Federal
 */
function validarCNPJ(cnpj) {
  const c = cnpj.replace(/\D/g, '');
  if (c.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(c)) return false;

  const calc = (str, pesos) => {
    let soma = 0;
    for (let i = 0; i < pesos.length; i++) soma += parseInt(str[i]) * pesos[i];
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const d1 = calc(c, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (d1 !== parseInt(c[12])) return false;
  const d2 = calc(c, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d2 === parseInt(c[13]);
}

/**
 * Valida campos obrigatórios do cliente
 * @param {object} body - corpo da requisição
 * @param {object} config - configuração do sistema (registro da tabela sistemas)
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validarCliente(body, config = {}) {
  const errors = [];

  if (!body.nome || !String(body.nome).trim()) {
    errors.push('Nome é obrigatório');
  }

  // Se o sistema estiver configurado para FAST, ramo de atividades é obrigatório
  if (config.gcostumizadopara === 'FAST') {
    if (!body.ramoatividades || !String(body.ramoatividades).trim()) {
      errors.push('Ramo de atividades é obrigatório');
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { validarCpfCnpj, validarCNPJ, validarCliente };
