const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const { getPool, getBoundChave } = require('../config/database');

// Só funciona em modo bound e enquanto não existe nenhum admin
async function guardNoPrimeiroAdmin(req, res, next) {
  if (!getBoundChave()) return res.status(403).json({ error: 'Rota disponível apenas em instalação local' });
  try {
    const pool = getPool();
    const [[row]] = await pool.query('SELECT COUNT(*) as n FROM usuarios WHERE role = ?', ['admin']);
    if (row.n > 0) return res.status(403).json({ error: 'Administrador já existe. Use o login normalmente.' });
    next();
  } catch (e) {
    res.status(500).json({ error: 'Erro ao verificar banco: ' + e.message });
  }
}

// GET /api/primeiro-admin/check — verifica se ainda não existe admin
router.get('/check', async (req, res) => {
  if (!getBoundChave()) return res.json({ needsSetup: false });
  try {
    const pool = getPool();
    if (!pool) return res.json({ needsSetup: true });
    const [[row]] = await pool.query('SELECT COUNT(*) as n FROM usuarios WHERE role = ?', ['admin']);
    res.json({ needsSetup: row.n === 0 });
  } catch {
    res.json({ needsSetup: true });
  }
});

// POST /api/primeiro-admin/criar
router.post('/criar', guardNoPrimeiroAdmin, async (req, res) => {
  const { nome, email, senha, confirmar } = req.body;

  if (!nome || !email || !senha) return res.status(400).json({ error: 'Nome, e-mail e senha são obrigatórios' });
  if (senha.length < 6) return res.status(400).json({ error: 'Senha deve ter ao menos 6 caracteres' });
  if (senha !== confirmar) return res.status(400).json({ error: 'Senhas não conferem' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'E-mail inválido' });

  try {
    const pool = getPool();
    const hash = await bcrypt.hash(senha, 10);

    // Garante que a tabela existe antes de inserir
    await pool.query(`
      INSERT INTO usuarios (nome, email, senha, role, ativo, created_at)
      VALUES (?, ?, ?, 'admin', 1, NOW())
    `, [nome.trim(), email.trim().toLowerCase(), hash]);

    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'E-mail já cadastrado' });
    res.status(500).json({ error: 'Erro ao criar administrador: ' + e.message });
  }
});

module.exports = router;
