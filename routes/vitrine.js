'use strict';
const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const path    = require('path');
const fs      = require('fs');
const axios   = require('axios');
const {
  getPool,
  getPoolForLicense,
  runWithPool,
  customerDbFromLicense,
  _poolMapKeys,
} = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { hojeIsoBrasil, horaBrasil, addDaysIsoBrasil } = require('../config/date-brasil');
const { emitNovoPedido } = require('../config/pedido-events');
const { acquireNumeroPedidoLock, releaseNumeroPedidoLock } = require('../config/pedido-numero-lock');
const { ensureVitrineColumns } = require('../config/schema-migrations');

const _fmtBRL = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** IDs de tabela escolhidos pelo representante para ESTE link (vazio = todas as liberadas) */
function _selIdsFromToken(tk) {
  if (!tk || !tk.ids_tabelas) return [];
  return String(tk.ids_tabelas).split(',').map((s) => parseInt(s, 10)).filter(Number.isFinite);
}

// Tamanho máximo da coluna pedidos.obs por pool (TEXT/legado VARCHAR) — evita overflow ao anexar info da tabela
const _obsLenMap = new Map();
async function getPedidoObsMaxLen(pool) {
  if (_obsLenMap.has(pool)) return _obsLenMap.get(pool);
  let len = 65535; // default seguro (TEXT)
  try {
    const [[r]] = await pool.query(
      `SELECT CHARACTER_MAXIMUM_LENGTH AS len, DATA_TYPE AS dt
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pedidos' AND COLUMN_NAME = 'obs'`
    );
    if (r) {
      const dt = String(r.dt || '').toLowerCase();
      if (dt.includes('text') || dt.includes('blob')) len = (r.len && r.len > 0) ? Number(r.len) : 65535;
      else if (r.len && r.len > 0) len = Number(r.len);
    }
  } catch (_) { /* mantém default */ }
  _obsLenMap.set(pool, len);
  return len;
}

/**
 * Tabelas liberadas na vitrine: cabeçalho com vitrine='S' e ativa.
 * Não exige vínculo em tabela_preco_vinculo — a flag «Liberar na vitrine» basta.
 * O representante pode restringir o link (vitrine_tokens.ids_tabelas).
 */
async function getTabelasVitrineCliente(pool, _idCliente) {
  await ensureVitrineColumns(pool).catch(() => {});
  const [rows] = await pool.query(`
    SELECT tpc.id AS id_tabela, tpc.Descricao AS descricao,
           tpc.Cond_Pagamento AS cond_pagamento,
           tpc.usar_regras_fornecedor AS usar_regras_fornecedor
    FROM tabela_preco_cabecalho tpc
    WHERE tpc.excluido = 'N'
      AND (tpc.Tabela_Ativa = 'S' OR tpc.Tabela_Ativa IS NULL)
      AND tpc.vitrine = 'S'
    ORDER BY tpc.Descricao
  `).catch(() => [[]]);
  return rows || [];
}

// Rastreia por pool para não repetir CREATE TABLE nem SHOW TABLES
const _tableReadyPools = new Set();
const _prodTableMap    = new Map();

