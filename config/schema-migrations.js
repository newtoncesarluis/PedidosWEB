/**
 * schema-migrations.js
 * Migrações automáticas de schema executadas no startup.
 * Garante que colunas adicionadas em versões novas existam em bases antigas.
 * Nunca remove ou altera dados; falhas individuais são silenciosas.
 */

// Colunas a garantir em bases antigas — ADD COLUMN se não existir
const MIGRATIONS = [

  // ── PEDIDOS ──────────────────────────────────────────────────────────────
  { table: 'pedidos', column: 'tipo_pedido',        type: "VARCHAR(50) DEFAULT 'PEDIDO'" },
  { table: 'pedidos', column: 'nome_empresa',        type: "VARCHAR(100)" },
  { table: 'pedidos', column: 'origem',              type: "VARCHAR(50)" },
  { table: 'pedidos', column: 'vlrtotalbruto',       type: "DECIMAL(15,2) DEFAULT 0" },
  { table: 'pedidos', column: 'vlr_total_comissao',  type: "DECIMAL(15,2) DEFAULT 0" },
  { table: 'pedidos', column: 'total_peso',          type: "DECIMAL(15,4) DEFAULT 0" },
  { table: 'pedidos', column: 'total_qt',            type: "DECIMAL(15,4) DEFAULT 0" },
  { table: 'pedidos', column: 'vlrtotalitens',       type: "DECIMAL(15,2) DEFAULT 0" },
  { table: 'pedidos', column: 'qt_parcelas',         type: "INT DEFAULT 1" },
  { table: 'pedidos', column: 'prazo_pagto',         type: "VARCHAR(100)" },
  { table: 'pedidos', column: 'nome_transp',         type: "VARCHAR(100)" },
  { table: 'pedidos', column: 'uf',                  type: "VARCHAR(2)" },
  { table: 'pedidos', column: 'coduser_digitacao',   type: "INT" },
  { table: 'pedidos', column: 'id_empresa',          type: "INT" },
  { table: 'pedidos', column: 'puxada',              type: "VARCHAR(1) DEFAULT 'N'" },
  { table: 'pedidos', column: 'tipo_documento',      type: "VARCHAR(20)" },
  { table: 'pedidos', column: 'dataexclusao',        type: "DATE" },
  { table: 'pedidos', column: 'horaexclusao',        type: "TIME" },
  { table: 'pedidos', column: 'id_userexclusao',     type: "INT" },
  { table: 'pedidos', column: 'chave_nfe',           type: "VARCHAR(44) NULL DEFAULT NULL" },
  { table: 'pedidos', column: 'status_nfe',          type: "VARCHAR(20) NULL DEFAULT NULL" },
  { table: 'pedidos', column: 'num_nf',              type: "VARCHAR(30) NULL DEFAULT NULL" },
  { table: 'pedidos', column: 'num_ped_fabrica',     type: "VARCHAR(60) NULL DEFAULT NULL" },

  // ── ITENSPED ─────────────────────────────────────────────────────────────
  { table: 'itensped', column: 'sequencia',              type: "INT DEFAULT 0" },
  { table: 'itensped', column: 'vlr_unitariosemimposto', type: "DECIMAL(15,4) DEFAULT 0" },
  { table: 'itensped', column: 'vlr_totalsemimposto',    type: "DECIMAL(15,2) DEFAULT 0" },
  { table: 'itensped', column: 'vlr_descontototal',      type: "DECIMAL(15,2) DEFAULT 0" },
  { table: 'itensped', column: 'peso',                   type: "DECIMAL(15,4) DEFAULT 0" },
  { table: 'itensped', column: 'multiplo_sigla',         type: "VARCHAR(20) NULL" },
  { table: 'itensped', column: 'multiplo_fator',         type: "DECIMAL(10,4) DEFAULT 1" },
  { table: 'itensped', column: 'tipo_preco',             type: "VARCHAR(10) DEFAULT 'venda'" },
  { table: 'itensped', column: 'vlr_padrao',             type: "DECIMAL(15,4) DEFAULT NULL" },
  { table: 'itensped', column: 'acrescimo',              type: "DECIMAL(15,2) DEFAULT 0" },
  { table: 'itensped', column: 'valor_cliente',          type: "DECIMAL(15,4) DEFAULT 0" },
  { table: 'itensped', column: 'vlrtotalcomimposto',     type: "DECIMAL(15,3) DEFAULT 0" },

  // ── RECEBER ───────────────────────────────────────────────────────────────
  { table: 'receber', column: 'id_pedido',        type: "INT" },
  { table: 'receber', column: 'nome_fornecedor',  type: "VARCHAR(150)" },
  { table: 'receber', column: 'forma_pagto',      type: "VARCHAR(50)" },
  { table: 'receber', column: 'excluido',         type: "VARCHAR(1) DEFAULT 'N'" },
  { table: 'receber', column: 'valor_pago',       type: "DECIMAL(15,2) DEFAULT NULL" },
  { table: 'receber', column: 'data_pagto',       type: "DATE NULL DEFAULT NULL" },
  { table: 'receber', column: 'forma_pagto',      type: "VARCHAR(50) DEFAULT NULL" },

  // ── DESPESAS (Delphi: nome; cadastro web antigo: descricao) ───────────────
  { table: 'despesas', column: 'nome', type: "VARCHAR(100) DEFAULT NULL" },

  // ── PAGTOCOMISSAO ─────────────────────────────────────────────────────────
  { table: 'pagtocomissao', column: 'data_pagar',        type: "DATE NULL DEFAULT NULL" },
  { table: 'pagtocomissao', column: 'data_pagamento',    type: "DATE NULL DEFAULT NULL" },
  { table: 'pagtocomissao', column: 'data_confirmacao',  type: "DATETIME NULL DEFAULT NULL" },
  { table: 'pagtocomissao', column: 'status',            type: "VARCHAR(1) DEFAULT 'P'" },

  // ── FORNECEDORES ──────────────────────────────────────────────────────────
  { table: 'fornecedores', column: 'tipo_desconto',          type: "VARCHAR(20) DEFAULT 'PERCENTUAL'" },
  { table: 'fornecedores', column: 'forma_pagtopadrao',      type: "INT DEFAULT NULL" },
  { table: 'fornecedores', column: 'exibirtodosdesconto',    type: "VARCHAR(1) DEFAULT 'N'" },
  { table: 'fornecedores', column: 'imprimirparcelaspedido', type: "VARCHAR(1) DEFAULT 'N'" },
  { table: 'fornecedores', column: 'cor_obspedido',          type: "VARCHAR(20) DEFAULT NULL" },
  { table: 'fornecedores', column: 'estilo_obspedido',       type: "VARCHAR(50) DEFAULT NULL" },
  { table: 'fornecedores', column: 'pedidos_codfabricante',  type: "VARCHAR(1) DEFAULT 'N'" },
  { table: 'fornecedores', column: 'tipo',                   type: "VARCHAR(20) DEFAULT 'FABRICA'" },
  { table: 'fornecedores', column: 'ipi_frete_base',         type: "CHAR(1) DEFAULT 'N'" },
  { table: 'fornecedores', column: 'com_sobre_ipi',          type: "CHAR(1) DEFAULT 'S'" },
  { table: 'fornecedores', column: 'com_sobre_st',           type: "CHAR(1) DEFAULT 'S'" },
  { table: 'fornecedores', column: 'com_tipo',               type: "VARCHAR(20) DEFAULT 'PARCELADA'" },
  { table: 'fornecedores', column: 'tipo_num_pedido',        type: "VARCHAR(20) DEFAULT 'SISTEMA'" },
  { table: 'fornecedores', column: 'base_conciliacao',       type: "VARCHAR(10) DEFAULT 'PARCELA'" },
  { table: 'fornecedores', column: 'enviar_pedido_fabrica',  type: "CHAR(1) DEFAULT 'N'" },

  // ── CLIENTES ──────────────────────────────────────────────────────────────
  { table: 'clientes', column: 'latitude',       type: "VARCHAR(50) DEFAULT NULL" },
  { table: 'clientes', column: 'longitude',      type: "VARCHAR(50) DEFAULT NULL" },
  { table: 'clientes', column: 'venda_suspensa', type: "VARCHAR(1) DEFAULT 'N'" },
  { table: 'clientes', column: 'skype',          type: "VARCHAR(100) DEFAULT NULL" },
  { table: 'clientes', column: 'site',           type: "VARCHAR(255) DEFAULT NULL" },
  { table: 'clientes', column: 'instagram',      type: "VARCHAR(255) DEFAULT NULL" },
  { table: 'clientes', column: 'facebook',       type: "VARCHAR(255) DEFAULT NULL" },
  { table: 'clientes', column: 'linkedin',       type: "VARCHAR(255) DEFAULT NULL" },
  { table: 'clientes', column: 'dnd',           type: "CHAR(1) DEFAULT 'N'" },

  // ── LEADS ─────────────────────────────────────────────────────────────────
  { table: 'leads', column: 'whatsapp',            type: "VARCHAR(30) NOT NULL DEFAULT ''" },
  { table: 'leads', column: 'instagram',           type: "VARCHAR(120) NOT NULL DEFAULT ''" },
  { table: 'leads', column: 'facebook',            type: "VARCHAR(120) NOT NULL DEFAULT ''" },
  { table: 'leads', column: 'segmento',            type: "VARCHAR(120) NOT NULL DEFAULT ''" },
  { table: 'leads', column: 'cargo',               type: "VARCHAR(100) NOT NULL DEFAULT ''" },
  { table: 'leads', column: 'campanha',            type: "VARCHAR(120) NOT NULL DEFAULT ''" },
  { table: 'leads', column: 'anuncio',             type: "VARCHAR(120) NOT NULL DEFAULT ''" },
  { table: 'leads', column: 'produto_interesse',   type: "VARCHAR(150) NOT NULL DEFAULT ''" },
  { table: 'leads', column: 'score',               type: "INT NOT NULL DEFAULT 0" },
  { table: 'leads', column: 'temperatura_lead',    type: "VARCHAR(20) NOT NULL DEFAULT 'FRIO'" },
  { table: 'leads', column: 'prioridade',          type: "VARCHAR(20) NOT NULL DEFAULT 'MEDIA'" },
  { table: 'leads', column: 'canal_atendimento',   type: "VARCHAR(40) NOT NULL DEFAULT 'COMERCIAL'" },
  { table: 'leads', column: 'motivo_perda',        type: "VARCHAR(255) NOT NULL DEFAULT ''" },
  { table: 'leads', column: 'valor_estimado',      type: "DECIMAL(14,2) NOT NULL DEFAULT 0" },
  { table: 'leads', column: 'tags',                type: "VARCHAR(255) NOT NULL DEFAULT ''" },
  { table: 'leads', column: 'data_ultimo_contato', type: "DATETIME NULL" },
  { table: 'leads', column: 'convertido_pedido_id',type: "INT NULL" },

  // ── PAGAR ────────────────────────────────────────────────────────────────────
  { table: 'pagar', column: 'historico_rec', type: "VARCHAR(500) DEFAULT NULL" },

  // ── API Pública — campos para integração ERP ─────────────────────────────
  { table: 'pedidos',  column: 'id_parceiro',       type: 'VARCHAR(36) NULL DEFAULT NULL' },
  { table: 'pedidos',  column: 'data_faturamento',  type: 'DATE NULL DEFAULT NULL' },
  { table: 'pedidos',  column: 'data_cancelamento', type: 'DATE NULL DEFAULT NULL' },
  { table: 'clientes', column: 'id_parceiro',       type: 'VARCHAR(36) NULL DEFAULT NULL' },
  { table: 'produto',  column: 'id_parceiro',       type: 'VARCHAR(36) NULL DEFAULT NULL' },
  { table: 'produtos', column: 'id_parceiro',       type: 'VARCHAR(36) NULL DEFAULT NULL' },

  // ── TELE_CAMPANHAS (colunas novas em base existente) ─────────────────────────
  { table: 'tele_campanhas', column: 'max_tentativas', type: 'INT NOT NULL DEFAULT 3' },
  { table: 'tele_campanhas', column: 'horario_inicio', type: 'TIME NULL' },
  { table: 'tele_campanhas', column: 'horario_fim',    type: 'TIME NULL' },

  // ── PEDIDOS — controle de envio de emails ────────────────────────────────────
  { table: 'pedidos', column: 'emailclienteenviado', type: "CHAR(1) DEFAULT 'N'" },
  { table: 'pedidos', column: 'emailforenviado',     type: "CHAR(1) DEFAULT 'N'" },
  { table: 'pedidos', column: 'emailvendenviado',    type: "CHAR(1) DEFAULT 'N'" },
];

