const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { testConnection, createPool } = require('../config/database');

// POST /api/setup/test-db — testa conexão com o banco
router.post('/test-db', async (req, res) => {
  const { host, port, user, password, database } = req.body;
  const result = await testConnection({ host, port: port || 3306, user, password, database });
  res.json(result);
});

// POST /api/setup/install — instala o sistema
router.post('/install', async (req, res) => {
  const { db, admin, license } = req.body;

  // 1. Testa conexão
  const connTest = await testConnection(db);
  if (!connTest.ok) return res.status(400).json({ error: `Erro de conexão: ${connTest.error}` });

  try {
    // 2. Salva .env
    const envContent = `# Banco de Dados\nDB_HOST=${db.host}\nDB_PORT=${db.port || 3306}\nDB_USER=${db.user}\nDB_PASSWORD=${db.password}\nDB_NAME=${db.database}\n\n# Segurança\nJWT_SECRET=${require('crypto').randomBytes(32).toString('hex')}\n\n# Servidor\nPORT=${process.env.PORT || 3002}\nNODE_ENV=production\n`;
    fs.writeFileSync(path.join(__dirname, '../.env'), envContent);

    // Recarrega variáveis de ambiente
    require('dotenv').config({ override: true });

    // 3. Cria pool com nova config
    const pool = createPool(db);

    // 4. Cria tabela de usuários base
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(200) NOT NULL,
        email VARCHAR(200) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role ENUM('admin','manager','vendedor') DEFAULT 'vendedor',
        active TINYINT(1) DEFAULT 1,
        last_login DATETIME,
        created_at DATETIME DEFAULT NOW()
      )
    `);

    // 5. Cria usuário admin
    const hash = await bcrypt.hash(admin.password, 10);
    await pool.query(
      `INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, 'admin')
       ON DUPLICATE KEY UPDATE password=VALUES(password)`,
      [admin.name, admin.email, hash]
    );

    // 6. Ativa modo demo (30 dias) — licença real deve ser ativada em /licencas.html
    try {
      const LicenseService = require('../services/license-service');
      await LicenseService.activateDemo();
    } catch { /* demo opcional no setup */ }

    // 7. Marca setup como concluído
    fs.writeFileSync(path.join(__dirname, '../.installed'), JSON.stringify({ at: new Date(), version: '1.0.0' }));

    res.json({ ok: true });

  } catch (err) {
    console.error('Setup error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/setup/status
router.get('/status', (req, res) => {
  const installed = fs.existsSync(path.join(__dirname, '../.installed'));
  res.json({ installed });
});

module.exports = router;