async function ensureTable(pool) {
  if (_tableReadyPools.has(pool)) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vitrine_tokens (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      token        VARCHAR(64)  NOT NULL UNIQUE,
      id_cliente   INT          NOT NULL,
      id_usuario   INT          NOT NULL,
      nome_cliente VARCHAR(255),
      nome_usuario VARCHAR(255),
      criado_em    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      expira_em    TIMESTAMP    NULL,
      ativo        TINYINT(1)   DEFAULT 1,
      INDEX idx_token   (token),
      INDEX idx_cliente (id_cliente)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `).catch(() => {});
  // Migrações incrementais — ignora erro se coluna já existir
  for (const sql of [
    `ALTER TABLE vitrine_tokens ADD COLUMN id_empresa  INT          NULL`,
    `ALTER TABLE vitrine_tokens ADD COLUMN nome_empresa VARCHAR(255) NULL`,
    `ALTER TABLE vitrine_tokens ADD COLUMN ids_tabelas VARCHAR(255) NULL`,
    `ALTER TABLE vitrine_tokens MODIFY COLUMN id_cliente INT NULL`,
    `ALTER TABLE tipo_pedidos   ADD COLUMN padrao_vitrine CHAR(1) NOT NULL DEFAULT 'N'`,
  ]) { await pool.query(sql).catch(() => {}); }
  await ensureVitrineColumns(pool).catch(() => {});
  _tableReadyPools.add(pool);
}

async function detectProdTable(pool) {
  if (_prodTableMap.has(pool)) return _prodTableMap.get(pool);
  const [rows] = await pool.query(`SHOW TABLES LIKE 'produto'`);
  const name = rows.length ? 'produto' : 'produtos';
  _prodTableMap.set(pool, name);
  return name;
}

const _prodFornColMap = new Map();
async function detectProdFornCol(pool, prodTb) {
  if (_prodFornColMap.has(pool)) return _prodFornColMap.get(pool);
  const [cols] = await pool.query(`DESCRIBE ${prodTb}`).catch(() => [[]]);
  const has = cols.some(c => c.Field.toLowerCase() === 'cod_fornecedorpadrao');
  _prodFornColMap.set(pool, has);
  return has;
}

// ── Notifica o representante via WhatsApp (best-effort, não bloqueia) ─────────
async function _notificarRepresentante(pool, tk, pedidosCriados) {
  const [[rep]] = await pool.query(
    `SELECT instancia, chave, numero_whatsApp FROM usuarios WHERE idusuario = ? LIMIT 1`,
    [tk.id_usuario]
  ).catch(() => [[null]]);
  if (!rep?.instancia || !rep?.numero_whatsApp) return;

  const [[cfg]] = await pool.query(
    `SELECT w_urlplataforma AS url, w_apiglobal AS apikey FROM configuracao WHERE excluido='N' ORDER BY id DESC LIMIT 1`
  ).catch(() => [[null]]);
  if (!cfg?.url || !cfg?.apikey) return;

  const numero = rep.numero_whatsApp.replace(/\D/g, '');
  if (!numero) return;

  const fmtBRL = v => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const totalGeral = pedidosCriados.reduce((s, p) => s + (p.total || 0), 0);
  const linhas = pedidosCriados.map(p =>
    `📋 Pedido *${p.numero}*${p.fornecedor ? ` — ${p.fornecedor}` : ''} — ${fmtBRL(p.total || 0)}`
  ).join('\n');

  const nomeCli = tk.id_cliente
    ? (tk.nome_cliente || 'Cliente')
    : (pedidosCriados.find((p) => p.nome_cliente)?.nome_cliente || 'Visitante');
  const msg = `🛍️ *Novo pedido pela Vitrine Digital!*\n\nCliente: *${nomeCli}*\n\n${linhas}\n\n💰 Total: *${fmtBRL(totalGeral)}*\n\nAcesse o sistema para confirmar.`;

  const baseUrl = cfg.url.replace(/\/$/, '');
  const instKey = rep.chave || cfg.apikey;
  await axios.post(
    `${baseUrl}/message/sendText/${rep.instancia}`,
    { number: numero, text: msg },
    { headers: { 'Content-Type': 'application/json', apikey: instKey }, timeout: 10000 }
  );
}

// Em modo multi-tenant, percorre todos os pools conhecidos e retorna
// o que contém o token — evita depender de qual banco está no binding.
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
        'SELECT id FROM vitrine_tokens WHERE token = ? LIMIT 1', [token]
      );
      if (row) return p;
    } catch { /* tabela ainda não existe neste banco — ignora */ }
  }
  return null;
}

// ── POST /api/vitrine/gerar  (requer autenticação) ───────────────────────────
// id_cliente → link por cliente | link_aberto: true (sem id_cliente) → catálogo aberto
router.post('/gerar', authMiddleware, async (req, res) => {
  const user = req.user;
  const { id_cliente, dias_validade = 60, link_aberto } = req.body;
  const idCliente = id_cliente != null && id_cliente !== '' ? parseInt(id_cliente, 10) : null;
  const aberto = !idCliente && (link_aberto === true || link_aberto === 'S' || link_aberto === 1);

  if (!idCliente && !aberto) {
    return res.status(400).json({ erro: 'Informe id_cliente ou use link_aberto para catálogo sem cliente' });
  }

  try {
    const pool = getPool(); // ALS injetado pelo authMiddleware
    await ensureTable(pool);

    let nomeCliente = null;
    if (idCliente) {
      const [[cliente]] = await pool.query(
        `SELECT id, nome, cpf FROM clientes WHERE id = ? AND excluido = 'N' LIMIT 1`,
        [idCliente]
      );
      if (!cliente) return res.status(404).json({ erro: 'Cliente não encontrado' });
      nomeCliente = cliente.nome;
    } else {
      const tabelas = await getTabelasVitrineCliente(pool, null);
      if (!tabelas.length) {
        return res.status(422).json({
          erro: 'Nenhuma tabela liberada na vitrine. Ative «Liberar na vitrine» em pelo menos uma tabela de preços.',
        });
      }
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiraDate = addDaysIsoBrasil(parseInt(dias_validade, 10) || 60);
    const expiraSql = `${expiraDate} 23:59:59`;

    const userId   = user.id || user.idusuario;
    const nomeUser = user.nome || user.nomeusu || '';
    const idEmpresa = user.id_empresa || null;

    let nomeEmpresa = '';
    if (idEmpresa) {
      const [[emp]] = await pool.query(
        `SELECT Razao_empresa FROM empresa WHERE id_empresa = ? LIMIT 1`, [idEmpresa]
      ).catch(() => [[null]]);
      nomeEmpresa = emp?.Razao_empresa || '';
    }

    if (idCliente) {
      await pool.query(
        `UPDATE vitrine_tokens SET ativo = 0 WHERE id_cliente = ? AND id_usuario = ?`,
        [idCliente, userId]
      );
    } else {
      await pool.query(
        `UPDATE vitrine_tokens SET ativo = 0 WHERE id_cliente IS NULL AND id_usuario = ?`,
        [userId]
      );
    }
    await pool.query(
      `INSERT INTO vitrine_tokens (token, id_cliente, id_usuario, nome_cliente, nome_usuario, expira_em, id_empresa, nome_empresa)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [token, idCliente, userId, nomeCliente, nomeUser, expiraSql, idEmpresa, nomeEmpresa]
    );

    res.json({ token, expira: expiraDate, link: `/vitrine/${token}`, link_aberto: aberto });
  } catch (err) {
    console.error('[vitrine/gerar]', err);
    res.status(500).json({ erro: err.message });
  }
});

