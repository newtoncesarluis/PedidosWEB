'use strict';

const express = require('express');
const crypto = require('crypto');
const {
  getPool,
  getPoolForLicense,
  runWithPool,
  customerDbFromLicense,
  _poolMapKeys,
} = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { getCampanha, campanhaEmVigencia } = require('../config/feirinha-campanhas');
const { listarKitItens, prodSelectExtras, detectProdTable } = require('../config/feirinha-kit');
const { agregarItensFeirinha } = require('../config/feirinha-calc');
const { ensureFeirinhaTables } = require('../config/schema-migrations');

const router = express.Router();
const _tableReadyPools = new Set();

async function ensureTable(pool) {
  if (_tableReadyPools.has(pool)) return;
  await ensureFeirinhaTables(pool);
  _tableReadyPools.add(pool);
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
        'SELECT id FROM feirinha_share_tokens WHERE token = ? LIMIT 1',
        [token]
      );
      if (row) return p;
    } catch { /* ignora */ }
  }
  return null;
}

async function carregarTokenAtivo(pool, token) {
  const [[tk]] = await pool.query(
    `SELECT * FROM feirinha_share_tokens
     WHERE token = ? AND ativo = 1 AND (expira_em IS NULL OR expira_em > NOW())`,
    [token]
  );
  return tk || null;
}

