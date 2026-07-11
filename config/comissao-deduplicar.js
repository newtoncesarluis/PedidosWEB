/** Análise e remoção de comissões duplicadas (regravação de parcelas sem limpar provisões). */

async function _metaPedido(conn, pedidoNum) {
  const [[ped]] = await conn.query(
    `SELECT p.qt_parcelas, COALESCE(f.com_tipo, 'PARCELADA') AS com_tipo
     FROM pedidos p
     LEFT JOIN fornecedores f ON f.id = p.cod_fornecedor
     WHERE p.numero = ? LIMIT 1`,
    [pedidoNum]
  );
  const maxPorVendedor = ped?.com_tipo === 'UNICA' ? 1 : Math.max(1, parseInt(ped?.qt_parcelas, 10) || 1);
  return { maxPorVendedor, com_tipo: ped?.com_tipo || 'PARCELADA', qt_parcelas: parseInt(ped?.qt_parcelas, 10) || 1 };
}

async function _listarComissoesPedido(conn, pedidoNum) {
  const [rows] = await conn.query(
    `SELECT pc.id, pc.pedido, pc.cod_user, pc.id_preposto, pc.id_parcela, pc.vlr_pago, pc.status,
            COALESCE(rec.parcela, 0) AS parcela,
            CASE WHEN rec.id IS NOT NULL THEN 1 ELSE 0 END AS parc_valida
     FROM pagtocomissao pc
     LEFT JOIN receber rec ON rec.id = pc.id_parcela
     WHERE pc.pedido = ? AND COALESCE(pc.excluido, 'N') = 'N'
       AND pc.status IN ('P', 'C', 'I')
       AND COALESCE(pc.observacao,'') NOT LIKE '%gerente%'
       AND COALESCE(pc.observacao,'') NOT LIKE '%preposto%'
     ORDER BY pc.cod_user, COALESCE(pc.id_preposto, 0), COALESCE(rec.parcela, 999), pc.id`,
    [pedidoNum]
  );
  return rows;
}

function _calcularIdsRemover(rows, maxPorVendedor) {
  const idsRemover = [];
  const porVendedor = new Map();

  for (const r of rows) {
    const vKey = `${r.cod_user}|${r.id_preposto || 0}|${r.status}`;
    if (!porVendedor.has(vKey)) porVendedor.set(vKey, { comParcela: new Map(), orfas: [] });
    const bucket = porVendedor.get(vKey);

    if (r.parc_valida && r.id_parcela) {
      const pKey = String(r.id_parcela);
      if (!bucket.comParcela.has(pKey)) bucket.comParcela.set(pKey, []);
      bucket.comParcela.get(pKey).push(r.id);
    } else {
      bucket.orfas.push(r.id);
    }
  }

  for (const bucket of porVendedor.values()) {
    for (const ids of bucket.comParcela.values()) {
      if (ids.length > 1) {
        ids.sort((a, b) => a - b);
        idsRemover.push(...ids.slice(1));
      }
    }
    if (bucket.orfas.length > maxPorVendedor) {
      bucket.orfas.sort((a, b) => a - b);
      idsRemover.push(...bucket.orfas.slice(maxPorVendedor));
    }
  }

  return idsRemover;
}

async function analisarPedido(conn, pedidoNum) {
  const { maxPorVendedor, com_tipo, qt_parcelas } = await _metaPedido(conn, pedidoNum);
  const rows = await _listarComissoesPedido(conn, pedidoNum);
  const idsRemover = _calcularIdsRemover(rows, maxPorVendedor);
  const valorDuplicado = rows
    .filter((r) => idsRemover.includes(r.id))
    .reduce((s, r) => s + (parseFloat(r.vlr_pago) || 0), 0);

  return {
    pedido: pedidoNum,
    com_tipo,
    qt_parcelas,
    max_esperado_por_vendedor: maxPorVendedor,
    total_ativas: rows.length,
    duplicatas: idsRemover.length,
    manter: rows.length - idsRemover.length,
    valor_duplicado: Math.round(valorDuplicado * 100) / 100,
    ids_removidos: idsRemover,
  };
}

async function aplicarDeduplicacao(conn, idsRemover) {
  if (!idsRemover.length) return 0;
  const ph = idsRemover.map(() => '?').join(',');
  const [upd] = await conn.query(
    `UPDATE pagtocomissao
     SET excluido = 'S',
         observacao = CONCAT(COALESCE(observacao,''), ' | DEDUP automático em ', CURDATE())
     WHERE id IN (${ph})`,
    idsRemover
  );
  return upd.affectedRows;
}

async function deduplicarPedido(conn, pedidoNum) {
  const analise = await analisarPedido(conn, pedidoNum);
  if (!analise.duplicatas) {
    return { ...analise, removidas: 0 };
  }
  const removidas = await aplicarDeduplicacao(conn, analise.ids_removidos);
  return { ...analise, removidas };
}

async function listarPedidosComComissaoAtiva(conn) {
  const [rows] = await conn.query(
    `SELECT DISTINCT pedido FROM pagtocomissao
     WHERE COALESCE(excluido,'N') = 'N' AND status IN ('P','C','I')
     ORDER BY pedido`
  );
  return rows.map((r) => r.pedido);
}

async function analisarTodasDuplicatas(conn) {
  const pedidos = await listarPedidosComComissaoAtiva(conn);
  const afetados = [];
  let totalDuplicatas = 0;
  let valorDuplicado = 0;

  for (const pedido of pedidos) {
    const a = await analisarPedido(conn, pedido);
    if (a.duplicatas > 0) {
      afetados.push(a);
      totalDuplicatas += a.duplicatas;
      valorDuplicado += a.valor_duplicado;
    }
  }

  return {
    pedidos_verificados: pedidos.length,
    pedidos_afetados: afetados,
    resumo: {
      pedidos_com_duplicata: afetados.length,
      total_duplicatas: totalDuplicatas,
      valor_duplicado: Math.round(valorDuplicado * 100) / 100,
    },
  };
}

async function corrigirTodasDuplicatas(conn, pedidosFiltro) {
  const todos = await listarPedidosComComissaoAtiva(conn);
  const alvo = pedidosFiltro?.length
    ? todos.filter((p) => pedidosFiltro.includes(String(p)))
    : todos;

  const detalhes = [];
  let totalRemovidas = 0;

  for (const pedido of alvo) {
    const r = await deduplicarPedido(conn, pedido);
    if (r.removidas > 0) {
      detalhes.push(r);
      totalRemovidas += r.removidas;
    }
  }

  return {
    pedidos_processados: alvo.length,
    pedidos_corrigidos: detalhes.length,
    total_removidas: totalRemovidas,
    detalhes,
  };
}

module.exports = {
  analisarPedido,
  deduplicarPedido,
  analisarTodasDuplicatas,
  corrigirTodasDuplicatas,
};