// ── GET /api/vitrine/tabelas  (auth) ─────────────────────────────────────────
// Tabelas liberadas na vitrine — link aberto (sem cliente)
router.get('/tabelas', authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    await ensureTable(pool);
    const tabelas = await getTabelasVitrineCliente(pool, null);
    res.json(tabelas.map((t) => ({ id_tabela: t.id_tabela, descricao: t.descricao })));
  } catch (err) {
    console.error('[vitrine/tabelas]', err);
    res.status(500).json({ erro: err.message });
  }
});

// ── GET /api/vitrine/tabelas-cliente/:id_cliente  (auth) ─────────────────────
// Tabelas liberadas na vitrine (vitrine='S') — alimenta o seletor no modal do link
router.get('/tabelas-cliente/:id_cliente', authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    await ensureTable(pool);
    const tabelas = await getTabelasVitrineCliente(pool, req.params.id_cliente);
    res.json(tabelas.map((t) => ({ id_tabela: t.id_tabela, descricao: t.descricao })));
  } catch (err) {
    console.error('[vitrine/tabelas-cliente]', err);
    res.status(500).json({ erro: err.message });
  }
});

// ── PATCH /api/vitrine/:token/tabelas  (auth) ────────────────────────────────
// Atualiza quais tabelas vão neste link (só o dono do link pode alterar).
// Lista vazia → NULL → vitrine usa todas as liberadas (comportamento padrão).
router.patch('/:token/tabelas', authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    await ensureTable(pool);
    const ids = Array.isArray(req.body.ids_tabelas)
      ? req.body.ids_tabelas.map((n) => parseInt(n, 10)).filter(Number.isFinite)
      : [];
    const val = ids.length ? ids.join(',') : null;
    const userId = req.user.id || req.user.idusuario;
    const [r] = await pool.query(
      `UPDATE vitrine_tokens SET ids_tabelas = ? WHERE token = ? AND id_usuario = ?`,
      [val, req.params.token, userId]
    );
    res.json({ ok: true, atualizado: r.affectedRows > 0 });
  } catch (err) {
    console.error('[vitrine/patch-tabelas]', err);
    res.status(500).json({ erro: err.message });
  }
});

