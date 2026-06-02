CREATE DATABASE IF NOT EXISTS estudo_vitrine
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE estudo_vitrine;

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS itensped;
DROP TABLE IF EXISTS pedidos;
DROP TABLE IF EXISTS vitrine_tokens;
DROP TABLE IF EXISTS tabela_preco_vinculo;
DROP TABLE IF EXISTS tabela_preco_itens;
DROP TABLE IF EXISTS tabela_preco_cabecalho;
DROP TABLE IF EXISTS produto_imagens;
DROP TABLE IF EXISTS produto;
DROP TABLE IF EXISTS fornecedores;
DROP TABLE IF EXISTS clientes;
DROP TABLE IF EXISTS usuarios;
DROP TABLE IF EXISTS empresa;
DROP TABLE IF EXISTS tipo_pedidos;
SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE empresa (
  id_empresa INT AUTO_INCREMENT PRIMARY KEY,
  Razao_empresa VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE usuarios (
  idusuario INT AUTO_INCREMENT PRIMARY KEY,
  nomeusu VARCHAR(120) NOT NULL,
  loginusu VARCHAR(60) NULL,
  email VARCHAR(120) NULL,
  fone VARCHAR(30) NULL,
  instancia VARCHAR(120) NULL,
  chave VARCHAR(180) NULL,
  numero_whatsApp VARCHAR(30) NULL,
  excluido CHAR(1) NOT NULL DEFAULT 'N'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE clientes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  cpf VARCHAR(30) NULL,
  email VARCHAR(120) NULL,
  telefone VARCHAR(30) NULL,
  excluido CHAR(1) NOT NULL DEFAULT 'N'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fornecedores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  excluido CHAR(1) NOT NULL DEFAULT 'N'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE produto (
  ID INT AUTO_INCREMENT PRIMARY KEY,
  descricao VARCHAR(255) NOT NULL,
  apelido VARCHAR(120) NULL,
  cod_barras VARCHAR(80) NULL,
  cod_fabricante VARCHAR(80) NULL,
  unidade VARCHAR(12) DEFAULT 'UN',
  foto_principal VARCHAR(500) NULL,
  nome_grupo VARCHAR(120) NULL,
  cod_fornecedorpadrao INT NULL,
  vlr_venda DECIMAL(15,2) DEFAULT 0,
  situacao CHAR(1) NOT NULL DEFAULT 'A',
  excluido CHAR(1) NOT NULL DEFAULT 'N',
  INDEX idx_prod_forn (cod_fornecedorpadrao)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE produto_imagens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cod_produto INT NOT NULL,
  filename VARCHAR(255) NOT NULL,
  is_principal TINYINT(1) NOT NULL DEFAULT 0,
  ordem INT NOT NULL DEFAULT 0,
  INDEX idx_img_prod (cod_produto)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE tabela_preco_cabecalho (
  id INT AUTO_INCREMENT PRIMARY KEY,
  Descricao VARCHAR(255) NOT NULL,
  Tabela_Ativa CHAR(1) NOT NULL DEFAULT 'S',
  excluido CHAR(1) NOT NULL DEFAULT 'N'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE tabela_preco_itens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_tabela INT NOT NULL,
  item INT NOT NULL,
  cod_produto INT NOT NULL,
  descricao VARCHAR(255) NOT NULL,
  cod_fabricante VARCHAR(80) NULL,
  unidade VARCHAR(12) DEFAULT 'UN',
  preco_base DECIMAL(15,2) DEFAULT 0,
  preco_venda DECIMAL(15,2) NOT NULL,
  valor_tabela DECIMAL(15,2) DEFAULT NULL,
  ativo CHAR(1) NOT NULL DEFAULT 'S',
  excluido CHAR(1) NOT NULL DEFAULT 'N',
  INDEX idx_tpi_tabela (id_tabela),
  INDEX idx_tpi_produto (cod_produto)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE tabela_preco_vinculo (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_entidade INT NOT NULL,
  id_tabela INT NOT NULL,
  tipo_entidade VARCHAR(20) NOT NULL DEFAULT 'CLIENTE',
  excluido CHAR(1) NOT NULL DEFAULT 'N',
  INDEX idx_tpv_entidade (tipo_entidade, id_entidade)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE tipo_pedidos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  descricao VARCHAR(80) NOT NULL,
  padrao_vitrine CHAR(1) NOT NULL DEFAULT 'N',
  excluido CHAR(1) NOT NULL DEFAULT 'N'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE vitrine_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  token VARCHAR(64) NOT NULL UNIQUE,
  id_cliente INT NOT NULL,
  id_usuario INT NOT NULL,
  nome_cliente VARCHAR(255) NULL,
  nome_usuario VARCHAR(255) NULL,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expira_em TIMESTAMP NULL,
  ativo TINYINT(1) DEFAULT 1,
  id_empresa INT NULL,
  nome_empresa VARCHAR(255) NULL,
  INDEX idx_token (token),
  INDEX idx_cliente (id_cliente)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE pedidos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  numero VARCHAR(12) NOT NULL,
  data_abertura DATE NULL,
  hora_abertura TIME NULL,
  id_usuario INT NULL,
  nome_vendedor VARCHAR(120) NULL,
  cod_cliente INT NULL,
  cnpj VARCHAR(30) NULL,
  nome_cliente VARCHAR(255) NULL,
  cod_fornecedor INT NULL,
  nome_fornecedor VARCHAR(255) NULL,
  id_tipopedido INT NULL,
  tipo_pedido VARCHAR(80) NULL,
  situacao_pedido VARCHAR(30) NULL,
  status VARCHAR(30) NULL,
  vlrsubtotal DECIMAL(15,2) DEFAULT 0,
  vlrtotalitens DECIMAL(15,2) DEFAULT 0,
  vlrtotalpedido DECIMAL(15,2) DEFAULT 0,
  vlrdesconto DECIMAL(15,2) DEFAULT 0,
  vlrtotalimposto DECIMAL(15,2) DEFAULT 0,
  vlrtotalbruto DECIMAL(15,2) DEFAULT 0,
  id_filial INT NULL,
  id_empresa INT NULL,
  nome_empresa VARCHAR(255) NULL,
  obs TEXT NULL,
  origem VARCHAR(30) NULL,
  excluido CHAR(1) NOT NULL DEFAULT 'N',
  dtcadastro DATETIME NULL,
  INDEX idx_ped_cliente (cod_cliente),
  INDEX idx_ped_origem (origem)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE itensped (
  id INT AUTO_INCREMENT PRIMARY KEY,
  numpedido VARCHAR(12) NOT NULL,
  id_pedido INT NOT NULL,
  cod_produto INT NOT NULL,
  desc_prod VARCHAR(255) NOT NULL,
  unidade VARCHAR(12) DEFAULT 'UN',
  quantidade DECIMAL(15,4) NOT NULL,
  valor_unitario DECIMAL(15,2) NOT NULL,
  vlrtotal_itens DECIMAL(15,2) NOT NULL,
  desconto DECIMAL(15,2) DEFAULT 0,
  comissao DECIMAL(15,2) DEFAULT 0,
  st DECIMAL(15,2) DEFAULT 0,
  vlr_st DECIMAL(15,2) DEFAULT 0,
  ipi DECIMAL(15,2) DEFAULT 0,
  vlr_ipi DECIMAL(15,2) DEFAULT 0,
  icms DECIMAL(15,2) DEFAULT 0,
  vlr_icms DECIMAL(15,2) DEFAULT 0,
  tipo_pedido VARCHAR(80) NULL,
  sequencia INT NOT NULL,
  cod_fornecedor INT NULL,
  data_inclusao DATE NULL,
  sincronizar CHAR(1) NOT NULL DEFAULT 'N',
  excluido CHAR(1) NOT NULL DEFAULT 'N',
  INDEX idx_item_pedido (id_pedido)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
