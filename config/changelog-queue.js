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
