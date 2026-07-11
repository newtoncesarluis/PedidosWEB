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
  { table: 'itensped', column: 'tipo_preco',             type: "VARCHAR(30) DEFAULT 'venda'" },
  { table: 'itensped', column: 'id_promocao',            type: 'INT NULL DEFAULT NULL' },
  { table: 'itensped', column: 'promocao_descricao',     type: 'VARCHAR(200) NULL DEFAULT NULL' },
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

  // ── USUARIOS / PREPOSTO ───────────────────────────────────────────────────
  // Modo de visibilidade da carteira para o preposto: TODOS (toda a carteira do
  // representante = id_gerente) ou ATRIBUIDOS (só clientes vinculados em preposto_cliente)
  { table: 'usuarios', column: 'preposto_visibilidade', type: "VARCHAR(20) DEFAULT 'TODOS'" },

  // Política de carteira (opt-in): LEGADO mantém flags antigas; FECHADA/EQUIPE/ABERTA simplificam
  { table: 'sistemas', column: 'carteira_politica',              type: "VARCHAR(20) NOT NULL DEFAULT 'LEGADO'" },

  // Colunas web-only de sistemas — ausentes em bases Delphi legadas sem git pull/restart
  { table: 'sistemas', column: 'gpermitecnpjduplicadoclientes',  type: "VARCHAR(1) DEFAULT 'N'" },
  { table: 'sistemas', column: 'gacessartodosclientes',          type: "VARCHAR(1) DEFAULT 'N'" },
  { table: 'sistemas', column: 'gcompartilhaCliente',            type: "VARCHAR(1) DEFAULT 'N'" },
  { table: 'sistemas', column: 'grestringirdadosesquipe',        type: "VARCHAR(1) DEFAULT 'N'" },
  { table: 'sistemas', column: 'gIDGerente',                     type: "INT DEFAULT NULL" },
  { table: 'sistemas', column: 'galteravendedorcadastrocli',     type: "VARCHAR(1) DEFAULT 'N'" },
  { table: 'sistemas', column: 'ggerenciaregiaocadastrocli',     type: "VARCHAR(1) DEFAULT 'N'" },
  { table: 'sistemas', column: 'gincluir_clientes',              type: "VARCHAR(1) DEFAULT 'S'" },
  { table: 'sistemas', column: 'galterar_clientes',              type: "VARCHAR(1) DEFAULT 'S'" },
  { table: 'sistemas', column: 'gexclui_clientes',               type: "VARCHAR(1) DEFAULT 'N'" },
  { table: 'sistemas', column: 'gcampos_cadastrocliente',        type: "VARCHAR(255) DEFAULT NULL" },
  { table: 'sistemas', column: 'gformaspagtocadastro',           type: "VARCHAR(1) DEFAULT 'N'" },
  { table: 'sistemas', column: 'gmoduloclinca',                  type: "VARCHAR(1) DEFAULT 'N'" },
  { table: 'sistemas', column: 'gcodigoauxiliar',                type: "VARCHAR(1) DEFAULT 'N'" },
  { table: 'sistemas', column: 'gcostumizadopara',               type: "VARCHAR(255) DEFAULT NULL" },
  { table: 'sistemas', column: 'glimitexibepedido',              type: "INT DEFAULT 0" },
  { table: 'sistemas', column: 'gufpadraocadastros',             type: "VARCHAR(2) DEFAULT NULL" },
  { table: 'sistemas', column: 'habilitarestoque',               type: "VARCHAR(1) DEFAULT 'N'" },
  { table: 'sistemas', column: 'tipo_pedido_padrao',             type: "VARCHAR(50) DEFAULT NULL" },
  { table: 'sistemas', column: 'habilita_tipodoc',               type: "VARCHAR(255) DEFAULT NULL" },
  { table: 'sistemas', column: 'modelo_impress_editar_texto',    type: "VARCHAR(255) DEFAULT NULL" },
  { table: 'sistemas', column: 'modelo_impress_replicar_todos',  type: "VARCHAR(255) DEFAULT NULL" },
  { table: 'sistemas', column: 'modelo_impress_texto_cabecalho', type: "TEXT NULL" },
  { table: 'sistemas', column: 'modelo_impress_texto_rodape',    type: "TEXT NULL" },
  { table: 'sistemas', column: 'porta_banco',                    type: "VARCHAR(10) NULL DEFAULT '3306'" },
  { table: 'sistemas', column: 'habilitarfrenteprodutos',        type: "VARCHAR(1) DEFAULT 'N'" },
  { table: 'sistemas', column: 'habilitapuxada',                 type: "VARCHAR(1) DEFAULT 'N'" },
  { table: 'sistemas', column: 'distribucaiemailpedidos',        type: "VARCHAR(1) DEFAULT 'N'" },

  // ── USUARIOS — WhatsApp Evolution + metas ─────────────────────────────────
  { table: 'usuarios', column: 'instancia',        type: 'VARCHAR(100) NULL DEFAULT NULL' },
  { table: 'usuarios', column: 'chave',            type: 'VARCHAR(250) NULL DEFAULT NULL' },
  { table: 'usuarios', column: 'numero_whatsApp',  type: 'VARCHAR(50) NULL DEFAULT NULL' },
  { table: 'usuarios', column: 'status',           type: 'VARCHAR(30) NULL DEFAULT NULL' },
  { table: 'usuarios', column: 'data_conexao',     type: 'DATETIME NULL DEFAULT NULL' },
  { table: 'usuarios', column: 'comissao_vista',   type: 'DECIMAL(15,3) DEFAULT 0' },
  { table: 'usuarios', column: 'comissao_prazo',   type: 'DECIMAL(15,3) DEFAULT 0' },
  { table: 'usuarios', column: 'vlr_meta',         type: 'DECIMAL(15,3) DEFAULT 0' },

  // ── PAGTOCOMISSAO ─────────────────────────────────────────────────────────
  { table: 'pagtocomissao', column: 'data_pagar',        type: "DATE NULL DEFAULT NULL" },
  { table: 'pagtocomissao', column: 'data_pagamento',    type: "DATE NULL DEFAULT NULL" },
  { table: 'pagtocomissao', column: 'data_confirmacao',  type: "DATETIME NULL DEFAULT NULL" },
  { table: 'pagtocomissao', column: 'status',            type: "VARCHAR(1) DEFAULT 'P'" },
  { table: 'pagtocomissao', column: 'excluido',            type: "VARCHAR(1) DEFAULT 'N'" },
  { table: 'pagtocomissao', column: 'id_preposto',       type: 'INT NULL DEFAULT NULL' },
  { table: 'pagtocomissao', column: 'vlr_pago_original', type: 'DECIMAL(15,4) DEFAULT NULL' },

  // ── FORNECEDORES ──────────────────────────────────────────────────────────
  { table: 'fornecedores', column: 'tipo_desconto',          type: "VARCHAR(20) DEFAULT 'PERCENTUAL'" },
  { table: 'fornecedores', column: 'forma_pagtopadrao',      type: "INT DEFAULT NULL" },
  { table: 'fornecedores', column: 'exibirtodosdesconto',    type: "VARCHAR(1) DEFAULT 'N'" },
  { table: 'fornecedores', column: 'imprimirparcelaspedido', type: "VARCHAR(1) DEFAULT 'N'" },
  { table: 'fornecedores', column: 'cor_obspedido',          type: "VARCHAR(20) DEFAULT NULL" },
  { table: 'fornecedores', column: 'estilo_obspedido',       type: "VARCHAR(50) DEFAULT NULL" },
  { table: 'fornecedores', column: 'obsitem_pedido',         type: "VARCHAR(1) DEFAULT 'N'" },
  { table: 'itensped', column: 'obsitem', type: "VARCHAR(100) DEFAULT NULL" },
  { table: 'itensped', column: 'id_grade',     type: 'INT NULL DEFAULT NULL' },
  { table: 'itensped', column: 'solado',       type: 'VARCHAR(50) NULL DEFAULT NULL' },
  { table: 'itensped', column: 'tipo_grade',   type: 'VARCHAR(200) NULL DEFAULT NULL' },
  { table: 'itensped', column: 'grade_resumo', type: 'VARCHAR(300) NULL DEFAULT NULL' },
  { table: 'fornecedores', column: 'pedidos_codfabricante',  type: "VARCHAR(1) DEFAULT 'N'" },
  { table: 'fornecedores', column: 'tipo',                   type: "VARCHAR(20) DEFAULT 'FABRICA'" },
  { table: 'fornecedores', column: 'url_logo',               type: 'VARCHAR(500) NULL DEFAULT NULL' },
  { table: 'fornecedores', column: 'produtofornecedor',      type: "VARCHAR(1) DEFAULT 'N'" },
  { table: 'fornecedores', column: 'parcela_pedvendas',      type: "VARCHAR(30) DEFAULT 'DATA_ABERTURA'" },
  { table: 'fornecedores', column: 'fotosprodutospedido',    type: "VARCHAR(1) DEFAULT 'N'" },

  // ── PEDIDOS / PERFIL / TABELA PREÇO ───────────────────────────────────────
  { table: 'pedidos', column: 'dtcadastro', type: 'DATE NULL DEFAULT NULL' },
  { table: 'perfil', column: 'dash_avisofinanceiro', type: "VARCHAR(1) DEFAULT 'N'" },
  { table: 'tabela_preco_cabecalho', column: 'tabela_padrao', type: "VARCHAR(1) DEFAULT 'N'" },
  { table: 'tabela_preco_cabecalho', column: 'atualizar_tabelapadrao', type: "VARCHAR(1) DEFAULT 'N'" },
  { table: 'fornecedores', column: 'ipi_frete_base',         type: "CHAR(1) DEFAULT 'N'" },
  { table: 'fornecedores', column: 'com_sobre_ipi',          type: "CHAR(1) DEFAULT 'S'" },
  { table: 'fornecedores', column: 'com_sobre_st',           type: "CHAR(1) DEFAULT 'S'" },
  { table: 'fornecedores', column: 'com_tipo',               type: "VARCHAR(20) DEFAULT 'PARCELADA'" },
  { table: 'fornecedores', column: 'tipo_num_pedido',        type: "VARCHAR(20) DEFAULT 'SISTEMA'" },
  { table: 'fornecedores', column: 'base_conciliacao',       type: "VARCHAR(10) DEFAULT 'PARCELA'" },
  { table: 'fornecedores', column: 'enviar_pedido_fabrica',  type: "CHAR(1) DEFAULT 'N'" },
  { table: 'fornecedores', column: 'layout_impressao',       type: "VARCHAR(20) DEFAULT 'PADRAO'" },

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
  { table: 'clientes', column: 'updated_at',        type: 'DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP' },
  { table: 'produto',  column: 'id_parceiro',       type: 'VARCHAR(36) NULL DEFAULT NULL' },
  { table: 'produto',  column: 'updated_at',        type: 'DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP' },
  { table: 'produtos', column: 'id_parceiro',       type: 'VARCHAR(36) NULL DEFAULT NULL' },
  { table: 'produtos', column: 'updated_at',        type: 'DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP' },
  { table: 'produto',  column: 'precopeso',         type: "CHAR(1) NOT NULL DEFAULT 'N'" },
  { table: 'produtos', column: 'precopeso',         type: "CHAR(1) NOT NULL DEFAULT 'N'" },

  // ── TELE_CAMPANHAS (colunas novas em base existente) ─────────────────────────
  { table: 'tele_campanhas', column: 'max_tentativas', type: 'INT NOT NULL DEFAULT 3' },
  { table: 'tele_campanhas', column: 'horario_inicio', type: 'TIME NULL' },
  { table: 'tele_campanhas', column: 'horario_fim',    type: 'TIME NULL' },

  // ── PRODUTO_PROMOCOES — promo por cliente (NULL = todos) ─────────────────────
  { table: 'produto_promocoes', column: 'cod_cliente', type: 'INT NULL DEFAULT NULL' },
  { table: 'produto_promocoes', column: 'id_regiao', type: 'INT NULL DEFAULT NULL' },
  { table: 'produto_promocoes', column: 'cod_fornecedor', type: 'INT NULL DEFAULT NULL' },
  { table: 'produto_promocoes', column: 'id_tabela_preco', type: 'INT NULL DEFAULT NULL' },
  { table: 'produto_promocoes', column: 'tabelas_preco', type: 'VARCHAR(500) NULL DEFAULT NULL' },
  { table: 'produto_promocoes', column: 'sync_precopromo', type: "CHAR(1) NOT NULL DEFAULT 'N'" },
  { table: 'produto_promocoes', column: 'id_campanha', type: 'INT NULL DEFAULT NULL' },
  { table: 'promocoes_campanha', column: 'tabelas_preco', type: 'VARCHAR(500) NULL DEFAULT NULL' },

  // ── PERFIL — promoções comerciais ────────────────────────────────────────────
  { table: 'perfil', column: 'incluir_promocoes', type: "CHAR(1) NOT NULL DEFAULT 'S'" },
  { table: 'perfil', column: 'alterar_promocoes', type: "CHAR(1) NOT NULL DEFAULT 'S'" },
  { table: 'perfil', column: 'excluir_promocoes', type: "CHAR(1) NOT NULL DEFAULT 'S'" },
  { table: 'perfil', column: 'prorrogar_promocoes', type: "CHAR(1) NOT NULL DEFAULT 'S'" },
  { table: 'perfil', column: 'manutencao_promocoes', type: "CHAR(1) NOT NULL DEFAULT 'S'" },
  { table: 'perfil', column: 'acessar_cadastros', type: "CHAR(1) NOT NULL DEFAULT 'S'" },
  { table: 'perfil', column: 'tela_clientes', type: "CHAR(1) NOT NULL DEFAULT 'S'" },
  { table: 'perfil', column: 'tela_fornecedores', type: "CHAR(1) NOT NULL DEFAULT 'S'" },
  { table: 'perfil', column: 'tela_produtos', type: "CHAR(1) NOT NULL DEFAULT 'S'" },
  ...require('./cadastros-permissoes').migrationEntriesForCadastros(),

  // ── PERFIL — permissões de ações no pedido ───────────────────────────────────
  { table: 'perfil', column: 'faturar_pedido',       type: "CHAR(1) NOT NULL DEFAULT 'S'" },
  { table: 'perfil', column: 'marcar_enviado_rep',        type: "CHAR(1) NOT NULL DEFAULT 'S'" },
  { table: 'perfil', column: 'desbloquear_pedido_enviado', type: "CHAR(1) NOT NULL DEFAULT 'N'" },
  { table: 'perfil', column: 'acessar_metas_vendas',      type: "CHAR(1) NOT NULL DEFAULT 'S'" },
  { table: 'perfil', column: 'acessar_vendastodos',       type: "CHAR(1) NOT NULL DEFAULT 'S'" },

  // ── PEDIDOS — controle de envio de emails ────────────────────────────────────
  { table: 'pedidos', column: 'emailclienteenviado', type: "CHAR(1) DEFAULT 'N'" },
  { table: 'pedidos', column: 'emailforenviado',     type: "CHAR(1) DEFAULT 'N'" },
  { table: 'pedidos', column: 'emailvendenviado',    type: "CHAR(1) DEFAULT 'N'" },

  // ── FORNECEDORES — módulo Kit Feirinha / preço médio de revenda ─────────────
  { table: 'fornecedores', column: 'habilita_feirinha', type: "CHAR(1) NOT NULL DEFAULT 'N'" },

  // ── PEDIDOS — campanha Feirinha vinculada ───────────────────────────────────
  { table: 'pedidos', column: 'id_campanha_feirinha', type: 'INT NULL DEFAULT NULL' },
  { table: 'pedidos', column: 'preco_medio_feirinha', type: 'DECIMAL(15,4) NULL DEFAULT NULL' },
  { table: 'pedidos', column: 'preco_revenda_feirinha', type: 'DECIMAL(15,2) NULL DEFAULT NULL' },

  // ── PEDIDOS — retorno agendado (follow-up comercial) ────────────────────────
  { table: 'pedidos', column: 'data_retorno', type: 'DATE NULL DEFAULT NULL' },
  { table: 'pedidos', column: 'obs_retorno',  type: 'VARCHAR(255) NULL DEFAULT NULL' },

  // ── PEDIDOS — observação encadeada para o próximo pedido (cliente + fábrica) ─
  { table: 'pedidos', column: 'obs_proximo_pedido',   type: 'VARCHAR(500) NULL DEFAULT NULL' },
  { table: 'pedidos', column: 'obs_proximo_consumido', type: "ENUM('S','N') NULL DEFAULT 'N'" },

  // ── CAMPANHAS FEIRINHA — banner / tema visual ───────────────────────────────
  { table: 'campanhas_feirinha', column: 'tema_banner', type: "VARCHAR(200) NULL DEFAULT NULL" },

  // ── PRODUTO — campos de estoque completos ────────────────────────────────────
  { table: 'produto',  column: 'estoque_atual',     type: "DECIMAL(15,4) DEFAULT 0" },
  { table: 'produto',  column: 'estoque_minimo',    type: "DECIMAL(15,4) DEFAULT 0" },
  { table: 'produto',  column: 'estoque_maximo',    type: "DECIMAL(15,4) DEFAULT 0" },
  { table: 'produto',  column: 'estoque_seguranca', type: "DECIMAL(15,4) DEFAULT 0" },
  { table: 'produto',  column: 'segmento',          type: "VARCHAR(100) NULL DEFAULT NULL" },
  { table: 'produtos', column: 'estoque_atual',     type: "DECIMAL(15,4) DEFAULT 0" },
  { table: 'produtos', column: 'estoque_minimo',    type: "DECIMAL(15,4) DEFAULT 0" },
  { table: 'produtos', column: 'estoque_maximo',    type: "DECIMAL(15,4) DEFAULT 0" },
  { table: 'produtos', column: 'estoque_seguranca', type: "DECIMAL(15,4) DEFAULT 0" },

  // ── PERFIL — gestão de estoque ───────────────────────────────────────────────
  { table: 'perfil', column: 'tela_estoque',    type: "CHAR(1) NOT NULL DEFAULT 'S'" },
  { table: 'perfil', column: 'incluir_estoque', type: "CHAR(1) NOT NULL DEFAULT 'S'" },
  { table: 'perfil', column: 'alterar_estoque', type: "CHAR(1) NOT NULL DEFAULT 'S'" },
  { table: 'perfil', column: 'excluir_estoque', type: "CHAR(1) NOT NULL DEFAULT 'N'" },

  // ── FORNECEDORES — frete padrão (CIF/FOB) ────────────────────────────────────
  { table: 'fornecedores', column: 'frete_padrao', type: "VARCHAR(10) DEFAULT NULL" },

  // ── PRODUTO — bloqueio e limite de desconto ───────────────────────────────────
  { table: 'produto',  column: 'bloquear_desconto', type: "CHAR(1) NOT NULL DEFAULT 'N'" },
  { table: 'produto',  column: 'desconto_maximo',   type: "DECIMAL(5,2) DEFAULT NULL" },
  { table: 'produtos', column: 'bloquear_desconto', type: "CHAR(1) NOT NULL DEFAULT 'N'" },
  { table: 'produtos', column: 'desconto_maximo',   type: "DECIMAL(5,2) DEFAULT NULL" },

  // ── TABELA_PRECO_CABECALHO — visibilidade no app mobile ──────────────────────
  // DEFAULT 'S' para não quebrar tabelas existentes (já aparecem no mobile)
  { table: 'tabela_preco_cabecalho', column: 'aparece_mobile', type: "CHAR(1) NOT NULL DEFAULT 'S'" },

  // ── FORNECEDORES — alerta de tabela de preço desatualizada ───────────────────
  { table: 'fornecedores', column: 'alertar_tabela_desatualizada', type: "CHAR(1) NOT NULL DEFAULT 'N'" },

  // ── PRODUTO — quantidade mínima flexível no pedido (independente de múltiplo) ─
  { table: 'produto',  column: 'qtd_minima_pedido', type: 'INT NOT NULL DEFAULT 0' },
  { table: 'produtos', column: 'qtd_minima_pedido', type: 'INT NOT NULL DEFAULT 0' },

  // ── FORNECEDORES — kit de pedido sugerido + descontos condicionais ───────────
  { table: 'fornecedores', column: 'habilita_kit_pedido',           type: "CHAR(1) NOT NULL DEFAULT 'N'" },
  { table: 'fornecedores', column: 'kit_desconto_pct',              type: 'DECIMAL(5,2) NULL DEFAULT NULL' },
  { table: 'fornecedores', column: 'desconto_primeira_compra_pct',  type: 'DECIMAL(5,2) NULL DEFAULT NULL' },
  { table: 'fornecedores', column: 'promo_primeira_compra_exige_kit', type: "CHAR(1) NOT NULL DEFAULT 'N'" },
  { table: 'fornecedores', column: 'promo_condicao_pagto',          type: "VARCHAR(50) NULL DEFAULT NULL" },
  { table: 'fornecedores', column: 'promo_texto_banner',            type: "VARCHAR(200) NULL DEFAULT NULL" },

  // ── CONTROLE DE ACESSOS — localização (Geo-IP + GPS) ─────────────────────────
  { table: 'acessos_dispositivos', column: 'cidade',    type: "VARCHAR(80) NULL DEFAULT NULL" },
  { table: 'acessos_dispositivos', column: 'estado',    type: "VARCHAR(80) NULL DEFAULT NULL" },
  { table: 'acessos_dispositivos', column: 'pais',      type: "VARCHAR(60) NULL DEFAULT NULL" },
  { table: 'acessos_dispositivos', column: 'latitude',  type: "DECIMAL(10,7) NULL DEFAULT NULL" },
  { table: 'acessos_dispositivos', column: 'longitude', type: "DECIMAL(10,7) NULL DEFAULT NULL" },
  { table: 'acessos_log', column: 'cidade',    type: "VARCHAR(80) NULL DEFAULT NULL" },
  { table: 'acessos_log', column: 'estado',    type: "VARCHAR(80) NULL DEFAULT NULL" },
  { table: 'acessos_log', column: 'pais',      type: "VARCHAR(60) NULL DEFAULT NULL" },
  { table: 'acessos_log', column: 'latitude',  type: "DECIMAL(10,7) NULL DEFAULT NULL" },
  { table: 'acessos_log', column: 'longitude', type: "DECIMAL(10,7) NULL DEFAULT NULL" },
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
    name: 'preposto_cliente',
    sql: `CREATE TABLE IF NOT EXISTS preposto_cliente (
      id INT AUTO_INCREMENT PRIMARY KEY,
      id_preposto INT NOT NULL,
      cod_cliente INT NOT NULL,
      excluido CHAR(1) NOT NULL DEFAULT 'N',
      dtcadastro DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unq_prep_cli (id_preposto, cod_cliente),
      INDEX idx_pc_preposto (id_preposto)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'cliente_fotos',
    sql: `CREATE TABLE IF NOT EXISTS cliente_fotos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      cod_cliente INT NOT NULL,
      descricao VARCHAR(200) DEFAULT NULL,
      tipo_imagem VARCHAR(50) DEFAULT NULL,
      principal CHAR(1) NOT NULL DEFAULT 'N',
      caminho VARCHAR(500) DEFAULT NULL,
      excluido CHAR(1) NOT NULL DEFAULT 'N',
      dtcadastro DATE DEFAULT NULL,
      INDEX idx_cf_cliente (cod_cliente)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'fornecedor_fotos',
    sql: `CREATE TABLE IF NOT EXISTS fornecedor_fotos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      cod_fornecedor INT NOT NULL,
      descricao VARCHAR(200) DEFAULT NULL,
      tipo_imagem VARCHAR(50) DEFAULT NULL,
      principal CHAR(1) NOT NULL DEFAULT 'N',
      caminho VARCHAR(500) DEFAULT NULL,
      excluido CHAR(1) NOT NULL DEFAULT 'N',
      dtcadastro DATE DEFAULT NULL,
      INDEX idx_ff_fornecedor (cod_fornecedor)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'fornecedor_vendedor',
    sql: `CREATE TABLE IF NOT EXISTS fornecedor_vendedor (
      id INT AUTO_INCREMENT PRIMARY KEY,
      cod_fornecedor INT NOT NULL,
      cod_vendedor INT NOT NULL,
      comissao DECIMAL(10,4) DEFAULT NULL,
      excluido CHAR(1) NOT NULL DEFAULT 'N',
      INDEX idx_fv_fornecedor (cod_fornecedor),
      INDEX idx_fv_vendedor (cod_vendedor)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'fornecedor_produtos',
    sql: `CREATE TABLE IF NOT EXISTS fornecedor_produtos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      cod_fornecedor INT NOT NULL,
      cod_produto INT NOT NULL,
      unidade VARCHAR(10) DEFAULT NULL,
      embalagem VARCHAR(50) DEFAULT NULL,
      excluido CHAR(1) NOT NULL DEFAULT 'N',
      INDEX idx_fp_fornecedor (cod_fornecedor),
      INDEX idx_fp_produto (cod_produto)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'produto_imagens',
    sql: `CREATE TABLE IF NOT EXISTS produto_imagens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      cod_produto INT NOT NULL,
      filename VARCHAR(255) NOT NULL,
      is_principal TINYINT(1) NOT NULL DEFAULT 0,
      ordem TINYINT NOT NULL DEFAULT 0,
      dt_upload DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_prod (cod_produto)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'pagtocomissao',
    sql: `CREATE TABLE IF NOT EXISTS pagtocomissao (
      id INT AUTO_INCREMENT PRIMARY KEY,
      data_lancamento DATE NULL DEFAULT NULL,
      data_movimento DATE NULL DEFAULT NULL,
      data_pagar DATE NULL DEFAULT NULL,
      data_pagamento DATE NULL DEFAULT NULL,
      data_confirmacao DATETIME NULL DEFAULT NULL,
      vlr_pago DECIMAL(15,2) NULL DEFAULT 0.00,
      observacao VARCHAR(255) NULL DEFAULT NULL,
      cod_user VARCHAR(15) NULL DEFAULT NULL,
      pedido VARCHAR(15) NULL DEFAULT NULL,
      id_parcela VARCHAR(15) NULL DEFAULT NULL,
      doc VARCHAR(15) NULL DEFAULT NULL,
      cod_banco VARCHAR(15) NULL DEFAULT NULL,
      excluido VARCHAR(1) NOT NULL DEFAULT 'N',
      data_exclusao DATE NULL DEFAULT NULL,
      cod_userexclusao VARCHAR(15) NULL DEFAULT NULL,
      status VARCHAR(1) NOT NULL DEFAULT 'G',
      id_preposto INT NULL DEFAULT NULL,
      vlr_pago_original DECIMAL(15,4) NULL DEFAULT NULL,
      INDEX idx_data_lancamento (data_lancamento),
      INDEX idx_pc_pedido (pedido),
      INDEX idx_tipo_movimentacao (id_parcela)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'visitas',
    sql: `CREATE TABLE IF NOT EXISTS visitas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      controle VARCHAR(10) NULL,
      data_abertura DATE NULL,
      hora_abertura TIME NULL,
      user_abertura VARCHAR(20) NULL,
      id_vendedor VARCHAR(20) NULL,
      id_cliente VARCHAR(20) NULL,
      id_motivo VARCHAR(20) NULL,
      parametro VARCHAR(50) NULL,
      status VARCHAR(20) DEFAULT 'ABERTA',
      tipo VARCHAR(30) NULL,
      origem_atendimento VARCHAR(30) NULL,
      obs TEXT NULL,
      data_finaliza DATE NULL,
      hora_finaliza TIME NULL,
      user_finaliza VARCHAR(20) NULL,
      data_visita DATE NULL,
      hora_visita TIME NULL,
      INDEX idx_vis_cliente (id_cliente),
      INDEX idx_vis_vendedor (id_vendedor),
      INDEX idx_vis_data (data_visita)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'motivo_visitas',
    sql: `CREATE TABLE IF NOT EXISTS motivo_visitas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      descricao VARCHAR(100) NOT NULL,
      status CHAR(1) DEFAULT 'A',
      excluido CHAR(1) DEFAULT 'N',
      dt_cadastro DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'itensped_grade_qtd',
    sql: `CREATE TABLE IF NOT EXISTS itensped_grade_qtd (
      id INT AUTO_INCREMENT PRIMARY KEY,
      id_item_ped INT NOT NULL,
      id_descricao_grade INT NOT NULL,
      sequencial INT NOT NULL,
      nome_grade VARCHAR(25) NOT NULL,
      quantidade DECIMAL(15,2) DEFAULT 0,
      INDEX idx_ipg_item (id_item_ped)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'tabela_preco_cabecalho',
    sql: `CREATE TABLE IF NOT EXISTS tabela_preco_cabecalho (
      id INT AUTO_INCREMENT PRIMARY KEY,
      Descricao VARCHAR(200) NOT NULL,
      Data_Inicial DATE NOT NULL,
      Hora_Inicial TIME NOT NULL,
      Data_Final DATE NOT NULL,
      Hora_Final TIME NOT NULL,
      Cond_Pagamento INT NULL DEFAULT NULL,
      Tabela_Ativa ENUM('S','N') DEFAULT 'S',
      excluido ENUM('S','N') DEFAULT 'N',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      tabela_padrao VARCHAR(1) DEFAULT 'N',
      atualizar_tabelapadrao VARCHAR(1) DEFAULT 'N',
      INDEX idx_tab_excluido (excluido)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'tabela_preco_itens',
    sql: `CREATE TABLE IF NOT EXISTS tabela_preco_itens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      id_tabela INT NOT NULL,
      item INT NOT NULL,
      cod_produto INT NOT NULL,
      descricao VARCHAR(200) NOT NULL,
      cod_fabricante VARCHAR(100) NULL,
      unidade VARCHAR(10) NULL,
      preco_base DECIMAL(15,2) NULL,
      preco_venda DECIMAL(15,2) NOT NULL,
      tipo_desconto ENUM('R','P') DEFAULT 'R',
      vlr_desconto DECIMAL(15,2) DEFAULT 0.00,
      valor_tabela DECIMAL(15,2) NOT NULL,
      ativo ENUM('S','N') DEFAULT 'S',
      vigencia DATE NULL,
      excluido ENUM('S','N') DEFAULT 'N',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_item_tabela_id (id_tabela),
      INDEX idx_item_excluido (excluido),
      INDEX fk_item_produto (cod_produto)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'tabela_preco_vinculo',
    sql: `CREATE TABLE IF NOT EXISTS tabela_preco_vinculo (
      id INT AUTO_INCREMENT PRIMARY KEY,
      id_tabela INT NOT NULL,
      id_entidade INT NOT NULL,
      tipo_entidade ENUM('CLIENTE','FORNECEDOR','VENDEDOR') NOT NULL,
      excluido ENUM('S','N') DEFAULT 'N',
      INDEX fk_vinculo_tabela (id_tabela),
      INDEX idx_entidade (id_entidade, tipo_entidade)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'tabela_precos',
    sql: `CREATE TABLE IF NOT EXISTS tabela_precos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      descricao VARCHAR(100) NOT NULL,
      codigo_interno VARCHAR(20) NULL,
      sequencia VARCHAR(50) NULL,
      id_empresa INT NULL,
      excluido CHAR(1) NOT NULL DEFAULT 'N',
      dtcadastro DATETIME DEFAULT CURRENT_TIMESTAMP,
      dtalterado DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_excluido (excluido)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'tabela_precos_regras',
    sql: `CREATE TABLE IF NOT EXISTS tabela_precos_regras (
      id INT AUTO_INCREMENT PRIMARY KEY,
      id_tabela INT NOT NULL,
      nome_regra VARCHAR(100) NULL,
      tipo VARCHAR(50) NULL,
      descontode DECIMAL(10,2) DEFAULT 0.00,
      descontoate DECIMAL(10,2) DEFAULT 0.00,
      desconto_unico DECIMAL(10,2) DEFAULT 0.00,
      comissao DECIMAL(10,2) DEFAULT 0.00,
      cod_produto VARCHAR(20) NULL,
      valor_venda DECIMAL(15,2) DEFAULT 0.00,
      ativa CHAR(1) DEFAULT 'S',
      excluido CHAR(1) NOT NULL DEFAULT 'N',
      INDEX idx_tabela (id_tabela)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
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
    name: 'fornecedor_kit_itens',
    sql: `CREATE TABLE IF NOT EXISTS fornecedor_kit_itens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      id_fornecedor INT NOT NULL,
      cod_produto INT NOT NULL,
      quantidade DECIMAL(15,4) NOT NULL DEFAULT 1,
      sequencial INT NOT NULL DEFAULT 0,
      excluido CHAR(1) NOT NULL DEFAULT 'N',
      dtcadastro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_fki_fornecedor (id_fornecedor),
      INDEX idx_fki_produto (cod_produto)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'produto_promocoes',
    sql: `CREATE TABLE IF NOT EXISTS produto_promocoes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      cod_produto INT NOT NULL,
      descricao VARCHAR(200) NOT NULL,
      tipo VARCHAR(20) NOT NULL DEFAULT 'PRECO_FIXO',
      valor DECIMAL(15,4) NOT NULL DEFAULT 0,
      qtd_minima DECIMAL(15,4) NOT NULL DEFAULT 1,
      data_inicio DATE NULL DEFAULT NULL,
      data_fim DATE NULL DEFAULT NULL,
      destaque CHAR(1) NOT NULL DEFAULT 'N',
      ativo CHAR(1) NOT NULL DEFAULT 'S',
      excluido CHAR(1) NOT NULL DEFAULT 'N',
      dtcadastro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      cod_cliente INT NULL DEFAULT NULL,
      id_regiao INT NULL DEFAULT NULL,
      cod_fornecedor INT NULL DEFAULT NULL,
      id_tabela_preco INT NULL DEFAULT NULL,
      tabelas_preco VARCHAR(500) NULL DEFAULT NULL,
      sync_precopromo CHAR(1) NOT NULL DEFAULT 'N',
      id_campanha INT NULL DEFAULT NULL,
      INDEX idx_pp_produto (cod_produto),
      INDEX idx_pp_cliente (cod_cliente),
      INDEX idx_pp_regiao (id_regiao),
      INDEX idx_pp_vigencia (data_inicio, data_fim)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'promocoes_campanha',
    sql: `CREATE TABLE IF NOT EXISTS promocoes_campanha (
      id INT AUTO_INCREMENT PRIMARY KEY,
      descricao VARCHAR(200) NOT NULL,
      tipo VARCHAR(20) NOT NULL DEFAULT 'DESCONTO_PERC',
      valor DECIMAL(15,4) NOT NULL DEFAULT 0,
      qtd_minima DECIMAL(15,4) NOT NULL DEFAULT 1,
      data_inicio DATE NULL DEFAULT NULL,
      data_fim DATE NULL DEFAULT NULL,
      destaque CHAR(1) NOT NULL DEFAULT 'N',
      ativo CHAR(1) NOT NULL DEFAULT 'S',
      excluido CHAR(1) NOT NULL DEFAULT 'N',
      cod_cliente INT NULL DEFAULT NULL,
      id_regiao INT NULL DEFAULT NULL,
      cod_fornecedor INT NULL DEFAULT NULL,
      id_tabela_preco INT NULL DEFAULT NULL,
      tabelas_preco VARCHAR(500) NULL DEFAULT NULL,
      sync_precopromo CHAR(1) NOT NULL DEFAULT 'N',
      prioridade INT NOT NULL DEFAULT 0,
      dtcadastro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_pcamp_vigencia (data_inicio, data_fim),
      INDEX idx_pcamp_ativo (ativo, excluido)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'promocoes_campanha_escopo',
    sql: `CREATE TABLE IF NOT EXISTS promocoes_campanha_escopo (
      id INT AUTO_INCREMENT PRIMARY KEY,
      id_campanha INT NOT NULL,
      tipo VARCHAR(20) NOT NULL DEFAULT 'PRODUTO',
      ref_id INT NULL DEFAULT NULL,
      ref_valor VARCHAR(120) NULL DEFAULT NULL,
      valor_override DECIMAL(15,4) NULL DEFAULT NULL,
      excluido CHAR(1) NOT NULL DEFAULT 'N',
      dtcadastro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_pces_campanha (id_campanha),
      INDEX idx_pces_tipo (tipo, ref_valor(40))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'produtos_destaque',
    sql: `CREATE TABLE IF NOT EXISTS produtos_destaque (
      id INT AUTO_INCREMENT PRIMARY KEY,
      cod_produto INT NOT NULL,
      cod_fornecedor INT NULL DEFAULT NULL,
      titulo VARCHAR(200) NULL DEFAULT NULL,
      texto_marketing VARCHAR(500) NULL DEFAULT NULL,
      prioridade INT NOT NULL DEFAULT 0,
      data_inicio DATE NULL DEFAULT NULL,
      data_fim DATE NULL DEFAULT NULL,
      ativo CHAR(1) NOT NULL DEFAULT 'S',
      excluido CHAR(1) NOT NULL DEFAULT 'N',
      dtcadastro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_pd_produto (cod_produto),
      INDEX idx_pd_fornecedor (cod_fornecedor),
      INDEX idx_pd_vigencia (data_inicio, data_fim),
      INDEX idx_pd_ativo (ativo, excluido)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'campanhas_feirinha',
    sql: `CREATE TABLE IF NOT EXISTS campanhas_feirinha (
      id INT AUTO_INCREMENT PRIMARY KEY,
      descricao VARCHAR(200) NOT NULL,
      cod_fornecedor INT NOT NULL,
      faixa_codigo VARCHAR(20) NOT NULL DEFAULT 'R10',
      preco_revenda_alvo DECIMAL(15,2) NULL DEFAULT NULL,
      preco_medio_meta DECIMAL(15,4) NULL DEFAULT NULL,
      data_inicio DATE NULL DEFAULT NULL,
      data_fim DATE NULL DEFAULT NULL,
      ativo CHAR(1) NOT NULL DEFAULT 'S',
      excluido CHAR(1) NOT NULL DEFAULT 'N',
      observacoes TEXT NULL,
      dtcadastro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_cf_forn (cod_fornecedor),
      INDEX idx_cf_vigencia (data_inicio, data_fim),
      INDEX idx_cf_ativo (ativo, excluido)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'campanhas_feirinha_itens',
    sql: `CREATE TABLE IF NOT EXISTS campanhas_feirinha_itens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      id_campanha INT NOT NULL,
      cod_produto INT NOT NULL,
      quantidade DECIMAL(15,4) NOT NULL DEFAULT 1,
      ordem INT NOT NULL DEFAULT 0,
      excluido CHAR(1) NOT NULL DEFAULT 'N',
      INDEX idx_cfi_camp (id_campanha),
      INDEX idx_cfi_prod (cod_produto)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'feirinha_share_tokens',
    sql: `CREATE TABLE IF NOT EXISTS feirinha_share_tokens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      token VARCHAR(64) NOT NULL UNIQUE,
      id_campanha INT NOT NULL,
      id_cliente INT NULL,
      id_usuario INT NOT NULL,
      nome_usuario VARCHAR(255) NULL,
      nome_campanha VARCHAR(255) NULL,
      nome_cliente VARCHAR(255) NULL,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      expira_em TIMESTAMP NULL,
      ativo TINYINT(1) DEFAULT 1,
      INDEX idx_fst_token (token),
      INDEX idx_fst_camp (id_campanha)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'meta_vendas_vendedor',
    sql: `CREATE TABLE IF NOT EXISTS meta_vendas_vendedor (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      id_usuario  INT NOT NULL,
      id_fornecedor INT NOT NULL,
      mes         TINYINT NOT NULL,
      ano         SMALLINT NOT NULL,
      valor_meta  DECIMAL(15,2) NOT NULL DEFAULT 0,
      criado_em   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_meta_vend_fab_mes (id_usuario, id_fornecedor, mes, ano),
      INDEX idx_meta_vend_mes_ano (mes, ano)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'meta_vendas_fornecedor',
    sql: `CREATE TABLE IF NOT EXISTS meta_vendas_fornecedor (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      id_fornecedor INT NOT NULL,
      mes         TINYINT NOT NULL,
      ano         SMALLINT NOT NULL,
      valor_meta  DECIMAL(15,2) NOT NULL DEFAULT 0,
      criado_em   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_meta_fab_mes (id_fornecedor, mes, ano),
      INDEX idx_meta_mes_ano (mes, ano)
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
  {
    name: 'sistema_changelog',
    sql: `CREATE TABLE IF NOT EXISTS sistema_changelog (
      id INT AUTO_INCREMENT PRIMARY KEY,
      versao VARCHAR(20) NOT NULL,
      tipo ENUM('MELHORIA','BUG','NOVO') NOT NULL DEFAULT 'MELHORIA',
      titulo VARCHAR(200) NOT NULL,
      descricao TEXT NULL,
      data_lancamento DATE NOT NULL,
      ativo CHAR(1) NOT NULL DEFAULT 'S',
      dtcadastro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_chg_versao (versao),
      INDEX idx_chg_data (data_lancamento)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  // ── CONTROLE DE ACESSOS ────────────────────────────────────────────────────
  // Resumo por aparelho: 1 linha por (usuário + empresa + dispositivo); o login
  // faz INSERT no 1º acesso e UPDATE (último acesso + contador) nos seguintes.
  {
    name: 'acessos_dispositivos',
    sql: `CREATE TABLE IF NOT EXISTS acessos_dispositivos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      chave_licenca VARCHAR(120) NULL DEFAULT NULL,
      id_empresa INT NOT NULL DEFAULT 0,
      nome_empresa VARCHAR(150) NULL DEFAULT NULL,
      id_usuario INT NOT NULL DEFAULT 0,
      login_usuario VARCHAR(60) NULL DEFAULT NULL,
      nome_usuario VARCHAR(120) NULL DEFAULT NULL,
      device_id VARCHAR(64) NOT NULL,
      device_apelido VARCHAR(120) NULL DEFAULT NULL,
      plataforma VARCHAR(20) NULL DEFAULT NULL,
      sistema_operacional VARCHAR(60) NULL DEFAULT NULL,
      navegador VARCHAR(60) NULL DEFAULT NULL,
      ip VARCHAR(64) NULL DEFAULT NULL,
      user_agent VARCHAR(400) NULL DEFAULT NULL,
      cidade VARCHAR(80) NULL DEFAULT NULL,
      estado VARCHAR(80) NULL DEFAULT NULL,
      pais VARCHAR(60) NULL DEFAULT NULL,
      latitude DECIMAL(10,7) NULL DEFAULT NULL,
      longitude DECIMAL(10,7) NULL DEFAULT NULL,
      qtd_acessos INT NOT NULL DEFAULT 1,
      dt_primeiro_acesso DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      dt_ultimo_acesso DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unq_acesso_dev (id_usuario, id_empresa, device_id),
      INDEX idx_acdev_usuario (id_usuario),
      INDEX idx_acdev_empresa (id_empresa),
      INDEX idx_acdev_ultimo (dt_ultimo_acesso)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  // Histórico completo: 1 linha por login (auditoria de quem entrou, quando, de onde).
  {
    name: 'acessos_log',
    sql: `CREATE TABLE IF NOT EXISTS acessos_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      chave_licenca VARCHAR(120) NULL DEFAULT NULL,
      id_empresa INT NULL DEFAULT NULL,
      nome_empresa VARCHAR(150) NULL DEFAULT NULL,
      id_usuario INT NULL DEFAULT NULL,
      login_usuario VARCHAR(60) NULL DEFAULT NULL,
      nome_usuario VARCHAR(120) NULL DEFAULT NULL,
      device_id VARCHAR(64) NULL DEFAULT NULL,
      device_apelido VARCHAR(120) NULL DEFAULT NULL,
      plataforma VARCHAR(20) NULL DEFAULT NULL,
      sistema_operacional VARCHAR(60) NULL DEFAULT NULL,
      navegador VARCHAR(60) NULL DEFAULT NULL,
      ip VARCHAR(64) NULL DEFAULT NULL,
      user_agent VARCHAR(400) NULL DEFAULT NULL,
      cidade VARCHAR(80) NULL DEFAULT NULL,
      estado VARCHAR(80) NULL DEFAULT NULL,
      pais VARCHAR(60) NULL DEFAULT NULL,
      latitude DECIMAL(10,7) NULL DEFAULT NULL,
      longitude DECIMAL(10,7) NULL DEFAULT NULL,
      dt_acesso DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_aclog_usuario (id_usuario),
      INDEX idx_aclog_empresa (id_empresa),
      INDEX idx_aclog_data (dt_acesso),
      INDEX idx_aclog_device (device_id)
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

    // 2b/2c/3. Checagens independentes (tabelas diferentes) — em paralelo,
    // cada round trip sequencial aqui custava ~1s via túnel SSH em dev local.
    await Promise.all([
      ensureItenspedTipoPrecoWidth(pool),
      ensureTabelaPrecoCondPagamentoNullable(pool),
      ensureVitrineColumns(pool),
      ensureTabelaPrecoItensDecimal(pool),
      ensureItenspedObsitemColumn(pool),
      backfillItenspedObsitemLegado(pool),

      // despesas: copia descricao → nome quando ambas existem (legado Delphi)
      (async () => {
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
      })(),

      // Tabela produto vs produtos — detecta nome e garante colunas novas
      (async () => {
        try {
          const [prodRows] = await pool.query(`SHOW TABLES LIKE 'produto'`);
          const prodTable = prodRows.length ? 'produto' : 'produtos';
          const prodCols = [
            { column: 'multiplo_venda', type: 'INT NOT NULL DEFAULT 1' },
            { column: 'qtd_minima_pedido', type: 'INT NOT NULL DEFAULT 0' },
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
      })(),
    ]);

    // 4. Cria tabelas novas se não existirem (em paralelo — pool aceita múltiplas
    // conexões simultâneas; sequencial aqui custava 1 round trip por tabela, caro
    // em dev local via túnel SSH)
    await Promise.all(CREATE_IF_NOT_EXISTS.map(async (t) => {
      try {
        await pool.query(t.sql);
      } catch (e) {
        console.warn(`[schema] CREATE ${t.name}:`, e.message);
      }
    }));

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

const PROMOCOES_TABLE_NAMES = ['produto_promocoes', 'promocoes_campanha', 'promocoes_campanha_escopo', 'produtos_destaque'];
const FEIRINHA_TABLE_NAMES = ['campanhas_feirinha', 'campanhas_feirinha_itens', 'feirinha_share_tokens'];

/** Cache por base (DATABASE.table.column) — evita SHOW COLUMNS repetido */
const _ensureColCache = new Set();

/**
 * Resolve o nome da base cacheando no próprio objeto pool/conn. Cada pool é
 * fixo por tenant e as conexões nunca trocam de DATABASE() (multi-tenant usa
 * pools separados), então o nome é imutável por objeto — seguro de cachear.
 * Evita 1 `SELECT DATABASE()` por chamada de ensure no caminho quente do save.
 */
async function _resolveDbName(poolOrConn) {
  if (poolOrConn.__sysrepDbName) return poolOrConn.__sysrepDbName;
  let dbName = '';
  try {
    const [[r]] = await poolOrConn.query('SELECT DATABASE() AS db');
    dbName = r?.db || '';
  } catch { /* ignora */ }
  if (dbName) poolOrConn.__sysrepDbName = dbName; // só cacheia sucesso
  return dbName;
}

/**
 * Garante colunas do array MIGRATIONS em runtime (sem reiniciar o servidor).
 * @param {object} poolOrConn — pool ou connection MySQL (ambos têm .query)
 * @param {string} tableName
 * @param {string[]|null} columnNames — se null, todas as colunas da tabela em MIGRATIONS
 */
async function ensureTableColumns(poolOrConn, tableName, columnNames = null) {
  if (!poolOrConn?.query) return false;
  const dbName = await _resolveDbName(poolOrConn);

  const targets = MIGRATIONS.filter((m) => {
    if (m.table !== tableName) return false;
    if (columnNames && !columnNames.includes(m.column)) return false;
    return true;
  });

  // Fast-path: se todos os targets já estão cacheados, evita o SHOW COLUMNS
  if (targets.length === 0 || targets.every(m => _ensureColCache.has(`${dbName}.${m.table}.${m.column}`))) return true;

  // 1 round trip pra pegar TODAS as colunas existentes da tabela, em vez de
  // 1 SHOW COLUMNS por coluna candidata (era o gargalo: ~150 round trips via
  // túnel SSH no boot local, ~55s só nisso).
  let existing = new Set();
  try {
    const [cols] = await poolOrConn.query(`SHOW COLUMNS FROM \`${tableName}\``);
    existing = new Set(cols.map((c) => c.Field));
  } catch (e) {
    console.warn(`[schema] ensure ${tableName}: falha ao listar colunas:`, e.message);
    return false;
  }

  let ok = true;
  for (const m of targets) {
    const cacheKey = `${dbName}.${m.table}.${m.column}`;
    if (_ensureColCache.has(cacheKey)) continue;
    if (existing.has(m.column)) {
      _ensureColCache.add(cacheKey);
      continue;
    }
    try {
      await poolOrConn.query(`ALTER TABLE \`${m.table}\` ADD COLUMN \`${m.column}\` ${m.type}`);
      console.log(`[schema] ensure + ${m.table}.${m.column}`);
      _ensureColCache.add(cacheKey);
    } catch (e) {
      if (String(e.message || '').includes('Duplicate column')) {
        _ensureColCache.add(cacheKey);
      } else {
        console.warn(`[schema] ensure ${m.table}.${m.column}:`, e.message);
        ok = false;
      }
    }
  }
  return ok;
}

/** Colunas de promoção em itensped — chamada antes de INSERT/SELECT que usa id_promocao */
async function ensureItenspedTipoPrecoWidth(poolOrConn) {
  if (!poolOrConn?.query) return;
  try {
    const dbName = await _resolveDbName(poolOrConn);
    const cacheKey = `${dbName}.itensped.tipo_preco.__width_ok__`;
    if (_ensureColCache.has(cacheKey)) return;
    const [info] = await poolOrConn.query(
      `SELECT CHARACTER_MAXIMUM_LENGTH AS len FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'itensped' AND COLUMN_NAME = 'tipo_preco'`
    );
    const len = info[0]?.len;
    if (len != null && len < 30) {
      await poolOrConn.query(
        `ALTER TABLE \`itensped\` MODIFY COLUMN \`tipo_preco\` VARCHAR(30) NOT NULL DEFAULT 'venda'`
      );
      console.log('[schema] widen itensped.tipo_preco -> VARCHAR(30)');
    }
    _ensureColCache.add(cacheKey);
  } catch (e) {
    console.warn('[schema] widen itensped.tipo_preco:', e.message);
  }
}

/** tabela_preco_cabecalho.Cond_Pagamento — legado NOT NULL; FK impede MODIFY silencioso */
async function ensureTabelaPrecoCondPagamentoNullable(poolOrConn) {
  if (!poolOrConn?.query) return;
  try {
    const [tables] = await poolOrConn.query("SHOW TABLES LIKE 'tabela_preco_cabecalho'");
    if (!tables.length) return;

    const [info] = await poolOrConn.query(
      `SELECT IS_NULLABLE AS nullable FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tabela_preco_cabecalho' AND COLUMN_NAME = 'Cond_Pagamento'`
    );
    if (!info.length || info[0].nullable === 'YES') return;

    const [fks] = await poolOrConn.query(
      `SELECT CONSTRAINT_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tabela_preco_cabecalho'
         AND COLUMN_NAME = 'Cond_Pagamento' AND REFERENCED_TABLE_NAME IS NOT NULL`
    );

    for (const fk of fks) {
      await poolOrConn.query(
        `ALTER TABLE \`tabela_preco_cabecalho\` DROP FOREIGN KEY \`${fk.CONSTRAINT_NAME}\``
      );
    }

    await poolOrConn.query(
      `ALTER TABLE \`tabela_preco_cabecalho\` MODIFY COLUMN \`Cond_Pagamento\` INT NULL DEFAULT NULL`
    );

    for (const fk of fks) {
      const refTable = fk.REFERENCED_TABLE_NAME || 'forma_pagto';
      const refCol = fk.REFERENCED_COLUMN_NAME || 'id';
      await poolOrConn.query(
        `ALTER TABLE \`tabela_preco_cabecalho\` ADD CONSTRAINT \`${fk.CONSTRAINT_NAME}\`
         FOREIGN KEY (\`Cond_Pagamento\`) REFERENCES \`${refTable}\` (\`${refCol}\`)`
      ).catch(() => {});
    }

    console.log('[schema] tabela_preco_cabecalho.Cond_Pagamento -> NULL');
  } catch (e) {
    console.warn('[schema] ensureTabelaPrecoCondPagamentoNullable:', e.message);
  }
}

/**
 * tabela_preco_cabecalho — flags da Vitrine Digital:
 *  - vitrine: tabela pode ser enviada/exibida na vitrine (default 'N')
 *  - usar_regras_fornecedor: aplica mínimo de faturamento e mínimo da condição
 *    de pagamento do fornecedor no pedido da vitrine (default 'N')
 * Sem backfill: cada tabela começa 'N' e é liberada manualmente no cadastro.
 * Cacheado por base (DATABASE) — não re-checa schema a cada gravação.
 */
async function ensureVitrineColumns(poolOrConn) {
  if (!poolOrConn?.query) return;
  let dbName = '';
  try {
    const [[r]] = await poolOrConn.query('SELECT DATABASE() AS db');
    dbName = r?.db || '';
  } catch { /* ignora */ }

  const keyV = `${dbName}.tabela_preco_cabecalho.vitrine`;
  const keyU = `${dbName}.tabela_preco_cabecalho.usar_regras_fornecedor`;
  if (_ensureColCache.has(keyV) && _ensureColCache.has(keyU)) return;

  try {
    const [tables] = await poolOrConn.query("SHOW TABLES LIKE 'tabela_preco_cabecalho'");
    if (!tables.length) return;

    const [cols] = await poolOrConn.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tabela_preco_cabecalho'
         AND COLUMN_NAME IN ('vitrine','usar_regras_fornecedor')`
    );
    const have = new Set(cols.map((c) => c.COLUMN_NAME));

    if (!have.has('vitrine')) {
      await poolOrConn.query(
        `ALTER TABLE \`tabela_preco_cabecalho\` ADD COLUMN \`vitrine\` ENUM('S','N') DEFAULT 'N'`
      );
      console.log("[schema] + tabela_preco_cabecalho.vitrine");
    }
    _ensureColCache.add(keyV);

    if (!have.has('usar_regras_fornecedor')) {
      await poolOrConn.query(
        `ALTER TABLE \`tabela_preco_cabecalho\` ADD COLUMN \`usar_regras_fornecedor\` ENUM('S','N') DEFAULT 'N'`
      );
      console.log("[schema] + tabela_preco_cabecalho.usar_regras_fornecedor");
    }
    _ensureColCache.add(keyU);
  } catch (e) {
    console.warn('[schema] ensureVitrineColumns:', e.message);
  }
}

/**
 * tabela_preco_itens — garante que as colunas de preço sejam DECIMAL(15,2).
 * Bases legadas (Delphi/Protheus) podem ter criado preco_base/preco_venda/
 * valor_tabela/vlr_desconto como INT. Nesse caso, em modo SQL STRICT, gravar
 * um preço com casas decimais (ex.: 35,94) FALHA → a importação da tabela de
 * preço só funcionava com valores inteiros. Aqui detectamos o tipo real e
 * convertemos para DECIMAL sem perder dados (INT→DECIMAL é seguro).
 * Cacheado por base (DATABASE) — não re-checa schema a cada importação.
 */
const _TABELA_PRECO_ITENS_DECIMAL_COLS = ['preco_base', 'preco_venda', 'valor_tabela', 'vlr_desconto'];
async function ensureTabelaPrecoItensDecimal(poolOrConn) {
  if (!poolOrConn?.query) return;
  let dbName = '';
  try {
    const [[r]] = await poolOrConn.query('SELECT DATABASE() AS db');
    dbName = r?.db || '';
  } catch { /* ignora */ }

  const cacheKey = `${dbName}.tabela_preco_itens.__decimal__`;
  if (_ensureColCache.has(cacheKey)) return;

  try {
    const [tables] = await poolOrConn.query("SHOW TABLES LIKE 'tabela_preco_itens'");
    if (!tables.length) { _ensureColCache.add(cacheKey); return; }

    const [cols] = await poolOrConn.query(
      `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tabela_preco_itens'
         AND COLUMN_NAME IN (?, ?, ?, ?)`,
      _TABELA_PRECO_ITENS_DECIMAL_COLS
    );

    for (const c of cols) {
      const dt = String(c.DATA_TYPE || '').toLowerCase();
      // Já é fracionário (decimal/numeric/float/double) — nada a fazer.
      if (['decimal', 'numeric', 'float', 'double'].includes(dt)) continue;
      // É inteiro (int/bigint/smallint/...) — converter para DECIMAL(15,2).
      const notNull = String(c.IS_NULLABLE).toUpperCase() === 'NO';
      const nullSql = notNull ? 'NOT NULL' : 'NULL';
      await poolOrConn.query(
        `ALTER TABLE \`tabela_preco_itens\` MODIFY COLUMN \`${c.COLUMN_NAME}\` DECIMAL(15,2) ${nullSql}`
      );
      console.log(`[schema] tabela_preco_itens.${c.COLUMN_NAME} ${dt} -> DECIMAL(15,2)`);
    }
    _ensureColCache.add(cacheKey);
  } catch (e) {
    console.warn('[schema] ensureTabelaPrecoItensDecimal:', e.message);
  }
}

/** Colunas legadas do perfil que podem faltar em bases antigas (fora do array MIGRATIONS). */
const PERFIL_EXTRA_ENSURE = [
  // acesso_financeiro/acessoperfil: estão em PERFIL_SN_CORE (cadastros-permissoes.js),
  // não em PERFIL_SN_CADASTRO — por isso nunca entravam no MIGRATIONS/ensure automático
  // e quebravam o login (SELECT) em bancos novos com "Unknown column".
  ['acesso_financeiro', "CHAR(1) NOT NULL DEFAULT 'S'"],
  ['acessoperfil',      "CHAR(1) NOT NULL DEFAULT 'S'"],
  ['acessar_vendastodos', "CHAR(1) NOT NULL DEFAULT 'S'"],
  ['incluir_formas_pagamento', "CHAR(1) NOT NULL DEFAULT 'N'"],
  ['alterar_formas_pagamento', "CHAR(1) NOT NULL DEFAULT 'N'"],
  ['excluir_formas_pagamento', "CHAR(1) NOT NULL DEFAULT 'N'"],
  ['incluir_bancos', "CHAR(1) NOT NULL DEFAULT 'N'"],
  ['alterar_bancos', "CHAR(1) NOT NULL DEFAULT 'N'"],
  ['excluir_bancos', "CHAR(1) NOT NULL DEFAULT 'N'"],
  ['incluir_despesas', "CHAR(1) NOT NULL DEFAULT 'N'"],
  ['alterar_despesas', "CHAR(1) NOT NULL DEFAULT 'N'"],
  ['excluir_despesas', "CHAR(1) NOT NULL DEFAULT 'N'"],
  ['incluir_segmentos', "CHAR(1) NOT NULL DEFAULT 'N'"],
  ['alterar_segmentos', "CHAR(1) NOT NULL DEFAULT 'N'"],
  ['excluir_segmentos', "CHAR(1) NOT NULL DEFAULT 'N'"],
  ['incluir_regioes', "CHAR(1) NOT NULL DEFAULT 'N'"],
  ['alterar_regioes', "CHAR(1) NOT NULL DEFAULT 'N'"],
  ['excluir_regioes', "CHAR(1) NOT NULL DEFAULT 'N'"],
  ['incluir_natureza', "CHAR(1) NOT NULL DEFAULT 'N'"],
  ['alterar_natureza', "CHAR(1) NOT NULL DEFAULT 'N'"],
  ['excluir_natureza', "CHAR(1) NOT NULL DEFAULT 'N'"],
  ['incluir_tipo_frete', "CHAR(1) NOT NULL DEFAULT 'N'"],
  ['alterar_tipo_frete', "CHAR(1) NOT NULL DEFAULT 'N'"],
  ['excluir_tipo_frete', "CHAR(1) NOT NULL DEFAULT 'N'"],
  ['incluir_locais_armazenamento', "CHAR(1) NOT NULL DEFAULT 'N'"],
  ['alterar_locais_armazenamento', "CHAR(1) NOT NULL DEFAULT 'N'"],
  ['excluir_locais_armazenamento', "CHAR(1) NOT NULL DEFAULT 'N'"],
  ['incluir_motivo_visitas', "CHAR(1) NOT NULL DEFAULT 'N'"],
  ['alterar_motivo_visitas', "CHAR(1) NOT NULL DEFAULT 'N'"],
  ['excluir_motivo_visitas', "CHAR(1) NOT NULL DEFAULT 'N'"],
  ['incluir_hoteis', "CHAR(1) NOT NULL DEFAULT 'N'"],
  ['alterar_hoteis', "CHAR(1) NOT NULL DEFAULT 'N'"],
  ['excluir_hoteis', "CHAR(1) NOT NULL DEFAULT 'N'"],
  ['incluir_promocoes', "CHAR(1) NOT NULL DEFAULT 'S'"],
  ['alterar_promocoes', "CHAR(1) NOT NULL DEFAULT 'S'"],
  ['excluir_promocoes', "CHAR(1) NOT NULL DEFAULT 'S'"],
  ['prorrogar_promocoes', "CHAR(1) NOT NULL DEFAULT 'S'"],
  ['manutencao_promocoes', "CHAR(1) NOT NULL DEFAULT 'S'"],
  ['p_alterarcomissao', "CHAR(1) NOT NULL DEFAULT 'S'"],
  ['alterar_emb', "CHAR(1) NOT NULL DEFAULT 'S'"],
  ['alterardatapedido', "CHAR(1) NOT NULL DEFAULT 'S'"],
  ['trocarvendedorpedido', "CHAR(1) NOT NULL DEFAULT 'S'"],
  ['alteraprecovenda', "CHAR(1) NOT NULL DEFAULT 'S'"],
  ['acessar_cadastros', "CHAR(1) NOT NULL DEFAULT 'S'"],
  ['tela_clientes', "CHAR(1) NOT NULL DEFAULT 'S'"],
  ['tela_fornecedores', "CHAR(1) NOT NULL DEFAULT 'S'"],
  ['tela_produtos', "CHAR(1) NOT NULL DEFAULT 'S'"],
];

/** Garante colunas S/N de cadastros no perfil (runtime, sem reiniciar o servidor). */
async function ensurePerfilCadastroColumns(pool) {
  if (!pool?.query) return false;
  const { PERFIL_SN_CADASTRO } = require('./cadastros-permissoes');
  await ensureTableColumns(pool, 'perfil', PERFIL_SN_CADASTRO);

  let dbName = '';
  try {
    const [[r]] = await pool.query('SELECT DATABASE() AS db');
    dbName = r?.db || '';
  } catch { /* ignora */ }

  // 1 round trip pra todas as colunas existentes, em vez de 1 SHOW COLUMNS por item.
  let existing = new Set();
  try {
    const [cols] = await pool.query('SHOW COLUMNS FROM `perfil`');
    existing = new Set(cols.map((c) => c.Field));
  } catch (e) {
    console.warn('[schema] ensure perfil (extra): falha ao listar colunas:', e.message);
    return true;
  }

  for (const [column, type] of PERFIL_EXTRA_ENSURE) {
    const cacheKey = `${dbName}.perfil.${column}`;
    if (_ensureColCache.has(cacheKey)) continue;
    if (existing.has(column)) {
      _ensureColCache.add(cacheKey);
      continue;
    }
    try {
      await pool.query(`ALTER TABLE \`perfil\` ADD COLUMN \`${column}\` ${type}`);
      console.log(`[schema] ensure + perfil.${column}`);
      _ensureColCache.add(cacheKey);
    } catch (e) {
      if (String(e.message || '').includes('Duplicate column')) {
        _ensureColCache.add(cacheKey);
      } else {
        console.warn(`[schema] ensure perfil.${column}:`, e.message);
      }
    }
  }
  return true;
}

async function ensureItenspedPromoColumns(poolOrConn) {
  const ok = await ensureTableColumns(poolOrConn, 'itensped', ['tipo_preco', 'id_promocao', 'promocao_descricao']);
  await ensureItenspedTipoPrecoWidth(poolOrConn);
  return ok;
}

/** Garante coluna obsitem (VARCHAR 100) — campo oficial da obs. por item no pedido. */
async function ensureItenspedObsitemColumn(poolOrConn) {
  return ensureTableColumns(poolOrConn, 'itensped', ['obsitem']);
}

/** Retorno agendado em pedido/orçamento (data_retorno + obs_retorno). */
async function ensurePedidoRetornoColumns(poolOrConn) {
  return ensureTableColumns(poolOrConn, 'pedidos', ['data_retorno', 'obs_retorno']);
}

/** Obs. para o próximo pedido (mesmo cliente + fábrica). */
async function ensurePedidoObsProximoColumns(poolOrConn) {
  return ensureTableColumns(poolOrConn, 'pedidos', ['obs_proximo_pedido', 'obs_proximo_consumido']);
}

/** Copia obsitemitenspedido → obsitem só onde obsitem ainda é NULL (bases Delphi legadas). */
async function backfillItenspedObsitemLegado(poolOrConn) {
  if (!poolOrConn?.query) return;
  try {
    const [cols] = await poolOrConn.query('SHOW COLUMNS FROM itensped');
    const colSet = new Set(cols.map((c) => c.Field));
    if (!colSet.has('obsitem') || !colSet.has('obsitemitenspedido')) return;
    const [r] = await poolOrConn.query(
      `UPDATE itensped
       SET obsitem = LEFT(TRIM(obsitemitenspedido), 100)
       WHERE obsitem IS NULL
         AND obsitemitenspedido IS NOT NULL
         AND TRIM(obsitemitenspedido) <> ''
         AND COALESCE(excluido, 'N') = 'N'`
    );
    if (r?.affectedRows > 0) {
      console.log(`[schema] backfill itensped.obsitem ← obsitemitenspedido (${r.affectedRows} linha(s))`);
    }
  } catch (e) {
    console.warn('[schema] backfillItenspedObsitemLegado:', e.message);
  }
}

async function ensurePromocoesCampanhaTables(pool) {
  if (!pool) return false;
  try {
    for (const t of CREATE_IF_NOT_EXISTS) {
      if (!PROMOCOES_TABLE_NAMES.includes(t.name)) continue;
      try {
        await pool.query(t.sql);
      } catch (e) {
        console.warn(`[schema] ensure ${t.name}:`, e.message);
      }
    }
    for (const m of MIGRATIONS) {
      if (!PROMOCOES_TABLE_NAMES.includes(m.table)) continue;
      try {
        const [cols] = await pool.query(`SHOW COLUMNS FROM \`${m.table}\` LIKE ?`, [m.column]);
        if (cols.length) continue;
        await pool.query(`ALTER TABLE \`${m.table}\` ADD COLUMN \`${m.column}\` ${m.type}`);
        console.log(`[schema] ensure + ${m.table}.${m.column}`);
      } catch (e) {
        if (!e.message?.includes('Duplicate column')) {
          console.warn(`[schema] ensure ${m.table}.${m.column}:`, e.message);
        }
      }
    }
    const [rows] = await pool.query("SHOW TABLES LIKE 'promocoes_campanha'");
    return rows.length > 0;
  } catch (e) {
    console.warn('[schema] ensurePromocoesCampanhaTables:', e.message);
    return false;
  }
}

async function ensureFeirinhaTables(pool) {
  if (!pool) return false;
  try {
    for (const t of CREATE_IF_NOT_EXISTS) {
      if (!FEIRINHA_TABLE_NAMES.includes(t.name)) continue;
      try {
        await pool.query(t.sql);
      } catch (e) {
        console.warn(`[schema] ensure ${t.name}:`, e.message);
      }
    }
    const feirinhaCols = MIGRATIONS.filter((m) =>
      (m.table === 'pedidos' && ['id_campanha_feirinha', 'preco_medio_feirinha', 'preco_revenda_feirinha'].includes(m.column))
      || (m.table === 'campanhas_feirinha' && m.column === 'tema_banner')
    );
    for (const m of feirinhaCols) {
      try {
        const [cols] = await pool.query(`SHOW COLUMNS FROM \`${m.table}\` LIKE ?`, [m.column]);
        if (cols.length) continue;
        await pool.query(`ALTER TABLE \`${m.table}\` ADD COLUMN \`${m.column}\` ${m.type}`);
        console.log(`[schema] ensure + ${m.table}.${m.column}`);
      } catch (e) {
        if (!e.message?.includes('Duplicate column')) {
          console.warn(`[schema] ensure ${m.table}.${m.column}:`, e.message);
        }
      }
    }
    const [rows] = await pool.query("SHOW TABLES LIKE 'campanhas_feirinha'");
    return rows.length > 0;
  } catch (e) {
    console.warn('[schema] ensureFeirinhaTables:', e.message);
    return false;
  }
}

module.exports = { runMigrations, ensurePromocoesCampanhaTables, ensureFeirinhaTables, ensureTableColumns, ensurePerfilCadastroColumns, ensureItenspedPromoColumns, ensureItenspedObsitemColumn, ensurePedidoRetornoColumns, ensurePedidoObsProximoColumns, backfillItenspedObsitemLegado, ensureItenspedTipoPrecoWidth, ensureTabelaPrecoCondPagamentoNullable, ensureVitrineColumns, ensureTabelaPrecoItensDecimal };
