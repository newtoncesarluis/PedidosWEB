/**
 * Permissões S/N de cadastros no perfil — telas (tela_*) e CRUD auxiliar.
 * JWT expõe telas como gtela_* (ex.: tela_clientes → gtela_clientes).
 */

const TELA_DEFAULT = 'S';
const CRUD_DEFAULT = 'N';

/** Telas principais / complementares com coluna tela_* no perfil */
const CADASTROS_TELAS = [
  { col: 'tela_clientes', jwt: 'gtela_clientes', page: '/pages/clientes.html', label: 'Clientes',
    crud: [{ col: 'incluir_clientes', jwt: 'incluir_clientes' }, { col: 'alterar_clientes', jwt: 'alterar_clientes' }, { col: 'exclui_clientes', jwt: 'excluir_clientes' }] },
  { col: 'tela_transportadoras', jwt: 'gtela_transportadoras', page: '/pages/transportadoras.html', label: 'Transportadoras',
    crud: [{ col: 'transportadora_incluir', jwt: 'transportadora_incluir' }, { col: 'transportadora_alterar', jwt: 'transportadora_alterar' }, { col: 'transportadora_excluir', jwt: 'transportadora_excluir' }] },
  { col: 'tela_promocoes', jwt: 'gtela_promocoes', page: '/pages/comercial-promocoes.html', label: 'Promoções de Produtos',
    crud: [{ col: 'incluir_promocoes', jwt: 'incluir_promocoes' }, { col: 'alterar_promocoes', jwt: 'alterar_promocoes' }, { col: 'excluir_promocoes', jwt: 'excluir_promocoes' }],
    extra: ['prorrogar_promocoes', 'manutencao_promocoes'] },
  { col: 'tela_feirinha', jwt: 'gtela_feirinha', page: '/pages/comercial-feirinha.html', label: 'Campanhas Feirinha' },
  { col: 'tela_familia_produtos', jwt: 'gtela_familia_produtos', page: '/pages/familia-produtos.html', label: 'Família de Produtos',
    crud: [{ col: 'incluir_familia_produtos', jwt: 'incluir_familia_produtos' }, { col: 'alterar_familia_produtos', jwt: 'alterar_familia_produtos' }, { col: 'excluir_familia_produtos', jwt: 'excluir_familia_produtos' }] },
  { col: 'tela_grades', jwt: 'gtela_grades', page: '/pages/grades.html', label: 'Grades',
    crud: [{ col: 'incluir_grades', jwt: 'incluir_grades' }, { col: 'alterar_grades', jwt: 'alterar_grades' }, { col: 'excluir_grades', jwt: 'excluir_grades' }] },
  { col: 'tela_cores', jwt: 'gtela_cores', page: '/pages/cores.html', label: 'Cores',
    crud: [{ col: 'incluir_cores', jwt: 'incluir_cores' }, { col: 'alterar_cores', jwt: 'alterar_cores' }, { col: 'excluir_cores', jwt: 'excluir_cores' }] },
  { col: 'tela_tabela_precos', jwt: 'gtela_tabela_precos', page: '/pages/tabela-precos.html', label: 'Tabela de Preços',
    crud: [{ col: 'incluir_tabela_precos', jwt: 'incluir_tabela_precos' }, { col: 'alterar_tabela_precos', jwt: 'alterar_tabela_precos' }, { col: 'excluir_tabela_precos', jwt: 'excluir_tabela_precos' }] },
  { col: 'tela_importacao_precos', jwt: 'gtela_importacao_precos', page: '/pages/importacao-precos.html', label: 'Importação de Preços' },
  { col: 'tela_formas_pagamento', jwt: 'gtela_formas_pagamento', page: '/pages/formas-pagamento.html', label: 'Formas de Pagamento',
    crud: [{ col: 'incluir_formas_pagamento', jwt: 'incluir_formas_pagamento' }, { col: 'alterar_formas_pagamento', jwt: 'alterar_formas_pagamento' }, { col: 'excluir_formas_pagamento', jwt: 'excluir_formas_pagamento' }] },
  { col: 'tela_bancos', jwt: 'gtela_bancos', page: '/pages/bancos.html', label: 'Bancos',
    crud: [{ col: 'incluir_bancos', jwt: 'incluir_bancos' }, { col: 'alterar_bancos', jwt: 'alterar_bancos' }, { col: 'excluir_bancos', jwt: 'excluir_bancos' }] },
  { col: 'tela_despesas', jwt: 'gtela_despesas', page: '/pages/despesas.html', label: 'Despesas',
    crud: [{ col: 'incluir_despesas', jwt: 'incluir_despesas' }, { col: 'alterar_despesas', jwt: 'alterar_despesas' }, { col: 'excluir_despesas', jwt: 'excluir_despesas' }] },
  { col: 'tela_segmentos', jwt: 'gtela_segmentos', page: '/pages/segmentos.html', label: 'Segmento',
    crud: [{ col: 'incluir_segmentos', jwt: 'incluir_segmentos' }, { col: 'alterar_segmentos', jwt: 'alterar_segmentos' }, { col: 'excluir_segmentos', jwt: 'excluir_segmentos' }] },
  { col: 'tela_regiao_rota', jwt: 'gtela_regiao_rota', page: '/pages/regiao-rota.html', label: 'Regiões e Rotas',
    crud: [{ col: 'incluir_regioes', jwt: 'incluir_regioes' }, { col: 'alterar_regioes', jwt: 'alterar_regioes' }, { col: 'excluir_regioes', jwt: 'excluir_regioes' }] },
  { col: 'tela_eventos_cidades', jwt: 'gtela_eventos_cidades', page: '/pages/eventos-cidades.html', label: 'Eventos / Cidades',
    crud: [{ col: 'incluir_eventos_cidades', jwt: 'incluir_eventos_cidades' }, { col: 'alterar_eventos_cidades', jwt: 'alterar_eventos_cidades' }, { col: 'excluir_eventos_cidades', jwt: 'excluir_eventos_cidades' }] },
  { col: 'tela_importacao_clientes', jwt: 'gtela_importacao_clientes', page: '/pages/importacao-clientes.html', label: 'Importação de Clientes' },
  { col: 'tela_importacao_fornecedores', jwt: 'gtela_importacao_fornecedores', page: '/pages/importacao-fornecedores.html', label: 'Importação de Fornecedores' },
  { col: 'tela_campos_importacao', jwt: 'gtela_campos_importacao', page: '/pages/campos-importacao.html', label: 'Configurar Campos de Importação' },
  { col: 'tela_tipo_pedidos', jwt: 'gtela_tipo_pedidos', page: '/pages/tipo-pedidos.html', label: 'Tipos de Pedido',
    crud: [{ col: 'incluir_tipo_pedidos', jwt: 'incluir_tipo_pedidos' }, { col: 'alterar_tipo_pedidos', jwt: 'alterar_tipo_pedidos' }, { col: 'excluir_tipo_pedidos', jwt: 'excluir_tipo_pedidos' }] },
  { col: 'tela_estoque', jwt: 'gtela_estoque', page: '/pages/estoque.html', label: 'Gestão de Estoque',
    crud: [{ col: 'incluir_estoque', jwt: 'incluir_estoque' }, { col: 'alterar_estoque', jwt: 'alterar_estoque' }, { col: 'excluir_estoque', jwt: 'excluir_estoque' }] },
  { col: 'tela_prepostos', jwt: 'gtela_prepostos', page: '/pages/prepostos.html', label: 'Prepostos',
    crud: [{ col: 'incluir_prepostos', jwt: 'incluir_prepostos' }, { col: 'alterar_prepostos', jwt: 'alterar_prepostos' }, { col: 'excluir_prepostos', jwt: 'excluir_prepostos' }] },
  { col: 'tela_crm_pipeline', jwt: 'gtela_crm_pipeline', page: '/pages/crm-pipeline.html', label: 'CRM Pipeline (Kanban)',
    crud: [{ col: 'incluir_negocio_crm', jwt: 'incluir_negocio_crm' }, { col: 'alterar_negocio_crm', jwt: 'alterar_negocio_crm' }, { col: 'excluir_negocio_crm', jwt: 'excluir_negocio_crm' }],
    extra: [
      'incluir_tarefa_crm', 'alterar_tarefa_crm', 'excluir_tarefa_crm',
      'incluir_motivo_perda_crm', 'alterar_motivo_perda_crm', 'excluir_motivo_perda_crm',
      'mover_etapa_crm',
    ] },
  { col: 'tela_crm_config', jwt: 'gtela_crm_config', page: '/pages/crm-pipeline-admin.html', label: 'CRM Pipeline (Configuração)',
    crud: [{ col: 'incluir_pipeline_crm', jwt: 'incluir_pipeline_crm' }, { col: 'alterar_pipeline_crm', jwt: 'alterar_pipeline_crm' }, { col: 'excluir_pipeline_crm', jwt: 'excluir_pipeline_crm' }],
    extra: ['alterar_vendedores_pipeline_crm'] },
  { col: 'tela_crm_dashboard', jwt: 'gtela_crm_dashboard', page: '/pages/crm-pipeline-dashboard.html', label: 'CRM Pipeline (Dashboard)' },
];

