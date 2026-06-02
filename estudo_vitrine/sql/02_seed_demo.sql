USE estudo_vitrine;

INSERT INTO empresa (id_empresa, Razao_empresa) VALUES
(1, 'PedidosWeb Demo');

INSERT INTO usuarios (idusuario, nomeusu, loginusu, email, fone, numero_whatsApp, excluido) VALUES
(1, 'Representante Demo', 'demo', 'demo@pedidosweb.local', '(11) 99999-0000', '5511999990000', 'N');

INSERT INTO tipo_pedidos (id, descricao, padrao_vitrine, excluido) VALUES
(1, 'ORCAMENTO VITRINE', 'S', 'N');

INSERT INTO clientes (id, nome, cpf, email, telefone, excluido) VALUES
(1, 'Loja Centro Comercial', '12.345.678/0001-90', 'compras@lojacentro.local', '(11) 98888-1111', 'N'),
(2, 'Mercado Boa Vista', '98.765.432/0001-10', 'compras@boavista.local', '(11) 97777-2222', 'N'),
(3, 'Boutique Vila Nova', '45.111.222/0001-33', 'contato@vilanova.local', '(11) 96666-3333', 'N');

INSERT INTO fornecedores (id, nome, excluido) VALUES
(1, 'Industria Sol Nascente', 'N'),
(2, 'Distribuidora Serra Azul', 'N');

INSERT INTO produto
(ID, descricao, apelido, cod_barras, cod_fabricante, unidade, foto_principal, nome_grupo, cod_fornecedorpadrao, vlr_venda, situacao, excluido)
VALUES
(1, 'Cafe Especial Torrado 500g', 'Cafe 500g', '789100000001', 'CAF-500', 'UN', '', 'Mercearia', 1, 24.90, 'A', 'N'),
(2, 'Acucar Cristal 1kg', 'Acucar 1kg', '789100000002', 'ACU-1KG', 'UN', '', 'Mercearia', 1, 5.90, 'A', 'N'),
(3, 'Arroz Tipo 1 5kg', 'Arroz 5kg', '789100000003', 'ARR-5KG', 'UN', '', 'Mercearia', 1, 29.90, 'A', 'N'),
(4, 'Feijao Carioca 1kg', 'Feijao 1kg', '789100000004', 'FEI-1KG', 'UN', '', 'Mercearia', 1, 8.70, 'A', 'N'),
(5, 'Biscoito Recheado Chocolate 120g', 'Biscoito Chocolate', '789100000005', 'BIS-120', 'CX', '', 'Bomboniere', 2, 3.40, 'A', 'N'),
(6, 'Chocolate ao Leite 90g', 'Chocolate 90g', '789100000006', 'CHO-90', 'CX', '', 'Bomboniere', 2, 6.20, 'A', 'N'),
(7, 'Suco Integral Uva 1L', 'Suco Uva', '789100000007', 'SUC-UVA', 'UN', '', 'Bebidas', 2, 18.50, 'A', 'N'),
(8, 'Agua Mineral 500ml Pack 12un', 'Agua Pack', '789100000008', 'AGU-12', 'FD', '', 'Bebidas', 2, 21.00, 'A', 'N'),
(9, 'Detergente Neutro 500ml', 'Detergente', '789100000009', 'DET-500', 'CX', '', 'Limpeza', 1, 2.49, 'A', 'N'),
(10, 'Papel Toalha 2 Rolos', 'Papel Toalha', '789100000010', 'PAP-2R', 'FD', '', 'Limpeza', 1, 7.99, 'A', 'N');

INSERT INTO tabela_preco_cabecalho (id, Descricao, Tabela_Ativa, excluido) VALUES
(1, 'Tabela Vitrine Demo - Varejo', 'S', 'N');

INSERT INTO tabela_preco_itens
(id_tabela, item, cod_produto, descricao, cod_fabricante, unidade, preco_base, preco_venda, valor_tabela, ativo, excluido)
VALUES
(1, 1, 1, 'Cafe Especial Torrado 500g', 'CAF-500', 'UN', 24.90, 23.90, 23.90, 'S', 'N'),
(1, 2, 2, 'Acucar Cristal 1kg', 'ACU-1KG', 'UN', 5.90, 5.49, 5.49, 'S', 'N'),
(1, 3, 3, 'Arroz Tipo 1 5kg', 'ARR-5KG', 'UN', 29.90, 27.90, 27.90, 'S', 'N'),
(1, 4, 4, 'Feijao Carioca 1kg', 'FEI-1KG', 'UN', 8.70, 8.30, 8.30, 'S', 'N'),
(1, 5, 5, 'Biscoito Recheado Chocolate 120g', 'BIS-120', 'CX', 3.40, 3.19, 3.19, 'S', 'N'),
(1, 6, 6, 'Chocolate ao Leite 90g', 'CHO-90', 'CX', 6.20, 5.99, 5.99, 'S', 'N'),
(1, 7, 7, 'Suco Integral Uva 1L', 'SUC-UVA', 'UN', 18.50, 17.90, 17.90, 'S', 'N'),
(1, 8, 8, 'Agua Mineral 500ml Pack 12un', 'AGU-12', 'FD', 21.00, 19.90, 19.90, 'S', 'N'),
(1, 9, 9, 'Detergente Neutro 500ml', 'DET-500', 'CX', 2.49, 2.39, 2.39, 'S', 'N'),
(1, 10, 10, 'Papel Toalha 2 Rolos', 'PAP-2R', 'FD', 7.99, 7.49, 7.49, 'S', 'N');

INSERT INTO tabela_preco_vinculo (id_entidade, id_tabela, tipo_entidade, excluido) VALUES
(1, 1, 'CLIENTE', 'N'),
(2, 1, 'CLIENTE', 'N'),
(3, 1, 'CLIENTE', 'N');

INSERT INTO vitrine_tokens
(token, id_cliente, id_usuario, nome_cliente, nome_usuario, expira_em, ativo, id_empresa, nome_empresa)
VALUES
('demo-loja-centro', 1, 1, 'Loja Centro Comercial', 'Representante Demo', DATE_ADD(NOW(), INTERVAL 180 DAY), 1, 1, 'PedidosWeb Demo');
