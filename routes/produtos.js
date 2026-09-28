const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const archiverMod = require('archiver');
/** archiver@8 (ESM) → ZipArchive; versões antigas CJS → archiver('zip') */
function createZipArchive(opts = {}) {
  if (typeof archiverMod === 'function') return archiverMod('zip', opts);
  if (archiverMod?.ZipArchive) return new archiverMod.ZipArchive(opts);
  throw new Error('Módulo archiver incompatível — reinstale: npm i archiver');
}
const { getPool } = require('../config/database');
const { resolveProdImagens, buildProdutoFotoSql, detectProdCols, detectProdImagensTb, fotoExisteNoDisco } = require('../config/produto-foto-resolve');
const {
  PROMO_SELECT_COLS,
  tabelaPromocoesExiste,
  buscarPromocoesProduto,
  formatarPromocaoRow,
  validarPayloadPromocao,
  resolverMelhorPromocao,
  calcularPrecoPromocao,
  sincronizarPrecopromoLegado,
  parseOptInt,
} = require('../config/promocoes-produto');
const {
  tabelaCampanhaExiste,
  listarCampanhas,
  getCampanha,
  gravarCampanha,
  excluirCampanha,
  adicionarProdutosCampanha,
  adicionarEscopoCampanha,
  materializarCampanha,
  listarProdutosCampanha,
  acoesLotePromocoes,
  previewDescontoCampanha,
} = require('../config/promocoes-campanha');
const { relatorioDashboard } = require('../config/promocoes-dashboard');
const { ensureItenspedPromoColumns, ensurePromocoesCampanhaTables } = require('../config/schema-migrations');
const {
  requirePromoAccess,
  requirePromoPerm,
  requirePromoLote,
} = require('../config/promocoes-permissoes');
const {
  listarDestaquesComerciais,
  getDestaqueComercial,
  gravarDestaqueComercial,
  excluirDestaqueComercial,
} = require('../config/produtos-destaque');
const { ensureProdutoColunas, getProdTabela, listProdutoColunas } = require('../config/produto-colunas');
const { validarCodFabricanteFornecedor } = require('../config/produto-cod-fabricante');
const {
  ensureProdutoReferenciaCol,
  validarVinculoReferencia,
  listarReferenciasMae,
  obterGrupoReferencia,
  parseIdReferenciaBody,
} = require('../config/produto-referencia');
const {
  listarGradesProduto,
  sincronizarGradesProduto,
  ensureProdutoTipogradeTable,
} = require('../config/produto-grades');

/** grades_extras no body: array de ids (opcional). Se ausente, não mexe na tabela N:N além do espelho do padrão. */
async function syncGradesFromReq(pool, idProduto, reqBody, tipogradeSalvo) {
  const padrao = parseInt(tipogradeSalvo, 10) || 0;
  if (Object.prototype.hasOwnProperty.call(reqBody || {}, 'grades_extras')) {
    const raw = reqBody.grades_extras;
    const extras = Array.isArray(raw) ? raw : String(raw || '').split(',').map((x) => x.trim()).filter(Boolean);
    await sincronizarGradesProduto(pool, idProduto, { tipogradePadrao: padrao, extrasIds: extras });
  } else if (padrao > 0) {
    await sincronizarGradesProduto(pool, idProduto, { tipogradePadrao: padrao });
  }
}

function _parseCodCliente(v) {
  return parseOptInt(v);
}

function _promoContextoFromQuery(q) {
  return {
    codCliente: parseOptInt(q.cod_cliente),
    idRegiao: parseOptInt(q.id_regiao),
    codFornecedor: parseOptInt(q.cod_fornecedor),
    idTabelaPreco: parseOptInt(q.id_tabela_preco || q.id_tabela),
  };
}

