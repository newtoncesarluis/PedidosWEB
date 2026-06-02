'use strict';

const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');

router.get('/clientes', async (_req, res) => {
  try {
    const [rows] = await getPool().query(`
      SELECT id, nome, cpf, email, telefone
      FROM clientes
      WHERE excluido = 'N'
      ORDER BY nome
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.get('/produtos', async (_req, res) => {
  try {
    const [rows] = await getPool().query(`
      SELECT p.ID AS id, p.descricao, p.cod_fabricante, p.unidade, p.nome_grupo,
             COALESCE(NULLIF(tpi.valor_tabela, 0), tpi.preco_venda, p.vlr_venda, 0) AS preco,
             f.nome AS fornecedor
      FROM produto p
      LEFT JOIN tabela_preco_itens tpi ON tpi.cod_produto = p.ID
        AND tpi.id_tabela = 1 AND tpi.excluido = 'N' AND COALESCE(tpi.ativo, 'S') = 'S'
      LEFT JOIN fornecedores f ON f.id = p.cod_fornecedorpadrao
      WHERE p.excluido = 'N'
      ORDER BY p.nome_grupo, p.descricao
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.get('/tabelas', async (_req, res) => {
  try {
    const [rows] = await getPool().query(`
      SELECT c.id, c.Descricao AS descricao, c.Tabela_Ativa,
             COUNT(i.id) AS itens
      FROM tabela_preco_cabecalho c
      LEFT JOIN tabela_preco_itens i ON i.id_tabela = c.id AND i.excluido = 'N'
      WHERE c.excluido = 'N'
      GROUP BY c.id
      ORDER BY c.id
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.get('/pedidos', async (_req, res) => {
  try {
    const [rows] = await getPool().query(`
      SELECT p.id, p.numero, p.nome_cliente, p.nome_fornecedor, p.situacao_pedido,
             p.vlrtotalpedido, p.dtcadastro, COUNT(i.id) AS itens
      FROM pedidos p
      LEFT JOIN itensped i ON i.id_pedido = p.id AND i.excluido = 'N'
      WHERE p.excluido = 'N'
      GROUP BY p.id
      ORDER BY p.id DESC
      LIMIT 50
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
