# Checkpoint — continuar depois (SysRepWeb)

## Limite / estratégia

- O limite semanal do chat está baixo.
- Implementar muita coisa nova agora provavelmente não vai caber com segurança.
- Melhor caminho: parar com um checkpoint bem documentado e retomar em seguida sem perder contexto.

## Módulo Leads — o que já foi feito

### Backend

- Criada rota nova em [routes/leads.js](C:/xampp/htdocs/SysRepWeb/routes/leads.js).
- Registrada no servidor em [server.js](C:/xampp/htdocs/SysRepWeb/server.js).
- Estrutura de tabela `leads` criada para instalação nova.
- Compatibilidade com base existente:
  - a rota verifica colunas faltantes
  - adiciona automaticamente os campos novos via `ALTER TABLE` quando necessário
- Criada tabela `lead_historico`.
- Histórico automático implementado para:
  - criação
  - atualização
  - conversão em cliente
- Endpoint para notas manuais do histórico.
- Conversão de lead em cliente implementada.

### Campos de lead já contemplados no backend

- `nome`
- `empresa`
- `telefone`
- `whatsapp`
- `email`
- `instagram`
- `facebook`
- `cidade`
- `uf`
- `segmento`
- `cargo`
- `origem`
- `campanha`
- `anuncio`
- `interesse`
- `produto_interesse`
- `score`
- `temperatura_lead`
- `prioridade`
- `canal_atendimento`
- `status_funil`
- `motivo_perda`
- `valor_estimado`
- `tags`
- `observacoes`
- `data_ultimo_contato`
- `data_proximo_contato`
- `convertido_cliente_id`
- `convertido_pedido_id`
- `data_conversao`

### Frontend

- Criada tela em [public/pages/leads.html](C:/xampp/htdocs/SysRepWeb/public/pages/leads.html).
- Menu CRM atualizado em [public/home.html](C:/xampp/htdocs/SysRepWeb/public/home.html).
- Tela respeita o padrão visual do sistema:
  - `themes.css`
  - `var(--font)`
  - variáveis globais de cor/tema
- Estrutura visual atual:
  - cards por estágio
  - filtros
  - modal de edição/cadastro
  - histórico do lead
  - resumos analíticos simples

### Funcionalidades já prontas na tela

- cadastro de lead
- edição de lead
- exclusão de lead
- histórico com notas
- conversão em cliente
- abrir cliente convertido
- agendar visita a partir do lead convertido
- filtros por:
  - estágio
  - vendedor
  - origem
  - prioridade
  - temperatura
  - período
  - apenas atrasados
- cards com:
  - prioridade
  - temperatura
  - score
  - valor estimado
  - campanha/produto/origem quando houver
- resumos:
  - retornos pendentes
  - conversão por origem
  - dashboard simples por vendedor

### Integração com visitas

- [public/pages/visitas.html](C:/xampp/htdocs/SysRepWeb/public/pages/visitas.html) foi ajustada para aceitar prefill por URL:
  - `?novo=1`
  - `cliente_id`
  - `cliente_nome`
- Isso permite fluxo:
  - lead convertido
  - abrir cliente
  - agendar visita

## O que ainda falta fazer

### Fase 3 recomendada

- Drag and drop real entre colunas do funil
- Conversão do lead para:
  - orçamento
  - pedido
- Tarefas / follow-up automático
- Importação Excel de leads
- Botões rápidos de ação comercial

### Fase 4 recomendada

- Integração WhatsApp mais forte
- Dashboard comercial avançado
- Funil com métricas reais de conversão por etapa
- Motivos de perda com relatórios
- Timeline mais rica
- Integração com campanhas / captura automática
- IA comercial

## Pendências técnicas para revisar na retomada

- Testar visualmente a tela de leads no navegador.
- Validar se todas as colunas novas foram realmente adicionadas na base atual.
- Conferir se os textos com acentuação aparecem corretamente em todos os navegadores.
- Revisar se a tela de leads precisa quebrar em subabas para não ficar longa demais.
- Confirmar se o sistema possui página de orçamento pronta para receber futura conversão automática.
- Confirmar rota/padrão para conversão futura em pedido.

## Estado atual de qualidade

- `routes/leads.js` passou em `node --check`.
- O script embutido de `public/pages/leads.html` foi validado com `new Function(...)`.
- Ainda falta teste manual navegando pela interface.

## Arquivos principais tocados neste módulo

- [routes/leads.js](C:/xampp/htdocs/SysRepWeb/routes/leads.js)
- [public/pages/leads.html](C:/xampp/htdocs/SysRepWeb/public/pages/leads.html)
- [public/pages/visitas.html](C:/xampp/htdocs/SysRepWeb/public/pages/visitas.html)
- [public/home.html](C:/xampp/htdocs/SysRepWeb/public/home.html)
- [server.js](C:/xampp/htdocs/SysRepWeb/server.js)

## Próxima ação sugerida ao retomar

1. Abrir a tela de Leads no sistema rodando.
2. Testar:
   - novo lead
   - edição
   - histórico
   - conversão em cliente
   - abrir cliente
   - agendar visita
3. Se tudo estiver ok, partir para:
   - drag and drop
   - conversão em orçamento/pedido
   - importação Excel

---
*Checkpoint salvo para retomada rápida do módulo de Leads/Funil.*