async function _gravarPromocao(pool, prodId, body, promoId = null) {
  const tb = await getTabela(pool);
  const [[prod]] = await pool.query(
    `SELECT ID, vlr_venda FROM ${tb} WHERE ID=? AND (excluido='N' OR excluido IS NULL OR excluido='') LIMIT 1`,
    [prodId]
  );
  if (!prod) return { status: 404, json: { error: 'Produto não encontrado' } };

  const val = validarPayloadPromocao(body, parseFloat(prod.vlr_venda) || 0);
  if (!val.ok) return { status: 400, json: { error: val.erros[0] } };

  const [dup] = await pool.query(
    `SELECT id FROM produto_promocoes
     WHERE cod_produto=? AND excluido='N' AND ativo='S'
       AND descricao=? AND qtd_minima=?
       AND (cod_cliente <=> ?)
       AND (id_regiao <=> ?)
       AND (cod_fornecedor <=> ?)
       AND (id_tabela_preco <=> ?)
       ${promoId ? 'AND id<>?' : ''}
     LIMIT 1`,
    promoId
      ? [prodId, val.desc.slice(0, 200), val.qtdMin, val.codCliente, val.idRegiao, val.codFornecedor, val.idTabelaPreco, promoId]
      : [prodId, val.desc.slice(0, 200), val.qtdMin, val.codCliente, val.idRegiao, val.codFornecedor, val.idTabelaPreco]
  );
  if (dup.length) {
    return { status: 400, json: { error: 'Já existe promoção ativa com mesma descrição, regras e quantidade mínima' } };
  }

  const params = [
    val.desc.slice(0, 200),
    val.tipoNorm,
    val.val,
    val.qtdMin,
    body.data_inicio || null,
    body.data_fim || null,
    body.destaque === 'S' || body.destaque === true ? 'S' : 'N',
    body.ativo === 'N' ? 'N' : 'S',
    val.codCliente,
    val.idRegiao,
    val.codFornecedor,
    val.idTabelaPreco,
    val.tabelasPrecoStr,
    val.syncPrecopromo,
  ];

  const idCampanha = parseOptInt(body?.id_campanha);

  if (promoId) {
    await pool.query(
      `UPDATE produto_promocoes SET
         descricao=?, tipo=?, valor=?, qtd_minima=?, data_inicio=?, data_fim=?, destaque=?, ativo=?,
         cod_cliente=?, id_regiao=?, cod_fornecedor=?, id_tabela_preco=?, tabelas_preco=?, sync_precopromo=?, id_campanha=?
       WHERE id=? AND cod_produto=?`,
      [...params, idCampanha, promoId, prodId]
    );
    if (val.syncPrecopromo === 'S' && body.ativo !== 'N') {
      await sincronizarPrecopromoLegado(pool, tb, prodId, {
        tipo: val.tipoNorm, valor: val.val, qtd_minima: val.qtdMin, ativo: 'S', sync_precopromo: 'S',
      }, prod.vlr_venda);
    }
    return { status: 200, json: { ok: true } };
  }

  const [r] = await pool.query(
    `INSERT INTO produto_promocoes
       (cod_produto, descricao, tipo, valor, qtd_minima, data_inicio, data_fim, destaque, ativo,
        cod_cliente, id_regiao, cod_fornecedor, id_tabela_preco, tabelas_preco, sync_precopromo, id_campanha)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [prodId, ...params, idCampanha]
  );
  if (val.syncPrecopromo === 'S' && body.ativo !== 'N') {
    await sincronizarPrecopromoLegado(pool, tb, prodId, {
      tipo: val.tipoNorm, valor: val.val, qtd_minima: val.qtdMin, ativo: 'S', sync_precopromo: 'S',
    }, prod.vlr_venda);
  }
  return { status: 201, json: { ok: true, id: r.insertId } };
}

// ─── cache DESCRIBE (por tenant) ─────────────────────────────────────────────
async function getColunasReais(pool) {
  return listProdutoColunas(pool);
}

/** Campos extras da listagem (cadastro) — só entram no SELECT se a coluna existir. */
const LISTA_CAMPOS_EXTRA = [
  'marca', 'id_familiaproduto', 'segmento', 'subfamilia', 'linha_produto', 'campo_extra',
  'cod_interno', 'cor1', 'cor2', 'kit', 'agrupa_cores',
  'vlr_custo', 'vlr_despesas', 'vlr_custofinal', 'margem', 'precoa', 'precob', 'precoc',
  'precopromo', 'desconto', 'comissao', 'margem_liquida', 'cod_tabelapreco',
  'estoque_maximo', 'estoque_seguranca', 'precopeso', 'embalagemmaster',
  'multiplo_venda', 'qtd_minima_pedido', 'desconto_maximo', 'bloquear_desconto',
  'id_endereco', 'ncm', 'cest', 'origem', 'icms', 'ipi', 'vlr_pis', 'vlr_confins',
  'vlr_st', 'peso_liquido', 'cod_fornecedorcusto', 'tipograde', 'tipoprodutograde',
  'solado', 'obs', 'obs2',
];

const _listaJoinCache = new Map();
async function detectListaJoins(pool) {
  const [[r]] = await pool.query('SELECT DATABASE() AS db');
  const key = String(r?.db || 'default');
  if (_listaJoinCache.has(key)) return _listaJoinCache.get(key);
  const has = async (name) => {
    const [rows] = await pool.query('SHOW TABLES LIKE ?', [name]);
    return rows.length > 0;
  };
  const out = {
    familia: await has('familia_produtos'),
    local: await has('local_armazenamento'),
    subfam: await has('subfamilia_produto'),
    grade: await has('tipograde'),
  };
  _listaJoinCache.set(key, out);
  return out;
}

async function ensureColunasExtras(pool) {
  await ensureProdutoColunas(pool);
  await ensureProdutoReferenciaCol(pool);
}

/** Aplica id_referencia no body (permite NULL para desvincular). */
async function aplicarIdReferenciaNoBody(pool, reqBody, body, idProduto) {
  const parsed = parseIdReferenciaBody(reqBody);
  if (!parsed.presente) return { ok: true, body };
  const val = await validarVinculoReferencia(pool, {
    idProduto,
    idReferencia: parsed.id_referencia,
  });
  if (!val.ok) return { ok: false, error: val.error };
  body.id_referencia = val.id_referencia;
  return { ok: true, body };
}

// campos numéricos/decimais — '' deve virar NULL (senão MySQL rejeita "Incorrect decimal value")
const CAMPOS_DECIMAIS = [
  'vlr_custo','vlr_despesas','vlr_custofinal','margem','margem_liquida','vlr_venda',
  'precoa','precob','precoc','precopromo','desconto','comissao','st','valor_puxada',
  'icms','ipi','vlr_pis','vlr_confins','vlr_st','kilo_embalagem',
];

function filtrarBody(body, colunas) {
  // skip pk e campos de data/controle gerenciados pelo servidor
  const skip = ['ID','id','excluido','dt_cadastro','dt_atualizacao','user_atualizacao','status_sinc'];
  const colsLower = colunas.map(c => c.toLowerCase());
  return Object.fromEntries(
    Object.entries(body)
      .filter(([k, v]) => {
        if (v === undefined || v === null) return false;
        return colsLower.includes(k.toLowerCase()) && !skip.map(s=>s.toLowerCase()).includes(k.toLowerCase());
      })
      .map(([k, v]) => {
        if (v === '' && (CAMPOS_DECIMAIS.includes(k.toLowerCase()) || k.toLowerCase() === 'foto_principal')) return [k, null];
        return [k, v];
      })
  );
}

const UPPER_CAMPOS = ['descricao','apelido','segmento','unidade','marca','solado','obs','obs2','cor1','cor2','nome_grupo','subfamilia','linha_produto','campo_extra'];
function aplicarUpper(body) {
  UPPER_CAMPOS.forEach(c => { if (body[c]) body[c] = String(body[c]).toUpperCase().trim(); });
  return body;
}

// tabela pode ser "produto" ou "produtos" — detecta automaticamente
async function getTabela(pool) {
  return getProdTabela(pool);
}

// ─── Multer — galeria de imagens de produto ───────────────────────────────────
const _uploadsBase = path.join(process.cwd(), 'public', 'uploads', 'produtos');

const _storage = multer.diskStorage({
  destination(req, file, cb) {
    const dir = path.join(_uploadsBase, String(req.params.id));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.jpg';
    cb(null, `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${ext}`);
  }
});

const _upload = multer({
  storage: _storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const ok = /^image\/(jpeg|png|gif|webp)$/.test(file.mimetype);
    cb(ok ? null : new Error('Use JPG, PNG, GIF ou WebP (máx 5 MB)'), ok);
  }
});

// ─── GET /api/produtos ────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    const tb = await getTabela(pool);
    await ensureColunasExtras(pool);
    const { q='', status='todos', limit=50, offset=0, grupo='', disponivel='', fornecedor='', com_foto='' } = req.query;
    const cols = await getColunasReais(pool);
    const temSegmento    = cols.includes('segmento');
    const temFotoPrinc   = cols.includes('foto_principal');
    const temFornPadrao  = cols.includes('cod_fornecedorpadrao');

    let where = [`(p.excluido='N' OR p.excluido IS NULL OR p.excluido='')`];
    const vals = [];

    if (status === 'A') where.push(`p.situacao='A'`);
    else if (status === 'I') where.push(`p.situacao='I'`);
    else if (status === 'E') where.push(`p.situacao='E'`);

    if (q.trim()) {
      where.push(`(p.descricao LIKE ? OR p.id LIKE ? OR p.cod_barras LIKE ? OR p.cod_fabricante LIKE ? OR p.apelido LIKE ?)`);
      const lk = `%${q.trim()}%`;
      vals.push(lk,lk,lk,lk,lk);
    }
    if (grupo.trim())                       { where.push(`p.nome_grupo LIKE ?`);      vals.push(`%${grupo.trim()}%`); }
    if (disponivel)                         { where.push(`p.disponivel=?`);           vals.push(disponivel); }
    if (fornecedor && temFornPadrao)        { where.push(`p.cod_fornecedorpadrao=?`); vals.push(fornecedor); }
    if (req.query.segmento && temSegmento)  { where.push(`p.segmento=?`);            vals.push(req.query.segmento); }
    if (temFotoPrinc && com_foto === 'S')   { where.push(`(p.foto_principal IS NOT NULL AND p.foto_principal<>'')`); }
    if (temFotoPrinc && com_foto === 'N')   { where.push(`(p.foto_principal IS NULL OR p.foto_principal='')`); }

    const wc = where.join(' AND ');

    const temIdRef = cols.some((c) => String(c).toLowerCase() === 'id_referencia');
    const temAgrupa = cols.some((c) => String(c).toLowerCase() === 'agrupa_cores');
    const prodCols = await detectProdCols(pool, tb);
    const hasImgTb = await detectProdImagensTb(pool);
    const maeWhere = `(mae.excluido='N' OR mae.excluido IS NULL OR mae.excluido='')`;

    const selectExtras = [
      temSegmento   ? 'p.segmento'    : null,
      temFotoPrinc  ? buildProdutoFotoSql(tb, prodCols, hasImgTb, { maeWhere }) : null,
      temIdRef      ? 'p.id_referencia' : null,
      temAgrupa     ? 'p.agrupa_cores' : null,
    ].filter(Boolean).join(', ');
    const temDispList = cols.some((c) => String(c).toLowerCase() === 'disponivel');
    const temCor1List = cols.some((c) => String(c).toLowerCase() === 'cor1');
    const qtdCoresSelect = temIdRef
      ? `, ((SELECT COUNT(*) FROM ${tb} c WHERE c.id_referencia = p.ID AND (c.excluido='N' OR c.excluido IS NULL OR c.excluido=''))
          + CASE
              WHEN (p.id_referencia IS NULL OR p.id_referencia = 0)
               AND ${temCor1List ? "TRIM(IFNULL(p.cor1,'')) <> ''" : '0'}
               AND ${temDispList ? "IFNULL(p.disponivel,'S') <> 'N'" : '1'}
              THEN 1 ELSE 0
            END) AS qtd_cores`
      : ', 0 AS qtd_cores';

    const joinForn = temFornPadrao
      ? `LEFT JOIN fornecedores f ON f.id = p.cod_fornecedorpadrao`
      : '';
    const nomeFabSelect = temFornPadrao ? ', f.nome AS nome_fabricante' : '';

    const hasCol = (c) => cols.some((x) => String(x).toLowerCase() === c.toLowerCase());
    const jaNoSelect = new Set(['kit', 'segmento', 'agrupa_cores']);
    const extraColsSql = LISTA_CAMPOS_EXTRA
      .filter((c) => hasCol(c) && !jaNoSelect.has(c))
      .map((c) => `p.\`${c}\``)
      .join(', ');

    const joins = await detectListaJoins(pool);
    let joinAux = '';
    let selAux = '';
    if (joins.familia && hasCol('id_familiaproduto')) {
      joinAux += ' LEFT JOIN familia_produtos fam ON fam.id = p.id_familiaproduto';
      selAux += ', fam.nome AS nome_familia';
    }
    if (joins.local && hasCol('id_endereco')) {
      joinAux += ' LEFT JOIN local_armazenamento la ON la.id = p.id_endereco';
      selAux += ', la.nome_local';
    }
    if (joins.subfam && hasCol('subfamilia')) {
      joinAux += ' LEFT JOIN subfamilia_produto sf ON sf.codigo = p.subfamilia';
      selAux += ', sf.descricao AS nome_subfamilia';
    }
    if (joins.grade && hasCol('tipograde')) {
      joinAux += ' LEFT JOIN tipograde tg ON tg.id = p.tipograde';
      selAux += ', tg.nome AS nome_grade';
    }
    const temFornCusto = hasCol('cod_fornecedorcusto');
    if (temFornCusto) {
      joinAux += ' LEFT JOIN fornecedores fc ON fc.id = p.cod_fornecedorcusto';
      selAux += ', fc.nome AS nome_fornecedor_custo';
    }

    const [rows] = await pool.query(
      `SELECT p.ID AS id, p.descricao, p.apelido, p.cod_barras, p.cod_fabricante,
              p.unidade, p.kilo_embalagem, p.vlr_venda, p.estoque_atual,
              p.estoque_minimo, p.situacao, p.disponivel, p.kit,
              p.nome_grupo, p.dt_cadastro${nomeFabSelect}${selectExtras ? ', '+selectExtras : ''}${qtdCoresSelect}${extraColsSql ? ', '+extraColsSql : ''}${selAux}
       FROM ${tb} p ${joinForn}${joinAux}
       WHERE ${wc}
       ORDER BY p.descricao
       LIMIT ? OFFSET ?`,
      [...vals, parseInt(limit), parseInt(offset)]
    );

    for (const p of rows) {
      if (!p.id_referencia) continue;
      if (p.foto_principal && fotoExisteNoDisco(p.foto_principal)) continue;
      const imgs = await resolveProdImagens(pool, p.id);
      if (imgs[0]?.url) p.foto_principal = imgs[0].url;
    }

    const [[{total}]] = await pool.query(
      `SELECT COUNT(*) AS total FROM ${tb} p WHERE ${wc}`, vals
    );

    res.json({ produtos: rows, total });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/produtos/notificacoes ──────────────────────────────────────────
router.get('/notificacoes', async (req, res) => {
  try {
    const pool = getPool();
    const tb = await getTabela(pool);
    const base = `(excluido='N' OR excluido IS NULL OR excluido='')`;

    const [[{ativos}]]        = await pool.query(`SELECT COUNT(*) AS ativos FROM ${tb} WHERE ${base} AND situacao='A'`);
    const [[{inativos}]]      = await pool.query(`SELECT COUNT(*) AS inativos FROM ${tb} WHERE ${base} AND situacao='I'`);
    const [[{est_baixo}]]     = await pool.query(`SELECT COUNT(*) AS est_baixo FROM ${tb} WHERE ${base} AND situacao='A' AND estoque_minimo>0 AND estoque_atual<=estoque_minimo`);
    const [[{novos7dias}]]    = await pool.query(`SELECT COUNT(*) AS novos7dias FROM ${tb} WHERE ${base} AND dt_cadastro>=DATE_SUB(CURDATE(),INTERVAL 7 DAY)`);

    res.json({ ativos, inativos, est_baixo, novos7dias });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/produtos/grupos ─────────────────────────────────────────────────
/** Lista produtos que podem ser referência mãe (opt-in — não altera listagem padrão). */
router.get('/referencias-mae', async (req, res) => {
  try {
    const pool = getPool();
    const rows = await listarReferenciasMae(pool, {
      q: req.query.q || '',
      fornecedor: req.query.fornecedor || req.query.cod_fornecedor || null,
      limit: req.query.limit,
      excludeId: req.query.exclude_id || null,
    });
    res.json({ referencias: rows });
  } catch (err) {
    console.error('[produtos/referencias-mae]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/grupos', async (req, res) => {
  try {
    const pool = getPool();
    const tb = await getTabela(pool);
    const [rows] = await pool.query(
      `SELECT DISTINCT nome_grupo FROM ${tb} WHERE nome_grupo IS NOT NULL AND nome_grupo<>'' ORDER BY nome_grupo`
    );
    res.json(rows.map(r => r.nome_grupo));
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/produtos/marcas ─────────────────────────────────────────────────
// Lista distinta de marcas (para filtro rápido do catálogo no pedido).
// Tolerante a bases legadas sem a coluna `marca` → retorna [].
router.get('/marcas', async (req, res) => {
  try {
    const pool = getPool();
    const tb = await getTabela(pool);
    const [rows] = await pool.query(
      `SELECT DISTINCT marca FROM ${tb} WHERE marca IS NOT NULL AND marca<>'' ORDER BY marca`
    );
    res.json(rows.map(r => r.marca));
  } catch(err) { res.json([]); }
});

// ─── Preferências da lista (ex.: exibir fotos) ───────────────────────────────
const CREATE_PREFS_GRID = `
  CREATE TABLE IF NOT EXISTS preferencias_grid (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_usuario INT NOT NULL,
    nome_grid VARCHAR(50) NOT NULL,
    config_json TEXT NOT NULL,
    dt_alterado DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unq_user_grid (id_usuario, nome_grid)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3
`;

function parseListaConfig(raw) {
  if (!raw) return {};
  try {
    const cfg = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return cfg && typeof cfg === 'object' ? cfg : {};
  } catch (_) {
    return {};
  }
}

router.get('/config/lista', async (req, res) => {
  try {
    const id_usuario = req.user?.id;
    if (!id_usuario) return res.status(401).json({ error: 'Usuário não identificado' });
    const pool = getPool();
    await pool.query(CREATE_PREFS_GRID).catch(() => {});
    const [rows] = await pool.query(
      `SELECT config_json FROM preferencias_grid WHERE id_usuario = ? AND nome_grid = 'produtos_lista'`,
      [id_usuario]
    );
    res.json(parseListaConfig(rows[0]?.config_json));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/config/lista', async (req, res) => {
  try {
    const id_usuario = req.user?.id;
    if (!id_usuario) return res.status(401).json({ error: 'Usuário não identificado' });
    const pool = getPool();
    await pool.query(CREATE_PREFS_GRID).catch(() => {});
    const [rows] = await pool.query(
      `SELECT config_json FROM preferencias_grid WHERE id_usuario = ? AND nome_grid = 'produtos_lista'`,
      [id_usuario]
    );
    const cfg = { ...parseListaConfig(rows[0]?.config_json), ...req.body };
    if (Array.isArray(req.body?.colunas)) {
      cfg.colunas = req.body.colunas.map((c) => String(c || '').trim()).filter(Boolean).slice(0, 80);
    }
    if (typeof req.body?.exibir_fotos === 'boolean') cfg.exibir_fotos = req.body.exibir_fotos;
    const json = JSON.stringify(cfg);
    await pool.query(
      `INSERT INTO preferencias_grid (id_usuario, nome_grid, config_json, dt_alterado)
       VALUES (?, 'produtos_lista', ?, NOW())
       ON DUPLICATE KEY UPDATE config_json = VALUES(config_json), dt_alterado = NOW()`,
      [id_usuario, json]
    );
    res.json({ ok: true, ...cfg });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/produtos/manutencao/sync-imagens ──────────────────────────────
// Limpa registros de produto_imagens cujos arquivos não existem no disco
// e zera foto_principal nos produtos afetados
router.post('/manutencao/sync-imagens', async (_req, res) => {
  try {
    const pool = getPool();
    const tb   = await getTabela(pool);

    const [rows] = await pool.query(
      `SELECT id, cod_produto, filename, is_principal FROM produto_imagens`
    );

    const orfaos = rows.filter(r =>
      !r.filename || !fs.existsSync(_prodImgDiskPath(r.cod_produto, r.filename))
    );

    if (!orfaos.length) return res.json({ ok: true, removidos: 0, msg: 'Nada a limpar' });

    const ids = orfaos.map(r => r.id);
    await pool.query(`DELETE FROM produto_imagens WHERE id IN (${ids.map(()=>'?').join(',')})`, ids);

    // Para os produtos que perderam a imagem principal, redefinir para a próxima disponível
    const produtosAfetados = [...new Set(orfaos.filter(r => r.is_principal).map(r => r.cod_produto))];
    for (const prodId of produtosAfetados) {
      const [[next]] = await pool.query(
        `SELECT filename FROM produto_imagens WHERE cod_produto=? AND filename IS NOT NULL ORDER BY id LIMIT 1`,
        [prodId]
      );
      if (next && fs.existsSync(_prodImgDiskPath(prodId, next.filename))) {
        await pool.query(
          `UPDATE ${tb} SET foto_principal=? WHERE ID=?`,
          [`/uploads/produtos/${prodId}/${next.filename}`, prodId]
        );
        await pool.query(`UPDATE produto_imagens SET is_principal=1 WHERE cod_produto=? AND filename=?`, [prodId, next.filename]);
      } else {
        await pool.query(`UPDATE ${tb} SET foto_principal=NULL WHERE ID=?`, [prodId]);
      }
    }

    // Zerar foto_principal de produtos que não têm nenhuma imagem restante
    await pool.query(`
      UPDATE ${tb} p SET foto_principal=NULL
      WHERE foto_principal IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM produto_imagens pi WHERE pi.cod_produto=p.ID)
    `);

    res.json({ ok: true, removidos: ids.length, produtosAfetados: produtosAfetados.length });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/produtos/:id/imagens ───────────────────────────────────────────
// Tenant (cwd) + pasta compartilhada do código: no DNS as fotos antigas ficam
// em /root/pedidosweb/public/uploads enquanto o processo roda no client dir.
const _prodImgDirs = [
  path.join(process.cwd(), 'public', 'uploads', 'produtos'),
  path.join(__dirname, '..', 'public', 'uploads', 'produtos'),
];

function _prodImgDiskPath(prodId, filename) {
  return path.join(_uploadsBase, String(prodId), filename);
}

function _prodImgPublicUrl(prodId, filename) {
  return `/uploads/produtos/${prodId}/${filename}`;
}

function _codProdutoParams(prodId) {
  const idStr = String(prodId);
  const idNum = parseInt(prodId, 10);
  if (Number.isFinite(idNum) && String(idNum) === idStr) return [idStr, idNum];
  return [idStr];
}

function _fotoBasename(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  try {
    if (/^https?:\/\//i.test(s)) return path.basename(new URL(s).pathname || '');
  } catch (_) {}
  return path.basename(s.split('?')[0].split('#')[0]);
}

function _fotoApontaPara(fp, filename, prodId) {
  const fn = String(filename || '').trim();
  const s = String(fp || '').trim();
  if (!s) return false;
  const fpB = _fotoBasename(s).toLowerCase();
  if (fn && fpB && fpB === fn.toLowerCase()) return true;
  if (fn && s.includes(`/uploads/produtos/${prodId}/${fn}`)) return true;
  return false;
}

function _arquivoImagemExiste(prodId, filename) {
  const fn = path.basename(String(filename || '').split('?')[0]);
  if (!fn || fn === '.' || fn === '..') return false;
  const seen = new Set();
  for (const base of _prodImgDirs) {
    const abs = path.resolve(path.join(base, String(prodId), fn));
    if (seen.has(abs)) continue;
    seen.add(abs);
    if (fs.existsSync(abs)) return true;
  }
  return false;
}

function _apagarArquivoImagem(prodId, filename) {
  const fn = path.basename(String(filename || '').split('?')[0]);
  if (!fn || fn === '.' || fn === '..') return;
  const seen = new Set();
  for (const base of _prodImgDirs) {
    const abs = path.resolve(path.join(base, String(prodId), fn));
    if (seen.has(abs)) continue;
    seen.add(abs);
    try { fs.rmSync(abs, { force: true }); } catch (_) {}
  }
}

async function _setFotoPrincipal(pool, tb, prodId, value) {
  try {
    await pool.query(
      `UPDATE \`${tb}\` SET foto_principal=?, dt_atualizacao=NOW() WHERE ID=?`,
      [value, prodId]
    );
  } catch (e) {
    if (!String(e.message || '').includes('dt_atualizacao')) throw e;
    await pool.query(
      `UPDATE \`${tb}\` SET foto_principal=? WHERE ID=?`,
      [value, prodId]
    );
  }
}

/** Lista a galeria do cadastro (IDs reais). Não mistura com foto do produto pai. */
async function _listarImagensCadastro(pool, prodId) {
  const tb = await getTabela(pool);
  const idStr = String(prodId);
  const codParams = _codProdutoParams(prodId);

  const [rows] = await pool.query(
    `SELECT id, filename, is_principal, ordem FROM produto_imagens
     WHERE cod_produto IN (${codParams.map(() => '?').join(',')})
     ORDER BY (is_principal = 1 OR is_principal = 'S') DESC, ordem, id`,
    codParams
  ).catch(() => [[]]);

  const imgs = [];
  const seen = new Set();
  for (const r of rows) {
    const fn = String(r.filename || '').trim();
    if (!fn) continue;
    const key = fn.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    imgs.push({
      id: r.id,
      filename: fn,
      is_principal: r.is_principal,
      ordem: imgs.length,
      url: _prodImgPublicUrl(idStr, fn),
      origem: 'galeria',
      heredada: false,
      arquivo_ok: _arquivoImagemExiste(idStr, fn),
    });
  }

  // foto_principal própria (URL absoluta do DNS, relativa ou arquivo)
  const [[prod]] = await pool.query(
    `SELECT foto_principal FROM \`${tb}\` WHERE ID = ? LIMIT 1`,
    [prodId]
  ).catch(() => [[null]]);
  const fp = String(prod?.foto_principal || '').trim();
  if (fp) {
    const base = _fotoBasename(fp);
    const jaTem = base && seen.has(base.toLowerCase());
    const urlNorm = fp.startsWith('http') || fp.startsWith('/') ? fp : `/${fp.replace(/^\/+/, '')}`;
    const cobre = jaTem || imgs.some((i) => i.url === urlNorm || urlNorm.endsWith(`/${i.filename}`));
    if (!cobre) {
      imgs.unshift({
        id: 'fp',
        filename: base || 'foto',
        is_principal: 1,
        ordem: 0,
        url: urlNorm,
        origem: 'foto_principal',
        heredada: false,
        arquivo_ok: true,
      });
    }
  }

  // Sem foto própria: mostra a do pai só como referência (sem exclusão)
  if (!imgs.length) {
    const herdadas = await resolveProdImagens(pool, prodId);
    for (const r of herdadas) {
      if (!r.heredada && r.origem !== 'referencia') continue;
      imgs.push({
        id: r.id != null ? r.id : 'fp',
        filename: _fotoBasename(r.url) || 'foto',
        is_principal: r.is_principal,
        ordem: imgs.length,
        url: r.url,
        origem: 'referencia',
        heredada: true,
        arquivo_ok: true,
      });
    }
  }

  return imgs;
}

async function _syncFotoPrincipalAposExclusao(pool, tb, prodId, removedFilename) {
  const idStr = String(prodId);
  const codParams = _codProdutoParams(prodId);
  const [[prod]] = await pool.query(
    `SELECT foto_principal FROM \`${tb}\` WHERE ID = ? LIMIT 1`,
    [prodId]
  ).catch(() => [[null]]);
  const fp = String(prod?.foto_principal || '').trim();
  const apontavaRemovida = !fp || _fotoApontaPara(fp, removedFilename, idStr);

  const [[next]] = await pool.query(
    `SELECT id, filename FROM produto_imagens
     WHERE cod_produto IN (${codParams.map(() => '?').join(',')})
       AND filename IS NOT NULL AND filename <> ''
     ORDER BY (is_principal = 1 OR is_principal = 'S') DESC, ordem, id LIMIT 1`,
    codParams
  ).catch(() => [[null]]);

  if (next?.filename) {
    await pool.query(
      `UPDATE produto_imagens SET is_principal = 0 WHERE cod_produto IN (${codParams.map(() => '?').join(',')})`,
      codParams
    ).catch(() => {});
    await pool.query(`UPDATE produto_imagens SET is_principal = 1 WHERE id = ?`, [next.id]).catch(() => {});
    if (apontavaRemovida) {
      await _setFotoPrincipal(pool, tb, prodId, _prodImgPublicUrl(idStr, next.filename));
    }
    return;
  }

  await _setFotoPrincipal(pool, tb, prodId, null);
}

async function _limparFotoPrincipalProduto(pool, tb, prodId, filenameHint) {
  const idStr = String(prodId);
  const codParams = _codProdutoParams(prodId);
  const [[prod]] = await pool.query(
    `SELECT foto_principal FROM \`${tb}\` WHERE ID=? LIMIT 1`, [prodId]
  ).catch(() => [[null]]);
  const url = String(prod?.foto_principal || '').trim();
  const fn = filenameHint || _fotoBasename(url);
  if (fn) {
    _apagarArquivoImagem(idStr, fn);
    const [orfaos] = await pool.query(
      `SELECT id, filename FROM produto_imagens
       WHERE cod_produto IN (${codParams.map(() => '?').join(',')}) AND filename = ?`,
      [...codParams, fn]
    ).catch(() => [[]]);
    for (const o of orfaos) {
      _apagarArquivoImagem(idStr, o.filename);
      await pool.query(`DELETE FROM produto_imagens WHERE id = ?`, [o.id]);
    }
  } else if (url) {
    const base = _fotoBasename(url);
    if (base) _apagarArquivoImagem(idStr, base);
  }
  await _setFotoPrincipal(pool, tb, prodId, null);
}

async function _removerImagemProduto(req, res) {
  try {
    const pool = getPool();
    const tb = await getTabela(pool);
    const id = req.params.id;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const imgId = String(req.params.imgId || body.id || body.imgId || '').trim();
    const filenameHint = String(req.query.filename || body.filename || _fotoBasename(body.url) || '').trim();
    const idStr = String(id);
    const codParams = _codProdutoParams(id);
    const inSql = `cod_produto IN (${codParams.map(() => '?').join(',')})`;

    const [all] = await pool.query(
      `SELECT * FROM produto_imagens WHERE ${inSql} ORDER BY (is_principal = 1 OR is_principal = 'S') DESC, ordem, id`,
      codParams
    ).catch(() => [[]]);

    async function findImg() {
      if (!imgId || imgId === 'fp') return null;
      let found = all.find((r) => String(r.id) === imgId);
      if (found) return found;
      if (filenameHint) {
        found = all.find((r) => String(r.filename || '').toLowerCase() === filenameHint.toLowerCase());
        if (found) return found;
      }
      if (all.length === 1) return all[0];
      const idx = parseInt(imgId, 10);
      if (Number.isFinite(idx) && idx >= 1 && idx <= all.length) return all[idx - 1];
      return null;
    }

    // Sem linha na galeria (foto só no campo / URL do DNS) ou id explícito "fp"
    if (imgId === 'fp' || imgId === '' || (!all.length && imgId)) {
      await _limparFotoPrincipalProduto(pool, tb, id, filenameHint);
      return res.json({ ok: true });
    }

    const img = await findImg();
    if (!img) {
      if (!all.length) {
        await _limparFotoPrincipalProduto(pool, tb, id, filenameHint);
        return res.json({ ok: true });
      }
      return res.status(404).json({ error: 'Imagem não encontrada' });
    }

    _apagarArquivoImagem(idStr, img.filename);
    await pool.query(`DELETE FROM produto_imagens WHERE id=?`, [img.id]);
    await _syncFotoPrincipalAposExclusao(pool, tb, id, img.filename);
    return res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

router.get('/:id/imagens', async (req, res) => {
  try {
    const pool = getPool();
    const imgs = await _listarImagensCadastro(pool, req.params.id);
    res.json(imgs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST (não DELETE): no DNS/nginx o DELETE às vezes não chega; body leva id+arquivo
router.post('/:id/imagens/remover', _removerImagemProduto);

// ─── POST /api/produtos/:id/imagens (upload, máx 8) ──────────────────────────
router.post('/:id/imagens', _upload.array('files', 8), async (req, res) => {
  try {
    const pool = getPool();
    const tb   = await getTabela(pool);
    const id   = req.params.id;

    const [[{total}]] = await pool.query(
      `SELECT COUNT(*) AS total FROM produto_imagens WHERE cod_produto=?`, [id]
    );
    const disponiveis = 8 - total;
    if (disponiveis <= 0) {
      // apagar arquivos que foram salvos em disco mas não serão registrados
      (req.files || []).forEach(f => fs.rmSync(f.path, { force: true }));
      return res.status(400).json({ error: 'Limite de 8 imagens por produto atingido' });
    }

    const files = (req.files || []).slice(0, disponiveis);
    // apagar excedentes
    (req.files || []).slice(disponiveis).forEach(f => fs.rmSync(f.path, { force: true }));

    if (!files.length) return res.status(400).json({ error: 'Nenhum arquivo enviado' });

    const [[{hasPrincipal}]] = await pool.query(
      `SELECT COUNT(*) AS hasPrincipal FROM produto_imagens WHERE cod_produto=? AND is_principal=1`, [id]
    );

    let setPrincipalNext = !hasPrincipal;
    for (const file of files) {
      const isPrincipal = setPrincipalNext ? 1 : 0;
      await pool.query(
        `INSERT INTO produto_imagens (cod_produto, filename, is_principal) VALUES (?,?,?)`,
        [id, file.filename, isPrincipal]
      );
      if (isPrincipal) {
        await _setFotoPrincipal(pool, tb, id, `/uploads/produtos/${id}/${file.filename}`);
        setPrincipalNext = false;
      }
    }

    res.json({ ok: true, enviadas: files.length });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ─── PUT /api/produtos/:id/imagens/:imgId/principal ──────────────────────────
router.put('/:id/imagens/:imgId/principal', async (req, res) => {
  try {
    const pool = getPool();
    const tb   = await getTabela(pool);
    const { id, imgId } = req.params;

    // Foto só no campo foto_principal (sem linha em produto_imagens) — já é a principal
    if (String(imgId) === 'fp') {
      return res.json({ ok: true });
    }

    const [[img]] = await pool.query(
      `SELECT * FROM produto_imagens WHERE id=? AND cod_produto IN (?, ?)`,
      [imgId, id, parseInt(id, 10) || id]
    );
    if (!img) return res.status(404).json({ error: 'Imagem não encontrada' });

    await pool.query(`UPDATE produto_imagens SET is_principal=0 WHERE cod_produto IN (?, ?)`, [id, parseInt(id, 10) || id]);
    await pool.query(`UPDATE produto_imagens SET is_principal=1 WHERE id=?`, [imgId]);
    await _setFotoPrincipal(pool, tb, id, `/uploads/produtos/${id}/${img.filename}`);

    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id/imagens/:imgId', _removerImagemProduto);

// ─── POST /api/produtos/importar-fotos (lote por nome de arquivo) ─────────────
const _tmpDir = path.join(__dirname, '..', 'public', 'uploads', 'produtos', '_tmp');
fs.mkdirSync(_tmpDir, { recursive: true });

const _uploadBatch = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, _tmpDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.jpg';
      cb(null, `batch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${ext}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|png|gif|webp)$/.test(file.mimetype);
    cb(ok ? null : new Error('Formato inválido'), ok);
  }
});

router.post('/importar-fotos',
  (req, res, next) => { try { req._pool = getPool(); } catch (_) {} next(); },
  _uploadBatch.array('files', 200),
  async (req, res) => {
  try {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'Nenhum arquivo enviado' });

  const pool = req._pool || getPool();
  const tb   = await getTabela(pool);

  const fornecedorId = req.body?.fornecedor_id ? parseInt(req.body.fornecedor_id) : null;
  const ativo = `(excluido='N' OR excluido IS NULL OR excluido='')`;

  // Cache: code → { id, descricao } | null
  const cache = {};
  async function findProduto(code) {
    if (cache[code] !== undefined) return cache[code];
    let rows;

    if (fornecedorId) {
      // Busca restrita ao fabricante selecionado — cod_fabricante + cod_fornecedorpadrao
      [rows] = await pool.query(
        `SELECT ID AS id, descricao FROM ${tb} WHERE cod_fabricante=? AND cod_fornecedorpadrao=? AND ${ativo} LIMIT 1`,
        [code, fornecedorId]
      );
    } else {
      // Sem filtro de fabricante: cod_fabricante → cod_barras → ID numérico
      [rows] = await pool.query(
        `SELECT ID AS id, descricao FROM ${tb} WHERE cod_fabricante=? AND ${ativo} LIMIT 1`,
        [code]
      );
      if (!rows?.length) {
        [rows] = await pool.query(
          `SELECT ID AS id, descricao FROM ${tb} WHERE cod_barras=? AND ${ativo} LIMIT 1`,
          [code]
        );
      }
      if (!rows?.length && /^\d+$/.test(code)) {
        [rows] = await pool.query(
          `SELECT ID AS id, descricao FROM ${tb} WHERE ID=? AND ${ativo} LIMIT 1`,
          [code]
        );
      }
    }

    cache[code] = rows?.[0] || null;
    return cache[code];
  }

  const ok    = [];
  const erros = [];

  for (const file of files) {
    const orig = path.basename(file.originalname, path.extname(file.originalname));
    // Extrai código e ordem: "CODIGO(2)" → code="CODIGO", ordem=2
    const m = orig.match(/^(.+?)(?:\((\d+)\))?$/);
    const code  = m?.[1]?.trim() || orig;
    const ordem = m?.[2] ? parseInt(m[2]) : 0;

    const prod = await findProduto(code);
    if (!prod) {
      fs.rmSync(file.path, { force: true });
      const dica = fornecedorId
        ? `Cód. fabricante "${code}" não encontrado para o fabricante selecionado. Verifique se o produto tem esse código e se o "Fornecedor Padrão" está correto.`
        : `Cód. fabricante "${code}" não encontrado. Verifique o campo "Cód. Fabricante" no cadastro do produto.`;
      erros.push({ arquivo: file.originalname, motivo: dica });
      continue;
    }

    // Verificar limite de 8 imagens por produto
    const [[{total}]] = await pool.query(
      `SELECT COUNT(*) AS total FROM produto_imagens WHERE cod_produto=?`, [prod.id]
    );
    if (total >= 8) {
      fs.rmSync(file.path, { force: true });
      erros.push({ arquivo: file.originalname, motivo: `Produto ${prod.id} já tem 8 fotos (limite atingido)` });
      continue;
    }

    // Mover para diretório definitivo
    const destDir  = path.join(_uploadsBase, String(prod.id));
    fs.mkdirSync(destDir, { recursive: true });
    const ext      = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.jpg';
    const filename = `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${ext}`;
    fs.renameSync(file.path, path.join(destDir, filename));

    const [[{hasPrincipal}]] = await pool.query(
      `SELECT COUNT(*) AS hasPrincipal FROM produto_imagens WHERE cod_produto=? AND is_principal=1`, [prod.id]
    );
    const isPrincipal = hasPrincipal ? 0 : 1;

    await pool.query(
      `INSERT INTO produto_imagens (cod_produto, filename, is_principal, ordem) VALUES (?,?,?,?)`,
      [prod.id, filename, isPrincipal, ordem]
    );
    if (isPrincipal) {
      await pool.query(
        `UPDATE ${tb} SET foto_principal=?, dt_atualizacao=NOW() WHERE ID=?`,
        [`/uploads/produtos/${prod.id}/${filename}`, prod.id]
      );
    }

    ok.push({ arquivo: file.originalname, produto_id: prod.id, descricao: prod.descricao });
  }

  res.json({ ok, erros });
  } catch (err) {
    (req.files || []).forEach(f => { try { fs.rmSync(f.path, { force: true }); } catch {} });
    res.status(500).json({ error: `Erro interno: ${err.message}` });
  }
});

// ─── POST /api/produtos/exportar-fotos → ZIP (ids ou mesmos filtros da lista) ──
// Lotes de até 500 produtos; use offset/limit no body para baixar catálogos grandes em vários ZIPs.
const EXPORT_FOTOS_MAX_PROD = 500;

function _safeZipBaseName(s) {
  const t = String(s || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return t || 'produto';
}

async function _buildWhereExportFotos(pool, tb, body = {}) {
  const cols = await getColunasReais(pool);
  const temSegmento = cols.includes('segmento');
  const temFotoPrinc = cols.includes('foto_principal');
  const temFornPadrao = cols.includes('cod_fornecedorpadrao');

  const q = String(body.q || '').trim();
  const status = body.status || 'todos';
  const grupo = String(body.grupo || '').trim();
  const disponivel = body.disponivel || '';
  const fornecedor = body.fornecedor || '';
  const com_foto = body.com_foto || 'S';

  const where = [`(p.excluido='N' OR p.excluido IS NULL OR p.excluido='')`];
  const vals = [];

  if (status === 'A') where.push(`p.situacao='A'`);
  else if (status === 'I') where.push(`p.situacao='I'`);
  else if (status === 'E') where.push(`p.situacao='E'`);

  if (q) {
    where.push(`(p.descricao LIKE ? OR p.id LIKE ? OR p.cod_barras LIKE ? OR p.cod_fabricante LIKE ? OR p.apelido LIKE ?)`);
    const lk = `%${q}%`;
    vals.push(lk, lk, lk, lk, lk);
  }
  if (grupo) { where.push(`p.nome_grupo LIKE ?`); vals.push(`%${grupo}%`); }
  if (disponivel) { where.push(`p.disponivel=?`); vals.push(disponivel); }
  if (fornecedor && temFornPadrao) { where.push(`p.cod_fornecedorpadrao=?`); vals.push(fornecedor); }
  if (body.segmento && temSegmento) { where.push(`p.segmento=?`); vals.push(body.segmento); }
  if (temFotoPrinc && com_foto === 'S') {
    where.push(`(p.foto_principal IS NOT NULL AND p.foto_principal<>'')`);
  } else if (temFotoPrinc && com_foto === 'N') {
    where.push(`(p.foto_principal IS NULL OR p.foto_principal='')`);
  }

  where.push(`EXISTS (SELECT 1 FROM produto_imagens pi WHERE pi.cod_produto=p.ID AND pi.filename IS NOT NULL AND pi.filename<>'')`);
  return { whereSql: where.join(' AND '), vals };
}

async function _resolverIdsExportFotos(pool, tb, body = {}) {
  const idsRaw = Array.isArray(body.ids) ? body.ids : [];
  let ids = [...new Set(idsRaw.map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n) && n > 0))];
  const limit = Math.min(
    EXPORT_FOTOS_MAX_PROD,
    Math.max(1, parseInt(body.limit, 10) || EXPORT_FOTOS_MAX_PROD)
  );
  const offset = Math.max(0, parseInt(body.offset, 10) || 0);

  if (ids.length) {
    const total = ids.length;
    ids = ids.slice(offset, offset + limit);
    return { ids, total, limit, offset, hasMore: offset + ids.length < total };
  }

  const { whereSql, vals } = await _buildWhereExportFotos(pool, tb, body);
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM ${tb} p WHERE ${whereSql}`,
    vals
  );
  const totalN = Number(total) || 0;
  if (!totalN) return { ids: [], total: 0, limit, offset, hasMore: false };

  const [rows] = await pool.query(
    `SELECT p.ID AS id FROM ${tb} p WHERE ${whereSql} ORDER BY p.descricao LIMIT ? OFFSET ?`,
    [...vals, limit, offset]
  );
  return {
    ids: rows.map((r) => r.id),
    total: totalN,
    limit,
    offset,
    hasMore: offset + rows.length < totalN,
  };
}

router.post('/exportar-fotos', async (req, res) => {
  try {
    const pool = getPool();
    const tb = await getTabela(pool);
    const body = req.body || {};
    const apenasPrincipal = body.apenas_principal === true || body.apenas_principal === 'S';

    const resolved = await _resolverIdsExportFotos(pool, tb, body);
    if (resolved.error) return res.status(400).json({ error: resolved.error });
    const ids = resolved.ids || [];
    if (!ids.length) {
      return res.status(404).json({ error: 'Nenhum produto com foto local para baixar' });
    }

    const ph = ids.map(() => '?').join(',');
    const [prods] = await pool.query(
      `SELECT ID AS id, cod_fabricante, descricao FROM ${tb} WHERE ID IN (${ph})`,
      ids
    );
    const prodMap = new Map(prods.map((p) => [String(p.id), p]));

    let sqlImg = `
      SELECT cod_produto, filename, is_principal, ordem, id
      FROM produto_imagens
      WHERE cod_produto IN (${ph}) AND filename IS NOT NULL AND filename<>''
    `;
    if (apenasPrincipal) sqlImg += ` AND is_principal=1`;
    sqlImg += ` ORDER BY cod_produto, is_principal DESC, ordem, id`;

    const [imgs] = await pool.query(sqlImg, ids);
    const entries = [];
    const usedNames = new Set();
    const seqByProd = new Map(); // último índice usado no nome (1 = principal)

    for (const img of imgs) {
      const disk = _prodImgDiskPath(img.cod_produto, img.filename);
      if (!fs.existsSync(disk)) continue;
      const prod = prodMap.get(String(img.cod_produto));
      const base = _safeZipBaseName(prod?.cod_fabricante || prod?.id || img.cod_produto);
      const ext = path.extname(img.filename).toLowerCase() || '.jpg';
      let entryName;
      if (img.is_principal) {
        entryName = `${base}${ext}`;
        if (!seqByProd.has(img.cod_produto)) seqByProd.set(img.cod_produto, 1);
      } else {
        const next = (seqByProd.get(img.cod_produto) || 1) + 1;
        seqByProd.set(img.cod_produto, next);
        entryName = `${base}(${next})${ext}`;
      }
      // Colisão (mesmo cód. fabricante em produtos diferentes)
      if (usedNames.has(entryName.toLowerCase())) {
        entryName = `${base}_${img.cod_produto}${img.is_principal ? '' : `(${img.id})`}${ext}`;
      }
      let finalName = entryName;
      let i = 2;
      while (usedNames.has(finalName.toLowerCase())) {
        finalName = `${base}_${img.cod_produto}_${i}${ext}`;
        i++;
      }
      usedNames.add(finalName.toLowerCase());
      entries.push({ disk, name: finalName });
    }

    if (!entries.length) {
      return res.status(404).json({ error: 'Nenhuma foto encontrada no disco para estes produtos' });
    }

    const stamp = new Date().toISOString().slice(0, 10);
    const lote = Math.floor((resolved.offset || 0) / (resolved.limit || EXPORT_FOTOS_MAX_PROD)) + 1;
    const totalLotes = Math.max(1, Math.ceil((resolved.total || ids.length) / (resolved.limit || EXPORT_FOTOS_MAX_PROD)));
    const zipName = ids.length === 1 && !(resolved.total > 1)
      ? `fotos_produto_${ids[0]}_${stamp}.zip`
      : (totalLotes > 1
        ? `fotos_produtos_${stamp}_lote${lote}de${totalLotes}.zip`
        : `fotos_produtos_${stamp}.zip`);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
    res.setHeader('X-Fotos-Exportadas', String(entries.length));
    res.setHeader('X-Produtos-Exportados', String(ids.length));
    res.setHeader('X-Produtos-Total', String(resolved.total || ids.length));
    res.setHeader('X-Export-Offset', String(resolved.offset || 0));
    res.setHeader('X-Export-Limit', String(resolved.limit || EXPORT_FOTOS_MAX_PROD));
    res.setHeader('X-Export-Has-More', resolved.hasMore ? '1' : '0');
    res.setHeader('X-Export-Lote', String(lote));
    res.setHeader('X-Export-Total-Lotes', String(totalLotes));
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Fotos-Exportadas, X-Produtos-Exportados, X-Produtos-Total, X-Export-Offset, X-Export-Limit, X-Export-Has-More, X-Export-Lote, X-Export-Total-Lotes');

    const archive = createZipArchive({ zlib: { level: 6 } });
    archive.on('error', (err) => {
      if (!res.headersSent) res.status(500).json({ error: err.message });
      else res.end();
    });
    archive.pipe(res);
    for (const e of entries) {
      archive.file(e.disk, { name: e.name });
    }
    await archive.finalize();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ─── Promoções — campanhas centralizadas (estilo Mercos) ─────────────────────
router.get('/promocoes/campanhas', async (req, res) => {
  if (!requirePromoAccess(req, res)) return;
  try {
    const pool = getPool();
    const out = await listarCampanhas(pool, {
      q: req.query.q,
      ativo: req.query.ativo,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/promocoes/campanhas/:campanhaId', async (req, res) => {
  if (!requirePromoAccess(req, res)) return;
  try {
    const pool = getPool();
    const id = parseInt(req.params.campanhaId, 10);
    const camp = await getCampanha(pool, id);
    if (!camp) return res.status(404).json({ error: 'Campanha não encontrada' });
    res.json(camp);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/promocoes/campanhas/:campanhaId/produtos', async (req, res) => {
  if (!requirePromoAccess(req, res)) return;
  try {
    const pool = getPool();
    const id = parseInt(req.params.campanhaId, 10);
    const out = await listarProdutosCampanha(pool, getTabela, id, req.query);
    res.status(out.status).json(out.json);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/promocoes/campanhas/:campanhaId/preview', async (req, res) => {
  if (!requirePromoAccess(req, res)) return;
  try {
    const pool = getPool();
    const id = parseInt(req.params.campanhaId, 10);
    if (!id) return res.status(400).json({ error: 'ID inválido' });
    const body = req.body || {};
    const out = await previewDescontoCampanha(pool, getTabela, id, {
      descricao: body.descricao,
      tipo: body.tipo,
      valor: body.valor,
      qtd_minima: body.qtd_minima,
      qtd_simulada: body.qtd_simulada,
      data_inicio: body.data_inicio,
      data_fim: body.data_fim,
      ativo: body.ativo,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.status(out.status).json(out.json);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/promocoes/campanhas', async (req, res) => {
  if (!requirePromoPerm(req, res, 'incluir_promocoes', 'Sem permissão para incluir campanhas de promoção')) return;
  try {
    const pool = getPool();
    const out = await gravarCampanha(pool, req.body || {});
    res.status(out.status).json(out.json);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/promocoes/campanhas/:campanhaId', async (req, res) => {
  if (!requirePromoPerm(req, res, 'alterar_promocoes', 'Sem permissão para alterar campanhas de promoção')) return;
  try {
    const pool = getPool();
    const id = parseInt(req.params.campanhaId, 10);
    if (!id) return res.status(400).json({ error: 'ID inválido' });
    const out = await gravarCampanha(pool, req.body || {}, id);
    res.status(out.status).json(out.json);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/promocoes/campanhas/:campanhaId', async (req, res) => {
  if (!requirePromoPerm(req, res, 'excluir_promocoes', 'Sem permissão para excluir campanhas de promoção')) return;
  try {
    const pool = getPool();
    const id = parseInt(req.params.campanhaId, 10);
    const out = await excluirCampanha(pool, id);
    res.status(out.status).json(out.json);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/promocoes/campanhas/:campanhaId/produtos', async (req, res) => {
  if (!requirePromoPerm(req, res, 'alterar_promocoes', 'Sem permissão para alterar produtos da campanha')) return;
  try {
    const pool = getPool();
    const id = parseInt(req.params.campanhaId, 10);
    const prodIds = req.body?.produtos || req.body?.prod_ids || req.body?.ids || [];
    const out = await adicionarProdutosCampanha(pool, getTabela, id, prodIds);
    res.status(out.status).json(out.json);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/promocoes/campanhas/:campanhaId/escopo', async (req, res) => {
  if (!requirePromoPerm(req, res, 'alterar_promocoes', 'Sem permissão para alterar escopo da campanha')) return;
  try {
    const pool = getPool();
    const id = parseInt(req.params.campanhaId, 10);
    const escopos = req.body?.escopos || (req.body?.tipo ? [req.body] : []);
    const out = await adicionarEscopoCampanha(pool, getTabela, id, escopos);
    res.status(out.status).json(out.json);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/promocoes/campanhas/:campanhaId/materializar', async (req, res) => {
  if (!requirePromoPerm(req, res, 'alterar_promocoes', 'Sem permissão para materializar campanha')) return;
  try {
    const pool = getPool();
    const id = parseInt(req.params.campanhaId, 10);
    const out = await materializarCampanha(pool, getTabela, id);
    res.status(out.status).json(out.json);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/promocoes/acoes-lote', async (req, res) => {
  if (!requirePromoLote(req, res, req.body?.acao)) return;
  try {
    const pool = getPool();
    const out = await acoesLotePromocoes(pool, req.body || {});
    res.status(out.status).json(out.json);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/promocoes/dashboard', async (req, res) => {
  if (!requirePromoAccess(req, res)) return;
  try {
    const pool = getPool();
    const out = await relatorioDashboard(pool, getTabela, {
      dt_inicio: req.query.dt_inicio,
      dt_fim: req.query.dt_fim,
      id_campanha: req.query.id_campanha,
    });
    res.status(out.status).json(out.json);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Destaques comerciais (marketing sem desconto) ───────────────────────────
router.get('/destaques-comerciais', async (req, res) => {
  if (!requirePromoAccess(req, res)) return;
  try {
    const pool = getPool();
    await ensurePromocoesCampanhaTables(pool);
    const out = await listarDestaquesComerciais(pool, getTabela, req.query);
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/destaques-comerciais/:id', async (req, res) => {
  if (!requirePromoAccess(req, res)) return;
  try {
    const pool = getPool();
    await ensurePromocoesCampanhaTables(pool);
    const row = await getDestaqueComercial(pool, getTabela, req.params.id);
    if (!row) return res.status(404).json({ error: 'Destaque não encontrado' });
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/destaques-comerciais', async (req, res) => {
  if (!requirePromoPerm(req, res, 'incluir_promocoes')) return;
  try {
    const pool = getPool();
    await ensurePromocoesCampanhaTables(pool);
    const out = await gravarDestaqueComercial(pool, getTabela, req.body || {});
    if (out.error) return res.status(400).json({ error: out.error });
    res.status(201).json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/destaques-comerciais/:id', async (req, res) => {
  if (!requirePromoPerm(req, res, 'alterar_promocoes')) return;
  try {
    const pool = getPool();
    await ensurePromocoesCampanhaTables(pool);
    const id = parseInt(req.params.id, 10);
    const out = await gravarDestaqueComercial(pool, getTabela, req.body || {}, id);
    if (out.error) return res.status(400).json({ error: out.error });
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/destaques-comerciais/:id', async (req, res) => {
  if (!requirePromoPerm(req, res, 'excluir_promocoes')) return;
  try {
    const pool = getPool();
    await ensurePromocoesCampanhaTables(pool);
    await excluirDestaqueComercial(pool, req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Promoções — lista central e relatório ────────────────────────────────────
router.get('/promocoes/lista', async (req, res) => {
  if (!requirePromoAccess(req, res)) return;
  try {
    const pool = getPool();
    if (!(await tabelaPromocoesExiste(pool))) return res.json({ data: [], total: 0 });

    const tb = await getTabela(pool);
    const somenteAtivas = req.query.ativo !== 'N';
    const q = String(req.query.q || '').trim();
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    let where = `pp.excluido = 'N'`;
    const params = [];
    if (somenteAtivas) {
      where += ` AND pp.ativo = 'S'
        AND (pp.data_inicio IS NULL OR pp.data_inicio <= CURDATE())
        AND (pp.data_fim IS NULL OR pp.data_fim >= CURDATE())`;
    }
    if (q) {
      where += ` AND (pp.descricao LIKE ? OR p.descricao LIKE ? OR CAST(pp.cod_produto AS CHAR) LIKE ?)`;
      const lk = `%${q}%`;
      params.push(lk, lk, lk);
    }

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM produto_promocoes pp
       INNER JOIN ${tb} p ON p.ID = pp.cod_produto
       WHERE ${where}`,
      params
    );

    const [rows] = await pool.query(
      `SELECT pp.*, p.descricao AS nome_produto, p.vlr_venda,
              rr.descricao AS nome_regiao,
              f.nome AS nome_fornecedor,
              c.nome AS nome_cliente
       FROM produto_promocoes pp
       INNER JOIN ${tb} p ON p.ID = pp.cod_produto
       LEFT JOIN regiao_rota rr ON rr.id = pp.id_regiao AND (rr.excluido = 'N' OR rr.excluido IS NULL)
       LEFT JOIN fornecedores f ON f.id = pp.cod_fornecedor AND f.excluido = 'N'
       LEFT JOIN clientes c ON c.id = pp.cod_cliente AND c.excluido = 'N'
       WHERE ${where}
       ORDER BY pp.data_fim IS NULL DESC, pp.data_fim DESC, pp.id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const data = rows.map((r) => ({
      ...formatarPromocaoRow(r, parseFloat(r.vlr_venda) || 0, parseFloat(r.qtd_minima) || 1),
      cod_produto: r.cod_produto,
      nome_produto: r.nome_produto,
      vlr_venda: parseFloat(r.vlr_venda) || 0,
      nome_regiao: r.nome_regiao || null,
      nome_fornecedor: r.nome_fornecedor || null,
      nome_cliente: r.nome_cliente || null,
      dtcadastro: r.dtcadastro,
    }));

    res.json({ data, total: Number(total) || 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/promocoes/relatorio-vendas', async (req, res) => {
  if (!requirePromoAccess(req, res)) return;
  try {
    const pool = getPool();
    await ensureItenspedPromoColumns(pool);
    const tb = await getTabela(pool);
    const dtIni = req.query.dt_inicio || null;
    const dtFim = req.query.dt_fim || null;
    if (!dtIni || !dtFim) {
      return res.status(400).json({ error: 'Informe dt_inicio e dt_fim (YYYY-MM-DD)' });
    }

    const [rows] = await pool.query(
      `SELECT p.numero, p.data_abertura, c.nome AS nome_cliente,
              i.cod_produto, prod.descricao AS nome_produto,
              i.quantidade, i.valor_unitario, i.vlr_padrao,
              prod.vlr_venda,
              i.id_promocao, i.promocao_descricao,
              pp.descricao AS promocao_cadastro, pp.tipo AS promocao_tipo,
              ROUND(i.quantidade * i.valor_unitario, 2) AS total_item,
              CASE WHEN i.id_promocao IS NOT NULL THEN 'campanha'
                   WHEN i.valor_unitario < prod.vlr_venda * 0.995 THEN 'estimado'
                   ELSE 'normal' END AS origem_desconto
       FROM itensped i
       INNER JOIN pedidos p ON p.id = i.id_pedido AND p.excluido = 'N'
       LEFT JOIN clientes c ON c.id = p.cod_cliente
       INNER JOIN ${tb} prod ON prod.ID = i.cod_produto
       LEFT JOIN produto_promocoes pp ON pp.id = i.id_promocao AND pp.excluido = 'N'
       WHERE (i.excluido = 'N' OR i.excluido IS NULL)
         AND p.data_abertura >= ? AND p.data_abertura <= ?
         AND i.valor_unitario > 0
         AND prod.vlr_venda > 0
         AND (
           i.id_promocao IS NOT NULL
           OR i.valor_unitario < prod.vlr_venda * 0.995
         )
       ORDER BY p.data_abertura DESC, p.numero DESC, i.id DESC
       LIMIT 2000`,
      [dtIni, dtFim]
    );

    const resumo = {
      itens: rows.length,
      itens_campanha: rows.filter((r) => r.id_promocao).length,
      itens_estimados: rows.filter((r) => !r.id_promocao).length,
      total_vendido: rows.reduce((s, r) => s + (parseFloat(r.total_item) || 0), 0),
      economia_estimada: rows.reduce((s, r) => {
        const diff = (parseFloat(r.vlr_venda) || 0) - (parseFloat(r.valor_unitario) || 0);
        return s + diff * (parseFloat(r.quantidade) || 0);
      }, 0),
    };

    res.json({ data: rows, resumo });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Promoções por produto (estilo Mercos) ────────────────────────────────────
router.get('/:id/promocoes/resolve', async (req, res) => {
  try {
    const pool = getPool();
    const prodId = parseInt(req.params.id, 10);
    if (!prodId) return res.status(400).json({ error: 'ID inválido' });
    if (!(await tabelaPromocoesExiste(pool))) return res.json(null);

    const tb = await getTabela(pool);
    const [[prod]] = await pool.query(
      `SELECT ID, vlr_venda FROM ${tb} WHERE ID=? AND (excluido='N' OR excluido IS NULL OR excluido='') LIMIT 1`,
      [prodId]
    );
    if (!prod) return res.status(404).json({ error: 'Produto não encontrado' });

    const qtd = parseFloat(req.query.qtd) || 1;
    const ctx = _promoContextoFromQuery(req.query);
    const vlrBase = parseFloat(req.query.vlr_base) || parseFloat(prod.vlr_venda) || 0;
    const promo = await resolverMelhorPromocao(pool, prodId, vlrBase, qtd, ctx);
    res.json(promo);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id/promocoes', async (req, res) => {
  if (!requirePromoAccess(req, res)) return;
  try {
    const pool = getPool();
    const prodId = parseInt(req.params.id, 10);
    if (!prodId) return res.status(400).json({ error: 'ID inválido' });
    if (!(await tabelaPromocoesExiste(pool))) return res.json([]);

    const tb = await getTabela(pool);
    const [[prod]] = await pool.query(
      `SELECT ID, vlr_venda FROM ${tb} WHERE ID=? AND (excluido='N' OR excluido IS NULL OR excluido='') LIMIT 1`,
      [prodId]
    );
    if (!prod) return res.status(404).json({ error: 'Produto não encontrado' });

    const [rows] = await pool.query(
      `SELECT ${PROMO_SELECT_COLS}, dtcadastro
       FROM produto_promocoes
       WHERE cod_produto = ? AND excluido = 'N'
       ORDER BY qtd_minima DESC, id DESC`,
      [prodId]
    );
    const vlrBase = parseFloat(prod.vlr_venda) || 0;
    res.json(rows.map((r) => ({
      ...formatarPromocaoRow(r, vlrBase, parseFloat(r.qtd_minima) || 1),
      dtcadastro: r.dtcadastro,
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/promocoes', async (req, res) => {
  if (!requirePromoPerm(req, res, 'incluir_promocoes', 'Sem permissão para incluir promoções')) return;
  try {
    const pool = getPool();
    const prodId = parseInt(req.params.id, 10);
    if (!prodId) return res.status(400).json({ error: 'ID inválido' });
    if (!(await tabelaPromocoesExiste(pool))) {
      return res.status(503).json({ error: 'Tabela produto_promocoes indisponível. Reinicie o servidor para aplicar migrations.' });
    }
    const out = await _gravarPromocao(pool, prodId, req.body || {});
    res.status(out.status).json(out.json);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id/promocoes/:promoId', async (req, res) => {
  if (!requirePromoPerm(req, res, 'alterar_promocoes', 'Sem permissão para alterar promoções')) return;
  try {
    const pool = getPool();
    const prodId = parseInt(req.params.id, 10);
    const promoId = parseInt(req.params.promoId, 10);
    if (!prodId || !promoId) return res.status(400).json({ error: 'IDs inválidos' });
    if (!(await tabelaPromocoesExiste(pool))) {
      return res.status(503).json({ error: 'Tabela produto_promocoes indisponível.' });
    }

    const [[row]] = await pool.query(
      `SELECT id FROM produto_promocoes WHERE id=? AND cod_produto=? AND excluido='N' LIMIT 1`,
      [promoId, prodId]
    );
    if (!row) return res.status(404).json({ error: 'Promoção não encontrada' });

    const out = await _gravarPromocao(pool, prodId, req.body || {}, promoId);
    res.status(out.status).json(out.json);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id/promocoes/:promoId', async (req, res) => {
  if (!requirePromoPerm(req, res, 'excluir_promocoes', 'Sem permissão para excluir promoções')) return;
  try {
    const pool = getPool();
    const prodId = parseInt(req.params.id, 10);
    const promoId = parseInt(req.params.promoId, 10);
    if (!prodId || !promoId) return res.status(400).json({ error: 'IDs inválidos' });
    if (!(await tabelaPromocoesExiste(pool))) {
      return res.status(503).json({ error: 'Tabela produto_promocoes indisponível.' });
    }

    const [r] = await pool.query(
      `UPDATE produto_promocoes SET excluido='S' WHERE id=? AND cod_produto=? AND excluido='N'`,
      [promoId, prodId]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Promoção não encontrada' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/** Grupo referência mãe + cores (somente leitura — não altera pedido). */
router.get('/:id/variacoes', async (req, res) => {
  try {
    const pool = getPool();
    const grupo = await obterGrupoReferencia(pool, req.params.id);
    if (!grupo) return res.status(404).json({ error: 'Produto não encontrado' });
    res.json(grupo);
  } catch (err) {
    console.error('[produtos/variacoes]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Grades disponíveis do produto (padrão + extras). Sempre seguro se não houver extras. */
router.get('/:id/grades', async (req, res) => {
  try {
    const pool = getPool();
    await ensureProdutoTipogradeTable(pool);
    const grades = await listarGradesProduto(pool, req.params.id);
    res.json({ grades });
  } catch (err) {
    console.error('[produtos/grades]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/produtos/:id ────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const pool = getPool();
    await ensureColunasExtras(pool);
    const tb = await getTabela(pool);
    const cols = await getColunasReais(pool);
    const temIdRef = cols.some((c) => String(c).toLowerCase() === 'id_referencia');
    const temCor1 = cols.some((c) => String(c).toLowerCase() === 'cor1');
    const temDisp = cols.some((c) => String(c).toLowerCase() === 'disponivel');
    const qtdCoresSql = temIdRef
      ? `, ((SELECT COUNT(*) FROM ${tb} c WHERE c.id_referencia = p.ID AND (c.excluido='N' OR c.excluido IS NULL OR c.excluido=''))
          + CASE
              WHEN (p.id_referencia IS NULL OR p.id_referencia = 0)
               AND ${temCor1 ? "TRIM(IFNULL(p.cor1,'')) <> ''" : '0'}
               AND ${temDisp ? "IFNULL(p.disponivel,'S') <> 'N'" : '1'}
              THEN 1 ELSE 0
            END) AS qtd_cores`
      : ', 0 AS qtd_cores';
    const maeNomeSql = temIdRef
      ? `, (SELECT mae.descricao FROM ${tb} mae WHERE mae.ID = p.id_referencia LIMIT 1) AS nome_referencia
         , (SELECT mae.cod_fabricante FROM ${tb} mae WHERE mae.ID = p.id_referencia LIMIT 1) AS cod_fabricante_referencia`
      : ', NULL AS nome_referencia, NULL AS cod_fabricante_referencia';
    const [rows] = await pool.query(
      `SELECT p.*${qtdCoresSql}${maeNomeSql}
       FROM ${tb} p
       WHERE p.ID=? AND (p.excluido='N' OR p.excluido IS NULL OR p.excluido='')
       LIMIT 1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Não encontrado' });
    try {
      rows[0].grades = await listarGradesProduto(pool, req.params.id);
      rows[0].grades_extras = (rows[0].grades || [])
        .filter((g) => !g.padrao)
        .map((g) => g.id);
    } catch (_) {
      rows[0].grades = [];
      rows[0].grades_extras = [];
    }
    res.json(rows[0]);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ─── POST /api/produtos ───────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const pool = getPool();
    await ensureColunasExtras(pool);
    const tb = await getTabela(pool);
    const cols = await getColunasReais(pool);
    let body = aplicarUpper(filtrarBody(req.body, cols));

    if (!body.descricao?.trim()) return res.status(400).json({ error: 'Descrição obrigatória' });
    if (!body.situacao) body.situacao = 'A';
    if (!body.excluido) body.excluido = 'N';

    const valCod = await validarCodFabricanteFornecedor(pool, {
      codFabricante: body.cod_fabricante,
      idFornecedor: body.cod_fornecedorpadrao,
    });
    if (!valCod.ok) return res.status(400).json({ error: valCod.error });

    const refApply = await aplicarIdReferenciaNoBody(pool, req.body, body, null);
    if (!refApply.ok) return res.status(400).json({ error: refApply.error });
    body = refApply.body;

    const keys = Object.keys(body);
    const [r] = await pool.query(
      `INSERT INTO ${tb} (${keys.map(k=>`\`${k}\``).join(',')}, dt_cadastro)
       VALUES (${keys.map(()=>'?').join(',')}, CURDATE())`,
      keys.map(k => body[k] ?? null)
    );
    await syncGradesFromReq(pool, r.insertId, req.body, body.tipograde).catch(() => {});
    res.status(201).json({ ok: true, id: r.insertId });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ─── PUT /api/produtos/:id ────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const pool = getPool();
    await ensureColunasExtras(pool);
    const tb = await getTabela(pool);
    const cols = await getColunasReais(pool);
    let body = aplicarUpper(filtrarBody(req.body, cols));

    if (!body.descricao?.trim()) return res.status(400).json({ error: 'Descrição obrigatória' });

    let codFabCheck = body.cod_fabricante;
    let idFornCheck = body.cod_fornecedorpadrao;
    if (codFabCheck === undefined || idFornCheck === undefined) {
      const [[cur]] = await pool.query(
        `SELECT cod_fabricante, cod_fornecedorpadrao FROM ${tb} WHERE ID = ? LIMIT 1`,
        [req.params.id]
      ).catch(() => [[null]]);
      if (codFabCheck === undefined) codFabCheck = cur?.cod_fabricante;
      if (idFornCheck === undefined) idFornCheck = cur?.cod_fornecedorpadrao;
    }

    const valCod = await validarCodFabricanteFornecedor(pool, {
      codFabricante: codFabCheck,
      idFornecedor: idFornCheck,
      excludeId: req.params.id,
    });
    if (!valCod.ok) return res.status(400).json({ error: valCod.error });

    const refApply = await aplicarIdReferenciaNoBody(pool, req.body, body, req.params.id);
    if (!refApply.ok) return res.status(400).json({ error: refApply.error });
    body = refApply.body;

    const keys = Object.keys(body);
    if (!keys.length) return res.status(400).json({ error: 'Nenhum campo para atualizar' });

    await pool.query(
      `UPDATE ${tb} SET ${keys.map(k=>`\`${k}\`=?`).join(',')}, dt_atualizacao=NOW() WHERE ID=?`,
      [...keys.map(k => body[k] ?? null), req.params.id]
    );

    let tipogradeSalvo = body.tipograde;
    if (tipogradeSalvo === undefined) {
      const [[curTg]] = await pool.query(
        `SELECT tipograde FROM ${tb} WHERE ID=? LIMIT 1`,
        [req.params.id]
      ).catch(() => [[null]]);
      tipogradeSalvo = curTg?.tipograde;
    }
    await syncGradesFromReq(pool, req.params.id, req.body, tipogradeSalvo).catch(() => {});

    res.json({ ok: true, id: parseInt(req.params.id) });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ─── PUT /api/produtos/:id/ativar ─────────────────────────────────────────────
router.put('/:id/ativar', async (req, res) => {
  try {
    const pool = getPool();
    const tb = await getTabela(pool);
    await pool.query(`UPDATE ${tb} SET situacao='A', dt_atualizacao=NOW() WHERE ID=?`, [req.params.id]);
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ─── PUT /api/produtos/:id/inativar ──────────────────────────────────────────
router.put('/:id/inativar', async (req, res) => {
  try {
    const pool = getPool();
    const tb = await getTabela(pool);
    await pool.query(`UPDATE ${tb} SET situacao='I', dt_atualizacao=NOW() WHERE ID=?`, [req.params.id]);
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ─── DELETE /api/produtos/:id (soft) ─────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const pool = getPool();
    const tb = await getTabela(pool);
    await pool.query(
      `UPDATE ${tb} SET excluido='S', situacao='E', dt_atualizacao=NOW() WHERE ID=?`,
      [req.params.id]
    );
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ─── Venda Múltipla ──────────────────────────────────────────────────────────
async function ensureMultiplosTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS produto_multiplos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      cod_produto INT NOT NULL,
      sigla VARCHAR(20) NOT NULL,
      descricao VARCHAR(100) NULL,
      fator DECIMAL(10,4) NOT NULL DEFAULT 1.0000,
      excluido ENUM('S','N') NOT NULL DEFAULT 'N',
      INDEX idx_pm_produto (cod_produto)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3
  `).catch(() => {});
}

router.get('/:id/multiplos', async (req, res) => {
  try {
    const pool = getPool();
    await ensureMultiplosTable(pool);
    const [rows] = await pool.query(
      `SELECT id, sigla, descricao, fator FROM produto_multiplos
       WHERE cod_produto = ? AND excluido = 'N' ORDER BY fator ASC, id ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ ok: false, msg: err.message }); }
});

router.post('/:id/multiplos', async (req, res) => {
  const sigla = String(req.body.sigla || '').toUpperCase().trim();
  const descricao = String(req.body.descricao || '').trim() || null;
  const fator = parseFloat(req.body.fator) || 1;
  if (!sigla) return res.json({ ok: false, msg: 'Sigla obrigatória.' });
  try {
    const pool = getPool();
    await ensureMultiplosTable(pool);
    const [r] = await pool.query(
      `INSERT INTO produto_multiplos (cod_produto, sigla, descricao, fator) VALUES (?, ?, ?, ?)`,
      [req.params.id, sigla, descricao, fator]
    );
    res.json({ ok: true, id: r.insertId, sigla, descricao, fator });
  } catch (err) { res.status(500).json({ ok: false, msg: err.message }); }
});

router.delete('/multiplos/:mId', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(`UPDATE produto_multiplos SET excluido = 'S' WHERE id = ?`, [req.params.mId]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, msg: err.message }); }
});

module.exports = router;
