'use strict';

/**
 * Movimentação de saldo em `bancos` ao liquidar / estornar títulos.
 * Cada baixa grava linha em `banco_movimentos` para auditoria e estorno.
 */

const { addColIfMissing } = require('./plano-contas-schema');

const _schemaDone = new Set();

async function dbNameOf(pool) {
  try {
    const [[row]] = await pool.query('SELECT DATABASE() AS db');
    return row?.db || '';
  } catch (_) {
    return '';
  }
}

async function ensureBancoMovimentoSchema(pool) {
  if (!pool?.query) return;
  const db = await dbNameOf(pool);
  if (_schemaDone.has(db)) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bancos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nome VARCHAR(100) NOT NULL,
      apelido VARCHAR(50) DEFAULT NULL,
      num_banco VARCHAR(10) DEFAULT NULL,
      agencia VARCHAR(20) DEFAULT NULL,
      conta VARCHAR(20) DEFAULT NULL,
      observacao TEXT,
      saldo DECIMAL(15,2) DEFAULT 0.00,
      status CHAR(1) DEFAULT 'A',
      excluido CHAR(1) DEFAULT 'N',
      dt_cadastro DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3
  `).catch(() => {});

  await addColIfMissing(pool, 'bancos', 'saldo', 'DECIMAL(15,2) DEFAULT 0.00');
  await addColIfMissing(pool, 'pagar', 'id_banco', 'INT NULL DEFAULT NULL');
  await addColIfMissing(pool, 'receber', 'id_banco', 'INT NULL DEFAULT NULL');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS banco_movimentos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      id_banco INT NOT NULL,
      tipo VARCHAR(10) NOT NULL,
      valor DECIMAL(15,2) NOT NULL DEFAULT 0,
      saldo_anterior DECIMAL(15,2) DEFAULT 0,
      saldo_posterior DECIMAL(15,2) DEFAULT 0,
      origem VARCHAR(20) NOT NULL,
      id_origem INT NOT NULL,
      data_mov DATE NOT NULL,
      historico VARCHAR(255) DEFAULT NULL,
      excluido CHAR(1) DEFAULT 'N',
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_bm_banco (id_banco),
      INDEX idx_bm_origem (origem, id_origem),
      INDEX idx_bm_data (data_mov)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3
  `).catch(() => {});

  _schemaDone.add(db);
}

function parseValorMov(v) {
  const n = parseFloat(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100) / 100;
}

function parseIdBanco(v) {
  const id = parseInt(v, 10);
  return id > 0 ? id : null;
}

/**
 * Lista bancos ativos para combo de liquidação.
 */
async function listBancosAtivosLookup(pool) {
  await ensureBancoMovimentoSchema(pool);
  const [rows] = await pool.query(`
    SELECT id, nome, apelido, COALESCE(saldo, 0) AS saldo, agencia, conta
    FROM bancos
    WHERE (excluido='N' OR excluido IS NULL OR excluido='')
      AND (status='A' OR status IS NULL OR status='')
    ORDER BY nome
  `);
  return (rows || []).map((r) => ({
    id: r.id,
    nome: r.nome,
    apelido: r.apelido,
    saldo: parseFloat(r.saldo) || 0,
    label: `${r.apelido || r.nome}${r.conta ? ' · ' + r.conta : ''} (R$ ${(parseFloat(r.saldo) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`,
  }));
}

/**
 * Ajusta saldo do banco e grava movimento.
 * @param {'ENTRADA'|'SAIDA'} tipo
 * @param {'PAGAR'|'RECEBER'} origem
 */
