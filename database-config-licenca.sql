-- ============================================================
-- Execute este script no banco local do SysRepWeb (DB_NAME)
-- Cria a tabela config_licenca usada pelo sistema de licenças
-- ============================================================

CREATE TABLE IF NOT EXISTS config_licenca (
  id                  INT             NOT NULL AUTO_INCREMENT,
  chave_licenca       VARCHAR(19)     NOT NULL,
  status              ENUM('ativo','demo','bloqueado','expirado') NOT NULL DEFAULT 'demo',
  data_ativacao       DATETIME        NULL,
  data_expiracao      DATE            NULL,
  ultima_verificacao  DATETIME        NULL,
  dados_cliente       JSON            NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_chave (chave_licenca),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
