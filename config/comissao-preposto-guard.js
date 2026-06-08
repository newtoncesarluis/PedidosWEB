/**
 * Regras de visibilidade: preposto NUNCA vê comissão do fornecedor/representante.
 */

function isPrepostoUser(req) {
  return req?.user?.tipo_usuario === 'PREPOSTO';
}

/** Campo de filtro em pagtocomissao conforme tipo de usuário logado. */
function pagtoComissaoUserField(req) {
  return isPrepostoUser(req) ? 'id_preposto' : 'cod_user';
}

/** ID do usuário para filtro em pagtocomissao (preposto ou representante). */
function pagtoComissaoUserId(req) {
  return req?.user?.id || null;
}

const PEDIDO_COMISSAO_REP_FIELDS = [
  'comissao', 'vlrcomissao', 'vlr_comissaonormal', 'vlr_total_comissao',
  'comissaogerente', 'compartilhacomissao', 'origem_comissao',
];

const FORNECEDOR_COMISSAO_REP_FIELDS = [
  'comissao', 'recalc_comissao_fatur', 'com_sobre_ipi', 'com_sobre_st', 'com_tipo',
];

function _omitFields(obj, fields) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = { ...obj };
  for (const f of fields) delete out[f];
  return out;
}

function stripPedidoComissaoRep(pedido) {
  return _omitFields(pedido, PEDIDO_COMISSAO_REP_FIELDS);
}

function stripFornecedorComissaoRep(forn) {
  return _omitFields(forn, FORNECEDOR_COMISSAO_REP_FIELDS);
}

function stripItemComissaoRep(item) {
  if (!item || typeof item !== 'object') return item;
  const out = { ...item };
  delete out.comissao_percentual;
  delete out.comissao;
  return out;
}

function stripItensComissaoRep(itens) {
  return (itens || []).map(stripItemComissaoRep);
}

const VENDEDOR_COMISSAO_REP_FIELDS = [
  'comissaofixavendedor', 'comissaogerente', 'compartilhacomissaogerente', 'permitevendasemcomissao',
];

function stripVendedorComissaoRep(vend) {
  return _omitFields(vend, VENDEDOR_COMISSAO_REP_FIELDS);
}

function stripProdutosComissaoRep(produtos) {
  return (produtos || []).map(p => {
    const o = { ...p };
    delete o.comissao;
    return o;
  });
}

/**
 * Filtro SQL em pagtocomissao.
 * Preposto → id_preposto; representante → cod_user sem linhas de preposto.
 */
async function buildPagtoComissaoFilter(pool, req, idOverride) {
  const uid = idOverride != null && idOverride !== '' ? idOverride : req?.user?.id;
  if (!uid) return { clause: '', params: [], isPrep: false };

  let isPrep = isPrepostoUser(req);
  if (idOverride != null && idOverride !== '') {
    const [[row]] = await pool.query(
      `SELECT COALESCE(tipo_usuario,'REPRESENTANTE') AS tipo FROM usuarios WHERE idusuario = ? LIMIT 1`,
      [uid]
    ).catch(() => [[]]);
    isPrep = String(row?.tipo || '').toUpperCase() === 'PREPOSTO';
  }

  if (isPrep) {
    return { clause: ' AND pc.id_preposto = ?', params: [uid], isPrep: true };
  }
  return {
    clause: ' AND pc.cod_user = ? AND (pc.id_preposto IS NULL OR pc.id_preposto = 0)',
    params: [uid],
    isPrep: false,
  };
}

/** Sanitiza linhas do extrato admin para preposto (oculta % do fornecedor). */
function sanitizeExtratoRowsForPreposto(rows) {
  return (rows || []).map(r => ({
    ...r,
    comissao: r.pct_preposto != null ? r.pct_preposto : r.comissao,
    label_origem: 'PREPOSTO',
    pct_preposto: undefined,
  }));
}

/**
 * Resposta do painel comissões/faturamento — só dados do preposto logado.
 * @param {object} payload resposta original
 * @param {object} req
 * @param {number|null} idPrepostoPedido id_preposto gravado no pedido
 */
function sanitizeComissoesFaturamentoForPreposto(payload, req, idPrepostoPedido) {
  if (!isPrepostoUser(req)) return payload;

  const userId = parseInt(req.user.id, 10);
  const prepId = parseInt(idPrepostoPedido, 10);

  if (!prepId || prepId !== userId) {
    return {
      ...payload,
      pedido: stripPedidoComissaoRep(payload.pedido || {}),
      parcelas: (payload.parcelas || []).map(p => ({ ...p, vlr_comissao: 0 })),
      divisao: [],
      total_comissao_prevista: 0,
      acesso_preposto: false,
    };
  }

  const divisaoPrep = (payload.divisao || []).filter(d => d.tipo === 'PREPOSTO');
  const pctPrep = divisaoPrep[0]?.percentual || 0;
  const totalPedido = parseFloat(payload.pedido?.vlrtotalpedido) || 0;
  const totalPrepPedido = parseFloat(payload.pedido?.vlr_comissao_preposto) || 0;

  let parcelas = payload.parcelas || [];
  if (pctPrep > 0 && parcelas.length) {
    const totalParc = parcelas.reduce((s, p) => s + (parseFloat(p.valor_cliente) || 0), 0);
    parcelas = parcelas.map(p => {
      const valor = parseFloat(p.valor_cliente) || 0;
      let vlr = 0;
      if (totalPrepPedido > 0 && totalParc > 0) {
        vlr = Math.round(totalPrepPedido * (valor / totalParc) * 100) / 100;
      } else if (totalParc > 0) {
        vlr = Math.round(valor * pctPrep / 100 * 100) / 100;
      }
      return { ...p, vlr_comissao: vlr };
    });
  } else {
    parcelas = parcelas.map(p => ({ ...p, vlr_comissao: 0 }));
  }

  const totalComissao = parcelas.reduce((s, p) => s + (parseFloat(p.vlr_comissao) || 0), 0);

  return {
    ...payload,
    pedido: {
      ...stripPedidoComissaoRep(payload.pedido || {}),
      vlr_comissao_preposto: totalPrepPedido || totalComissao,
    },
    parcelas,
    divisao: divisaoPrep,
    total_comissao_prevista: Math.round(totalComissao * 100) / 100,
    acesso_preposto: true,
  };
}

module.exports = {
  isPrepostoUser,
  pagtoComissaoUserField,
  pagtoComissaoUserId,
  stripPedidoComissaoRep,
  stripFornecedorComissaoRep,
  stripItemComissaoRep,
  stripItensComissaoRep,
  stripVendedorComissaoRep,
  stripProdutosComissaoRep,
  buildPagtoComissaoFilter,
  sanitizeExtratoRowsForPreposto,
  sanitizeComissoesFaturamentoForPreposto,
  PEDIDO_COMISSAO_REP_FIELDS,
  FORNECEDOR_COMISSAO_REP_FIELDS,
};
