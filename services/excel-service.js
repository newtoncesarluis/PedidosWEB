const { parseExcelPedido }          = require('../parsers/excel-parser');
const {
  buscarProduto,
  buscarFlagCompartilhaProduto,
  resolverPrecoImportacao,
  produtoIdOf,
} = require('../repositories/nfe-repository');

function bizError(msg, code) {
  return Object.assign(new Error(msg), { code });
}

/**
 * Importa itens de uma planilha Excel para o pedido.
 * Não verifica nota duplicada (Excel não tem chave NF-e).
 */
async function importarExcel({ buffer, fornecedor, user, id_tabela_preco }) {
  if (!fornecedor?.id) {
    throw bizError(
      'Campo Fornecedor não informado! Informe para continuar a operação!',
      'FORNECEDOR_VAZIO'
    );
  }

  let rows;
  try {
    rows = parseExcelPedido(buffer);
  } catch (err) {
    throw bizError(`Planilha inválida: ${err.message}`, 'EXCEL_INVALIDO');
  }

  const produtoFornecedor  = String(fornecedor.produtofornecedor ?? 'N').toUpperCase();
  const compartilhaProduto = await buscarFlagCompartilhaProduto();
  const idEmpresa          = user.id_empresa ?? null;
  const idTabela           = parseInt(id_tabela_preco, 10) || null;

  let localizados = 0, naoLocalizados = 0;
  let totalProdutos = 0, totalComissao = 0;

  const itens = await Promise.all(rows.map(async item => {
    const produto = await buscarProduto({
      codFabricante:      item.cod_fabricante,
      idFornecedor:       fornecedor.id,
      produtoFornecedor,
      compartilhaProduto,
      idEmpresa
    });

    item.cod_fornecedor  = fornecedor.id;
    item.nome_fornecedor = fornecedor.nome;

    if (produto) {
      item.descricao          = produto.desc_produto || produto.descricao || item.cod_fabricante;
      item.unidade            = produto.unidade || '';
      item.status_cadastro    = produto.status_cadastro ?? null;
      item.cod_produtos       = produtoIdOf(produto);
      item.kilo_embalagem     = parseFloat(produto.kilo_embalagem ?? 1);
      item.cod_fabricante     = produto.cod_fabricante ?? item.cod_fabricante;
      item.comissao           = parseFloat(produto.comissao ?? 0);
      item.cor1               = produto.cor1   ?? null;
      item.cor2               = produto.cor2   ?? null;
      item.movimenta_estoque  = produto.movimenta_estoque ?? null;
      item.disponivel         = produto.disponivel ?? null;
      item.kitprincipal       = produto.kitprincipal ?? null;
      item.kit_item           = produto.kit_item ?? null;
      item.id_familiaproduto  = produto.id_familiaproduto ?? null;
      item.nome_familia       = produto.nome_familia ?? null;
      item.st                 = parseFloat(produto.st ?? 0);
      item._preco_origem      = parseFloat(item.valor_unitario) || 0;
      item._vlr_catalogo      = parseFloat(produto.vlr_venda) || 0;

      const precos = await resolverPrecoImportacao({
        idTabela,
        produto,
        precoArquivo: item._preco_origem,
      });
      item.valor_unitario  = precos.valor_unitario;
      item.vlr_padrao      = precos.vlr_padrao;
      item.preco_da_tabela = precos.preco_da_tabela;
      item.usou_tabela     = precos.usou_tabela;
      item.total_produtos  = item.quantidade * item.valor_unitario;

      item.valor_saca         = item.valor_unitario * item.kilo_embalagem;
      item.vlr_comissao       = item.total_produtos * item.comissao / 100;
      item.vlr_st             = Math.abs(item.total_produtos * item.st / 100);
      item.localizado         = true;
      localizados++;
    } else {
      item.descricao      = item.cod_fabricante;
      item.unidade        = '';
      item.localizado     = false;
      item.kilo_embalagem = 1;
      item.comissao       = 0;
      item.st             = 0;
      item.vlr_comissao   = 0;
      item.vlr_st         = 0;
      item.valor_saca     = item.valor_unitario;
      item.cod_produtos   = null;
      naoLocalizados++;
    }

    totalProdutos += item.total_produtos;
    totalComissao += item.vlr_comissao ?? 0;
    return item;
  }));

  return {
    itens,
    localizados,
    nao_localizados: naoLocalizados,
    id_tabela_preco: idTabela,
    totais: {
      produtos: +totalProdutos.toFixed(2),
      comissao: +totalComissao.toFixed(2)
    }
  };
}

module.exports = { importarExcel };
