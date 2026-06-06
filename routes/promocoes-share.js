'use strict';

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const {
  getPool,
  getPoolForLicense,
  runWithPool,
  customerDbFromLicense,
  _poolMapKeys,
} = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const {
  calcularPrecoPromocao,
  formatarPromocaoRow,
  tabelaPromocoesExiste,
  escolherMelhorPromocao,
  filtrarPromocoesPorContexto,
} = require('../config/promocoes-produto');
const { getCampanha } = require('../config/promocoes-campanha');
const { ensureItenspedPromoColumns } = require('../config/schema-migrations');
const axios = require('axios');

const _tableReadyPools = new Set();
const _prodTableMap = new Map();
const _prodFornColMap = new Map();

async function ensureTable(pool) {
  if (_tableReadyPools.has(pool)) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS promocoes_share_tokens (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      token         VARCHAR(64)  NOT NULL UNIQUE,
      id_campanha   INT          NULL,
      id_cliente    INT          NULL,
      id_usuario    INT          NOT NULL,
      nome_usuario  VARCHAR(255) NULL,
      nome_campanha VARCHAR(255) NULL,
      nome_cliente  VARCHAR(255) NULL,
      criado_em     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      expira_em     TIMESTAMP    NULL,
      ativo         TINYINT(1)   DEFAULT 1,
      INDEX idx_token (token),
      INDEX idx_campanha (id_campanha)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `).catch(() => {});
  _tableReadyPools.add(pool);
}

async function detectProdTable(pool) {
  if (_prodTableMap.has(pool)) return _prodTableMap.get(pool);
  const [rows] = await pool.query(`SHOW TABLES LIKE 'produto'`);
  const name = rows.length ? 'produto' : 'produtos';
  _prodTableMap.set(pool, name);
  return name;
}

async function detectProdFornCol(pool, prodTb) {
  const key = `${prodTb}`;
  if (_prodFornColMap.has(key)) return _prodFornColMap.get(key);
  const [cols] = await pool.query(`SHOW COLUMNS FROM ${prodTb} LIKE 'cod_fornecedorpadrao'`).catch(() => [[]]);
  const has = cols.length > 0;
  _prodFornColMap.set(key, has);
  return has;
}

async function mapaFornecedoresProdutos(pool, prodIds) {
  const map = {};
  if (!prodIds.length) return map;
  const prodTb = await detectProdTable(pool);
  if (!(await detectProdFornCol(pool, prodTb))) return map;
  const [rows] = await pool.query(`
    SELECT p.ID AS id, p.cod_fornecedorpadrao AS cod_fornecedor, COALESCE(f.nome, '') AS nome_fornecedor
    FROM ${prodTb} p
    LEFT JOIN fornecedores f ON f.id = p.cod_fornecedorpadrao
    WHERE p.ID IN (?)
  `, [prodIds]).catch(() => [[]]);
  rows.forEach((r) => {
    map[String(r.id)] = { cod_fornecedor: r.cod_fornecedor || null, nome_fornecedor: r.nome_fornecedor || '' };
  });
  return map;
}

async function carregarTokenAtivo(pool, token) {
  const [[tk]] = await pool.query(
    `SELECT * FROM promocoes_share_tokens
     WHERE token = ? AND ativo = 1 AND (expira_em IS NULL OR expira_em > NOW())`,
    [token]
  );
  return tk || null;
}

async function notificarRepPromo(pool, tk, pedidosCriados, nomeCliente) {
  const [[rep]] = await pool.query(
    `SELECT instancia, chave, numero_whatsApp FROM usuarios WHERE idusuario = ? LIMIT 1`,
    [tk.id_usuario]
  ).catch(() => [[null]]);
  if (!rep?.instancia || !rep?.numero_whatsApp) return;

  const [[cfg]] = await pool.query(
    `SELECT w_urlplataforma AS url, w_apiglobal AS apikey FROM configuracao WHERE excluido='N' ORDER BY id DESC LIMIT 1`
  ).catch(() => [[null]]);
  if (!cfg?.url || !cfg?.apikey) return;

  const numero = String(rep.numero_whatsApp).replace(/\D/g, '');
  if (!numero) return;

  const fmtBRL = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const totalGeral = pedidosCriados.reduce((s, p) => s + (p.total || 0), 0);
  const linhas = pedidosCriados.map((p) =>
    `📋 Orçamento *${p.numero}*${p.fornecedor ? ` — ${p.fornecedor}` : ''} — ${fmtBRL(p.total || 0)}`
  ).join('\n');
  const camp = tk.nome_campanha || 'Promoções';
  const msg = `🏷️ *Novo orçamento — campanha ${camp}*\n\nCliente: *${nomeCliente}*\n\n${linhas}\n\n💰 Total: *${fmtBRL(totalGeral)}*\n\nAcesse o sistema para confirmar.`;

  const baseUrl = cfg.url.replace(/\/$/, '');
  const instKey = rep.chave || cfg.apikey;
  await axios.post(
    `${baseUrl}/message/sendText/${rep.instancia}`,
    { number: numero, text: msg },
    { headers: { 'Content-Type': 'application/json', apikey: instKey }, timeout: 10000 }
  );
}

async function findPoolForToken(token) {
  if (!customerDbFromLicense()) {
    const p = getPool();
    await ensureTable(p);
    return p;
  }
  for (const key of _poolMapKeys()) {
    const p = getPoolForLicense(key);
    if (!p) continue;
    try {
      await ensureTable(p);
      const [[row]] = await p.query(
        'SELECT id FROM promocoes_share_tokens WHERE token = ? LIMIT 1',
        [token]
      );
      if (row) return p;
    } catch { /* ignora */ }
  }
  return null;
}

async function mapaPrecosCliente(pool, idCliente) {
  const [precos] = await pool.query(`
    SELECT tpi.cod_produto, tpi.preco_venda
    FROM tabela_preco_vinculo tpv
    JOIN tabela_preco_cabecalho tpc ON tpc.id = tpv.id_tabela
    JOIN tabela_preco_itens tpi ON tpi.id_tabela = tpv.id_tabela
    WHERE tpv.id_entidade = ? AND tpv.tipo_entidade = 'CLIENTE'
      AND tpv.excluido = 'N' AND tpc.excluido = 'N'
      AND tpc.Tabela_Ativa = 'S' AND tpi.excluido = 'N'
  `, [idCliente]).catch(() => [[]]);
  const map = {};
  (precos || []).forEach((p) => {
    map[String(p.cod_produto)] = parseFloat(p.preco_venda);
  });
  return map;
}

async function resolverTabelaCliente(pool, idCliente) {
  try {
    const [vinc] = await pool.query(`
      SELECT v.id_tabela
      FROM tabela_preco_vinculo v
      JOIN tabela_preco_cabecalho c ON c.id = v.id_tabela
      WHERE v.id_entidade = ? AND v.tipo_entidade = 'CLIENTE'
        AND v.excluido = 'N' AND c.excluido = 'N' AND c.Tabela_Ativa = 'S'
      LIMIT 1
    `, [idCliente]);
    return vinc[0]?.id_tabela || null;
  } catch {
    return null;
  }
}

function normalizarFotoUrl(foto) {
  if (!foto) return null;
  const s = String(foto).trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s) || s.startsWith('data:')) return s;
  return s.startsWith('/') ? s : `/${s}`;
}

async function ctxFromCliente(pool, idCliente) {
  if (!idCliente) return { ctx: null, nome: null };
  const [[c]] = await pool.query(
    `SELECT id, nome, regiao FROM clientes WHERE id = ? AND excluido = 'N' LIMIT 1`,
    [idCliente]
  );
  if (!c) return { ctx: null, nome: null };
  const idTabelaPreco = await resolverTabelaCliente(pool, c.id);
  return {
    ctx: {
      codCliente: c.id,
      idRegiao: c.regiao || null,
      codFornecedor: null,
      idTabelaPreco,
    },
    nome: c.nome,
  };
}

function melhorPromoParaShare(promos, vlrBase, qtd, ctx) {
  if (!promos?.length) return null;
  const q = parseFloat(qtd) || 1;
  const base = parseFloat(vlrBase) || 0;

  if (ctx) {
    const filtradas = filtrarPromocoesPorContexto(promos, ctx);
    if (!filtradas.length) return null;
    return escolherMelhorPromocao(filtradas, base, q, ctx);
  }

  // Link público sem cliente: exibe itens da campanha com preço de cadastro/tabela padrão
  const elegivel = promos.filter((r) => (parseFloat(r.qtd_minima) || 1) <= q);
  const poolRows = elegivel.length ? elegivel : promos;
  poolRows.sort((a, b) => {
    const pa = calcularPrecoPromocao(a.tipo, a.valor, base);
    const pb = calcularPrecoPromocao(b.tipo, b.valor, base);
    if (pa !== pb) return pa - pb;
    return (parseFloat(b.qtd_minima) || 1) - (parseFloat(a.qtd_minima) || 1);
  });
  return formatarPromocaoRow(poolRows[0], base, q);
}

async function listarProdutosPromoShare(pool, opts) {
  const { idCampanha, ctx, mapaPrecos } = opts;
  if (!(await tabelaPromocoesExiste(pool))) return [];

  const prodTb = await detectProdTable(pool);
  let camp = null;
  if (idCampanha) {
    camp = await getCampanha(pool, idCampanha);
    if (!camp || !camp.ativo) return [];
  }

  let sql = `
    SELECT pp.id, pp.cod_produto, pp.tipo, pp.valor, pp.qtd_minima,
           pp.descricao AS pp_descricao, pp.data_inicio, pp.data_fim, pp.destaque,
           pp.cod_cliente, pp.id_regiao, pp.cod_fornecedor, pp.id_tabela_preco, pp.tabelas_preco,
           p.descricao, p.apelido, p.unidade, p.vlr_venda, p.foto_principal, p.cod_fabricante
    FROM produto_promocoes pp
    INNER JOIN ${prodTb} p ON p.ID = pp.cod_produto
    WHERE pp.excluido = 'N'
      AND (p.excluido = 'N' OR p.excluido IS NULL OR p.excluido = '')`;
  const params = [];

  if (idCampanha) {
    // Campanha: mesmos produtos da tela interna (escopo já validado na campanha)
    sql += ` AND (p.situacao = 'A' OR p.situacao IS NULL OR p.situacao = '')`;
  } else {
    sql += ` AND pp.ativo = 'S'
      AND p.situacao = 'A'
      AND (pp.data_inicio IS NULL OR pp.data_inicio <= CURDATE())
      AND (pp.data_fim IS NULL OR pp.data_fim >= CURDATE())`;
  }

  if (idCampanha) {
    sql += ' AND pp.id_campanha = ?';
    params.push(idCampanha);
  }

  sql += ' ORDER BY p.descricao, pp.qtd_minima DESC, pp.id DESC';

  const [rows] = await pool.query(sql, params);
  const porProduto = new Map();

  for (const r of rows) {
    const pid = String(r.cod_produto);
    if (!porProduto.has(pid)) porProduto.set(pid, []);
    porProduto.get(pid).push(r);
  }

  const itens = [];
  for (const [, promos] of porProduto) {
    const ref = promos[0];
    const vlrBase = mapaPrecos[String(ref.cod_produto)] ?? (parseFloat(ref.vlr_venda) || 0);
    const melhor = melhorPromoParaShare(promos, vlrBase, 1, ctx || null);
    if (!melhor) continue;

    const row = promos.find((x) => x.id === melhor.id) || ref;
    itens.push({
      id: ref.cod_produto,
      id_promocao: melhor.id,
      descricao: ref.descricao || '',
      apelido: ref.apelido || null,
      unidade: ref.unidade || null,
      cod_fabricante: ref.cod_fabricante || null,
      foto: normalizarFotoUrl(ref.foto_principal),
      preco_tabela: vlrBase,
      preco_promo: melhor.preco_promo,
      economia: vlrBase > 0 ? Math.round((vlrBase - melhor.preco_promo) * 100) / 100 : 0,
      qtd_minima: melhor.qtd_minima || 1,
      promo_descricao: row.pp_descricao || melhor.descricao || null,
      destaque: row.destaque === 'S',
      vigencia_inicio: row.data_inicio || null,
      vigencia_fim: row.data_fim || null,
    });
  }

  itens.sort((a, b) => String(a.descricao).localeCompare(String(b.descricao), 'pt-BR'));
  return itens;
}

// POST /api/promocoes-share/gerar
router.post('/gerar', authMiddleware, async (req, res) => {
  const user = req.user;
  const idCampanha = parseInt(req.body?.id_campanha, 10) || null;
  const idCliente = parseInt(req.body?.id_cliente, 10) || null;
  const diasValidade = Math.min(365, Math.max(1, parseInt(req.body?.dias_validade, 10) || 30));

  try {
    const pool = getPool();
    await ensureTable(pool);

    if (!(await tabelaPromocoesExiste(pool))) {
      return res.status(503).json({ erro: 'Módulo de promoções indisponível nesta base.' });
    }

    let nomeCampanha = 'Promoções ativas';
    if (idCampanha) {
      const camp = await getCampanha(pool, idCampanha);
      if (!camp) return res.status(404).json({ erro: 'Campanha não encontrada' });
      if (!camp.ativo) return res.status(400).json({ erro: 'Campanha inativa — reative antes de compartilhar.' });
      if ((camp.qtd_produtos || 0) === 0) {
        return res.status(400).json({ erro: 'Campanha sem produtos — use + Produtos antes de compartilhar.' });
      }
      nomeCampanha = camp.descricao || nomeCampanha;
    }

    let nomeCliente = null;
    if (idCliente) {
      const { nome } = await ctxFromCliente(pool, idCliente);
      if (!nome) return res.status(404).json({ erro: 'Cliente não encontrado' });
      nomeCliente = nome;
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expira = new Date();
    expira.setDate(expira.getDate() + diasValidade);

    const userId = user.id || user.idusuario;
    const nomeUser = user.nome || user.nomeusu || '';

    await pool.query(
      `UPDATE promocoes_share_tokens SET ativo = 0
       WHERE id_usuario = ? AND COALESCE(id_campanha, 0) = COALESCE(?, 0)
         AND COALESCE(id_cliente, 0) = COALESCE(?, 0)`,
      [userId, idCampanha, idCliente]
    );

    await pool.query(
      `INSERT INTO promocoes_share_tokens
        (token, id_campanha, id_cliente, id_usuario, nome_usuario, nome_campanha, nome_cliente, expira_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [token, idCampanha, idCliente, userId, nomeUser, nomeCampanha, nomeCliente, expira]
    );

    let ctxGerar = null;
    let mapaGerar = {};
    if (idCliente) {
      const cli = await ctxFromCliente(pool, idCliente);
      ctxGerar = cli.ctx;
      mapaGerar = await mapaPrecosCliente(pool, idCliente);
    }
    const produtosPreview = await listarProdutosPromoShare(pool, {
      idCampanha: idCampanha || null,
      ctx: ctxGerar,
      mapaPrecos: mapaGerar,
    });

    res.json({
      token,
      expira,
      link: `/promocoes/${token}`,
      nome_campanha: nomeCampanha,
      nome_cliente: nomeCliente,
      qtd_produtos: produtosPreview.length,
    });
  } catch (err) {
    console.error('[promocoes-share/gerar]', err);
    res.status(500).json({ erro: err.message });
  }
});

