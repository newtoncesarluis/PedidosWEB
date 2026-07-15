# SysRepWeb — Instruções para Claude

## Stack
- Node.js + Express + MySQL2 (pool por tenant)
- Frontend HTML/CSS/JS puro (sem framework)
- Empacotamento opcional via `pkg` → `dist/SysRepWeb.exe`

---

## REGRA 1 — Verificar colunas antes de escrever SQL

**OBRIGATÓRIO**: antes de escrever qualquer query SQL envolvendo uma tabela que não seja do código principal (`pedidos`, `itensped`, `clientes`, `fornecedores`, `produto`), verificar os nomes de coluna reais.

> ⚠️ **Tabela de produtos = `produto` (singular). A tabela `produtos` NÃO existe neste projeto. Nunca usar `produtos` em SQL, migrations ou código.**

Como verificar:
1. Grep no arquivo de rota correspondente: `routes/fornecedores.js`, `routes/clientes.js`, `routes/produtos.js`, etc.
2. Se não encontrar, ler o arquivo de rota antes de escrever a query.

Exemplos de erros passados por não fazer isso:
- `nomefantasia` / `nomefornecedor` → coluna real é **`nome`** em `fornecedores`
- `vendedor='S'` → coluna não existe; vendedores são identificados por **`JOIN perfil WHERE p_vender='S'`**
- `regioes` → tabela não existe; tabela correta é **`regiao_rota`**
- `usuarios.rota_vendedor` → **não existe** (é a tabela `rota_vendedor`); incluir essa coluna no UPDATE de usuários fazia o SQL falhar inteiro e o `.catch` engolia o erro — `id_vendedor` nunca gravava (bug 2026-07-09)
- lookups de `regiao_rota` e `categoria` retornam **`descricao`**, NÃO `nome`
- `natureza` em bases legadas pode ter **`nome`** em vez de **`descricao`** — usar `config/natureza-label.js` (`resolveNaturezaLabelColumn`) em JOINs/SQL
- `receber` usa **`valor_pago`** (não `vlrpago` — essa coluna é de `pagar`) — funções JS que populam `<select>` devem usar `it.nome || it.descricao`
- `regiao_rota` NÃO tem coluna `nome_regiao` — coluna real é **`descricao`**; usar sempre `rr.descricao AS nome_regiao` no JOIN
- `natureza` NÃO tem coluna `nome` — coluna real é **`descricao`**; usar `n.descricao AS nome_natureza` no JOIN e `descricao AS nome` nos lookups
- `pedidos` NÃO tem coluna `id_cliente` — coluna real é **`cod_cliente`** — em qualquer query em `pedidos` referenciando o cliente usar `cod_cliente`
- Destaques comerciais (marketing sem promo): tabela **`produtos_destaque`** — badge **DESTAQUE** na aba Destaques do pedido; distinto de `produto_promocoes.destaque='S'` (badge **PROMO**)
- Preço por peso (Gestão Pedidos): `produto.precopeso='S'` + `kilo_embalagem` (kg por unidade); `vlr_venda` = **R$/kg**; total item = **Qtd × peso × preço** — helpers em `config/preco-peso-produto.js` + `public/assets/preco-peso-produto.js`; no `INSERT itensped` o campo **`kilo_embalagem`** recebe o fator **embalagem** do item (peso usado no cálculo), não duplicar com peso do catálogo — no `GET` pedido usar alias **`prod_kilo_embalagem`** do JOIN; ao salvar pedido `routes/pedidos.js` chama **`_normalizeItensPrecoPeso`** (mesma fórmula); ajuda em **ajuda-produtos** + **ajuda-pedidos** (`?sec=preco-por-peso`). **Impressão/PDF (`pedidos.html`): o total da linha e os totais do rodapé DEVEM usar `baseTotalItemImpressao(i)` (= `calcBaseItemPedido` → Qtd × peso × preço) — NUNCA `vlrVendaEfetivoImpressao(i) × qtd`, que ignora o peso e mostra preço menor que o pedido salvo (bug corrigido 2026-07-03). Idem quando `soma_embalagempedido='S'` (multiplica embalagem em todos os itens).** `soma_embalagempedido` fica na tabela **`sistemas`** (config-sistema.html)
- Combo **Tipo Documento** no pedido (`#wrap_tipo_documento` em `pedidos.html`) só aparece se `sistemas.habilita_tipodoc='S'` (default `'N'`) — config em **Sistema → Configuração do Sistema** (`config-sistema.html`, campo "Exibir Tipo Documento no Pedido"); coluna criada on-demand via `ensureSistemasColumns` (`routes/config-sistema.js`) ao salvar; campo **não é obrigatório** na digitação do pedido mesmo quando visível
- Preposto → só comissão dele (`id_preposto`, `%` em `preposto_comissao_fornecedor`); helper `config/comissao-preposto-guard.js` + `public/assets/comissao-preposto-ui.js`
- Mesmo produto no pedido: `fornecedores.vendasduplicaritem` — **S** = somar na linha | **D** = nova linha (não somar) | **N** = bloquear duplicata; select na aba Preferências do fornecedor; helpers `config/vendas-duplicar-item.js` + `public/assets/vendas-duplicar-item.js`; pedido usa `fornecedorConsolidaItemPedido()` / `_vendasDuplicarItemBloqueia()`
- Qtd. mínima flexível no pedido: coluna **`qtd_minima_pedido`** em `produto`/`produtos` (0 = sem mínimo) — independente de **`multiplo_venda`**; **regra pai por item = produto** (kit fornecedor só sugere; `quantidadeExigidaKit` usa max(kit, regras produto)); validação front (`public/assets/pedido-item-regras.js`) + back (`config/pedido-item-regras.js` + `validarItensQtdRegras` em `routes/pedidos.js`); snapshot no item `qtd_minima_pedido_produto`; cadastro em produtos + importação `Qtd. Mínima Pedido`; coluna criada on-demand via **`config/produto-colunas.js`** (`ensureProdutoColunas` — por tenant, DESCRIBE antes de gravar); ajuda `ajuda-pedidos?sec=regras-quantidade`, `ajuda-fornecedores?sec=kit-pedido`, `ajuda-produtos?sec=qtd-minima-pedido`
- `cod_fabricante` + `cod_fornecedorpadrao` — único por fornecedor entre produtos ativos; helper **`config/produto-cod-fabricante.js`**; validação em `POST/PUT /api/produtos` e importação; SKU preenchido exige Fornecedor Padrão
- Kit de pedido por fornecedor: **`habilita_kit_pedido`**, **`kit_desconto_pct`**, **`desconto_primeira_compra_pct`** + tabela **`fornecedor_kit_itens`**; aba **Kit de Pedido** no fornecedor; pedido botão **Kit fábrica** + aviso `#avisoKitPedido` (clique aplica desconto sugerido); API `GET/POST /api/fornecedores/:id/kit-pedido`; primeira compra = sem pedido PEDIDO anterior do cliente com a fábrica; promo 1ª compra + kit: **`promo_primeira_compra_exige_kit='S'`** (desconto só com kit completo **e** 1ª compra), **`promo_condicao_pagto`** (ex. `0/21/42` — dia 0 = entrada), **`promo_texto_banner`**; banner `#avisoPromoPrimeiraCompra` (toque aplica desconto + parcelas); offline-pack inclui **`kitPedidoPorFornecedor`**
- Obs. por item no pedido: `fornecedores.obsitem_pedido` — **S** = campo **Obs. do item** + exibição sob a descrição (desktop/mobile/impressão); **N** = oculto (padrão); cor/estilo reutiliza `cor_obspedido` / `estilo_obspedido`
- `itensped`: obs. por item = coluna **`obsitem`** (VARCHAR 100) — **não** ler/gravar `obsitemitenspedido` na web; ao limpar gravar `obsitem=''`; backfill único `obsitemitenspedido`→`obsitem` só onde `obsitem IS NULL` (`backfillItenspedObsitemLegado`); `obsitem` gravado no próprio batch INSERT via `buildItenspedInsertParams` (`imp.obsitem`) — itens do pedido entram com **`insertItenspedBatch`** (INSERT em lote de até 50 linhas, sem UPDATE redundante); helpers `resolveObsitemLeitura` / `resolveObsitemGravacao` + `ensureItenspedObsitemColumn`
- Combo vendedor em relatórios: sem **`acessartodosclientes`**, **`gerentecomercial`** nem admin → lookup só retorna o logado, combo travado, API força `id` do usuário — helper `config/vendedor-visibilidade.js`
- **Solicitações (Suporte & Melhorias)**: gravam em **`nc_painel.solicitacoes`** via `config/db-painel.js` (`PAINEL_DB_*`) — **não** em `db_nresolutions` (esse banco só guarda `nre_config` / WhatsApp). Dev local: túnel Hostinger `tunnel-dev.bat [2]` → `PAINEL_DB_PORT=3308`
- Kit Feirinha / preço médio: `fornecedores.habilita_feirinha='S'` liga painel **Resumo da Feirinha** na aba Itens do pedido; campanhas em `campanhas_feirinha` + kit em `campanhas_feirinha_itens` + CRUD em `/pages/comercial-feirinha.html`; cálculo em `config/feirinha-calc.js` + `POST /api/pedidos/feirinha/calcular`; catálogo aba **Feirinha** filtra por faixa de custo; pedido grava `id_campanha_feirinha`, `preco_medio_feirinha`, `preco_revenda_feirinha`; **link público**: `POST /api/feirinha-share/gerar` → `/feirinha/:token`; orçamento `FEIRINHA_SHARE`; dashboard home expõe **`feirinhaSharePendentes`**; link público valida **vigência** (`campanhaEmVigencia`); dashboard top produtos usa **`itensped.desc_prod`** (não `desc_produto`); busca kit produtos: API `/api/produtos?q=&fornecedor=&status=A`
- `itensped`: exclusão é **`excluido='S'`** — nunca `DELETE FROM itensped`; no `POST /api/pedidos/:id` só regravar itens se `itens.length > 0` (mudança só de status/cancelar/aprovar não envia `itens`); gravar **`desc_prod`** — frontend/mobile pode enviar `desc_produto` ou `descricao`; backend usa `resolveDescProdItem` (fallback catálogo `produto.descricao`)
- Pedidos offline mobile: fila em `localStorage` (`SysRepPedidosOffline`); lista em `pedidos.html` mescla `queueAsPedidoRows()` na página 1; badge **Aguarda sync**; sync via `POST /api/pedidos`
- Promoções em pedido: gravar **`id_promocao`** + **`promocao_descricao`** em `itensped` quando `tipo_preco='promo'` (legado VARCHAR(10)); campanhas em **`promocoes_campanha`** / **`produto_promocoes.id_campanha`**; dashboard **`GET /api/produtos/promocoes/dashboard`** — **campanha** (`id_promocao`), **vinculado** (preço = promo ativa na data), **estimado** (preço &lt; `vlr_padrao`/cadastro no item); **link público promoções**: **`POST /api/promocoes-share/gerar`** (auth) → página **`/promocoes/:token`**; **`GET /api/promocoes-share/:token`** catálogo; **`POST /api/promocoes-share/:token/orcamento`** grava orçamento com **`pedidos.origem='PROMO_SHARE'`** + itens `tipo_preco='promo'`; **`GET .../historico`** e **`.../historico/:id/itens`** só com link que tem **`id_cliente`** no token (tabela **`promocoes_share_tokens`**); dashboard home expõe **`promoSharePendentes`** (orçamentos PROMO_SHARE pendentes); catálogo pedido: abas **Todos / Promoções / Destaques**; resumo fábrica **`GET /api/pedidos/produtos/promocoes-resumo?id_fornecedor=`**; coluna **`destaque`** em **`produto_promocoes`**
- Datas Brasil: usar `config/date-brasil.js` (`hojeIsoBrasil`, `horaBrasil`, `addDaysIsoBrasil`) — **não** usar `toLocaleDateString('pt-BR').split('/').reverse()` nem `new Date('YYYY-MM-DD')` no frontend (desloca ±1 dia por fuso); vitrine/pedidos gravam `data_abertura` com data de Brasília
- Filtro avançado Empresa (`f_nome_empresa` em `pedidos.html`): valor legado **`ILUMAC`** no `localStorage` travava a lista — limpar com `clearLegacyEmpresaFilter()`; não persistir nem aplicar esse valor
- Fotos de cliente: tabela **`cliente_fotos`** (`cod_cliente`, `caminho`, `tipo_imagem`, `principal`) — a tabela `clientes` **não** tem coluna de foto/logo; listagem usa subquery em `cliente_fotos`
- Logo no relatório de pedido (impressão/PDF): fornecedor **`logopedido='S'`** → duas logos (esq. fábrica, dir. empresa); senão só logo da empresa à esquerda. Logo da fábrica vem de **`fornecedor_fotos`** (`tipo_imagem='LOGO'`, senão `principal='S'`, senão primeira foto) — campo **`caminho`** (web: `/uploads/fornecedores/{id}/...`). GET `/api/fornecedores/:id` expõe **`logo_imagem`** já resolvida
- `despesas`: Delphi legado usa **`nome`**; cadastro web antigo usa **`descricao`** — usar `config/despesas-label.js` (`resolveDespesasLabelColumn` + `despesasLabelExpr`); cache é por `DATABASE()` (multi-tenant); se ambas colunas existem, SQL usa `COALESCE(nome, descricao)`
- Contas a pagar: combo **Natureza** = lookup `/api/lookups/despesas` (retorna `id_despesas` + `nome`) — gravar em **`id_despesas`**
- `pagar.numero` é **`INT`** sequencial (`MAX(numero)+1`) — gerado pelo sistema; Nº título/NF do formulário grava em **`numeronf`** (varchar 25), não em `numero`
- Novo título pagar: `tipo='PAGAR'`, `doc='P'+LPAD(numero,6,'0')`, `prazo/parcela/qt_parcelas=1`, `forma_pagto/forma_foipagto/cond_pagto='DINHEIRO'`, `historico_rec='PAGAMENTO EFETUADO'`; vencimento em string `YYYY-MM-DD` (sem `new Date()` ISO)
- Lançamento pagar: `valor`, `valor_pagar` e `vlrcomjuros` recebem o mesmo valor informado no formulário
- `forma_pagto` (combo condição pagamento): **não** filtrar `status IN ('S','A')` — legado pode não ter coluna `status` (SQL falha → combo vazio) ou `excluido IS NULL`; usar **`config/forma-pagto-lookup.js`** (`listFormasPagamentoLookup`); cadastro completo em **`GET /api/formas-pagamento`**
- `tabela_preco_cabecalho.Cond_Pagamento` — **opcional** (`INT NULL`); migration **`ensureTabelaPrecoCondPagamentoNullable`** (FK impede MODIFY direto)
- `tabela_preco_cabecalho` tem flags da vitrine: **`vitrine`** (`ENUM('S','N')` default `'N'` — só `'S'` + tabela **ativa** aparece no seletor da vitrine; **não** exige vínculo em `tabela_preco_vinculo`) e **`usar_regras_fornecedor`** (`ENUM('S','N')` default `'N'` — `'S'` valida mínimo de faturamento `fornecedores.vlr_minimofaturamento` + mínimo da condição `fornecedor_condicoes_pagamento.valor_minimo` no pedido da vitrine); migration **`ensureVitrineColumns`** (sem backfill — default `'N'`, liberar manualmente no cadastro; cacheada por base). Vitrine = 1 tabela escolhida por pedido (sem mesclar preços); `GET /api/vitrine/:token` retorna `tabelas[]` + `produtos[].precos{id_tabela:preco}`; `POST .../pedido` recebe `id_tabela`. Preço da vitrine = **`COALESCE(valor_tabela, preco_venda)`** + filtro `> 0` + `(ativo='S' OR ativo IS NULL)` (GET e POST iguais); pedido grava `· Tabela: X · Pagamento: Y` no `obs`. Representante pode restringir o link a tabelas específicas: **`vitrine_tokens.ids_tabelas`** (CSV; NULL = todas liberadas); **`GET /api/vitrine/tabelas-cliente/:id`** (auth) lista p/ o seletor, **`PATCH /api/vitrine/:token/tabelas`** (auth) grava a seleção; GET/POST `/:token` filtram por `ids_tabelas` (`_selIdsFromToken`). Seletor no modal do link em `home.html` (`_vitrinePickerTabelas`), só com 2+ tabelas
- `forma_pagto`: registros Delphi legado têm **`excluido=NULL`** — sempre usar `WHERE (excluido='N' OR excluido IS NULL)`; nunca `WHERE excluido='N'` isolado (o lookup `/api/lookups/condicoes-pagamento` já faz isso; o CRUD precisava da correção)
- `pedidos` NÃO tem coluna `data_pedido` — coluna real é **`data_abertura`**; usar `MONTH(data_abertura)` e `YEAR(data_abertura)` em filtros de período
- **Performance do save (medido em `db_pedidos`/`nc_gelamo` na Hostinger):** `itensped.id_pedido` é **`varchar(15)` e quase todo NULL** em bases legadas (chave real = `numpedido`). Filtrar itens de um pedido por **`id_pedido` com valor numérico faz FULL SCAN** (MySQL ignora o índice por mismatch varchar×número) — usar sempre **`WHERE numpedido = ?`** passando **String** (índice `numpedido`/`idx_it_num`, `type=ref`). Vale p/ grade recovery e `SUM(vlr_ipi/vlr_st)` no `insertItenspedBatch`/`salvarParcelas`. **`pagtocomissao.pedido`** (`varchar(15)`) não tinha índice → DELETE por pedido era full scan; índice **`idx_pc_pedido`** criado no setup de `routes/pedidos.js`. **`SELECT MAX(numero+0) FROM pedidos`** (gera nº novo) é full scan inerente (expressão na coluna) — aceitável no porte atual
- **Prioridade da tabela de preço — DIFERE por contexto:**
  - **Pedidos** (desktop + mobile): ordem **Fábrica → Vendedor → Cliente** (`FORNECEDOR > VENDEDOR > CLIENTE`). Loop `priorities` em **`routes/tabela-precos.js`** (3 lugares: `ativa-para`, `disponiveis-para`, `buscarTabelasLiberadas`) com `break` no 1º nível que tiver tabela. Frontend (`pedidos.html`) pega `tabelas[0]` como padrão + badge de origem (`_tabelaPrecoOrigem` / `checkPriceRule`). **Nunca** voltar a ordem para Cliente-first (bug: trazia tabela do cliente quando a fábrica também tinha).
  - **Vitrine Digital**: regra em **`getTabelasVitrineCliente`** em `routes/vitrine.js` — todas com `tpc.vitrine='S'` e ativas (sem exigir vínculo CLIENTE). Representante pode restringir por link (`ids_tabelas`).
  - Pedidos offline: `disponiveis-para` é cacheada em `pedidos-offline-pack.js` — vendedor precisa re-preparar offline após deploy para pegar a nova ordem.
