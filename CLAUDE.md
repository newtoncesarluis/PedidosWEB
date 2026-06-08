# SysRepWeb — Instruções para Claude

## Stack
- Node.js + Express + MySQL2 (pool por tenant)
- Frontend HTML/CSS/JS puro (sem framework)
- Empacotamento opcional via `pkg` → `dist/SysRepWeb.exe`

---

## REGRA 1 — Verificar colunas antes de escrever SQL

**OBRIGATÓRIO**: antes de escrever qualquer query SQL envolvendo uma tabela que não seja do código principal (`pedidos`, `itensped`, `clientes`, `fornecedores`, `produtos`/`produto`), verificar os nomes de coluna reais.

Como verificar:
1. Grep no arquivo de rota correspondente: `routes/fornecedores.js`, `routes/clientes.js`, `routes/produtos.js`, etc.
2. Se não encontrar, ler o arquivo de rota antes de escrever a query.

Exemplos de erros passados por não fazer isso:
- `nomefantasia` / `nomefornecedor` → coluna real é **`nome`** em `fornecedores`
- `vendedor='S'` → coluna não existe; vendedores são identificados por **`JOIN perfil WHERE p_vender='S'`**
- `regioes` → tabela não existe; tabela correta é **`regiao_rota`**
- lookups de `regiao_rota` e `categoria` retornam **`descricao`**, NÃO `nome`
- `natureza` em bases legadas pode ter **`nome`** em vez de **`descricao`** — usar `config/natureza-label.js` (`resolveNaturezaLabelColumn`) em JOINs/SQL
- `receber` usa **`valor_pago`** (não `vlrpago` — essa coluna é de `pagar`) — funções JS que populam `<select>` devem usar `it.nome || it.descricao`
- `regiao_rota` NÃO tem coluna `nome_regiao` — coluna real é **`descricao`**; usar sempre `rr.descricao AS nome_regiao` no JOIN
- `natureza` NÃO tem coluna `nome` — coluna real é **`descricao`**; usar `n.descricao AS nome_natureza` no JOIN e `descricao AS nome` nos lookups
- `pedidos` NÃO tem coluna `id_cliente` — coluna real é **`cod_cliente`** — em qualquer query em `pedidos` referenciando o cliente usar `cod_cliente`
- Destaques comerciais (marketing sem promo): tabela **`produtos_destaque`** — badge **DESTAQUE** na aba Destaques do pedido; distinto de `produto_promocoes.destaque='S'` (badge **PROMO**)
- Preço por peso (Gestão Pedidos): `produto.precopeso='S'` + `kilo_embalagem` (kg por unidade); `vlr_venda` = **R$/kg**; total item = **Qtd × peso × preço** — helpers em `config/preco-peso-produto.js` + `public/assets/preco-peso-produto.js`; no `INSERT itensped` o campo **`kilo_embalagem`** recebe o fator **embalagem** do item (peso usado no cálculo), não duplicar com peso do catálogo — no `GET` pedido usar alias **`prod_kilo_embalagem`** do JOIN; ao salvar pedido `routes/pedidos.js` chama **`_normalizeItensPrecoPeso`** (mesma fórmula); ajuda em **ajuda-produtos** + **ajuda-pedidos** (`?sec=preco-por-peso`)
- Preposto → só comissão dele (`id_preposto`, `%` em `preposto_comissao_fornecedor`); helper `config/comissao-preposto-guard.js` + `public/assets/comissao-preposto-ui.js`
- Combo vendedor em relatórios: sem **`acessartodosclientes`**, **`gerentecomercial`** nem admin → lookup só retorna o logado, combo travado, API força `id` do usuário — helper `config/vendedor-visibilidade.js`
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
