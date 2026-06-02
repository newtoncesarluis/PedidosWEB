# Guia de uso e instalação - Vitrine Digital Demo

Este guia mostra como colocar em funcionamento o pacote `estudo_vitrine`, criado para demonstrar a Vitrine Digital sem depender do SysRepWeb completo.

## 1. O que este pacote demonstra

A pasta `C:\xampp\htdocs\estudo_vitrine` contém uma versão isolada da Vitrine Digital com:

- cadastro básico de clientes;
- cadastro básico de produtos;
- tabela de preço vinculada ao cliente;
- link público da vitrine;
- carrinho de compra;
- geração de pedidos com origem `VITRINE`;
- painel simples para gerar link e acompanhar pedidos.

O objetivo é demonstrar para um cliente sem sistema como funcionaria o modo "produtos + clientes + tabela de preço + pedidos".

## 2. Requisitos

Antes de iniciar, confirme que a máquina possui:

- Node.js 18 ou superior;
- MySQL ou MariaDB ativo;
- acesso ao phpMyAdmin ou outro cliente de banco;
- terminal PowerShell ou Prompt de Comando.

## 3. Estrutura dos arquivos

Na pasta `C:\xampp\htdocs\estudo_vitrine`, os arquivos principais são:

- `server.js`: inicia o servidor da demo;
- `.env`: configura porta e banco de dados;
- `public\vitrine.html`: página pública da vitrine;
- `public\admin.html`: painel de demonstração;
- `routes\vitrine.js`: API da vitrine;
- `routes\demo.js`: API do painel;
- `sql\01_schema.sql`: cria banco e tabelas;
- `sql\02_seed_demo.sql`: insere clientes, produtos, tabela de preço e token demo.

## 4. Configurar o banco de dados

Abra o phpMyAdmin ou seu cliente MySQL e importe os arquivos SQL nesta ordem:

1. `C:\xampp\htdocs\estudo_vitrine\sql\01_schema.sql`
2. `C:\xampp\htdocs\estudo_vitrine\sql\02_seed_demo.sql`

O primeiro arquivo cria o banco `estudo_vitrine` e todas as tabelas necessárias.

O segundo arquivo cria os dados de demonstração:

- empresa demo;
- representante demo;
- três clientes;
- dez produtos;
- dois fornecedores;
- tabela de preço "Tabela Vitrine Demo - Varejo";
- vínculo da tabela aos clientes;
- link público inicial com token `demo-loja-centro`.

## 5. Conferir o arquivo .env

Abra o arquivo:

`C:\xampp\htdocs\estudo_vitrine\.env`

Ele já vem com esta configuração padrão:

```env
PORT=3090
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=estudo_vitrine
```

Se o seu MySQL tiver senha, altere `DB_PASSWORD`.

Se a porta `3090` já estiver em uso, altere `PORT` para outra porta, como `3091`.

## 6. Instalar dependências

Abra o terminal na pasta do projeto:

```bat
cd C:\xampp\htdocs\estudo_vitrine
```

Instale as dependências:

```bat
npm install
```

Esse comando instala Express, MySQL2 e Dotenv.

## 7. Iniciar o servidor

Ainda na pasta `C:\xampp\htdocs\estudo_vitrine`, execute:

```bat
npm start
```

Se estiver tudo certo, o terminal mostrará:

```text
Estudo Vitrine rodando em http://localhost:3090
```

## 8. Abrir o painel de demonstração

No navegador, acesse:

`http://localhost:3090`

Nesse painel você consegue:

- ver clientes cadastrados;
- ver produtos com preço;
- ver tabelas de preço;
- gerar link de vitrine para um cliente;
- acompanhar pedidos feitos pela vitrine.

## 9. Abrir o link demo da vitrine

Depois de importar o SQL de seed, já existe um link pronto:

`http://localhost:3090/vitrine/demo-loja-centro`

Esse link abre a vitrine do cliente "Loja Centro Comercial".

## 10. Gerar um novo link pelo painel

No painel:

1. Escolha um cliente no campo "Gerar vitrine para cliente".
2. Clique em `Gerar link`.
3. Copie o link gerado ou clique em `Abrir vitrine`.
4. Compartilhe esse link com o cliente final em uma demonstração.

Cada link é gravado na tabela `vitrine_tokens`.

## 11. Fazer um pedido pela vitrine

Na tela da vitrine:

1. Navegue pelos grupos de produtos.
2. Clique em `Adicionar` nos produtos desejados.
3. Abra o carrinho.
4. Informe uma observação, se necessário.
5. Clique para enviar o pedido.

O pedido será salvo nas tabelas:

- `pedidos`;
- `itensped`.

Ele será criado com:

- origem: `VITRINE`;
- situação: `PENDENTE`;
- tipo: `ORCAMENTO VITRINE`.

## 12. Ver pedidos recebidos

Volte para:

`http://localhost:3090`

Clique em `Atualizar pedidos`.

Na aba `Pedidos`, o painel exibirá os pedidos recebidos pela vitrine.

## 13. Como a vitrine decide quais produtos aparecem

A vitrine não mostra todos os produtos do cadastro.

Ela mostra somente produtos que:

- estão ativos na tabela `produto`;
- possuem situação `A`;
- estão na tabela de preço vinculada ao cliente;
- possuem preço ativo em `tabela_preco_itens`.

O vínculo do cliente com a tabela fica em:

`tabela_preco_vinculo`

## 14. Problemas comuns

### A tela abre, mas não mostra produtos

Verifique:

- se `tabela_preco_vinculo` possui vínculo para o cliente;
- se a tabela está ativa em `tabela_preco_cabecalho`;
- se os produtos possuem preço em `tabela_preco_itens`;
- se os produtos estão com `situacao = 'A'` e `excluido = 'N'`.

### Erro de conexão com banco

Verifique o arquivo `.env`:

- `DB_HOST`;
- `DB_PORT`;
- `DB_USER`;
- `DB_PASSWORD`;
- `DB_NAME`.

Também confirme se o MySQL está ligado.

### Porta em uso

Se `3090` já estiver ocupada, altere no `.env`:

```env
PORT=3091
```

Depois reinicie com:

```bat
npm start
```

### npm install falha

Confirme se o Node.js está instalado:

```bat
node -v
npm -v
```

Se não estiver, instale o Node.js 18 ou superior.

## 15. Roteiro rápido para apresentar ao cliente

1. Abra `http://localhost:3090`.
2. Mostre os clientes, produtos e tabela de preço.
3. Gere um link para um cliente.
4. Abra a vitrine.
5. Adicione produtos ao carrinho.
6. Envie o pedido.
7. Volte ao painel e atualize a aba `Pedidos`.
8. Explique que o pedido entrou como pendente para o representante confirmar.

## 16. Resumo dos links

- Painel: `http://localhost:3090`
- Vitrine demo: `http://localhost:3090/vitrine/demo-loja-centro`
- Health check: `http://localhost:3090/health`

## 17. Resumo técnico do fluxo

1. O painel chama `POST /api/vitrine/gerar`.
2. A API cria um token em `vitrine_tokens`.
3. O cliente acessa `/vitrine/:token`.
4. A vitrine busca dados em `GET /api/vitrine/:token`.
5. O cliente envia o carrinho para `POST /api/vitrine/:token/pedido`.
6. A API grava `pedidos` e `itensped`.
7. O painel consulta os pedidos em `GET /api/demo/pedidos`.

