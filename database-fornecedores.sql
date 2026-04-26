-- ============================================================
-- Tabela: fornecedores
-- SysRepWeb — NC Sistemas
-- ============================================================

CREATE TABLE IF NOT EXISTS `fornecedores` (
  `id`                    INT(11)       NOT NULL AUTO_INCREMENT,
  `razao_social`          VARCHAR(150)  NOT NULL,
  `nome_fantasia`         VARCHAR(150)  DEFAULT NULL,
  `cnpj`                  VARCHAR(20)   DEFAULT NULL,
  `ie`                    VARCHAR(30)   DEFAULT NULL,
  `tipo`                  VARCHAR(50)   DEFAULT NULL,   -- FABRICA, REPRESENTADA, DISTRIBUIDOR...

  -- Endereço
  `cep`                   VARCHAR(10)   DEFAULT NULL,
  `endereco`              VARCHAR(150)  DEFAULT NULL,
  `numero_end`            VARCHAR(20)   DEFAULT NULL,
  `bairro`                VARCHAR(80)   DEFAULT NULL,
  `cidade`                VARCHAR(80)   DEFAULT NULL,
  `uf`                    CHAR(2)       DEFAULT NULL,
  `complemento`           VARCHAR(100)  DEFAULT NULL,

  -- Contato
  `telefone`              VARCHAR(20)   DEFAULT NULL,
  `celular`               VARCHAR(20)   DEFAULT NULL,
  `email`                 VARCHAR(120)  DEFAULT NULL,
  `contato`               VARCHAR(100)  DEFAULT NULL,
  `site`                  VARCHAR(200)  DEFAULT NULL,

  -- Informações CNPJ (preenchidas via Receita Federal)
  `situacaocnpj`          VARCHAR(50)   DEFAULT NULL,
  `data_situacaocnpj`     DATE          DEFAULT NULL,
  `data_abertura`         DATE          DEFAULT NULL,
  `natureza`              VARCHAR(150)  DEFAULT NULL,
  `porte`                 VARCHAR(50)   DEFAULT NULL,
  `tipo_cnpj`             VARCHAR(10)   DEFAULT NULL,   -- MATRIZ / FILIAL
  `capital_social`        DECIMAL(15,2) DEFAULT NULL,
  `atividadeprincipal`    VARCHAR(255)  DEFAULT NULL,
  `atividadesecundaria`   TEXT          DEFAULT NULL,

  -- Controle
  `status`                CHAR(1)       NOT NULL DEFAULT 'A',  -- A=Ativo, I=Inativo, E=Excluído
  `excluido`              CHAR(1)       NOT NULL DEFAULT 'N',
  `obsgerais`             TEXT          DEFAULT NULL,
  `id_empresa`            INT(11)       DEFAULT NULL,
  `dtcadastro`            DATE          DEFAULT NULL,
  `dtalterado`            DATETIME      DEFAULT NULL,

  PRIMARY KEY (`id`),
  KEY `idx_razao_social` (`razao_social`),
  KEY `idx_cnpj`         (`cnpj`),
  KEY `idx_status`       (`status`, `excluido`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
