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
- `despesas`: Delphi legado usa **`nome`**; cadastro web antigo usa **`descricao`** — usar `config/despesas-label.js` (`resolveDespesasLabelColumn` + `despesasLabelExpr`); cache é por `DATABASE()` (multi-tenant); se ambas colunas existem, SQL usa `COALESCE(nome, descricao)`
- Contas a pagar: combo **Natureza** = lookup `/api/lookups/despesas` (retorna `id_despesas` + `nome`) — gravar em **`id_despesas`**
- `pagar.numero` é **`INT`** sequencial (`MAX(numero)+1`) — gerado pelo sistema; Nº título/NF do formulário grava em **`numeronf`** (varchar 25), não em `numero`
- Novo título pagar: `tipo='PAGAR'`, `doc='P'+LPAD(numero,6,'0')`, `prazo/parcela/qt_parcelas=1`, `forma_pagto/forma_foipagto/cond_pagto='DINHEIRO'`, `historico_rec='PAGAMENTO EFETUADO'`; vencimento em string `YYYY-MM-DD` (sem `new Date()` ISO)
- Lançamento pagar: `valor`, `valor_pagar` e `vlrcomjuros` recebem o mesmo valor informado no formulário

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
| `perfil` | `id` | `excluido='N'` | permissões S/N, `manutencaocadastros` |
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
