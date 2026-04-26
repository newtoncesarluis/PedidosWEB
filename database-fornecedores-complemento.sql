-- ============================================================
-- Complemento: Fornecedores — Vendedores, Fotos, Produtos
-- SysRepWeb — NC Sistemas
-- ============================================================

-- Vendedores vinculados ao fornecedor
CREATE TABLE IF NOT EXISTS `fornecedor_vendedor` (
  `id`             INT(11)       NOT NULL AUTO_INCREMENT,
  `cod_fornecedor` INT(11)       NOT NULL,
  `cod_vendedor`   INT(11)       NOT NULL,
  `comissao`       DECIMAL(10,4) DEFAULT NULL,
  `excluido`       CHAR(1)       NOT NULL DEFAULT 'N',
  PRIMARY KEY (`id`),
  KEY `idx_fv_fornecedor` (`cod_fornecedor`),
  KEY `idx_fv_vendedor`   (`cod_vendedor`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Fotos/imagens do fornecedor
CREATE TABLE IF NOT EXISTS `fornecedor_fotos` (
  `id`             INT(11)       NOT NULL AUTO_INCREMENT,
  `cod_fornecedor` INT(11)       NOT NULL,
  `descricao`      VARCHAR(200)  DEFAULT NULL,
  `tipo_imagem`    VARCHAR(50)   DEFAULT NULL,  -- LOGO, IMAGEM COMUM, ITENS
  `principal`      CHAR(1)       NOT NULL DEFAULT 'N',
  `caminho`        VARCHAR(500)  DEFAULT NULL,  -- caminho relativo ao public/
  `excluido`       CHAR(1)       NOT NULL DEFAULT 'N',
  `dtcadastro`     DATE          DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ff_fornecedor` (`cod_fornecedor`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Produtos vinculados ao fornecedor
CREATE TABLE IF NOT EXISTS `fornecedor_produtos` (
  `id`             INT(11)       NOT NULL AUTO_INCREMENT,
  `cod_fornecedor` INT(11)       NOT NULL,
  `cod_produto`    INT(11)       NOT NULL,
  `unidade`        VARCHAR(10)   DEFAULT NULL,
  `embalagem`      VARCHAR(50)   DEFAULT NULL,
  `excluido`       CHAR(1)       NOT NULL DEFAULT 'N',
  PRIMARY KEY (`id`),
  KEY `idx_fp_fornecedor` (`cod_fornecedor`),
  KEY `idx_fp_produto`    (`cod_produto`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
