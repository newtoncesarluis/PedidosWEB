'use strict';

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { getPool } = require('../config/database');

const uploadsProdutos = path.join(process.cwd(), 'public', 'uploads', 'produtos');

function fmtToken() {
  return crypto.randomBytes(24).toString('hex');
}

async function getValidToken(pool, token) {
  const [[tk]] = await pool.query(
    `SELECT * FROM vitrine_tokens
     WHERE token = ? AND ativo = 1 AND (expira_em IS NULL OR expira_em > NOW())
     LIMIT 1`,
    [token]
  );
  return tk || null;
}

async function getPrecoMap(pool, clienteId) {
  const [rows] = await pool.query(`
    SELECT tpi.cod_produto,
           COALESCE(NULLIF(tpi.valor_tabela, 0), tpi.preco_venda) AS preco
    FROM tabela_preco_vinculo tpv
    JOIN tabela_preco_cabecalho tpc ON tpc.id = tpv.id_tabela
    JOIN tabela_preco_itens tpi ON tpi.id_tabela = tpv.id_tabela
    WHERE tpv.id_entidade = ? AND tpv.tipo_entidade = 'CLIENTE'
      AND tpv.excluido = 'N' AND tpc.excluido = 'N'
      AND tpc.Tabela_Ativa = 'S' AND tpi.excluido = 'N'
      AND COALESCE(tpi.ativo, 'S') = 'S'
  `, [clienteId]);

  const map = {};
  rows.forEach(r => {
    const preco = parseFloat(r.preco);
    if (Number.isFinite(preco) && preco > 0) map[String(r.cod_produto)] = preco;
  });
  return map;
}