- `produto`/`produtos` NÃO tem coluna `cod_fornecedor` nesta base — coluna real é **`cod_fornecedorpadrao`** (já tratado em `routes/produtos.js` via `temFornPadrao`); `routes/estoque.js` (`GET /api/estoque/saldos`) tinha esse erro — corrigido com detecção via `DESCRIBE` (`_colFornecedor`)
- `produto`/`produtos`: colunas `estoque_atual` e `estoque_minimo` não existiam — adicionadas em `config/schema-migrations.js` junto com `estoque_maximo`/`estoque_seguranca`
- **Importação de produtos/preços — "Valor de Venda não importa" (CAUSA REAL):** `autoMapear()` em `public/pages/importacao-precos.html` só auto-mapeava 3 campos (`AUTO_MAP_APENAS` = descricao/unidade/cod_fabricante) → **`Valor de Venda` (e todos os demais campos da planilha-modelo) ficavam SEM vínculo**; se o usuário não mapeasse na mão, o produto importava ("importado") **sem preço**. Não tinha relação com inteiro/float. Fix: `autoMapear()` faz **match exato** do cabeçalho com `nome_campo` OU `apelido` de qualquer campo ativo (os cabeçalhos do modelo são exatamente os apelidos). **Exceção `AUTO_MAP_BLOQUEADOS`**: `estoque_atual`/`estoque_minimo`/`estoque_maximo`/`estoque_seguranca`/`situacao` **nunca** auto-mapeiam (têm efeito colateral — estoque gera movimento AJUSTE, situacao muda ativo/inativo); exigem mapeamento manual, pra importação de preço/tabela não mexer em estoque/status sem o usuário pedir. Verificar com a planilha-modelo real antes de mexer.
  - Melhorias defensivas relacionadas (não eram a causa): `parseNumeroMoeda` (`importacao-precos.html`) passou a remover símbolo de moeda (`R$`/`$`) que retornava `NaN`; **`ensureTabelaPrecoItensDecimal`** (`config/schema-migrations.js`) converte `preco_base`/`preco_venda`/`valor_tabela`/`vlr_desconto` de `INT`→`DECIMAL(15,2)` **só se** estiverem como INT (no-op em bases já decimais; protege bases legadas em SQL STRICT).
