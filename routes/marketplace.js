'use strict';

/**
 * Marketplace — fundação neutra de provedor.
 *
 * Cobre o que é comum a qualquer integração (Tray, Bling, ML, Shopee...):
 *   - cadastro dos canais conectados
 *   - de-para anúncio do canal ↔ produto interno
 *   - consulta do log de pedidos recebidos
 *
 * A camada de cada plataforma (OAuth, endpoints, webhook) entra depois,
 * em arquivos próprios, consumindo estas tabelas.
 *
 * Permissão: gtela_marketplace (admin sempre passa).
 */

const express = require('express');
const router  = express.Router();
const { getPool } = require('../config/database');
const { logError } = require('../config/logger');
const { permSn } = require('../config/cadastros-permissoes');
const {
  ensureMarketplaceSchema,
  tabelaProduto
} = require('../config/marketplace-schema');
const { exigeModuloMarketplace } = require('../config/modulo-marketplace');

// Gate de licença ANTES de tudo: se o desenvolvedor não liberou o add-on
// para este cliente, nenhuma rota do módulo responde — nem para o admin.
router.use(exigeModuloMarketplace);

const PLATAFORMAS = ['TRAY', 'BLING', 'MERCADO_LIVRE', 'SHOPEE', 'AMAZON', 'SHEIN', 'TIKTOK', 'OUTRO'];

// Campos que nunca voltam para o frontend
const SEGREDOS = ['client_secret', 'access_token', 'refresh_token'];

function semSegredos(row) {
  const out = { ...row };
  for (const k of SEGREDOS) {
    out['tem_' + k] = out[k] ? 'S' : 'N';
    delete out[k];
  }
  return out;
}

function exigePermissao(req, res) {
  if (permSn(req, 'gtela_marketplace') !== 'S') {
    res.status(403).json({ error: 'Sem permissão para acessar Marketplace' });
    return false;
  }
  return true;
}

// ─── CANAIS ──────────────────────────────────────────────────────────────────

router.get('/canais', async (req, res) => {
  if (!exigePermissao(req, res)) return;
  try {
    const pool = getPool();
    await ensureMarketplaceSchema(pool);
    const [rows] = await pool.query(`
      SELECT c.*,
             (SELECT COUNT(*) FROM marketplace_anuncios a
               WHERE a.id_canal = c.id AND a.ativo = 'S')                    AS total_anuncios,
             (SELECT COUNT(*) FROM marketplace_anuncios a
               WHERE a.id_canal = c.id AND a.ativo = 'S'
                 AND a.cod_produto IS NULL)                                  AS anuncios_sem_vinculo,
             (SELECT COUNT(*) FROM marketplace_pedidos_log l
               WHERE l.id_canal = c.id AND l.status = 'ERRO')                AS pedidos_com_erro
        FROM canal_venda c
       WHERE c.excluido = 'N'
       ORDER BY c.plataforma, c.nome
    `);
    res.json(rows.map(semSegredos));
  } catch (err) {
    logError('marketplace/canais', err);
    res.status(500).json({ error: 'Erro ao listar canais' });
  }
});

