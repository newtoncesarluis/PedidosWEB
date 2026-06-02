/**
 * LGPD — Gestão de consentimento, exportação e anonimização de dados
 */
const express = require('express');
const router  = express.Router();
const { getPool } = require('../config/database');

// Cria tabela de consentimentos se não existir
async function ensureTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lgpd_consentimentos (
      id                  INT AUTO_INCREMENT PRIMARY KEY,
      id_cliente          INT          NOT NULL,
      tipo                VARCHAR(60)  NOT NULL DEFAULT 'DADOS_PESSOAIS',
      origem              VARCHAR(60)  NOT NULL DEFAULT 'CADASTRO_MANUAL',
      aceito              TINYINT(1)   NOT NULL DEFAULT 1,
      ip_origem           VARCHAR(45)  NULL,
      responsavel         VARCHAR(120) NULL,
      observacao          TEXT         NULL,
      data_consentimento  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      data_revogacao      DATETIME     NULL,
      INDEX idx_cliente (id_cliente)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

// ─── GET /resumo — totais para o painel ──────────────────────────────────────
router.get('/resumo', async (req, res) => {
  try {
    const pool = getPool();
    await ensureTable(pool);

    const [[totClientes]] = await pool.query(
      `SELECT COUNT(*) AS total FROM clientes WHERE COALESCE(NULLIF(TRIM(excluido),''),'N') = 'N'`
    );
    const [[comConsentimento]] = await pool.query(
      `SELECT COUNT(DISTINCT id_cliente) AS total FROM lgpd_consentimentos WHERE aceito = 1 AND data_revogacao IS NULL`
    );
    const [[anonimizados]] = await pool.query(
      `SELECT COUNT(*) AS total FROM clientes WHERE nome LIKE 'CLIENTE ANONIMIZADO%'`
    );
    const [[revogados]] = await pool.query(
      `SELECT COUNT(*) AS total FROM lgpd_consentimentos WHERE data_revogacao IS NOT NULL`
    );

    res.json({
      total_clientes:      totClientes.total,
      com_consentimento:   comConsentimento.total,
      sem_consentimento:   totClientes.total - comConsentimento.total,
      anonimizados:        anonimizados.total,
      revogados:           revogados.total,
    });
  } catch (err) {
    console.error('[lgpd/resumo]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /clientes — lista com status de consentimento ───────────────────────
router.get('/clientes', async (req, res) => {
  try {
    const pool = getPool();
    await ensureTable(pool);

    const { q = '', status = '', page = 1, limit = 50 } = req.query;
    const off = (parseInt(page) - 1) * parseInt(limit);

    const where = [`COALESCE(NULLIF(TRIM(c.excluido),''),'N') = 'N'`];
    const params = [];

    if (q) {
      where.push(`(LOWER(c.nome) LIKE ? OR c.cpf LIKE ? OR c.email LIKE ?)`);
      const like = `%${q.toLowerCase()}%`;
      params.push(like, like, like);
    }

    let havingClause = '';
    if (status === 'com')     havingClause = 'HAVING tem_consentimento = 1';
    if (status === 'sem')     havingClause = 'HAVING tem_consentimento = 0';
    if (status === 'revogado') havingClause = 'HAVING revogado = 1';

    const [rows] = await pool.query(`
      SELECT
        c.id, c.nome, c.apelido, c.cpf, c.email, c.cidade, c.uf, c.dtcadastro,
        MAX(lc.data_consentimento) AS ultimo_consentimento,
        MAX(lc.data_revogacao)     AS ultima_revogacao,
        MAX(lc.tipo)               AS tipo_consentimento,
        MAX(lc.origem)             AS origem_consentimento,
        MAX(lc.responsavel)        AS responsavel,
        COUNT(DISTINCT CASE WHEN lc.aceito = 1 AND lc.data_revogacao IS NULL THEN lc.id END) AS tem_consentimento,
        COUNT(DISTINCT CASE WHEN lc.data_revogacao IS NOT NULL THEN lc.id END) AS revogado
      FROM clientes c
      LEFT JOIN lgpd_consentimentos lc ON lc.id_cliente = c.id
      WHERE ${where.join(' AND ')}
      GROUP BY c.id, c.nome, c.apelido, c.cpf, c.email, c.cidade, c.uf, c.dtcadastro
      ${havingClause}
      ORDER BY c.nome
      LIMIT ? OFFSET ?
    `, [...params, parseInt(limit), off]);

    const [[{ total }]] = await pool.query(`
      SELECT COUNT(*) AS total FROM (
        SELECT c.id,
          COUNT(DISTINCT CASE WHEN lc.aceito = 1 AND lc.data_revogacao IS NULL THEN lc.id END) AS tem_consentimento,
          COUNT(DISTINCT CASE WHEN lc.data_revogacao IS NOT NULL THEN lc.id END) AS revogado
        FROM clientes c
        LEFT JOIN lgpd_consentimentos lc ON lc.id_cliente = c.id
        WHERE ${where.join(' AND ')}
        GROUP BY c.id
        ${havingClause}
      ) sub
    `, params);

    res.json({ clientes: rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('[lgpd/clientes]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /consentimento — registrar consentimento ───────────────────────────
router.post('/consentimento', async (req, res) => {
  try {
    const pool = getPool();
    await ensureTable(pool);

    const { id_cliente, tipo = 'DADOS_PESSOAIS', origem = 'CADASTRO_MANUAL', observacao = '' } = req.body;
    if (!id_cliente) return res.status(400).json({ error: 'id_cliente obrigatório' });

    const ip = req.ip || req.headers['x-forwarded-for'] || '';
    const responsavel = req.user?.nome || req.user?.login || '';

    await pool.query(`
      INSERT INTO lgpd_consentimentos (id_cliente, tipo, origem, aceito, ip_origem, responsavel, observacao)
      VALUES (?, ?, ?, 1, ?, ?, ?)
    `, [id_cliente, tipo, origem, ip, responsavel, observacao]);

    res.json({ ok: true });
  } catch (err) {
    console.error('[lgpd/consentimento]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /revogar/:id_cliente — revogar consentimento ───────────────────────
router.post('/revogar/:id_cliente', async (req, res) => {
  try {
    const pool = getPool();
    await ensureTable(pool);

    await pool.query(`
      UPDATE lgpd_consentimentos
      SET data_revogacao = NOW()
      WHERE id_cliente = ? AND data_revogacao IS NULL
    `, [req.params.id_cliente]);

    res.json({ ok: true });
  } catch (err) {
    console.error('[lgpd/revogar]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /exportar/:id_cliente — exportar todos os dados do titular ──────────
router.get('/exportar/:id_cliente', async (req, res) => {
  try {
    const pool = getPool();
    const { id_cliente } = req.params;

    const [[cliente]] = await pool.query(
      `SELECT * FROM clientes WHERE id = ? LIMIT 1`, [id_cliente]
    );
    if (!cliente) return res.status(404).json({ error: 'Cliente não encontrado' });

    const [pedidos] = await pool.query(
      `SELECT id, data_abertura, vlrtotalpedido, situacao_pedido FROM pedidos
       WHERE cod_cliente = ? AND excluido = 'N' ORDER BY data_abertura DESC`, [id_cliente]
    ).catch(() => [[]]);

    const [visitas] = await pool.query(
      `SELECT id, data_visita, observacao FROM visitas
       WHERE id_cliente = ? ORDER BY data_visita DESC`, [id_cliente]
    ).catch(() => [[]]);

    const [consentimentos] = await pool.query(
      `SELECT tipo, origem, aceito, data_consentimento, data_revogacao, responsavel
       FROM lgpd_consentimentos WHERE id_cliente = ? ORDER BY data_consentimento DESC`, [id_cliente]
    ).catch(() => [[]]);

    const exportado = {
      exportado_em:  new Date().toISOString(),
      titular:       {
        id:         cliente.id,
        nome:       cliente.nome,
        apelido:    cliente.apelido,
        cpf_cnpj:   cliente.cpf,
        email:      cliente.email,
        telefone:   cliente.foneprincipal,
        celular:    cliente.celularcomprador || cliente.fonesecundario,
        cidade:     cliente.cidade,
        uf:         cliente.uf,
        cadastrado: cliente.dtcadastro,
      },
      pedidos,
      visitas,
      consentimentos,
    };

    res.setHeader('Content-Disposition', `attachment; filename="lgpd_cliente_${id_cliente}.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.json(exportado);
  } catch (err) {
    console.error('[lgpd/exportar]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /anonimizar/:id_cliente — anonimizar dados do titular ──────────────
router.post('/anonimizar/:id_cliente', async (req, res) => {
  try {
    const pool = getPool();
    const { id_cliente } = req.params;
    const { motivo = '' } = req.body;

    const [[cliente]] = await pool.query(
      `SELECT id, nome FROM clientes WHERE id = ? LIMIT 1`, [id_cliente]
    );
    if (!cliente) return res.status(404).json({ error: 'Cliente não encontrado' });
    if (cliente.nome.startsWith('CLIENTE ANONIMIZADO')) {
      return res.status(400).json({ error: 'Cliente já foi anonimizado' });
    }

    // Anonimização: substitui PII por valores neutros, mantém histórico de pedidos intacto
    await pool.query(`
      UPDATE clientes SET
        nome               = CONCAT('CLIENTE ANONIMIZADO #', id),
        apelido            = NULL,
        cpf                = NULL,
        rg                 = NULL,
        email              = NULL,
        foneprincipal      = NULL,
        fonesecundario     = NULL,
        celularcomprador   = NULL,
        contato            = NULL,
        endereco           = NULL,
        bairro             = NULL,
        cep                = NULL,
        latitude           = NULL,
        longitude          = NULL,
        excluido           = 'S'
      WHERE id = ?
    `, [id_cliente]);

    // Registra a revogação e o motivo
    await ensureTable(pool);
    const responsavel = req.user?.nome || req.user?.login || '';
    await pool.query(`
      UPDATE lgpd_consentimentos SET data_revogacao = NOW() WHERE id_cliente = ? AND data_revogacao IS NULL
    `, [id_cliente]);
    await pool.query(`
      INSERT INTO lgpd_consentimentos
        (id_cliente, tipo, origem, aceito, responsavel, observacao, data_revogacao)
      VALUES (?, 'ANONIMIZACAO', 'SOLICITACAO_TITULAR', 0, ?, ?, NOW())
    `, [id_cliente, responsavel, motivo || 'Anonimização solicitada pelo titular']);

    res.json({ ok: true, mensagem: `Cliente #${id_cliente} anonimizado com sucesso` });
  } catch (err) {
    console.error('[lgpd/anonimizar]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /historico/:id_cliente — histórico de consentimentos ────────────────
router.get('/historico/:id_cliente', async (req, res) => {
  try {
    const pool = getPool();
    await ensureTable(pool);

    const [rows] = await pool.query(`
      SELECT tipo, origem, aceito, ip_origem, responsavel, observacao,
             data_consentimento, data_revogacao
      FROM lgpd_consentimentos
      WHERE id_cliente = ?
      ORDER BY data_consentimento DESC
    `, [req.params.id_cliente]);

    res.json({ historico: rows });
  } catch (err) {
    console.error('[lgpd/historico]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
