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
    versao: '1.1.3.60',
    tipo: 'BUG',
    titulo: 'Cards da lista mostram «Orçamento» corretamente',
    descricao:
      'Na visualização em cards da lista de Pedidos, um orçamento aparecia com o título «Pedido #...». ' +
      'Agora o cabeçalho do card mostra «Orçamento #...» quando o tipo do documento for orçamento.',
    data_lancamento: '2026-07-08',
  },
];
