const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { getPool } = require('../config/database');
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
    val.syncPrecopromo,
  ];

  if (promoId) {
    await pool.query(
      `UPDATE produto_promocoes SET
         descricao=?, tipo=?, valor=?, qtd_minima=?, data_inicio=?, data_fim=?, destaque=?, ativo=?,
         cod_cliente=?, id_regiao=?, cod_fornecedor=?, id_tabela_preco=?, sync_precopromo=?
       WHERE id=? AND cod_produto=?`,
      [...params, promoId, prodId]
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
        cod_cliente, id_regiao, cod_fornecedor, id_tabela_preco, sync_precopromo)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [prodId, ...params]
  );
  if (val.syncPrecopromo === 'S' && body.ativo !== 'N') {
    await sincronizarPrecopromoLegado(pool, tb, prodId, {
      tipo: val.tipoNorm, valor: val.val, qtd_minima: val.qtdMin, ativo: 'S', sync_precopromo: 'S',
    }, prod.vlr_venda);
  }
  return { status: 201, json: { ok: true, id: r.insertId } };
}

// ─── cache DESCRIBE ───────────────────────────────────────────────────────────
let _colunasCache = null;
async function getColunasReais(pool) {
  if (_colunasCache) return _colunasCache;
  const tb = await getTabela(pool);
  const [rows] = await pool.query(`DESCRIBE ${tb}`);
  _colunasCache = rows.map(r => r.Field);
  return _colunasCache;
}

let _colunasExtrasMigrated = false;
async function ensureColunasExtras(pool) {
  if (_colunasExtrasMigrated) return;
  const tb = await getTabela(pool);
  await pool.query(
    `ALTER TABLE ${tb} ADD COLUMN multiplo_venda INT NOT NULL DEFAULT 1 COMMENT 'Multiplo de venda (qtd deve ser multiplo deste valor)'`
  ).catch(() => {});
  await pool.query(
    `ALTER TABLE ${tb} ADD COLUMN segmento VARCHAR(100) NULL DEFAULT NULL COMMENT 'Segmento/categoria do produto'`
  ).catch(() => {});
  _colunasCache = null;
  _colunasExtrasMigrated = true;
}

function filtrarBody(body, colunas) {
  // skip pk e campos de data/controle gerenciados pelo servidor
  const skip = ['ID','id','excluido','dt_cadastro','dt_atualizacao','user_atualizacao','status_sinc'];
  const colsLower = colunas.map(c => c.toLowerCase());
  return Object.fromEntries(
    Object.entries(body).filter(([k, v]) => {
      if (v === undefined || v === null) return false;
      return colsLower.includes(k.toLowerCase()) && !skip.map(s=>s.toLowerCase()).includes(k.toLowerCase());
    })
  );
}

const UPPER_CAMPOS = ['descricao','apelido','segmento','unidade','marca','solado','obs','obs2','cor1','cor2','nome_grupo'];
function aplicarUpper(body) {
  UPPER_CAMPOS.forEach(c => { if (body[c]) body[c] = String(body[c]).toUpperCase().trim(); });
  return body;
}

