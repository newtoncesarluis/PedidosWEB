/**
 * Importação de preços / produtos via planilha (equivalente ao importacao.php do protótipo).
 */
const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');
const { ensureTabelaPrecoItensDecimal } = require('../config/schema-migrations');
const { getProdTabela } = require('../config/produto-colunas');

const CAMPOS_DATA = new Set([
  'dt_cadastro', 'dt_atualizacao', 'dt_validade', 'dt_vencimento',
  'data_cadastro', 'data_atualizacao', 'data_nascimento', 'dt_nascimento',
]);
const _MESES = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
function normalizarData(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (!s) return null;
  // Já está em YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const ano = new Date().getFullYear();
  // "Fri May 15" ou "May 15" → parseia pelo nome do mês
  const m1 = s.match(/^(?:[A-Za-z]{3}\s+)?([A-Za-z]{3})\s+(\d{1,2})(?:\s+(\d{4}))?$/);
  if (m1) {
    const mi = _MESES.indexOf(m1[1].toLowerCase());
    if (mi >= 0) {
      const y  = m1[3] ? parseInt(m1[3]) : ano;
      const mm = String(mi + 1).padStart(2, '0');
      const dd = String(parseInt(m1[2])).padStart(2, '0');
      return `${y}-${mm}-${dd}`;
    }
  }
  // "DD/MM/YYYY" ou "MM/DD/YYYY" → tenta ISO via replace
  const m2 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m2) {
    // assume DD/MM/YYYY (padrão Brasil)
    const dd = m2[1].padStart(2,'0'), mm = m2[2].padStart(2,'0'), yy = m2[3];
    return `${yy}-${mm}-${dd}`;
  }
  // Fallback: new Date
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  return null;
}

const CAMPOS_NUMERICOS = new Set([
  'ipi', 'st', 'icms', 'precoa', 'precob', 'precoc', 'precod',
  'precoe', 'precof', 'precopromo', 'vlr_venda', 'vlrcustofinalVenda',
  'kilo_embalagem', 'peso_liquido', 'comissao', 'margem', 'margem_liquida',
  'vlr_custo', 'vlr_despesas', 'vlr_custofinal',
]);
// Campos inteiros — processados separadamente com parseInt (nunca como monetário)
const CAMPOS_INTEIROS_FIXOS = new Set(['embalagemmaster', 'multiplo_venda', 'qtd_minima_pedido']);

/** Campos de preço/imposto no cadastro `produto` — não gravar na ficha em modo tabela de preço. */
const CAMPOS_PRECO_PRODUTO = new Set([
  'precoa', 'precob', 'precoc', 'precod', 'precoe', 'precof', 'precopromo',
  'vlr_venda', 'vlrcustofinalVenda', 'ipi', 'st', 'icms'
]);

// Campos padrão que devem sempre existir para tabela='produto'
const DEFAULT_CAMPOS_PRODUTO = [
  { nome_campo: 'descricao',        apelido: 'Descrição',          tipo: 'texto',   ordem: 1,  obrigatorio: 'S' },
  { nome_campo: 'cod_fabricante',   apelido: 'Cód. Fabricante',    tipo: 'texto',   ordem: 2,  obrigatorio: 'S' },
  { nome_campo: 'unidade',          apelido: 'Unidade',            tipo: 'texto',   ordem: 3,  obrigatorio: 'N' },
  { nome_campo: 'vlr_venda',        apelido: 'Preço Venda',        tipo: 'moeda',   ordem: 4,  obrigatorio: 'N' },
  { nome_campo: 'precoa',           apelido: 'Preço A',            tipo: 'moeda',   ordem: 5,  obrigatorio: 'N' },
  { nome_campo: 'precob',           apelido: 'Preço B',            tipo: 'moeda',   ordem: 6,  obrigatorio: 'N' },
  { nome_campo: 'precoc',           apelido: 'Preço C',            tipo: 'moeda',   ordem: 7,  obrigatorio: 'N' },
  { nome_campo: 'precopromo',       apelido: 'Preço Promo',        tipo: 'moeda',   ordem: 8,  obrigatorio: 'N' },
  { nome_campo: 'ipi',              apelido: 'IPI %',              tipo: 'decimal', ordem: 9,  obrigatorio: 'N' },
  { nome_campo: 'st',               apelido: 'ST %',               tipo: 'decimal', ordem: 10, obrigatorio: 'N' },
  { nome_campo: 'icms',             apelido: 'ICMS %',             tipo: 'decimal', ordem: 11, obrigatorio: 'N' },
  { nome_campo: 'kilo_embalagem',   apelido: 'Peso Embalagem (kg)',tipo: 'decimal', ordem: 12, obrigatorio: 'N' },
  { nome_campo: 'precopeso',        apelido: 'Preço por Peso (S/N)',tipo: 'texto',  ordem: 12.5, obrigatorio: 'N' },
  { nome_campo: 'embalagemmaster',  apelido: 'Embalagem Master',   tipo: 'inteiro', ordem: 13, obrigatorio: 'N' },
  { nome_campo: 'multiplo_venda',   apelido: 'Múltiplo de Venda',  tipo: 'inteiro', ordem: 14, obrigatorio: 'N' },
  { nome_campo: 'qtd_minima_pedido', apelido: 'Qtd. Mínima Pedido', tipo: 'inteiro', ordem: 14.5, obrigatorio: 'N' },
  { nome_campo: 'peso_liquido',     apelido: 'Peso Líquido',       tipo: 'decimal', ordem: 15, obrigatorio: 'N' },
  { nome_campo: 'ncm',              apelido: 'NCM',                tipo: 'texto',   ordem: 16, obrigatorio: 'N' },
  { nome_campo: 'cod_barras',       apelido: 'Cód. Barras',        tipo: 'texto',   ordem: 17, obrigatorio: 'N' },
  { nome_campo: 'marca',            apelido: 'Marca',              tipo: 'texto',   ordem: 18, obrigatorio: 'N' },
  { nome_campo: 'situacao',         apelido: 'Situação',           tipo: 'texto',   ordem: 19, obrigatorio: 'N' },
  { nome_campo: 'estoque_atual',    apelido: 'Estoque Atual',      tipo: 'decimal', ordem: 20, obrigatorio: 'N' },
  { nome_campo: 'estoque_minimo',   apelido: 'Estoque Mínimo',     tipo: 'decimal', ordem: 21, obrigatorio: 'N' },
  { nome_campo: 'estoque_maximo',   apelido: 'Estoque Máximo',     tipo: 'decimal', ordem: 22, obrigatorio: 'N' },
  { nome_campo: 'estoque_seguranca',apelido: 'Estoque Segurança',  tipo: 'decimal', ordem: 23, obrigatorio: 'N' },
  { nome_campo: 'segmento',          apelido: 'Categoria/Segmento', tipo: 'texto',   ordem: 24, obrigatorio: 'N' },
  { nome_campo: 'linha_produto',     apelido: 'Linha de Produto',   tipo: 'texto',   ordem: 24.4, obrigatorio: 'N' },
  { nome_campo: 'campo_extra',       apelido: 'Campo Extra',        tipo: 'texto',   ordem: 24.6, obrigatorio: 'N' },
  { nome_campo: 'vlr_custo',         apelido: 'Custo Inicial',      tipo: 'moeda',   ordem: 24.7, obrigatorio: 'N' },
  { nome_campo: 'vlr_despesas',      apelido: 'Despesas / Frete',   tipo: 'moeda',   ordem: 24.75, obrigatorio: 'N' },
  { nome_campo: 'margem',            apelido: 'Margem %',           tipo: 'decimal', ordem: 24.8, obrigatorio: 'N' },
  { nome_campo: 'comissao',          apelido: 'Comissão %',         tipo: 'decimal', ordem: 24.85, obrigatorio: 'N' },
  { nome_campo: 'margem_liquida',    apelido: 'Mark-up Líquido %',  tipo: 'decimal', ordem: 24.9, obrigatorio: 'N' },
  // Virtual: resolve para tipograde (id). Texto da planilha (P/M/G/GG) ou id numérico.
  // Busca grade existente; se não achar, cria tipograde + tamanhos e vincula.
  { nome_campo: 'grade',             apelido: 'Grade',             tipo: 'texto',   ordem: 26, obrigatorio: 'N' },
  // Auxiliares (auto-cria se não existir — Tabelas de Apoio)
  { nome_campo: 'grupo',             apelido: 'Grupo',             tipo: 'texto',   ordem: 27, obrigatorio: 'N' },
  { nome_campo: 'subfamilia',        apelido: 'Subfamília',        tipo: 'texto',   ordem: 28, obrigatorio: 'N' },
  { nome_campo: 'unidade',           apelido: 'Unidade',           tipo: 'texto',   ordem: 29, obrigatorio: 'N' },
  { nome_campo: 'tipoprodutograde',  apelido: 'Tipo de Grade',     tipo: 'texto',   ordem: 30, obrigatorio: 'N' },
  { nome_campo: 'local',             apelido: 'Local Armazenamento', tipo: 'texto', ordem: 31, obrigatorio: 'N' },
  { nome_campo: 'familia',           apelido: 'Família',           tipo: 'texto',   ordem: 32, obrigatorio: 'N' },
  { nome_campo: 'categoria',         apelido: 'Categoria',         tipo: 'texto',   ordem: 33, obrigatorio: 'N' },
];