async function resolverTabelaCliente(pool, idCliente) {
  try {
    const [vinc] = await pool.query(`
      SELECT v.id_tabela FROM tabela_preco_vinculo v
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

async function mapaPrecosCliente(pool, idCliente) {
  const [precos] = await pool.query(`
    SELECT tpi.cod_produto, COALESCE(tpi.valor_tabela, tpi.preco_venda) AS preco
    FROM tabela_preco_vinculo tpv
    JOIN tabela_preco_itens tpi ON tpi.id_tabela = tpv.id_tabela
    WHERE tpv.id_entidade = ? AND tpv.tipo_entidade = 'CLIENTE'
      AND tpv.excluido = 'N' AND tpi.excluido = 'N' AND tpi.ativo = 'S'
  `, [idCliente]).catch(() => [[]]);
  const map = {};
  (precos || []).forEach((p) => { map[String(p.cod_produto)] = parseFloat(p.preco) || 0; });
  return map;
}

function normalizarFotoUrl(foto) {
  if (!foto) return null;
  const s = String(foto).trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s) || s.startsWith('data:')) return s;
  return s.startsWith('/') ? s : `/${s}`;
}

async function enriquecerKitComPrecos(pool, kit, opts = {}) {
  const tb = await detectProdTable(pool);
  const { fotoExpr, multiploExpr } = await prodSelectExtras(pool, tb);
  const tabelaId = opts.tabelaId || null;
  const mapa = opts.mapaPrecos || {};
  const ids = kit.map((k) => k.cod_produto).filter(Boolean);
  if (!ids.length) return [];

  let join = '';
  let vlrExpr = 'p.vlr_venda';
  const queryParams = [];
  if (tabelaId) {
    join = ` LEFT JOIN tabela_preco_itens tpi ON CAST(tpi.cod_produto AS UNSIGNED) = p.ID
      AND tpi.id_tabela = ? AND (tpi.excluido = 'N' OR tpi.excluido IS NULL)
      AND tpi.ativo = 'S' `;
    queryParams.push(tabelaId);
    vlrExpr = 'COALESCE(tpi.valor_tabela, tpi.preco_venda, p.vlr_venda)';
  }
  queryParams.push(ids);

  const [rows] = await pool.query(
    `SELECT p.ID AS cod_produto, p.descricao, p.cod_fabricante, p.unidade,
            ${vlrExpr} AS preco_unitario, ${fotoExpr},
            ${multiploExpr} AS multiplo_venda
     FROM ${tb} p ${join}
     WHERE p.ID IN (?)
       AND (p.excluido = 'N' OR p.excluido IS NULL OR p.excluido = '')
       AND p.situacao = 'A'`,
    queryParams
  );

  const mapProd = new Map(rows.map((r) => [parseInt(r.cod_produto, 10), r]));
  return kit
    .map((k) => {
      const p = mapProd.get(k.cod_produto);
      if (!p) return null;
      let preco = parseFloat(p.preco_unitario) || 0;
      if (mapa[String(k.cod_produto)] > 0) preco = mapa[String(k.cod_produto)];
      const qtd = parseFloat(k.quantidade) || 1;
      return {
        id: k.cod_produto,
        cod_produto: k.cod_produto,
        descricao: p.descricao || k.desc_produto,
        cod_fabricante: p.cod_fabricante || k.cod_fabricante,
        unidade: p.unidade || k.unidade,
        quantidade_sugerida: qtd,
        multiplo_venda: parseFloat(p.multiplo_venda) || k.multiplo_venda || 1,
        preco_unitario: preco,
        total_linha: Math.round(preco * qtd * 100) / 100,
        foto: normalizarFotoUrl(p.foto_principal || k.foto),
      };
    })
    .filter(Boolean);
}

function podeGerenciar(req) {
  if (req.user?.perfil == 1) return true;
  const p = req.user?.permissoes || {};
  return p.manutencao_promocoes === 'S'
    || p.incluir_promocoes === 'S'
    || p.alterar_promocoes === 'S';
}

// POST /api/feirinha-share/gerar
router.post('/gerar', authMiddleware, async (req, res) => {
  if (!podeGerenciar(req)) return res.status(403).json({ erro: 'Sem permissão' });
  const idCampanha = parseInt(req.body?.id_campanha, 10);
  const idCliente = parseInt(req.body?.id_cliente, 10) || null;
  const diasValidade = Math.min(365, Math.max(1, parseInt(req.body?.dias_validade, 10) || 30));

  if (!idCampanha) return res.status(400).json({ erro: 'Informe id_campanha' });

  try {
    const pool = getPool();
    await ensureTable(pool);
    const camp = await getCampanha(pool, idCampanha);
    if (!camp) return res.status(404).json({ erro: 'Campanha não encontrada' });
    if (!camp.ativo) return res.status(400).json({ erro: 'Campanha inativa — reative antes de compartilhar.' });
    if (!campanhaEmVigencia(camp)) return res.status(400).json({ erro: 'Campanha fora do período de vigência.' });

    let nomeCliente = null;
    if (idCliente) {
      const [[cli]] = await pool.query(
        `SELECT nome FROM clientes WHERE id = ? AND excluido = 'N' LIMIT 1`,
        [idCliente]
      );
      if (!cli) return res.status(404).json({ erro: 'Cliente não encontrado' });
      nomeCliente = cli.nome;
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expira = new Date();
    expira.setDate(expira.getDate() + diasValidade);
    const userId = req.user.id || req.user.idusuario;
    const nomeUser = req.user.nome || req.user.nomeusu || '';

    await pool.query(
      `UPDATE feirinha_share_tokens SET ativo = 0
       WHERE id_usuario = ? AND id_campanha = ? AND COALESCE(id_cliente, 0) = COALESCE(?, 0)`,
      [userId, idCampanha, idCliente]
    );

    await pool.query(
      `INSERT INTO feirinha_share_tokens
        (token, id_campanha, id_cliente, id_usuario, nome_usuario, nome_campanha, nome_cliente, expira_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [token, idCampanha, idCliente, userId, nomeUser, camp.descricao, nomeCliente, expira]
    );

    const kit = await listarKitItens(pool, idCampanha);
    res.json({
      token,
      expira,
      link: `/feirinha/${token}`,
      nome_campanha: camp.descricao,
      nome_cliente: nomeCliente,
      qtd_produtos: kit.length,
    });
  } catch (err) {
    console.error('[feirinha-share/gerar]', err);
    res.status(500).json({ erro: err.message });
  }
});

