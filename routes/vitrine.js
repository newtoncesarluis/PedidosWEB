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
  getBoundChave,
  _poolMapKeys,
} = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { hojeIsoBrasil, horaBrasil, addDaysIsoBrasil } = require('../config/date-brasil');
const { emitNovoPedido } = require('../config/pedido-events');
const { acquireNumeroPedidoLock, releaseNumeroPedidoLock } = require('../config/pedido-numero-lock');
const { ensureVitrineColumns } = require('../config/schema-migrations');
const { calcBaseItemTotal, embalagemInicialProduto, isPrecoPorPeso } = require('../config/preco-peso-produto');
const { inserirParcelaUnicaReceber } = require('../config/pedido-parcela-canal');
const {
  fotoExisteNoDisco,
  detectProdImagensTb,
  detectProdCols,
  buildProdutoFotoSql,
  buildProdutoQtdFotosSql,
  buildProdutoImgJoins,
  resolveProdImagens,
} = require('../config/produto-foto-resolve');
const { obterGrupoReferencia } = require('../config/produto-referencia');

const _fmtBRL = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Total da linha na vitrine — mesma fórmula do pedido (precopeso / soma embalagem). */
function _vitrineLineTotal(item, somaEmb) {
  const q = parseFloat(item.quantidade) || 0;
  const preco = parseFloat(item.preco) || 0;
  const precopeso = item.precopeso || 'N';
  let embalagem = parseFloat(item.embalagem);
  if (!Number.isFinite(embalagem) || embalagem <= 0) {
    embalagem = isPrecoPorPeso(precopeso)
      ? embalagemInicialProduto(item)
      : (String(somaEmb || 'N').toUpperCase() === 'S'
          ? (parseFloat(item.kilo_embalagem) || 1)
          : 1);
  }
  return calcBaseItemTotal({
    quantidade: q,
    valorUnitario: preco,
    embalagem,
    kilo_embalagem: item.kilo_embalagem,
    precopeso,
    somaEmbalagempedido: somaEmb || 'N',
  });
}

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
    // fotos de produto costumam ter fundo branco: no escuro viram blocos berrantes,
    // por isso o padrao e DIA e quem gera o link decide
    `ALTER TABLE vitrine_tokens ADD COLUMN tema VARCHAR(10) NOT NULL DEFAULT 'DIA'`,
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
// "Link invalido ou expirado" nao distinguia link SUBSTITUIDO (ativo=0, o caso
// mais comum) de expirado ou inexistente, e mandava o cliente para o lugar errado.
const TEMAS_VITRINE = ['DIA', 'NOITE'];
const normalizarTema = (v) => {
  const t = String(v || '').trim().toUpperCase();
  return TEMAS_VITRINE.includes(t) ? t : 'DIA';
};

async function motivoTokenInvalido(pool, token) {
  const [[t]] = await pool.query(
    `SELECT ativo, (expira_em IS NOT NULL AND expira_em <= NOW()) AS venceu
     FROM vitrine_tokens WHERE token = ? LIMIT 1`,
    [token]
  ).catch(() => [[null]]);
  if (!t) return 'Link inv\u00e1lido ou expirado';
  if (Number(t.venceu)) return 'Este link expirou. Pe\u00e7a um link novo ao seu representante.';
  if (!Number(t.ativo)) return 'Este link foi substitu\u00eddo por um mais recente. Pe\u00e7a o link atualizado ao seu representante.';
  return 'Link inv\u00e1lido ou expirado';
}

