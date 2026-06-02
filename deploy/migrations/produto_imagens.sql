-- Galeria de imagens por produto (máx 8 por produto)
-- Rode este script UMA VEZ no banco de produção.

CREATE TABLE IF NOT EXISTS produto_imagens (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  cod_produto  INT          NOT NULL,
  filename     VARCHAR(255) NOT NULL,
  is_principal TINYINT(1)   NOT NULL DEFAULT 0,
  ordem        TINYINT      NOT NULL DEFAULT 0,
  dt_upload    DATETIME     NOT NULL DEFAULT NOW(),
  INDEX idx_prod (cod_produto)
);

-- Migrar foto_principal existentes (URLs externas ficam fora — só paths locais fazem sentido)
-- Caso queira limpar o campo antigo depois de migrar manualmente, use:
-- UPDATE produto SET foto_principal = NULL WHERE foto_principal NOT LIKE '/uploads/%';
