const express = require('express');
const router  = express.Router();
const { getPool, runWithRequestPool } = require('../config/database');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const {
  EMP_LOGO_BASE: _empLogoBase,
  webPathEmpresaLogo,
  tryUnlinkLogoFile,
  sanitizeEmpresaRow,
} = require('../services/empresa-logo');
const { ensurePerfilCadastroColumns } = require('../config/schema-migrations');
const { resolveNaturezaLabelColumn } = require('../config/natureza-label');
const {
  resolveDespesasLabelColumn,
  despesasLabelExpr,
  despesasOrderExpr,
} = require('../config/despesas-label');
const {
  PERFIL_SN_FIELDS,
  defaultForPerfilCol,
  permCrud,
  negarCad,
} = require('../config/cadastros-permissoes');
const {
  ensurePlanoContasSchema,
  ensureCentroCustoSchema,
  ensureFinanceiroContabilCols,
  normalizeTipoConta,
  normalizeGrupoConta,
  calcNivelPai,
  planoContasLegacyWriteFields,
} = require('../config/plano-contas-schema');
const { seedPlanoContasModelo } = require('../config/plano-contas-modelo');

/** Legado Delphi: excluido pode ser NULL ou vazio em registros ativos. */
const EMPRESA_NAO_EXCLUIDA = `COALESCE(NULLIF(TRIM(excluido), ''), 'N') = 'N'`;
const E_EMPRESA_NAO_EXCLUIDA = `COALESCE(NULLIF(TRIM(e.excluido), ''), 'N') = 'N'`;

// ─── Logo da empresa (relatórios / login) ───────────────────────────────────
const _empLogoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(_empLogoBase, String(req.params.id));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '') || '.png';
    const base = path.basename(file.originalname || 'logo', ext).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    cb(null, `logo_${Date.now()}_${base}${ext}`);
  }
});
const uploadEmpresaLogo = multer({
  storage: _empLogoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const name = file.originalname || '';
    const ok = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(name);
    cb(ok ? null : new Error('Use imagem JPG, PNG, GIF, WebP ou SVG'), ok);
  }
});

let _empresaLogoColEnsured = false;
async function ensureEmpresaLogoColumn(pool) {
  if (_empresaLogoColEnsured) return;
  await pool.query(
    `ALTER TABLE empresa ADD COLUMN logo_relatorio VARCHAR(512) NULL DEFAULT NULL`
  ).catch(() => {});
  await pool.query(
    `ALTER TABLE empresa ADD COLUMN logo_tamanho_relatorio VARCHAR(1) NULL DEFAULT 'M'`
  ).catch(() => {});
  await pool.query(
    `ALTER TABLE empresa ADD COLUMN fluxo_pedidos VARCHAR(20) NOT NULL DEFAULT 'LIVRE'`
  ).catch(() => {});
  _empresaLogoColEnsured = true;
}

function normLogoTamanho(v) {
  const c = String(v || 'M').toUpperCase();
  return ['P', 'M', 'G'].includes(c) ? c : 'M';
}

