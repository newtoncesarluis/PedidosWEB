const { parseNFe }                  = require('../parsers/nfe-parser');
const {
  verificarNotaJaImportada,
  buscarProduto,
  buscarFlagCompartilhaProduto,
  resolverPrecoImportacao,
  produtoIdOf,
} = require('../repositories/nfe-repository');

// ─── Erro de negócio tipado ───────────────────────────────────────────────────
function bizError(message, code) {
  return Object.assign(new Error(message), { code });
}

/**
 * Processa a importação de uma NF-e XML.
 *
 * @param {Buffer}  xmlBuffer    - conteúdo do arquivo XML
 * @param {object}  fornecedor   - { id, nome, produtofornecedor }
 * @param {object}  user         - req.user (id, id_empresa, …)
 * @returns {object}             - { nota, itens, totais, … }
 */
async function importarNFe({ xmlBuffer, fornecedor, user, id_tabela_preco }) {

  // 1. Fornecedor obrigatório
  if (!fornecedor?.id) {
    throw bizError(
      'Campo Fornecedor não informado! Informe para continuar a operação!',
      'FORNECEDOR_VAZIO'
    );
  }

  // 2. Parse do XML
  let nfeData;
  try {
    nfeData = parseNFe(xmlBuffer);
  } catch (err) {
    throw bizError(`XML inválido: ${err.message}`, 'XML_INVALIDO');
  }

  if (!nfeData.items.length) {
    throw bizError('Nenhum item encontrado no XML.', 'XML_SEM_ITENS');
  }

  // 3. Nota já importada?
  const duplicada = await verificarNotaJaImportada(nfeData.numero, nfeData.serie);
  if (duplicada) {
    throw bizError('Nota já importada!', 'NOTA_DUPLICADA');
  }

  // 4. Flags de compartilhamento
  const produtoFornecedor  = String(fornecedor.produtofornecedor ?? 'N').toUpperCase();
  const compartilhaProduto = await buscarFlagCompartilhaProduto();
  const idEmpresa          = user.id_empresa ?? null;

  const idTabela = parseInt(id_tabela_preco, 10) || null;

  // 5. Processar itens
  let totalProdutos = 0, totalIpi = 0, totalSt = 0, totalComissao = 0;
  let localizados   = 0, naoLocalizados = 0;

  const itens = await Promise.all(nfeData.items.map(async item => {
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
      // Dados cadastrais
      item.status_cadastro    = produto.status_cadastro ?? null;
      item.cod_produtos       = produtoIdOf(produto);
      item.kilo_embalagem     = parseFloat(produto.kilo_embalagem ?? 1);
      item.cod_fabricante     = produto.cod_fabricante ?? item.cod_fabricante;
      item.comissao           = parseFloat(produto.comissao ?? 0);
      item.cor1               = produto.cor1 ?? null;
      item.cor2               = produto.cor2 ?? null;
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

      // Cálculos
      item.valor_saca   = item.valor_unitario * item.kilo_embalagem;
      item.vlr_comissao = item.total_produtos * item.comissao / 100;
      // ST vem do cadastro do produto; IPI já vem do XML (item.ipi / item.vlr_ipi)
      item.vlr_st = Math.abs(item.total_produtos * item.st / 100);

      item.localizado = true;
      localizados++;
    } else {
      // Produto não cadastrado — mantém dados do XML, marca pendente
      item.localizado        = false;
      item.kilo_embalagem    = 1;
      item.comissao          = 0;
      item.st                = 0;
      item.vlr_comissao      = 0;
      item.vlr_st            = 0;
      item.valor_saca        = item.valor_unitario;
      item.cod_produtos      = null;
      naoLocalizados++;
    }

    totalProdutos += item.total_produtos;
    totalIpi      += item.vlr_ipi      ?? 0;
    totalSt       += item.vlr_st       ?? 0;
    totalComissao += item.vlr_comissao ?? 0;

    return item;
  }));

  return {
    nota: {
      chave:          nfeData.chave,
      data_emissao:   nfeData.data_emissao,
      numero:         nfeData.numero,
      serie:          nfeData.serie,
      natureza:       nfeData.natureza,
      fornecedor_id:  fornecedor.id,
      fornecedor_nome: fornecedor.nome
    },
    itens,
    localizados,
    nao_localizados: naoLocalizados,
    id_tabela_preco: idTabela,
    totais: {
      produtos:  +totalProdutos.toFixed(2),
      ipi:       +totalIpi.toFixed(2),
      st:        +totalSt.toFixed(2),
      comissao:  +totalComissao.toFixed(2)
    }
  };
}

module.exports = { importarNFe };
