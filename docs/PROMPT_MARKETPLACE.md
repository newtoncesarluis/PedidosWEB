# Prompt de continuidade — Módulo Marketplace (SysRepWeb)

> Cole este conteúdo inteiro no início de uma nova conversa com a IA.
> Atualizado em 2026-08-25.

---

Você vai continuar o desenvolvimento do **módulo Marketplace** do SysRepWeb.
Leia o `CLAUDE.md` da raiz e de `SysRepWeb/` antes de escrever qualquer código —
as regras de coluna de banco ali são obrigatórias.

## 1. Contexto do negócio

Um cliente do SysRepWeb vende em vários marketplaces e quer gerenciar tudo pelo sistema.
A operação real dele é:

```
Mercado Livre (2 contas) ─┐
Shopee (2 contas) ────────┤
Amazon ───────────────────┼──►  TRAY  ──►  Bling (2 contas)  ──►  NF-e
Shein ────────────────────┤    (estoque,      (SÓ emite
TikTok ───────────────────┘     custo,         a nota)
                                preço,
                                regras de preço)
```

**Decisões já tomadas — não reabrir sem motivo novo:**

1. **A Tray é o hub, não o Bling.** Integrar com a Tray cobre todos os canais numa
   integração só. O Bling é o fim da fila e só tem o dado fiscal.
2. **Bling é fase 2 opcional** — puxar número da nota, chave e impostos para
   enriquecer DRE e margem líquida.
3. **Não integrar direto com ML/Shopee/Amazon** — seriam 6+ integrações para chegar
   no mesmo lugar.
4. **Estoque:** o sistema externo é o saldo oficial. O SysRepWeb envia *movimentos*
   ("baixou 3 unidades"), nunca saldo absoluto ("o saldo é 47") — senão dois sistemas
   disputam o mesmo número e o cliente vende o que não tem.
5. **O valor do módulo não é "listar vendas"** (o painel do canal já faz isso). É
   **margem líquida real**, **conciliação de repasse** e **visão única** com a venda
   direta/representação.

## 2. O que JÁ ESTÁ FEITO

### Gate de licença (add-on pago, só o desenvolvedor libera)

- **`config/modulo-marketplace.js`** — flag `sistema_licencas.modulo_marketplace`
  (TINYINT) no banco **remoto** de licenças. Coluna criada on-demand.
  Cache de 5 min. **Falha fechada**: erro na consulta = módulo bloqueado.
  - `marketplaceHabilitado(chave)`, `exigeModuloMarketplace` (middleware),
    `resetCacheModuloMarketplace(chave)`, `chaveDoRequest(req)`
- **`routes/marketplace.js`** aplica `router.use(exigeModuloMarketplace)` no topo —
  vale para todas as rotas, **inclusive admin do tenant**.
- **`GET /api/modulos/marketplace`** (em `server.js`) → `{ habilitado: bool }`.
  Fica FORA de `/api/marketplace` de propósito: o menu precisa perguntar sem levar 403.
- **Painel do desenvolvedor** (`public/licencas.html`): checkbox "Marketplace" no modal
  de edição + linha no detalhe. Salva via
  `PUT /api/licencas/license/remote/:id/modulo-marketplace { habilitado: true }`
  (limpa o cache e grava em `historico_licencas`).

### Schema (neutro de provedor)

**`config/marketplace-schema.js`** — `ensureMarketplaceSchema(pool)`, on-demand por
tenant, cache por `DATABASE()`:

| Tabela | Papel |
|---|---|
| `canal_venda` | 1 linha por **conta** (2 contas do ML = 2 linhas). Tem `id_empresa` (multi-CNPJ), `comissao_pct` (margem), credenciais OAuth, `config` (JSON livre) |
| `marketplace_anuncios` | de-para anúncio ↔ `produto.ID`. `UNIQUE (id_canal, codigo_externo)` |
| `marketplace_pedidos_log` | payload cru + status. `UNIQUE (id_canal, id_externo)` **impede pedido duplicado** |

Migrations em `config/schema-migrations.js`: `pedidos.id_canal_venda` (INT) e
`pedidos.pedido_externo` (VARCHAR 120). `pedidos.origem` já existia e recebe
`TRAY | BLING | MERCADO_LIVRE | SHOPEE | ...`.

### API — `routes/marketplace.js` (montada em `server.js` como `/api/marketplace`)

- `GET/POST/PUT/DELETE /canais` — CRUD, soft-delete, contadores de anúncio sem
  vínculo e pedido com erro. **Segredos nunca voltam** (viram `tem_client_secret:'S'`);
  no PUT, secret em branco preserva o atual.
- `GET/POST/DELETE /anuncios` — de-para, upsert pela UNIQUE
- `POST /anuncios/vincular-automatico` — casa SKU com `cod_fabricante`, `referencia`,
  `cod_barras` ou `ID`. **Só vincula match único**; ambíguo fica manual.
- `GET /pedidos-log`, `/pedidos-log/:id`, `POST /pedidos-log/:id/reprocessar`
- `GET /resumo` — números para dashboard

### Tela

**`public/pages/config-api.html`** — card "Marketplace — Canais de Venda", entre
Instagram DM e Usuários WhatsApp. Bloqueado por senha administrativa igual aos
vizinhos (entrou em `desbloquear()`/`bloquear()`). O card só aparece se
`GET /api/modulos/marketplace` responder `habilitado: true`.
Funções: `verificarModuloMarketplace`, `carregarCanaisMkt`, `salvarCanalMkt`,
`editarCanalMkt`, `excluirCanalMkt`, `limparFormCanalMkt`.