async function findPoolForToken(token) {
  if (!customerDbFromLicense() || getBoundChave()) {
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

    const userId   = user.id || user.idusuario;

    // Gerar de novo desativa o link anterior — e o cliente que ja recebeu aquele
    // link ficava sem acesso. Por padrao devolvemos o link ativo que ja existe;
    // so criamos outro quando o representante pede (forcar_novo).
    const forcarNovo = req.body.forcar_novo === true || req.body.forcar_novo === 'S';
    if (!forcarNovo) {
      const [[emUso]] = await pool.query(
        idCliente
          ? `SELECT token, expira_em, tema FROM vitrine_tokens
             WHERE id_cliente = ? AND id_usuario = ? AND ativo = 1
               AND (expira_em IS NULL OR expira_em > NOW())
             ORDER BY id DESC LIMIT 1`
          : `SELECT token, expira_em, tema FROM vitrine_tokens
             WHERE id_cliente IS NULL AND id_usuario = ? AND ativo = 1
               AND (expira_em IS NULL OR expira_em > NOW())
             ORDER BY id DESC LIMIT 1`,
        idCliente ? [idCliente, userId] : [userId]
      ).catch(() => [[null]]);
      if (emUso) {
        return res.json({
          token: emUso.token,
          expira: emUso.expira_em,
          link: `/vitrine/${emUso.token}`,
          link_aberto: aberto,
          tema: normalizarTema(emUso.tema),
          reaproveitado: true,
        });
      }
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiraDate = addDaysIsoBrasil(parseInt(dias_validade, 10) || 60);
    const expiraSql = `${expiraDate} 23:59:59`;

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
    const tema = normalizarTema(req.body.tema);
    await pool.query(
      `INSERT INTO vitrine_tokens (token, id_cliente, id_usuario, nome_cliente, nome_usuario, expira_em, id_empresa, nome_empresa, tema)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [token, idCliente, userId, nomeCliente, nomeUser, expiraSql, idEmpresa, nomeEmpresa, tema]
    );

    res.json({ token, expira: expiraDate, link: `/vitrine/${token}`, link_aberto: aberto, tema });
  } catch (err) {
    console.error('[vitrine/gerar]', err);
    res.status(500).json({ erro: err.message });
  }
});

// Lista para o seletor do modal: com ?token= (link do próprio usuário) marca as
// tabelas já escolhidas no link; sem restrição salva (NULL) todas vêm marcadas.
async function _marcarSelecionadas(pool, req, tabelas) {
  let sel = [];
  const token = String(req.query.token || '');
  if (token) {
    const userId = req.user.id || req.user.idusuario;
    const [[tk]] = await pool.query(
      `SELECT ids_tabelas FROM vitrine_tokens WHERE token = ? AND id_usuario = ? LIMIT 1`,
      [token, userId]
    ).catch(() => [[null]]);
    sel = _selIdsFromToken(tk);
  }
  return tabelas.map((t) => ({
    id_tabela: t.id_tabela,
    descricao: t.descricao,
    selecionada: !sel.length || sel.includes(Number(t.id_tabela)),
  }));
}

// ── GET /api/vitrine/tabelas  (auth) ─────────────────────────────────────────
// Tabelas liberadas na vitrine — link aberto (sem cliente)
router.get('/tabelas', authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    await ensureTable(pool);
    const tabelas = await getTabelasVitrineCliente(pool, null);
    res.json(await _marcarSelecionadas(pool, req, tabelas));
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
    res.json(await _marcarSelecionadas(pool, req, tabelas));
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

// ── PATCH /api/vitrine/:token/tema  (requer autenticação) ────────────────────
router.patch('/:token/tema', authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    await ensureTable(pool);
    const tema = normalizarTema(req.body.tema);
    const userId = req.user.id || req.user.idusuario;
    const [r] = await pool.query(
      `UPDATE vitrine_tokens SET tema = ? WHERE token = ? AND id_usuario = ?`,
      [tema, req.params.token, userId]
    );
    res.json({ ok: true, tema, atualizado: r.affectedRows > 0 });
  } catch (err) {
    console.error('[vitrine/patch-tema]', err);
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
      if (!tk) return res.status(404).json({ erro: await motivoTokenInvalido(pool, req.params.token) });

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
      const prodCols = await detectProdCols(pool, prodTb);
      const hasForn = await detectProdFornCol(pool, prodTb);
      const fornSel  = hasForn ? `, p.cod_fornecedorpadrao AS cod_fornecedor, COALESCE(f.nome,'') AS nome_fornecedor` : `, NULL AS cod_fornecedor, '' AS nome_fornecedor`;
      const fornJoin = hasForn ? `LEFT JOIN fornecedores f ON f.id = p.cod_fornecedorpadrao` : '';
      const hasImgTb = await detectProdImagensTb(pool);
      const fotoSql = buildProdutoFotoSql(prodTb, prodCols, hasImgTb);
      const imgSel = buildProdutoQtdFotosSql(prodCols, hasImgTb);
      const imgJoin = buildProdutoImgJoins(prodCols, hasImgTb);
      const idRefSel = prodCols.idRef ? ', p.id_referencia' : ', NULL AS id_referencia';
      let produtos;
      try {
        const [rows] = await pool.query(`
          SELECT p.ID AS id, p.descricao, p.apelido, p.cod_barras,
                 p.cod_fabricante, p.unidade, ${fotoSql}, p.nome_grupo,
                 COALESCE(p.multiplo_venda, 1) AS multiplo_venda,
                 COALESCE(p.precopeso, 'N') AS precopeso,
                 COALESCE(p.kilo_embalagem, 0) AS kilo_embalagem
                 ${idRefSel}${fornSel}${imgSel}
          FROM ${prodTb} p ${fornJoin} ${imgJoin}
          WHERE p.excluido = 'N' AND p.situacao = 'A'
          ORDER BY p.nome_grupo, p.descricao
        `);
        produtos = rows;
      } catch (e) {
        // Bases sem precopeso/kilo_embalagem — catálogo continua (sem fórmula de peso)
        console.warn('[vitrine/get] fallback produtos sem precopeso:', e.message);
        const [rows] = await pool.query(`
          SELECT p.ID AS id, p.descricao, p.apelido, p.cod_barras,
                 p.cod_fabricante, p.unidade, ${fotoSql}, p.nome_grupo,
                 COALESCE(p.multiplo_venda, 1) AS multiplo_venda,
                 'N' AS precopeso, 0 AS kilo_embalagem
                 ${idRefSel}${fornSel}${imgSel}
          FROM ${prodTb} p ${fornJoin} ${imgJoin}
          WHERE p.excluido = 'N' AND p.situacao = 'A'
          ORDER BY p.nome_grupo, p.descricao
        `);
        produtos = rows;
      }

      let sis = { soma_embalagempedido: 'N', vitrine_pedido_unico: 'N' };
      try {
        const [[row]] = await pool.query(
          `SELECT COALESCE(soma_embalagempedido, 'N') AS soma_embalagempedido,
                  COALESCE(vitrine_pedido_unico, 'N') AS vitrine_pedido_unico
             FROM sistemas ORDER BY id DESC LIMIT 1`
        );
        if (row) sis = row;
      } catch (_) {
        const [[row]] = await pool.query(
          `SELECT COALESCE(soma_embalagempedido, 'N') AS soma_embalagempedido
             FROM sistemas ORDER BY id DESC LIMIT 1`
        ).catch(() => [[{ soma_embalagempedido: 'N' }]]);
        if (row) sis = { ...sis, ...row };
      }

      const lista = produtos
        .map(p => ({ ...p, precos: precosPorProduto[String(p.id)] || {} }))
        .filter(p => Object.keys(p.precos).length > 0);

      // URL quebrada no filho (cadastro antigo) → tenta mãe/galeria
      for (const p of lista) {
        if (p.foto_principal && !fotoExisteNoDisco(p.foto_principal)) {
          const imgs = await resolveProdImagens(pool, p.id);
          p.foto_principal = imgs[0]?.url || null;
          if (imgs.length > 1) p.qtd_fotos = imgs.length;
        }
      }

      const qtdSkusComPreco = Object.keys(precosPorProduto).length;
      let catalogo_vazio_motivo = null;
      if (!lista.length) {
        if (!tabelas.length) catalogo_vazio_motivo = 'SEM_TABELA';
        else if (!qtdSkusComPreco) catalogo_vazio_motivo = 'TABELA_SEM_PRECOS';
        else if (!produtos.length) catalogo_vazio_motivo = 'SEM_PRODUTO_ATIVO';
        else catalogo_vazio_motivo = 'SEM_INTERSECAO';
      }

      // Minimos por fabrica: o POST ja bloqueia o pedido com eles, mas o cliente
      // so descobria ao enviar. Mandamos junto para o carrinho poder avisar antes.
      const minimos = { fornecedores: {}, condicao: {} };
      if (tabelas.some(t => String(t.usar_regras_fornecedor || '').toUpperCase() === 'S')) {
        const idsForn = [...new Set(lista.map(p => p.cod_fornecedor).filter(Boolean))];
        if (idsForn.length) {
          let rowsF = [];
          try {
            const [r] = await pool.query(
              `SELECT id, COALESCE(vlr_minimofaturamento,0) AS minimo, COALESCE(min_cx_pedido,0) AS min_cx
                 FROM fornecedores WHERE id IN (?)`, [idsForn]
            );
            rowsF = r || [];
          } catch (_) {
            const [r] = await pool.query(
              `SELECT id, COALESCE(vlr_minimofaturamento,0) AS minimo
                 FROM fornecedores WHERE id IN (?)`, [idsForn]
            ).catch(() => [[]]);
            rowsF = (r || []).map(x => ({ ...x, min_cx: 0 }));
          }
          rowsF.forEach(r => {
            minimos.fornecedores[String(r.id)] = {
              minimo: parseFloat(r.minimo) || 0,
              min_cx: parseInt(r.min_cx, 10) || 0,
            };
          });
          // minimo da condicao de pagamento varia por tabela
          for (const t of tabelas) {
            if (String(t.usar_regras_fornecedor || '').toUpperCase() !== 'S' || !t.cond_pagamento) continue;
            const [rowsC] = await pool.query(
              `SELECT id_fornecedor, COALESCE(valor_minimo,0) AS minimo
                 FROM fornecedor_condicoes_pagamento
                WHERE id_condicao = ? AND excluido = 'N' AND id_fornecedor IN (?)`,
              [t.cond_pagamento, idsForn]
            ).catch(() => [[]]);
            if (rowsC && rowsC.length) {
              minimos.condicao[String(t.id_tabela)] = {};
              rowsC.forEach(r => {
                minimos.condicao[String(t.id_tabela)][String(r.id_fornecedor)] = parseFloat(r.minimo) || 0;
              });
            }
          }
        }
      }

      res.json({
        cliente,
        link_aberto: !tk.id_cliente,
        historico_disponivel: !!tk.id_cliente,
        tema: normalizarTema(tk.tema),
        representante: rep || null,
        tabelas: tabelas.map(t => ({
          id_tabela: t.id_tabela,
          descricao: t.descricao,
          usar_regras_fornecedor: String(t.usar_regras_fornecedor || 'N').toUpperCase(),
        })),
        minimos: minimos,
        soma_embalagempedido: sis?.soma_embalagempedido || 'N',
        vitrine_pedido_unico: String(sis?.vitrine_pedido_unico || 'N').toUpperCase() === 'S' ? 'S' : 'N',
        produtos: lista,
        catalogo_vazio_motivo,
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
      if (!tk) return res.status(404).json({ erro: await motivoTokenInvalido(pool, req.params.token) });

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

      // Tabelas liberadas no link — carrinho pode misturar várias (1 pedido por tabela+fábrica)
      let tabelasCliente = await getTabelasVitrineCliente(pool, tk.id_cliente);
      const _selPed = _selIdsFromToken(tk);
      if (_selPed.length) tabelasCliente = tabelasCliente.filter((t) => _selPed.includes(Number(t.id_tabela)));
      if (!tabelasCliente.length) {
        throw Object.assign(new Error('Nenhuma tabela de preços liberada para este link'), { status: 422 });
      }
      const mapaTabelas = new Map(tabelasCliente.map((t) => [String(t.id_tabela), t]));
      const idTabFallback = (() => {
        const idTabReq = parseInt(req.body.id_tabela, 10);
        if (Number.isFinite(idTabReq) && mapaTabelas.has(String(idTabReq))) return idTabReq;
        if (tabelasCliente.length === 1) return tabelasCliente[0].id_tabela;
        return null;
      })();

      // Flag: S = 1 pedido único (mistura fábricas); N = 1 pedido por fábrica/tabela
      let pedidoUnico = false;
      try {
        const [[sisFlag]] = await pool.query(
          `SELECT COALESCE(vitrine_pedido_unico, 'N') AS vitrine_pedido_unico
             FROM sistemas ORDER BY id DESC LIMIT 1`
        );
        pedidoUnico = String(sisFlag?.vitrine_pedido_unico || 'N').toUpperCase() === 'S';
      } catch (_) { /* coluna ainda não migrada → default N (por fábrica) */ }

      // Resolve tabela de cada item (id_tabela no item > body.id_tabela > única liberada)
      const itensComTabela = itens.map((i) => {
        const tid = parseInt(i.id_tabela, 10);
        const idTab = Number.isFinite(tid) ? tid : idTabFallback;
        if (!Number.isFinite(idTab) || !mapaTabelas.has(String(idTab))) {
          throw Object.assign(
            new Error('Selecione a tabela de preços (ou recarregue — alguma tabela do carrinho não está mais disponível).'),
            { status: 422 }
          );
        }
        return { ...i, id_tabela: idTab };
      });

      const idsTabelasUsadas = [...new Set(itensComTabela.map((i) => i.id_tabela))];

      // Condição de pagamento por tabela (cache)
      const pagtoPorTabela = {};
      for (const tid of idsTabelasUsadas) {
        const tab = mapaTabelas.get(String(tid));
        let condDesc = '';
        let prazoPadrao = '0';
        let formaPagto = 'BOLETO';
        if (tab.cond_pagamento) {
          const [[fp]] = await pool.query(
            `SELECT descricao, prazopadrao, forma FROM forma_pagto WHERE id = ? LIMIT 1`,
            [tab.cond_pagamento]
          ).catch(() => [[null]]);
          condDesc = fp?.descricao || '';
          prazoPadrao = String(fp?.prazopadrao || '').trim()
            || (/^\d+(\/\d+)*$/.test(condDesc) ? condDesc : '0');
          formaPagto = fp?.forma || 'BOLETO';
        }
        pagtoPorTabela[String(tid)] = {
          condDesc,
          prazoPadrao,
          formaPagto,
          infoTabela: `Tabela: ${tab.descricao}${condDesc ? ` · Pagamento: ${condDesc}` : ''}`,
        };
      }

      let obsBase = String(obs || '').trim();
      if (!tk.id_cliente) {
        const tel = String(contato.telefone || '').trim();
        const extra = `[Vitrine web] Contato: ${nomeCliente} · Tel: ${tel}`;
        obsBase = obsBase ? `${obsBase}\n${extra}` : extra;
      }
      const _obsMax = await getPedidoObsMaxLen(pool);

      // Revalida preços contra CADA tabela usada — não confia nos valores do frontend
      const [precosBd] = await pool.query(`
        SELECT id_tabela, cod_produto, COALESCE(valor_tabela, preco_venda) AS preco
        FROM tabela_preco_itens
        WHERE id_tabela IN (?) AND excluido = 'N' AND (ativo = 'S' OR ativo IS NULL)
          AND COALESCE(valor_tabela, preco_venda) > 0
      `, [idsTabelasUsadas]);

      const mapaPrecosPorTabela = {};
      precosBd.forEach((p) => {
        const tk2 = String(p.id_tabela);
        if (!mapaPrecosPorTabela[tk2]) mapaPrecosPorTabela[tk2] = {};
        mapaPrecosPorTabela[tk2][String(p.cod_produto)] = parseFloat(p.preco);
      });

      // Busca fornecedor + peso/embalagem de cada produto pelo banco (não confia no frontend)
      const prodTb  = await detectProdTable(pool);
      const hasForn = await detectProdFornCol(pool, prodTb);
      const mapaProd = {};
      {
        const prodIds = itensComTabela.map(i => i.id);
        const fornSel = hasForn
          ? `, p.cod_fornecedorpadrao AS cod_fornecedor, f.nome AS nome_fornecedor`
          : `, NULL AS cod_fornecedor, '' AS nome_fornecedor`;
        const fornJoin = hasForn ? `LEFT JOIN fornecedores f ON f.id = p.cod_fornecedorpadrao` : '';
        let prodRows = [];
        try {
          const [rows] = await pool.query(`
            SELECT p.ID AS id,
                   COALESCE(p.precopeso, 'N') AS precopeso,
                   COALESCE(p.kilo_embalagem, 0) AS kilo_embalagem,
                   COALESCE(p.multiplo_venda, 1) AS multiplo_venda
                   ${fornSel}
            FROM ${prodTb} p ${fornJoin}
            WHERE p.ID IN (?)
          `, [prodIds]);
          prodRows = rows || [];
        } catch (_) {
          const [rows] = await pool.query(`
            SELECT p.ID AS id,
                   'N' AS precopeso, 0 AS kilo_embalagem,
                   COALESCE(p.multiplo_venda, 1) AS multiplo_venda
                   ${fornSel}
            FROM ${prodTb} p ${fornJoin}
            WHERE p.ID IN (?)
          `, [prodIds]).catch(() => [[]]);
          prodRows = rows || [];
        }
        prodRows.forEach(r => {
          mapaProd[String(r.id)] = {
            cod_fornecedor: r.cod_fornecedor || null,
            nome_fornecedor: r.nome_fornecedor || '',
            precopeso: r.precopeso || 'N',
            kilo_embalagem: parseFloat(r.kilo_embalagem) || 0,
            multiplo_venda: parseInt(r.multiplo_venda, 10) || 1,
          };
        });
      }

      const [[sisEmb]] = await pool.query(
        `SELECT COALESCE(soma_embalagempedido, 'N') AS soma_embalagempedido
           FROM sistemas ORDER BY id DESC LIMIT 1`
      ).catch(() => [[{ soma_embalagempedido: 'N' }]]);
      const somaEmb = sisEmb?.soma_embalagempedido || 'N';

      const itensValidados = itensComTabela.map(i => {
        const precoReal = (mapaPrecosPorTabela[String(i.id_tabela)] || {})[String(i.id)];
        if (!precoReal) {
          const tab = mapaTabelas.get(String(i.id_tabela));
          throw Object.assign(
            new Error(`Produto ${i.descricao || i.id} sem preço na tabela "${tab?.descricao || i.id_tabela}"`),
            { status: 422 }
          );
        }
        const meta = mapaProd[String(i.id)] || {};
        const enriched = {
          ...i,
          preco: precoReal,
          id_tabela: i.id_tabela,
          cod_fornecedor: meta.cod_fornecedor || null,
          nome_fornecedor: meta.nome_fornecedor || '',
          precopeso: meta.precopeso || 'N',
          kilo_embalagem: meta.kilo_embalagem || 0,
          multiplo_venda: meta.multiplo_venda || 1,
        };
        enriched.vlrtotal = Math.round(_vitrineLineTotal(enriched, somaEmb) * 100) / 100;
        enriched.embalagem = isPrecoPorPeso(enriched.precopeso)
          ? embalagemInicialProduto(enriched)
          : (String(somaEmb).toUpperCase() === 'S'
              ? (parseFloat(enriched.kilo_embalagem) || 1)
              : 1);
        return enriched;
      });

      // Busca tipo_pedido marcado como padrão da vitrine
      const [[tp]] = await pool.query(
        `SELECT id, descricao FROM tipo_pedidos WHERE padrao_vitrine = 'S' AND excluido = 'N' LIMIT 1`
      ).catch(() => [[null]]);
      const id_tipopedido   = tp?.id || null;
      const tipo_pedido_str = tp?.descricao || 'ORÇAMENTO';

      // S = 1 pedido com tudo; N = 1 pedido por tabela+fábrica
      const grupos = new Map();
      if (pedidoUnico) {
        const tidRef = Number.isFinite(idTabFallback)
          ? idTabFallback
          : itensValidados[0].id_tabela;
        const tabela = mapaTabelas.get(String(tidRef));
        const pagto = pagtoPorTabela[String(tidRef)] || {
          condDesc: '', prazoPadrao: '0', formaPagto: 'BOLETO', infoTabela: '',
        };
        const infos = [...new Set(
          idsTabelasUsadas.map((tid) => pagtoPorTabela[String(tid)]?.infoTabela).filter(Boolean)
        )];
        let obsFinal = obsBase
          ? `${obsBase} · ${infos.join(' · ') || pagto.infoTabela}`
          : (infos.join(' · ') || pagto.infoTabela);
        if (obsFinal.length > _obsMax) obsFinal = obsFinal.slice(0, _obsMax);
        const forns = [...new Set(itensValidados.map((i) => i.cod_fornecedor).filter(Boolean))];
        let cod_fornecedor = null;
        let nome_fornecedor = '';
        if (forns.length === 1) {
          const ref = itensValidados.find((i) => i.cod_fornecedor === forns[0]);
          cod_fornecedor = forns[0];
          nome_fornecedor = ref?.nome_fornecedor || '';
        } else if (forns.length > 1) {
          nome_fornecedor = 'Várias fábricas';
        }
        grupos.set('unico', {
          cod_fornecedor,
          nome_fornecedor,
          tabela,
          pagto,
          obsFinal,
          itens: itensValidados,
        });
      } else {
        for (const item of itensValidados) {
          const key = `${item.id_tabela}|${item.cod_fornecedor ?? '__sem_forn__'}`;
          if (!grupos.has(key)) {
            const tabela = mapaTabelas.get(String(item.id_tabela));
            const pagto = pagtoPorTabela[String(item.id_tabela)];
            let obsFinal = obsBase ? `${obsBase} · ${pagto.infoTabela}` : pagto.infoTabela;
            if (obsFinal.length > _obsMax) obsFinal = obsFinal.slice(0, _obsMax);
            grupos.set(key, {
              cod_fornecedor: item.cod_fornecedor,
              nome_fornecedor: item.nome_fornecedor,
              tabela,
              pagto,
              obsFinal,
              itens: [],
            });
          }
          grupos.get(key).itens.push(item);
        }
      }

      // Regras do fornecedor (mínimos) — sempre por fábrica, mesmo em pedido único
      {
        const fornIdsAll = [...new Set(
          itensValidados
            .filter((i) => {
              const tab = mapaTabelas.get(String(i.id_tabela));
              return String(tab?.usar_regras_fornecedor || '').toUpperCase() === 'S' && i.cod_fornecedor;
            })
            .map((i) => i.cod_fornecedor)
        )];
        const minForn = {};
        const minCxMap = {};
        if (fornIdsAll.length) {
          let rowsF = [];
          try {
            const [r] = await pool.query(
              `SELECT id,
                      COALESCE(vlr_minimofaturamento, 0) AS minimo,
                      COALESCE(min_cx_pedido, 0) AS min_cx
                 FROM fornecedores WHERE id IN (?)`,
              [fornIdsAll]
            );
            rowsF = r || [];
          } catch (_) {
            const [r] = await pool.query(
              `SELECT id, COALESCE(vlr_minimofaturamento, 0) AS minimo
                 FROM fornecedores WHERE id IN (?)`,
              [fornIdsAll]
            ).catch(() => [[]]);
            rowsF = (r || []).map((x) => ({ ...x, min_cx: 0 }));
          }
          rowsF.forEach((r) => {
            minForn[String(r.id)] = parseFloat(r.minimo) || 0;
            minCxMap[String(r.id)] = parseInt(r.min_cx, 10) || 0;
          });
        }
        const minCondPorTab = {};
        for (const tid of idsTabelasUsadas) {
          const tab = mapaTabelas.get(String(tid));
          if (String(tab?.usar_regras_fornecedor || '').toUpperCase() !== 'S' || !tab.cond_pagamento) continue;
          const fornIds = [...new Set(
            itensValidados
              .filter((i) => Number(i.id_tabela) === Number(tid) && i.cod_fornecedor)
              .map((i) => i.cod_fornecedor)
          )];
          if (!fornIds.length) continue;
          const [rowsC] = await pool.query(
            `SELECT id_fornecedor, COALESCE(valor_minimo, 0) AS minimo
             FROM fornecedor_condicoes_pagamento
             WHERE id_condicao = ? AND excluido = 'N' AND id_fornecedor IN (?)`,
            [tab.cond_pagamento, fornIds]
          ).catch(() => [[]]);
          minCondPorTab[String(tid)] = {};
          rowsC.forEach((r) => {
            minCondPorTab[String(tid)][String(r.id_fornecedor)] = parseFloat(r.minimo) || 0;
          });
        }
        // Subconjuntos por tabela+fábrica (também no pedido único)
        const subMin = new Map();
        for (const item of itensValidados) {
          const tab = mapaTabelas.get(String(item.id_tabela));
          if (String(tab?.usar_regras_fornecedor || '').toUpperCase() !== 'S') continue;
          const key = `${item.id_tabela}|${item.cod_fornecedor ?? '__sem_forn__'}`;
          if (!subMin.has(key)) {
            subMin.set(key, {
              tabela: tab,
              cod_fornecedor: item.cod_fornecedor,
              nome_fornecedor: item.nome_fornecedor,
              itens: [],
            });
          }
          subMin.get(key).itens.push(item);
        }
        const violacoes = [];
        for (const [, sub] of subMin) {
          const key = String(sub.cod_fornecedor || '');
          const total = sub.itens.reduce((s, i) => s + (parseFloat(i.vlrtotal) || 0), 0);
          const minCond = (minCondPorTab[String(sub.tabela.id_tabela)] || {})[key] || 0;
          const minimo = Math.max(minForn[key] || 0, minCond);
          const rotulo = sub.nome_fornecedor || sub.tabela.descricao || 'Fornecedor';
          if (minimo > 0 && total < minimo - 0.005) {
            violacoes.push(`${rotulo}: ${_fmtBRL(total)} (mínimo ${_fmtBRL(minimo)})`);
          }
          const minCx = minCxMap[key] || 0;
          if (minCx > 0) {
            const totalCx = sub.itens.reduce((s, i) => {
              const mult = parseInt(i.multiplo_venda, 10) || 1;
              return s + ((parseFloat(i.quantidade) || 0) / mult);
            }, 0);
            if (totalCx < minCx) {
              violacoes.push(`${rotulo}: ${Math.floor(totalCx)} cx (mínimo ${minCx} cx)`);
            }
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
          const totalGrupo = parseFloat(grupo.itens.reduce((s, i) => s + (parseFloat(i.vlrtotal) || 0), 0).toFixed(2));
          const { condDesc, formaPagto, prazoPadrao } = grupo.pagto;
          const tabela = grupo.tabela;

          const [pRes] = await conn.query(
            `INSERT INTO pedidos (
              numero, data_abertura, hora_abertura,
              id_usuario, nome_vendedor,
              cod_cliente, cnpj, nome_cliente,
              cod_fornecedor, nome_fornecedor,
              id_tipopedido, tipo_pedido, situacao_pedido, status,
              id_condicaopagto, condicao_pagto, forma_pagto, qt_parcelas,
              vlrsubtotal, vlrtotalitens, vlrtotalpedido,
              vlrdesconto, vlrtotalimposto, vlrtotalbruto,
              id_filial, id_empresa, nome_empresa,
              obs, origem, excluido, dtcadastro
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
            [
              numero, dataAb, horaAb,
              tk.id_usuario, tk.nome_usuario,
              codCliente, cnpjCliente, (nomeCliente || '').toUpperCase(),
              grupo.cod_fornecedor || null, grupo.nome_fornecedor || '',
              id_tipopedido, tipo_pedido_str, 'PENDENTE', 'PENDENTE',
              tabela.cond_pagamento || null, condDesc, formaPagto, 1,
              totalGrupo, totalGrupo, totalGrupo, 0, 0, totalGrupo,
              tk.id_empresa || null, tk.id_empresa || null, tk.nome_empresa || '',
              grupo.obsFinal, 'VITRINE', 'N'
            ]
          );
          const pedidoId = pRes.insertId;

          for (let i = 0; i < grupo.itens.length; i++) {
            const item    = grupo.itens[i];
            const vlrItem = parseFloat(item.vlrtotal) || 0;
            const emb = parseFloat(item.embalagem) || null;
            await conn.query(
              `INSERT INTO itensped (
                numpedido, id_pedido, cod_produto, desc_prod, unidade,
                quantidade, valor_unitario, vlrtotal_itens, kilo_embalagem,
                desconto, comissao, st, vlr_st, ipi, vlr_ipi, icms, vlr_icms,
                tipo_pedido, sequencia, cod_fornecedor, data_inclusao, sincronizar, excluido
              ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'N','N')`,
              [
                numero, pedidoId,
                item.id, item.descricao || '', item.unidade || 'UN',
                item.quantidade, item.preco, vlrItem, emb,
                0, 0, 0, 0, 0, 0, 0, 0,
                tipo_pedido_str, i + 1, item.cod_fornecedor || null, dataAb
              ]
            );
          }

          await inserirParcelaUnicaReceber(conn, {
            numero,
            pedidoId,
            total: totalGrupo,
            dataAbertura: dataAb,
            codFornecedor: grupo.cod_fornecedor,
            nomeFornecedor: grupo.nome_fornecedor,
            formaPagto,
            prazoPadrao,
          });

          const rotuloFab = grupo.nome_fornecedor || tabela.descricao || '';
          pedidosCriados.push({
            numero, pedido_id: pedidoId, fornecedor: rotuloFab,
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

// ── GET /api/vitrine/:token/variacoes/:prodId  (público — pai/cores) ───────
router.get('/:token/variacoes/:prodId', async (req, res) => {
  try {
    const pool = await findPoolForToken(req.params.token);
    if (!pool) return res.status(404).json({ erro: 'Link inválido ou expirado' });

    await runWithPool(pool, async () => {
      const [[tk]] = await pool.query(
        `SELECT id FROM vitrine_tokens
         WHERE token = ? AND ativo = 1 AND (expira_em IS NULL OR expira_em > NOW())`,
        [req.params.token]
      );
      if (!tk) return res.status(404).json({ erro: await motivoTokenInvalido(pool, req.params.token) });

      const grupo = await obterGrupoReferencia(pool, req.params.prodId);
      if (!grupo) return res.status(404).json({ erro: 'Produto não encontrado' });
      res.json(grupo);
    });
  } catch (err) {
    console.error('[vitrine/variacoes]', err);
    res.status(500).json({ erro: err.message });
  }
});

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
      if (!tk) return res.status(404).json({ erro: await motivoTokenInvalido(pool, req.params.token) });

      const imgs = await resolveProdImagens(pool, req.params.prodId);
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
      if (!tk) return res.status(404).json({ erro: await motivoTokenInvalido(pool, req.params.token) });
      if (!tk.id_cliente) return res.status(403).json({ erro: 'Histórico disponível apenas em links por cliente' });

      const [[ped]] = await pool.query(
        `SELECT id FROM pedidos WHERE id = ? AND cod_cliente = ? AND excluido = 'N' LIMIT 1`,
        [req.params.pedidoId, tk.id_cliente]
      );
      if (!ped) return res.status(403).json({ erro: 'Pedido não encontrado' });

      const [itens] = await pool.query(`
        SELECT cod_produto, desc_prod, quantidade, valor_unitario, vlrtotal_itens, unidade
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
      if (!tk) return res.status(404).json({ erro: await motivoTokenInvalido(pool, req.params.token) });
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
