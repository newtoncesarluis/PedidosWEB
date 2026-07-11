/** Política do modelo de impressão de pedidos (tabela sistemas). */
async function loadModeloImpressaoPolitica(pool) {
  try {
    const [rows] = await pool.query(`
      SELECT modelo_impress_editar_texto,
             modelo_impress_replicar_todos,
             modelo_impress_texto_cabecalho,
             modelo_impress_texto_rodape
      FROM sistemas
      ORDER BY id DESC
      LIMIT 1
    `);
    const s = rows[0] || {};
    return {
      editar_texto: String(s.modelo_impress_editar_texto || 'S').toUpperCase() !== 'N',
      replicar_todos: String(s.modelo_impress_replicar_todos || 'N').toUpperCase() === 'S',
      texto_cabecalho_sistema: s.modelo_impress_texto_cabecalho || '',
      texto_rodape_sistema: s.modelo_impress_texto_rodape || '',
    };
  } catch (_) {
    return {
      editar_texto: true,
      replicar_todos: false,
      texto_cabecalho_sistema: '',
      texto_rodape_sistema: '',
    };
  }
}

function usuarioPodeEditarTextoModelo(politica, req) {
  if (req.user?.perfil == 1 || req.user?.role === 'admin') return true;
  return politica.editar_texto;
}

function usuarioPodeReplicarModelo(politica, req) {
  if (req.user?.perfil == 1 || req.user?.role === 'admin') return true;
  return politica.replicar_todos;
}

function aplicarTextosSistemaNoModelo(cfg, politica, req) {
  const out = { ...cfg };
  if (!usuarioPodeEditarTextoModelo(politica, req)) {
    out.header_text = politica.texto_cabecalho_sistema || '';
    out.footer_text = politica.texto_rodape_sistema || '';
  }
  return out;
}

module.exports = {
  loadModeloImpressaoPolitica,
  usuarioPodeEditarTextoModelo,
  usuarioPodeReplicarModelo,
  aplicarTextosSistemaNoModelo,
};
