-- ============================================================
-- BASE DE DADOS: sistema_licencas (servidor remoto/central)
-- Gerenciamento central de licenças do SysRepWeb
-- Execute este script UMA VEZ no servidor de licenças
-- ============================================================

CREATE DATABASE IF NOT EXISTS sistema_licencas
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE sistema_licencas;

-- ── Licenças ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sistema_licencas (
  id                  INT             NOT NULL AUTO_INCREMENT,
  chave_licenca       VARCHAR(19)     NOT NULL,
  razao_social        VARCHAR(200)    NOT NULL,
  cnpj_cpf            VARCHAR(20)     NULL,
  email               VARCHAR(200)    NULL,
  telefone            VARCHAR(30)     NULL,
  whatsapp            VARCHAR(30)     NULL,
  cidade              VARCHAR(100)    NULL,
  estado              VARCHAR(2)      NULL,
  tipo_licenca        ENUM('trial','mensal','anual','vitalicia','demo') NOT NULL DEFAULT 'anual',
  data_inicio         DATE            NULL,
  data_fim            DATE            NULL,
  limite_usuarios     INT             NOT NULL DEFAULT 10,
  valor_mensal        DECIMAL(10,2)   NULL,
  status              ENUM('ativo','bloqueado','expirado','suspenso','trial') NOT NULL DEFAULT 'ativo',
  ativo               TINYINT(1)      NOT NULL DEFAULT 1,
  motivo_bloqueio     TEXT            NULL,
  bloqueado_em        DATETIME        NULL,
  data_ultimo_acesso  DATETIME        NULL,
  observacoes              TEXT            NULL,
  limite_dias_vencimento   INT             NOT NULL DEFAULT 0 COMMENT 'Dias de carência após vencimento',
  criado_em                DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em       DATETIME        NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_chave (chave_licenca),
  KEY idx_status (status),
  KEY idx_data_fim (data_fim)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Histórico de ações ────────────────────────────────────
CREATE TABLE IF NOT EXISTS historico_licencas (
  id          INT         NOT NULL AUTO_INCREMENT,
  licenca_id  INT         NOT NULL,
  acao        VARCHAR(50) NOT NULL COMMENT 'criacao,ativacao,bloqueio,renovacao,verificacao',
  ip_origem   VARCHAR(50) NULL,
  detalhes    JSON        NULL,
  data_hora   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_licenca (licenca_id),
  KEY idx_data_hora (data_hora),
  FOREIGN KEY (licenca_id) REFERENCES sistema_licencas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