- **`routes/clientes.js` NÃO está montado** — `/api/clientes` usa **`modules/clientes/clientes.routes.js`** (controller/service/repository). Endpoint novo de cliente vai no módulo, não em `routes/clientes.js` (endpoint criado lá é código morto e o 401 do authMiddleware engana no teste). Bug 2026-07-14: `/api/clientes/:id/mensagens` criado no arquivo errado.
- `clientes` NÃO tem coluna `id_vendedor` — coluna real é **`cod_vendedor`** (FK `usuarios.idusuario`); telefone p/ WhatsApp = prioridade **`fonesecundario`** (campo WhatsApp) → `celularcomprador` → `foneprincipal`
- Campanhas WhatsApp: tabelas **`campanhas_whatsapp`** + **`campanhas_whatsapp_dest`** (criadas on-demand em `routes/campanhas-whatsapp.js`); permissão **`tela_campanhas_wa`** via `COMERCIAL_TELAS` em `config/cadastros-permissoes.js` (migration/JWT automáticos); motor de fila em background com intervalo 6–12s; cada envio grava em `cliente_mensagens`
- Catálogos Visuais / Showroom: tabelas **`catalogos`** + **`catalogos_itens`**; API `/api/catalogos`; cadastro `comercial-catalogos.html`; **Showroom independente** `comercial-showroom.html` + `catalogo-afv-ui.js` (coleções → refs → detalhe → carrinho → pré-pedido cliente/pagamento → `POST /api/pedidos` origem **`SHOWROOM`** PENDENTE); no pedido permanece só o botão **Catálogo** (`catalogo-pedido-ui.js`); permissão cadastro **`tela_catalogos`** / `gtela_catalogos`; **não** reativa `_catalogoVisualHabilitado`