router.post('/gerar', async (req, res) => {
  const { id_cliente, dias_validade = 60 } = req.body || {};
  if (!id_cliente) return res.status(400).json({ erro: 'id_cliente obrigatorio' });

  try {
    const pool = getPool();
    const [[cliente]] = await pool.query(
      `SELECT id, nome FROM clientes WHERE id = ? AND excluido = 'N' LIMIT 1`,
      [id_cliente]
    );
    if (!cliente) return res.status(404).json({ erro: 'Cliente nao encontrado' });

    const [[usuario]] = await pool.query(
      `SELECT idusuario, nomeusu FROM usuarios WHERE excluido = 'N' ORDER BY idusuario LIMIT 1`
    );
    if (!usuario) return res.status(400).json({ erro: 'Cadastre ao menos um usuario no SQL demo' });

    const [[empresa]] = await pool.query(
      `SELECT id_empresa, Razao_empresa FROM empresa ORDER BY id_empresa LIMIT 1`
    ).catch(() => [[null]]);

    const token = fmtToken();
    const expira = new Date();
    expira.setDate(expira.getDate() + parseInt(dias_validade, 10));

    await pool.query(
      `UPDATE vitrine_tokens SET ativo = 0 WHERE id_cliente = ? AND id_usuario = ?`,
      [cliente.id, usuario.idusuario]
    );
    await pool.query(
      `INSERT INTO vitrine_tokens
       (token, id_cliente, id_usuario, nome_cliente, nome_usuario, expira_em, id_empresa, nome_empresa, ativo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        token,
        cliente.id,
        usuario.idusuario,
        cliente.nome,
        usuario.nomeusu,
        expira,
        empresa?.id_empresa || null,
        empresa?.Razao_empresa || ''
      ]
    );

    res.json({ token, expira, link: `/vitrine/${token}` });
  } catch (err) {
    console.error('[vitrine/gerar]', err);
    res.status(500).json({ erro: err.message });
  }
});

router.get('/:token', async (req, res) => {
  try {
    const pool = getPool();
    const tk = await getValidToken(pool, req.params.token);
    if (!tk) return res.status(404).json({ erro: 'Link invalido ou expirado' });

    const [[cliente]] = await pool.query(
      `SELECT id, nome, cpf, email, telefone FROM clientes WHERE id = ? LIMIT 1`,
      [tk.id_cliente]
    );
    if (!cliente) return res.status(404).json({ erro: 'Cliente nao encontrado' });

    const [[rep]] = await pool.query(
      `SELECT nomeusu AS nome, email, fone FROM usuarios WHERE idusuario = ? LIMIT 1`,
      [tk.id_usuario]
    ).catch(() => [[null]]);

    const precos = await getPrecoMap(pool, tk.id_cliente);
    const [produtos] = await pool.query(`
      SELECT p.ID AS id, p.descricao, p.apelido, p.cod_barras,
             p.cod_fabricante, p.unidade, p.foto_principal, p.nome_grupo,
             p.cod_fornecedorpadrao AS cod_fornecedor,
             COALESCE(f.nome, '') AS nome_fornecedor
      FROM produto p
      LEFT JOIN fornecedores f ON f.id = p.cod_fornecedorpadrao
      WHERE p.excluido = 'N' AND p.situacao = 'A'
      ORDER BY p.nome_grupo, p.descricao
    `);

    const lista = produtos
      .map(p => ({ ...p, preco: precos[String(p.id)] ?? null }))
      .filter(p => p.preco !== null);

    res.json({ cliente, representante: rep || null, produtos: lista });
  } catch (err) {
    console.error('[vitrine/get]', err);
    res.status(500).json({ erro: err.message });
  }
});

router.post('/:token/pedido', async (req, res) => {
  const { itens = [], obs = '' } = req.body || {};
  if (!itens.length) return res.status(400).json({ erro: 'Carrinho vazio' });

  try {
    const pool = getPool();
    const tk = await getValidToken(pool, req.params.token);
    if (!tk) return res.status(404).json({ erro: 'Link invalido ou expirado' });

    const [[cliente]] = await pool.query(
      `SELECT id, nome, cpf FROM clientes WHERE id = ? LIMIT 1`,
      [tk.id_cliente]
    );
    if (!cliente) return res.status(404).json({ erro: 'Cliente nao encontrado' });

    const precos = await getPrecoMap(pool, tk.id_cliente);
    const prodIds = itens.map(i => parseInt(i.id, 10)).filter(Boolean);
    const [prodRows] = await pool.query(`
      SELECT p.ID AS id, p.descricao, p.unidade, p.cod_fornecedorpadrao AS cod_fornecedor,
             COALESCE(f.nome, '') AS nome_fornecedor
      FROM produto p
      LEFT JOIN fornecedores f ON f.id = p.cod_fornecedorpadrao
      WHERE p.ID IN (?)
    `, [prodIds.length ? prodIds : [0]]);

    const produtos = {};
    prodRows.forEach(p => { produtos[String(p.id)] = p; });

    const itensValidados = itens.map(i => {
      const id = String(i.id);
      const preco = precos[id];
      const quantidade = parseFloat(i.quantidade);
      const prod = produtos[id];
      if (!prod || !preco || !Number.isFinite(quantidade) || quantidade <= 0) {
        throw Object.assign(new Error(`Produto ${id} sem preco autorizado`), { status: 422 });
      }
      return { ...prod, preco, quantidade };
    });

    const [[tp]] = await pool.query(
      `SELECT id, descricao FROM tipo_pedidos WHERE padrao_vitrine = 'S' AND excluido = 'N' LIMIT 1`
    ).catch(() => [[null]]);
    const idTipoPedido = tp?.id || null;
    const tipoPedido = tp?.descricao || 'ORCAMENTO';

    const grupos = new Map();
    itensValidados.forEach(item => {
      const key = item.cod_fornecedor || '__sem_fornecedor__';
      if (!grupos.has(key)) {
        grupos.set(key, {
          cod_fornecedor: item.cod_fornecedor || null,
          nome_fornecedor: item.nome_fornecedor || '',
          itens: []
        });
      }
      grupos.get(key).itens.push(item);
    });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const pedidosCriados = [];
      const agora = new Date();
      const dataAbertura = agora.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }).split('/').reverse().join('-');
      const horaAbertura = agora.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false });

      for (const [, grupo] of grupos) {
        const [[seq]] = await conn.query(
          `SELECT LPAD((COALESCE(MAX(numero + 0), 0) + 1), 6, '0') AS proximo FROM pedidos`
        );
        const numero = seq.proximo;
        const total = parseFloat(grupo.itens.reduce((s, i) => s + i.preco * i.quantidade, 0).toFixed(2));

        const [pRes] = await conn.query(
          `INSERT INTO pedidos (
            numero, data_abertura, hora_abertura,
            id_usuario, nome_vendedor, cod_cliente, cnpj, nome_cliente,
            cod_fornecedor, nome_fornecedor,
            id_tipopedido, tipo_pedido, situacao_pedido, status,
            vlrsubtotal, vlrtotalitens, vlrtotalpedido,
            vlrdesconto, vlrtotalimposto, vlrtotalbruto,
            id_filial, id_empresa, nome_empresa,
            obs, origem, excluido, dtcadastro
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
          [
            numero, dataAbertura, horaAbertura,
            tk.id_usuario, tk.nome_usuario,
            cliente.id, cliente.cpf || '', cliente.nome,
            grupo.cod_fornecedor, grupo.nome_fornecedor,
            idTipoPedido, tipoPedido, 'PENDENTE', 'PENDENTE',
            total, total, total, 0, 0, total,
            tk.id_empresa || null, tk.id_empresa || null, tk.nome_empresa || '',
            obs || '', 'VITRINE', 'N'
          ]
        );

        for (let i = 0; i < grupo.itens.length; i++) {
          const item = grupo.itens[i];
          const vlrItem = parseFloat((item.preco * item.quantidade).toFixed(2));
          await conn.query(
            `INSERT INTO itensped (
              numpedido, id_pedido, cod_produto, desc_prod, unidade,
              quantidade, valor_unitario, vlrtotal_itens,
              desconto, comissao, st, vlr_st, ipi, vlr_ipi, icms, vlr_icms,
              tipo_pedido, sequencia, cod_fornecedor, data_inclusao, sincronizar, excluido
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURDATE(),'N','N')`,
            [
              numero, pRes.insertId, item.id, item.descricao, item.unidade || 'UN',
              item.quantidade, item.preco, vlrItem,
              0, 0, 0, 0, 0, 0, 0, 0,
              tipoPedido, i + 1, item.cod_fornecedor || null
            ]
          );
        }

        pedidosCriados.push({
          numero,
          pedido_id: pRes.insertId,
          fornecedor: grupo.nome_fornecedor,
          total
        });
      }

      await conn.commit();
      res.json({ ok: true, pedidos: pedidosCriados });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('[vitrine/pedido]', err);
    res.status(err.status || 500).json({ erro: err.message || 'Erro ao registrar pedido' });
  }
});

