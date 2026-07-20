'use strict';

const { planoContasLegacyWriteFields, ensurePlanoContasSchema } = require('./plano-contas-schema');

/**
 * Estrutura padrão gerencial (não contábil formal).
 * Seed só INSERE números que ainda não existem — nunca altera/exclui.
 */
const PLANO_MODELO = [
  { numero: '1', descricao: 'ATIVO', tipo: 'SINTETICA', grupo: 'ATIVO', nivel: 1, pai: null },
  { numero: '1.1', descricao: 'Disponibilidades', tipo: 'SINTETICA', grupo: 'ATIVO', nivel: 2, pai: '1' },
  { numero: '1.1.01', descricao: 'Caixa e bancos', tipo: 'ANALITICA', grupo: 'ATIVO', nivel: 3, pai: '1.1' },

  { numero: '2', descricao: 'PASSIVO', tipo: 'SINTETICA', grupo: 'PASSIVO', nivel: 1, pai: null },
  { numero: '2.1', descricao: 'Obrigações', tipo: 'SINTETICA', grupo: 'PASSIVO', nivel: 2, pai: '2' },
  { numero: '2.1.01', descricao: 'Fornecedores a pagar', tipo: 'ANALITICA', grupo: 'PASSIVO', nivel: 3, pai: '2.1' },

  { numero: '3', descricao: 'RECEITAS', tipo: 'SINTETICA', grupo: 'RECEITA', nivel: 1, pai: null },
  { numero: '3.1', descricao: 'Receitas operacionais', tipo: 'SINTETICA', grupo: 'RECEITA', nivel: 2, pai: '3' },
  { numero: '3.1.01', descricao: 'Comissões / Representação', tipo: 'ANALITICA', grupo: 'RECEITA', nivel: 3, pai: '3.1' },
  { numero: '3.1.02', descricao: 'Outras receitas', tipo: 'ANALITICA', grupo: 'RECEITA', nivel: 3, pai: '3.1' },

  { numero: '4', descricao: 'DESPESAS', tipo: 'SINTETICA', grupo: 'DESPESA', nivel: 1, pai: null },
  { numero: '4.1', descricao: 'Despesas administrativas', tipo: 'SINTETICA', grupo: 'DESPESA', nivel: 2, pai: '4' },
  { numero: '4.1.01', descricao: 'Pessoal', tipo: 'ANALITICA', grupo: 'DESPESA', nivel: 3, pai: '4.1' },
  { numero: '4.1.02', descricao: 'Aluguel e condomínio', tipo: 'ANALITICA', grupo: 'DESPESA', nivel: 3, pai: '4.1' },
  { numero: '4.1.03', descricao: 'Energia / Água / Internet', tipo: 'ANALITICA', grupo: 'DESPESA', nivel: 3, pai: '4.1' },
  { numero: '4.1.04', descricao: 'Material de escritório', tipo: 'ANALITICA', grupo: 'DESPESA', nivel: 3, pai: '4.1' },
  { numero: '4.2', descricao: 'Despesas comerciais', tipo: 'SINTETICA', grupo: 'DESPESA', nivel: 2, pai: '4' },
  { numero: '4.2.01', descricao: 'Combustível / Viagens', tipo: 'ANALITICA', grupo: 'DESPESA', nivel: 3, pai: '4.2' },
  { numero: '4.2.02', descricao: 'Marketing / Propaganda', tipo: 'ANALITICA', grupo: 'DESPESA', nivel: 3, pai: '4.2' },
  { numero: '4.2.03', descricao: 'Telefone / Celular', tipo: 'ANALITICA', grupo: 'DESPESA', nivel: 3, pai: '4.2' },
  { numero: '4.3', descricao: 'Despesas financeiras', tipo: 'SINTETICA', grupo: 'DESPESA', nivel: 2, pai: '4' },
  { numero: '4.3.01', descricao: 'Tarifas bancárias / Juros', tipo: 'ANALITICA', grupo: 'DESPESA', nivel: 3, pai: '4.3' },
  { numero: '4.9', descricao: 'Outras despesas', tipo: 'SINTETICA', grupo: 'DESPESA', nivel: 2, pai: '4' },
  { numero: '4.9.01', descricao: 'Diversas', tipo: 'ANALITICA', grupo: 'DESPESA', nivel: 3, pai: '4.9' },
];

/**
 * Insere apenas contas cujo `numero` ainda não existe (excluido N).
 * Compatível com bases Delphi que exigem `numero_pai`.
 * @returns {{ inseridas: number, ignoradas: number, total_modelo: number }}
 */
async function seedPlanoContasModelo(pool) {
  await ensurePlanoContasSchema(pool);

  const byNumero = new Map();
  const [existentes] = await pool.query(
    `SELECT id, numero FROM plano_contas WHERE (excluido='N' OR excluido IS NULL) AND numero IS NOT NULL`
  );
  for (const r of existentes) {
    byNumero.set(String(r.numero).trim(), r.id);
  }

  let inseridas = 0;
  let ignoradas = 0;

  for (const item of PLANO_MODELO) {
    const num = String(item.numero).trim();
    if (byNumero.has(num)) {
      ignoradas += 1;
      continue;
    }
    const idPai = item.pai ? (byNumero.get(String(item.pai).trim()) || null) : null;
    const aceita = item.tipo === 'ANALITICA' ? 'S' : 'N';
    const leg = await planoContasLegacyWriteFields(pool, idPai);
    const [r] = await pool.query(
      `INSERT INTO plano_contas (numero, descricao, id_pai, nivel, tipo, grupo, aceita_lancamento, status, excluido${leg.insertCols})
       VALUES (?,?,?,?,?,?,?,'A','N'${leg.insertPlaceholders})`,
      [num, item.descricao, idPai, item.nivel, item.tipo, item.grupo, aceita, ...leg.values]
    );
    byNumero.set(num, r.insertId);
    inseridas += 1;
  }

  return { inseridas, ignoradas, total_modelo: PLANO_MODELO.length };
}

module.exports = { PLANO_MODELO, seedPlanoContasModelo };
