# Estudo Vitrine Digital

Pacote isolado para demonstrar a Vitrine Digital sem instalar o SysRepWeb completo.

Ele inclui:

- vitrine publica em `/vitrine/:token`
- painel simples em `/` para gerar link e acompanhar pedidos
- API minima para clientes, produtos, tabela de preco, tokens e pedidos
- SQL de schema e dados de demonstracao

## Requisitos

- Node.js 18+
- MySQL ou MariaDB

## Instalacao rapida

1. Crie o banco e tabelas executando:

```sql
source sql/01_schema.sql;
source sql/02_seed_demo.sql;
```

No phpMyAdmin, importe primeiro `sql/01_schema.sql` e depois `sql/02_seed_demo.sql`.

2. Copie `.env.example` para `.env` e ajuste usuario/senha do MySQL:

```bash
copy .env.example .env
```

3. Instale dependencias e rode:

```bash
npm install
npm start
```

4. Abra:

- painel: `http://localhost:3090`
- link seed da vitrine: `http://localhost:3090/vitrine/demo-loja-centro`

## Fluxo da demonstracao

1. No painel, escolha um cliente.
2. Clique em `Gerar link`.
3. Abra o link da vitrine.
4. Adicione produtos ao carrinho e envie o pedido.
5. Volte ao painel e clique em `Atualizar pedidos`.

## Arquivos principais

- `public/vitrine.html`: experiencia publica do cliente.
- `public/admin.html`: painel simples da demonstracao.
- `routes/vitrine.js`: geracao de token, catalogo, carrinho, pedido e historico.
- `routes/demo.js`: consultas simples para o painel.
- `sql/01_schema.sql`: estrutura minima.
- `sql/02_seed_demo.sql`: cadastros basicos de cliente, produtos, fornecedor, tabela e token.

## Observacoes

- Este pacote e propositalmente pequeno e sem login, para demonstracao controlada.
- O pedido e gravado com origem `VITRINE` e status `PENDENTE`.
- A vitrine lista apenas produtos com preco ativo na tabela vinculada ao cliente.