/**
 * Telas de Relatórios Padrão e Dashboards/IA (módulo Comercial).
 * Mesmo mecanismo das telas de cadastro: coluna tela_* no perfil → gtela_* no JWT.
 * `report` = id no catálogo de /api/analytics/comercial/relatorios-padrao (páginas que
 * compartilham comercial-relatorios-padrao.html; sem `page` para não colidir no PAGE_GTELA).
 * Default 'S' (prefixo tela_) — bases existentes não perdem acesso na migration.
 */
const COMERCIAL_TELAS = [
  // Relatórios Padrão
  { col: 'tela_rel_padrao', jwt: 'gtela_rel_padrao', page: '/pages/comercial-relatorios-padrao.html', label: 'Central de Relatórios Padrão' },
  { col: 'tela_rel_vendas_fabrica_ano', jwt: 'gtela_rel_vendas_fabrica_ano', report: 'vendas_fornecedor_ano', label: 'Vendas por Fábrica (Ano)' },
  { col: 'tela_rel_vendas_produto_ano', jwt: 'gtela_rel_vendas_produto_ano', report: 'vendas_produtos_ano', label: 'Vendas por Produto (Ano)' },
  { col: 'tela_rel_vendas_cliente_ano', jwt: 'gtela_rel_vendas_cliente_ano', report: 'vendas_clientes_ano', label: 'Vendas por Cliente (Ano)' },
  { col: 'tela_rel_vendas_vendedor_ano', jwt: 'gtela_rel_vendas_vendedor_ano', report: 'vendas_vendedor_ano', label: 'Vendas por Vendedor (Ano)' },
  { col: 'tela_rel_pedidos_situacao', jwt: 'gtela_rel_pedidos_situacao', report: 'pedidos_por_situacao', label: 'Pedidos por Situação' },
  { col: 'tela_rel_top_clientes', jwt: 'gtela_rel_top_clientes', report: 'top_clientes_periodo', label: 'Top Clientes do Período' },
  { col: 'tela_rel_produtos_cliente', jwt: 'gtela_rel_produtos_cliente', report: 'produtos_por_cliente', label: 'Produtos Vendidos por Cliente' },
  { col: 'tela_rel_produtos_vendedor', jwt: 'gtela_rel_produtos_vendedor', report: 'produtos_por_vendedor', label: 'Produtos Vendidos por Vendedor' },
  { col: 'tela_rel_produtos_fabrica', jwt: 'gtela_rel_produtos_fabrica', report: 'produtos_por_fornecedor', label: 'Produtos Vendidos por Fábrica' },
  { col: 'tela_rel_peso', jwt: 'gtela_rel_peso', page: '/pages/relatorio-peso.html', label: 'Peso por Vendedor / Rota' },
  // Dashboards / Apoio da IA
  { col: 'tela_dash_performance_rep', jwt: 'gtela_dash_performance_rep', page: '/pages/performance-representantes.html', label: 'Performance de Representantes' },
  { col: 'tela_dash_painel_exec', jwt: 'gtela_dash_painel_exec', page: '/pages/comercial-dashboards.html', label: 'Painel Executivo de Pedidos' },
  { col: 'tela_dash_clientes_carteira', jwt: 'gtela_dash_clientes_carteira', page: '/pages/comercial-clientes-ia.html', label: 'Clientes / Carteira / Recompra' },
  { col: 'tela_dash_financeiro', jwt: 'gtela_dash_financeiro', page: '/pages/comercial-financeiro-ia.html', label: 'Financeiro dos Pedidos' },
  { col: 'tela_dash_produtos_mix', jwt: 'gtela_dash_produtos_mix', page: '/pages/comercial-produtos-ia.html', label: 'Produtos / Mix / Curva ABC' },
  { col: 'tela_dash_visitas', jwt: 'gtela_dash_visitas', page: '/pages/comercial-visitas-ia.html', label: 'Visitas / Conversão / Relacionamento' },
  { col: 'tela_dash_fabricas', jwt: 'gtela_dash_fabricas', page: '/pages/comercial-fabricas-ia.html', label: 'Fábricas / Dependência Comercial' },
  { col: 'tela_dash_clientes_inativos', jwt: 'gtela_dash_clientes_inativos', page: '/pages/comercial-clientes-inativos.html', label: 'Clientes Inativos / Mapa / Rota' },
  { col: 'tela_dash_inteligencia', jwt: 'gtela_dash_inteligencia', page: '/pages/inteligencia-comercial.html', label: 'Inteligência Comercial por Cliente' },
  { col: 'tela_dash_panico', jwt: 'gtela_dash_panico', page: '/pages/panico-vendedor.html', label: 'Pânico do Vendedor — Heatmap' },
  { col: 'tela_dash_gamificacao', jwt: 'gtela_dash_gamificacao', page: '/pages/gamificacao.html', label: 'Gamificação — Ranking & Metas' },
];

