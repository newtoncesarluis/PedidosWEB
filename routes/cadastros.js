const express = require('express');
const router  = express.Router();
const { getPool } = require('../config/database');

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
    const n = v => v === 'S' || v === true ? 'S' : 'N';
    const {
      descricao,
      incluir_pedvendas, alterar_pedvendas, excluir_pedvendas,
      incluir_clientes, alterar_clientes, exclui_clientes,
      incluir_fornecedor, alterar_fornecedor, excluir_fornecedor,
      incluir_produtos, alterar_produtos, excluir_produtos,
      incluir_formas_pagamento, alterar_formas_pagamento, excluir_formas_pagamento,
      incluir_bancos, alterar_bancos, excluir_bancos,
      incluir_despesas, alterar_despesas, excluir_despesas,
      incluir_segmentos, alterar_segmentos, excluir_segmentos,
      incluir_regioes, alterar_regioes, excluir_regioes,
      incluir_natureza, alterar_natureza, excluir_natureza,
      incluir_tipo_frete, alterar_tipo_frete, excluir_tipo_frete,
      incluir_locais_armazenamento, alterar_locais_armazenamento, excluir_locais_armazenamento,
      incluir_motivo_visitas, alterar_motivo_visitas, excluir_motivo_visitas,
      incluir_hoteis, alterar_hoteis, excluir_hoteis,
      p_vender, p_comprar, acessogerenciais, manutencaocadastros,
      acessartodosclientes, mudarempresa, alterarbase,
      acesso_financeiro, acessoperfil
    } = req.body;
    const [r] = await pool.query(
      `INSERT INTO perfil (descricao,
        incluir_pedvendas,alterar_pedvendas,excluir_pedvendas,
        incluir_clientes,alterar_clientes,exclui_clientes,
        incluir_fornecedor,alterar_fornecedor,excluir_fornecedor,
        incluir_produtos,alterar_produtos,excluir_produtos,
        incluir_formas_pagamento, alterar_formas_pagamento, excluir_formas_pagamento,
        incluir_bancos, alterar_bancos, excluir_bancos,
        incluir_despesas, alterar_despesas, excluir_despesas,
        incluir_segmentos, alterar_segmentos, excluir_segmentos,
        incluir_regioes, alterar_regioes, excluir_regioes,
        incluir_natureza, alterar_natureza, excluir_natureza,
        incluir_tipo_frete, alterar_tipo_frete, excluir_tipo_frete,
        incluir_locais_armazenamento, alterar_locais_armazenamento, excluir_locais_armazenamento,
        incluir_motivo_visitas, alterar_motivo_visitas, excluir_motivo_visitas,
        incluir_hoteis, alterar_hoteis, excluir_hoteis,
        p_vender,p_comprar,acessogerenciais,manutencaocadastros,
        acessartodosclientes,mudarempresa,alterarbase,
        acesso_financeiro,acessoperfil,excluido)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'N')`,
      [descricao||null,
       n(incluir_pedvendas),n(alterar_pedvendas),n(excluir_pedvendas),
       n(incluir_clientes),n(alterar_clientes),n(exclui_clientes),
       n(incluir_fornecedor),n(alterar_fornecedor),n(excluir_fornecedor),
       n(incluir_produtos),n(alterar_produtos),n(excluir_produtos),
       n(incluir_formas_pagamento),n(alterar_formas_pagamento),n(excluir_formas_pagamento),
       n(incluir_bancos),n(alterar_bancos),n(excluir_bancos),
       n(incluir_despesas),n(alterar_despesas),n(excluir_despesas),
       n(incluir_segmentos),n(alterar_segmentos),n(excluir_segmentos),
       n(incluir_regioes),n(alterar_regioes),n(excluir_regioes),
       n(incluir_natureza),n(alterar_natureza),n(excluir_natureza),
       n(incluir_tipo_frete),n(alterar_tipo_frete),n(excluir_tipo_frete),
       n(incluir_locais_armazenamento),n(alterar_locais_armazenamento),n(excluir_locais_armazenamento),
       n(incluir_motivo_visitas),n(alterar_motivo_visitas),n(excluir_motivo_visitas),
       n(incluir_hoteis),n(alterar_hoteis),n(excluir_hoteis),
       n(p_vender),n(p_comprar),n(acessogerenciais),n(manutencaocadastros),
       n(acessartodosclientes),n(mudarempresa),n(alterarbase),
       n(acesso_financeiro),n(acessoperfil)]
    );
    res.status(201).json({ ok:true, id:r.insertId });
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
    const n = v => v === 'S' || v === true ? 'S' : 'N';
    const {
      descricao,
      incluir_pedvendas, alterar_pedvendas, excluir_pedvendas,
      incluir_clientes, alterar_clientes, exclui_clientes,
      incluir_fornecedor, alterar_fornecedor, excluir_fornecedor,
      incluir_produtos, alterar_produtos, excluir_produtos,
      incluir_formas_pagamento, alterar_formas_pagamento, excluir_formas_pagamento,
      incluir_bancos, alterar_bancos, excluir_bancos,
      incluir_despesas, alterar_despesas, excluir_despesas,
      incluir_segmentos, alterar_segmentos, excluir_segmentos,
      incluir_regioes, alterar_regioes, excluir_regioes,
      incluir_natureza, alterar_natureza, excluir_natureza,
      incluir_tipo_frete, alterar_tipo_frete, excluir_tipo_frete,
      incluir_locais_armazenamento, alterar_locais_armazenamento, excluir_locais_armazenamento,
      incluir_motivo_visitas, alterar_motivo_visitas, excluir_motivo_visitas,
      incluir_hoteis, alterar_hoteis, excluir_hoteis,
      p_vender, p_comprar, acessogerenciais, manutencaocadastros,
      acessartodosclientes, mudarempresa, alterarbase,
      acesso_financeiro, acessoperfil
    } = req.body;
    await pool.query(
      `UPDATE perfil SET descricao=?,
        incluir_pedvendas=?,alterar_pedvendas=?,excluir_pedvendas=?,
        incluir_clientes=?,alterar_clientes=?,exclui_clientes=?,
        incluir_fornecedor=?,alterar_fornecedor=?,excluir_fornecedor=?,
        incluir_produtos=?,alterar_produtos=?,excluir_produtos=?,
        incluir_formas_pagamento=?, alterar_formas_pagamento=?, excluir_formas_pagamento=?,
        incluir_bancos=?, alterar_bancos=?, excluir_bancos=?,
        incluir_despesas=?, alterar_despesas=?, excluir_despesas=?,
        incluir_segmentos=?, alterar_segmentos=?, excluir_segmentos=?,
        incluir_regioes=?, alterar_regioes=?, excluir_regioes=?,
        incluir_natureza=?, alterar_natureza=?, excluir_natureza=?,
        incluir_tipo_frete=?, alterar_tipo_frete=?, excluir_tipo_frete=?,
        incluir_locais_armazenamento=?, alterar_locais_armazenamento=?, excluir_locais_armazenamento=?,
        incluir_motivo_visitas=?, alterar_motivo_visitas=?, excluir_motivo_visitas=?,
        incluir_hoteis=?, alterar_hoteis=?, excluir_hoteis=?,
        p_vender=?,p_comprar=?,acessogerenciais=?,manutencaocadastros=?,
        acessartodosclientes=?,mudarempresa=?,alterarbase=?,
        acesso_financeiro=?,acessoperfil=?
       WHERE id=?`,
      [descricao||null,
       n(incluir_pedvendas),n(alterar_pedvendas),n(excluir_pedvendas),
       n(incluir_clientes),n(alterar_clientes),n(exclui_clientes),
       n(incluir_fornecedor),n(alterar_fornecedor),n(excluir_fornecedor),
       n(incluir_produtos),n(alterar_produtos),n(excluir_produtos),
       n(incluir_formas_pagamento),n(alterar_formas_pagamento),n(excluir_formas_pagamento),
       n(incluir_bancos),n(alterar_bancos),n(excluir_bancos),
       n(incluir_despesas),n(alterar_despesas),n(excluir_despesas),
       n(incluir_segmentos),n(alterar_segmentos),n(excluir_segmentos),
       n(incluir_regioes),n(alterar_regioes),n(excluir_regioes),
       n(incluir_natureza),n(alterar_natureza),n(excluir_natureza),
       n(incluir_tipo_frete),n(alterar_tipo_frete),n(excluir_tipo_frete),
       n(incluir_locais_armazenamento),n(alterar_locais_armazenamento),n(excluir_locais_armazenamento),
       n(incluir_motivo_visitas),n(alterar_motivo_visitas),n(excluir_motivo_visitas),
       n(incluir_hoteis),n(alterar_hoteis),n(excluir_hoteis),
       n(p_vender),n(p_comprar),n(acessogerenciais),n(manutencaocadastros),
       n(acessartodosclientes),n(mudarempresa),n(alterarbase),
       n(acesso_financeiro),n(acessoperfil),req.params.id]
    );
    res.json({ ok:true });
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
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