// ── GET /api/vitrine/:token  (público) ───────────────────────────────────────
router.get('/:token', async (req, res) => {
  try {
    const pool = await findPoolForToken(req.params.token);
    if (!pool) return res.status(404).json({ erro: 'Link inválido ou expirado' });

    await runWithPool(pool, async () => {
      const [[tk]] = await pool.query(
        `SELECT * FROM vitrine_tokens
         WHERE token = ? AND ativo = 1 AND (expira_em IS NULL OR expira_em > NOW())`,
        [req.params.token]
      );
      if (!tk) return res.status(404).json({ erro: 'Link inválido ou expirado' });

      let cliente = null;
      if (tk.id_cliente) {
        const [[cli]] = await pool.query(
          `SELECT id, nome, cpf, email, telefone FROM clientes WHERE id = ? LIMIT 1`,
          [tk.id_cliente]
        );
        if (!cli) return res.status(404).json({ erro: 'Cliente não encontrado' });
        cliente = cli;
      }

      const [[rep]] = await pool.query(
        `SELECT nomeusu AS nome, email, fone FROM usuarios WHERE idusuario = ? LIMIT 1`,
        [tk.id_usuario]
      ).catch(() => [[null]]);

      // Tabelas com vitrine='S' — cliente escolhe uma no seletor (se houver 2+)
      let tabelas = await getTabelasVitrineCliente(pool, tk.id_cliente);
      // Se o representante restringiu este link a tabelas especificas, respeita a selecao
      const _sel = _selIdsFromToken(tk);
      if (_sel.length) tabelas = tabelas.filter((t) => _sel.includes(Number(t.id_tabela)));

      // Preços de cada produto em cada tabela liberada: { cod_produto: { id_tabela: preco } }
      const precosPorProduto = {};
      if (tabelas.length) {
        const ids = tabelas.map(t => t.id_tabela);
        const [precos] = await pool.query(`
          SELECT id_tabela, cod_produto,
                 COALESCE(valor_tabela, preco_venda) AS preco
          FROM tabela_preco_itens
          WHERE id_tabela IN (?) AND excluido = 'N' AND (ativo = 'S' OR ativo IS NULL)
            AND COALESCE(valor_tabela, preco_venda) > 0
        `, [ids]);
        precos.forEach(p => {
          const k = String(p.cod_produto);
          if (!precosPorProduto[k]) precosPorProduto[k] = {};
          precosPorProduto[k][String(p.id_tabela)] = parseFloat(p.preco);
        });
      }

      const prodTb  = await detectProdTable(pool);
      const hasForn = await detectProdFornCol(pool, prodTb);
      const fornSel  = hasForn ? `, p.cod_fornecedorpadrao AS cod_fornecedor, COALESCE(f.nome,'') AS nome_fornecedor` : `, NULL AS cod_fornecedor, '' AS nome_fornecedor`;
      const fornJoin = hasForn ? `LEFT JOIN fornecedores f ON f.id = p.cod_fornecedorpadrao` : '';
      const [produtos] = await pool.query(`
        SELECT p.ID AS id, p.descricao, p.apelido, p.cod_barras,
               p.cod_fabricante, p.unidade, p.foto_principal, p.nome_grupo,
               COALESCE(p.multiplo_venda, 1) AS multiplo_venda
               ${fornSel}
        FROM ${prodTb} p ${fornJoin}
        WHERE p.excluido = 'N' AND p.situacao = 'A'
        ORDER BY p.nome_grupo, p.descricao
      `);

      const lista = produtos
        .map(p => ({ ...p, precos: precosPorProduto[String(p.id)] || {} }))
        .filter(p => Object.keys(p.precos).length > 0);

      res.json({
        cliente,
        link_aberto: !tk.id_cliente,
        historico_disponivel: !!tk.id_cliente,
        representante: rep || null,
        tabelas: tabelas.map(t => ({ id_tabela: t.id_tabela, descricao: t.descricao })),
        produtos: lista,
      });
    });
  } catch (err) {
    console.error('[vitrine/get]', err);
    res.status(500).json({ erro: err.message });
  }
});