/** Todas as telas com coluna tela_* no perfil (cadastros + comercial) */
const ALL_TELAS = [...CADASTROS_TELAS, ...COMERCIAL_TELAS];

/** Campos S/N já existentes no POST de perfil (fora das telas acima) */
const PERFIL_SN_CORE = [
  'incluir_pedvendas', 'alterar_pedvendas', 'excluir_pedvendas',
  'tela_fornecedores', 'incluir_fornecedor', 'alterar_fornecedor', 'excluir_fornecedor',
  'tela_produtos', 'incluir_produtos', 'alterar_produtos', 'excluir_produtos',
  'incluir_regioes', 'alterar_regioes', 'excluir_regioes',
  'incluir_natureza', 'alterar_natureza', 'excluir_natureza',
  'incluir_tipo_frete', 'alterar_tipo_frete', 'excluir_tipo_frete',
  'incluir_locais_armazenamento', 'alterar_locais_armazenamento', 'excluir_locais_armazenamento',
  'incluir_motivo_visitas', 'alterar_motivo_visitas', 'excluir_motivo_visitas',
  'incluir_hoteis', 'alterar_hoteis', 'excluir_hoteis',
  'p_vender', 'p_comprar', 'acessogerenciais', 'manutencaocadastros',
  'acessartodosclientes', 'mudarempresa', 'alterarbase',
  'acesso_financeiro', 'acessoperfil', 'acessar_cadastros',
  'p_alterarcomissao', 'alterar_emb', 'alterardatapedido', 'trocarvendedorpedido', 'alteraprecovenda',
];

