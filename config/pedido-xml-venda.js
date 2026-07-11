/**
 * XML de pedido de venda — compatível com GeraXMLPedidos (Delphi legado).
 * Estrutura: Pedidos > Pedido > Numero, CNPJ, DataEntrega, Observacao, Itens > Item...
 */

function stripDoc(doc) {
  return String(doc || '').replace(/\D/g, '');
}

function escapeXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** DateToStr pt-BR (dd/mm/aaaa) a partir de DATE MySQL ou ISO. */
function formatDataEntregaDelphi(val) {
  if (!val) return '';
  const s = String(val).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-');
    return `${d}/${m}/${y}`;
  }
  return s;
}

/** FloatToStr locale BR (vírgula decimal, sem separador de milhar). */
function fmtFloatDelphi(v) {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('pt-BR', { useGrouping: false, maximumFractionDigits: 10 });
}

function gerarXmlPedidoVenda(dados) {
  const tipoPedido = String(dados.tipoPedido || 'PEDIDO').trim() || 'PEDIDO';
  const numero = String(dados.numero || '').trim();

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Pedidos>',
    '  <Pedido>',
    `    <Numero>${escapeXml(numero)}</Numero>`,
    `    <CNPJ>${escapeXml(dados.cnpj || '')}</CNPJ>`,
    `    <DataEntrega>${escapeXml(formatDataEntregaDelphi(dados.dataEntrega))}</DataEntrega>`,
    `    <Observacao>${escapeXml(dados.observacao || '')}</Observacao>`,
    '    <Itens>',
  ];

  for (const it of dados.itens || []) {
    const cod = String(it.cod_fabricante || '').trim();
    if (!cod) continue;
    lines.push('      <Item>');
    lines.push(`        <Produto>${escapeXml(cod)}</Produto>`);
    lines.push(`        <Quantidade>${escapeXml(fmtFloatDelphi(it.quantidade))}</Quantidade>`);
    lines.push(`        <Preco>${escapeXml(fmtFloatDelphi(it.valor_unitario))}</Preco>`);
    lines.push('      </Item>');
  }

  lines.push('    </Itens>', '  </Pedido>', '</Pedidos>');

  const xml = lines.join('\r\n');
  const fileName = `${tipoPedido} ${numero}.xml`;
  return { xml, fileName, buffer: Buffer.from(xml, 'utf8') };
}

async function carregarDadosXmlPedidoVenda(pool, pedidoId) {
  const id = parseInt(pedidoId, 10);
  if (!id) return null;

  const [pedRows] = await pool.query(
    `SELECT p.numero, p.tipo_pedido, p.data_entrega, p.obs, p.cod_cliente
       FROM pedidos p
      WHERE p.id = ? AND COALESCE(p.excluido, 'N') = 'N'
      LIMIT 1`,
    [id]
  );
  if (!pedRows[0]) return null;
  const ped = pedRows[0];

  let cnpj = '';
  if (ped.cod_cliente) {
    const [cliRows] = await pool.query(
      `SELECT cpf FROM clientes WHERE id = ? LIMIT 1`,
      [ped.cod_cliente]
    ).catch(() => [[]]);
    cnpj = stripDoc(cliRows[0]?.cpf || '');
  }

  const [itens] = await pool.query(
    `SELECT cod_fabricante, quantidade, valor_unitario
       FROM itensped
      WHERE id_pedido = ? AND COALESCE(excluido, 'N') = 'N'
      ORDER BY id`,
    [id]
  );

  const itensNorm = (itens || [])
    .map((i) => ({
      cod_fabricante: String(i.cod_fabricante || '').trim(),
      quantidade: parseFloat(i.quantidade) || 0,
      valor_unitario: parseFloat(i.valor_unitario) || 0,
    }))
    .filter((i) => i.cod_fabricante);

  return {
    numero: String(ped.numero || id),
    tipoPedido: String(ped.tipo_pedido || 'PEDIDO').trim() || 'PEDIDO',
    cnpj,
    dataEntrega: ped.data_entrega,
    observacao: ped.obs || '',
    itens: itensNorm,
  };
}

async function buildXmlAnexoPedidoVenda(pool, pedidoId) {
  const dados = await carregarDadosXmlPedidoVenda(pool, pedidoId);
  if (!dados || !dados.itens.length) return null;
  return gerarXmlPedidoVenda(dados);
}

module.exports = {
  stripDoc,
  fmtFloatDelphi,
  formatDataEntregaDelphi,
  gerarXmlPedidoVenda,
  carregarDadosXmlPedidoVenda,
  buildXmlAnexoPedidoVenda,
};
