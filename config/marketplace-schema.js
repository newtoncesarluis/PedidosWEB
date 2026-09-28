'use strict';

/**
 * Schema do módulo Marketplace (on-demand por tenant).
 *
 * Fundação NEUTRA de provedor: serve igual para Tray, Bling, Mercado Livre,
 * Shopee, Amazon, Shein ou TikTok. Nenhuma regra específica de plataforma
 * mora aqui — só a estrutura comum:
 *
 *   canal_venda            → cada conta/plataforma conectada (o cliente pode
 *                            ter 2 contas do mesmo marketplace)
 *   marketplace_anuncios   → de-para anúncio/SKU do canal ↔ produto.ID interno
 *   marketplace_pedidos_log→ payload cru + status, permite reprocessar sem
 *                            duplicar (UNIQUE por canal + id externo)
 *
 * Estoque ainda NÃO entra aqui — a direção do sync (quem é o saldo oficial)
 * depende de definição com o cliente.
 */

const _ok = new Map();

async function dbKey(pool) {
  const [[r]] = await pool.query('SELECT DATABASE() AS db');
  return String(r?.db || 'default');
}

async function ensureMarketplaceSchema(pool) {
  const key = await dbKey(pool);
  if (_ok.has(key)) return key;

  // Canais de venda conectados — 1 linha por conta (2 contas do ML = 2 linhas)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS canal_venda (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      nome             VARCHAR(100) NOT NULL COMMENT 'Rótulo do usuário. Ex: Mercado Livre Loja 2',
      plataforma       VARCHAR(30)  NOT NULL COMMENT 'TRAY|BLING|MERCADO_LIVRE|SHOPEE|AMAZON|SHEIN|TIKTOK|OUTRO',
      conta_externa    VARCHAR(120) NULL COMMENT 'Identificador da conta na plataforma',
      id_empresa       INT          NULL COMMENT 'Para operação multi-CNPJ',
      comissao_pct     DECIMAL(6,3) NOT NULL DEFAULT 0 COMMENT 'Comissão padrão do canal, para margem líquida',
      client_id        VARCHAR(200) NULL,
      client_secret    VARCHAR(255) NULL,
      access_token     TEXT         NULL,
      refresh_token    TEXT         NULL,
      token_expira_em  DATETIME     NULL,
      config           TEXT         NULL COMMENT 'JSON livre por plataforma (depósito, escopos, etc.)',
      ultima_sync      DATETIME     NULL,
      status           CHAR(1)      NOT NULL DEFAULT 'A' COMMENT 'A=ativo I=inativo',
      excluido         CHAR(1)      NOT NULL DEFAULT 'N',
      dt_cadastro      DATETIME     DEFAULT CURRENT_TIMESTAMP,
      KEY idx_cv_plataforma (plataforma, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // De-para anúncio do canal ↔ produto interno. Sem isso nada funciona.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS marketplace_anuncios (
      id                INT AUTO_INCREMENT PRIMARY KEY,
      id_canal          INT          NOT NULL,
      codigo_externo    VARCHAR(120) NOT NULL COMMENT 'ID do anúncio no canal. Ex: MLB123456',
      sku_externo       VARCHAR(120) NULL COMMENT 'SKU informado pelo canal',
      descricao_externa VARCHAR(255) NULL,
      cod_produto       INT          NULL COMMENT 'produto.ID interno. NULL = ainda não vinculado',
      preco_canal       DECIMAL(15,2) NULL,
      vinculado_por     VARCHAR(20)  NULL COMMENT 'AUTO|MANUAL',
      ativo             CHAR(1)      NOT NULL DEFAULT 'S',
      dt_sync           DATETIME     NULL,
      dt_cadastro       DATETIME     DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_ma_canal_codigo (id_canal, codigo_externo),
      KEY idx_ma_produto (cod_produto),
      KEY idx_ma_sku     (sku_externo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Log cru de pedidos recebidos — a UNIQUE é o que impede pedido duplicado
  await pool.query(`
    CREATE TABLE IF NOT EXISTS marketplace_pedidos_log (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      id_canal       INT          NOT NULL,
      id_externo     VARCHAR(120) NOT NULL COMMENT 'ID do pedido na plataforma',
      numero_externo VARCHAR(60)  NULL COMMENT 'Número visível ao lojista',
      canal_origem   VARCHAR(40)  NULL COMMENT 'Marketplace de origem quando vem via hub',
      valor_total    DECIMAL(15,2) NULL,
      data_pedido    DATE         NULL,
      payload        LONGTEXT     NULL COMMENT 'JSON cru como veio, para reprocesso',
      status         VARCHAR(20)  NOT NULL DEFAULT 'PENDENTE' COMMENT 'PENDENTE|PROCESSADO|ERRO|IGNORADO',
      erro           VARCHAR(500) NULL,
      tentativas     INT          NOT NULL DEFAULT 0,
      id_pedido      INT          NULL COMMENT 'pedidos.id gerado',
      dt_recebido    DATETIME     DEFAULT CURRENT_TIMESTAMP,
      dt_processado  DATETIME     NULL,
      UNIQUE KEY uk_mpl_canal_ext (id_canal, id_externo),
      KEY idx_mpl_status (status, dt_recebido),
      KEY idx_mpl_pedido (id_pedido)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  _ok.set(key, true);
  return key;
}

function resetMarketplaceSchemaCache(db) {
  if (db) _ok.delete(db); else _ok.clear();
}

/** Detecta o nome da tabela de produtos nesta base (produto ou produtos). */
async function tabelaProduto(pool) {
  const [r] = await pool.query(`SHOW TABLES LIKE 'produto'`);
  return r.length ? 'produto' : 'produtos';
}

module.exports = { ensureMarketplaceSchema, resetMarketplaceSchemaCache, tabelaProduto };