function collectCadastroPermCols() {
  const out = [];
  const seen = new Set();
  const add = (col) => {
    if (!col || seen.has(col)) return;
    seen.add(col);
    out.push(col);
  };
  for (const t of ALL_TELAS) {
    add(t.col);
    for (const c of t.crud || []) add(c.col);
    for (const e of t.extra || []) add(e);
  }
  return out;
}

const PERFIL_SN_CADASTRO = collectCadastroPermCols();

/** Ordem completa para INSERT/UPDATE de perfil (sem descricao) */
const PERFIL_SN_FIELDS = [...new Set([...PERFIL_SN_CADASTRO, ...PERFIL_SN_CORE])];

function defaultForPerfilCol(col) {
  if (col.startsWith('tela_')) return TELA_DEFAULT;
  if (['p_alterarcomissao', 'alterar_emb', 'alterardatapedido', 'trocarvendedorpedido', 'alteraprecovenda'].includes(col)) return 'S';
  if (['incluir_promocoes', 'alterar_promocoes', 'excluir_promocoes', 'prorrogar_promocoes', 'manutencao_promocoes'].includes(col)) return 'S';
  if (col === 'p_vender') return 'S';
  return CRUD_DEFAULT;
}

function migrationEntriesForCadastros() {
  const skip = new Set([
    'tela_clientes', 'tela_fornecedores', 'tela_produtos', 'acessar_cadastros',
    'incluir_promocoes', 'alterar_promocoes', 'excluir_promocoes', 'prorrogar_promocoes', 'manutencao_promocoes',
    'incluir_formas_pagamento', 'alterar_formas_pagamento', 'excluir_formas_pagamento',
    'incluir_bancos', 'alterar_bancos', 'excluir_bancos',
    'incluir_despesas', 'alterar_despesas', 'excluir_despesas',
    'incluir_segmentos', 'alterar_segmentos', 'excluir_segmentos',
    'incluir_regioes', 'alterar_regioes', 'excluir_regioes',
  ]);
  const entries = [];
  const seen = new Set();
  for (const col of PERFIL_SN_CADASTRO) {
    if (seen.has(col) || skip.has(col)) continue;
    seen.add(col);
    const def = defaultForPerfilCol(col);
    entries.push({ table: 'perfil', column: col, type: `CHAR(1) NOT NULL DEFAULT '${def}'` });
  }
  return entries;
}

