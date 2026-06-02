const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const { importarNFe } = require('../services/nfe-service');
const { logError }    = require('../config/logger');

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if (!file.originalname.match(/\.xml$/i))
      return cb(new Error('Apenas arquivos .xml são aceitos'));
    cb(null, true);
  }
});

// Mapeia código de negócio → HTTP status
const STATUS_MAP = {
  FORNECEDOR_VAZIO: 400,
  XML_AUSENTE:      400,
  XML_INVALIDO:     422,
  XML_SEM_ITENS:    422,
  NOTA_DUPLICADA:   409
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/xml/importar
// Body: multipart/form-data
//   xml        — arquivo .xml da NF-e
//   fornecedor — JSON: { id, nome, produtofornecedor }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/importar', upload.single('xml'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Arquivo XML não enviado', code: 'XML_AUSENTE' });
  }

  let fornecedor = null;
  try {
    fornecedor = req.body.fornecedor ? JSON.parse(req.body.fornecedor) : null;
  } catch {
    return res.status(400).json({ error: 'Campo fornecedor inválido (JSON esperado)', code: 'FORNECEDOR_INVALIDO' });
  }

  try {
    const resultado = await importarNFe({
      xmlBuffer: req.file.buffer,
      fornecedor,
      user: req.user
    });
    res.json({ ok: true, ...resultado });
  } catch (err) {
    const code   = err.code ?? 'ERRO_IMPORTACAO';
    const status = STATUS_MAP[code] ?? 500;
    if (status === 500) logError('POST /api/xml/importar', err);
    res.status(status).json({ error: err.message, code });
  }
});

module.exports = router;