router.post('/canais', async (req, res) => {
  if (!exigePermissao(req, res)) return;
  const b = req.body || {};
  if (!b.nome || !String(b.nome).trim()) return res.status(400).json({ error: 'Informe o nome do canal' });
  if (!PLATAFORMAS.includes(String(b.plataforma || '').toUpperCase())) {
    return res.status(400).json({ error: 'Plataforma inválida. Use: ' + PLATAFORMAS.join(', ') });
  }
  try {
    const pool = getPool();
    await ensureMarketplaceSchema(pool);
    const [r] = await pool.query(`
      INSERT INTO canal_venda
        (nome, plataforma, conta_externa, id_empresa, comissao_pct,
         client_id, client_secret, config, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      String(b.nome).trim(),
      String(b.plataforma).toUpperCase(),
      b.conta_externa || null,
      b.id_empresa || null,
      parseFloat(b.comissao_pct) || 0,
      b.client_id || null,
      b.client_secret || null,
      b.config ? (typeof b.config === 'string' ? b.config : JSON.stringify(b.config)) : null,
      b.status === 'I' ? 'I' : 'A'
    ]);
    res.json({ ok: true, id: r.insertId });
  } catch (err) {
    logError('marketplace/canais POST', err);
    res.status(500).json({ error: 'Erro ao salvar canal' });
  }
});

router.put('/canais/:id', async (req, res) => {
  if (!exigePermissao(req, res)) return;
  try {
    const pool = getPool();
    await ensureMarketplaceSchema(pool);
    const b = req.body || {};
    const sets = [];
    const vals = [];
    const push = (col, val) => { sets.push(col + ' = ?'); vals.push(val); };

    if (b.nome !== undefined)          push('nome', String(b.nome).trim());
    if (b.conta_externa !== undefined) push('conta_externa', b.conta_externa || null);
    if (b.id_empresa !== undefined)    push('id_empresa', b.id_empresa || null);
    if (b.comissao_pct !== undefined)  push('comissao_pct', parseFloat(b.comissao_pct) || 0);
    if (b.client_id !== undefined)     push('client_id', b.client_id || null);
    if (b.status !== undefined)        push('status', b.status === 'I' ? 'I' : 'A');
    if (b.config !== undefined) {
      push('config', b.config ? (typeof b.config === 'string' ? b.config : JSON.stringify(b.config)) : null);
    }
    // Secret só é regravado quando vem preenchido — campo em branco preserva o atual
    if (b.client_secret) push('client_secret', b.client_secret);

    if (!sets.length) return res.json({ ok: true, semAlteracao: true });

    vals.push(req.params.id);
    await pool.query('UPDATE canal_venda SET ' + sets.join(', ') + ' WHERE id = ?', vals);
    res.json({ ok: true });
  } catch (err) {
    logError('marketplace/canais PUT', err);
    res.status(500).json({ error: 'Erro ao atualizar canal' });
  }
});

router.delete('/canais/:id', async (req, res) => {
  if (!exigePermissao(req, res)) return;
  try {
    const pool = getPool();
    await ensureMarketplaceSchema(pool);
    await pool.query(`UPDATE canal_venda SET excluido = 'S' WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    logError('marketplace/canais DELETE', err);
    res.status(500).json({ error: 'Erro ao excluir canal' });
  }
});

// ─── DE-PARA DE ANÚNCIOS ─────────────────────────────────────────────────────

router.get('/anuncios', async (req, res) => {
  if (!exigePermissao(req, res)) return;
  try {
    const pool = getPool();
    await ensureMarketplaceSchema(pool);
    const prod = await tabelaProduto(pool);

    const where = [`a.ativo = 'S'`];
    const vals  = [];
    if (req.query.id_canal) { where.push('a.id_canal = ?'); vals.push(req.query.id_canal); }
    if (req.query.vinculo === 'pendente') where.push('a.cod_produto IS NULL');
    if (req.query.vinculo === 'ok')       where.push('a.cod_produto IS NOT NULL');
    if (req.query.q) {
      where.push('(a.codigo_externo LIKE ? OR a.sku_externo LIKE ? OR a.descricao_externa LIKE ? OR p.descricao LIKE ? OR p.cod_fabricante LIKE ?)');
      const q = '%' + req.query.q + '%';
      vals.push(q, q, q, q, q);
    }

    const limit  = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const whereSql = where.join(' AND ');

    const [[tot]] = await pool.query(`
      SELECT COUNT(*) AS n
        FROM marketplace_anuncios a
        JOIN canal_venda c ON c.id = a.id_canal
        LEFT JOIN ${prod} p ON p.ID = a.cod_produto
       WHERE ${whereSql}
    `, vals);

    const [rows] = await pool.query(`
      SELECT a.*, c.nome AS nome_canal, c.plataforma,
             p.descricao AS descricao_produto, p.cod_fabricante
        FROM marketplace_anuncios a
        JOIN canal_venda c ON c.id = a.id_canal
        LEFT JOIN ${prod} p ON p.ID = a.cod_produto
       WHERE ${whereSql}
       ORDER BY (a.cod_produto IS NOT NULL), a.descricao_externa, a.id
       LIMIT ? OFFSET ?
    `, [...vals, limit, offset]);

    res.json({ rows, total: Number(tot?.n) || 0, limit, offset });
  } catch (err) {
    logError('marketplace/anuncios', err);
    res.status(500).json({ error: 'Erro ao listar anúncios' });
  }
});

/** Cria ou atualiza o de-para de um anúncio (upsert pela UNIQUE canal+código). */
router.post('/anuncios', async (req, res) => {
  if (!exigePermissao(req, res)) return;
  const b = req.body || {};
  if (!b.id_canal)       return res.status(400).json({ error: 'Informe o canal' });
  if (!b.codigo_externo) return res.status(400).json({ error: 'Informe o código do anúncio' });
  try {
    const pool = getPool();
    await ensureMarketplaceSchema(pool);
    await pool.query(`
      INSERT INTO marketplace_anuncios
        (id_canal, codigo_externo, sku_externo, descricao_externa, cod_produto, preco_canal, vinculado_por)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        sku_externo       = VALUES(sku_externo),
        descricao_externa = VALUES(descricao_externa),
        cod_produto       = VALUES(cod_produto),
        preco_canal       = VALUES(preco_canal),
        vinculado_por     = VALUES(vinculado_por),
        ativo             = 'S'
    `, [
      b.id_canal,
      String(b.codigo_externo).trim(),
      b.sku_externo || null,
      b.descricao_externa || null,
      b.cod_produto || null,
      b.preco_canal != null ? parseFloat(b.preco_canal) : null,
      b.cod_produto ? 'MANUAL' : null
    ]);
    res.json({ ok: true });
  } catch (err) {
    logError('marketplace/anuncios POST', err);
    res.status(500).json({ error: 'Erro ao salvar vínculo' });
  }
});

/** Vincula / desvincula produto interno em um anúncio já cadastrado. */
router.put('/anuncios/:id', async (req, res) => {
  if (!exigePermissao(req, res)) return;
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const pool = getPool();
    await ensureMarketplaceSchema(pool);
    const b = req.body || {};
    const temProduto = Object.prototype.hasOwnProperty.call(b, 'cod_produto');
    if (!temProduto) return res.status(400).json({ error: 'Informe cod_produto (ou null para desvincular)' });

    let codProduto = b.cod_produto;
    if (codProduto === '' || codProduto === undefined) codProduto = null;
    if (codProduto != null) {
      codProduto = parseInt(codProduto, 10);
      if (!codProduto) return res.status(400).json({ error: 'Produto inválido' });
      const prod = await tabelaProduto(pool);
      const [[existe]] = await pool.query(
        `SELECT ID FROM ${prod} WHERE ID = ? AND (excluido IS NULL OR excluido <> 'S') LIMIT 1`,
        [codProduto]
      );
      if (!existe) return res.status(404).json({ error: 'Produto não encontrado' });
    }

    const [r] = await pool.query(
      `UPDATE marketplace_anuncios
          SET cod_produto = ?, vinculado_por = ?
        WHERE id = ? AND ativo = 'S'`,
      [codProduto, codProduto ? 'MANUAL' : null, id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Anúncio não encontrado' });
    res.json({ ok: true, cod_produto: codProduto });
  } catch (err) {
    logError('marketplace/anuncios PUT', err);
    res.status(500).json({ error: 'Erro ao atualizar vínculo' });
  }
});

/**
 * Vínculo automático: casa o SKU do canal com cod_fabricante, referencia,
 * cod_barras ou o próprio ID do produto. Só toca em anúncios ainda sem vínculo
 * e só vincula quando o match é ÚNICO — ambiguidade fica para decisão manual.
 */
router.post('/anuncios/vincular-automatico', async (req, res) => {
  if (!exigePermissao(req, res)) return;
  try {
    const pool = getPool();
    await ensureMarketplaceSchema(pool);
    const prod = await tabelaProduto(pool);

    const vals = [];
    let filtroCanal = '';
    if (req.body && req.body.id_canal) { filtroCanal = 'AND a.id_canal = ?'; vals.push(req.body.id_canal); }

    const [pendentes] = await pool.query(`
      SELECT a.id, a.sku_externo
        FROM marketplace_anuncios a
       WHERE a.cod_produto IS NULL AND a.ativo = 'S'
         AND a.sku_externo IS NOT NULL AND a.sku_externo <> ''
         ${filtroCanal}
    `, vals);

    let vinculados = 0, ambiguos = 0, semMatch = 0;

    for (const p of pendentes) {
      const sku = String(p.sku_externo).trim();
      const [cand] = await pool.query(`
        SELECT ID FROM ${prod}
         WHERE excluido <> 'S'
           AND (cod_fabricante = ? OR referencia = ? OR cod_barras = ? OR ID = ?)
         LIMIT 2
      `, [sku, sku, sku, /^\d+$/.test(sku) ? Number(sku) : -1]);

      if (cand.length === 1) {
        await pool.query(
          `UPDATE marketplace_anuncios SET cod_produto = ?, vinculado_por = 'AUTO' WHERE id = ?`,
          [cand[0].ID, p.id]
        );
        vinculados++;
      } else if (cand.length > 1) {
        ambiguos++;
      } else {
        semMatch++;
      }
    }

    res.json({ ok: true, analisados: pendentes.length, vinculados, ambiguos, semMatch });
  } catch (err) {
    logError('marketplace/vincular-automatico', err);
    res.status(500).json({ error: 'Erro ao vincular automaticamente' });
  }
});

router.delete('/anuncios/:id', async (req, res) => {
  if (!exigePermissao(req, res)) return;
  try {
    const pool = getPool();
    await ensureMarketplaceSchema(pool);
    await pool.query(`UPDATE marketplace_anuncios SET ativo = 'N' WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    logError('marketplace/anuncios DELETE', err);
    res.status(500).json({ error: 'Erro ao excluir vínculo' });
  }
});

// ─── LOG DE PEDIDOS RECEBIDOS ────────────────────────────────────────────────

router.get('/pedidos-log', async (req, res) => {
  if (!exigePermissao(req, res)) return;
  try {
    const pool = getPool();
    await ensureMarketplaceSchema(pool);

    const where = ['1=1'];
    const vals  = [];
    if (req.query.id_canal) { where.push('l.id_canal = ?'); vals.push(req.query.id_canal); }
    if (req.query.status)   { where.push('l.status = ?');   vals.push(String(req.query.status).toUpperCase()); }

    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);

    // payload fica fora da listagem — é grande e só interessa no detalhe
    const [rows] = await pool.query(`
      SELECT l.id, l.id_canal, l.id_externo, l.numero_externo, l.canal_origem,
             l.valor_total, l.data_pedido, l.status, l.erro, l.tentativas,
             l.id_pedido, l.dt_recebido, l.dt_processado,
             c.nome AS nome_canal, c.plataforma
        FROM marketplace_pedidos_log l
        JOIN canal_venda c ON c.id = l.id_canal
       WHERE ${where.join(' AND ')}
       ORDER BY l.dt_recebido DESC
       LIMIT ?
    `, [...vals, limit]);

    res.json(rows);
  } catch (err) {
    logError('marketplace/pedidos-log', err);
    res.status(500).json({ error: 'Erro ao listar log de pedidos' });
  }
});

router.get('/pedidos-log/:id', async (req, res) => {
  if (!exigePermissao(req, res)) return;
  try {
    const pool = getPool();
    await ensureMarketplaceSchema(pool);
    const [[row]] = await pool.query('SELECT * FROM marketplace_pedidos_log WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Registro não encontrado' });
    res.json(row);
  } catch (err) {
    logError('marketplace/pedidos-log/:id', err);
    res.status(500).json({ error: 'Erro ao carregar registro' });
  }
});

/** Devolve um registro com ERRO para a fila, para nova tentativa. */
router.post('/pedidos-log/:id/reprocessar', async (req, res) => {
  if (!exigePermissao(req, res)) return;
  try {
    const pool = getPool();
    await ensureMarketplaceSchema(pool);
    const [r] = await pool.query(`
      UPDATE marketplace_pedidos_log
         SET status = 'PENDENTE', erro = NULL
       WHERE id = ? AND status = 'ERRO'
    `, [req.params.id]);
    if (!r.affectedRows) return res.status(400).json({ error: 'Só registros com erro podem ser reprocessados' });
    res.json({ ok: true });
  } catch (err) {
    logError('marketplace/reprocessar', err);
    res.status(500).json({ error: 'Erro ao reprocessar' });
  }
});

// ─── RESUMO ──────────────────────────────────────────────────────────────────

router.get('/resumo', async (req, res) => {
  if (!exigePermissao(req, res)) return;
  try {
    const pool = getPool();
    await ensureMarketplaceSchema(pool);
    const [[canais]] = await pool.query(`
      SELECT COUNT(*) AS total, SUM(status = 'A') AS ativos
        FROM canal_venda WHERE excluido = 'N'
    `);
    const [[anuncios]] = await pool.query(`
      SELECT COUNT(*) AS total, SUM(cod_produto IS NULL) AS sem_vinculo
        FROM marketplace_anuncios WHERE ativo = 'S'
    `);
    const [[pedidos]] = await pool.query(`
      SELECT SUM(status = 'PENDENTE')   AS pendentes,
             SUM(status = 'ERRO')       AS com_erro,
             SUM(status = 'PROCESSADO') AS processados
        FROM marketplace_pedidos_log
    `);
    res.json({ canais, anuncios, pedidos });
  } catch (err) {
    logError('marketplace/resumo', err);
    res.status(500).json({ error: 'Erro ao carregar resumo' });
  }
});

module.exports = router;