// Tabelas novas — cria se não existir (apenas estrutura mínima)
const CREATE_IF_NOT_EXISTS = [
  {
    name: 'preferencias_grid',
    sql: `CREATE TABLE IF NOT EXISTS preferencias_grid (
      id INT AUTO_INCREMENT PRIMARY KEY,
      id_usuario INT NOT NULL,
      nome_grid VARCHAR(50) NOT NULL,
      config_json TEXT NOT NULL,
      dt_alterado DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unq_user_grid (id_usuario, nome_grid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3`,
  },
  {
    name: 'fornecedor_condicoes_pagamento',
    sql: `CREATE TABLE IF NOT EXISTS fornecedor_condicoes_pagamento (
      id INT AUTO_INCREMENT PRIMARY KEY,
      id_fornecedor INT NOT NULL,
      id_condicao INT NOT NULL,
      valor_minimo DECIMAL(15,2) DEFAULT 0.00,
      excluido CHAR(1) DEFAULT 'N',
      INDEX idx_forn_cond (id_fornecedor)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'fornecedor_emails',
    sql: `CREATE TABLE IF NOT EXISTS fornecedor_emails (
      id INT AUTO_INCREMENT PRIMARY KEY,
      id_fornecedor INT NOT NULL,
      email VARCHAR(255) NOT NULL,
      descricao VARCHAR(100) DEFAULT NULL,
      excluido CHAR(1) DEFAULT 'N',
      dtcadastro DATE DEFAULT (CURDATE()),
      INDEX idx_fe_fornecedor (id_fornecedor)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'logs_pedidos',
    sql: `CREATE TABLE IF NOT EXISTS logs_pedidos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      id_pedido INT NOT NULL,
      id_usuario INT NOT NULL,
      acao VARCHAR(100) NOT NULL,
      status_antigo VARCHAR(50),
      status_novo VARCHAR(50),
      detalhes TEXT,
      data_hora DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3`,
  },

  // ── TELEATENDIMENTO ──────────────────────────────────────────────────────────
  {
    name: 'tele_campanhas',
    sql: `CREATE TABLE IF NOT EXISTS tele_campanhas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      id_empresa INT NOT NULL DEFAULT 1,
      nome VARCHAR(150) NOT NULL,
      descricao TEXT NULL,
      script_abordagem TEXT NULL,
      data_inicio DATE NULL,
      data_fim DATE NULL,
      meta_ligacoes_dia INT DEFAULT 0,
      max_tentativas INT NOT NULL DEFAULT 3,
      horario_inicio TIME NULL,
      horario_fim TIME NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'ATIVA',
      id_usuario_criador INT NOT NULL DEFAULT 0,
      excluido CHAR(1) NOT NULL DEFAULT 'N',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_tc_empresa (id_empresa),
      INDEX idx_tc_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'tele_fila',
    sql: `CREATE TABLE IF NOT EXISTS tele_fila (
      id INT AUTO_INCREMENT PRIMARY KEY,
      id_campanha INT NOT NULL,
      id_empresa INT NOT NULL DEFAULT 1,
      id_cliente INT NULL,
      nome_prospect VARCHAR(150) NOT NULL DEFAULT '',
      telefone VARCHAR(30) NOT NULL DEFAULT '',
      cidade VARCHAR(100) NOT NULL DEFAULT '',
      uf VARCHAR(2) NOT NULL DEFAULT '',
      ordem INT NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
      id_operador_atual INT NULL,
      tentativas INT NOT NULL DEFAULT 0,
      max_tentativas INT NOT NULL DEFAULT 3,
      proximo_contato DATETIME NULL,
      excluido CHAR(1) NOT NULL DEFAULT 'N',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_tf_campanha (id_campanha),
      INDEX idx_tf_status (status),
      INDEX idx_tf_cliente (id_cliente),
      INDEX idx_tf_operador (id_operador_atual)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'tele_chamadas',
    sql: `CREATE TABLE IF NOT EXISTS tele_chamadas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      id_fila INT NOT NULL,
      id_campanha INT NOT NULL,
      id_empresa INT NOT NULL DEFAULT 1,
      id_operador INT NOT NULL,
      id_cliente INT NULL,
      data_hora_inicio DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      data_hora_fim DATETIME NULL,
      duracao_seg INT NULL,
      resultado VARCHAR(40) NOT NULL DEFAULT 'NAO_ATENDEU',
      observacao TEXT NULL,
      id_pedido INT NULL,
      id_lead INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_tch_campanha (id_campanha),
      INDEX idx_tch_operador (id_operador),
      INDEX idx_tch_cliente (id_cliente),
      INDEX idx_tch_data (data_hora_inicio)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'tele_pausas',
    sql: `CREATE TABLE IF NOT EXISTS tele_pausas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      id_campanha INT NOT NULL,
      id_empresa INT NOT NULL DEFAULT 1,
      id_operador INT NOT NULL,
      inicio DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      fim DATETIME NULL,
      duracao_seg INT NULL,
      motivo VARCHAR(100) NULL,
      INDEX idx_tp_operador (id_operador),
      INDEX idx_tp_campanha (id_campanha),
      INDEX idx_tp_data (inicio)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
];

async function runMigrations(pool) {
  try {
    // 1. Busca todas as colunas existentes nas tabelas relevantes (uma query só)
    const tables = [...new Set(MIGRATIONS.map(m => m.table))];
    const placeholders = tables.map(() => '?').join(',');

    const [existingCols] = await pool.query(
      `SELECT TABLE_NAME, COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME IN (${placeholders})`,
      tables
    );

    const existing = new Set(existingCols.map(r => `${r.TABLE_NAME}.${r.COLUMN_NAME}`));

    // 2. Adiciona colunas faltantes
    const adicionadas = [];
    const erros = [];

    for (const m of MIGRATIONS) {
      if (existing.has(`${m.table}.${m.column}`)) continue;
      try {
        await pool.query(`ALTER TABLE \`${m.table}\` ADD COLUMN \`${m.column}\` ${m.type}`);
        console.log(`[schema] + ${m.table}.${m.column}`);
        adicionadas.push(`${m.table}.${m.column}`);
      } catch (e) {
        // Tabela não existe nesta base ou coluna adicionada em paralelo — ok
        if (!e.message?.includes('Duplicate column')) {
          erros.push(`${m.table}.${m.column}: ${e.message}`);
        }
      }
    }

    // 2b. despesas: copia descricao → nome quando ambas existem (legado Delphi)
    try {
      const [dCols] = await pool.query('SHOW COLUMNS FROM despesas');
      const dSet = new Set(dCols.map((r) => r.Field));
      if (dSet.has('nome') && dSet.has('descricao')) {
        await pool.query(
          `UPDATE despesas SET nome = descricao
           WHERE (nome IS NULL OR TRIM(nome) = '')
             AND descricao IS NOT NULL AND TRIM(descricao) <> ''`
        ).catch(() => {});
      }
      try {
        const { resetDespesasLabelCache } = require('./despesas-label');
        resetDespesasLabelCache();
      } catch { /* ok */ }
    } catch { /* tabela inexistente */ }

    // 3. Tabela produto vs produtos — detecta nome e garante colunas novas
    try {
      const [prodRows] = await pool.query(`SHOW TABLES LIKE 'produto'`);
      const prodTable = prodRows.length ? 'produto' : 'produtos';
      const prodCols = [
        { column: 'multiplo_venda', type: 'INT NOT NULL DEFAULT 1' },
        { column: 'foto_principal', type: 'TEXT NULL' },
        { column: 'comissao',       type: 'DECIMAL(5,2) NULL DEFAULT 0' },
      ];
      const [existProd] = await pool.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [prodTable]
      );
      const existProdSet = new Set(existProd.map(r => r.COLUMN_NAME));
      for (const c of prodCols) {
        if (!existProdSet.has(c.column)) {
          await pool.query(`ALTER TABLE \`${prodTable}\` ADD COLUMN \`${c.column}\` ${c.type}`).catch(() => {});
          console.log(`[schema] + ${prodTable}.${c.column}`);
          adicionadas.push(`${prodTable}.${c.column}`);
        }
      }
    } catch {
      // Tabela produto/produtos inexistente — ignorar
    }

    // 4. Cria tabelas novas se não existirem
    for (const t of CREATE_IF_NOT_EXISTS) {
      await pool.query(t.sql).catch(() => {});
    }

    if (adicionadas.length > 0) {
      console.log(`[schema] Migração concluída — ${adicionadas.length} coluna(s) adicionada(s).`);
    } else {
      console.log('[schema] Schema OK.');
    }

    return { ok: true, adicionadas, erros };
  } catch (err) {
    console.warn('[schema] Aviso: não foi possível verificar schema:', err.message);
    return { ok: false, adicionadas: [], erros: [err.message] };
  }
}

module.exports = { runMigrations };
