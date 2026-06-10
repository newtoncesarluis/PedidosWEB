const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getPool, runWithRequestPool } = require('../config/database');

const _plUploadBase = path.join(process.cwd(), 'public', 'uploads', 'parametro_locais');
const _plStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(_plUploadBase, { recursive: true });
    cb(null, _plUploadBase);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '') || '.png';
    const base = path.basename(file.originalname || 'logo', ext).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    cb(null, `logo_${Date.now()}_${base}${ext}`);
  },
});
const uploadPlLogo = multer({
  storage: _plStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const name = file.originalname || '';
    const ok = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(name);
    cb(ok ? null : new Error('Use imagem JPG, PNG, GIF, WebP ou SVG'), ok);
  },
});

async function ensureParametroLocaisTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS parametro_locais (
      id INT NOT NULL PRIMARY KEY,
      logo_relatorio VARCHAR(512) NULL DEFAULT NULL,
      logo_tamanho_relatorio VARCHAR(1) NULL DEFAULT 'M',
      fonte_padrao VARCHAR(200) NULL DEFAULT NULL,
      dt_alteracao DATETIME NULL,
      id_usuario_alterou INT NULL,
      excluido CHAR(1) DEFAULT 'N'
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `).catch(() => {});
  await pool.query(`INSERT IGNORE INTO parametro_locais (id, excluido) VALUES (1, 'N')`).catch(() => {});
}

function normLogoTamanho(v) {
  const c = String(v || 'M').toUpperCase();
  return ['P', 'M', 'G'].includes(c) ? c : 'M';
}

async function getParametroLocais(pool) {
  await ensureParametroLocaisTable(pool);
  const [[row]] = await pool.query(
    `SELECT id, logo_relatorio, logo_tamanho_relatorio, fonte_padrao, dt_alteracao
     FROM parametro_locais WHERE id = 1 AND COALESCE(excluido,'N') = 'N' LIMIT 1`
  ).catch(() => [[]]);
  if (!row) {
    return { logo_relatorio: null, logo_tamanho_relatorio: 'M', fonte_padrao: null };
  }

  let logoRel = row.logo_relatorio || null;
  const fp = fsPathFromPlLogoRel(logoRel);
  if (logoRel && (!fp || !fs.existsSync(fp))) {
    const files = fs.existsSync(_plUploadBase)
      ? fs.readdirSync(_plUploadBase)
          .filter(f => /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(f))
          .sort((a, b) => b.localeCompare(a))
      : [];
    logoRel = files.length ? webPathPlLogo(files[0]) : null;
    if (logoRel !== (row.logo_relatorio || null)) {
      await pool.query(
        `UPDATE parametro_locais SET logo_relatorio = ? WHERE id = 1`,
        [logoRel]
      ).catch(() => {});
    }
  }

  return {
    logo_relatorio: logoRel,
    logo_tamanho_relatorio: normLogoTamanho(row.logo_tamanho_relatorio),
    fonte_padrao: row.fonte_padrao || null,
  };
}

function webPathPlLogo(filename) {
  return `/uploads/parametro_locais/${filename}`;
}

function fsPathFromPlLogoRel(rel) {
  if (!rel || typeof rel !== 'string') return null;
  const m = rel.match(/^\/uploads\/parametro_locais\/([^/]+)$/);
  if (!m) return null;
  const fn = m[1];
  if (!fn || fn.includes('..') || /[\\/]/.test(fn)) return null;
  return path.join(_plUploadBase, fn);
}

function tryUnlinkPlLogoFile(rel) {
  const fp = fsPathFromPlLogoRel(rel);
  if (fp && fs.existsSync(fp)) {
    try { fs.unlinkSync(fp); } catch (_) {}
  }
}

// GET /api/parametro-locais — leitura (autenticado)
router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    const data = await getParametroLocais(pool);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/parametro-locais — texto (fonte, tamanho logo)
router.put('/', async (req, res) => {
  try {
    const pool = getPool();
    await ensureParametroLocaisTable(pool);
    const b = req.body || {};
    const fonte = typeof b.fonte_padrao === 'string' ? b.fonte_padrao.trim().slice(0, 200) : null;
    const tam = normLogoTamanho(b.logo_tamanho_relatorio);
    const uid = req.user?.id || null;
    await pool.query(
      `UPDATE parametro_locais SET fonte_padrao=?, logo_tamanho_relatorio=?, dt_alteracao=NOW(), id_usuario_alterou=?
       WHERE id=1 AND COALESCE(excluido,'N')='N'`,
      [fonte || null, tam, uid]
    );
    res.json({ ok: true, ...(await getParametroLocais(pool)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/parametro-locais/logo
router.post('/logo', uploadPlLogo.single('logo'), async (req, res) => {
  const handler = async () => {
    try {
      const pool = getPool();
      await ensureParametroLocaisTable(pool);
      if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado (campo logo)' });
      const [[row]] = await pool.query(`SELECT logo_relatorio FROM parametro_locais WHERE id=1 LIMIT 1`).catch(() => [[]]);
      if (row && row.logo_relatorio) tryUnlinkPlLogoFile(row.logo_relatorio);
      const webPath = webPathPlLogo(req.file.filename);
      const uid = req.user?.id || null;
      await pool.query(
        `UPDATE parametro_locais SET logo_relatorio=?, dt_alteracao=NOW(), id_usuario_alterou=? WHERE id=1`,
        [webPath, uid]
      );
      res.json({ ok: true, logo_relatorio: webPath });
    } catch (err) {
      if (req.file?.path) { try { fs.unlinkSync(req.file.path); } catch (_) {} }
      res.status(500).json({ error: err.message });
    }
  };

  try {
    return runWithRequestPool(req, handler);
  } catch (err) {
    if (req.file?.path) { try { fs.unlinkSync(req.file.path); } catch (_) {} }
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/parametro-locais/logo
router.delete('/logo', async (req, res) => {
  try {
    const pool = getPool();
    await ensureParametroLocaisTable(pool);
    const [[row]] = await pool.query(`SELECT logo_relatorio FROM parametro_locais WHERE id=1 LIMIT 1`);
    if (row && row.logo_relatorio) tryUnlinkPlLogoFile(row.logo_relatorio);
    await pool.query(`UPDATE parametro_locais SET logo_relatorio=NULL, dt_alteracao=NOW(), id_usuario_alterou=? WHERE id=1`, [
      req.user?.id || null,
    ]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.getParametroLocais = getParametroLocais;
router.ensureParametroLocaisTable = ensureParametroLocaisTable;
module.exports = router;
