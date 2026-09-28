/**
 * XML/XLS de pedido de venda — compatível com GeraXMLPedidos (Delphi legado).
 * Estrutura XML: Pedidos > Pedido > Numero, CNPJ, DataEntrega, Observacao, Itens > Item...
 * XLS: mesmas informações (aba Pedido + aba Itens).
 */

const XLSX = require('xlsx');

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

function nomeArquivoPedidoVenda(dados, ext) {
  const tipoPedido = String(dados.tipoPedido || 'PEDIDO').trim() || 'PEDIDO';
  const numero = String(dados.numero || '').trim();
  return `${tipoPedido} ${numero}.${ext}`;
}

function gerarXmlPedidoVenda(dados) {
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
  const fileName = nomeArquivoPedidoVenda(dados, 'xml');
  return { xml, fileName, buffer: Buffer.from(xml, 'utf8') };
}

/**
 * Mesma lógica do XML: cabeçalho (Numero/CNPJ/DataEntrega/Observacao) + itens
 * (Produto=cod_fabricante, Quantidade, Preco=valor_unitario).
 * Formato .xls (BIFF) para compatibilidade com importadores legados.
 */
function gerarXlsPedidoVenda(dados) {
  const numero = String(dados.numero || '').trim();
  const wb = XLSX.utils.book_new();

  const wsPedido = XLSX.utils.aoa_to_sheet([
    ['Numero', 'CNPJ', 'DataEntrega', 'Observacao'],
    [
      numero,
      String(dados.cnpj || ''),
      formatDataEntregaDelphi(dados.dataEntrega),
      String(dados.observacao || ''),
    ],
  ]);
  XLSX.utils.book_append_sheet(wb, wsPedido, 'Pedido');

  const rowsItens = [['Produto', 'Quantidade', 'Preco']];
  for (const it of dados.itens || []) {
    const cod = String(it.cod_fabricante || '').trim();
    if (!cod) continue;
    rowsItens.push([
      cod,
      parseFloat(it.quantidade) || 0,
      parseFloat(it.valor_unitario) || 0,
    ]);
  }
  const wsItens = XLSX.utils.aoa_to_sheet(rowsItens);
  XLSX.utils.book_append_sheet(wb, wsItens, 'Itens');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xls' });
  const fileName = nomeArquivoPedidoVenda(dados, 'xls');
  return { fileName, buffer: Buffer.from(buffer) };
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
  const numpedido = String(ped.numero != null && ped.numero !== '' ? ped.numero : id);

  let cnpj = '';
  if (ped.cod_cliente) {
    const [cliRows] = await pool.query(
      `SELECT cpf FROM clientes WHERE id = ? LIMIT 1`,
      [ped.cod_cliente]
    ).catch(() => [[]]);
    cnpj = stripDoc(cliRows[0]?.cpf || '');
  }

  // numpedido (string) usa índice; id_pedido varchar quase todo NULL faz full scan em bases legadas
  let [itens] = await pool.query(
    `SELECT cod_fabricante, quantidade, valor_unitario
       FROM itensped
      WHERE numpedido = ? AND COALESCE(excluido, 'N') = 'N'
      ORDER BY id`,
    [numpedido]
  ).catch(() => [[]]);

  if (!itens?.length) {
    [itens] = await pool.query(
      `SELECT cod_fabricante, quantidade, valor_unitario
         FROM itensped
        WHERE CAST(id_pedido AS CHAR) = ? AND COALESCE(excluido, 'N') = 'N'
        ORDER BY id`,
      [String(id)]
    ).catch(() => [[]]);
  }

  const itensNorm = (itens || [])
    .map((i) => ({
      cod_fabricante: String(i.cod_fabricante || '').trim(),
      quantidade: parseFloat(i.quantidade) || 0,
      valor_unitario: parseFloat(i.valor_unitario) || 0,
    }))
    .filter((i) => i.cod_fabricante);

  return {
    numero: numpedido,
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

async function buildXlsAnexoPedidoVenda(pool, pedidoId) {
  const dados = await carregarDadosXmlPedidoVenda(pool, pedidoId);
  if (!dados || !dados.itens.length) return null;
  return gerarXlsPedidoVenda(dados);
}

module.exports = {
  stripDoc,
  fmtFloatDelphi,
  formatDataEntregaDelphi,
  gerarXmlPedidoVenda,
  gerarXlsPedidoVenda,
  carregarDadosXmlPedidoVenda,
  buildXmlAnexoPedidoVenda,
  buildXlsAnexoPedidoVenda,
};
