const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { getPool, createPool } = require('../config/database');

const ENV_PATH = path.join(__dirname, '..', '.env');

/**
 * Verifica se as colunas enviadas no body existem na tabela 'sistemas'.
 * Se não existirem, cria-as automaticamente.
 */
async function ensureSistemasColumns(pool, body) {
  try {
    // Garante que a tabela sistemas existe
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sistemas (
        id INT(11) NOT NULL AUTO_INCREMENT,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
    `).catch(() => {});

    const [columns] = await pool.query('SHOW COLUMNS FROM sistemas');
    const existingColumns = columns.map(c => c.Field.toLowerCase());
    
    for (const key of Object.keys(body)) {
      if (key === 'id' || key === 'senha_admin') continue;
      
      if (!existingColumns.includes(key.toLowerCase())) {
        console.log(`[config-sistema] Criando coluna faltante: ${key}`);
        
        let type = 'VARCHAR(255) NULL';
        // Campos específicos
        if (key === 'corpoemailpadrao') type = 'TEXT NULL';
        else if ([
          'limitexibepedido', 'qt_padraopedido', 'casadecimais', 'limitebusca', 
          'diasavisareventos', 'diasavisoclientesemcompra'
        ].includes(key)) {
          type = 'INT(11) NULL DEFAULT 0';
        }
        else if (key === 'porta_banco') type = 'VARCHAR(10) NULL DEFAULT "3306"';

        await pool.query(`ALTER TABLE sistemas ADD COLUMN \`${key}\` ${type}`).catch(err => {
          console.error(`Erro ao criar coluna ${key}:`, err.message);
        });
      }
    }
  } catch (err) {
    console.error('[config-sistema] Erro ao verificar estrutura da tabela sistemas:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURAÇÃO DO SISTEMA  (tabela: sistemas)
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/config/sistema — lê único registro da tabela sistemas
router.get('/sistema', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT * FROM sistemas ORDER BY id DESC LIMIT 1`
    );
    res.json(rows[0] || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/config/sistema — upsert (insert se vazio, update se já existir)
router.post('/sistema', async (req, res) => {
  try {
    const pool = getPool();
    const { senha_admin, ...body } = req.body;

    if (senha_admin !== 'kzf010557f') {
      return res.status(401).json({ error: 'Senha administrativa inválida' });
    }

    // Garante que todas as colunas enviadas existam na tabela
    await ensureSistemasColumns(pool, body);

    const [existing] = await pool.query(
      `SELECT id FROM sistemas ORDER BY id DESC LIMIT 1`
    );

    if (existing[0]) {
      // Monta SET dinâmico com os campos enviados (exclui id)
      const campos = Object.keys(body).filter(k => k !== 'id');
      if (campos.length === 0) return res.status(400).json({ error: 'Nenhum campo para atualizar' });

      const setClause = campos.map(c => `\`${c}\`=?`).join(', ');
      const values    = campos.map(c => body[c] !== undefined ? body[c] : null);
      values.push(existing[0].id);

      await pool.query(
        `UPDATE sistemas SET ${setClause} WHERE id=?`,
        values
      );

      // ── PERSISTÊNCIA NO .env (Se campos de banco estiverem presentes) ──────
      const dbUpdates = {};
      if (body.host_servidor) dbUpdates.DB_HOST = body.host_servidor;
      if (body.porta_banco)   dbUpdates.DB_PORT = body.porta_banco;
      if (body.base)          dbUpdates.DB_NAME = body.base;
      if (body.user_banco)    dbUpdates.DB_USER = body.user_banco;
      if (body.senha_banco)   dbUpdates.DB_PASSWORD = body.senha_banco;

      if (Object.keys(dbUpdates).length > 0) {
        try {
          let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
          for (const [key, value] of Object.entries(dbUpdates)) {
            const regex = new RegExp(`^${key}=.*$`, 'm');
            content = regex.test(content)
              ? content.replace(regex, `${key}=${value}`)
              : content + `\n${key}=${value}`;
            
            // Atualiza também o processo atual
            process.env[key] = value;
          }
          fs.writeFileSync(ENV_PATH, content, 'utf8');
          // Recria o pool
          createPool();
        } catch (e) {
          console.error('[config-sistema] Erro ao atualizar .env:', e.message);
        }
      }

      res.json({ ok: true, acao: 'update', id: existing[0].id });
    } else {
      // INSERT com os campos enviados
      const campos = Object.keys(body).filter(k => k !== 'id');
      if (campos.length === 0) return res.status(400).json({ error: 'Nenhum campo para inserir' });

      const colNames  = campos.map(c => `\`${c}\``).join(', ');
      const colPlaceholders = campos.map(() => '?').join(', ');
      const values    = campos.map(c => body[c] !== undefined ? body[c] : null);

      const [result] = await pool.query(
        `INSERT INTO sistemas (${colNames}) VALUES (${colPlaceholders})`,
        values
      );

      // ── PERSISTÊNCIA NO .env (Se campos de banco estiverem presentes) ──────
      const dbUpdates = {};
      if (body.host_servidor) dbUpdates.DB_HOST = body.host_servidor;
      if (body.porta_banco)   dbUpdates.DB_PORT = body.porta_banco;
      if (body.base)          dbUpdates.DB_NAME = body.base;
      if (body.user_banco)    dbUpdates.DB_USER = body.user_banco;
      if (body.senha_banco)   dbUpdates.DB_PASSWORD = body.senha_banco;

      if (Object.keys(dbUpdates).length > 0) {
        try {
          let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
          for (const [key, value] of Object.entries(dbUpdates)) {
            const regex = new RegExp(`^${key}=.*$`, 'm');
            content = regex.test(content)
              ? content.replace(regex, `${key}=${value}`)
              : content + `\n${key}=${value}`;
            
            // Atualiza também o processo atual para refletir sem precisar reiniciar tudo agora
            process.env[key] = value;
          }
          fs.writeFileSync(ENV_PATH, content, 'utf8');
          // Recria o pool se as credenciais mudaram
          createPool();
        } catch (e) {
          console.error('[config-sistema] Erro ao atualizar .env:', e.message);
        }
      }

      res.status(201).json({ ok: true, acao: 'insert', id: result.insertId });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/config/flags — flags de UI para o frontend (não expõe dados sensíveis)
router.get('/flags', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT
        gacessartodosclientes,
        grestringirdadosesquipe,
        gIDGerente,
        galteravendedorcadastrocli,
        ggerenciaregiaocadastrocli,
        gincluir_clientes,
        galterar_clientes,
        gexclui_clientes,
        gpermitecnpjduplicadoclientes,
        gcompartilhaCliente,
        gcampos_cadastrocliente,
        gformaspagtocadastro,
        gmoduloclinca,
        gcodigoauxiliar,
        gcostumizadopara,
        glimitexibepedido,
        gufpadraocadastros
       FROM sistemas ORDER BY id DESC LIMIT 1`
    ).catch(() => [[]]);
    res.json(rows[0] || {});
  } catch (err) {
    res.json({});
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURAÇÃO DE API / WHATSAPP  (tabela: configuracao)
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/config/api — lê campos relevantes da tabela configuracao
router.get('/api', async (req, res) => {
  try {
    const pool = getPool();
    // Garante que a tabela existe (compatibilidade)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS configuracao (
        id               INT(11)      NOT NULL AUTO_INCREMENT,
        w_apiglobal      VARCHAR(250) NULL DEFAULT NULL,
        w_urlplataforma  VARCHAR(250) NULL DEFAULT NULL,
        excluido         VARCHAR(1)   NULL DEFAULT 'N',
        empresa_liberada VARCHAR(50)  NULL DEFAULT NULL,
        senha_acesso     VARCHAR(100) NULL DEFAULT NULL,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
    `).catch(() => {});

    // Garante colunas novas (compatibilidade legada) de forma segura
    const [colsConfig] = await pool.query('SHOW COLUMNS FROM configuracao');
    const existingColsConfig = colsConfig.map(c => c.Field.toLowerCase());
    
    if (!existingColsConfig.includes('empresa_liberada')) {
      await pool.query(`ALTER TABLE configuracao ADD COLUMN empresa_liberada VARCHAR(50) NULL DEFAULT NULL`).catch(() => {});
    }
    if (!existingColsConfig.includes('senha_acesso')) {
      await pool.query(`ALTER TABLE configuracao ADD COLUMN senha_acesso VARCHAR(100) NULL DEFAULT NULL`).catch(() => {});
    }

    const [rows] = await pool.query(
      `SELECT w_apiglobal, w_urlplataforma, empresa_liberada, senha_acesso
       FROM configuracao
       WHERE excluido = 'N'
       ORDER BY id DESC LIMIT 1`
    );
    res.json(rows[0] || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/config/api — salva configuracao com validação de senha admin
router.post('/api', async (req, res) => {
  try {
    const pool = getPool();
    const { senha_admin, w_apiglobal, w_urlplataforma, empresa_liberada, senha_acesso } = req.body;

    // Valida senha administrativa
    if (senha_admin !== 'kzf010557f') {
      return res.status(401).json({ error: 'Senha administrativa inválida' });
    }

    // Garante que a tabela existe (compatibilidade)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS configuracao (
        id               INT(11)      NOT NULL AUTO_INCREMENT,
        w_apiglobal      VARCHAR(250) NULL DEFAULT NULL,
        w_urlplataforma  VARCHAR(250) NULL DEFAULT NULL,
        excluido         VARCHAR(1)   NULL DEFAULT 'N',
        empresa_liberada VARCHAR(50)  NULL DEFAULT NULL,
        senha_acesso     VARCHAR(100) NULL DEFAULT NULL,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
    `).catch(() => {});
    // Adiciona colunas que podem não existir em tabelas criadas anteriormente (seguro para MySQL antigo)
    const [colsConfigPost] = await pool.query('SHOW COLUMNS FROM configuracao');
    const existingColsConfigPost = colsConfigPost.map(c => c.Field.toLowerCase());

    if (!existingColsConfigPost.includes('empresa_liberada')) {
      await pool.query(`ALTER TABLE configuracao ADD COLUMN empresa_liberada VARCHAR(50) NULL DEFAULT NULL`).catch(() => {});
    }
    if (!existingColsConfigPost.includes('senha_acesso')) {
      await pool.query(`ALTER TABLE configuracao ADD COLUMN senha_acesso VARCHAR(100) NULL DEFAULT NULL`).catch(() => {});
    }

    // Upsert
    const [existing] = await pool.query(
      `SELECT id FROM configuracao WHERE excluido='N' ORDER BY id DESC LIMIT 1`
    );

    const url = w_urlplataforma ? w_urlplataforma.replace(/\/$/, '') : null;

    if (existing[0]) {
      await pool.query(
        `UPDATE configuracao
         SET w_apiglobal=?, w_urlplataforma=?, empresa_liberada=?, senha_acesso=?
         WHERE id=?`,
        [
          w_apiglobal || null,
          url,
          empresa_liberada || null,
          senha_acesso || null,
          existing[0].id
        ]
      );
      res.json({ ok: true, acao: 'update', id: existing[0].id });
    } else {
      const [result] = await pool.query(
        `INSERT INTO configuracao (w_apiglobal, w_urlplataforma, empresa_liberada, senha_acesso, excluido)
         VALUES (?, ?, ?, ?, 'N')`,
        [w_apiglobal || null, url, empresa_liberada || null, senha_acesso || null]
      );
      res.status(201).json({ ok: true, acao: 'insert', id: result.insertId });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
