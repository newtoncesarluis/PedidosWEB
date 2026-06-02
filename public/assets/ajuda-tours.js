(function () {
  'use strict';

  function pedidoFormAberto() {
    var form = document.getElementById('formSection');
    return form && form.style.display === 'block';
  }

  function abrirFormPedidoTour() {
    if (pedidoFormAberto()) return;
    if (typeof abrirNovo === 'function') abrirNovo();
  }

  function irAbaPagamento() {
    var btn = document.querySelector('#tabsBar .tab-btn[data-tab-target="tab-financeiro"]')
      || document.querySelector('.tab-btn[data-tab-target="tab-financeiro"]');
    if (typeof switchTab === 'function' && btn) {
      switchTab('tab-financeiro', btn, { skipValidation: true });
    } else if (btn) {
      btn.click();
    }
  }

  SysRepTour.registerMany({
    'mapa-operacoes': {
      title: 'Mapa de Operações',
      steps: [
        {
          selector: '.toolbar-title',
          placement: 'bottom',
          title: 'Controle visual do dia',
          text: 'Aqui você acompanha <strong>clientes</strong>, <strong>prospects</strong> e a <strong>posição do vendedor</strong> (último check-in) em um mapa, com atualização automática.'
        },
        {
          selector: '#statusTabs',
          placement: 'bottom',
          title: 'Status e contagem',
          text: 'Filtre por <strong>Visitados</strong>, <strong>Pendentes</strong>, <strong>Em andamento</strong>, <strong>Canceladas</strong> e <strong>Prospects</strong>. Os números refletem o resumo do dia.'
        },
        {
          selector: '.date-filters',
          placement: 'bottom',
          title: 'Tipo, vendedor e data',
          text: 'Escolha <strong>Clientes + Prospects</strong> ou apenas um tipo, filtre por <strong>vendedor</strong> e selecione a <strong>data</strong>.'
        },
        {
          selector: '#chkAuto',
          placement: 'bottom',
          title: 'Atualização automática',
          text: 'Ative <strong>Auto</strong> e selecione o intervalo (15s a 2min). O badge de “Atualizado” mostra a última sincronização.'
        },
        {
          selector: '#chkVendedores',
          placement: 'bottom',
          title: 'Posição do vendedor',
          text: 'Marque <strong>Vendedores</strong> para exibir o ponto laranja «V». Ele aparece quando existe <strong>check-in GPS</strong> em rota no dia.'
        },
        {
          selector: '#kpiGrid',
          placement: 'right',
          title: 'Resumo operacional',
          text: 'Os cards resumem o dia: realizadas, pendentes, em andamento, canceladas e prospects no mapa.'
        },
        {
          selector: '#geoPanel',
          placement: 'right',
          title: 'Geolocalização pendente',
          text: 'Registros sem GPS não aparecem no mapa. Use <strong>Clientes</strong> ou <strong>Prospects</strong> para geocodificar em lote (até 10 por clique).'
        },
        {
          selector: '#map',
          placement: 'left',
          title: 'Mapa e legenda',
          text: 'Clique em um ponto para ver detalhes. Cores indicam o status; roxo «P» é prospect e laranja «V» é vendedor.'
        },
        {
          selector: '#listaMarcadores',
          placement: 'right',
          title: 'Lista lateral',
          text: 'A lista à esquerda permite localizar rápido e centralizar no mapa. Clique em um item para abrir o popup.'
        }
      ]
    },

    'pedidos-pagamento': {
      title: 'Pagamento do pedido',
      onStop: function () {
        var list = document.getElementById('listSection');
        if (list && list.style.display === 'none' && typeof fecharDrawer === 'function') {
          try { fecharDrawer(); } catch (_) {}
        }
      },
      steps: [
        {
          selector: '#btnNovoPedido',
          placement: 'bottom',
          title: 'Comece pelo pedido',
          text: 'Na listagem, use <strong>Novo Pedido</strong> para abrir o formulário. Preencha <strong>Dados</strong> (cliente, fábrica, vendedor) e <strong>Itens</strong> antes de ir ao pagamento.'
        },
        {
          selector: '#tabsBar',
          placement: 'bottom',
          title: 'Fluxo das abas',
          text: 'O pedido segue a ordem <strong>Dados → Itens → Entrega → Pagamento → Obs</strong>. O sistema valida cada etapa antes de avançar.',
          beforeShow: abrirFormPedidoTour
        },
        {
          selector: '#tabsBar .tab-btn[data-tab-target="tab-financeiro"]',
          placement: 'bottom',
          title: 'Aba Pagamento',
          text: 'Aqui você define forma de pagamento, desconto global, condição (ex.: 30/60/90) e revisa as <strong>parcelas</strong> geradas automaticamente.',
          beforeShow: function () {
            abrirFormPedidoTour();
            irAbaPagamento();
          }
        },
        {
          selector: '#tab-financeiro',
          placement: 'top',
          title: 'Parcelas e conferência',
          text: 'Informe a condição para gerar parcelas, ajuste valores se necessário e confira o resumo financeiro. Ao salvar o pedido, essas parcelas alimentam o faturamento e as comissões.',
          beforeShow: irAbaPagamento
        },
        {
          selector: '#btnSalvar',
          placement: 'left',
          title: 'Salvar pedido',
          text: 'Quando tudo estiver correto, clique em <strong>Salvar</strong>. Parcelas inconsistentes ou campos obrigatórios pendentes impedem a gravação.',
          beforeShow: irAbaPagamento
        }
      ]
    },

    'comissoes-baixa': {
      title: 'Baixa de comissões',
      steps: [
        {
          selector: '#metricsGrid',
          placement: 'bottom',
          title: 'Visão rápida',
          text: 'Os cards mostram o total <strong>Pendente</strong>, já <strong>Pago</strong> e a quantidade geral. Clique neles para filtrar a grade.'
        },
        {
          selector: '.filter-bar',
          placement: 'bottom',
          title: 'Filtros',
          text: 'Selecione o <strong>vendedor</strong> (representante ou preposto), período e status <strong>Pendente</strong> para listar o que ainda falta pagar. Depois clique em <strong>Filtrar</strong>.'
        },
        {
          selector: '#comissaoTable',
          placement: 'top',
          title: 'Seleção em lote',
          text: 'Marque as linhas desejadas ou use o checkbox do cabeçalho. A coluna <strong>Origem</strong> indica se a comissão é do representante ou repasse de preposto.'
        },
        {
          selector: '#bulkBar',
          placement: 'top',
          title: 'Checkout em lote',
          text: 'Com itens selecionados, a barra inferior mostra quantidade e total. Use <strong>Efetivar Pagamento</strong> para registrar a baixa e gerar o recibo.',
          fallbackSelector: '#comissaoTable'
        },
        {
          selector: '.btn-checkout',
          placement: 'top',
          title: 'Efetivar pagamento',
          text: 'Confirma a baixa das comissões selecionadas. O vendedor pode conferir no <strong>Portal do Vendedor</strong> antes ou depois, conforme o fluxo da empresa.',
          fallbackSelector: 'a[href="comissoes_conferencia.html"]'
        },
        {
          selector: 'a[href="comissoes_conferencia.html"]',
          placement: 'bottom',
          title: 'Representante e preposto',
          text: 'No portal, o representante valida o extrato. Comissões de preposto aparecem vinculadas ao gerente/representante responsável — filtre pelo vendedor correto na gestão.'
        }
      ]
    },

    'rotas-planejar': {
      title: 'Montar rotas',
      steps: [
        {
          selector: '.toolbar .filter-tabs',
          placement: 'bottom',
          title: 'Status das rotas',
          text: 'Filtre por <strong>Pendentes</strong>, <strong>Em andamento</strong> ou <strong>Concluídas</strong> para acompanhar o planejamento da equipe.'
        },
        {
          selector: '.date-filters',
          placement: 'bottom',
          title: 'Período e vendedor',
          text: 'Escolha vendedor e intervalo de datas. Clientes só aparecem no mapa quando têm latitude/longitude no cadastro.'
        },
        {
          selector: 'button[onclick="novaRota()"]',
          placement: 'left',
          title: 'Nova rota',
          text: 'Clique em <strong>Nova Rota</strong>, informe vendedor, data e clientes da visita. Você pode reordenar paradas e enviar ao vendedor.'
        },
        {
          selector: '#listaRotas',
          placement: 'right',
          title: 'Lista planejada',
          text: 'Rotas criadas ficam aqui. Abra uma rota para editar visitas, registrar observações ou excluir.'
        },
        {
          selector: '#map',
          placement: 'left',
          title: 'Mapa e legenda',
          text: 'Visualize paradas no mapa. Cores indicam pendente, visitado, pedido feito, reagendar etc. Use para validar a sequência antes de liberar ao vendedor.'
        }
      ]
    },

    'rotas-campo': {
      title: 'Executar rotas',
      steps: [
        {
          selector: '#toolbar-lista',
          placement: 'bottom',
          title: 'Minhas rotas',
          text: 'Lista as rotas liberadas para você. O badge mostra quantas ainda estão pendentes.'
        },
        {
          selector: '#view-lista',
          placement: 'top',
          title: 'Escolher rota',
          text: 'Toque em uma rota para ver clientes, progresso e registrar visitas. Rotas só aparecem após o planejamento no escritório.'
        },
        {
          placement: 'center',
          title: 'Durante a execução',
          text: 'Na rota aberta, use <strong>Rota no Maps</strong>, <strong>Próximo no Waze</strong> ou <strong>Otimizar</strong> para navegar. Registre o resultado de cada visita (pedido, reagendar, não encontrado).'
        },
        {
          selector: '#btn-concluir-rota',
          placement: 'top',
          title: 'Concluir rota',
          text: 'Quando todas as visitas estiverem registradas, use <strong>Concluir</strong> para fechar a rota no sistema.',
          fallbackSelector: '#view-detalhe'
        }
      ]
    },

    'pedidos-offline': {
      title: 'Pedidos offline',
      onStop: function () {
        if (typeof fecharDrawer === 'function') {
          try { fecharDrawer(); } catch (_) {}
        }
      },
      steps: [
        {
          selector: '#pedidosTopMeta',
          placement: 'bottom',
          title: 'Modo campo',
          text: 'Esta faixa concentra status offline, sincronização e badges. Use quando o vendedor estiver na rota com sinal instável.'
        },
        {
          selector: '#btnPrepareOffline',
          placement: 'bottom',
          title: 'Preparar offline',
          text: 'Com <strong>Wi‑Fi</strong>, toque em <strong>Offline</strong> para baixar clientes, produtos e tabelas. Faça isso antes de sair para visitas.'
        },
        {
          selector: '#offlinePackBadge',
          placement: 'bottom',
          title: 'Pacote pronto',
          text: 'O badge verde <strong>Offline OK</strong> confirma que o pacote está válido (7 dias). Sem ele, novo pedido offline pode falhar.',
          fallbackSelector: '#btnPrepareOffline'
        },
        {
          selector: '#btnNovoPedido',
          placement: 'bottom',
          title: 'Novo pedido sem internet',
          text: 'Sem sinal, abra <strong>Novo Pedido</strong>. Cliente, fábrica e produtos vêm do pacote local. A lista de pedidos pode ficar vazia — isso é normal na v1.'
        },
        {
          selector: '#offlineQueueBadge',
          placement: 'bottom',
          title: 'Fila local',
          text: 'Pedidos salvos offline entram na fila (badge laranja). Nada é enviado ao servidor até sincronizar.',
          fallbackSelector: '#btnSyncPedidos'
        },
        {
          selector: '#btnSyncPedidos',
          placement: 'left',
          title: 'Sincronizar',
          text: 'De volta online, use o botão de <strong>sincronizar</strong> para enviar a fila ao servidor. Confira se todos subiram antes de fechar o app.'
        }
      ]
    },

    'comissoes-conferencia': {
      title: 'Conferência do vendedor',
      steps: [
        {
          selector: '.toolbar-bar .ins-card.accent',
          placement: 'bottom',
          title: 'Seus indicadores',
          text: 'Acompanhe vendas, comissão realizada, provisão futura e meta do período filtrado.'
        },
        {
          selector: '.subbar',
          placement: 'bottom',
          title: 'Filtrar extrato',
          text: 'Defina período e fábrica, depois <strong>Filtrar</strong>. O representante ou preposto vê aqui o que foi liberado para conferência.'
        },
        {
          selector: '.tabs',
          placement: 'bottom',
          title: 'Etapas',
          text: '<strong>Pendentes</strong> aguardam sua validação. <strong>Conferidas</strong> já foram aceitas. <strong>Liquidadas</strong> mostram pagamentos efetuados pelo financeiro.'
        },
        {
          selector: '#list_provisoes',
          placement: 'top',
          title: 'Conferir itens',
          text: 'Revise pedido, cliente, valor e comissão. Marque linhas ou use a ação individual para confirmar cada provisão.'
        },
        {
          selector: '#batchBar',
          placement: 'top',
          title: 'Conferência em lote',
          text: 'Com várias linhas marcadas, use <strong>Conferir Selecionados</strong> para aceitar o lote de uma vez.',
          fallbackSelector: '#list_provisoes'
        },
        {
          selector: '.chart-section',
          placement: 'top',
          title: 'Evolução',
          text: 'Os gráficos ajudam a visualizar ganhos ao longo do tempo. Depois da conferência, o financeiro efetua o pagamento na tela de gestão.',
          fallbackSelector: '#tab_pendentes'
        }
      ]
    },

    'clientes-cadastro': {
      title: 'Cadastro de clientes',
      onStop: function () {
        if (typeof fecharDrawer === 'function') {
          try { fecharDrawer(); } catch (_) {}
        }
      },
      steps: [
        {
          selector: '#ins-card-total',
          placement: 'bottom',
          title: 'Indicadores',
          text: 'Cards de total, ativos, inativos e sem compra há 90 dias. Clique para filtrar a listagem rapidamente.'
        },
        {
          selector: '#btnNovoClienteTop',
          placement: 'bottom',
          title: 'Novo cliente',
          text: 'Inicia um cadastro em branco. Campos obrigatórios da aba <strong>Geral</strong> precisam estar preenchidos para salvar.'
        },
        {
          selector: '#subbar',
          placement: 'bottom',
          title: 'Busca e filtros',
          text: 'Localize clientes por código, nome, telefone ou documento. Use <strong>Filtros</strong> para cidade, tipo ou inatividade.'
        },
        {
          selector: '#tabsBar',
          placement: 'bottom',
          title: 'Abas da ficha',
          text: 'A ficha tem abas de endereço, comercial, faturamento, contatos, tabela de preços etc. Navegue conforme o perfil do cliente.',
          beforeShow: function () {
            if (typeof abrirNovo === 'function') abrirNovo();
          },
          fallbackSelector: '#formSection'
        },
        {
          selector: '#tab-endereco',
          placement: 'top',
          title: 'Endereço e mapa',
          text: 'Preencha CEP e endereço. Latitude/longitude alimentam o <strong>mapa de rotas</strong> — importantes para planejamento de visitas.',
          beforeShow: function () {
            if (typeof abrirNovo === 'function') abrirNovo();
            var btn = document.querySelector('.tab-btn[onclick*="tab-endereco"]');
            if (typeof switchTab === 'function' && btn) switchTab('tab-endereco', btn);
          }
        },
        {
          selector: '#btnSalvar',
          placement: 'left',
          title: 'Salvar',
          text: 'Grava o cliente. Documento duplicado ou campos obrigatórios pendentes bloqueiam o salvamento.',
          beforeShow: function () {
            if (typeof abrirNovo === 'function') abrirNovo();
          }
        }
      ]
    },

    'produtos-cadastro': {
      title: 'Cadastro de produtos',
      onStop: function () {
        if (typeof fecharFormulario === 'function') {
          try { fecharFormulario(); } catch (_) {}
        }
      },
      steps: [
        {
          selector: '#chip-total',
          placement: 'bottom',
          title: 'Resumo do estoque',
          text: 'Filtre por ativos, inativos ou estoque baixo. Útil para revisar catálogo antes de incluir novos itens.'
        },
        {
          selector: '#toolbar .btn-outline[onclick="novoRegistro()"]',
          placement: 'bottom',
          title: 'Novo produto',
          text: 'Abre a ficha em branco. A <strong>descrição</strong> é obrigatória; demais campos dependem do processo da empresa.'
        },
        {
          selector: '#subbar',
          placement: 'bottom',
          title: 'Pesquisar',
          text: 'Busque por código, descrição ou referência. Use <strong>Filtros</strong> para grupo e disponibilidade.'
        },
        {
          selector: '#formSection .form-tabs',
          placement: 'bottom',
          title: 'Abas do produto',
          text: 'Organize dados em <strong>Geral</strong>, <strong>Preços</strong>, <strong>Estoque</strong>, <strong>Impostos</strong> e <strong>Fotos</strong>.',
          beforeShow: function () {
            if (typeof novoRegistro === 'function') novoRegistro();
          }
        },
        {
          selector: '#tab-geral',
          placement: 'top',
          title: 'Dados principais',
          text: 'Descrição, unidade, grupo e família. Códigos de barras e referência ajudam na busca no pedido.',
          beforeShow: function () {
            if (typeof novoRegistro === 'function') novoRegistro();
            if (typeof abrirAba === 'function') abrirAba('geral', document.querySelector('#formSection .form-tab'));
          }
        },
        {
          selector: '#formSection .form-tab:nth-child(2)',
          placement: 'bottom',
          title: 'Preços e custos',
          text: 'Defina custo, margem e preço de venda. Tabela de preço vinculada impacta o valor no pedido.',
          beforeShow: function () {
            if (typeof novoRegistro === 'function') novoRegistro();
            var tab = document.querySelector('#formSection .form-tab[onclick*="precos"]');
            if (typeof abrirAba === 'function' && tab) abrirAba('precos', tab);
          }
        },
        {
          selector: '#btnSalvar',
          placement: 'left',
          title: 'Salvar produto',
          text: 'Primeiro salvamento libera fotos e múltiplos de venda. Revise impostos se integrar com NF-e.',
          beforeShow: function () {
            if (typeof novoRegistro === 'function') novoRegistro();
          }
        }
      ]
    },

    'fornecedores-cadastro': {
      title: 'Cadastro de fornecedores',
      onStop: function () {
        if (typeof fecharFormulario === 'function') {
          try { fecharFormulario(); } catch (_) {}
        }
      },
      steps: [
        {
          selector: '#ins-card-ativos',
          placement: 'bottom',
          title: 'Visão da base',
          text: 'Indicadores de total, ativos, inativos e novos nos últimos 7 dias.'
        },
        {
          selector: '#toolbar .btn-outline[onclick="novoRegistro()"]',
          placement: 'bottom',
          title: 'Novo fornecedor',
          text: 'Cadastre fábricas/representadas. Nome e documento são a base; CNPJ pode ser consultado na Receita.'
        },
        {
          selector: '#subbar',
          placement: 'bottom',
          title: 'Busca',
          text: 'Encontre fornecedores por nome, CPF/CNPJ ou telefone antes de editar ou revisar condições.'
        },
        {
          selector: '#formSection .form-tabs',
          placement: 'bottom',
          title: 'Abas',
          text: 'Configure endereço, contato, descontos, tabela de preços, condições de pagamento e imagens da marca.',
          beforeShow: function () {
            if (typeof novoRegistro === 'function') novoRegistro();
          }
        },
        {
          selector: '#tab-geral',
          placement: 'top',
          title: 'Identificação',
          text: 'Razão social, apelido e documento. Use a lupa para puxar dados do CNPJ automaticamente.',
          beforeShow: function () {
            if (typeof novoRegistro === 'function') novoRegistro();
          }
        },
        {
          selector: '#formSection .form-tab[onclick*="condpagto"]',
          placement: 'bottom',
          title: 'Condições de pagamento',
          text: 'Defina prazos aceitos pela fábrica — aparecem no pedido ao selecionar este fornecedor.',
          beforeShow: function () {
            if (typeof novoRegistro === 'function') novoRegistro();
            var tab = document.querySelector('#formSection .form-tab[onclick*="condpagto"]');
            if (typeof abrirAba === 'function' && tab) abrirAba('condpagto', tab);
          }
        },
        {
          selector: '#btnSalvar',
          placement: 'left',
          title: 'Salvar',
          text: 'Grava o fornecedor. Revise vendedores vinculados e tabela de preços antes de liberar para pedidos.',
          beforeShow: function () {
            if (typeof novoRegistro === 'function') novoRegistro();
          }
        }
      ]
    },

    'usuarios-cadastro': {
      title: 'Cadastro de usuários',
      onStop: function () {
        if (typeof exibirLista === 'function') {
          try { exibirLista(); } catch (_) {}
        }
      },
      steps: [
        {
          selector: '#toolbar',
          placement: 'bottom',
          title: 'Gestão de usuários',
          text: 'Somente administradores criam e editam usuários. Indicadores mostram total e ativos.'
        },
        {
          selector: '#btn-novo',
          placement: 'bottom',
          title: 'Novo usuário',
          text: 'Cadastre representantes, prepostos ou usuários internos. Perfil e permissões definem o que cada um acessa.'
        },
        {
          selector: '#inp-search',
          placement: 'bottom',
          title: 'Localizar',
          text: 'Busque por nome ou login antes de editar senha, permissões ou vínculos.'
        },
        {
          selector: '#formSection .form-tabs',
          placement: 'bottom',
          title: 'Abas do cadastro',
          text: '<strong>Geral</strong>, <strong>Acesso</strong> (login/senha), <strong>Vínculos</strong>, tabelas de preço e <strong>Comissões</strong>.',
          beforeShow: function () {
            if (typeof exibirForm === 'function') exibirForm();
          }
        },
        {
          selector: '#formSection .form-tab:nth-child(3)',
          placement: 'bottom',
          title: 'Acesso e perfil',
          text: 'Login, senha e perfil determinam menus visíveis. Representante x preposto muda regras de carteira e comissão.',
          beforeShow: function () {
            if (typeof exibirForm === 'function') exibirForm();
            var tab = document.querySelector('#formSection .form-tab[onclick*="setTab(2"]');
            if (typeof setTab === 'function' && tab) setTab(2, tab);
          }
        },
        {
          selector: '#formSection .form-tab:nth-child(7)',
          placement: 'bottom',
          title: 'Vendas e comissões',
          text: 'Percentuais, metas e regras de repasse para preposto. Alimenta cálculo automático no pedido e na gestão de comissões.',
          beforeShow: function () {
            if (typeof exibirForm === 'function') exibirForm();
            var tab = document.querySelector('#formSection .form-tab[onclick*="setTab(6"]');
            if (typeof setTab === 'function' && tab) setTab(6, tab);
          }
        },
        {
          selector: '#btn-salvar',
          placement: 'left',
          title: 'Salvar usuário',
          text: 'Confirma cadastro ou alteração. Senha em branco na edição mantém a atual.',
          beforeShow: function () {
            if (typeof exibirForm === 'function') exibirForm();
          }
        }
      ]
    }
  });
})();