// ── POST /api/vitrine/:token/pedido  (público) ───────────────────────────────
router.post('/:token/pedido', async (req, res) => {
  const { itens = [], obs = '' } = req.body;
  if (!itens.length) return res.status(400).json({ erro: 'Carrinho vazio' });

  const invalido = itens.find(i =>
    !Number.isFinite(parseFloat(i.preco)) || parseFloat(i.preco) <= 0 ||
    !Number.isFinite(parseFloat(i.quantidade)) || parseFloat(i.quantidade) <= 0
  );
  if (invalido) return res.status(400).json({ erro: 'Dados de item inválidos' });

  try {
    const pool = await findPoolForToken(req.params.token);
    if (!pool) return res.status(404).json({ erro: 'Link inválido ou expirado' });

    await runWithPool(pool, async () => {
      const [[tk]] = await pool.query(
        `SELECT * FROM vitrine_tokens
         WHERE token = ? AND ativo = 1 AND (expira_em IS NULL OR expira_em > NOW())`,
        [req.params.token]
      );
      if (!tk) return res.status(404).json({ erro: 'Link inválido ou expirado' });

      let codCliente = null;
      let nomeCliente = '';
      let cnpjCliente = '';
      const contato = req.body?.contato || {};

      if (tk.id_cliente) {
        const [[cli]] = await pool.query(
          `SELECT id, nome, cpf FROM clientes WHERE id = ? LIMIT 1`,
          [tk.id_cliente]
        );
        if (!cli) return res.status(404).json({ erro: 'Cliente não encontrado' });
        codCliente = cli.id;
        nomeCliente = cli.nome || tk.nome_cliente || '';
        cnpjCliente = cli.cpf || '';
      } else {
        nomeCliente = String(contato.nome || '').trim();
        const tel = String(contato.telefone || '').trim();
        if (!nomeCliente || tel.length < 8) {
          return res.status(400).json({ erro: 'Informe seu nome e telefone para enviar o pedido' });
        }
      }

      // Tabela escolhida pelo cliente — uma só por pedido (sem mistura de preços)
      let tabelasCliente = await getTabelasVitrineCliente(pool, tk.id_cliente);
      const _selPed = _selIdsFromToken(tk);
      if (_selPed.length) tabelasCliente = tabelasCliente.filter((t) => _selPed.includes(Number(t.id_tabela)));
      if (!tabelasCliente.length) {
        throw Object.assign(new Error('Nenhuma tabela de preços liberada para este link'), { status: 422 });
      }
      let tabela = null;
      const idTabReq = parseInt(req.body.id_tabela, 10);
      if (Number.isFinite(idTabReq)) {
        // Escolha explícita: se não está mais liberada, NÃO substitui em silêncio
        tabela = tabelasCliente.find(t => Number(t.id_tabela) === idTabReq) || null;
        if (!tabela) {
          throw Object.assign(new Error('A tabela de preços selecionada não está mais disponível. Recarregue a página.'), { status: 422 });
        }
      } else if (tabelasCliente.length === 1) {
        tabela = tabelasCliente[0];
      } else {
        throw Object.assign(new Error('Selecione a tabela de preços'), { status: 422 });
      }

      // Rastreia a tabela escolhida (e a condição de pagamento) no pedido, via obs
      let _condDesc = '';
      if (tabela.cond_pagamento) {
        const [[fp]] = await pool.query(
          `SELECT descricao FROM forma_pagto WHERE id = ? LIMIT 1`, [tabela.cond_pagamento]
        ).catch(() => [[null]]);
        _condDesc = fp?.descricao || '';
      }
      const _infoTabela = `Tabela: ${tabela.descricao}${_condDesc ? ` · Pagamento: ${_condDesc}` : ''}`;
      let obsBase = String(obs || '').trim();
      if (!tk.id_cliente) {
        const tel = String(contato.telefone || '').trim();
        const extra = `[Vitrine web] Contato: ${nomeCliente} · Tel: ${tel}`;
        obsBase = obsBase ? `${obsBase}\n${extra}` : extra;
      }
      let obsFinal = obsBase ? `${obsBase} · ${_infoTabela}` : _infoTabela;
      const _obsMax = await getPedidoObsMaxLen(pool);
      if (obsFinal.length > _obsMax) obsFinal = obsFinal.slice(0, _obsMax);

      // Revalida preços contra a tabela escolhida — não confia nos valores do frontend
      const [precosBd] = await pool.query(`
        SELECT cod_produto, COALESCE(valor_tabela, preco_venda) AS preco
        FROM tabela_preco_itens
        WHERE id_tabela = ? AND excluido = 'N' AND (ativo = 'S' OR ativo IS NULL)
          AND COALESCE(valor_tabela, preco_venda) > 0
      `, [tabela.id_tabela]);

      const mapaPrecos = {};
      precosBd.forEach(p => { mapaPrecos[String(p.cod_produto)] = parseFloat(p.preco); });

      // Busca fornecedor de cada produto pelo banco (não confia no frontend)
      const prodTb  = await detectProdTable(pool);
      const hasForn = await detectProdFornCol(pool, prodTb);
      const mapaForn = {};
      if (hasForn) {
        const prodIds = itens.map(i => i.id);
        const [fornRows] = await pool.query(`
          SELECT p.ID AS id, p.cod_fornecedorpadrao AS cod_fornecedor, f.nome AS nome_fornecedor
          FROM ${prodTb} p
          LEFT JOIN fornecedores f ON f.id = p.cod_fornecedorpadrao
          WHERE p.ID IN (?)
        `, [prodIds]).catch(() => [[]]);
        fornRows.forEach(r => {
          mapaForn[String(r.id)] = { cod_fornecedor: r.cod_fornecedor || null, nome_fornecedor: r.nome_fornecedor || '' };
        });
      }

      const itensValidados = itens.map(i => {
        const precoReal = mapaPrecos[String(i.id)];
        if (!precoReal) throw Object.assign(new Error(`Produto ${i.id} sem preço autorizado`), { status: 422 });
        const forn = mapaForn[String(i.id)] || {};
        return { ...i, preco: precoReal, cod_fornecedor: forn.cod_fornecedor || null, nome_fornecedor: forn.nome_fornecedor || '' };
      });

      // Busca tipo_pedido marcado como padrão da vitrine
      const [[tp]] = await pool.query(
        `SELECT id, descricao FROM tipo_pedidos WHERE padrao_vitrine = 'S' AND excluido = 'N' LIMIT 1`
      ).catch(() => [[null]]);
      const id_tipopedido   = tp?.id || null;
      const tipo_pedido_str = tp?.descricao || 'ORÇAMENTO';

      // Agrupa itens por fornecedor — 1 pedido por fornecedor
      const grupos = new Map();
      for (const item of itensValidados) {
        const key = item.cod_fornecedor ?? '__sem_forn__';
        if (!grupos.has(key)) grupos.set(key, { cod_fornecedor: item.cod_fornecedor, nome_fornecedor: item.nome_fornecedor, itens: [] });
        grupos.get(key).itens.push(item);
      }

      // Regras do fornecedor (quando a tabela escolhida pede): mínimo de faturamento
      // e mínimo da condição de pagamento — bloqueia o pedido antes de gravar
      if (String(tabela.usar_regras_fornecedor).toUpperCase() === 'S') {
        const fornIds = [...grupos.keys()].filter(k => k !== '__sem_forn__');
        const minForn = {}, minCond = {};
        if (fornIds.length) {
          const [rowsF] = await pool.query(
            `SELECT id, COALESCE(vlr_minimofaturamento, 0) AS minimo FROM fornecedores WHERE id IN (?)`,
            [fornIds]
          ).catch(() => [[]]);
          rowsF.forEach(r => { minForn[String(r.id)] = parseFloat(r.minimo) || 0; });

          if (tabela.cond_pagamento) {
            const [rowsC] = await pool.query(
              `SELECT id_fornecedor, COALESCE(valor_minimo, 0) AS minimo
               FROM fornecedor_condicoes_pagamento
               WHERE id_condicao = ? AND excluido = 'N' AND id_fornecedor IN (?)`,
              [tabela.cond_pagamento, fornIds]
            ).catch(() => [[]]);
            rowsC.forEach(r => { minCond[String(r.id_fornecedor)] = parseFloat(r.minimo) || 0; });
          }
        }
        const violacoes = [];
        for (const [key, grupo] of grupos) {
          const total = grupo.itens.reduce((s, i) => s + i.preco * parseFloat(i.quantidade), 0);
          const minimo = Math.max(minForn[key] || 0, minCond[key] || 0);
          if (minimo > 0 && total < minimo - 0.005) {
            violacoes.push(`${grupo.nome_fornecedor || 'Fornecedor'}: ${_fmtBRL(total)} (mínimo ${_fmtBRL(minimo)})`);
          }
        }
        if (violacoes.length) {
          throw Object.assign(
            new Error('Pedido abaixo do mínimo do fornecedor — ' + violacoes.join('; ')),
            { status: 422 }
          );
        }
      }

      const dataAb = hojeIsoBrasil();
      const horaAb = horaBrasil();

      const conn = await pool.getConnection();
      let _numLock = null;
      try {
        await conn.beginTransaction();
        _numLock = await acquireNumeroPedidoLock(conn);
        const pedidosCriados = [];

        for (const [, grupo] of grupos) {
          const [[seq]] = await conn.query(
            `SELECT LPAD((COALESCE(MAX(numero + 0), 0) + 1), 6, '0') AS proximo FROM pedidos`
          );
          const numero     = seq.proximo;
          const totalGrupo = parseFloat(grupo.itens.reduce((s, i) => s + i.preco * parseFloat(i.quantidade), 0).toFixed(2));

          const [pRes] = await conn.query(
            `INSERT INTO pedidos (
              numero, data_abertura, hora_abertura,
              id_usuario, nome_vendedor,
              cod_cliente, cnpj, nome_cliente,
              cod_fornecedor, nome_fornecedor,
              id_tipopedido, tipo_pedido, situacao_pedido, status,
              vlrsubtotal, vlrtotalitens, vlrtotalpedido,
              vlrdesconto, vlrtotalimposto, vlrtotalbruto,
              id_filial, id_empresa, nome_empresa,
              obs, origem, excluido, dtcadastro
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
            [
              numero, dataAb, horaAb,
              tk.id_usuario, tk.nome_usuario,
              codCliente, cnpjCliente, (nomeCliente || '').toUpperCase(),
              grupo.cod_fornecedor || null, grupo.nome_fornecedor || '',
              id_tipopedido, tipo_pedido_str, 'PENDENTE', 'PENDENTE',
              totalGrupo, totalGrupo, totalGrupo, 0, 0, totalGrupo,
              tk.id_empresa || null, tk.id_empresa || null, tk.nome_empresa || '',
              obsFinal, 'VITRINE', 'N'
            ]
          );
          const pedidoId = pRes.insertId;

          for (let i = 0; i < grupo.itens.length; i++) {
            const item    = grupo.itens[i];
            const vlrItem = parseFloat((item.preco * parseFloat(item.quantidade)).toFixed(2));
            await conn.query(
              `INSERT INTO itensped (
                numpedido, id_pedido, cod_produto, desc_prod, unidade,
                quantidade, valor_unitario, vlrtotal_itens,
                desconto, comissao, st, vlr_st, ipi, vlr_ipi, icms, vlr_icms,
                tipo_pedido, sequencia, cod_fornecedor, data_inclusao, sincronizar, excluido
              ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'N','N')`,
              [
                numero, pedidoId,
                item.id, item.descricao || '', item.unidade || 'UN',
                item.quantidade, item.preco, vlrItem,
                0, 0, 0, 0, 0, 0, 0, 0,
                tipo_pedido_str, i + 1, item.cod_fornecedor || null, dataAb
              ]
            );
          }

          pedidosCriados.push({
            numero, pedido_id: pedidoId, fornecedor: grupo.nome_fornecedor || '',
            total: totalGrupo, nome_cliente: nomeCliente,
          });
        }

        await conn.commit();
        res.json({ ok: true, pedidos: pedidosCriados });

        pedidosCriados.forEach(p => emitNovoPedido({
          numero: p.numero,
          id: p.pedido_id,
          tipo_pedido: 'PEDIDO',
          nome_cliente: nomeCliente || '',
          nome_fornecedor: p.fornecedor || '',
          origem: 'VITRINE',
          vlrtotalpedido: p.total || 0,
        }));
        _notificarRepresentante(pool, tk, pedidosCriados).catch(e => console.error('[vitrine/wpp]', e.message));
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        await releaseNumeroPedidoLock(conn, _numLock);
        conn.release();
      }
    });
  } catch (err) {
    console.error('[vitrine/pedido]', err);
    res.status(err.status || 500).json({ erro: err.message || 'Erro ao registrar pedido' });
  }
});

const _uploadsProdutos = path.join(process.cwd(), 'public', 'uploads', 'produtos');

// ── GET /api/vitrine/:token/imagens/:prodId  (público) ─────────────────────
router.get('/:token/imagens/:prodId', async (req, res) => {
  try {
    const pool = await findPoolForToken(req.params.token);
    if (!pool) return res.status(404).json({ erro: 'Link inválido ou expirado' });

    await runWithPool(pool, async () => {
      const [[tk]] = await pool.query(
        `SELECT id FROM vitrine_tokens
         WHERE token = ? AND ativo = 1 AND (expira_em IS NULL OR expira_em > NOW())`,
        [req.params.token]
      );
      if (!tk) return res.status(404).json({ erro: 'Link inválido ou expirado' });

      const prodId = String(req.params.prodId);
      const [rows] = await pool.query(
        `SELECT filename, is_principal FROM produto_imagens
         WHERE cod_produto = ? ORDER BY is_principal DESC, ordem, id`,
        [prodId]
      ).catch(() => [[]]);

      let imgs = rows
        .filter(r => r.filename && fs.existsSync(path.join(_uploadsProdutos, prodId, r.filename)))
        .map(r => ({ url: `/uploads/produtos/${prodId}/${r.filename}`, is_principal: r.is_principal }));

      if (!imgs.length) {
        const prodTb = await detectProdTable(pool);
        const [[p]] = await pool.query(
          `SELECT foto_principal FROM ${prodTb} WHERE ID = ? AND excluido = 'N' LIMIT 1`,
          [prodId]
        );
        if (p?.foto_principal) imgs = [{ url: p.foto_principal, is_principal: 1 }];
      }

      res.json(imgs);
    });
  } catch (err) {
    console.error('[vitrine/imagens]', err);
    res.status(500).json({ erro: err.message });
  }
});

// ── GET /api/vitrine/:token/historico/:pedidoId/itens  (público) ─────────────
router.get('/:token/historico/:pedidoId/itens', async (req, res) => {
  try {
    const pool = await findPoolForToken(req.params.token);
    if (!pool) return res.status(404).json({ erro: 'Link inválido ou expirado' });
    await runWithPool(pool, async () => {
      const [[tk]] = await pool.query(
        `SELECT id_cliente FROM vitrine_tokens WHERE token = ? AND ativo = 1 AND (expira_em IS NULL OR expira_em > NOW())`,
        [req.params.token]
      );
      if (!tk) return res.status(404).json({ erro: 'Link inválido ou expirado' });
      if (!tk.id_cliente) return res.status(403).json({ erro: 'Histórico disponível apenas em links por cliente' });

      const [[ped]] = await pool.query(
        `SELECT id FROM pedidos WHERE id = ? AND cod_cliente = ? AND excluido = 'N' LIMIT 1`,
        [req.params.pedidoId, tk.id_cliente]
      );
      if (!ped) return res.status(403).json({ erro: 'Pedido não encontrado' });

      const [itens] = await pool.query(`
        SELECT desc_prod, quantidade, valor_unitario, vlrtotal_itens, unidade
        FROM itensped
        WHERE id_pedido = ? AND excluido = 'N'
        ORDER BY sequencia
      `, [req.params.pedidoId]);

      res.json(itens);
    });
  } catch (err) {
    console.error('[vitrine/historico/itens]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// ── GET /api/vitrine/:token/historico  (público) ─────────────────────────────
router.get('/:token/historico', async (req, res) => {
  try {
    const pool = await findPoolForToken(req.params.token);
    if (!pool) return res.status(404).json({ erro: 'Link inválido ou expirado' });
    await runWithPool(pool, async () => {
      const [[tk]] = await pool.query(
        `SELECT * FROM vitrine_tokens WHERE token = ? AND ativo = 1 AND (expira_em IS NULL OR expira_em > NOW())`,
        [req.params.token]
      );
      if (!tk) return res.status(404).json({ erro: 'Link inválido ou expirado' });
      if (!tk.id_cliente) return res.status(403).json({ erro: 'Histórico disponível apenas em links por cliente' });

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
    });
  } catch (err) {
    console.error('[vitrine/historico]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

module.exports = router;