async function movimentarBanco(poolOrConn, {
  id_banco,
  valor,
  tipo,
  origem,
  id_origem,
  historico,
  data_mov,
  permitirSaldoNegativo = false,
}) {
  const idBanco = parseIdBanco(id_banco);
  const vlr = parseValorMov(valor);
  const tip = String(tipo || '').toUpperCase() === 'ENTRADA' ? 'ENTRADA' : 'SAIDA';
  const orig = String(origem || '').toUpperCase();
  const idOrig = parseInt(id_origem, 10);

  if (!idBanco) {
    const err = new Error('Informe a conta (banco/caixa) de onde sai ou entra o valor.');
    err.code = 'BANCO_OBRIGATORIO';
    throw err;
  }
  if (!vlr) {
    const err = new Error('Valor do movimento bancário inválido.');
    err.code = 'VALOR_INVALIDO';
    throw err;
  }
  if (!idOrig || !['PAGAR', 'RECEBER'].includes(orig)) {
    const err = new Error('Origem do movimento bancário inválida.');
    err.code = 'ORIGEM_INVALIDA';
    throw err;
  }

  await ensureBancoMovimentoSchema(poolOrConn);

  const [[banco]] = await poolOrConn.query(
    `SELECT id, nome, COALESCE(saldo, 0) AS saldo
     FROM bancos
     WHERE id = ?
       AND (excluido='N' OR excluido IS NULL OR excluido='')
     LIMIT 1
     FOR UPDATE`,
    [idBanco]
  );
  if (!banco) {
    const err = new Error('Banco/caixa não encontrado ou inativo.');
    err.code = 'BANCO_NAO_ENCONTRADO';
    throw err;
  }

  const saldoAnt = Math.round((parseFloat(banco.saldo) || 0) * 100) / 100;
  const saldoPos = tip === 'ENTRADA'
    ? Math.round((saldoAnt + vlr) * 100) / 100
    : Math.round((saldoAnt - vlr) * 100) / 100;

  if (!permitirSaldoNegativo && tip === 'SAIDA' && saldoPos < -0.0001) {
    const err = new Error(
      `Saldo insuficiente em «${banco.nome}». Saldo atual: R$ ${saldoAnt.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} · Saída: R$ ${vlr.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`
    );
    err.code = 'SALDO_INSUFICIENTE';
    err.saldo = saldoAnt;
    throw err;
  }

  await poolOrConn.query(`UPDATE bancos SET saldo = ? WHERE id = ?`, [saldoPos, idBanco]);

  const dataMov = String(data_mov || '').slice(0, 10) || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const hist = String(historico || `${tip} ${orig} #${idOrig}`).slice(0, 255);

  const [ins] = await poolOrConn.query(
    `INSERT INTO banco_movimentos
      (id_banco, tipo, valor, saldo_anterior, saldo_posterior, origem, id_origem, data_mov, historico, excluido)
     VALUES (?,?,?,?,?,?,?,?,?,'N')`,
    [idBanco, tip, vlr, saldoAnt, saldoPos, orig, idOrig, dataMov, hist]
  );

  return {
    id_movimento: ins.insertId,
    id_banco: idBanco,
    tipo: tip,
    valor: vlr,
    saldo_anterior: saldoAnt,
    saldo_posterior: saldoPos,
  };
}

/**
 * Estorna o último movimento ativo do título (PAGAR/RECEBER).
 */
async function estornarMovimentoTitulo(poolOrConn, { origem, id_origem, data_mov }) {
  const orig = String(origem || '').toUpperCase();
  const idOrig = parseInt(id_origem, 10);
  if (!idOrig || !['PAGAR', 'RECEBER'].includes(orig)) return null;

  await ensureBancoMovimentoSchema(poolOrConn);

  const [rows] = await poolOrConn.query(
    `SELECT * FROM banco_movimentos
     WHERE origem = ? AND id_origem = ? AND (excluido='N' OR excluido IS NULL OR excluido='')
     ORDER BY id DESC
     LIMIT 1
     FOR UPDATE`,
    [orig, idOrig]
  );
  const mov = rows[0];
  if (!mov) return null;

  const tipoRev = String(mov.tipo).toUpperCase() === 'ENTRADA' ? 'SAIDA' : 'ENTRADA';
  const rev = await movimentarBanco(poolOrConn, {
    id_banco: mov.id_banco,
    valor: mov.valor,
    tipo: tipoRev,
    origem: orig,
    id_origem: idOrig,
    historico: `ESTORNO: ${mov.historico || (orig + ' #' + idOrig)}`,
    data_mov: data_mov || mov.data_mov,
    permitirSaldoNegativo: true,
  });

  await poolOrConn.query(
    `UPDATE banco_movimentos SET excluido='S' WHERE id IN (?, ?)`,
    [mov.id, rev.id_movimento]
  ).catch(async () => {
    await poolOrConn.query(`UPDATE banco_movimentos SET excluido='S' WHERE id = ?`, [mov.id]);
  });

  return rev;
}

/**
 * True se a baixa com cheque da carteira não deve debitar o banco da empresa.
 */
function baixaChequeCarteiraSemDebitoBanco(forma, idCheque) {
  const f = String(forma || '').toUpperCase();
  return f === 'CHEQUE' && parseInt(idCheque, 10) > 0;
}

module.exports = {
  ensureBancoMovimentoSchema,
  listBancosAtivosLookup,
  movimentarBanco,
  estornarMovimentoTitulo,
  baixaChequeCarteiraSemDebitoBanco,
  parseIdBanco,
  parseValorMov,
};
