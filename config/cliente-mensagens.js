'use strict';

/**
 * Histórico de mensagens enviadas ao cliente (WhatsApp / E-mail).
 *
 * Cada envio feito pelo sistema (pedido em PDF, campanha, mensagem avulsa)
 * gera um registro em `cliente_mensagens` — inclusive falhas, para auditoria.
 * Exibido no modal de histórico do cliente (clientes.html).
 *
 * Gravação é fire-and-forget: nunca lança erro para não quebrar o envio.
 *
 * `id_campanha` (quando preenchido) identifica o envio como parte de uma
 * campanha WhatsApp — usado pela tela de Clientes para exibir a origem
 * ("Campanha: X" vs "Pedido nº Y" vs "Avulso").
 */

const _tabelaOkPorBase = new Map(); // DATABASE() -> true (cache multi-tenant)

const EXTRA_COLS = {
  id_campanha: "ALTER TABLE cliente_mensagens ADD COLUMN id_campanha INT NULL DEFAULT NULL",
};

async function ensureClienteMensagensTable(pool) {
  const [[{ db }]] = await pool.query('SELECT DATABASE() AS db');
  if (_tabelaOkPorBase.get(db)) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cliente_mensagens (
      id             INT          NOT NULL AUTO_INCREMENT,
      cod_cliente    INT          NOT NULL,
      id_pedido      INT          NULL DEFAULT NULL,
      id_campanha    INT          NULL DEFAULT NULL,
      id_usuario     INT          NULL DEFAULT NULL,
      canal          VARCHAR(10)  NOT NULL DEFAULT 'WHATSAPP',
      provedor       VARCHAR(20)  NULL DEFAULT NULL,
      destino        VARCHAR(300) NULL DEFAULT NULL,
      mensagem       TEXT         NULL,
      anexo          VARCHAR(150) NULL DEFAULT NULL,
      status         VARCHAR(10)  NOT NULL DEFAULT 'ENVIADO',
      erro           VARCHAR(300) NULL DEFAULT NULL,
      data_envio     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_cm_cliente (cod_cliente, data_envio)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8;
  `);

  // Bases onde a tabela já existia antes do id_campanha — adiciona a coluna.
  const [cols] = await pool.query('SHOW COLUMNS FROM cliente_mensagens').catch(() => [[]]);
  const existentes = new Set((cols || []).map(c => c.Field));
  for (const [col, sql] of Object.entries(EXTRA_COLS)) {
    if (!existentes.has(col)) await pool.query(sql).catch(() => {});
  }

  _tabelaOkPorBase.set(db, true);
}

/**
 * Registra um envio no histórico do cliente. Nunca lança erro.
 * @param {object} pool  pool do tenant
 * @param {object} m     { cod_cliente, id_pedido?, id_campanha?, id_usuario?, canal, provedor?,
 *                         destino?, mensagem?, anexo?, status?, erro? }
 */
async function registrarMensagemCliente(pool, m) {
  try {
    if (!m || !m.cod_cliente) return;
    await ensureClienteMensagensTable(pool);
    await pool.query(
      `INSERT INTO cliente_mensagens
         (cod_cliente, id_pedido, id_campanha, id_usuario, canal, provedor, destino, mensagem, anexo, status, erro)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        m.cod_cliente,
        m.id_pedido   || null,
        m.id_campanha || null,
        m.id_usuario  || null,
        String(m.canal || 'WHATSAPP').toUpperCase().slice(0, 10),
        m.provedor ? String(m.provedor).toUpperCase().slice(0, 20) : null,
        m.destino  ? String(m.destino).slice(0, 300) : null,
        m.mensagem ? String(m.mensagem).slice(0, 2000) : null,
        m.anexo    ? String(m.anexo).slice(0, 150) : null,
        m.status === 'FALHOU' ? 'FALHOU' : 'ENVIADO',
        m.erro     ? String(m.erro).slice(0, 300) : null,
      ]
    );
  } catch (e) {
    console.warn('[cliente-mensagens] falha ao registrar:', e.message);
  }
}

module.exports = { ensureClienteMensagensTable, registrarMensagemCliente };