/** path → gtela key (para home / guard de página) */
const PAGE_GTELA = Object.fromEntries(
  ALL_TELAS.filter((t) => t.page).map((t) => [t.page.split('?')[0], t.jwt])
);

/** report id (catálogo relatórios-padrão) → chave gtela_* */
const REPORT_GTELA = Object.fromEntries(
  COMERCIAL_TELAS.filter((t) => t.report).map((t) => [t.report, t.jwt])
);

/** JWT aliases (col DB → chave no objeto permissoes) */
function buildGtelaFromPerfil(user, isAdmin) {
  const out = {};
  for (const t of ALL_TELAS) {
    out[t.jwt] = isAdmin ? 'S' : (user[t.col] || 'N');
    for (const c of t.crud || []) {
      out[c.jwt] = isAdmin ? 'S' : (user[c.col] || 'N');
    }
    for (const e of t.extra || []) {
      out[e] = isAdmin ? 'S' : (user[e] || 'N');
    }
  }
  return out;
}

function isAdminUser(req) {
  return req.user?.perfil == 1 || req.user?.role === 'admin';
}

function permSn(req, key) {
  if (isAdminUser(req)) return 'S';
  return req.user?.permissoes?.[key] || 'N';
}

/** keys: { ver?, incluir, alterar, excluir } — chaves JWT */
function permCrud(req, keys) {
  return {
    isAdmin: isAdminUser(req),
    ver: keys.ver ? permSn(req, keys.ver) : 'S',
    incluir: permSn(req, keys.incluir),
    alterar: permSn(req, keys.alterar),
    excluir: permSn(req, keys.excluir),
  };
}

function negarCad(res, msg) {
  return res.status(403).json({ error: msg || 'Sem permissão' });
}

module.exports = {
  CADASTROS_TELAS,
  COMERCIAL_TELAS,
  ALL_TELAS,
  PERFIL_SN_FIELDS,
  PERFIL_SN_CADASTRO,
  PAGE_GTELA,
  REPORT_GTELA,
  defaultForPerfilCol,
  migrationEntriesForCadastros,
  buildGtelaFromPerfil,
  isAdminUser,
  permSn,
  permCrud,
  negarCad,
};
