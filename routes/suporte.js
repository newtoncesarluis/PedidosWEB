const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

const { getNREPool }        = require('../config/db-nresolution');
const { authMiddleware }    = require('../middleware/auth');
const { sendMail }          = require('../config/mailer');
const { sendMessage }       = require('../config/alert');

// ── Upload ──────────────────────────────────────────────────────────────────

const ALLOWED_MIMES = {
  'image/jpeg': 'imagem', 'image/jpg': 'imagem', 'image/png': 'imagem',
  'image/gif': 'imagem',  'image/webp': 'imagem',
  'video/mp4': 'video',   'video/webm': 'video', 'video/quicktime': 'video',
  'audio/mpeg': 'audio',  'audio/mp3': 'audio',  'audio/wav': 'audio',
  'audio/ogg': 'audio',   'audio/x-m4a': 'audio','audio/aac': 'audio',
  'audio/mp4': 'audio',
};

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const tmpDir = path.join(process.cwd(), 'public', 'uploads', 'solicitacoes', 'tmp');
    fs.mkdirSync(tmpDir, { recursive: true });
    cb(null, tmpDir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { files: 10, fileSize: 50 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (ALLOWED_MIMES[file.mimetype]) cb(null, true);
    else cb(new Error(`Tipo não suportado: ${file.mimetype}`));
  },
});

// ── Auth ────────────────────────────────────────────────────────────────────
router.use(authMiddleware);

// ── Multer wrapper — retorna JSON mesmo em erro de validação ─────────────────
function uploadMiddleware(req, res, next) {
  upload.array('anexos', 10)(req, res, err => {
    if (!err) return next();
    const msg = err.code === 'LIMIT_FILE_SIZE'
      ? 'Arquivo muito grande (máx. 50 MB por arquivo)'
      : err.code === 'LIMIT_FILE_COUNT'
        ? 'Máximo de 10 arquivos por solicitação'
        : err.message || 'Erro no upload';
    res.status(400).json({ error: msg });
  });
}

