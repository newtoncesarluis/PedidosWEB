require('dotenv').config();
const crypto = require('crypto');
const {
  createPoolFromLicenseBinding,
  getPool,
  getPoolForLicense,
  readLicenseBinding,
  runWithPool,
} = require('../config/database');

async function detectProdTable(pool) {
  const [rows] = await pool.query(`SHOW TABLES LIKE 'produto'`);
  return rows.length ? 'produto' : 'produtos';
}

/** Garante tabela de preços ativa + itens para a vitrine exibir produtos reais */
async function ensureVitrineCatalog(pool) {
  const prodTb = await detectProdTable(pool);

  await pool.query(`
    UPDATE tabela_preco_cabecalho
    SET excluido = 'N', Tabela_Ativa = 'S'
    WHERE id = 2
  `).catch(() => {});

  const [prods] = await pool.query(`
    SELECT ID, descricao, unidade
    FROM ${prodTb}
    WHERE excluido = 'N' AND situacao = 'A'
    ORDER BY (foto_principal IS NOT NULL AND foto_principal <> '') DESC, ID
    LIMIT 8
  `);

  for (let i = 0; i < prods.length; i++) {
    const p = prods[i];
    const preco = (29.9 + i * 17.5).toFixed(2);
    const [[exists]] = await pool.query(
      'SELECT id FROM tabela_preco_itens WHERE id_tabela = 2 AND cod_produto = ? LIMIT 1',
      [p.ID]
    );
    if (exists) {
      await pool.query(
        `UPDATE tabela_preco_itens SET preco_venda = ?, valor_tabela = ?, excluido = 'N', ativo = 'S', descricao = ? WHERE id = ?`,
        [preco, preco, p.descricao, exists.id]
      );
    } else {
      await pool.query(
        `INSERT INTO tabela_preco_itens (id_tabela, item, cod_produto, descricao, unidade, preco_venda, valor_tabela, ativo, excluido)
         VALUES (2, ?, ?, ?, ?, ?, ?, 'S', 'N')`,
        [i + 1, p.ID, p.descricao, p.unidade || 'UN', preco, preco]
      );
    }
  }

  const [[cliente]] = await pool.query(`
    SELECT c.id, COALESCE(c.nome, c.apelido, 'Cliente Demo') AS nome
    FROM tabela_preco_vinculo tpv
    JOIN clientes c ON c.id = tpv.id_entidade AND c.excluido = 'N'
    WHERE tpv.id_tabela = 2 AND tpv.tipo_entidade = 'CLIENTE' AND tpv.excluido = 'N'
    LIMIT 1
  `);

  if (!cliente?.id) throw new Error('Nenhum cliente vinculado à tabela de preços da vitrine');
  return cliente;
}

async function ensureVitrineToken(pool, cliente, usuario) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vitrine_tokens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      token VARCHAR(64) NOT NULL UNIQUE,
      id_cliente INT NOT NULL,
      id_usuario INT NOT NULL,
      nome_cliente VARCHAR(255),
      nome_usuario VARCHAR(255),
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      expira_em TIMESTAMP NULL,
      ativo TINYINT(1) DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `).catch(() => {});

  const [[existing]] = await pool.query(
    `SELECT token FROM vitrine_tokens
     WHERE id_cliente = ? AND id_usuario = ? AND ativo = 1
       AND (expira_em IS NULL OR expira_em > NOW())
     ORDER BY id DESC LIMIT 1`,
    [cliente.id, usuario.id]
  );
  if (existing?.token) return existing.token;

  const token = crypto.randomBytes(32).toString('hex');
  const expira = new Date(Date.now() + 30 * 86400000);
  await pool.query(
    'INSERT INTO vitrine_tokens (token, id_cliente, id_usuario, nome_cliente, nome_usuario, expira_em, ativo) VALUES (?, ?, ?, ?, ?, ?, 1)',
    [token, cliente.id, usuario.id, cliente.nome, usuario.nome, expira]
  );
  return token;
}

async function main() {
  const bound = await createPoolFromLicenseBinding();
  if (!bound.ok) throw new Error(bound.error || 'Falha ao conectar via licença');

  const chave = readLicenseBinding()?.chave_licenca;
  const targetPool = getPoolForLicense(chave);
  if (!targetPool) throw new Error('Pool da licença não encontrado');

  const data = await runWithPool(targetPool, async () => {
    const pool = getPool();
    const cliente = await ensureVitrineCatalog(pool);
    const [[usuario]] = await pool.query(
      `SELECT idusuario AS id, COALESCE(nomeusu, loginusu) AS nome, loginusu, senhausu
       FROM usuarios WHERE loginusu = 'LEONARDO' AND situacao = 'ATIVO' AND excluido = 'N' LIMIT 1`
    );
    if (!usuario?.id) throw new Error('Usuário LEONARDO não encontrado para captura do portal');

    const token = await ensureVitrineToken(pool, cliente, usuario);
    return {
      token,
      loginusu: usuario.loginusu,
      senhausu: usuario.senhausu,
      chave_licenca: chave,
    };
  });

  console.log(JSON.stringify(data));
  process.exit(0);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
