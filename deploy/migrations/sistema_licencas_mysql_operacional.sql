-- Credenciais MySQL do banco OPERACIONAL do cliente (SysRepWeb com CUSTOMER_DB_FROM_LICENSE=true).
-- Execute uma vez no banco central. Se a coluna já existir, ignore o erro da duplicata.

ALTER TABLE sistema_licencas
  ADD COLUMN mysql_host     VARCHAR(255)  NULL COMMENT 'Host MySQL do cliente',
  ADD COLUMN mysql_port     INT           NULL DEFAULT 3306,
  ADD COLUMN mysql_database VARCHAR(191)  NULL,
  ADD COLUMN mysql_user     VARCHAR(128)  NULL,
  ADD COLUMN mysql_password VARCHAR(255)  NULL;
