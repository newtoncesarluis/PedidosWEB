/**
 * Mescla permissões do perfil quando o usuário usa "Usar as permissões do perfil"
 * (mesma regra de public/pages/usuarios.html — nenhum marcador custom = 'S' no usuário).
 *
 * Colunas duplicadas em usuarios+perfil (migration web default 'N') sobrescreviam o perfil no login.
 */

/** Indica permissões individuais gravadas no usuário (desmarca "usar perfil"). */
const USUARIO_PERM_CUSTOM_MARKERS = [
  'incluir_pedvendas',
  'alterar_pedvendas',
  'excluir_pedvendas',
  'incluir_clientes',
  'alterar_clientes',
  'exclui_clientes',
];

/** Colunas que existem em usuarios e perfil — precisam de alias __p_ no SELECT. */
const USUARIO_PERFIL_OVERLAY_FIELDS = [
  'acessartodosclientes',
  'incluir_pedvendas',
  'alterar_pedvendas',
  'excluir_pedvendas',
  'incluir_clientes',
  'alterar_clientes',
  'exclui_clientes',
  'incluir_fornecedor',
  'alterar_fornecedor',
  'excluir_fornecedor',
  'incluir_produtos',
  'alterar_produtos',
  'excluir_produtos',
  'p_vender',
  'p_comprar',
  'acessogerenciais',
  'manutencaocadastros',
  'mudarempresa',
  'alterarbase',
  'acesso_financeiro',
  'acessoperfil',
  'incluir_formas_pagamento',
  'alterar_formas_pagamento',
  'excluir_formas_pagamento',
  'incluir_bancos',
  'alterar_bancos',
  'excluir_bancos',
  'incluir_despesas',
  'alterar_despesas',
  'excluir_despesas',
  'incluir_segmentos',
  'alterar_segmentos',
  'excluir_segmentos',
  'incluir_regioes',
  'alterar_regioes',
  'excluir_regioes',
  'incluir_natureza',
  'alterar_natureza',
  'excluir_natureza',
];

function usuarioTemPermCustom(user) {
  if (!user) return false;
  return USUARIO_PERM_CUSTOM_MARKERS.some((f) => user[f] === 'S');
}

function sqlPerfilOverlayAliases(perfilAlias = 'p') {
  return USUARIO_PERFIL_OVERLAY_FIELDS.map(
    (f) => `${perfilAlias}.${f} AS __p_${f}`
  ).join(', ');
}

/** Substitui campos do usuário pelos do perfil quando "usar perfil". */
function overlayPerfilPermissoes(user) {
  if (!user || usuarioTemPermCustom(user)) return user;
  const out = { ...user };
  for (const field of USUARIO_PERFIL_OVERLAY_FIELDS) {
    const perfVal = user[`__p_${field}`];
    if (perfVal === 'S' || perfVal === 'N') out[field] = perfVal;
    else if (perfVal != null && String(perfVal).trim() !== '') out[field] = perfVal;
  }
  return out;
}

module.exports = {
  USUARIO_PERM_CUSTOM_MARKERS,
  USUARIO_PERFIL_OVERLAY_FIELDS,
  usuarioTemPermCustom,
  sqlPerfilOverlayAliases,
  overlayPerfilPermissoes,
};