**Nunca assumir nomes de coluna sem checar o código existente primeiro.**

### Auto-atualização de armadilhas
Sempre que um erro SQL revelar uma coluna ou tabela com nome diferente do esperado:
1. Corrigir o código
2. **Atualizar este arquivo** adicionando a armadilha descoberta na lista acima

Formato para adicionar:
```
- `nome_errado` → nome real é **`nome_correto`** em `tabela` — motivo descoberto
```

---

## REGRA 4 — Novidade/melhoria visível → registrar changelog

Toda melhoria, novidade ou correção **visível ao usuário** deve gerar entrada em **`config/changelog-queue.js`** (tipo `NOVO`/`MELHORIA`/`BUG`, título + descrição em português). No login do tenant, sincroniza para `sistema_changelog` e o **modal de novidades** na home/mobile mostra o que o usuário ainda não viu. Admin também cadastra em **Sistema → Notas de Versão**. Em deploy, alinhar `version.json`. Detalhes: `.cursor/rules/novidades-usuario.mdc`.

---

## REGRA 3 — CSS de temas: nunca usar cores hardcoded em containers de formulário

Ao escrever ou editar CSS de painéis/cards que contêm inputs e selects:

1. **NÃO** usar `background: #fff` ou `background: white` — usar `var(--card, #fff)`
2. **NÃO** usar `color: #000` ou `color: #333` — usar `var(--text)` ou `var(--content-text)`
3. **SIM** garantir que `select option` também tenha cor explícita, pois o dropdown nativo do browser não herda automaticamente