async function validarItensOrcamento(pool, tk, itensReq, ctx, mapaPrecos) {
  const produtos = await listarProdutosPromoShare(pool, {
    idCampanha: tk.id_campanha || null,
    ctx,
    mapaPrecos,
  });
  const mapa = new Map(produtos.map((p) => [String(p.id), p]));
  const prodIds = [...new Set(itensReq.map((i) => parseInt(i.id, 10)).filter((x) => x > 0))];
  const mapaForn = await mapaFornecedoresProdutos(pool, prodIds);
  const validados = [];

  for (const raw of itensReq) {
    const id = parseInt(raw.id, 10);
    const qtd = parseFloat(raw.quantidade);
    if (!id || !Number.isFinite(qtd) || qtd <= 0) {
      throw Object.assign(new Error('Quantidade inválida em um dos itens'), { status: 400 });
    }
    const p = mapa.get(String(id));
    if (!p) {
      throw Object.assign(new Error(`Produto #${id} não disponível nesta promoção`), { status: 422 });
    }
    const qMin = parseFloat(p.qtd_minima) || 1;
    if (qtd < qMin) {
      throw Object.assign(
        new Error(`"${p.descricao}" exige mínimo de ${qMin} un.`),
        { status: 400 }
      );
    }
    const forn = mapaForn[String(id)] || {};
    validados.push({
      id,
      descricao: p.descricao,
      unidade: p.unidade || 'UN',
      quantidade: qtd,
      preco: p.preco_promo,
      vlr_padrao: p.preco_tabela,
      id_promocao: p.id_promocao,
      promo_descricao: p.promo_descricao,
      cod_fornecedor: forn.cod_fornecedor || null,
      nome_fornecedor: forn.nome_fornecedor || '',
    });
  }
  return validados;
}