router.get('/:token/imagens/:prodId', async (req, res) => {
  try {
    const pool = getPool();
    const tk = await getValidToken(pool, req.params.token);
    if (!tk) return res.status(404).json({ erro: 'Link invalido ou expirado' });

    const prodId = String(req.params.prodId);
    const [rows] = await pool.query(
      `SELECT filename, is_principal FROM produto_imagens
       WHERE cod_produto = ? ORDER BY is_principal DESC, ordem, id`,
      [prodId]
    ).catch(() => [[]]);

    const imgs = rows
      .filter(r => r.filename && fs.existsSync(path.join(uploadsProdutos, prodId, r.filename)))
      .map(r => ({ url: `/uploads/produtos/${prodId}/${r.filename}`, is_principal: r.is_principal }));

    if (imgs.length) return res.json(imgs);

    const [[p]] = await pool.query(
      `SELECT foto_principal FROM produto WHERE ID = ? AND excluido = 'N' LIMIT 1`,
      [prodId]
    );
    res.json(p?.foto_principal ? [{ url: p.foto_principal, is_principal: 1 }] : []);
  } catch (err) {
    console.error('[vitrine/imagens]', err);
    res.status(500).json({ erro: err.message });
  }
});

router.get('/:token/historico/:pedidoId/itens', async (req, res) => {
  try {
    const pool = getPool();
    const tk = await getValidToken(pool, req.params.token);
    if (!tk) return res.status(404).json({ erro: 'Link invalido ou expirado' });

    const [[ped]] = await pool.query(
      `SELECT id FROM pedidos WHERE id = ? AND cod_cliente = ? AND excluido = 'N' LIMIT 1`,
      [req.params.pedidoId, tk.id_cliente]
    );
    if (!ped) return res.status(403).json({ erro: 'Pedido nao encontrado' });

    const [itens] = await pool.query(`
      SELECT desc_prod, quantidade, valor_unitario, vlrtotal_itens, unidade
      FROM itensped
      WHERE id_pedido = ? AND excluido = 'N'
      ORDER BY sequencia
    `, [req.params.pedidoId]);

    res.json(itens);
  } catch (err) {
    console.error('[vitrine/historico/itens]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

router.get('/:token/historico', async (req, res) => {
  try {
    const pool = getPool();
    const tk = await getValidToken(pool, req.params.token);
    if (!tk) return res.status(404).json({ erro: 'Link invalido ou expirado' });

    const [pedidos] = await pool.query(`
      SELECT p.id, p.numero, p.data_abertura, p.situacao_pedido, p.status,
             p.vlrtotalpedido, p.nome_fornecedor, p.dtcadastro,
             COUNT(i.id) AS qtd_itens
      FROM pedidos p
      LEFT JOIN itensped i ON i.id_pedido = p.id AND i.excluido = 'N'
      WHERE p.cod_cliente = ? AND p.origem = 'VITRINE' AND p.excluido = 'N'
      GROUP BY p.id
      ORDER BY p.id DESC
      LIMIT 50
    `, [tk.id_cliente]);

    res.json(pedidos);
  } catch (err) {
    console.error('[vitrine/historico]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

module.exports = router;
