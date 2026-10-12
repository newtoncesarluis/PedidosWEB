'use strict';

/**
 * Flex de preço (conta corrente do vendedor por fábrica).
 *
 * - Vendeu ACIMA da tabela (`itensped.vlr_padrao`) → crédito na conta flex.
 * - Vendeu ABAIXO da tabela → débito na conta flex.
 * - Liga por fábrica: `fornecedores.habilita_flex='S'` (aba Preferências).
 * - Lançamentos em `flex_lancamentos` (1 linha por item do pedido, tipo 'PEDIDO').
 *   O recálculo é idempotente: a cada save/mudança de status apaga e regrava as
 *   linhas do pedido, então editar, aprovar, cancelar ou excluir nunca duplica.
 */

const { hojeIsoBrasil } = require('./date-brasil');

const STATUS_APROVADOS = new Set(['APROVADO', 'ENVIADO', 'FATURADO']);

const _tabelaOk = new Set(); // por DATABASE()

async function ensureFlexTable(conn) {
  const [[db]] = await conn.query('SELECT DATABASE() AS db');
  const key = db?.db || '';
  if (_tabelaOk.has(key)) return;
  await conn.query(`
    CREATE TABLE IF NOT EXISTS flex_lancamentos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      id_usuario INT NOT NULL,
      cod_fornecedor INT NOT NULL,
      id_pedido INT NULL,
      numero_pedido VARCHAR(20) NULL,
      cod_produto INT NULL,
      descricao VARCHAR(150) NULL,
      valor DECIMAL(15,2) NOT NULL DEFAULT 0,
      tipo VARCHAR(10) NOT NULL DEFAULT 'PEDIDO',
      obs VARCHAR(200) NULL,
      data_lancamento DATE NOT NULL,
      id_usuario_lanc INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_flex_conta (id_usuario, cod_fornecedor),
      INDEX idx_flex_pedido (id_pedido)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  _tabelaOk.add(key);
}

/** Pedido elegível a lançar flex conforme a regra "quando lançar" da fábrica. */
function pedidoElegivel({ situacao, tipoPedido, excluido, lancarEm }) {
  if (String(excluido || 'N').toUpperCase() === 'S') return false;
  const sit = String(situacao || '').toUpperCase();
  if (sit === 'CANCELADO') return false;
  if (String(tipoPedido || 'PEDIDO').toUpperCase().includes('ORC')) return false;
  const modo = String(lancarEm || 'APROVAR').toUpperCase();
  if (modo === 'SALVAR') return true;
  if (modo === 'FATURAR') return sit === 'FATURADO';
  return STATUS_APROVADOS.has(sit); // APROVAR
}

/** Primeiro dia do período de validade (null = sem expiração). */
function inicioValidade(validade, hoje = hojeIsoBrasil()) {
  const v = String(validade || 'NUNCA').toUpperCase();
  const p = hoje.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!p) return null;
  if (v === 'MENSAL') return `${p[1]}-${p[2]}-01`;
  if (v === 'SEMANAL') {
    const dt = new Date(Date.UTC(+p[1], +p[2] - 1, +p[3]));
    const dow = (dt.getUTCDay() + 6) % 7; // segunda = 0
    dt.setUTCDate(dt.getUTCDate() - dow);
    return dt.toISOString().slice(0, 10);
  }
  return null;
}

/**
 * Flex de uma lista de itens (já com preços): (preço vendido − tabela) × fator.
 * fator = vlrtotal_itens / preço unitário líquido → já embute peso/embalagem.
 */
function calcFlexItem(it) {
  const padrao = parseFloat(it.vlr_padrao) || 0;
  if (!(padrao > 0)) return 0;
  const unit = parseFloat(it.vlr_unitariosemimposto) > 0
    ? parseFloat(it.vlr_unitariosemimposto)
    : (parseFloat(it.valor_unitario) || 0);
  if (!(unit > 0)) return 0;
  const total = parseFloat(it.vlrtotal_itens) || 0;
  const fator = total > 0 ? total / unit : (parseFloat(it.quantidade) || 0);
  return Math.round((unit - padrao) * fator * 100) / 100;
}

async function getConfigFornecedor(conn, codFornecedor) {
  if (!codFornecedor) return null;
  try {
    const [[f]] = await conn.query(
      `SELECT habilita_flex, flex_lancar_em, flex_saldo_insuficiente, flex_validade, flex_gera_credito
         FROM fornecedores WHERE id = ? LIMIT 1`,
      [codFornecedor]
    );
    if (!f || String(f.habilita_flex || 'N').toUpperCase() !== 'S') return null;
    return {
      lancarEm: String(f.flex_lancar_em || 'APROVAR').toUpperCase(),
      saldoInsuficiente: String(f.flex_saldo_insuficiente || 'AVISAR').toUpperCase(),
      validade: String(f.flex_validade || 'NUNCA').toUpperCase(),
      geraCredito: String(f.flex_gera_credito || 'S').toUpperCase() !== 'N',
    };
  } catch (_) {
    return null; // coluna ainda não existe nesta base → flex desligado
  }
}

/** Saldo da conta (vendedor + fábrica), respeitando a validade; ignora um pedido (p/ simulação). */
async function getSaldo(conn, { idUsuario, codFornecedor, validade, ignorarPedido }) {
  await ensureFlexTable(conn);
  const params = [idUsuario, codFornecedor];
  let sql = `SELECT COALESCE(SUM(valor),0) AS saldo FROM flex_lancamentos
              WHERE id_usuario = ? AND cod_fornecedor = ?`;
  const ini = inicioValidade(validade);
  if (ini) { sql += ' AND data_lancamento >= ?'; params.push(ini); }
  if (ignorarPedido) { sql += ' AND (id_pedido IS NULL OR id_pedido <> ?)'; params.push(ignorarPedido); }
  const [[r]] = await conn.query(sql, params);
  return Math.round((parseFloat(r.saldo) || 0) * 100) / 100;
}

/**
 * Recalcula os lançamentos de flex de um pedido (idempotente).
 * Chamar dentro da transação, depois de gravar itens/situação.
 * Lança Error com `.flexBloqueio=true` quando a fábrica bloqueia saldo negativo.
 */
async function sincronizarFlexPedido(conn, idPedido) {
  const id = parseInt(idPedido, 10);
  if (!id) return { ativo: false };

  let ped;
  try {
    const [[p]] = await conn.query(
      `SELECT id, numero, cod_fornecedor, id_usuario, situacao_pedido, tipo_pedido,
              COALESCE(excluido,'N') AS excluido
         FROM pedidos WHERE id = ? LIMIT 1`,
      [id]
    );
    ped = p;
  } catch (_) { return { ativo: false }; }
  if (!ped) return { ativo: false };

  const cfg = await getConfigFornecedor(conn, ped.cod_fornecedor);
  if (!cfg) return { ativo: false };
  await ensureFlexTable(conn);

  const [antigas] = await conn.query(
    `SELECT DATE_FORMAT(MIN(data_lancamento), '%Y-%m-%d') AS dt
       FROM flex_lancamentos WHERE id_pedido = ? AND tipo = 'PEDIDO'`, [id]
  );
  const dataLanc = antigas[0]?.dt || hojeIsoBrasil();

  const elegivel = pedidoElegivel({
    situacao: ped.situacao_pedido, tipoPedido: ped.tipo_pedido, excluido: ped.excluido, lancarEm: cfg.lancarEm,
  }) && !!ped.id_usuario;

  const linhas = [];
  if (elegivel) {
    const [itens] = await conn.query(
      `SELECT cod_produto, desc_prod, quantidade, vlr_padrao, valor_unitario,
              vlr_unitariosemimposto, vlrtotal_itens
         FROM itensped WHERE numpedido = ? AND COALESCE(excluido,'N') = 'N'`,
      [String(ped.numero)]
    );
    for (const it of itens) {
      const flex = calcFlexItem(it);
      if (Math.abs(flex) < 0.005) continue;
      if (flex > 0 && !cfg.geraCredito) continue;
      linhas.push([
        ped.id_usuario, ped.cod_fornecedor, id, String(ped.numero), it.cod_produto || null,
        String(it.desc_prod || '').slice(0, 150), flex, 'PEDIDO', dataLanc,
      ]);
    }
  }

  const totalPedido = linhas.reduce((s, l) => s + l[6], 0);
  if (cfg.saldoInsuficiente === 'BLOQUEAR' && totalPedido < 0) {
    const saldoAntes = await getSaldo(conn, {
      idUsuario: ped.id_usuario, codFornecedor: ped.cod_fornecedor,
      validade: cfg.validade, ignorarPedido: id,
    });
    if (saldoAntes + totalPedido < -0.005) {
      const err = new Error(
        `Saldo Flex insuficiente: saldo atual R$ ${saldoAntes.toFixed(2)}, ` +
        `este pedido consome R$ ${Math.abs(totalPedido).toFixed(2)}.`
      );
      err.flexBloqueio = true;
      throw err;
    }
  }

  await conn.query(`DELETE FROM flex_lancamentos WHERE id_pedido = ? AND tipo = 'PEDIDO'`, [id]);
  if (linhas.length) {
    await conn.query(
      `INSERT INTO flex_lancamentos
         (id_usuario, cod_fornecedor, id_pedido, numero_pedido, cod_produto, descricao, valor, tipo, data_lancamento)
       VALUES ${linhas.map(() => '(?,?,?,?,?,?,?,?,?)').join(',')}`,
      linhas.flat()
    );
  }
  return { ativo: true, lancado: elegivel, total: Math.round(totalPedido * 100) / 100 };
}

module.exports = {
  ensureFlexTable,
  pedidoElegivel,
  inicioValidade,
  calcFlexItem,
  getConfigFornecedor,
  getSaldo,
  sincronizarFlexPedido,
};