// GET /api/feirinha-share/:token/historico/:pedidoId/itens  (público — link com cliente)
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
         WHERE id = ? AND cod_cliente = ? AND origem = 'FEIRINHA_SHARE' AND excluido = 'N' LIMIT 1`,
        [req.params.pedidoId, tk.id_cliente]
      );
      if (!ped) return res.status(403).json({ erro: 'Orçamento não encontrado' });

      const [itens] = await pool.query(
        `SELECT desc_prod, quantidade, valor_unitario, vlrtotal_itens, unidade
         FROM itensped
         WHERE id_pedido = ? AND excluido = 'N'
         ORDER BY sequencia`,
        [req.params.pedidoId]
      );

      res.json(itens);
    });
  } catch (err) {
    console.error('[feirinha-share/historico/itens]', err);
    res.status(500).json({ erro: err.message });
  }
});

// GET /api/feirinha-share/:token/historico  (público — link com cliente)
router.get('/:token/historico', async (req, res) => {
  try {
    const pool = await findPoolForToken(req.params.token);
    if (!pool) return res.status(404).json({ erro: 'Link inválido ou expirado' });

    await runWithPool(pool, async () => {
      const tk = await carregarTokenAtivo(pool, req.params.token);
      if (!tk) return res.status(404).json({ erro: 'Link inválido ou expirado' });
      if (!tk.id_cliente) return res.status(403).json({ erro: 'Histórico disponível apenas em links por cliente' });

      const [pedidos] = await pool.query(
        `SELECT p.id, p.numero, p.data_abertura, p.situacao_pedido, p.status,
                p.vlrtotalpedido, p.nome_fornecedor, p.dtcadastro, p.obs,
                p.preco_medio_feirinha, p.preco_revenda_feirinha,
                MAX(cf.descricao) AS campanha_nome,
                COUNT(i.id) AS qtd_itens
         FROM pedidos p
         LEFT JOIN itensped i ON i.id_pedido = p.id AND i.excluido = 'N'
         LEFT JOIN campanhas_feirinha cf ON cf.id = p.id_campanha_feirinha AND cf.excluido = 'N'
         WHERE p.cod_cliente = ? AND p.origem = 'FEIRINHA_SHARE' AND p.excluido = 'N'
         GROUP BY p.id
         ORDER BY p.id DESC
         LIMIT 50`,
        [tk.id_cliente]
      );

      res.json(pedidos);
    });
  } catch (err) {
    console.error('[feirinha-share/historico]', err);
    res.status(500).json({ erro: err.message });
  }
});

// GET /api/feirinha-share/:token
router.get('/:token', async (req, res) => {
  try {
    const pool = await findPoolForToken(req.params.token);
    if (!pool) return res.status(404).json({ erro: 'Link inválido ou expirado' });

    const out = await runWithPool(pool, async () => {
      const tk = await carregarTokenAtivo(pool, req.params.token);
      if (!tk) return { status: 404, erro: 'Link inválido ou expirado' };

      const camp = await getCampanha(pool, tk.id_campanha);
      if (!camp || !camp.ativo) return { status: 410, erro: 'Campanha encerrada ou inativa' };
      if (!campanhaEmVigencia(camp)) return { status: 410, erro: 'Campanha fora do período de vigência' };

      let tabelaId = null;
      let mapaPrecos = {};
      let nomeCliente = tk.nome_cliente;
      if (tk.id_cliente) {
        const [[cli]] = await pool.query(
          `SELECT id, nome FROM clientes WHERE id = ? AND excluido = 'N' LIMIT 1`,
          [tk.id_cliente]
        );
        if (!cli) return { status: 410, erro: 'Cliente deste link não está mais disponível' };
        nomeCliente = cli.nome;
        tabelaId = await resolverTabelaCliente(pool, tk.id_cliente);
        mapaPrecos = await mapaPrecosCliente(pool, tk.id_cliente);
      }

      const kitRaw = await listarKitItens(pool, tk.id_campanha);
      const produtos = await enriquecerKitComPrecos(pool, kitRaw, { tabelaId, mapaPrecos });

      const itensResumo = produtos.map((p) => ({
        quantidade: p.quantidade_sugerida,
        valor_unitario: p.preco_unitario,
        vlrtotal_itens: p.total_linha,
      }));
      const agg = agregarItensFeirinha(itensResumo);

      const [[rep]] = await pool.query(
        `SELECT nomeusu AS nome, fone, numero_whatsApp FROM usuarios WHERE idusuario = ? LIMIT 1`,
        [tk.id_usuario]
      ).catch(() => [[null]]);
      const whats = (rep?.numero_whatsApp || rep?.fone || '').replace(/\D/g, '');

      return {
        status: 200,
        body: {
          campanha: {
            id: camp.id,
            descricao: camp.descricao,
            tema_banner: camp.tema_banner,
            faixa_label: camp.faixa_label,
            faixa_emoji: camp.faixa_emoji,
            preco_medio_meta: camp.preco_medio_meta,
            preco_revenda_alvo: camp.preco_revenda_alvo,
            data_inicio: camp.data_inicio,
            data_fim: camp.data_fim,
            nome_fornecedor: camp.nome_fornecedor,
          },
          cliente: tk.id_cliente ? { id: tk.id_cliente, nome: nomeCliente } : null,
          representante: rep ? { nome: rep.nome, whatsapp: whats || null } : null,
          expira_em: tk.expira_em,
          produtos,
          resumo_kit: {
            qtd_total: agg.qtdTotal,
            valor_total: agg.valorTotal,
            preco_medio: agg.precoMedio,
          },
          preco_referencia: tk.id_cliente ? 'tabela_cliente' : 'cadastro',
          historico_disponivel: !!tk.id_cliente,
          total: produtos.length,
        },
      };
    });

    if (!out || out.status !== 200) {
      return res.status(out?.status || 500).json({ erro: out?.erro || 'Erro ao carregar link' });
    }
    res.json(out.body);
  } catch (err) {
    console.error('[feirinha-share/get]', err);
    res.status(500).json({ erro: err.message });
  }
});

// POST /api/feirinha-share/:token/orcamento
router.post('/:token/orcamento', async (req, res) => {
  const itensReq = Array.isArray(req.body?.itens) ? req.body.itens : [];
  if (!itensReq.length) return res.status(400).json({ erro: 'Selecione ao menos um produto' });

  try {
    const pool = await findPoolForToken(req.params.token);
    if (!pool) return res.status(404).json({ erro: 'Link inválido ou expirado' });

    const out = await runWithPool(pool, async () => {
      const tk = await carregarTokenAtivo(pool, req.params.token);
      if (!tk) return { status: 404, erro: 'Link inválido ou expirado' };

      const camp = await getCampanha(pool, tk.id_campanha);
      if (!camp || !camp.ativo) return { status: 410, erro: 'Campanha encerrada ou inativa' };
      if (!campanhaEmVigencia(camp)) return { status: 410, erro: 'Campanha fora do período de vigência' };

      let tabelaId = null;
      let mapaPrecos = {};
      if (tk.id_cliente) {
        tabelaId = await resolverTabelaCliente(pool, tk.id_cliente);
        mapaPrecos = await mapaPrecosCliente(pool, tk.id_cliente);
      }
      const kitRaw = await listarKitItens(pool, tk.id_campanha);
      const produtos = await enriquecerKitComPrecos(pool, kitRaw, { tabelaId, mapaPrecos });
      const mapa = new Map(produtos.map((p) => [String(p.cod_produto), p]));

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
        nomeCliente = cli.nome || '';
        cnpjCliente = cli.cpf || '';
      } else {
        nomeCliente = String(contato.nome || '').trim();
        const tel = String(contato.telefone || '').trim();
        if (!nomeCliente || tel.length < 8) {
          return { status: 400, erro: 'Informe seu nome e telefone para solicitar orçamento' };
        }
      }

      const itensValidados = [];
      for (const raw of itensReq) {
        const id = parseInt(raw.id || raw.cod_produto, 10);
        const qtd = parseFloat(raw.quantidade);
        if (!id || !Number.isFinite(qtd) || qtd <= 0) continue;
        const p = mapa.get(String(id));
        if (!p) return { status: 422, erro: `Produto #${id} não faz parte desta campanha Feirinha` };
        itensValidados.push({
          cod_produto: id,
          desc_produto: p.descricao,
          quantidade: qtd,
          valor_unitario: p.preco_unitario,
          vlrtotal_itens: Math.round(p.preco_unitario * qtd * 100) / 100,
        });
      }
      if (!itensValidados.length) return { status: 400, erro: 'Nenhum item válido' };

      const agg = agregarItensFeirinha(itensValidados);
      const [[tp]] = await pool.query(
        `SELECT id, descricao FROM tipo_pedidos WHERE padrao_vitrine = 'S' AND excluido = 'N' LIMIT 1`
      ).catch(() => [[null]]);
      if (!tk.id_cliente) {
        req.body._obsContato = `[Feirinha web] Tel: ${contato.telefone || ''}${contato.cidade ? ` · ${contato.cidade}` : ''}`;
      }
      const agora = new Date();
      const dataAb = agora.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }).split('/').reverse().join('-');
      const horaAb = agora.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false });
      const obsUser = String(req.body?.obs || '').trim();
      const obsParts = [`Campanha Feirinha: ${camp.descricao}`, req.body._obsContato, obsUser].filter(Boolean);
      const obsFinal = obsParts.join('\n');
      const subtotal = parseFloat(itensValidados.reduce((s, i) => s + i.vlrtotal_itens, 0).toFixed(2));

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const [[seq]] = await conn.query(
          `SELECT LPAD((COALESCE(MAX(numero + 0), 0) + 1), 6, '0') AS proximo FROM pedidos`
        );
        const numero = seq.proximo;

        const [pRes] = await conn.query(
          `INSERT INTO pedidos (
            numero, data_abertura, hora_abertura,
            id_usuario, nome_vendedor,
            cod_cliente, cnpj, nome_cliente,
            cod_fornecedor, nome_fornecedor,
            id_tipopedido, tipo_pedido, situacao_pedido, status,
            vlrsubtotal, vlrtotalitens, vlrtotalpedido,
            vlrdesconto, vlrtotalimposto, vlrtotalbruto,
            total_qt, obs, origem, excluido, dtcadastro,
            id_campanha_feirinha, preco_medio_feirinha, preco_revenda_feirinha
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),?,?,?)`,
          [
            numero, dataAb, horaAb,
            tk.id_usuario, tk.nome_usuario || '',
            codCliente, cnpjCliente, (nomeCliente || '').toUpperCase(),
            camp.cod_fornecedor, (camp.nome_fornecedor || '').toUpperCase(),
            tp?.id || null, tp?.descricao || 'ORÇAMENTO', 'PENDENTE', 'PENDENTE',
            subtotal, subtotal, subtotal, 0, 0, subtotal,
            agg.qtdTotal, obsFinal, 'FEIRINHA_SHARE', 'N',
            camp.id, agg.precoMedio, camp.preco_revenda_alvo,
          ]
        );
        const pedidoId = pRes.insertId;

        for (let i = 0; i < itensValidados.length; i++) {
          const it = itensValidados[i];
          await conn.query(
            `INSERT INTO itensped (
              numpedido, id_pedido, cod_produto, desc_prod, unidade,
              quantidade, vlr_padrao, valor_unitario, vlrtotal_itens,
              desconto, comissao, st, vlr_st, ipi, vlr_ipi, icms, vlr_icms,
              tipo_pedido, sequencia, cod_fornecedor,
              data_inclusao, sincronizar, excluido
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURDATE(),'N','N')`,
            [
              numero, pedidoId, it.cod_produto, it.desc_produto || '', 'UN',
              it.quantidade, it.valor_unitario, it.valor_unitario, it.vlrtotal_itens,
              0, 0, 0, 0, 0, 0, 0, 0,
              tp?.descricao || 'ORÇAMENTO', i + 1, camp.cod_fornecedor,
            ]
          );
        }
        await conn.commit();

        return {
          status: 201,
          body: {
            ok: true,
            id: pedidoId,
            numero,
            preco_medio: agg.precoMedio,
            total: subtotal,
          },
        };
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    });

    if (!out || (out.status !== 201 && out.status !== 200)) {
      return res.status(out?.status || 500).json({ erro: out?.erro || 'Erro ao gravar orçamento' });
    }
    res.status(out.status).json(out.body);
  } catch (err) {
    console.error('[feirinha-share/orcamento]', err);
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