**`public/pages/marketplace-anuncios.html`** — de-para de anúncios (Comercial →
Marketplace — De-para). Filtros, paginação, vínculo manual/automático, cadastro
manual de anúncios. Permissão `gtela_marketplace` / `tela_marketplace` em
`config/cadastros-permissoes.js` (padrão `tela_campanhas_wa`). Menu em `home.html`.

Liberação do add-on também no **Painel NC** (`painelnc` → Licenças → checkbox
Marketplace), além do `licencas.html` do SysRepWeb.

Changelog: `1.1.3.127` (canais) e `1.1.3.128` (de-para).

### Estado da validação

Sintaxe validada em todos os arquivos. **Nada foi executado contra banco** — o `.env`
aponta para produção na Hostinger. As tabelas nascem na primeira chamada da API.

## 3. O que FALTA fazer

### Bloqueado — aguardando resposta do cliente

Estas perguntas foram enviadas e ainda não voltaram. **Não invente as respostas:**

1. A Tray é a loja virtual comum ou a **Tray Corp**?
2. Amazon/Shein/TikTok entram pela própria Tray ou por **app/hub instalado** nela?
   (se for app de terceiro, o canal de origem pode não vir limpo na API)
3. Plano contratado da Tray — **a API está liberada?**
4. **Preço de custo** está preenchido em todos os produtos? (sem ele a margem líquida
   fica capenga)
5. Regras de preço da Tray: por canal, por produto, por campanha?
6. Estoque único ou por depósito? **O Full do Mercado Livre entra na conta?**
7. **Os dois Bling são dois CNPJs?** → decide se precisa de relatório consolidado +
   separado por empresa, e se `pedidos.id_empresa`/`canal_venda.id_empresa` viram
   filtro obrigatório
8. Volume de pedidos/mês e de produtos ativos
9. Acesso de leitura na Tray ou credenciais de API

### Fase 1 — Integração Tray (o próximo passo real)

1. **Confirmar na documentação oficial da Tray** (não chutar endpoint nem escopo) se a
   API expõe: **preço de custo**, **estoque** e **canal de origem do pedido**.
   Se faltar o custo, avisar antes de seguir — muda o valor do produto.
2. `config/tray-client.js` — autenticação, renovação de token, respeito ao rate limit
   (fila, não rajada), retry com backoff.
3. `routes/marketplace-tray.js` — conectar conta, importar produtos/anúncios
   (alimenta `marketplace_anuncios`), importar pedidos (grava em
   `marketplace_pedidos_log`).
4. **Processador de pedido**: log → `pedidos` + `itensped`, com `origem`,
   `id_canal_venda`, `pedido_externo`. Cliente: criar ou usar um genérico do canal.
   Idempotente — reprocessar não pode duplicar.
5. Webhook/callback se a Tray oferecer; senão polling em intervalo configurável.

### Fase 2 — Estoque

Só depois de confirmar a direção com o cliente. Usar o motor existente
`config/estoque-movimentacao.js`. Enviar **movimentos**, nunca saldo absoluto.

### Fase 3 — Telas e relatórios

- ~~Tela de **de-para de anúncios**~~ — feita (`marketplace-anuncios.html` + `gtela_marketplace`)
- **Dashboard por canal**: vendas/dia, ticket médio, top produtos
- **Margem líquida real**: preço − custo − comissão do canal − frete − imposto
- Consolidação **multi-CNPJ** se confirmado

### Fase 4 — Conciliação de repasse

O que o canal prometeu pagar × o que caiu na conta. **É a peça de maior valor
comercial** — costuma recuperar 1–3% do faturamento que vaza em comissão cobrada
errada, frete debitado a mais e devolução não estornada.

### Fase 5 — Bling (opcional)

Duas contas = dois OAuth. Só para trazer nº da nota, chave e impostos.

### Dívida técnica conhecida

- ~~`gtela_marketplace`~~ — registrada em `COMERCIAL_TELAS` (`tela_marketplace`).
  Migration automática no próximo startup do tenant.

## 4. Regras do projeto que você DEVE seguir

- **Tabela de produtos é `produto` (singular).** `produtos` não existe. Detectar com
  `SHOW TABLES LIKE 'produto'` — já tem helper `tabelaProduto()` em
  `config/marketplace-schema.js`.
- **Verificar nome real de coluna antes de escrever SQL.** O `CLAUDE.md` tem uma lista
  longa de armadilhas (ex.: `pedidos` não tem `id_cliente`, é `cod_cliente`;
  `itensped` exclui com `excluido='S'`, nunca DELETE). Quando descobrir uma armadilha
  nova, **atualizar o `CLAUDE.md`**.
- **Soft delete sempre** (`excluido='S'`), nunca DELETE físico em cadastro.
- **Coluna nova = migration** em `config/schema-migrations.js` (bases Delphi legadas
  recebem no próximo startup).
- **Melhoria visível ao usuário = entrada em `config/changelog-queue.js`.**
- **Nada de `alert()`/`confirm()`/`prompt()`** — usar `/assets/confirm-dialog.js`
  (`SysRepConfirm.ask`, `confirmar`, `avisar`).
- **CSS sem cor hardcoded** em container de formulário — usar `var(--card)`,
  `var(--text)`. Fonte Inter.
- **Multi-tenant**: `getPool()` resolve o pool do tenant via AsyncLocalStorage.
  O banco de licenças é outro pool (`getLicensePool()`).
- **Não rodar DDL nem script contra o banco de produção** sem o desenvolvedor pedir —
  o `.env` aponta para a Hostinger.

## 5. Como testar sem tocar na operação do cliente

Pedir ao cliente a exportação da Tray (produtos + 3 meses de pedidos em CSV) e
desenvolver contra esses dados. Validar margem, conciliação e de-para antes de
ligar qualquer API.