// tabela pode ser "produto" ou "produtos" — detecta automaticamente
let _tabela = null;
async function getTabela(pool) {
  if (_tabela) return _tabela;
  const [rows] = await pool.query(`SHOW TABLES LIKE 'produto'`);
  _tabela = rows.length ? 'produto' : 'produtos';
  return _tabela;
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

    const selectExtras = [
      temSegmento   ? 'p.segmento'    : null,
      temFotoPrinc  ? 'p.foto_principal' : null,
    ].filter(Boolean).join(', ');

    const joinForn = temFornPadrao
      ? `LEFT JOIN fornecedores f ON f.id = p.cod_fornecedorpadrao`
      : '';
    const nomeFabSelect = temFornPadrao ? ', f.nome AS nome_fabricante' : '';

    const [rows] = await pool.query(
      `SELECT p.ID AS id, p.descricao, p.apelido, p.cod_barras, p.cod_fabricante,
              p.unidade, p.kilo_embalagem, p.vlr_venda, p.estoque_atual,
              p.estoque_minimo, p.situacao, p.disponivel, p.kit,
              p.nome_grupo, p.dt_cadastro${nomeFabSelect}${selectExtras ? ', '+selectExtras : ''}
       FROM ${tb} p ${joinForn}
       WHERE ${wc}
       ORDER BY p.descricao
       LIMIT ? OFFSET ?`,
      [...vals, parseInt(limit), parseInt(offset)]
    );

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
function _prodImgDiskPath(prodId, filename) {
  return path.join(_uploadsBase, String(prodId), filename);
}

function _prodImgPublicUrl(prodId, filename) {
  return `/uploads/produtos/${prodId}/${filename}`;
}

router.get('/:id/imagens', async (req, res) => {
  try {
    const pool = getPool();
    const prodId = String(req.params.id);
    const [rows] = await pool.query(
      `SELECT id, filename, is_principal, ordem, dt_upload
       FROM produto_imagens WHERE cod_produto=?
       ORDER BY is_principal DESC, ordem, id`,
      [prodId]
    );
    const imgs = rows
      .filter(r => r.filename && fs.existsSync(_prodImgDiskPath(prodId, r.filename)))
      .map(r => ({
        ...r,
        url: _prodImgPublicUrl(prodId, r.filename)
      }));
    res.json(imgs);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

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
        await pool.query(
          `UPDATE ${tb} SET foto_principal=?, dt_atualizacao=NOW() WHERE ID=?`,
          [`/uploads/produtos/${id}/${file.filename}`, id]
        );
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

    const [[img]] = await pool.query(
      `SELECT * FROM produto_imagens WHERE id=? AND cod_produto=?`, [imgId, id]
    );
    if (!img) return res.status(404).json({ error: 'Imagem não encontrada' });

    await pool.query(`UPDATE produto_imagens SET is_principal=0 WHERE cod_produto=?`, [id]);
    await pool.query(`UPDATE produto_imagens SET is_principal=1 WHERE id=?`, [imgId]);
    await pool.query(
      `UPDATE ${tb} SET foto_principal=?, dt_atualizacao=NOW() WHERE ID=?`,
      [`/uploads/produtos/${id}/${img.filename}`, id]
    );

    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ─── DELETE /api/produtos/:id/imagens/:imgId ─────────────────────────────────
router.delete('/:id/imagens/:imgId', async (req, res) => {
  try {
    const pool = getPool();
    const tb   = await getTabela(pool);
    const { id, imgId } = req.params;

    const [[img]] = await pool.query(
      `SELECT * FROM produto_imagens WHERE id=? AND cod_produto=?`, [imgId, id]
    );
    if (!img) return res.status(404).json({ error: 'Imagem não encontrada' });

    fs.rmSync(path.join(_uploadsBase, String(id), img.filename), { force: true });
    await pool.query(`DELETE FROM produto_imagens WHERE id=?`, [imgId]);

    if (img.is_principal) {
      const [[next]] = await pool.query(
        `SELECT * FROM produto_imagens WHERE cod_produto=? ORDER BY id LIMIT 1`, [id]
      );
      if (next) {
        await pool.query(`UPDATE produto_imagens SET is_principal=1 WHERE id=?`, [next.id]);
        await pool.query(
          `UPDATE ${tb} SET foto_principal=?, dt_atualizacao=NOW() WHERE ID=?`,
          [`/uploads/produtos/${id}/${next.filename}`, id]
        );
      } else {
        await pool.query(
          `UPDATE ${tb} SET foto_principal=NULL, dt_atualizacao=NOW() WHERE ID=?`, [id]
        );
      }
    }

    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

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

// ─── Promoções — lista central e relatório ────────────────────────────────────
router.get('/promocoes/lista', async (req, res) => {
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
      nome_regiao: r.nome_regiao || null,
      nome_fornecedor: r.nome_fornecedor || null,
      nome_cliente: r.nome_cliente || null,
      dtcadastro: r.dtcadastro,
    }));

    res.json({ data, total: Number(total) || 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/promocoes/relatorio-vendas', async (req, res) => {
  try {
    const pool = getPool();
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
              ROUND(i.quantidade * i.valor_unitario, 2) AS total_item
       FROM itensped i
       INNER JOIN pedidos p ON p.id = i.id_pedido AND p.excluido = 'N'
       LEFT JOIN clientes c ON c.id = p.cod_cliente
       INNER JOIN ${tb} prod ON prod.ID = i.cod_produto
       WHERE (i.excluido = 'N' OR i.excluido IS NULL)
         AND p.data_abertura >= ? AND p.data_abertura <= ?
         AND i.valor_unitario > 0
         AND prod.vlr_venda > 0
         AND i.valor_unitario < prod.vlr_venda * 0.995
       ORDER BY p.data_abertura DESC, p.numero DESC, i.id DESC
       LIMIT 2000`,
      [dtIni, dtFim]
    );

    const resumo = {
      itens: rows.length,
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

// ─── GET /api/produtos/:id ────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const pool = getPool();
    const tb = await getTabela(pool);
    const [rows] = await pool.query(
      `SELECT * FROM ${tb} WHERE ID=? AND (excluido='N' OR excluido IS NULL OR excluido='') LIMIT 1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Não encontrado' });
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
    const body = aplicarUpper(filtrarBody(req.body, cols));

    if (!body.descricao?.trim()) return res.status(400).json({ error: 'Descrição obrigatória' });
    if (!body.situacao) body.situacao = 'A';
    if (!body.excluido) body.excluido = 'N';

    const keys = Object.keys(body);
    const [r] = await pool.query(
      `INSERT INTO ${tb} (${keys.map(k=>`\`${k}\``).join(',')}, dt_cadastro)
       VALUES (${keys.map(()=>'?').join(',')}, CURDATE())`,
      keys.map(k => body[k] ?? null)
    );
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
    const body = aplicarUpper(filtrarBody(req.body, cols));

    if (!body.descricao?.trim()) return res.status(400).json({ error: 'Descrição obrigatória' });

    const keys = Object.keys(body);
    if (!keys.length) return res.status(400).json({ error: 'Nenhum campo para atualizar' });

    await pool.query(
      `UPDATE ${tb} SET ${keys.map(k=>`\`${k}\`=?`).join(',')}, dt_atualizacao=NOW() WHERE ID=?`,
      [...keys.map(k => body[k] ?? null), req.params.id]
    );
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