// ─────────────────────────────────────────────────────────────────────────────
// PERFIS  (tabela: perfil)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/perfis', async (req, res) => {
  try {
    const pool = getPool();
    await ensurePerfilPermissions(pool);
    // Tenta filtrar por excluido se a coluna existir
    const [rows] = await pool.query(
      `SELECT * FROM perfil WHERE COALESCE(excluido,'N') = 'N' ORDER BY descricao`
    ).catch(() => pool.query(`SELECT * FROM perfil ORDER BY descricao`));
    res.json({ perfis: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/perfis', async (req, res) => {
  try {
    const pool = getPool();
    await ensurePerfilPermissions(pool);
    const n = v => v === 'S' || v === true ? 'S' : 'N';
    const { descricao } = req.body;
    const values = PERFIL_SN_FIELDS.map((f) => {
      const raw = req.body[f];
      if (raw === undefined) return defaultForPerfilCol(f);
      return n(raw);
    });
    const ph = PERFIL_SN_FIELDS.map(() => '?').join(',');
    const [r] = await pool.query(
      `INSERT INTO perfil (descricao, ${PERFIL_SN_FIELDS.join(',')}, excluido) VALUES (?, ${ph}, 'N')`,
      [descricao || null, ...values]
    );
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/perfis/:id', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(`SELECT * FROM perfil WHERE id=? LIMIT 1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error:'Perfil não encontrado' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/perfis/:id', async (req, res) => {
  try {
    const pool = getPool();
    await ensurePerfilPermissions(pool);
    const n = v => v === 'S' || v === true ? 'S' : 'N';
    const { descricao } = req.body;
    // Só atualiza campos enviados — evita zerar permissões novas ausentes no form antigo
    const sets = ['descricao=?'];
    const values = [descricao || null];
    for (const f of PERFIL_SN_FIELDS) {
      if (req.body[f] === undefined) continue;
      sets.push(`${f}=?`);
      values.push(n(req.body[f]));
    }
    values.push(req.params.id);
    await pool.query(`UPDATE perfil SET ${sets.join(', ')} WHERE id=?`, values);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/perfis/:id', async (req, res) => {
  try {
    const pool = getPool();
    const { id } = req.params;

    // Trava: verifica se há usuários vinculados a este perfil
    const [vinculos] = await pool.query(
      `SELECT COUNT(*) as total FROM usuarios WHERE idperfil = ? AND COALESCE(excluido, 'N') = 'N'`,
      [id]
    );

    if (vinculos[0]?.total > 0) {
      return res.status(400).json({ 
        error: `Não é possível excluir este perfil pois existem ${vinculos[0].total} usuário(s) vinculado(s) a ele.`
      });
    }

    await pool.query(`UPDATE perfil SET excluido='S' WHERE id=?`, [id])
      .catch(() => pool.query(`DELETE FROM perfil WHERE id=?`, [id]));
      
    res.json({ ok:true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GRUPOS  (tabela: grupo_usuario)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/grupos', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(
      `CREATE TABLE IF NOT EXISTS grupo_usuario (
         id_grupo INT(10) NOT NULL AUTO_INCREMENT,
         descricao_grupo VARCHAR(50) DEFAULT NULL,
         iniciar_atendimento VARCHAR(1) DEFAULT 'N',
         comprador VARCHAR(1) DEFAULT 'N',
         suportetecnico VARCHAR(1) DEFAULT 'N',
         suporteinformatica VARCHAR(1) DEFAULT 'N',
         assistenciatecnica VARCHAR(1) DEFAULT 'N',
         vendedor VARCHAR(1) DEFAULT 'N',
         motorista VARCHAR(1) DEFAULT 'N',
         excluido VARCHAR(1) DEFAULT 'N',
         gerenciausuarios VARCHAR(1) DEFAULT 'N',
         PRIMARY KEY (id_grupo)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3`
    ).catch(()=>{});
    const [rows] = await pool.query(
      `SELECT *, id_grupo as id, descricao_grupo as descricao 
       FROM grupo_usuario 
       WHERE COALESCE(excluido,'N')='N' 
       ORDER BY descricao_grupo`
    );
    res.json({ grupos: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/grupos', async (req, res) => {
  try {
    const pool = getPool();
    const n = v => (v === 'S' || v === true) ? 'S' : 'N';
    const {
      descricao,
      iniciar_atendimento, comprador, suportetecnico,
      suporteinformatica, assistenciatecnica, vendedor,
      motorista, gerenciausuarios
    } = req.body;

    if (!descricao) return res.status(400).json({ error:'descricao obrigatório' });

    const [r] = await pool.query(
      `INSERT INTO grupo_usuario (
        descricao_grupo, iniciar_atendimento, comprador, suportetecnico,
        suporteinformatica, assistenciatecnica, vendedor,
        motorista, gerenciausuarios, excluido
      ) VALUES(?,?,?,?,?,?,?,?,?,'N')`,
      [
        descricao, n(iniciar_atendimento), n(comprador), n(suportetecnico),
        n(suporteinformatica), n(assistenciatecnica), n(vendedor),
        n(motorista), n(gerenciausuarios)
      ]
    );
    res.status(201).json({ ok:true, id:r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


router.get('/grupos/:id', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(`SELECT *, id_grupo as id, descricao_grupo as descricao FROM grupo_usuario WHERE id_grupo=? LIMIT 1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error:'Grupo não encontrado' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/grupos/:id', async (req, res) => {
  try {
    const pool = getPool();
    const n = v => (v === 'S' || v === true) ? 'S' : 'N';
    const {
      descricao,
      iniciar_atendimento, comprador, suportetecnico,
      suporteinformatica, assistenciatecnica, vendedor,
      motorista, gerenciausuarios
    } = req.body;

    if (!descricao) return res.status(400).json({ error:'descricao obrigatório' });

    await pool.query(
      `UPDATE grupo_usuario SET
         descricao_grupo=?, iniciar_atendimento=?, comprador=?, suportetecnico=?,
         suporteinformatica=?, assistenciatecnica=?, vendedor=?,
         motorista=?, gerenciausuarios=?
       WHERE id_grupo=?`,
      [
        descricao, n(iniciar_atendimento), n(comprador), n(suportetecnico),
        n(suporteinformatica), n(assistenciatecnica), n(vendedor),
        n(motorista), n(gerenciausuarios),
        req.params.id
      ]
    );
    res.json({ ok:true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


router.delete('/grupos/:id', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(`UPDATE grupo_usuario SET excluido='S' WHERE id_grupo=?`, [req.params.id]);
    res.json({ ok:true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// USUÁRIOS  (tabela: usuarios)
// ─────────────────────────────────────────────────────────────────────────────
// ─── Multer: upload de avatar do usuário ───────────────────────────────────────
const _uploadsBaseUsr = path.join(process.cwd(), 'public', 'uploads', 'usuarios');

const storageUsr = multer.diskStorage({
  destination: (req, file, cb) => {
    const { id } = req.params;
    const dir = path.join(_uploadsBaseUsr, String(id));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `avatar_${Date.now()}${ext}`);
  }
});
const uploadUsr = multer({ storage: storageUsr });

let _usuarioColsOk = false;
async function ensureUsuarioColumns(pool) {
  if (_usuarioColsOk) return;
  const cols = [
    ['apelido', 'VARCHAR(100)'],
    ['cpf', 'VARCHAR(20)'],
    ['rg', 'VARCHAR(20)'],
    ['tipo_pessoa', 'VARCHAR(20)'],
    ['avatar_url', 'VARCHAR(255)'],
    ['cep', 'VARCHAR(10)'],
    ['endereco', 'VARCHAR(200)'],
    ['bairro', 'VARCHAR(100)'],
    ['cidade', 'VARCHAR(100)'],
    ['uf', 'VARCHAR(2)'],
    ['telefone_principal', 'VARCHAR(20)'],
    ['whatsapp', 'VARCHAR(20)'],
    ['skype', 'VARCHAR(100)'],
    ['banco', 'VARCHAR(100)'],
    ['agencia', 'VARCHAR(20)'],
    ['conta', 'VARCHAR(20)'],
    ['pix_tipo', 'VARCHAR(50)'],
    ['pix_chave', 'VARCHAR(100)'],
    ['id_vendedor', 'INT'],
    ['id_fornecedor', 'INT'],
    ['id_regiao', 'INT'],
    ['obs_gerais', 'TEXT'],
    ['comissao_vista', 'DECIMAL(15,3) DEFAULT 0'],
    ['comissao_prazo', 'DECIMAL(15,3) DEFAULT 0'],
    ['vlr_meta', 'DECIMAL(15,3) DEFAULT 0'],
    ['instancia', 'VARCHAR(100) NULL DEFAULT NULL'],
    ['chave', 'VARCHAR(250) NULL DEFAULT NULL'],
    ['numero_whatsApp', 'VARCHAR(50) NULL DEFAULT NULL'],
    ['status', 'VARCHAR(30) NULL DEFAULT NULL'],
    ['data_conexao', 'DATETIME NULL DEFAULT NULL'],
    ['tipo_usuario', "VARCHAR(20) NOT NULL DEFAULT 'REPRESENTANTE'"],
    ['comissao_preposto_pct', 'DECIMAL(5,2) NOT NULL DEFAULT 6.00'],
    ['id_gerente', 'INT DEFAULT NULL'],
    ['excluido', "VARCHAR(1) DEFAULT 'N'"],
    ['SITUACAO', "VARCHAR(20) DEFAULT 'ATIVO'"],
    // Permissões individuais (usadas em _updateUsuarioOpcional)
    ['acessartodosclientes',       "VARCHAR(1) DEFAULT 'N'"],
    ['incluir_pedvendas',          "VARCHAR(1) DEFAULT 'N'"],
    ['alterar_pedvendas',          "VARCHAR(1) DEFAULT 'N'"],
    ['excluir_pedvendas',          "VARCHAR(1) DEFAULT 'N'"],
    ['incluir_clientes',           "VARCHAR(1) DEFAULT 'N'"],
    ['alterar_clientes',           "VARCHAR(1) DEFAULT 'N'"],
    ['exclui_clientes',            "VARCHAR(1) DEFAULT 'N'"],
    ['incluir_fornecedor',         "VARCHAR(1) DEFAULT 'N'"],
    ['alterar_fornecedor',         "VARCHAR(1) DEFAULT 'N'"],
    ['excluir_fornecedor',         "VARCHAR(1) DEFAULT 'N'"],
    ['incluir_produtos',           "VARCHAR(1) DEFAULT 'N'"],
    ['alterar_produtos',           "VARCHAR(1) DEFAULT 'N'"],
    ['excluir_produtos',           "VARCHAR(1) DEFAULT 'N'"],
    ['p_vender',                   "VARCHAR(1) DEFAULT 'S'"],
    ['p_comprar',                  "VARCHAR(1) DEFAULT 'N'"],
    ['acessogerenciais',           "VARCHAR(1) DEFAULT 'N'"],
    ['manutencaocadastros',        "VARCHAR(1) DEFAULT 'N'"],
    ['mudarempresa',               "VARCHAR(1) DEFAULT 'N'"],
    ['alterarbase',                "VARCHAR(1) DEFAULT 'N'"],
    ['acesso_financeiro',          "VARCHAR(1) DEFAULT 'N'"],
    ['acessoperfil',               "VARCHAR(1) DEFAULT 'N'"],
    ['incluir_formas_pagamento',   "VARCHAR(1) DEFAULT 'N'"],
    ['alterar_formas_pagamento',   "VARCHAR(1) DEFAULT 'N'"],
    ['excluir_formas_pagamento',   "VARCHAR(1) DEFAULT 'N'"],
    ['incluir_bancos',             "VARCHAR(1) DEFAULT 'N'"],
    ['alterar_bancos',             "VARCHAR(1) DEFAULT 'N'"],
    ['excluir_bancos',             "VARCHAR(1) DEFAULT 'N'"],
    ['incluir_despesas',           "VARCHAR(1) DEFAULT 'N'"],
    ['alterar_despesas',           "VARCHAR(1) DEFAULT 'N'"],
    ['excluir_despesas',           "VARCHAR(1) DEFAULT 'N'"],
    ['incluir_segmentos',          "VARCHAR(1) DEFAULT 'N'"],
    ['alterar_segmentos',          "VARCHAR(1) DEFAULT 'N'"],
    ['excluir_segmentos',          "VARCHAR(1) DEFAULT 'N'"],
    ['incluir_regioes',            "VARCHAR(1) DEFAULT 'N'"],
    ['alterar_regioes',            "VARCHAR(1) DEFAULT 'N'"],
    ['excluir_regioes',            "VARCHAR(1) DEFAULT 'N'"],
    ['incluir_natureza',           "VARCHAR(1) DEFAULT 'N'"],
    ['alterar_natureza',           "VARCHAR(1) DEFAULT 'N'"],
    ['excluir_natureza',           "VARCHAR(1) DEFAULT 'N'"],
  ];
  for (const [col, type] of cols) {
    await pool.query(`ALTER TABLE usuarios ADD COLUMN ${col} ${type}`).catch(() => {});
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS preposto_comissao_fornecedor (
      id INT AUTO_INCREMENT PRIMARY KEY,
      id_usuario INT NOT NULL,
      id_fornecedor INT NOT NULL,
      pct_comissao DECIMAL(5,2) NOT NULL DEFAULT 0,
      oculta VARCHAR(1) NOT NULL DEFAULT 'N',
      UNIQUE KEY uk_prep_forn (id_usuario, id_fornecedor)
    )
  `).catch(() => {});
  await pool.query(`ALTER TABLE preposto_comissao_fornecedor ADD COLUMN oculta VARCHAR(1) NOT NULL DEFAULT 'N'`).catch(() => {});
  _usuarioColsOk = true;
}
router.get('/usuarios', async (req, res) => {
  try {
    const pool = getPool();
    await ensureUsuarioColumns(pool);
    const [rows] = await pool.query(
      `SELECT u.*,
              p.descricao as perfil_nome,
              g.descricao_grupo as grupo_nome
       FROM usuarios u
       LEFT JOIN perfil p ON p.id = u.idperfil
       LEFT JOIN grupo_usuario g ON g.id_grupo = u.cod_grupo
       WHERE COALESCE(u.excluido, 'N') = 'N'
       ORDER BY u.nomeusu`
    );
    res.json({ usuarios: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/usuarios/:id/empresas', async (req, res) => {
  try {
    const pool = getPool();
    const [todas] = await pool.query(
      `SELECT e.id_empresa, e.Razao_empresa, e.nome_fantasia,
              IF(ue.id IS NOT NULL, 1, 0) AS vinculado
       FROM empresa e
       LEFT JOIN usuario_empresas ue
         ON ue.cod_empresa = e.id_empresa AND ue.id_usuario = ?
       WHERE ${E_EMPRESA_NAO_EXCLUIDA}
       ORDER BY e.Razao_empresa`,
      [req.params.id || 0]
    );
    res.json({ empresas: todas });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/usuarios/:id/tabelas', async (req, res) => {
  try {
    const pool = getPool();
    const [todas] = await pool.query(
      `SELECT t.id, t.Descricao as descricao,
              IF(ut.id IS NOT NULL, 1, 0) AS vinculado
       FROM tabela_preco_cabecalho t
       LEFT JOIN usuario_tabela_preco ut
         ON ut.id_tabela = t.id AND ut.idusuario = ?
       WHERE t.Tabela_Ativa = 'S' AND t.excluido = 'N'
       ORDER BY t.Descricao`,
      [req.params.id || 0]
    );
    res.json({ tabelas: todas });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/usuarios/:id/fornecedores', async (req, res) => {
  try {
    const pool = getPool();
    const [[usr]] = await pool.query(`SELECT id_vendedor FROM usuarios WHERE idusuario=?`, [req.params.id || 0]);
    const codVendedor = usr?.id_vendedor || null;

    const [todas] = await pool.query(
      `SELECT f.id, f.nome, f.cpf,
              IF(fv.id IS NOT NULL, 1, 0) AS vinculado
       FROM fornecedores f
       LEFT JOIN fornecedor_vendedor fv 
         ON fv.cod_fornecedor = f.id 
         AND fv.cod_vendedor = ? 
         AND COALESCE(fv.excluido, 'N') = 'N'
       WHERE f.excluido = 'N'
       ORDER BY f.nome`,
      [codVendedor || -1]
    );
    res.json({ fornecedores: todas, id_vendedor: codVendedor });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/usuarios/smtp — retorna config SMTP do usuário logado (deve vir ANTES de /:id)
router.get('/usuarios/smtp', async (req, res) => {
  try {
    const pool = getPool();
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Não autenticado' });
    const [[row]] = await pool.query(
      `SELECT emailpedsmtp, emailpedporta, emailpedemail, emailpednome,
              emailpedassinatura, emailpedemaildiretor
       FROM usuarios WHERE idusuario=? AND COALESCE(excluido,'N')='N' LIMIT 1`,
      [userId]
    );
    res.json({ ok: true, smtp: row || {} });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/usuarios/:id', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT u.*,
              (u.instancia IS NOT NULL AND u.instancia <> '') AS whatsapp_configurado
       FROM usuarios u WHERE u.idusuario=? AND COALESCE(u.excluido, 'N')='N' LIMIT 1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error:'Usuário não encontrado' });
    delete rows[0].instancia; delete rows[0].chave; delete rows[0].data_conexao;
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/usuarios', async (req, res) => {
  try {
    const pool = getPool();
    await ensureUsuarioColumns(pool);
    const { nomeusu, loginusu, senhausu, SITUACAO, idperfil, email } = req.body;
    if (!nomeusu || !loginusu || !senhausu)
      return res.status(400).json({ error:'nomeusu, loginusu e senhausu são obrigatórios' });
    if (!idperfil)
      return res.status(400).json({ error:'Perfil de Acesso (idperfil) é obrigatório' });

    const [r] = await pool.query(
      `INSERT INTO usuarios (nomeusu,loginusu,senhausu,SITUACAO,excluido,idperfil,email)
       VALUES(?,?,?,?,  'N',?,?)`,
      [nomeusu, loginusu, senhausu, SITUACAO||'ATIVO', idperfil||null, email||null]
    );
    const newId = r.insertId;
    await _updateUsuarioOpcional(pool, newId, req.body);
    await ensureVendedorVinculadoAuto(pool, newId, req.body);
    res.status(201).json({ ok:true, id:newId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/usuarios/smtp — salva config SMTP do usuário logado (deve vir ANTES de /:id)
router.put('/usuarios/smtp', async (req, res) => {
  try {
    const pool = getPool();
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Não autenticado' });
    const { emailpedsmtp, emailpedporta, emailpedemail, emailpedsenha, emailpednome, emailpedassinatura, emailpedemaildiretor } = req.body;
    await pool.query(
      `UPDATE usuarios SET emailpedsmtp=?, emailpedporta=?, emailpedemail=?, emailpedsenha=?,
       emailpednome=?, emailpedassinatura=?, emailpedemaildiretor=?
       WHERE idusuario=? AND COALESCE(excluido,'N')='N'`,
      [emailpedsmtp||null, emailpedporta||null, emailpedemail||null, emailpedsenha||null,
       emailpednome||null, emailpedassinatura||null, emailpedemaildiretor||null, userId]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/usuarios/smtp/test — testa SMTP sem salvar (deve vir ANTES de /:id/*)
router.post('/usuarios/smtp/test', async (req, res) => {
  try {
    const { emailpedsmtp, emailpedporta, emailpedemail, emailpedsenha, emailpednome } = req.body;
    if (!emailpedsmtp || !emailpedemail || !emailpedsenha)
      return res.status(400).json({ error: 'Preencha servidor, usuário e senha antes de testar.' });
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: emailpedsmtp,
      port: parseInt(emailpedporta) || 587,
      secure: parseInt(emailpedporta) === 465,
      auth: { user: emailpedemail, pass: emailpedsenha },
      tls: { rejectUnauthorized: false },
    });
    await transporter.sendMail({
      from: `"${emailpednome || 'SysRepWeb'}" <${emailpedemail}>`,
      to: emailpedemail,
      subject: 'Teste de SMTP — SysRepWeb',
      html: '<p style="font-family:Arial">Configuração de e-mail funcionando corretamente! ✓</p>',
    });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/usuarios/smtp/assinatura — upload imagem de assinatura
const multerSmtp = require('multer');
const fsSmtp = require('fs');
const pathSmtp = require('path');
const storageSmtp = multerSmtp.diskStorage({
  destination: (req, file, cb) => {
    const dir = pathSmtp.join(process.cwd(), 'public/uploads/assinaturas');
    fsSmtp.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = pathSmtp.extname(file.originalname) || '.png';
    cb(null, `assin_${req.user?.id || 'usr'}_${Date.now()}${ext}`);
  },
});
const uploadSmtp = multerSmtp({ storage: storageSmtp, limits: { fileSize: 2 * 1024 * 1024 } });
router.post('/usuarios/smtp/assinatura', uploadSmtp.single('arquivo'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    const url = `/uploads/assinaturas/${req.file.filename}`;
    res.json({ ok: true, url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/usuarios/:id', async (req, res) => {
  try {
    const pool = getPool();
    await ensureUsuarioColumns(pool);
    const { nomeusu, loginusu, senhausu, SITUACAO, idperfil, email } = req.body;
    if (!idperfil)
      return res.status(400).json({ error:'Perfil de Acesso (idperfil) é obrigatório' });
    const base = [`nomeusu=?`,`loginusu=?`,`SITUACAO=?`,`idperfil=?`,`email=?`];
    const vals = [nomeusu||null, loginusu||null, SITUACAO||'ATIVO', idperfil, email||null];
    if (senhausu) { base.push(`senhausu=?`); vals.push(senhausu); }
    vals.push(req.params.id);
    await pool.query(`UPDATE usuarios SET ${base.join(',')} WHERE idusuario=? AND COALESCE(excluido, 'N')='N'`, vals);
    await _updateUsuarioOpcional(pool, req.params.id, req.body);
    await ensureVendedorVinculadoAuto(pool, req.params.id, req.body);
    res.json({ ok:true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/usuarios/:id/avatar', uploadUsr.single('arquivo'), async (req, res) => {
  const handler = async () => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
      const pool = getPool();
      const { id } = req.params;
      const caminho = `uploads/usuarios/${id}/${req.file.filename}`;
      await pool.query(`UPDATE usuarios SET avatar_url = ? WHERE idusuario = ?`, [caminho, id]);
      res.json({ ok: true, avatar_url: caminho });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };

  try {
    return runWithRequestPool(req, handler);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function ensureVendedorVinculadoAuto(pool, userId, body) {
  const uid = parseInt(userId, 10);
  if (!uid) return;
  if (body.id_vendedor != null && body.id_vendedor !== '') return;

  const tipo = String(body.tipo_usuario || 'REPRESENTANTE').toUpperCase();
  if (tipo === 'PREPOSTO' || tipo === 'ADMIN') return;

  const idperfil = parseInt(body.idperfil, 10);
  if (!idperfil) return;

  let permiteVender = false;
  if (body.p_vender !== undefined && body.p_vender !== null) {
    permiteVender = body.p_vender === 'S' || body.p_vender === true;
  } else {
    const [[perfil]] = await pool.query(
      `SELECT p_vender FROM perfil WHERE id = ? LIMIT 1`,
      [idperfil]
    ).catch(() => [[]]);
    permiteVender = String(perfil?.p_vender || 'N').toUpperCase() === 'S';
  }
  if (!permiteVender) return;

  await pool.query(`UPDATE usuarios SET id_vendedor = ? WHERE idusuario = ?`, [uid, uid]);
}

async function _updateUsuarioOpcional(pool, id, body) {
  const n = v => v === 'S' || v === true ? 'S' : 'N';
  // NÃO incluir rota_vendedor aqui — é tabela separada (rota_vendedor), não coluna de usuarios.
  // Um UPDATE com coluna inexistente falhava inteiro e o .catch engolia o erro,
  // impedindo gravar id_vendedor (e o restante dos vínculos).
  const opt = {
    acessartodosclientes: n(body.acessartodosclientes),
    empresapadrao: body.empresapadrao||null,
    cod_grupo: body.cod_grupo||null,
    apelido: body.apelido||null,
    cpf: body.cpf||null,
    rg: body.rg||null,
    tipo_pessoa: body.tipo_pessoa||null,
    cep: body.cep||null,
    endereco: body.endereco||null,
    bairro: body.bairro||null,
    cidade: body.cidade||null,
    uf: body.uf||null,
    telefone_principal: body.telefone_principal||null,
    whatsapp: body.whatsapp||null,
    skype: body.skype||null,
    banco: body.banco||null,
    agencia: body.agencia||null,
    conta: body.conta||null,
    pix_tipo: body.pix_tipo||null,
    pix_chave: body.pix_chave||null,
    id_vendedor: body.id_vendedor||null,
    id_fornecedor: body.id_fornecedor||null,
    id_regiao: body.id_regiao||null,
    obs_gerais: body.obs_gerais||null,
    comissao_vista: body.comissao_vista||0,
    comissao_prazo: body.comissao_prazo||0,
    vlr_meta: body.vlr_meta||0,
    tipo_usuario: body.tipo_usuario||'REPRESENTANTE',
    comissao_preposto_pct: parseFloat(body.comissao_preposto_pct)||6,
    emailpedsmtp: body.emailpedsmtp||null,
    emailpedporta: body.emailpedporta||null,
    emailpedemail: body.emailpedemail||null,
    emailpedsenha: body.emailpedsenha||null,
    emailpednome: body.emailpednome||null,
    emailpedemaildiretor: body.emailpedemaildiretor||null,
    emailpedassinatura: body.emailpedassinatura||null,
    incluir_pedvendas: n(body.incluir_pedvendas),
    alterar_pedvendas: n(body.alterar_pedvendas),
    excluir_pedvendas: n(body.excluir_pedvendas),
    incluir_clientes:  n(body.incluir_clientes),
    alterar_clientes:  n(body.alterar_clientes),
    exclui_clientes:   n(body.exclui_clientes),
    incluir_fornecedor: n(body.incluir_fornecedor),
    alterar_fornecedor: n(body.alterar_fornecedor),
    excluir_fornecedor: n(body.excluir_fornecedor),
    incluir_produtos:  n(body.incluir_produtos),
    alterar_produtos:  n(body.alterar_produtos),
    excluir_produtos:  n(body.excluir_produtos),
    p_vender: n(body.p_vender), p_comprar: n(body.p_comprar),
    acessogerenciais: n(body.acessogerenciais),
    manutencaocadastros: n(body.manutencaocadastros),
    mudarempresa: n(body.mudarempresa), alterarbase: n(body.alterarbase),
    acesso_financeiro: n(body.acesso_financeiro), acessoperfil: n(body.acessoperfil),
    incluir_formas_pagamento: n(body.incluir_formas_pagamento),
    alterar_formas_pagamento: n(body.alterar_formas_pagamento),
    excluir_formas_pagamento: n(body.excluir_formas_pagamento),
    incluir_bancos: n(body.incluir_bancos),
    alterar_bancos: n(body.alterar_bancos),
    excluir_bancos: n(body.excluir_bancos),
    incluir_despesas: n(body.incluir_despesas),
    alterar_despesas: n(body.alterar_despesas),
    excluir_despesas: n(body.excluir_despesas),
    incluir_segmentos: n(body.incluir_segmentos),
    alterar_segmentos: n(body.alterar_segmentos),
    excluir_segmentos: n(body.excluir_segmentos),
    incluir_regioes: n(body.incluir_regioes),
    alterar_regioes: n(body.alterar_regioes),
    excluir_regioes: n(body.excluir_regioes),
    incluir_natureza: n(body.incluir_natureza),
    alterar_natureza: n(body.alterar_natureza),
    excluir_natureza: n(body.excluir_natureza),
  };

  // Grava coluna a coluna: se alguma não existir na base legada, as demais (ex.: id_vendedor) ainda salvam.
  for (const [col, val] of Object.entries(opt)) {
    await pool.query(`UPDATE usuarios SET \`${col}\`=? WHERE idusuario=?`, [val, id]).catch(() => {});
  }
}

router.delete('/usuarios/:id', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(`UPDATE usuarios SET excluido='S' WHERE idusuario=? AND COALESCE(excluido, 'N')='N'`, [req.params.id]);
    res.json({ ok:true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/usuarios/:id/empresas', async (req, res) => {
  try {
    const pool = getPool();
    const { id_empresas } = req.body;
    if (!Array.isArray(id_empresas))
      return res.status(400).json({ error:'id_empresas deve ser array' });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(`DELETE FROM usuario_empresas WHERE id_usuario=?`, [req.params.id]);
      if (id_empresas.length > 0) {
        await conn.query(
          `INSERT INTO usuario_empresas (id_usuario,cod_empresa) VALUES ?`,
          [id_empresas.map(e => [req.params.id, e])]
        );
      }
      await conn.commit();
      res.json({ ok:true, vinculadas:id_empresas.length });
    } catch(e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/usuarios/:id/tabelas', async (req, res) => {
  try {
    const pool = getPool();
    const { id_tabelas } = req.body;
    if (!Array.isArray(id_tabelas))
      return res.status(400).json({ error:'id_tabelas deve ser array' });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(`DELETE FROM usuario_tabela_preco WHERE idusuario=?`, [req.params.id]);
      if (id_tabelas.length > 0) {
        await conn.query(
          `INSERT INTO usuario_tabela_preco (idusuario,id_tabela) VALUES ?`,
          [id_tabelas.map(tId => [req.params.id, tId])]
        );
      }
      await conn.commit();
      res.json({ ok:true, vinculadas:id_tabelas.length });
    } catch(e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/usuarios/:id/fornecedores', async (req, res) => {
  try {
    const pool = getPool();
    await ensureUsuarioColumns(pool);
    const { id_fornecedores } = req.body;
    if (!Array.isArray(id_fornecedores))
      return res.status(400).json({ error:'id_fornecedores deve ser array' });

    const [[usr]] = await pool.query(`SELECT id_vendedor FROM usuarios WHERE idusuario=?`, [req.params.id]);
    let codVendedor = usr?.id_vendedor || null;

    // Fallback: se o front enviou id_vendedor no body e o usuário ainda não tem, grava agora
    const idVendBody = req.body.id_vendedor != null && req.body.id_vendedor !== ''
      ? parseInt(req.body.id_vendedor, 10)
      : null;
    if (!codVendedor && idVendBody) {
      await pool.query(`UPDATE usuarios SET id_vendedor = ? WHERE idusuario = ?`, [idVendBody, req.params.id]);
      codVendedor = idVendBody;
    }

    // Sem vendedor e sem fábricas marcadas: nada a gravar (não é erro)
    if (!codVendedor) {
      if (!id_fornecedores.length) return res.json({ ok: true, vinculadas: 0 });
      return res.status(400).json({ error: 'Usuário não possui vendedor vinculado para salvar fornecedores' });
    }
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(`DELETE FROM fornecedor_vendedor WHERE cod_vendedor=?`, [codVendedor]);
      if (id_fornecedores.length > 0) {
        const rows = id_fornecedores.map(fId => [fId, codVendedor, 'N']);
        await conn.query(
          `INSERT INTO fornecedor_vendedor (cod_fornecedor, cod_vendedor, excluido) VALUES ?`,
          [rows]
        );
      }
      await conn.commit();
      res.json({ ok:true, vinculadas: id_fornecedores.length });
    } catch(e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// COMISSÕES DO PREPOSTO POR FORNECEDOR
// ─────────────────────────────────────────────────────────────────────────────

router.get('/usuarios/:id/comissoes-fornecedor', async (req, res) => {
  try {
    const pool = getPool();
    await ensureUsuarioColumns(pool);
    const [rows] = await pool.query(
      `SELECT f.id, f.nome,
              COALESCE(pc.pct_comissao, 0) AS pct_comissao,
              COALESCE(pc.oculta, 'N') AS oculta
       FROM fornecedores f
       LEFT JOIN preposto_comissao_fornecedor pc
         ON pc.id_fornecedor = f.id AND pc.id_usuario = ?
       WHERE f.excluido = 'N'
       ORDER BY f.nome`,
      [req.params.id]
    );
    res.json({ fornecedores: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/usuarios/:id/comissoes-fornecedor/clonar-de/:origem_id', async (req, res) => {
  try {
    const pool = getPool();
    const idDestino = parseInt(req.params.id);
    const idOrigem  = parseInt(req.params.origem_id);
    if (idDestino === idOrigem) return res.status(400).json({ error: 'Origem e destino iguais' });
    const [configs] = await pool.query(
      `SELECT id_fornecedor, pct_comissao, oculta FROM preposto_comissao_fornecedor WHERE id_usuario = ?`,
      [idOrigem]
    );
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(`DELETE FROM preposto_comissao_fornecedor WHERE id_usuario = ?`, [idDestino]);
      if (configs.length) {
        const rows = configs.map(c => [idDestino, c.id_fornecedor, parseFloat(c.pct_comissao), c.oculta || 'N']);
        await conn.query(
          `INSERT INTO preposto_comissao_fornecedor (id_usuario, id_fornecedor, pct_comissao, oculta) VALUES ?`,
          [rows]
        );
      }
      await conn.commit();
      res.json({ ok: true, copiadas: configs.length });
    } catch(e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/usuarios/:id/comissoes-fornecedor', async (req, res) => {
  try {
    const pool = getPool();
    const { comissoes } = req.body; // [{id_fornecedor, pct_comissao}]
    if (!Array.isArray(comissoes)) return res.status(400).json({ error: 'comissoes deve ser array' });
    const idUsuario = parseInt(req.params.id);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(`DELETE FROM preposto_comissao_fornecedor WHERE id_usuario = ?`, [idUsuario]);
      const validas = comissoes.filter(c => c.id_fornecedor && (parseFloat(c.pct_comissao) > 0 || c.oculta === 'S'));
      if (validas.length) {
        const rows = validas.map(c => [idUsuario, parseInt(c.id_fornecedor), parseFloat(c.pct_comissao) || 0, c.oculta === 'S' ? 'S' : 'N']);
        await conn.query(
          `INSERT INTO preposto_comissao_fornecedor (id_usuario, id_fornecedor, pct_comissao, oculta) VALUES ?`,
          [rows]
        );
      }
      await conn.commit();
      res.json({ ok: true, salvas: validas.length });
    } catch(e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// EMPRESAS
// ─────────────────────────────────────────────────────────────────────────────

router.get('/empresas', async (req, res) => {
  try {
    const pool = getPool();
    await ensureEmpresaLogoColumn(pool);
    const [rows] = await pool.query(
      `SELECT * FROM empresa WHERE ${EMPRESA_NAO_EXCLUIDA} ORDER BY Razao_empresa`
    );
    const empresas = [];
    for (const row of rows) {
      try {
        empresas.push(await sanitizeEmpresaRow(pool, row));
      } catch (rowErr) {
        console.error('[empresas] sanitize id=', row?.id_empresa, rowErr.message);
        empresas.push(row);
      }
    }
    res.json({ empresas });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/empresas/:id', async (req, res) => {
  try {
    const pool = getPool();
    await ensureEmpresaLogoColumn(pool);
    const [rows] = await pool.query(
      `SELECT * FROM empresa WHERE id_empresa=? AND ${EMPRESA_NAO_EXCLUIDA} LIMIT 1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error:'Empresa não encontrada' });
    res.json(await sanitizeEmpresaRow(pool, rows[0]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/empresas/:id/logo — upload da imagem (login + relatórios)
router.post('/empresas/:id/logo', uploadEmpresaLogo.single('logo'), async (req, res) => {
  const handler = async () => {
    try {
      const pool = getPool();
      await ensureEmpresaLogoColumn(pool);
      if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado (campo logo)' });
      const id = req.params.id;
      const [[emp]] = await pool.query(
        `SELECT id_empresa, logo_relatorio FROM empresa WHERE id_empresa=? AND ${EMPRESA_NAO_EXCLUIDA} LIMIT 1`,
        [id]
      );
      if (!emp) {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
        return res.status(404).json({ error: 'Empresa não encontrada' });
      }
      const webPath = webPathEmpresaLogo(id, req.file.filename);
      if (emp.logo_relatorio) tryUnlinkLogoFile(emp.logo_relatorio);
      await pool.query(`UPDATE empresa SET logo_relatorio=? WHERE id_empresa=? AND ${EMPRESA_NAO_EXCLUIDA}`, [webPath, id]);
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

// DELETE /api/empresas/:id/logo — remove logo
router.delete('/empresas/:id/logo', async (req, res) => {
  try {
    const pool = getPool();
    await ensureEmpresaLogoColumn(pool);
    const id = req.params.id;
    const [[emp]] = await pool.query(
      `SELECT logo_relatorio FROM empresa WHERE id_empresa=? AND ${EMPRESA_NAO_EXCLUIDA} LIMIT 1`,
      [id]
    );
    if (!emp) return res.status(404).json({ error: 'Empresa não encontrada' });
    if (emp.logo_relatorio) tryUnlinkLogoFile(emp.logo_relatorio);
    await pool.query(`UPDATE empresa SET logo_relatorio=NULL WHERE id_empresa=? AND ${EMPRESA_NAO_EXCLUIDA}`, [id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/empresas', async (req, res) => {
  try {
    const pool = getPool();
    await ensureEmpresaLogoColumn(pool);
    const b = req.body;
    if (!b.Razao_empresa) return res.status(400).json({ error:'Razao_empresa obrigatório' });
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      let newId = parseInt(b.id_empresa, 10);
      if (!Number.isInteger(newId) || newId < 1) newId = null;

      if (newId == null) {
        const [[seq]] = await conn.query(
          `SELECT COALESCE(MAX(id_empresa), 0) + 1 AS nextId FROM empresa`
        );
        newId = Number(seq?.nextId || 1);
      }

      await conn.query(
        `INSERT INTO empresa (
          id_empresa,
          Razao_empresa, nome_fantasia, cnpj, ins_estadual, ins_muncipal,
          tipo_pessoa, endereco, numero, bairro, cidade, uf, cep,
          telefone, telefone2, fax, site, email, email_nf,
          responsavel, responsavel_cpf, responsavel_telefone, responsavel_email,
          ipservidor,
          email_nomeexibicao, email_smtp, email_username, email_password,
          email_port, email_assinatura, email_emaildiretor,
          compartilhatudo, compartilhaproduto, compartilhacliente,
          compartilhafornecedor, muda_empresa, gempresapermite_trocarbase,
          logo_tamanho_relatorio, fluxo_pedidos,
          ativo, excluido
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'N')`,
        [
          newId,
          b.Razao_empresa, b.nome_fantasia||null, b.cnpj||null,
          b.ins_estadual||null, b.ins_muncipal||null,
          b.tipo_pessoa||'JURIDICA',
          b.endereco||null, b.numero||null, b.bairro||null,
          b.cidade||null, b.uf||null, b.cep||null,
          b.telefone||null, b.telefone2||null, b.fax||null,
          b.site||null, b.email||null, b.email_nf||null,
          b.responsavel||null, b.responsavel_cpf||null,
          b.responsavel_telefone||null, b.responsavel_email||null,
          b.ipservidor||null,
          b.email_nomeexibicao||null, b.email_smtp||null,
          b.email_username||null, b.email_password||null,
          b.email_port||null, b.email_assinatura||null, b.email_emaildiretor||null,
          b.compartilhatudo||'S', b.compartilhaproduto||'S',
          b.compartilhacliente||'S', b.compartilhafornecedor||'S',
          b.muda_empresa||'N', b.gempresapermite_trocarbase||'N',
          normLogoTamanho(b.logo_tamanho_relatorio),
          b.fluxo_pedidos||'LIVRE',
          b.ativo||'SIM'
        ]
      );

      await conn.commit();
      res.status(201).json({ ok:true, id:newId });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/empresas/:id', async (req, res) => {
  try {
    const pool = getPool();
    await ensureEmpresaLogoColumn(pool);
    const b = req.body;
    await pool.query(
      `UPDATE empresa SET Razao_empresa=?, nome_fantasia=?, cnpj=?, ins_estadual=?, ins_muncipal=?,
        tipo_pessoa=?, endereco=?, numero=?, bairro=?, cidade=?, uf=?, cep=?,
        telefone=?, telefone2=?, fax=?, site=?, email=?, email_nf=?,
        responsavel=?, responsavel_cpf=?, responsavel_telefone=?, responsavel_email=?,
        ipservidor=?, email_nomeexibicao=?, email_smtp=?, email_username=?, email_password=?,
        email_port=?, email_assinatura=?, email_emaildiretor=?,
        compartilhatudo=?, compartilhaproduto=?, compartilhacliente=?,
        compartilhafornecedor=?, muda_empresa=?, gempresapermite_trocarbase=?, ativo=?,
        logo_tamanho_relatorio=?, fluxo_pedidos=?
       WHERE id_empresa=? AND ${EMPRESA_NAO_EXCLUIDA}`,
      [
        b.Razao_empresa||null, b.nome_fantasia||null, b.cnpj||null, b.ins_estadual||null, b.ins_muncipal||null,
        b.tipo_pessoa||'JURIDICA', b.endereco||null, b.numero||null, b.bairro||null,
        b.cidade||null, b.uf||null, b.cep||null, b.telefone||null, b.telefone2||null, b.fax||null,
        b.site||null, b.email||null, b.email_nf||null, b.responsavel||null, b.responsavel_cpf||null,
        b.responsavel_telefone||null, b.responsavel_email||null, b.ipservidor||null,
        b.email_nomeexibicao||null, b.email_smtp||null, b.email_username||null, b.email_password||null,
        b.email_port||null, b.email_assinatura||null, b.email_emaildiretor||null,
        b.compartilhatudo||'S', b.compartilhaproduto||'S', b.compartilhacliente||'S', b.compartilhafornecedor||'S',
        b.muda_empresa||'N', b.gempresapermite_trocarbase||'N', b.ativo||'SIM',
        normLogoTamanho(b.logo_tamanho_relatorio),
        b.fluxo_pedidos||'LIVRE',
        req.params.id
      ]
    );
    res.json({ ok:true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/empresas/:id', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(`UPDATE empresa SET excluido='S' WHERE id_empresa=? AND ${EMPRESA_NAO_EXCLUIDA}`, [req.params.id]);
    res.json({ ok:true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// FORMAS DE PAGAMENTO (tabela: forma_pagto)
// Legado Delphi/Web costuma usar prazopadrao; a API/UI usam prazo_padrao.
// Sem ADD COLUMN (MySQL antigo): usa ALTER ADD e ignora erro de duplicidade.
// ─────────────────────────────────────────────────────────────────────────────
async function formaPagtoColumns(pool) {
  let rows = [];
  try {
    const [r] = await pool.query(
      `SELECT LOWER(TRIM(\`COLUMN_NAME\`)) AS n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      ['forma_pagto']
    );
    rows = r || [];
  } catch (_) {
    rows = [];
  }
  return new Set(rows.map(x => String(x.n)));
}

function formaPagtoMergedPrazo(row, cols) {
  const o = { ...row };
  if (cols.has('prazo_padrao') && cols.has('prazopadrao')) {
    const pn = String(o.prazo_padrao ?? '').trim();
    const po = String(o.prazopadrao ?? '').trim();
    o.prazo_padrao = pn || po || null;
  } else if (!cols.has('prazo_padrao') && cols.has('prazopadrao')) {
    o.prazo_padrao = o.prazopadrao != null && String(o.prazopadrao).trim() !== '' ? String(o.prazopadrao).trim() : null;
  }
  return o;
}

async function ensureFormaPagtoTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS forma_pagto (
      id INT AUTO_INCREMENT PRIMARY KEY,
      descricao VARCHAR(100) NOT NULL,
      status VARCHAR(1) DEFAULT 'S',
      excluido CHAR(1) DEFAULT 'N',
      dt_cadastro DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3
  `).catch(() => {});

  const adds = [
    ['tipo_pagto', `ALTER TABLE forma_pagto ADD COLUMN tipo_pagto VARCHAR(30) DEFAULT NULL`],
    ['prazo_padrao', `ALTER TABLE forma_pagto ADD COLUMN prazo_padrao VARCHAR(100) DEFAULT NULL`],
    ['prazopadrao', `ALTER TABLE forma_pagto ADD COLUMN prazopadrao VARCHAR(100) DEFAULT NULL`],
    ['recebimento_auto', `ALTER TABLE forma_pagto ADD COLUMN recebimento_auto CHAR(1) DEFAULT 'N'`],
    ['permite_troco', `ALTER TABLE forma_pagto ADD COLUMN permite_troco CHAR(1) DEFAULT 'N'`],
    ['tipo_percentual', `ALTER TABLE forma_pagto ADD COLUMN tipo_percentual VARCHAR(20) DEFAULT NULL`],
    ['percentual', `ALTER TABLE forma_pagto ADD COLUMN percentual DECIMAL(10,2) DEFAULT 0.00`]
  ];
  for (const [, sql] of adds) {
    await pool.query(sql).catch(() => {});
  }

  const c = await formaPagtoColumns(pool);
  if (c.has('prazo_padrao') && c.has('prazopadrao')) {
    await pool.query(
      `UPDATE forma_pagto SET prazo_padrao = prazopadrao
       WHERE (prazo_padrao IS NULL OR TRIM(prazo_padrao) = '')
         AND prazopadrao IS NOT NULL AND TRIM(prazopadrao) <> ''`
    ).catch(() => {});
  }
}

function normFormaPagtoPct(v) {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

router.get('/formas-pagamento', async (req, res) => {
  try {
    const pool = getPool();
    await ensureFormaPagtoTable(pool);
    const c = await formaPagtoColumns(pool);
    const [rows] = await pool.query(`SELECT * FROM forma_pagto WHERE (excluido='N' OR excluido IS NULL) ORDER BY descricao`);
    const formas = rows.map(r => formaPagtoMergedPrazo(r, c));
    res.json({ formas });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/formas-pagamento', async (req, res) => {
  try {
    const pc = permCrud(req, { incluir: 'incluir_formas_pagamento', alterar: 'alterar_formas_pagamento', excluir: 'excluir_formas_pagamento' });
    if (pc.incluir !== 'S') return negarCad(res, 'Sem permissão para incluir formas de pagamento');
    const pool = getPool();
    await ensureFormaPagtoTable(pool);
    const c = await formaPagtoColumns(pool);
    const n = v => (v === 'S' || v === true) ? 'S' : 'N';
    const { descricao, tipo_pagto, prazo_padrao, recebimento_auto, permite_troco, tipo_percentual, percentual, status } = req.body;
    if (!descricao) return res.status(400).json({ error: 'Descrição é obrigatória' });

    const prazoValRaw = prazo_padrao != null && String(prazo_padrao).trim() !== '' ? String(prazo_padrao).trim() : null;
    const pct = normFormaPagtoPct(percentual);

    const cols = ['descricao'];
    const ph = ['?'];
    const vals = [descricao];

    if (c.has('tipo_pagto')) {
      cols.push('tipo_pagto'); ph.push('?'); vals.push(tipo_pagto || null);
    }
    if (c.has('prazo_padrao')) {
      cols.push('prazo_padrao'); ph.push('?'); vals.push(prazoValRaw);
    }
    if (c.has('prazopadrao')) {
      cols.push('prazopadrao'); ph.push('?'); vals.push(prazoValRaw);
    }
    if (c.has('recebimento_auto')) {
      cols.push('recebimento_auto'); ph.push('?'); vals.push(n(recebimento_auto));
    }
    if (c.has('permite_troco')) {
      cols.push('permite_troco'); ph.push('?'); vals.push(n(permite_troco));
    }
    if (c.has('tipo_percentual')) {
      cols.push('tipo_percentual'); ph.push('?'); vals.push(tipo_percentual || null);
    }
    if (c.has('percentual')) {
      cols.push('percentual'); ph.push('?'); vals.push(pct);
    }
    cols.push('status', 'excluido');
    ph.push('?', '?');
    vals.push(status || 'S', 'N');

    const [r] = await pool.query(
      `INSERT INTO forma_pagto (${cols.join(', ')}) VALUES (${ph.join(', ')})`,
      vals
    );
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/formas-pagamento/:id', async (req, res) => {
  try {
    const pc = permCrud(req, { incluir: 'incluir_formas_pagamento', alterar: 'alterar_formas_pagamento', excluir: 'excluir_formas_pagamento' });
    if (pc.alterar !== 'S') return negarCad(res, 'Sem permissão para alterar formas de pagamento');
    const pool = getPool();
    await ensureFormaPagtoTable(pool);
    const c = await formaPagtoColumns(pool);
    const n = v => (v === 'S' || v === true) ? 'S' : 'N';
    const { descricao, tipo_pagto, prazo_padrao, recebimento_auto, permite_troco, tipo_percentual, percentual, status } = req.body;
    const prazoValRaw = prazo_padrao != null && String(prazo_padrao).trim() !== '' ? String(prazo_padrao).trim() : null;
    const pct = normFormaPagtoPct(percentual);

    const parts = [];
    const vals = [];
    parts.push('descricao=?'); vals.push(descricao);
    if (c.has('tipo_pagto')) { parts.push('tipo_pagto=?'); vals.push(tipo_pagto || null); }
    if (c.has('prazo_padrao')) { parts.push('prazo_padrao=?'); vals.push(prazoValRaw); }
    if (c.has('prazopadrao')) { parts.push('prazopadrao=?'); vals.push(prazoValRaw); }
    if (c.has('recebimento_auto')) { parts.push('recebimento_auto=?'); vals.push(n(recebimento_auto)); }
    if (c.has('permite_troco')) { parts.push('permite_troco=?'); vals.push(n(permite_troco)); }
    if (c.has('tipo_percentual')) { parts.push('tipo_percentual=?'); vals.push(tipo_percentual || null); }
    if (c.has('percentual')) { parts.push('percentual=?'); vals.push(pct); }
    parts.push('status=?'); vals.push(status || 'S');
    vals.push(req.params.id);

    await pool.query(`UPDATE forma_pagto SET ${parts.join(', ')} WHERE id=?`, vals);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/formas-pagamento/:id', async (req, res) => {
  try {
    const pc = permCrud(req, { incluir: 'incluir_formas_pagamento', alterar: 'alterar_formas_pagamento', excluir: 'excluir_formas_pagamento' });
    if (pc.excluir !== 'S') return negarCad(res, 'Sem permissão para excluir formas de pagamento');
    const pool = getPool();
    await ensureFormaPagtoTable(pool);
    await pool.query(`UPDATE forma_pagto SET excluido='S' WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// BANCOS
// ─────────────────────────────────────────────────────────────────────────────
async function ensureBancosTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bancos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nome VARCHAR(100) NOT NULL,
      apelido VARCHAR(50) DEFAULT NULL,
      num_banco VARCHAR(10) DEFAULT NULL,
      agencia VARCHAR(20) DEFAULT NULL,
      conta VARCHAR(20) DEFAULT NULL,
      observacao TEXT,
      saldo DECIMAL(15,2) DEFAULT 0.00,
      status CHAR(1) DEFAULT 'A',
      excluido CHAR(1) DEFAULT 'N',
      dt_cadastro DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3
  `).catch(() => {});
}

router.get('/bancos', async (req, res) => {
  try {
    const pool = getPool();
    await ensureBancosTable(pool);
    const [rows] = await pool.query(`SELECT * FROM bancos WHERE excluido='N' ORDER BY nome`);
    res.json({ bancos: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/bancos', async (req, res) => {
  try {
    const pc = permCrud(req, { incluir: 'incluir_bancos', alterar: 'alterar_bancos', excluir: 'excluir_bancos' });
    if (pc.incluir !== 'S') return negarCad(res, 'Sem permissão para incluir bancos');
    const pool = getPool();
    const { nome, apelido, num_banco, agencia, conta, observacao, saldo, status } = req.body;
    if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });
    const [r] = await pool.query(
      `INSERT INTO bancos (nome, apelido, num_banco, agencia, conta, observacao, saldo, status, excluido) VALUES (?,?,?,?,?,?,?,?,'N')`,
      [nome, apelido || null, num_banco || null, agencia || null, conta || null, observacao || null, saldo || 0, status || 'A']
    );
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/bancos/:id', async (req, res) => {
  try {
    const pc = permCrud(req, { incluir: 'incluir_bancos', alterar: 'alterar_bancos', excluir: 'excluir_bancos' });
    if (pc.alterar !== 'S') return negarCad(res, 'Sem permissão para alterar bancos');
    const pool = getPool();
    const { nome, apelido, num_banco, agencia, conta, observacao, saldo, status } = req.body;
    await pool.query(
      `UPDATE bancos SET nome=?, apelido=?, num_banco=?, agencia=?, conta=?, observacao=?, saldo=?, status=? WHERE id=?`,
      [nome, apelido || null, num_banco || null, agencia || null, conta || null, observacao || null, saldo || 0, status || 'A', req.params.id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/bancos/:id', async (req, res) => {
  try {
    const pc = permCrud(req, { incluir: 'incluir_bancos', alterar: 'alterar_bancos', excluir: 'excluir_bancos' });
    if (pc.excluir !== 'S') return negarCad(res, 'Sem permissão para excluir bancos');
    const pool = getPool();
    await pool.query(`UPDATE bancos SET excluido='S' WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// DESPESAS
// ─────────────────────────────────────────────────────────────────────────────
async function addColIfMissing(pool, table, col, def) {
  try {
    const [rows] = await pool.query(
      `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?`,
      [table, col]
    );
    if (!rows.length) await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${def}`);
  } catch (_) {}
}

async function ensurePlanoContasTable(pool) {
  await ensurePlanoContasSchema(pool);
}

async function ensureDespesasTable(pool) {
  await ensurePlanoContasTable(pool);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS despesas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nome VARCHAR(100) NOT NULL,
      tipo VARCHAR(20) DEFAULT 'FIXA',
      id_planoconta INT DEFAULT NULL,
      status CHAR(1) DEFAULT 'A',
      excluido CHAR(1) DEFAULT 'N',
      dt_cadastro DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8
  `).catch(() => {});
  await addColIfMissing(pool, 'despesas', 'nome', `VARCHAR(100) NOT NULL DEFAULT ''`);
  await addColIfMissing(pool, 'despesas', 'excluido',     `CHAR(1) DEFAULT 'N'`);
  await addColIfMissing(pool, 'despesas', 'id_planoconta', `INT DEFAULT NULL`);
  await addColIfMissing(pool, 'despesas', 'tipo',          `VARCHAR(20) DEFAULT 'FIXA'`);
  await addColIfMissing(pool, 'despesas', 'status',        `CHAR(1) DEFAULT 'A'`);
}

router.get('/despesas', async (req, res) => {
  try {
    const pool = getPool();
    await ensureDespesasTable(pool);
    await resolveDespesasLabelColumn(pool);
    const label = despesasLabelExpr('d');
    const orderBy = despesasOrderExpr('d');
    const [rows] = await pool.query(
      `SELECT d.*, ${label} AS descricao,
              p.descricao AS planoconta_nome, p.numero AS planoconta_numero
       FROM despesas d
       LEFT JOIN plano_contas p ON p.id = d.id_planoconta
       WHERE d.excluido='N'
       ORDER BY ${orderBy}`
    );
    res.json({ despesas: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/despesas', async (req, res) => {
  try {
    const pc = permCrud(req, { incluir: 'incluir_despesas', alterar: 'alterar_despesas', excluir: 'excluir_despesas' });
    if (pc.incluir !== 'S') return negarCad(res, 'Sem permissão para incluir despesas');
    const pool = getPool();
    await ensureDespesasTable(pool);
    const col = await resolveDespesasLabelColumn(pool);
    const { descricao, tipo, id_planoconta, status } = req.body;
    if (!descricao) return res.status(400).json({ error: 'Descrição é obrigatória' });
    const idPc = parseInt(id_planoconta, 10) || null;
    const [r] = await pool.query(
      `INSERT INTO despesas (\`${col}\`, tipo, id_planoconta, status, excluido) VALUES (?,?,?,?,'N')`,
      [descricao, tipo || 'FIXA', idPc, status || 'A']
    );
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/despesas/:id', async (req, res) => {
  try {
    const pc = permCrud(req, { incluir: 'incluir_despesas', alterar: 'alterar_despesas', excluir: 'excluir_despesas' });
    if (pc.alterar !== 'S') return negarCad(res, 'Sem permissão para alterar despesas');
    const pool = getPool();
    const col = await resolveDespesasLabelColumn(pool);
    const { descricao, tipo, id_planoconta, status } = req.body;
    const idPc = parseInt(id_planoconta, 10) || null;
    await pool.query(
      `UPDATE despesas SET \`${col}\`=?, tipo=?, id_planoconta=?, status=? WHERE id=?`,
      [descricao, tipo || 'FIXA', idPc, status || 'A', req.params.id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/despesas/:id', async (req, res) => {
  try {
    const pc = permCrud(req, { incluir: 'incluir_despesas', alterar: 'alterar_despesas', excluir: 'excluir_despesas' });
    if (pc.excluir !== 'S') return negarCad(res, 'Sem permissão para excluir despesas');
    const pool = getPool();
    await pool.query(`UPDATE despesas SET excluido='S' WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// SEGMENTOS
// ─────────────────────────────────────────────────────────────────────────────
async function ensureSegmentosTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS segmentos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      descricao VARCHAR(100) NOT NULL,
      status CHAR(1) DEFAULT 'A',
      excluido CHAR(1) DEFAULT 'N',
      dt_cadastro DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3
  `).catch(() => {});
}

router.get('/segmentos', async (req, res) => {
  try {
    const pool = getPool();
    // Segmentos agora aponta para a tabela categoria conforme solicitado
    const [rows] = await pool.query(`SELECT id, descricao, status FROM categoria WHERE COALESCE(excluido,'N')='N' ORDER BY descricao`);
    res.json({ segmentos: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function _normStatusSegmento(st) {
  const v = String(st || 'A').trim().toUpperCase();
  if (v === 'A') return 'A';
  return 'I';
}

router.post('/segmentos', async (req, res) => {
  try {
    const pc = permCrud(req, { incluir: 'incluir_segmentos', alterar: 'alterar_segmentos', excluir: 'excluir_segmentos' });
    if (pc.incluir !== 'S') return negarCad(res, 'Sem permissão para incluir segmentos');
    const pool = getPool();
    const { descricao, status } = req.body;
    if (!descricao) return res.status(400).json({ error: 'Descrição é obrigatória' });
    const [r] = await pool.query(`INSERT INTO categoria (descricao, status, excluido) VALUES (?,?,'N')`, [descricao, _normStatusSegmento(status)]);
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/segmentos/:id', async (req, res) => {
  try {
    const pc = permCrud(req, { incluir: 'incluir_segmentos', alterar: 'alterar_segmentos', excluir: 'excluir_segmentos' });
    if (pc.alterar !== 'S') return negarCad(res, 'Sem permissão para alterar segmentos');
    const pool = getPool();
    const { descricao, status } = req.body;
    await pool.query(`UPDATE categoria SET descricao=?, status=? WHERE id=?`, [descricao, _normStatusSegmento(status), req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/segmentos/:id', async (req, res) => {
  try {
    const pc = permCrud(req, { incluir: 'incluir_segmentos', alterar: 'alterar_segmentos', excluir: 'excluir_segmentos' });
    if (pc.excluir !== 'S') return negarCad(res, 'Sem permissão para excluir segmentos');
    const pool = getPool();
    await pool.query(`UPDATE categoria SET excluido='S' WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// REGIOES
// ─────────────────────────────────────────────────────────────────────────────
async function ensureRegioesTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS regioes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      descricao VARCHAR(100) NOT NULL,
      cod_auxiliar VARCHAR(20) DEFAULT NULL,
      distancia DECIMAL(10,2) DEFAULT 0.00,
      sigla VARCHAR(10) DEFAULT NULL,
      status CHAR(1) DEFAULT 'A',
      excluido CHAR(1) DEFAULT 'N',
      dt_cadastro DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3
  `).catch(() => {});
}

router.get('/regioes', async (req, res) => {
  try {
    const pool = getPool();
    await ensureRegioesTable(pool);
    const [rows] = await pool.query(`SELECT * FROM regioes WHERE excluido='N' ORDER BY descricao`);
    res.json({ regioes: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/regioes', async (req, res) => {
  try {
    const pool = getPool();
    const { descricao, cod_auxiliar, distancia, sigla, status } = req.body;
    if (!descricao) return res.status(400).json({ error: 'Descrição é obrigatória' });
    const [r] = await pool.query(`INSERT INTO regioes (descricao, cod_auxiliar, distancia, sigla, status, excluido) VALUES (?,?,?,?,?,'N')`, [descricao, cod_auxiliar || null, distancia || 0, sigla || null, status || 'A']);
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/regioes/:id', async (req, res) => {
  try {
    const pool = getPool();
    const { descricao, cod_auxiliar, distancia, sigla, status } = req.body;
    await pool.query(`UPDATE regioes SET descricao=?, cod_auxiliar=?, distancia=?, sigla=?, status=? WHERE id=?`, [descricao, cod_auxiliar || null, distancia || 0, sigla || null, status || 'A', req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/regioes/:id', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(`UPDATE regioes SET excluido='S' WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// NATUREZA
// ─────────────────────────────────────────────────────────────────────────────
async function ensureNaturezaTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS natureza (
      id INT AUTO_INCREMENT PRIMARY KEY,
      descricao VARCHAR(100) NOT NULL,
      tipo VARCHAR(50) DEFAULT NULL,
      movimenta_estoque CHAR(1) DEFAULT 'N',
      status CHAR(1) DEFAULT 'A',
      excluido CHAR(1) DEFAULT 'N',
      dt_cadastro DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3
  `).catch(() => {});
  await ensureFinanceiroContabilCols(pool);
}

router.get('/natureza', async (req, res) => {
  try {
    const pool = getPool();
    await ensureNaturezaTable(pool);
    const col = await resolveNaturezaLabelColumn(pool);
    const [rows] = await pool.query(
      `SELECT n.*, n.\`${col}\` AS descricao,
              p.numero AS planoconta_numero, p.descricao AS planoconta_nome
       FROM natureza n
       LEFT JOIN plano_contas p ON p.id = n.id_planoconta
       WHERE n.excluido='N' ORDER BY n.\`${col}\``
    );
    res.json({ natureza: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/natureza', async (req, res) => {
  try {
    const pool = getPool();
    await ensureNaturezaTable(pool);
    const n = v => (v === 'S' || v === true) ? 'S' : 'N';
    const col = await resolveNaturezaLabelColumn(pool);
    const { descricao, tipo, movimenta_estoque, status, id_planoconta } = req.body;
    if (!descricao) return res.status(400).json({ error: 'Descrição é obrigatória' });
    const [r] = await pool.query(
      `INSERT INTO natureza (\`${col}\`, tipo, movimenta_estoque, status, id_planoconta, excluido) VALUES (?,?,?,?,?,'N')`,
      [descricao, tipo || null, n(movimenta_estoque), status || 'A', parseInt(id_planoconta, 10) || null]
    );
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/natureza/:id', async (req, res) => {
  try {
    const pool = getPool();
    await ensureNaturezaTable(pool);
    const n = v => (v === 'S' || v === true) ? 'S' : 'N';
    const col = await resolveNaturezaLabelColumn(pool);
    const { descricao, tipo, movimenta_estoque, status, id_planoconta } = req.body;
    await pool.query(
      `UPDATE natureza SET \`${col}\`=?, tipo=?, movimenta_estoque=?, status=?, id_planoconta=? WHERE id=?`,
      [descricao, tipo || null, n(movimenta_estoque), status || 'A', parseInt(id_planoconta, 10) || null, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/natureza/:id', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(`UPDATE natureza SET excluido='S' WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// EVENTOS / CIDADES (tabela: festas_cidades)
// ─────────────────────────────────────────────────────────────────────────────
async function ensureFestasCidadesTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS festas_cidades (
      id INT AUTO_INCREMENT PRIMARY KEY,
      descricao VARCHAR(50) NOT NULL,
      cidade VARCHAR(50) NOT NULL,
      uf VARCHAR(2) NOT NULL,
      dtfesta VARCHAR(6) NOT NULL,
      dtcadastro DATE NOT NULL,
      obs VARCHAR(500) NOT NULL,
      excluido VARCHAR(1) DEFAULT 'N',
      status VARCHAR(1) DEFAULT 'N'
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3
  `).catch(() => {});
  
  // Garantir colunas novas via ALTER TABLE
  const cols = [
    ['descricao', 'VARCHAR(50)'],
    ['dtfesta', 'VARCHAR(6)'],
    ['dtcadastro', 'DATE'],
    ['obs', 'VARCHAR(500)'],
    ['status', 'VARCHAR(1) DEFAULT \'N\''],
    ['cidade', 'VARCHAR(50)'],
    ['uf', 'VARCHAR(2)']
  ];
  for (const [col, type] of cols) {
    await pool.query(`ALTER TABLE festas_cidades ADD COLUMN ${col} ${type}`).catch(() => {});
  }
}

router.get('/eventos-cidades', async (req, res) => {
  try {
    const pool = getPool();
    await ensureFestasCidadesTable(pool);
    const [rows] = await pool.query(`SELECT * FROM festas_cidades WHERE excluido='N' ORDER BY cidade`);
    res.json({ eventos_cidades: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/eventos-cidades', async (req, res) => {
  try {
    const pc = permCrud(req, { incluir: 'incluir_eventos_cidades', alterar: 'alterar_eventos_cidades', excluir: 'excluir_eventos_cidades' });
    if (pc.incluir !== 'S') return negarCad(res, 'Sem permissão para incluir eventos/cidades');
    const pool = getPool();
    const { descricao, cidade, uf, dtfesta, obs, status } = req.body;
    if (!cidade) return res.status(400).json({ error: 'Cidade é obrigatória' });
    
    // dtcadastro deve ser a data atual no formato YYYY-MM-DD
    const dtcadastro = new Date().toISOString().split('T')[0];
    
    const [r] = await pool.query(
      `INSERT INTO festas_cidades (descricao, cidade, uf, dtfesta, dtcadastro, obs, status, excluido)
       VALUES (?,?,?,?,?,?,?,'N')`,
      [descricao || null, cidade, uf || null, dtfesta || '', dtcadastro, obs || '', status || 'N']
    );
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/eventos-cidades/:id', async (req, res) => {
  try {
    const pc = permCrud(req, { incluir: 'incluir_eventos_cidades', alterar: 'alterar_eventos_cidades', excluir: 'excluir_eventos_cidades' });
    if (pc.alterar !== 'S') return negarCad(res, 'Sem permissão para alterar eventos/cidades');
    const pool = getPool();
    const { descricao, cidade, uf, dtfesta, obs, status } = req.body;
    await pool.query(
      `UPDATE festas_cidades SET descricao=?, cidade=?, uf=?, dtfesta=?, obs=?, status=? WHERE id=?`,
      [descricao || null, cidade, uf || null, dtfesta || '', obs || '', status || 'N', req.params.id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/eventos-cidades/:id', async (req, res) => {
  try {
    const pc = permCrud(req, { incluir: 'incluir_eventos_cidades', alterar: 'alterar_eventos_cidades', excluir: 'excluir_eventos_cidades' });
    if (pc.excluir !== 'S') return negarCad(res, 'Sem permissão para excluir eventos/cidades');
    const pool = getPool();
    await pool.query(`UPDATE festas_cidades SET excluido='S' WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// TIPO DE PEDIDO
// ─────────────────────────────────────────────────────────────────────────────
const _sn = v => (v === 'S' || v === true || v === 1) ? 'S' : 'N';

const _tipoPedidosReady = new Set();
async function ensureTipoPedidosColumns(pool) {
  const db = pool.pool?.config?.connectionConfig?.database || 'default';
  if (_tipoPedidosReady.has(db)) return;
  const cols = [
    ['excluido',        "CHAR(1) NOT NULL DEFAULT 'N'"],
    ['situacao',        "CHAR(1) NOT NULL DEFAULT 'A'"],
    ['obs',             'VARCHAR(255) DEFAULT NULL'],
    ['puxada',          "CHAR(1) NOT NULL DEFAULT 'N'"],
    ['gerafinanceiro',  "CHAR(1) NOT NULL DEFAULT 'S'"],
    ['permiteprocesso', "CHAR(1) NOT NULL DEFAULT 'N'"],
    ['movimentaestoque',"CHAR(1) NOT NULL DEFAULT 'S'"],
    ['faturado',        "CHAR(1) NOT NULL DEFAULT 'N'"],
    ['importacao',      "CHAR(1) NOT NULL DEFAULT 'N'"],
    ['padrao_vitrine',  "CHAR(1) NOT NULL DEFAULT 'N'"],
    ['cod_planoconta',  'INT DEFAULT NULL'],
    ['tratamento',      'VARCHAR(50) DEFAULT NULL'],
    ['id_receitas',     'INT DEFAULT NULL'],
  ];
  for (const [col, type] of cols) {
    await pool.query(`ALTER TABLE tipo_pedidos ADD COLUMN ${col} ${type}`).catch(() => {});
  }
  _tipoPedidosReady.add(db);
}

router.get('/tipo-pedidos', async (req, res) => {
  try {
    const pool = getPool();
    await ensureTipoPedidosColumns(pool);
    const { q = '', situacao = '', limit = 200, offset = 0 } = req.query;
    // where para a lista (com filtro de situação)
    let where = `excluido = 'N'`;
    const params = [];
    if (situacao) { where += ` AND situacao = ?`; params.push(situacao); }
    if (q)        { where += ` AND descricao LIKE ?`; params.push(`%${q}%`); }
    // where para contadores (sem filtro de situação, só q)
    let whereCount = `excluido = 'N'`;
    const paramsCount = [];
    if (q) { whereCount += ` AND descricao LIKE ?`; paramsCount.push(`%${q}%`); }
    const [[{ total }]]   = await pool.query(`SELECT COUNT(*) AS total FROM tipo_pedidos WHERE ${where}`, params);
    const [[{ total_a }]] = await pool.query(`SELECT COUNT(*) AS total_a FROM tipo_pedidos WHERE ${whereCount} AND situacao='A'`, paramsCount);
    const [[{ total_i }]] = await pool.query(`SELECT COUNT(*) AS total_i FROM tipo_pedidos WHERE ${whereCount} AND situacao<>'A'`, paramsCount);
    const [rows] = await pool.query(
      `SELECT * FROM tipo_pedidos WHERE ${where} ORDER BY descricao LIMIT ? OFFSET ?`,
      [...params, +limit, +offset]
    );
    res.json({ tipos: rows, total, total_a, total_i });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/tipo-pedidos/:id', async (req, res) => {
  try {
    const pool = getPool();
    const [[row]] = await pool.query(`SELECT * FROM tipo_pedidos WHERE id = ? AND excluido = 'N'`, [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Não encontrado' });
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/tipo-pedidos', async (req, res) => {
  try {
    const pool = getPool();
    await ensureTipoPedidosColumns(pool);
    const { descricao, obs, situacao, puxada, gerafinanceiro, permiteprocesso,
            movimentaestoque, faturado, importacao, padrao_vitrine,
            cod_planoconta, tratamento, id_receitas } = req.body;
    if (!descricao) return res.status(400).json({ error: 'Descrição é obrigatória' });
    const [r] = await pool.query(
      `INSERT INTO tipo_pedidos
       (descricao, obs, situacao, puxada, gerafinanceiro, permiteprocesso,
        movimentaestoque, faturado, importacao, padrao_vitrine,
        cod_planoconta, tratamento, id_receitas, excluido)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'N')`,
      [ descricao.toUpperCase(), obs || null, situacao || 'A',
        _sn(puxada), _sn(gerafinanceiro), _sn(permiteprocesso),
        _sn(movimentaestoque), _sn(faturado), _sn(importacao), _sn(padrao_vitrine),
        cod_planoconta || null, tratamento || null, id_receitas || null ]
    );
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/tipo-pedidos/:id', async (req, res) => {
  try {
    const pool = getPool();
    await ensureTipoPedidosColumns(pool);
    const { descricao, obs, situacao, puxada, gerafinanceiro, permiteprocesso,
            movimentaestoque, faturado, importacao, padrao_vitrine,
            cod_planoconta, tratamento, id_receitas } = req.body;
    if (!descricao) return res.status(400).json({ error: 'Descrição é obrigatória' });
    await pool.query(
      `UPDATE tipo_pedidos SET
       descricao=?, obs=?, situacao=?, puxada=?, gerafinanceiro=?, permiteprocesso=?,
       movimentaestoque=?, faturado=?, importacao=?, padrao_vitrine=?,
       cod_planoconta=?, tratamento=?, id_receitas=?
       WHERE id=? AND excluido='N'`,
      [ descricao.toUpperCase(), obs || null, situacao || 'A',
        _sn(puxada), _sn(gerafinanceiro), _sn(permiteprocesso),
        _sn(movimentaestoque), _sn(faturado), _sn(importacao), _sn(padrao_vitrine),
        cod_planoconta || null, tratamento || null, id_receitas || null,
        req.params.id ]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/tipo-pedidos/:id/ativar', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(`UPDATE tipo_pedidos SET situacao='A' WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/tipo-pedidos/:id/inativar', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(`UPDATE tipo_pedidos SET situacao='I' WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/tipo-pedidos/:id', async (req, res) => {
  try {
    const pool = getPool();
    const [[{ cnt }]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM pedidos WHERE id_tipopedido = ? AND excluido='N'`, [req.params.id]
    );
    if (cnt > 0) return res.status(400).json({ error: `Não é possível excluir: ${cnt} pedido(s) vinculado(s)` });
    await pool.query(`UPDATE tipo_pedidos SET excluido='S' WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// PLANO DE CONTAS (gerencial — hierárquico)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/plano-contas', async (req, res) => {
  try {
    const pool = getPool();
    await ensurePlanoContasTable(pool);
    const analiticas = req.query.analiticas === '1' || req.query.analiticas === 'S';
    let sql = `
      SELECT pc.*, pai.descricao AS pai_descricao, pai.numero AS pai_numero
      FROM plano_contas pc
      LEFT JOIN plano_contas pai ON pai.id = pc.id_pai
      WHERE (pc.excluido='N' OR pc.excluido IS NULL)`;
    if (analiticas) {
      sql += ` AND UPPER(COALESCE(pc.tipo,'ANALITICA'))='ANALITICA'
               AND COALESCE(pc.aceita_lancamento,'S')='S'
               AND COALESCE(pc.status,'A')='A'`;
    }
    sql += ` ORDER BY COALESCE(pc.numero,''), pc.descricao`;
    const [rows] = await pool.query(sql);
    res.json({ plano_contas: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/** Seed seguro: só cria números que ainda não existem. */
router.post('/plano-contas/modelo', async (req, res) => {
  try {
    const pc = permCrud(req, { incluir: 'incluir_plano_contas', alterar: 'alterar_plano_contas', excluir: 'excluir_plano_contas' });
    if (pc.incluir !== 'S') return negarCad(res, 'Sem permissão para incluir plano de contas');
    const pool = getPool();
    await ensurePlanoContasTable(pool);
    const result = await seedPlanoContasModelo(pool);
    res.json({ ok: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/plano-contas', async (req, res) => {
  try {
    const pc = permCrud(req, { incluir: 'incluir_plano_contas', alterar: 'alterar_plano_contas', excluir: 'excluir_plano_contas' });
    if (pc.incluir !== 'S') return negarCad(res, 'Sem permissão para incluir plano de contas');
    const pool = getPool();
    await ensurePlanoContasTable(pool);
    const { numero, descricao, id_pai, tipo, grupo, status } = req.body;
    if (!descricao || !String(descricao).trim()) return res.status(400).json({ error: 'Descrição é obrigatória' });
    const tipoN = normalizeTipoConta(tipo);
    const idPai = parseInt(id_pai, 10) || null;
    const nivel = await calcNivelPai(pool, idPai);
    const aceita = tipoN === 'ANALITICA' ? 'S' : 'N';
    const leg = await planoContasLegacyWriteFields(pool, idPai);
    const [r] = await pool.query(
      `INSERT INTO plano_contas (numero, descricao, id_pai, nivel, tipo, grupo, aceita_lancamento, status, excluido${leg.insertCols})
       VALUES (?,?,?,?,?,?,?,?,'N'${leg.insertPlaceholders})`,
      [
        (numero || '').toString().trim() || null,
        String(descricao).trim(),
        idPai,
        nivel,
        tipoN,
        normalizeGrupoConta(grupo),
        aceita,
        status === 'I' ? 'I' : 'A',
        ...leg.values,
      ]
    );
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

async function temCicloPlanoContas(pool, id, idPai) {
  if (!idPai) return false;
  if (idPai === id) return true;
  let cur = idPai;
  for (let i = 0; i < 20; i++) {
    if (cur === id) return true;
    const [rows] = await pool.query(
      `SELECT id_pai FROM plano_contas WHERE id=? AND (excluido='N' OR excluido IS NULL) LIMIT 1`,
      [cur]
    );
    if (!rows.length || !rows[0].id_pai) return false;
    cur = Number(rows[0].id_pai);
  }
  return false;
}

router.put('/plano-contas/:id', async (req, res) => {
  try {
    const pc = permCrud(req, { incluir: 'incluir_plano_contas', alterar: 'alterar_plano_contas', excluir: 'excluir_plano_contas' });
    if (pc.alterar !== 'S') return negarCad(res, 'Sem permissão para alterar plano de contas');
    const pool = getPool();
    await ensurePlanoContasTable(pool);
    const id = parseInt(req.params.id, 10);
    const { numero, descricao, id_pai, tipo, grupo, status } = req.body;
    if (!descricao || !String(descricao).trim()) return res.status(400).json({ error: 'Descrição é obrigatória' });
    const idPai = parseInt(id_pai, 10) || null;
    if (idPai && idPai === id) return res.status(400).json({ error: 'A conta não pode ser pai de si mesma' });
    if (await temCicloPlanoContas(pool, id, idPai)) {
      return res.status(400).json({ error: 'Hierarquia inválida: a conta pai cria um ciclo' });
    }
    const tipoN = normalizeTipoConta(tipo);
    const nivel = await calcNivelPai(pool, idPai);
    const aceita = tipoN === 'ANALITICA' ? 'S' : 'N';
    const leg = await planoContasLegacyWriteFields(pool, idPai);
    await pool.query(
      `UPDATE plano_contas SET numero=?, descricao=?, id_pai=?, nivel=?, tipo=?, grupo=?, aceita_lancamento=?, status=?${leg.setSql}
       WHERE id=?`,
      [
        (numero || '').toString().trim() || null,
        String(descricao).trim(),
        idPai,
        nivel,
        tipoN,
        normalizeGrupoConta(grupo),
        aceita,
        status === 'I' ? 'I' : 'A',
        ...leg.values,
        id,
      ]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/plano-contas/:id', async (req, res) => {
  try {
    const pc = permCrud(req, { incluir: 'incluir_plano_contas', alterar: 'alterar_plano_contas', excluir: 'excluir_plano_contas' });
    if (pc.excluir !== 'S') return negarCad(res, 'Sem permissão para excluir plano de contas');
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const [filhos] = await pool.query(
      `SELECT id FROM plano_contas WHERE id_pai=? AND (excluido='N' OR excluido IS NULL) LIMIT 1`,
      [id]
    );
    if (filhos.length) return res.status(400).json({ error: 'Exclua ou reclassifique as contas filhas antes' });
    await pool.query(`UPDATE plano_contas SET excluido='S' WHERE id=?`, [id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// CENTRO DE CUSTO
// ─────────────────────────────────────────────────────────────────────────────
router.get('/centro-custo', async (req, res) => {
  try {
    const pool = getPool();
    await ensureCentroCustoSchema(pool);
    const analiticas = req.query.analiticas === '1' || req.query.analiticas === 'S';
    let sql = `
      SELECT cc.*, pai.descricao AS pai_descricao, pai.codigo AS pai_codigo
      FROM centro_custo cc
      LEFT JOIN centro_custo pai ON pai.id = cc.id_pai
      WHERE (cc.excluido='N' OR cc.excluido IS NULL)`;
    if (analiticas) {
      sql += ` AND UPPER(COALESCE(cc.tipo,'ANALITICA'))='ANALITICA' AND COALESCE(cc.status,'A')='A'`;
    }
    sql += ` ORDER BY COALESCE(cc.codigo,''), cc.descricao`;
    const [rows] = await pool.query(sql);
    res.json({ centro_custo: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/centro-custo', async (req, res) => {
  try {
    const pc = permCrud(req, { incluir: 'incluir_centro_custo', alterar: 'alterar_centro_custo', excluir: 'excluir_centro_custo' });
    if (pc.incluir !== 'S') return negarCad(res, 'Sem permissão para incluir centro de custo');
    const pool = getPool();
    await ensureCentroCustoSchema(pool);
    const { codigo, descricao, id_pai, tipo, status } = req.body;
    if (!descricao || !String(descricao).trim()) return res.status(400).json({ error: 'Descrição é obrigatória' });
    const [r] = await pool.query(
      `INSERT INTO centro_custo (codigo, descricao, id_pai, tipo, status, excluido) VALUES (?,?,?,?,?,'N')`,
      [
        (codigo || '').toString().trim() || null,
        String(descricao).trim(),
        parseInt(id_pai, 10) || null,
        normalizeTipoConta(tipo),
        status === 'I' ? 'I' : 'A',
      ]
    );
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/centro-custo/:id', async (req, res) => {
  try {
    const pc = permCrud(req, { incluir: 'incluir_centro_custo', alterar: 'alterar_centro_custo', excluir: 'excluir_centro_custo' });
    if (pc.alterar !== 'S') return negarCad(res, 'Sem permissão para alterar centro de custo');
    const pool = getPool();
    await ensureCentroCustoSchema(pool);
    const id = parseInt(req.params.id, 10);
    const { codigo, descricao, id_pai, tipo, status } = req.body;
    if (!descricao || !String(descricao).trim()) return res.status(400).json({ error: 'Descrição é obrigatória' });
    const idPai = parseInt(id_pai, 10) || null;
    if (idPai && idPai === id) return res.status(400).json({ error: 'O centro não pode ser pai de si mesmo' });
    await pool.query(
      `UPDATE centro_custo SET codigo=?, descricao=?, id_pai=?, tipo=?, status=? WHERE id=?`,
      [
        (codigo || '').toString().trim() || null,
        String(descricao).trim(),
        idPai,
        normalizeTipoConta(tipo),
        status === 'I' ? 'I' : 'A',
        id,
      ]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/centro-custo/:id', async (req, res) => {
  try {
    const pc = permCrud(req, { incluir: 'incluir_centro_custo', alterar: 'alterar_centro_custo', excluir: 'excluir_centro_custo' });
    if (pc.excluir !== 'S') return negarCad(res, 'Sem permissão para excluir centro de custo');
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const [filhos] = await pool.query(
      `SELECT id FROM centro_custo WHERE id_pai=? AND (excluido='N' OR excluido IS NULL) LIMIT 1`,
      [id]
    );
    if (filhos.length) return res.status(400).json({ error: 'Exclua ou reclassifique os centros filhos antes' });
    await pool.query(`UPDATE centro_custo SET excluido='S' WHERE id=?`, [id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

async function ensurePerfilPermissions(pool) {
  return ensurePerfilCadastroColumns(pool);
}

// ─────────────────────────────────────────────────────────────────────────────
// TIPO FRETE
// ─────────────────────────────────────────────────────────────────────────────
async function ensureTipoFreteTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tipo_frete (
      id INT AUTO_INCREMENT PRIMARY KEY,
      descricao VARCHAR(100) NOT NULL,
      valor DECIMAL(10,2) DEFAULT 0.00,
      status CHAR(1) DEFAULT 'A',
      excluido CHAR(1) DEFAULT 'N',
      dt_cadastro DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3
  `).catch(() => {});
}

router.get('/tipo-frete', async (req, res) => {
  try {
    const pool = getPool();
    await ensureTipoFreteTable(pool);
    const [rows] = await pool.query(`SELECT * FROM tipo_frete WHERE excluido='N' ORDER BY nome`);
    res.json({ tipo_frete: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/tipo-frete', async (req, res) => {
  try {
    const pool = getPool();
    const { nome, descricao, valor, status } = req.body;
    const _nome = nome || descricao;
    if (!_nome) return res.status(400).json({ error: 'Nome é obrigatório' });
    const [r] = await pool.query(`INSERT INTO tipo_frete (nome, valor, status, excluido) VALUES (?,?,?,'N')`, [_nome, valor || 0, status || 'A']);
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/tipo-frete/:id', async (req, res) => {
  try {
    const pool = getPool();
    const { nome, descricao, valor, status } = req.body;
    await pool.query(`UPDATE tipo_frete SET nome=?, valor=?, status=? WHERE id=?`, [nome || descricao, valor || 0, status || 'A', req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/tipo-frete/:id', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(`UPDATE tipo_frete SET excluido='S' WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// LOCAIS ARMAZENAMENTO
// ─────────────────────────────────────────────────────────────────────────────
async function ensureLocaisArmazenamentoTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS locais_armazenamento (
      id INT AUTO_INCREMENT PRIMARY KEY,
      descricao VARCHAR(100) NOT NULL,
      tipo VARCHAR(50) DEFAULT NULL,
      status CHAR(1) DEFAULT 'A',
      excluido CHAR(1) DEFAULT 'N',
      dt_cadastro DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3
  `).catch(() => {});
}

router.get('/locais-armazenamento', async (req, res) => {
  try {
    const pool = getPool();
    await ensureLocaisArmazenamentoTable(pool);
    const [rows] = await pool.query(`SELECT * FROM locais_armazenamento WHERE excluido='N' ORDER BY descricao`);
    res.json({ locais: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/locais-armazenamento', async (req, res) => {
  try {
    const pool = getPool();
    const { descricao, tipo, status } = req.body;
    if (!descricao) return res.status(400).json({ error: 'Descrição é obrigatória' });
    const [r] = await pool.query(`INSERT INTO locais_armazenamento (descricao, tipo, status, excluido) VALUES (?,?,?,'N')`, [descricao, tipo || null, status || 'A']);
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/locais-armazenamento/:id', async (req, res) => {
  try {
    const pool = getPool();
    const { descricao, tipo, status } = req.body;
    await pool.query(`UPDATE locais_armazenamento SET descricao=?, tipo=?, status=? WHERE id=?`, [descricao, tipo || null, status || 'A', req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/locais-armazenamento/:id', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(`UPDATE locais_armazenamento SET excluido='S' WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// MOTIVO DE VISITAS
// ─────────────────────────────────────────────────────────────────────────────
async function ensureMotivoVisitasTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS motivo_visitas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      descricao VARCHAR(100) NOT NULL,
      status CHAR(1) DEFAULT 'A',
      excluido CHAR(1) DEFAULT 'N',
      dt_cadastro DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3
  `).catch(() => {});
}

router.get('/motivo-visitas', async (req, res) => {
  try {
    const pool = getPool();
    await ensureMotivoVisitasTable(pool);
    const [rows] = await pool.query(`SELECT * FROM motivo_visitas WHERE excluido='N' ORDER BY descricao`);
    res.json({ motivo_visitas: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/motivo-visitas', async (req, res) => {
  try {
    const pool = getPool();
    const { descricao, status } = req.body;
    if (!descricao) return res.status(400).json({ error: 'Descrição é obrigatória' });
    const [r] = await pool.query(`INSERT INTO motivo_visitas (descricao, status, excluido) VALUES (?,?,'N')`, [descricao, status || 'A']);
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/motivo-visitas/:id', async (req, res) => {
  try {
    const pool = getPool();
    const { descricao, status } = req.body;
    await pool.query(`UPDATE motivo_visitas SET descricao=?, status=? WHERE id=?`, [descricao, status || 'A', req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/motivo-visitas/:id', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(`UPDATE motivo_visitas SET excluido='S' WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// HOTÉIS
// ─────────────────────────────────────────────────────────────────────────────
async function ensureHoteisTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hoteis (
      id INT AUTO_INCREMENT PRIMARY KEY,
      razao_social VARCHAR(150) NOT NULL,
      nome_fantasia VARCHAR(150) DEFAULT NULL,
      cnpj VARCHAR(20) DEFAULT NULL,
      insc_estadual VARCHAR(20) DEFAULT NULL,
      fone_principal VARCHAR(20) DEFAULT NULL,
      fone_secundario VARCHAR(20) DEFAULT NULL,
      email VARCHAR(100) DEFAULT NULL,
      cep VARCHAR(15) DEFAULT NULL,
      endereco VARCHAR(150) DEFAULT NULL,
      numero VARCHAR(20) DEFAULT NULL,
      bairro VARCHAR(100) DEFAULT NULL,
      cidade VARCHAR(100) DEFAULT NULL,
      uf CHAR(2) DEFAULT NULL,
      contato VARCHAR(100) DEFAULT NULL,
      obs_gerais TEXT DEFAULT NULL,
      status CHAR(1) DEFAULT 'A',
      excluido CHAR(1) DEFAULT 'N',
      dt_cadastro DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3
  `).catch(() => {});
}

router.get('/hoteis', async (req, res) => {
  try {
    const pool = getPool();
    await ensureHoteisTable(pool);
    const [rows] = await pool.query(`SELECT * FROM hoteis WHERE excluido='N' ORDER BY razao_social`);
    res.json({ hoteis: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/hoteis', async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.razao_social) return res.status(400).json({ error: 'Razão Social é obrigatória' });
    const [r] = await pool.query(
      `INSERT INTO hoteis (
        razao_social, nome_fantasia, cnpj, insc_estadual, fone_principal, fone_secundario,
        email, cep, endereco, numero, bairro, cidade, uf, contato, obs_gerais, status, excluido
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'N')`,
      [
        b.razao_social, b.nome_fantasia||null, b.cnpj||null, b.insc_estadual||null, b.fone_principal||null, b.fone_secundario||null,
        b.email||null, b.cep||null, b.endereco||null, b.numero||null, b.bairro||null, b.cidade||null, b.uf||null, b.contato||null, b.obs_gerais||null, b.status||'A'
      ]
    );
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/hoteis/:id', async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    await pool.query(
      `UPDATE hoteis SET 
        razao_social=?, nome_fantasia=?, cnpj=?, insc_estadual=?, fone_principal=?, fone_secundario=?,
        email=?, cep=?, endereco=?, numero=?, bairro=?, cidade=?, uf=?, contato=?, obs_gerais=?, status=?
       WHERE id=?`,
      [
        b.razao_social, b.nome_fantasia||null, b.cnpj||null, b.insc_estadual||null, b.fone_principal||null, b.fone_secundario||null,
        b.email||null, b.cep||null, b.endereco||null, b.numero||null, b.bairro||null, b.cidade||null, b.uf||null, b.contato||null, b.obs_gerais||null, b.status||'A',
        req.params.id
      ]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/hoteis/:id', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(`UPDATE hoteis SET excluido='S' WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// LOOKUPS PARA PEDIDOS (Filtros e Seleções)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/lookups/fornecedores', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(`SELECT id, nome FROM fornecedores WHERE COALESCE(excluido,'N')='N' ORDER BY nome`);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/lookups/vendedores', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(`SELECT idusuario as id, nomeusu as nome FROM usuarios WHERE COALESCE(excluido,'N')='N' ORDER BY nomeusu`);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/lookups/transportadoras', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS transportadora (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nome VARCHAR(100),
        excluido VARCHAR(1) DEFAULT 'N'
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3
    `).catch(() => {});
    const [rows] = await pool.query(`SELECT id, nome FROM transportadora WHERE COALESCE(excluido,'N')='N' ORDER BY nome`);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