// ── POST /api/suporte/solicitar ──────────────────────────────────────────────
router.post('/solicitar', uploadMiddleware, async (req, res) => {
  const { titulo, descricao, tipo = 'melhoria', origem } = req.body;
  const chave_licenca = req.user?.chave_licenca;

  if (!titulo || !descricao || !origem) {
    (req.files || []).forEach(f => { try { fs.unlinkSync(f.path); } catch {} });
    return res.status(400).json({ error: 'Título, descrição e origem são obrigatórios' });
  }
  if (!chave_licenca) {
    (req.files || []).forEach(f => { try { fs.unlinkSync(f.path); } catch {} });
    return res.status(400).json({ error: 'Licença não identificada' });
  }

  const pool = getNREPool();
  try {
    const [result] = await pool.query(
      `INSERT INTO solicitacoes (chave_licenca, titulo, descricao, tipo, origem) VALUES (?, ?, ?, ?, ?)`,
      [chave_licenca, titulo.trim(), descricao.trim(), tipo, origem]
    );
    const id = result.insertId;

    const files = req.files || [];
    if (files.length) {
      const destDir = path.join(process.cwd(), 'public', 'uploads', 'solicitacoes', String(id));
      fs.mkdirSync(destDir, { recursive: true });
      for (const file of files) {
        const destPath = path.join(destDir, path.basename(file.path));
        fs.renameSync(file.path, destPath);
        const tipoArquivo = ALLOWED_MIMES[file.mimetype] || 'imagem';
        await pool.query(
          `INSERT INTO solicitacoes_anexos (id_solicitacao, tipo, caminho, nome_original, tamanho) VALUES (?, ?, ?, ?, ?)`,
          [id, tipoArquivo, `/uploads/solicitacoes/${id}/${path.basename(destPath)}`, file.originalname, file.size]
        );
      }
    }

    // Notifica desenvolvedor por e-mail
    const baseUrl   = process.env.BASE_URL || 'https://pedidos.nresolutions.com.br';
    const devEmail  = process.env.DEV_EMAIL || 'newton.bauru@gmail.com';
    const tipoLabel = { ideia: 'Ideia', bug: 'Bug', melhoria: 'Melhoria', duvida: 'Dúvida' }[tipo] || tipo;
    const origemIco = origem === 'mobile' ? '📱 Mobile' : '🖥️ Desktop';
    sendMail({
      to: devEmail,
      subject: `[Suporte #${id}] ${titulo} — ${chave_licenca}`,
      html: `
        <div style="font-family:Inter,sans-serif;max-width:600px;color:#1e293b">
          <div style="background:#0ea5e9;padding:16px 24px;border-radius:12px 12px 0 0">
            <h2 style="color:#fff;margin:0;font-size:1.1rem">📬 Nova Solicitação #${id}</h2>
          </div>
          <div style="background:#f8fafc;padding:20px 24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px">
            <table style="width:100%;border-collapse:collapse;font-size:.9rem">
              <tr><td style="color:#64748b;padding:4px 0;width:100px">Licença:</td><td><strong>${chave_licenca}</strong></td></tr>
              <tr><td style="color:#64748b;padding:4px 0">Tipo:</td><td>${tipoLabel}</td></tr>
              <tr><td style="color:#64748b;padding:4px 0">Origem:</td><td>${origemIco}</td></tr>
            </table>
            <h3 style="margin:16px 0 8px;font-size:1rem">${titulo}</h3>
            <p style="white-space:pre-wrap;background:#fff;padding:12px;border-radius:8px;border:1px solid #e2e8f0;font-size:.88rem;color:#334155">${descricao}</p>
            ${files.length ? `<p style="color:#64748b;font-size:.82rem">📎 ${files.length} anexo(s) enviado(s)</p>` : ''}
            <a href="${baseUrl}/licencas.html" style="display:inline-block;background:#0ea5e9;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;margin-top:12px;font-size:.88rem;font-weight:600">Ver no Painel de Licenças →</a>
          </div>
        </div>`,
    }).catch(err => console.error('[suporte] e-mail não enviado:', err.message));

    // WhatsApp para o dev (usa ALERTA_WHATSAPP + instância configurada)
    const horaStr = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
    const tipoEmoji = { ideia: '✨', bug: '🐛', melhoria: '💡', duvida: '❓' }[tipo] || '📌';
    const origemEmoji = origem === 'mobile' ? '📱' : '🖥️';
    sendMessage(
      `📬 *Nova Solicitação #${id}*\n🔑 ${chave_licenca}\n${tipoEmoji} ${tipo} · ${origemEmoji} ${origem}\n📝 *${titulo}*\n\n${descricao.slice(0, 200)}${descricao.length > 200 ? '…' : ''}${files.length ? `\n📎 ${files.length} anexo(s)` : ''}\n🕐 ${horaStr}`
    ).catch(() => {});

    res.json({ sucesso: true, id });
  } catch (err) {
    (req.files || []).forEach(f => { try { fs.unlinkSync(f.path); } catch {} });
    console.error('[suporte] Erro ao criar solicitação:', err.message);
    res.status(500).json({ error: 'Erro ao registrar solicitação' });
  }
});

// ── GET /api/suporte/minhas ─────────────────────────────────────────────────
router.get('/minhas', async (req, res) => {
  const chave_licenca = req.user?.chave_licenca;
  if (!chave_licenca) return res.status(400).json({ error: 'Licença não identificada' });
  try {
    const [rows] = await getNREPool().query(
      `SELECT id, titulo, tipo, origem, status, resposta_dev, data_criacao, data_atualizacao,
              (SELECT COUNT(*) FROM solicitacoes_anexos WHERE id_solicitacao = s.id) AS qtd_anexos
       FROM solicitacoes s
       WHERE chave_licenca = ?
       ORDER BY data_criacao DESC`,
      [chave_licenca]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/suporte/:id ────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const chave_licenca = req.user?.chave_licenca;
  if (!chave_licenca) return res.status(400).json({ error: 'Licença não identificada' });
  try {
    const pool = getNREPool();
    const [[sol]] = await pool.query(
      `SELECT * FROM solicitacoes WHERE id = ? AND chave_licenca = ?`,
      [req.params.id, chave_licenca]
    );
    if (!sol) return res.status(404).json({ error: 'Solicitação não encontrada' });
    const [anexos] = await pool.query(
      `SELECT id, tipo, caminho, nome_original, tamanho FROM solicitacoes_anexos WHERE id_solicitacao = ? ORDER BY id`,
      [sol.id]
    );
    res.json({ ...sol, anexos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
