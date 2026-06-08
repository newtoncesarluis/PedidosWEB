'use strict';

const express = require('express');
const { getPool } = require('../config/database');
const {
  listarCampanhas,
  getCampanha,
  gravarCampanha,
  excluirCampanha,
  dashboardResumo,
  FAIXA_CODIGOS,
} = require('../config/feirinha-campanhas');
const { sugerirProdutosFeirinha } = require('../config/feirinha-produtos');
const { listarKitItens, gravarKitItens } = require('../config/feirinha-kit');
const { FAIXAS_FEIRINHA } = require('../config/feirinha-calc');

const router = express.Router();

function podeGerenciar(req) {
  if (req.user?.perfil == 1) return true;
  const p = req.user?.permissoes || {};
  return p.manutencao_promocoes === 'S'
    || p.incluir_promocoes === 'S'
    || p.alterar_promocoes === 'S';
}

router.get('/faixas', (_req, res) => {
  res.json({ faixas: FAIXAS_FEIRINHA.map((f) => ({
    codigo: f.codigo,
    label: f.label,
    precoSugerido: f.precoSugerido,
    max: f.max === Infinity ? null : f.max,
    emoji: f.emoji,
  })) });
});

router.get('/campanhas', async (req, res) => {
  try {
    const pool = getPool();
    const somenteAtivas = req.query.todos !== '1' && req.query.todos !== 'true';
    const result = await listarCampanhas(pool, {
      q: req.query.q,
      cod_fornecedor: req.query.cod_fornecedor || req.query.id_fornecedor,
      ativo: somenteAtivas ? 'S' : 'N',
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json(result);
  } catch (err) {
    console.error('[feirinha/campanhas GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/campanhas/dashboard', async (req, res) => {
  try {
    const pool = getPool();
    const data = await dashboardResumo(pool, {
      cod_fornecedor: req.query.cod_fornecedor || req.query.id_fornecedor,
      dt_inicio: req.query.dt_inicio || null,
      dt_fim: req.query.dt_fim || null,
    });
    res.json(data);
  } catch (err) {
    console.error('[feirinha/dashboard]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/campanhas/:id/kit', async (req, res) => {
  try {
    const pool = getPool();
    const camp = await getCampanha(pool, req.params.id);
    if (!camp) return res.status(404).json({ error: 'Campanha não encontrada' });
    const itens = await listarKitItens(pool, req.params.id);
    res.json({ campanha: camp, itens });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/campanhas/:id/kit', async (req, res) => {
  if (!podeGerenciar(req)) return res.status(403).json({ error: 'Sem permissão' });
  try {
    const pool = getPool();
    const camp = await getCampanha(pool, req.params.id);
    if (!camp) return res.status(404).json({ error: 'Campanha não encontrada' });
    const out = await gravarKitItens(pool, req.params.id, req.body?.itens);
    res.status(out.status).json(out.json);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/campanhas/:id', async (req, res) => {
  try {
    const pool = getPool();
    const camp = await getCampanha(pool, req.params.id);
    if (!camp) return res.status(404).json({ error: 'Campanha não encontrada' });
    res.json(camp);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/campanhas', async (req, res) => {
  if (!podeGerenciar(req)) return res.status(403).json({ error: 'Sem permissão' });
  try {
    const pool = getPool();
    const out = await gravarCampanha(pool, req.body);
    res.status(out.status).json(out.json);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/campanhas/:id', async (req, res) => {
  if (!podeGerenciar(req)) return res.status(403).json({ error: 'Sem permissão' });
  try {
    const pool = getPool();
    const out = await gravarCampanha(pool, req.body, parseInt(req.params.id, 10));
    res.status(out.status).json(out.json);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/campanhas/:id', async (req, res) => {
  if (!podeGerenciar(req)) return res.status(403).json({ error: 'Sem permissão' });
  try {
    const pool = getPool();
    const out = await excluirCampanha(pool, parseInt(req.params.id, 10));
    res.status(out.status).json(out.json);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/sugerir', async (req, res) => {
  try {
    const pool = getPool();
    const body = req.body || {};
    const getProdTabela = async (p) => {
      const [t1] = await p.query("SHOW TABLES LIKE 'produto'").catch(() => [[]]);
      return t1.length ? 'produto' : 'produtos';
    };
    const result = await sugerirProdutosFeirinha(pool, getProdTabela, {
      itens: body.itens,
      id_campanha: body.id_campanha,
      faixa_codigo: body.faixa_codigo,
      preco_medio_meta: body.preco_medio_meta,
      idFornecedor: body.id_fornecedor || body.cod_fornecedor,
      tabelaId: body.id_tabela || body.id_tabela_preco,
    });
    res.json(result);
  } catch (err) {
    console.error('[feirinha/sugerir]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/meta/codigos-faixa', (_req, res) => {
  res.json({ codigos: FAIXA_CODIGOS });
});

module.exports = router;
