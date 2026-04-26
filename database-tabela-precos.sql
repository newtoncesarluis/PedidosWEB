-- ============================================================
-- Tabelas de Preços e Regras
-- SysRepWeb — NC Sistemas
-- ============================================================

CREATE TABLE IF NOT EXISTS `tabela_precos` (
  `id`                    INT(11)       NOT NULL AUTO_INCREMENT,
  `descricao`             VARCHAR(100)  NOT NULL,
  `codigo_interno`        VARCHAR(20)   DEFAULT NULL,
  `sequencia`             VARCHAR(50)   DEFAULT NULL,
  `id_empresa`            INT(11)       DEFAULT NULL,
  `excluido`              CHAR(1)       NOT NULL DEFAULT 'N',
  `dtcadastro`            DATETIME      DEFAULT CURRENT_TIMESTAMP,
  `dtalterado`            DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_excluido` (`excluido`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tabela_precos_regras` (
  `id`                    INT(11)       NOT NULL AUTO_INCREMENT,
  `id_tabela`             INT(11)       NOT NULL,
  `nome_regra`            VARCHAR(100)  DEFAULT NULL,
  `tipo`                  VARCHAR(50)   DEFAULT NULL,
  `descontode`            DECIMAL(10,2) DEFAULT 0.00,
  `descontoate`           DECIMAL(10,2) DEFAULT 0.00,
  `desconto_unico`        DECIMAL(10,2) DEFAULT 0.00,
  `comissao`              DECIMAL(10,2) DEFAULT 0.00,
  `cod_produto`           VARCHAR(20)   DEFAULT NULL,
  `valor_venda`           DECIMAL(15,2) DEFAULT 0.00,
  `ativa`                 CHAR(1)       DEFAULT 'S',
  `excluido`              CHAR(1)       NOT NULL DEFAULT 'N',
  PRIMARY KEY (`id`),
  KEY `idx_tabela` (`id_tabela`),
  CONSTRAINT `fk_regras_tabela` FOREIGN KEY (`id_tabela`) REFERENCES `tabela_precos` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
