-- Script para criação das tabelas de Tabela de Preço no padrão TOTVS Protheus
-- Tabelas: tabela_preco_cabecalho e tabela_preco_itens

CREATE TABLE IF NOT EXISTS `tabela_preco_cabecalho` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `Descricao` VARCHAR(200) NOT NULL,
  `Data_Inicial` DATE NOT NULL,
  `Hora_Inicial` TIME NOT NULL,
  `Data_Final` DATE NOT NULL,
  `Hora_Final` TIME NOT NULL,
  `Cond_Pagamento` INT NOT NULL,
  `Tabela_Ativa` ENUM('S','N') DEFAULT 'S',
  `excluido` ENUM('S','N') DEFAULT 'N',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- Foreign Key para forma_pagto (assumindo que a tabela forma_pagto já existe e tem o campo ID)
  CONSTRAINT `fk_tab_cond_pagto` FOREIGN KEY (`Cond_Pagamento`) REFERENCES `forma_pagto` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `tabela_preco_itens` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `id_tabela` INT NOT NULL,
  `item` INT NOT NULL,
  `cod_produto` INT NOT NULL,
  `descricao` VARCHAR(200) NOT NULL,
  `cod_fabricante` VARCHAR(100),
  `unidade` VARCHAR(10),
  `preco_base` DECIMAL(15,2),
  `preco_venda` DECIMAL(15,2) NOT NULL,
  `tipo_desconto` ENUM('R','P') DEFAULT 'R',
  `vlr_desconto` DECIMAL(15,2) DEFAULT 0.00,
  `valor_tabela` DECIMAL(15,2) NOT NULL,
  `ativo` ENUM('S','N') DEFAULT 'S',
  `vigencia` DATE NULL,
  `excluido` ENUM('S','N') DEFAULT 'N',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- Foreign Keys
  CONSTRAINT `fk_item_tabela` FOREIGN KEY (`id_tabela`) REFERENCES `tabela_preco_cabecalho` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_item_produto` FOREIGN KEY (`cod_produto`) REFERENCES `produto` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Índices para performance
CREATE INDEX idx_tab_excluido ON tabela_preco_cabecalho(excluido);
CREATE INDEX idx_item_tabela_id ON tabela_preco_itens(id_tabela);
CREATE INDEX idx_item_excluido ON tabela_preco_itens(excluido);
