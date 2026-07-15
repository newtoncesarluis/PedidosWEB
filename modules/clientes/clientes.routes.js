'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('./clientes.controller');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { getPool, runWithRequestPool } = require('../../config/database');

// ─── Multer: upload de fotos do cliente ───────────────────────────────────────
const _uploadsBase = path.join(process.cwd(), 'public', 'uploads', 'clientes');
const _storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(_uploadsBase, String(req.params.id));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `${Date.now()}_${base}${ext}`);
  }
});
const _upload = multer({
  storage: _storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(jpg|jpeg|png|gif|webp|bmp|svg|pdf)$/i.test(file.originalname);
    cb(ok ? null : new Error('Tipo de arquivo não permitido'), ok);
  }
});

let _temClienteFotos = null;
async function temClienteFotos(pool) {
  if (_temClienteFotos !== null) return _temClienteFotos;
  try {
    const [r] = await pool.query("SHOW TABLES LIKE 'cliente_fotos'");
    _temClienteFotos = r.length > 0;
  } catch { _temClienteFotos = false; }
  return _temClienteFotos;
}

function _permCli(req) {
  const isAdmin = req.user?.perfil == 1;
  const p = req.user?.permissoes || {};
  const s = (k) => (isAdmin ? 'S' : (p[k] || 'N'));
  return { isAdmin, alterar: s('alterar_clientes') };
}

// ─── Rotas de auxiliares (antes de /:id para evitar conflito) ─────────────────
router.get('/auxiliares/:tipo', ctrl.auxiliares);
router.get('/consulta-cnpj/:cnpj', ctrl.consultarCNPJ);
router.get('/check-cnpj',          ctrl.checkCnpj);
router.get('/notificacoes',        ctrl.notificacoes);
router.get('/aniversariantes',     ctrl.aniversariantes);
router.post('/atualizar-ultima-compra', ctrl.atualizarUltimaCompra);
router.post('/dias-aviso',              ctrl.atualizarDiasAviso);

// ─── Exclusão de sub-registros ────────────────────────────────────────────────
router.delete('/contatos/:id', ctrl.excluirContato);
router.delete('/socios/:id', ctrl.excluirSocio);
router.delete('/faturamento/:id', ctrl.excluirFaturamento);
router.delete('/ref-bancarias/:id', ctrl.excluirRefBancaria);
router.delete('/ref-comerciais/:id', ctrl.excluirRefComercial);

// ─── Compat: rota antiga usada pelo frontend ──────────────────────────────────
router.get('/lookup/vendedores', ctrl.auxiliaresVendedores);

// ─── Histórico e Financeiro de pedidos por cliente ────────────────────────────────────────
router.get('/:id/historico',            ctrl.historicoLista);
router.get('/:id/historico/:numpedido', ctrl.historicoDetalhe);
router.get('/:id/financeiro',           ctrl.financeiro);
router.get('/:id/ligacoes',             ctrl.ligacoes);
router.get('/:id/mensagens',            ctrl.mensagensLista);

// ─── CRUD principal ───────────────────────────────────────────────────────────
router.get('/', ctrl.listar);
router.get('/:id', ctrl.buscar);
router.post('/', ctrl.criar);
router.put('/:id', ctrl.atualizar);
// Aceita PATCH e PUT para ativar/inativar (compat com frontend legado)
router.patch('/:id/ativar',   ctrl.ativar);
router.patch('/:id/inativar', ctrl.inativar);
router.put('/:id/ativar',     ctrl.ativar);
router.put('/:id/inativar',   ctrl.inativar);
router.delete('/:id', ctrl.excluir);

// ─── Fotos do cliente ─────────────────────────────────────────────────────────
router.get('/:id/fotos', async (req, res) => {
  try {
    const pool = getPool();
    if (!(await temClienteFotos(pool))) return res.json([]);
    const [rows] = await pool.query(
      `SELECT id, descricao, tipo_imagem AS tipo, principal, caminho
       FROM cliente_fotos
       WHERE cod_cliente = ? AND COALESCE(excluido, 'N') = 'N'
       ORDER BY (UPPER(COALESCE(tipo_imagem, '')) = 'LOGO') DESC,
                (COALESCE(principal, 'N') = 'S') DESC,
                id ASC`,
      [req.params.id]
    ).catch(() => [[]]);
    res.json(rows.map((r) => {
      let cam = String(r.caminho || '').trim();
      if (cam && !cam.startsWith('/')) cam = '/' + cam;
      return { ...r, caminho: cam };
    }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/fotos', _upload.single('arquivo'), async (req, res) => {
  const handler = async () => {
    try {
      if (_permCli(req).alterar !== 'S') return res.status(403).json({ error: 'Sem permissão para alterar clientes' });
      if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado' });
      const pool = getPool();
      if (!(await temClienteFotos(pool))) return res.status(503).json({ error: 'Tabela cliente_fotos indisponível.' });
      const { id } = req.params;
      const { descricao, tipo_imagem, principal } = req.body;
      const caminho = `uploads/clientes/${id}/${req.file.filename}`;
      const [result] = await pool.query(
        `INSERT INTO cliente_fotos (cod_cliente, descricao, tipo_imagem, principal, caminho, excluido, dtcadastro)
         VALUES (?, ?, ?, ?, ?, 'N', CURDATE())`,
        [id, descricao || req.file.originalname, tipo_imagem || '', principal || 'N', caminho]
      );
      res.status(201).json({ ok: true, id: result.insertId, caminho: '/' + caminho });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
  try { return runWithRequestPool(req, handler); } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id/fotos/:fotoId', async (req, res) => {
  try {
    if (_permCli(req).alterar !== 'S') return res.status(403).json({ error: 'Sem permissão para alterar clientes' });
    const pool = getPool();
    if (!(await temClienteFotos(pool))) return res.json({ ok: true });
    const [rows] = await pool.query(
      `SELECT caminho FROM cliente_fotos WHERE id = ? AND cod_cliente = ? AND excluido = 'N' LIMIT 1`,
      [req.params.fotoId, req.params.id]
    );
    if (rows[0]?.caminho) {
      const rel = String(rows[0].caminho).replace(/^\//, '');
      const abs = path.join(process.cwd(), 'public', rel.replace(/\//g, path.sep));
      fs.unlink(abs, () => {});
    }
    await pool.query(`UPDATE cliente_fotos SET excluido = 'S' WHERE id = ?`, [req.params.fotoId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