/** Campos auxiliares que devem permanecer ativos no mapeamento (mesmo se alguém excluiu). */
const CAMPOS_AUX_REATIVAR = [
  'grade', 'grupo', 'subfamilia', 'unidade', 'tipoprodutograde',
  'local', 'familia', 'categoria', 'segmento',
];

/** Cache por DATABASE() — multi-tenant: não pular seed do 2º tenant. */
const _defaultCamposProdutoSeededDbs = new Set();
async function ensureDefaultCamposProduto(pool) {
  try {
    let dbName = '';
    try {
      const [[r]] = await pool.query('SELECT DATABASE() AS db');
      dbName = String(r?.db || '');
    } catch (_) { /* ignore */ }
    // Já seedou neste processo p/ esta base → NÃO reexecutar dezenas de INSERT
    // (isso deixava a leitura da planilha em ~1 min na 1ª carga).
    if (dbName && _defaultCamposProdutoSeededDbs.has(dbName)) return;

    // 1 query: quais campos já existem
    const [existRows] = await pool.query(
      `SELECT nome_campo FROM campos_importacao WHERE tabela='produto'`
    ).catch(() => [[]]);
    const exist = new Set((existRows || []).map((r) => String(r.nome_campo || '')));

    for (const c of DEFAULT_CAMPOS_PRODUTO) {
      if (exist.has(c.nome_campo)) continue;
      await pool.query(
        `INSERT INTO campos_importacao (tabela, nome_campo, apelido, tipo, ordem, obrigatorio, excluido)
         VALUES ('produto', ?, ?, ?, ?, ?, 'N')`,
        [c.nome_campo, c.apelido, c.tipo, c.ordem, c.obrigatorio]
      ).catch(() => {});
      exist.add(c.nome_campo);
    }

    // Garante tipo correto para campos inteiros (bases antigas podem ter 'decimal')
    const inteiros = ['multiplo_venda', 'embalagemmaster', 'qtd_minima_pedido'];
    for (const nc of inteiros) {
      await pool.query(
        `UPDATE campos_importacao SET tipo='inteiro' WHERE tabela='produto' AND nome_campo=? AND tipo <> 'inteiro'`,
        [nc]
      ).catch(() => {});
    }
    // Bases antigas: reativa Grade/auxiliares se alguém excluiu o campo
    await pool.query(
      `UPDATE campos_importacao SET excluido='N'
       WHERE tabela='produto' AND excluido='S' AND nome_campo IN (${CAMPOS_AUX_REATIVAR.map(() => '?').join(',')})`,
      CAMPOS_AUX_REATIVAR
    ).catch(() => {});
    await pool.query(
      `UPDATE campos_importacao SET apelido='Grade', tipo='texto'
       WHERE tabela='produto' AND nome_campo='grade'`
    ).catch(() => {});
    if (dbName) _defaultCamposProdutoSeededDbs.add(dbName);
    else _defaultCamposProdutoSeededDbs.add('_');
  } catch (_) { /* tabela pode não existir ainda — ignora */ }
}

async function ensureTabelaPadraoCols(pool) {
  try {
    await pool.query(
      `ALTER TABLE tabela_preco_cabecalho ADD COLUMN tabela_padrao ENUM('S','N') NOT NULL DEFAULT 'N'`
    );
  } catch (_) { /* já existe */ }
  try {
    await pool.query(
      `ALTER TABLE tabela_preco_cabecalho ADD COLUMN atualizar_tabelapadrao ENUM('S','N') NOT NULL DEFAULT 'N'`
    );
  } catch (_) { /* já existe */ }
}

function stripPrecosProduto(dados) {
  for (const p of CAMPOS_PRECO_PRODUTO) delete dados[p];
}

function zerarPrecosProdutoInsert(dados) {
  for (const p of CAMPOS_PRECO_PRODUTO) dados[p] = '0';
}

function getMetaProdutoTabela(campos) {
  if (!campos || typeof campos !== 'object') {
    return { descricao: 'PRODUTO', cod_fabricante: '', unidade: '' };
  }
  const d =
    String(campos.descricao || campos.desc_produto || campos.produto || campos.nome || '').trim() || 'PRODUTO';
  return {
    descricao: d.slice(0, 200),
    cod_fabricante: String(campos.cod_fabricante ?? '').trim().slice(0, 100),
    unidade: String(campos.unidade ?? '').trim().slice(0, 10)
  };
}

function parseTabelaPrecosUpdates(body) {
  let raw = body.tabela_precos_updates;
  if (raw == null) return [];
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const u of raw) {
    const id_tabela = parseInt(String(u.id_tabela ?? ''), 10);
    const valor_final = parseFloat(String(u.valor_final ?? u.valor ?? '').replace(',', '.'));
    if (!id_tabela || id_tabela < 1 || Number.isNaN(valor_final) || valor_final <= 0) continue;
    const tipo_desconto = u.tipo_desconto === 'P' ? 'P' : 'R';
    const vlr_desconto = parseFloat(String(u.vlr_desconto ?? '0').replace(',', '.'));
    out.push({
      id_tabela,
      valor_final,
      tipo_desconto,
      vlr_desconto: Number.isFinite(vlr_desconto) ? vlr_desconto : 0
    });
  }
  const map = new Map();
  for (const u of out) map.set(u.id_tabela, u);
  return [...map.values()];
}

async function obterIdTabelaPadraoAuto(pool) {
  const [rows] = await pool
    .query(
      `SELECT id FROM tabela_preco_cabecalho
     WHERE excluido = 'N' AND Tabela_Ativa = 'S'
     AND UPPER(COALESCE(tabela_padrao,'N')) = 'S'
     AND UPPER(COALESCE(atualizar_tabelapadrao,'N')) = 'S'
     LIMIT 1`
    )
    .catch(() => [[]]);
  return rows[0]?.id ? parseInt(String(rows[0].id), 10) : null;
}