// POST /api/promocoes-share/:token/orcamento  (público)
router.post('/:token/orcamento', async (req, res) => {
  const itensReq = Array.isArray(req.body?.itens) ? req.body.itens : [];
  if (!itensReq.length) return res.status(400).json({ erro: 'Selecione ao menos um produto' });

  try {
    const pool = await findPoolForToken(req.params.token);
    if (!pool) return res.status(404).json({ erro: 'Link inválido ou expirado' });

    const out = await runWithPool(pool, async () => {
      const tk = await carregarTokenAtivo(pool, req.params.token);
      if (!tk) return { status: 404, erro: 'Link inválido ou expirado' };

      if (tk.id_campanha) {
        const camp = await getCampanha(pool, tk.id_campanha);
        if (!camp || !camp.ativo) return { status: 410, erro: 'Campanha encerrada ou inativa' };
      }

      let codCliente = null;
      let nomeCliente = '';
      let cnpjCliente = '';
      const contato = req.body?.contato || {};

      if (tk.id_cliente) {
        const [[cli]] = await pool.query(
          `SELECT id, nome, cpf FROM clientes WHERE id = ? AND excluido = 'N' LIMIT 1`,
          [tk.id_cliente]
        );
        if (!cli) return { status: 410, erro: 'Cliente deste link não está mais disponível' };
        codCliente = cli.id;
        nomeCliente = cli.nome || tk.nome_cliente || '';
        cnpjCliente = cli.cpf || '';
      } else {
        nomeCliente = String(contato.nome || '').trim();
        const tel = String(contato.telefone || '').trim();
        if (!nomeCliente || tel.length < 8) {
          return { status: 400, erro: 'Informe seu nome e telefone para solicitar orçamento' };
        }
        const cidade = String(contato.cidade || '').trim();
        const extraObs = `[Promoções web] Tel: ${tel}${cidade ? ` · ${cidade}` : ''}`;
        req.body._obsContato = extraObs;
      }

      const { ctx } = tk.id_cliente
        ? await ctxFromCliente(pool, tk.id_cliente)
        : { ctx: null };
      const mapaPrecos = tk.id_cliente ? await mapaPrecosCliente(pool, tk.id_cliente) : {};

      let itensValidados;
      try {
        itensValidados = await validarItensOrcamento(pool, tk, itensReq, ctx, mapaPrecos);
      } catch (e) {
        return { status: e.status || 400, erro: e.message };
      }

      const [[tp]] = await pool.query(
        `SELECT id, descricao FROM tipo_pedidos
         WHERE padrao_vitrine = 'S' AND excluido = 'N' LIMIT 1`
      ).catch(() => [[null]]);
      const idTipopedido = tp?.id || null;
      const tipoPedidoStr = tp?.descricao || 'ORÇAMENTO';

      const grupos = new Map();
      for (const item of itensValidados) {
        const key = item.cod_fornecedor ?? '__sem_forn__';
        if (!grupos.has(key)) {
          grupos.set(key, {
            cod_fornecedor: item.cod_fornecedor,
            nome_fornecedor: item.nome_fornecedor,
            itens: [],
          });
        }
        grupos.get(key).itens.push(item);
      }

      const agora = new Date();
      const dataAb = agora.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }).split('/').reverse().join('-');
      const horaAb = agora.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false });
      const obsUser = String(req.body?.obs || '').trim();
      const obsCamp = tk.nome_campanha ? `Campanha: ${tk.nome_campanha}` : 'Promoções';
      const obsParts = [obsCamp, req.body._obsContato, obsUser].filter(Boolean);
      const obsFinal = obsParts.join('\n');

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await ensureItenspedPromoColumns(conn);
        const pedidosCriados = [];

        for (const [, grupo] of grupos) {
          const [[seq]] = await conn.query(
            `SELECT LPAD((COALESCE(MAX(numero + 0), 0) + 1), 6, '0') AS proximo FROM pedidos`
          );
          const numero = seq.proximo;
          const totalGrupo = parseFloat(
            grupo.itens.reduce((s, i) => s + i.preco * i.quantidade, 0).toFixed(2)
          );

          const [pRes] = await conn.query(
            `INSERT INTO pedidos (
              numero, data_abertura, hora_abertura,
              id_usuario, nome_vendedor,
              cod_cliente, cnpj, nome_cliente,
              cod_fornecedor, nome_fornecedor,
              id_tipopedido, tipo_pedido, situacao_pedido, status,
              vlrsubtotal, vlrtotalitens, vlrtotalpedido,
              vlrdesconto, vlrtotalimposto, vlrtotalbruto,
              obs, origem, excluido, dtcadastro
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
            [
              numero, dataAb, horaAb,
              tk.id_usuario, tk.nome_usuario || '',
              codCliente, cnpjCliente, (nomeCliente || '').toUpperCase(),
              grupo.cod_fornecedor || null, (grupo.nome_fornecedor || '').toUpperCase(),
              idTipopedido, tipoPedidoStr, 'PENDENTE', 'PENDENTE',
              totalGrupo, totalGrupo, totalGrupo, 0, 0, totalGrupo,
              obsFinal, 'PROMO_SHARE', 'N',
            ]
          );
          const pedidoId = pRes.insertId;

          for (let i = 0; i < grupo.itens.length; i++) {
            const item = grupo.itens[i];
            const vlrItem = parseFloat((item.preco * item.quantidade).toFixed(2));
            await conn.query(
              `INSERT INTO itensped (
                numpedido, id_pedido, cod_produto, desc_prod, unidade,
                quantidade, vlr_padrao, valor_unitario, vlrtotal_itens,
                desconto, comissao, st, vlr_st, ipi, vlr_ipi, icms, vlr_icms,
                tipo_pedido, sequencia, cod_fornecedor,
                tipo_preco, id_promocao, promocao_descricao,
                data_inclusao, sincronizar, excluido
              ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURDATE(),'N','N')`,
              [
                numero, pedidoId,
                item.id, item.descricao || '', item.unidade || 'UN',
                item.quantidade, item.vlr_padrao, item.preco, vlrItem,
                0, 0, 0, 0, 0, 0, 0, 0,
                tipoPedidoStr, i + 1, item.cod_fornecedor || null,
                'promo', item.id_promocao || null,
                item.promo_descricao ? String(item.promo_descricao).slice(0, 200) : null,
              ]
            );
          }

          pedidosCriados.push({
            numero,
            pedido_id: pedidoId,
            fornecedor: grupo.nome_fornecedor || '',
            total: totalGrupo,
          });
        }

        await conn.commit();
        return { status: 200, body: { ok: true, pedidos: pedidosCriados } };
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    });

    if (!out || out.status !== 200) {
      return res.status(out?.status || 500).json({ erro: out?.erro || 'Erro ao registrar orçamento' });
    }

    res.json(out.body);

    const pool2 = await findPoolForToken(req.params.token);
    if (pool2) {
      runWithPool(pool2, async () => {
        const tk = await carregarTokenAtivo(pool2, req.params.token);
        if (!tk) return;
        const nome = tk.id_cliente
          ? (tk.nome_cliente || 'Cliente')
          : String(req.body?.contato?.nome || 'Visitante');
        await notificarRepPromo(pool2, tk, out.body.pedidos, nome).catch((e) => {
          console.error('[promocoes-share/wpp]', e.message);
        });
      }).catch(() => {});
    }
  } catch (err) {
    console.error('[promocoes-share/orcamento]', err);
    res.status(err.status || 500).json({ erro: err.message || 'Erro ao registrar orçamento' });
  }
});

// GET /api/promocoes-share/:token/historico/:pedidoId/itens  (público — link com cliente)
router.get('/:token/historico/:pedidoId/itens', async (req, res) => {
  try {
    const pool = await findPoolForToken(req.params.token);
    if (!pool) return res.status(404).json({ erro: 'Link inválido ou expirado' });

    await runWithPool(pool, async () => {
      const tk = await carregarTokenAtivo(pool, req.params.token);
      if (!tk) return res.status(404).json({ erro: 'Link inválido ou expirado' });
      if (!tk.id_cliente) return res.status(403).json({ erro: 'Histórico disponível apenas em links por cliente' });

      const [[ped]] = await pool.query(
        `SELECT id FROM pedidos
         WHERE id = ? AND cod_cliente = ? AND origem = 'PROMO_SHARE' AND excluido = 'N' LIMIT 1`,
        [req.params.pedidoId, tk.id_cliente]
      );
      if (!ped) return res.status(403).json({ erro: 'Orçamento não encontrado' });

      const [itens] = await pool.query(`
        SELECT desc_prod, quantidade, valor_unitario, vlrtotal_itens, unidade, tipo_preco
        FROM itensped
        WHERE id_pedido = ? AND excluido = 'N'
        ORDER BY sequencia
      `, [req.params.pedidoId]);

      res.json(itens);
    });
  } catch (err) {
    console.error('[promocoes-share/historico/itens]', err);
    res.status(500).json({ erro: err.message });
  }
});

// GET /api/promocoes-share/:token/historico  (público — link com cliente)
router.get('/:token/historico', async (req, res) => {
  try {
    const pool = await findPoolForToken(req.params.token);
    if (!pool) return res.status(404).json({ erro: 'Link inválido ou expirado' });

    await runWithPool(pool, async () => {
      const tk = await carregarTokenAtivo(pool, req.params.token);
      if (!tk) return res.status(404).json({ erro: 'Link inválido ou expirado' });
      if (!tk.id_cliente) return res.status(403).json({ erro: 'Histórico disponível apenas em links por cliente' });

      const [pedidos] = await pool.query(`
        SELECT p.id, p.numero, p.data_abertura, p.situacao_pedido, p.status,
               p.vlrtotalpedido, p.nome_fornecedor, p.dtcadastro, p.obs,
               COUNT(i.id) AS qtd_itens
        FROM pedidos p
        LEFT JOIN itensped i ON i.id_pedido = p.id AND i.excluido = 'N'
        WHERE p.cod_cliente = ? AND p.origem = 'PROMO_SHARE' AND p.excluido = 'N'
        GROUP BY p.id
        ORDER BY p.id DESC
        LIMIT 50
      `, [tk.id_cliente]);

      res.json(pedidos);
    });
  } catch (err) {
    console.error('[promocoes-share/historico]', err);
    res.status(500).json({ erro: err.message });
  }
});

// GET /api/promocoes-share/:token
router.get('/:token', async (req, res) => {
  try {
    const pool = await findPoolForToken(req.params.token);
    if (!pool) return res.status(404).json({ erro: 'Link inválido ou expirado' });

    const out = await runWithPool(pool, async () => {
      const [[tk]] = await pool.query(
        `SELECT * FROM promocoes_share_tokens
         WHERE token = ? AND ativo = 1 AND (expira_em IS NULL OR expira_em > NOW())`,
        [req.params.token]
      );
      if (!tk) return { status: 404, erro: 'Link inválido ou expirado' };

      const { ctx, nome: nomeCliente } = tk.id_cliente
        ? await ctxFromCliente(pool, tk.id_cliente)
        : { ctx: null, nome: tk.nome_cliente };

      if (tk.id_cliente && !ctx) {
        return { status: 410, erro: 'Cliente deste link não está mais disponível' };
      }

      const mapaPrecos = tk.id_cliente ? await mapaPrecosCliente(pool, tk.id_cliente) : {};

      let campanha = null;
      if (tk.id_campanha) {
        campanha = await getCampanha(pool, tk.id_campanha);
        if (!campanha || !campanha.ativo) {
          return { status: 410, erro: 'Campanha encerrada ou inativa' };
        }
      }

      const produtos = await listarProdutosPromoShare(pool, {
        idCampanha: tk.id_campanha || null,
        ctx,
        mapaPrecos,
      });

      const [[rep]] = await pool.query(
        `SELECT nomeusu AS nome, fone, numero_whatsApp FROM usuarios WHERE idusuario = ? LIMIT 1`,
        [tk.id_usuario]
      ).catch(() => [[null]]);

      const whats = (rep?.numero_whatsApp || rep?.fone || '').replace(/\D/g, '');

      return {
        status: 200,
        body: {
          campanha: campanha ? {
            id: campanha.id,
            descricao: campanha.descricao,
            tipo: campanha.tipo,
            valor: campanha.valor,
            qtd_minima: campanha.qtd_minima,
            data_inicio: campanha.data_inicio,
            data_fim: campanha.data_fim,
          } : {
            descricao: tk.nome_campanha || 'Promoções ativas',
          },
          cliente: tk.id_cliente ? { id: tk.id_cliente, nome: nomeCliente || tk.nome_cliente } : null,
          representante: rep ? { nome: rep.nome, whatsapp: whats || null } : null,
          expira_em: tk.expira_em,
          produtos,
          total: produtos.length,
          preco_referencia: tk.id_cliente ? 'tabela_cliente' : 'cadastro',
          historico_disponivel: !!tk.id_cliente,
        },
      };
    });

    if (!out || out.status !== 200) {
      return res.status(out?.status || 500).json({ erro: out?.erro || 'Erro ao carregar link' });
    }
    res.json(out.body);
  } catch (err) {
    console.error('[promocoes-share/get]', err);
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
