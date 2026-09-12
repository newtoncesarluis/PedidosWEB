# Portal de Pedidos Sectra — status da proposta

> **Situação em 12/09/2026: proposta enviada ao cliente. Aguardando o aceite.**
> Nada deve ser desenvolvido até o cliente aprovar o escopo e responder as 7 perguntas do item 7.

## O que é

Proposta de um portal web/mobile para o representante lançar e acompanhar pedidos,
com **todos os dados vindos do ERP Sectra** (o portal não tem cadastro próprio).
Não é uma tela nova dentro do SysRepWeb com dados locais — é uma camada de digitação
e consulta sobre o Sectra.

Base funcional: `procedimento-original-sectra.docx` (procedimento interno de pedido WEB,
redigido pela Flávia — ela é a autora do documento, não é o cliente).

## Arquivos

| Arquivo | Para que serve |
|---|---|
| `escopo.html` | Documento de escopo (fonte). Publicado como Artifact — ver link abaixo |
| `escopo-print.html` | Mesma coisa com CSS de impressão + fontes embutidas; é daqui que sai o PDF |
| `Proposta-Portal-de-Pedidos-Sectra.pdf` | **O que foi enviado ao cliente** — A4, 8 páginas |
| `procedimento-original-sectra.docx` | Documento original do cliente, base de tudo |

Artifact (versão web, privada): https://claude.ai/code/artifact/25d5efb0-8cb0-4536-884b-6aaff9966fba

### Como regerar o PDF

```bash
chromium --headless --no-sandbox --disable-gpu --no-pdf-header-footer \
  --virtual-time-budget=15000 --font-render-hinting=none \
  --print-to-pdf=Proposta-Portal-de-Pedidos-Sectra.pdf \
  file://$PWD/escopo-print.html
```

As fontes (Archivo, Source Serif 4, IBM Plex Mono) estão embutidas em base64 dentro do
`escopo-print.html` — o PDF abre igual em qualquer máquina, sem internet.
Ao editar o `escopo.html`, replicar a mudança no `escopo-print.html` antes de gerar o PDF.

## Estrutura do escopo (8 itens)

1. O que estamos propondo
2. Como vai funcionar
3. A conversa entre o portal e o Sectra — 4 caminhos (A a D)
4. O que o portal vai fazer (4.1 a 4.9)
5. O que não muda — 5.1 continua no Sectra / 5.2 fora desta entrega
6. Como vamos entregar — 4 etapas
7. O que precisamos de vocês — 7 perguntas + plano se a Sectra recusar
8. Aprovação

## Decisões tomadas na redação

- **Linguagem de negócio, não técnica** — o documento é lido pelo cliente, não por TI.
  "API" aparece uma vez, explicada como "porta de comunicação".
- **Nada de citar a Flávia** no documento.
- **Item 5 é "O que não muda", não "o que não está incluído"** — emissão de NF,
  configurações fiscais/tributárias, rotinas fiscais, estoque e financeiro continuam
  todos no Sectra. Enquadrado como garantia, não como falta.
- **Referências são por item** (ex.: "ver item 3"), nunca por página — o PDF pagina
  diferente da versão web.
- **Prazo e valor ficaram de fora** de propósito: dependem do caminho de integração
  e das respostas do item 7. Vão em proposta comercial separada.
- **Caminho D existe para não dar poder de veto à Sectra**: leitura pelos relatórios
  que o cliente já exporta + digitação automática do pedido por um programa nosso
  rodando numa máquina da empresa. Mais frágil, mas não depende de autorização.

## Pendências antes de um próximo envio

- [ ] Nome do cliente no cabeçalho e contato no rodapé (hoje o documento está genérico)
- [ ] Prazo e valor, quando o caminho de integração estiver definido

## Quando o cliente aceitar

A primeira coisa é a **Etapa 1 (integração)**, não código de tela. Sem definir o caminho
A/B/C/D não dá para dimensionar nada. As respostas que destravam o projeto são as
perguntas 1 e 2 do item 7.