// ─── Multer: upload de avatar do usuário ───────────────────────────────────────
const _uploadsBaseUsr = path.join(__dirname, '..', 'public', 'uploads', 'usuarios');

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

async function ensureUsuarioColumns(pool) {
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
    ['excluido', "VARCHAR(1) DEFAULT 'N'"],
    ['SITUACAO', "VARCHAR(20) DEFAULT 'ATIVO'"]
  ];
  for (const [col, type] of cols) {
    await pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ${col} ${type}`).catch(() => {
       return pool.query(`ALTER TABLE usuarios ADD COLUMN ${col} ${type}`).catch(() => {});
    });
  }
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
       LEFT JOIN usuario_empresa ue
         ON ue.id_empresa = e.id_empresa AND ue.idusuario = ?
       WHERE e.excluido = 'N'
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

    const [r] = await pool.query(
      `INSERT INTO usuarios (nomeusu,loginusu,senhausu,SITUACAO,excluido,idperfil,email)
       VALUES(?,?,?,?,  'N',?,?)`,
      [nomeusu, loginusu, senhausu, SITUACAO||'ATIVO', idperfil||null, email||null]
    );
    const newId = r.insertId;
    await _updateUsuarioOpcional(pool, newId, req.body);
    res.status(201).json({ ok:true, id:newId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/usuarios/:id', async (req, res) => {
  try {
    const pool = getPool();
    const { nomeusu, loginusu, senhausu, SITUACAO, idperfil, email } = req.body;
    const base = [`nomeusu=?`,`loginusu=?`,`SITUACAO=?`,`idperfil=?`,`email=?`];
    const vals = [nomeusu||null, loginusu||null, SITUACAO||'ATIVO', idperfil||null, email||null];
    if (senhausu) { base.push(`senhausu=?`); vals.push(senhausu); }
    vals.push(req.params.id);
    await pool.query(`UPDATE usuarios SET ${base.join(',')} WHERE idusuario=? AND COALESCE(excluido, 'N')='N'`, vals);
    await _updateUsuarioOpcional(pool, req.params.id, req.body);
    res.json({ ok:true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/usuarios/:id/avatar', uploadUsr.single('arquivo'), async (req, res) => {
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
});

async function _updateUsuarioOpcional(pool, id, body) {
  const n = v => v === 'S' || v === true ? 'S' : 'N';
  const sets = [];
  const vals = [];

  const opt = {
    rota_vendedor: body.rota_vendedor||null,
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
    email_smtp: body.email_smtp||null,
    email_port: body.email_port||null,
    email_username: body.email_username||null,
    email_password: body.email_password||null,
    email_nome_exibicao: body.email_nome_exibicao||null,
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

  for (const [col, val] of Object.entries(opt)) {
    sets.push(`${col}=?`); vals.push(val);
  }
  vals.push(id);
  await pool.query(`UPDATE usuarios SET ${sets.join(',')} WHERE idusuario=?`, vals)
    .catch(()=>{});
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
      await conn.query(`DELETE FROM usuario_empresa WHERE idusuario=?`, [req.params.id]);
      if (id_empresas.length > 0) {
        await conn.query(
          `INSERT INTO usuario_empresa (idusuario,id_empresa) VALUES ?`,
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
    const { id_fornecedores } = req.body;
    if (!Array.isArray(id_fornecedores))
      return res.status(400).json({ error:'id_fornecedores deve ser array' });

    const [[usr]] = await pool.query(`SELECT id_vendedor FROM usuarios WHERE idusuario=?`, [req.params.id]);
    if (!usr || !usr.id_vendedor) 
      return res.status(400).json({ error: 'Usuário não possui vendedor vinculado para salvar fornecedores' });

    const codVendedor = usr.id_vendedor;
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
// EMPRESAS
// ─────────────────────────────────────────────────────────────────────────────
router.get('/empresas', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(`SELECT * FROM empresa WHERE excluido='N' ORDER BY Razao_empresa`);
    res.json({ empresas: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/empresas/:id', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(`SELECT * FROM empresa WHERE id_empresa=? AND excluido='N' LIMIT 1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error:'Empresa não encontrada' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/empresas', async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.Razao_empresa) return res.status(400).json({ error:'Razao_empresa obrigatório' });
    const [r] = await pool.query(
      `INSERT INTO empresa (
        Razao_empresa, nome_fantasia, cnpj, ins_estadual, ins_muncipal,
        tipo_pessoa, endereco, numero, bairro, cidade, uf, cep,
        telefone, telefone2, fax, site, email, email_nf,
        responsavel, responsavel_cpf, responsavel_telefone, responsavel_email,
        ipservidor,
        email_nomeexibicao, email_smtp, email_username, email_password,
        email_port, email_assinatura, email_emaildiretor,
        compartilhatudo, compartilhaproduto, compartilhacliente,
        compartilhafornecedor, muda_empresa, gempresapermite_trocarbase,
        ativo, excluido
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'SIM','N')`,
      [
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
        b.ativo||'SIM'
      ]
    );
    res.status(201).json({ ok:true, id:r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/empresas/:id', async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    await pool.query(
      `UPDATE empresa SET Razao_empresa=?, nome_fantasia=?, cnpj=?, ins_estadual=?, ins_muncipal=?,
        tipo_pessoa=?, endereco=?, numero=?, bairro=?, cidade=?, uf=?, cep=?,
        telefone=?, telefone2=?, fax=?, site=?, email=?, email_nf=?,
        responsavel=?, responsavel_cpf=?, responsavel_telefone=?, responsavel_email=?,
        ipservidor=?, email_nomeexibicao=?, email_smtp=?, email_username=?, email_password=?,
        email_port=?, email_assinatura=?, email_emaildiretor=?,
        compartilhatudo=?, compartilhaproduto=?, compartilhacliente=?,
        compartilhafornecedor=?, muda_empresa=?, gempresapermite_trocarbase=?, ativo=?
       WHERE id_empresa=? AND excluido='N'`,
      [
        b.Razao_empresa||null, b.nome_fantasia||null, b.cnpj||null, b.ins_estadual||null, b.ins_muncipal||null,
        b.tipo_pessoa||'JURIDICA', b.endereco||null, b.numero||null, b.bairro||null,
        b.cidade||null, b.uf||null, b.cep||null, b.telefone||null, b.telefone2||null, b.fax||null,
        b.site||null, b.email||null, b.email_nf||null, b.responsavel||null, b.responsavel_cpf||null,
        b.responsavel_telefone||null, b.responsavel_email||null, b.ipservidor||null,
        b.email_nomeexibicao||null, b.email_smtp||null, b.email_username||null, b.email_password||null,
        b.email_port||null, b.email_assinatura||null, b.email_emaildiretor||null,
        b.compartilhatudo||'S', b.compartilhaproduto||'S', b.compartilhacliente||'S', b.compartilhafornecedor||'S',
        b.muda_empresa||'N', b.gempresapermite_trocarbase||'N', b.ativo||'SIM', req.params.id
      ]
    );
    res.json({ ok:true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/empresas/:id', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(`UPDATE empresa SET excluido='S' WHERE id_empresa=? AND excluido='N'`, [req.params.id]);
    res.json({ ok:true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// FORMAS DE PAGAMENTO (tabela: forma_pagto)
// ─────────────────────────────────────────────────────────────────────────────
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
  
  // Colunas opcionais do novo padrão que podem não existir no legado
  const optionalCols = [
    ['tipo_pagto', 'VARCHAR(30) DEFAULT NULL'],
    ['prazo_padrao', 'VARCHAR(100) DEFAULT NULL'],
    ['recebimento_auto', 'CHAR(1) DEFAULT \'N\''],
    ['permite_troco', 'CHAR(1) DEFAULT \'N\''],
    ['tipo_percentual', 'VARCHAR(20) DEFAULT NULL'],
    ['percentual', 'DECIMAL(10,2) DEFAULT 0.00']
  ];
  for (const [col, type] of optionalCols) {
    await pool.query(`ALTER TABLE forma_pagto ADD COLUMN IF NOT EXISTS ${col} ${type}`).catch(() => {});
  }
}

router.get('/formas-pagamento', async (req, res) => {
  try {
    const pool = getPool();
    await ensureFormaPagtoTable(pool);
    const [rows] = await pool.query(`SELECT * FROM forma_pagto WHERE excluido='N' ORDER BY descricao`);
    res.json({ formas: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/formas-pagamento', async (req, res) => {
  try {
    const pool = getPool();
    const n = v => (v === 'S' || v === true) ? 'S' : 'N';
    const { descricao, tipo_pagto, prazo_padrao, recebimento_auto, permite_troco, tipo_percentual, percentual, status } = req.body;
    if (!descricao) return res.status(400).json({ error: 'Descrição é obrigatória' });
    
    const [r] = await pool.query(
      `INSERT INTO forma_pagto (descricao, tipo_pagto, prazo_padrao, recebimento_auto, permite_troco, tipo_percentual, percentual, status, excluido)
       VALUES (?,?,?,?,?,?,?,?,'N')`,
      [descricao, tipo_pagto || null, prazo_padrao || null, n(recebimento_auto), n(permite_troco), tipo_percentual || null, percentual || 0, status || 'S']
    );
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/formas-pagamento/:id', async (req, res) => {
  try {
    const pool = getPool();
    const n = v => (v === 'S' || v === true) ? 'S' : 'N';
    const { descricao, tipo_pagto, prazo_padrao, recebimento_auto, permite_troco, tipo_percentual, percentual, status } = req.body;
    await pool.query(
      `UPDATE forma_pagto SET descricao=?, tipo_pagto=?, prazo_padrao=?, recebimento_auto=?, permite_troco=?, tipo_percentual=?, percentual=?, status=? WHERE id=?`,
      [descricao, tipo_pagto || null, prazo_padrao || null, n(recebimento_auto), n(permite_troco), tipo_percentual || null, percentual || 0, status || 'S', req.params.id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/formas-pagamento/:id', async (req, res) => {
  try {
    const pool = getPool();
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
    const pool = getPool();
    await pool.query(`UPDATE bancos SET excluido='S' WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// DESPESAS
// ─────────────────────────────────────────────────────────────────────────────
async function ensureDespesasTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS despesas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      descricao VARCHAR(100) NOT NULL,
      id_planoconta INT DEFAULT NULL,
      status CHAR(1) DEFAULT 'A',
      excluido CHAR(1) DEFAULT 'N',
      dt_cadastro DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3
  `).catch(() => {});
  // Garantir que a coluna excluido exista em bancos legados
  await pool.query(`ALTER TABLE despesas ADD COLUMN IF NOT EXISTS excluido CHAR(1) DEFAULT 'N'`).catch(() => {});
  await pool.query(`ALTER TABLE despesas ADD COLUMN IF NOT EXISTS id_planoconta INT DEFAULT NULL`).catch(() => {});
}

router.get('/despesas', async (req, res) => {
  try {
    const pool = getPool();
    await ensureDespesasTable(pool);
    const [rows] = await pool.query(`SELECT d.*, p.descricao as planoconta_nome FROM despesas d LEFT JOIN plano_contas p ON p.id = d.id_planoconta WHERE d.excluido='N' ORDER BY d.descricao`);
    res.json({ despesas: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/despesas', async (req, res) => {
  try {
    const pool = getPool();
    const { descricao, id_planoconta, status } = req.body;
    if (!descricao) return res.status(400).json({ error: 'Descrição é obrigatória' });
    const [r] = await pool.query(`INSERT INTO despesas (descricao, id_planoconta, status, excluido) VALUES (?,?,?,'N')`, [descricao, id_planoconta || null, status || 'A']);
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/despesas/:id', async (req, res) => {
  try {
    const pool = getPool();
    const { descricao, id_planoconta, status } = req.body;
    await pool.query(`UPDATE despesas SET descricao=?, id_planoconta=?, status=? WHERE id=?`, [descricao, id_planoconta || null, status || 'A', req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/despesas/:id', async (req, res) => {
  try {
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
    const [rows] = await pool.query(`SELECT id, descricao, status FROM categoria WHERE excluido='N' ORDER BY descricao`);
    res.json({ segmentos: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/segmentos', async (req, res) => {
  try {
    const pool = getPool();
    const { descricao, status } = req.body;
    if (!descricao) return res.status(400).json({ error: 'Descrição é obrigatória' });
    const [r] = await pool.query(`INSERT INTO categoria (descricao, status, excluido) VALUES (?,?,'N')`, [descricao, status || 'A']);
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/segmentos/:id', async (req, res) => {
  try {
    const pool = getPool();
    const { descricao, status } = req.body;
    await pool.query(`UPDATE categoria SET descricao=?, status=? WHERE id=?`, [descricao, status || 'A', req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/segmentos/:id', async (req, res) => {
  try {
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
}

router.get('/natureza', async (req, res) => {
  try {
    const pool = getPool();
    await ensureNaturezaTable(pool);
    const [rows] = await pool.query(`SELECT * FROM natureza WHERE excluido='N' ORDER BY descricao`);
    res.json({ natureza: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/natureza', async (req, res) => {
  try {
    const pool = getPool();
    const n = v => (v === 'S' || v === true) ? 'S' : 'N';
    const { descricao, tipo, movimenta_estoque, status } = req.body;
    if (!descricao) return res.status(400).json({ error: 'Descrição é obrigatória' });
    const [r] = await pool.query(`INSERT INTO natureza (descricao, tipo, movimenta_estoque, status, excluido) VALUES (?,?,?,?,'N')`, [descricao, tipo || null, n(movimenta_estoque), status || 'A']);
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/natureza/:id', async (req, res) => {
  try {
    const pool = getPool();
    const n = v => (v === 'S' || v === true) ? 'S' : 'N';
    const { descricao, tipo, movimenta_estoque, status } = req.body;
    await pool.query(`UPDATE natureza SET descricao=?, tipo=?, movimenta_estoque=?, status=? WHERE id=?`, [descricao, tipo || null, n(movimenta_estoque), status || 'A', req.params.id]);
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
    await pool.query(`ALTER TABLE festas_cidades ADD COLUMN IF NOT EXISTS ${col} ${type}`).catch(() => {});
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
    const pool = getPool();
    await pool.query(`UPDATE festas_cidades SET excluido='S' WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// PLANO DE CONTAS
// ─────────────────────────────────────────────────────────────────────────────
router.get('/plano-contas', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(`SELECT id, numero, descricao FROM plano_contas WHERE excluido='N' ORDER BY numero`);
    res.json({ plano_contas: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Helper para garantir colunas de permissão no perfil
async function ensurePerfilPermissions(pool) {
  const cols = [
    ['incluir_formas_pagamento', 'CHAR(1) DEFAULT \'N\''], ['alterar_formas_pagamento', 'CHAR(1) DEFAULT \'N\''], ['excluir_formas_pagamento', 'CHAR(1) DEFAULT \'N\''],
    ['incluir_bancos', 'CHAR(1) DEFAULT \'N\''], ['alterar_bancos', 'CHAR(1) DEFAULT \'N\''], ['excluir_bancos', 'CHAR(1) DEFAULT \'N\''],
    ['incluir_despesas', 'CHAR(1) DEFAULT \'N\''], ['alterar_despesas', 'CHAR(1) DEFAULT \'N\''], ['excluir_despesas', 'CHAR(1) DEFAULT \'N\''],
    ['incluir_segmentos', 'CHAR(1) DEFAULT \'N\''], ['alterar_segmentos', 'CHAR(1) DEFAULT \'N\''], ['excluir_segmentos', 'CHAR(1) DEFAULT \'N\''],
    ['incluir_regioes', 'CHAR(1) DEFAULT \'N\''], ['alterar_regioes', 'CHAR(1) DEFAULT \'N\''], ['excluir_regioes', 'CHAR(1) DEFAULT \'N\''],
    ['incluir_natureza', 'CHAR(1) DEFAULT \'N\''], ['alterar_natureza', 'CHAR(1) DEFAULT \'N\''], ['excluir_natureza', 'CHAR(1) DEFAULT \'N\''],
    ['incluir_tipo_frete', 'CHAR(1) DEFAULT \'N\''], ['alterar_tipo_frete', 'CHAR(1) DEFAULT \'N\''], ['excluir_tipo_frete', 'CHAR(1) DEFAULT \'N\''],
    ['incluir_locais_armazenamento', 'CHAR(1) DEFAULT \'N\''], ['alterar_locais_armazenamento', 'CHAR(1) DEFAULT \'N\''], ['excluir_locais_armazenamento', 'CHAR(1) DEFAULT \'N\''],
    ['incluir_motivo_visitas', 'CHAR(1) DEFAULT \'N\''], ['alterar_motivo_visitas', 'CHAR(1) DEFAULT \'N\''], ['excluir_motivo_visitas', 'CHAR(1) DEFAULT \'N\''],
    ['incluir_hoteis', 'CHAR(1) DEFAULT \'N\''], ['alterar_hoteis', 'CHAR(1) DEFAULT \'N\''], ['excluir_hoteis', 'CHAR(1) DEFAULT \'N\'']
  ];
  for (const [col, type] of cols) {
    await pool.query(`ALTER TABLE perfil ADD COLUMN IF NOT EXISTS ${col} ${type}`).catch(async () => {
      try { await pool.query(`ALTER TABLE perfil ADD COLUMN ${col} ${type}`); } catch(e){}
    });
  }
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
    const [rows] = await pool.query(`SELECT * FROM tipo_frete WHERE excluido='N' ORDER BY descricao`);
    res.json({ tipo_frete: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/tipo-frete', async (req, res) => {
  try {
    const pool = getPool();
    const { descricao, valor, status } = req.body;
    if (!descricao) return res.status(400).json({ error: 'Descrição é obrigatória' });
    const [r] = await pool.query(`INSERT INTO tipo_frete (descricao, valor, status, excluido) VALUES (?,?,?,'N')`, [descricao, valor || 0, status || 'A']);
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/tipo-frete/:id', async (req, res) => {
  try {
    const pool = getPool();
    const { descricao, valor, status } = req.body;
    await pool.query(`UPDATE tipo_frete SET descricao=?, valor=?, status=? WHERE id=?`, [descricao, valor || 0, status || 'A', req.params.id]);
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