function mergeTabelaPadraoEmUpdates(updates, idPadrao, isInsert, precoRef) {
  const list = [...updates];
  if (!isInsert || !idPadrao) return list;
  // Preços explícitos por tabela: não duplicar na tabela padrão via coluna base
  if (list.length > 0) return list;
  const idPadraoNum = Number(idPadrao);
  if (list.some((u) => Number(u.id_tabela) === idPadraoNum)) return list;
  const v = parseFloat(String(precoRef ?? '').replace(',', '.'));
  if (!(v > 0)) return list;
  list.push({ id_tabela: idPadraoNum, valor_final: v, tipo_desconto: 'R', vlr_desconto: 0 });
  return list;
}

async function aplicarTabelaPrecoUpserts(conn, codProduto, meta, updates) {
  const pid = parseInt(String(codProduto), 10);
  if (!pid || !updates || !updates.length) return;

  const desc = meta.descricao || 'PRODUTO';
  const cf = meta.cod_fabricante || '';
  const un = meta.unidade || '';

  for (const u of updates) {
    if (!u.id_tabela || !(u.valor_final > 0)) continue;
    const val = Number(parseFloat(u.valor_final).toFixed(2));
    const tipo = u.tipo_desconto === 'P' ? 'P' : 'R';
    const vlrDesc = Number(parseFloat(u.vlr_desconto || 0).toFixed(2));

    const [exist] = await conn.query(
      `SELECT id FROM tabela_preco_itens
       WHERE id_tabela = ? AND cod_produto = ? AND (excluido = 'N' OR excluido IS NULL)
       LIMIT 1`,
      [u.id_tabela, pid]
    );

    if (exist.length) {
      await conn.query(
        `UPDATE tabela_preco_itens SET
         descricao = ?, cod_fabricante = ?, unidade = ?,
         preco_base = ?, preco_venda = ?, valor_tabela = ?,
         tipo_desconto = ?, vlr_desconto = ?,
         ativo = 'S', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [desc, cf || null, un || null, val, val, val, tipo, vlrDesc, exist[0].id]
      );
    } else {
      const [[mx]] = await conn.query(
        `SELECT COALESCE(MAX(item), 0) + 1 AS nx FROM tabela_preco_itens WHERE id_tabela = ?`,
        [u.id_tabela]
      );
      const item = mx?.nx ?? 1;
      await conn.query(
        `INSERT INTO tabela_preco_itens
        (id_tabela, item, cod_produto, descricao, cod_fabricante, unidade,
         preco_base, preco_venda, tipo_desconto, vlr_desconto, valor_tabela, ativo, vigencia, excluido)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,'S',NULL,'N')`,
        [u.id_tabela, item, pid, desc, cf || null, un || null, val, val, tipo, vlrDesc, val]
      );
    }
  }
}

// ─── GET /fornecedores — lista para combo (com precoprincipal e descontos) ───
router.get('/fornecedores', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT id, nome, precoprincipal,
              desconto1, desconto2, desconto3, desconto4, desconto5, desconto6
       FROM fornecedores
       WHERE (excluido = 'N' OR excluido IS NULL OR excluido = '')
       ORDER BY nome ASC`
    );
    const fornecedores = rows.map((row) => ({
      id: row.id,
      nome: row.nome,
      precoprincipal: String(row.precoprincipal ?? '').trim().toUpperCase(),
      desconto1: parseFloat(row.desconto1) || 0,
      desconto2: parseFloat(row.desconto2) || 0,
      desconto3: parseFloat(row.desconto3) || 0,
      desconto4: parseFloat(row.desconto4) || 0,
      desconto5: parseFloat(row.desconto5) || 0,
      desconto6: parseFloat(row.desconto6) || 0
    }));
    res.json({ ok: true, fornecedores });
  } catch (err) {
    console.error('[importacao-precos/fornecedores]', err);
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// ─── GET /campos-importacao ──────────────────────────────────────────────────
router.get('/campos-importacao', async (req, res) => {
  const tabela = (req.query.tabela || 'produto').toString();
  const filtro = (req.query.filtro || 'todos').toString();
  try {
    const pool = getPool();
    if (tabela === 'produto') await ensureDefaultCamposProduto(pool);
    let where = 'tabela = ?';
    const params = [tabela];
    if (filtro === 'ativos') where += " AND excluido = 'N'";
    if (filtro === 'inativos') where += " AND excluido = 'S'";
    const [campos] = await pool.query(
      `SELECT * FROM campos_importacao WHERE ${where} ORDER BY ordem ASC, id ASC`,
      params
    ).catch(() => [[]]);
    res.json({ ok: true, campos });
  } catch (err) {
    console.error('[importacao-precos/campos-importacao]', err);
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// ─── GET /campos-tabelas — valores distintos de `tabela` (cadastro de campos) ─
router.get('/campos-tabelas', async (_req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      "SELECT DISTINCT tabela FROM campos_importacao WHERE tabela IS NOT NULL AND tabela != '' ORDER BY tabela ASC"
    ).catch(() => [[]]);
    let tabelas = rows.map((r) => String(r.tabela || '').trim()).filter(Boolean);
    if (!tabelas.includes('produto')) tabelas = ['produto', ...tabelas.filter((t) => t !== 'produto')];
    if (tabelas.length === 0) tabelas = ['produto'];
    res.json({ ok: true, tabelas });
  } catch (err) {
    console.error('[importacao-precos/campos-tabelas]', err);
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// ─── POST /campos-salvar — cria ou atualiza registro em campos_importacao ────
router.post('/campos-salvar', async (req, res) => {
  const tabela = String(req.body.tabela ?? 'produto').trim();
  const nome_campo = String(req.body.nome_campo ?? '').trim();
  const apelido = String(req.body.apelido ?? '').trim();
  const tipo = String(req.body.tipo ?? 'texto').trim() || 'texto';
  const ordem = parseInt(String(req.body.ordem ?? '0'), 10);
  const ordemSafe = Number.isFinite(ordem) ? ordem : 0;
  const obrigatorio = req.body.obrigatorio === 'S' || req.body.obrigatorio === true ? 'S' : 'N';
  const excluido = req.body.excluido === 'S' || req.body.excluido === true ? 'S' : 'N';
  const rawId = req.body.id;
  const id = rawId != null && rawId !== '' ? parseInt(String(rawId), 10) : null;
  const idSafe = id && id > 0 ? id : null;

  if (!tabela || !nome_campo) {
    return res.json({ ok: false, msg: 'Tabela e nome do campo são obrigatórios.' });
  }

  try {
    const pool = getPool();
    if (idSafe) {
      await pool.query(
        `UPDATE campos_importacao
         SET tabela=?, nome_campo=?, apelido=?, tipo=?, ordem=?, obrigatorio=?, excluido=?
         WHERE id=?`,
        [tabela, nome_campo, apelido, tipo, ordemSafe, obrigatorio, excluido, idSafe]
      );
      return res.json({ ok: true, msg: 'Campo atualizado.' });
    }
    const [ins] = await pool.query(
      `INSERT INTO campos_importacao (tabela, nome_campo, apelido, tipo, ordem, obrigatorio, excluido)
       VALUES (?,?,?,?,?,?,?)`,
      [tabela, nome_campo, apelido, tipo, ordemSafe, obrigatorio, excluido]
    );
    res.json({ ok: true, msg: 'Campo criado.', id: ins.insertId });
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.json({ ok: false, msg: 'Já existe um campo com esse nome para esta tabela.' });
    }
    console.error('[importacao-precos/campos-salvar]', err);
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// ─── POST /campos-toggle-excluido ─────────────────────────────────────────────
router.post('/campos-toggle-excluido', async (req, res) => {
  const id = parseInt(String(req.body.id ?? ''), 10);
  if (!id || id < 1) return res.json({ ok: false, msg: 'ID inválido.' });
  try {
    const pool = getPool();
    const [rows] = await pool.query('SELECT excluido FROM campos_importacao WHERE id=?', [id]);
    if (!rows.length) return res.json({ ok: false, msg: 'Campo não encontrado.' });
    const novo = String(rows[0].excluido ?? 'N').trim().toUpperCase() === 'S' ? 'N' : 'S';
    await pool.query('UPDATE campos_importacao SET excluido=? WHERE id=?', [novo, id]);
    res.json({ ok: true, excluido: novo });
  } catch (err) {
    console.error('[importacao-precos/campos-toggle-excluido]', err);
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// ─── POST /campos-deletar — remoção permanente ────────────────────────────────
router.post('/campos-deletar', async (req, res) => {
  const id = parseInt(String(req.body.id ?? ''), 10);
  if (!id || id < 1) return res.json({ ok: false, msg: 'ID inválido.' });
  try {
    const pool = getPool();
    await pool.query('DELETE FROM campos_importacao WHERE id=?', [id]);
    res.json({ ok: true, msg: 'Campo removido.' });
  } catch (err) {
    console.error('[importacao-precos/campos-deletar]', err);
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// ─── POST /verificar-lote ────────────────────────────────────────────────────
router.post('/verificar-lote', async (req, res) => {
  const cod_fornecedor = String(req.body.cod_fornecedor ?? '').trim();
  const rows = req.body.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.json({ ok: false, msg: 'Nenhuma linha enviada.' });
  }

  try {
    const pool = getPool();
    const { chaveCodFabricante, normalizarCodFabricante } = require('../config/produto-cod-fabricante');
    const resultado = [];

    const temCodigo = rows.some((r) => normalizarCodFabricante(r.cod_fabricante) !== '');
    if (!temCodigo) {
      for (let idx = 0; idx < rows.length; idx++) {
        resultado.push({ idx, status_cadastro: 'N', status: 'SC', cod_produto: '', msg: 'cod_fabricante vazio' });
      }
      return res.json({ ok: true, resultado });
    }

    // Indexa produtos do fornecedor pela chave normalizada (0002 = 2; excluido NULL ok).
    const { getProdTabela } = require('../config/produto-colunas');
    const tbProd = await getProdTabela(pool);
    let sql = `SELECT p.id, p.cod_fabricante, p.cod_fornecedorpadrao
               FROM \`${tbProd}\` p
               WHERE (p.excluido = 'N' OR p.excluido IS NULL OR p.excluido = '')
               AND TRIM(IFNULL(p.cod_fabricante,'')) <> ''`;
    const params = [];
    if (cod_fornecedor !== '') {
      sql += ' AND p.cod_fornecedorpadrao = ?';
      params.push(cod_fornecedor);
    }
    const [prodRows] = await pool.query(sql, params);
    const produtosBanco = {};
    for (const row of prodRows) {
      const k = chaveCodFabricante(row.cod_fabricante);
      if (k && !produtosBanco[k]) produtosBanco[k] = row;
    }

    const { checarGradeImport } = require('../config/produto-grade-import');
    const { checarLookupsImportLinha } = require('../config/produto-lookup-import');
    // Cache interno de checarGradeImport (1 load de tipograde por lote)
    const gradeCache = new Map();
    async function statusGradeLinha(valor) {
      const key = String(valor ?? '').trim();
      if (!key) return { grade_status: '', grade_nova: false };
      if (gradeCache.has(key)) return gradeCache.get(key);
      const gCheck = await checarGradeImport(pool, key);
      let out = { grade_status: '', grade_nova: false };
      if (!gCheck.vazia) {
        if (gCheck.existe) out = { grade_status: 'ok', grade_nova: false };
        else if (gCheck.idInexistente) out = { grade_status: 'id_invalido', grade_nova: true };
        else out = { grade_status: 'nova', grade_nova: true };
      }
      gradeCache.set(key, out);
      return out;
    }

    // Cache de checagem de auxiliares (mesmo texto = mesmo status)
    const auxCache = new Map();
    async function statusAuxLinha(row) {
      const payload = {
        subfamilia: row.subfamilia,
        unidade: row.unidade,
        tipoprodutograde: row.tipoprodutograde || row.tipo_grade,
        tipo_grade: row.tipo_grade || row.tipoprodutograde,
        grupo: row.grupo || row.nome_grupo,
        nome_grupo: row.nome_grupo || row.grupo,
        local: row.local || row.local_armazenamento,
        local_armazenamento: row.local_armazenamento || row.local,
        segmento: row.segmento || row.categoria,
        categoria: row.categoria || row.segmento,
        familia: row.familia,
      };
      const cacheKey = JSON.stringify(payload);
      if (auxCache.has(cacheKey)) return auxCache.get(cacheKey);
      let aux = {};
      try {
        aux = await checarLookupsImportLinha(pool, payload);
      } catch (e) {
        console.warn('[verificar-lote] auxiliares:', e.message);
        aux = {};
      }
      auxCache.set(cacheKey, aux);
      return aux;
    }

    for (const row of rows) {
      const idx = row.idx;
      const cf = normalizarCodFabricante(row.cod_fabricante);
      if (cf === '') {
        const auxiliaresVazio = await statusAuxLinha(row);
        resultado.push({
          idx,
          status_cadastro: 'N',
          status: 'SC',
          cod_produto: '',
          msg: 'cod_fabricante vazio',
          grade_status: '',
          grade_nova: false,
          auxiliares: auxiliaresVazio,
        });
        continue;
      }
      const hit = produtosBanco[chaveCodFabricante(cf)];
      const existeNoBanco = !!hit;
      const gSt = await statusGradeLinha(row.grade);
      const auxiliares = await statusAuxLinha(row);

      resultado.push({
        idx,
        status_cadastro: existeNoBanco ? 'S' : 'N',
        status: existeNoBanco ? 'A' : 'SC',
        cod_produto: existeNoBanco ? String(hit.id) : '',
        msg: '',
        grade_status: gSt.grade_status,
        grade_nova: gSt.grade_nova,
        auxiliares,
      });
    }

    res.json({ ok: true, resultado });
  } catch (err) {
    console.error('[importacao-precos/verificar-lote]', err);
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// ─── GET /import-preco-context — tabelas vinculadas ao fornecedor + tabela padrão ─
router.get('/import-preco-context', async (req, res) => {
  const idFornecedor = parseInt(String(req.query.fornecedor_id ?? ''), 10);
  try {
    const pool = getPool();
    await ensureTabelaPadraoCols(pool);

    if (!idFornecedor) {
      return res.json({
        ok: true,
        tabelas_vinculadas: [],
        tabela_padrao_auto: null,
        possui_vinculo: false
      });
    }

    const [tabelas] = await pool
      .query(
        `SELECT c.id, c.Descricao AS descricao, c.Tabela_Ativa
       FROM tabela_preco_vinculo v
       JOIN tabela_preco_cabecalho c ON c.id = v.id_tabela
       WHERE v.id_entidade = ? AND v.tipo_entidade = 'FORNECEDOR'
       AND (v.excluido = 'N' OR v.excluido IS NULL)
       AND c.excluido = 'N' AND c.Tabela_Ativa = 'S'
       ORDER BY c.Descricao`,
        [idFornecedor]
      )
      .catch(() => [[]]);

    const [tpad] = await pool
      .query(
        `SELECT id, Descricao AS descricao,
              COALESCE(tabela_padrao,'N') AS tabela_padrao,
              COALESCE(atualizar_tabelapadrao,'N') AS atualizar_tabelapadrao
       FROM tabela_preco_cabecalho
       WHERE excluido = 'N' AND Tabela_Ativa = 'S'
       AND UPPER(COALESCE(tabela_padrao,'N')) = 'S'
       AND UPPER(COALESCE(atualizar_tabelapadrao,'N')) = 'S'
       LIMIT 1`
      )
      .catch(() => [[]]);

    res.json({
      ok: true,
      tabelas_vinculadas: (tabelas || []).map((t) => ({
        id: t.id,
        descricao: t.descricao
      })),
      tabela_padrao_auto: tpad[0]
        ? {
            id: tpad[0].id,
            descricao: tpad[0].descricao
          }
        : null,
      possui_vinculo: Array.isArray(tabelas) && tabelas.length > 0
    });
  } catch (err) {
    console.error('[importacao-precos/import-preco-context]', err);
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// ─── POST /salvar-atualizacao-preco — cabeçalho do lote ──────────────────────
router.post('/salvar-atualizacao-preco', async (req, res) => {
  const descricao = String(req.body.descricao ?? '').trim();
  const id_usuario = String(req.body.id_usuario ?? req.user?.id ?? '').trim() || '1';

  if (!descricao) {
    return res.json({ ok: false, msg: 'Descrição é obrigatória.' });
  }

  try {
    const pool = getPool();
    const [[rowNum]] = await pool.query(
      'SELECT COALESCE(MAX(numero), 0) + 1 AS proximo FROM atualizacaopreco'
    ).catch(() => [[{ proximo: 1 }]]);
    const numero = rowNum?.proximo ?? 1;

    const [ins] = await pool.query(
      `INSERT INTO atualizacaopreco (descricao, numero, data, id_usuario)
       VALUES (?, ?, NOW(), ?)`,
      [descricao, numero, id_usuario]
    );
    res.json({ ok: true, id: ins.insertId, numero });
  } catch (err) {
    console.error('[importacao-precos/salvar-atualizacao-preco]', err);
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// ─── POST /importar-linha ────────────────────────────────────────────────────
router.post('/importar-linha', async (req, res) => {
  const cod_fornecedor = String(req.body.cod_fornecedor ?? '').trim();
  const status_cadastro = String(req.body.status_cadastro ?? 'N').trim();
  const cod_produto = String(req.body.cod_produto ?? '').trim();
  const modo_tabela =
    req.body.modo_tabela_preco === true ||
    req.body.modo_tabela_preco === 1 ||
    req.body.modo_tabela_preco === '1' ||
    req.body.modo_tabela_preco === 'true';
  const preco_referencia_import = String(req.body.preco_referencia_import ?? '').trim();

  let campos = req.body.campos;
  if (typeof campos === 'string') {
    try {
      campos = JSON.parse(campos);
    } catch {
      campos = {};
    }
  }
  if (!campos || typeof campos !== 'object') {
    return res.json({ ok: false, msg: 'Nenhum campo mapeado para importar.' });
  }

  const tabelaUpdatesRaw = parseTabelaPrecosUpdates(req.body);

  const pool = getPool();
  let conn;
  try {
    await ensureTabelaPadraoCols(pool);
    await ensureDefaultCamposProduto(pool);
    const { ensureProdutoColunas } = require('../config/produto-colunas');
    await ensureProdutoColunas(pool);
    // Bases legadas podem ter preco/valor_tabela como INT → grava decimal falha.
    // Converte p/ DECIMAL(15,2) na 1ª importação (cacheado por base).
    await ensureTabelaPrecoItensDecimal(pool).catch(() => {});
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [validRows] = await conn
      .query(`SELECT nome_campo, COALESCE(tipo,'texto') AS tipo FROM campos_importacao WHERE tabela='produto' AND excluido='N'`)
      .catch(() => [[]]);
    let camposValidos = validRows.map((r) => r.nome_campo);
    if (!camposValidos.includes('vlrcustofinalVenda')) camposValidos.push('vlrcustofinalVenda');
    if (!camposValidos.includes('vlr_venda')) camposValidos.push('vlr_venda');

    // Mapa tipo por campo vindo do banco (decimal/moeda/inteiro)
    const _tipoMap = {};
    for (const r of validRows) _tipoMap[r.nome_campo] = r.tipo;

    const dadosParaSalvar = {};
    const { normalizarCodFabricante: _normCfSave, buscarDuplicataCodFabricanteFornecedor } = require('../config/produto-cod-fabricante');
    for (const [campo, valor] of Object.entries(campos)) {
      if (camposValidos.includes(campo)) {
        let strVal = valor == null ? '' : String(valor);
        if (campo === 'cod_fabricante') strVal = _normCfSave(strVal) || strVal;
        dadosParaSalvar[campo] = /^https?:\/\//i.test(strVal.trim()) ? strVal.trim() : strVal.toUpperCase();
      }
    }

    let statusCadastroEfetivo = status_cadastro;
    let codProdutoEfetivo = cod_produto;

    if (modo_tabela) {
      stripPrecosProduto(dadosParaSalvar);
    }

    // Campos numéricos: estáticos (CAMPOS_NUMERICOS) + dinâmicos do banco (tipo decimal/moeda/inteiro)
    const _camposDecimais = new Set([...CAMPOS_NUMERICOS]);
    const _camposInteiros = new Set([...CAMPOS_INTEIROS_FIXOS]);
    for (const [nc, tp] of Object.entries(_tipoMap)) {
      if (tp === 'inteiro') { _camposInteiros.add(nc); _camposDecimais.delete(nc); }
      else if (tp === 'decimal' || tp === 'moeda') { if (!_camposInteiros.has(nc)) _camposDecimais.add(nc); }
    }

    // Inteiros primeiro (sobrescreve decimal se mesmo campo)
    for (const cn of _camposInteiros) {
      if (!Object.prototype.hasOwnProperty.call(dadosParaSalvar, cn)) continue;
      const raw = String(dadosParaSalvar[cn]).replace(',', '.').trim();
      if (!raw) { delete dadosParaSalvar[cn]; continue; }
      const num = parseInt(raw, 10);
      dadosParaSalvar[cn] = Number.isFinite(num) ? String(num) : '0';
      _camposDecimais.delete(cn); // evitar reprocessar
    }

    for (const cn of _camposDecimais) {
      if (!Object.prototype.hasOwnProperty.call(dadosParaSalvar, cn)) continue;
      const raw = String(dadosParaSalvar[cn]).replace(',', '.').trim();
      if (!raw) {
        // só campos monetários (preços) gravam 0 quando vazio — decimal/estoque ignoram
        if ((_tipoMap[cn] || '') === 'moeda') dadosParaSalvar[cn] = '0';
        else delete dadosParaSalvar[cn];
        continue;
      }
      const num = parseFloat(raw);
      dadosParaSalvar[cn] = isFinite(num) ? String(num) : '0';
    }
    for (const cd of CAMPOS_DATA) {
      if (Object.prototype.hasOwnProperty.call(dadosParaSalvar, cd)) {
        const norm = normalizarData(dadosParaSalvar[cd]);
        if (norm) dadosParaSalvar[cd] = norm;
        else delete dadosParaSalvar[cd];
      }
    }

    // precopeso aceita apenas 'S' ou 'N'
    if (Object.prototype.hasOwnProperty.call(dadosParaSalvar, 'precopeso')) {
      const pp = String(dadosParaSalvar.precopeso).toUpperCase().trim();
      dadosParaSalvar.precopeso = ['S', 'SIM', 'YES', 'TRUE', '1'].includes(pp) ? 'S' : 'N';
    }

    // multiplo_venda deve ser no mínimo 1 (só normaliza se veio com valor)
    if (Object.prototype.hasOwnProperty.call(dadosParaSalvar, 'multiplo_venda')) {
      const mv = parseInt(dadosParaSalvar.multiplo_venda, 10);
      if (Number.isFinite(mv) && mv >= 1) {
        dadosParaSalvar.multiplo_venda = String(mv);
      } else {
        delete dadosParaSalvar.multiplo_venda;
      }
    }

    if (Object.prototype.hasOwnProperty.call(dadosParaSalvar, 'qtd_minima_pedido')) {
      const qm = parseInt(dadosParaSalvar.qtd_minima_pedido, 10);
      if (Number.isFinite(qm) && qm >= 0) {
        dadosParaSalvar.qtd_minima_pedido = String(qm);
      } else {
        delete dadosParaSalvar.qtd_minima_pedido;
      }
    }

    /**
     * Campo virtual "Referência mãe" → id_referencia.
     * Importe as mães antes das cores. Valor: ID ou Cód. Fabricante da mãe.
     * Célula vazia desvincula. Não grava coluna referencia_mae.
     */
    async function aplicarReferenciaMaeImport(excludeId) {
      if (!Object.prototype.hasOwnProperty.call(dadosParaSalvar, 'referencia_mae')) {
        return { ok: true };
      }
      const rawMae = dadosParaSalvar.referencia_mae;
      delete dadosParaSalvar.referencia_mae;
      const { resolverReferenciaMaeImport, ensureProdutoReferenciaCol } = require('../config/produto-referencia');
      await ensureProdutoReferenciaCol(conn);
      let idForn = dadosParaSalvar.cod_fornecedorpadrao ?? cod_fornecedor;
      if (excludeId && (idForn === undefined || idForn === '')) {
        const tb = await getProdTabela(conn);
        const [[cur]] = await conn.query(
          `SELECT cod_fornecedorpadrao FROM \`${tb}\` WHERE id = ? LIMIT 1`,
          [excludeId]
        ).catch(() => [[null]]);
        if (cur) idForn = cur.cod_fornecedorpadrao;
      }
      const r = await resolverReferenciaMaeImport(conn, {
        valor: rawMae,
        idFornecedor: idForn,
        idProduto: excludeId || null,
      });
      if (!r.ok) return r;
      dadosParaSalvar.id_referencia = r.id_referencia;
      return { ok: true };
    }

    /**
     * Campo virtual "Grade" → tipograde (id).
     * Aceita nome/apelido (P/M/G/GG), tamanhos iguais aos da grade, ou id numérico.
     * Célula vazia: não altera. Se não existir, cria a grade + tamanhos e vincula.
     */
    async function aplicarGradeImport() {
      if (!Object.prototype.hasOwnProperty.call(dadosParaSalvar, 'grade')) {
        return { ok: true };
      }
      const rawGrade = dadosParaSalvar.grade;
      delete dadosParaSalvar.grade;
      const { resolverGradeImport } = require('../config/produto-grade-import');
      const r = await resolverGradeImport(conn, rawGrade);
      if (!r.ok) return r;
      if (r.id !== undefined) dadosParaSalvar.tipograde = String(r.id);
      return { ok: true };
    }

    /** Grupo, subfamília, unidade, tipo grade, local, categoria, família — cria se não existir. */
    async function aplicarLookupsAuxImport() {
      const { aplicarLookupsImportProduto } = require('../config/produto-lookup-import');
      return aplicarLookupsImportProduto(conn, dadosParaSalvar);
    }

    // Auto-cria categoria se o segmento importado não existir na tabela categoria
    if (dadosParaSalvar.segmento && dadosParaSalvar.segmento.trim()) {
      const segVal = dadosParaSalvar.segmento.trim();
      const [[catExist]] = await conn.query(
        `SELECT id FROM categoria WHERE descricao = ? AND excluido = 'N' LIMIT 1`, [segVal]
      ).catch(() => [[null]]);
      if (!catExist) {
        await conn.query(
          `INSERT IGNORE INTO categoria (descricao, status, excluido) VALUES (?, 'A', 'N')`, [segVal]
        ).catch(() => {});
      }
    }

    const metaTabela = getMetaProdutoTabela(campos);
    const idTabelaPadrao = modo_tabela ? await obterIdTabelaPadraoAuto(conn) : null;

    // Fornecedor padrão + resolve produto existente ANTES de decidir INSERT/UPDATE.
    // Importação NÃO bloqueia por unicidade: se o código já existe, atualiza.
    // Bases com duplicata legada (2 IDs, mesmo cód.) atualizam o alvo resolvido.
    if (cod_fornecedor && !Object.prototype.hasOwnProperty.call(dadosParaSalvar, 'cod_fornecedorpadrao')) {
      dadosParaSalvar.cod_fornecedorpadrao = cod_fornecedor;
    }
    // Garante cód. fabricante mesmo se o campo não estiver em campos_importacao
    if (!dadosParaSalvar.cod_fabricante && campos.cod_fabricante != null && String(campos.cod_fabricante).trim() !== '') {
      dadosParaSalvar.cod_fabricante = _normCfSave(campos.cod_fabricante) || String(campos.cod_fabricante).trim();
      if (!/^https?:\/\//i.test(String(dadosParaSalvar.cod_fabricante))) {
        dadosParaSalvar.cod_fabricante = String(dadosParaSalvar.cod_fabricante).toUpperCase();
      }
    }
    {
      const { chaveCodFabricante, parseIdFornecedor } = require('../config/produto-cod-fabricante');
      const { listProdutoColunas } = require('../config/produto-colunas');
      const cfBusca = dadosParaSalvar.cod_fabricante || campos.cod_fabricante;
      const idFornBusca = dadosParaSalvar.cod_fornecedorpadrao || cod_fornecedor;
      const tbResolve = await getProdTabela(conn);
      let resolvido = null;

      // Prefere o id da validação se ainda bate código+fornecedor
      const idPref = parseInt(codProdutoEfetivo || cod_produto, 10);
      if (idPref > 0 && cfBusca) {
        const [[cur]] = await conn.query(
          `SELECT id, cod_fabricante, cod_fornecedorpadrao FROM \`${tbResolve}\` WHERE id = ? LIMIT 1`,
          [idPref]
        ).catch(() => [[null]]);
        if (
          cur &&
          chaveCodFabricante(cur.cod_fabricante) === chaveCodFabricante(cfBusca) &&
          parseIdFornecedor(cur.cod_fornecedorpadrao) === parseIdFornecedor(idFornBusca)
        ) {
          resolvido = String(cur.id);
        }
      }
      if (!resolvido) {
        const dup = await buscarDuplicataCodFabricanteFornecedor(conn, {
          codFabricante: cfBusca,
          idFornecedor: idFornBusca,
        });
        if (dup && dup.id) resolvido = String(dup.id);
      }
      if (resolvido) {
        statusCadastroEfetivo = 'S';
        codProdutoEfetivo = resolvido;
      }

      // Só colunas reais — mantém virtuais até aplicarLookups/grade/ref
      const VIRTUAIS_IMPORT = new Set([
        'grade', 'referencia_mae', 'grupo', 'familia', 'categoria',
        'local', 'local_armazenamento', 'tipo_grade', 'nome_grupo',
      ]);
      const colsReais = new Set((await listProdutoColunas(conn)).map((c) => String(c).toLowerCase()));
      for (const k of Object.keys(dadosParaSalvar)) {
        if (VIRTUAIS_IMPORT.has(k)) continue;
        if (!colsReais.has(String(k).toLowerCase())) delete dadosParaSalvar[k];
      }
    }

    if (statusCadastroEfetivo === 'S' && codProdutoEfetivo) {
      const cod_produto = codProdutoEfetivo;
      const tbProd = await getProdTabela(conn);
      const refMaeUp = await aplicarReferenciaMaeImport(cod_produto);
      if (!refMaeUp.ok) {
        await conn.rollback();
        conn.release();
        return res.json({ ok: false, msg: refMaeUp.error });
      }

      const gradeUp = await aplicarGradeImport();
      if (!gradeUp.ok) {
        await conn.rollback();
        conn.release();
        return res.json({ ok: false, msg: gradeUp.error });
      }

      const auxUp = await aplicarLookupsAuxImport();
      if (!auxUp.ok) {
        await conn.rollback();
        conn.release();
        return res.json({ ok: false, msg: auxUp.error });
      }

      // Re-filtra após grade/ref (tipograde/id_referencia entram; virtuais saem)
      {
        const { listProdutoColunas } = require('../config/produto-colunas');
        const colsReais = new Set((await listProdutoColunas(conn)).map((c) => String(c).toLowerCase()));
        delete dadosParaSalvar.grade;
        delete dadosParaSalvar.referencia_mae;
        for (const k of Object.keys(dadosParaSalvar)) {
          if (!colsReais.has(String(k).toLowerCase())) delete dadosParaSalvar[k];
        }
      }

      if (Object.keys(dadosParaSalvar).length === 0 && (!modo_tabela || tabelaUpdatesRaw.length === 0)) {
        await conn.rollback();
        conn.release();
        return res.json({ ok: false, msg: 'Nenhum campo válido para salvar.' });
      }

      const cols = Object.keys(dadosParaSalvar).filter((c) => c !== 'id');

      // Captura saldo anterior ANTES de atualizar (para o movimento_estoque)
      let saldoAnterior = null;
      const atualizaEstoque = Object.prototype.hasOwnProperty.call(dadosParaSalvar, 'estoque_atual');
      if (atualizaEstoque) {
        const [[prodAtual]] = await conn.query(
          `SELECT IFNULL(estoque_atual,0) AS estoque_atual, descricao FROM \`${tbProd}\` WHERE id = ? LIMIT 1`,
          [cod_produto]
        ).catch(() => [[null]]);
        saldoAnterior = prodAtual ? parseFloat(prodAtual.estoque_atual) : 0;
      }

      if (cols.length > 0) {
        const setParts = cols.map((c) => `\`${c}\` = ?`);
        const vals = cols.map((c) => dadosParaSalvar[c]);
        vals.push(cod_produto);
        await conn.query(
          `UPDATE \`${tbProd}\` SET ${setParts.join(', ')},
         dt_atualizacao = NOW(), situacao = 'A', excluido = 'N'
         WHERE id = ?`,
          vals
        );
      }

      // Registra movimento de AJUSTE no histórico de estoque
      if (atualizaEstoque && saldoAnterior !== null) {
        const novoSaldo = parseFloat(dadosParaSalvar.estoque_atual) || 0;
        const { hojeIsoBrasil, horaBrasil } = require('../config/date-brasil');
        await conn.query(
          `CREATE TABLE IF NOT EXISTS movimento_estoque (
            id INT AUTO_INCREMENT PRIMARY KEY,
            cod_produto INT NOT NULL, desc_produto VARCHAR(200),
            tipo_movimento VARCHAR(20) NOT NULL, quantidade DECIMAL(15,4) NOT NULL,
            saldo_anterior DECIMAL(15,4) DEFAULT 0, saldo_posterior DECIMAL(15,4) DEFAULT 0,
            id_pedido INT NULL, numero_pedido VARCHAR(50) NULL,
            id_usuario INT NULL, nome_usuario VARCHAR(100) NULL,
            observacao VARCHAR(500) NULL, nota_fiscal VARCHAR(60) NULL,
            chave_nfe VARCHAR(44) NULL, fornecedor_nome VARCHAR(150) NULL,
            data_movimento DATE NOT NULL, hora_movimento TIME NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_me_produto (cod_produto), INDEX idx_me_data (data_movimento)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3`
        ).catch(() => {});
        await conn.query(
          `INSERT INTO movimento_estoque
           (cod_produto, tipo_movimento, quantidade, saldo_anterior, saldo_posterior,
            id_usuario, observacao, data_movimento, hora_movimento)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [
            parseInt(cod_produto),
            'AJUSTE',
            Math.abs(novoSaldo - saldoAnterior),
            saldoAnterior,
            novoSaldo,
            req.user?.id || null,
            'Ajuste via importação de planilha',
            hojeIsoBrasil(),
            horaBrasil(),
          ]
        ).catch(() => {});
      }

      let ups = tabelaUpdatesRaw;
      if (modo_tabela && ups.length) {
        await aplicarTabelaPrecoUpserts(conn, cod_produto, metaTabela, ups);
      }

      await conn.commit();
      conn.release();
      return res.json({ ok: true, operacao: 'UPDATE', msg: 'Produto atualizado.' });
    }

    // Última chance: código apareceu entre a resolução e aqui → UPDATE, nunca erro «Já existe»
    {
      const dupLate = await buscarDuplicataCodFabricanteFornecedor(conn, {
        codFabricante: dadosParaSalvar.cod_fabricante || campos.cod_fabricante,
        idFornecedor: dadosParaSalvar.cod_fornecedorpadrao || cod_fornecedor,
      });
      if (dupLate && dupLate.id) {
        statusCadastroEfetivo = 'S';
        codProdutoEfetivo = String(dupLate.id);
        // Reentra no fluxo de UPDATE via redirect interno
        const tbProd = await getProdTabela(conn);
        const refMaeUp = await aplicarReferenciaMaeImport(codProdutoEfetivo);
        if (!refMaeUp.ok) {
          await conn.rollback();
          conn.release();
          return res.json({ ok: false, msg: refMaeUp.error });
        }
        const gradeUp = await aplicarGradeImport();
        if (!gradeUp.ok) {
          await conn.rollback();
          conn.release();
          return res.json({ ok: false, msg: gradeUp.error });
        }
        const auxLate = await aplicarLookupsAuxImport();
        if (!auxLate.ok) {
          await conn.rollback();
          conn.release();
          return res.json({ ok: false, msg: auxLate.error });
        }
        delete dadosParaSalvar.grade;
        delete dadosParaSalvar.referencia_mae;
        delete dadosParaSalvar.grupo;
        delete dadosParaSalvar.familia;
        delete dadosParaSalvar.categoria;
        delete dadosParaSalvar.local;
        delete dadosParaSalvar.local_armazenamento;
        delete dadosParaSalvar.tipo_grade;
        const { listProdutoColunas } = require('../config/produto-colunas');
        const colsReais = new Set((await listProdutoColunas(conn)).map((c) => String(c).toLowerCase()));
        for (const k of Object.keys(dadosParaSalvar)) {
          if (!colsReais.has(String(k).toLowerCase())) delete dadosParaSalvar[k];
        }
        const cols = Object.keys(dadosParaSalvar).filter((c) => c !== 'id');
        if (cols.length > 0) {
          const setParts = cols.map((c) => `\`${c}\` = ?`);
          const vals = cols.map((c) => dadosParaSalvar[c]);
          vals.push(codProdutoEfetivo);
          await conn.query(
            `UPDATE \`${tbProd}\` SET ${setParts.join(', ')}, dt_atualizacao = NOW(), situacao = 'A', excluido = 'N' WHERE id = ?`,
            vals
          );
        }
        let ups = tabelaUpdatesRaw;
        if (modo_tabela && ups.length) {
          await aplicarTabelaPrecoUpserts(conn, String(codProdutoEfetivo), metaTabela, ups);
        }
        await conn.commit();
        conn.release();
        return res.json({ ok: true, operacao: 'UPDATE', msg: 'Produto atualizado (código já existia).', id: codProdutoEfetivo });
      }
    }

    if (modo_tabela) {
      zerarPrecosProdutoInsert(dadosParaSalvar);
    }

    const refMaeIns = await aplicarReferenciaMaeImport(null);
    if (!refMaeIns.ok) {
      await conn.rollback();
      conn.release();
      return res.json({ ok: false, msg: refMaeIns.error });
    }

    const gradeIns = await aplicarGradeImport();
    if (!gradeIns.ok) {
      await conn.rollback();
      conn.release();
      return res.json({ ok: false, msg: gradeIns.error });
    }

    const auxIns = await aplicarLookupsAuxImport();
    if (!auxIns.ok) {
      await conn.rollback();
      conn.release();
      return res.json({ ok: false, msg: auxIns.error });
    }

    delete dadosParaSalvar.grade;
    delete dadosParaSalvar.referencia_mae;
    delete dadosParaSalvar.grupo;
    delete dadosParaSalvar.familia;
    delete dadosParaSalvar.categoria;
    delete dadosParaSalvar.local;
    delete dadosParaSalvar.local_armazenamento;
    delete dadosParaSalvar.tipo_grade;
    {
      const { listProdutoColunas } = require('../config/produto-colunas');
      const colsReais = new Set((await listProdutoColunas(conn)).map((c) => String(c).toLowerCase()));
      for (const k of Object.keys(dadosParaSalvar)) {
        if (!colsReais.has(String(k).toLowerCase())) delete dadosParaSalvar[k];
      }
    }

    if (Object.keys(dadosParaSalvar).length === 0) {
      await conn.rollback();
      conn.release();
      return res.json({ ok: false, msg: 'Nenhum campo válido para salvar.' });
    }
    if (!Object.prototype.hasOwnProperty.call(dadosParaSalvar, 'dt_cadastro')) {
      const _h = new Date();
      dadosParaSalvar.dt_cadastro = `${_h.getFullYear()}-${String(_h.getMonth()+1).padStart(2,'0')}-${String(_h.getDate()).padStart(2,'0')}`;
    }
    if (!Object.prototype.hasOwnProperty.call(dadosParaSalvar, 'origem')) {
      dadosParaSalvar.origem = 'ATUALIZACAO ONLINE';
    }
    dadosParaSalvar.excluido = 'N';

    const tbProdIns = await getProdTabela(conn);
    const insertCols = Object.keys(dadosParaSalvar);
    const placeholders = insertCols.map(() => '?').join(',');
    const insertVals = insertCols.map((c) => dadosParaSalvar[c]);
    const colList = insertCols.map((c) => `\`${c}\``).join(', ');
    const [ins] = await conn.query(
      `INSERT INTO \`${tbProdIns}\` (${colList}) VALUES (${placeholders})`,
      insertVals
    );
    const novoId = ins.insertId;
    await conn.query(`UPDATE \`${tbProdIns}\` SET cod_interno = ? WHERE id = ?`, [String(novoId), novoId]);

    if (modo_tabela) {
      let ups = tabelaUpdatesRaw;
      ups = mergeTabelaPadraoEmUpdates(ups, idTabelaPadrao, true, preco_referencia_import);
      if (ups.length) {
        await aplicarTabelaPrecoUpserts(conn, String(novoId), metaTabela, ups);
      }
    }

    await conn.commit();
    conn.release();
    res.json({ ok: true, operacao: 'INSERT', novo_id: novoId, msg: 'Produto inserido.' });
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch (_) {}
      conn.release();
    }
    console.error('[importacao-precos/importar-linha]', err);
    res.json({ ok: false, msg: err.message });
  }
});

/**
 * Inativa produtos ativos do fornecedor cujo cod_fabricante NÃO está na planilha.
 * dry_run (confirmar=false): só conta. confirmar=true: grava situacao='I'.
 * Segurança: planilha sem códigos → bloqueia; não faz soft-delete (excluido).
 */
router.post('/inativar-fora-planilha', async (req, res) => {
  const cod_fornecedor = String(req.body.cod_fornecedor ?? '').trim();
  const confirmar = req.body.confirmar === true || req.body.confirmar === 1 || req.body.confirmar === '1';
  let codigos = req.body.codigos_planilha;
  if (typeof codigos === 'string') {
    try { codigos = JSON.parse(codigos); } catch { codigos = []; }
  }
  if (!Array.isArray(codigos)) codigos = [];

  if (!cod_fornecedor) {
    return res.json({ ok: false, msg: 'Fornecedor obrigatório.' });
  }

  const uniq = [...new Set(
    codigos
      .map((c) => String(c ?? '').trim().toUpperCase())
      .filter((c) => c !== '')
  )];
  if (uniq.length === 0) {
    return res.json({
      ok: false,
      msg: 'Planilha sem códigos de fabricante — inativação cancelada por segurança.',
    });
  }

  try {
    const pool = getPool();
    const sqlAtivos = `
      SELECT COUNT(*) AS n FROM produto
      WHERE cod_fornecedorpadrao = ?
        AND (excluido = 'N' OR excluido IS NULL OR excluido = '')
        AND (situacao = 'A' OR situacao IS NULL OR situacao = '')
    `;
    const [[totRow]] = await pool.query(sqlAtivos, [cod_fornecedor]);
    const totalAtivos = parseInt(String(totRow?.n ?? 0), 10) || 0;

    const placeholders = uniq.map(() => '?').join(',');
    const sqlCandidatos = `
      SELECT COUNT(*) AS n FROM produto
      WHERE cod_fornecedorpadrao = ?
        AND (excluido = 'N' OR excluido IS NULL OR excluido = '')
        AND (situacao = 'A' OR situacao IS NULL OR situacao = '')
        AND TRIM(IFNULL(cod_fabricante,'')) <> ''
        AND UPPER(TRIM(cod_fabricante)) NOT IN (${placeholders})
    `;
    const [[candRow]] = await pool.query(sqlCandidatos, [cod_fornecedor, ...uniq]);
    const qtd = parseInt(String(candRow?.n ?? 0), 10) || 0;
    const riscoAlto = totalAtivos > 0 && qtd > Math.max(10, Math.floor(totalAtivos * 0.5));

    if (!confirmar) {
      return res.json({
        ok: true,
        dry_run: true,
        qtd,
        total_ativos: totalAtivos,
        codigos_planilha: uniq.length,
        risco_alto: riscoAlto,
      });
    }

    if (qtd === 0) {
      return res.json({ ok: true, inativados: 0, qtd: 0, total_ativos: totalAtivos });
    }

    const [upd] = await pool.query(
      `UPDATE produto SET situacao = 'I', dt_atualizacao = NOW()
       WHERE cod_fornecedorpadrao = ?
         AND (excluido = 'N' OR excluido IS NULL OR excluido = '')
         AND (situacao = 'A' OR situacao IS NULL OR situacao = '')
         AND TRIM(IFNULL(cod_fabricante,'')) <> ''
         AND UPPER(TRIM(cod_fabricante)) NOT IN (${placeholders})`,
      [cod_fornecedor, ...uniq]
    );

    res.json({
      ok: true,
      inativados: upd.affectedRows || 0,
      qtd,
      total_ativos: totalAtivos,
      risco_alto: riscoAlto,
    });
  } catch (err) {
    console.error('[importacao-precos/inativar-fora-planilha]', err);
    res.status(500).json({ ok: false, msg: err.message });
  }
});

module.exports = router;
