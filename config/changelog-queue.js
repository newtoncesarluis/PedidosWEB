'use strict';

/**
 * Fila de novidades — toda IA/desenvolvedor que entregar melhoria visível ao usuário
 * deve acrescentar um objeto aqui. No próximo startup (login no tenant), entradas novas
 * são inseridas em sistema_changelog (dedup por titulo + versao).
 *
 * Campos: versao, tipo (NOVO|MELHORIA|BUG), titulo, descricao, data_lancamento (YYYY-MM-DD)
 * Deploy: Servidor_Projetos.bat pergunta titulo apos bump; ou Sistema > Notas de Versao
 */
module.exports = [
  {
    versao: '1.1.5.0',
    tipo: 'MELHORIA',
    titulo: 'Busca de comércios muito mais completa: base aberta Overture Maps, com telefone',
    descricao:
      'A busca de estabelecimentos (açougue, padaria, mercado, farmácia...) passou a usar uma base aberta bem mais completa que o mapa colaborativo: em Bauru, por exemplo, são cerca de 67 padarias e 20 açougues num raio de 3 km, ' +
      'a maioria com telefone. O telefone já vem preenchido ao salvar como lead. Se a base não estiver carregada, o sistema continua usando o OpenStreetMap automaticamente.',
  },
  {
    versao: '1.1.5.0',
    tipo: 'NOVO',
    titulo: 'Clientes Próximos: busque açougues, padarias e outros comércios no mapa e salve como lead',
    descricao:
      'No mapa de Clientes Próximos (Perto de Mim), digite ou toque numa categoria (açougue, padaria, mercado...) para ver estabelecimentos reais ao redor, mesmo que ainda não sejam seus clientes. ' +
      'Cada ponto tem Google Maps, Waze, WhatsApp e Salvar como lead. O mapa ganhou visual de ruas parecido com o Google, com opção de Satélite.',
  },
  {
    versao: '1.1.5.0',
    tipo: 'NOVO',
    titulo: 'Mapa de prospecção: leads em lote, filtros da carteira, mapa de calor e acompanhamento em tempo real',
    descricao:
      'No Mapa de Clientes: selecione vários estabelecimentos e salve como leads de uma vez (sem duplicar); veja leads e clientes juntos no mapa; filtre clientes sem compra há 30/60/90/180 dias e por vendedor; ' +
      'use o mapa de calor para ver a concentração da carteira; busque por categorias com um toque (açougue, padaria, atacado, oficina...); e acompanhe sua posição em tempo real com aviso da próxima parada da rota.',
  },
  {
    versao: '1.1.5.0',
    tipo: 'MELHORIA',
    titulo: 'Rotas do vendedor: funciona sem sinal e avisa quando a visita é registrada longe do cliente',
    descricao:
      'Sem internet, a rota aberta continua disponível e as visitas registradas ficam guardadas no aparelho, sendo enviadas sozinhas quando o sinal voltar. ' +
      'Ao marcar uma visita como realizada a mais de 500 m do cliente, o sistema pede confirmação e registra a distância na observação. Avisos e confirmações passaram a usar o padrão visual do sistema.',
  },
  {
    versao: '1.1.5.0',
    tipo: 'MELHORIA',
    titulo: 'Rotas e Mapa no celular: botões Google Maps e Waze, trajeto otimizado a partir da sua posição',
    descricao:
      'No Mapa de Clientes e nas Rotas do Vendedor, cada cliente agora tem botões diretos para Google Maps e Waze. O Google Maps parte da sua posição e leva só os clientes ainda pendentes (10 por vez). ' +
      'Otimizar trajeto passou a usar a distância real em km, parte de onde você está e desenha o caminho pelas ruas com tempo estimado. Botões maiores no celular e correção de nomes com aspas/símbolos nas telas de rota.',
  },
  {
    versao: '1.1.5.0',
    tipo: 'MELHORIA',
    titulo: 'Mapa: rota otimizada parte da sua posição, segue pelas ruas e mostra tempo de viagem',
    descricao:
      'A rota do Mapa de Clientes agora começa onde você está, traça o caminho real pelas ruas (não mais uma linha reta), numera as paradas na ordem de visita e mostra distância e tempo estimado. ' +
      'O botão Google Maps passou a abrir a rota completa com as paradas corretamente. A rota também funciona com os estabelecimentos encontrados na busca.',
  },
  {
    versao: '1.1.5.0',
    tipo: 'NOVO',
    titulo: 'Mapa de Clientes: encontre estabelecimentos novos perto de você (açougue, padaria, farmácia...)',
    descricao:
      'No Mapa de Clientes, escolha "Estabelecimentos (novos)" em Buscar, digite o tipo de comércio (ex.: açougue) e veja no mapa os locais próximos que ainda não são seus clientes — ' +
      'com telefone, rota e WhatsApp quando disponíveis. Estabelecimentos que já estão no seu cadastro aparecem marcados em verde.',
  },
  {
    versao: '1.1.5.0',
    tipo: 'MELHORIA',
    titulo: 'Parcelamento gera a sequência do documento (NF/1, NF/2, NF/3) e Pagar ganha forma de pagamento',
    descricao:
      'Ao parcelar um título informando o Nº do documento/NF, o sistema grava cada parcela com a sequência (ex.: 3681/1, 3681/2, 3681/3) em Contas a Pagar e a Receber. ' +
      'No Contas a Pagar, o lançamento ganhou o campo Forma de pagamento (boleto, cheque, PIX, dinheiro, cartão, transferência ou outros), que já vem preenchido na baixa.',
  },
  {
    versao: '1.1.5.0',
    tipo: 'MELHORIA',
    titulo: 'Contas a Pagar/Receber: coluna Documento mostra o seu número + parcela',
    descricao:
      'Ao informar o Nº do Título / NF, a coluna Documento passa a exibir o número digitado seguido da parcela (ex.: 3681 · 2/4), ' +
      'em vez do código interno gerado pelo sistema (P000010). Sem número digitado, continua aparecendo o código interno.',
  },
  {
    versao: '1.1.5.0',
    tipo: 'MELHORIA',
    titulo: 'Financeiro no cadastro do cliente: veja o que está em aberto e o que já foi pago',
    descricao:
      'No cadastro de Clientes, o botão "Financeiro" (visão rápida e menu ⋮) abre os títulos a receber lançados para aquele cliente, ' +
      'com vencimento, valor, parcela, forma/banco de cobrança e a data do pagamento quando já baixado. ' +
      'Abas Em aberto, Vencidas, Pagas e Todas, com totais de em aberto, vencido e recebido. Ao dar baixa em Contas a Receber, o título já aparece como pago ali.',
  },
  {
    versao: '1.1.5.0',
    tipo: 'MELHORIA',
    titulo: 'Contas a Receber: banco e tipo de cobrança no lançamento',
    descricao:
      'Ao lançar ou editar um título a receber, agora é possível informar o Tipo de cobrança (boleto em cobrança bancária, cheque, PIX, dinheiro etc.) ' +
      'e o Banco / Conta onde o valor vai entrar. A lista mostra a coluna "Cobrança / Banco" e a baixa já abre com esses dados preenchidos. ' +
      'O parcelamento agora aceita nº de parcelas, intervalo em dias/semanas/meses/anos, carência até a 1ª parcela (ex.: começar após 45 dias, de 30 em 30) e dividir o valor total ou repetir o valor de cada parcela. ' +
      'Há também filtro por Banco / Conta na lista. No Contas a Pagar, o lançamento ganhou o campo Banco / Conta de pagamento e o mesmo parcelamento flexível. ' +
      'Os campos são opcionais no lançamento; na baixa o banco também pode ficar em branco (cobrança em carteira): o sistema alerta que o valor não entrará no saldo de nenhuma conta.',
  },
  {
    versao: '1.1.5.0',
    tipo: 'MELHORIA',
    titulo: 'Pedido com Puxada = Sim passa a funcionar como no sistema antigo',
    descricao:
      'Com Puxada = Sim, o item tem um único campo "Valor Cliente"; Total Puxada = peso × Valor Cliente (não altera o total do item). ' +
      'O pedido grava o total puxada e a diferença para o total dos itens, e essa diferença soma na comissão total. ' +
      'As colunas Valor Puxada e Total Puxada aparecem na grade de itens só com Puxada = Sim. ' +
      'Ao imprimir, o sistema pergunta se deseja imprimir a puxada: o relatório mostra Preço Cliente, Preço Real, Valor Adic., ' +
      'Total c/ Puxada, Vlr. Fornecedor, Total Puxada e comissão (como no sistema antigo).',
  },
  {
    versao: '1.1.5.0',
    tipo: 'MELHORIA',
    titulo: 'Relatório do pedido: Total Descontos e nomes dos totais editáveis',
    descricao:
      'Em Configurar modelo de impressão > Blocos > Totais, nova opção "Total Descontos" e campos para renomear cada total do rodapé ' +
      '(ex.: "Total Volumes", "Total Produtos", "Valor do Pedido"). Em branco, usa o nome padrão.',
  },
  {
    versao: '1.1.5.0',
    tipo: 'BUG',
    titulo: 'Pedido: Tipo Documento agora é compartilhado com o sistema antigo',
    descricao:
      'O Tipo Documento do pedido passa a ser gravado e lido na mesma coluna do sistema antigo (Delphi). ' +
      'Valores já informados na web são copiados automaticamente; pedidos antigos passam a mostrar o tipo no combo.',
  },
  {
    versao: '1.1.5.0',
    tipo: 'MELHORIA',
    titulo: 'Lista de pedidos: coluna e filtro Puxada',
    descricao:
      'Com "Puxada" habilitada na Configuração do Sistema, a lista de pedidos ganha a coluna PUXADA (Sim/Não), ' +
      'ativável pelo ícone de engrenagem (colunas), e o filtro Puxada nos Filtros avançados.',
  },
  {
    versao: '1.1.5.0',
    tipo: 'NOVO',
    titulo: 'Opção de não exibir parcelas de pedidos no Contas a Receber',
    descricao:
      'Em Sistema > Configuração do Sistema, a opção "Ocultar parcelas de pedidos no Contas a Receber" mantém as parcelas geradas ' +
      '(comissões e relatórios continuam funcionando), mas as remove da lista, dos totais e dos gráficos do Contas a Receber.',
    data_lancamento: '2026-10-14',
  },
  {
    versao: '1.1.5.0',
    tipo: 'BUG',
    titulo: 'Pedido: grade fechada já vem preenchida',
    descricao:
      'Ao escolher um produto com grade fechada (pronta), a quantidade por tamanho entra automaticamente com a distribuição do cadastro, ' +
      'sem precisar digitar a numeração. Para vender mais, basta ajustar o total em múltiplos da grade.',
    data_lancamento: '2026-10-13',
  },
  {
    versao: '1.1.5.0',
    tipo: 'MELHORIA',
    titulo: 'Showroom: escolha de cores em galeria com fotos grandes',
    descricao:
      'Ao escolher as cores, as miniaturas ficam à esquerda e a cor aberta aparece em foto grande, com o preço no canto. ' +
      'Quando a cor tem mais fotos, uma tira de ângulos permite trocar a imagem. A quantidade digitada aparece na miniatura de cada cor. ' +
      'Adicionar várias cores ao carrinho ficou mais rápido e mostra o andamento na tela.',
    data_lancamento: '2026-10-13',
  },
  {
    versao: '1.1.5.0',
    tipo: 'NOVO',
    titulo: 'Showroom: múltiplos de grade, novo carrinho e busca estilo Google',
    descricao:
      'Na quantidade, digite a grade uma vez, informe as caixas e toque em Gerar múltiplos (usa a embalagem do cadastro); os tamanhos podem ser digitados. ' +
      'Nova tela inicial «Novo carrinho» (cliente, tabela, condição e tipo), volta ao detalhe da referência após adicionar (para escolher outra cor) ' +
      'e fechamento em abas Itens / Dados do pedido. A busca aceita várias palavras em qualquer ordem, sem acento.',
    data_lancamento: '2026-10-12',
  },
  {
    versao: '1.1.5.0',
    tipo: 'BUG',
    titulo: 'Importação de preços: comissão em percentual',
    descricao:
      'Na pré-visualização da planilha, a coluna Comissão deixou de aparecer como R$. ' +
      'O valor é mostrado em percentual e fica em branco quando a célula está vazia ou zerada.',
    data_lancamento: '2026-10-12',
  },
  {
    versao: '1.1.5.0',
    tipo: 'NOVO',
    titulo: 'Tipos de Pagamento cadastráveis + atalhos no pedido',
    descricao:
      'Nova tela Financeiro › Cadastros Financeiros › Tipos de Pagamento (Boleto, PIX, Cartão, Cheque…). ' +
      'O combo da Forma de Pagamento e o da Forma Pagto Padrão do pedido passam a usar esse cadastro. ' +
      'No pedido, o botão + ao lado de Forma Pagto Padrão e de Condição Pagto cria um novo na hora, sem sair da tela.',
    data_lancamento: '2026-10-08',
  },
  {
    versao: '1.1.5.0',
    tipo: 'NOVO',
    titulo: 'Pedidos: visualizar impresso, nome do PDF automático e observações em maiúsculas',
    descricao:
      'Botão Visualizar no topo do pedido abre a impressão sem salvar. A Descrição do PDF vira o nome do produto (1 item) ou «carga mista» (2+). ' +
      'Observações podem sair em MAIÚSCULAS e o nome da empresa no relatório aceita quebra de linha e alinhamento (Configuração do Sistema). ' +
      'O título «Observação» não aparece mais duas vezes. Na home, ⚙ Personalizar escolhe o que exibir e liga a lista de últimos pedidos.',
    data_lancamento: '2026-10-08',
  },
  {
    versao: '1.1.5.0',
    tipo: 'MELHORIA',
    titulo: 'Ajuda: senha de app do Gmail e erros de envio de e-mail',
    descricao:
      'Na Ajuda de Usuários (E-mail SMTP) há o passo a passo para gerar a senha de app do Gmail, ' +
      'o que fazer quando o Google diz que a configuração não está disponível e a explicação dos erros mais comuns de envio.',
    data_lancamento: '2026-10-08',
  },
  {
    versao: '1.1.5.0',
    tipo: 'MELHORIA',
    titulo: 'Peso total e quantidade ao editar item',
    descricao:
      'Na janela do item do pedido, o rodapé mostra a quantidade (sacas) e o peso total em kg, ' +
      'atualizando enquanto você digita.',
    data_lancamento: '2026-10-08',
  },
  {
    versao: '1.1.5.0',
    tipo: 'MELHORIA',
    titulo: 'Logo do pedido no tamanho do cadastro',
    descricao:
      'Com a logo antes do nome, a imagem da empresa usa o tamanho P, M ou G do cadastro, e não sai pequena. ' +
      'No modelo de impressão, aba Cabeçalho, dá para colocar o nome no meio da logo, em cima ou embaixo.',
    data_lancamento: '2026-10-08',
  },
  {
    versao: '1.1.5.0',
    tipo: 'BUG',
    titulo: 'Relatório usa a logo da tela inicial',
    descricao:
      'Se a empresa não tiver logo que abra no cadastro, o relatório usa a mesma logo que aparece na tela inicial, ao lado de SysPed WEB. ' +
      'Com «Antes do nome da empresa», ela fica à esquerda do nome.',
    data_lancamento: '2026-10-08',
  },
  {
    versao: '1.1.5.0',
    tipo: 'NOVO',
    titulo: 'Modelo de impressão em abas e título como foi escrito',
    descricao:
      'Configurar modelo de impressão ficou em abas: Aparência, Cabeçalho, Cliente, Itens e Blocos. ' +
      'O título de cada bloco sai no papel do jeito que você digitou, com maiúscula e minúscula. ' +
      'Na aba Cabeçalho dá para colocar a logo antes do nome e ajustar o tamanho do texto da faixa colorida.',
    data_lancamento: '2026-10-08',
  },
  {
    versao: '1.1.5.0',
    tipo: 'NOVO',
    titulo: 'Observação do pedido com formatação (negrito, cor…)',
    descricao:
      'Na aba Observações do pedido há uma barra de formatação: negrito, itálico, sublinhado e cor do texto. ' +
      'Selecione trechos e formate direto no pedido, sem ir no cadastro do fornecedor. A formatação aparece no relatório/PDF.',
    data_lancamento: '2026-10-07',
  },
  {
    versao: '1.1.5.0',
    tipo: 'MELHORIA',
    titulo: 'Relatório do pedido: seções opcionais no modelo',
    descricao:
      'No modelo de impressão do pedido há a opção «Separar por seções» (desligada por padrão). ' +
      'Quando ligada, o relatório destaca Dados do pedido, Cliente, Pagamento, Observação, Totais e Parcelas em blocos com título.',
    data_lancamento: '2026-10-07',
  },
  {
    versao: '1.1.5.0',
    tipo: 'MELHORIA',
    titulo: 'Relatório do pedido: forma de pagamento, prazo e hora',
    descricao:
      'No relatório/PDF do pedido o cabeçalho mostra Forma Pagto (boleto, PIX, cartão, etc.), se é À vista ou A prazo e a condição. ' +
      'A tabela de Parcelas só aparece se estiver marcada no modelo de impressão (vale à vista e a prazo). ' +
      'A Data de Emissão passa a incluir a hora (ex.: 07/10/2026 16:07).',
    data_lancamento: '2026-10-07',
  },
  {
    versao: '1.1.5.0',
    tipo: 'MELHORIA',
    titulo: 'Pedido: quantidade em sacas e total de KGs',
    descricao:
      'Na aba Itens do pedido, cada mercadoria com peso cadastrado (kg da embalagem) mostra a quantidade e, abaixo, quantos KG deu (ex.: 640 SCS → 32.000 kg). ' +
      'No rodapé dos totais aparece também o Total de KGs do pedido, ao lado do Total de Quantidade.',
    data_lancamento: '2026-10-07',
  },
  {
    versao: '1.1.5.0',
    tipo: 'NOVO',
    titulo: 'Flex de preço: conta corrente do vendedor por fábrica',
    descricao:
      'Em Fornecedores → Preferências, ligue «Flex de preço». Vender acima do preço de tabela gera crédito na conta flex do vendedor; ' +
      'vender abaixo consome o saldo. No pedido aparece o flex gerado/consumido e o saldo do vendedor. ' +
      'Você define quando lançar (salvar, aprovar ou faturar), o que fazer com saldo insuficiente (avisar, bloquear ou permitir negativo) e a validade do saldo. ' +
      'Cada vendedor tem o seu saldo. Veja saldos, extrato e ajustes em Financeiro → Gestão de Comissão → Conta Flex.',
    data_lancamento: '2026-10-07',
  },
  {
    versao: '1.1.5.0',
    tipo: 'NOVO',
    titulo: 'Vitrine: parâmetro pedido único ou por fábrica',
    descricao:
      'Em Sistema → Configuração do Sistema → Pedidos há a opção «Vitrine: pedido único». ' +
      'Com Sim, o carrinho inteiro vira um único pedido, mesmo misturando fábricas. ' +
      'Com Não (padrão), ao enviar nasce um pedido separado por fábrica/tabela.',
    data_lancamento: '2026-10-07',
  },
  {
    versao: '1.1.5.0',
    tipo: 'BUG',
    titulo: 'Vitrine: trocar de fábrica não remove mais o carrinho',
    descricao:
      'Na Vitrine Digital, ao mudar de tabela/fábrica (ex.: de ALFAPARF para AVLON) o carrinho permanece com os itens já escolhidos. ' +
      'Você continua comprando em outras fábricas sem perder o que já estava no carrinho.',
    data_lancamento: '2026-10-07',
  },
  {
    versao: '1.1.5.0',
    tipo: 'BUG',
    titulo: 'Logo da empresa: nunca mais trocado por logo de outra empresa',
    descricao:
      'O sistema não procura mais outro arquivo de logo na pasta quando o logo cadastrado some: ele usa só o que está gravado no cadastro da empresa. ' +
      'Isso evita que o logo de outra empresa apareça no login e nos relatórios.',
    data_lancamento: '2026-10-06',
  },
  {
    versao: '1.1.5.0',
    tipo: 'BUG',
    titulo: 'App mobile: menu «⋯» do cliente abre sempre no lugar certo',
    descricao:
      'O menu do cliente (Mapa, Vitrine Digital, Excluir) agora abre ancorado no próprio card, mesmo com a lista rolada até o fim. ' +
      'Antes ele podia piscar e não aparecer em clientes mais abaixo na lista.',
    data_lancamento: '2026-10-06',
  },
  {
    versao: '1.1.5.0',
    tipo: 'MELHORIA',
    titulo: 'Vitrine no celular: filtros compactos e sem botão flutuante',
    descricao:
      'Na Vitrine Digital, a busca e os filtros (menor preço, maior preço, A→Z, itens por página e total) agora ocupam só duas linhas no celular, ' +
      'sobrando mais espaço para os produtos. Dentro do app do vendedor, o botão flutuante «Início» deu lugar a uma seta de voltar no cabeçalho.',
    data_lancamento: '2026-10-06',
  },
  {
    versao: '1.1.5.0',
    tipo: 'MELHORIA',
    titulo: 'App mobile: Vitrine Digital completa (tabelas, aparência e QR Code)',
    descricao:
      'O modal da Vitrine no app agora tem o mesmo conteúdo do computador, organizado para o celular: validade do link, copiar, WhatsApp, abrir, QR Code, ' +
      'novo link, aparência Dia/Noite e escolha das tabelas liberadas no link (lista recolhida com busca e caixas de seleção).',
    data_lancamento: '2026-10-06',
  },
  {
    versao: '1.1.5.0',
    tipo: 'MELHORIA',
    titulo: 'App mobile: novo visual da lista de clientes + botão Vitrine',
    descricao:
      'Os cards de clientes no app ficaram mais claros e compactos: uma única linha com «Novo pedido» e ícones de WhatsApp, Visita e Histórico. ' +
      'No menu «⋯» do card ficam Mapa, Vitrine Digital (gerar o link do catálogo para o cliente) e Excluir.',
    data_lancamento: '2026-10-06',
  },
  {
    versao: '1.1.5.0',
    tipo: 'BUG',
    titulo: 'Vitrine: seletor de tabelas do link e busca de cliente',
    descricao:
      'Ao reabrir o modal de um link já gerado, o seletor agora mostra as tabelas realmente liberadas nele (antes aparecia tudo marcado). ' +
      'Marcar todas volta a significar «sem restrição». Clientes com aspas no nome agora podem ter o link gerado normalmente.',
    data_lancamento: '2026-10-06',
  },
  {
    versao: '1.1.5.0',
    tipo: 'MELHORIA',
    titulo: 'Vitrine: trocar de tabela/fábrica mantém o carrinho',
    descricao:
      'Ao trocar a tabela de preços na Vitrine Digital, o carrinho não é mais zerado: os itens são mantidos e recalculados com o preço da nova tabela. ' +
      'Só os itens que não existem na nova tabela são removidos (com aviso antes de confirmar).',
    data_lancamento: '2026-10-06',
  },
  {
    versao: '1.1.5.0',
    tipo: 'MELHORIA',
    titulo: 'Baixar PDF do pedido: escolher pasta e lembrar o último local',
    descricao:
      'Ao clicar em Baixar PDF (Chrome/Edge no computador), abre o diálogo «Salvar como» para escolher a pasta. ' +
      'Na próxima vez o sistema já sugere o último local usado. No celular ou em navegadores sem esse recurso, o download continua como antes.',
    data_lancamento: '2026-10-06',
  },
  {
    versao: '1.1.5.0',
    tipo: 'BUG',
    titulo: 'Relatório do pedido: desmarcar Vlr Venda e outras colunas no painel',
    descricao:
      'Em Colunas dos itens, a caixa «Relatório» de Vlr Venda (e também Acréscimo, Vlr Final, Total, IPI, ST e Vlr c/ Imposto) ' +
      'agora pode ser desmarcada e some do PDF. Antes ficava travada e o Vlr Venda continuava saindo pelo modelo («Preço unitário»). ' +
      'No modelo de impressão o item passou a se chamar «Vlr Venda (preço unitário)».',
    data_lancamento: '2026-10-06',
  },
  {
    versao: '1.1.5.0',
    tipo: 'NOVO',
    titulo: 'Pedido: Descrição do PDF na aba Entrega',
    descricao:
      'Em Sistema → Configuração do Sistema → Pedidos, a opção «Descrição do PDF no Pedido» libera o campo na aba Entrega. ' +
      'O texto livre (ex.: carga mista) entra no nome do arquivo ao baixar o PDF, no formato: número + cidade do cliente + descrição + FN + código do fornecedor + data (ex.: 006494 BARRETOS carga mista FN 01 05102026.pdf). ' +
      'FN é fixo (Fornecedor); o número após FN é o código (ID) da fábrica.',
    data_lancamento: '2026-10-06',
  },
  {
    versao: '1.1.3.173',
    tipo: 'NOVO',
    titulo: 'Relatório do pedido: renomear colunas, ocultar Descrição e novas colunas',
    descricao:
      'Em Colunas dos itens, cada coluna do relatório agora tem o campo «Nome no relatório» (ex.: Peso Total → Kilos); Item, Código, Descrição, Unid. e Quant. podem ser renomeadas em «Renomear colunas fixas». ' +
      'Em Configurar modelo de impressão, a Descrição do produto pode ser ocultada. ' +
      'Vlr Puxada, Total Puxada e Vlr Comissão ganharam a opção «No relatório» (dados internos, vêm desligados e com aviso; a comissão nunca sai para preposto). ' +
      'Os nomes ficam salvos por usuário.',
    data_lancamento: '2026-10-06',
  },
  {
    versao: '1.1.3.173',
    tipo: 'MELHORIA',
    titulo: 'Impressão do pedido: linha entre os itens e observação no topo',
    descricao:
      'Em Configurar modelo de impressão há duas novas opções: «Linha divisória entre os itens» e «Observação no topo» (logo abaixo dos dados do cliente). ' +
      'Ambas ficam desligadas por padrão, cada usuário/impressão escolhe a sua.',
  },
  {
    versao: '1.1.3.173',
    tipo: 'MELHORIA',
    titulo: 'Relatório do pedido: «Fornecedor / Cod. Nº» mostra o código (ID) do fornecedor',
    descricao:
      'A linha «Fornecedor / Cod. Nº» do relatório do pedido (opção em Configurar modelo de impressão) agora imprime o código (ID) do fornecedor do pedido, ' +
      'identificando a fábrica sem expor o nome.',
    data_lancamento: '2026-10-03',
  },
  {
    versao: '1.1.3.173',
    tipo: 'MELHORIA',
    titulo: 'Impressão do pedido: tipo e tamanho da letra, e dados da empresa com cores',
    descricao:
      'Em Configurar modelo de impressão agora é possível escolher o tipo de letra (Arial, Georgia, Courier etc.) e o tamanho de todo o relatório (de 85% a 130%), além de um tamanho próprio para a tabela de itens e as cores do número do pedido e do cabeçalho da tabela. ' +
      'O bloco «Dados da empresa no topo» ficou compacto (CNPJ/I.E. e contatos na mesma linha, endereço abaixo). ' +
      'Em Configurar modelo de impressão agora é possível escolher a cor da letra e a cor do fundo desse bloco.',
    data_lancamento: '2026-10-03',
  },
  {
    versao: '1.1.3.173',
    tipo: 'BUG',
    titulo: 'Comissões: botão Fechar do relatório volta para a Gestão',
    descricao:
      'Na página Relatório de Conferência, o botão Fechar (X) levava para o Analytics de Comissões e não havia como voltar à Gestão sem fechar a aba. ' +
      'Agora volta para a tela de onde o relatório foi aberto (Gestão ou Analytics) ou fecha a aba, se foi aberto direto pelo menu. ' +
      'A barra de filtros do Relatório de Conferência foi refeita (campos sem cortar datas e opções) e os botões ganharam texto e o mesmo tamanho. ' +
      'Ao voltar à Gestão, os filtros, a lista e a posição da rolagem são restaurados sem refazer a consulta. A janela do novo Relatório / PDF da Gestão ganhou botões Imprimir e Fechar e a opção «Mostrar colunas» (Vlr parcela e Dt. pagto saem por padrão; a Dt. pagto já vem marcada nos relatórios de pagas).',
    data_lancamento: '2026-10-03',
  },
  {
    versao: '1.1.3.173',
    tipo: 'MELHORIA',
    titulo: 'Gestão de Comissões: grade em destaque e botão Quitar novo',
    descricao:
      'A grade agora ocupa a altura da tela, com cabeçalho fixo e rolagem só nela (linhas alternadas e mais compactas). ' +
      'O botão Ocultar/Mostrar filtros passou a funcionar e lembra a escolha. O campo Cliente ganhou largura para não cortar o nome ' +
      'e o botão Quitar virou um botão verde com ✓.',
    data_lancamento: '2026-10-03',
  },
  {
    versao: '1.1.3.173',
    tipo: 'NOVO',
    titulo: 'Relatório do pedido: dados da empresa no topo (opcional)',
    descricao:
      'Em Configurar modelo de impressão → Informações do pedido, a opção «Dados da empresa no topo» imprime, de forma discreta abaixo do título, ' +
      'CNPJ, inscrição estadual, endereço, telefones e e-mail da empresa (cadastro de Empresas). Vem desligada; cada usuário escolhe.',
    data_lancamento: '2026-10-02',
  },
  {
    versao: '1.1.3.173',
    tipo: 'NOVO',
    titulo: 'Relatório do pedido: Fornecedor / Cod. Nº e Peso Total (KG)',
    descricao:
      'Em Configurar modelo de impressão → Totais, duas opções para o rodapé do relatório/PDF: «Fornecedor / Cod. Nº» (código do cliente na fábrica, cadastrado no cliente em Representadas) ' +
      'e «Peso Total (KG)», no formato Peso Total - KG: 6.000,00. O peso total passou a sair com vírgula decimal (antes saía como 310.000 para 310 kg).',
    data_lancamento: '2026-10-02',
  },
  {
    versao: '1.1.3.173',
    tipo: 'NOVO',
    titulo: 'Pedidos: colunas Kilos, Valor/KG e Valor/Saca no relatório e PDF',
    descricao:
      'Em Colunas dos itens, as colunas Peso Total (Kilos), Valor Kilo e a nova Valor por Embalagem (Saca) agora aparecem na impressão/PDF quando marcadas em «No relatório», ' +
      'na ordem escolhida. O painel foi redesenhado (tabela única, busca, «Só marcadas», atalho «Preço por peso» e paginação automática conforme a altura da tela, sem barra de rolagem). ' +
      'Colunas já controladas pelo modelo de impressão ficam com a caixa desabilitada, explicando o motivo.',
    data_lancamento: '2026-10-02',
  },
  {
    versao: '1.1.3.173',
    tipo: 'BUG',
    titulo: 'Clonar pedido: itens com grade agora mantêm os tamanhos',
    descricao:
      'Ao clonar um pedido com produto de grade, o sistema acusava «exige grade» ao salvar e era preciso excluir e incluir o item de novo. ' +
      'Agora o clone copia as quantidades por tamanho junto com o item.',
    data_lancamento: '2026-10-02',
  },
  {
    versao: '1.1.3.173',
    tipo: 'NOVO',
    titulo: 'Comissões: relatório de comissões a pagar / pagas (PDF)',
    descricao:
      'Na tela Comissões, o botão Relatório / PDF gera o relatório agrupado por representante, com subtotal e total geral. ' +
      'Status «A pagar» = comissões pendentes; «Pagas» = pago + conferido, com a data do pagamento. ' +
      'Novo campo «Período por» permite filtrar as datas pelo lançamento ou pela data do pagamento. Também é possível filtrar por Fábrica e por Cliente (busca com sugestões enquanto digita, estilo Google), e os cartões de totais acompanham esses filtros. No relatório, a coluna Vencimento foi substituída por «Valor da fatura» (valor faturado da nota), ao lado da data da «Fatura», e o campo Pedido mostra só o número, sem a parcela (ex.: 1/4).',
    data_lancamento: '2026-10-02',
  },
  {
    versao: '1.1.3.173',
    tipo: 'MELHORIA',
    titulo: 'Comissão por faturamento: imprimir / PDF do relatório',
    descricao:
      'Os botões Imprimir / PDF e CSV agora ficam visíveis em uma linha própria. ' +
      'O relatório impresso (A4 paisagem) traz período, fábrica, representante, totais e data de emissão, ' +
      'tanto na Conferência de Fábricas quanto na Comissão dos Representantes. Para PDF, escolha «Salvar como PDF» na impressão.',
    data_lancamento: '2026-10-02',
  },
  {
    versao: '1.1.3.173',
    tipo: 'MELHORIA',
    titulo: 'Comissão por faturamento: acompanhar a aplicação',
    descricao:
      'Ao clicar em Aplicar nos já faturados, a tela mostra quantos pedidos foram encontrados e o andamento, pedido a pedido. ' +
      'No fim, a lista deixa o filtro deste mês e mostra os faturamentos convertidos. ' +
      'Se já tinha aplicado, o segundo clique avisa e abre essa lista.',
    data_lancamento: '2026-10-01',
  },
  {
    versao: '1.1.3.172',
    tipo: 'NOVO',
    titulo: 'Reverter comissão nos pedidos já faturados',
    descricao:
      'Em Financeiro → Comissão por Faturamento, o administrador usa Reverter aplicação se tiver aplicado o modelo por engano. ' +
      'O pedido volta à comissão por parcela, desde que a comissão da nota ainda não tenha sido baixada.',
    data_lancamento: '2026-10-01',
  },
  {
    versao: '1.1.3.171',
    tipo: 'NOVO',
    titulo: 'Comissão por faturamento nos pedidos já faturados',
    descricao:
      'Em Financeiro → Comissão por Faturamento, o administrador usa Aplicar nos já faturados. ' +
      'Os pedidos que já tinham nota passam para a comissão por NF, sem baixar o estoque de novo. ' +
      'Pedido com comissão já baixada não é alterado.',
    data_lancamento: '2026-10-01',
  },
  {
    versao: '1.1.3.170',
    tipo: 'MELHORIA',
    titulo: 'Pedidos: aviso enquanto o pedido abre',
    descricao:
      'Ao usar Abrir no Pedidos na Carteira, a tela já entra no pedido com a mensagem Abrindo pedido…, ' +
      'em vez de ficar na lista até os dados carregarem.',
    data_lancamento: '2026-10-01',
  },
  {
    versao: '1.1.3.169',
    tipo: 'BUG',
    titulo: 'Carteira: Abrir no Pedidos mostra o pedido',
    descricao:
      'Abrir no Pedidos na Carteira Operacional mudava para a lista e o pedido ficava fora da área visível da aba. ' +
      'Agora o formulário desse pedido abre na tela de Pedidos, ocupando a aba.',
    data_lancamento: '2026-10-01',
  },
  {
    versao: '1.1.3.168',
    tipo: 'BUG',
    titulo: 'Carteira: Visualizar mostra o pedido na hora',
    descricao:
      'Visualizar, Imprimir e PDF na Carteira Operacional abriam a lista de Pedidos e o documento ficava escondido. ' +
      'Agora a folha do pedido aparece por cima da carteira, com Fechar para voltar.',
    data_lancamento: '2026-10-01',
  },
  {
    versao: '1.1.3.167',
    tipo: 'MELHORIA',
    titulo: 'Carteira: pedido completo e impressão igual à tela de Pedidos',
    descricao:
      'Ao clicar no número na Carteira Operacional, o painel mostra cliente, comercial, logística, valores, todos os itens, parcelas e observação. ' +
      'Visualizar, Imprimir e PDF usam a mesma rotina da tela de Pedidos. Os tamanhos da grade só aparecem quando a opção de grade está ativa.',
    data_lancamento: '2026-10-01',
  },
  {
    versao: '1.1.3.166',
    tipo: 'BUG',
    titulo: 'Pedidos: último filtro avançado permanece ao reabrir',
    descricao:
      'As datas De/Até (e vendedor ou fábrica) aplicadas em Filtros Avançados deixavam de valer ao sair e voltar na lista, ' +
      'porque o período da barra recolocava os últimos 30 dias. Agora o intervalo que você aplicou é o que a lista usa na próxima vez.',
    data_lancamento: '2026-09-30',
  },
  {
    versao: '1.1.3.166',
    tipo: 'BUG',
    titulo: 'Carteira Operacional: abre o pedido que você clicou',
    descricao:
      'No mapa de compras, clicar no número abria outro pedido (ou o que já estava na aba Pedidos). ' +
      'O atalho passa a abrir exatamente o pedido da linha, inclusive em Abrir no Pedidos.',
    data_lancamento: '2026-09-30',
  },
  {
    versao: '1.1.3.165',
    tipo: 'NOVO',
    titulo: 'Comissão por faturamento (1 comissão por NF + repasse ao representante)',
    descricao:
      'Para empresas habilitadas (CNPJ em Configuração do Sistema), a comissão passa a nascer no faturamento: ' +
      'valor efetivamente faturado × % (editável no faturamento), em uma única linha na data da NF — sem dividir pelas parcelas. ' +
      'A diferença entre pedido e faturado pode ser Cancelada ou mantida como Saldo para a próxima fatura, e a comissão é dividida ' +
      'entre escritório e representante (padrão 30/70). Novo relatório em Financeiro › Comissão por Faturamento (conferência com as fábricas e comissão dos representantes).',
    data_lancamento: '2026-09-29',
  },
  {
    versao: '1.1.3.160',
    tipo: 'BUG',
    titulo: 'Produto: Mark-up Líquido calculado sobre o preço de venda',
    descricao:
      'O Mark-up Líquido (%) no cadastro de produto usava o custo como base e podia ficar maior que a margem. ' +
      'Agora é o lucro líquido (venda − custo − comissão) dividido pelo valor de venda. Ex.: custo 47,00 e venda 79,90 = 41,18%.',
    data_lancamento: '2026-09-28',
  },
  {
    versao: '1.1.3.160',
    tipo: 'MELHORIA',
    titulo: 'Produto: Margem (%) calculada sobre o preço de venda',
    descricao:
      'No cadastro de produto, a Margem (%) agora é aplicada sobre a venda: Vlr. Venda = Custo final ÷ (1 − Margem%). ' +
      'Ex.: custo 47,00 e margem 41,18% = venda 79,90. Antes era aplicada sobre o custo (mark-up).',
    data_lancamento: '2026-09-28',
  },
  {
    versao: '1.1.3.160',
    tipo: 'BUG',
    titulo: 'Pedido: cor do cadastro aparece na grade de itens',
    descricao:
      'Itens cuja cor está no cadastro do produto (Cor) não mostravam essa cor na grade do pedido. ' +
      'A grade passa a exibir a cor do produto quando o campo Cores do item está vazio.',
    data_lancamento: '2026-09-28',
  },
  {
    versao: '1.1.3.160',
    tipo: 'NOVO',
    titulo: 'Pedido: referência da mãe nas cores',
    descricao:
      'No cadastro da fábrica (Preferências), ligue «Pedidos — referência da mãe nas cores». ' +
      'Na tela e no PDF do pedido, as cores do mesmo modelo passam a mostrar o Cód. Fabricante da referência mãe — em vez de um código diferente por cor. O cadastro e o XML da fábrica continuam com o código de cada SKU.',
    data_lancamento: '2026-09-24',
  },
  {
    versao: '1.1.3.160',
    tipo: 'MELHORIA',
    titulo: 'Showroom: carrinho mais claro no celular',
    descricao:
      'A tela do carrinho ganhou cards com foto, grade em chips e barra fixa com Limpar e Continuar em botões grandes — fácil de usar no celular e no desktop.',
    data_lancamento: '2026-09-24',
  },
  {
    versao: '1.1.3.160',
    tipo: 'BUG',
    titulo: 'Showroom: Limpar carrinho não “volta” mais',
    descricao:
      'O Limpar do carrinho às vezes parecia funcionar e os itens reapareciam (cópia antiga no navegador). ' +
      'Agora limpa de um toque e apaga todas as cópias salvas neste aparelho.',
    data_lancamento: '2026-09-24',
  },
  {
    versao: '1.1.3.158',
    tipo: 'BUG',
    titulo: 'Showroom: cores não vêm mais todas marcadas',
    descricao:
      'No «Escolher cores» (grade fechada), todas as cores abriam já marcadas com o pack preenchido e a cesta somava quantidades enormes. ' +
      'Agora as cores começam desmarcadas; ao marcar uma, o pack preenche só nela. Desmarcar zera a quantidade daquela cor.',
    data_lancamento: '2026-09-24',
  },
  {
    versao: '1.1.3.158',
    tipo: 'MELHORIA',
    titulo: 'Showroom: cor do produto pai também aparece',
    descricao:
      'Quando a referência mãe tem Cor preenchida e está disponível para venda, ela entra como a primeira opção em «Escolher cores» (Showroom/pedido), junto com as cores filhas. ' +
      'Ex.: Pink no pai + 5 filhos = 6 cores no picker. O cadastro continua listando só as cores filhas em «Cores (N)».',
    data_lancamento: '2026-09-22',
  },
  {
    versao: '1.1.3.158',
    tipo: 'MELHORIA',
    titulo: 'Lista de pedidos: colunas Cidade e Estado',
    descricao:
      'Na grade de Pedidos (COLUNAS E ORDEM) dá para exibir Cidade e Estado do cliente. ' +
      'As colunas vêm ligadas por padrão; dá para ocultar ou reordenar como as demais.',
    data_lancamento: '2026-09-22',
  },
  {
    versao: '1.1.3.157',
    tipo: 'MELHORIA',
    titulo: 'Modelo de impressão: opção Previsão',
    descricao:
      'Em Configurar modelo de impressão há o checkbox Previsão. Com ele marcado, o texto da aba Entrega ' +
      'aparece no cabeçalho do PDF (só se estiver preenchido).',
    data_lancamento: '2026-09-22',
  },
  {
    versao: '1.1.3.157',
    tipo: 'NOVO',
    titulo: 'Pedido: campo Previsão na aba Entrega',
    descricao:
      'Na aba Entrega há o campo texto Previsão (livre). Se preenchido, o texto aparece no cabeçalho da impressão/PDF do pedido, ' +
      'junto com fábrica, comprador e demais dados. A Previsão de Entrega (data) continua separada.',
    data_lancamento: '2026-09-22',
  },
  {
    versao: '1.1.3.156',
    tipo: 'MELHORIA',
    titulo: 'Lista de pedidos: busca por cidade, UF e CNPJ',
    descricao:
      'Na barra de busca da tela de Pedidos você também encontra pedidos digitando a cidade, o estado (UF) ' +
      'ou o CNPJ/CPF do cliente (com ou sem pontuação), além do número e do nome.',
    data_lancamento: '2026-09-22',
  },
  {
    versao: '1.1.3.155',
    tipo: 'BUG',
    titulo: 'Impressão de grade: ordem P/M/G/GG correta',
    descricao:
      'No relatório do pedido com cabeçalho único, tamanhos em letra saíam em ordem alfabética (G, GG, M, P). ' +
      'Agora seguem a ordem de confecção (P, M, G, GG); grades numéricas continuam 44, 46, 48… antes das letras.',
    data_lancamento: '2026-09-22',
  },
  {
    versao: '1.1.3.149',
    tipo: 'BUG',
    titulo: 'Showroom: Limpar carrinho sem travar no celular',
    descricao:
      'No carrinho do Showroom (celular), o botão Limpar abria um aviso que piscava e travava a tela. ' +
      'Agora basta tocar Limpar e de novo em Confirmar. Os botões do rodapé também ficaram menores.',
    data_lancamento: '2026-09-22',
  },
  {
    versao: '1.1.3.149',
    tipo: 'MELHORIA',
    titulo: 'Showroom no celular: tela limpa sem Início por cima',
    descricao:
      'No app celular, ao abrir o Showroom some a barra Início/Voltar (não cobre mais os botões). ' +
      'No modal Escolher cores, o rodapé ficou compacto: ações secundárias numa linha e Cancelar + Adicionar lado a lado.',
    data_lancamento: '2026-09-22',
  },
  {
    versao: '1.1.3.149',
    tipo: 'BUG',
    titulo: 'Showroom: limpar carrinho não traz o número de volta',
    descricao:
      'O número na sacola do Showroom é a quantidade total de unidades (ex.: pack 12 da grade fechada), não a quantidade de produtos. ' +
      'Ao limpar o carrinho, o valor às vezes voltava por causa de chave antiga no aparelho — agora a limpeza remove de verdade e o badge some.',
    data_lancamento: '2026-09-22',
  },
  {
    versao: '1.1.3.149',
    tipo: 'BUG',
    titulo: 'Showroom: aviso de grade fechada sem travar a tela',
    descricao:
      'No celular, ao adicionar cores com quantidade fora do múltiplo da grade fechada, um aviso «Grade fechada» piscava e a tela ficava travada. ' +
      'Agora o aviso aparece dentro do próprio modal (destaca a cor), dá para ajustar ou cancelar sem perder o fluxo.',
    data_lancamento: '2026-09-22',
  },
  {
    versao: '1.1.3.149',
    tipo: 'BUG',
    titulo: 'Showroom no celular: adicionar cores ao carrinho',
    descricao:
      'No celular, ao abrir «Escolher cores» a grade já vinha preenchida mas o botão Adicionar ao carrinho não fazia nada (cores sem marcar). ' +
      'Agora as cores com quantidade entram no carrinho, dá para fechar com X/Cancelar e o fluxo volta à lista com o carrinho atualizado.',
    data_lancamento: '2026-09-22',
  },
  {
    versao: '1.1.3.149',
    tipo: 'BUG',
    titulo: 'Showroom no celular: toque abre as cores',
    descricao:
      'No app/celular, tocar numa referência do Showroom às vezes não abria o modal «Escolher cores» (ficava na capa). ' +
      'Corrigido o conflito com o ajuste de modais do mobile e o feedback imediato ao tocar.',
    data_lancamento: '2026-09-22',
  },
  {
    versao: '1.1.3.149',
    tipo: 'BUG',
    titulo: 'Pedido para fábrica: só custo, sem valor de venda',
    descricao:
      'No modal Imprimir / Enviar, ao marcar «Pedido para fábrica (só custo)», o PDF/visualização deixa de mostrar a coluna VALOR (preço de venda). ' +
      'Ficam só Custo unitário e Total da linha = Qtde × Custo; o Total do Pedido no rodapé também usa o custo. ' +
      'A impressão comercial (checkbox desligado) continua igual, com valor de venda.',
    data_lancamento: '2026-09-21',
  },
  {
    versao: '1.1.3.148',
    tipo: 'NOVO',
    titulo: 'Impressão: opção de incluir preço de custo',
    descricao:
      'No modal Imprimir / Enviar do pedido há um checkbox «Incluir preço de custo» (desligado por padrão). ' +
      'Quando marcado, a visualização/PDF mostra a coluna Custo (do cadastro do produto) e o Total Custo — útil para passar o pedido à fábrica, sem alterar o documento comercial padrão.',
    data_lancamento: '2026-09-21',
  },
  {
    versao: '1.1.3.147',
    tipo: 'MELHORIA',
    titulo: 'Novo pedido: link já abre como ORÇAMENTO (?tipo=orcamento)',
    descricao:
      'A tela de novo pedido aceita o parâmetro «tipo» no endereço (…/pages/pedidos.html?novo=1&cliente_id=…&tipo=orcamento). ' +
      'Quando a empresa deixa escolher o tipo, o documento já abre como ORÇAMENTO (ou PEDIDO) — usado pelo botão «Criar orçamento no SysRepWeb» do CRM. ' +
      'Sem o parâmetro, ou quando a empresa fixa o tipo, nada muda.',
    data_lancamento: '2026-09-21',
  },
  {
    versao: '1.1.3.147',
    tipo: 'BUG',
    titulo: 'Escolher cores: cards não se sobrepõem mais',
    descricao:
      'Corrigido o layout da tela «Escolher cores»: os cards de cor estavam empilhados uns sobre os outros. Agora cada cor fica em seu próprio card (com tipo de grade e numeração), sem sobreposição.',
    data_lancamento: '2026-09-21',
  },
  {
    versao: '1.1.3.147',
    tipo: 'MELHORIA',
    titulo: 'Escolher cores: tipo da grade e numeração no card',
    descricao:
      'Nos cards de «Escolher cores» (Showroom/pedido) a legenda mostra o tipo da grade (ex. Feminina) e a faixa de numeração (ex. 34–39). Ao marcar a cor, os tamanhos abrem limpos abaixo.',
    data_lancamento: '2026-09-21',
  },
  {
    versao: '1.1.3.144',
    tipo: 'MELHORIA',
    titulo: 'Pedido: mais opções em Forma Pagto',
    descricao:
      'No combo Forma Pagto Padrão (e nas parcelas) agora há também Dinheiro, Cheque, Cheque Pré-datado, A Prazo/Carteira e Outros — além de Boleto, PIX, Cartão e Depósito/TED.',
    data_lancamento: '2026-09-21',
  },
  {
    versao: '1.1.3.140',
    tipo: 'MELHORIA',
    titulo: 'Escolher cores: fotos maiores em grade responsiva',
    descricao:
      'No Showroom e no pedido, a tela «Escolher cores» passou a exibir as cores em cards com foto grande, ' +
      'em colunas que se adaptam à largura da tela (celular 2 colunas; desktop várias). ' +
      'Ao marcar uma cor com grade, o card abre em destaque para informar os tamanhos.',
    data_lancamento: '2026-09-21',
  },
  {
    versao: '1.1.3.140',
    tipo: 'BUG',
    titulo: 'Pedido: mesma referência com grades diferentes fica em linhas separadas',
    descricao:
      'Ao pedir a mesma referência em grade feminina e masculina (ex.: 34–39 e 38–43), o sistema somava tudo numa linha só e “esticava” a numeração. ' +
      'Agora cada tipograde vira uma linha no pedido. Só soma quantidade se for o mesmo produto e a mesma grade.',
    data_lancamento: '2026-09-21',
  },
  {
    versao: '1.1.3.140',
    tipo: 'NOVO',
    titulo: 'WhatsApp: API oficial da Meta (Cloud API) como provedor opcional',
    descricao:
      'Em Configurações de API o provedor de envio agora pode ser «Meta — WhatsApp Cloud API», ao lado do EuAtendo e da Evolution API. ' +
      'Informe Phone Number ID e token permanente e use «Testar Conexão» (o selo «Meta liberada» confirma). ' +
      'Fora da janela de 24h da Meta, o sistema reenvia sozinho pelo modelo aprovado cadastrado. ' +
      'Vale para mensagens, PDF do pedido e Campanhas WhatsApp; clientes que não usam a Meta não mudam nada.',
    data_lancamento: '2026-09-21',
  },
  {
    versao: '1.1.3.140',
    tipo: 'BUG',
    titulo: 'Pedido: ordem das colunas de grade (ex. masc + fem)',
    descricao:
      'Na visualização/impressão do pedido, quando havia tamanhos numéricos de grades cruzadas (ex.: 34–39 e 38–43), ' +
      'o cabeçalho ficava 38…43 e só depois 34…37. Agora a ordem é sempre natural (34…43). ' +
      'O pack e as quantidades por tamanho não mudam. Grades em letra (P/M/G) continuam pelo sequencial do cadastro.',
    data_lancamento: '2026-09-19',
  },
  {
    versao: '1.1.3.140',
    tipo: 'MELHORIA',
    titulo: 'Showroom: escolha quais fábricas aparecem',
    descricao:
      'A seção Fábricas do Showroom deixa de listar todas as fábricas ativas. ' +
      'No cadastro do fornecedor (Preferências), marque «Aparece no Showroom» só nas fábricas que quiser liberar. ' +
      'Coleções (Catálogos Visuais) e tabelas com «Aparece no Showroom» continuam independentes.',
    data_lancamento: '2026-09-17',
  },
  {
    versao: '1.1.3.140',
    tipo: 'BUG',
    titulo: 'Showroom: cores abrem e não fecham sozinhas',
    descricao:
      'Ao tocar numa referência com várias cores no Showroom, o modal «Escolher cores» abria atrás da tela e sumia em poucos segundos. ' +
      'Agora o modal fica na frente e permanece aberto até você cancelar ou adicionar ao carrinho.',
    data_lancamento: '2026-09-17',
  },
  {
    versao: '1.1.3.140',
    tipo: 'BUG',
    titulo: 'Escolher cores: pack da grade fechada e qtd total',
    descricao:
      'Ao trocar a grade fechada, o pack (qtds mínimas) passa a carregar na hora. ' +
      'Há o campo «Qtd total» (ex.: 24) para multiplicar o pack. ' +
      '«Incluir todas as grades» só envia as demais grades se você clicar no botão — senão vai só a grade escolhida no combo.',
    data_lancamento: '2026-09-17',
  },
  {
    versao: '1.1.3.140',
    tipo: 'BUG',
    titulo: 'Pedido: várias grades do produto voltam a aparecer',
    descricao:
      'Quando o produto tinha Grade principal + Outras grades, o pedido às vezes mostrava só uma. ' +
      'Agora lista todas; no painel de item e no modal Configurar Grade dá para trocar de grade; ' +
      'no cadastro do produto as outras grades são checkboxes (mais fácil de marcar).',
    data_lancamento: '2026-09-17',
  },
  {
    versao: '1.1.3.140',
    tipo: 'MELHORIA',
    titulo: 'Produtos: cadastrar auxiliar sem sair da tela',
    descricao:
      'Nos combos Família, Grupo, Categoria, Subfamília, Local de Armazenamento, Tipo de Grade e Grade principal, ' +
      'o botão «+» abre um cadastro rápido. Ao salvar, o item entra no combo e já fica selecionado — sem atualizar a página.',
    data_lancamento: '2026-09-17',
  },
  {
    versao: '1.1.3.136',
    tipo: 'MELHORIA',
    titulo: 'Escolher cores: melhor no celular e tablet',
    descricao:
      'O modal de cores no pedido ficou adaptado para tela pequena: no celular abre em tela cheia, no tablet sobe como painel. ' +
      'Checkbox e campos de tamanho ficam maiores para o dedo, e o teclado do iPhone não dá zoom ao digitar a quantidade.',
    data_lancamento: '2026-09-17',
  },
  {
    versao: '1.1.3.136',
    tipo: 'MELHORIA',
    titulo: 'Pedido: escolher só as cores que quiser',
    descricao:
      'No modal «Escolher cores» (referência com várias cores), cada cor tem um checkbox ao lado. ' +
      'Marque só as que vão para o pedido — o botão Adicionar não leva mais todas automaticamente. ' +
      'Dá para marcar/desmarcar pelo checkbox, pela foto ou pelo nome; use Marcar todas / Limpar no rodapé.',
    data_lancamento: '2026-09-17',
  },
  {
    versao: '1.1.3.136',
    tipo: 'BUG',
    titulo: 'Produtos: X da foto e Cancelar voltam a responder',
    descricao:
      'Ao clicar no X para remover uma foto (ou em Cancelar no cadastro), às vezes nada acontecia: o diálogo de confirmação ficava preso e bloqueava os cliques. ' +
      'Agora a confirmação abre na tela e a exclusão da foto funciona; Cancelar fecha o formulário normalmente.',
    data_lancamento: '2026-09-17',
  },
  {
    versao: '1.1.3.136',
    tipo: 'BUG',
    titulo: 'Manutenção de Comissões: ajuste abre no centro da tela',
    descricao:
      'Ao clicar em Ajustar valor/percentual, o formulário abre no centro da área visível. ' +
      'Antes o fundo ficava escuro e o formulário aparecia no fim da lista, sem conseguir usar.',
    data_lancamento: '2026-09-16',
  },
  {
    versao: '1.1.3.136',
    tipo: 'MELHORIA',
    titulo: 'Produtos: escolher colunas da lista',
    descricao:
      'Na listagem de produtos, o botão Colunas (ao lado de Fotos) abre as mesmas opções do cadastro: preços, estoque, impostos, grade, família e outros. ' +
      'A escolha fica salva por usuário. O CSV exporta as colunas visíveis. Checkbox, número da linha e Ações continuam sempre na tela.',
    data_lancamento: '2026-09-16',
  },
  {
    versao: '1.1.3.136',
    tipo: 'MELHORIA',
    titulo: 'Produtos: arrastar foto para a galeria',
    descricao:
      'Na aba Fotos do cadastro, além de Ctrl+V, dá para arrastar as imagens da pasta do computador (ou do explorador) e soltar na área da galeria. ' +
      'O produto precisa estar salvo. Também funciona no importar fotos em lote.',
    data_lancamento: '2026-09-16',
  },
  {
    versao: '1.1.3.136',
    tipo: 'BUG',
    titulo: 'Pedido: todas as grades não misturam na mesma linha',
    descricao:
      'Ao incluir todas as grades (no Escolher cores ou no item), cada grade da mesma cor fica em uma linha. ' +
      'Antes o modo Somar da fábrica juntava tudo num item só, e parecia que só veio a grade visível.',
    data_lancamento: '2026-09-16',
  },
  {
    versao: '1.1.3.136',
    tipo: 'MELHORIA',
    titulo: 'Escolher cores: botão incluir todas as grades',
    descricao:
      'No modal Escolher cores (referência com várias cores), quando o produto tem 2 ou mais grades, o botão «Incluir todas as grades» aparece no rodapé. ' +
      'Com ele ligado, cada cor entra no pedido com o pack de cada grade — sem precisar trocar uma a uma.',
    data_lancamento: '2026-09-16',
  },
  {
    versao: '1.1.3.136',
    tipo: 'MELHORIA',
    titulo: 'Pedido: incluir todas as grades de uma vez',
    descricao:
      'Quando o produto tem 2 ou mais grades, no item aparece o botão «Incluir todas as grades». ' +
      'Cada grade vira um item. Grades fechadas já entram com o pack da coluna Mín.; o fluxo de uma grade por vez continua igual.',
    data_lancamento: '2026-09-16',
  },
  {
    versao: '1.1.3.136',
    tipo: 'BUG',
    titulo: 'Produtos: remover foto no endereço da nuvem (DNS)',
    descricao:
      'No site publicado (ex.: tupa.nresolutions.com.br) a exclusão da foto falhava ou a imagem voltava. ' +
      'Agora a remoção usa o mesmo fluxo da nuvem e do local: apaga galeria e foto principal, inclusive URL completa.',
    data_lancamento: '2026-09-16',
  },
  {
    versao: '1.1.3.135',
    tipo: 'MELHORIA',
    titulo: 'Clientes: filtrar por status (ativo/inativo)',
    descricao:
      'Nos Filtros Avançados da tela de Clientes, dá para filtrar por Ativo ou Inativo. ' +
      'O combo fica sincronizado com os cards Total/Ativos/Inativos e também entra nos favoritos.',
    data_lancamento: '2026-09-15',
  },
  {
    versao: '1.1.3.135',
    tipo: 'MELHORIA',
    titulo: 'Clientes: filtrar por vendedor',
    descricao:
      'Nos Filtros Avançados da tela de Clientes, agora dá para escolher o vendedor e listar só a carteira dele. ' +
      'O filtro entra no badge, nos favoritos e funciona junto com os demais (cidade, segmento, sem compra, etc.).',
    data_lancamento: '2026-09-15',
  },
  {
    versao: '1.1.3.132',
    tipo: 'MELHORIA',
    titulo: 'Escolher cores: quantidades por tamanho (grade)',
    descricao:
      'No pedido e no Showroom, ao selecionar um produto pai com cores e grade, o formulário «Escolher cores» ' +
      'passa a mostrar os tamanhos de cada cor (e o seletor se houver 2+ grades). Cada cor entra no pedido já com a grade preenchida. ' +
      'Produto sem grade continua com o campo de quantidade simples.',
    data_lancamento: '2026-09-14',
  },
  {
    versao: '1.1.3.132',
    tipo: 'NOVO',
    titulo: 'Produto com várias grades (ex.: 34–39 e 38–43)',
    descricao:
      'No cadastro do produto, além da grade principal, dá para marcar outras grades opcionais. ' +
      'No pedido e no Showroom, se o produto tiver 2 ou mais grades, aparece um seletor para escolher qual usar. ' +
      'Com uma grade só, o fluxo continua igual — nada muda.',
    data_lancamento: '2026-09-14',
  },
  {
    versao: '1.1.3.132',
    tipo: 'NOVO',
    titulo: 'Pedido: escolher várias cores do mesmo SKU',
    descricao:
      'Ao selecionar um produto pai com variações de cor, abre um formulário para informar a quantidade de cada cor. ' +
      'Cada cor entra como uma linha no pedido (ex.: 1.001 Verde, 1.001 Azul) e a cor aparece na impressão/PDF. ' +
      'Mesmo fluxo no Showroom e na Vitrine Digital.',
    data_lancamento: '2026-09-14',
  },
  {
    versao: '1.1.3.132',
    tipo: 'BUG',
    titulo: 'Produtos: exclusão de foto que «voltava» na galeria',
    descricao:
      'Corrigida a remoção de fotos na aba Fotos: o sistema agora usa o ID real da imagem, ' +
      'também remove pelo nome do arquivo e limpa o campo foto principal para a imagem não reaparecer. ' +
      'Reinicie o servidor e atualize a página (Ctrl+F5) antes de tentar de novo.',
    data_lancamento: '2026-09-15',
  },
  {
    versao: '1.1.3.132',
    tipo: 'MELHORIA',
    titulo: 'Grade fechada: pack sugerido no pedido',
    descricao:
      'Com a grade em modo Fechada (pack), as quantidades da coluna Mín. passam a ser ' +
      'sugeridas automaticamente ao incluir o produto no pedido. Grade aberta continua igual ' +
      '(sem preenchimento). Ao editar um item já lançado, as quantidades salvas são mantidas.',
    data_lancamento: '2026-09-14',
  },
  {
    versao: '1.1.3.132',
    tipo: 'BUG',
    titulo: 'Produtos: remoção de foto na aba Fotos',
    descricao:
      'Ao clicar em ✕ para remover uma foto do produto, o sistema acusava «Imagem não encontrada» ' +
      'porque a tela usava um identificador incorreto. Agora a exclusão usa o ID real da galeria e ' +
      'também remove fotos que existem só no campo URL / foto principal.',
    data_lancamento: '2026-09-14',
  },
  {
    versao: '1.1.3.132',
    tipo: 'BUG',
    titulo: 'Impressão de grade: sem duplicar tamanhos sobrepostos',
    descricao:
      'Quando o pedido mistura grades numéricas que se cruzam (ex.: 46–52 e 48–54), a impressão ' +
      'criava dois blocos e repetia as quantidades nos tamanhos em comum, confundindo a fábrica. ' +
      'Agora essas grades viram um único bloco unificado; grades sem tamanhos em comum (como P/M/G) ' +
      'continuam em colunas separadas.',
    data_lancamento: '2026-09-14',
  },
  {
    versao: '1.1.3.131',
    tipo: 'BUG',
    titulo: 'Produtos: coluna Tipo PAI/FILHO e vínculo visível na edição',
    descricao:
      'A lista de Produtos ganhou a coluna Tipo (PAI / FILHO). Na edição, a relação aparece na aba Geral: ' +
      'dá para marcar como pai ou filho, escolher o produto pai e ver as cores vinculadas. ' +
      'O vínculo passa a ser gravado de forma confiável ao salvar.',
    data_lancamento: '2026-09-13',
  },
  {
    versao: '1.1.3.129',
    tipo: 'MELHORIA',
    titulo: 'Ajuda Produtos: passo a passo interativo de cores',
    descricao:
      'Na ajuda de Produtos, a seção «Variações de cor» ganhou um roteiro interativo com checklist clicável, ' +
      'barra de progresso e resumo do fluxo (produto principal → SKU da cor → pedido).',
    data_lancamento: '2026-09-01',
  },
  {
    versao: '1.1.3.129',
    tipo: 'MELHORIA',
    titulo: 'Produtos: cadastro de cores mais simples',
    descricao:
      'O fluxo de variações de cor foi simplificado na aba Geral: pergunta «Tem variações de cor?», lista de cores ' +
      'e botão «+ Nova cor» no mesmo lugar. O campo Cor ficou ao lado do SKU. Após salvar o produto principal, ' +
      'o sistema oferece cadastrar a primeira cor na hora.',
    data_lancamento: '2026-09-01',
  },
  {
    versao: '1.1.3.129',
    tipo: 'MELHORIA',
    titulo: 'Showroom: tela de quantidade reorganizada',
    descricao:
      'A tela que abre ao adicionar o produto ao pedido esticava até o fim da janela, deixando um vazio grande no ' +
      'meio e jogando o total lá embaixo, longe do resto. Agora é um cartão do tamanho do conteúdo, com a foto do ' +
      'produto ao lado do nome, a referência e o preço por unidade logo abaixo. Os botões de quantidade ficaram ' +
      'maiores e o «−» deixou de ser vermelho, cor que o sistema usa para ações que apagam algo. ' +
      'O total ganhou destaque junto do botão de confirmar, e o campo de observação passou a mostrar um exemplo ' +
      'do que escrever. Quando o produto não tem preço na tabela em uso, o aviso é o mesmo da tela anterior.',
    data_lancamento: '2026-08-30',
  },
  {
    versao: '1.1.3.129',
    tipo: 'MELHORIA',
    titulo: 'Showroom: tela do produto mais clara na hora de vender',
    descricao:
      'A tela que mostra o produto ao cliente foi reorganizada. As opções do produto (tamanhos, cores) apareciam ' +
      'como códigos soltos — «9036, 9022, 9023» — e o vendedor precisava clicar em cada uma para descobrir qual era. ' +
      'Agora o botão mostra o que diferencia de fato, por exemplo «3,00 L», «7,00 L» e «10,00 L», com o código em ' +
      'letra menor embaixo. O topo da tela também mudou: o nome do produto virou o título e a referência ficou ' +
      'no subtítulo, junto com quantas opções existem — antes apareciam dois códigos diferentes sem explicar a relação. ' +
      'Quando o produto não tem preço na tabela em uso, o rodapé passa a avisar «Sem preço nesta tabela» em vez de ' +
      'mostrar R$ 0,00, que dava a impressão de estar de graça. Unidade, embalagem e código de barras agora ficam ' +
      'visíveis na tela, em vez de escondidos atrás de um botão sem rótulo — que foi removido. ' +
      'As miniaturas das fotos passaram para baixo da imagem principal, liberando largura para o produto, ' +
      'e o botão «Adicionar ao pedido» deixou de ocupar a tela inteira: agora tem tamanho normal, junto do preço, ' +
      'numa faixa centralizada logo abaixo da foto — antes ela flutuava por cima e podia cobrir o produto. ' +
      'No computador a tela inteira cabe sem rolagem; no celular o botão continua largo, para o toque.',
    data_lancamento: '2026-08-30',
  },
  {
    versao: '1.1.3.129',
    tipo: 'MELHORIA',
    titulo: 'Showroom: tela inicial mais limpa e com identidade',
    descricao:
      'A tela que abre o Showroom foi retrabalhada. Coleções, fábricas e tabelas sem foto de capa apareciam como ' +
      'retângulos de cor chapada, sem nada além do nome — agora trazem a inicial da marca ao fundo e um ícone que ' +
      'identifica o tipo, ficando com cara de catálogo. Os cards diminuíram de altura e cabem mais por linha, ' +
      'e o conteúdo ganhou largura máxima para não esticar em monitor grande: onde antes cabiam 4 por linha, ' +
      'agora cabem 6. As seções Coleções, Fábricas e Tabelas passam a ficar lado a lado quando cabem na tela — ' +
      'antes cada uma ocupava uma faixa inteira mesmo tendo um único item, deixando a tela vazia. ' +
      'A faixa verde de boas-vindas ficou fina e pode ser dispensada de vez, e o texto ' +
      '«Catálogo completo da fábrica», que se repetia em todos os cards, saiu — a seção já diz isso.',
    data_lancamento: '2026-08-30',
  },
  {
    versao: '1.1.3.129',
    tipo: 'MELHORIA',
    titulo: 'Vitrine Digital: menus de ordenação e exibição no visual do sistema',
    descricao:
      'Os campos «Ordem» e «Exibir» do catálogo usavam a lista suspensa padrão do navegador, desenhada pelo sistema ' +
      'operacional — por isso apareciam com visual cru, fora do tema e às vezes com cores estranhas no Windows. ' +
      'Agora abrem um menu no mesmo estilo do resto da vitrine, com a opção atual destacada, e acompanham corretamente ' +
      'os modos Dia e Noite. Fecham ao escolher, ao clicar fora ou com a tecla Esc.',
    data_lancamento: '2026-08-30',
  },
  {
    versao: '1.1.3.129',
    tipo: 'NOVO',
    titulo: 'Vitrine Digital: mínimo por fábrica, carrinho salvo e pedir de novo',
    descricao:
      'Três novidades na vitrine. 1) O carrinho não se perde mais: fica guardado no navegador do cliente, então ' +
      'fechar a aba, travar o celular ou cair a conexão não apaga o pedido que ele estava montando — ao voltar, ' +
      'o carrinho e a tabela de preços voltam como estavam, com os preços atualizados. ' +
      '2) Quando a tabela usa as regras da fábrica, o carrinho mostra em cada uma quanto falta para atingir o mínimo ' +
      'de faturamento, com barra de progresso, e avisa quando o mínimo foi alcançado. Antes o cliente só descobria ' +
      'que não tinha atingido o mínimo ao ser bloqueado na hora de enviar, depois de montar o pedido inteiro. ' +
      '3) No histórico, o botão «Pedir de novo» recria o carrinho com os itens de um pedido anterior, usando os preços ' +
      'atuais e avisando quais produtos saíram do catálogo — caminho rápido para quem repõe sempre o mesmo mix.',
    data_lancamento: '2026-08-30',
  },
  {
    versao: '1.1.3.129',
    tipo: 'MELHORIA',
    titulo: 'Vitrine Digital: carrinho no padrão das lojas online',
    descricao:
      'O carrinho da vitrine foi refeito para funcionar como o cliente já está acostumado nas lojas online. ' +
      'Cada item agora tem os botões de mais e menos para ajustar a quantidade ali mesmo — antes só dava para remover ' +
      'o produto inteiro e voltar ao catálogo para incluir de novo. Cada linha mostra o preço unitário e o subtotal ' +
      'daquele produto, em vez do texto corrido de antes. No topo aparece o resumo (quantos produtos e quantos itens) ' +
      'e um botão Limpar, que pede confirmação. Quando a lista continua além da tela, a base desvanece indicando que ' +
      'há mais itens abaixo. Produtos vendidos por embalagem fechada mostram o múltiplo na linha. ' +
      'Para carrinhos grandes: os itens são separados por fábrica com o subtotal de cada uma, e o carrinho avisa ' +
      'quando o pedido vai se dividir — a vitrine gera um pedido para cada fábrica, e isso antes só aparecia depois ' +
      'de enviar. Acima de 10 produtos surge uma busca para achar o item sem rolar a lista toda, e o campo de ' +
      'observação começa recolhido, sobrando mais espaço para os produtos. Cada linha ficou mais enxuta: cabem ' +
      'cerca de 40% mais itens na tela do que na primeira versão.',
    data_lancamento: '2026-08-30',
  },
  {
    versao: '1.1.3.129',
    tipo: 'BUG',
    titulo: 'Lista de pedidos: «CÓD: null» em visitantes da vitrine',
    descricao:
      'Pedidos da vitrine/showroom sem cliente cadastrado passam a exibir «Visitante · sem cadastro» na listagem, em vez do texto «CÓD: null».',
    data_lancamento: '2026-08-30',
  },
  {
    versao: '1.1.3.129',
    tipo: 'MELHORIA',
    titulo: 'Pedido visitante: nome, banner e salvamento liberado',
    descricao:
      'Pedidos vindos da Vitrine Digital ou Showroom com visitante (sem cadastro) agora abrem com o nome no campo Cliente, ' +
      'banner orientando a vincular cadastro, parcela sugerida automaticamente e salvamento liberado enquanto o representante regulariza o cliente.',
    data_lancamento: '2026-08-30',
  },
  {
    versao: '1.1.3.129',
    tipo: 'MELHORIA',
    titulo: 'Produtos: foto do pai na listagem dos filhos',
    descricao:
      'No cadastro de Produtos, itens filhos (referência mãe) sem foto própria passam a exibir a imagem do produto pai na coluna Foto — ' +
      'incluindo galeria produto_imagens do pai.',
    data_lancamento: '2026-08-30',
  },
  {
    versao: '1.1.3.129',
    tipo: 'MELHORIA',
    titulo: 'Modo Apresentação: foto do pai nas variações',
    descricao:
      'No Modo Apresentação, variações (referência mãe) sem foto própria passam a exibir a imagem do produto pai — ' +
      'na tabela do catálogo e ao abrir o detalhe — igual à vitrine digital.',
    data_lancamento: '2026-08-30',
  },
  {
    versao: '1.1.3.129',
    tipo: 'MELHORIA',
    titulo: 'Vitrine: foto da referência mãe nos produtos filhos',
    descricao:
      'Variações (filhos) sem foto própria passam a exibir a imagem do produto pai na vitrine digital — ' +
      'no card e no carrossel de fotos — igual ao comportamento esperado de referência mãe/cor.',
    data_lancamento: '2026-08-30',
  },
  {
    versao: '1.1.3.129',
    tipo: 'MELHORIA',
    titulo: 'Vitrine digital: aviso quando o catálogo está vazio',
    descricao:
      'Se o link da vitrine abrir sem produtos, a tela agora explica o motivo: falta liberar tabela na vitrine, ' +
      'falta preço nos itens ou não há produtos ativos — em vez de só «Nenhum produto encontrado».',
    data_lancamento: '2026-08-30',
  },
  {
    versao: '1.1.3.129',
    tipo: 'MELHORIA',
    titulo: 'Modo Apresentação com layout de catálogo impresso',
    descricao:
      'A tela Apresentar agora replica o visual do catálogo de fábrica: faixa azul por linha, tabela com ' +
      'Cód., Nº, Cap., Medidas, Master e código de barras EAN desenhado — foto à esquerda e variantes à direita, ' +
      'como no PDF Fort-Lar.',
    data_lancamento: '2026-08-30',
  },
  {
    versao: '1.1.3.129',
    tipo: 'NOVO',
    titulo: 'Catálogo para visita: gerar linhas, fotos e apresentar',
    descricao:
      'Em Catálogos Visuais, use «Gerar linhas da fábrica» para montar um catálogo por grupo do produto, ' +
      '«Importar fotos» (nome do arquivo = código fabricante) e «Apresentar» no tablet — layout tabular ' +
      'como catálogo de fábrica, modo visita sem preço e busca rápida. Não altera pedidos nem vitrine.',
    data_lancamento: '2026-08-30',
  },
  {
    versao: '1.1.3.129',
    tipo: 'NOVO',
    titulo: 'Modo Apresentação — catálogo estilo visita comercial',
    descricao:
      'Novo modo para levar o tablet na visita ao cliente: layout tabular como catálogo de fábrica ' +
      '(foto, código, EAN, cor, master), agrupado por linha/grupo, com índice de coleções, busca rápida ' +
      'e «Modo visita» que oculta preços até você decidir mostrar. Acesse em Catálogos Visuais pelo botão Apresentar — ' +
      'não altera Vitrine, Showroom nem pedidos.',
    data_lancamento: '2026-08-30',
  },
  {
    versao: '1.1.3.129',
    tipo: 'BUG',
    titulo: 'Botões das janelas de confirmação sem formatação',
    descricao:
      'As janelas de confirmação e aviso do sistema apareciam com os botões sem formatação nenhuma, no visual cru do ' +
      'navegador — o "Confirmar" com uma borda fina e o "Cancelar" parecendo um link sublinhado. ' +
      'Agora os botões seguem o visual do sistema: ação principal preenchida (vermelha quando a ação desfaz ou apaga ' +
      'algo, azul nos demais casos) e o cancelar com contorno discreto. Vale para todas as telas e no tema escuro.',
    data_lancamento: '2026-08-30',
  },
  {
    versao: '1.1.3.129',
    tipo: 'NOVO',
    titulo: 'Vitrine Digital: escolher aparência Dia ou Noite do catálogo',
    descricao:
      'Na tela onde o link da vitrine é gerado, agora dá para escolher a aparência do catálogo que o cliente vai ver: ' +
      'Dia (claro) ou Noite (escuro). O padrão é Dia, porque foto de produto quase sempre vem com fundo branco e ' +
      'ficava destoando no escuro. Antes a vitrine seguia o tema do celular do cliente, sem ninguém poder decidir. ' +
      'A escolha pode ser trocada a qualquer momento no mesmo link, sem precisar gerar outro e sem invalidar o que o ' +
      'cliente já recebeu. No modo Noite, o fundo das fotos aparece em tom suave em vez de branco estourado, e os ' +
      'botões de avançar e voltar páginas ganharam contraste para ficarem legíveis no escuro.',
    data_lancamento: '2026-08-30',
  },
  {
    versao: '1.1.3.129',
    tipo: 'MELHORIA',
    titulo: 'Vitrine Digital: cores alinhadas à identidade PedidosWeb',
    descricao:
      'A vitrine era a única tela do sistema em verde — uma paleta própria que não combinava com o logo nem com o ' +
      'resto do produto. Agora ela usa o mesmo azul do PedidosWeb, o mesmo do tema padrão do sistema. ' +
      'O preço do produto passou a ser exibido em cor neutra, para não competir com o botão de adicionar, e o verde ' +
      'ficou reservado para o que ele realmente significa: pedido enviado com sucesso e preço mais barato na comparação ' +
      'entre tabelas. Os botões também ganharam contraste, ficando mais legíveis no celular sob luz forte.',
    data_lancamento: '2026-08-30',
  },
  {
    versao: '1.1.3.129',
    tipo: 'BUG',
    titulo: 'Vitrine Digital: link do cliente não é mais invalidado sem querer',
    descricao:
      'Abrir a tela do link da vitrine gerava um link novo toda vez — e isso desativava o anterior. ' +
      'Quem já tinha mandado o link para o cliente no WhatsApp acabava derrubando o acesso dele sem saber, ' +
      'e o cliente via "Link inválido ou expirado" sem ninguém entender o motivo. ' +
      'Agora a tela mostra o link que já está em uso, com um aviso de que não precisa reenviar. ' +
      'Para trocar o link existe um botão próprio, que avisa antes que o link antigo vai parar de funcionar. ' +
      'E quando um link realmente já não vale, a mensagem passa a dizer o porquê: substituído por um mais recente, ' +
      'ou vencido — em vez do texto genérico de antes.',
    data_lancamento: '2026-08-30',
  },
  {
    versao: '1.1.3.129',
    tipo: 'NOVO',
    titulo: 'Vitrine Digital: todas as fotos do produto no catálogo',
    descricao:
      'Produto com mais de uma foto agora mostra isso. No catálogo, um selo com a quantidade de fotos aparece no canto ' +
      'da imagem. Ao abrir o produto, as fotos viram um carrossel: miniaturas embaixo, setas para trocar e, no celular, ' +
      'basta arrastar para o lado. Tocando na foto ela abre ampliada já na imagem que estava sendo vista. ' +
      'Antes as fotos extras eram carregadas mas ficavam invisíveis — só apareciam para quem descobrisse que dava para ' +
      'clicar na imagem. Produto com uma foto só continua igual, sem setas nem miniaturas.',
    data_lancamento: '2026-08-30',
  },
  {
    versao: '1.1.3.129',
    tipo: 'MELHORIA',
    titulo: 'Vitrine Digital: busca mais fluida e navegação por teclado',
    descricao:
      'A busca do catálogo passou a filtrar quando o cliente para de digitar, em vez de a cada letra — em catálogo ' +
      'grande a digitação não trava mais. Um botão de voltar ao topo aparece quando a lista fica longa. ' +
      'E, para quem navega por teclado, o Tab agora circula dentro da janela aberta em vez de escapar para os produtos ' +
      'atrás dela, voltando para o botão de origem quando a janela fecha.',
    data_lancamento: '2026-08-30',
  },
  {
    versao: '1.1.3.129',
    tipo: 'NOVO',
    titulo: 'Vitrine Digital: comparar preços entre tabelas',
    descricao:
      'No seletor de tabela de preços da vitrine, o cliente agora pode marcar até duas outras tabelas para comparar. ' +
      'Cada produto passa a mostrar, embaixo do preço, quanto ele custaria nessas tabelas — em verde quando sai mais ' +
      'barato que a tabela em uso, e com um traço quando o produto não existe naquela tabela. Serve só para consulta: ' +
      'o pedido continua saindo de uma única tabela, a que estiver selecionada, sem misturar preços. A escolha de ' +
      'comparação fica guardada no navegador do cliente e um botão Limpar desfaz tudo.',
    data_lancamento: '2026-08-30',
  },
  {
    versao: '1.1.3.129',
    tipo: 'MELHORIA',
    titulo: 'Vitrine Digital: seletor de tabela de preços com busca',
    descricao:
      'Quando o cliente tem muitas tabelas de preço liberadas no link, elas enchiam a tela com dezenas de botões — ' +
      'em alguns casos três linhas no computador e seis no celular. Agora, acima de 5 tabelas, o bloco vira um ' +
      'seletor de uma linha só, mostrando a tabela em uso e quantas estão disponíveis. Ao tocar, abre a lista ' +
      'completa com campo de busca (basta digitar parte do nome) e a tabela atual marcada. Com 5 tabelas ou menos ' +
      'nada muda: continuam todas à mostra, como antes. Dica: no modal do link da vitrine dá para liberar só as ' +
      'tabelas que aquele cliente realmente usa.',
    data_lancamento: '2026-08-30',
  },
  {
    versao: '1.1.3.129',
    tipo: 'MELHORIA',
    titulo: 'Vitrine Digital: layout responsivo e tema escuro',
    descricao:
      'A vitrine (link do catálogo enviado ao cliente) foi retrabalhada. No celular a barra fixa do topo caiu quase ' +
      'pela metade — a ordenação, a quantidade por página e o seletor de tabela de preços saíram dela e agora ficam ' +
      'junto da lista, sobrando muito mais tela para os produtos. Os campos deixaram de dar zoom automático no iPhone, ' +
      'o carrinho e os detalhes abrem como painel de baixo para cima, e o fundo não rola mais atrás deles. ' +
      'A página passou a acompanhar o tema claro/escuro do aparelho do cliente e ganhou largura máxima em monitores grandes. ' +
      'Correções: o carrinho agora fecha clicando fora ou com Esc, os produtos em Destaques abrem o detalhe (antes só ' +
      'os da grade), a paginação não esconde mais o topo da lista atrás do cabeçalho, a troca de tabela de preços pede ' +
      'confirmação numa janela do próprio sistema, e mudar a quantidade não repinta a grade inteira nem perde a posição da rolagem.',
    data_lancamento: '2026-08-29',
  },
  {
    versao: '1.1.3.128',
    tipo: 'NOVO',
    titulo: 'Marketplace: de-para de anúncios',
    descricao:
      'Nova tela Comercial → Marketplace — De-para para ligar o anúncio/SKU do canal ao produto interno. ' +
      'Filtros por canal e pendentes, paginação, vínculo manual com busca de produto, vínculo automático ' +
      '(só quando o match é único) e cadastro manual de anúncios enquanto a Tray não sincroniza. ' +
      'Requer o add-on Marketplace liberado na licença.',
    data_lancamento: '2026-08-25',
  },
  {
    versao: '1.1.3.127',
    tipo: 'NOVO',
    titulo: 'Marketplace: cadastro dos canais de venda',
    descricao:
      'Novo card Marketplace — Canais de Venda em Configurações de API, para cadastrar as contas de Tray, Bling, ' +
      'Mercado Livre, Shopee, Amazon, Shein e TikTok Shop. Cada conta é um canal, então quem tem duas contas do ' +
      'mesmo marketplace cadastra duas linhas. A comissão informada em cada canal é usada no cálculo da margem líquida. ' +
      'Módulo adicional — disponível apenas para licenças com o Marketplace habilitado.',
    data_lancamento: '2026-08-25',
  },
  {
    versao: '1.1.3.126',
    tipo: 'MELHORIA',
    titulo: 'Fábrica: cópia do e-mail para cliente e vendedor',
    descricao:
      'Na aba E-mails Fábrica do fornecedor, você pode marcar cópia automática para o cliente e/ou vendedor. ' +
      'Na hora do envio, o sistema mostra os e-mails com opção de confirmar, desmarcar ou alterar antes de enviar. ' +
      'O PDF começa a gerar em paralelo enquanto você confirma — reduz a espera no clique de enviar.',
    data_lancamento: '2026-08-24',
  },
  {
    versao: '1.1.3.126',
    tipo: 'BUG',
    titulo: 'Fornecedores: busca sem telefone após salvar',
    descricao:
      'Ao salvar o fornecedor, a busca da lista não recebe mais o telefone por autofill do navegador. ' +
      'O envio do pedido à fábrica usa só os e-mails cadastrados na aba E-mails Fábrica.',
    data_lancamento: '2026-08-24',
  },
  {
    versao: '1.1.3.126',
    tipo: 'MELHORIA',
    titulo: 'Fábrica: escolher anexo XML ou XLS no e-mail',
    descricao:
      'Na aba E-mails Fábrica do fornecedor, além de ativar o envio automático, você escolhe o formato do arquivo anexo: só PDF, PDF + XML ou PDF + XLS. ' +
      'No Enviar para Fábrica, o sistema gera o arquivo no formato Delphi (Número, CNPJ, DataEntrega, Observação e itens com código fabricante, quantidade e preço).',
    data_lancamento: '2026-08-24',
  },
  {
    versao: '1.1.3.123',
    tipo: 'MELHORIA',
    titulo: 'Lista de pedidos: cards de filtro mais compactos',
    descricao:
      'Os cards Todos / Pedidos / Orçamentos na lista ficam menores, alinhados à esquerda e com visual mais leve — sem esticar na tela inteira.',
    data_lancamento: '2026-08-23',
  },
  {
    versao: '1.1.3.123',
    tipo: 'BUG',
    titulo: 'Clonar pedido: grade copiada junto',
    descricao:
      'Ao clonar ou repetir um pedido, as quantidades por tamanho (grade P/M/G…) passam a vir junto com a quantidade total. ' +
      'Antes só copiava o total e o save pedia para informar a grade de novo em cada item.',
    data_lancamento: '2026-08-23',
  },
  {
    versao: '1.1.3.123',
    tipo: 'BUG',
    titulo: 'Impressão de grade: sem bloco P/M repetido',
    descricao:
      'Na impressão/mapa de grade, um item preenchido só com P e M não cria mais um segundo bloco de colunas. ' +
      'Os tamanhos da mesma grade ficam numa sequência só (P, M, G, GG…), sem repetir cabeçalhos.',
    data_lancamento: '2026-08-22',
  },
  {
    versao: '1.1.3.123',
    tipo: 'MELHORIA',
    titulo: 'Carteira Operacional no mobile + Diário e Agenda de volta',
    descricao:
      'A Carteira Operacional entra no menu do app mobile (mais opções). ' +
      'Nos clientes voltam os botões visíveis Diário (o que foi feito) e Agenda (próxima visita), no computador e no celular — nas visões Compras e Follow-up.',
    data_lancamento: '2026-08-22',
  },
  {
    versao: '1.1.3.123',
    tipo: 'MELHORIA',
    titulo: 'Meu Dia mais compacto na home',
    descricao:
      'O painel Meu Dia ficou menor: números em uma linha, só 4 clientes para reativar e a coluna de orçamentos some quando está vazia — ' +
      'assim o Resumo do mês (Faturamento, gráficos) volta a aparecer sem rolar tanto.',
    data_lancamento: '2026-08-22',
  },
  {
    versao: '1.1.3.123',
    tipo: 'BUG',
    titulo: 'Meu Dia: cards e listas sempre visíveis',
    descricao:
      'O painel Meu Dia deixa de parecer só uma barra de botões: clientes parados, orçamentos e promoções ficam em destaque, ' +
      'com listas de reativação abaixo. O bloco de Faturamento/Pedidos aparece separado como «Resumo do mês».',
    data_lancamento: '2026-08-22',
  },
  {
    versao: '1.1.3.123',
    tipo: 'BUG',
    titulo: 'Home: Meu Dia carrega sem precisar dar F5',
    descricao:
      'O painel Meu Dia passa a atualizar ao abrir a home e ao voltar das abas, sem ficar preso em «Carregando…». ' +
      'Removemos também a faixa «Atalhos» de Vitrine/Showroom — esses botões já existem na barra superior.',
    data_lancamento: '2026-08-22',
  },
  {
    versao: '1.1.3.123',
    tipo: 'MELHORIA',
    titulo: 'Home mais limpa: Meu Dia em destaque e menos propaganda',
    descricao:
      'O painel Meu Dia sobe para o topo do dashboard. Os cards grandes de Vitrine/Showroom ficam recolhidos por padrão (há atalhos compactos e opção de reexibir). ' +
      'O botão «Conheça o PedidosWeb» saiu da barra superior e foi para o rodapé como «Apresentação».',
    data_lancamento: '2026-08-22',
  },
  {
    versao: '1.1.3.123',
    tipo: 'MELHORIA',
    titulo: 'Home mais limpa: topbar enxuta e Acesso rápido recolhido',
    descricao:
      'Removemos o atalho Config da barra superior (já existe em Configurações na lateral). ' +
      'WhatsApp, Fonte e Ajuda foram para o rodapé, junto do status. O Acesso Rápido abre fechado — use o botão flutuante quando precisar.',
    data_lancamento: '2026-08-22',
  },
  {
    versao: '1.1.3.123',
    tipo: 'NOVO',
    titulo: 'Meu Dia do representante + Oferta WhatsApp',
    descricao:
      'Na home, o representante vê clientes parados, orçamentos pendentes e promoções ativas. ' +
      'Monta oferta com um clique e envia pelo WhatsApp: se a API (Evolution/EuAtendo) estiver conectada no computador, envia por ela e grava no histórico do cliente; senão abre o WhatsApp Web (wa.me).',
    data_lancamento: '2026-08-22',
  },
  {
    versao: '1.1.3.123',
    tipo: 'BUG',
    titulo: 'Pedido: vendedor selecionado permanece ao salvar',
    descricao:
      'Ao lançar um pedido novo, o vendedor escolhido no combo passa a ser gravado corretamente. ' +
      'Antes o sistema salvava sempre o usuário logado e era preciso reabrir o pedido para corrigir.',
    data_lancamento: '2026-08-22',
  },
  {
    versao: '1.1.3.123',
    tipo: 'BUG',
    titulo: 'Grades P/M/G: ordem correta na tela e impressão',
    descricao:
      'Tamanhos alfabéticos de grade (P, M, G, GG…) deixam de aparecer em ordem alfabética confusa. ' +
      'A exibição respeita o sequencial cadastrado na grade e, quando necessário, a ordem padrão de confecção.',
    data_lancamento: '2026-08-22',
  },
  {
    versao: '1.1.3.123',
    tipo: 'MELHORIA',
    titulo: 'Importação de preços: auto-vínculo seletivo',
    descricao:
      'Ao carregar a planilha, só Descrição, Cód. Fabricante, Unidade e Quantidade (QTD) são vinculados automaticamente. ' +
      'Preços, impostos e demais colunas ficam «sem vínculo» para você escolher manualmente. Botão «Essenciais» continua disponível.',
    data_lancamento: '2026-08-22',
  },
  {
    versao: '1.1.3.122',
    tipo: 'MELHORIA',
    titulo: 'Produto Pai: pergunta clara e aviso das cores',
    descricao:
      'No cadastro do produto, a pergunta «Este produto é Pai?» explica o papel da referência. ' +
      'Se for Pai, o sistema informa que as cores são SKUs separados e oferece o atalho para adicionar cores. ' +
      'Na lista aparece o selo PAI ou COR.',
    data_lancamento: '2026-08-17',
  },
  {
    versao: '1.1.3.122',
    tipo: 'BUG',
    titulo: 'Contas a Receber: lançamento não gravava',
    descricao:
      'O botão Confirmar em Lançar Receita não gravava o título. Agora o lançamento salva normalmente e o sistema avisa se faltar cliente, valor ou vencimento. ' +
      'Na Natureza de Operação o Plano de Contas volta a listar as contas e o cadastro grava mesmo em bases Delphi (nome / excluído nulo).',
    data_lancamento: '2026-08-17',
  },
  {
    versao: '1.1.3.121',
    tipo: 'MELHORIA',
    titulo: 'Entrada XML: aviso de cadastro + leitura visual',
    descricao:
      'Na Entrada por XML, se o fornecedor ou produtos não existirem, o sistema avisa e pergunta se pode cadastrar ao confirmar. ' +
      'Enquanto o XML é lido, aparece um painel com animação para você acompanhar o progresso.',
    data_lancamento: '2026-08-15',
  },
  {
    versao: '1.1.3.120',
    tipo: 'MELHORIA',
    titulo: 'Busca de fornecedor estilo Google no Pagar, Receber e Estoque',
    descricao:
      'Nos lançamentos de Contas a Pagar, Contas a Receber e na entrada manual de Estoque, o campo de fornecedor/pagador busca enquanto você digita (nome, CNPJ ou código), ' +
      'com lista de sugestões — como uma busca do Google. Ainda dá para digitar um nome livre se ainda não estiver cadastrado.',
    data_lancamento: '2026-08-15',
  },
  {
    versao: '1.1.3.119',
    tipo: 'NOVO',
    titulo: 'Estoque: entrada por XML com conferência e Contas a Pagar',
    descricao:
      'Na aba Entrada por XML você confere emitente, totais, parcelas e itens antes de gravar. ' +
      'Na confirmação o sistema gera os títulos no Contas a Pagar e, se o estoque estiver habilitado, dá entrada nos produtos casados (código fabricante / barras).',
    data_lancamento: '2026-08-15',
  },
  {
    versao: '1.1.3.118',
    tipo: 'MELHORIA',
    titulo: 'Pagar/Receber: conta contábil por contexto + estorno no Receber',
    descricao:
      'No lançamento, Conta Contábil lista só Despesas no Contas a Pagar e só Receitas no Contas a Receber; Centro de Custo pode ser marcado para Pagar, Receber ou ambos. ' +
      'Contas a Receber agora tem estorno (devolve o valor do banco/caixa e gera movimentação). Liquidar já debitava/creditava o banco escolhido.',
    data_lancamento: '2026-08-15',
  },
  {
    versao: '1.1.3.117',
    tipo: 'MELHORIA',
    titulo: 'Contas a Receber: filtros e diálogos no padrão',
    descricao:
      'Contas a Receber ganhou a mesma experiência do Contas a Pagar: filtros compactos numa faixa, botão para ocultar/mostrar filtros, ' +
      'modais de recebimento menores e avisos/confirmações no padrão do sistema (sem janela nativa do navegador).',
    data_lancamento: '2026-08-15',
  },
  {
    versao: '1.1.3.116',
    tipo: 'MELHORIA',
    titulo: 'Contas a Pagar: filtros compactos e ocultáveis',
    descricao:
      'A barra de filtros fica em uma faixa só (Busca e botões na mesma linha) e o botão «Ocultar filtros / Mostrar filtros» ' +
      'libera espaço para a lista de títulos. A preferência fica salva no navegador.',
    data_lancamento: '2026-08-15',
  },
  {
    versao: '1.1.3.115',
    tipo: 'BUG',
    titulo: 'Contas a Pagar: botões Buscar e Limpar',
    descricao:
      'Os botões Buscar e Limpar da barra de filtros ficam alinhados ao campo de busca, com a mesma altura e largura parecida — ' +
      'sem o Limpar esticado nem desalinhado em relação ao input.',
    data_lancamento: '2026-08-15',
  },
  {
    versao: '1.1.3.114',
    tipo: 'BUG',
    titulo: 'Contas a Pagar: tamanho dos modais',
    descricao:
      'Os diálogos de Excluir título, Liquidação em lote e Liquidar conta deixam de ocupar a largura toda da tela ' +
      '(especialmente no mobile/embed) e passam a abrir em um card compacto, com botões alinhados à direita.',
    data_lancamento: '2026-08-15',
  },
  {
    versao: '1.1.3.113',
    tipo: 'BUG',
    titulo: 'Movimentação: pagamento e estorno juntos',
    descricao:
      'Na Movimentação Financeira, ao pagar e depois estornar, ficam os dois lançamentos: o pagamento (status PAGO) e o estorno (ESTORNADO). ' +
      'Nenhum dos dois entra nos totais — só movimentos ainda ativos (LIQUIDADO) somam em Entradas/Saídas.',
    data_lancamento: '2026-08-15',
  },
  {
    versao: '1.1.3.112',
    tipo: 'MELHORIA',
    titulo: 'Movimentação: estornos na lista sem somar',
    descricao:
      'Pagamentos/recebimentos estornados voltam a aparecer na Movimentação Financeira com status ESTORNADO (para controle), ' +
      'mas o valor riscado não entra nos totais de Entradas, Saídas e Saldo Líquido.',
    data_lancamento: '2026-08-15',
  },
  {
    versao: '1.1.3.111',
    tipo: 'MELHORIA',
    titulo: 'Contas a Pagar: confirmações no padrão do sistema',
    descricao:
      'Estorno e demais avisos do Contas a Pagar deixam de usar a janela nativa do navegador («localhost diz…») ' +
      'e passam a usar o diálogo visual padrão do SysRep.',
    data_lancamento: '2026-08-15',
  },
  {
    versao: '1.1.3.110',
    tipo: 'BUG',
    titulo: 'Contas a Pagar: lista ao abrir e status após liquidar',
    descricao:
      'Ao abrir Contas a Pagar a lista carrega sozinha com o filtro do mês. ' +
      'Depois de confirmar o pagamento o status muda para Liquidado na hora, sem precisar clicar em Buscar. ' +
      'Botões do modal de liquidação e da coluna Ações ficaram menores e alinhados à direita.',
    data_lancamento: '2026-08-15',
  },
  {
    versao: '1.1.3.109',
    tipo: 'BUG',
    titulo: 'Movimentação Financeira: some título estornado',
    descricao:
      'A Movimentação Financeira passa a listar só títulos liquidados (pela data de pagamento). ' +
      'Depois de estornar um pagamento, o lançamento deixa de aparecer nessa tela e nos totais de entrada/saída.',
    data_lancamento: '2026-08-15',
  },
  {
    versao: '1.1.3.108',
    tipo: 'NOVO',
    titulo: 'Baixa financeira debita/credita banco ou caixa',
    descricao:
      'Ao liquidar Contas a Pagar ou receber Contas a Receber, é obrigatório informar o banco/caixa. ' +
      'O saldo da conta é atualizado na hora (saída no pagar, entrada no receber). No estorno do pagar, o valor volta para a mesma conta. ' +
      'Cadastre bancos com o saldo do extrato em Financeiro → Cadastros Financeiros → Bancos.',
    data_lancamento: '2026-08-15',
  },
  {
    versao: '1.1.3.107',
    tipo: 'MELHORIA',
    titulo: 'Carteira: visões por fornecedor/vendedor e busca de cliente',
    descricao:
      'Na Carteira Operacional a Visão não corta mais o texto e inclui Compras por cidade, fornecedor, vendedor, região ou UF. ' +
      'A busca de cliente sugere resultados enquanto você digita (como no Google). Há filtro de fornecedor nas visões de compras.',
    data_lancamento: '2026-08-14',
  },
  {
    versao: '1.1.3.107',
    tipo: 'NOVO',
    titulo: 'Carteira: mapa de compras por cidade e cliente',
    descricao:
      'Na Carteira Operacional, a visão Compras lista cidade → cliente → cada pedido (se comprou 3 vezes, aparecem 3 linhas), ' +
      'com data, tipo, nº, fornecedor, vendedor, frete, forma de pagamento, valor e subtotal por cliente — para prospecção. ' +
      'A visão Follow-up continua com 1 linha por cliente (última compra, alerta, agenda e rotas).',
    data_lancamento: '2026-08-14',
  },
  {
    versao: '1.1.3.105',
    tipo: 'MELHORIA',
    titulo: 'Carteira Operacional: exportar XLS, PDF e imprimir',
    descricao:
      'Na Carteira Operacional você exporta a lista filtrada em Excel (.xls), gera PDF (janela de impressão) ou imprime direto na tela. ' +
      'CSV continua disponível. A exportação inclui todos os clientes do filtro, não só a página atual.',
    data_lancamento: '2026-08-14',
  },
  {
    versao: '1.1.3.105',
    tipo: 'NOVO',
    titulo: 'Carteira Operacional: última compra, agenda e rotas',
    descricao:
      'Novo relatório em Comercial → Relatórios Padrão → Carteira Operacional: mesmos filtros da carteira por região, ' +
      'com última compra e último pedido (clique para ver), alerta de dias sem compra, agrupamento por cidade/região/vendedor, ' +
      'anotações no diário, tarefas com Google Agenda, mapa e criação de rotas. Dados reais da base — sem exemplos fictícios.',
    data_lancamento: '2026-08-14',
  },
  {
    versao: '1.1.3.104',
    tipo: 'MELHORIA',
    titulo: 'Contas a Pagar: excluir títulos em aberto',
    descricao:
      'Títulos em aberto (incluindo vencidos) passam a ter o botão Excluir (✕) na coluna Ações. ' +
      'Informe o motivo da exclusão. Títulos já liquidados continuam exigindo estorno antes de excluir.',
    data_lancamento: '2026-08-14',
  },
  {
    versao: '1.1.3.104',
    tipo: 'MELHORIA',
    titulo: 'Despesas: aviso quando Plano de Contas está vazio',
    descricao:
      'Na tela de Despesas, se ainda não houver contas analíticas no Plano de Contas, o sistema explica como cadastrá-las para liberar o vínculo.',
    data_lancamento: '2026-08-14',
  },
  {
    versao: '1.1.3.99',
    tipo: 'MELHORIA',
    titulo: 'Importação: validação com tela de espera e botões bloqueados',
    descricao:
      'Ao clicar em Validar Dados, aparece um aviso grande no centro da tela com progresso. ' +
      'Enquanto valida, os botões de ação ficam bloqueados. A leitura da planilha também voltou a ser rápida.',
    data_lancamento: '2026-08-01',
  },
  {
    versao: '1.1.3.99',
    tipo: 'BUG',
    titulo: 'Importação: campos de vínculo na 1ª carga e badge Nova nos auxiliares',
    descricao:
      'Corrigido: na primeira vez que a planilha era carregada, os combos de vínculo às vezes vinham vazios (era preciso subir o arquivo de novo). ' +
      'Agora os campos do sistema são carregados antes do mapeamento. Também reforçado o aviso ✨ Nova em Subfamília, Grupo, Unidade etc. ao Validar Dados.',
    data_lancamento: '2026-08-01',
  },
  {
    versao: '1.1.3.98',
    tipo: 'BUG',
    titulo: 'Importação: aviso de Subfamília/Grupo novos na validação',
    descricao:
      'Ao Validar Dados na Importação de Preços, Subfamília, Grupo, Unidade e demais auxiliares que ainda não existem ' +
      'passam a mostrar o badge Nova (como a Grade) e o toast resume quantas linhas vão criar cadastro ao salvar.',
    data_lancamento: '2026-08-01',
  },
  {
    versao: '1.1.3.98',
    tipo: 'MELHORIA',
    titulo: 'Ajuda: cadastros auxiliares e importação de preços',
    descricao:
      'A Central de Ajuda explica, em linguagem simples, onde cadastrar Grupo, Subfamília, Unidade, Tipo de Grade e Grades ' +
      '(Tabelas de Apoio) e que a Importação de Preços cria esses valores automaticamente se não existirem.',
    data_lancamento: '2026-08-01',
  },
  {
    versao: '1.1.3.98',
    tipo: 'BUG',
    titulo: 'Cadastro de Grades: erro «Data too long»',
    descricao:
      'Ao salvar Grades em bases antigas, a coluna nome/apelido era curta demais e gerava erro. ' +
      'O sistema amplia automaticamente essas colunas e passa a aceitar descrições maiores.',
    data_lancamento: '2026-08-01',
  },
  {
    versao: '1.1.3.98',
    tipo: 'MELHORIA',
    titulo: 'Cadastros de apoio em maiúsculas',
    descricao:
      'Descrições de Subfamília, Unidade, Tipo de Grade, Grupo, Locais, Tipo de Cliente, Segmento e Categoria ' +
      'passam a ser gravadas e exibidas sempre em MAIÚSCULAS (incluindo registros antigos do seed).',
    data_lancamento: '2026-08-01',
  },
  {
    versao: '1.1.3.98',
    tipo: 'NOVO',
    titulo: 'Telas de Grupo, Subfamília, Unidade e Tipo de Grade',
    descricao:
      'Em Cadastros há telas separadas (padrão do sistema) para Grupo de Produto, Subfamília, Unidade e Tipo de Grade. ' +
      'Locais de Armazenamento foi refeito no mesmo padrão. Os combos do Produto usam esses cadastros; na Importação de Preços o sistema pode criar e vincular automaticamente.',
    data_lancamento: '2026-08-01',
  },
  {
    versao: '1.1.3.98',
    tipo: 'BUG',
    titulo: 'Importação: escolher outra planilha após salvar',
    descricao:
      'Depois de salvar na Importação de Preços, o botão Selecionar arquivo e o arrastar de uma nova planilha voltam a funcionar ' +
      '(o overlay de conclusão não trava mais a tela). Nova Importação também limpa o estado por completo.',
    data_lancamento: '2026-08-01',
  },
  {
    versao: '1.1.3.98',
    tipo: 'MELHORIA',
    titulo: 'Importação avisa Grade nova na linha',
    descricao:
      'Ao Validar Dados na Importação de Preços, se a Grade da planilha ainda não existir no cadastro, a própria célula fica destacada com o aviso «📏 Nova» ' +
      '(será criada ao salvar). Id numérico inexistente aparece em vermelho.',
    data_lancamento: '2026-08-01',
  },
  {
    versao: '1.1.3.98',
    tipo: 'MELHORIA',
    titulo: 'Importação cria Grade se não existir',
    descricao:
      'Na Importação de Preços, a coluna Grade continua buscando a grade já cadastrada (nome ou tamanhos). ' +
      'Se não existir (ex.: P/M/G/GG), o sistema cadastra a grade com esses tamanhos e vincula ao produto automaticamente.',
    data_lancamento: '2026-08-01',
  },
  {
    versao: '1.1.3.98',
    tipo: 'MELHORIA',
    titulo: 'Confirmação moderna ao inativar fora da planilha',
    descricao:
      'Na Importação de Preços, a confirmação de inativar produtos que não estão na planilha deixou o alerta padrão do navegador ' +
      'e passou a usar o mesmo modal visual do salvamento, com resumo e aviso quando mais da metade seria inativada.',
    data_lancamento: '2026-08-01',
  },
  {
    versao: '1.1.3.98',
    tipo: 'BUG',
    titulo: 'Importação atualiza produto já cadastrado (código 0002 vs 2)',
    descricao:
      'Na Importação de Preços, códigos como 0002 e 2 passam a ser tratados como o mesmo. ' +
      'Se o produto já existe no fornecedor, a linha atualiza em vez de mostrar erro «Já existe o produto».',
    data_lancamento: '2026-08-01',
  },
  {
    versao: '1.1.3.98',
    tipo: 'MELHORIA',
    titulo: 'Importação: inativar fora da planilha + mais espaço na lista',
    descricao:
      'Na Importação de Preços há a opção de inativar produtos ativos do fornecedor que não vieram na planilha (com confirmação; não exclui). ' +
      'A tela também ficou mais compacta: com o Excel aberto, a lista de itens ganha altura e as colunas de status ficam menores.',
    data_lancamento: '2026-08-01',
  },
  {
    versao: '1.1.3.98',
    tipo: 'NOVO',
    titulo: 'Importação de preços vincula a Grade da planilha',
    descricao:
      'Na Importação de Preços, a coluna Grade (ex.: P/M/G/GG) mapeia sozinha e associa o produto à grade já cadastrada ' +
      '(mesmo nome ou mesmos tamanhos). Se a grade não existir no cadastro, a linha avisa o erro — não cria grade automaticamente.',
    data_lancamento: '2026-08-01',
  },
  {
    versao: '1.1.3.98',
    tipo: 'MELHORIA',
    titulo: 'Importação reconhece coluna Valor como preço',
    descricao:
      'Na Importação de Preços, cabeçalhos como Valor, Valor de Venda ou Preço passam a mapear sozinhos para Preço Venda. ' +
      'Cod. Fabricante (sem acento) também casa com Cód. Fabricante.',
    data_lancamento: '2026-08-01',
  },
  {
    versao: '1.1.3.98',
    tipo: 'MELHORIA',
    titulo: 'Cadastrar transportadora sem sair do pedido',
    descricao:
      'Na aba Logística do pedido, ao lado de Transportadora há o botão +. Você cadastra nome (e opcionalmente CPF/CNPJ e telefone) na hora, ' +
      'e a transportadora fica selecionada — sem fechar o pedido nem perder o que já digitou.',
    data_lancamento: '2026-08-01',
  },
  {
    versao: '1.1.3.98',
    tipo: 'MELHORIA',
    titulo: 'Cadastrar tipo de frete sem sair do pedido',
    descricao:
      'No pedido, ao lado de Tipo de Frete há o botão +. Você cadastra o frete (nome e valor opcional) na hora, ' +
      'ele entra no combo e fica selecionado — sem fechar o pedido nem perder o que já digitou.',
    data_lancamento: '2026-08-01',
  },
  {
    versao: '1.1.3.98',
    tipo: 'NOVO',
    titulo: 'Grupo Grades na configuração + cabeçalho na impressão',
    descricao:
      'Em Sistema → Configuração há a seção «Grades (Pedido e Impressão)». Com Pedido por Grade ligado, você escolhe layout (cores, neutro, seções, híbrido) ' +
      'e o cabeçalho dos tamanhos: Único (só 42 44 46…, estilo Jardim) ou Duplo (rótulo do bloco + tamanhos).',
    data_lancamento: '2026-08-01',
  },
  {
    versao: '1.1.3.98',
    tipo: 'NOVO',
    titulo: 'Escolher layout da grade na impressão',
    descricao:
      'Em Sistema → Configuração, com Pedido por Grade ligado, você escolhe como as grades aparecem no PDF/impressão: ' +
      'Cores por bloco, Neutro (cinza + borda), Seções separadas por grade, ou Híbrido (seções quando houver 3 ou mais grades).',
    data_lancamento: '2026-08-01',
  },
  {
    versao: '1.1.3.98',
    tipo: 'MELHORIA',
    titulo: 'Impressão por grade com Cor e configs do relatório',
    descricao:
      'Na impressão/PDF do pedido com grades, a coluna Cor mostra o campo Cores ou, se vazio, a Obs. do item (ex.: AZUL CLARO ou azul/verde/rosa). ' +
      'A tabela respeita o modelo de impressão (código do produto ligado/desligado, qtde, preços, impostos no modo Completo), ' +
      'os parâmetros Exibir Cor nos Pedidos por Grade, Tipo de Relatório por Grade e Exibir Código do Fabricante, ' +
      'e as preferências do fornecedor (cód. fabricante no pedido e Obs. do item).',
    data_lancamento: '2026-07-31',
  },
  {
    versao: '1.1.3.97',
    tipo: 'BUG',
    titulo: 'Agendar visita no cliente sem erro de assunto',
    descricao:
      'Ao agendar visita pela tela de Clientes, o sistema grava corretamente como visita (não exige mais assunto/contato como se fosse compromisso). ' +
      'O modal agora mostra Assunto e Nome do contato, já preenchido com o nome do cliente.',
    data_lancamento: '2026-07-31',
  },
  {
    versao: '1.1.3.95',
    tipo: 'NOVO',
    titulo: 'Colar imagens com Ctrl+V (produtos e logos)',
    descricao:
      'Nas abas de fotos de Produtos, Fornecedores e Clientes você pode colar imagens da área de transferência (Ctrl+V), ' +
      'incluindo fotos copiadas do Google Drive (abra a imagem → Copiar imagem → cole no SysRep). ' +
      'Também funciona no importador de fotos em lote dos produtos.',
    data_lancamento: '2026-07-30',
  },
  {
    versao: '1.1.3.94',
    tipo: 'BUG',
    titulo: 'Busca de clientes por cidade não mistura com rua',
    descricao:
      'Ao buscar ou filtrar por cidade (ex.: José Bonifácio), a lista deixa de trazer clientes só porque o nome da rua contém o mesmo texto. ' +
      'A busca geral e o filtro avançado de Cidade usam apenas o campo cidade.',
    data_lancamento: '2026-07-30',
  },
  {
    versao: '1.1.3.94',
    tipo: 'NOVO',
    titulo: 'Agendar + Google Agenda em Fornecedores e Usuários',
    descricao:
      'Nas telas de Fornecedores e Usuários você pode agendar um compromisso (botão Agendar na lista, no menu ⋮, no painel rápido ou no formulário) ' +
      'e, se quiser, abrir o Google Agenda ao salvar — igual ao que já existia em Clientes.',
    data_lancamento: '2026-07-30',
  },
  {
    versao: '1.1.3.93',
    tipo: 'BUG',
    titulo: 'Confirmação de exclusão centralizada nas Grades',
    descricao:
      'Ao excluir uma grade, a caixa «Excluir grade?» aparece centralizada sem alargar a tela, ' +
      'e a lista permanece no mesmo ponto em que você estava (não pula para o meio dos registros).',
    data_lancamento: '2026-07-30',
  },
  {
    versao: '1.1.3.93',
    tipo: 'NOVO',
    titulo: 'Cadastro de Tipo de Cliente',
    descricao:
      'O campo Tipo de Cliente (Consumidor, Revendedor, Especial, Indústria) deixa de ser lista fixa e passa a vir da tabela Tipo de Cliente. ' +
      'Cadastre novos tipos em Cadastros → Tabelas de Apoio → Tipo de Cliente. ' +
      'Na tela de Clientes o filtro avançado também usa esse cadastro — ideal para relatórios.',
    data_lancamento: '2026-07-30',
  },
  {
    versao: '1.1.3.92',
    tipo: 'MELHORIA',
    titulo: 'Segmento: Cliente, Fornecedor ou Ambos',
    descricao:
      'No cadastro de Segmentos (Cadastros → Segmentos) você define se o item vale para Cliente, Fornecedor ou Ambos. ' +
      'O combo do cliente mostra só segmentos de Cliente/Ambos; o do fornecedor, só Fornecedor/Ambos. ' +
      'Categoria de produto continua no menu separado «Categoria de Produto».',
    data_lancamento: '2026-07-27',
  },
  {
    versao: '1.1.3.92',
    tipo: 'MELHORIA',
    titulo: 'Agenda: Compromisso ou Pendência + Google Agenda',
    descricao:
      'Na Agenda e no Calendário você escolhe o tipo: Compromisso, Pendência, Prospect ou Visita (cliente só aparece em Visita). ' +
      'A opção «Abrir Google Agenda ao salvar» vem marcada e, ao gravar, abre o Google Calendar com o evento preenchido.',
    data_lancamento: '2026-07-27',
  },
  {
    versao: '1.1.3.91',
    tipo: 'NOVO',
    titulo: 'Agenda com compromissos sem cliente',
    descricao:
      'Na Agenda e no Calendário de Visitas você pode agendar não só visita a cliente cadastrado, ' +
      'mas também Prospect (futuro cliente, com nome/telefone) e Compromisso/pendência do dia (assunto livre). ' +
      'Escolha o Tipo no formulário — visita com cliente continua igual.',
    data_lancamento: '2026-07-27',
  },
  {
    versao: '1.1.3.91',
    tipo: 'BUG',
    titulo: 'Cadastro de Motivo de Visita volta a salvar',
    descricao:
      'Ao salvar um Motivo de Visita aparecia o erro «Unknown column excluido». ' +
      'Em bases legadas a coluna se chama «exluido» (como no Delphi). O cadastro agora detecta o nome certo e grava normalmente.',
    data_lancamento: '2026-07-27',
  },
  {
    versao: '1.1.3.91',
    tipo: 'MELHORIA',
    titulo: 'Ajuda atualizada: clientes, região e catálogos',
    descricao:
      'A Central de Ajuda documenta PDF Fábrica, Diário comercial (modal ao finalizar visita), representadas com marca própria, consulta/importação CNPJ, Relatórios Região/Carteira (paginação e tela larga) e como inativar/excluir catálogo visual.',
    data_lancamento: '2026-07-25',
  },
  {
    versao: '1.1.3.90',
    tipo: 'MELHORIA',
    titulo: 'Importação de clientes: consulta CNPJ opcional',
    descricao:
      'Na Importação de Clientes (Excel), após validar os dados você pode marcar «Consultar CNPJ e preencher IE / fundação / situação (mais lento)». ' +
      'O sistema preenche só o que estiver vazio na planilha (Inscrição Estadual, data de fundação e situação cadastral), com intervalo entre consultas para não sobrecarregar as APIs. ' +
      'CNPJ baixado ou inapto não bloqueia — o resumo informa quantos. Sem a opção marcada, continua gravando apenas o que veio no Excel.',
    data_lancamento: '2026-07-25',
  },
  {
    versao: '1.1.3.90',
    tipo: 'MELHORIA',
    titulo: 'Paginação nos Relatórios Região',
    descricao:
      'Nas quatro abas de Comercial → Relatórios Região / Carteira, listas longas passam a ter paginação (25/50/100 por página) com Anterior/Próxima e contador X–Y de Z. ' +
      'Os controles só aparecem quando há mais registros que o tamanho da página. CSV e Imprimir continuam exportando todos os dados filtrados.',
    data_lancamento: '2026-07-25',
  },
  {
    versao: '1.1.3.90',
    tipo: 'MELHORIA',
    titulo: 'Relatórios Região — tela mais larga e clara',
    descricao:
      'A tela Comercial → Relatórios Região / Carteira passou a usar a largura toda da área de conteúdo, com abas, filtros e KPIs no padrão das outras telas comerciais. ' +
      'Cada aba traz um subtítulo do que o relatório responde; na aba Valores, pedidos e orçamentos ficam destacados por cores.',
    data_lancamento: '2026-07-25',
  },
  {
    versao: '1.1.3.90',
    tipo: 'MELHORIA',
    titulo: 'Consulta CNPJ avisa se a empresa foi baixada',
    descricao:
      'Ao consultar o CNPJ no cadastro de cliente ou fornecedor, o sistema destaca quando a situação na Receita não é ATIVA (ex.: BAIXADA, INAPTA, SUSPENSA ou NULA): toast de aviso, faixa amarela no formulário e, no cliente, preenchimento da aba Info CNPJ. O cadastro não é bloqueado — só informa.',
    data_lancamento: '2026-07-25',
  },
  {
    versao: '1.1.3.90',
    tipo: 'MELHORIA',
    titulo: 'Consulta CNPJ traz IE e data de fundação',
    descricao:
      'Ao consultar o CNPJ no cadastro de cliente (e fornecedor), a Inscrição Estadual e a Data de Fundação/Abertura passam a ser preenchidas automaticamente quando a fonte pública informar. ' +
      'A IE só aparece se existir cadastro estadual ativo — não é inventada.',
    data_lancamento: '2026-07-25',
  },
  {
    versao: '1.1.3.90',
    tipo: 'BUG',
    titulo: 'Diário — Registrar contato e finalizar visita',
    descricao:
      'O botão «+ Registrar contato» na aba Diário voltou a abrir o formulário. ' +
      'Ao finalizar uma visita da agenda, o sistema usa um modal com resultado, motivo e conversa — sem o prompt feio do navegador.',
    data_lancamento: '2026-07-25',
  },
  {
    versao: '1.1.3.90',
    tipo: 'BUG',
    titulo: 'Diário do cliente — pedidos sem erro de coluna',
    descricao:
      'A aba Diário do cliente voltou a listar as compras (pedidos): o sistema usava a coluna errada do vendedor em pedidos e a timeline de compras falhava em silêncio.',
    data_lancamento: '2026-07-25',
  },
  {
    versao: '1.1.3.90',
    tipo: 'NOVO',
    titulo: 'Relatórios Região / Carteira',
    descricao:
      'Nova tela em Comercial → Relatórios Padrão com quatro abas: relatório geral de clientes (filtros e CSV/impressão), ' +
      'região por vendedor, clientes agrupados por região e valores de pedidos vs orçamentos por região no período. ' +
      'Ajuda disponível pelo botão na própria tela.',
    data_lancamento: '2026-07-25',
  },
  {
    versao: '1.1.3.89',
    tipo: 'MELHORIA',
    titulo: 'Marca própria na ficha PDF e no pedido',
    descricao:
      'Quando o cliente tem marca própria cadastrada em uma fábrica (aba Representadas), o nome e o logo passam a aparecer no PDF Fábrica da ficha e na impressão/envio do pedido daquela fábrica. ' +
      'Quem não usa marca própria continua sem nenhuma alteração nos documentos.',
    data_lancamento: '2026-07-25',
  },
  {
    versao: '1.1.3.89',
    tipo: 'NOVO',
    titulo: 'Marca própria e logo na representada do cliente',
    descricao:
      'Na aba Representadas do cliente, ao vincular uma fábrica você pode marcar se o cliente tem marca própria, ' +
      'informar o nome da marca e enviar o logo — tudo por fábrica.',
    data_lancamento: '2026-07-25',
  },
  {
    versao: '1.1.3.89',
    tipo: 'NOVO',
    titulo: 'Diário comercial na ficha do cliente',
    descricao:
      'Nova aba Diário no cadastro do cliente: registre visitas e o que foi conversado na venda, informe o motivo quando não comprou, ' +
      'e veja as compras (pedidos) automaticamente na mesma linha do tempo. Também disponível no painel de detalhes.',
    data_lancamento: '2026-07-25',
  },
{
    versao: '1.1.3.87',
    tipo: 'NOVO',
    titulo: 'Cliente vinculado às representadas (fábricas)',
    descricao:
      'No cadastro do cliente, a aba Representadas permite vincular as fábricas com as quais ele trabalha e gravar o código do cliente em cada fábrica. ' +
      'Há uma opção «Restringir pedido às representadas vinculadas» (desligada por padrão): com ela ligada, o pedido só libera as fábricas da lista.',
    data_lancamento: '2026-07-25',
  },
  {
    versao: '1.1.3.87',
    tipo: 'BUG',
    titulo: 'Salvar cliente com segmento voltou a funcionar',
    descricao:
      'Ao salvar o cliente com um Segmento selecionado, o sistema acusava «Categoria (segmento) informada não existe ou está inativa». ' +
      'A validação lia a tabela errada; agora usa a mesma lista de segmentos do cadastro.',
    data_lancamento: '2026-07-25',
  },
  {
    versao: '1.1.3.87',
    tipo: 'BUG',
    titulo: 'Agendar visita envia o endereço para a Google Agenda',
    descricao:
      'Ao marcar «Abrir Google Agenda ao salvar» no cadastro do cliente, o evento passa a preencher o campo Local ' +
      'com o endereço completo do cliente (rua, número, bairro, cidade/UF e CEP), para abrir o mapa direto no evento.',
    data_lancamento: '2026-07-25',
  },
  {
    versao: '1.1.3.87',
    tipo: 'MELHORIA',
    titulo: 'Ajuda: PDF Fábrica e região/rota do cliente',
    descricao:
      'A Central de Ajuda agora explica passo a passo o botão «PDF Fábrica» e como vincular o cliente na Região (aba Comercial) — ' +
      'incluindo a diferença para as Rotas de Vendedores do CRM.',
    data_lancamento: '2026-07-25',
  },
  {
    versao: '1.1.3.87',
    tipo: 'BUG',
    titulo: 'Lista de clientes abre sem erro de complemento',
    descricao:
      'A tela de Clientes falhava ao carregar em bases antigas («Unknown column complemento»). ' +
      'A listagem voltou a abrir normalmente e a coluna é criada automaticamente quando necessário.',
    data_lancamento: '2026-07-25',
  },
  {
    versao: '1.1.3.87',
    tipo: 'NOVO',
    titulo: 'PDF da ficha do cliente para a fábrica',
    descricao:
      'Gere a ficha rápida do cliente para a fábrica pelo menu ⋮ da lista, pelo painel de detalhes ou pelo botão «PDF Fábrica» no cadastro aberto ' +
      '(topo e rodapé). Inclui identificação, endereço, contato e dados fiscais — pronta para imprimir ou salvar em PDF.',
    data_lancamento: '2026-07-25',
  },
  {
    versao: '1.1.3.87',
    tipo: 'BUG',
    titulo: 'Gestão de Regiões volta a listar as regiões',
    descricao:
      'A tela Gestão de Regiões aparecia vazia («No data available») porque lia uma tabela antiga inexistente. ' +
      'Agora lista as mesmas regiões de Cadastros › Regiões e Rotas.',
    data_lancamento: '2026-07-25',
  },
  {
    versao: '1.1.3.87',
    tipo: 'NOVO',
    titulo: 'Carteira de Recompra',
    descricao:
      'Nova tela em Comercial → Vendas que mostra, por semáforo 🟢🟡🔴, quais clientes estão na hora de recomprar — ' +
      'por fábrica: cada linha é «cliente + fábrica», com ciclo de compra e semáforo próprios daquela dupla (o mesmo cliente ' +
      'pode estar em dia numa fábrica e atrasado noutra). Traz última compra, ciclo médio, previsão da próxima e valor potencial, ' +
      'com filtro por fábrica. O botão «Gerar pedido» repete o último pedido daquele cliente com a fábrica — ' +
      'traz cliente, fábrica e os itens já carregados; o vendedor confere, ajusta e salva.',
    data_lancamento: '2026-07-25',
  },
  {
    versao: '1.1.3.86',
    tipo: 'MELHORIA',
    titulo: 'Desconto por Faixa visível sob o produto no pedido',
    descricao:
      'Na aba Itens, quando o Desconto por Faixa está aplicado, aparece um badge discreto sob a descrição do produto ' +
      '(ex.: Desc. 8,95% + 80% + 30%), no mesmo estilo do acréscimo em lote.',
    data_lancamento: '2026-07-24',
  },
  {
    versao: '1.1.3.86',
    tipo: 'BUG',
    titulo: 'Desconto por Faixa reaparece ao reabrir o pedido',
    descricao:
      'Ao aplicar o Desconto por Faixa (DESC 01–10) no pedido e salvar, os campos voltavam para o padrão da fábrica ao reabrir. ' +
      'Agora o sistema grava os valores usados no pedido e restaura o painel com os mesmos descontos.',
    data_lancamento: '2026-07-24',
  },
  {
    versao: '1.1.3.86',
    tipo: 'BUG',
    titulo: 'Contas a Receber: lote, filtro de status e lentidão',
    descricao:
      'Receber em lote não alterava o status e o filtro Aberta/Recebido/Em atraso não funcionava nas bases Delphi ' +
      '(status legado «A RECEBER»). Corrigido o reconhecimento dos status, o recebimento em lote e a listagem ficou mais rápida.',
    data_lancamento: '2026-07-24',
  },
  {
    versao: '1.1.3.86',
    tipo: 'BUG',
    titulo: 'Receber em lote no Contas a Receber',
    descricao:
      'Ao marcar vários títulos e clicar em «Receber em Lote», nada acontecia — faltava o modal e a função no front. ' +
      'Agora abre a tela de data/forma de pagamento e confirma o recebimento dos selecionados de uma vez.',
    data_lancamento: '2026-07-24',
  },
  {
    versao: '1.1.3.84',
    tipo: 'BUG',
    titulo: 'Pedido: «Permitir nova linha» do fornecedor era ignorado',
    descricao:
      'Na fábrica, a opção Mesmo produto no pedido → Permitir nova linha (não somar) às vezes era ignorada: ' +
      'ao abrir ou redesenhar o pedido, o sistema fundia as linhas do mesmo código como se estivesse em «Somar». ' +
      'Corrigido: a regra da fábrica é lida antes de montar os itens e só soma quando a opção for realmente Somar.',
    data_lancamento: '2026-07-23',
  },
  {
    versao: '1.1.3.82',
    tipo: 'MELHORIA',
    titulo: 'Consulta rápida de preços no celular e tablet',
    descricao:
      'A Consulta Rápida de Preços entrou no menu Mais do app mobile/tablet (Preço Rápido), ' +
      'ao lado de Showroom e Vitrine. A tela ficou otimizada para toque: busca mais leve, sem fotos na lista e layout compacto.',
    data_lancamento: '2026-07-22',
  },
  {
    versao: '1.1.3.82',
    tipo: 'NOVO',
    titulo: 'Consulta rápida de preços com confronto de tabelas',
    descricao:
      'Nova tela em Cadastros › Preços › Consulta Rápida: busque o produto na frente do cliente, veja o preço de cadastro ' +
      'e compare com todas as tabelas ativas. O sistema destaca a tabela mais barata (melhor para o cliente) e a de maior preço.',
    data_lancamento: '2026-07-22',
  },
  {
    versao: '1.1.3.82',
    tipo: 'MELHORIA',
    titulo: 'Showroom carrega produtos mais rápido',
    descricao:
      'A listagem de produtos no Showroom ficou mais ágil: busca enxuta (sem consultas extras de promoção/foto por linha), ' +
      'favoritos em uma única chamada e lista de fábricas mais leve na abertura.',
    data_lancamento: '2026-07-22',
  },
  {
    versao: '1.1.3.82',
    tipo: 'MELHORIA',
    titulo: 'Showroom e Vitrine usam as mesmas regras de CX e kilos do pedido',
    descricao:
      'Carrinho do Showroom e da Vitrine Digital passam a calcular o total como na tela de Pedidos: ' +
      'preço por peso (kg) do produto, soma de embalagem do sistema e, quando aplicável, mínimo de caixas e faturamento da fábrica.',
    data_lancamento: '2026-07-22',
  },
  {
    versao: '1.1.3.82',
    tipo: 'MELHORIA',
    titulo: 'Salvar pedido grande ficou mais rápido',
    descricao:
      'Pedidos com muitos itens salvam com menos espera: a tela não redesenha a lista antes de gravar; ' +
      'o envio leva só os dados necessários; grades gravam em lote; e no servidor as validações/normalização ' +
      'usam uma única consulta a produtos/sistemas (antes repetiam várias vezes a cada salvamento).',
    data_lancamento: '2026-07-22',
  },
  {
    versao: '1.1.3.80',
    tipo: 'MELHORIA',
    titulo: 'Mais colunas de preço na grade de itens do pedido',
    descricao:
      'Em Pedidos → Colunas dos itens → Preços e descontos, agora dá para marcar também Vlr Venda, Vlr Final ' +
      '(unitário após desc./acrésc.), Vlr Desconto (R$) e Vlr Total — além de Vlr. Tabela, % e demais campos que já existiam.',
    data_lancamento: '2026-07-22',
  },
  {
    versao: '1.1.3.80',
    tipo: 'BUG',
    titulo: 'WhatsApp no cliente agora grava e mostra se foi enviado',
    descricao:
      'Ao enviar WhatsApp pela API na tela de Clientes, o sistema passa a gravar o histórico antes de responder. ' +
      'A coluna WhatsApp da lista atualiza com a data/hora do envio (✓) e o histórico do cliente lista a mensagem. ' +
      'Antes, o registro podia se perder porque a tela recarregava antes da gravação terminar.',
    data_lancamento: '2026-07-22',
  },
  {
    versao: '1.1.3.80',
    tipo: 'NOVO',
    titulo: 'Pré-visualizar impressão dos itens sem salvar',
    descricao:
      'Na aba Itens do pedido, o botão «Ver impressão» abre a pré-visualização do relatório com os valores atuais da tela ' +
      '(incluindo desconto e acréscimo em lote ainda não salvos). Não grava o pedido — serve só para conferir como ficará a impressão.',
    data_lancamento: '2026-07-22',
  },
  {
    versao: '1.1.3.80',
    tipo: 'BUG',
    titulo: 'Acréscimo e desconto em lote agora gravam e reabrem corretos',
    descricao:
      'No pedido, o Acréscimo em Lote (sobre o total) e o Desconto por Faixa podiam aparecer certos na tela e ' +
      'sumir ao salvar ou ao reabrir o pedido. Agora o percentual é gravado nos itens e mantido ao reabrir. ' +
      'No acréscimo por valor unitário também não há mais aplicação em dobro na gravação.',
    data_lancamento: '2026-07-22',
  },
  {
    versao: '1.1.3.78',
    tipo: 'NOVO',
    titulo: 'Remover acréscimo e desconto dos itens selecionados',
    descricao:
      'Na aba Itens do pedido, use Selecionar para marcar os itens e clique em «Zerar acré/desc» para voltar ao valor ' +
      'sem acréscimo e sem desconto. O preço unitário negociado de cada item é mantido — apenas os percentuais ' +
      'aplicados são removidos.',
    data_lancamento: '2026-07-22',
  },
  {
    versao: '1.1.3.78',
    tipo: 'BUG',
    titulo: 'Acréscimo em lote não era gravado no pedido',
    descricao:
      'No pedido, o Acréscimo em Lote aplicado sobre o total dos itens aparecia na tela mas se perdia ao salvar — ' +
      'o pedido era gravado sem o acréscimo. No modo por valor unitário ocorria o inverso: o percentual era aplicado ' +
      'duas vezes na gravação. Agora o valor salvo é exatamente o que aparece na tela nos dois modos.',
    data_lancamento: '2026-07-22',
  },
  {
    versao: '1.1.3.78',
    tipo: 'MELHORIA',
    titulo: 'Salvar pedido mais rápido com muitos itens',
    descricao:
      'O salvamento de pedidos grandes ficou muito mais rápido. Duas mudanças: o sistema não faz mais uma consulta de ' +
      'promoção por item antes de gravar (a promoção já aplicada é reaproveitada); e o PDF do envio para a fábrica ' +
      'deixou de ser gerado durante o salvamento — agora ele é gerado apenas quando você confirma o envio, com aviso ' +
      'próprio. O pedido é salvo e fechado na hora, sem esperar pela geração do PDF.',
    data_lancamento: '2026-07-22',
  },
  {
    versao: '1.1.3.78',
    tipo: 'BUG',
    titulo: 'Telas sem token: sessão expirada ao carregar',
    descricao:
      'Corrigido o erro «Sessão expirada ou não autenticado» em várias telas que não enviavam o token ' +
      '(Peso por Vendedor/Rota, Performance de Representantes, Bancos, Cores, Transportadoras, Tipo de Frete, ' +
      'Eventos/Cidades, Hotéis, Locais, Regiões, Faturamento, Conciliação, Gamificação e LGPD).',
    data_lancamento: '2026-07-22',
  },
  {
    versao: '1.1.3.74',
    tipo: 'MELHORIA',
    titulo: 'Ajuda atualizada: financeiro, pedidos e produtos em lote',
    descricao:
      'A Central de Ajuda agora explica Cartões Corporativos, Cheques, Previsão de Caixa, Cadastros Financeiros, ' +
      'ações em lote nos Pedidos (incluindo faturar), exclusão/ativação em lote nos Produtos, Família/Grades e ' +
      'o histórico de E-mails Enviados — com passos e problemas comuns.',
    data_lancamento: '2026-07-20',
  },
  {
    versao: '1.1.3.74',
    tipo: 'BUG',
    titulo: 'Família de Produtos: erro ao salvar',
    descricao:
      'Corrigido o aviso «Sessão expirada ou não autenticado» ao salvar Família de Produtos — ' +
      'as requisições passam a enviar o token de autenticação.',
    data_lancamento: '2026-07-20',
  },
  {
    versao: '1.1.3.74',
    tipo: 'BUG',
    titulo: 'Download de fotos de produtos (ZIP)',
    descricao:
      'Corrigido o erro «archiver is not a function» ao baixar fotos em lote na tela de Produtos.',
    data_lancamento: '2026-07-20',
  },
  {
    versao: '1.1.3.74',
    tipo: 'MELHORIA',
    titulo: 'Faturar pedidos em lote',
    descricao:
      'Na lista de Pedidos, selecione vários e use Mais ações → Faturar pedido(s): cada um é faturado com o valor total ' +
      'e a data de hoje. Já faturados/cancelados são ignorados. O painel Comissão & Faturamentos continua pedido a pedido.',
    data_lancamento: '2026-07-20',
  },
  {
    versao: '1.1.3.74',
    tipo: 'BUG',
    titulo: 'Ações em lote nos pedidos corrigidas',
    descricao:
      'Aprovar/cancelar em lote falhava em várias bases (coluna status incompatível). Também: selecionar todos ' +
      'volta a funcionar, o botão de confirmar do diálogo de exclusão/cancelamento ficou claro, e IDs da seleção ' +
      'ficaram consistentes.',
    data_lancamento: '2026-07-20',
  },
  {
    versao: '1.1.3.74',
    tipo: 'MELHORIA',
    titulo: 'Exclusão em lote de produtos',
    descricao:
      'Na lista de Produtos, ao marcar um ou mais itens (ou Selecionar todos), aparece uma barra inferior ' +
      'com Ativar, Inativar e Excluir em lote. A exclusão pede confirmação e respeita a permissão do perfil.',
    data_lancamento: '2026-07-20',
  },
  {
    versao: '1.1.3.74',
    tipo: 'MELHORIA',
    titulo: 'Cadastros Financeiros no menu Financeiro',
    descricao:
      'Formas de Pagamento, Bancos, Despesas, Plano de Contas e Centro de Custo saíram de Cadastros ' +
      'e passaram para o novo grupo Cadastros Financeiros dentro do módulo Financeiro.',
    data_lancamento: '2026-07-20',
  },
  {
    versao: '1.1.3.74',
    tipo: 'MELHORIA',
    titulo: 'E-mails Enviados no menu Comercial',
    descricao:
      'A tela de histórico de E-mails Enviados saiu do Financeiro e passou para Comercial › Vendas, ' +
      'junto das Campanhas WhatsApp.',
    data_lancamento: '2026-07-20',
  },
  {
    versao: '1.1.3.74',
    tipo: 'BUG',
    titulo: 'Cheques: coluna status em bases legadas',
    descricao:
      'Em bases que já tinham a tabela cheques sem a coluna status, a listagem falhava. ' +
      'O sistema passa a criar automaticamente as colunas faltantes.',
    data_lancamento: '2026-07-20',
  },
  {
    versao: '1.1.3.74',
    tipo: 'BUG',
    titulo: 'Cheques de Terceiros: erro ao listar',
    descricao:
      'Corrigida a listagem que falhava com «Unknown column razaosocial» — o nome do cliente ' +
      'passa a usar as colunas corretas (nome/apelido).',
    data_lancamento: '2026-07-20',
  },
  {
    versao: '1.1.3.74',
    tipo: 'MELHORIA',
    titulo: 'Confirmação visual ao gerar fatura no Contas a Pagar',
    descricao:
      'Em Cartões Corporativos (e Cheques), a pergunta de confirmação deixa o alerta nativo do navegador ' +
      'e passa a usar o modal do sistema, com título claro e valor/vencimento da fatura.',
    data_lancamento: '2026-07-20',
  },
  {
    versao: '1.1.3.74',
    tipo: 'NOVO',
    titulo: 'Cartões, cheques, previsão de caixa e e-mails',
    descricao:
      'Financeiro: cadastro de Cartões Corporativos (fatura → Contas a Pagar), carteira de Cheques de Terceiros ' +
      '(receber → pagar com rastreio), Previsão de Caixa consolidada e histórico de E-mails Enviados (SMTP, sem inbox).',
    data_lancamento: '2026-07-20',
  },
  {
    versao: '1.1.3.74',
    tipo: 'MELHORIA',
    titulo: 'Grade fechada: múltiplo do pack no pedido',
    descricao:
      'Quando a grade estiver como Fechada (ex.: múltiplo de 12), o pedido exige que o total dos tamanhos ' +
      'seja múltiplo do pack — aviso no modal da grade e bloqueio ao incluir/salvar. Grades Abertas continuam livres.',
    data_lancamento: '2026-07-20',
  },
  {
    versao: '1.1.3.74',
    tipo: 'NOVO',
    titulo: 'Subfamília, linha e mark-up líquido no produto',
    descricao:
      'No cadastro de Produtos: Subfamília (Masculino/Feminino/Infantil), Linha de Produto, Campo Extra e Mark-up Líquido % ' +
      '(calculado após custo e comissão). Também disponíveis na Importação de Preços. Em Grades: modo Aberta ou Fechada com múltiplo do pack.',
    data_lancamento: '2026-07-20',
  },
  {
    versao: '1.1.3.74',
    tipo: 'BUG',
    titulo: 'Busca de produtos no pedido muito mais rápida',
    descricao:
      'Corrigida lentidão ao pesquisar produtos para incluir itens no pedido (em algumas bases a busca levava ' +
      'mais de 30 segundos). A listagem e a pesquisa do catálogo agora respondem em instantes.',
    data_lancamento: '2026-07-20',
  },
  {
    versao: '1.1.3.72',
    tipo: 'MELHORIA',
    titulo: 'Showroom mais rápido para vender',
    descricao:
      'O Showroom ganhou visual mais limpo, cards com descrição e preço, barra fixa do carrinho com total, ' +
      'e botão claro «Adicionar ao pedido» no detalhe do produto — facilitando a venda com o cliente na frente.',
    data_lancamento: '2026-07-16',
  },
  {
    versao: '1.1.3.72',
    tipo: 'MELHORIA',
    titulo: 'Referência mãe: criar cores, importar e catálogos',
    descricao:
      'No cadastro de Produtos, a referência mãe ganhou o botão «Adicionar cor» (clona e já vincula o SKU). ' +
      'Na Importação de Preços, mapeie a coluna «Referência mãe» (ID ou Cód. Fabricante da mãe — importe as mães antes). ' +
      'Em Catálogos Visuais, ao adicionar a mãe você pode incluir as cores automaticamente.',
    data_lancamento: '2026-07-16',
  },
  {
    versao: '1.1.3.72',
    tipo: 'MELHORIA',
    titulo: 'Showroom: referência mãe com seleção de cores',
    descricao:
      'No Showroom, produtos vinculados como cores aparecem agrupados na referência mãe. ' +
      'Ao abrir a referência, escolha a cor (com foto) antes de incluir no carrinho. ' +
      'Pedido e estoque continuam no SKU da cor; produtos sem vínculo seguem iguais.',
    data_lancamento: '2026-07-16',
  },
  {
    versao: '1.1.3.72',
    tipo: 'NOVO',
    titulo: 'Referência mãe e cores no produto (opt-in)',
    descricao:
      'No cadastro de Produtos (aba Outras Informações) você pode vincular um SKU como cor de uma referência mãe — sem mudar pedido, preço ou estoque. ' +
      'Produtos sem vínculo continuam iguais. O Showroom ainda não agrupa (próxima etapa).',
    data_lancamento: '2026-07-16',
  },
  {
    versao: '1.1.3.72',
    tipo: 'BUG',
    titulo: 'Perfis: Plano de Contas e Balancete no cadastro',
    descricao:
      'As permissões de Plano de Contas, Centro de Custo e Balancete passaram a aparecer em Sistema → Perfis. ' +
      'Antes, ao salvar um perfil essas telas podiam sumir do menu. O salvamento também deixa de zerar permissões que o formulário não envia.',
    data_lancamento: '2026-07-16',
  },
  {
    versao: '1.1.3.72',
    tipo: 'BUG',
    titulo: 'Plano de Contas: erro numero_pai ao salvar',
    descricao:
      'Em bases com plano de contas do Delphi, salvar ou carregar o modelo podia falhar com «Field numero_pai doesn\'t have a default value». ' +
      'O sistema agora preenche o número da conta pai e aceita o campo legado sem alterar suas contas existentes.',
    data_lancamento: '2026-07-16',
  },
  {
    versao: '1.1.3.72',
    tipo: 'BUG',
    titulo: 'DRE e Plano de Contas: sessão ao salvar/carregar',
    descricao:
      'O DRE, Plano de Contas, Centro de Custo, Despesas e Natureza não enviavam o token de autenticação e podiam mostrar «sessão expirada» mesmo logado. Agora as telas enviam o token corretamente.',
    data_lancamento: '2026-07-16',
  },
  {
    versao: '1.1.3.72',
    tipo: 'MELHORIA',
    titulo: 'Filtros e razão do Plano de Contas',
    descricao:
      'Nas listagens de Contas a Pagar e a Receber você pode filtrar por conta contábil e centro de custo (opcional). ' +
      'No Receber a coluna Conta aparece na grade; no Pagar ative Conta/Centro em Colunas. ' +
      'No Plano de Contas há «Carregar plano modelo» (só cria números que ainda não existem). ' +
      'No Balancete, clique numa conta analítica para ver o razão dos lançamentos do período.',
    data_lancamento: '2026-07-16',
  },
  {
    versao: '1.1.3.72',
    tipo: 'MELHORIA',
    titulo: 'Plano de Contas: sugestão automática e balancete com grupos',
    descricao:
      'Ao escolher a Despesa/Natureza no título, a conta contábil é sugerida automaticamente. ' +
      'O Balancete consolida totais nas contas sintéticas (grupos), destaca hierarquia e permite exportar CSV.',
    data_lancamento: '2026-07-16',
  },
  {
    versao: '1.1.3.72',
    tipo: 'BUG',
    titulo: 'DRE e BI passam a usar Despesa e Plano de Contas',
    descricao:
      'O DRE e a Inteligência Financeira classificavam despesas pela tabela Natureza (join errado). ' +
      'Agora usam a Despesa do título (id_despesas) e o Plano de Contas (conta do título ou da Despesa). ' +
      'O DRE ganhou o bloco «Despesas por Plano de Contas»; o gráfico de categorias do BI segue a mesma regra.',
    data_lancamento: '2026-07-16',
  },
  {
    versao: '1.1.3.72',
    tipo: 'NOVO',
    titulo: 'Plano de Contas e Centro de Custo (gerencial)',
    descricao:
      'Cadastre o Plano de Contas (hierárquico: sintética/analítica) e Centros de Custo em Cadastros. ' +
      'Vincule a conta em Despesas e Natureza; nos títulos de Pagar/Receber dá para informar conta e centro (opcional). ' +
      'Em Financeiro → Balancete Gerencial você vê entradas e saídas liquidadas por conta no período.',
    data_lancamento: '2026-07-16',
  },
  {
    versao: '1.1.3.72',
    tipo: 'MELHORIA',
    titulo: 'Ajuda: como baixar fotos de produtos',
    descricao:
      'Na Central de Ajuda → Produtos há o tópico «Como baixar fotos»: ZIP de um produto ou do filtro da lista, lotes de 500 quando há muitos itens, e o padrão de nomes igual à importação.',
    data_lancamento: '2026-07-16',
  },
  {
    versao: '1.1.3.72',
    tipo: 'MELHORIA',
    titulo: 'Pedidos: mais ações na barra de seleção',
    descricao:
      'Ao selecionar pedidos na lista, o rodapé ganhou o menu «Mais ações»: Comissão & Faturamentos, Faturar, Agendar Visita, Agendar Retorno, Marcar Enviado e Excluir — sem lotar a barra. ' +
      'Comissão/Faturar pedem 1 pedido; visita exige o mesmo cliente; retorno pode ser em lote.',
    data_lancamento: '2026-07-16',
  },
  {
    versao: '1.1.3.72',
    tipo: 'MELHORIA',
    titulo: 'Tabela de Preços: liberar no Showroom',
    descricao:
      'No cadastro da tabela de preços há a opção «Aparece no Showroom?». ' +
      'Por padrão fica Não — só as tabelas marcadas com Sim entram na lista de tabelas do Showroom. Coleções e catálogo por fábrica continuam normalmente.',
    data_lancamento: '2026-07-16',
  },
  {
    versao: '1.1.3.72',
    tipo: 'MELHORIA',
    titulo: 'Pedidos: coluna Hora de abertura na lista',
    descricao:
      'Na lista de Pedidos, a coluna «HORA» mostra a hora de abertura do pedido. ' +
      'Ela vem desligada por padrão — ative em Colunas (ícone de engrenagem) se quiser ver na grade, nos cards e no kanban.',
    data_lancamento: '2026-07-16',
  },
  {
    versao: '1.1.3.72',
    tipo: 'NOVO',
    titulo: 'Tabela de Preços: exportar itens para Excel',
    descricao:
      'Ao abrir uma tabela de preços, use o botão «Exportar Excel» na grade de itens para baixar a planilha (.xlsx) com código, fabricante, descrição, preços, desconto, valor de tabela, ativo e vigência.',
    data_lancamento: '2026-07-16',
  },
  {
    versao: '1.1.3.72',
    tipo: 'NOVO',
    titulo: 'Produtos: baixar fotos para o computador',
    descricao:
      'Na tela de Produtos, use «Baixar Fotos» para gerar um ZIP com as fotos do filtro atual (até 500 produtos), ' +
      'ou abra um produto na aba Fotos e use «Baixar» só daquele item. Os arquivos saem com o nome do cód. fabricante — o mesmo padrão da importação em lote.',
    data_lancamento: '2026-07-16',
  },
  {
    versao: '1.1.3.72',
    tipo: 'MELHORIA',
    titulo: 'Showroom: fotos das referências sem corte',
    descricao:
      'Na grade de referências do Showroom, as fotos do produto passam a aparecer inteiras (sem cortar nas bordas), com margem e cards um pouco maiores no tablet/desktop. ' +
      'Itens sem foto mostram um ícone de câmera mais visível.',
    data_lancamento: '2026-07-16',
  },
  {
    versao: '1.1.3.70',
    tipo: 'BUG',
    titulo: 'Mobile: mesmo produto no pedido agora soma corretamente',
    descricao:
      'No app mobile, ao incluir o mesmo produto de novo (ex.: Adidas Super Nova), o sistema criava outra linha em vez de somar a quantidade. ' +
      'Corrigido: toque duplo em Incluir não duplica mais, e com a fábrica em «Somar na mesma linha» as quantidades são unificadas automaticamente.',
    data_lancamento: '2026-07-14',
  },
  {
    versao: '1.1.3.69',
    tipo: 'MELHORIA',
    titulo: 'Home: Showroom em destaque ao lado da Vitrine',
    descricao:
      'Na home (desktop), a Vitrine Digital e o novo Showroom aparecem em dois cards lado a lado, com resumo e atalho para cada um. ' +
      'O banner «Tem uma ideia ou encontrou um bug?» virou ícone no rodapé, ao lado de Novidades — a home fica mais limpa sem perder o acesso ao suporte.',
    data_lancamento: '2026-07-14',
  },
  {
    versao: '1.1.3.69',
    tipo: 'BUG',
    titulo: 'Home: aba Pedidos não ficava presa após fechar',
    descricao:
      'Ao fechar a última aba (ex.: Pedidos) e voltar ao dashboard, a etiqueta da aba continuava visível no rodapé da tela. ' +
      'Agora a barra de abas é limpa corretamente ao fechar a última tela.',
    data_lancamento: '2026-07-14',
  },
  {
    versao: '1.1.3.68',
    tipo: 'MELHORIA',
    titulo: 'Fotos de produto sem corte na lista e no pedido',
    descricao:
      'As miniaturas de produto na lista de Produtos (desktop e mobile) e na tela de Pedidos (itens, busca, cards no celular e impressão/PDF) passam a mostrar a foto completa, sem cortar nas bordas do quadrado.',
    data_lancamento: '2026-07-14',
  },
  {
    versao: '1.1.3.68',
    tipo: 'MELHORIA',
    titulo: 'Showroom: sem menu lateral + pedidos pendentes',
    descricao:
      'O Showroom ficou no padrão do sistema: sem a barra lateral de ícones. No topo ficam Carrinho e Pedidos pendentes. ' +
      'A lista de pendentes usa a mesma regra de visibilidade da tela de Pedidos (vendedor vê os seus; gerente a equipe; admin todos). ' +
      'Disponível também no celular/tablet (Mais → Showroom).',
    data_lancamento: '2026-07-14',
  },
  {
    versao: '1.1.3.68',
    tipo: 'NOVO',
    titulo: 'Showroom independente — pré-pedido visual',
    descricao:
      'Novo Showroom (Comercial → Vendas ou botão na barra superior): navegação visual com coleções, fotos, detalhe e grade — igual às telas de força de vendas. ' +
      'Monte o carrinho, informe cliente, condição/forma de pagamento e tipo do pedido, e finalize. O pedido entra em Pedidos como Pendente (origem SHOWROOM). ' +
      'Independente da tela de Pedidos, no mesmo espírito da Vitrine Digital. O botão Catálogo dentro do pedido continua disponível.',
    data_lancamento: '2026-07-14',
  },
  {
    versao: '1.1.3.68',
    tipo: 'NOVO',
    titulo: 'Catálogos Visuais — montar coleções para o Showroom e o pedido',
    descricao:
      'Em Comercial → Catálogos Visuais você monta coleções com capa e produtos (um a um ou em lote por fábrica/tabela). ' +
      'As coleções alimentam o Showroom e o botão Catálogo na aba Itens do pedido.',
    data_lancamento: '2026-07-14',
  },
  {
    versao: '1.1.3.68',
    tipo: 'MELHORIA',
    titulo: 'Enviar WhatsApp: caixa de mensagem com formatação, emoji e anexo',
    descricao:
      'Ao clicar em «Enviar WhatsApp» na tela de Clientes, agora abre uma caixa de mensagem completa — negrito, itálico, riscado, emojis e opção de anexar arquivo (imagem, PDF, documento até 10MB). ' +
      'Substitui a caixa simples de texto usada antes. Continua enviando pela API (EuAtendo/Evolution) quando configurada, com registro no histórico do cliente.',
    data_lancamento: '2026-07-14',
  },
  {
    versao: '1.1.3.68',
    tipo: 'MELHORIA',
    titulo: 'WhatsApp na lista de clientes usa a API quando configurada',
    descricao:
      'Ao clicar no ícone verde ou em «Enviar WhatsApp» na tela de Clientes, se o EuAtendo (ou Evolution) estiver configurado e online, a mensagem sai pela API — sem abrir o WhatsApp Web (wa.me). ' +
      'Você digita o texto na caixa de mensagem; o envio fica registrado no histórico do cliente. Sem API, continua abrindo o wa.me.',
    data_lancamento: '2026-07-14',
  },
  {
    versao: '1.1.3.68',
    tipo: 'MELHORIA',
    titulo: 'Catálogo: incluir produtos em lote por fábrica ou tabela',
    descricao:
      'Ao montar um catálogo visual, além de buscar produto a produto, agora dá para incluir em lote todos os itens de uma fábrica ou de uma tabela de preço. ' +
      'Itens já na lista não são duplicados; dá para limpar a lista e ajustar antes de salvar.',
    data_lancamento: '2026-07-14',
  },
  {
    versao: '1.1.3.68',
    tipo: 'MELHORIA',
    titulo: 'Catálogo visual: por coleção, fábrica ou tabela de preço',
    descricao:
      'No botão Catálogo do pedido, escolha como navegar: Coleções (montadas por você), Fábricas (catálogo completo da indústria) ou Tabelas de preço (produtos com preço na tabela). ' +
      'O fluxo de fotos, detalhe, grade/quantidade e inclusão no pedido pendente é o mesmo nos três modos.',
    data_lancamento: '2026-07-14',
  },
  {
    versao: '1.1.3.68',
    tipo: 'NOVO',
    titulo: 'Campanhas WhatsApp — envio em massa para clientes',
    descricao:
      'Nova tela Vendas → Campanhas WhatsApp: selecione clientes por região, vendedor ou dias sem compra, ' +
      'escreva a mensagem com variáveis ({nome}, {cidade}) e dispare com ritmo controlado (6–12s entre mensagens, proteção anti-bloqueio). ' +
      'Acompanhe o progresso em tempo real; cada envio entra no histórico do cliente. ' +
      'Funciona com EuAtendo (ApiChat) ou Evolution API. Guia completo em Ajuda → Campanhas WhatsApp.',
    data_lancamento: '2026-07-14',
  },
  {
    versao: '1.1.3.68',
    tipo: 'NOVO',
    titulo: 'Histórico de mensagens enviadas ao cliente',
    descricao:
      'Cada envio de pedido por WhatsApp ou e-mail agora fica registrado no cliente: data, canal, número/e-mail de destino, quem enviou, pedido vinculado e status (enviado ou falhou, com o motivo). ' +
      'Consulte no botão «Histórico» da tela de Clientes — seção «Mensagens Enviadas», abaixo dos pedidos.',
    data_lancamento: '2026-07-14',
  },
  {
    versao: '1.1.3.68',
    tipo: 'NOVO',
    titulo: 'WhatsApp: integração com a plataforma EuAtendo',
    descricao:
      'Novo provedor de envio de mensagens WhatsApp: além da Evolution API, agora é possível usar o EuAtendo (plataforma hospedada, sem QR Code por usuário). ' +
      'Configure em Configurações de API → WhatsApp — API de Envio, escolhendo o provedor «EuAtendo» e informando o token da conexão. ' +
      'O envio de pedidos em PDF e as mensagens de teste passam a sair pela plataforma escolhida. ' +
      'Passo a passo completo em Ajuda → Configurações → Configurações WhatsApp.',
    data_lancamento: '2026-07-14',
  },
  {
    versao: '1.1.3.68',
    tipo: 'BUG',
    titulo: 'Clientes: lista vazia com isolamento por empresa (legado)',
    descricao:
      'Corrigida a listagem de clientes quando «compartilhar cliente entre empresas» está desligado e os cadastros legados não têm empresa preenchida. ' +
      'Admin e usuários voltam a ver a carteira normalmente (clientes sem empresa continuam visíveis).',
    data_lancamento: '2026-07-10',
  },
  {
    versao: '1.1.3.65',
    tipo: 'BUG',
    titulo: 'Usuários: Vendedor Vinculado agora grava corretamente',
    descricao:
      'Corrigido o salvamento do campo «Vendedor Vinculado» na aba Vínculos. ' +
      'Antes, o valor aparecia na tela mas não era gravado no banco — por isso surgia a mensagem «Fornecedores não gravados» mesmo com o campo preenchido. ' +
      'Salve o usuário novamente; a mensagem não deve mais aparecer.',
    data_lancamento: '2026-07-09',
  },
  {
    versao: '1.1.3.63',
    tipo: 'NOVO',
    titulo: 'Combo Tipo Documento agora é opcional',
    descricao:
      'O campo «Tipo Documento» do pedido pode ser ocultado ou exibido conforme a preferência da empresa: ' +
      'em Sistema → Configuração do Sistema → Pedidos, ative «Exibir Tipo Documento no Pedido». ' +
      'Quando exibido, o preenchimento deixou de ser obrigatório.',
    data_lancamento: '2026-07-09',
  },
  {
    versao: '1.1.3.56',
    tipo: 'NOVO',
    titulo: 'Vitrine Digital: link aberto sem cliente',
    descricao:
      'Gere um catálogo público sem amarrar a um cliente cadastrado — na home (aba «Link aberto») ou no app mobile (menu Mais → Vitrine Digital). ' +
      'Quem abrir o link monta o pedido e informa apenas nome e WhatsApp; o orçamento chega ao representante com o contato na observação.',
    data_lancamento: '2026-07-06',
  },
  {
    versao: '1.1.3.56',
    tipo: 'NOVO',
    titulo: 'Observações para o próximo pedido',
    descricao:
      'Na aba Observações do pedido, use o campo «Observações para o próximo pedido» para anotar o que ficou pendente na visita. ' +
      'No próximo pedido do mesmo cliente com a mesma fábrica, a anotação aparece em destaque — inclusive no app mobile. ' +
      'Ao salvar o pedido novo, ela deixa de ser sugerida automaticamente.',
    data_lancamento: '2026-07-06',
  },
  {
    versao: '1.1.3.54',
    tipo: 'BUG',
    titulo: 'PDF/impressão de pedido: preço por kilo corrigido',
    descricao:
      'Na visualização e no PDF do pedido, itens vendidos por peso (R$/kg) voltam a somar o valor certo: ' +
      'Quantidade × Peso (kg) × Preço/kg. Antes o relatório multiplicava só preço × quantidade, ignorando o peso, ' +
      'e o total do PDF ficava menor que o do pedido salvo. Os valores gravados no pedido sempre estiveram corretos — ' +
      'a diferença era apenas na impressão.',
    data_lancamento: '2026-07-03',
  },
  {
    versao: '1.1.3.50',
    tipo: 'NOVO',
    titulo: 'Login offline no celular',
    descricao:
      'Se o vendedor sair do sistema (ou a sessão cair) e estiver sem internet, agora consegue entrar de novo: ' +
      'o login funciona offline com a mesma senha usada no último acesso online neste aparelho (validade de 7 dias). ' +
      'A senha não fica gravada — apenas uma assinatura criptografada dela.',
    data_lancamento: '2026-07-02',
  },
  {
    versao: '1.1.3.41',
    tipo: 'MELHORIA',
    titulo: 'App mobile volta a abrir sem internet',
    descricao:
      'O aplicativo instalado no celular volta a abrir mesmo sem conexão (rua, área sem sinal). ' +
      'Abra o app uma vez conectado para atualizar e mantenha o pacote offline preparado (Pedidos → Preparar offline). ' +
      'Também corrigido: pedido salvo em Wi-Fi sem internet agora entra na fila offline em vez de mostrar erro.',
    data_lancamento: '2026-07-02',
  },
  {
    versao: '1.1.3.28',
    tipo: 'NOVO',
    titulo: 'Modal de novidades na abertura do sistema',
    descricao:
      'Ao entrar, você vê um painel interativo com melhorias e correções recentes. ' +
      'Toque na versão (canto inferior do menu) para rever. Admin cadastra em Sistema → Notas de Versão.',
    data_lancamento: '2026-06-28',
  },
  {
    versao: '1.1.3.28',
    tipo: 'MELHORIA',
    titulo: 'Ajuda de Comissões com busca inteligente',
    descricao:
      'Na Ajuda de Comissões, digite sua dúvida (ex.: "como gerar comissão do preposto") ' +
      'e o sistema mostra o passo a passo correspondente.',
    data_lancamento: '2026-06-28',
  },
  {
    versao: '1.1.3.28',
    tipo: 'BUG',
    titulo: 'Vitrine: tabelas com «Liberar na vitrine» sem vínculo ao cliente',
    descricao:
      'Tabelas marcadas «Liberar na vitrine?» = Sim passam a aparecer no catálogo sem precisar vincular o cliente na tabela de preços.',
    data_lancamento: '2026-06-28',
  },
  {
    versao: '1.1.3.28',
    tipo: 'MELHORIA',
    titulo: 'Vitrine Digital: paginação ao escolher tabelas do link',
    descricao:
      'Ao gerar o link da vitrine com várias tabelas, a lista passa a ter páginas (10 por vez), busca e duas colunas — mais fácil marcar e desmarcar sem rolar uma lista enorme.',
    data_lancamento: '2026-06-28',
  },
  {
    versao: '1.1.3.28',
    tipo: 'MELHORIA',
    titulo: 'Novidades sempre acessíveis na barra inferior',
    descricao:
      'Botão «Novidades» na barra de status (canto inferior esquerdo) abre o painel de atualizações a qualquer hora. O aviso automático na entrada só aparece para o que você ainda não viu.',
    data_lancamento: '2026-06-28',
  },
  {
    versao: '1.1.3.28',
    tipo: 'MELHORIA',
    titulo: 'Histórico de novidades com layout amplo e paginação',
    descricao:
      'A tela «Ver histórico» (no modal de novidades) foi redesenhada: filtros, busca, cards em duas colunas e paginação moderna.',
    data_lancamento: '2026-06-28',
  },
  {
    versao: '1.1.3.32',
    tipo: 'BUG',
    titulo: 'Cadastro de usuários: senha aparece ao editar',
    descricao:
      'Na aba Acesso, ao abrir um usuário para edição, o campo Senha passa a exibir a senha cadastrada em vez de ficar vazio.',
    data_lancamento: '2026-06-29',
  },
  {
    versao: '1.1.3.33',
    tipo: 'MELHORIA',
    titulo: "Ajustes nos relatorios de comissões",
    descricao: "",
    data_lancamento: '2026-06-30',
  },
  {
    versao: '1.1.3.34',
    tipo: 'NOVO',
    titulo: "Aviso sobre Play Protec",
    descricao: "Play Protect",
    data_lancamento: '2026-06-30',
  },
  {
    versao: '1.1.3.35',
    tipo: 'BUG',
    titulo: 'Pedidos: cancelar em massa voltou a funcionar',
    descricao:
      'O botão Cancelar da barra de seleção na lista de pedidos passa a marcar corretamente ' +
      'os registros como CANCELADO (antes confirmava mas não gravava o status).',
    data_lancamento: '2026-06-30',
  },
  {
    versao: '1.1.3.35',
    tipo: 'MELHORIA',
    titulo: 'Cancelar pedido ou orçamento no menu de ações',
    descricao:
      'No menu ⋮ de cada linha da lista de pedidos, nova opção «Cancelar pedido» ou ' +
      '«Cancelar orçamento» — sem precisar abrir o pedido nem usar só a barra em massa.',
    data_lancamento: '2026-06-30',
  },
  {
    versao: '1.1.3.35',
    tipo: 'NOVO',
    titulo: 'Agendar retorno em pedido ou orçamento',
    descricao:
      'Quando o cliente pede para voltar a falar em uma data (ex.: 30/07), use ⋮ → Agendar retorno. ' +
      'Informe a data e uma observação. O sistema lembra na lista e na home.',
    data_lancamento: '2026-06-30',
  },
  {
    versao: '1.1.3.35',
    tipo: 'MELHORIA',
    titulo: 'Lembretes de retorno na home e na lista',
    descricao:
      'Card «Retornos hoje» na home (toque abre os pedidos/orçamentos do dia). Na lista, badge ' +
      '🔔 hoje, ⚠️ atrasado ou 📅 data futura na coluna Status. Filtros: ?retorno=hoje, atrasado ou semana.',
    data_lancamento: '2026-06-30',
  },
  {
    versao: '1.1.3.35',
    tipo: 'MELHORIA',
    titulo: 'Impressão e PDF com título conforme o tipo do documento',
    descricao:
      'Relatório, impressão e envio por WhatsApp/e-mail exibem «ORÇAMENTO Nº …», «PEDIDO Nº …» ' +
      'ou o tipo cadastrado — em vez de sempre «PEDIDO Nº».',
    data_lancamento: '2026-06-30',
  },
  {
    versao: '1.1.3.35',
    tipo: 'MELHORIA',
    titulo: 'Política do modelo de impressão no painel',
    descricao:
      'Em Configurações do sistema, o admin define se vendedores podem editar cabeçalho/rodapé do ' +
      'modelo de impressão e se podem replicar o modelo para todos os usuários.',
    data_lancamento: '2026-06-30',
  },
  {
    versao: '1.1.3.35',
    tipo: 'MELHORIA',
    titulo: 'Alertas de retorno respeitam visibilidade do vendedor',
    descricao:
      'Toast na home, banner em Pedidos e card Retornos hoje contam só pedidos/orçamentos ' +
      'que o seu perfil pode ver (vendedor, gerente, preposto ou admin).',
    data_lancamento: '2026-06-30',
  },
  {
    versao: '1.1.3.35',
    tipo: 'BUG',
    titulo: 'Comissões: correção em relatórios com agrupamento SQL',
    descricao:
      'Extrato e estatísticas de comissões deixam de falhar em bases MySQL com ONLY_FULL_GROUP_BY.',
    data_lancamento: '2026-06-30',
  },
  {
    versao: '1.1.3.35',
    tipo: 'BUG',
    titulo: 'Tipos de Pedido: lista voltou a carregar',
    descricao:
      'A tela Cadastros → Tipos de Pedido exibia "Nenhum tipo de pedido encontrado" mesmo com registros no banco. A listagem e o CRUD passam a autenticar corretamente na API.',
    data_lancamento: '2026-06-30',
  },
  {
    versao: '1.1.3.35',
    tipo: 'MELHORIA',
    titulo: 'Home: pedidos do mês só com financeiro',
    descricao:
      'O card Pedidos do Mês (e faturamento/ticket médio) considera apenas tipos com Gera Financeiro = Sim, via vínculo id_tipopedido. Orçamentos do mês aparecem em card separado quando existirem. Vendedor continua vendo só a própria carteira.',
    data_lancamento: '2026-06-30',
  },
  {
    versao: '1.1.3.35',
    tipo: 'MELHORIA',
    titulo: 'Card Orçamentos do Mês abre lista filtrada',
    descricao:
      'Ao tocar no card Orçamentos do Mês na home, a tela Pedidos abre já filtrada pelos orçamentos do mês corrente (tipos sem geração financeira), respeitando a visibilidade do vendedor.',
    data_lancamento: '2026-06-30',
  },
  {
    versao: '1.1.3.35',
    tipo: 'BUG',
    titulo: 'Pedidos: filtro de orçamentos pela home',
    descricao:
      'O link Orçamentos do Mês não excluía mais a lista por conflito com filtros salvos (ex.: tipo Pedido) e reconhece ORÇAMENTO com cedilha. Período do mês passa a incluir o dia inteiro.',
    data_lancamento: '2026-06-30',
  },
  {
    versao: '1.1.3.35',
    tipo: 'MELHORIA',
    titulo: 'Login mobile com logo da empresa',
    descricao:
      'No celular, o topo do login mostra o logo cadastrado em Empresas (Logo relatório), já ao abrir a tela. O logo PedidosWeb fica discreto no rodapé, ao lado da versão do app.',
    data_lancamento: '2026-06-30',
  },
  {
    versao: '1.1.3.35',
    tipo: 'BUG',
    titulo: 'Login mobile: logo da empresa não aparecia',
    descricao:
      'Corrigido erro que impedia o login mobile de trocar o logo do topo e exibir a marca PedidosWeb no rodapé.',
    data_lancamento: '2026-06-30',
  },
  {
    versao: '1.1.3.35',
    tipo: 'BUG',
    titulo: 'Home: card Retornos hoje abre Pedidos na aba',
    descricao:
      'Clicar em Retornos hoje na home deixava de responder ou travava a tela porque redirecionava a página inteira. Agora abre Pedidos filtrado dentro do sistema, como os demais atalhos.',
    data_lancamento: '2026-06-30',
  },
  {
    versao: '1.1.3.35',
    tipo: 'MELHORIA',
    titulo: 'Login mobile: aviso e rodapé alinhados',
    descricao:
      'Sem logo da empresa, o login mobile mostra «Aguardando logo da empresa». O logo PedidosWeb no rodapé ficou maior e alinhado com a versão do app.',
    data_lancamento: '2026-06-30',
  },
  {
    versao: '1.1.3.37',
    tipo: 'MELHORIA',
    titulo: 'Login mobile com a cara da sua empresa',
    descricao:
      'No celular, ao abrir o login já aparece o logo cadastrado em Empresas → Logo relatório, em destaque no topo. ' +
      'Se a empresa ainda não tiver imagem, mostra «Aguardando logo da empresa». ' +
      'A marca PedidosWeb fica no rodapé, ao lado da versão do app. Ao trocar a filial, o logo atualiza.',
    data_lancamento: '2026-06-30',
  },
  {
    versao: '1.1.3.37',
    tipo: 'MELHORIA',
    titulo: 'Login mobile: logos maiores no topo e no rodapé',
    descricao:
      'Aumentamos o tamanho do logo da empresa no topo do login mobile para ficar mais legível, sem prejudicar o formulário. ' +
      'O logo PedidosWeb no rodapé também ficou um pouco maior e alinhado com a versão.',
    data_lancamento: '2026-06-30',
  },
  {
    versao: '1.1.3.37',
    tipo: 'BUG',
    titulo: 'Login mobile: logo da empresa ao abrir a tela',
    descricao:
      'Corrigido o carregamento do logo no login mobile: a imagem passa a buscar na rota pública /api/login-logo assim que a tela abre, ' +
      'sem precisar digitar a senha. Antes o logo PedidosWeb podia permanecer no topo ou a imagem não carregava.',
    data_lancamento: '2026-06-30',
  },
  {
    versao: '1.1.3.37',
    tipo: 'NOVO',
    titulo: 'Comissões: arquivar histórico sem mexer no financeiro',
    descricao:
      'Em Manutenção de Comissões, use «Arquivar histórico» para dar baixa em lote nas comissões antigas (até uma data). ' +
      'Elas somem das telas e relatórios, como exclusão lógica, mas não estornam pagamentos nem alteram Contas a Pagar. ' +
      'Simule antes, confirme com senha e motivo. Também é possível arquivar uma comissão individual na lista.',
    data_lancamento: '2026-06-30',
  },
  {
    versao: '1.1.3.37',
    tipo: 'BUG',
    titulo: 'Arquivar comissões: confirmação em lote corrigida',
    descricao:
      'Corrigido o erro «Informe a data limite ou selecione registros» ao confirmar o arquivamento em lote. ' +
      'A confirmação passa a enviar a data e os filtros corretamente; basta simular, informar senha e motivo.',
    data_lancamento: '2026-06-30',
  },
  {
    versao: '1.1.3.37',
    tipo: 'MELHORIA',
    titulo: 'Manutenção de Comissões: modal de arquivamento centralizado',
    descricao:
      'O modal de arquivar comissões (em lote ou por linha) abre centralizado na tela, ' +
      'mesmo com a página aberta dentro do menu principal.',
    data_lancamento: '2026-06-30',
  },
  {
    versao: '1.1.3.37',
    tipo: 'MELHORIA',
    titulo: 'Pedidos mobile: excluir itens na lista',
    descricao:
      'Na aba Itens do pedido no celular, a lista compacta continua igual: toque na linha para editar. ' +
      'O excluir ficou discreto no canto inferior direito de cada item (ícone cinza; vermelho ao tocar).',
    data_lancamento: '2026-06-30',
  },
  {
    versao: '1.1.3.38',
    tipo: 'NOVO',
    titulo: 'Pedidos: excluir vários itens de uma vez',
    descricao:
      'Na aba Itens, toque em «Selecionar» para marcar vários produtos e excluir em lote. ' +
      'A lista mantém o mesmo formato: no modo seleção, o checkbox aparece no lugar da lixeira. ' +
      'Use Página ou Todos na barra de ações; toque em «Pronto» para voltar ao modo normal.',
    data_lancamento: '2026-06-30',
  },
  {
    versao: '1.1.3.38',
    tipo: 'NOVO',
    titulo: 'Pedidos: rascunho automático no aparelho',
    descricao:
      'Enquanto monta um pedido, o sistema salva uma cópia de segurança neste aparelho (a cada alteração e ao minimizar o app). ' +
      'Se a internet cair ou você fechar sem querer, ao abrir de novo aparece a opção de restaurar o rascunho. ' +
      'O badge «Rascunho» no topo confirma que está protegido; some após Salvar com sucesso.',
    data_lancamento: '2026-06-30',
  },
  {
    versao: '1.1.3.38',
    tipo: 'MELHORIA',
    titulo: 'Política de carteira de clientes simplificada',
    descricao:
      'Em Sistema → Configuração, escolha Legado, Carteira fechada, Por equipe ou Aberta. ' +
      'No modo Carteira fechada, quem cadastra o cliente fica como vendedor responsável e outro representante não acessa ficha, pedido, rota nem histórico. ' +
      'Bases antigas permanecem em Legado até o administrador mudar.',
    data_lancamento: '2026-07-02',
  },
  {
    versao: '1.1.3.38',
    tipo: 'MELHORIA',
    titulo: 'Campo Vendedor na aba Geral do cliente',
    descricao:
      'Representante na aba Geral: tipo cadastro, código e vendedor na mesma linha; nome ao lado do apelido. ' +
      'Com Carteira fechada, o vendedor é obrigatório.',
    data_lancamento: '2026-07-02',
  },
  {
    versao: '1.1.3.38',
    tipo: 'BUG',
    titulo: 'Cliente sem vendedor com carteira fechada',
    descricao:
      'Com Política de carteira = Carteira fechada, o sistema não permite mais salvar cliente sem representante. ' +
      'O campo Vendedor na aba Geral exibe asterisco obrigatório e bloqueia o salvamento na tela e no servidor.',
    data_lancamento: '2026-07-02',
  },
  {
    versao: '1.1.3.60',
    tipo: 'BUG',
    titulo: '«Recuperar rascunho» só aparece no app mobile',
    descricao:
      'O aviso para restaurar um rascunho não salvo passava a aparecer também no desktop ao abrir um pedido ou orçamento já salvo. ' +
      'Agora só é oferecido no app mobile, que é o cenário real de uso (app minimizado em campo).',
    data_lancamento: '2026-07-08',
  },
  {
    versao: '1.1.3.60',
    tipo: 'MELHORIA',
    titulo: 'Ações rápidas do pedido mais compactas',
    descricao:
      'No pedido, os botões de Cliente e Fábrica (Detalhes, Financeiro, Histórico, Visitas/Atividades, Perto de Mim, Promoções, etc.) ' +
      'foram organizados num menu «⋮», mantendo só a ação mais usada (Repetir último / Trocar fábrica) sempre visível. ' +
      'Menos espaço ocupado na tela, funcionando igual no desktop e no celular.',
    data_lancamento: '2026-07-08',
  },
  {
    versao: '1.1.3.60',
    tipo: 'MELHORIA',
    titulo: 'Tipo Documento ao lado de Data Abertura',
    descricao:
      'Na aba Dados do pedido, o campo Tipo Documento passou para a linha de Data Abertura/Status/Vendedor, ' +
      'deixando o formulário mais enxuto — sem esmagar nomes longos, inclusive no celular.',
    data_lancamento: '2026-07-08',
  },
  {
    versao: '1.1.3.127',
    tipo: 'BUG',
    titulo: 'Salvar tabela de preços importada em lote',
    descricao:
      'Ao importar produtos em lote, itens sem preço de venda no cadastro deixavam o campo vazio e o salvamento falhava. ' +
      'Agora o preço é normalizado (0 quando ausente) e o valor da tabela é recalculado corretamente.',
    data_lancamento: '2026-08-30',
  },
  {
    versao: '1.1.3.149',
    tipo: 'MELHORIA',
    titulo: 'Vitrine Digital mais ágil no catálogo',
    descricao:
      'No catálogo público (link da vitrine): tabelas de preço com avatar e contagem, seletor responsivo (popover no tablet / lista no celular), ' +
      'imagens com proporção fixa e carregamento suave, quantidade escolhida no card antes de adicionar, ' +
      'resumo do carrinho no topo (desktop) e rodapé (celular), atalhos de ordenação e botão voltar ao topo.',
    data_lancamento: '2026-09-21',
  },
  {
    versao: '1.1.3.149',
    tipo: 'MELHORIA',
    titulo: 'Modal Vitrine Digital modernizado',
    descricao:
      'O painel de gerar link da Vitrine Digital ficou mais claro: fechar com X, validade em destaque, aparência Dia/Noite em controle único, ações em ícones (WhatsApp, copiar, abrir, QR) e seleção de tabelas com chips — funciona no computador, tablet e celular.',
    data_lancamento: '2026-09-21',
  },
  {
    versao: '1.1.3.149',
    tipo: 'BUG',
    titulo: 'Showroom: toque no celular abre as cores',
    descricao:
      'No Showroom (celular), tocar na referência ou na cor do modal às vezes não fazia nada. ' +
      'Agora o card responde ao toque e, em Escolher cores, tocar em qualquer área do card (não só na foto) marca a cor.',
    data_lancamento: '2026-09-22',
  },
  {
    versao: '1.1.3.160',
    tipo: 'MELHORIA',
    titulo: 'Tabela de preços: coluna Preço Custo',
    descricao:
      'Na edição da tabela de preços, a grade de itens mostra o Preço Custo do cadastro do produto (somente leitura), ' +
      'também na busca/importação em lote e no Excel exportado — facilita conferir margem ao montar a tabela.',
    data_lancamento: '2026-09-24',
  },
  {
    versao: '1.1.3.160',
    tipo: 'MELHORIA',
    titulo: 'Tabela de preços: análise de margem',
    descricao:
      'Ao montar a tabela, cada item mostra se o Vlr. Tabela está ok, abaixo da margem % do cadastro ou em prejuízo em relação ao custo. ' +
      'Há um resumo no topo (ok / abaixo / prejuízo) e a análise também vai no Excel exportado.',
    data_lancamento: '2026-09-24',
  },
  {
    versao: '1.1.3.160',
    tipo: 'MELHORIA',
    titulo: 'Tabela de preços: exibir mark-up',
    descricao:
      'Na grade da tabela de preços, marque Exibir mark-up para ver o mark-up líquido de cada item ' +
      '(preço da tabela menos custo e comissão). A marcação fica salva neste navegador e o Excel também leva a coluna.',
    data_lancamento: '2026-09-28',
  },
  {
    versao: '1.1.3.160',
    tipo: 'BUG',
    titulo: 'Contas a Receber: Cliente/Pagador busca nos clientes',
    descricao:
      'Ao lançar uma receita (boletos), o campo Cliente / Pagador agora busca nos clientes cadastrados ' +
      '(por nome, CNPJ/CPF ou código) em vez de fornecedores, e vincula o título ao cliente escolhido.',
    data_lancamento: '2026-10-14',
  },
  {
    versao: '1.1.5.0',
    tipo: 'BUG',
    titulo: 'Pedido: aviso de saldo Flex insuficiente agora mostra a mensagem',
    descricao:
      'Quando a fábrica bloqueia saldo Flex insuficiente, a janela «Não foi possível salvar» aparecia sem texto. ' +
      'Agora informa quanto o pedido consome e qual é o saldo do vendedor. ' +
      'Também permite ver o saldo do vendedor do pedido ao abrir um pedido já salvo.',
    data_lancamento: '2026-10-16',
  },
];
