const express  = require('express');
const multer   = require('multer');
const { importarExcel } = require('../services/excel-service');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const ok = /\.(xlsx|xls|csv)$/i.test(file.originalname);
    cb(ok ? null : new Error('Apenas arquivos .xlsx / .xls / .csv são aceitos'), ok);
  }
});

router.post('/importar', upload.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

    let fornecedor = {};
    try { fornecedor = JSON.parse(req.body.fornecedor || '{}'); } catch { /* ok */ }

    const resultado = await importarExcel({
      buffer:     req.file.buffer,
      fornecedor,
      user:       req.user
    });

    res.json(resultado);
  } catch (err) {
    const status =
      err.code === 'FORNECEDOR_VAZIO' ? 400 :
      err.code === 'EXCEL_INVALIDO'   ? 422 : 500;
    res.status(status).json({ error: err.message, code: err.code });
  }
});

module.exports = router;