Armadilha descoberta:
- `.filter-panel { background: #fff }` → hardcoded branco quebrava temas escuros; corrigido para `var(--card, #fff)`
- `select { color: white }` sem `select option { color: white }` → opções do dropdown nativo ficavam com texto branco em fundo claro

Regra global já existe em `public/assets/themes.css` (bloco "Inputs, selects e textareas seguem o tema"), incluindo `select option`. Ao criar novas páginas, importar `themes.css` e **não hardcodar** cores em containers.

---

## REGRA 2 — Campo existe no formulário mas não na tabela → usar migration

Se ao abrir/analisar um formulário HTML perceber que um campo existe no `<form>` mas não está na tabela do banco:

1. **NÃO** assumir que a coluna existe.
2. **NÃO** alterar o formulário para remover o campo.
3. **SIM** adicionar a coluna via `config/schema-migrations.js` no array `MIGRATIONS`:

```javascript
{ table: 'nome_tabela', column: 'nome_coluna', type: "VARCHAR(100) DEFAULT NULL" },
```

Isso garante que bases antigas (Delphi legado) recebem a coluna automaticamente no próximo startup.

---

## Tabelas principais e seus campos-chave

| Tabela | PK | Status/Exclusão | Observação |
|---|---|---|---|
| `clientes` | `id` | `excluido='S'`, `status='E'/'I'/'A'` | `regiao` → FK `regiao_rota.id` |
| `fornecedores` | `id` | `excluido='S'`, `status='E'/'I'/'A'` | coluna nome = `nome` |
| `produto` ou `produtos` | `ID` | `excluido='S'`, `situacao='A'/'I'` | detectar com `SHOW TABLES LIKE 'produto'` |
| `pedidos` | `id` | `excluido='N'` | `cod_cliente`, `cod_fornecedor` |
| `itensped` | `id` | — | `cod_produto` (INT); `vlr_padrao` = preço catálogo/tabela; `valor_unitario` = preço negociado; `vlrtotalcomimposto` = total c/ ST+IPI+ICMS; `obsitem` (varchar 100); `icms`/`vlr_icms` = % e valor ICMS do item |
| `usuarios` | `idusuario` | `excluido='N'`, `SITUACAO='ATIVO'` | vendedor = `JOIN perfil WHERE p.p_vender='S'` |
| `perfil` | `id` | `excluido='N'` | permissões S/N; **`acessar_cadastros`** = módulo Cadastros; **`tela_clientes`/`tela_fornecedores`/`tela_produtos`** = ver telas (JWT: `gtela_*`); **`manutencaocadastros`** = Manutenção |
| `regiao_rota` | `id` | `excluido='N'`, `status='A'` | regiões dos clientes |

---

## Padrões do projeto

- **Soft delete**: sempre `excluido='S'` — nunca DELETE físico em cadastros
- **Inativação**: `status='I'` para clientes/fornecedores, `situacao='I'` para produtos
- **Migrations**: novas colunas sempre em `config/schema-migrations.js`
- **Paths pkg**: usar `process.cwd()` para arquivos graváveis, `ROOT_DIR` para leitura de assets
- **Multi-tenant**: `getPool()` retorna o pool do tenant atual via AsyncLocalStorage
- **Permissões**: checar `req.user?.permissoes?.campo` ou `req.user?.perfil == 1` (admin)

---

## Contexto Hostinger

Para qualquer tarefa relacionada à Hostinger, novos clientes, deploy ou infraestrutura, leia primeiro:

`C:\Documentos\Projetos WEB\Estudos\Hostinger\CONTEXTO_HOSTINGER.md`
